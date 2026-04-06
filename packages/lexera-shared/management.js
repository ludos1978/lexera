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
  var workspaceInviteAccess = {};
  // Config panel state: { type: 'global'|'workspace'|'board', id: string } or null
  var configSelectedItem = null;
  var cachedGlobalSync = { bookmarkSync: null, calendarSync: null, calendarName: null };

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

  function setElementHidden(el, hidden) {
    if (el) el.hidden = !!hidden;
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

  function anyMountShowingTopTab(tabName) {
    var ids = Object.keys(mounts);
    for (var i = 0; i < ids.length; i++) {
      if (mounts[ids[i]].activeTopTab === tabName) return true;
    }
    return false;
  }

  function getTauriInvoke() {
    if (
      typeof window !== 'undefined' &&
      window.__TAURI_INTERNALS__ &&
      typeof window.__TAURI_INTERNALS__.invoke === 'function'
    ) {
      return window.__TAURI_INTERNALS__.invoke;
    }
    if (
      typeof window !== 'undefined' &&
      window.__TAURI__ &&
      window.__TAURI__.core &&
      typeof window.__TAURI__.core.invoke === 'function'
    ) {
      return window.__TAURI__.core.invoke;
    }
    return null;
  }

  var VALID_TABS = ['sharing', 'network', 'logs', 'workspaces', 'boards', 'workspace-config'];
  var UI_PRESETS = {
    combinedManagement: {
      topTabs: ['sharing', 'network', 'logs'],
      defaultTopTab: 'network'
    },
    backendSettings: {
      topTabs: ['network', 'logs'],
      defaultTopTab: 'network'
    },
    backendConfig: {
      topTabs: ['network'],
      defaultTopTab: 'network'
    },
    files: {
      topTabs: ['workspace-config'],
      defaultTopTab: 'workspace-config'
    }
  };
  var SECTION_SURFACE_IDS = {
    sharing: 'files',
    workspaces: 'files',
    boards: 'files',
    'workspace-config': 'files',
    network: 'backendSettings',
    config: 'backendSettings',
    logs: 'backendSettings'
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

  function getSurfaceIdForSection(sectionName) {
    if (!sectionName) return 'backendSettings';
    return SECTION_SURFACE_IDS[sectionName] || 'backendSettings';
  }

  function getTopTabForContext(sectionName, contextName) {
    var section = sectionName || '';
    if (contextName === 'files') {
      if (section === 'boards' || section === 'workspaces' || section === 'workspace-config') return section;
      return UI_PRESETS.files.defaultTopTab;
    }
    if (contextName === 'backendSettings') {
      if (section === 'config') return 'network';
      if (section === 'network' || section === 'logs') return section;
      return UI_PRESETS.backendSettings.defaultTopTab;
    }
    if (section === 'workspaces' || section === 'boards' || section === 'sharing') return 'sharing';
    if (section === 'config') return 'network';
    if (section === 'network' || section === 'logs') return section;
    return UI_PRESETS.combinedManagement.defaultTopTab;
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
      logsEnabled: topTabs.indexOf('logs') !== -1
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

  function getManagementTreeViewApi() {
    if (typeof window !== 'undefined' && window.TreeView) return window.TreeView;
    return null;
  }

  function getManagementHierarchyControllerApi() {
    if (typeof window !== 'undefined' && window.LexeraHierarchyController) return window.LexeraHierarchyController;
    return null;
  }

  function getManagementHierarchyContractApi() {
    if (typeof window !== 'undefined' && window.LexeraHierarchyContract) return window.LexeraHierarchyContract;
    if (typeof LexeraHierarchyContract !== 'undefined' && LexeraHierarchyContract) return LexeraHierarchyContract;
    return null;
  }

  function getManagementBoardDisplayName(board) {
    return board.title || (board.filePath || board.file_path || board.id || '').split('/').pop().replace('.md', '') || 'Untitled';
  }

  function buildConfigTreeNodeType(baseType, options) {
    var hierarchyContract = getManagementHierarchyContractApi();
    if (hierarchyContract && typeof hierarchyContract.composeNodeType === 'function') {
      return hierarchyContract.composeNodeType(String(baseType || '').trim(), {
        'mgmt-config-tree-node': true,
        'mgmt-config-tree-child': !!(options && options.child),
        selected: !!(options && options.selected)
      });
    }
    var classes = [String(baseType || '').trim(), 'mgmt-config-tree-node'];
    if (options && options.child) classes.push('mgmt-config-tree-child');
    if (options && options.selected) classes.push('selected');
    return classes.join(' ');
  }

  function createHierarchyNode(definition) {
    var hierarchyContract = getManagementHierarchyContractApi();
    if (hierarchyContract && typeof hierarchyContract.createNode === 'function') {
      return hierarchyContract.createNode(definition);
    }
    return definition;
  }

  function buildConfigBoardTreeNode(board, options) {
    options = options || {};
    return createHierarchyNode({
      id: 'board:' + String(board.id || ''),
      label: getManagementBoardDisplayName(board),
      type: buildConfigTreeNodeType('board', {
        child: true,
        selected: !!options.selected
      }),
      expanded: false,
      hasToggle: false,
      grip: false,
      menu: false,
      attrs: {
        'data-mgmt-config-type': 'board',
        'data-mgmt-config-id': String(board.id || ''),
        'data-mgmt-tree-selectable': 'true'
      },
      hierarchy: {
        surface: 'files',
        kind: 'board',
        entityId: String(board.id || ''),
        capabilities: ['activate'],
        selectable: true
      }
    });
  }

  function getConfigUnassignedBoards() {
    return cachedBoards.filter(function (board) {
      var wsIds = getBoardWorkspaceIds(board);
      if (wsIds.length === 0) return true;
      for (var i = 0; i < wsIds.length; i++) {
        for (var j = 0; j < cachedWorkspaces.length; j++) {
          if (cachedWorkspaces[j].id === wsIds[i]) return false;
        }
      }
      return true;
    });
  }

  function buildConfigTreeNodes() {
    var nodes = [];
    var globalSelected = configSelectedItem && configSelectedItem.type === 'global';
    nodes.push(createHierarchyNode({
      id: 'config:global',
      label: 'Global Settings',
      type: buildConfigTreeNodeType('config-root', { selected: !!globalSelected }),
      expanded: false,
      hasToggle: false,
      grip: false,
      menu: false,
      attrs: {
        'data-mgmt-config-type': 'global',
        'data-mgmt-config-id': 'global',
        'data-mgmt-tree-selectable': 'true'
      },
      hierarchy: {
        surface: 'files',
        kind: 'global',
        entityId: 'global',
        capabilities: ['activate'],
        selectable: true
      }
    }));

    for (var i = 0; i < cachedWorkspaces.length; i++) {
      var ws = cachedWorkspaces[i];
      var wsBoards = cachedBoards.filter(function (board) {
        return getBoardWorkspaceIds(board).indexOf(ws.id) >= 0;
      });
      var workspaceSelected = configSelectedItem && configSelectedItem.type === 'workspace' && configSelectedItem.id === ws.id;
      var workspaceLabel = ws.name || 'Untitled Workspace';
      if (ws.id === cachedDefaultWorkspaceId) workspaceLabel += ' \u2605';
      nodes.push(createHierarchyNode({
        id: 'workspace:' + String(ws.id || ''),
        label: workspaceLabel,
        count: wsBoards.length,
        type: buildConfigTreeNodeType('workspace', { selected: !!workspaceSelected }),
        expanded: true,
        hasToggle: wsBoards.length > 0,
        grip: false,
        menu: false,
        children: wsBoards.map(function (board) {
          return buildConfigBoardTreeNode(board, {
            selected: !!(configSelectedItem && configSelectedItem.type === 'board' && configSelectedItem.id === board.id)
          });
        }),
        attrs: {
          'data-mgmt-config-type': 'workspace',
          'data-mgmt-config-id': String(ws.id || ''),
          'data-mgmt-tree-selectable': 'true'
        },
        hierarchy: {
          surface: 'files',
          kind: 'workspace',
          entityId: String(ws.id || ''),
          capabilities: ['activate'],
          selectable: true
        }
      }));
    }

    var unassignedBoards = getConfigUnassignedBoards();
    if (unassignedBoards.length > 0) {
      nodes.push(createHierarchyNode({
        id: 'group:unassigned',
        label: 'Unassigned',
        count: unassignedBoards.length,
        type: buildConfigTreeNodeType('group'),
        expanded: true,
        hasToggle: true,
        grip: false,
        menu: false,
        children: unassignedBoards.map(function (board) {
          return buildConfigBoardTreeNode(board, {
            selected: !!(configSelectedItem && configSelectedItem.type === 'board' && configSelectedItem.id === board.id)
          });
        }),
        attrs: {
          'data-mgmt-config-type': 'group',
          'data-mgmt-config-id': 'unassigned'
        },
        hierarchy: {
          surface: 'files',
          kind: 'workspace-group',
          entityId: 'unassigned',
          capabilities: []
        }
      }));
    }

    return nodes;
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

  function workspaceInvitePermissionMessage() {
    return 'You can manage workspace invites only if you own at least one board in this workspace.';
  }

  function rememberWorkspaceInviteAccess() {
    var next = {};
    for (var i = 0; i < cachedWorkspaces.length; i++) {
      var wsId = cachedWorkspaces[i] && cachedWorkspaces[i].id;
      if (!wsId) continue;
      if (workspaceInviteAccess[wsId]) next[wsId] = workspaceInviteAccess[wsId];
    }
    workspaceInviteAccess = next;
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
      activeTopTab: null,
      delegateHandler: null,
      delegateChangeHandler: null,
      keydownHandler: null
    };
    mountObj.activeTopTab = mountObj.uiOptions.defaultTopTab;
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
      workspaceInviteAccess = {};
      configSelectedItem = null;
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
    var ct = m.container && m.container.querySelector('#mgmt-config-tree');
    if (ct) {
      if (m.configTreeDragoverHandler) ct.removeEventListener('dragover', m.configTreeDragoverHandler);
      if (m.configTreeDragleaveHandler) ct.removeEventListener('dragleave', m.configTreeDragleaveHandler);
      if (m.configTreeDropHandler) ct.removeEventListener('drop', m.configTreeDropHandler);
    }
    m.configTreeDragoverHandler = null;
    m.configTreeDragleaveHandler = null;
    m.configTreeDropHandler = null;
  }

  function refresh(section) {
    if (!initialized) return;
    // Skip full refreshes that are self-echoes from our own mutations
    if (!section && Date.now() - lastMutationAt < SELF_ECHO_WINDOW_MS) return;
    if (section === 'boards') { loadMyBoards().then(function () { if (anyMountShowingTopTab('workspace-config')) renderConfigPanel(); }); return; }
    if (section === 'connections') { loadConnections(); return; }
    if (section === 'peers') { loadDiscoveredPeers(); return; }
    if (section === 'workspaces') { loadWorkspaces().then(function () { if (anyMountShowingTopTab('workspace-config')) renderConfigPanel(); }); return; }
    if (section === 'logs') { if (anyMountShowingTopTab('logs')) loadLogs(); return; }
    loadAllForMounts();
  }

  async function loadAllForMounts() {
    var needsNetwork = anyMountShowingTopTab('network');
    var needsWorkspaces = anyMountShowingTopTab('sharing') || anyMountShowingTopTab('workspaces');
    var needsBoards = anyMountShowingTopTab('sharing') || anyMountShowingTopTab('boards');
    var needsWsConfig = anyMountShowingTopTab('workspace-config');
    var needsLogs = anyMountShowingTopTab('logs');

    if (needsNetwork) await loadIdentity();
    var initialLoads = [];
    if (needsNetwork) { initialLoads.push(loadServerInfo()); initialLoads.push(loadNetworkInterfaces()); }
    if (needsWorkspaces || needsBoards || needsWsConfig) initialLoads.push(loadWorkspaces());
    if (needsLogs) initialLoads.push(loadLogs());
    await Promise.all(initialLoads);
    if (needsBoards || needsWsConfig) await loadMyBoards();
    if (needsNetwork) { await loadConnections(); await loadDiscoveredPeers(); }
    if (needsWsConfig) { await loadGlobalSync(); renderConfigPanel(); }
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
    html += '<button class="mgmt-btn mgmt-btn-small" data-mgmt-action="browse-board">Browse</button>';
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
    html += tabBtn('workspace-config', 'Workspaces');
    html += tabBtn('network', 'Network');
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

    // ── Workspace Config tab (two-panel layout) ──
    if (isTab('workspace-config')) {
      html += tabOpen('workspace-config');
      html += '<div class="mgmt-config-layout">';
      html += '<div class="mgmt-config-tree" id="mgmt-config-tree"></div>';
      html += '<div class="mgmt-config-inspector" id="mgmt-config-inspector">';
      html += '<div class="mgmt-list-empty">Select a workspace or board</div>';
      html += '</div>';
      html += '</div>';
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
    html += '<div class="mgmt-field-row" id="mgmt-custom-bind-row" hidden>';
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
    html += '<div class="mgmt-field-row" id="mgmt-custom-port-row" hidden>';
    html += '<label class="mgmt-field-label"></label>';
    html += '<input class="mgmt-field-input" type="number" id="mgmt-port-custom" min="1024" max="65535" placeholder="e.g. 8080">';
    html += '</div>';
    html += '<div class="mgmt-field-row mgmt-field-row--actions">';
    html += '<button class="mgmt-btn mgmt-btn-primary mgmt-btn-small" data-mgmt-action="save-server">Save</button>';
    html += '</div>';
    html += '<div id="mgmt-server-address" class="mgmt-info-text"></div>';
    html += '<div id="mgmt-server-restart-note" class="mgmt-restart-note" hidden></div>';
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
        mountObj.activeTopTab = tabName;
        var panel = mc.querySelector('[data-mgmt-top-panel="' + tabName + '"]');
        if (panel) panel.classList.add('active');
        loadAllForMounts();
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
        setElementHidden(customRow, bindSelect.value !== '__custom__');
        return;
      }

      var portSelect = e.target.closest('#mgmt-port-select');
      if (portSelect) {
        var customRow = mc.querySelector('#mgmt-custom-port-row');
        setElementHidden(customRow, portSelect.value !== '__custom__');
        return;
      }

      var logFilterSelect = e.target.closest('#mgmt-log-filter');
      if (logFilterSelect) {
        logFilter = logFilterSelect.value || 'all';
        renderLogs();
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

      // Config panel workspace assignment checkboxes
      var cfgWsCheckbox = e.target.closest('[data-mgmt-cfg-ws-toggle]');
      if (cfgWsCheckbox && cfgWsCheckbox.tagName === 'INPUT') {
        handleConfigWorkspaceAssignment(cfgWsCheckbox);
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
      else if (target.id && target.id.indexOf('mgmt-cfg-ws-name-') === 0) {
        var wsId = target.id.substring('mgmt-cfg-ws-name-'.length);
        if (wsId) configRenameWorkspace(wsId);
      }
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

    // Drag-and-drop .md files onto config tree workspace nodes
    var configTree = mc.querySelector('#mgmt-config-tree');
    if (configTree) {
      mountObj.configTreeDragoverHandler = function (e) {
        if (!e.dataTransfer || !e.dataTransfer.types) return;
        if (e.dataTransfer.types.indexOf('Files') === -1) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        var wsNode = e.target.closest('[data-mgmt-config-type="workspace"]');
        // Remove highlight from all nodes first
        var allNodes = configTree.querySelectorAll('.mgmt-config-tree-node');
        for (var n = 0; n < allNodes.length; n++) allNodes[n].classList.remove('mgmt-drop-active');
        if (wsNode) wsNode.classList.add('mgmt-drop-active');
      };
      mountObj.configTreeDragleaveHandler = function (e) {
        var wsNode = e.target.closest('[data-mgmt-config-type="workspace"]');
        if (wsNode && !wsNode.contains(e.relatedTarget)) {
          wsNode.classList.remove('mgmt-drop-active');
        }
        if (!configTree.contains(e.relatedTarget)) {
          var allNodes = configTree.querySelectorAll('.mgmt-config-tree-node');
          for (var n = 0; n < allNodes.length; n++) allNodes[n].classList.remove('mgmt-drop-active');
        }
      };
      mountObj.configTreeDropHandler = function (e) {
        var allNodes = configTree.querySelectorAll('.mgmt-config-tree-node');
        for (var n = 0; n < allNodes.length; n++) allNodes[n].classList.remove('mgmt-drop-active');
        var wsNode = e.target.closest('[data-mgmt-config-type="workspace"]');
        var targetWsId = wsNode ? wsNode.getAttribute('data-mgmt-config-id') : null;
        var paths = extractMdPathsFromDataTransfer(e.dataTransfer);
        if (paths.length === 0) return;
        e.preventDefault();
        configDropBoardsOnWorkspace(paths, targetWsId);
      };
      configTree.addEventListener('dragover', mountObj.configTreeDragoverHandler);
      configTree.addEventListener('dragleave', mountObj.configTreeDragleaveHandler);
      configTree.addEventListener('drop', mountObj.configTreeDropHandler);
    }
  }

  function handleAction(btn) {
    var action = btn.getAttribute('data-mgmt-action');
    var boardId = btn.getAttribute('data-mgmt-board');

    switch (action) {
      case 'add-workspace': addWorkspace(); break;
      case 'add-board': addBoard(); break;
      case 'browse-board': browseAndAddBoard(); break;
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
      case 'create-workspace-invite': createWorkspaceInvite(btn.getAttribute('data-mgmt-ws-id')); break;
      case 'revoke-workspace-invite': revokeWorkspaceInvite(btn.getAttribute('data-mgmt-ws-id'), btn.getAttribute('data-mgmt-token')); break;
      case 'save-board-sync': saveBoardSync(boardId); break;
      default:
        handleConfigAction(action, btn);
        break;
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
      setElementHidden(customRow, true);
    } else if (currentBind && !found) {
      select.value = '__custom__';
      var customInput = queryFirst('#mgmt-bind-custom');
      if (customInput) customInput.value = currentBind;
      setElementHidden(customRow, false);
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
      setElementHidden(customRow, false);
    } else {
      select.value = String(defaultPort);
      setElementHidden(customRow, true);
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
    if (restartNote) {
      restartNote.textContent = 'Applying...';
      setElementHidden(restartNote, false);
    }

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
        setTimeout(function () { setElementHidden(restartNote, true); }, 5000);
      }
      notify('Server config saved');
    } catch (e) {
      if (restartNote) {
        restartNote.textContent = 'Error: ' + (e.message || e);
        setTimeout(function () { setElementHidden(restartNote, true); }, 5000);
      }
      // Let host app handle reconnection
      if (callbacks && typeof callbacks.onServerRestarted === 'function') {
        callbacks.onServerRestarted(bindAddr, port);
      }
    }
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
    } catch (_) { /* intentional: invalid timestamp → empty string fallback */
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
    rememberWorkspaceInviteAccess();
    if (callbacks && typeof callbacks.onWorkspacesLoaded === 'function') {
      callbacks.onWorkspacesLoaded(cachedWorkspaces.slice(), cachedDefaultWorkspaceId);
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
      var inviteAccess = workspaceInviteAccess[ws.id] || 'unknown';
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
      html += '<label>Calendar Name</label>';
      html += '<input class="mgmt-field-input" type="text" id="mgmt-ws-calendar-name-' + esc(ws.id) + '" value="' + esc(ws.calendarName || '') + '" placeholder="Optional">';
      html += '</div>';
      html += '<div class="mgmt-settings-actions">';
      html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="save-workspace-sync" data-mgmt-ws-id="' + esc(ws.id) + '">Save Sync Defaults</button>';
      html += '</div>';
      html += '</div>';
      html += renderWorkspaceSectionHeader(ws.id, 'invites', 'Invitations');
      html += '<div class="mgmt-workspace-subsection' + (isWorkspaceSectionExpanded(ws.id, 'invites') ? ' is-expanded' : '') + '" data-mgmt-ws-section-panel="' + esc(ws.id) + ':invites">';
      if (inviteAccess !== 'forbidden') {
        html += '<div class="mgmt-invite-controls">';
        html += '<select class="mgmt-field-input mgmt-field-select-small" id="mgmt-ws-invite-role-' + esc(ws.id) + '">';
        html += '<option value="editor">Editor</option><option value="viewer">Viewer</option>';
        html += '</select>';
        html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="create-workspace-invite" data-mgmt-ws-id="' + esc(ws.id) + '">Invite</button>';
        html += '</div>';
      }
      html += '<div data-mgmt-ws-invites-list="' + esc(ws.id) + '"><span class="mgmt-list-empty">' + (
        inviteAccess === 'forbidden'
          ? workspaceInvitePermissionMessage()
          : (isWorkspaceSectionExpanded(ws.id, 'invites') ? 'Loading...' : 'Expand to load invites')
      ) + '</span></div>';
      html += '</div>';
      html += '</div>'; // end details fold
      html += '</div>';
    }
    el.innerHTML = html;
    // Only load invite data for expanded invitation sections.
    for (var wi = 0; wi < cachedWorkspaces.length; wi++) {
      if (
        isWorkspaceSectionExpanded(cachedWorkspaces[wi].id, 'invites') &&
        workspaceInviteAccess[cachedWorkspaces[wi].id] !== 'forbidden'
      ) {
        loadWorkspaceInvites(cachedWorkspaces[wi].id);
      }
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
    if (section === 'invites' && isWorkspaceSectionExpanded(wsId, section)) {
      loadWorkspaceInvites(wsId);
    }
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
    var nameInput = queryFirst('#mgmt-ws-calendar-name-' + wsId);

    var payload = {
      bookmarkSync: parseTriStateSelectValue(bookmarkSelect),
      calendarSync: parseTriStateSelectValue(calendarSelect),
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

  async function loadWorkspaceInvites(wsId) {
    if (!me) return;
    var el = queryFirst('[data-mgmt-ws-invites-list="' + wsId + '"]');
    if (!el) return;
    if (workspaceInviteAccess[wsId] === 'forbidden') {
      el.innerHTML = '<span class="mgmt-list-empty">' + workspaceInvitePermissionMessage() + '</span>';
      return;
    }
    try {
      var invites = await api.get('/collab/workspaces/' + wsId + '/invites', {
        suppressErrorStatuses: [403]
      });
      workspaceInviteAccess[wsId] = 'allowed';
      if (!invites || !invites.length) {
        el.innerHTML = '<span class="mgmt-list-empty">No active invites</span>';
        return;
      }
      el.innerHTML = renderInviteListHtml(invites, 'revoke-workspace-invite', 'data-mgmt-ws-id', wsId);
    } catch (e) {
      if (e && e.status === 403) {
        workspaceInviteAccess[wsId] = 'forbidden';
        renderWorkspaces();
        populateDefaultWorkspaceSelect();
        return;
      }
      el.innerHTML = '<span class="mgmt-list-empty">Failed to load invites</span>';
    }
  }

  async function createWorkspaceInvite(wsId) {
    if (!me) return;
    if (workspaceInviteAccess[wsId] === 'forbidden') {
      notify(workspaceInvitePermissionMessage());
      return;
    }
    var roleSelect = queryFirst('#mgmt-ws-invite-role-' + wsId);
    var role = roleSelect ? roleSelect.value : 'editor';
    try {
      await api.post('/collab/workspaces/' + wsId + '/invites', { role: role });
      workspaceInviteAccess[wsId] = 'allowed';
      await loadWorkspaceInvites(wsId);
      notify('Workspace invite created');
    } catch (e) {
      if (e && e.status === 403) {
        workspaceInviteAccess[wsId] = 'forbidden';
        renderWorkspaces();
        populateDefaultWorkspaceSelect();
        notify(workspaceInvitePermissionMessage());
        return;
      }
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
      if (e && e.status === 403) {
        workspaceInviteAccess[wsId] = 'forbidden';
        renderWorkspaces();
        populateDefaultWorkspaceSelect();
        notify(workspaceInvitePermissionMessage());
        return;
      }
      notify('Failed to revoke workspace invite: ' + (e.message || e));
    }
  }

  // ── My Boards ──

  async function loadMyBoards() {
    try {
      var data = await api.get('/boards');
      var boards = Array.isArray(data) ? data : (data.boards || []);
      cachedBoards = boards;
      var el = queryFirst('#mgmt-boards-list');
      if (el) renderMyBoards(el, boards);
    } catch (e) {
      var el = queryFirst('#mgmt-boards-list');
      if (el) el.innerHTML = '<div class="mgmt-list-empty">Failed to load boards</div>';
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

  async function browseAndAddBoard() {
    try {
      var invoke = getTauriInvoke();
      if (!invoke) {
        notify('Browse failed: Tauri file dialog bridge is unavailable in this window');
        return;
      }
      var paths = await invoke('browse_files', {
        title: 'Select board files',
        extensions: ['md'],
        multiple: true
      });
      if (!paths || paths.length === 0) return;
      for (var i = 0; i < paths.length; i++) {
        try {
          await api.post('/boards', { file: paths[i] });
        } catch (e) {
          notify('Failed to add board: ' + (e.message || e));
        }
      }
      await loadMyBoards();
      notify(paths.length + ' board(s) added');
      if (callbacks && typeof callbacks.onBoardAdded === 'function') callbacks.onBoardAdded();
    } catch (e) {
      notify('Browse failed: ' + (e.message || e));
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

  // ── Config Panel (two-panel workspace/board view) ──

  async function loadGlobalSync() {
    try {
      var data = await api.get('/config/global-sync');
      cachedGlobalSync = {
        bookmarkSync: data.bookmarkSync != null ? data.bookmarkSync : null,
        calendarSync: data.calendarSync != null ? data.calendarSync : null,
        calendarName: data.calendarName || null,
      };
    } catch (e) {
      cachedGlobalSync = { bookmarkSync: null, calendarSync: null, calendarName: null };
    }
  }

  function renderConfigPanel() {
    renderConfigTree();
    renderConfigInspector();
  }

  function renderLegacyConfigTree(el) {
    var html = '';

    // Global Settings node
    var isGlobalSelected = configSelectedItem && configSelectedItem.type === 'global';
    html += '<div class="mgmt-config-tree-node' + (isGlobalSelected ? ' selected' : '') + '"'
      + ' data-mgmt-action="config-select" data-mgmt-config-type="global" data-mgmt-config-id="global">';
    html += '<span class="mgmt-config-tree-toggle">\u2699</span>';
    html += '<span class="mgmt-config-tree-label">Global Settings</span>';
    html += '</div>';
    html += '<div class="mgmt-config-tree-divider"></div>';

    for (var i = 0; i < cachedWorkspaces.length; i++) {
      var ws = cachedWorkspaces[i];
      var isDefault = ws.id === cachedDefaultWorkspaceId;
      var isSelected = configSelectedItem && configSelectedItem.type === 'workspace' && configSelectedItem.id === ws.id;
      var wsBoards = cachedBoards.filter(function (b) {
        var wsIds = getBoardWorkspaceIds(b);
        return wsIds.indexOf(ws.id) >= 0;
      });

      html += '<div class="mgmt-config-tree-node' + (isSelected ? ' selected' : '') + '"'
        + ' data-mgmt-action="config-select" data-mgmt-config-type="workspace" data-mgmt-config-id="' + esc(ws.id) + '">';
      html += '<span class="mgmt-config-tree-toggle">\u25BC</span>';
      html += '<span class="mgmt-config-tree-label">' + esc(ws.name) + '</span>';
      html += '<span class="mgmt-config-tree-badge">' + wsBoards.length + '</span>';
      if (isDefault) html += '<span class="mgmt-config-tree-default" title="Default workspace">&#9733;</span>';
      html += '</div>';

      for (var j = 0; j < wsBoards.length; j++) {
        var b = wsBoards[j];
        var boardName = b.title || (b.filePath || b.file_path || b.id || '').split('/').pop().replace('.md', '') || 'Untitled';
        var isBoardSelected = configSelectedItem && configSelectedItem.type === 'board' && configSelectedItem.id === b.id;
        html += '<div class="mgmt-config-tree-node mgmt-config-tree-child' + (isBoardSelected ? ' selected' : '') + '"'
          + ' data-mgmt-action="config-select" data-mgmt-config-type="board" data-mgmt-config-id="' + esc(b.id) + '">';
        html += '<span class="mgmt-config-tree-label">' + esc(boardName) + '</span>';
        html += '</div>';
      }
    }

    // Unassigned boards (not in any workspace)
    var unassigned = cachedBoards.filter(function (b) {
      var wsIds = getBoardWorkspaceIds(b);
      for (var k = 0; k < wsIds.length; k++) {
        for (var m = 0; m < cachedWorkspaces.length; m++) {
          if (cachedWorkspaces[m].id === wsIds[k]) return false;
        }
      }
      return wsIds.length === 0 || true;
    });
    // Actually, filter boards whose workspace IDs don't match any existing workspace
    unassigned = cachedBoards.filter(function (b) {
      var wsIds = getBoardWorkspaceIds(b);
      if (wsIds.length === 0) return true;
      for (var k = 0; k < wsIds.length; k++) {
        for (var m = 0; m < cachedWorkspaces.length; m++) {
          if (cachedWorkspaces[m].id === wsIds[k]) return false;
        }
      }
      return true;
    });
    if (unassigned.length > 0) {
      html += '<div class="mgmt-config-tree-divider"></div>';
      html += '<div class="mgmt-config-tree-heading">Unassigned</div>';
      for (var u = 0; u < unassigned.length; u++) {
        var ub = unassigned[u];
        var ubName = ub.title || (ub.filePath || ub.file_path || ub.id || '').split('/').pop().replace('.md', '') || 'Untitled';
        var isUbSelected = configSelectedItem && configSelectedItem.type === 'board' && configSelectedItem.id === ub.id;
        html += '<div class="mgmt-config-tree-node mgmt-config-tree-child' + (isUbSelected ? ' selected' : '') + '"'
          + ' data-mgmt-action="config-select" data-mgmt-config-type="board" data-mgmt-config-id="' + esc(ub.id) + '">';
        html += '<span class="mgmt-config-tree-label">' + esc(ubName) + '</span>';
        html += '</div>';
      }
    }

    html += '<div class="mgmt-config-tree-add">';
    html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="config-add-workspace">+ Add Workspace</button>';
    html += '</div>';

    el.innerHTML = html;
  }

  function bindConfigTreeInteractions(el) {
    var controller = getManagementHierarchyControllerApi();
    var TreeView = getManagementTreeViewApi();
    if (!el || !controller || !TreeView || typeof controller.bindTreeInteractions !== 'function' || el.__mgmtConfigTreeBound) {
      return false;
    }

    controller.bindTreeInteractions(el, {
      TreeView: TreeView,
      onNodeActivate: function (node) {
        if (!node) return;
        var configType = node.getAttribute('data-mgmt-config-type');
        var configId = node.getAttribute('data-mgmt-config-id');
        if (configType !== 'global' && configType !== 'workspace' && configType !== 'board') return;
        configSelectedItem = { type: configType, id: configId };
        renderConfigPanel();
      }
    });

    el.__mgmtConfigTreeBound = true;
    return true;
  }

  function renderSharedConfigTree(el) {
    var TreeView = getManagementTreeViewApi();
    var controller = getManagementHierarchyControllerApi();
    if (!el || !TreeView || !controller || typeof TreeView.render !== 'function') return false;

    el.innerHTML = '';
    TreeView.render(el, buildConfigTreeNodes(), {
      escapeHtml: function (text) { return esc(text); },
      variant: 'compact'
    });
    bindConfigTreeInteractions(el);

    var addWrap = document.createElement('div');
    addWrap.className = 'mgmt-config-tree-add';
    addWrap.innerHTML = '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="config-add-workspace">+ Add Workspace</button>';
    el.appendChild(addWrap);
    return true;
  }

  function renderConfigTree() {
    var el = queryFirst('#mgmt-config-tree');
    if (!el) return;
    if (renderSharedConfigTree(el)) return;
    renderLegacyConfigTree(el);
  }

  function renderConfigInspector() {
    var el = queryFirst('#mgmt-config-inspector');
    if (!el) return;

    if (!configSelectedItem) {
      el.innerHTML = '<div class="mgmt-list-empty">Select a workspace or board</div>';
      return;
    }

    if (configSelectedItem.type === 'global') {
      renderConfigGlobalInspector(el);
    } else if (configSelectedItem.type === 'workspace') {
      renderConfigWorkspaceInspector(el, configSelectedItem.id);
    } else if (configSelectedItem.type === 'board') {
      renderConfigBoardInspector(el, configSelectedItem.id);
    }
  }

  function helpIcon(text) {
    return ' <span class="mgmt-help-icon" title="' + esc(text) + '">?</span>';
  }

  function renderConfigGlobalInspector(el) {
    var g = cachedGlobalSync;
    var html = '';
    html += '<div class="mgmt-section">';
    html += '<div class="mgmt-section-title">Global Sync Defaults</div>';
    html += '<p class="mgmt-copy">These defaults apply to all workspaces and boards unless overridden.</p>';
    html += '<div class="mgmt-sync-grid">';
    html += '<label>Bookmark Sync' + helpIcon('Enable WebDAV bookmark synchronization for all workspaces by default') + '</label>';
    html += renderTriStateSelectHtml('id="mgmt-cfg-global-bookmark-sync"', g.bookmarkSync);
    html += '<label>Calendar Sync' + helpIcon('Enable CalDAV calendar synchronization for all workspaces by default') + '</label>';
    html += renderTriStateSelectHtml('id="mgmt-cfg-global-calendar-sync"', g.calendarSync);
    html += '<label>Calendar Name' + helpIcon('Display name for the calendar. Leave empty for workspace name.') + '</label>';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-cfg-global-calendar-name" value="' + esc(g.calendarName || '') + '" placeholder="Optional">';
    html += '</div>';
    html += '<div class="mgmt-settings-actions">';
    html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="config-save-global-sync">Save</button>';
    html += '</div>';
    html += '</div>';

    el.innerHTML = html;
  }

  function renderConfigWorkspaceInspector(el, wsId) {
    var ws = null;
    for (var i = 0; i < cachedWorkspaces.length; i++) {
      if (cachedWorkspaces[i].id === wsId) { ws = cachedWorkspaces[i]; break; }
    }
    if (!ws) {
      el.innerHTML = '<div class="mgmt-list-empty">Workspace not found</div>';
      return;
    }
    var isDefault = ws.id === cachedDefaultWorkspaceId;
    var inviteAccess = workspaceInviteAccess[wsId] || 'unknown';

    var html = '';
    html += '<div class="mgmt-section">';
    html += '<div class="mgmt-section-title">Workspace</div>';
    html += '<div class="mgmt-field-row">';
    html += '<label class="mgmt-field-label">Name</label>';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-cfg-ws-name-' + esc(wsId) + '" value="' + esc(ws.name) + '">';
    html += '<button class="mgmt-btn mgmt-btn-small" data-mgmt-action="config-rename-workspace" data-mgmt-ws-id="' + esc(wsId) + '">Rename</button>';
    html += '</div>';
    html += '<div class="mgmt-field-row">';
    html += '<label class="mgmt-check-label"><input type="checkbox" id="mgmt-cfg-ws-default-' + esc(wsId) + '"' + (isDefault ? ' checked' : '') + ' data-mgmt-action="config-set-default-ws" data-mgmt-ws-id="' + esc(wsId) + '"> Default workspace</label>';
    html += '</div>';
    html += '</div>';

    // Sync settings
    html += '<div class="mgmt-section">';
    html += '<div class="mgmt-section-title">Sync Defaults</div>';
    html += '<div class="mgmt-sync-grid">';
    html += '<label>Bookmark Sync</label>';
    html += renderTriStateSelectHtml('id="mgmt-cfg-ws-bookmark-sync-' + esc(wsId) + '"', ws.bookmarkSync);
    html += '<label>Calendar Sync</label>';
    html += renderTriStateSelectHtml('id="mgmt-cfg-ws-calendar-sync-' + esc(wsId) + '"', ws.calendarSync);
    html += '<label>Calendar Name</label>';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-cfg-ws-calendar-name-' + esc(wsId) + '" value="' + esc(ws.calendarName || '') + '" placeholder="Optional">';
    html += '</div>';
    html += '<div class="mgmt-settings-actions">';
    html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="config-save-ws-sync" data-mgmt-ws-id="' + esc(wsId) + '">Save</button>';
    html += '</div>';
    html += '</div>';

    // Invitations
    html += '<div class="mgmt-section">';
    html += '<div class="mgmt-section-title">Invitations</div>';
    if (inviteAccess !== 'forbidden') {
      html += '<div class="mgmt-invite-controls">';
      html += '<select class="mgmt-field-input mgmt-field-select-small" id="mgmt-cfg-ws-invite-role-' + esc(wsId) + '">';
      html += '<option value="editor">Editor</option><option value="viewer">Viewer</option>';
      html += '</select>';
      html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="config-create-ws-invite" data-mgmt-ws-id="' + esc(wsId) + '">Invite</button>';
      html += '</div>';
    }
    html += '<div data-mgmt-cfg-ws-invites="' + esc(wsId) + '"><span class="mgmt-list-empty">'
      + (inviteAccess === 'forbidden' ? workspaceInvitePermissionMessage() : 'Loading...')
      + '</span></div>';
    html += '</div>';

    // Delete
    html += '<div class="mgmt-section">';
    html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-danger" data-mgmt-action="config-delete-workspace" data-mgmt-ws-id="' + esc(wsId) + '" data-mgmt-ws-name="' + esc(ws.name) + '">Delete Workspace</button>';
    html += '</div>';

    el.innerHTML = html;

    // Load invites
    if (inviteAccess !== 'forbidden') {
      loadConfigWorkspaceInvites(wsId);
    }
  }

  function renderConfigBoardInspector(el, boardId) {
    var board = null;
    for (var i = 0; i < cachedBoards.length; i++) {
      if (cachedBoards[i].id === boardId) { board = cachedBoards[i]; break; }
    }
    if (!board) {
      el.innerHTML = '<div class="mgmt-list-empty">Board not found</div>';
      return;
    }
    var boardName = board.title || (board.filePath || board.file_path || board.id || '').split('/').pop().replace('.md', '') || 'Untitled';
    var filePath = board.filePath || board.file_path || '';
    var boardWsIds = getBoardWorkspaceIds(board);

    var html = '';
    html += '<div class="mgmt-section">';
    html += '<div class="mgmt-section-title">Board</div>';
    html += '<div class="mgmt-field-row">';
    html += '<label class="mgmt-field-label">Title</label>';
    html += '<span class="mgmt-board-title">' + esc(boardName) + '</span>';
    html += '</div>';
    if (filePath) {
      html += '<div class="mgmt-field-row">';
      html += '<label class="mgmt-field-label">File</label>';
      html += '<span class="mgmt-board-path">' + esc(filePath) + '</span>';
      html += '</div>';
    }
    html += '</div>';

    // Workspace assignments
    if (cachedWorkspaces.length > 0) {
      html += '<div class="mgmt-section">';
      html += '<div class="mgmt-section-title">Workspace Assignment</div>';
      for (var wi = 0; wi < cachedWorkspaces.length; wi++) {
        var ws = cachedWorkspaces[wi];
        var checked = boardWsIds.indexOf(ws.id) >= 0;
        html += '<div class="mgmt-field-row">';
        html += '<label class="mgmt-check-label"><input type="checkbox"' + (checked ? ' checked' : '')
          + ' data-mgmt-cfg-ws-toggle="' + esc(ws.id) + '" data-mgmt-cfg-ws-board="' + esc(boardId) + '"> ' + esc(ws.name) + '</label>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Sync overrides
    html += '<div class="mgmt-section">';
    html += '<div class="mgmt-section-title">Sync Overrides</div>';
    html += '<div class="mgmt-sync-grid">';
    html += '<label>XBEL Name</label>';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-cfg-board-xbel-name-' + esc(boardId) + '" value="' + esc(board.xbelName || board.xbel_name || '') + '" placeholder="Optional">';
    html += '<label>Bookmark Sync</label>';
    html += renderTriStateSelectHtml('id="mgmt-cfg-board-bookmark-sync-' + esc(boardId) + '"', board.bookmarkSync != null ? board.bookmarkSync : board.bookmark_sync);
    html += '<label>Calendar Sync</label>';
    html += renderTriStateSelectHtml('id="mgmt-cfg-board-calendar-sync-' + esc(boardId) + '"', board.calendarSync != null ? board.calendarSync : board.calendar_sync);
    html += '<label>Calendar Name</label>';
    html += '<input class="mgmt-field-input" type="text" id="mgmt-cfg-board-calendar-name-' + esc(boardId) + '" value="' + esc(board.calendarName || board.calendar_name || '') + '" placeholder="Optional">';
    html += '</div>';
    html += '<div class="mgmt-settings-actions">';
    html += '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary" data-mgmt-action="config-save-board-sync" data-mgmt-board="' + esc(boardId) + '">Save</button>';
    html += '</div>';
    html += '</div>';

    el.innerHTML = html;
  }

  async function loadConfigWorkspaceInvites(wsId) {
    if (!me) return;
    var el = queryFirst('[data-mgmt-cfg-ws-invites="' + wsId + '"]');
    if (!el) return;
    if (workspaceInviteAccess[wsId] === 'forbidden') {
      el.innerHTML = '<span class="mgmt-list-empty">' + workspaceInvitePermissionMessage() + '</span>';
      return;
    }
    try {
      var invites = await api.get('/collab/workspaces/' + wsId + '/invites', { suppressErrorStatuses: [403] });
      workspaceInviteAccess[wsId] = 'allowed';
      if (!invites || !invites.length) {
        el.innerHTML = '<span class="mgmt-list-empty">No active invites</span>';
        return;
      }
      el.innerHTML = renderInviteListHtml(invites, 'config-revoke-ws-invite', 'data-mgmt-ws-id', wsId);
    } catch (e) {
      if (e && e.status === 403) {
        workspaceInviteAccess[wsId] = 'forbidden';
        renderConfigInspector();
        return;
      }
      el.innerHTML = '<span class="mgmt-list-empty">Failed to load invites</span>';
    }
  }

  function handleConfigAction(action, btn) {
    var wsId = btn.getAttribute('data-mgmt-ws-id');
    var boardId = btn.getAttribute('data-mgmt-board');
    var configType = btn.getAttribute('data-mgmt-config-type');
    var configId = btn.getAttribute('data-mgmt-config-id');

    switch (action) {
      case 'config-select':
        configSelectedItem = { type: configType, id: configId };
        renderConfigPanel();
        break;
      case 'config-add-workspace':
        configAddWorkspace();
        break;
      case 'config-rename-workspace':
        configRenameWorkspace(wsId);
        break;
      case 'config-set-default-ws':
        configSetDefaultWorkspace(wsId);
        break;
      case 'config-delete-workspace':
        configDeleteWorkspace(wsId, btn.getAttribute('data-mgmt-ws-name'));
        break;
      case 'config-save-ws-sync':
        configSaveWorkspaceSync(wsId);
        break;
      case 'config-create-ws-invite':
        configCreateWorkspaceInvite(wsId);
        break;
      case 'config-revoke-ws-invite':
        configRevokeWorkspaceInvite(wsId, btn.getAttribute('data-mgmt-token'));
        break;
      case 'config-save-board-sync':
        configSaveBoardSync(boardId);
        break;
      case 'config-save-global-sync':
        configSaveGlobalSync();
        break;
      default:
        return false;
    }
    return true;
  }

  async function configSaveGlobalSync() {
    var payload = {
      bookmarkSync: parseTriStateSelectValue(queryFirst('#mgmt-cfg-global-bookmark-sync')),
      calendarSync: parseTriStateSelectValue(queryFirst('#mgmt-cfg-global-calendar-sync')),
      calendarName: normalizeOptionalText((queryFirst('#mgmt-cfg-global-calendar-name') || {}).value),
    };
    try {
      await api.put('/config/global-sync', payload);
      await loadGlobalSync();
      renderConfigPanel();
      notify('Global sync defaults saved');
    } catch (e) {
      notify('Failed to save global sync defaults: ' + (e.message || e));
    }
  }

  async function configAddWorkspace() {
    var name = 'New Workspace';
    try {
      var result = await api.post('/config/workspaces', { name: name });
      await loadWorkspaces();
      await loadMyBoards();
      // Select the new workspace
      if (cachedWorkspaces.length > 0) {
        configSelectedItem = { type: 'workspace', id: cachedWorkspaces[cachedWorkspaces.length - 1].id };
      }
      renderConfigPanel();
      notify('Workspace created');
    } catch (e) {
      notify('Failed to create workspace: ' + (e.message || e));
    }
  }

  async function configRenameWorkspace(wsId) {
    var input = queryFirst('#mgmt-cfg-ws-name-' + wsId);
    if (!input) return;
    var name = input.value.trim();
    if (!name) return;
    try {
      await api.put('/config/workspaces/' + wsId, { name: name });
      await loadWorkspaces();
      renderConfigPanel();
      notify('Workspace renamed');
    } catch (e) {
      notify('Failed to rename workspace: ' + (e.message || e));
    }
  }

  async function configSetDefaultWorkspace(wsId) {
    var checkbox = queryFirst('#mgmt-cfg-ws-default-' + wsId);
    var newDefault = checkbox && checkbox.checked ? wsId : null;
    try {
      var result = await api.put('/config/default-workspace', { workspace_id: newDefault });
      cachedDefaultWorkspaceId = result && result.default_workspace ? result.default_workspace : newDefault;
      renderConfigPanel();
    } catch (e) {
      notify('Failed to set default workspace: ' + (e.message || e));
    }
  }

  async function configDeleteWorkspace(wsId, wsName) {
    confirm('Delete workspace "' + wsName + '"?\nBoards will be moved to the default workspace.', function () {
      api.delete('/config/workspaces/' + wsId).then(function () {
        if (configSelectedItem && configSelectedItem.type === 'workspace' && configSelectedItem.id === wsId) {
          configSelectedItem = null;
        }
        loadWorkspaces().then(function () {
          loadMyBoards().then(function () {
            renderConfigPanel();
          });
        });
        notify('Workspace deleted');
      }).catch(function (e) {
        notify('Failed to delete workspace: ' + (e.message || e));
      });
    });
  }

  async function configSaveWorkspaceSync(wsId) {
    var payload = {
      bookmarkSync: parseTriStateSelectValue(queryFirst('#mgmt-cfg-ws-bookmark-sync-' + wsId)),
      calendarSync: parseTriStateSelectValue(queryFirst('#mgmt-cfg-ws-calendar-sync-' + wsId)),
      calendarName: normalizeOptionalText((queryFirst('#mgmt-cfg-ws-calendar-name-' + wsId) || {}).value),
    };
    try {
      await api.put('/config/workspaces/' + wsId + '/sync', payload);
      await loadWorkspaces();
      renderConfigPanel();
      notify('Workspace sync defaults saved');
    } catch (e) {
      notify('Failed to save workspace sync defaults: ' + (e.message || e));
    }
  }

  async function configCreateWorkspaceInvite(wsId) {
    if (!me) return;
    if (workspaceInviteAccess[wsId] === 'forbidden') {
      notify(workspaceInvitePermissionMessage());
      return;
    }
    var roleSelect = queryFirst('#mgmt-cfg-ws-invite-role-' + wsId);
    var role = roleSelect ? roleSelect.value : 'editor';
    try {
      await api.post('/collab/workspaces/' + wsId + '/invites', { role: role });
      workspaceInviteAccess[wsId] = 'allowed';
      await loadConfigWorkspaceInvites(wsId);
      notify('Workspace invite created');
    } catch (e) {
      if (e && e.status === 403) {
        workspaceInviteAccess[wsId] = 'forbidden';
        renderConfigInspector();
        notify(workspaceInvitePermissionMessage());
        return;
      }
      notify('Failed to create workspace invite: ' + (e.message || e));
    }
  }

  async function configRevokeWorkspaceInvite(wsId, token) {
    if (!me) return;
    try {
      await api.delete('/collab/workspaces/' + wsId + '/invites/' + token);
      await loadConfigWorkspaceInvites(wsId);
      notify('Workspace invite revoked');
    } catch (e) {
      if (e && e.status === 403) {
        workspaceInviteAccess[wsId] = 'forbidden';
        renderConfigInspector();
        notify(workspaceInvitePermissionMessage());
        return;
      }
      notify('Failed to revoke workspace invite: ' + (e.message || e));
    }
  }

  async function configSaveBoardSync(boardId) {
    var payload = {
      xbelName: normalizeOptionalText((queryFirst('#mgmt-cfg-board-xbel-name-' + boardId) || {}).value),
      bookmarkSync: parseTriStateSelectValue(queryFirst('#mgmt-cfg-board-bookmark-sync-' + boardId)),
      calendarSync: parseTriStateSelectValue(queryFirst('#mgmt-cfg-board-calendar-sync-' + boardId)),
      calendarName: normalizeOptionalText((queryFirst('#mgmt-cfg-board-calendar-name-' + boardId) || {}).value),
    };
    try {
      await api.put('/config/boards/' + boardId + '/sync', payload);
      await loadMyBoards();
      renderConfigPanel();
      notify('Board sync overrides saved');
    } catch (e) {
      notify('Failed to save board sync overrides: ' + (e.message || e));
    }
  }

  async function configDropBoardsOnWorkspace(paths, targetWsId) {
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
      // If a workspace was targeted, assign the new boards to it
      if (targetWsId) {
        for (var j = 0; j < cachedBoards.length; j++) {
          var b = cachedBoards[j];
          var bPath = b.filePath || b.file_path || '';
          for (var k = 0; k < paths.length; k++) {
            if (bPath && bPath === paths[k]) {
              var currentWsIds = getBoardWorkspaceIds(b);
              if (currentWsIds.indexOf(targetWsId) < 0) {
                currentWsIds.push(targetWsId);
                try { await api.put('/config/boards/' + b.id + '/workspaces', { workspace_ids: currentWsIds }); } catch (e) { /* ignore */ }
              }
            }
          }
        }
        await loadMyBoards();
      }
      renderConfigPanel();
      notify(added + ' board' + (added > 1 ? 's' : '') + ' added');
      if (callbacks && typeof callbacks.onBoardAdded === 'function') callbacks.onBoardAdded();
    }
  }

  function handleConfigWorkspaceAssignment(checkbox) {
    var boardId = checkbox.getAttribute('data-mgmt-cfg-ws-board');
    var inspectorEl = queryFirst('#mgmt-config-inspector');
    if (!inspectorEl) return;
    var checkboxes = inspectorEl.querySelectorAll('input[data-mgmt-cfg-ws-toggle][data-mgmt-cfg-ws-board="' + boardId + '"]');
    var selectedIds = [];
    for (var i = 0; i < checkboxes.length; i++) {
      if (checkboxes[i].checked) selectedIds.push(checkboxes[i].getAttribute('data-mgmt-cfg-ws-toggle'));
    }
    if (selectedIds.length === 0) {
      checkbox.checked = true;
      notify('Board must belong to at least one workspace');
      return;
    }
    assignBoardWorkspaces(boardId, selectedIds).then(function () {
      renderConfigTree();
    });
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
    getSurfaceIdForSection: getSurfaceIdForSection,
    getTopTabForContext: getTopTabForContext,
    BOARD_SETTINGS_FIELDS: BOARD_SETTINGS_FIELDS,
  };
})();
