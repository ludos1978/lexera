(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraBackendDiscovery = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var DEFAULT_PORT_CANDIDATES = [13080, 8083, 1431, 12080, 14080, 11080, 15080];

  function canUseTauriInvoke() {
    return !!(
      root &&
      root.__TAURI_INTERNALS__ &&
      typeof root.__TAURI_INTERNALS__.invoke === 'function'
    );
  }

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
      var parsed = new URL(String(url).trim());
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
      if (parsed.hostname === 'localhost') {
        parsed.hostname = '127.0.0.1';
        push(parsed.toString());
      } else if (parsed.hostname === '127.0.0.1') {
        parsed.hostname = 'localhost';
        push(parsed.toString());
      }
    } catch (e) {
      /* ignore */
    }
    return variants;
  }

  function resolveStatusBaseUrl(candidateUrl, statusPayload) {
    var normalized = normalizeBackendUrl(candidateUrl);
    if (!normalized) return '';
    try {
      var parsed = new URL(normalized);
      if (statusPayload && typeof statusPayload.port === 'number') {
        parsed.port = String(statusPayload.port);
      }
      return normalizeBackendUrl(parsed.toString());
    } catch (e) {
      return normalized;
    }
  }

  async function probeBackendCandidate(url, timeoutMs) {
    var variants = buildBackendUrlVariants(url);
    for (var i = 0; i < variants.length; i++) {
      try {
        var res = await fetchWithTimeout(variants[i] + '/status', {}, timeoutMs);
        if (!res.ok) continue;
        var data = await res.json();
        if (data && data.status === 'running') {
          return {
            baseUrl: resolveStatusBaseUrl(variants[i], data),
            status: data
          };
        }
      } catch (e) {
        /* try next candidate */
      }
    }
    return null;
  }

  async function discoverBackend(options) {
    options = options || {};
    var preferredUrl = options.preferredUrl || options.url || '';
    var timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 1200;
    var ports = Array.isArray(options.ports) && options.ports.length
      ? options.ports
      : DEFAULT_PORT_CANDIDATES;

    if (preferredUrl) {
      var preferred = await probeBackendCandidate(preferredUrl, timeoutMs);
      if (preferred) return preferred.baseUrl;
    }

    if (options.useTauri !== false && canUseTauriInvoke()) {
      try {
        var tauriUrl = await root.__TAURI_INTERNALS__.invoke('get_backend_url');
        var tauriResult = await probeBackendCandidate(tauriUrl, timeoutMs);
        if (tauriResult) return tauriResult.baseUrl;
      } catch (e) {
        /* fall through to port scan */
      }
    }

    for (var i = 0; i < ports.length; i++) {
      var port = ports[i];
      var loopbackResult = await probeBackendCandidate('http://127.0.0.1:' + port, timeoutMs);
      if (loopbackResult) return loopbackResult.baseUrl;
      var localhostResult = await probeBackendCandidate('http://localhost:' + port, timeoutMs);
      if (localhostResult) return localhostResult.baseUrl;
    }

    return null;
  }

  return {
    DEFAULT_PORT_CANDIDATES: DEFAULT_PORT_CANDIDATES,
    canUseTauriInvoke: canUseTauriInvoke,
    fetchWithTimeout: fetchWithTimeout,
    normalizeBackendUrl: normalizeBackendUrl,
    buildBackendUrlVariants: buildBackendUrlVariants,
    probeBackendCandidate: probeBackendCandidate,
    discoverBackend: discoverBackend
  };
}));
