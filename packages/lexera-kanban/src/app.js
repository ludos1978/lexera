/**
 * Lexera Log — Status bar + dedicated frontend/backend log views.
 */
var frontendLogEntries = [];
var backendLogEntries = [];
var LOG_MAX = 1000;
var storedLogSource = localStorage.getItem('lexera-log-source');
var activeLogSource = storedLogSource === 'backend' ? 'backend' : 'frontend';
var backendLogLoaded = false;
var backendLogEventSource = null;
var backendLogConnectPending = false;

var elStatusMsg = null;
var elStatusBar = null;
var elLogEntriesBackend = null;
var elLogEntriesFrontend = null;
var elLogPanel = null;
var elLogTabBackend = null;
var elLogTabFrontend = null;
var elLogRefreshBtn = null;
var elLogClearBtn = null;
var elLogCloseBtn = null;

function getElStatusMsg() { return elStatusMsg || (elStatusMsg = document.getElementById('status-msg')); }
function getElStatusBar() { return elStatusBar || (elStatusBar = document.getElementById('status-bar')); }
function getElLogEntriesBackend() { return elLogEntriesBackend || (elLogEntriesBackend = document.getElementById('log-entries-backend')); }
function getElLogEntriesFrontend() { return elLogEntriesFrontend || (elLogEntriesFrontend = document.getElementById('log-entries-frontend')); }
function getElLogPanel() { return elLogPanel || (elLogPanel = document.getElementById('log-panel')); }
function getElLogTabBackend() { return elLogTabBackend || (elLogTabBackend = document.getElementById('log-tab-backend')); }
function getElLogTabFrontend() { return elLogTabFrontend || (elLogTabFrontend = document.getElementById('log-tab-frontend')); }
function getElLogRefreshBtn() { return elLogRefreshBtn || (elLogRefreshBtn = document.getElementById('log-refresh-btn')); }
function getElLogClearBtn() { return elLogClearBtn || (elLogClearBtn = document.getElementById('log-clear-btn')); }
function getElLogCloseBtn() { return elLogCloseBtn || (elLogCloseBtn = document.getElementById('log-close-btn')); }

var elBoardList = null;
var elBoardHeader = null;
var elColumnsContainer = null;
var elSearchResults = null;
var elEmptyState = null;
var elConnectionDot = null;
var elMainContent = null;
var elLayout = null;
var elSidebar = null;
var elSidebarDashboardDivider = null;
var elSidebarWidthDivider = null;
var elDashboardRoot = null;
var elDashboardSearchInput = null;
var elDashboardSearchBtn = null;
var elDashboardScopeSelect = null;
var elDashboardPinBtn = null;
var elInspectorBtn = null;
var elDashboardPinnedList = null;
var elDashboardResultsList = null;
var elDashboardDeadlineList = null;
var elDashboardOverdueList = null;
var elMgmtPanel = null;
var elMgmtPanelBody = null;
var elBtnSidebarSync = null;
var elMgmtClose = null;
var elHeaderActions = null;
var elSidebarLockBtn = null;
var elSidebarHeader = null;

function getElBoardList() { return elBoardList || (elBoardList = document.getElementById('board-list')); }
function getElBoardHeader() { return elBoardHeader || (elBoardHeader = document.getElementById('board-header')); }
function getElColumnsContainer() { return elColumnsContainer || (elColumnsContainer = document.getElementById('columns-container')); }
function getElSearchResults() { return elSearchResults || (elSearchResults = document.getElementById('search-results')); }
function getElEmptyState() { return elEmptyState || (elEmptyState = document.getElementById('empty-state')); }
function getElConnectionDot() { return elConnectionDot || (elConnectionDot = document.getElementById('connection-dot')); }
function getElMainContent() { return elMainContent || (elMainContent = document.getElementById('main-content')); }
function getElLayout() { return elLayout || (elLayout = document.querySelector('.layout')); }
function getElSidebar() { return elSidebar || (elSidebar = document.querySelector('.sidebar')); }
function getElSidebarDashboardDivider() { return elSidebarDashboardDivider || (elSidebarDashboardDivider = document.getElementById('sidebar-dashboard-divider')); }
function getElSidebarWidthDivider() { return elSidebarWidthDivider || (elSidebarWidthDivider = document.getElementById('sidebar-width-divider')); }
function getElDashboardRoot() { return elDashboardRoot || (elDashboardRoot = document.getElementById('sidebar-dashboard')); }
function getElDashboardSearchInput() { return elDashboardSearchInput || (elDashboardSearchInput = document.getElementById('dashboard-search-input')); }
function getElDashboardSearchBtn() { return elDashboardSearchBtn || (elDashboardSearchBtn = document.getElementById('btn-dashboard-search')); }
function getElDashboardScopeSelect() { return elDashboardScopeSelect || (elDashboardScopeSelect = document.getElementById('dashboard-scope-select')); }
function getElDashboardPinBtn() { return elDashboardPinBtn || (elDashboardPinBtn = document.getElementById('btn-dashboard-pin')); }
function getElInspectorBtn() { return elInspectorBtn || (elInspectorBtn = document.getElementById('btn-inspector')); }
function getElDashboardPinnedList() { return elDashboardPinnedList || (elDashboardPinnedList = document.getElementById('dashboard-pinned-list')); }
function getElDashboardResultsList() { return elDashboardResultsList || (elDashboardResultsList = document.getElementById('dashboard-results-list')); }
function getElDashboardDeadlineList() { return elDashboardDeadlineList || (elDashboardDeadlineList = document.getElementById('dashboard-deadline-list')); }
function getElDashboardOverdueList() { return elDashboardOverdueList || (elDashboardOverdueList = document.getElementById('dashboard-overdue-list')); }
function getElMgmtPanel() { return elMgmtPanel || (elMgmtPanel = document.getElementById('mgmt-panel')); }
function getElMgmtPanelBody() { return elMgmtPanelBody || (elMgmtPanelBody = document.getElementById('mgmt-panel-body')); }
function getElBtnSidebarSync() { return elBtnSidebarSync || (elBtnSidebarSync = document.getElementById('btn-sidebar-sync')); }
function getElMgmtClose() { return elMgmtClose || (elMgmtClose = document.getElementById('mgmt-close')); }
function getElHeaderActions() { return elHeaderActions || (elHeaderActions = document.querySelector('.header-actions')); }
function getElSidebarLockBtn() { return elSidebarLockBtn || (elSidebarLockBtn = document.getElementById('btn-sidebar-lock')); }
function getElSidebarHeader() { var s = getElSidebar(); return elSidebarHeader || (elSidebarHeader = s ? s.querySelector('.sidebar-header') : null); }

function normalizeLogMessage(message) {
  if (message == null) return String(message);
  if (typeof message === 'string') return message;
  if (message instanceof Error) return formatErrorDetails(message);
  if (typeof message === 'object') {
    if (typeof message.message === 'string' && message.message) {
      return formatErrorDetails(message);
    }
    try {
      return JSON.stringify(message);
    } catch (e) {
      return String(message);
    }
  }
  return String(message);
}

function formatErrorDetails(error) {
  if (error == null) return String(error);
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    if (error.stack) return String(error.stack);
    return error.name && error.message
      ? (error.name + ': ' + error.message)
      : (error.message || String(error));
  }
  if (typeof error === 'object') {
    if (error.reason && error.reason !== error) {
      return formatErrorDetails(error.reason);
    }
    if (typeof error.stack === 'string' && error.stack) return error.stack;
    if (typeof error.message === 'string' && error.message) return error.message;
    try {
      return JSON.stringify(error);
    } catch (e) {
      return String(error);
    }
  }
  return String(error);
}

function joinLogArgs(argsLike) {
  var parts = Array.prototype.slice.call(argsLike || []);
  if (!parts.length) return '';
  return parts.map(function (value) {
    return normalizeLogMessage(value);
  }).join(' ');
}

function getLogEntries(source) {
  return source === 'backend' ? backendLogEntries : frontendLogEntries;
}

function escapeLogHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getLogContainer(source) {
  return source === 'backend' ? getElLogEntriesBackend() : getElLogEntriesFrontend();
}

function formatLogTimestamp(entry) {
  return new Date(entry.timestampMs || Date.now()).toLocaleTimeString('en-GB', { hour12: false });
}

function logEntryKey(entry) {
  return [
    entry.level || '',
    entry.target || '',
    entry.message || ''
  ].join('|');
}

function setStatusBarEntry(source, entry) {
  var statusMsg = getElStatusMsg();
  var statusBar = getElStatusBar();
  if (!statusMsg || !statusBar) return;
  var prefix = source === 'backend' ? '[backend] ' : '';
  statusMsg.textContent = prefix + entry.message;
  statusBar.className = 'status-bar status-' + entry.level;
}

function renderLogEntry(source, entry) {
  var el = document.createElement('div');
  el.className = 'log-entry log-' + entry.level;
  el.innerHTML =
    '<span class="log-time">' + escapeLogHtml(formatLogTimestamp(entry)) + '</span>' +
    '<span class="log-level">' + escapeLogHtml(String(entry.level || '').toUpperCase()) + '</span>' +
    '<span class="log-entry-source">' + escapeLogHtml(source) + '</span>' +
    '<span class="log-entry-target">' + escapeLogHtml(entry.target || (source === 'backend' ? 'backend' : 'frontend')) + '</span>' +
    '<span class="log-msg">' + escapeLogHtml(entry.message) + '</span>';
  return el;
}

function appendLogEntry(source, entry) {
  var entries = getLogEntries(source);
  if (entries.length > 0 && logEntryKey(entries[entries.length - 1]) === logEntryKey(entry)) {
    return;
  }

  entries.push(entry);
  if (entries.length > LOG_MAX) entries.shift();

  setStatusBarEntry(source, entry);

  var panel = getLogContainer(source);
  if (panel) {
    while (panel.childNodes.length >= LOG_MAX) {
      panel.removeChild(panel.firstChild);
    }
    panel.appendChild(renderLogEntry(source, entry));
    panel.scrollTop = panel.scrollHeight;
  }
}

function replaceLogEntries(source, entries) {
  var nextEntries = (entries || []).slice(-LOG_MAX);
  var target = getLogEntries(source);
  target.length = 0;
  Array.prototype.push.apply(target, nextEntries);

  var panel = getLogContainer(source);
  if (!panel) return;
  panel.innerHTML = '';
  for (var i = 0; i < nextEntries.length; i++) {
    panel.appendChild(renderLogEntry(source, nextEntries[i]));
  }
  panel.scrollTop = panel.scrollHeight;
}

function setActiveLogSource(source) {
  activeLogSource = source === 'frontend' ? 'frontend' : 'backend';
  localStorage.setItem('lexera-log-source', activeLogSource);

  var backendBtn = getElLogTabBackend();
  var frontendBtn = getElLogTabFrontend();
  var backendPanel = getLogContainer('backend');
  var frontendPanel = getLogContainer('frontend');
  var refreshBtn = getElLogRefreshBtn();

  if (backendBtn) backendBtn.classList.toggle('active', activeLogSource === 'backend');
  if (frontendBtn) frontendBtn.classList.toggle('active', activeLogSource === 'frontend');
  if (backendPanel) backendPanel.classList.toggle('hidden', activeLogSource !== 'backend');
  if (frontendPanel) frontendPanel.classList.toggle('hidden', activeLogSource !== 'frontend');
  if (refreshBtn) refreshBtn.style.display = activeLogSource === 'backend' ? '' : 'none';
}

function lexeraLogWithTarget(level, target, message) {
  appendLogEntry('frontend', {
    timestampMs: Date.now(),
    level: level,
    target: target || 'frontend',
    message: normalizeLogMessage(message)
  });
}

function lexeraLog(level, message) {
  lexeraLogWithTarget(level, 'frontend', message);
}

function logFrontendIssue(level, target, context, error) {
  var detail = error == null ? '' : formatErrorDetails(error);
  var message = detail ? (context + ': ' + detail) : context;
  lexeraLogWithTarget(level, target, message);
}

function formatTraceDetails(details) {
  if (details == null) return '';
  var normalized = normalizeLogMessage(details);
  return normalized ? (' ' + normalized) : '';
}

function traceFrontendAction(level, target, message, details) {
  lexeraLogWithTarget(level, target, message + formatTraceDetails(details));
}

function summarizeMenuItems(items) {
  var result = [];
  if (!Array.isArray(items)) return result;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item) continue;
    if (item.separator) {
      result.push('---');
      continue;
    }
    var label = item.id || item.label || ('item-' + i);
    if (Array.isArray(item.items) && item.items.length > 0) {
      result.push(label + '[' + item.items.length + ']');
    } else {
      result.push(label);
    }
  }
  return result;
}

function summarizeBoardHierarchy(boardData) {
  var summary = { rows: 0, stacks: 0, columns: 0, cards: 0 };
  if (!boardData || !Array.isArray(boardData.rows)) return summary;
  summary.rows = boardData.rows.length;
  for (var r = 0; r < boardData.rows.length; r++) {
    var row = boardData.rows[r];
    var stacks = row && Array.isArray(row.stacks) ? row.stacks : [];
    summary.stacks += stacks.length;
    for (var s = 0; s < stacks.length; s++) {
      var cols = stacks[s] && Array.isArray(stacks[s].columns) ? stacks[s].columns : [];
      summary.columns += cols.length;
      for (var c = 0; c < cols.length; c++) {
        summary.cards += Array.isArray(cols[c].cards) ? cols[c].cards.length : 0;
      }
    }
  }
  return summary;
}

function lexeraBackendLog(entry) {
  appendLogEntry('backend', {
    timestampMs: entry && entry.timestampMs ? entry.timestampMs : Date.now(),
    level: entry && entry.level ? entry.level : 'info',
    target: entry && entry.target ? entry.target : 'backend',
    message: normalizeLogMessage(entry && entry.message ? entry.message : '')
  });
}

function refreshBackendLogs() {
  if (!window.LexeraApi || typeof LexeraApi.getLogs !== 'function') return Promise.resolve();
  return LexeraApi.getLogs().then(function (data) {
    replaceLogEntries('backend', data && data.entries ? data.entries : []);
    backendLogLoaded = true;
  }).catch(function (err) {
    lexeraLog('warn', '[backend.log] Failed to load backend logs: ' + err.message);
  });
}

function openBackendLogStream() {
  if (backendLogEventSource || !window.LexeraApi || typeof LexeraApi.connectLogStream !== 'function') return;
  backendLogEventSource = LexeraApi.connectLogStream(function (entry) {
    backendLogLoaded = true;
    lexeraBackendLog(entry);
  });
  if (!backendLogEventSource) return;
  backendLogEventSource.onerror = function () {
    if (backendLogEventSource) backendLogEventSource.close();
    backendLogEventSource = null;
    setTimeout(connectBackendLogStreamIfReady, 1500);
  };
}

function connectBackendLogStreamIfReady() {
  if (backendLogEventSource || backendLogConnectPending || !window.LexeraApi || typeof LexeraApi.discover !== 'function') {
    return;
  }
  backendLogConnectPending = true;
  LexeraApi.discover().then(function (url) {
    backendLogConnectPending = false;
    if (!url) return;
    var ready = backendLogLoaded ? Promise.resolve() : refreshBackendLogs();
    ready.finally(function () {
      openBackendLogStream();
    });
  }).catch(function (err) {
    logFrontendIssue('warn', 'backend.log.stream', 'Failed to connect backend log stream', err);
    backendLogConnectPending = false;
  });
}

window.connectBackendLogStreamIfReady = connectBackendLogStreamIfReady;

// Intercept console.log/warn/error
(function () {
  var origLog = console.log, origWarn = console.warn, origError = console.error;
  console.log = function () {
    origLog.apply(console, arguments);
    lexeraLogWithTarget('info', 'console.log', joinLogArgs(arguments));
  };
  console.warn = function () {
    origWarn.apply(console, arguments);
    lexeraLogWithTarget('warn', 'console.warn', joinLogArgs(arguments));
  };
  console.error = function () {
    origError.apply(console, arguments);
    lexeraLogWithTarget('error', 'console.error', joinLogArgs(arguments));
  };
})();

// Catch unhandled errors
window.addEventListener('error', function (e) {
  var location = '';
  if (e && e.filename) {
    location = ' at ' + e.filename + ':' + (e.lineno || 0);
    if (e.colno) location += ':' + e.colno;
  }
  var detail = e && e.error ? formatErrorDetails(e.error) : (e && e.message ? e.message : 'Unknown error');
  lexeraLogWithTarget('error', 'window.error', 'Uncaught' + location + ': ' + detail);
});
window.addEventListener('unhandledrejection', function (e) {
  var reason = e && Object.prototype.hasOwnProperty.call(e, 'reason') ? e.reason : e;
  lexeraLogWithTarget('error', 'window.unhandledrejection', 'Unhandled promise rejection: ' + formatErrorDetails(reason));
});

function updateAppBottomInset() {
  var root = document.documentElement;
  if (!root) return;
  // Bottom bars now participate in normal layout flow (no fixed overlay).
  root.style.setProperty('--app-bottom-inset', '0px');
}

window.updateAppBottomInset = updateAppBottomInset;
window.addEventListener('resize', updateAppBottomInset);

// Log panel + status bar UI
document.addEventListener('DOMContentLoaded', function () {
  var panel = getElLogPanel();
  var statusBar = getElStatusBar();
  var refreshBtn = getElLogRefreshBtn();
  var clearBtn = getElLogClearBtn();
  var closeBtn = getElLogCloseBtn();
  var backendTab = getElLogTabBackend();
  var frontendTab = getElLogTabFrontend();
  updateAppBottomInset();

  // Click status bar to expand/collapse log panel
  if (statusBar) statusBar.addEventListener('click', function () {
    if (panel) panel.classList.toggle('hidden');
    updateAppBottomInset();
  });

  if (refreshBtn) refreshBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    refreshBackendLogs();
  });

  if (clearBtn) clearBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    replaceLogEntries(activeLogSource, []);
  });
  if (closeBtn) closeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    panel.classList.add('hidden');
    updateAppBottomInset();
  });
  if (backendTab) backendTab.addEventListener('click', function (e) {
    e.stopPropagation();
    setActiveLogSource('backend');
  });
  if (frontendTab) frontendTab.addEventListener('click', function (e) {
    e.stopPropagation();
    setActiveLogSource('frontend');
  });

  replaceLogEntries('frontend', frontendLogEntries);
  replaceLogEntries('backend', backendLogEntries);
  setActiveLogSource(activeLogSource);
  connectBackendLogStreamIfReady();
});

function toggleLogPanel() {
  var panel = getElLogPanel();
  if (panel) panel.classList.toggle('hidden');
  updateAppBottomInset();
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
  let remoteBoards = [];
  let activeBoardId = null;
  let activeBoardData = null;
  let fullBoardData = null;
  let boardHierarchyCache = {};
  let connected = false;
  let boardLoadSeq = 0;
  let searchMode = false;
  let searchResults = null;
  let pollInterval = null;
  let addCardColumn = null;
  var ptrDrag = null; // Pointer-based DnD state: { type, source, startX, startY, started, ghost, el }
  var isEditing = false;
  var currentCardEditor = null;
  var currentInlineCardEditor = null;
  var cardEditorMode = null;
  var cardEditorFontScale = 1;
  var pendingRefresh = false;
  var eventSource = null;
  var lastSaveTime = 0;
  var SAVE_DEBOUNCE_MS = 2000;
  var liveSyncState = null;
  var liveSyncLastLocalBroadcastAt = 0;
  var liveDraftSyncTimer = null;
  var liveDraftSyncRequest = null;
  var undoStack = [];
  var redoStack = [];
  var MAX_UNDO = 30;
  var MAX_UNDO_BYTES = 10 * 1024 * 1024;
  var undoTotalBytes = 0;
  var undoPendingSnapshot = null; // snapshot taken before the last mutation, awaiting delta computation
  var sidebarSyncEnabled = localStorage.getItem('lexera-sidebar-sync') === 'true';
  var hierarchyLocked = localStorage.getItem('lexera-hierarchy-locked') === 'true'; // default false
  var mermaidIdCounter = 0;
  var plantumlIdCounter = 0;
  var mermaidReady = false;
  var mermaidLoading = false;
  var pendingMermaidRenders = [];
  var pendingPlantUmlRenders = [];
  var plantumlQueueProcessing = false;
  var currentTagVisibilityMode = 'allexcludinglayout';
  var currentArrowKeyFocusScrollMode = 'nearest';
  var currentHtmlCommentRenderMode = 'hidden';
  var urlParams = new URLSearchParams(window.location.search || '');
  var embeddedMode = urlParams.get('embedded') === '1';
  var embeddedPaneId = urlParams.get('pane') || '';
  var embeddedInitialBoardId = urlParams.get('board') || '';
  var embeddedPreferredBoardId = embeddedInitialBoardId;
  var splitViewMode = embeddedMode ? 'single' : (localStorage.getItem('lexera-split-mode') || 'single'); // single | vertical | horizontal
  var splitPaneBoards = {
    a: embeddedMode ? '' : (localStorage.getItem('lexera-split-pane-a') || ''),
    b: embeddedMode ? '' : (localStorage.getItem('lexera-split-pane-b') || '')
  };
  var activeSplitPane = embeddedMode
    ? (embeddedPaneId === 'b' ? 'b' : 'a')
    : (localStorage.getItem('lexera-active-split-pane') === 'b' ? 'b' : 'a');
  var splitRatios = {
    vertical: parseFloat(localStorage.getItem('lexera-split-ratio-vertical') || '0.5'),
    horizontal: parseFloat(localStorage.getItem('lexera-split-ratio-horizontal') || '0.5')
  };
  var sidebarSplitRatio = parseFloat(localStorage.getItem('lexera-sidebar-split-ratio') || '0.58');
  var sidebarWidth = parseInt(localStorage.getItem('lexera-sidebar-width'), 10) || 0;
  var headerSearchExpanded = localStorage.getItem('lexera-header-search-expanded') === 'true';
  var splitRootEl = null;
  var splitToggleBtn = null;
  var splitOrientationBtn = null;
  var $savingIndicator = null;
  var $foldAllBtn = null;
  var dashboardState = {
    query: localStorage.getItem('lexera-dashboard-query') || '',
    scope: localStorage.getItem('lexera-dashboard-scope') === 'all' ? 'all' : 'active',
    pinnedQueries: [],
    activePinnedQuery: localStorage.getItem('lexera-dashboard-active-pinned') || '',
    loading: false,
    results: [],
    deadlines: [],
    overdue: []
  };
  var dashboardSearchDebounce = null;
  var dashboardRefreshTimer = null;
  var dashboardRefreshSeq = 0;

  // --- Themes ---
  var THEMES = [
    {
      id: 'lexera', name: 'Lexera',
      font: "'Segoe UI Variable', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif",
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

    // Derive extended style tokens from the active palette so spacing/colors stay unified.
    root.style.setProperty('--board-bg', palette['--bg-primary'] || '');
    root.style.setProperty('--surface-row-bg', palette['--bg-primary'] || '');
    root.style.setProperty('--surface-row-border', palette['--border'] || '');
    root.style.setProperty('--surface-stack-bg', palette['--bg-secondary'] || '');
    root.style.setProperty('--surface-stack-border', palette['--border'] || '');
    root.style.setProperty('--surface-column-bg', palette['--bg-secondary'] || '');
    root.style.setProperty('--surface-column-border', palette['--border'] || '');
    root.style.setProperty('--surface-header-bg', palette['--bg-tertiary'] || palette['--bg-secondary'] || '');
    root.style.setProperty('--surface-header-border', palette['--border'] || '');
    root.style.setProperty('--surface-footer-bg', palette['--bg-secondary'] || '');
    root.style.setProperty('--title-row-color', palette['--text-bright'] || '');
    root.style.setProperty('--title-stack-color', palette['--text-secondary'] || '');
    root.style.setProperty('--title-column-color', palette['--text-bright'] || '');

    root.style.setProperty('--icon-btn-bg', palette['--bg-tertiary'] || palette['--btn-bg'] || '');
    root.style.setProperty('--icon-btn-bg-hover', palette['--bg-hover'] || palette['--btn-bg-hover'] || '');
    root.style.setProperty('--icon-btn-bg-active', 'rgba(0, 122, 204, 0.22)');
    root.style.setProperty('--icon-btn-border', palette['--text-secondary'] || palette['--border'] || '');
    root.style.setProperty('--icon-btn-border-hover', palette['--text-bright'] || palette['--text-primary'] || '');
    root.style.setProperty('--icon-btn-fg', palette['--text-bright'] || palette['--btn-fg'] || '');
    root.style.setProperty('--icon-btn-fg-hover', palette['--text-bright'] || palette['--text-primary'] || '');

    localStorage.setItem('lexera-theme', theme.id);

    // Update theme selector if present
    var sel = document.getElementById('theme-select');
    if (sel && sel.value !== theme.id) sel.value = theme.id;

    if (typeof applyBoardSettings === 'function') {
      applyBoardSettings();
    }
  }

  // Re-apply on OS light/dark switch
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    applyTheme(currentThemeId || 'lexera');
  });

  // DOM refs — static elements use lazy-init getters (see top of file)
  // Dynamic elements (not in index.html) still need local lookup:
  const $searchContainer = document.querySelector('.search-container');
  const $searchInput = document.getElementById('search-input');
  const $searchToggleBtn = document.getElementById('btn-search-toggle');
  const BURGER_MENU_ICON_HTML = '<span class="burger-lines" aria-hidden="true"></span>';

  // Apply on load after DOM refs exist so board settings can safely re-apply theme-derived styles.
  applyTheme(localStorage.getItem('lexera-theme') || 'lexera');
  cardEditorMode = normalizeCardEditorMode(localStorage.getItem('lexera-card-editor-mode') || 'dual');
  cardEditorFontScale = normalizeCardEditorFontScale(localStorage.getItem('lexera-card-editor-font-scale') || '1');

  function normalizePathForCompare(path) {
    return String(path || '').replace(/\\/g, '/');
  }

  function decodeHtmlEntities(value) {
    if (value == null || value === '') return '';
    var textarea = document.createElement('textarea');
    textarea.innerHTML = String(value);
    return textarea.value;
  }

  function findBoardMeta(boardId) {
    if (!boardId) return null;
    for (var i = 0; i < boards.length; i++) {
      if (boards[i].id === boardId) return boards[i];
    }
    return null;
  }

  function stripPathSearchAndHash(path) {
    var value = String(path || '').trim();
    if (!value) return '';
    try {
      if (isExternalHttpUrl(value)) value = new URL(value).pathname || '';
    } catch (e) {
      // Fall back to simple path parsing below.
    }
    return value.split('#')[0].split('?')[0];
  }

  function parseLocalFileReference(path) {
    var raw = String(path || '').trim();
    var basePath = stripPathSearchAndHash(raw);
    var suffix = basePath && raw.indexOf(basePath) === 0 ? raw.slice(basePath.length) : '';
    var pageNumber = null;
    var hashMatch = raw.match(/^(.+\.pdf)#(\d+)$/i);
    if (hashMatch) pageNumber = parseInt(hashMatch[2], 10);
    var queryMatch = raw.match(/^(.+\.pdf)\?(?:p|page)=(\d+)$/i);
    if (!pageNumber && queryMatch) pageNumber = parseInt(queryMatch[2], 10);
    return {
      raw: raw,
      path: basePath || raw,
      suffix: suffix,
      pageNumber: isFinite(pageNumber) ? pageNumber : null
    };
  }

  function getFileNameFromPath(path) {
    var normalized = normalizePathForCompare(stripPathSearchAndHash(path));
    if (!normalized) return '';
    var idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(idx + 1) : normalized;
  }

  function decodePathDisplayValue(value) {
    var raw = String(value || '');
    if (!raw) return '';
    try {
      return decodeURIComponent(raw);
    } catch (e) {
      return raw;
    }
  }

  function getDisplayFileNameFromPath(path) {
    return decodePathDisplayValue(getFileNameFromPath(path));
  }

  function getDirNameFromPath(path) {
    var normalized = normalizePathForCompare(stripPathSearchAndHash(path));
    if (!normalized) return '';
    var idx = normalized.lastIndexOf('/');
    return idx > 0 ? normalized.slice(0, idx) : '';
  }

  function getDisplayNameFromPath(path) {
    var fileName = getDisplayFileNameFromPath(path);
    return fileName ? fileName.replace(/\.[^.]+$/, '') : '';
  }

  function getActiveBoardFilePath() {
    if (!activeBoardId) return '';
    if (activeBoardData && activeBoardData.filePath) return activeBoardData.filePath;
    var board = findBoardMeta(activeBoardId);
    return board && board.filePath ? board.filePath : '';
  }

  function getBoardFilePathForId(boardId) {
    if (!boardId) return '';
    if (boardId === activeBoardId && activeBoardData && activeBoardData.filePath) {
      return activeBoardData.filePath;
    }
    var board = findBoardMeta(boardId);
    return board && board.filePath ? board.filePath : '';
  }

  function stripMarkdownExtension(value) {
    return String(value || '').replace(/\.md$/i, '');
  }

  function normalizeWikiLookupKey(value) {
    return stripMarkdownExtension(normalizePathForCompare(value))
      .replace(/^\.\/+/, '')
      .replace(/^\/+/, '')
      .trim()
      .toLowerCase();
  }

  function getBoardDisplayName(board) {
    if (!board) return '';
    return String(board.title || stripMarkdownExtension(getDisplayFileNameFromPath(board.filePath || '')) || '').trim();
  }

  function getKnownBoards() {
    var all = [];
    var seen = {};
    var groups = [boards, remoteBoards];
    for (var g = 0; g < groups.length; g++) {
      var list = groups[g] || [];
      for (var i = 0; i < list.length; i++) {
        var board = list[i];
        if (!board || !board.id || seen[board.id]) continue;
        seen[board.id] = true;
        all.push(board);
      }
    }
    return all;
  }

  function resolveWikiDocument(documentName) {
    var rawDocument = decodeHtmlEntities(documentName).trim();
    if (!rawDocument) return { kind: 'missing', document: '' };
    if (rawDocument.charAt(0) === '#') return { kind: 'tag', document: rawDocument };

    var documentKey = normalizeWikiLookupKey(rawDocument);
    var documentBaseKey = normalizeWikiLookupKey(getFileNameFromPath(rawDocument));
    var knownBoards = getKnownBoards();
    var best = null;

    for (var i = 0; i < knownBoards.length; i++) {
      var board = knownBoards[i];
      var filePath = normalizePathForCompare(board.filePath || '');
      var filePathKey = normalizeWikiLookupKey(filePath);
      var fileNameKey = normalizeWikiLookupKey(getFileNameFromPath(filePath));
      var titleKey = normalizeWikiLookupKey(getBoardDisplayName(board));
      var score = null;

      if (documentKey && (documentKey === titleKey || documentKey === filePathKey)) {
        score = 0;
      } else if (documentKey && documentKey === fileNameKey) {
        score = 1;
      } else if (documentKey && filePathKey && filePathKey.slice(-documentKey.length - 1) === '/' + documentKey) {
        score = 2;
      } else if (documentBaseKey && documentBaseKey === titleKey) {
        score = 3;
      } else if (documentBaseKey && documentBaseKey === fileNameKey) {
        score = 4;
      }

      if (score == null) continue;
      if (!best || score < best.score || (score === best.score && filePath.length < best.filePathLength)) {
        best = {
          score: score,
          board: board,
          filePathLength: filePath.length
        };
      }
    }

    if (!best) return { kind: 'missing', document: rawDocument };
    return {
      kind: 'board',
      document: rawDocument,
      boardId: best.board.id,
      board: best.board
    };
  }

  // --- Order Helpers ---

  function stripLayoutTags(title) {
    return String(title || '')
      .replace(/\s*#row\d*\b/gi, '')
      .replace(/\s*#span\d*\b/gi, '')
      .replace(/\s*#stack\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripStackTag(title) {
    return stripLayoutTags(title);
  }

  function extractIncludePathFromTitle(title) {
    var match = String(title || '').match(/!!!include\(([^)]+)\)!!!/i);
    return match ? String(match[1] || '').trim() : '';
  }

  function removeIncludeSyntaxFromTitle(title) {
    return String(title || '')
      .replace(/!!!include\([^)]+\)!!!/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function addIncludeSyntaxToTitle(title, filePath) {
    var cleanTitle = removeIncludeSyntaxFromTitle(title);
    var cleanPath = String(filePath || '').trim();
    return ((cleanTitle ? cleanTitle + ' ' : '') + '!!!include(' + cleanPath + ')!!!').trim();
  }

  function updateIncludePathInTitle(title, filePath) {
    return addIncludeSyntaxToTitle(title, filePath);
  }

  function suggestIncludePathForColumn(title) {
    var base = removeIncludeSyntaxFromTitle(stripLayoutTags(stripInternalHiddenTags(title || '')))
      .replace(/[^\w.-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    return './' + (base || 'column') + '.md';
  }

  function getColumnLayoutTags(title) {
    title = String(title || '');
    var rowMatch = title.match(/#row(\d+)\b/i);
    var spanMatch = title.match(/#span(\d+)\b/i);
    var stackMatch = title.match(/#stack\b/i);
    return {
      row: rowMatch ? rowMatch[0] : '',
      span: spanMatch ? spanMatch[0] : '',
      stack: !!stackMatch
    };
  }

  function reconstructColumnTitle(userInput, originalTitle) {
    var source = String(userInput || '');
    var original = getColumnLayoutTags(originalTitle);
    var next = getColumnLayoutTags(source);
    var cleanTitle = source
      .replace(/#row\d+\b/gi, '')
      .replace(/#span\d+\b/gi, '')
      .replace(/#stack\b/gi, '')
      .replace(/#nospan\b/gi, '')
      .replace(/#nostack\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    var parts = [];

    if (cleanTitle) parts.push(cleanTitle);

    var finalRow = next.row || original.row;
    if (finalRow && finalRow.toLowerCase() !== '#row1') parts.push(finalRow);

    if (!/#nospan\b/i.test(source)) {
      var finalSpan = next.span || original.span;
      if (finalSpan) parts.push(finalSpan);
    }

    if (!/#nostack\b/i.test(source) && (next.stack || (!next.stack && original.stack))) {
      parts.push('#stack');
    }

    return parts.join(' ').trim();
  }

  async function toggleColumnWidth(colIndex) {
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var title = col.title || '';
    var layout = getColumnLayoutTags(title);
    var currentSpan = layout.span ? parseInt(layout.span.match(/\d+/)[0], 10) : 1;
    var nextSpan = (currentSpan % 4) + 1;
    var newTitle = title.replace(/#span\d+\b/gi, '').replace(/\s+/g, ' ').trim();
    if (nextSpan > 1) newTitle = newTitle + ' #span' + nextSpan;
    if (newTitle === title) return;
    pushUndo();
    col.title = newTitle;
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
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
    var cols = getElColumnsContainer().querySelectorAll('.column[data-col-title]');
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].classList.contains('folded')) {
        folded.push(cols[i].getAttribute('data-col-title'));
      }
    }
    localStorage.setItem('lexera-col-fold:' + boardId, JSON.stringify(folded));

    // Also save row/stack fold states for new format
    var rowFolded = [];
    var rows = getElColumnsContainer().querySelectorAll('.board-row[data-row-title]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].classList.contains('folded')) {
        rowFolded.push(rows[i].getAttribute('data-row-title'));
      }
    }
    localStorage.setItem('lexera-row-fold:' + boardId, JSON.stringify(rowFolded));

    var stackFolded = [];
    var stacks = getElColumnsContainer().querySelectorAll('.board-stack[data-stack-title]');
    for (var i = 0; i < stacks.length; i++) {
      if (stacks[i].classList.contains('folded')) {
        stackFolded.push(stacks[i].getAttribute('data-stack-title'));
      }
    }
    localStorage.setItem('lexera-stack-fold:' + boardId, JSON.stringify(stackFolded));
  }

  function setDirectChildFoldState(parentEl, childClassName, folded) {
    if (!parentEl) return;
    for (var i = 0; i < parentEl.children.length; i++) {
      var child = parentEl.children[i];
      if (!child || !child.classList || !child.classList.contains(childClassName)) continue;
      if (folded) child.classList.add('folded');
      else child.classList.remove('folded');
    }
  }

  function setRowChildrenFoldState(rowEl, folded) {
    if (!rowEl) return;
    var rowContent = rowEl.querySelector('.board-row-content');
    if (!rowContent) return;
    setDirectChildFoldState(rowContent, 'board-stack', folded);
  }

  function setStackChildrenFoldState(stackEl, folded) {
    if (!stackEl) return;
    var stackContent = stackEl.querySelector('.board-stack-content');
    if (!stackContent) return;
    setDirectChildFoldState(stackContent, 'column', folded);
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

  function reorderBoards(sourceIdx, targetIdx, insertBefore) {
    var orderedBoards = getOrderedItems(boards, 'lexera-board-order', function (b) { return b.id; });
    var newOrder = reorderItems(orderedBoards, sourceIdx, targetIdx, insertBefore);
    saveOrder(newOrder, 'lexera-board-order', function (b) { return b.id; });
    renderBoardList();
  }

  function targetClosest(target, selector) {
    if (!target) return null;
    if (typeof target.closest === 'function') return target.closest(selector);
    var el = target.nodeType === 1 ? target : target.parentElement;
    if (!el || typeof el.closest !== 'function') return null;
    return el.closest(selector);
  }

  function normalizeDroppedPath(path) {
    if (!path) return '';
    var p = String(path).trim();
    if (!p) return '';
    if (p.indexOf('file://') === 0) {
      try {
        var u = new URL(p);
        p = decodeURIComponent(u.pathname || '');
        // Windows drive path like /C:/...
        if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      } catch (e) {
        // keep original string
      }
    }
    return p;
  }

  function isMarkdownPath(path) {
    return /\.md$/i.test(path || '');
  }

  function isAbsoluteLikePath(path) {
    return path.indexOf('/') === 0 || /^[A-Za-z]:[\\/]/.test(path) || path.indexOf('\\\\') === 0;
  }

  function isPositionInsideElement(pos, el) {
    if (!pos || !el) return false;
    var rect = el.getBoundingClientRect();
    var x = pos.x;
    var y = pos.y;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    var dpr = window.devicePixelRatio || 1;
    if (dpr > 1) {
      var lx = x / dpr;
      var ly = y / dpr;
      if (lx >= rect.left && lx <= rect.right && ly >= rect.top && ly <= rect.bottom) return true;
    }
    return false;
  }

  function parseDroppedUriList(text) {
    if (!text) return [];
    var lines = text.split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.indexOf('#') === 0) continue;
      out.push(line);
    }
    return out;
  }

  function collectDroppedPathsFromDataTransfer(dt) {
    if (!dt) return [];
    var out = [];
    var files = dt.files || [];
    for (var i = 0; i < files.length; i++) {
      // Tauri/WebKit may expose absolute path on `path`.
      var p = files[i].path || '';
      if (p) out.push(p);
    }
    if (typeof dt.getData === 'function') {
      var uriList = dt.getData('text/uri-list');
      if (uriList) {
        var parsed = parseDroppedUriList(uriList);
        for (var j = 0; j < parsed.length; j++) out.push(parsed[j]);
      }
      var plain = dt.getData('text/plain');
      if (plain && (plain.indexOf('file://') === 0 || isAbsoluteLikePath(plain))) out.push(plain);
    }
    return out;
  }

  function addBoardsByPath(paths) {
    if (hierarchyLocked || !paths || paths.length === 0) return;
    var seen = {};
    var mdFiles = [];
    for (var i = 0; i < paths.length; i++) {
      var normalized = normalizeDroppedPath(paths[i]);
      if (!normalized) continue;
      if (!isAbsoluteLikePath(normalized)) continue;
      if (!isMarkdownPath(normalized)) continue;
      if (seen[normalized]) continue;
      seen[normalized] = true;
      mdFiles.push(normalized);
    }
    if (mdFiles.length === 0) return;

    var addPromises = mdFiles.map(function (filePath) {
      return LexeraApi.addBoard(filePath).catch(function (err) {
        lexeraLog('error', 'Failed to add board: ' + err.message);
      });
    });
    Promise.all(addPromises).then(function () {
      poll();
    });
  }

  function saveSplitState() {
    if (embeddedMode) return;
    localStorage.setItem('lexera-split-mode', splitViewMode);
    localStorage.setItem('lexera-split-pane-a', splitPaneBoards.a || '');
    localStorage.setItem('lexera-split-pane-b', splitPaneBoards.b || '');
    localStorage.setItem('lexera-active-split-pane', activeSplitPane || 'a');
    localStorage.setItem('lexera-split-ratio-vertical', String(splitRatios.vertical));
    localStorage.setItem('lexera-split-ratio-horizontal', String(splitRatios.horizontal));
  }

  function normalizeSplitPane(rawPane) {
    return rawPane === 'b' ? 'b' : 'a';
  }

  function normalizeRatio(rawRatio, options) {
    options = options || {};
    var ratio = Number(rawRatio);
    var fallback = isFinite(options.fallback) ? options.fallback : 0.5;
    var min = isFinite(options.min) ? options.min : 0.2;
    var max = isFinite(options.max) ? options.max : 0.8;
    var snap = isFinite(options.snap) ? options.snap : 0.5;
    var snapThreshold = isFinite(options.snapThreshold) ? options.snapThreshold : 0.04;

    if (!isFinite(ratio)) ratio = fallback;
    if (ratio < min) ratio = min;
    if (ratio > max) ratio = max;
    if (Math.abs(ratio - snap) <= snapThreshold) ratio = snap;
    return ratio;
  }

  function normalizeSplitRatio(rawRatio) {
    return normalizeRatio(rawRatio, {
      fallback: 0.5,
      min: 0.2,
      max: 0.8,
      snap: 0.5,
      snapThreshold: 0.04
    });
  }

  function getSplitRatioForMode(mode) {
    if (mode !== 'horizontal' && mode !== 'vertical') return 0.5;
    return normalizeSplitRatio(splitRatios[mode]);
  }

  function setSplitRatioForMode(mode, ratio, persist) {
    if (mode !== 'horizontal' && mode !== 'vertical') return;
    splitRatios[mode] = normalizeSplitRatio(ratio);
    if (persist) saveSplitState();
  }

  function applySplitRatioLayout() {
    if (!splitRootEl || splitViewMode === 'single') return;
    var ratio = getSplitRatioForMode(splitViewMode);
    if (splitViewMode === 'vertical') {
      splitRootEl.style.gridTemplateColumns = (ratio * 100).toFixed(2) + '% var(--splitter-size) ' + ((1 - ratio) * 100).toFixed(2) + '%';
      splitRootEl.style.gridTemplateRows = '1fr';
    } else if (splitViewMode === 'horizontal') {
      splitRootEl.style.gridTemplateRows = (ratio * 100).toFixed(2) + '% var(--splitter-size) ' + ((1 - ratio) * 100).toFixed(2) + '%';
      splitRootEl.style.gridTemplateColumns = '1fr';
    }
  }

  function normalizeSidebarSplitRatio(rawRatio) {
    return normalizeRatio(rawRatio, {
      fallback: 0.58,
      min: 0.2,
      max: 0.8,
      snap: 0.5,
      snapThreshold: 0.03
    });
  }

  function bindPointerDividerDrag(divider, handlers) {
    if (!divider || !handlers) return;
    divider.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (handlers.canStart && !handlers.canStart(e)) return;
      e.preventDefault();

      var pointerId = e.pointerId;
      var finished = false;
      var ctx = {};
      if (handlers.onStart) {
        var startCtx = handlers.onStart(e);
        if (startCtx && typeof startCtx === 'object') ctx = startCtx;
      }

      function onMove(ev) {
        if (ev.pointerId !== pointerId) return;
        if (handlers.onMove) handlers.onMove(ev, ctx);
      }

      function finish(ev) {
        if (finished) return;
        if (ev && ev.pointerId != null && ev.pointerId !== pointerId) return;
        finished = true;
        divider.removeEventListener('pointermove', onMove, true);
        divider.removeEventListener('pointerup', finish, true);
        divider.removeEventListener('pointercancel', finish, true);
        divider.removeEventListener('lostpointercapture', finish, true);
        try {
          if (divider.hasPointerCapture && divider.hasPointerCapture(pointerId)) {
            divider.releasePointerCapture(pointerId);
          }
        } catch (err) {
          // no-op
        }
        if (handlers.onEnd) handlers.onEnd(ev, ctx);
      }

      try {
        divider.setPointerCapture(pointerId);
      } catch (err) {
        // no-op
      }

      onMove(e);
      divider.addEventListener('pointermove', onMove, true);
      divider.addEventListener('pointerup', finish, true);
      divider.addEventListener('pointercancel', finish, true);
      divider.addEventListener('lostpointercapture', finish, true);
    });

    if (handlers.onDoubleClick) {
      divider.addEventListener('dblclick', handlers.onDoubleClick);
    }
  }

  function applySidebarSectionLayout() {
    if (!getElSidebar() || !getElBoardList()) return;
    var dashboardHidden = !getElDashboardRoot() || getElDashboardRoot().classList.contains('hidden');

    if (dashboardHidden) {
      if (getElSidebarDashboardDivider()) getElSidebarDashboardDivider().classList.add('hidden');
      getElBoardList().style.flex = '1 1 auto';
      getElBoardList().style.height = '';
      if (getElDashboardRoot()) {
        getElDashboardRoot().style.flex = '';
        getElDashboardRoot().style.height = '';
      }
      return;
    }

    if (getElSidebarDashboardDivider()) getElSidebarDashboardDivider().classList.remove('hidden');
    sidebarSplitRatio = normalizeSidebarSplitRatio(sidebarSplitRatio);

    var sidebarHeight = getElSidebar().clientHeight || 0;
    var headerHeight = getElSidebarHeader() ? getElSidebarHeader().offsetHeight : 0;
    var dividerHeight = getElSidebarDashboardDivider() ? (getElSidebarDashboardDivider().offsetHeight || 8) : 0;
    var available = sidebarHeight - headerHeight - dividerHeight;
    if (available <= 0) return;

    var styles = window.getComputedStyle(getElSidebar());
    var hierarchyMin = parseFloat(styles.getPropertyValue('--sidebar-hierarchy-min')) || 140;
    var dashboardMin = parseFloat(styles.getPropertyValue('--sidebar-dashboard-min')) || 180;
    var minSum = hierarchyMin + dashboardMin;
    if (available < minSum) {
      var scaledHierarchyMin = Math.max(80, Math.floor((hierarchyMin / minSum) * available));
      hierarchyMin = scaledHierarchyMin;
      dashboardMin = Math.max(100, available - scaledHierarchyMin);
    }

    var boardHeight = Math.round(available * sidebarSplitRatio);
    var minBoard = Math.min(hierarchyMin, Math.max(0, available - dashboardMin));
    var maxBoard = Math.max(minBoard, available - dashboardMin);
    boardHeight = Math.max(minBoard, Math.min(maxBoard, boardHeight));
    var dashboardHeight = Math.max(0, available - boardHeight);

    getElBoardList().style.flex = '0 0 ' + boardHeight + 'px';
    getElBoardList().style.height = boardHeight + 'px';
    if (getElDashboardRoot()) {
      getElDashboardRoot().style.flex = '0 0 ' + dashboardHeight + 'px';
      getElDashboardRoot().style.height = dashboardHeight + 'px';
    }
  }

  function setupSidebarSectionResize() {
    if (!getElSidebar() || !getElSidebarDashboardDivider()) return;
    sidebarSplitRatio = normalizeSidebarSplitRatio(sidebarSplitRatio);
    applySidebarSectionLayout();
    window.addEventListener('resize', applySidebarSectionLayout);

    bindPointerDividerDrag(getElSidebarDashboardDivider(), {
      canStart: function () {
        return !!getElDashboardRoot() && !getElDashboardRoot().classList.contains('hidden');
      },
      onStart: function () {
        var sidebarRect = getElSidebar().getBoundingClientRect();
        var headerBottom = getElSidebarHeader() ? getElSidebarHeader().getBoundingClientRect().bottom : sidebarRect.top;
        var dividerHeight = getElSidebarDashboardDivider().offsetHeight || 8;
        var trackStart = headerBottom;
        var trackSize = sidebarRect.height - (headerBottom - sidebarRect.top) - dividerHeight;
        getElSidebar().classList.add('resizing-sections');
        return {
          trackStart: trackStart,
          trackSize: Math.max(1, trackSize)
        };
      },
      onMove: function (ev, ctx) {
        var next = (ev.clientY - ctx.trackStart) / ctx.trackSize;
        sidebarSplitRatio = normalizeSidebarSplitRatio(next);
        applySidebarSectionLayout();
      },
      onEnd: function () {
        getElSidebar().classList.remove('resizing-sections');
        localStorage.setItem('lexera-sidebar-split-ratio', String(normalizeSidebarSplitRatio(sidebarSplitRatio)));
        applySidebarSectionLayout();
      },
      onDoubleClick: function () {
        sidebarSplitRatio = 0.5;
        localStorage.setItem('lexera-sidebar-split-ratio', '0.5');
        applySidebarSectionLayout();
      }
    });
  }

  function applySidebarWidth() {
    if (!getElSidebar()) return;
    if (sidebarWidth > 0) {
      document.documentElement.style.setProperty('--sidebar-width', sidebarWidth + 'px');
    }
  }

  function setupSidebarWidthResize() {
    if (!getElSidebar() || !getElSidebarWidthDivider() || !getElLayout()) return;
    var SIDEBAR_MIN = 180;
    var SIDEBAR_MAX = 600;
    var SIDEBAR_DEFAULT = 300;
    var SNAP_THRESHOLD = 15;

    applySidebarWidth();

    bindPointerDividerDrag(getElSidebarWidthDivider(), {
      onStart: function () {
        var sidebarRect = getElSidebar().getBoundingClientRect();
        getElLayout().classList.add('resizing-sidebar-width');
        return { left: sidebarRect.left };
      },
      onMove: function (ev, ctx) {
        var newWidth = ev.clientX - ctx.left;
        if (Math.abs(newWidth - SIDEBAR_DEFAULT) < SNAP_THRESHOLD) newWidth = SIDEBAR_DEFAULT;
        newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, newWidth));
        sidebarWidth = newWidth;
        document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
        applySidebarSectionLayout();
      },
      onEnd: function () {
        getElLayout().classList.remove('resizing-sidebar-width');
        localStorage.setItem('lexera-sidebar-width', String(sidebarWidth));
        applySidebarSectionLayout();
      },
      onDoubleClick: function () {
        sidebarWidth = SIDEBAR_DEFAULT;
        document.documentElement.style.setProperty('--sidebar-width', SIDEBAR_DEFAULT + 'px');
        localStorage.setItem('lexera-sidebar-width', String(SIDEBAR_DEFAULT));
        applySidebarSectionLayout();
      }
    });
  }

  function handleTextareaTabIndent(e, textarea) {
    if (!e || !textarea || e.key !== 'Tab') return false;
    e.preventDefault();

    var text = textarea.value || '';
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || 0;
    var hasSelection = end > start;

    if (!e.shiftKey && !hasSelection) {
      textarea.value = text.slice(0, start) + '\t' + text.slice(end);
      textarea.setSelectionRange(start + 1, start + 1);
      textarea.dispatchEvent(new Event('input'));
      return true;
    }

    var blockStart = text.lastIndexOf('\n', Math.max(0, start - 1));
    blockStart = blockStart === -1 ? 0 : blockStart + 1;
    var endLookupPos = hasSelection && end > 0 ? end - 1 : end;
    var blockEnd = text.indexOf('\n', endLookupPos);
    if (blockEnd === -1) blockEnd = text.length;

    var blockText = text.slice(blockStart, blockEnd);
    var lines = blockText.split('\n');
    var rebuilt = [];
    var adjustStart = 0;
    var adjustEnd = 0;
    var linePos = blockStart;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var removed = 0;
      if (e.shiftKey) {
        if (line.indexOf('\t') === 0) removed = 1;
        else if (line.indexOf('    ') === 0) removed = 4;
        else if (line.indexOf('  ') === 0) removed = 2;
        rebuilt.push(removed > 0 ? line.slice(removed) : line);
      } else {
        rebuilt.push('\t' + line);
      }

      if (!e.shiftKey) {
        if (linePos < start) adjustStart += 1;
        if (linePos < end || (!hasSelection && linePos === start)) adjustEnd += 1;
      } else if (removed > 0) {
        if (linePos < start) adjustStart += Math.min(removed, start - linePos);
        if (linePos < end || (!hasSelection && linePos === start)) adjustEnd += Math.min(removed, end - linePos);
      }

      linePos += line.length + 1;
    }

    textarea.value = text.slice(0, blockStart) + rebuilt.join('\n') + text.slice(blockEnd);

    var newStart = e.shiftKey ? start - adjustStart : start + adjustStart;
    var newEnd = e.shiftKey ? end - adjustEnd : end + adjustEnd;
    if (!hasSelection) newEnd = newStart;
    if (newStart < 0) newStart = 0;
    if (newEnd < newStart) newEnd = newStart;
    textarea.setSelectionRange(newStart, newEnd);
    textarea.dispatchEvent(new Event('input'));
    return true;
  }

  function closeTransientUiViaHotkey() {
    var didClose = false;
    if (activeColMenu || activeCardMenu || activeRowStackMenu || activeEmbedMenu || activeHtmlMenu) {
      didClose = true;
    }
    closeColumnContextMenu();
    closeCardContextMenu();
    closeRowStackMenu();
    closeEmbedMenu();
    closeHtmlMenu();

    if (addCardColumn != null) {
      addCardColumn = null;
      renderColumns();
      didClose = true;
    }

    var editingTextarea = document.querySelector('.card.editing .card-edit-input');
    if (editingTextarea) {
      editingTextarea.blur();
      didClose = true;
    }

    if (currentInlineCardEditor) {
      closeInlineCardEditor({ save: false });
      didClose = true;
    }

    if (currentCardEditor) {
      closeCardEditorOverlay({ save: false });
      didClose = true;
    }

    var overlays = document.querySelectorAll('.dialog-overlay');
    if (overlays.length > 0) {
      overlays[overlays.length - 1].remove();
      didClose = true;
    }

    return didClose;
  }

  function setHeaderSearchExpanded(expanded, options) {
    headerSearchExpanded = !!expanded;
    localStorage.setItem('lexera-header-search-expanded', headerSearchExpanded ? 'true' : 'false');
    updateHeaderSearchVisibility(options);
  }

  function updateHeaderSearchVisibility(options) {
    options = options || {};
    if (!$searchContainer) return;
    var hasQuery = !!($searchInput && $searchInput.value && $searchInput.value.trim());
    var visible = headerSearchExpanded || searchMode || hasQuery;
    $searchContainer.classList.toggle('collapsed', !visible);
    if ($searchToggleBtn) $searchToggleBtn.classList.toggle('active', visible);
    if (visible && options.focus && $searchInput) {
      requestAnimationFrame(function () { $searchInput.focus(); });
    }
  }

  function buildEmbeddedPaneUrl(boardId, paneId) {
    var u = new URL(window.location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('embedded', '1');
    u.searchParams.set('pane', paneId);
    if (boardId) u.searchParams.set('board', boardId);
    return u.toString();
  }

  function notifyParentPaneActivated() {
    if (!embeddedMode || !embeddedPaneId) return;
    if (!window.parent || window.parent === window) return;
    try {
      window.parent.postMessage({
        type: 'lexera-pane-activated',
        pane: embeddedPaneId,
        boardId: activeBoardId || ''
      }, '*');
    } catch (e) {
      // ignore cross-frame messaging issues
    }
  }

  function setupEmbeddedPaneActivation() {
    if (!embeddedMode) return;
    var lastSentAt = 0;
    function sendActivation() {
      var now = Date.now();
      if (now - lastSentAt < 80) return;
      lastSentAt = now;
      notifyParentPaneActivated();
    }
    document.addEventListener('pointerdown', sendActivation, true);
    document.addEventListener('focusin', sendActivation, true);
    window.addEventListener('keydown', sendActivation, true);
    setTimeout(sendActivation, 0);
  }

  function ensureSplitPaneBoards() {
    if (!boards || boards.length === 0) return;
    var boardExists = function (id) {
      if (!id) return false;
      for (var i = 0; i < boards.length; i++) if (boards[i].id === id) return true;
      return false;
    };
    if (!boardExists(splitPaneBoards.a)) {
      splitPaneBoards.a = boardExists(activeBoardId) ? activeBoardId : boards[0].id;
    }
    if (!boardExists(splitPaneBoards.b)) {
      var alt = null;
      for (var i = 0; i < boards.length; i++) {
        if (boards[i].id !== splitPaneBoards.a) { alt = boards[i].id; break; }
      }
      splitPaneBoards.b = alt || splitPaneBoards.a;
    }
    activeSplitPane = normalizeSplitPane(activeSplitPane);
    if (activeSplitPane === 'a' && !boardExists(splitPaneBoards.a)) activeSplitPane = 'b';
    if (activeSplitPane === 'b' && !boardExists(splitPaneBoards.b)) activeSplitPane = 'a';
  }

  function isSplitPaneId(pane) {
    return pane === 'a' || pane === 'b';
  }

  function setSplitPaneFrameSource(root, pane, boardId, forceReload) {
    if (!root || !isSplitPaneId(pane) || !boardId) return;
    var frame = root.querySelector('.split-pane-frame[data-pane="' + pane + '"]');
    if (!frame) return;
    var src = buildEmbeddedPaneUrl(boardId, pane);
    if (forceReload || frame.getAttribute('data-src') !== src) {
      frame.setAttribute('data-src', src);
      frame.src = src;
    }
  }

  function updateActiveSplitPaneUi() {
    if (!splitRootEl) return;
    var frames = splitRootEl.querySelectorAll('.split-pane-frame');
    for (var i = 0; i < frames.length; i++) {
      var pane = normalizeSplitPane(frames[i].getAttribute('data-pane'));
      frames[i].classList.toggle('active-pane', pane === activeSplitPane);
    }
  }

  function setActiveSplitPane(pane, persist) {
    if (embeddedMode) return;
    activeSplitPane = normalizeSplitPane(pane);
    updateActiveSplitPaneUi();
    if (persist !== false) saveSplitState();
  }

  function syncActiveBoardFromSplitPane() {
    if (embeddedMode || splitViewMode === 'single') return;
    var paneBoardId = splitPaneBoards[normalizeSplitPane(activeSplitPane)];
    if (!paneBoardId || paneBoardId === activeBoardId) return;
    activeBoardId = paneBoardId;
    activeBoardData = null;
    fullBoardData = null;
    addCardColumn = null;
    localStorage.setItem('lexera-last-board', paneBoardId);
    renderBoardList();
    refreshHeaderFileControls();
  }

  function ensureSplitRoot() {
    if (splitRootEl || !getElLayout()) return splitRootEl;
    splitRootEl = document.createElement('div');
    splitRootEl.id = 'split-root';
    splitRootEl.className = 'split-root';
    splitRootEl.innerHTML =
      '<iframe class="split-pane-frame" data-pane="a" title="Split Pane A"></iframe>' +
      '<div class="split-divider" role="separator" aria-label="Resize split panes"></div>' +
      '<iframe class="split-pane-frame" data-pane="b" title="Split Pane B"></iframe>';
    var frames = splitRootEl.querySelectorAll('.split-pane-frame');
    for (var i = 0; i < frames.length; i++) {
      (function (frameEl) {
        frameEl.addEventListener('pointerdown', function () {
          if (splitViewMode === 'single') return;
          setActiveSplitPane(frameEl.getAttribute('data-pane'));
          syncActiveBoardFromSplitPane();
        });
      })(frames[i]);
    }
    var divider = splitRootEl.querySelector('.split-divider');
    if (divider) {
      bindPointerDividerDrag(divider, {
        canStart: function () {
          return splitViewMode !== 'single';
        },
        onStart: function () {
          var mode = splitViewMode;
          if (splitRootEl) {
            splitRootEl.classList.add('resizing');
            splitRootEl.setAttribute('data-resize-mode', mode);
          }
          return { mode: mode };
        },
        onMove: function (ev, ctx) {
          if (!splitRootEl) return;
          var rect = splitRootEl.getBoundingClientRect();
          if (ctx.mode === 'vertical') {
            setSplitRatioForMode(ctx.mode, (ev.clientX - rect.left) / Math.max(1, rect.width), false);
          } else {
            setSplitRatioForMode(ctx.mode, (ev.clientY - rect.top) / Math.max(1, rect.height), false);
          }
          applySplitRatioLayout();
        },
        onEnd: function (ev, ctx) {
          if (splitRootEl) {
            splitRootEl.classList.remove('resizing');
            splitRootEl.removeAttribute('data-resize-mode');
          }
          setSplitRatioForMode(ctx.mode, getSplitRatioForMode(ctx.mode), true);
          applySplitRatioLayout();
        },
        onDoubleClick: function () {
          if (splitViewMode === 'single') return;
          setSplitRatioForMode(splitViewMode, 0.5, true);
          applySplitRatioLayout();
        }
      });
    }
    getElLayout().appendChild(splitRootEl);
    updateActiveSplitPaneUi();
    return splitRootEl;
  }

  function refreshSplitFrames(forceReload) {
    if (embeddedMode || splitViewMode === 'single') return;
    var root = ensureSplitRoot();
    if (!root) return;
    ensureSplitPaneBoards();
    activeSplitPane = normalizeSplitPane(activeSplitPane);
    applySplitRatioLayout();
    setSplitPaneFrameSource(root, 'a', splitPaneBoards.a, forceReload);
    setSplitPaneFrameSource(root, 'b', splitPaneBoards.b, forceReload);
    updateActiveSplitPaneUi();
    syncActiveBoardFromSplitPane();
    saveSplitState();
  }

  function updateSplitButtons() {
    if (embeddedMode) return;
    if (splitToggleBtn) splitToggleBtn.classList.toggle('active', splitViewMode !== 'single');
    if (splitOrientationBtn) {
      splitOrientationBtn.classList.toggle('hidden', splitViewMode === 'single');
      splitOrientationBtn.textContent = (splitViewMode === 'horizontal') ? '\u2195' : '\u2194';
      splitOrientationBtn.title = (splitViewMode === 'horizontal')
        ? 'Switch split orientation (horizontal \u2192 vertical)'
        : 'Switch split orientation (vertical \u2192 horizontal)';
    }
    refreshHeaderFileControls();
  }

  function applySplitMode(forceReload) {
    if (embeddedMode) return;
    updateSplitButtons();
    if (splitViewMode === 'single') {
      document.body.classList.remove('split-mode');
      if (splitRootEl) {
        splitRootEl.classList.remove('active', 'vertical', 'horizontal');
      }
      if (getElMainContent()) getElMainContent().classList.remove('hidden');
      if (activeBoardId && !searchMode) loadBoard(activeBoardId);
      else renderMainView();
      saveSplitState();
      return;
    }

    ensureSplitPaneBoards();
    setActiveSplitPane(activeSplitPane, false);
    var root = ensureSplitRoot();
    if (!root) return;
    document.body.classList.add('split-mode');
    root.classList.add('active');
    root.classList.toggle('vertical', splitViewMode === 'vertical');
    root.classList.toggle('horizontal', splitViewMode === 'horizontal');
    applySplitRatioLayout();
    if (getElMainContent()) getElMainContent().classList.add('hidden');
    refreshSplitFrames(!!forceReload);
  }

  function handleSplitPaneMessage(event) {
    if (embeddedMode) return;
    var data = event && event.data;
    if (!data || !data.type) return;
    if (data.type === 'lexera-pane-activated') {
      var activatedPane = normalizeSplitPane(data.pane);
      setActiveSplitPane(activatedPane);
      if (data.boardId && isSplitPaneId(activatedPane)) {
        splitPaneBoards[activatedPane] = data.boardId;
      }
      syncActiveBoardFromSplitPane();
      return;
    }
    if (data.type !== 'lexera-pane-board-change') return;
    var pane = data.pane;
    var boardId = data.boardId;
    if (!isSplitPaneId(pane) || !boardId) return;
    setActiveSplitPane(pane);
    splitPaneBoards[pane] = boardId;
    if (splitRootEl) {
      setSplitPaneFrameSource(splitRootEl, pane, boardId, false);
    }
    syncActiveBoardFromSplitPane();
    saveSplitState();
  }

  function setupSplitControls() {
    if (embeddedMode) return;
    activeSplitPane = normalizeSplitPane(activeSplitPane);
    splitRatios.vertical = normalizeSplitRatio(splitRatios.vertical);
    splitRatios.horizontal = normalizeSplitRatio(splitRatios.horizontal);
    if (!getElHeaderActions()) return;
    splitToggleBtn = document.getElementById('btn-split-toggle');
    splitOrientationBtn = document.getElementById('btn-split-orientation');
    if (!splitToggleBtn) {
      splitToggleBtn = document.createElement('button');
      splitToggleBtn.id = 'btn-split-toggle';
      splitToggleBtn.className = 'btn-icon';
      splitToggleBtn.title = 'Toggle split view';
      splitToggleBtn.textContent = '\u29C9';
    }
    if (!splitOrientationBtn) {
      splitOrientationBtn = document.createElement('button');
      splitOrientationBtn.id = 'btn-split-orientation';
      splitOrientationBtn.className = 'btn-icon';
      splitOrientationBtn.title = 'Switch split orientation';
      splitOrientationBtn.textContent = '\u2194';
    }

    // Keep split controls anchored at top-right (before connection indicator).
    if (getElConnectionDot() && getElConnectionDot().parentElement === getElHeaderActions()) {
      getElHeaderActions().insertBefore(splitToggleBtn, getElConnectionDot());
      getElHeaderActions().insertBefore(splitOrientationBtn, getElConnectionDot());
    } else {
      getElHeaderActions().appendChild(splitToggleBtn);
      getElHeaderActions().appendChild(splitOrientationBtn);
    }

    splitToggleBtn.addEventListener('click', function () {
      var wasSingle = splitViewMode === 'single';
      if (wasSingle && activeBoardId) {
        splitPaneBoards[normalizeSplitPane(activeSplitPane)] = activeBoardId;
      }
      splitViewMode = wasSingle ? 'vertical' : 'single';
      applySplitMode(false);
    });
    splitOrientationBtn.addEventListener('click', function () {
      if (splitViewMode === 'single') return;
      splitViewMode = (splitViewMode === 'vertical') ? 'horizontal' : 'vertical';
      applySplitMode(true);
    });

    window.addEventListener('message', handleSplitPaneMessage);
    applySplitMode(false);
  }

  function findAlternativeBoardId(excludeId) {
    for (var i = 0; i < boards.length; i++) {
      if (boards[i].id !== excludeId) return boards[i].id;
    }
    return excludeId || '';
  }

  function openBoardInPane(boardId, pane) {
    if (embeddedMode || !boardId) return;
    pane = normalizeSplitPane(pane);
    setActiveSplitPane(pane);
    ensureSplitPaneBoards();
    splitPaneBoards[pane] = boardId;
    if (pane === 'a' && (!splitPaneBoards.b || splitPaneBoards.b === boardId)) {
      splitPaneBoards.b = findAlternativeBoardId(boardId);
    } else if (pane === 'b' && (!splitPaneBoards.a || splitPaneBoards.a === boardId)) {
      splitPaneBoards.a = findAlternativeBoardId(boardId);
    }
    activeBoardId = boardId;
    activeBoardData = null;
    fullBoardData = null;
    addCardColumn = null;
    localStorage.setItem('lexera-last-board', boardId);
    renderBoardList();
    refreshHeaderFileControls();
    if (splitViewMode === 'single') splitViewMode = 'vertical';
    applySplitMode(true);
  }

  function refreshHeaderFileControls() {
    // Header controls are split-view + sync status only.
  }

  function normalizeMarkdownFileName(rawName) {
    var name = String(rawName || '').trim();
    if (!name) return '';
    name = name.replace(/[\\/]/g, '-');
    name = name.replace(/[:*?"<>|]/g, '-');
    if (!/\.md$/i.test(name)) name += '.md';
    return name;
  }

  async function renameActiveBoardFile() {
    var boardId = activeBoardId;
    var oldPath = getActiveBoardFilePath();
    if (!boardId || !oldPath) return;
    if (!hasTauri) {
      showNotification('Rename is available in the desktop app only');
      return;
    }

    var oldName = getFileNameFromPath(oldPath);
    var requested = window.prompt('Rename board file', oldName);
    if (requested == null) return;

    var nextName = normalizeMarkdownFileName(requested);
    if (!nextName) {
      showNotification('Invalid filename');
      return;
    }
    if (nextName === oldName) return;

    var sep = oldPath.indexOf('\\') !== -1 ? '\\' : '/';
    var folder = getDirNameFromPath(oldPath);
    var newPath = folder ? (folder + sep + nextName) : nextName;
    if (normalizePathForCompare(newPath) === normalizePathForCompare(oldPath)) return;

    try {
      await tauriInvoke('rename_path', { from: oldPath, to: newPath });
    } catch (err) {
      lexeraLog('error', '[rename.file] Rename failed: ' + err);
      showNotification('Failed to rename file');
      return;
    }

    var newBoardId = null;
    try {
      var addResult = await LexeraApi.addBoard(newPath);
      newBoardId = addResult && addResult.boardId ? addResult.boardId : null;
    } catch (err) {
      lexeraLog('error', '[rename.file] Failed to re-add board: ' + err.message);
      showNotification('Renamed file, but failed to re-add board');
      await poll();
      return;
    }

    try {
      await LexeraApi.removeBoard(boardId);
    } catch (err) {
      lexeraLog('warn', '[rename.file] Failed to remove old board entry: ' + err.message);
    }

    if (newBoardId) {
      if (splitPaneBoards.a === boardId) splitPaneBoards.a = newBoardId;
      if (splitPaneBoards.b === boardId) splitPaneBoards.b = newBoardId;
    }

    await poll();
    if (newBoardId) {
      await selectBoard(newBoardId);
    } else {
      var normalized = normalizePathForCompare(newPath);
      for (var i = 0; i < boards.length; i++) {
        if (normalizePathForCompare(boards[i].filePath) === normalized) {
          await selectBoard(boards[i].id);
          break;
        }
      }
    }
    refreshHeaderFileControls();
    showNotification('Renamed file to ' + nextName);
  }

  function openActiveBoardFolder() {
    var filePath = getActiveBoardFilePath();
    if (!filePath) return;
    showInFinder(filePath);
  }

  function buildThemeOptionsMarkup(selectedThemeId) {
    var selected = selectedThemeId || currentThemeId || (THEMES[0] && THEMES[0].id) || 'lexera';
    var html = '';
    for (var i = 0; i < THEMES.length; i++) {
      var t = THEMES[i];
      html += '<option value="' + escapeAttr(t.id) + '"' + (t.id === selected ? ' selected' : '') + '>' +
        escapeHtml(t.name) + '</option>';
    }
    return html;
  }

  async function openSettingsDialogForBoard(boardId) {
    var targetBoardId = boardId || activeBoardId || '';
    openManagementPanel({ section: 'boards', boardId: targetBoardId, tab: 'settings' });
  }

  function setupHeaderFileControls() {
    refreshHeaderFileControls();
  }

  function setupSearchControls() {
    if (embeddedMode || !$searchInput || !$searchContainer) return;
    updateHeaderSearchVisibility();

    if ($searchToggleBtn) {
      $searchToggleBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (headerSearchExpanded) {
          if ($searchInput) $searchInput.value = '';
          exitSearchMode();
          setHeaderSearchExpanded(false);
        } else {
          setHeaderSearchExpanded(true, { focus: true });
        }
      });
    }

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setHeaderSearchExpanded(true, { focus: true });
      }
    });
  }

  function ensureSidebarTreeDefaultState() {
    var versionKey = 'lexera-sidebar-tree-default-v2';
    if (localStorage.getItem(versionKey) === '1') return;
    localStorage.removeItem('lexera-sidebar-tree-state');
    localStorage.setItem(versionKey, '1');
  }

  function normalizeDashboardScope(scope) {
    return scope === 'all' ? 'all' : 'active';
  }

  function loadDashboardPinnedQueries() {
    try {
      var raw = JSON.parse(localStorage.getItem('lexera-dashboard-pinned-queries') || '[]');
      if (!Array.isArray(raw)) return [];
      var out = [];
      for (var i = 0; i < raw.length; i++) {
        var q = String(raw[i] || '').trim();
        if (!q || out.indexOf(q) !== -1) continue;
        out.push(q);
        if (out.length >= 30) break;
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  function persistDashboardPrefs() {
    localStorage.setItem('lexera-dashboard-query', dashboardState.query || '');
    localStorage.setItem('lexera-dashboard-scope', normalizeDashboardScope(dashboardState.scope));
    localStorage.setItem('lexera-dashboard-active-pinned', dashboardState.activePinnedQuery || '');
    localStorage.setItem('lexera-dashboard-pinned-queries', JSON.stringify(dashboardState.pinnedQueries || []));
  }

  function setDashboardScope(scope) {
    dashboardState.scope = normalizeDashboardScope(scope);
    if (getElDashboardScopeSelect()) getElDashboardScopeSelect().value = dashboardState.scope;
    persistDashboardPrefs();
  }

  function setDashboardQuery(query, options) {
    options = options || {};
    var next = String(query || '').trim();
    dashboardState.query = next;
    if (getElDashboardSearchInput() && getElDashboardSearchInput().value !== next) {
      getElDashboardSearchInput().value = next;
    }
    if (dashboardState.pinnedQueries.indexOf(next) !== -1) {
      dashboardState.activePinnedQuery = next;
    } else if (!options.keepPinnedSelection) {
      dashboardState.activePinnedQuery = '';
    }
    persistDashboardPrefs();
    renderDashboardPinnedList();
  }

  function filterDashboardResultsByScope(results) {
    if (!Array.isArray(results)) return [];
    if (dashboardState.scope !== 'active') return results.slice();
    if (!activeBoardId) return [];
    return results.filter(function (item) {
      return item && item.boardId === activeBoardId;
    });
  }

  function parseSearchDateValue(dateStr) {
    if (!dateStr) return Number.POSITIVE_INFINITY;
    var stamp = Date.parse(dateStr + 'T00:00:00');
    return isNaN(stamp) ? Number.POSITIVE_INFINITY : stamp;
  }

  function sortSearchByDueDateAsc(results) {
    return results.slice().sort(function (a, b) {
      var ad = parseSearchDateValue(a && a.dueDate);
      var bd = parseSearchDateValue(b && b.dueDate);
      if (ad !== bd) return ad - bd;
      var at = String(a && a.boardTitle || '').toLowerCase();
      var bt = String(b && b.boardTitle || '').toLowerCase();
      if (at !== bt) return at < bt ? -1 : 1;
      var ac = String(a && a.cardContent || '').toLowerCase();
      var bc = String(b && b.cardContent || '').toLowerCase();
      return ac < bc ? -1 : (ac > bc ? 1 : 0);
    });
  }

  function limitedSearchResults(results, maxCount) {
    if (!Array.isArray(results)) return [];
    if (results.length <= maxCount) return results;
    return results.slice(0, maxCount);
  }

  function asSearchResultArray(payload) {
    if (!payload || !Array.isArray(payload.results)) return [];
    return payload.results;
  }

  function dashboardCardTitle(content) {
    var line = String(content || '').split('\n')[0].trim();
    if (!line) return '(empty card)';
    return line.length > 62 ? line.slice(0, 59) + '...' : line;
  }

  function dashboardDueLabel(result) {
    if (!result) return '';
    if (result.isOverdue) return 'Overdue';
    if (result.dueDate) return result.dueDate;
    return '';
  }

  function buildDashboardNavResult(result) {
    return {
      boardId: result.boardId,
      cardId: result.cardId,
      cardContent: result.cardContent,
      columnIndex: parseOptionalSearchIndex(result.columnIndex),
      rowIndex: parseOptionalSearchIndex(result.rowIndex),
      stackIndex: parseOptionalSearchIndex(result.stackIndex),
      columnTitle: result.columnTitle
    };
  }

  function scopeHintForDashboard() {
    if (dashboardState.scope === 'active' && !activeBoardId) {
      return 'Select a board to show scoped results';
    }
    return '';
  }

  function renderDashboardPinnedList() {
    if (!getElDashboardPinnedList()) return;
    getElDashboardPinnedList().innerHTML = '';
    if (!dashboardState.pinnedQueries || dashboardState.pinnedQueries.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'dashboard-empty';
      empty.textContent = 'No pinned searches';
      getElDashboardPinnedList().appendChild(empty);
      return;
    }

    for (var i = 0; i < dashboardState.pinnedQueries.length; i++) {
      (function (query) {
        var item = document.createElement('div');
        item.className = 'dashboard-item' + (dashboardState.activePinnedQuery === query ? ' pinned-active' : '');

        var main = document.createElement('div');
        main.className = 'dashboard-item-main';
        var title = document.createElement('div');
        title.className = 'dashboard-item-title';
        title.textContent = query;
        var meta = document.createElement('div');
        meta.className = 'dashboard-item-meta';
        meta.textContent = 'Pinned query';
        main.appendChild(title);
        main.appendChild(meta);
        item.appendChild(main);

        var right = document.createElement('div');
        right.className = 'dashboard-item-right';
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'dashboard-item-remove';
        removeBtn.title = 'Remove pinned query';
        removeBtn.textContent = '\u00d7';
        removeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var idx = dashboardState.pinnedQueries.indexOf(query);
          if (idx !== -1) dashboardState.pinnedQueries.splice(idx, 1);
          if (dashboardState.activePinnedQuery === query) dashboardState.activePinnedQuery = '';
          persistDashboardPrefs();
          renderDashboardPinnedList();
        });
        right.appendChild(removeBtn);
        item.appendChild(right);

        item.addEventListener('click', function () {
          dashboardState.activePinnedQuery = query;
          setDashboardQuery(query, { keepPinnedSelection: true });
          scheduleDashboardRefresh(0);
        });
        getElDashboardPinnedList().appendChild(item);
      })(dashboardState.pinnedQueries[i]);
    }
  }

  function renderDashboardResultItems(targetEl, items, emptyText) {
    if (!targetEl) return;
    targetEl.innerHTML = '';

    if (!items || items.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'dashboard-empty';
      empty.textContent = emptyText;
      targetEl.appendChild(empty);
      return;
    }

    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var row = document.createElement('div');
        row.className = 'dashboard-item';

        var main = document.createElement('div');
        main.className = 'dashboard-item-main';
        var title = document.createElement('div');
        title.className = 'dashboard-item-title';
        title.textContent = dashboardCardTitle(item.cardContent);
        var meta = document.createElement('div');
        meta.className = 'dashboard-item-meta';
        meta.textContent = (item.boardTitle || 'Untitled') + ' / ' + buildSearchResultLocation(item);
        main.appendChild(title);
        main.appendChild(meta);
        row.appendChild(main);

        var due = dashboardDueLabel(item);
        if (due) {
          var right = document.createElement('div');
          right.className = 'dashboard-item-right';
          right.textContent = due;
          row.appendChild(right);
        }

        row.addEventListener('click', function () {
          navigateToSearchResult(buildDashboardNavResult(item));
        });
        targetEl.appendChild(row);
      })(items[i]);
    }
  }

  function renderDashboard() {
    if (!getElDashboardRoot()) return;
    var scopeHint = scopeHintForDashboard();
    var loadingNote = dashboardState.loading ? 'Loading...' : null;

    renderDashboardPinnedList();
    renderDashboardResultItems(
      getElDashboardResultsList(),
      dashboardState.results,
      scopeHint || loadingNote || (dashboardState.query ? 'No matching tasks' : 'Type a query to search')
    );
    renderDashboardResultItems(
      getElDashboardDeadlineList(),
      dashboardState.deadlines,
      scopeHint || loadingNote || 'No open tasks with due dates'
    );
    renderDashboardResultItems(
      getElDashboardOverdueList(),
      dashboardState.overdue,
      scopeHint || loadingNote || 'No overdue tasks'
    );
  }

  async function refreshDashboardData(options) {
    options = options || {};
    if (!getElDashboardRoot() || embeddedMode) return;
    if (!connected) {
      dashboardState.loading = false;
      dashboardState.results = [];
      dashboardState.deadlines = [];
      dashboardState.overdue = [];
      renderDashboard();
      return;
    }
    var refreshId = ++dashboardRefreshSeq;
    dashboardState.loading = true;
    if (!options.deferRender) renderDashboard();

    try {
      var query = dashboardState.query ? dashboardState.query.trim() : '';
      var queryPromise = query
        ? LexeraApi.search(query)
        : Promise.resolve({ results: [] });
      var deadlinePromise = LexeraApi.search('is:open due:any');
      var overduePromise = LexeraApi.search('is:open due:overdue');

      var resolved = await Promise.all([queryPromise, deadlinePromise, overduePromise]);
      if (refreshId !== dashboardRefreshSeq) return;

      var scopedQuery = filterDashboardResultsByScope(asSearchResultArray(resolved[0]));
      var scopedDeadlines = filterDashboardResultsByScope(asSearchResultArray(resolved[1]));
      var scopedOverdue = filterDashboardResultsByScope(asSearchResultArray(resolved[2]));

      dashboardState.results = limitedSearchResults(scopedQuery, 80);
      dashboardState.deadlines = limitedSearchResults(sortSearchByDueDateAsc(scopedDeadlines), 40);
      dashboardState.overdue = limitedSearchResults(sortSearchByDueDateAsc(scopedOverdue), 40);
    } catch (err) {
      if (refreshId !== dashboardRefreshSeq) return;
      logFrontendIssue('error', 'dashboard.search', 'Failed to refresh', err);
      dashboardState.results = [];
      dashboardState.deadlines = [];
      dashboardState.overdue = [];
    } finally {
      if (refreshId !== dashboardRefreshSeq) return;
      dashboardState.loading = false;
      renderDashboard();
    }
  }

  function scheduleDashboardRefresh(delayMs) {
    if (!getElDashboardRoot() || embeddedMode) return;
    clearTimeout(dashboardRefreshTimer);
    dashboardRefreshTimer = setTimeout(function () {
      refreshDashboardData();
    }, typeof delayMs === 'number' ? delayMs : 120);
  }

  function setupDashboardControls() {
    if (!getElDashboardRoot()) return;
    if (embeddedMode) {
      getElDashboardRoot().classList.add('hidden');
      applySidebarSectionLayout();
      return;
    }

    dashboardState.pinnedQueries = loadDashboardPinnedQueries();
    dashboardState.scope = normalizeDashboardScope(dashboardState.scope);
    if (dashboardState.pinnedQueries.indexOf(dashboardState.activePinnedQuery) === -1) {
      dashboardState.activePinnedQuery = '';
    }

    if (getElDashboardSearchInput()) getElDashboardSearchInput().value = dashboardState.query || '';
    if (getElDashboardScopeSelect()) getElDashboardScopeSelect().value = dashboardState.scope;

    if (getElDashboardSearchInput()) {
      getElDashboardSearchInput().addEventListener('input', function () {
        setDashboardQuery(getElDashboardSearchInput().value);
        clearTimeout(dashboardSearchDebounce);
        dashboardSearchDebounce = setTimeout(function () {
          refreshDashboardData({ deferRender: true });
        }, 220);
      });
      getElDashboardSearchInput().addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          setDashboardQuery(getElDashboardSearchInput().value);
          refreshDashboardData({ deferRender: true });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDashboardQuery('');
          refreshDashboardData({ deferRender: true });
        }
      });
    }

    if (getElDashboardSearchBtn()) {
      getElDashboardSearchBtn().addEventListener('click', function () {
        setDashboardQuery(getElDashboardSearchInput() ? getElDashboardSearchInput().value : dashboardState.query);
        refreshDashboardData({ deferRender: true });
      });
    }

    if (getElDashboardScopeSelect()) {
      getElDashboardScopeSelect().addEventListener('change', function () {
        setDashboardScope(getElDashboardScopeSelect().value);
        refreshDashboardData({ deferRender: true });
      });
    }

    if (getElDashboardPinBtn()) {
      getElDashboardPinBtn().addEventListener('click', function () {
        var query = String(dashboardState.query || '').trim();
        if (!query) {
          showNotification('Enter a query to pin');
          return;
        }
        var idx = dashboardState.pinnedQueries.indexOf(query);
        if (idx === -1) {
          dashboardState.pinnedQueries.unshift(query);
          dashboardState.activePinnedQuery = query;
          showNotification('Pinned dashboard query');
        } else {
          dashboardState.pinnedQueries.splice(idx, 1);
          if (dashboardState.activePinnedQuery === query) dashboardState.activePinnedQuery = '';
          showNotification('Unpinned dashboard query');
        }
        persistDashboardPrefs();
        renderDashboardPinnedList();
      });
    }

    getElDashboardRoot().addEventListener('click', function (e) {
      var chip = e.target.closest('.dashboard-chip[data-dashboard-query]');
      if (!chip) return;
      e.preventDefault();
      var query = chip.getAttribute('data-dashboard-query') || '';
      setDashboardQuery(query);
      refreshDashboardData({ deferRender: true });
    });

    persistDashboardPrefs();
    renderDashboard();
    scheduleDashboardRefresh(0);
    applySidebarSectionLayout();
  }

  function init() {
    if (embeddedMode) document.body.classList.add('embedded-mode');
    if (typeof window.updateAppBottomInset === 'function') window.updateAppBottomInset();
    ensureSidebarTreeDefaultState();
    setupSearchControls();
    setupDashboardControls();
    setupSidebarSectionResize();
    setupSidebarWidthResize();

    if ($searchInput) {
      $searchInput.addEventListener('input', onSearchInput);
      $searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          $searchInput.value = '';
          exitSearchMode();
        }
      });
    }

    document.addEventListener('keydown', handleKeyNavigation);

    // Management panel close button
    if (getElMgmtClose()) getElMgmtClose().addEventListener('click', function () {
      closeManagementPanel();
    });

    // External file drop on columns container
    getElColumnsContainer().addEventListener('dragover', function (e) {
      if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    getElColumnsContainer().addEventListener('drop', function (e) {
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

    // Sidebar drop: add .md files from OS drag-and-drop when unlocked.
    if (getElSidebar()) {
      getElSidebar().addEventListener('dragover', function (e) {
        if (hierarchyLocked) return;
        if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          getElSidebar().classList.add('drop-zone-active');
        }
      });
      getElSidebar().addEventListener('dragleave', function (e) {
        if (!e.relatedTarget || !getElSidebar().contains(e.relatedTarget)) {
          getElSidebar().classList.remove('drop-zone-active');
        }
      });
      getElSidebar().addEventListener('drop', function (e) {
        getElSidebar().classList.remove('drop-zone-active');
        if (hierarchyLocked) return;
        var dt = e.dataTransfer;
        if (!dt) return;
        var paths = collectDroppedPathsFromDataTransfer(dt);
        if (paths.length === 0) return;
        e.preventDefault();
        addBoardsByPath(paths);
      });
    }

    // Tauri drag-drop payload (paths + pointer position).
    if (hasTauri) {
      tauriListen('tauri://drag-over', function (event) {
        if (hierarchyLocked) return;
        var pos = event.payload.position;
        if (getElSidebar() && pos) {
          if (isPositionInsideElement(pos, getElSidebar())) {
            getElSidebar().classList.add('drop-zone-active');
          } else {
            getElSidebar().classList.remove('drop-zone-active');
          }
        }
      });
      tauriListen('tauri://drag-leave', function () {
        if (getElSidebar()) getElSidebar().classList.remove('drop-zone-active');
      });
      tauriListen('tauri://drag-drop', function (event) {
        if (getElSidebar()) getElSidebar().classList.remove('drop-zone-active');
        if (hierarchyLocked) return;
        var paths = event.payload.paths || [];
        var pos = event.payload.position;
        if (getElSidebar() && pos && !isPositionInsideElement(pos, getElSidebar())) {
          return;
        }
        addBoardsByPath(paths);
      });
    }

    setupSplitControls();
    setupHeaderFileControls();
    setupEmbeddedPaneActivation();
    registerExternalDndBridge();

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
      openCardEditor(focusedCardEl, ci, cj, 'inline');
    } else if (key === 'Escape' && mgmtPanelOpen) {
      closeManagementPanel();
    } else if (key === 'Escape' && focusedCardEl) {
      unfocusCard();
    }
  }

  function navigateCards(key) {
    var allCards = getElColumnsContainer().querySelectorAll('.card');
    if (allCards.length === 0) return;

    if (!focusedCardEl || !focusedCardEl.isConnected) {
      focusCard(allCards[0]);
      return;
    }

    var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
    var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);

    if (key === 'ArrowDown') {
      // Next card in same column
      var next = getElColumnsContainer().querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj + 1) + '"]');
      if (next) focusCard(next);
    } else if (key === 'ArrowUp') {
      // Previous card in same column
      if (cj > 0) {
        var prev = getElColumnsContainer().querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj - 1) + '"]');
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
        var target = getElColumnsContainer().querySelector('.card[data-col-index="' + targetColIdx + '"][data-card-index="' + cj + '"]');
        if (!target) {
          // Try last card in target column
          var colCards = getElColumnsContainer().querySelectorAll('.card[data-col-index="' + targetColIdx + '"]');
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
    if (currentArrowKeyFocusScrollMode !== 'disabled') {
      cardEl.scrollIntoView({
        block: currentArrowKeyFocusScrollMode === 'center' ? 'center' : 'nearest',
        behavior: 'smooth'
      });
    }
    syncSidebarToView();
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

  // ── WebSocket CRDT Sync ─────────────────────────────────────────────

  var syncUserId = null;
  var syncUserName = null;
  var boardPresenceCache = {}; // boardId -> [user_id, ...]
  var editingPresenceMap = {}; // user_id -> { card_kid, user_name, cursor_pos, is_typing }

  function getLiveSyncSession(boardId) {
    if (!liveSyncState) return null;
    if (!boardId) return liveSyncState;
    return liveSyncState.boardId === boardId ? liveSyncState : null;
  }

  function hasLiveSyncSession(boardId) {
    return !!getLiveSyncSession(boardId);
  }

  function canUseLiveSync(boardId) {
    return !!(
      boardId &&
      hasLiveSyncSession(boardId) &&
      LexeraApi.isSyncConnected() &&
      LexeraApi.getSyncBoardId() === boardId
    );
  }

  async function closeLiveSyncSession(boardId) {
    var session = getLiveSyncSession(boardId);
    if (!session) return;
    liveSyncState = null;
    try {
      await LexeraApi.closeLiveSyncSession(session.sessionId);
    } catch (e) {
      // best-effort cleanup
    }
  }

  async function ensureLiveSyncSession(boardId) {
    if (!boardId) return null;
    var existing = getLiveSyncSession(boardId);
    if (existing) return existing;
    if (liveSyncState && liveSyncState.boardId !== boardId) {
      await closeLiveSyncSession();
    }
    var response = await LexeraApi.openLiveSyncSession(boardId);
    liveSyncState = {
      boardId: boardId,
      sessionId: response.sessionId,
      vv: response.vv || '',
      board: response.board || null,
      pendingRemoteUpdates: []
    };
    traceFrontendAction('info', 'liveSync.session', 'Opened live sync session', {
      boardId: boardId,
      sessionId: response.sessionId,
      vvLength: response && response.vv ? response.vv.length : 0,
      sessionIdentity: summarizeBoardIdentity(response.board)
    });
    if (activeBoardId === boardId && fullBoardData && response && response.board) {
      traceBoardIdentityPair('info', 'liveSync.session', 'Identity comparison after live sync session open', boardId, 'local', fullBoardData, 'session', response.board);
    }
    return liveSyncState;
  }

  async function reopenLiveSyncSession(boardId) {
    if (!boardId) return null;
    await closeLiveSyncSession(boardId);
    return ensureLiveSyncSession(boardId);
  }

  function getLiveSyncHelloVv(boardId) {
    var session = getLiveSyncSession(boardId);
    return session && session.vv ? session.vv : '';
  }

  async function applyBoardToLiveSyncSession(boardId, boardData, options) {
    options = options || {};
    if (!canUseLiveSync(boardId)) return false;
    var session = getLiveSyncSession(boardId);
    if (!session) return false;

    console.log('[applyBoardToLiveSync] sending board=' + boardCardSummary(boardData) + ' session_board=' + boardCardSummary(session.board));
    traceBoardIdentityPair('info', 'liveSync.apply', 'Applying local board into live sync session', boardId, 'local', boardData, 'session', session.board, {
      vvLength: session.vv ? session.vv.length : 0
    });
    var response = await LexeraApi.applyLiveSyncBoard(session.sessionId, boardData);
    if (response && response.vv) session.vv = response.vv;
    if (response && response.board) session.board = response.board;
    console.log('[applyBoardToLiveSync] response changed=' + (response && response.changed) + ' response_board=' + boardCardSummary(response && response.board) + ' updates_len=' + (response && response.updates ? response.updates.length : 0));
    if (response && response.board && options.syncSaveBase && boardId === activeBoardId && fullBoardData) {
      var savedLiveBoard = resolveLiveSyncBoardData(cloneBoardData(response.board), boardId);
      setBoardSaveBase(fullBoardData, savedLiveBoard);
      pendingExternalRebaseConflict = null;
      traceFrontendAction('info', 'liveSync.saveBase', 'Updated local save base from live sync save result', {
        boardId: boardId,
        liveSummary: summarizeBoardHierarchy(savedLiveBoard),
        workingSummary: summarizeBoardHierarchy(fullBoardData)
      });
      traceBoardIdentityPair('info', 'liveSync.saveBase', 'Identity comparison after live sync save result', boardId, 'local', fullBoardData, 'saveBase', savedLiveBoard);
    }
    if (response && response.changed && response.updates) {
      if (!LexeraApi.sendSyncUpdate(response.updates)) {
        console.log('[applyBoardToLiveSync] sendSyncUpdate FAILED');
        return false;
      }
      console.log('[applyBoardToLiveSync] sent WS update');
      liveSyncLastLocalBroadcastAt = Date.now();
      lastSaveTime = liveSyncLastLocalBroadcastAt;
    }
    if (response && response.board && !options.skipBoardReplace && boardId === activeBoardId) {
      applyLiveSyncBoardSnapshot(boardId, response.board, options);
    }
    return true;
  }

  async function importLiveSyncMessage(boardId, updates, options) {
    options = options || {};
    var session = getLiveSyncSession(boardId);
    if (!session || !updates) return false;

    if (activeBoardId === boardId && isEditing && !options.force) {
      session.pendingRemoteUpdates.push(updates);
      pendingRefresh = true;
      return true;
    }

    var response = await LexeraApi.importLiveSyncUpdates(session.sessionId, updates);
    if (response && response.vv) session.vv = response.vv;
    if (response && response.board) session.board = response.board;
    if (response && response.changed && response.board && boardId === activeBoardId) {
      traceBoardIdentityPair('info', 'liveSync.import', 'Received remote live sync board update', boardId, 'local', fullBoardData, 'remote', response.board, {
        updateBytes: updates ? updates.length : 0,
        dirty: isBoardDirty()
      });
      if (isBoardDirty()) {
        traceFrontendAction('info', 'liveSync.rebase', 'Rebasing dirty local board after remote live sync update', {
          boardId: boardId,
          incomingSummary: summarizeBoardHierarchy(response.board),
          workingSummary: summarizeBoardHierarchy(fullBoardData)
        });
        await rebaseDirtyBoardFromServer('live-sync');
      } else {
        applyLiveSyncBoardSnapshot(boardId, response.board, options);
      }
    }
    return !!(response && response.changed);
  }

  async function flushPendingLiveSyncUpdates(options) {
    options = options || {};
    var session = getLiveSyncSession(activeBoardId);
    if (!session || !session.pendingRemoteUpdates || session.pendingRemoteUpdates.length === 0) {
      return false;
    }
    if (isEditing && !options.force) {
      return false;
    }

    var pending = session.pendingRemoteUpdates.slice();
    session.pendingRemoteUpdates.length = 0;
    var changed = false;
    var lastBoard = null;
    for (var i = 0; i < pending.length; i++) {
      var response = await LexeraApi.importLiveSyncUpdates(session.sessionId, pending[i]);
      if (response && response.vv) session.vv = response.vv;
      if (response && response.board) session.board = response.board;
      if (response && response.changed) {
        changed = true;
      }
      if (response && response.board) {
        lastBoard = response.board;
      }
    }
    if (changed && lastBoard && session.boardId === activeBoardId) {
      traceBoardIdentityPair('info', 'liveSync.import', 'Applying queued remote live sync updates', session.boardId, 'local', fullBoardData, 'remote', lastBoard, {
        batchCount: pending.length,
        dirty: isBoardDirty()
      });
      if (isBoardDirty()) {
        traceFrontendAction('info', 'liveSync.rebase', 'Rebasing dirty local board after queued remote live sync updates', {
          boardId: session.boardId,
          incomingSummary: summarizeBoardHierarchy(lastBoard),
          workingSummary: summarizeBoardHierarchy(fullBoardData)
        });
        await rebaseDirtyBoardFromServer('live-sync-pending');
      } else {
        applyLiveSyncBoardSnapshot(session.boardId, lastBoard, options);
      }
    }
    return changed;
  }

  async function flushDeferredBoardRefresh(options) {
    options = options || {};
    if (!pendingRefresh) return false;
    pendingRefresh = false;
    if (hasLiveSyncSession(activeBoardId)) {
      return flushPendingLiveSyncUpdates(options);
    }
    // Never reload from disk if there are unsaved changes
    if (activeBoardId && !isBoardDirty()) {
      await loadBoard(activeBoardId);
      return true;
    }
    return false;
  }

  function clearPendingCardDraftSync() {
    if (liveDraftSyncTimer) {
      clearTimeout(liveDraftSyncTimer);
      liveDraftSyncTimer = null;
    }
    liveDraftSyncRequest = null;
  }

  function cloneBoardWithDraftCardContent(boardData, colIndex, fullCardIdx, content) {
    var draftBoard = cloneBoardData(boardData);
    var columns = getAllColumnsFromBoardData(draftBoard);
    var column = columns[colIndex];
    if (!column || !column.cards || !column.cards[fullCardIdx]) return null;
    column.cards[fullCardIdx].content = content;
    return draftBoard;
  }

  async function syncCardDraftToLiveSession(colIndex, fullCardIdx, content) {
    if (!canUseLiveSync(activeBoardId) || !fullBoardData) return false;
    var draftBoard = cloneBoardWithDraftCardContent(fullBoardData, colIndex, fullCardIdx, content);
    if (!draftBoard) return false;
    return applyBoardToLiveSyncSession(activeBoardId, draftBoard, { skipBoardReplace: true });
  }

  function queueCardDraftLiveSync(colIndex, fullCardIdx, content) {
    if (!canUseLiveSync(activeBoardId)) return;
    liveDraftSyncRequest = {
      boardId: activeBoardId,
      colIndex: colIndex,
      fullCardIdx: fullCardIdx,
      content: content
    };
    if (liveDraftSyncTimer) clearTimeout(liveDraftSyncTimer);
    liveDraftSyncTimer = setTimeout(function () {
      liveDraftSyncTimer = null;
      var request = liveDraftSyncRequest;
      liveDraftSyncRequest = null;
      if (!request || request.boardId !== activeBoardId) return;
      syncCardDraftToLiveSession(request.colIndex, request.fullCardIdx, request.content).catch(function (err) {
        logFrontendIssue('error', 'live-sync', 'Failed to sync card draft', err);
      });
    }, 250);
  }

  async function revertCardDraftLiveSync(colIndex, fullCardIdx, originalContent) {
    clearPendingCardDraftSync();
    if (!canUseLiveSync(activeBoardId)) return false;
    return syncCardDraftToLiveSession(colIndex, fullCardIdx, originalContent);
  }

  /** Fetch the local user ID for sync, caching it for the session. */
  async function ensureSyncUserId() {
    if (syncUserId) return syncUserId;
    try {
      var data = await LexeraApi.request('/collab/me');
      if (data && data.id) syncUserId = data.id;
      if (data && data.name) syncUserName = data.name;
    } catch (e) {
      // collab/me not available — use a fallback
    }
    if (!syncUserId) syncUserId = 'anon-' + Math.random().toString(36).slice(2, 8);
    return syncUserId;
  }

  /** Connect sync for the active board. Disconnects previous if different. */
  var syncDebounceTimer = null;
  async function connectSyncForBoard(boardId) {
    if (!boardId) {
      LexeraApi.disconnectSync();
      await closeLiveSyncSession();
      return;
    }
    try {
      await ensureLiveSyncSession(boardId);
    } catch (err) {
      logFrontendIssue('warn', 'live-sync', 'Failed to open session for board ' + boardId, err);
    }
    if (LexeraApi.isSyncConnected() && LexeraApi.getSyncBoardId() === boardId) return;
    var userId = await ensureSyncUserId();
    LexeraApi.connectSync(boardId, userId, function (message) {
      if (!message || !message.updates || activeBoardId !== boardId) return;
      if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
      syncDebounceTimer = setTimeout(function () {
        syncDebounceTimer = null;
        importLiveSyncMessage(boardId, message.updates).catch(function (err) {
          logFrontendIssue('error', 'live-sync', 'Failed to import sync update', err);
          if (activeBoardId === boardId && !isEditing) loadBoard(boardId);
        });
      }, message.type === 'hello' ? 0 : 50);
    }, function (onlineUsers) {
      // On ServerPresence: update cache and sidebar badge
      boardPresenceCache[boardId] = onlineUsers;
      updateBoardPresenceIndicator(boardId);
      // Clean up editing presence for users who went offline
      var changed = false;
      for (var uid in editingPresenceMap) {
        if (onlineUsers.indexOf(uid) === -1) {
          delete editingPresenceMap[uid];
          changed = true;
        }
      }
      if (changed) updateCardEditingIndicators();
    }, {
      getHelloVv: function () {
        return getLiveSyncHelloVv(boardId);
      },
      onEditingPresence: handleEditingPresence
    });
  }

  function updateBoardPresenceIndicator(boardId) {
    var wrapper = document.querySelector('.board-item-wrapper[data-board-id="' + boardId + '"]');
    if (!wrapper) return;
    var badge = wrapper.querySelector('.board-presence-badge');
    var count = (boardPresenceCache[boardId] || []).length;
    if (badge) {
      if (count > 0) {
        badge.textContent = count;
        badge.title = count + ' user(s) online';
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  // ── Per-card editing presence ──────────────────────────────────────

  var PRESENCE_COLORS = [
    '#e57373', '#f06292', '#ba68c8', '#9575cd',
    '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1',
    '#4db6ac', '#81c784', '#aed581', '#ffb74d'
  ];

  function userIdToColor(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
  }

  function getInitials(name) {
    if (!name) return 'U';
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }

  function handleEditingPresence(msg) {
    var userId = msg.user_id;
    if (!userId || userId === syncUserId) return;
    if (!msg.card_kid) {
      delete editingPresenceMap[userId];
    } else {
      editingPresenceMap[userId] = {
        card_kid: msg.card_kid,
        user_name: msg.user_name || userId,
        cursor_pos: msg.cursor_pos,
        is_typing: msg.is_typing
      };
    }
    updateCardEditingIndicators();
  }

  function updateCardEditingIndicators() {
    // Remove all existing indicators and remote-editing classes
    var existing = document.querySelectorAll('.card-editing-indicator');
    for (var i = 0; i < existing.length; i++) {
      existing[i].parentNode.removeChild(existing[i]);
    }
    var remoteCards = document.querySelectorAll('.card.remote-editing');
    for (var i = 0; i < remoteCards.length; i++) {
      remoteCards[i].classList.remove('remote-editing');
    }

    // Build kid -> [editors] map
    var kidEditors = {};
    for (var uid in editingPresenceMap) {
      var entry = editingPresenceMap[uid];
      if (!entry.card_kid) continue;
      if (!kidEditors[entry.card_kid]) kidEditors[entry.card_kid] = [];
      kidEditors[entry.card_kid].push(entry);
    }

    if (Object.keys(kidEditors).length === 0) return;

    // Find card elements by data-card-kid attribute
    for (var kid in kidEditors) {
      var cardEl = document.querySelector('.card[data-card-kid="' + kid + '"]');
      if (!cardEl) continue;
      cardEl.classList.add('remote-editing');
      var indicator = document.createElement('div');
      indicator.className = 'card-editing-indicator';
      var html = '';
      var editors = kidEditors[kid];
      for (var j = 0; j < editors.length; j++) {
        var e = editors[j];
        var color = userIdToColor(e.user_name || 'unknown');
        var typingClass = e.is_typing ? ' typing' : '';
        html += '<span class="card-editor-badge' + typingClass + '" style="background:' + color + '" title="' + escapeHtml(e.user_name) + '">'
          + escapeHtml(getInitials(e.user_name))
          + '</span>';
      }
      indicator.innerHTML = html;
      var header = cardEl.querySelector('.card-header');
      var menuBtn = cardEl.querySelector('.card-menu-btn');
      if (header && menuBtn) {
        header.insertBefore(indicator, menuBtn);
      } else if (header) {
        header.appendChild(indicator);
      }
    }
  }

  var editingPresenceTimer = null;
  var editingPresenceRequest = null;

  function queueEditingPresenceBroadcast(cardKid, cursorPos, isTyping) {
    if (!cardKid || !LexeraApi.isSyncConnected()) return;
    editingPresenceRequest = { cardKid: cardKid, cursorPos: cursorPos, isTyping: isTyping };
    if (editingPresenceTimer) return;
    editingPresenceTimer = setTimeout(function () {
      editingPresenceTimer = null;
      var req = editingPresenceRequest;
      editingPresenceRequest = null;
      if (!req) return;
      LexeraApi.sendEditingPresence(req.cardKid, syncUserName || syncUserId, req.cursorPos, req.isTyping);
    }, 250);
  }

  function clearEditingPresenceQueue() {
    if (editingPresenceTimer) {
      clearTimeout(editingPresenceTimer);
      editingPresenceTimer = null;
    }
    editingPresenceRequest = null;
  }

  function handleSSEEvent(event) {
    try {
    if (!activeBoardId || searchMode) return;
    var kind = event.kind || event.type || '';
    var boardId = event.board_id || event.boardId || '';
    var includeBoardIds = event.board_ids || event.boardIds || [];
    if (boardId && boardId !== activeBoardId) return;
    if (kind === 'IncludeFileChanged' && Array.isArray(includeBoardIds) && includeBoardIds.length > 0 && includeBoardIds.indexOf(activeBoardId) === -1) {
      traceFrontendAction('info', 'sse.fileChanged.ignore', 'Ignoring include change for unrelated board', {
        activeBoardId: activeBoardId,
        includeBoardIds: includeBoardIds
      });
      return;
    }
    if (kind === 'MainFileChanged' || kind === 'IncludeFileChanged') {
      // Skip echoes caused by our own saves
      if (Date.now() - lastSaveTime < SAVE_DEBOUNCE_MS) return;
      if (canUseLiveSync(activeBoardId) && Date.now() - liveSyncLastLocalBroadcastAt < SAVE_DEBOUNCE_MS) return;
      var eventGen = event.generation;
      var eventRevision = typeof event.revision === 'string' && event.revision ? event.revision : null;
      if (kind === 'MainFileChanged' && eventRevision && _lastLoadedRevision && eventRevision === _lastLoadedRevision) {
        traceFrontendAction('info', 'sse.fileChanged.stale', 'Ignoring stale file change event', {
          eventRevision: eventRevision,
          loadedRevision: _lastLoadedRevision,
          eventGeneration: eventGen,
          loadedGeneration: _lastLoadedGeneration
        });
        return;
      }
      traceFrontendAction('info', 'sse.fileChanged', 'File changed on disk, reconciling with active board', {
        boardId: activeBoardId,
        kind: kind,
        dirty: _boardDirty,
        eventRevision: eventRevision,
        loadedRevision: _lastLoadedRevision,
        eventGeneration: eventGen,
        loadedGeneration: _lastLoadedGeneration,
        includeBoardIds: includeBoardIds
      });
      if (!_boardDirty) {
        Promise.resolve()
          .then(function () { return loadBoard(activeBoardId); })
          .catch(function (err) {
            logFrontendIssue('warn', 'sse.fileChanged.reload', 'Failed to reload clean board after external change', err);
            showNotification('Board file changed on disk. Reload failed.');
          });
        return;
      }
      Promise.resolve()
        .then(function () { return rebaseDirtyBoardFromServer(kind); })
        .catch(function (err) {
          logFrontendIssue('warn', 'sse.fileChanged.rebase', 'Failed to rebase dirty board after external change', err);
          showNotification('Board file changed on disk. Rebase failed; your local draft was kept.');
        });
    }
    } catch (err) {
      logFrontendIssue('error', 'sse', 'Error in handleSSEEvent', err);
    }
  }

  // --- Polling ---

  async function poll() {
    try {
      const ok = await LexeraApi.checkStatus();
      setConnected(ok);
      if (!ok) return;
    } catch (err) {
      logFrontendIssue('warn', 'poll.status', 'Failed to check backend status', err);
      setConnected(false);
      return;
    }

    connectSSEIfReady();
    connectBackendLogStreamIfReady();

    try {
      const data = await LexeraApi.getBoards();
      boards = data.boards || [];
      // Fetch remote boards (non-blocking)
      LexeraApi.getRemoteBoards().then(function (rb) {
        remoteBoards = rb.boards || [];
      }).catch(function (err) {
        logFrontendIssue('warn', 'boards.remote', 'Failed to load remote boards', err);
        remoteBoards = [];
      });
      await refreshBoardHierarchyCache(boards);
      renderBoardList();
      if (!embeddedMode && splitViewMode !== 'single') {
        refreshSplitFrames(false);
      }

      if (activeBoardId && !searchMode) {
        const stillExists = boards.find(b => b.id === activeBoardId);
        if (stillExists) {
          // Never reload the board if there are unsaved changes — that would
          // discard the user's work.  Only reload when the board is clean.
          if (!isBoardDirty()) {
            await loadBoard(activeBoardId);
          }
        } else {
          await closeLiveSyncSession(activeBoardId);
          LexeraApi.disconnectSync();
          activeBoardId = null;
          activeBoardData = null;
          fullBoardData = null;
          _lastLoadedGeneration = null;
          _lastLoadedRevision = null;
          if (!embeddedMode) localStorage.removeItem('lexera-last-board');
          renderMainView();
        }
      } else if (!activeBoardId && !searchMode) {
        var lastBoard = embeddedMode ? embeddedPreferredBoardId : localStorage.getItem('lexera-last-board');
        if (lastBoard) {
          var found = boards.find(b => b.id === lastBoard);
          if (found) {
            await selectBoard(lastBoard);
          }
        }
      }
      refreshHeaderFileControls();
      scheduleDashboardRefresh(120);
    } catch (err) {
      logFrontendIssue('warn', 'poll.refresh', 'Failed to refresh board list or active board state', err);
      // keep previous state
      refreshHeaderFileControls();
      scheduleDashboardRefresh(250);
    }
  }

  function setConnected(state) {
    if (state && !connected) loadTemplatesOnce();
    connected = state;
    getElConnectionDot().classList.toggle('connected', state);
  }

  // --- Board List ---

  function getSidebarExpandedBoards() {
    try { return JSON.parse(localStorage.getItem('lexera-sidebar-expanded') || '[]'); } catch (e) {
      logFrontendIssue('warn', 'sidebar.state', 'Failed to read expanded sidebar boards', e);
      return [];
    }
  }
  function saveSidebarExpandedBoards(ids) {
    localStorage.setItem('lexera-sidebar-expanded', JSON.stringify(ids));
  }

  function getSidebarTreeState(boardId) {
    try {
      var all = JSON.parse(localStorage.getItem('lexera-sidebar-tree-state') || '{}');
      return all[boardId] || { rows: [], stacks: [], columns: [] };
    } catch (e) {
      logFrontendIssue('warn', 'sidebar.tree', 'Failed to read sidebar tree state for board ' + boardId, e);
      return { rows: [], stacks: [], columns: [] };
    }
  }

  function hasSidebarTreeState(boardId) {
    try {
      var all = JSON.parse(localStorage.getItem('lexera-sidebar-tree-state') || '{}');
      return Object.prototype.hasOwnProperty.call(all, boardId);
    } catch (e) {
      logFrontendIssue('warn', 'sidebar.tree', 'Failed to check sidebar tree state for board ' + boardId, e);
      return false;
    }
  }

  function saveSidebarTreeState(boardId, state) {
    try {
      var all = JSON.parse(localStorage.getItem('lexera-sidebar-tree-state') || '{}');
      all[boardId] = state;
      localStorage.setItem('lexera-sidebar-tree-state', JSON.stringify(all));
    } catch (e) {
      logFrontendIssue('warn', 'sidebar.tree', 'Failed to persist sidebar tree state for board ' + boardId, e);
    }
  }

  function toggleSidebarTreeNode(boardId, kind, id) {
    var state = getSidebarTreeState(boardId);
    var arr = state[kind] || [];
    var idx = arr.indexOf(id);
    if (idx !== -1) { arr.splice(idx, 1); } else { arr.push(id); }
    state[kind] = arr;
    saveSidebarTreeState(boardId, state);
  }

  // Alt+click helper: expand or collapse all descendant tree nodes inside a container.
  // `expand` = true means set children to expanded state; false = collapsed.
  function setDescendantTreeState(container, expand, boardId) {
    TreeView.setDescendantsExpanded(container, expand);
    // Persist: collect all descendant tree-node IDs and batch-update state
    var state = getSidebarTreeState(boardId);
    var nodes = container.querySelectorAll('.tree-node[data-tree-id]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var treeId = n.getAttribute('data-tree-id');
      if (!treeId) continue;
      var kind = n.classList.contains('tree-row') ? 'rows'
        : n.classList.contains('tree-stack') ? 'stacks'
        : n.classList.contains('tree-column') ? 'columns' : null;
      if (!kind) continue;
      var arr = state[kind] || [];
      var idx = arr.indexOf(treeId);
      // rows/stacks: in array = collapsed; columns: in array = expanded
      if (kind === 'columns') {
        if (expand && idx === -1) arr.push(treeId);
        else if (!expand && idx !== -1) arr.splice(idx, 1);
      } else {
        if (expand && idx !== -1) arr.splice(idx, 1);
        else if (!expand && idx === -1) arr.push(treeId);
      }
      state[kind] = arr;
    }
    saveSidebarTreeState(boardId, state);
  }

  // Convert kanban rows/stacks/columns/cards into generic TreeView node arrays.
  function buildSidebarTreeNodes(rows, boardId, treeState, hasTreeState, singleRow, singleStack) {
    var nodes = [];
    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri];
      var rowId = row.id || ('row-' + ri);
      var rowExpanded = hasTreeState ? treeState.rows.indexOf(rowId) === -1 : (singleRow ? true : false);
      var rowIsLast = ri === rows.length - 1;

      var stackNodes = [];
      for (var si = 0; si < row.stacks.length; si++) {
        var stack = row.stacks[si];
        var stackId = stack.id || ('stack-' + ri + '-' + si);
        var stackExpanded = hasTreeState ? treeState.stacks.indexOf(stackId) === -1 : (singleStack ? true : false);
        var stackIsLast = si === row.stacks.length - 1;

        var colNodes = [];
        for (var ci = 0; ci < stack.columns.length; ci++) {
          var col = stack.columns[ci];
          var colIdx = col.index != null ? col.index : -1;
          var colId = 'col-' + colIdx;
          var colExpanded = hasTreeState ? treeState.columns.indexOf(colId) !== -1 : false;
          var cardCount = col.cards ? col.cards.length : 0;

          var cardNodes = [];
          if (cardCount > 0) {
            for (var cdi = 0; cdi < col.cards.length; cdi++) {
              cardNodes.push({
                id: null,
                label: cardPreviewText(col.cards[cdi].content),
                type: 'card',
                grip: true,
                gripTitle: 'Drag to move',
                hasToggle: false,
                children: null,
                expanded: false,
                attrs: {
                  'data-board-id': boardId,
                  'data-row-index': ri.toString(),
                  'data-stack-index': si.toString(),
                  'data-col-local-index': ci.toString(),
                  'data-col-index': colIdx >= 0 ? colIdx.toString() : null,
                  'data-card-index': cdi.toString(),
                  'data-tree-drag': 'tree-card'
                }
              });
            }
          }

          colNodes.push({
            id: colId,
            label: stripStackTag(col.title),
            count: cardCount,
            type: 'column',
            expanded: colExpanded,
            hasToggle: cardCount > 0,
            grip: true,
            children: cardNodes.length > 0 ? cardNodes : null,
            attrs: {
              'data-board-id': boardId,
              'data-col-index': colIdx >= 0 ? colIdx.toString() : null,
              'data-row-index': ri.toString(),
              'data-stack-index': si.toString(),
              'data-col-local-index': ci.toString(),
              'data-tree-drag': 'tree-column'
            }
          });
        }

        if (!singleStack) {
          stackNodes.push({
            id: stackId,
            label: stack.title || 'Stack ' + (si + 1),
            count: countCardsInStack(stack),
            type: 'stack',
            expanded: stackExpanded,
            grip: true,
            children: colNodes,
            attrs: {
              'data-board-id': boardId,
              'data-row-index': ri.toString(),
              'data-stack-index': si.toString(),
              'data-tree-drag': 'tree-stack'
            }
          });
        } else {
          stackNodes = stackNodes.concat(colNodes);
        }
      }

      if (!singleRow) {
        nodes.push({
          id: rowId,
          label: row.title || 'Row ' + (ri + 1),
          count: countCardsInRow(row),
          type: 'row',
          expanded: rowExpanded,
          grip: true,
          children: stackNodes,
          attrs: {
            'data-board-id': boardId,
            'data-row-index': ri.toString(),
            'data-tree-drag': 'tree-row'
          }
        });
      } else {
        nodes = nodes.concat(stackNodes);
      }
    }
    return nodes;
  }

  function countCardsInRow(row) {
    var n = 0;
    for (var s = 0; s < row.stacks.length; s++) {
      for (var c = 0; c < row.stacks[s].columns.length; c++) {
        n += row.stacks[s].columns[c].cards ? row.stacks[s].columns[c].cards.length : 0;
      }
    }
    return n;
  }

  function countCardsInStack(stack) {
    var n = 0;
    for (var c = 0; c < stack.columns.length; c++) {
      n += stack.columns[c].cards ? stack.columns[c].cards.length : 0;
    }
    return n;
  }

  function countCardsInRows(rows) {
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      total += countCardsInRow(rows[i]);
    }
    return total;
  }

  function cloneRows(rows) {
    return JSON.parse(JSON.stringify(rows || []));
  }

  function cloneBoardData(boardData) {
    if (!boardData) return null;
    return JSON.parse(JSON.stringify(boardData));
  }

  function boardDraftStorageKey(boardId) {
    return boardId ? ('lexera-board-draft:' + boardId) : '';
  }

  function getBoardCardKids(boardData) {
    var kids = [];
    var cols = getAllColumnsFromBoardData(boardData);
    for (var i = 0; i < cols.length; i++) {
      var cards = cols[i] && cols[i].cards ? cols[i].cards : [];
      for (var j = 0; j < cards.length; j++) {
        if (cards[j] && cards[j].kid) kids.push(cards[j].kid);
      }
    }
    return kids;
  }

  function getBoardCardIdentityStats(boardA, boardB) {
    var aKids = getBoardCardKids(boardA);
    var bKids = getBoardCardKids(boardB);
    var seen = Object.create(null);
    var overlap = 0;
    for (var i = 0; i < aKids.length; i++) seen[aKids[i]] = true;
    for (var j = 0; j < bKids.length; j++) {
      if (seen[bKids[j]]) overlap++;
    }
    return {
      boardACards: aKids.length,
      boardBCards: bKids.length,
      overlap: overlap
    };
  }

  function summarizeBoardIdentity(boardData, limit) {
    var kids = getBoardCardKids(boardData);
    var max = typeof limit === 'number' ? limit : 6;
    return {
      summary: summarizeBoardHierarchy(boardData),
      cards: kids.length,
      sampleKids: kids.slice(0, max)
    };
  }

  function describeBoardIdentityPair(labelA, boardA, labelB, boardB, limit) {
    var max = typeof limit === 'number' ? limit : 6;
    var aKids = getBoardCardKids(boardA);
    var bKids = getBoardCardKids(boardB);
    var seenA = Object.create(null);
    var seenB = Object.create(null);
    var overlap = 0;
    var onlyA = [];
    var onlyB = [];
    var i;
    for (i = 0; i < aKids.length; i++) seenA[aKids[i]] = true;
    for (i = 0; i < bKids.length; i++) seenB[bKids[i]] = true;
    for (i = 0; i < aKids.length; i++) {
      if (seenB[aKids[i]]) overlap++;
      else if (onlyA.length < max) onlyA.push(aKids[i]);
    }
    for (i = 0; i < bKids.length; i++) {
      if (!seenA[bKids[i]] && onlyB.length < max) onlyB.push(bKids[i]);
    }
    return {
      labels: [labelA, labelB],
      stats: {
        boardACards: aKids.length,
        boardBCards: bKids.length,
        overlap: overlap
      },
      onlyA: onlyA,
      onlyB: onlyB,
      summaryA: summarizeBoardHierarchy(boardA),
      summaryB: summarizeBoardHierarchy(boardB)
    };
  }

  function traceBoardIdentityPair(level, target, message, boardId, labelA, boardA, labelB, boardB, extra) {
    var details = {
      boardId: boardId || null,
      pair: describeBoardIdentityPair(labelA, boardA, labelB, boardB)
    };
    if (extra && typeof extra === 'object') {
      for (var key in extra) details[key] = extra[key];
    }
    traceFrontendAction(level, target, message, details);
  }

  function hasBoardIdentityMismatch(boardA, boardB) {
    if (!boardA || !boardB) return false;
    var stats = getBoardCardIdentityStats(boardA, boardB);
    return stats.boardACards > 0 && stats.boardBCards > 0 && stats.overlap === 0;
  }

  function saveLocalBoardDraft(boardId, boardData) {
    if (!boardId || !boardData) return;
    try {
      var baseBoard = getBoardSaveBase(boardData) || boardData;
      localStorage.setItem(boardDraftStorageKey(boardId), JSON.stringify({
        savedAt: Date.now(),
        revision: _lastLoadedRevision || (activeBoardData && activeBoardData.revision ? activeBoardData.revision : null),
        board: cloneBoardData(boardData),
        baseBoard: cloneBoardData(baseBoard)
      }));
    } catch (err) {
      logFrontendIssue('warn', 'board.draft.save', 'Failed to persist local board draft', err);
    }
  }

  function loadLocalBoardDraft(boardId) {
    if (!boardId) return null;
    try {
      var raw = localStorage.getItem(boardDraftStorageKey(boardId));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.board ? parsed : null;
    } catch (err) {
      logFrontendIssue('warn', 'board.draft.load', 'Failed to load local board draft', err);
      return null;
    }
  }

  function clearLocalBoardDraft(boardId) {
    if (!boardId) return;
    try {
      localStorage.removeItem(boardDraftStorageKey(boardId));
    } catch (err) {
      logFrontendIssue('warn', 'board.draft.clear', 'Failed to clear local board draft', err);
    }
  }

  function boardCardSummary(bd) {
    if (!bd) return '(null)';
    var cols = (bd.rows && bd.rows.length > 0)
      ? bd.rows.flatMap(function(r) { return (r.stacks || []).flatMap(function(s) { return s.columns || []; }); })
      : (bd.columns || []);
    return cols.map(function(c) {
      var kids = (c.cards || []).map(function(card) { return card.kid || '??'; });
      return '[' + c.title + ':' + kids.join(',') + ']';
    }).join(' ');
  }

  function setBoardSaveBase(boardData, baseBoardData) {
    if (!boardData || typeof boardData !== 'object') return boardData;
    Object.defineProperty(boardData, '__lexeraSaveBase', {
      value: cloneBoardData(baseBoardData || boardData),
      writable: true,
      configurable: true,
      enumerable: false
    });
    return boardData;
  }

  function getBoardSaveBase(boardData) {
    return boardData && boardData.__lexeraSaveBase ? boardData.__lexeraSaveBase : null;
  }

  function resolveSavedBoardData(boardData, result, boardId) {
    var savedBoard = result && result.board ? result.board : boardData;
    ensureBoardRowsForMutation(savedBoard, getMutationBoardTitle(boardId, savedBoard));
    if (!savedBoard.columns) savedBoard.columns = [];
    return setBoardSaveBase(savedBoard, savedBoard);
  }

  function resolveLiveSyncBoardData(boardData, boardId) {
    if (!boardData) return null;
    ensureBoardRowsForMutation(boardData, getMutationBoardTitle(boardId, boardData));
    if (!boardData.columns) boardData.columns = [];
    return setBoardSaveBase(boardData, boardData);
  }

  function applyLiveSyncBoardSnapshot(boardId, boardData, options) {
    options = options || {};
    if (!boardData || boardId !== activeBoardId) return;
    var replaceLocalBoard = !!options.replaceLocalBoard || !isBoardDirty();
    traceFrontendAction('info', 'liveSync.snapshot', replaceLocalBoard
      ? 'Adopting live sync snapshot into active board'
      : 'Updating save base from live sync response while preserving dirty local board', {
      boardId: boardId,
      replaceLocalBoard: replaceLocalBoard,
      incomingSummary: summarizeBoardHierarchy(boardData),
      currentSummary: summarizeBoardHierarchy(fullBoardData)
    });
    var canonicalBoard = resolveLiveSyncBoardData(cloneBoardData(boardData), boardId);
    if (liveSyncState && liveSyncState.boardId === boardId) {
      liveSyncState.board = canonicalBoard;
    }
    if (fullBoardData) {
      traceBoardIdentityPair(replaceLocalBoard ? 'info' : 'warn', 'liveSync.snapshot', 'Identity comparison before applying live sync snapshot', boardId, 'local', fullBoardData, 'incoming', canonicalBoard, {
        replaceLocalBoard: replaceLocalBoard
      });
    }
    if (replaceLocalBoard) {
      fullBoardData = cloneBoardData(canonicalBoard);
      ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
      if (!fullBoardData.columns) fullBoardData.columns = [];
      setBoardSaveBase(fullBoardData, canonicalBoard);
      clearBoardDirty();
    } else if (fullBoardData) {
      setBoardSaveBase(fullBoardData, canonicalBoard);
    }
    if (fullBoardData) {
      traceBoardIdentityPair('info', 'liveSync.snapshot', 'Identity comparison after applying live sync snapshot', boardId, 'local', fullBoardData, 'saveBase', getBoardSaveBase(fullBoardData));
      if (liveSyncState && liveSyncState.boardId === boardId) {
        traceBoardIdentityPair('info', 'liveSync.snapshot', 'Identity comparison after syncing live sync snapshot into session', boardId, 'local', fullBoardData, 'session', liveSyncState.board);
      }
    }
    if (activeBoardData) {
      delete activeBoardData.version;
      delete activeBoardData.revision;
    }
    updateDisplayFromFullBoard();
    setBoardHierarchyRows(boardId, fullBoardData, fullBoardData ? (fullBoardData.title || '') : '');
    if (options.skipRender) return;
    if (options.refreshMainView) {
      renderMainView();
    } else {
      renderColumns();
      renderBoardList();
    }
    refreshHeaderFileControls();
    scheduleDashboardRefresh(80);
  }

  var pendingExternalRebaseConflict = null;
  var _rebaseInFlight = null;

  function applyRebasedBoardSnapshot(boardId, workingBoard, currentBoard, result, options) {
    options = options || {};
    if (!workingBoard || boardId !== activeBoardId) return;
    fullBoardData = workingBoard;
    ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
    if (!fullBoardData.columns) fullBoardData.columns = [];
    setBoardSaveBase(fullBoardData, currentBoard || workingBoard);
    pendingExternalRebaseConflict = null;
    if (activeBoardData) {
      if (result && typeof result.version === 'number') activeBoardData.version = result.version;
      if (result && result.revision) activeBoardData.revision = result.revision;
    }
    if (result && typeof result.generation === 'number') {
      _lastLoadedGeneration = result.generation;
    }
    _lastLoadedRevision = result && result.revision ? result.revision : _lastLoadedRevision;
    updateDisplayFromFullBoard();
    setBoardHierarchyRows(boardId, fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
    renderColumns();
    renderBoardList();
    refreshHeaderFileControls();
    scheduleDashboardRefresh(80);
    markBoardDirty();
    saveLocalBoardDraft(boardId, fullBoardData);
    if (!options.silent) {
      if (result && result.merged && result.autoMerged > 0) {
        showNotification('Integrated external changes into your draft (' + result.autoMerged + ' auto-merge(s)).');
      } else {
        showNotification('Integrated external changes into your draft.');
      }
    }
  }

  async function rebaseDirtyBoardFromServer(triggerKind) {
    if (!activeBoardId || !fullBoardData) return false;
    if (_rebaseInFlight) return _rebaseInFlight;
    var baseBoardData = getBoardSaveBase(fullBoardData);
    if (!baseBoardData) {
      setBoardSaveBase(fullBoardData, fullBoardData);
      baseBoardData = getBoardSaveBase(fullBoardData);
    }
    _rebaseInFlight = (async function () {
      try {
        traceFrontendAction('info', 'board.rebase', 'Rebasing dirty board against latest external state', {
          boardId: activeBoardId,
          trigger: triggerKind || null,
          baseSummary: summarizeBoardHierarchy(baseBoardData),
          workingSummary: summarizeBoardHierarchy(fullBoardData)
        });
        traceBoardIdentityPair('info', 'board.rebase', 'Identity comparison before rebase request', activeBoardId, 'working', fullBoardData, 'base', baseBoardData, {
          trigger: triggerKind || null
        });
        var result = await LexeraApi.rebaseBoardWithBase(activeBoardId, baseBoardData, fullBoardData);
        var currentBoard = result && result.currentBoard ? result.currentBoard : null;
        if (!result || !currentBoard) return false;
        traceBoardIdentityPair('info', 'board.rebase', 'Identity comparison between rebase current board and working board', activeBoardId, 'working', fullBoardData, 'current', currentBoard, {
          trigger: triggerKind || null,
          hasConflicts: !!(result && result.hasConflicts)
        });
        if (result.hasConflicts) {
          pendingExternalRebaseConflict = {
            result: result,
            savedAt: Date.now()
          };
          traceFrontendAction('warn', 'board.rebase.conflict', 'External changes conflict with local draft; preserving local draft', {
            boardId: activeBoardId,
            trigger: triggerKind || null,
            conflicts: result.conflicts || 0,
            autoMerged: result.autoMerged || 0
          });
          showExternalRebaseConflictDialog(result);
          return false;
        }
        applyRebasedBoardSnapshot(activeBoardId, result.board || fullBoardData, currentBoard, result);
        return true;
      } catch (err) {
        logFrontendIssue('error', 'board.rebase', 'Failed to rebase dirty board against latest external state', err);
        return false;
      } finally {
        _rebaseInFlight = null;
      }
    })();
    return _rebaseInFlight;
  }

  function rowsFromLegacyColumns(columns, boardTitle) {
    var cols = (columns || []).map(function (col) {
      return {
        index: col.index,
        title: col.title,
        cards: (col.cards || []).map(function (card) {
          return {
            id: card.id,
            content: card.content,
            checked: !!card.checked,
            kid: card.kid || null,
          };
        }),
      };
    });
    if (cols.length === 0) return [];

    var groups = [];
    for (var i = 0; i < cols.length; i++) {
      var hasTag = /(?:^|\s)#stack(?:\s|$)/.test(cols[i].title);
      if (hasTag && groups.length > 0) groups[groups.length - 1].push(cols[i]);
      else groups.push([cols[i]]);
    }

    var stacks = [];
    for (var g = 0; g < groups.length; g++) {
      for (var c = 0; c < groups[g].length; c++) {
        groups[g][c].title = stripStackTag(groups[g][c].title);
      }
      stacks.push({
        id: 'stack-' + (g + 1),
        title: 'Stack ' + (g + 1),
        columns: groups[g],
      });
    }

    return [{
      id: 'row-1',
      title: boardTitle || 'Board',
      stacks: stacks,
    }];
  }

  function rowsForBoardData(fullBoard, fallbackTitle) {
    if (fullBoard && fullBoard.rows && fullBoard.rows.length > 0) {
      return cloneRows(fullBoard.rows);
    }
    if (fullBoard && fullBoard.columns) {
      return rowsFromLegacyColumns(fullBoard.columns, fullBoard.title || fallbackTitle || 'Board');
    }
    return [];
  }

  function setBoardHierarchyRows(boardId, fullBoard, fallbackTitle) {
    if (!boardId) return;
    boardHierarchyCache[boardId] = {
      rows: rowsForBoardData(fullBoard, fallbackTitle),
      updatedAt: Date.now(),
    };
  }

  function getBoardHierarchyRows(boardId) {
    if (boardId && boardId === activeBoardId && activeBoardData && activeBoardData.rows) {
      return activeBoardData.rows;
    }
    var cached = boardHierarchyCache[boardId];
    return cached && cached.rows ? cached.rows : null;
  }

  async function refreshBoardHierarchyCache(boardList) {
    var keep = {};
    for (var i = 0; i < boardList.length; i++) keep[boardList[i].id] = true;
    var cachedIds = Object.keys(boardHierarchyCache);
    for (var j = 0; j < cachedIds.length; j++) {
      if (!keep[cachedIds[j]]) delete boardHierarchyCache[cachedIds[j]];
    }

    var tasks = [];
    for (var k = 0; k < boardList.length; k++) {
      (function (boardMeta) {
        if (
          boardMeta.id === activeBoardId &&
          fullBoardData &&
          activeBoardData &&
          activeBoardData.rows
        ) {
          setBoardHierarchyRows(boardMeta.id, fullBoardData, boardMeta.title || 'Board');
          return;
        }
        tasks.push(
          LexeraApi.getBoardColumns(boardMeta.id).then(function (response) {
            setBoardHierarchyRows(boardMeta.id, response.fullBoard || null, response.title || boardMeta.title || 'Board');
          }).catch(function (err) {
            lexeraLog('warn', '[hierarchy.cache] Failed to load board ' + boardMeta.id + ': ' + err.message);
          })
        );
      })(boardList[k]);
    }
    if (tasks.length > 0) await Promise.all(tasks);
  }

  function cardPreviewText(content) {
    if (!content) return '';
    // Strip markdown formatting, take first line, truncate
    var text = content.replace(/^#+\s*/gm, '').replace(/\*\*|__|\*|_|~~|`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    var firstLine = text.split('\n')[0].trim();
    return firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;
  }

  function renderBoardList() {
    getElBoardList().innerHTML = '';
    var orderedBoards = getOrderedItems(boards, 'lexera-board-order', function (b) { return b.id; });
    var expandedIds = getSidebarExpandedBoards();

    if (getElBtnSidebarSync()) getElBtnSidebarSync().classList.toggle('active', sidebarSyncEnabled);

    for (var i = 0; i < orderedBoards.length; i++) {
      var board = orderedBoards[i];
      var isExpanded = expandedIds.indexOf(board.id) !== -1;
      var isActive = board.id === activeBoardId;
      var rows = getBoardHierarchyRows(board.id) || [];
      var totalCards = rows.length > 0
        ? countCardsInRows(rows)
        : board.columns.reduce(function (sum, c) { return sum + c.cardCount; }, 0);

      var wrapper = document.createElement('div');
      wrapper.className = 'board-item-wrapper';
      wrapper.setAttribute('data-board-id', board.id);

      var el = document.createElement('div');
      el.className = 'board-item' + (isActive ? ' active' : '');
      el.setAttribute('data-board-index', i.toString());
      el.setAttribute('data-board-id', board.id);
      var boardName = board.title || getDisplayNameFromPath(board.filePath || '') || 'Untitled';

      var hasContent = rows.length > 0;
      var singleRow = rows.length === 1;
      var singleStack = singleRow && (rows[0].stacks || []).length === 1;
      // Build breadcrumb title: "Board / Row / Stack" when levels are compressed
      var displayTitle = escapeHtml(boardName);
      if (singleRow) {
        var rowTitle = rows[0].title || 'Row 1';
        displayTitle += ' <span class="board-item-separator">/</span> ' + escapeHtml(rowTitle);
        if (singleStack && rows[0].stacks && rows[0].stacks[0]) {
          var stackTitle = rows[0].stacks[0].title || 'Stack 1';
          displayTitle += ' <span class="board-item-separator">/</span> ' + escapeHtml(stackTitle);
        }
      }
      var presenceCount = (boardPresenceCache[board.id] || []).length;
      var presenceBadge = presenceCount > 0
        ? '<span class="board-presence-badge" title="' + presenceCount + ' user(s) online">' + presenceCount + '</span>'
        : '<span class="board-presence-badge" style="display:none"></span>';
      el.innerHTML =
        (hasContent ? '<span class="board-item-toggle' + (isExpanded ? ' expanded' : '') + '"></span>' : '<span class="board-item-toggle-spacer"></span>') +
        '<span class="board-item-title">' + displayTitle + '</span>' +
        '<span class="board-item-count">' + totalCards + '</span>' +
        presenceBadge +
        (!hierarchyLocked ? '<span class="board-item-remove" title="Remove board">\u00D7</span>' : '') +
        '<span class="tree-grip" title="Drag to reorder">\u22EE\u22EE</span>';

      // Tree sub-list
      var tree = document.createElement('div');
      tree.className = 'board-item-tree' + (isExpanded ? ' expanded' : '');

      if (hasContent) {
        var treeState = getSidebarTreeState(board.id);
        var hasTreeState = hasSidebarTreeState(board.id);
        var treeNodes = buildSidebarTreeNodes(rows, board.id, treeState, hasTreeState, singleRow, singleStack);
        TreeView.render(tree, treeNodes, {
          escapeHtml: escapeHtml,
          onChildrenContainer: function (el, node) {
            if (node.type === 'stack') {
              el.classList.add('tree-stack-drop-zone');
              if (node.attrs) {
                if (node.attrs['data-board-id']) el.setAttribute('data-board-id', node.attrs['data-board-id']);
                if (node.attrs['data-row-index']) el.setAttribute('data-row-index', node.attrs['data-row-index']);
                if (node.attrs['data-stack-index']) el.setAttribute('data-stack-index', node.attrs['data-stack-index']);
              }
              if (!node.children || node.children.length === 0) {
                el.classList.add('tree-stack-drop-zone-empty');
              }
            }
          }
        });
      }

      wrapper.appendChild(el);
      wrapper.appendChild(tree);

      (function (boardId, boardIndex, wrapperEl, boardFilePath) {
        // Toggle expand on board arrow click (Alt+click = recursive)
        var toggle = wrapperEl.querySelector('.board-item-toggle');
        if (toggle) {
          toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            var ids = getSidebarExpandedBoards();
            var idx = ids.indexOf(boardId);
            var treeContainer = wrapperEl.querySelector('.board-item-tree');
            if (idx !== -1) {
              ids.splice(idx, 1);
              toggle.classList.remove('expanded');
              treeContainer.classList.remove('expanded');
              if (e.altKey) setDescendantTreeState(treeContainer, false, boardId);
            } else {
              ids.push(boardId);
              toggle.classList.add('expanded');
              treeContainer.classList.add('expanded');
              if (e.altKey) setDescendantTreeState(treeContainer, true, boardId);
            }
            saveSidebarExpandedBoards(ids);
          });
        }

        // Tree node toggle, click, and DnD handlers (event delegation on tree container)
        var treeEl = wrapperEl.querySelector('.board-item-tree');
        if (treeEl) {
          treeEl.addEventListener('click', function (e) {
            var target = e.target;

            // Grip click — do nothing (grip is for drag only)
            if (target.classList.contains('tree-grip')) {
              e.stopPropagation();
              return;
            }

            // Toggle arrow click (Alt+click = recursive)
            if (target.classList.contains('tree-toggle')) {
              e.stopPropagation();
              var node = target.closest('.tree-node');
              if (!node) return;
              var children = node.nextElementSibling;
              if (children && children.classList.contains('tree-children')) {
                var expanding = !children.classList.contains('expanded');
                children.classList.toggle('expanded');
                target.classList.toggle('expanded');
                // Persist fold state
                var treeId = node.getAttribute('data-tree-id');
                if (treeId) {
                  if (node.classList.contains('tree-row')) {
                    toggleSidebarTreeNode(boardId, 'rows', treeId);
                  } else if (node.classList.contains('tree-stack')) {
                    toggleSidebarTreeNode(boardId, 'stacks', treeId);
                  } else if (node.classList.contains('tree-column')) {
                    toggleSidebarTreeNode(boardId, 'columns', treeId);
                  }
                }
                // Alt+click: recursively expand/collapse all descendants
                if (e.altKey) {
                  setDescendantTreeState(children, expanding, boardId);
                }
              }
              return;
            }

            // Column label click — scroll to column in main view
            var colNode = target.closest('.tree-column');
            if (colNode && boardId === activeBoardId) {
              e.stopPropagation();
              var colIdx = colNode.getAttribute('data-col-index');
              if (colIdx != null) {
                var colEl = getElColumnsContainer().querySelector('.column-cards[data-col-index="' + colIdx + '"]');
                if (colEl) {
                  var column = colEl.closest('.column');
                  if (column) column.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
                }
              }
              return;
            }

            // Card label click — focus card in main view
            var cardNode = target.closest('.tree-card');
            if (cardNode && boardId === activeBoardId) {
              e.stopPropagation();
              var cardColIdx = cardNode.getAttribute('data-col-index');
              var cardIdx = cardNode.getAttribute('data-card-index');
              if (cardColIdx != null && cardIdx != null) {
                var cardEl = getElColumnsContainer().querySelector(
                  '.card[data-col-index="' + cardColIdx + '"][data-card-index="' + cardIdx + '"]'
                );
                if (cardEl) focusCard(cardEl);
              }
              return;
            }

            if (boardId !== activeBoardId) {
              var anyNode = target.closest('.tree-node');
              if (anyNode) {
                e.stopPropagation();
                selectBoard(boardId);
                return;
              }
            }
          });

          // Tree DnD is handled by the pointer-based drag system (mousedown on getElBoardList())
        }

        var boardRow = wrapperEl.querySelector('.board-item');
        boardRow.addEventListener('click', async function (e) {
          // Remove button click — handle inline via delegation
          if (targetClosest(e.target, '.board-item-remove')) {
            e.preventDefault();
            e.stopPropagation();
            var boardName = boardRow.querySelector('.board-item-title').textContent;
            if (!(await showConfirmDialog('Remove "' + boardName + '" from sidebar?\n(The file will not be deleted.)'))) return;
            // Optimistic UI update — remove immediately
            boards = boards.filter(function (b) { return b.id !== boardId; });
            delete boardHierarchyCache[boardId];
            if (activeBoardId === boardId) {
              activeBoardId = null;
              activeBoardData = null;
              fullBoardData = null;
              localStorage.removeItem('lexera-last-board');
            }
            renderBoardList();
            renderMainView();
            scheduleDashboardRefresh(60);
            // Then tell backend
            LexeraApi.removeBoard(boardId).catch(function (err) {
              lexeraLog('error', '[sidebar.remove] Backend error: ' + err.message);
              showNotification('Failed to remove board');
              // Re-fetch to restore correct state
              poll();
            });
            return;
          }
          exitSearchMode();
          selectBoard(boardId);
        });

        boardRow.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          e.stopPropagation();
          showNativeMenu([
            { id: 'split-left', label: 'Open in Split Left' },
            { id: 'split-right', label: 'Open in Split Right' },
            { separator: true },
            { id: 'share', label: 'Share & Members' },
            { id: 'settings', label: 'Settings' },
            { separator: true },
            { id: 'reveal', label: 'Reveal in Finder' },
          ], e.clientX, e.clientY).then(async function (action) {
            if (action === 'split-left') {
              openBoardInPane(boardId, 'a');
            } else if (action === 'split-right') {
              openBoardInPane(boardId, 'b');
            } else if (action === 'share') {
              openManagementPanel({ section: 'boards', boardId: boardId, tab: 'sharing' });
            } else if (action === 'settings') {
              openManagementPanel({ section: 'boards', boardId: boardId, tab: 'settings' });
            } else if (action === 'reveal' && boardFilePath) {
              showInFinder(boardFilePath);
            }
          });
        });
        // Board DnD is handled by the pointer-based drag system (mousedown on getElBoardList())
      })(board.id, i, wrapper, board.filePath);

      getElBoardList().appendChild(wrapper);
    }

    // Remote boards section
    if (remoteBoards.length > 0) {
      var remoteDivider = document.createElement('div');
      remoteDivider.className = 'sidebar-section-divider';
      remoteDivider.innerHTML = '<span class="sidebar-section-label">Remote</span>';
      getElBoardList().appendChild(remoteDivider);

      for (var ri = 0; ri < remoteBoards.length; ri++) {
        var rb = remoteBoards[ri];
        var rbEl = document.createElement('div');
        rbEl.className = 'board-item remote-board' + (rb.id === activeBoardId ? ' active' : '');
        rbEl.setAttribute('data-board-id', rb.id);
        rbEl.innerHTML =
          '<span class="board-item-remote-icon" title="Remote board">&#127760;</span>' +
          '<span class="board-item-title">' + escapeHtml(rb.title || rb.id) + '</span>' +
          '<span class="board-item-count">' + (rb.card_count || 0) + '</span>';
        (function (boardId) {
          rbEl.addEventListener('click', function () {
            exitSearchMode();
            selectBoard(boardId);
          });
        })(rb.id);
        getElBoardList().appendChild(rbEl);
      }
    }
  }

  // --- Sidebar Sync ---

  function syncSidebarToView() {
    if (!sidebarSyncEnabled) return;

    // Priority 1: focused card
    if (focusedCardEl && focusedCardEl.isConnected) {
      var colIdx = focusedCardEl.getAttribute('data-col-index');
      var cardIdx = focusedCardEl.getAttribute('data-card-index');
      highlightSidebarNode('.tree-card[data-col-index="' + colIdx + '"][data-card-index="' + cardIdx + '"]');
      return;
    }

    // Priority 2: first visible column in viewport
    var columns = getElColumnsContainer().querySelectorAll('.column');
    var containerRect = getElColumnsContainer().getBoundingClientRect();
    for (var i = 0; i < columns.length; i++) {
      var rect = columns[i].getBoundingClientRect();
      if (rect.left >= containerRect.left && rect.right > containerRect.left) {
        var colCards = columns[i].querySelector('.column-cards');
        if (colCards) {
          var colIdx = colCards.getAttribute('data-col-index');
          if (colIdx != null) {
            highlightSidebarNode('.tree-column[data-col-index="' + colIdx + '"]');
            return;
          }
        }
      }
    }
  }

  function highlightSidebarNode(selector) {
    // Remove previous highlight
    var prev = getElBoardList().querySelector('.sync-highlight');
    if (prev) prev.classList.remove('sync-highlight');

    var node = getElBoardList().querySelector(selector);
    if (!node) return;

    // Expand all parent .tree-children containers
    var parent = node.parentElement;
    while (parent && parent !== getElBoardList()) {
      if (parent.classList.contains('tree-children') && !parent.classList.contains('expanded')) {
        parent.classList.add('expanded');
        var toggleNode = parent.previousElementSibling;
        if (toggleNode) {
          var toggle = toggleNode.querySelector('.tree-toggle');
          if (toggle) toggle.classList.add('expanded');
        }
      }
      if (parent.classList.contains('board-item-tree') && !parent.classList.contains('expanded')) {
        parent.classList.add('expanded');
        var boardItem = parent.previousElementSibling;
        if (boardItem) {
          var toggle = boardItem.querySelector('.board-item-toggle');
          if (toggle) toggle.classList.add('expanded');
        }
      }
      parent = parent.parentElement;
    }

    // Highlight and scroll
    node.classList.add('sync-highlight');
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Sidebar sync button handler
  (function () {
    if (getElBtnSidebarSync()) {
      getElBtnSidebarSync().addEventListener('click', function (e) {
        e.stopPropagation();
        sidebarSyncEnabled = !sidebarSyncEnabled;
        localStorage.setItem('lexera-sidebar-sync', sidebarSyncEnabled ? 'true' : 'false');
        getElBtnSidebarSync().classList.toggle('active', sidebarSyncEnabled);
        if (sidebarSyncEnabled) syncSidebarToView();
        else {
          var prev = getElBoardList().querySelector('.sync-highlight');
          if (prev) prev.classList.remove('sync-highlight');
        }
      });
    }
  })();

  // Lock button: controls add/remove board capability
  function updateLockButton(btn) {
    if (!btn) return;
    btn.innerHTML = hierarchyLocked ? '&#128274;' : '&#128275;';
    btn.title = hierarchyLocked ? 'Unlock hierarchy (allow add/remove)' : 'Lock hierarchy (prevent add/remove)';
    btn.classList.toggle('active', !hierarchyLocked);
  }

  (function () {
    updateLockButton(getElSidebarLockBtn());
    if (getElSidebarLockBtn()) {
      getElSidebarLockBtn().addEventListener('click', function (e) {
        e.stopPropagation();
        hierarchyLocked = !hierarchyLocked;
        localStorage.setItem('lexera-hierarchy-locked', hierarchyLocked ? 'true' : 'false');
        updateLockButton(getElSidebarLockBtn());
        renderBoardList();
      });
    }
  })();

  // Debounced scroll sync
  var scrollSyncTimer = null;
  getElColumnsContainer().addEventListener('scroll', function () {
    if (!sidebarSyncEnabled) return;
    clearTimeout(scrollSyncTimer);
    scrollSyncTimer = setTimeout(syncSidebarToView, 300);
  });

  async function selectBoard(boardId, options) {
    options = options || {};
    if (!boardId) return;
    if (!embeddedMode && splitViewMode !== 'single' && options.routeToPane !== false) {
      var targetPane = normalizeSplitPane(options.pane || activeSplitPane);
      setActiveSplitPane(targetPane);
      splitPaneBoards[targetPane] = boardId;
      activeBoardId = boardId;
      activeBoardData = null;
      fullBoardData = null;
      pendingExternalRebaseConflict = null;
      _lastLoadedGeneration = null;
      _lastLoadedRevision = null;
      addCardColumn = null;
      localStorage.setItem('lexera-last-board', boardId);
      renderBoardList();
      refreshHeaderFileControls();
      refreshSplitFrames(false);
      scheduleDashboardRefresh(60);
      if (options.loadInBackground) await loadBoard(boardId);
      return;
    }

    activeBoardId = boardId;
    activeBoardData = null;
    fullBoardData = null;
    pendingExternalRebaseConflict = null;
    _lastLoadedGeneration = null;
    _lastLoadedRevision = null;
    addCardColumn = null;
    if (!embeddedMode) {
      localStorage.setItem('lexera-last-board', boardId);
    } else {
      embeddedPreferredBoardId = boardId;
      if (window.parent && window.parent !== window) {
        try {
          window.parent.postMessage({
            type: 'lexera-pane-board-change',
            pane: embeddedPaneId || '',
            boardId: boardId
          }, '*');
        } catch (e) {
          // ignore cross-frame messaging issues
        }
      }
      notifyParentPaneActivated();
    }
    renderBoardList();
    refreshHeaderFileControls();
    scheduleDashboardRefresh(60);
    if (!options.skipLoad) await loadBoard(boardId);
  }

  async function loadBoard(boardId) {
    var seq = ++boardLoadSeq;
    var loadStage = 'start';
    try {
      loadStage = 'clear-caches';
      clearBoardPreviewCaches(boardId);
      editingPresenceMap = {};
      var cachedRevision = (boardId === activeBoardId && (_lastLoadedRevision || (activeBoardData && activeBoardData.revision)))
        ? (_lastLoadedRevision || activeBoardData.revision)
        : null;
      loadStage = cachedRevision != null ? 'fetch-cached' : 'fetch';
      var response = cachedRevision != null
        ? await LexeraApi.getBoardColumnsCached(boardId, cachedRevision)
        : await LexeraApi.getBoardColumns(boardId);
      if (seq !== boardLoadSeq) return; // stale response, a newer load was started
      if (response && response.notModified) {
        loadStage = 'connect-sync-not-modified';
        connectSyncForBoard(boardId);
        return;
      }
      loadStage = 'prepare-board-meta';
      var boardMeta = findBoardMeta(boardId);
      if (boardMeta && boardMeta.filePath) {
        response.filePath = boardMeta.filePath;
      }
      loadStage = 'assign-board-data';
      fullBoardData = response.fullBoard || null;
      if (fullBoardData) setBoardSaveBase(fullBoardData, fullBoardData);
      if (fullBoardData) {
        traceFrontendAction('info', 'board.load.identity', 'Loaded board from backend', {
          boardId: boardId,
          identity: summarizeBoardIdentity(fullBoardData)
        });
      }
      activeBoardData = response;
      pendingExternalRebaseConflict = null;
      var draftSnapshot = loadLocalBoardDraft(boardId);
      var shouldPrepareLiveSync = true;
      if (response && typeof response.generation === 'number') {
        _lastLoadedGeneration = response.generation;
      }
      _lastLoadedRevision = response && response.revision ? response.revision : null;
      // Auto-convert legacy boards and save immediately
      if (fullBoardData && (!fullBoardData.rows || fullBoardData.rows.length === 0)) {
        loadStage = 'migrate-legacy-board';
        migrateLegacyBoard();
        try {
          loadStage = 'save-migrated-board';
          await saveFullBoard();
        } catch (err) {
          logFrontendIssue('warn', 'board.load.migrate', 'Failed to persist migrated board ' + boardId, err);
        }
        if (seq !== boardLoadSeq) return; // check again after second await
      }
      if (draftSnapshot && draftSnapshot.board) {
        var currentSerialized = JSON.stringify(cloneBoardData(fullBoardData));
        var draftSerialized = JSON.stringify(draftSnapshot.board);
        if (currentSerialized !== draftSerialized) {
          var currentBoard = response.fullBoard || null;
          var draftBaseBoard = draftSnapshot.baseBoard || null;
          var sameRevision = !!(draftSnapshot.revision && response.revision && draftSnapshot.revision === response.revision);
          var draftIdentity = getBoardCardIdentityStats(currentBoard, draftSnapshot.board);
          var draftMatchesCurrentIds = !hasBoardIdentityMismatch(currentBoard, draftSnapshot.board);
          var draftHasBase = !!draftBaseBoard;
          var canRestoreDirectly = sameRevision && draftMatchesCurrentIds;
          var canRestoreViaRebase = draftHasBase && !sameRevision;
          if (!canRestoreDirectly && !canRestoreViaRebase) {
            loadStage = 'restore-local-draft-blocked';
            shouldPrepareLiveSync = true;
            var discardUnrecoverableDraft = sameRevision && !draftHasBase && draftIdentity.overlap === 0;
            if (discardUnrecoverableDraft) {
              clearLocalBoardDraft(boardId);
              traceFrontendAction('info', 'board.draft.discard', 'Discarded incompatible stale local draft during board load', {
                boardId: boardId,
                currentRevision: response.revision || null,
                draftRevision: draftSnapshot.revision || null,
                hasBaseBoard: draftHasBase,
                identity: draftIdentity
              });
            } else {
              traceFrontendAction('warn', 'board.draft.restore', 'Skipped unsafe local draft restore because card identities no longer match current board', {
                boardId: boardId,
                currentRevision: response.revision || null,
                draftRevision: draftSnapshot.revision || null,
                hasBaseBoard: draftHasBase,
                discarded: false,
                identity: draftIdentity
              });
              showNotification('A local draft was preserved but not restored because it no longer matches the current board revision safely.');
            }
          } else {
            loadStage = 'restore-local-draft';
            var restoreMessage = canRestoreDirectly
              ? 'Restore the unsaved local draft for this board?\n\nIt was saved automatically on this device.'
              : (canRestoreViaRebase
                ? 'Restore the unsaved local draft for this board?\n\nExternal changes will be rebased against its saved base first.'
                : 'Restore the unsaved local draft for this board?\n\nIt was saved automatically on this device.');
            var restoreDraft = await showConfirmDialog(restoreMessage);
          }
          if (typeof restoreDraft !== 'undefined') {
            if (restoreDraft) {
              if (canRestoreViaRebase) {
                loadStage = 'restore-local-draft-rebase';
                try {
                  var rebasedDraft = await LexeraApi.rebaseBoardWithBase(boardId, draftBaseBoard, draftSnapshot.board);
                  if (rebasedDraft && rebasedDraft.currentBoard && !rebasedDraft.hasConflicts) {
                    fullBoardData = rebasedDraft.board || draftSnapshot.board;
                    ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
                    if (!fullBoardData.columns) fullBoardData.columns = [];
                    setBoardSaveBase(fullBoardData, rebasedDraft.currentBoard || response.fullBoard || fullBoardData);
                    markBoardDirty();
                  } else if (rebasedDraft && rebasedDraft.hasConflicts) {
                    shouldPrepareLiveSync = false;
                    pendingExternalRebaseConflict = {
                      result: rebasedDraft,
                      savedAt: Date.now()
                    };
                    traceFrontendAction('warn', 'board.draft.restore', 'Draft restore blocked by rebase conflicts', {
                      boardId: boardId,
                      currentRevision: response.revision || null,
                      draftRevision: draftSnapshot.revision || null,
                      conflicts: rebasedDraft.conflicts || 0
                    });
                    showNotification('The local draft was preserved, but it conflicts with the current board and was not restored automatically.');
                  }
                } catch (restoreErr) {
                  shouldPrepareLiveSync = false;
                  logFrontendIssue('warn', 'board.draft.restore', 'Failed to rebase local draft before restore', restoreErr);
                  showNotification('The local draft was preserved, but automatic restore failed.');
                }
              } else {
                fullBoardData = draftSnapshot.board;
                ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
                if (!fullBoardData.columns) fullBoardData.columns = [];
                setBoardSaveBase(fullBoardData, draftBaseBoard || response.fullBoard || fullBoardData);
                markBoardDirty();
              }
            } else {
              clearLocalBoardDraft(boardId);
            }
          }
        } else {
          clearLocalBoardDraft(boardId);
        }
      }
      if (fullBoardData) {
        try {
          loadStage = 'prepare-live-sync';
          await closeLiveSyncSession(boardId);
          if (shouldPrepareLiveSync) {
            await ensureLiveSyncSession(boardId);
            if (liveSyncState && liveSyncState.boardId === boardId && fullBoardData) {
              traceBoardIdentityPair('info', 'board.load.identity', 'Identity comparison after board load session prepare', boardId, 'local', fullBoardData, 'session', liveSyncState.board);
            }
          } else {
            liveSyncState = null;
          }
        } catch (e) {
          logFrontendIssue('warn', 'board.load.live-sync', 'Failed to prepare live sync session for board ' + boardId, e);
        }
      }
      loadStage = 'update-display';
      updateDisplayFromFullBoard(); // populate activeBoardData.rows before sidebar render
      loadStage = 'set-board-hierarchy';
      setBoardHierarchyRows(boardId, fullBoardData, response.title || '');
      loadStage = 'render-board-list';
      renderBoardList();
      loadStage = 'render-main-view';
      renderMainView();
      loadStage = 'schedule-dashboard-refresh';
      scheduleDashboardRefresh(80);
      // Connect WS sync for this board (no-op if already connected)
      loadStage = 'connect-sync';
      connectSyncForBoard(boardId);
    } catch (err) {
      if (seq !== boardLoadSeq) return; // stale error, ignore
      logFrontendIssue('error', 'board.load', 'Failed to load board ' + boardId + ' during ' + loadStage, err);
      try {
        await closeLiveSyncSession(boardId);
      } catch (closeErr) {
        logFrontendIssue('warn', 'board.load.live-sync', 'Failed to close live sync session after load failure for board ' + boardId, closeErr);
      }
      activeBoardData = null;
      fullBoardData = null;
      _lastLoadedGeneration = null;
      _lastLoadedRevision = null;
      renderMainView();
      scheduleDashboardRefresh(80);
    }
  }

  /**
   * Migrate legacy flat-column board to rows→stacks→columns format.
   * Called once on load; on next save the new format is persisted.
   */
  function migrateLegacyBoard() {
    if (!fullBoardData) return;
    if (fullBoardData.rows && fullBoardData.rows.length > 0) return; // already new format
    var cols = fullBoardData.columns || [];
    if (cols.length === 0) {
      fullBoardData.rows = [];
      return;
    }
    // Group consecutive columns by #stack tag
    var groups = [];
    for (var i = 0; i < cols.length; i++) {
      var hasTag = /(?:^|\s)#stack(?:\s|$)/.test(cols[i].title);
      if (hasTag && groups.length > 0) {
        groups[groups.length - 1].push(cols[i]);
      } else {
        groups.push([cols[i]]);
      }
    }
    var stacks = [];
    for (var g = 0; g < groups.length; g++) {
      for (var c = 0; c < groups[g].length; c++) {
        groups[g][c].title = stripStackTag(groups[g][c].title);
      }
      stacks.push({
        id: 'stack-' + Date.now() + '-' + g,
        title: groups[g][0].title,
        columns: groups[g]
      });
    }
    fullBoardData.rows = [{
      id: 'row-' + Date.now(),
      title: fullBoardData.title || 'Board',
      stacks: stacks
    }];
    fullBoardData.columns = [];
  }

  /**
   * Get a flat list of all columns from fullBoardData (rows→stacks→columns).
   */
  function getAllColumnsFromBoardData(boardData) {
    var cols = [];
    if (!boardData || !boardData.rows) return cols;
    for (var r = 0; r < boardData.rows.length; r++) {
      var row = boardData.rows[r];
      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        for (var c = 0; c < stack.columns.length; c++) {
          cols.push(stack.columns[c]);
        }
      }
    }
    return cols;
  }

  /**
   * Get a flat list of all columns from fullBoardData (rows→stacks→columns).
   */
  function getAllFullColumns() {
    return getAllColumnsFromBoardData(fullBoardData);
  }

  /**
   * Get the column at flat index from fullBoardData (either format).
   */
  function getFullColumn(flatIndex) {
    var cols = getAllColumnsFromBoardData(fullBoardData);
    return (flatIndex >= 0 && flatIndex < cols.length) ? cols[flatIndex] : null;
  }

  function updateDisplayFromFullBoard() {
    if (!fullBoardData || !activeBoardData) return;

    var allCols = getAllFullColumns();
    var visibleColumns = [];
    var visibleRows = (fullBoardData.rows || [])
      .filter(function (row) {
        return !is_archived_or_deleted(row && row.title ? row.title : '');
      })
      .map(function (row) {
        var stacks = (row.stacks || [])
          .filter(function (stack) {
            return !is_archived_or_deleted(stack && stack.title ? stack.title : '');
          })
          .map(function (stack) {
            var cols = (stack.columns || [])
              .filter(function (col) { return !is_archived_or_deleted(col && col.title ? col.title : ''); })
              .map(function (col) {
                var cards = (col.cards || []).filter(function (c) {
                  return !is_archived_or_deleted(c && c.content ? c.content : '');
                });
                var flatIdx = allCols.indexOf(col);
                var visibleCol = { index: flatIdx, title: col.title, cards: cards };
                visibleColumns.push(visibleCol);
                return visibleCol;
              });
            return { id: stack.id, title: stack.title, columns: cols };
          });
        return { id: row.id, title: row.title, stacks: stacks };
      });

    activeBoardData.columns = visibleColumns;
    activeBoardData.rows = visibleRows;
  }

  function is_archived_or_deleted(text) {
    text = text || '';
    if (text.indexOf('#hidden-internal-deleted') !== -1 ||
        text.indexOf('#hidden-internal-archived') !== -1 ||
        text.indexOf('#hidden-internal-parked') !== -1) return true;
    // Plain #hidden tag also hides from display (but not #hidden-internal-*)
    if (/(^|\s)#hidden(\s|$)/.test(text)) return true;
    return false;
  }

  function hasInternalHiddenTag(text, tag) {
    return !!(text && tag && text.indexOf(tag) !== -1);
  }

  function stripInternalHiddenTags(text) {
    return (text || '')
      .replace(/\s*#hidden-internal-(?:parked|archived|deleted)\b/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  function applyInternalHiddenTag(text, tag) {
    var cleaned = stripInternalHiddenTags(text);
    if (!tag) return cleaned;
    if (!cleaned || !cleaned.trim()) return tag;
    var lines = cleaned.split('\n');
    var firstLine = lines[0] ? lines[0].trim() : '';
    lines[0] = firstLine ? (firstLine + ' ' + tag) : tag;
    return lines.join('\n');
  }

  function getColumnByLocation(rowIndex, stackIndex, colIndex) {
    if (!fullBoardData || !fullBoardData.rows) return null;
    var row = fullBoardData.rows[rowIndex];
    if (!row || !row.stacks) return null;
    var stack = row.stacks[stackIndex];
    if (!stack || !stack.columns) return null;
    return stack.columns[colIndex] || null;
  }

  function getRowByLocation(rowIndex) {
    if (!fullBoardData || !fullBoardData.rows) return null;
    return fullBoardData.rows[rowIndex] || null;
  }

  function getStackByLocation(rowIndex, stackIndex) {
    var row = getRowByLocation(rowIndex);
    if (!row || !row.stacks) return null;
    return row.stacks[stackIndex] || null;
  }

  function getCardByLocation(rowIndex, stackIndex, colIndex, cardIndex) {
    var col = getColumnByLocation(rowIndex, stackIndex, colIndex);
    if (!col || !col.cards) return null;
    return col.cards[cardIndex] || null;
  }

  function collectHiddenItems(tag) {
    if (!fullBoardData || !fullBoardData.rows) return [];
    var items = [];
    for (var r = 0; r < fullBoardData.rows.length; r++) {
      var row = fullBoardData.rows[r];
      var rowTitle = row.title || ('Row ' + (r + 1));
      var cleanRowTitle = stripInternalHiddenTags(rowTitle) || ('Row ' + (r + 1));
      if (hasInternalHiddenTag(rowTitle, tag)) {
        items.push({
          kind: 'row',
          rowIndex: r,
          rowTitle: cleanRowTitle,
          title: cleanRowTitle
        });
        continue;
      }
      if (!row.stacks) continue;
      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        var stackTitle = stack.title || ('Stack ' + (s + 1));
        var cleanStackTitle = stripInternalHiddenTags(stackTitle) || ('Stack ' + (s + 1));
        if (hasInternalHiddenTag(stackTitle, tag)) {
          items.push({
            kind: 'stack',
            rowIndex: r,
            stackIndex: s,
            rowTitle: cleanRowTitle,
            stackTitle: cleanStackTitle,
            title: cleanStackTitle
          });
          continue;
        }
        if (!stack.columns) continue;
        for (var c = 0; c < stack.columns.length; c++) {
          var col = stack.columns[c];
          var cleanColTitle = stripLayoutTags(stripInternalHiddenTags(col.title || '')) || ('Column ' + (c + 1));
          var columnMatches = hasInternalHiddenTag(col.title || '', tag);
          if (columnMatches) {
            items.push({
              kind: 'column',
              rowIndex: r,
              stackIndex: s,
              colIndex: c,
              rowTitle: cleanRowTitle,
              stackTitle: cleanStackTitle,
              colTitle: cleanColTitle,
              title: cleanColTitle
            });
            continue;
          }
          if (!col.cards) continue;
          for (var i = 0; i < col.cards.length; i++) {
            var card = col.cards[i];
            var content = card && card.content ? card.content : '';
            if (!hasInternalHiddenTag(content, tag)) continue;
            items.push({
              kind: 'card',
              rowIndex: r,
              stackIndex: s,
              colIndex: c,
              cardIndex: i,
              rowTitle: cleanRowTitle,
              stackTitle: cleanStackTitle,
              colTitle: cleanColTitle,
              title: getCardTitle(stripInternalHiddenTags(content)) || '(untitled card)'
            });
          }
        }
      }
    }
    return items;
  }

  function getHiddenItemCount(tag) {
    return collectHiddenItems(tag).length;
  }

  function buildHiddenItemLocation(item) {
    var parts = [];
    if (item.kind !== 'row' && item.rowTitle) parts.push(item.rowTitle);
    if (item.kind !== 'stack' && item.kind !== 'row' && item.stackTitle) parts.push(item.stackTitle);
    if (item.kind === 'card' && item.colTitle) parts.push(item.colTitle);
    return parts.join(' / ');
  }

  async function updateHiddenItemTag(item, tag) {
    if (!item || !fullBoardData || !activeBoardId) return false;
    if (item.kind === 'row') {
      var row = getRowByLocation(item.rowIndex);
      if (!row) return false;
      var nextRowTitle = applyInternalHiddenTag(row.title || '', tag);
      if (nextRowTitle === row.title) return false;
      pushUndo();
      row.title = nextRowTitle;
    } else if (item.kind === 'stack') {
      var stack = getStackByLocation(item.rowIndex, item.stackIndex);
      if (!stack) return false;
      var nextStackTitle = applyInternalHiddenTag(stack.title || '', tag);
      if (nextStackTitle === stack.title) return false;
      pushUndo();
      stack.title = nextStackTitle;
    } else if (item.kind === 'column') {
      var col = getColumnByLocation(item.rowIndex, item.stackIndex, item.colIndex);
      if (!col) return false;
      var nextTitle = applyInternalHiddenTag(col.title || '', tag);
      if (nextTitle === col.title) return false;
      pushUndo();
      col.title = nextTitle;
    } else {
      var card = getCardByLocation(item.rowIndex, item.stackIndex, item.colIndex, item.cardIndex);
      if (!card) return false;
      var nextContent = applyInternalHiddenTag(card.content || '', tag);
      if (nextContent === card.content) return false;
      pushUndo();
      card.content = nextContent;
    }
    return persistBoardMutation({
      refreshMainView: true,
      refreshSidebar: true
    });
  }

  async function permanentlyDeleteHiddenItem(item) {
    if (!item || !fullBoardData || !activeBoardId) return false;
    traceFrontendAction('info', 'trash.delete', 'Permanently deleting hidden item', {
      boardId: activeBoardId || null,
      kind: item.kind,
      rowIndex: item.rowIndex,
      stackIndex: item.stackIndex,
      colIndex: item.colIndex,
      cardIndex: item.cardIndex,
      title: item.title || ''
    });
    pushUndo();
    if (item.kind === 'row') {
      if (item.rowIndex < 0 || item.rowIndex >= fullBoardData.rows.length) return false;
      fullBoardData.rows.splice(item.rowIndex, 1);
    } else if (item.kind === 'stack') {
      var row = getRowByLocation(item.rowIndex);
      if (!row || !row.stacks || item.stackIndex < 0 || item.stackIndex >= row.stacks.length) return false;
      row.stacks.splice(item.stackIndex, 1);
      removeEmptyStacksAndRows();
    } else if (item.kind === 'column') {
      var stack = fullBoardData.rows[item.rowIndex] && fullBoardData.rows[item.rowIndex].stacks
        ? fullBoardData.rows[item.rowIndex].stacks[item.stackIndex]
        : null;
      if (!stack || !stack.columns || item.colIndex < 0 || item.colIndex >= stack.columns.length) return false;
      stack.columns.splice(item.colIndex, 1);
      removeEmptyStacksAndRows();
    } else {
      var col = getColumnByLocation(item.rowIndex, item.stackIndex, item.colIndex);
      if (!col || !col.cards || item.cardIndex < 0 || item.cardIndex >= col.cards.length) return false;
      col.cards.splice(item.cardIndex, 1);
    }
    return persistBoardMutation({
      refreshMainView: true,
      refreshSidebar: true
    });
  }

  async function permanentlyDeleteHiddenItems(items) {
    if (!items || items.length === 0 || !fullBoardData || !activeBoardId) return false;
    traceFrontendAction('info', 'trash.empty', 'Permanently deleting all trash items', {
      boardId: activeBoardId || null,
      itemCount: items.length
    });
    var sorted = items.slice().sort(function (a, b) {
      if (a.rowIndex !== b.rowIndex) return b.rowIndex - a.rowIndex;
      if (a.stackIndex !== b.stackIndex) return b.stackIndex - a.stackIndex;
      if (a.colIndex !== b.colIndex) return b.colIndex - a.colIndex;
      if (a.kind !== b.kind) return a.kind === 'card' ? 1 : -1;
      var aCardIndex = typeof a.cardIndex === 'number' ? a.cardIndex : -1;
      var bCardIndex = typeof b.cardIndex === 'number' ? b.cardIndex : -1;
      return bCardIndex - aCardIndex;
    });

    pushUndo();
    for (var i = 0; i < sorted.length; i++) {
      var item = sorted[i];
      if (item.kind === 'row') {
        if (item.rowIndex >= 0 && item.rowIndex < fullBoardData.rows.length) {
          fullBoardData.rows.splice(item.rowIndex, 1);
        }
      } else if (item.kind === 'stack') {
        var row = getRowByLocation(item.rowIndex);
        if (row && row.stacks && item.stackIndex >= 0 && item.stackIndex < row.stacks.length) {
          row.stacks.splice(item.stackIndex, 1);
        }
      } else if (item.kind === 'column') {
        var stack = fullBoardData.rows[item.rowIndex] && fullBoardData.rows[item.rowIndex].stacks
          ? fullBoardData.rows[item.rowIndex].stacks[item.stackIndex]
          : null;
        if (stack && stack.columns && item.colIndex >= 0 && item.colIndex < stack.columns.length) {
          stack.columns.splice(item.colIndex, 1);
        }
      } else {
        var col = getColumnByLocation(item.rowIndex, item.stackIndex, item.colIndex);
        if (col && col.cards && item.cardIndex >= 0 && item.cardIndex < col.cards.length) {
          col.cards.splice(item.cardIndex, 1);
        }
      }
    }
    removeEmptyStacksAndRows();
    return persistBoardMutation({
      refreshMainView: true,
      refreshSidebar: true
    });
  }

  // ── Hidden Items Dropdown Panel ──────────────────────────────────────
  var activeHiddenDropdown = null;

  function closeHiddenItemsDropdown() {
    if (activeHiddenDropdown) {
      if (activeHiddenDropdown.el && activeHiddenDropdown.el.parentNode) activeHiddenDropdown.el.remove();
      if (activeHiddenDropdown.closeListener) document.removeEventListener('mousedown', activeHiddenDropdown.closeListener, true);
      if (activeHiddenDropdown.keyListener) document.removeEventListener('keydown', activeHiddenDropdown.keyListener, true);
      activeHiddenDropdown = null;
    }
  }

  function showHiddenItemsDropdown(btnElement, tag, title, emptyMessage, actions, footerActions) {
    closeHiddenItemsDropdown();
    var items = collectHiddenItems(tag);
    if (!items || items.length === 0) {
      showNotification(emptyMessage);
      return;
    }

    var panel = document.createElement('div');
    panel.className = 'hidden-items-dropdown';

    // Build HTML
    var html = '<div class="hidden-items-dropdown-header">' + escapeHtml(title) + ' (' + items.length + ')</div>';
    html += '<div class="hidden-items-dropdown-list">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var kindLabel = item.kind === 'row' ? 'Row' : item.kind === 'stack' ? 'Stack' : item.kind === 'column' ? 'Column' : 'Card';
      html += '<div class="hidden-items-dropdown-item" data-idx="' + i + '">';
      html += '<span class="drag-grip">\u22EE\u22EE</span>';
      html += '<span class="hidden-item-kind">' + kindLabel + '</span>';
      html += '<span class="hidden-item-title">' + escapeHtml(item.title) + '</span>';
      html += '<span class="hidden-item-loc">' + escapeHtml(buildHiddenItemLocation(item)) + '</span>';
      for (var a = 0; a < actions.length; a++) {
        html += '<button class="board-action-btn' + (actions[a].danger ? ' danger' : '') + '" data-item-action="' +
          escapeAttr(actions[a].id) + '" data-item-index="' + i + '">' + escapeHtml(actions[a].label) + '</button>';
      }
      html += '</div>';
    }
    html += '</div>';
    if (footerActions && footerActions.length > 0) {
      html += '<div class="hidden-items-dropdown-footer">';
      for (var f = 0; f < footerActions.length; f++) {
        html += '<button class="board-action-btn' + (footerActions[f].danger ? ' danger' : '') + '" data-footer-action="' +
          escapeAttr(footerActions[f].id) + '">' + escapeHtml(footerActions[f].label) + '</button>';
      }
      html += '</div>';
    }
    panel.innerHTML = html;

    // Position below button, right-aligned
    document.body.appendChild(panel);
    var btnRect = btnElement.getBoundingClientRect();
    var panelRect = panel.getBoundingClientRect();
    var left = btnRect.right - panelRect.width;
    var top = btnRect.bottom + 4;
    if (left < 4) left = 4;
    if (top + panelRect.height > window.innerHeight - 4) top = Math.max(4, window.innerHeight - panelRect.height - 4);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';

    // Action button clicks
    panel.addEventListener('click', async function (e) {
      var itemBtn = e.target.closest('[data-item-action]');
      if (itemBtn) {
        var idx = parseInt(itemBtn.getAttribute('data-item-index'), 10);
        var actionId = itemBtn.getAttribute('data-item-action');
        var selectedItem = items[idx];
        if (!selectedItem) return;
        for (var a = 0; a < actions.length; a++) {
          if (actions[a].id === actionId && typeof actions[a].handler === 'function') {
            try {
              var shouldClose = await actions[a].handler(selectedItem, { closeDialog: closeHiddenItemsDropdown });
              if (shouldClose !== false) closeHiddenItemsDropdown();
            } catch (err) {
              logFrontendIssue('error', 'hidden.dropdown', 'Action failed', err);
              showNotification('Action failed');
            }
            return;
          }
        }
      }
      var footerBtn = e.target.closest('[data-footer-action]');
      if (footerBtn && footerActions) {
        var footerId = footerBtn.getAttribute('data-footer-action');
        for (var f = 0; f < footerActions.length; f++) {
          if (footerActions[f].id === footerId && typeof footerActions[f].handler === 'function') {
            try {
              var shouldClose = await footerActions[f].handler(items, { closeDialog: closeHiddenItemsDropdown });
              if (shouldClose !== false) closeHiddenItemsDropdown();
            } catch (err) {
              logFrontendIssue('error', 'hidden.dropdown', 'Footer action failed', err);
              showNotification('Action failed');
            }
            return;
          }
        }
      }
    });

    // Drag-out support on grip handles — type-aware drop zones
    var grips = panel.querySelectorAll('.drag-grip');
    for (var g = 0; g < grips.length; g++) {
      (function (grip) {
        grip.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var itemEl = grip.closest('.hidden-items-dropdown-item');
          if (!itemEl) return;
          var idx = parseInt(itemEl.getAttribute('data-idx'), 10);
          var dragItem = items[idx];
          if (!dragItem) return;
          var startX = e.clientX, startY = e.clientY;
          var ghost = null;
          var dragging = false;
          // Map item kind to ptrDrag type for drop zone indicators
          var ptrType = dragItem.kind === 'row' ? 'tree-row'
            : dragItem.kind === 'stack' ? 'tree-stack'
            : dragItem.kind === 'column' ? 'column'
            : null; // cards use their own system

          function onMove(ev) {
            var dx = ev.clientX - startX, dy = ev.clientY - startY;
            if (!dragging && (dx * dx + dy * dy) < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
            if (!dragging) {
              dragging = true;
              ghost = document.createElement('div');
              ghost.className = 'hidden-items-drag-ghost';
              ghost.textContent = (dragItem.kind !== 'card' ? dragItem.kind.charAt(0).toUpperCase() + dragItem.kind.slice(1) + ': ' : '') + dragItem.title;
              document.body.appendChild(ghost);
              itemEl.style.opacity = '0.3';
              // Insert type-specific drop zone indicators for non-card items
              if (ptrType) insertDropZoneIndicators(ptrType);
            }
            ghost.style.left = (ev.clientX + 10) + 'px';
            ghost.style.top = (ev.clientY - 10) + 'px';
            // Show type-appropriate drop highlights
            if (dragItem.kind === 'card') {
              clearCardDropIndicators();
              clearCardDragOverHighlights();
              clearHeaderDropTargetHighlights();
              var target = resolveCardDropTarget(ev.clientX, ev.clientY);
              if (target && target.kind !== 'header-park' && target.kind !== 'header-archive' && target.kind !== 'header-trash') {
                if (target.container) {
                  target.container.classList.add('card-drag-over');
                  showCardDropIndicator(target.container, target.insertIdx);
                } else if (target.kind === 'sidebar' && target.sidebarNode) {
                  target.sidebarNode.classList.add('drop-target');
                }
              }
            } else {
              // Use ptrDrag visual feedback for row/stack/column items
              updatePtrDropTargetByType(ptrType, ev.clientX, ev.clientY);
            }
          }

          function onUp(ev) {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            if (!dragging) return;
            if (ghost) ghost.remove();
            itemEl.style.opacity = '';
            // Clean up all drop indicators
            clearCardDropIndicators();
            clearCardDragOverHighlights();
            clearHeaderDropTargetHighlights();
            clearSidebarDropHighlights();
            if (ptrType) {
              removeDropZoneIndicators();
              clearPtrDropIndicators();
            }

            if (dragItem.kind === 'card') {
              var target = resolveCardDropTarget(ev.clientX, ev.clientY);
              if (target && target.kind !== 'header-park' && target.kind !== 'header-archive' && target.kind !== 'header-trash') {
                // Restore card first (remove hidden tag), then move to target
                updateHiddenItemTag(dragItem, null).then(function () {
                  // After restoring, the card is back in its original column — now move it
                  var source = {
                    boardId: activeBoardId,
                    rowIndex: dragItem.rowIndex,
                    stackIndex: dragItem.stackIndex,
                    colIndex: dragItem.colIndex,
                    cardIndex: dragItem.cardIndex,
                    cardIndexMode: 'full',
                    indexMode: 'full'
                  };
                  return moveCard(source, target);
                }).catch(function (err) {
                  logFrontendIssue('error', 'hidden.dropdown.drag', 'Card drag-out failed', err);
                });
                closeHiddenItemsDropdown();
              }
            } else {
              // Non-card items: check if dropped on board area — restore in original position
              var boardRect = getElColumnsContainer().getBoundingClientRect();
              if (isPointInsideRect(ev.clientX, ev.clientY, boardRect)) {
                updateHiddenItemTag(dragItem, null).catch(function (err) {
                  logFrontendIssue('error', 'hidden.dropdown.drag', 'Non-card drag-out failed', err);
                });
                closeHiddenItemsDropdown();
              }
            }
          }

          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
        });
      })(grips[g]);
    }

    // Close on click-outside
    function closeListener(e) {
      if (!panel.contains(e.target) && e.target !== btnElement) {
        closeHiddenItemsDropdown();
      }
    }
    function keyListener(e) {
      if (e.key === 'Escape') closeHiddenItemsDropdown();
    }
    // Delay to avoid the opening click from closing
    setTimeout(function () {
      document.addEventListener('mousedown', closeListener, true);
      document.addEventListener('keydown', keyListener, true);
    }, 0);

    activeHiddenDropdown = { el: panel, closeListener: closeListener, keyListener: keyListener };
  }

  function showHiddenItemsDialog(title, emptyMessage, items, actions, footerActions) {
    if (!items || items.length === 0) {
      showNotification(emptyMessage);
      return;
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'modal-dialog hidden-items-dialog';
    var html = '<div class="modal-title">' + escapeHtml(title) + ' (' + items.length + ')</div>';
    html += '<div class="hidden-items-list">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var kindLabel = item.kind === 'row'
        ? 'Row'
        : item.kind === 'stack'
          ? 'Stack'
          : item.kind === 'column'
            ? 'Column'
            : 'Card';
      html += '<div class="parked-item hidden-item" data-idx="' + i + '">';
      html += '<span class="hidden-item-kind">' + kindLabel + '</span>';
      html += '<div class="parked-item-content">' + escapeHtml(item.title) + '</div>';
      html += '<div class="parked-item-col">' + escapeHtml(buildHiddenItemLocation(item)) + '</div>';
      for (var a = 0; a < actions.length; a++) {
        var action = actions[a];
        html += '<button class="board-action-btn' + (action.danger ? ' danger' : '') + '" data-item-action="' +
          escapeAttr(action.id) + '" data-item-index="' + i + '">' + escapeHtml(action.label) + '</button>';
      }
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="hidden-items-footer">';
    if (footerActions && footerActions.length > 0) {
      for (var f = 0; f < footerActions.length; f++) {
        var footerAction = footerActions[f];
        html += '<button class="board-action-btn' + (footerAction.danger ? ' danger' : '') + '" data-footer-action="' +
          escapeAttr(footerAction.id) + '">' + escapeHtml(footerAction.label) + '</button>';
      }
    }
    html += '<button class="board-action-btn" id="close-hidden-items">Close</button>';
    html += '</div>';
    dialog.innerHTML = html;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function closeDialog() {
      if (overlay && overlay.parentNode) overlay.remove();
    }

    overlay.addEventListener('click', async function (e) {
      if (e.target === overlay || e.target.id === 'close-hidden-items') {
        closeDialog();
        return;
      }
      var itemBtn = e.target.closest('[data-item-action]');
      if (itemBtn) {
        var itemIdx = parseInt(itemBtn.getAttribute('data-item-index'), 10);
        var itemAction = itemBtn.getAttribute('data-item-action');
        var selectedItem = items[itemIdx];
        if (!selectedItem) return;
        for (var a = 0; a < actions.length; a++) {
          if (actions[a].id === itemAction && typeof actions[a].handler === 'function') {
            try {
              traceFrontendAction('info', 'hidden.items', 'Running hidden item action', {
                boardId: activeBoardId || null,
                dialogTitle: title,
                action: itemAction,
                kind: selectedItem.kind,
                itemTitle: selectedItem.title || ''
              });
              var shouldClose = await actions[a].handler(selectedItem, { closeDialog: closeDialog });
              if (shouldClose !== false) closeDialog();
            } catch (err) {
              logFrontendIssue('error', 'hidden.items', 'Hidden item action failed', err);
              showNotification('Action failed');
            }
            return;
          }
        }
      }
      var footerBtn = e.target.closest('[data-footer-action]');
      if (footerBtn) {
        var footerId = footerBtn.getAttribute('data-footer-action');
        if (!footerActions) return;
        for (var f = 0; f < footerActions.length; f++) {
          if (footerActions[f].id === footerId && typeof footerActions[f].handler === 'function') {
            try {
              traceFrontendAction('info', 'hidden.items', 'Running hidden items footer action', {
                boardId: activeBoardId || null,
                dialogTitle: title,
                action: footerId,
                itemCount: items.length
              });
              var shouldClose = await footerActions[f].handler(items, { closeDialog: closeDialog });
              if (shouldClose !== false) closeDialog();
            } catch (err) {
              logFrontendIssue('error', 'hidden.items', 'Hidden items footer action failed', err);
              showNotification('Action failed');
            }
            return;
          }
        }
      }
    });
  }

  // --- Main View ---

  function renderMainView() {
    if (searchMode && searchResults) {
      renderSearchResults();
      refreshHeaderFileControls();
      return;
    }

    getElSearchResults().classList.add('hidden');

    if (!activeBoardData) {
      refreshHeaderFileControls();
      getElBoardHeader().classList.add('hidden');
      getElColumnsContainer().classList.add('hidden');
      getElEmptyState().classList.remove('hidden');
      getElEmptyState().innerHTML =
        '<div class="empty-state-icon">&#9776;</div>' +
        '<div>' + (connected ? 'Select a board from the sidebar' : 'Waiting for server...') + '</div>';
      return;
    }

    getElEmptyState().classList.add('hidden');
    getElBoardHeader().classList.remove('hidden');
    renderBoardHeader();
    getElColumnsContainer().classList.remove('hidden');
    applyBoardSettings();
    updateDisplayFromFullBoard();
    renderColumns();
    refreshHeaderFileControls();
  }

  function renderBoardHeader() {
    var parkedCount = getParkedCount();
    var archivedCount = getArchivedCount();
    var deletedCount = getDeletedCount();
    var boardFilePath = getActiveBoardFilePath();
    var boardFileName = boardFilePath
      ? getDisplayFileNameFromPath(boardFilePath)
      : ((activeBoardData && activeBoardData.title) ? activeBoardData.title : 'Untitled');
    var hasBoardFile = !!(activeBoardId && boardFilePath);
    var html = '';
    var fileTitle = boardFileName || 'Untitled';
    html += '<div class="board-header-file-group">';
    html += '<button id="btn-pane-file-title" class="board-header-file-title' + (hasBoardFile ? ' has-board' : '') + '" title="' +
      escapeAttr(hasBoardFile ? boardFilePath : fileTitle) + '">' + escapeHtml(fileTitle) + '</button>';
    html += '<button class="board-action-btn" id="btn-pane-file-rename" title="Rename board file"' + (hasBoardFile ? '' : ' disabled') + '>Rename</button>';
    html += '<button class="board-action-btn" id="btn-pane-file-folder" title="Open board folder"' + (hasBoardFile ? '' : ' disabled') + '>Folder</button>';
    html += '</div>';
    html += '<span id="saving-indicator" class="saving-indicator">Saving...</span>';
    html += '<div class="board-header-actions">';
    html += '<button class="board-action-btn header-drop-target' + (parkedCount > 0 ? ' has-items' : '') + '" id="btn-parked" title="Show parked items — drop cards here to park">Parked' + (parkedCount > 0 ? ' (' + parkedCount + ')' : '') + '</button>';
    html += '<button class="board-action-btn header-drop-target' + (archivedCount > 0 ? ' has-items' : '') + '" id="btn-archived" title="Show archived items — drop cards here to archive">Archived' + (archivedCount > 0 ? ' (' + archivedCount + ')' : '') + '</button>';
    html += '<button class="board-action-btn header-drop-target danger' + (deletedCount > 0 ? ' has-items' : '') + '" id="btn-trash" title="Show deleted items — drop cards here to delete">Trash' + (deletedCount > 0 ? ' (' + deletedCount + ')' : '') + '</button>';
    html += '<span id="btn-add-row-wrap" class="creation-source creation-source-header"></span>';
    html += '<button class="board-action-btn" id="btn-fold-all" title="Fold/unfold all columns">Fold All</button>';
    html += '<button class="board-action-btn" id="btn-export" title="Export board">Export</button>';
    html += '<button class="board-action-btn" id="btn-collab" title="Open collaboration settings">Collab</button>';
    html += '<button class="burger-menu-btn board-menu-btn" id="btn-board-menu" title="Board options">' + BURGER_MENU_ICON_HTML + '</button>';
    html += '</div>';
    getElBoardHeader().innerHTML = html;

    // Refresh board-header-lifetime cached refs
    $savingIndicator = document.getElementById('saving-indicator');
    $foldAllBtn = document.getElementById('btn-fold-all');

    var paneFileTitleBtn = document.getElementById('btn-pane-file-title');
    var paneFileRenameBtn = document.getElementById('btn-pane-file-rename');
    var paneFileFolderBtn = document.getElementById('btn-pane-file-folder');
    if (paneFileTitleBtn) {
      paneFileTitleBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (embeddedMode) notifyParentPaneActivated();
      });
      paneFileTitleBtn.addEventListener('dblclick', function (e) {
        if (!hasBoardFile) return;
        e.preventDefault();
        e.stopPropagation();
        renameActiveBoardFile();
      });
      paneFileTitleBtn.addEventListener('contextmenu', function (e) {
        if (!hasBoardFile) return;
        e.preventDefault();
        e.stopPropagation();
        showNativeMenu([
          { id: 'rename-file', label: 'Rename File' },
          { id: 'open-folder', label: 'Open Folder' },
        ], e.clientX, e.clientY).then(function (action) {
          if (action === 'rename-file') renameActiveBoardFile();
          else if (action === 'open-folder') openActiveBoardFolder();
        });
      });
    }
    if (paneFileRenameBtn) {
      paneFileRenameBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (!hasBoardFile) return;
        renameActiveBoardFile();
      });
    }
    if (paneFileFolderBtn) {
      paneFileFolderBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (!hasBoardFile) return;
        openActiveBoardFolder();
      });
    }

    if ($foldAllBtn) {
      $foldAllBtn.addEventListener('click', function () {
        toggleFoldAll();
      });
    }
    var exportBtn = document.getElementById('btn-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', async function () {
        if (!window.ExportUI) return;
        if (!window._exportUI) window._exportUI = new ExportUI();
        await window._exportUI.init(activeBoardId, fullBoardData);
        window._exportUI.show();
      });
    }
    var collabBtn = document.getElementById('btn-collab');
    if (collabBtn) {
      collabBtn.addEventListener('click', function () {
        openConnectionWindow();
      });
    }
    var parkedBtn = document.getElementById('btn-parked');
    if (parkedBtn) {
      parkedBtn.addEventListener('click', function () {
        showParkedItems(parkedBtn);
      });
    }
    var archivedBtn = document.getElementById('btn-archived');
    if (archivedBtn) {
      archivedBtn.addEventListener('click', function () {
        showArchivedItems(archivedBtn);
      });
    }
    var trashBtn = document.getElementById('btn-trash');
    if (trashBtn) {
      trashBtn.addEventListener('click', function () {
        showDeletedItems(trashBtn);
      });
    }
    var addRowWrap = document.getElementById('btn-add-row-wrap');
    if (addRowWrap) {
      var nextIndex = (fullBoardData && fullBoardData.rows) ? fullBoardData.rows.length : 0;
      var rowSource = renderCreationSource('row', { atIndex: nextIndex }, {
        btnClass: 'board-action-btn',
        btnText: 'Add Row',
        wrapperClass: 'creation-source-header'
      });
      // Move children into the placeholder span
      while (rowSource.firstChild) addRowWrap.appendChild(rowSource.firstChild);
    }
    var boardMenuBtn = document.getElementById('btn-board-menu');
    if (boardMenuBtn) {
      boardMenuBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var rect = boardMenuBtn.getBoundingClientRect();
        showBoardContextMenu(rect.right, rect.bottom);
      });
    }
    getElBoardHeader().addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showBoardContextMenu(e.clientX, e.clientY);
    });
  }

  function getParkedCount() {
    return getHiddenItemCount('#hidden-internal-parked');
  }

  function getArchivedCount() {
    return getHiddenItemCount('#hidden-internal-archived');
  }

  function getDeletedCount() {
    return getHiddenItemCount('#hidden-internal-deleted');
  }

  function areAllBoardItemsFolded() {
    var foldables = getElColumnsContainer().querySelectorAll('.column[data-col-title], .board-row[data-row-title], .board-stack[data-stack-title]');
    if (foldables.length === 0) return false;
    for (var i = 0; i < foldables.length; i++) {
      if (!foldables[i].classList.contains('folded')) return false;
    }
    return true;
  }

  function showBoardContextMenu(x, y) {
    if (!activeBoardId) return;
    closeRowStackMenu();
    closeColumnContextMenu();
    closeCardContextMenu();

    var hasBoardFile = !!getActiveBoardFilePath();
    var allFolded = areAllBoardItemsFolded();
    var parkedCount = getParkedCount();
    var archivedCount = getArchivedCount();
    var deletedCount = getDeletedCount();
    var items = [
      { id: 'add-row', label: 'Add Row' },
      { id: allFolded ? 'unfold-all' : 'fold-all', label: allFolded ? 'Unfold All' : 'Fold All' },
      { id: 'settings', label: 'Settings' },
      { id: 'collab', label: 'Collaboration' },
    ];
    if (parkedCount > 0) {
      items.push({ id: 'show-parked', label: 'Show Parked (' + parkedCount + ')' });
    }
    if (archivedCount > 0) {
      items.push({ id: 'show-archived', label: 'Show Archived (' + archivedCount + ')' });
    }
    if (deletedCount > 0) {
      items.push({ id: 'show-trash', label: 'Show Trash (' + deletedCount + ')' });
    }
    items.push({ separator: true });
    items.push({ id: 'rename-file', label: 'Rename File', disabled: !hasBoardFile });
    items.push({ id: 'open-folder', label: 'Open Folder', disabled: !hasBoardFile });

    showNativeMenu(items, x, y).then(function (action) {
      handleBoardAction(action);
    });
  }

  function handleBoardAction(action) {
    if (!action) return;
    if (action === 'add-row') {
      var nextIndex = (fullBoardData && fullBoardData.rows) ? fullBoardData.rows.length : 0;
      addRow(nextIndex);
      return;
    }
    if (action === 'fold-all' || action === 'unfold-all') {
      toggleFoldAll();
      return;
    }
    if (action === 'settings') {
      openManagementPanel({ section: 'boards', boardId: activeBoardId, tab: 'settings' });
      return;
    }
    if (action === 'collab') {
      openManagementPanel({ section: 'boards', boardId: activeBoardId, tab: 'sharing' });
      return;
    }
    if (action === 'show-parked') {
      showParkedItems();
      return;
    }
    if (action === 'show-archived') {
      showArchivedItems();
      return;
    }
    if (action === 'show-trash') {
      showDeletedItems();
      return;
    }
    if (action === 'rename-file') {
      renameActiveBoardFile();
      return;
    }
    if (action === 'open-folder') {
      openActiveBoardFolder();
    }
  }

  function toggleFoldAll() {
    var foldables = getElColumnsContainer().querySelectorAll('.column[data-col-title], .board-row[data-row-title], .board-stack[data-stack-title]');
    var allFolded = areAllBoardItemsFolded();
    for (var i = 0; i < foldables.length; i++) {
      if (allFolded) {
        foldables[i].classList.remove('folded');
      } else {
        foldables[i].classList.add('folded');
      }
    }
    saveFoldState(activeBoardId);
    if ($foldAllBtn) $foldAllBtn.textContent = allFolded ? 'Fold All' : 'Unfold All';
  }

  function showParkedItems(btnElement) {
    var btn = btnElement || document.getElementById('btn-parked');
    showHiddenItemsDropdown(btn, '#hidden-internal-parked', 'Parked', 'No parked items',
      [
        { id: 'restore', label: 'Unpark', handler: function (item) { return updateHiddenItemTag(item, null); } },
        { id: 'trash', label: 'Trash', danger: true, handler: function (item) { return updateHiddenItemTag(item, '#hidden-internal-deleted'); } }
      ]
    );
  }

  async function unparkCard(colIndex, fullCardIndex) {
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var card = col.cards[fullCardIndex];
    if (!card) return;
    pushUndo();
    card.content = card.content.replace(/\s*#hidden-internal-parked/g, '');
    await persistBoardMutation({ refreshMainView: true });
  }

  function showArchivedItems(btnElement) {
    var btn = btnElement || document.getElementById('btn-archived');
    showHiddenItemsDropdown(btn, '#hidden-internal-archived', 'Archived', 'No archived items',
      [
        { id: 'restore', label: 'Restore', handler: function (item) { return updateHiddenItemTag(item, null); } },
        { id: 'delete-forever', label: 'Delete Forever', danger: true, handler: function (item) { return permanentlyDeleteHiddenItem(item); } }
      ]
    );
  }

  function showDeletedItems(btnElement) {
    var btn = btnElement || document.getElementById('btn-trash');
    showHiddenItemsDropdown(btn, '#hidden-internal-deleted', 'Trash', 'Trash is empty',
      [
        { id: 'restore', label: 'Restore', handler: function (item) { return updateHiddenItemTag(item, null); } },
        { id: 'delete-forever', label: 'Delete Forever', danger: true, handler: function (item) { return permanentlyDeleteHiddenItem(item); } }
      ],
      [
        {
          id: 'empty-trash', label: 'Empty Trash', danger: true,
          handler: async function (items, controls) {
            if (!items || items.length === 0) return true;
            traceFrontendAction('info', 'trash.empty', 'Requested empty trash', { boardId: activeBoardId || null, itemCount: items.length });
            if (controls && typeof controls.closeDialog === 'function') {
              controls.closeDialog();
              await new Promise(function (resolve) { requestAnimationFrame(resolve); });
            }
            var success = await permanentlyDeleteHiddenItems(items);
            if (!success) showNotification('Failed to empty trash');
            return false;
          }
        }
      ]
    );
  }

  var savingTimeout = null;
  function showSaving() {
    if ($savingIndicator) $savingIndicator.classList.add('visible');
    clearTimeout(savingTimeout);
  }
  function hideSaving() {
    clearTimeout(savingTimeout);
    savingTimeout = setTimeout(function () {
      if ($savingIndicator) $savingIndicator.classList.remove('visible');
    }, 500);
  }

  // Save coalescing: when a save is already in-flight, new requests are
  // deferred and coalesced into a single follow-up save.  This is purely
  // an optimisation to avoid redundant network round-trips.
  //
  // DESIGN INVARIANT — local edits live in fullBoardData until they are saved
  // or explicitly rebased. Clean boards may adopt authoritative external
  // snapshots directly so card identities stay aligned with live sync/storage.
  // Dirty boards keep their working copy and rebase when external changes land.
  var _saveInFlight = false;
  var _savePending = false;

  async function writeBoardCrashsave(reason, boardData, extra) {
    if (!activeBoardId || !boardData) return null;
    var payload = boardData;
    var crashsaveReason = reason || 'save-recovery';
    traceFrontendAction('warn', 'board.crashsave', 'Attempting to persist crashsave for active board', {
      boardId: activeBoardId,
      reason: crashsaveReason,
      summary: summarizeBoardHierarchy(boardData),
      extra: extra || null
    });
    try {
      var result = await LexeraApi.createBoardCrashsave(activeBoardId, payload, crashsaveReason);
      traceFrontendAction('warn', 'board.crashsave', 'Crashsave persisted for active board', {
        boardId: activeBoardId,
        reason: crashsaveReason,
        path: result && result.path ? result.path : null,
        filename: result && result.filename ? result.filename : null
      });
      return result || null;
    } catch (err) {
      logFrontendIssue('error', 'board.crashsave', 'Failed to persist crashsave for active board', err);
      return null;
    }
  }

  async function overwriteBoardWithLocalDraft(trigger) {
    if (!activeBoardId || !fullBoardData) return false;
    if (_saveInFlight) return false;
    _saveInFlight = true;
    showSaving();
    try {
      lastSaveTime = Date.now();
      ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(activeBoardId, fullBoardData));
      if (!fullBoardData.columns) fullBoardData.columns = [];
      traceFrontendAction('warn', 'board.save.force', 'Overwriting external board version with local draft', {
        boardId: activeBoardId,
        trigger: trigger || null,
        workingSummary: summarizeBoardHierarchy(fullBoardData),
        conflictSummary: pendingExternalRebaseConflict && pendingExternalRebaseConflict.result
          ? {
              conflicts: pendingExternalRebaseConflict.result.conflicts || 0,
              autoMerged: pendingExternalRebaseConflict.result.autoMerged || 0
            }
          : null
      });
      var result = await LexeraApi.saveBoard(activeBoardId, fullBoardData);
      var savedBoard = result && result.board ? result.board : null;
      if (savedBoard) {
        ensureBoardRowsForMutation(savedBoard, getMutationBoardTitle(activeBoardId, savedBoard));
        setBoardSaveBase(fullBoardData, savedBoard);
      } else {
        setBoardSaveBase(fullBoardData, fullBoardData);
      }
      pendingExternalRebaseConflict = null;
      if (activeBoardData && result && typeof result.version === 'number') {
        activeBoardData.version = result.version;
      }
      if (activeBoardData && result && result.revision) {
        activeBoardData.revision = result.revision;
      }
      if (result && typeof result.generation === 'number') {
        _lastLoadedGeneration = result.generation;
      }
      _lastLoadedRevision = result && result.revision ? result.revision : _lastLoadedRevision;
      clearBoardDirty();
      try {
        await reopenLiveSyncSession(activeBoardId);
      } catch (err) {
        logFrontendIssue('warn', 'board.save.force', 'Forced overwrite save succeeded but live sync session could not be reopened', err);
      }
      showNotification('Local draft saved and overwrote the external board version.');
      return true;
    } catch (err) {
      logFrontendIssue('error', 'board.save.force', 'Failed to overwrite external board version with local draft', err);
      var overwriteCrashsave = await writeBoardCrashsave('force-overwrite-save-exception', fullBoardData, {
        error: err && err.message ? err.message : String(err),
        trigger: trigger || null
      });
      showNotification(
        overwriteCrashsave && overwriteCrashsave.filename
          ? ('Overwrite failed. Recovery copy written: ' + overwriteCrashsave.filename)
          : 'Overwrite failed. The local draft remains open, but crashsave could not be written.'
      );
      return false;
    } finally {
      _saveInFlight = false;
      hideSaving();
    }
  }

  async function saveFullBoard() {
    if (pendingExternalRebaseConflict && pendingExternalRebaseConflict.result) {
      showExternalRebaseConflictDialog(pendingExternalRebaseConflict.result);
      return false;
    }
    if (_saveInFlight) {
      _savePending = true;
      return false;
    }
    _saveInFlight = true;
    var saveSucceeded = false;
    showSaving();
    try {
      do {
        _savePending = false;
        lastSaveTime = Date.now();
        // Ensure columns field exists (backend requires it)
        if (!fullBoardData.columns) fullBoardData.columns = [];

        var liveSession = getLiveSyncSession(activeBoardId);
        if (liveSession) {
          traceBoardIdentityPair('info', 'save.preflight', 'Pre-save identity comparison against live sync session', activeBoardId, 'local', fullBoardData, 'session', liveSession.board);
        }
        if (liveSession && hasBoardIdentityMismatch(fullBoardData, liveSession.board)) {
          traceFrontendAction('error', 'save.identityMismatch', 'Blocked save because local board identities do not match live sync session', {
            boardId: activeBoardId,
            local: getBoardCardIdentityStats(fullBoardData, liveSession.board),
            incomingSummary: summarizeBoardHierarchy(fullBoardData),
            sessionSummary: summarizeBoardHierarchy(liveSession.board)
          });
          var liveSessionCrashsave = await writeBoardCrashsave('identity-mismatch-live-session', fullBoardData, {
            sessionSummary: summarizeBoardHierarchy(liveSession.board)
          });
          showNotification(
            liveSessionCrashsave && liveSessionCrashsave.filename
              ? ('Save blocked. Recovery copy written: ' + liveSessionCrashsave.filename)
              : 'Save blocked and crashsave failed. The local draft remains open in the app.'
          );
          return false;
        }

        console.log('[saveFullBoard] incoming=' + boardCardSummary(fullBoardData));
        if (await applyBoardToLiveSyncSession(activeBoardId, fullBoardData, { skipBoardReplace: true, syncSaveBase: true })) {
          console.log('[saveFullBoard] live sync path succeeded');
          if (pendingRefresh) {
            pendingRefresh = false;
            await flushPendingLiveSyncUpdates({ refreshSidebar: true });
          }
          saveSucceeded = true;
          break;
        }
        var baseBoardData = getBoardSaveBase(fullBoardData);
        if (baseBoardData) {
          traceBoardIdentityPair('info', 'save.preflight', 'Pre-save identity comparison against save base', activeBoardId, 'local', fullBoardData, 'saveBase', baseBoardData);
        }
        if (baseBoardData && hasBoardIdentityMismatch(fullBoardData, baseBoardData)) {
          traceFrontendAction('error', 'save.identityMismatch', 'Blocked save because local board identities do not match its save base', {
            boardId: activeBoardId,
            local: getBoardCardIdentityStats(fullBoardData, baseBoardData),
            incomingSummary: summarizeBoardHierarchy(fullBoardData),
            baseSummary: summarizeBoardHierarchy(baseBoardData)
          });
          var baseMismatchCrashsave = await writeBoardCrashsave('identity-mismatch-save-base', fullBoardData, {
            baseSummary: summarizeBoardHierarchy(baseBoardData)
          });
          showNotification(
            baseMismatchCrashsave && baseMismatchCrashsave.filename
              ? ('Save blocked. Recovery copy written: ' + baseMismatchCrashsave.filename)
              : 'Save blocked and crashsave failed. The local draft remains open in the app.'
          );
          return false;
        }
        console.log('[saveFullBoard] REST path, has_base=' + !!baseBoardData + (baseBoardData ? ' base=' + boardCardSummary(baseBoardData) : ''));
        var result;
        try {
          result = baseBoardData
            ? await LexeraApi.saveBoardWithBase(activeBoardId, baseBoardData, fullBoardData)
            : await LexeraApi.saveBoard(activeBoardId, fullBoardData);
        } catch (err) {
          if (err && err.status === 409) {
            traceFrontendAction('warn', 'board.save.conflict', 'Save blocked by external conflicting changes', {
              boardId: activeBoardId,
              hasBase: !!baseBoardData,
              error: err && err.message ? err.message : String(err)
            });
            if (baseBoardData) {
              try {
                var conflictResult = await LexeraApi.rebaseBoardWithBase(activeBoardId, baseBoardData, fullBoardData);
                if (conflictResult && conflictResult.hasConflicts) {
                  pendingExternalRebaseConflict = {
                    result: conflictResult,
                    savedAt: Date.now()
                  };
                  showExternalRebaseConflictDialog(conflictResult);
                  return false;
                }
              } catch (rebaseErr) {
                logFrontendIssue('error', 'board.save.conflict', 'Failed to fetch rebase preview after conflict', rebaseErr);
              }
            }
            showNotification('Save blocked: the board changed externally and needs to be reloaded or rebased before saving.');
            return false;
          }
          throw err;
        }

        // Never replace fullBoardData — only update the save base.
        var savedBoard = result && result.board ? result.board : null;
        if (savedBoard) {
          ensureBoardRowsForMutation(savedBoard, getMutationBoardTitle(activeBoardId, savedBoard));
          setBoardSaveBase(fullBoardData, savedBoard);
          pendingExternalRebaseConflict = null;
        } else {
          setBoardSaveBase(fullBoardData, fullBoardData);
        }
        if (activeBoardData && result && typeof result.version === 'number') {
          activeBoardData.version = result.version;
        }
        if (activeBoardData && result && result.revision) {
          activeBoardData.revision = result.revision;
        }
        if (result && typeof result.generation === 'number') {
          _lastLoadedGeneration = result.generation;
        }
        _lastLoadedRevision = result && result.revision ? result.revision : _lastLoadedRevision;

        try {
          await reopenLiveSyncSession(activeBoardId);
        } catch (e) {
          // REST save succeeded even if the live session cannot be refreshed.
        }
        if (result && result.hasConflicts) {
          showConflictDialog(result.conflicts, result.autoMerged);
        } else if (result && result.merged && result.autoMerged > 0) {
          showNotification('Auto-merged ' + result.autoMerged + ' change(s) with server version');
        }
        saveSucceeded = true;
      } while (_savePending);
      return saveSucceeded;
    } catch (err) {
      var failedSaveCrashsave = await writeBoardCrashsave('save-exception', fullBoardData, {
        error: err && err.message ? err.message : String(err)
      });
      showNotification(
        failedSaveCrashsave && failedSaveCrashsave.filename
          ? ('Save failed. Recovery copy written: ' + failedSaveCrashsave.filename)
          : 'Save failed. The local draft remains open, but crashsave could not be written.'
      );
      throw err;
    } finally {
      _saveInFlight = false;
      hideSaving();
    }
  }

  // Generation is kept for diagnostics only; backend-computed revision is the
  // authoritative freshness token for external file changes.
  var _lastLoadedGeneration = null;
  var _lastLoadedRevision = null;

  // Board dirty state: tracks whether fullBoardData has unsaved changes.
  var _boardDirty = false;

  function markBoardDirty() {
    if (_boardDirty) return;
    _boardDirty = true;
    if ($savingIndicator) {
      $savingIndicator.textContent = 'Unsaved';
      $savingIndicator.classList.add('visible', 'dirty');
    }
  }

  function clearBoardDirty() {
    _boardDirty = false;
    pendingExternalRebaseConflict = null;
    clearLocalBoardDraft(activeBoardId);
    if ($savingIndicator) {
      $savingIndicator.classList.remove('dirty');
    }
  }

  function isBoardDirty() {
    return _boardDirty;
  }

  function persistBoardMutation(options) {
    options = options || {};
    traceFrontendAction('info', 'board.persist', 'Persist board mutation (UI refresh, no save)', {
      boardId: activeBoardId || null,
      refreshMainView: !!options.refreshMainView,
      refreshSidebar: !!options.refreshSidebar,
      skipRender: !!options.skipRender,
      summaryBefore: summarizeBoardHierarchy(fullBoardData)
    });
    if (typeof options.beforeRefresh === 'function') {
      options.beforeRefresh();
    }
    updateDisplayFromFullBoard();
    if (activeBoardId && fullBoardData) {
      setBoardHierarchyRows(activeBoardId, fullBoardData, activeBoardData ? activeBoardData.title : '');
    }
    if (options.refreshMainView) {
      renderMainView();
    } else if (!options.skipRender) {
      renderColumns();
      if (options.refreshSidebar) renderBoardList();
    }
    if (typeof options.afterRefresh === 'function') {
      options.afterRefresh();
    }
    scheduleDashboardRefresh(80);
    markBoardDirty();
    saveLocalBoardDraft(activeBoardId, fullBoardData);
    traceFrontendAction('info', 'board.persist', 'Persist board mutation success', {
      boardId: activeBoardId || null,
      refreshMainView: !!options.refreshMainView,
      refreshSidebar: !!options.refreshSidebar,
      skipRender: !!options.skipRender,
      summaryAfter: summarizeBoardHierarchy(fullBoardData)
    });
    if (activeBoardId && fullBoardData) {
      var session = getLiveSyncSession(activeBoardId);
      if (session && session.board) {
        traceBoardIdentityPair('info', 'board.persist.identity', 'Identity comparison after board mutation against live sync session', activeBoardId, 'local', fullBoardData, 'session', session.board);
      }
      var saveBase = getBoardSaveBase(fullBoardData);
      if (saveBase) {
        traceBoardIdentityPair('info', 'board.persist.identity', 'Identity comparison after board mutation against save base', activeBoardId, 'local', fullBoardData, 'saveBase', saveBase);
      }
    }
    return true;
  }

  function ensureBoardRowsForMutation(boardData, fallbackTitle) {
    if (!boardData) return;
    if (boardData.rows && boardData.rows.length > 0) {
      if (!boardData.columns) boardData.columns = [];
      return;
    }
    var cols = boardData.columns || [];
    if (cols.length === 0) {
      boardData.rows = [];
      boardData.columns = [];
      return;
    }
    var groups = [];
    for (var i = 0; i < cols.length; i++) {
      var hasTag = /(?:^|\s)#stack(?:\s|$)/.test(cols[i].title || '');
      if (hasTag && groups.length > 0) groups[groups.length - 1].push(cols[i]);
      else groups.push([cols[i]]);
    }
    var stacks = [];
    for (var g = 0; g < groups.length; g++) {
      for (var c = 0; c < groups[g].length; c++) {
        groups[g][c].title = stripStackTag(groups[g][c].title || '');
      }
      stacks.push({
        id: 'stack-' + Date.now() + '-' + g,
        title: groups[g][0] && groups[g][0].title ? groups[g][0].title : ('Stack ' + (g + 1)),
        columns: groups[g]
      });
    }
    boardData.rows = [{
      id: 'row-' + Date.now(),
      title: boardData.title || fallbackTitle || 'Board',
      stacks: stacks
    }];
    boardData.columns = [];
  }

  function getMutationBoardTitle(boardId, boardData) {
    if (boardData && boardData.title) return boardData.title;
    if (boardId === activeBoardId && activeBoardData && activeBoardData.title) return activeBoardData.title;
    var meta = findBoardMeta(boardId);
    return meta && meta.title ? meta.title : 'Board';
  }

  async function loadBoardDataForMutation(boardId) {
    if (!boardId) return null;
    if (boardId === activeBoardId && fullBoardData) {
      ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
      if (!getBoardSaveBase(fullBoardData)) setBoardSaveBase(fullBoardData, fullBoardData);
      return fullBoardData;
    }
    var response = await LexeraApi.getBoardColumns(boardId);
    var boardData = response && response.fullBoard ? response.fullBoard : { rows: [], columns: [] };
    ensureBoardRowsForMutation(boardData, response && response.title ? response.title : getMutationBoardTitle(boardId, boardData));
    return setBoardSaveBase(boardData, boardData);
  }

  async function commitBoardMutations(changedBoards, options) {
    options = options || {};
    var boardIds = Object.keys(changedBoards || {});
    if (boardIds.length === 0) return true;

    try {
      for (var i = 0; i < boardIds.length; i++) {
        var boardId = boardIds[i];
        var boardData = changedBoards[boardId];
        if (!boardData) continue;

        if (boardId === activeBoardId) {
          // Active board: don't save — user saves explicitly with Cmd+S.
          // Just refresh the UI and mark dirty.
          updateDisplayFromFullBoard();
          markBoardDirty();
          setBoardHierarchyRows(boardId, fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
          continue;
        }

        // Non-active boards: must save since they're not kept in memory.
        showSaving();
        lastSaveTime = Date.now();
        ensureBoardRowsForMutation(boardData, getMutationBoardTitle(boardId, boardData));
        if (!boardData.columns) boardData.columns = [];
        var baseBoardData = getBoardSaveBase(boardData);
        var result = baseBoardData
          ? await LexeraApi.saveBoardWithBase(boardId, baseBoardData, boardData)
          : await LexeraApi.saveBoard(boardId, boardData);
        var savedBoardData = resolveSavedBoardData(boardData, result, boardId);
        changedBoards[boardId] = savedBoardData;
        setBoardHierarchyRows(boardId, savedBoardData, getMutationBoardTitle(boardId, savedBoardData));
      }
      if (typeof options.beforeRefresh === 'function') options.beforeRefresh();
      if (options.refreshMainView) {
        renderMainView();
      } else if (!options.skipRender && boardIds.indexOf(activeBoardId) !== -1) {
        renderColumns();
      }
      if (boardIds.indexOf(activeBoardId) !== -1) refreshHeaderFileControls();
      if (options.refreshSidebar) renderBoardList();
      if (typeof options.afterRefresh === 'function') options.afterRefresh();
      scheduleDashboardRefresh(80);
      return true;
    } catch (err) {
      logFrontendIssue('error', 'commitBoardMutations', 'Save failed for non-active board', err);
      if (typeof options.onError === 'function') options.onError(err);
      return false;
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
        '<button class="btn-small btn-primary" data-conflict-action="overwrite">Overwrite With My Version</button>' +
      '</div>';

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    dialog.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-conflict-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-conflict-action');
      overlay.remove();
      if (action === 'reload') {
        loadBoard(activeBoardId);
        return;
      }
      if (action === 'overwrite') {
        await overwriteBoardWithLocalDraft('merge-conflict-dialog');
      }
    });
  }

  function showExternalRebaseConflictDialog(result) {
    if (!result) return;
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.innerHTML =
      '<div class="dialog-title">External Changes Need Resolution</div>' +
      '<div style="margin-bottom:12px;color:var(--text-primary);font-size:13px;line-height:1.45">' +
        'The board changed on disk while you had unsaved edits.' +
        '<br>Your local draft was preserved and saving is blocked until you resolve this.' +
        (result.autoMerged > 0 ? '<br>' + result.autoMerged + ' change(s) were merged automatically before conflicts were found.' : '') +
        '<br><strong>' + (result.conflicts || 0) + ' conflict(s)</strong> still need manual resolution.' +
        '<br>Non-conflicting changes were already merged automatically. The remaining conflict is an overlapping edit that still needs a decision.' +
      '</div>' +
      '<div class="dialog-actions">' +
        '<button class="btn-small btn-cancel" data-rebase-action="keep">Keep Local Draft</button>' +
        '<button class="btn-small btn-cancel" data-rebase-action="reload">Load Disk Version</button>' +
        '<button class="btn-small btn-primary" data-rebase-action="overwrite">Overwrite Disk With Local Draft</button>' +
      '</div>';

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    dialog.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-rebase-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-rebase-action');
      overlay.remove();
      if (action === 'reload') {
        pendingExternalRebaseConflict = null;
        loadBoard(activeBoardId);
        return;
      }
      if (action === 'overwrite') {
        await overwriteBoardWithLocalDraft('external-rebase-conflict-dialog');
        return;
      }
      pendingExternalRebaseConflict = pendingExternalRebaseConflict || { result: result, savedAt: Date.now() };
      showNotification('Local draft kept. Resolve the external change before saving.');
    });
  }

  // ── Confirm Dialog (replaces broken window.confirm in Tauri 2) ──

  function showConfirmDialog(message) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';
      var dialog = document.createElement('div');
      dialog.className = 'dialog';
      dialog.style.maxWidth = '380px';
      dialog.innerHTML =
        '<div class="dialog-title">Confirm</div>' +
        '<div class="dialog-note" style="margin-bottom:16px;line-height:1.4;white-space:pre-line">' + escapeHtml(message) + '</div>' +
        '<div class="dialog-actions">' +
        '<button class="btn-small btn-cancel" data-confirm="cancel">Cancel</button>' +
        '<button class="btn-small btn-primary" data-confirm="ok">OK</button>' +
        '</div>';
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      function close(result) {
        overlay.remove();
        resolve(result);
      }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close(false);
      });
      dialog.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-confirm]');
        if (!btn) return;
        close(btn.getAttribute('data-confirm') === 'ok');
      });
    });
  }

  // ── Management Panel ──────────────────────────────────────────

  var BOARD_SETTINGS_FIELDS = [
    { key: 'columnWidth', label: 'Column Width', placeholder: '280px', type: 'text' },
    { key: 'layoutRows', label: 'Layout Rows', placeholder: '', type: 'number' },
    { key: 'layoutPreset', label: 'Layout Preset', placeholder: 'compact / spacious / custom', type: 'text' },
    { key: 'fontSize', label: 'Font Size', placeholder: '13px', type: 'text' },
    { key: 'fontFamily', label: 'Font Family', placeholder: '', type: 'select', options: [
      '', 'Poppins', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Nunito', 'Source Sans Pro',
      'SF Pro Display', 'Helvetica Neue', 'Arial', 'Segoe UI', 'Verdana',
      'Georgia', 'Times New Roman', 'Courier New', 'monospace', 'system-ui'
    ] },
    { key: 'rowHeight', label: 'Row Height', placeholder: 'auto', type: 'text' },
    { key: 'maxRowHeight', label: 'Max Row Height (px)', placeholder: '', type: 'number' },
    { key: 'cardMinHeight', label: 'Card Min Height', placeholder: 'auto', type: 'text' },
    { key: 'tagVisibility', label: 'Tag Visibility', placeholder: '', type: 'select', options: ['', 'all', 'allexcludinglayout', 'customonly', 'mentionsonly', 'none', 'dim'] },
    { key: 'whitespace', label: 'Whitespace', placeholder: '', type: 'select', options: ['', 'pre-wrap', 'normal', 'nowrap'] },
    { key: 'stickyStackMode', label: 'Sticky Column Header', placeholder: '', type: 'select', options: ['', 'titleonly', 'full', 'bottom'] },
    { key: 'htmlCommentRenderMode', label: 'HTML Comments', placeholder: '', type: 'select', options: ['', 'text', 'hidden', 'dim'] },
    { key: 'htmlContentRenderMode', label: 'HTML Content', placeholder: '', type: 'select', options: ['', 'text', 'html'] },
    { key: 'arrowKeyFocusScroll', label: 'Arrow Key Focus Scroll', placeholder: '', type: 'select', options: ['', 'nearest', 'center', 'disabled'] },
    { key: 'layoutSpacing', label: 'Layout Spacing', placeholder: '', type: 'select', options: ['', 'compact', 'spacious'] },
    { key: 'boardColor', label: 'Board Color', placeholder: '#4c7abf', type: 'text' },
    { key: 'boardColorLight', label: 'Board Color (Light)', placeholder: '#4c7abf', type: 'text' },
    { key: 'boardColorDark', label: 'Board Color (Dark)', placeholder: '#4c7abf', type: 'text' }
  ];

  var mgmtPanelOpen = false;
  var mgmtExpandedBoardId = null;
  var mgmtActiveBoardTab = {};

  function openManagementPanel(options) {
    options = options || {};
    mgmtPanelOpen = true;
    if (options.boardId) mgmtExpandedBoardId = options.boardId;
    if (options.tab && options.boardId) mgmtActiveBoardTab[options.boardId] = options.tab;
    if (getElMgmtPanel()) getElMgmtPanel().classList.add('open');
    renderManagementPanel(options.section);
  }

  function closeManagementPanel() {
    mgmtPanelOpen = false;
    if (getElMgmtPanel()) getElMgmtPanel().classList.remove('open');
  }

  async function renderManagementPanel(scrollToSection) {
    if (!getElMgmtPanelBody()) return;

    var html = '';

    // ── Theme ──
    html += '<div class="mgmt-section" data-mgmt-section="theme">';
    html += '<div class="mgmt-section-title">Theme</div>';
    html += '<div class="mgmt-field-row">';
    html += '<label class="mgmt-field-label">Theme</label>';
    html += '<select class="mgmt-field-input" id="mgmt-theme-select">' +
      buildThemeOptionsMarkup(currentThemeId || (THEMES[0] && THEMES[0].id)) + '</select>';
    html += '</div>';
    html += '</div>';

    // ── Identity ──
    html += '<div class="mgmt-section" data-mgmt-section="identity">';
    html += '<div class="mgmt-section-title">Identity</div>';
    var identity = '';
    try {
      var info = await LexeraApi.getServerInfo();
      identity = (info && info.displayName) || '';
    } catch (e) { /* ignore */ }
    html += '<div class="mgmt-field-row">';
    html += '<label class="mgmt-field-label">Display Name</label>';
    html += '<input class="mgmt-field-input" id="mgmt-display-name" type="text" value="' + escapeAttr(identity) + '" placeholder="anonymous">';
    html += '<button class="btn-small btn-primary" id="mgmt-save-name">Save</button>';
    html += '</div>';
    html += '</div>';

    // ── My Boards ──
    html += '<div class="mgmt-section" data-mgmt-section="boards">';
    html += '<div class="mgmt-section-title">My Boards</div>';
    html += '<div class="mgmt-add-board-row">';
    html += '<input type="text" id="mgmt-add-board-path" placeholder="Board file path (.md)">';
    html += '<button class="btn-small btn-primary" id="mgmt-add-board-btn">Add</button>';
    html += '</div>';
    html += '<div id="mgmt-board-list"></div>';
    html += '</div>';

    // ── Server ──
    html += '<div class="mgmt-section" data-mgmt-section="server">';
    html += '<div class="mgmt-section-title">Server</div>';
    var serverConfig = { bindAddress: '0.0.0.0', port: 13080 };
    try {
      var sc = await LexeraApi.getServerInfo();
      if (sc) {
        serverConfig.bindAddress = sc.bindAddress || sc.bind_address || serverConfig.bindAddress;
        serverConfig.port = sc.port || serverConfig.port;
      }
    } catch (e) { /* ignore */ }
    html += '<div class="mgmt-field-row">';
    html += '<label class="mgmt-field-label">Bind Address</label>';
    html += '<input class="mgmt-field-input" id="mgmt-bind-address" type="text" value="' + escapeAttr(serverConfig.bindAddress) + '">';
    html += '</div>';
    html += '<div class="mgmt-field-row">';
    html += '<label class="mgmt-field-label">Port</label>';
    html += '<input class="mgmt-field-input" id="mgmt-port" type="number" value="' + escapeAttr(String(serverConfig.port)) + '">';
    html += '</div>';
    html += '<div class="mgmt-field-row" style="justify-content:flex-end">';
    html += '<button class="btn-small btn-primary" id="mgmt-save-server">Save</button>';
    html += '</div>';
    html += '<div id="mgmt-server-status" class="mgmt-status"></div>';
    html += '</div>';

    // ── Network ──
    html += '<div class="mgmt-section" data-mgmt-section="network">';
    html += '<div class="mgmt-section-title">Network</div>';

    // Connect to remote
    html += '<div class="mgmt-field-row">';
    html += '<input class="mgmt-field-input" id="mgmt-remote-url" type="text" placeholder="Remote server URL">';
    html += '</div>';
    html += '<div class="mgmt-field-row">';
    html += '<input class="mgmt-field-input" id="mgmt-remote-token" type="text" placeholder="Invite token">';
    html += '<button class="btn-small btn-primary" id="mgmt-connect-remote">Join</button>';
    html += '</div>';
    html += '<div id="mgmt-connect-status" class="mgmt-status"></div>';

    // Active connections
    html += '<div style="margin-top:8px"><div class="mgmt-section-title" style="font-size:10px">Active Connections</div></div>';
    html += '<div id="mgmt-connections-list"></div>';

    // Discovered peers
    html += '<div style="margin-top:8px"><div class="mgmt-section-title" style="font-size:10px">Discovered Peers</div></div>';
    html += '<div id="mgmt-peers-list"></div>';

    html += '</div>';

    getElMgmtPanelBody().innerHTML = html;

    // ── Wire up events ──

    // Theme
    var themeSelect = document.getElementById('mgmt-theme-select');
    if (themeSelect) {
      themeSelect.addEventListener('change', function () {
        applyTheme(themeSelect.value);
      });
    }

    // Identity
    var saveNameBtn = document.getElementById('mgmt-save-name');
    if (saveNameBtn) {
      saveNameBtn.addEventListener('click', async function () {
        var name = document.getElementById('mgmt-display-name').value.trim();
        try {
          await LexeraApi.updateServerConfig({ displayName: name });
          showNotification('Display name saved');
        } catch (err) {
          showNotification('Failed to save name: ' + err.message);
        }
      });
    }

    // Add board
    var addBoardBtn = document.getElementById('mgmt-add-board-btn');
    if (addBoardBtn) {
      addBoardBtn.addEventListener('click', async function () {
        var pathInput = document.getElementById('mgmt-add-board-path');
        var filePath = pathInput ? pathInput.value.trim() : '';
        if (!filePath) return;
        try {
          await LexeraApi.request('/boards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: filePath })
          });
          if (pathInput) pathInput.value = '';
          showNotification('Board added');
          poll();
          renderMgmtBoardList();
        } catch (err) {
          showNotification('Failed to add board: ' + err.message);
        }
      });
    }

    // Server save
    var saveServerBtn = document.getElementById('mgmt-save-server');
    if (saveServerBtn) {
      saveServerBtn.addEventListener('click', async function () {
        var addr = document.getElementById('mgmt-bind-address').value.trim();
        var port = parseInt(document.getElementById('mgmt-port').value, 10);
        var statusEl = document.getElementById('mgmt-server-status');
        try {
          await LexeraApi.updateServerConfig({ bindAddress: addr, port: port });
          if (statusEl) { statusEl.className = 'mgmt-status success'; statusEl.textContent = 'Saved (restart required)'; }
        } catch (err) {
          if (statusEl) { statusEl.className = 'mgmt-status error'; statusEl.textContent = err.message; }
        }
      });
    }

    // Connect remote
    var connectBtn = document.getElementById('mgmt-connect-remote');
    if (connectBtn) {
      connectBtn.addEventListener('click', async function () {
        var urlInput = document.getElementById('mgmt-remote-url');
        var tokenInput = document.getElementById('mgmt-remote-token');
        var url = urlInput ? urlInput.value.trim() : '';
        var token = tokenInput ? tokenInput.value.trim() : '';
        var statusEl = document.getElementById('mgmt-connect-status');
        if (!url || !token) {
          if (statusEl) { statusEl.className = 'mgmt-status error'; statusEl.textContent = 'URL and token required'; }
          return;
        }
        try {
          await LexeraApi.connectRemote(url, token);
          if (statusEl) { statusEl.className = 'mgmt-status success'; statusEl.textContent = 'Connected'; }
          if (urlInput) urlInput.value = '';
          if (tokenInput) tokenInput.value = '';
          renderMgmtConnections();
          poll();
        } catch (err) {
          if (statusEl) { statusEl.className = 'mgmt-status error'; statusEl.textContent = err.message; }
        }
      });
    }

    // Render dynamic lists
    await Promise.all([
      renderMgmtBoardList(),
      renderMgmtConnections(),
      renderMgmtPeers()
    ]);

    // Scroll to section if requested
    if (scrollToSection) {
      var sectionEl = getElMgmtPanelBody().querySelector('[data-mgmt-section="' + scrollToSection + '"]');
      if (sectionEl) sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function renderMgmtBoardList() {
    var container = document.getElementById('mgmt-board-list');
    if (!container) return;
    var boardList = [];
    try {
      boardList = await LexeraApi.getBoards();
    } catch (e) { /* ignore */ }

    if (!boardList.length) {
      container.innerHTML = '<div class="mgmt-list-empty">No boards</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < boardList.length; i++) {
      var b = boardList[i];
      var isExpanded = mgmtExpandedBoardId === b.id;
      html += '<div class="mgmt-board-row">';
      html += '<span class="mgmt-board-name" data-mgmt-expand="' + escapeAttr(b.id) + '">' + escapeHtml(b.title || b.id) + '</span>';
      html += '<div class="mgmt-board-actions">';
      html += '<button class="mgmt-board-remove" data-mgmt-remove="' + escapeAttr(b.id) + '" data-mgmt-remove-name="' + escapeAttr(b.title || b.id) + '" title="Remove board">&times;</button>';
      html += '</div>';
      html += '</div>';
      html += '<div class="mgmt-board-details' + (isExpanded ? ' expanded' : '') + '" data-mgmt-details="' + escapeAttr(b.id) + '">';
      if (isExpanded) {
        html += renderMgmtBoardDetailsContent(b.id, b.boardSettings || b.board_settings || {});
      }
      html += '</div>';
    }
    container.innerHTML = html;

    // Delegated events
    container.addEventListener('click', function (e) {
      // Expand/collapse
      var expandBtn = e.target.closest('[data-mgmt-expand]');
      if (expandBtn) {
        var boardId = expandBtn.getAttribute('data-mgmt-expand');
        if (mgmtExpandedBoardId === boardId) {
          mgmtExpandedBoardId = null;
        } else {
          mgmtExpandedBoardId = boardId;
        }
        renderMgmtBoardList();
        return;
      }

      // Remove
      var removeBtn = e.target.closest('[data-mgmt-remove]');
      if (removeBtn) {
        var rmId = removeBtn.getAttribute('data-mgmt-remove');
        var rmName = removeBtn.getAttribute('data-mgmt-remove-name');
        mgmtRemoveBoard(rmId, rmName);
        return;
      }

      // Tab switching
      var tabBtn = e.target.closest('[data-mgmt-tab]');
      if (tabBtn) {
        var tabBoardId = tabBtn.getAttribute('data-mgmt-tab-board');
        var tabName = tabBtn.getAttribute('data-mgmt-tab');
        mgmtActiveBoardTab[tabBoardId] = tabName;
        var detailsEl = container.querySelector('[data-mgmt-details="' + tabBoardId + '"]');
        if (detailsEl) {
          detailsEl.querySelectorAll('.mgmt-detail-tab').forEach(function (t) {
            t.classList.toggle('active', t.getAttribute('data-mgmt-tab') === tabName);
          });
          detailsEl.querySelectorAll('.mgmt-detail-tab-content').forEach(function (c) {
            c.classList.toggle('active', c.getAttribute('data-mgmt-tab-panel') === tabName);
          });
        }
        return;
      }

      // Save settings
      var saveBtn = e.target.closest('[data-mgmt-save-settings]');
      if (saveBtn) {
        mgmtSaveBoardSettings(saveBtn.getAttribute('data-mgmt-save-settings'));
        return;
      }

      // Create invite
      var createInvBtn = e.target.closest('[data-mgmt-create-invite]');
      if (createInvBtn) {
        mgmtCreateInvite(createInvBtn.getAttribute('data-mgmt-create-invite'));
        return;
      }

      // Revoke invite
      var revokeBtn = e.target.closest('[data-mgmt-revoke]');
      if (revokeBtn) {
        mgmtRevokeInvite(revokeBtn.getAttribute('data-mgmt-revoke-board'), revokeBtn.getAttribute('data-mgmt-revoke'));
        return;
      }

      // Copy token
      var copyBtn = e.target.closest('[data-mgmt-copy]');
      if (copyBtn) {
        var tokenVal = copyBtn.getAttribute('data-mgmt-copy');
        navigator.clipboard.writeText(tokenVal).then(function () {
          showNotification('Token copied to clipboard');
        });
        return;
      }
    });
  }

  function renderMgmtBoardDetailsContent(boardId, settings) {
    var activeTab = mgmtActiveBoardTab[boardId] || 'settings';
    var html = '';

    // Tabs
    html += '<div class="mgmt-detail-tabs">';
    html += '<button class="mgmt-detail-tab' + (activeTab === 'settings' ? ' active' : '') + '" data-mgmt-tab="settings" data-mgmt-tab-board="' + escapeAttr(boardId) + '">Settings</button>';
    html += '<button class="mgmt-detail-tab' + (activeTab === 'sharing' ? ' active' : '') + '" data-mgmt-tab="sharing" data-mgmt-tab-board="' + escapeAttr(boardId) + '">Sharing</button>';
    html += '<button class="mgmt-detail-tab' + (activeTab === 'members' ? ' active' : '') + '" data-mgmt-tab="members" data-mgmt-tab-board="' + escapeAttr(boardId) + '">Members</button>';
    html += '</div>';

    // ── Settings tab ──
    html += '<div class="mgmt-detail-tab-content' + (activeTab === 'settings' ? ' active' : '') + '" data-mgmt-tab-panel="settings">';
    html += '<div class="mgmt-settings-grid">';
    for (var i = 0; i < BOARD_SETTINGS_FIELDS.length; i++) {
      var f = BOARD_SETTINGS_FIELDS[i];
      var val = settings[f.key] != null ? settings[f.key] : '';
      if (f.key === 'stickyStackMode') {
        var sv = String(val || '').trim().toLowerCase();
        if (sv === 'top' || sv === 'titleonly' || sv === 'column' || sv === 'enabled' || sv === 'true') val = 'titleonly';
        else if (sv === 'full') val = 'full';
        else if (sv === 'bottom') val = 'bottom';
        else val = '';
      } else if (f.key === 'tagVisibility') {
        val = normalizeTagVisibilityMode(val);
      } else if (f.key === 'htmlCommentRenderMode') {
        val = normalizeHtmlCommentRenderMode(val);
      } else if (f.key === 'arrowKeyFocusScroll') {
        val = normalizeArrowKeyFocusScrollMode(val);
      }
      html += '<label>' + escapeHtml(f.label) + '</label>';
      if (f.type === 'select') {
        html += '<select data-board-setting="' + f.key + '">';
        for (var j = 0; j < f.options.length; j++) {
          var opt = f.options[j];
          html += '<option value="' + escapeAttr(opt) + '"' + (String(val) === opt ? ' selected' : '') + '>' + (opt || '(default)') + '</option>';
        }
        html += '</select>';
      } else {
        html += '<input type="' + f.type + '" data-board-setting="' + f.key + '" value="' + escapeAttr(String(val)) + '" placeholder="' + escapeAttr(f.placeholder) + '">';
      }
    }
    html += '</div>';
    html += '<div class="mgmt-settings-actions">';
    html += '<button class="btn-small btn-primary" data-mgmt-save-settings="' + escapeAttr(boardId) + '">Save</button>';
    html += '</div>';
    html += '</div>';

    // ── Sharing tab ──
    html += '<div class="mgmt-detail-tab-content' + (activeTab === 'sharing' ? ' active' : '') + '" data-mgmt-tab-panel="sharing">';
    html += '<div style="display:flex;gap:6px;align-items:flex-end;margin-bottom:8px">';
    html += '<div style="flex:1"><label style="font-size:11px;color:var(--text-secondary)">Role</label>';
    html += '<select class="mgmt-field-input" data-mgmt-invite-role="' + escapeAttr(boardId) + '">';
    html += '<option value="editor">Editor</option><option value="viewer">Viewer</option></select></div>';
    html += '<div style="width:60px"><label style="font-size:11px;color:var(--text-secondary)">Uses</label>';
    html += '<input class="mgmt-field-input" type="number" data-mgmt-invite-uses="' + escapeAttr(boardId) + '" value="1" min="1" style="width:100%"></div>';
    html += '<button class="btn-small btn-primary" data-mgmt-create-invite="' + escapeAttr(boardId) + '">Create</button>';
    html += '</div>';
    html += '<div data-mgmt-invite-result="' + escapeAttr(boardId) + '"></div>';
    html += '<div data-mgmt-invites-list="' + escapeAttr(boardId) + '"><div class="mgmt-list-empty">Loading...</div></div>';
    html += '</div>';

    // ── Members tab ──
    html += '<div class="mgmt-detail-tab-content' + (activeTab === 'members' ? ' active' : '') + '" data-mgmt-tab-panel="members">';
    html += '<div data-mgmt-members-list="' + escapeAttr(boardId) + '"><div class="mgmt-list-empty">Loading...</div></div>';
    html += '</div>';

    // Load sharing/members data async
    setTimeout(function () { mgmtRefreshBoardCollabData(boardId); }, 0);

    return html;
  }

  async function mgmtRefreshBoardCollabData(boardId) {
    var userId = await ensureSyncUserId();
    var results = await Promise.allSettled([
      LexeraApi.listMembers(boardId, userId),
      LexeraApi.getPresence(boardId, userId),
      LexeraApi.listInvites(boardId, userId),
    ]);
    var members = results[0].status === 'fulfilled' ? results[0].value : [];
    var onlineUsers = results[1].status === 'fulfilled' ? results[1].value : [];
    var invites = results[2].status === 'fulfilled' ? results[2].value : [];

    // Render members
    var membersEl = document.querySelector('[data-mgmt-members-list="' + boardId + '"]');
    if (membersEl) {
      if (members.length === 0) {
        membersEl.innerHTML = '<div class="mgmt-list-empty">No members yet</div>';
      } else {
        var mhtml = '';
        for (var i = 0; i < members.length; i++) {
          var m = members[i];
          var isOnline = onlineUsers.indexOf(m.user_id) !== -1;
          mhtml += '<div class="member-item">';
          mhtml += '<span class="member-item-name">';
          mhtml += '<span class="presence-dot' + (isOnline ? ' online' : '') + '"></span>';
          mhtml += escapeHtml(m.user_name || m.user_id);
          mhtml += '</span>';
          mhtml += '<span class="member-item-role">' + escapeHtml(m.role) + '</span>';
          mhtml += '</div>';
        }
        membersEl.innerHTML = mhtml;
      }
    }

    // Render invites
    var invitesEl = document.querySelector('[data-mgmt-invites-list="' + boardId + '"]');
    if (invitesEl) {
      if (invites.length === 0) {
        invitesEl.innerHTML = '<div class="mgmt-list-empty">No active invites</div>';
      } else {
        var ihtml = '';
        for (var j = 0; j < invites.length; j++) {
          var inv = invites[j];
          ihtml += '<div class="invite-item">';
          ihtml += '<div>';
          ihtml += '<span>' + escapeHtml(inv.role) + '</span>';
          ihtml += ' <span class="invite-item-info">' + inv.uses + '/' + inv.max_uses + ' uses</span>';
          ihtml += '<div class="invite-token-field">';
          ihtml += '<input type="text" value="' + escapeAttr(inv.token) + '" readonly>';
          ihtml += '<button class="btn-small" data-mgmt-copy="' + escapeAttr(inv.token) + '">Copy</button>';
          ihtml += '</div>';
          ihtml += '</div>';
          ihtml += '<button class="btn-small btn-cancel" data-mgmt-revoke="' + escapeAttr(inv.token) + '" data-mgmt-revoke-board="' + escapeAttr(boardId) + '">Revoke</button>';
          ihtml += '</div>';
        }
        invitesEl.innerHTML = ihtml;
      }
    }
  }

  async function mgmtCreateInvite(boardId) {
    var userId = await ensureSyncUserId();
    var roleEl = document.querySelector('[data-mgmt-invite-role="' + boardId + '"]');
    var usesEl = document.querySelector('[data-mgmt-invite-uses="' + boardId + '"]');
    var role = roleEl ? roleEl.value : 'editor';
    var maxUses = usesEl ? parseInt(usesEl.value, 10) || 1 : 1;
    try {
      var invite = await LexeraApi.createInvite(boardId, userId, role, maxUses);
      var resultEl = document.querySelector('[data-mgmt-invite-result="' + boardId + '"]');
      if (resultEl) {
        resultEl.innerHTML =
          '<div class="invite-token-field">' +
          '<input type="text" value="' + escapeAttr(invite.token) + '" readonly>' +
          '<button class="btn-small" data-mgmt-copy="' + escapeAttr(invite.token) + '">Copy</button>' +
          '</div>';
      }
      await mgmtRefreshBoardCollabData(boardId);
    } catch (err) {
      showNotification('Failed to create invite: ' + err.message);
    }
  }

  async function mgmtRevokeInvite(boardId, token) {
    var userId = await ensureSyncUserId();
    try {
      await LexeraApi.revokeInvite(boardId, token, userId);
      showNotification('Invite revoked');
      await mgmtRefreshBoardCollabData(boardId);
    } catch (err) {
      showNotification('Failed to revoke invite');
    }
  }

  async function mgmtSaveBoardSettings(boardId) {
    var detailsEl = document.querySelector('[data-mgmt-details="' + boardId + '"]');
    if (!detailsEl) return;
    var inputs = detailsEl.querySelectorAll('[data-board-setting]');
    var settings = {};
    for (var k = 0; k < inputs.length; k++) {
      var key = inputs[k].getAttribute('data-board-setting');
      var value = inputs[k].value.trim();
      if (value === '') {
        settings[key] = null;
      } else if (inputs[k].type === 'number' && value) {
        settings[key] = parseInt(value, 10);
      } else {
        settings[key] = value;
      }
    }
    try {
      // If this is the active board, persist via full board mutation
      // (preserves all fields including ones not in the REST struct)
      if (boardId === activeBoardId && fullBoardData) {
        pushUndo();
        if (!fullBoardData.boardSettings) fullBoardData.boardSettings = {};
        for (var s in settings) {
          fullBoardData.boardSettings[s] = settings[s];
        }
        await persistBoardMutation({ beforeRefresh: applyBoardSettings });
      } else {
        await LexeraApi.updateBoardSettings(boardId, settings);
      }
      showNotification('Board settings saved');
    } catch (err) {
      showNotification('Failed to save settings: ' + err.message);
    }
  }

  async function mgmtRemoveBoard(boardId, boardName) {
    var ok = await showConfirmDialog('Remove "' + boardName + '" from sidebar?\n(The file will not be deleted.)');
    if (!ok) return;
    try {
      await LexeraApi.removeBoard(boardId);
      // Update local state
      boards = boards.filter(function (b) { return b.id !== boardId; });
      delete boardHierarchyCache[boardId];
      if (activeBoardId === boardId) {
        activeBoardId = null;
        activeBoardData = null;
        fullBoardData = null;
        localStorage.removeItem('lexera-last-board');
      }
      renderBoardList();
      renderMainView();
      scheduleDashboardRefresh(60);
      if (mgmtExpandedBoardId === boardId) mgmtExpandedBoardId = null;
      renderMgmtBoardList();
      showNotification('Board removed');
    } catch (err) {
      showNotification('Failed to remove board');
      poll();
    }
  }

  async function renderMgmtConnections() {
    var container = document.getElementById('mgmt-connections-list');
    if (!container) return;
    var connections = [];
    try {
      connections = await LexeraApi.getConnections();
    } catch (e) { /* ignore */ }
    if (!connections || !connections.length) {
      container.innerHTML = '<div class="mgmt-list-empty">No active connections</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < connections.length; i++) {
      var c = connections[i];
      html += '<div class="mgmt-connection-row">';
      html += '<div class="mgmt-connection-info">';
      html += '<div class="mgmt-connection-url">';
      html += '<span class="mgmt-connection-status ' + (c.status === 'ok' || c.connected ? 'ok' : 'err') + '"></span>';
      html += escapeHtml(c.serverUrl || c.server_url || c.url || '');
      html += '</div>';
      if (c.localBoardId || c.local_board_id) {
        html += '<div class="mgmt-connection-board">' + escapeHtml(c.localBoardId || c.local_board_id) + '</div>';
      }
      html += '</div>';
      html += '<button class="btn-small btn-cancel" data-mgmt-disconnect="' + escapeAttr(c.localBoardId || c.local_board_id || '') + '">Disconnect</button>';
      html += '</div>';
    }
    container.innerHTML = html;

    container.addEventListener('click', async function (e) {
      var disBtn = e.target.closest('[data-mgmt-disconnect]');
      if (!disBtn) return;
      try {
        await LexeraApi.disconnectRemote(disBtn.getAttribute('data-mgmt-disconnect'));
        showNotification('Disconnected');
        renderMgmtConnections();
      } catch (err) {
        showNotification('Disconnect failed: ' + err.message);
      }
    });
  }

  async function renderMgmtPeers() {
    var container = document.getElementById('mgmt-peers-list');
    if (!container) return;
    var peers = [];
    try {
      peers = await LexeraApi.getDiscoveredPeers();
    } catch (e) { /* ignore */ }
    if (!peers || !peers.length) {
      container.innerHTML = '<div class="mgmt-list-empty">No peers discovered</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < peers.length; i++) {
      var p = peers[i];
      html += '<div class="mgmt-peer-row">';
      html += '<div class="mgmt-peer-info">';
      html += '<div class="mgmt-peer-name">' + escapeHtml(p.displayName || p.display_name || p.name || 'Unknown') + '</div>';
      html += '<div class="mgmt-peer-url">' + escapeHtml(p.url || p.address || '') + '</div>';
      html += '</div>';
      html += '</div>';
    }
    container.innerHTML = html;
  }

  // ── Collaboration ────────────────────────────────────────────────

  function openConnectionWindow() {
    openManagementPanel({ section: 'network' });
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

  function toggleInspector() {
    if (!hasTauri) {
      showNotification('Inspector: use browser DevTools (Cmd+Option+I)');
      return;
    }
    tauriInvoke('toggle_devtools', {})
      .then(function (opened) {
        showNotification(opened ? 'Inspector opened' : 'Inspector closed');
      })
      .catch(function (err) {
        logFrontendIssue('error', 'inspector', 'Failed to toggle devtools', err);
        showNotification('Inspector unavailable in this build');
      });
  }

  function isInspectorShortcut(e) {
    var code = e.code || '';
    if (e.key === 'F12') return true;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && code === 'KeyI') return true;
    if (e.altKey && !e.ctrlKey && !e.metaKey && code === 'KeyI') return true;
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'i' || e.key === 'I')) return true;
    return false;
  }

  if (getElInspectorBtn()) {
    getElInspectorBtn().addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleInspector();
    });
  }

  /**
   * Compute a structural delta between two board states.
   * Returns a delta object containing only the differences.
   * Uses the known board hierarchy: top-level fields, boardSettings,
   * rows > stacks > columns > cards.
   * Arrays of objects with 'id' fields are diffed by id matching.
   */
  function computeBoardDelta(oldBoard, newBoard) {
    var delta = {};
    // Compare top-level scalar fields
    var scalarKeys = ['valid', 'title', 'yamlHeader', 'kanbanFooter'];
    for (var k = 0; k < scalarKeys.length; k++) {
      var key = scalarKeys[k];
      if (oldBoard[key] !== newBoard[key]) {
        delta[key] = { o: oldBoard[key], n: newBoard[key] };
      }
    }
    // Compare boardSettings as a flat object
    var oldSettings = oldBoard.boardSettings || null;
    var newSettings = newBoard.boardSettings || null;
    var settingsDelta = diffFlatObject(oldSettings, newSettings);
    if (settingsDelta) delta.boardSettings = settingsDelta;
    // Compare rows array (rows > stacks > columns > cards)
    var rowsDelta = diffIdArray(oldBoard.rows || [], newBoard.rows || [], diffRow);
    if (rowsDelta) delta.rows = rowsDelta;
    // Compare legacy columns array
    var colsDelta = diffIdArray(oldBoard.columns || [], newBoard.columns || [], diffColumn);
    if (colsDelta) delta.columns = colsDelta;
    return delta;
  }

  /**
   * Diff two flat objects (like boardSettings). Returns null if identical.
   * Result: { key: { o: oldVal, n: newVal }, ... } for changed/added/removed keys.
   */
  function diffFlatObject(oldObj, newObj) {
    if (oldObj === newObj) return null;
    if (!oldObj && !newObj) return null;
    if (!oldObj) return { __replaced: { o: null, n: JSON.parse(JSON.stringify(newObj)) } };
    if (!newObj) return { __replaced: { o: JSON.parse(JSON.stringify(oldObj)), n: null } };
    var diff = null;
    var allKeys = {};
    var k;
    for (k in oldObj) allKeys[k] = true;
    for (k in newObj) allKeys[k] = true;
    for (k in allKeys) {
      var ov = oldObj[k], nv = newObj[k];
      if (ov !== nv) {
        if (!diff) diff = {};
        diff[k] = { o: ov, n: nv };
      }
    }
    return diff;
  }

  /**
   * Diff two arrays of objects that each have an 'id' field.
   * diffItemFn is called for items that exist in both arrays to produce per-item deltas.
   * Returns null if arrays are identical.
   * Result: { order: [id1, id2, ...], added: { id: fullItem }, removed: { id: fullItem }, modified: { id: itemDelta } }
   */
  function diffIdArray(oldArr, newArr, diffItemFn) {
    var oldIds = oldArr.map(function (item) { return item.id; });
    var newIds = newArr.map(function (item) { return item.id; });
    var oldMap = {};
    for (var i = 0; i < oldArr.length; i++) oldMap[oldArr[i].id] = oldArr[i];
    var newMap = {};
    for (var j = 0; j < newArr.length; j++) newMap[newArr[j].id] = newArr[j];
    var result = null;
    // Check order change
    var orderChanged = oldIds.length !== newIds.length || oldIds.some(function (id, idx) { return id !== newIds[idx]; });
    if (orderChanged) {
      result = result || {};
      result.oldOrder = oldIds;
      result.newOrder = newIds;
    }
    // Find added items
    for (var a = 0; a < newArr.length; a++) {
      if (!oldMap[newArr[a].id]) {
        result = result || {};
        if (!result.added) result.added = {};
        result.added[newArr[a].id] = JSON.parse(JSON.stringify(newArr[a]));
      }
    }
    // Find removed items
    for (var r = 0; r < oldArr.length; r++) {
      if (!newMap[oldArr[r].id]) {
        result = result || {};
        if (!result.removed) result.removed = {};
        result.removed[oldArr[r].id] = JSON.parse(JSON.stringify(oldArr[r]));
      }
    }
    // Find modified items
    for (var m = 0; m < newArr.length; m++) {
      if (oldMap[newArr[m].id]) {
        var itemDelta = diffItemFn(oldMap[newArr[m].id], newArr[m]);
        if (itemDelta) {
          result = result || {};
          if (!result.modified) result.modified = {};
          result.modified[newArr[m].id] = itemDelta;
        }
      }
    }
    return result;
  }

  /** Diff a single row: compare title + stacks array. */
  function diffRow(oldRow, newRow) {
    var delta = null;
    if (oldRow.title !== newRow.title) {
      delta = delta || {};
      delta.title = { o: oldRow.title, n: newRow.title };
    }
    var stacksDelta = diffIdArray(oldRow.stacks || [], newRow.stacks || [], diffStack);
    if (stacksDelta) {
      delta = delta || {};
      delta.stacks = stacksDelta;
    }
    return delta;
  }

  /** Diff a single stack: compare title + columns array. */
  function diffStack(oldStack, newStack) {
    var delta = null;
    if (oldStack.title !== newStack.title) {
      delta = delta || {};
      delta.title = { o: oldStack.title, n: newStack.title };
    }
    var colsDelta = diffIdArray(oldStack.columns || [], newStack.columns || [], diffColumn);
    if (colsDelta) {
      delta = delta || {};
      delta.columns = colsDelta;
    }
    return delta;
  }

  /** Diff a single column: compare title, include_source, + cards array. */
  function diffColumn(oldCol, newCol) {
    var delta = null;
    if (oldCol.title !== newCol.title) {
      delta = delta || {};
      delta.title = { o: oldCol.title, n: newCol.title };
    }
    var oldSrc = oldCol.include_source ? JSON.stringify(oldCol.include_source) : null;
    var newSrc = newCol.include_source ? JSON.stringify(newCol.include_source) : null;
    if (oldSrc !== newSrc) {
      delta = delta || {};
      delta.include_source = { o: oldCol.include_source || null, n: newCol.include_source || null };
    }
    var cardsDelta = diffIdArray(oldCol.cards || [], newCol.cards || [], diffCard);
    if (cardsDelta) {
      delta = delta || {};
      delta.cards = cardsDelta;
    }
    return delta;
  }

  /** Diff a single card: compare content, checked, kid. */
  function diffCard(oldCard, newCard) {
    var delta = null;
    var cardFields = ['content', 'checked', 'kid'];
    for (var f = 0; f < cardFields.length; f++) {
      var field = cardFields[f];
      if (oldCard[field] !== newCard[field]) {
        delta = delta || {};
        delta[field] = { o: oldCard[field], n: newCard[field] };
      }
    }
    return delta;
  }

  /**
   * Apply a board delta to fullBoardData, mutating it in place.
   * If reverse is true, apply the delta in reverse (undo direction).
   */
  function applyBoardDelta(board, delta, reverse) {
    // Apply top-level scalar changes
    var scalarKeys = ['valid', 'title', 'yamlHeader', 'kanbanFooter'];
    for (var k = 0; k < scalarKeys.length; k++) {
      var key = scalarKeys[k];
      if (delta[key]) {
        board[key] = reverse ? delta[key].o : delta[key].n;
      }
    }
    // Apply boardSettings changes
    if (delta.boardSettings) {
      applyFlatObjectDelta(board, 'boardSettings', delta.boardSettings, reverse);
    }
    // Apply rows delta
    if (delta.rows) {
      board.rows = applyIdArrayDelta(board.rows || [], delta.rows, reverse, applyRowDelta);
    }
    // Apply legacy columns delta
    if (delta.columns) {
      board.columns = applyIdArrayDelta(board.columns || [], delta.columns, reverse, applyColumnDelta);
    }
  }

  /** Apply a flat-object delta (for boardSettings). */
  function applyFlatObjectDelta(parent, prop, diff, reverse) {
    if (diff.__replaced) {
      parent[prop] = reverse ? JSON.parse(JSON.stringify(diff.__replaced.o)) : JSON.parse(JSON.stringify(diff.__replaced.n));
      return;
    }
    if (!parent[prop]) parent[prop] = {};
    for (var k in diff) {
      parent[prop][k] = reverse ? diff[k].o : diff[k].n;
    }
  }

  /**
   * Apply an id-array delta. Returns the new array.
   * applyItemDeltaFn applies per-item modifications in place.
   */
  function applyIdArrayDelta(arr, delta, reverse, applyItemDeltaFn) {
    // Build id->item map from current array
    var map = {};
    for (var i = 0; i < arr.length; i++) map[arr[i].id] = arr[i];
    // Handle removals (in reverse direction these are additions)
    var toRemove = reverse ? delta.added : delta.removed;
    if (toRemove) {
      for (var rid in toRemove) delete map[rid];
    }
    // Handle additions (in reverse direction these are removals)
    var toAdd = reverse ? delta.removed : delta.added;
    if (toAdd) {
      for (var aid in toAdd) map[aid] = JSON.parse(JSON.stringify(toAdd[aid]));
    }
    // Apply modifications
    if (delta.modified) {
      for (var mid in delta.modified) {
        if (map[mid]) {
          applyItemDeltaFn(map[mid], delta.modified[mid], reverse);
        }
      }
    }
    // Reconstruct array in correct order
    var targetOrder = reverse ? (delta.oldOrder || delta.newOrder) : (delta.newOrder || delta.oldOrder);
    if (targetOrder) {
      var result = [];
      for (var o = 0; o < targetOrder.length; o++) {
        if (map[targetOrder[o]]) result.push(map[targetOrder[o]]);
      }
      return result;
    }
    // No order change — return current array with modifications applied
    return arr.filter(function (item) { return !!map[item.id]; })
      .concat(Object.keys(map).filter(function (id) {
        return !arr.some(function (item) { return item.id === id; });
      }).map(function (id) { return map[id]; }));
  }

  /** Apply a row delta in place. */
  function applyRowDelta(row, delta, reverse) {
    if (delta.title) row.title = reverse ? delta.title.o : delta.title.n;
    if (delta.stacks) {
      row.stacks = applyIdArrayDelta(row.stacks || [], delta.stacks, reverse, applyStackDelta);
    }
  }

  /** Apply a stack delta in place. */
  function applyStackDelta(stack, delta, reverse) {
    if (delta.title) stack.title = reverse ? delta.title.o : delta.title.n;
    if (delta.columns) {
      stack.columns = applyIdArrayDelta(stack.columns || [], delta.columns, reverse, applyColumnDelta);
    }
  }

  /** Apply a column delta in place. */
  function applyColumnDelta(col, delta, reverse) {
    if (delta.title) col.title = reverse ? delta.title.o : delta.title.n;
    if (delta.include_source) col.include_source = reverse ? delta.include_source.o : delta.include_source.n;
    if (delta.cards) {
      col.cards = applyIdArrayDelta(col.cards || [], delta.cards, reverse, applyCardDelta);
    }
  }

  /** Apply a card delta in place. */
  function applyCardDelta(card, delta, reverse) {
    var cardFields = ['content', 'checked', 'kid'];
    for (var f = 0; f < cardFields.length; f++) {
      var field = cardFields[f];
      if (delta[field]) {
        card[field] = reverse ? delta[field].o : delta[field].n;
      }
    }
  }

  /** Estimate the byte size of a delta object for memory tracking. */
  function estimateDeltaSize(delta) {
    return JSON.stringify(delta).length;
  }

  /**
   * Finalize any pending undo snapshot by computing the delta
   * between the snapshot (pre-mutation state) and current fullBoardData (post-mutation state).
   */
  function finalizePendingUndo() {
    if (!undoPendingSnapshot || !fullBoardData) return;
    var delta = computeBoardDelta(undoPendingSnapshot, fullBoardData);
    var deltaSize = estimateDeltaSize(delta);
    undoStack.push({ delta: delta, size: deltaSize });
    undoTotalBytes += deltaSize;
    while (undoStack.length > MAX_UNDO) {
      undoTotalBytes -= undoStack.shift().size;
    }
    while (undoTotalBytes > MAX_UNDO_BYTES && undoStack.length > 0) {
      undoTotalBytes -= undoStack.shift().size;
    }
    undoPendingSnapshot = null;
  }

  function pushUndo() {
    if (!fullBoardData) return;
    finalizePendingUndo();
    undoPendingSnapshot = cloneBoardData(fullBoardData);
    redoStack = [];
  }

  async function undo() {
    finalizePendingUndo();
    if (undoStack.length === 0 || !fullBoardData || !activeBoardId) return;
    var saveBase = getBoardSaveBase(fullBoardData);
    var entry = undoStack.pop();
    undoTotalBytes -= entry.size;
    redoStack.push(entry);
    applyBoardDelta(fullBoardData, entry.delta, true);
    setBoardSaveBase(fullBoardData, saveBase || fullBoardData);
    await persistBoardMutation();
  }

  async function redo() {
    if (redoStack.length === 0 || !fullBoardData || !activeBoardId) return;
    var saveBase = getBoardSaveBase(fullBoardData);
    var entry = redoStack.pop();
    undoStack.push(entry);
    undoTotalBytes += entry.size;
    applyBoardDelta(fullBoardData, entry.delta, false);
    setBoardSaveBase(fullBoardData, saveBase || fullBoardData);
    await persistBoardMutation();
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
      if (fullBoardData && activeBoardId) {
        saveFullBoard().then(function (saved) {
          if (saved) clearBoardDirty();
        }).catch(function (err) {
          logFrontendIssue('warn', 'keyboard.save', 'Save shortcut failed after saveFullBoard already handled recovery', err);
        });
      }
      return;
    }

    if (isInspectorShortcut(e)) {
      e.preventDefault();
      e.stopPropagation();
      toggleInspector();
      return;
    }

    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'Enter') {
      if (closeTransientUiViaHotkey()) e.preventDefault();
      return;
    }
  });

  function normalizeStickyHeaderMode(rawMode) {
    var mode = String(rawMode || '').trim().toLowerCase();
    if (!mode) return '';
    if (mode === 'column' || mode === 'enabled' || mode === 'true' || mode === 'titleonly' || mode === 'full') return 'top';
    if (mode === 'top' || mode === 'bottom') return mode;
    return '';
  }

  function normalizeTagVisibilityMode(rawMode) {
    var mode = String(rawMode || '').trim().toLowerCase();
    if (!mode) return 'allexcludinglayout';
    if (mode === 'show') return 'all';
    if (mode === 'hide') return 'none';
    if (mode === 'standard') return 'allexcludinglayout';
    if (mode === 'custom') return 'customonly';
    if (mode === 'mentions') return 'mentionsonly';
    if (mode === 'all' || mode === 'allexcludinglayout' || mode === 'customonly' || mode === 'mentionsonly' || mode === 'none' || mode === 'dim') {
      return mode;
    }
    return 'all';
  }

  function normalizeHtmlCommentRenderMode(rawMode) {
    var mode = String(rawMode || '').trim().toLowerCase();
    if (!mode) return 'hidden';
    if (mode === 'show') return 'text';
    if (mode === 'hide' || mode === 'hidden') return 'hidden';
    if (mode === 'text' || mode === 'dim') return mode;
    return 'text';
  }

  function normalizeArrowKeyFocusScrollMode(rawMode) {
    var mode = String(rawMode || '').trim().toLowerCase();
    if (!mode || mode === 'enabled') return 'nearest';
    if (mode === 'disabled') return 'disabled';
    if (mode === 'center' || mode === 'nearest') return mode;
    return 'nearest';
  }

  function isLayoutTagName(tagName) {
    var normalized = String(tagName || '').trim().replace(/^#/, '').toLowerCase();
    return /^(row\d*|span\d*|stack|sticky|header|footer)$/.test(normalized);
  }

  function applyRenderedTagVisibility(root, mode) {
    if (!root || !root.querySelectorAll) return;
    var normalizedMode = normalizeTagVisibilityMode(mode);
    var tags = root.querySelectorAll('.tag[data-tag]');
    for (var i = 0; i < tags.length; i++) {
      var tagEl = tags[i];
      var tagName = tagEl.getAttribute('data-tag') || '';
      var lowerTagName = tagName.toLowerCase();
      var hide = false;
      tagEl.style.display = '';
      tagEl.style.opacity = '';

      if (normalizedMode === 'none' || normalizedMode === 'mentionsonly') {
        hide = true;
      } else if (normalizedMode === 'allexcludinglayout') {
        hide = isLayoutTagName(tagName);
      } else if (normalizedMode === 'customonly') {
        hide = isLayoutTagName(tagName) || !!TAG_COLORS[lowerTagName];
      } else if (normalizedMode === 'dim') {
        tagEl.style.opacity = '0.3';
      }

      if (hide) tagEl.style.display = 'none';
    }
  }

  function applyRenderedHtmlCommentVisibility(root, mode) {
    if (!root || !root.querySelectorAll) return;
    var normalizedMode = normalizeHtmlCommentRenderMode(mode);
    var comments = root.querySelectorAll('.html-comment');
    for (var i = 0; i < comments.length; i++) {
      comments[i].style.display = '';
      comments[i].style.opacity = '';
      if (normalizedMode === 'hidden') comments[i].style.display = 'none';
      else if (normalizedMode === 'dim') comments[i].style.opacity = '0.3';
    }
  }

  function normalizeColumnWidth(rawValue) {
    var value = String(rawValue || '').trim();
    if (!value) return '';
    if (/^\d+(\.\d+)?$/.test(value)) value += 'px';

    var pxMatch = value.match(/^(\d+(?:\.\d+)?)px$/i);
    if (pxMatch) {
      var px = parseFloat(pxMatch[1]);
      if (!isFinite(px)) return '';
      px = Math.max(120, Math.min(1200, px));
      return px + 'px';
    }

    if (/^\d+(\.\d+)?(rem|em|ch|vw|vh)$/i.test(value)) return value;
    return '';
  }

  function clearLayoutLockStyles() {
    var nodes = getElColumnsContainer().querySelectorAll('.board-row, .board-stack, .column');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || !el.style) continue;
      if (el.classList.contains('layout-locked')) continue;
      el.style.width = '';
      el.style.minWidth = '';
      el.style.maxWidth = '';
      el.style.height = '';
      el.style.minHeight = '';
      el.style.maxHeight = '';
    }
  }

  function syncRenderedRowWidths() {
    if (!getElColumnsContainer()) return;
    var rows = getElColumnsContainer().querySelectorAll('.board-row');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || row.classList.contains('layout-locked') || row.classList.contains('folded')) {
        var foldedContent = row ? row.querySelector(':scope > .board-row-content') : null;
        if (foldedContent && foldedContent.style) foldedContent.style.width = '';
        continue;
      }

      var content = row.querySelector(':scope > .board-row-content');
      if (!content || content.classList.contains('layout-locked')) continue;

      content.style.width = '';

      var stacks = content.querySelectorAll(':scope > .board-stack');
      var contentWidth = 0;

      if (stacks.length > 0) {
        var maxRight = 0;
        for (var s = 0; s < stacks.length; s++) {
          var stack = stacks[s];
          var right = stack.offsetLeft + stack.offsetWidth;
          if (right > maxRight) maxRight = right;
        }
        var contentStyle = window.getComputedStyle(content);
        var padRight = parseFloat(contentStyle.paddingRight || '0') || 0;
        contentWidth = Math.max(0, Math.ceil(maxRight + padRight));
      } else {
        var empty = content.querySelector(':scope > .board-level-empty');
        var emptyStyle = window.getComputedStyle(content);
        var padLeft = parseFloat(emptyStyle.paddingLeft || '0') || 0;
        var padRightEmpty = parseFloat(emptyStyle.paddingRight || '0') || 0;
        contentWidth = Math.max(120, Math.ceil((empty ? empty.offsetWidth : 0) + padLeft + padRightEmpty));
      }

      if (contentWidth > 0) {
        content.style.width = contentWidth + 'px';
      }
    }
  }

  function getBoardSettingValue(key, fallback) {
    if (!fullBoardData || !fullBoardData.boardSettings) return fallback;
    var value = fullBoardData.boardSettings[key];
    return value == null || value === '' ? fallback : value;
  }

  function getHtmlContentRenderMode() {
    var mode = getBoardSettingValue('htmlContentRenderMode', 'html');
    return mode === 'html' ? 'html' : 'text';
  }

  function resolveActiveBoardColor(settings) {
    settings = settings || {};
    var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) return settings.boardColorDark || settings.boardColor || '';
    return settings.boardColorLight || settings.boardColor || '';
  }

  function applyBoardSettings() {
    var cssProps = [
      '--board-column-width', '--board-font-size', '--board-font-family',
      '--board-bg', '--board-color', '--board-color-dark', '--board-color-light',
      '--board-row-height', '--board-max-row-height', '--board-card-min-height',
      '--board-whitespace', '--board-layout-rows'
    ];
    for (var i = 0; i < cssProps.length; i++) {
      getElColumnsContainer().style.removeProperty(cssProps[i]);
    }
    // Reset class-based settings
    getElColumnsContainer().classList.remove('sticky-headers', 'sticky-headers-top', 'sticky-headers-bottom');
    getElColumnsContainer().classList.remove('html-comments-hide', 'html-comments-dim');
    getElColumnsContainer().classList.remove('layout-spacious');
    getElColumnsContainer().removeAttribute('data-layout-preset');
    currentTagVisibilityMode = 'allexcludinglayout';
    currentArrowKeyFocusScrollMode = 'nearest';
    currentHtmlCommentRenderMode = 'hidden';
    getElColumnsContainer().classList.add('html-comments-hide');

    if (!fullBoardData || !fullBoardData.boardSettings) return;
    var s = fullBoardData.boardSettings;
    var normalizedColWidth = normalizeColumnWidth(s.columnWidth);
    if (normalizedColWidth) getElColumnsContainer().style.setProperty('--board-column-width', normalizedColWidth);
    if (s.fontSize) getElColumnsContainer().style.setProperty('--board-font-size', s.fontSize);
    if (s.fontFamily) getElColumnsContainer().style.setProperty('--board-font-family', s.fontFamily);
    if (s.rowHeight) getElColumnsContainer().style.setProperty('--board-row-height', s.rowHeight);
    if (s.maxRowHeight) getElColumnsContainer().style.setProperty('--board-max-row-height', s.maxRowHeight + 'px');
    if (s.cardMinHeight) getElColumnsContainer().style.setProperty('--board-card-min-height', s.cardMinHeight);
    if (s.whitespace) getElColumnsContainer().style.setProperty('--board-whitespace', s.whitespace);
    if (s.layoutRows) getElColumnsContainer().style.setProperty('--board-layout-rows', String(s.layoutRows));
    currentTagVisibilityMode = normalizeTagVisibilityMode(s.tagVisibility);
    var stickyMode = normalizeStickyHeaderMode(s.stickyStackMode);
    if (stickyMode) getElColumnsContainer().classList.add('sticky-headers-' + stickyMode);
    if (stickyMode === 'top') getElColumnsContainer().classList.add('sticky-headers'); // legacy alias
    currentHtmlCommentRenderMode = normalizeHtmlCommentRenderMode(s.htmlCommentRenderMode);
    if (currentHtmlCommentRenderMode === 'hidden') getElColumnsContainer().classList.add('html-comments-hide');
    if (currentHtmlCommentRenderMode === 'dim') getElColumnsContainer().classList.add('html-comments-dim');
    currentArrowKeyFocusScrollMode = normalizeArrowKeyFocusScrollMode(s.arrowKeyFocusScroll);
    if (currentArrowKeyFocusScrollMode !== 'disabled') getElColumnsContainer().classList.add('focus-scroll-mode');
    if (s.layoutSpacing === 'spacious' || s.layoutPreset === 'spacious') getElColumnsContainer().classList.add('layout-spacious');
    if (s.layoutPreset) getElColumnsContainer().setAttribute('data-layout-preset', s.layoutPreset);

    var boardColor = resolveActiveBoardColor(s);
    if (boardColor) getElColumnsContainer().style.setProperty('--board-color', boardColor);
    if (s.boardColorDark || s.boardColor) getElColumnsContainer().style.setProperty('--board-color-dark', s.boardColorDark || s.boardColor);
    if (s.boardColorLight || s.boardColor) getElColumnsContainer().style.setProperty('--board-color-light', s.boardColorLight || s.boardColor);
  }

  /**
   * Build a single column element (header, cards, footer) — shared by both formats.
   */
  function buildColumnElement(col, foldedCols, collapsedCards, rowIdx, stackIdx, colLocalIdx) {
    var displayTitle = stripLayoutTags(col.title);

    var colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.setAttribute('data-col-title', col.title);
    if (typeof rowIdx === 'number') colEl.setAttribute('data-row-index', rowIdx.toString());
    if (typeof stackIdx === 'number') colEl.setAttribute('data-stack-index', stackIdx.toString());
    if (typeof colLocalIdx === 'number') colEl.setAttribute('data-col-local-index', colLocalIdx.toString());
    if (foldedCols.indexOf(col.title) !== -1) {
      colEl.classList.add('folded');
    }

    // Check if column has include source
    var fullCol = getFullColumn(col.index);
    var includeIndicator = '';
    if (fullCol && fullCol.includeSource) {
      includeIndicator =
        '<button class="column-include-badge" type="button" data-include-path="' + escapeAttr(fullCol.includeSource.rawPath || '') + '"' +
        ' title="Open include: ' + escapeAttr(fullCol.includeSource.rawPath || '') + '">&#128279;</button>';
    }

    var header = document.createElement('div');
    header.className = 'column-header';
    header.innerHTML =
      '<button class="column-fold-btn fold-btn" title="Fold column">\u25B6</button>' +
      '<span class="drag-grip">\u22EE\u22EE</span>' +
      '<span class="column-title">' + renderTitleInline(displayTitle, activeBoardId) + '</span>' +
      includeIndicator +
      '<span class="column-count">' + col.cards.length + '</span>' +
      '<span class="column-header-actions">' +
        '<button class="column-edit-btn" title="Edit column title">&#9998;</button>' +
        '<button class="column-menu-btn burger-menu-btn" title="Column options">' + BURGER_MENU_ICON_HTML + '</button>' +
      '</span>';
    (function (columnEl, colIdx, rIdx, sIdx, cIdx) {
      header.addEventListener('click', function (e) {
        var includeBadge = e.target.closest('.column-include-badge[data-include-path]');
        if (includeBadge) {
          e.preventDefault();
          e.stopPropagation();
          var includePath = includeBadge.getAttribute('data-include-path') || '';
          if (!includePath) return;
          if (e.altKey) openBoardFileInSystem(activeBoardId, includePath);
          else showBoardFilePreview(activeBoardId, includePath);
          return;
        }
        if (e.target.closest('.column-title')) return;
        if (e.target.closest('button, .drag-grip, .column-rename-input')) return;
        if (!e.altKey) return;
        e.stopPropagation();
        var nowFolded = !columnEl.classList.contains('folded');
        columnEl.classList.toggle('folded', nowFolded);
        saveFoldState(activeBoardId);
      });
      header.querySelector('.column-fold-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        var nowFolded = !columnEl.classList.contains('folded');
        columnEl.classList.toggle('folded', nowFolded);
        saveFoldState(activeBoardId);
      });
      header.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showColumnContextMenu(e.clientX, e.clientY, colIdx, {
          rowIdx: rIdx,
          stackIdx: sIdx,
          colLocalIdx: cIdx
        });
      });
      header.querySelector('.column-edit-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        enterColumnRename(columnEl, colIdx);
      });
      header.querySelector('.column-menu-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        var rect = this.getBoundingClientRect();
        showColumnContextMenu(rect.right, rect.bottom, colIdx, {
          rowIdx: rIdx,
          stackIdx: sIdx,
          colLocalIdx: cIdx
        });
      });
    })(colEl, col.index, rowIdx, stackIdx, colLocalIdx);
    colEl.appendChild(header);

    var cardsEl = document.createElement('div');
    cardsEl.className = 'column-cards';
    cardsEl.setAttribute('data-col-index', col.index.toString());
    for (var j = 0; j < col.cards.length; j++) {
      var card = col.cards[j];
      var cardId = String(card.id);
      var cardEl = document.createElement('div');
      cardEl.className = 'card' + (card.checked ? ' checked' : '');
      cardEl.setAttribute('data-col-index', col.index.toString());
      cardEl.setAttribute('data-card-index', j.toString());
      cardEl.setAttribute('data-card-id', cardId);
      if (card.kid) cardEl.setAttribute('data-card-kid', card.kid);
      var firstTag = getFirstTag(card.content);
      if (firstTag) cardEl.style.borderLeftColor = getTagColor(firstTag);
      var isCollapsed = collapsedCards.indexOf(cardId) !== -1;
      if (isCollapsed) cardEl.classList.add('collapsed');

      // --- Card Header Row ---
      var headerRow = document.createElement('div');
      headerRow.className = 'card-header';

      var dragHandle = document.createElement('div');
      dragHandle.className = 'card-drag-handle';
      dragHandle.textContent = '\u22EE\u22EE';
      dragHandle.title = 'Drag to move card';
      headerRow.appendChild(dragHandle);

      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'card-collapse-toggle fold-btn' + (isCollapsed ? '' : ' expanded');
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
      titleDisplay.innerHTML = renderTitleInline(getCardTitle(getIncludeResolvedContent(card.content, col.index)));
      titleContainer.appendChild(titleDisplay);
      headerRow.appendChild(titleContainer);

      var menuBtn = document.createElement('button');
      menuBtn.className = 'card-menu-btn burger-menu-btn';
      menuBtn.innerHTML = BURGER_MENU_ICON_HTML;
      menuBtn.title = 'Card options';
      headerRow.appendChild(menuBtn);

      cardEl.appendChild(headerRow);

      // --- Card Content Body ---
      var contentBody = document.createElement('div');
      contentBody.className = 'card-content';
      contentBody.innerHTML = renderCardContent(getIncludeResolvedContent(card.content, col.index), activeBoardId);
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

    var showInlineAddComposer = addCardColumn === col.index;
    var showEmptyColumnAddButton = col.cards.length === 0;
    if (showInlineAddComposer || showEmptyColumnAddButton) {
      var footer = document.createElement('div');
      footer.className = 'column-footer';

      if (showInlineAddComposer) {
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
            if (handleTextareaTabIndent(e, textarea)) return;
            if (e.key === 'Enter' && e.altKey) {
              e.preventDefault();
              e.stopPropagation();
              addCardColumn = null;
              renderColumns();
              return;
            }
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
        var cardSource = renderCreationSource('card', { colIndex: col.index }, {
          btnClass: 'add-card-btn',
          btnText: '+ Add card',
          wrapperClass: 'creation-source-card'
        });
        footer.appendChild(cardSource);
      }

      colEl.appendChild(footer);
    }
    return colEl;
  }

  function renderColumns() {
    try {
    vsTeardown();
    unfocusCard();
    // Defensive cleanup: stale drag artifacts can inflate row widths.
    cleanupPtrDrag();
    getElColumnsContainer().innerHTML = '';
    if (!activeBoardData) return;

    getElColumnsContainer().classList.add('new-format');
    renderNewFormatBoard();
    clearLayoutLockStyles();
    syncRenderedRowWidths();
    requestAnimationFrame(syncRenderedRowWidths);

    flushPendingDiagramQueues();

    enhanceEmbeddedContent(getElColumnsContainer());
    enhanceFileLinks(getElColumnsContainer());
    enhanceIncludeDirectives(getElColumnsContainer());
    enhanceColumnIncludeBadges(getElColumnsContainer());
    applyRenderedHtmlCommentVisibility(getElColumnsContainer(), currentHtmlCommentRenderMode);
    applyRenderedTagVisibility(getElColumnsContainer(), currentTagVisibilityMode);

    syncSidebarToView();
    updateCardEditingIndicators();

    vsActivate();
    } catch (err) {
      logFrontendIssue('error', 'render', 'Failed to render columns', err);
    }
  }

  /**
   * Render board with rows → stacks → columns hierarchy.
   */
  function renderNewFormatBoard() {
    var rows = activeBoardData.rows;
    var foldedCols = getFoldedColumns(activeBoardId);
    var foldedRows = getFoldedItems(activeBoardId, 'row');
    var foldedStacks = getFoldedItems(activeBoardId, 'stack');
    var collapsedCards = getCollapsedCards(activeBoardId, rows);

    if (!rows || rows.length === 0) {
      var emptyRows = document.createElement('div');
      emptyRows.className = 'board-level-empty board-level-empty-rows';
      emptyRows.appendChild(renderCreationSource('row', {}, { btnText: '+ Add row' }));
      getElColumnsContainer().appendChild(emptyRows);
      return;
    }

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var rowStacks = Array.isArray(row.stacks) ? row.stacks : [];
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
      var rowTitle = typeof row.title === 'string' ? row.title : '';
      var totalCards = 0;
      for (var si = 0; si < rowStacks.length; si++) {
        var cardCols = Array.isArray(rowStacks[si].columns) ? rowStacks[si].columns : [];
        for (var ci = 0; ci < cardCols.length; ci++) {
          var cards = Array.isArray(cardCols[ci].cards) ? cardCols[ci].cards : [];
          totalCards += cards.length;
        }
      }
      rowHeader.innerHTML =
        '<button class="row-fold-btn fold-btn" title="Fold row">\u25B6</button>' +
        '<span class="drag-grip">\u22EE\u22EE</span>' +
        '<span class="board-row-title">' + escapeHtml(rowTitle.length > 40 ? rowTitle.slice(0, 40) + '\u2026' : rowTitle) + '</span>' +
        '<span class="board-row-count">' + totalCards + '</span>' +
        '<span class="row-header-actions">' +
          '<button class="row-edit-btn" title="Edit row title">&#9998;</button>' +
          '<button class="row-menu-btn burger-menu-btn" title="Row options">' + BURGER_MENU_ICON_HTML + '</button>' +
        '</span>';
      (function (el, rowIdx) {
        function toggleRowFold(recursiveChildren) {
          var nowFolded = !el.classList.contains('folded');
          el.classList.toggle('folded', nowFolded);
          if (recursiveChildren) {
            setRowChildrenFoldState(el, nowFolded);
          }
          saveFoldState(activeBoardId);
        }
        rowHeader.addEventListener('click', function (e) {
          if (e.target.closest('.board-row-title')) return;
          if (e.target.closest('button, .drag-grip')) return;
          if (!e.altKey) return;
          e.stopPropagation();
          toggleRowFold(true);
        });
        rowHeader.querySelector('.row-fold-btn').addEventListener('click', function (e) {
          e.stopPropagation();
          toggleRowFold(!!e.altKey);
        });
        rowHeader.querySelector('.row-edit-btn').addEventListener('click', function (e) {
          e.stopPropagation();
          renameRowOrStack('row', rowIdx);
        });
        rowHeader.querySelector('.row-menu-btn').addEventListener('click', function (e) {
          e.stopPropagation();
          var rect = this.getBoundingClientRect();
          showRowContextMenu(rect.right, rect.bottom, rowIdx);
        });
        rowHeader.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          e.stopPropagation();
          showRowContextMenu(e.clientX, e.clientY, rowIdx);
        });
        // Row drag is handled by the pointer-based drag system (mousedown on getElColumnsContainer())
      })(rowEl, r);
      rowEl.appendChild(rowHeader);

      // Row DnD handled by the pointer-based drag system

      // Row content container
      var rowContent = document.createElement('div');
      rowContent.className = 'board-row-content';

      // Column-to-row drop handled by the pointer-based drag system

      if (rowStacks.length === 0) {
        var emptyStacks = document.createElement('div');
        emptyStacks.className = 'board-level-empty board-level-empty-stacks';
        (function (rowIdx) {
          emptyStacks.appendChild(renderCreationSource('stack', { rowIdx: rowIdx }, { btnText: '+ Add stack' }));
        })(r);
        rowContent.appendChild(emptyStacks);
      }

      for (var s = 0; s < rowStacks.length; s++) {
        var stack = rowStacks[s];
        var stackEl = document.createElement('div');
        stackEl.className = 'board-stack';
        stackEl.setAttribute('data-stack-title', stack.title);
        stackEl.setAttribute('data-row-index', r.toString());
        stackEl.setAttribute('data-stack-index', s.toString());
        var stackColumns = Array.isArray(stack.columns) ? stack.columns : [];
        var isEmptyStack = stackColumns.length === 0;
        if (foldedStacks.indexOf(stack.title) !== -1) {
          stackEl.classList.add('folded');
        }

        // Stack header
        var stackHeader = document.createElement('div');
        stackHeader.className = 'board-stack-header';
        var stackColCount = stackColumns.length;
        stackHeader.innerHTML =
          '<button class="stack-fold-btn fold-btn" title="Fold stack">\u25B6</button>' +
          '<span class="drag-grip">\u22EE\u22EE</span>' +
          '<span class="board-stack-title">' + (stack.title ? escapeHtml(stack.title.length > 40 ? stack.title.slice(0, 40) + '\u2026' : stack.title) : '&nbsp;') + '</span>' +
          '<span class="board-stack-count">' + stackColCount + '</span>' +
          '<span class="stack-header-actions">' +
            '<button class="stack-edit-btn" title="Edit stack title">&#9998;</button>' +
            '<button class="stack-menu-btn burger-menu-btn" title="Stack options">' + BURGER_MENU_ICON_HTML + '</button>' +
            (isEmptyStack ? '<button class="stack-delete-btn" title="Delete empty stack">\u00d7</button>' : '') +
          '</span>';
        (function (el, rIdx, sIdx) {
          function toggleStackFold(recursiveChildren) {
            var nowFolded = !el.classList.contains('folded');
            el.classList.toggle('folded', nowFolded);
            if (recursiveChildren) {
              setStackChildrenFoldState(el, nowFolded);
            }
            saveFoldState(activeBoardId);
          }
          var deleteBtn = stackHeader.querySelector('.stack-delete-btn');
          if (deleteBtn) {
            deleteBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              deleteStack(rIdx, sIdx);
            });
          }
          stackHeader.addEventListener('click', function (e) {
            if (e.target.closest('.board-stack-title')) return;
            if (e.target.closest('button, .drag-grip, .column-rename-input')) return;
            if (!e.altKey) return;
            e.stopPropagation();
            toggleStackFold(true);
          });
          stackHeader.querySelector('.stack-fold-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            toggleStackFold(!!e.altKey);
          });
          stackHeader.querySelector('.stack-edit-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            renameRowOrStack('stack', rIdx, sIdx);
          });
          stackHeader.querySelector('.stack-menu-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            var rect = this.getBoundingClientRect();
            showStackContextMenu(rect.right, rect.bottom, rIdx, sIdx);
          });
          stackHeader.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            e.stopPropagation();
            showStackContextMenu(e.clientX, e.clientY, rIdx, sIdx);
          });
          // Stack drag is handled by the pointer-based drag system
        })(stackEl, r, s);
        stackEl.appendChild(stackHeader);

        // Stack DnD handled by the pointer-based drag system

        // Stack content container
        var stackContent = document.createElement('div');
        stackContent.className = 'board-stack-content';

        if (stackColumns.length === 0) {
          var emptyColumns = document.createElement('div');
          emptyColumns.className = 'board-level-empty board-level-empty-columns';
          (function (rowIdx, stackIdx) {
            emptyColumns.appendChild(renderCreationSource('column', { rowIdx: rowIdx, stackIdx: stackIdx }, { btnText: '+ Add column' }));
          })(r, s);
          stackContent.appendChild(emptyColumns);
        }

        for (var c = 0; c < stackColumns.length; c++) {
          var col = stackColumns[c];
          var colEl = buildColumnElement(col, foldedCols, collapsedCards, r, s, c);
          // Column drag via grip is handled by the pointer-based drag system
          // Column DnD handled by the pointer-based drag system
          stackContent.appendChild(colEl);
        }

        stackEl.appendChild(stackContent);
        rowContent.appendChild(stackEl);
      }

      rowEl.appendChild(rowContent);
      getElColumnsContainer().appendChild(rowEl);
    }
  }


  async function moveColumnWithinBoard(fromRowIdx, fromStackIdx, fromColIdx, toRowIdx, toStackIdx, toColIdx, insertBefore) {
    if (!fullBoardData) return;
    var fromRow = findFullDataRow(fromRowIdx);
    var toRow = findFullDataRow(toRowIdx);
    if (!fromRow || !toRow) return;
    var fromStack = findFullDataStack(fromRowIdx, fromStackIdx);
    var toStack = findFullDataStack(toRowIdx, toStackIdx);
    if (!fromStack || !toStack) return;

    var fromFullColIdx = findFullColumnIndexInStack(fromStack, fromColIdx);
    if (fromFullColIdx === -1) return;

    var insertAt = findInsertColumnIndexInStack(toStack, toColIdx, insertBefore);
    if (fromStack === toStack && fromFullColIdx < insertAt) insertAt--;
    if (fromStack === toStack && insertAt === fromFullColIdx) return;

    pushUndo();
    var moved = fromStack.columns.splice(fromFullColIdx, 1)[0];
    if (insertAt < 0) insertAt = 0;
    if (insertAt > toStack.columns.length) insertAt = toStack.columns.length;
    toStack.columns.splice(insertAt, 0, moved);

    removeEmptyStacksAndRows();

    await persistBoardMutation({ refreshSidebar: true });
  }

  async function moveColumnToExistingStack(fromRowIdx, fromStackIdx, fromColIdx, toRowIdx, toStackIdx) {
    if (!fullBoardData) return;
    var fromRow = findFullDataRow(fromRowIdx);
    var toRow = findFullDataRow(toRowIdx);
    if (!fromRow || !toRow) return;
    var fromStack = findFullDataStack(fromRowIdx, fromStackIdx);
    var toStack = findFullDataStack(toRowIdx, toStackIdx);
    if (!fromStack || !toStack) return;
    if (fromStack === toStack) return;

    var fromFullColIdx = findFullColumnIndexInStack(fromStack, fromColIdx);
    if (fromFullColIdx === -1) return;

    pushUndo();
    var moved = fromStack.columns.splice(fromFullColIdx, 1)[0];
    toStack.columns.push(moved);

    removeEmptyStacksAndRows();

    await persistBoardMutation({ refreshSidebar: true });
  }

  async function moveColumnToNewStack(fromRowIdx, fromStackIdx, fromColIdx, toRowIdx, insertAtStackIdx) {
    if (!fullBoardData) return;
    var fromRow = findFullDataRow(fromRowIdx);
    var toRow = findFullDataRow(toRowIdx);
    if (!fromRow || !toRow) return;
    var fromStack = findFullDataStack(fromRowIdx, fromStackIdx);
    if (!fromStack) return;

    var fromFullColIdx = findFullColumnIndexInStack(fromStack, fromColIdx);
    if (fromFullColIdx === -1) return;

    pushUndo();
    var moved = fromStack.columns.splice(fromFullColIdx, 1)[0];

    // Create a new stack with this column (empty title by default)
    var newStack = {
      id: 'stack-' + Date.now(),
      title: '',
      columns: [moved]
    };
    if (insertAtStackIdx != null) {
      // insertAtStackIdx is a display index — convert to fullBoardData index
      var fullInsertAt = findInsertStackIndexInRow(toRow, toRowIdx, insertAtStackIdx);
      toRow.stacks.splice(fullInsertAt, 0, newStack);
    } else {
      toRow.stacks.push(newStack);
    }

    removeEmptyStacksAndRows();

    await persistBoardMutation({ refreshSidebar: true });
  }

  // --- New-format DnD mutations ---

  async function reorderRows(sourceIdx, targetIdx, insertBefore) {
    if (!fullBoardData) return;

    var sourceFullIdx = findFullDataRowIndex(sourceIdx);
    var targetFullIdx = findFullDataRowIndex(targetIdx);
    if (sourceFullIdx === -1 || targetFullIdx === -1 || sourceFullIdx === targetFullIdx) return;

    var insertAt = targetFullIdx;
    if (sourceFullIdx < targetFullIdx) insertAt--;
    if (!insertBefore) insertAt++;
    if (insertAt === sourceFullIdx) return;

    pushUndo();
    var moved = fullBoardData.rows.splice(sourceFullIdx, 1)[0];
    fullBoardData.rows.splice(insertAt, 0, moved);
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function moveStack(fromRowIdx, fromStackIdx, toRowIdx, toStackIdx, insertBefore) {
    if (!fullBoardData) return;

    // Map display indices to fullBoardData row indices
    var fromRow = findFullDataRow(fromRowIdx);
    var toRow = findFullDataRow(toRowIdx);
    if (!fromRow || !toRow) return;
    var fromFullStackIdx = findFullDataStackIndex(fromRow, fromRowIdx, fromStackIdx);
    var toFullStackIdx = findFullDataStackIndex(toRow, toRowIdx, toStackIdx);
    if (fromFullStackIdx === -1 || toFullStackIdx === -1) return;
    var insertAt = toFullStackIdx;
    if (fromRow === toRow && fromFullStackIdx < toFullStackIdx) insertAt--;
    if (!insertBefore) insertAt++;
    if (fromRow === toRow && insertAt === fromFullStackIdx) return;

    pushUndo();
    var moved = fromRow.stacks.splice(fromFullStackIdx, 1)[0];
    if (insertAt < 0) insertAt = 0;
    if (insertAt > toRow.stacks.length) insertAt = toRow.stacks.length;
    toRow.stacks.splice(insertAt, 0, moved);
    removeEmptyStacksAndRows();

    await persistBoardMutation({ refreshSidebar: true });
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
    if (!row || !activeBoardData || !activeBoardData.rows || displayRowIdx < 0 || displayRowIdx >= activeBoardData.rows.length) return null;
    var displayRow = activeBoardData.rows[displayRowIdx];
    if (!displayRow || displayStackIdx < 0 || displayStackIdx >= displayRow.stacks.length) return null;
    var displayStack = displayRow.stacks[displayStackIdx];
    for (var i = 0; i < row.stacks.length; i++) {
      if (row.stacks[i].id === displayStack.id) return row.stacks[i];
    }
    return null;
  }

  function findFullDataRowIndex(displayRowIdx) {
    if (!activeBoardData || !activeBoardData.rows || displayRowIdx < 0 || displayRowIdx >= activeBoardData.rows.length) return -1;
    var displayRow = activeBoardData.rows[displayRowIdx];
    for (var i = 0; i < fullBoardData.rows.length; i++) {
      if (fullBoardData.rows[i].id === displayRow.id) return i;
    }
    return -1;
  }

  function findInsertRowIndex(displayInsertAtIdx) {
    if (!fullBoardData || !fullBoardData.rows) return 0;
    if (!activeBoardData || !activeBoardData.rows || displayInsertAtIdx >= activeBoardData.rows.length) {
      return fullBoardData.rows.length;
    }
    if (displayInsertAtIdx <= 0) {
      var first = activeBoardData.rows[0];
      if (first && first.id) {
        for (var i = 0; i < fullBoardData.rows.length; i++) {
          if (fullBoardData.rows[i].id === first.id) return i;
        }
      }
      return 0;
    }
    var target = activeBoardData.rows[displayInsertAtIdx];
    if (target && target.id) {
      for (var i = 0; i < fullBoardData.rows.length; i++) {
        if (fullBoardData.rows[i].id === target.id) return i;
      }
    }
    return fullBoardData.rows.length;
  }

  function visibleColumnIndicesInStack(stack) {
    var result = [];
    if (!stack || !stack.columns) return result;
    for (var i = 0; i < stack.columns.length; i++) {
      if (!is_archived_or_deleted(stack.columns[i].title)) {
        result.push(i);
      }
    }
    return result;
  }

  function findFullDataStackIndex(fullRow, displayRowIdx, displayStackIdx) {
    if (!fullRow || !activeBoardData || !activeBoardData.rows || displayRowIdx < 0 || displayRowIdx >= activeBoardData.rows.length) return -1;
    var displayRow = activeBoardData.rows[displayRowIdx];
    if (!displayRow || displayStackIdx < 0 || displayStackIdx >= displayRow.stacks.length) return -1;
    var displayStack = displayRow.stacks[displayStackIdx];

    if (displayStack.id) {
      for (var i = 0; i < fullRow.stacks.length; i++) {
        if (fullRow.stacks[i].id === displayStack.id) return i;
      }
    }

    // Fallback when IDs are missing: map by visible stack order.
    var visibleStackIdx = -1;
    for (var i = 0; i < fullRow.stacks.length; i++) {
      if (visibleColumnIndicesInStack(fullRow.stacks[i]).length === 0) continue;
      visibleStackIdx++;
      if (visibleStackIdx === displayStackIdx) return i;
    }
    return -1;
  }

  function findFullColumnIndexInStack(stack, displayColIdx) {
    if (!stack || displayColIdx < 0) return -1;
    var visible = visibleColumnIndicesInStack(stack);
    return displayColIdx < visible.length ? visible[displayColIdx] : -1;
  }

  function findInsertStackIndexInRow(fullRow, displayRowIdx, displayInsertAtIdx) {
    if (!fullRow || !fullRow.stacks) return 0;
    if (!activeBoardData || !activeBoardData.rows || displayRowIdx < 0 || displayRowIdx >= activeBoardData.rows.length) {
      return fullRow.stacks.length;
    }
    var displayRow = activeBoardData.rows[displayRowIdx];
    if (!displayRow || !displayRow.stacks || displayInsertAtIdx >= displayRow.stacks.length) {
      return fullRow.stacks.length;
    }
    if (displayInsertAtIdx <= 0) {
      // Insert before the first visible stack
      var first = displayRow.stacks[0];
      if (first && first.id) {
        for (var i = 0; i < fullRow.stacks.length; i++) {
          if (fullRow.stacks[i].id === first.id) return i;
        }
      }
      return 0;
    }
    // Insert before the display stack at displayInsertAtIdx
    var target = displayRow.stacks[displayInsertAtIdx];
    if (target && target.id) {
      for (var i = 0; i < fullRow.stacks.length; i++) {
        if (fullRow.stacks[i].id === target.id) return i;
      }
    }
    return fullRow.stacks.length;
  }

  function findInsertColumnIndexInStack(stack, displayColIdx, insertBefore) {
    if (!stack) return -1;
    var visible = visibleColumnIndicesInStack(stack);
    if (displayColIdx < 0 || displayColIdx >= visible.length) {
      return stack.columns.length;
    }
    return insertBefore ? visible[displayColIdx] : (visible[displayColIdx] + 1);
  }

  async function addColumnRelativeToDisplayPosition(displayRowIdx, displayStackIdx, displayColIdx, insertBefore) {
    var stack = findFullDataStack(displayRowIdx, displayStackIdx);
    if (!stack) {
      traceFrontendAction('warn', 'column.insert.relative', 'Failed to resolve stack for display-relative insert', {
        boardId: activeBoardId || null,
        displayRowIdx: displayRowIdx,
        displayStackIdx: displayStackIdx,
        displayColIdx: displayColIdx,
        insertBefore: !!insertBefore
      });
      return false;
    }
    var visibleIndices = visibleColumnIndicesInStack(stack);
    var insertAt = findInsertColumnIndexInStack(stack, displayColIdx, insertBefore);
    if (insertAt < 0) {
      traceFrontendAction('warn', 'column.insert.relative', 'Failed to compute insert index for display-relative insert', {
        boardId: activeBoardId || null,
        displayRowIdx: displayRowIdx,
        displayStackIdx: displayStackIdx,
        displayColIdx: displayColIdx,
        insertBefore: !!insertBefore,
        stackId: stack.id || null,
        visibleIndices: visibleIndices
      });
      return false;
    }
    traceFrontendAction('info', 'column.insert.relative', 'Resolved display-relative insert position', {
      boardId: activeBoardId || null,
      displayRowIdx: displayRowIdx,
      displayStackIdx: displayStackIdx,
      displayColIdx: displayColIdx,
      insertBefore: !!insertBefore,
      stackId: stack.id || null,
      stackTitle: stack.title || '',
      insertAt: insertAt,
      visibleIndices: visibleIndices
    });
    return addColumnToStack(displayRowIdx, displayStackIdx, insertAt);
  }

  function removeEmptyStacksAndRowsInBoard(boardData) {
    if (!boardData || !boardData.rows) return;
    for (var r = boardData.rows.length - 1; r >= 0; r--) {
      var row = boardData.rows[r];
      if (!row.stacks) row.stacks = [];
      // Keep empty stacks — they persist with their title
      if (row.stacks.length === 0) {
        boardData.rows.splice(r, 1);
      }
    }
  }

  function removeEmptyStacksAndRows() {
    removeEmptyStacksAndRowsInBoard(fullBoardData);
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
    var row = findFullDataRow(rowIdx);
    var rowTitle = row ? (row.title || '') : '';

    var nativeItems = [
      { id: 'reveal-all', label: 'Reveal all' },
      { id: 'insert-before', label: 'Insert row before' },
      { id: 'insert-after', label: 'Insert row after' },
      { id: 'duplicate', label: 'Duplicate row' },
      { separator: true },
      { id: 'park', label: 'Park row' },
      { id: 'archive', label: 'Archive row' },
      { id: 'delete', label: 'Delete row' },
      { separator: true },
      buildTagSubmenu('Special', TAG_CATEGORIES.special, rowTitle, 'tag-special-'),
      buildTagSubmenu('Positivity', TAG_CATEGORIES.positivity, rowTitle, 'tag-pos-'),
      buildTagSubmenu('Colors', TAG_CATEGORIES.colors, rowTitle, 'tag-color-'),
      buildTagSubmenu('Workflow', TAG_CATEGORIES.workflow, rowTitle, 'tag-wf-'),
      buildTagSubmenu('Complexity', TAG_CATEGORIES.complexity, rowTitle, 'tag-cx-'),
    ];
    var customSub = buildCustomTagsSubmenu(rowTitle, 'tag-custom-');
    if (customSub) nativeItems.push(customSub);
    nativeItems = nativeItems.concat(buildMarpPlaceholders());
    nativeItems.push({ separator: true });
    nativeItems.push({ id: 'copy-markdown', label: 'Copy as markdown' });

    showNativeMenu(nativeItems, x, y, 'row.menu').then(function (action) {
      if (!action) return;
      return handleRowAction(action, rowIdx);
    }).catch(function (err) {
      logFrontendIssue('error', 'row.menu', 'handleRowAction failed', err);
    });
  }

  function showStackContextMenu(x, y, rowIdx, stackIdx) {
    closeRowStackMenu();
    closeColumnContextMenu();
    closeCardContextMenu();
    var stack = findFullDataStack(rowIdx, stackIdx);
    var stackTitle = stack ? (stack.title || '') : '';

    var nativeItems = [
      { id: 'reveal-all', label: 'Reveal all' },
      { id: 'insert-before', label: 'Insert stack before' },
      { id: 'insert-after', label: 'Insert stack after' },
      { id: 'duplicate', label: 'Duplicate stack' },
      { separator: true },
      { id: 'park', label: 'Park stack' },
      { id: 'archive', label: 'Archive stack' },
      { id: 'delete', label: 'Delete stack' },
      { separator: true },
      buildTagSubmenu('Special', TAG_CATEGORIES.special, stackTitle, 'tag-special-'),
      buildTagSubmenu('Positivity', TAG_CATEGORIES.positivity, stackTitle, 'tag-pos-'),
      buildTagSubmenu('Colors', TAG_CATEGORIES.colors, stackTitle, 'tag-color-'),
      buildTagSubmenu('Workflow', TAG_CATEGORIES.workflow, stackTitle, 'tag-wf-'),
      buildTagSubmenu('Complexity', TAG_CATEGORIES.complexity, stackTitle, 'tag-cx-'),
    ];
    var customSub = buildCustomTagsSubmenu(stackTitle, 'tag-custom-');
    if (customSub) nativeItems.push(customSub);
    nativeItems = nativeItems.concat(buildMarpPlaceholders());
    nativeItems.push({ separator: true });
    nativeItems.push({ id: 'copy-markdown', label: 'Copy as markdown' });

    showNativeMenu(nativeItems, x, y, 'stack.menu').then(function (action) {
      if (!action) return;
      return handleStackAction(action, rowIdx, stackIdx);
    }).catch(function (err) {
      logFrontendIssue('error', 'stack.menu', 'handleStackAction failed', err);
    });
  }

  async function handleRowAction(action, rowIdx) {
    if (action === 'reveal-all') {
      revealRowContent(rowIdx);
    } else if (action === 'insert-before') {
      await addRow(rowIdx);
    } else if (action === 'insert-after') {
      await addRow(rowIdx + 1);
    } else if (action === 'duplicate') {
      await duplicateRow(rowIdx);
    } else if (action === 'park') {
      await setRowHiddenTag(rowIdx, '#hidden-internal-parked');
    } else if (action === 'archive') {
      await setRowHiddenTag(rowIdx, '#hidden-internal-archived');
    } else if (action === 'delete') {
      await deleteRow(rowIdx);
    } else if (action === 'copy-markdown') {
      copyElementAsMarkdown('row', { rowIdx: rowIdx });
    } else if (action.indexOf('tag-') === 0) {
      var tagMatch = action.match(/^tag-(?:special|pos|color|wf|cx|custom)-(.+)$/);
      if (tagMatch) await toggleTag('row', { rowIdx: rowIdx }, '#' + tagMatch[1]);
    }
  }

  async function handleStackAction(action, rowIdx, stackIdx) {
    if (action === 'reveal-all') {
      revealStackContent(rowIdx, stackIdx);
    } else if (action === 'insert-before') {
      await addStackToRow(rowIdx, stackIdx);
    } else if (action === 'insert-after') {
      await addStackToRow(rowIdx, stackIdx + 1);
    } else if (action === 'duplicate') {
      await duplicateStack(rowIdx, stackIdx);
    } else if (action === 'park') {
      await setStackHiddenTag(rowIdx, stackIdx, '#hidden-internal-parked');
    } else if (action === 'archive') {
      await setStackHiddenTag(rowIdx, stackIdx, '#hidden-internal-archived');
    } else if (action === 'delete') {
      await deleteStack(rowIdx, stackIdx);
    } else if (action === 'copy-markdown') {
      copyElementAsMarkdown('stack', { rowIdx: rowIdx, stackIdx: stackIdx });
    } else if (action.indexOf('tag-') === 0) {
      var tagMatch = action.match(/^tag-(?:special|pos|color|wf|cx|custom)-(.+)$/);
      if (tagMatch) await toggleTag('stack', { rowIdx: rowIdx, stackIdx: stackIdx }, '#' + tagMatch[1]);
    }
  }

  function renameRowOrStack(type, rowIdx, stackIdx) {
    var rootSelector = type === 'row'
      ? '.board-row[data-row-index="' + rowIdx + '"]'
      : '.board-stack[data-row-index="' + rowIdx + '"][data-stack-index="' + stackIdx + '"]';
    var rootEl = getElColumnsContainer().querySelector(rootSelector);
    if (!rootEl) return;

    var titleSelector = type === 'row' ? '.board-row-title' : '.board-stack-title';
    var titleEl = rootEl.querySelector(titleSelector);
    if (!titleEl) return;
    var target = type === 'row' ? findFullDataRow(rowIdx) : findFullDataStack(rowIdx, stackIdx);
    if (!target) return;

    var headerSelector = type === 'row' ? '.board-row-header' : '.board-stack-header';
    var headerEl = rootEl.querySelector(headerSelector);
    var currentTitle = target.title;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'column-rename-input';
    if (type === 'row') input.classList.add('row-rename-input');
    input.value = currentTitle;
    if (headerEl) headerEl.classList.add('title-editing');
    titleEl.textContent = '';
    titleEl.appendChild(input);
    input.focus();
    input.select();

    var done = false;
    function cleanup() {
      if (headerEl) headerEl.classList.remove('title-editing');
    }
    function getDisplayTitle(title) {
      return title.length > 40 ? title.slice(0, 40) + '\u2026' : title;
    }
    function save() {
      if (done) return;
      done = true;
      var newTitle = input.value.trim();
      cleanup();
      if (newTitle && newTitle !== currentTitle) {
        titleEl.textContent = getDisplayTitle(newTitle);
        pushUndo();
        target.title = newTitle;
        persistBoardMutation();
      } else {
        titleEl.textContent = getDisplayTitle(currentTitle);
      }
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        input.value = currentTitle;
        save();
      }
    });
  }

  // ── Creation Source (template-aware add buttons) ───────────────────────

  var templatesLoaded = false;

  function loadTemplatesOnce() {
    if (templatesLoaded) return;
    templatesLoaded = true;
    LexeraTemplates.loadTemplates().catch(function (err) {
      logFrontendIssue('warn', 'templates.load', 'Failed to load templates', err);
    });
  }

  /**
   * Build a creation-source dropdown wrapper around an add button.
   * @param {string} entityType - "card"|"column"|"stack"|"row"
   * @param {object} context - { colIndex, rowIdx, stackIdx } as needed
   * @param {object} options - { btnClass, btnText, wrapperClass }
   * @returns {HTMLElement} .creation-source element
   */
  function renderCreationSource(entityType, context, options) {
    options = options || {};
    var wrapper = document.createElement('div');
    wrapper.className = 'creation-source' + (options.wrapperClass ? ' ' + options.wrapperClass : '');

    var btn = document.createElement('button');
    btn.className = options.btnClass || 'add-entity-btn';
    btn.textContent = options.btnText || ('+ Add ' + entityType);
    wrapper.appendChild(btn);

    if (entityType !== 'card' && entityType !== 'column') {
      var dropdown = document.createElement('div');
      dropdown.className = 'creation-dropdown';

      // "Empty" item — always present
      var emptyItem = document.createElement('div');
      emptyItem.className = 'creation-item';
      emptyItem.textContent = 'Empty ' + entityType.charAt(0).toUpperCase() + entityType.slice(1);
      emptyItem.addEventListener('click', function (e) {
        e.stopPropagation();
        handleCreationAction(entityType, 'empty', context);
      });
      dropdown.appendChild(emptyItem);

      // "From Clipboard" item
      var clipItem = document.createElement('div');
      clipItem.className = 'creation-item';
      clipItem.textContent = 'From Clipboard';
      clipItem.addEventListener('click', function (e) {
        e.stopPropagation();
        handleCreationAction(entityType, 'clipboard', context);
      });
      dropdown.appendChild(clipItem);

      // Template items
      var templates = LexeraTemplates.getTemplatesForType(entityType);
      if (templates.length > 0) {
        var sep = document.createElement('div');
        sep.className = 'creation-sep';
        dropdown.appendChild(sep);

        for (var i = 0; i < templates.length; i++) {
          (function (tpl) {
            var tplItem = document.createElement('div');
            tplItem.className = 'creation-item';
            tplItem.textContent = tpl.name;
            tplItem.addEventListener('click', function (e) {
              e.stopPropagation();
              handleCreationAction(entityType, 'template:' + tpl.id, context);
            });
            dropdown.appendChild(tplItem);
          })(templates[i]);
        }
      }

      wrapper.appendChild(dropdown);
    }

    // Direct click on button = empty creation (original behavior)
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      handleCreationAction(entityType, 'empty', context);
    });

    return wrapper;
  }

  /**
   * Dispatch creation action for a given entity type.
   */
  async function handleCreationAction(entityType, action, context) {
    traceFrontendAction('info', 'creation.action', 'Dispatching creation action', {
      boardId: activeBoardId || null,
      entityType: entityType,
      action: action,
      context: context || null
    });
    if (entityType === 'card') {
      if (action !== 'empty') {
        traceFrontendAction('warn', 'card.create', 'Ignoring non-empty card creation action and creating a blank card instead', {
          boardId: activeBoardId || null,
          action: action,
          context: context || null
        });
      }
      return addEmptyCardToActiveBoard(context && context.colIndex);
    }
    if (action === 'empty') {
      if (entityType === 'row') {
        addRow(context.atIndex);
      } else if (entityType === 'stack') {
        addStackToRow(context.rowIdx);
      } else if (entityType === 'column') {
        addColumnToStack(context.rowIdx, context.stackIdx);
      }
      return;
    }

    if (action === 'clipboard') {
      try {
        var text = await navigator.clipboard.readText();
        if (!text || !text.trim()) {
          lexeraLog('warn', 'Clipboard is empty');
          return;
        }
        if (entityType === 'card' && context.colIndex !== undefined && activeBoardId) {
          await addCardToActiveBoard(context.colIndex, text.trim());
        } else if (entityType === 'row') {
          await addRowFromContent(text.trim());
        } else if (entityType === 'stack') {
          await addStackFromContent(context.rowIdx, text.trim());
        } else if (entityType === 'column') {
          await addColumnFromContent(context.rowIdx, context.stackIdx, text.trim());
        }
      } catch (err) {
        lexeraLog('warn', 'Clipboard read failed: ' + err.message);
      }
      return;
    }

    // template:id
    if (action.indexOf('template:') === 0) {
      var templateId = action.substring(9);
      try {
        var tplData = await LexeraTemplates.getFullTemplate(templateId);
        var parsed = tplData.parsed;
        var values = {};

        if (parsed.variables && parsed.variables.length > 0) {
          values = await LexeraTemplates.showVariableDialog(parsed.name, parsed.variables);
          if (values === null) return; // cancelled
        }
        values = LexeraTemplates.applyDefaults(parsed.variables, values);

        // Copy extra template files if any
        if (tplData.files.length > 0 && activeBoardId) {
          LexeraApi.request('/templates/' + encodeURIComponent(templateId) + '/copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ board_id: activeBoardId, variables: values })
          }).catch(function (err) {
            lexeraLog('warn', 'Template file copy failed: ' + err.message);
          });
        }

        // Build entity and insert
        if (entityType === 'card') {
          var card = LexeraTemplates.buildCardFromTemplate(parsed, values);
          if (activeBoardId && context.colIndex !== undefined) {
            await addCardToActiveBoard(context.colIndex, card.content);
          }
        } else if (entityType === 'column') {
          var cols = LexeraTemplates.buildColumnFromTemplate(parsed, values);
          insertTemplateColumns(context.rowIdx, context.stackIdx, cols);
        } else if (entityType === 'stack') {
          var stack = LexeraTemplates.buildStackFromTemplate(parsed, values);
          insertTemplateStack(context.rowIdx, stack);
        } else if (entityType === 'row') {
          var row = LexeraTemplates.buildRowFromTemplate(parsed, values);
          insertTemplateRow(context.atIndex, row);
        }
      } catch (err) {
        lexeraLog('error', 'Template apply failed: ' + err.message);
      }
    }
  }

  // ── Template insertion helpers ────────────────────────────────────────

  async function addRowFromContent(text) {
    if (!fullBoardData) return;
    if (!Array.isArray(fullBoardData.rows)) fullBoardData.rows = [];
    pushUndo();
    var ts = Date.now();
    var card = { id: 'card-' + ts, content: text, checked: false };
    var newRow = {
      id: 'row-' + ts,
      title: 'New Row',
      stacks: [{ id: 'stack-' + ts, title: 'Default', columns: [{ id: 'col-' + ts, title: 'New Column', cards: [card] }] }]
    };
    fullBoardData.rows.push(newRow);
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function addStackFromContent(rowIdx, text) {
    var row = findFullDataRow(rowIdx);
    if (!row) return;
    pushUndo();
    var ts = Date.now();
    var card = { id: 'card-' + ts, content: text, checked: false };
    row.stacks.push({ id: 'stack-' + ts, title: 'New Stack', columns: [{ id: 'col-' + ts, title: 'New Column', cards: [card] }] });
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function addColumnFromContent(rowIdx, stackIdx, text) {
    var stack = findFullDataStack(rowIdx, stackIdx);
    if (!stack) return;
    pushUndo();
    var ts = Date.now();
    var card = { id: 'card-' + ts, content: text, checked: false };
    stack.columns.push({ id: 'col-' + ts, title: 'New Column', cards: [card] });
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function insertTemplateColumns(rowIdx, stackIdx, cols) {
    var stack = findFullDataStack(rowIdx, stackIdx);
    if (!stack) return;
    pushUndo();
    for (var i = 0; i < cols.length; i++) {
      stack.columns.push(cols[i]);
    }
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function insertTemplateStack(rowIdx, stack) {
    var row = findFullDataRow(rowIdx);
    if (!row) return;
    pushUndo();
    row.stacks.push(stack);
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function insertTemplateRow(atIndex, row) {
    if (!fullBoardData) return;
    if (!Array.isArray(fullBoardData.rows)) fullBoardData.rows = [];
    pushUndo();
    if (typeof atIndex !== 'number' || isNaN(atIndex)) atIndex = fullBoardData.rows.length;
    if (atIndex < 0) atIndex = 0;
    if (atIndex > fullBoardData.rows.length) atIndex = fullBoardData.rows.length;
    fullBoardData.rows.splice(atIndex, 0, row);
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function addRow(atIndex) {
    if (!fullBoardData) {
      traceFrontendAction('warn', 'row.create', 'Aborted add row because fullBoardData is missing', {
        boardId: activeBoardId || null,
        atIndex: atIndex
      });
      return false;
    }
    if (!Array.isArray(fullBoardData.rows)) fullBoardData.rows = [];

    pushUndo();
    var ts = Date.now();
    var newRow = {
      id: 'row-' + ts,
      title: 'New Row',
      stacks: [{ id: 'stack-' + ts, title: 'Default', columns: [{ id: 'col-' + ts, title: 'New Column', cards: [] }] }]
    };
    var insertAt;
    if (typeof atIndex !== 'number' || isNaN(atIndex)) {
      insertAt = fullBoardData.rows.length;
    } else {
      // atIndex is a display index — convert to fullBoardData index
      insertAt = findInsertRowIndex(atIndex);
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > fullBoardData.rows.length) insertAt = fullBoardData.rows.length;
    traceFrontendAction('info', 'row.create', 'Inserting new row', {
      boardId: activeBoardId || null,
      atIndex: insertAt,
      rowId: newRow.id,
      summaryBefore: summarizeBoardHierarchy(fullBoardData)
    });
    fullBoardData.rows.splice(insertAt, 0, newRow);
    var saved = await persistBoardMutation({ refreshSidebar: true });
    traceFrontendAction(saved ? 'info' : 'warn', 'row.create', saved ? 'Persisted new row' : 'Row persist reported failure', {
      boardId: activeBoardId || null,
      atIndex: atIndex,
      rowId: newRow.id,
      summaryAfter: summarizeBoardHierarchy(fullBoardData)
    });
    return saved;
  }

  async function setRowHiddenTag(displayRowIdx, tag) {
    if (!fullBoardData || !activeBoardId) return;
    var row = findFullDataRow(displayRowIdx);
    if (!row) return;
    var nextTitle = applyInternalHiddenTag(row.title || '', tag);
    if (nextTitle === row.title) return;
    pushUndo();
    row.title = nextTitle;
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  async function deleteRow(rowIdx) {
    traceFrontendAction('info', 'row.delete', 'deleteRow called', { rowIdx: rowIdx });
    var row = findFullDataRow(rowIdx);
    if (!row) {
      traceFrontendAction('warn', 'row.delete', 'findFullDataRow returned null', { rowIdx: rowIdx });
      return;
    }
    var visibleCards = 0;
    for (var s = 0; s < row.stacks.length; s++) {
      for (var c = 0; c < row.stacks[s].columns.length; c++) {
        var cards = row.stacks[s].columns[c].cards || [];
        for (var k = 0; k < cards.length; k++) {
          if (!is_archived_or_deleted(cards[k].content || '')) visibleCards++;
        }
      }
    }
    if (visibleCards > 0) {
      var confirmed = await showConfirmDialog('Move row "' + stripInternalHiddenTags(row.title || '') + '" and ' + visibleCards + ' card(s) to trash?');
      if (!confirmed) return;
    }
    await setRowHiddenTag(rowIdx, '#hidden-internal-deleted');
  }

  async function duplicateRow(rowIdx) {
    if (!fullBoardData || !activeBoardId) return;
    var row = findFullDataRow(rowIdx);
    if (!row) return;
    pushUndo();
    var clone = JSON.parse(JSON.stringify(row));
    var ts = Date.now();
    clone.id = 'row-' + ts;
    for (var s = 0; s < clone.stacks.length; s++) {
      clone.stacks[s].id = 'stack-' + ts + '-' + s;
      for (var c = 0; c < clone.stacks[s].columns.length; c++) {
        clone.stacks[s].columns[c].id = 'col-' + ts + '-' + s + '-' + c;
        for (var k = 0; k < clone.stacks[s].columns[c].cards.length; k++) {
          clone.stacks[s].columns[c].cards[k].id = 'dup-' + ts + '-' + s + '-' + c + '-' + k;
          clone.stacks[s].columns[c].cards[k].kid = null;
        }
      }
    }
    var fullRowIdx = fullBoardData.rows.indexOf(row);
    if (fullRowIdx === -1) fullRowIdx = fullBoardData.rows.length - 1;
    fullBoardData.rows.splice(fullRowIdx + 1, 0, clone);
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function addStackToRow(rowIdx, atStackIdx) {

    var row = findFullDataRow(rowIdx);
    if (!row) {
      traceFrontendAction('warn', 'stack.create', 'Aborted add stack because row could not be resolved', {
        boardId: activeBoardId || null,
        rowIdx: rowIdx,
        atStackIdx: atStackIdx
      });
      return false;
    }
    if (!Array.isArray(row.stacks)) row.stacks = [];
    pushUndo();
    var ts = Date.now();
    var newStack = {
      id: 'stack-' + ts,
      title: 'New Stack',
      columns: [{ id: 'col-' + ts, title: 'New Column', cards: [] }]
    };
    var insertAt = row.stacks.length;
    if (typeof atStackIdx === 'number' && !isNaN(atStackIdx)) {
      // atStackIdx is a display index — convert to fullBoardData index
      insertAt = findInsertStackIndexInRow(row, rowIdx, atStackIdx);
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > row.stacks.length) insertAt = row.stacks.length;
    traceFrontendAction('info', 'stack.create', 'Inserting new stack', {
      boardId: activeBoardId || null,
      rowIdx: rowIdx,
      rowId: row.id || null,
      rowTitle: row.title || '',
      insertAt: insertAt,
      stackId: newStack.id
    });
    row.stacks.splice(insertAt, 0, newStack);
    var saved = await persistBoardMutation({ refreshSidebar: true });
    traceFrontendAction(saved ? 'info' : 'warn', 'stack.create', saved ? 'Persisted new stack' : 'Stack persist reported failure', {
      boardId: activeBoardId || null,
      rowIdx: rowIdx,
      rowId: row.id || null,
      insertAt: insertAt,
      stackId: newStack.id
    });
    return saved;
  }

  async function setStackHiddenTag(displayRowIdx, displayStackIdx, tag) {
    if (!fullBoardData || !activeBoardId) return;
    var stack = findFullDataStack(displayRowIdx, displayStackIdx);
    if (!stack) return;
    var nextTitle = applyInternalHiddenTag(stack.title || '', tag);
    if (nextTitle === stack.title) return;
    pushUndo();
    stack.title = nextTitle;
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  async function deleteStack(rowIdx, stackIdx) {
    traceFrontendAction('info', 'stack.delete', 'deleteStack called', { rowIdx: rowIdx, stackIdx: stackIdx });
    var row = findFullDataRow(rowIdx);
    var stack = findFullDataStack(rowIdx, stackIdx);
    if (!row || !stack) {
      traceFrontendAction('warn', 'stack.delete', 'findFullDataRow/Stack returned null', { rowIdx: rowIdx, stackIdx: stackIdx });
      return;
    }
    var visibleCards = 0;
    for (var c = 0; c < stack.columns.length; c++) {
      var cards = stack.columns[c].cards || [];
      for (var k = 0; k < cards.length; k++) {
        if (!is_archived_or_deleted(cards[k].content || '')) visibleCards++;
      }
    }
    if (visibleCards > 0) {
      var confirmed = await showConfirmDialog('Move stack "' + stripInternalHiddenTags(stack.title || '') + '" and ' + visibleCards + ' card(s) to trash?');
      if (!confirmed) return;
    }
    await setStackHiddenTag(rowIdx, stackIdx, '#hidden-internal-deleted');
  }

  async function duplicateStack(rowIdx, stackIdx) {
    if (!fullBoardData || !activeBoardId) return;
    var row = findFullDataRow(rowIdx);
    var stack = findFullDataStack(rowIdx, stackIdx);
    if (!row || !stack) return;
    pushUndo();
    var clone = JSON.parse(JSON.stringify(stack));
    var ts = Date.now();
    clone.id = 'stack-' + ts;
    for (var c = 0; c < clone.columns.length; c++) {
      clone.columns[c].id = 'col-' + ts + '-' + c;
      for (var k = 0; k < clone.columns[c].cards.length; k++) {
        clone.columns[c].cards[k].id = 'dup-' + ts + '-' + c + '-' + k;
        clone.columns[c].cards[k].kid = null;
      }
    }
    // stackIdx is a display index — find the fullBoardData index of the source
    // stack and insert the clone right after it.
    var fullStackIdx = findFullDataStackIndex(row, rowIdx, stackIdx);
    if (fullStackIdx === -1) fullStackIdx = row.stacks.length - 1;
    row.stacks.splice(fullStackIdx + 1, 0, clone);
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function addColumnToStack(rowIdx, stackIdx, atColIdx) {

    var stack = findFullDataStack(rowIdx, stackIdx);
    if (!stack) {
      traceFrontendAction('warn', 'column.create', 'Aborted add column because stack could not be resolved', {
        boardId: activeBoardId || null,
        rowIdx: rowIdx,
        stackIdx: stackIdx,
        atColIdx: atColIdx
      });
      return false;
    }
    if (!Array.isArray(stack.columns)) stack.columns = [];
    pushUndo();
    var insertAt = stack.columns.length;
    if (typeof atColIdx === 'number' && !isNaN(atColIdx)) insertAt = atColIdx;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > stack.columns.length) insertAt = stack.columns.length;
    var newColumn = { id: 'col-' + Date.now(), title: 'New Column', cards: [] };
    traceFrontendAction('info', 'column.create', 'Inserting new column into stack', {
      boardId: activeBoardId || null,
      rowIdx: rowIdx,
      stackIdx: stackIdx,
      stackId: stack.id || null,
      stackTitle: stack.title || '',
      insertAt: insertAt,
      columnId: newColumn.id,
      stackColumnCountBefore: stack.columns.length
    });
    stack.columns.splice(insertAt, 0, newColumn);
    var saved = await persistBoardMutation({ refreshSidebar: true });
    traceFrontendAction(saved ? 'info' : 'warn', 'column.create', saved ? 'Persisted new column in stack' : 'Column persist reported failure', {
      boardId: activeBoardId || null,
      rowIdx: rowIdx,
      stackIdx: stackIdx,
      stackId: stack.id || null,
      insertAt: insertAt,
      columnId: newColumn.id,
      stackColumnCountAfter: stack.columns.length
    });
    return saved;
  }

  async function addCardToActiveBoard(colIndex, content) {
    content = String(content || '').trim();
    if (!content || !activeBoardId || !fullBoardData) return false;
    var column = getFullColumn(colIndex);
    if (!column || !Array.isArray(column.cards)) return false;
    pushUndo();
    column.cards.push({
      id: 'card-' + Date.now(),
      content: content,
      checked: false
    });
    addCardColumn = null;
    await persistBoardMutation();
    return true;
  }

  async function addEmptyCardToActiveBoard(colIndex) {
    if (colIndex == null || !activeBoardId || !fullBoardData) {
      traceFrontendAction('warn', 'card.create', 'Aborted empty card creation because board or column context is missing', {
        boardId: activeBoardId || null,
        colIndex: colIndex
      });
      return false;
    }
    var column = getFullColumn(colIndex);
    if (!column || !Array.isArray(column.cards)) {
      traceFrontendAction('warn', 'card.create', 'Aborted empty card creation because column could not be resolved', {
        boardId: activeBoardId || null,
        colIndex: colIndex
      });
      return false;
    }
    pushUndo();
    var card = {
      id: 'card-' + Date.now(),
      content: '',
      checked: false
    };
    traceFrontendAction('info', 'card.create', 'Creating blank card', {
      boardId: activeBoardId || null,
      colIndex: colIndex,
      columnId: column.id || null,
      cardId: card.id,
      cardCountBefore: column.cards.length
    });
    column.cards.push(card);
    var saved = await persistBoardMutation();
    traceFrontendAction(saved ? 'info' : 'warn', 'card.create', saved ? 'Persisted blank card' : 'Blank card persist reported failure', {
      boardId: activeBoardId || null,
      colIndex: colIndex,
      columnId: column.id || null,
      cardId: card.id,
      cardCountAfter: column.cards.length
    });
    return saved;
  }

  async function insertCardAtIndex(colIndex, atCardIndex) {
    if (colIndex == null || !activeBoardId || !fullBoardData) return false;
    var column = getFullColumn(colIndex);
    if (!column || !Array.isArray(column.cards)) return false;
    pushUndo();
    var card = { id: 'card-' + Date.now(), content: '', checked: false };
    var insertAt;
    if (typeof atCardIndex === 'number') {
      var fullIdx = getFullCardIndex(column, atCardIndex);
      insertAt = fullIdx !== -1 ? fullIdx : column.cards.length;
    } else {
      insertAt = column.cards.length;
    }
    column.cards.splice(insertAt, 0, card);
    return await persistBoardMutation();
  }

  async function submitCard(colIndex, content) {
    try {
      if (!await addCardToActiveBoard(colIndex, content)) {
        throw new Error('Column not available for card creation');
      }
    } catch (err) {
      alert('Failed to add card: ' + err.message);
    }
  }

  // --- Card DnD (pointer-based, bypasses broken WebKit HTML5 DnD) ---

  var cardDrag = null; // { el, ghost, colIndex, cardIndex, startX, startY, started }
  var DRAG_THRESHOLD = 5; // px before drag actually starts
  var dragLayoutLocks = null;

  function lockBoardLayoutForDrag() {
    if (dragLayoutLocks) return;
    var nodes = getElColumnsContainer().querySelectorAll('.board-row, .board-stack, .column');
    dragLayoutLocks = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      dragLayoutLocks.push({
        el: el,
        width: el.style.width,
        minWidth: el.style.minWidth,
        maxWidth: el.style.maxWidth,
        height: el.style.height,
        minHeight: el.style.minHeight,
        maxHeight: el.style.maxHeight
      });
      el.style.width = rect.width + 'px';
      el.style.minWidth = rect.width + 'px';
      el.style.maxWidth = rect.width + 'px';
      el.style.height = rect.height + 'px';
      el.style.minHeight = rect.height + 'px';
      el.style.maxHeight = rect.height + 'px';
      el.classList.add('layout-locked');
    }
    if (dragLayoutLocks.length === 0) dragLayoutLocks = null;
  }

  function unlockBoardLayoutForDrag() {
    if (!dragLayoutLocks) return;
    for (var i = 0; i < dragLayoutLocks.length; i++) {
      var prev = dragLayoutLocks[i];
      prev.el.style.width = prev.width;
      prev.el.style.minWidth = prev.minWidth;
      prev.el.style.maxWidth = prev.maxWidth;
      prev.el.style.height = prev.height;
      prev.el.style.minHeight = prev.minHeight;
      prev.el.style.maxHeight = prev.maxHeight;
      prev.el.classList.remove('layout-locked');
    }
    dragLayoutLocks = null;
  }

  // Single mousedown listener on the columns container (event delegation)
  getElColumnsContainer().addEventListener('mousedown', function (e) {
    try {
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
      boardId: activeBoardId,
      flatColIndex: parseInt(cardEl.getAttribute('data-col-index'), 10),
      rowIndex: null,
      stackIndex: null,
      colIndex: null,
      cardIndex: parseInt(cardEl.getAttribute('data-card-index'), 10),
      startX: e.clientX,
      startY: e.clientY,
      startTopX: null,
      startTopY: null,
      started: false,
    };
    var sourceColEl = cardEl.closest('.column');
    var sourceStackEl = cardEl.closest('.board-stack');
    if (sourceStackEl) {
      var sourceRowIdx = parseInt(sourceStackEl.getAttribute('data-row-index'), 10);
      var sourceStackIdx = parseInt(sourceStackEl.getAttribute('data-stack-index'), 10);
      if (!isNaN(sourceRowIdx)) cardDrag.rowIndex = sourceRowIdx;
      if (!isNaN(sourceStackIdx)) cardDrag.stackIndex = sourceStackIdx;
      if (sourceColEl) {
        var stackColumns = sourceStackEl.querySelectorAll('.board-stack-content > .column');
        cardDrag.colIndex = Array.prototype.indexOf.call(stackColumns, sourceColEl);
      }
    }
    var cardStartTop = toTopFramePoint(window, e.clientX, e.clientY);
    if (cardStartTop) {
      cardDrag.startTopX = cardStartTop.x;
      cardDrag.startTopY = cardStartTop.y;
    }
    startCrossViewBridge('card');
    e.preventDefault();
    } catch (err) {
      logFrontendIssue('error', 'drag.card', 'Error in card mousedown handler', err);
    }
  });

  document.addEventListener('mousemove', function (e) {
    if (!cardDrag) return;
    try {
    // Check threshold before starting actual drag
    if (!cardDrag.started) {
      var dx = e.clientX - cardDrag.startX;
      var dy = e.clientY - cardDrag.startY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      cardDrag.started = true;
      vsMaterialiseAll();
      startCardDrag(e);
    }

    // Move ghost
    if (cardDrag.ghost) {
      cardDrag.ghost.style.left = (e.clientX + 8) + 'px';
      cardDrag.ghost.style.top = (e.clientY - 12) + 'px';
    }

    // Find drop target
    updateCardDropTarget(e.clientX, e.clientY);
    } catch (err) {
      logFrontendIssue('error', 'drag.card', 'Error in card mousemove handler', err);
      cancelCardDrag();
    }
  });

  document.addEventListener('mouseup', function (e) {
    if (!cardDrag) return;
    try {
    if (!cardDrag.started) {
      // Was just a click, not a drag — enter edit mode
      var clickedCard = cardDrag.el;
      var colIndex = cardDrag.flatColIndex;
      var cardIndex = cardDrag.cardIndex;
      cardDrag = null;
      stopCrossViewBridge();
      openCardEditor(clickedCard, colIndex, cardIndex, e.altKey ? 'overlay' : 'inline');
      return;
    }
    finishCardDrag(e.clientX, e.clientY);
    } catch (err) {
      logFrontendIssue('error', 'drag.card', 'Error in card mouseup handler', err);
      cancelCardDrag();
    }
  });

  // Also cancel on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      try {
      if (currentInlineCardEditor) {
        closeInlineCardEditor({ save: false });
        return;
      }
      if (currentCardEditor) {
        closeCardEditorOverlay({ save: false });
        return;
      }
      if (cardDrag && cardDrag.started) cancelCardDrag();
      else if (cardDrag) {
        cardDrag = null;
        stopCrossViewBridge();
      }
      if (ptrDrag && ptrDrag.started) cleanupPtrDrag();
      else if (ptrDrag) {
        ptrDrag = null;
        stopCrossViewBridge();
      }
      } catch (err) {
        logFrontendIssue('error', 'keyboard', 'Error in Escape keydown handler', err);
      }
    }
  });

  function startCardDrag(e) {
    var el = cardDrag.el;
    lockBoardLayoutForDrag();
    startCrossViewBridge('card');
    el.classList.add('dragging');
    insertDropZoneIndicators('card');

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

  function isPointInsideRect(mx, my, rect) {
    return mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom;
  }

  function findNodeAtPoint(nodeList, mx, my) {
    for (var i = 0; i < nodeList.length; i++) {
      var rect = nodeList[i].getBoundingClientRect();
      if (isPointInsideRect(mx, my, rect)) return nodeList[i];
    }
    return null;
  }

  function removeClassFromNodeList(nodeList, className) {
    for (var i = 0; i < nodeList.length; i++) nodeList[i].classList.remove(className);
  }

  function removeClassesFromNodeList(nodeList, classNames) {
    for (var i = 0; i < nodeList.length; i++) {
      nodeList[i].classList.remove.apply(nodeList[i].classList, classNames);
    }
  }

  function getColumnCardsContainers() {
    return getElColumnsContainer().querySelectorAll('.column-cards');
  }

  function findColumnCardsContainerAt(mx, my) {
    return findNodeAtPoint(getColumnCardsContainers(), mx, my);
  }

  function clearCardDragOverHighlights() {
    removeClassFromNodeList(getColumnCardsContainers(), 'card-drag-over');
  }

  function findStackDropZoneAt(mx, my) {
    return findNodeAtPoint(getElColumnsContainer().querySelectorAll('.stack-drop-zone'), mx, my);
  }

  function findDraggableColumnAt(mx, my) {
    return findNodeAtPoint(getElColumnsContainer().querySelectorAll('.column:not(.dragging)'), mx, my);
  }

  function findBoardStackAt(mx, my) {
    return findNodeAtPoint(getElColumnsContainer().querySelectorAll('.board-stack'), mx, my);
  }

  function clearSidebarDropHighlights() {
    removeClassFromNodeList(
      getElBoardList().querySelectorAll('.tree-column.drop-target, .tree-stack.drop-target, .tree-row.drop-target, .board-item.drop-target'),
      'drop-target'
    );
  }

  function findSidebarColumnAt(mx, my) {
    return findNodeAtPoint(getElBoardList().querySelectorAll('.tree-column[data-tree-drag="tree-column"]'), mx, my);
  }

  function getVisibleCardCountInColumn(col) {
    if (!col || !col.cards) return 0;
    var count = 0;
    for (var i = 0; i < col.cards.length; i++) {
      if (!is_archived_or_deleted(col.cards[i].content || '')) count++;
    }
    return count;
  }

  function buildSidebarCardTarget(boardId, rowIdx, stackIdx, colIdx, sidebarNode) {
    if (!boardId || isNaN(rowIdx) || isNaN(stackIdx)) return null;
    var rows = getBoardHierarchyRows(boardId) || [];
    var row = rows[rowIdx];
    var stack = row && row.stacks ? row.stacks[stackIdx] : null;
    if (!stack || !stack.columns || stack.columns.length === 0) return null;

    var resolvedColIdx = (typeof colIdx === 'number' && colIdx >= 0 && colIdx < stack.columns.length)
      ? colIdx
      : (stack.columns.length - 1);
    var targetCol = stack.columns[resolvedColIdx];
    var insertIdx = getVisibleCardCountInColumn(targetCol);

    return {
      kind: 'sidebar',
      boardId: boardId,
      rowIndex: rowIdx,
      stackIndex: stackIdx,
      colIndex: resolvedColIdx,
      indexMode: boardId === activeBoardId ? 'display' : 'full',
      insertIdx: insertIdx,
      insertMode: 'visible',
      sidebarNode: sidebarNode || null,
      container: null
    };
  }

  function getFirstSidebarCardTargetForBoard(boardId, sidebarNode) {
    if (!boardId) return null;
    var rows = getBoardHierarchyRows(boardId) || [];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !row.stacks) continue;
      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        if (!stack || !stack.columns || stack.columns.length === 0) continue;
        return buildSidebarCardTarget(boardId, r, s, 0, sidebarNode || null);
      }
    }
    return null;
  }

  function resolveCardDropTarget(mx, my) {
    // Header drop targets: Park / Archive / Trash buttons
    var parkedBtn = document.getElementById('btn-parked');
    var archiveBtn = document.getElementById('btn-archived');
    var trashBtn = document.getElementById('btn-trash');
    if (parkedBtn && isPointInsideRect(mx, my, parkedBtn.getBoundingClientRect())) {
      return { kind: 'header-park', sidebarNode: null, container: null };
    }
    if (archiveBtn && isPointInsideRect(mx, my, archiveBtn.getBoundingClientRect())) {
      return { kind: 'header-archive', sidebarNode: null, container: null };
    }
    if (trashBtn && isPointInsideRect(mx, my, trashBtn.getBoundingClientRect())) {
      return { kind: 'header-trash', sidebarNode: null, container: null };
    }

    var isTreeCardDrag = ptrDrag && ptrDrag.type === 'tree-card';

    // Tree card-to-card: precise between-card positioning in hierarchy
    if (isTreeCardDrag) {
      var treeCardTarget = getTreeCardDropTarget(mx, my);
      if (treeCardTarget) {
        var tcInsertIdx = treeCardTarget.before ? treeCardTarget.cardIndex : treeCardTarget.cardIndex + 1;
        return {
          kind: 'sidebar',
          boardId: treeCardTarget.boardId,
          rowIndex: treeCardTarget.rowIndex,
          stackIndex: treeCardTarget.stackIndex,
          colIndex: treeCardTarget.colIndex,
          indexMode: treeCardTarget.indexMode,
          insertIdx: tcInsertIdx,
          insertMode: treeCardTarget.boardId === activeBoardId ? 'visible' : 'full',
          sidebarNode: null,
          container: null
        };
      }
    }

    // Prefer sidebar hierarchy columns.
    var sidebarCol = findSidebarColumnAt(mx, my);
    if (sidebarCol) {
      var sidebarBoardId = sidebarCol.getAttribute('data-board-id');
      var sidebarRowIdx = parseInt(sidebarCol.getAttribute('data-row-index'), 10);
      var sidebarStackIdx = parseInt(sidebarCol.getAttribute('data-stack-index'), 10);
      var sidebarColIdx = parseInt(sidebarCol.getAttribute('data-col-local-index'), 10);
      if (sidebarBoardId && !isNaN(sidebarRowIdx) && !isNaN(sidebarStackIdx) && !isNaN(sidebarColIdx)) {
        var sidebarInsertIdx = 0;
        if (sidebarBoardId === activeBoardId && fullBoardData) {
          var activeTargetCol = null;
          var activeTargetStack = findFullDataStack(sidebarRowIdx, sidebarStackIdx);
          if (activeTargetStack) {
            var activeTargetColIdx = findFullColumnIndexInStack(activeTargetStack, sidebarColIdx);
            if (activeTargetColIdx >= 0 && activeTargetColIdx < activeTargetStack.columns.length) {
              activeTargetCol = activeTargetStack.columns[activeTargetColIdx];
            }
          }
          sidebarInsertIdx = getVisibleCardCountInColumn(activeTargetCol);
        } else {
          var sidebarRows = getBoardHierarchyRows(sidebarBoardId) || [];
          var sidebarRow = sidebarRows[sidebarRowIdx];
          var sidebarStack = sidebarRow && sidebarRow.stacks ? sidebarRow.stacks[sidebarStackIdx] : null;
          var sidebarTargetCol = sidebarStack && sidebarStack.columns ? sidebarStack.columns[sidebarColIdx] : null;
          sidebarInsertIdx = getVisibleCardCountInColumn(sidebarTargetCol);
        }
        return {
          kind: 'sidebar',
          boardId: sidebarBoardId,
          rowIndex: sidebarRowIdx,
          stackIndex: sidebarStackIdx,
          colIndex: sidebarColIdx,
          indexMode: sidebarBoardId === activeBoardId ? 'display' : 'full',
          insertIdx: sidebarInsertIdx,
          insertMode: 'visible',
          sidebarNode: sidebarCol,
          container: null
        };
      }
    }

    // Cards from tree can only go into columns — skip stack/row/board fallbacks
    if (!isTreeCardDrag) {
      // Sidebar stack drop: append to last column in stack.
      var sidebarStackNode = findNodeAtPoint(getElBoardList().querySelectorAll('.tree-stack[data-tree-drag="tree-stack"]'), mx, my);
      if (sidebarStackNode) {
        var stackBoardId = sidebarStackNode.getAttribute('data-board-id');
        var stackRowIdx = parseInt(sidebarStackNode.getAttribute('data-row-index'), 10);
        var stackIdx = parseInt(sidebarStackNode.getAttribute('data-stack-index'), 10);
        var stackTarget = buildSidebarCardTarget(stackBoardId, stackRowIdx, stackIdx, Number.POSITIVE_INFINITY, sidebarStackNode);
        if (stackTarget) return stackTarget;
      }

      // Sidebar row drop: append to first non-empty stack/column in row.
      var sidebarRowNode = findNodeAtPoint(getElBoardList().querySelectorAll('.tree-row[data-tree-drag="tree-row"]'), mx, my);
      if (sidebarRowNode) {
        var rowBoardId = sidebarRowNode.getAttribute('data-board-id');
        var rowIdx = parseInt(sidebarRowNode.getAttribute('data-row-index'), 10);
        var rowDataSet = getBoardHierarchyRows(rowBoardId) || [];
        var rowData = rowDataSet[rowIdx];
        if (rowData && rowData.stacks) {
          for (var rs = 0; rs < rowData.stacks.length; rs++) {
            if (rowData.stacks[rs] && rowData.stacks[rs].columns && rowData.stacks[rs].columns.length > 0) {
              var rowTarget = buildSidebarCardTarget(rowBoardId, rowIdx, rs, 0, sidebarRowNode);
              if (rowTarget) return rowTarget;
              break;
            }
          }
        }
      }

      // Sidebar board drop: append to first available column in board.
      var sidebarBoardNode = findNodeAtPoint(getElBoardList().querySelectorAll('.board-item[data-board-id]'), mx, my);
      if (sidebarBoardNode) {
        var boardNodeId = sidebarBoardNode.getAttribute('data-board-id');
        var boardTarget = getFirstSidebarCardTargetForBoard(boardNodeId, sidebarBoardNode);
        if (boardTarget) return boardTarget;
      }
    }

    // Then main board columns.
    var targetContainer = findColumnCardsContainerAt(mx, my);
    if (targetContainer) {
      var targetColIndex = parseInt(targetContainer.getAttribute('data-col-index'), 10);
      if (!isNaN(targetColIndex)) {
        return {
          kind: 'main',
          boardId: activeBoardId,
          flatColIndex: targetColIndex,
          indexMode: 'display',
          insertIdx: findCardInsertIndex(my, targetContainer),
          insertMode: 'visible',
          sidebarNode: null,
          container: targetContainer
        };
      }
    }

    return null;
  }

  function updateCardDropTarget(mx, my) {
    clearCardDropIndicators();
    clearSidebarDropHighlights();
    clearCardDragOverHighlights();
    clearDropZoneIndicatorHighlights();

    var target = resolveCardDropTarget(mx, my);
    // Clear header drop target highlights
    clearHeaderDropTargetHighlights();

    if (!target) return false;

    if (target.kind === 'header-park' || target.kind === 'header-archive' || target.kind === 'header-trash') {
      var hdrBtnId = target.kind === 'header-park' ? 'btn-parked' : target.kind === 'header-archive' ? 'btn-archived' : 'btn-trash';
      var hdrBtn = document.getElementById(hdrBtnId);
      if (hdrBtn) hdrBtn.classList.add('drop-target');
      return true;
    }

    if (target.kind === 'sidebar') {
      if (target.sidebarNode) target.sidebarNode.classList.add('drop-target');
      return true;
    }

    if (target.container) {
      target.container.classList.add('card-drag-over');
      showCardDropIndicator(target.container, target.insertIdx);
      highlightDropZoneIndicator('card', mx, my);
      return true;
    }
    return false;
  }

  function applyCardDropByPoint(source, mx, my) {
    var target = resolveCardDropTarget(mx, my);
    if (!target) return false;

    // Header drop targets: park, archive, or trash the dragged card
    if (target.kind === 'header-park' || target.kind === 'header-archive' || target.kind === 'header-trash') {
      var tag = target.kind === 'header-park' ? '#hidden-internal-parked'
        : target.kind === 'header-archive' ? '#hidden-internal-archived'
        : '#hidden-internal-deleted';
      var srcColIndex = source.flatColIndex;
      var srcCardIndex = source.cardIndex;
      if (typeof srcColIndex === 'number' && typeof srcCardIndex === 'number') {
        tagCard(srcColIndex, srcCardIndex, tag);
      }
      return true;
    }

    moveCard(source, target).catch(function (err) {
      logFrontendIssue('error', 'moveCard', 'Drop failed', err);
    });
    return true;
  }

  function finishCardDrag(mx, my) {
    clearCardDropIndicators();
    clearSidebarDropHighlights();
    clearCardDragOverHighlights();
    var source = {
      boardId: cardDrag.boardId,
      flatColIndex: cardDrag.flatColIndex,
      cardIndex: cardDrag.cardIndex,
      cardIndexMode: 'visible',
      indexMode: 'display'
    };
    if (
      typeof cardDrag.rowIndex === 'number' &&
      typeof cardDrag.stackIndex === 'number' &&
      typeof cardDrag.colIndex === 'number' &&
      cardDrag.rowIndex >= 0 &&
      cardDrag.stackIndex >= 0 &&
      cardDrag.colIndex >= 0
    ) {
      source.rowIndex = cardDrag.rowIndex;
      source.stackIndex = cardDrag.stackIndex;
      source.colIndex = cardDrag.colIndex;
    }
    applyCardDropByPoint(source, mx, my);
    cleanupCardDrag();
  }

  function cancelCardDrag() {
    clearCardDropIndicators();
    clearSidebarDropHighlights();
    clearCardDragOverHighlights();
    clearHeaderDropTargetHighlights();
    cleanupCardDrag();
  }

  function clearHeaderDropTargetHighlights() {
    var p = document.getElementById('btn-parked');
    var a = document.getElementById('btn-archived');
    var t = document.getElementById('btn-trash');
    if (p) p.classList.remove('drop-target');
    if (a) a.classList.remove('drop-target');
    if (t) t.classList.remove('drop-target');
  }

  function cleanupCardDrag() {
    removeDropZoneIndicators();
    clearHeaderDropTargetHighlights();
    if (cardDrag) {
      if (cardDrag.el) cardDrag.el.classList.remove('dragging');
      if (cardDrag.ghost) cardDrag.ghost.remove();
      cardDrag = null;
    }
    stopCrossViewBridge();
    unlockBoardLayoutForDrag();
    vsRestoreAfterDrag();
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
    if (!cardsEl) return;
    var indicator = document.querySelector('.card-drop-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'card-drop-indicator';
      document.body.appendChild(indicator);
    }
    var cards = cardsEl.querySelectorAll('.card:not(.dragging)');
    var containerRect = cardsEl.getBoundingClientRect();
    var y;
    if (insertIdx < cards.length && cards[insertIdx]) {
      y = cards[insertIdx].getBoundingClientRect().top;
    } else if (cards.length > 0) {
      y = cards[cards.length - 1].getBoundingClientRect().bottom;
    } else {
      y = containerRect.top + 8;
    }
    indicator.style.top = Math.round(y) + 'px';
    indicator.style.left = Math.round(containerRect.left + 6) + 'px';
    indicator.style.width = Math.max(24, Math.round(containerRect.width - 12)) + 'px';
  }

  function clearCardDropIndicators() {
    var indicators = document.querySelectorAll('.card-drop-indicator');
    for (var i = 0; i < indicators.length; i++) {
      indicators[i].remove();
    }
  }

  var crossViewBridge = null;

  function getTopWindowSafe() {
    try {
      if (window.top && window.top.document) return window.top;
    } catch (e) {
      logFrontendIssue('warn', 'cross-frame', 'Failed to access top window', e);
    }
    return window;
  }

  function getFrameWindowAtTopPoint(topX, topY) {
    var topWin = getTopWindowSafe();
    if (!topWin || !topWin.document || !topWin.document.elementFromPoint) return window;
    var hit = topWin.document.elementFromPoint(topX, topY);
    if (!hit) return window;
    if (hit.tagName === 'IFRAME' && hit.contentWindow) return hit.contentWindow;
    return topWin;
  }

  function getFrameRectInTopWindow(targetWin) {
    var topWin = getTopWindowSafe();
    if (!targetWin || targetWin === topWin) return { left: 0, top: 0 };
    try {
      var iframes = topWin.document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        if (iframes[i].contentWindow === targetWin) {
          return iframes[i].getBoundingClientRect();
        }
      }
    } catch (e) {
      logFrontendIssue('warn', 'cross-frame', 'Failed to resolve iframe bounds in top window', e);
    }
    return null;
  }

  function toTopFramePoint(sourceWin, localX, localY) {
    var topWin = getTopWindowSafe();
    if (!sourceWin) return null;
    if (sourceWin === topWin) return { x: localX, y: localY };
    var rect = getFrameRectInTopWindow(sourceWin);
    if (!rect) return null;
    return { x: localX + rect.left, y: localY + rect.top };
  }

  function toLocalFramePoint(targetWin, topX, topY) {
    var topWin = getTopWindowSafe();
    if (!targetWin) return null;
    if (targetWin === topWin) return { x: topX, y: topY };
    var rect = getFrameRectInTopWindow(targetWin);
    if (!rect) return null;
    return { x: topX - rect.left, y: topY - rect.top };
  }

  function getDragStartTopPoint(kind) {
    if (kind === 'card' && cardDrag) {
      if (typeof cardDrag.startTopX === 'number' && typeof cardDrag.startTopY === 'number') {
        return { x: cardDrag.startTopX, y: cardDrag.startTopY };
      }
      return toTopFramePoint(window, cardDrag.startX, cardDrag.startY);
    }
    if (kind === 'ptr' && ptrDrag) {
      if (typeof ptrDrag.startTopX === 'number' && typeof ptrDrag.startTopY === 'number') {
        return { x: ptrDrag.startTopX, y: ptrDrag.startTopY };
      }
      return toTopFramePoint(window, ptrDrag.startX, ptrDrag.startY);
    }
    return null;
  }

  function hasCrossViewDragMovedBeyondThreshold(kind, topPoint) {
    if (!topPoint) return false;
    if (kind === 'card' && cardDrag && cardDrag.started) return true;
    if (kind === 'ptr' && ptrDrag && ptrDrag.started) return true;
    var startPoint = getDragStartTopPoint(kind);
    if (!startPoint) return false;
    var dx = topPoint.x - startPoint.x;
    var dy = topPoint.y - startPoint.y;
    return Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD;
  }

  function getCrossViewDragPayload(kind) {
    if (kind === 'card' && cardDrag) {
      var source = {
        boardId: cardDrag.boardId,
        flatColIndex: cardDrag.flatColIndex,
        cardIndex: cardDrag.cardIndex,
        cardIndexMode: 'visible',
        indexMode: 'display'
      };
      if (
        typeof cardDrag.rowIndex === 'number' &&
        typeof cardDrag.stackIndex === 'number' &&
        typeof cardDrag.colIndex === 'number' &&
        cardDrag.rowIndex >= 0 &&
        cardDrag.stackIndex >= 0 &&
        cardDrag.colIndex >= 0
      ) {
        source.rowIndex = cardDrag.rowIndex;
        source.stackIndex = cardDrag.stackIndex;
        source.colIndex = cardDrag.colIndex;
      }
      return {
        type: 'tree-card',
        source: source
      };
    }
    if (kind === 'ptr' && ptrDrag) {
      if (
        ptrDrag.type !== 'tree-card' &&
        ptrDrag.type !== 'column' &&
        ptrDrag.type !== 'tree-column' &&
        ptrDrag.type !== 'board-row' &&
        ptrDrag.type !== 'tree-row' &&
        ptrDrag.type !== 'board-stack' &&
        ptrDrag.type !== 'tree-stack'
      ) {
        return null;
      }
      return {
        type: ptrDrag.type,
        source: JSON.parse(JSON.stringify(ptrDrag.source || {}))
      };
    }
    return null;
  }

  function tryExternalFrameDrop(targetWin, payload, topX, topY) {
    if (!targetWin || !payload || !payload.source) return false;
    var api = targetWin.__lexeraExternalDnd;
    if (!api || typeof api.drop !== 'function') return false;
    var localPoint = toLocalFramePoint(targetWin, topX, topY);
    if (!localPoint) return false;
    return !!api.drop(payload, localPoint.x, localPoint.y);
  }

  function tryExternalFrameHover(targetWin, payload, topX, topY) {
    if (!targetWin || !payload || !payload.source) return false;
    var api = targetWin.__lexeraExternalDnd;
    if (!api || typeof api.hover !== 'function') return false;
    var localPoint = toLocalFramePoint(targetWin, topX, topY);
    if (!localPoint) return false;
    return !!api.hover(payload, localPoint.x, localPoint.y);
  }

  function tryExternalFrameClear(targetWin) {
    if (!targetWin) return;
    var api = targetWin.__lexeraExternalDnd;
    if (api && typeof api.clear === 'function') {
      api.clear();
    }
  }

  function getCrossViewGhostLabel(kind) {
    if (kind === 'card' && cardDrag && cardDrag.el) {
      var titleEl = cardDrag.el.querySelector('.card-title-display');
      var text = titleEl ? titleEl.textContent : cardDrag.el.textContent;
      return (text || 'Drag').trim().substring(0, 80);
    }
    if (kind === 'ptr' && ptrDrag) {
      return getPtrDragLabel();
    }
    return 'Drag';
  }

  function getCrossViewBridgeWindows(topWin) {
    var result = [];
    var seen = [];
    function pushWin(win) {
      if (!win) return;
      if (seen.indexOf(win) !== -1) return;
      seen.push(win);
      result.push(win);
    }
    pushWin(topWin);
    if (!topWin || !topWin.document) return result;
    try {
      var iframes = topWin.document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        if (iframes[i] && iframes[i].contentWindow) pushWin(iframes[i].contentWindow);
      }
    } catch (e) {
      // ignore cross-frame access issues
    }
    return result;
  }

  function clearCrossViewHoverTarget() {
    if (!crossViewBridge || !crossViewBridge.hoverWin) return;
    tryExternalFrameClear(crossViewBridge.hoverWin);
    crossViewBridge.hoverWin = null;
  }

  function hideCrossViewTopGhost() {
    if (!crossViewBridge || !crossViewBridge.topGhost) return;
    crossViewBridge.topGhost.style.display = 'none';
  }

  function ensureCrossViewTopGhost(kind) {
    if (!crossViewBridge || !crossViewBridge.topWin || !crossViewBridge.topWin.document) return null;
    if (!crossViewBridge.topGhost || !crossViewBridge.topGhost.isConnected) {
      var ghost = crossViewBridge.topWin.document.createElement('div');
      ghost.className = 'card-drag-ghost cross-view-drag-ghost';
      ghost.style.display = 'none';
      crossViewBridge.topWin.document.body.appendChild(ghost);
      crossViewBridge.topGhost = ghost;
    }
    var label = getCrossViewGhostLabel(kind);
    crossViewBridge.topGhost.textContent = label || 'Drag';
    return crossViewBridge.topGhost;
  }

  function updateCrossViewTopGhost(kind, topX, topY) {
    var ghost = ensureCrossViewTopGhost(kind);
    if (!ghost) return;
    ghost.style.left = (topX + 8) + 'px';
    ghost.style.top = (topY - 12) + 'px';
    ghost.style.display = 'block';
  }

  function removeCrossViewTopGhost() {
    if (!crossViewBridge || !crossViewBridge.topGhost) return;
    crossViewBridge.topGhost.remove();
    crossViewBridge.topGhost = null;
  }

  function updateCrossViewExternalHover(kind, topX, topY) {
    if (!crossViewBridge) return;
    var payload = getCrossViewDragPayload(kind);
    if (!payload) {
      clearCrossViewHoverTarget();
      return;
    }
    var targetWin = getFrameWindowAtTopPoint(topX, topY);
    if (!targetWin || targetWin === window || targetWin === crossViewBridge.topWin) {
      clearCrossViewHoverTarget();
      return;
    }
    if (crossViewBridge.hoverWin && crossViewBridge.hoverWin !== targetWin) {
      tryExternalFrameClear(crossViewBridge.hoverWin);
      crossViewBridge.hoverWin = null;
    }
    var hovered = tryExternalFrameHover(targetWin, payload, topX, topY);
    if (hovered) {
      crossViewBridge.hoverWin = targetWin;
      return;
    }
    if (crossViewBridge.hoverWin === targetWin) {
      tryExternalFrameClear(targetWin);
      crossViewBridge.hoverWin = null;
    }
  }

  function startCrossViewBridge(kind) {
    if (crossViewBridge) return;
    var topWin = getTopWindowSafe();
    if (!topWin || topWin === window) return;

    var bridgeTargets = [];
    var bridgeWindows = getCrossViewBridgeWindows(topWin);

    function onAnyMouseMove(originWin, e) {
      var topPoint = toTopFramePoint(originWin, e.clientX, e.clientY);
      if (!topPoint) return;
      var crossedThreshold = hasCrossViewDragMovedBeyondThreshold(kind, topPoint);
      if (!crossedThreshold) {
        hideCrossViewTopGhost();
        clearCrossViewHoverTarget();
        return;
      }
      var targetWin = getFrameWindowAtTopPoint(topPoint.x, topPoint.y);
      if (targetWin && targetWin !== window) {
        updateCrossViewTopGhost(kind, topPoint.x, topPoint.y);
      } else {
        hideCrossViewTopGhost();
      }
      updateCrossViewExternalHover(kind, topPoint.x, topPoint.y);
    }

    function onAnyMouseUp(originWin, e) {
      var topPoint = toTopFramePoint(originWin, e.clientX, e.clientY);
      if (!topPoint) return;
      var targetWin = getFrameWindowAtTopPoint(topPoint.x, topPoint.y);
      if (!targetWin || targetWin === window) return;
      var crossedThreshold = hasCrossViewDragMovedBeyondThreshold(kind, topPoint);
      if (!crossedThreshold) {
        if (kind === 'card' && cardDrag && !cardDrag.started) cancelCardDrag();
        else if (kind === 'ptr' && ptrDrag && !ptrDrag.started) cleanupPtrDrag();
        stopCrossViewBridge();
        return;
      }

      var payload = getCrossViewDragPayload(kind);
      var dropped =
        payload && targetWin !== topWin
          ? tryExternalFrameDrop(targetWin, payload, topPoint.x, topPoint.y)
          : false;
      if (kind === 'card' && cardDrag) {
        if (dropped) cleanupCardDrag();
        else cancelCardDrag();
      } else if (kind === 'ptr' && ptrDrag) {
        cleanupPtrDrag();
      }
      if (dropped) poll();
      stopCrossViewBridge();
    }

    for (var i = 0; i < bridgeWindows.length; i++) {
      (function (targetWin) {
        function upListener(e) {
          onAnyMouseUp(targetWin, e);
        }
        function moveListener(e) {
          onAnyMouseMove(targetWin, e);
        }
        targetWin.addEventListener('mouseup', upListener, true);
        targetWin.addEventListener('mousemove', moveListener, true);
        bridgeTargets.push({ win: targetWin, upListener: upListener, moveListener: moveListener });
      })(bridgeWindows[i]);
    }

    crossViewBridge = { topWin: topWin, kind: kind, targets: bridgeTargets, hoverWin: null, topGhost: null };
  }

  function stopCrossViewBridge() {
    if (!crossViewBridge) return;
    var targets = crossViewBridge.targets || [];
    for (var i = 0; i < targets.length; i++) {
      var target = targets[i];
      if (target && target.win && target.upListener) {
        target.win.removeEventListener('mouseup', target.upListener, true);
      }
      if (target && target.win && target.moveListener) {
        target.win.removeEventListener('mousemove', target.moveListener, true);
      }
    }
    clearCrossViewHoverTarget();
    removeCrossViewTopGhost();
    crossViewBridge = null;
  }

  function registerExternalDndBridge() {
    window.__lexeraExternalDnd = {
      hover: function (payload, x, y) {
        if (!payload || !payload.source) return false;
        if (payload.type === 'tree-card') {
          return updateCardDropTarget(x, y);
        }
        if (
          payload.type === 'board-row' ||
          payload.type === 'tree-row' ||
          payload.type === 'board-stack' ||
          payload.type === 'tree-stack' ||
          payload.type === 'column' ||
          payload.type === 'tree-column'
        ) {
          return updatePtrDropTargetByType(payload.type, x, y);
        }
        return false;
      },
      drop: function (payload, x, y) {
        if (!payload || !payload.source) return false;
        if (payload.type === 'tree-card') {
          return applyCardDropByPoint(payload.source, x, y);
        }
        if (payload.type === 'board-row' || payload.type === 'tree-row') {
          return applyRowDropByPoint(payload.source, x, y);
        }
        if (payload.type === 'board-stack' || payload.type === 'tree-stack') {
          return applyStackDropByPoint(payload.source, x, y);
        }
        if (payload.type === 'column' || payload.type === 'tree-column') {
          executeColumnPtrDrop(x, y, payload.source);
          return true;
        }
        return false;
      },
      clear: function () {
        clearPtrDropIndicators();
      }
    };
  }

  // --- Pointer-based DnD for rows/stacks/columns/boards (bypasses broken HTML5 DnD in WebKit) ---

  // Sidebar: tree grips and board item grips
  getElBoardList().addEventListener('mousedown', function (e) {
    try {
    if (e.button !== 0) return;
    if (ptrDrag || cardDrag) return;

    var grip = e.target.closest('.tree-grip');
    if (!grip) return;

    // Tree node drag
    var treeNode = grip.closest('.tree-node[data-tree-drag]');
    if (treeNode) {
      var dragType = treeNode.getAttribute('data-tree-drag');
      var ownerBoardId = treeNode.getAttribute('data-board-id');
      if (!ownerBoardId) {
        var ownerWrapper = treeNode.closest('.board-item-wrapper');
        ownerBoardId = ownerWrapper ? ownerWrapper.getAttribute('data-board-id') : null;
      }
      var source = { type: dragType, boardId: ownerBoardId || activeBoardId };
      if (dragType === 'tree-row') {
        source.rowIndex = parseInt(treeNode.getAttribute('data-row-index'), 10);
        source.indexMode = source.boardId === activeBoardId ? 'display' : 'full';
      } else if (dragType === 'tree-stack') {
        source.rowIndex = parseInt(treeNode.getAttribute('data-row-index'), 10);
        source.stackIndex = parseInt(treeNode.getAttribute('data-stack-index'), 10);
        source.indexMode = source.boardId === activeBoardId ? 'display' : 'full';
      } else if (dragType === 'tree-column') {
        source.rowIndex = parseInt(treeNode.getAttribute('data-row-index'), 10);
        source.stackIndex = parseInt(treeNode.getAttribute('data-stack-index'), 10);
        source.colIndex = parseInt(treeNode.getAttribute('data-col-local-index'), 10);
        source.indexMode = source.boardId === activeBoardId ? 'display' : 'full';
      } else if (dragType === 'tree-card') {
        source.rowIndex = parseInt(treeNode.getAttribute('data-row-index'), 10);
        source.stackIndex = parseInt(treeNode.getAttribute('data-stack-index'), 10);
        source.colIndex = parseInt(treeNode.getAttribute('data-col-local-index'), 10);
        source.flatColIndex = parseInt(treeNode.getAttribute('data-col-index'), 10);
        source.cardIndex = parseInt(treeNode.getAttribute('data-card-index'), 10);
        source.cardIndexMode = source.boardId === activeBoardId ? 'visible' : 'full';
        source.indexMode = source.boardId === activeBoardId ? 'display' : 'full';
      }
      ptrDrag = { type: dragType, source: source, startX: e.clientX, startY: e.clientY, startTopX: null, startTopY: null, started: false, ghost: null, el: treeNode };
      var treeStartTop = toTopFramePoint(window, e.clientX, e.clientY);
      if (treeStartTop) {
        ptrDrag.startTopX = treeStartTop.x;
        ptrDrag.startTopY = treeStartTop.y;
      }
      startCrossViewBridge('ptr');
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Board item drag (for reordering boards in sidebar)
    var boardItem = grip.closest('.board-item');
    if (boardItem) {
      var boardIndex = parseInt(boardItem.getAttribute('data-board-index'), 10);
      if (isNaN(boardIndex)) return;
      ptrDrag = { type: 'board', source: { type: 'board', index: boardIndex }, startX: e.clientX, startY: e.clientY, startTopX: null, startTopY: null, started: false, ghost: null, el: boardItem };
      var boardStartTop = toTopFramePoint(window, e.clientX, e.clientY);
      if (boardStartTop) {
        ptrDrag.startTopX = boardStartTop.x;
        ptrDrag.startTopY = boardStartTop.y;
      }
      startCrossViewBridge('ptr');
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    } catch (err) {
      logFrontendIssue('error', 'drag.ptr', 'Error in sidebar mousedown handler', err);
    }
  });

  // Main board: row/stack/column drag starts from header area (not just grip)
  getElColumnsContainer().addEventListener('mousedown', function (e) {
    try {
    if (e.button !== 0) return;
    if (ptrDrag || cardDrag) return;
    if (e.target.closest('.board-row-title, .board-stack-title, .column-title')) return;
    if (e.target.closest('button, input, textarea, select, a, .column-rename-input, .card-menu-btn, .card-collapse-toggle, .card-checkbox')) {
      return;
    }

    // Row grip
    var rowHeader = e.target.closest('.board-row-header');
    if (rowHeader) {
      var rowEl = rowHeader.closest('.board-row');
      var rowIdx = parseInt(rowEl.getAttribute('data-row-index'), 10);
      ptrDrag = { type: 'board-row', source: { type: 'board-row', boardId: activeBoardId, rowIndex: rowIdx, indexMode: 'display' }, startX: e.clientX, startY: e.clientY, startTopX: null, startTopY: null, started: false, ghost: null, el: rowEl };
      var rowStartTop = toTopFramePoint(window, e.clientX, e.clientY);
      if (rowStartTop) {
        ptrDrag.startTopX = rowStartTop.x;
        ptrDrag.startTopY = rowStartTop.y;
      }
      startCrossViewBridge('ptr');
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Stack grip
    var stackHeader = e.target.closest('.board-stack-header');
    if (stackHeader) {
      var stackEl = stackHeader.closest('.board-stack');
      var rowIdx = parseInt(stackEl.getAttribute('data-row-index'), 10);
      var stackIdx = parseInt(stackEl.getAttribute('data-stack-index'), 10);
      ptrDrag = { type: 'board-stack', source: { type: 'board-stack', boardId: activeBoardId, rowIndex: rowIdx, stackIndex: stackIdx, indexMode: 'display' }, startX: e.clientX, startY: e.clientY, startTopX: null, startTopY: null, started: false, ghost: null, el: stackEl };
      var stackStartTop = toTopFramePoint(window, e.clientX, e.clientY);
      if (stackStartTop) {
        ptrDrag.startTopX = stackStartTop.x;
        ptrDrag.startTopY = stackStartTop.y;
      }
      startCrossViewBridge('ptr');
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Column grip
    var columnHeader = e.target.closest('.column-header');
    if (columnHeader) {
      var colEl = columnHeader.closest('.column');
      var stackEl = colEl.closest('.board-stack');
      var rowIdx = parseInt(stackEl.getAttribute('data-row-index'), 10);
      var stackIdx = parseInt(stackEl.getAttribute('data-stack-index'), 10);
      var columns = stackEl.querySelectorAll('.board-stack-content > .column');
      var colIdx = Array.prototype.indexOf.call(columns, colEl);
      ptrDrag = {
        type: 'column',
        source: {
          type: 'column',
          boardId: activeBoardId,
          rowIndex: rowIdx,
          stackIndex: stackIdx,
          colIndex: colIdx,
          indexMode: 'display'
        },
        startX: e.clientX,
        startY: e.clientY,
        startTopX: null,
        startTopY: null,
        started: false,
        ghost: null,
        el: colEl
      };
      var colStartTop = toTopFramePoint(window, e.clientX, e.clientY);
      if (colStartTop) {
        ptrDrag.startTopX = colStartTop.x;
        ptrDrag.startTopY = colStartTop.y;
      }
      startCrossViewBridge('ptr');
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    } catch (err) {
      logFrontendIssue('error', 'drag.ptr', 'Error in board mousedown handler', err);
    }
  });

  // Pointer drag: mousemove
  document.addEventListener('mousemove', function (e) {
    if (!ptrDrag) return;
    try {
    if (!ptrDrag.started) {
      var dx = e.clientX - ptrDrag.startX;
      var dy = e.clientY - ptrDrag.startY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      ptrDrag.started = true;
      vsMaterialiseAll();
      ptrDrag.el.classList.add('dragging');
      var lockableDragType =
        ptrDrag.type === 'board-row' ||
        ptrDrag.type === 'tree-row' ||
        ptrDrag.type === 'board-stack' ||
        ptrDrag.type === 'tree-stack' ||
        ptrDrag.type === 'column' ||
        ptrDrag.type === 'tree-column' ||
        ptrDrag.type === 'tree-card';
      if (lockableDragType) {
        lockBoardLayoutForDrag();
      }
      startCrossViewBridge('ptr');
      if (ptrDrag.type === 'column' || ptrDrag.type === 'tree-column') {
        insertStackDropZones();
      }
      insertDropZoneIndicators(ptrDrag.type);

      // Create ghost
      var ghost = document.createElement('div');
      ghost.className = 'card-drag-ghost';
      ghost.textContent = getPtrDragLabel();
      ghost.style.left = (e.clientX + 8) + 'px';
      ghost.style.top = (e.clientY - 12) + 'px';
      document.body.appendChild(ghost);
      ptrDrag.ghost = ghost;

      var sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    }

    if (ptrDrag.ghost) {
      ptrDrag.ghost.style.left = (e.clientX + 8) + 'px';
      ptrDrag.ghost.style.top = (e.clientY - 12) + 'px';
    }

    updatePtrDropTarget(e.clientX, e.clientY);
    } catch (err) {
      logFrontendIssue('error', 'drag.ptr', 'Error in ptr mousemove handler', err);
      cleanupPtrDrag();
    }
  });

  // Pointer drag: mouseup
  document.addEventListener('mouseup', function (e) {
    if (!ptrDrag) return;
    try {
    if (!ptrDrag.started) {
      ptrDrag = null;
      stopCrossViewBridge();
      return;
    }
    executePtrDrop(e.clientX, e.clientY);
    cleanupPtrDrag();
    } catch (err) {
      logFrontendIssue('error', 'drag.ptr', 'Error in ptr mouseup handler', err);
      cleanupPtrDrag();
    }
  });

  // Safety net for interrupted drags (window focus loss, tab hide).
  window.addEventListener('blur', function () {
    if (ptrDrag || dragLayoutLocks) cleanupPtrDrag();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && (ptrDrag || dragLayoutLocks)) {
      cleanupPtrDrag();
    }
  });

  function getPtrDragLabel() {
    var type = ptrDrag.type;
    var labelEl;
    if (type === 'board') {
      labelEl = ptrDrag.el.querySelector('.board-item-title');
    } else if (type === 'board-row' || type === 'tree-row') {
      labelEl = ptrDrag.el.querySelector('.board-row-title, .tree-label');
    } else if (type === 'board-stack' || type === 'tree-stack') {
      labelEl = ptrDrag.el.querySelector('.board-stack-title, .tree-label');
    } else if (type === 'column' || type === 'tree-column') {
      labelEl = ptrDrag.el.querySelector('.column-title, .tree-label');
    } else if (type === 'tree-card') {
      labelEl = ptrDrag.el.querySelector('.tree-label');
    }
    return labelEl ? labelEl.textContent : 'Drag';
  }

  function updatePtrDropTarget(mx, my) {
    if (!ptrDrag) return false;
    return updatePtrDropTargetByType(ptrDrag.type, mx, my);
  }

  function updatePtrDropTargetByType(type, mx, my) {
    clearPtrDropIndicators();
    clearDropZoneIndicatorHighlights();
    clearHeaderDropTargetHighlights();

    // Check header drop targets (Park/Archive/Trash) for all non-board types
    if (type !== 'board') {
      var headerTag = resolveHeaderDropTag(mx, my);
      if (headerTag) {
        var hdrBtnId = headerTag === '#hidden-internal-parked' ? 'btn-parked'
          : headerTag === '#hidden-internal-archived' ? 'btn-archived' : 'btn-trash';
        var hdrBtn = document.getElementById(hdrBtnId);
        if (hdrBtn) hdrBtn.classList.add('drop-target');
        return true;
      }
    }

    if (type === 'tree-row' || type === 'board-row') {
      var rowBoardHit = ptrFindHitNode(getElColumnsContainer().querySelectorAll('.board-row'), mx, my, 'drag-over-top', 'drag-over-bottom', true);
      var rowTreeHit = ptrFindHitNode(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-row"]'), mx, my, 'tree-drop-above', 'tree-drop-below', true);
      if (rowBoardHit) highlightDropZoneIndicator(type, mx, my);
      return !!(rowBoardHit || rowTreeHit);
    } else if (type === 'tree-stack' || type === 'board-stack') {
      var stackBoardHit = ptrFindHitNode(getElColumnsContainer().querySelectorAll('.board-stack'), mx, my, 'drag-over-left', 'drag-over-right', false);
      var stackTreeHit = ptrFindHitNode(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-stack"]'), mx, my, 'tree-drop-above', 'tree-drop-below', true);
      if (stackBoardHit) highlightDropZoneIndicator(type, mx, my);
      return !!(stackBoardHit || stackTreeHit);
    } else if (type === 'tree-column' || type === 'column') {
      var boardColumnHit = updateColumnPtrDropTarget(mx, my);
      var treeColHit = ptrFindStrictHitNode(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-column"]'), mx, my, 'tree-drop-above', 'tree-drop-below', true);
      if (treeColHit) return true;
      if (!treeColHit) {
        var treeStackHit = ptrFindStrictHitNode(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-stack"]'), mx, my, 'tree-drop-above', 'tree-drop-below', true);
        if (treeStackHit) return true;
        if (!treeStackHit) {
          var stackZone = findNodeAtPoint(getElBoardList().querySelectorAll('.tree-children.tree-stack-drop-zone'), mx, my);
          if (stackZone) {
            stackZone.classList.add('tree-drop-stack-target');
            return true;
          }
        }
      }
      if (boardColumnHit) highlightDropZoneIndicator(type, mx, my);
      return !!boardColumnHit;
    } else if (type === 'tree-card') {
      // Cards can only drop into columns (not stacks/rows/boards)
      clearCardDropIndicators();
      clearSidebarDropHighlights();
      clearCardDragOverHighlights();
      // Tree card-to-card indicator (between-card reorder in tree)
      var treeCardHit = ptrFindStrictHitNode(
        getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-card"]'),
        mx, my, 'tree-drop-above', 'tree-drop-below', true
      );
      if (treeCardHit) return true;
      // Tree column highlight (drop appends to column)
      var treeColNode = findSidebarColumnAt(mx, my);
      if (treeColNode) { treeColNode.classList.add('drop-target'); return true; }
      // Main board column
      var mainCol = findColumnCardsContainerAt(mx, my);
      if (mainCol) {
        mainCol.classList.add('card-drag-over');
        showCardDropIndicator(mainCol, findCardInsertIndex(my, mainCol));
        highlightDropZoneIndicator('tree-card', mx, my);
        return true;
      }
      return false;
    } else if (type === 'board') {
      var boardHit = ptrFindHitNode(getElBoardList().querySelectorAll('.board-item'), mx, my, 'drag-over-top', 'drag-over-bottom', true);
      return !!boardHit;
    }
    return false;
  }

  function getSourceRowIndex(source) {
    if (!source) return -1;
    if (typeof source.rowIndex === 'number') return source.rowIndex;
    if (typeof source.index === 'number') return source.index;
    return -1;
  }

  function getRowDropTarget(mx, my) {
    var boardTarget = ptrFindDropTarget(getElColumnsContainer().querySelectorAll('.board-row'), mx, my, true);
    if (boardTarget) {
      var boardRowIdx = parseInt(boardTarget.node.getAttribute('data-row-index'), 10);
      if (!isNaN(boardRowIdx)) {
        return {
          boardId: activeBoardId,
          rowIndex: boardRowIdx,
          before: boardTarget.before,
          indexMode: 'display'
        };
      }
    }
    var treeTarget = ptrFindDropTarget(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-row"]'), mx, my, true);
    if (treeTarget) {
      var treeBoardId = treeTarget.node.getAttribute('data-board-id') || activeBoardId;
      var treeRowIdx = parseInt(treeTarget.node.getAttribute('data-row-index'), 10);
      if (!isNaN(treeRowIdx)) {
        return {
          boardId: treeBoardId,
          rowIndex: treeRowIdx,
          before: treeTarget.before,
          indexMode: treeBoardId === activeBoardId ? 'display' : 'full'
        };
      }
    }
    return null;
  }

  function getStackDropTarget(mx, my) {
    var boardTarget = ptrFindDropTarget(getElColumnsContainer().querySelectorAll('.board-stack'), mx, my, false);
    if (boardTarget) {
      var boardRowIdx = parseInt(boardTarget.node.getAttribute('data-row-index'), 10);
      var boardStackIdx = parseInt(boardTarget.node.getAttribute('data-stack-index'), 10);
      if (!isNaN(boardRowIdx) && !isNaN(boardStackIdx)) {
        return {
          boardId: activeBoardId,
          rowIndex: boardRowIdx,
          stackIndex: boardStackIdx,
          before: boardTarget.before,
          indexMode: 'display'
        };
      }
    }
    var treeTarget = ptrFindDropTarget(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-stack"]'), mx, my, true);
    if (treeTarget) {
      var treeBoardId = treeTarget.node.getAttribute('data-board-id') || activeBoardId;
      var treeRowIdx = parseInt(treeTarget.node.getAttribute('data-row-index'), 10);
      var treeStackIdx = parseInt(treeTarget.node.getAttribute('data-stack-index'), 10);
      if (!isNaN(treeRowIdx) && !isNaN(treeStackIdx)) {
        return {
          boardId: treeBoardId,
          rowIndex: treeRowIdx,
          stackIndex: treeStackIdx,
          before: treeTarget.before,
          indexMode: treeBoardId === activeBoardId ? 'display' : 'full'
        };
      }
    }
    return null;
  }

  function applyRowDropByPoint(source, mx, my) {
    if (!source) return false;
    var srcBoardId = source.boardId || activeBoardId;
    var srcRowIdx = getSourceRowIndex(source);
    if (!srcBoardId || srcRowIdx < 0) return false;

    var rowTarget = getRowDropTarget(mx, my);
    if (!rowTarget || !rowTarget.boardId || rowTarget.rowIndex < 0) return false;

    var srcIndexMode = source.indexMode || (srcBoardId === activeBoardId ? 'display' : 'full');
    var targetIndexMode = rowTarget.indexMode || (rowTarget.boardId === activeBoardId ? 'display' : 'full');

    if (
      srcBoardId === rowTarget.boardId &&
      srcBoardId === activeBoardId &&
      srcIndexMode === 'display' &&
      targetIndexMode === 'display'
    ) {
      if (srcRowIdx !== rowTarget.rowIndex) {
        reorderRows(srcRowIdx, rowTarget.rowIndex, rowTarget.before);
      }
      return true;
    }

    moveRowAcrossBoards(
      { boardId: srcBoardId, rowIndex: srcRowIdx, indexMode: srcIndexMode },
      {
        boardId: rowTarget.boardId,
        rowIndex: rowTarget.rowIndex,
        before: rowTarget.before,
        indexMode: targetIndexMode
      }
    ).catch(function (err) {
      lexeraLog('error', '[moveRowAcrossBoards] Drop failed: ' + err);
    });
    return true;
  }

  function applyStackDropByPoint(source, mx, my) {
    if (!source) return false;
    var srcBoardId = source.boardId || activeBoardId;
    var srcRowIdx = parseInt(source.rowIndex, 10);
    var srcStackIdx = parseInt(source.stackIndex, 10);
    if (!srcBoardId || isNaN(srcRowIdx) || isNaN(srcStackIdx) || srcRowIdx < 0 || srcStackIdx < 0) return false;

    var stackTarget = getStackDropTarget(mx, my);
    if (!stackTarget || !stackTarget.boardId || stackTarget.rowIndex < 0 || stackTarget.stackIndex < 0) return false;

    var srcIndexMode = source.indexMode || (srcBoardId === activeBoardId ? 'display' : 'full');
    var targetIndexMode = stackTarget.indexMode || (stackTarget.boardId === activeBoardId ? 'display' : 'full');

    if (
      srcBoardId === stackTarget.boardId &&
      srcBoardId === activeBoardId &&
      srcIndexMode === 'display' &&
      targetIndexMode === 'display'
    ) {
      if (srcRowIdx !== stackTarget.rowIndex || srcStackIdx !== stackTarget.stackIndex) {
        moveStack(srcRowIdx, srcStackIdx, stackTarget.rowIndex, stackTarget.stackIndex, stackTarget.before);
      }
      return true;
    }

    moveStackAcrossBoards(
      { boardId: srcBoardId, rowIndex: srcRowIdx, stackIndex: srcStackIdx, indexMode: srcIndexMode },
      {
        boardId: stackTarget.boardId,
        rowIndex: stackTarget.rowIndex,
        stackIndex: stackTarget.stackIndex,
        before: stackTarget.before,
        indexMode: targetIndexMode
      }
    ).catch(function (err) {
      lexeraLog('error', '[moveStackAcrossBoards] Drop failed: ' + err);
    });
    return true;
  }

  function getTreeColumnDropTarget(mx, my) {
    var treeTarget = resolveDropTargetStrict(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-column"]'), mx, my, true);
    if (!treeTarget) return null;
    var boardId = treeTarget.node.getAttribute('data-board-id') || activeBoardId;
    var rowIdx = parseInt(treeTarget.node.getAttribute('data-row-index'), 10);
    var stackIdx = parseInt(treeTarget.node.getAttribute('data-stack-index'), 10);
    var colIdx = parseInt(treeTarget.node.getAttribute('data-col-local-index'), 10);
    if (isNaN(rowIdx) || isNaN(stackIdx) || isNaN(colIdx)) return null;
    return {
      boardId: boardId,
      rowIndex: rowIdx,
      stackIndex: stackIdx,
      colIndex: colIdx,
      before: treeTarget.before,
      indexMode: boardId === activeBoardId ? 'display' : 'full'
    };
  }

  function getTreeStackDropTarget(mx, my) {
    var treeTarget = resolveDropTargetStrict(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-stack"]'), mx, my, true);
    if (treeTarget) {
      var boardId = treeTarget.node.getAttribute('data-board-id') || activeBoardId;
      var rowIdx = parseInt(treeTarget.node.getAttribute('data-row-index'), 10);
      var stackIdx = parseInt(treeTarget.node.getAttribute('data-stack-index'), 10);
      if (!isNaN(rowIdx) && !isNaN(stackIdx)) {
        return {
          boardId: boardId,
          rowIndex: rowIdx,
          stackIndex: stackIdx,
          before: treeTarget.before,
          indexMode: boardId === activeBoardId ? 'display' : 'full'
        };
      }
    }
    var zone = findNodeAtPoint(getElBoardList().querySelectorAll('.tree-children.tree-stack-drop-zone'), mx, my);
    if (!zone) return null;
    var zoneBoardId = zone.getAttribute('data-board-id') || activeBoardId;
    var zoneRowIdx = parseInt(zone.getAttribute('data-row-index'), 10);
    var zoneStackIdx = parseInt(zone.getAttribute('data-stack-index'), 10);
    if (isNaN(zoneRowIdx) || isNaN(zoneStackIdx)) return null;
    return {
      boardId: zoneBoardId,
      rowIndex: zoneRowIdx,
      stackIndex: zoneStackIdx,
      before: false,
      indexMode: zoneBoardId === activeBoardId ? 'display' : 'full'
    };
  }

  function getTreeCardDropTarget(mx, my) {
    var treeTarget = resolveDropTargetStrict(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-card"]'), mx, my, true);
    if (!treeTarget) return null;
    var boardId = treeTarget.node.getAttribute('data-board-id') || activeBoardId;
    var rowIdx = parseInt(treeTarget.node.getAttribute('data-row-index'), 10);
    var stackIdx = parseInt(treeTarget.node.getAttribute('data-stack-index'), 10);
    var colIdx = parseInt(treeTarget.node.getAttribute('data-col-local-index'), 10);
    var cardIdx = parseInt(treeTarget.node.getAttribute('data-card-index'), 10);
    if (isNaN(rowIdx) || isNaN(stackIdx) || isNaN(colIdx) || isNaN(cardIdx)) return null;
    return {
      kind: 'sidebar',
      boardId: boardId,
      rowIndex: rowIdx,
      stackIndex: stackIdx,
      colIndex: colIdx,
      cardIndex: cardIdx,
      before: treeTarget.before,
      indexMode: boardId === activeBoardId ? 'display' : 'full'
    };
  }

  // Generic target resolver: returns { node, before } with edge snapping.
  function resolveDropTarget(nodeList, mx, my, vertical) {
    for (var i = 0; i < nodeList.length; i++) {
      var rect = nodeList[i].getBoundingClientRect();
      if (isPointInsideRect(mx, my, rect)) {
        var before = vertical ? (my < rect.top + rect.height / 2) : (mx < rect.left + rect.width / 2);
        return { node: nodeList[i], before: before };
      }
    }

    // Edge case: cursor outside all nodes — snap to nearest in the same cross-axis range.
    var lastInRange = null;
    for (var i = 0; i < nodeList.length; i++) {
      var rect = nodeList[i].getBoundingClientRect();
      var inCross = vertical ? (mx >= rect.left && mx <= rect.right) : (my >= rect.top && my <= rect.bottom);
      if (!inCross) continue;
      if (vertical ? (my <= rect.top) : (mx <= rect.left)) {
        return { node: nodeList[i], before: true };
      }
      if (vertical ? (my >= rect.bottom) : (mx >= rect.right)) {
        lastInRange = nodeList[i];
      }
    }
    if (lastInRange) return { node: lastInRange, before: false };
    return null;
  }

  // Strict target resolver: only if pointer is directly inside a node.
  function resolveDropTargetStrict(nodeList, mx, my, vertical) {
    for (var i = 0; i < nodeList.length; i++) {
      var rect = nodeList[i].getBoundingClientRect();
      if (isPointInsideRect(mx, my, rect)) {
        var before = vertical ? (my < rect.top + rect.height / 2) : (mx < rect.left + rect.width / 2);
        return { node: nodeList[i], before: before };
      }
    }
    return null;
  }

  // Generic hit-test: find which element in nodeList the mouse is over, add before/after indicator.
  function ptrFindHitNode(nodeList, mx, my, classBefore, classAfter, vertical) {
    var target = resolveDropTarget(nodeList, mx, my, vertical);
    if (!target) return null;
    target.node.classList.add(target.before ? classBefore : classAfter);
    return target;
  }

  function ptrFindStrictHitNode(nodeList, mx, my, classBefore, classAfter, vertical) {
    var target = resolveDropTargetStrict(nodeList, mx, my, vertical);
    if (!target) return null;
    target.node.classList.add(target.before ? classBefore : classAfter);
    return target;
  }

  function updateColumnPtrDropTarget(mx, my) {
    // Check drop zones first (new-stack insertion points between stacks)
    var zone = findStackDropZoneAt(mx, my);
    if (zone) {
      zone.classList.add('active');
      return true;
    }
    // Check columns (reorder within/between stacks)
    var column = findDraggableColumnAt(mx, my);
    if (column) {
      var colRect = column.getBoundingClientRect();
      if (my < colRect.top + colRect.height / 2) {
        column.classList.add('drag-over-top');
      } else {
        column.classList.add('drag-over-bottom');
      }
      return true;
    }
    // Check stacks (move column into stack)
    var stack = findBoardStackAt(mx, my);
    if (stack) {
      stack.classList.add('column-drop-target');
      return true;
    }
    return false;
  }
  function clearPtrDropIndicators() {
    removeClassesFromNodeList(getElBoardList().querySelectorAll('.tree-node'), ['tree-drop-above', 'tree-drop-below']);
    removeClassesFromNodeList(getElBoardList().querySelectorAll('.board-item'), ['drag-over-top', 'drag-over-bottom']);
    removeClassesFromNodeList(getElColumnsContainer().querySelectorAll('.board-row'), ['drag-over-top', 'drag-over-bottom']);
    removeClassesFromNodeList(getElColumnsContainer().querySelectorAll('.board-stack'), ['drag-over-left', 'drag-over-right', 'column-drop-target']);
    removeClassesFromNodeList(getElColumnsContainer().querySelectorAll('.column'), ['drag-over-top', 'drag-over-bottom']);
    removeClassFromNodeList(getElColumnsContainer().querySelectorAll('.stack-drop-zone'), 'active');
    removeClassFromNodeList(getElBoardList().querySelectorAll('.tree-children.tree-stack-drop-zone.tree-drop-stack-target'), 'tree-drop-stack-target');
    clearCardDropIndicators();
    clearCardDragOverHighlights();
    clearSidebarDropHighlights();
  }

  // Resolve header drop target (Park/Archive/Trash) at the given point.
  // Returns the hidden tag string or null if not over a header button.
  function resolveHeaderDropTag(mx, my) {
    var parkedBtn = document.getElementById('btn-parked');
    var archiveBtn = document.getElementById('btn-archived');
    var trashBtn = document.getElementById('btn-trash');
    if (parkedBtn && isPointInsideRect(mx, my, parkedBtn.getBoundingClientRect())) return '#hidden-internal-parked';
    if (archiveBtn && isPointInsideRect(mx, my, archiveBtn.getBoundingClientRect())) return '#hidden-internal-archived';
    if (trashBtn && isPointInsideRect(mx, my, trashBtn.getBoundingClientRect())) return '#hidden-internal-deleted';
    return null;
  }

  // Apply a hidden tag to the ptrDrag source element (row/stack/column/card).
  async function applyPtrDragHiddenTag(type, src, tag) {
    if (type === 'tree-row' || type === 'board-row') {
      await setRowHiddenTag(src.rowIndex, tag);
    } else if (type === 'tree-stack' || type === 'board-stack') {
      await setStackHiddenTag(src.rowIndex, src.stackIndex, tag);
    } else if (type === 'column' || type === 'tree-column') {
      // Convert display (row, stack, col) indices to full data column
      var stack = findFullDataStack(src.rowIndex, src.stackIndex);
      if (stack) {
        var fullColIdx = findFullColumnIndexInStack(stack, src.colIndex);
        if (fullColIdx >= 0 && stack.columns[fullColIdx]) {
          pushUndo();
          stack.columns[fullColIdx].title = applyInternalHiddenTag(stack.columns[fullColIdx].title || '', tag);
          await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
        }
      }
    } else if (type === 'tree-card') {
      // Tree-card has flatColIndex and cardIndex
      if (typeof src.flatColIndex === 'number' && typeof src.cardIndex === 'number') {
        tagCard(src.flatColIndex, src.cardIndex, tag);
      }
    }
  }

  function executePtrDrop(mx, my) {
    var type = ptrDrag.type;
    var src = ptrDrag.source;

    // Check header drop targets (Park/Archive/Trash) for all non-board types
    if (type !== 'board') {
      var headerTag = resolveHeaderDropTag(mx, my);
      if (headerTag) {
        applyPtrDragHiddenTag(type, src, headerTag);
        return;
      }
    }

    if (type === 'tree-row' || type === 'board-row') {
      applyRowDropByPoint(src, mx, my);
    } else if (type === 'tree-stack' || type === 'board-stack') {
      applyStackDropByPoint(src, mx, my);
    } else if (type === 'board') {
      var t = ptrFindDropTarget(getElBoardList().querySelectorAll('.board-item'), mx, my, true);
      if (t) {
        var targetIdx = parseInt(t.node.getAttribute('data-board-index'), 10);
        if (src.index !== targetIdx) reorderBoards(src.index, targetIdx, t.before);
      }
    } else if (type === 'column' || type === 'tree-column') {
      executeColumnPtrDrop(mx, my, src);
    } else if (type === 'tree-card') {
      if (!isNaN(src.cardIndex)) {
        applyCardDropByPoint(src, mx, my);
      }
    }
  }

  // Generic drop target finder.
  function ptrFindDropTarget(nodeList, mx, my, vertical) {
    return resolveDropTarget(nodeList, mx, my, vertical);
  }

  function executeColumnPtrDrop(mx, my, src) {
    function isSameActiveBoardDisplayTarget(target) {
      return (
        src &&
        src.boardId === activeBoardId &&
        src.indexMode === 'display' &&
        target &&
        target.boardId === activeBoardId &&
        target.indexMode === 'display'
      );
    }

    function moveAcross(targetDef) {
      moveColumnAcrossBoards(src, targetDef).catch(function (err) {
        lexeraLog('error', '[moveColumnAcrossBoards] Drop failed: ' + err);
      });
    }

    // Check drop zones first (create new stack at specific position)
    var zone = findStackDropZoneAt(mx, my);
    if (zone) {
      var targetRowIdx = parseInt(zone.getAttribute('data-row-index'), 10);
      var insertIdx = parseInt(zone.getAttribute('data-insert-index'), 10);
      var zoneTarget = {
        kind: 'new-stack',
        boardId: activeBoardId,
        rowIndex: targetRowIdx,
        insertAtStackIdx: insertIdx,
        indexMode: 'display'
      };
      if (isSameActiveBoardDisplayTarget(zoneTarget)) {
        moveColumnToNewStack(src.rowIndex, src.stackIndex, src.colIndex, targetRowIdx, insertIdx);
      } else {
        moveAcross(zoneTarget);
      }
      return;
    }
    // Check columns (reorder)
    var column = findDraggableColumnAt(mx, my);
    if (column) {
      var colRect = column.getBoundingClientRect();
      var stackEl = column.closest('.board-stack');
      var targetRowIdx = parseInt(stackEl.getAttribute('data-row-index'), 10);
      var targetStackIdx = parseInt(stackEl.getAttribute('data-stack-index'), 10);
      var columns = stackEl.querySelectorAll('.board-stack-content > .column');
      var targetColIdx = Array.prototype.indexOf.call(columns, column);
      var insertBefore = my < colRect.top + colRect.height / 2;
      var colTarget = {
        kind: 'column',
        boardId: activeBoardId,
        rowIndex: targetRowIdx,
        stackIndex: targetStackIdx,
        colIndex: targetColIdx,
        before: insertBefore,
        indexMode: 'display'
      };
      if (isSameActiveBoardDisplayTarget(colTarget)) {
        moveColumnWithinBoard(src.rowIndex, src.stackIndex, src.colIndex, targetRowIdx, targetStackIdx, targetColIdx, insertBefore);
      } else {
        moveAcross(colTarget);
      }
      return;
    }
    // Check stacks (move column into existing stack)
    var stack = findBoardStackAt(mx, my);
    if (stack) {
      var targetRowIdx = parseInt(stack.getAttribute('data-row-index'), 10);
      var targetStackIdx = parseInt(stack.getAttribute('data-stack-index'), 10);
      var stackTarget = {
        kind: 'stack',
        boardId: activeBoardId,
        rowIndex: targetRowIdx,
        stackIndex: targetStackIdx,
        indexMode: 'display'
      };
      if (isSameActiveBoardDisplayTarget(stackTarget)) {
        if (src.rowIndex !== targetRowIdx || src.stackIndex !== targetStackIdx) {
          moveColumnToExistingStack(src.rowIndex, src.stackIndex, src.colIndex, targetRowIdx, targetStackIdx);
        }
      } else {
        moveAcross(stackTarget);
      }
      return;
    }

    // Check hierarchy columns (reorder via sidebar tree)
    var treeColTarget = getTreeColumnDropTarget(mx, my);
    if (treeColTarget) {
      if (isSameActiveBoardDisplayTarget(treeColTarget)) {
        if (src.rowIndex !== treeColTarget.rowIndex || src.stackIndex !== treeColTarget.stackIndex || src.colIndex !== treeColTarget.colIndex) {
          moveColumnWithinBoard(
            src.rowIndex,
            src.stackIndex,
            src.colIndex,
            treeColTarget.rowIndex,
            treeColTarget.stackIndex,
            treeColTarget.colIndex,
            treeColTarget.before
          );
        }
      } else {
        moveAcross({
          kind: 'column',
          boardId: treeColTarget.boardId,
          rowIndex: treeColTarget.rowIndex,
          stackIndex: treeColTarget.stackIndex,
          colIndex: treeColTarget.colIndex,
          before: treeColTarget.before,
          indexMode: treeColTarget.indexMode
        });
      }
      return;
    }

    // Check hierarchy stacks (append into target stack)
    var treeStackTarget = getTreeStackDropTarget(mx, my);
    if (treeStackTarget) {
      if (isSameActiveBoardDisplayTarget(treeStackTarget)) {
        if (src.rowIndex !== treeStackTarget.rowIndex || src.stackIndex !== treeStackTarget.stackIndex) {
          moveColumnToExistingStack(src.rowIndex, src.stackIndex, src.colIndex, treeStackTarget.rowIndex, treeStackTarget.stackIndex);
        }
      } else {
        moveAcross({
          kind: 'stack',
          boardId: treeStackTarget.boardId,
          rowIndex: treeStackTarget.rowIndex,
          stackIndex: treeStackTarget.stackIndex,
          indexMode: treeStackTarget.indexMode
        });
      }
      return;
    }
  }

  function resolveColumnLocationForMutation(boardId, boardData, rowIndex, stackIndex, colIndex, indexMode) {
    if (!boardData || !boardData.rows) return null;
    if (indexMode === 'display' && boardId === activeBoardId) {
      var row = findFullDataRow(rowIndex);
      var stack = findFullDataStack(rowIndex, stackIndex);
      if (!row || !stack) return null;
      var fullColIdx = findFullColumnIndexInStack(stack, colIndex);
      if (fullColIdx === -1) return null;
      return {
        row: row,
        stack: stack,
        rowIndex: fullBoardData.rows.indexOf(row),
        stackIndex: row.stacks.indexOf(stack),
        colIndex: fullColIdx
      };
    }
    if (indexMode === 'display') {
      var displayRow = boardData.rows[rowIndex];
      if (!displayRow || !displayRow.stacks || stackIndex < 0 || stackIndex >= displayRow.stacks.length) return null;
      var displayStack = displayRow.stacks[stackIndex];
      if (!displayStack || !displayStack.columns) return null;
      var mappedColIdx = findFullColumnIndexInStack(displayStack, colIndex);
      if (mappedColIdx === -1) return null;
      return {
        row: displayRow,
        stack: displayStack,
        rowIndex: rowIndex,
        stackIndex: stackIndex,
        colIndex: mappedColIdx
      };
    }
    var targetRow = boardData.rows[rowIndex];
    if (!targetRow || !targetRow.stacks || stackIndex < 0 || stackIndex >= targetRow.stacks.length) return null;
    var targetStack = targetRow.stacks[stackIndex];
    if (!targetStack || !targetStack.columns || colIndex < 0 || colIndex >= targetStack.columns.length) return null;
    return {
      row: targetRow,
      stack: targetStack,
      rowIndex: rowIndex,
      stackIndex: stackIndex,
      colIndex: colIndex
    };
  }

  function resolveStackForMutation(boardId, boardData, rowIndex, stackIndex, indexMode) {
    if (!boardData || !boardData.rows) return null;
    if (indexMode === 'display' && boardId === activeBoardId) {
      var row = findFullDataRow(rowIndex);
      var stack = findFullDataStack(rowIndex, stackIndex);
      if (!row || !stack) return null;
      return {
        row: row,
        stack: stack,
        rowIndex: fullBoardData.rows.indexOf(row),
        stackIndex: row.stacks.indexOf(stack)
      };
    }
    var targetRow = boardData.rows[rowIndex];
    if (!targetRow || !targetRow.stacks || stackIndex < 0 || stackIndex >= targetRow.stacks.length) return null;
    return {
      row: targetRow,
      stack: targetRow.stacks[stackIndex],
      rowIndex: rowIndex,
      stackIndex: stackIndex
    };
  }

  function resolveRowForMutation(boardId, boardData, rowIndex, indexMode) {
    if (!boardData || !boardData.rows) return null;
    if (indexMode === 'display' && boardId === activeBoardId) {
      var row = findFullDataRow(rowIndex);
      if (!row) return null;
      return { row: row, rowIndex: fullBoardData.rows.indexOf(row) };
    }
    if (rowIndex < 0 || rowIndex >= boardData.rows.length) return null;
    return { row: boardData.rows[rowIndex], rowIndex: rowIndex };
  }

  async function moveRowAcrossBoards(source, target) {
    if (!source || !target || !source.boardId || !target.boardId) return;

    var sourceBoardId = source.boardId;
    var targetBoardId = target.boardId;
    var sourceBoardData = await loadBoardDataForMutation(sourceBoardId);
    if (!sourceBoardData) return;
    var targetBoardData = sourceBoardId === targetBoardId
      ? sourceBoardData
      : await loadBoardDataForMutation(targetBoardId);
    if (!targetBoardData) return;

    var sourceRowInfo = resolveRowForMutation(
      sourceBoardId,
      sourceBoardData,
      source.rowIndex,
      source.indexMode || 'full'
    );
    if (!sourceRowInfo || !sourceRowInfo.row) return;

    var targetRowInfo = resolveRowForMutation(
      targetBoardId,
      targetBoardData,
      target.rowIndex,
      target.indexMode || 'full'
    );

    var activeTouched = sourceBoardId === activeBoardId || targetBoardId === activeBoardId;
    if (activeTouched && fullBoardData) pushUndo();

    var movedRow = sourceBoardData.rows.splice(sourceRowInfo.rowIndex, 1)[0];
    if (!movedRow) return;

    var insertAt = targetBoardData.rows.length;
    if (targetRowInfo && targetRowInfo.row) {
      insertAt = target.before ? targetRowInfo.rowIndex : (targetRowInfo.rowIndex + 1);
      if (sourceBoardData === targetBoardData && sourceRowInfo.rowIndex < insertAt) insertAt--;
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > targetBoardData.rows.length) insertAt = targetBoardData.rows.length;

    if (sourceBoardData === targetBoardData && insertAt === sourceRowInfo.rowIndex) {
      sourceBoardData.rows.splice(sourceRowInfo.rowIndex, 0, movedRow);
      return;
    }

    targetBoardData.rows.splice(insertAt, 0, movedRow);

    removeEmptyStacksAndRowsInBoard(sourceBoardData);
    if (sourceBoardData !== targetBoardData) removeEmptyStacksAndRowsInBoard(targetBoardData);

    var changedRows = {};
    changedRows[sourceBoardId] = sourceBoardData;
    if (targetBoardId !== sourceBoardId) changedRows[targetBoardId] = targetBoardData;
    await commitBoardMutations(changedRows, { refreshSidebar: true });
  }

  async function moveStackAcrossBoards(source, target) {
    if (!source || !target || !source.boardId || !target.boardId) return;

    var sourceBoardId = source.boardId;
    var targetBoardId = target.boardId;
    var sourceBoardData = await loadBoardDataForMutation(sourceBoardId);
    if (!sourceBoardData) return;
    var targetBoardData = sourceBoardId === targetBoardId
      ? sourceBoardData
      : await loadBoardDataForMutation(targetBoardId);
    if (!targetBoardData) return;

    var sourceStackInfo = resolveStackForMutation(
      sourceBoardId,
      sourceBoardData,
      source.rowIndex,
      source.stackIndex,
      source.indexMode || 'full'
    );
    if (!sourceStackInfo || !sourceStackInfo.stack || !sourceStackInfo.row) return;

    var targetRowInfo = resolveRowForMutation(
      targetBoardId,
      targetBoardData,
      target.rowIndex,
      target.indexMode || 'full'
    );
    if (!targetRowInfo || !targetRowInfo.row || !targetRowInfo.row.stacks) return;

    var targetStackInfo = resolveStackForMutation(
      targetBoardId,
      targetBoardData,
      target.rowIndex,
      target.stackIndex,
      target.indexMode || 'full'
    );

    var activeTouched = sourceBoardId === activeBoardId || targetBoardId === activeBoardId;
    if (activeTouched && fullBoardData) pushUndo();

    var movedStack = sourceStackInfo.row.stacks.splice(sourceStackInfo.stackIndex, 1)[0];
    if (!movedStack) return;

    var insertAt = targetRowInfo.row.stacks.length;
    if (targetStackInfo && targetStackInfo.stack) {
      insertAt = target.before ? targetStackInfo.stackIndex : (targetStackInfo.stackIndex + 1);
      if (sourceBoardData === targetBoardData && sourceStackInfo.row === targetRowInfo.row && sourceStackInfo.stackIndex < insertAt) {
        insertAt--;
      }
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > targetRowInfo.row.stacks.length) insertAt = targetRowInfo.row.stacks.length;

    if (sourceBoardData === targetBoardData && sourceStackInfo.row === targetRowInfo.row && insertAt === sourceStackInfo.stackIndex) {
      sourceStackInfo.row.stacks.splice(sourceStackInfo.stackIndex, 0, movedStack);
      return;
    }

    targetRowInfo.row.stacks.splice(insertAt, 0, movedStack);

    removeEmptyStacksAndRowsInBoard(sourceBoardData);
    if (sourceBoardData !== targetBoardData) removeEmptyStacksAndRowsInBoard(targetBoardData);

    var changedStacks = {};
    changedStacks[sourceBoardId] = sourceBoardData;
    if (targetBoardId !== sourceBoardId) changedStacks[targetBoardId] = targetBoardData;
    await commitBoardMutations(changedStacks, { refreshSidebar: true });
  }

  async function moveColumnAcrossBoards(source, target) {
    if (!source || !target || !source.boardId || !target.boardId) { lexeraLogWithTarget('warn', 'COL-XBOARD', 'abort: missing source/target boardId'); return; }

    var sourceBoardId = source.boardId;
    var targetBoardId = target.boardId;
    var sourceBoardData = await loadBoardDataForMutation(sourceBoardId);
    if (!sourceBoardData) { lexeraLogWithTarget('warn', 'COL-XBOARD', 'abort: no sourceBoardData'); return; }
    var targetBoardData = sourceBoardId === targetBoardId
      ? sourceBoardData
      : await loadBoardDataForMutation(targetBoardId);
    if (!targetBoardData) { lexeraLogWithTarget('warn', 'COL-XBOARD', 'abort: no targetBoardData'); return; }

    var sourceLoc = resolveColumnLocationForMutation(
      sourceBoardId,
      sourceBoardData,
      source.rowIndex,
      source.stackIndex,
      source.colIndex,
      source.indexMode || 'full'
    );
    if (!sourceLoc || !sourceLoc.stack || !sourceLoc.stack.columns) { lexeraLogWithTarget('warn', 'COL-XBOARD', 'abort: sourceLoc not resolved'); return; }

    var activeTouched = sourceBoardId === activeBoardId || targetBoardId === activeBoardId;
    if (activeTouched && fullBoardData) pushUndo();

    var movedColumn = sourceLoc.stack.columns.splice(sourceLoc.colIndex, 1)[0];
    if (!movedColumn) return;

    var insertStack = null;
    var insertAt = 0;

    if (target.kind === 'new-stack') {
      var targetRowInfo = resolveRowForMutation(
        targetBoardId,
        targetBoardData,
        target.rowIndex,
        target.indexMode || 'full'
      );
      if (!targetRowInfo || !targetRowInfo.row || !targetRowInfo.row.stacks) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
      var newStack = {
        id: 'stack-' + Date.now(),
        title: '',
        columns: [movedColumn]
      };
      var stackInsertIdx;
      if (typeof target.insertAtStackIdx === 'number' && (target.indexMode || 'full') === 'display' && targetBoardId === activeBoardId) {
        stackInsertIdx = findInsertStackIndexInRow(targetRowInfo.row, target.rowIndex, target.insertAtStackIdx);
      } else if (typeof target.insertAtStackIdx === 'number') {
        stackInsertIdx = target.insertAtStackIdx;
      } else {
        stackInsertIdx = targetRowInfo.row.stacks.length;
      }
      if (stackInsertIdx < 0) stackInsertIdx = 0;
      if (stackInsertIdx > targetRowInfo.row.stacks.length) stackInsertIdx = targetRowInfo.row.stacks.length;
      targetRowInfo.row.stacks.splice(stackInsertIdx, 0, newStack);
      removeEmptyStacksAndRowsInBoard(sourceBoardData);
      if (sourceBoardData !== targetBoardData) removeEmptyStacksAndRowsInBoard(targetBoardData);
      var changedNewStackBoards = {};
      changedNewStackBoards[sourceBoardId] = sourceBoardData;
      if (targetBoardId !== sourceBoardId) changedNewStackBoards[targetBoardId] = targetBoardData;
      await commitBoardMutations(changedNewStackBoards, { refreshSidebar: true });
      return;
    }

    if (target.kind === 'stack') {
      var targetStackInfo = resolveStackForMutation(
        targetBoardId,
        targetBoardData,
        target.rowIndex,
        target.stackIndex,
        target.indexMode || 'full'
      );
      if (!targetStackInfo || !targetStackInfo.stack || !targetStackInfo.stack.columns) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
      insertStack = targetStackInfo.stack;
      insertAt = insertStack.columns.length;
    } else if (target.kind === 'column') {
      var targetStackForCol = resolveStackForMutation(
        targetBoardId,
        targetBoardData,
        target.rowIndex,
        target.stackIndex,
        target.indexMode || 'full'
      );
      if (!targetStackForCol || !targetStackForCol.stack || !targetStackForCol.stack.columns) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
      insertStack = targetStackForCol.stack;
      if (target.indexMode === 'display' && targetBoardId === activeBoardId) {
        insertAt = findInsertColumnIndexInStack(insertStack, target.colIndex, target.before);
      } else {
        insertAt = target.before ? target.colIndex : (target.colIndex + 1);
      }
    } else {
      return;
    }

    if (!insertStack || !insertStack.columns) {
      sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
      return;
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > insertStack.columns.length) insertAt = insertStack.columns.length;

    if (sourceBoardData === targetBoardData && sourceLoc.stack === insertStack) {
      if (sourceLoc.colIndex < insertAt) insertAt--;
      if (insertAt === sourceLoc.colIndex) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
    }

    insertStack.columns.splice(insertAt, 0, movedColumn);
    removeEmptyStacksAndRowsInBoard(sourceBoardData);
    if (sourceBoardData !== targetBoardData) removeEmptyStacksAndRowsInBoard(targetBoardData);

    var changed = {};
    changed[sourceBoardId] = sourceBoardData;
    if (targetBoardId !== sourceBoardId) changed[targetBoardId] = targetBoardData;
    await commitBoardMutations(changed, { refreshSidebar: true });
    return;
  }

  function insertStackDropZones() {
    var rowContents = getElColumnsContainer().querySelectorAll('.board-row-content');
    for (var r = 0; r < rowContents.length; r++) {
      var rowContent = rowContents[r];
      var rowEl = rowContent.closest('.board-row');
      var rowIdx = rowEl.getAttribute('data-row-index');
      var stacks = rowContent.querySelectorAll(':scope > .board-stack');
      // Create fixed overlay drop zones: far left, far right, and between stacks.
      // These zones are absolutely positioned and do not affect layout flow.
      if (stacks.length === 0) {
        var emptyZone = document.createElement('div');
        emptyZone.className = 'stack-drop-zone';
        emptyZone.setAttribute('data-row-index', rowIdx);
        emptyZone.setAttribute('data-insert-index', '0');
        emptyZone.style.left = '12px';
        emptyZone.style.height = Math.max(72, rowContent.clientHeight - 8) + 'px';
        rowContent.appendChild(emptyZone);
        continue;
      }

      var zoneHeight = Math.max(72, rowContent.clientHeight - 8);
      for (var s = 0; s <= stacks.length; s++) {
        var anchorX;
        if (s === 0) {
          anchorX = stacks[0].offsetLeft;
        } else if (s === stacks.length) {
          anchorX = stacks[s - 1].offsetLeft + stacks[s - 1].offsetWidth;
        } else {
          anchorX = stacks[s].offsetLeft;
        }
        var zone = document.createElement('div');
        zone.className = 'stack-drop-zone';
        zone.setAttribute('data-row-index', rowIdx);
        zone.setAttribute('data-insert-index', s.toString());
        zone.style.left = anchorX + 'px';
        zone.style.height = zoneHeight + 'px';
        rowContent.appendChild(zone);
      }
    }
  }

  function removeStackDropZones() {
    var zones = getElColumnsContainer().querySelectorAll('.stack-drop-zone');
    for (var i = 0; i < zones.length; i++) zones[i].remove();
  }

  // --- Visual drop zone indicators (cosmetic only, no hit-testing) ---

  function insertDropZoneIndicators(dragType) {
    removeDropZoneIndicators();
    var container = getElColumnsContainer();
    if (dragType === 'card' || dragType === 'tree-card') {
      // Vertical indicators between columns within each stack
      var stackContents = container.querySelectorAll('.board-stack-content');
      for (var s = 0; s < stackContents.length; s++) {
        var stackContent = stackContents[s];
        var cols = stackContent.querySelectorAll(':scope > .column:not(.dragging)');
        if (cols.length === 0) continue;
        // Ensure parent is position:relative for absolute children
        if (getComputedStyle(stackContent).position === 'static') {
          stackContent.style.position = 'relative';
        }
        // Between each pair of columns and at left/right edges
        for (var c = 0; c <= cols.length; c++) {
          var ind = document.createElement('div');
          ind.className = 'drop-zone-indicator vertical';
          ind.setAttribute('data-drop-zone-type', 'card-column');
          if (c === 0) {
            ind.style.left = '0px';
          } else if (c === cols.length) {
            ind.style.left = (cols[c - 1].offsetLeft + cols[c - 1].offsetWidth) + 'px';
          } else {
            ind.style.left = cols[c].offsetLeft + 'px';
          }
          ind.style.transform = 'translateX(-50%)';
          stackContent.appendChild(ind);
        }
      }
    } else if (dragType === 'board-row' || dragType === 'tree-row') {
      // Horizontal indicators between rows
      var rows = container.querySelectorAll('.board-row');
      if (rows.length === 0) return;
      if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }
      for (var r = 0; r <= rows.length; r++) {
        var ind = document.createElement('div');
        ind.className = 'drop-zone-indicator horizontal';
        ind.setAttribute('data-drop-zone-type', 'row');
        if (r === 0) {
          ind.style.top = rows[0].offsetTop + 'px';
        } else if (r === rows.length) {
          ind.style.top = (rows[r - 1].offsetTop + rows[r - 1].offsetHeight) + 'px';
        } else {
          ind.style.top = rows[r].offsetTop + 'px';
        }
        ind.style.transform = 'translateY(-50%)';
        container.appendChild(ind);
      }
    } else if (dragType === 'board-stack' || dragType === 'tree-stack') {
      // Vertical indicators between stacks within each row
      var rowContents = container.querySelectorAll('.board-row-content');
      for (var rc = 0; rc < rowContents.length; rc++) {
        var rowContent = rowContents[rc];
        var stacks = rowContent.querySelectorAll(':scope > .board-stack');
        if (stacks.length === 0) continue;
        if (getComputedStyle(rowContent).position === 'static') {
          rowContent.style.position = 'relative';
        }
        for (var st = 0; st <= stacks.length; st++) {
          var ind = document.createElement('div');
          ind.className = 'drop-zone-indicator vertical';
          ind.setAttribute('data-drop-zone-type', 'stack');
          if (st === 0) {
            ind.style.left = stacks[0].offsetLeft + 'px';
          } else if (st === stacks.length) {
            ind.style.left = (stacks[st - 1].offsetLeft + stacks[st - 1].offsetWidth) + 'px';
          } else {
            ind.style.left = stacks[st].offsetLeft + 'px';
          }
          ind.style.transform = 'translateX(-50%)';
          rowContent.appendChild(ind);
        }
      }
    } else if (dragType === 'column' || dragType === 'tree-column') {
      // Horizontal indicators between columns within each stack (columns stack vertically)
      var stackContents = container.querySelectorAll('.board-stack-content');
      for (var s = 0; s < stackContents.length; s++) {
        var stackContent = stackContents[s];
        var cols = stackContent.querySelectorAll(':scope > .column:not(.dragging)');
        if (cols.length === 0) continue;
        if (getComputedStyle(stackContent).position === 'static') {
          stackContent.style.position = 'relative';
        }
        for (var c = 0; c <= cols.length; c++) {
          var ind = document.createElement('div');
          ind.className = 'drop-zone-indicator horizontal';
          ind.setAttribute('data-drop-zone-type', 'column');
          if (c === 0) {
            ind.style.top = cols[0].offsetTop + 'px';
          } else if (c === cols.length) {
            ind.style.top = (cols[c - 1].offsetTop + cols[c - 1].offsetHeight) + 'px';
          } else {
            ind.style.top = cols[c].offsetTop + 'px';
          }
          ind.style.transform = 'translateY(-50%)';
          stackContent.appendChild(ind);
        }
      }
    }
  }

  function removeDropZoneIndicators() {
    var indicators = document.querySelectorAll('.drop-zone-indicator');
    for (var i = 0; i < indicators.length; i++) indicators[i].remove();
  }

  function clearDropZoneIndicatorHighlights() {
    var indicators = document.querySelectorAll('.drop-zone-indicator.active');
    for (var i = 0; i < indicators.length; i++) indicators[i].classList.remove('active');
  }

  function highlightDropZoneIndicator(dragType, mx, my) {
    clearDropZoneIndicatorHighlights();
    var container = getElColumnsContainer();

    if (dragType === 'card' || dragType === 'tree-card') {
      // Highlight the indicator in the column-cards container that has card-drag-over
      var overContainer = container.querySelector('.column-cards.card-drag-over');
      if (!overContainer) return;
      var column = overContainer.closest('.column');
      if (!column) return;
      var stackContent = column.closest('.board-stack-content');
      if (!stackContent) return;
      var cols = stackContent.querySelectorAll(':scope > .column:not(.dragging)');
      var colIdx = Array.prototype.indexOf.call(cols, column);
      if (colIdx < 0) return;
      // Highlight indicator to the left of the target column
      var indicators = stackContent.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="card-column"]');
      // Determine if mouse is in left or right half of the column
      var colRect = column.getBoundingClientRect();
      var inLeftHalf = mx < colRect.left + colRect.width / 2;
      var targetIdx = inLeftHalf ? colIdx : colIdx + 1;
      if (targetIdx >= 0 && targetIdx < indicators.length) {
        indicators[targetIdx].classList.add('active');
      }
    } else if (dragType === 'board-row' || dragType === 'tree-row') {
      // Find the row with drag-over-top or drag-over-bottom
      var topRow = container.querySelector('.board-row.drag-over-top');
      var bottomRow = container.querySelector('.board-row.drag-over-bottom');
      var rows = container.querySelectorAll('.board-row');
      var indicators = container.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="row"]');
      if (topRow) {
        var idx = Array.prototype.indexOf.call(rows, topRow);
        if (idx >= 0 && idx < indicators.length) indicators[idx].classList.add('active');
      } else if (bottomRow) {
        var idx = Array.prototype.indexOf.call(rows, bottomRow);
        if (idx >= 0 && idx + 1 < indicators.length) indicators[idx + 1].classList.add('active');
      }
    } else if (dragType === 'board-stack' || dragType === 'tree-stack') {
      // Find the stack with drag-over-left or drag-over-right
      var leftStack = container.querySelector('.board-stack.drag-over-left');
      var rightStack = container.querySelector('.board-stack.drag-over-right');
      if (leftStack) {
        var rowContent = leftStack.closest('.board-row-content');
        if (rowContent) {
          var stacks = rowContent.querySelectorAll(':scope > .board-stack');
          var indicators = rowContent.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="stack"]');
          var idx = Array.prototype.indexOf.call(stacks, leftStack);
          if (idx >= 0 && idx < indicators.length) indicators[idx].classList.add('active');
        }
      } else if (rightStack) {
        var rowContent = rightStack.closest('.board-row-content');
        if (rowContent) {
          var stacks = rowContent.querySelectorAll(':scope > .board-stack');
          var indicators = rowContent.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="stack"]');
          var idx = Array.prototype.indexOf.call(stacks, rightStack);
          if (idx >= 0 && idx + 1 < indicators.length) indicators[idx + 1].classList.add('active');
        }
      }
    } else if (dragType === 'column' || dragType === 'tree-column') {
      // Find the column with drag-over-top or drag-over-bottom
      var topCol = container.querySelector('.column.drag-over-top');
      var bottomCol = container.querySelector('.column.drag-over-bottom');
      if (topCol) {
        var stackContent = topCol.closest('.board-stack-content');
        if (stackContent) {
          var cols = stackContent.querySelectorAll(':scope > .column:not(.dragging)');
          var indicators = stackContent.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="column"]');
          var idx = Array.prototype.indexOf.call(cols, topCol);
          if (idx >= 0 && idx < indicators.length) indicators[idx].classList.add('active');
        }
      } else if (bottomCol) {
        var stackContent = bottomCol.closest('.board-stack-content');
        if (stackContent) {
          var cols = stackContent.querySelectorAll(':scope > .column:not(.dragging)');
          var indicators = stackContent.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="column"]');
          var idx = Array.prototype.indexOf.call(cols, bottomCol);
          if (idx >= 0 && idx + 1 < indicators.length) indicators[idx + 1].classList.add('active');
        }
      }
    }
  }

  function cleanupPtrDrag() {
    removeStackDropZones();
    removeDropZoneIndicators();
    clearHeaderDropTargetHighlights();
    stopCrossViewBridge();
    unlockBoardLayoutForDrag();
    if (ptrDrag) {
      if (ptrDrag.el) ptrDrag.el.classList.remove('dragging');
      if (ptrDrag.ghost) ptrDrag.ghost.remove();
      ptrDrag = null;
    }
    clearPtrDropIndicators();
    vsRestoreAfterDrag();
  }

  function resolveColumnRefForCardMutation(boardId, boardData, descriptor) {
    if (!descriptor) return null;
    var indexMode = descriptor.indexMode || (boardId === activeBoardId ? 'display' : 'full');

    if (
      typeof descriptor.rowIndex === 'number' &&
      typeof descriptor.stackIndex === 'number' &&
      typeof descriptor.colIndex === 'number'
    ) {
      if (indexMode === 'display') {
        if (boardId === activeBoardId) {
          var activeDisplayStack = findFullDataStack(descriptor.rowIndex, descriptor.stackIndex);
          if (!activeDisplayStack) return null;
          var activeColIdx = findFullColumnIndexInStack(activeDisplayStack, descriptor.colIndex);
          if (activeColIdx === -1 || activeColIdx >= activeDisplayStack.columns.length) return null;
          return { column: activeDisplayStack.columns[activeColIdx], columnIndex: activeColIdx, stack: activeDisplayStack };
        }
        var displayRow = boardData.rows[descriptor.rowIndex];
        if (!displayRow || !displayRow.stacks || descriptor.stackIndex < 0 || descriptor.stackIndex >= displayRow.stacks.length) return null;
        var displayStack = displayRow.stacks[descriptor.stackIndex];
        if (!displayStack || !displayStack.columns) return null;
        var fullColIdx = findFullColumnIndexInStack(displayStack, descriptor.colIndex);
        if (fullColIdx === -1 || fullColIdx >= displayStack.columns.length) return null;
        return { column: displayStack.columns[fullColIdx], columnIndex: fullColIdx, stack: displayStack };
      }
      var treeCol = getBoardColumnByPath(boardData, descriptor.rowIndex, descriptor.stackIndex, descriptor.colIndex);
      if (!treeCol) return null;
      var treeStack = boardData.rows[descriptor.rowIndex].stacks[descriptor.stackIndex];
      return { column: treeCol, columnIndex: descriptor.colIndex, stack: treeStack };
    }

    var flatColIndex = null;
    if (typeof descriptor.flatColIndex === 'number') flatColIndex = descriptor.flatColIndex;
    else if (typeof descriptor.colIndex === 'number') flatColIndex = descriptor.colIndex;
    if (flatColIndex == null || isNaN(flatColIndex)) return null;

    var flatContainer = findColumnContainerInBoard(boardData, flatColIndex);
    if (!flatContainer) return null;
    return {
      column: flatContainer.arr[flatContainer.localIdx],
      columnIndex: flatContainer.localIdx,
      stack: flatContainer.stack
    };
  }

  function resolveSourceCardIndex(column, cardIndex, cardIndexMode) {
    if (!column || !column.cards || typeof cardIndex !== 'number') return -1;
    if (cardIndexMode === 'full') {
      return (cardIndex >= 0 && cardIndex < column.cards.length) ? cardIndex : -1;
    }
    return getFullCardIndex(column, cardIndex);
  }

  function resolveInsertCardIndex(column, insertIdx, insertMode) {
    if (!column || !column.cards) return -1;
    if (insertMode === 'full') {
      var idx = typeof insertIdx === 'number' ? insertIdx : column.cards.length;
      if (idx < 0) idx = 0;
      if (idx > column.cards.length) idx = column.cards.length;
      return idx;
    }
    var visibleIdx = typeof insertIdx === 'number' ? insertIdx : column.cards.length;
    var fullIdx = getFullCardIndex(column, visibleIdx);
    if (fullIdx === -1) fullIdx = column.cards.length;
    return fullIdx;
  }

  async function moveCard(sourceOrFromColIdx, fromCardIdxOrTarget, toColIdx, toInsertIdx) {
    try {
      var source;
      var target;

      if (typeof sourceOrFromColIdx === 'object' && sourceOrFromColIdx) {
        source = sourceOrFromColIdx;
        target = fromCardIdxOrTarget;
      } else {
        source = {
          boardId: activeBoardId,
          flatColIndex: sourceOrFromColIdx,
          cardIndex: fromCardIdxOrTarget,
          cardIndexMode: 'visible',
          indexMode: 'display'
        };
        target = {
          boardId: activeBoardId,
          flatColIndex: toColIdx,
          insertIdx: toInsertIdx,
          insertMode: 'visible',
          indexMode: 'display'
        };
      }

      if (!source || !target || !source.boardId || !target.boardId) return;

      var sourceBoardData = await loadBoardDataForMutation(source.boardId);
      if (!sourceBoardData) return;
      var targetBoardData = source.boardId === target.boardId
        ? sourceBoardData
        : await loadBoardDataForMutation(target.boardId);
      if (!targetBoardData) return;

      var sourceRef = resolveColumnRefForCardMutation(source.boardId, sourceBoardData, source);
      var targetRef = resolveColumnRefForCardMutation(target.boardId, targetBoardData, target);
      if (!sourceRef || !sourceRef.column || !targetRef || !targetRef.column) return;

      var sourceCardMode = source.cardIndexMode || (source.boardId === activeBoardId ? 'visible' : 'full');
      var sourceCardIdx = resolveSourceCardIndex(sourceRef.column, source.cardIndex, sourceCardMode);
      if (sourceCardIdx < 0 || sourceCardIdx >= sourceRef.column.cards.length) return;

      var targetInsertMode = target.insertMode || 'visible';
      var targetInsertIdx = resolveInsertCardIndex(targetRef.column, target.insertIdx, targetInsertMode);
      if (targetInsertIdx < 0) return;

      var activeTouched = source.boardId === activeBoardId || target.boardId === activeBoardId;
      if (activeTouched && fullBoardData) pushUndo();

      var movedCard = sourceRef.column.cards.splice(sourceCardIdx, 1)[0];
      if (!movedCard) return;

      if (sourceBoardData === targetBoardData && sourceRef.column === targetRef.column) {
        if (sourceCardIdx < targetInsertIdx) targetInsertIdx--;
        if (targetInsertIdx === sourceCardIdx) {
          sourceRef.column.cards.splice(sourceCardIdx, 0, movedCard);
          return;
        }
      }

      if (targetInsertIdx < 0) targetInsertIdx = 0;
      if (targetInsertIdx > targetRef.column.cards.length) targetInsertIdx = targetRef.column.cards.length;
      targetRef.column.cards.splice(targetInsertIdx, 0, movedCard);

      var changedBoards = {};
      changedBoards[source.boardId] = sourceBoardData;
      if (target.boardId !== source.boardId) changedBoards[target.boardId] = targetBoardData;
      await commitBoardMutations(changedBoards, { refreshSidebar: true });
    } catch (err) {
      lexeraLog('error', '[moveCard] Failed: ' + err);
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

  function getCurrentEditorBoardId() {
    if (currentCardEditor && currentCardEditor.boardId) return currentCardEditor.boardId;
    return activeBoardId || '';
  }

  function getCurrentEditorFilePath() {
    var boardId = getCurrentEditorBoardId();
    return getBoardFilePathForId(boardId) || getActiveBoardFilePath() || '';
  }

  function safeDecodePath(value) {
    var text = String(value || '');
    try {
      return decodeURIComponent(text);
    } catch (e) {
      return text;
    }
  }

  function isWindowsAbsolutePath(value) {
    return /^[a-zA-Z]:[\\/]/.test(String(value || ''));
  }

  function normalizeWindowsAbsolutePath(value) {
    return normalizePathForCompare(String(value || ''));
  }

  function isRelativeResourcePath(value) {
    var normalized = String(value || '').trim();
    if (!normalized) return false;
    return normalized.charAt(0) !== '/' &&
      !isWindowsAbsolutePath(normalized) &&
      !/^(https?:\/\/|mailto:|data:|blob:|vscode-webview:\/\/)/i.test(normalized);
  }

  function resolveRelativePath(baseDir, relativePath) {
    return joinBoardRelativePath(baseDir, relativePath);
  }

  function buildWebviewResourceUrl(pathValue) {
    var resolvedPath = normalizeWindowsAbsolutePath(safeDecodePath(pathValue));
    if (!resolvedPath || /^(https?:\/\/|mailto:|data:|blob:|vscode-webview:\/\/)/i.test(resolvedPath)) {
      return resolvedPath;
    }
    var boardId = getCurrentEditorBoardId();
    if (!boardId) return resolvedPath;
    return LexeraApi.fileUrl(boardId, resolvedPath);
  }

  function resolveCurrentEditorResourcePath(pathValue, includeDir) {
    var decodedPath = safeDecodePath(pathValue);
    if (!decodedPath) return '';
    if (!isRelativeResourcePath(decodedPath)) {
      return normalizeWindowsAbsolutePath(decodedPath);
    }
    if (includeDir) {
      return resolveRelativePath(safeDecodePath(includeDir), decodedPath);
    }
    var boardDir = getDirNameFromPath(getCurrentEditorFilePath());
    if (!boardDir) return decodedPath;
    return resolveRelativePath(boardDir, decodedPath);
  }

  function syncCardEditorWysiwygContext(editor) {
    var boardId = editor && editor.boardId ? editor.boardId : (activeBoardId || '');
    var boardFilePath = getBoardFilePathForId(boardId) || getActiveBoardFilePath() || '';
    var includeDir = '';
    var col = editor && editor.colIndex != null ? getFullColumn(editor.colIndex) : null;
    if (col && col.includeSource && col.includeSource.rawPath) {
      var boardDir = getDirNameFromPath(boardFilePath);
      includeDir = getDirNameFromPath(joinBoardRelativePath(boardDir, col.includeSource.rawPath));
    } else {
      includeDir = getDirNameFromPath(boardFilePath);
    }
    window.currentTaskIncludeContext = includeDir ? { includeDir: includeDir } : null;
    window.currentFilePath = boardFilePath || '';
  }

  function setCurrentCardEditorMarkdown(nextValue, options) {
    options = options || {};
    if (!currentCardEditor) return;
    var normalizedValue = String(nextValue || '');
    if (currentCardEditor.textarea) currentCardEditor.textarea.value = normalizedValue;
    if (
      currentCardEditor.wysiwyg &&
      !options.skipWysiwygSync &&
      typeof currentCardEditor.wysiwyg.setMarkdown === 'function'
    ) {
      currentCardEditor.suppressWysiwygChange = true;
      try {
        currentCardEditor.wysiwyg.setMarkdown(normalizedValue);
      } finally {
        currentCardEditor.suppressWysiwygChange = false;
      }
    }
    if (!options.skipPreviewRefresh) refreshCardEditorPreview();
  }

  function updateCardEditorWysiwygToolbar(selectionState) {
    if (!currentCardEditor || !currentCardEditor.dialog) return;
    var markMap = {
      bold: 'strong',
      italic: 'em',
      underline: 'underline',
      strike: 'strike',
      mark: 'mark',
      sub: 'sub',
      sup: 'sup',
      code: 'code',
      ins: 'ins'
    };
    var marks = selectionState && selectionState.marks ? selectionState.marks : [];
    var block = selectionState && selectionState.block ? selectionState.block : '';
    var buttons = currentCardEditor.dialog.querySelectorAll('[data-card-editor-fmt]');
    for (var i = 0; i < buttons.length; i++) {
      var fmt = buttons[i].getAttribute('data-card-editor-fmt') || '';
      var isActive = false;
      if (fmt === 'code-block') {
        isActive = block === 'code_block';
      } else if (fmt === 'columns') {
        isActive = block === 'multicolumn_column';
      } else if (markMap[fmt]) {
        isActive = marks.indexOf(markMap[fmt]) !== -1;
      }
      buttons[i].classList.toggle('active', isActive);
      buttons[i].setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  }

  function applyCardEditorFontScale(scale, persist) {
    var normalizedScale = normalizeCardEditorFontScale(scale);
    cardEditorFontScale = normalizedScale;
    if (!currentCardEditor || !currentCardEditor.dialog) {
      if (persist !== false) localStorage.setItem('lexera-card-editor-font-scale', String(normalizedScale));
      return;
    }
    currentCardEditor.fontScale = normalizedScale;
    currentCardEditor.dialog.style.setProperty('--task-overlay-font-scale', String(normalizedScale));
    if (currentCardEditor.textarea) currentCardEditor.textarea.style.fontSize = 'calc(14px * ' + normalizedScale + ')';
    if (currentCardEditor.preview) currentCardEditor.preview.style.fontSize = 'calc(14px * ' + normalizedScale + ')';
    if (currentCardEditor.wysiwygWrap) currentCardEditor.wysiwygWrap.style.fontSize = 'calc(1em * ' + normalizedScale + ')';
    if (persist !== false) localStorage.setItem('lexera-card-editor-font-scale', String(normalizedScale));
  }

  function openCardEditorFontScaleMenu(anchorEl) {
    if (!anchorEl || !currentCardEditor) return;
    var rect = anchorEl.getBoundingClientRect();
    var items = [
      { id: 'font-1.0', label: 'Text 100%' },
      { id: 'font-1.2', label: 'Text 120%' },
      { id: 'font-1.4', label: 'Text 140%' }
    ];
    showNativeMenu(items, rect.right, rect.bottom).then(function (action) {
      if (!action) return;
      var nextScale = action === 'font-1.4' ? 1.4 : (action === 'font-1.2' ? 1.2 : 1);
      applyCardEditorFontScale(nextScale, true);
    });
  }

  function syncCardEditorTextareaFromWysiwyg() {
    if (
      !currentCardEditor ||
      !currentCardEditor.wysiwyg ||
      typeof currentCardEditor.wysiwyg.getMarkdown !== 'function'
    ) {
      return;
    }
    if (currentCardEditor.textarea) {
      currentCardEditor.textarea.value = currentCardEditor.wysiwyg.getMarkdown() || '';
    }
  }

  function destroyCardEditorWysiwyg(editor) {
    if (!editor || !editor.wysiwyg) return;
    try {
      if (typeof editor.wysiwyg.destroy === 'function') editor.wysiwyg.destroy();
    } catch (err) {
      lexeraLog('warn', '[card-editor] Failed to destroy WYSIWYG editor: ' + err);
    }
    editor.wysiwyg = null;
    if (editor.wysiwygWrap) editor.wysiwygWrap.innerHTML = '';
  }

  function ensureCardEditorWysiwyg() {
    if (
      !currentCardEditor ||
      !currentCardEditor.wysiwygWrap ||
      typeof window.WysiwygEditor !== 'function'
    ) {
      return null;
    }
    syncCardEditorWysiwygContext(currentCardEditor);
    if (!currentCardEditor.wysiwyg) {
      currentCardEditor.wysiwygWrap.innerHTML = '';
      currentCardEditor.wysiwyg = new window.WysiwygEditor(currentCardEditor.wysiwygWrap, {
        markdown: currentCardEditor.textarea ? currentCardEditor.textarea.value : '',
        temporalPrefix: '!',
        onChange: function (markdown) {
          if (!currentCardEditor || currentCardEditor.suppressWysiwygChange) return;
          if (currentCardEditor.textarea) currentCardEditor.textarea.value = markdown || '';
          refreshCardEditorPreview();
          queueCardDraftLiveSync(currentCardEditor.colIndex, currentCardEditor.fullCardIdx, markdown || '');
        },
        onSelectionChange: function (selectionState) {
          updateCardEditorWysiwygToolbar(selectionState);
        },
        onSubmit: function () {
          closeCardEditorOverlay({ save: true });
        }
      });
      return currentCardEditor.wysiwyg;
    }
    if (
      currentCardEditor.textarea &&
      typeof currentCardEditor.wysiwyg.getMarkdown === 'function' &&
      currentCardEditor.wysiwyg.getMarkdown() !== currentCardEditor.textarea.value
    ) {
      currentCardEditor.suppressWysiwygChange = true;
      try {
        currentCardEditor.wysiwyg.setMarkdown(currentCardEditor.textarea.value);
      } finally {
        currentCardEditor.suppressWysiwygChange = false;
      }
    }
    return currentCardEditor.wysiwyg;
  }

  function applyCardEditorFormatting(textarea, fmt) {
    if (!currentCardEditor || !fmt) return;
    if (currentCardEditor.mode === 'wysiwyg') {
      var editor = ensureCardEditorWysiwyg();
      if (editor) {
        var command = fmt;
        if (fmt === 'columns') command = 'multicolumn';
        if (fmt === 'code-block' || fmt === 'link' || fmt === 'bold' || fmt === 'italic' ||
          fmt === 'underline' || fmt === 'strike' || fmt === 'mark' || fmt === 'sub' ||
          fmt === 'sup' || fmt === 'code' || fmt === 'ins') {
          if (editor.applyCommand(command)) {
            return;
          }
        }
        var wysiwygFormatSpec = getCardEditorFormatSpec(fmt);
        if (wysiwygFormatSpec) {
          var snippet = '';
          if (wysiwygFormatSpec.snippet != null) snippet = wysiwygFormatSpec.snippet;
          else if (wysiwygFormatSpec.wrap) snippet = wysiwygFormatSpec.wrap + 'text' + wysiwygFormatSpec.wrap;
          else snippet = wysiwygFormatSpec.prefix + 'text' + wysiwygFormatSpec.suffix;
          editor.insertText(snippet);
        }
        return;
      }
    }
    var formatSpec = getCardEditorFormatSpec(fmt);
    if (formatSpec) {
      insertFormatting(textarea, formatSpec);
      textarea.focus();
    }
  }

  function getWysiwygEmbedOccurrenceIndex(container) {
    if (
      !container ||
      !currentCardEditor ||
      !currentCardEditor.wysiwygWrap ||
      !currentCardEditor.wysiwygWrap.contains(container)
    ) {
      return 0;
    }
    var targetPath = getEmbedActionTarget(container);
    if (!targetPath) return 0;
    var selector = [
      '.image-path-overlay-container[data-file-path]',
      '.video-path-overlay-container[data-file-path]',
      '.wysiwyg-media[data-file-path]',
      '.wysiwyg-media-block[data-file-path]'
    ].join(', ');
    var nodes = currentCardEditor.wysiwygWrap.querySelectorAll(selector);
    var seen = 0;
    for (var i = 0; i < nodes.length; i++) {
      if ((nodes[i].getAttribute('data-file-path') || '') !== targetPath) continue;
      if (nodes[i] === container) return seen;
      seen++;
    }
    return 0;
  }

  function replaceCurrentEmbedOccurrence(content, container, replacer) {
    var targetPath = getEmbedActionTarget(container);
    if (!targetPath) return String(content || '');
    var targetIndex = getWysiwygEmbedOccurrenceIndex(container);
    var matchIndex = 0;
    return String(content || '').replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?/g, function (match, alt, rawTarget, rawAttrs) {
      var parsed = parseMarkdownTarget(rawTarget);
      if (parsed.path !== targetPath) return match;
      var currentIndex = matchIndex++;
      if (currentIndex !== targetIndex) return match;
      return replacer({
        match: match,
        alt: alt,
        rawTarget: rawTarget,
        rawAttrs: rawAttrs || '',
        imageAttrs: parseMarkdownImageAttributes(rawAttrs),
        path: parsed.path,
        title: parsed.title
      });
    });
  }

  function replaceNthIncludeDirective(content, targetIndex, replacer) {
    var matchIndex = 0;
    return String(content || '').replace(/!!!include\(([^)]+)\)!!!/g, function (match, rawPath) {
      var currentIndex = matchIndex++;
      if (currentIndex !== targetIndex) return match;
      return replacer({
        match: match,
        path: String(rawPath || '').trim()
      });
    });
  }

  function normalizeCardEditorMode(mode) {
    if (mode === 'markdown' || mode === 'preview') return mode;
    if (mode === 'wysiwyg' && typeof window.WysiwygEditor === 'function') return mode;
    return 'dual';
  }

  function normalizeCardEditorFontScale(value) {
    var parsed = parseFloat(value);
    if (Math.abs(parsed - 1.4) < 0.01) return 1.4;
    if (Math.abs(parsed - 1.2) < 0.01) return 1.2;
    return 1;
  }

  function getCardEditorFormatSpec(fmt) {
    if (fmt === 'bold') return { wrap: '**' };
    if (fmt === 'italic') return { wrap: '*' };
    if (fmt === 'underline') return { wrap: '_' };
    if (fmt === 'strike') return { wrap: '~~' };
    if (fmt === 'mark') return { wrap: '==' };
    if (fmt === 'ins') return { wrap: '++' };
    if (fmt === 'sub') return { wrap: '~' };
    if (fmt === 'sup') return { wrap: '^' };
    if (fmt === 'code') return { wrap: '`' };
    if (fmt === 'link') return { prefix: '[', suffix: '](url)' };
    if (fmt === 'image') return { snippet: '![alt](path)' };
    if (fmt === 'heading') return { prefix: '## ', suffix: '' };
    if (fmt === 'quote') return { prefix: '> ', suffix: '' };
    if (fmt === 'bullet-list') return { prefix: '- ', suffix: '' };
    if (fmt === 'numbered-list') return { prefix: '1. ', suffix: '' };
    if (fmt === 'task') return { prefix: '- [ ] ', suffix: '' };
    if (fmt === 'include') return { snippet: '!!!include(path)!!!' };
    if (fmt === 'wiki') return { snippet: '[[Page]]' };
    if (fmt === 'footnote') return { snippet: 'Reference[^1]\n\n[^1]: Footnote text' };
    if (fmt === 'code-block') return { snippet: '```\ncode\n```' };
    if (fmt === 'mermaid') return { snippet: '```mermaid\ngraph TD\n  A[Start] --> B[End]\n```' };
    if (fmt === 'plantuml') return { snippet: '```plantuml\n@startuml\nAlice -> Bob: hello\n@enduml\n```' };
    if (fmt === 'columns') return { snippet: '---:\n\n:--:\n\n:---' };
    if (fmt === 'note') return { snippet: '::: note\n\n:::\n' };
    if (fmt === 'container-comment') return { snippet: '::: comment\n\n:::\n' };
    if (fmt === 'container-highlight') return { snippet: '::: highlight\n\n:::\n' };
    if (fmt === 'container-mark-red') return { snippet: '::: mark-red\n\n:::\n' };
    if (fmt === 'container-mark-green') return { snippet: '::: mark-green\n\n:::\n' };
    if (fmt === 'container-mark-blue') return { snippet: '::: mark-blue\n\n:::\n' };
    if (fmt === 'container-mark-cyan') return { snippet: '::: mark-cyan\n\n:::\n' };
    if (fmt === 'container-mark-magenta') return { snippet: '::: mark-magenta\n\n:::\n' };
    if (fmt === 'container-mark-yellow') return { snippet: '::: mark-yellow\n\n:::\n' };
    if (fmt === 'container-center') return { snippet: '::: center\n\n:::\n' };
    if (fmt === 'container-center100') return { snippet: '::: center100\n\n:::\n' };
    if (fmt === 'container-right') return { snippet: '::: right\n\n:::\n' };
    if (fmt === 'container-caption') return { snippet: '::: caption\n\n:::\n' };
    if (fmt === 'emoji') return { snippet: ':smile:' };
    return null;
  }

  function buildCardEditorSnippetSelectHtml() {
    return '' +
      '<select class="dialog-input card-editor-snippet-select" data-card-editor-snippet="snippet" title="Insert snippet">' +
        '<option value="">Insert...</option>' +
        '<option value="quote">Quote</option>' +
        '<option value="bullet-list">Bullet list</option>' +
        '<option value="numbered-list">Numbered list</option>' +
        '<option value="columns">Multicolumn ---: :--: :---</option>' +
        '<option value="mermaid">Mermaid diagram</option>' +
        '<option value="plantuml">PlantUML diagram</option>' +
        '<option value="note">Container: note</option>' +
        '<option value="container-comment">Container: comment</option>' +
        '<option value="container-highlight">Container: highlight</option>' +
        '<option value="container-mark-red">Container: mark-red</option>' +
        '<option value="container-mark-green">Container: mark-green</option>' +
        '<option value="container-mark-blue">Container: mark-blue</option>' +
        '<option value="container-mark-cyan">Container: mark-cyan</option>' +
        '<option value="container-mark-magenta">Container: mark-magenta</option>' +
        '<option value="container-mark-yellow">Container: mark-yellow</option>' +
        '<option value="container-center">Container: center</option>' +
        '<option value="container-center100">Container: center100</option>' +
        '<option value="container-right">Container: right</option>' +
        '<option value="container-caption">Container: caption</option>' +
        '<option value="footnote">Footnote</option>' +
        '<option value="emoji">Emoji</option>' +
      '</select>';
  }

  function updateCheckboxLineInText(text, lineIndex, checked) {
    var lines = String(text || '').split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return String(text || '');
    if (checked) {
      lines[lineIndex] = lines[lineIndex].replace(/\[([ ])\]/, '[x]');
    } else {
      lines[lineIndex] = lines[lineIndex].replace(/\[([xX])\]/, '[ ]');
    }
    return lines.join('\n');
  }

  function renderCardDisplayState(cardEl, content) {
    if (!cardEl) return;
    var colIndex = parseInt(cardEl.getAttribute('data-col-index') || '-1', 10);
    var resolved = getIncludeResolvedContent(content, colIndex);
    var titleEl = cardEl.querySelector('.card-title-display');
    if (titleEl) titleEl.innerHTML = renderTitleInline(getCardTitle(resolved));
    var contentEl = cardEl.querySelector('.card-content');
    if (contentEl) {
      contentEl.innerHTML = renderCardContent(resolved, activeBoardId);
      flushPendingDiagramQueues();
      enhanceEmbeddedContent(contentEl);
      enhanceFileLinks(contentEl);
      enhanceIncludeDirectives(contentEl);
      applyRenderedHtmlCommentVisibility(contentEl, currentHtmlCommentRenderMode);
      applyRenderedTagVisibility(contentEl, currentTagVisibilityMode);
    }
  }

  function autoResizeInlineCardTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.max(120, textarea.scrollHeight) + 'px';
  }

  function findVisibleCardElement(colIndex, cardIndex) {
    return getElColumnsContainer().querySelector('.card[data-col-index="' + colIndex + '"][data-card-index="' + cardIndex + '"]');
  }

  function openCardEditor(cardEl, colIndex, cardIndex, mode) {
    cardEl = findVisibleCardElement(colIndex, cardIndex) || cardEl;
    var targetCol = getFullColumn(colIndex);
    var targetFullIdx = targetCol ? getFullCardIndex(targetCol, cardIndex) : -1;
    if (currentInlineCardEditor) {
      var sameInlineCard = currentInlineCardEditor.cardEl === cardEl &&
        currentInlineCardEditor.colIndex === colIndex &&
        currentInlineCardEditor.fullCardIdx === targetFullIdx;
      if (sameInlineCard && mode !== 'overlay') {
        if (currentInlineCardEditor.textarea) currentInlineCardEditor.textarea.focus();
        return;
      }
      closeInlineCardEditor({ save: true }).then(function () {
        openCardEditor(cardEl, colIndex, cardIndex, mode);
      });
      return;
    }
    if (currentCardEditor) {
      var sameOverlayCard = currentCardEditor.cardEl === cardEl &&
        currentCardEditor.colIndex === colIndex &&
        currentCardEditor.fullCardIdx === targetFullIdx;
      if (sameOverlayCard && mode === 'overlay') {
        if (currentCardEditor.textarea) currentCardEditor.textarea.focus();
        return;
      }
      closeCardEditorOverlay({ save: true }).then(function () {
        openCardEditor(cardEl, colIndex, cardIndex, mode);
      });
      return;
    }
    if (mode === 'overlay') {
      enterCardEditMode(cardEl, colIndex, cardIndex);
      return;
    }
    enterInlineCardEditMode(cardEl, colIndex, cardIndex);
  }

  function enterInlineCardEditMode(cardEl, colIndex, cardIndex) {
    if (currentCardEditor || currentInlineCardEditor) return;
    if (!fullBoardData) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return;

    var contentEl = cardEl ? cardEl.querySelector('.card-content') : null;
    if (!contentEl) return;

    isEditing = true;
    cardEl.classList.add('editing');
    cardEl.classList.remove('collapsed');
    contentEl.innerHTML =
      '<textarea class="card-edit-input card-inline-textarea" spellcheck="false" style="' +
        escapeAttr('display:block;width:100%;min-height:120px;resize:vertical;overflow:auto;background:var(--input-bg);border:1px solid var(--border);border-radius:4px;padding:10px 12px') +
      '"></textarea>' +
      '<div class="add-card-actions card-inline-actions">' +
        '<button class="btn-small btn-cancel" type="button" data-inline-editor-action="cancel">Cancel</button>' +
        '<button class="btn-small" type="button" data-inline-editor-action="overlay">Overlay</button>' +
        '<button class="btn-small btn-primary" type="button" data-inline-editor-action="save">Save</button>' +
      '</div>';

    var textarea = contentEl.querySelector('.card-inline-textarea');
    var cancelBtn = contentEl.querySelector('[data-inline-editor-action="cancel"]');
    var overlayBtn = contentEl.querySelector('[data-inline-editor-action="overlay"]');
    var saveBtn = contentEl.querySelector('[data-inline-editor-action="save"]');
    if (!textarea) return;
    textarea.value = card.content || '';
    autoResizeInlineCardTextarea(textarea);

    currentInlineCardEditor = {
      cardEl: cardEl,
      colIndex: colIndex,
      fullCardIdx: fullIdx,
      contentEl: contentEl,
      textarea: textarea,
      originalContent: card.content || ''
    };

    function maybeSaveOnBlur() {
      var editor = currentInlineCardEditor;
      if (!editor || editor.textarea !== textarea) return;
      setTimeout(function () {
        if (!currentInlineCardEditor || currentInlineCardEditor.textarea !== textarea) return;
        var activeEl = document.activeElement;
        if (activeEl && contentEl.contains(activeEl)) return;
        closeInlineCardEditor({ save: true });
      }, 0);
    }

    // Broadcast editing presence when opening inline editor
    if (card.kid && LexeraApi.isSyncConnected()) {
      LexeraApi.sendEditingPresence(card.kid, syncUserName || syncUserId, textarea.selectionStart, false);
    }

    textarea.addEventListener('input', function () {
      try {
      autoResizeInlineCardTextarea(textarea);
      queueCardDraftLiveSync(colIndex, fullIdx, textarea.value);
      if (card.kid) queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, true);
      } catch (err) {
        logFrontendIssue('error', 'editor.inline', 'Error in inline editor input handler', err);
      }
    });
    textarea.addEventListener('keyup', function () {
      if (card.kid) queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, false);
    });
    textarea.addEventListener('mouseup', function () {
      if (card.kid) queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, false);
    });
    textarea.addEventListener('blur', maybeSaveOnBlur);
    textarea.addEventListener('keydown', function (e) {
      try {
      if (handleTextareaTabIndent(e, textarea)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key.toLowerCase() === 's')) {
        e.preventDefault();
        closeInlineCardEditor({ save: true });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeInlineCardEditor({ save: false });
      }
      } catch (err) {
        logFrontendIssue('error', 'editor.inline', 'Error in inline editor keydown handler', err);
      }
    });

    function bindAction(button, action) {
      if (!button) return;
      button.addEventListener('mousedown', function (e) {
        e.preventDefault();
      });
      button.addEventListener('click', function (e) {
        e.preventDefault();
        if (action === 'save') {
          closeInlineCardEditor({ save: true });
        } else if (action === 'cancel') {
          closeInlineCardEditor({ save: false });
        } else if (action === 'overlay') {
          var draft = textarea.value;
          closeInlineCardEditor({ save: true }).then(function () {
            openCardEditor(cardEl, colIndex, cardIndex, 'overlay');
            if (currentCardEditor && currentCardEditor.textarea && currentCardEditor.textarea.value !== draft) {
              currentCardEditor.textarea.value = draft;
              refreshCardEditorPreview();
            }
          });
        }
      });
    }

    bindAction(cancelBtn, 'cancel');
    bindAction(overlayBtn, 'overlay');
    bindAction(saveBtn, 'save');

    requestAnimationFrame(function () {
      if (!currentInlineCardEditor || currentInlineCardEditor.textarea !== textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }

  function closeInlineCardEditor(options) {
    options = options || {};
    if (!currentInlineCardEditor) return Promise.resolve();
    var editor = currentInlineCardEditor;
    currentInlineCardEditor = null;
    isEditing = false;
    // Clear editing presence
    clearEditingPresenceQueue();
    if (LexeraApi.isSyncConnected()) {
      LexeraApi.sendEditingPresence(null, '', null, false);
    }
    if (editor.cardEl && editor.cardEl.classList) editor.cardEl.classList.remove('editing');
    if (options.save) {
      clearPendingCardDraftSync();
      return saveCardEdit(editor.cardEl, editor.colIndex, editor.fullCardIdx, editor.textarea.value);
    }
    renderCardDisplayState(editor.cardEl, editor.originalContent);
    return revertCardDraftLiveSync(editor.colIndex, editor.fullCardIdx, editor.originalContent)
      .catch(function (err) {
        logFrontendIssue('warn', 'live-sync.revert', 'Failed to revert inline editor live-sync draft', err);
        return false;
      })
      .then(function () {
        return flushDeferredBoardRefresh({ refreshSidebar: true });
      });
  }

  function applyCardEditorMode(mode) {
    if (!currentCardEditor || !currentCardEditor.dialog) return;
    mode = normalizeCardEditorMode(mode);
    if (currentCardEditor.mode === 'wysiwyg' && mode !== 'wysiwyg') {
      syncCardEditorTextareaFromWysiwyg();
    }
    currentCardEditor.mode = mode;
    currentCardEditor.dialog.setAttribute('data-editor-mode', mode);
    var buttons = currentCardEditor.dialog.querySelectorAll('[data-card-editor-mode]');
    for (var i = 0; i < buttons.length; i++) {
      var isActive = buttons[i].getAttribute('data-card-editor-mode') === mode;
      buttons[i].classList.toggle('active', isActive);
      buttons[i].setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
    if (mode === 'wysiwyg') {
      ensureCardEditorWysiwyg();
    } else {
      updateCardEditorWysiwygToolbar(null);
    }
    if (mode === 'preview') {
      refreshCardEditorPreview();
    }
    cardEditorMode = mode;
    localStorage.setItem('lexera-card-editor-mode', mode);
  }

  function enterCardEditMode(cardEl, colIndex, cardIndex) {
    if (currentCardEditor || currentInlineCardEditor) return;
    if (!fullBoardData) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return;

    isEditing = true;
    cardEl.classList.add('editing');
    cardEl.classList.remove('collapsed');
    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay card-editor-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'dialog card-editor-dialog';
    dialog.innerHTML =
      '<div class="card-editor-header">' +
        '<div class="card-editor-header-main">' +
          '<div class="card-editor-title-label">Card Editor</div>' +
          '<div class="card-editor-title-text"></div>' +
        '</div>' +
        '<div class="card-editor-header-actions">' +
          '<div class="card-editor-mode-toggle" role="group" aria-label="Editor mode">' +
            '<button class="board-action-btn" type="button" data-card-editor-mode="markdown" aria-pressed="false">Markdown</button>' +
            '<button class="board-action-btn" type="button" data-card-editor-mode="dual" aria-pressed="false">Dual</button>' +
            '<button class="board-action-btn" type="button" data-card-editor-mode="preview" aria-pressed="false">Preview</button>' +
            '<button class="board-action-btn" type="button" data-card-editor-mode="wysiwyg" aria-pressed="false">WYSIWYG</button>' +
          '</div>' +
          '<button class="board-action-btn" type="button" data-card-editor-action="font-scale">Aa</button>' +
          '<button class="btn-small btn-cancel" data-card-editor-action="cancel">Cancel</button>' +
          '<button class="btn-small btn-primary" data-card-editor-action="save">Save</button>' +
        '</div>' +
      '</div>' +
      '<div class="card-editor-toolbar">' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="bold" title="Bold">Bold</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="italic" title="Italic">Italic</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="underline" title="Underline">Underline</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="strike" title="Strikethrough">Strike</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="mark" title="Mark">Mark</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="ins" title="Inserted text">Ins</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="sub" title="Subscript">Sub</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="sup" title="Superscript">Sup</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="code" title="Inline code">Code</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="link" title="Link">Link</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="image" title="Image">Image</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="heading" title="Heading">H2</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="quote" title="Quote">Quote</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="task" title="Checklist item">Task</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="include" title="Include">Include</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="wiki" title="Wiki link">Wiki</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="footnote" title="Footnote">Footnote</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="code-block" title="Code block">Block</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="mermaid" title="Mermaid diagram">Mermaid</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="columns" title="Multi-column block">Columns</button>' +
        '<button class="board-action-btn" type="button" data-card-editor-fmt="note" title="Note container">Note</button>' +
        buildCardEditorSnippetSelectHtml() +
        '<span class="card-editor-hint">Ctrl/Cmd+Enter to save, Esc to cancel</span>' +
      '</div>' +
      '<div class="card-editor-body">' +
        '<div class="card-editor-pane card-editor-text-pane">' +
          '<div class="card-editor-pane-title">Markdown</div>' +
          '<textarea class="card-editor-textarea card-edit-input" spellcheck="false"></textarea>' +
        '</div>' +
        '<div class="card-editor-pane card-editor-preview-pane">' +
          '<div class="card-editor-pane-title">Preview</div>' +
          '<div class="card-editor-preview" tabindex="0"></div>' +
        '</div>' +
        '<div class="card-editor-pane card-editor-wysiwyg-pane">' +
          '<div class="card-editor-pane-title">WYSIWYG</div>' +
          '<div class="card-overlay-wysiwyg"></div>' +
        '</div>' +
      '</div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function updateCardEditorOverlayHeight() {
      dialog.style.setProperty(
        '--card-overlay-wysiwyg-height',
        Math.max(360, Math.min(window.innerHeight - 320, 720)) + 'px'
      );
    }
    updateCardEditorOverlayHeight();
    window.addEventListener('resize', updateCardEditorOverlayHeight);

    var textarea = dialog.querySelector('.card-editor-textarea');
    var preview = dialog.querySelector('.card-editor-preview');
    var wysiwygWrap = dialog.querySelector('.card-overlay-wysiwyg');
    textarea.value = card.content;

    currentCardEditor = {
      overlay: overlay,
      dialog: dialog,
      textarea: textarea,
      preview: preview,
      wysiwygWrap: wysiwygWrap,
      wysiwyg: null,
      resizeHandler: updateCardEditorOverlayHeight,
      cardEl: cardEl,
      colIndex: colIndex,
      fullCardIdx: fullIdx,
      originalContent: card.content || '',
      boardId: activeBoardId || '',
      fontScale: normalizeCardEditorFontScale(cardEditorFontScale),
      mode: normalizeCardEditorMode(cardEditorMode || localStorage.getItem('lexera-card-editor-mode') || 'dual')
    };
    syncCardEditorWysiwygContext(currentCardEditor);
    applyCardEditorFontScale(currentCardEditor.fontScale, false);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeCardEditorOverlay({ save: false });
    });
    dialog.addEventListener('click', function (e) {
      var modeBtn = e.target.closest('[data-card-editor-mode]');
      if (modeBtn) {
        applyCardEditorMode(modeBtn.getAttribute('data-card-editor-mode'));
        if (currentCardEditor && currentCardEditor.textarea && currentCardEditor.mode !== 'preview') {
          currentCardEditor.textarea.focus();
        }
        return;
      }
      var actionBtn = e.target.closest('[data-card-editor-action]');
      if (actionBtn) {
        var action = actionBtn.getAttribute('data-card-editor-action');
        if (action === 'save') closeCardEditorOverlay({ save: true });
        else if (action === 'cancel') closeCardEditorOverlay({ save: false });
        else if (action === 'font-scale') openCardEditorFontScaleMenu(actionBtn);
        return;
      }
      var fmtBtn = e.target.closest('[data-card-editor-fmt]');
      if (!fmtBtn) return;
      applyCardEditorFormatting(textarea, fmtBtn.getAttribute('data-card-editor-fmt'));
    });
    dialog.addEventListener('change', function (e) {
      var snippetSelect = e.target.closest('[data-card-editor-snippet]');
      if (!snippetSelect) return;
      var snippet = snippetSelect.value;
      if (!snippet) return;
      snippetSelect.value = '';
      applyCardEditorFormatting(textarea, snippet);
    });

    // Broadcast editing presence when opening overlay editor
    if (card.kid && LexeraApi.isSyncConnected()) {
      LexeraApi.sendEditingPresence(card.kid, syncUserName || syncUserId, textarea.selectionStart, false);
    }

    textarea.addEventListener('input', function () {
      try {
      refreshCardEditorPreview();
      queueCardDraftLiveSync(colIndex, fullIdx, textarea.value);
      if (card.kid) queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, true);
      } catch (err) {
        logFrontendIssue('error', 'editor.overlay', 'Error in overlay editor input handler', err);
      }
    });
    textarea.addEventListener('keyup', function () {
      if (card.kid) queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, false);
    });
    textarea.addEventListener('mouseup', function () {
      if (card.kid) queueEditingPresenceBroadcast(card.kid, textarea.selectionStart, false);
    });
    preview.addEventListener('change', function (e) {
      if (!e.target.classList.contains('card-checkbox')) return;
      e.preventDefault();
      e.stopPropagation();
      var lineIndex = parseInt(e.target.getAttribute('data-line'), 10);
      if (!isFinite(lineIndex)) return;
      textarea.value = updateCheckboxLineInText(textarea.value, lineIndex, e.target.checked);
      refreshCardEditorPreview();
      queueCardDraftLiveSync(colIndex, fullIdx, textarea.value);
    });
    dialog.addEventListener('dragover', function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    dialog.addEventListener('drop', async function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      var markdown = typeof resolveDropContent === 'function'
        ? await resolveDropContent(e.dataTransfer)
        : '';
      if (!markdown) return;
      if (currentCardEditor && currentCardEditor.mode === 'wysiwyg') {
        var editor = ensureCardEditorWysiwyg();
        if (editor) {
          editor.insertText(markdown);
          return;
        }
      }
      insertFormatting(textarea, { snippet: markdown });
      textarea.focus();
    });
    dialog.addEventListener('keydown', function (e) {
      try {
      if (e.target === textarea) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        closeCardEditorOverlay({ save: true });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        closeCardEditorOverlay({ save: true });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCardEditorOverlay({ save: false });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key === '1') {
          e.preventDefault();
          applyCardEditorMode('markdown');
        } else if (e.key === '2') {
          e.preventDefault();
          applyCardEditorMode('dual');
        } else if (e.key === '3') {
          e.preventDefault();
          applyCardEditorMode('preview');
        } else if (e.key === '4') {
          e.preventDefault();
          applyCardEditorMode('wysiwyg');
        }
      }
      } catch (err) {
        logFrontendIssue('error', 'editor.overlay', 'Error in overlay dialog keydown handler', err);
      }
    });
    textarea.addEventListener('keydown', function (e) {
      try {
      if (handleTextareaTabIndent(e, textarea)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        closeCardEditorOverlay({ save: true });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        closeCardEditorOverlay({ save: true });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCardEditorOverlay({ save: false });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key === '1') {
          e.preventDefault();
          applyCardEditorMode('markdown');
          return;
        }
        if (e.key === '2') {
          e.preventDefault();
          applyCardEditorMode('dual');
          return;
        }
        if (e.key === '3') {
          e.preventDefault();
          applyCardEditorMode('preview');
          return;
        }
        if (e.key === '4') {
          e.preventDefault();
          applyCardEditorMode('wysiwyg');
          return;
        }
      }
      if (e.ctrlKey || e.metaKey) {
        var fmt = null;
        if (e.key === 'b') fmt = { wrap: '**' };
        else if (e.key === 'i') fmt = { wrap: '*' };
        else if (e.key === '`') fmt = { wrap: '`' };
        else if (e.key === 'k') fmt = { prefix: '[', suffix: '](url)' };
        else if (e.key === 'u') fmt = { wrap: '_' };
        else if (e.key === 'h') fmt = { prefix: '## ', suffix: '' };
        if (fmt) {
          e.preventDefault();
          insertFormatting(textarea, fmt);
        }
      }
      } catch (err) {
        logFrontendIssue('error', 'editor.overlay', 'Error in overlay textarea keydown handler', err);
      }
    });

    refreshCardEditorPreview();
    applyCardEditorMode(currentCardEditor.mode);
    requestAnimationFrame(function () {
      if (currentCardEditor && currentCardEditor.mode === 'wysiwyg') {
        var wysiwyg = ensureCardEditorWysiwyg();
        if (wysiwyg && typeof wysiwyg.focus === 'function') {
          wysiwyg.focus();
        }
      } else if (currentCardEditor && currentCardEditor.mode !== 'preview') {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      } else if (preview) {
        preview.focus();
      }
    });
  }

  function refreshCardEditorPreview() {
    if (!currentCardEditor) return;
    var value = currentCardEditor.textarea ? currentCardEditor.textarea.value : '';
    if (currentCardEditor.preview) {
      var resolved = getIncludeResolvedContent(value, currentCardEditor.colIndex);
      currentCardEditor.preview.innerHTML = renderCardContent(resolved, activeBoardId);
      flushPendingDiagramQueues();
      enhanceEmbeddedContent(currentCardEditor.preview);
      enhanceFileLinks(currentCardEditor.preview);
      enhanceIncludeDirectives(currentCardEditor.preview);
      applyRenderedHtmlCommentVisibility(currentCardEditor.preview, currentHtmlCommentRenderMode);
      applyRenderedTagVisibility(currentCardEditor.preview, currentTagVisibilityMode);
    }
    var titleEl = currentCardEditor.dialog
      ? currentCardEditor.dialog.querySelector('.card-editor-title-text')
      : null;
    if (titleEl) {
      titleEl.textContent = getCardTitle(stripInternalHiddenTags(value)).trim() || 'Untitled';
    }
  }

  async function closeCardEditorOverlay(options) {
    options = options || {};
    if (!currentCardEditor) return;
    var editor = currentCardEditor;
    currentCardEditor = null;
    isEditing = false;
    // Clear editing presence
    clearEditingPresenceQueue();
    if (LexeraApi.isSyncConnected()) {
      LexeraApi.sendEditingPresence(null, '', null, false);
    }
    if (editor.wysiwyg && typeof editor.wysiwyg.getMarkdown === 'function' && editor.textarea) {
      editor.textarea.value = editor.wysiwyg.getMarkdown() || editor.textarea.value;
    }
    if (editor.resizeHandler) {
      window.removeEventListener('resize', editor.resizeHandler);
    }
    destroyCardEditorWysiwyg(editor);
    window.currentTaskIncludeContext = null;
    window.currentFilePath = '';
    if (editor.cardEl && editor.cardEl.classList) editor.cardEl.classList.remove('editing');
    if (editor.overlay && editor.overlay.parentNode) editor.overlay.parentNode.removeChild(editor.overlay);
    if (options.save) {
      clearPendingCardDraftSync();
      await saveCardEdit(editor.cardEl, editor.colIndex, editor.fullCardIdx, editor.textarea.value);
      return;
    }
    await revertCardDraftLiveSync(editor.colIndex, editor.fullCardIdx, editor.originalContent).catch(function (err) {
      logFrontendIssue('warn', 'live-sync.revert', 'Failed to revert overlay editor live-sync draft', err);
      return false;
    });
    await flushDeferredBoardRefresh({ refreshSidebar: true });
  }

  function insertFormatting(textarea, fmt) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var text = textarea.value;
    var selected = text.substring(start, end);

    var replacement;
    if (fmt.snippet != null) {
      replacement = fmt.snippet;
    } else if (fmt.wrap) {
      replacement = fmt.wrap + (selected || 'text') + fmt.wrap;
    } else {
      replacement = fmt.prefix + (selected || 'text') + fmt.suffix;
    }

    textarea.value = text.substring(0, start) + replacement + text.substring(end);

    if (fmt.snippet != null) {
      textarea.setSelectionRange(start, start + replacement.length);
    } else if (selected) {
      // Place cursor: if there was a selection, select the content between markers
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
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col || !col.cards[fullCardIdx]) return;

    var oldContent = col.cards[fullCardIdx].content;
    if (newContent === oldContent) {
      if (cardEl && cardEl.classList) cardEl.classList.remove('editing');
      var contentEl = cardEl ? cardEl.querySelector('.card-content') : null;
      if (contentEl) contentEl.innerHTML = renderCardContent(oldContent, activeBoardId);
      var titleEl = cardEl ? cardEl.querySelector('.card-title-display') : null;
      if (titleEl) titleEl.innerHTML = renderTitleInline(getCardTitle(oldContent));
      await flushDeferredBoardRefresh({ refreshSidebar: true });
      return;
    }

    pushUndo();
    col.cards[fullCardIdx].content = newContent;
    await persistBoardMutation();
    await flushDeferredBoardRefresh({ refreshSidebar: true });
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
    await persistBoardMutation();
  }

  // --- Card Context Menu ---

  var activeCardMenu = null;

  function closeCardContextMenu() {
    if (activeCardMenu) {
      activeCardMenu.remove();
      activeCardMenu = null;
    }
  }

  function buildTagSubmenu(label, tags, text, idPrefix) {
    var items = [];
    for (var i = 0; i < tags.length; i++) {
      var tagName = '#' + tags[i];
      var active = hasTag(text, tagName);
      items.push({
        id: idPrefix + tags[i],
        label: (active ? '\u2713 ' : '') + tagName
      });
    }
    return { id: idPrefix + '_sub', label: label, items: items };
  }

  function buildCustomTagsSubmenu(text, idPrefix) {
    var allTags = extractAllTags(text);
    var knownTags = {};
    var catKeys = Object.keys(TAG_CATEGORIES);
    for (var c = 0; c < catKeys.length; c++) {
      var arr = TAG_CATEGORIES[catKeys[c]];
      for (var t = 0; t < arr.length; t++) knownTags['#' + arr[t]] = true;
    }
    var custom = [];
    for (var i = 0; i < allTags.length; i++) {
      var tag = allTags[i];
      if (knownTags[tag]) continue;
      if (/^#hidden-internal-/.test(tag)) continue;
      if (isLayoutTagName(tag)) continue;
      custom.push(tag);
    }
    if (custom.length === 0) return null;
    var items = [];
    for (var j = 0; j < custom.length; j++) {
      items.push({ id: idPrefix + custom[j].replace(/^#/, ''), label: '\u2713 ' + custom[j] });
    }
    return { id: idPrefix + '_sub', label: 'Custom Tags', items: items };
  }

  function buildMarpPlaceholders() {
    return [
      { separator: true },
      { id: 'marp-classes', label: 'Marp Classes', items: [
        { id: 'marp-na', label: 'Not yet available', disabled: true }
      ]},
      { id: 'marp-colors', label: 'Marp Colors', items: [
        { id: 'marp-na', label: 'Not yet available', disabled: true }
      ]},
      { id: 'marp-hf', label: 'Marp Header & Footer', items: [
        { id: 'marp-na', label: 'Not yet available', disabled: true }
      ]}
    ];
  }

  function showCardContextMenu(x, y, colIndex, cardIndex) {
    closeCardContextMenu();

    var col = getFullColumn(colIndex);
    var cardText = '';
    if (col) {
      var fullIdx = getFullCardIndex(col, cardIndex);
      if (fullIdx !== -1 && col.cards[fullIdx]) cardText = col.cards[fullIdx].content || '';
    }

    var nativeItems = [
      { id: 'edit-overlay', label: 'Edit task (overlay)' },
      { id: 'reveal', label: 'Reveal content' },
      { id: 'copy-markdown', label: 'Copy as markdown' },
      { separator: true },
      { id: 'insert-before', label: 'Insert card before' },
      { id: 'insert-after', label: 'Insert card after' },
      { id: 'duplicate', label: 'Duplicate card' },
      { separator: true },
      { id: 'park', label: 'Park card' },
      { id: 'archive', label: 'Archive card' },
      { id: 'delete', label: 'Delete card' },
      { separator: true },
      buildTagSubmenu('Special', TAG_CATEGORIES.special, cardText, 'tag-special-'),
      buildTagSubmenu('Status', TAG_CATEGORIES.status, cardText, 'tag-status-'),
      buildTagSubmenu('Positivity', TAG_CATEGORIES.positivity, cardText, 'tag-pos-'),
      buildTagSubmenu('Colors', TAG_CATEGORIES.colors, cardText, 'tag-color-'),
      buildTagSubmenu('Impact', TAG_CATEGORIES.impact, cardText, 'tag-impact-'),
    ];
    var customSub = buildCustomTagsSubmenu(cardText, 'tag-custom-');
    if (customSub) nativeItems.push(customSub);
    nativeItems = nativeItems.concat(buildMarpPlaceholders());

    showNativeMenu(nativeItems, x, y, 'card.menu').then(function (action) {
      if (action) return handleCardMenuAction(action, colIndex, cardIndex);
    }).catch(function (err) {
      logFrontendIssue('error', 'card.menu', 'handleCardMenuAction failed', err);
    });
  }

  async function handleCardMenuAction(action, colIndex, cardIndex) {
    if (action === 'edit-overlay') {
      var cardEls = getElColumnsContainer().querySelectorAll('.card[data-col-index="' + colIndex + '"][data-card-index="' + cardIndex + '"]');
      if (cardEls.length > 0) openCardEditor(cardEls[0], colIndex, cardIndex, 'overlay');
    } else if (action === 'reveal') {
      revealCardContent(colIndex, cardIndex);
    } else if (action === 'copy-markdown') {
      copyElementAsMarkdown('card', { colIndex: colIndex, cardIndex: cardIndex });
    } else if (action === 'insert-before') {
      await insertCardAtIndex(colIndex, cardIndex);
    } else if (action === 'insert-after') {
      await insertCardAtIndex(colIndex, cardIndex + 1);
    } else if (action === 'duplicate') {
      await duplicateCard(colIndex, cardIndex);
    } else if (action === 'park') {
      await tagCard(colIndex, cardIndex, '#hidden-internal-parked');
    } else if (action === 'archive') {
      await tagCard(colIndex, cardIndex, '#hidden-internal-archived');
    } else if (action === 'delete') {
      await deleteCard(colIndex, cardIndex);
    } else if (action.indexOf('tag-') === 0) {
      var tagMatch = action.match(/^tag-(?:special|status|pos|color|impact|custom)-(.+)$/);
      if (tagMatch) await toggleTag('card', { colIndex: colIndex, cardIndex: cardIndex }, '#' + tagMatch[1]);
    }
  }

  async function duplicateCard(colIndex, cardIndex) {
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    var card = col.cards[fullIdx];
    if (!card) return;
    pushUndo();

    var clone = JSON.parse(JSON.stringify(card));
    clone.id = 'dup-' + Date.now();
    clone.kid = null;
    col.cards.splice(fullIdx + 1, 0, clone);
    await persistBoardMutation();
  }

  async function tagCard(colIndex, cardIndex, tag) {
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col) return;
    var fullIdx = getFullCardIndex(col, cardIndex);
    if (fullIdx === -1) return;
    var card = col.cards[fullIdx];
    if (!card) return;
    var nextContent = applyInternalHiddenTag(card.content || '', tag);
    if (nextContent === card.content) return;
    pushUndo();
    card.content = nextContent;
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  async function deleteCard(colIndex, cardIndex) {
    await tagCard(colIndex, cardIndex, '#hidden-internal-deleted');
  }

  async function toggleTag(elementType, indices, tagName) {
    if (!fullBoardData || !activeBoardId) return;
    var text, setFn;
    if (elementType === 'card') {
      var col = getFullColumn(indices.colIndex);
      if (!col) return;
      var fullIdx = getFullCardIndex(col, indices.cardIndex);
      if (fullIdx === -1) return;
      text = col.cards[fullIdx].content || '';
      setFn = function (val) { col.cards[fullIdx].content = val; };
    } else if (elementType === 'column') {
      var col = getFullColumn(indices.colIndex);
      if (!col) return;
      text = col.title || '';
      setFn = function (val) { col.title = val; };
    } else if (elementType === 'row') {
      var row = findFullDataRow(indices.rowIdx);
      if (!row) return;
      text = row.title || '';
      setFn = function (val) { row.title = val; };
    } else if (elementType === 'stack') {
      var stack = findFullDataStack(indices.rowIdx, indices.stackIdx);
      if (!stack) return;
      text = stack.title || '';
      setFn = function (val) { stack.title = val; };
    } else {
      return;
    }
    var re = new RegExp('(^|\\s)' + escapeRegex(tagName) + '(?=\\s|$)');
    var newText;
    if (re.test(text)) {
      newText = text.replace(re, '$1').replace(/  +/g, ' ').trim();
    } else {
      var lines = text.split('\n');
      lines[0] = (lines[0] || '') + ' ' + tagName;
      newText = lines.join('\n');
    }
    if (newText === text) return;
    pushUndo();
    setFn(newText);
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  // --- Column Context Menu & Operations ---

  var activeColMenu = null;

  function closeColumnContextMenu() {
    if (activeColMenu) { activeColMenu.remove(); activeColMenu = null; }
  }

  function showColumnContextMenu(x, y, colIndex, context) {
    closeColumnContextMenu();
    closeCardContextMenu();
    var col = getFullColumn(colIndex);
    var colTitle = col ? (col.title || '') : '';
    var layout = getColumnLayoutTags(colTitle);
    var isStacked = layout.stack;
    var currentSpan = layout.span ? parseInt(layout.span.match(/\d+/)[0], 10) : 1;
    var includePath = col && col.includeSource && col.includeSource.rawPath
      ? String(col.includeSource.rawPath)
      : extractIncludePathFromTitle(colTitle);

    var nativeItems = [
      { id: 'reveal-all', label: 'Reveal all' },
      { id: 'add-before', label: 'Insert column before' },
      { id: 'add-after', label: 'Insert column after' },
      { id: 'duplicate', label: 'Duplicate column' },
      { separator: true },
      { id: 'park', label: 'Park column' },
      { id: 'archive', label: 'Archive column' },
      { id: 'delete', label: 'Delete column' },
      { separator: true },
      buildTagSubmenu('Special', TAG_CATEGORIES.special, colTitle, 'tag-special-'),
      buildTagSubmenu('Positivity', TAG_CATEGORIES.positivity, colTitle, 'tag-pos-'),
      buildTagSubmenu('Colors', TAG_CATEGORIES.colors, colTitle, 'tag-color-'),
      buildTagSubmenu('Workflow', TAG_CATEGORIES.workflow, colTitle, 'tag-wf-'),
      buildTagSubmenu('Complexity', TAG_CATEGORIES.complexity, colTitle, 'tag-cx-'),
    ];
    var customSub = buildCustomTagsSubmenu(colTitle, 'tag-custom-');
    if (customSub) nativeItems.push(customSub);
    nativeItems = nativeItems.concat(buildMarpPlaceholders());
    nativeItems.push({ separator: true });
    nativeItems.push({ id: 'toggle-width', label: 'Width (span ' + currentSpan + ')' });
    nativeItems.push({ id: 'toggle-stacked', label: (isStacked ? '\u2713 ' : '') + 'Stacked column' });
    nativeItems.push({ id: 'sort-sub', label: 'Sort by', items: [
      { id: 'sort-title', label: 'Title' },
      { id: 'sort-tag', label: 'Tag Value' }
    ]});
    nativeItems.push({ separator: true });
    nativeItems.push({ id: 'copy-markdown', label: 'Copy as markdown' });
    nativeItems.push({ id: 'export-column', label: 'Export column' });
    nativeItems.push({ separator: true });
    if (includePath) {
      nativeItems.push({ id: 'preview-include', label: 'Preview Include File' });
      nativeItems.push({ id: 'open-include', label: 'Open Include in System App' });
      nativeItems.push({ id: 'edit-include', label: 'Edit Include File' });
      nativeItems.push({ id: 'disable-include', label: 'Disable Include Mode' });
    } else {
      nativeItems.push({ id: 'enable-include', label: 'Enable Include Mode' });
    }

    showNativeMenu(nativeItems, x, y, 'column.menu').then(function (action) {
      if (!action) return;
      return handleColumnAction(action, colIndex, context);
    }).catch(function (err) {
      logFrontendIssue('error', 'column.menu', 'handleColumnAction failed', err);
    });
  }

  async function setColumnIncludePath(colIndex, nextPath) {
    var col = getFullColumn(colIndex);
    if (!col || !fullBoardData || !activeBoardId) return false;
    var cleanPath = String(nextPath || '').trim();
    if (!cleanPath) return false;
    var nextTitle = reconstructColumnTitle(
      updateIncludePathInTitle(col.title || '', cleanPath),
      col.title || ''
    );
    if (nextTitle === col.title && col.includeSource && col.includeSource.rawPath === cleanPath) {
      return false;
    }
    pushUndo();
    col.title = nextTitle;
    col.includeSource = { rawPath: cleanPath };
    return persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  async function enableColumnIncludeMode(colIndex) {
    var col = getFullColumn(colIndex);
    if (!col) return;
    var requested = window.prompt('Include file path', suggestIncludePathForColumn(col.title || ''));
    if (requested == null) return;
    await setColumnIncludePath(colIndex, requested);
  }

  async function editColumnIncludeFile(colIndex) {
    var col = getFullColumn(colIndex);
    if (!col) return;
    var currentPath = col && col.includeSource && col.includeSource.rawPath
      ? String(col.includeSource.rawPath)
      : extractIncludePathFromTitle(col.title || '');
    if (!currentPath) {
      showNotification('This column is not in include mode');
      return;
    }
    var requested = window.prompt('Edit include file path', currentPath);
    if (requested == null) return;
    await setColumnIncludePath(colIndex, requested);
  }

  async function disableColumnIncludeMode(colIndex) {
    var col = getFullColumn(colIndex);
    if (!col) return;
    var currentPath = col && col.includeSource && col.includeSource.rawPath
      ? String(col.includeSource.rawPath)
      : extractIncludePathFromTitle(col.title || '');
    if (!currentPath) return;
    if (!(await showConfirmDialog('Disable include mode? Included cards will be written back into this board as regular cards.'))) {
      return;
    }
    var cleanTitle = removeIncludeSyntaxFromTitle(col.title || '');
    if (!cleanTitle) {
      cleanTitle = getDisplayNameFromPath(currentPath).replace(/\.[^.]+$/, '') || 'Untitled Column';
    }
    pushUndo();
    col.title = reconstructColumnTitle(cleanTitle, col.title || '');
    col.includeSource = null;
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  async function moveColumnToStack(colIndex, targetRowIdx, targetStackIdx) {
    if (!fullBoardData || !fullBoardData.rows) {
      traceFrontendAction('warn', 'column.move', 'Aborted move because fullBoardData is missing', {
        boardId: activeBoardId || null,
        colIndex: colIndex,
        targetRowIdx: targetRowIdx,
        targetStackIdx: targetStackIdx
      });
      return;
    }
    // Find and remove column from current location
    var col = getFullColumn(colIndex);
    if (!col) {
      traceFrontendAction('warn', 'column.move', 'Aborted move because source column could not be resolved', {
        boardId: activeBoardId || null,
        colIndex: colIndex,
        targetRowIdx: targetRowIdx,
        targetStackIdx: targetStackIdx
      });
      return;
    }
    var container = findColumnContainer(colIndex);
    if (!container) {
      traceFrontendAction('warn', 'column.move', 'Aborted move because source container could not be resolved', {
        boardId: activeBoardId || null,
        colIndex: colIndex,
        targetRowIdx: targetRowIdx,
        targetStackIdx: targetStackIdx,
        columnId: col.id || null
      });
      return;
    }
    // Add to target stack — targetRowIdx/targetStackIdx are display indices
    var targetStack = findFullDataStack(targetRowIdx, targetStackIdx);
    if (!targetStack) {
      traceFrontendAction('warn', 'column.move', 'Aborted move because target stack could not be resolved', {
        boardId: activeBoardId || null,
        colIndex: colIndex,
        columnId: col.id || null,
        targetRowIdx: targetRowIdx,
        targetStackIdx: targetStackIdx
      });
      return;
    }
    if (container.stack === targetStack) {
      traceFrontendAction('warn', 'column.move', 'Skipping move because source and target stack are identical', {
        boardId: activeBoardId || null,
        colIndex: colIndex,
        columnId: col.id || null,
        rowIdx: container.rowIdx,
        stackIdx: container.stackIdx
      });
      return;
    }
    traceFrontendAction('info', 'column.move', 'Moving column to stack', {
      boardId: activeBoardId || null,
      colIndex: colIndex,
      columnId: col.id || null,
      sourceRowIdx: container.rowIdx,
      sourceStackIdx: container.stackIdx,
      targetRowIdx: targetRowIdx,
      targetStackIdx: targetStackIdx
    });
    pushUndo();
    var removed = container.arr.splice(container.localIdx, 1)[0];
    targetStack.columns.push(removed);
    removeEmptyStacksAndRows();
    await persistBoardMutation({ refreshSidebar: true });
  }

  async function handleColumnAction(action, colIndex, context) {
    if (action === 'reveal-all') {
      revealColumnContent(colIndex);
    } else if (action === 'add-before') {
      if (!(context && await addColumnRelativeToDisplayPosition(context.rowIdx, context.stackIdx, context.colLocalIdx, true))) {
        await addColumn(colIndex);
      }
    } else if (action === 'add-after') {
      if (!(context && await addColumnRelativeToDisplayPosition(context.rowIdx, context.stackIdx, context.colLocalIdx, false))) {
        await addColumn(colIndex + 1);
      }
    } else if (action === 'duplicate') {
      await duplicateColumn(colIndex);
    } else if (action === 'park') {
      await setColumnHiddenTag(colIndex, '#hidden-internal-parked');
    } else if (action === 'archive') {
      await setColumnHiddenTag(colIndex, '#hidden-internal-archived');
    } else if (action === 'delete') {
      await deleteColumn(colIndex);
    } else if (action === 'toggle-width') {
      await toggleColumnWidth(colIndex);
    } else if (action === 'toggle-stacked') {
      await toggleTag('column', { colIndex: colIndex }, '#stack');
    } else if (action === 'sort-title') {
      sortColumnCards(colIndex, 'title');
    } else if (action === 'sort-tag') {
      sortColumnCards(colIndex, 'tag');
    } else if (action === 'copy-markdown') {
      copyElementAsMarkdown('column', { colIndex: colIndex });
    } else if (action === 'export-column') {
      exportColumn(colIndex);
    } else if (action === 'preview-include') {
      var previewCol = getFullColumn(colIndex);
      var previewPath = previewCol && previewCol.includeSource && previewCol.includeSource.rawPath
        ? String(previewCol.includeSource.rawPath)
        : extractIncludePathFromTitle(previewCol && previewCol.title ? previewCol.title : '');
      if (previewPath) showBoardFilePreview(activeBoardId, previewPath);
    } else if (action === 'open-include') {
      var openCol = getFullColumn(colIndex);
      var openPath = openCol && openCol.includeSource && openCol.includeSource.rawPath
        ? String(openCol.includeSource.rawPath)
        : extractIncludePathFromTitle(openCol && openCol.title ? openCol.title : '');
      if (openPath) openBoardFileInSystem(activeBoardId, openPath);
    } else if (action === 'enable-include') {
      await enableColumnIncludeMode(colIndex);
    } else if (action === 'edit-include') {
      await editColumnIncludeFile(colIndex);
    } else if (action === 'disable-include') {
      await disableColumnIncludeMode(colIndex);
    } else if (action.indexOf('tag-') === 0) {
      var tagMatch = action.match(/^tag-(?:special|pos|color|wf|cx|custom)-(.+)$/);
      if (tagMatch) await toggleTag('column', { colIndex: colIndex }, '#' + tagMatch[1]);
    }
  }

  async function setColumnHiddenTag(colIndex, tag) {
    traceFrontendAction('info', 'column.hiddenTag', 'setColumnHiddenTag called', { colIndex: colIndex, tag: tag });
    if (!fullBoardData || !activeBoardId) return;
    var col = getFullColumn(colIndex);
    if (!col) {
      traceFrontendAction('warn', 'column.hiddenTag', 'getFullColumn returned null', { colIndex: colIndex });
      return;
    }
    var nextTitle = applyInternalHiddenTag(col.title || '', tag);
    traceFrontendAction('info', 'column.hiddenTag', 'Title transformation', { oldTitle: col.title, nextTitle: nextTitle, same: nextTitle === col.title });
    if (nextTitle === col.title) return;
    pushUndo();
    col.title = nextTitle;
    await persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
    // Post-save verification: check if the tag survived the save round-trip
    var postSaveCol = getFullColumn(colIndex);
    var postTitle = postSaveCol ? postSaveCol.title : '(col gone)';
    var tagSurvived = postTitle.indexOf(tag) !== -1;
    traceFrontendAction(tagSurvived ? 'info' : 'error', 'column.hiddenTag', 'Post-save verification', {
      colIndex: colIndex,
      expectedTag: tag,
      postSaveTitle: postTitle,
      tagSurvived: tagSurvived
    });
  }

  async function sortColumnCards(colIndex, mode) {
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
    await persistBoardMutation();
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
    var currentTitle = stripLayoutTags(col.title);
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
        col.title = reconstructColumnTitle(newTitle, col.title);
        persistBoardMutation();
      } else {
        titleEl.innerHTML = renderTitleInline(currentTitle, activeBoardId);
      }
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); save(); }
    });
  }

  /**
   * Find the container array and local index for a flat column index.
   * Returns { arr: array, localIdx: number } where arr is the columns array
   * containing the column, and localIdx is its position within that array.
   */
  function getBoardColumnByPath(boardData, rowIdx, stackIdx, colIdx) {
    if (!boardData || !boardData.rows) return null;
    if (rowIdx < 0 || rowIdx >= boardData.rows.length) return null;
    var row = boardData.rows[rowIdx];
    if (!row.stacks || stackIdx < 0 || stackIdx >= row.stacks.length) return null;
    var stack = row.stacks[stackIdx];
    if (!stack.columns || colIdx < 0 || colIdx >= stack.columns.length) return null;
    return stack.columns[colIdx];
  }

  function findColumnContainerInBoard(boardData, flatIndex) {
    if (!boardData || !boardData.rows) return null;
    var idx = 0;
    for (var r = 0; r < boardData.rows.length; r++) {
      var row = boardData.rows[r];
      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        for (var c = 0; c < stack.columns.length; c++) {
          if (idx === flatIndex) {
            return {
              arr: stack.columns,
              localIdx: c,
              row: row,
              rowIdx: r,
              stack: stack,
              stackIdx: s
            };
          }
          idx++;
        }
      }
    }
    return null;
  }

  function findColumnContainer(flatIndex) {
    return findColumnContainerInBoard(fullBoardData, flatIndex);
  }

  async function addColumn(atIndex) {
    if (!fullBoardData || !activeBoardId) {
      traceFrontendAction('warn', 'column.create.flat', 'Aborted flat add column because board data is missing', {
        boardId: activeBoardId || null,
        atIndex: atIndex
      });
      return false;
    }
    pushUndo();
    var newCol = { id: 'col-' + Date.now(), title: 'New Column', cards: [] };
    var container = findColumnContainer(atIndex);
    if (container) {
      traceFrontendAction('info', 'column.create.flat', 'Resolved flat insertion container', {
        boardId: activeBoardId || null,
        atIndex: atIndex,
        rowIdx: container.rowIdx,
        stackIdx: container.stackIdx,
        localIdx: container.localIdx,
        columnId: newCol.id
      });
    } else {
      traceFrontendAction('warn', 'column.create.flat', 'Flat insertion fell back to last visible stack', {
        boardId: activeBoardId || null,
        atIndex: atIndex,
        columnId: newCol.id
      });
    }
    if (container) {
      container.arr.splice(container.localIdx, 0, newCol);
    } else {
      // atIndex is past end — append to last stack of last row.
      // Ensure at least one row/stack exists for empty boards.
      if (!fullBoardData.rows || fullBoardData.rows.length === 0) {
        fullBoardData.rows = [{
          id: 'row-' + Date.now(),
          title: fullBoardData.title || 'Board',
          stacks: []
        }];
      }
      var lastRow = fullBoardData.rows[fullBoardData.rows.length - 1];
      if (!lastRow.stacks || lastRow.stacks.length === 0) {
        lastRow.stacks = [{
          id: 'stack-' + Date.now(),
          title: 'Default',
          columns: []
        }];
      }
      lastRow.stacks[lastRow.stacks.length - 1].columns.push(newCol);
    }
    var saved = await persistBoardMutation();
    traceFrontendAction(saved ? 'info' : 'warn', 'column.create.flat', saved ? 'Persisted flat column insertion' : 'Flat column insertion persist reported failure', {
      boardId: activeBoardId || null,
      atIndex: atIndex,
      columnId: newCol.id
    });
    return saved;
  }

  async function deleteColumn(colIndex) {
    traceFrontendAction('info', 'column.delete', 'deleteColumn called', { colIndex: colIndex });
    if (!fullBoardData || !activeBoardId) {
      traceFrontendAction('warn', 'column.delete', 'No fullBoardData or activeBoardId');
      return;
    }
    var col = getFullColumn(colIndex);
    if (!col) {
      traceFrontendAction('warn', 'column.delete', 'getFullColumn returned null', { colIndex: colIndex });
      return;
    }
    var visibleCards = (col.cards || []).filter(function (c) { return !is_archived_or_deleted(c.content || ''); });
    traceFrontendAction('info', 'column.delete', 'Column found', { title: col.title, totalCards: col.cards.length, visibleCards: visibleCards.length });
    if (visibleCards.length > 0) {
      var confirmed = await showConfirmDialog('Move column "' + stripStackTag(col.title) + '" and ' + visibleCards.length + ' card(s) to trash?');
      traceFrontendAction('info', 'column.delete', 'Confirm dialog result', { confirmed: confirmed });
      if (!confirmed) return;
    }
    traceFrontendAction('info', 'column.delete', 'Calling setColumnHiddenTag');
    await setColumnHiddenTag(colIndex, '#hidden-internal-deleted');
  }

  async function duplicateColumn(colIndex) {
    if (!fullBoardData || !activeBoardId) return;
    var container = findColumnContainer(colIndex);
    if (!container) return;
    var col = container.arr[container.localIdx];
    if (!col) return;
    pushUndo();
    var clone = JSON.parse(JSON.stringify(col));
    var ts = Date.now();
    clone.id = 'col-' + ts;
    for (var k = 0; k < clone.cards.length; k++) {
      clone.cards[k].id = 'dup-' + ts + '-' + k;
      clone.cards[k].kid = null;
    }
    container.arr.splice(container.localIdx + 1, 0, clone);
    await persistBoardMutation({ refreshSidebar: true });
  }

  function toggleColCards(colIndex, collapse) {
    var cards = getElColumnsContainer().querySelectorAll('.card[data-col-index="' + colIndex + '"]');
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

  function revealCardContent(colIndex, cardIndex) {
    var card = getElColumnsContainer().querySelector('.card[data-col-index="' + colIndex + '"][data-card-index="' + cardIndex + '"]');
    if (!card) return;
    if (card.hasAttribute('data-hidden-revealed')) {
      card.removeAttribute('data-hidden-revealed');
    } else {
      card.setAttribute('data-hidden-revealed', '');
    }
  }

  function revealColumnContent(colIndex) {
    var cards = getElColumnsContainer().querySelectorAll('.card[data-col-index="' + colIndex + '"]');
    var allRevealed = true;
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].hasAttribute('data-hidden-revealed')) { allRevealed = false; break; }
    }
    for (var j = 0; j < cards.length; j++) {
      if (allRevealed) cards[j].removeAttribute('data-hidden-revealed');
      else cards[j].setAttribute('data-hidden-revealed', '');
    }
  }

  function revealRowContent(rowIdx) {
    var columnsContainer = getElColumnsContainer();
    var rowEl = columnsContainer.querySelectorAll('.kanban-row')[rowIdx];
    if (!rowEl) return;
    var cards = rowEl.querySelectorAll('.card');
    var allRevealed = true;
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].hasAttribute('data-hidden-revealed')) { allRevealed = false; break; }
    }
    for (var j = 0; j < cards.length; j++) {
      if (allRevealed) cards[j].removeAttribute('data-hidden-revealed');
      else cards[j].setAttribute('data-hidden-revealed', '');
    }
  }

  function revealStackContent(rowIdx, stackIdx) {
    var columnsContainer = getElColumnsContainer();
    var rowEl = columnsContainer.querySelectorAll('.kanban-row')[rowIdx];
    if (!rowEl) return;
    var stackEl = rowEl.querySelectorAll('.kanban-column-stack')[stackIdx];
    if (!stackEl) return;
    var cards = stackEl.querySelectorAll('.card');
    var allRevealed = true;
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].hasAttribute('data-hidden-revealed')) { allRevealed = false; break; }
    }
    for (var j = 0; j < cards.length; j++) {
      if (allRevealed) cards[j].removeAttribute('data-hidden-revealed');
      else cards[j].setAttribute('data-hidden-revealed', '');
    }
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
      updateHeaderSearchVisibility();
      return;
    }
    if (!headerSearchExpanded) setHeaderSearchExpanded(true);
    searchDebounce = setTimeout(function () { performSearch(q); }, 300);
  }

  async function performSearch(query) {
    try {
      searchResults = await LexeraApi.search(query);
      searchMode = true;
      updateHeaderSearchVisibility();
      renderSearchResults();
    } catch (err) {
      logFrontendIssue('warn', 'search.perform', 'Search failed for query "' + query + '"', err);
    }
  }

  function openWikiSearch(query) {
    var value = String(query || '').trim();
    if (!value) return;
    if ($searchInput) $searchInput.value = value;
    if (!headerSearchExpanded) setHeaderSearchExpanded(true);
    performSearch(value);
  }

  async function openWikiDocument(documentName, options) {
    options = options || {};
    var resolved = resolveWikiDocument(documentName);
    if (resolved.kind === 'tag') {
      openWikiSearch(resolved.document);
      return resolved;
    }
    if (resolved.kind !== 'board' || !resolved.boardId) {
      if (!options.silent) showNotification('Wiki link not found: ' + String(documentName || ''));
      return resolved;
    }
    try {
      if (options.pane && !embeddedMode) {
        openBoardInPane(resolved.boardId, options.pane);
      } else {
        await selectBoard(resolved.boardId);
      }
    } catch (err) {
      lexeraLog('error', '[wiki] Failed to open document: ' + resolved.document + ' ' + err);
      if (!options.silent) showNotification('Failed to open wiki link');
    }
    return resolved;
  }

  function exitSearchMode() {
    searchMode = false;
    searchResults = null;
    getElSearchResults().classList.add('hidden');
    updateHeaderSearchVisibility();
    renderMainView();
  }

  function parseOptionalSearchIndex(value) {
    if (value == null || value === '') return null;
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }

  function buildSearchResultLocation(item) {
    if (item == null) return '';
    var parts = [];
    if (typeof item.rowIndex === 'number') parts.push('Row ' + (item.rowIndex + 1));
    if (typeof item.stackIndex === 'number') parts.push('Stack ' + (item.stackIndex + 1));
    parts.push(item.columnTitle || 'Column');
    return parts.join(' / ');
  }

  function unfoldSearchTarget(result) {
    if (!result || !activeBoardId) return false;
    var changed = false;

    if (typeof result.rowIndex === 'number') {
      var rowEl = getElColumnsContainer().querySelector('.board-row[data-row-index="' + result.rowIndex + '"]');
      if (rowEl && rowEl.classList.contains('folded')) {
        rowEl.classList.remove('folded');
        changed = true;
      }
    }

    if (typeof result.rowIndex === 'number' && typeof result.stackIndex === 'number') {
      var stackSelector = '.board-stack[data-row-index="' + result.rowIndex + '"][data-stack-index="' + result.stackIndex + '"]';
      var stackEl = getElColumnsContainer().querySelector(stackSelector);
      if (stackEl && stackEl.classList.contains('folded')) {
        stackEl.classList.remove('folded');
        changed = true;
      }
    }

    if (typeof result.columnIndex === 'number') {
      var cardsEl = getElColumnsContainer().querySelector('.column-cards[data-col-index="' + result.columnIndex + '"]');
      var colEl = cardsEl ? cardsEl.closest('.column') : null;
      if (colEl && colEl.classList.contains('folded')) {
        colEl.classList.remove('folded');
        changed = true;
      }
    }

    if (changed) saveFoldState(activeBoardId);
    return changed;
  }

  function focusSearchResultCard(result) {
    if (!result) return false;
    var cardId = result.cardId ? String(result.cardId) : '';
    if (cardId) {
      var byId = getElColumnsContainer().querySelector('.card[data-card-id="' + escapeAttr(cardId) + '"]');
      if (byId) {
        focusCard(byId);
        return true;
      }
    }

    if (typeof result.columnIndex === 'number') {
      var candidates = getElColumnsContainer().querySelectorAll('.card[data-col-index="' + result.columnIndex + '"]');
      if (candidates.length > 0) {
        var firstLine = String(result.cardContent || '').split('\n')[0].trim();
        for (var i = 0; i < candidates.length; i++) {
          var titleEl = candidates[i].querySelector('.card-title-display');
          var titleText = titleEl ? titleEl.textContent.trim() : '';
          if (firstLine && titleText === firstLine) {
            focusCard(candidates[i]);
            return true;
          }
        }
        focusCard(candidates[0]);
        return true;
      }
    }

    return false;
  }

  async function navigateToSearchResult(result) {
    if (!result || !result.boardId) return;
    $searchInput.value = '';
    exitSearchMode();

    try {
      await selectBoard(result.boardId);

      // In window-level split mode, board rendering lives in embedded panes.
      if (!embeddedMode && splitViewMode !== 'single') {
        showNotification('Opened result board in active split view');
        return;
      }

      if (activeBoardId !== result.boardId || !activeBoardData) {
        await loadBoard(result.boardId);
      }

      unfoldSearchTarget(result);
      if (!focusSearchResultCard(result)) {
        showNotification('Opened board, but could not focus the exact card');
      }
    } catch (err) {
      lexeraLog('error', '[search.navigate] Failed to open search result: ' + err);
      showNotification('Failed to open search result');
    }
  }

  function renderSearchResults() {
    getElBoardHeader().classList.add('hidden');
    getElColumnsContainer().classList.add('hidden');
    getElEmptyState().classList.add('hidden');
    getElSearchResults().classList.remove('hidden');

    if (!searchResults || !searchResults.results.length) {
      getElSearchResults().innerHTML =
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
    var resultCursor = 0;
    for (var g = 0; g < keys.length; g++) {
      var group = groups[keys[g]];
      html += '<div class="search-group">';
      html += '<div class="search-group-title">' + escapeHtml(group.title || 'Untitled') + '</div>';

      for (var j = 0; j < group.items.length; j++) {
        var item = group.items[j];
        var resultIdx = resultCursor;
        resultCursor += 1;
        var location = buildSearchResultLocation(item);
        html += '<div class="search-result-item" data-result-index="' + resultIdx + '"' +
          ' data-board="' + escapeAttr(String(item.boardId || '')) + '"' +
          ' data-card-id="' + escapeAttr(String(item.cardId || '')) + '"' +
          ' data-column-index="' + escapeAttr(String(item.columnIndex)) + '"' +
          ' data-row-index="' + escapeAttr(String(item.rowIndex == null ? '' : item.rowIndex)) + '"' +
          ' data-stack-index="' + escapeAttr(String(item.stackIndex == null ? '' : item.stackIndex)) + '"' +
          '>';
        html += '<div class="search-result-column">' + escapeHtml(location) + '</div>';
        html += '<div class="search-result-content">' + escapeHtml(item.cardContent) + '</div>';
        html += '</div>';
      }
      html += '</div>';
    }

    getElSearchResults().innerHTML = html;

    var resultItems = getElSearchResults().querySelectorAll('.search-result-item');
    for (var k = 0; k < resultItems.length; k++) {
      resultItems[k].addEventListener('click', function () {
        var idx = parseOptionalSearchIndex(this.getAttribute('data-result-index'));
        if (idx == null || !searchResults || !searchResults.results || idx < 0 || idx >= searchResults.results.length) {
          return;
        }
        var raw = searchResults.results[idx];
        var nav = {
          boardId: raw.boardId,
          cardId: raw.cardId,
          cardContent: raw.cardContent,
          columnIndex: parseOptionalSearchIndex(raw.columnIndex),
          rowIndex: parseOptionalSearchIndex(raw.rowIndex),
          stackIndex: parseOptionalSearchIndex(raw.stackIndex),
          columnTitle: raw.columnTitle
        };
        navigateToSearchResult(nav);
      });
    }
  }

  // --- Embed Menu ---

  var activeEmbedMenu = null;
  var embedPreviewCache = {};
  var fileInfoCache = {};
  var pendingFileInfoCache = {};
  var MAX_INCLUDE_PREVIEW_DEPTH = 2;

  function isMarkdownPreviewExtension(ext) {
    return ext === 'md' || ext === 'markdown';
  }

  function isTextPreviewExtension(ext) {
    return isMarkdownPreviewExtension(ext) || ext === 'txt' || ext === 'log' || ext === 'json' || ext === 'csv';
  }

  function normalizeFilePathForDetection(path) {
    var value = String(path || '').trim();
    if (!value) return '';
    try {
      if (isExternalHttpUrl(value)) value = new URL(value).pathname || '';
    } catch (e) {
      // Fall back to simple path parsing below.
    }
    return value.split('#')[0].split('?')[0].toLowerCase();
  }

  function getSpecialPreviewType(filePath) {
    var normalized = normalizeFilePathForDetection(filePath);
    if (!normalized) return '';
    if (normalized.slice(-17) === '.excalidraw.json') return 'diagram-excalidraw';
    if (normalized.slice(-12) === '.excalidraw') return 'diagram-excalidraw';
    if (normalized.slice(-7) === '.drawio' || normalized.slice(-4) === '.dio') return 'diagram-drawio';
    if (/\.(xlsx|xls|ods)$/.test(normalized)) return 'spreadsheet';
    if (normalized.slice(-5) === '.epub') return 'epub';
    if (/\.(doc|docx|odt|ppt|pptx|odp)$/.test(normalized)) return 'document';
    if (normalized.slice(-4) === '.pdf') return 'pdf';
    return '';
  }

  function getPreviewKindMeta(kind, filePath) {
    if (kind === 'diagram') {
      if (getSpecialPreviewType(filePath) === 'diagram-excalidraw') {
        return { label: 'Excalidraw file', emoji: '&#127912;' };
      }
      return { label: 'Draw.io file', emoji: '&#128202;' };
    }
    if (kind === 'spreadsheet') return { label: 'Spreadsheet file', emoji: '&#128200;' };
    if (kind === 'epub') return { label: 'EPUB file', emoji: '&#128218;' };
    if (kind === 'document') return { label: 'Document file', emoji: '&#128196;' };
    return { label: 'File', emoji: '&#128196;' };
  }

  function buildFilePreviewPlaceholderHtml(kind, filePath, description) {
    var meta = getPreviewKindMeta(kind, filePath);
    var filename = getDisplayFileNameFromPath(filePath) || filePath;
    return '<div class="embed-diagram-file">' +
      '<div class="embed-diagram-label">' + meta.emoji + ' ' + escapeHtml(meta.label) + '</div>' +
      '<div class="embed-diagram-path">' + escapeHtml(filename) + '</div>' +
      '<div class="embed-preview-loading" style="padding:8px 0 0;">' + escapeHtml(description || 'Preview is not available in this view yet.') + '</div>' +
    '</div>';
  }

  function getFileEmbedChipHtml(kind, filePath, extraStyleAttr) {
    var meta = getPreviewKindMeta(kind, filePath);
    var filename = getDisplayFileNameFromPath(filePath) || filePath;
    return '<span class="embed-file-link"' + (extraStyleAttr || '') + '>' + meta.emoji + ' ' + escapeHtml(filename) + '</span>';
  }

  function getSpecialPreviewPlaceholderText(previewKind) {
    if (previewKind === 'diagram') return 'Open the source file in a dedicated app for full diagram editing.';
    if (previewKind === 'spreadsheet') return 'Spreadsheet rendering is not available in this view yet.';
    if (previewKind === 'epub') return 'EPUB rendering is not available in this view yet.';
    if (previewKind === 'document') return 'Document rendering is not available in this view yet.';
    return 'Preview is not available in this view yet.';
  }

  function getEmbedPreviewKind(filePath) {
    var ext = getFileExtension(filePath);
    var special = getSpecialPreviewType(filePath);
    if (isMarkdownPreviewExtension(ext)) return 'markdown';
    if (isTextPreviewExtension(ext)) return 'text';
    if (special === 'pdf') return 'pdf';
    if (special === 'diagram-drawio' || special === 'diagram-excalidraw') return 'diagram';
    if (special === 'spreadsheet') return 'spreadsheet';
    if (special === 'epub') return 'epub';
    if (special === 'document') return 'document';
    return '';
  }

  function getEmbedPreviewCacheKey(boardId, filePath) {
    return String(boardId || '') + '::' + String(filePath || '');
  }

  function getFileInfoCacheKey(boardId, filePath) {
    return String(boardId || '') + '::' + String(filePath || '');
  }

  function requestFileInfo(boardId, filePath) {
    var cacheKey = getFileInfoCacheKey(boardId, filePath);
    if (Object.prototype.hasOwnProperty.call(fileInfoCache, cacheKey)) {
      return Promise.resolve(fileInfoCache[cacheKey]);
    }
    if (pendingFileInfoCache[cacheKey]) return pendingFileInfoCache[cacheKey];
    pendingFileInfoCache[cacheKey] = LexeraApi.fileInfo(boardId, filePath)
      .then(function (info) {
        fileInfoCache[cacheKey] = info || null;
        delete pendingFileInfoCache[cacheKey];
        return fileInfoCache[cacheKey];
      })
      .catch(function (err) {
        logFrontendIssue(
          'warn',
          'file.info',
          'Failed to fetch file info for board ' + boardId + ' path ' + filePath,
          err
        );
        delete pendingFileInfoCache[cacheKey];
        return null;
      });
    return pendingFileInfoCache[cacheKey];
  }

  function clearCachedFilePreviewState(boardId, filePath) {
    var cacheKey = getEmbedPreviewCacheKey(boardId, filePath);
    var infoKey = getFileInfoCacheKey(boardId, parseLocalFileReference(filePath).path);
    delete embedPreviewCache[cacheKey];
    delete fileInfoCache[infoKey];
    delete pendingFileInfoCache[infoKey];
  }

  function clearBoardPreviewCaches(boardId) {
    var prefix = String(boardId || '') + '::';
    if (!prefix || prefix === '::') return;
    Object.keys(embedPreviewCache).forEach(function (key) {
      if (key.indexOf(prefix) === 0) delete embedPreviewCache[key];
    });
    Object.keys(fileInfoCache).forEach(function (key) {
      if (key.indexOf(prefix) === 0) delete fileInfoCache[key];
    });
    Object.keys(pendingFileInfoCache).forEach(function (key) {
      if (key.indexOf(prefix) === 0) delete pendingFileInfoCache[key];
    });
  }

  function encodeUtf8Base64(value) {
    try {
      return btoa(encodeURIComponent(String(value || '')).replace(/%([0-9A-F]{2})/g, function (_, hex) {
        return String.fromCharCode(parseInt(hex, 16));
      }));
    } catch (e) {
      return '';
    }
  }

  function getPathStem(path) {
    var fileName = getFileNameFromPath(path);
    return fileName ? fileName.replace(/\.[^.]+$/, '') : '';
  }

  function buildDiagramCachePrefix(sourcePath) {
    var basename = getPathStem(sourcePath);
    var pathHash = encodeUtf8Base64(String(sourcePath || '')).replace(/[/+=]/g, '').slice(0, 8);
    return basename + '-' + pathHash + '-';
  }

  function buildDiagramCacheFileName(sourcePath, mtimeMs, extension, suffix) {
    return buildDiagramCachePrefix(sourcePath) + Math.floor(mtimeMs) + (suffix || '') + '.' + extension;
  }

  function buildDiagramCacheDir(boardFilePath, sourcePath, cacheFolderName) {
    var sourceDir = getDirNameFromPath(sourcePath);
    if (!sourceDir) return '';
    var boardDir = getDirNameFromPath(boardFilePath);
    if (!boardDir || normalizePathForCompare(sourceDir) !== normalizePathForCompare(boardDir)) {
      var sourceDirBase = getFileNameFromPath(sourceDir);
      if (!sourceDirBase) return '';
      return sourceDir + '/' + sourceDirBase + '-Media/' + cacheFolderName;
    }
    var boardBase = getPathStem(boardFilePath);
    if (!boardBase) return '';
    return boardDir + '/' + boardBase + '-Media/' + cacheFolderName;
  }

  function getEmbedPreviewPageNumber(previewKind, pageValue) {
    var pageNumber = parseInt(pageValue, 10);
    if (!(pageNumber > 0)) return 1;
    if (previewKind === 'spreadsheet' || previewKind === 'epub' || previewKind === 'document') {
      return pageNumber;
    }
    return 1;
  }

  function getSpecialPreviewRenderConfig(previewKind, filePath, pageNumber) {
    var special = getSpecialPreviewType(filePath);
    if (previewKind === 'diagram') {
      if (special === 'diagram-excalidraw') {
        return { cacheFolderName: 'excalidraw-cache', extension: 'svg', suffix: '' };
      }
      return { cacheFolderName: 'drawio-cache', extension: 'png', suffix: '' };
    }
    if (previewKind === 'spreadsheet') {
      return { cacheFolderName: 'xlsx-cache', extension: 'png', suffix: '-s' + getEmbedPreviewPageNumber(previewKind, pageNumber) };
    }
    if (previewKind === 'epub') {
      return { cacheFolderName: 'epub-cache', extension: 'png', suffix: '-p' + getEmbedPreviewPageNumber(previewKind, pageNumber) };
    }
    if (previewKind === 'document') {
      return { cacheFolderName: 'document-cache', extension: 'png', suffix: '-p' + getEmbedPreviewPageNumber(previewKind, pageNumber) };
    }
    return null;
  }

  async function resolveCachedSpecialPreviewAsset(boardId, filePath, previewKind, options) {
    if (!boardId || !filePath) return null;
    var config = getSpecialPreviewRenderConfig(previewKind, filePath, options && options.pageNumber);
    if (!config) return null;

    var boardFilePath = getBoardFilePathForId(boardId);
    if (!boardFilePath) return null;

    var fileRef = parseLocalFileReference(filePath);
    var sourceInfo = await requestFileInfo(boardId, fileRef.path);
    if (!sourceInfo || !sourceInfo.exists) return null;

    var mtimeMs = 0;
    if (typeof sourceInfo.lastModifiedMs === 'number' && isFinite(sourceInfo.lastModifiedMs)) {
      mtimeMs = sourceInfo.lastModifiedMs;
    } else if (typeof sourceInfo.lastModified === 'number' && isFinite(sourceInfo.lastModified)) {
      mtimeMs = sourceInfo.lastModified * 1000;
    }
    if (!(mtimeMs > 0)) return null;

    var absoluteSourcePath = fileRef.path;
    if (!isAbsoluteFilePath(absoluteSourcePath)) {
      absoluteSourcePath = await resolveBoardPath(boardId, fileRef.path, 'absolute');
    }
    if (!isAbsoluteFilePath(absoluteSourcePath)) return null;

    var cacheDir = buildDiagramCacheDir(boardFilePath, absoluteSourcePath, config.cacheFolderName);
    if (!cacheDir) return null;
    var cachePath = cacheDir + '/' + buildDiagramCacheFileName(absoluteSourcePath, mtimeMs, config.extension, config.suffix);
    var cacheInfo = await requestFileInfo(boardId, cachePath);
    if (!cacheInfo || !cacheInfo.exists) return null;

    return {
      path: cachePath,
      url: LexeraApi.fileUrl(boardId, cachePath),
      alt: getDisplayFileNameFromPath(filePath) || filePath
    };
  }

  async function renderCachedSpecialPreview(containerEl, boardId, filePath, previewKind, options) {
    var asset = await resolveCachedSpecialPreviewAsset(boardId, filePath, previewKind, options);
    if (!asset) return false;

    if (options && options.modal) {
      containerEl.innerHTML = '<div class="file-preview-media"><img class="file-preview-image" src="' + escapeAttr(asset.url) + '" alt="' + escapeAttr(asset.alt) + '"></div>';
    } else {
      containerEl.innerHTML = '<img class="file-preview-image" src="' + escapeAttr(asset.url) + '" alt="' + escapeAttr(asset.alt) + '" style="margin:0 auto;max-height:420px;">';
    }
    return true;
  }

  function utf8EncodeBytes(value) {
    var text = String(value || '');
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(text);
    }
    var encoded = unescape(encodeURIComponent(text));
    var out = new Uint8Array(encoded.length);
    for (var i = 0; i < encoded.length; i++) out[i] = encoded.charCodeAt(i);
    return out;
  }

  var MD5_SHIFT_VALUES = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  var md5KValues = null;

  function getMd5KValues() {
    if (md5KValues) return md5KValues;
    md5KValues = [];
    for (var i = 0; i < 64; i++) {
      md5KValues.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0);
    }
    return md5KValues;
  }

  function leftRotate32(value, bits) {
    return (value << bits) | (value >>> (32 - bits));
  }

  function toHexLittleEndian(value) {
    var out = '';
    for (var i = 0; i < 4; i++) {
      out += ('0' + ((value >>> (i * 8)) & 255).toString(16)).slice(-2);
    }
    return out;
  }

  function md5Hex(value) {
    var bytes = utf8EncodeBytes(value);
    var originalLength = bytes.length;
    var totalLength = (((originalLength + 8) >> 6) + 1) * 64;
    var padded = new Uint8Array(totalLength);
    padded.set(bytes);
    padded[originalLength] = 0x80;

    var bitLength = BigInt(originalLength) * 8n;
    for (var i = 0; i < 8; i++) {
      padded[totalLength - 8 + i] = Number((bitLength >> BigInt(i * 8)) & 255n);
    }

    var a0 = 1732584193;
    var b0 = -271733879;
    var c0 = -1732584194;
    var d0 = 271733878;
    var kValues = getMd5KValues();

    for (var offset = 0; offset < padded.length; offset += 64) {
      var words = new Int32Array(16);
      for (var j = 0; j < 16; j++) {
        var idx = offset + (j * 4);
        words[j] = padded[idx] |
          (padded[idx + 1] << 8) |
          (padded[idx + 2] << 16) |
          (padded[idx + 3] << 24);
      }

      var a = a0;
      var b = b0;
      var c = c0;
      var d = d0;

      for (var round = 0; round < 64; round++) {
        var f = 0;
        var g = 0;
        if (round < 16) {
          f = (b & c) | ((~b) & d);
          g = round;
        } else if (round < 32) {
          f = (d & b) | ((~d) & c);
          g = (5 * round + 1) % 16;
        } else if (round < 48) {
          f = b ^ c ^ d;
          g = (3 * round + 5) % 16;
        } else {
          f = c ^ (b | (~d));
          g = (7 * round) % 16;
        }

        var nextD = d;
        d = c;
        c = b;
        var rotated = leftRotate32((a + f + kValues[round] + words[g]) | 0, MD5_SHIFT_VALUES[round]);
        b = (b + rotated) | 0;
        a = nextD;
      }

      a0 = (a0 + a) | 0;
      b0 = (b0 + b) | 0;
      c0 = (c0 + c) | 0;
      d0 = (d0 + d) | 0;
    }

    return toHexLittleEndian(a0) + toHexLittleEndian(b0) + toHexLittleEndian(c0) + toHexLittleEndian(d0);
  }

  function buildPlantUmlCachePath(boardFilePath, codeHash) {
    var boardDir = getDirNameFromPath(boardFilePath);
    var boardBase = getPathStem(boardFilePath);
    if (!boardDir || !boardBase || !codeHash) return '';
    return boardDir + '/' + boardBase + '-Media/plantuml-cache/' + codeHash + '.svg';
  }

  async function resolveCachedPlantUmlAsset(boardId, code) {
    if (!boardId || !code) return null;
    var boardFilePath = getBoardFilePathForId(boardId);
    if (!boardFilePath) return null;
    var cachePath = buildPlantUmlCachePath(boardFilePath, md5Hex(code).slice(0, 12));
    if (!cachePath) return null;
    var cacheInfo = await requestFileInfo(boardId, cachePath);
    if (!cacheInfo || !cacheInfo.exists) return null;
    return {
      path: cachePath,
      url: LexeraApi.fileUrl(boardId, cachePath)
    };
  }

  function isAbsoluteFilePath(value) {
    var normalized = normalizePathForCompare(String(value || ''));
    return normalized.charAt(0) === '/' || /^[a-zA-Z]:\//.test(normalized);
  }

  function isBoardRelativePath(value) {
    var normalized = decodeHtmlEntities(String(value || '').trim());
    if (!normalized) return false;
    if (normalized.charAt(0) === '#') return false;
    if (/^(https?:\/\/|mailto:|data:)/i.test(normalized)) return false;
    return !isAbsoluteFilePath(normalized);
  }

  function joinBoardRelativePath(baseDir, relativePath) {
    var rel = normalizePathForCompare(decodeHtmlEntities(String(relativePath || '').trim()));
    if (!rel) return rel;
    if (!isBoardRelativePath(rel)) return rel;

    var base = normalizePathForCompare(String(baseDir || ''));
    var prefix = '';
    var parts = [];

    if (/^[a-zA-Z]:\//.test(base)) {
      prefix = base.slice(0, 2);
      base = base.slice(2);
    }

    parts = base.split('/');
    if (parts.length && parts[parts.length - 1] === '') parts.pop();
    if (parts.length && parts[0] === '') {
      prefix = prefix || '/';
      parts.shift();
    }

    var relParts = rel.split('/');
    for (var i = 0; i < relParts.length; i++) {
      var part = relParts[i];
      if (!part || part === '.') continue;
      if (part === '..') {
        if (parts.length > 0) parts.pop();
        continue;
      }
      parts.push(part);
    }

    if (prefix === '/') return '/' + parts.join('/');
    if (prefix) return prefix + '/' + parts.join('/');
    return parts.join('/');
  }

  function resolveMarkdownRelativeTargets(content, includeFilePath) {
    var baseDir = getDirNameFromPath(includeFilePath);
    if (!baseDir) return String(content || '');

    var rewritten = String(content || '');

    rewritten = rewritten.replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?/g, function (match, alt, rawTarget, rawAttrs) {
      var parsed = parseMarkdownTarget(rawTarget);
      if (!isBoardRelativePath(parsed.path)) return match;
      return buildMarkdownEmbed(
        alt,
        joinBoardRelativePath(baseDir, parsed.path),
        parsed.title,
        rawAttrs || ''
      );
    });

    rewritten = rewritten.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (match, label, rawTarget) {
      var parsed = parseMarkdownTarget(rawTarget);
      if (!isBoardRelativePath(parsed.path)) return match;
      var nextPath = joinBoardRelativePath(baseDir, parsed.path);
      return '[' + label + '](' + nextPath + (parsed.title ? ' ' + parsed.title : '') + ')';
    });

    rewritten = rewritten.replace(/!!!include\(([^)]+)\)!!!/g, function (match, rawPath) {
      if (!isBoardRelativePath(rawPath)) return match;
      return '!!!include(' + joinBoardRelativePath(baseDir, rawPath) + ')!!!';
    });

    return rewritten;
  }

  function getIncludeResolvedContent(content, colIndex) {
    var col = getFullColumn(colIndex);
    if (col && col.includeSource && col.includeSource.rawPath) {
      return resolveMarkdownRelativeTargets(content, col.includeSource.rawPath);
    }
    return content;
  }

  function applyFileLinkInfo(link, info, filePath) {
    if (!link) return;
    var isMissing = !!(info && info.exists === false);
    link.classList.toggle('link-broken', isMissing);
    var container = link.closest('.link-path-overlay-container');
    if (container) container.classList.toggle('link-broken', isMissing);
    if (isMissing) {
      link.setAttribute('title', 'Missing file: ' + String(filePath || ''));
    }
  }

  function buildBoardFileLinkWrapper(filePath, boardId, linkHtml, options) {
    options = options || {};
    var indexAttr = options.linkIndex != null
      ? ' data-link-index="' + escapeAttr(String(options.linkIndex)) + '"'
      : '';
    var wrapperStyle = 'display:inline-flex;align-items:center;gap:2px;vertical-align:baseline;max-width:100%';
    var buttonStyle = 'position:static;top:auto;right:auto;min-width:16px;width:16px;height:16px;font-size:10px;opacity:1;margin:0 0 0 2px';
    return '<span class="link-path-overlay-container" data-board-id="' + escapeAttr(boardId || '') + '"' +
      ' data-file-path="' + escapeAttr(filePath || '') + '"' +
      ' style="' + escapeAttr(wrapperStyle) + '"' +
      indexAttr + '>' +
      linkHtml +
      '<button class="embed-menu-btn link-menu-btn" data-action="link-menu" title="Path options" style="' + escapeAttr(buttonStyle) + '">&#8942;</button>' +
      '</span>';
  }

  function buildIncludeDirectiveWrapper(filePath, boardId, linkHtml, options) {
    options = options || {};
    var wrapperClass = options.expandPreview ? 'include-inline-container' : 'include-link-container';
    var depthAttr = options.expandPreview
      ? ' data-include-depth="' + escapeAttr(String(options.depth || 0)) + '"'
      : '';
    var indexAttr = options.includeIndex != null
      ? ' data-include-index="' + escapeAttr(String(options.includeIndex)) + '"'
      : '';
    var actionButton = options.allowActions === false
      ? ''
      : '<button class="embed-menu-btn include-menu-btn" type="button" title="Include actions">&#8942;</button>';
    return '<span class="' + wrapperClass + '" data-board-id="' + escapeAttr(boardId || '') + '"' +
      ' data-file-path="' + escapeAttr(filePath || '') + '"' +
      depthAttr +
      indexAttr + '>' +
      '<span style="display:inline-flex;align-items:center;gap:4px;max-width:100%">' +
      linkHtml +
      actionButton +
      '</span>' +
      (options.expandPreview ? '<span class="include-inline-body"></span>' : '') +
      '</span>';
  }

  function getIncludePreviewMarkup(filePath, boardId, depth, includeIndex) {
    var linkHtml = renderBoardFileLinkHtml(
      filePath,
      boardId,
      '!(' + escapeHtml(getDisplayNameFromPath(filePath) || filePath) + ')!',
      'Include: ' + filePath,
      'include-filename-link'
    );
    return buildIncludeDirectiveWrapper(filePath, boardId, linkHtml, {
      expandPreview: true,
      depth: depth,
      includeIndex: includeIndex,
      allowActions: true
    });
  }

  function findCardRefById(cardId) {
    if (!fullBoardData || !fullBoardData.rows || !cardId) return null;
    for (var r = 0; r < fullBoardData.rows.length; r++) {
      var row = fullBoardData.rows[r];
      if (!row || !row.stacks) continue;
      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        if (!stack || !stack.columns) continue;
        for (var c = 0; c < stack.columns.length; c++) {
          var col = stack.columns[c];
          if (!col || !col.cards) continue;
          for (var i = 0; i < col.cards.length; i++) {
            var card = col.cards[i];
            if (String(card.id) === String(cardId)) {
              return {
                rowIndex: r,
                stackIndex: s,
                colIndex: c,
                cardIndex: i,
                column: col,
                card: card
              };
            }
          }
        }
      }
    }
    return null;
  }

  function parseMarkdownTarget(rawTarget) {
    var trimmed = String(rawTarget || '').trim();
    var title = '';
    var titleMatch = trimmed.match(/^(.*?)(\s+(&quot;|")[^"]*(&quot;|"))$/);
    if (titleMatch) {
      trimmed = titleMatch[1].trim();
      title = titleMatch[2].trim();
    }
    return {
      path: trimmed,
      title: title
    };
  }

  function normalizeMarkdownAttrValue(value) {
    return String(value || '').trim().replace(/^['"]|['"]$/g, '');
  }

  function sanitizeCssLength(value) {
    var normalized = normalizeMarkdownAttrValue(value);
    if (!normalized) return '';
    if (/^\d+(?:\.\d+)?$/.test(normalized)) return normalized + 'px';
    if (/^\d+(?:\.\d+)?(?:px|%|vh|vw|rem|em)$/.test(normalized)) return normalized;
    if (normalized === 'auto') return normalized;
    return '';
  }

  function parseMarkdownImageAttributes(attrText) {
    var raw = String(attrText || '').trim();
    var parsed = {
      raw: raw,
      values: {},
      classes: []
    };
    if (!raw) return parsed;

    var body = raw.replace(/^\{\s*|\s*\}$/g, '');
    body.replace(/(^|\s)\.([a-zA-Z0-9_-]+)/g, function (_, __, className) {
      parsed.classes.push(className.toLowerCase());
      return _;
    });
    body.replace(/([a-zA-Z_:][\w:-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s}]+))/g, function (_, key, __, doubleQuoted, singleQuoted, bareValue) {
      parsed.values[key.toLowerCase()] = normalizeMarkdownAttrValue(doubleQuoted || singleQuoted || bareValue || '');
      return _;
    });
    return parsed;
  }

  var KNOWN_EXTERNAL_EMBED_PATTERNS = [
    'miro.com/app/live-embed',
    'miro.com/app/embed',
    'figma.com/embed',
    'figma.com/file',
    'figma.com/proto',
    'youtube.com/embed',
    'youtube-nocookie.com/embed',
    'youtu.be',
    'vimeo.com/video',
    'player.vimeo.com',
    'codepen.io/*/embed',
    'codesandbox.io/embed',
    'codesandbox.io/s',
    'stackblitz.com/edit',
    'jsfiddle.net/*/embedded',
    'docs.google.com/presentation',
    'docs.google.com/document',
    'docs.google.com/spreadsheets',
    'notion.so',
    'airtable.com/embed',
    'loom.com/embed',
    'loom.com/share',
    'prezi.com/p/embed',
    'prezi.com/v/embed',
    'ars.particify.de/present'
  ];

  function isExternalHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || ''));
  }

  function isKnownExternalEmbedUrl(url) {
    if (!isExternalHttpUrl(url)) return false;
    try {
      var parsed = new URL(url);
      var hostPath = (parsed.host + parsed.pathname).toLowerCase();
      for (var i = 0; i < KNOWN_EXTERNAL_EMBED_PATTERNS.length; i++) {
        var pattern = KNOWN_EXTERNAL_EMBED_PATTERNS[i].toLowerCase();
        var regex = new RegExp('^' + escapeRegex(pattern).replace(/\\\*/g, '[^/]+'));
        if (regex.test(hostPath)) return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  function shouldRenderExternalEmbed(url, imageAttrs) {
    if (isKnownExternalEmbedUrl(url)) return true;
    if (!imageAttrs) return false;
    if (imageAttrs.classes.indexOf('embed') !== -1) return true;
    var embedValue = imageAttrs.values.embed;
    return embedValue != null && embedValue !== '' && embedValue !== 'false' && embedValue !== '0';
  }

  function renderInlineFileEmbedHtml(filePath, boardId, altText, titleText, extension, embedIndex) {
    var label = decodeHtmlEntities(String(altText || '').trim()) || getDisplayFileNameFromPath(filePath) || filePath;
    var typeLabel = String(extension || 'file').replace(/^\./, '').toUpperCase();
    var wrapperStyle = 'display:block;margin:8px 0;border:1px solid var(--border);border-radius:8px;background:var(--bg-secondary);overflow:hidden';
    var headerStyle = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border);background:var(--bg-tertiary)';
    var typeStyle = 'font-size:10px;font-weight:700;letter-spacing:0.04em;color:var(--text-secondary)';
    var labelStyle = 'font-size:12px;font-weight:600;color:var(--accent);cursor:pointer;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    var buttonStyle = 'position:static;top:auto;right:auto;min-width:18px;width:18px;height:18px;font-size:12px;opacity:1';
    var captionHtml = titleText
      ? '<div class="media-caption" style="padding:6px 8px 8px">' + renderInline(titleText, boardId, { footnoteDefs: {}, footnoteOrder: [], abbrDefs: {}, embedCounter: 0, linkCounter: 0 }) + '</div>'
      : '';
    return '<div class="inline-file-embed-container" data-file-path="' + escapeAttr(filePath) + '" data-board-id="' + escapeAttr(boardId || '') + '"' +
      ' data-inline-type="' + escapeAttr(String(extension || '').toLowerCase()) + '"' +
      ' data-embed-index="' + escapeAttr(String(embedIndex)) + '"' +
      ' data-media-type="inline-file" style="' + escapeAttr(wrapperStyle) + '">' +
      '<div class="inline-file-embed-header" style="' + escapeAttr(headerStyle) + '">' +
      '<span class="inline-file-embed-type" style="' + escapeAttr(typeStyle) + '">' + escapeHtml(typeLabel) + '</span>' +
      '<span class="inline-file-embed-label" data-action="open-inline-file" style="' + escapeAttr(labelStyle) + '">' + escapeHtml(label) + '</span>' +
      '<button class="embed-menu-btn inline-file-menu-btn" data-action="inline-file-menu" title="File options" style="' + escapeAttr(buttonStyle) + '">&#8942;</button>' +
      '</div>' +
      '<div class="inline-file-embed-body" style="padding:8px"><div class="embed-preview-loading">Loading preview...</div></div>' +
      captionHtml +
      '</div>';
  }

  function renderBoardFileLinkHtml(filePath, boardId, labelHtml, titleText, extraClass, options) {
    options = options || {};
    var normalizedPath = decodeHtmlEntities(String(filePath || '').trim());
    if (!normalizedPath) return labelHtml || '';
    var className = 'markdown-file-link';
    if (extraClass) className += ' ' + extraClass;
    var boardAttr = boardId ? ' data-board-id="' + escapeAttr(boardId) + '"' : '';
    var titleAttr = titleText ? ' title="' + escapeAttr(titleText) + '"' : '';
    var linkHtml = '<a href="#" class="' + className + '"' + boardAttr +
      ' data-file-path="' + escapeAttr(normalizedPath) + '"' +
      ' data-original-href="' + escapeAttr(normalizedPath) + '"' +
      titleAttr + '>' + labelHtml + '</a>';
    if (!options.withMenu) return linkHtml;
    return buildBoardFileLinkWrapper(normalizedPath, boardId, linkHtml, options);
  }

  function renderIncludeDirectiveHtml(rawPath, boardId, extraClass, options) {
    options = options || {};
    var includePath = decodeHtmlEntities(String(rawPath || '').trim());
    if (!includePath) return '<span class="broken-include-placeholder">!()!</span>';
    if (options.expandPreview) {
      return getIncludePreviewMarkup(
        includePath,
        boardId,
        options.depth || 0,
        options.includeIndex
      );
    }
    var displayName = getDisplayNameFromPath(includePath) || includePath;
    var linkHtml = renderBoardFileLinkHtml(
      includePath,
      boardId,
      '!(' + escapeHtml(displayName) + ')!',
      'Include: ' + includePath,
      extraClass || 'include-filename-link'
    );
    return buildIncludeDirectiveWrapper(includePath, boardId, linkHtml, {
      includeIndex: options.includeIndex,
      allowActions: options.allowActions
    });
  }

  function renderWikiLinkHtml(documentName, labelHtml, options) {
    options = options || {};
    var resolved = resolveWikiDocument(documentName);
    var containerClass = 'wiki-link-container';
    var boardAttr = '';
    if (resolved.kind === 'missing') containerClass += ' wiki-broken';
    if (resolved.boardId) boardAttr = ' data-board-id="' + escapeAttr(resolved.boardId) + '"';
    return '<span class="' + containerClass + '" data-document="' + escapeAttr(documentName) + '"' + boardAttr + '>' +
      '<a href="#" class="wiki-link" data-document="' + escapeAttr(documentName) + '"' + boardAttr + ' title="Wiki link: ' + escapeAttr(documentName) + '">' + labelHtml + '</a>' +
      (options.withMenu ? '<button class="wiki-menu-btn" data-action="wiki-menu" title="Wiki link options">☰</button>' : '') +
      '</span>';
  }

  function renderTemporalTagHtml(tag) {
    var temporal = describeTemporalTag(tag);
    if (!temporal) return escapeHtml(tag);
    return '<span class="temporal-tag kanban-temporal-tag kanban-temporal-' + temporal.type + '" data-temporal-type="' + temporal.type + '" title="' + escapeAttr(temporal.resolved) + '">' + escapeHtml(tag) + '</span>';
  }

  function getMarkdownMediaStyleAttr(imageAttrs, options) {
    options = options || {};
    if (!imageAttrs) return '';
    var styles = [];
    var width = sanitizeCssLength(imageAttrs.values.width);
    var height = sanitizeCssLength(imageAttrs.values.height);
    if (width) styles.push('width:' + width);
    if (height) styles.push('height:' + height);
    if (!options.allowHeightOnImages && height && styles.length === 1) {
      return ' style="' + escapeAttr('max-height:' + height) + '"';
    }
    if (height && !options.allowHeightOnImages) {
      styles.push('max-height:' + height);
    }
    return styles.length > 0 ? ' style="' + escapeAttr(styles.join(';')) + '"' : '';
  }

  function buildMarkdownEmbed(alt, path, title, attrsText) {
    return '![' + (alt || '') + '](' + path + (title ? ' ' + title : '') + ')' + (attrsText || '');
  }

  function replaceNthMarkdownEmbed(content, targetIndex, replacer) {
    var matchIndex = 0;
    return String(content || '').replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?/g, function (match, alt, rawTarget, rawAttrs) {
      var currentIndex = matchIndex++;
      if (currentIndex !== targetIndex) return match;
      var parsed = parseMarkdownTarget(rawTarget);
      return replacer({
        match: match,
        alt: alt,
        rawTarget: rawTarget,
        rawAttrs: rawAttrs || '',
        imageAttrs: parseMarkdownImageAttributes(rawAttrs),
        path: parsed.path,
        title: parsed.title
      });
    });
  }

  function replaceNthMarkdownLink(content, targetIndex, replacer) {
    var matchIndex = 0;
    return String(content || '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (match, label, rawTarget) {
      var currentIndex = matchIndex++;
      if (currentIndex !== targetIndex) return match;
      var parsed = parseMarkdownTarget(rawTarget);
      return replacer({
        match: match,
        label: label,
        rawTarget: rawTarget,
        path: parsed.path,
        title: parsed.title
      });
    });
  }

  function normalizeCardContentAfterInlineMutation(content) {
    return String(content || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+$/gm, '');
  }

  async function mutateEmbedSource(container, contentMutator) {
    if (!container || typeof contentMutator !== 'function') return false;
    if (currentCardEditor && currentCardEditor.wysiwygWrap && currentCardEditor.wysiwygWrap.contains(container)) {
      var currentWysiwygValue = currentCardEditor.wysiwyg &&
        typeof currentCardEditor.wysiwyg.getMarkdown === 'function'
        ? (currentCardEditor.wysiwyg.getMarkdown() || '')
        : (currentCardEditor.textarea ? currentCardEditor.textarea.value : '');
      var nextWysiwygValue = contentMutator(currentWysiwygValue);
      if (typeof nextWysiwygValue !== 'string' || nextWysiwygValue === currentWysiwygValue) return false;
      setCurrentCardEditorMarkdown(normalizeCardContentAfterInlineMutation(nextWysiwygValue));
      if (currentCardEditor && currentCardEditor.mode === 'wysiwyg') {
        var editor = ensureCardEditorWysiwyg();
        if (editor && typeof editor.focus === 'function') editor.focus();
      }
      return true;
    }
    if (currentCardEditor && currentCardEditor.preview && currentCardEditor.preview.contains(container)) {
      var currentValue = currentCardEditor.textarea ? currentCardEditor.textarea.value : '';
      var nextEditorValue = contentMutator(currentValue);
      if (typeof nextEditorValue !== 'string' || nextEditorValue === currentValue) return false;
      setCurrentCardEditorMarkdown(normalizeCardContentAfterInlineMutation(nextEditorValue));
      return true;
    }

    var cardEl = container.closest('.card[data-card-id]');
    var cardId = cardEl ? cardEl.getAttribute('data-card-id') : '';
    var cardRef = findCardRefById(cardId);
    if (!cardRef || !cardRef.card) return false;
    var nextValue = contentMutator(cardRef.card.content || '');
    if (typeof nextValue !== 'string' || nextValue === cardRef.card.content) return false;
    pushUndo();
    cardRef.card.content = normalizeCardContentAfterInlineMutation(nextValue);
    return persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  function renderEmbedPreviewContent(kind, boardId, filePath, content) {
    var safeContent = String(content || '');
    if (safeContent.length > 12000) {
      safeContent = safeContent.slice(0, 12000) + '\n\n[Preview truncated]';
    }
    if (kind === 'markdown') {
      safeContent = resolveMarkdownRelativeTargets(safeContent, filePath);
      return '<div class="embed-inline-markdown">' +
        renderCardContent(safeContent, boardId, {
          footnoteDefs: {},
          footnoteOrder: [],
          abbrDefs: {},
          embedCounter: 0
        }, { nested: true }) +
        '</div>';
    }
    return '<pre class="embed-text-preview">' + escapeHtml(safeContent) + '</pre>';
  }

  async function enhanceEmbeddedContent(root) {
    if (!root || !root.querySelectorAll) return;
    var containers = root.querySelectorAll('.embed-container[data-file-path][data-board-id]');
    for (var i = 0; i < containers.length; i++) {
      enhanceSingleEmbedContainer(containers[i]);
    }
    var inlineContainers = root.querySelectorAll('.inline-file-embed-container[data-file-path][data-board-id]');
    for (var j = 0; j < inlineContainers.length; j++) {
      enhanceSingleInlineFileEmbed(inlineContainers[j]);
    }
  }

  async function enhanceFileLinks(root) {
    if (!root || !root.querySelectorAll) return;
    var links = root.querySelectorAll('.markdown-file-link[data-file-path]');
    for (var i = 0; i < links.length; i++) {
      enhanceSingleFileLink(links[i]);
    }
  }

  async function enhanceSingleFileLink(link) {
    if (!link || link.getAttribute('data-link-enhanced') === '1') return;
    var boardId = link.getAttribute('data-board-id') || activeBoardId || '';
    var filePath = link.getAttribute('data-file-path') || link.getAttribute('data-original-href') || '';
    if (!boardId || !filePath || /^(https?:\/\/|mailto:|#)/.test(filePath)) return;
    var fileRef = parseLocalFileReference(filePath);
    link.setAttribute('data-link-enhanced', '1');
    var info = await requestFileInfo(boardId, fileRef.path);
    applyFileLinkInfo(link, info, fileRef.path);
  }

  async function enhanceSingleInlineFileEmbed(container) {
    if (!container || container.getAttribute('data-inline-enhanced') === '1') return;
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    var filePath = container.getAttribute('data-file-path') || '';
    var ext = container.getAttribute('data-inline-type') || getInlineFileEmbedExtension(filePath);
    var body = container.querySelector('.inline-file-embed-body');
    if (!boardId || !filePath || !ext || !body) return;

    container.setAttribute('data-inline-enhanced', '1');
    body.innerHTML = '<div class="embed-preview-loading">Loading preview...</div>';

    var fileRef = parseLocalFileReference(filePath);
    var info = await requestFileInfo(boardId, fileRef.path);
    var isMissing = !info || info.exists === false;
    container.classList.toggle('embed-broken', isMissing);
    if (isMissing) {
      body.innerHTML = '<div class="broken-include-placeholder">Inline file unavailable</div>';
      return;
    }

    try {
      var response = await fetch(LexeraApi.fileUrl(boardId, fileRef.path));
      if (!response.ok) throw new Error('Failed to load inline file preview');
      var text = await response.text();
      var previewPath = filePath;
      if (isBoardRelativePath(filePath)) {
        previewPath = await resolveBoardPath(boardId, filePath, 'absolute');
      }
      var kind = (ext === 'md' || ext === 'markdown') ? 'markdown' : 'text';
      body.innerHTML = renderEmbedPreviewContent(kind, boardId, previewPath, text);
      applyRenderedHtmlCommentVisibility(body, currentHtmlCommentRenderMode);
      applyRenderedTagVisibility(body, currentTagVisibilityMode);
      flushPendingDiagramQueues();
      enhanceEmbeddedContent(body);
      enhanceFileLinks(body);
      enhanceIncludeDirectives(body);
    } catch (err) {
      logFrontendIssue(
        'warn',
        'embed.inline-file',
        'Failed to render inline file preview for board ' + boardId + ' path ' + filePath,
        err
      );
      container.classList.add('embed-broken');
      body.innerHTML = '<div class="broken-include-placeholder">Inline file unavailable</div>';
    }
  }

  async function enhanceIncludeDirectives(root) {
    if (!root || !root.querySelectorAll) return;
    var containers = root.querySelectorAll('.include-inline-container[data-file-path]');
    for (var i = 0; i < containers.length; i++) {
      enhanceSingleIncludeDirective(containers[i]);
    }
  }

  async function enhanceColumnIncludeBadges(root) {
    if (!root || !root.querySelectorAll) return;
    var badges = root.querySelectorAll('.column-include-badge[data-include-path]');
    for (var i = 0; i < badges.length; i++) {
      enhanceSingleColumnIncludeBadge(badges[i]);
    }
  }

  async function enhanceSingleColumnIncludeBadge(badge) {
    if (!badge || badge.getAttribute('data-include-enhanced') === '1') return;
    var boardId = activeBoardId || '';
    var includePath = badge.getAttribute('data-include-path') || '';
    if (!boardId || !includePath) return;
    badge.setAttribute('data-include-enhanced', '1');
    var resolvedPath = includePath;
    if (isBoardRelativePath(includePath)) {
      resolvedPath = await resolveBoardPath(boardId, includePath, 'absolute');
    }
    var info = await requestFileInfo(boardId, resolvedPath || includePath);
    var isMissing = !info || info.exists === false;
    badge.classList.toggle('include-broken', isMissing);
    if (isMissing) {
      badge.setAttribute('title', 'Missing include: ' + includePath);
    }
  }

  async function enhanceSingleIncludeDirective(container) {
    if (!container || container.getAttribute('data-include-enhanced') === '1') return;
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    var rawPath = container.getAttribute('data-file-path') || '';
    var depth = parseInt(container.getAttribute('data-include-depth') || '0', 10);
    var link = container.querySelector('.markdown-file-link[data-file-path]');
    var body = container.querySelector('.include-inline-body');
    if (!boardId || !rawPath || !body) return;

    container.setAttribute('data-include-enhanced', '1');
    if (!isFinite(depth)) depth = 0;
    if (depth >= MAX_INCLUDE_PREVIEW_DEPTH) {
      body.innerHTML = '';
      return;
    }

    body.innerHTML = '<div class="embed-preview-loading">Loading include...</div>';

    var resolvedPath = rawPath;
    if (isBoardRelativePath(rawPath)) {
      resolvedPath = await resolveBoardPath(boardId, rawPath, 'absolute');
    }
    if (resolvedPath && link) {
      link.setAttribute('data-file-path', resolvedPath);
      link.setAttribute('data-original-href', resolvedPath);
    }

    var info = await requestFileInfo(boardId, resolvedPath || rawPath);
    applyFileLinkInfo(link, info, resolvedPath || rawPath);
    var isMissing = !info || info.exists === false;
    if (isMissing) {
      container.classList.add('include-broken');
      body.innerHTML = '<div class="broken-include-placeholder">Included content unavailable</div>';
      return;
    }

    try {
      var response = await fetch(LexeraApi.fileUrl(boardId, resolvedPath || rawPath));
      if (!response.ok) throw new Error('Failed to load include');
      var text = await response.text();
      var rewritten = resolveMarkdownRelativeTargets(text, resolvedPath || rawPath);
      body.innerHTML = '<div class="included-content-block">' +
        renderCardContent(rewritten, boardId, {
          footnoteDefs: {},
          footnoteOrder: [],
          abbrDefs: {},
          embedCounter: 0
        }, { nested: true }) +
        '</div>';
      applyRenderedHtmlCommentVisibility(body, currentHtmlCommentRenderMode);
      applyRenderedTagVisibility(body, currentTagVisibilityMode);

      var nested = body.querySelectorAll('.include-inline-container[data-file-path]');
      for (var i = 0; i < nested.length; i++) {
        nested[i].setAttribute('data-include-depth', String(depth + 1));
      }

      flushPendingDiagramQueues();
      enhanceEmbeddedContent(body);
      enhanceFileLinks(body);
      enhanceIncludeDirectives(body);
    } catch (err) {
      logFrontendIssue(
        'warn',
        'embed.include',
        'Failed to render include preview for board ' + boardId + ' path ' + rawPath,
        err
      );
      container.classList.add('include-broken');
      body.innerHTML = '<div class="broken-include-placeholder">Included content unavailable</div>';
    }
  }

  async function enhanceSingleEmbedContainer(container) {
    if (!container || container.getAttribute('data-embed-enhanced') === '1') return;
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    var filePath = container.getAttribute('data-file-path') || '';
    if (!boardId || !filePath) return;
    var fileRef = parseLocalFileReference(filePath);
    var previewKind = getEmbedPreviewKind(filePath);
    if (!previewKind) return;

    container.setAttribute('data-embed-enhanced', '1');
    var cacheKey = getEmbedPreviewCacheKey(boardId, filePath);
    var previewEl = document.createElement(previewKind === 'pdf' ? 'iframe' : 'div');
    previewEl.className = 'embed-preview embed-preview-' + previewKind;

    if (previewKind === 'pdf') {
      previewEl.setAttribute('loading', 'lazy');
      previewEl.setAttribute('title', getDisplayFileNameFromPath(filePath) || 'PDF preview');
      previewEl.setAttribute(
        'src',
        LexeraApi.fileUrl(boardId, fileRef.path) +
          '#toolbar=0&navpanes=0' +
          (fileRef.pageNumber ? '&page=' + fileRef.pageNumber : '')
      );
      container.appendChild(previewEl);
      return;
    }

    if (previewKind === 'diagram' || previewKind === 'spreadsheet' || previewKind === 'epub' || previewKind === 'document') {
      container.appendChild(previewEl);
      var previewPage = container.getAttribute('data-preview-page') || '';
      var rendered = await renderCachedSpecialPreview(previewEl, boardId, filePath, previewKind, { pageNumber: previewPage });
      if (!rendered) {
        previewEl.innerHTML = buildFilePreviewPlaceholderHtml(
          previewKind,
          filePath,
          getSpecialPreviewPlaceholderText(previewKind)
        );
      }
      return;
    }

    previewEl.innerHTML = '<div class="embed-preview-loading">Loading preview...</div>';
    container.appendChild(previewEl);
    try {
      var cached = embedPreviewCache[cacheKey];
      if (!cached) {
        var response = await fetch(LexeraApi.fileUrl(boardId, fileRef.path));
        if (!response.ok) throw new Error('Failed to load file preview');
        var text = await response.text();
        var previewPath = filePath;
        if (previewKind === 'markdown' && isBoardRelativePath(filePath)) {
          previewPath = await resolveBoardPath(boardId, filePath, 'absolute');
        }
        cached = renderEmbedPreviewContent(previewKind, boardId, previewPath, text);
        embedPreviewCache[cacheKey] = cached;
      }
      previewEl.innerHTML = cached;
      applyRenderedHtmlCommentVisibility(previewEl, currentHtmlCommentRenderMode);
      applyRenderedTagVisibility(previewEl, currentTagVisibilityMode);
      flushPendingDiagramQueues();
    } catch (err) {
      logFrontendIssue(
        'warn',
        'embed.preview',
        'Failed to render embed preview for board ' + boardId + ' path ' + filePath,
        err
      );
      previewEl.innerHTML = '<div class="embed-preview-error">Preview unavailable</div>';
    }
  }

  function resolveBoardPath(boardId, filePath, toMode) {
    return LexeraApi.request('/boards/' + boardId + '/convert-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: '', path: filePath, to: toMode }),
    }).then(function (res) {
      return res && res.path ? res.path : filePath;
    }).catch(function (err) {
      logFrontendIssue(
        'warn',
        'path.resolve',
        'Failed to resolve ' + toMode + ' path for board ' + boardId + ' path ' + filePath,
        err
      );
      return filePath;
    });
  }

  function openBoardFileInSystem(boardId, filePath) {
    if (!filePath) return;
    var fileRef = parseLocalFileReference(filePath);
    if (isAbsoluteFilePath(fileRef.path) || !boardId) {
      openInSystem(fileRef.path);
      return;
    }
    resolveBoardPath(boardId, fileRef.path, 'absolute').then(function (absPath) {
      openInSystem(absPath);
    });
  }

  async function showBoardFilePreview(boardId, filePath, options) {
    var fileRef = parseLocalFileReference(filePath);
    var ext = getFileExtension(fileRef.path);
    var mediaCategory = getMediaCategory(ext);
    var previewKind = getEmbedPreviewKind(filePath);
    if (!filePath || !boardId) return;
    if (!(previewKind === 'pdf' || previewKind === 'diagram' || previewKind === 'spreadsheet' || previewKind === 'epub' || previewKind === 'document' || isTextPreviewExtension(ext) || mediaCategory === 'image' || mediaCategory === 'video' || mediaCategory === 'audio')) {
      openBoardFileInSystem(boardId, filePath);
      return;
    }

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'modal-dialog file-preview-dialog';
    dialog.innerHTML =
      '<div class="modal-title">' + escapeHtml(getDisplayFileNameFromPath(filePath) || filePath) + '</div>' +
      '<div class="file-preview-body"><div class="embed-preview-loading">Loading preview...</div></div>' +
      '<div class="hidden-items-footer">' +
        '<button class="board-action-btn" data-file-preview-action="open-system">Open in System App</button>' +
        '<button class="board-action-btn" data-file-preview-action="close">Close</button>' +
      '</div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    var body = dialog.querySelector('.file-preview-body');
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
    dialog.addEventListener('click', function (e) {
      var actionBtn = e.target.closest('[data-file-preview-action]');
      if (!actionBtn) return;
      var action = actionBtn.getAttribute('data-file-preview-action');
      if (action === 'close') {
        overlay.remove();
      } else if (action === 'open-system') {
        openBoardFileInSystem(boardId, filePath);
      }
    });

    if (previewKind === 'pdf') {
      body.innerHTML =
        '<iframe class="file-preview-frame" src="' +
        LexeraApi.fileUrl(boardId, fileRef.path) +
        '#toolbar=0&navpanes=0' +
        (fileRef.pageNumber ? '&page=' + fileRef.pageNumber : '') +
        '"></iframe>';
      return;
    }

    if (previewKind === 'diagram' || previewKind === 'spreadsheet' || previewKind === 'epub' || previewKind === 'document') {
      var modalPage = options && options.pageNumber ? options.pageNumber : '';
      var rendered = await renderCachedSpecialPreview(body, boardId, filePath, previewKind, {
        modal: true,
        pageNumber: modalPage
      });
      if (!rendered) {
        body.innerHTML = buildFilePreviewPlaceholderHtml(
          previewKind,
          filePath,
          getSpecialPreviewPlaceholderText(previewKind)
        );
      }
      return;
    }

    if (mediaCategory === 'image') {
      body.innerHTML = '<div class="file-preview-media"><img class="file-preview-image" src="' + escapeAttr(LexeraApi.fileUrl(boardId, fileRef.path)) + '" alt="' + escapeAttr(getDisplayFileNameFromPath(filePath) || filePath) + '"></div>';
      return;
    }

    if (mediaCategory === 'video') {
      body.innerHTML = '<div class="file-preview-media"><video class="file-preview-video" controls preload="metadata" src="' + escapeAttr(LexeraApi.fileUrl(boardId, fileRef.path)) + '"></video></div>';
      return;
    }

    if (mediaCategory === 'audio') {
      body.innerHTML = '<div class="file-preview-media"><audio class="file-preview-audio" controls preload="metadata" src="' + escapeAttr(LexeraApi.fileUrl(boardId, fileRef.path)) + '"></audio></div>';
      return;
    }

    try {
      var response = await fetch(LexeraApi.fileUrl(boardId, fileRef.path));
      if (!response.ok) throw new Error('Failed to load preview');
      var text = await response.text();
      if (isMarkdownPreviewExtension(ext)) {
        var previewPath = filePath;
        if (isBoardRelativePath(filePath)) {
          previewPath = await resolveBoardPath(boardId, filePath, 'absolute');
        }
        body.innerHTML = '<div class="file-preview-markdown">' +
          renderCardContent(resolveMarkdownRelativeTargets(text, previewPath), boardId, {
            footnoteDefs: {},
            footnoteOrder: [],
            abbrDefs: {},
            embedCounter: 0
          }, { nested: true }) +
          '</div>';
        applyRenderedHtmlCommentVisibility(body, currentHtmlCommentRenderMode);
        applyRenderedTagVisibility(body, currentTagVisibilityMode);
        enhanceEmbeddedContent(body);
        enhanceFileLinks(body);
        enhanceIncludeDirectives(body);
      } else {
        body.innerHTML = '<pre class="file-preview-text">' + escapeHtml(text) + '</pre>';
      }
      flushPendingDiagramQueues();
    } catch (err) {
      logFrontendIssue(
        'warn',
        'file.preview',
        'Failed to render file preview for board ' + boardId + ' path ' + filePath,
        err
      );
      body.innerHTML = '<div class="embed-preview-error">Preview unavailable</div>';
    }
  }

  function closeEmbedMenu() {
    if (activeEmbedMenu) {
      activeEmbedMenu.remove();
      activeEmbedMenu = null;
    }
  }

  document.addEventListener('click', function (e) {
    var wikiMenuBtn = e.target.closest('.wiki-menu-btn');
    if (wikiMenuBtn) {
      e.preventDefault();
      e.stopPropagation();
      var wikiMenuContainer = wikiMenuBtn.closest('.wiki-link-container');
      if (wikiMenuContainer) showWikiMenu(wikiMenuContainer, wikiMenuBtn);
      return;
    }

    var wikiLink = e.target.closest('.wiki-link');
    if (wikiLink) {
      e.preventDefault();
      e.stopPropagation();
      openWikiDocument(wikiLink.getAttribute('data-document') || wikiLink.textContent || '');
      return;
    }

    var anchorLink = e.target.closest('a[href]');
    if (anchorLink) {
      var hrefValue = anchorLink.getAttribute('data-original-href') || anchorLink.getAttribute('href') || '';
      if (hrefValue.charAt(0) === '#' && hrefValue.length > 1 && hrefValue.indexOf('#footnote-') !== 0) {
        e.preventDefault();
        e.stopPropagation();
        openWikiSearch(hrefValue);
        return;
      }
    }

    var fileLink = e.target.closest('.markdown-file-link');
    if (fileLink) {
      e.preventDefault();
      e.stopPropagation();
      showBoardFilePreview(
        fileLink.getAttribute('data-board-id') || activeBoardId || '',
        fileLink.getAttribute('data-file-path') || fileLink.getAttribute('data-original-href') || ''
      );
      return;
    }

    var embedFileLink = e.target.closest('.embed-file-link');
    if (embedFileLink) {
      var embedContainer = embedFileLink.closest('.embed-container');
      if (embedContainer) {
        e.preventDefault();
        e.stopPropagation();
        showBoardFilePreview(
          embedContainer.getAttribute('data-board-id') || activeBoardId || '',
          embedContainer.getAttribute('data-file-path') || '',
          { pageNumber: embedContainer.getAttribute('data-preview-page') || '' }
        );
        return;
      }
    }

    var inlineFileLabel = e.target.closest('.inline-file-embed-label[data-action="open-inline-file"]');
    if (inlineFileLabel) {
      var inlineFileContainer = inlineFileLabel.closest('.inline-file-embed-container[data-file-path]');
      if (inlineFileContainer) {
        e.preventDefault();
        e.stopPropagation();
        openBoardFileInSystem(
          inlineFileContainer.getAttribute('data-board-id') || activeBoardId || '',
          inlineFileContainer.getAttribute('data-file-path') || ''
        );
        return;
      }
    }

    var diagramMenuBtn = e.target.closest('.diagram-menu-btn');
    if (diagramMenuBtn) {
      e.preventDefault();
      e.stopPropagation();
      var diagramContainer = diagramMenuBtn.closest('.diagram-overlay-container[data-diagram-type]');
      if (!diagramContainer) return;
      showDiagramMenu(diagramContainer, diagramMenuBtn);
      return;
    }

    var linkMenuBtn = e.target.closest('.link-menu-btn');
    if (linkMenuBtn) {
      e.preventDefault();
      e.stopPropagation();
      var linkContainer = linkMenuBtn.closest('.link-path-overlay-container[data-file-path]');
      if (!linkContainer) return;
      showBoardFileLinkMenu(linkContainer, linkMenuBtn);
      return;
    }

    // Handle burger menu button clicks for embeds/includes
    if (e.target.classList.contains('embed-menu-btn') || e.target.classList.contains('include-menu-btn')) {
      e.stopPropagation();
      var container = e.target.closest(
        '.embed-container, .external-embed-container, .inline-file-embed-container, ' +
        '.include-link-container[data-file-path], .include-inline-container[data-file-path]'
      );
      if (!container) return;
      if (isIncludeDirectiveContainer(container)) showIncludeMenu(container, e.target);
      else showEmbedMenu(container, e.target);
      return;
    }

    // Handle action clicks in info/path-fix panels (still DOM-based)
    var actionEl = e.target.closest('[data-action]');
    if (actionEl && activeEmbedMenu && activeEmbedMenu.contains(actionEl)) {
      e.stopPropagation();
      var action = actionEl.getAttribute('data-action');
      var embedContainer = activeEmbedMenu._embedContainer;
      if (embedContainer && embedContainer.classList && embedContainer.classList.contains('link-path-overlay-container')) {
        handleBoardFileLinkAction(action, embedContainer);
      } else {
        handleEmbedAction(action, embedContainer);
      }
      return;
    }

    // Click outside closes info/path-fix panel
    if (activeEmbedMenu && !activeEmbedMenu.contains(e.target)) {
      closeEmbedMenu();
    }
  }, true);

  // Right-click on embeds and file links → native context menu
  document.addEventListener('contextmenu', function (e) {
    var wikiContainer = e.target.closest('.wiki-link-container');
    if (wikiContainer) {
      var wikiLink = wikiContainer.querySelector('.wiki-link');
      if (!wikiLink) return;
      e.preventDefault();
      e.stopPropagation();
      showWikiMenu(wikiContainer, wikiLink);
      return;
    }

    var linkContainer = e.target.closest('.link-path-overlay-container[data-file-path]');
    if (linkContainer) {
      e.preventDefault();
      e.stopPropagation();
      showBoardFileLinkMenu(linkContainer, e);
      return;
    }

    var diagramContainer = e.target.closest('.diagram-overlay-container[data-diagram-type]');
    if (diagramContainer) {
      e.preventDefault();
      e.stopPropagation();
      showDiagramMenu(diagramContainer, e);
      return;
    }

    var container = e.target.closest(
      '.embed-container, .external-embed-container, .inline-file-embed-container, ' +
      '.include-link-container[data-file-path], .include-inline-container[data-file-path], ' +
      '.image-path-overlay-container[data-file-path], .video-path-overlay-container[data-file-path], ' +
      '.wysiwyg-media[data-file-path], .wysiwyg-media-block[data-file-path]'
    );
    var link = !container ? e.target.closest('.markdown-file-link, a[href]') : null;
    if (!container && !link) return;

    var filePath = container
      ? getEmbedActionTarget(container)
      : (link.getAttribute('data-file-path') || link.getAttribute('data-original-href') || link.getAttribute('href'));
    if (!filePath) return;

    e.preventDefault();
    e.stopPropagation();

    var isExternalEmbed = !!container && isExternalEmbedContainer(container);
    var isIncludeContainer = !!container && isIncludeDirectiveContainer(container);
    var menuItems = isIncludeContainer
      ? [
          { id: 'preview', label: 'Preview Include File' },
          { separator: true },
          { id: 'open-system', label: 'Open in System App' },
          { id: 'show-finder', label: 'Show in Finder' },
          { id: 'copy-path', label: 'Copy Path' },
          { id: 'path-fix', label: 'Automatic Path Fix' },
          { id: 'path-manual', label: 'Manual Path Fix' },
          { id: 'path-web-search', label: 'Web-Search File' },
          { id: 'convert-path', label: isAbsoluteFilePath(parseLocalFileReference(filePath).path) ? 'Convert to Relative' : 'Convert to Absolute' },
          { separator: true },
          { id: 'delete', label: 'Delete Include' },
        ]
      : isExternalEmbed
      ? [
          { id: 'open-url', label: 'Open URL in Browser' },
          { id: 'copy-url', label: 'Copy URL' },
          { id: 'edit-url', label: 'Edit URL' },
          { separator: true },
          { id: 'delete', label: 'Delete Embed' },
        ]
      : [
          { id: container ? 'open-system' : 'file-open', label: 'Open in System App' },
          { id: container ? 'show-finder' : 'file-finder', label: 'Show in Finder' },
        ];

    if (!isExternalEmbed && /^(https?:\/\/|mailto:|#)/.test(filePath)) return;

    showNativeMenu(menuItems, e.clientX, e.clientY).then(function (action) {
      if (!action) return;
      if (container) {
        if (isIncludeDirectiveContainer(container)) handleIncludeAction(action, container);
        else handleEmbedAction(action, container);
        return;
      }
      var fileRef = parseLocalFileReference(filePath);
      var boardId = container
        ? container.getAttribute('data-board-id')
        : (activeBoardId || '');

      function resolveAndRun(fn) {
        if (!isAbsoluteFilePath(fileRef.path) && boardId) {
          resolveBoardPath(boardId, fileRef.path, 'absolute').then(function (resolvedPath) { fn(resolvedPath); });
        } else {
          fn(fileRef.path);
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

  function tauriListen(eventName, callback) {
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.transformCallback === 'function') {
      var handler = window.__TAURI_INTERNALS__.transformCallback(function (event) {
        callback(event);
      }, false);
      window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
        event: eventName,
        target: { kind: 'Any' },
        handler: handler,
      });
      return;
    }
    if (window.__TAURI__ && window.__TAURI__.event) {
      window.__TAURI__.event.listen(eventName, callback);
    }
  }

  /**
   * Show a native OS context menu via Tauri. Returns selected action ID or null.
   * items: array of { id, label, separator, disabled, items (for submenus) }
   */
  var activeHtmlMenu = null;
  var activeHtmlMenuClickOutside = null;

  function closeHtmlMenu() {
    if (activeHtmlMenuClickOutside) {
      document.removeEventListener('mousedown', activeHtmlMenuClickOutside, true);
      activeHtmlMenuClickOutside = null;
    }
    if (activeHtmlMenu) { activeHtmlMenu.remove(); activeHtmlMenu = null; }
  }

  function showHtmlMenu(items, x, y) {
    closeHtmlMenu();
    return new Promise(function (resolve) {
      var menu = document.createElement('div');
      menu.className = 'html-context-menu';
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';

      function buildItems(itemList, container) {
        for (var i = 0; i < itemList.length; i++) {
          var item = itemList[i];
          if (item.separator) {
            var sep = document.createElement('div');
            sep.className = 'html-menu-separator';
            container.appendChild(sep);
            continue;
          }
          var el = document.createElement('div');
          el.className = 'html-menu-item' + (item.disabled ? ' disabled' : '');
          el.textContent = item.label || '';
          if (item.items && item.items.length > 0) {
            // Submenu
            el.classList.add('has-submenu');
            var sub = document.createElement('div');
            sub.className = 'html-menu-submenu';
            buildItems(item.items, sub);
            el.appendChild(sub);
          } else if (!item.disabled) {
            (function (id) {
              el.addEventListener('click', function (e) {
                e.stopPropagation();
                closeHtmlMenu();
                resolve(id);
              });
            })(item.id);
          }
          container.appendChild(el);
        }
      }

      buildItems(items, menu);
      document.body.appendChild(menu);
      activeHtmlMenu = menu;

      // Keep menu in viewport
      requestAnimationFrame(function () {
        var rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - rect.width - 4) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - rect.height - 4) + 'px';
      });

      // Close on click outside
      function onClickOutside(e) {
        if (!menu.contains(e.target)) {
          closeHtmlMenu();
          resolve(null);
        }
      }
      activeHtmlMenuClickOutside = onClickOutside;
      setTimeout(function () {
        if (activeHtmlMenuClickOutside === onClickOutside) {
          document.addEventListener('mousedown', onClickOutside, true);
        }
      }, 0);
    });
  }

  function showNativeMenu(items, x, y, traceTarget) {
    var target = traceTarget || 'menu.native';
    var summary = {
      x: x,
      y: y,
      itemIds: summarizeMenuItems(items),
      mode: hasTauri ? 'tauri' : 'html'
    };
    if (!hasTauri) {
      traceFrontendAction('info', target, 'Opening HTML menu', summary);
      return showHtmlMenu(items, x, y).then(function (result) {
        if (result) {
          traceFrontendAction('info', target, 'HTML menu selected action', { action: result });
        } else {
          traceFrontendAction('warn', target, 'HTML menu closed without selection', summary);
        }
        return result;
      });
    }
    traceFrontendAction('info', target, 'Opening native menu', summary);
    return tauriInvoke('show_context_menu', { items: items, x: x, y: y }).then(function (result) {
      if (result) {
        traceFrontendAction('info', target, 'Native menu selected action', { action: result });
      } else {
        traceFrontendAction('warn', target, 'Native menu closed without selection', summary);
      }
      return result;
    }).catch(function (err) {
      logFrontendIssue('error', target, 'Native menu failed, falling back to HTML menu', err);
      traceFrontendAction('info', target, 'Opening HTML fallback menu', summary);
      return showHtmlMenu(items, x, y).then(function (result) {
        if (result) {
          traceFrontendAction('info', target, 'HTML fallback menu selected action', { action: result });
        } else {
          traceFrontendAction('warn', target, 'HTML fallback menu closed without selection', summary);
        }
        return result;
      });
    });
  }

  function showWikiMenu(container, btn) {
    if (!container || !btn) return;
    var documentName = container.getAttribute('data-document') || '';
    var resolved = resolveWikiDocument(documentName);
    var btnRect = btn.getBoundingClientRect();
    var otherPane = activeSplitPane === 'a' ? 'b' : 'a';
    var menuItems = [];

    if (resolved.kind === 'board' && resolved.boardId) {
      menuItems.push({ label: getBoardDisplayName(resolved.board) || resolved.document, disabled: true });
      menuItems.push({ id: 'open', label: 'Open Linked Board' });
      if (!embeddedMode) {
        menuItems.push({
          id: 'open-other-pane',
          label: splitViewMode === 'single' ? 'Open in Split View' : 'Open in Other Pane (' + otherPane.toUpperCase() + ')'
        });
      }
      menuItems.push({ id: 'search', label: 'Search for Reference' });
    } else if (resolved.kind === 'tag') {
      menuItems.push({ label: resolved.document, disabled: true });
      menuItems.push({ id: 'search', label: 'Search Tag' });
    } else {
      menuItems.push({ label: 'No matching board', disabled: true });
      menuItems.push({ id: 'search', label: 'Search for Matching Board' });
    }

    menuItems.push({ separator: true });
    menuItems.push({ id: 'copy', label: 'Copy Wiki Target' });

    showNativeMenu(menuItems, btnRect.right, btnRect.bottom).then(function (action) {
      if (action) handleWikiAction(action, container);
    });
  }

  function handleWikiAction(action, container) {
    if (!container || !action) return;
    var documentName = container.getAttribute('data-document') || '';
    if (!documentName) return;
    if (action === 'open') {
      openWikiDocument(documentName);
      return;
    }
    if (action === 'open-other-pane') {
      openWikiDocument(documentName, { pane: activeSplitPane === 'a' ? 'b' : 'a' });
      return;
    }
    if (action === 'search') {
      openWikiSearch(documentName);
      return;
    }
    if (action === 'copy' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(documentName).then(function () {
        showNotification('Wiki target copied to clipboard');
      }).catch(function (err) {
        logFrontendIssue('warn', 'clipboard.copy', 'Failed to copy wiki target to clipboard', err);
        showNotification('Failed to copy wiki target');
      });
    }
  }

  function isIncludeDirectiveContainer(container) {
    return !!(container && container.classList && (
      container.classList.contains('include-link-container') ||
      container.classList.contains('include-inline-container')
    ));
  }

  function updateIncludeTarget(container, nextTarget) {
    if (!container) return Promise.resolve(false);
    var includeIndex = parseInt(container.getAttribute('data-include-index'), 10);
    var nextValue = String(nextTarget || '').trim();
    if (!nextValue) return Promise.resolve(false);
    return mutateEmbedSource(container, function (content) {
      return replaceNthIncludeDirective(content, isFinite(includeIndex) ? includeIndex : 0, function () {
        return '!!!include(' + nextValue + ')!!!';
      });
    });
  }

  function deleteIncludeFromSource(container) {
    if (!container) return Promise.resolve(false);
    var includeIndex = parseInt(container.getAttribute('data-include-index'), 10);
    return mutateEmbedSource(container, function (content) {
      return replaceNthIncludeDirective(content, isFinite(includeIndex) ? includeIndex : 0, function () {
        return '';
      });
    });
  }

  function showBoardFileLinkMenu(container, trigger) {
    if (!container) return;
    var filePath = container.getAttribute('data-file-path') || '';
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    if (!filePath || !boardId) return;
    var fileRef = parseLocalFileReference(filePath);
    var isAbsolute = isAbsoluteFilePath(fileRef.path);
    var x = 0;
    var y = 0;
    if (trigger && typeof trigger.clientX === 'number' && typeof trigger.clientY === 'number') {
      x = trigger.clientX;
      y = trigger.clientY;
    } else if (trigger && typeof trigger.getBoundingClientRect === 'function') {
      var rect = trigger.getBoundingClientRect();
      x = rect.right;
      y = rect.bottom;
    } else {
      var containerRect = container.getBoundingClientRect();
      x = containerRect.right;
      y = containerRect.bottom;
    }

    showNativeMenu([
      { id: 'preview', label: 'Preview File' },
      { separator: true },
      { id: 'open-system', label: 'Open in System App' },
      { id: 'show-finder', label: 'Show in Finder' },
      { id: 'copy-path', label: 'Copy Path' },
      { id: 'path-fix', label: 'Automatic Path Fix' },
      { id: 'path-manual', label: 'Manual Path Fix' },
      { id: 'path-web-search', label: 'Web-Search File' },
      { id: 'convert-path', label: isAbsolute ? 'Convert to Relative' : 'Convert to Absolute' },
    ], x, y).then(function (action) {
      if (action) handleBoardFileLinkAction(action, container);
    });
  }

  function showDiagramMenu(container, trigger) {
    if (!container) return;
    var x = 0;
    var y = 0;
    if (trigger && typeof trigger.clientX === 'number' && typeof trigger.clientY === 'number') {
      x = trigger.clientX;
      y = trigger.clientY;
    } else if (trigger && typeof trigger.getBoundingClientRect === 'function') {
      var rect = trigger.getBoundingClientRect();
      x = rect.right;
      y = rect.bottom;
    } else {
      var containerRect = container.getBoundingClientRect();
      x = containerRect.right;
      y = containerRect.top;
    }
    var diagramType = container.getAttribute('data-diagram-type') || 'diagram';
    var typeLabel = diagramType === 'mermaid' ? 'Mermaid' : 'PlantUML';
    showNativeMenu([
      { id: 'copy-svg', label: 'Copy SVG' },
      { id: 'copy-code', label: 'Copy ' + typeLabel + ' Code' },
    ], x, y).then(function (action) {
      if (action) handleDiagramAction(action, container);
    });
  }

  function handleDiagramAction(action, container) {
    if (!container) return;
    if (action === 'copy-code') {
      copyTextToClipboard(
        container.getAttribute('data-diagram-code') || '',
        'Diagram code copied to clipboard',
        'Failed to copy diagram code'
      );
      return;
    }
    if (action === 'copy-svg') {
      var svg = container.querySelector('svg');
      if (!svg) {
        showNotification('SVG not available yet');
        return;
      }
      copyTextToClipboard(
        svg.outerHTML || '',
        'Diagram SVG copied to clipboard',
        'Failed to copy diagram SVG'
      );
    }
  }

  function handleBoardFileLinkAction(action, container) {
    if (!container) {
      closeEmbedMenu();
      return;
    }
    var filePath = container.getAttribute('data-file-path') || '';
    var boardId = container.getAttribute('data-board-id') || activeBoardId || '';
    if (!filePath || !boardId) return;
    var fileRef = parseLocalFileReference(filePath);

    if (action === 'preview') {
      closeEmbedMenu();
      showBoardFilePreview(boardId, filePath);

    } else if (action === 'open-system') {
      closeEmbedMenu();
      openBoardFileInSystem(boardId, filePath);

    } else if (action === 'show-finder') {
      closeEmbedMenu();
      if (isAbsoluteFilePath(fileRef.path)) {
        showInFinder(fileRef.path);
      } else {
        resolveBoardPath(boardId, fileRef.path, 'absolute').then(function (absPath) {
          showInFinder(absPath);
        });
      }

    } else if (action === 'copy-path') {
      closeEmbedMenu();
      copyTextToClipboard(filePath, 'File path copied to clipboard', 'Failed to copy file path');

    } else if (action === 'path-fix') {
      closeEmbedMenu();
      LexeraApi.request('/boards/' + boardId + '/find-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: getDisplayFileNameFromPath(fileRef.path) }),
      }).then(function (res) {
        showPathFixResults(container, res && res.matches ? res.matches : []);
      }).catch(function (err) {
        logFrontendIssue('warn', 'path.fix', 'Automatic path fix failed for file link ' + filePath, err);
      });

    } else if (action === 'path-manual') {
      closeEmbedMenu();
      var nextPath = promptForEmbedTarget(filePath, 'Manual path fix');
      if (!nextPath || nextPath === filePath) return;
      updateBoardFileLinkTarget(container, nextPath);

    } else if (action === 'path-web-search') {
      closeEmbedMenu();
      openEmbedWebSearch(container, filePath);

    } else if (action === 'convert-path') {
      closeEmbedMenu();
      resolveBoardPath(boardId, fileRef.path, isAbsoluteFilePath(fileRef.path) ? 'relative' : 'absolute').then(function (nextPath) {
        var nextTarget = nextPath ? nextPath + (fileRef.suffix || '') : '';
        if (!nextTarget || nextTarget === filePath) return;
        updateBoardFileLinkTarget(container, nextTarget);
      }).catch(function (err) {
        logFrontendIssue('warn', 'path.convert', 'Path conversion failed for file link ' + filePath, err);
      });

    } else if (action && action.indexOf('pick-path:') === 0) {
      closeEmbedMenu();
      updateBoardFileLinkTarget(container, action.substring(10) + (fileRef.suffix || ''));

    } else if (action === 'close-info') {
      closeEmbedMenu();
    }
  }

  function showIncludeMenu(container, btn) {
    var filePath = container.getAttribute('data-file-path') || '';
    var boardId = container.getAttribute('data-board-id') || '';
    if (!filePath || !boardId) return;
    var isAbsolute = isAbsoluteFilePath(parseLocalFileReference(filePath).path);
    var btnRect = btn.getBoundingClientRect();
    showNativeMenu([
      { id: 'preview', label: 'Preview Include File' },
      { separator: true },
      { id: 'open-system', label: 'Open in System App' },
      { id: 'show-finder', label: 'Show in Finder' },
      { id: 'copy-path', label: 'Copy Path' },
      { id: 'path-fix', label: 'Automatic Path Fix' },
      { id: 'path-manual', label: 'Manual Path Fix' },
      { id: 'path-web-search', label: 'Web-Search File' },
      { id: 'convert-path', label: isAbsolute ? 'Convert to Relative' : 'Convert to Absolute' },
      { separator: true },
      { id: 'delete', label: 'Delete Include' },
    ], btnRect.right, btnRect.bottom).then(function (action) {
      if (action) handleIncludeAction(action, container);
    });
  }

  function handleIncludeAction(action, container) {
    if (!container) { closeEmbedMenu(); return; }
    var filePath = container.getAttribute('data-file-path') || '';
    var boardId = container.getAttribute('data-board-id') || '';
    var fileRef = parseLocalFileReference(filePath);

    if (action === 'preview') {
      closeEmbedMenu();
      showBoardFilePreview(boardId, filePath);

    } else if (action === 'open-system') {
      closeEmbedMenu();
      openBoardFileInSystem(boardId, filePath);

    } else if (action === 'show-finder') {
      closeEmbedMenu();
      if (fileRef.path.charAt(0) !== '/' && boardId) {
        resolveBoardPath(boardId, fileRef.path, 'absolute').then(function (absPath) {
          showInFinder(absPath);
        });
      } else {
        showInFinder(fileRef.path);
      }

    } else if (action === 'copy-path') {
      closeEmbedMenu();
      copyTextToClipboard(filePath, 'Include path copied to clipboard', 'Failed to copy include path');

    } else if (action === 'path-fix') {
      closeEmbedMenu();
      var filename = getDisplayFileNameFromPath(fileRef.path);
      LexeraApi.request('/boards/' + boardId + '/find-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename }),
      }).then(function (res) {
        showPathFixResults(container, res && res.matches ? res.matches : []);
      }).catch(function (err) {
        logFrontendIssue('warn', 'path.fix', 'Automatic path fix failed for include ' + filePath, err);
      });

    } else if (action === 'path-manual') {
      closeEmbedMenu();
      var nextPath = promptForEmbedTarget(filePath, 'Manual path fix');
      if (!nextPath || nextPath === filePath) return;
      updateIncludeTarget(container, nextPath);

    } else if (action === 'path-web-search') {
      closeEmbedMenu();
      openEmbedWebSearch(container, filePath);

    } else if (action === 'convert-path') {
      closeEmbedMenu();
      var isAbsolute = isAbsoluteFilePath(fileRef.path);
      resolveBoardPath(boardId, fileRef.path, isAbsolute ? 'relative' : 'absolute').then(function (nextPath) {
        var nextTarget = nextPath ? nextPath + (fileRef.suffix || '') : '';
        if (!nextTarget || nextTarget === filePath) return;
        updateIncludeTarget(container, nextTarget);
      }).catch(function (err) {
        logFrontendIssue('warn', 'path.convert', 'Path conversion failed for include ' + filePath, err);
      });

    } else if (action === 'delete') {
      closeEmbedMenu();
      deleteIncludeFromSource(container);

    } else if (action && action.indexOf('pick-path:') === 0) {
      closeEmbedMenu();
      updateIncludeTarget(container, action.substring(10) + (fileRef.suffix || ''));

    } else if (action === 'close-info') {
      closeEmbedMenu();
    }
  }

  function showEmbedMenu(container, btn) {
    var filePath = container.getAttribute('data-file-path') || '';
    var embedUrl = container.getAttribute('data-embed-url') || '';
    var isExternal = isExternalEmbedContainer(container);
    var isAbsolute = filePath && isAbsoluteFilePath(parseLocalFileReference(filePath).path);
    var btnRect = btn.getBoundingClientRect();
    var items = isExternal
      ? [
          { id: 'open-url', label: 'Open URL in Browser' },
          { id: 'copy-url', label: 'Copy URL' },
          { id: 'edit-url', label: 'Edit URL' },
          { separator: true },
          { id: 'delete', label: 'Delete Embed' },
        ]
      : [
          { id: 'refresh', label: 'Force Refresh' },
          { id: 'info', label: 'Info' },
          { separator: true },
          { id: 'open-system', label: 'Open in System App' },
          { id: 'show-finder', label: 'Show in Finder' },
          { id: 'copy-path', label: 'Copy Path' },
          { id: 'path-fix', label: 'Automatic Path Fix' },
          { id: 'path-manual', label: 'Manual Path Fix' },
          { id: 'path-web-search', label: 'Web-Search File' },
          { id: 'convert-path', label: isAbsolute ? 'Convert to Relative' : 'Convert to Absolute' },
          { separator: true },
          { id: 'delete', label: 'Delete Embed' },
        ];
    if (!isExternal && !filePath) return;
    if (isExternal && !embedUrl) return;
    showNativeMenu(items, btnRect.right, btnRect.bottom).then(function (action) {
      if (action) handleEmbedAction(action, container);
    });
  }

  function handleEmbedAction(action, container) {
    if (!container) { closeEmbedMenu(); return; }
    if (isIncludeDirectiveContainer(container)) {
      handleIncludeAction(action, container);
      return;
    }
    var filePath = container.getAttribute('data-file-path') || '';
    var embedUrl = container.getAttribute('data-embed-url') || '';
    var boardId = container.getAttribute('data-board-id') || '';
    var isExternal = isExternalEmbedContainer(container);
    var fileRef = parseLocalFileReference(filePath);

    if (action === 'open-url') {
      closeEmbedMenu();
      openUrlInSystem(embedUrl);

    } else if (action === 'copy-url') {
      closeEmbedMenu();
      copyTextToClipboard(embedUrl, 'Embed URL copied to clipboard', 'Failed to copy embed URL');

    } else if (action === 'edit-url') {
      closeEmbedMenu();
      var nextUrl = promptForEmbedTarget(embedUrl, 'Edit embed URL');
      if (!nextUrl || nextUrl === embedUrl) return;
      updateEmbedTarget(container, nextUrl);

    } else if (action === 'refresh') {
      clearCachedFilePreviewState(boardId || '', filePath || '');
      var media = container.querySelector('img, video, audio');
      if (media) {
        var src = media.getAttribute('src').split('?')[0];
        media.setAttribute('src', src + '?t=' + Date.now());
      } else if (container.classList.contains('inline-file-embed-container')) {
        container.removeAttribute('data-inline-enhanced');
        var inlineBody = container.querySelector('.inline-file-embed-body');
        if (inlineBody) inlineBody.innerHTML = '<div class="embed-preview-loading">Loading preview...</div>';
        enhanceSingleInlineFileEmbed(container);
      }
      container.classList.remove('embed-broken');
      container.removeAttribute('data-embed-enhanced');
      var preview = container.querySelector('.embed-preview');
      if (preview) preview.remove();
      enhanceSingleEmbedContainer(container);
      closeEmbedMenu();

    } else if (action === 'info') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      LexeraApi.fileInfo(boardId, fileRef.path).then(function (info) {
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
      }).catch(function (err) {
        logFrontendIssue('warn', 'embed.info', 'Failed to load embed file info for ' + filePath, err);
      });

    } else if (action === 'close-info') {
      closeEmbedMenu();

    } else if (action === 'open-system') {
      closeEmbedMenu();
      if (!filePath) return;
      openBoardFileInSystem(boardId, filePath);

    } else if (action === 'show-finder') {
      closeEmbedMenu();
      if (!filePath) return;
      if (fileRef.path.charAt(0) !== '/' && boardId) {
        resolveBoardPath(boardId, fileRef.path, 'absolute').then(function (absPath) {
          showInFinder(absPath);
        });
      } else {
        showInFinder(fileRef.path);
      }

    } else if (action === 'copy-path') {
      closeEmbedMenu();
      copyTextToClipboard(filePath, 'Embed path copied to clipboard', 'Failed to copy embed path');

    } else if (action === 'path-fix') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      var filename = getDisplayFileNameFromPath(fileRef.path);
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
      }).catch(function (err) {
        logFrontendIssue('warn', 'path.fix', 'Automatic path fix failed for embed ' + filePath, err);
      });

    } else if (action === 'path-manual') {
      closeEmbedMenu();
      if (!filePath) return;
      var nextPath = promptForEmbedTarget(filePath, 'Manual path fix');
      if (!nextPath || nextPath === filePath) return;
      updateEmbedTarget(container, nextPath);

    } else if (action === 'path-web-search') {
      closeEmbedMenu();
      openEmbedWebSearch(container, filePath);

    } else if (action === 'convert-path') {
      closeEmbedMenu();
      if (!boardId || !filePath) return;
      var isAbsolute = isAbsoluteFilePath(fileRef.path);
      resolveBoardPath(boardId, fileRef.path, isAbsolute ? 'relative' : 'absolute').then(function (nextPath) {
        var nextTarget = nextPath ? nextPath + (fileRef.suffix || '') : '';
        if (!nextTarget || nextTarget === filePath) return;
        updateEmbedTarget(container, nextTarget);
      }).catch(function (err) {
        logFrontendIssue('warn', 'path.convert', 'Path conversion failed for embed ' + filePath, err);
      });

    } else if (action === 'delete') {
      closeEmbedMenu();
      deleteEmbedFromSource(container);

    } else if (action && action.indexOf('pick-path:') === 0) {
      var newPath = action.substring(10);
      closeEmbedMenu();
      updateEmbedTarget(container, newPath + (fileRef.suffix || ''));
    }
  }

  window.togglePathMenu = function (container, filePath, mediaType) {
    if (!container) return;
    if (filePath) container.setAttribute('data-file-path', filePath);
    container.setAttribute('data-board-id', getCurrentEditorBoardId() || activeBoardId || '');
    if (mediaType) container.setAttribute('data-media-type', mediaType);
    var button = container.querySelector('.image-menu-btn, .video-menu-btn, .embed-menu-btn');
    showEmbedMenu(container, button || container);
  };

  window.handleMediaNotFound = function (element, originalSrc, mediaType) {
    var host = element && element.closest
      ? element.closest('.image-path-overlay-container, .video-path-overlay-container, .wysiwyg-media, .wysiwyg-media-block')
      : null;
    if (!host) host = element && element.parentElement ? element.parentElement : null;
    if (!host) return;
    var resolvedPath = originalSrc || host.getAttribute('data-file-path') || host.getAttribute('data-src') || '';
    var isVideoLike = mediaType === 'video' || mediaType === 'audio';
    var menuClass = isVideoLike ? 'video-menu-btn' : 'image-menu-btn';
    var icon = isVideoLike ? '&#127909;' : '&#128247;';
    host.classList.add('image-broken');
    host.setAttribute('data-file-path', resolvedPath);
    host.setAttribute('data-board-id', getCurrentEditorBoardId() || activeBoardId || '');
    host.setAttribute('data-media-type', mediaType || 'image');
    host.innerHTML =
      '<span class="image-not-found" data-original-src="' + escapeAttr(resolvedPath) + '" title="' + escapeAttr('Failed to load: ' + resolvedPath) + '">' +
        '<span class="image-not-found-text">' + icon + ' ' + escapeHtml(getDisplayFileNameFromPath(resolvedPath) || resolvedPath || 'Missing media') + '</span>' +
        '<button class="' + menuClass + '" type="button" title="Path options" data-action="toggle-menu">&#9776;</button>' +
      '</span>';
    var btn = host.querySelector('.' + menuClass);
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        window.togglePathMenu(host, resolvedPath, mediaType || 'image');
      });
    }
  };

  window.queueMermaidRender = function (id, code) {
    pendingMermaidRenders.push({ id: id, code: code });
    flushPendingDiagramQueues();
  };

  window.queuePlantUMLRender = function (id, code) {
    pendingPlantUmlRenders.push({ id: id, code: code, boardId: getCurrentEditorBoardId() || activeBoardId || '' });
    flushPendingDiagramQueues();
  };

  window.processDiagramQueue = flushPendingDiagramQueues;
  window.safeDecodePath = safeDecodePath;
  window.resolveRelativePath = resolveRelativePath;
  window.isRelativeResourcePath = isRelativeResourcePath;
  window.isWindowsAbsolutePath = isWindowsAbsolutePath;
  window.normalizeWindowsAbsolutePath = normalizeWindowsAbsolutePath;
  window.buildWebviewResourceUrl = buildWebviewResourceUrl;

  window.queueDiagramRender = function (id, filePath, diagramType, includeDir) {
    var host = document.getElementById(id);
    var boardId = getCurrentEditorBoardId() || activeBoardId || '';
    var resolvedPath = resolveCurrentEditorResourcePath(filePath, includeDir);
    if (!host || !boardId || !resolvedPath) return;
      renderCachedSpecialPreview(host, boardId, resolvedPath, 'diagram')
        .then(function (rendered) {
          if (!rendered && host) {
            host.innerHTML = buildFilePreviewPlaceholderHtml(
              'diagram',
            resolvedPath,
            getSpecialPreviewPlaceholderText('diagram')
            );
          }
        })
      .catch(function (err) {
        logFrontendIssue('warn', 'diagram.preview', 'Failed to render queued diagram preview for ' + resolvedPath, err);
        if (host) {
          host.innerHTML = buildFilePreviewPlaceholderHtml(
            'diagram',
            resolvedPath,
            getSpecialPreviewPlaceholderText('diagram')
          );
        }
      });
  };

  window.queuePDFPageRender = function (id, filePath, pageNumber, includeDir) {
    var host = document.getElementById(id);
    var boardId = getCurrentEditorBoardId() || activeBoardId || '';
    var resolvedPath = resolveCurrentEditorResourcePath(filePath, includeDir);
    if (!host || !boardId || !resolvedPath) return;
    var fileRef = parseLocalFileReference(String(resolvedPath || '') + '#' + String(pageNumber || '1'));
    host.innerHTML = '<iframe class="file-preview-frame" src="' +
      escapeAttr(
        LexeraApi.fileUrl(boardId, fileRef.path) +
        '#toolbar=0&navpanes=0&page=' + String(fileRef.pageNumber || 1)
      ) +
      '" style="width:100%;min-height:320px;border:0;border-radius:6px;"></iframe>';
  };

  window.queuePDFSlideshow = function (id, filePath, includeDir) {
    var host = document.getElementById(id);
    var boardId = getCurrentEditorBoardId() || activeBoardId || '';
    var resolvedPath = resolveCurrentEditorResourcePath(filePath, includeDir);
    if (!host || !boardId || !resolvedPath) return;
    var fileRef = parseLocalFileReference(resolvedPath);
    host.innerHTML = '<iframe class="file-preview-frame" src="' +
      escapeAttr(LexeraApi.fileUrl(boardId, fileRef.path) + '#toolbar=0&navpanes=0') +
      '" style="width:100%;min-height:320px;border:0;border-radius:6px;"></iframe>';
  };

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
    var hasNewCards = false;
    var undoPushed = false;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      try {
        var result = await LexeraApi.uploadMedia(activeBoardId, file);
        if (result && result.filename) {
          var embedSyntax = '![' + file.name + '](' + result.filename + ')';
          var col = getFullColumn(colIndex);
          if (col) {
            if (!undoPushed) {
              pushUndo();
              undoPushed = true;
            }
            col.cards.push({ id: 'card-' + Date.now() + '-' + i, content: embedSyntax, checked: false, kid: null });
            hasNewCards = true;
          }
        }
      } catch (err) {
        lexeraLog('error', '[fileUpload] File upload failed: ' + err);
      }
    }
    if (hasNewCards) {
      await persistBoardMutation();
    }
  }

  function openInSystem(path) {
    lexeraLog('info', 'Opening in system: ' + path);
    if (hasTauri) {
      tauriInvoke('open_in_system', { path: path }).then(function () {
        lexeraLog('info', 'Opened: ' + path);
      }).catch(function (e) {
        lexeraLog('error', 'open_in_system failed: ' + e);
        showNotification('Failed to open file');
      });
    } else {
      window.open('file://' + path, '_blank');
    }
  }

  function openUrlInSystem(url) {
    if (!url) return;
    if (hasTauri) {
      tauriInvoke('open_url', { url: url }).catch(function (err) {
        logFrontendIssue('warn', 'open.url', 'Tauri URL open failed, falling back to browser open for ' + url, err);
        window.open(url, '_blank', 'noopener,noreferrer');
      });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function showInFinder(path) {
    if (hasTauri) {
      tauriInvoke('show_in_folder', { path: path }).then(function (result) {
        lexeraLog('info', 'Revealed in Finder: ' + result);
      }).catch(function (e) {
        lexeraLog('error', 'Show in Finder failed: ' + e);
        showNotification('Failed to reveal in folder');
      });
    }
  }

  function copyTextToClipboard(text, successMessage, failureMessage) {
    if (!text || !navigator.clipboard || !navigator.clipboard.writeText) {
      if (failureMessage) showNotification(failureMessage);
      return Promise.resolve(false);
    }
    return navigator.clipboard.writeText(text).then(function () {
      if (successMessage) showNotification(successMessage);
      return true;
    }).catch(function (err) {
      logFrontendIssue('warn', 'clipboard.copy', 'Clipboard write failed', err);
      if (failureMessage) showNotification(failureMessage);
      return false;
    });
  }

  function copyElementAsMarkdown(elementType, indices) {
    if (!fullBoardData || !activeBoardId) return;
    var md = '';
    if (elementType === 'card') {
      var col = getFullColumn(indices.colIndex);
      if (!col) return;
      var fullIdx = getFullCardIndex(col, indices.cardIndex);
      if (fullIdx === -1) return;
      md = col.cards[fullIdx].content || '';
    } else if (elementType === 'column') {
      var col = getFullColumn(indices.colIndex);
      if (!col) return;
      md = '## ' + (col.title || '') + '\n\n';
      for (var k = 0; k < col.cards.length; k++) {
        md += (col.cards[k].content || '') + '\n\n';
      }
    } else if (elementType === 'row') {
      var row = findFullDataRow(indices.rowIdx);
      if (!row) return;
      md = '# ' + (row.title || '') + '\n\n';
      for (var s = 0; s < row.stacks.length; s++) {
        for (var c = 0; c < row.stacks[s].columns.length; c++) {
          var rcol = row.stacks[s].columns[c];
          md += '## ' + (rcol.title || '') + '\n\n';
          for (var k = 0; k < rcol.cards.length; k++) {
            md += (rcol.cards[k].content || '') + '\n\n';
          }
        }
      }
    } else if (elementType === 'stack') {
      var stack = findFullDataStack(indices.rowIdx, indices.stackIdx);
      if (!stack) return;
      md = '# ' + (stack.title || '') + '\n\n';
      for (var c = 0; c < stack.columns.length; c++) {
        var scol = stack.columns[c];
        md += '## ' + (scol.title || '') + '\n\n';
        for (var k = 0; k < scol.cards.length; k++) {
          md += (scol.cards[k].content || '') + '\n\n';
        }
      }
    }
    md = md.trim();
    if (md) copyTextToClipboard(md, 'Copied as markdown', 'Copy failed');
  }

  async function exportColumn(colIndex) {
    if (!window.ExportUI) return;
    if (!window._exportUI) window._exportUI = new ExportUI();
    await window._exportUI.init(activeBoardId, fullBoardData);
    window._exportUI.show();
  }

  function isExternalEmbedContainer(container) {
    if (!container) return false;
    var embedUrl = container.getAttribute('data-embed-url') || '';
    return !!embedUrl || container.classList.contains('external-embed-container');
  }

  function getEmbedActionTarget(container) {
    if (!container) return '';
    if (isExternalEmbedContainer(container)) {
      return container.getAttribute('data-embed-url') || '';
    }
    return container.getAttribute('data-file-path') || '';
  }

  function getEmbedSearchQuery(container, fallbackPath) {
    if (!container) return getDisplayNameFromPath(fallbackPath || '') || String(fallbackPath || '');
    var label = container.getAttribute('data-alt-text') ||
      container.getAttribute('data-embed-caption') ||
      '';
    label = decodeHtmlEntities(String(label || '').trim());
    return label || getDisplayNameFromPath(fallbackPath || '') || getDisplayFileNameFromPath(fallbackPath || '') || String(fallbackPath || '');
  }

  function mutateBoardTitleSource(node, titleMutator) {
    if (!node || typeof titleMutator !== 'function') return Promise.resolve(false);
    var columnEl = node.closest('.column[data-row-index][data-stack-index][data-col-local-index]');
    if (!columnEl) return Promise.resolve(false);
    var rowIndex = parseInt(columnEl.getAttribute('data-row-index') || '', 10);
    var stackIndex = parseInt(columnEl.getAttribute('data-stack-index') || '', 10);
    var colIndex = parseInt(columnEl.getAttribute('data-col-local-index') || '', 10);
    if (!isFinite(rowIndex) || !isFinite(stackIndex) || !isFinite(colIndex)) return Promise.resolve(false);
    var column = getColumnByLocation(rowIndex, stackIndex, colIndex);
    if (!column) return Promise.resolve(false);
    var nextTitle = titleMutator(column.title || '');
    if (typeof nextTitle !== 'string' || nextTitle === column.title) return Promise.resolve(false);
    pushUndo();
    column.title = normalizeCardContentAfterInlineMutation(nextTitle);
    return persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  function updateBoardFileLinkTarget(container, nextTarget) {
    if (!container) return Promise.resolve(false);
    var linkIndex = parseInt(container.getAttribute('data-link-index'), 10);
    var nextValue = String(nextTarget || '').trim();
    if (!nextValue) return Promise.resolve(false);
    var linkMutator = function (content) {
      return replaceNthMarkdownLink(content, isFinite(linkIndex) ? linkIndex : 0, function (link) {
        return '[' + link.label + '](' + nextValue + (link.title ? ' ' + link.title : '') + ')';
      });
    };
    return Promise.resolve(mutateEmbedSource(container, linkMutator)).then(function (changed) {
      if (changed) return true;
      return mutateBoardTitleSource(container, linkMutator);
    });
  }

  function updateEmbedTarget(container, nextTarget) {
    if (!container) return Promise.resolve(false);
    var embedIndex = parseInt(container.getAttribute('data-embed-index'), 10);
    var nextValue = String(nextTarget || '').trim();
    if (!nextValue) return Promise.resolve(false);
    return mutateEmbedSource(container, function (content) {
      if (!isFinite(embedIndex)) {
        return replaceCurrentEmbedOccurrence(content, container, function (embed) {
          return buildMarkdownEmbed(embed.alt, nextValue, embed.title, embed.rawAttrs);
        });
      }
      return replaceNthMarkdownEmbed(content, isFinite(embedIndex) ? embedIndex : 0, function (embed) {
        return buildMarkdownEmbed(embed.alt, nextValue, embed.title, embed.rawAttrs);
      });
    });
  }

  function deleteEmbedFromSource(container) {
    if (!container) return Promise.resolve(false);
    var embedIndex = parseInt(container.getAttribute('data-embed-index'), 10);
    return mutateEmbedSource(container, function (content) {
      if (!isFinite(embedIndex)) {
        return replaceCurrentEmbedOccurrence(content, container, function () {
          return '';
        });
      }
      return replaceNthMarkdownEmbed(content, isFinite(embedIndex) ? embedIndex : 0, function () {
        return '';
      });
    });
  }

  function promptForEmbedTarget(initialValue, titleText) {
    var currentValue = String(initialValue || '').trim();
    if (!currentValue) return '';
    var nextValue = window.prompt(titleText || 'Update embed target', currentValue);
    if (nextValue == null) return '';
    return String(nextValue).trim();
  }

  function openEmbedWebSearch(container, filePath) {
    var query = getEmbedSearchQuery(container, filePath);
    if (!query) return;
    var mediaType = container ? (container.getAttribute('data-media-type') || '') : '';
    var searchUrl = mediaType === 'image'
      ? 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(query)
      : 'https://www.google.com/search?q=' + encodeURIComponent(query);
    openUrlInSystem(searchUrl);
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
      document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'txt', 'md', 'csv', 'json', 'epub'],
    };
    for (var cat in cats) {
      if (cats[cat].indexOf(ext) !== -1) return cat;
    }
    return 'unknown';
  }

  function getFileExtension(path) {
    var value = normalizeFilePathForDetection(path);
    if (!value) return '';
    var fileName = getFileNameFromPath(value);
    var dot = fileName.lastIndexOf('.');
    if (dot <= 0 || dot === fileName.length - 1) return '';
    return fileName.substring(dot + 1).toLowerCase();
  }

  var INLINE_FILE_EMBED_EXTENSIONS = {
    md: true,
    markdown: true,
    txt: true,
    log: true,
    csv: true,
    tsv: true,
    json: true,
    yaml: true,
    yml: true,
    toml: true,
    ini: true,
    cfg: true,
    conf: true,
    xml: true,
    html: true,
    htm: true
  };

  function getInlineFileEmbedExtension(path) {
    var ext = getFileExtension(path);
    return INLINE_FILE_EMBED_EXTENSIONS[ext] ? ext : '';
  }

  // --- Card Collapse ---

  function collectBoardCardIds(rows) {
    var ids = [];
    if (!Array.isArray(rows)) return ids;
    for (var r = 0; r < rows.length; r++) {
      var stacks = Array.isArray(rows[r].stacks) ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        var cols = Array.isArray(stacks[s].columns) ? stacks[s].columns : [];
        for (var c = 0; c < cols.length; c++) {
          var cards = Array.isArray(cols[c].cards) ? cols[c].cards : [];
          for (var i = 0; i < cards.length; i++) {
            ids.push(String(cards[i].id));
          }
        }
      }
    }
    return ids;
  }

  function getCollapsedCards(boardId, rows) {
    var collapsedKey = 'lexera-card-collapsed:' + boardId;
    var legacyExpandedKey = 'lexera-card-expanded:' + boardId;
    var saved = localStorage.getItem(collapsedKey);
    if (saved) {
      try {
        var parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(function (id) { return String(id); });
      } catch (e) {
        logFrontendIssue('warn', 'cards.collapse', 'Failed to parse collapsed card state for board ' + boardId, e);
      }
    }

    // Legacy migration: old state stored expanded IDs. Convert to collapsed IDs.
    var legacy = localStorage.getItem(legacyExpandedKey);
    if (legacy) {
      try {
        var expanded = JSON.parse(legacy);
        if (Array.isArray(expanded)) {
          var expandedSet = {};
          for (var i = 0; i < expanded.length; i++) {
            expandedSet[String(expanded[i])] = true;
          }
          var allIds = collectBoardCardIds(rows);
          var migratedCollapsed = [];
          for (var j = 0; j < allIds.length; j++) {
            if (!expandedSet[allIds[j]]) migratedCollapsed.push(allIds[j]);
          }
          localStorage.setItem(collapsedKey, JSON.stringify(migratedCollapsed));
          localStorage.removeItem(legacyExpandedKey);
          return migratedCollapsed;
        }
      } catch (e) {
        logFrontendIssue('warn', 'cards.collapse', 'Failed to migrate legacy expanded card state for board ' + boardId, e);
      }
      localStorage.removeItem(legacyExpandedKey);
    }

    // Default behavior: cards are open unless explicitly collapsed.
    return [];
  }

  function saveCardCollapseState(boardId) {
    var collapsed = [];
    var cards = getElColumnsContainer().querySelectorAll('.card[data-card-id]');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].classList.contains('collapsed')) {
        collapsed.push(cards[i].getAttribute('data-card-id'));
      }
    }
    localStorage.setItem('lexera-card-collapsed:' + boardId, JSON.stringify(collapsed));
    // Remove legacy key so new default-open semantics apply consistently.
    localStorage.removeItem('lexera-card-expanded:' + boardId);
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

  var TAG_CATEGORIES = {
    special:    ['header', 'footer', 'hide', 'exclude'],
    status:     ['todo', 'inprogress', 'done', 'transferred', 'blocked', 'review', 'testing', 'wip'],
    positivity: ['++', '+', '\u00f8', '-', '--'],
    colors:     ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'brown', 'gray', 'teal', 'indigo'],
    impact:     ['minor', 'moderate', 'major', 'breaking'],
    workflow:   ['ideas', 'outline', 'draft', 'reviewing', 'polish', 'ready', 'published'],
    complexity: ['trivial', 'beginner', 'intermediate', 'advanced-level', 'expert']
  };

  var EMOJI_SHORTCODES = {
    smile: '\u{1F604}',
    grin: '\u{1F601}',
    joy: '\u{1F602}',
    wink: '\u{1F609}',
    blush: '\u{1F60A}',
    thinking: '\u{1F914}',
    sunglasses: '\u{1F60E}',
    cry: '\u{1F622}',
    heart: '\u{2764}\u{FE0F}',
    broken_heart: '\u{1F494}',
    thumbs_up: '\u{1F44D}',
    thumbs_down: '\u{1F44E}',
    clap: '\u{1F44F}',
    tada: '\u{1F389}',
    fire: '\u{1F525}',
    rocket: '\u{1F680}',
    sparkles: '\u{2728}',
    star: '\u{2B50}',
    warning: '\u{26A0}\u{FE0F}',
    bulb: '\u{1F4A1}',
    bug: '\u{1F41B}',
    eyes: '\u{1F440}',
    pushpin: '\u{1F4CC}',
    memo: '\u{1F4DD}',
    calendar: '\u{1F4C5}',
    question: '\u{2753}',
    x: '\u{274C}',
    white_check_mark: '\u{2705}',
    heavy_check_mark: '\u{2714}\u{FE0F}',
    hourglass: '\u{23F3}'
  };

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

  function renderEmojiShortcodes(text) {
    return String(text || '').replace(/(^|[^\w&]):([a-z][a-z0-9_+-]*):(?=$|[^\w;])/gi, function (_, prefix, code) {
      var emoji = EMOJI_SHORTCODES[String(code || '').toLowerCase()];
      if (!emoji) return _;
      return prefix + '<span class="emoji-shortcode" aria-label="' + escapeAttr(code) + '">' + emoji + '</span>';
    });
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

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function extractAllTags(text) {
    var tags = [];
    var lines = (text || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') break;
      var matches = lines[i].match(/(^|\s)(#[^\s]+)/g);
      if (matches) {
        for (var j = 0; j < matches.length; j++) {
          var tag = matches[j].trim();
          if (tags.indexOf(tag) === -1) tags.push(tag);
        }
      }
    }
    return tags;
  }

  function hasTag(text, tagName) {
    var lines = (text || '').split('\n');
    var re = new RegExp('(^|\\s)' + escapeRegex(tagName) + '(?=\\s|$)');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') break;
      if (re.test(lines[i])) return true;
    }
    return false;
  }

  function getCardTitle(content) {
    var lines = content.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var trimmed = stripInternalHiddenTags(lines[i].replace(/<!--[\s\S]*?-->/g, '')).trim();
      if (trimmed === '') break;
      if (/^!\[/.test(trimmed)) continue; // skip image-only lines
      var headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
      if (headingMatch) return headingMatch[1].trim();
      return trimmed;
    }
    for (var i = 0; i < lines.length; i++) {
      var fallback = stripInternalHiddenTags(lines[i].replace(/<!--[\s\S]*?-->/g, '')).trim();
      if (fallback !== '') return fallback;
    }
    return '';
  }

  function renderTitleInline(text, boardId) {
    boardId = boardId || activeBoardId || '';
    var safe = escapeHtml(text);
    var titleIncludeIndex = 0;
    var titleLinkIndex = 0;
    // Strip image/embed markdown
    safe = safe.replace(/!\[[^\]]*\]\([^)]+\)(\{[^}]+\})?/g, '');
    // Include directives: !!!include(path)!!!
    safe = safe.replace(/!!!include\(([^)]+)\)!!!/g, function (_, rawPath) {
      return renderIncludeDirectiveHtml(rawPath, boardId, 'include-filename-link', {
        includeIndex: titleIncludeIndex++,
        allowActions: false
      });
    });
    // Links: [text](url)
    safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, rawHref) {
      var parsed = parseMarkdownTarget(rawHref);
      var href = parsed.path;
      var titleText = parsed.title ? parsed.title.replace(/^(&quot;|")|(&quot;|")$/g, '') : '';
      var titleAttr = titleText ? ' title="' + escapeAttr(titleText) + '"' : '';
      var isExternal = /^https?:\/\//.test(href);
      var isAnchor = href.indexOf('#') === 0;
      var isMailto = href.indexOf('mailto:') === 0;
      if (!isExternal && !isAnchor && !isMailto && href) {
        return renderBoardFileLinkHtml(href, boardId, label, titleText, '', {
          withMenu: true,
          linkIndex: titleLinkIndex++
        });
      }
      var safeHref = escapeAttr(href);
      var targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
      return '<a href="' + safeHref + '"' + titleAttr + targetAttr + '>' + label + '</a>';
    });
    // Wiki links: [[document]] or [[document|title]]
    safe = safe.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, function (_, rawDocument, rawTitle) {
      var documentName = decodeHtmlEntities(rawDocument).trim();
      var label = rawTitle ? rawTitle.trim() : rawDocument.trim();
      return renderWikiLinkHtml(documentName, label, { withMenu: false });
    });
    // Tags with colored badges
    safe = safe.replace(/(^|\s)(#[a-zA-Z][\w-]*)/g, function(_, pre, tag) {
      var color = getTagColor(tag);
      return pre + '<span class="tag" data-tag="' + escapeAttr(tag) + '" style="background:' + color + ';color:#fff">' + tag + '</span>';
    });
    // Temporal tags
    safe = safe.replace(/(^|\s)([!@](?:today|tomorrow|yesterday|date\([^)]+\)|days[+-]\d+|\d{4}[-.]?(?:w|kw)\d{1,2}|(?:w|kw)\d{1,2}|mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday|:\d{1,2}-:\d{1,2}|\d{1,2}(?::\d{2})?(?:am|pm)?-\d{1,2}(?::\d{2})?(?:am|pm)?|\d{1,4}[./-]\d{1,2}(?:[./-]\d{2,4})?|\d{1,2}(?::\d{2})?(?:am|pm)?))/gi, function (_, pre, tag) {
      return pre + renderTemporalTagHtml(tag);
    });
    // Bold
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Strikethrough
    safe = safe.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    // Mark
    safe = safe.replace(/==([^=]+)==/g, '<mark>$1</mark>');
    // Inserted text
    safe = safe.replace(/\+\+([^+]+)\+\+/g, '<ins>$1</ins>');
    // Underline
    safe = safe.replace(/(^|[^\w])_([^_\n]+)_/g, function (_, pre, value) {
      return pre + '<u>' + value + '</u>';
    });
    // Subscript
    safe = safe.replace(/(^|[^~])~([^~]+)~(?=[^~]|$)/g, function (_, pre, value) {
      return pre + '<sub>' + value + '</sub>';
    });
    // Superscript
    safe = safe.replace(/(^|[^^])\^([^^]+)\^(?=[^^]|$)/g, function (_, pre, value) {
      return pre + '<sup>' + value + '</sup>';
    });
    // Inline code
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
    safe = renderEmojiShortcodes(safe);
    return safe;
  }

  // --- Util ---

  function renderTable(lines, startIdx, boardId, renderState) {
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
      out += '<th style="text-align:' + aligns[h] + '">' + renderInline(headers[h], boardId, renderState) + '</th>';
    }
    out += '</tr></thead><tbody>';

    for (var r = startIdx + 2; r < lines.length; r++) {
      if (lines[r].trim().indexOf('|') !== 0) break;
      var cells = parseCells(lines[r]);
      out += '<tr>';
      for (var c = 0; c < headers.length; c++) {
        var val = c < cells.length ? cells[c] : '';
        var align = c < aligns.length ? aligns[c] : 'left';
        out += '<td style="text-align:' + align + '">' + renderInline(val, boardId, renderState) + '</td>';
      }
      out += '</tr>';
    }
    out += '</tbody></table>';
    return out;
  }

  function flushPendingDiagramQueues() {
    if (pendingMermaidRenders.length > 0) {
      if (mermaidReady) processMermaidQueue();
      else loadMermaidLibrary();
    }
    if (pendingPlantUmlRenders.length > 0) {
      processPlantUmlQueue();
    }
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

  async function processPlantUmlQueue() {
    if (plantumlQueueProcessing || pendingPlantUmlRenders.length === 0) return;
    plantumlQueueProcessing = true;
    var queue = pendingPlantUmlRenders.slice();
    pendingPlantUmlRenders = [];

    for (var i = 0; i < queue.length; i++) {
      var item = queue[i];
      var el = document.getElementById(item.id);
      if (!el) continue;
      try {
        var asset = await resolveCachedPlantUmlAsset(item.boardId, item.code);
        if (!asset) {
          el.classList.add('plantuml-missing');
          continue;
        }
        var response = await fetch(asset.url);
        if (!response.ok) throw new Error('Failed to load PlantUML cache');
        el.className = 'plantuml-diagram';
        el.innerHTML = await response.text();
        el.style.margin = '8px 0';
        el.style.overflow = 'auto';
        var svg = el.querySelector('svg');
        if (svg) {
          svg.style.display = 'block';
          svg.style.maxWidth = '100%';
          svg.style.height = 'auto';
        }
      } catch (err) {
        el.classList.add('plantuml-missing');
      }
    }

    plantumlQueueProcessing = false;
    if (pendingPlantUmlRenders.length > 0) {
      processPlantUmlQueue();
    }
  }

  function escapeRegex(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyAbbreviationsToHtml(html, abbrDefs) {
    var keys = Object.keys(abbrDefs || {});
    if (!html || keys.length === 0) return html;
    keys.sort(function (a, b) { return b.length - a.length; });
    var parts = String(html).split(/(<[^>]+>)/g);
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i] || parts[i].charAt(0) === '<') continue;
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var pattern = new RegExp('(^|[^\\w])(' + escapeRegex(key) + ')(?=[^\\w]|$)', 'g');
        parts[i] = parts[i].replace(pattern, function (_, pre, match) {
          return pre + '<abbr title="' + escapeAttr(abbrDefs[key]) + '">' + match + '</abbr>';
        });
      }
    }
    return parts.join('');
  }

  function renderCardContent(content, boardId, renderState, options) {
    renderState = renderState || {};
    options = options || {};
    var previousNestedDepth = typeof renderState.nestedDepth === 'number' ? renderState.nestedDepth : 0;
    renderState.nestedDepth = options.nested ? previousNestedDepth + 1 : previousNestedDepth;
    try {
    var lines = content.split('\n');
    var html = '';
    var listTag = null; // 'ul' or 'ol'
    var skipLines = {};
    var footnoteDefs = renderState.footnoteDefs || (renderState.footnoteDefs = {});
    var footnoteOrder = renderState.footnoteOrder || (renderState.footnoteOrder = []);
    var abbrDefs = renderState.abbrDefs || (renderState.abbrDefs = {});

    for (var scanIdx = 0; scanIdx < lines.length; scanIdx++) {
      var footnoteMatch = lines[scanIdx].match(/^\[\^([^\]]+)\]:\s*(.*)$/);
      if (footnoteMatch) {
        var footnoteId = footnoteMatch[1];
        var textParts = [];
        if (footnoteMatch[2]) textParts.push(footnoteMatch[2]);
        skipLines[scanIdx] = true;
        var continuationIdx = scanIdx + 1;
        while (continuationIdx < lines.length) {
          var continuation = lines[continuationIdx];
          if (/^( {2,}|\t)/.test(continuation)) {
            textParts.push(continuation.replace(/^( {2,}|\t)/, ''));
            skipLines[continuationIdx] = true;
            continuationIdx++;
            continue;
          }
          if (continuation.trim() === '') {
            skipLines[continuationIdx] = true;
            continuationIdx++;
            break;
          }
          break;
        }
        footnoteDefs[footnoteId] = textParts.join(' ').trim();
        if (footnoteOrder.indexOf(footnoteId) === -1) footnoteOrder.push(footnoteId);
        scanIdx = continuationIdx - 1;
        continue;
      }
      var abbrMatch = lines[scanIdx].match(/^\*\[([^\]]+)\]:\s*(.+)$/);
      if (abbrMatch) {
        abbrDefs[abbrMatch[1]] = abbrMatch[2].trim();
        skipLines[scanIdx] = true;
      }
    }

    function closeList() {
      if (listTag) { html += '</' + listTag + '>'; listTag = null; }
    }
    function openList(tag) {
      if (listTag !== tag) { closeList(); html += '<' + tag + '>'; listTag = tag; }
    }

    for (var i = 0; i < lines.length; i++) {
      if (skipLines[i]) continue;
      var line = lines[i];

      var multiStartMatch = line.match(/^---:\s*(\d+)?\s*$/);
      if (multiStartMatch) {
        closeList();
        var multiColumns = [];
        var multiGrowths = [];
        var currentColumnLines = [];
        var currentGrowth = parseInt(multiStartMatch[1], 10) || 1;
        var nextIdx = i + 1;
        for (; nextIdx < lines.length; nextIdx++) {
          var multiLine = lines[nextIdx];
          var multiSplitMatch = multiLine.match(/^:--:\s*(\d+)?\s*$/);
          if (multiSplitMatch) {
            multiColumns.push(currentColumnLines.join('\n'));
            multiGrowths.push(currentGrowth);
            currentColumnLines = [];
            currentGrowth = parseInt(multiSplitMatch[1], 10) || 1;
            continue;
          }
          if (/^:---\s*$/.test(multiLine)) {
            multiColumns.push(currentColumnLines.join('\n'));
            multiGrowths.push(currentGrowth);
            break;
          }
          currentColumnLines.push(multiLine);
        }
        if (multiColumns.length > 0) {
          html += '<div class="md-multicolumn">';
          for (var mc = 0; mc < multiColumns.length; mc++) {
            html += '<div class="md-multicolumn-column" style="flex-grow:' + multiGrowths[mc] + ';flex-basis:0">' +
              renderCardContent(multiColumns[mc], boardId, renderState, { nested: true }) +
              '</div>';
          }
          html += '</div>';
          i = nextIdx;
          continue;
        }
      }

      var containerMatch = line.match(/^:::\s*([a-z0-9-]+)\s*$/i);
      if (containerMatch) {
        closeList();
        var containerType = containerMatch[1].toLowerCase();
        var containerLines = [];
        i++;
        while (i < lines.length && !/^:::\s*$/.test(lines[i].trim())) {
          containerLines.push(lines[i]);
          i++;
        }
        html += '<div class="md-container md-container-' + escapeAttr(containerType) + '">' +
          renderCardContent(containerLines.join('\n'), boardId, renderState, { nested: true }) +
          '</div>';
        continue;
      }

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
          html += '<div class="diagram-overlay-container" data-diagram-type="mermaid" data-diagram-code="' + escapeAttr(code) + '" style="position:relative;display:block">' +
            '<button class="embed-menu-btn diagram-menu-btn" title="Diagram actions" style="opacity:1">&#8942;</button>' +
            '<div class="mermaid-placeholder" id="' + mermaidId + '">Loading diagram...</div>' +
            '</div>';
          pendingMermaidRenders.push({ id: mermaidId, code: code });
        } else if (lang.toLowerCase() === 'plantuml' || lang.toLowerCase() === 'puml') {
          var plantumlId = 'plantuml-' + (++plantumlIdCounter);
          var plantumlCode = codeLines.join('\n');
          html += '<div class="diagram-overlay-container" data-diagram-type="plantuml" data-diagram-code="' + escapeAttr(plantumlCode) + '" style="position:relative;display:block">' +
            '<button class="embed-menu-btn diagram-menu-btn" title="Diagram actions" style="opacity:1">&#8942;</button>' +
            '<div class="plantuml-placeholder" id="' + plantumlId + '"><div class="plantuml-title">PlantUML</div><pre class="code-block"><code class="language-plantuml">' + escapeHtml(plantumlCode) + '</code></pre></div>' +
            '</div>';
          pendingPlantUmlRenders.push({ id: plantumlId, code: plantumlCode, boardId: boardId || activeBoardId || '' });
        } else {
          var langClass = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
          html += '<pre class="code-block"><code' + langClass + '>' + escapeHtml(codeLines.join('\n')) + '</code></pre>';
        }
        continue;
      }

      // Markdown tables: |col|col| with |---|---| separator
      if (line.trim().indexOf('|') === 0 && i + 1 < lines.length && /^\|[\s:]*-+/.test(lines[i + 1].trim())) {
        closeList();
        html += renderTable(lines, i, boardId, renderState);
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
        html += '<blockquote>' + renderInline(quoteMatch[1], boardId, renderState) + '</blockquote>';
        continue;
      }

      // Speaker notes
      var speakerNoteMatch = line.match(/^;;\s?(.*)/);
      if (speakerNoteMatch) {
        closeList();
        html += '<div class="speaker-note">' + renderInline(speakerNoteMatch[1], boardId, renderState) + '</div>';
        continue;
      }

      // Headings
      var headingMatch = line.match(/^(#{1,3})\s+(.+)/);
      if (headingMatch) {
        closeList();
        var level = headingMatch[1].length;
        html += '<h' + level + '>' + renderInline(headingMatch[2], boardId, renderState) + '</h' + level + '>';
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
        html += '<li class="checkbox-item"><input type="checkbox" class="card-checkbox" data-line="' + i + '"' + checkedAttr + '> ' + strikePre + renderInline(checkMatch[2], boardId, renderState) + strikePost + '</li>';
        continue;
      }

      // Ordered list items
      var olMatch = line.match(/^\d+\.\s+(.+)/);
      if (olMatch) {
        openList('ol');
        html += '<li>' + renderInline(olMatch[1], boardId, renderState) + '</li>';
        continue;
      }

      // Unordered list items
      var listMatch = line.match(/^[-*]\s+(.+)/);
      if (listMatch) {
        openList('ul');
        html += '<li>' + renderInline(listMatch[1], boardId, renderState) + '</li>';
        continue;
      }

      // Regular line
      closeList();
      html += '<div>' + renderInline(line, boardId, renderState) + '</div>';
    }

    closeList();
    if (!options.nested && footnoteOrder.length > 0) {
      html += '<div class="footnotes"><hr><ol>';
      for (var fn = 0; fn < footnoteOrder.length; fn++) {
        var footnoteId = footnoteOrder[fn];
        var footnoteText = footnoteDefs[footnoteId] || '';
        html += '<li id="footnote-' + escapeAttr(footnoteId) + '">' + renderInline(footnoteText, boardId, renderState) + '</li>';
      }
      html += '</ol></div>';
    }
    return html;
    } finally {
      renderState.nestedDepth = previousNestedDepth;
    }
  }

  function renderInline(text, boardId, renderState) {
    renderState = renderState || {};
    if (typeof renderState.embedCounter !== 'number') renderState.embedCounter = 0;
    if (typeof renderState.includeCounter !== 'number') renderState.includeCounter = 0;
    var source = text || '';
    var htmlTokens = [];
    if (getHtmlContentRenderMode() === 'html') {
      source = source.replace(/<[^>]+>/g, function (match) {
        var token = '@@HTMLTOKEN' + htmlTokens.length + '@@';
        htmlTokens.push(match);
        return token;
      });
    }
    var safe = escapeHtml(source);

    // Embeds: ![alt](path "optional title"){height=...}
    safe = safe.replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?/g, function (_, alt, rawSrc, rawAttrs) {
      var parsedTarget = parseMarkdownTarget(rawSrc);
      var filePath = parsedTarget.path;
      var fileRef = parseLocalFileReference(filePath);
      var titleText = decodeHtmlEntities(normalizeMarkdownAttrValue(parsedTarget.title));
      var imageAttrs = parseMarkdownImageAttributes(rawAttrs);
      var ext = getFileExtension(fileRef.path);
      var isExternalHttp = isExternalHttpUrl(filePath);
      var isExternal = isExternalHttp || filePath.indexOf('data:') === 0;
      var inlineFileExtension = !isExternal ? getInlineFileEmbedExtension(fileRef.path) : '';
      var category = getMediaCategory(ext);

      if (isExternalHttp && shouldRenderExternalEmbed(filePath, imageAttrs)) {
        var embedWidth = sanitizeCssLength(imageAttrs.values.width) || '100%';
        var embedHeight = sanitizeCssLength(imageAttrs.values.height) || '500px';
        var externalCaptionHtml = titleText ? '<figcaption class="media-caption external-embed-caption">' + renderInline(titleText, boardId, renderState) + '</figcaption>' : '';
        var externalEmbedHtml = '<span class="external-embed-container" data-embed-url="' + escapeAttr(filePath) + '"' +
          ' data-embed-index="' + escapeAttr(String(renderState.embedCounter++)) + '"' +
          ' data-alt-text="' + escapeAttr(decodeHtmlEntities(alt || titleText || '')) + '"' +
          ' data-embed-caption="' + escapeAttr(titleText || '') + '"' +
          ' style="' + escapeAttr('position:relative;display:block;max-width:100%') + '">' +
          '<iframe class="external-embed-frame" src="' + escapeAttr(filePath) + '" title="' + escapeAttr(decodeHtmlEntities(alt || titleText || filePath)) + '" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen frameborder="0" style="' + escapeAttr('width:' + embedWidth + ';height:' + embedHeight) + '"></iframe>' +
          '<button class="embed-menu-btn" title="Embed actions" style="opacity:1">&#8942;</button>' +
          '</span>';
        if (externalCaptionHtml) {
          return '<figure class="media-figure">' + externalEmbedHtml + externalCaptionHtml + '</figure>';
        }
        return externalEmbedHtml;
      }

      if (inlineFileExtension && boardId) {
        return renderInlineFileEmbedHtml(
          filePath,
          boardId,
          alt || '',
          titleText || '',
          inlineFileExtension,
          renderState.embedCounter++
        );
      }

      var src = filePath;
      if (!isExternal && boardId) {
        src = LexeraApi.fileUrl(boardId, fileRef.path);
      }

      var mediaStyleAttr = getMarkdownMediaStyleAttr(imageAttrs, { allowHeightOnImages: true });
      var previewKind = getEmbedPreviewKind(filePath);
      var inner = '';
      if (category === 'image') {
        var imageTitleAttr = titleText ? ' title="' + escapeAttr(titleText) + '"' : '';
        inner = '<img src="' + src + '" alt="' + alt + '"' + imageTitleAttr + ' loading="lazy"' + mediaStyleAttr + ' onerror="this.parentElement.classList.add(\'embed-broken\')">';
      } else if (category === 'video') {
        inner = '<video controls preload="metadata" src="' + src + '"' + mediaStyleAttr + ' onerror="this.parentElement.classList.add(\'embed-broken\')"></video>';
      } else if (category === 'audio') {
        inner = '<audio controls preload="metadata" src="' + src + '"' + mediaStyleAttr + ' onerror="this.parentElement.classList.add(\'embed-broken\')"></audio>';
      } else if (previewKind === 'diagram' || previewKind === 'spreadsheet' || previewKind === 'epub' || previewKind === 'document') {
        inner = getFileEmbedChipHtml(previewKind, filePath, mediaStyleAttr);
      } else if (category === 'document') {
        var documentFilename = getDisplayFileNameFromPath(filePath);
        inner = '<span class="embed-file-link"' + mediaStyleAttr + '>&#128196; ' + escapeHtml(documentFilename) + '</span>';
      } else {
        var filename = getDisplayFileNameFromPath(filePath);
        inner = '<span class="embed-file-link"' + mediaStyleAttr + '>&#128206; ' + escapeHtml(filename) + '</span>';
      }

      var embedIndex = renderState.embedCounter++;
      var previewPageValue = imageAttrs.values.page || imageAttrs.values.sheet || '';
      var previewPageAttr = /^\d+$/.test(String(previewPageValue || ''))
        ? ' data-preview-page="' + escapeAttr(String(Math.max(1, parseInt(previewPageValue, 10)))) + '"'
        : '';
      var embedHtml = '<span class="embed-container" data-file-path="' + escapeHtml(filePath) + '" data-board-id="' + (boardId || '') + '" data-media-type="' + category + '" data-embed-index="' + escapeAttr(String(embedIndex)) + '"' +
        ' data-alt-text="' + escapeAttr(decodeHtmlEntities(alt || '')) + '"' +
        ' data-embed-caption="' + escapeAttr(titleText || '') + '"' +
        previewPageAttr + '>' +
        inner +
        '<button class="embed-menu-btn" title="Embed actions">&#8942;</button>' +
        '</span>';
      if (titleText) {
        return '<figure class="media-figure">' +
          embedHtml +
          '<figcaption class="media-caption">' + renderInline(titleText, boardId, renderState) + '</figcaption>' +
          '</figure>';
      }
      return embedHtml;
    });

    // Include directives: !!!include(path)!!!
    safe = safe.replace(/!!!include\(([^)]+)\)!!!/g, function (_, rawPath) {
      var includeIndex = renderState.includeCounter || 0;
      renderState.includeCounter = includeIndex + 1;
      return renderIncludeDirectiveHtml(rawPath, boardId, 'include-filename-link', {
        expandPreview: true,
        depth: 0,
        includeIndex: includeIndex,
        allowActions: !(renderState.nestedDepth > 0)
      });
    });

    // Links: [text](url)
    safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, rawHref) {
      var parsed = parseMarkdownTarget(rawHref);
      var href = parsed.path;
      var titleAttr = parsed.title ? ' title="' + escapeAttr(parsed.title.replace(/^(&quot;|")|(&quot;|")$/g, '')) + '"' : '';
      var isExternal = /^https?:\/\//.test(href);
      var isAnchor = href.indexOf('#') === 0;
      var isMailto = href.indexOf('mailto:') === 0;
      if (!isExternal && !isAnchor && !isMailto && href && boardId) {
        var linkIndex = renderState.linkCounter || 0;
        renderState.linkCounter = linkIndex + 1;
        return renderBoardFileLinkHtml(href, boardId, label, parsed.title ? parsed.title.replace(/^(&quot;|")|(&quot;|")$/g, '') : '', '', {
          withMenu: true,
          linkIndex: linkIndex
        });
      }
      var safeHref = escapeAttr(href);
      var targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
      return '<a href="' + safeHref + '"' + titleAttr + targetAttr + '>' + label + '</a>';
    });

    // Wiki links: [[document]] or [[document|title]]
    safe = safe.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, function (_, rawDocument, rawTitle) {
      var documentName = decodeHtmlEntities(rawDocument).trim();
      var label = rawTitle ? rawTitle.trim() : rawDocument.trim();
      return renderWikiLinkHtml(documentName, label, { withMenu: true });
    });

    // Footnote references: [^1]
    safe = safe.replace(/\[\^([^\]]+)\]/g, function (_, footnoteId) {
      var order = renderState.footnoteOrder || [];
      var idx = order.indexOf(footnoteId);
      var number = idx === -1 ? '?' : String(idx + 1);
      return '<sup class="footnote-ref"><a href="#footnote-' + escapeAttr(footnoteId) + '">[' + number + ']</a></sup>';
    });

    // Bold: **text**
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic: *text*
    safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Strikethrough: ~~text~~
    safe = safe.replace(/~~([^~]+)~~/g, '<s>$1</s>');

    // Mark: ==text==
    safe = safe.replace(/==([^=]+)==/g, '<mark>$1</mark>');

    // Inserted text: ++text++
    safe = safe.replace(/\+\+([^+]+)\+\+/g, '<ins>$1</ins>');

    // Underline: _text_
    safe = safe.replace(/(^|[^\w])_([^_\n]+)_/g, function (_, pre, value) {
      return pre + '<u>' + value + '</u>';
    });

    // Subscript: H~2~O
    safe = safe.replace(/(^|[^~])~([^~]+)~(?=[^~]|$)/g, function (_, pre, value) {
      return pre + '<sub>' + value + '</sub>';
    });

    // Superscript: 29^th^
    safe = safe.replace(/(^|[^^])\^([^^]+)\^(?=[^^]|$)/g, function (_, pre, value) {
      return pre + '<sup>' + value + '</sup>';
    });

    // Inline code: `code`
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Tags: #tag-name (word boundary, not inside HTML attributes)
    safe = safe.replace(/(^|\s)(#[a-zA-Z][\w-]*)/g, function(_, pre, tag) {
      var color = getTagColor(tag);
      return pre + '<span class="tag" data-tag="' + escapeAttr(tag) + '" style="background:' + color + ';color:#fff">' + tag + '</span>';
    });

    // Temporal tags: legacy `!` prefix and package `@` prefix for dates, weeks, weekdays, times, and slots.
    safe = safe.replace(/(^|\s)([!@](?:today|tomorrow|yesterday|date\([^)]+\)|days[+-]\d+|\d{4}[-.]?(?:w|kw)\d{1,2}|(?:w|kw)\d{1,2}|mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday|:\d{1,2}-:\d{1,2}|\d{1,2}(?::\d{2})?(?:am|pm)?-\d{1,2}(?::\d{2})?(?:am|pm)?|\d{1,4}[./-]\d{1,2}(?:[./-]\d{2,4})?|\d{1,2}(?::\d{2})?(?:am|pm)?))/gi, function (_, pre, tag) {
      return pre + renderTemporalTagHtml(tag);
    });

    safe = renderEmojiShortcodes(safe);

    for (var i = 0; i < htmlTokens.length; i++) {
      safe = safe.replace('@@HTMLTOKEN' + i + '@@', htmlTokens[i]);
    }

    safe = applyAbbreviationsToHtml(safe, renderState.abbrDefs || {});
    return safe;
  }

  function getTemporalTagType(tag) {
    var value = String(tag || '').trim();
    if (!value) return '';
    var body = value.charAt(0) === '!' || value.charAt(0) === '@' ? value.slice(1) : value;
    var lower = body.toLowerCase();
    if (/^(today|tomorrow|yesterday|date\([^)]+\)|days[+-]\d+)$/.test(lower)) return 'date';
    if (/^(?:\d{4})[-.]?(?:w|kw)\d{1,2}$/i.test(body) || /^(?:w|kw)\d{1,2}$/i.test(body)) return 'week';
    if (/^(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)$/i.test(body)) return 'weekday';
    if (/^:\d{1,2}-:\d{1,2}$/i.test(body)) return 'minuteSlot';
    if (/^\d{1,2}(?::\d{2})?(?:am|pm)?-\d{1,2}(?::\d{2})?(?:am|pm)?$/i.test(body)) return 'timeSlot';
    if (/^\d{1,2}(?::\d{2})?(?:am|pm)?$/i.test(body)) return 'time';
    if (/^\d{1,4}[./-]\d{1,2}(?:[./-]\d{2,4})?$/i.test(body)) return 'date';
    return '';
  }

  function describeTemporalTag(tag) {
    var type = getTemporalTagType(tag);
    if (!type) return null;
    return {
      type: type,
      resolved: resolveTemporalTag(tag)
    };
  }

  function resolveTemporalTag(tag) {
    var raw = String(tag || '').trim();
    var prefix = raw.charAt(0);
    var lower = raw.toLowerCase();
    var body = (prefix === '!' || prefix === '@') ? raw.slice(1) : raw;
    var lowerBody = body.toLowerCase();
    var now = new Date();
    now.setHours(0, 0, 0, 0);

    if (lowerBody === 'today') return formatDate(now);
    if (lowerBody === 'tomorrow') { now.setDate(now.getDate() + 1); return formatDate(now); }
    if (lowerBody === 'yesterday') { now.setDate(now.getDate() - 1); return formatDate(now); }

    var daysMatch = lowerBody.match(/^days([+-])(\d+)$/);
    if (daysMatch) {
      var offset = parseInt(daysMatch[2], 10) * (daysMatch[1] === '+' ? 1 : -1);
      now.setDate(now.getDate() + offset);
      return formatDate(now);
    }

    var dateMatch = body.match(/^date\((\d{4}-\d{2}-\d{2})\)$/i);
    if (dateMatch) return dateMatch[1];

    var weekdays = {
      sun: 0, sunday: 0,
      mon: 1, monday: 1,
      tue: 2, tuesday: 2,
      wed: 3, wednesday: 3,
      thu: 4, thursday: 4,
      fri: 5, friday: 5,
      sat: 6, saturday: 6
    };
    var dayName = lowerBody;
    if (weekdays[dayName] !== undefined) {
      var target = weekdays[dayName];
      var current = now.getDay();
      var diff = target - current;
      if (diff <= 0) diff += 7;
      now.setDate(now.getDate() + diff);
      return formatDate(now);
    }

    if (/^(?:\d{4})[-.]?(?:w|kw)(\d{1,2})$/i.test(body) || /^(?:w|kw)(\d{1,2})$/i.test(body)) {
      return 'Week ' + body.replace(/^(?:\d{4})[-.]?/i, '').toUpperCase();
    }

    if (/^:\d{1,2}-:\d{1,2}$/i.test(body) || /^\d{1,2}(?::\d{2})?(?:am|pm)?-\d{1,2}(?::\d{2})?(?:am|pm)?$/i.test(body)) {
      return body;
    }

    if (/^\d{1,2}(?::\d{2})?(?:am|pm)?$/i.test(body)) {
      return body;
    }

    if (/^\d{1,4}[./-]\d{1,2}(?:[./-]\d{2,4})?$/i.test(body)) {
      return body;
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Virtual Scrolling for Large Board Columns
  // ═══════════════════════════════════════════════════════════════════════════
  // For columns with many cards (>50), only renders cards near the viewport.
  // Off-screen cards are replaced with lightweight placeholder elements that
  // preserve the correct scroll height.  During drag-and-drop all cards are
  // materialised so hit-testing works correctly.  Edited cards are always kept
  // rendered regardless of visibility.
  // ═══════════════════════════════════════════════════════════════════════════

  var VIRTUAL_SCROLL_CARD_THRESHOLD = 50;

  /** Per-column state, keyed by the column-cards DOM element. */
  var vsColumnStates = new Map();

  /** Single IntersectionObserver shared by all virtualised columns. */
  var vsObserver = null;

  /** Root element used for IntersectionObserver (the scroll container). */
  function vsGetRoot() {
    return getElColumnsContainer();
  }

  /**
   * Tear down all virtual-scrolling state.  Called at the start of every
   * renderColumns() so stale observers are never left behind.
   */
  function vsTeardown() {
    if (vsObserver) {
      vsObserver.disconnect();
      vsObserver = null;
    }
    vsColumnStates.clear();
  }

  /**
   * Scan all rendered columns and activate virtual scrolling on those whose
   * card count exceeds the threshold.  Must be called AFTER the DOM is fully
   * built by renderColumns() (including content enhancement).
   */
  function vsActivate() {
    vsTeardown();

    var root = vsGetRoot();
    if (!root) return;

    // Collect qualifying column-cards containers
    var allCardsContainers = root.querySelectorAll('.column-cards');
    var qualifying = [];
    for (var i = 0; i < allCardsContainers.length; i++) {
      var container = allCardsContainers[i];
      var cards = container.querySelectorAll(':scope > .card');
      if (cards.length > VIRTUAL_SCROLL_CARD_THRESHOLD) {
        qualifying.push({ container: container, cards: cards });
      }
    }

    if (qualifying.length === 0) return;

    // Create the shared IntersectionObserver.
    // rootMargin adds a generous buffer zone above and below so cards are
    // rendered before they actually scroll into view.
    vsObserver = new IntersectionObserver(vsHandleIntersections, {
      root: root,
      rootMargin: '600px 0px 600px 0px',
      threshold: 0
    });

    for (var q = 0; q < qualifying.length; q++) {
      var info = qualifying[q];
      var colEl = info.container.closest('.column');
      if (colEl) colEl.classList.add('virtual-scrolling');

      var state = {
        container: info.container,
        /** Map from sentinel element → { cardEl, height } */
        sentinels: new Map(),
        /** Set of card elements currently replaced by placeholders */
        virtualised: new Set()
      };
      vsColumnStates.set(info.container, state);

      // Measure every card, create a sentinel for each, then replace
      // non-visible cards with their sentinels.
      var cards = info.cards;
      for (var j = 0; j < cards.length; j++) {
        var card = cards[j];
        var height = card.offsetHeight;
        // Create a lightweight sentinel (placeholder) element
        var sentinel = document.createElement('div');
        sentinel.className = 'vs-placeholder';
        sentinel.style.height = height + 'px';
        // Store the real card's data attributes on the sentinel so it can
        // be identified if needed.
        sentinel.setAttribute('data-vs-card-id', card.getAttribute('data-card-id') || '');
        sentinel.setAttribute('data-vs-col-index', card.getAttribute('data-col-index') || '');
        sentinel.setAttribute('data-vs-card-index', card.getAttribute('data-card-index') || '');

        state.sentinels.set(sentinel, { cardEl: card, height: height });

        // Start by observing every card AND its sentinel.  Cards that are
        // currently visible stay rendered; those off-screen will be swapped
        // out in the first intersection callback.
        vsObserver.observe(card);
        // We don't replace cards yet — the IntersectionObserver callback
        // will fire immediately (synchronously after observe on rAF) and
        // handle the swap for off-screen cards.
      }

      // Use requestAnimationFrame to let the observer fire its initial
      // batch, then do the first swap pass.
      (function (st) {
        requestAnimationFrame(function () {
          vsInitialSwap(st);
        });
      })(state);
    }
  }

  /**
   * After the observer has had a chance to fire once, swap out any cards that
   * are NOT intersecting with placeholders.
   */
  function vsInitialSwap(state) {
    if (!vsObserver) return;
    state.sentinels.forEach(function (info, sentinel) {
      var card = info.cardEl;
      // If the card is still in the DOM and not near the viewport, replace it
      if (card.parentNode === state.container && !vsIsNearViewport(card)) {
        // Don't virtualise cards that are being edited
        if (currentCardEditor && currentCardEditor.cardEl === card) return;
        state.container.replaceChild(sentinel, card);
        state.virtualised.add(card);
        vsObserver.observe(sentinel);
      }
    });
  }

  /**
   * Quick check whether an element is near the scroll viewport.
   */
  function vsIsNearViewport(el) {
    var root = vsGetRoot();
    if (!root) return true;
    var rootRect = root.getBoundingClientRect();
    var elRect = el.getBoundingClientRect();
    var buffer = 600;
    return (
      elRect.bottom >= rootRect.top - buffer &&
      elRect.top <= rootRect.bottom + buffer
    );
  }

  /**
   * IntersectionObserver callback.  When a sentinel scrolls into view, swap
   * the real card back in.  When a card scrolls out of view, swap the
   * sentinel back in.
   */
  function vsHandleIntersections(entries) {
    // During drag, do nothing — all cards need to be in the DOM.
    if (ptrDrag || cardDrag) return;

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var el = entry.target;

      if (el.classList.contains('vs-placeholder')) {
        // A placeholder just became visible — swap the real card in
        if (entry.isIntersecting) {
          vsSwapIn(el);
        }
      } else if (el.classList.contains('card')) {
        // A real card just left the viewport — swap it out
        if (!entry.isIntersecting) {
          vsSwapOut(el);
        }
      }
    }
  }

  /**
   * Replace a sentinel/placeholder with its real card element.
   */
  function vsSwapIn(sentinel) {
    // Find the state that owns this sentinel
    var state = vsFindStateForSentinel(sentinel);
    if (!state) return;
    var info = state.sentinels.get(sentinel);
    if (!info) return;
    var card = info.cardEl;
    if (sentinel.parentNode) {
      sentinel.parentNode.replaceChild(card, sentinel);
      state.virtualised.delete(card);
      // Observe the real card so we know when it scrolls away
      if (vsObserver) {
        vsObserver.unobserve(sentinel);
        vsObserver.observe(card);
      }
    }
  }

  /**
   * Replace a real card element with its sentinel/placeholder.
   */
  function vsSwapOut(card) {
    // Don't virtualise cards that are being edited
    if (currentCardEditor && currentCardEditor.cardEl === card) return;

    // Find the state and sentinel for this card
    var state = vsFindStateForCard(card);
    if (!state) return;
    var sentinel = vsFindSentinelForCard(state, card);
    if (!sentinel) return;

    if (card.parentNode) {
      // Update placeholder height in case the card was resized
      sentinel.style.height = card.offsetHeight + 'px';
      card.parentNode.replaceChild(sentinel, card);
      state.virtualised.add(card);
      if (vsObserver) {
        vsObserver.unobserve(card);
        vsObserver.observe(sentinel);
      }
    }
  }

  function vsFindStateForSentinel(sentinel) {
    var result = null;
    vsColumnStates.forEach(function (state) {
      if (state.sentinels.has(sentinel)) result = state;
    });
    return result;
  }

  function vsFindStateForCard(card) {
    var result = null;
    vsColumnStates.forEach(function (state) {
      state.sentinels.forEach(function (info) {
        if (info.cardEl === card) result = state;
      });
    });
    return result;
  }

  function vsFindSentinelForCard(state, card) {
    var found = null;
    state.sentinels.forEach(function (info, sentinel) {
      if (info.cardEl === card) found = sentinel;
    });
    return found;
  }

  /**
   * During drag start, materialise ALL virtualised cards so that pointer
   * hit-testing works on every card.  Called from the drag start path.
   */
  function vsMaterialiseAll() {
    if (vsColumnStates.size === 0) return;
    vsColumnStates.forEach(function (state) {
      state.sentinels.forEach(function (info, sentinel) {
        if (sentinel.parentNode && state.virtualised.has(info.cardEl)) {
          sentinel.parentNode.replaceChild(info.cardEl, sentinel);
          state.virtualised.delete(info.cardEl);
          if (vsObserver) {
            vsObserver.unobserve(sentinel);
            vsObserver.observe(info.cardEl);
          }
        }
      });
    });
  }

  /**
   * After drag ends, re-evaluate which cards should be virtualised.
   * Called from the drag cleanup path.
   */
  function vsRestoreAfterDrag() {
    if (vsColumnStates.size === 0) return;
    vsColumnStates.forEach(function (state) {
      state.sentinels.forEach(function (info, sentinel) {
        var card = info.cardEl;
        if (card.parentNode === state.container && !vsIsNearViewport(card)) {
          if (currentCardEditor && currentCardEditor.cardEl === card) return;
          sentinel.style.height = card.offsetHeight + 'px';
          state.container.replaceChild(sentinel, card);
          state.virtualised.add(card);
          if (vsObserver) {
            vsObserver.unobserve(card);
            vsObserver.observe(sentinel);
          }
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { poll: poll };
})();
