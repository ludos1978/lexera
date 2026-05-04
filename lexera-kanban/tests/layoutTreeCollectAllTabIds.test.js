// Phase 0.2 prerequisite: `LexeraLayoutTree.collectAllTabIds(tree)`
// underpins the view-lifecycle audit, the orphan reaper (Phase 1.4),
// and the lifecycle reconciler (Phase 2). Pin its behavior so future
// drift fails closed.

import { describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadLayoutTree() {
  const window = {};
  const globals = { window };
  return loadIIFE('workspace/layoutTree.js', 'window.LexeraLayoutTree', globals);
}

function tabsetNode(id, tabs) {
  return {
    type: 'tabs',
    id,
    tabs: tabs.map((tabId) => ({ id: tabId, panelId: tabId })),
    activeTabId: tabs[0] || ''
  };
}

function splitNode(id, axis, first, second, ratio = 0.5) {
  return { type: 'split', id, axis, first, second, ratio };
}

describe('LexeraLayoutTree.collectAllTabIds', () => {
  it('returns [] for null / undefined / empty tree', () => {
    const api = loadLayoutTree();
    expect(api.collectAllTabIds(null)).toEqual([]);
    expect(api.collectAllTabIds(undefined)).toEqual([]);
    expect(api.collectAllTabIds(tabsetNode('p1', []))).toEqual([]);
  });

  it('returns tab.ids from a single leaf', () => {
    const api = loadLayoutTree();
    expect(api.collectAllTabIds(tabsetNode('p1', ['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
  });

  it('walks splits to collect tab.ids from both sides', () => {
    const api = loadLayoutTree();
    const tree = splitNode(
      's1', 'horizontal',
      tabsetNode('p1', ['a', 'b']),
      splitNode('s2', 'vertical', tabsetNode('p2', ['c']), tabsetNode('p3', ['d', 'e']))
    );
    const ids = api.collectAllTabIds(tree);
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('skips malformed tabs (no id) without throwing', () => {
    const api = loadLayoutTree();
    const node = {
      type: 'tabs',
      id: 'p1',
      tabs: [{ id: 'a' }, { id: '' }, null, { id: 'b' }],
      activeTabId: 'a'
    };
    expect(api.collectAllTabIds(node)).toEqual(['a', 'b']);
  });

  it('returns a fresh array each call', () => {
    const api = loadLayoutTree();
    const tree = tabsetNode('p1', ['a']);
    const a = api.collectAllTabIds(tree);
    const b = api.collectAllTabIds(tree);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
