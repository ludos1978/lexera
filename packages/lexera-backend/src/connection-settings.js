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

    setupEventListeners();

    // Poll for connection status updates
    setInterval(loadConnections, 10000);
  }

  async function discoverBackend() {
    var ports = [8083, 8080, 8081, 8082, 9080];
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

    try {
      var result = await apiPut('/collab/server-config', { bind_address: bindAddr, port: port });
      if (result.restart_required) {
        els.serverRestartNote.style.display = '';
      }
    } catch (e) {
      console.warn('Failed to save server config:', e);
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
      var invite = await apiPost('/collab/rooms/' + boardId + '/invites?user=' + encodeURIComponent(me.id), {
        role: 'editor',
      });

      // Show token in the details area
      var detailsEl = document.getElementById('details-' + boardId);
      if (detailsEl) {
        detailsEl.classList.add('expanded');
      }

      var invitesEl = document.getElementById('invites-' + boardId);
      if (invitesEl) {
        var tokenHtml = '<div class="token-field">';
        tokenHtml += '<input type="text" readonly value="' + esc(invite.token) + '" id="token-' + esc(invite.token) + '">';
        tokenHtml += '<button class="btn btn-small" data-action="copy-token" data-token="' + esc(invite.token) + '">Copy</button>';
        tokenHtml += '</div>';
        invitesEl.innerHTML = tokenHtml + (invitesEl.innerHTML.indexOf('list-empty') !== -1 ? '' : invitesEl.innerHTML);
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
        html += '<span>' + esc(inv.role) + ' &middot; ' + inv.uses + '/' + (inv.max_uses || '&infin;') + ' uses</span>';
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
