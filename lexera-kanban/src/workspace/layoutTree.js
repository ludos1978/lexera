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
