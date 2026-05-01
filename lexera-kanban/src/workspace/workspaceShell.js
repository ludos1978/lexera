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
  var multiview = (typeof window !== 'undefined' && window.LexeraMultiviewWebview) || null;
  if (!multiview) {
    throw new Error('LexeraMultiviewWebview global is required before workspaceShell.js');
  }
  var messageBridge = (typeof window !== 'undefined' && window.LexeraMessageBridge) || null;
  if (!messageBridge) {
    throw new Error('LexeraMessageBridge global is required before workspaceShell.js');
  }
  messageBridge.setup({ multiview: multiview });
  var layoutPersistence = (typeof window !== 'undefined' && window.LexeraLayoutPersistence) || null;
  if (!layoutPersistence) {
    throw new Error('LexeraLayoutPersistence global is required before workspaceShell.js');
  }
  var tabDragController = (typeof window !== 'undefined' && window.LexeraTabDragController) || null;
  if (!tabDragController) {
    throw new Error('LexeraTabDragController global is required before workspaceShell.js');
  }
  var SIDE_DOCK_DIVIDER_SIZE_PX = 5;
  var BOTTOM_DOCK_DIVIDER_SIZE_PX = 5;
  var SPLIT_DIVIDER_SIZE_PX = 5;

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

  var panelDefs = (typeof window !== 'undefined' && window.LexeraPanelDefinitions) || null;
  if (!panelDefs) {
    throw new Error('LexeraPanelDefinitions global is required before workspaceShell.js');
  }
  panelDefs.setup({ nextId: nextId });

  // Local aliases follow the layoutTree convention used at the top of
  // this file — call `panelDefs.xxx` would force a refactor sweep we
  // don't need; the alias keeps the call-site shape stable while the
  // implementation lives in panelDefinitions.js.
  var PANEL_DEFINITIONS = panelDefs.PANEL_DEFINITIONS;
  var DEFAULT_PANEL_VISIBILITY = panelDefs.DEFAULT_PANEL_VISIBILITY;
  var getAllowedPanelKinds = panelDefs.getAllowedPanelKinds;
  var isPanelKindAllowed = panelDefs.isPanelKindAllowed;
  var configureAllowedPanelKinds = panelDefs.configureAllowedPanelKinds;
  var isPanelKindAllowedFromDefinitions = panelDefs.isPanelKindAllowedFromDefinitions;
  var getDefaultDockGroups = panelDefs.getDefaultDockGroups;
  var getFirstAllowedPanelKind = panelDefs.getFirstAllowedPanelKind;
  var normalizePanelKind = panelDefs.normalizePanelKind;
  var createDefaultPanelInstances = panelDefs.createDefaultPanelInstances;
  var normalizePanelInstances = panelDefs.normalizePanelInstances;
  var normalizePanelIdWithInstances = panelDefs.normalizePanelIdWithInstances;
  var clampPanelSize = panelDefs.clampPanelSize;
  var normalizeDockSizeValue = panelDefs.normalizeDockSizeValue;
  var createDefaultDockSizes = panelDefs.createDefaultDockSizes;
  var createDefaultDockRestoreSizes = panelDefs.createDefaultDockRestoreSizes;
  var normalizeDockSizes = panelDefs.normalizeDockSizes;
  var normalizeDockRestoreSizes = panelDefs.normalizeDockRestoreSizes;
  var createDefaultPanelVisibility = panelDefs.createDefaultPanelVisibility;
  var ensureUniquePanelIds = panelDefs.ensureUniquePanelIds;
  var normalizePanelDocks = panelDefs.normalizePanelDocks;
  var normalizePanelVisibility = panelDefs.normalizePanelVisibility;
  var createDefaultSideDocks = panelDefs.createDefaultSideDocks;


  // Tree registry: the four-tree iteration layer. Setup happens later
  // (after `state` is initialised), inside the same block that wires
  // the persistence module. The aliases here are populated then.
  var treeRegistry = (typeof window !== 'undefined' && window.LexeraTreeRegistry) || null;
  if (!treeRegistry) {
    throw new Error('LexeraTreeRegistry global is required before workspaceShell.js');
  }
  var allTreeIds, getTreeRoot, setTreeRoot, normalizeAllTrees;
  var findLeafInAllTrees, findTabInAllTrees, findPanelInAllTrees;
  function bindTreeRegistry() {
    treeRegistry.setup({
      state: state,
      layoutTree: layoutTree,
      withNormalizedLeaves: withNormalizedLeaves,
      resolvePanelTargetFn: function (value) { return resolvePanelTarget(value); }
    });
    allTreeIds = treeRegistry.allTreeIds;
    getTreeRoot = treeRegistry.getTreeRoot;
    setTreeRoot = treeRegistry.setTreeRoot;
    normalizeAllTrees = treeRegistry.normalizeAllTrees;
    findLeafInAllTrees = treeRegistry.findLeafInAllTrees;
    findTabInAllTrees = treeRegistry.findTabInAllTrees;
    findPanelInAllTrees = treeRegistry.findPanelInAllTrees;
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
    // Set by `open_new_window(origin_window=…)` when a panel-only
    // window is detached from a parent window. Used by
    // dockToMainWindow to send the dock-back event to that originator
    // only, instead of broadcasting to every workspace window.
    originWindow: String(urlParams.get('originWindow') || ''),
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
  // Bind treeRegistry now that `state` exists. Subsequent function
  // bodies can reference findTabInAllTrees / getTreeRoot / etc. as
  // direct module aliases (no per-call wrappers).
  bindTreeRegistry();

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

  // Display title for a panel id (kind or duplicated instance). Lives
  // here rather than in panelDefinitions because it reads
  // state.panelInstances to compute the instance index.
  function getPanelTitle(panelId) {
    var kind = getPanelKind(panelId);
    var definition = PANEL_DEFINITIONS[kind];
    if (!definition) return 'Panel';
    if (panelId === kind) return definition.title;
    var peers = getPanelInstanceIdsByKind(kind);
    var index = peers.indexOf(panelId);
    return index > 0 ? (definition.title + ' ' + (index + 1)) : definition.title;
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
      splitEl.style.gridTemplateColumns = firstSize + ' ' + SPLIT_DIVIDER_SIZE_PX + 'px ' + secondSize;
      splitEl.style.gridTemplateRows = '1fr';
    } else {
      splitEl.style.gridTemplateRows = firstSize + ' ' + SPLIT_DIVIDER_SIZE_PX + 'px ' + secondSize;
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

  function refreshMultiviewGeometryDuringDrag() {
    if (!multiview || typeof multiview.refreshAllGeometry !== 'function') return;
    multiview.refreshAllGeometry();
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
    if (layoutState.visible.left) leftCol = clampPanelSize('left', state.dockSizes.left) + 'px ' + SIDE_DOCK_DIVIDER_SIZE_PX + 'px ';
    else if (layoutState.folded.left) leftCol = FOLD_SIZE + 'px ';

    var rightCol = '';
    if (layoutState.visible.right) rightCol = ' ' + SIDE_DOCK_DIVIDER_SIZE_PX + 'px ' + clampPanelSize('right', state.dockSizes.right) + 'px';
    else if (layoutState.folded.right) rightCol = ' ' + FOLD_SIZE + 'px';

    state.mainRowEl.style.gridTemplateColumns =
      leftCol + 'minmax(0, 1fr)' + rightCol;

    var bottomDividerRow = ' 0px';
    var bottomDockRow = '';
    if (layoutState.visible.bottom) {
      bottomDividerRow = ' ' + BOTTOM_DOCK_DIVIDER_SIZE_PX + 'px';
      bottomDockRow = ' ' + clampPanelSize('bottom', state.dockSizes.bottom) + 'px';
    } else if (layoutState.folded.bottom) {
      bottomDockRow = ' ' + FOLD_SIZE + 'px';
    }

    state.bodyEl.style.gridTemplateRows =
      'minmax(0, 1fr)' + bottomDividerRow + bottomDockRow;
  }

  function syncBottomDividerPlacement(layoutState) {
    if (!state.bottomDividerEl) return;
    // Bottom divider now occupies a real grid row like the side dock dividers.
    // Clear any legacy absolute-positioning residue so the grid track is the
    // only source of truth for its hit area and visible spacing.
    state.bottomDividerEl.style.bottom = '';
  }

  function applyDockLayout() {
    var layoutState = getDockLayoutState();
    syncDockStructure(layoutState);
    syncDockGridTracks(layoutState);
    syncBottomDividerPlacement(layoutState);
    if (multiview && typeof multiview.refreshAllGeometry === 'function') {
      requestAnimationFrame(function () {
        multiview.refreshAllGeometry();
      });
    }
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
        syncBottomDividerPlacement(nextLayoutState);
        refreshMultiviewGeometryDuringDrag();
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
        layoutPersistence.persist();
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
      layoutPersistence.persist();
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

  // Reconcile an existing placeholder view with the current tab state.
  // The webview itself is owned by multiview.ensure() — the placeholder
  // only carries data-* attributes for diagnostics + tab activation.
  function syncBoardFrame(view, tab, options) {
    if (!view || !tab || isPanelTab(tab)) return;
    var desiredSrc = getEmbeddedUrlForTab(tab);
    var loadedSrc = view.getAttribute('data-loaded-src') || '';
    view.setAttribute('data-src', desiredSrc);
    view.setAttribute('title', getTabTitle(tab));
    if (!shouldLoadBoardFrame(tab, options)) return;
    state.loadedBoardFrames[tab.id] = true;
    if (loadedSrc === desiredSrc) return;
    view.setAttribute('data-loaded-src', desiredSrc);
    multiview.ensure(tab, view, desiredSrc);
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
      syncBoardFrame(frame, found.tab, { shouldLoad: true });
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

  // Multiview wiring: see workspace/multiviewWebview.js for the full
  // spawn/destroy/health/circuit-breaker implementation. Setup is
  // deferred so deps that read `state` and live shell helpers are
  // valid by the time IPC listeners attach.
  multiview.setup({
    traceShell: traceWorkspaceShell,
    getActiveLeafId: function () { return state.activeLeafId; },
    getPlaceholder: function (tabId) { return state.frameCache[tabId]; },
    findTabInAllTrees: findTabInAllTrees,
    isPanelTab: isPanelTab,
    getPanelKind: getPanelKind,
    getHostWindowLabel: function () { return state.hostWindowLabel || state.windowLabel || 'main'; },
    getEmbeddedUrlForTab: getEmbeddedUrlForTab
  });

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
    // Board tabs are always hosted by Tauri child webviews. The shell
    // creates a placeholder div; the actual webview is spawned by
    // multiview.ensure() and floats above it (geometry tracked).
    if (!view) {
      view = document.createElement('div');
      view.className = 'workspace-shell-view workspace-shell-frame workspace-shell-multiview-placeholder';
      view.setAttribute('data-tab-id', tab.id);
      view.setAttribute('data-src', desiredSrc);
      view.setAttribute('data-multiview', '1');
      view.setAttribute(
        'data-debug-shell-geometry',
        'board ' + String(tab.boardId || '(none)') + ' tab ' + String(tab.id) + ' pending'
      );
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
        if (view.parentNode) multiview.ensure(tab, view, desiredSrc);
      });
    }
    return view;
  }

  function removeFrame(tabId) {
    var frame = state.frameCache[tabId];
    if (!frame) return;
    if (frame.getAttribute && frame.getAttribute('data-multiview') === '1') {
      multiview.destroy(tabId);
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
    if (window.LexeraMultiview &&
        window.LexeraMultiview.lifecycle &&
        typeof window.LexeraMultiview.lifecycle.touch === 'function') {
      var touchLabel = multiview.spawnedLabel(tabId) || multiview.labelForTab(found.tab);
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

  function reorderTabInLeaf(tabId, leafId, targetIndex) {
    var found = findTabInAllTrees(tabId);
    if (!found || found.leaf.id !== leafId) return false;
    var currentIndex = found.index;
    if (currentIndex === targetIndex || currentIndex + 1 === targetIndex) return false;
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

  var OPEN_WORKSPACE_WINDOW_DEDUP_MS = 1200;
  var lastOpenWorkspaceWindowRequest = { key: '', at: 0 };

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

  function openWorkspaceWindow(workspaceId) {
    // workspaceId pins the new window to a single workspace — read by
    // app.js from the URL `workspace` param and applied as a locked
    // filter for the lifetime of that window. Omit to spawn a generic
    // workspace window that the user can switch around.
    var key = String(workspaceId || '');
    var now = Date.now();
    if (lastOpenWorkspaceWindowRequest.key === key &&
        now - lastOpenWorkspaceWindowRequest.at < OPEN_WORKSPACE_WINDOW_DEDUP_MS) {
      return Promise.resolve(false);
    }
    lastOpenWorkspaceWindowRequest = { key: key, at: now };
    var payload = { profile: 'workspace' };
    if (workspaceId) payload.workspaceId = String(workspaceId);
    return openWindow(payload).catch(function () {
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
    // The legacy `<div id="sidebar-dashboard">` was removed from
    // index.html (its hardcoded `.sidebar-dashboard` markup with
    // `min-height: 180px` from app.css was leaking layout space behind
    // the multiview webviews). Fall back to sharedPanels so the dashboard
    // panel element is always built on demand by the same factory the
    // other shared panels use.
    var dashboardDividerEl = document.getElementById('sidebar-dashboard-divider');
    var boardListEl = document.getElementById('board-list');
    var logPanelEl = hookPanels.logs || document.getElementById('log-panel');
    var sharedPanels = getSharedPanelsApi();
    var dashboardEl = hookPanels.dashboard || document.getElementById('sidebar-dashboard') ||
      (sharedPanels ? sharedPanels.createPanelElement('dashboard', 'dashboard') : null);
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
    if (!kind) {
      if (typeof window.lexeraLog === 'function') {
        window.lexeraLog('warn', '[workspaceShell.getPanelElement] returning null — could not derive kind for panel "' + normalized + '"');
      }
      return null;
    }
    var sharedPanels = getSharedPanelsApi();
    if (!sharedPanels || typeof sharedPanels.createPanelElement !== 'function') {
      if (typeof window.lexeraLog === 'function') {
        window.lexeraLog('warn', '[workspaceShell.getPanelElement] returning null — LexeraSharedPanels.createPanelElement missing at call time (boot order broken?)');
      }
      return null;
    }
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
      setShellOverlayActive(false);
    }
  }

  // Forward shell-DOM overlay open/close to the multiview module's
  // refcounted suppression. Native child webviews paint above the shell
  // DOM regardless of CSS z-index, so any popover that wants to render
  // on top must suppress them while it's open.
  function setShellOverlayActive(active) {
    if (window.LexeraMultiviewWebview &&
        typeof window.LexeraMultiviewWebview.setAllVisible === 'function') {
      window.LexeraMultiviewWebview.setAllVisible(!active);
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
      setShellOverlayActive(false);
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
        closeBtn.setAttribute('data-ws-action', origClose.getAttribute('data-ws-action') || 'close-tab');
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
    setShellOverlayActive(true);

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
    var isSingle = opts.items.length <= 1;
    el.className = 'ws-view-header' + (isSingle ? ' is-single' : '');

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

        // Per-item action button: \u00d7 close, identical for board and panel
        // tabs. Board context actions (open detached, reveal in finder,
        // split, set view kind, remove from workspace, \u2026) are reached
        // via right-click on the tab \u2014 see handleRootContextMenu.
        var itemActionHtml =
          '<button class="ws-view-tab-close" type="button" data-ws-action="' + escapeHtml(opts.closeAction) + '" ' +
            escapeHtml(opts.closeIdAttr) + '="' + escapeHtml(item.id) + '" title="Close">\u00d7</button>';
        tab.innerHTML =
          '<span class="ws-view-tab-label">' + escapeHtml(item.label) + '</span>' +
          (opts.showMeta && item.meta ? '<span class="ws-view-tab-meta">' + escapeHtml(item.meta) + '</span>' : '') +
          '<span class="ws-view-tab-health" data-tab-id="' + escapeHtml(item.id) +
            '" data-health="unknown" title="Connection state: unknown"></span>' +
          itemActionHtml;
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

    // Header-level action button (always visible) \u2014 \u00d7 close for every
    // tabset, matching the per-tab close. Board context actions live
    // on right-click (showBoardTabMenu) instead of a header burger.
    var headerActiveItem = null;
    for (var hi = 0; hi < opts.items.length; hi++) {
      if (opts.items[hi].id === opts.activeId) { headerActiveItem = opts.items[hi]; break; }
    }
    if (!headerActiveItem && opts.items.length > 0) headerActiveItem = opts.items[0];
    var headerBtn = document.createElement('button');
    headerBtn.className = 'ws-view-close';
    headerBtn.type = 'button';
    headerBtn.title = 'Close';
    headerBtn.setAttribute('data-ws-action', opts.closeAction);
    headerBtn.setAttribute(opts.closeIdAttr, opts.items.length > 0 ? opts.activeId : '');
    headerBtn.textContent = '\u00d7';
    el.appendChild(headerBtn);

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
      view.setAttribute(
        'data-debug-shell-geometry',
        'panel ' + String(panelKind) + ' tab ' + String(tab.id) + ' pending'
      );
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
        multiview.ensure(tab, view, panelSrc);
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

    // Side-dock tabsets render the shell header again so panel views have
    // a consistent drag handle / fold / close strip and grouped panels are
    // shown in an actual tabbed top bar. Single-item groups use the same
    // header component in its title mode (`is-single`).
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
    // Side-dock tabsets always keep a shell header. Multi-tab groups show
    // tabs; single-tab groups show the view title plus drag/fold/close
    // controls.
    var headerEl = tabsetEl.querySelector('.ws-view-header');
    if (!headerEl) {
      var contentHost = tabsetEl.querySelector('.workspace-shell-panel-content');
      var newHeaderEl = buildSideDockHeader(node);
      if (contentHost) tabsetEl.insertBefore(newHeaderEl, contentHost);
      else tabsetEl.appendChild(newHeaderEl);
      headerEl = newHeaderEl;
    }
    var tabsEl = headerEl ? headerEl.querySelector('.ws-view-tabs') : null;
    var tabBtns = tabsEl ? tabsEl.querySelectorAll('.ws-view-tab') : [];
    var headerNeedsRebuild = tabsEl
      ? tabBtns.length !== node.tabs.length
      : node.tabs.length !== 1;

    if (headerNeedsRebuild && headerEl) {
      var newHeader = buildSideDockHeader(node);
      tabsetEl.replaceChild(newHeader, headerEl);
      headerEl = newHeader;
    } else if (headerEl) {
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
    tabDragController.clearDropZones();
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
      height: panelRect ? Math.max(220, Math.round(panelRect.height)) : null,
      // Pass through this window's label as the panel-only window's
      // origin so `Dock` returns the panel HERE, not to every open
      // workspace window via broadcast.
      originWindow: state.windowLabel || 'main'
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
    var target = state.originWindow || '';
    var menuPayload = 'reveal-panel:' + kind;
    var dispatch = target
      ? invokeTauri('multiview_emit_to', {
          target: target,
          event: 'menu-action',
          payload: menuPayload
        })
      : tauriEmitAll('menu-action', menuPayload);
    dispatch.then(function () {
      closeCurrentWindow();
    }).catch(function () {
      // Fallback: store intent in localStorage and close. Each
      // surviving window will pick this up via the storage event and
      // reveal — best-effort, only fires when no targeted dispatch
      // succeeded.
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
          container.style.gridTemplateColumns = firstWeight + 'fr ' + SPLIT_DIVIDER_SIZE_PX + 'px ' + secondWeight + 'fr';
          container.style.gridTemplateRows = '1fr';
        } else {
          container.style.gridTemplateRows = firstWeight + 'fr ' + SPLIT_DIVIDER_SIZE_PX + 'px ' + secondWeight + 'fr';
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
        refreshMultiviewGeometryDuringDrag();
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
        meta: getTabMetaLabel(tab),
        // All tab kinds — board AND panel — render the × close button
        // for visual consistency. Board tab actions (open detached,
        // reveal in finder, split, set view kind, close from workspace
        // …) move to right-click → showBoardTabMenu so the per-tab
        // button stays a single, predictable close action.
        actionKind: 'close'
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
      // Keep header-level drag handle and close button pointing at the active tab
      var activeId = node.activeTabId || (node.tabs.length > 0 ? node.tabs[0].id : '');
      var dragEl = headerEl.querySelector('.ws-view-drag');
      if (dragEl) dragEl.setAttribute('data-ws-tab-id', activeId);
      var closeEl = headerEl.querySelector('.ws-view-close');
      if (closeEl) closeEl.setAttribute('data-ws-tab-id', activeId);
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
        syncBoardFrame(viewEl, frameTab, {
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
    layoutPersistence.persist();
    if (state.hooks && typeof state.hooks.onAfterRender === 'function') {
      state.hooks.onAfterRender();
    }
    // Re-apply known health dots to freshly-built tab headers.
    multiview.reapplyAllHealthDots();
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

  // Forward a hierarchy-focus request to the board webview that hosts
  // the target tab. The embedded board's `focus-hierarchy-target`
  // handler does the unfold + scroll + edit-mode work locally.
  function deliverFocusTargetToFrame(frame, target, options) {
    if (!frame) return;
    var tabId = frame.getAttribute && frame.getAttribute('data-tab-id');
    if (!tabId) return;
    messageBridge.focusHierarchy(tabId, target, options || {});
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
    // Forward only the option keys deliverFocusTargetToFrame needs so
    // unrelated focusHierarchyTarget options don't leak into the frame.
    var deliveryOptions = { edit: !!options.edit };
    // Store as pending so we can deliver when the frame signals
    // readiness via lexera-pane-activated (covers the freshly-opened
    // tab case where the webview hasn't initialised when the 60/220ms
    // timeouts fire).
    state.pendingFocusTargets[tab.id] = { target: target, options: deliveryOptions };
    function sendFocus() {
      deliverFocusTargetToFrame(frame, target, deliveryOptions);
    }
    setTimeout(sendFocus, 60);
    setTimeout(function () {
      sendFocus();
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
      // Newly-activated board may have spawned after the last catalog
      // broadcast — send a targeted snapshot so it has the workspace
      // context immediately rather than waiting for the next change.
      if (data.pane) {
        messageBridge.sendCatalog(data.pane, messageBridge.normalizeCatalog(state.catalogSnapshot));
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
        // Board webview owns its data — fullBoard is sent in the message.
        var fullBoard = Object.prototype.hasOwnProperty.call(data, 'fullBoard')
          ? (data.fullBoard || null)
          : null;
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
    messageBridge.broadcastBackendConnectionState(state.backendConnected);
  }

  function forwardActionToActiveFrame(action) {
    var activeTab = getActiveTab();
    if (!activeTab) return false;
    return messageBridge.boardAction(activeTab, action);
  }

  function broadcastLayoutDragState(active) {
    messageBridge.layoutDrag(active);
  }

  function broadcastCatalogSnapshot() {
    messageBridge.broadcastCatalog(messageBridge.normalizeCatalog(state.catalogSnapshot));
  }

  // Cross-process context menu: ask the board webview to build its
  // context-menu items, render the resulting native menu in the shell,
  // then route the chosen action back via dispatch-action.
  function showContextMenuInBoardFrame(boardId, scope, x, y, ctx) {
    if (!boardId) return false;
    var found = findLeafContainingBoard(state.dockTree, boardId);
    if (!found) return false;
    var tabId = found.tab.id;
    messageBridge.requestContextMenu(tabId, scope, ctx).then(function (built) {
      if (!built || !built.items || built.items.length === 0) return;
      if (built.context && built.context.colIndex != null) ctx.colIndex = built.context.colIndex;
      if (state.hooks && typeof state.hooks.showNativeMenu === 'function') {
        state.hooks.showNativeMenu(built.items, x, y).then(function (action) {
          if (!action) return;
          messageBridge.dispatchAction(tabId, scope, action, built.context);
        });
      }
    }).catch(function (err) {
      console.warn('[multiview ctxmenu] request failed:', err);
    });
    return true;
  }

  // Board DOM lives in a child webview; the shell cannot synchronously
  // inspect it. Callers (e.g. dashboard broken-element scanner) fall
  // back to their own local-document path when this returns null.
  function getActiveBoardColumnsContainer() { return null; }

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
    // Board tabs: right-click opens the full board context menu —
    // the same options that previously hung off the per-tab burger
    // (open detached, reveal in finder, split, set view kind, close
    // from workspace …). The per-tab × button only closes; this is
    // the discoverability path for board-specific actions.
    var boardTab = event.target.closest(
      '.ws-view-tab[data-ws-tab-id]:not([data-ws-panel-id])'
    );
    if (boardTab) {
      var boardTabId = boardTab.getAttribute('data-ws-tab-id');
      if (boardTabId) {
        event.preventDefault();
        event.stopPropagation();
        showBoardTabMenu(boardTabId, boardTab);
        return;
      }
    }

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
    state.rootEl.addEventListener('pointerdown', tabDragController.handlePointerDown, true);

    mainContent.appendChild(state.rootEl);
    window.addEventListener('message', handleWindowMessage);
    window.addEventListener('lexera-backend-connection-state-changed', handleBackendConnectionStateChanged);

    state.mounted = true;
    state.backendConnected = !!document.querySelector('.connection-status-btn.connected');
    // Sub-apps that just mounted (e.g., the log webview) request the
    // current connection state — without this they'd start as
    // "Disconnected" until the next state change broadcast.
    if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === 'function') {
      window.__TAURI__.event.listen('backend-connection-state-request', function () {
        messageBridge.broadcastBackendConnectionState(state.backendConnected);
      });
    }
    // Order matters: persistence first so its `persist` reference can
    // be passed to the drag controller's setup deps.
    layoutPersistence.setup({
      state: state,
      layoutTree: layoutTree,
      panelDefs: panelDefs,
      nextId: nextId,
      resolvePanelTarget: resolvePanelTarget,
      syncIntegratedPanelVisibility: syncIntegratedPanelVisibility,
      ensureActiveLeaf: ensureActiveLeaf
    });
    tabDragController.setup({
      state: state,
      getBody: getBody,
      findTabInAllTrees: findTabInAllTrees,
      findPanelInAllTrees: findPanelInAllTrees,
      moveTabToLeaf: moveTabToLeaf,
      moveTabToLeafAtIndex: moveTabToLeafAtIndex,
      splitLeafWithTab: splitLeafWithTab,
      splitLeafWithPanel: splitLeafWithPanel,
      placePanelInLeaf: placePanelInLeaf,
      reorderTabInLeaf: reorderTabInLeaf,
      movePanelToDock: movePanelToDock,
      detachTab: detachTab,
      detachPanelView: detachPanelView,
      activateTab: activateTab,
      activatePanel: activatePanel,
      resolvePanelTarget: resolvePanelTarget,
      getPanelTitle: getPanelTitle,
      getTabTitle: getTabTitle,
      clearPanelDropTargets: clearPanelDropTargets,
      setPanelDropTarget: setPanelDropTarget,
      isPointOutsideWorkspaceBounds: isPointOutsideWorkspaceBounds,
      renderToolbar: renderToolbar,
      notifyActiveBoardChanged: notifyActiveBoardChanged,
      persist: layoutPersistence.persist
    });
    state.didRestoreState = layoutPersistence.restore();
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
    state.catalogSnapshot = messageBridge.normalizeCatalog(snapshot);
    onBoardsUpdated(state.catalogSnapshot.boards.concat(state.catalogSnapshot.remoteBoards));
    broadcastCatalogSnapshot();
  }

  // Aliases that resolve to a reveal-panel of a fixed kind. Sourced
  // from menu commands that historically used different action names.
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

  // Actions that are SHELL-only — panel-only and embedded-board
  // webviews must not handle them. menu-action broadcasts to every
  // webview, so without this filter each panel webview would try to
  // mutate its own (irrelevant) dock tree and the user-visible action
  // could double-handle.
  var SHELL_ONLY_PREFIXES = ['toggle-panel:', 'reveal-panel:', 'set-board-layout:'];
  var SHELL_ONLY_EXACT = {
    'split-disable': 1, 'split-enable': 1, 'split-enable-vertical': 1,
    'split-enable-horizontal': 1, 'split-orientation': 1, 'next-tab': 1,
    'prev-tab': 1, 'close-active-tab': 1, 'new-window': 1
  };

  function isShellOnlyAction(action) {
    if (SHELL_ONLY_EXACT[action]) return true;
    for (var i = 0; i < SHELL_ONLY_PREFIXES.length; i++) {
      if (action.indexOf(SHELL_ONLY_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

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
    var nextTabId = resolveCycleTabTarget(getActiveLeaf(), direction);
    if (!nextTabId) return false;
    activateTab(nextTabId);
    return true;
  }

  // Exact-match action handlers. Each returns true if it handled the
  // action. Adding a new shell-level action means one entry here.
  var EXACT_ACTIONS = {
    'close-active-tab': function () {
      var active = getActiveTab();
      if (active) closeTab(active.id);
      return true;
    },
    'next-tab': function () { return cycleTab(1); },
    'prev-tab': function () { return cycleTab(-1); },
    'new-window': function () { openWorkspaceWindow(); return true; },
    'split-disable': function () { flattenToActiveLeaf(); return true; },
    // Layout-mode toggles are no-ops; the boards manage their own
    // split state and the shell only intercepts to swallow the menu
    // event so it doesn't fall through to forwardActionToActiveFrame.
    'split-enable': function () { return true; },
    'split-enable-vertical': function () { return true; },
    'split-enable-horizontal': function () { return true; },
    'split-orientation': function () { return true; }
  };

  // Prefix-match action handlers. Each receives the action body
  // (everything after the prefix). Returns true if handled.
  var PREFIX_ACTIONS = [
    { prefix: 'open-workspace:', handler: function (workspaceId) {
      if (!workspaceId) return false;
      openWorkspaceWindow(workspaceId);
      return true;
    } },
    { prefix: 'toggle-panel:', handler: function (target) {
      if (!PANEL_DEFINITIONS[getPanelKind(target)]) return false;
      if (isPanelShown(target)) {
        closePanelView(target);
      } else {
        setPanelVisibility(target, true, { activate: true, restoreDock: true });
      }
      return true;
    } },
    { prefix: 'reveal-panel:', handler: function (kind) {
      if (!PANEL_DEFINITIONS[kind]) return false;
      revealPanel(kind);
      return true;
    } },
    { prefix: 'set-board-layout:', handler: function (kind) {
      setActiveViewKind(kind);
      return true;
    } }
  ];

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
    if (!action || !state.enabled || !state.mounted) return false;
    if (isPanelOnlyWindow() && isShellOnlyAction(action)) return false;

    if (EXACT_ACTIONS[action]) return EXACT_ACTIONS[action]();
    for (var i = 0; i < PREFIX_ACTIONS.length; i++) {
      var entry = PREFIX_ACTIONS[i];
      if (action.indexOf(entry.prefix) === 0) {
        return entry.handler(action.substring(entry.prefix.length));
      }
    }
    if (ACTION_PANEL_ALIASES[action]) {
      revealPanel(ACTION_PANEL_ALIASES[action]);
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
    openWorkspaceWindow: openWorkspaceWindow,
    ensureInitialTab: ensureInitialTab,
    focusHierarchyTarget: focusHierarchyTarget,
    showContextMenuInBoardFrame: showContextMenuInBoardFrame,
    handleBoardAction: handleBoardAction,
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
