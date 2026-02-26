/**
 * Quick Capture — popup for clipboard history + file drop capture into kanban boards.
 * Shows clipboard history entries. User selects entries to send to a board.
 */
(function () {
  'use strict';

  let baseUrl = '';
  let boards = [];
  let droppedFiles = [];
  let selectedEntryIds = new Set();

  const els = {
    historyList: document.getElementById('history-list'),
    dropZone: document.getElementById('drop-zone'),
    dropLabel: document.getElementById('drop-label'),
    filePreview: document.getElementById('file-preview'),
    boardSelect: document.getElementById('board-select'),
    columnSelect: document.getElementById('column-select'),
    btnSend: document.getElementById('btn-send'),
    btnCancel: document.getElementById('btn-cancel'),
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

    await loadClipboardHistory();
    await loadBoards();

    // Restore saved board/column, fall back to server-configured incoming
    const savedBoard = localStorage.getItem('lexera-qc-board');
    const savedColumn = localStorage.getItem('lexera-qc-column');
    if (savedBoard) {
      selectDefault(savedBoard, savedColumn !== null ? parseInt(savedColumn, 10) : undefined);
    } else {
      try {
        const status = await apiGet('/status');
        if (status.incoming) {
          selectDefault(status.incoming.board_id, status.incoming.column);
        }
      } catch (e) {
        // No defaults configured
      }
    }

    // Restore snap position
    const savedSnap = localStorage.getItem('lexera-qc-snap');
    if (savedSnap) {
      window.__TAURI_INTERNALS__.invoke('snap_capture_window', { side: savedSnap }).catch(() => {});
    }

    updateSendButton();
    setupEventListeners();
  }

  async function discoverBackend() {
    // Try Tauri command first (reads shared config)
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

    // Fallback: port scanning
    const ports = [8083, 8080, 8081, 8082, 9080];
    for (const port of ports) {
      try {
        const res = await fetch(`http://localhost:${port}/status`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'running' && data.port) {
            return `http://localhost:${data.port}`;
          }
        }
      } catch (e) {
        // Try next port
      }
    }
    return null;
  }

  // --- Clipboard history ---

  async function loadClipboardHistory() {
    try {
      const entries = await window.__TAURI_INTERNALS__.invoke('get_clipboard_history');
      renderHistory(entries);
    } catch (e) {
      console.warn('Failed to load clipboard history:', e);
    }
  }

  function renderHistory(entries) {
    els.historyList.innerHTML = '';

    if (!entries || entries.length === 0) {
      els.historyList.innerHTML = '<div class="history-empty">No clipboard entries</div>';
      return;
    }

    for (const entry of entries) {
      const item = document.createElement('div');
      item.className = 'history-item';
      if (selectedEntryIds.has(entry.id)) {
        item.classList.add('selected');
      }
      item.dataset.id = entry.id;

      // Checkbox
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'history-checkbox';
      checkbox.checked = selectedEntryIds.has(entry.id);
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleEntry(entry.id, checkbox.checked);
      });
      item.appendChild(checkbox);

      // Content preview
      const content = document.createElement('div');
      content.className = 'history-content';

      if (entry.image_data) {
        const img = document.createElement('img');
        img.className = 'history-thumb';
        img.src = 'data:image/png;base64,' + entry.image_data;
        content.appendChild(img);
      }

      if (entry.text) {
        const text = document.createElement('span');
        text.className = 'history-text';
        text.textContent = entry.text.length > 120 ? entry.text.substring(0, 120) + '...' : entry.text;
        content.appendChild(text);
      }

      item.appendChild(content);

      // Remove button
      const remove = document.createElement('span');
      remove.className = 'history-remove';
      remove.textContent = '\u00d7';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        removeEntry(entry.id);
      });
      item.appendChild(remove);

      // Click to toggle selection
      item.addEventListener('click', (e) => {
        if (e.target === checkbox) return;
        checkbox.checked = !checkbox.checked;
        toggleEntry(entry.id, checkbox.checked);
      });

      els.historyList.appendChild(item);
    }

    // Auto-select the newest entry if nothing is selected
    if (selectedEntryIds.size === 0 && entries.length > 0) {
      toggleEntry(entries[0].id, true);
      const first = els.historyList.querySelector('.history-item');
      if (first) {
        first.classList.add('selected');
        const cb = first.querySelector('.history-checkbox');
        if (cb) cb.checked = true;
      }
    }
  }

  function toggleEntry(id, selected) {
    if (selected) {
      selectedEntryIds.add(id);
    } else {
      selectedEntryIds.delete(id);
    }
    // Update visual state
    const items = els.historyList.querySelectorAll('.history-item');
    for (const item of items) {
      if (parseInt(item.dataset.id) === id) {
        item.classList.toggle('selected', selected);
      }
    }
    updateSendButton();
  }

  async function removeEntry(id) {
    selectedEntryIds.delete(id);
    try {
      await window.__TAURI_INTERNALS__.invoke('remove_clipboard_entry', { id });
    } catch (e) {
      console.warn('Failed to remove entry:', e);
    }
    await loadClipboardHistory();
    updateSendButton();
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
      populateBoardSelect();
    } catch (e) {
      showStatus('Failed to load boards', 'error');
    }
  }

  function populateBoardSelect() {
    els.boardSelect.innerHTML = '<option value="">Select board...</option>';
    for (const board of boards) {
      const opt = document.createElement('option');
      opt.value = board.id;
      const name = board.title || board.filePath.split('/').pop().replace('.md', '');
      opt.textContent = name;
      els.boardSelect.appendChild(opt);
    }
  }

  async function loadColumns(boardId) {
    els.columnSelect.innerHTML = '<option value="">Loading...</option>';
    try {
      const data = await apiGet(`/boards/${boardId}/columns`);
      els.columnSelect.innerHTML = '';
      const columns = data.columns || [];
      for (const col of columns) {
        const opt = document.createElement('option');
        opt.value = col.index;
        opt.textContent = `${col.title} (${(col.cards || []).length})`;
        els.columnSelect.appendChild(opt);
      }
      updateSendButton();
    } catch (e) {
      els.columnSelect.innerHTML = '<option value="">Error loading columns</option>';
    }
  }

  function selectDefault(boardId, column) {
    if (boardId) {
      els.boardSelect.value = boardId;
      loadColumns(boardId).then(() => {
        if (column !== undefined) {
          els.columnSelect.value = column;
        }
        updateSendButton();
      });
    }
  }

  // --- Event listeners ---

  function setupEventListeners() {
    els.boardSelect.addEventListener('change', () => {
      const boardId = els.boardSelect.value;
      if (boardId) {
        localStorage.setItem('lexera-qc-board', boardId);
        loadColumns(boardId);
      } else {
        localStorage.removeItem('lexera-qc-board');
        els.columnSelect.innerHTML = '<option value="">Select board first</option>';
      }
      updateSendButton();
    });

    els.columnSelect.addEventListener('change', () => {
      const colVal = els.columnSelect.value;
      if (colVal) {
        localStorage.setItem('lexera-qc-column', colVal);
      }
      updateSendButton();
    });

    els.btnCancel.addEventListener('click', () => closeWindow());
    els.btnSend.addEventListener('click', handleSend);

    // Snap buttons
    els.btnSnapLeft.addEventListener('click', () => snapTo('left'));
    els.btnSnapRight.addEventListener('click', () => snapTo('right'));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeWindow();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!els.btnSend.disabled) handleSend();
      }
    });

    // Drop zone
    els.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.dropZone.classList.add('drag-over');
    });

    els.dropZone.addEventListener('dragleave', () => {
      els.dropZone.classList.remove('drag-over');
    });

    els.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.dropZone.classList.remove('drag-over');
      handleDrop(e.dataTransfer);
    });

    els.dropZone.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.addEventListener('change', () => {
        if (input.files.length > 0) {
          addFiles(Array.from(input.files));
        }
      });
      input.click();
    });
  }

  // --- Drop handling ---

  function handleDrop(dataTransfer) {
    if (dataTransfer.files && dataTransfer.files.length > 0) {
      addFiles(Array.from(dataTransfer.files));
    }
  }

  function addFiles(files) {
    for (const file of files) {
      droppedFiles.push(file);
    }
    renderFilePreview();
    updateSendButton();
  }

  function removeFile(index) {
    droppedFiles.splice(index, 1);
    renderFilePreview();
    updateSendButton();
  }

  function renderFilePreview() {
    if (droppedFiles.length === 0) {
      els.filePreview.classList.add('hidden');
      els.dropLabel.classList.remove('hidden');
      return;
    }

    els.dropLabel.classList.add('hidden');
    els.filePreview.classList.remove('hidden');
    els.filePreview.innerHTML = '';

    droppedFiles.forEach((file, i) => {
      const item = document.createElement('div');
      item.className = 'file-item';

      if (file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.className = 'thumb';
        img.src = URL.createObjectURL(file);
        item.appendChild(img);
      }

      const name = document.createElement('span');
      name.textContent = file.name;
      item.appendChild(name);

      const remove = document.createElement('span');
      remove.className = 'remove-file';
      remove.textContent = '\u00d7';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFile(i);
      });
      item.appendChild(remove);

      els.filePreview.appendChild(item);
    });
  }

  // --- URL detection ---

  function isUrl(text) {
    const trimmed = text.trim();
    return /^https?:\/\/\S+$/i.test(trimmed);
  }

  function formatAsMarkdownLink(url) {
    try {
      const parsed = new URL(url.trim());
      return `[${parsed.hostname}](${url.trim()})`;
    } catch {
      return url.trim();
    }
  }

  // --- Send ---

  async function handleSend() {
    const boardId = els.boardSelect.value;
    const colIndex = parseInt(els.columnSelect.value, 10);
    if (!boardId || isNaN(colIndex)) return;

    els.btnSend.disabled = true;
    els.btnSend.textContent = 'Sending...';

    try {
      // Get selected history entries
      let historyEntries = [];
      try {
        const allEntries = await window.__TAURI_INTERNALS__.invoke('get_clipboard_history');
        historyEntries = allEntries.filter(e => selectedEntryIds.has(e.id));
      } catch (e) {
        // No history available
      }

      const parts = [];

      // Process selected clipboard history entries
      for (const entry of historyEntries) {
        // Handle image from history entry
        if (entry.image_data) {
          const byteString = atob(entry.image_data);
          const bytes = new Uint8Array(byteString.length);
          for (let i = 0; i < byteString.length; i++) {
            bytes[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: 'image/png' });
          const file = new File([blob], entry.image_filename || 'clipboard.png', { type: 'image/png' });
          const result = await apiUpload(`/boards/${boardId}/media`, file);
          parts.push(`![${file.name}](${result.path})`);
        }

        // Handle text from history entry
        if (entry.text) {
          parts.push(isUrl(entry.text) ? formatAsMarkdownLink(entry.text) : entry.text);
        }
      }

      // Handle dropped files
      for (const file of droppedFiles) {
        const result = await apiUpload(`/boards/${boardId}/media`, file);
        if (file.type.startsWith('image/')) {
          parts.push(`![${file.name}](${result.path})`);
        } else {
          parts.push(`[${file.name}](${result.path})`);
        }
      }

      if (parts.length === 0) {
        showStatus('Nothing to capture', 'error');
        els.btnSend.disabled = false;
        els.btnSend.textContent = 'Send';
        return;
      }

      const content = parts.join('\n');
      await apiPost(`/boards/${boardId}/columns/${colIndex}/cards`, { content });

      // Remove sent entries from history
      for (const id of selectedEntryIds) {
        try {
          await window.__TAURI_INTERNALS__.invoke('remove_clipboard_entry', { id });
        } catch (e) {
          // Ignore removal errors
        }
      }
      selectedEntryIds.clear();
      droppedFiles = [];

      showStatus('Captured!', 'success');
      setTimeout(() => closeWindow(), 600);
    } catch (e) {
      showStatus(`Failed: ${e.message}`, 'error');
      els.btnSend.disabled = false;
      els.btnSend.textContent = 'Send';
    }
  }

  // --- Helpers ---

  function updateSendButton() {
    const hasBoard = !!els.boardSelect.value;
    const hasColumn = !!els.columnSelect.value;
    const hasContent = selectedEntryIds.size > 0 || droppedFiles.length > 0;
    els.btnSend.disabled = !(hasBoard && hasColumn && hasContent);
  }

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
