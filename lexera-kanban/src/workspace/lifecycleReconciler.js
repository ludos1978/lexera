(function () {
  'use strict';

  // Workspace shell view-lifecycle reconciler (Phase 2 of the
  // ghost-views fix). Background: the layout tree (`state.dockTree` /
  // `state.sideDocks`) and the webview state (`state.frameCache` +
  // multiview spawned tabs) are dual stores that drift whenever a
  // mutation path splices a tab out of a leaf without calling
  // `removeFrame`. Phase 1 plugged each known site individually; Phase 2
  // adds a reconciler that runs once per render and destroys whatever
  // the layout tree no longer references — belt-and-braces against any
  // future mutation path that forgets to clean up.
  //
  // The reconciler is a pure observer:
  //   - It owns no DOM and mutates no state besides its own snapshot.
  //   - It calls `removeFrame(tabId)` exactly once per tab that was in
  //     the previous snapshot but is absent from the current trees.
  //   - It never destroys a tab that the current trees still reference,
  //     even if the tab is new (added since the last reconcile).
  //
  // Phase 2.2 wires `reconcile(state)` as the first call inside
  // `render()`, skipped while a drag is in flight (state.dragTabId set).

  /**
   * @typedef {Object} ReconcilerTreesState
   *   The subset of `state` (workspace shell) the reconciler reads. Kept
   *   structural so the reconciler stays decoupled from the umbrella
   *   `WorkspaceShellState` typedef in workspaceShell.js.
   * @property {*} [dockTree] - Centre dock tree (a `DockTreeNode | null`
   *   on the consumer side; opaque here — passed straight to the
   *   injected `collectAllTabIds`).
   * @property {{left?: *, right?: *, bottom?: *}} [sideDocks] - Side-dock
   *   trees keyed by dock id. Each is a `DockTreeNode | null` upstream.
   */

  /**
   * @typedef {function(*): Array<string>} CollectAllTabIdsFn
   *   Injected by the caller — typically `LexeraLayoutTree.collectAllTabIds`.
   *   Walks a dock-tree node and returns every tab id reachable from it.
   *   The reconciler treats the result as opaque — it only iterates the
   *   returned ids and never inspects tree shape directly.
   */

  /**
   * @typedef {function(string): void} RemoveFrameFn
   *   Injected by the caller — fires once per tab id that was in the
   *   previous snapshot but is absent from the current trees. The shell
   *   wraps this around its `frameCache` cleanup + multiview destroy IPC.
   */

  /**
   * @typedef {function(*): void} PrepareTabFn
   *   Reserved for a later phase that may take ownership of tab spawn.
   *   Phase 2.1 only handles teardown, so this is captured but unused.
   */

  /**
   * @typedef {Object} ReconcilerDeps
   * @property {CollectAllTabIdsFn} [collectAllTabIds]
   * @property {RemoveFrameFn} [removeFrame]
   * @property {PrepareTabFn} [prepareTab]
   */

  /**
   * @typedef {Object} ReconcileResult
   * @property {Array<string>} destroyed - Tab ids the reconciler called
   *   `removeFrame` on this tick.
   * @property {Array<string>} snapshot - Every tab id reachable from the
   *   current trees (the next baseline).
   */

  /**
   * @typedef {Object} LexeraLifecycleReconcilerInstance
   * @property {function(ReconcilerTreesState): ReconcileResult} reconcile
   *   Diff the previous snapshot against the current trees; destroy
   *   anything missing; return what was destroyed and the new snapshot.
   *   No-ops when either of `collectAllTabIds` / `removeFrame` is missing.
   * @property {function(): void} reset - Drop the previous snapshot so
   *   the next `reconcile` treats every current id as new.
   * @property {function(): Array<string>} _test_lastSnapshot - Test seam.
   * @property {function(): boolean} _test_prepareTabBound - Test seam.
   */

  /**
   * @typedef {Object} LexeraLifecycleReconcilerApi
   * @property {function(ReconcilerDeps): LexeraLifecycleReconcilerInstance} create
   */

  /**
   * @param {ReconcilerTreesState|null|undefined} state
   * @param {CollectAllTabIdsFn} collectAllTabIds
   * @returns {Object<string, true>}
   */
  function gatherCurrentIds(state, collectAllTabIds) {
    /** @type {Object<string, true>} */
    var ids = Object.create(null);
    if (!state || typeof collectAllTabIds !== 'function') return ids;
    var trees = [
      state.dockTree,
      state.sideDocks && state.sideDocks.left,
      state.sideDocks && state.sideDocks.right,
      state.sideDocks && state.sideDocks.bottom
    ];
    for (var ti = 0; ti < trees.length; ti++) {
      var tree = trees[ti];
      if (!tree) continue;
      var got = collectAllTabIds(tree);
      if (!Array.isArray(got)) continue;
      for (var ii = 0; ii < got.length; ii++) {
        var id = got[ii];
        if (id) ids[id] = true;
      }
    }
    return ids;
  }

  /**
   * @param {ReconcilerDeps} [deps]
   * @returns {LexeraLifecycleReconcilerInstance}
   */
  function create(deps) {
    deps = deps || {};
    var collectAllTabIds = typeof deps.collectAllTabIds === 'function'
      ? deps.collectAllTabIds : null;
    var removeFrame = typeof deps.removeFrame === 'function'
      ? deps.removeFrame : null;
    // `prepareTab` reserved for a later phase that may take ownership of
    // tab spawn as well as teardown. Phase 2.1 only handles teardown, so
    // it is captured but unused here.
    var prepareTab = typeof deps.prepareTab === 'function'
      ? deps.prepareTab : null;

    /** @type {Object<string, true>} */
    var lastSnapshot = Object.create(null);

    /**
     * @param {ReconcilerTreesState} state
     * @returns {ReconcileResult}
     */
    function reconcile(state) {
      if (!collectAllTabIds || !removeFrame) {
        return { destroyed: [], snapshot: [] };
      }
      var currentIds = gatherCurrentIds(state, collectAllTabIds);
      /** @type {Array<string>} */
      var destroyed = [];
      for (var prevId in lastSnapshot) {
        if (!Object.prototype.hasOwnProperty.call(lastSnapshot, prevId)) continue;
        if (currentIds[prevId]) continue;
        removeFrame(prevId);
        destroyed.push(prevId);
      }
      lastSnapshot = currentIds;
      return {
        destroyed: destroyed,
        snapshot: Object.keys(currentIds)
      };
    }

    function reset() {
      lastSnapshot = Object.create(null);
    }

    return {
      reconcile: reconcile,
      reset: reset,
      _test_lastSnapshot: function () { return Object.keys(lastSnapshot); },
      _test_prepareTabBound: function () { return !!prepareTab; }
    };
  }

  /** @type {LexeraLifecycleReconcilerApi} */
  var api = {
    create: create
  };

  if (typeof window !== 'undefined') {
    window.LexeraLifecycleReconciler = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
