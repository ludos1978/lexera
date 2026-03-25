/**
 * Lexera Log — Status bar + dedicated frontend/backend log views.
 */
var frontendLogEntries = [];
var backendLogEntries = [];
var LOG_MAX = 1000;
var storedLogSource = (function () { try { return localStorage.getItem('lexera-log-source'); } catch (_) { return null; } })();
var activeLogSource = storedLogSource === 'backend' ? 'backend' : 'frontend';
var backendLogLoaded = false;
var backendLogEventSource = null;
var backendLogConnectPending = false;
var backendLogEmptySnapshotRetries = 0;
var backendConnectionState = false;
var lastStatusText = '';
var lastStatusLevel = '';
var FRONTEND_BUILD_STAMP = '20260305-1528-remote-join-persistence';

var elStatusMsg = null;
var elLogEntriesBackend = null;
var elLogEntriesFrontend = null;
var elLogPanel = null;
var elLogSettingsPane = null;
var elLogSettingsContainer = null;
var elLogTabBackend = null;
var elLogTabFrontend = null;
var elLogRefreshBtn = null;
var elLogCopyBtn = null;
var elLogClearBtn = null;

function getElStatusMsg() { return elStatusMsg || (elStatusMsg = document.getElementById('status-msg')); }
function getElLogEntriesBackend() { return elLogEntriesBackend || (elLogEntriesBackend = document.getElementById('log-entries-backend')); }
function getElLogEntriesFrontend() { return elLogEntriesFrontend || (elLogEntriesFrontend = document.getElementById('log-entries-frontend')); }
function getElLogPanel() { return elLogPanel || (elLogPanel = document.getElementById('log-panel')); }
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
function getElLogTabBackend() { return elLogTabBackend || (elLogTabBackend = document.getElementById('log-tab-backend')); }
function getElLogTabFrontend() { return elLogTabFrontend || (elLogTabFrontend = document.getElementById('log-tab-frontend')); }
function getElLogRefreshBtn() { return elLogRefreshBtn || (elLogRefreshBtn = document.getElementById('log-refresh-btn')); }
function getElLogCopyBtn() { return elLogCopyBtn || (elLogCopyBtn = document.getElementById('log-copy-btn')); }
function getElLogClearBtn() { return elLogClearBtn || (elLogClearBtn = document.getElementById('log-clear-btn')); }

function getSharedLogRoots() {
  var registry = window.LexeraSharedPanels;
  if (!registry || typeof registry.getRoots !== 'function') return [];
  return registry.getRoots('logs');
}

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
      backendTab: root.querySelector('.lexera-shared-log-tab-backend'),
      frontendTab: root.querySelector('.lexera-shared-log-tab-frontend'),
      statsTab: root.querySelector('.lexera-shared-log-tab-stats'),
      refreshBtn: root.querySelector('.lexera-shared-log-refresh'),
      copyBtn: root.querySelector('.lexera-shared-log-copy'),
      clearBtn: root.querySelector('.lexera-shared-log-clear'),
      titleEl: root.querySelector('.log-panel-title'),
      tabsEl: root.querySelector('.log-panel-tabs'),
      backendEntries: root.querySelector('.lexera-shared-log-entries-backend'),
      frontendEntries: root.querySelector('.lexera-shared-log-entries-frontend'),
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
      replaceLogEntries(activeLogSource, []);
    });
  }
  if (view.backendTab) {
    view.backendTab.addEventListener('click', function (e) {
      e.stopPropagation();
      setActiveLogSource('backend');
    });
  }
  if (view.frontendTab) {
    view.frontendTab.addEventListener('click', function (e) {
      e.stopPropagation();
      setActiveLogSource('frontend');
    });
  }
  if (view.statsTab) {
    view.statsTab.addEventListener('click', function (e) {
      e.stopPropagation();
      setActiveLogSource('stats');
    });
  }
}

function syncMirroredLogViews() {
  var backendHtml = getElLogEntriesBackend() ? getElLogEntriesBackend().innerHTML : '';
  var frontendHtml = getElLogEntriesFrontend() ? getElLogEntriesFrontend().innerHTML : '';
  var statsPanel = document.getElementById('log-entries-stats');
  var statsHtml = statsPanel ? statsPanel.innerHTML : '';
  var canonicalTabs = document.querySelector('.log-panel-tabs');
  var titleText = document.querySelector('.log-panel-title') ? document.querySelector('.log-panel-title').textContent : 'Logs';
  var mirroredViews = getMirroredLogViews();
  for (var i = 0; i < mirroredViews.length; i++) {
    var view = mirroredViews[i];
    bindMirroredLogView(view);
    if (view.backendEntries) view.backendEntries.innerHTML = backendHtml;
    if (view.frontendEntries) view.frontendEntries.innerHTML = frontendHtml;
    if (view.statsEntries) view.statsEntries.innerHTML = statsHtml;
    if (view.backendTab) view.backendTab.classList.toggle('active', activeLogSource === 'backend');
    if (view.frontendTab) view.frontendTab.classList.toggle('active', activeLogSource === 'frontend');
    if (view.statsTab) view.statsTab.classList.toggle('active', activeLogSource === 'stats');
    if (view.backendEntries) view.backendEntries.classList.toggle('hidden', activeLogSource !== 'backend');
    if (view.frontendEntries) view.frontendEntries.classList.toggle('hidden', activeLogSource !== 'frontend');
    if (view.statsEntries) view.statsEntries.classList.toggle('hidden', activeLogSource !== 'stats');
    if (view.refreshBtn) view.refreshBtn.style.display = activeLogSource === 'backend' ? '' : 'none';
    if (view.titleEl) view.titleEl.textContent = titleText;
    if (view.tabsEl) view.tabsEl.style.display = canonicalTabs ? canonicalTabs.style.display : '';
  }
  syncAllLogStatusMessages();
  syncAllConnectionStatusButtons();
}

window.addEventListener('lexera-shared-panel-created', function (event) {
  var detail = event && event.detail ? event.detail : {};
  if (detail.kind === 'logs') syncMirroredLogViews();
});

window.addEventListener('storage', function (event) {
  if (!event || event.key !== 'lexera-log-source') return;
  setActiveLogSource(event.newValue === 'backend' ? 'backend' : (event.newValue === 'stats' ? 'stats' : 'frontend'));
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
    if (!msgEl) {
      msgEl = document.createElement('span');
      msgEl.className = 'log-panel-error-msg';
      header.appendChild(msgEl);
    }
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
  el.innerHTML =
    '<span class="log-time">' + escapeLogHtml(formatLogTimestamp(entry)) + '</span>' +
    '<span class="log-level">' + escapeLogHtml(String(entry.level || '').toUpperCase()) + '</span>' +
    '<span class="log-entry-source">' + escapeLogHtml(source) + '</span>' +
    '<span class="log-entry-target">' + escapeLogHtml(entry.target || (source === 'backend' ? 'backend' : 'frontend')) + '</span>' +
    '<span class="log-msg">' + escapeLogHtml(entry.message) + '</span>';
  return el;
}

function syncLogCount() {
  var entries = getLogEntries(activeLogSource);
  var titles = document.querySelectorAll('.log-panel-title');
  var label = activeLogSource === 'backend' ? 'Backend' : activeLogSource === 'stats' ? 'Stats' : 'Frontend';
  var text = 'Logs \u00B7 ' + label + ' (' + entries.length + ')';
  for (var i = 0; i < titles.length; i++) titles[i].textContent = text;
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

  entries.push(entry);
  if (entries.length > LOG_MAX) entries.shift();

  setStatusBarEntry(source, entry);

  if (entry.level === 'error') {
    showLogPanelErrorIndicator(entry.message || 'Unknown error');
  }

  var panel = getLogContainer(source);
  if (panel) {
    while (panel.childNodes.length >= LOG_MAX) {
      panel.removeChild(panel.firstChild);
    }
    panel.appendChild(renderLogEntry(source, entry));
    panel.scrollTop = panel.scrollHeight;
  }
  if (source === activeLogSource) syncLogCount();
  syncMirroredLogViews();
}

function updateLastLogEntryRepeat(source, entry) {
  var panel = getLogContainer(source);
  if (!panel) return;
  var lastEl = panel.lastElementChild;
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
  if (source === activeLogSource) syncLogCount();
  syncMirroredLogViews();
}

function copyActiveLogsToClipboard(copyBtn) {
  var entries = getLogEntries(activeLogSource);
  var text = entries.map(function (entry) {
    var ts = formatLogTimestamp(entry);
    var level = String(entry.level || '').toUpperCase();
    var target = entry.target || activeLogSource;
    return ts + ' ' + level + ' [' + target + '] ' + (entry.message || '');
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
  if (source !== 'frontend' && source !== 'stats') source = 'backend';
  activeLogSource = source;
  localStorage.setItem('lexera-log-source', activeLogSource);

  var backendBtn = getElLogTabBackend();
  var frontendBtn = getElLogTabFrontend();
  var backendPanel = getLogContainer('backend');
  var frontendPanel = getLogContainer('frontend');
  var statsPanel = document.getElementById('log-entries-stats');
  var refreshBtn = getElLogRefreshBtn();

  var statsBtn = document.getElementById('log-tab-stats');
  if (backendBtn) backendBtn.classList.toggle('active', activeLogSource === 'backend');
  if (frontendBtn) frontendBtn.classList.toggle('active', activeLogSource === 'frontend');
  if (statsBtn) statsBtn.classList.toggle('active', activeLogSource === 'stats');
  if (backendPanel) backendPanel.classList.toggle('hidden', activeLogSource !== 'backend');
  if (frontendPanel) frontendPanel.classList.toggle('hidden', activeLogSource !== 'frontend');
  if (statsPanel) statsPanel.classList.toggle('hidden', activeLogSource !== 'stats');
  if (refreshBtn) refreshBtn.style.display = activeLogSource === 'backend' ? '' : 'none';
  syncLogCount();
  syncMirroredLogViews();
}

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
  if (visible) clearLogPanelErrorIndicator();
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
  var refreshBtn = getElLogRefreshBtn();
  var clearBtn = getElLogClearBtn();
  var backendTab = getElLogTabBackend();
  var frontendTab = getElLogTabFrontend();
  updateAppBottomInset();

  // Status bar tab handlers are set up in init() where toggleBoardStatsBar is accessible

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
    replaceLogEntries(activeLogSource, []);
  });
  if (backendTab) backendTab.addEventListener('click', function (e) {
    e.stopPropagation();
    setActiveLogSource('backend');
  });
  if (frontendTab) frontendTab.addEventListener('click', function (e) {
    e.stopPropagation();
    setActiveLogSource('frontend');
  });
  var statsTab = document.getElementById('log-tab-stats');
  if (statsTab) statsTab.addEventListener('click', function (e) {
    e.stopPropagation();
    setActiveLogSource('stats');
  });

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

  replaceLogEntries('frontend', frontendLogEntries);
  replaceLogEntries('backend', backendLogEntries);
  setActiveLogSource(activeLogSource);
  syncAllLogStatusMessages();
  syncAllConnectionStatusButtons();
  connectBackendLogStreamIfReady();
});

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
