(function () {
  'use strict';
  function parseSearchParams() {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch (err) {
      return new URLSearchParams('');
    }
  }

  var urlParams = parseSearchParams();
  var WORKSPACE_SHELL_BOOT_ID = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

  function traceWorkspaceShell(message) {
    var text = '[ws-shell ' + WORKSPACE_SHELL_BOOT_ID + '] ' + String(message || '');
    if (typeof window !== 'undefined' && typeof window.lexeraLog === 'function') {
      window.lexeraLog('info', text);
      return;
    }
    if (typeof console !== 'undefined' && typeof console.info === 'function') {
      console.info(text);
    }
  }

  var layoutTree = (typeof window !== 'undefined' && window.LexeraLayoutTree) || null;
  if (!layoutTree) {
    throw new Error('LexeraLayoutTree global is required before workspaceShell.js');
  }
  var boardHost = (typeof window !== 'undefined' && window.LexeraBoardHost) || null;
  if (!boardHost) {
    throw new Error('LexeraBoardHost global is required before workspaceShell.js');
  }
  var panelHost = (typeof window !== 'undefined' && window.LexeraPanelHost) || null;
  if (!panelHost) {
    throw new Error('LexeraPanelHost global is required before workspaceShell.js');
  }

  var normalizeViewKind = layoutTree.normalizeViewKind;
  var isPanelTab = layoutTree.isPanelTab;
  var isBoardTab = layoutTree.isBoardTab;
  var visitTree = layoutTree.visitTree;
  var getFirstLeaf = layoutTree.getFirstLeaf;
  var findLeafById = layoutTree.findLeafById;
  var findNodeAndParent = layoutTree.findNodeAndParent;
  var findTab = layoutTree.findTab;
  var findClosestSplitParent = layoutTree.findClosestSplitParent;
  var countTreeTabs = layoutTree.countTreeTabs;
  var findLeafContainingBoard = layoutTree.findLeafContainingBoard;
  var findAnyLeafContainingBoard = layoutTree.findAnyLeafContainingBoard;

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

  function getBody() {
    return document.body;
  }

  function isEnabled() {
    return urlParams.get('embedded') !== '1' && urlParams.get('workspaceShell') !== '0';
  }

  var nextId = layoutTree.createIdFactory();
  function createTabsetNode(tabs) { return layoutTree.createTabsetNode(tabs, nextId); }
  function createSplitNode(axis, first, second, ratio) {
    return layoutTree.createSplitNode(axis, first, second, ratio, nextId);
  }
  function withNormalizedLeaves(node, isRoot) { return layoutTree.withNormalizedLeaves(node, isRoot, nextId); }
  function findLeafContainingPanel(node, panelId) {
    return layoutTree.findLeafContainingPanel(node, panelId, resolvePanelTarget);
  }
  function createBoardTab(boardId, viewKind) { return layoutTree.createBoardTab(boardId, viewKind, nextId); }
  function createPanelTab(panelId) { return layoutTree.createPanelTab(panelId, nextId); }
  function migratePanelDocksToSideDocks(panelDocks, panelGroupActives) {
    return layoutTree.migratePanelDocksToSideDocks(panelDocks, panelGroupActives, nextId);
  }
  var FOLD_HOVER_OPEN_DELAY_MS = 40;

  var PANEL_DEFINITIONS = {
    hierarchy: { id: 'hierarchy', title: 'Workspaces', defaultDock: 'left', duplicable: true, integratedHeader: true },
    dashboard: { id: 'dashboard', title: 'Dashboard', defaultDock: 'right', duplicable: true, integratedHeader: true },
    weekCalendar: { id: 'weekCalendar', title: 'Week Calendar', defaultDock: 'right', duplicable: true, integratedHeader: true },
    monthCalendar: { id: 'monthCalendar', title: 'Month Calendar', defaultDock: 'right', duplicable: true, integratedHeader: true },
    logs: { id: 'logs', title: 'Logs', defaultDock: 'bottom', duplicable: true, integratedHeader: true },
    backendSettings: { id: 'backendSettings', title: 'Backend Settings', defaultDock: 'right', duplicable: true, integratedHeader: true },
    frontendSettings: { id: 'frontendSettings', title: 'Frontend Settings', defaultDock: 'right', duplicable: true, integratedHeader: true },
    renderApps: { id: 'renderApps', title: 'Plugin Settings', defaultDock: 'right', duplicable: true, integratedHeader: true },
    files: { id: 'files', title: 'Workspace Settings', defaultDock: 'right', duplicable: true, integratedHeader: true },
    frontendTests: { id: 'frontendTests', title: 'Frontend Tests', defaultDock: 'right', duplicable: true, integratedHeader: true }
  };

  var DEFAULT_PANEL_VISIBILITY = {
    hierarchy: true,
    dashboard: true,
    weekCalendar: false,
    monthCalendar: false,
    logs: true,
    backendSettings: false,
    frontendSettings: false,
    renderApps: false,
    files: false,
    frontendTests: false
  };

  var runtimeAllowedPanelKinds = Object.keys(PANEL_DEFINITIONS);

  function getAllowedPanelKinds() {
    return runtimeAllowedPanelKinds.slice();
  }

  function isPanelKindAllowed(kind) {
    return !!(kind && Object.prototype.hasOwnProperty.call(PANEL_DEFINITIONS, kind) && runtimeAllowedPanelKinds.indexOf(kind) !== -1);
  }

  function configureAllowedPanelKinds(allowedKinds) {
    if (!Array.isArray(allowedKinds) || allowedKinds.length === 0) {
      runtimeAllowedPanelKinds = Object.keys(PANEL_DEFINITIONS);
      return;
    }
    var filtered = [];
    for (var i = 0; i < allowedKinds.length; i++) {
      var kind = String(allowedKinds[i] || '').trim();
      if (!isPanelKindAllowedFromDefinitions(kind)) continue;
      if (filtered.indexOf(kind) === -1) filtered.push(kind);
    }
    runtimeAllowedPanelKinds = filtered.length > 0 ? filtered : Object.keys(PANEL_DEFINITIONS);
  }

  function isPanelKindAllowedFromDefinitions(kind) {
    return !!(kind && Object.prototype.hasOwnProperty.call(PANEL_DEFINITIONS, kind));
  }

  function getDefaultDockGroups() {
    var leftGroup = [];
    if (isPanelKindAllowed('hierarchy')) leftGroup.push('hierarchy');
    if (isPanelKindAllowed('dashboard')) leftGroup.push('dashboard');
    var bottomGroup = [];
    if (isPanelKindAllowed('logs')) bottomGroup.push('logs');
    return {
      left: leftGroup.length > 0 ? [leftGroup] : [],
      right: [],
      bottom: bottomGroup.length > 0 ? [bottomGroup] : []
    };
  }

  function getFirstAllowedPanelKind() {
    return runtimeAllowedPanelKinds.length > 0 ? runtimeAllowedPanelKinds[0] : '';
  }

  function createDefaultPanelInstances() {
    var result = {};
    for (var i = 0; i < runtimeAllowedPanelKinds.length; i++) {
      var kind = runtimeAllowedPanelKinds[i];
      result[kind] = { id: kind, kind: kind };
    }
    return result;
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
    return isPanelKindAllowed(value) ? value : '';
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
    var result = {};
    for (var i = 0; i < runtimeAllowedPanelKinds.length; i++) {
      var kind = runtimeAllowedPanelKinds[i];
      result[kind] = !!DEFAULT_PANEL_VISIBILITY[kind];
    }
    return result;
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
    var defaults = getDefaultDockGroups();
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

  function createDefaultSideDocks(profile) {
    if (profile === 'detachedBoard') return { left: null, right: null, bottom: null };
    var defaultGroups = getDefaultDockGroups();
    var leftTabs = defaultGroups.left.length > 0 ? defaultGroups.left[0].map(function (panelId) {
      return createPanelTab(panelId);
    }) : [];
    var bottomTabs = defaultGroups.bottom.length > 0 ? defaultGroups.bottom[0].map(function (panelId) {
      return createPanelTab(panelId);
    }) : [];
    var leftDock = null;
    if (leftTabs.length === 1) {
      leftDock = createTabsetNode(leftTabs);
    } else if (leftTabs.length > 1) {
      leftDock = createSplitNode('horizontal',
        createTabsetNode([leftTabs[0]]),
        createTabsetNode([leftTabs[1]]),
        0.6
      );
    }
    return {
      left: leftDock,
      right: null,
      bottom: bottomTabs.length > 0 ? createTabsetNode(bottomTabs) : null
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


  // Return the tab id for any tab (any view kind) showing this
  // board, across all trees (center + side docks). Used by the
  // multiview mutation-delegation bridge in app.js to address the
  // owning board webview by label.
  function getTabIdForBoard(boardId) {
    if (!boardId) return '';
    var ids = allTreeIds();
    for (var t = 0; t < ids.length; t++) {
      var root = getTreeRoot(ids[t]);
      if (!root) continue;
      var foundId = '';
      visitTree(root, function (candidate) {
        if (foundId || !candidate || candidate.type !== 'tabs') return;
        for (var i = 0; i < candidate.tabs.length; i++) {
          var tab = candidate.tabs[i];
          if (tab && tab.boardId === boardId) {
            foundId = tab.id;
            return;
          }
        }
      });
      if (foundId) return foundId;
    }
    return '';
  }

  /** Find any tab (any view kind) showing the given boardId — see
   *  `LexeraLayoutTree.findAnyLeafContainingBoard`. Used by the parent shell's
   *  mutation-delegation path: if the user reorders an element in the workspace
   *  view (sidebar tree) for a board that's open in some iframe, we need to
   *  route the mutation INTO that iframe so it lands on the iframe's live
   *  `fullBoardData` and goes through its save pipeline. The viewKind doesn't
   *  matter for delegation purposes — both kanban and canvas iframes own the
   *  same board state.
   */

  function getFrameWindowForBoard(boardId) {
    return boardHost.getFrameWindowForBoard(state.dockTree, state.frameCache, boardId);
  }

  function getBoardMetaLabel(meta) {
    if (!meta) return 'Untitled';
    var title = String(meta.title || '').trim();
    var fileName = getDisplayNameFromPath(meta.filePath || '');
    if (title && fileName && title !== fileName) return title + ' (' + fileName + ')';
    return title || fileName || meta.id || 'Untitled';
  }

  function getEmbeddedUrlForTab(tab) {
    return boardHost.getEmbeddedUrlForTab(tab, window.location.href);
  }

  var state = {
    enabled: isEnabled(),
    mounted: false,
    didRestoreState: false,
    profile: urlParams.get('profile') === 'detachedBoard' ? 'detachedBoard' : 'workspace',
    panelOnlyKind: normalizePanelKind(urlParams.get('panelKind') || ''),
    panelOnlyId: '',
    initialPanelKind: normalizePanelKind(urlParams.get('initialPanel') || ''),
    windowRole: String(urlParams.get('windowRole') || ''),
    windowLabel: String(urlParams.get('windowLabel') || 'main'),
    hostWindowLabel: String(urlParams.get('workspaceShellHostLabel') || urlParams.get('windowLabel') || 'main'),
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
    loadedBoardFrames: {},
    deferredBoardLoadQueue: [],
    deferredBoardLoadTimer: 0,
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
    lastLeafTopology: '',
    lastSideDockSignatures: { left: '', right: '', bottom: '' },
    foldedPanes: {},
    backendConnected: false,
    catalogSnapshot: {
      boards: [],
      remoteBoards: [],
      workspaces: []
    },
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
    dragLastY: 0,
    pendingFocusTargets: {}
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

  function canHostBoardTabs() {
    return state.enabled && !isPanelOnlyWindow();
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
    if (state.hooks && typeof state.hooks.getPersistenceKey === 'function') {
      var hookKey = state.hooks.getPersistenceKey();
      if (hookKey) return String(hookKey);
    }
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
    } catch (err) {
      console.warn('[ws-shell] Failed to persist state:', err);
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
    } catch (err) {
      console.warn('[ws-shell] Failed to restore state:', err);
      return false;
    }
  }

  function openPanelInCenter(panelId, options) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;

    var existing = findPanelInAllTrees(normalized);
    if (existing && existing.treeId === 'center' && existing.tab) {
      state.panelVisibility[normalized] = true;
      state.activePanelId = normalized;
      activateTab(existing.tab.id);
      return true;
    }

    if (existing && existing.treeId !== 'center') {
      removePanelFromDocks(normalized);
    }

    var groupedPanelId = options && options.groupWith ? resolvePanelTarget(options.groupWith) : '';
    var groupedTarget = groupedPanelId ? findPanelInAllTrees(groupedPanelId) : null;
    if (groupedTarget && groupedTarget.treeId === 'center' && groupedTarget.leaf) {
      var groupedTab = createPanelTab(normalized);
      groupedTarget.leaf.tabs.push(groupedTab);
      groupedTarget.leaf.activeTabId = groupedTab.id;
      state.activeLeafId = groupedTarget.leaf.id;
      state.activePanelId = normalized;
      state.panelVisibility[normalized] = true;
      state.dockTree = withNormalizedLeaves(state.dockTree, true);
      render();
      return true;
    }

    var leaf = getActiveLeaf() || getFirstLeaf(state.dockTree);
    if (!leaf || leaf.type !== 'tabs') {
      state.dockTree = createTabsetNode([]);
      leaf = state.dockTree;
    }
    var tab = createPanelTab(normalized);
    leaf.tabs.push(tab);
    leaf.activeTabId = tab.id;
    state.activeLeafId = leaf.id;
    state.activePanelId = normalized;
    state.panelVisibility[normalized] = true;
    state.dockTree = withNormalizedLeaves(state.dockTree, true);
    render();
    return true;
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
    if (kind === 'weekCalendar' || kind === 'monthCalendar') return '\u25a6'; // ▦
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

      if (!(kind === 'logs' && dockId === 'bottom')) {
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
      }

      if (kind === 'logs' && dockId === 'bottom') {
        zone.classList.add('ws-fold-zone-status');
        // Build rich status badges for the folded log strip
        var badgesEl = document.createElement('span');
        badgesEl.className = 'ws-fold-status-badges';

        var statusData = typeof window.getLogFoldedStatusData === 'function'
          ? window.getLogFoldedStatusData()
          : { connected: state.backendConnected, logCount: 0, userCount: 0, inFlightCount: 0 };

        var dotSpan = document.createElement('span');
        dotSpan.className = 'ws-fold-status-dot' + (statusData.connected ? ' is-connected' : ' is-disconnected');
        badgesEl.appendChild(dotSpan);

        var connSpan = document.createElement('span');
        connSpan.className = 'ws-fold-badge ws-fold-badge-conn';
        connSpan.textContent = statusData.connected ? 'Connected' : 'Disconnected';
        badgesEl.appendChild(connSpan);

        var logsSpan = document.createElement('span');
        logsSpan.className = 'ws-fold-badge ws-fold-badge-logs';
        logsSpan.textContent = statusData.logCount + ' logs';
        badgesEl.appendChild(logsSpan);

        var usersSpan = document.createElement('span');
        usersSpan.className = 'ws-fold-badge ws-fold-badge-users';
        usersSpan.textContent = statusData.userCount + (statusData.userCount === 1 ? ' user' : ' users');
        if (statusData.userCount === 0) usersSpan.style.display = 'none';
        badgesEl.appendChild(usersSpan);

        var apiSpan = document.createElement('span');
        apiSpan.className = 'ws-fold-badge ws-fold-badge-api';
        apiSpan.textContent = statusData.inFlightCount + ' pending';
        if (statusData.inFlightCount === 0) apiSpan.style.display = 'none';
        badgesEl.appendChild(apiSpan);

        zone.appendChild(badgesEl);
      } else {
        var label = document.createElement('span');
        label.className = 'ws-fold-zone-label';
        label.textContent = getPanelTitle(panelId);
        zone.appendChild(label);
      }

      strip.appendChild(zone);
    }

    // Lock button — prevents hover-unfold (default: locked)
    var lockBtn = document.createElement('button');
    lockBtn.className = 'ws-fold-lock-btn';
    lockBtn.type = 'button';
    lockBtn.title = 'Toggle hover lock';
    lockBtn.textContent = '\uD83D\uDD12'; // 🔒
    lockBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var locked = dockEl.classList.toggle('is-fold-locked');
      lockBtn.textContent = locked ? '\uD83D\uDD12' : '\uD83D\uDD13'; // 🔒/🔓
      lockBtn.title = locked ? 'Locked — click to unlock hover' : 'Unlocked — click to lock';
    });
    strip.appendChild(lockBtn);
    // Default: locked
    dockEl.classList.add('is-fold-locked');

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
    var dockTreeBuilt = false;
    var cachedOverlaySize = 0;

    function activatePanelTab(panelId) {
      var found = findPanelInAllTrees(panelId);
      if (found && found.leaf) {
        found.leaf.activeTabId = found.tab.id;
      }
    }

    /**
     * Switch the visible panel inside the already-rendered dock tree DOM.
     * Toggles display on panel elements and is-selected on tab headers
     * without rebuilding the tree.
     */
    function switchActivePanelInDom(panelId) {
      var tabsets = dockEl.querySelectorAll(':scope > .workspace-shell-node .workspace-shell-tabset, :scope > .workspace-shell-tabset');
      for (var ts = 0; ts < tabsets.length; ts++) {
        var tabsetEl = tabsets[ts];
        // Update tab header selection
        var tabs = tabsetEl.querySelectorAll('.ws-view-header .ws-view-tab');
        for (var t = 0; t < tabs.length; t++) {
          var tabPanelAttr = tabs[t].getAttribute('data-ws-panel-id');
          tabs[t].classList.toggle('is-selected', tabPanelAttr === panelId);
        }
        // Toggle panel content visibility
        var contentEl = tabsetEl.querySelector('.workspace-shell-panel-content');
        if (!contentEl) continue;
        var panels = contentEl.children;
        for (var p = 0; p < panels.length; p++) {
          var child = panels[p];
          if (child.classList.contains('workspace-shell-drop-overlay')) continue;
          var childPanelId = child.getAttribute('data-panel-id') || child.id || '';
          if (childPanelId === panelId || childPanelId === 'panel-' + panelId) {
            child.style.display = '';
          } else {
            child.style.display = 'none';
          }
        }
      }
    }

    function buildDockTree() {
      var tree = state.sideDocks[dockId];
      if (!tree) return;
      var treeNodes = dockEl.querySelectorAll(':scope > .workspace-shell-node');
      for (var n = 0; n < treeNodes.length; n++) treeNodes[n].parentNode.removeChild(treeNodes[n]);
      renderSideDockNode(tree, dockEl, dockId);
      dockTreeBuilt = true;
    }

    function showHover(panelId) {
      if (panelId) activatePanelTab(panelId);
      activeHoverPanelId = panelId;
      dockEl.classList.add('is-fold-hover');
      buildDockTree();
      measureAndApplyOverlaySize();
    }

    function clearHoverTimer() {
      if (!hoverTimer) return;
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }

    function scheduleShowHover(panelId, delayMs) {
      clearHoverTimer();
      var waitMs = typeof delayMs === 'number' && delayMs > 0 ? delayMs : 0;
      if (waitMs === 0) {
        showHover(panelId);
        return;
      }
      hoverTimer = setTimeout(function () {
        hoverTimer = null;
        showHover(panelId);
      }, waitMs);
    }

    function measureAndApplyOverlaySize() {
      var node = dockEl.querySelector(':scope > .workspace-shell-node');
      if (!node) return;
      var isHorizontal = dockId === 'bottom';
      var prop = isHorizontal ? 'height' : 'width';
      // Reuse cached size if already measured during this hover session
      if (cachedOverlaySize > 0) {
        node.style[prop] = cachedOverlaySize + 'px';
        return;
      }
      var minSize = isHorizontal ? 120 : 200;
      var maxSize = isHorizontal
        ? Math.round(window.innerHeight * 0.6)
        : Math.round(window.innerWidth * 0.6);
      // Use the restore size (pre-fold dimension) instead of
      // forcing a synchronous layout with max-content + offsetWidth.
      var storedSize = state.dockRestoreSizes[dockId] || state.dockSizes[dockId] || 0;
      var natural = storedSize > 0 ? storedSize : minSize;
      var size = Math.max(minSize, Math.min(natural, maxSize));
      cachedOverlaySize = size;
      node.style[prop] = size + 'px';
    }

    dockEl.addEventListener('mouseenter', function () {
      if (!dockEl.classList.contains('is-folded')) return;
      if (dockEl.classList.contains('is-fold-locked')) return;
      scheduleShowHover(null, FOLD_HOVER_OPEN_DELAY_MS);
    });

    // Per-zone mouseover: switch active panel when moving between zones
    dockEl.addEventListener('mouseover', function (e) {
      if (dockEl.classList.contains('is-fold-locked')) return;
      var zone = e.target.closest ? e.target.closest('.ws-fold-zone') : null;
      if (!zone) return;
      var panelId = zone.getAttribute('data-ws-panel-id');
      if (!panelId || panelId === activeHoverPanelId) return;
      if (!dockEl.classList.contains('is-fold-hover')) {
        scheduleShowHover(panelId, 0);
      } else {
        // Dock tree already built — just switch the active panel in-place
        activatePanelTab(panelId);
        activeHoverPanelId = panelId;
        switchActivePanelInDom(panelId);
      }
    });

    dockEl.addEventListener('mouseleave', function () {
      clearHoverTimer();
      activeHoverPanelId = null;
      dockTreeBuilt = false;
      cachedOverlaySize = 0;
      dockEl.classList.remove('is-fold-hover');
      // Clean up inline size from measurement
      var node = dockEl.querySelector(':scope > .workspace-shell-node');
      if (node) { node.style.width = ''; node.style.height = ''; }
    });
  }

  function requestUiFrame(callback) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
    return setTimeout(callback, 16);
  }

  function cancelUiFrame(handle) {
    if (!handle) return;
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(handle);
      return;
    }
    clearTimeout(handle);
  }

  function getDockLayoutState() {
    var dockIds = ['left', 'right', 'bottom'];
    var visible = {};
    var folded = {};
    for (var d = 0; d < dockIds.length; d++) {
      var id = dockIds[d];
      var hasPanels = getVisiblePanelIdsForDock(id).length > 0;
      var isCollapsed = hasPanels && state.dockSizes[id] <= 0;
      visible[id] = hasPanels && state.dockSizes[id] > 0;
      folded[id] = isCollapsed;
    }
    return { visible: visible, folded: folded };
  }

  function dockLayoutStateChanged(previousLayout, nextLayout) {
    if (!previousLayout || !nextLayout) return true;
    var dockIds = ['left', 'right', 'bottom'];
    for (var i = 0; i < dockIds.length; i++) {
      var dockId = dockIds[i];
      if (!!previousLayout.visible[dockId] !== !!nextLayout.visible[dockId]) return true;
      if (!!previousLayout.folded[dockId] !== !!nextLayout.folded[dockId]) return true;
    }
    return false;
  }

  function syncDockStructure(layoutState) {
    if (!state.bodyEl || !state.mainRowEl) return;
    var dockIds = ['left', 'right', 'bottom'];
    var dockEls = { left: state.leftDockEl, right: state.rightDockEl, bottom: state.bottomDockEl };
    var dividerEls = { left: state.leftDividerEl, right: state.rightDividerEl, bottom: state.bottomDividerEl };

    for (var d = 0; d < dockIds.length; d++) {
      var id = dockIds[d];
      var visible = !!layoutState.visible[id];
      var folded = !!layoutState.folded[id];

      var dockEl = dockEls[id];
      if (dockEl) {
        var showDock = visible || folded;
        dockEl.classList.toggle('is-visible', showDock);
        dockEl.classList.toggle('is-folded', folded);
        dockEl.classList.toggle('is-compact', visible && state.dockSizes[id] < 200);
        dockEl.style.overflow = folded ? 'visible' : '';
        if (folded) {
          renderFoldStrip(id, dockEl);
          bindFoldHover(id, dockEl);
        } else {
          // Remove fold strip when not folded
          var oldStrip = dockEl.querySelector('.ws-fold-strip');
          if (oldStrip) oldStrip.parentNode.removeChild(oldStrip);
          dockEl.classList.remove('is-fold-hover');
        }
      }
      if (dividerEls[id]) dividerEls[id].classList.toggle('is-visible', visible);
    }
  }

  function syncDockGridTracks(layoutState) {
    if (!state.bodyEl || !state.mainRowEl) return;
    var FOLD_SIZE = 22;

    // Grid: folded docks get FOLD_SIZE px, visible docks get their size, hidden get nothing
    var leftCol = '';
    if (layoutState.visible.left) leftCol = clampPanelSize('left', state.dockSizes.left) + 'px 5px ';
    else if (layoutState.folded.left) leftCol = FOLD_SIZE + 'px ';

    var rightCol = '';
    if (layoutState.visible.right) rightCol = ' 5px ' + clampPanelSize('right', state.dockSizes.right) + 'px';
    else if (layoutState.folded.right) rightCol = ' ' + FOLD_SIZE + 'px';

    state.mainRowEl.style.gridTemplateColumns =
      leftCol + 'minmax(0, 1fr)' + rightCol;

    var bottomRow = '';
    if (layoutState.visible.bottom) bottomRow = ' 5px ' + clampPanelSize('bottom', state.dockSizes.bottom) + 'px';
    else if (layoutState.folded.bottom) bottomRow = ' ' + FOLD_SIZE + 'px';

    state.bodyEl.style.gridTemplateRows =
      'minmax(0, 1fr)' + bottomRow;
  }

  function applyDockLayout() {
    var layoutState = getDockLayoutState();
    syncDockStructure(layoutState);
    syncDockGridTracks(layoutState);
  }

  // Freeze every visible iframe at its current pixel size for the duration
  // of a dock-divider drag. The dock grid cells still resize live so the
  // divider and dock chrome follow the cursor, but the iframe outer boxes
  // don't change size — their inner documents never reflow per frame.
  // On release we remove the inline sizes and the iframes snap to the new
  // dock dimensions in a single reflow.
  function freezeActiveFrames() {
    var frameIds = Object.keys(state.frameCache || {});
    var frozen = [];
    for (var i = 0; i < frameIds.length; i++) {
      var frame = state.frameCache[frameIds[i]];
      if (!frame || !frame.classList || !frame.classList.contains('is-active')) continue;
      var w = frame.offsetWidth;
      var h = frame.offsetHeight;
      if (w <= 0 || h <= 0) continue;
      frame.style.width = w + 'px';
      frame.style.height = h + 'px';
      frame.style.right = 'auto';
      frame.style.bottom = 'auto';
      frozen.push(frame);
    }
    return frozen;
  }

  function thawFrames(frozen) {
    for (var i = 0; i < frozen.length; i++) {
      var frame = frozen[i];
      frame.style.width = '';
      frame.style.height = '';
      frame.style.right = '';
      frame.style.bottom = '';
    }
  }

  function bindDockResizeDivider(dividerEl, dockId) {
    if (!dividerEl) return;
    dividerEl.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      var pointerId = event.pointerId;
      try { dividerEl.setPointerCapture(pointerId); } catch (_) { /* ignore */ }
      dividerEl.classList.add('is-dragging');
      var activeDockEl = dockId === 'left' ? state.leftDockEl : dockId === 'right' ? state.rightDockEl : state.bottomDockEl;
      var baseRect = dockId === 'bottom'
        ? (state.bodyEl ? state.bodyEl.getBoundingClientRect() : null)
        : (state.mainRowEl ? state.mainRowEl.getBoundingClientRect() : null);
      var frozenFrames = freezeActiveFrames();
      var pendingMoveEvent = null;
      var frameId = 0;
      var lastLayoutState = getDockLayoutState();
      function applyMove(moveEvent) {
        if (!baseRect) return;
        var nextSize = 0;
        if (dockId === 'left') {
          nextSize = moveEvent.clientX - baseRect.left;
          if (nextSize < 56) nextSize = 0;
          else state.dockRestoreSizes.left = clampPanelSize('left', nextSize);
          state.dockSizes.left = nextSize === 0 ? 0 : clampPanelSize('left', nextSize);
        } else if (dockId === 'right') {
          nextSize = baseRect.right - moveEvent.clientX;
          if (nextSize < 56) nextSize = 0;
          else state.dockRestoreSizes.right = clampPanelSize('right', nextSize);
          state.dockSizes.right = nextSize === 0 ? 0 : clampPanelSize('right', nextSize);
        } else if (dockId === 'bottom') {
          nextSize = baseRect.bottom - moveEvent.clientY;
          if (nextSize < 48) nextSize = 0;
          else state.dockRestoreSizes.bottom = clampPanelSize('bottom', nextSize);
          state.dockSizes.bottom = nextSize === 0 ? 0 : clampPanelSize('bottom', nextSize);
        }
        var nextLayoutState = getDockLayoutState();
        if (activeDockEl) activeDockEl.classList.toggle('is-compact', nextLayoutState.visible[dockId] && state.dockSizes[dockId] < 200);
        if (dockLayoutStateChanged(lastLayoutState, nextLayoutState)) {
          syncDockStructure(nextLayoutState);
          lastLayoutState = nextLayoutState;
        }
        syncDockGridTracks(nextLayoutState);
      }
      function scheduleMove(moveEvent) {
        pendingMoveEvent = moveEvent;
        if (frameId) return;
        frameId = requestUiFrame(function () {
          frameId = 0;
          var queuedEvent = pendingMoveEvent;
          pendingMoveEvent = null;
          if (queuedEvent) applyMove(queuedEvent);
        });
      }
      function handleMove(moveEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        scheduleMove(moveEvent);
      }
      function handleUp(upEvent) {
        if (upEvent.pointerId !== pointerId) return;
        if (frameId) {
          cancelUiFrame(frameId);
          frameId = 0;
        }
        if (pendingMoveEvent) {
          applyMove(pendingMoveEvent);
          pendingMoveEvent = null;
        }
        dividerEl.classList.remove('is-dragging');
        dividerEl.removeEventListener('pointermove', handleMove);
        dividerEl.removeEventListener('pointerup', handleUp);
        dividerEl.removeEventListener('pointercancel', handleUp);
        try { dividerEl.releasePointerCapture(pointerId); } catch (_) { /* ignore */ }
        thawFrames(frozenFrames);
        applyDockLayout();
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

  var _boardChangeTimer = null;

  function notifyActiveBoardChanged() {
    // Debounce 100ms to prevent rapid-fire board switches during render cycles
    clearTimeout(_boardChangeTimer);
    _boardChangeTimer = setTimeout(function () {
      _boardChangeTimer = null;
      var activeTab = getActiveTab();
      var boardId = activeTab && isBoardTab(activeTab) && activeTab.boardId ? activeTab.boardId : '';
      if (boardId === state.lastNotifiedBoardId) return;
      if (typeof traceFrontendAction === 'function') {
        traceFrontendAction('debug', 'ws-shell.boardChange', 'Active board changed', { from: state.lastNotifiedBoardId, to: boardId || null });
      }
      state.lastNotifiedBoardId = boardId;
      if (state.hooks && typeof state.hooks.onActiveBoardChanged === 'function') {
        state.hooks.onActiveBoardChanged(boardId || null);
      }
    }, 100);
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

  /**
   * Leaf-topology signature — only tracks split structure and leaf node IDs,
   * NOT individual tabs. Used to decide whether syncLeafDom can patch
   * tab changes within existing leaves without a full rebuild.
   */
  function buildLeafTopologySignature(node) {
    if (!node) return '';
    if (node.type === 'tabs') return 'L(' + node.id + ')';
    return 'S(' + node.id + ':' + node.axis + ':' + buildLeafTopologySignature(node.first) + ':' + buildLeafTopologySignature(node.second) + ')';
  }

  function getTabTitle(tab) {
    if (!tab) return 'Untitled';
    if (isPanelTab(tab)) return getPanelTitle(tab.panelId);
    var meta = state.boardsById[tab.boardId];
    return getBoardMetaLabel(meta || { id: tab.boardId || 'Untitled' });
  }

  function getTabMetaLabel(tab) {
    if (!tab) return '';
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

  function shouldLoadBoardFrame(tab, options) {
    if (!tab || isPanelTab(tab)) return false;
    if (options && options.shouldLoad === true) return true;
    return !!state.loadedBoardFrames[tab.id];
  }

  function syncBoardFrameSource(view, tab, options) {
    if (!view || !tab || isPanelTab(tab)) return;
    var desiredSrc = getEmbeddedUrlForTab(tab);
    var loadedSrc = view.getAttribute('data-loaded-src') || '';
    view.setAttribute('data-src', desiredSrc);
    view.setAttribute('title', getTabTitle(tab));
    if (!shouldLoadBoardFrame(tab, options)) return;
    state.loadedBoardFrames[tab.id] = true;
    if (loadedSrc === desiredSrc) return;
    view.src = desiredSrc;
    view.setAttribute('data-loaded-src', desiredSrc);
  }

  function clearDeferredBoardFrameLoads() {
    if (state.deferredBoardLoadTimer) {
      clearTimeout(state.deferredBoardLoadTimer);
      state.deferredBoardLoadTimer = 0;
    }
    state.deferredBoardLoadQueue = [];
  }

  function buildDeferredBoardFrameQueue() {
    var queue = [];
    visitTree(state.dockTree, function (node) {
      if (!node || node.type !== 'tabs' || node.id === state.activeLeafId) return;
      var activeTabId = node.activeTabId || (node.tabs && node.tabs[0] ? node.tabs[0].id : '');
      if (!activeTabId) return;
      var found = findTab(state.dockTree, activeTabId);
      if (!found || !found.tab || isPanelTab(found.tab)) return;
      if (state.loadedBoardFrames[found.tab.id]) return;
      queue.push(found.tab.id);
    });
    return queue;
  }

  function pumpDeferredBoardFrameLoads() {
    state.deferredBoardLoadTimer = 0;
    if (!state.mounted || isPanelOnlyWindow()) return;
    while (state.deferredBoardLoadQueue.length > 0) {
      var nextTabId = state.deferredBoardLoadQueue.shift();
      var found = findTab(state.dockTree, nextTabId);
      if (!found || !found.tab || isPanelTab(found.tab)) continue;
      var frame = getOrCreateFrame(found.tab, { shouldLoad: true });
      syncBoardFrameSource(frame, found.tab, { shouldLoad: true });
      break;
    }
    if (state.deferredBoardLoadQueue.length > 0) {
      // Background tabs load 150ms apart (was 700ms) — fast enough to
      // feel responsive but staggered so the active boards get priority.
      state.deferredBoardLoadTimer = setTimeout(pumpDeferredBoardFrameLoads, 150);
    }
  }

  function scheduleDeferredBoardFrameLoads() {
    clearDeferredBoardFrameLoads();
    state.deferredBoardLoadQueue = buildDeferredBoardFrameQueue();
    if (state.deferredBoardLoadQueue.length === 0) return;
    // Start loading non-active panes after initial poll completes (~200ms)
    state.deferredBoardLoadTimer = setTimeout(pumpDeferredBoardFrameLoads, 200);
  }

  // Multiview migration: board tabs are hosted by Tauri child webviews
  // by default. Two automatic exceptions:
  //   - inside an embedded child webview (would recursively spawn boards)
  //   - inside the test runner (?autoRunTests=1) — the iframe-content
  //     test infrastructure inspects frame.contentDocument directly,
  //     which doesn't exist in multiview mode. Until those tests are
  //     migrated to query webviews via Tauri IPC, the test mode falls
  //     back to iframes so the suite remains usable.
  var MULTIVIEW_BOARDS = (function () {
    try {
      if (urlParams && urlParams.get('embedded') === '1') return false;
      if (urlParams && urlParams.get('multiview') === '0') return false;
      // Detect test runner: Rust writes `src/auto-run-config.json` when
      // --run-tests is passed. Check synchronously via XHR; if it exists
      // and has auto_run, fall back to iframes so the iframe-content
      // test infrastructure works unchanged.
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'auto-run-config.json', false); // synchronous
      xhr.send(null);
      if (xhr.status === 200 && xhr.responseText) {
        var cfg = JSON.parse(xhr.responseText);
        if (cfg && (cfg.auto_run === true || cfg.autoRun === true)) {
          console.log('[ws-shell] auto-run mode detected — using iframe path for test compatibility');
          return false;
        }
      }
    } catch (_) { /* config not present → not in test mode */ }
    return true;
  })();
  if (MULTIVIEW_BOARDS) {
    console.log('[ws-shell] multiview boards: ON (iframe path removed)');
  }

  // Track which tabs have a multiview webview spawned, so we can
  // destroy + re-spawn on URL change instead of contentWindow.location.
  var multiviewSpawnedTabs = {};
  var multiviewGeometryObservers = {};
  // Per-tab watchers that retry doSpawn() once the placeholder becomes
  // measurable (paint-visible, > 0×0). Set up by
  // scheduleSpawnRetryWhenMeasurable; nulled out in `fire()` after one
  // successful retry. Without this, a placeholder that's hidden at
  // initial render would stay "spawning…" forever.
  var multiviewSpawnRetryWatchers = {};
  // Per-LABEL in-flight spawn promise. Hard fence against duplicate
  // `multiview_spawn` IPCs racing for the same Tauri webview label.
  // Runtime evidence (2026-04-26): two spawns for the same label fired
  // back-to-back, the second hit "already exists", recovery looped
  // forever. The tab-keyed state machine wasn't sufficient — most likely
  // because two distinct triggers (render-restart rAF + spawn-retry
  // watcher fire) both decided no entry existed in the same JS task
  // batch. This map keys on label, so any second spawn attempt finds
  // the first promise and waits on it.
  var multiviewLabelSpawnLocks = {};
  var multiviewPendingLocalDestroyAcks = {};

  function multiviewLabelForTab(tabId) {
    return boardHost.multiviewLabelForTab(tabId);
  }

  // Compute the multiview webview label for a tab object, taking its
  // kind into account. Panel webviews use the 'panel-tab-' prefix so
  // the multiview-destroyed listener and LRU registry can disambiguate
  // them from board webviews ('board-tab-' prefix).
  function labelForTabObject(tab) {
    if (isPanelTab(tab)) return panelHost.panelLabelForTab(tab.id);
    return boardHost.multiviewLabelForTab(tab.id);
  }

  // Reverse lookup: tabId for a given webview label. Handles three
  // cases:
  //   1. Formula labels with our 'board-tab-' / 'panel-tab-' prefixes
  //   2. Pool labels ('_pool_<n>') that were repurposed and now own
  //      a tab — we find the tabId by scanning the spawn registry
  //   3. Anything else: returns the original label so callers can
  //      surface it in logs/diagnostics.
  function tabIdFromLabel(label) {
    if (typeof label !== 'string') return '';
    if (label.indexOf('board-tab-') === 0) return label.substring('board-tab-'.length);
    if (label.indexOf('panel-tab-') === 0) return label.substring('panel-tab-'.length);
    var tabIds = Object.keys(multiviewSpawnedTabs);
    for (var i = 0; i < tabIds.length; i++) {
      if (multiviewSpawnedTabs[tabIds[i]].label === label) return tabIds[i];
    }
    return label;
  }

  function noteLocalDestroy(label) {
    var key = String(label || '');
    if (!key) return;
    multiviewPendingLocalDestroyAcks[key] = (multiviewPendingLocalDestroyAcks[key] || 0) + 1;
  }

  function consumeLocalDestroyAck(label) {
    var key = String(label || '');
    var count = multiviewPendingLocalDestroyAcks[key] || 0;
    if (count <= 0) return false;
    if (count === 1) delete multiviewPendingLocalDestroyAcks[key];
    else multiviewPendingLocalDestroyAcks[key] = count - 1;
    return true;
  }

  function ensureHealthDot(placeholderEl) {
    return boardHost.ensureHealthDot(placeholderEl, document);
  }
  // Last-known health per tab so re-renders reapply the state.
  var lastKnownHealth = {};

  // Reapply known health states to all health dots in the DOM.
  // Called after render() so freshly-built tab headers get the
  // right color instead of the default 'unknown'.
  function reapplyAllHealthDots() {
    var dots = document.querySelectorAll('.ws-view-tab-health[data-tab-id]');
    for (var i = 0; i < dots.length; i++) {
      var id = dots[i].getAttribute('data-tab-id');
      if (!id) continue;
      var s = lastKnownHealth[id] || 'unknown';
      dots[i].setAttribute('data-health', s);
      dots[i].setAttribute('title', 'Connection state: ' + s);
    }
  }

  function applyHealthToTab(tabId, healthState) {
    var s = healthState || 'unknown';
    lastKnownHealth[tabId] = s;
    // Update the health dot in the tab header (left of close button)
    var headerDots = document.querySelectorAll(
      '.ws-view-tab-health[data-tab-id="' + (tabId || '').replace(/"/g, '') + '"]');
    for (var i = 0; i < headerDots.length; i++) {
      headerDots[i].setAttribute('data-health', s);
      headerDots[i].setAttribute('title', 'Connection state: ' + s);
    }
    // Also update the placeholder-corner dot as a secondary indicator
    var placeholderEl = state.frameCache[tabId];
    if (placeholderEl && typeof placeholderEl.querySelector === 'function' &&
        placeholderEl.getAttribute && placeholderEl.getAttribute('data-multiview') === '1') {
      var dot = ensureHealthDot(placeholderEl);
      dot.setAttribute('data-health', s);
      dot.setAttribute('title', 'Connection state: ' + s);
    }
  }

  function multiviewUrlForTab(desiredSrc) {
    return boardHost.multiviewUrlForTab(desiredSrc);
  }

  function watchPlaceholderVisibility(tab, placeholderEl, pushGeomFn) {
    if (!tab || !tab.id) return;
    boardHost.watchPlaceholderVisibility(
      tab.id,
      placeholderEl,
      pushGeomFn,
      labelForTabObject(tab)
    );
  }

  // Per-tab spawn lifecycle:
  //   absent      — no webview, no spawn in flight
  //   'pending'   — spawn IPC issued, awaiting Rust ack
  //   'ready'     — spawn confirmed, webview exists at .url
  //   'destroying'— destroy IPC issued, awaiting Rust ack
  // Encoding the state explicitly (rather than presence/url alone)
  // prevents render-loop re-entry and destroy/spawn races from
  // producing duplicate Rust webviews — see TODOs-lexera-multiview.md
  // "lifecycle-race fix" for a full trace.
  // Emergency kill switch — flip to true if the runaway-spawn loop returns.
  // The cap+delay fix on "already exists" recovery wasn't sufficient last
  // time we hit it; if it recurs we want a circuit-breaker that auto-arms.
  var MULTIVIEW_SPAWN_DISABLED = false;
  // Circuit breaker: per-tab call frequency tracker. If ensureMultiviewWebview
  // is called more than CIRCUIT_BREAKER_THRESHOLD times within
  // CIRCUIT_BREAKER_WINDOW_MS for the same tab, auto-arm the kill switch and
  // log enough context to identify what's looping. The user can then
  // reproduce, file a bug with the captured label/url, and we have something
  // to actually trace instead of guessing.
  var CIRCUIT_BREAKER_THRESHOLD = 12;
  var CIRCUIT_BREAKER_WINDOW_MS = 1000;
  var ensureCallTimestamps = {}; // tabId -> array of timestamps (newest at end)
  function noteEnsureCall(tabId, label, url) {
    var now = Date.now();
    var arr = ensureCallTimestamps[tabId] || (ensureCallTimestamps[tabId] = []);
    arr.push(now);
    while (arr.length > 0 && now - arr[0] > CIRCUIT_BREAKER_WINDOW_MS) arr.shift();
    if (arr.length >= CIRCUIT_BREAKER_THRESHOLD && !MULTIVIEW_SPAWN_DISABLED) {
      MULTIVIEW_SPAWN_DISABLED = true;
      var msg = '[multiview] CIRCUIT BREAKER tripped — ' + arr.length +
        ' ensure() calls in ' + CIRCUIT_BREAKER_WINDOW_MS + 'ms for tab="' +
        tabId + '" label="' + label + '" url="' + url +
        '". Spawn auto-disabled. Reload after fix.';
      try { console.error(msg); } catch (_) {}
      try { if (window.lexeraLog) window.lexeraLog('error', msg); } catch (_) {}
    }
    return MULTIVIEW_SPAWN_DISABLED;
  }
  // Verbose multiview tracing. Gated so the per-ensure / per-doSpawn
  // chatter doesn't flood the kanban stdout in normal runs. Enable via
  // URL param `?ws-debug=1` or by setting `localStorage['ws-debug']='1'`
  // so reproducing in a live session is possible without code changes.
  // ADOPT, BOOT, BEFOREUNLOAD markers always print — they're rare
  // enough to be useful baseline signal even with verbose off.
  var WS_DEBUG_VERBOSE = (function () {
    try {
      if (urlParams.get('ws-debug') === '1') return true;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('ws-debug') === '1') return true;
    } catch (_) {}
    return false;
  })();
  var _wsDebugSeq = 0;
  function wsDebug(msg, opts) {
    var force = !!(opts && opts.force);
    if (!force && !WS_DEBUG_VERBOSE) return;
    var seq = ++_wsDebugSeq;
    try {
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        window.__TAURI__.core.invoke('ws_debug_log', { message: '#' + seq + ' ' + String(msg) });
      }
    } catch (_) {}
  }
  function wsDebugForce(msg) { wsDebug(msg, { force: true }); }
  function ensureMultiviewWebview(tab, placeholderEl, desiredSrc) {
    if (!window.LexeraMultiview) return;
    if (MULTIVIEW_SPAWN_DISABLED || urlParams.get('mv-disable') === '1') {
      placeholderEl.classList.add('is-loaded');
      placeholderEl.innerHTML = '<div class="mv-error-msg" style="padding:12px;opacity:.6">multiview spawn disabled (kill-switch active)</div>';
      return;
    }
    var label = labelForTabObject(tab);
    var url = multiviewUrlForTab(desiredSrc);
    var _e = multiviewSpawnedTabs[tab.id];
    wsDebug('ensure tab=' + tab.id + ' label=' + label +
      ' entryState=' + (_e ? _e.state : 'none') +
      ' lock=' + (multiviewLabelSpawnLocks[label] ? 'yes' : 'no') +
      ' urlMatch=' + (_e && _e.url === url));
    if (noteEnsureCall(tab.id, label, url)) {
      placeholderEl.classList.add('is-loaded');
      placeholderEl.innerHTML = '<div class="mv-error-msg" style="padding:12px;opacity:.6">circuit breaker tripped — see log</div>';
      return;
    }

    // Optional safety inset (?multiview-inset=N): subtracts N pixels
    // from each side as a debug aid for divider-cover issues. Geometry
    // push uses the placeholder's exact float rect; Tauri rounds to
    // native pixels consistently so adjacent webviews and dividers
    // round the same way (no gaps, no overlaps).
    var MV_INSET = (function () {
      try {
        var p = new URLSearchParams(window.location.search || '');
        var v = parseInt(p.get('multiview-inset') || '0', 10);
        return Number.isFinite(v) && v >= 0 ? v : 0;
      } catch (_) { return 0; }
    })();
    function pushGeom() {
      if (placeholderEl.offsetParent === null) return;
      var r = placeholderEl.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      // Use the per-frame coalescer (Perf #2) so dock-divider drags
      // collapse N webviews × 1 IPC each into 1 batched IPC per frame.
      var update = {
        label: label,
        x: r.left + MV_INSET,
        y: r.top + MV_INSET,
        width: Math.max(1, r.width - 2 * MV_INSET),
        height: Math.max(1, r.height - 2 * MV_INSET)
      };
      if (typeof window.LexeraMultiview.pushGeomDeferred === 'function') {
        window.LexeraMultiview.pushGeomDeferred(update);
      } else {
        window.LexeraMultiview.setGeometry([update]).catch(function () {});
      }
    }
    // One-shot retry: when doSpawn() can't measure the placeholder yet
    // (dock collapsed, layout hasn't settled, etc.), wait for the next
    // visibility / resize signal then try again. Idempotent per tab —
    // the first signal disconnects all watchers and re-enters
    // ensureMultiviewWebview which goes back through doSpawn().
    function scheduleSpawnRetryWhenMeasurable() {
      if (multiviewSpawnRetryWatchers[tab.id]) return;
      var disposers = [];
      function fire() {
        if (!multiviewSpawnRetryWatchers[tab.id]) return;
        multiviewSpawnRetryWatchers[tab.id] = null;
        for (var i = 0; i < disposers.length; i++) {
          try { disposers[i](); } catch (_) {}
        }
        ensureMultiviewWebview(tab, placeholderEl, desiredSrc);
      }
      multiviewSpawnRetryWatchers[tab.id] = { fire: fire, disposers: disposers };
      if (typeof ResizeObserver !== 'undefined') {
        var ro = new ResizeObserver(function () {
          var rr = placeholderEl.getBoundingClientRect();
          if (placeholderEl.isConnected && placeholderEl.offsetParent !== null &&
              rr.width > 0 && rr.height > 0) fire();
        });
        try { ro.observe(placeholderEl); disposers.push(function () { ro.disconnect(); }); }
        catch (_) {}
      }
      if (typeof IntersectionObserver !== 'undefined') {
        var io = new IntersectionObserver(function (entries) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting && entries[i].intersectionRatio > 0) { fire(); return; }
          }
        });
        try { io.observe(placeholderEl); disposers.push(function () { io.disconnect(); }); }
        catch (_) {}
      }
      if (typeof MutationObserver !== 'undefined' && placeholderEl.parentNode) {
        var mo = new MutationObserver(function () {
          var rr = placeholderEl.getBoundingClientRect();
          if (placeholderEl.isConnected && placeholderEl.offsetParent !== null &&
              rr.width > 0 && rr.height > 0) fire();
        });
        try {
          mo.observe(placeholderEl, { attributes: true, attributeFilter: ['class', 'style'] });
          if (placeholderEl.parentNode) {
            mo.observe(placeholderEl.parentNode, { attributes: true, attributeFilter: ['class', 'style'] });
          }
          disposers.push(function () { mo.disconnect(); });
        } catch (_) {}
      }
      // Fallback: poll every 500ms for up to 10s in case observers miss
      // (e.g., display:none → display:block via ancestor; intermittent
      // layout). 20 attempts × 500ms = 10s total, way under the
      // circuit-breaker window.
      var polls = 0;
      var pollInterval = setInterval(function () {
        polls += 1;
        var rr = placeholderEl.getBoundingClientRect();
        if (placeholderEl.isConnected && placeholderEl.offsetParent !== null &&
            rr.width > 0 && rr.height > 0) {
          clearInterval(pollInterval);
          fire();
        } else if (polls >= 20) {
          clearInterval(pollInterval);
          // Give up quietly; the next render() that re-enters
          // ensureMultiviewWebview will re-arm via doSpawn → here.
          multiviewSpawnRetryWatchers[tab.id] = null;
          for (var i = 0; i < disposers.length; i++) {
            try { disposers[i](); } catch (_) {}
          }
        }
      }, 500);
      disposers.push(function () { clearInterval(pollInterval); });
    }
    function showSpawnErrorUi(err) {
      placeholderEl.classList.add('has-error');
      placeholderEl.classList.remove('is-loaded');
      placeholderEl.innerHTML =
        '<div class="mv-error-msg">Failed to load board webview.' +
        '<br><small>' + String(err && err.message || err).replace(/</g, '&lt;') + '</small>' +
        '<br><button type="button" data-mv-retry="1">Retry</button></div>';
      var retryBtn = placeholderEl.querySelector('[data-mv-retry]');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          placeholderEl.classList.remove('has-error');
          placeholderEl.innerHTML = '';
          delete multiviewSpawnedTabs[tab.id];
          ensureMultiviewWebview(tab, placeholderEl, desiredSrc);
        });
      }
    }
    function onSpawned() {
      multiviewSpawnedTabs[tab.id] = { url: url, state: 'ready', label: label };
      if (typeof window.lexeraLog === 'function') {
        window.lexeraLog('debug', '[multiview] spawned ' + label);
        // Diagnostic: log placeholder + ancestry geometry once. The
        // user reports every panel webview is ~20px short at the
        // bottom; this trace makes the SHELL-side measurements visible
        // so we can compare against the sub-app's own body rect (which
        // the sub-app logs via subAppRuntime). One-shot per spawn.
        setTimeout(function () {
          try {
            var pr = placeholderEl.getBoundingClientRect();
            var pcEl = placeholderEl.parentNode;
            var pcr = pcEl ? pcEl.getBoundingClientRect() : null;
            var tsEl = pcEl ? pcEl.parentNode : null;
            var tsr = tsEl ? tsEl.getBoundingClientRect() : null;
            var bodyRect = state.bodyEl ? state.bodyEl.getBoundingClientRect() : null;
            var rootRect = state.rootEl ? state.rootEl.getBoundingClientRect() : null;
            var winH = window.innerHeight;
            var docH = document.documentElement ? document.documentElement.clientHeight : null;
            window.lexeraLog('info',
              '[multiview/diag] ' + label +
              ' placeholder={t:' + pr.top.toFixed(1) + ',b:' + pr.bottom.toFixed(1) + ',h:' + pr.height.toFixed(1) + '}' +
              ' panel-content=' + (pcr ? '{t:' + pcr.top.toFixed(1) + ',b:' + pcr.bottom.toFixed(1) + ',h:' + pcr.height.toFixed(1) + '}' : 'null') +
              ' tabset=' + (tsr ? '{t:' + tsr.top.toFixed(1) + ',b:' + tsr.bottom.toFixed(1) + ',h:' + tsr.height.toFixed(1) + '}' : 'null') +
              ' shell-body=' + (bodyRect ? '{b:' + bodyRect.bottom.toFixed(1) + ',h:' + bodyRect.height.toFixed(1) + '}' : 'null') +
              ' shell-root=' + (rootRect ? '{b:' + rootRect.bottom.toFixed(1) + ',h:' + rootRect.height.toFixed(1) + '}' : 'null') +
              ' winH=' + winH + ' docH=' + docH);
          } catch (e) {
            window.lexeraLog('warn', '[multiview/diag] failed: ' + (e && e.message || e));
          }
        }, 250);
      }
      // Delay two frames so the browser can paint the spawning ring
      // transition before we mark loaded (otherwise the ring never
      // shows).
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          placeholderEl.classList.add('is-loaded');
        });
      });
      // Multi-step geometry push: spawn-time, next frame, and 50/200ms
      // later. Catches the case where the placeholder is briefly
      // mis-sized while the dock layout is still settling — common
      // during initial render and tab activation cascades.
      requestAnimationFrame(pushGeom);
      setTimeout(pushGeom, 50);
      setTimeout(pushGeom, 200);
      if (typeof ResizeObserver !== 'undefined' && !multiviewGeometryObservers[tab.id]) {
        var ro = new ResizeObserver(function () { pushGeom(); });
        ro.observe(placeholderEl);
        multiviewGeometryObservers[tab.id] = ro;
      }
      window.addEventListener('resize', pushGeom);
      watchPlaceholderVisibility(tab, placeholderEl, pushGeom);
    }
    function doSpawn() {
      wsDebug('doSpawn tab=' + tab.id + ' label=' + label +
        ' entryState=' + (multiviewSpawnedTabs[tab.id] ? multiviewSpawnedTabs[tab.id].state : 'none') +
        ' lock=' + (multiviewLabelSpawnLocks[label] ? 'yes' : 'no'));
      var r = placeholderEl.getBoundingClientRect();
      if (!placeholderEl.isConnected || placeholderEl.offsetParent === null || r.width <= 0 || r.height <= 0) {
        // Placeholder is in the DOM but not yet measurable — most often
        // because the dock it lives in is collapsed at boot or the layout
        // hasn't reflowed yet. Without a retry hook, doSpawn() silently
        // never fires for that tab and the placeholder shows "spawning…"
        // forever. Hook a one-shot watcher that re-attempts as soon as
        // the placeholder is connected, paint-visible, and >0×0.
        scheduleSpawnRetryWhenMeasurable();
        return;
      }
      var x = r.left;
      var y = r.top;
      var w = r.width;
      var h = r.height;
      traceWorkspaceShell(
        'spawn label=' + label +
        ' tab=' + tab.id +
        ' pos=(' + x + ', ' + y + ')' +
        ' size=(' + w + ', ' + h + ')' +
        ' active=' + placeholderEl.classList.contains('is-active') +
        ' connected=' + (!!placeholderEl.isConnected) +
        ' offsetParent=' + (placeholderEl.offsetParent ? 'set' : 'null')
      );
      // Label-level in-flight lock. The tab-keyed `multiviewSpawnedTabs`
      // state machine should already prevent duplicate spawns, but
      // runtime data (2026-04-26) shows two `multiview_spawn` IPCs racing
      // for the same label before the first resolves. The state machine
      // is per-tab.id; the lock below is per-label and adds a hard fence
      // so concurrent ensure() calls (regardless of trigger — render
      // restart, watcher fire, retry, etc.) all share the same promise
      // instead of issuing duplicate IPCs that hit "already exists".
      if (multiviewLabelSpawnLocks[label]) {
        wsDebugForce('DEDUPE label=' + label + ' (in-flight)');
        if (typeof window.lexeraLog === 'function') {
          window.lexeraLog('debug', '[multiview] spawn de-duplicated for ' + label);
        }
        multiviewLabelSpawnLocks[label].then(onSpawned).catch(function (err) {
          if (typeof window.lexeraLog === 'function') {
            window.lexeraLog('warn', '[multiview] de-dupe wait for ' + label + ' failed: ' + (err && err.message || err));
          }
        });
        return;
      }
      // Mark pending BEFORE the IPC call so render-loop re-entry sees
      // a spawn in flight and short-circuits. Carry the resolved label
      // so destroy paths can recover it without redoing the dispatch.
      // `attempts` accumulates across recovery cycles for this tab; it
      // is the loop-stop guard for the "already exists" retry path.
      var prior = multiviewSpawnedTabs[tab.id];
      var attempts = (prior && prior.attempts) ? prior.attempts : 0;
      multiviewSpawnedTabs[tab.id] = { url: url, state: 'pending', label: label, attempts: attempts };
      // Use lifecycle spawn so this board participates in LRU tracking
      // AND can repurpose a pre-warmed pool webview (Perf #1) — that
      // returns `{ label: '_pool_<n>', fromPool: true }` instead of a
      // freshly-spawned webview at the requested label.
      var lifecycleApi = window.LexeraMultiview.lifecycle;
      var args = { label: label, url: url, x: x, y: y, width: w, height: h };
      var spawnPromise = lifecycleApi && typeof lifecycleApi.spawn === 'function'
        ? lifecycleApi.spawn(args)
        : window.LexeraMultiview.spawn(args).then(function () {
            return { label: label, fromPool: false };
          });
      multiviewLabelSpawnLocks[label] = spawnPromise.finally
        ? spawnPromise.finally(function () { delete multiviewLabelSpawnLocks[label]; })
        : spawnPromise.then(
            function (r) { delete multiviewLabelSpawnLocks[label]; return r; },
            function (e) { delete multiviewLabelSpawnLocks[label]; throw e; }
          );
      spawnPromise.then(function (result) {
        // If the pool fast-path was taken, the actual webview lives at
        // `result.label` (e.g. `_pool_3`), NOT the formula label we
        // computed up front. Rebind the closure variable so all
        // subsequent operations (pushGeom, destroy, error UI retry)
        // address the correct webview.
        if (result && result.label && result.label !== label) {
          label = result.label;
          multiviewSpawnedTabs[tab.id].label = label;
        }
        onSpawned();
      }).catch(function (err) {
        console.warn('[ws-shell] multiview spawn failed for', tab.id, err);
        if (typeof window.lexeraLog === 'function') {
          window.lexeraLog('warn', '[multiview] spawn failed for ' + label + ': ' + (err && err.message || err));
        }
        var msg = String(err && err.message || err || '');
        if (/already exists/i.test(msg)) {
          // Runtime data (2026-04-26) showed the SHELL itself reloads
          // mid-session (cause unknown — webview is recreated without
          // beforeunload firing). Each reload, the fresh shell tries to
          // spawn webviews at the same labels its previous instance
          // already created. Old strategy: destroy and respawn. This
          // looped because the shell would reload again after the
          // respawn, hitting "already exists" again.
          //
          // New strategy: ADOPT. If the Rust registry already holds a
          // webview at this label, treat the spawn as effectively
          // succeeded — populate our local entry as 'ready' and run
          // onSpawned(). The previous shell session's webview is still
          // there, which is what we want anyway.
          wsDebugForce('ADOPT label=' + label + ' (already exists in Rust)');
          if (typeof window.lexeraLog === 'function') {
            window.lexeraLog('info', '[multiview] adopting pre-existing webview ' + label);
          }
          multiviewSpawnedTabs[tab.id] = { url: url, state: 'ready', label: label, attempts: 0 };
          onSpawned();
          return;
        }
        delete multiviewSpawnedTabs[tab.id];
        showSpawnErrorUi(err);
      });
    }

    var entry = multiviewSpawnedTabs[tab.id];
    if (!entry) {
      doSpawn();
      return;
    }
    if (entry.state === 'pending' || entry.state === 'destroying') {
      // An IPC op is already in flight for this tab. Whichever resolver
      // eventually runs will reconcile to the latest desired url via
      // the next render-driven ensureMultiviewWebview() call.
      return;
    }
    // entry.state === 'ready'
    if (entry.url !== url) {
      // URL change — destroy then respawn. Mark destroying first so
      // any concurrent ensure() short-circuits instead of stacking
      // additional spawn attempts on top.
      multiviewSpawnedTabs[tab.id] = { url: entry.url, state: 'destroying', label: label };
      noteLocalDestroy(label);
      window.LexeraMultiview.destroy(label).then(function () {
        delete multiviewSpawnedTabs[tab.id];
        ensureMultiviewWebview(tab, placeholderEl, desiredSrc);
      }).catch(function () {
        // Even on destroy failure, clear and retry — the next spawn
        // will surface the real error (or recover via "already exists").
        delete multiviewSpawnedTabs[tab.id];
        ensureMultiviewWebview(tab, placeholderEl, desiredSrc);
      });
      return;
    }
    // Already spawned at correct URL — refresh geometry only.
    requestAnimationFrame(pushGeom);
  }

  function destroyMultiviewWebview(tabId) {
    if (!window.LexeraMultiview) return;
    var entry = multiviewSpawnedTabs[tabId];
    // Recover the panel/board-correct label from the lifecycle entry.
    // Fallback to the board prefix only if no entry exists (the spawn
    // never registered, or already cleared) — this matches legacy
    // behavior for orphan-cleanup paths.
    var label = (entry && entry.label) || multiviewLabelForTab(tabId);
    // Disconnect placeholder observers immediately — the placeholder
    // is about to be removed from the DOM.
    if (multiviewGeometryObservers[tabId]) {
      try { multiviewGeometryObservers[tabId].disconnect(); } catch (_) {}
      delete multiviewGeometryObservers[tabId];
    }
    var _spawnRetry = multiviewSpawnRetryWatchers[tabId];
    if (_spawnRetry) {
      multiviewSpawnRetryWatchers[tabId] = null;
      var _disposers = _spawnRetry.disposers || [];
      for (var _ri = 0; _ri < _disposers.length; _ri++) {
        try { _disposers[_ri](); } catch (_) {}
      }
    }
    boardHost.cleanupVisibilityObserver(tabId);
    // Mark destroying BEFORE the IPC so a concurrent ensure() for the
    // same tab short-circuits instead of trying to spawn on top of a
    // half-torn-down webview. Keep the entry until Rust confirms.
    if (entry) {
      multiviewSpawnedTabs[tabId] = {
        url: entry.url,
        state: 'destroying',
        label: label
      };
    }
    noteLocalDestroy(label);
    window.LexeraMultiview.destroy(label).then(function () {
      delete multiviewSpawnedTabs[tabId];
    }).catch(function () {
      delete multiviewSpawnedTabs[tabId];
    });
  }

  // Local cleanup invoked when Rust unilaterally destroyed our
  // webview (LRU eviction or external destroy via the
  // `multiview-destroyed` event). Distinct from `destroyMultiviewWebview`
  // which initiates the destroy.
  function cleanupMultiviewLocalState(tabId) {
    if (multiviewGeometryObservers[tabId]) {
      try { multiviewGeometryObservers[tabId].disconnect(); } catch (_) {}
      delete multiviewGeometryObservers[tabId];
    }
    var _spawnRetry = multiviewSpawnRetryWatchers[tabId];
    if (_spawnRetry) {
      multiviewSpawnRetryWatchers[tabId] = null;
      var _disposers = _spawnRetry.disposers || [];
      for (var _ri = 0; _ri < _disposers.length; _ri++) {
        try { _disposers[_ri](); } catch (_) {}
      }
    }
    boardHost.cleanupVisibilityObserver(tabId);
    // Preserve a 'pending' entry: if a fresh spawn is in flight, this
    // destroy event refers to an earlier lifecycle and must not stomp
    // the new one.
    var entry = multiviewSpawnedTabs[tabId];
    if (!entry || entry.state !== 'pending') {
      delete multiviewSpawnedTabs[tabId];
    }
  }

  // Listen for multiview-destroyed broadcasts from Rust (LRU eviction
  // or external destroy) and clean up local state for any tab whose
  // webview was destroyed without our knowledge. Handles both
  // 'board-tab-' (board webviews) and 'panel-tab-' (panel webviews
  // hosted via Workstream P) prefixes.
  if (typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.event) {
    function isHostedTabLabel(label) {
      if (typeof label !== 'string') return false;
      if (label.indexOf('board-tab-') === 0) return true;
      if (label.indexOf('panel-tab-') === 0) return true;
      // Pool-derived labels: a `_pool_<n>` webview that has been
      // repurposed for a tab is registered in `multiviewSpawnedTabs`
      // with that label.
      var tabIds = Object.keys(multiviewSpawnedTabs);
      for (var i = 0; i < tabIds.length; i++) {
        if (multiviewSpawnedTabs[tabIds[i]].label === label) return true;
      }
      return false;
    }
    // Health dot updates
    window.__TAURI__.event.listen('health-changed', function (event) {
      var p = event && event.payload ? event.payload : {};
      var label = p.label || '';
      if (!isHostedTabLabel(label)) return;
      var tabId = tabIdFromLabel(label);
      applyHealthToTab(tabId, p.state);
    });
    window.__TAURI__.event.listen('multiview-destroyed', function (event) {
      var p = event && event.payload ? event.payload : {};
      var label = p.label || '';
      if (!isHostedTabLabel(label)) return;
      var locallyInitiated = consumeLocalDestroyAck(label);
      traceWorkspaceShell('destroyed label=' + label + ' local=' + locallyInitiated);
      wsDebugForce('multiview-destroyed event label=' + label + ' local=' + locallyInitiated);
      var tabId = tabIdFromLabel(label);
      cleanupMultiviewLocalState(tabId);
      if (locallyInitiated) return;
      // Auto-respawn if this tab is the active tab of an active leaf
      // (meaning the user currently sees its placeholder). Otherwise
      // lazy-spawn happens on next activateTab as usual.
      var foundTab = findTabInAllTrees(tabId);
      if (!foundTab || !foundTab.leaf) return;
      var isActiveInLeaf = foundTab.leaf.activeTabId === tabId;
      var isActiveLeaf = state.activeLeafId === foundTab.leaf.id;
      if (isActiveInLeaf && isActiveLeaf) {
        var placeholderEl = state.frameCache[tabId];
        if (placeholderEl && placeholderEl.getAttribute &&
            placeholderEl.getAttribute('data-multiview') === '1') {
          var desiredSrc;
          if (isPanelTab(foundTab.tab)) {
            var panelKind = getPanelKind(foundTab.tab.panelId);
            desiredSrc = panelHost.panelUrlForTab(foundTab.tab, panelKind, window.location.href);
          } else {
            desiredSrc = getEmbeddedUrlForTab(foundTab.tab);
          }
          if (typeof window.lexeraLog === 'function') {
            window.lexeraLog('info', '[multiview] auto-respawning ' + label +
              ' (destroyed while visible)');
          }
          // Defer one frame so Rust-side cleanup completes first.
          requestAnimationFrame(function () {
            ensureMultiviewWebview(foundTab.tab, placeholderEl, desiredSrc);
          });
        }
      }
    });
  }

  // Best-effort cleanup on main-window unload — destroys all board
  // child webviews we've spawned. Tauri should cascade cleanup when
  // the window closes anyway, but an explicit destroy minimizes
  // orphaned WebContent processes during dev/reload.
  if (typeof window !== 'undefined') {
    traceWorkspaceShell('boot href=' + window.location.href);
    // Marker fires on every IIFE init — useful for catching unexpected
    // shell reloads (`BOOT shell` lines should be exactly 1 per session).
    wsDebugForce('BOOT shell href=' + window.location.href + ' label=' +
      ((window.__TAURI__ && window.__TAURI__.webview && window.__TAURI__.webview.getCurrent && window.__TAURI__.webview.getCurrent().label) || '?'));
    window.addEventListener('beforeunload', function () {
      traceWorkspaceShell('beforeunload');
      wsDebugForce('BEFOREUNLOAD shell href=' + window.location.href);
      var tabIds = Object.keys(multiviewSpawnedTabs);
      for (var i = 0; i < tabIds.length; i++) {
        try { destroyMultiviewWebview(tabIds[i]); } catch (_) {}
      }
      // Also tear down ghost + modal windows if present
      if (window.LexeraMultiview && typeof window.LexeraMultiview.ghostHide === 'function') {
        try { window.LexeraMultiview.ghostHide(); } catch (_) {}
      }
    });
  }

  function getOrCreateFrame(tab, options) {
    var view = state.frameCache[tab.id];
    if (isPanelTab(tab)) {
      // Workstream P: every panel kind is hosted as a child webview.
      // Center-dock panels go through the same multiview placeholder
      // helper as side-dock panels (renderSideDockTabset).
      var panelId = resolvePanelTarget(tab.panelId);
      var panelKind = getPanelKind(panelId);
      if (!panelKind) return view || null;
      return buildMultiviewPanelPlaceholder(tab, panelId, panelKind);
    }
    var desiredSrc = getEmbeddedUrlForTab(tab);
    if (MULTIVIEW_BOARDS) {
      // Multiview path: placeholder div, child webview floats above
      if (!view) {
        view = document.createElement('div');
        view.className = 'workspace-shell-view workspace-shell-frame workspace-shell-multiview-placeholder';
        view.setAttribute('data-tab-id', tab.id);
        view.setAttribute('data-src', desiredSrc);
        view.setAttribute('data-multiview', '1');
        // Diagnostic skeleton (see buildMultiviewPanelPlaceholder for
        // rationale). Hidden by the child webview overlay once it spawns.
        view.innerHTML = '<div class="mv-placeholder-skeleton" style="' +
          'padding:10px;font-size:12px;font-family:monospace;color:#888;' +
          'pointer-events:none;user-select:none;">' +
          'board: <strong>' + String(tab.boardId || '(no boardId)').replace(/[<>&]/g, '?') + '</strong>' +
          '<br>tab: ' + String(tab.id).replace(/[<>&]/g, '?') +
          '<br>spawning…</div>';
        view.addEventListener('pointerdown', function () {
          activateTab(tab.id);
        });
        state.frameCache[tab.id] = view;
      }
      if (shouldLoadBoardFrame(tab, options)) {
        state.loadedBoardFrames[tab.id] = true;
        view.setAttribute('data-loaded-src', desiredSrc);
        requestAnimationFrame(function () {
          if (view.parentNode) ensureMultiviewWebview(tab, view, desiredSrc);
        });
      }
      return view;
    }
    if (!view) {
      view = document.createElement('iframe');
      view.className = 'workspace-shell-view workspace-shell-frame';
      view.setAttribute('data-tab-id', tab.id);
      view.setAttribute('title', getTabTitle(tab));
      view.setAttribute('data-src', desiredSrc);
      view.setAttribute('loading', 'lazy');
      view.addEventListener('pointerdown', function () {
        activateTab(tab.id);
      });
      state.frameCache[tab.id] = view;
      syncBoardFrameSource(view, tab, options);
      return view;
    }
    syncBoardFrameSource(view, tab, options);
    return view;
  }

  function removeFrame(tabId) {
    var frame = state.frameCache[tabId];
    if (!frame) return;
    if (MULTIVIEW_BOARDS && frame.getAttribute && frame.getAttribute('data-multiview') === '1') {
      destroyMultiviewWebview(tabId);
    }
    if (frame.parentNode) frame.parentNode.removeChild(frame);
    delete state.frameCache[tabId];
    delete state.loadedBoardFrames[tabId];
    state.deferredBoardLoadQueue = state.deferredBoardLoadQueue.filter(function (queuedTabId) {
      return queuedTabId !== tabId;
    });
  }

  function activateTab(tabId) {
    var found = findTabInAllTrees(tabId);
    if (!found) return false;
    var didChange = found.leaf.activeTabId !== tabId ||
      (found.treeId === 'center' && state.activeLeafId !== found.leaf.id);
    found.leaf.activeTabId = tabId;
    if (found.treeId === 'center') state.activeLeafId = found.leaf.id;
    render();
    if (didChange) notifyActiveBoardChanged();
    // Bump LRU freshness for multiview lifecycle so this webview is
    // not the next eviction candidate. Use the spawn entry's recorded
    // label so panel webviews touch their actual ('panel-tab-') label
    // rather than the board prefix.
    if (MULTIVIEW_BOARDS && window.LexeraMultiview &&
        window.LexeraMultiview.lifecycle &&
        typeof window.LexeraMultiview.lifecycle.touch === 'function') {
      var spawnEntry = multiviewSpawnedTabs[tabId];
      var touchLabel = (spawnEntry && spawnEntry.label) || labelForTabObject(found.tab);
      try { window.LexeraMultiview.lifecycle.touch(touchLabel); }
      catch (_) {}
    }
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

  // Panel-element registry — used INSIDE each panel webview when it
  // boots in panel-only mode (`?panelKind=<kind>`). The shell webview
  // itself spawns child webviews for each panel; the panel-only entry
  // inside each child webview then renders the legacy panel element
  // here, giving full feature parity (rich hierarchy tree, full
  // dashboard, etc.) without per-kind reimplementation.

  function ensurePanelElements() {
    if (state.panelElements) return state.panelElements;

    var hookPanels = state.hooks && typeof state.hooks.getPanelElements === 'function'
      ? (state.hooks.getPanelElements(getSharedPanelsApi()) || {})
      : {};

    var sidebarEl = hookPanels.hierarchy || document.querySelector('.layout > .sidebar') || document.querySelector('.sidebar');
    var dashboardEl = hookPanels.dashboard || document.getElementById('sidebar-dashboard');
    var dashboardDividerEl = document.getElementById('sidebar-dashboard-divider');
    var boardListEl = document.getElementById('board-list');
    var logPanelEl = hookPanels.logs || document.getElementById('log-panel');
    var sharedPanels = getSharedPanelsApi();
    var backendSettingsPanelEl = hookPanels.backendSettings || document.getElementById('backend-settings-panel') ||
      (sharedPanels ? sharedPanels.createPanelElement('backendSettings', 'backendSettings') : null);
    var frontendSettingsPanelEl = hookPanels.frontendSettings || document.getElementById('frontend-settings-panel') ||
      (sharedPanels ? sharedPanels.createPanelElement('frontendSettings', 'frontendSettings') : null);
    var renderAppsPanelEl = hookPanels.renderApps || (sharedPanels ? sharedPanels.createPanelElement('renderApps', 'renderApps') : null);
    var filesPanelEl = hookPanels.files || (sharedPanels ? sharedPanels.createPanelElement('files', 'files') : null);
    var frontendTestsPanelEl = hookPanels.frontendTests || (sharedPanels ? sharedPanels.createPanelElement('frontendTests', 'frontendTests') : null);
    // Eagerly create the calendar panels via sharedPanels so panel-only
    // webviews for weekCalendar / monthCalendar render immediately
    // (instead of waiting for getPanelElement's lazy fallback).
    var weekCalendarPanelEl = hookPanels.weekCalendar ||
      (sharedPanels ? sharedPanels.createPanelElement('weekCalendar', 'weekCalendar') : null);
    var monthCalendarPanelEl = hookPanels.monthCalendar ||
      (sharedPanels ? sharedPanels.createPanelElement('monthCalendar', 'monthCalendar') : null);

    if (!logPanelEl && sharedPanels && typeof sharedPanels.createPanelElement === 'function') {
      logPanelEl = sharedPanels.createPanelElement('logs', 'logs');
    }

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
      boardListEl.style.removeProperty('flex');
      boardListEl.style.removeProperty('height');
    }
    if (dashboardEl) {
      dashboardEl.style.removeProperty('flex');
      dashboardEl.style.removeProperty('height');
    }
    // Do NOT unhide logPanelEl here. The shell never reparents #log-panel
    // (Workstream P uses a child webview placeholder), so unhiding it
    // would leave the log content visible at body grid row 2 in every
    // webview — including panel-only webviews for unrelated kinds.
    // `renderPanelOnly` removes 'hidden' explicitly when it reparents
    // the target panel into the panel-only host.
    if (sidebarEl) sidebarEl.setAttribute('data-shell-panel', 'hierarchy');
    if (dashboardEl) dashboardEl.setAttribute('data-shell-panel', 'dashboard');
    if (logPanelEl) logPanelEl.setAttribute('data-shell-panel', 'logs');
    if (backendSettingsPanelEl) backendSettingsPanelEl.setAttribute('data-shell-panel', 'backendSettings');
    if (frontendSettingsPanelEl) frontendSettingsPanelEl.setAttribute('data-shell-panel', 'frontendSettings');
    if (renderAppsPanelEl) renderAppsPanelEl.setAttribute('data-shell-panel', 'renderApps');
    if (filesPanelEl) filesPanelEl.setAttribute('data-shell-panel', 'files');
    if (frontendTestsPanelEl) frontendTestsPanelEl.setAttribute('data-shell-panel', 'frontendTests');
    if (weekCalendarPanelEl) weekCalendarPanelEl.setAttribute('data-shell-panel', 'weekCalendar');
    if (monthCalendarPanelEl) monthCalendarPanelEl.setAttribute('data-shell-panel', 'monthCalendar');

    state.panelElements = {
      hierarchy: sidebarEl,
      dashboard: dashboardEl,
      logs: logPanelEl,
      backendSettings: backendSettingsPanelEl,
      frontendSettings: frontendSettingsPanelEl,
      renderApps: renderAppsPanelEl,
      files: filesPanelEl,
      frontendTests: frontendTestsPanelEl,
      weekCalendar: weekCalendarPanelEl,
      monthCalendar: monthCalendarPanelEl
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
    if (!kind) return null;
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
      var origClose = tab.querySelector('.ws-view-tab-close') || tab.querySelector('.ws-view-tab-menu');
      if (origClose) {
        var closeAction = origClose.getAttribute('data-ws-action');
        // Map burger menu action to close-tab for overflow menu
        if (closeAction === 'tab-menu') closeAction = 'close-tab';
        closeBtn.setAttribute('data-ws-action', closeAction || 'close-tab');
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
          '<span class="ws-view-tab-health" data-tab-id="' + escapeHtml(item.id) +
            '" data-health="unknown" title="Connection state: unknown"></span>' +
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

    // Header-level close button (always visible)
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

  /**
   * Build a header element for a side-dock tabset node.
   * Shared between renderSideDockTabset (full render) and
   * syncSideDockTabsetDom (incremental patch) — same pattern as
   * buildLeafHeader for center dock.
   */
  function buildSideDockHeader(node) {
    var activeTab = null;
    for (var i = 0; i < node.tabs.length; i++) {
      if (node.tabs[i].id === node.activeTabId) { activeTab = node.tabs[i]; break; }
    }
    if (!activeTab && node.tabs.length > 0) activeTab = node.tabs[0];
    var activePanelId = activeTab && isPanelTab(activeTab) ? resolvePanelTarget(activeTab.panelId) : '';
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
    return renderViewHeader({
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
  }

  /**
   * Workstream P helper: build (or reuse from cache) a multiview placeholder
   * for a side-dock panel tab whose kind is on the webview allowlist. The
   * placeholder is keyed by tab.id in state.frameCache so subsequent renders
   * reuse the same DOM node and don't churn the underlying webview.
   *
   * The placeholder also carries `data-shell-panel-instance` so the existing
   * `syncSideDockTabsetDom` patch logic — which keys panels by that attribute
   * — recognizes it on incremental updates.
   *
   * Schedules `ensureMultiviewWebview` via rAF so the spawn IPC fires AFTER
   * the placeholder is inserted in the DOM (the spawn reads getBoundingClientRect
   * for initial geometry).
   */
  function buildMultiviewPanelPlaceholder(tab, panelId, panelKind) {
    var view = state.frameCache[tab.id];
    var panelSrc = panelHost.panelUrlForTab(tab, panelKind, window.location.href);
    if (!view || !view.getAttribute || view.getAttribute('data-multiview') !== '1') {
      if (view && view.parentNode) view.parentNode.removeChild(view);
      view = document.createElement('div');
      view.className = 'workspace-shell-view workspace-shell-frame workspace-shell-multiview-placeholder';
      view.setAttribute('data-tab-id', tab.id);
      view.setAttribute('data-panel-id', panelId);
      view.setAttribute('data-panel-kind', panelKind);
      view.setAttribute('data-shell-panel-instance', panelId);
      view.setAttribute('data-src', panelSrc);
      view.setAttribute('data-multiview', '1');
      // Diagnostic skeleton — visible UNTIL the child webview overlays it.
      // Once the webview is positioned over the placeholder we don't see this
      // anymore, but if the spawn fails or geometry never pushes, the user
      // sees what kind it should be (instead of a blank rectangle) and can
      // tell us which kinds aren't materializing.
      view.innerHTML = '<div class="mv-placeholder-skeleton" style="' +
        'padding:10px;font-size:12px;font-family:monospace;color:#888;' +
        'pointer-events:none;user-select:none;">' +
        'panel: <strong>' + String(panelKind).replace(/[<>&]/g, '?') + '</strong>' +
        ' (' + String(panelId).replace(/[<>&]/g, '?') + ')' +
        '<br>tab: ' + String(tab.id).replace(/[<>&]/g, '?') +
        '<br>spawning…</div>';
      view.addEventListener('pointerdown', function () {
        activateTab(tab.id);
      });
      state.frameCache[tab.id] = view;
    }
    requestAnimationFrame(function () {
      if (view.parentNode) {
        ensureMultiviewWebview(tab, view, panelSrc);
      }
    });
    return view;
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

    var headerEl = buildSideDockHeader(node);
    tabsetEl.appendChild(headerEl);

    var contentEl = document.createElement('div');
    contentEl.className = 'workspace-shell-panel-content';
    // Workstream P: every panel kind is now hosted as a child webview.
    // For each panel tab, build a multiview placeholder. The webview is
    // spawned via ensureMultiviewWebview after insertion (rAF-deferred so
    // initial geometry is correct).
    for (var ci = 0; ci < node.tabs.length; ci++) {
      var panelTab = node.tabs[ci];
      if (!isPanelTab(panelTab)) continue;
      var panelId = resolvePanelTarget(panelTab.panelId);
      if (!panelId) continue;
      if (!state.panelVisibility[panelId]) continue;
      if (isPanelIntegrated(panelId)) continue;
      var panelKind = getPanelKind(panelId);
      if (!panelKind) continue;
      var insertEl = buildMultiviewPanelPlaceholder(panelTab, panelId, panelKind);
      insertEl.classList.toggle('is-active', panelTab.id === node.activeTabId);
      contentEl.appendChild(insertEl);
    }
    tabsetEl.appendChild(contentEl);

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

  function buildSideDockStructureSignature(dockId) {
    var tree = state.sideDocks[dockId];
    if (!tree || countTreeTabs(tree) === 0) return '';
    var sig = buildStructureSignature(tree);
    // Include dock size (affects snapshot logic) and fold state
    sig += '|ds:' + (state.dockSizes[dockId] || 0);
    var folds = [];
    visitTree(tree, function (node) {
      if (node.type !== 'tabs') return;
      if (state.foldedPanes[node.id]) folds.push(node.id);
    });
    if (folds.length) sig += '|fold:' + folds.join(',');
    // Include panel visibility (adding/removing panels requires rebuild)
    var visBits = [];
    visitTree(tree, function (node) {
      if (node.type !== 'tabs') return;
      for (var t = 0; t < node.tabs.length; t++) {
        if (isPanelTab(node.tabs[t])) {
          var pid = resolvePanelTarget(node.tabs[t].panelId);
          visBits.push(pid + ':' + (state.panelVisibility[pid] ? '1' : '0'));
        }
      }
    });
    sig += '|vis:' + visBits.join(',');
    return sig;
  }

  /**
   * Incrementally sync the DOM for a single side-dock tabset.
   * Handles panel count changes via targeted header replacement and
   * content patching — mirrors syncLeafDom for center docks and the
   * kanban's refreshTargetedElements pattern.
   */
  function syncSideDockTabsetDom(node, dockId) {
    var hostEl = dockId === 'left' ? state.leftDockEl :
                 dockId === 'right' ? state.rightDockEl : state.bottomDockEl;
    if (!hostEl) return false;
    var tabsetEl = hostEl.querySelector('.workspace-shell-tabset[data-node-id="' + node.id + '"]');
    if (!tabsetEl) return false;

    // Determine active tab for this tabset
    var activeTab = null;
    for (var i = 0; i < node.tabs.length; i++) {
      if (node.tabs[i].id === node.activeTabId) { activeTab = node.tabs[i]; break; }
    }
    if (!activeTab && node.tabs.length > 0) activeTab = node.tabs[0];
    var activePanelId = activeTab && isPanelTab(activeTab) ? resolvePanelTarget(activeTab.panelId) : '';

    // Update data-panel-id and is-active
    if (activePanelId) tabsetEl.setAttribute('data-panel-id', activePanelId);
    else tabsetEl.removeAttribute('data-panel-id');
    tabsetEl.classList.toggle('workspace-shell-panel-window-integrated', node.tabs.length === 1);
    var containsActive = false;
    for (var a = 0; a < node.tabs.length; a++) {
      if (isPanelTab(node.tabs[a]) && resolvePanelTarget(node.tabs[a].panelId) === state.activePanelId) {
        containsActive = true; break;
      }
    }
    tabsetEl.classList.toggle('is-active', containsActive);

    // ── Header: rebuild if tab count changed, else patch in place ──
    var headerEl = tabsetEl.querySelector('.ws-view-header');
    if (!headerEl) return false;
    var tabsEl = headerEl.querySelector('.ws-view-tabs');
    var tabBtns = tabsEl ? tabsEl.querySelectorAll('.ws-view-tab') : [];
    var headerNeedsRebuild = tabsEl
      ? tabBtns.length !== node.tabs.length
      : node.tabs.length > 1;

    if (headerNeedsRebuild) {
      var newHeader = buildSideDockHeader(node);
      tabsetEl.replaceChild(newHeader, headerEl);
      headerEl = newHeader;
    } else {
      // Patch header in place
      if (tabsEl) {
        for (var h = 0; h < node.tabs.length; h++) {
          var tab = node.tabs[h];
          var tabPanelId = isPanelTab(tab) ? resolvePanelTarget(tab.panelId) : '';
          var btnId = tabPanelId || tab.id;
          var btn = tabsEl.querySelector('.ws-view-tab[data-ws-panel-id="' + btnId + '"]');
          if (!btn) { headerNeedsRebuild = true; break; }
          btn.classList.toggle('is-active', tabPanelId === state.activePanelId);
        }
        if (headerNeedsRebuild) {
          var fallbackHeader = buildSideDockHeader(node);
          tabsetEl.replaceChild(fallbackHeader, headerEl);
          headerEl = fallbackHeader;
        }
      }
      var activeItemId = activePanelId || (activeTab ? activeTab.id : '');
      var dragEl = headerEl.querySelector('.ws-view-drag');
      if (dragEl) dragEl.setAttribute('data-ws-panel-drag-handle', activeItemId);
      var closeEl = headerEl.querySelector('.ws-view-close');
      if (closeEl) closeEl.setAttribute('data-ws-panel-id', activeItemId);
    }

    // ── Content: patch panel elements ──
    var contentEl = tabsetEl.querySelector('.workspace-shell-panel-content');
    if (!contentEl) return false;

    // Build expected panel list
    var expectedPanels = [];
    for (var ci = 0; ci < node.tabs.length; ci++) {
      var pt = node.tabs[ci];
      if (!isPanelTab(pt)) continue;
      var pid = resolvePanelTarget(pt.panelId);
      if (!pid || !state.panelVisibility[pid] || isPanelIntegrated(pid)) continue;
      expectedPanels.push({ panelId: pid, isActive: pt.id === node.activeTabId });
    }

    // Index existing panel instances
    var existingPanels = contentEl.querySelectorAll('[data-shell-panel-instance]');
    var existingMap = {};
    for (var ei = 0; ei < existingPanels.length; ei++) {
      existingMap[existingPanels[ei].getAttribute('data-shell-panel-instance')] = existingPanels[ei];
    }

    // Remove panels not in expected list
    var expectedIds = {};
    for (var ej = 0; ej < expectedPanels.length; ej++) expectedIds[expectedPanels[ej].panelId] = true;
    for (var removeId in existingMap) {
      if (!expectedIds[removeId]) existingMap[removeId].remove();
    }

    // Workstream P: mount missing panels as multiview placeholders. The
    // build helper handles caching by tab.id (state.frameCache) and
    // schedules ensureMultiviewWebview() so each panel runs in its own
    // child webview.
    var overlayEl = contentEl.querySelector('.workspace-shell-drop-overlay');
    for (var pi = 0; pi < expectedPanels.length; pi++) {
      var ep = expectedPanels[pi];
      var panelEl = existingMap[ep.panelId];
      if (!panelEl) {
        var tabForPanel = null;
        for (var tt = 0; tt < node.tabs.length; tt++) {
          var ptab = node.tabs[tt];
          if (isPanelTab(ptab) && resolvePanelTarget(ptab.panelId) === ep.panelId) {
            tabForPanel = ptab;
            break;
          }
        }
        if (!tabForPanel) continue;
        var panelKind = getPanelKind(ep.panelId);
        if (!panelKind) continue;
        panelEl = buildMultiviewPanelPlaceholder(tabForPanel, ep.panelId, panelKind);
        contentEl.insertBefore(panelEl, overlayEl);
      }
      panelEl.classList.toggle('is-active', ep.isActive);
    }

    return true;
  }

  function syncSideDockDom(dockId, hostEl) {
    if (!hostEl) return false;
    var tree = state.sideDocks[dockId];
    if (!tree || countTreeTabs(tree) === 0) return false;
    var success = true;
    var expectedLeafCount = 0;
    visitTree(tree, function (node) {
      if (node.type !== 'tabs') return;
      expectedLeafCount++;
      if (!syncSideDockTabsetDom(node, dockId)) success = false;
    });
    if (!success) return false;
    var renderedLeafCount = hostEl.querySelectorAll('.workspace-shell-tabset').length;
    return renderedLeafCount === expectedLeafCount;
  }

  function renderSideDock(dockId, hostEl) {
    if (!hostEl) return;
    var tree = state.sideDocks[dockId];
    hostEl.setAttribute('data-dock', dockId);
    if (!tree || countTreeTabs(tree) === 0) {
      hostEl.classList.add('is-hidden');
      hostEl.classList.remove('is-visible', 'is-folded', 'is-fold-hover');
      // Remove tree content but preserve fold strip
      var children = hostEl.children;
      for (var i = children.length - 1; i >= 0; i--) {
        if (!children[i].classList.contains('ws-fold-strip')) {
          hostEl.removeChild(children[i]);
        }
      }
      state.lastSideDockSignatures[dockId] = '';
      return;
    }
    var sig = buildSideDockStructureSignature(dockId);
    var hasContent = false;
    for (var c = 0; c < hostEl.children.length; c++) {
      if (!hostEl.children[c].classList.contains('ws-fold-strip')) { hasContent = true; break; }
    }
    // Try patching when signature matches exactly, OR when only panel
    // visibility/active state changed (leaf topology + fold/size unchanged).
    // Fold state and dock size changes require full rebuild because the
    // snapshot logic (cloneNode for folded dashboards) must run fresh.
    var exactMatch = sig === state.lastSideDockSignatures[dockId] && hasContent;
    if (exactMatch && syncSideDockDom(dockId, hostEl)) {
      return;
    }
    // Full rebuild — remove tree content but preserve fold strip
    var ch = hostEl.children;
    for (var j = ch.length - 1; j >= 0; j--) {
      if (!ch[j].classList.contains('ws-fold-strip')) {
        hostEl.removeChild(ch[j]);
      }
    }
    renderSideDockNode(tree, hostEl, dockId);
    state.lastSideDockSignatures[dockId] = sig;
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
      try { localStorage.setItem('lexera-dock-panel', kind); } catch (_) { /* intentional: localStorage unavailable in private browsing */ }
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
    var frame = getOrCreateFrame(found.tab, { shouldLoad: true });
    frame.setAttribute('data-src', '');
    frame.removeAttribute('data-loaded-src');
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
      var pointerId = event.pointerId;
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
      var rect = container.getBoundingClientRect();
      var pendingMoveEvent = null;
      var frameId = 0;
      try { dividerEl.setPointerCapture(pointerId); } catch (_) { /* ignore */ }
      dividerEl.classList.add('is-dragging');
      if (document && document.body) document.body.classList.add('is-dragging-layout');
      broadcastLayoutDragState(true);
      function applyMove(moveEvent) {
        if (axis === 'vertical') {
          splitNode.ratio = Math.max(0.18, Math.min(0.82, (moveEvent.clientX - rect.left) / Math.max(1, rect.width)));
        } else {
          splitNode.ratio = Math.max(0.18, Math.min(0.82, (moveEvent.clientY - rect.top) / Math.max(1, rect.height)));
        }
        applySplitContainerLayout();
      }
      function scheduleMove(moveEvent) {
        pendingMoveEvent = moveEvent;
        if (frameId) return;
        frameId = requestUiFrame(function () {
          frameId = 0;
          var queuedEvent = pendingMoveEvent;
          pendingMoveEvent = null;
          if (queuedEvent) applyMove(queuedEvent);
        });
      }
      function handleMove(moveEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        scheduleMove(moveEvent);
      }
      function handleUp(upEvent) {
        if (upEvent.pointerId !== pointerId) return;
        if (frameId) {
          cancelUiFrame(frameId);
          frameId = 0;
        }
        if (pendingMoveEvent) {
          applyMove(pendingMoveEvent);
          pendingMoveEvent = null;
        }
        dividerEl.classList.remove('is-dragging');
        if (document && document.body) document.body.classList.remove('is-dragging-layout');
        broadcastLayoutDragState(false);
        dividerEl.removeEventListener('pointermove', handleMove);
        dividerEl.removeEventListener('pointerup', handleUp);
        dividerEl.removeEventListener('pointercancel', handleUp);
        try { dividerEl.releasePointerCapture(pointerId); } catch (_) { /* ignore */ }
        render();
      }
      dividerEl.addEventListener('pointermove', handleMove);
      dividerEl.addEventListener('pointerup', handleUp);
      dividerEl.addEventListener('pointercancel', handleUp);
    });
  }

  function renderToolbar() {
    if (!state.toolbarEl) return;
    // Toolbar is currently always empty — skip clearing if already empty.
    if (state.toolbarEl.childNodes.length > 0) {
      state.toolbarEl.innerHTML = '';
    }
    state.toolbarEl.classList.add('is-empty');
  }

  function renderTabset(node, parentEl) {
    var tabsetEl = document.createElement('div');
    tabsetEl.className = 'workspace-shell-tabset workspace-shell-node';
    tabsetEl.setAttribute('data-node-id', node.id);
    if (node.id === state.activeLeafId) tabsetEl.classList.add('is-active');

    var headerEl = buildLeafHeader(node);
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
        // Load the active leaf's active tab immediately; other visible
        // panes are loaded via the deferred queue so the parent window's
        // initial poll (board list, workspaces) completes first.
        var isActiveInLeaf = node.tabs[j].id === node.activeTabId;
        var frame = getOrCreateFrame(node.tabs[j], {
          shouldLoad: isActiveInLeaf && node.id === state.activeLeafId
        });
        frame.classList.toggle('is-active', isActiveInLeaf);
        contentEl.appendChild(frame);
      }
    }
    tabsetEl.appendChild(contentEl);

    // Move logs status bar into ws-view-header so it's visible when folded
    var activeTabId = node.activeTabId || (node.tabs.length > 0 ? node.tabs[0].id : '');
    var activeTabObj = null;
    for (var lt = 0; lt < node.tabs.length; lt++) {
      if (node.tabs[lt].id === activeTabId) { activeTabObj = node.tabs[lt]; break; }
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

  // Panel-only mode renders a single panel as the entire window content.
  // This entry runs INSIDE each panel-tab child webview (URL pattern
  // `index.html?panelKind=<kind>&panelOnly=1`) and uses the legacy
  // `getPanelElement` to mount the FULL panel UI — same code that the
  // shell used to embed in-DOM, now running in its own webview process.
  // No multiview placeholder here: the placeholder lives in the SHELL
  // webview that spawned this child; we just render the panel content
  // directly into our document.
  function renderPanelOnly(panelId, hostEl) {
    if (!hostEl) return;
    hostEl.classList.add('workspace-shell-panel-only-host');

    // Patch: if the panel window already shows the right panel, only
    // ensure the panel element is mounted in the content slot.
    var existingWindow = hostEl.querySelector('.workspace-shell-panel-only-window[data-panel-id="' + panelId + '"]');
    if (existingWindow) {
      var existingContent = existingWindow.querySelector('.workspace-shell-panel-content');
      var panelEl = getPanelElement(panelId);
      if (existingContent && panelEl && panelEl.parentNode !== existingContent) {
        panelEl.classList.remove('hidden');
        panelEl.style.display = '';
        existingContent.appendChild(panelEl);
      }
      return;
    }

    // Full rebuild — different panel or first render
    hostEl.innerHTML = '';
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
    var panelEl2 = getPanelElement(panelId);
    if (panelEl2) {
      panelEl2.classList.remove('hidden');
      panelEl2.style.display = '';
      contentEl.appendChild(panelEl2);
    }
    panelWindowEl.appendChild(contentEl);
    hostEl.appendChild(panelWindowEl);
  }

  /**
   * Build a replacement header for a center-dock tabset leaf.
   * Factored out so both renderTabset() and syncLeafDom() use
   * the same header construction — mirroring the kanban pattern
   * where build*Element() helpers are shared between full render
   * and targeted refresh.
   */
  function buildLeafHeader(node) {
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
    var activeTabObj = null;
    for (var at = 0; at < node.tabs.length; at++) {
      if (node.tabs[at].id === activeTabId) { activeTabObj = node.tabs[at]; break; }
    }
    var centerFoldPanelId = activeTabObj && isPanelTab(activeTabObj)
      ? resolvePanelTarget(activeTabObj.panelId) : null;
    return renderViewHeader({
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
  }

  /**
   * Incrementally sync the DOM for a single leaf tabset.
   * Handles tab count changes by rebuilding just the header and
   * patching view frames — mirrors the kanban targeted-refresh pattern
   * (replaceChild for changed elements, preserve unchanged ones).
   */
  function syncLeafDom(node) {
    var tabsetEl = state.dockEl ? state.dockEl.querySelector('.workspace-shell-tabset[data-node-id="' + node.id + '"]') : null;
    if (!tabsetEl) return false;
    tabsetEl.classList.toggle('is-active', node.id === state.activeLeafId);

    var headerEl = tabsetEl.querySelector('.ws-view-header');
    var contentEl = tabsetEl.querySelector('.workspace-shell-pane-content');
    if (!headerEl || !contentEl) return false;

    var views = contentEl.querySelectorAll(':scope > .workspace-shell-view');
    var tabsEl = headerEl.querySelector('.ws-view-tabs');
    var tabCountChanged = views.length !== node.tabs.length;
    var headerStructureChanged = tabCountChanged ||
      (tabsEl ? tabsEl.querySelectorAll('.ws-view-tab').length !== node.tabs.length : node.tabs.length > 1);

    // ── Header: rebuild if tab count changed, else patch in place ──
    if (headerStructureChanged) {
      var newHeader = buildLeafHeader(node);
      tabsetEl.replaceChild(newHeader, headerEl);
      headerEl = newHeader;
      // Re-observe tab overflow after header replacement
      requestAnimationFrame(function () { updateTabOverflow(headerEl); });
    } else {
      // Patch header in place (no structural change)
      if (tabsEl) {
        var tabButtons = tabsEl.querySelectorAll('.ws-view-tab');
        for (var ti = 0; ti < node.tabs.length; ti++) {
          var tab = node.tabs[ti];
          var tabEl = tabButtons[ti];
          if (!tabEl) continue;
          tabEl.classList.toggle('is-active', tab.id === node.activeTabId);
          var labelEl = tabEl.querySelector('.ws-view-tab-label');
          if (labelEl) labelEl.textContent = getTabTitle(tab);
          var metaEl = tabEl.querySelector('.ws-view-tab-meta');
          if (metaEl) metaEl.textContent = getTabMetaLabel(tab);
        }
      } else {
        var titleEl = headerEl.querySelector('.ws-view-title');
        if (titleEl) titleEl.textContent = getTabTitle(node.tabs[0]);
      }
      // Keep header-level drag handle and close/menu button pointing at the active tab
      var activeId = node.activeTabId || (node.tabs.length > 0 ? node.tabs[0].id : '');
      var dragEl = headerEl.querySelector('.ws-view-drag');
      if (dragEl) dragEl.setAttribute('data-ws-tab-id', activeId);
      var closeOrMenuEl = headerEl.querySelector('.ws-view-close') || headerEl.querySelector('.ws-view-menu');
      if (closeOrMenuEl) closeOrMenuEl.setAttribute('data-ws-tab-id', activeId);
    }

    // ── Content: patch view frames (add/remove/reorder) ──
    // Build map of existing view frames by tab ID
    var existingViews = {};
    for (var vi = 0; vi < views.length; vi++) {
      var tid = views[vi].getAttribute('data-tab-id');
      if (tid) existingViews[tid] = views[vi];
    }

    // Remove views for tabs that no longer exist
    var expectedTabIds = {};
    for (var ei = 0; ei < node.tabs.length; ei++) {
      expectedTabIds[node.tabs[ei].id] = true;
    }
    for (var existId in existingViews) {
      if (!expectedTabIds[existId]) {
        existingViews[existId].remove();
      }
    }

    // Ensure each tab has a view frame in the correct order
    // (overlay div is always the first child of contentEl)
    var insertRef = contentEl.querySelector('.workspace-shell-drop-overlay');
    var afterEl = insertRef ? insertRef.nextSibling : contentEl.firstChild;

    for (var fi = 0; fi < node.tabs.length; fi++) {
      var frameTab = node.tabs[fi];
      var viewEl = existingViews[frameTab.id];
      var isActiveInLeaf = frameTab.id === node.activeTabId;
      if (!viewEl) {
        // New tab — create frame and insert; load active tab immediately
        viewEl = getOrCreateFrame(frameTab, {
          shouldLoad: isActiveInLeaf
        });
      }
      viewEl.classList.toggle('is-active', isActiveInLeaf);
      if (isPanelTab(frameTab)) {
        // Workstream P: panel tabs are multiview placeholders constructed
        // by getOrCreateFrame -> buildMultiviewPanelPlaceholder. The webview
        // spawn handles its own content; the shell only manages activation.
        viewEl.setAttribute('data-panel-id', resolvePanelTarget(frameTab.panelId));
      } else {
        syncBoardFrameSource(viewEl, frameTab, {
          shouldLoad: isActiveInLeaf
        });
      }
      // Ensure correct order: insert before the next sibling
      if (viewEl !== afterEl) {
        contentEl.insertBefore(viewEl, afterEl);
      } else {
        afterEl = afterEl ? afterEl.nextSibling : null;
      }
    }

    // Remove empty-state placeholder if tabs exist, add if not
    var emptyEl = contentEl.querySelector('.workspace-shell-empty');
    if (node.tabs.length === 0 && !emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'workspace-shell-empty';
      emptyEl.innerHTML = '<div><strong>Open a board from the sidebar</strong><br>Drag a tab onto a pane edge to split it, or drag a tab outside the window to detach it.</div>';
      contentEl.appendChild(emptyEl);
    } else if (node.tabs.length > 0 && emptyEl) {
      emptyEl.remove();
    }

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
      var leafTopology = buildLeafTopologySignature(state.dockTree);
      if (foldedKeys) leafTopology += '|fold:' + foldedKeys;
      var hasDom = state.dockEl.childNodes.length > 0;
      var exactMatch = structureSignature === state.lastStructureSignature && hasDom;
      // If exact match: lightweight sync (CSS classes, text, frame sources).
      // If only leaf topology matches: tabs changed within existing leaves —
      // syncLeafDom handles tab add/remove via targeted replaceChild, like
      // the kanban board's refreshTargetedElements pattern.
      // Full rebuild only when split structure itself changed.
      var patched = false;
      if (exactMatch || (leafTopology === state.lastLeafTopology && hasDom)) {
        patched = syncDomState();
      }
      if (!patched) {
        state.dockEl.innerHTML = '';
        renderNode(state.dockTree, state.dockEl);
      }
      state.lastStructureSignature = structureSignature;
      state.lastLeafTopology = leafTopology;
      if (state.dragTabId && state.dragHoverLeafId && state.dragHoverZone) {
        setDropZoneHighlight(state.dragHoverLeafId, state.dragHoverZone);
      }
    }
    renderPanelDocks();
    scheduleDeferredBoardFrameLoads();
    // Recalculate tab overflow after DOM updates
    requestAnimationFrame(function () {
      if (!state.rootEl) return;
      var headers = state.rootEl.querySelectorAll('.ws-view-header');
      for (var hi = 0; hi < headers.length; hi++) updateTabOverflow(headers[hi]);
    });
    // Note: do NOT call notifyActiveBoardChanged() from render() —
    // it causes cascading board switches during poll/board-list updates.
    // Board changes are notified from explicit user actions (tab click,
    // board open) via their own handlers.
    persistState();
    if (state.hooks && typeof state.hooks.onAfterRender === 'function') {
      state.hooks.onAfterRender();
    }
    // Re-apply known health dots to freshly-built tab headers.
    reapplyAllHealthDots();
  }

  function pruneMissingBoards() {
    var changed = false;
    var boardsAvailable = Object.keys(state.boardsById).length;
    // Don't prune when we have no board data — that means the backend
    // hasn't responded yet, not that all boards were deleted.
    if (boardsAvailable === 0) return false;
    visitTree(state.dockTree, function (node) {
      if (node.type !== 'tabs') return;
      for (var i = node.tabs.length - 1; i >= 0; i--) {
        if (!isBoardTab(node.tabs[i])) continue;
        if (!state.boardsById[node.tabs[i].boardId]) {
          console.warn('[ws-shell] pruneMissingBoards: removing tab for board ' + node.tabs[i].boardId + ' (not in ' + boardsAvailable + ' known boards)');
          removeFrame(node.tabs[i].id);
          node.tabs.splice(i, 1);
          changed = true;
        }
      }
    });
    if (changed) {
      state.dockTree = withNormalizedLeaves(state.dockTree, true);
      ensureActiveLeaf();
    }
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
      notifyActiveBoardChanged();
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
    notifyActiveBoardChanged();
    return tab;
  }

  function ensureInitialTab(boardId) {
    var leaf = getFirstLeaf(state.dockTree);
    if (leaf && leaf.tabs && leaf.tabs.length > 0) return false;
    if (!boardId) return false;
    openBoard(boardId, { preferExisting: true });
    return true;
  }

  function findCardPositionInBoardData(boardData, cardId) {
    if (!boardData || !boardData.rows || !cardId) return null;
    var rows = boardData.rows;
    for (var r = 0; r < rows.length; r++) {
      var stacks = rows[r] && rows[r].stacks ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        var columns = stacks[s] && stacks[s].columns ? stacks[s].columns : [];
        for (var c = 0; c < columns.length; c++) {
          var cards = columns[c] && columns[c].cards ? columns[c].cards : [];
          for (var i = 0; i < cards.length; i++) {
            if (cards[i] && String(cards[i].id) === cardId) {
              return { rowIndex: r, stackIndex: s, colLocalIndex: c, cardIndex: i };
            }
          }
        }
      }
    }
    return null;
  }

  function unfoldPathInContainer(container, rowIndex, stackIndex, colLocalIndex, target) {
    target = target || {};
    var rowEl = null;
    if (target.rowId) {
      rowEl = container.querySelector('.board-row[data-row-id="' + target.rowId + '"]');
    }
    if (!rowEl && typeof rowIndex === 'number') {
      rowEl = container.querySelector('.board-row[data-row-index="' + rowIndex + '"]');
    }
    if (rowEl && rowEl.classList.contains('folded')) rowEl.classList.remove('folded');

    var stackEl = null;
    if (target.stackId) {
      stackEl = container.querySelector('.board-stack[data-stack-id="' + target.stackId + '"]');
    }
    if (!stackEl && typeof rowIndex === 'number' && typeof stackIndex === 'number') {
      stackEl = container.querySelector('.board-stack[data-row-index="' + rowIndex + '"][data-stack-index="' + stackIndex + '"]');
    }
    if (stackEl && stackEl.classList.contains('folded')) stackEl.classList.remove('folded');

    var colEl = null;
    if (target.columnId) {
      colEl = container.querySelector('.column[data-column-id="' + target.columnId + '"]');
    }
    if (!colEl && typeof rowIndex === 'number' && typeof stackIndex === 'number' && typeof colLocalIndex === 'number') {
      colEl = container.querySelector('.column[data-row-index="' + rowIndex + '"][data-stack-index="' + stackIndex + '"][data-col-local-index="' + colLocalIndex + '"]');
    }
    if (colEl && colEl.classList.contains('folded')) colEl.classList.remove('folded');
  }

  function findTargetInIframeDOM(doc, target) {
    var container = doc.getElementById('columns-container');
    if (!container) return null;
    var el = null;
    if (target.cardId) {
      el = container.querySelector('.card[data-card-id="' + target.cardId + '"]');
    }
    if (!el && target.columnId) {
      el = container.querySelector('.column[data-column-id="' + target.columnId + '"]');
    }
    if (!el && target.stackId) {
      el = container.querySelector('.board-stack[data-stack-id="' + target.stackId + '"]');
    }
    if (!el && target.rowId) {
      el = container.querySelector('.board-row[data-row-id="' + target.rowId + '"]');
    }
    if (!el && typeof target.rowIndex === 'number' && typeof target.stackIndex === 'number' &&
        typeof target.colLocalIndex === 'number' && typeof target.cardIndex === 'number') {
      el = container.querySelector(
        '.column[data-row-index="' + target.rowIndex + '"][data-stack-index="' + target.stackIndex + '"][data-col-local-index="' + target.colLocalIndex + '"] ' +
        '.card[data-card-index="' + target.cardIndex + '"]'
      );
    }
    if (!el && typeof target.rowIndex === 'number' && typeof target.stackIndex === 'number' &&
        typeof target.colLocalIndex === 'number') {
      el = container.querySelector(
        '.column[data-row-index="' + target.rowIndex + '"][data-stack-index="' + target.stackIndex + '"][data-col-local-index="' + target.colLocalIndex + '"]'
      );
    }
    if (!el && target.brokenSrc) {
      var brokenEl = container.querySelector('[data-file-path="' + CSS.escape(target.brokenSrc) + '"]') ||
                     container.querySelector('[data-include-path="' + CSS.escape(target.brokenSrc) + '"]');
      if (brokenEl) el = brokenEl.closest('.card') || brokenEl.closest('.column') || brokenEl;
    }
    return el;
  }

  function deliverFocusTargetToFrame(frame, target, options) {
    if (!frame) return;
    options = options || {};
    // Multiview path: cross-process — the embedded board's
    // navigateToHierarchyTarget handles everything locally.
    if (MULTIVIEW_BOARDS && frame.getAttribute && frame.getAttribute('data-multiview') === '1') {
      var tabId = frame.getAttribute('data-tab-id');
      if (tabId && window.__TAURI__ && window.__TAURI__.core) {
        window.__TAURI__.core.invoke('multiview_emit_to', {
          target: multiviewLabelForTab(tabId),
          event: 'focus-hierarchy-target',
          payload: { target: target, options: options }
        }).catch(function () {});
      }
      return;
    }
    try {
      var doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
      if (!doc) return;
      var container = doc.getElementById('columns-container');
      if (!container) return;

      // If we have a cardId but no position, look it up in the iframe's board data
      if (target.cardId && target.rowIndex == null) {
        var iframeDash = frame.contentWindow && frame.contentWindow.LexeraDashboard;
        var boardData = iframeDash && typeof iframeDash.getFullBoardData === 'function'
          ? iframeDash.getFullBoardData()
          : null;
        var pos = findCardPositionInBoardData(boardData, target.cardId);
        if (pos) {
          target.rowIndex = pos.rowIndex;
          target.stackIndex = pos.stackIndex;
          target.colLocalIndex = pos.colLocalIndex;
          target.cardIndex = pos.cardIndex;
        }
      }

      // Unfold parent row/stack/column so the target becomes visible
      unfoldPathInContainer(container, target.rowIndex, target.stackIndex, target.colLocalIndex, target);

      // Focus helper: scroll + highlight via iframe's KeyboardNavigation
      var iframeKeyNav = frame.contentWindow && frame.contentWindow.LexeraKeyboardNavigation;
      function focusElement(el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (el.classList.contains('card') && iframeKeyNav && typeof iframeKeyNav.focusCard === 'function') {
          iframeKeyNav.focusCard(el);
        } else if (iframeKeyNav && typeof iframeKeyNav.focusBoardEntity === 'function') {
          iframeKeyNav.focusBoardEntity(el);
        }
      }

      // After focusing, optionally enter edit mode for the target entity.
      // Delegated to the iframe's own ActionRegistry so every editor hook and
      // save pipeline stays identical to an in-board interaction.
      function maybeEnterEditMode() {
        if (!options.edit) return;
        var iframeDash2 = frame.contentWindow && frame.contentWindow.LexeraDashboard;
        if (iframeDash2 && typeof iframeDash2.openEditForHierarchyTarget === 'function') {
          try { iframeDash2.openEditForHierarchyTarget(target); } catch (e) { /* ignore */ }
        }
      }

      // Find and scroll+focus the element
      var el = findTargetInIframeDOM(doc, target);
      if (el) {
        focusElement(el);
        maybeEnterEditMode();
        return;
      }
      // Element may need a render tick after unfolding
      setTimeout(function () {
        var el2 = findTargetInIframeDOM(doc, target);
        if (el2) focusElement(el2);
        maybeEnterEditMode();
      }, 60);
    } catch (e) { /* cross-origin or access error */ }
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
    var frame = getOrCreateFrame(tab, { shouldLoad: true });
    // Forward only the options keys that deliverFocusTargetToFrame needs so
    // unrelated focusHierarchyTarget options don't leak into the frame.
    var deliveryOptions = { edit: !!options.edit };
    // Store as pending so we can deliver it when the frame signals readiness via
    // lexera-pane-activated (handles the case where the tab is freshly opened and
    // the board frame hasn't initialized yet when the 60ms/220ms timeouts fire).
    state.pendingFocusTargets[tab.id] = { target: target, options: deliveryOptions };
    function sendFocus() {
      if (!frame || !frame.contentWindow) return;
      deliverFocusTargetToFrame(frame, target, deliveryOptions);
    }
    setTimeout(sendFocus, 60);
    setTimeout(function () {
      sendFocus();
      // Clear pending after the last heuristic attempt — if not delivered via
      // pane-activated by now, we've done our best.
      delete state.pendingFocusTargets[tab.id];
    }, 220);
    return true;
  }

  function handleWindowMessage(event) {
    var data = event && event.data;
    if (!data || !data.type) return;
    if (data.type === 'lexera-pane-activated') {
      var paneFound = findTabInAllTrees(data.pane);
      if (!paneFound) return;
      // Deliver any pending focus target for this pane. The board frame sends
      // lexera-pane-activated right after its JS initializes (before board data
      // loads), so the frame's message handler is already registered. The frame
      // handles the case where the board isn't loaded yet by calling selectBoard.
      var pendingEntry = state.pendingFocusTargets[data.pane];
      if (pendingEntry) {
        delete state.pendingFocusTargets[data.pane];
        var pendingFrame = state.frameCache[data.pane];
        if (pendingFrame && pendingFrame.contentWindow) {
          // Back-compat: accept both the old bare-target shape and the new
          // { target, options } shape in case anything else still sets a
          // pending focus directly.
          if (pendingEntry.target) {
            deliverFocusTargetToFrame(pendingFrame, pendingEntry.target, pendingEntry.options || {});
          } else {
            deliverFocusTargetToFrame(pendingFrame, pendingEntry, {});
          }
        }
      }
      if (data.pane) {
        postCatalogSnapshotToFrame(state.frameCache[data.pane]);
      }
      // Only activate if this pane isn't already the active tab in its leaf —
      // prevents cascade where loading an iframe triggers tab activation which
      // triggers board change notification which loads another board.
      if (paneFound.leaf.activeTabId === data.pane &&
          (paneFound.treeId !== 'center' || state.activeLeafId === paneFound.leaf.id)) {
        return;
      }
      activateTab(data.pane);
      return;
    }
    if (data.type === 'lexera-board-mutated') {
      var mutatedBoardId = data.boardId;
      if (mutatedBoardId) {
        var fullBoard = Object.prototype.hasOwnProperty.call(data, 'fullBoard') ? (data.fullBoard || null) : null;
        if (!fullBoard) {
          var mutatedFrame = data.pane ? state.frameCache[data.pane] : null;
          if (mutatedFrame && mutatedFrame.contentWindow) {
            try {
              var iframeApp = mutatedFrame.contentWindow.LexeraDashboard;
              fullBoard = iframeApp && typeof iframeApp.getFullBoardData === 'function'
                ? iframeApp.getFullBoardData()
                : null;
            } catch (e) { /* ignore */ }
          }
        }
        if (fullBoard && state.hooks && typeof state.hooks.refreshBoardHierarchy === 'function') {
          state.hooks.refreshBoardHierarchy(mutatedBoardId, fullBoard);
        }
        if (state.hooks && typeof state.hooks.refreshDashboard === 'function') {
          state.hooks.refreshDashboard(mutatedBoardId, fullBoard, data.pane || '');
        }
      }
      return;
    }
    if (data.type === 'lexera-pane-board-change') {
      var found = findTab(state.dockTree, data.pane);
      if (!found) return;
      var nextBoardId = data.boardId || found.tab.boardId;
      if (nextBoardId === found.tab.boardId) return;
      found.tab.boardId = nextBoardId;
      render();
      notifyActiveBoardChanged();
      return;
    }
    if (data.type === 'lexera-pane-set-view-kind') {
      if (!data.pane || !data.viewKind) return;
      setTabViewKind(data.pane, data.viewKind, { activate: true });
      return;
    }
    if (data.type === 'lexera-pane-dashboard-search') {
      var dashboardApp = window.LexeraDashboard;
      if (!dashboardApp || typeof dashboardApp.openDashboardSearch !== 'function') return;
      Promise.resolve(dashboardApp.openDashboardSearch(data.query, { forceLocal: true })).catch(function () {});
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
    var frame = getOrCreateFrame(activeTab, { shouldLoad: true });
    if (!frame) return false;
    if (frame.contentWindow) {
      frame.contentWindow.postMessage({
        type: 'lexera-board-action',
        action: action
      }, '*');
      return true;
    }
    // Multiview path: targeted Tauri event to the board's webview
    if (MULTIVIEW_BOARDS && frame.getAttribute && frame.getAttribute('data-multiview') === '1') {
      var label = multiviewLabelForTab(activeTab.id);
      if (window.__TAURI__ && window.__TAURI__.core) {
        window.__TAURI__.core.invoke('multiview_emit_to', {
          target: label,
          event: 'board-action',
          payload: { action: action }
        }).catch(function () {});
        return true;
      }
    }
    return false;
  }

  // Notify every embedded kanban frame that a layout-divider drag has started
  // or ended in the parent shell. Iframes toggle their own `body.is-dragging-layout`
  // so CSS `content-visibility` and observer short-circuits apply inside them too.
  function broadcastLayoutDragState(active) {
    var frameIds = Object.keys(state.frameCache || {});
    for (var i = 0; i < frameIds.length; i++) {
      var frame = state.frameCache[frameIds[i]];
      if (!frame) continue;
      if (frame.contentWindow) {
        try {
          frame.contentWindow.postMessage({
            type: 'lexera-layout-drag',
            active: !!active
          }, '*');
        } catch (e) { /* cross-origin or closed frame — ignore */ }
      }
    }
    // Multiview path: one global Tauri broadcast covers all child
    // webviews (each one's embedded bridge will translate to message).
    if (MULTIVIEW_BOARDS && window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core.invoke('multiview_broadcast', {
        event: 'layout-drag',
        payload: { active: !!active }
      }).catch(function () {});
    }
  }

  function normalizeCatalogSnapshot(snapshot) {
    snapshot = snapshot || {};
    return {
      boards: Array.isArray(snapshot.boards) ? snapshot.boards.slice() : [],
      remoteBoards: Array.isArray(snapshot.remoteBoards) ? snapshot.remoteBoards.slice() : [],
      workspaces: Array.isArray(snapshot.workspaces) ? snapshot.workspaces.slice() : [],
      activeWorkspaceId: String(snapshot.activeWorkspaceId || ''),
      activeWorkspace: snapshot.activeWorkspace && typeof snapshot.activeWorkspace === 'object'
        ? Object.assign({}, snapshot.activeWorkspace)
        : null,
      viewWorkspaceId: String(snapshot.viewWorkspaceId || ''),
      viewWorkspace: snapshot.viewWorkspace && typeof snapshot.viewWorkspace === 'object'
        ? Object.assign({}, snapshot.viewWorkspace)
        : null,
      workspaceViewMode: snapshot.workspaceViewMode === 'manual' ? 'manual' : 'follow-active-board'
    };
  }

  function postCatalogSnapshotToFrame(frame) {
    if (!frame || !frame.contentWindow) return false;
    var snapshot = normalizeCatalogSnapshot(state.catalogSnapshot);
    try {
      frame.contentWindow.postMessage({
        type: 'lexera-workspace-catalog',
        boards: snapshot.boards,
        remoteBoards: snapshot.remoteBoards,
        workspaces: snapshot.workspaces,
        activeWorkspaceId: snapshot.activeWorkspaceId,
        activeWorkspace: snapshot.activeWorkspace,
        viewWorkspaceId: snapshot.viewWorkspaceId,
        viewWorkspace: snapshot.viewWorkspace,
        workspaceViewMode: snapshot.workspaceViewMode
      }, '*');
      return true;
    } catch (e) {
      return false;
    }
  }

  function broadcastCatalogSnapshot() {
    var frameIds = Object.keys(state.frameCache);
    var snapshot = normalizeCatalogSnapshot(state.catalogSnapshot);
    for (var i = 0; i < frameIds.length; i++) {
      var frame = state.frameCache[frameIds[i]];
      if (!frame) continue;
      if (frame.tagName === 'IFRAME') {
        postCatalogSnapshotToFrame(frame);
      } else if (MULTIVIEW_BOARDS && frame.getAttribute && frame.getAttribute('data-multiview') === '1') {
        // Child webview path: broadcast via Tauri event so the
        // embedded board sub-app can subscribe and respond.
        if (window.LexeraMultiview && window.LexeraMultiview.broadcastCatalog) {
          window.LexeraMultiview.broadcastCatalog(snapshot);
        }
      }
    }
  }

  function showContextMenuInBoardFrame(boardId, scope, x, y, ctx) {
    if (!boardId) return false;
    var found = findLeafContainingBoard(state.dockTree, boardId);
    if (!found) return false;
    var frame = state.frameCache[found.tab.id];
    if (!frame) return false;
    // Multiview path: request/response IPC to the board webview
    if (MULTIVIEW_BOARDS && frame.getAttribute && frame.getAttribute('data-multiview') === '1') {
      if (!window.LexeraMultiview || typeof window.LexeraMultiview.request !== 'function') return false;
      var label = multiviewLabelForTab(found.tab.id);
      window.LexeraMultiview.request(label, 'build-context-menu', {
        scope: scope, context: ctx
      }, 1500).then(function (built) {
        if (!built || !built.items || built.items.length === 0) return;
        if (built.context && built.context.colIndex != null) ctx.colIndex = built.context.colIndex;
        if (state.hooks && typeof state.hooks.showNativeMenu === 'function') {
          state.hooks.showNativeMenu(built.items, x, y).then(function (action) {
            if (!action) return;
            // Send action back to the board for dispatch via its
            // LexeraActionRegistry.
            if (window.__TAURI__ && window.__TAURI__.core) {
              window.__TAURI__.core.invoke('multiview_emit_to', {
                target: label, event: 'dispatch-action',
                payload: { scope: scope, action: action, context: built.context }
              }).catch(function () {});
            }
          });
        }
      }).catch(function (err) {
        console.warn('[multiview ctxmenu] request failed:', err);
      });
      return true;
    }
    if (!frame.contentWindow) return false;
    try {
      var iframeApp = frame.contentWindow.LexeraDashboard;
      if (!iframeApp || typeof iframeApp.showElementContextMenu !== 'function') return false;
      // Use parent's Tauri IPC to show native menu, then dispatch in iframe
      var iframeRSM = frame.contentWindow.LexeraRowStackMenu;
      if (!iframeRSM || typeof iframeRSM.buildContextMenuItemsAndContext !== 'function') return false;
      var built = iframeRSM.buildContextMenuItemsAndContext(scope, ctx);
      // buildContextMenuItemsAndContext resolves colIndex from the iframe's
      // board data. Update ctx from the enriched context.
      if (built.context && built.context.colIndex != null) {
        ctx.colIndex = built.context.colIndex;
      }
      if (!built || !built.items || built.items.length === 0) return false;
      if (state.hooks && typeof state.hooks.showNativeMenu === 'function') {
        state.hooks.showNativeMenu(built.items, x, y).then(function (action) {
          if (!action) return;
          var iframeActionRegistry = frame.contentWindow.LexeraActionRegistry;
          if (iframeActionRegistry && typeof iframeActionRegistry.dispatch === 'function') {
            iframeActionRegistry.dispatch(scope, action, built.context);
          }
        });
        return true;
      }
    } catch (e) { /* cross-origin or access error */ }
    return false;
  }

  function getActiveBoardColumnsContainer() {
    var activeTab = getActiveTab();
    if (!activeTab || isPanelTab(activeTab)) return null;
    var frame = state.frameCache[activeTab.id] || getOrCreateFrame(activeTab, { shouldLoad: true });
    if (!frame) return null;
    try {
      var doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document) || null;
      if (!doc || typeof doc.getElementById !== 'function') return null;
      return doc.getElementById('columns-container');
    } catch (err) {
      return null;
    }
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
      var nextVisible = !isPanelShown(value);
      setPanelVisibility(value, nextVisible, { activate: true, restoreDock: nextVisible });
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

    var tabMenuBtn = event.target.closest('[data-ws-action="tab-menu"]');
    if (tabMenuBtn) {
      event.preventDefault();
      event.stopPropagation();
      showBoardTabMenu(tabMenuBtn.getAttribute('data-ws-tab-id'), tabMenuBtn);
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

  function showBoardTabMenu(tabId, anchorEl) {
    if (!tabId) return;
    var found = findTab(state.dockTree, tabId);
    if (!found) return;
    var tab = found.tab;
    var isBoardKind = tab.kind === 'board';
    var boardMeta = isBoardKind && tab.boardId ? state.boardsById[tab.boardId] : null;
    var boardFilePath = boardMeta ? boardMeta.filePath || '' : '';
    var items = [];

    if (isBoardKind) {
      var isKanban = tab.viewKind !== 'canvas';
      items.push({ id: 'set-layout:kanban', label: 'Kanban view', disabled: isKanban });
      items.push({ id: 'set-layout:canvas', label: 'Canvas view', disabled: !isKanban });
      items.push({ separator: true });
    }

    // Board actions (same as right-click on board in sidebar)
    if (isBoardKind) {
      items.push({ id: 'detach', label: 'Open in Detached Window' });
      if (boardFilePath) {
        items.push({ id: 'reveal', label: 'Reveal in Finder' });
      }
      items.push({ separator: true });
    }

    // Workspace layout actions
    items.push({ id: 'split-horizontal', label: 'Split Right' });
    items.push({ id: 'split-vertical', label: 'Split Down' });
    items.push({ separator: true });
    items.push({ id: 'close', label: 'Remove from Workspace' });

    var rect = anchorEl.getBoundingClientRect();
    if (typeof showNativeMenu !== 'function') return;
    showNativeMenu(items, rect.right, rect.bottom, 'menu.board-tab').then(function (action) {
      if (!action) return;
      if (action === 'close') {
        closeTab(tabId);
      } else if (action === 'detach') {
        detachTab(tabId);
      } else if (action === 'reveal' && boardFilePath) {
        if (typeof showInFinder === 'function') showInFinder(boardFilePath);
      } else if (action === 'split-horizontal') {
        activateTab(tabId);
        splitActivePane('horizontal');
      } else if (action === 'split-vertical') {
        activateTab(tabId);
        splitActivePane('vertical');
      } else if (action.indexOf('set-layout:') === 0) {
        var viewKind = action.substring('set-layout:'.length);
        setTabViewKind(tabId, viewKind, { activate: true });
      }
    });
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
    configureAllowedPanelKinds(
      state.hooks && typeof state.hooks.getAllowedPanelKinds === 'function'
        ? state.hooks.getAllowedPanelKinds()
        : null
    );
    state.panelOnlyKind = normalizePanelKind(state.panelOnlyKind);
    state.initialPanelKind = normalizePanelKind(state.initialPanelKind);
    state.panelInstances = createDefaultPanelInstances();
    state.sideDocks = createDefaultSideDocks(state.profile);
    state.panelVisibility = createDefaultPanelVisibility(state.profile);
    if (state.activePanelId && !normalizePanelKind(state.activePanelId)) {
      state.activePanelId = getFirstAllowedPanelKind();
    }

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
    state.backendConnected = !!document.querySelector('.connection-status-btn.connected');
    state.didRestoreState = restoreState();
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

  function onCatalogUpdated(snapshot) {
    state.catalogSnapshot = normalizeCatalogSnapshot(snapshot);
    onBoardsUpdated(state.catalogSnapshot.boards.concat(state.catalogSnapshot.remoteBoards));
    broadcastCatalogSnapshot();
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

  function resolveCycleTabTarget(leaf, direction) {
    if (!leaf || !Array.isArray(leaf.tabs) || leaf.tabs.length < 2) return '';
    var idx = -1;
    for (var i = 0; i < leaf.tabs.length; i++) {
      if (leaf.tabs[i].id === leaf.activeTabId) { idx = i; break; }
    }
    if (idx < 0) return '';
    return leaf.tabs[(idx + direction + leaf.tabs.length) % leaf.tabs.length].id;
  }

  function cycleTab(direction) {
    var leaf = getActiveLeaf();
    var nextTabId = resolveCycleTabTarget(leaf, direction);
    if (!nextTabId) return false;
    activateTab(nextTabId);
    return true;
  }

  function handleBoardAction(action) {
    // Diagnostic: surface every action that reaches the shell to the
    // in-app log so "menu doesn't open panels" is debuggable without
    // DevTools. Throttled by the lexeraLog ratelimiter on its end.
    try {
      if (typeof window.lexeraLog === 'function') {
        window.lexeraLog('debug', '[ws-shell] handleBoardAction(' + action +
          ') enabled=' + state.enabled + ' mounted=' + state.mounted +
          ' panelOnly=' + isPanelOnlyWindow());
      }
    } catch (_) {}
    if (!state.enabled || !state.mounted) return false;
    if (!action) return false;
    // Shell-management actions (panel reveals, layout commands) belong
    // to the SHELL webview only. Since menu-action is now broadcast to
    // every webview (so it reliably reaches the shell), panel-only
    // webviews and embedded-board webviews must opt out — otherwise
    // each panel webview would try to mutate its own (irrelevant) dock
    // tree and the user-visible action could double-handle.
    if (isPanelOnlyWindow()) {
      var shellOnlyPrefixes = ['toggle-panel:', 'reveal-panel:', 'set-board-layout:'];
      var shellOnlyActions = { 'split-disable': 1, 'split-enable': 1,
        'split-enable-vertical': 1, 'split-enable-horizontal': 1,
        'split-orientation': 1, 'next-tab': 1, 'prev-tab': 1,
        'close-active-tab': 1, 'new-window': 1 };
      var isShellOnlyPrefix = false;
      for (var pi = 0; pi < shellOnlyPrefixes.length; pi++) {
        if (action.indexOf(shellOnlyPrefixes[pi]) === 0) { isShellOnlyPrefix = true; break; }
      }
      if (isShellOnlyPrefix || shellOnlyActions[action]) return false;
    }
    if (action === 'close-active-tab') {
      var active = getActiveTab();
      if (active) closeTab(active.id);
      return true;
    }
    if (action === 'next-tab') { return cycleTab(1); }
    if (action === 'prev-tab') { return cycleTab(-1); }
    if (action === 'new-window') {
      openWorkspaceWindow();
      return true;
    }
    if (action.indexOf('toggle-panel:') === 0) {
      var toggleTarget = action.substring('toggle-panel:'.length);
      if (!PANEL_DEFINITIONS[getPanelKind(toggleTarget)]) return false;
      var nextVisible = !isPanelShown(toggleTarget);
      setPanelVisibility(toggleTarget, nextVisible, { activate: true, restoreDock: nextVisible });
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
    canHostBoardTabs: canHostBoardTabs,
    isPanelOnlyWindow: isPanelOnlyWindow,
    isHierarchyLauncherWindow: isHierarchyLauncherWindow,
    getWindowLabel: function () { return state.windowLabel || 'main'; },
    getHostWindowLabel: function () { return state.hostWindowLabel || state.windowLabel || 'main'; },
    mount: mount,
    render: render,
    onBoardsUpdated: onBoardsUpdated,
    onCatalogUpdated: onCatalogUpdated,
    openBoard: openBoard,
    focusWorkspace: function (workspaceId) {
      var boardList = (typeof window !== 'undefined' && window.LexeraBoardList) || null;
      if (!boardList || typeof boardList.focusWorkspaceView !== 'function') return false;
      boardList.focusWorkspaceView(workspaceId);
      return true;
    },
    ensureInitialTab: ensureInitialTab,
    focusHierarchyTarget: focusHierarchyTarget,
    showContextMenuInBoardFrame: showContextMenuInBoardFrame,
    handleBoardAction: handleBoardAction,
    revealPanel: function (panelId) {
      return setPanelVisibility(panelId, true, { activate: true });
    },
    setPanelVisibility: setPanelVisibility,
    movePanelToDock: movePanelToDock,
    movePanelToGroup: movePanelToGroup,
    openPanelInCenter: openPanelInCenter,
    duplicatePanel: duplicatePanel,
    closePanelView: closePanelView,
    isPanelVisible: isPanelShown,
    didRestoreState: function () { return !!state.didRestoreState; },
    revealPanel: revealPanel,
    collapsePanel: collapsePanel,
    restoreDock: restoreDock,
    collapseDock: collapseDock,
    getActiveBoardColumnsContainer: getActiveBoardColumnsContainer,
    getFrameWindowForBoard: getFrameWindowForBoard,
    getTabIdForBoard: getTabIdForBoard,
    _test_resolveCycleTabTarget: resolveCycleTabTarget
  };
})();
