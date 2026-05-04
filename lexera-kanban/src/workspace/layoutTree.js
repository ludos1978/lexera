(function () {
  'use strict';

  function normalizeViewKind(value) {
    var normalized = String(value == null ? '' : value).trim().toLowerCase();
    if (normalized === 'canvas') return 'canvas';
    if (normalized === 'kanban') return 'kanban';
    return 'default';
  }

  function isPanelTab(tab) {
    return !!(tab && tab.kind === 'panel');
  }

  function isBoardTab(tab) {
    return !!tab && !isPanelTab(tab);
  }

  function visitTree(node, visitor, parent, side) {
    if (!node) return;
    visitor(node, parent || null, side || '');
    if (node.type === 'split') {
      visitTree(node.first, visitor, node, 'first');
      visitTree(node.second, visitor, node, 'second');
    }
  }

  function getFirstLeaf(node) {
    if (!node) return null;
    if (node.type === 'tabs') return node;
    return getFirstLeaf(node.first) || getFirstLeaf(node.second);
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

  function findClosestSplitParent(node, targetLeafId, parentSplit) {
    if (!node) return null;
    if (node.type === 'tabs') return node.id === targetLeafId ? parentSplit : null;
    return findClosestSplitParent(node.first, targetLeafId, node)
      || findClosestSplitParent(node.second, targetLeafId, node);
  }

  function countTreeTabs(tree) {
    var count = 0;
    visitTree(tree, function (node) {
      if (node.type === 'tabs') count += node.tabs.length;
    });
    return count;
  }

  // Walk every leaf in a tree (or any of the side-dock trees) and collect
  // tab.id values. Used by the workspace shell's view-lifecycle audit
  // (Phase 0.2), the orphan reaper before full DOM rebuild (Phase 1.4),
  // and the lifecycle reconciler (Phase 2). Order is unspecified;
  // duplicates only appear if the tree itself contains duplicates.
  function collectAllTabIds(tree) {
    var ids = [];
    visitTree(tree, function (node) {
      if (node.type !== 'tabs' || !Array.isArray(node.tabs)) return;
      for (var i = 0; i < node.tabs.length; i++) {
        if (node.tabs[i] && node.tabs[i].id) ids.push(node.tabs[i].id);
      }
    });
    return ids;
  }

  // ─── Phase 3.1 mutation API ─────────────────────────────────────────
  // Encapsulated tab-mutation helpers so workspaceShell.js stops
  // poking `node.tabs.splice(…)` and `state.dockTree = …` directly.
  // Each helper enforces the activeTabId / fall-through invariants
  // (pick a new active when the removed tab was active, set active on
  // a previously empty destination, etc.) and returns metadata the
  // caller can hand to `removeFrame` if needed.
  //
  // None of these functions know about webviews — `removeFrame` and
  // multiview destruction stay in workspaceShell.js. The lifecycle
  // reconciler (Phase 2.2) is the safety net; these helpers eliminate
  // a whole category of "forgot to call removeFrame" bugs at the
  // mutation site.

  function removeTabById(tree, tabId) {
    if (!tree || !tabId) return null;
    var hit = null;
    visitTree(tree, function (node) {
      if (hit || !node || node.type !== 'tabs' || !Array.isArray(node.tabs)) return;
      for (var i = 0; i < node.tabs.length; i++) {
        var tab = node.tabs[i];
        if (tab && tab.id === tabId) {
          node.tabs.splice(i, 1);
          if (node.activeTabId === tabId) {
            node.activeTabId = node.tabs.length > 0 ? node.tabs[0].id : '';
          }
          hit = { removed: tab, leaf: node, index: i };
          return;
        }
      }
    });
    return hit;
  }

  function insertTabIntoLeaf(leaf, tab, index) {
    if (!leaf || leaf.type !== 'tabs' || !tab) return -1;
    if (!Array.isArray(leaf.tabs)) leaf.tabs = [];
    var clamped = typeof index === 'number' && isFinite(index)
      ? Math.max(0, Math.min(index | 0, leaf.tabs.length))
      : leaf.tabs.length;
    leaf.tabs.splice(clamped, 0, tab);
    if (!leaf.activeTabId) leaf.activeTabId = tab.id || '';
    return clamped;
  }

  function moveTab(sourceLeaf, sourceIndex, destLeaf, destIndex) {
    if (!sourceLeaf || sourceLeaf.type !== 'tabs') return null;
    if (!destLeaf || destLeaf.type !== 'tabs') return null;
    if (!Array.isArray(sourceLeaf.tabs) || sourceLeaf.tabs.length === 0) return null;
    var srcIdx = typeof sourceIndex === 'number' && isFinite(sourceIndex)
      ? sourceIndex | 0 : -1;
    if (srcIdx < 0 || srcIdx >= sourceLeaf.tabs.length) return null;
    var tab = sourceLeaf.tabs.splice(srcIdx, 1)[0];
    if (!tab) return null;
    if (sourceLeaf.activeTabId === tab.id) {
      sourceLeaf.activeTabId = sourceLeaf.tabs.length > 0 ? sourceLeaf.tabs[0].id : '';
    }
    var dstIdx = typeof destIndex === 'number' && isFinite(destIndex)
      ? destIndex | 0 : destLeaf.tabs.length;
    // When moving within the same leaf, the splice above shifted later
    // indices left by one — clamp so dst is still in range.
    if (sourceLeaf === destLeaf && dstIdx > srcIdx) dstIdx -= 1;
    var inserted = insertTabIntoLeaf(destLeaf, tab, dstIdx);
    return { tab: tab, insertedAt: inserted };
  }

  function replaceTreeRoot(holder, key, nextTree) {
    if (!holder || !key) return { removed: [], added: [] };
    var oldTree = holder[key] || null;
    holder[key] = nextTree || null;
    var oldIds = oldTree ? collectAllTabIds(oldTree) : [];
    var newIds = nextTree ? collectAllTabIds(nextTree) : [];
    var newSet = Object.create(null);
    for (var ni = 0; ni < newIds.length; ni++) newSet[newIds[ni]] = true;
    var oldSet = Object.create(null);
    for (var oi = 0; oi < oldIds.length; oi++) oldSet[oldIds[oi]] = true;
    var removed = [];
    for (var ri = 0; ri < oldIds.length; ri++) {
      if (!newSet[oldIds[ri]]) removed.push(oldIds[ri]);
    }
    var added = [];
    for (var ai = 0; ai < newIds.length; ai++) {
      if (!oldSet[newIds[ai]]) added.push(newIds[ai]);
    }
    return { removed: removed, added: added };
  }

  function createIdFactory() {
    var counter = 1;
    return function (prefix) {
      counter += 1;
      return prefix + '-' + Date.now().toString(36) + '-' + counter.toString(36);
    };
  }

  function createTabsetNode(tabs, idFactory) {
    var list = Array.isArray(tabs) ? tabs.slice() : [];
    return {
      type: 'tabs',
      id: idFactory('pane'),
      tabs: list,
      activeTabId: list.length > 0 ? list[0].id : ''
    };
  }

  function createSplitNode(axis, first, second, ratio, idFactory) {
    return {
      type: 'split',
      id: idFactory('split'),
      axis: axis === 'horizontal' ? 'horizontal' : 'vertical',
      ratio: typeof ratio === 'number' && isFinite(ratio) ? Math.max(0.18, Math.min(0.82, ratio)) : 0.5,
      first: first,
      second: second
    };
  }

  function withNormalizedLeaves(node, isRoot, idFactory) {
    if (!node) return isRoot ? createTabsetNode([], idFactory) : null;
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
    node.first = withNormalizedLeaves(node.first, false, idFactory);
    node.second = withNormalizedLeaves(node.second, false, idFactory);
    if (!node.first && !node.second) return isRoot ? createTabsetNode([], idFactory) : null;
    if (!node.first) return node.second;
    if (!node.second) return node.first;
    return node;
  }

  function findLeafContainingBoard(node, boardId, viewKind) {
    var desiredView = normalizeViewKind(viewKind);
    var found = null;
    visitTree(node, function (candidate) {
      if (found || candidate.type !== 'tabs') return;
      for (var i = 0; i < candidate.tabs.length; i++) {
        var tab = candidate.tabs[i];
        if (!isBoardTab(tab)) continue;
        if (tab.boardId === boardId && tab.viewKind === desiredView) {
          found = { tab: tab, leaf: candidate };
          return;
        }
      }
    });
    return found;
  }

  function findAnyLeafContainingBoard(node, boardId) {
    var found = null;
    visitTree(node, function (candidate) {
      if (found || candidate.type !== 'tabs') return;
      for (var i = 0; i < candidate.tabs.length; i++) {
        var tab = candidate.tabs[i];
        if (!isBoardTab(tab)) continue;
        if (tab.boardId === boardId) {
          found = { tab: tab, leaf: candidate };
          return;
        }
      }
    });
    return found;
  }

  function createBoardTab(boardId, viewKind, idFactory) {
    return {
      id: idFactory('tab'),
      kind: 'board',
      boardId: boardId || '',
      viewKind: normalizeViewKind(viewKind)
    };
  }

  function createPanelTab(panelId, idFactory) {
    return {
      id: idFactory('tab'),
      kind: 'panel',
      panelId: String(panelId || '')
    };
  }

  function migratePanelDocksToSideDocks(panelDocks, panelGroupActives, idFactory) {
    var result = { left: null, right: null, bottom: null };
    var dockIds = ['left', 'right', 'bottom'];
    for (var d = 0; d < dockIds.length; d++) {
      var dockId = dockIds[d];
      var groups = panelDocks[dockId];
      if (!Array.isArray(groups) || groups.length === 0) continue;
      var tabsetNodes = [];
      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        if (!Array.isArray(group) || group.length === 0) continue;
        var tabs = [];
        for (var p = 0; p < group.length; p++) {
          tabs.push(createPanelTab(group[p], idFactory));
        }
        if (tabs.length === 0) continue;
        var node = createTabsetNode(tabs, idFactory);
        var groupKey = group.join(',');
        var activePanel = panelGroupActives && panelGroupActives[groupKey];
        if (activePanel) {
          for (var k = 0; k < node.tabs.length; k++) {
            if (node.tabs[k].panelId === activePanel) {
              node.activeTabId = node.tabs[k].id;
              break;
            }
          }
        }
        tabsetNodes.push(node);
      }
      if (tabsetNodes.length === 0) continue;
      if (tabsetNodes.length === 1) {
        result[dockId] = tabsetNodes[0];
      } else {
        var axis = dockId === 'bottom' ? 'horizontal' : 'vertical';
        var tree = tabsetNodes[0];
        for (var n = 1; n < tabsetNodes.length; n++) {
          tree = createSplitNode(axis, tree, tabsetNodes[n], 0.5, idFactory);
        }
        result[dockId] = tree;
      }
    }
    return result;
  }

  function findLeafContainingPanel(node, panelId, resolvePanelTarget) {
    var normalizedPanelId = resolvePanelTarget(panelId);
    if (!normalizedPanelId) return null;
    var found = null;
    visitTree(node, function (candidate) {
      if (found || candidate.type !== 'tabs') return;
      for (var i = 0; i < candidate.tabs.length; i++) {
        var tab = candidate.tabs[i];
        if (!isPanelTab(tab)) continue;
        if (resolvePanelTarget(tab.panelId) === normalizedPanelId) {
          found = { tab: tab, leaf: candidate };
          return;
        }
      }
    });
    return found;
  }

  var api = {
    normalizeViewKind: normalizeViewKind,
    isPanelTab: isPanelTab,
    isBoardTab: isBoardTab,
    visitTree: visitTree,
    getFirstLeaf: getFirstLeaf,
    findLeafById: findLeafById,
    findNodeAndParent: findNodeAndParent,
    findTab: findTab,
    findClosestSplitParent: findClosestSplitParent,
    countTreeTabs: countTreeTabs,
    collectAllTabIds: collectAllTabIds,
    removeTabById: removeTabById,
    insertTabIntoLeaf: insertTabIntoLeaf,
    moveTab: moveTab,
    replaceTreeRoot: replaceTreeRoot,
    createIdFactory: createIdFactory,
    createTabsetNode: createTabsetNode,
    createSplitNode: createSplitNode,
    withNormalizedLeaves: withNormalizedLeaves,
    createBoardTab: createBoardTab,
    createPanelTab: createPanelTab,
    migratePanelDocksToSideDocks: migratePanelDocksToSideDocks,
    findLeafContainingBoard: findLeafContainingBoard,
    findAnyLeafContainingBoard: findAnyLeafContainingBoard,
    findLeafContainingPanel: findLeafContainingPanel
  };

  if (typeof window !== 'undefined') {
    window.LexeraLayoutTree = api;
  }
})();
