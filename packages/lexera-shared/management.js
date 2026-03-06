/**
 * Shared Management UI Module
 *
 * IMPORTANT: This file is the SINGLE source of truth for the management interface.
 * Both lexera-backend (connection-settings) and lexera-kanban (collab panel) include
 * this same file. All management content is backend data — NO frontend-only settings.
 * Any change here applies to BOTH apps. Do NOT duplicate this logic elsewhere.
 *
 * Usage:
 *   ManagementUI.init({ container, api, callbacks });
 *   ManagementUI.refresh();          // re-render everything
 *   ManagementUI.refresh('boards');  // re-render one section
 *   ManagementUI.destroy();          // clean up
 */
var ManagementUI = (function () {
  'use strict';

  // Board settings field definitions
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

  var container = null;
  var api = null;
  var callbacks = null;
  var me = null;
  var cachedWorkspaces = [];
  var cachedDefaultWorkspaceId = null;
  var cachedBoards = [];
  var currentConfig = null;
  var expandedBoardId = null;
  var activeBoardTab = {};
  var initialized = false;
  var delegateHandler = null;
  var delegateChangeHandler = null;
  var lastMutationAt = 0;
  var SELF_ECHO_WINDOW_MS = 2000;

  // ── Helpers ──

  function esc(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function notify(msg) {
    if (callbacks && typeof callbacks.onNotify === 'function') callbacks.onNotify(msg);
  }

  function confirm(msg, onOk) {
    if (callbacks && typeof callbacks.onConfirm === 'function') {
      var result = callbacks.onConfirm(msg);
      if (result && typeof result.then === 'function') {
        result.then(function (ok) { if (ok) onOk(); });
      } else if (result) {
        onOk();
      }
    } else {
      if (window.confirm(msg)) onOk();
    }
  }

  // ── Init / Destroy ──

  function wrapMutatingApi(rawApi) {
    var wrapped = { get: rawApi.get };
    ['post', 'put', 'delete'].forEach(function (method) {
      wrapped[method] = function () {
        lastMutationAt = Date.now();
        return rawApi[method].apply(rawApi, arguments);
      };
    });
    return wrapped;
  }

  function init(options) {
    container = options.container;
    api = wrapMutatingApi(options.api);
    callbacks = options.callbacks || {};
    if (!container || !api) throw new Error('ManagementUI.init requires container and api');
    initialized = true;
    renderShell();
    loadAll();
  }

  function destroy() {
    if (delegateHandler) {
      document.removeEventListener('click', delegateHandler);
      delegateHandler = null;
    }
    if (delegateChangeHandler) {
      document.removeEventListener('change', delegateChangeHandler);
      delegateChangeHandler = null;
    }
    container = null;
    api = null;
    callbacks = null;
    me = null;
    cachedWorkspaces = [];
    cachedDefaultWorkspaceId = null;
    cachedBoards = [];
    currentConfig = null;
    expandedBoardId = null;
    activeBoardTab = {};
    initialized = false;
    lastMutationAt = 0;
  }

  function refresh(section) {
    if (!initialized) return;
    // Skip full refreshes that are self-echoes from our own mutations
    if (!section && Date.now() - lastMutationAt < SELF_ECHO_WINDOW_MS) return;
    if (section === 'boards') { loadMyBoards(); return; }
    if (section === 'connections') { loadConnections(); return; }
    if (section === 'peers') { loadDiscoveredPeers(); return; }
    if (section === 'workspaces') { loadWorkspaces(); return; }
    loadAll();
  }

  async function loadAll() {
    await loadIdentity();
    await Promise.all([
      loadServerInfo(),
      loadNetworkInterfaces(),
      loadTheme(),
      loadWorkspaces(),
    ]);
    await loadMyBoards();
    await loadConnections();
    await loadDiscoveredPeers();
  }

  // ── Shell HTML ──

  function renderShell() {
    var html = '';

    // Top-level tabs
    html += '<div class="mgmt-top-tab-bar">';
    html += '<button class="mgmt-top-tab active" data-mgmt-top-tab="sharing">Sharing</button>';
    html += '<button class="mgmt-top-tab" data-mgmt-top-tab="config">Configuration</button>';
    html += '</div>';

    // ── Sharing tab ──
    html += '<div class="mgmt-top-tab-content active" data-mgmt-top-panel="sharing">';

    // Workspaces
    html += '<div class="mgmt-section" data-mgmt-section="workspaces">';
    html += '<div class="mgmt-section-title">Workspaces</div>';
    html += '<div class="mgmt-field-row">';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-add-workspace-input" placeholder="New workspace name...">';
    html += '<button class="mgmt-btn mgmt-btn-primary mgmt-btn-small" data-mgmt-action="add-workspace">Add</button>';
    html += '</div>';
    html += '<div class="mgmt-field-row">';
    html += '<label class="mgmt-field-label">Default Workspace</label>';
    html += '<select class="mgmt-field-input" id="mgmt-default-workspace-select"><option value="">(None)</option></select>';
    html += '</div>';
    html += '<div id="mgmt-workspaces-list"></div>';
    html += '</div>';

    // My Boards
    html += '<div class="mgmt-section" data-mgmt-section="boards">';
    html += '<div class="mgmt-section-title">My Boards</div>';
    html += '<div class="mgmt-field-row">';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-add-board-input" placeholder="Path to .md file...">';
    html += '<button class="mgmt-btn mgmt-btn-primary mgmt-btn-small" data-mgmt-action="add-board">Add</button>';
    html += '</div>';
    html += '<div id="mgmt-boards-list"></div>';
    html += '</div>';

    // Remote Connections
    html += '<div class="mgmt-section" data-mgmt-section="connections">';
    html += '<div class="mgmt-section-title">Remote Connections</div>';
    html += '<div id="mgmt-connections-list"></div>';
    html += '</div>';

    // Discovered Peers
    html += '<div class="mgmt-section" data-mgmt-section="peers">';
    html += '<div class="mgmt-section-title">Discovered Peers</div>';
    html += '<div id="mgmt-peers-list"></div>';
    html += '</div>';

    // Join Remote Board
    html += '<div class="mgmt-section" data-mgmt-section="join">';
    html += '<div class="mgmt-section-title">Join Remote Board</div>';
    html += '<div class="mgmt-field-row">';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-join-url" placeholder="http://192.168.1.5:8080">';
    html += '</div>';
    html += '<div class="mgmt-field-row">';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-join-token" placeholder="Invite token">';
    html += '<button class="mgmt-btn mgmt-btn-primary mgmt-btn-small" data-mgmt-action="join-remote">Join</button>';
    html += '</div>';
    html += '<div id="mgmt-join-status" class="mgmt-status"></div>';
    html += '</div>';

    html += '</div>'; // end sharing tab

    // ── Configuration tab ──
    html += '<div class="mgmt-top-tab-content" data-mgmt-top-panel="config">';

    // Identity
    html += '<div class="mgmt-section" data-mgmt-section="identity">';
    html += '<div class="mgmt-section-title">Identity</div>';
    html += '<div class="mgmt-field-row">';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-display-name" placeholder="Your display name...">';
    html += '<button class="mgmt-btn mgmt-btn-primary mgmt-btn-small" data-mgmt-action="save-name">Save</button>';
    html += '</div>';
    html += '</div>';

    // Server
    html += '<div class="mgmt-section" data-mgmt-section="server">';
    html += '<div class="mgmt-section-title">Server</div>';
    html += '<div class="mgmt-field-row">';
    html += '<label class="mgmt-field-label">Bind Address</label>';
    html += '<select class="mgmt-field-input" id="mgmt-bind-select">';
    html += '<option value="0.0.0.0">All interfaces (0.0.0.0)</option>';
    html += '<option value="127.0.0.1">Localhost (127.0.0.1)</option>';
    html += '<option value="__custom__">Custom...</option>';
    html += '</select>';
    html += '</div>';
    html += '<div class="mgmt-field-row" id="mgmt-custom-bind-row" style="display:none">';
    html += '<label class="mgmt-field-label"></label>';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-bind-custom" placeholder="e.g. 192.168.1.100">';
    html += '</div>';
    html += '<div class="mgmt-field-row">';
    html += '<label class="mgmt-field-label">Port</label>';
    html += '<select class="mgmt-field-input" id="mgmt-port-select">';
    html += '<option value="13080">Default (13080)</option>';
    html += '<option value="__custom__">Custom...</option>';
    html += '</select>';
    html += '</div>';
    html += '<div class="mgmt-field-row" id="mgmt-custom-port-row" style="display:none">';
    html += '<label class="mgmt-field-label"></label>';
    html += '<input class="mgmt-field-input" type="number" id="mgmt-port-custom" min="1024" max="65535" placeholder="e.g. 8080">';
    html += '</div>';
    html += '<div class="mgmt-field-row" style="justify-content:flex-end">';
    html += '<button class="mgmt-btn mgmt-btn-primary mgmt-btn-small" data-mgmt-action="save-server">Save</button>';
    html += '</div>';
    html += '<div id="mgmt-server-address" class="mgmt-info-text"></div>';
    html += '<div id="mgmt-server-restart-note" class="mgmt-restart-note" style="display:none"></div>';
    html += '</div>';

    // Theme
    html += '<div class="mgmt-section" data-mgmt-section="theme">';
    html += '<div class="mgmt-section-title">Theme</div>';
    html += '<div class="mgmt-field-row">';
    html += '<label class="mgmt-field-label">Theme</label>';
    html += '<select class="mgmt-field-input" id="mgmt-theme-select"></select>';
    html += '</div>';
    html += '<div class="mgmt-field-row">';
    html += '<label class="mgmt-field-label">Mode</label>';
    html += '<span id="mgmt-color-mode" class="mgmt-info-text" style="margin:0">Auto (follows system)</span>';
    html += '</div>';
    html += '</div>';

    html += '</div>'; // end config tab

    container.innerHTML = html;

    setupEventDelegation();
  }

  // ── Event Delegation ──

  function setupEventDelegation() {
    if (delegateHandler) document.removeEventListener('click', delegateHandler);
    if (delegateChangeHandler) document.removeEventListener('change', delegateChangeHandler);

    delegateHandler = function (e) {
      if (!container) return;
      if (!container.contains(e.target)) return;

      // Top tab switching
      var topTab = e.target.closest('.mgmt-top-tab');
      if (topTab) {
        var tabName = topTab.getAttribute('data-mgmt-top-tab');
        container.querySelectorAll('.mgmt-top-tab').forEach(function (t) { t.classList.remove('active'); });
        container.querySelectorAll('.mgmt-top-tab-content').forEach(function (c) { c.classList.remove('active'); });
        topTab.classList.add('active');
        var panel = container.querySelector('[data-mgmt-top-panel="' + tabName + '"]');
        if (panel) panel.classList.add('active');
        return;
      }

      // Action buttons
      var actionBtn = e.target.closest('[data-mgmt-action]');
      if (actionBtn) {
        handleAction(actionBtn);
        return;
      }

      // Board detail tabs
      var detailTab = e.target.closest('.mgmt-detail-tab');
      if (detailTab) {
        var tabBoardId = detailTab.getAttribute('data-mgmt-tab-board');
        var tabKey = detailTab.getAttribute('data-mgmt-tab');
        activeBoardTab[tabBoardId] = tabKey;
        var detailsEl = container.querySelector('[data-mgmt-details="' + tabBoardId + '"]');
        if (detailsEl) {
          detailsEl.querySelectorAll('.mgmt-detail-tab').forEach(function (t) {
            t.classList.toggle('active', t.getAttribute('data-mgmt-tab') === tabKey);
          });
          detailsEl.querySelectorAll('.mgmt-detail-tab-content').forEach(function (c) {
            c.classList.toggle('active', c.getAttribute('data-mgmt-tab-panel') === tabKey);
          });
        }
        return;
      }

      // Board expand/collapse
      var expandBtn = e.target.closest('[data-mgmt-expand]');
      if (expandBtn) {
        var bid = expandBtn.getAttribute('data-mgmt-expand');
        if (expandedBoardId === bid) {
          expandedBoardId = null;
        } else {
          expandedBoardId = bid;
        }
        loadMyBoards();
        return;
      }
    };

    delegateChangeHandler = function (e) {
      if (!container || !container.contains(e.target)) return;

      // Bind address select
      var bindSelect = e.target.closest('#mgmt-bind-select');
      if (bindSelect) {
        var customRow = container.querySelector('#mgmt-custom-bind-row');
        if (customRow) customRow.style.display = bindSelect.value === '__custom__' ? '' : 'none';
        return;
      }

      // Port select
      var portSelect = e.target.closest('#mgmt-port-select');
      if (portSelect) {
        var customRow = container.querySelector('#mgmt-custom-port-row');
        if (customRow) customRow.style.display = portSelect.value === '__custom__' ? '' : 'none';
        return;
      }

      // Theme select
      var themeSelect = e.target.closest('#mgmt-theme-select');
      if (themeSelect) {
        saveTheme(themeSelect.value);
        return;
      }

      // Default workspace
      var wsSelect = e.target.closest('#mgmt-default-workspace-select');
      if (wsSelect) {
        setDefaultWorkspace(wsSelect.value);
        return;
      }

      // Workspace checkbox toggle
      var wsCheckbox = e.target.closest('[data-mgmt-ws-toggle]');
      if (wsCheckbox && wsCheckbox.tagName === 'INPUT') {
        var boardId = wsCheckbox.getAttribute('data-mgmt-ws-board');
        var checkboxes = container.querySelectorAll('input[data-mgmt-ws-toggle][data-mgmt-ws-board="' + boardId + '"]');
        var selectedIds = [];
        checkboxes.forEach(function (cb) { if (cb.checked) selectedIds.push(cb.getAttribute('data-mgmt-ws-toggle')); });
        if (selectedIds.length === 0) {
          wsCheckbox.checked = true; // Prevent removing all workspaces
          notify('Board must belong to at least one workspace');
          return;
        }
        assignBoardWorkspaces(boardId, selectedIds);
        return;
      }
    };

    document.addEventListener('click', delegateHandler);
    document.addEventListener('change', delegateChangeHandler);

    // Enter key for inputs
    container.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var target = e.target;
      if (target.id === 'mgmt-add-workspace-input') addWorkspace();
      else if (target.id === 'mgmt-add-board-input') addBoard();
      else if (target.id === 'mgmt-display-name') saveName();
      else if (target.id === 'mgmt-join-token') joinRemote();
    });
  }

  function handleAction(btn) {
    var action = btn.getAttribute('data-mgmt-action');
    var boardId = btn.getAttribute('data-mgmt-board');

    switch (action) {
      case 'add-workspace': addWorkspace(); break;
      case 'add-board': addBoard(); break;
      case 'save-name': saveName(); break;
      case 'save-server': saveServerConfig(); break;
      case 'join-remote': joinRemote(); break;
      case 'create-invite': createInvite(boardId); break;
      case 'revoke-invite': revokeInvite(boardId, btn.getAttribute('data-mgmt-token')); break;
      case 'copy-token': copyToken(btn.getAttribute('data-mgmt-token')); break;
      case 'remove-board': removeBoard(boardId, btn.getAttribute('data-mgmt-board-name')); break;
      case 'save-settings': saveBoardSettings(boardId); break;
      case 'toggle-details': toggleBoardDetails(boardId); break;
      case 'disconnect': disconnectRemote(btn.getAttribute('data-mgmt-local-board')); break;
      case 'use-peer': usePeer(btn.getAttribute('data-mgmt-peer-url')); break;
      case 'rename-workspace': renameWorkspace(btn.getAttribute('data-mgmt-ws-id')); break;
      case 'delete-workspace': deleteWorkspace(btn.getAttribute('data-mgmt-ws-id'), btn.getAttribute('data-mgmt-ws-name')); break;
    }
  }

  // ── Identity ──

  async function loadIdentity() {
    try {
      me = await api.get('/collab/me');
      var input = container.querySelector('#mgmt-display-name');
      if (input) input.value = me.name || '';
    } catch (e) { /* ignore */ }
  }

  async function saveName() {
    var input = container.querySelector('#mgmt-display-name');
    var name = input ? input.value.trim() : '';
    if (!name) return;
    try {
      me = await api.put('/collab/me', { name: name });
      if (input) input.value = me.name;
      notify('Display name saved');
    } catch (e) {
      notify('Failed to save name: ' + (e.message || e));
    }
  }

  // ── Server Info ──

  async function loadServerInfo() {
    try {
      var info = await api.get('/collab/server-info');
      currentConfig = { bind_address: info.bind_address || info.address || info.bindAddress, port: info.port };
      var addrEl = container.querySelector('#mgmt-server-address');
      if (addrEl) addrEl.textContent = 'http://' + (info.address || info.bind_address || info.bindAddress) + ':' + info.port;
    } catch (e) {
      var addrEl = container.querySelector('#mgmt-server-address');
      if (addrEl) addrEl.textContent = 'Could not determine server address';
    }
  }

  async function loadNetworkInterfaces() {
    try {
      var data = await api.get('/collab/network-interfaces');
      var interfaces = data.interfaces || [];
      var currentBind = data.current_bind_address || (currentConfig && currentConfig.bind_address) || '0.0.0.0';
      var defaultPort = data.default_port || 13080;
      var currentPort = data.current_port || (currentConfig && currentConfig.port) || defaultPort;
      if (interfaces.length) {
        populateBindSelect(interfaces, currentBind);
      } else {
        populateBindSelect(buildFallbackBindOptions(currentBind), currentBind);
      }
      populatePortSelect(defaultPort, currentPort);
    } catch (e) {
      var currentBind = (currentConfig && currentConfig.bind_address) || '0.0.0.0';
      var currentPort = (currentConfig && currentConfig.port) || 13080;
      populateBindSelect(buildFallbackBindOptions(currentBind), currentBind);
      populatePortSelect(13080, currentPort);
    }
  }

  function buildFallbackBindOptions(currentBind) {
    var opts = [
      { address: '0.0.0.0', label: 'All interfaces' },
      { address: '127.0.0.1', label: 'Localhost' }
    ];
    if (currentBind && currentBind !== '0.0.0.0' && currentBind !== '127.0.0.1') {
      opts.push({ address: currentBind, label: 'Current' });
    }
    return opts;
  }

  function populateBindSelect(interfaces, currentBind) {
    var select = container.querySelector('#mgmt-bind-select');
    if (!select) return;
    select.innerHTML = '';

    var found = false;
    for (var i = 0; i < interfaces.length; i++) {
      var iface = interfaces[i];
      var opt = document.createElement('option');
      opt.value = iface.address;
      opt.textContent = (iface.label || iface.name || iface.address) + ' (' + iface.address + ')';
      select.appendChild(opt);
      if (iface.address === currentBind) found = true;
    }
    var customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = 'Custom...';
    select.appendChild(customOpt);

    var customRow = container.querySelector('#mgmt-custom-bind-row');
    if (currentBind && found) {
      select.value = currentBind;
      if (customRow) customRow.style.display = 'none';
    } else if (currentBind && !found) {
      select.value = '__custom__';
      var customInput = container.querySelector('#mgmt-bind-custom');
      if (customInput) customInput.value = currentBind;
      if (customRow) customRow.style.display = '';
    }
  }

  function populatePortSelect(defaultPort, currentPort) {
    var select = container.querySelector('#mgmt-port-select');
    if (!select) return;
    select.innerHTML = '';

    var defOpt = document.createElement('option');
    defOpt.value = String(defaultPort);
    defOpt.textContent = 'Default (' + defaultPort + ')';
    select.appendChild(defOpt);

    var customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = 'Custom...';
    select.appendChild(customOpt);

    var customRow = container.querySelector('#mgmt-custom-port-row');
    if (currentPort && currentPort !== defaultPort) {
      select.value = '__custom__';
      var customInput = container.querySelector('#mgmt-port-custom');
      if (customInput) customInput.value = currentPort;
      if (customRow) customRow.style.display = '';
    } else {
      select.value = String(defaultPort);
      if (customRow) customRow.style.display = 'none';
    }
  }

  async function saveServerConfig() {
    var bindSelect = container.querySelector('#mgmt-bind-select');
    var bindAddr = bindSelect ? bindSelect.value : '0.0.0.0';
    if (bindAddr === '__custom__') {
      var customBind = container.querySelector('#mgmt-bind-custom');
      bindAddr = customBind ? customBind.value.trim() : '';
      if (!bindAddr) return;
    }

    var portSelect = container.querySelector('#mgmt-port-select');
    var portVal = portSelect ? portSelect.value : '13080';
    var port;
    if (portVal === '__custom__') {
      var customPort = container.querySelector('#mgmt-port-custom');
      port = customPort ? parseInt(customPort.value, 10) : NaN;
      if (isNaN(port) || port < 1024 || port > 65535) return;
    } else {
      port = parseInt(portVal, 10);
    }

    var restartNote = container.querySelector('#mgmt-server-restart-note');
    if (restartNote) { restartNote.textContent = 'Applying...'; restartNote.style.display = ''; }

    try {
      var result = await api.put('/collab/server-config', { bind_address: bindAddr, port: port });
      var newPort = result.port || port;
      if (callbacks && typeof callbacks.onServerRestarted === 'function') {
        callbacks.onServerRestarted(bindAddr, newPort);
      }
      await loadServerInfo();
      await loadNetworkInterfaces();
      if (restartNote) {
        restartNote.textContent = 'Server restarted on port ' + newPort;
        setTimeout(function () { if (restartNote) restartNote.style.display = 'none'; }, 5000);
      }
      notify('Server config saved');
    } catch (e) {
      if (restartNote) {
        restartNote.textContent = 'Error: ' + (e.message || e);
        setTimeout(function () { if (restartNote) restartNote.style.display = 'none'; }, 5000);
      }
      // Let host app handle reconnection
      if (callbacks && typeof callbacks.onServerRestarted === 'function') {
        callbacks.onServerRestarted(bindAddr, port);
      }
    }
  }

  // ── Theme ──

  async function loadTheme() {
    var themeId = 'lexera';
    try {
      var data = await api.get('/config/theme');
      themeId = data.theme || 'lexera';
    } catch (e) {
      themeId = localStorage.getItem('lexera-theme') || 'lexera';
    }

    populateThemeSelect(themeId);

    if (callbacks && typeof callbacks.onThemeChange === 'function') {
      callbacks.onThemeChange(themeId);
    }
  }

  function populateThemeSelect(currentThemeId) {
    var select = container.querySelector('#mgmt-theme-select');
    if (!select) return;
    select.innerHTML = '';

    var themes = (callbacks && typeof callbacks.getThemes === 'function') ? callbacks.getThemes() : [];
    if (typeof LEXERA_THEMES !== 'undefined' && !themes.length) themes = LEXERA_THEMES;

    for (var i = 0; i < themes.length; i++) {
      var t = themes[i];
      var opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      if (t.id === currentThemeId) opt.selected = true;
      select.appendChild(opt);
    }

    var modeEl = container.querySelector('#mgmt-color-mode');
    if (modeEl) {
      var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      modeEl.textContent = isDark ? 'Dark (system)' : 'Light (system)';
    }
  }

  async function saveTheme(themeId) {
    if (callbacks && typeof callbacks.onThemeChange === 'function') {
      callbacks.onThemeChange(themeId);
    }
    try {
      await api.put('/config/theme', { theme: themeId });
    } catch (e) { /* ignore */ }
  }

  // ── Workspaces ──

  async function loadWorkspaces() {
    try {
      var data = await api.get('/config/workspaces');
      cachedWorkspaces = data.workspaces || [];
      cachedDefaultWorkspaceId = data.default_workspace || null;
    } catch (e) {
      cachedWorkspaces = [];
      cachedDefaultWorkspaceId = null;
    }
    renderWorkspaces();
    populateDefaultWorkspaceSelect();
  }

  function renderWorkspaces() {
    var el = container.querySelector('#mgmt-workspaces-list');
    if (!el) return;
    if (!cachedWorkspaces.length) {
      el.innerHTML = '<div class="mgmt-list-empty">No workspaces</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < cachedWorkspaces.length; i++) {
      var ws = cachedWorkspaces[i];
      var boardCount = typeof ws.board_count === 'number' ? ws.board_count : null;
      html += '<div class="mgmt-workspace-row">';
      html += '<input class="mgmt-field-input mgmt-ws-name-input" data-mgmt-ws-name-id="' + esc(ws.id) + '" value="' + esc(ws.name) + '">';
      if (boardCount != null) {
        html += '<span class="mgmt-ws-count">' + boardCount + ' board' + (boardCount === 1 ? '' : 's') + '</span>';
      }
      html += '<button class="mgmt-btn mgmt-btn-small" data-mgmt-action="rename-workspace" data-mgmt-ws-id="' + esc(ws.id) + '">Rename</button>';
      html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-danger" data-mgmt-action="delete-workspace" data-mgmt-ws-id="' + esc(ws.id) + '" data-mgmt-ws-name="' + esc(ws.name) + '">&times;</button>';
      html += '</div>';
    }
    el.innerHTML = html;
  }

  function populateDefaultWorkspaceSelect() {
    var select = container.querySelector('#mgmt-default-workspace-select');
    if (!select) return;
    select.innerHTML = '';
    for (var i = 0; i < cachedWorkspaces.length; i++) {
      var ws = cachedWorkspaces[i];
      var opt = document.createElement('option');
      opt.value = ws.id;
      opt.textContent = ws.name;
      if (ws.id === cachedDefaultWorkspaceId) opt.selected = true;
      select.appendChild(opt);
    }
    if (!select.value && cachedWorkspaces.length > 0) {
      select.value = cachedWorkspaces[0].id;
    }
  }

  async function addWorkspace() {
    var input = container.querySelector('#mgmt-add-workspace-input');
    var name = input ? input.value.trim() : '';
    if (!name) return;
    try {
      await api.post('/config/workspaces', { name: name });
      if (input) input.value = '';
      await loadWorkspaces();
      await loadMyBoards();
      notify('Workspace created');
    } catch (e) {
      notify('Failed to create workspace: ' + (e.message || e));
    }
  }

  async function renameWorkspace(wsId) {
    var input = container.querySelector('[data-mgmt-ws-name-id="' + wsId + '"]');
    if (!input) return;
    var name = input.value.trim();
    if (!name) return;
    try {
      await api.put('/config/workspaces/' + wsId, { name: name });
      await loadWorkspaces();
      notify('Workspace renamed');
    } catch (e) {
      notify('Failed to rename workspace: ' + (e.message || e));
    }
  }

  async function deleteWorkspace(wsId, wsName) {
    confirm('Delete workspace "' + wsName + '"?\nBoards will be moved to the default workspace.', function () {
      api.delete('/config/workspaces/' + wsId).then(function () {
        loadWorkspaces();
        loadMyBoards();
        notify('Workspace deleted');
      }).catch(function (e) {
        notify('Failed to delete workspace: ' + (e.message || e));
      });
    });
  }

  async function setDefaultWorkspace(wsId) {
    try {
      var result = await api.put('/config/default-workspace', { workspace_id: wsId || null });
      cachedDefaultWorkspaceId = result && result.default_workspace ? result.default_workspace : (wsId || null);
    } catch (e) {
      notify('Failed to set default workspace: ' + (e.message || e));
    }
  }

  async function assignBoardWorkspaces(boardId, wsIds) {
    try {
      await api.put('/config/boards/' + boardId + '/workspaces', { workspace_ids: wsIds });
      loadMyBoards();
    } catch (e) {
      notify('Failed to assign workspaces: ' + (e.message || e));
    }
  }

  // ── My Boards ──

  async function loadMyBoards() {
    var el = container.querySelector('#mgmt-boards-list');
    if (!el) return;
    try {
      var data = await api.get('/boards');
      var boards = Array.isArray(data) ? data : (data.boards || []);
      cachedBoards = boards;
      renderMyBoards(el, boards);
    } catch (e) {
      el.innerHTML = '<div class="mgmt-list-empty">Failed to load boards</div>';
    }
  }

  function renderMyBoards(el, boards) {
    if (!boards.length) {
      el.innerHTML = '<div class="mgmt-list-empty">No boards</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < boards.length; i++) {
      var b = boards[i];
      var boardName = b.title || (b.filePath || b.file_path || b.id || '').split('/').pop().replace('.md', '') || 'Untitled';
      var isExpanded = expandedBoardId === b.id;
      var wsIds = b.workspace_ids || b.workspaceIds || [];
      // Backwards compat: old single workspace_id
      if (wsIds.length === 0 && (b.workspace_id || b.workspaceId)) {
        wsIds = [b.workspace_id || b.workspaceId];
      }

      html += '<div class="mgmt-board-row">';
      html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-fold" data-mgmt-action="toggle-details" data-mgmt-board="' + esc(b.id) + '">' + (isExpanded ? '&#9660;' : '&#9654;') + '</button>';
      html += '<span class="mgmt-board-name" data-mgmt-expand="' + esc(b.id) + '">' + esc(boardName) + '</span>';
      // Workspace chips (read-only display)
      html += '<div class="mgmt-board-ws-chips">';
      for (var wi = 0; wi < wsIds.length; wi++) {
        var wsMatch = cachedWorkspaces.filter(function (w) { return w.id === wsIds[wi]; })[0];
        if (wsMatch) html += '<span class="mgmt-ws-chip">' + esc(wsMatch.name) + '</span>';
      }
      html += '</div>';
      html += '<div class="mgmt-board-actions">';
      html += '<button class="mgmt-board-remove" data-mgmt-action="remove-board" data-mgmt-board="' + esc(b.id) + '" data-mgmt-board-name="' + esc(boardName) + '" title="Remove board">&times;</button>';
      html += '</div>';
      html += '</div>';

      // Details (expandable)
      html += '<div class="mgmt-board-details' + (isExpanded ? ' expanded' : '') + '" data-mgmt-details="' + esc(b.id) + '">';
      if (isExpanded) {
        html += renderBoardDetailsContent(b.id, b.boardSettings || b.board_settings || {});
      }
      html += '</div>';
    }
    el.innerHTML = html;

    // Load collab data for expanded board
    if (expandedBoardId) {
      loadBoardCollabData(expandedBoardId);
    }
  }

  function renderBoardDetailsContent(boardId, settings) {
    var activeTab = activeBoardTab[boardId] || 'sharing';
    var html = '';

    // Workspace checkboxes
    var board = cachedBoards.filter(function (b) { return b.id === boardId; })[0];
    var boardWsIds = board ? (board.workspace_ids || board.workspaceIds || []) : [];
    if (boardWsIds.length === 0 && board && (board.workspace_id || board.workspaceId)) {
      boardWsIds = [board.workspace_id || board.workspaceId];
    }
    if (cachedWorkspaces.length > 0) {
      html += '<div class="mgmt-ws-assign">';
      html += '<span class="mgmt-ws-assign-label">Workspaces:</span>';
      for (var wi = 0; wi < cachedWorkspaces.length; wi++) {
        var ws = cachedWorkspaces[wi];
        var checked = boardWsIds.indexOf(ws.id) >= 0;
        html += '<label class="mgmt-ws-checkbox"><input type="checkbox"' + (checked ? ' checked' : '') + ' data-mgmt-ws-toggle="' + esc(ws.id) + '" data-mgmt-ws-board="' + esc(boardId) + '"> ' + esc(ws.name) + '</label>';
      }
      html += '</div>';
    }

    // Tabs
    html += '<div class="mgmt-detail-tabs">';
    html += '<button class="mgmt-detail-tab' + (activeTab === 'sharing' ? ' active' : '') + '" data-mgmt-tab="sharing" data-mgmt-tab-board="' + esc(boardId) + '">Sharing</button>';
    html += '<button class="mgmt-detail-tab' + (activeTab === 'members' ? ' active' : '') + '" data-mgmt-tab="members" data-mgmt-tab-board="' + esc(boardId) + '">Members</button>';
    html += '<button class="mgmt-detail-tab' + (activeTab === 'settings' ? ' active' : '') + '" data-mgmt-tab="settings" data-mgmt-tab-board="' + esc(boardId) + '">Settings</button>';
    html += '</div>';

    // Sharing tab
    html += '<div class="mgmt-detail-tab-content' + (activeTab === 'sharing' ? ' active' : '') + '" data-mgmt-tab-panel="sharing">';
    html += '<div class="mgmt-invite-controls">';
    html += '<select class="mgmt-field-input mgmt-field-select-small" id="mgmt-role-' + esc(boardId) + '">';
    html += '<option value="editor">Editor</option><option value="viewer">Viewer</option>';
    html += '</select>';
    html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="create-invite" data-mgmt-board="' + esc(boardId) + '">Invite</button>';
    html += '</div>';
    html += '<div data-mgmt-invites-list="' + esc(boardId) + '"><span class="mgmt-list-empty">Loading...</span></div>';
    html += '</div>';

    // Members tab
    html += '<div class="mgmt-detail-tab-content' + (activeTab === 'members' ? ' active' : '') + '" data-mgmt-tab-panel="members">';
    html += '<div data-mgmt-members-list="' + esc(boardId) + '"><span class="mgmt-list-empty">Loading...</span></div>';
    html += '</div>';

    // Settings tab
    html += '<div class="mgmt-detail-tab-content' + (activeTab === 'settings' ? ' active' : '') + '" data-mgmt-tab-panel="settings">';
    html += renderBoardSettingsForm(boardId, settings);
    html += '</div>';

    return html;
  }

  function renderBoardSettingsForm(boardId, settings) {
    var html = '<div class="mgmt-settings-grid">';
    for (var i = 0; i < BOARD_SETTINGS_FIELDS.length; i++) {
      var f = BOARD_SETTINGS_FIELDS[i];
      var val = settings[f.key] != null ? settings[f.key] : '';
      html += '<label>' + esc(f.label) + '</label>';
      if (f.type === 'select') {
        html += '<select data-mgmt-board-setting="' + f.key + '" data-mgmt-setting-board="' + esc(boardId) + '">';
        for (var j = 0; j < f.options.length; j++) {
          var opt = f.options[j];
          html += '<option value="' + esc(opt) + '"' + (String(val) === opt ? ' selected' : '') + '>' + (opt || '(default)') + '</option>';
        }
        html += '</select>';
      } else {
        html += '<input type="' + f.type + '" data-mgmt-board-setting="' + f.key + '" data-mgmt-setting-board="' + esc(boardId) + '"' +
          ' value="' + esc(String(val)) + '" placeholder="' + esc(f.placeholder) + '">';
      }
    }
    html += '</div>';
    html += '<div class="mgmt-settings-actions">';
    html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="save-settings" data-mgmt-board="' + esc(boardId) + '">Save Settings</button>';
    html += '</div>';
    return html;
  }

  function toggleBoardDetails(boardId) {
    var detailsEl = container.querySelector('[data-mgmt-details="' + boardId + '"]');
    if (!detailsEl) return;
    var isExpanding = !detailsEl.classList.contains('expanded');
    detailsEl.classList.toggle('expanded');
    var btn = container.querySelector('[data-mgmt-action="toggle-details"][data-mgmt-board="' + boardId + '"]');
    if (btn) btn.innerHTML = isExpanding ? '&#9660;' : '&#9654;';
    if (isExpanding) {
      expandedBoardId = boardId;
      if (!detailsEl.innerHTML.trim() || detailsEl.querySelector('.mgmt-list-empty')) {
        detailsEl.innerHTML = renderBoardDetailsContent(boardId, {});
      }
      loadBoardCollabData(boardId);
    } else {
      expandedBoardId = null;
    }
  }

  async function loadBoardCollabData(boardId) {
    if (!me) return;
    try {
      var results = await Promise.allSettled([
        api.get('/collab/rooms/' + boardId + '/invites?user=' + encodeURIComponent(me.id)),
        api.get('/collab/rooms/' + boardId + '/members?user=' + encodeURIComponent(me.id)),
      ]);
      var invites = results[0].status === 'fulfilled' ? results[0].value : [];
      var members = results[1].status === 'fulfilled' ? results[1].value : [];

      // Render invites
      var invitesEl = container.querySelector('[data-mgmt-invites-list="' + boardId + '"]');
      if (invitesEl) {
        if (!invites.length) {
          invitesEl.innerHTML = '<span class="mgmt-list-empty">No active invites</span>';
        } else {
          var ihtml = '';
          for (var i = 0; i < invites.length; i++) {
            var inv = invites[i];
            ihtml += '<div class="mgmt-detail-item">';
            ihtml += '<div class="mgmt-invite-info">';
            ihtml += '<span>' + esc(inv.role) + ' &middot; ' + inv.uses + '/' + (inv.max_uses || '&infin;') + ' uses</span>';
            ihtml += '<div class="mgmt-token-field">';
            ihtml += '<input type="text" readonly value="' + esc(inv.token) + '">';
            ihtml += '<button class="mgmt-btn mgmt-btn-small" data-mgmt-action="copy-token" data-mgmt-token="' + esc(inv.token) + '">Copy</button>';
            ihtml += '</div>';
            ihtml += '</div>';
            ihtml += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-danger" data-mgmt-action="revoke-invite" data-mgmt-board="' + esc(boardId) + '" data-mgmt-token="' + esc(inv.token) + '">Revoke</button>';
            ihtml += '</div>';
          }
          invitesEl.innerHTML = ihtml;
        }
      }

      // Render members
      var membersEl = container.querySelector('[data-mgmt-members-list="' + boardId + '"]');
      if (membersEl) {
        if (!members.length) {
          membersEl.innerHTML = '<span class="mgmt-list-empty">No members</span>';
        } else {
          var mhtml = '';
          for (var j = 0; j < members.length; j++) {
            var m = members[j];
            mhtml += '<div class="mgmt-detail-item">';
            mhtml += '<span>' + esc(m.user_name || m.user_id) + '</span>';
            mhtml += '<span class="mgmt-member-role">' + esc(m.role) + '</span>';
            mhtml += '</div>';
          }
          membersEl.innerHTML = mhtml;
        }
      }
    } catch (e) { /* ignore */ }
  }

  async function addBoard() {
    var input = container.querySelector('#mgmt-add-board-input');
    var filePath = input ? input.value.trim() : '';
    if (!filePath) return;
    try {
      await api.post('/boards', { file: filePath });
      if (input) input.value = '';
      await loadMyBoards();
      notify('Board added');
      if (callbacks && typeof callbacks.onBoardAdded === 'function') callbacks.onBoardAdded();
    } catch (e) {
      notify('Failed to add board: ' + (e.message || e));
    }
  }

  async function removeBoard(boardId, boardName) {
    confirm('Remove "' + (boardName || boardId) + '" from tracking?\n(The file will not be deleted.)', function () {
      api.delete('/boards/' + boardId).then(function () {
        if (expandedBoardId === boardId) expandedBoardId = null;
        loadMyBoards();
        notify('Board removed');
        if (callbacks && typeof callbacks.onBoardRemoved === 'function') callbacks.onBoardRemoved(boardId);
      }).catch(function (e) {
        notify('Failed to remove board: ' + (e.message || e));
      });
    });
  }

  async function saveBoardSettings(boardId) {
    var inputs = container.querySelectorAll('[data-mgmt-board-setting][data-mgmt-setting-board="' + boardId + '"]');
    var settings = {};
    for (var i = 0; i < inputs.length; i++) {
      var key = inputs[i].getAttribute('data-mgmt-board-setting');
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
      await api.put('/boards/' + boardId + '/settings', settings);
      notify('Board settings saved');
      if (callbacks && typeof callbacks.onBoardSettingsSaved === 'function') {
        callbacks.onBoardSettingsSaved(boardId, settings);
      }
    } catch (e) {
      notify('Failed to save settings: ' + (e.message || e));
    }
  }

  async function createInvite(boardId) {
    if (!me) return;
    var roleSelect = container.querySelector('#mgmt-role-' + boardId);
    var role = roleSelect ? roleSelect.value : 'editor';
    try {
      await api.post('/collab/rooms/' + boardId + '/invites?user=' + encodeURIComponent(me.id), { role: role });
      // Expand details and reload
      var detailsEl = container.querySelector('[data-mgmt-details="' + boardId + '"]');
      if (detailsEl && !detailsEl.classList.contains('expanded')) {
        expandedBoardId = boardId;
        detailsEl.classList.add('expanded');
        detailsEl.innerHTML = renderBoardDetailsContent(boardId, {});
      }
      await loadBoardCollabData(boardId);
      notify('Invite created');
    } catch (e) {
      notify('Failed to create invite: ' + (e.message || e));
    }
  }

  async function revokeInvite(boardId, token) {
    if (!me) return;
    try {
      await api.delete('/collab/rooms/' + boardId + '/invites/' + token + '?user=' + encodeURIComponent(me.id));
      await loadBoardCollabData(boardId);
      notify('Invite revoked');
    } catch (e) {
      notify('Failed to revoke invite: ' + (e.message || e));
    }
  }

  function copyToken(token) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(token).then(function () {
        notify('Token copied to clipboard');
      });
    }
  }

  // ── Remote Connections ──

  async function loadConnections() {
    var el = container.querySelector('#mgmt-connections-list');
    if (!el) return;
    try {
      var connections = await api.get('/collab/connections');
      if (!connections || !connections.length) {
        el.innerHTML = '<div class="mgmt-list-empty">No remote connections</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < connections.length; i++) {
        var c = connections[i];
        var isOk = c.status === 'connected' || c.status === 'ok' || c.connected;
        html += '<div class="mgmt-connection-row">';
        html += '<div class="mgmt-connection-info">';
        html += '<div class="mgmt-connection-url"><span class="mgmt-connection-status ' + (isOk ? 'ok' : 'err') + '"></span>' + esc(c.server_url || c.serverUrl || c.url || '') + '</div>';
        html += '<div class="mgmt-connection-board">Board: ' + esc(c.remote_board_id || c.local_board_id || c.localBoardId || '') + '</div>';
        html += '</div>';
        html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-danger" data-mgmt-action="disconnect" data-mgmt-local-board="' + esc(c.local_board_id || c.localBoardId || '') + '">Disconnect</button>';
        html += '</div>';
      }
      el.innerHTML = html;
    } catch (e) {
      el.innerHTML = '<div class="mgmt-list-empty">Failed to load connections</div>';
    }
  }

  async function disconnectRemote(localBoardId) {
    try {
      await api.delete('/collab/connect/' + localBoardId);
      notify('Disconnected');
      await loadConnections();
    } catch (e) {
      notify('Disconnect failed: ' + (e.message || e));
    }
  }

  // ── Discovered Peers ──

  async function loadDiscoveredPeers() {
    var el = container.querySelector('#mgmt-peers-list');
    if (!el) return;
    try {
      var peers = await api.get('/collab/discovered-peers');
      if (!peers || !peers.length) {
        el.innerHTML = '<div class="mgmt-list-empty">No peers found on LAN</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < peers.length; i++) {
        var p = peers[i];
        html += '<div class="mgmt-peer-row">';
        html += '<div class="mgmt-peer-info">';
        html += '<div class="mgmt-peer-name">' + esc(p.user_name || p.displayName || p.display_name || p.name || 'Unknown') + '</div>';
        html += '<div class="mgmt-peer-url">' + esc(p.url || p.address || '') + '</div>';
        html += '</div>';
        html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="use-peer" data-mgmt-peer-url="' + esc(p.url || p.address || '') + '">Use</button>';
        html += '</div>';
      }
      el.innerHTML = html;
    } catch (e) {
      el.innerHTML = '<div class="mgmt-list-empty">Discovery unavailable</div>';
    }
  }

  function usePeer(peerUrl) {
    if (!peerUrl) return;
    var urlInput = container.querySelector('#mgmt-join-url');
    var tokenInput = container.querySelector('#mgmt-join-token');
    if (urlInput) urlInput.value = peerUrl;
    if (tokenInput) tokenInput.focus();
    // Switch to sharing tab if on config tab
    var sharingTab = container.querySelector('[data-mgmt-top-tab="sharing"]');
    if (sharingTab && !sharingTab.classList.contains('active')) {
      sharingTab.click();
    }
  }

  // ── Join Remote Board ──

  async function joinRemote() {
    var urlInput = container.querySelector('#mgmt-join-url');
    var tokenInput = container.querySelector('#mgmt-join-token');
    var statusEl = container.querySelector('#mgmt-join-status');
    var serverUrl = urlInput ? urlInput.value.trim() : '';
    var token = tokenInput ? tokenInput.value.trim() : '';

    if (!serverUrl || !token) {
      if (statusEl) { statusEl.className = 'mgmt-status error'; statusEl.textContent = 'Please fill in both fields'; }
      return;
    }

    if (statusEl) { statusEl.className = 'mgmt-status'; statusEl.textContent = 'Connecting...'; }

    try {
      var result = await api.post('/collab/connect', { server_url: serverUrl, token: token });
      if (statusEl) { statusEl.className = 'mgmt-status success'; statusEl.textContent = 'Connected! Board: ' + (result.local_board_id || ''); }
      if (urlInput) urlInput.value = '';
      if (tokenInput) tokenInput.value = '';
      await loadConnections();
      if (callbacks && typeof callbacks.onBoardAdded === 'function') callbacks.onBoardAdded();
    } catch (e) {
      if (statusEl) { statusEl.className = 'mgmt-status error'; statusEl.textContent = e.message || String(e); }
    }
  }

  // ── Public API ──

  return {
    init: init,
    refresh: refresh,
    destroy: destroy,
    BOARD_SETTINGS_FIELDS: BOARD_SETTINGS_FIELDS,
  };
})();
