/**
 * Shared Management UI Module
 *
 * IMPORTANT: This file is the SINGLE source of truth for the management interface.
 * Both lexera-backend (connection-settings) and lexera-kanban (collab panel) include
 * this same file. All management content is backend data — NO frontend-only settings.
 * Any change here applies to BOTH apps. Do NOT duplicate this logic elsewhere.
 *
 * Usage:
 *   ManagementUI.init({ container, api, callbacks, ui: ManagementUI.getUiPreset('backendSettings') });
 *   ManagementUI.mount('files', { container, ui: ManagementUI.getUiPreset('files') });
 *   ManagementUI.refresh();          // re-render everything
 *   ManagementUI.refresh('boards');  // re-render one section
 *   ManagementUI.unmount('files');   // tear down a mount
 *   ManagementUI.destroy();          // clean up all mounts
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

  // ── Multi-mount infrastructure ──
  // Each mount = { id, container, uiOptions, delegateHandler, delegateChangeHandler, keydownHandler }
  var mounts = {};
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
  var lastMutationAt = 0;
  var SELF_ECHO_WINDOW_MS = 2000;
  var logEntries = [];
  var logFilePath = '';
  var logStreamSource = null;
  var logStreamRetryTimer = null;
  var logStreamState = 'idle';
  var logViewerPaused = false;
  var logFilter = 'all';
  var MAX_RENDERED_LOG_ENTRIES = 500;
  var workspaceSectionExpanded = {};

  function queryFirst(selector) {
    var ids = Object.keys(mounts);
    for (var i = 0; i < ids.length; i++) {
      var mc = mounts[ids[i]].container;
      if (!mc) continue;
      var el = mc.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function queryAllElements(selector) {
    var results = [];
    var ids = Object.keys(mounts);
    for (var i = 0; i < ids.length; i++) {
      var mc = mounts[ids[i]].container;
      if (!mc) continue;
      var els = mc.querySelectorAll(selector);
      for (var j = 0; j < els.length; j++) results.push(els[j]);
    }
    return results;
  }

  function anyMountHasTab(tabName) {
    var ids = Object.keys(mounts);
    for (var i = 0; i < ids.length; i++) {
      var opts = mounts[ids[i]].uiOptions;
      if (opts && opts.topTabs && opts.topTabs.indexOf(tabName) !== -1) return true;
    }
    return false;
  }

  var VALID_TABS = ['sharing', 'network', 'config', 'logs', 'workspaces', 'boards'];
  var UI_PRESETS = {
    combinedManagement: {
      topTabs: ['sharing', 'network', 'config', 'logs'],
      defaultTopTab: 'network',
      themeEnabled: false
    },
    backendSettings: {
      topTabs: ['network', 'config', 'logs'],
      defaultTopTab: 'network',
      themeEnabled: false
    },
    files: {
      topTabs: ['workspaces', 'boards'],
      defaultTopTab: 'workspaces',
      themeEnabled: false
    }
  };

  function cloneUiOptions(source) {
    var copy = {};
    if (!source) return copy;
    for (var key in source) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      copy[key] = Array.isArray(source[key]) ? source[key].slice() : source[key];
    }
    return copy;
  }

  function getUiPreset(name, overrides) {
    var presetName = name && UI_PRESETS[name] ? name : 'combinedManagement';
    var options = cloneUiOptions(UI_PRESETS[presetName]);
    if (overrides) {
      for (var key in overrides) {
        if (!Object.prototype.hasOwnProperty.call(overrides, key)) continue;
        options[key] = Array.isArray(overrides[key]) ? overrides[key].slice() : overrides[key];
      }
    }
    return options;
  }

  function buildUiOptions(options) {
    options = options || getUiPreset('combinedManagement');
    var topTabs = Array.isArray(options.topTabs) && options.topTabs.length
      ? options.topTabs.filter(function (tab) {
          return VALID_TABS.indexOf(tab) !== -1;
        })
      : getUiPreset('combinedManagement').topTabs;
    if (topTabs.length === 0) topTabs = getUiPreset('combinedManagement').topTabs;
    var defaultTopTab = topTabs.indexOf(options.defaultTopTab) !== -1 ? options.defaultTopTab : topTabs[0];
    return {
      topTabs: topTabs,
      defaultTopTab: defaultTopTab,
      logsEnabled: topTabs.indexOf('logs') !== -1,
      themeEnabled: options.themeEnabled !== false
    };
  }

  function isMountTabEnabled(mountUiOptions, tabName) {
    return !!(mountUiOptions && mountUiOptions.topTabs && mountUiOptions.topTabs.indexOf(tabName) !== -1);
  }

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

  function normalizeOptionalText(value) {
    if (value == null) return null;
    var trimmed = String(value).trim();
    return trimmed ? trimmed : null;
  }

  function getBoardWorkspaceIds(board) {
    var wsIds = board.workspace_ids || board.workspaceIds || [];
    if (wsIds.length === 0 && (board.workspace_id || board.workspaceId)) {
      wsIds = [board.workspace_id || board.workspaceId];
    }
    return wsIds;
  }

  function workspaceSectionKey(wsId, section) {
    return String(wsId || '') + '::' + String(section || '');
  }

  function isWorkspaceSectionExpanded(wsId, section) {
    var key = workspaceSectionKey(wsId, section);
    if (!(key in workspaceSectionExpanded)) {
      return section !== 'details';
    }
    return workspaceSectionExpanded[key] !== false;
  }

  function setWorkspaceSectionExpanded(wsId, section, expanded) {
    workspaceSectionExpanded[workspaceSectionKey(wsId, section)] = expanded !== false;
  }

  function renderWorkspaceSectionHeader(wsId, section, label) {
    var expanded = isWorkspaceSectionExpanded(wsId, section);
    var chevron = expanded ? '&#9660;' : '&#9654;';
    return ''
      + '<button class="mgmt-subsection-toggle"'
      + ' data-mgmt-action="toggle-workspace-section"'
      + ' data-mgmt-ws-id="' + esc(wsId) + '"'
      + ' data-mgmt-ws-section="' + esc(section) + '"'
      + ' aria-expanded="' + (expanded ? 'true' : 'false') + '">'
      + '<span class="mgmt-subsection-chevron" data-mgmt-ws-section-chevron="' + esc(wsId) + ':' + esc(section) + '">' + chevron + '</span>'
      + '<span class="mgmt-subsection-title">' + esc(label) + '</span>'
      + '</button>';
  }

  function updateWorkspaceSectionUi(wsId, section) {
    var expanded = isWorkspaceSectionExpanded(wsId, section);
    var panelSelector = '[data-mgmt-ws-section-panel="' + wsId + ':' + section + '"]';
    var buttonSelector = '[data-mgmt-action="toggle-workspace-section"][data-mgmt-ws-id="' + wsId + '"][data-mgmt-ws-section="' + section + '"]';
    var chevronSelector = '[data-mgmt-ws-section-chevron="' + wsId + ':' + section + '"]';
    queryAllElements(panelSelector).forEach(function (panel) {
      panel.classList.toggle('is-expanded', expanded);
    });
    queryAllElements(buttonSelector).forEach(function (btn) {
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
    queryAllElements(chevronSelector).forEach(function (chevron) {
      chevron.innerHTML = expanded ? '&#9660;' : '&#9654;';
    });
  }

  function renderTriStateSelectHtml(attrs, value) {
    var current = value == null ? '' : String(Boolean(value));
    var attrText = attrs ? ' ' + attrs : '';
    var html = '<select class="mgmt-field-input" ' + attrText + '>';
    html += '<option value=""' + (current === '' ? ' selected' : '') + '>(inherit)</option>';
    html += '<option value="true"' + (current === 'true' ? ' selected' : '') + '>Enabled</option>';
    html += '<option value="false"' + (current === 'false' ? ' selected' : '') + '>Disabled</option>';
    html += '</select>';
    return html;
  }

  function parseTriStateSelectValue(select) {
    if (!select) return null;
    if (select.value === 'true') return true;
    if (select.value === 'false') return false;
    return null;
  }

  function renderInviteListHtml(invites, revokeAction, revokeIdAttr, revokeIdValue) {
    var html = '';
    for (var i = 0; i < invites.length; i++) {
      var inv = invites[i];
      html += '<div class="mgmt-detail-item">';
      html += '<div class="mgmt-invite-info">';
      html += '<span>' + esc(inv.role) + ' &middot; ' + inv.uses + '/' + (inv.max_uses || '&infin;') + ' uses</span>';
      html += '<div class="mgmt-token-field">';
      html += '<input type="text" readonly value="' + esc(inv.token) + '">';
      html += '<button class="mgmt-btn mgmt-btn-small" data-mgmt-action="copy-token" data-mgmt-token="' + esc(inv.token) + '">Copy</button>';
      html += '</div>';
      html += '</div>';
      html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-danger" data-mgmt-action="' + revokeAction + '" ' + revokeIdAttr + '="' + esc(revokeIdValue) + '" data-mgmt-token="' + esc(inv.token) + '">Revoke</button>';
      html += '</div>';
    }
    return html;
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
    mountInstance('default', options);
  }

  function mountInstance(id, options) {
    var mc = options.container;
    if (!mc) throw new Error('ManagementUI.mount requires container');
    if (mounts[id]) {
      unmountInstance(id);
    }
    if (options.api) {
      api = wrapMutatingApi(options.api);
    }
    if (options.callbacks) {
      callbacks = options.callbacks;
    }
    var mountObj = {
      id: id,
      container: mc,
      uiOptions: buildUiOptions(options.ui),
      delegateHandler: null,
      delegateChangeHandler: null,
      keydownHandler: null
    };
    mounts[id] = mountObj;
    initialized = true;
    renderShellForMount(mountObj);
    setupEventDelegationForMount(mountObj);
    loadAllForMounts();
  }

  function unmountInstance(id) {
    var m = mounts[id];
    if (!m) return;
    teardownMountDelegation(m);
    if (m.container) m.container.innerHTML = '';
    delete mounts[id];
    if (Object.keys(mounts).length === 0) {
      disconnectLogStream();
      if (logStreamRetryTimer) { clearTimeout(logStreamRetryTimer); logStreamRetryTimer = null; }
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
      logEntries = [];
      logFilePath = '';
      logStreamState = 'idle';
      logViewerPaused = false;
      logFilter = 'all';
    }
  }

  function destroy() {
    var ids = Object.keys(mounts);
    for (var i = 0; i < ids.length; i++) unmountInstance(ids[i]);
  }

  function teardownMountDelegation(m) {
    if (m.delegateHandler) { document.removeEventListener('click', m.delegateHandler); m.delegateHandler = null; }
    if (m.delegateChangeHandler) { document.removeEventListener('change', m.delegateChangeHandler); m.delegateChangeHandler = null; }
    if (m.keydownHandler && m.container) { m.container.removeEventListener('keydown', m.keydownHandler); m.keydownHandler = null; }
    var bs = m.container && m.container.querySelector('[data-mgmt-section="boards"]');
    if (bs) {
      if (m.boardsDragoverHandler) bs.removeEventListener('dragover', m.boardsDragoverHandler);
      if (m.boardsDragleaveHandler) bs.removeEventListener('dragleave', m.boardsDragleaveHandler);
      if (m.boardsDropHandler) bs.removeEventListener('drop', m.boardsDropHandler);
    }
    m.boardsDragoverHandler = null;
    m.boardsDragleaveHandler = null;
    m.boardsDropHandler = null;
  }

  function refresh(section) {
    if (!initialized) return;
    // Skip full refreshes that are self-echoes from our own mutations
    if (!section && Date.now() - lastMutationAt < SELF_ECHO_WINDOW_MS) return;
    if (section === 'boards') { loadMyBoards(); return; }
    if (section === 'connections') { loadConnections(); return; }
    if (section === 'peers') { loadDiscoveredPeers(); return; }
    if (section === 'workspaces') { loadWorkspaces(); return; }
    if (section === 'logs') { if (anyMountHasTab('logs')) loadLogs(); return; }
    loadAllForMounts();
  }

  async function loadAllForMounts() {
    var needsNetwork = anyMountHasTab('network');
    var needsWorkspaces = anyMountHasTab('sharing') || anyMountHasTab('workspaces');
    var needsBoards = anyMountHasTab('sharing') || anyMountHasTab('boards');
    var needsConfig = anyMountHasTab('config');
    var needsLogs = anyMountHasTab('logs');

    if (needsNetwork) await loadIdentity();
    var initialLoads = [];
    if (needsNetwork) { initialLoads.push(loadServerInfo()); initialLoads.push(loadNetworkInterfaces()); }
    if (needsWorkspaces || needsBoards) initialLoads.push(loadWorkspaces());
    if (needsConfig) initialLoads.push(loadTheme());
    if (needsLogs) initialLoads.push(loadLogs());
    await Promise.all(initialLoads);
    if (needsBoards) await loadMyBoards();
    if (needsNetwork) { await loadConnections(); await loadDiscoveredPeers(); }
  }

  // ── Shell HTML ──

  function renderWorkspacesSection() {
    var html = '';
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
    return html;
  }

  function renderBoardsSection() {
    var html = '';
    html += '<div class="mgmt-section" data-mgmt-section="boards">';
    html += '<div class="mgmt-section-title">My Boards</div>';
    html += '<div class="mgmt-field-row">';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-add-board-input" placeholder="Path to .md file...">';
    html += '<button class="mgmt-btn mgmt-btn-primary mgmt-btn-small" data-mgmt-action="add-board">Add</button>';
    html += '</div>';
    html += '<div class="mgmt-drop-hint">Drop .md files here to add boards</div>';
    html += '<div id="mgmt-boards-list"></div>';
    html += '</div>';
    return html;
  }

  function renderShellForMount(mountObj) {
    var mc = mountObj.container;
    var opts = mountObj.uiOptions;
    var html = '';
    var defaultTopTab = opts && opts.defaultTopTab ? opts.defaultTopTab : opts.topTabs[0];
    var isTab = function (name) { return isMountTabEnabled(opts, name); };

    function tabBtn(id, label) {
      if (!isTab(id)) return '';
      return '<button class="mgmt-top-tab' + (defaultTopTab === id ? ' active' : '') + '" data-mgmt-top-tab="' + id + '">' + label + '</button>';
    }
    function tabOpen(id) {
      return '<div class="mgmt-top-tab-content' + (defaultTopTab === id ? ' active' : '') + '" data-mgmt-top-panel="' + id + '">';
    }

    // Top-level tabs
    html += '<div class="mgmt-top-tab-bar">';
    html += tabBtn('sharing', 'Sharing');
    html += tabBtn('workspaces', 'Workspaces');
    html += tabBtn('boards', 'Boards');
    html += tabBtn('network', 'Network');
    html += tabBtn('config', 'Configuration');
    html += tabBtn('logs', 'Logs');
    html += '</div>';

    // ── Sharing tab (legacy: contains both workspaces + boards) ──
    if (isTab('sharing')) {
      html += tabOpen('sharing');
      html += renderWorkspacesSection();
      html += renderBoardsSection();
      html += '</div>';
    }

    // ── Standalone Workspaces tab ──
    if (isTab('workspaces')) {
      html += tabOpen('workspaces');
      html += renderWorkspacesSection();
      html += '</div>';
    }

    // ── Standalone Boards tab ──
    if (isTab('boards')) {
      html += tabOpen('boards');
      html += renderBoardsSection();
      html += '</div>';
    }

    // ── Network tab ──
    if (isTab('network')) {
      html += tabOpen('network');

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

      html += '</div>'; // end network tab
    }

    // ── Configuration tab ──
    if (isTab('config')) {
      html += tabOpen('config');

    if (opts && opts.themeEnabled) {
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
    }

      html += '</div>'; // end config tab
    }

    // ── Logs tab ──
    if (isTab('logs')) {
      html += tabOpen('logs');
      html += '<div class="mgmt-section" data-mgmt-section="logs">';
      html += '<div class="mgmt-section-title">Logs</div>';
      html += '<div class="mgmt-field-row mgmt-log-toolbar">';
      html += '<label class="mgmt-field-label" for="mgmt-log-filter">Source</label>';
      html += '<select class="mgmt-field-input mgmt-field-select-small" id="mgmt-log-filter">';
      html += '<option value="all">All</option>';
      html += '<option value="backend">Backend</option>';
      html += '<option value="errors">Warnings / Errors</option>';
      html += '</select>';
      html += '<button class="mgmt-btn mgmt-btn-small" data-mgmt-action="toggle-log-pause">Pause</button>';
      html += '<button class="mgmt-btn mgmt-btn-small" data-mgmt-action="refresh-logs">Refresh</button>';
      html += '</div>';
      html += '<div id="mgmt-log-meta" class="mgmt-info-stack"></div>';
      html += '<div id="mgmt-log-file" class="mgmt-info-text"></div>';
      html += '<div id="mgmt-logs-view" class="mgmt-log-view"><div class="mgmt-list-empty">Loading logs...</div></div>';
      html += '</div>';
      html += '</div>'; // end logs tab
    }

    mc.innerHTML = html;
  }

  // ── Event Delegation (per-mount) ──

  function setupEventDelegationForMount(mountObj) {
    var mc = mountObj.container;
    teardownMountDelegation(mountObj);

    mountObj.delegateHandler = function (e) {
      if (!mc || !mc.contains(e.target)) return;

      // Top tab switching (mount-scoped)
      var topTab = e.target.closest('.mgmt-top-tab');
      if (topTab) {
        var tabName = topTab.getAttribute('data-mgmt-top-tab');
        mc.querySelectorAll('.mgmt-top-tab').forEach(function (t) { t.classList.remove('active'); });
        mc.querySelectorAll('.mgmt-top-tab-content').forEach(function (c) { c.classList.remove('active'); });
        topTab.classList.add('active');
        var panel = mc.querySelector('[data-mgmt-top-panel="' + tabName + '"]');
        if (panel) panel.classList.add('active');
        if (tabName === 'logs') renderLogs(false);
        return;
      }

      // Action buttons
      var actionBtn = e.target.closest('[data-mgmt-action]');
      if (actionBtn) {
        handleAction(actionBtn);
        return;
      }

      // Board detail tabs (mount-scoped)
      var detailTab = e.target.closest('.mgmt-detail-tab');
      if (detailTab) {
        var tabBoardId = detailTab.getAttribute('data-mgmt-tab-board');
        var tabKey = detailTab.getAttribute('data-mgmt-tab');
        activeBoardTab[tabBoardId] = tabKey;
        var detailsEl = mc.querySelector('[data-mgmt-details="' + tabBoardId + '"]');
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

    mountObj.delegateChangeHandler = function (e) {
      if (!mc || !mc.contains(e.target)) return;

      var bindSelect = e.target.closest('#mgmt-bind-select');
      if (bindSelect) {
        var customRow = mc.querySelector('#mgmt-custom-bind-row');
        if (customRow) customRow.style.display = bindSelect.value === '__custom__' ? '' : 'none';
        return;
      }

      var portSelect = e.target.closest('#mgmt-port-select');
      if (portSelect) {
        var customRow = mc.querySelector('#mgmt-custom-port-row');
        if (customRow) customRow.style.display = portSelect.value === '__custom__' ? '' : 'none';
        return;
      }

      var logFilterSelect = e.target.closest('#mgmt-log-filter');
      if (logFilterSelect) {
        logFilter = logFilterSelect.value || 'all';
        renderLogs();
        return;
      }

      var themeSelect = e.target.closest('#mgmt-theme-select');
      if (themeSelect) {
        saveTheme(themeSelect.value);
        return;
      }

      var wsSelect = e.target.closest('#mgmt-default-workspace-select');
      if (wsSelect) {
        setDefaultWorkspace(wsSelect.value);
        return;
      }

      var wsCheckbox = e.target.closest('[data-mgmt-ws-toggle]');
      if (wsCheckbox && wsCheckbox.tagName === 'INPUT') {
        var boardId = wsCheckbox.getAttribute('data-mgmt-ws-board');
        var checkboxes = mc.querySelectorAll('input[data-mgmt-ws-toggle][data-mgmt-ws-board="' + boardId + '"]');
        var selectedIds = [];
        checkboxes.forEach(function (cb) { if (cb.checked) selectedIds.push(cb.getAttribute('data-mgmt-ws-toggle')); });
        if (selectedIds.length === 0) {
          wsCheckbox.checked = true;
          notify('Board must belong to at least one workspace');
          return;
        }
        assignBoardWorkspaces(boardId, selectedIds);
        return;
      }
    };

    document.addEventListener('click', mountObj.delegateHandler);
    document.addEventListener('change', mountObj.delegateChangeHandler);

    mountObj.keydownHandler = function (e) {
      if (e.key !== 'Enter') return;
      var target = e.target;
      if (target.id === 'mgmt-add-workspace-input') addWorkspace();
      else if (target.id === 'mgmt-add-board-input') addBoard();
      else if (target.id === 'mgmt-display-name') saveName();
      else if (target.id === 'mgmt-join-token') joinRemote();
    };
    mc.addEventListener('keydown', mountObj.keydownHandler);

    // Drag-and-drop .md files onto boards section
    var boardsSection = mc.querySelector('[data-mgmt-section="boards"]');
    if (boardsSection) {
      mountObj.boardsDragoverHandler = function (e) {
        if (!e.dataTransfer || !e.dataTransfer.types) return;
        if (e.dataTransfer.types.indexOf('Files') === -1) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        boardsSection.classList.add('mgmt-drop-active');
      };
      mountObj.boardsDragleaveHandler = function (e) {
        if (!e.relatedTarget || !boardsSection.contains(e.relatedTarget)) {
          boardsSection.classList.remove('mgmt-drop-active');
        }
      };
      mountObj.boardsDropHandler = function (e) {
        boardsSection.classList.remove('mgmt-drop-active');
        var paths = extractMdPathsFromDataTransfer(e.dataTransfer);
        if (paths.length === 0) return;
        e.preventDefault();
        addBoardsByDrop(paths);
      };
      boardsSection.addEventListener('dragover', mountObj.boardsDragoverHandler);
      boardsSection.addEventListener('dragleave', mountObj.boardsDragleaveHandler);
      boardsSection.addEventListener('drop', mountObj.boardsDropHandler);
    }
  }

  function handleAction(btn) {
    var action = btn.getAttribute('data-mgmt-action');
    var boardId = btn.getAttribute('data-mgmt-board');

    switch (action) {
      case 'add-workspace': addWorkspace(); break;
      case 'add-board': addBoard(); break;
      case 'save-name': saveName(); break;
      case 'save-server': saveServerConfig(); break;
      case 'toggle-log-pause': toggleLogPause(); break;
      case 'refresh-logs': loadLogs(); break;
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
      case 'toggle-workspace-section': toggleWorkspaceSection(btn.getAttribute('data-mgmt-ws-id'), btn.getAttribute('data-mgmt-ws-section')); break;
      case 'save-workspace-sync': saveWorkspaceSync(btn.getAttribute('data-mgmt-ws-id')); break;
      case 'save-workspace-appearance': saveWorkspaceAppearance(btn.getAttribute('data-mgmt-ws-id')); break;
      case 'create-workspace-invite': createWorkspaceInvite(btn.getAttribute('data-mgmt-ws-id')); break;
      case 'revoke-workspace-invite': revokeWorkspaceInvite(btn.getAttribute('data-mgmt-ws-id'), btn.getAttribute('data-mgmt-token')); break;
      case 'save-board-sync': saveBoardSync(boardId); break;
    }
  }

  // ── Identity ──

  async function loadIdentity() {
    try {
      me = await api.get('/collab/me');
      var input = queryFirst('#mgmt-display-name');
      if (input) input.value = me.name || '';
    } catch (e) { /* ignore */ }
  }

  async function saveName() {
    var input = queryFirst('#mgmt-display-name');
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
      var addrEl = queryFirst('#mgmt-server-address');
      if (addrEl) addrEl.textContent = 'http://' + (info.address || info.bind_address || info.bindAddress) + ':' + info.port;
    } catch (e) {
      var addrEl = queryFirst('#mgmt-server-address');
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
    var select = queryFirst('#mgmt-bind-select');
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

    var customRow = queryFirst('#mgmt-custom-bind-row');
    if (currentBind && found) {
      select.value = currentBind;
      if (customRow) customRow.style.display = 'none';
    } else if (currentBind && !found) {
      select.value = '__custom__';
      var customInput = queryFirst('#mgmt-bind-custom');
      if (customInput) customInput.value = currentBind;
      if (customRow) customRow.style.display = '';
    }
  }

  function populatePortSelect(defaultPort, currentPort) {
    var select = queryFirst('#mgmt-port-select');
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

    var customRow = queryFirst('#mgmt-custom-port-row');
    if (currentPort && currentPort !== defaultPort) {
      select.value = '__custom__';
      var customInput = queryFirst('#mgmt-port-custom');
      if (customInput) customInput.value = currentPort;
      if (customRow) customRow.style.display = '';
    } else {
      select.value = String(defaultPort);
      if (customRow) customRow.style.display = 'none';
    }
  }

  async function saveServerConfig() {
    var bindSelect = queryFirst('#mgmt-bind-select');
    var bindAddr = bindSelect ? bindSelect.value : '0.0.0.0';
    if (bindAddr === '__custom__') {
      var customBind = queryFirst('#mgmt-bind-custom');
      bindAddr = customBind ? customBind.value.trim() : '';
      if (!bindAddr) return;
    }

    var portSelect = queryFirst('#mgmt-port-select');
    var portVal = portSelect ? portSelect.value : '13080';
    var port;
    if (portVal === '__custom__') {
      var customPort = queryFirst('#mgmt-port-custom');
      port = customPort ? parseInt(customPort.value, 10) : NaN;
      if (isNaN(port) || port < 1024 || port > 65535) return;
    } else {
      port = parseInt(portVal, 10);
    }

    var restartNote = queryFirst('#mgmt-server-restart-note');
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
    var select = queryFirst('#mgmt-theme-select');
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

    var modeEl = queryFirst('#mgmt-color-mode');
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

  // ── Logs ──

  function normalizeLogEntry(entry) {
    if (!entry) return null;
    return {
      timestampMs: Number(entry.timestampMs || entry.timestamp_ms || Date.now()),
      level: String(entry.level || 'info').toLowerCase(),
      target: String(entry.target || 'backend'),
      message: String(entry.message || ''),
    };
  }

  function logSourceForEntry() {
    return 'backend';
  }

  function formatLogTimestamp(timestampMs) {
    try {
      return new Date(timestampMs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch (_) {
      return '';
    }
  }

  function logMatchesFilter(entry) {
    if (logFilter === 'backend') return logSourceForEntry(entry) === 'backend';
    if (logFilter === 'errors') return entry.level === 'warn' || entry.level === 'error';
    return true;
  }

  function renderLogs(shouldStickToBottom) {
    if (!initialized) return;
    var viewEl = queryFirst('#mgmt-logs-view');
    var metaEl = queryFirst('#mgmt-log-meta');
    var fileEl = queryFirst('#mgmt-log-file');
    var pauseBtn = queryFirst('[data-mgmt-action="toggle-log-pause"]');
    var filterSelect = queryFirst('#mgmt-log-filter');
    if (!viewEl || !metaEl || !fileEl) return;

    var nearBottom = typeof shouldStickToBottom === 'boolean'
      ? shouldStickToBottom
      : (viewEl.scrollHeight - (viewEl.scrollTop + viewEl.clientHeight) < 24);
    var filtered = logEntries.filter(logMatchesFilter);
    var rendered = filtered.slice(-MAX_RENDERED_LOG_ENTRIES);
    var html = '';

    if (!rendered.length) {
      html = '<div class="mgmt-list-empty">No matching log entries</div>';
    } else {
      for (var i = 0; i < rendered.length; i++) {
        var entry = rendered[i];
        var source = logSourceForEntry(entry);
        var sourceLabel = 'Backend';
        html += '<div class="mgmt-log-line mgmt-log-level-' + esc(entry.level) + '">';
        html += '<span class="mgmt-log-ts">' + esc(formatLogTimestamp(entry.timestampMs)) + '</span>';
        html += '<span class="mgmt-log-source mgmt-log-source-' + esc(source) + '">' + esc(sourceLabel) + '</span>';
        html += '<span class="mgmt-log-target">' + esc(entry.target) + '</span>';
        html += '<span class="mgmt-log-message">' + esc(entry.message) + '</span>';
        html += '</div>';
      }
    }

    viewEl.innerHTML = html;
    if (nearBottom) viewEl.scrollTop = viewEl.scrollHeight;
    if (pauseBtn) pauseBtn.textContent = logViewerPaused ? 'Resume' : 'Pause';
    if (filterSelect && filterSelect.value !== logFilter) filterSelect.value = logFilter;

    var totalCount = logEntries.length;
    var matchingCount = filtered.length;
    var streamLabels = { live: 'Live', retrying: 'Reconnecting', error: 'Stream error' };
    var streamText = streamLabels[logStreamState] || 'Snapshot';
    var metaHtml = '';
    metaHtml += '<div><strong>Viewer:</strong> ' + (logViewerPaused ? 'Paused' : 'Streaming') + '</div>';
    metaHtml += '<div><strong>Stream:</strong> ' + streamText + '</div>';
    metaHtml += '<div><strong>Entries:</strong> ' + matchingCount + ' shown / ' + totalCount + ' loaded</div>';
    metaEl.innerHTML = metaHtml;
    fileEl.textContent = logFilePath ? ('Aggregated log file: ' + logFilePath) : '';
  }

  function replaceLogEntries(entries, filePath) {
    logEntries = (entries || [])
      .map(normalizeLogEntry)
      .filter(Boolean)
      .sort(function (a, b) { return a.timestampMs - b.timestampMs; });
    logFilePath = filePath || '';
    renderLogs(true);
  }

  function appendLogEntry(entry) {
    var normalized = normalizeLogEntry(entry);
    if (!normalized) return;
    logEntries.push(normalized);
    while (logEntries.length > 2000) logEntries.shift();
    if (!logViewerPaused) renderLogs();
  }

  function disconnectLogStream() {
    if (logStreamSource && typeof logStreamSource.close === 'function') {
      logStreamSource.close();
    }
    logStreamSource = null;
  }

  function scheduleLogStreamRetry() {
    if (logStreamRetryTimer) return;
    logStreamState = 'retrying';
    renderLogs(false);
    logStreamRetryTimer = setTimeout(function () {
      logStreamRetryTimer = null;
      connectLogStream();
    }, 1500);
  }

  function connectLogStream() {
    if (!callbacks || typeof callbacks.openLogStream !== 'function') {
      logStreamState = 'idle';
      renderLogs(false);
      return;
    }
    if (logStreamSource) return;

    var source = callbacks.openLogStream(function (entry) {
      logStreamState = 'live';
      appendLogEntry(entry);
    }, function () {
      logStreamState = 'live';
      renderLogs(false);
    }, function () {
      disconnectLogStream();
      logStreamState = 'error';
      renderLogs(false);
      scheduleLogStreamRetry();
    });

    if (!source) {
      scheduleLogStreamRetry();
      return;
    }

    logStreamState = 'connecting';
    logStreamSource = source;
    renderLogs(false);
  }

  async function loadLogs() {
    try {
      var data = await api.get('/logs');
      replaceLogEntries(data && data.entries ? data.entries : [], data && data.filePath ? data.filePath : '');
      connectLogStream();
    } catch (e) {
      logStreamState = 'error';
      renderLogs(false);
      notify('Failed to load logs: ' + (e.message || e));
    }
  }

  function toggleLogPause() {
    logViewerPaused = !logViewerPaused;
    renderLogs(false);
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
    var el = queryFirst('#mgmt-workspaces-list');
    if (!el) return;
    if (!cachedWorkspaces.length) {
      el.innerHTML = '<div class="mgmt-list-empty">No workspaces</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < cachedWorkspaces.length; i++) {
      var ws = cachedWorkspaces[i];
      var boardCount = typeof ws.board_count === 'number' ? ws.board_count : null;
      html += '<div class="mgmt-workspace-block">';
      html += '<div class="mgmt-workspace-row">';
      html += '<input class="mgmt-field-input mgmt-ws-name-input" data-mgmt-ws-name-id="' + esc(ws.id) + '" value="' + esc(ws.name) + '">';
      if (boardCount != null) {
        html += '<span class="mgmt-ws-count">' + boardCount + ' board' + (boardCount === 1 ? '' : 's') + '</span>';
      }
      html += '<button class="mgmt-btn mgmt-btn-small" data-mgmt-action="rename-workspace" data-mgmt-ws-id="' + esc(ws.id) + '">Rename</button>';
      html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-danger" data-mgmt-action="delete-workspace" data-mgmt-ws-id="' + esc(ws.id) + '" data-mgmt-ws-name="' + esc(ws.name) + '">&times;</button>';
      html += '</div>';
      html += renderWorkspaceSectionHeader(ws.id, 'details', 'Settings');
      html += '<div class="mgmt-workspace-subsection' + (isWorkspaceSectionExpanded(ws.id, 'details') ? ' is-expanded' : '') + '" data-mgmt-ws-section-panel="' + esc(ws.id) + ':details">';
      html += renderWorkspaceSectionHeader(ws.id, 'sync', 'Sync Defaults');
      html += '<div class="mgmt-workspace-subsection' + (isWorkspaceSectionExpanded(ws.id, 'sync') ? ' is-expanded' : '') + '" data-mgmt-ws-section-panel="' + esc(ws.id) + ':sync">';
      html += '<div class="mgmt-sync-grid">';
      html += '<label>Bookmark Sync</label>';
      html += renderTriStateSelectHtml('id="mgmt-ws-bookmark-sync-' + esc(ws.id) + '"', ws.bookmarkSync);
      html += '<label>Calendar Sync</label>';
      html += renderTriStateSelectHtml('id="mgmt-ws-calendar-sync-' + esc(ws.id) + '"', ws.calendarSync);
      html += '<label>Calendar Slug</label>';
      html += '<input class="mgmt-field-input" type="text" id="mgmt-ws-calendar-slug-' + esc(ws.id) + '" value="' + esc(ws.calendarSlug || '') + '" placeholder="Optional">';
      html += '<label>Calendar Name</label>';
      html += '<input class="mgmt-field-input" type="text" id="mgmt-ws-calendar-name-' + esc(ws.id) + '" value="' + esc(ws.calendarName || '') + '" placeholder="Optional">';
      html += '</div>';
      html += '<div class="mgmt-settings-actions">';
      html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="save-workspace-sync" data-mgmt-ws-id="' + esc(ws.id) + '">Save Sync Defaults</button>';
      html += '</div>';
      html += '</div>';
      html += renderWorkspaceSectionHeader(ws.id, 'appearance', 'Appearance');
      html += '<div class="mgmt-workspace-subsection' + (isWorkspaceSectionExpanded(ws.id, 'appearance') ? ' is-expanded' : '') + '" data-mgmt-ws-section-panel="' + esc(ws.id) + ':appearance">';
      html += '<div class="mgmt-sync-grid">';
      html += '<label>Theme</label>';
      html += '<select class="mgmt-field-input" id="mgmt-ws-theme-' + esc(ws.id) + '">';
      html += '<option value=""' + (!ws.theme ? ' selected' : '') + '>Default</option>';
      var themeOptions = ['bordered', 'gap-highlight', 'lines'];
      for (var t = 0; t < themeOptions.length; t++) {
        html += '<option value="' + themeOptions[t] + '"' + (ws.theme === themeOptions[t] ? ' selected' : '') + '>' + themeOptions[t].charAt(0).toUpperCase() + themeOptions[t].slice(1) + '</option>';
      }
      html += '</select>';
      html += '<label>Layout Preset</label>';
      html += '<input class="mgmt-field-input" type="text" id="mgmt-ws-layout-preset-' + esc(ws.id) + '" value="' + esc(ws.layoutPreset || '') + '" placeholder="Default">';
      html += '</div>';
      html += '<div class="mgmt-settings-actions">';
      html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="save-workspace-appearance" data-mgmt-ws-id="' + esc(ws.id) + '">Save Appearance</button>';
      html += '</div>';
      html += '</div>';
      html += renderWorkspaceSectionHeader(ws.id, 'invites', 'Invitations');
      html += '<div class="mgmt-workspace-subsection' + (isWorkspaceSectionExpanded(ws.id, 'invites') ? ' is-expanded' : '') + '" data-mgmt-ws-section-panel="' + esc(ws.id) + ':invites">';
      html += '<div class="mgmt-invite-controls">';
      html += '<select class="mgmt-field-input mgmt-field-select-small" id="mgmt-ws-invite-role-' + esc(ws.id) + '">';
      html += '<option value="editor">Editor</option><option value="viewer">Viewer</option>';
      html += '</select>';
      html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="create-workspace-invite" data-mgmt-ws-id="' + esc(ws.id) + '">Invite</button>';
      html += '</div>';
      html += '<div data-mgmt-ws-invites-list="' + esc(ws.id) + '"><span class="mgmt-list-empty">Loading...</span></div>';
      html += '</div>';
      html += '</div>'; // end details fold
      html += '</div>';
    }
    el.innerHTML = html;
    // Load workspace invites for each workspace
    for (var wi = 0; wi < cachedWorkspaces.length; wi++) {
      loadWorkspaceInvites(cachedWorkspaces[wi].id);
    }
  }

  function populateDefaultWorkspaceSelect() {
    var select = queryFirst('#mgmt-default-workspace-select');
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

  function toggleWorkspaceSection(wsId, section) {
    if (!wsId || !section) return;
    setWorkspaceSectionExpanded(wsId, section, !isWorkspaceSectionExpanded(wsId, section));
    updateWorkspaceSectionUi(wsId, section);
  }

  async function addWorkspace() {
    var input = queryFirst('#mgmt-add-workspace-input');
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
    var input = queryFirst('[data-mgmt-ws-name-id="' + wsId + '"]');
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

  async function saveWorkspaceSync(wsId) {
    var bookmarkSelect = queryFirst('#mgmt-ws-bookmark-sync-' + wsId);
    var calendarSelect = queryFirst('#mgmt-ws-calendar-sync-' + wsId);
    var slugInput = queryFirst('#mgmt-ws-calendar-slug-' + wsId);
    var nameInput = queryFirst('#mgmt-ws-calendar-name-' + wsId);

    var payload = {
      bookmarkSync: parseTriStateSelectValue(bookmarkSelect),
      calendarSync: parseTriStateSelectValue(calendarSelect),
      calendarSlug: normalizeOptionalText(slugInput && slugInput.value),
      calendarName: normalizeOptionalText(nameInput && nameInput.value),
    };

    try {
      await api.put('/config/workspaces/' + wsId + '/sync', payload);
      await loadWorkspaces();
      notify('Workspace sync defaults saved');
    } catch (e) {
      notify('Failed to save workspace sync defaults: ' + (e.message || e));
    }
  }

  async function saveWorkspaceAppearance(wsId) {
    var themeSelect = queryFirst('#mgmt-ws-theme-' + wsId);
    var layoutInput = queryFirst('#mgmt-ws-layout-preset-' + wsId);

    var payload = {
      theme: normalizeOptionalText(themeSelect && themeSelect.value),
      layout_preset: normalizeOptionalText(layoutInput && layoutInput.value),
    };

    try {
      await api.put('/config/workspaces/' + wsId + '/appearance', payload);
      await loadWorkspaces();
      notify('Workspace appearance saved');
    } catch (e) {
      notify('Failed to save workspace appearance: ' + (e.message || e));
    }
  }

  async function loadWorkspaceInvites(wsId) {
    if (!me) return;
    var el = queryFirst('[data-mgmt-ws-invites-list="' + wsId + '"]');
    if (!el) return;
    try {
      var invites = await api.get('/collab/workspaces/' + wsId + '/invites');
      if (!invites || !invites.length) {
        el.innerHTML = '<span class="mgmt-list-empty">No active invites</span>';
        return;
      }
      el.innerHTML = renderInviteListHtml(invites, 'revoke-workspace-invite', 'data-mgmt-ws-id', wsId);
    } catch (e) {
      el.innerHTML = '<span class="mgmt-list-empty">No active invites</span>';
    }
  }

  async function createWorkspaceInvite(wsId) {
    if (!me) return;
    var roleSelect = queryFirst('#mgmt-ws-invite-role-' + wsId);
    var role = roleSelect ? roleSelect.value : 'editor';
    try {
      await api.post('/collab/workspaces/' + wsId + '/invites', { role: role });
      await loadWorkspaceInvites(wsId);
      notify('Workspace invite created');
    } catch (e) {
      notify('Failed to create workspace invite: ' + (e.message || e));
    }
  }

  async function revokeWorkspaceInvite(wsId, token) {
    if (!me) return;
    try {
      await api.delete('/collab/workspaces/' + wsId + '/invites/' + token);
      await loadWorkspaceInvites(wsId);
      notify('Workspace invite revoked');
    } catch (e) {
      notify('Failed to revoke workspace invite: ' + (e.message || e));
    }
  }

  // ── My Boards ──

  async function loadMyBoards() {
    var el = queryFirst('#mgmt-boards-list');
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
      var wsIds = getBoardWorkspaceIds(b);

      var peerCount = typeof b.peerCount === 'number' ? b.peerCount : 0;
      var isLocal = b.isLocal !== false;

      html += '<div class="mgmt-board-row">';
      html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-fold" data-mgmt-action="toggle-details" data-mgmt-board="' + esc(b.id) + '">' + (isExpanded ? '&#9660;' : '&#9654;') + '</button>';
      // Presence indicator
      if (peerCount > 0) {
        html += '<span class="mgmt-board-presence active" title="' + peerCount + ' user' + (peerCount > 1 ? 's' : '') + ' connected">' + peerCount + '</span>';
      } else {
        html += '<span class="mgmt-board-presence" title="No active connections"></span>';
      }
      html += '<span class="mgmt-board-name" data-mgmt-expand="' + esc(b.id) + '">' + esc(boardName) + '</span>';
      // Authority badge
      html += '<span class="mgmt-board-authority ' + (isLocal ? 'local' : 'remote') + '">' + (isLocal ? 'Local' : 'Remote') + '</span>';
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
    var boardWsIds = board ? getBoardWorkspaceIds(board) : [];
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
    var board = cachedBoards.filter(function (b) { return b.id === boardId; })[0] || {};
    var html = '';
    html += '<div class="mgmt-subsection-title">WebDAV / CalDAV Overrides</div>';
    html += '<div class="mgmt-sync-grid">';
    html += '<label>XBEL Name</label>';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-board-xbel-name-' + esc(boardId) + '" value="' + esc(board.xbelName || board.xbel_name || '') + '" placeholder="Optional">';
    html += '<label>Bookmark Sync</label>';
    html += renderTriStateSelectHtml('id="mgmt-board-bookmark-sync-' + esc(boardId) + '"', board.bookmarkSync != null ? board.bookmarkSync : board.bookmark_sync);
    html += '<label>Calendar Sync</label>';
    html += renderTriStateSelectHtml('id="mgmt-board-calendar-sync-' + esc(boardId) + '"', board.calendarSync != null ? board.calendarSync : board.calendar_sync);
    html += '<label>Calendar Slug</label>';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-board-calendar-slug-' + esc(boardId) + '" value="' + esc(board.calendarSlug || board.calendar_slug || '') + '" placeholder="Optional">';
    html += '<label>Calendar Name</label>';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-board-calendar-name-' + esc(boardId) + '" value="' + esc(board.calendarName || board.calendar_name || '') + '" placeholder="Optional">';
    html += '</div>';
    html += '<div class="mgmt-settings-actions">';
    html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="save-board-sync" data-mgmt-board="' + esc(boardId) + '">Save Sync Overrides</button>';
    html += '</div>';

    html += '<div class="mgmt-subsection-title">Board Display Settings</div>';
    html += '<div class="mgmt-settings-grid">';
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

  async function saveBoardSync(boardId) {
    var payload = {
      xbelName: normalizeOptionalText((queryFirst('#mgmt-board-xbel-name-' + boardId) || {}).value),
      bookmarkSync: parseTriStateSelectValue(queryFirst('#mgmt-board-bookmark-sync-' + boardId)),
      calendarSync: parseTriStateSelectValue(queryFirst('#mgmt-board-calendar-sync-' + boardId)),
      calendarSlug: normalizeOptionalText((queryFirst('#mgmt-board-calendar-slug-' + boardId) || {}).value),
      calendarName: normalizeOptionalText((queryFirst('#mgmt-board-calendar-name-' + boardId) || {}).value),
    };

    try {
      await api.put('/config/boards/' + boardId + '/sync', payload);
      await loadMyBoards();
      notify('Board sync overrides saved');
    } catch (e) {
      notify('Failed to save board sync overrides: ' + (e.message || e));
    }
  }

  function toggleBoardDetails(boardId) {
    var detailsEl = queryFirst('[data-mgmt-details="' + boardId + '"]');
    if (!detailsEl) return;
    var isExpanding = !detailsEl.classList.contains('expanded');
    detailsEl.classList.toggle('expanded');
    var btn = queryFirst('[data-mgmt-action="toggle-details"][data-mgmt-board="' + boardId + '"]');
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
        api.get('/collab/rooms/' + boardId + '/invites'),
        api.get('/collab/rooms/' + boardId + '/members'),
      ]);
      var invites = results[0].status === 'fulfilled' ? results[0].value : [];
      var members = results[1].status === 'fulfilled' ? results[1].value : [];

      // Render invites
      var invitesEl = queryFirst('[data-mgmt-invites-list="' + boardId + '"]');
      if (invitesEl) {
        if (!invites.length) {
          invitesEl.innerHTML = '<span class="mgmt-list-empty">No active invites</span>';
        } else {
          invitesEl.innerHTML = renderInviteListHtml(invites, 'revoke-invite', 'data-mgmt-board', boardId);
        }
      }

      // Render members
      var membersEl = queryFirst('[data-mgmt-members-list="' + boardId + '"]');
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

  function extractMdPathsFromDataTransfer(dt) {
    if (!dt) return [];
    var paths = [];
    var files = dt.files || [];
    for (var i = 0; i < files.length; i++) {
      var p = files[i].path || '';
      if (p) paths.push(p);
    }
    if (typeof dt.getData === 'function') {
      var uriList = dt.getData('text/uri-list');
      if (uriList) {
        var lines = uriList.split(/\r?\n/);
        for (var j = 0; j < lines.length; j++) {
          var line = lines[j].trim();
          if (line && line.indexOf('#') !== 0) paths.push(line);
        }
      }
      var plain = dt.getData('text/plain');
      if (plain && (plain.indexOf('file://') === 0 || plain.indexOf('/') === 0 || /^[A-Za-z]:[\\/]/.test(plain))) {
        paths.push(plain);
      }
    }
    var seen = {};
    var result = [];
    for (var k = 0; k < paths.length; k++) {
      var normalized = paths[k].trim();
      if (normalized.indexOf('file://') === 0) {
        try { normalized = decodeURIComponent(new URL(normalized).pathname || ''); } catch (e) { /* keep */ }
        if (/^\/[A-Za-z]:\//.test(normalized)) normalized = normalized.slice(1);
      }
      if (!normalized || !/\.md$/i.test(normalized) || seen[normalized]) continue;
      seen[normalized] = true;
      result.push(normalized);
    }
    return result;
  }

  async function addBoardsByDrop(paths) {
    if (!paths.length) return;
    var added = 0;
    for (var i = 0; i < paths.length; i++) {
      try {
        await api.post('/boards', { file: paths[i] });
        added++;
      } catch (e) {
        notify('Failed to add: ' + paths[i].split('/').pop() + ' — ' + (e.message || e));
      }
    }
    if (added > 0) {
      await loadMyBoards();
      notify(added + ' board' + (added > 1 ? 's' : '') + ' added');
      if (callbacks && typeof callbacks.onBoardAdded === 'function') callbacks.onBoardAdded();
    }
  }

  async function addBoard() {
    var input = queryFirst('#mgmt-add-board-input');
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
    var inputs = queryAllElements('[data-mgmt-board-setting][data-mgmt-setting-board="' + boardId + '"]');
    var settings = {};
    for (var i = 0; i < inputs.length; i++) {
      var key = inputs[i].getAttribute('data-mgmt-board-setting');
      var value = inputs[i].value.trim();
      if (value === '') {
        settings[key] = null;
      } else if (inputs[i].type === 'number') {
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
    var roleSelect = queryFirst('#mgmt-role-' + boardId);
    var role = roleSelect ? roleSelect.value : 'editor';
    try {
      await api.post('/collab/rooms/' + boardId + '/invites', { role: role });
      // Expand details and reload
      var detailsEl = queryFirst('[data-mgmt-details="' + boardId + '"]');
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
      await api.delete('/collab/rooms/' + boardId + '/invites/' + token);
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
    var el = queryFirst('#mgmt-connections-list');
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
    var el = queryFirst('#mgmt-peers-list');
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
    var urlInput = queryFirst('#mgmt-join-url');
    var tokenInput = queryFirst('#mgmt-join-token');
    if (urlInput) urlInput.value = peerUrl;
    if (tokenInput) tokenInput.focus();
    // Switch to sharing tab if on config tab
    var sharingTab = queryFirst('[data-mgmt-top-tab="sharing"]');
    if (sharingTab && !sharingTab.classList.contains('active')) {
      sharingTab.click();
    }
  }

  // ── Join Remote Board ──

  async function joinRemote() {
    var urlInput = queryFirst('#mgmt-join-url');
    var tokenInput = queryFirst('#mgmt-join-token');
    var statusEl = queryFirst('#mgmt-join-status');
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
    mount: mountInstance,
    unmount: unmountInstance,
    refresh: refresh,
    destroy: destroy,
    UI_PRESETS: UI_PRESETS,
    getUiPreset: getUiPreset,
    BOARD_SETTINGS_FIELDS: BOARD_SETTINGS_FIELDS,
  };
})();
