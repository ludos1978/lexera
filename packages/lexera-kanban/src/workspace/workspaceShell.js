(function () {
  function parseSearchParams() {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch (err) {
      return new URLSearchParams('');
    }
  }

  var urlParams = parseSearchParams();

  function normalizeViewKind(value) {
    var normalized = String(value == null ? '' : value).trim().toLowerCase();
    if (normalized === 'canvas') return 'canvas';
    if (normalized === 'kanban') return 'kanban';
    return 'default';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getDisplayNameFromPath(filePath) {
    var raw = String(filePath || '').trim();
    if (!raw) return '';
    var parts = raw.split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : raw;
  }

  function canUseTauriInvoke() {
    return !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');
  }

  function invokeTauri(command, payload) {
    if (!canUseTauriInvoke()) return Promise.reject(new Error('Tauri invoke unavailable'));
    return window.__TAURI__.core.invoke(command, payload || {});
  }

  function tauriEmitAll(eventName, payload) {
    // Tauri v2: emit event to all windows via IPC plugin
    var ipc = window.__TAURI_INTERNALS__ ||
              (window.__TAURI__ && window.__TAURI__.core) || null;
    if (ipc && typeof ipc.invoke === 'function') {
      return ipc.invoke('plugin:event|emit', {
        event: eventName,
        payload: payload
      });
    }
    return Promise.reject(new Error('Tauri event API unavailable'));
  }

  function closeCurrentWindow() {
    window.close();
  }

  function createIdFactory() {
    var counter = 1;
    return function (prefix) {
      counter += 1;
      return prefix + '-' + Date.now().toString(36) + '-' + counter.toString(36);
    };
  }

  function getBody() {
    return document.body;
  }

  function isEnabled() {
    return urlParams.get('embedded') !== '1' && urlParams.get('workspaceShell') !== '0';
  }

  var nextId = createIdFactory();

  function createBoardTab(boardId, viewKind) {
    return {
      id: nextId('tab'),
      kind: 'board',
      boardId: boardId || '',
      viewKind: normalizeViewKind(viewKind)
    };
  }

  function createPanelTab(panelId) {
    return {
      id: nextId('tab'),
      kind: 'panel',
      panelId: String(panelId || '')
    };
  }

  function isPanelTab(tab) {
    return !!(tab && tab.kind === 'panel');
  }

  function isBoardTab(tab) {
    return !!tab && !isPanelTab(tab);
  }

  var PANEL_DEFINITIONS = {
    hierarchy: { id: 'hierarchy', title: 'Workspaces', defaultDock: 'left', duplicable: true, integratedHeader: true },
    dashboard: { id: 'dashboard', title: 'Dashboard', defaultDock: 'right', duplicable: true, integratedHeader: true },
    logs: { id: 'logs', title: 'Logs', defaultDock: 'bottom', duplicable: true, integratedHeader: true },
    backendSettings: { id: 'backendSettings', title: 'Backend Settings', defaultDock: 'right', duplicable: true, integratedHeader: true },
    frontendSettings: { id: 'frontendSettings', title: 'Frontend Settings', defaultDock: 'right', duplicable: true, integratedHeader: true },
    renderApps: { id: 'renderApps', title: 'Render Applications', defaultDock: 'right', duplicable: true, integratedHeader: true },
    files: { id: 'files', title: 'Files', defaultDock: 'right', duplicable: true, integratedHeader: true }
  };

  function createDefaultPanelInstances() {
    return {
      hierarchy: { id: 'hierarchy', kind: 'hierarchy' },
      dashboard: { id: 'dashboard', kind: 'dashboard' },
      logs: { id: 'logs', kind: 'logs' },
      backendSettings: { id: 'backendSettings', kind: 'backendSettings' },
      frontendSettings: { id: 'frontendSettings', kind: 'frontendSettings' },
      renderApps: { id: 'renderApps', kind: 'renderApps' },
      files: { id: 'files', kind: 'files' }
    };
  }

  function createDefaultDockSizes(profile) {
    if (profile === 'detachedBoard') {
      return {
        left: 0,
        right: 0,
        bottom: 0
      };
    }
    return {
      left: 272,
      right: 0,
      bottom: 0
    };
  }

  function createDefaultDockRestoreSizes(profile) {
    return createDefaultDockSizes(profile === 'detachedBoard' ? 'workspace' : profile);
  }

  function clampPanelSize(dockId, value) {
    var number = typeof value === 'number' && isFinite(value) ? value : null;
    if (number == null) return createDefaultDockSizes()[dockId];
    if (dockId === 'bottom') return Math.max(140, Math.min(480, Math.round(number)));
    return Math.max(200, Math.min(520, Math.round(number)));
  }

  function normalizeDockSizes(raw, profile) {
    var defaults = createDefaultDockSizes(profile);
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      left: normalizeDockSizeValue('left', source.left != null ? source.left : defaults.left),
      right: normalizeDockSizeValue('right', source.right != null ? source.right : defaults.right),
      bottom: normalizeDockSizeValue('bottom', source.bottom != null ? source.bottom : defaults.bottom)
    };
  }

  function normalizeDockRestoreSizes(raw, profile) {
    var defaults = createDefaultDockRestoreSizes(profile);
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      left: clampPanelSize('left', source.left != null ? source.left : defaults.left) || defaults.left,
      right: clampPanelSize('right', source.right != null ? source.right : defaults.right) || defaults.right,
      bottom: clampPanelSize('bottom', source.bottom != null ? source.bottom : defaults.bottom) || defaults.bottom
    };
  }

  function normalizePanelKind(value) {
    return PANEL_DEFINITIONS[value] ? value : '';
  }

  function normalizePanelInstances(raw) {
    var defaults = createDefaultPanelInstances();
    var source = raw && typeof raw === 'object' ? raw : {};
    var result = {};
    var defaultIds = Object.keys(defaults);
    for (var i = 0; i < defaultIds.length; i++) {
      result[defaultIds[i]] = defaults[defaultIds[i]];
    }
    var instanceIds = Object.keys(source);
    for (var j = 0; j < instanceIds.length; j++) {
      var panelId = String(instanceIds[j] || '');
      if (!panelId) continue;
      var entry = source[panelId];
      var kind = normalizePanelKind(entry && entry.kind ? entry.kind : panelId);
      if (!kind) continue;
      if (panelId !== kind && !PANEL_DEFINITIONS[kind].duplicable) continue;
      result[panelId] = { id: panelId, kind: kind };
    }
    return result;
  }

  function normalizePanelIdWithInstances(value, panelInstances) {
    var normalized = String(value || '');
    if (panelInstances && panelInstances[normalized]) return normalized;
    return normalizePanelKind(normalized);
  }

  function createDefaultPanelVisibility(profile) {
    return {
      hierarchy: true,
      dashboard: true,
      logs: true,
      backendSettings: false,
      frontendSettings: false,
      renderApps: false,
      files: false
    };
  }

  function getPanelTitle(panelId) {
    var kind = getPanelKind(panelId);
    var definition = PANEL_DEFINITIONS[kind];
    if (!definition) return 'Panel';
    if (panelId === kind) return definition.title;
    var peers = getPanelInstanceIdsByKind(kind);
    var index = peers.indexOf(panelId);
    return index > 0 ? (definition.title + ' ' + (index + 1)) : definition.title;
  }

  function ensureUniquePanelIds(ids, seen, panelInstances) {
    var result = [];
    var localSeen = seen || {};
    var list = Array.isArray(ids) ? ids : [];
    for (var i = 0; i < list.length; i++) {
      var panelId = normalizePanelIdWithInstances(list[i], panelInstances);
      if (!panelId || localSeen[panelId]) continue;
      localSeen[panelId] = true;
      result.push(panelId);
    }
    return result;
  }

  function normalizePanelDocks(raw, profile, panelInstances) {
    var defaults = { left: [['hierarchy', 'dashboard']], right: [], bottom: [['logs']] };
    var result = { left: [], right: [], bottom: [] };
    var seen = {};
    var dockOrder = ['left', 'right', 'bottom'];
    for (var i = 0; i < dockOrder.length; i++) {
      var dockId = dockOrder[i];
      var source = raw ? raw[dockId] : null;
      var groups = [];
      if (Array.isArray(source) && source.length > 0) {
        // Detect format: grouped (array of arrays) vs flat (array of strings)
        var isGrouped = Array.isArray(source[0]);
        if (isGrouped) {
          for (var g = 0; g < source.length; g++) {
            var groupIds = ensureUniquePanelIds(source[g], seen, panelInstances);
            if (groupIds.length > 0) groups.push(groupIds);
          }
        } else {
          // Legacy flat format: each panel becomes its own group
          var flatIds = ensureUniquePanelIds(source, seen, panelInstances);
          for (var f = 0; f < flatIds.length; f++) {
            groups.push([flatIds[f]]);
          }
        }
      }
      if (groups.length === 0) {
        // Use defaults (already grouped format)
        for (var d = 0; d < defaults[dockId].length; d++) {
          var defGroup = defaults[dockId][d];
          var defIds = ensureUniquePanelIds(
            Array.isArray(defGroup) ? defGroup : [defGroup], seen, panelInstances
          );
          if (defIds.length > 0) groups.push(defIds);
        }
      }
      result[dockId] = groups;
    }
    return result;
  }

  function normalizePanelVisibility(raw, profile, panelInstances) {
    var defaults = createDefaultPanelVisibility(profile);
    var result = {};
    var source = raw && typeof raw === 'object' ? raw : {};
    var panelIds = Object.keys(panelInstances || {});
    for (var i = 0; i < panelIds.length; i++) {
      var panelId = panelIds[i];
      var kind = panelInstances[panelId] ? panelInstances[panelId].kind : panelId;
      var fallback = Object.prototype.hasOwnProperty.call(defaults, panelId)
        ? !!defaults[panelId]
        : (panelId === kind ? !!defaults[kind] : true);
      result[panelId] = typeof source[panelId] === 'boolean' ? source[panelId] : fallback;
    }
    return result;
  }

  function normalizeDockSizeValue(dockId, value) {
    var number = typeof value === 'number' && isFinite(value) ? value : null;
    if (number == null) return 0;
    if (number <= 0) return 0;
    return clampPanelSize(dockId, number);
  }

  function createTabsetNode(tabs) {
    var list = Array.isArray(tabs) ? tabs.slice() : [];
    return {
      type: 'tabs',
      id: nextId('pane'),
      tabs: list,
      activeTabId: list.length > 0 ? list[0].id : ''
    };
  }

  function createSplitNode(axis, first, second, ratio) {
    return {
      type: 'split',
      id: nextId('split'),
      axis: axis === 'horizontal' ? 'horizontal' : 'vertical',
      ratio: typeof ratio === 'number' && isFinite(ratio) ? Math.max(0.18, Math.min(0.82, ratio)) : 0.5,
      first: first,
      second: second
    };
  }

  function createDefaultSideDocks(profile) {
    if (profile === 'detachedBoard') return { left: null, right: null, bottom: null };
    return {
      left: createSplitNode('horizontal',
        createTabsetNode([createPanelTab('hierarchy')]),
        createTabsetNode([createPanelTab('dashboard')]),
        0.6
      ),
      right: null,
      bottom: createTabsetNode([createPanelTab('logs')])
    };
  }

  function getTreeRoot(treeId) {
    if (treeId === 'center') return state.dockTree;
    return state.sideDocks ? state.sideDocks[treeId] || null : null;
  }

  function setTreeRoot(treeId, root) {
    if (treeId === 'center') { state.dockTree = root; return; }
    if (state.sideDocks) state.sideDocks[treeId] = root;
  }

  function allTreeIds() { return ['center', 'left', 'right', 'bottom']; }

  function normalizeAllTrees() {
    var ids = allTreeIds();
    for (var i = 0; i < ids.length; i++) {
      var root = getTreeRoot(ids[i]);
      if (!root) continue;
      setTreeRoot(ids[i], withNormalizedLeaves(root, ids[i] === 'center'));
    }
  }

  function findLeafInAllTrees(leafId) {
    var ids = allTreeIds();
    for (var i = 0; i < ids.length; i++) {
      var root = getTreeRoot(ids[i]);
      if (!root) continue;
      var leaf = findLeafById(root, leafId);
      if (leaf) return { treeId: ids[i], leaf: leaf };
    }
    return null;
  }

  function findTabInAllTrees(tabId) {
    var ids = allTreeIds();
    for (var i = 0; i < ids.length; i++) {
      var root = getTreeRoot(ids[i]);
      if (!root) continue;
      var found = findTab(root, tabId);
      if (found) return { treeId: ids[i], tab: found.tab, leaf: found.leaf, index: found.index };
    }
    return null;
  }

  function findPanelInAllTrees(panelId) {
    var ids = allTreeIds();
    for (var i = 0; i < ids.length; i++) {
      var root = getTreeRoot(ids[i]);
      if (!root) continue;
      var found = findLeafContainingPanel(root, panelId);
      if (found) return { treeId: ids[i], tab: found.tab, leaf: found.leaf };
    }
    return null;
  }

  function countTreeTabs(tree) {
    var count = 0;
    visitTree(tree, function(node) {
      if (node.type === 'tabs') count += node.tabs.length;
    });
    return count;
  }

  function migratePanelDocksToSideDocks(panelDocks, panelGroupActives) {
    var result = { left: null, right: null, bottom: null };
    var dockIds = ['left', 'right', 'bottom'];
    for (var d = 0; d < dockIds.length; d++) {
      var dockId = dockIds[d];
      var groups = panelDocks[dockId];
      if (!Array.isArray(groups) || groups.length === 0) continue;
      var tabsetNodes = [];
      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        if (!Array.isArray(group) || group.length === 0) continue;
        var tabs = [];
        for (var p = 0; p < group.length; p++) {
          tabs.push(createPanelTab(group[p]));
        }
        if (tabs.length === 0) continue;
        var node = createTabsetNode(tabs);
        var groupKey = group.join(',');
        var activePanel = panelGroupActives && panelGroupActives[groupKey];
        if (activePanel) {
          for (var k = 0; k < node.tabs.length; k++) {
            if (node.tabs[k].panelId === activePanel) {
              node.activeTabId = node.tabs[k].id;
              break;
            }
          }
        }
        tabsetNodes.push(node);
      }
      if (tabsetNodes.length === 0) continue;
      if (tabsetNodes.length === 1) {
        result[dockId] = tabsetNodes[0];
      } else {
        var axis = dockId === 'bottom' ? 'horizontal' : 'vertical';
        var tree = tabsetNodes[0];
        for (var n = 1; n < tabsetNodes.length; n++) {
          tree = createSplitNode(axis, tree, tabsetNodes[n], 0.5);
        }
        result[dockId] = tree;
      }
    }
    return result;
  }

  function getFirstLeaf(node) {
    if (!node) return null;
    if (node.type === 'tabs') return node;
    return getFirstLeaf(node.first) || getFirstLeaf(node.second);
  }

  function visitTree(node, visitor, parent, side) {
    if (!node) return;
    visitor(node, parent || null, side || '');
    if (node.type === 'split') {
      visitTree(node.first, visitor, node, 'first');
      visitTree(node.second, visitor, node, 'second');
    }
  }

  function findLeafById(node, leafId) {
    var found = null;
    visitTree(node, function (candidate) {
      if (!found && candidate.type === 'tabs' && candidate.id === leafId) found = candidate;
    });
    return found;
  }

  function findNodeAndParent(node, nodeId) {
    var found = null;
    visitTree(node, function (candidate, parent, side) {
      if (!found && candidate.id === nodeId) {
        found = { node: candidate, parent: parent || null, side: side || '' };
      }
    });
    return found;
  }

  function findTab(node, tabId) {
    var found = null;
    visitTree(node, function (candidate) {
      if (found || candidate.type !== 'tabs') return;
      for (var i = 0; i < candidate.tabs.length; i++) {
        if (candidate.tabs[i].id === tabId) {
          found = {
            tab: candidate.tabs[i],
            leaf: candidate,
            index: i
          };
          return;
        }
      }
    });
    return found;
  }

  function findLeafContainingBoard(node, boardId, viewKind) {
    var desiredView = normalizeViewKind(viewKind);
    var found = null;
    visitTree(node, function (candidate) {
      if (found || candidate.type !== 'tabs') return;
      for (var i = 0; i < candidate.tabs.length; i++) {
        var tab = candidate.tabs[i];
        if (!isBoardTab(tab)) continue;
        if (tab.boardId === boardId && tab.viewKind === desiredView) {
          found = {
            tab: tab,
            leaf: candidate
          };
          return;
        }
      }
    });
    return found;
  }

  function findLeafContainingPanel(node, panelId) {
    var normalizedPanelId = resolvePanelTarget(panelId);
    if (!normalizedPanelId) return null;
    var found = null;
    visitTree(node, function (candidate) {
      if (found || candidate.type !== 'tabs') return;
      for (var i = 0; i < candidate.tabs.length; i++) {
        var tab = candidate.tabs[i];
        if (!isPanelTab(tab)) continue;
        if (resolvePanelTarget(tab.panelId) === normalizedPanelId) {
          found = {
            tab: tab,
            leaf: candidate
          };
          return;
        }
      }
    });
    return found;
  }

  function findClosestSplitParent(node, targetLeafId, parentSplit) {
    if (!node) return null;
    if (node.type === 'tabs') return node.id === targetLeafId ? parentSplit : null;
    return findClosestSplitParent(node.first, targetLeafId, node) || findClosestSplitParent(node.second, targetLeafId, node);
  }

  function getBoardMetaLabel(meta) {
    if (!meta) return 'Untitled';
    var title = String(meta.title || '').trim();
    var fileName = getDisplayNameFromPath(meta.filePath || '');
    if (title && fileName && title !== fileName) return title + ' (' + fileName + ')';
    return title || fileName || meta.id || 'Untitled';
  }

  function getEmbeddedUrlForTab(tab) {
    if (!isBoardTab(tab)) return '';
    var url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('embedded', '1');
    url.searchParams.set('workspaceShell', '0');
    url.searchParams.set('workspaceShellParent', '1');
    url.searchParams.set('pane', tab.id);
    if (tab.boardId) url.searchParams.set('board', tab.boardId);
    if (tab.viewKind === 'kanban' || tab.viewKind === 'canvas') {
      url.searchParams.set('view', tab.viewKind);
    }
    return url.toString();
  }

  function withNormalizedLeaves(node, isRoot) {
    if (!node) return isRoot ? createTabsetNode([]) : null;
    if (node.type === 'tabs') {
      if (!Array.isArray(node.tabs)) node.tabs = [];
      if (node.tabs.length === 0) {
        node.activeTabId = '';
        return isRoot ? node : null;
      }
      var hasActive = false;
      for (var i = 0; i < node.tabs.length; i++) {
        if (node.tabs[i].id === node.activeTabId) {
          hasActive = true;
          break;
        }
      }
      if (!hasActive) node.activeTabId = node.tabs[0].id;
      return node;
    }
    node.first = withNormalizedLeaves(node.first, false);
    node.second = withNormalizedLeaves(node.second, false);
    if (!node.first && !node.second) return isRoot ? createTabsetNode([]) : null;
    if (!node.first) return node.second;
    if (!node.second) return node.first;
    return node;
  }

  var state = {
    enabled: isEnabled(),
    mounted: false,
    profile: urlParams.get('profile') === 'detachedBoard' ? 'detachedBoard' : 'workspace',
    panelOnlyKind: normalizePanelKind(urlParams.get('panelKind') || ''),
    panelOnlyId: '',
    initialPanelKind: normalizePanelKind(urlParams.get('initialPanel') || ''),
    windowRole: String(urlParams.get('windowRole') || ''),
    windowLabel: String(urlParams.get('windowLabel') || 'main'),
    dockTree: createTabsetNode([]),
    panelInstances: createDefaultPanelInstances(),
    sideDocks: createDefaultSideDocks(urlParams.get('profile') === 'detachedBoard' ? 'detachedBoard' : 'workspace'),
    dockSizes: createDefaultDockSizes(urlParams.get('profile') === 'detachedBoard' ? 'detachedBoard' : 'workspace'),
    dockRestoreSizes: createDefaultDockRestoreSizes(urlParams.get('profile') === 'detachedBoard' ? 'detachedBoard' : 'workspace'),
    panelVisibility: createDefaultPanelVisibility(urlParams.get('profile') === 'detachedBoard' ? 'detachedBoard' : 'workspace'),
    activePanelId: urlParams.get('profile') === 'detachedBoard' ? '' : 'hierarchy',
    activeLeafId: '',
    lastNotifiedBoardId: '',
    boardsById: {},
    frameCache: {},
    hooks: {},
    rootEl: null,
    toolbarEl: null,
    bodyEl: null,
    mainRowEl: null,
    leftDockEl: null,
    leftDividerEl: null,
    dockEl: null,
    rightDividerEl: null,
    rightDockEl: null,
    bottomDividerEl: null,
    bottomDockEl: null,
    panelDropOverlayEl: null,
    lastStructureSignature: '',
    foldedPanes: {},
    backendConnected: false,
    panelElements: null,
    dragTabId: '',
    dragDroppedInternally: false,
    dragHoverLeafId: '',
    dragHoverZone: '',
    dragHoverDock: '',
    dragHoverTabIndex: -1,
    dragPanelId: '',
    pointerDrag: null,
    dragLastX: 0,
    dragLastY: 0
  };

  function getSharedPanelsApi() {
    return window.LexeraSharedPanels || null;
  }

  function getPanelKind(panelId) {
    var normalized = String(panelId || '');
    if (state.panelInstances && state.panelInstances[normalized]) {
      return state.panelInstances[normalized].kind;
    }
    return normalizePanelKind(normalized);
  }

  function getPrimaryPanelId(kind) {
    var normalizedKind = normalizePanelKind(kind);
    if (!normalizedKind) return '';
    if (state.panelInstances[normalizedKind]) return normalizedKind;
    var panelIds = Object.keys(state.panelInstances || {});
    for (var i = 0; i < panelIds.length; i++) {
      if (state.panelInstances[panelIds[i]].kind === normalizedKind) return panelIds[i];
    }
    return '';
  }

  function resolvePanelTarget(value) {
    var normalized = String(value || '');
    if (state.panelInstances[normalized]) return normalized;
    var kind = normalizePanelKind(normalized);
    if (!kind) return '';
    return getPrimaryPanelId(kind);
  }

  function getPanelInstanceIdsByKind(kind) {
    var normalizedKind = normalizePanelKind(kind);
    if (!normalizedKind) return [];
    return Object.keys(state.panelInstances || {}).filter(function (panelId) {
      return state.panelInstances[panelId] && state.panelInstances[panelId].kind === normalizedKind;
    }).sort(function (a, b) {
      if (a === normalizedKind) return -1;
      if (b === normalizedKind) return 1;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
  }

  function isPanelKindDuplicable(kind) {
    var normalizedKind = normalizePanelKind(kind);
    return !!(normalizedKind && PANEL_DEFINITIONS[normalizedKind] && PANEL_DEFINITIONS[normalizedKind].duplicable);
  }

  function isPanelOnlyWindow() {
    return !!state.panelOnlyKind;
  }

  function isHierarchyLauncherWindow() {
    return state.windowRole === 'hierarchyLauncher' || (isPanelOnlyWindow() && state.panelOnlyKind === 'hierarchy');
  }

  function createPanelInstance(kind, panelId) {
    var normalizedKind = normalizePanelKind(kind);
    if (!normalizedKind) return '';
    var nextPanelId = String(panelId || nextId(normalizedKind + '-panel'));
    state.panelInstances[nextPanelId] = { id: nextPanelId, kind: normalizedKind };
    return nextPanelId;
  }

  function applyPanelOnlyWindowState() {
    if (!isPanelOnlyWindow()) return;
    state.panelOnlyId = getPrimaryPanelId(state.panelOnlyKind) || createPanelInstance(state.panelOnlyKind, state.panelOnlyKind);
    var panelIds = Object.keys(state.panelInstances || {});
    for (var i = 0; i < panelIds.length; i++) {
      state.panelVisibility[panelIds[i]] = panelIds[i] === state.panelOnlyId;
    }
    state.sideDocks = { left: null, right: null, bottom: null };
    state.dockSizes.left = 0;
    state.dockSizes.right = 0;
    state.dockSizes.bottom = 0;
    state.activePanelId = state.panelOnlyId;
  }

  function ensureInitialPanelTab(panelKind) {
    var normalizedKind = normalizePanelKind(panelKind);
    if (!normalizedKind || isPanelOnlyWindow()) return false;
    var leaf = getFirstLeaf(state.dockTree);
    if (leaf && leaf.tabs && leaf.tabs.length > 0) return false;
    var panelId = getPrimaryPanelId(normalizedKind) || createPanelInstance(normalizedKind, normalizedKind);
    var targetLeaf = leaf || state.dockTree;
    if (!targetLeaf || targetLeaf.type !== 'tabs') {
      state.dockTree = createTabsetNode([]);
      targetLeaf = state.dockTree;
    }
    state.panelVisibility[panelId] = true;
    removePanelFromDocks(panelId);
    var tab = createPanelTab(panelId);
    targetLeaf.tabs.push(tab);
    targetLeaf.activeTabId = tab.id;
    state.activeLeafId = targetLeaf.id;
    state.activePanelId = panelId;
    state.dockTree = withNormalizedLeaves(state.dockTree, true);
    return true;
  }

  function getPersistenceStorage() {
    if (state.windowLabel === 'main') return window.localStorage;
    return window.sessionStorage;
  }

  function getPersistenceKey() {
    return 'lexera-workspace-shell:' + state.windowLabel;
  }

  function serializeNode(node) {
    if (!node) return null;
    if (node.type === 'tabs') {
      return {
        type: 'tabs',
        id: node.id,
        activeTabId: node.activeTabId || '',
        tabs: (node.tabs || []).map(function (tab) {
          if (isPanelTab(tab)) {
            return {
              id: tab.id,
              kind: 'panel',
              panelId: resolvePanelTarget(tab.panelId)
            };
          }
          return {
            id: tab.id,
            kind: 'board',
            boardId: tab.boardId || '',
            viewKind: normalizeViewKind(tab.viewKind)
          };
        })
      };
    }
    return {
      type: 'split',
      id: node.id,
      axis: node.axis === 'horizontal' ? 'horizontal' : 'vertical',
      ratio: typeof node.ratio === 'number' && isFinite(node.ratio) ? Math.max(0.18, Math.min(0.82, node.ratio)) : 0.5,
      first: serializeNode(node.first),
      second: serializeNode(node.second)
    };
  }

  function hydrateNode(raw, panelInstances) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.type === 'tabs') {
      var tabs = [];
      var rawTabs = Array.isArray(raw.tabs) ? raw.tabs : [];
      for (var i = 0; i < rawTabs.length; i++) {
        var rawTab = rawTabs[i];
        if (!rawTab || typeof rawTab !== 'object') continue;
        if (rawTab.kind === 'panel') {
          var panelId = normalizePanelIdWithInstances(rawTab.panelId, panelInstances || state.panelInstances);
          if (!panelId) continue;
          tabs.push({
            id: String(rawTab.id || nextId('tab')),
            kind: 'panel',
            panelId: panelId
          });
          continue;
        }
        if (typeof rawTab.boardId !== 'string' || !rawTab.boardId) continue;
        tabs.push({
          id: String(rawTab.id || nextId('tab')),
          kind: 'board',
          boardId: rawTab.boardId,
          viewKind: normalizeViewKind(rawTab.viewKind)
        });
      }
      return {
        type: 'tabs',
        id: String(raw.id || nextId('pane')),
        tabs: tabs,
        activeTabId: String(raw.activeTabId || '')
      };
    }
    if (raw.type !== 'split') return null;
    return {
      type: 'split',
      id: String(raw.id || nextId('split')),
      axis: raw.axis === 'horizontal' ? 'horizontal' : 'vertical',
      ratio: typeof raw.ratio === 'number' && isFinite(raw.ratio) ? Math.max(0.18, Math.min(0.82, raw.ratio)) : 0.5,
      first: hydrateNode(raw.first, panelInstances),
      second: hydrateNode(raw.second, panelInstances)
    };
  }

  function persistState() {
    if (!state.mounted) return;
    try {
      var storage = getPersistenceStorage();
      storage.setItem(getPersistenceKey(), JSON.stringify({
        version: 4,
        profile: state.profile,
        panelInstances: state.panelInstances,
        sideDocks: {
          left: serializeNode(state.sideDocks.left),
          right: serializeNode(state.sideDocks.right),
          bottom: serializeNode(state.sideDocks.bottom)
        },
        dockSizes: state.dockSizes,
        dockRestoreSizes: state.dockRestoreSizes,
        panelVisibility: state.panelVisibility,
        activePanelId: state.activePanelId || '',
        activeLeafId: state.activeLeafId || '',
        dockTree: serializeNode(state.dockTree),
        foldedPanes: state.foldedPanes
      }));
    } catch (_) {
      // ignore persistence failures
    }
  }

  function restoreState() {
    try {
      var raw = getPersistenceStorage().getItem(getPersistenceKey());
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (!parsed || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4)) return false;
      if (parsed.profile && parsed.profile !== state.profile) return false;
      state.panelInstances = normalizePanelInstances(parsed.panelInstances);
      state.dockTree = hydrateNode(parsed.dockTree, state.panelInstances) || createTabsetNode([]);
      state.dockTree = withNormalizedLeaves(state.dockTree, true);
      // Hydrate sideDocks: version 4 stores sideDocks trees; older versions store panelDocks groups
      if (parsed.version === 4 && parsed.sideDocks && typeof parsed.sideDocks === 'object') {
        state.sideDocks = {
          left: hydrateNode(parsed.sideDocks.left, state.panelInstances),
          right: hydrateNode(parsed.sideDocks.right, state.panelInstances),
          bottom: hydrateNode(parsed.sideDocks.bottom, state.panelInstances)
        };
      } else if (parsed.panelDocks) {
        var normalizedOldDocks = normalizePanelDocks(parsed.panelDocks, state.profile, state.panelInstances);
        state.sideDocks = migratePanelDocksToSideDocks(normalizedOldDocks, parsed.panelGroupActives);
      } else {
        state.sideDocks = createDefaultSideDocks(state.profile);
      }
      state.dockSizes = normalizeDockSizes(parsed.dockSizes, state.profile);
      state.dockRestoreSizes = normalizeDockRestoreSizes(parsed.dockRestoreSizes, state.profile);
      state.panelVisibility = normalizePanelVisibility(parsed.panelVisibility, state.profile, state.panelInstances);
      syncIntegratedPanelVisibility();
      state.activePanelId = resolvePanelTarget(parsed.activePanelId) || state.activePanelId;
      state.activeLeafId = String(parsed.activeLeafId || '');
      state.foldedPanes = (parsed.foldedPanes && typeof parsed.foldedPanes === 'object') ? parsed.foldedPanes : {};
      ensureActiveLeaf();
      return true;
    } catch (_) {
      return false;
    }
  }

  function getActiveLeaf() {
    return findLeafById(state.dockTree, state.activeLeafId) || getFirstLeaf(state.dockTree);
  }

  function getActiveTab() {
    var leaf = getActiveLeaf();
    if (!leaf || !leaf.activeTabId) return null;
    var result = findTab(state.dockTree, leaf.activeTabId);
    return result ? result.tab : null;
  }

  function ensureActiveLeaf() {
    state.dockTree = withNormalizedLeaves(state.dockTree, true);
    var leaf = getActiveLeaf();
    if (!leaf) {
      state.dockTree = createTabsetNode([]);
      leaf = state.dockTree;
    }
    state.activeLeafId = leaf.id;
    if (!leaf.activeTabId && leaf.tabs.length > 0) leaf.activeTabId = leaf.tabs[0].id;
    return leaf;
  }

  function getDockForPanel(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return '';
    var dockIds = ['left', 'right', 'bottom'];
    for (var i = 0; i < dockIds.length; i++) {
      var tree = state.sideDocks[dockIds[i]];
      if (tree && findLeafContainingPanel(tree, normalized)) return dockIds[i];
    }
    return '';
  }

  function isPanelIntegrated(panelId) {
    return !!findLeafContainingPanel(state.dockTree, panelId);
  }

  function isPanelShown(panelId) {
    var normalized = String(panelId || '');
    if (state.panelInstances[normalized]) {
      if (!state.panelVisibility[normalized]) return false;
      if (isPanelIntegrated(normalized)) return true;
      // Check side docks
      var found = findPanelInAllTrees(normalized);
      if (!found || found.treeId === 'center') return false;
      return state.dockSizes[found.treeId] > 0;
    }
    var kind = normalizePanelKind(normalized);
    if (!kind) return false;
    var panelIds = getPanelInstanceIdsByKind(kind);
    for (var i = 0; i < panelIds.length; i++) {
      if (isPanelShown(panelIds[i])) return true;
    }
    return false;
  }

  // Returns flat list of visible panel IDs for a side dock tree
  function getVisiblePanelIdsForDock(dockId) {
    var tree = state.sideDocks[dockId];
    if (!tree) return [];
    var result = [];
    visitTree(tree, function(node) {
      if (node.type !== 'tabs') return;
      for (var i = 0; i < node.tabs.length; i++) {
        if (!isPanelTab(node.tabs[i])) continue;
        var panelId = resolvePanelTarget(node.tabs[i].panelId);
        if (!panelId) continue;
        if (!state.panelVisibility[panelId]) continue;
        if (isPanelIntegrated(panelId)) continue;
        result.push(panelId);
      }
    });
    return result;
  }

  function ensurePanelDockActives() {
    if (!state.panelVisibility[state.activePanelId]) {
      state.activePanelId = '';
      var dockOrder = ['left', 'right', 'bottom'];
      for (var i = 0; i < dockOrder.length; i++) {
        var panelIds = getVisiblePanelIdsForDock(dockOrder[i]);
        for (var j = 0; j < panelIds.length; j++) {
          if (state.panelVisibility[panelIds[j]]) {
            state.activePanelId = panelIds[j];
            break;
          }
        }
        if (state.activePanelId) break;
      }
    }
  }

  function syncIntegratedPanelVisibility() {
    var ids = allTreeIds();
    for (var t = 0; t < ids.length; t++) {
      var root = getTreeRoot(ids[t]);
      if (!root) continue;
      visitTree(root, function (node) {
        if (!node || node.type !== 'tabs') return;
        for (var i = 0; i < node.tabs.length; i++) {
          if (!isPanelTab(node.tabs[i])) continue;
          var panelId = resolvePanelTarget(node.tabs[i].panelId);
          if (!panelId) continue;
          state.panelVisibility[panelId] = true;
        }
      });
    }
  }



  function restoreDock(dockId, panelId) {
    if (dockId !== 'left' && dockId !== 'right' && dockId !== 'bottom') return false;
    var restoreSize = clampPanelSize(dockId, state.dockRestoreSizes[dockId]);
    if (!(restoreSize > 0)) {
      restoreSize = createDefaultDockRestoreSizes(state.profile)[dockId];
    }
    state.dockSizes[dockId] = restoreSize;
    if (panelId) activatePanel(panelId);
    render();
    return true;
  }

  function collapseDock(dockId) {
    if (dockId !== 'left' && dockId !== 'right' && dockId !== 'bottom') return false;
    if (state.dockSizes[dockId] > 0) {
      state.dockRestoreSizes[dockId] = clampPanelSize(dockId, state.dockSizes[dockId]);
    }
    state.dockSizes[dockId] = 0;
    render();
    return true;
  }

  function toggleFoldPane(nodeId) {
    if (state.foldedPanes[nodeId]) return unfoldPane(nodeId);
    // If this node is in a dock-level collapsed dock, restore the dock
    var ids = allTreeIds();
    for (var t = 0; t < ids.length; t++) {
      var treeId = ids[t];
      if (treeId === 'center') continue;
      var root = getTreeRoot(treeId);
      if (!root) continue;
      if (!findNodeAndParent(root, nodeId) && root.id !== nodeId) continue;
      if (state.dockSizes[treeId] === 0) return restoreDock(treeId, nodeId);
    }
    return foldPane(nodeId);
  }

  /**
   * FOLD RULES (keep in sync with CSS comment block in workspaceShell.css):
   *
   * Fold direction:
   *   - Left/right docks → dock-level collapse (vertical bar, 22px strip).
   *   - Bottom dock → pane-level fold (horizontal bar, 28px tall).
   *   - Center tree vertical split → pane-level fold (vertical bar, 28px wide).
   *   - Center tree horizontal split → pane-level fold (horizontal bar, 28px tall).
   *   - Close button removes the view entirely (separate from fold).
   *
   * Hover-to-preview:
   *   - Each view in a folded bar has a proportional hover zone.
   *   - Hovering a zone temporarily expands the view for preview/editing.
   *   - Mouse leave closes the expanded area.
   *   - Dock-level: fold strip zones + JS (bindFoldHover, per-panel activation).
   *   - Pane-level: CSS :hover on .is-pane-folded → absolute overlay.
   *
   * CSS classes (renderSplit / renderSideDockSplit):
   *   .is-pane-folded-vertical   — vertical splits (narrow column, hover slides right)
   *   .is-pane-folded-horizontal — horizontal splits (narrow row, hover drops down)
   */
  function foldPane(nodeId) {
    var ids = allTreeIds();
    for (var t = 0; t < ids.length; t++) {
      var treeId = ids[t];
      var root = getTreeRoot(treeId);
      if (!root) continue;
      var info = findNodeAndParent(root, nodeId);
      if (!info) continue;
      // Left/right docks: always collapse the entire dock (vertical bar, 22px)
      if (treeId === 'left' || treeId === 'right') return collapseDock(treeId);
      if (!info.parent || info.parent.type !== 'split') continue;
      // Bottom dock and center tree: pane-level fold within split
      state.foldedPanes[nodeId] = info.parent.ratio;
      if (info.side === 'first') {
        info.parent.ratio = 0;
      } else {
        info.parent.ratio = 1;
      }
      render();
      return true;
    }
    // No parent split found — try collapsing the dock this node is in
    for (var d = 0; d < ids.length; d++) {
      if (ids[d] === 'center') continue;
      var dRoot = getTreeRoot(ids[d]);
      if (dRoot && dRoot.id === nodeId) return collapseDock(ids[d]);
    }
    return false;
  }

  function unfoldPane(nodeId) {
    var restoreRatio = state.foldedPanes[nodeId];
    if (restoreRatio == null) return false;
    var ids = allTreeIds();
    for (var t = 0; t < ids.length; t++) {
      var root = getTreeRoot(ids[t]);
      if (!root) continue;
      var info = findNodeAndParent(root, nodeId);
      if (!info || !info.parent || info.parent.type !== 'split') continue;
      info.parent.ratio = restoreRatio;
      delete state.foldedPanes[nodeId];
      render();
      return true;
    }
    delete state.foldedPanes[nodeId];
    return false;
  }

  function addTabToDock(dockId, tab, opts) {
    var method = typeof opts === 'string' ? opts : (opts && opts.method || 'push');
    var activate = typeof opts === 'string' ? true : (opts ? opts.activate !== false : true);
    var dockTree = state.sideDocks[dockId];
    if (dockTree) {
      var firstLeaf = getFirstLeaf(dockTree);
      if (firstLeaf) {
        if (method === 'unshift') firstLeaf.tabs.unshift(tab);
        else firstLeaf.tabs.push(tab);
        if (activate) firstLeaf.activeTabId = tab.id;
      } else {
        state.sideDocks[dockId] = createTabsetNode([tab]);
      }
    } else {
      state.sideDocks[dockId] = createTabsetNode([tab]);
    }
  }

  function destroyDuplicatedPanelInstance(panelId) {
    removePanelFromDocks(panelId);
    delete state.panelInstances[panelId];
    delete state.panelVisibility[panelId];
    if (state.panelElements && state.panelElements[panelId]) {
      var panelEl = state.panelElements[panelId];
      if (panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
      delete state.panelElements[panelId];
    }
    var sharedPanels = getSharedPanelsApi();
    if (sharedPanels && typeof sharedPanels.unregisterInstance === 'function') {
      sharedPanels.unregisterInstance(panelId);
    }
  }

  function buildDropOverlayHtml(nodeId) {
    var escaped = escapeHtml(nodeId);
    return '<div class="workspace-shell-drop-zone" data-zone="left" data-ws-drop-zone="left" data-ws-drop-leaf="' + escaped + '"></div>' +
      '<div class="workspace-shell-drop-zone" data-zone="right" data-ws-drop-zone="right" data-ws-drop-leaf="' + escaped + '"></div>' +
      '<div class="workspace-shell-drop-zone" data-zone="top" data-ws-drop-zone="top" data-ws-drop-leaf="' + escaped + '"></div>' +
      '<div class="workspace-shell-drop-zone" data-zone="bottom" data-ws-drop-zone="bottom" data-ws-drop-leaf="' + escaped + '"></div>' +
      '<div class="workspace-shell-drop-zone" data-zone="center" data-ws-drop-zone="center" data-ws-drop-leaf="' + escaped + '"></div>';
  }

  function moveLogsStatusToHeader(panelId, headerEl) {
    var logsPanel = getPanelElement(panelId);
    if (!logsPanel) return;
    var statusEl = logsPanel.querySelector('.log-panel-status');
    if (!statusEl) return;
    var foldBtn = headerEl.querySelector('.ws-view-fold');
    if (foldBtn) headerEl.insertBefore(statusEl, foldBtn);
    else headerEl.appendChild(statusEl);
  }

  function renderSplitLayout(node, parentEl, childRenderer) {
    var splitEl = document.createElement('div');
    splitEl.className = 'workspace-shell-split workspace-shell-node axis-' + node.axis;
    splitEl.setAttribute('data-node-id', node.id);
    var firstFolded = node.first && state.foldedPanes[node.first.id];
    var secondFolded = node.second && state.foldedPanes[node.second.id];
    var firstSize = firstFolded ? '28px' : (Math.round(node.ratio * 1000) + 'fr');
    var secondSize = secondFolded ? '28px' : ((1000 - Math.round(node.ratio * 1000)) + 'fr');
    if (node.axis === 'vertical') {
      splitEl.style.gridTemplateColumns = firstSize + ' 1px ' + secondSize;
      splitEl.style.gridTemplateRows = '1fr';
    } else {
      splitEl.style.gridTemplateRows = firstSize + ' 1px ' + secondSize;
      splitEl.style.gridTemplateColumns = '1fr';
    }

    var foldDir = node.axis === 'vertical' ? 'is-pane-folded-vertical' : 'is-pane-folded-horizontal';
    var firstPane = document.createElement('div');
    firstPane.className = 'workspace-shell-split-pane';
    if (firstFolded) { firstPane.classList.add('is-pane-folded'); firstPane.classList.add(foldDir); }
    childRenderer(node.first, firstPane);

    var divider = document.createElement('div');
    divider.className = 'workspace-shell-divider';
    divider.setAttribute('data-axis', node.axis);
    bindSplitDivider(divider, node.id, node.axis);

    var secondPane = document.createElement('div');
    secondPane.className = 'workspace-shell-split-pane';
    if (secondFolded) { secondPane.classList.add('is-pane-folded'); secondPane.classList.add(foldDir); }
    childRenderer(node.second, secondPane);

    splitEl.appendChild(firstPane);
    splitEl.appendChild(divider);
    splitEl.appendChild(secondPane);
    parentEl.appendChild(splitEl);
  }

  function revealPanel(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;
    // Check all trees for existing panel tab
    var found = findPanelInAllTrees(normalized);
    if (found && found.tab) {
      state.panelVisibility[normalized] = true;
      state.activePanelId = normalized;
      if (found.treeId === 'center') {
        activateTab(found.tab.id);
      } else {
        found.leaf.activeTabId = found.tab.id;
        return restoreDock(found.treeId, normalized);
      }
      return true;
    }
    // Not found anywhere, add to default side dock
    var kind = getPanelKind(normalized);
    var dockId = kind && PANEL_DEFINITIONS[kind] ? PANEL_DEFINITIONS[kind].defaultDock : 'left';
    addTabToDock(dockId, createPanelTab(normalized));
    state.panelVisibility[normalized] = true;
    state.activePanelId = normalized;
    return restoreDock(dockId, normalized);
  }

  function collapsePanel(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;
    var found = findPanelInAllTrees(normalized);
    if (found && found.treeId === 'center' && found.tab) {
      return closeTab(found.tab.id);
    }
    var dockId = found ? found.treeId : getDockForPanel(normalized);
    if (!dockId || dockId === 'center') return false;
    return collapseDock(dockId);
  }

  function closePanelView(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;
    var found = findPanelInAllTrees(normalized);
    if (found && found.treeId === 'center' && found.tab) {
      return closeTab(found.tab.id);
    }
    var kind = getPanelKind(normalized);
    if (!kind) return false;
    if (normalized === kind) {
      // Base panel: remove tab from tree and hide
      state.panelVisibility[normalized] = false;
      if (state.activePanelId === normalized) state.activePanelId = '';
      if (found && found.tab) {
        extractTab(found.tab.id);
      }
      ensurePanelDockActives();
      render();
      return true;
    }
    // Duplicated instance: remove from side docks entirely
    if (state.activePanelId === normalized) state.activePanelId = '';
    destroyDuplicatedPanelInstance(normalized);
    ensurePanelDockActives();
    render();
    return true;
  }

  function duplicatePanel(panelId) {
    var sourcePanelId = resolvePanelTarget(panelId);
    if (!sourcePanelId) return '';
    var kind = getPanelKind(sourcePanelId);
    if (!isPanelKindDuplicable(kind)) return sourcePanelId;
    var newPanelId = createPanelInstance(kind);
    state.panelVisibility[newPanelId] = true;
    // Find source in any tree
    var found = findPanelInAllTrees(sourcePanelId);
    if (found && found.leaf) {
      var newTab = createPanelTab(newPanelId);
      var insertAt = found.leaf.tabs.indexOf(found.tab);
      if (insertAt === -1) found.leaf.tabs.push(newTab);
      else found.leaf.tabs.splice(insertAt + 1, 0, newTab);
      found.leaf.activeTabId = newTab.id;
      if (found.treeId === 'center') state.activeLeafId = found.leaf.id;
      state.activePanelId = newPanelId;
      render();
      return newPanelId;
    }
    // Not found anywhere, add to default dock
    var dockId = PANEL_DEFINITIONS[kind] ? PANEL_DEFINITIONS[kind].defaultDock : 'left';
    addTabToDock(dockId, createPanelTab(newPanelId));
    state.activePanelId = newPanelId;
    restoreDock(dockId, newPanelId);
    return newPanelId;
  }

  function getFoldIndicatorContent(panelId) {
    var kind = getPanelKind(panelId);
    if (kind === 'hierarchy') return '\u2630'; // ☰
    if (kind === 'dashboard') return '\u25a3'; // ▣
    if (kind === 'logs') return '\u25cb'; // ○ (replaced with dot in strip)
    if (kind === 'backendSettings' || kind === 'frontendSettings' || kind === 'renderApps') return '\u2699'; // ⚙
    return '\u25a1'; // □
  }

  function renderFoldStrip(dockId, dockEl) {
    // Remove old fold strip if any
    var oldStrip = dockEl.querySelector('.ws-fold-strip');
    if (oldStrip) oldStrip.parentNode.removeChild(oldStrip);

    var panelIds = getVisiblePanelIdsForDock(dockId);
    if (panelIds.length === 0) return;

    var strip = document.createElement('div');
    strip.className = 'ws-fold-strip';

    // Each panel gets a proportional hover zone in the fold strip.
    // Hovering a zone temporarily expands the dock and activates that panel.
    for (var i = 0; i < panelIds.length; i++) {
      var panelId = panelIds[i];
      var kind = getPanelKind(panelId);

      var zone = document.createElement('div');
      zone.className = 'ws-fold-zone';
      zone.setAttribute('data-ws-panel-id', panelId);
      zone.setAttribute('data-ws-dock-id', dockId);
      zone.setAttribute('data-ws-action', 'expand-collapsed-dock');
      zone.title = getPanelTitle(panelId);

      var indicator = document.createElement('span');
      indicator.className = 'ws-fold-indicator';
      if (panelId === state.activePanelId) indicator.classList.add('is-active');

      // Logs: show connection dot inside indicator
      if (kind === 'logs') {
        var dot = document.createElement('span');
        dot.className = 'ws-fold-dot';
        if (state.backendConnected) {
          dot.classList.add('is-connected');
        } else {
          dot.classList.add('is-disconnected');
        }
        indicator.appendChild(dot);
      } else if (dockId === 'left' || dockId === 'right') {
        indicator.classList.add('is-drag-handle');
        indicator.innerHTML = '&#8942;&#8942;';
      } else {
        indicator.textContent = getFoldIndicatorContent(panelId);
      }
      zone.appendChild(indicator);

      var label = document.createElement('span');
      label.className = 'ws-fold-zone-label';
      label.textContent = kind === 'logs'
        ? (getPanelTitle(panelId) + ' · ' + (state.backendConnected ? 'Connected' : 'Disconnected'))
        : getPanelTitle(panelId);
      zone.appendChild(label);

      strip.appendChild(zone);
    }

    // Move logs status bar into fold strip so it's visible when collapsed
    for (var si = 0; si < panelIds.length; si++) {
      if (getPanelKind(panelIds[si]) === 'logs') {
        // Status may be in the panel element or already moved to the ws-view-header
        var statusEl = dockEl.querySelector('.log-panel-status');
        if (!statusEl) {
          var logPanel = getPanelElement(panelIds[si]);
          if (logPanel) statusEl = logPanel.querySelector('.log-panel-status');
        }
        if (statusEl) strip.appendChild(statusEl);
        break;
      }
    }

    dockEl.appendChild(strip);
  }

  /**
   * Per-zone hover: hovering a fold strip zone temporarily expands the dock
   * overlay and activates the hovered panel's tab. Mouse leave closes it.
   */
  function bindFoldHover(dockId, dockEl) {
    if (dockEl.__wsFoldBound) return;
    dockEl.__wsFoldBound = true;
    var hoverTimer = null;
    var activeHoverPanelId = null;

    function activatePanelTab(panelId) {
      var found = findPanelInAllTrees(panelId);
      if (found && found.leaf) {
        found.leaf.activeTabId = found.tab.id;
      }
    }

    function showHover(panelId) {
      if (panelId) activatePanelTab(panelId);
      activeHoverPanelId = panelId;
      dockEl.classList.add('is-fold-hover');
      rerenderDockTree();
      measureAndApplyOverlaySize();
    }

    function rerenderDockTree() {
      var tree = state.sideDocks[dockId];
      if (!tree) return;
      var treeNodes = dockEl.querySelectorAll(':scope > .workspace-shell-node');
      for (var n = 0; n < treeNodes.length; n++) treeNodes[n].parentNode.removeChild(treeNodes[n]);
      renderSideDockNode(tree, dockEl, dockId);
    }

    function measureAndApplyOverlaySize() {
      var node = dockEl.querySelector(':scope > .workspace-shell-node');
      if (!node) return;
      var isHorizontal = dockId === 'bottom';
      var prop = isHorizontal ? 'height' : 'width';
      var offsetProp = isHorizontal ? 'offsetHeight' : 'offsetWidth';
      var minSize = isHorizontal ? 120 : 200;
      var maxSize = isHorizontal
        ? Math.round(window.innerHeight * 0.6)
        : Math.round(window.innerWidth * 0.6);
      // Use max-content to let the content determine its natural size.
      // This forces all flex/grid children to size to their content
      // rather than collapsing via min-width:0.
      node.style[prop] = 'max-content';
      var natural = node[offsetProp];
      var size = Math.max(minSize, Math.min(natural, maxSize));
      node.style[prop] = size + 'px';
    }

    dockEl.addEventListener('mouseenter', function () {
      if (!dockEl.classList.contains('is-folded')) return;
      hoverTimer = setTimeout(function () {
        showHover(null);
      }, 180);
    });

    // Per-zone mouseover: switch active panel when moving between zones
    dockEl.addEventListener('mouseover', function (e) {
      var zone = e.target.closest ? e.target.closest('.ws-fold-zone') : null;
      if (!zone) return;
      var panelId = zone.getAttribute('data-ws-panel-id');
      if (!panelId || panelId === activeHoverPanelId) return;
      // If hover overlay not yet shown, start it with this panel
      if (!dockEl.classList.contains('is-fold-hover')) {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(function () {
          showHover(panelId);
        }, 180);
      } else {
        // Already showing — switch to this panel
        activatePanelTab(panelId);
        activeHoverPanelId = panelId;
        rerenderDockTree();
        measureAndApplyOverlaySize();
      }
    });

    dockEl.addEventListener('mouseleave', function () {
      clearTimeout(hoverTimer);
      activeHoverPanelId = null;
      dockEl.classList.remove('is-fold-hover');
      // Clean up inline size from measurement
      var node = dockEl.querySelector(':scope > .workspace-shell-node');
      if (node) { node.style.width = ''; node.style.height = ''; }
    });
  }

  function applyDockLayout() {
    if (!state.bodyEl || !state.mainRowEl) return;
    var FOLD_SIZE = 22;

    var dockIds = ['left', 'right', 'bottom'];
    var dockEls = { left: state.leftDockEl, right: state.rightDockEl, bottom: state.bottomDockEl };
    var dividerEls = { left: state.leftDividerEl, right: state.rightDividerEl, bottom: state.bottomDividerEl };
    var visible = {};
    var folded = {};

    for (var d = 0; d < dockIds.length; d++) {
      var id = dockIds[d];
      var hasPanels = getVisiblePanelIdsForDock(id).length > 0;
      var isCollapsed = hasPanels && state.dockSizes[id] === 0;
      visible[id] = hasPanels && state.dockSizes[id] > 0;
      folded[id] = isCollapsed;

      var dockEl = dockEls[id];
      if (dockEl) {
        var showDock = visible[id] || folded[id];
        dockEl.classList.toggle('is-visible', showDock);
        dockEl.classList.toggle('is-folded', folded[id]);
        dockEl.classList.toggle('is-compact', visible[id] && state.dockSizes[id] < 200);
        dockEl.style.overflow = folded[id] ? 'visible' : '';
        if (folded[id]) {
          renderFoldStrip(id, dockEl);
          bindFoldHover(id, dockEl);
        } else {
          // Remove fold strip when not folded
          var oldStrip = dockEl.querySelector('.ws-fold-strip');
          if (oldStrip) oldStrip.parentNode.removeChild(oldStrip);
          dockEl.classList.remove('is-fold-hover');
        }
      }
      if (dividerEls[id]) dividerEls[id].classList.toggle('is-visible', visible[id]);
    }

    // Grid: folded docks get FOLD_SIZE px, visible docks get their size, hidden get nothing
    var leftCol = '';
    if (visible.left) leftCol = clampPanelSize('left', state.dockSizes.left) + 'px 5px ';
    else if (folded.left) leftCol = FOLD_SIZE + 'px ';

    var rightCol = '';
    if (visible.right) rightCol = ' 5px ' + clampPanelSize('right', state.dockSizes.right) + 'px';
    else if (folded.right) rightCol = ' ' + FOLD_SIZE + 'px';

    state.mainRowEl.style.gridTemplateColumns =
      leftCol + 'minmax(0, 1fr)' + rightCol;

    var bottomRow = '';
    if (visible.bottom) bottomRow = ' 5px ' + clampPanelSize('bottom', state.dockSizes.bottom) + 'px';
    else if (folded.bottom) bottomRow = ' ' + FOLD_SIZE + 'px';

    state.bodyEl.style.gridTemplateRows =
      'minmax(0, 1fr)' + bottomRow;
  }

  function bindDockResizeDivider(dividerEl, dockId) {
    if (!dividerEl) return;
    dividerEl.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      dividerEl.setPointerCapture(event.pointerId);
      dividerEl.classList.add('is-dragging');
      function handleMove(moveEvent) {
        var nextSize = 0;
        if (dockId === 'left') {
          var rectLeft = state.mainRowEl.getBoundingClientRect();
          nextSize = moveEvent.clientX - rectLeft.left;
          if (nextSize < 56) nextSize = 0;
          else state.dockRestoreSizes.left = clampPanelSize('left', nextSize);
          state.dockSizes.left = nextSize === 0 ? 0 : clampPanelSize('left', nextSize);
        } else if (dockId === 'right') {
          var rectRight = state.mainRowEl.getBoundingClientRect();
          nextSize = rectRight.right - moveEvent.clientX;
          if (nextSize < 56) nextSize = 0;
          else state.dockRestoreSizes.right = clampPanelSize('right', nextSize);
          state.dockSizes.right = nextSize === 0 ? 0 : clampPanelSize('right', nextSize);
        } else if (dockId === 'bottom') {
          var rectBottom = state.bodyEl.getBoundingClientRect();
          nextSize = rectBottom.bottom - moveEvent.clientY;
          if (nextSize < 48) nextSize = 0;
          else state.dockRestoreSizes.bottom = clampPanelSize('bottom', nextSize);
          state.dockSizes.bottom = nextSize === 0 ? 0 : clampPanelSize('bottom', nextSize);
        }
        applyDockLayout();
      }
      function handleUp(upEvent) {
        dividerEl.classList.remove('is-dragging');
        dividerEl.removeEventListener('pointermove', handleMove);
        dividerEl.removeEventListener('pointerup', handleUp);
        dividerEl.removeEventListener('pointercancel', handleUp);
        try { dividerEl.releasePointerCapture(upEvent.pointerId); } catch (_) { /* ignore */ }
        persistState();
      }
      dividerEl.addEventListener('pointermove', handleMove);
      dividerEl.addEventListener('pointerup', handleUp);
      dividerEl.addEventListener('pointercancel', handleUp);
    });
  }

  function removePanelFromDocks(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;
    var changed = false;
    var dockIds = ['left', 'right', 'bottom'];
    for (var i = 0; i < dockIds.length; i++) {
      var tree = state.sideDocks[dockIds[i]];
      if (!tree) continue;
      var found = findLeafContainingPanel(tree, normalized);
      if (!found) continue;
      // Remove the tab from the leaf
      for (var j = found.leaf.tabs.length - 1; j >= 0; j--) {
        if (isPanelTab(found.leaf.tabs[j]) && resolvePanelTarget(found.leaf.tabs[j].panelId) === normalized) {
          found.leaf.tabs.splice(j, 1);
          changed = true;
        }
      }
      if (found.leaf.tabs.length > 0) {
        if (!findTab(tree, found.leaf.activeTabId)) {
          found.leaf.activeTabId = found.leaf.tabs[0].id;
        }
      }
      state.sideDocks[dockIds[i]] = withNormalizedLeaves(tree, false);
    }
    return changed;
  }

  function activatePanel(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;
    var found = findPanelInAllTrees(normalized);
    if (found && found.treeId === 'center' && found.tab) {
      state.panelVisibility[normalized] = true;
      state.activePanelId = normalized;
      activateTab(found.tab.id);
      return true;
    }
    if (found && found.treeId !== 'center') {
      state.panelVisibility[normalized] = true;
      state.activePanelId = normalized;
      found.leaf.activeTabId = found.tab.id;
      renderToolbar();
      renderPanelDocks();
      persistState();
      return true;
    }
    return false;
  }

  function setPanelVisibility(panelId, visible, options) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;
    if (!visible) {
      return collapsePanel(normalized);
    }
    state.panelVisibility[normalized] = true;
    var found = findPanelInAllTrees(normalized);
    if (found && found.treeId === 'center' && found.tab) {
      if (!state.activePanelId || (options && options.activate)) state.activePanelId = normalized;
      activateTab(found.tab.id);
      return true;
    }
    if (found && found.treeId !== 'center') {
      if (!state.activePanelId || (options && options.activate)) state.activePanelId = normalized;
      found.leaf.activeTabId = found.tab.id;
      if (options && options.restoreDock) {
        return restoreDock(found.treeId, normalized);
      }
      ensurePanelDockActives();
      render();
      return true;
    }
    // Not found, add to default dock
    var kind = getPanelKind(normalized);
    var dockId = kind && PANEL_DEFINITIONS[kind] ? PANEL_DEFINITIONS[kind].defaultDock : 'left';
    addTabToDock(dockId, createPanelTab(normalized));
    if (!state.activePanelId || (options && options.activate)) state.activePanelId = normalized;
    if (options && options.restoreDock) {
      return restoreDock(dockId, normalized);
    }
    ensurePanelDockActives();
    render();
    return true;
  }

  function movePanelToDock(panelId, dockId) {
    var normalizedPanelId = resolvePanelTarget(panelId);
    if (!normalizedPanelId) return false;
    if (dockId !== 'left' && dockId !== 'right' && dockId !== 'bottom') return false;
    // Remove from all locations
    removePanelFromDocks(normalizedPanelId);
    var panelTab = findLeafContainingPanel(state.dockTree, normalizedPanelId);
    if (panelTab) {
      extractTab(panelTab.tab.id);
      removeFrame(panelTab.tab.id);
      state.dockTree = withNormalizedLeaves(state.dockTree, true);
      ensureActiveLeaf();
    }
    // Add to target side dock
    addTabToDock(dockId, createPanelTab(normalizedPanelId));
    state.panelVisibility[normalizedPanelId] = true;
    state.activePanelId = normalizedPanelId;
    ensurePanelDockActives();
    render();
    return true;
  }

  // Move a panel into the same tabset leaf as another panel (tab together)
  function movePanelToGroup(panelId, targetPanelId) {
    var normalized = resolvePanelTarget(panelId);
    var targetNormalized = resolvePanelTarget(targetPanelId);
    if (!normalized || !targetNormalized || normalized === targetNormalized) return false;
    // Find the target in any tree
    var targetFound = findPanelInAllTrees(targetNormalized);
    if (!targetFound) return false;
    // Remove source from current location
    removePanelFromDocks(normalized);
    var sourceInCenter = findLeafContainingPanel(state.dockTree, normalized);
    if (sourceInCenter) {
      extractTab(sourceInCenter.tab.id);
      removeFrame(sourceInCenter.tab.id);
      state.dockTree = withNormalizedLeaves(state.dockTree, true);
      ensureActiveLeaf();
    }
    // Add to target's leaf
    var newTab = createPanelTab(normalized);
    targetFound.leaf.tabs.push(newTab);
    targetFound.leaf.activeTabId = newTab.id;
    state.panelVisibility[normalized] = true;
    state.activePanelId = normalized;
    ensurePanelDockActives();
    render();
    return true;
  }

  function notifyActiveBoardChanged() {
    var activeTab = getActiveTab();
    var boardId = activeTab && isBoardTab(activeTab) && activeTab.boardId ? activeTab.boardId : '';
    if (boardId === state.lastNotifiedBoardId) return;
    state.lastNotifiedBoardId = boardId;
    if (state.hooks && typeof state.hooks.onActiveBoardChanged === 'function') {
      state.hooks.onActiveBoardChanged(boardId || null);
    }
  }

  function buildStructureSignature(node) {
    if (!node) return '';
    if (node.type === 'tabs') {
      var tabBits = [];
      for (var i = 0; i < node.tabs.length; i++) {
        if (isPanelTab(node.tabs[i])) {
          tabBits.push(node.tabs[i].id + ':panel:' + resolvePanelTarget(node.tabs[i].panelId));
        } else {
          tabBits.push(node.tabs[i].id + ':board:' + node.tabs[i].boardId + ':' + normalizeViewKind(node.tabs[i].viewKind));
        }
      }
      return 'tabs(' + node.id + ')[' + tabBits.join('|') + ']';
    }
    return 'split(' + node.id + ':' + node.axis + ':' + buildStructureSignature(node.first) + ':' + buildStructureSignature(node.second) + ')';
  }

  function getTabTitle(tab) {
    if (isPanelTab(tab)) return getPanelTitle(tab.panelId);
    var meta = state.boardsById[tab.boardId];
    return getBoardMetaLabel(meta || { id: tab.boardId || 'Untitled' });
  }

  function getTabMetaLabel(tab) {
    if (isPanelTab(tab)) {
      var panelKind = getPanelKind(tab.panelId);
      if (panelKind === 'hierarchy') return 'Workspace';
      if (panelKind === 'dashboard') return 'Panel';
      if (panelKind === 'logs') return 'Panel';
      if (panelKind === 'backendSettings') return 'Settings';
      if (panelKind === 'frontendSettings') return 'Settings';
      if (panelKind === 'renderApps') return 'Settings';
      return 'Panel';
    }
    if (tab.viewKind === 'canvas') return 'Canvas';
    if (tab.viewKind === 'kanban') return 'Kanban';
    return '';
  }

  function getOrCreateFrame(tab) {
    var view = state.frameCache[tab.id];
    if (isPanelTab(tab)) {
      if (!view) {
        view = document.createElement('div');
        view.className = 'workspace-shell-view workspace-shell-panel-tab-view';
        view.setAttribute('data-tab-id', tab.id);
        view.setAttribute('data-panel-id', resolvePanelTarget(tab.panelId));
        view.addEventListener('pointerdown', function () {
          activateTab(tab.id);
        });
        state.frameCache[tab.id] = view;
      }
      var panelEl = getPanelElement(tab.panelId);
      if (panelEl && panelEl.parentNode !== view) {
        view.innerHTML = '';
        panelEl.classList.remove('hidden');
        panelEl.style.display = '';
        view.appendChild(panelEl);
      }
      return view;
    }
    var desiredSrc = getEmbeddedUrlForTab(tab);
    if (!view) {
      view = document.createElement('iframe');
      view.className = 'workspace-shell-view workspace-shell-frame';
      view.setAttribute('data-tab-id', tab.id);
      view.setAttribute('data-src', desiredSrc);
      view.setAttribute('title', getTabTitle(tab));
      view.src = desiredSrc;
      view.addEventListener('pointerdown', function () {
        activateTab(tab.id);
      });
      state.frameCache[tab.id] = view;
      return view;
    }
    if (view.getAttribute('data-src') !== desiredSrc) {
      view.setAttribute('data-src', desiredSrc);
      view.src = desiredSrc;
    }
    view.setAttribute('title', getTabTitle(tab));
    return view;
  }

  function removeFrame(tabId) {
    var frame = state.frameCache[tabId];
    if (!frame) return;
    if (frame.parentNode) frame.parentNode.removeChild(frame);
    delete state.frameCache[tabId];
  }

  function activateTab(tabId) {
    var found = findTabInAllTrees(tabId);
    if (!found) return false;
    found.leaf.activeTabId = tabId;
    if (found.treeId === 'center') state.activeLeafId = found.leaf.id;
    render();
    return true;
  }

  function extractTab(tabId) {
    var ids = allTreeIds();
    for (var t = 0; t < ids.length; t++) {
      var root = getTreeRoot(ids[t]);
      if (!root) continue;
      var found = findTab(root, tabId);
      if (!found) continue;
      var tab = found.tab;
      var leaf = found.leaf;
      var sourceLeafId = leaf.id;
      leaf.tabs.splice(found.index, 1);
      if (leaf.activeTabId === tabId) {
        leaf.activeTabId = leaf.tabs.length > 0
          ? leaf.tabs[Math.max(0, found.index - 1)].id
          : '';
      }
      var newRoot = withNormalizedLeaves(root, ids[t] === 'center');
      setTreeRoot(ids[t], newRoot || (ids[t] === 'center' ? createTabsetNode([]) : null));
      return { tab: tab, sourceLeafId: sourceLeafId, treeId: ids[t] };
    }
    return null;
  }

  function insertTabIntoLeaf(tab, leafId) {
    var found = findLeafInAllTrees(leafId);
    if (!found) return false;
    found.leaf.tabs.push(tab);
    found.leaf.activeTabId = tab.id;
    if (found.treeId === 'center') state.activeLeafId = found.leaf.id;
    return true;
  }

  function replaceNodeById(nodeId, replacement) {
    var ids = allTreeIds();
    for (var t = 0; t < ids.length; t++) {
      var root = getTreeRoot(ids[t]);
      if (!root) continue;
      var found = findNodeAndParent(root, nodeId);
      if (!found) continue;
      if (!found.parent) {
        setTreeRoot(ids[t], replacement);
      } else {
        found.parent[found.side] = replacement;
      }
      return true;
    }
    return false;
  }

  function moveTabToLeaf(tabId, targetLeafId) {
    var extracted = extractTab(tabId);
    if (!extracted) return false;
    if (!insertTabIntoLeaf(extracted.tab, targetLeafId)) {
      insertTabIntoLeaf(extracted.tab, extracted.sourceLeafId);
      return false;
    }
    // Normalize all trees
    normalizeAllTrees();
    ensureActiveLeaf();
    render();
    return true;
  }

  function splitLeafWithTab(targetLeafId, zone, tabId) {
    var targetFound = findLeafInAllTrees(targetLeafId);
    if (!targetFound) return false;
    var targetLeaf = targetFound.leaf;
    var tabInfo = findTabInAllTrees(tabId);
    if (!tabInfo) return false;
    var movingWithinSameLeaf = tabInfo.leaf.id === targetLeafId;
    var shouldDuplicateSingleTab = movingWithinSameLeaf && tabInfo.leaf.tabs.length === 1;
    var tabForNewLeaf = null;
    if (shouldDuplicateSingleTab) {
      if (isPanelTab(tabInfo.tab)) {
        var panelKind = getPanelKind(tabInfo.tab.panelId);
        if (!isPanelKindDuplicable(panelKind)) return false;
        var duplicatedPanelId = createPanelInstance(panelKind);
        state.panelVisibility[duplicatedPanelId] = true;
        tabForNewLeaf = createPanelTab(duplicatedPanelId);
      } else {
        tabForNewLeaf = createBoardTab(tabInfo.tab.boardId, tabInfo.tab.viewKind);
      }
    } else {
      var extracted = extractTab(tabId);
      if (!extracted) return false;
      tabForNewLeaf = extracted.tab;
    }
    var newLeaf = createTabsetNode([tabForNewLeaf]);
    var axis = (zone === 'top' || zone === 'bottom') ? 'horizontal' : 'vertical';
    var split = (zone === 'left' || zone === 'top')
      ? createSplitNode(axis, newLeaf, targetLeaf, 0.5)
      : createSplitNode(axis, targetLeaf, newLeaf, 0.5);
    replaceNodeById(targetLeafId, split);
    if (targetFound.treeId === 'center') state.activeLeafId = newLeaf.id;
    // Normalize all trees
    normalizeAllTrees();
    render();
    return true;
  }

  function handleRemovedPanelTab(tab) {
    if (!isPanelTab(tab)) return;
    var panelId = resolvePanelTarget(tab.panelId);
    if (!panelId) return;
    var kind = getPanelKind(panelId);
    if (panelId === kind) {
      state.panelVisibility[panelId] = false;
      var defaultDock = (PANEL_DEFINITIONS[kind] && PANEL_DEFINITIONS[kind].defaultDock) || 'left';
      // Re-add to side dock if not already there
      var alreadyInDock = state.sideDocks[defaultDock] && findLeafContainingPanel(state.sideDocks[defaultDock], panelId);
      if (!alreadyInDock) {
        addTabToDock(defaultDock, createPanelTab(panelId), 'unshift');
      }
      return;
    }
    destroyDuplicatedPanelInstance(panelId);
  }

  function closeTab(tabId) {
    var extracted = extractTab(tabId);
    if (!extracted) return false;
    handleRemovedPanelTab(extracted.tab);
    removeFrame(tabId);
    state.dockTree = withNormalizedLeaves(state.dockTree, true);
    ensureActiveLeaf();
    ensurePanelDockActives();
    render();
    return true;
  }

  function splitActivePane(axis) {
    var leaf = ensureActiveLeaf();
    if (!leaf) return false;
    var newLeaf = createTabsetNode([]);
    var split = createSplitNode(axis, leaf, newLeaf, 0.5);
    replaceNodeById(leaf.id, split);
    state.activeLeafId = newLeaf.id;
    render();
    return true;
  }

  function toggleActiveSplitOrientation() {
    var split = findClosestSplitParent(state.dockTree, state.activeLeafId, null);
    if (!split) return splitActivePane('horizontal');
    split.axis = split.axis === 'horizontal' ? 'vertical' : 'horizontal';
    render();
    return true;
  }

  function flattenToActiveLeaf() {
    var leaf = ensureActiveLeaf();
    if (!leaf) return false;
    var activeTab = getActiveTab();
    var replacement = createTabsetNode(activeTab ? [activeTab] : []);
    if (activeTab) replacement.activeTabId = activeTab.id;
    if (activeTab) removeTabFromEverywhereExcept(activeTab.id, replacement);
    state.dockTree = replacement;
    state.activeLeafId = replacement.id;
    render();
    return true;
  }

  function removeTabFromEverywhereExcept(tabId, replacementLeaf) {
    visitTree(state.dockTree, function (node) {
      if (node.type !== 'tabs') return;
      if (node === replacementLeaf) return;
      for (var i = node.tabs.length - 1; i >= 0; i--) {
        if (node.tabs[i].id === tabId) {
          node.tabs.splice(i, 1);
        }
      }
      if (node.activeTabId === tabId) {
        node.activeTabId = node.tabs.length > 0 ? node.tabs[0].id : '';
      }
    });
  }

  function toggleSidebar() {
    if (isPanelShown('hierarchy')) collapsePanel('hierarchy');
    else revealPanel('hierarchy');
  }

  function toggleLogs() {
    if (isPanelShown('logs')) collapsePanel('logs');
    else revealPanel('logs');
  }

  function areLogsVisible() {
    return isPanelShown('logs');
  }

  function openWindow(payload) {
    if (state.hooks && typeof state.hooks.openWindow === 'function') {
      return Promise.resolve(state.hooks.openWindow(payload || {}));
    }
    return invokeTauri('open_new_window', payload || {});
  }

  function getPanelWindowRect(panelId) {
    if (!state.rootEl) return null;
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return null;
    var panelWindowEl = state.rootEl.querySelector('.workspace-shell-panel-window[data-panel-id="' + normalized + '"], .workspace-shell-panel-tab-view[data-panel-id="' + normalized + '"]');
    if (!panelWindowEl || typeof panelWindowEl.getBoundingClientRect !== 'function') return null;
    var rect = panelWindowEl.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    return rect;
  }

  function detachTab(tabId) {
    var found = findTabInAllTrees(tabId);
    if (!found || !found.tab) return Promise.resolve(false);
    if (isPanelTab(found.tab)) {
      return detachPanelView(found.tab.panelId);
    }
    if (!found.tab.boardId) return Promise.resolve(false);
    return openWindow({
      boardId: found.tab.boardId,
      viewKind: found.tab.viewKind === 'default' ? null : found.tab.viewKind,
      profile: 'detachedBoard'
    }).then(function () {
      closeTab(tabId);
      return true;
    }).catch(function () {
      return false;
    });
  }

  function openWorkspaceWindow() {
    return openWindow({ profile: 'workspace' }).catch(function () {
      return false;
    });
  }

  function ensurePanelElements() {
    if (state.panelElements) return state.panelElements;

    var sidebarEl = document.querySelector('.layout > .sidebar') || document.querySelector('.sidebar');
    var dashboardEl = document.getElementById('sidebar-dashboard');
    var dashboardDividerEl = document.getElementById('sidebar-dashboard-divider');
    var boardListEl = document.getElementById('board-list');
    var logPanelEl = document.getElementById('log-panel');
    var sharedPanels = getSharedPanelsApi();
    var backendSettingsPanelEl = document.getElementById('backend-settings-panel') ||
      (sharedPanels ? sharedPanels.createPanelElement('backendSettings', 'backendSettings') : null);
    var frontendSettingsPanelEl = document.getElementById('frontend-settings-panel') ||
      (sharedPanels ? sharedPanels.createPanelElement('frontendSettings', 'frontendSettings') : null);
    var renderAppsPanelEl = sharedPanels ? sharedPanels.createPanelElement('renderApps', 'renderApps') : null;
    var filesPanelEl = sharedPanels ? sharedPanels.createPanelElement('files', 'files') : null;

    if (dashboardDividerEl) {
      dashboardDividerEl.classList.add('hidden');
      if (dashboardDividerEl.parentNode) dashboardDividerEl.parentNode.removeChild(dashboardDividerEl);
    }
    var sidebarWidthDividerEl = document.getElementById('sidebar-width-divider');
    if (sidebarWidthDividerEl && sidebarWidthDividerEl.parentNode) {
      sidebarWidthDividerEl.parentNode.removeChild(sidebarWidthDividerEl);
    }
    if (dashboardEl && dashboardEl.parentNode === sidebarEl) {
      dashboardEl.parentNode.removeChild(dashboardEl);
    }
    if (boardListEl) {
      boardListEl.style.flex = '1 1 auto';
      boardListEl.style.height = '';
    }
    if (dashboardEl) {
      dashboardEl.style.flex = '1 1 auto';
      dashboardEl.style.height = '';
      dashboardEl.classList.remove('hidden');
    }
    if (logPanelEl) {
      logPanelEl.classList.remove('hidden');
    }
    if (sidebarEl) sidebarEl.setAttribute('data-shell-panel', 'hierarchy');
    if (dashboardEl) dashboardEl.setAttribute('data-shell-panel', 'dashboard');
    if (logPanelEl) logPanelEl.setAttribute('data-shell-panel', 'logs');
    if (backendSettingsPanelEl) backendSettingsPanelEl.setAttribute('data-shell-panel', 'backendSettings');
    if (frontendSettingsPanelEl) frontendSettingsPanelEl.setAttribute('data-shell-panel', 'frontendSettings');
    if (renderAppsPanelEl) renderAppsPanelEl.setAttribute('data-shell-panel', 'renderApps');
    if (filesPanelEl) filesPanelEl.setAttribute('data-shell-panel', 'files');

    state.panelElements = {
      hierarchy: sidebarEl,
      dashboard: dashboardEl,
      logs: logPanelEl,
      backendSettings: backendSettingsPanelEl,
      frontendSettings: frontendSettingsPanelEl,
      renderApps: renderAppsPanelEl,
      files: filesPanelEl
    };
    return state.panelElements;
  }

  function getPanelElement(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return null;
    var elements = ensurePanelElements();
    if (elements[normalized]) {
      elements[normalized].setAttribute('data-shell-panel-instance', normalized);
      return elements[normalized];
    }
    var kind = getPanelKind(normalized);
    if (!kind || normalized === kind) return elements[kind] || null;
    var sharedPanels = getSharedPanelsApi();
    if (!sharedPanels || typeof sharedPanels.createPanelElement !== 'function') return null;
    var panelEl = sharedPanels.createPanelElement(kind, normalized);
    if (!panelEl) return null;
    panelEl.setAttribute('data-shell-panel', kind);
    panelEl.setAttribute('data-shell-panel-instance', normalized);
    elements[normalized] = panelEl;
    return panelEl;
  }

  // ── Tab overflow: fold tabs that don't fit into a dropdown ──

  var _tabOverflowObserver = null;

  /** Recalculate which tabs are visible and which overflow into the dropdown. */
  function updateTabOverflow(headerEl) {
    var tabsEl = headerEl.querySelector('.ws-view-tabs');
    var overflowBtn = headerEl.querySelector('.ws-tab-overflow-btn');
    if (!tabsEl || !overflowBtn) return;
    var tabs = tabsEl.querySelectorAll('.ws-view-tab');
    if (tabs.length === 0) { overflowBtn.classList.remove('is-visible'); return; }

    // Reset: show all tabs, hide overflow button
    for (var r = 0; r < tabs.length; r++) tabs[r].classList.remove('is-tab-overflowed');
    overflowBtn.classList.remove('is-visible');

    // Measure available width: tabs container width
    var containerWidth = tabsEl.clientWidth;
    if (containerWidth <= 0) return;

    // First check: do all tabs fit without the overflow button?
    var totalTabWidth = 0;
    for (var t = 0; t < tabs.length; t++) totalTabWidth += tabs[t].offsetWidth;
    if (totalTabWidth <= containerWidth) return; // All tabs fit, no overflow needed

    // Measure overflow button width (unhide temporarily to measure)
    overflowBtn.classList.add('is-visible');
    var btnWidth = overflowBtn.offsetWidth || 32;
    overflowBtn.classList.remove('is-visible');

    // Walk tabs left-to-right, accumulate widths, mark overflowing ones
    var usedWidth = 0;
    var overflowCount = 0;
    var activeOverflowed = false;
    for (var i = 0; i < tabs.length; i++) {
      var tabWidth = tabs[i].offsetWidth;
      // If this tab would push beyond available space (minus room for overflow btn),
      // mark it and all subsequent tabs as overflowed
      if (overflowCount > 0 || usedWidth + tabWidth > containerWidth - btnWidth) {
        tabs[i].classList.add('is-tab-overflowed');
        overflowCount++;
        if (tabs[i].classList.contains('is-active')) activeOverflowed = true;
      } else {
        usedWidth += tabWidth;
      }
    }

    // If the active tab got overflowed, swap it with the last visible tab
    if (activeOverflowed && overflowCount < tabs.length) {
      var lastVisibleIdx = tabs.length - overflowCount - 1;
      if (lastVisibleIdx >= 0) {
        tabs[lastVisibleIdx].classList.add('is-tab-overflowed');
        for (var a = 0; a < tabs.length; a++) {
          if (tabs[a].classList.contains('is-active')) {
            tabs[a].classList.remove('is-tab-overflowed');
            break;
          }
        }
      }
    }

    if (overflowCount > 0) {
      overflowBtn.classList.add('is-visible');
      var countEl = overflowBtn.querySelector('.ws-tab-overflow-count');
      if (countEl) countEl.textContent = '+' + overflowCount;
    }

    // Close any open overflow menu since the tab layout changed
    closeTabOverflowMenus();
  }

  /** Ensure a ResizeObserver is watching all .ws-view-tabs elements. */
  function ensureTabOverflowObserver() {
    if (_tabOverflowObserver) return;
    if (typeof ResizeObserver === 'undefined') return;
    var _tabOverflowRafId = 0;
    _tabOverflowObserver = new ResizeObserver(function (entries) {
      // Defer DOM mutations to the next frame to avoid triggering another
      // ResizeObserver notification within the same observation loop.
      if (_tabOverflowRafId) return;
      var headers = [];
      for (var i = 0; i < entries.length; i++) {
        var tabsEl = entries[i].target;
        var headerEl = tabsEl.closest('.ws-view-header');
        if (headerEl && headers.indexOf(headerEl) === -1) headers.push(headerEl);
      }
      _tabOverflowRafId = requestAnimationFrame(function () {
        _tabOverflowRafId = 0;
        for (var j = 0; j < headers.length; j++) updateTabOverflow(headers[j]);
      });
    });
  }

  /** Attach overflow observation to a header element. */
  function observeTabOverflow(headerEl) {
    var tabsEl = headerEl.querySelector('.ws-view-tabs');
    if (!tabsEl) return;
    ensureTabOverflowObserver();
    if (_tabOverflowObserver) _tabOverflowObserver.observe(tabsEl);
    // Initial calculation after layout settles
    requestAnimationFrame(function () { updateTabOverflow(headerEl); });
  }

  /** Close any open tab overflow menu. */
  function closeTabOverflowMenus() {
    var existing = document.querySelector('.ws-tab-overflow-menu.is-open');
    if (existing) {
      existing.classList.remove('is-open');
      if (existing.parentNode) existing.parentNode.removeChild(existing);
    }
  }

  /** Toggle the overflow dropdown for a given header. */
  function toggleTabOverflowMenu(headerEl) {
    var existing = document.querySelector('.ws-tab-overflow-menu.is-open');
    if (existing) {
      // If this menu belongs to the same header, just close it
      var sameHeader = existing._wsOverflowHeaderEl === headerEl;
      existing.classList.remove('is-open');
      if (existing.parentNode) existing.parentNode.removeChild(existing);
      if (sameHeader) return;
    }

    // Build the menu and position it on the body
    var tabs = headerEl.querySelectorAll('.ws-view-tab.is-tab-overflowed');
    if (tabs.length === 0) return;

    var menu = document.createElement('div');
    menu.className = 'ws-tab-overflow-menu is-open';
    menu._wsOverflowHeaderEl = headerEl;

    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      var labelEl = tab.querySelector('.ws-view-tab-label');
      var label = labelEl ? labelEl.textContent : '';
      var isActive = tab.classList.contains('is-active');

      var item = document.createElement('button');
      item.className = 'ws-tab-overflow-menu-item' + (isActive ? ' is-active' : '');
      item.type = 'button';

      var tabId = tab.getAttribute('data-ws-tab-id');
      var panelId = tab.getAttribute('data-ws-panel-id');
      if (tabId) item.setAttribute('data-ws-tab-id', tabId);
      if (panelId) {
        item.setAttribute('data-ws-panel-id', panelId);
        item.setAttribute('data-ws-action', 'activate-panel');
      }

      var itemLabel = document.createElement('span');
      itemLabel.className = 'ws-tab-overflow-menu-item-label';
      itemLabel.textContent = label;
      item.appendChild(itemLabel);

      var closeBtn = document.createElement('button');
      closeBtn.className = 'ws-tab-overflow-menu-item-close';
      closeBtn.type = 'button';
      closeBtn.title = 'Close';
      closeBtn.textContent = '\u00d7';
      var origClose = tab.querySelector('.ws-view-tab-close');
      if (origClose) {
        var closeAction = origClose.getAttribute('data-ws-action') || 'close-tab';
        closeBtn.setAttribute('data-ws-action', closeAction);
        if (tabId) closeBtn.setAttribute('data-ws-tab-id', tabId);
        if (panelId) closeBtn.setAttribute('data-ws-panel-id', panelId);
      }
      item.appendChild(closeBtn);
      menu.appendChild(item);
    }

    // Handle clicks within the menu (since it's on the body, not inside the workspace root)
    menu.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      // Close button within a menu item
      var closeEl = e.target.closest('.ws-tab-overflow-menu-item-close');
      if (closeEl) {
        var ca = closeEl.getAttribute('data-ws-action');
        if (ca === 'close-tab') {
          closeTab(closeEl.getAttribute('data-ws-tab-id'));
        } else if (ca === 'close-panel') {
          var dh = headerEl.closest('[data-dock]');
          handleToolbarAction(ca, closeEl.getAttribute('data-ws-panel-id') || '', {
            panelId: closeEl.getAttribute('data-ws-panel-id') || '',
            dockId: dh ? dh.getAttribute('data-dock') || '' : ''
          });
        }
        closeTabOverflowMenus();
        return;
      }

      // Menu item click (activate tab/panel)
      var itemEl = e.target.closest('.ws-tab-overflow-menu-item');
      if (itemEl) {
        var ia = itemEl.getAttribute('data-ws-action');
        var ip = itemEl.getAttribute('data-ws-panel-id');
        var it = itemEl.getAttribute('data-ws-tab-id');
        if (ia && ip) {
          var dh2 = headerEl.closest('[data-dock]');
          handleToolbarAction(ia, ip, {
            panelId: ip,
            dockId: dh2 ? dh2.getAttribute('data-dock') || '' : ''
          });
        } else if (it) {
          activateTab(it);
        }
        closeTabOverflowMenus();
      }
    });

    // Position the menu relative to the overflow button
    var btn = headerEl.querySelector('.ws-tab-overflow-btn');
    if (btn) {
      var rect = btn.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.top = rect.bottom + 2 + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      menu.style.left = 'auto';
    }

    document.body.appendChild(menu);

    // Close menu when clicking outside
    var _closeOnOutsideClick = function (evt) {
      if (!menu.contains(evt.target) && evt.target !== btn && !btn.contains(evt.target)) {
        closeTabOverflowMenus();
        document.removeEventListener('pointerdown', _closeOnOutsideClick, true);
      }
    };
    // Delay to avoid catching the current click
    requestAnimationFrame(function () {
      document.addEventListener('pointerdown', _closeOnOutsideClick, true);
    });
  }

  // ── Unified view header for both board tabsets and panel dock groups ──
  // opts.items: [{ id, label, meta? }]
  // opts.activeId: current active item id
  // opts.dragAttr: { name, value } — data attribute on drag handle
  // opts.closeAction: 'close-tab' | 'close-panel'
  // opts.closeIdAttr: 'data-ws-tab-id' | 'data-ws-panel-id'
  // opts.tabClickAttr: attr name set on each tab element (e.g. 'data-ws-tab-id')
  // opts.activateAction: data-ws-action value for tab click (null = use tabClickAttr click)
  // opts.extraTabAttrs: function(item) → {} | null
  // opts.showMeta: show meta label on tabs
  function renderViewHeader(opts) {
    var el = document.createElement('div');
    el.className = 'ws-view-header';
    var isSingle = opts.items.length <= 1;
    if (isSingle) el.classList.add('is-single');

    // Drag handle
    var drag = document.createElement('button');
    drag.className = 'ws-view-drag';
    drag.type = 'button';
    drag.title = 'Drag view';
    if (opts.dragAttr) drag.setAttribute(opts.dragAttr.name, opts.dragAttr.value);
    drag.innerHTML = '&#8942;&#8942;';
    el.appendChild(drag);

    if (isSingle && opts.items.length === 1) {
      // Single item: show title
      var title = document.createElement('span');
      title.className = 'ws-view-title';
      title.textContent = opts.items[0].label;
      el.appendChild(title);
    }

    if (!isSingle) {
      // Multiple items: show tabs
      var tabs = document.createElement('div');
      tabs.className = 'ws-view-tabs';
      for (var i = 0; i < opts.items.length; i++) {
        var item = opts.items[i];
        var tab = document.createElement('div');
        tab.className = 'ws-view-tab';
        if (opts.tabClickAttr) tab.setAttribute(opts.tabClickAttr, item.id);
        if (opts.activateAction) tab.setAttribute('data-ws-action', opts.activateAction);
        if (opts.extraTabAttrs) {
          var extras = opts.extraTabAttrs(item);
          for (var k in extras) {
            if (extras.hasOwnProperty(k)) tab.setAttribute(k, extras[k]);
          }
        }
        if (item.id === opts.activeId) tab.classList.add('is-active');
        if (item.isSelected) tab.classList.add('is-selected');

        tab.innerHTML =
          '<span class="ws-view-tab-label">' + escapeHtml(item.label) + '</span>' +
          (opts.showMeta && item.meta ? '<span class="ws-view-tab-meta">' + escapeHtml(item.meta) + '</span>' : '') +
          '<button class="ws-view-tab-close" type="button" data-ws-action="' + escapeHtml(opts.closeAction) + '" ' +
            escapeHtml(opts.closeIdAttr) + '="' + escapeHtml(item.id) + '" title="Close">\u00d7</button>';
        tabs.appendChild(tab);
      }
      el.appendChild(tabs);

      // Overflow button (shown when tabs don't fit)
      var overflowBtn = document.createElement('button');
      overflowBtn.className = 'ws-tab-overflow-btn';
      overflowBtn.type = 'button';
      overflowBtn.title = 'More tabs';
      overflowBtn.innerHTML = '<span class="ws-tab-overflow-count"></span>\u25BE';
      overflowBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleTabOverflowMenu(el);
      });
      el.appendChild(overflowBtn);

      // Observe for overflow after appending to DOM
      observeTabOverflow(el);
    }

    // Fold button for panel views
    if (opts.foldNodeId) {
      var fold = document.createElement('button');
      fold.className = 'ws-view-fold';
      fold.type = 'button';
      fold.title = opts.isFolded ? 'Expand' : 'Collapse';
      fold.setAttribute('data-ws-action', 'fold-pane');
      fold.setAttribute('data-ws-value', opts.foldNodeId);
      if (opts.isFolded) {
        fold.classList.add('is-folded');
      }
      fold.textContent = '\u25BE'; // ▾
      el.appendChild(fold);
    }

    // Header-level close button (always visible; closes the active tab/panel)
    var close = document.createElement('button');
    close.className = 'ws-view-close';
    close.type = 'button';
    close.title = 'Close';
    close.setAttribute('data-ws-action', opts.closeAction);
    close.setAttribute(opts.closeIdAttr, opts.items.length > 0 ? opts.activeId : '');
    close.textContent = '\u00d7';
    el.appendChild(close);

    return el;
  }

  function renderSideDockTabset(node, parentEl, dockId) {
    var tabsetEl = document.createElement('div');
    tabsetEl.className = 'workspace-shell-tabset workspace-shell-node workspace-shell-panel-window';
    tabsetEl.setAttribute('data-node-id', node.id);
    // Determine active panel for this tabset
    var activeTab = null;
    for (var i = 0; i < node.tabs.length; i++) {
      if (node.tabs[i].id === node.activeTabId) { activeTab = node.tabs[i]; break; }
    }
    if (!activeTab && node.tabs.length > 0) activeTab = node.tabs[0];
    var activePanelId = activeTab && isPanelTab(activeTab) ? resolvePanelTarget(activeTab.panelId) : '';
    if (activePanelId) tabsetEl.setAttribute('data-panel-id', activePanelId);
    if (node.tabs.length === 1) tabsetEl.classList.add('workspace-shell-panel-window-integrated');
    // Check if any tab in this tabset contains the global activePanelId
    var containsActive = false;
    for (var a = 0; a < node.tabs.length; a++) {
      if (isPanelTab(node.tabs[a]) && resolvePanelTarget(node.tabs[a].panelId) === state.activePanelId) {
        containsActive = true;
        break;
      }
    }
    if (containsActive) tabsetEl.classList.add('is-active');

    var headerItems = [];
    for (var h = 0; h < node.tabs.length; h++) {
      var tab = node.tabs[h];
      var tabPanelId = isPanelTab(tab) ? resolvePanelTarget(tab.panelId) : '';
      headerItems.push({
        id: tabPanelId || tab.id,
        label: isPanelTab(tab) ? getPanelTitle(tab.panelId) : getTabTitle(tab),
        isSelected: tabPanelId === state.activePanelId
      });
    }
    var activeItemId = activePanelId || (activeTab ? activeTab.id : '');
    var headerEl = renderViewHeader({
      items: headerItems,
      activeId: activeItemId,
      dragAttr: { name: 'data-ws-panel-drag-handle', value: activeItemId },
      closeAction: 'close-panel',
      closeIdAttr: 'data-ws-panel-id',
      tabClickAttr: 'data-ws-panel-id',
      activateAction: 'activate-panel',
      extraTabAttrs: null,
      showMeta: false,
      foldNodeId: node.id,
      isFolded: !!state.foldedPanes[node.id]
    });
    tabsetEl.appendChild(headerEl);

    var contentEl = document.createElement('div');
    contentEl.className = 'workspace-shell-panel-content';
    for (var ci = 0; ci < node.tabs.length; ci++) {
      var panelTab = node.tabs[ci];
      if (!isPanelTab(panelTab)) continue;
      var panelId = resolvePanelTarget(panelTab.panelId);
      if (!panelId) continue;
      if (!state.panelVisibility[panelId]) continue;
      if (isPanelIntegrated(panelId)) continue;
      var panelEl = getPanelElement(panelId);
      if (panelEl) {
        panelEl.classList.remove('hidden');
        if (panelTab.id === node.activeTabId) {
          panelEl.style.display = '';
        } else {
          panelEl.style.display = 'none';
        }
        contentEl.appendChild(panelEl);
      }
    }
    tabsetEl.appendChild(contentEl);

    // Move logs status bar into ws-view-header so it's visible when folded
    if (activePanelId && getPanelKind(activePanelId) === 'logs') {
      moveLogsStatusToHeader(activePanelId, headerEl);
    }

    var overlayEl = document.createElement('div');
    overlayEl.className = 'workspace-shell-drop-overlay';
    overlayEl.innerHTML = buildDropOverlayHtml(node.id);
    contentEl.appendChild(overlayEl);

    parentEl.appendChild(tabsetEl);
  }

  function renderSideDockSplit(node, parentEl, dockId) {
    renderSplitLayout(node, parentEl, function (child, pane) {
      renderSideDockNode(child, pane, dockId);
    });
  }

  function renderSideDockNode(node, parentEl, dockId) {
    if (!node) return;
    if (node.type === 'split') renderSideDockSplit(node, parentEl, dockId);
    else renderSideDockTabset(node, parentEl, dockId);
  }

  function renderSideDock(dockId, hostEl) {
    if (!hostEl) return;
    // Remove tree content but preserve fold strip
    var children = hostEl.children;
    for (var i = children.length - 1; i >= 0; i--) {
      if (!children[i].classList.contains('ws-fold-strip')) {
        hostEl.removeChild(children[i]);
      }
    }
    var tree = state.sideDocks[dockId];
    hostEl.setAttribute('data-dock', dockId);
    if (!tree || countTreeTabs(tree) === 0) {
      hostEl.classList.add('is-hidden');
      hostEl.classList.remove('is-visible', 'is-folded', 'is-fold-hover');
      return;
    }
    renderSideDockNode(tree, hostEl, dockId);
  }

  function renderPanelDocks() {
    ensurePanelDockActives();
    if (isPanelOnlyWindow()) {
      if (state.leftDockEl) state.leftDockEl.innerHTML = '';
      if (state.rightDockEl) state.rightDockEl.innerHTML = '';
      if (state.bottomDockEl) state.bottomDockEl.innerHTML = '';
      applyDockLayout();
      return;
    }
    renderSideDock('left', state.leftDockEl);
    renderSideDock('right', state.rightDockEl);
    renderSideDock('bottom', state.bottomDockEl);
    applyDockLayout();
  }

  function getWorkspaceBoundsRect() {
    if (state.rootEl && typeof state.rootEl.getBoundingClientRect === 'function') {
      return state.rootEl.getBoundingClientRect();
    }
    return {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight
    };
  }

  function isPointOutsideWorkspaceBounds(x, y, threshold) {
    var margin = typeof threshold === 'number' && isFinite(threshold) ? Math.max(0, threshold) : 0;
    var rect = getWorkspaceBoundsRect();
    return x < rect.left - margin ||
      y < rect.top - margin ||
      x > rect.right + margin ||
      y > rect.bottom + margin;
  }

  function clearPanelDropTargets() {
    state.dragHoverDock = '';
    if (!state.panelDropOverlayEl) return;
    var zones = state.panelDropOverlayEl.querySelectorAll('.workspace-shell-panel-drop-zone.is-active');
    for (var i = 0; i < zones.length; i++) {
      zones[i].classList.remove('is-active');
    }
    clearDropZones();
  }

  function setPanelDropTarget(dockId) {
    clearPanelDropTargets();
    if (!dockId || !state.panelDropOverlayEl) return;
    state.dragHoverDock = dockId;
    var zone = state.panelDropOverlayEl.querySelector('.workspace-shell-panel-drop-zone[data-ws-panel-drop-dock="' + dockId + '"]');
    if (zone) zone.classList.add('is-active');
  }

  function placePanelInLeaf(panelId, leafId) {
    var normalized = resolvePanelTarget(panelId);
    var leafFound = findLeafInAllTrees(leafId);
    if (!normalized || !leafFound) return false;
    removePanelFromDocks(normalized);
    var existing = findPanelInAllTrees(normalized);
    if (existing && existing.tab) {
      return moveTabToLeaf(existing.tab.id, leafId);
    }
    var newTab = createPanelTab(normalized);
    leafFound.leaf.tabs.push(newTab);
    leafFound.leaf.activeTabId = newTab.id;
    if (leafFound.treeId === 'center') state.activeLeafId = leafFound.leaf.id;
    state.panelVisibility[normalized] = true;
    state.activePanelId = normalized;
    render();
    return true;
  }

  function splitLeafWithPanel(targetLeafId, zone, panelId) {
    var normalized = resolvePanelTarget(panelId);
    var targetFound = findLeafInAllTrees(targetLeafId);
    if (!normalized || !targetFound) return false;
    var targetLeaf = targetFound.leaf;
    var existing = findPanelInAllTrees(normalized);
    var movingWithinSameLeaf = existing && existing.leaf.id === targetLeafId;
    var shouldDuplicateSingleTab = movingWithinSameLeaf && existing.leaf.tabs.length === 1;
    var tabForNewLeaf = null;
    if (shouldDuplicateSingleTab) {
      var panelKind = getPanelKind(normalized);
      if (!isPanelKindDuplicable(panelKind)) return false;
      var duplicatedPanelId = createPanelInstance(panelKind);
      state.panelVisibility[duplicatedPanelId] = true;
      tabForNewLeaf = createPanelTab(duplicatedPanelId);
      normalized = duplicatedPanelId;
    } else if (existing && existing.tab) {
      var extracted = extractTab(existing.tab.id);
      if (!extracted) return false;
      tabForNewLeaf = extracted.tab;
    } else {
      removePanelFromDocks(normalized);
      tabForNewLeaf = createPanelTab(normalized);
    }
    var newLeaf = createTabsetNode([tabForNewLeaf]);
    var axis = (zone === 'top' || zone === 'bottom') ? 'horizontal' : 'vertical';
    var split = (zone === 'left' || zone === 'top')
      ? createSplitNode(axis, newLeaf, targetLeaf, 0.5)
      : createSplitNode(axis, targetLeaf, newLeaf, 0.5);
    replaceNodeById(targetLeafId, split);
    if (targetFound.treeId === 'center') state.activeLeafId = newLeaf.id;
    state.panelVisibility[normalized] = true;
    state.activePanelId = normalized;
    // Normalize all trees
    normalizeAllTrees();
    render();
    return true;
  }

  function removePanelFromCurrentWindow(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;
    var kind = getPanelKind(normalized);
    if (!kind) return false;
    var found = findPanelInAllTrees(normalized);
    if (found && found.treeId === 'center' && found.tab) {
      return closeTab(found.tab.id);
    }
    if (normalized !== kind) {
      removePanelFromDocks(normalized);
      return closePanelView(normalized);
    }
    state.panelVisibility[normalized] = false;
    var defaultDock = (PANEL_DEFINITIONS[kind] && PANEL_DEFINITIONS[kind].defaultDock) || 'left';
    var foundDockId = getDockForPanel(normalized) || '';
    removePanelFromDocks(normalized);
    var targetDock = foundDockId || defaultDock;
    // Re-add as hidden tab so it can be restored later
    var alreadyInDock = state.sideDocks[targetDock] && findLeafContainingPanel(state.sideDocks[targetDock], normalized);
    if (!alreadyInDock) {
      addTabToDock(targetDock, createPanelTab(normalized), { method: 'unshift', activate: false });
    }
    ensurePanelDockActives();
    render();
    return true;
  }

  function detachPanelView(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return Promise.resolve(false);
    var kind = getPanelKind(normalized);
    if (!kind) return Promise.resolve(false);
    var panelRect = getPanelWindowRect(normalized);
    return openWindow({
      profile: 'detachedBoard',
      initialPanel: kind,
      windowRole: kind === 'hierarchy' ? 'hierarchyLauncher' : null,
      width: panelRect ? Math.max(360, Math.round(panelRect.width)) : null,
      height: panelRect ? Math.max(220, Math.round(panelRect.height)) : null
    }).then(function () {
      removePanelFromCurrentWindow(normalized);
      return true;
    }).catch(function () {
      return false;
    });
  }

  function dockToMainWindow() {
    if (!isPanelOnlyWindow() || !state.panelOnlyKind) return;
    var kind = state.panelOnlyKind;
    tauriEmitAll('menu-action', 'reveal-panel:' + kind).then(function () {
      closeCurrentWindow();
    }).catch(function () {
      // Fallback: store intent in localStorage and close
      try { localStorage.setItem('lexera-dock-panel', kind); } catch (_) {}
      closeCurrentWindow();
    });
  }

  function setTabViewKind(tabId, viewKind, options) {
    var found = findTab(state.dockTree, tabId);
    if (!found || !found.tab) return false;
    if (isPanelTab(found.tab)) return false;
    var normalized = normalizeViewKind(viewKind);
    if (found.tab.viewKind === normalized) return true;
    found.tab.viewKind = normalized;
    found.leaf.activeTabId = tabId;
    if (!options || options.activate !== false) state.activeLeafId = found.leaf.id;
    var frame = getOrCreateFrame(found.tab);
    frame.setAttribute('data-src', '');
    render();
    return true;
  }

  function setActiveViewKind(viewKind) {
    var activeTab = getActiveTab();
    if (!activeTab) return false;
    return setTabViewKind(activeTab.id, viewKind, { activate: true });
  }

  function getDropZoneForEvent(tabsetEl, event) {
    var rect = tabsetEl.getBoundingClientRect();
    var x = event.clientX;
    var y = event.clientY;
    var edgeX = Math.min(80, rect.width * 0.24);
    var edgeY = Math.min(80, rect.height * 0.24);
    if (x <= rect.left + edgeX) return 'left';
    if (x >= rect.right - edgeX) return 'right';
    if (y <= rect.top + edgeY) return 'top';
    if (y >= rect.bottom - edgeY) return 'bottom';
    return 'center';
  }

  function clearDropZones() {
    var containers = [state.dockEl, state.leftDockEl, state.rightDockEl, state.bottomDockEl];
    for (var c = 0; c < containers.length; c++) {
      if (!containers[c]) continue;
      var nodes = containers[c].querySelectorAll('.workspace-shell-tabset[data-drop-zone]');
      for (var i = 0; i < nodes.length; i++) nodes[i].removeAttribute('data-drop-zone');
      var zones = containers[c].querySelectorAll('.workspace-shell-drop-zone.is-active');
      for (var j = 0; j < zones.length; j++) zones[j].classList.remove('is-active');
    }
    state.dragHoverLeafId = '';
    state.dragHoverZone = '';
    clearTabInsertIndicator();
  }

  // ── Tab reorder within tabset ──

  function getTabInsertIndex(tabsEl, clientX) {
    var children = tabsEl.children;
    var tabs = [];
    for (var j = 0; j < children.length; j++) {
      if (!children[j].classList.contains('ws-tab-insert-marker')) tabs.push(children[j]);
    }
    if (!tabs.length) return 0;
    for (var i = 0; i < tabs.length; i++) {
      var rect = tabs[i].getBoundingClientRect();
      var mid = rect.left + rect.width / 2;
      if (clientX < mid) return i;
    }
    return tabs.length;
  }

  function setTabInsertIndicator(tabsEl, index) {
    clearTabInsertIndicator();
    if (!tabsEl || index < 0) return;
    state.dragHoverTabIndex = index;
    var marker = document.createElement('div');
    marker.className = 'ws-tab-insert-marker';
    // Collect real tab children (excluding markers)
    var children = tabsEl.children;
    var tabs = [];
    for (var j = 0; j < children.length; j++) {
      if (!children[j].classList.contains('ws-tab-insert-marker')) tabs.push(children[j]);
    }
    if (index < tabs.length) {
      tabsEl.insertBefore(marker, tabs[index]);
    } else {
      tabsEl.appendChild(marker);
    }
  }

  function clearTabInsertIndicator() {
    state.dragHoverTabIndex = -1;
    var markers = document.querySelectorAll('.ws-tab-insert-marker');
    for (var i = 0; i < markers.length; i++) {
      markers[i].parentNode.removeChild(markers[i]);
    }
  }

  function reorderTabInLeaf(tabId, leafId, targetIndex) {
    var found = findTabInAllTrees(tabId);
    if (!found || found.leaf.id !== leafId) return false;
    var currentIndex = found.index;
    if (currentIndex === targetIndex || currentIndex + 1 === targetIndex) return false; // no-op
    var tab = found.leaf.tabs.splice(currentIndex, 1)[0];
    var insertAt = targetIndex > currentIndex ? targetIndex - 1 : targetIndex;
    found.leaf.tabs.splice(insertAt, 0, tab);
    render();
    return true;
  }

  function moveTabToLeafAtIndex(tabId, targetLeafId, targetIndex) {
    var extracted = extractTab(tabId);
    if (!extracted) return false;
    var found = findLeafInAllTrees(targetLeafId);
    if (!found) {
      insertTabIntoLeaf(extracted.tab, extracted.sourceLeafId);
      return false;
    }
    var idx = Math.max(0, Math.min(targetIndex, found.leaf.tabs.length));
    found.leaf.tabs.splice(idx, 0, extracted.tab);
    found.leaf.activeTabId = extracted.tab.id;
    if (found.treeId === 'center') state.activeLeafId = found.leaf.id;
    normalizeAllTrees();
    ensureActiveLeaf();
    render();
    return true;
  }

  function setTabDragModeEnabled(enabled) {
    getBody().classList.toggle('workspace-shell-tab-dragging', !!enabled);
  }

  function createTabDragGhost(tabId) {
    var found = findTabInAllTrees(tabId);
    if (!found) return null;
    var ghost = document.createElement('div');
    ghost.className = 'workspace-shell-tab-ghost';
    ghost.textContent = getTabTitle(found.tab);
    document.body.appendChild(ghost);
    return ghost;
  }

  function positionTabDragGhost(ghost, x, y) {
    if (!ghost) return;
    ghost.style.left = Math.round(x) + 'px';
    ghost.style.top = Math.round(y) + 'px';
  }

  function destroyTabDragGhost(ghost) {
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
  }

  function setDropZoneHighlight(leafId, zone) {
    clearDropZones();
    if (!leafId || !zone) return;
    state.dragHoverLeafId = leafId;
    state.dragHoverZone = zone;
    var containers = [state.dockEl, state.leftDockEl, state.rightDockEl, state.bottomDockEl];
    for (var c = 0; c < containers.length; c++) {
      if (!containers[c]) continue;
      var tabsetEl = containers[c].querySelector('.workspace-shell-tabset[data-node-id="' + leafId + '"]');
      if (tabsetEl) { tabsetEl.setAttribute('data-drop-zone', zone); break; }
    }
    for (var d = 0; d < containers.length; d++) {
      if (!containers[d]) continue;
      var zoneEl = containers[d].querySelector('.workspace-shell-drop-zone[data-ws-drop-leaf="' + leafId + '"][data-zone="' + zone + '"]');
      if (zoneEl) { zoneEl.classList.add('is-active'); break; }
    }
  }

  function handleTabPointerMove(event) {
    var drag = state.pointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (isPointOutsideWorkspaceBounds(event.clientX, event.clientY, 40)) {
      drag.detachArmed = true;
    }
    state.dragLastX = event.clientX;
    state.dragLastY = event.clientY;

    if (!drag.started) {
      var dx = event.clientX - drag.startX;
      var dy = event.clientY - drag.startY;
      if ((dx * dx) + (dy * dy) < 36) return;
      drag.started = true;
      state.dragTabId = drag.tabId || '';
      state.dragPanelId = drag.panelId || '';
      state.dragDroppedInternally = false;
      if (drag.tabId) {
        drag.ghost = createTabDragGhost(drag.tabId);
      } else if (drag.panelId) {
        // Create ghost for panel-only drag
        var ghost = document.createElement('div');
        ghost.className = 'workspace-shell-tab-ghost';
        ghost.textContent = getPanelTitle(drag.panelId);
        document.body.appendChild(ghost);
        drag.ghost = ghost;
      }
      setTabDragModeEnabled(true);
    }

    positionTabDragGhost(drag.ghost, event.clientX, event.clientY);

    var target = document.elementFromPoint(event.clientX, event.clientY);

    // Tab bar reorder detection: if pointer is over tab area, show insert marker
    var headerEl = target ? target.closest('.ws-view-header') : null;
    if (headerEl) {
      var headerTabsetEl = headerEl.closest('.workspace-shell-tabset');
      if (headerTabsetEl) {
        var leafId = headerTabsetEl.getAttribute('data-node-id');
        // Multi-tab header: reorder within tab bar
        if (!headerEl.classList.contains('is-single')) {
          var tabsEl = headerEl.querySelector('.ws-view-tabs');
          if (tabsEl && leafId) {
            clearPanelDropTargets();
            clearDropZones();
            var insertIdx = getTabInsertIndex(tabsEl, event.clientX);
            setTabInsertIndicator(tabsEl, insertIdx);
            state.dragHoverLeafId = leafId;
            state.dragHoverZone = 'tab-reorder';
            return;
          }
        }
        // Single-tab header: treat as center drop (merge into tabset)
        if (leafId) {
          clearPanelDropTargets();
          clearTabInsertIndicator();
          setDropZoneHighlight(leafId, 'center');
          return;
        }
      }
    }

    var zoneEl = target ? target.closest('[data-ws-drop-zone][data-ws-drop-leaf]') : null;
    var tabsetEl = target ? target.closest('.workspace-shell-tabset') : null;
    if (zoneEl) {
      clearPanelDropTargets();
      setDropZoneHighlight(zoneEl.getAttribute('data-ws-drop-leaf'), zoneEl.getAttribute('data-ws-drop-zone'));
      return;
    }
    if (tabsetEl) {
      clearPanelDropTargets();
      setDropZoneHighlight(tabsetEl.getAttribute('data-node-id'), getDropZoneForEvent(tabsetEl, event));
      return;
    }
    // Check for dock-level panel drop zones
    var dockZoneEl = target ? target.closest('[data-ws-panel-drop-dock]') : null;
    if (dockZoneEl) {
      setPanelDropTarget(dockZoneEl.getAttribute('data-ws-panel-drop-dock'));
      return;
    }
    clearPanelDropTargets();
    clearDropZones();
  }

  function finishTabPointerDrag(event) {
    var drag = state.pointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    window.removeEventListener('pointermove', handleTabPointerMove, true);
    window.removeEventListener('pointerup', finishTabPointerDrag, true);
    window.removeEventListener('pointercancel', finishTabPointerDrag, true);

    if (drag.sourceEl && typeof drag.sourceEl.releasePointerCapture === 'function') {
      try { drag.sourceEl.releasePointerCapture(event.pointerId); } catch (_) { /* ignore */ }
    }

    destroyTabDragGhost(drag.ghost);
    setTabDragModeEnabled(false);

    if (!drag.started) {
      state.pointerDrag = null;
      state.dragTabId = '';
      state.dragPanelId = '';
      clearDropZones();
      if (drag.panelId) activatePanel(drag.panelId);
      else if (drag.tabId) activateTab(drag.tabId);
      return;
    }

    var tabId = drag.tabId;
    var panelId = drag.panelId || '';
    var x = drag.lastX;
    var y = drag.lastY;
    var leafId = state.dragHoverLeafId;
    var zone = state.dragHoverZone;
    var dockId = state.dragHoverDock || '';

    clearDropZones();
    clearPanelDropTargets();
    state.pointerDrag = null;
    state.dragTabId = '';
    state.dragPanelId = '';

    // Dock-level drop for panel drags
    if (dockId && panelId) {
      movePanelToDock(panelId, dockId);
      activatePanel(panelId);
      state.dragDroppedInternally = false;
      return;
    }

    if (leafId && zone) {
      state.dragDroppedInternally = true;
      var dropTabIndex = state.dragHoverTabIndex;
      clearTabInsertIndicator();

      if (zone === 'tab-reorder' && dropTabIndex >= 0) {
        // Tab reorder: same leaf = reorder, different leaf = move at index
        var effectiveTabId = tabId;
        if (!effectiveTabId && panelId) {
          var panelInfo = findPanelInAllTrees(panelId);
          if (panelInfo) effectiveTabId = panelInfo.tab.id;
        }
        if (effectiveTabId) {
          var tabInfo = findTabInAllTrees(effectiveTabId);
          if (tabInfo && tabInfo.leaf.id === leafId) {
            reorderTabInLeaf(effectiveTabId, leafId, dropTabIndex);
          } else {
            moveTabToLeafAtIndex(effectiveTabId, leafId, dropTabIndex);
          }
        }
      } else if (panelId && !tabId) {
        // Panel drag onto a leaf
        if (zone === 'center') placePanelInLeaf(panelId, leafId);
        else splitLeafWithPanel(leafId, zone, panelId);
      } else if (tabId) {
        if (zone === 'center') moveTabToLeaf(tabId, leafId);
        else splitLeafWithTab(leafId, zone, tabId);
      }
      state.dragDroppedInternally = false;
      return;
    }

    var outsideWindow = drag.detachArmed && isPointOutsideWorkspaceBounds(x, y, 20);
    if (outsideWindow) {
      if (panelId && !tabId) detachPanelView(panelId);
      else if (tabId) detachTab(tabId);
    }
    state.dragDroppedInternally = false;
  }

  function startPointerDrag(sourceEl, tabId, panelId, event) {
    state.pointerDrag = {
      tabId: tabId,
      panelId: panelId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      detachArmed: false,
      started: false,
      sourceEl: sourceEl,
      ghost: null
    };
    if (typeof sourceEl.setPointerCapture === 'function') {
      try { sourceEl.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
    }
    window.addEventListener('pointermove', handleTabPointerMove, true);
    window.addEventListener('pointerup', finishTabPointerDrag, true);
    window.addEventListener('pointercancel', finishTabPointerDrag, true);
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    // Panel drag handle: find the panel's tab in side dock tree, start unified drag
    var panelHandleEl = event.target.closest('[data-ws-panel-drag-handle]');
    if (panelHandleEl) {
      event.preventDefault();
      var handledPanelId = resolvePanelTarget(panelHandleEl.getAttribute('data-ws-panel-drag-handle'));
      if (!handledPanelId) return;
      state.activePanelId = handledPanelId;
      // Find the tab for this panel in any tree
      var panelFound = findPanelInAllTrees(handledPanelId);
      var dragTabId = panelFound ? panelFound.tab.id : '';
      startPointerDrag(panelHandleEl, dragTabId, handledPanelId, event);
      renderToolbar();
      persistState();
      return;
    }
    // Panel tab click in side dock: start unified drag (but not on close buttons)
    var panelTabEl = event.target.closest('.ws-view-tab[data-ws-panel-id]');
    if (panelTabEl && !event.target.closest('[data-ws-action="close-panel"]')) {
      event.preventDefault();
      var panelId = panelTabEl.getAttribute('data-ws-panel-id');
      if (!panelId) return;
      state.activePanelId = panelId;
      var panelFound2 = findPanelInAllTrees(panelId);
      var dragTabId2 = panelFound2 ? panelFound2.tab.id : '';
      startPointerDrag(panelTabEl, dragTabId2, panelId, event);
      renderToolbar();
      persistState();
      return;
    }
    var panelWindowEl = event.target.closest('.workspace-shell-panel-window[data-panel-id]');
    if (panelWindowEl) {
      var windowPanelId = resolvePanelTarget(panelWindowEl.getAttribute('data-panel-id'));
      if (windowPanelId) {
        state.activePanelId = windowPanelId;
        renderToolbar();
        persistState();
      }
    }
    var tabEl = event.target.closest('.ws-view-tab[data-ws-tab-id]') ||
                event.target.closest('.ws-view-drag[data-ws-tab-id]');
    if (tabEl && !event.target.closest('[data-ws-action="close-tab"]')) {
      event.preventDefault();
      var tabId = tabEl.getAttribute('data-ws-tab-id');
      if (!tabId) return;
      var ownerTabset = tabEl.closest('.workspace-shell-tabset');
      if (ownerTabset) {
        state.activeLeafId = ownerTabset.getAttribute('data-node-id') || state.activeLeafId;
        notifyActiveBoardChanged();
        renderToolbar();
        persistState();
      }
      startPointerDrag(tabEl, tabId, '', event);
      return;
    }
    var tabset = event.target.closest('.workspace-shell-tabset');
    if (!tabset) return;
    var nodeId = tabset.getAttribute('data-node-id');
    if (!nodeId) return;
    state.activeLeafId = nodeId;
    notifyActiveBoardChanged();
    renderToolbar();
    persistState();
  }

  function bindSplitDivider(dividerEl, splitId, axis) {
    dividerEl.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      var found = null;
      var ids = allTreeIds();
      for (var t = 0; t < ids.length; t++) {
        var root = getTreeRoot(ids[t]);
        if (!root) continue;
        found = findNodeAndParent(root, splitId);
        if (found) break;
      }
      if (!found || !found.node || found.node.type !== 'split') return;
      var splitNode = found.node;
      // Clear folded state on children when user drags the divider
      if (splitNode.first && state.foldedPanes[splitNode.first.id]) delete state.foldedPanes[splitNode.first.id];
      if (splitNode.second && state.foldedPanes[splitNode.second.id]) delete state.foldedPanes[splitNode.second.id];
      var container = dividerEl.parentElement;
      if (!container) return;
      function applySplitContainerLayout() {
        var firstWeight = Math.round(splitNode.ratio * 1000);
        var secondWeight = 1000 - firstWeight;
        if (axis === 'vertical') {
          container.style.gridTemplateColumns = firstWeight + 'fr 1px ' + secondWeight + 'fr';
          container.style.gridTemplateRows = '1fr';
        } else {
          container.style.gridTemplateRows = firstWeight + 'fr 1px ' + secondWeight + 'fr';
          container.style.gridTemplateColumns = '1fr';
        }
      }
      dividerEl.setPointerCapture(event.pointerId);
      dividerEl.classList.add('is-dragging');
      function handleMove(moveEvent) {
        var rect = container.getBoundingClientRect();
        if (axis === 'vertical') {
          splitNode.ratio = Math.max(0.18, Math.min(0.82, (moveEvent.clientX - rect.left) / Math.max(1, rect.width)));
        } else {
          splitNode.ratio = Math.max(0.18, Math.min(0.82, (moveEvent.clientY - rect.top) / Math.max(1, rect.height)));
        }
        applySplitContainerLayout();
      }
      function handleUp(upEvent) {
        dividerEl.classList.remove('is-dragging');
        dividerEl.removeEventListener('pointermove', handleMove);
        dividerEl.removeEventListener('pointerup', handleUp);
        dividerEl.removeEventListener('pointercancel', handleUp);
        try { dividerEl.releasePointerCapture(upEvent.pointerId); } catch (_) { /* ignore */ }
        render();
      }
      dividerEl.addEventListener('pointermove', handleMove);
      dividerEl.addEventListener('pointerup', handleUp);
      dividerEl.addEventListener('pointercancel', handleUp);
    });
  }

  function renderToolbar() {
    if (!state.toolbarEl) return;
    state.toolbarEl.innerHTML = '';
    state.toolbarEl.classList.add('is-empty');
  }

  function renderTabset(node, parentEl) {
    var tabsetEl = document.createElement('div');
    tabsetEl.className = 'workspace-shell-tabset workspace-shell-node';
    tabsetEl.setAttribute('data-node-id', node.id);
    if (node.id === state.activeLeafId) tabsetEl.classList.add('is-active');

    var headerItems = [];
    for (var i = 0; i < node.tabs.length; i++) {
      var tab = node.tabs[i];
      headerItems.push({
        id: tab.id,
        label: getTabTitle(tab),
        meta: getTabMetaLabel(tab)
      });
    }
    var activeTabId = node.activeTabId || (node.tabs.length > 0 ? node.tabs[0].id : '');
    // Check if active tab is a panel (for fold button)
    var activeTabObj = null;
    for (var at = 0; at < node.tabs.length; at++) {
      if (node.tabs[at].id === activeTabId) { activeTabObj = node.tabs[at]; break; }
    }
    var centerFoldPanelId = activeTabObj && isPanelTab(activeTabObj)
      ? resolvePanelTarget(activeTabObj.panelId) : null;
    var headerEl = renderViewHeader({
      items: headerItems,
      activeId: activeTabId,
      dragAttr: { name: 'data-ws-tab-id', value: activeTabId },
      closeAction: 'close-tab',
      closeIdAttr: 'data-ws-tab-id',
      tabClickAttr: 'data-ws-tab-id',
      activateAction: null,
      extraTabAttrs: null,
      showMeta: true,
      foldNodeId: centerFoldPanelId ? node.id : null,
      isFolded: centerFoldPanelId ? !!state.foldedPanes[node.id] : false
    });
    tabsetEl.appendChild(headerEl);

    var contentEl = document.createElement('div');
    contentEl.className = 'workspace-shell-pane-content';
    var overlayEl = document.createElement('div');
    overlayEl.className = 'workspace-shell-drop-overlay';
    overlayEl.innerHTML = buildDropOverlayHtml(node.id);
    contentEl.appendChild(overlayEl);
    if (node.tabs.length === 0) {
      var emptyEl = document.createElement('div');
      emptyEl.className = 'workspace-shell-empty';
      emptyEl.innerHTML = '<div><strong>Open a board from the sidebar</strong><br>Drag a tab onto a pane edge to split it, or drag a tab outside the window to detach it.</div>';
      contentEl.appendChild(emptyEl);
    } else {
      for (var j = 0; j < node.tabs.length; j++) {
        var frame = getOrCreateFrame(node.tabs[j]);
        frame.classList.toggle('is-active', node.tabs[j].id === node.activeTabId);
        contentEl.appendChild(frame);
      }
    }
    tabsetEl.appendChild(contentEl);

    // Move logs status bar into ws-view-header so it's visible when folded
    if (centerFoldPanelId && getPanelKind(centerFoldPanelId) === 'logs') {
      moveLogsStatusToHeader(centerFoldPanelId, headerEl);
    }

    parentEl.appendChild(tabsetEl);
  }

  function renderSplit(node, parentEl) {
    renderSplitLayout(node, parentEl, renderNode);
  }

  function renderNode(node, parentEl) {
    if (!node) return;
    if (node.type === 'split') renderSplit(node, parentEl);
    else renderTabset(node, parentEl);
  }

  function renderPanelOnly(panelId, hostEl) {
    if (!hostEl) return;
    hostEl.innerHTML = '';
    hostEl.classList.add('workspace-shell-panel-only-host');
    var panelWindowEl = document.createElement('div');
    panelWindowEl.className = 'workspace-shell-panel-window workspace-shell-panel-window-integrated is-active workspace-shell-panel-only-window';
    panelWindowEl.setAttribute('data-panel-id', panelId);

    // Dock-back header for detached panel windows
    if (canUseTauriInvoke()) {
      var headerEl = document.createElement('div');
      headerEl.className = 'workspace-shell-panel-only-header';
      var titleEl = document.createElement('span');
      titleEl.className = 'workspace-shell-panel-only-title';
      titleEl.textContent = getPanelTitle(panelId);
      var dockBtn = document.createElement('button');
      dockBtn.className = 'workspace-shell-panel-only-dock-btn';
      dockBtn.type = 'button';
      dockBtn.title = 'Dock to main window';
      dockBtn.textContent = 'Dock';
      dockBtn.addEventListener('click', function () { dockToMainWindow(); });
      headerEl.appendChild(titleEl);
      headerEl.appendChild(dockBtn);
      panelWindowEl.appendChild(headerEl);
    }

    var contentEl = document.createElement('div');
    contentEl.className = 'workspace-shell-panel-content';
    var panelEl = getPanelElement(panelId);
    if (panelEl) {
      panelEl.classList.remove('hidden');
      panelEl.style.display = '';
      contentEl.appendChild(panelEl);
    }
    panelWindowEl.appendChild(contentEl);
    hostEl.appendChild(panelWindowEl);
  }

  function syncLeafDom(node) {
    var tabsetEl = state.dockEl ? state.dockEl.querySelector('.workspace-shell-tabset[data-node-id="' + node.id + '"]') : null;
    if (!tabsetEl) return false;
    tabsetEl.classList.toggle('is-active', node.id === state.activeLeafId);

    var headerEl = tabsetEl.querySelector('.ws-view-header');
    var contentEl = tabsetEl.querySelector('.workspace-shell-pane-content');
    if (!headerEl || !contentEl) return false;

    var views = contentEl.querySelectorAll('.workspace-shell-view');
    if (views.length !== node.tabs.length) return false;

    // Update title for single-tab, or tabs for multi-tab
    var tabsEl = headerEl.querySelector('.ws-view-tabs');
    if (tabsEl) {
      var tabButtons = tabsEl.querySelectorAll('.ws-view-tab');
      if (tabButtons.length !== node.tabs.length) return false;
    } else if (node.tabs.length > 1) {
      return false; // structure mismatch
    }

    for (var i = 0; i < node.tabs.length; i++) {
      var tab = node.tabs[i];
      var viewEl = contentEl.querySelector('.workspace-shell-view[data-tab-id="' + tab.id + '"]');
      if (!viewEl) return false;
      if (tabsEl) {
        var tabEl = tabsEl.querySelector('.ws-view-tab[data-ws-tab-id="' + tab.id + '"]');
        if (!tabEl) return false;
        tabEl.classList.toggle('is-active', tab.id === node.activeTabId);
        var labelEl = tabEl.querySelector('.ws-view-tab-label');
        if (labelEl) labelEl.textContent = getTabTitle(tab);
        var metaEl = tabEl.querySelector('.ws-view-tab-meta');
        if (metaEl) metaEl.textContent = getTabMetaLabel(tab);
      } else {
        var titleEl = headerEl.querySelector('.ws-view-title');
        if (titleEl) titleEl.textContent = getTabTitle(tab);
      }
      viewEl.classList.toggle('is-active', tab.id === node.activeTabId);
      if (isPanelTab(tab)) {
        var panelEl = getPanelElement(tab.panelId);
        if (panelEl && panelEl.parentNode !== viewEl) {
          viewEl.innerHTML = '';
          panelEl.classList.remove('hidden');
          panelEl.style.display = '';
          viewEl.appendChild(panelEl);
        }
        viewEl.setAttribute('data-panel-id', resolvePanelTarget(tab.panelId));
      } else {
        viewEl.setAttribute('title', getTabTitle(tab));
      }
    }

    // Keep header-level drag handle and close button pointing at the active tab
    var activeId = node.activeTabId || (node.tabs.length > 0 ? node.tabs[0].id : '');
    var dragEl = headerEl.querySelector('.ws-view-drag');
    if (dragEl) dragEl.setAttribute('data-ws-tab-id', activeId);
    var closeEl = headerEl.querySelector('.ws-view-close');
    if (closeEl) closeEl.setAttribute('data-ws-tab-id', activeId);

    return true;
  }

  function syncDomState() {
    if (!state.dockEl) return false;
    var success = true;
    var expectedLeafCount = 0;
    visitTree(state.dockTree, function (node) {
      if (node.type !== 'tabs') return;
      expectedLeafCount += 1;
      if (!syncLeafDom(node)) success = false;
    });
    if (!success) return false;
    var renderedLeafCount = state.dockEl.querySelectorAll('.workspace-shell-tabset').length;
    return renderedLeafCount === expectedLeafCount;
  }

  function applyShellBodyClasses() {
    getBody().classList.toggle('workspace-shell-mode', state.mounted);
    getBody().classList.toggle('workspace-shell-detached', state.profile === 'detachedBoard');
    getBody().classList.toggle('workspace-shell-panel-only', isPanelOnlyWindow());
  }

  function render() {
    if (!state.mounted || !state.rootEl || !state.dockEl) return;
    ensureActiveLeaf();
    syncIntegratedPanelVisibility();
    ensurePanelDockActives();
    renderToolbar();
    if (isPanelOnlyWindow()) {
      renderPanelOnly(state.panelOnlyId || getPrimaryPanelId(state.panelOnlyKind), state.dockEl);
      state.lastStructureSignature = 'panel-only:' + (state.panelOnlyId || state.panelOnlyKind);
    } else {
      var structureSignature = buildStructureSignature(state.dockTree);
      var foldedKeys = Object.keys(state.foldedPanes).sort().join(',');
      if (foldedKeys) structureSignature += '|fold:' + foldedKeys;
      var canPatch = structureSignature === state.lastStructureSignature && state.dockEl.childNodes.length > 0;
      if (!canPatch || !syncDomState()) {
        state.dockEl.innerHTML = '';
        renderNode(state.dockTree, state.dockEl);
        state.lastStructureSignature = structureSignature;
      }
      if (state.dragTabId && state.dragHoverLeafId && state.dragHoverZone) {
        setDropZoneHighlight(state.dragHoverLeafId, state.dragHoverZone);
      }
    }
    renderPanelDocks();
    // Recalculate tab overflow after DOM updates
    requestAnimationFrame(function () {
      if (!state.rootEl) return;
      var headers = state.rootEl.querySelectorAll('.ws-view-header');
      for (var hi = 0; hi < headers.length; hi++) updateTabOverflow(headers[hi]);
    });
    notifyActiveBoardChanged();
    persistState();
  }

  function pruneMissingBoards() {
    var changed = false;
    visitTree(state.dockTree, function (node) {
      if (node.type !== 'tabs') return;
      for (var i = node.tabs.length - 1; i >= 0; i--) {
        if (!isBoardTab(node.tabs[i])) continue;
        if (!state.boardsById[node.tabs[i].boardId]) {
          removeFrame(node.tabs[i].id);
          node.tabs.splice(i, 1);
          changed = true;
        }
      }
    });
    state.dockTree = withNormalizedLeaves(state.dockTree, true);
    ensureActiveLeaf();
    return changed;
  }

  function openBoard(boardId, options) {
    options = options || {};
    if (!boardId) return null;
    var desiredView = normalizeViewKind(options.viewKind);
    if (isHierarchyLauncherWindow()) {
      openWindow({
        boardId: boardId,
        viewKind: desiredView === 'default' ? null : desiredView,
        profile: 'detachedBoard'
      }).catch(function () {
        return false;
      });
      return null;
    }
    var existing = options.duplicate ? null : findLeafContainingBoard(state.dockTree, boardId, desiredView);
    if (existing && options.preferExisting !== false) {
      existing.leaf.activeTabId = existing.tab.id;
      state.activeLeafId = existing.leaf.id;
      render();
      return existing.tab;
    }
    var targetLeaf = getActiveLeaf() || getFirstLeaf(state.dockTree);
    if (!targetLeaf) {
      state.dockTree = createTabsetNode([]);
      targetLeaf = state.dockTree;
    }
    var tab = createBoardTab(boardId, desiredView);
    targetLeaf.tabs.push(tab);
    targetLeaf.activeTabId = tab.id;
    state.activeLeafId = targetLeaf.id;
    render();
    return tab;
  }

  function ensureInitialTab(boardId) {
    var leaf = getFirstLeaf(state.dockTree);
    if (leaf && leaf.tabs && leaf.tabs.length > 0) return false;
    if (!boardId) return false;
    openBoard(boardId, { preferExisting: true });
    return true;
  }

  function focusHierarchyTarget(target, boardId, options) {
    options = options || {};
    if (isHierarchyLauncherWindow()) {
      openWindow({
        boardId: boardId,
        viewKind: options.viewKind ? normalizeViewKind(options.viewKind) : null,
        profile: 'detachedBoard'
      }).catch(function () {
        return false;
      });
      return true;
    }
    var tab = openBoard(boardId, {
      preferExisting: true,
      viewKind: options.viewKind
    });
    if (!tab) return false;
    var frame = getOrCreateFrame(tab);
    function sendFocus() {
      if (!frame || !frame.contentWindow) return;
      frame.contentWindow.postMessage({
        type: 'lexera-focus-hierarchy-target',
        target: target
      }, '*');
    }
    setTimeout(sendFocus, 60);
    setTimeout(sendFocus, 220);
    return true;
  }

  function handleWindowMessage(event) {
    var data = event && event.data;
    if (!data || !data.type) return;
    if (data.type === 'lexera-pane-activated') {
      if (!findTab(state.dockTree, data.pane)) return;
      activateTab(data.pane);
      return;
    }
    if (data.type === 'lexera-pane-board-change') {
      var found = findTab(state.dockTree, data.pane);
      if (!found) return;
      found.tab.boardId = data.boardId || found.tab.boardId;
      activateTab(found.tab.id);
      return;
    }
    if (data.type === 'lexera-pane-set-view-kind') {
      if (!data.pane || !data.viewKind) return;
      setTabViewKind(data.pane, data.viewKind, { activate: true });
      return;
    }
  }

  function handleBackendConnectionStateChanged(event) {
    var detail = event && event.detail ? event.detail : {};
    state.backendConnected = !!detail.connected;
    if (state.enabled && state.mounted) render();
  }

  function forwardActionToActiveFrame(action) {
    var activeTab = getActiveTab();
    if (!activeTab) return false;
    var frame = getOrCreateFrame(activeTab);
    if (!frame || !frame.contentWindow) return false;
    frame.contentWindow.postMessage({
      type: 'lexera-board-action',
      action: action
    }, '*');
    return true;
  }

  function handleToolbarAction(action, value, extra) {
    if (!action) return false;
    if (action === 'select-panel') {
      setPanelVisibility(value, true, { activate: true });
      activatePanel(value);
      return true;
    }
    if (action === 'fold-pane') {
      if (value) toggleFoldPane(value);
      return true;
    }
    if (action === 'collapse-dock') {
      var cdDockId = extra && extra.dockId ? extra.dockId : '';
      if (cdDockId) collapseDock(cdDockId);
      return true;
    }
    if (action === 'expand-collapsed-dock') {
      var markerDockId = extra && extra.dockId ? extra.dockId : '';
      var markerPanelId = extra && extra.panelId ? extra.panelId : '';
      if (markerPanelId) {
        setPanelVisibility(markerPanelId, true, { activate: true });
        if (!getDockForPanel(markerPanelId)) {
          movePanelToDock(markerPanelId, markerDockId || (PANEL_DEFINITIONS[getPanelKind(markerPanelId)] || {}).defaultDock || 'left');
        }
      }
      restoreDock(markerDockId, markerPanelId);
      return true;
    }
    if (action === 'toggle-panel') {
      var nextVisible = !state.panelVisibility[value];
      setPanelVisibility(value, nextVisible, { activate: true });
      if (nextVisible) activatePanel(value);
      return true;
    }
    if (action === 'dock-panel') {
      movePanelToDock(state.activePanelId, value);
      return true;
    }
    if (action === 'dock-panel-direct') {
      movePanelToDock(extra && extra.panelId ? extra.panelId : value, extra && extra.dockId ? extra.dockId : value);
      return true;
    }
    if (action === 'toggle-sidebar') {
      toggleSidebar();
      return true;
    }
    if (action === 'toggle-logs') {
      toggleLogs();
      return true;
    }
    if (action === 'split-vertical') {
      splitActivePane('vertical');
      return true;
    }
    if (action === 'split-horizontal') {
      splitActivePane('horizontal');
      return true;
    }
    if (action === 'flatten-layout') {
      flattenToActiveLeaf();
      return true;
    }
    if (action === 'detach-active-tab') {
      var activeTab = getActiveTab();
      if (activeTab) detachTab(activeTab.id);
      return true;
    }
    if (action === 'open-workspace-window') {
      openWorkspaceWindow();
      return true;
    }
    if (action === 'set-view-kind') {
      setActiveViewKind(value);
      return true;
    }
    if (action === 'activate-panel') {
      activatePanel(value);
      return true;
    }
    if (action === 'duplicate-panel') {
      duplicatePanel(value || state.activePanelId);
      return true;
    }
    if (action === 'close-panel') {
      closePanelView(value || state.activePanelId);
      return true;
    }
    return false;
  }

  function handleRootClick(event) {
    // Close overflow menu when clicking inside workspace root but outside the overflow btn
    if (!event.target.closest('.ws-tab-overflow-btn')) closeTabOverflowMenus();

    var closeBtn = event.target.closest('[data-ws-action="close-tab"]');
    if (closeBtn) {
      event.preventDefault();
      event.stopPropagation();
      closeTab(closeBtn.getAttribute('data-ws-tab-id'));
      return;
    }

    var toolbarBtn = event.target.closest('[data-ws-action]');
    if (toolbarBtn) {
      event.preventDefault();
      event.stopPropagation();
      var toolbarDockHost = toolbarBtn.closest('[data-dock]');
      handleToolbarAction(
        toolbarBtn.getAttribute('data-ws-action'),
        toolbarBtn.getAttribute('data-ws-value') || toolbarBtn.getAttribute('data-ws-panel-id') || '',
        {
          panelId: toolbarBtn.getAttribute('data-ws-panel-id') || '',
          dockId: toolbarBtn.getAttribute('data-ws-dock-id') || (toolbarDockHost ? toolbarDockHost.getAttribute('data-dock') || '' : '')
        }
      );
      return;
    }

    var tabEl = event.target.closest('[data-ws-tab-id]');
    if (tabEl) {
      event.preventDefault();
      activateTab(tabEl.getAttribute('data-ws-tab-id'));
    }
  }

  function handleRootContextMenu(event) {
    var panelTab = event.target.closest('.ws-view-tab[data-ws-panel-id]');
    var panelHandle = event.target.closest('[data-ws-panel-drag-handle]');
    if (!panelTab && !panelHandle) return;
    event.preventDefault();
    event.stopPropagation();
    var panelId = resolvePanelTarget(panelTab
      ? panelTab.getAttribute('data-ws-panel-id')
      : panelHandle.getAttribute('data-ws-panel-drag-handle'));
    if (!panelId) return;
    var kind = getPanelKind(panelId);
    var items = [
      { id: 'focus', label: 'Focus View' }
    ];
    if (isPanelKindDuplicable(kind)) {
      items.push({ id: 'duplicate', label: 'Duplicate View' });
    }
    if (panelId !== kind) {
      items.push({ id: 'close', label: 'Close View' });
    }
    if (typeof showNativeMenu !== 'function') return;
    showNativeMenu(items, event.clientX, event.clientY, 'menu.panel-view').then(function (action) {
      if (action === 'focus') activatePanel(panelId);
      else if (action === 'duplicate') duplicatePanel(panelId);
      else if (action === 'close') closePanelView(panelId);
    });
  }

  function mount(hooks) {
    if (!state.enabled) return false;
    state.hooks = hooks || {};
    if (state.mounted) return true;

    var mainContent = state.hooks.getMainContent
      ? state.hooks.getMainContent()
      : document.getElementById('main-content');
    if (!mainContent) return false;

    state.rootEl = document.createElement('div');
    state.rootEl.className = 'workspace-shell';

    state.toolbarEl = document.createElement('div');
    state.toolbarEl.className = 'workspace-shell-toolbar';
    state.rootEl.appendChild(state.toolbarEl);

    state.bodyEl = document.createElement('div');
    state.bodyEl.className = 'workspace-shell-body';

    state.mainRowEl = document.createElement('div');
    state.mainRowEl.className = 'workspace-shell-main-row';

    state.leftDockEl = document.createElement('div');
    state.leftDockEl.className = 'workspace-shell-panel-dock';
    state.leftDockEl.setAttribute('data-dock', 'left');
    state.mainRowEl.appendChild(state.leftDockEl);

    state.leftDividerEl = document.createElement('div');
    state.leftDividerEl.className = 'workspace-shell-dock-divider';
    state.leftDividerEl.setAttribute('data-dock-divider', 'left');
    bindDockResizeDivider(state.leftDividerEl, 'left');
    state.mainRowEl.appendChild(state.leftDividerEl);

    state.dockEl = document.createElement('div');
    state.dockEl.className = 'workspace-shell-dock';
    state.mainRowEl.appendChild(state.dockEl);

    state.rightDividerEl = document.createElement('div');
    state.rightDividerEl.className = 'workspace-shell-dock-divider';
    state.rightDividerEl.setAttribute('data-dock-divider', 'right');
    bindDockResizeDivider(state.rightDividerEl, 'right');
    state.mainRowEl.appendChild(state.rightDividerEl);

    state.rightDockEl = document.createElement('div');
    state.rightDockEl.className = 'workspace-shell-panel-dock';
    state.rightDockEl.setAttribute('data-dock', 'right');
    state.mainRowEl.appendChild(state.rightDockEl);

    state.bodyEl.appendChild(state.mainRowEl);

    state.bottomDividerEl = document.createElement('div');
    state.bottomDividerEl.className = 'workspace-shell-dock-divider';
    state.bottomDividerEl.setAttribute('data-dock-divider', 'bottom');
    bindDockResizeDivider(state.bottomDividerEl, 'bottom');
    state.bodyEl.appendChild(state.bottomDividerEl);

    state.bottomDockEl = document.createElement('div');
    state.bottomDockEl.className = 'workspace-shell-panel-dock';
    state.bottomDockEl.setAttribute('data-dock', 'bottom');
    state.bodyEl.appendChild(state.bottomDockEl);

    state.panelDropOverlayEl = document.createElement('div');
    state.panelDropOverlayEl.className = 'workspace-shell-panel-drop-overlay';
    state.panelDropOverlayEl.innerHTML =
      '<div class="workspace-shell-panel-drop-zone" data-ws-panel-drop-dock="left"></div>' +
      '<div class="workspace-shell-panel-drop-zone" data-ws-panel-drop-dock="right"></div>' +
      '<div class="workspace-shell-panel-drop-zone" data-ws-panel-drop-dock="bottom"></div>';
    state.bodyEl.appendChild(state.panelDropOverlayEl);

    state.rootEl.appendChild(state.bodyEl);

    state.rootEl.addEventListener('click', handleRootClick);
    state.rootEl.addEventListener('contextmenu', handleRootContextMenu);
    state.rootEl.addEventListener('pointerdown', handlePointerDown, true);

    mainContent.appendChild(state.rootEl);
    window.addEventListener('message', handleWindowMessage);
    window.addEventListener('lexera-backend-connection-state-changed', handleBackendConnectionStateChanged);

    state.mounted = true;
    state.backendConnected = !!document.querySelector('.log-panel-status .connection-status-btn.connected');
    restoreState();
    applyPanelOnlyWindowState();
    ensureInitialPanelTab(state.initialPanelKind);
    ensurePanelElements();
    applyShellBodyClasses();
    render();
    return true;
  }

  function onBoardsUpdated(boardList) {
    state.boardsById = {};
    var list = Array.isArray(boardList) ? boardList : [];
    for (var i = 0; i < list.length; i++) {
      var board = list[i];
      if (!board || !board.id) continue;
      state.boardsById[board.id] = board;
    }
    pruneMissingBoards();
    render();
  }

  var ACTION_PANEL_ALIASES = {
    'open-management': 'backendSettings',
    'backend-settings': 'backendSettings',
    'open-frontend-settings': 'frontendSettings',
    'open-theme-zoom': 'frontendSettings',
    'show-processes': 'logs',
    'running-processes': 'logs',
    'open-render-apps': 'renderApps',
    'render-apps': 'renderApps'
  };

  function handleBoardAction(action) {
    if (!state.enabled || !state.mounted) return false;
    if (!action) return false;
    if (action === 'new-window') {
      openWorkspaceWindow();
      return true;
    }
    if (action.indexOf('reveal-panel:') === 0) {
      var panelKind = action.substring('reveal-panel:'.length);
      if (PANEL_DEFINITIONS[panelKind]) {
        revealPanel(panelKind);
        return true;
      }
    }
    if (ACTION_PANEL_ALIASES[action]) {
      revealPanel(ACTION_PANEL_ALIASES[action]);
      return true;
    }
    if (action.indexOf('set-board-layout:') === 0) {
      setActiveViewKind(action.substring('set-board-layout:'.length));
      return true;
    }
    if (action === 'split-disable') {
      flattenToActiveLeaf();
      return true;
    }
    if (action === 'split-enable' || action === 'split-enable-vertical' || action === 'split-enable-horizontal' || action === 'split-orientation') {
      return true;
    }
    return forwardActionToActiveFrame(action);
  }

  window.LexeraWorkspaceShell = {
    isEnabled: isEnabled,
    mount: mount,
    render: render,
    onBoardsUpdated: onBoardsUpdated,
    openBoard: openBoard,
    ensureInitialTab: ensureInitialTab,
    focusHierarchyTarget: focusHierarchyTarget,
    handleBoardAction: handleBoardAction,
    revealPanel: function (panelId) {
      return setPanelVisibility(panelId, true, { activate: true });
    },
    setPanelVisibility: setPanelVisibility,
    movePanelToDock: movePanelToDock,
    movePanelToGroup: movePanelToGroup,
    duplicatePanel: duplicatePanel,
    closePanelView: closePanelView,
    isPanelVisible: isPanelShown,
    revealPanel: revealPanel,
    collapsePanel: collapsePanel,
    restoreDock: restoreDock,
    collapseDock: collapseDock
  };
})();
