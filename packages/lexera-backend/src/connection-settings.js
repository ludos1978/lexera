/**
 * Management window bootstrap for lexera-backend.
 *
 * This file handles backend discovery and initializes the shared ManagementUI
 * module with the appropriate API adapter. All management UI content is
 * rendered by the shared module (management.js from lexera-shared).
 */
(function () {
  'use strict';

  var baseUrl = '';
  var initialBackendUrl = '';
  var discoveryRetryTimer = null;
  var isInitializing = false;
  var discoveryAttemptCount = 0;
  var sseSource = null;
  var fallbackConnectionsInterval = null;
  var fallbackPeersInterval = null;
  var BackendDiscovery = window.LexeraBackendDiscovery || null;
  var SURFACE_STORAGE_KEY = 'lexera-backend-management-surface';
  var MANAGEMENT_SURFACES = {
    backendSettings: {
      containerId: 'management-container',
      preset: 'backendSettings'
    },
    files: {
      containerId: 'files-management-container',
      preset: 'files'
    }
  };
  var activeSurfaceId = 'backendSettings';
  var initialUiState = {
    surfaceId: 'backendSettings',
    section: ''
  };

  // Apply theme immediately from localStorage to avoid flash of wrong theme
  if (typeof applyLexeraTheme === 'function') {
    applyLexeraTheme(localStorage.getItem('lexera-theme') || 'lexera');
  }

  function getManagementUiPreset(name) {
    if (ManagementUI && typeof ManagementUI.getUiPreset === 'function') {
      return ManagementUI.getUiPreset(name);
    }
    if (name === 'files') {
      return {
        topTabs: ['workspaces', 'boards'],
        defaultTopTab: 'workspaces',
        themeEnabled: false
      };
    }
    return {
      topTabs: ['network', 'config', 'logs'],
      defaultTopTab: 'network',
      themeEnabled: false
    };
  }

  function isKnownSurface(surfaceId) {
    return !!(surfaceId && MANAGEMENT_SURFACES[surfaceId]);
  }

  function resolveSurfaceId(sectionOrSurface) {
    if (isKnownSurface(sectionOrSurface)) return sectionOrSurface;
    if (sectionOrSurface === 'sharing' || sectionOrSurface === 'workspaces' || sectionOrSurface === 'boards') {
      return 'files';
    }
    return 'backendSettings';
  }

  function normalizeRequestedTab(tabName) {
    if (tabName === 'sharing') return 'workspaces';
    return tabName || '';
  }

  function getSurfaceContainer(surfaceId) {
    var surface = MANAGEMENT_SURFACES[surfaceId];
    if (!surface) return null;
    return document.getElementById(surface.containerId);
  }

  function setActiveSurface(surfaceId) {
    var nextSurfaceId = isKnownSurface(surfaceId) ? surfaceId : 'backendSettings';
    activeSurfaceId = nextSurfaceId;
    try {
      localStorage.setItem(SURFACE_STORAGE_KEY, nextSurfaceId);
    } catch (_) {}

    var tabs = document.querySelectorAll('[data-management-surface-tab]');
    for (var i = 0; i < tabs.length; i++) {
      var isActiveTab = tabs[i].getAttribute('data-management-surface-tab') === nextSurfaceId;
      tabs[i].classList.toggle('active', isActiveTab);
      tabs[i].setAttribute('aria-selected', isActiveTab ? 'true' : 'false');
    }

    var panels = document.querySelectorAll('[data-management-surface-panel]');
    for (var j = 0; j < panels.length; j++) {
      var isActivePanel = panels[j].getAttribute('data-management-surface-panel') === nextSurfaceId;
      panels[j].classList.toggle('is-active', isActivePanel);
      panels[j].hidden = !isActivePanel;
    }
  }

  function activateManagementTopTab(container, tabName) {
    if (!container || !tabName) return;
    var normalizedTab = normalizeRequestedTab(tabName);
    var topTab = container.querySelector('.mgmt-top-tab[data-mgmt-top-tab="' + normalizedTab + '"]');
    if (topTab) topTab.click();
  }

  function applyInitialUiState() {
    setActiveSurface(initialUiState.surfaceId);
    if (!initialUiState.section) return;
    activateManagementTopTab(getSurfaceContainer(resolveSurfaceId(initialUiState.section)), initialUiState.section);
  }

  function bindSurfaceNavigation() {
    document.addEventListener('click', function (event) {
      var tab = event.target && event.target.closest
        ? event.target.closest('[data-management-surface-tab]')
        : null;
      if (!tab) return;
      setActiveSurface(tab.getAttribute('data-management-surface-tab'));
    });
  }

  // ── Backend Discovery ──

  async function discoverBackend() {
    if (BackendDiscovery && typeof BackendDiscovery.discoverBackend === 'function') {
      try {
        return await BackendDiscovery.discoverBackend({
          preferredUrl: initialBackendUrl,
          useTauri: true,
          timeoutMs: 1200
        });
      } catch (e) {
        /* fall through */
      }
    }
    var ports = [13080, 8083, 1431, 12080, 14080, 11080, 15080];
    for (var i = 0; i < ports.length; i++) {
      for (var h = 0; h < 2; h++) {
        var host = h === 0 ? '127.0.0.1' : 'localhost';
        try {
          var res = await fetch('http://' + host + ':' + ports[i] + '/status');
          if (!res.ok) continue;
          var data = await res.json();
          if (data.status === 'running') {
            return 'http://' + host + ':' + (data.port || ports[i]);
          }
        } catch (e) {}
      }
    }
    return null;
  }

  function scheduleDiscoveryRetry() {
    if (discoveryRetryTimer) return;
    discoveryRetryTimer = setTimeout(async function () {
      discoveryRetryTimer = null;
      await ensureBackendConnection('retry');
    }, 2000);
  }

  // ── API Adapter ──

  async function apiGet(path) {
    if (!baseUrl) throw new Error('Backend unavailable');
    var res = await fetch(baseUrl + path);
    if (!res.ok) throw new Error(res.status + ': ' + (await res.text()));
    return res.json();
  }

  async function apiPost(path, body) {
    if (!baseUrl) throw new Error('Backend unavailable');
    var res = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.status + ': ' + (await res.text()));
    return res.json();
  }

  async function apiPut(path, body) {
    if (!baseUrl) throw new Error('Backend unavailable');
    var res = await fetch(baseUrl + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.status + ': ' + (await res.text()));
    return res.json();
  }

  async function apiDelete(path) {
    if (!baseUrl) throw new Error('Backend unavailable');
    var res = await fetch(baseUrl + path, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.status + ': ' + (await res.text()));
    return res.json();
  }

  function getManagementApiAdapter() {
    return {
      get: apiGet,
      post: apiPost,
      put: apiPut,
      delete: apiDelete,
    };
  }

  function getManagementCallbacks() {
    return {
      onThemeChange: function (themeId) {
        if (typeof applyLexeraTheme === 'function') applyLexeraTheme(themeId);
      },
      openLogStream: openLogStream,
      onNotify: function (msg) {
        console.info('[management]', msg);
      },
      onConfirm: function (msg) {
        return Promise.resolve(window.confirm(msg));
      },
      onServerRestarted: function (bindAddr, port) {
        var host = (bindAddr === '0.0.0.0') ? '127.0.0.1' : bindAddr;
        baseUrl = 'http://' + host + ':' + port;
      },
      getThemes: function () {
        return typeof LEXERA_THEMES !== 'undefined' ? LEXERA_THEMES : [];
      },
    };
  }

  // ── SSE for live updates ──

  function connectSSE() {
    if (sseSource) { sseSource.close(); sseSource = null; }
    clearFallbackPolling();
    sseSource = new EventSource(baseUrl + '/events');
    sseSource.onmessage = function (e) {
      try {
        var event = JSON.parse(e.data);
        if (event.type === 'CollabConnectionChanged') ManagementUI.refresh('connections');
        else if (event.type === 'PeerDiscoveryChanged') ManagementUI.refresh('peers');
        else if (event.type === 'ConfigChanged') ManagementUI.refresh();
      } catch (_) {}
    };
    sseSource.onerror = function () {
      if (sseSource) { sseSource.close(); sseSource = null; }
      startFallbackPolling();
    };
  }

  function startFallbackPolling() {
    if (!fallbackConnectionsInterval) fallbackConnectionsInterval = setInterval(function () { ManagementUI.refresh('connections'); }, 10000);
    if (!fallbackPeersInterval) fallbackPeersInterval = setInterval(function () { ManagementUI.refresh('peers'); }, 5000);
  }

  function clearFallbackPolling() {
    if (fallbackConnectionsInterval) { clearInterval(fallbackConnectionsInterval); fallbackConnectionsInterval = null; }
    if (fallbackPeersInterval) { clearInterval(fallbackPeersInterval); fallbackPeersInterval = null; }
  }

  function openLogStream(onEntry, onOpen, onError) {
    if (!baseUrl) return null;
    var es = new EventSource(baseUrl + '/logs/stream');
    es.onmessage = function (event) {
      if (!onEntry) return;
      try {
        onEntry(JSON.parse(event.data));
      } catch (_) {}
    };
    es.onopen = function (event) {
      if (onOpen) onOpen(event);
    };
    es.onerror = function (event) {
      if (onError) onError(event);
    };
    return es;
  }

  // ── Init ──

  async function ensureBackendConnection(reason) {
    if (isInitializing) return;
    isInitializing = true;
    discoveryAttemptCount += 1;
    try {
      var discovered = await discoverBackend();
      if (!discovered) {
        baseUrl = '';
        scheduleDiscoveryRetry();
        return;
      }
      baseUrl = discovered;
      if (discoveryRetryTimer) { clearTimeout(discoveryRetryTimer); discoveryRetryTimer = null; }
      var managementApi = getManagementApiAdapter();
      var managementCallbacks = getManagementCallbacks();

      ManagementUI.init({
        container: getSurfaceContainer('backendSettings'),
        ui: getManagementUiPreset('backendSettings'),
        api: managementApi,
        callbacks: managementCallbacks,
      });
      ManagementUI.mount('files', {
        container: getSurfaceContainer('files'),
        ui: getManagementUiPreset('files'),
        api: managementApi,
        callbacks: managementCallbacks,
      });
      applyInitialUiState();

      connectSSE();
    } finally {
      isInitializing = false;
    }
  }

  // Parse initial backend URL from query params
  try {
    var params = new URLSearchParams(window.location.search || '');
    initialBackendUrl = params.get('backend') || '';
    initialUiState.section = params.get('section') || '';
    initialUiState.surfaceId = resolveSurfaceId(
      params.get('surface') ||
      params.get('panel') ||
      initialUiState.section ||
      localStorage.getItem(SURFACE_STORAGE_KEY) ||
      'backendSettings'
    );
  } catch (e) {
    initialBackendUrl = '';
    initialUiState.surfaceId = 'backendSettings';
    initialUiState.section = '';
  }

  bindSurfaceNavigation();
  setActiveSurface(initialUiState.surfaceId);
  ensureBackendConnection('init');
})();
