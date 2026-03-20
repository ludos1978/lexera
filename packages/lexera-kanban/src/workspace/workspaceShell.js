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

  function createTab(boardId, viewKind) {
    return {
      id: nextId('tab'),
      boardId: boardId || '',
      viewKind: normalizeViewKind(viewKind)
    };
  }

  var PANEL_DEFINITIONS = {
    hierarchy: { id: 'hierarchy', title: 'Workspaces', defaultDock: 'left', duplicable: true, integratedHeader: true },
    dashboard: { id: 'dashboard', title: 'Dashboard', defaultDock: 'right', duplicable: true, integratedHeader: true },
    logs: { id: 'logs', title: 'Logs', defaultDock: 'bottom', duplicable: true, integratedHeader: true },
    backendSettings: { id: 'backendSettings', title: 'Backend Settings', defaultDock: 'right', duplicable: false },
    frontendSettings: { id: 'frontendSettings', title: 'Frontend Settings', defaultDock: 'right', duplicable: false }
  };

  function createDefaultPanelInstances() {
    return {
      hierarchy: { id: 'hierarchy', kind: 'hierarchy' },
      dashboard: { id: 'dashboard', kind: 'dashboard' },
      logs: { id: 'logs', kind: 'logs' },
      backendSettings: { id: 'backendSettings', kind: 'backendSettings' },
      frontendSettings: { id: 'frontendSettings', kind: 'frontendSettings' }
    };
  }

  function createDefaultPanelDocks() {
    return {
      left: ['hierarchy'],
      right: ['dashboard'],
      bottom: ['logs']
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
      left: 300,
      right: 320,
      bottom: 240
    };
  }

  function createDefaultDockRestoreSizes(profile) {
    return createDefaultDockSizes(profile === 'detachedBoard' ? 'workspace' : profile);
  }

  function clampPanelSize(dockId, value) {
    var number = typeof value === 'number' && isFinite(value) ? value : null;
    if (number == null) return createDefaultDockSizes()[dockId];
    if (dockId === 'bottom') return Math.max(140, Math.min(480, Math.round(number)));
    return Math.max(220, Math.min(520, Math.round(number)));
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

  function createDefaultPanelWeights() {
    return {
      left: { hierarchy: 1 },
      right: { dashboard: 1 },
      bottom: { logs: 1 }
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

  function normalizePanelWeights(raw) {
    var defaults = createDefaultPanelWeights();
    var dockIds = ['left', 'right', 'bottom'];
    var result = { left: {}, right: {}, bottom: {} };
    var source = raw && typeof raw === 'object' ? raw : {};
    for (var i = 0; i < dockIds.length; i++) {
      var dockId = dockIds[i];
      var defaultDockWeights = defaults[dockId];
      var rawDockWeights = source[dockId] && typeof source[dockId] === 'object' ? source[dockId] : {};
      var panelIds = Object.keys(defaultDockWeights).concat(Object.keys(rawDockWeights));
      for (var j = 0; j < panelIds.length; j++) {
        var panelId = String(panelIds[j] || '');
        if (!panelId) continue;
        var rawValue = rawDockWeights[panelId];
        var fallback = defaultDockWeights[panelId] || 1;
        var nextValue = typeof rawValue === 'number' && isFinite(rawValue) ? rawValue : fallback;
        result[dockId][panelId] = Math.max(0.25, nextValue);
      }
    }
    return result;
  }

  function createDefaultPanelVisibility(profile) {
    return {
      hierarchy: true,
      dashboard: true,
      logs: true,
      backendSettings: false,
      frontendSettings: false
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
    var defaults = createDefaultPanelDocks();
    var result = { left: [], right: [], bottom: [] };
    var seen = {};
    var dockOrder = ['left', 'right', 'bottom'];
    for (var i = 0; i < dockOrder.length; i++) {
      var dockId = dockOrder[i];
      var source = raw ? raw[dockId] : null;
      var panelIds = [];
      if (Array.isArray(source)) {
        panelIds = ensureUniquePanelIds(source, seen, panelInstances);
      } else if (source && typeof source === 'object' && Array.isArray(source.tabIds)) {
        panelIds = ensureUniquePanelIds(source.tabIds, seen, panelInstances);
      }
      if (panelIds.length === 0) panelIds = ensureUniquePanelIds(defaults[dockId], seen, panelInstances);
      result[dockId] = panelIds;
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
    windowLabel: String(urlParams.get('windowLabel') || 'main'),
    dockTree: createTabsetNode([]),
    panelInstances: createDefaultPanelInstances(),
    panelDocks: createDefaultPanelDocks(),
    dockSizes: createDefaultDockSizes(urlParams.get('profile') === 'detachedBoard' ? 'detachedBoard' : 'workspace'),
    dockRestoreSizes: createDefaultDockRestoreSizes(urlParams.get('profile') === 'detachedBoard' ? 'detachedBoard' : 'workspace'),
    panelWeights: createDefaultPanelWeights(),
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
    leftMarkerEl: null,
    leftDockEl: null,
    leftDividerEl: null,
    dockEl: null,
    rightDividerEl: null,
    rightDockEl: null,
    rightMarkerEl: null,
    bottomDividerEl: null,
    bottomDockEl: null,
    bottomMarkerEl: null,
    panelDropOverlayEl: null,
    lastStructureSignature: '',
    panelElements: null,
    panelPointerDrag: null,
    panelDragHoverDock: '',
    dragTabId: '',
    dragDroppedInternally: false,
    dragHoverLeafId: '',
    dragHoverZone: '',
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
    state.panelDocks = { left: [], right: [], bottom: [] };
    state.dockSizes.left = 0;
    state.dockSizes.right = 0;
    state.dockSizes.bottom = 0;
    state.activePanelId = state.panelOnlyId;
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
          return {
            id: tab.id,
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

  function hydrateNode(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.type === 'tabs') {
      var tabs = [];
      var rawTabs = Array.isArray(raw.tabs) ? raw.tabs : [];
      for (var i = 0; i < rawTabs.length; i++) {
        if (!rawTabs[i] || typeof rawTabs[i].boardId !== 'string' || !rawTabs[i].boardId) continue;
        tabs.push({
          id: String(rawTabs[i].id || nextId('tab')),
          boardId: rawTabs[i].boardId,
          viewKind: normalizeViewKind(rawTabs[i].viewKind)
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
      first: hydrateNode(raw.first),
      second: hydrateNode(raw.second)
    };
  }

  function persistState() {
    if (!state.mounted) return;
    try {
      var storage = getPersistenceStorage();
      storage.setItem(getPersistenceKey(), JSON.stringify({
        version: 3,
        profile: state.profile,
        panelInstances: state.panelInstances,
        panelDocks: state.panelDocks,
        dockSizes: state.dockSizes,
        dockRestoreSizes: state.dockRestoreSizes,
        panelWeights: state.panelWeights,
        panelVisibility: state.panelVisibility,
        activePanelId: state.activePanelId || '',
        activeLeafId: state.activeLeafId || '',
        dockTree: serializeNode(state.dockTree)
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
      if (!parsed || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3)) return false;
      if (parsed.profile && parsed.profile !== state.profile) return false;
      state.dockTree = hydrateNode(parsed.dockTree) || createTabsetNode([]);
      state.dockTree = withNormalizedLeaves(state.dockTree, true);
      state.panelInstances = normalizePanelInstances(parsed.panelInstances);
      state.panelDocks = normalizePanelDocks(parsed.panelDocks, state.profile, state.panelInstances);
      state.dockSizes = normalizeDockSizes(parsed.dockSizes, state.profile);
      state.dockRestoreSizes = normalizeDockRestoreSizes(parsed.dockRestoreSizes, state.profile);
      state.panelWeights = normalizePanelWeights(parsed.panelWeights);
      state.panelVisibility = normalizePanelVisibility(parsed.panelVisibility, state.profile, state.panelInstances);
      state.activePanelId = resolvePanelTarget(parsed.activePanelId) || state.activePanelId;
      state.activeLeafId = String(parsed.activeLeafId || '');
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
      var dockId = dockIds[i];
      var panelIds = Array.isArray(state.panelDocks[dockId]) ? state.panelDocks[dockId] : [];
      if (panelIds.indexOf(normalized) !== -1) return dockId;
    }
    return '';
  }

  function isPanelShown(panelId) {
    var normalized = String(panelId || '');
    if (state.panelInstances[normalized]) {
      if (!state.panelVisibility[normalized]) return false;
      var dockId = getDockForPanel(normalized);
      if (!dockId) return false;
      return state.dockSizes[dockId] > 0;
    }
    var kind = normalizePanelKind(normalized);
    if (!kind) return false;
    var panelIds = getPanelInstanceIdsByKind(kind);
    for (var i = 0; i < panelIds.length; i++) {
      if (isPanelShown(panelIds[i])) return true;
    }
    return false;
  }

  function getVisiblePanelIdsForDock(dockId) {
    var dock = state.panelDocks[dockId];
    if (!Array.isArray(dock)) return [];
    var result = [];
    for (var i = 0; i < dock.length; i++) {
      var panelId = resolvePanelTarget(dock[i]);
      if (!panelId) continue;
      if (!state.panelVisibility[panelId]) continue;
      result.push(panelId);
    }
    return result;
  }

  function ensurePanelDockActives() {
    prunePanelWeights();
    if (!state.panelVisibility[state.activePanelId]) {
      state.activePanelId = '';
      var dockOrder = ['left', 'right', 'bottom'];
      for (var i = 0; i < dockOrder.length; i++) {
        var panelIds = state.panelDocks[dockOrder[i]] || [];
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

  function ensurePanelWeightEntry(dockId, panelId) {
    if (!state.panelWeights[dockId]) state.panelWeights[dockId] = {};
    if (!(state.panelWeights[dockId][panelId] > 0)) {
      state.panelWeights[dockId][panelId] = 1;
    }
  }

  function prunePanelWeights() {
    var dockIds = ['left', 'right', 'bottom'];
    for (var i = 0; i < dockIds.length; i++) {
      var dockId = dockIds[i];
      var weights = state.panelWeights[dockId] || {};
      var panelIds = Array.isArray(state.panelDocks[dockId]) ? state.panelDocks[dockId] : [];
      for (var j = 0; j < panelIds.length; j++) {
        ensurePanelWeightEntry(dockId, panelIds[j]);
      }
      var weightKeys = Object.keys(weights);
      for (var k = 0; k < weightKeys.length; k++) {
        if (panelIds.indexOf(weightKeys[k]) === -1) {
          delete weights[weightKeys[k]];
        }
      }
    }
  }

  function getPanelWeight(dockId, panelId) {
    ensurePanelWeightEntry(dockId, panelId);
    return state.panelWeights[dockId][panelId];
  }

  function getDockVisiblePanelIds(dockId) {
    var panelIds = getVisiblePanelIdsForDock(dockId);
    if (panelIds.length === 0) return [];
    return panelIds;
  }

  function isDockCollapsed(dockId) {
    return getDockVisiblePanelIds(dockId).length > 0 && state.dockSizes[dockId] === 0;
  }

  function getHiddenReopenPanelIdsForDock(dockId) {
    if (isPanelOnlyWindow()) return [];
    if (state.profile !== 'workspace') return [];
    var panelKinds = ['hierarchy', 'dashboard', 'logs'];
    var result = [];
    for (var i = 0; i < panelKinds.length; i++) {
      var kind = panelKinds[i];
      var definition = PANEL_DEFINITIONS[kind];
      if (!definition || definition.defaultDock !== dockId) continue;
      if (isPanelShown(kind)) continue;
      var primaryPanelId = getPrimaryPanelId(kind);
      if (!primaryPanelId) continue;
      result.push(primaryPanelId);
    }
    return result;
  }

  function dedupeMarkerPanelIds(panelIds) {
    var result = [];
    var seenKinds = {};
    var seenIds = {};
    var list = Array.isArray(panelIds) ? panelIds : [];
    for (var i = 0; i < list.length; i++) {
      var panelId = resolvePanelTarget(list[i]);
      if (!panelId || seenIds[panelId]) continue;
      var kind = getPanelKind(panelId);
      if (!kind) continue;
      if (isPanelKindDuplicable(kind)) {
        if (seenKinds[kind]) continue;
        seenKinds[kind] = true;
        panelId = getPrimaryPanelId(kind) || panelId;
      }
      seenIds[panelId] = true;
      result.push(panelId);
    }
    return result;
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

  function revealPanel(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;
    var dockId = getDockForPanel(normalized);
    if (!dockId) {
      var kind = getPanelKind(normalized);
      dockId = kind && PANEL_DEFINITIONS[kind] ? PANEL_DEFINITIONS[kind].defaultDock : 'left';
      state.panelDocks[dockId].push(normalized);
    }
    state.panelVisibility[normalized] = true;
    state.activePanelId = normalized;
    return restoreDock(dockId, normalized);
  }

  function collapsePanel(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;
    var dockId = getDockForPanel(normalized);
    if (!dockId) return false;
    return collapseDock(dockId);
  }

  function closePanelView(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;
    var kind = getPanelKind(normalized);
    if (!kind) return false;
    if (normalized === kind) {
      return collapsePanel(normalized);
    }
    var dockIds = ['left', 'right', 'bottom'];
    for (var i = 0; i < dockIds.length; i++) {
      var dockPanels = state.panelDocks[dockIds[i]] || [];
      var index = dockPanels.indexOf(normalized);
      if (index !== -1) dockPanels.splice(index, 1);
    }
    delete state.panelInstances[normalized];
    delete state.panelVisibility[normalized];
    if (state.activePanelId === normalized) state.activePanelId = '';
    if (state.panelElements && state.panelElements[normalized]) {
      var panelEl = state.panelElements[normalized];
      if (panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
      delete state.panelElements[normalized];
    }
    var sharedPanels = getSharedPanelsApi();
    if (sharedPanels && typeof sharedPanels.unregisterInstance === 'function') {
      sharedPanels.unregisterInstance(normalized);
    }
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
    var dockId = getDockForPanel(sourcePanelId) || PANEL_DEFINITIONS[kind].defaultDock;
    var dockPanels = state.panelDocks[dockId] || (state.panelDocks[dockId] = []);
    var sourceIndex = dockPanels.indexOf(sourcePanelId);
    if (sourceIndex === -1) dockPanels.push(newPanelId);
    else dockPanels.splice(sourceIndex + 1, 0, newPanelId);
    state.panelVisibility[newPanelId] = true;
    if (!state.panelWeights[dockId]) state.panelWeights[dockId] = {};
    state.panelWeights[dockId][newPanelId] = getPanelWeight(dockId, sourcePanelId);
    state.activePanelId = newPanelId;
    restoreDock(dockId, newPanelId);
    return newPanelId;
  }

  function renderCollapsedDockMarker(dockId, hostEl) {
    if (!hostEl) return;
    hostEl.innerHTML = '';
    hostEl.className = 'workspace-shell-collapsed-marker-strip';
    hostEl.setAttribute('data-dock', dockId);
    var panelIds = [];
    var collapsedDockPanelIds = getDockVisiblePanelIds(dockId);
    if (collapsedDockPanelIds.length > 0 && state.dockSizes[dockId] === 0) {
      panelIds = panelIds.concat(collapsedDockPanelIds);
    }
    var hiddenPanelIds = getHiddenReopenPanelIdsForDock(dockId);
    for (var i = 0; i < hiddenPanelIds.length; i++) {
      if (panelIds.indexOf(hiddenPanelIds[i]) === -1) panelIds.push(hiddenPanelIds[i]);
    }
    panelIds = dedupeMarkerPanelIds(panelIds);
    if (panelIds.length === 0) {
      hostEl.classList.remove('is-visible');
      return;
    }
    hostEl.classList.add('is-visible');
    for (var i = 0; i < panelIds.length; i++) {
      var panelId = panelIds[i];
      var markerBtn = document.createElement('button');
      markerBtn.className = 'workspace-shell-collapsed-marker';
      markerBtn.type = 'button';
      markerBtn.setAttribute('data-ws-action', 'expand-collapsed-dock');
      markerBtn.setAttribute('data-ws-dock-id', dockId);
      markerBtn.setAttribute('data-ws-panel-id', panelId);
      markerBtn.textContent = getPanelTitle(panelId);
      hostEl.appendChild(markerBtn);
    }
  }

  function applyPanelDockLayout(stackEl, dockId, visibleIds) {
    if (!stackEl) return;
    var axis = dockId === 'bottom' ? 'horizontal' : 'vertical';
    var templateParts = [];
    for (var i = 0; i < visibleIds.length; i++) {
      var panelId = visibleIds[i];
      templateParts.push(Math.max(0.25, getPanelWeight(dockId, panelId)).toFixed(4) + 'fr');
      if (i < visibleIds.length - 1) templateParts.push(axis === 'horizontal' ? '6px' : '6px');
    }
    if (axis === 'horizontal') {
      stackEl.style.gridTemplateColumns = templateParts.join(' ');
      stackEl.style.gridTemplateRows = '1fr';
    } else {
      stackEl.style.gridTemplateRows = templateParts.join(' ');
      stackEl.style.gridTemplateColumns = '1fr';
    }
  }

  function bindPanelDockDivider(dividerEl, dockId, beforePanelId, afterPanelId, axis, stackEl, visibleIds) {
    if (!dividerEl) return;
    dividerEl.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      dividerEl.setPointerCapture(event.pointerId);
      dividerEl.classList.add('is-dragging');
      var beforeWeight = getPanelWeight(dockId, beforePanelId);
      var afterWeight = getPanelWeight(dockId, afterPanelId);
      var totalWeight = beforeWeight + afterWeight;
      var beforeWindow = dividerEl.previousElementSibling;
      var afterWindow = dividerEl.nextElementSibling;
      var startRect = beforeWindow && afterWindow ? {
        left: beforeWindow.getBoundingClientRect().left,
        top: beforeWindow.getBoundingClientRect().top,
        right: afterWindow.getBoundingClientRect().right,
        bottom: afterWindow.getBoundingClientRect().bottom
      } : null;
      function handleMove(moveEvent) {
        if (!startRect) return;
        var ratio;
        if (axis === 'horizontal') {
          ratio = (moveEvent.clientX - startRect.left) / Math.max(1, startRect.right - startRect.left);
        } else {
          ratio = (moveEvent.clientY - startRect.top) / Math.max(1, startRect.bottom - startRect.top);
        }
        ratio = Math.max(0.15, Math.min(0.85, ratio));
        state.panelWeights[dockId][beforePanelId] = Math.max(0.25, totalWeight * ratio);
        state.panelWeights[dockId][afterPanelId] = Math.max(0.25, totalWeight - state.panelWeights[dockId][beforePanelId]);
        applyPanelDockLayout(stackEl, dockId, visibleIds);
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

  function applyDockLayout() {
    if (!state.bodyEl || !state.mainRowEl) return;
    var leftVisible = getDockVisiblePanelIds('left').length > 0 && state.dockSizes.left > 0;
    var rightVisible = getDockVisiblePanelIds('right').length > 0 && state.dockSizes.right > 0;
    var bottomVisible = getDockVisiblePanelIds('bottom').length > 0 && state.dockSizes.bottom > 0;

    if (state.leftDockEl) state.leftDockEl.classList.toggle('is-visible', leftVisible);
    if (state.rightDockEl) state.rightDockEl.classList.toggle('is-visible', rightVisible);
    if (state.bottomDockEl) state.bottomDockEl.classList.toggle('is-visible', bottomVisible);
    if (state.leftDividerEl) state.leftDividerEl.classList.toggle('is-visible', leftVisible);
    if (state.rightDividerEl) state.rightDividerEl.classList.toggle('is-visible', rightVisible);
    if (state.bottomDividerEl) state.bottomDividerEl.classList.toggle('is-visible', bottomVisible);
    renderCollapsedDockMarker('left', state.leftMarkerEl);
    renderCollapsedDockMarker('right', state.rightMarkerEl);
    renderCollapsedDockMarker('bottom', state.bottomMarkerEl);

    state.mainRowEl.style.gridTemplateColumns =
      (leftVisible ? clampPanelSize('left', state.dockSizes.left) + 'px 6px ' : '') +
      'minmax(0, 1fr)' +
      (rightVisible ? ' 6px ' + clampPanelSize('right', state.dockSizes.right) + 'px' : '');
    state.bodyEl.style.gridTemplateRows =
      'minmax(0, 1fr)' +
      (bottomVisible ? ' 6px ' + clampPanelSize('bottom', state.dockSizes.bottom) + 'px' : '');
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

  function activatePanel(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;
    var dockId = getDockForPanel(normalized);
    if (!dockId) return false;
    state.panelVisibility[normalized] = true;
    state.activePanelId = normalized;
    renderToolbar();
    renderPanelDocks();
    persistState();
    return true;
  }

  function setPanelVisibility(panelId, visible, options) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;
    if (!visible) {
      return collapsePanel(normalized);
    }
    state.panelVisibility[normalized] = true;
    var dockId = getDockForPanel(normalized);
    if (!dockId) {
      var kind = getPanelKind(normalized);
      dockId = kind && PANEL_DEFINITIONS[kind] ? PANEL_DEFINITIONS[kind].defaultDock : 'left';
      state.panelDocks[dockId].push(normalized);
    }
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

    var dockIds = ['left', 'right', 'bottom'];
    for (var i = 0; i < dockIds.length; i++) {
      var existingDockId = dockIds[i];
      var panelIds = state.panelDocks[existingDockId];
      var index = panelIds.indexOf(normalizedPanelId);
      if (index !== -1) panelIds.splice(index, 1);
    }

    state.panelDocks[dockId].push(normalizedPanelId);
    state.panelVisibility[normalizedPanelId] = true;
    state.activePanelId = normalizedPanelId;
    ensurePanelDockActives();
    render();
    return true;
  }

  function notifyActiveBoardChanged() {
    var activeTab = getActiveTab();
    var boardId = activeTab && activeTab.boardId ? activeTab.boardId : '';
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
        tabBits.push(node.tabs[i].id + ':' + node.tabs[i].boardId + ':' + normalizeViewKind(node.tabs[i].viewKind));
      }
      return 'tabs(' + node.id + ')[' + tabBits.join('|') + ']';
    }
    return 'split(' + node.id + ':' + node.axis + ':' + buildStructureSignature(node.first) + ':' + buildStructureSignature(node.second) + ')';
  }

  function getTabTitle(tab) {
    var meta = state.boardsById[tab.boardId];
    return getBoardMetaLabel(meta || { id: tab.boardId || 'Untitled' });
  }

  function getTabMetaLabel(tab) {
    if (tab.viewKind === 'canvas') return 'Canvas';
    if (tab.viewKind === 'kanban') return 'Kanban';
    return '';
  }

  function getOrCreateFrame(tab) {
    var frame = state.frameCache[tab.id];
    var desiredSrc = getEmbeddedUrlForTab(tab);
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'workspace-shell-frame';
      frame.setAttribute('data-tab-id', tab.id);
      frame.setAttribute('data-src', desiredSrc);
      frame.setAttribute('title', getTabTitle(tab));
      frame.src = desiredSrc;
      frame.addEventListener('pointerdown', function () {
        activateTab(tab.id);
      });
      state.frameCache[tab.id] = frame;
      return frame;
    }
    if (frame.getAttribute('data-src') !== desiredSrc) {
      frame.setAttribute('data-src', desiredSrc);
      frame.src = desiredSrc;
    }
    frame.setAttribute('title', getTabTitle(tab));
    return frame;
  }

  function removeFrame(tabId) {
    var frame = state.frameCache[tabId];
    if (!frame) return;
    if (frame.parentNode) frame.parentNode.removeChild(frame);
    delete state.frameCache[tabId];
  }

  function activateTab(tabId) {
    var found = findTab(state.dockTree, tabId);
    if (!found) return false;
    found.leaf.activeTabId = tabId;
    state.activeLeafId = found.leaf.id;
    render();
    persistState();
    return true;
  }

  function extractTab(tabId) {
    var found = findTab(state.dockTree, tabId);
    if (!found) return null;
    found.leaf.tabs.splice(found.index, 1);
    if (found.leaf.activeTabId === tabId) {
      found.leaf.activeTabId = found.leaf.tabs.length > 0
        ? found.leaf.tabs[Math.max(0, found.index - 1)].id
        : '';
    }
    return {
      tab: found.tab,
      sourceLeafId: found.leaf.id
    };
  }

  function insertTabIntoLeaf(tab, leafId) {
    var leaf = findLeafById(state.dockTree, leafId);
    if (!leaf) return false;
    leaf.tabs.push(tab);
    leaf.activeTabId = tab.id;
    state.activeLeafId = leaf.id;
    return true;
  }

  function replaceNodeById(nodeId, replacement) {
    var found = findNodeAndParent(state.dockTree, nodeId);
    if (!found) return false;
    if (!found.parent) {
      state.dockTree = replacement;
    } else {
      found.parent[found.side] = replacement;
    }
    return true;
  }

  function moveTabToLeaf(tabId, targetLeafId) {
    var extracted = extractTab(tabId);
    if (!extracted) return false;
    if (!insertTabIntoLeaf(extracted.tab, targetLeafId)) {
      insertTabIntoLeaf(extracted.tab, extracted.sourceLeafId);
      return false;
    }
    state.dockTree = withNormalizedLeaves(state.dockTree, true);
    ensureActiveLeaf();
    render();
    persistState();
    return true;
  }

  function splitLeafWithTab(targetLeafId, zone, tabId) {
    var targetLeaf = findLeafById(state.dockTree, targetLeafId);
    if (!targetLeaf) return false;
    var tabInfo = findTab(state.dockTree, tabId);
    if (!tabInfo) return false;
    var movingWithinSameLeaf = tabInfo.leaf.id === targetLeafId;
    var shouldDuplicateSingleTab = movingWithinSameLeaf && tabInfo.leaf.tabs.length === 1;
    var tabForNewLeaf = null;
    if (shouldDuplicateSingleTab) {
      tabForNewLeaf = createTab(tabInfo.tab.boardId, tabInfo.tab.viewKind);
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
    state.activeLeafId = newLeaf.id;
    state.dockTree = withNormalizedLeaves(state.dockTree, true);
    render();
    persistState();
    return true;
  }

  function closeTab(tabId) {
    var extracted = extractTab(tabId);
    if (!extracted) return false;
    removeFrame(tabId);
    state.dockTree = withNormalizedLeaves(state.dockTree, true);
    ensureActiveLeaf();
    render();
    persistState();
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
    persistState();
    return true;
  }

  function toggleActiveSplitOrientation() {
    var split = findClosestSplitParent(state.dockTree, state.activeLeafId, null);
    if (!split) return splitActivePane('horizontal');
    split.axis = split.axis === 'horizontal' ? 'vertical' : 'horizontal';
    render();
    persistState();
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
    persistState();
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
    var panelWindowEl = state.rootEl.querySelector('.workspace-shell-panel-window[data-panel-id="' + normalized + '"]');
    if (!panelWindowEl || typeof panelWindowEl.getBoundingClientRect !== 'function') return null;
    var rect = panelWindowEl.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    return rect;
  }

  function detachTab(tabId) {
    var found = findTab(state.dockTree, tabId);
    if (!found || !found.tab || !found.tab.boardId) return Promise.resolve(false);
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
    var backendSettingsPanelEl = document.getElementById('backend-settings-panel');
    var frontendSettingsPanelEl = document.getElementById('frontend-settings-panel');

    if (dashboardDividerEl) {
      dashboardDividerEl.classList.add('hidden');
      if (dashboardDividerEl.parentNode) dashboardDividerEl.parentNode.removeChild(dashboardDividerEl);
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

    state.panelElements = {
      hierarchy: sidebarEl || null,
      dashboard: dashboardEl || null,
      logs: logPanelEl || null,
      backendSettings: backendSettingsPanelEl || null,
      frontendSettings: frontendSettingsPanelEl || null
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

  function renderPanelDock(dockId, hostEl) {
    if (!hostEl) return;
    hostEl.innerHTML = '';
    var visibleIds = getVisiblePanelIdsForDock(dockId);
    hostEl.className = 'workspace-shell-panel-dock';
    hostEl.setAttribute('data-dock', dockId);
    if (visibleIds.length === 0) {
      hostEl.classList.add('is-hidden');
      return;
    }

    hostEl.classList.add('is-visible');
    var stackEl = document.createElement('div');
    stackEl.className = 'workspace-shell-panel-stack';
    var axis = dockId === 'bottom' ? 'horizontal' : 'vertical';
    stackEl.setAttribute('data-dock-axis', axis);
    for (var i = 0; i < visibleIds.length; i++) {
      var panelId = visibleIds[i];
      var panelKind = getPanelKind(panelId);
      var definition = PANEL_DEFINITIONS[panelKind] || null;
      var panelWindowEl = document.createElement('div');
      panelWindowEl.className = 'workspace-shell-panel-window';
      panelWindowEl.setAttribute('data-panel-id', panelId);
      if (panelId === state.activePanelId) panelWindowEl.classList.add('is-active');
      if (!definition || !definition.integratedHeader) {
        var tabbarEl = document.createElement('div');
        tabbarEl.className = 'workspace-shell-panel-tabbar';
        var tabBtn = document.createElement('button');
        tabBtn.className = 'workspace-shell-panel-tab is-active';
        tabBtn.type = 'button';
        tabBtn.setAttribute('data-ws-action', 'activate-panel');
        tabBtn.setAttribute('data-ws-panel-id', panelId);
        tabBtn.textContent = getPanelTitle(panelId);
        if (panelId === state.activePanelId) tabBtn.classList.add('is-selected');
        tabbarEl.appendChild(tabBtn);
        panelWindowEl.appendChild(tabbarEl);
      } else {
        panelWindowEl.classList.add('workspace-shell-panel-window-integrated');
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
      stackEl.appendChild(panelWindowEl);
      if (i < visibleIds.length - 1) {
        var dividerEl = document.createElement('div');
        dividerEl.className = 'workspace-shell-panel-divider';
        dividerEl.setAttribute('data-axis', axis);
        bindPanelDockDivider(dividerEl, dockId, panelId, visibleIds[i + 1], axis, stackEl, visibleIds);
        stackEl.appendChild(dividerEl);
      }
    }
    applyPanelDockLayout(stackEl, dockId, visibleIds);
    hostEl.appendChild(stackEl);
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
    renderPanelDock('left', state.leftDockEl);
    renderPanelDock('right', state.rightDockEl);
    renderPanelDock('bottom', state.bottomDockEl);
    applyDockLayout();
  }

  function setPanelDragModeEnabled(enabled) {
    getBody().classList.toggle('workspace-shell-panel-dragging', !!enabled);
  }

  function createPanelDragGhost(panelId) {
    var ghost = document.createElement('div');
    ghost.className = 'workspace-shell-panel-ghost';
    ghost.textContent = getPanelTitle(panelId);
    document.body.appendChild(ghost);
    return ghost;
  }

  function positionPanelDragGhost(ghost, x, y) {
    if (!ghost) return;
    ghost.style.left = Math.round(x) + 'px';
    ghost.style.top = Math.round(y) + 'px';
  }

  function destroyPanelDragGhost(ghost) {
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
  }

  function clearPanelDropTargets() {
    state.panelDragHoverDock = '';
    if (!state.panelDropOverlayEl) return;
    var zones = state.panelDropOverlayEl.querySelectorAll('.workspace-shell-panel-drop-zone.is-active');
    for (var i = 0; i < zones.length; i++) {
      zones[i].classList.remove('is-active');
    }
  }

  function setPanelDropTarget(dockId) {
    clearPanelDropTargets();
    if (!dockId || !state.panelDropOverlayEl) return;
    state.panelDragHoverDock = dockId;
    var zone = state.panelDropOverlayEl.querySelector('.workspace-shell-panel-drop-zone[data-ws-panel-drop-dock="' + dockId + '"]');
    if (zone) zone.classList.add('is-active');
  }

  function handlePanelPointerMove(event) {
    var drag = state.panelPointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    if (!drag.started) {
      var dx = event.clientX - drag.startX;
      var dy = event.clientY - drag.startY;
      if ((dx * dx) + (dy * dy) < 36) return;
      drag.started = true;
      drag.ghost = createPanelDragGhost(drag.panelId);
      setPanelDragModeEnabled(true);
    }

    positionPanelDragGhost(drag.ghost, event.clientX, event.clientY);

    var target = document.elementFromPoint(event.clientX, event.clientY);
    var zoneEl = target ? target.closest('[data-ws-panel-drop-dock]') : null;
    if (zoneEl) {
      setPanelDropTarget(zoneEl.getAttribute('data-ws-panel-drop-dock'));
      return;
    }
    clearPanelDropTargets();
  }

  function finishPanelPointerDrag(event) {
    var drag = state.panelPointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    window.removeEventListener('pointermove', handlePanelPointerMove, true);
    window.removeEventListener('pointerup', finishPanelPointerDrag, true);
    window.removeEventListener('pointercancel', finishPanelPointerDrag, true);

    if (drag.sourceEl && typeof drag.sourceEl.releasePointerCapture === 'function') {
      try { drag.sourceEl.releasePointerCapture(event.pointerId); } catch (_) { /* ignore */ }
    }

    destroyPanelDragGhost(drag.ghost);
    setPanelDragModeEnabled(false);

    var dockId = state.panelDragHoverDock;
    clearPanelDropTargets();
    state.panelPointerDrag = null;

    if (!drag.started) {
      activatePanel(drag.panelId);
      return;
    }

    if (dockId) {
      movePanelToDock(drag.panelId, dockId);
      activatePanel(drag.panelId);
      return;
    }

    var outsideWindow = drag.lastX < 0 || drag.lastY < 0 || drag.lastX > window.innerWidth || drag.lastY > window.innerHeight;
    if (outsideWindow) {
      detachPanelView(drag.panelId);
    }
  }

  function removePanelFromCurrentWindow(panelId) {
    var normalized = resolvePanelTarget(panelId);
    if (!normalized) return false;
    var kind = getPanelKind(normalized);
    if (!kind) return false;
    var dockIds = ['left', 'right', 'bottom'];
    if (normalized !== kind) {
      for (var i = 0; i < dockIds.length; i++) {
        var duplicateDockPanels = state.panelDocks[dockIds[i]] || [];
        var duplicateIndex = duplicateDockPanels.indexOf(normalized);
        if (duplicateIndex !== -1) duplicateDockPanels.splice(duplicateIndex, 1);
      }
      return closePanelView(normalized);
    }
    state.panelVisibility[normalized] = false;
    var defaultDock = (PANEL_DEFINITIONS[kind] && PANEL_DEFINITIONS[kind].defaultDock) || 'left';
    var foundDockId = '';
    for (var j = 0; j < dockIds.length; j++) {
      var dockPanels = state.panelDocks[dockIds[j]] || [];
      var index = dockPanels.indexOf(normalized);
      if (index !== -1) {
        foundDockId = dockIds[j];
        while (index !== -1) {
          dockPanels.splice(index, 1);
          index = dockPanels.indexOf(normalized);
        }
      }
    }
    var targetDockPanels = state.panelDocks[foundDockId || defaultDock] || (state.panelDocks[foundDockId || defaultDock] = []);
    if (targetDockPanels.indexOf(normalized) === -1) {
      targetDockPanels.unshift(normalized);
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
      profile: 'workspace',
      panelKind: kind,
      width: panelRect ? Math.max(360, Math.round(panelRect.width)) : null,
      height: panelRect ? Math.max(220, Math.round(panelRect.height)) : null
    }).then(function () {
      removePanelFromCurrentWindow(normalized);
      return true;
    }).catch(function () {
      return false;
    });
  }

  function setTabViewKind(tabId, viewKind, options) {
    var found = findTab(state.dockTree, tabId);
    if (!found || !found.tab) return false;
    var normalized = normalizeViewKind(viewKind);
    if (found.tab.viewKind === normalized) return true;
    found.tab.viewKind = normalized;
    found.leaf.activeTabId = tabId;
    if (!options || options.activate !== false) state.activeLeafId = found.leaf.id;
    var frame = getOrCreateFrame(found.tab);
    frame.setAttribute('data-src', '');
    render();
    persistState();
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
    if (!state.dockEl) return;
    var nodes = state.dockEl.querySelectorAll('.workspace-shell-tabset[data-drop-zone]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].removeAttribute('data-drop-zone');
    }
    var zones = state.dockEl.querySelectorAll('.workspace-shell-drop-zone.is-active');
    for (var j = 0; j < zones.length; j++) {
      zones[j].classList.remove('is-active');
    }
    state.dragHoverLeafId = '';
    state.dragHoverZone = '';
  }

  function setTabDragModeEnabled(enabled) {
    getBody().classList.toggle('workspace-shell-tab-dragging', !!enabled);
  }

  function createTabDragGhost(tabId) {
    var found = findTab(state.dockTree, tabId);
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
    if (!state.dockEl) return;
    clearDropZones();
    if (!leafId || !zone) return;
    state.dragHoverLeafId = leafId;
    state.dragHoverZone = zone;
    var tabsetEl = state.dockEl.querySelector('.workspace-shell-tabset[data-node-id="' + leafId + '"]');
    if (tabsetEl) tabsetEl.setAttribute('data-drop-zone', zone);
    var zoneEl = state.dockEl.querySelector('.workspace-shell-drop-zone[data-ws-drop-leaf="' + leafId + '"][data-zone="' + zone + '"]');
    if (zoneEl) zoneEl.classList.add('is-active');
  }

  function handleTabPointerMove(event) {
    var drag = state.pointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    state.dragLastX = event.clientX;
    state.dragLastY = event.clientY;

    if (!drag.started) {
      var dx = event.clientX - drag.startX;
      var dy = event.clientY - drag.startY;
      if ((dx * dx) + (dy * dy) < 36) return;
      drag.started = true;
      state.dragTabId = drag.tabId;
      state.dragDroppedInternally = false;
      drag.ghost = createTabDragGhost(drag.tabId);
      setTabDragModeEnabled(true);
    }

    positionTabDragGhost(drag.ghost, event.clientX, event.clientY);

    var target = document.elementFromPoint(event.clientX, event.clientY);
    var zoneEl = target ? target.closest('[data-ws-drop-zone][data-ws-drop-leaf]') : null;
    var tabsetEl = target ? target.closest('.workspace-shell-tabset') : null;
    if (zoneEl) {
      setDropZoneHighlight(zoneEl.getAttribute('data-ws-drop-leaf'), zoneEl.getAttribute('data-ws-drop-zone'));
      return;
    }
    if (tabsetEl) {
      setDropZoneHighlight(tabsetEl.getAttribute('data-node-id'), getDropZoneForEvent(tabsetEl, event));
      return;
    }
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
      clearDropZones();
      activateTab(drag.tabId);
      return;
    }

    var tabId = drag.tabId;
    var x = drag.lastX;
    var y = drag.lastY;
    var leafId = state.dragHoverLeafId;
    var zone = state.dragHoverZone;

    clearDropZones();
    state.pointerDrag = null;
    state.dragTabId = '';

    if (leafId && zone) {
      state.dragDroppedInternally = true;
      if (zone === 'center') moveTabToLeaf(tabId, leafId);
      else splitLeafWithTab(leafId, zone, tabId);
      state.dragDroppedInternally = false;
      return;
    }

    var outsideWindow = x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight;
    if (outsideWindow) detachTab(tabId);
    state.dragDroppedInternally = false;
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    var panelHandleEl = event.target.closest('[data-ws-panel-drag-handle]');
    if (panelHandleEl) {
      event.preventDefault();
      var handledPanelId = resolvePanelTarget(panelHandleEl.getAttribute('data-ws-panel-drag-handle'));
      if (!handledPanelId) return;
      state.activePanelId = handledPanelId;
      state.panelPointerDrag = {
        panelId: handledPanelId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        started: false,
        sourceEl: panelHandleEl,
        ghost: null
      };
      if (typeof panelHandleEl.setPointerCapture === 'function') {
        try { panelHandleEl.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
      }
      window.addEventListener('pointermove', handlePanelPointerMove, true);
      window.addEventListener('pointerup', finishPanelPointerDrag, true);
      window.addEventListener('pointercancel', finishPanelPointerDrag, true);
      renderToolbar();
      persistState();
      return;
    }
    var panelTabEl = event.target.closest('.workspace-shell-panel-tab[data-ws-panel-id]');
    if (panelTabEl) {
      event.preventDefault();
      var panelId = panelTabEl.getAttribute('data-ws-panel-id');
      if (!panelId) return;
      state.activePanelId = panelId;
      state.panelPointerDrag = {
        panelId: panelId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        started: false,
        sourceEl: panelTabEl,
        ghost: null
      };
      if (typeof panelTabEl.setPointerCapture === 'function') {
        try { panelTabEl.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
      }
      window.addEventListener('pointermove', handlePanelPointerMove, true);
      window.addEventListener('pointerup', finishPanelPointerDrag, true);
      window.addEventListener('pointercancel', finishPanelPointerDrag, true);
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
    var tabEl = event.target.closest('.workspace-shell-tab[data-ws-tab-id]');
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
      state.pointerDrag = {
        tabId: tabId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        started: false,
        sourceEl: tabEl,
        ghost: null
      };
      if (typeof tabEl.setPointerCapture === 'function') {
        try { tabEl.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
      }
      window.addEventListener('pointermove', handleTabPointerMove, true);
      window.addEventListener('pointerup', finishTabPointerDrag, true);
      window.addEventListener('pointercancel', finishTabPointerDrag, true);
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
      var found = findNodeAndParent(state.dockTree, splitId);
      if (!found || !found.node || found.node.type !== 'split') return;
      var splitNode = found.node;
      var container = dividerEl.parentElement;
      if (!container) return;
      function applySplitContainerLayout() {
        var firstWeight = Math.round(splitNode.ratio * 1000);
        var secondWeight = 1000 - firstWeight;
        if (axis === 'vertical') {
          container.style.gridTemplateColumns = firstWeight + 'fr 6px ' + secondWeight + 'fr';
          container.style.gridTemplateRows = '1fr';
        } else {
          container.style.gridTemplateRows = firstWeight + 'fr 6px ' + secondWeight + 'fr';
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
        persistState();
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

    var tabbarEl = document.createElement('div');
    tabbarEl.className = 'workspace-shell-tabbar';

    var tabsEl = document.createElement('div');
    tabsEl.className = 'workspace-shell-tabs';
    for (var i = 0; i < node.tabs.length; i++) {
      var tab = node.tabs[i];
      var tabBtn = document.createElement('div');
      tabBtn.className = 'workspace-shell-tab';
      tabBtn.setAttribute('data-ws-tab-id', tab.id);
      if (tab.id === node.activeTabId) tabBtn.classList.add('is-active');
      tabBtn.innerHTML =
        '<span class="workspace-shell-tab-label">' + escapeHtml(getTabTitle(tab)) + '</span>' +
        (getTabMetaLabel(tab) ? '<span class="workspace-shell-tab-meta">' + escapeHtml(getTabMetaLabel(tab)) + '</span>' : '') +
        '<button class="workspace-shell-tab-close" type="button" data-ws-action="close-tab" data-ws-tab-id="' + escapeHtml(tab.id) + '" title="Close tab">×</button>';
      tabsEl.appendChild(tabBtn);
    }
    tabbarEl.appendChild(tabsEl);

    tabsetEl.appendChild(tabbarEl);

    var contentEl = document.createElement('div');
    contentEl.className = 'workspace-shell-pane-content';
    var overlayEl = document.createElement('div');
    overlayEl.className = 'workspace-shell-drop-overlay';
    overlayEl.innerHTML =
      '<div class="workspace-shell-drop-zone" data-zone="left" data-ws-drop-zone="left" data-ws-drop-leaf="' + escapeHtml(node.id) + '"></div>' +
      '<div class="workspace-shell-drop-zone" data-zone="right" data-ws-drop-zone="right" data-ws-drop-leaf="' + escapeHtml(node.id) + '"></div>' +
      '<div class="workspace-shell-drop-zone" data-zone="top" data-ws-drop-zone="top" data-ws-drop-leaf="' + escapeHtml(node.id) + '"></div>' +
      '<div class="workspace-shell-drop-zone" data-zone="bottom" data-ws-drop-zone="bottom" data-ws-drop-leaf="' + escapeHtml(node.id) + '"></div>' +
      '<div class="workspace-shell-drop-zone" data-zone="center" data-ws-drop-zone="center" data-ws-drop-leaf="' + escapeHtml(node.id) + '"></div>';
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
    parentEl.appendChild(tabsetEl);
  }

  function renderSplit(node, parentEl) {
    var splitEl = document.createElement('div');
    splitEl.className = 'workspace-shell-split workspace-shell-node axis-' + node.axis;
    splitEl.setAttribute('data-node-id', node.id);
    var firstWeight = Math.round(node.ratio * 1000);
    var secondWeight = 1000 - firstWeight;
    if (node.axis === 'vertical') {
      splitEl.style.gridTemplateColumns = firstWeight + 'fr 6px ' + secondWeight + 'fr';
      splitEl.style.gridTemplateRows = '1fr';
    } else {
      splitEl.style.gridTemplateRows = firstWeight + 'fr 6px ' + secondWeight + 'fr';
      splitEl.style.gridTemplateColumns = '1fr';
    }

    var firstPane = document.createElement('div');
    firstPane.className = 'workspace-shell-split-pane';
    renderNode(node.first, firstPane);

    var divider = document.createElement('div');
    divider.className = 'workspace-shell-divider';
    divider.setAttribute('data-axis', node.axis);
    bindSplitDivider(divider, node.id, node.axis);

    var secondPane = document.createElement('div');
    secondPane.className = 'workspace-shell-split-pane';
    renderNode(node.second, secondPane);

    splitEl.appendChild(firstPane);
    splitEl.appendChild(divider);
    splitEl.appendChild(secondPane);
    parentEl.appendChild(splitEl);
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

    var tabsEl = tabsetEl.querySelector('.workspace-shell-tabs');
    var contentEl = tabsetEl.querySelector('.workspace-shell-pane-content');
    if (!tabsEl || !contentEl) return false;

    var tabButtons = tabsEl.querySelectorAll('.workspace-shell-tab');
    if (tabButtons.length !== node.tabs.length) return false;

    var frames = contentEl.querySelectorAll('.workspace-shell-frame');
    if (frames.length !== node.tabs.length) return false;

    for (var i = 0; i < node.tabs.length; i++) {
      var tab = node.tabs[i];
      var tabEl = tabsEl.querySelector('.workspace-shell-tab[data-ws-tab-id="' + tab.id + '"]');
      var frameEl = contentEl.querySelector('.workspace-shell-frame[data-tab-id="' + tab.id + '"]');
      if (!tabEl || !frameEl) return false;
      tabEl.classList.toggle('is-active', tab.id === node.activeTabId);
      var labelEl = tabEl.querySelector('.workspace-shell-tab-label');
      if (labelEl) labelEl.textContent = getTabTitle(tab);
      var metaEl = tabEl.querySelector('.workspace-shell-tab-meta');
      if (metaEl) metaEl.textContent = getTabMetaLabel(tab);
      frameEl.classList.toggle('is-active', tab.id === node.activeTabId);
      frameEl.setAttribute('title', getTabTitle(tab));
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
    ensurePanelDockActives();
    renderToolbar();
    if (isPanelOnlyWindow()) {
      renderPanelOnly(state.panelOnlyId || getPrimaryPanelId(state.panelOnlyKind), state.dockEl);
      state.lastStructureSignature = 'panel-only:' + (state.panelOnlyId || state.panelOnlyKind);
    } else {
      var structureSignature = buildStructureSignature(state.dockTree);
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
    notifyActiveBoardChanged();
    persistState();
  }

  function pruneMissingBoards() {
    var changed = false;
    visitTree(state.dockTree, function (node) {
      if (node.type !== 'tabs') return;
      for (var i = node.tabs.length - 1; i >= 0; i--) {
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
    if (isPanelOnlyWindow() && state.panelOnlyKind === 'hierarchy') {
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
      persistState();
      return existing.tab;
    }
    var targetLeaf = getActiveLeaf() || getFirstLeaf(state.dockTree);
    if (!targetLeaf) {
      state.dockTree = createTabsetNode([]);
      targetLeaf = state.dockTree;
    }
    var tab = createTab(boardId, desiredView);
    targetLeaf.tabs.push(tab);
    targetLeaf.activeTabId = tab.id;
    state.activeLeafId = targetLeaf.id;
    render();
    persistState();
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
    if (isPanelOnlyWindow() && state.panelOnlyKind === 'hierarchy') {
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
    var panelTab = event.target.closest('.workspace-shell-panel-tab[data-ws-panel-id]');
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

    state.leftMarkerEl = document.createElement('div');
    state.leftMarkerEl.className = 'workspace-shell-collapsed-marker-strip';
    state.leftMarkerEl.setAttribute('data-dock', 'left');
    state.bodyEl.appendChild(state.leftMarkerEl);

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

    state.rightMarkerEl = document.createElement('div');
    state.rightMarkerEl.className = 'workspace-shell-collapsed-marker-strip';
    state.rightMarkerEl.setAttribute('data-dock', 'right');
    state.bodyEl.appendChild(state.rightMarkerEl);

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

    state.bottomMarkerEl = document.createElement('div');
    state.bottomMarkerEl.className = 'workspace-shell-collapsed-marker-strip';
    state.bottomMarkerEl.setAttribute('data-dock', 'bottom');
    state.bodyEl.appendChild(state.bottomMarkerEl);

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

    state.mounted = true;
    restoreState();
    applyPanelOnlyWindowState();
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

  function handleBoardAction(action) {
    if (!state.enabled || !state.mounted) return false;
    if (!action) return false;
    if (action === 'new-window') {
      openWorkspaceWindow();
      return true;
    }
    if (action === 'open-management' || action === 'backend-settings') {
      revealPanel('backendSettings');
      return true;
    }
    if (action === 'open-frontend-settings' || action === 'open-theme-zoom') {
      revealPanel('frontendSettings');
      return true;
    }
    if (action === 'show-processes' || action === 'running-processes') {
      revealPanel('logs');
      return true;
    }
    if (action === 'set-board-layout:kanban') {
      setActiveViewKind('kanban');
      return true;
    }
    if (action === 'set-board-layout:canvas') {
      setActiveViewKind('canvas');
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
    duplicatePanel: duplicatePanel,
    closePanelView: closePanelView,
    isPanelVisible: isPanelShown,
    revealPanel: revealPanel,
    collapsePanel: collapsePanel,
    restoreDock: restoreDock,
    collapseDock: collapseDock
  };
})();
