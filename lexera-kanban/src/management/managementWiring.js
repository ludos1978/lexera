/**
 * LexeraManagementWiring — Management UI wiring extracted from app.js.
 *
 * Provides: mgmtApiAdapter, mgmtCallbacks, management panel open/close,
 * management tab activation/persistence, management container resolution,
 * files panel mount, running processes panel, connection window.
 *
 * IIFE module — no const/let, no ES imports.
 */
var LexeraManagementWiring = (function () {
  'use strict';

  // --- Dependencies (injected via init) ---
  var _deps = {};
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

  function _dep(name) {
    return _deps[name];
  }

  function _callDep(name) {
    var fn = _deps[name];
    if (typeof fn === 'function') return fn.apply(null, Array.prototype.slice.call(arguments, 1));
    return undefined;
  }

  // --- State ---
  var mgmtPanelOpen = false;
  var mgmtInitialized = false;
  var filesMountInitialized = false;
  var pendingManagementTabByContext = {
    combinedManagement: 'network',
    backendSettings: 'network',
    files: 'workspaces'
  };

  // --- API adapter ---
  var mgmtApiAdapter = {
    get: function (path, options) { return _callDep('apiRequest', path, options); },
    post: function (path, body) {
      return _callDep('apiRequest', path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    put: function (path, body) {
      return _callDep('apiRequest', path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    delete: function (path) {
      return _callDep('apiRequest', path, { method: 'DELETE' });
    },
  };

  // --- Callbacks ---
  function buildMgmtCallbacks() {
    return {
      openLogStream: function () {
        // In the kanban app, backend logs are handled by loggingSystem.js
        // which manages its own SSE connection lazily. Returning null tells
        // management.js to skip opening a duplicate stream — saves a
        // precious browser connection slot (6 max per origin).
        return null;
      },
      onNotify: function (msg) { _callDep('showNotification', msg); },
      onWorkspacesLoaded: function (workspaceList, defaultWorkspaceId) {
        _callDep('onWorkspacesLoaded', workspaceList, defaultWorkspaceId);
      },
      onConfirm: function (msg) { return _callDep('showConfirmDialog', msg); },
      onBoardAdded: function () { _callDep('poll'); },
      onBoardRemoved: function (boardId) {
        _callDep('onBoardRemoved', boardId);
      },
      onBoardSettingsSaved: function (boardId, settings) {
        _callDep('onBoardSettingsSaved', boardId, settings);
      },
      onServerRestarted: function () {},
    };
  }

  var mgmtCallbacks = null; // built lazily after init

  // --- Container helpers ---

  function getManagementUiContainer() {
    if (_dep('workspaceShellEnabled')) {
      return _callDep('getElLogSettingsContainer');
    }
    return _callDep('getElMgmtPanelBody');
  }

  function getBackendSettingsManagementContainer() {
    if (_dep('workspaceShellEnabled')) return _callDep('getElLogSettingsContainer');
    return _callDep('getElMgmtPanelBody');
  }

  function getFilesManagementContainer() {
    if (!_dep('workspaceShellEnabled')) return _callDep('getElMgmtPanelBody');
    return document.querySelector('[data-shell-panel="files"] .lexera-shared-files-container') ||
      document.querySelector('.lexera-shared-files-container');
  }

  function getManagementContainerForContext(contextName) {
    if (contextName === 'files') return getFilesManagementContainer();
    if (contextName === 'backendSettings') return getBackendSettingsManagementContainer();
    return _callDep('getElMgmtPanelBody');
  }

  // --- ManagementUI method helpers ---

  function requireManagementUiMethod(name) {
    var ManagementUI = typeof window !== 'undefined' ? window.ManagementUI : undefined;
    if (!ManagementUI || typeof ManagementUI[name] !== 'function') {
      throw new Error('ManagementUI.' + name + ' is required. Sync runtime assets from lexera-shared.');
    }
    return ManagementUI[name];
  }

  function getManagementUiPreset(name) {
    return requireManagementUiMethod('getUiPreset')(name);
  }

  function getManagementSurfaceId(sectionName) {
    return requireManagementUiMethod('getSurfaceIdForSection')(sectionName);
  }

  function getManagementTopTab(sectionName, contextName) {
    return requireManagementUiMethod('getTopTabForContext')(sectionName, contextName);
  }

  // --- Tab activation ---

  function activateManagementTabInContainer(container, tabName) {
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

  function rememberManagementTab(contextName, tabName) {
    if (!contextName || !tabName) return;
    pendingManagementTabByContext[contextName] = tabName;
  }

  function applyPendingManagementTab(contextName, container) {
    var tabName = pendingManagementTabByContext[contextName];
    if (!tabName) return;
    activateManagementTabInContainer(container || getManagementContainerForContext(contextName), tabName);
  }

  // --- Init / mount ---

  function getEmbeddedManagementUiOptions() {
    if (_dep('workspaceShellEnabled')) return getManagementUiPreset('backendConfig');
    return getManagementUiPreset('combinedManagement');
  }

  function initManagementUI() {
    var managementContainer = getManagementUiContainer();
    if (mgmtInitialized || !managementContainer) {
      if (typeof traceFrontendAction === 'function') {
        traceFrontendAction('debug', 'mgmt.init', 'initManagementUI skipped', {
          initialized: mgmtInitialized,
          hasContainer: !!managementContainer
        });
      }
      return;
    }
    var ManagementUI = typeof window !== 'undefined' ? window.ManagementUI : undefined;
    if (typeof ManagementUI === 'undefined' || !ManagementUI) {
      if (typeof traceFrontendAction === 'function') {
        traceFrontendAction('warn', 'mgmt.init', 'ManagementUI not loaded yet — deferring init');
      }
      setTimeout(initManagementUI, 500);
      return;
    }
    mgmtInitialized = true;
    try {
      ManagementUI.init({
        container: managementContainer,
        ui: getEmbeddedManagementUiOptions(),
        api: mgmtApiAdapter,
        callbacks: mgmtCallbacks,
      });
    } catch (err) {
      if (typeof logFrontendIssue === 'function') {
        logFrontendIssue('error', 'mgmt.init', 'ManagementUI.init failed', err);
      }
      mgmtInitialized = false;
      return;
    }
    // Don't remove view-loading here — ManagementUI.loadAllForMounts() removes
    // it after data actually loads from the backend.
    applyPendingManagementTab(_dep('workspaceShellEnabled') ? 'backendSettings' : 'combinedManagement', managementContainer);
  }

  function initFilesPanelMount(container) {
    if (!container) return;
    var ManagementUI = typeof window !== 'undefined' ? window.ManagementUI : undefined;
    if (!ManagementUI || typeof ManagementUI.mount !== 'function') {
      // ManagementUI not loaded yet — retry shortly
      setTimeout(function () { initFilesPanelMount(container); }, 300);
      return;
    }
    try {
      ManagementUI.mount('files', {
        container: container,
        ui: getManagementUiPreset('files'),
        api: mgmtApiAdapter,
        callbacks: mgmtCallbacks,
      });
    } catch (err) {
      if (typeof logFrontendIssue === 'function') {
        logFrontendIssue('error', 'mgmt.files', 'Files panel mount failed', err);
      }
      // Remove loading state so user sees the error state, not infinite spinner
      if (_rt) _rt.setViewLoading(container, false);
    }
    filesMountInitialized = true;
    applyPendingManagementTab('files', container);
  }

  // --- Open / close ---

  function openManagementPanel(options) {
    options = options || {};
    mgmtPanelOpen = true;
    var wsEnabled = _dep('workspaceShellEnabled');
    var targetContext = wsEnabled
      ? getManagementSurfaceId(options.section)
      : 'combinedManagement';
    var preferredTab = getManagementTopTab(options.section, targetContext);
    rememberManagementTab(targetContext, preferredTab);
    var WorkspaceShell = _dep('WorkspaceShell');
    if (wsEnabled && WorkspaceShell && typeof WorkspaceShell.revealPanel === 'function') {
      runInitManagementUI();
      WorkspaceShell.revealPanel(targetContext);
      applyPendingManagementTab(targetContext);
      return;
    }
    runInitManagementUI();
    applyPendingManagementTab('combinedManagement');
    var mgmtPanel = _callDep('getElMgmtPanel');
    if (mgmtPanel) mgmtPanel.classList.add('open');
  }

  function runInitManagementUI() {
    if (mgmtInitialized) return;
    initManagementUI();
  }

  function closeManagementPanel() {
    mgmtPanelOpen = false;
    var mgmtPanel = _callDep('getElMgmtPanel');
    if (mgmtPanel) mgmtPanel.classList.remove('open');
  }

  function openConnectionWindow() {
    openManagementPanel({ section: 'network' });
  }

  function openRunningProcessesPanel() {
    if (typeof setActiveLogSource === 'function') setActiveLogSource('backend');
    var panel = _callDep('getElLogPanel');
    if (panel) panel.classList.remove('hidden');
    if (typeof updateAppBottomInset === 'function') updateAppBottomInset();
  }

  // --- Window event wiring ---

  function wireWindowEvents() {
    if (typeof window === 'undefined') return;
    window.initManagementUI = initManagementUI;
    if (typeof isLogPanelVisible === 'function' && isLogPanelVisible()) initManagementUI();
    window.addEventListener('lexera-shared-panel-created', function (event) {
      if (!event.detail) return;
      var el = event.detail.element;
      if (event.detail.kind === 'backendSettings' && el) {
        var container = el.querySelector('.lexera-shared-backend-settings-container');
        if (container) {
          _callDep('setElLogSettingsContainer', container);
          _callDep('setElLogSettingsPane', el);
          mgmtInitialized = false;
          initManagementUI();
        }
      }
      if (event.detail.kind === 'files' && el) {
        var container = el.querySelector('.lexera-shared-files-container');
        if (container) {
          initFilesPanelMount(container);
        }
      }
      if (event.detail.kind === 'frontendSettings') {
        _callDep('initFrontendSettingsPanel', event.detail.element);
      }
      if (event.detail.kind === 'renderApps') {
        _callDep('initRenderAppsPanel', event.detail.element);
      }
    });
    window.openConnectionWindow = openConnectionWindow;
  }

  // --- Init ---

  function init(deps) {
    _deps = deps || {};
    _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
    mgmtCallbacks = buildMgmtCallbacks();
    wireWindowEvents();
  }

  // --- Delayed panel init (called from app.js after DOMContentLoaded + delay) ---

  function initDelayedPanels() {
    var existingFilesContainer = document.querySelector('.lexera-shared-files-container');
    if (existingFilesContainer && !filesMountInitialized) initFilesPanelMount(existingFilesContainer);
    var existingBackendContainer = document.querySelector('.lexera-shared-backend-settings-container');
    if (existingBackendContainer && !mgmtInitialized) {
      _callDep('setElLogSettingsContainer', existingBackendContainer);
      initManagementUI();
    }
  }

  // --- SSE event forwarding ---

  function handleSSEManagementEvent(kind) {
    var ManagementUI = typeof window !== 'undefined' ? window.ManagementUI : undefined;
    if (typeof ManagementUI === 'undefined' || !mgmtInitialized) return false;
    if (kind === 'CollabConnectionChanged') { ManagementUI.refresh('connections'); return true; }
    if (kind === 'PeerDiscoveryChanged') { ManagementUI.refresh('peers'); return true; }
    if (kind === 'ConfigChanged') { ManagementUI.refresh(); return true; }
    return false;
  }

  return {
    init: init,
    initManagementUI: initManagementUI,
    runInitManagementUI: runInitManagementUI,
    requireManagementUiMethod: requireManagementUiMethod,
    getManagementUiPreset: getManagementUiPreset,
    getManagementSurfaceId: getManagementSurfaceId,
    getManagementTopTab: getManagementTopTab,
    activateManagementTabInContainer: activateManagementTabInContainer,
    applyPendingManagementTab: applyPendingManagementTab,
    rememberManagementTab: rememberManagementTab,
    getManagementContainerForContext: getManagementContainerForContext,
    getManagementUiContainer: getManagementUiContainer,
    getBackendSettingsManagementContainer: getBackendSettingsManagementContainer,
    getFilesManagementContainer: getFilesManagementContainer,
    initFilesPanelMount: initFilesPanelMount,
    openManagementPanel: openManagementPanel,
    closeManagementPanel: closeManagementPanel,
    openConnectionWindow: openConnectionWindow,
    openRunningProcessesPanel: openRunningProcessesPanel,
    initDelayedPanels: initDelayedPanels,
    handleSSEManagementEvent: handleSSEManagementEvent,
    getMgmtPanelOpen: function () { return mgmtPanelOpen; },
    getMgmtInitialized: function () { return mgmtInitialized; },
    getFilesMountInitialized: function () { return filesMountInitialized; },
    getMgmtApiAdapter: function () { return mgmtApiAdapter; },
  };
})();

if (typeof globalThis !== 'undefined') globalThis.LexeraManagementWiring = LexeraManagementWiring;
if (typeof window !== 'undefined') window.LexeraManagementWiring = LexeraManagementWiring;
