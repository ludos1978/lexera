/**
 * Management — UI for managing boards, collaboration, and connections.
 * Discovers local backend via port scanning (same pattern as quick-capture.js).
 * Calls REST API for all operations.
 */
(function () {
  'use strict';

  var baseUrl = '';
  var me = null;

  // Board settings field definitions (shared with kanban)
  var BOARD_SETTINGS_FIELDS = [
    { key: 'columnWidth', label: 'Column Width', placeholder: '280px', type: 'text' },
    { key: 'layoutRows', label: 'Layout Rows', placeholder: '', type: 'number' },
    { key: 'layoutPreset', label: 'Layout Preset', placeholder: 'compact / spacious / custom', type: 'text' },
    { key: 'fontSize', label: 'Font Size', placeholder: '13px', type: 'text' },
    { key: 'fontFamily', label: 'Font Family', placeholder: '', type: 'select', options: [
      '', 'Poppins', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Nunito', 'Source Sans Pro',
      'SF Pro Display', 'Helvetica Neue', 'Arial', 'Segoe UI', 'Verdana',
      'Georgia', 'Times New Roman', 'Courier New', 'monospace', 'system-ui'
    ] },
    { key: 'rowHeight', label: 'Row Height', placeholder: 'auto', type: 'text' },
    { key: 'maxRowHeight', label: 'Max Row Height (px)', placeholder: '', type: 'number' },
    { key: 'cardMinHeight', label: 'Card Min Height', placeholder: 'auto', type: 'text' },
    { key: 'tagVisibility', label: 'Tag Visibility', placeholder: '', type: 'select', options: ['', 'all', 'allexcludinglayout', 'customonly', 'mentionsonly', 'none', 'dim'] },
    { key: 'whitespace', label: 'Whitespace', placeholder: '', type: 'select', options: ['', 'pre-wrap', 'normal', 'nowrap'] },
    { key: 'stickyStackMode', label: 'Sticky Column Header', placeholder: '', type: 'select', options: ['', 'titleonly', 'full', 'bottom'] },
    { key: 'htmlCommentRenderMode', label: 'HTML Comments', placeholder: '', type: 'select', options: ['', 'text', 'hidden', 'dim'] },
    { key: 'htmlContentRenderMode', label: 'HTML Content', placeholder: '', type: 'select', options: ['', 'text', 'html'] },
    { key: 'arrowKeyFocusScroll', label: 'Arrow Key Scroll', placeholder: '', type: 'select', options: ['', 'nearest', 'center', 'disabled'] },
    { key: 'layoutSpacing', label: 'Layout Spacing', placeholder: '', type: 'select', options: ['', 'compact', 'spacious'] },
    { key: 'boardColor', label: 'Board Color', placeholder: '#4c7abf', type: 'text' },
    { key: 'boardColorLight', label: 'Board Color (Light)', placeholder: '#4c7abf', type: 'text' },
    { key: 'boardColorDark', label: 'Board Color (Dark)', placeholder: '#4c7abf', type: 'text' }
  ];

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
    inputAddBoard: document.getElementById('input-add-board'),
    btnAddBoard: document.getElementById('btn-add-board'),
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

  // --- Confirm Dialog ---

  function showConfirm(message, onConfirm) {
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    var dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML =
      '<div class="confirm-message">' + esc(message) + '</div>' +
      '<div class="confirm-actions">' +
      '<button class="btn btn-small" data-confirm="cancel">Cancel</button>' +
      '<button class="btn btn-small btn-primary" data-confirm="ok">OK</button>' +
      '</div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    dialog.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-confirm]');
      if (!btn) return;
      overlay.remove();
      if (btn.getAttribute('data-confirm') === 'ok') {
        onConfirm();
      }
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
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
      me = await apiPut('/collab/me', { name: name });
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
      baseUrl = 'http://' + host + ':' + newPort;
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
              baseUrl = 'http://' + host + ':' + data.port;
              reconnected = true;
              break;
            }
          }
        } catch (_) { /* still restarting */ }
      }
      if (!reconnected) {
        var newBase = await discoverBackend();
        if (newBase) {
          baseUrl = newBase;
          reconnected = true;
        }
      }
      if (reconnected) {
        await loadServerInfo();
        await loadNetworkInterfaces();
        els.serverRestartNote.textContent = 'Reconnected to ' + baseUrl;
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
    els.myBoardsList.className = 'list-container boards-list';
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
      html += '<button class="board-row-remove" data-action="remove-board" data-board-id="' + esc(b.id) + '" data-board-name="' + esc(boardName) + '" title="Remove board">&times;</button>';
      html += '</div>';
      html += '</div>';
      html += '<div class="board-details" id="details-' + esc(b.id) + '">';

      // Tabs
      html += '<div class="detail-tabs">';
      html += '<button class="detail-tab active" data-tab="sharing" data-board-id="' + esc(b.id) + '">Sharing</button>';
      html += '<button class="detail-tab" data-tab="members" data-board-id="' + esc(b.id) + '">Members</button>';
      html += '<button class="detail-tab" data-tab="settings" data-board-id="' + esc(b.id) + '">Settings</button>';
      html += '</div>';

      // Sharing tab
      html += '<div class="detail-tab-content active" id="tab-sharing-' + esc(b.id) + '">';
      html += '<div id="invites-' + esc(b.id) + '"><span class="list-empty">Loading...</span></div>';
      html += '</div>';

      // Members tab
      html += '<div class="detail-tab-content" id="tab-members-' + esc(b.id) + '">';
      html += '<div id="members-' + esc(b.id) + '"><span class="list-empty">Loading...</span></div>';
      html += '</div>';

      // Settings tab
      html += '<div class="detail-tab-content" id="tab-settings-' + esc(b.id) + '">';
      html += renderBoardSettingsForm(b.id, b.boardSettings || {});
      html += '</div>';

      html += '</div>';
    }
    els.myBoardsList.innerHTML = html;
  }

  function renderBoardSettingsForm(boardId, settings) {
    var html = '<div class="settings-grid">';
    for (var i = 0; i < BOARD_SETTINGS_FIELDS.length; i++) {
      var f = BOARD_SETTINGS_FIELDS[i];
      var val = settings[f.key] != null ? settings[f.key] : '';
      html += '<label>' + esc(f.label) + '</label>';
      if (f.type === 'select') {
        html += '<select data-board-setting="' + f.key + '" data-board-id="' + esc(boardId) + '">';
        for (var j = 0; j < f.options.length; j++) {
          var opt = f.options[j];
          var selected = (String(val) === opt) ? ' selected' : '';
          html += '<option value="' + esc(opt) + '"' + selected + '>' + (opt || '(default)') + '</option>';
        }
        html += '</select>';
      } else {
        html += '<input type="' + f.type + '" data-board-setting="' + f.key + '" data-board-id="' + esc(boardId) + '"' +
          ' value="' + esc(String(val)) + '" placeholder="' + esc(f.placeholder) + '">';
      }
    }
    html += '</div>';
    html += '<div class="settings-actions">';
    html += '<button class="btn btn-small btn-primary" data-action="save-settings" data-board-id="' + esc(boardId) + '">Save Settings</button>';
    html += '</div>';
    return html;
  }

  async function addBoard() {
    var filePath = els.inputAddBoard.value.trim();
    if (!filePath) return;
    if (!filePath.endsWith('.md')) {
      console.warn('[management] Only .md files can be added');
      return;
    }
    try {
      await apiPost('/boards', { file: filePath });
      els.inputAddBoard.value = '';
      await loadMyBoards();
    } catch (e) {
      console.warn('Failed to add board:', e);
    }
  }

  async function removeBoard(boardId, boardName) {
    showConfirm('Remove "' + boardName + '" from tracking?\n(The file will not be deleted.)', function () {
      apiDelete('/boards/' + boardId).then(function () {
        loadMyBoards();
      }).catch(function (e) {
        console.warn('Failed to remove board:', e);
      });
    });
  }

  async function saveBoardSettings(boardId) {
    var settings = {};
    var inputs = document.querySelectorAll('[data-board-setting][data-board-id="' + boardId + '"]');
    for (var i = 0; i < inputs.length; i++) {
      var key = inputs[i].getAttribute('data-board-setting');
      var value = inputs[i].value.trim();
      if (value === '') {
        settings[key] = null;
      } else if (inputs[i].type === 'number' && value) {
        settings[key] = parseInt(value, 10);
      } else {
        settings[key] = value;
      }
    }
    try {
      await apiPut('/boards/' + boardId + '/settings', settings);
    } catch (e) {
      console.warn('Failed to save board settings:', e);
    }
  }

  async function createInvite(boardId) {
    if (!me) return;
    try {
      var roleSelect = document.getElementById('role-' + boardId);
      var role = roleSelect ? roleSelect.value : 'editor';

      await apiPost('/collab/rooms/' + boardId + '/invites?user=' + encodeURIComponent(me.id), {
        role: role,
      });

      // Expand details and reload invites
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

    els.btnAddBoard.addEventListener('click', addBoard);
    els.inputAddBoard.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addBoard();
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
      } else if (action === 'remove-board') {
        var boardName = btn.getAttribute('data-board-name');
        removeBoard(boardId, boardName);
      } else if (action === 'save-settings') {
        saveBoardSettings(boardId);
      }

      // Tab switching
      var tab = e.target.closest('.detail-tab');
      if (tab) {
        var tabName = tab.getAttribute('data-tab');
        var tabBoardId = tab.getAttribute('data-board-id');
        var detailsContainer = document.getElementById('details-' + tabBoardId);
        if (!detailsContainer) return;
        // Deactivate all tabs and content
        var tabs = detailsContainer.querySelectorAll('.detail-tab');
        var contents = detailsContainer.querySelectorAll('.detail-tab-content');
        for (var ti = 0; ti < tabs.length; ti++) tabs[ti].classList.remove('active');
        for (var ci = 0; ci < contents.length; ci++) contents[ci].classList.remove('active');
        // Activate selected
        tab.classList.add('active');
        var content = document.getElementById('tab-' + tabName + '-' + tabBoardId);
        if (content) content.classList.add('active');
      }
    });
  }

  // --- Helpers ---

  function esc(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // --- Start ---
  init();
})();
