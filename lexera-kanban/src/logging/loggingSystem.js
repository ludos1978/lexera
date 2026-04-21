/**
 * Lexera Log — Unified log stream with per-source category filter.
 */
var frontendLogEntries = [];
var backendLogEntries = [];
var LOG_MAX = 1000;

// Registry of log source categories. Add a new entry to surface a new filter in the dropdown.
// Each category: { id, label, match(entry) } where entry has .source tagged ('frontend' | 'backend').
var LOG_CATEGORIES = [
  { id: 'frontend', label: 'Frontend', match: function (e) { return e && e.source === 'frontend'; } },
  { id: 'backend',  label: 'Backend',  match: function (e) { return e && e.source === 'backend'; } }
];

// Registry of log levels. Entries whose level doesn't map to any id fall into 'debug'.
var LOG_LEVELS = [
  { id: 'error', label: 'Errors',   match: function (e) { return e && e.level === 'error'; } },
  { id: 'warn',  label: 'Warnings', match: function (e) { return e && e.level === 'warn'; } },
  { id: 'info',  label: 'Info',     match: function (e) { return e && e.level === 'info'; } },
  { id: 'debug', label: 'Debug',    match: function (e) { return e && (e.level === 'debug' || e.level === 'trace' || !e.level); } }
];

var _LogSettings = typeof LexeraSettings !== 'undefined' ? LexeraSettings : null;
// Default = all-on. Stored '' = none. Stored list = exactly those on. Bypass the settings store
// on load because it collapses missing vs empty-string into the same default.
function _loadStoredSet(storageKey, registry) {
  var raw = null;
  try { raw = localStorage.getItem(storageKey); } catch (_) { raw = null; }
  var set = {};
  if (raw === null) {
    for (var i = 0; i < registry.length; i++) set[registry[i].id] = true;
    return set;
  }
  if (raw) {
    raw.split(',').forEach(function (id) {
      id = (id || '').trim();
      if (id && registry.some(function (c) { return c.id === id; })) set[id] = true;
    });
  }
  return set;
}
var activeLogCategories = _loadStoredSet('lexera-log-categories', LOG_CATEGORIES);
var activeLogLevels = _loadStoredSet('lexera-log-levels', LOG_LEVELS);
var activeLogSearch = (function () {
  try { return localStorage.getItem('lexera-log-search') || ''; } catch (_) { return ''; }
})();
var activeLogSource = 'logs'; // 'logs' | 'stats' — controls which body pane is visible (kept for external callers)
var backendLogLoaded = false;
var backendLogEventSource = null;
var backendLogConnectPending = false;
var backendLogEmptySnapshotRetries = 0;
var backendConnectionState = false;
var lastStatusText = '';
var lastStatusLevel = '';
var FRONTEND_BUILD_STAMP = '20260305-1528-remote-join-persistence';

var elStatusMsg = null;
var elLogEntries = null;
var elLogPanel = null;
var elLogSettingsPane = null;
var elLogSettingsContainer = null;
var elLogSourceBtn = null;
var elLogSourceLabel = null;
var elLogSourceMenu = null;
var elLogLevelBtn = null;
var elLogLevelLabel = null;
var elLogLevelMenu = null;
var elLogRefreshBtn = null;
var elLogCopyBtn = null;
var elLogClearBtn = null;

function getSharedLogRoots() {
  var registry = window.LexeraSharedPanels;
  if (!registry || typeof registry.getRoots !== 'function') return [];
  return registry.getRoots('logs');
}

function getPrimaryLogRoot() {
  var canonical = document.getElementById('log-panel');
  if (canonical) return canonical;
  var roots = getSharedLogRoots();
  return roots.length ? roots[0] : null;
}

function queryPrimaryLogRoot(selector) {
  var root = getPrimaryLogRoot();
  return root ? root.querySelector(selector) : null;
}

function getElStatusMsg() { return elStatusMsg || (elStatusMsg = document.getElementById('status-msg') || queryPrimaryLogRoot('.status-msg')); }
function getElLogEntries() { return elLogEntries || (elLogEntries = document.getElementById('log-entries') || queryPrimaryLogRoot('.lexera-shared-log-entries')); }
function getElLogEntriesStats() { return queryPrimaryLogRoot('.lexera-shared-log-entries-stats') || document.getElementById('log-entries-stats'); }
function getElLogPanel() { return elLogPanel || (elLogPanel = document.getElementById('log-panel') || getPrimaryLogRoot()); }
function getElLogSettingsPane() {
  if (elLogSettingsPane) return elLogSettingsPane;
  var shell = typeof window !== 'undefined' ? window.LexeraWorkspaceShell : null;
  var shellEnabled = !!(shell && typeof shell.isEnabled === 'function' && shell.isEnabled());
  elLogSettingsPane = shellEnabled
    ? document.querySelector('.lexera-shared-panel-backend-settings') || document.getElementById('backend-settings-panel')
    : document.getElementById('mgmt-panel');
  return elLogSettingsPane;
}
function getElLogSettingsContainer() {
  if (elLogSettingsContainer) return elLogSettingsContainer;
  var shell = typeof window !== 'undefined' ? window.LexeraWorkspaceShell : null;
  var shellEnabled = !!(shell && typeof shell.isEnabled === 'function' && shell.isEnabled());
  elLogSettingsContainer = shellEnabled
    ? document.querySelector('.lexera-shared-backend-settings-container') || document.getElementById('backend-settings-container')
    : document.getElementById('mgmt-panel-body');
  return elLogSettingsContainer;
}
function getElLogSourceBtn() { return elLogSourceBtn || (elLogSourceBtn = document.getElementById('log-source-btn') || queryPrimaryLogRoot('.lexera-shared-log-source-btn')); }
function getElLogSourceLabel() { return elLogSourceLabel || (elLogSourceLabel = document.getElementById('log-source-label') || queryPrimaryLogRoot('.lexera-shared-log-source-label')); }
function getElLogSourceMenu() { return elLogSourceMenu || (elLogSourceMenu = document.getElementById('log-source-menu') || queryPrimaryLogRoot('.lexera-shared-log-source-menu')); }
function getElLogLevelBtn() { return elLogLevelBtn || (elLogLevelBtn = document.getElementById('log-level-btn') || queryPrimaryLogRoot('.lexera-shared-log-level-btn')); }
function getElLogLevelLabel() { return elLogLevelLabel || (elLogLevelLabel = document.getElementById('log-level-label') || queryPrimaryLogRoot('.lexera-shared-log-level-label')); }
function getElLogLevelMenu() { return elLogLevelMenu || (elLogLevelMenu = document.getElementById('log-level-menu') || queryPrimaryLogRoot('.lexera-shared-log-level-menu')); }
function getElLogRefreshBtn() { return elLogRefreshBtn || (elLogRefreshBtn = document.getElementById('log-refresh-btn') || queryPrimaryLogRoot('.lexera-shared-log-refresh')); }
function getElLogCopyBtn() { return elLogCopyBtn || (elLogCopyBtn = document.getElementById('log-copy-btn') || queryPrimaryLogRoot('.lexera-shared-log-copy')); }
function getElLogClearBtn() { return elLogClearBtn || (elLogClearBtn = document.getElementById('log-clear-btn') || queryPrimaryLogRoot('.lexera-shared-log-clear')); }
function getElLogSearchInput() { return document.getElementById('log-search-input') || queryPrimaryLogRoot('.lexera-shared-log-search'); }

function getAllLogStatusContainers() {
  return Array.prototype.slice.call(document.querySelectorAll('.log-panel-status'));
}

function getAllLogStatusMessages() {
  return getAllLogStatusContainers().map(function (container) {
    return container.querySelector('.status-msg');
  }).filter(function (el) { return !!el; });
}

function getAllConnectionStatusButtons() {
  return Array.prototype.slice.call(document.querySelectorAll('.log-panel-status .connection-status-btn'));
}

function syncStatusContainerLevel(container, level) {
  if (!container) return;
  container.classList.remove('status-warn', 'status-error', 'status-info');
  if (level === 'warn' || level === 'error' || level === 'info') {
    container.classList.add('status-' + level);
  }
}

function syncAllLogStatusMessages() {
  var messages = getAllLogStatusMessages();
  for (var i = 0; i < messages.length; i++) {
    messages[i].textContent = lastStatusText;
    syncStatusContainerLevel(messages[i].parentElement, lastStatusLevel);
  }
}

function syncConnectionStatusButtonState(buttonEl, state) {
  if (!buttonEl) return;
  var isConnected = !!state;
  var title = isConnected
    ? 'Backend connected. Open backend settings'
    : 'Backend disconnected. Open backend settings';
  buttonEl.classList.toggle('connected', isConnected);
  buttonEl.classList.toggle('disconnected', !isConnected);
  buttonEl.setAttribute('data-connection-state', isConnected ? 'connected' : 'disconnected');
  buttonEl.title = title;
  buttonEl.setAttribute('aria-label', title);
  var labelEl = buttonEl.querySelector('.connection-status-label');
  if (labelEl) labelEl.textContent = isConnected ? 'Connected' : 'Disconnected';
  var dotEl = buttonEl.querySelector('.connection-dot');
  if (dotEl) {
    dotEl.classList.toggle('connected', isConnected);
    dotEl.classList.toggle('disconnected', !isConnected);
  }
}

function syncAllConnectionStatusButtons() {
  var buttons = getAllConnectionStatusButtons();
  for (var i = 0; i < buttons.length; i++) {
    syncConnectionStatusButtonState(buttons[i], backendConnectionState);
  }
}

function setLogBackendConnectionState(state) {
  backendConnectionState = !!state;
  syncAllConnectionStatusButtons();
  window.dispatchEvent(new CustomEvent('lexera-backend-connection-state-changed', {
    detail: { connected: backendConnectionState }
  }));
}

function getMirroredLogViews() {
  var roots = getSharedLogRoots();
  return roots.map(function (root) {
    return {
      root: root,
      sourceBtn: root.querySelector('.lexera-shared-log-source-btn'),
      sourceLabel: root.querySelector('.lexera-shared-log-source-label'),
      sourceMenu: root.querySelector('.lexera-shared-log-source-menu'),
      levelBtn: root.querySelector('.lexera-shared-log-level-btn'),
      levelLabel: root.querySelector('.lexera-shared-log-level-label'),
      levelMenu: root.querySelector('.lexera-shared-log-level-menu'),
      searchInput: root.querySelector('.lexera-shared-log-search'),
      refreshBtn: root.querySelector('.lexera-shared-log-refresh'),
      copyBtn: root.querySelector('.lexera-shared-log-copy'),
      clearBtn: root.querySelector('.lexera-shared-log-clear'),
      titleEl: root.querySelector('.log-panel-title'),
      entries: root.querySelector('.lexera-shared-log-entries'),
      statsEntries: root.querySelector('.lexera-shared-log-entries-stats')
    };
  }).filter(function (view) { return !!view.root; });
}

function bindMirroredLogView(view) {
  if (!view || !view.root || view.root.__lexeraLogMirrorBound) return;
  view.root.__lexeraLogMirrorBound = true;
  if (view.refreshBtn) {
    view.refreshBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      refreshBackendLogs();
    });
  }
  if (view.copyBtn) {
    view.copyBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      copyActiveLogsToClipboard(view.copyBtn);
    });
  }
  if (view.clearBtn) {
    view.clearBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      clearActiveLogEntries();
    });
  }
  if (view.sourceBtn) {
    view.sourceBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleLogFilterMenu(view.sourceMenu, view.sourceBtn);
    });
  }
  if (view.sourceMenu) renderLogFilterMenu(view.sourceMenu, 'source');
  if (view.levelBtn) {
    view.levelBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleLogFilterMenu(view.levelMenu, view.levelBtn);
    });
  }
  if (view.levelMenu) renderLogFilterMenu(view.levelMenu, 'level');
  if (view.searchInput) {
    view.searchInput.value = activeLogSearch;
    view.searchInput.addEventListener('input', function (e) {
      e.stopPropagation();
      setLogSearchFilter(e.target.value);
    });
  }
}

function syncMirroredLogViews() {
  var canonicalEntries = getElLogEntries();
  var entriesHtml = canonicalEntries ? canonicalEntries.innerHTML : '';
  var statsPanel = getElLogEntriesStats();
  var statsHtml = statsPanel ? statsPanel.innerHTML : '';
  var primaryRoot = getPrimaryLogRoot();
  var titleEl = primaryRoot ? primaryRoot.querySelector('.log-panel-title') : null;
  var titleText = titleEl ? titleEl.textContent : 'Logs';
  var sourceLabelText = 'Sources';
  var levelLabelText = 'Levels';
  var mirroredViews = getMirroredLogViews();
  for (var i = 0; i < mirroredViews.length; i++) {
    var view = mirroredViews[i];
    bindMirroredLogView(view);
    if (view.entries) view.entries.innerHTML = entriesHtml;
    if (view.statsEntries) view.statsEntries.innerHTML = statsHtml;
    if (view.entries) view.entries.classList.toggle('hidden', activeLogSource === 'stats');
    if (view.statsEntries) view.statsEntries.classList.toggle('hidden', activeLogSource !== 'stats');
    if (view.refreshBtn) view.refreshBtn.style.display = activeLogSource === 'stats' ? 'none' : '';
    if (view.titleEl) view.titleEl.textContent = titleText;
    if (view.sourceLabel) view.sourceLabel.textContent = sourceLabelText;
    if (view.sourceMenu) syncLogFilterMenuState(view.sourceMenu, 'source');
    if (view.levelLabel) view.levelLabel.textContent = levelLabelText;
    if (view.levelMenu) syncLogFilterMenuState(view.levelMenu, 'level');
    if (view.searchInput && view.searchInput.value !== activeLogSearch) view.searchInput.value = activeLogSearch;
  }
  syncAllLogStatusMessages();
  syncAllConnectionStatusButtons();
}

window.addEventListener('lexera-shared-panel-created', function (event) {
  var detail = event && event.detail ? event.detail : {};
  if (detail.kind === 'logs') syncMirroredLogViews();
});

window.addEventListener('storage', function (event) {
  if (!event) return;
  if (event.key === 'lexera-log-categories') {
    activeLogCategories = _loadStoredSet('lexera-log-categories', LOG_CATEGORIES);
    applyLogEntryFilters();
    syncMirroredLogViews();
  } else if (event.key === 'lexera-log-levels') {
    activeLogLevels = _loadStoredSet('lexera-log-levels', LOG_LEVELS);
    applyLogEntryFilters();
    syncMirroredLogViews();
  } else if (event.key === 'lexera-log-search') {
    activeLogSearch = event.newValue || '';
    applyLogEntryFilters();
    syncMirroredLogViews();
  }
});

var elBoardList = null;
var elBoardHeader = null;
var elColumnsContainer = null;
var elSearchResults = null;
var elEmptyState = null;
var elConnectionStatusBtn = null;
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
function getElConnectionStatusBtn() { return elConnectionStatusBtn || (elConnectionStatusBtn = document.getElementById('btn-connection-status')); }
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

function getLogEntriesSnapshot(source, options) {
  var entries;
  if (source === 'all' || source == null) {
    entries = mergeLogEntries();
  } else {
    entries = getLogEntries(source).map(function (entry) {
      return Object.assign({ source: source === 'backend' ? 'backend' : 'frontend' }, entry);
    });
  }
  if (options && options.level) {
    entries = entries.filter(function (entry) { return entry.level === options.level; });
  }
  return entries.slice();
}

function mergeLogEntries() {
  var merged = backendLogEntries.map(function (entry) {
    return Object.assign({ source: 'backend' }, entry);
  }).concat(frontendLogEntries.map(function (entry) {
    return Object.assign({ source: 'frontend' }, entry);
  }));
  merged.sort(function (a, b) {
    return (a.timestampMs || 0) - (b.timestampMs || 0);
  });
  return merged;
}

function escapeLogHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getLogContainer() {
  return getElLogEntries();
}

function registryIdFor(registry, entry) {
  for (var i = 0; i < registry.length; i++) {
    if (registry[i].match(entry)) return registry[i].id;
  }
  return '';
}

function entryCategoryId(entry) { return registryIdFor(LOG_CATEGORIES, entry); }
function entryLevelId(entry)    { return registryIdFor(LOG_LEVELS, entry); }

function entryMatchesSearch(entry) {
  if (!activeLogSearch) return true;
  var needle = activeLogSearch.toLowerCase();
  var hay = [
    entry.source || '',
    entry.target || '',
    entry.level || '',
    entry.message || ''
  ].join(' ').toLowerCase();
  return hay.indexOf(needle) !== -1;
}

function entryAllowed(entry) {
  var catId = entryCategoryId(entry);
  var lvlId = entryLevelId(entry);
  return !!activeLogCategories[catId] && !!activeLogLevels[lvlId] && entryMatchesSearch(entry);
}

function persistActiveSet(storageKey, settingsName, registry, activeSet) {
  var ids = [];
  for (var i = 0; i < registry.length; i++) {
    if (activeSet[registry[i].id]) ids.push(registry[i].id);
  }
  var value = ids.join(',');
  if (_LogSettings) {
    try { _LogSettings.set(settingsName, value); } catch (_) {}
  }
  try { localStorage.setItem(storageKey, value); } catch (_) {}
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
  var prefix = source === 'backend' ? '[backend] ' : '';
  lastStatusText = prefix + entry.message;
  lastStatusLevel = entry.level || '';
  syncAllLogStatusMessages();
}

// ── Error indicator on log panel header ─────────────────────────────
function showLogPanelErrorIndicator(message) {
  var headers = document.querySelectorAll('.log-panel-header');
  for (var i = 0; i < headers.length; i++) {
    var header = headers[i];
    header.classList.add('log-panel-has-error');
    var msgEl = header.querySelector('.log-panel-error-msg');
    var actionsEl = header.querySelector('.log-panel-actions');
    if (!msgEl) {
      msgEl = document.createElement('span');
      msgEl.className = 'log-panel-error-msg';
    }
    if (actionsEl) header.insertBefore(msgEl, actionsEl);
    else if (msgEl.parentNode !== header) header.appendChild(msgEl);
    msgEl.textContent = message;
  }
}

function clearLogPanelErrorIndicator() {
  var headers = document.querySelectorAll('.log-panel-header');
  for (var i = 0; i < headers.length; i++) {
    headers[i].classList.remove('log-panel-has-error');
    var msgEl = headers[i].querySelector('.log-panel-error-msg');
    if (msgEl) msgEl.remove();
  }
}

function renderLogEntry(source, entry) {
  var el = document.createElement('div');
  el.className = 'log-entry log-' + entry.level;
  el.setAttribute('data-source', source);
  var tagged = Object.assign({ source: source }, entry);
  var catId = entryCategoryId(tagged);
  var lvlId = entryLevelId(tagged);
  if (catId) el.setAttribute('data-category', catId);
  if (lvlId) el.setAttribute('data-level', lvlId);
  if (!entryAllowed(tagged)) el.classList.add('log-entry-filtered');
  el.innerHTML =
    '<span class="log-time">' + escapeLogHtml(formatLogTimestamp(entry)) + '</span>' +
    '<span class="log-level">' + escapeLogHtml(String(entry.level || '').toUpperCase()) + '</span>' +
    '<span class="log-entry-source">' + escapeLogHtml(source) + '</span>' +
    '<span class="log-entry-target">' + escapeLogHtml(entry.target || (source === 'backend' ? 'backend' : 'frontend')) + '</span>' +
    '<span class="log-msg">' + escapeLogHtml(entry.message) + '</span>';
  return el;
}

function syncLogCount() {
  var total = backendLogEntries.length + frontendLogEntries.length;
  var titles = document.querySelectorAll('.log-panel-title');
  var text = activeLogSource === 'stats' ? 'Logs \u00B7 Stats' : 'Logs (' + total + ')';
  for (var i = 0; i < titles.length; i++) titles[i].textContent = text;
}

function applyLogEntryFilters() {
  var needle = activeLogSearch ? activeLogSearch.toLowerCase() : '';
  var panels = document.querySelectorAll('.log-panel');
  for (var i = 0; i < panels.length; i++) {
    var entries = panels[i].querySelectorAll('.log-entry');
    for (var j = 0; j < entries.length; j++) {
      var el = entries[j];
      var catId = el.getAttribute('data-category') || '';
      var lvlId = el.getAttribute('data-level') || '';
      var matchesSearch = !needle || (el.textContent || '').toLowerCase().indexOf(needle) !== -1;
      var show = !!activeLogCategories[catId] && !!activeLogLevels[lvlId] && matchesSearch;
      el.classList.toggle('log-entry-filtered', !show);
    }
  }
}

function clearLogPanelLoading() {
  var rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
  if (!rt) return;
  var roots = getSharedLogRoots();
  for (var i = 0; i < roots.length; i++) {
    var el = roots[i].querySelector('.log-panel-main');
    if (el) rt.setViewLoading(el, false);
  }
  var canonical = document.getElementById('log-panel');
  if (canonical) {
    var canonicalMain = canonical.querySelector('.log-panel-main');
    if (canonicalMain) rt.setViewLoading(canonicalMain, false);
  }
}

function appendLogEntry(source, entry) {
  var entries = getLogEntries(source);
  var lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;

  // Track repeat count instead of silently dropping duplicates
  if (lastEntry && logEntryKey(lastEntry) === logEntryKey(entry)) {
    lastEntry._repeatCount = (lastEntry._repeatCount || 1) + 1;
    updateLastLogEntryRepeat(source, lastEntry);
    return;
  }

  clearLogPanelLoading();

  entries.push(entry);
  if (entries.length > LOG_MAX) entries.shift();

  setStatusBarEntry(source, entry);

  if (entry.level === 'error') {
    showLogPanelErrorIndicator(entry.message || 'Unknown error');
    var rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
    if (rt) {
      var logMains = document.querySelectorAll('.log-panel-main');
      for (var lm = 0; lm < logMains.length; lm++) {
        rt.setViewError(logMains[lm], true, entry.message || 'Error');
      }
    }
  }

  var panel = getLogContainer();
  if (panel) {
    var combinedMax = LOG_MAX * 2;
    while (panel.childNodes.length >= combinedMax) {
      panel.removeChild(panel.firstChild);
    }
    panel.appendChild(renderLogEntry(source, entry));
    panel.scrollTop = panel.scrollHeight;
  }
  syncLogCount();
  syncMirroredLogViews();
  updateFoldedLogStatusBadges();
}

function updateLastLogEntryRepeat(source, entry) {
  var panel = getLogContainer();
  if (!panel) return;
  // Scan backwards for the last entry from this source to update its repeat badge.
  var children = panel.childNodes;
  var lastEl = null;
  for (var i = children.length - 1; i >= 0; i--) {
    var node = children[i];
    if (node.nodeType === 1 && node.getAttribute && node.getAttribute('data-source') === source) {
      lastEl = node;
      break;
    }
  }
  if (!lastEl) return;
  var badge = lastEl.querySelector('.log-repeat-count');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'log-repeat-count';
    lastEl.appendChild(badge);
  }
  badge.textContent = '\u00D7' + entry._repeatCount;
}

function replaceLogEntries(source, entries) {
  clearLogPanelLoading();
  var nextEntries = (entries || []).slice(-LOG_MAX);
  var target = getLogEntries(source);
  target.length = 0;
  Array.prototype.push.apply(target, nextEntries);
  rerenderUnifiedLogEntries();
  syncLogCount();
  syncMirroredLogViews();
  updateFoldedLogStatusBadges();
}

function rerenderUnifiedLogEntries() {
  var panel = getLogContainer();
  if (!panel) return;
  var merged = mergeLogEntries();
  panel.innerHTML = '';
  for (var i = 0; i < merged.length; i++) {
    panel.appendChild(renderLogEntry(merged[i].source, merged[i]));
  }
  panel.scrollTop = panel.scrollHeight;
}

function clearActiveLogEntries() {
  frontendLogEntries.length = 0;
  backendLogEntries.length = 0;
  var panel = getLogContainer();
  if (panel) panel.innerHTML = '';
  syncLogCount();
  syncMirroredLogViews();
  updateFoldedLogStatusBadges();
}

function copyActiveLogsToClipboard(copyBtn) {
  var merged = mergeLogEntries().filter(entryAllowed);
  var text = merged.map(function (entry) {
    var ts = formatLogTimestamp(entry);
    var level = String(entry.level || '').toUpperCase();
    var target = entry.target || entry.source || '';
    return ts + ' [' + (entry.source || '') + '] ' + level + ' [' + target + '] ' + (entry.message || '');
  }).join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      if (!copyBtn) return;
      copyBtn.textContent = 'Copied!';
      setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500);
    });
  }
}

function setActiveLogSource(source) {
  // External callers use this to switch between the logs stream and the board-stats pane.
  // Source filtering now lives in the categories dropdown; frontend/backend/logs map to 'logs'.
  activeLogSource = source === 'stats' ? 'stats' : 'logs';

  var entriesPanel = getElLogEntries();
  var statsPanel = getElLogEntriesStats();
  var refreshBtn = getElLogRefreshBtn();

  if (entriesPanel) entriesPanel.classList.toggle('hidden', activeLogSource === 'stats');
  if (statsPanel) statsPanel.classList.toggle('hidden', activeLogSource !== 'stats');
  if (refreshBtn) refreshBtn.style.display = activeLogSource === 'stats' ? 'none' : '';
  syncLogCount();
  syncMirroredLogViews();
  if (activeLogSource === 'logs' && !backendLogEventSource && !backendLogConnectPending) {
    connectBackendLogStreamIfReady();
  }
}

function _getFilterConfig(facet) {
  if (facet === 'level') {
    return {
      registry: LOG_LEVELS,
      active: activeLogLevels,
      storageKey: 'lexera-log-levels',
      settingsKey: 'logLevels',
      attr: 'data-log-level'
    };
  }
  return {
    registry: LOG_CATEGORIES,
    active: activeLogCategories,
    storageKey: 'lexera-log-categories',
    settingsKey: 'logCategories',
    attr: 'data-log-category'
  };
}

function toggleLogFilterValue(facet, id) {
  var cfg = _getFilterConfig(facet);
  if (!cfg.registry.some(function (c) { return c.id === id; })) return;
  if (cfg.active[id]) delete cfg.active[id];
  else cfg.active[id] = true;
  persistActiveSet(cfg.storageKey, cfg.settingsKey, cfg.registry, cfg.active);
  applyLogEntryFilters();
  syncLogCount();
  syncAllLogFilterMenus();
  syncMirroredLogViews();
}

function setLogSearchFilter(value) {
  var next = String(value == null ? '' : value);
  if (next === activeLogSearch) return;
  activeLogSearch = next;
  try { localStorage.setItem('lexera-log-search', activeLogSearch); } catch (_) {}
  applyLogEntryFilters();
  syncLogCount();
  syncMirroredLogViews();
}

function syncAllLogFilterMenus() {
  var menus = document.querySelectorAll('.log-panel-source-menu');
  for (var i = 0; i < menus.length; i++) {
    var facet = menus[i].getAttribute('data-log-facet');
    if (facet) syncLogFilterMenuState(menus[i], facet);
  }
}

function renderLogFilterMenu(menuEl, facet) {
  if (!menuEl || menuEl.__lexeraLogMenuRendered) return;
  menuEl.__lexeraLogMenuRendered = true;
  menuEl.setAttribute('data-log-facet', facet);
  var cfg = _getFilterConfig(facet);
  menuEl.innerHTML = '';
  for (var i = 0; i < cfg.registry.length; i++) {
    var cat = cfg.registry[i];
    var item = document.createElement('label');
    item.className = 'log-panel-source-menu-item';
    item.setAttribute(cfg.attr, cat.id);
    item.innerHTML =
      '<input type="checkbox" class="log-panel-source-menu-checkbox" ' + cfg.attr + '="' + escapeLogHtml(cat.id) + '">' +
      '<span class="log-panel-source-menu-label">' + escapeLogHtml(cat.label) + '</span>';
    var input = item.querySelector('input');
    (function (facetId, id) {
      input.addEventListener('change', function () { toggleLogFilterValue(facetId, id); });
      item.addEventListener('click', function (e) {
        if (e.target && e.target.tagName === 'INPUT') return;
        e.preventDefault();
        toggleLogFilterValue(facetId, id);
      });
    })(facet, cat.id);
    menuEl.appendChild(item);
  }
  syncLogFilterMenuState(menuEl, facet);
}

function syncLogFilterMenuState(menuEl, facet) {
  if (!menuEl) return;
  facet = facet || menuEl.getAttribute('data-log-facet') || 'source';
  var cfg = _getFilterConfig(facet);
  if (!menuEl.__lexeraLogMenuRendered) renderLogFilterMenu(menuEl, facet);
  var inputs = menuEl.querySelectorAll('input[' + cfg.attr + ']');
  for (var i = 0; i < inputs.length; i++) {
    var id = inputs[i].getAttribute(cfg.attr);
    inputs[i].checked = !!cfg.active[id];
  }
}

function toggleLogFilterMenu(menuEl, btnEl) {
  if (!menuEl) return;
  var hidden = menuEl.classList.contains('hidden');
  closeAllLogFilterMenus();
  menuEl.classList.toggle('hidden', !hidden);
  if (btnEl) btnEl.setAttribute('aria-expanded', hidden ? 'true' : 'false');
  if (hidden) syncLogFilterMenuState(menuEl);
}

function closeAllLogFilterMenus() {
  var menus = document.querySelectorAll('.log-panel-source-menu');
  for (var i = 0; i < menus.length; i++) menus[i].classList.add('hidden');
  var btns = document.querySelectorAll('.log-panel-source-dropdown > button');
  for (var j = 0; j < btns.length; j++) btns[j].setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', function (event) {
  var target = event.target;
  if (!target || !target.closest) return;
  if (target.closest('.log-panel-source-dropdown')) return;
  closeAllLogFilterMenus();
});

function isLogPanelVisible() {
  var panel = getElLogPanel();
  var shell = typeof window !== 'undefined' ? window.LexeraWorkspaceShell : null;
  if (shell && typeof shell.isPanelVisible === 'function' && typeof shell.isEnabled === 'function' && shell.isEnabled()) {
    return !!shell.isPanelVisible('logs');
  }
  return !!(panel && !panel.classList.contains('hidden'));
}

function runInitManagementUI() {
  if (typeof initManagementUI === 'function') return initManagementUI();
  if (typeof window !== 'undefined' && typeof window.initManagementUI === 'function') {
    return window.initManagementUI();
  }
  return false;
}

function setLogPanelVisibility(visible) {
  if (visible) {
    clearLogPanelErrorIndicator();
    var rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
    if (rt) {
      var logMains = document.querySelectorAll('.log-panel-main');
      for (var lm = 0; lm < logMains.length; lm++) {
        rt.setViewError(logMains[lm], false);
      }
    }
  }
  var panel = getElLogPanel();
  if (!panel) return;
  var shell = typeof window !== 'undefined' ? window.LexeraWorkspaceShell : null;
  if (shell && typeof shell.setPanelVisibility === 'function' && typeof shell.isEnabled === 'function' && shell.isEnabled()) {
    if (visible) {
      panel.classList.remove('hidden');
      if (typeof shell.revealPanel === 'function') {
        shell.revealPanel('logs');
      } else {
        shell.setPanelVisibility('logs', true, { activate: true, restoreDock: true });
      }
    } else {
      panel.classList.remove('hidden');
      if (typeof shell.collapsePanel === 'function') shell.collapsePanel('logs');
      else if (typeof shell.collapseDock === 'function') shell.collapseDock('bottom');
    }
    updateAppBottomInset();
    setActiveLogSource(activeLogSource);
    return;
  }
  if (visible) {
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
  updateAppBottomInset();
  setActiveLogSource(activeLogSource);
}

function activateEmbeddedManagementTab(tabName) {
  var container = getElLogSettingsContainer();
  if (!container || !tabName) return;
  var topTab = container.querySelector('.mgmt-top-tab[data-mgmt-top-tab="' + tabName + '"]');
  var panel = container.querySelector('.mgmt-top-tab-content[data-mgmt-top-panel="' + tabName + '"]');
  if (!topTab || !panel) return;
  var tabs = container.querySelectorAll('.mgmt-top-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  var panels = container.querySelectorAll('.mgmt-top-tab-content');
  for (var p = 0; p < panels.length; p++) panels[p].classList.remove('active');
  topTab.classList.add('active');
  panel.classList.add('active');
}

function syncEmbeddedManagementUiState(preferredTab) {
  var container = getElLogSettingsContainer();
  if (!container) return;
  var logsTab = container.querySelector('.mgmt-top-tab[data-mgmt-top-tab="logs"]');
  var logsPanel = container.querySelector('.mgmt-top-tab-content[data-mgmt-top-panel="logs"]');
  if (logsTab) logsTab.classList.remove('active');
  if (logsPanel) logsPanel.classList.remove('active');
  if (preferredTab) activateEmbeddedManagementTab(preferredTab);
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

var SLOW_FRONTEND_TASK_THRESHOLD_MS = 300;

function getFrontendTimestampMs() {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function mergeSlowTaskDetails(taskName, durationMs, thresholdMs, details, options) {
  var payload = {};
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    for (var key in details) {
      if (Object.prototype.hasOwnProperty.call(details, key)) payload[key] = details[key];
    }
  } else if (details != null) {
    payload.details = normalizeLogMessage(details);
  }
  payload.task = taskName || 'unnamed-task';
  payload.durationMs = Math.round(durationMs * 10) / 10;
  payload.thresholdMs = thresholdMs;
  if (options && typeof options === 'object') {
    if (options.phase) payload.phase = options.phase;
    if (options.status) payload.status = options.status;
    if (options.error != null) payload.error = formatErrorDetails(options.error);
  }
  return payload;
}

function traceSlowFrontendTask(target, taskName, startedAtMs, details, options) {
  if (typeof startedAtMs !== 'number' || !isFinite(startedAtMs)) return 0;
  options = options || {};
  var thresholdMs = typeof options.thresholdMs === 'number' && options.thresholdMs > 0
    ? options.thresholdMs
    : SLOW_FRONTEND_TASK_THRESHOLD_MS;
  var endedAtMs = typeof options.endedAtMs === 'number' && isFinite(options.endedAtMs)
    ? options.endedAtMs
    : getFrontendTimestampMs();
  var durationMs = Math.max(0, endedAtMs - startedAtMs);
  if (durationMs < thresholdMs) return durationMs;
  traceFrontendAction('warn', target || 'frontend.slow', 'Slow frontend task: ' + (taskName || 'unnamed-task'), mergeSlowTaskDetails(taskName, durationMs, thresholdMs, details, options));
  return durationMs;
}

function withSlowFrontendTaskWarning(target, taskName, details, fn, options) {
  if (typeof fn !== 'function') throw new Error('withSlowFrontendTaskWarning requires a function');
  var startedAtMs = getFrontendTimestampMs();
  try {
    var result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(function (value) {
        traceSlowFrontendTask(target, taskName, startedAtMs, details, options);
        return value;
      }, function (err) {
        var failedOptions = {};
        if (options && typeof options === 'object') {
          for (var key in options) {
            if (Object.prototype.hasOwnProperty.call(options, key)) failedOptions[key] = options[key];
          }
        }
        failedOptions.status = failedOptions.status || 'failed';
        failedOptions.error = err;
        traceSlowFrontendTask(target, taskName, startedAtMs, details, failedOptions);
        throw err;
      });
    }
    traceSlowFrontendTask(target, taskName, startedAtMs, details, options);
    return result;
  } catch (err) {
    var syncFailedOptions = {};
    if (options && typeof options === 'object') {
      for (var optionKey in options) {
        if (Object.prototype.hasOwnProperty.call(options, optionKey)) syncFailedOptions[optionKey] = options[optionKey];
      }
    }
    syncFailedOptions.status = syncFailedOptions.status || 'failed';
    syncFailedOptions.error = err;
    traceSlowFrontendTask(target, taskName, startedAtMs, details, syncFailedOptions);
    throw err;
  }
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
    var entries = data && Array.isArray(data.entries) ? data.entries : [];
    replaceLogEntries('backend', entries);
    backendLogLoaded = entries.length > 0 || backendLogLoaded;
    traceFrontendAction('info', 'backend.log.refresh', 'Loaded backend log snapshot', {
      entries: entries.length,
      filePath: data && data.filePath ? data.filePath : null
    });
    if (entries.length === 0 && backendLogEmptySnapshotRetries < 5) {
      backendLogEmptySnapshotRetries++;
      setTimeout(refreshBackendLogs, 1000);
    } else if (entries.length > 0) {
      backendLogEmptySnapshotRetries = 0;
    }
  }).catch(function (err) {
    lexeraLog('warn', '[backend.log] Failed to load backend logs: ' + err.message);
    traceFrontendAction('warn', 'backend.log.refresh', 'Backend log snapshot request failed', {
      error: formatErrorDetails(err)
    });
    if (backendLogEmptySnapshotRetries < 5) {
      backendLogEmptySnapshotRetries++;
      setTimeout(refreshBackendLogs, 1500);
    }
  });
}

function closeBackendLogStream() {
  if (backendLogEventSource) {
    backendLogEventSource.close();
    backendLogEventSource = null;
    traceFrontendAction('info', 'backend.log.stream', 'Backend log stream closed (tab hidden)', {});
  }
}

function openBackendLogStream() {
  if (backendLogEventSource || !window.LexeraApi || typeof LexeraApi.connectLogStream !== 'function') return;
  traceFrontendAction('info', 'backend.log.stream', 'Opening backend log stream', {});
  backendLogEventSource = LexeraApi.connectLogStream(function (entry) {
    backendLogLoaded = true;
    lexeraBackendLog(entry);
  });
  if (!backendLogEventSource) {
    traceFrontendAction('warn', 'backend.log.stream', 'Backend log stream did not open (no backend URL yet)', {});
    setTimeout(connectBackendLogStreamIfReady, 1000);
    return;
  }
  backendLogEventSource.onopen = function () {
    traceFrontendAction('info', 'backend.log.stream', 'Backend log stream connected', {});
  };
  backendLogEventSource.onerror = function () {
    traceFrontendAction('warn', 'backend.log.stream', 'Backend log stream error; reconnect scheduled', {
      readyState: backendLogEventSource ? backendLogEventSource.readyState : null
    });
    if (backendLogEventSource) backendLogEventSource.close();
    backendLogEventSource = null;
    setTimeout(connectBackendLogStreamIfReady, 1500);
  };
}

function connectBackendLogStreamIfReady() {
  // Skip in embedded iframes — only the top-level window manages log connections
  var urlParams = typeof URLSearchParams !== 'undefined' ? new URLSearchParams(window.location.search || '') : null;
  if (urlParams && urlParams.get('embedded') === '1') return;
  if (backendLogEventSource || backendLogConnectPending || !window.LexeraApi || typeof LexeraApi.discover !== 'function') {
    return;
  }
  backendLogConnectPending = true;
  LexeraApi.discover().then(function (url) {
    backendLogConnectPending = false;
    if (!url) {
      traceFrontendAction('warn', 'backend.log.stream', 'Backend discovery returned no URL for log stream; retrying', {});
      setTimeout(connectBackendLogStreamIfReady, 1500);
      return;
    }
    traceFrontendAction('info', 'backend.log.stream', 'Backend discovered for log stream', { url: url });
    var ready = backendLogLoaded ? Promise.resolve() : refreshBackendLogs();
    ready.finally(function () {
      openBackendLogStream();
    });
  }).catch(function (err) {
    logFrontendIssue('warn', 'backend.log.stream', 'Failed to connect backend log stream', err);
    backendLogConnectPending = false;
    setTimeout(connectBackendLogStreamIfReady, 1500);
  });
}

window.connectBackendLogStreamIfReady = connectBackendLogStreamIfReady;
window.setLogBackendConnectionState = setLogBackendConnectionState;

document.addEventListener('click', function (event) {
  var connectionBtn = event.target && event.target.closest ? event.target.closest('.log-panel-status .connection-status-btn') : null;
  if (connectionBtn) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof window.openConnectionWindow === 'function') window.openConnectionWindow();
  }
});

// Intercept console.log/warn/error
(function () {
  var origLog = console.log, origWarn = console.warn, origError = console.error;

  // Noisy vendor messages that fire synchronously INSIDE
  // `innerHTML = ...` or `appendChild(fragment)` when the inserted HTML
  // contains embedded iframes (Miro, particify, etc.) we can't control.
  //
  // Each such message previously cost ~1-2ms of DOM work in our
  // `appendLogEntry` handler (it does `panel.scrollTop =
  // panel.scrollHeight` which forces sync layout on the partially-built
  // board). With 500+ such messages fired during a full board render,
  // that was the ~800ms bottleneck: log spam × forced layout = death.
  //
  // We filter aggressively: only messages from OUR code actually need to
  // reach the log panel. Every pattern here is vendor noise we can't fix.
  var IGNORED_CONSOLE_PATTERNS = [
    // HTML parse warnings from WebKit
    /Error while parsing the ['"]sandbox['"] attribute/i,
    /Invalid sandbox flag/i,
    /Invalid ['"]X-Frame-Options['"] header/i,
    /Viewport argument key ['"]minimal-ui['"] not recognized/i,
    // Source map warnings from vendor bundles (Miro etc.)
    /Source Map.*has invalid ['"]mappings['"]/i,
    /Source Map.*has SyntaxError/i,
    // Source map parse failures — browser fetches a .map file but gets
    // an HTML 404 page back and throws trying to JSON.parse it. These
    // fire from every vendor bundle that ships a `//# sourceMappingURL`
    // comment pointing at a non-existent file.
    /^SyntaxError: Unexpected token '<'/,
    // Stylesheet parse failures from backend file errors
    /Did not parse stylesheet at/i,
    // Resource load failures from vendor iframes
    /Failed to load resource/i,
    // Cross-origin frame errors from embedded iframes
    /Blocked a frame with origin/i,
    // Vendor feature-flag SDK errors
    /\[==FeatureFlagSDK ERROR==\]/,
    // WebGL warnings from vendor content
    /WebGL: non-portable extension/i,
    // Preconnect info messages
    /Successfully preconnected to/i,
    // Sentry / tracking failures from vendor content
    /Failed to fetch org (type|subscription|role) for analytics/i,
    // Miro SPA version / boot messages
    /Loading API configuration/i,
    /API configuration loaded/i,
    /^No updates announced/i,
    /^Version: /,
    /GraphQL error\(s\)/i,
    /CombinedGraphQLErrors/i,
    /\[\/joinRoom\] INTERNAL_ERROR/i,
    // WebKit's "N console messages are not shown" truncation notice —
    // this one means devtools is dropping output, so we should drop
    // it from our log too.
    /\d+ console messages are not shown/i
  ];
  function isIgnoredConsoleMessage(args) {
    if (!args || args.length === 0) return false;
    var first = args[0];
    if (typeof first !== 'string') return false;
    for (var i = 0; i < IGNORED_CONSOLE_PATTERNS.length; i++) {
      if (IGNORED_CONSOLE_PATTERNS[i].test(first)) return true;
    }
    return false;
  }

  console.log = function () {
    if (isIgnoredConsoleMessage(arguments)) return;
    origLog.apply(console, arguments);
    lexeraLogWithTarget('info', 'console.log', joinLogArgs(arguments));
  };
  console.warn = function () {
    if (isIgnoredConsoleMessage(arguments)) return;
    origWarn.apply(console, arguments);
    lexeraLogWithTarget('warn', 'console.warn', joinLogArgs(arguments));
  };
  console.error = function () {
    // For noisy vendor-parse warnings, swallow them entirely. Even calling
    // origError is expensive when Safari devtools is open and receiving
    // hundreds of errors per render, because devtools renders each one.
    if (isIgnoredConsoleMessage(arguments)) return;
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
  var refreshBtn = getElLogRefreshBtn();
  var clearBtn = getElLogClearBtn();
  var sourceBtn = getElLogSourceBtn();
  var sourceMenu = getElLogSourceMenu();
  var levelBtn = getElLogLevelBtn();
  var levelMenu = getElLogLevelMenu();
  updateAppBottomInset();

  // Clicking the log panel header dismisses the error indicator
  var headers = document.querySelectorAll('.log-panel-header');
  for (var hi = 0; hi < headers.length; hi++) {
    headers[hi].addEventListener('click', function () { clearLogPanelErrorIndicator(); });
  }

  if (refreshBtn) refreshBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    refreshBackendLogs();
  });

  var copyBtn = getElLogCopyBtn();
  if (copyBtn) copyBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    copyActiveLogsToClipboard(copyBtn);
  });
  if (clearBtn) clearBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    clearActiveLogEntries();
  });

  if (sourceMenu) renderLogFilterMenu(sourceMenu, 'source');
  if (sourceBtn) sourceBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleLogFilterMenu(sourceMenu, sourceBtn);
  });
  if (levelMenu) renderLogFilterMenu(levelMenu, 'level');
  if (levelBtn) levelBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleLogFilterMenu(levelMenu, levelBtn);
  });

  var searchInput = getElLogSearchInput();
  if (searchInput) {
    searchInput.value = activeLogSearch;
    searchInput.addEventListener('input', function (e) {
      e.stopPropagation();
      setLogSearchFilter(e.target.value);
    });
  }

  // Drain early errors captured before logging system loaded, then
  // disable the early catcher so it doesn't double-fire alongside addEventListener.
  if (window.__lexeraEarlyErrors && window.__lexeraEarlyErrors.length > 0) {
    for (var ei = 0; ei < window.__lexeraEarlyErrors.length; ei++) {
      appendLogEntry('frontend', window.__lexeraEarlyErrors[ei]);
    }
  }
  window.__lexeraEarlyErrors = null;
  window.onerror = null;
  window.onunhandledrejection = null;

  rerenderUnifiedLogEntries();
  applyLogEntryFilters();
  setActiveLogSource(activeLogSource);
  syncAllLogStatusMessages();
  syncAllConnectionStatusButtons();
  connectBackendLogStreamIfReady();
});

/**
 * Gather status data for the folded log strip.
 * Returns { connected, logCount, userCount, inFlightCount }.
 */
function getLogFoldedStatusData() {
  var connected = backendConnectionState;
  var logCount = frontendLogEntries.length + backendLogEntries.length;

  // Board presence: count users on the active board
  var userCount = 0;
  var rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
  if (rt && rt.state) {
    var activeBoardId = rt.state.activeBoardId;
    var cache = rt.state.boardPresenceCache;
    if (activeBoardId && cache && cache[activeBoardId]) {
      userCount = cache[activeBoardId].length;
    }
  }

  // In-flight API calls
  var inFlightCount = 0;
  var api = typeof window !== 'undefined' ? window.LexeraApi : null;
  if (api && typeof api.getInFlightCount === 'function') {
    inFlightCount = api.getInFlightCount();
  }

  return { connected: connected, logCount: logCount, userCount: userCount, inFlightCount: inFlightCount };
}

/**
 * Update all .ws-fold-status-badges elements in the DOM with current data.
 */
function updateFoldedLogStatusBadges() {
  var containers = document.querySelectorAll('.ws-fold-status-badges');
  if (containers.length === 0) return;
  var data = getLogFoldedStatusData();
  for (var i = 0; i < containers.length; i++) {
    var el = containers[i];
    var dotEl = el.querySelector('.ws-fold-status-dot');
    if (dotEl) {
      dotEl.classList.toggle('is-connected', data.connected);
      dotEl.classList.toggle('is-disconnected', !data.connected);
    }
    var connLabel = el.querySelector('.ws-fold-badge-conn');
    if (connLabel) connLabel.textContent = data.connected ? 'Connected' : 'Disconnected';
    var logsBadge = el.querySelector('.ws-fold-badge-logs');
    if (logsBadge) logsBadge.textContent = data.logCount + ' logs';
    var usersBadge = el.querySelector('.ws-fold-badge-users');
    if (usersBadge) {
      usersBadge.textContent = data.userCount + (data.userCount === 1 ? ' user' : ' users');
      usersBadge.style.display = data.userCount > 0 ? '' : 'none';
    }
    var apiBadge = el.querySelector('.ws-fold-badge-api');
    if (apiBadge) {
      apiBadge.textContent = data.inFlightCount + ' pending';
      apiBadge.style.display = data.inFlightCount > 0 ? '' : 'none';
    }
  }
  // Also update fold indicator dots in the fold strip
  var dots = document.querySelectorAll('.ws-fold-dot');
  for (var d = 0; d < dots.length; d++) {
    dots[d].classList.toggle('is-connected', data.connected);
    dots[d].classList.toggle('is-disconnected', !data.connected);
  }
}

window.getLogFoldedStatusData = getLogFoldedStatusData;
window.updateFoldedLogStatusBadges = updateFoldedLogStatusBadges;
window.traceFrontendAction = traceFrontendAction;
window.traceSlowFrontendTask = traceSlowFrontendTask;
window.withSlowFrontendTaskWarning = withSlowFrontendTaskWarning;
window.LexeraLoggingSystem = {
  getEntriesSnapshot: getLogEntriesSnapshot,
  traceSlowFrontendTask: traceSlowFrontendTask,
  withSlowFrontendTaskWarning: withSlowFrontendTaskWarning,
  getSlowTaskThresholdMs: function () { return SLOW_FRONTEND_TASK_THRESHOLD_MS; }
};

var foldedLogRuntime = typeof window !== 'undefined' ? window.LexeraRuntime : null;
if (foldedLogRuntime && typeof foldedLogRuntime.onStateChange === 'function') {
  foldedLogRuntime.onStateChange('activeBoardId', updateFoldedLogStatusBadges);
  foldedLogRuntime.onStateChange('boardPresenceCache', updateFoldedLogStatusBadges);
}

// Listen for events that should trigger fold badge updates
window.addEventListener('lexera-api-inflight-changed', updateFoldedLogStatusBadges);
window.addEventListener('lexera-backend-connection-state-changed', updateFoldedLogStatusBadges);

function toggleLogPanel() {
  setLogPanelVisibility(!isLogPanelVisible());
}

// Ctrl+Shift+L to toggle log
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'L') {
    e.preventDefault();
    toggleLogPanel();
  }
});
