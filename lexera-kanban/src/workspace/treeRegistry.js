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

  var TREE_IDS = ['center', 'left', 'right', 'bottom'];
  var deps = null;

  function setup(setupDeps) {
    if (!setupDeps || !setupDeps.state || !setupDeps.layoutTree ||
        typeof setupDeps.withNormalizedLeaves !== 'function' ||
        typeof setupDeps.resolvePanelTargetFn !== 'function') {
      throw new Error('LexeraTreeRegistry.setup requires { state, layoutTree, withNormalizedLeaves, resolvePanelTargetFn }');
    }
    deps = setupDeps;
  }

  function allTreeIds() { return TREE_IDS; }

  function getTreeRoot(treeId) {
    var state = deps.state;
    if (treeId === 'center') return state.dockTree;
    return state.sideDocks ? state.sideDocks[treeId] || null : null;
  }

  function setTreeRoot(treeId, root) {
    var state = deps.state;
    if (treeId === 'center') { state.dockTree = root; return; }
    if (state.sideDocks) state.sideDocks[treeId] = root;
  }

  function normalizeAllTrees() {
    for (var i = 0; i < TREE_IDS.length; i++) {
      var root = getTreeRoot(TREE_IDS[i]);
      if (!root) continue;
      setTreeRoot(TREE_IDS[i], deps.withNormalizedLeaves(root, TREE_IDS[i] === 'center'));
    }
  }

  function findLeafInAllTrees(leafId) {
    for (var i = 0; i < TREE_IDS.length; i++) {
      var root = getTreeRoot(TREE_IDS[i]);
      if (!root) continue;
      var leaf = deps.layoutTree.findLeafById(root, leafId);
      if (leaf) return { treeId: TREE_IDS[i], leaf: leaf };
    }
    return null;
  }

  function findTabInAllTrees(tabId) {
    for (var i = 0; i < TREE_IDS.length; i++) {
      var root = getTreeRoot(TREE_IDS[i]);
      if (!root) continue;
      var found = deps.layoutTree.findTab(root, tabId);
      if (found) return { treeId: TREE_IDS[i], tab: found.tab, leaf: found.leaf, index: found.index };
    }
    return null;
  }

  function findPanelInAllTrees(panelId) {
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
