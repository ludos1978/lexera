/**
 * LexeraLayoutPersistence
 *
 * Owns the localStorage/sessionStorage round-trip for the workspace
 * shell layout: serialise the dock tree and side docks → JSON, hydrate
 * the same shape back into model state. Storage key honours an optional
 * hooks override; main-window state goes to localStorage, all other
 * windows use sessionStorage so detached workspaces don't pollute the
 * primary key.
 *
 * Versions:
 *   1, 2, 3 — legacy `panelDocks` groups (migrated via
 *             layoutTree.migratePanelDocksToSideDocks)
 *   4       — `sideDocks` tree shape (current)
 *
 * Setup contract:
 *   LexeraLayoutPersistence.setup({
 *     state,                         // shell state object — read+write
 *     layoutTree,                    // window.LexeraLayoutTree
 *     panelDefs,                     // window.LexeraPanelDefinitions
 *     nextId,                        // shared id factory
 *     resolvePanelTarget,            // (id) → resolved instance id
 *     syncIntegratedPanelVisibility, // () → void; called after restore
 *     ensureActiveLeaf               // () → void; called after restore
 *   });
 *
 * Public API:
 *   serialize(node)               // pure
 *   hydrate(raw, panelInstances)  // pure (uses state.panelInstances if not given)
 *   persist()                     // mutates storage
 *   restore()                     // returns bool, mutates state
 */
(function () {
  'use strict';

  var deps = null;

  function setup(setupDeps) {
    if (!setupDeps) throw new Error('LexeraLayoutPersistence.setup requires deps');
    var required = ['state', 'layoutTree', 'panelDefs', 'nextId',
      'resolvePanelTarget', 'syncIntegratedPanelVisibility', 'ensureActiveLeaf'];
    for (var i = 0; i < required.length; i++) {
      if (setupDeps[required[i]] == null) {
        throw new Error('LexeraLayoutPersistence.setup missing dep: ' + required[i]);
      }
    }
    deps = setupDeps;
  }

  function getPersistenceStorage() {
    if (deps.state.windowLabel === 'main') return window.localStorage;
    return window.sessionStorage;
  }

  function getPersistenceKey() {
    var hooks = deps.state.hooks;
    if (hooks && typeof hooks.getPersistenceKey === 'function') {
      var hookKey = hooks.getPersistenceKey();
      if (hookKey) return String(hookKey);
    }
    return 'lexera-workspace-shell:' + deps.state.windowLabel;
  }

  function clampRatio(value) {
    if (typeof value !== 'number' || !isFinite(value)) return 0.5;
    return Math.max(0.18, Math.min(0.82, value));
  }

  function serialize(node) {
    if (!node) return null;
    if (node.type === 'tabs') {
      return {
        type: 'tabs',
        id: node.id,
        activeTabId: node.activeTabId || '',
        tabs: (node.tabs || []).map(function (tab) {
          if (deps.layoutTree.isPanelTab(tab)) {
            return {
              id: tab.id,
              kind: 'panel',
              panelId: deps.resolvePanelTarget(tab.panelId)
            };
          }
          return {
            id: tab.id,
            kind: 'board',
            boardId: tab.boardId || '',
            viewKind: deps.layoutTree.normalizeViewKind(tab.viewKind)
          };
        })
      };
    }
    return {
      type: 'split',
      id: node.id,
      axis: node.axis === 'horizontal' ? 'horizontal' : 'vertical',
      ratio: clampRatio(node.ratio),
      first: serialize(node.first),
      second: serialize(node.second)
    };
  }

  function hydrate(raw, panelInstances) {
    if (!raw || typeof raw !== 'object') return null;
    var instances = panelInstances || deps.state.panelInstances;
    if (raw.type === 'tabs') {
      var tabs = [];
      var rawTabs = Array.isArray(raw.tabs) ? raw.tabs : [];
      for (var i = 0; i < rawTabs.length; i++) {
        var rawTab = rawTabs[i];
        if (!rawTab || typeof rawTab !== 'object') continue;
        if (rawTab.kind === 'panel') {
          var panelId = deps.panelDefs.normalizePanelIdWithInstances(rawTab.panelId, instances);
          if (!panelId) continue;
          tabs.push({
            id: String(rawTab.id || deps.nextId('tab')),
            kind: 'panel',
            panelId: panelId
          });
          continue;
        }
        if (typeof rawTab.boardId !== 'string' || !rawTab.boardId) continue;
        tabs.push({
          id: String(rawTab.id || deps.nextId('tab')),
          kind: 'board',
          boardId: rawTab.boardId,
          viewKind: deps.layoutTree.normalizeViewKind(rawTab.viewKind)
        });
      }
      return {
        type: 'tabs',
        id: String(raw.id || deps.nextId('pane')),
        tabs: tabs,
        activeTabId: String(raw.activeTabId || '')
      };
    }
    if (raw.type !== 'split') {
      if (typeof window !== 'undefined' && typeof window.lexeraLog === 'function') {
        window.lexeraLog('warn', '[layoutPersistence.hydrate] returning null — unrecognized node type "' + raw.type + '" (silently dropping subtree; possible corrupt or version-mismatched state)');
      }
      return null;
    }
    return {
      type: 'split',
      id: String(raw.id || deps.nextId('split')),
      axis: raw.axis === 'horizontal' ? 'horizontal' : 'vertical',
      ratio: clampRatio(raw.ratio),
      first: hydrate(raw.first, instances),
      second: hydrate(raw.second, instances)
    };
  }

  function persist() {
    var state = deps.state;
    if (!state.mounted) return;
    try {
      var storage = getPersistenceStorage();
      storage.setItem(getPersistenceKey(), JSON.stringify({
        version: 4,
        profile: state.profile,
        panelInstances: state.panelInstances,
        sideDocks: {
          left: serialize(state.sideDocks.left),
          right: serialize(state.sideDocks.right),
          bottom: serialize(state.sideDocks.bottom)
        },
        dockSizes: state.dockSizes,
        dockRestoreSizes: state.dockRestoreSizes,
        panelVisibility: state.panelVisibility,
        activePanelId: state.activePanelId || '',
        activeLeafId: state.activeLeafId || '',
        dockTree: serialize(state.dockTree),
        foldedPanes: state.foldedPanes
      }));
    } catch (err) {
      console.warn('[layout-persist] Failed to persist state:', err);
    }
  }

  function restore() {
    var state = deps.state;
    var layoutTree = deps.layoutTree;
    var panelDefs = deps.panelDefs;
    try {
      var raw = getPersistenceStorage().getItem(getPersistenceKey());
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (!parsed || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4)) return false;
      if (parsed.profile && parsed.profile !== state.profile) return false;
      state.panelInstances = panelDefs.normalizePanelInstances(parsed.panelInstances);
      state.dockTree = hydrate(parsed.dockTree, state.panelInstances) ||
        layoutTree.createTabsetNode([], deps.nextId);
      state.dockTree = layoutTree.withNormalizedLeaves(state.dockTree, true, deps.nextId);
      // Hydrate sideDocks: version 4 stores sideDocks trees; older
      // versions stored panelDocks groups and need migration.
      if (parsed.version === 4 && parsed.sideDocks && typeof parsed.sideDocks === 'object') {
        state.sideDocks = {
          left: hydrate(parsed.sideDocks.left, state.panelInstances),
          right: hydrate(parsed.sideDocks.right, state.panelInstances),
          bottom: hydrate(parsed.sideDocks.bottom, state.panelInstances)
        };
      } else if (parsed.panelDocks) {
        var normalizedOldDocks = panelDefs.normalizePanelDocks(parsed.panelDocks, state.profile, state.panelInstances);
        state.sideDocks = layoutTree.migratePanelDocksToSideDocks(normalizedOldDocks, parsed.panelGroupActives, deps.nextId);
      } else {
        state.sideDocks = panelDefs.createDefaultSideDocks(state.profile);
      }
      state.dockSizes = panelDefs.normalizeDockSizes(parsed.dockSizes, state.profile);
      state.dockRestoreSizes = panelDefs.normalizeDockRestoreSizes(parsed.dockRestoreSizes, state.profile);
      state.panelVisibility = panelDefs.normalizePanelVisibility(parsed.panelVisibility, state.profile, state.panelInstances);
      deps.syncIntegratedPanelVisibility();
      state.activePanelId = deps.resolvePanelTarget(parsed.activePanelId) || state.activePanelId;
      state.activeLeafId = String(parsed.activeLeafId || '');
      state.foldedPanes = (parsed.foldedPanes && typeof parsed.foldedPanes === 'object') ? parsed.foldedPanes : {};
      deps.ensureActiveLeaf();
      return true;
    } catch (err) {
      console.warn('[layout-persist] Failed to restore state:', err);
      return false;
    }
  }

  window.LexeraLayoutPersistence = {
    setup: setup,
    serialize: serialize,
    hydrate: hydrate,
    persist: persist,
    restore: restore
  };
})();
