/**
 * Quick Capture V4 — flat level-based navigator.
 *
 * Strip mode: thin bar snapped to screen edge, acts as drop target.
 * Expanded mode: clipboard summary + search + flat level browser.
 * Left arrow = go up a level, Right arrow = drill into item.
 * Cmd+V pastes into selected and refreshes immediately.
 */
(function () {
  'use strict';

  let baseUrl = '';
  let boards = [];
  let isExpanded = false;
  const STRIP_WIDTH_THRESHOLD = 96;

  // Navigation stack: each entry = { items: [...], activeIndex, title }
  // items[i] = { type, id, title, detail, boardId, colIndex, cardId, data, columns }
  let navStack = [];

  // Clipboard state
  let clipboardData = { type: 'empty', summary: '', isPassword: false };

  let isSearchMode = false;
  let searchResults = [];
  let activeSearchIndex = -1;
  let searchDebounceTimer = null;

  const els = {};

  function tauriInvoke(cmd, args) {
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      return window.__TAURI_INTERNALS__.invoke(cmd, args || {});
    }
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      return window.__TAURI__.core.invoke(cmd, args || {});
    }
    return Promise.reject(new Error('Tauri invoke unavailable: ' + cmd));
  }

  function tauriListen(eventName, callback) {
    if (window.__TAURI_INTERNALS__ &&
      typeof window.__TAURI_INTERNALS__.invoke === 'function' &&
      typeof window.__TAURI_INTERNALS__.transformCallback === 'function') {
      const handler = window.__TAURI_INTERNALS__.transformCallback(function (event) {
        callback(event);
      });
      return window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
        event: eventName,
        target: { kind: 'Any' },
        handler: handler,
      });
    }
    if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === 'function') {
      return window.__TAURI__.event.listen(eventName, callback);
    }
    return Promise.reject(new Error('Tauri listen unavailable: ' + eventName));
  }

  // Apply theme immediately from localStorage
  if (typeof applyLexeraTheme === 'function') {
    applyLexeraTheme(localStorage.getItem('lexera-theme') || 'lexera');
  }

  // --- Init ---

  async function init() {
    els.stripView = document.getElementById('strip-view');
    els.stripDropZone = document.getElementById('strip-drop-zone');
    els.stripClipLabel = document.getElementById('strip-clip-label');
    els.stripIcon = document.getElementById('strip-icon');
    els.expandedView = document.getElementById('expanded-view');
    els.clipboardPreview = document.getElementById('clipboard-preview');
    els.searchInput = document.getElementById('search-input');
    els.browseArea = document.getElementById('browse-area');
    els.btnCollapse = document.getElementById('btn-collapse');
    els.statusMsg = document.getElementById('status-msg');

    setupEventListeners();
    syncModeFromWindowSize();
    window.addEventListener('resize', syncModeFromWindowSize);
    renderClipboardSummary();
    await loadClipboardSummary();

    baseUrl = await discoverBackend();
    if (!baseUrl) {
      showStatus('Cannot connect to Lexera Backend', 'error');
      pushBoardsLevel();
      return;
    }

    // Load theme from backend
    try {
      const themeRes = await fetch(baseUrl + '/config/theme');
      if (themeRes.ok) {
        const themeData = await themeRes.json();
        if (themeData.theme && typeof applyLexeraTheme === 'function') {
          applyLexeraTheme(themeData.theme);
        }
      }
    } catch (e) { /* keep localStorage theme */ }

    await loadBoards();
    pushBoardsLevel();
  }

  async function discoverBackend() {
    try {
      const url = await tauriInvoke('get_backend_url');
      if (url) {
        const res = await fetch(url + '/status', { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'running') return url;
        }
      }
    } catch (e) { /* fall through */ }

    const ports = [1431, 13080, 12080, 14080, 11080, 15080];
    for (const port of ports) {
      try {
        const res = await fetch(`http://localhost:${port}/status`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'running' && data.port) {
            return `http://localhost:${data.port}`;
          }
        }
      } catch (e) { /* try next */ }
    }
    return null;
  }

  // --- Clipboard Summary ---

  function looksLikePassword(text) {
    const t = text.trim();
    if (t.length < 6 || t.length > 128) return false;
    if (/\s/.test(t)) return false;
    if (/^(\$2[ab]\$|\$argon2|ghp_|gho_|Bearer\s)/i.test(t)) return true;
    const freq = {};
    for (const ch of t) freq[ch] = (freq[ch] || 0) + 1;
    let entropy = 0;
    const len = t.length;
    for (const ch in freq) {
      const p = freq[ch] / len;
      entropy -= p * Math.log2(p);
    }
    if (entropy <= 3.5) return false;
    let classes = 0;
    if (/[a-z]/.test(t)) classes++;
    if (/[A-Z]/.test(t)) classes++;
    if (/[0-9]/.test(t)) classes++;
    if (/[^a-zA-Z0-9]/.test(t)) classes++;
    return classes >= 2;
  }

  function renderClipboardSummary() {
    els.clipboardPreview.innerHTML = '';

    // Update strip label with short clipboard text
    if (els.stripClipLabel) {
      if (clipboardData.type === 'empty') {
        els.stripClipLabel.textContent = '';
      } else if (clipboardData.isPassword) {
        els.stripClipLabel.textContent = '***';
      } else {
        els.stripClipLabel.textContent = clipboardData.summary;
        // Truncate with ellipsis since CSS text-overflow doesn't work with vertical writing-mode
        requestAnimationFrame(() => {
          if (!els.stripClipLabel) return;
          let text = clipboardData.summary;
          while (els.stripClipLabel.scrollHeight > els.stripClipLabel.clientHeight && text.length > 1) {
            text = text.substring(0, text.length - 1);
            els.stripClipLabel.textContent = text + '...';
          }
        });
      }
    }

    if (clipboardData.type === 'empty') {
      els.clipboardPreview.innerHTML = '<div class="clipboard-empty">No clipboard content</div>';
      return;
    }

    const summary = document.createElement('div');
    summary.className = 'clipboard-summary';

    const badge = document.createElement('span');
    badge.className = 'clipboard-type-badge';
    badge.textContent = clipboardData.type === 'image' ? 'IMG' : clipboardData.type === 'url' ? 'URL' : 'TXT';
    summary.appendChild(badge);

    const label = document.createElement('span');
    label.className = 'clipboard-summary-text' + (clipboardData.isPassword ? ' clipboard-password-warning' : '');
    label.textContent = clipboardData.summary;
    summary.appendChild(label);

    els.clipboardPreview.appendChild(summary);
  }

  async function loadClipboardSummary() {
    clipboardData = { type: 'empty', summary: '', isPassword: false };
    const failures = [];

    // Preferred path: lightweight clipboard summary (does not transfer large image payloads)
    try {
      const summary = await tauriInvoke('read_clipboard_summary');
      if (summary && summary.kind === 'image') {
        let imageLabel = 'Image (clipboard)';
        if (summary.image && typeof summary.image.width === 'number' && typeof summary.image.height === 'number') {
          imageLabel += ` ${summary.image.width}x${summary.image.height}`;
        }
        clipboardData = { type: 'image', summary: imageLabel, isPassword: false };
        renderClipboardSummary();
        return;
      }
      if (summary && summary.kind === 'text' && typeof summary.text === 'string' && summary.text.trim()) {
        const trimmed = summary.text.trim();
        if (looksLikePassword(trimmed)) {
          clipboardData = { type: 'text', summary: 'Sensitive content (hidden)', isPassword: true };
        } else if (isUrl(trimmed)) {
          let hostname = 'link';
          try { hostname = new URL(trimmed).hostname; } catch (e) { /* ignore */ }
          clipboardData = { type: 'url', summary: hostname, isPassword: false };
        } else {
          const firstLine = trimmed.split('\n')[0].trim();
          clipboardData = {
            type: 'text',
            summary: firstLine.length > 60 ? firstLine.substring(0, 60) + '...' : firstLine,
            isPassword: false,
          };
        }
        renderClipboardSummary();
        return;
      }
      if (summary && summary.kind === 'empty') {
        renderClipboardSummary();
        return;
      }
    } catch (e) {
      failures.push('summary: ' + (e && e.message ? e.message : String(e)));
    }

    // Try image first
    try {
      const imgResult = await tauriInvoke('read_clipboard_image');
      if (imgResult && imgResult.data) {
        clipboardData = { type: 'image', summary: 'Image (clipboard)', isPassword: false };
        renderClipboardSummary();
        return;
      }
    } catch (e) {
      failures.push('image: ' + (e && e.message ? e.message : String(e)));
    }

    // Try text
    try {
      const text = await tauriInvoke('read_clipboard');
      if (text && text.trim()) {
        const trimmed = text.trim();
        if (looksLikePassword(trimmed)) {
          clipboardData = { type: 'text', summary: 'Sensitive content (hidden)', isPassword: true };
        } else if (isUrl(trimmed)) {
          let hostname = 'link';
          try { hostname = new URL(trimmed).hostname; } catch (e) { /* ignore */ }
          clipboardData = { type: 'url', summary: hostname, isPassword: false };
        } else {
          const firstLine = text.split('\n')[0].trim();
          clipboardData = {
            type: 'text',
            summary: firstLine.length > 60 ? firstLine.substring(0, 60) + '...' : firstLine,
            isPassword: false,
          };
        }
        renderClipboardSummary();
        return;
      }
    } catch (e) {
      failures.push('text: ' + (e && e.message ? e.message : String(e)));
    }

    renderClipboardSummary();
    if (failures.length >= 2) {
      showStatus('Clipboard read failed. See logs for details.', 'error');
      log('Clipboard summary failures:', failures);
    }
  }

  // --- API helpers ---

  async function apiGet(path) {
    const res = await fetch(baseUrl + path);
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(text);
    }
    return res.json();
  }

  async function apiUpload(path, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(baseUrl + path, { method: 'POST', body: form });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(text);
    }
    return res.json();
  }

  // --- Board loading ---

  async function loadBoards() {
    try {
      const data = await apiGet('/boards');
      boards = data.boards || [];
    } catch (e) {
      showStatus('Failed to load boards', 'error');
    }
  }

  // --- Flat Level Navigation ---

  function currentLevel() {
    return navStack.length > 0 ? navStack[navStack.length - 1] : null;
  }

  function pushBoardsLevel() {
    const items = boards.map(b => ({
      type: 'board',
      id: b.id,
      title: b.title || b.filePath.split('/').pop().replace('.md', ''),
      detail: (b.columns || []).length + ' columns',
      boardId: b.id,
      columns: b.columns,
      data: b,
    }));
    navStack = [{ items: items, activeIndex: items.length > 0 ? 0 : -1, title: 'Boards' }];
    renderLevel();
  }

  async function drillInto(item) {
    const children = await loadChildren(item);
    if (!children || children.length === 0) return;
    navStack.push({ items: children, activeIndex: 0, title: item.title });
    renderLevel();
  }

  function goUp() {
    if (navStack.length <= 1) return;
    navStack.pop();
    renderLevel();
  }

  async function loadChildren(node) {
    if (node.type === 'board') {
      try {
        const data = await apiGet(`/boards/${node.id}/columns`);
        const fullBoard = data.fullBoard;
        if (fullBoard && fullBoard.rows && fullBoard.rows.length > 0) {
          return fullBoard.rows.map(r => ({
            type: 'row',
            id: r.id,
            title: r.title || 'Default',
            detail: (r.stacks || []).length + ' stacks',
            boardId: node.boardId || node.id,
            data: r,
          }));
        }
        const cols = data.columns || [];
        return cols.map(c => ({
          type: 'column',
          id: c.id || `col-${c.index}`,
          title: c.title,
          detail: (c.cards || []).length + ' cards',
          boardId: node.boardId || node.id,
          colIndex: c.index,
          data: c,
        }));
      } catch (e) {
        showStatus('Failed to load board', 'error');
        return [];
      }
    }

    if (node.type === 'row') {
      const stacks = (node.data && node.data.stacks) || [];
      return stacks.map(s => ({
        type: 'stack',
        id: s.id,
        title: s.title || 'Default',
        detail: (s.columns || []).length + ' columns',
        boardId: node.boardId,
        data: s,
      }));
    }

    if (node.type === 'stack') {
      const cols = (node.data && node.data.columns) || [];
      let flatCols = [];
      try {
        const data = await apiGet(`/boards/${node.boardId}/columns`);
        flatCols = data.columns || [];
      } catch (e) { /* fallback */ }

      return cols.map(c => {
        const flatMatch = flatCols.find(fc => fc.title === c.title);
        const colIndex = flatMatch ? flatMatch.index : 0;
        return {
          type: 'column',
          id: c.id || `col-${colIndex}`,
          title: c.title,
          detail: (c.cards || []).length + ' cards',
          boardId: node.boardId,
          colIndex,
          data: c,
        };
      });
    }

    if (node.type === 'column') {
      let cards = (node.data && node.data.cards) || [];
      if (cards.length === 0 && node.boardId != null && node.colIndex != null) {
        try {
          const data = await apiGet(`/boards/${node.boardId}/columns`);
          const cols = data.columns || [];
          const col = cols.find(c => c.index === node.colIndex);
          if (col) cards = col.cards || [];
        } catch (e) { /* fallback empty */ }
      }
      return cards.map(c => ({
        type: 'card',
        id: c.id,
        title: c.content.length > 100 ? c.content.substring(0, 100) + '...' : c.content,
        boardId: node.boardId,
        colIndex: node.colIndex,
        cardId: c.id,
      }));
    }

    return [];
  }

  // Reload current level (after paste, etc.)
  async function reloadCurrentLevel() {
    if (navStack.length <= 1) {
      await loadBoards();
      const level = currentLevel();
      const oldIdx = level ? level.activeIndex : 0;
      pushBoardsLevel();
      const lv = currentLevel();
      if (lv) lv.activeIndex = Math.min(oldIdx, lv.items.length - 1);
      renderLevel();
      return;
    }

    // The parent item is the one we drilled into to get the current level
    // We need to re-fetch its children
    const parentStack = navStack[navStack.length - 2];
    const parentItem = parentStack.items[parentStack.activeIndex];
    if (!parentItem) return;

    const level = currentLevel();
    const oldIdx = level ? level.activeIndex : 0;
    const children = await loadChildren(parentItem);
    if (level) {
      level.items = children || [];
      level.activeIndex = Math.min(oldIdx, level.items.length - 1);
      if (level.activeIndex < 0 && level.items.length > 0) level.activeIndex = 0;
    }
    renderLevel();
  }

  const BADGE_LABELS = {
    board: 'Board',
    row: 'Row',
    stack: 'Stack',
    column: 'Col',
    card: 'Card',
  };

  function renderLevel() {
    els.browseArea.innerHTML = '';
    const level = isSearchMode ? { items: searchResults, activeIndex: activeSearchIndex } : currentLevel();
    if (!level || level.items.length === 0) {
      els.browseArea.innerHTML = '<div class="browse-empty">No items</div>';
      return;
    }

    // Breadcrumb path
    if (!isSearchMode) {
      const crumb = document.createElement('div');
      crumb.className = 'level-breadcrumb';
      const path = '/' + navStack.slice(1).map(s => s.title).join('/');
      crumb.textContent = path;
      els.browseArea.appendChild(crumb);
    }

    level.items.forEach((node, i) => {
      const el = document.createElement('div');
      el.className = 'level-item' + (i === level.activeIndex ? ' active' : '');
      el.dataset.index = i;

      // Badge
      const badge = document.createElement('span');
      badge.className = 'item-badge badge-' + node.type;
      badge.textContent = BADGE_LABELS[node.type] || node.type;
      el.appendChild(badge);

      // Info
      const info = document.createElement('div');
      info.className = 'item-info';

      if (node.context) {
        const ctx = document.createElement('span');
        ctx.className = 'item-context';
        ctx.textContent = node.context;
        info.appendChild(ctx);
      }

      const label = document.createElement('span');
      label.className = 'item-label';
      label.textContent = node.title;
      info.appendChild(label);

      if (node.detail) {
        const detail = document.createElement('span');
        detail.className = 'item-detail';
        detail.textContent = node.detail;
        info.appendChild(detail);
      }

      el.appendChild(info);

      // Drill indicator for non-leaf items
      if (node.type !== 'card') {
        const arrow = document.createElement('span');
        arrow.className = 'level-drill';
        arrow.textContent = '\u203A';
        el.appendChild(arrow);
      }

      el.addEventListener('click', () => {
        if (isSearchMode) {
          activeSearchIndex = i;
        } else {
          level.activeIndex = i;
        }
        renderLevel();
      });

      el.addEventListener('dblclick', () => {
        if (node.type === 'card') return;
        if (isSearchMode) {
          drillFromSearch(node);
        } else {
          drillInto(node);
        }
      });

      els.browseArea.appendChild(el);
    });

    // Scroll active into view
    const activeEl = els.browseArea.querySelector('.level-item.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  // --- Search ---

  function enterSearchMode() {
    isSearchMode = true;
  }

  function exitSearchMode() {
    isSearchMode = false;
    searchResults = [];
    activeSearchIndex = -1;
    renderLevel();
  }

  async function drillFromSearch(item) {
    if (item.type === 'card') return;
    isSearchMode = false;
    searchResults = [];
    activeSearchIndex = -1;
    els.searchInput.value = '';
    // Rebuild nav stack starting from boards root
    const boardItems = boards.map(b => ({
      type: 'board', id: b.id,
      title: b.title || b.filePath.split('/').pop().replace('.md', ''),
      detail: (b.columns || []).length + ' columns',
      boardId: b.id, columns: b.columns, data: b,
    }));
    const boardIdx = Math.max(0, boardItems.findIndex(b => b.id === item.boardId));
    navStack = [{ items: boardItems, activeIndex: boardIdx, title: 'Boards' }];
    await drillInto(item);
  }

  function onSearchInput() {
    const query = els.searchInput.value.trim();
    if (!query) {
      exitSearchMode();
      return;
    }
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => performSearch(query), 300);
  }

  async function performSearch(query) {
    if (!baseUrl) return;
    const lowerQuery = query.toLowerCase();
    const results = [];

    for (const board of boards) {
      const boardName = board.title || board.filePath.split('/').pop().replace('.md', '');
      if (boardName.toLowerCase().includes(lowerQuery)) {
        results.push({
          type: 'board',
          id: board.id,
          title: boardName,
          boardId: board.id,
          columns: board.columns,
          data: board,
        });
      }
      if (board.columns) {
        for (const col of board.columns) {
          if (col.title.toLowerCase().includes(lowerQuery)) {
            results.push({
              type: 'column',
              id: `${board.id}-col-${col.index}`,
              title: col.title,
              context: boardName,
              boardId: board.id,
              colIndex: col.index,
              data: col,
            });
          }
        }
      }
    }

    try {
      const data = await apiGet(`/search?q=${encodeURIComponent(query)}`);
      if (data.results) {
        for (const r of data.results) {
          results.push({
            type: 'card',
            id: r.cardId,
            title: r.cardContent.length > 100 ? r.cardContent.substring(0, 100) + '...' : r.cardContent,
            context: r.boardTitle + ' / ' + r.columnTitle,
            boardId: r.boardId,
            colIndex: r.columnIndex,
            cardId: r.cardId,
          });
        }
      }
    } catch (e) {
      log('Search API error:', e);
    }

    searchResults = results;
    activeSearchIndex = results.length > 0 ? 0 : -1;
    enterSearchMode();
    renderLevel();
  }

  // --- Strip / Expand ---

  function updateSnapSide(side) {
    if (side === 'left') {
      document.body.classList.add('snap-left');
    } else {
      document.body.classList.remove('snap-left');
    }
  }

  function expandPanel() {
    if (isExpanded) return;
    isExpanded = true;
    document.body.classList.remove('strip-mode');
    document.body.classList.add('expanded-mode');
    tauriInvoke('expand_capture').then(updateSnapSide).catch(log);
    loadClipboardSummary();
    if (els.searchInput) els.searchInput.focus();
  }

  function collapseToStrip() {
    if (!isExpanded) return;
    isExpanded = false;
    document.body.classList.remove('expanded-mode');
    document.body.classList.add('strip-mode');
    tauriInvoke('collapse_capture').then(updateSnapSide).catch(log);
    if (els.searchInput) els.searchInput.value = '';
    if (isSearchMode) exitSearchMode();
  }

  // --- Paste ---

  async function pasteIntoSelected() {
    const level = isSearchMode
      ? { items: searchResults, activeIndex: activeSearchIndex }
      : currentLevel();
    if (!level || level.activeIndex < 0 || level.activeIndex >= level.items.length) return;
    const target = level.items[level.activeIndex];

    let content = '';
    let boardIdForUpload = target.boardId;

    // Try image first
    try {
      const imgResult = await tauriInvoke('read_clipboard_image');
      if (imgResult && imgResult.data) {
        const byteString = atob(imgResult.data);
        const bytes = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) {
          bytes[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'image/png' });
        const file = new File([blob], imgResult.filename || 'clipboard.png', { type: 'image/png' });
        const result = await apiUpload(`/boards/${boardIdForUpload}/media`, file);
        content = `![${file.name}](${result.path})`;
      }
    } catch (e) { /* no image */ }

    if (!content) {
      try {
        const text = await tauriInvoke('read_clipboard');
        if (text && text.trim()) {
          content = isUrl(text.trim()) ? formatAsMarkdownLink(text.trim()) : text;
        }
      } catch (e) { /* no text */ }
    }

    if (!content) {
      showStatus('Clipboard is empty', 'error');
      return;
    }

    try {
      if (target.type === 'card' && target.cardId) {
        await apiPost(`/boards/${target.boardId}/cards/${target.cardId}/append`, { content });
        showStatus('Appended to card', 'success');
      } else if (target.type === 'column') {
        await apiPost(`/boards/${target.boardId}/columns/${target.colIndex}/cards`, { content });
        showStatus('Card added to column', 'success');
      } else if (target.type === 'board') {
        const colIndex = (target.columns && target.columns.length > 0) ? target.columns[0].index : 0;
        await apiPost(`/boards/${target.boardId}/columns/${colIndex}/cards`, { content });
        showStatus('Card added to board', 'success');
      } else if (target.type === 'row' || target.type === 'stack') {
        let colIndex = 0;
        if (target.type === 'row' && target.data) {
          const stacks = target.data.stacks || [];
          if (stacks.length > 0 && stacks[0].columns && stacks[0].columns.length > 0) {
            try {
              const data = await apiGet(`/boards/${target.boardId}/columns`);
              const flatCols = data.columns || [];
              const firstColTitle = stacks[0].columns[0].title;
              const match = flatCols.find(fc => fc.title === firstColTitle);
              if (match) colIndex = match.index;
            } catch (e) { /* use 0 */ }
          }
        } else if (target.type === 'stack' && target.data) {
          const cols = target.data.columns || [];
          if (cols.length > 0) {
            try {
              const data = await apiGet(`/boards/${target.boardId}/columns`);
              const flatCols = data.columns || [];
              const match = flatCols.find(fc => fc.title === cols[0].title);
              if (match) colIndex = match.index;
            } catch (e) { /* use 0 */ }
          }
        }
        await apiPost(`/boards/${target.boardId}/columns/${colIndex}/cards`, { content });
        showStatus('Card added', 'success');
      }

      // Reload current level to show the new item immediately
      await reloadCurrentLevel();
      await loadClipboardSummary();
    } catch (e) {
      showStatus(`Failed: ${e.message}`, 'error');
    }
  }

  // --- Event Listeners ---

  let stripDragging = false;
  let dragEndTime = 0;

  function setupEventListeners() {
    // Icon: drag handle — invoke Tauri's native window drag
    els.stripIcon.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      stripDragging = true;
      tauriInvoke('plugin:window|start_dragging').catch(log);
    });
    els.stripIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });

    function finishDrag() {
      if (!stripDragging) return;
      stripDragging = false;
      dragEndTime = Date.now();
      tauriInvoke('snap_strip_after_drag').then(updateSnapSide).catch(log);
    }

    // Snap after drag ends — mouseup may or may not fire after OS-level drag
    document.addEventListener('mouseup', finishDrag);

    // Fallback: detect drag end via move events stopping (macOS doesn't fire mouseup after OS drag)
    let moveDragDebounce = null;
    tauriListen('tauri://move', () => {
      if (!stripDragging) return;
      clearTimeout(moveDragDebounce);
      moveDragDebounce = setTimeout(finishDrag, 500);
    }).catch(log);

    els.stripView.addEventListener('click', () => {
      if (Date.now() - dragEndTime < 500) return;
      expandPanel();
    });

    els.stripView.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.stripView.classList.add('drag-over');
    });
    els.stripView.addEventListener('dragleave', () => {
      els.stripView.classList.remove('drag-over');
    });
    els.stripView.addEventListener('drop', (e) => {
      e.preventDefault();
      els.stripView.classList.remove('drag-over');
      expandPanel();
    });

    els.btnCollapse.addEventListener('click', () => collapseToStrip());

    els.searchInput.addEventListener('input', onSearchInput);

    window.addEventListener('focus', () => {
      loadClipboardSummary().catch(log);
      if (isExpanded && els.searchInput) els.searchInput.focus();
      // Always sync the snap side on focus (catches any missed drag snaps)
      if (!isExpanded) {
        tauriInvoke('snap_strip_after_drag').then(updateSnapSide).catch(log);
      }
    });

    window.addEventListener('blur', () => {
      if (isExpanded && !stripDragging) collapseToStrip();
    });

    tauriListen('capture-expanded', () => {
      expandPanel();
    }).catch(log);

    document.addEventListener('keydown', (e) => {
      const level = isSearchMode
        ? { items: searchResults, activeIndex: activeSearchIndex }
        : currentLevel();

      if (e.key === 'Escape') {
        e.preventDefault();
        if (isSearchMode) {
          els.searchInput.value = '';
          exitSearchMode();
          return;
        }
        collapseToStrip();
        return;
      }

      if (e.key === 'Tab' && isExpanded) {
        e.preventDefault();
        if (document.activeElement === els.searchInput) {
          els.searchInput.blur();
        } else {
          els.searchInput.focus();
        }
        return;
      }

      if (!isExpanded) return;

      // Arrow navigation
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (document.activeElement === els.searchInput && !els.searchInput.value.trim()) {
          els.searchInput.blur();
        }
        if (document.activeElement === els.searchInput && els.searchInput.value.trim()) {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
        }
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!level || level.items.length === 0) return;
        const maxIdx = level.items.length - 1;
        const newIdx = Math.min((level.activeIndex < 0 ? -1 : level.activeIndex) + 1, maxIdx);
        if (isSearchMode) {
          activeSearchIndex = newIdx;
        } else {
          level.activeIndex = newIdx;
        }
        renderLevel();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!level || level.items.length === 0) return;
        const newIdx = Math.max((level.activeIndex < 0 ? 1 : level.activeIndex) - 1, 0);
        if (isSearchMode) {
          activeSearchIndex = newIdx;
        } else {
          level.activeIndex = newIdx;
        }
        renderLevel();
        return;
      }

      // Right arrow: drill into selected item
      if (e.key === 'ArrowRight') {
        if (document.activeElement === els.searchInput && els.searchInput.value.trim()) return;
        e.preventDefault();
        if (!level || level.activeIndex < 0 || level.activeIndex >= level.items.length) return;
        const node = level.items[level.activeIndex];
        if (node.type === 'card') return;
        if (isSearchMode) {
          drillFromSearch(node);
        } else {
          drillInto(node);
        }
        return;
      }

      // Left arrow: go up one level
      if (e.key === 'ArrowLeft' && !isSearchMode) {
        e.preventDefault();
        goUp();
        return;
      }

      // Enter: drill into (non-card)
      if (e.key === 'Enter') {
        if (document.activeElement === els.searchInput && els.searchInput.value.trim()) {
          return;
        }
        e.preventDefault();
        if (!level || level.activeIndex < 0 || level.activeIndex >= level.items.length) return;
        const node = level.items[level.activeIndex];
        if (node.type === 'card') return;
        if (isSearchMode) {
          drillFromSearch(node);
        } else {
          drillInto(node);
        }
        return;
      }

      // Cmd+V / Ctrl+V: paste into selected
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        if (level && level.activeIndex >= 0 && level.activeIndex < level.items.length) {
          e.preventDefault();
          pasteIntoSelected();
          return;
        }
      }

      // Printable character: focus search input
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && document.activeElement !== els.searchInput) {
        els.searchInput.focus();
      }
    });
  }

  // --- URL helpers ---

  function isUrl(text) {
    return /^https?:\/\/\S+$/i.test(text.trim());
  }

  function formatAsMarkdownLink(url) {
    try {
      const parsed = new URL(url.trim());
      return `[${parsed.hostname}](${url.trim()})`;
    } catch (e) {
      return url.trim();
    }
  }

  // --- Helpers ---

  function log() {
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      const args = Array.prototype.slice.call(arguments || []);
      args.unshift('[quick-capture]');
      console.log.apply(console, args);
    }
  }

  function showStatus(msg, type) {
    els.statusMsg.textContent = msg;
    els.statusMsg.className = 'status-msg ' + type;
    els.statusMsg.classList.remove('hidden');
    if (type === 'success') {
      setTimeout(() => els.statusMsg.classList.add('hidden'), 3000);
    }
  }

  function syncModeFromWindowSize() {
    const shouldBeExpanded = window.innerWidth > STRIP_WIDTH_THRESHOLD;
    if (shouldBeExpanded && !isExpanded) {
      isExpanded = true;
      document.body.classList.remove('strip-mode');
      document.body.classList.add('expanded-mode');
      if (els.searchInput) {
        setTimeout(function () {
          els.searchInput.focus();
        }, 0);
      }
      return;
    }
    if (!shouldBeExpanded && isExpanded) {
      isExpanded = false;
      document.body.classList.remove('expanded-mode');
      document.body.classList.add('strip-mode');
    }
  }

  // --- Start ---
  init();
})();
