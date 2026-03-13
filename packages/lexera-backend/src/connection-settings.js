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

  // Apply theme immediately from localStorage to avoid flash of wrong theme
  if (typeof applyLexeraTheme === 'function') {
    applyLexeraTheme(localStorage.getItem('lexera-theme') || 'lexera');
  }

  // ── Backend Discovery ──

  function fetchWithTimeout(url, options, timeoutMs) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = null;
    var requestOptions = Object.assign({}, options || {});
    if (controller) {
      requestOptions.signal = controller.signal;
      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        timeoutId = setTimeout(function () { controller.abort(); }, timeoutMs);
      }
    }
    return fetch(url, requestOptions).finally(function () {
      if (timeoutId) clearTimeout(timeoutId);
    });
  }

  function normalizeBackendUrl(url) {
    if (!url) return '';
    try {
      var parsed = new URL(url);
      var port = parsed.port ? ':' + parsed.port : '';
      return parsed.protocol + '//' + parsed.hostname + port;
    } catch (e) {
      return '';
    }
  }

  function buildBackendUrlVariants(url) {
    var normalized = normalizeBackendUrl(url);
    if (!normalized) return [];
    var variants = [];
    var seen = Object.create(null);
    function push(candidate) {
      var key = normalizeBackendUrl(candidate);
      if (!key || seen[key]) return;
      seen[key] = true;
      variants.push(key);
    }
    push(normalized);
    try {
      var parsed = new URL(normalized);
      if (parsed.hostname === 'localhost') { parsed.hostname = '127.0.0.1'; push(parsed.toString()); }
      else if (parsed.hostname === '127.0.0.1') { parsed.hostname = 'localhost'; push(parsed.toString()); }
    } catch (e) {}
    return variants;
  }

  async function probeBackendCandidate(url, source, timeoutMs) {
    var variants = buildBackendUrlVariants(url);
    for (var i = 0; i < variants.length; i++) {
      try {
        var res = await fetchWithTimeout(variants[i] + '/status', {}, timeoutMs);
        if (res.ok) {
          var data = await res.json();
          if (data.status === 'running') {
            var resolved = normalizeBackendUrl(variants[i]);
            if (data.port) {
              try {
                var p = new URL(resolved);
                p.port = String(data.port);
                resolved = normalizeBackendUrl(p.toString());
              } catch (_) {}
            }
            return resolved;
          }
        }
      } catch (e) {}
    }
    return null;
  }

  async function discoverBackend() {
    if (initialBackendUrl) {
      var m = await probeBackendCandidate(initialBackendUrl, 'query', 2000);
      if (m) return m;
    }
    try {
      if (window.__TAURI_INTERNALS__) {
        var url = await window.__TAURI_INTERNALS__.invoke('get_backend_url');
        var tm = await probeBackendCandidate(url, 'tauri-invoke', 2000);
        if (tm) return tm;
      }
    } catch (e) {}
    var ports = [13080, 12080, 14080, 11080, 15080];
    for (var i = 0; i < ports.length; i++) {
      var sm = await probeBackendCandidate('http://localhost:' + ports[i], 'port-scan', 1000);
      if (sm) return sm;
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

      ManagementUI.init({
        container: document.getElementById('management-container'),
        api: {
          get: apiGet,
          post: apiPost,
          put: apiPut,
          delete: apiDelete,
        },
        callbacks: {
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
        },
      });

      connectSSE();
    } finally {
      isInitializing = false;
    }
  }

  // Parse initial backend URL from query params
  try {
    var params = new URLSearchParams(window.location.search || '');
    initialBackendUrl = params.get('backend') || '';
  } catch (e) {
    initialBackendUrl = '';
  }

  ensureBackendConnection('init');
})();
