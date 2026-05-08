(function () {
  'use strict';

  /**
   * @typedef {function(string): string} IdFactory
   *   Returned by `createIdFactory()`. Call with a prefix
   *   (`'tab'` / `'pane'` / `'split'`) to mint a unique
   *   `<prefix>-<base36-time>-<base36-counter>` id. Counter is
   *   monotonic per factory instance; the time component keeps ids
   *   distinct across reloads.
   */

  /**
   * @typedef {Object} DockTreeBoardTab
   * @property {string} id - Stable tab id minted by `createBoardTab` /
   *   `idFactory('tab')`.
   * @property {'board'} kind - Discriminator.
   * @property {string} boardId - The board this tab opens. Empty
   *   string is allowed mid-creation flow (matches the workspace
   *   shell's tolerance for transient empty board ids).
   * @property {('canvas'|'kanban'|'default')} viewKind - Normalised
   *   view kind from `normalizeViewKind`.
   */

  /**
   * @typedef {Object} DockTreePanelTab
   * @property {string} id - Stable tab id minted by `createPanelTab` /
   *   `idFactory('tab')`.
   * @property {'panel'} kind - Discriminator.
   * @property {string} panelId - Matches a key in the workspace
   *   shell's `state.panelInstances`.
   */

  /**
   * @typedef {(DockTreeBoardTab|DockTreePanelTab)} DockTreeTab
   *   The element type of `DockTreeLeaf.tabs`. Discriminated by
   *   `kind`. Owned wholesale by this module — workspace shell
   *   reads but never constructs these.
   */

  /**
   * @typedef {Object} DockTreeLeaf
   * @property {'tabs'} type - Discriminator.
   * @property {string} id - Stable pane id minted by `idFactory('pane')`.
   * @property {Array<DockTreeTab>} tabs - Ordered list of tabs in this
   *   pane. May be empty briefly during mutation; `withNormalizedLeaves`
   *   collapses empty non-root leaves to `null`.
   * @property {string} activeTabId - Id of the currently rendered tab
   *   in `tabs`. Empty string when the leaf is empty. Kept consistent
   *   by `withNormalizedLeaves` and the mutation helpers below
   *   (`removeTabById`, `removeTabFromLeaf`, `extractTabAtIndex`,
   *   `insertTabIntoLeaf`, `moveTab`).
   */

  /**
   * @typedef {Object} DockTreeSplit
   * @property {'split'} type - Discriminator.
   * @property {string} id - Stable split id minted by `idFactory('split')`.
   * @property {('horizontal'|'vertical')} axis - `horizontal` stacks
   *   first-above-second; `vertical` puts them side-by-side.
   * @property {number} ratio - First-child fraction of the split,
   *   clamped to `[0.18, 0.82]` by `createSplitNode`.
   * @property {DockTreeNode} first - First child (top / left).
   * @property {DockTreeNode} second - Second child (bottom / right).
   */

  /**
   * @typedef {(DockTreeLeaf|DockTreeSplit)} DockTreeNode
   *   Recursive node type. The workspace shell's `state.dockTree` is a
   *   `DockTreeNode | null`; each `state.sideDocks[dockId]` is also a
   *   `DockTreeNode | null`.
   */

  /**
   * @typedef {Object} TabFindHit
   * @property {DockTreeTab} tab - The matched tab.
   * @property {DockTreeLeaf} leaf - The leaf that owned the match.
   * @property {number} index - The matched tab's index inside
   *   `leaf.tabs` at the moment of the search.
   */

  /**
   * @typedef {Object} NodeFindHit
   * @property {DockTreeNode} node - The matched node.
   * @property {DockTreeNode|null} parent - The parent split, or
   *   `null` when `node` is the root.
   * @property {('first'|'second'|'')} side - Which child slot
   *   `node` occupied on `parent`. Empty string for the root.
   */

  /**
   * @typedef {Object} TabRemoveHit
   * @property {DockTreeTab} removed - The tab that was spliced out.
   * @property {DockTreeLeaf} leaf - The leaf the tab was removed from.
   * @property {number} index - The index the tab occupied just before
   *   removal.
   */

  /**
   * @typedef {Object} TabMoveHit
   * @property {DockTreeTab} tab - The moved tab.
   * @property {number} insertedAt - Final index inside the destination
   *   leaf after same-leaf clamp / cross-leaf insert.
   */

  /**
   * @typedef {Object} ReplaceTreeRootDiff
   * @property {Array<string>} removed - Tab ids present in the OLD
   *   tree but absent from the new one — the lifecycle reconciler
   *   destroys these.
   * @property {Array<string>} added - Tab ids present in the NEW tree
   *   but absent from the old one — the shell spawns webviews for
   *   these on the next render.
   */

  /**
   * @typedef {Object} BoardLeafHit
   * @property {DockTreeBoardTab} tab - The matched board tab.
   * @property {DockTreeLeaf} leaf - The leaf containing it.
   */

  /**
   * @typedef {Object} PanelLeafHit
   * @property {DockTreePanelTab} tab - The matched panel tab.
   * @property {DockTreeLeaf} leaf - The leaf containing it.
   */

  /**
   * @typedef {{left: Array<Array<string>>, right: Array<Array<string>>, bottom: Array<Array<string>>}} LegacyPanelDocks
   *   Pre-tab-tree persistence shape: per dock, a list of groups, each
   *   group a list of panel ids. `migratePanelDocksToSideDocks` walks
   *   it once at boot and emits a `DockTreeNode | null` per dock.
   */

  /**
   * @typedef {function(DockTreeNode|null, function(DockTreeNode, DockTreeNode|null, ('first'|'second'|'')): void, DockTreeNode=, ('first'|'second'|'')=): void} VisitTreeFn
   */

  /**
   * @param {string|number|null|undefined} value
   * @returns {('canvas'|'kanban'|'default')}
   */
  function normalizeViewKind(value) {
    var normalized = String(value == null ? '' : value).trim().toLowerCase();
    if (normalized === 'canvas') return 'canvas';
    if (normalized === 'kanban') return 'kanban';
    return 'default';
  }

  /**
   * @param {*} tab
   * @returns {boolean}
   */
  function isPanelTab(tab) {
    return !!(tab && tab.kind === 'panel');
  }

  /**
   * @param {*} tab
   * @returns {boolean}
   */
  function isBoardTab(tab) {
    return !!tab && !isPanelTab(tab);
  }

  /**
   * @param {DockTreeNode|null} node
   * @param {function(DockTreeNode, DockTreeNode|null, ('first'|'second'|'')): void} visitor
   * @param {DockTreeNode} [parent]
   * @param {('first'|'second'|'')} [side]
   * @returns {void}
   */
  function visitTree(node, visitor, parent, side) {
    if (!node) return;
    visitor(node, parent || null, side || '');
    if (node.type === 'split') {
      visitTree(node.first, visitor, node, 'first');
      visitTree(node.second, visitor, node, 'second');
    }
  }

  /**
   * @param {DockTreeNode|null} node
   * @returns {DockTreeLeaf|null}
   */
  function getFirstLeaf(node) {
    if (!node) return null;
    if (node.type === 'tabs') return node;
    return getFirstLeaf(node.first) || getFirstLeaf(node.second);
  }

  /**
   * @param {DockTreeNode|null} node
   * @param {string} leafId
   * @returns {DockTreeLeaf|null}
   */
  function findLeafById(node, leafId) {
    /** @type {DockTreeLeaf|null} */
    var found = null;
    visitTree(node, function (candidate) {
      if (!found && candidate.type === 'tabs' && candidate.id === leafId) {
        found = /** @type {DockTreeLeaf} */ (candidate);
      }
    });
    return found;
  }

  /**
   * @param {DockTreeNode|null} node
   * @param {string} nodeId
   * @returns {NodeFindHit|null}
   */
  function findNodeAndParent(node, nodeId) {
    /** @type {NodeFindHit|null} */
    var found = null;
    visitTree(node, function (candidate, parent, side) {
      if (!found && candidate.id === nodeId) {
        found = { node: candidate, parent: parent || null, side: side || '' };
      }
    });
    return found;
  }

  /**
   * @param {DockTreeNode|null} node
   * @param {string} tabId
   * @returns {TabFindHit|null}
   */
  function findTab(node, tabId) {
    /** @type {TabFindHit|null} */
    var found = null;
    visitTree(node, function (candidate) {
      if (found || candidate.type !== 'tabs') return;
      var leaf = /** @type {DockTreeLeaf} */ (candidate);
      for (var i = 0; i < leaf.tabs.length; i++) {
        if (leaf.tabs[i].id === tabId) {
          found = {
            tab: leaf.tabs[i],
            leaf: leaf,
            index: i
          };
          return;
        }
      }
    });
    return found;
  }

  /**
   * @param {DockTreeNode|null} node
   * @param {string} targetLeafId
   * @param {DockTreeSplit} [parentSplit]
   * @returns {DockTreeSplit|null}
   */
  function findClosestSplitParent(node, targetLeafId, parentSplit) {
    if (!node) return null;
    if (node.type === 'tabs') return node.id === targetLeafId ? (parentSplit || null) : null;
    return findClosestSplitParent(node.first, targetLeafId, node)
      || findClosestSplitParent(node.second, targetLeafId, node);
  }

  /**
   * @param {DockTreeNode|null} tree
   * @returns {number}
   */
  function countTreeTabs(tree) {
    var count = 0;
    visitTree(tree, function (node) {
      if (node.type === 'tabs') count += node.tabs.length;
    });
    return count;
  }

  /**
   * Walk every leaf in a tree (or any of the side-dock trees) and
   * collect tab.id values. Used by the workspace shell's
   * view-lifecycle audit (Phase 0.2), the orphan reaper before full
   * DOM rebuild (Phase 1.4), and the lifecycle reconciler (Phase 2).
   * Order is unspecified; duplicates only appear if the tree itself
   * contains duplicates.
   *
   * @param {DockTreeNode|null} tree
   * @returns {Array<string>}
   */
  function collectAllTabIds(tree) {
    /** @type {Array<string>} */
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

  /**
   * @param {DockTreeNode|null} tree
   * @param {string} tabId
   * @returns {TabRemoveHit|null}
   */
  function removeTabById(tree, tabId) {
    if (!tree || !tabId) return null;
    /** @type {TabRemoveHit|null} */
    var hit = null;
    visitTree(tree, function (node) {
      if (hit || !node || node.type !== 'tabs' || !Array.isArray(node.tabs)) return;
      var leaf = /** @type {DockTreeLeaf} */ (node);
      for (var i = 0; i < leaf.tabs.length; i++) {
        var tab = leaf.tabs[i];
        if (tab && tab.id === tabId) {
          leaf.tabs.splice(i, 1);
          if (leaf.activeTabId === tabId) {
            leaf.activeTabId = leaf.tabs.length > 0 ? leaf.tabs[0].id : '';
          }
          hit = { removed: tab, leaf: leaf, index: i };
          return;
        }
      }
    });
    return hit;
  }

  // Remove every tab whose id matches `tabId` from the SINGLE given
  // leaf node. Companion to `removeTabById` (which is single-match,
  // tree-wide); use this when a tree walk has already located the
  // leaf and the activeTabId fix-up still needs to honour the same
  // "fall through to the first remaining tab" invariant. Returns the
  // count of tabs removed so a caller can tell whether anything
  // changed without re-scanning.
  /**
   * @param {DockTreeLeaf|null} leaf
   * @param {string} tabId
   * @returns {number} Count of tabs removed.
   */
  function removeTabFromLeaf(leaf, tabId) {
    if (!leaf || leaf.type !== 'tabs' || !Array.isArray(leaf.tabs) || !tabId) return 0;
    var removed = 0;
    for (var i = leaf.tabs.length - 1; i >= 0; i--) {
      var tab = leaf.tabs[i];
      if (tab && tab.id === tabId) {
        leaf.tabs.splice(i, 1);
        removed += 1;
      }
    }
    if (removed > 0 && leaf.activeTabId === tabId) {
      leaf.activeTabId = leaf.tabs.length > 0 ? leaf.tabs[0].id : '';
    }
    return removed;
  }

  // Pull a tab out of a leaf at a known index. Companion to
  // `removeTabFromLeaf` — same primitive shape but with the
  // "extract" activeTabId convention: when the extracted tab was
  // active, fall through to the LEFT NEIGHBOUR (or '' if the leaf
  // becomes empty). That convention dates back to the legacy
  // `extractTab` site in workspaceShell.js — pulling a tab out of
  // a tabset feels like "drag-extract", not "delete and snap to
  // front", so the user's eye is left looking at the previous tab.
  // Returns the removed tab object so callers can use its boardId
  // / panelId / tab id for downstream wiring.
  /**
   * @param {DockTreeLeaf|null} leaf
   * @param {number} index
   * @returns {DockTreeTab|null}
   */
  function extractTabAtIndex(leaf, index) {
    if (!leaf || leaf.type !== 'tabs' || !Array.isArray(leaf.tabs)) return null;
    if (typeof index !== 'number' || !isFinite(index)) return null;
    var idx = index | 0;
    if (idx < 0 || idx >= leaf.tabs.length) return null;
    var removedArr = leaf.tabs.splice(idx, 1);
    if (removedArr.length === 0) return null;
    var removed = removedArr[0];
    if (removed && removed.id && leaf.activeTabId === removed.id) {
      leaf.activeTabId = leaf.tabs.length > 0
        ? leaf.tabs[Math.max(0, idx - 1)].id
        : '';
    }
    return removed;
  }

  /**
   * @param {DockTreeLeaf|null} leaf
   * @param {DockTreeTab} tab
   * @param {number} [index]
   * @returns {number} Final inserted index, or -1 on validation failure.
   */
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

  /**
   * @param {DockTreeLeaf|null} sourceLeaf
   * @param {number} sourceIndex
   * @param {DockTreeLeaf|null} destLeaf
   * @param {number} [destIndex]
   * @returns {TabMoveHit|null}
   */
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
    if (sourceLeaf === destLeaf && dstIdx > srcIdx) dstIdx -= 1;
    var inserted = insertTabIntoLeaf(destLeaf, tab, dstIdx);
    return { tab: tab, insertedAt: inserted };
  }

  /**
   * @param {Object<string, DockTreeNode|null>|null} holder
   * @param {string} key
   * @param {DockTreeNode|null} [nextTree]
   * @returns {ReplaceTreeRootDiff}
   */
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
    /** @type {Array<string>} */
    var removed = [];
    for (var ri = 0; ri < oldIds.length; ri++) {
      if (!newSet[oldIds[ri]]) removed.push(oldIds[ri]);
    }
    /** @type {Array<string>} */
    var added = [];
    for (var ai = 0; ai < newIds.length; ai++) {
      if (!oldSet[newIds[ai]]) added.push(newIds[ai]);
    }
    return { removed: removed, added: added };
  }

  /**
   * @returns {IdFactory}
   */
  function createIdFactory() {
    var counter = 1;
    return function (prefix) {
      counter += 1;
      return prefix + '-' + Date.now().toString(36) + '-' + counter.toString(36);
    };
  }

  /**
   * @param {Array<DockTreeTab>|null|undefined} tabs
   * @param {IdFactory} idFactory
   * @returns {DockTreeLeaf}
   */
  function createTabsetNode(tabs, idFactory) {
    var list = Array.isArray(tabs) ? tabs.slice() : [];
    return {
      type: 'tabs',
      id: idFactory('pane'),
      tabs: list,
      activeTabId: list.length > 0 ? list[0].id : ''
    };
  }

  /**
   * @param {('horizontal'|'vertical'|string)} axis
   * @param {DockTreeNode} first
   * @param {DockTreeNode} second
   * @param {number|null|undefined} ratio
   * @param {IdFactory} idFactory
   * @returns {DockTreeSplit}
   */
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

  /**
   * @param {DockTreeNode|null} node
   * @param {boolean} isRoot
   * @param {IdFactory} idFactory
   * @returns {DockTreeNode|null}
   */
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
    node.first = /** @type {DockTreeNode} */ (withNormalizedLeaves(node.first, false, idFactory));
    node.second = /** @type {DockTreeNode} */ (withNormalizedLeaves(node.second, false, idFactory));
    if (!node.first && !node.second) return isRoot ? createTabsetNode([], idFactory) : null;
    if (!node.first) return node.second;
    if (!node.second) return node.first;
    return node;
  }

  /**
   * @param {DockTreeNode|null} node
   * @param {string} boardId
   * @param {string|undefined} viewKind
   * @returns {BoardLeafHit|null}
   */
  function findLeafContainingBoard(node, boardId, viewKind) {
    var desiredView = normalizeViewKind(viewKind);
    /** @type {BoardLeafHit|null} */
    var found = null;
    visitTree(node, function (candidate) {
      if (found || candidate.type !== 'tabs') return;
      var leaf = /** @type {DockTreeLeaf} */ (candidate);
      for (var i = 0; i < leaf.tabs.length; i++) {
        var tab = leaf.tabs[i];
        if (!isBoardTab(tab)) continue;
        var boardTab = /** @type {DockTreeBoardTab} */ (tab);
        if (boardTab.boardId === boardId && boardTab.viewKind === desiredView) {
          found = { tab: boardTab, leaf: leaf };
          return;
        }
      }
    });
    return found;
  }

  /**
   * @param {DockTreeNode|null} node
   * @param {string} boardId
   * @returns {BoardLeafHit|null}
   */
  function findAnyLeafContainingBoard(node, boardId) {
    /** @type {BoardLeafHit|null} */
    var found = null;
    visitTree(node, function (candidate) {
      if (found || candidate.type !== 'tabs') return;
      var leaf = /** @type {DockTreeLeaf} */ (candidate);
      for (var i = 0; i < leaf.tabs.length; i++) {
        var tab = leaf.tabs[i];
        if (!isBoardTab(tab)) continue;
        var boardTab = /** @type {DockTreeBoardTab} */ (tab);
        if (boardTab.boardId === boardId) {
          found = { tab: boardTab, leaf: leaf };
          return;
        }
      }
    });
    return found;
  }

  /**
   * @param {string|null|undefined} boardId
   * @param {string|null|undefined} viewKind
   * @param {IdFactory} idFactory
   * @returns {DockTreeBoardTab}
   */
  function createBoardTab(boardId, viewKind, idFactory) {
    return {
      id: idFactory('tab'),
      kind: 'board',
      boardId: boardId || '',
      viewKind: normalizeViewKind(viewKind)
    };
  }

  /**
   * @param {string|null|undefined} panelId
   * @param {IdFactory} idFactory
   * @returns {DockTreePanelTab}
   */
  function createPanelTab(panelId, idFactory) {
    return {
      id: idFactory('tab'),
      kind: 'panel',
      panelId: String(panelId || '')
    };
  }

  /**
   * @param {LegacyPanelDocks} panelDocks
   * @param {Object<string, string>|null|undefined} panelGroupActives
   * @param {IdFactory} idFactory
   * @returns {{left: DockTreeNode|null, right: DockTreeNode|null, bottom: DockTreeNode|null}}
   */
  function migratePanelDocksToSideDocks(panelDocks, panelGroupActives, idFactory) {
    /** @type {{left: DockTreeNode|null, right: DockTreeNode|null, bottom: DockTreeNode|null}} */
    var result = { left: null, right: null, bottom: null };
    /** @type {Array<('left'|'right'|'bottom')>} */
    var dockIds = ['left', 'right', 'bottom'];
    for (var d = 0; d < dockIds.length; d++) {
      var dockId = dockIds[d];
      var groups = panelDocks[dockId];
      if (!Array.isArray(groups) || groups.length === 0) continue;
      /** @type {Array<DockTreeLeaf>} */
      var tabsetNodes = [];
      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        if (!Array.isArray(group) || group.length === 0) continue;
        /** @type {Array<DockTreePanelTab>} */
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
            var t = /** @type {DockTreePanelTab} */ (node.tabs[k]);
            if (t.panelId === activePanel) {
              node.activeTabId = t.id;
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
        /** @type {DockTreeNode} */
        var tree = tabsetNodes[0];
        for (var n = 1; n < tabsetNodes.length; n++) {
          tree = createSplitNode(axis, tree, tabsetNodes[n], 0.5, idFactory);
        }
        result[dockId] = tree;
      }
    }
    return result;
  }

  /**
   * @param {DockTreeNode|null} node
   * @param {string|null|undefined} panelId
   * @param {function(string|null|undefined): string} resolvePanelTarget
   * @returns {PanelLeafHit|null}
   */
  function findLeafContainingPanel(node, panelId, resolvePanelTarget) {
    var normalizedPanelId = resolvePanelTarget(panelId);
    if (!normalizedPanelId) return null;
    /** @type {PanelLeafHit|null} */
    var found = null;
    visitTree(node, function (candidate) {
      if (found || candidate.type !== 'tabs') return;
      var leaf = /** @type {DockTreeLeaf} */ (candidate);
      for (var i = 0; i < leaf.tabs.length; i++) {
        var tab = leaf.tabs[i];
        if (!isPanelTab(tab)) continue;
        var panelTab = /** @type {DockTreePanelTab} */ (tab);
        if (resolvePanelTarget(panelTab.panelId) === normalizedPanelId) {
          found = { tab: panelTab, leaf: leaf };
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
    removeTabFromLeaf: removeTabFromLeaf,
    extractTabAtIndex: extractTabAtIndex,
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
