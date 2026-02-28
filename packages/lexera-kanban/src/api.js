/**
 * HTTP client for Lexera Backend REST API.
 * Auto-discovers the backend by trying common ports, or uses a manually set URL.
 */
const LexeraApi = (function () {
  let baseUrl = null;
  let recentApiLogAt = Object.create(null);

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

    var fullMessage = '[' + target + '] ' + message;
    if (typeof error === 'undefined') {
      if (level === 'error') console.error(fullMessage);
      else console.warn(fullMessage);
      return;
    }
    if (level === 'error') console.error(fullMessage, error);
    else console.warn(fullMessage, error);
  }

  async function discover() {
    if (baseUrl) return baseUrl;

    // Try Tauri command first (reads shared config file)
    try {
      if (window.__TAURI_INTERNALS__) {
        const url = await window.__TAURI_INTERNALS__.invoke('get_backend_url');
        if (url) {
          // Verify the backend is actually running at this URL
          const res = await fetch(url + '/status', { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'running') {
              baseUrl = url;
              return baseUrl;
            }
          }
        }
      }
    } catch (e) {
      // Fall through to port scanning
    }

    // Fallback: port scanning (for browser mode or if config read fails)
    const ports = [13080, 12080, 14080, 11080, 15080];
    for (const port of ports) {
      try {
        const res = await fetch(`http://localhost:${port}/status`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'running') {
            baseUrl = `http://localhost:${data.port}`;
            return baseUrl;
          }
        }
      } catch (e) {
        // Try next port
      }
    }
    return null;
  }

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
    let res;
    try {
      res = await fetch(url + path, options);
    } catch (error) {
      logApiIssue('error', 'api.request', method + ' ' + path + ' transport failed', error);
      throw error;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      const error = new Error(`${res.status}: ${text}`);
      logApiIssue(res.status >= 500 ? 'error' : 'warn', 'api.request', method + ' ' + path + ' failed', error);
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

  async function getBoardColumnsCached(boardId, version) {
    const url = await discover();
    if (!url) {
      const error = new Error('Backend not available');
      logApiIssue('error', 'api.getBoardColumnsCached', 'GET /boards/' + boardId + '/columns failed: backend not available', error, {
        dedupeKey: 'api.getBoardColumnsCached.no-backend|' + boardId,
        dedupeWindowMs: 3000
      });
      throw error;
    }
    const headers = {};
    if (version != null) headers['If-None-Match'] = '"' + version + '"';
    let res;
    try {
      res = await fetch(url + '/boards/' + boardId + '/columns', { headers });
    } catch (error) {
      logApiIssue('error', 'api.getBoardColumnsCached', 'GET /boards/' + boardId + '/columns transport failed', error);
      throw error;
    }
    if (res.status === 304) {
      return { notModified: true, version };
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
    return request('/search?' + params.toString());
  }

  async function checkStatus() {
    try {
      const url = await discover();
      if (!url) return false;
      const res = await fetch(url + '/status');
      return res.ok;
    } catch { return false; }
  }

  function mediaUrl(boardId, filename) {
    return (baseUrl || '') + '/boards/' + boardId + '/media/' + encodeURIComponent(filename);
  }

  function fileUrl(boardId, path) {
    return (baseUrl || '') + '/boards/' + boardId + '/file?path=' + encodeURIComponent(path);
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
    var form = new FormData();
    form.append('file', file, file.name);
    var res;
    try {
      res = await fetch(url + '/boards/' + boardId + '/media', { method: 'POST', body: form });
    } catch (error) {
      logApiIssue('error', 'api.uploadMedia', 'POST /boards/' + boardId + '/media transport failed', error);
      throw error;
    }
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
    var es = new EventSource(baseUrl + '/events');
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
  var syncHelloVvProvider = null;
  var syncReconnectTimer = null;
  var syncShouldReconnect = false;
  var syncHasConnectedOnce = false;

  function clearSyncReconnectTimer() {
    if (syncReconnectTimer) {
      clearTimeout(syncReconnectTimer);
      syncReconnectTimer = null;
    }
  }

  function scheduleSyncReconnect() {
    if (!syncShouldReconnect || syncReconnectTimer || !syncBoardId || !syncUserId || !baseUrl) return;
    syncReconnectTimer = setTimeout(function () {
      syncReconnectTimer = null;
      if (!syncShouldReconnect || syncWs || !syncBoardId || !syncUserId || !baseUrl) return;
      openSyncSocket();
    }, 1500);
  }

  function openSyncSocket() {
    if (!baseUrl || !syncBoardId || !syncUserId) return;
    var wsUrl = baseUrl.replace(/^http/, 'ws') + '/sync/' + syncBoardId + '?user=' + encodeURIComponent(syncUserId);
    var boardId = syncBoardId;
    syncWs = new WebSocket(wsUrl);

    syncWs.onopen = function () {
      clearSyncReconnectTimer();
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
      console.log('[sync] WebSocket connected to board ' + boardId);
    };

    syncWs.onmessage = function (evt) {
      try {
        var msg = JSON.parse(evt.data);
        if (msg.type === 'ServerHello') {
          var reconnectHello = syncHasConnectedOnce;
          syncHasConnectedOnce = true;
          console.log('[sync] Received ServerHello, peer_id=' + msg.peer_id);
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
        } else if (msg.type === 'ServerError') {
          console.warn('[sync] Server error: ' + msg.message);
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
      console.warn('[sync] WebSocket error');
    };

    syncWs.onclose = function (event) {
      if (event && event.code && event.code !== 1000) {
        logApiIssue('warn', 'sync.socket', 'WebSocket closed unexpectedly for board ' + boardId + ' code=' + event.code + (event.reason ? ' reason=' + event.reason : ''), undefined, {
          dedupeKey: 'sync.socket.close|' + boardId + '|' + event.code + '|' + (event.reason || ''),
          dedupeWindowMs: 3000
        });
      }
      console.log('[sync] WebSocket closed');
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

  function disconnectSync() {
    syncShouldReconnect = false;
    clearSyncReconnectTimer();
    if (syncWs) {
      syncWs.close();
      syncWs = null;
    }
    syncBoardId = null;
    syncUserId = null;
    syncOnUpdate = null;
    syncOnPresence = null;
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
    return request('/collab/rooms/' + boardId + '/invites?user=' + encodeURIComponent(userId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function listInvites(boardId, userId) {
    return request('/collab/rooms/' + boardId + '/invites?user=' + encodeURIComponent(userId));
  }

  async function revokeInvite(boardId, token, userId) {
    return request('/collab/rooms/' + boardId + '/invites/' + token + '?user=' + encodeURIComponent(userId), {
      method: 'DELETE',
    });
  }

  async function acceptInvite(token, userId) {
    return request('/collab/invites/' + token + '/accept?user=' + encodeURIComponent(userId), { method: 'POST' });
  }

  async function registerUser(user) {
    return request('/collab/users/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
  }

  async function listMembers(boardId, userId) {
    return request('/collab/rooms/' + boardId + '/members?user=' + encodeURIComponent(userId));
  }

  async function getPresence(boardId, userId) {
    return request('/collab/rooms/' + boardId + '/presence?user=' + encodeURIComponent(userId));
  }

  async function leaveRoom(boardId, userId) {
    return request('/collab/rooms/' + boardId + '/leave?user=' + encodeURIComponent(userId), { method: 'POST' });
  }

  async function makePublic(boardId, userId, defaultRole, maxUsers) {
    return request('/collab/rooms/' + boardId + '/make-public?user=' + encodeURIComponent(userId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ default_role: defaultRole, max_users: maxUsers || null }),
    });
  }

  async function makePrivate(boardId, userId) {
    return request('/collab/rooms/' + boardId + '/make-public?user=' + encodeURIComponent(userId), { method: 'DELETE' });
  }

  async function listPublicRooms() {
    return request('/collab/public-rooms');
  }

  async function joinPublicRoom(boardId, userId) {
    return request('/collab/rooms/' + boardId + '/join-public?user=' + encodeURIComponent(userId), { method: 'POST' });
  }

  async function getRemoteBoards() {
    return request('/remote-boards');
  }

  return {
    discover, request, getBoards, getBoardColumns, getBoardColumnsCached, addCard, saveBoard, saveBoardWithBase,
    openLiveSyncSession, applyLiveSyncBoard, importLiveSyncUpdates, closeLiveSyncSession, search,
    checkStatus, connectSSE, getLogs, connectLogStream, mediaUrl, fileUrl, fileInfo, uploadMedia, addBoard, removeBoard,
    connectSync, disconnectSync, isSyncConnected, getSyncBoardId, sendSyncUpdate,
    getMe, updateMe, getServerInfo,
    createInvite, listInvites, revokeInvite, acceptInvite,
    registerUser, listMembers, getPresence, leaveRoom,
    makePublic, makePrivate, listPublicRooms, joinPublicRoom,
    getRemoteBoards,
  };
})();
