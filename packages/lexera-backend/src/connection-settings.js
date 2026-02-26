/**
 * Connection Settings — UI for managing collaboration connections.
 * Discovers local backend via port scanning (same pattern as quick-capture.js).
 * Calls REST API for all collab operations.
 */
(function () {
  'use strict';

  var baseUrl = '';
  var me = null;

  var els = {
    inputName: document.getElementById('input-name'),
    btnSaveName: document.getElementById('btn-save-name'),
    selectBind: document.getElementById('select-bind'),
    customBindRow: document.getElementById('custom-bind-row'),
    inputBindCustom: document.getElementById('input-bind-custom'),
    selectPort: document.getElementById('select-port'),
    customPortRow: document.getElementById('custom-port-row'),
    inputPortCustom: document.getElementById('input-port-custom'),
    btnSaveServer: document.getElementById('btn-save-server'),
    serverAddress: document.getElementById('server-address'),
    serverRestartNote: document.getElementById('server-restart-note'),
    myBoardsList: document.getElementById('my-boards-list'),
    connectionsList: document.getElementById('connections-list'),
    peersList: document.getElementById('peers-list'),
    inputJoinUrl: document.getElementById('input-join-url'),
    inputJoinToken: document.getElementById('input-join-token'),
    btnJoin: document.getElementById('btn-join'),
    joinStatus: document.getElementById('join-status'),
  };

  // --- Init ---

  async function init() {
    baseUrl = await discoverBackend();
    if (!baseUrl) {
      els.myBoardsList.innerHTML = '<div class="list-empty">Cannot connect to backend</div>';
      return;
    }

    await loadIdentity();
    await loadServerInfo();
    await loadNetworkInterfaces();
    await loadMyBoards();
    await loadConnections();
    await loadDiscoveredPeers();

    setupEventListeners();

    // Poll for connection status and peer discovery
    setInterval(loadConnections, 10000);
    setInterval(loadDiscoveredPeers, 5000);
  }

  async function discoverBackend() {
    // Try Tauri command first (reads shared config)
    try {
      if (window.__TAURI_INTERNALS__) {
        var url = await window.__TAURI_INTERNALS__.invoke('get_backend_url');
        if (url) {
          var res = await fetch(url + '/status', { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            var data = await res.json();
            if (data.status === 'running') return url;
          }
        }
      }
    } catch (e) { /* fall through */ }

    // Fallback: port scanning
    var ports = [13080, 12080, 14080, 11080, 15080];
    for (var i = 0; i < ports.length; i++) {
      try {
        var res = await fetch('http://localhost:' + ports[i] + '/status', { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          var data = await res.json();
          if (data.status === 'running' && data.port) {
            return 'http://localhost:' + data.port;
          }
        }
      } catch (e) { /* next port */ }
    }
    return null;
  }

  async function apiGet(path) {
    var res = await fetch(baseUrl + path);
    if (!res.ok) throw new Error(res.status + ': ' + (await res.text()));
    return res.json();
  }

  async function apiPost(path, body) {
    var res = await fetch(baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.status + ': ' + (await res.text()));
    return res.json();
  }

  async function apiDelete(path) {
    var res = await fetch(baseUrl + path, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.status + ': ' + (await res.text()));
    return res.json();
  }

  async function apiPut(path, body) {
    var res = await fetch(baseUrl + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.status + ': ' + (await res.text()));
    return res.json();
  }

  // --- Identity ---

  async function loadIdentity() {
    try {
      me = await apiGet('/collab/me');
      els.inputName.value = me.name || '';
    } catch (e) {
      console.warn('Failed to load identity:', e);
    }
  }

  async function saveName() {
    var name = els.inputName.value.trim();
    if (!name) return;
    try {
      me = await fetch(baseUrl + '/collab/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name }),
      }).then(function (r) { return r.json(); });
      els.inputName.value = me.name;
    } catch (e) {
      console.warn('Failed to save name:', e);
    }
  }

  // --- Server Info ---

  var currentConfig = null;

  async function loadServerInfo() {
    try {
      var info = await apiGet('/collab/server-info');
      currentConfig = { bind_address: info.bind_address || info.address, port: info.port };
      els.serverAddress.textContent = 'http://' + info.address + ':' + info.port;
    } catch (e) {
      els.serverAddress.textContent = 'Could not determine server address';
    }
  }

  async function loadNetworkInterfaces() {
    try {
      var data = await apiGet('/collab/network-interfaces');
      var interfaces = data.interfaces || [];
      populateBindSelect(interfaces, data.current_bind_address);
      populatePortSelect(data.default_port || 8080, data.current_port);
    } catch (e) {
      console.warn('Failed to load network interfaces:', e);
    }
  }

  function populateBindSelect(interfaces, currentBind) {
    var select = els.selectBind;
    select.innerHTML = '';

    var found = false;
    for (var i = 0; i < interfaces.length; i++) {
      var iface = interfaces[i];
      var opt = document.createElement('option');
      opt.value = iface.address;
      opt.textContent = iface.label + ' (' + iface.address + ')';
      select.appendChild(opt);
      if (iface.address === currentBind) {
        found = true;
      }
    }

    // Add "Custom" option
    var customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = 'Custom...';
    select.appendChild(customOpt);

    // Select current value
    if (currentBind && found) {
      select.value = currentBind;
    } else if (currentBind && !found) {
      select.value = '__custom__';
      els.inputBindCustom.value = currentBind;
      els.customBindRow.style.display = '';
    }
  }

  function populatePortSelect(defaultPort, currentPort) {
    var select = els.selectPort;
    select.innerHTML = '';

    var defaultOpt = document.createElement('option');
    defaultOpt.value = String(defaultPort);
    defaultOpt.textContent = 'Default (' + defaultPort + ')';
    select.appendChild(defaultOpt);

    var customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = 'Custom...';
    select.appendChild(customOpt);

    // Select current value
    if (currentPort && currentPort !== defaultPort) {
      select.value = '__custom__';
      els.inputPortCustom.value = currentPort;
      els.customPortRow.style.display = '';
    }
  }

  async function saveServerConfig() {
    var bindAddr = els.selectBind.value;
    if (bindAddr === '__custom__') {
      bindAddr = els.inputBindCustom.value.trim();
      if (!bindAddr) return;
    }

    var portVal = els.selectPort.value;
    var port;
    if (portVal === '__custom__') {
      port = parseInt(els.inputPortCustom.value, 10);
      if (isNaN(port) || port < 1024 || port > 65535) return;
    } else {
      port = parseInt(portVal, 10);
    }

    els.serverRestartNote.textContent = 'Applying...';
    els.serverRestartNote.style.display = '';
    try {
      var result = await apiPut('/collab/server-config', { bind_address: bindAddr, port: port });
      // Server returned the new port after live restart
      var newPort = result.port || port;
      var host = (bindAddr === '0.0.0.0') ? '127.0.0.1' : bindAddr;
      BASE_URL = 'http://' + host + ':' + newPort;
      await loadServerInfo();
      await loadNetworkInterfaces();
      els.serverRestartNote.textContent = 'Server restarted on port ' + newPort;
      setTimeout(function() { els.serverRestartNote.style.display = 'none'; }, 5000);
    } catch (e) {
      // Connection may have been lost during restart — try to reconnect
      console.warn('Config save response lost, reconnecting...', e);
      els.serverRestartNote.textContent = 'Reconnecting...';
      var host = (bindAddr === '0.0.0.0') ? '127.0.0.1' : bindAddr;
      var reconnected = false;
      // Try the target port first, then fallback to discovery
      for (var attempt = 0; attempt < 10; attempt++) {
        await new Promise(function(r) { setTimeout(r, 500); });
        try {
          var res = await fetch('http://' + host + ':' + port + '/status', { signal: AbortSignal.timeout(1000) });
          if (res.ok) {
            var data = await res.json();
            if (data.status === 'running') {
              BASE_URL = 'http://' + host + ':' + data.port;
              reconnected = true;
              break;
            }
          }
        } catch (_) { /* still restarting */ }
      }
      if (!reconnected) {
        var newBase = await discoverBackend();
        if (newBase) {
          BASE_URL = newBase;
          reconnected = true;
        }
      }
      if (reconnected) {
        await loadServerInfo();
        await loadNetworkInterfaces();
        els.serverRestartNote.textContent = 'Reconnected to ' + BASE_URL;
      } else {
        els.serverRestartNote.textContent = 'Could not reconnect after restart';
      }
      setTimeout(function() { els.serverRestartNote.style.display = 'none'; }, 5000);
    }
  }

  // --- My Boards ---

  async function loadMyBoards() {
    try {
      var data = await apiGet('/boards');
      var boards = data.boards || [];
      renderMyBoards(boards);
    } catch (e) {
      els.myBoardsList.innerHTML = '<div class="list-empty">Failed to load boards</div>';
    }
  }

  function renderMyBoards(boards) {
    if (boards.length === 0) {
      els.myBoardsList.innerHTML = '<div class="list-empty">No boards</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < boards.length; i++) {
      var b = boards[i];
      var boardName = b.title || b.filePath.split('/').pop().replace('.md', '') || 'Untitled';
      html += '<div class="board-row" data-board-id="' + esc(b.id) + '">';
      html += '<span class="board-row-name">' + esc(boardName) + '</span>';
      html += '<div class="board-row-actions">';
      html += '<button class="btn btn-small" data-action="toggle-details" data-board-id="' + esc(b.id) + '">Details</button>';
      html += '<select class="field-select field-select-small" id="role-' + esc(b.id) + '">';
      html += '<option value="editor">Editor</option>';
      html += '<option value="viewer">Viewer</option>';
      html += '</select>';
      html += '<button class="btn btn-small btn-primary" data-action="create-invite" data-board-id="' + esc(b.id) + '">Invite</button>';
      html += '</div>';
      html += '</div>';
      html += '<div class="board-details" id="details-' + esc(b.id) + '">';
      html += '<div class="detail-group">';
      html += '<div class="detail-group-title">Invites</div>';
      html += '<div id="invites-' + esc(b.id) + '"><span class="list-empty">Click to load</span></div>';
      html += '</div>';
      html += '<div class="detail-group">';
      html += '<div class="detail-group-title">Members</div>';
      html += '<div id="members-' + esc(b.id) + '"><span class="list-empty">Click to load</span></div>';
      html += '</div>';
      html += '</div>';
    }
    els.myBoardsList.innerHTML = html;
  }

  async function createInvite(boardId) {
    if (!me) return;
    try {
      var roleSelect = document.getElementById('role-' + boardId);
      var role = roleSelect ? roleSelect.value : 'editor';

      var invite = await apiPost('/collab/rooms/' + boardId + '/invites?user=' + encodeURIComponent(me.id), {
        role: role,
      });

      // Expand details and reload invites (which now show tokens)
      var detailsEl = document.getElementById('details-' + boardId);
      if (detailsEl) {
        detailsEl.classList.add('expanded');
      }

      await loadInvites(boardId);
    } catch (e) {
      console.warn('Failed to create invite:', e);
    }
  }

  async function loadInvites(boardId) {
    if (!me) return;
    try {
      var invites = await apiGet('/collab/rooms/' + boardId + '/invites?user=' + encodeURIComponent(me.id));
      var el = document.getElementById('invites-' + boardId);
      if (!el) return;

      if (invites.length === 0) {
        el.innerHTML = '<span class="list-empty">No active invites</span>';
        return;
      }

      var html = '';
      for (var i = 0; i < invites.length; i++) {
        var inv = invites[i];
        html += '<div class="detail-item">';
        html += '<div class="invite-info">';
        html += '<span>' + esc(inv.role) + ' &middot; ' + inv.uses + '/' + (inv.max_uses || '&infin;') + ' uses</span>';
        html += '<div class="token-field">';
        html += '<input type="text" readonly value="' + esc(inv.token) + '" id="token-' + esc(inv.token) + '">';
        html += '<button class="btn btn-small" data-action="copy-token" data-token="' + esc(inv.token) + '">Copy</button>';
        html += '</div>';
        html += '</div>';
        html += '<button class="btn btn-small btn-danger" data-action="revoke-invite" data-board-id="' + esc(boardId) + '" data-token="' + esc(inv.token) + '">Revoke</button>';
        html += '</div>';
      }
      el.innerHTML = html;
    } catch (e) {
      console.warn('Failed to load invites:', e);
    }
  }

  async function loadMembers(boardId) {
    if (!me) return;
    try {
      var members = await apiGet('/collab/rooms/' + boardId + '/members?user=' + encodeURIComponent(me.id));
      var el = document.getElementById('members-' + boardId);
      if (!el) return;

      if (members.length === 0) {
        el.innerHTML = '<span class="list-empty">No members</span>';
        return;
      }

      var html = '';
      for (var i = 0; i < members.length; i++) {
        var m = members[i];
        html += '<div class="detail-item">';
        html += '<span>' + esc(m.user_name || m.user_id) + '</span>';
        html += '<span style="color:var(--text-secondary);font-size:11px;">' + esc(m.role) + '</span>';
        html += '</div>';
      }
      el.innerHTML = html;
    } catch (e) {
      console.warn('Failed to load members:', e);
    }
  }

  // --- Remote Connections ---

  async function loadConnections() {
    try {
      var connections = await apiGet('/collab/connections');
      renderConnections(connections);
    } catch (e) {
      els.connectionsList.innerHTML = '<div class="list-empty">Failed to load connections</div>';
    }
  }

  function renderConnections(connections) {
    if (connections.length === 0) {
      els.connectionsList.innerHTML = '<div class="list-empty">No remote connections</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < connections.length; i++) {
      var c = connections[i];
      var isOk = c.status === 'connected';
      html += '<div class="connection-row">';
      html += '<div class="connection-info">';
      html += '<div class="connection-url"><span class="connection-status ' + (isOk ? 'ok' : 'err') + '"></span>' + esc(c.server_url) + '</div>';
      html += '<div class="connection-board">Board: ' + esc(c.remote_board_id) + '</div>';
      html += '</div>';
      html += '<button class="btn btn-small btn-danger" data-action="disconnect" data-local-board-id="' + esc(c.local_board_id) + '">Disconnect</button>';
      html += '</div>';
    }
    els.connectionsList.innerHTML = html;
  }

  // --- Discovered Peers ---

  async function loadDiscoveredPeers() {
    try {
      var peers = await apiGet('/collab/discovered-peers');
      renderPeers(peers);
    } catch (e) {
      els.peersList.innerHTML = '<div class="list-empty">Discovery unavailable</div>';
    }
  }

  function renderPeers(peers) {
    if (peers.length === 0) {
      els.peersList.innerHTML = '<div class="list-empty">No peers found on LAN</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < peers.length; i++) {
      var p = peers[i];
      html += '<div class="peer-row">';
      html += '<div class="peer-info">';
      html += '<div class="peer-name">' + esc(p.user_name) + '</div>';
      html += '<div class="peer-url">' + esc(p.url) + '</div>';
      html += '</div>';
      html += '<button class="btn btn-small btn-primary" data-action="use-peer" data-peer-url="' + esc(p.url) + '">Use</button>';
      html += '</div>';
    }
    els.peersList.innerHTML = html;
  }

  // --- Join Remote Board ---

  async function joinRemote() {
    var serverUrl = els.inputJoinUrl.value.trim();
    var token = els.inputJoinToken.value.trim();

    if (!serverUrl || !token) {
      setJoinStatus('Please fill in both fields', 'error');
      return;
    }

    setJoinStatus('Connecting...', '');

    try {
      var result = await apiPost('/collab/connect', {
        server_url: serverUrl,
        token: token,
      });
      setJoinStatus('Connected! Board: ' + result.local_board_id, 'success');
      els.inputJoinUrl.value = '';
      els.inputJoinToken.value = '';
      await loadConnections();
    } catch (e) {
      setJoinStatus(e.message, 'error');
    }
  }

  async function disconnectRemote(localBoardId) {
    try {
      await apiDelete('/collab/connect/' + localBoardId);
      await loadConnections();
    } catch (e) {
      console.warn('Failed to disconnect:', e);
    }
  }

  function setJoinStatus(msg, type) {
    els.joinStatus.textContent = msg;
    els.joinStatus.className = 'status-text' + (type ? ' ' + type : '');
  }

  // --- Event Handling ---

  function setupEventListeners() {
    els.btnSaveName.addEventListener('click', saveName);
    els.inputName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') saveName();
    });

    els.selectBind.addEventListener('change', function () {
      els.customBindRow.style.display = els.selectBind.value === '__custom__' ? '' : 'none';
    });
    els.selectPort.addEventListener('change', function () {
      els.customPortRow.style.display = els.selectPort.value === '__custom__' ? '' : 'none';
    });
    els.btnSaveServer.addEventListener('click', saveServerConfig);

    els.btnJoin.addEventListener('click', joinRemote);
    els.inputJoinToken.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') joinRemote();
    });

    // Delegate clicks for dynamic content
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;

      var action = btn.getAttribute('data-action');
      var boardId = btn.getAttribute('data-board-id');
      var token = btn.getAttribute('data-token');
      var localBoardId = btn.getAttribute('data-local-board-id');

      if (action === 'toggle-details') {
        var details = document.getElementById('details-' + boardId);
        if (details) {
          var isExpanding = !details.classList.contains('expanded');
          details.classList.toggle('expanded');
          if (isExpanding) {
            loadInvites(boardId);
            loadMembers(boardId);
          }
        }
      } else if (action === 'create-invite') {
        createInvite(boardId);
      } else if (action === 'revoke-invite') {
        if (!me) return;
        apiDelete('/collab/rooms/' + boardId + '/invites/' + token + '?user=' + encodeURIComponent(me.id))
          .then(function () { loadInvites(boardId); })
          .catch(function (err) { console.warn('Revoke failed:', err); });
      } else if (action === 'copy-token') {
        var input = document.getElementById('token-' + token);
        if (input) {
          input.select();
          navigator.clipboard.writeText(input.value).catch(function () {});
        }
      } else if (action === 'disconnect') {
        disconnectRemote(localBoardId);
      } else if (action === 'use-peer') {
        var peerUrl = btn.getAttribute('data-peer-url');
        if (peerUrl) {
          els.inputJoinUrl.value = peerUrl;
          els.inputJoinToken.focus();
        }
      }
    });
  }

  // --- Helpers ---

  function esc(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Start ---
  init();
})();
