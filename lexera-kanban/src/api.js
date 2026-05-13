/**
 * HTTP client for Lexera Backend REST API.
 * Auto-discovers the backend by trying common ports, or uses a manually set URL.
 */
var LexeraApi = (function () {
  let baseUrl = null;
  let bearerToken = null;
  let bearerTokenPromise = null;
  let recentApiLogAt = Object.create(null);

  // Transport selection. Resolves once at module init and does not silently
  // switch mid-session. `window.LEXERA_TRANSPORT` (set by the Tauri shell or
  // a dev tool) may force `http` for triage.
  //   'local-ipc' → Tauri IPC via backend_ipc_request command
  //   'http'       → loopback HTTP fetch against the discovered backend
  let transportMode = null;

  function resolveTauriCore() {
    if (typeof window === 'undefined') return null;
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      return window.__TAURI_INTERNALS__;
    }
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      return window.__TAURI__.core;
    }
    try {
      if (window.parent && window.parent !== window) {
        if (window.parent.__TAURI_INTERNALS__ && typeof window.parent.__TAURI_INTERNALS__.invoke === 'function') {
          return window.parent.__TAURI_INTERNALS__;
        }
        if (window.parent.__TAURI__ && window.parent.__TAURI__.core && typeof window.parent.__TAURI__.core.invoke === 'function') {
          return window.parent.__TAURI__.core;
        }
      }
    } catch (e) { /* cross-origin — ignore */ }
    return null;
  }

  // The Tauri `Channel` class lives on `window.__TAURI__.core` (when
  // `withGlobalTauri: true`), not on `__TAURI_INTERNALS__` — so we can't reuse
  // `resolveTauriCore()` here. Some IPC calls also expose Channel on the core
  // returned by `resolveTauriCore()` (older builds); check both.
  function resolveTauriChannelCtor() {
    if (typeof window === 'undefined') return null;
    var core = resolveTauriCore();
    if (core && typeof core.Channel === 'function') return core.Channel;
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.Channel === 'function') {
      return window.__TAURI__.core.Channel;
    }
    try {
      if (window.parent && window.parent !== window &&
          window.parent.__TAURI__ && window.parent.__TAURI__.core &&
          typeof window.parent.__TAURI__.core.Channel === 'function') {
        return window.parent.__TAURI__.core.Channel;
      }
    } catch (e) { /* cross-origin — ignore */ }
    return null;
  }

  function getTransportMode() {
    if (transportMode) return transportMode;
    var override = (typeof window !== 'undefined' && window.LEXERA_TRANSPORT) || null;
    var tauriAvailable = !!resolveTauriCore();
    if (tauriAvailable) {
      // Phase 7: inside a Tauri desktop webview the transport is pinned to
      // `local-ipc`. The `http` override is no longer honored — pointing the
      // desktop app at a remote backend would ship as a separate product
      // feature, not as migration scaffolding. A `local-ipc` override is a
      // no-op here.
      transportMode = 'local-ipc';
    } else if (override === 'http' || override === 'local-ipc') {
      transportMode = override;
    } else {
      transportMode = 'http';
    }
    return transportMode;
  }

  function headerListFromInit(headersInit) {
    if (!headersInit) return [];
    var list = [];
    if (typeof headersInit.forEach === 'function') {
      headersInit.forEach(function (value, key) { list.push([String(key), String(value)]); });
    } else if (Array.isArray(headersInit)) {
      for (var i = 0; i < headersInit.length; i++) list.push([String(headersInit[i][0]), String(headersInit[i][1])]);
    } else if (typeof headersInit === 'object') {
      for (var k in headersInit) {
        if (Object.prototype.hasOwnProperty.call(headersInit, k)) list.push([k, String(headersInit[k])]);
      }
    }
    return list;
  }

  function bodyToStringForIpc(body) {
    if (body == null) return null;
    if (typeof body === 'string') return body;
    if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
    if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
    // URLSearchParams, FormData, Blob are out of scope for Phase 3 JSON paths.
    return String(body);
  }

  // Minimal Response-shaped object returned by `ipcFetch`. Covers the surface
  // `api.js` actually uses: `ok`, `status`, `statusText`, `text()`, `json()`,
  // and header lookups via a Headers-like helper on `.headers`.
  function makeIpcResponse(result) {
    var bodyText = typeof result.body === 'string' ? result.body : String(result.body || '');
    var status = result.status;
    var statusText = result.headers
      .filter(function (h) { return h[0].toLowerCase() === 'x-status-text'; })
      .map(function (h) { return h[1]; })[0] || '';
    var headersMap = Object.create(null);
    for (var i = 0; i < result.headers.length; i++) {
      var k = String(result.headers[i][0]).toLowerCase();
      headersMap[k] = result.headers[i][1];
    }
    return {
      ok: status >= 200 && status < 300,
      status: status,
      statusText: statusText,
      headers: {
        get: function (name) { return headersMap[String(name).toLowerCase()] || null; }
      },
      text: function () { return Promise.resolve(bodyText); },
      json: function () {
        try { return Promise.resolve(JSON.parse(bodyText)); }
        catch (e) { return Promise.reject(e); }
      }
    };
  }

  // Single construction path for every backend-bound Tauri command's
  // header list. Bootstraps the bearer token on demand, then injects
  // Authorization. Callers that already set Authorization (e.g. `request()`
  // via `authHeaders()`) are passed through unchanged.
  //
  // `path` gates the bootstrap: `/collab/me` is the bootstrap endpoint
  // itself, and recursing into ensureBearerToken() from inside its own
  // pending promise would deadlock on the promise it hasn't resolved yet.
  async function ensureIpcAuthHeaders(headers, path) {
    var list = Array.isArray(headers) ? headers.slice() : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i][0]).toLowerCase() === 'authorization') return list;
    }

    // Phase 7.5: local IPC transport is implicitly authenticated; skip
    // Authorization header.
    if (getTransportMode() === 'local-ipc') return list;

    if (path !== '/collab/me') {
      await ensureBearerToken();
    }
    if (!bearerToken) return list;
    var authed = authHeaders();
    for (var k in authed) {
      if (Object.prototype.hasOwnProperty.call(authed, k)) {
        list.push([String(k).toLowerCase(), String(authed[k])]);
      }
    }
    return list;
  }

  async function ipcFetch(path, fetchOptions) {
    var core = resolveTauriCore();
    if (!core) throw new Error('IPC transport selected but Tauri core unavailable');
    var method = (fetchOptions && fetchOptions.method) || 'GET';
    var arg = {
      method: String(method).toUpperCase(),
      uri: path,
      headers: await ensureIpcAuthHeaders(headerListFromInit(fetchOptions && fetchOptions.headers), path),
      body: bodyToStringForIpc(fetchOptions && fetchOptions.body)
    };
    var result = await core.invoke('backend_ipc_request', { arg: arg });
    return makeIpcResponse(result);
  }

  async function transportFetch(url, path, fetchOptions) {
    if (getTransportMode() === 'local-ipc') {
      return ipcFetch(path, fetchOptions);
    }
    return fetch(url + path, fetchOptions);
  }

  function requireBackendDiscoveryMethod(name) {
    var discovery = window.LexeraBackendDiscovery;
    if (!discovery || typeof discovery[name] !== 'function') {
      throw new Error('LexeraBackendDiscovery.' + name + ' is required. Sync runtime assets from lexera-shared.');
    }
    return discovery[name].bind(discovery);
  }

  function formatApiError(error) {
    if (error == null) return String(error);
    if (error instanceof Error) return error.stack || (error.name + ': ' + error.message);
    if (typeof error === 'object') {
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

  function logApiIssue(level, target, message, error, options) {
    options = options || {};
    var dedupeKey = options.dedupeKey || (level + '|' + target + '|' + message);
    var dedupeWindowMs = typeof options.dedupeWindowMs === 'number' ? options.dedupeWindowMs : 5000;
    var now = Date.now();
    if (dedupeWindowMs > 0 && recentApiLogAt[dedupeKey] && now - recentApiLogAt[dedupeKey] < dedupeWindowMs) {
      return;
    }
    recentApiLogAt[dedupeKey] = now;

    var fullMessage = '[api.' + target + '] ' + message;
    if (typeof error !== 'undefined') {
      fullMessage += ': ' + formatApiError(error);
    }
    if (typeof lexeraLogWithTarget === 'function') {
      lexeraLogWithTarget(level, 'api.' + target, fullMessage);
    }
  }

  async function discover() {
    // In IPC mode the backend URL is irrelevant; return a sentinel that
    // `transportFetch` ignores. `fileUrl`/`mediaUrl` still fall back to HTTP
    // URLs in Phase 3; the asset protocol replaces them in Phase 4.
    if (getTransportMode() === 'local-ipc') {
      if (!baseUrl) baseUrl = 'ipc://local';
      return baseUrl;
    }
    if (baseUrl) return baseUrl;
    try {
      var discovered = await requireBackendDiscoveryMethod('discoverBackend')({
        useTauri: true,
        timeoutMs: 1200
      });
      if (discovered) {
        baseUrl = discovered;
        return baseUrl;
      }
    } catch (error) {
      logApiIssue('error', 'api.discover', 'Backend discovery unavailable', error, {
        dedupeKey: 'api.discover.unavailable',
        dedupeWindowMs: 10000
      });
      throw error;
    }
    return null;
  }

  async function ensureBearerToken() {
    if (bearerToken) return bearerToken;

    // Phase 7.5: local IPC transport is implicitly authenticated; the
    // bearer token bootstrap is only required for loopback HTTP.
    if (getTransportMode() === 'local-ipc') return null;

    if (bearerTokenPromise) return bearerTokenPromise;
    bearerTokenPromise = (async function () {
      try {
        var url = await discover();
        if (!url) return null;
        // Use transportFetch so this works over both HTTP (browser/dev) and
        // Tauri IPC. Plain `fetch(url + path)` breaks in IPC mode because
        // `url` is the sentinel `ipc://local`.
        var res = await transportFetch(url, '/collab/me', {
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          var data = await res.json();
          if (data && typeof data.token === 'string' && data.token) {
            bearerToken = data.token;
            return bearerToken;
          }
        }
      } catch (e) {
        logApiIssue('warn', 'api.auth', 'Failed to fetch bearer token from /collab/me', e, {
          dedupeKey: 'api.auth.fetch-token',
          dedupeWindowMs: 10000
        });
      } finally {
        bearerTokenPromise = null;
      }
      return null;
    })();
    return bearerTokenPromise;
  }

  function authHeaders(existing) {
    // Phase 7.5: skip Authorization header if on IPC.
    if (getTransportMode() === 'local-ipc') return existing || {};

    if (!bearerToken) return existing || {};
    var h = Object.assign({}, existing || {});
    h['Authorization'] = 'Bearer ' + bearerToken;
    return h;
  }

  function appendAuthTokenQuery(url) {
    if (!url || !bearerToken) return url;
    var separator = url.indexOf('?') === -1 ? '?' : '&';
    return url + separator + 'auth_token=' + encodeURIComponent(bearerToken);
  }

  var DEFAULT_TIMEOUT_MS = 10000;
  var LONG_TIMEOUT_MS = 30000;
  var DASHBOARD_TIMEOUT_MS = 8000;
  var BACKEND_STATUS_CACHE_MS = 3000;
  var CRDT_SYNC_DISABLED_MESSAGE = 'CRDT sync is disabled in this build';

  var inFlightCount = 0;
  var backendStatusCache = null;
  var backendStatusCacheAt = 0;

  function changeInFlight(delta) {
    inFlightCount = Math.max(0, inFlightCount + delta);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('lexera-api-inflight-changed', {
        detail: { count: inFlightCount }
      }));
    }
  }

  function getInFlightCount() { return inFlightCount; }

  function normalizeBackendCapabilities(status) {
    var caps = status && typeof status.capabilities === 'object' && status.capabilities
      ? status.capabilities
      : {};
    var crdtSync = caps.crdtSync !== false;
    var disabledReason = typeof caps.disabledReason === 'string' && caps.disabledReason
      ? caps.disabledReason
      : (crdtSync ? null : CRDT_SYNC_DISABLED_MESSAGE);
    return {
      crdtSync: crdtSync,
      liveSync: crdtSync && caps.liveSync !== false,
      remoteSync: crdtSync && caps.remoteSync !== false,
      disabledReason: disabledReason
    };
  }

  async function getBackendStatus(options) {
    options = options || {};
    var now = Date.now();
    if (!options.force && backendStatusCache && now - backendStatusCacheAt < BACKEND_STATUS_CACHE_MS) {
      return backendStatusCache;
    }
    const url = await discover();
    if (!url) return null;
    const res = await transportFetch(url, '/status', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      var error = new Error(res.status + ': ' + (res.statusText || 'Status check failed'));
      error.status = res.status;
      throw error;
    }
    var status = await res.json();
    backendStatusCache = status || {};
    backendStatusCacheAt = Date.now();
    return backendStatusCache;
  }

  async function getBackendCapabilities(options) {
    return normalizeBackendCapabilities(await getBackendStatus(options));
  }

  function getBackendCapabilitiesSync() {
    return normalizeBackendCapabilities(backendStatusCache);
  }

  function isCrdtSyncAvailableSync() {
    return getBackendCapabilitiesSync().crdtSync !== false;
  }

  async function isCrdtSyncAvailable(options) {
    return (await getBackendCapabilities(options)).crdtSync !== false;
  }

  function makeCrdtSyncDisabledError(reason) {
    var error = new Error(reason || CRDT_SYNC_DISABLED_MESSAGE);
    error.status = 501;
    error.code = 'crdt_sync_disabled';
    return error;
  }

  async function assertCrdtSyncAvailable(options) {
    var capabilities = await getBackendCapabilities(options);
    if (capabilities.crdtSync === false) {
      throw makeCrdtSyncDisabledError(capabilities.disabledReason);
    }
    return capabilities;
  }

  function clearCachedBackendState(options) {
    options = options || {};
    baseUrl = null;
    backendStatusCache = null;
    backendStatusCacheAt = 0;
    if (options.clearToken !== false) {
      bearerToken = null;
      bearerTokenPromise = null;
    }
  }

  function summarizeResponsePreview(bodyText) {
    if (typeof bodyText !== 'string') return '<non-text>';
    var normalized = bodyText.replace(/\s+/g, ' ').trim();
    if (!normalized) return '<empty>';
    if (normalized.length > 180) return normalized.slice(0, 180) + '...';
    return normalized;
  }

  function buildRetryState(prev) {
    return Object.assign({}, prev || {}, { recoveredOnce: true });
  }

  function canRecoverAndRetry(retryState) {
    return !retryState || !retryState.recoveredOnce;
  }

  async function retryWithBackendRecovery(target, path, reason, retryState, retryFn, originalError) {
    if (!canRecoverAndRetry(retryState)) {
      if (originalError) throw originalError;
      return null;
    }
    logApiIssue('warn', target, reason + ' — clearing cached backend session and retrying once', undefined, {
      dedupeKey: target + '.recover|' + path,
      dedupeWindowMs: 3000
    });
    var previousBaseUrl = baseUrl;
    var previousToken = bearerToken;
    clearCachedBackendState();
    try {
      return await retryFn(buildRetryState(retryState));
    } catch (retryError) {
      // Retry failed too. Restore the previously-cached backend session
      // so subsequent requests (next test, next user action) don't hit a
      // spurious "Backend not available" error just because we nuked
      // baseUrl before the retry attempt. And surface the original
      // downstream error (malformed JSON, body read failure) instead of
      // the incidental retry error, so callers see the real root cause.
      if (!baseUrl && previousBaseUrl) baseUrl = previousBaseUrl;
      if (!bearerToken && previousToken) bearerToken = previousToken;
      if (originalError) throw originalError;
      throw retryError;
    }
  }

  async function request(path, options, retryState) {
    retryState = retryState || null;
    const method = options && options.method ? String(options.method).toUpperCase() : 'GET';
    var suppressErrorStatuses = options && Array.isArray(options.suppressErrorStatuses)
      ? options.suppressErrorStatuses
      : null;
    const url = await discover();
    if (!url) {
      const error = new Error('Backend not available');
      logApiIssue('error', 'api.request', method + ' ' + path + ' failed: backend not available', error, {
        dedupeKey: 'api.request.no-backend|' + method + '|' + path,
        dedupeWindowMs: 3000
      });
      throw error;
    }
    // Ensure we have a bearer token for authenticated requests
    // (skip for /collab/me itself to avoid circular dependency)
    // Phase 7.5: skip for local IPC transport too.
    if (path !== '/collab/me' && getTransportMode() !== 'local-ipc') {
      await ensureBearerToken();
    }
    var timeoutMs = options && typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, timeoutMs);
    var fetchOptions = Object.assign({}, options, { signal: controller.signal });
    fetchOptions.headers = authHeaders(fetchOptions.headers);
    changeInFlight(+1);
    let res;
    try {
      res = await transportFetch(url, path, fetchOptions);
    } catch (error) {
      clearTimeout(timeoutId);
      changeInFlight(-1);
      if (error.name === 'AbortError') {
        var timeoutError = new Error('Request timed out: ' + method + ' ' + path);
        logApiIssue('error', 'api.request', method + ' ' + path + ' timed out after ' + timeoutMs + 'ms', timeoutError);
        throw timeoutError;
      }
      if (canRecoverAndRetry(retryState)) {
        return retryWithBackendRecovery(
          'api.request',
          path,
          method + ' ' + path + ' transport failed',
          retryState,
          function (nextRetryState) {
            return request(path, options, nextRetryState);
          }
        );
      }
      logApiIssue('error', 'api.request', method + ' ' + path + ' transport failed', error);
      throw error;
    }
    clearTimeout(timeoutId);
    changeInFlight(-1);
    if (!res.ok) {
      var payload = null;
      var text = '';
      try { text = await res.text(); } catch (_) { text = ''; }
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (jsonError) {
          payload = null;
        }
      }
      // Extract structured error message from JSON response body
      if (payload && typeof payload.error === 'string') {
        text = payload.error;
      }
      if (!text) text = res.statusText || 'Request failed';
      var errorMsg = res.status + ': ' + text;
      var error = new Error(errorMsg);
      error.status = res.status;
      if (payload) error.data = payload;
      if (res.status === 401 && path !== '/collab/me' && canRecoverAndRetry(retryState)) {
        return retryWithBackendRecovery(
          'api.request',
          path,
          method + ' ' + path + ' returned 401',
          retryState,
          function (nextRetryState) {
            return request(path, options, nextRetryState);
          }
        );
      }
      var shouldSuppressStatusLog = suppressErrorStatuses && suppressErrorStatuses.indexOf(res.status) !== -1;
      if (!shouldSuppressStatusLog) {
        logApiIssue(res.status >= 500 ? 'error' : 'warn', 'api.request', method + ' ' + path + ' failed: ' + errorMsg, error);
      }
      throw error;
    }
    var bodyText;
    try {
      if (typeof res.text === 'function') {
        bodyText = await res.text();
      } else if (typeof res.json === 'function') {
        // Fallback for responses that only expose `.json()` (primarily
        // test mocks — real `fetch` responses always expose both). We
        // re-serialize so the downstream empty-body / malformed-JSON
        // detection logic below still works off `bodyText`.
        var jsonBody = await res.json();
        bodyText = jsonBody == null ? '' : JSON.stringify(jsonBody);
      } else {
        bodyText = '';
      }
    } catch (bodyError) {
      // Body read failed — likely stale connection after sleep/wake
      if (canRecoverAndRetry(retryState)) {
        return retryWithBackendRecovery(
          'api.request',
          path,
          method + ' ' + path + ' body read failed (status ' + res.status + ')',
          retryState,
          function (nextRetryState) {
            return request(path, options, nextRetryState);
          },
          bodyError
        );
      }
      logApiIssue('error', 'api.request', method + ' ' + path + ' body read failed', bodyError);
      throw bodyError;
    }
    if (!bodyText || !bodyText.trim()) return null;
    try {
      return JSON.parse(bodyText);
    } catch (parseError) {
      var preview = summarizeResponsePreview(bodyText);
      if (canRecoverAndRetry(retryState)) {
        return retryWithBackendRecovery(
          'api.request',
          path,
          method + ' ' + path + ' returned invalid JSON (preview: ' + preview + ')',
          retryState,
          function (nextRetryState) {
            return request(path, options, nextRetryState);
          },
          parseError
        );
      }
      logApiIssue('error', 'api.request', method + ' ' + path + ' returned invalid JSON (preview: ' + preview + ')', parseError);
      throw parseError;
    }
  }

  async function getBoards() {
    return request('/boards');
  }

  async function getBoardHierarchy(boardId) {
    return request('/boards/' + boardId + '/hierarchy');
  }

  async function getBoardColumns(boardId) {
    return request('/boards/' + boardId + '/columns');
  }

  async function getBoardChanges(boardId, sinceGeneration) {
    return request('/boards/' + boardId + '/changes?since_generation=' + encodeURIComponent(String(sinceGeneration)));
  }

  async function requestCachedJson(path, revision, target, retryState) {
    retryState = retryState || null;
    const url = await discover();
    if (!url) {
      const error = new Error('Backend not available');
      logApiIssue('error', target, 'GET ' + path + ' failed: backend not available', error, {
        dedupeKey: target + '.no-backend|' + path,
        dedupeWindowMs: 3000
      });
      throw error;
    }
    await ensureBearerToken();
    const headers = authHeaders();
    if (revision != null) headers['If-None-Match'] = '"' + revision + '"';
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, DEFAULT_TIMEOUT_MS);
    changeInFlight(+1);
    let res;
    try {
      res = await transportFetch(url, path, { headers: headers, signal: controller.signal });
    } catch (error) {
      clearTimeout(timeoutId);
      changeInFlight(-1);
      if (error.name === 'AbortError') {
        var timeoutError = new Error('Request timed out: GET ' + path);
        logApiIssue('error', target, 'GET ' + path + ' timed out after ' + DEFAULT_TIMEOUT_MS + 'ms', timeoutError);
        throw timeoutError;
      }
      if (canRecoverAndRetry(retryState)) {
        return retryWithBackendRecovery(target, path, 'GET ' + path + ' transport failed', retryState, function (nextRetryState) {
          return requestCachedJson(path, revision, target, nextRetryState);
        });
      }
      logApiIssue('error', target, 'GET ' + path + ' transport failed', error);
      throw error;
    }
    clearTimeout(timeoutId);
    changeInFlight(-1);
    if (res.status === 304) {
      return { notModified: true, version: revision };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      const error = new Error(`${res.status}: ${text}`);
      if (res.status === 401 && path !== '/collab/me' && canRecoverAndRetry(retryState)) {
        return retryWithBackendRecovery(target, path, 'GET ' + path + ' returned 401', retryState, function (nextRetryState) {
          return requestCachedJson(path, revision, target, nextRetryState);
        });
      }
      logApiIssue(res.status >= 500 ? 'error' : 'warn', target, 'GET ' + path + ' failed', error);
      throw error;
    }
    try {
      var cachedBodyText;
      if (typeof res.text === 'function') {
        cachedBodyText = await res.text();
      } else if (typeof res.json === 'function') {
        var cachedJson = await res.json();
        cachedBodyText = cachedJson == null ? '' : JSON.stringify(cachedJson);
      } else {
        cachedBodyText = '';
      }
      if (!cachedBodyText || !cachedBodyText.trim()) return null;
      return JSON.parse(cachedBodyText);
    } catch (error) {
      var preview = typeof cachedBodyText === 'string' ? summarizeResponsePreview(cachedBodyText) : '<unavailable>';
      if (canRecoverAndRetry(retryState)) {
        return retryWithBackendRecovery(target, path, 'GET ' + path + ' returned invalid JSON (preview: ' + preview + ')', retryState, function (nextRetryState) {
          return requestCachedJson(path, revision, target, nextRetryState);
        }, error);
      }
      logApiIssue('error', target, 'GET ' + path + ' returned invalid JSON (preview: ' + preview + ')', error);
      throw error;
    }
  }

  async function getBoardHierarchyCached(boardId, revision) {
    return requestCachedJson('/boards/' + boardId + '/hierarchy', revision, 'api.getBoardHierarchyCached');
  }

  async function getBoardColumnsCached(boardId, revision) {
    return requestCachedJson('/boards/' + boardId + '/columns', revision, 'api.getBoardColumnsCached');
  }

  async function addCard(boardId, colIndex, content) {
    return request('/boards/' + boardId + '/columns/' + colIndex + '/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  async function search(query, options) {
    const params = new URLSearchParams();
    params.set('q', query || '');
    if (options && options.regex) params.set('regex', 'true');
    if (options && options.caseSensitive) params.set('caseSensitive', 'true');
    if (options && options.limit != null) params.set('limit', String(options.limit));
    if (options && options.offset != null) params.set('offset', String(options.offset));
    if (options && options.truncate != null) params.set('truncate', String(options.truncate));
    return request('/search?' + params.toString(), { timeoutMs: DASHBOARD_TIMEOUT_MS });
  }

  async function getCalendarTasks(options) {
    var params = new URLSearchParams();
    if (options && options.limit != null) params.set('limit', String(options.limit));
    if (options && options.truncate != null) params.set('truncate', String(options.truncate));
    var qs = params.toString();
    return request('/calendar/tasks' + (qs ? '?' + qs : ''), { timeoutMs: DASHBOARD_TIMEOUT_MS });
  }

  async function getDashboardData(options) {
    return request('/dashboard/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
      timeoutMs: DASHBOARD_TIMEOUT_MS,
    });
  }

  async function checkStatus() {
    try {
      return !!(await getBackendStatus({ force: true }));
    } catch (error) {
      logApiIssue('warn', 'api.status', 'Status check failed', error, {
        dedupeKey: 'api.status',
        dedupeWindowMs: 30000
      });
      return false;
    }
  }

  // URL shape: `lexera-asset://localhost/?b=<id>&k=m|f&v=<value>`.
  // Mirrors `asset_protocol::parse_asset_url` in lexera-kanban/src-tauri.
  function buildAssetUrl(boardId, kind, value) {
    return 'lexera-asset://localhost/?b=' + encodeURIComponent(boardId)
      + '&k=' + kind
      + '&v=' + encodeURIComponent(value);
  }

  function mediaUrl(boardId, filename) {
    if (getTransportMode() === 'local-ipc') {
      return buildAssetUrl(boardId, 'm', filename);
    }
    return appendAuthTokenQuery((baseUrl || '') + '/boards/' + boardId + '/media/' + encodeURIComponent(filename));
  }

  function fileUrl(boardId, path) {
    if (getTransportMode() === 'local-ipc') {
      return buildAssetUrl(boardId, 'f', path);
    }
    return appendAuthTokenQuery((baseUrl || '') + '/boards/' + boardId + '/file?path=' + encodeURIComponent(path));
  }

  async function fileInfo(boardId, path) {
    return request('/boards/' + boardId + '/file-info?path=' + encodeURIComponent(path));
  }

  async function fileInfoBatch(boardId, paths) {
    return request('/boards/' + boardId + '/file-info-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: paths }),
      timeoutMs: DASHBOARD_TIMEOUT_MS,
    });
  }

  async function saveBoard(boardId, boardData) {
    return request('/boards/' + boardId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(boardData),
    });
  }

  async function saveBoardWithBase(boardId, baseBoardData, boardData) {
    return request('/boards/' + boardId + '/sync-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseBoard: baseBoardData,
        board: boardData,
      }),
    });
  }

  async function rebaseBoardWithBase(boardId, baseBoardData, boardData) {
    return request('/boards/' + boardId + '/rebase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseBoard: baseBoardData,
        board: boardData,
      }),
    });
  }

  async function createBoardCrashsave(boardId, boardData, reason) {
    return request('/boards/' + boardId + '/crashsave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board: boardData,
        reason: reason || null,
      }),
    });
  }

  async function probeExternalEmbed(url, parentOrigin, forceRefresh) {
    var params = new URLSearchParams();
    params.set('url', String(url || ''));
    if (parentOrigin) params.set('parentOrigin', String(parentOrigin));
    if (forceRefresh) params.set('forceRefresh', 'true');
    return request('/external-embeds/probe?' + params.toString(), {
      timeoutMs: LONG_TIMEOUT_MS,
    });
  }

  async function openLiveSyncSession(boardId) {
    await assertCrdtSyncAvailable();
    return request('/boards/' + boardId + '/live-sync/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  async function applyLiveSyncBoard(sessionId, boardData) {
    return request('/live-sync/' + encodeURIComponent(sessionId) + '/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: boardData }),
    });
  }

  async function importLiveSyncUpdates(sessionId, updates) {
    return request('/live-sync/' + encodeURIComponent(sessionId) + '/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: updates || '' }),
    });
  }

  async function closeLiveSyncSession(sessionId) {
    return request('/live-sync/' + encodeURIComponent(sessionId), {
      method: 'DELETE',
    });
  }

  // Serialize a FormData into multipart/form-data bytes + content-type,
  // using the browser's own serializer via a throw-away `Response` wrapper.
  // Works in Tauri WKWebView and WebView2 (both WHATWG-spec compliant).
  async function formDataToBytes(form) {
    var res = new Response(form);
    var contentType = res.headers.get('content-type') || 'multipart/form-data';
    var buf = await res.arrayBuffer();
    return { bytes: new Uint8Array(buf), contentType: contentType };
  }

  async function uploadMedia(boardId, file) {
    var form = new FormData();
    form.append('file', file, file.name);
    var path = '/boards/' + boardId + '/media';

    if (getTransportMode() === 'local-ipc') {
      var core = resolveTauriCore();
      if (!core) throw new Error('IPC transport selected but Tauri core unavailable');
      var serialized = await formDataToBytes(form);
      var arg = {
        method: 'POST',
        uri: path,
        headers: await ensureIpcAuthHeaders([['content-type', serialized.contentType]], path),
        body: Array.from(serialized.bytes)
      };
      var result;
      try {
        result = await core.invoke('backend_ipc_upload', { arg: arg });
      } catch (e) {
        logApiIssue('error', 'api.uploadMedia', 'POST ' + path + ' IPC upload failed', e);
        throw e;
      }
      if (result.status < 200 || result.status >= 300) {
        var err = new Error(result.status + ': ' + result.body);
        logApiIssue(result.status >= 500 ? 'error' : 'warn',
          'api.uploadMedia', 'POST ' + path + ' failed', err);
        throw err;
      }
      try { return JSON.parse(result.body); }
      catch (e) {
        logApiIssue('error', 'api.uploadMedia', 'POST ' + path + ' returned invalid JSON', e);
        throw e;
      }
    }

    // HTTP path (browser/dev).
    var url = await discover();
    if (!url) {
      var unavailable = new Error('Backend not available');
      logApiIssue('error', 'api.uploadMedia', 'POST ' + path + ' failed: backend not available', unavailable, {
        dedupeKey: 'api.uploadMedia.no-backend|' + boardId,
        dedupeWindowMs: 3000
      });
      throw unavailable;
    }
    await ensureBearerToken();
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, LONG_TIMEOUT_MS);
    var uploadHeaders = authHeaders();
    var res;
    try {
      res = await fetch(url + path, { method: 'POST', body: form, headers: uploadHeaders, signal: controller.signal });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        var timeoutError = new Error('Request timed out: POST ' + path);
        logApiIssue('error', 'api.uploadMedia', 'POST ' + path + ' timed out after ' + LONG_TIMEOUT_MS + 'ms', timeoutError);
        throw timeoutError;
      }
      logApiIssue('error', 'api.uploadMedia', 'POST ' + path + ' transport failed', error);
      throw error;
    }
    clearTimeout(timeoutId);
    if (!res.ok) {
      var text = await res.text().catch(function () { return res.statusText; });
      var httpErr = new Error(res.status + ': ' + text);
      logApiIssue(res.status >= 500 ? 'error' : 'warn', 'api.uploadMedia', 'POST ' + path + ' failed', httpErr);
      throw httpErr;
    }
    try {
      return await res.json();
    } catch (error) {
      logApiIssue('error', 'api.uploadMedia', 'POST ' + path + ' returned invalid JSON', error);
      throw error;
    }
  }

  // Tracks every live IPC stream reconnecter so the pagehide/beforeunload
  // hook can close each one (invoking `backend_ipc_stream_close` on the
  // Rust side) before the webview reloads. Without this, the Rust pump task
  // keeps calling `channel.send(...)` into dead JS callback ids and the
  // fresh JS world logs "[TAURI] Couldn't find callback id …" forever.
  var _activeIpcStreamHandles = [];
  var _ipcUnloadHookRegistered = false;

  function _registerIpcUnloadHook() {
    if (_ipcUnloadHookRegistered) return;
    if (typeof window === 'undefined') return;
    _ipcUnloadHookRegistered = true;
    var cleanup = function () {
      var handles = _activeIpcStreamHandles;
      _activeIpcStreamHandles = [];
      for (var i = 0; i < handles.length; i++) {
        try { handles[i].close(); } catch (e) { /* page is unloading */ }
      }
      // Sync stream uses its own correlation id tracking.
      try { disconnectSync(); } catch (e) { /* best-effort */ }
    };
    window.addEventListener('pagehide', cleanup);
    window.addEventListener('beforeunload', cleanup);
  }

  // Exponential-backoff helper shared by all IPC stream openers. `factory`
  // returns the raw `{ correlationIdRef, channel }` handle; the caller
  // reopens via `attempt()` until `close()` is invoked. Matches the backoff
  // curve used by the sync adapter (1s → 30s cap, ±30% jitter).
  function makeIpcStreamReconnecter(targetTag, openOnce) {
    var closed = false;
    var reconnectAttempt = 0;
    var reconnectTimer = null;
    var activeCloseFn = null;

    function clearReconnectTimer() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleReconnect() {
      if (closed || reconnectTimer) return;
      var base = 1000 * Math.pow(2, reconnectAttempt);
      var delay = Math.min(base, 30000);
      delay += Math.random() * 0.3 * delay;
      reconnectAttempt++;
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        if (!closed) attempt();
      }, delay);
    }

    function attempt() {
      if (closed) return;
      var handle = openOnce({
        onStreamEnd: function (endReason) {
          activeCloseFn = null;
          if (closed) return;
          if (typeof endReason === 'string') {
            logApiIssue('warn', targetTag + '.reconnect',
              'stream ended: ' + endReason + ' — scheduling reconnect', undefined, {
                dedupeKey: targetTag + '.reconnect.schedule',
                dedupeWindowMs: 0
              });
          }
          scheduleReconnect();
        },
        onSuccessfulOpen: function () {
          reconnectAttempt = 0;
        },
        onOpenFailed: function (err) {
          logApiIssue('error', targetTag, 'backend_ipc_stream_open failed', err);
          scheduleReconnect();
        }
      });
      activeCloseFn = handle && handle.closeFn;
    }

    attempt();

    var handle = {
      close: function () {
        if (closed) return;
        closed = true;
        clearReconnectTimer();
        if (activeCloseFn) {
          try { activeCloseFn(); } catch (_) { /* best-effort */ }
        }
        var idx = _activeIpcStreamHandles.indexOf(handle);
        if (idx >= 0) _activeIpcStreamHandles.splice(idx, 1);
      }
    };
    _activeIpcStreamHandles.push(handle);
    _registerIpcUnloadHook();
    return handle;
  }

  // Open a backend IPC stream and return an EventSource-shaped handle
  // ({ close() }). Over IPC the backend's resync hint is embedded in the
  // payload JSON ({type:"Resync",lagged:N}), so `onEvent` receives a single
  // stream of parsed objects — matching what the HTTP adapter already
  // re-emits for `resync` events.
  //
  // Gap #5: auto-reconnect on backend restart. The stream end event
  // (channel `msg.end`) triggers the exponential-backoff schedule; the
  // next attempt re-invokes `backend_ipc_stream_open` with a fresh channel.
  function openIpcStream(topic, targetTag, onPayload) {
    var core = resolveTauriCore();
    if (!core) return null;
    var ChannelCtor = resolveTauriChannelCtor();
    if (!ChannelCtor) {
      logApiIssue('error', targetTag, 'Tauri Channel unavailable');
      return null;
    }
    function openOnce(cb) {
      var channel;
      try {
        channel = new ChannelCtor();
      } catch (e) {
        logApiIssue('error', targetTag, 'Tauri Channel constructor threw', e);
        cb.onOpenFailed(e);
        return null;
      }
      var correlationId = null;
      var attemptClosed = false;
      channel.onmessage = function (msg) {
        if (attemptClosed) return;
        if (msg && msg.end !== undefined && msg.end !== null) {
          attemptClosed = true;
          cb.onStreamEnd(typeof msg.end === 'string' ? msg.end : null);
          return;
        }
        if (!msg || typeof msg.payload !== 'string') return;
        try {
          onPayload(JSON.parse(msg.payload));
        } catch (e) {
          logApiIssue('warn', targetTag, 'Failed to parse stream payload', e, {
            dedupeKey: targetTag + '.parse',
            dedupeWindowMs: 3000
          });
        }
      };
      core.invoke('backend_ipc_stream_open', { topic: topic, channel: channel })
        .then(function (id) { correlationId = id; cb.onSuccessfulOpen(); })
        .catch(function (e) {
          attemptClosed = true;
          cb.onOpenFailed(e);
        });
      return {
        closeFn: function () {
          if (attemptClosed) return;
          attemptClosed = true;
          if (correlationId) {
            core.invoke('backend_ipc_stream_close', { correlationId: correlationId })
              .catch(function () { /* swallow — best-effort */ });
          }
        }
      };
    }
    return makeIpcStreamReconnecter(targetTag, openOnce);
  }

  function connectSSE(onEvent) {
    if (getTransportMode() === 'local-ipc') {
      return openIpcStream({ kind: 'events' }, 'api.sse', onEvent);
    }
    if (!baseUrl) return null;
    var es = new EventSource(appendAuthTokenQuery(baseUrl + '/events'));
    es.onmessage = function (msg) {
      try {
        onEvent(JSON.parse(msg.data));
      } catch (e) {
        logApiIssue('warn', 'api.sse', 'Failed to parse SSE payload from /events', e, {
          dedupeKey: 'api.sse.parse',
          dedupeWindowMs: 3000
        });
      }
    };
    // Handle backend resync hints (sent when this client lagged behind)
    es.addEventListener('resync', function (msg) {
      logApiIssue('warn', 'api.sse.resync', 'SSE client lagged — triggering full board refresh', msg.data);
      onEvent({ type: 'Resync' });
    });
    es.onerror = function (event) {
      logApiIssue('warn', 'api.sse', 'EventSource /events reported an error', formatApiError(event), {
        dedupeKey: 'api.sse.error',
        dedupeWindowMs: 3000
      });
    };
    return es;
  }

  async function addBoard(filePath) {
    return request('/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: filePath }),
    });
  }

  async function removeBoard(boardId) {
    return request('/boards/' + boardId, { method: 'DELETE' });
  }

  async function getLogs() {
    return request('/logs');
  }

  async function getCaptureHistory() {
    return request('/capture/history');
  }

  async function removeCaptureEntry(id) {
    return request('/capture/history/' + encodeURIComponent(id), {
      method: 'DELETE',
    });
  }

  function connectLogStream(onEntry) {
    if (getTransportMode() === 'local-ipc') {
      return openIpcStream({ kind: 'logs' }, 'api.logs.stream', onEntry);
    }
    if (!baseUrl) return null;
    var es = new EventSource(baseUrl + '/logs/stream');
    es.onmessage = function (msg) {
      try {
        onEntry(JSON.parse(msg.data));
      } catch (e) {
        logApiIssue('warn', 'api.logs.stream', 'Failed to parse SSE payload from /logs/stream', e, {
          dedupeKey: 'api.logs.stream.parse',
          dedupeWindowMs: 3000
        });
      }
    };
    es.onerror = function (event) {
      logApiIssue('warn', 'api.logs.stream', 'EventSource /logs/stream reported an error', formatApiError(event), {
        dedupeKey: 'api.logs.stream.error',
        dedupeWindowMs: 3000
      });
    };
    return es;
  }

  // ── WebSocket CRDT Sync ─────────────────────────────────────────────

  var syncWs = null;
  var syncBoardId = null;
  var syncUserId = null;
  var syncOnUpdate = null;
  var syncOnPresence = null;
  var syncOnEditingPresence = null;
  var syncHelloVvProvider = null;
  var syncReconnectTimer = null;
  var syncShouldReconnect = false;
  var syncHasConnectedOnce = false;
  var syncReconnectAttempt = 0;

  function clearSyncReconnectTimer() {
    if (syncReconnectTimer) {
      clearTimeout(syncReconnectTimer);
      syncReconnectTimer = null;
    }
  }

  function scheduleSyncReconnect() {
    if (!syncShouldReconnect || syncReconnectTimer || !syncBoardId || !syncUserId || !baseUrl || !isCrdtSyncAvailableSync()) return;
    var delay = Math.min(1000 * Math.pow(2, syncReconnectAttempt), 30000);
    delay += Math.random() * 0.3 * delay;
    syncReconnectAttempt++;
    logApiIssue('info', 'sync.reconnect', 'Reconnecting in ' + Math.round(delay) + 'ms (attempt ' + syncReconnectAttempt + ')', undefined, {
      dedupeKey: 'sync.reconnect.schedule',
      dedupeWindowMs: 0
    });
    syncReconnectTimer = setTimeout(function () {
      syncReconnectTimer = null;
      if (!syncShouldReconnect || syncWs || !syncBoardId || !syncUserId || !baseUrl) return;
      openSyncSocket();
    }, delay);
  }

  function openSyncSocket() {
    if (!baseUrl || !syncBoardId || !syncUserId) return;
    if (!isCrdtSyncAvailableSync()) {
      syncShouldReconnect = false;
      return;
    }
    var wsUrl = baseUrl.replace(/^http/, 'ws') + '/sync/' + syncBoardId + '?token=' + encodeURIComponent(bearerToken || '');
    var boardId = syncBoardId;
    syncWs = new WebSocket(wsUrl);

    syncWs.onopen = function () {
      clearSyncReconnectTimer();
      syncReconnectAttempt = 0;
      var vv = '';
      if (typeof syncHelloVvProvider === 'function') {
        try {
          vv = syncHelloVvProvider() || '';
        } catch (e) {
          logApiIssue('warn', 'sync.hello', 'Failed to compute hello version vector for board ' + boardId, e, {
            dedupeKey: 'sync.hello|' + boardId,
            dedupeWindowMs: 3000
          });
          vv = '';
        }
      }
      var hello = JSON.stringify({ type: 'ClientHello', user_id: syncUserId, vv: vv });
      try {
        syncWs.send(hello);
      } catch (e) {
        logApiIssue('error', 'sync.send', 'Failed to send ClientHello for board ' + boardId, e);
        throw e;
      }
      if (typeof lexeraLog === 'function') lexeraLog('info', '[api.sync.connect] WebSocket connected to board ' + boardId);
    };

    syncWs.onmessage = function (evt) {
      try {
        var msg = JSON.parse(evt.data);
        if (msg.type === 'ServerHello') {
          var reconnectHello = syncHasConnectedOnce;
          syncHasConnectedOnce = true;
          if (typeof lexeraLog === 'function') lexeraLog('info', '[api.sync.hello] Received ServerHello, peer_id=' + msg.peer_id);
          if (syncOnUpdate) {
            syncOnUpdate({
              type: 'hello',
              reconnect: reconnectHello,
              updates: msg.updates || '',
              vv: msg.vv || ''
            });
          }
        } else if (msg.type === 'ServerUpdate') {
          if (syncOnUpdate) {
            syncOnUpdate({
              type: 'update',
              updates: msg.updates || ''
            });
          }
        } else if (msg.type === 'ServerPresence') {
          if (syncOnPresence) syncOnPresence(msg.online_users || []);
        } else if (msg.type === 'ServerEditingPresence') {
          if (syncOnEditingPresence) syncOnEditingPresence(msg);
        } else if (msg.type === 'ServerError') {
          logApiIssue('warn', 'sync.server-error', 'Server error: ' + msg.message);
          syncShouldReconnect = false;
          disconnectSync();
        }
      } catch (e) {
        logApiIssue('warn', 'sync.message', 'Failed to parse sync message for board ' + boardId, e, {
          dedupeKey: 'sync.message.parse|' + boardId,
          dedupeWindowMs: 3000
        });
      }
    };

    syncWs.onerror = function (event) {
      logApiIssue('warn', 'sync.socket', 'WebSocket error for board ' + boardId, formatApiError(event), {
        dedupeKey: 'sync.socket.error|' + boardId,
        dedupeWindowMs: 3000
      });
    };

    syncWs.onclose = function (event) {
      if (event && event.code && event.code !== 1000) {
        logApiIssue('warn', 'sync.socket', 'WebSocket closed unexpectedly for board ' + boardId + ' code=' + event.code + (event.reason ? ' reason=' + event.reason : ''), undefined, {
          dedupeKey: 'sync.socket.close|' + boardId + '|' + event.code + '|' + (event.reason || ''),
          dedupeWindowMs: 3000
        });
      }
      if (typeof lexeraLog === 'function') lexeraLog('info', '[api.sync.close] WebSocket closed');
      syncWs = null;
      if (syncOnPresence && syncShouldReconnect && syncBoardId === boardId) {
        syncOnPresence([]);
      }
      if (syncShouldReconnect && syncBoardId === boardId) {
        scheduleSyncReconnect();
      }
    };
  }

  // ── IPC sync branch (Phase 5b) ─────────────────────────────────────
  // Mirrors `openSyncSocket` but over a Tauri IPC bidirectional stream.
  // Shares the connectSync/sendSync/disconnectSync state vars; only the
  // transport and reconnect logic differ.
  var syncIpcCorrelationId = null;
  var syncIpcReconnectTimer = null;
  var syncIpcReconnectAttempt = 0;

  function clearSyncIpcReconnectTimer() {
    if (syncIpcReconnectTimer) {
      clearTimeout(syncIpcReconnectTimer);
      syncIpcReconnectTimer = null;
    }
  }

  function openSyncIpc() {
    var core = resolveTauriCore();
    if (!core || !syncBoardId || !syncUserId) return;
    if (!isCrdtSyncAvailableSync()) {
      syncShouldReconnect = false;
      return;
    }
    var ChannelCtor = resolveTauriChannelCtor();
    if (!ChannelCtor) {
      logApiIssue('error', 'sync.ipc', 'Tauri Channel unavailable');
      return;
    }
    _registerIpcUnloadHook();
    var boardId = syncBoardId;
    var channel;
    try {
      channel = new ChannelCtor();
    } catch (e) {
      logApiIssue('error', 'sync.ipc', 'Tauri Channel constructor threw', e);
      return;
    }
    channel.onmessage = function (msg) {
      if (msg && msg.end !== undefined && msg.end !== null) {
        syncIpcCorrelationId = null;
        if (syncOnPresence && syncShouldReconnect && syncBoardId === boardId) {
          syncOnPresence([]);
        }
        if (typeof msg.end === 'string') {
          logApiIssue('warn', 'sync.ipc.end', 'sync stream ended: ' + msg.end, undefined, {
            dedupeKey: 'sync.ipc.end|' + boardId,
            dedupeWindowMs: 3000
          });
        }
        if (syncShouldReconnect && syncBoardId === boardId) {
          scheduleSyncIpcReconnect();
        }
        return;
      }
      if (!msg || typeof msg.payload !== 'string') return;
      var parsed;
      try { parsed = JSON.parse(msg.payload); }
      catch (e) {
        logApiIssue('warn', 'sync.ipc.parse', 'Failed to parse sync payload', e, {
          dedupeKey: 'sync.ipc.parse|' + boardId,
          dedupeWindowMs: 3000
        });
        return;
      }
      if (parsed.type === 'ServerHello') {
        var reconnectHello = syncHasConnectedOnce;
        syncHasConnectedOnce = true;
        syncIpcReconnectAttempt = 0;
        if (syncOnUpdate) {
          syncOnUpdate({
            type: 'hello',
            reconnect: reconnectHello,
            updates: parsed.updates || '',
            vv: parsed.vv || ''
          });
        }
      } else if (parsed.type === 'ServerUpdate') {
        if (syncOnUpdate) syncOnUpdate({ type: 'update', updates: parsed.updates || '' });
      } else if (parsed.type === 'ServerPresence') {
        if (syncOnPresence) syncOnPresence(parsed.online_users || []);
      } else if (parsed.type === 'ServerEditingPresence') {
        if (syncOnEditingPresence) syncOnEditingPresence(parsed);
      } else if (parsed.type === 'ServerError') {
        logApiIssue('warn', 'sync.ipc.server-error', 'Server error: ' + parsed.message);
        syncShouldReconnect = false;
        disconnectSync();
      }
    };

    core.invoke('backend_ipc_stream_open', {
      topic: { kind: 'sync', boardId: boardId },
      channel: channel
    }).then(function (id) {
      syncIpcCorrelationId = id;
      var vv = '';
      if (typeof syncHelloVvProvider === 'function') {
        try { vv = syncHelloVvProvider() || ''; }
        catch (e) {
          logApiIssue('warn', 'sync.ipc.hello', 'getHelloVv threw for board ' + boardId, e, {
            dedupeKey: 'sync.ipc.hello|' + boardId,
            dedupeWindowMs: 3000
          });
          vv = '';
        }
      }
      var hello = JSON.stringify({ type: 'ClientHello', user_id: syncUserId, vv: vv });
      return core.invoke('backend_ipc_stream_send', {
        correlationId: id,
        payload: hello
      });
    }).catch(function (e) {
      logApiIssue('error', 'sync.ipc.open', 'backend_ipc_stream_open/send failed for board ' + boardId, e);
      syncIpcCorrelationId = null;
      if (syncShouldReconnect && syncBoardId === boardId) {
        scheduleSyncIpcReconnect();
      }
    });
  }

  function scheduleSyncIpcReconnect() {
    if (!syncShouldReconnect || syncIpcReconnectTimer || !syncBoardId || !syncUserId || !isCrdtSyncAvailableSync()) return;
    var delay = Math.min(1000 * Math.pow(2, syncIpcReconnectAttempt), 30000);
    delay += Math.random() * 0.3 * delay;
    syncIpcReconnectAttempt++;
    syncIpcReconnectTimer = setTimeout(function () {
      syncIpcReconnectTimer = null;
      if (!syncShouldReconnect || syncIpcCorrelationId || !syncBoardId || !syncUserId) return;
      openSyncIpc();
    }, delay);
  }

  /**
   * Connect to the sync transport (WebSocket in HTTP mode, IPC bidirectional
   * stream in local-ipc mode) for a board.
   * @param {string} boardId - The board ID to sync.
   * @param {string} userId - The local user ID.
   * @param {function} onUpdate - Called with no args when a ServerUpdate arrives.
   * @param {function} [onPresence] - Called with array of online user_ids on presence change.
   */
  function connectSync(boardId, userId, onUpdate, onPresence, options) {
    disconnectSync();
    if (!isCrdtSyncAvailableSync()) {
      logApiIssue('info', 'sync.disabled', CRDT_SYNC_DISABLED_MESSAGE, undefined, {
        dedupeKey: 'sync.disabled',
        dedupeWindowMs: 30000
      });
      return false;
    }
    syncBoardId = boardId;
    syncUserId = userId;
    syncOnUpdate = onUpdate;
    syncOnPresence = onPresence || null;
    syncHelloVvProvider = options && typeof options.getHelloVv === 'function'
      ? options.getHelloVv
      : null;
    syncOnEditingPresence = options && typeof options.onEditingPresence === 'function'
      ? options.onEditingPresence
      : null;
    syncShouldReconnect = true;
    syncHasConnectedOnce = false;
    if (getTransportMode() === 'local-ipc') {
      openSyncIpc();
      return;
    }
    if (!baseUrl) return;
    openSyncSocket();
  }

  function sendIpcStreamJson(payload) {
    var core = resolveTauriCore();
    if (!core || !syncIpcCorrelationId) return false;
    core.invoke('backend_ipc_stream_send', {
      correlationId: syncIpcCorrelationId,
      payload: payload
    }).catch(function (e) {
      logApiIssue('warn', 'sync.ipc.send', 'stream_send failed', e, {
        dedupeKey: 'sync.ipc.send.fail',
        dedupeWindowMs: 3000
      });
    });
    return true;
  }

  function sendSyncUpdate(updates) {
    if (!updates) return false;
    var payload = JSON.stringify({ type: 'ClientUpdate', updates: updates });
    if (getTransportMode() === 'local-ipc') {
      return sendIpcStreamJson(payload);
    }
    if (!syncWs || syncWs.readyState !== WebSocket.OPEN) return false;
    syncWs.send(payload);
    return true;
  }

  function sendEditingPresence(cardKid, userName, cursorPos, isTyping) {
    var payload = JSON.stringify({
      type: 'ClientEditingPresence',
      card_kid: cardKid || null,
      user_name: userName || '',
      cursor_pos: typeof cursorPos === 'number' ? cursorPos : null,
      is_typing: !!isTyping,
    });
    if (getTransportMode() === 'local-ipc') {
      return sendIpcStreamJson(payload);
    }
    if (!syncWs || syncWs.readyState !== WebSocket.OPEN) return false;
    syncWs.send(payload);
    return true;
  }

  function disconnectSync() {
    syncShouldReconnect = false;
    syncReconnectAttempt = 0;
    syncIpcReconnectAttempt = 0;
    clearSyncReconnectTimer();
    clearSyncIpcReconnectTimer();
    if (syncWs) {
      syncWs.close();
      syncWs = null;
    }
    if (syncIpcCorrelationId) {
      var core = resolveTauriCore();
      if (core) {
        core.invoke('backend_ipc_stream_close', { correlationId: syncIpcCorrelationId })
          .catch(function () { /* best-effort */ });
      }
      syncIpcCorrelationId = null;
    }
    syncBoardId = null;
    syncUserId = null;
    syncOnUpdate = null;
    syncOnPresence = null;
    syncOnEditingPresence = null;
    syncHelloVvProvider = null;
    syncHasConnectedOnce = false;
  }

  function isSyncConnected() {
    if (getTransportMode() === 'local-ipc') {
      return syncIpcCorrelationId !== null;
    }
    return syncWs !== null && (syncWs.readyState === WebSocket.OPEN || syncWs.readyState === WebSocket.CONNECTING);
  }

  function getSyncBoardId() {
    return syncBoardId;
  }

  // ── Collaboration API helpers ───────────────────────────────────────

  async function getMe() {
    return request('/collab/me');
  }

  async function updateMe(name) {
    return request('/collab/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name }),
    });
  }

  async function getServerInfo() {
    return request('/collab/server-info');
  }

  async function createInvite(boardId, userId, role, maxUses) {
    var body = { role: role };
    if (maxUses && maxUses > 0) body.max_uses = maxUses;
    return request('/collab/rooms/' + boardId + '/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function listInvites(boardId, userId) {
    return request('/collab/rooms/' + boardId + '/invites');
  }

  async function revokeInvite(boardId, token, userId) {
    return request('/collab/rooms/' + boardId + '/invites/' + token, {
      method: 'DELETE',
    });
  }

  async function acceptInvite(token, userId) {
    return request('/collab/invites/' + token + '/accept', { method: 'POST' });
  }

  async function registerUser(user) {
    return request('/collab/users/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
  }

  async function listMembers(boardId, userId) {
    return request('/collab/rooms/' + boardId + '/members');
  }

  async function getPresence(boardId, userId) {
    return request('/collab/rooms/' + boardId + '/presence');
  }

  async function leaveRoom(boardId, userId) {
    return request('/collab/rooms/' + boardId + '/leave', { method: 'POST' });
  }

  async function makePublic(boardId, userId, defaultRole, maxUsers) {
    return request('/collab/rooms/' + boardId + '/make-public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ default_role: defaultRole, max_users: maxUsers || null }),
    });
  }

  async function makePrivate(boardId, userId) {
    return request('/collab/rooms/' + boardId + '/make-public', { method: 'DELETE' });
  }

  async function listPublicRooms() {
    return request('/collab/public-rooms');
  }

  async function joinPublicRoom(boardId, userId) {
    return request('/collab/rooms/' + boardId + '/join-public', { method: 'POST' });
  }

  async function getRemoteBoards() {
    return request('/remote-boards');
  }

  async function getBoardSettings(boardId) {
    return request('/boards/' + boardId + '/settings');
  }

  async function updateBoardSettings(boardId, settings) {
    return request('/boards/' + boardId + '/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  }

  async function getNetworkInterfaces() {
    return request('/collab/network-interfaces');
  }

  async function updateServerConfig(config) {
    var payload = {
      bind_address: config && typeof config.bind_address === 'string'
        ? config.bind_address
        : (config && typeof config.bindAddress === 'string' ? config.bindAddress : ''),
      port: config && typeof config.port === 'number'
        ? config.port
        : Number(config && config.port)
    };
    var result = await request('/collab/server-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (result && typeof result.port === 'number') {
      try {
        var current = new URL(await discover());
        current.port = String(result.port);
        baseUrl = current.origin;
      } catch (err) {
        baseUrl = null;
      }
    }
    return result;
  }

  async function getConnections() {
    return request('/collab/connections');
  }

  async function connectRemote(serverUrl, token) {
    await assertCrdtSyncAvailable();
    return request('/collab/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_url: serverUrl, token: token }),
    });
  }

  async function disconnectRemote(localBoardId) {
    return request('/collab/connect/' + localBoardId, { method: 'DELETE' });
  }

  async function getDiscoveredPeers() {
    return request('/collab/discovered-peers');
  }

  async function getTheme() {
    return request('/config/theme');
  }

  async function setTheme(themeId) {
    return request('/config/theme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: themeId }),
    });
  }

  return {
    discover, request, getBoards, getBoardHierarchy, getBoardHierarchyCached, getBoardChanges, getBoardColumns, getBoardColumnsCached, addCard, saveBoard, saveBoardWithBase, rebaseBoardWithBase, createBoardCrashsave,
    probeExternalEmbed,
    openLiveSyncSession, applyLiveSyncBoard, importLiveSyncUpdates, closeLiveSyncSession, search, getCalendarTasks, getDashboardData,
    checkStatus, getBackendStatus, getBackendCapabilities, isCrdtSyncAvailable, connectSSE, getLogs, connectLogStream, mediaUrl, fileUrl, fileInfo, fileInfoBatch, uploadMedia, addBoard, removeBoard,
    getCaptureHistory, removeCaptureEntry,
    connectSync, disconnectSync, isSyncConnected, getSyncBoardId, sendSyncUpdate, sendEditingPresence,
    getMe, updateMe, getServerInfo,
    createInvite, listInvites, revokeInvite, acceptInvite,
    registerUser, listMembers, getPresence, leaveRoom,
    makePublic, makePrivate, listPublicRooms, joinPublicRoom,
    getRemoteBoards,
    getBoardSettings, updateBoardSettings,
    getNetworkInterfaces, updateServerConfig,
    getConnections, connectRemote, disconnectRemote, getDiscoveredPeers,
    getTheme, setTheme,
    getInFlightCount: getInFlightCount,
    getTransportMode: getTransportMode,
    backendIpcStatus: function () {
      var core = resolveTauriCore();
      if (!core) return Promise.resolve({ state: 'unavailable', reason: 'Tauri core unavailable' });
      return core.invoke('backend_ipc_status');
    },
    _setTestBaseUrl: function(url) {
      baseUrl = url || null;
      backendStatusCache = null;
      backendStatusCacheAt = 0;
    },
    /** Pre-seed the backend status cache so `getBackendStatus()` /
     *  `assertCrdtSyncAvailable()` short-circuit without an extra
     *  fetch in unit tests. Pass `null` to clear. */
    _setTestBackendStatus: function(status) {
      backendStatusCache = status || null;
      backendStatusCacheAt = status ? Date.now() : 0;
    },
    _setTestToken: function(t) { bearerToken = t; bearerTokenPromise = null; },
    _resetTestState: function() {
      clearCachedBackendState();
      recentApiLogAt = Object.create(null);
      inFlightCount = 0;
    },
  };
})();
if (typeof window !== 'undefined') window.LexeraApi = LexeraApi;
