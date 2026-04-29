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

  var runtimeAllowedPanelKinds = Object.keys(PANEL_DEFINITIONS);
  var nextId = null;

  function setup(deps) {
    if (!deps || typeof deps.nextId !== 'function') {
      throw new Error('LexeraPanelDefinitions.setup requires a nextId factory');
    }
    nextId = deps.nextId;
  }

  function getAllowedPanelKinds() {
    return runtimeAllowedPanelKinds.slice();
  }

  function isPanelKindAllowed(kind) {
    return !!(kind && Object.prototype.hasOwnProperty.call(PANEL_DEFINITIONS, kind) && runtimeAllowedPanelKinds.indexOf(kind) !== -1);
  }

  function isPanelKindAllowedFromDefinitions(kind) {
    return !!(kind && Object.prototype.hasOwnProperty.call(PANEL_DEFINITIONS, kind));
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

  function normalizePanelKind(value) {
    return isPanelKindAllowed(value) ? value : '';
  }

  function createDefaultPanelInstances() {
    var result = {};
    for (var i = 0; i < runtimeAllowedPanelKinds.length; i++) {
      var kind = runtimeAllowedPanelKinds[i];
      result[kind] = { id: kind, kind: kind };
    }
    return result;
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

  function createDefaultDockSizes(profile) {
    if (profile === 'detachedBoard') {
      return { left: 0, right: 0, bottom: 0 };
    }
    return { left: 272, right: 0, bottom: 0 };
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

  function normalizeDockSizeValue(dockId, value) {
    var number = typeof value === 'number' && isFinite(value) ? value : null;
    if (number == null) return 0;
    if (number <= 0) return 0;
    return clampPanelSize(dockId, number);
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

  function createDefaultPanelVisibility(profile) {
    var result = {};
    for (var i = 0; i < runtimeAllowedPanelKinds.length; i++) {
      var kind = runtimeAllowedPanelKinds[i];
      result[kind] = !!DEFAULT_PANEL_VISIBILITY[kind];
    }
    return result;
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
