/**
 * LexeraPanelDefinitions
 *
 * Owns the canonical panel registry plus pure normalizers for the
 * persisted shell state shape. Stateful caller (workspaceShell)
 * constructs runtime instances from this module's helpers; the module
 * itself only holds the panel definitions table and the runtime
 * "allowed kinds" filter.
 *
 * Setup contract:
 *   LexeraPanelDefinitions.setup({ nextId });   // nextId is the
 *                                                // shared id factory
 *                                                // from layoutTree.createIdFactory
 *
 * Public API: PANEL_DEFINITIONS (read-only), DEFAULT_PANEL_VISIBILITY,
 * getAllowedPanelKinds(), isPanelKindAllowed(kind),
 * configureAllowedPanelKinds(list), isPanelKindAllowedFromDefinitions(kind),
 * getDefaultDockGroups(), getFirstAllowedPanelKind(),
 * normalizePanelKind(value),
 * createDefaultPanelInstances(), normalizePanelInstances(raw),
 * normalizePanelIdWithInstances(value, panelInstances),
 * clampPanelSize(dockId, value), normalizeDockSizeValue(dockId, value),
 * createDefaultDockSizes(profile), createDefaultDockRestoreSizes(profile),
 * normalizeDockSizes(raw, profile), normalizeDockRestoreSizes(raw, profile),
 * createDefaultPanelVisibility(profile),
 * normalizePanelVisibility(raw, profile, panelInstances),
 * normalizePanelDocks(raw, profile, panelInstances),
 * ensureUniquePanelIds(ids, seen, panelInstances),
 * createDefaultSideDocks(profile).
 */
(function () {
  'use strict';

  /**
   * @typedef {('left'|'right'|'bottom')} DockId
   *   The three side-dock slots. Centre dock is keyed elsewhere.
   */

  /**
   * @typedef {('workspace'|'detachedBoard'|string)} Profile
   *   Workspace shell profile. `'workspace'` is the default; the
   *   factories below treat anything else as workspace except
   *   `'detachedBoard'` which has its own zero-dock defaults.
   */

  /**
   * @typedef {Object} PanelDefinition
   *   Static metadata for a panel kind. Keys mirror the table at the
   *   top of the IIFE.
   * @property {string} id - Same as the table key.
   * @property {string} title - Display label.
   * @property {DockId} defaultDock - Where the panel lands by default.
   * @property {boolean} duplicable - Whether multiple instances of
   *   this kind can co-exist (currently every defined kind opts in).
   * @property {boolean} integratedHeader - Whether the panel renders
   *   its own dock-header chrome.
   */

  /**
   * @typedef {Object<string, PanelDefinition>} PanelDefinitionTable
   *   The runtime registry shape — keyed by panel kind.
   */

  /**
   * @typedef {Object} PanelInstance
   * @property {string} id - Panel instance id (kind by default; user
   *   duplicates carry instance-specific suffixes).
   * @property {string} kind - The panel's underlying kind (must be a
   *   key in `PANEL_DEFINITIONS`).
   */

  /**
   * @typedef {Object<string, PanelInstance>} PanelInstanceMap
   *   Returned by `createDefaultPanelInstances` /
   *   `normalizePanelInstances`. Keys are instance ids.
   */

  /**
   * @typedef {Object} DockSizeMap
   * @property {number} left - Pixel width of the left side dock; `0`
   *   means collapsed.
   * @property {number} right - Pixel width of the right side dock; `0`
   *   means collapsed.
   * @property {number} bottom - Pixel height of the bottom side dock;
   *   `0` means collapsed.
   */

  /**
   * @typedef {Object} DockRestoreSizeMap
   * @property {number} left - Last non-zero left width (so a collapsed
   *   dock can spring back to its prior size).
   * @property {number} right - Last non-zero right width.
   * @property {number} bottom - Last non-zero bottom height.
   */

  /**
   * @typedef {Object<string, boolean>} PanelVisibilityMap
   *   Per-panel-instance "show in dock" toggle.
   */

  /**
   * @typedef {Object} PanelDockGroups
   * @property {Array<Array<string>>} left - Each inner array is one
   *   tabset group of panel ids.
   * @property {Array<Array<string>>} right
   * @property {Array<Array<string>>} bottom
   */

  /**
   * @typedef {Object} SideDocksMap
   * @property {*} left - `DockTreeNode | null` — opaque here.
   * @property {*} right
   * @property {*} bottom
   */

  /**
   * @typedef {function(string): string} NextIdFn
   *   The shared `idFactory` from `LexeraLayoutTree.createIdFactory`.
   */

  /**
   * @typedef {Object} PanelDefinitionsSetupDeps
   * @property {NextIdFn} nextId
   */

  var layoutTree = (typeof window !== 'undefined' && window.LexeraLayoutTree) || null;
  if (!layoutTree) {
    throw new Error('LexeraLayoutTree global is required before panelDefinitions.js');
  }

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

  /** @type {Array<string>} */
  var runtimeAllowedPanelKinds = Object.keys(PANEL_DEFINITIONS);
  /** @type {NextIdFn|null} */
  var nextId = null;

  /**
   * @param {PanelDefinitionsSetupDeps} deps
   * @returns {void}
   */
  function setup(deps) {
    if (!deps || typeof deps.nextId !== 'function') {
      throw new Error('LexeraPanelDefinitions.setup requires a nextId factory');
    }
    nextId = deps.nextId;
  }

  /**
   * @returns {Array<string>}
   */
  function getAllowedPanelKinds() {
    return runtimeAllowedPanelKinds.slice();
  }

  /**
   * @param {string|null|undefined} kind
   * @returns {boolean}
   */
  function isPanelKindAllowed(kind) {
    return !!(kind && Object.prototype.hasOwnProperty.call(PANEL_DEFINITIONS, kind) && runtimeAllowedPanelKinds.indexOf(kind) !== -1);
  }

  /**
   * @param {string|null|undefined} kind
   * @returns {boolean}
   */
  function isPanelKindAllowedFromDefinitions(kind) {
    return !!(kind && Object.prototype.hasOwnProperty.call(PANEL_DEFINITIONS, kind));
  }

  /**
   * @param {Array<string>|null|undefined} allowedKinds
   * @returns {void}
   */
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

  /**
   * @returns {PanelDockGroups}
   */
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

  /**
   * @returns {string}
   */
  function getFirstAllowedPanelKind() {
    return runtimeAllowedPanelKinds.length > 0 ? runtimeAllowedPanelKinds[0] : '';
  }

  /**
   * @param {string|null|undefined} value
   * @returns {string}
   */
  function normalizePanelKind(value) {
    return isPanelKindAllowed(value) ? /** @type {string} */ (value) : '';
  }

  /**
   * @returns {PanelInstanceMap}
   */
  function createDefaultPanelInstances() {
    /** @type {PanelInstanceMap} */
    var result = {};
    for (var i = 0; i < runtimeAllowedPanelKinds.length; i++) {
      var kind = runtimeAllowedPanelKinds[i];
      result[kind] = { id: kind, kind: kind };
    }
    return result;
  }

  /**
   * @param {*} raw
   * @returns {PanelInstanceMap}
   */
  function normalizePanelInstances(raw) {
    var defaults = createDefaultPanelInstances();
    var source = raw && typeof raw === 'object' ? raw : {};
    /** @type {PanelInstanceMap} */
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

  /**
   * @param {string|null|undefined} value
   * @param {PanelInstanceMap|null|undefined} panelInstances
   * @returns {string}
   */
  function normalizePanelIdWithInstances(value, panelInstances) {
    var normalized = String(value || '');
    if (panelInstances && panelInstances[normalized]) return normalized;
    return normalizePanelKind(normalized);
  }

  /**
   * @param {Profile} [profile]
   * @returns {DockSizeMap}
   */
  function createDefaultDockSizes(profile) {
    if (profile === 'detachedBoard') {
      return { left: 0, right: 0, bottom: 0 };
    }
    return { left: 272, right: 0, bottom: 180 };
  }

  /**
   * @param {Profile} [profile]
   * @returns {DockRestoreSizeMap}
   */
  function createDefaultDockRestoreSizes(profile) {
    return createDefaultDockSizes(profile === 'detachedBoard' ? 'workspace' : profile);
  }

  /**
   * @param {DockId} dockId
   * @param {*} [value]
   * @returns {number}
   */
  function clampPanelSize(dockId, value) {
    var number = typeof value === 'number' && isFinite(value) ? value : null;
    if (number == null) return createDefaultDockSizes()[dockId];
    if (dockId === 'bottom') return Math.max(140, Math.min(480, Math.round(number)));
    return Math.max(200, Math.min(520, Math.round(number)));
  }

  /**
   * @param {DockId} dockId
   * @param {*} value
   * @returns {number}
   */
  function normalizeDockSizeValue(dockId, value) {
    var number = typeof value === 'number' && isFinite(value) ? value : null;
    if (number == null) return 0;
    if (number <= 0) return 0;
    return clampPanelSize(dockId, number);
  }

  /**
   * @param {*} raw
   * @param {Profile} profile
   * @returns {DockSizeMap}
   */
  function normalizeDockSizes(raw, profile) {
    var defaults = createDefaultDockSizes(profile);
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      left: normalizeDockSizeValue('left', source.left != null ? source.left : defaults.left),
      right: normalizeDockSizeValue('right', source.right != null ? source.right : defaults.right),
      bottom: normalizeDockSizeValue('bottom', source.bottom != null ? source.bottom : defaults.bottom)
    };
  }

  /**
   * @param {*} raw
   * @param {Profile} profile
   * @returns {DockRestoreSizeMap}
   */
  function normalizeDockRestoreSizes(raw, profile) {
    var defaults = createDefaultDockRestoreSizes(profile);
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      left: clampPanelSize('left', source.left != null ? source.left : defaults.left) || defaults.left,
      right: clampPanelSize('right', source.right != null ? source.right : defaults.right) || defaults.right,
      bottom: clampPanelSize('bottom', source.bottom != null ? source.bottom : defaults.bottom) || defaults.bottom
    };
  }

  /**
   * @param {Profile} [profile]
   * @returns {PanelVisibilityMap}
   */
  function createDefaultPanelVisibility(profile) {
    /** @type {PanelVisibilityMap} */
    var result = {};
    for (var i = 0; i < runtimeAllowedPanelKinds.length; i++) {
      var kind = runtimeAllowedPanelKinds[i];
      result[kind] = !!DEFAULT_PANEL_VISIBILITY[kind];
    }
    return result;
  }

  /**
   * @param {Array<*>|null|undefined} ids
   * @param {Object<string, true>|null|undefined} seen
   * @param {PanelInstanceMap|null|undefined} panelInstances
   * @returns {Array<string>}
   */
  function ensureUniquePanelIds(ids, seen, panelInstances) {
    /** @type {Array<string>} */
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

  /**
   * @param {*} raw
   * @param {Profile} profile
   * @param {PanelInstanceMap} panelInstances
   * @returns {PanelDockGroups}
   */
  function normalizePanelDocks(raw, profile, panelInstances) {
    var defaults = getDefaultDockGroups();
    /** @type {PanelDockGroups} */
    var result = { left: [], right: [], bottom: [] };
    /** @type {Object<string, true>} */
    var seen = {};
    /** @type {Array<DockId>} */
    var dockOrder = ['left', 'right', 'bottom'];
    for (var i = 0; i < dockOrder.length; i++) {
      var dockId = dockOrder[i];
      var source = raw ? raw[dockId] : null;
      var groups = [];
      if (Array.isArray(source) && source.length > 0) {
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

  /**
   * @param {*} raw
   * @param {Profile} profile
   * @param {PanelInstanceMap} panelInstances
   * @returns {PanelVisibilityMap}
   */
  function normalizePanelVisibility(raw, profile, panelInstances) {
    var defaults = createDefaultPanelVisibility(profile);
    /** @type {PanelVisibilityMap} */
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

  /**
   * @param {Profile} [profile]
   * @returns {SideDocksMap}
   */
  function createDefaultSideDocks(profile) {
    if (!nextId) {
      throw new Error('LexeraPanelDefinitions.setup must be called before createDefaultSideDocks');
    }
    if (profile === 'detachedBoard') return { left: null, right: null, bottom: null };
    var defaultGroups = getDefaultDockGroups();
    var leftTabs = defaultGroups.left.length > 0 ? defaultGroups.left[0].map(function (panelId) {
      return layoutTree.createPanelTab(panelId, nextId);
    }) : [];
    var bottomTabs = defaultGroups.bottom.length > 0 ? defaultGroups.bottom[0].map(function (panelId) {
      return layoutTree.createPanelTab(panelId, nextId);
    }) : [];
    var leftDock = leftTabs.length > 0
      ? layoutTree.createTabsetNode(leftTabs, nextId)
      : null;
    return {
      left: leftDock,
      right: null,
      bottom: bottomTabs.length > 0 ? layoutTree.createTabsetNode(bottomTabs, nextId) : null
    };
  }

  window.LexeraPanelDefinitions = {
    setup: setup,
    PANEL_DEFINITIONS: PANEL_DEFINITIONS,
    DEFAULT_PANEL_VISIBILITY: DEFAULT_PANEL_VISIBILITY,
    getAllowedPanelKinds: getAllowedPanelKinds,
    isPanelKindAllowed: isPanelKindAllowed,
    isPanelKindAllowedFromDefinitions: isPanelKindAllowedFromDefinitions,
    configureAllowedPanelKinds: configureAllowedPanelKinds,
    getDefaultDockGroups: getDefaultDockGroups,
    getFirstAllowedPanelKind: getFirstAllowedPanelKind,
    normalizePanelKind: normalizePanelKind,
    createDefaultPanelInstances: createDefaultPanelInstances,
    normalizePanelInstances: normalizePanelInstances,
    normalizePanelIdWithInstances: normalizePanelIdWithInstances,
    clampPanelSize: clampPanelSize,
    normalizeDockSizeValue: normalizeDockSizeValue,
    createDefaultDockSizes: createDefaultDockSizes,
    createDefaultDockRestoreSizes: createDefaultDockRestoreSizes,
    normalizeDockSizes: normalizeDockSizes,
    normalizeDockRestoreSizes: normalizeDockRestoreSizes,
    createDefaultPanelVisibility: createDefaultPanelVisibility,
    ensureUniquePanelIds: ensureUniquePanelIds,
    normalizePanelDocks: normalizePanelDocks,
    normalizePanelVisibility: normalizePanelVisibility,
    createDefaultSideDocks: createDefaultSideDocks
  };
})();
