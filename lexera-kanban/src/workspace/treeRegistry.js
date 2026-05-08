/**
 * LexeraTreeRegistry
 *
 * The shell holds four layout trees: one center dock and three side
 * docks (left, right, bottom). Most queries and mutations need to
 * iterate all four — this module centralises that fan-out. The shell
 * binds its `state` plus layoutTree-derived helpers via setup(); after
 * that, all functions operate without per-call state arguments so
 * call-sites stay clean.
 *
 * Setup contract:
 *   LexeraTreeRegistry.setup({
 *     state,                // shell state (live reference)
 *     layoutTree,           // window.LexeraLayoutTree
 *     withNormalizedLeaves, // local layoutTree-bound: (node, isRoot) → node
 *     resolvePanelTargetFn  // (id) → resolved instance id
 *   });
 *
 * Public API:
 *   allTreeIds()
 *   getTreeRoot(treeId)
 *   setTreeRoot(treeId, root)
 *   normalizeAllTrees()
 *   findLeafInAllTrees(leafId)
 *   findTabInAllTrees(tabId)
 *   findPanelInAllTrees(panelId)
 */
(function () {
  'use strict';

  /**
   * @typedef {('center'|'left'|'right'|'bottom')} TreeId
   *   Stable identifier for the four layout-tree slots the shell owns.
   *   `'center'` resolves to `state.dockTree`; the other three are
   *   indices into `state.sideDocks`.
   */

  /**
   * @typedef {Object} TreeRegistryState
   *   Structural subset of the workspace shell state that this module
   *   reads / writes. Kept narrow so the registry stays decoupled from
   *   the umbrella `WorkspaceShellState` typedef in workspaceShell.js.
   * @property {*} [dockTree] - Centre dock tree (`DockTreeNode | null`
   *   on the consumer side; opaque here).
   * @property {{left?: *, right?: *, bottom?: *}} [sideDocks] - Side-dock
   *   trees keyed by dock id.
   */

  /**
   * @typedef {function(*, boolean): *} WithNormalizedLeavesFn
   *   The local `withNormalizedLeaves` wrapper the shell binds with its
   *   own `idFactory`. Takes (node, isRoot) and returns a normalised
   *   `DockTreeNode | null`.
   */

  /**
   * @typedef {function(string|null|undefined): string} ResolvePanelTargetFn
   *   Maps a panel id (which may be an instance id or a panel-kind
   *   shorthand) to its canonical instance id. Returns empty string on
   *   non-resolvable input.
   */

  /**
   * @typedef {Object} TreeRegistrySetupDeps
   * @property {TreeRegistryState} state - Live reference to the shell
   *   state — the registry never copies, so mutations land directly on
   *   the shell's source of truth.
   * @property {*} layoutTree - `window.LexeraLayoutTree`. Tree-walk
   *   primitives (`findLeafById`, `findTab`, `findLeafContainingPanel`)
   *   are read off this object once setup() runs.
   * @property {WithNormalizedLeavesFn} withNormalizedLeaves
   * @property {ResolvePanelTargetFn} resolvePanelTargetFn
   */

  /**
   * @typedef {Object} LeafFindHit
   * @property {TreeId} treeId
   * @property {*} leaf - The matched `DockTreeLeaf`.
   */

  /**
   * @typedef {Object} TabFindHit
   * @property {TreeId} treeId
   * @property {*} tab - The matched `DockTreeTab`.
   * @property {*} leaf - The leaf containing it.
   * @property {number} index - The tab's index inside `leaf.tabs` at
   *   the moment of the search.
   */

  /**
   * @typedef {Object} PanelFindHit
   * @property {TreeId} treeId
   * @property {*} tab - The matched `DockTreePanelTab`.
   * @property {*} leaf - The leaf containing it.
   */

  /** @type {Array<TreeId>} */
  var TREE_IDS = ['center', 'left', 'right', 'bottom'];
  /** @type {TreeRegistrySetupDeps|null} */
  var deps = null;

  /**
   * @param {TreeRegistrySetupDeps} setupDeps
   * @returns {void}
   */
  function setup(setupDeps) {
    if (!setupDeps || !setupDeps.state || !setupDeps.layoutTree ||
        typeof setupDeps.withNormalizedLeaves !== 'function' ||
        typeof setupDeps.resolvePanelTargetFn !== 'function') {
      throw new Error('LexeraTreeRegistry.setup requires { state, layoutTree, withNormalizedLeaves, resolvePanelTargetFn }');
    }
    deps = setupDeps;
  }

  /**
   * @returns {Array<TreeId>}
   */
  function allTreeIds() { return TREE_IDS; }

  /**
   * @param {TreeId} treeId
   * @returns {*}
   */
  function getTreeRoot(treeId) {
    if (!deps) return null;
    var state = deps.state;
    if (treeId === 'center') return state.dockTree;
    return state.sideDocks ? state.sideDocks[treeId] || null : null;
  }

  /**
   * @param {TreeId} treeId
   * @param {*} root
   * @returns {void}
   */
  function setTreeRoot(treeId, root) {
    if (!deps) return;
    var state = deps.state;
    if (treeId === 'center') { state.dockTree = root; return; }
    if (state.sideDocks) state.sideDocks[treeId] = root;
  }

  /**
   * @returns {void}
   */
  function normalizeAllTrees() {
    if (!deps) return;
    for (var i = 0; i < TREE_IDS.length; i++) {
      var root = getTreeRoot(TREE_IDS[i]);
      if (!root) continue;
      setTreeRoot(TREE_IDS[i], deps.withNormalizedLeaves(root, TREE_IDS[i] === 'center'));
    }
  }

  /**
   * @param {string} leafId
   * @returns {LeafFindHit|null}
   */
  function findLeafInAllTrees(leafId) {
    if (!deps) return null;
    for (var i = 0; i < TREE_IDS.length; i++) {
      var root = getTreeRoot(TREE_IDS[i]);
      if (!root) continue;
      var leaf = deps.layoutTree.findLeafById(root, leafId);
      if (leaf) return { treeId: TREE_IDS[i], leaf: leaf };
    }
    return null;
  }

  /**
   * @param {string} tabId
   * @returns {TabFindHit|null}
   */
  function findTabInAllTrees(tabId) {
    if (!deps) return null;
    for (var i = 0; i < TREE_IDS.length; i++) {
      var root = getTreeRoot(TREE_IDS[i]);
      if (!root) continue;
      var found = deps.layoutTree.findTab(root, tabId);
      if (found) return { treeId: TREE_IDS[i], tab: found.tab, leaf: found.leaf, index: found.index };
    }
    return null;
  }

  /**
   * @param {string} panelId
   * @returns {PanelFindHit|null}
   */
  function findPanelInAllTrees(panelId) {
    if (!deps) return null;
    for (var i = 0; i < TREE_IDS.length; i++) {
      var root = getTreeRoot(TREE_IDS[i]);
      if (!root) continue;
      var found = deps.layoutTree.findLeafContainingPanel(root, panelId, deps.resolvePanelTargetFn);
      if (found) return { treeId: TREE_IDS[i], tab: found.tab, leaf: found.leaf };
    }
    return null;
  }

  window.LexeraTreeRegistry = {
    setup: setup,
    allTreeIds: allTreeIds,
    getTreeRoot: getTreeRoot,
    setTreeRoot: setTreeRoot,
    normalizeAllTrees: normalizeAllTrees,
    findLeafInAllTrees: findLeafInAllTrees,
    findTabInAllTrees: findTabInAllTrees,
    findPanelInAllTrees: findPanelInAllTrees
  };
})();
