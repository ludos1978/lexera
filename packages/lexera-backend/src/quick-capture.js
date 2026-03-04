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

  // Browse state: tree navigation through boards → rows → stacks → columns → cards
  let browseState = {
    path: [],       // [{type, id, title, data}] — breadcrumb trail
    items: [],      // current level items
    activeIndex: 0, // highlighted item
  };

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

  async function init() {
    baseUrl = await discoverBackend();
    if (!baseUrl) {
      showStatus('Cannot connect to Lexera Backend', 'error');
      return;
    }

    await loadClipboardPreview();
    await loadBoards();
    showBoardList();

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

  async function loadClipboardPreview() {
    els.clipboardPreview.innerHTML = '';

    // Try image first
    try {
      const imgResult = await window.__TAURI_INTERNALS__.invoke('read_clipboard_image');
      if (imgResult && imgResult.data) {
        const img = document.createElement('img');
        img.className = 'preview-image';
        img.src = 'data:image/png;base64,' + imgResult.data;
        els.clipboardPreview.appendChild(img);
        return;
      }
    } catch (e) { /* no image */ }

    // Try text
    try {
      const text = await window.__TAURI_INTERNALS__.invoke('read_clipboard');
      if (text && text.trim()) {
        if (isUrl(text.trim())) {
          const wrapper = document.createElement('div');
          wrapper.className = 'preview-url';
          const domain = document.createElement('span');
          domain.className = 'url-domain';
          try {
            domain.textContent = new URL(text.trim()).hostname;
          } catch {
            domain.textContent = 'link';
          }
          wrapper.appendChild(domain);
          const link = document.createElement('span');
          link.textContent = text.trim().length > 120 ? text.trim().substring(0, 120) + '...' : text.trim();
          wrapper.appendChild(link);
          els.clipboardPreview.appendChild(wrapper);
        } else {
          const pre = document.createElement('div');
          pre.className = 'preview-text';
          pre.textContent = text.length > 200 ? text.substring(0, 200) + '...' : text;
          els.clipboardPreview.appendChild(pre);
        }
        return;
      }
    } catch (e) { /* no text */ }

    els.clipboardPreview.innerHTML = '<div class="clipboard-empty">No clipboard content</div>';
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

  // --- Tree Navigation ---

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
    if (browseState.path.length === 0) return;
    const prev = browseState.path.pop();
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
    root.textContent = 'Boards';
    root.addEventListener('click', () => {
      browseState.path = [];
      showBoardList();
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

      // Show arrow for drillable items
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
