/**
 * Quick Capture — standalone popup for clipboard/drop capture into kanban boards.
 * Communicates with the Lexera Backend REST API.
 */
(function () {
  'use strict';

  // We discover the port from /status, but default to common port
  let baseUrl = '';
  let boards = [];
  let droppedFiles = [];
  let clipboardText = '';

  const els = {
    dropZone: document.getElementById('drop-zone'),
    dropLabel: document.getElementById('drop-label'),
    filePreview: document.getElementById('file-preview'),
    clipboardSection: document.getElementById('clipboard-section'),
    contentPreview: document.getElementById('content-preview'),
    boardSelect: document.getElementById('board-select'),
    columnSelect: document.getElementById('column-select'),
    btnSend: document.getElementById('btn-send'),
    btnCancel: document.getElementById('btn-cancel'),
    statusMsg: document.getElementById('status-msg'),
  };

  // --- Init ---

  async function init() {
    // Try to discover the backend port from common ports
    baseUrl = await discoverBackend();
    if (!baseUrl) {
      showStatus('Cannot connect to Lexera Backend', 'error');
      return;
    }

    // Read clipboard via Tauri IPC (bypasses browser permission requirements)
    try {
      clipboardText = await window.__TAURI_INTERNALS__.invoke('read_clipboard');
      if (clipboardText) {
        els.contentPreview.value = clipboardText;
      }
    } catch (e) {
      console.warn('Tauri clipboard read failed:', e);
    }

    // Load boards
    await loadBoards();

    // Load defaults from /status
    try {
      const status = await apiGet('/status');
      if (status.incoming) {
        selectDefault(status.incoming.board_id, status.incoming.column);
      }
    } catch (e) {
      // No defaults configured
    }

    updateSendButton();
    setupEventListeners();
  }

  async function discoverBackend() {
    // Try to read port from the URL or try common ports
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
    // Board change
    els.boardSelect.addEventListener('change', () => {
      const boardId = els.boardSelect.value;
      if (boardId) {
        loadColumns(boardId);
      } else {
        els.columnSelect.innerHTML = '<option value="">Select board first</option>';
      }
      updateSendButton();
    });

    // Column change
    els.columnSelect.addEventListener('change', updateSendButton);

    // Cancel
    els.btnCancel.addEventListener('click', () => closeWindow());

    // Send
    els.btnSend.addEventListener('click', handleSend);

    // Keyboard shortcuts
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

    // Click on drop zone to open file picker
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
      const parts = [];

      // Handle clipboard text
      const text = els.contentPreview.value.trim();
      if (text) {
        parts.push(isUrl(text) ? formatAsMarkdownLink(text) : text);
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

      showStatus('Captured!', 'success');

      // Close after a brief delay
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
    const hasContent = els.contentPreview.value.trim().length > 0 || droppedFiles.length > 0;
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

  function closeWindow() {
    window.__TAURI_INTERNALS__.invoke('close_capture');
  }

  // --- Start ---
  init();
})();
