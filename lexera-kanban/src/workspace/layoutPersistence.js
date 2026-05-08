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

  /**
   * @typedef {Object} LayoutPersistenceState
   *   The subset of `state` (workspace shell) this module reads + writes.
   *   Kept structural so persistence stays decoupled from the umbrella
   *   `WorkspaceShellState` typedef in workspaceShell.js.
   * @property {boolean} mounted
   * @property {string} windowLabel
   * @property {string} profile
   * @property {*} dockTree - Centre dock (`DockTreeNode | null`).
   * @property {{left: *, right: *, bottom: *}} sideDocks
   * @property {Object<string, number>} dockSizes
   * @property {Object<string, number>} dockRestoreSizes
   * @property {Object<string, boolean>} panelVisibility
   * @property {Object<string, *>} panelInstances
   * @property {Object<string, number>} foldedPanes
   * @property {string} activePanelId
   * @property {string} activeLeafId
   * @property {{getPersistenceKey?: function(): string}} [hooks]
   */

  /**
   * @typedef {function(string): string} NextIdFn
   *   Shared id factory the shell hands the persistence layer so
   *   restored nodes mint ids from the same monotonic counter as new
   *   ones.
   */

  /**
   * @typedef {function(string|null|undefined): string} ResolvePanelTargetFn
   */

  /**
   * @typedef {Object} LayoutPersistenceSetupDeps
   * @property {LayoutPersistenceState} state - Live reference to the
   *   shell state.
   * @property {*} layoutTree - `window.LexeraLayoutTree`.
   * @property {*} panelDefs - `window.LexeraPanelDefinitions`.
   * @property {NextIdFn} nextId
   * @property {ResolvePanelTargetFn} resolvePanelTarget
   * @property {function(): void} syncIntegratedPanelVisibility
   * @property {function(): void} ensureActiveLeaf
   */

  /**
   * @typedef {Object} SerializedTab
   * @property {string} id
   * @property {('board'|'panel')} kind
   * @property {string} [boardId]
   * @property {string} [panelId]
   * @property {string} [viewKind]
   */

  /**
   * @typedef {Object} SerializedTabsNode
   * @property {'tabs'} type
   * @property {string} id
   * @property {string} activeTabId
   * @property {Array<SerializedTab>} tabs
   */

  /**
   * @typedef {Object} SerializedSplitNode
   * @property {'split'} type
   * @property {string} id
   * @property {('horizontal'|'vertical')} axis
   * @property {number} ratio
   * @property {SerializedNode|null} first
   * @property {SerializedNode|null} second
   */

  /**
   * @typedef {(SerializedTabsNode|SerializedSplitNode)} SerializedNode
   *   The wire shape produced by `serialize` and consumed by `hydrate`.
   *   Mirrors `DockTreeNode` but kept distinct so the persistence layer
   *   can tolerate version drift without leaking partial shapes back
   *   into runtime trees.
   */

  /** @type {LayoutPersistenceSetupDeps|null} */
  var deps = null;

  /**
   * @param {LayoutPersistenceSetupDeps} setupDeps
   * @returns {void}
   */
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

  /**
   * @returns {string}
   */
  function getWorkspaceIdFromUrl() {
    try {
      return String(new URLSearchParams(window.location.search || '').get('workspace') || '');
    } catch (_) {
      return '';
    }
  }

  /**
   * @returns {Storage}
   */
  function getPersistenceStorage() {
    // Workspace-pinned windows + the boot main window persist across
    // sessions (localStorage). Detached panel-only windows and other
    // transient secondary windows stay in sessionStorage so their
    // ad-hoc layouts don't pollute persistent storage.
    if (getWorkspaceIdFromUrl()) return window.localStorage;
    if (deps && deps.state.windowLabel === 'main') return window.localStorage;
    return window.sessionStorage;
  }

  /**
   * @returns {string}
   */
  function getPersistenceKey() {
    if (!deps) return 'lexera-workspace-shell:unbound';
    var hooks = deps.state.hooks;
    if (hooks && typeof hooks.getPersistenceKey === 'function') {
      var hookKey = hooks.getPersistenceKey();
      if (hookKey) return String(hookKey);
    }
    // Per-workspace keying: layout follows the workspace, not the
    // window. Two windows pinned to the same workspace share one
    // saved layout (last save wins). Windows without a workspace
    // (boot main window before catalog hydrate, detached panel-only
    // windows) fall back to per-window keys.
    var workspaceId = getWorkspaceIdFromUrl();
    if (workspaceId) return 'lexera-workspace-shell:ws:' + workspaceId;
    return 'lexera-workspace-shell:' + deps.state.windowLabel;
  }

  /**
   * @param {*} value
   * @returns {number}
   */
  function clampRatio(value) {
    if (typeof value !== 'number' || !isFinite(value)) return 0.5;
    return Math.max(0.18, Math.min(0.82, value));
  }

  /**
   * @param {*} node - A `DockTreeNode | null` from the live tree.
   * @returns {SerializedNode|null}
   */
  function serialize(node) {
    if (!node || !deps) return null;
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

  /**
   * @param {*} raw - The serialized payload to hydrate.
   * @param {Object<string, *>} [panelInstances]
   * @returns {*} A live `DockTreeNode | null`.
   */
  function hydrate(raw, panelInstances) {
    if (!raw || typeof raw !== 'object' || !deps) return null;
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

  /**
   * @returns {void}
   */
  function persist() {
    if (!deps) return;
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

  /**
   * @returns {boolean} true on successful restore, false when nothing
   *   was found, the version doesn't match, or the profile differs.
   */
  function restore() {
    if (!deps) return false;
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
    restore: restore,
    getPersistenceKey: getPersistenceKey,
    getPersistenceStorage: getPersistenceStorage
  };
})();
