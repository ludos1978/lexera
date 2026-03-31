(function () {
  'use strict';

  var baseUrl = '';
  var initialBackendUrl = '';
  var discoveryRetryTimer = null;
  var isInitializing = false;
  var sseSource = null;
  var bearerToken = null;
  var bearerTokenPromise = null;
  var fallbackConnectionsInterval = null;
  var fallbackPeersInterval = null;
  var shellMounted = false;
  var shellPanels = null;
  var initialUiState = {
    section: '',
    panelId: 'backendSettings'
  };

  if (typeof applyLexeraTheme === 'function') {
    applyLexeraTheme('lexera');
  }

  function requireManagementUiMethod(name) {
    if (!ManagementUI || typeof ManagementUI[name] !== 'function') {
      throw new Error('ManagementUI.' + name + ' is required. Sync runtime assets from lexera-shared.');
    }
    return ManagementUI[name];
  }

  function requireBackendDiscoveryMethod(name) {
    var discovery = window.LexeraBackendDiscovery;
    if (!discovery || typeof discovery[name] !== 'function') {
      throw new Error('LexeraBackendDiscovery.' + name + ' is required. Sync runtime assets from lexera-shared.');
    }
    return discovery[name].bind(discovery);
  }

  function requireShellMethod(name) {
    var shell = window.LexeraWorkspaceShell;
    if (!shell || typeof shell[name] !== 'function') {
      throw new Error('LexeraWorkspaceShell.' + name + ' is required. Sync frontend view assets.');
    }
    return shell[name].bind(shell);
  }

  function requireSharedPanelsMethod(name) {
    var sharedPanels = window.LexeraSharedPanels;
    if (!sharedPanels || typeof sharedPanels[name] !== 'function') {
      throw new Error('LexeraSharedPanels.' + name + ' is required. Sync frontend view assets.');
    }
    return sharedPanels[name].bind(sharedPanels);
  }

  function getManagementUiPreset(name) {
    return requireManagementUiMethod('getUiPreset')(name);
  }

  function resolvePanelId(value) {
    var normalized = String(value || '').trim();
    if (!normalized) return 'backendSettings';
    if (normalized === 'logs') return 'logs';
    if (normalized === 'files' || normalized === 'workspaces' || normalized === 'boards' || normalized === 'sharing') {
      return 'files';
    }
    return 'backendSettings';
  }

  function getManagementTopTab(sectionName, panelId) {
    var contextName = panelId === 'files' ? 'files' : 'backendSettings';
    return requireManagementUiMethod('getTopTabForContext')(sectionName, contextName);
  }

  function createShellPanels() {
    if (shellPanels) return shellPanels;
    var createPanelElement = requireSharedPanelsMethod('createPanelElement');
    var panels = {
      logs: createPanelElement('logs', 'logs'),
      backendSettings: createPanelElement('backendSettings', 'backendSettings'),
      files: createPanelElement('files', 'files')
    };
    panels.logs.setAttribute('data-shell-panel', 'logs');
    panels.backendSettings.setAttribute('data-shell-panel', 'backendSettings');
    panels.files.setAttribute('data-shell-panel', 'files');
    shellPanels = panels;
    return shellPanels;
  }

  function getBackendSettingsContainer() {
    var panels = createShellPanels();
    return panels.backendSettings
      ? panels.backendSettings.querySelector('.lexera-shared-backend-settings-container')
      : null;
  }

  function getFilesContainer() {
    var panels = createShellPanels();
    return panels.files ? panels.files.querySelector('.lexera-shared-files-container') : null;
  }

  function activateManagementTopTab(panelId, tabName) {
    if (!tabName || panelId === 'logs') return;
    var container = panelId === 'files' ? getFilesContainer() : getBackendSettingsContainer();
    var normalizedTab = getManagementTopTab(tabName, panelId);
    if (!container || !normalizedTab) return;
    var topTab = container.querySelector('.mgmt-top-tab[data-mgmt-top-tab="' + normalizedTab + '"]');
    if (topTab) topTab.click();
  }

  function applyInitialUiState() {
    if (!shellMounted) return;
    var targetPanelId = resolvePanelId(initialUiState.section || initialUiState.panelId);
    requireShellMethod('revealPanel')(targetPanelId);
    if (initialUiState.section) activateManagementTopTab(targetPanelId, initialUiState.section);
  }

  function mountManagementShell() {
    if (shellMounted) return;
    var panels = createShellPanels();
    requireShellMethod('mount')({
      getMainContent: function () {
        return document.getElementById('main-content');
      },
      getPersistenceKey: function () {
        return 'lexera-backend-management-shell';
      },
      getAllowedPanelKinds: function () {
        return ['logs', 'backendSettings', 'files'];
      },
      getPanelElements: function () {
        return panels;
      }
    });
    shellMounted = true;

    if (!requireShellMethod('didRestoreState')()) {
      requireShellMethod('openPanelInCenter')('backendSettings');
      requireShellMethod('openPanelInCenter')('files', { groupWith: 'backendSettings' });
      requireShellMethod('setPanelVisibility')('logs', true, { activate: false });
      requireShellMethod('movePanelToDock')('logs', 'bottom');
      requireShellMethod('restoreDock')('bottom', 'logs');
    }

    applyInitialUiState();
  }

  function resetBackendAuth() {
    bearerToken = null;
    bearerTokenPromise = null;
  }

  function authHeaders(existing) {
    if (!bearerToken) return Object.assign({}, existing || {});
    return Object.assign({}, existing || {}, {
      Authorization: 'Bearer ' + bearerToken
    });
  }

  function appendAuthTokenQuery(url) {
    if (!url || !bearerToken) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'auth_token=' + encodeURIComponent(bearerToken);
  }

  async function parseJsonResponse(res) {
    var text = await res.text().catch(function () { return res.statusText || ''; });
    if (!res.ok) throw new Error(res.status + ': ' + (text || res.statusText || 'Request failed'));
    return text ? JSON.parse(text) : null;
  }

  async function ensureBearerToken(forceRefresh) {
    if (!baseUrl) throw new Error('Backend unavailable');
    if (forceRefresh) resetBackendAuth();
    if (bearerToken) return bearerToken;
    if (bearerTokenPromise) return bearerTokenPromise;

    bearerTokenPromise = (async function () {
      try {
        var res = await fetch(baseUrl + '/collab/me');
        var data = await parseJsonResponse(res);
        if (!data || typeof data.token !== 'string' || !data.token) {
          throw new Error('Backend did not return an auth token');
        }
        bearerToken = data.token;
        return bearerToken;
      } finally {
        bearerTokenPromise = null;
      }
    })();

    return bearerTokenPromise;
  }

  async function discoverBackend() {
    return requireBackendDiscoveryMethod('discoverBackend')({
      preferredUrl: initialBackendUrl,
      useTauri: true,
      timeoutMs: 1200
    });
  }

  async function apiRequest(path, options) {
    if (!baseUrl) throw new Error('Backend unavailable');
    options = options || {};

    if (path !== '/collab/me') {
      await ensureBearerToken();
    }

    var fetchOptions = Object.assign({}, options);
    fetchOptions.headers = authHeaders(fetchOptions.headers);

    var res = await fetch(baseUrl + path, fetchOptions);
    if (res.status === 401 && path !== '/collab/me') {
      await ensureBearerToken(true);
      fetchOptions.headers = authHeaders(options.headers);
      res = await fetch(baseUrl + path, fetchOptions);
    }

    return parseJsonResponse(res);
  }

  function apiGet(path) {
    return apiRequest(path);
  }

  function apiPost(path, body) {
    return apiRequest(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function apiPut(path, body) {
    return apiRequest(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function apiDelete(path) {
    return apiRequest(path, { method: 'DELETE' });
  }

  function syncWindowLexeraApi() {
    window.LexeraApi = {
      discover: async function () {
        if (baseUrl) return baseUrl;
        var discovered = await discoverBackend();
        if (discovered) {
          if (baseUrl !== discovered) resetBackendAuth();
          baseUrl = discovered;
        }
        return baseUrl || null;
      },
      getLogs: function () {
        return apiGet('/logs');
      },
      connectLogStream: function (onEntry) {
        if (!baseUrl) return null;
        var es = new EventSource(baseUrl + '/logs/stream');
        es.onmessage = function (event) {
          if (!onEntry) return;
          try {
            onEntry(JSON.parse(event.data));
          } catch (_) {}
        };
        return es;
      }
    };
  }

  function getManagementApiAdapter() {
    return {
      get: apiGet,
      post: apiPost,
      put: apiPut,
      delete: apiDelete
    };
  }

  function openLogStream(onEntry, onOpen, onError) {
    if (!window.LexeraApi || typeof window.LexeraApi.connectLogStream !== 'function') return null;
    var es = window.LexeraApi.connectLogStream(onEntry);
    if (!es) return null;
    es.onopen = function (event) {
      if (onOpen) onOpen(event);
    };
    es.onerror = function (event) {
      if (onError) onError(event);
    };
    return es;
  }

  function getManagementCallbacks() {
    return {
      openLogStream: openLogStream,
      onNotify: function (msg) {
        console.info('[management]', msg);
      },
      onConfirm: function (msg) {
        return Promise.resolve(window.confirm(msg));
      },
      onServerRestarted: function (bindAddr, port) {
        var host = bindAddr === '0.0.0.0' ? '127.0.0.1' : bindAddr;
        baseUrl = 'http://' + host + ':' + port;
        resetBackendAuth();
        syncWindowLexeraApi();
        if (typeof window.setLogBackendConnectionState === 'function') {
          window.setLogBackendConnectionState(true);
        }
      }
    };
  }

  function clearFallbackPolling() {
    if (fallbackConnectionsInterval) {
      clearInterval(fallbackConnectionsInterval);
      fallbackConnectionsInterval = null;
    }
    if (fallbackPeersInterval) {
      clearInterval(fallbackPeersInterval);
      fallbackPeersInterval = null;
    }
  }

  function startFallbackPolling() {
    if (!fallbackConnectionsInterval) {
      fallbackConnectionsInterval = setInterval(function () { ManagementUI.refresh('connections'); }, 10000);
    }
    if (!fallbackPeersInterval) {
      fallbackPeersInterval = setInterval(function () { ManagementUI.refresh('peers'); }, 5000);
    }
  }

  async function connectSSE() {
    if (sseSource) {
      sseSource.close();
      sseSource = null;
    }
    clearFallbackPolling();
    try {
      await ensureBearerToken();
    } catch (_) {
      startFallbackPolling();
      return;
    }
    sseSource = new EventSource(appendAuthTokenQuery(baseUrl + '/events'));
    sseSource.onmessage = function (e) {
      try {
        var event = JSON.parse(e.data);
        if (event.type === 'CollabConnectionChanged') ManagementUI.refresh('connections');
        else if (event.type === 'PeerDiscoveryChanged') ManagementUI.refresh('peers');
        else if (event.type === 'ConfigChanged') ManagementUI.refresh();
      } catch (_) {}
    };
    sseSource.onerror = function () {
      if (sseSource) {
        sseSource.close();
        sseSource = null;
      }
      startFallbackPolling();
    };
  }

  function scheduleDiscoveryRetry() {
    if (discoveryRetryTimer) return;
    discoveryRetryTimer = setTimeout(async function () {
      discoveryRetryTimer = null;
      await ensureBackendConnection('retry');
    }, 2000);
  }

  async function ensureBackendConnection() {
    if (isInitializing) return;
    isInitializing = true;
    try {
      var discovered = await discoverBackend();
      if (!discovered) {
        baseUrl = '';
        resetBackendAuth();
        syncWindowLexeraApi();
        if (typeof window.setLogBackendConnectionState === 'function') {
          window.setLogBackendConnectionState(false);
        }
        scheduleDiscoveryRetry();
        return;
      }

      if (baseUrl !== discovered) resetBackendAuth();
      baseUrl = discovered;
      if (discoveryRetryTimer) {
        clearTimeout(discoveryRetryTimer);
        discoveryRetryTimer = null;
      }
      syncWindowLexeraApi();
      mountManagementShell();

      ManagementUI.init({
        container: getBackendSettingsContainer(),
        ui: getManagementUiPreset('backendConfig'),
        api: getManagementApiAdapter(),
        callbacks: getManagementCallbacks()
      });
      ManagementUI.mount('files', {
        container: getFilesContainer(),
        ui: getManagementUiPreset('files'),
        api: getManagementApiAdapter(),
        callbacks: getManagementCallbacks()
      });

      if (typeof window.setLogBackendConnectionState === 'function') {
        window.setLogBackendConnectionState(true);
      }
      applyInitialUiState();
      connectSSE();
    } finally {
      isInitializing = false;
    }
  }

  window.openConnectionWindow = function (options) {
    var hasSection = !!(options && Object.prototype.hasOwnProperty.call(options, 'section'));
    var hasPanel = !!(options && Object.prototype.hasOwnProperty.call(options, 'panel'));
    var section = hasSection ? String(options.section || '') : '';
    var panelId = resolvePanelId(section || (hasPanel ? options.panel : 'backendSettings'));
    initialUiState.section = section;
    initialUiState.panelId = panelId;
    if (shellMounted) applyInitialUiState();
    try { window.focus(); } catch (_) {}
    return Promise.resolve(true);
  };

  try {
    var params = new URLSearchParams(window.location.search || '');
    initialBackendUrl = params.get('backend') || '';
    initialUiState.section = params.get('section') || '';
    initialUiState.panelId = resolvePanelId(
      params.get('panel') ||
      params.get('surface') ||
      initialUiState.section ||
      'backendSettings'
    );
  } catch (_) {
    initialBackendUrl = '';
    initialUiState.section = '';
    initialUiState.panelId = 'backendSettings';
  }

  syncWindowLexeraApi();
  ensureBackendConnection();
})();
