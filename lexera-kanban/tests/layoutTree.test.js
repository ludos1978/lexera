import { describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

const layoutTree = loadIIFE('workspace/layoutTree.js', 'window.LexeraLayoutTree', {
  window: {}
});

function tabsetNode(id, tabs, activeTabId) {
  return {
    type: 'tabs',
    id: id,
    tabs: tabs,
    activeTabId: activeTabId == null ? (tabs[0] && tabs[0].id) || '' : activeTabId
  };
}

function splitNode(id, axis, first, second, ratio) {
  return {
    type: 'split',
    id: id,
    axis: axis,
    ratio: ratio == null ? 0.5 : ratio,
    first: first,
    second: second
  };
}

describe('LexeraLayoutTree.normalizeViewKind', () => {
  it('normalizes canvas and kanban inputs', () => {
    expect(layoutTree.normalizeViewKind('canvas')).toBe('canvas');
    expect(layoutTree.normalizeViewKind('CANVAS')).toBe('canvas');
    expect(layoutTree.normalizeViewKind(' kanban ')).toBe('kanban');
  });

  it('falls back to default for unknown or empty values', () => {
    expect(layoutTree.normalizeViewKind('')).toBe('default');
    expect(layoutTree.normalizeViewKind(null)).toBe('default');
    expect(layoutTree.normalizeViewKind(undefined)).toBe('default');
    expect(layoutTree.normalizeViewKind('mystery')).toBe('default');
  });
});

describe('LexeraLayoutTree.isPanelTab / isBoardTab', () => {
  it('classifies panel tabs', () => {
    expect(layoutTree.isPanelTab({ kind: 'panel' })).toBe(true);
    expect(layoutTree.isPanelTab({ kind: 'board' })).toBe(false);
    expect(layoutTree.isPanelTab(null)).toBe(false);
  });

  it('treats anything non-panel as a board tab', () => {
    expect(layoutTree.isBoardTab({ kind: 'board' })).toBe(true);
    expect(layoutTree.isBoardTab({ kind: 'panel' })).toBe(false);
    expect(layoutTree.isBoardTab({})).toBe(true);
    expect(layoutTree.isBoardTab(null)).toBe(false);
  });
});

describe('LexeraLayoutTree.visitTree', () => {
  it('visits each node once with parent and side context', () => {
    const leafA = tabsetNode('A', [{ id: 't1' }]);
    const leafB = tabsetNode('B', [{ id: 't2' }]);
    const root = splitNode('S', 'horizontal', leafA, leafB);
    const visits = [];
    layoutTree.visitTree(root, (node, parent, side) => {
      visits.push({ id: node.id, parent: parent && parent.id, side });
    });
    expect(visits).toEqual([
      { id: 'S', parent: null, side: '' },
      { id: 'A', parent: 'S', side: 'first' },
      { id: 'B', parent: 'S', side: 'second' }
    ]);
  });

  it('is a no-op for null/undefined input', () => {
    const visits = [];
    layoutTree.visitTree(null, (node) => visits.push(node.id));
    expect(visits).toEqual([]);
  });
});

describe('LexeraLayoutTree.getFirstLeaf', () => {
  it('returns the first leaf of a nested split tree', () => {
    const leafA = tabsetNode('A', [{ id: 't1' }]);
    const leafB = tabsetNode('B', [{ id: 't2' }]);
    const inner = splitNode('S2', 'vertical', leafA, leafB);
    const root = splitNode('S1', 'horizontal', inner, tabsetNode('C', []));
    expect(layoutTree.getFirstLeaf(root)).toBe(leafA);
  });

  it('returns null for empty input', () => {
    expect(layoutTree.getFirstLeaf(null)).toBe(null);
  });
});

describe('LexeraLayoutTree.findLeafById', () => {
  it('finds a leaf by id within a nested tree', () => {
    const leafA = tabsetNode('A', []);
    const leafB = tabsetNode('B', []);
    const root = splitNode('S', 'horizontal', leafA, leafB);
    expect(layoutTree.findLeafById(root, 'B')).toBe(leafB);
  });

  it('returns null when the id is not present', () => {
    const leafA = tabsetNode('A', []);
    expect(layoutTree.findLeafById(leafA, 'missing')).toBe(null);
  });
});

describe('LexeraLayoutTree.findNodeAndParent', () => {
  it('finds the parent split and side for a leaf', () => {
    const leafA = tabsetNode('A', []);
    const leafB = tabsetNode('B', []);
    const root = splitNode('S', 'horizontal', leafA, leafB);
    const result = layoutTree.findNodeAndParent(root, 'B');
    expect(result.node).toBe(leafB);
    expect(result.parent).toBe(root);
    expect(result.side).toBe('second');
  });

  it('returns null parent for the root node', () => {
    const root = tabsetNode('A', []);
    const result = layoutTree.findNodeAndParent(root, 'A');
    expect(result.node).toBe(root);
    expect(result.parent).toBe(null);
    expect(result.side).toBe('');
  });
});

describe('LexeraLayoutTree.findTab', () => {
  it('locates a tab and reports its containing leaf and index', () => {
    const tabAlpha = { id: 'alpha' };
    const tabBeta = { id: 'beta' };
    const leaf = tabsetNode('A', [tabAlpha, tabBeta]);
    const result = layoutTree.findTab(leaf, 'beta');
    expect(result.tab).toBe(tabBeta);
    expect(result.leaf).toBe(leaf);
    expect(result.index).toBe(1);
  });

  it('returns null when the tab id is unknown', () => {
    const leaf = tabsetNode('A', [{ id: 'alpha' }]);
    expect(layoutTree.findTab(leaf, 'missing')).toBe(null);
  });
});

describe('LexeraLayoutTree.findClosestSplitParent', () => {
  it('returns the immediate split parent for a target leaf', () => {
    const leafA = tabsetNode('A', []);
    const leafB = tabsetNode('B', []);
    const inner = splitNode('S-inner', 'vertical', leafA, leafB);
    const root = splitNode('S-root', 'horizontal', inner, tabsetNode('C', []));
    expect(layoutTree.findClosestSplitParent(root, 'B', null)).toBe(inner);
  });

  it('returns the supplied parent when the root itself is the target leaf', () => {
    const root = tabsetNode('A', []);
    const sentinel = { id: 'sentinel' };
    expect(layoutTree.findClosestSplitParent(root, 'A', sentinel)).toBe(sentinel);
  });

  it('returns null when no leaf matches', () => {
    const leafA = tabsetNode('A', []);
    const leafB = tabsetNode('B', []);
    const root = splitNode('S', 'horizontal', leafA, leafB);
    expect(layoutTree.findClosestSplitParent(root, 'missing', null)).toBe(null);
  });
});

describe('LexeraLayoutTree.countTreeTabs', () => {
  it('sums tab counts across all leaves', () => {
    const leafA = tabsetNode('A', [{ id: 't1' }, { id: 't2' }]);
    const leafB = tabsetNode('B', [{ id: 't3' }]);
    const root = splitNode('S', 'horizontal', leafA, leafB);
    expect(layoutTree.countTreeTabs(root)).toBe(3);
  });

  it('returns 0 for null input', () => {
    expect(layoutTree.countTreeTabs(null)).toBe(0);
  });
});

describe('LexeraLayoutTree.createIdFactory', () => {
  it('returns a function that produces unique prefixed ids within one factory', () => {
    const factory = layoutTree.createIdFactory();
    const a = factory('pane');
    const b = factory('pane');
    const c = factory('split');
    expect(a).toMatch(/^pane-/);
    expect(b).toMatch(/^pane-/);
    expect(c).toMatch(/^split-/);
    expect(a).not.toBe(b);
  });
});

describe('LexeraLayoutTree.createTabsetNode / createSplitNode', () => {
  it('builds a tabset with the first tab active by default', () => {
    let counter = 0;
    const idFactory = (prefix) => `${prefix}-${++counter}`;
    const node = layoutTree.createTabsetNode([{ id: 'a' }, { id: 'b' }], idFactory);
    expect(node).toEqual({
      type: 'tabs',
      id: 'pane-1',
      tabs: [{ id: 'a' }, { id: 'b' }],
      activeTabId: 'a'
    });
  });

  it('builds an empty tabset with empty activeTabId', () => {
    const idFactory = () => 'pane-x';
    const node = layoutTree.createTabsetNode(null, idFactory);
    expect(node.tabs).toEqual([]);
    expect(node.activeTabId).toBe('');
  });

  it('builds a split with clamped ratio and normalized axis', () => {
    let counter = 0;
    const idFactory = (prefix) => `${prefix}-${++counter}`;
    const split = layoutTree.createSplitNode('vertical', { type: 'tabs' }, { type: 'tabs' }, 0.7, idFactory);
    expect(split.axis).toBe('vertical');
    expect(split.ratio).toBe(0.7);
    expect(split.id).toBe('split-1');
  });

  it('clamps ratio to [0.18, 0.82]', () => {
    const idFactory = () => 'split-x';
    const lo = layoutTree.createSplitNode('vertical', null, null, 0.05, idFactory);
    const hi = layoutTree.createSplitNode('vertical', null, null, 0.99, idFactory);
    const dflt = layoutTree.createSplitNode('vertical', null, null, 'not-a-number', idFactory);
    expect(lo.ratio).toBe(0.18);
    expect(hi.ratio).toBe(0.82);
    expect(dflt.ratio).toBe(0.5);
  });

  it('falls back to vertical axis for unknown values', () => {
    const idFactory = () => 'split-x';
    const split = layoutTree.createSplitNode('weird', null, null, 0.5, idFactory);
    expect(split.axis).toBe('vertical');
  });
});

describe('LexeraLayoutTree.withNormalizedLeaves', () => {
  it('keeps an existing active tab id if still present', () => {
    const idFactory = () => 'pane-x';
    const node = { type: 'tabs', id: 'A', tabs: [{ id: 't1' }, { id: 't2' }], activeTabId: 't2' };
    const result = layoutTree.withNormalizedLeaves(node, false, idFactory);
    expect(result.activeTabId).toBe('t2');
  });

  it('snaps activeTabId to the first tab if missing', () => {
    const idFactory = () => 'pane-x';
    const node = { type: 'tabs', id: 'A', tabs: [{ id: 't1' }, { id: 't2' }], activeTabId: 'gone' };
    layoutTree.withNormalizedLeaves(node, false, idFactory);
    expect(node.activeTabId).toBe('t1');
  });

  it('returns an empty tabset when the root is missing', () => {
    let counter = 0;
    const idFactory = (prefix) => `${prefix}-${++counter}`;
    const result = layoutTree.withNormalizedLeaves(null, true, idFactory);
    expect(result.type).toBe('tabs');
    expect(result.tabs).toEqual([]);
  });

  it('collapses a split with both children empty into an empty root', () => {
    let counter = 0;
    const idFactory = (prefix) => `${prefix}-${++counter}`;
    const split = {
      type: 'split',
      id: 'S',
      axis: 'vertical',
      ratio: 0.5,
      first: { type: 'tabs', id: 'A', tabs: [], activeTabId: '' },
      second: { type: 'tabs', id: 'B', tabs: [], activeTabId: '' }
    };
    const result = layoutTree.withNormalizedLeaves(split, true, idFactory);
    expect(result.type).toBe('tabs');
    expect(result.tabs).toEqual([]);
  });

  it('promotes the surviving child when one side is empty', () => {
    const idFactory = () => 'pane-x';
    const survivor = { type: 'tabs', id: 'B', tabs: [{ id: 't1' }], activeTabId: 't1' };
    const split = {
      type: 'split',
      id: 'S',
      axis: 'vertical',
      ratio: 0.5,
      first: { type: 'tabs', id: 'A', tabs: [], activeTabId: '' },
      second: survivor
    };
    const result = layoutTree.withNormalizedLeaves(split, false, idFactory);
    expect(result).toBe(survivor);
  });
});

describe('LexeraLayoutTree.findLeafContainingBoard / findAnyLeafContainingBoard', () => {
  function boardTab(boardId, viewKind) {
    return { id: `tab-${boardId}-${viewKind}`, kind: 'board', boardId, viewKind };
  }

  it('finds a board tab by viewKind', () => {
    const tabKanban = boardTab('alpha', 'kanban');
    const tabCanvas = boardTab('alpha', 'canvas');
    const leaf = tabsetNode('A', [tabKanban, tabCanvas]);
    const result = layoutTree.findLeafContainingBoard(leaf, 'alpha', 'canvas');
    expect(result.tab).toBe(tabCanvas);
    expect(result.leaf).toBe(leaf);
  });

  it('returns null when the viewKind does not match', () => {
    const leaf = tabsetNode('A', [boardTab('alpha', 'kanban')]);
    expect(layoutTree.findLeafContainingBoard(leaf, 'alpha', 'canvas')).toBe(null);
  });

  it('finds any tab for the board regardless of viewKind', () => {
    const tabCanvas = boardTab('alpha', 'canvas');
    const leaf = tabsetNode('A', [tabCanvas]);
    const result = layoutTree.findAnyLeafContainingBoard(leaf, 'alpha');
    expect(result.tab).toBe(tabCanvas);
  });

  it('ignores panel tabs', () => {
    const panelTab = { id: 't1', kind: 'panel', panelId: 'logs' };
    const leaf = tabsetNode('A', [panelTab]);
    expect(layoutTree.findAnyLeafContainingBoard(leaf, 'alpha')).toBe(null);
  });
});

describe('LexeraLayoutTree.createBoardTab / createPanelTab', () => {
  it('builds a board tab with normalized viewKind', () => {
    let counter = 0;
    const idFactory = (prefix) => `${prefix}-${++counter}`;
    const tab = layoutTree.createBoardTab('alpha', 'CANVAS', idFactory);
    expect(tab).toEqual({
      id: 'tab-1',
      kind: 'board',
      boardId: 'alpha',
      viewKind: 'canvas'
    });
  });

  it('falls back to default viewKind for unknown values', () => {
    const idFactory = () => 'tab-x';
    const tab = layoutTree.createBoardTab('alpha', 'mystery', idFactory);
    expect(tab.viewKind).toBe('default');
  });

  it('coerces missing boardId to empty string', () => {
    const idFactory = () => 'tab-x';
    const tab = layoutTree.createBoardTab(null, 'kanban', idFactory);
    expect(tab.boardId).toBe('');
  });

  it('builds a panel tab with stringified panelId', () => {
    const idFactory = () => 'tab-x';
    const tab = layoutTree.createPanelTab('logs', idFactory);
    expect(tab).toEqual({ id: 'tab-x', kind: 'panel', panelId: 'logs' });
  });

  it('coerces missing panelId to empty string', () => {
    const idFactory = () => 'tab-x';
    const tab = layoutTree.createPanelTab(null, idFactory);
    expect(tab.panelId).toBe('');
  });
});

describe('LexeraLayoutTree.migratePanelDocksToSideDocks', () => {
  function makeIdFactory() {
    let counter = 0;
    return (prefix) => `${prefix}-${++counter}`;
  }

  it('returns null docks when input is empty', () => {
    const result = layoutTree.migratePanelDocksToSideDocks(
      { left: [], right: [], bottom: [] },
      {},
      makeIdFactory()
    );
    expect(result).toEqual({ left: null, right: null, bottom: null });
  });

  it('builds a single tabset for a single group', () => {
    const result = layoutTree.migratePanelDocksToSideDocks(
      { left: [['hierarchy', 'dashboard']], right: [], bottom: [] },
      {},
      makeIdFactory()
    );
    expect(result.left.type).toBe('tabs');
    expect(result.left.tabs.map((t) => t.panelId)).toEqual(['hierarchy', 'dashboard']);
    expect(result.right).toBe(null);
    expect(result.bottom).toBe(null);
  });

  it('selects the active tab when panelGroupActives names a member', () => {
    const result = layoutTree.migratePanelDocksToSideDocks(
      { left: [['hierarchy', 'dashboard']], right: [], bottom: [] },
      { 'hierarchy,dashboard': 'dashboard' },
      makeIdFactory()
    );
    const active = result.left.tabs.find((t) => t.id === result.left.activeTabId);
    expect(active.panelId).toBe('dashboard');
  });

  it('builds a vertical split when a side dock has multiple groups', () => {
    const result = layoutTree.migratePanelDocksToSideDocks(
      { left: [['hierarchy'], ['dashboard']], right: [], bottom: [] },
      {},
      makeIdFactory()
    );
    expect(result.left.type).toBe('split');
    expect(result.left.axis).toBe('vertical');
  });

  it('builds a horizontal split for the bottom dock with multiple groups', () => {
    const result = layoutTree.migratePanelDocksToSideDocks(
      { left: [], right: [], bottom: [['logs'], ['monthCalendar']] },
      {},
      makeIdFactory()
    );
    expect(result.bottom.type).toBe('split');
    expect(result.bottom.axis).toBe('horizontal');
  });
});

describe('LexeraLayoutTree.findLeafContainingPanel', () => {
  function panelTab(panelId) {
    return { id: `tab-${panelId}`, kind: 'panel', panelId };
  }
  const identity = (value) => String(value || '');

  it('finds a panel tab using the resolver', () => {
    const tabLogs = panelTab('logs');
    const leaf = tabsetNode('A', [tabLogs]);
    const result = layoutTree.findLeafContainingPanel(leaf, 'logs', identity);
    expect(result.tab).toBe(tabLogs);
    expect(result.leaf).toBe(leaf);
  });

  it('returns null when the resolver yields an empty target', () => {
    const leaf = tabsetNode('A', [panelTab('logs')]);
    expect(layoutTree.findLeafContainingPanel(leaf, '', identity)).toBe(null);
  });

  it('respects a resolver that aliases panel ids', () => {
    const tabLogs = panelTab('logs-2');
    const leaf = tabsetNode('A', [tabLogs]);
    const aliasResolver = (value) => (value === 'logs-2' || value === 'logs') ? 'logs' : '';
    const result = layoutTree.findLeafContainingPanel(leaf, 'logs', aliasResolver);
    expect(result.tab).toBe(tabLogs);
  });

  it('ignores board tabs', () => {
    const leaf = tabsetNode('A', [{ id: 't', kind: 'board', boardId: 'alpha', viewKind: 'kanban' }]);
    expect(layoutTree.findLeafContainingPanel(leaf, 'logs', identity)).toBe(null);
  });
});

// ─── Phase 3.1 mutation API ────────────────────────────────────────────

describe('LexeraLayoutTree.removeTabById', () => {
  it('returns null when the id is not present', () => {
    const tree = tabsetNode('A', [{ id: 'a' }, { id: 'b' }]);
    expect(layoutTree.removeTabById(tree, 'missing')).toBe(null);
    expect(tree.tabs.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('splices the tab out and returns the removed tab + its leaf', () => {
    const tree = tabsetNode('A', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const result = layoutTree.removeTabById(tree, 'b');
    expect(result.removed.id).toBe('b');
    expect(result.leaf).toBe(tree);
    expect(result.index).toBe(1);
    expect(tree.tabs.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('reassigns activeTabId when the removed tab was active', () => {
    const tree = tabsetNode('A', [{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'b');
    layoutTree.removeTabById(tree, 'b');
    expect(tree.activeTabId).toBe('a');
  });

  it('clears activeTabId when the leaf becomes empty', () => {
    const tree = tabsetNode('A', [{ id: 'only' }], 'only');
    layoutTree.removeTabById(tree, 'only');
    expect(tree.activeTabId).toBe('');
  });

  it('walks split children to find the right leaf', () => {
    const left = tabsetNode('L', [{ id: 'l1' }, { id: 'l2' }]);
    const right = tabsetNode('R', [{ id: 'r1' }]);
    const tree = splitNode('S', 'horizontal', left, right, 0.5);
    const result = layoutTree.removeTabById(tree, 'r1');
    expect(result.leaf).toBe(right);
    expect(right.tabs).toEqual([]);
    expect(left.tabs.map((t) => t.id)).toEqual(['l1', 'l2']);
  });

  it('returns null on null tree or missing tabId', () => {
    expect(layoutTree.removeTabById(null, 'a')).toBe(null);
    expect(layoutTree.removeTabById(tabsetNode('A', [{ id: 'a' }]), '')).toBe(null);
  });
});

describe('LexeraLayoutTree.removeTabFromLeaf', () => {
  it('removes a single matching tab and returns the count', () => {
    const leaf = tabsetNode('A', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(layoutTree.removeTabFromLeaf(leaf, 'b')).toBe(1);
    expect(leaf.tabs.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('removes every matching tab when duplicates exist on the same leaf', () => {
    // Duplicates shouldn't happen under the wrapper API, but the
    // legacy `removeTabFromEverywhereExcept` treated them as removable
    // — preserving that semantic protects against any pathological
    // tree shape leaking through.
    const leaf = tabsetNode('A', [{ id: 'dup' }, { id: 'b' }, { id: 'dup' }]);
    expect(layoutTree.removeTabFromLeaf(leaf, 'dup')).toBe(2);
    expect(leaf.tabs.map((t) => t.id)).toEqual(['b']);
  });

  it('returns 0 when the id is not present (leaf untouched)', () => {
    const leaf = tabsetNode('A', [{ id: 'a' }, { id: 'b' }]);
    expect(layoutTree.removeTabFromLeaf(leaf, 'missing')).toBe(0);
    expect(leaf.tabs.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('reassigns activeTabId only after a successful removal', () => {
    const leaf = tabsetNode('A', [{ id: 'a' }, { id: 'b' }], 'b');
    layoutTree.removeTabFromLeaf(leaf, 'b');
    expect(leaf.activeTabId).toBe('a');
    // Calling again with no removal must not zero activeTabId.
    layoutTree.removeTabFromLeaf(leaf, 'b');
    expect(leaf.activeTabId).toBe('a');
  });

  it('clears activeTabId when the leaf becomes empty', () => {
    const leaf = tabsetNode('A', [{ id: 'only' }], 'only');
    layoutTree.removeTabFromLeaf(leaf, 'only');
    expect(leaf.tabs).toEqual([]);
    expect(leaf.activeTabId).toBe('');
  });

  it('returns 0 for non-leaf nodes and missing inputs', () => {
    expect(layoutTree.removeTabFromLeaf(null, 'a')).toBe(0);
    expect(layoutTree.removeTabFromLeaf({ type: 'split' }, 'a')).toBe(0);
    expect(layoutTree.removeTabFromLeaf(tabsetNode('A', [{ id: 'a' }]), '')).toBe(0);
  });
});

describe('LexeraLayoutTree.extractTabAtIndex', () => {
  it('removes the tab at index and returns it', () => {
    const leaf = tabsetNode('A', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const removed = layoutTree.extractTabAtIndex(leaf, 1);
    expect(removed.id).toBe('b');
    expect(leaf.tabs.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('falls through to LEFT NEIGHBOUR when extracting the active tab', () => {
    // Distinct from removeTabFromLeaf, which falls through to tabs[0].
    const leaf = tabsetNode('A', [{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'c');
    layoutTree.extractTabAtIndex(leaf, 2);
    expect(leaf.activeTabId).toBe('b');
  });

  it('falls through to index 0 when extracting the first (active) tab', () => {
    const leaf = tabsetNode('A', [{ id: 'a' }, { id: 'b' }], 'a');
    layoutTree.extractTabAtIndex(leaf, 0);
    // After splicing index 0, tabs[max(0, -1)] = tabs[0] = 'b'.
    expect(leaf.activeTabId).toBe('b');
  });

  it('clears activeTabId when the leaf becomes empty', () => {
    const leaf = tabsetNode('A', [{ id: 'only' }], 'only');
    layoutTree.extractTabAtIndex(leaf, 0);
    expect(leaf.tabs).toEqual([]);
    expect(leaf.activeTabId).toBe('');
  });

  it('does not touch activeTabId when extracting a non-active tab', () => {
    const leaf = tabsetNode('A', [{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a');
    layoutTree.extractTabAtIndex(leaf, 2);
    expect(leaf.activeTabId).toBe('a');
  });

  it('returns null on out-of-range / invalid inputs', () => {
    expect(layoutTree.extractTabAtIndex(null, 0)).toBe(null);
    expect(layoutTree.extractTabAtIndex({ type: 'split' }, 0)).toBe(null);
    expect(layoutTree.extractTabAtIndex(tabsetNode('A', [{ id: 'a' }]), -1)).toBe(null);
    expect(layoutTree.extractTabAtIndex(tabsetNode('A', [{ id: 'a' }]), 5)).toBe(null);
    expect(layoutTree.extractTabAtIndex(tabsetNode('A', [{ id: 'a' }]), Number.NaN)).toBe(null);
  });
});

describe('LexeraLayoutTree.insertTabIntoLeaf', () => {
  it('appends to an empty leaf and seeds activeTabId', () => {
    const leaf = tabsetNode('A', [], '');
    const idx = layoutTree.insertTabIntoLeaf(leaf, { id: 'first' }, 0);
    expect(idx).toBe(0);
    expect(leaf.tabs.map((t) => t.id)).toEqual(['first']);
    expect(leaf.activeTabId).toBe('first');
  });

  it('inserts at the requested index without shifting activeTabId', () => {
    const leaf = tabsetNode('A', [{ id: 'a' }, { id: 'c' }], 'a');
    layoutTree.insertTabIntoLeaf(leaf, { id: 'b' }, 1);
    expect(leaf.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(leaf.activeTabId).toBe('a');
  });

  it('clamps an out-of-range index to the end', () => {
    const leaf = tabsetNode('A', [{ id: 'a' }]);
    const idx = layoutTree.insertTabIntoLeaf(leaf, { id: 'z' }, 999);
    expect(idx).toBe(1);
    expect(leaf.tabs.map((t) => t.id)).toEqual(['a', 'z']);
  });

  it('clamps a negative index to 0', () => {
    const leaf = tabsetNode('A', [{ id: 'a' }]);
    const idx = layoutTree.insertTabIntoLeaf(leaf, { id: 'z' }, -5);
    expect(idx).toBe(0);
    expect(leaf.tabs.map((t) => t.id)).toEqual(['z', 'a']);
  });

  it('rejects non-leaf and missing-tab inputs', () => {
    expect(layoutTree.insertTabIntoLeaf(splitNode('S', 'h', null, null, 0.5), { id: 'a' }, 0)).toBe(-1);
    expect(layoutTree.insertTabIntoLeaf(tabsetNode('A', []), null, 0)).toBe(-1);
  });
});

describe('LexeraLayoutTree.moveTab', () => {
  it('moves a tab between two leaves', () => {
    const src = tabsetNode('A', [{ id: 'a' }, { id: 'b' }], 'a');
    const dst = tabsetNode('B', [{ id: 'x' }], 'x');
    const result = layoutTree.moveTab(src, 1, dst, 0);
    expect(result.tab.id).toBe('b');
    expect(result.insertedAt).toBe(0);
    expect(src.tabs.map((t) => t.id)).toEqual(['a']);
    expect(dst.tabs.map((t) => t.id)).toEqual(['b', 'x']);
  });

  it('moves the active tab and reassigns the source activeTabId', () => {
    const src = tabsetNode('A', [{ id: 'a' }, { id: 'b' }], 'a');
    const dst = tabsetNode('B', [], '');
    layoutTree.moveTab(src, 0, dst, 0);
    expect(src.activeTabId).toBe('b');
    expect(dst.activeTabId).toBe('a');
  });

  it('handles same-leaf reorder using the established "original-index" convention', () => {
    // Convention matches workspaceShell.js:1846 reorderTabInLeaf: when
    // moving forward within the same leaf, the destination index is
    // interpreted in the *original* array, so it shifts left by one
    // after the source splice. (Forward 0→2 in [a,b,c] yields
    // [b,a,c], because dst=2 in the original maps to dst=1 after
    // 'a' is removed.)
    const leaf = tabsetNode('A', [{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a');
    layoutTree.moveTab(leaf, 0, leaf, 2);
    expect(leaf.tabs.map((t) => t.id)).toEqual(['b', 'a', 'c']);

    // Backward move (2→0) does NOT shift, so 'c' lands at the head.
    layoutTree.moveTab(leaf, 2, leaf, 0);
    expect(leaf.tabs.map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });

  it('returns null on out-of-range indices and unhealthy inputs', () => {
    const src = tabsetNode('A', [{ id: 'a' }]);
    const dst = tabsetNode('B', []);
    expect(layoutTree.moveTab(src, 7, dst, 0)).toBe(null);
    expect(layoutTree.moveTab(null, 0, dst, 0)).toBe(null);
    expect(layoutTree.moveTab(src, 0, null, 0)).toBe(null);
    expect(layoutTree.moveTab(tabsetNode('A', []), 0, dst, 0)).toBe(null);
  });
});

describe('LexeraLayoutTree.replaceTreeRoot', () => {
  it('assigns the new tree to holder[key] and reports added/removed ids', () => {
    const holder = { dockTree: tabsetNode('A', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]) };
    const next = tabsetNode('B', [{ id: 'b' }, { id: 'd' }]);
    const diff = layoutTree.replaceTreeRoot(holder, 'dockTree', next);
    expect(holder.dockTree).toBe(next);
    expect(diff.removed.sort()).toEqual(['a', 'c']);
    expect(diff.added.sort()).toEqual(['d']);
  });

  it('handles a side-dock holder (state.sideDocks)', () => {
    const sideDocks = { left: tabsetNode('L', [{ id: 'l1' }]), right: null, bottom: null };
    const next = tabsetNode('L2', [{ id: 'l1' }, { id: 'l2' }]);
    const diff = layoutTree.replaceTreeRoot(sideDocks, 'left', next);
    expect(sideDocks.left).toBe(next);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual(['l2']);
  });

  it('treats null/undefined trees correctly (drop or seed)', () => {
    const holder = { dockTree: tabsetNode('A', [{ id: 'a' }]) };
    const drop = layoutTree.replaceTreeRoot(holder, 'dockTree', null);
    expect(holder.dockTree).toBe(null);
    expect(drop.removed).toEqual(['a']);
    expect(drop.added).toEqual([]);

    const seed = layoutTree.replaceTreeRoot(holder, 'dockTree', tabsetNode('B', [{ id: 'b' }]));
    expect(seed.removed).toEqual([]);
    expect(seed.added).toEqual(['b']);
  });

  it('returns empty diffs when holder or key is missing', () => {
    const diff = layoutTree.replaceTreeRoot(null, 'dockTree', tabsetNode('A', [{ id: 'a' }]));
    expect(diff).toEqual({ removed: [], added: [] });
  });
});
