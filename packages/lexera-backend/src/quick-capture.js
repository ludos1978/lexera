/**
 * Quick Capture V2 — clipboard preview + tree navigation + search + paste.
 *
 * Layout: clipboard preview → search input → breadcrumb → browse/results area.
 * Navigation: Down/Up to move in list, Right/Enter to drill in, Left/Backspace to go back.
 * Paste: Cmd+V / Ctrl+V pastes clipboard into selected target.
 */
(function () {
  'use strict';

  let baseUrl = '';
  let boards = [];
  let workspaces = [];
  let defaultWorkspaceId = null;

  // Browse state: tree navigation through boards → rows → stacks → columns → cards
  let browseState = {
    path: [],       // [{type, id, title, data}] — breadcrumb trail
    items: [],      // current level items
    activeIndex: 0, // highlighted item
  };

  // Clipboard state
  let clipboardData = { type: 'empty', summary: '', isPassword: false, fullHtml: '' };
  let clipboardExpanded = false;

  let isSearchMode = false;
  let searchResults = [];
  let activeSearchIndex = -1;
  let searchDebounceTimer = null;

  const els = {
    clipboardPreview: document.getElementById('clipboard-preview'),
    searchInput: document.getElementById('search-input'),
    browsePath: document.getElementById('browse-path'),
    browseArea: document.getElementById('browse-area'),
    btnSnapLeft: document.getElementById('btn-snap-left'),
    btnSnapRight: document.getElementById('btn-snap-right'),
    statusMsg: document.getElementById('status-msg'),
  };

  // --- Init ---

  // Apply theme immediately from localStorage to avoid flash of wrong theme
  if (typeof applyLexeraTheme === 'function') {
    applyLexeraTheme(localStorage.getItem('lexera-theme') || 'lexera');
  }

  async function init() {
    baseUrl = await discoverBackend();
    if (!baseUrl) {
      showStatus('Cannot connect to Lexera Backend', 'error');
      return;
    }

    // Load theme from backend (may override localStorage)
    try {
      const themeRes = await fetch(baseUrl + '/config/theme');
      if (themeRes.ok) {
        const themeData = await themeRes.json();
        if (themeData.theme && typeof applyLexeraTheme === 'function') {
          applyLexeraTheme(themeData.theme);
        }
      }
    } catch (e) { /* keep localStorage theme */ }

    await loadClipboardPreview();
    await loadBoards();
    await loadWorkspaces();

    // Start at default workspace's boards, or workspace list if multiple exist
    if (defaultWorkspaceId) {
      showBoardsForWorkspace(defaultWorkspaceId);
    } else if (workspaces.length > 0) {
      showWorkspaceList();
    } else {
      showBoardList();
    }

    // Restore snap position
    const savedSnap = localStorage.getItem('lexera-qc-snap');
    if (savedSnap) {
      window.__TAURI_INTERNALS__.invoke('snap_capture_window', { side: savedSnap }).catch(() => {});
    }

    setupEventListeners();
  }

  async function discoverBackend() {
    try {
      if (window.__TAURI_INTERNALS__) {
        const url = await window.__TAURI_INTERNALS__.invoke('get_backend_url');
        if (url) {
          const res = await fetch(url + '/status', { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'running') return url;
          }
        }
      }
    } catch (e) { /* fall through */ }

    const ports = [13080, 12080, 14080, 11080, 15080];
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

  // --- Clipboard Preview ---

  /**
   * Detect if text looks like a password or secret token.
   * Checks: no whitespace, length 6-128, Shannon entropy > 3.5, at least 2 character classes.
   */
  function looksLikePassword(text) {
    const t = text.trim();
    if (t.length < 6 || t.length > 128) return false;
    if (/\s/.test(t)) return false;
    // Known hash/token prefixes
    if (/^(\$2[ab]\$|\$argon2|ghp_|gho_|Bearer\s)/i.test(t)) return true;
    // Shannon entropy
    const freq = {};
    for (const ch of t) freq[ch] = (freq[ch] || 0) + 1;
    let entropy = 0;
    const len = t.length;
    for (const ch in freq) {
      const p = freq[ch] / len;
      entropy -= p * Math.log2(p);
    }
    if (entropy <= 3.5) return false;
    // At least 2 character classes
    let classes = 0;
    if (/[a-z]/.test(t)) classes++;
    if (/[A-Z]/.test(t)) classes++;
    if (/[0-9]/.test(t)) classes++;
    if (/[^a-zA-Z0-9]/.test(t)) classes++;
    return classes >= 2;
  }

  function buildFullPreviewHtml(data) {
    if (data.type === 'image') return data.fullHtml;
    if (data.type === 'url') return data.fullHtml;
    if (data.type === 'text') return data.fullHtml;
    return '<div class="clipboard-empty">No clipboard content</div>';
  }

  function renderClipboardPreview() {
    els.clipboardPreview.innerHTML = '';

    if (clipboardData.type === 'empty') {
      els.clipboardPreview.innerHTML = '<div class="clipboard-empty">No clipboard content</div>';
      els.clipboardPreview.classList.remove('clipboard-expanded');
      return;
    }

    // Collapsed summary bar (always shown)
    const summary = document.createElement('div');
    summary.className = 'clipboard-summary';
    summary.addEventListener('click', (e) => {
      e.stopPropagation();
      clipboardExpanded = !clipboardExpanded;
      renderClipboardPreview();
    });

    const chevron = document.createElement('span');
    chevron.className = 'clipboard-toggle';
    chevron.textContent = clipboardExpanded ? '▾' : '▸';
    summary.appendChild(chevron);

    const label = document.createElement('span');
    label.className = 'clipboard-summary-text' + (clipboardData.isPassword ? ' clipboard-password-warning' : '');
    label.textContent = clipboardData.summary;
    summary.appendChild(label);

    els.clipboardPreview.appendChild(summary);

    if (clipboardExpanded) {
      els.clipboardPreview.classList.add('clipboard-expanded');
      if (clipboardData.isPassword) {
        const warning = document.createElement('div');
        warning.className = 'clipboard-password-notice';
        warning.textContent = 'Content hidden — may contain sensitive data';
        els.clipboardPreview.appendChild(warning);
      } else {
        const content = document.createElement('div');
        content.className = 'clipboard-full-content';
        content.innerHTML = clipboardData.fullHtml;
        els.clipboardPreview.appendChild(content);
      }
    } else {
      els.clipboardPreview.classList.remove('clipboard-expanded');
    }
  }

  async function loadClipboardPreview() {
    clipboardData = { type: 'empty', summary: '', isPassword: false, fullHtml: '' };
    clipboardExpanded = false;

    // Try image first
    try {
      const imgResult = await window.__TAURI_INTERNALS__.invoke('read_clipboard_image');
      if (imgResult && imgResult.data) {
        clipboardData = {
          type: 'image',
          summary: 'Image (clipboard)',
          isPassword: false,
          fullHtml: '<img class="preview-image" src="data:image/png;base64,' + imgResult.data + '">',
        };
        renderClipboardPreview();
        return;
      }
    } catch (e) { /* no image */ }

    // Try text
    try {
      const text = await window.__TAURI_INTERNALS__.invoke('read_clipboard');
      if (text && text.trim()) {
        const trimmed = text.trim();
        if (looksLikePassword(trimmed)) {
          clipboardData = {
            type: 'text',
            summary: 'Sensitive content (hidden)',
            isPassword: true,
            fullHtml: '',
          };
        } else if (isUrl(trimmed)) {
          let hostname = 'link';
          try { hostname = new URL(trimmed).hostname; } catch {}
          const display = trimmed.length > 120 ? trimmed.substring(0, 120) + '...' : trimmed;
          clipboardData = {
            type: 'url',
            summary: hostname,
            isPassword: false,
            fullHtml: '<div class="preview-url"><span class="url-domain">' + escapeHtml(hostname) +
              '</span><span>' + escapeHtml(display) + '</span></div>',
          };
        } else {
          const firstLine = text.split('\n')[0].trim();
          const summary = firstLine.length > 60 ? firstLine.substring(0, 60) + '...' : firstLine;
          const display = text.length > 200 ? text.substring(0, 200) + '...' : text;
          clipboardData = {
            type: 'text',
            summary: summary,
            isPassword: false,
            fullHtml: '<div class="preview-text">' + escapeHtml(display) + '</div>',
          };
        }
        renderClipboardPreview();
        return;
      }
    } catch (e) { /* no text */ }

    renderClipboardPreview();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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

  async function loadWorkspaces() {
    try {
      const data = await apiGet('/config/workspaces');
      workspaces = data.workspaces || [];
      defaultWorkspaceId = data.default_workspace || null;
    } catch (e) {
      workspaces = [];
      defaultWorkspaceId = null;
    }
  }

  // --- Tree Navigation ---

  function showWorkspaceList() {
    browseState.path = [];
    const items = [];

    for (const ws of workspaces) {
      const count = boards.filter(b => b.workspace_id === ws.id).length;
      items.push({
        type: 'workspace',
        id: ws.id,
        title: ws.name,
        detail: count + ' boards',
        workspaceId: ws.id,
      });
    }

    // "Unassigned" workspace for boards without workspace_id
    const unassigned = boards.filter(b => !b.workspace_id);
    if (unassigned.length > 0) {
      items.push({
        type: 'workspace',
        id: '__unassigned__',
        title: 'Unassigned',
        detail: unassigned.length + ' boards',
        workspaceId: null,
      });
    }

    browseState.items = items;
    browseState.activeIndex = 0;
    renderBrowse();
  }

  function showBoardsForWorkspace(workspaceId) {
    const filtered = workspaceId === '__unassigned__' || workspaceId === null
      ? boards.filter(b => !b.workspace_id)
      : boards.filter(b => b.workspace_id === workspaceId);

    browseState.path = [];

    // If coming from a workspace, push it to path so goBack returns to workspace list
    const ws = workspaces.find(w => w.id === workspaceId);
    if (ws || workspaceId === '__unassigned__') {
      browseState.path.push({
        type: 'workspace',
        id: workspaceId,
        title: ws ? ws.name : 'Unassigned',
        items: browseState.items.length > 0 ? browseState.items : [],
        activeIndex: browseState.activeIndex,
      });
    }

    browseState.items = filtered.map(b => ({
      type: 'board',
      id: b.id,
      title: b.title || b.filePath.split('/').pop().replace('.md', ''),
      detail: (b.columns || []).length + ' columns',
      boardId: b.id,
      columns: b.columns,
    }));
    browseState.activeIndex = 0;
    renderBrowse();
  }

  function showBoardList() {
    browseState.path = [];
    browseState.items = boards.map(b => ({
      type: 'board',
      id: b.id,
      title: b.title || b.filePath.split('/').pop().replace('.md', ''),
      detail: (b.columns || []).length + ' columns',
      boardId: b.id,
      columns: b.columns,
    }));
    browseState.activeIndex = 0;
    renderBrowse();
  }

  async function drillInto(item) {
    if (item.type === 'card') return; // can't drill into a card

    if (item.type === 'workspace') {
      showBoardsForWorkspace(item.workspaceId || item.id);
      return;
    }

    browseState.path.push({
      type: item.type,
      id: item.id,
      title: item.title,
      items: browseState.items, // save current items for going back
      activeIndex: browseState.activeIndex,
    });

    if (item.type === 'board') {
      try {
        const data = await apiGet(`/boards/${item.id}/columns`);
        const fullBoard = data.fullBoard;
        if (fullBoard && fullBoard.rows && fullBoard.rows.length > 0) {
          // Hierarchical board: show rows
          browseState.items = fullBoard.rows.map(r => ({
            type: 'row',
            id: r.id,
            title: r.title || 'Default',
            detail: (r.stacks || []).length + ' stacks',
            boardId: item.id,
            data: r,
          }));
        } else {
          // Flat board: show columns directly
          const cols = data.columns || [];
          browseState.items = cols.map(c => ({
            type: 'column',
            id: c.id || `col-${c.index}`,
            title: c.title,
            detail: (c.cards || []).length + ' cards',
            boardId: item.id,
            colIndex: c.index,
            data: c,
          }));
        }
      } catch (e) {
        showStatus('Failed to load board', 'error');
        goBack();
        return;
      }
    } else if (item.type === 'row') {
      const stacks = item.data.stacks || [];
      browseState.items = stacks.map(s => ({
        type: 'stack',
        id: s.id,
        title: s.title || 'Default',
        detail: (s.columns || []).length + ' columns',
        boardId: item.boardId,
        data: s,
      }));
    } else if (item.type === 'stack') {
      const cols = item.data.columns || [];
      // Need flat column index — re-fetch from the board columns list
      let flatCols = [];
      try {
        const data = await apiGet(`/boards/${item.boardId}/columns`);
        flatCols = data.columns || [];
      } catch (e) { /* fallback below */ }

      browseState.items = cols.map(c => {
        // Find flat index by matching column id or title
        const flatMatch = flatCols.find(fc => fc.title === c.title);
        const colIndex = flatMatch ? flatMatch.index : 0;
        return {
          type: 'column',
          id: c.id || `col-${colIndex}`,
          title: c.title,
          detail: (c.cards || []).length + ' cards',
          boardId: item.boardId,
          colIndex,
          data: c,
        };
      });
    } else if (item.type === 'column') {
      const cards = item.data.cards || [];
      browseState.items = cards.map(c => ({
        type: 'card',
        id: c.id,
        title: c.content.length > 100 ? c.content.substring(0, 100) + '...' : c.content,
        boardId: item.boardId,
        colIndex: item.colIndex,
        cardId: c.id,
      }));
    }

    browseState.activeIndex = 0;
    renderBrowse();
  }

  function goBack() {
    if (browseState.path.length === 0) {
      // At root level: if workspaces exist, show workspace list
      if (workspaces.length > 0) {
        showWorkspaceList();
      }
      return;
    }
    const prev = browseState.path.pop();
    if (prev.type === 'workspace') {
      // Going back from workspace's boards → show workspace list
      showWorkspaceList();
      return;
    }
    browseState.items = prev.items;
    browseState.activeIndex = prev.activeIndex;
    renderBrowse();
  }

  // --- Rendering ---

  function renderBrowse() {
    renderBreadcrumb();
    renderBrowseItems();
  }

  function renderBreadcrumb() {
    els.browsePath.innerHTML = '';
    // Root
    const root = document.createElement('span');
    root.className = 'path-segment';
    root.textContent = workspaces.length > 0 ? 'Workspaces' : 'Boards';
    root.addEventListener('click', () => {
      if (workspaces.length > 0) {
        showWorkspaceList();
      } else {
        browseState.path = [];
        showBoardList();
      }
    });
    els.browsePath.appendChild(root);

    for (let i = 0; i < browseState.path.length; i++) {
      const sep = document.createElement('span');
      sep.className = 'path-separator';
      sep.textContent = ' › ';
      els.browsePath.appendChild(sep);

      const seg = document.createElement('span');
      seg.className = 'path-segment';
      seg.textContent = browseState.path[i].title;
      const idx = i;
      seg.addEventListener('click', () => {
        // Navigate to this level
        while (browseState.path.length > idx + 1) {
          const popped = browseState.path.pop();
          // restore items from the level we're navigating to
          if (browseState.path.length === idx + 1) {
            // We need to drill into this item again... but we have saved items
          }
        }
        // Actually, let's just navigate to the level after this segment
        const target = browseState.path[idx];
        browseState.path.length = idx;
        browseState.items = target.items;
        browseState.activeIndex = target.activeIndex;
        // Now drill into the target
        const item = browseState.items[target.activeIndex];
        if (item) {
          drillInto(item);
        }
      });
      els.browsePath.appendChild(seg);
    }
  }

  const BADGE_LABELS = {
    workspace: 'WS',
    board: 'Board',
    row: 'Row',
    stack: 'Stack',
    column: 'Col',
    card: 'Card',
  };

  function renderBrowseItems() {
    els.browseArea.innerHTML = '';
    const items = isSearchMode ? searchResults : browseState.items;
    const activeIdx = isSearchMode ? activeSearchIndex : browseState.activeIndex;

    if (items.length === 0) {
      els.browseArea.innerHTML = '<div class="browse-empty">No items</div>';
      return;
    }

    items.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'browse-item' + (i === activeIdx ? ' active' : '');
      el.dataset.index = i;

      const badge = document.createElement('span');
      badge.className = 'item-badge badge-' + item.type;
      badge.textContent = BADGE_LABELS[item.type] || item.type;
      el.appendChild(badge);

      const info = document.createElement('div');
      info.className = 'item-info';

      if (item.context) {
        const ctx = document.createElement('span');
        ctx.className = 'item-context';
        ctx.textContent = item.context;
        info.appendChild(ctx);
      }

      const label = document.createElement('span');
      label.className = 'item-label';
      label.textContent = item.title;
      info.appendChild(label);

      if (item.detail) {
        const detail = document.createElement('span');
        detail.className = 'item-detail';
        detail.textContent = item.detail;
        info.appendChild(detail);
      }

      el.appendChild(info);

      // Show arrow for drillable items (everything except cards)
      if (item.type !== 'card') {
        const arrow = document.createElement('span');
        arrow.className = 'item-arrow';
        arrow.textContent = '▸';
        el.appendChild(arrow);
      }

      el.addEventListener('click', () => {
        if (isSearchMode) {
          activeSearchIndex = i;
          renderBrowseItems();
        } else {
          browseState.activeIndex = i;
          renderBrowseItems();
        }
      });

      el.addEventListener('dblclick', () => {
        if (isSearchMode) return;
        browseState.activeIndex = i;
        if (item.type !== 'card') {
          drillInto(item);
        }
      });

      els.browseArea.appendChild(el);
    });

    // Scroll active into view
    const activeEl = els.browseArea.querySelector('.browse-item.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  // --- Search ---

  function enterSearchMode() {
    isSearchMode = true;
    els.browsePath.classList.add('hidden');
  }

  function exitSearchMode() {
    isSearchMode = false;
    searchResults = [];
    activeSearchIndex = -1;
    els.browsePath.classList.remove('hidden');
    renderBrowse();
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

    // Client-side: boards and columns
    for (const board of boards) {
      const boardName = board.title || board.filePath.split('/').pop().replace('.md', '');
      if (boardName.toLowerCase().includes(lowerQuery)) {
        results.push({
          type: 'board',
          id: board.id,
          title: boardName,
          boardId: board.id,
          colIndex: 0,
          columns: board.columns,
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
            });
          }
        }
      }
    }

    // Server-side: cards
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
      console.warn('Search API error:', e);
    }

    searchResults = results;
    activeSearchIndex = results.length > 0 ? 0 : -1;
    enterSearchMode();
    renderBrowseItems();
  }

  // --- Paste ---

  async function pasteIntoSelected() {
    const items = isSearchMode ? searchResults : browseState.items;
    const idx = isSearchMode ? activeSearchIndex : browseState.activeIndex;
    if (idx < 0 || idx >= items.length) return;
    const target = items[idx];

    // Read clipboard content
    let content = '';
    let boardIdForUpload = target.boardId;

    // Try image first
    try {
      const imgResult = await window.__TAURI_INTERNALS__.invoke('read_clipboard_image');
      if (imgResult && imgResult.data) {
        // Upload the image
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

    // If no image, try text
    if (!content) {
      try {
        const text = await window.__TAURI_INTERNALS__.invoke('read_clipboard');
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
        // Use first column (incoming/park behavior)
        const colIndex = (target.columns && target.columns.length > 0) ? target.columns[0].index : 0;
        await apiPost(`/boards/${target.boardId}/columns/${colIndex}/cards`, { content });
        showStatus('Card added to board', 'success');
      } else if (target.type === 'row' || target.type === 'stack') {
        // For row/stack: find first column inside
        let colIndex = 0;
        if (target.type === 'row' && target.data) {
          const stacks = target.data.stacks || [];
          if (stacks.length > 0 && stacks[0].columns && stacks[0].columns.length > 0) {
            // Need flat index — fetch columns
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
      setTimeout(() => closeWindow(), 600);
    } catch (e) {
      showStatus(`Failed: ${e.message}`, 'error');
    }
  }

  // --- Event Listeners ---

  function setupEventListeners() {
    els.btnSnapLeft.addEventListener('click', () => snapTo('left'));
    els.btnSnapRight.addEventListener('click', () => snapTo('right'));
    els.searchInput.addEventListener('input', onSearchInput);

    // Focus search input when window receives focus (Cmd+B)
    window.addEventListener('focus', () => {
      els.searchInput.focus();
    });

    document.addEventListener('keydown', (e) => {
      const items = isSearchMode ? searchResults : browseState.items;
      const activeIdx = isSearchMode ? activeSearchIndex : browseState.activeIndex;

      // Escape handling
      if (e.key === 'Escape') {
        if (isSearchMode) {
          els.searchInput.value = '';
          exitSearchMode();
          return;
        }
        if (browseState.path.length > 0) {
          goBack();
          return;
        }
        closeWindow();
        return;
      }

      // Arrow navigation
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (isSearchMode) {
          activeSearchIndex = Math.min(activeSearchIndex + 1, searchResults.length - 1);
        } else {
          browseState.activeIndex = Math.min(browseState.activeIndex + 1, browseState.items.length - 1);
        }
        renderBrowseItems();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (isSearchMode) {
          activeSearchIndex = Math.max(activeSearchIndex - 1, 0);
        } else {
          browseState.activeIndex = Math.max(browseState.activeIndex - 1, 0);
        }
        renderBrowseItems();
        return;
      }

      // Right arrow / Enter: drill into
      if ((e.key === 'ArrowRight' || e.key === 'Enter') && !isSearchMode) {
        if (e.key === 'Enter' && document.activeElement === els.searchInput && els.searchInput.value.trim()) {
          return; // let search handle it
        }
        e.preventDefault();
        if (activeIdx >= 0 && activeIdx < items.length) {
          const item = items[activeIdx];
          if (item.type !== 'card') {
            drillInto(item);
          }
        }
        return;
      }

      // Left arrow / Backspace (when not typing): go back
      if (e.key === 'ArrowLeft' && !isSearchMode) {
        if (document.activeElement === els.searchInput) return;
        e.preventDefault();
        goBack();
        return;
      }

      if (e.key === 'Backspace' && !isSearchMode && document.activeElement !== els.searchInput) {
        e.preventDefault();
        goBack();
        return;
      }

      // Cmd+V / Ctrl+V: paste into selected
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        if (activeIdx >= 0 && activeIdx < items.length) {
          e.preventDefault();
          pasteIntoSelected();
          return;
        }
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
    } catch {
      return url.trim();
    }
  }

  // --- Helpers ---

  function showStatus(msg, type) {
    els.statusMsg.textContent = msg;
    els.statusMsg.className = 'status-msg ' + type;
    els.statusMsg.classList.remove('hidden');
    if (type === 'success') {
      setTimeout(() => els.statusMsg.classList.add('hidden'), 3000);
    }
  }

  function snapTo(side) {
    localStorage.setItem('lexera-qc-snap', side);
    window.__TAURI_INTERNALS__.invoke('snap_capture_window', { side }).catch((e) => {
      console.warn('Failed to snap window:', e);
    });
  }

  function closeWindow() {
    window.__TAURI_INTERNALS__.invoke('close_capture');
  }

  // --- Start ---
  init();
})();
