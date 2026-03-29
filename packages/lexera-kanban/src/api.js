/**
 * HTTP client for Lexera Backend REST API.
 * Auto-discovers the backend by trying common ports, or uses a manually set URL.
 */
var LexeraApi = (function () {
  let baseUrl = null;
  let bearerToken = null;
  let bearerTokenPromise = null;
  let recentApiLogAt = Object.create(null);

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
    if (bearerTokenPromise) return bearerTokenPromise;
    bearerTokenPromise = (async function () {
      try {
        var url = await discover();
        if (!url) return null;
        var res = await fetch(url + '/collab/me', { signal: AbortSignal.timeout(5000) });
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

  async function request(path, options) {
    const method = options && options.method ? String(options.method).toUpperCase() : 'GET';
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
    if (path !== '/collab/me') {
      await ensureBearerToken();
    }
    var timeoutMs = options && typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, timeoutMs);
    var fetchOptions = Object.assign({}, options, { signal: controller.signal });
    fetchOptions.headers = authHeaders(fetchOptions.headers);
    let res;
    try {
      res = await fetch(url + path, fetchOptions);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        var timeoutError = new Error('Request timed out: ' + method + ' ' + path);
        logApiIssue('error', 'api.request', method + ' ' + path + ' timed out after ' + timeoutMs + 'ms', timeoutError);
        throw timeoutError;
      }
      logApiIssue('error', 'api.request', method + ' ' + path + ' transport failed', error);
      throw error;
    }
    clearTimeout(timeoutId);
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
      logApiIssue(res.status >= 500 ? 'error' : 'warn', 'api.request', method + ' ' + path + ' failed: ' + errorMsg, error);
      throw error;
    }
    try {
      return await res.json();
    } catch (error) {
      logApiIssue('error', 'api.request', method + ' ' + path + ' returned invalid JSON', error);
      throw error;
    }
  }

  async function getBoards() {
    return request('/boards');
  }

  async function getBoardColumns(boardId) {
    return request('/boards/' + boardId + '/columns');
  }

  async function getBoardColumnsCached(boardId, revision) {
    const url = await discover();
    if (!url) {
      const error = new Error('Backend not available');
      logApiIssue('error', 'api.getBoardColumnsCached', 'GET /boards/' + boardId + '/columns failed: backend not available', error, {
        dedupeKey: 'api.getBoardColumnsCached.no-backend|' + boardId,
        dedupeWindowMs: 3000
      });
      throw error;
    }
    await ensureBearerToken();
    const headers = authHeaders();
    if (revision != null) headers['If-None-Match'] = '"' + revision + '"';
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, DEFAULT_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url + '/boards/' + boardId + '/columns', { headers, signal: controller.signal });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        var timeoutError = new Error('Request timed out: GET /boards/' + boardId + '/columns');
        logApiIssue('error', 'api.getBoardColumnsCached', 'GET /boards/' + boardId + '/columns timed out after ' + DEFAULT_TIMEOUT_MS + 'ms', timeoutError);
        throw timeoutError;
      }
      logApiIssue('error', 'api.getBoardColumnsCached', 'GET /boards/' + boardId + '/columns transport failed', error);
      throw error;
    }
    clearTimeout(timeoutId);
    if (res.status === 304) {
      return { notModified: true, version: revision };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      const error = new Error(`${res.status}: ${text}`);
      logApiIssue(res.status >= 500 ? 'error' : 'warn', 'api.getBoardColumnsCached', 'GET /boards/' + boardId + '/columns failed', error);
      throw error;
    }
    try {
      return await res.json();
    } catch (error) {
      logApiIssue('error', 'api.getBoardColumnsCached', 'GET /boards/' + boardId + '/columns returned invalid JSON', error);
      throw error;
    }
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
    return request('/search?' + params.toString(), { timeoutMs: DASHBOARD_TIMEOUT_MS });
  }

  async function getCalendarTasks() {
    return request('/calendar/tasks', { timeoutMs: DASHBOARD_TIMEOUT_MS });
  }

  async function checkStatus() {
    try {
      const url = await discover();
      if (!url) return false;
      const res = await fetch(url + '/status', { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
      return res.ok;
    } catch (error) {
      logApiIssue('warn', 'api.status', 'Status check failed', error, {
        dedupeKey: 'api.status',
        dedupeWindowMs: 30000
      });
      return false;
    }
  }

  function mediaUrl(boardId, filename) {
    return appendAuthTokenQuery((baseUrl || '') + '/boards/' + boardId + '/media/' + encodeURIComponent(filename));
  }

  function fileUrl(boardId, path) {
    return appendAuthTokenQuery((baseUrl || '') + '/boards/' + boardId + '/file?path=' + encodeURIComponent(path));
  }

  async function fileInfo(boardId, path) {
    return request('/boards/' + boardId + '/file-info?path=' + encodeURIComponent(path));
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

  async function uploadMedia(boardId, file) {
    var url = await discover();
    if (!url) {
      var unavailable = new Error('Backend not available');
      logApiIssue('error', 'api.uploadMedia', 'POST /boards/' + boardId + '/media failed: backend not available', unavailable, {
        dedupeKey: 'api.uploadMedia.no-backend|' + boardId,
        dedupeWindowMs: 3000
      });
      throw unavailable;
    }
    await ensureBearerToken();
    var form = new FormData();
    form.append('file', file, file.name);
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, LONG_TIMEOUT_MS);
    var uploadHeaders = authHeaders();
    var res;
    try {
      res = await fetch(url + '/boards/' + boardId + '/media', { method: 'POST', body: form, headers: uploadHeaders, signal: controller.signal });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        var timeoutError = new Error('Request timed out: POST /boards/' + boardId + '/media');
        logApiIssue('error', 'api.uploadMedia', 'POST /boards/' + boardId + '/media timed out after ' + LONG_TIMEOUT_MS + 'ms', timeoutError);
        throw timeoutError;
      }
      logApiIssue('error', 'api.uploadMedia', 'POST /boards/' + boardId + '/media transport failed', error);
      throw error;
    }
    clearTimeout(timeoutId);
    if (!res.ok) {
      var text = await res.text().catch(function () { return res.statusText; });
      var error = new Error(res.status + ': ' + text);
      logApiIssue(res.status >= 500 ? 'error' : 'warn', 'api.uploadMedia', 'POST /boards/' + boardId + '/media failed', error);
      throw error;
    }
    try {
      return await res.json();
    } catch (error) {
      logApiIssue('error', 'api.uploadMedia', 'POST /boards/' + boardId + '/media returned invalid JSON', error);
      throw error;
    }
  }

  function connectSSE(onEvent) {
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
    if (!syncShouldReconnect || syncReconnectTimer || !syncBoardId || !syncUserId || !baseUrl) return;
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

  /**
   * Connect to the WebSocket sync endpoint for a board.
   * @param {string} boardId - The board ID to sync.
   * @param {string} userId - The local user ID.
   * @param {function} onUpdate - Called with no args when a ServerUpdate arrives.
   * @param {function} [onPresence] - Called with array of online user_ids on presence change.
   */
  function connectSync(boardId, userId, onUpdate, onPresence, options) {
    disconnectSync();
    if (!baseUrl) return;
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
    openSyncSocket();
  }

  function sendSyncUpdate(updates) {
    if (!updates || !syncWs || syncWs.readyState !== WebSocket.OPEN) return false;
    syncWs.send(JSON.stringify({
      type: 'ClientUpdate',
      updates: updates,
    }));
    return true;
  }

  function sendEditingPresence(cardKid, userName, cursorPos, isTyping) {
    if (!syncWs || syncWs.readyState !== WebSocket.OPEN) return false;
    syncWs.send(JSON.stringify({
      type: 'ClientEditingPresence',
      card_kid: cardKid || null,
      user_name: userName || '',
      cursor_pos: typeof cursorPos === 'number' ? cursorPos : null,
      is_typing: !!isTyping,
    }));
    return true;
  }

  function disconnectSync() {
    syncShouldReconnect = false;
    syncReconnectAttempt = 0;
    clearSyncReconnectTimer();
    if (syncWs) {
      syncWs.close();
      syncWs = null;
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
    return syncWs !== null && syncWs.readyState === WebSocket.OPEN;
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
    discover, request, getBoards, getBoardColumns, getBoardColumnsCached, addCard, saveBoard, saveBoardWithBase, rebaseBoardWithBase, createBoardCrashsave,
    probeExternalEmbed,
    openLiveSyncSession, applyLiveSyncBoard, importLiveSyncUpdates, closeLiveSyncSession, search, getCalendarTasks,
    checkStatus, connectSSE, getLogs, connectLogStream, mediaUrl, fileUrl, fileInfo, uploadMedia, addBoard, removeBoard,
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
    _setTestToken: function(t) { bearerToken = t; bearerTokenPromise = null; },
  };
})();
if (typeof window !== 'undefined') window.LexeraApi = LexeraApi;
