/**
 * Lexera Log — Status bar + expandable log panel.
 */
var lexeraLogEntries = [];
var LOG_MAX = 500;

function lexeraLog(level, message) {
  var entry = {
    time: new Date(),
    level: level,
    message: typeof message === 'string' ? message : JSON.stringify(message)
  };
  lexeraLogEntries.push(entry);
  if (lexeraLogEntries.length > LOG_MAX) lexeraLogEntries.shift();

  // Update status bar with last message
  var statusMsg = document.getElementById('status-msg');
  var statusBar = document.getElementById('status-bar');
  if (statusMsg) {
    statusMsg.textContent = entry.message;
    statusBar.className = 'status-bar status-' + level;
  }

  // Append to expanded log panel
  var panel = document.getElementById('log-entries');
  if (panel) {
    var el = document.createElement('div');
    el.className = 'log-entry log-' + level;
    var ts = entry.time.toLocaleTimeString('en-GB', { hour12: false });
    el.innerHTML = '<span class="log-time">' + ts + '</span>' +
      '<span class="log-level">' + level.toUpperCase() + '</span>' +
      '<span class="log-msg">' + entry.message.replace(/</g, '&lt;') + '</span>';
    panel.appendChild(el);
    panel.scrollTop = panel.scrollHeight;
  }
}

// Intercept console.log/warn/error
(function () {
  var origLog = console.log, origWarn = console.warn, origError = console.error;
  console.log = function () {
    origLog.apply(console, arguments);
    lexeraLog('info', Array.prototype.slice.call(arguments).join(' '));
  };
  console.warn = function () {
    origWarn.apply(console, arguments);
    lexeraLog('warn', Array.prototype.slice.call(arguments).join(' '));
  };
  console.error = function () {
    origError.apply(console, arguments);
    lexeraLog('error', Array.prototype.slice.call(arguments).join(' '));
  };
})();

// Catch unhandled errors
window.addEventListener('error', function (e) {
  lexeraLog('error', 'Uncaught: ' + e.message + ' at ' + e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', function (e) {
  lexeraLog('error', 'Unhandled promise: ' + (e.reason || e));
});

// Log panel + status bar UI
document.addEventListener('DOMContentLoaded', function () {
  var panel = document.getElementById('log-panel');
  var statusBar = document.getElementById('status-bar');
  var clearBtn = document.getElementById('log-clear-btn');
  var closeBtn = document.getElementById('log-close-btn');

  // Click status bar to expand/collapse log panel
  if (statusBar) statusBar.addEventListener('click', function () {
    if (panel) panel.classList.toggle('hidden');
  });

  if (clearBtn) clearBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    document.getElementById('log-entries').innerHTML = '';
    lexeraLogEntries = [];
  });
  if (closeBtn) closeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    panel.classList.add('hidden');
  });
});

function toggleLogPanel() {
  var panel = document.getElementById('log-panel');
  if (panel) panel.classList.toggle('hidden');
}

// Ctrl+Shift+L to toggle log
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'L') {
    e.preventDefault();
    toggleLogPanel();
  }
});

/**
 * Lexera Kanban — Board viewer with markdown rendering.
 * Uses LexeraApi from api.js.
 */
const LexeraDashboard = (function () {
  // State
  let boards = [];
  let activeBoardId = null;
  let activeBoardData = null;
  let fullBoardData = null;
  let connected = false;
  let searchMode = false;
  let searchResults = null;
  let pollInterval = null;
  let addCardColumn = null;
  var dragSource = null;
  var isEditing = false;
  var pendingRefresh = false;
  var eventSource = null;
  var lastSaveTime = 0;
  var SAVE_DEBOUNCE_MS = 2000;
  var undoStack = [];
  var redoStack = [];
  var MAX_UNDO = 30;
  var mermaidIdCounter = 0;
  var mermaidReady = false;
  var mermaidLoading = false;
  var pendingMermaidRenders = [];

  // --- Themes ---
  var THEMES = [
    {
      id: 'lexera', name: 'Lexera',
      font: "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      light: {
        '--bg-primary': '#ffffff', '--bg-secondary': '#f3f3f3', '--bg-tertiary': '#e8e8e8',
        '--bg-hover': '#e0e0e0', '--bg-active': '#cce5ff', '--border': '#d4d4d4',
        '--text-primary': '#333333', '--text-secondary': '#717171', '--text-bright': '#1e1e1e',
        '--accent': '#007acc', '--accent-hover': '#0066b8', '--success': '#388a6c', '--error': '#d32f2f',
        '--card-bg': '#ffffff', '--card-border': '#d4d4d4', '--card-checked': '#f0f0f0',
        '--scrollbar-thumb': '#c1c1c1', '--scrollbar-track': 'transparent',
        '--btn-bg': '#e0e0e0', '--btn-bg-hover': '#d0d0d0', '--btn-fg': '#333333',
        '--input-bg': '#ffffff', '--input-border': '#c4c4c4'
      },
      dark: {
        '--bg-primary': '#1e1e1e', '--bg-secondary': '#252526', '--bg-tertiary': '#2d2d30',
        '--bg-hover': '#2a2d2e', '--bg-active': '#094771', '--border': '#474747',
        '--text-primary': '#d4d4d4', '--text-secondary': '#858585', '--text-bright': '#e8e8e8',
        '--accent': '#007acc', '--accent-hover': '#1a8cff', '--success': '#4ec9b0', '--error': '#f44747',
        '--card-bg': '#1e1e1e', '--card-border': '#474747', '--card-checked': '#2d2d30',
        '--scrollbar-thumb': '#424242', '--scrollbar-track': 'transparent',
        '--btn-bg': '#3a3d41', '--btn-bg-hover': '#45494e', '--btn-fg': '#cccccc',
        '--input-bg': '#3c3c3c', '--input-border': '#5a5a5a'
      }
    },
    {
      id: 'mono', name: 'Mono',
      font: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      light: {
        '--bg-primary': '#fafafa', '--bg-secondary': '#f0f0f0', '--bg-tertiary': '#e4e4e4',
        '--bg-hover': '#dcdcdc', '--bg-active': '#c8dff0', '--border': '#cccccc',
        '--text-primary': '#2e2e2e', '--text-secondary': '#6e6e6e', '--text-bright': '#111111',
        '--accent': '#0969da', '--accent-hover': '#0550ae', '--success': '#1a7f37', '--error': '#cf222e',
        '--card-bg': '#fafafa', '--card-border': '#d0d0d0', '--card-checked': '#eeeeee',
        '--scrollbar-thumb': '#c0c0c0', '--scrollbar-track': 'transparent',
        '--btn-bg': '#e2e2e2', '--btn-bg-hover': '#d2d2d2', '--btn-fg': '#2e2e2e',
        '--input-bg': '#ffffff', '--input-border': '#c0c0c0'
      },
      dark: {
        '--bg-primary': '#0d1117', '--bg-secondary': '#161b22', '--bg-tertiary': '#21262d',
        '--bg-hover': '#30363d', '--bg-active': '#1f3a5f', '--border': '#30363d',
        '--text-primary': '#c9d1d9', '--text-secondary': '#8b949e', '--text-bright': '#f0f6fc',
        '--accent': '#58a6ff', '--accent-hover': '#79c0ff', '--success': '#3fb950', '--error': '#f85149',
        '--card-bg': '#0d1117', '--card-border': '#30363d', '--card-checked': '#161b22',
        '--scrollbar-thumb': '#484f58', '--scrollbar-track': 'transparent',
        '--btn-bg': '#21262d', '--btn-bg-hover': '#30363d', '--btn-fg': '#c9d1d9',
        '--input-bg': '#0d1117', '--input-border': '#30363d'
      }
    },
    {
      id: 'warm', name: 'Warm',
      font: "Georgia, 'Times New Roman', serif",
      light: {
        '--bg-primary': '#fdf6e3', '--bg-secondary': '#f5eedc', '--bg-tertiary': '#eee8d5',
        '--bg-hover': '#e8dfca', '--bg-active': '#ddd6c1', '--border': '#d6cdb7',
        '--text-primary': '#5b4636', '--text-secondary': '#8a7560', '--text-bright': '#3b2a1a',
        '--accent': '#b58900', '--accent-hover': '#a07800', '--success': '#859900', '--error': '#dc322f',
        '--card-bg': '#fdf6e3', '--card-border': '#d6cdb7', '--card-checked': '#f0e8d4',
        '--scrollbar-thumb': '#c8bfa8', '--scrollbar-track': 'transparent',
        '--btn-bg': '#eee8d5', '--btn-bg-hover': '#e0d8c2', '--btn-fg': '#5b4636',
        '--input-bg': '#fdf6e3', '--input-border': '#d6cdb7'
      },
      dark: {
        '--bg-primary': '#2b2018', '--bg-secondary': '#33261c', '--bg-tertiary': '#3d2e22',
        '--bg-hover': '#483828', '--bg-active': '#4a3520', '--border': '#5a4530',
        '--text-primary': '#d4c4a8', '--text-secondary': '#9a8a70', '--text-bright': '#f0e0c8',
        '--accent': '#d4a017', '--accent-hover': '#e8b830', '--success': '#a8b820', '--error': '#e8503a',
        '--card-bg': '#2b2018', '--card-border': '#5a4530', '--card-checked': '#33261c',
        '--scrollbar-thumb': '#5a4a35', '--scrollbar-track': 'transparent',
        '--btn-bg': '#3d2e22', '--btn-bg-hover': '#483828', '--btn-fg': '#d4c4a8',
        '--input-bg': '#33261c', '--input-border': '#5a4530'
      }
    },
    {
      id: 'nord', name: 'Nord',
      font: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      light: {
        '--bg-primary': '#eceff4', '--bg-secondary': '#e5e9f0', '--bg-tertiary': '#d8dee9',
        '--bg-hover': '#d0d6e1', '--bg-active': '#c8d0e0', '--border': '#c8ced9',
        '--text-primary': '#2e3440', '--text-secondary': '#4c566a', '--text-bright': '#1a1e28',
        '--accent': '#5e81ac', '--accent-hover': '#4c6d96', '--success': '#a3be8c', '--error': '#bf616a',
        '--card-bg': '#eceff4', '--card-border': '#d0d6e1', '--card-checked': '#e0e4ec',
        '--scrollbar-thumb': '#b8c0cc', '--scrollbar-track': 'transparent',
        '--btn-bg': '#d8dee9', '--btn-bg-hover': '#c8ced9', '--btn-fg': '#2e3440',
        '--input-bg': '#eceff4', '--input-border': '#c8ced9'
      },
      dark: {
        '--bg-primary': '#2e3440', '--bg-secondary': '#3b4252', '--bg-tertiary': '#434c5e',
        '--bg-hover': '#4c566a', '--bg-active': '#3d4a5e', '--border': '#4c566a',
        '--text-primary': '#d8dee9', '--text-secondary': '#81a1c1', '--text-bright': '#eceff4',
        '--accent': '#88c0d0', '--accent-hover': '#8fbcbb', '--success': '#a3be8c', '--error': '#bf616a',
        '--card-bg': '#2e3440', '--card-border': '#4c566a', '--card-checked': '#3b4252',
        '--scrollbar-thumb': '#4c566a', '--scrollbar-track': 'transparent',
        '--btn-bg': '#434c5e', '--btn-bg-hover': '#4c566a', '--btn-fg': '#d8dee9',
        '--input-bg': '#3b4252', '--input-border': '#4c566a'
      }
    }
  ];

  var currentThemeId = null;

  function applyTheme(themeId) {
    var theme = null;
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === themeId) { theme = THEMES[i]; break; }
    }
    if (!theme) theme = THEMES[0];
    currentThemeId = theme.id;

    var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var palette = isDark ? theme.dark : theme.light;
    var root = document.documentElement;

    var keys = Object.keys(palette);
    for (var i = 0; i < keys.length; i++) {
      root.style.setProperty(keys[i], palette[keys[i]]);
    }
    root.style.setProperty('--theme-font', theme.font);

    localStorage.setItem('lexera-theme', theme.id);

    // Update theme selector if present
    var sel = document.getElementById('theme-select');
    if (sel && sel.value !== theme.id) sel.value = theme.id;
  }

  // Re-apply on OS light/dark switch
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    applyTheme(currentThemeId || 'lexera');
  });

  // Apply on load
  applyTheme(localStorage.getItem('lexera-theme') || 'lexera');

  // DOM refs
  const $boardList = document.getElementById('board-list');
  const $boardHeader = document.getElementById('board-header');
  const $columnsContainer = document.getElementById('columns-container');
  const $searchResults = document.getElementById('search-results');
  const $emptyState = document.getElementById('empty-state');
  const $searchInput = document.getElementById('search-input');
  const $connectionDot = document.getElementById('connection-dot');

  // --- Column Grouping & Order Helpers ---

  function hasStackTag(title) {
    return /(?:^|\s)#stack(?:\s|$)/.test(title);
  }

  function stripStackTag(title) {
    return title.replace(/\s*#stack\b/g, '').trim();
  }

  function buildColumnGroups(columns) {
    var groups = [];
    for (var i = 0; i < columns.length; i++) {
      if (hasStackTag(columns[i].title) && groups.length > 0) {
        groups[groups.length - 1].columns.push(columns[i]);
      } else {
        groups.push({ columns: [columns[i]] });
      }
    }
    return groups;
  }

  function getOrderedItems(items, storageKey, idFn) {
    var saved = localStorage.getItem(storageKey);
    if (!saved) return items;
    try {
      var order = JSON.parse(saved);
      var map = {};
      for (var i = 0; i < order.length; i++) map[order[i]] = i;
      return items.slice().sort(function (a, b) {
        var ai = map[idFn(a)] !== undefined ? map[idFn(a)] : order.length;
        var bi = map[idFn(b)] !== undefined ? map[idFn(b)] : order.length;
        return ai - bi;
      });
    } catch (e) { return items; }
  }

  function saveOrder(items, storageKey, idFn) {
    localStorage.setItem(storageKey, JSON.stringify(items.map(idFn)));
  }

  function getFoldedColumns(boardId) {
    var saved = localStorage.getItem('lexera-col-fold:' + boardId);
    if (!saved) return [];
    try { return JSON.parse(saved); } catch (e) { return []; }
  }

  function getFoldedItems(boardId, kind) {
    var saved = localStorage.getItem('lexera-' + kind + '-fold:' + boardId);
    if (!saved) return [];
    try { return JSON.parse(saved); } catch (e) { return []; }
  }

  function saveFoldState(boardId) {
    var folded = [];
    var cols = $columnsContainer.querySelectorAll('.column[data-col-title]');
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].classList.contains('folded')) {
        folded.push(cols[i].getAttribute('data-col-title'));
      }
    }
    localStorage.setItem('lexera-col-fold:' + boardId, JSON.stringify(folded));

    // Also save row/stack fold states for new format
    var rowFolded = [];
    var rows = $columnsContainer.querySelectorAll('.board-row[data-row-title]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].classList.contains('folded')) {
        rowFolded.push(rows[i].getAttribute('data-row-title'));
      }
    }
    localStorage.setItem('lexera-row-fold:' + boardId, JSON.stringify(rowFolded));

    var stackFolded = [];
    var stacks = $columnsContainer.querySelectorAll('.board-stack[data-stack-title]');
    for (var i = 0; i < stacks.length; i++) {
      if (stacks[i].classList.contains('folded')) {
        stackFolded.push(stacks[i].getAttribute('data-stack-title'));
      }
    }
    localStorage.setItem('lexera-stack-fold:' + boardId, JSON.stringify(stackFolded));
  }

  function reorderItems(items, sourceIdx, targetIdx, insertBefore) {
    var moved = items[sourceIdx];
    var result = [];
    for (var i = 0; i < items.length; i++) {
      if (i === sourceIdx) continue;
      if (i === targetIdx && insertBefore) result.push(moved);
      result.push(items[i]);
      if (i === targetIdx && !insertBefore) result.push(moved);
    }
    return result;
  }

  function reorderColumnGroups(sourceIdx, targetIdx, insertBefore) {
    var columns = getOrderedItems(activeBoardData.columns, 'lexera-col-order:' + activeBoardId, function (c) { return c.title; });
    var groups = buildColumnGroups(columns);
    var newGroups = reorderItems(groups, sourceIdx, targetIdx, insertBefore);
    var newColumns = [];
    for (var i = 0; i < newGroups.length; i++) {
      for (var j = 0; j < newGroups[i].columns.length; j++) {
        newColumns.push(newGroups[i].columns[j]);
      }
    }
    saveOrder(newColumns, 'lexera-col-order:' + activeBoardId, function (c) { return c.title; });
    renderColumns();
  }

  function reorderBoards(sourceIdx, targetIdx, insertBefore) {
    var orderedBoards = getOrderedItems(boards, 'lexera-board-order', function (b) { return b.id; });
    var newOrder = reorderItems(orderedBoards, sourceIdx, targetIdx, insertBefore);
    saveOrder(newOrder, 'lexera-board-order', function (b) { return b.id; });
    renderBoardList();
  }

  function init() {
    $searchInput.addEventListener('input', onSearchInput);
    $searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        $searchInput.value = '';
        exitSearchMode();
      }
    });

    document.addEventListener('keydown', handleKeyNavigation);

    // External file drop on columns container
    $columnsContainer.addEventListener('dragover', function (e) {
      if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    $columnsContainer.addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
      if (!activeBoardId) return;
      e.preventDefault();
      handleFileDrop(e.dataTransfer.files, e.target);
    });

    // Clipboard paste for images
    document.addEventListener('paste', function (e) {
      if (!activeBoardId || isEditing) return;
      if (!e.clipboardData || !e.clipboardData.files || e.clipboardData.files.length === 0) return;
      var hasImage = false;
      for (var i = 0; i < e.clipboardData.files.length; i++) {
        if (e.clipboardData.files[i].type.indexOf('image/') === 0) { hasImage = true; break; }
      }
      if (!hasImage) return;
      e.preventDefault();
      handleFileDrop(e.clipboardData.files, null);
    });

    poll();
    pollInterval = setInterval(poll, 5000);
  }

  // --- Keyboard Navigation ---

  var focusedCardEl = null;

  function handleKeyNavigation(e) {
    if (isEditing || searchMode) return;
    if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

    var key = e.key;
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      navigateCards(key);
    } else if (key === 'Enter' && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      enterCardEditMode(focusedCardEl, ci, cj);
    } else if (key === 'Escape' && focusedCardEl) {
      unfocusCard();
    }
  }

  function navigateCards(key) {
    var allCards = $columnsContainer.querySelectorAll('.card');
    if (allCards.length === 0) return;

    if (!focusedCardEl || !focusedCardEl.isConnected) {
      focusCard(allCards[0]);
      return;
    }

    var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
    var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);

    if (key === 'ArrowDown') {
      // Next card in same column
      var next = $columnsContainer.querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj + 1) + '"]');
      if (next) focusCard(next);
    } else if (key === 'ArrowUp') {
      // Previous card in same column
      if (cj > 0) {
        var prev = $columnsContainer.querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj - 1) + '"]');
        if (prev) focusCard(prev);
      }
    } else if (key === 'ArrowRight' || key === 'ArrowLeft') {
      // Move to adjacent column, same card position or last card
      var columns = activeBoardData ? activeBoardData.columns : [];
      var colIndices = columns.map(function (c) { return c.index; });
      var curPos = colIndices.indexOf(ci);
      var targetPos = key === 'ArrowRight' ? curPos + 1 : curPos - 1;
      if (targetPos >= 0 && targetPos < colIndices.length) {
        var targetColIdx = colIndices[targetPos];
        var target = $columnsContainer.querySelector('.card[data-col-index="' + targetColIdx + '"][data-card-index="' + cj + '"]');
        if (!target) {
          // Try last card in target column
          var colCards = $columnsContainer.querySelectorAll('.card[data-col-index="' + targetColIdx + '"]');
          if (colCards.length > 0) target = colCards[colCards.length - 1];
        }
        if (target) focusCard(target);
      }
    }
  }

  function focusCard(cardEl) {
    unfocusCard();
    focusedCardEl = cardEl;
    cardEl.classList.add('focused');
    cardEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function unfocusCard() {
    if (focusedCardEl) {
      focusedCardEl.classList.remove('focused');
      focusedCardEl = null;
    }
  }

  function connectSSEIfReady() {
    if (eventSource) return;
    eventSource = LexeraApi.connectSSE(handleSSEEvent);
    if (eventSource) {
      // Reduce polling to 30s health checks while SSE is active
      clearInterval(pollInterval);
      pollInterval = setInterval(poll, 30000);
      eventSource.onerror = function () {
        eventSource.close();
        eventSource = null;
        // Restore normal polling
        clearInterval(pollInterval);
        pollInterval = setInterval(poll, 5000);
      };
    }
  }

  function handleSSEEvent(event) {
    if (!activeBoardId || searchMode) return;
    var kind = event.kind || event.type || '';
    var boardId = event.board_id || event.boardId || '';
    if (boardId && boardId !== activeBoardId) return;
    if (kind === 'MainFileChanged' || kind === 'IncludeFileChanged') {
      // Skip reloads caused by our own saves
      if (Date.now() - lastSaveTime < SAVE_DEBOUNCE_MS) return;
      if (isEditing) {
        pendingRefresh = true;
      } else {
        loadBoard(activeBoardId);
      }
    }
  }

  // --- Polling ---

  async function poll() {
    try {
      const ok = await LexeraApi.checkStatus();
      setConnected(ok);
      if (!ok) return;
    } catch {
      setConnected(false);
      return;
    }

    connectSSEIfReady();

    try {
      const data = await LexeraApi.getBoards();
      boards = data.boards || [];
      renderBoardList();

      if (activeBoardId && !searchMode) {
        const stillExists = boards.find(b => b.id === activeBoardId);
        if (stillExists) {
          await loadBoard(activeBoardId);
        } else {
          activeBoardId = null;
          activeBoardData = null;
          fullBoardData = null;
          renderMainView();
        }
      }
    } catch {
      // keep previous state
    }
  }

  function setConnected(state) {
    connected = state;
    $connectionDot.classList.toggle('connected', state);
  }

  // --- Board List ---

  function getSidebarExpandedBoards() {
    try { return JSON.parse(localStorage.getItem('lexera-sidebar-expanded') || '[]'); } catch (e) { return []; }
  }
  function saveSidebarExpandedBoards(ids) {
    localStorage.setItem('lexera-sidebar-expanded', JSON.stringify(ids));
  }

  function renderBoardList() {
    $boardList.innerHTML = '';
    var orderedBoards = getOrderedItems(boards, 'lexera-board-order', function (b) { return b.id; });
    var expandedIds = getSidebarExpandedBoards();
    for (var i = 0; i < orderedBoards.length; i++) {
      var board = orderedBoards[i];
      var totalCards = board.columns.reduce(function (sum, c) { return sum + c.cardCount; }, 0);
      var isExpanded = expandedIds.indexOf(board.id) !== -1;

      var wrapper = document.createElement('div');
      wrapper.className = 'board-item-wrapper';

      var el = document.createElement('div');
      el.className = 'board-item' + (board.id === activeBoardId ? ' active' : '');
      el.draggable = true;
      el.setAttribute('data-board-index', i.toString());
      var boardName = board.title || board.filePath.split('/').pop().replace('.md', '') || 'Untitled';

      var hasColumns = board.columns && board.columns.length > 0;
      el.innerHTML =
        (hasColumns ? '<span class="board-item-toggle' + (isExpanded ? ' expanded' : '') + '">\u25B6</span>' : '<span class="board-item-toggle-spacer"></span>') +
        '<span class="board-item-title">' + escapeHtml(boardName) + '</span>' +
        '<span class="board-item-count">' + totalCards + '</span>';

      // Column sub-list with stack grouping
      var colList = document.createElement('div');
      colList.className = 'board-item-columns' + (isExpanded ? ' expanded' : '');
      if (hasColumns) {
        // Use activeBoardData columns for active board (has .index), else board.columns
        var sidebarCols = (board.id === activeBoardId && activeBoardData) ? activeBoardData.columns : board.columns;
        var inStack = false;
        var stackGroup = null;
        for (var c = 0; c < sidebarCols.length; c++) {
          var col = sidebarCols[c];
          var colTitle = col.title || 'Untitled';
          var isStack = hasStackTag(colTitle);
          var displayTitle = isStack ? stripStackTag(colTitle) : colTitle;

          // Start or continue stack group
          if (isStack && !inStack) {
            // previous non-stack started a group
          } else if (!isStack && inStack) {
            inStack = false;
            stackGroup = null;
          }

          if (isStack) {
            if (!stackGroup) {
              stackGroup = document.createElement('div');
              stackGroup.className = 'board-item-stack-group';
              colList.appendChild(stackGroup);
            }
            inStack = true;
          } else {
            stackGroup = null;
            inStack = false;
          }

          var colEl = document.createElement('div');
          colEl.className = 'board-item-column';
          if (col.index != null) {
            colEl.setAttribute('data-col-index', col.index.toString());
            colEl.setAttribute('data-board-id', board.id);
          }
          var cardCount = col.cardCount != null ? col.cardCount : (col.cards ? col.cards.length : 0);
          colEl.innerHTML =
            '<span class="board-item-column-title">' + escapeHtml(displayTitle) + '</span>' +
            '<span class="board-item-column-count">' + cardCount + '</span>';

          if (stackGroup) {
            stackGroup.appendChild(colEl);
          } else {
            colList.appendChild(colEl);
          }
        }
      }

      wrapper.appendChild(el);
      wrapper.appendChild(colList);

      (function (boardId, boardIndex, wrapperEl) {
        // Toggle expand on arrow click
        var toggle = wrapperEl.querySelector('.board-item-toggle');
        if (toggle) {
          toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            var ids = getSidebarExpandedBoards();
            var idx = ids.indexOf(boardId);
            if (idx !== -1) {
              ids.splice(idx, 1);
              toggle.classList.remove('expanded');
              wrapperEl.querySelector('.board-item-columns').classList.remove('expanded');
            } else {
              ids.push(boardId);
              toggle.classList.add('expanded');
              wrapperEl.querySelector('.board-item-columns').classList.add('expanded');
            }
            saveSidebarExpandedBoards(ids);
          });
        }

        var boardRow = wrapperEl.querySelector('.board-item');
        boardRow.addEventListener('click', function () {
          exitSearchMode();
          selectBoard(boardId);
        });

        boardRow.addEventListener('dragstart', function (e) {
          dragSource = { type: 'board', index: boardIndex };
          e.dataTransfer.effectAllowed = 'move';
          this.classList.add('dragging');
        });

        boardRow.addEventListener('dragover', function (e) {
          if (!dragSource || dragSource.type !== 'board') return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          var items = $boardList.querySelectorAll('.board-item');
          for (var j = 0; j < items.length; j++) {
            items[j].classList.remove('drag-over-top', 'drag-over-bottom');
          }
          var rect = this.getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) {
            this.classList.add('drag-over-top');
          } else {
            this.classList.add('drag-over-bottom');
          }
        });

        boardRow.addEventListener('drop', function (e) {
          e.preventDefault();
          if (!dragSource || dragSource.type !== 'board') return;
          var sourceIdx = dragSource.index;
          var targetIdx = boardIndex;
          if (sourceIdx === targetIdx) return;
          var rect = this.getBoundingClientRect();
          var insertBefore = e.clientY < rect.top + rect.height / 2;
          reorderBoards(sourceIdx, targetIdx, insertBefore);
        });

        boardRow.addEventListener('dragend', function () {
          this.classList.remove('dragging');
          var items = $boardList.querySelectorAll('.board-item');
          for (var j = 0; j < items.length; j++) {
            items[j].classList.remove('drag-over-top', 'drag-over-bottom');
          }
          dragSource = null;
        });
      })(board.id, i, wrapper);

      $boardList.appendChild(wrapper);
    }
  }

  async function selectBoard(boardId) {
    activeBoardId = boardId;
    addCardColumn = null;
    renderBoardList();
    await loadBoard(boardId);
  }

  async function loadBoard(boardId) {
    try {
      var response = await LexeraApi.getBoardColumns(boardId);
      fullBoardData = response.fullBoard || null;
      activeBoardData = response;
      renderMainView();
    } catch {
      activeBoardData = null;
      fullBoardData = null;
      renderMainView();
    }
  }

  function isNewFormat() {
    return fullBoardData && fullBoardData.rows && fullBoardData.rows.length > 0;
  }

  function convertLegacyToNewFormat() {
    if (!fullBoardData || isNewFormat()) return;
    var cols = fullBoardData.columns || [];
    var groups = buildColumnGroups(cols);
    var stacks = [];
    for (var i = 0; i < groups.length; i++) {
      var grpCols = groups[i].columns;
      // Strip #stack tags from column titles
      for (var c = 0; c < grpCols.length; c++) {
        grpCols[c].title = stripStackTag(grpCols[c].title);
      }
      stacks.push({
        id: 'stack-' + Date.now() + '-' + i,
        title: stripStackTag(grpCols[0].title),
        columns: grpCols
      });
    }
    fullBoardData.rows = [{
      id: 'row-' + Date.now(),
      title: fullBoardData.title || 'Board',
      stacks: stacks
    }];
    fullBoardData.columns = [];
  }

  function ensureNewFormat() {
    if (!isNewFormat()) {
      pushUndo();
      convertLegacyToNewFormat();
    }
  }

  /**
   * Get a flat list of all columns from fullBoardData, regardless of format.
   * For new format: walks rows→stacks→columns.
   * For legacy: returns fullBoardData.columns directly.
   */
  function getAllFullColumns() {
    if (isNewFormat()) {
      var cols = [];
      for (var r = 0; r < fullBoardData.rows.length; r++) {
        var row = fullBoardData.rows[r];
        for (var s = 0; s < row.stacks.length; s++) {
          var stack = row.stacks[s];
          for (var c = 0; c < stack.columns.length; c++) {
            cols.push(stack.columns[c]);
          }
        }
      }
      return cols;
    }
    return fullBoardData.columns;
  }

  /**
   * Get the column at flat index from fullBoardData (either format).
   */
  function getFullColumn(flatIndex) {
    var cols = getAllFullColumns();
    return (flatIndex >= 0 && flatIndex < cols.length) ? cols[flatIndex] : null;
  }

  function updateDisplayFromFullBoard() {
    if (!fullBoardData || !activeBoardData) return;

    var allCols = getAllFullColumns();
    var columns = allCols
      .map(function (col, index) {
        if (is_archived_or_deleted(col.title)) return null;
        var cards = col.cards.filter(function (c) { return !is_archived_or_deleted(c.content); });
        return { index: index, title: col.title, cards: cards };
      })
      .filter(function (c) { return c !== null; });
    activeBoardData.columns = columns;

    // Build filtered rows hierarchy for new format rendering
    if (isNewFormat()) {
      activeBoardData.rows = fullBoardData.rows
        .map(function (row) {
          var stacks = row.stacks
            .map(function (stack) {
              var cols = stack.columns
                .filter(function (col) { return !is_archived_or_deleted(col.title); })
                .map(function (col) {
                  var cards = col.cards.filter(function (c) { return !is_archived_or_deleted(c.content); });
                  // Find this column's flat index
                  var flatIdx = allCols.indexOf(col);
                  return { index: flatIdx, title: col.title, cards: cards };
                });
              return { id: stack.id, title: stack.title, columns: cols };
            })
            .filter(function (stack) { return stack.columns.length > 0; });
          return { id: row.id, title: row.title, stacks: stacks };
        })
        .filter(function (row) { return row.stacks.length > 0; });
    } else {
      // Build virtual rows from legacy flat columns for unified rendering
      var legacyCols = columns; // already filtered
      var groups = buildColumnGroups(legacyCols);
      var stacks = [];
      for (var gi = 0; gi < groups.length; gi++) {
        stacks.push({
          id: 'stack-legacy-' + gi,
          title: groups[gi].columns.length > 0 ? stripStackTag(groups[gi].columns[0].title) : 'Stack ' + (gi + 1),
          columns: groups[gi].columns
        });
      }
      activeBoardData.rows = [{
        id: 'row-legacy-0',
        title: activeBoardData.title || 'Board',
        stacks: stacks
      }];
    }
  }

  function is_archived_or_deleted(text) {
    if (text.indexOf('#hidden-internal-deleted') !== -1 || text.indexOf('#hidden-internal-archived') !== -1) return true;
    // Plain #hidden tag also hides from display (but not #hidden-internal-*)
    if (/(^|\s)#hidden(\s|$)/.test(text)) return true;
    return false;
  }

  function findColumnTitleByIndex(index) {
    if (!fullBoardData) return null;
    var col = getFullColumn(index);
    return col ? col.title : null;
  }

  // --- Main View ---

  function renderMainView() {
    if (searchMode && searchResults) {
      renderSearchResults();
      return;
    }

    $searchResults.classList.add('hidden');

    if (!activeBoardData) {
      $boardHeader.classList.add('hidden');
      $columnsContainer.classList.add('hidden');
      $emptyState.classList.remove('hidden');
      $emptyState.innerHTML =
        '<div class="empty-state-icon">&#9776;</div>' +
        '<div>' + (connected ? 'Select a board from the sidebar' : 'Waiting for server...') + '</div>';
      return;
    }

    $emptyState.classList.add('hidden');
    $boardHeader.classList.remove('hidden');
    renderBoardHeader();
    $columnsContainer.classList.remove('hidden');
    applyBoardSettings();
    renderColumns();
  }

  function renderBoardHeader() {
    var title = activeBoardData ? (activeBoardData.title || 'Untitled') : '';
    var parkedCount = getParkedCount();
    var html = '<span class="board-header-title">' + escapeHtml(title) + '</span>';
    html += '<span id="saving-indicator" class="saving-indicator">Saving...</span>';
    html += '<div class="board-header-actions">';
    if (parkedCount > 0) {
      html += '<button class="board-action-btn has-items" id="btn-parked" title="Show parked items">Parked (' + parkedCount + ')</button>';
    }
    html += '<button class="board-action-btn" id="btn-fold-all" title="Fold/unfold all columns">Fold All</button>';
    html += '<button class="board-action-btn" id="btn-print" title="Print board">Print</button>';
    html += '<button class="board-action-btn" id="btn-settings" title="Board settings">Settings</button>';
    html += '<select id="theme-select" class="theme-select" title="Theme">';
    for (var t = 0; t < THEMES.length; t++) {
      var sel = (THEMES[t].id === currentThemeId) ? ' selected' : '';
      html += '<option value="' + THEMES[t].id + '"' + sel + '>' + escapeHtml(THEMES[t].name) + '</option>';
    }
    html += '</select>';
    html += '</div>';
    $boardHeader.innerHTML = html;

    var foldBtn = document.getElementById('btn-fold-all');
    if (foldBtn) {
      foldBtn.addEventListener('click', function () {
        toggleFoldAll();
      });
    }
    var parkedBtn = document.getElementById('btn-parked');
    if (parkedBtn) {
      parkedBtn.addEventListener('click', function () {
        showParkedItems();
      });
    }
    var printBtn = document.getElementById('btn-print');
    if (printBtn) {
      printBtn.addEventListener('click', function () {
        window.print();
      });
    }
    var settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function () {
        showBoardSettingsDialog();
      });
    }
    var themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      themeSelect.addEventListener('change', function () {
        applyTheme(themeSelect.value);
      });
    }
    // Double-click board title to rename
    var titleEl = $boardHeader.querySelector('.board-header-title');
    if (titleEl) {
      titleEl.addEventListener('dblclick', function () {
        enterBoardTitleEdit(titleEl);
      });
      titleEl.title = 'Double-click to rename';
      titleEl.style.cursor = 'pointer';
    }
  }

  function enterBoardTitleEdit(titleEl) {
    if (!fullBoardData) return;
    var input = document.createElement('input');
    input.className = 'board-title-input';
    input.value = fullBoardData.title || '';
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    function save() {
      var newTitle = input.value.trim();
      if (newTitle && newTitle !== fullBoardData.title) {
        pushUndo();
        fullBoardData.title = newTitle;
        if (activeBoardData) activeBoardData.title = newTitle;
        saveFullBoard();
      }
      renderBoardHeader();
    }

    input.addEventListener('blur', save);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') {
        input.removeEventListener('blur', save);
        renderBoardHeader();
      }
    });
  }

  function getParkedCount() {
    if (!fullBoardData) return 0;
    var count = 0;
    var allCols = getAllFullColumns();
    for (var i = 0; i < allCols.length; i++) {
      var col = allCols[i];
      for (var j = 0; j < col.cards.length; j++) {
        if (col.cards[j].content.indexOf('#hidden-internal-parked') !== -1) count++;
      }
    }
    return count;
  }

  function toggleFoldAll() {
    var foldables = $columnsContainer.querySelectorAll('.column[data-col-title], .board-row[data-row-title], .board-stack[data-stack-title]');
    var allFolded = true;
    for (var i = 0; i < foldables.length; i++) {
      if (!foldables[i].classList.contains('folded')) { allFolded = false; break; }
    }
    for (var i = 0; i < foldables.length; i++) {
      if (allFolded) {
        foldables[i].classList.remove('folded');
      } else {
        foldables[i].classList.add('folded');
      }
    }
    saveFoldState(activeBoardId);
    var foldBtn = document.getElementById('btn-fold-all');
    if (foldBtn) foldBtn.textContent = allFolded ? 'Fold All' : 'Unfold All';
  }

  function showParkedItems() {
    if (!fullBoardData || !activeBoardId) return;
    var parked = [];
    var allCols = getAllFullColumns();
    for (var i = 0; i < allCols.length; i++) {
      var col = allCols[i];
      for (var j = 0; j < col.cards.length; j++) {
        var card = col.cards[j];
        if (card.content.indexOf('#hidden-internal-parked') !== -1) {
          parked.push({ colIndex: i, cardIndex: j, card: card, colTitle: col.title });
        }
      }
    }
    if (parked.length === 0) return;
    showParkedDialog(parked);
  }

  function showParkedDialog(parkedItems) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    var html = '<div class="modal-title">Parked Items (' + parkedItems.length + ')</div>';
    for (var i = 0; i < parkedItems.length; i++) {
      var item = parkedItems[i];
      var displayContent = item.card.content.replace(/#hidden-internal-parked/g, '').trim();
      var firstLine = displayContent.split('\n')[0];
      html += '<div class="parked-item" data-idx="' + i + '">';
      html += '<div class="parked-item-content">' + escapeHtml(firstLine) + '</div>';
      html += '<div class="parked-item-col">' + escapeHtml(item.colTitle) + '</div>';
      html += '<button class="board-action-btn" data-unpark="' + i + '">Unpark</button>';
      html += '</div>';
    }
    html += '<div style="text-align:center;margin-top:12px"><button class="board-action-btn" id="close-parked">Close</button></div>';
    dialog.innerHTML = html;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.id === 'close-parked') {
        overlay.remove();
        return;
      }
      var unparkBtn = e.target.closest('[data-unpark]');
      if (unparkBtn) {
        var idx = parseInt(unparkBtn.getAttribute('data-unpark'), 10);
        var item = parkedItems[idx];
        unparkCard(item.colIndex, item.cardIndex);
        overlay.remove();
      }
    });
  }

  async function unparkCard(colIndex, fullCardIndex) {
    if (!fullBoardData || !activeBoardId) return;
    pushUndo();
    var col = getFullColumn(colIndex);
    if (!col) return;
    var card = col.cards[fullCardIndex];
    if (!card) return;
    card.content = card.content.replace(/\s*#hidden-internal-parked/g, '');
    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderMainView();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  function showBoardSettingsDialog() {
    if (!fullBoardData) return;
    var s = fullBoardData.boardSettings || {};
    var fields = [
      { key: 'columnWidth', label: 'Column Width', placeholder: '280px', type: 'text' },
      { key: 'fontSize', label: 'Font Size', placeholder: '13px', type: 'text' },
      { key: 'fontFamily', label: 'Font Family', placeholder: '', type: 'select', options: [
        '', 'Poppins', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Nunito', 'Source Sans Pro',
        'SF Pro Display', 'Helvetica Neue', 'Arial', 'Segoe UI', 'Verdana',
        'Georgia', 'Times New Roman', 'Courier New', 'monospace', 'system-ui'
      ] },
      { key: 'rowHeight', label: 'Row Height', placeholder: 'auto', type: 'text' },
      { key: 'maxRowHeight', label: 'Max Row Height (px)', placeholder: '', type: 'number' },
      { key: 'cardMinHeight', label: 'Card Min Height', placeholder: 'auto', type: 'text' },
      { key: 'boardColor', label: 'Board Color', placeholder: '#1e1e1e', type: 'text' },
      { key: 'tagVisibility', label: 'Tag Visibility', placeholder: '', type: 'select', options: ['', 'show', 'hide', 'dim'] },
      { key: 'whitespace', label: 'Whitespace', placeholder: '', type: 'select', options: ['', 'pre-wrap', 'normal', 'nowrap'] },
      { key: 'stickyStackMode', label: 'Sticky Headers', placeholder: '', type: 'select', options: ['', 'column'] },
      { key: 'htmlCommentRenderMode', label: 'HTML Comments', placeholder: '', type: 'select', options: ['', 'show', 'hide', 'dim'] },
      { key: 'arrowKeyFocusScroll', label: 'Arrow Key Focus Scroll', placeholder: '', type: 'select', options: ['', 'enabled', 'disabled'] }
    ];

    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'dialog';
    var html = '<div class="dialog-title">Board Settings</div>';

    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var val = s[f.key] != null ? s[f.key] : '';
      html += '<div class="dialog-field">';
      html += '<label class="dialog-label">' + escapeHtml(f.label) + '</label>';
      if (f.type === 'select') {
        html += '<select class="dialog-input" data-setting="' + f.key + '">';
        for (var j = 0; j < f.options.length; j++) {
          var opt = f.options[j];
          var selected = (String(val) === opt) ? ' selected' : '';
          html += '<option value="' + escapeHtml(opt) + '"' + selected + '>' + (opt || '(default)') + '</option>';
        }
        html += '</select>';
      } else {
        html += '<input class="dialog-input" type="' + f.type + '" data-setting="' + f.key + '" value="' + escapeAttr(String(val)) + '" placeholder="' + escapeAttr(f.placeholder) + '">';
      }
      html += '</div>';
    }

    html += '<div class="dialog-actions">';
    html += '<button class="btn-small btn-cancel" id="settings-cancel">Cancel</button>';
    html += '<button class="btn-small btn-primary" id="settings-save">Save</button>';
    html += '</div>';

    dialog.innerHTML = html;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
    document.getElementById('settings-cancel').addEventListener('click', function () {
      overlay.remove();
    });
    document.getElementById('settings-save').addEventListener('click', function () {
      pushUndo();
      if (!fullBoardData.boardSettings) fullBoardData.boardSettings = {};
      var inputs = dialog.querySelectorAll('[data-setting]');
      for (var k = 0; k < inputs.length; k++) {
        var key = inputs[k].getAttribute('data-setting');
        var value = inputs[k].value.trim();
        if (value === '') {
          fullBoardData.boardSettings[key] = null;
        } else if (inputs[k].type === 'number' && value) {
          fullBoardData.boardSettings[key] = parseInt(value, 10);
        } else {
          fullBoardData.boardSettings[key] = value;
        }
      }
      saveFullBoard();
      applyBoardSettings();
      renderColumns();
      overlay.remove();
    });

    var firstInput = dialog.querySelector('.dialog-input');
    if (firstInput) firstInput.focus();
  }

  var savingTimeout = null;
  function showSaving() {
    var el = document.getElementById('saving-indicator');
    if (el) el.classList.add('visible');
    clearTimeout(savingTimeout);
  }
  function hideSaving() {
    clearTimeout(savingTimeout);
    savingTimeout = setTimeout(function () {
      var el = document.getElementById('saving-indicator');
      if (el) el.classList.remove('visible');
    }, 500);
  }

  async function saveFullBoard() {
    showSaving();
    lastSaveTime = Date.now();
    try {
      var result = await LexeraApi.saveBoard(activeBoardId, fullBoardData);
      if (result && result.hasConflicts) {
        showConflictDialog(result.conflicts, result.autoMerged);
      } else if (result && result.merged && result.autoMerged > 0) {
        showNotification('Auto-merged ' + result.autoMerged + ' change(s) with server version');
        await loadBoard(activeBoardId);
      }
    } finally {
      hideSaving();
    }
  }

  function showConflictDialog(conflictCount, autoMerged) {
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.innerHTML =
      '<div class="dialog-title">Merge Conflict</div>' +
      '<div style="margin-bottom:12px;color:var(--text-primary);font-size:13px">' +
        'The board was modified externally while you were editing.' +
        (autoMerged > 0 ? '<br>' + autoMerged + ' change(s) were merged automatically.' : '') +
        '<br><strong>' + conflictCount + ' conflict(s)</strong> could not be resolved automatically.' +
      '</div>' +
      '<div class="dialog-actions">' +
        '<button class="btn-small btn-cancel" data-conflict-action="reload">Load Server Version</button>' +
        '<button class="btn-small btn-primary" data-conflict-action="keep">Keep My Version</button>' +
      '</div>';

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    dialog.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-conflict-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-conflict-action');
      overlay.remove();
      if (action === 'reload') {
        loadBoard(activeBoardId);
      }
      // 'keep' — do nothing, our version was already saved by the backend
    });
  }

  function showNotification(message) {
    var el = document.createElement('div');
    el.className = 'notification';
    el.textContent = message;
    document.body.appendChild(el);
    el.offsetHeight; // force reflow
    el.classList.add('visible');
    setTimeout(function () {
      el.classList.remove('visible');
      setTimeout(function () { el.remove(); }, 300);
    }, 3000);
  }

  function pushUndo() {
    if (!fullBoardData) return;
    undoStack.push(JSON.stringify(fullBoardData));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }

  async function undo() {
    if (undoStack.length === 0 || !fullBoardData || !activeBoardId) return;
    redoStack.push(JSON.stringify(fullBoardData));
    fullBoardData = JSON.parse(undoStack.pop());
    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  async function redo() {
    if (redoStack.length === 0 || !fullBoardData || !activeBoardId) return;
    undoStack.push(JSON.stringify(fullBoardData));
    fullBoardData = JSON.parse(redoStack.pop());
    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    // Undo: Ctrl/Cmd+Z
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    // Redo: Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey) || (e.key === 'Z' && e.shiftKey))) {
      e.preventDefault();
      redo();
      return;
    }
    // Save: Ctrl/Cmd+S
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (fullBoardData && activeBoardId) saveFullBoard();
      return;
    }
  });

  function applyBoardSettings() {
    var cssProps = [
      '--board-column-width', '--board-font-size', '--board-font-family',
      '--board-color', '--board-color-dark', '--board-color-light',
      '--board-row-height', '--board-max-row-height', '--board-card-min-height',
      '--board-whitespace'
    ];
    for (var i = 0; i < cssProps.length; i++) {
      $columnsContainer.style.removeProperty(cssProps[i]);
    }
    // Reset class-based settings
    $columnsContainer.classList.remove('tag-visibility-hide', 'tag-visibility-dim');
    $columnsContainer.classList.remove('sticky-headers');
    $columnsContainer.classList.remove('html-comments-hide', 'html-comments-dim');
    $columnsContainer.classList.remove('focus-scroll-mode');

    if (!fullBoardData || !fullBoardData.boardSettings) return;
    var s = fullBoardData.boardSettings;
    if (s.columnWidth) $columnsContainer.style.setProperty('--board-column-width', s.columnWidth);
    if (s.fontSize) $columnsContainer.style.setProperty('--board-font-size', s.fontSize);
    if (s.fontFamily) $columnsContainer.style.setProperty('--board-font-family', s.fontFamily);
    if (s.boardColor) $columnsContainer.style.setProperty('--board-color', s.boardColor);
    if (s.boardColorDark) $columnsContainer.style.setProperty('--board-color-dark', s.boardColorDark);
    if (s.boardColorLight) $columnsContainer.style.setProperty('--board-color-light', s.boardColorLight);
    if (s.rowHeight) $columnsContainer.style.setProperty('--board-row-height', s.rowHeight);
    if (s.maxRowHeight) $columnsContainer.style.setProperty('--board-max-row-height', s.maxRowHeight + 'px');
    if (s.cardMinHeight) $columnsContainer.style.setProperty('--board-card-min-height', s.cardMinHeight);
    if (s.whitespace) $columnsContainer.style.setProperty('--board-whitespace', s.whitespace);
    if (s.tagVisibility === 'hide') $columnsContainer.classList.add('tag-visibility-hide');
    if (s.tagVisibility === 'dim') $columnsContainer.classList.add('tag-visibility-dim');
    if (s.stickyStackMode) $columnsContainer.classList.add('sticky-headers');
    if (s.htmlCommentRenderMode === 'hide') $columnsContainer.classList.add('html-comments-hide');
    if (s.htmlCommentRenderMode === 'dim') $columnsContainer.classList.add('html-comments-dim');
    if (s.arrowKeyFocusScroll === 'enabled') $columnsContainer.classList.add('focus-scroll-mode');
  }

  /**
   * Build a single column element (header, cards, footer) — shared by both formats.
   */
  function buildColumnElement(col, foldedCols, expandedCards, parentDragEl) {
    var displayTitle = stripStackTag(col.title);

    var colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.setAttribute('data-col-title', col.title);
    if (foldedCols.indexOf(col.title) !== -1) {
      colEl.classList.add('folded');
    }

    // Check if column has include source
    var fullCol = getFullColumn(col.index);
    var includeIndicator = '';
    if (fullCol && fullCol.includeSource) {
      includeIndicator = '<span class="column-include-badge" title="Include: ' + escapeAttr(fullCol.includeSource.rawPath || '') + '">&#128279;</span>';
    }

    var header = document.createElement('div');
    header.className = 'column-header';
    header.innerHTML =
      '<span class="column-title">' + escapeHtml(displayTitle) + '</span>' +
      includeIndicator +
      '<span class="column-count">' + col.cards.length + '</span>' +
      '<button class="column-menu-btn" title="Column options">&#8942;</button>';
    (function (columnEl, dragEl, colIdx) {
      header.addEventListener('click', function (e) {
        if (e.target.classList.contains('column-menu-btn')) return;
        e.stopPropagation();
        columnEl.classList.toggle('folded');
        saveFoldState(activeBoardId);
      });
      header.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showColumnContextMenu(e.clientX, e.clientY, colIdx);
      });
      header.querySelector('.column-menu-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        var rect = this.getBoundingClientRect();
        showColumnContextMenu(rect.right, rect.bottom, colIdx);
      });
      if (dragEl) {
        header.addEventListener('mousedown', function (e) {
          if (e.target.classList.contains('column-menu-btn')) return;
          dragEl.draggable = true;
        });
        header.addEventListener('mouseup', function () {
          dragEl.draggable = false;
        });
      }
      header.querySelector('.column-title').addEventListener('dblclick', function (e) {
        e.stopPropagation();
        enterColumnRename(columnEl, colIdx);
      });
    })(colEl, parentDragEl, col.index);
    colEl.appendChild(header);

    var cardsEl = document.createElement('div');
    cardsEl.className = 'column-cards';
    cardsEl.setAttribute('data-col-index', col.index.toString());
    for (var j = 0; j < col.cards.length; j++) {
      var card = col.cards[j];
      var cardEl = document.createElement('div');
      cardEl.className = 'card' + (card.checked ? ' checked' : '');
      cardEl.setAttribute('data-col-index', col.index.toString());
      cardEl.setAttribute('data-card-index', j.toString());
      cardEl.setAttribute('data-card-id', card.id);
      var firstTag = getFirstTag(card.content);
      if (firstTag) cardEl.style.borderLeftColor = getTagColor(firstTag);
      var isCollapsed = expandedCards.indexOf(card.id) === -1;
      if (isCollapsed) cardEl.classList.add('collapsed');

      // --- Card Header Row ---
      var headerRow = document.createElement('div');
      headerRow.className = 'card-header';

      var dragHandle = document.createElement('div');
      dragHandle.className = 'card-drag-handle';
      dragHandle.textContent = '\u22EE\u22EE';
      dragHandle.title = 'Drag to move card';
      headerRow.appendChild(dragHandle);

      var toggle = document.createElement('span');
      toggle.className = 'card-collapse-toggle' + (isCollapsed ? '' : ' expanded');
      toggle.textContent = '\u25B6';
      (function (toggleEl, el) {
        toggleEl.addEventListener('click', function (e) {
          e.stopPropagation();
          el.classList.toggle('collapsed');
          toggleEl.classList.toggle('expanded');
          saveCardCollapseState(activeBoardId);
        });
      })(toggle, cardEl);
      headerRow.appendChild(toggle);

      var titleContainer = document.createElement('div');
      titleContainer.className = 'card-title-container';
      var titleDisplay = document.createElement('div');
      titleDisplay.className = 'card-title-display';
      titleDisplay.innerHTML = renderTitleInline(getCardTitle(card.content));
      titleContainer.appendChild(titleDisplay);
      headerRow.appendChild(titleContainer);

      var menuBtn = document.createElement('button');
      menuBtn.className = 'card-menu-btn';
      menuBtn.textContent = '\u2630';
      menuBtn.title = 'Card options';
      headerRow.appendChild(menuBtn);

      cardEl.appendChild(headerRow);

      // --- Card Content Body ---
      var contentBody = document.createElement('div');
      contentBody.className = 'card-content';
      contentBody.innerHTML = renderCardContent(card.content, activeBoardId);
      cardEl.appendChild(contentBody);

      (function (el, ci, cj, btn) {
        el.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          e.stopPropagation();
          showCardContextMenu(e.clientX, e.clientY, ci, cj);
        });
        el.addEventListener('change', function (e) {
          if (!e.target.classList.contains('card-checkbox')) return;
          e.stopPropagation();
          toggleCheckbox(ci, cj, parseInt(e.target.getAttribute('data-line'), 10), e.target.checked);
        });
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var rect = btn.getBoundingClientRect();
          showCardContextMenu(rect.right, rect.bottom, ci, cj);
        });
      })(cardEl, col.index, j, menuBtn);
      cardsEl.appendChild(cardEl);
    }
    colEl.appendChild(cardsEl);

    var footer = document.createElement('div');
    footer.className = 'column-footer';

    if (addCardColumn === col.index) {
      footer.innerHTML =
        '<textarea class="add-card-input" placeholder="Card content..." autofocus></textarea>' +
        '<div class="add-card-actions">' +
        '<button class="btn-small btn-primary add-card-submit">Add</button>' +
        '<button class="btn-small btn-cancel add-card-cancel">Cancel</button>' +
        '</div>';

      (function (colIndex) {
        var textarea = footer.querySelector('.add-card-input');
        footer.querySelector('.add-card-submit').addEventListener('click', function () {
          submitCard(colIndex, textarea.value);
        });
        footer.querySelector('.add-card-cancel').addEventListener('click', function () {
          addCardColumn = null;
          renderColumns();
        });
        textarea.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            submitCard(colIndex, textarea.value);
          }
          if (e.key === 'Escape') {
            addCardColumn = null;
            renderColumns();
          }
        });
        requestAnimationFrame(function () { textarea.focus(); });
      })(col.index);
    } else {
      var btn = document.createElement('button');
      btn.className = 'add-card-btn';
      btn.textContent = '+ Add card';
      (function (colIndex) {
        btn.addEventListener('click', function () {
          addCardColumn = colIndex;
          renderColumns();
        });
      })(col.index);
      footer.appendChild(btn);
    }

    colEl.appendChild(footer);
    return colEl;
  }

  function renderColumns() {
    unfocusCard();
    $columnsContainer.innerHTML = '';
    if (!activeBoardData) return;

    if (activeBoardData.rows && activeBoardData.rows.length > 0) {
      renderNewFormatBoard();
    } else {
      renderLegacyColumns();
    }
    // Process any queued mermaid diagrams after rendering
    if (pendingMermaidRenders.length > 0) {
      if (mermaidReady) {
        processMermaidQueue();
      } else {
        loadMermaidLibrary();
      }
    }
  }

  /**
   * Render legacy flat-column format with column groups (#stack tags).
   */
  function renderLegacyColumns() {
    $columnsContainer.classList.remove('new-format');
    var columns = getOrderedItems(activeBoardData.columns, 'lexera-col-order:' + activeBoardId, function (c) { return c.title; });
    var groups = buildColumnGroups(columns);
    var foldedCols = getFoldedColumns(activeBoardId);
    var expandedCards = getExpandedCards(activeBoardId);

    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var groupEl = document.createElement('div');
      groupEl.className = 'column-group';
      groupEl.setAttribute('data-group-index', g.toString());

      for (var c = 0; c < group.columns.length; c++) {
        var col = group.columns[c];
        var colEl = buildColumnElement(col, foldedCols, expandedCards, groupEl);
        groupEl.appendChild(colEl);
      }

      // Column group DnD handlers
      (function (groupIndex) {
        groupEl.addEventListener('dragstart', function (e) {
          if (e.target.closest('.card')) return;
          dragSource = { type: 'column-group', index: groupIndex };
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', '');
          this.classList.add('dragging');
        });

        groupEl.addEventListener('dragover', function (e) {
          if (!dragSource || dragSource.type !== 'column-group') return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          var allGroups = $columnsContainer.querySelectorAll('.column-group');
          for (var k = 0; k < allGroups.length; k++) {
            allGroups[k].classList.remove('drag-over-left', 'drag-over-right');
          }
          var rect = this.getBoundingClientRect();
          if (e.clientX < rect.left + rect.width / 2) {
            this.classList.add('drag-over-left');
          } else {
            this.classList.add('drag-over-right');
          }
        });

        groupEl.addEventListener('drop', function (e) {
          e.preventDefault();
          if (!dragSource || dragSource.type !== 'column-group') return;
          var sourceIdx = dragSource.index;
          var targetIdx = groupIndex;
          if (sourceIdx === targetIdx) return;
          var rect = this.getBoundingClientRect();
          var insertBefore = e.clientX < rect.left + rect.width / 2;
          reorderColumnGroups(sourceIdx, targetIdx, insertBefore);
        });

        groupEl.addEventListener('dragend', function () {
          this.classList.remove('dragging');
          this.draggable = false;
          var allGroups = $columnsContainer.querySelectorAll('.column-group');
          for (var k = 0; k < allGroups.length; k++) {
            allGroups[k].classList.remove('drag-over-left', 'drag-over-right');
          }
          dragSource = null;
        });
      })(g);

      $columnsContainer.appendChild(groupEl);
    }
  }

  /**
   * Render new-format board with rows → stacks → columns hierarchy.
   */
  function renderNewFormatBoard() {
    $columnsContainer.classList.add('new-format');
    var rows = activeBoardData.rows;
    var foldedCols = getFoldedColumns(activeBoardId);
    var foldedRows = getFoldedItems(activeBoardId, 'row');
    var foldedStacks = getFoldedItems(activeBoardId, 'stack');
    var expandedCards = getExpandedCards(activeBoardId);

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var rowEl = document.createElement('div');
      rowEl.className = 'board-row';
      rowEl.setAttribute('data-row-title', row.title);
      rowEl.setAttribute('data-row-index', r.toString());
      if (foldedRows.indexOf(row.title) !== -1) {
        rowEl.classList.add('folded');
      }

      // Row header
      var rowHeader = document.createElement('div');
      rowHeader.className = 'board-row-header';
      var totalCards = 0;
      for (var si = 0; si < row.stacks.length; si++) {
        for (var ci = 0; ci < row.stacks[si].columns.length; ci++) {
          totalCards += row.stacks[si].columns[ci].cards.length;
        }
      }
      rowHeader.innerHTML =
        '<span class="board-row-title">' + escapeHtml(row.title) + '</span>' +
        '<span class="board-row-count">' + totalCards + '</span>';
      (function (el, rowIdx) {
        rowHeader.addEventListener('click', function (e) {
          if (e.target.closest('button')) return;
          e.stopPropagation();
          el.classList.toggle('folded');
          saveFoldState(activeBoardId);
        });
        rowHeader.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          e.stopPropagation();
          showRowContextMenu(e.clientX, e.clientY, rowIdx);
        });
        // Row drag handle
        rowHeader.addEventListener('mousedown', function (e) {
          if (e.target.closest('button')) return;
          el.draggable = true;
        });
        rowHeader.addEventListener('mouseup', function () {
          el.draggable = false;
        });
      })(rowEl, r);
      rowEl.appendChild(rowHeader);

      // Row DnD handlers
      (function (rowIdx) {
        rowEl.addEventListener('dragstart', function (e) {
          if (e.target.closest('.board-stack, .column, .card')) return;
          dragSource = { type: 'board-row', index: rowIdx };
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', '');
          this.classList.add('dragging');
        });
        rowEl.addEventListener('dragover', function (e) {
          if (!dragSource || dragSource.type !== 'board-row') return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          var allRows = $columnsContainer.querySelectorAll('.board-row');
          for (var k = 0; k < allRows.length; k++) {
            allRows[k].classList.remove('drag-over-top', 'drag-over-bottom');
          }
          var rect = this.getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) {
            this.classList.add('drag-over-top');
          } else {
            this.classList.add('drag-over-bottom');
          }
        });
        rowEl.addEventListener('drop', function (e) {
          e.preventDefault();
          if (!dragSource || dragSource.type !== 'board-row') return;
          var sourceIdx = dragSource.index;
          var targetIdx = rowIdx;
          if (sourceIdx === targetIdx) return;
          var rect = this.getBoundingClientRect();
          var insertBefore = e.clientY < rect.top + rect.height / 2;
          reorderRows(sourceIdx, targetIdx, insertBefore);
        });
        rowEl.addEventListener('dragend', function () {
          this.classList.remove('dragging');
          this.draggable = false;
          var allRows = $columnsContainer.querySelectorAll('.board-row');
          for (var k = 0; k < allRows.length; k++) {
            allRows[k].classList.remove('drag-over-top', 'drag-over-bottom');
          }
          dragSource = null;
        });
      })(r);

      // Row content container
      var rowContent = document.createElement('div');
      rowContent.className = 'board-row-content';

      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        var stackEl = document.createElement('div');
        stackEl.className = 'board-stack';
        stackEl.setAttribute('data-stack-title', stack.title);
        stackEl.setAttribute('data-row-index', r.toString());
        stackEl.setAttribute('data-stack-index', s.toString());
        if (foldedStacks.indexOf(stack.title) !== -1) {
          stackEl.classList.add('folded');
        }

        // Stack header
        var stackHeader = document.createElement('div');
        stackHeader.className = 'board-stack-header';
        stackHeader.innerHTML =
          '<span class="board-stack-title">' + escapeHtml(stack.title) + '</span>';
        (function (el, rIdx, sIdx) {
          stackHeader.addEventListener('click', function (e) {
            if (e.target.closest('button')) return;
            e.stopPropagation();
            el.classList.toggle('folded');
            saveFoldState(activeBoardId);
          });
          stackHeader.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            e.stopPropagation();
            showStackContextMenu(e.clientX, e.clientY, rIdx, sIdx);
          });
          // Stack drag handle
          stackHeader.addEventListener('mousedown', function (e) {
            if (e.target.closest('button')) return;
            el.draggable = true;
          });
          stackHeader.addEventListener('mouseup', function () {
            el.draggable = false;
          });
        })(stackEl, r, s);
        stackEl.appendChild(stackHeader);

        // Stack DnD handlers
        (function (rIdx, sIdx) {
          stackEl.addEventListener('dragstart', function (e) {
            if (e.target.closest('.column, .card')) return;
            e.stopPropagation();
            dragSource = { type: 'board-stack', rowIndex: rIdx, stackIndex: sIdx };
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', '');
            this.classList.add('dragging');
          });
          stackEl.addEventListener('dragover', function (e) {
            if (!dragSource || dragSource.type !== 'board-stack') return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            var allStacks = $columnsContainer.querySelectorAll('.board-stack');
            for (var k = 0; k < allStacks.length; k++) {
              allStacks[k].classList.remove('drag-over-left', 'drag-over-right');
            }
            var rect = this.getBoundingClientRect();
            if (e.clientX < rect.left + rect.width / 2) {
              this.classList.add('drag-over-left');
            } else {
              this.classList.add('drag-over-right');
            }
          });
          stackEl.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (!dragSource || dragSource.type !== 'board-stack') return;
            var targetRowIdx = rIdx;
            var targetStackIdx = sIdx;
            if (dragSource.rowIndex === targetRowIdx && dragSource.stackIndex === targetStackIdx) return;
            var rect = this.getBoundingClientRect();
            var insertBefore = e.clientX < rect.left + rect.width / 2;
            moveStack(dragSource.rowIndex, dragSource.stackIndex, targetRowIdx, targetStackIdx, insertBefore);
          });
          stackEl.addEventListener('dragend', function () {
            this.classList.remove('dragging');
            this.draggable = false;
            var allStacks = $columnsContainer.querySelectorAll('.board-stack');
            for (var k = 0; k < allStacks.length; k++) {
              allStacks[k].classList.remove('drag-over-left', 'drag-over-right');
            }
            dragSource = null;
          });
        })(r, s);

        // Stack content container
        var stackContent = document.createElement('div');
        stackContent.className = 'board-stack-content';

        for (var c = 0; c < stack.columns.length; c++) {
          var col = stack.columns[c];
          var colEl = buildColumnElement(col, foldedCols, expandedCards, null);
          stackContent.appendChild(colEl);
        }

        stackEl.appendChild(stackContent);
        rowContent.appendChild(stackEl);
      }

      rowEl.appendChild(rowContent);
      $columnsContainer.appendChild(rowEl);
    }
  }

  // --- New-format DnD mutations ---

  async function reorderRows(sourceIdx, targetIdx, insertBefore) {
    if (!fullBoardData) return;
    ensureNewFormat();
    pushUndo();
    var moved = fullBoardData.rows.splice(sourceIdx, 1)[0];
    // Recalculate target after removal
    var insertAt = targetIdx;
    if (sourceIdx < targetIdx) insertAt--;
    if (!insertBefore) insertAt++;
    fullBoardData.rows.splice(insertAt, 0, moved);
    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  async function moveStack(fromRowIdx, fromStackIdx, toRowIdx, toStackIdx, insertBefore) {
    if (!fullBoardData) return;
    ensureNewFormat();
    pushUndo();
    // Map display indices to fullBoardData row indices
    var fromRow = findFullDataRow(fromRowIdx);
    var toRow = findFullDataRow(toRowIdx);
    if (!fromRow || !toRow) return;

    var moved = fromRow.stacks.splice(fromStackIdx, 1)[0];
    var insertAt = toStackIdx;
    if (fromRow === toRow && fromStackIdx < toStackIdx) insertAt--;
    if (!insertBefore) insertAt++;
    toRow.stacks.splice(insertAt, 0, moved);

    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  /**
   * Find the fullBoardData row that corresponds to a display row index.
   * Matches by row title from activeBoardData.rows.
   */
  function findFullDataRow(displayRowIdx) {
    if (!activeBoardData || !activeBoardData.rows || displayRowIdx >= activeBoardData.rows.length) return null;
    var displayRow = activeBoardData.rows[displayRowIdx];
    for (var i = 0; i < fullBoardData.rows.length; i++) {
      if (fullBoardData.rows[i].id === displayRow.id) return fullBoardData.rows[i];
    }
    return null;
  }

  function findFullDataStack(displayRowIdx, displayStackIdx) {
    var row = findFullDataRow(displayRowIdx);
    if (!row || displayStackIdx >= activeBoardData.rows[displayRowIdx].stacks.length) return null;
    var displayStack = activeBoardData.rows[displayRowIdx].stacks[displayStackIdx];
    for (var i = 0; i < row.stacks.length; i++) {
      if (row.stacks[i].id === displayStack.id) return row.stacks[i];
    }
    return null;
  }

  // --- Row & Stack Context Menus ---

  var activeRowStackMenu = null;

  function closeRowStackMenu() {
    if (activeRowStackMenu) { activeRowStackMenu.remove(); activeRowStackMenu = null; }
  }

  function showRowContextMenu(x, y, rowIdx) {
    closeRowStackMenu();
    closeColumnContextMenu();
    closeCardContextMenu();
    showNativeMenu([
      { id: 'rename', label: 'Rename Row' },
      { id: 'add-stack', label: 'Add Stack' },
      { separator: true },
      { id: 'add-row-before', label: 'Add Row Before' },
      { id: 'add-row-after', label: 'Add Row After' },
      { separator: true },
      { id: 'delete', label: 'Delete Row' },
    ], x, y).then(function (action) {
      if (action) handleRowAction(action, rowIdx);
    });
  }

  function showStackContextMenu(x, y, rowIdx, stackIdx) {
    closeRowStackMenu();
    closeColumnContextMenu();
    closeCardContextMenu();
    showNativeMenu([
      { id: 'rename', label: 'Rename Stack' },
      { id: 'add-column', label: 'Add Column' },
      { separator: true },
      { id: 'delete', label: 'Delete Stack' },
    ], x, y).then(function (action) {
      if (action) handleStackAction(action, rowIdx, stackIdx);
    });
  }

  function handleRowAction(action, rowIdx) {
    if (action === 'rename') {
      renameRowOrStack('row', rowIdx);
    } else if (action === 'add-stack') {
      addStackToRow(rowIdx);
    } else if (action === 'add-row-before') {
      addRow(rowIdx);
    } else if (action === 'add-row-after') {
      addRow(rowIdx + 1);
    } else if (action === 'delete') {
      deleteRow(rowIdx);
    }
  }

  function handleStackAction(action, rowIdx, stackIdx) {
    if (action === 'rename') {
      renameRowOrStack('stack', rowIdx, stackIdx);
    } else if (action === 'add-column') {
      addColumnToStack(rowIdx, stackIdx);
    } else if (action === 'delete') {
      deleteStack(rowIdx, stackIdx);
    }
  }

  function renameRowOrStack(type, rowIdx, stackIdx) {
    ensureNewFormat();
    var selector = type === 'row'
      ? '.board-row[data-row-index="' + rowIdx + '"] .board-row-title'
      : '.board-stack[data-row-index="' + rowIdx + '"][data-stack-index="' + stackIdx + '"] .board-stack-title';
    var titleEl = $columnsContainer.querySelector(selector);
    if (!titleEl) return;
    var target = type === 'row' ? findFullDataRow(rowIdx) : findFullDataStack(rowIdx, stackIdx);
    if (!target) return;
    var currentTitle = target.title;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'column-rename-input';
    input.value = currentTitle;
    titleEl.textContent = '';
    titleEl.appendChild(input);
    input.focus();
    input.select();

    var done = false;
    function save() {
      if (done) return;
      done = true;
      var newTitle = input.value.trim();
      if (newTitle && newTitle !== currentTitle) {
        pushUndo();
        target.title = newTitle;
        saveFullBoard().then(function () {
          updateDisplayFromFullBoard();
          renderColumns();
        }).catch(function () {
          loadBoard(activeBoardId);
        });
      } else {
        titleEl.textContent = currentTitle;
      }
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { done = true; titleEl.textContent = currentTitle; }
    });
  }

  async function addRow(atIndex) {
    if (!fullBoardData) return;
    ensureNewFormat();
    pushUndo();
    var newRow = {
      id: 'row-' + Date.now(),
      title: 'New Row',
      stacks: [{ id: 'stack-' + Date.now(), title: 'Default', columns: [{ title: 'New Column', cards: [] }] }]
    };
    fullBoardData.rows.splice(atIndex, 0, newRow);
    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  async function deleteRow(rowIdx) {
    ensureNewFormat();
    var row = findFullDataRow(rowIdx);
    if (!row) return;
    var totalCards = 0;
    for (var s = 0; s < row.stacks.length; s++) {
      for (var c = 0; c < row.stacks[s].columns.length; c++) {
        totalCards += row.stacks[s].columns[c].cards.length;
      }
    }
    if (totalCards > 0) {
      if (!confirm('Delete row "' + row.title + '" and all ' + totalCards + ' cards?')) return;
    }
    pushUndo();
    var idx = fullBoardData.rows.indexOf(row);
    if (idx !== -1) fullBoardData.rows.splice(idx, 1);
    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  async function addStackToRow(rowIdx) {
    ensureNewFormat();
    var row = findFullDataRow(rowIdx);
    if (!row) return;
    pushUndo();
    row.stacks.push({
      id: 'stack-' + Date.now(),
      title: 'New Stack',
      columns: [{ title: 'New Column', cards: [] }]
    });
    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  async function deleteStack(rowIdx, stackIdx) {
    ensureNewFormat();
    var row = findFullDataRow(rowIdx);
    var stack = findFullDataStack(rowIdx, stackIdx);
    if (!row || !stack) return;
    var totalCards = 0;
    for (var c = 0; c < stack.columns.length; c++) {
      totalCards += stack.columns[c].cards.length;
    }
    if (totalCards > 0) {
      if (!confirm('Delete stack "' + stack.title + '" and all ' + totalCards + ' cards?')) return;
    }
    pushUndo();
    var idx = row.stacks.indexOf(stack);
    if (idx !== -1) row.stacks.splice(idx, 1);
    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  async function addColumnToStack(rowIdx, stackIdx) {
    ensureNewFormat();
    var stack = findFullDataStack(rowIdx, stackIdx);
    if (!stack) return;
    pushUndo();
    stack.columns.push({ title: 'New Column', cards: [] });
    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  async function submitCard(colIndex, content) {
    content = content.trim();
    if (!content || !activeBoardId) return;

    try {
      await LexeraApi.addCard(activeBoardId, colIndex, content);
      addCardColumn = null;
      await loadBoard(activeBoardId);
    } catch (err) {
      alert('Failed to add card: ' + err.message);
    }
  }

  // --- Card DnD (pointer-based, bypasses broken WebKit HTML5 DnD) ---

  var cardDrag = null; // { el, ghost, colIndex, cardIndex, startX, startY, started }
  var DRAG_THRESHOLD = 5; // px before drag actually starts

  // Single mousedown listener on the columns container (event delegation)
  $columnsContainer.addEventListener('mousedown', function (e) {
    // Only left mouse button
    if (e.button !== 0) return;
    // Don't start drag on interactive elements
    if (e.target.closest('.card-checkbox, .card-collapse-toggle, .card-menu-btn, .embed-menu-btn, .card-edit-input, a, button, textarea, input')) return;
    var cardEl = e.target.closest('.card');
    if (!cardEl) return;
    // Don't drag if in edit mode
    if (cardEl.classList.contains('editing')) return;

    cardDrag = {
      el: cardEl,
      ghost: null,
      colIndex: parseInt(cardEl.getAttribute('data-col-index'), 10),
      cardIndex: parseInt(cardEl.getAttribute('data-card-index'), 10),
      startX: e.clientX,
      startY: e.clientY,
      started: false,
    };
    e.preventDefault();
  });

  document.addEventListener('mousemove', function (e) {
    if (!cardDrag) return;

    // Check threshold before starting actual drag
    if (!cardDrag.started) {
      var dx = e.clientX - cardDrag.startX;
      var dy = e.clientY - cardDrag.startY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      cardDrag.started = true;
      startCardDrag(e);
    }

    // Move ghost
    if (cardDrag.ghost) {
      cardDrag.ghost.style.left = (e.clientX + 8) + 'px';
      cardDrag.ghost.style.top = (e.clientY - 12) + 'px';
    }

    // Find drop target
    updateCardDropTarget(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', function (e) {
    if (!cardDrag) return;
    if (!cardDrag.started) {
      // Was just a click, not a drag — enter edit mode
      var clickedCard = cardDrag.el;
      var colIndex = cardDrag.colIndex;
      var cardIndex = cardDrag.cardIndex;
      cardDrag = null;
      enterCardEditMode(clickedCard, colIndex, cardIndex);
      return;
    }
    finishCardDrag(e.clientX, e.clientY);
  });

  // Also cancel on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && cardDrag && cardDrag.started) {
      cancelCardDrag();
    }
  });

  function startCardDrag(e) {
    var el = cardDrag.el;
    el.classList.add('dragging');

    // Create ghost element
    var ghost = document.createElement('div');
    ghost.className = 'card-drag-ghost';
    var titleEl = el.querySelector('.card-title-display');
    ghost.textContent = (titleEl ? titleEl.textContent : el.textContent).substring(0, 80);
    ghost.style.width = el.offsetWidth + 'px';
    ghost.style.left = (e.clientX + 8) + 'px';
    ghost.style.top = (e.clientY - 12) + 'px';
    document.body.appendChild(ghost);
    cardDrag.ghost = ghost;

    // Clear text selection
    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  }

  function clearSidebarDropHighlights() {
    var cols = $boardList.querySelectorAll('.board-item-column.drop-target');
    for (var i = 0; i < cols.length; i++) cols[i].classList.remove('drop-target');
  }

  function findSidebarColumnAt(mx, my) {
    var cols = $boardList.querySelectorAll('.board-item-column[data-col-index]');
    for (var i = 0; i < cols.length; i++) {
      var rect = cols[i].getBoundingClientRect();
      if (mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom) {
        return cols[i];
      }
    }
    return null;
  }

  function updateCardDropTarget(mx, my) {
    clearCardDropIndicators();
    clearSidebarDropHighlights();

    // Check sidebar columns first
    var sidebarCol = findSidebarColumnAt(mx, my);
    if (sidebarCol) {
      sidebarCol.classList.add('drop-target');
      // Remove main area highlights
      var allContainers = $columnsContainer.querySelectorAll('.column-cards');
      for (var i = 0; i < allContainers.length; i++) allContainers[i].classList.remove('card-drag-over');
      return;
    }

    // Find which .column-cards container the mouse is over
    var allContainers = $columnsContainer.querySelectorAll('.column-cards');
    var targetContainer = null;
    for (var i = 0; i < allContainers.length; i++) {
      var rect = allContainers[i].getBoundingClientRect();
      if (mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom) {
        targetContainer = allContainers[i];
        break;
      }
    }

    // Remove highlight from all
    for (var i = 0; i < allContainers.length; i++) {
      allContainers[i].classList.remove('card-drag-over');
    }

    if (!targetContainer) return;
    targetContainer.classList.add('card-drag-over');

    // Find insert position within this container
    var insertIdx = findCardInsertIndex(my, targetContainer);
    showCardDropIndicator(targetContainer, insertIdx);
  }

  function finishCardDrag(mx, my) {
    clearCardDropIndicators();
    clearSidebarDropHighlights();

    // Check sidebar column drop
    var sidebarCol = findSidebarColumnAt(mx, my);
    if (sidebarCol) {
      var targetColIndex = parseInt(sidebarCol.getAttribute('data-col-index'), 10);
      if (!isNaN(targetColIndex)) {
        // Append to end of target column
        var targetCol = getFullColumn(targetColIndex);
        var insertIdx = targetCol ? targetCol.cards.filter(function (c) { return !is_archived_or_deleted(c.content); }).length : 0;
        moveCard(cardDrag.colIndex, cardDrag.cardIndex, targetColIndex, insertIdx);
      }
      cleanupCardDrag();
      return;
    }

    // Find target container in main area
    var allContainers = $columnsContainer.querySelectorAll('.column-cards');
    var targetContainer = null;
    for (var i = 0; i < allContainers.length; i++) {
      var rect = allContainers[i].getBoundingClientRect();
      if (mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom) {
        targetContainer = allContainers[i];
        break;
      }
      allContainers[i].classList.remove('card-drag-over');
    }

    if (targetContainer) {
      targetContainer.classList.remove('card-drag-over');
      var targetColIndex = parseInt(targetContainer.getAttribute('data-col-index'), 10);
      var insertIdx = findCardInsertIndex(my, targetContainer);
      moveCard(cardDrag.colIndex, cardDrag.cardIndex, targetColIndex, insertIdx);
    }

    cleanupCardDrag();
  }

  function cancelCardDrag() {
    clearCardDropIndicators();
    clearSidebarDropHighlights();
    var allContainers = $columnsContainer.querySelectorAll('.column-cards');
    for (var i = 0; i < allContainers.length; i++) {
      allContainers[i].classList.remove('card-drag-over');
    }
    cleanupCardDrag();
  }

  function cleanupCardDrag() {
    if (cardDrag) {
      if (cardDrag.el) cardDrag.el.classList.remove('dragging');
      if (cardDrag.ghost) cardDrag.ghost.remove();
      cardDrag = null;
    }
  }

  function findCardInsertIndex(mouseY, cardsEl) {
    var cards = cardsEl.querySelectorAll('.card:not(.dragging)');
    for (var i = 0; i < cards.length; i++) {
      var rect = cards[i].getBoundingClientRect();
      if (mouseY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return cards.length;
  }

  function showCardDropIndicator(cardsEl, insertIdx) {
    var indicator = document.createElement('div');
    indicator.className = 'card-drop-indicator';
    var cards = cardsEl.querySelectorAll('.card:not(.dragging)');
    if (insertIdx < cards.length) {
      cardsEl.insertBefore(indicator, cards[insertIdx]);
    } else {
      cardsEl.appendChild(indicator);
    }
  }

  function clearCardDropIndicators() {
    var indicators = document.querySelectorAll('.card-drop-indicator');
    for (var i = 0; i < indicators.length; i++) {
      indicators[i].remove();
    }
  }

  async function moveCard(fromColIdx, fromCardIdx, toColIdx, toInsertIdx) {
    if (!fullBoardData || !activeBoardId) return;
    pushUndo();
    var fromCol = getFullColumn(fromColIdx);
    var toCol = getFullColumn(toColIdx);
    if (!fromCol || !toCol) return;

    // Get the visible (non-archived) cards to find the real index in fullBoardData
    var fromFullIdx = getFullCardIndex(fromCol, fromCardIdx);
    if (fromFullIdx === -1) return;

    var card = fromCol.cards.splice(fromFullIdx, 1)[0];

    // Calculate target index in the full cards array (-1 means append)
    var toFullIdx = getFullCardIndex(toCol, toInsertIdx);
    if (toFullIdx === -1) toFullIdx = toCol.cards.length;

    toCol.cards.splice(toFullIdx, 0, card);

    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      // Reload to restore consistent state
      await loadBoard(activeBoardId);
    }
  }

  function getFullCardIndex(col, visibleIdx) {
    var visible = 0;
    for (var i = 0; i < col.cards.length; i++) {
      if (!is_archived_or_deleted(col.cards[i].content)) {
        if (visible === visibleIdx) return i;
        visible++;
      }
    }
    return -1;
  }

  // --- Card Editing ---

  function enterCardEditMode(cardEl, colIndex, cardIndex) {
    if (!fullBoardData) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return;

    isEditing = true;
    var editCancelled = false;
    cardEl.classList.add('editing');
    cardEl.classList.remove('collapsed');
    var contentEl = cardEl.querySelector('.card-content');
    if (!contentEl) {
      contentEl = document.createElement('div');
      contentEl.className = 'card-content';
      cardEl.appendChild(contentEl);
    }
    var textarea = document.createElement('textarea');
    textarea.className = 'card-edit-input';
    textarea.value = card.content;
    contentEl.innerHTML = '';
    contentEl.appendChild(textarea);

    function autoResize() {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }
    textarea.addEventListener('input', autoResize);
    requestAnimationFrame(function () {
      textarea.focus();
      autoResize();
    });

    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        textarea.blur();
      }
      if (e.key === 'Escape') {
        editCancelled = true;
        isEditing = false;
        cardEl.classList.remove('editing');
        contentEl.innerHTML = renderCardContent(card.content, activeBoardId);
        // Update title in header
        var titleEl = cardEl.querySelector('.card-title-display');
        if (titleEl) titleEl.innerHTML = renderTitleInline(getCardTitle(card.content));
        if (pendingRefresh) {
          pendingRefresh = false;
          loadBoard(activeBoardId);
        }
      }
      // Formatting shortcuts
      if (e.ctrlKey || e.metaKey) {
        var fmt = null;
        if (e.key === 'b') fmt = { wrap: '**' };
        else if (e.key === 'i') fmt = { wrap: '*' };
        else if (e.key === '`') fmt = { wrap: '`' };
        else if (e.key === 'k') fmt = { prefix: '[', suffix: '](url)' };
        if (fmt) {
          e.preventDefault();
          insertFormatting(textarea, fmt);
          autoResize();
        }
      }
    });

    textarea.addEventListener('blur', function () {
      if (editCancelled) return;
      saveCardEdit(cardEl, colIndex, fullIdx, textarea.value);
    });
  }

  function insertFormatting(textarea, fmt) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var text = textarea.value;
    var selected = text.substring(start, end);

    var replacement;
    if (fmt.wrap) {
      replacement = fmt.wrap + (selected || 'text') + fmt.wrap;
    } else {
      replacement = fmt.prefix + (selected || 'text') + fmt.suffix;
    }

    textarea.value = text.substring(0, start) + replacement + text.substring(end);

    // Place cursor: if there was a selection, select the content between markers
    if (selected) {
      var contentStart = start + (fmt.wrap ? fmt.wrap.length : fmt.prefix.length);
      textarea.setSelectionRange(contentStart, contentStart + selected.length);
    } else {
      var contentStart = start + (fmt.wrap ? fmt.wrap.length : fmt.prefix.length);
      textarea.setSelectionRange(contentStart, contentStart + 4); // select 'text'
    }
    textarea.dispatchEvent(new Event('input'));
  }

  async function saveCardEdit(cardEl, colIndex, fullCardIdx, newContent) {
    isEditing = false;
    pushUndo();
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col || !col.cards[fullCardIdx]) return;

    var oldContent = col.cards[fullCardIdx].content;
    if (newContent === oldContent) {
      cardEl.classList.remove('editing');
      var contentEl = cardEl.querySelector('.card-content');
      if (contentEl) contentEl.innerHTML = renderCardContent(oldContent, activeBoardId);
      var titleEl = cardEl.querySelector('.card-title-display');
      if (titleEl) titleEl.innerHTML = renderTitleInline(getCardTitle(oldContent));
      if (pendingRefresh) {
        pendingRefresh = false;
        loadBoard(activeBoardId);
      }
      return;
    }

    col.cards[fullCardIdx].content = newContent;
    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
    if (pendingRefresh) {
      pendingRefresh = false;
      loadBoard(activeBoardId);
    }
  }

  // --- Checkbox Toggle ---

  async function toggleCheckbox(colIndex, cardIndex, lineIndex, checked) {
    if (!fullBoardData || !activeBoardId) return;
    pushUndo();
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    if (fullIdx === -1) return;
    var card = col.cards[fullIdx];
    if (!card) return;

    var lines = card.content.split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return;
    if (checked) {
      lines[lineIndex] = lines[lineIndex].replace(/\[([ ])\]/, '[x]');
    } else {
      lines[lineIndex] = lines[lineIndex].replace(/\[([xX])\]/, '[ ]');
    }
    card.content = lines.join('\n');

    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  // --- Card Context Menu ---

  var activeCardMenu = null;

  function closeCardContextMenu() {
    if (activeCardMenu) {
      activeCardMenu.remove();
      activeCardMenu = null;
    }
  }

  function showCardContextMenu(x, y, colIndex, cardIndex) {
    closeCardContextMenu();

    // Build native menu items
    var nativeItems = [
      { id: 'edit', label: 'Edit' },
      { id: 'duplicate', label: 'Duplicate' },
      { id: 'move-up', label: 'Move Up' },
      { id: 'move-down', label: 'Move Down' },
    ];
    // "Move to Column" submenu
    var moveSubItems = [];
    if (activeBoardData) {
      for (var i = 0; i < activeBoardData.columns.length; i++) {
        var c = activeBoardData.columns[i];
        if (c.index === colIndex) continue;
        moveSubItems.push({ id: 'move-to:' + c.index, label: stripStackTag(c.title) });
      }
    }
    if (moveSubItems.length > 0) {
      nativeItems.push({ separator: true });
      nativeItems.push({ id: 'move-sub', label: 'Move to Column', items: moveSubItems });
    }
    nativeItems.push({ separator: true });
    nativeItems.push({ id: 'archive', label: 'Archive' });
    nativeItems.push({ id: 'park', label: 'Park' });
    nativeItems.push({ id: 'delete', label: 'Delete' });

    showNativeMenu(nativeItems, x, y).then(function (action) {
      if (action) handleCardMenuAction(action, colIndex, cardIndex);
    });
  }

  function handleCardMenuAction(action, colIndex, cardIndex) {
    if (action === 'edit') {
      var cardsEls = $columnsContainer.querySelectorAll('.card[data-col-index="' + colIndex + '"][data-card-index="' + cardIndex + '"]');
      if (cardsEls.length > 0) {
        enterCardEditMode(cardsEls[0], colIndex, cardIndex);
      }
    } else if (action === 'duplicate') {
      duplicateCard(colIndex, cardIndex);
    } else if (action === 'move-up') {
      if (cardIndex > 0) moveCard(colIndex, cardIndex, colIndex, cardIndex - 1);
    } else if (action === 'move-down') {
      moveCard(colIndex, cardIndex, colIndex, cardIndex + 2);
    } else if (action.indexOf('move-to:') === 0) {
      var targetCol = parseInt(action.substring(8), 10);
      moveCard(colIndex, cardIndex, targetCol, 0);
    } else if (action === 'archive') {
      tagCard(colIndex, cardIndex, '#hidden-internal-archived');
    } else if (action === 'park') {
      tagCard(colIndex, cardIndex, '#hidden-internal-parked');
    } else if (action === 'delete') {
      deleteCard(colIndex, cardIndex);
    }
  }

  async function duplicateCard(colIndex, cardIndex) {
    if (!fullBoardData || !activeBoardId) return;
    pushUndo();
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return;

    var clone = JSON.parse(JSON.stringify(card));
    clone.id = 'dup-' + Date.now();
    clone.kid = null;
    col.cards.splice(fullIdx + 1, 0, clone);

    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  async function tagCard(colIndex, cardIndex, tag) {
    if (!fullBoardData || !activeBoardId) return;
    pushUndo();
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    if (fullIdx === -1) return;
    var card = col.cards[fullIdx];
    if (!card) return;

    // Append tag to first line of content
    var lines = card.content.split('\n');
    lines[0] = lines[0] + ' ' + tag;
    card.content = lines.join('\n');

    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  async function deleteCard(colIndex, cardIndex) {
    if (!fullBoardData || !activeBoardId) return;
    pushUndo();
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    if (fullIdx < 0 || fullIdx >= col.cards.length) return;

    col.cards.splice(fullIdx, 1);

    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  // --- Column Context Menu & Operations ---

  var activeColMenu = null;

  function closeColumnContextMenu() {
    if (activeColMenu) { activeColMenu.remove(); activeColMenu = null; }
  }

  function showColumnContextMenu(x, y, colIndex) {
    closeColumnContextMenu();
    closeCardContextMenu();

    var nativeItems = [
      { id: 'rename', label: 'Rename' },
      { id: 'add-before', label: 'Add Column Before' },
      { id: 'add-after', label: 'Add Column After' },
      { separator: true },
      { id: 'fold-all', label: 'Fold All Cards' },
      { id: 'unfold-all', label: 'Unfold All Cards' },
      { separator: true },
      { id: 'sort-title', label: 'Sort by Title' },
      { id: 'sort-tag', label: 'Sort by Tag Value' },
    ];
    // "Move to Stack" submenu for new format boards
    if (isNewFormat()) {
      var stackSubItems = [];
      for (var r = 0; r < fullBoardData.rows.length; r++) {
        var row = fullBoardData.rows[r];
        for (var s = 0; s < row.stacks.length; s++) {
          stackSubItems.push({ id: 'move-to-stack-' + r + '-' + s, label: row.title + ' / ' + row.stacks[s].title });
        }
      }
      if (stackSubItems.length > 0) {
        nativeItems.push({ separator: true });
        nativeItems.push({ id: 'move-sub', label: 'Move to Stack', items: stackSubItems });
      }
    }
    nativeItems.push({ separator: true });
    nativeItems.push({ id: 'delete', label: 'Delete Column' });

    showNativeMenu(nativeItems, x, y).then(function (action) {
      if (!action) return;
      var moveMatch = action.match(/^move-to-stack-(\d+)-(\d+)$/);
      if (moveMatch) {
        moveColumnToStack(colIndex, parseInt(moveMatch[1]), parseInt(moveMatch[2]));
        return;
      }
      handleColumnAction(action, colIndex);
    });
  }

  function moveColumnToStack(colIndex, targetRowIdx, targetStackIdx) {
    if (!fullBoardData || !isNewFormat()) return;
    // Find and remove column from current location
    var col = getFullColumn(colIndex);
    if (!col) return;
    var container = findColumnContainer(colIndex);
    if (!container) return;
    pushUndo();
    var removed = container.arr.splice(container.localIdx, 1)[0];
    // Add to target stack
    var targetStack = fullBoardData.rows[targetRowIdx] && fullBoardData.rows[targetRowIdx].stacks[targetStackIdx];
    if (!targetStack) return;
    targetStack.columns.push(removed);
    saveFullBoard();
    updateDisplayFromFullBoard();
    renderColumns();
  }

  function handleColumnAction(action, colIndex) {
    if (action === 'rename') {
      var col = getFullColumn(colIndex);
      if (!col) return;
      var colEl = $columnsContainer.querySelector('.column[data-col-title="' + escapeAttr(col.title) + '"]');
      if (colEl) enterColumnRename(colEl, colIndex);
    } else if (action === 'add-before') {
      addColumn(colIndex);
    } else if (action === 'add-after') {
      addColumn(colIndex + 1);
    } else if (action === 'fold-all') {
      toggleColCards(colIndex, true);
    } else if (action === 'unfold-all') {
      toggleColCards(colIndex, false);
    } else if (action === 'sort-title') {
      sortColumnCards(colIndex, 'title');
    } else if (action === 'sort-tag') {
      sortColumnCards(colIndex, 'tag');
    } else if (action === 'delete') {
      deleteColumn(colIndex);
    }
  }

  function sortColumnCards(colIndex, mode) {
    var col = getFullColumn(colIndex);
    if (!col || col.cards.length < 2) return;
    pushUndo();
    col.cards.sort(function (a, b) {
      if (mode === 'title') {
        var titleA = a.content.split('\n')[0].toLowerCase();
        var titleB = b.content.split('\n')[0].toLowerCase();
        return titleA < titleB ? -1 : titleA > titleB ? 1 : 0;
      }
      if (mode === 'tag') {
        var numA = extractNumericTag(a.content);
        var numB = extractNumericTag(b.content);
        if (numA === null && numB === null) return 0;
        if (numA === null) return 1;
        if (numB === null) return -1;
        return numA - numB;
      }
      return 0;
    });
    saveFullBoard();
    updateDisplayFromFullBoard();
    renderColumns();
  }

  function extractNumericTag(content) {
    var lines = content.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') break;
      var match = lines[i].match(/(^|\s)#(\d+(?:\.\d+)?)/);
      if (match) return parseFloat(match[2]);
    }
    return null;
  }

  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function enterColumnRename(colEl, colIndex) {
    if (!fullBoardData) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var titleEl = colEl.querySelector('.column-title');
    if (!titleEl) return;
    var currentTitle = stripStackTag(col.title);
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'column-rename-input';
    input.value = currentTitle;
    titleEl.textContent = '';
    titleEl.appendChild(input);
    input.focus();
    input.select();

    var done = false;
    function save() {
      if (done) return;
      done = true;
      var newTitle = input.value.trim();
      if (newTitle && newTitle !== currentTitle) {
        pushUndo();
        // Preserve #stack tag if it was there
        col.title = hasStackTag(col.title) ? newTitle + ' #stack' : newTitle;
        saveFullBoard().then(function () {
          updateDisplayFromFullBoard();
          renderColumns();
        }).catch(function () {
          loadBoard(activeBoardId);
        });
      } else {
        titleEl.textContent = currentTitle;
      }
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { done = true; titleEl.textContent = currentTitle; }
    });
  }

  /**
   * Find the container array and local index for a flat column index.
   * Returns { arr: array, localIdx: number } where arr is the columns array
   * containing the column, and localIdx is its position within that array.
   */
  function findColumnContainer(flatIndex) {
    if (isNewFormat()) {
      var idx = 0;
      for (var r = 0; r < fullBoardData.rows.length; r++) {
        var row = fullBoardData.rows[r];
        for (var s = 0; s < row.stacks.length; s++) {
          var stack = row.stacks[s];
          for (var c = 0; c < stack.columns.length; c++) {
            if (idx === flatIndex) {
              return { arr: stack.columns, localIdx: c };
            }
            idx++;
          }
        }
      }
      return null;
    }
    if (flatIndex >= 0 && flatIndex < fullBoardData.columns.length) {
      return { arr: fullBoardData.columns, localIdx: flatIndex };
    }
    return null;
  }

  async function addColumn(atIndex) {
    if (!fullBoardData || !activeBoardId) return;
    pushUndo();
    var newCol = { title: 'New Column', cards: [] };
    var container = findColumnContainer(atIndex);
    if (container) {
      container.arr.splice(container.localIdx, 0, newCol);
    } else if (isNewFormat()) {
      // atIndex is past end — append to last stack of last row
      var lastRow = fullBoardData.rows[fullBoardData.rows.length - 1];
      if (lastRow && lastRow.stacks.length > 0) {
        lastRow.stacks[lastRow.stacks.length - 1].columns.push(newCol);
      }
    } else {
      fullBoardData.columns.splice(atIndex, 0, newCol);
    }
    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  async function deleteColumn(colIndex) {
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    if (col.cards.length > 0) {
      if (!confirm('Delete column "' + stripStackTag(col.title) + '" and all ' + col.cards.length + ' cards?')) return;
    }
    pushUndo();
    var container = findColumnContainer(colIndex);
    if (container) {
      container.arr.splice(container.localIdx, 1);
    }
    try {
      await saveFullBoard();
      updateDisplayFromFullBoard();
      renderColumns();
    } catch (err) {
      await loadBoard(activeBoardId);
    }
  }

  function toggleColCards(colIndex, collapse) {
    var cards = $columnsContainer.querySelectorAll('.card[data-col-index="' + colIndex + '"]');
    for (var i = 0; i < cards.length; i++) {
      if (collapse) {
        cards[i].classList.add('collapsed');
      } else {
        cards[i].classList.remove('collapsed');
      }
      var toggle = cards[i].querySelector('.card-collapse-toggle');
      if (toggle) {
        if (collapse) toggle.classList.remove('expanded');
        else toggle.classList.add('expanded');
      }
    }
    saveCardCollapseState(activeBoardId);
  }

  // Close context menus on outside click
  document.addEventListener('click', function () {
    closeColumnContextMenu();
    closeRowStackMenu();
  });

  // --- Search ---

  let searchDebounce = null;

  function onSearchInput() {
    clearTimeout(searchDebounce);
    var q = $searchInput.value.trim();
    if (!q) {
      exitSearchMode();
      return;
    }
    searchDebounce = setTimeout(function () { performSearch(q); }, 300);
  }

  async function performSearch(query) {
    try {
      searchResults = await LexeraApi.search(query);
      searchMode = true;
      renderSearchResults();
    } catch {
      // ignore search errors
    }
  }

  function exitSearchMode() {
    searchMode = false;
    searchResults = null;
    $searchResults.classList.add('hidden');
    renderMainView();
  }

  function renderSearchResults() {
    $boardHeader.classList.add('hidden');
    $columnsContainer.classList.add('hidden');
    $emptyState.classList.add('hidden');
    $searchResults.classList.remove('hidden');

    if (!searchResults || !searchResults.results.length) {
      $searchResults.innerHTML =
        '<div class="search-results-title">Search: "' + escapeHtml(searchResults ? searchResults.query : '') + '"</div>' +
        '<div class="empty-state" style="height:auto;padding:40px"><div>No results found</div></div>';
      return;
    }

    var groups = {};
    for (var i = 0; i < searchResults.results.length; i++) {
      var r = searchResults.results[i];
      var key = r.boardId;
      if (!groups[key]) groups[key] = { title: r.boardTitle, boardId: r.boardId, items: [] };
      groups[key].items.push(r);
    }

    var html = '<div class="search-results-title">Search: "' + escapeHtml(searchResults.query) + '" (' + searchResults.results.length + ' results)</div>';

    var keys = Object.keys(groups);
    for (var g = 0; g < keys.length; g++) {
      var group = groups[keys[g]];
      html += '<div class="search-group">';
      html += '<div class="search-group-title">' + escapeHtml(group.title || 'Untitled') + '</div>';

      for (var j = 0; j < group.items.length; j++) {
        var item = group.items[j];
        html += '<div class="search-result-item" data-board="' + item.boardId + '">';
        html += '<div class="search-result-column">' + escapeHtml(item.columnTitle) + '</div>';
        html += '<div class="search-result-content">' + escapeHtml(item.cardContent) + '</div>';
        html += '</div>';
      }
      html += '</div>';
    }

    $searchResults.innerHTML = html;

    var resultItems = $searchResults.querySelectorAll('.search-result-item');
    for (var k = 0; k < resultItems.length; k++) {
      resultItems[k].addEventListener('click', function () {
        var boardId = this.getAttribute('data-board');
        $searchInput.value = '';
        exitSearchMode();
        selectBoard(boardId);
      });
    }
  }

  // --- Embed Menu ---

  var activeEmbedMenu = null;

  function closeEmbedMenu() {
    if (activeEmbedMenu) {
      activeEmbedMenu.remove();
      activeEmbedMenu = null;
    }
  }

  document.addEventListener('click', function (e) {
    // Handle burger menu button clicks for embeds
    if (e.target.classList.contains('embed-menu-btn')) {
      e.stopPropagation();
      var container = e.target.closest('.embed-container');
      if (!container) return;
      showEmbedMenu(container, e.target);
      return;
    }

    // Handle action clicks in info/path-fix panels (still DOM-based)
    var actionEl = e.target.closest('[data-action]');
    if (actionEl && activeEmbedMenu && activeEmbedMenu.contains(actionEl)) {
      e.stopPropagation();
      var action = actionEl.getAttribute('data-action');
      var embedContainer = activeEmbedMenu._embedContainer;
      handleEmbedAction(action, embedContainer);
      return;
    }

    // Click outside closes info/path-fix panel
    if (activeEmbedMenu && !activeEmbedMenu.contains(e.target)) {
      closeEmbedMenu();
    }
  }, true);

  // Right-click on embeds and file links → native context menu
  document.addEventListener('contextmenu', function (e) {
    var container = e.target.closest('.embed-container');
    var link = !container ? e.target.closest('a[href]') : null;
    if (!container && !link) return;

    var filePath = container
      ? container.getAttribute('data-file-path')
      : link.getAttribute('href');
    if (!filePath) return;

    // Skip web URLs — only handle file paths
    if (/^https?:\/\//.test(filePath)) return;

    e.preventDefault();
    e.stopPropagation();

    showNativeMenu([
      { id: 'file-open', label: 'Open in System App' },
      { id: 'file-finder', label: 'Show in Finder' },
    ], e.clientX, e.clientY).then(function (action) {
      if (!action) return;
      var boardId = container
        ? container.getAttribute('data-board-id')
        : (activeBoardId || '');

      function resolveAndRun(fn) {
        if (filePath.charAt(0) !== '/' && boardId) {
          LexeraApi.request('/boards/' + boardId + '/convert-path', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cardId: '', path: filePath, to: 'absolute' }),
          }).then(function (res) { fn(res.path); }).catch(function () { fn(filePath); });
        } else {
          fn(filePath);
        }
      }

      if (action === 'file-open') resolveAndRun(openInSystem);
      else if (action === 'file-finder') resolveAndRun(showInFinder);
    });
  }, true);

  var hasTauri = !!(window.__TAURI_INTERNALS__ || (window.__TAURI__ && window.__TAURI__.core));

  function tauriInvoke(cmd, args) {
    if (window.__TAURI_INTERNALS__) {
      return window.__TAURI_INTERNALS__.invoke(cmd, args);
    }
    if (window.__TAURI__ && window.__TAURI__.core) {
      return window.__TAURI__.core.invoke(cmd, args);
    }
    return Promise.reject(new Error('Tauri not available'));
  }

  /**
   * Show a native OS context menu via Tauri. Returns selected action ID or null.
   * items: array of { id, label, separator, disabled, items (for submenus) }
   */
  function showNativeMenu(items, x, y) {
    if (!hasTauri) {
      console.warn('[menu] Tauri not available, __TAURI_INTERNALS__:', typeof window.__TAURI_INTERNALS__);
      return Promise.resolve(null);
    }
    console.log('[menu] Invoking show_context_menu at', x, y, 'with', items.length, 'items');
    return tauriInvoke('show_context_menu', { items: items, x: x, y: y }).then(function (result) {
      console.log('[menu] Result:', result);
      return result;
    }).catch(function (err) {
      console.error('[menu] Error:', err);
      return null;
    });
  }

  function showEmbedMenu(container, btn) {
    var filePath = container.getAttribute('data-file-path');
    var isAbsolute = filePath && filePath.charAt(0) === '/';
    var btnRect = btn.getBoundingClientRect();
    showNativeMenu([
      { id: 'refresh', label: 'Force Refresh' },
      { id: 'info', label: 'Info' },
      { separator: true },
      { id: 'open-system', label: 'Open in System App' },
      { id: 'show-finder', label: 'Show in Finder' },
      { id: 'path-fix', label: 'Path Fix' },
      { id: 'convert-path', label: isAbsolute ? 'Convert to Relative' : 'Convert to Absolute' },
      { separator: true },
      { id: 'delete', label: 'Delete Embed' },
    ], btnRect.right, btnRect.bottom).then(function (action) {
      if (action) handleEmbedAction(action, container);
    });
  }

  function handleEmbedAction(action, container) {
    if (!container) { closeEmbedMenu(); return; }
    var filePath = container.getAttribute('data-file-path');
    var boardId = container.getAttribute('data-board-id');

    if (action === 'refresh') {
      var media = container.querySelector('img, video, audio');
      if (media) {
        var src = media.getAttribute('src').split('?')[0];
        media.setAttribute('src', src + '?t=' + Date.now());
      }
      container.classList.remove('embed-broken');
      closeEmbedMenu();

    } else if (action === 'info') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      LexeraApi.fileInfo(boardId, filePath).then(function (info) {
        var infoMenu = document.createElement('div');
        infoMenu.className = 'embed-menu embed-info-panel';
        var sizeStr = info.size ? formatFileSize(info.size) : 'unknown';
        var dateStr = info.lastModified ? new Date(info.lastModified * 1000).toLocaleString() : 'unknown';
        infoMenu.innerHTML =
          '<div class="embed-info-title">File Info</div>' +
          '<div class="embed-info-row"><span>Name:</span> ' + escapeHtml(info.filename || '') + '</div>' +
          '<div class="embed-info-row"><span>Path:</span> ' + escapeHtml(info.path || '') + '</div>' +
          '<div class="embed-info-row"><span>Exists:</span> ' + (info.exists ? 'Yes' : 'No') + '</div>' +
          (info.exists ? (
            '<div class="embed-info-row"><span>Size:</span> ' + sizeStr + '</div>' +
            '<div class="embed-info-row"><span>Type:</span> ' + escapeHtml(info.mediaCategory || '') + '</div>' +
            '<div class="embed-info-row"><span>Modified:</span> ' + dateStr + '</div>'
          ) : '') +
          '<div class="embed-menu-item" data-action="close-info" style="margin-top:6px;text-align:center">Close</div>';
        infoMenu._embedContainer = container;
        document.body.appendChild(infoMenu);
        // Position near the container
        var cr = container.getBoundingClientRect();
        var ir = infoMenu.getBoundingClientRect();
        var ix = cr.right;
        var iy = cr.top;
        if (ix + ir.width > window.innerWidth) ix = window.innerWidth - ir.width - 4;
        if (iy + ir.height > window.innerHeight) iy = window.innerHeight - ir.height - 4;
        if (ix < 0) ix = 4;
        if (iy < 0) iy = 4;
        infoMenu.style.left = ix + 'px';
        infoMenu.style.top = iy + 'px';
        activeEmbedMenu = infoMenu;
      }).catch(function () { /* silently fail */ });

    } else if (action === 'close-info') {
      closeEmbedMenu();

    } else if (action === 'open-system') {
      closeEmbedMenu();
      if (!filePath) return;
      // Resolve to absolute path first if relative
      if (filePath.charAt(0) !== '/' && boardId) {
        LexeraApi.request('/boards/' + boardId + '/convert-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId: '', path: filePath, to: 'absolute' }),
        }).then(function (res) {
          openInSystem(res.path);
        }).catch(function () {
          openInSystem(filePath);
        });
      } else {
        openInSystem(filePath);
      }

    } else if (action === 'show-finder') {
      closeEmbedMenu();
      if (!filePath) return;
      if (filePath.charAt(0) !== '/' && boardId) {
        LexeraApi.request('/boards/' + boardId + '/convert-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId: '', path: filePath, to: 'absolute' }),
        }).then(function (res) {
          showInFinder(res.path);
        }).catch(function () {
          showInFinder(filePath);
        });
      } else {
        showInFinder(filePath);
      }

    } else if (action === 'path-fix') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      var filename = filePath.split('/').pop();
      LexeraApi.request('/boards/' + boardId + '/find-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename }),
      }).then(function (res) {
        if (!res.matches || res.matches.length === 0) {
          showPathFixResults(container, []);
          return;
        }
        showPathFixResults(container, res.matches);
      }).catch(function () { /* silently fail */ });

    } else if (action === 'convert-path') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      var isAbsolute = filePath.charAt(0) === '/';
      LexeraApi.request('/boards/' + boardId + '/convert-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: '', path: filePath, to: isAbsolute ? 'relative' : 'absolute' }),
      }).then(function (res) {
        if (res.changed) {
          container.setAttribute('data-file-path', res.path);
          var media = container.querySelector('img, video, audio');
          if (media) {
            var newSrc = LexeraApi.fileUrl(boardId, res.path);
            media.setAttribute('src', newSrc);
          }
        }
      }).catch(function () { /* silently fail */ });

    } else if (action === 'delete') {
      closeEmbedMenu();
      container.remove();

    } else if (action && action.indexOf('pick-path:') === 0) {
      var newPath = action.substring(10);
      closeEmbedMenu();
      container.setAttribute('data-file-path', newPath);
      var media = container.querySelector('img, video, audio');
      if (media && boardId) {
        var newSrc = LexeraApi.fileUrl(boardId, newPath);
        media.setAttribute('src', newSrc);
      }
      container.classList.remove('embed-broken');
    }
  }

  async function handleFileDrop(files, targetEl) {
    if (!activeBoardId) return;
    // Find which column the drop target is in
    var colIndex = 0;
    if (targetEl) {
      var colEl = targetEl.closest('.column');
      if (colEl) {
        var ci = colEl.getAttribute('data-col-index');
        if (ci !== null) colIndex = parseInt(ci, 10);
      }
    }
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      try {
        var result = await LexeraApi.uploadMedia(activeBoardId, file);
        if (result && result.filename) {
          var embedSyntax = '![' + file.name + '](' + result.filename + ')';
          var col = getFullColumn(colIndex);
          if (col) {
            pushUndo();
            col.cards.push({ id: 'card-' + Date.now() + '-' + i, content: embedSyntax, checked: false, kid: null });
            await saveFullBoard();
            updateDisplayFromFullBoard();
            renderColumns();
          }
        }
      } catch (err) {
        console.error('File upload failed:', err);
      }
    }
  }

  function openInSystem(path) {
    lexeraLog('info', 'Opening in system: ' + path);
    if (hasTauri) {
      tauriInvoke('open_in_system', { path: path }).then(function () {
        lexeraLog('info', 'Opened: ' + path);
      }).catch(function (e) {
        lexeraLog('error', 'open_in_system failed: ' + e);
        showToast('Failed to open: ' + e, 'error');
      });
    } else {
      window.open('file://' + path, '_blank');
    }
  }

  function showInFinder(path) {
    if (hasTauri) {
      tauriInvoke('show_in_folder', { path: path }).then(function (result) {
        lexeraLog('info', 'Revealed in Finder: ' + result);
      }).catch(function (e) {
        lexeraLog('error', 'Show in Finder failed: ' + e);
        showToast('Failed to reveal: ' + e, 'error');
      });
    }
  }

  function showPathFixResults(container, matches) {
    var menu = document.createElement('div');
    menu.className = 'embed-menu embed-info-panel';
    if (matches.length === 0) {
      menu.innerHTML =
        '<div class="embed-info-title">Path Fix</div>' +
        '<div class="embed-info-row">No matching files found</div>' +
        '<div class="embed-menu-item" data-action="close-info" style="margin-top:6px;text-align:center">Close</div>';
    } else {
      var html = '<div class="embed-info-title">Found ' + matches.length + ' match(es)</div>';
      for (var i = 0; i < matches.length; i++) {
        var short = matches[i].split('/').slice(-3).join('/');
        html += '<div class="embed-menu-item" data-action="pick-path:' + escapeHtml(matches[i]) + '" title="' + escapeHtml(matches[i]) + '">' + escapeHtml(short) + '</div>';
      }
      html += '<div class="embed-menu-divider"></div>';
      html += '<div class="embed-menu-item" data-action="close-info" style="text-align:center">Cancel</div>';
      menu.innerHTML = html;
    }
    menu._embedContainer = container;
    document.body.appendChild(menu);
    var cr = container.getBoundingClientRect();
    var mr = menu.getBoundingClientRect();
    var px = cr.right;
    var py = cr.top;
    if (px + mr.width > window.innerWidth) px = window.innerWidth - mr.width - 4;
    if (py + mr.height > window.innerHeight) py = window.innerHeight - mr.height - 4;
    if (px < 0) px = 4;
    if (py < 0) py = 4;
    menu.style.left = px + 'px';
    menu.style.top = py + 'px';
    activeEmbedMenu = menu;
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // --- Media Category ---

  function getMediaCategory(ext) {
    if (!ext) return 'unknown';
    ext = ext.toLowerCase();
    var cats = {
      image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif'],
      video: ['mp4', 'webm', 'mov', 'avi', 'mkv'],
      audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
      document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'json'],
    };
    for (var cat in cats) {
      if (cats[cat].indexOf(ext) !== -1) return cat;
    }
    return 'unknown';
  }

  function getFileExtension(path) {
    var dot = path.lastIndexOf('.');
    if (dot === -1 || dot === path.length - 1) return '';
    return path.substring(dot + 1).toLowerCase();
  }

  // --- Card Collapse ---

  function getExpandedCards(boardId) {
    var saved = localStorage.getItem('lexera-card-expanded:' + boardId);
    if (!saved) return [];
    try { return JSON.parse(saved); } catch (e) { return []; }
  }

  function saveCardCollapseState(boardId) {
    var expanded = [];
    var cards = $columnsContainer.querySelectorAll('.card[data-card-id]');
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].classList.contains('collapsed')) {
        expanded.push(cards[i].getAttribute('data-card-id'));
      }
    }
    localStorage.setItem('lexera-card-expanded:' + boardId, JSON.stringify(expanded));
  }

  // --- Tag Colors ---

  var TAG_COLORS = {
    '#comment': '#d4883c',
    '#note': '#c9b84e',
    '#urgent': '#e05252',
    '#feature': '#4ec98a',
    '#bug': '#e05252',
    '#todo': '#5c9cd4',
    '#done': '#4ec9b0',
    '#blocked': '#c94e7c',
    '#question': '#9b7ed4',
    '#idea': '#d4c24e',
    '#review': '#5cc9c9',
    '#wip': '#d49b4e',
  };

  var TAG_PALETTE = [
    '#d4883c', '#5c9cd4', '#4ec98a', '#c94e7c',
    '#9b7ed4', '#c9b84e', '#5cc9c9', '#d49b4e',
    '#7ed47e', '#d45c8c', '#4ec9b0', '#d4644e',
  ];

  function getTagColor(tagName) {
    var lower = tagName.toLowerCase();
    if (TAG_COLORS[lower]) return TAG_COLORS[lower];
    var hash = 0;
    for (var i = 0; i < lower.length; i++) {
      hash = ((hash << 5) - hash) + lower.charCodeAt(i);
      hash = hash & hash;
    }
    return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
  }

  function getFirstTag(content) {
    var lines = content.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') break; // end of card header
      var match = lines[i].match(/(^|\s)(#[a-zA-Z][\w-]*)/);
      if (match) return match[2];
    }
    return null;
  }

  function getCardTitle(content) {
    var lines = content.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (trimmed === '') break;
      if (/^<!--.*-->$/.test(trimmed)) continue;
      if (/^!\[/.test(trimmed)) continue; // skip image-only lines
      var headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
      if (headingMatch) return headingMatch[1];
      return trimmed;
    }
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== '') return lines[i].trim();
    }
    return '';
  }

  function renderTitleInline(text) {
    var safe = escapeHtml(text);
    // Strip image/embed markdown
    safe = safe.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
    // Tags with colored badges
    safe = safe.replace(/(^|\s)(#[a-zA-Z][\w-]*)/g, function(_, pre, tag) {
      var color = getTagColor(tag);
      return pre + '<span class="tag" style="background:' + color + ';color:#fff">' + tag + '</span>';
    });
    // Bold
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Inline code
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
    return safe;
  }

  // --- Util ---

  function renderTable(lines, startIdx, boardId) {
    var headerLine = lines[startIdx].trim();
    var sepLine = lines[startIdx + 1].trim();

    function parseCells(line) {
      // Split by | and trim, removing empty first/last from leading/trailing |
      var parts = line.split('|');
      if (parts[0].trim() === '') parts.shift();
      if (parts.length > 0 && parts[parts.length - 1].trim() === '') parts.pop();
      return parts.map(function (c) { return c.trim(); });
    }

    var headers = parseCells(headerLine);
    var seps = parseCells(sepLine);
    var aligns = seps.map(function (s) {
      if (s.charAt(0) === ':' && s.charAt(s.length - 1) === ':') return 'center';
      if (s.charAt(s.length - 1) === ':') return 'right';
      return 'left';
    });

    var out = '<table class="md-table"><thead><tr>';
    for (var h = 0; h < headers.length; h++) {
      out += '<th style="text-align:' + aligns[h] + '">' + renderInline(headers[h], boardId) + '</th>';
    }
    out += '</tr></thead><tbody>';

    for (var r = startIdx + 2; r < lines.length; r++) {
      if (lines[r].trim().indexOf('|') !== 0) break;
      var cells = parseCells(lines[r]);
      out += '<tr>';
      for (var c = 0; c < headers.length; c++) {
        var val = c < cells.length ? cells[c] : '';
        var align = c < aligns.length ? aligns[c] : 'left';
        out += '<td style="text-align:' + align + '">' + renderInline(val, boardId) + '</td>';
      }
      out += '</tr>';
    }
    out += '</tbody></table>';
    return out;
  }

  function loadMermaidLibrary() {
    if (mermaidReady || mermaidLoading) return;
    mermaidLoading = true;
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    script.onload = function () {
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose', fontFamily: 'inherit' });
      mermaidReady = true;
      mermaidLoading = false;
      processMermaidQueue();
    };
    script.onerror = function () {
      mermaidLoading = false;
      // Show error in all pending placeholders
      for (var i = 0; i < pendingMermaidRenders.length; i++) {
        var el = document.getElementById(pendingMermaidRenders[i].id);
        if (el) el.innerHTML = '<span class="mermaid-error">Failed to load Mermaid library</span>';
      }
      pendingMermaidRenders = [];
    };
    document.head.appendChild(script);
  }

  function processMermaidQueue() {
    if (!mermaidReady || pendingMermaidRenders.length === 0) return;
    var queue = pendingMermaidRenders.slice();
    pendingMermaidRenders = [];
    queue.forEach(function (item) {
      var el = document.getElementById(item.id);
      if (!el) return;
      try {
        mermaid.render(item.id + '-svg', item.code).then(function (result) {
          el.className = 'mermaid-diagram';
          el.innerHTML = result.svg;
        }).catch(function (err) {
          el.innerHTML = '<span class="mermaid-error">Mermaid error: ' + escapeHtml(err.message || String(err)) + '</span>';
        });
      } catch (err) {
        el.innerHTML = '<span class="mermaid-error">Mermaid error: ' + escapeHtml(err.message || String(err)) + '</span>';
      }
    });
  }

  function renderCardContent(content, boardId) {
    var lines = content.split('\n');
    var html = '';
    var listTag = null; // 'ul' or 'ol'

    function closeList() {
      if (listTag) { html += '</' + listTag + '>'; listTag = null; }
    }
    function openList(tag) {
      if (listTag !== tag) { closeList(); html += '<' + tag + '>'; listTag = tag; }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // Fenced code blocks: ```lang ... ```
      var fenceMatch = line.match(/^```(\w*)$/);
      if (fenceMatch) {
        closeList();
        var lang = fenceMatch[1];
        var codeLines = [];
        i++;
        while (i < lines.length && !(/^```$/.test(lines[i]))) {
          codeLines.push(lines[i]);
          i++;
        }
        if (lang.toLowerCase() === 'mermaid') {
          var mermaidId = 'mermaid-' + (++mermaidIdCounter);
          var code = codeLines.join('\n');
          html += '<div class="mermaid-placeholder" id="' + mermaidId + '">Loading diagram...</div>';
          pendingMermaidRenders.push({ id: mermaidId, code: code });
        } else {
          var langClass = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
          html += '<pre class="code-block"><code' + langClass + '>' + escapeHtml(codeLines.join('\n')) + '</code></pre>';
        }
        continue;
      }

      // Markdown tables: |col|col| with |---|---| separator
      if (line.trim().indexOf('|') === 0 && i + 1 < lines.length && /^\|[\s:]*-+/.test(lines[i + 1].trim())) {
        closeList();
        html += renderTable(lines, i, boardId);
        // Skip past table lines
        while (i < lines.length && lines[i].trim().indexOf('|') === 0) i++;
        i--; // compensate for loop increment
        continue;
      }

      // Empty line: close list if open, add line break
      if (line.trim() === '') {
        closeList();
        html += '<br>';
        continue;
      }

      // HTML comments: render as styled span (visibility controlled by board setting)
      var commentMatch = line.match(/^<!--(.+?)-->$/);
      if (commentMatch) {
        closeList();
        html += '<div class="html-comment">' + escapeHtml(commentMatch[1].trim()) + '</div>';
        continue;
      }

      // Horizontal rule
      if (/^---+$/.test(line.trim())) {
        closeList();
        html += '<hr>';
        continue;
      }

      // Blockquote
      var quoteMatch = line.match(/^>\s?(.*)/);
      if (quoteMatch) {
        closeList();
        html += '<blockquote>' + renderInline(quoteMatch[1], boardId) + '</blockquote>';
        continue;
      }

      // Headings
      var headingMatch = line.match(/^(#{1,3})\s+(.+)/);
      if (headingMatch) {
        closeList();
        var level = headingMatch[1].length;
        html += '<h' + level + '>' + renderInline(headingMatch[2], boardId) + '</h' + level + '>';
        continue;
      }

      // Checkbox list items (must be checked BEFORE unordered list)
      var checkMatch = line.match(/^-\s+\[([ xX])\]\s*(.*)/);
      if (checkMatch) {
        openList('ul');
        var checked = checkMatch[1] !== ' ';
        var checkedAttr = checked ? ' checked' : '';
        var strikePre = checked ? '<s>' : '';
        var strikePost = checked ? '</s>' : '';
        html += '<li class="checkbox-item"><input type="checkbox" class="card-checkbox" data-line="' + i + '"' + checkedAttr + '> ' + strikePre + renderInline(checkMatch[2], boardId) + strikePost + '</li>';
        continue;
      }

      // Ordered list items
      var olMatch = line.match(/^\d+\.\s+(.+)/);
      if (olMatch) {
        openList('ol');
        html += '<li>' + renderInline(olMatch[1], boardId) + '</li>';
        continue;
      }

      // Unordered list items
      var listMatch = line.match(/^[-*]\s+(.+)/);
      if (listMatch) {
        openList('ul');
        html += '<li>' + renderInline(listMatch[1], boardId) + '</li>';
        continue;
      }

      // Regular line
      closeList();
      html += '<div>' + renderInline(line, boardId) + '</div>';
    }

    closeList();
    return html;
  }

  function renderInline(text, boardId) {
    var safe = escapeHtml(text);

    // Embeds: ![alt](path "optional title") — wrap in embed container with media category detection
    safe = safe.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, rawSrc) {
      // Strip optional title: path "title" or path &quot;title&quot;
      var src = rawSrc.replace(/\s+(&quot;|")[^"]*(&quot;|")$/, '').trim();
      var ext = getFileExtension(src);
      var category = getMediaCategory(ext);
      var isExternal = src.indexOf('http') === 0 || src.indexOf('data:') === 0;
      var filePath = src;

      // Relative paths go through the API file endpoint
      if (!isExternal && boardId) {
        src = LexeraApi.fileUrl(boardId, rawSrc);
      }

      var inner = '';
      if (category === 'image') {
        inner = '<img src="' + src + '" alt="' + alt + '" loading="lazy" onerror="this.parentElement.classList.add(\'embed-broken\')">';
      } else if (category === 'video') {
        inner = '<video controls preload="metadata" src="' + src + '" onerror="this.parentElement.classList.add(\'embed-broken\')"></video>';
      } else if (category === 'audio') {
        inner = '<audio controls preload="metadata" src="' + src + '" onerror="this.parentElement.classList.add(\'embed-broken\')"></audio>';
      } else if (category === 'document') {
        var filename = rawSrc.split('/').pop();
        inner = '<span class="embed-file-link">&#128196; ' + escapeHtml(filename) + '</span>';
      } else {
        var filename = rawSrc.split('/').pop();
        inner = '<span class="embed-file-link">&#128206; ' + escapeHtml(filename) + '</span>';
      }

      return '<span class="embed-container" data-file-path="' + escapeHtml(filePath) + '" data-board-id="' + (boardId || '') + '" data-media-type="' + category + '">' +
        inner +
        '<button class="embed-menu-btn" title="Embed actions">&#8942;</button>' +
        '</span>';
    });

    // Links: [text](url)
    safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Wiki links: [[text]]
    safe = safe.replace(/\[\[([^\]]+)\]\]/g, '<span class="wiki-link">$1</span>');

    // Bold: **text**
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic: *text*
    safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Strikethrough: ~~text~~
    safe = safe.replace(/~~([^~]+)~~/g, '<s>$1</s>');

    // Inline code: `code`
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Tags: #tag-name (word boundary, not inside HTML attributes)
    safe = safe.replace(/(^|\s)(#[a-zA-Z][\w-]*)/g, function(_, pre, tag) {
      var color = getTagColor(tag);
      return pre + '<span class="tag" style="background:' + color + ';color:#fff">' + tag + '</span>';
    });

    // Temporal tags: @today, @tomorrow, @date(YYYY-MM-DD), @days+N, @weekday
    safe = safe.replace(/(^|\s)(@(?:today|tomorrow|yesterday|date\([^)]+\)|days[+-]\d+|monday|tuesday|wednesday|thursday|friday|saturday|sunday))/gi, function (_, pre, tag) {
      var resolved = resolveTemporalTag(tag);
      return pre + '<span class="temporal-tag" title="' + resolved + '">' + tag + '</span>';
    });

    return safe;
  }

  function resolveTemporalTag(tag) {
    var lower = tag.toLowerCase();
    var now = new Date();
    now.setHours(0, 0, 0, 0);

    if (lower === '@today') return formatDate(now);
    if (lower === '@tomorrow') { now.setDate(now.getDate() + 1); return formatDate(now); }
    if (lower === '@yesterday') { now.setDate(now.getDate() - 1); return formatDate(now); }

    var daysMatch = lower.match(/@days([+-])(\d+)/);
    if (daysMatch) {
      var offset = parseInt(daysMatch[2], 10) * (daysMatch[1] === '+' ? 1 : -1);
      now.setDate(now.getDate() + offset);
      return formatDate(now);
    }

    var dateMatch = tag.match(/@date\((\d{4}-\d{2}-\d{2})\)/i);
    if (dateMatch) return dateMatch[1];

    var weekdays = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    var dayName = lower.substring(1); // strip @
    if (weekdays[dayName] !== undefined) {
      var target = weekdays[dayName];
      var current = now.getDay();
      var diff = target - current;
      if (diff <= 0) diff += 7;
      now.setDate(now.getDate() + diff);
      return formatDate(now);
    }

    return tag;
  }

  function formatDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { poll: poll };
})();
