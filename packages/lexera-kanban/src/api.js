/**
 * HTTP client for Lexera Backend REST API.
 * Auto-discovers the backend by trying common ports, or uses a manually set URL.
 */
const LexeraApi = (function () {
  let baseUrl = null;

  async function discover() {
    if (baseUrl) return baseUrl;
    const ports = [8083, 8080, 8081, 8082, 9080];
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
    const url = await discover();
    if (!url) throw new Error('Backend not available');
    const res = await fetch(url + path, options);
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status}: ${text}`);
    }
    return res.json();
  }

  async function getBoards() {
    return request('/boards');
  }

  async function getBoardColumns(boardId) {
    return request('/boards/' + boardId + '/columns');
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

  async function uploadMedia(boardId, file) {
    var url = await discover();
    if (!url) throw new Error('Backend not available');
    var form = new FormData();
    form.append('file', file, file.name);
    var res = await fetch(url + '/boards/' + boardId + '/media', { method: 'POST', body: form });
    if (!res.ok) {
      var text = await res.text().catch(function () { return res.statusText; });
      throw new Error(res.status + ': ' + text);
    }
    return res.json();
  }

  function connectSSE(onEvent) {
    if (!baseUrl) return null;
    var es = new EventSource(baseUrl + '/events');
    es.onmessage = function (msg) {
      try { onEvent(JSON.parse(msg.data)); } catch (e) { /* ignore parse errors */ }
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

  // ── WebSocket CRDT Sync ─────────────────────────────────────────────

  var syncWs = null;
  var syncBoardId = null;
  var syncOnUpdate = null;

  /**
   * Connect to the WebSocket sync endpoint for a board.
   * @param {string} boardId - The board ID to sync.
   * @param {string} userId - The local user ID.
   * @param {function} onUpdate - Called with no args when a ServerUpdate arrives.
   */
  function connectSync(boardId, userId, onUpdate) {
    disconnectSync();
    if (!baseUrl) return;
    var wsUrl = baseUrl.replace(/^http/, 'ws') + '/sync/' + boardId + '?user=' + encodeURIComponent(userId);
    syncWs = new WebSocket(wsUrl);
    syncBoardId = boardId;
    syncOnUpdate = onUpdate;

    syncWs.onopen = function () {
      // Send ClientHello with empty VV (we don't run a local Loro doc in the frontend)
      var hello = JSON.stringify({ type: 'ClientHello', user_id: userId, vv: '' });
      syncWs.send(hello);
      console.log('[sync] WebSocket connected to board ' + boardId);
    };

    syncWs.onmessage = function (evt) {
      try {
        var msg = JSON.parse(evt.data);
        if (msg.type === 'ServerHello') {
          console.log('[sync] Received ServerHello, peer_id=' + msg.peer_id);
        } else if (msg.type === 'ServerUpdate') {
          if (syncOnUpdate) syncOnUpdate();
        } else if (msg.type === 'ServerError') {
          console.warn('[sync] Server error: ' + msg.message);
          disconnectSync();
        }
      } catch (e) {
        // ignore parse errors
      }
    };

    syncWs.onerror = function () {
      console.warn('[sync] WebSocket error');
    };

    syncWs.onclose = function () {
      console.log('[sync] WebSocket closed');
      syncWs = null;
      syncBoardId = null;
    };
  }

  function disconnectSync() {
    if (syncWs) {
      syncWs.close();
      syncWs = null;
      syncBoardId = null;
      syncOnUpdate = null;
    }
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
    discover, request, getBoards, getBoardColumns, addCard, saveBoard, search,
    checkStatus, connectSSE, mediaUrl, fileUrl, fileInfo, uploadMedia, addBoard, removeBoard,
    connectSync, disconnectSync, isSyncConnected, getSyncBoardId,
    getMe, updateMe, getServerInfo,
    createInvite, listInvites, revokeInvite, acceptInvite,
    registerUser, listMembers, leaveRoom,
    makePublic, makePrivate, listPublicRooms, joinPublicRoom,
    getRemoteBoards,
  };
})();
