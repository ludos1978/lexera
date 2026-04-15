// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadTreeView() {
  return loadIIFE('treeView.js', 'TreeView', {
    window,
    document,
    getComputedStyle: window.getComputedStyle.bind(window),
    Number,
    Object
  });
}

function makeNode(id, label, opts) {
  return {
    id: id,
    label: label,
    count: opts && opts.count != null ? opts.count : null,
    type: opts && opts.type || 'group',
    expanded: opts && opts.expanded != null ? opts.expanded : true,
    hasToggle: opts && opts.hasToggle != null ? opts.hasToggle : true,
    grip: false,
    children: opts && opts.children || null,
    attrs: opts && opts.attrs || null
  };
}

function makeLeaf(id, label, opts) {
  return {
    id: id,
    label: label,
    count: null,
    type: opts && opts.type || 'item',
    expanded: false,
    hasToggle: false,
    grip: false,
    children: null,
    attrs: opts && opts.attrs || null
  };
}

describe('TreeView.patch', () => {
  it('returns false when container has no existing tree entries', () => {
    const tv = loadTreeView();
    const container = document.createElement('div');
    const nodes = [makeNode('a', 'Alpha', { children: [] })];
    expect(tv.patch(container, nodes)).toBe(false);
  });

  it('returns true and preserves existing group nodes by id', () => {
    const tv = loadTreeView();
    const container = document.createElement('div');
    const esc = (s) => s;

    // Initial render
    const nodes1 = [
      makeNode('row-1', 'Row One', { count: 3, children: [] }),
      makeNode('row-2', 'Row Two', { count: 5, children: [] })
    ];
    tv.render(container, nodes1, { escapeHtml: esc });

    const entry1Before = container.querySelector('.tree-entry');
    expect(entry1Before).toBeTruthy();

    // Patch with updated labels
    const nodes2 = [
      makeNode('row-1', 'Row One Updated', { count: 4, children: [] }),
      makeNode('row-2', 'Row Two', { count: 5, children: [] })
    ];
    const result = tv.patch(container, nodes2, { escapeHtml: esc });
    expect(result).toBe(true);

    // Same DOM entry reused (not recreated)
    const entry1After = container.querySelector('.tree-entry');
    expect(entry1After).toBe(entry1Before);

    // Label was updated
    const label = entry1After.querySelector('.tree-label');
    expect(label.innerHTML).toBe('Row One Updated');

    // Count was updated
    const count = entry1After.querySelector('.tree-count');
    expect(count.textContent).toBe('4');
  });

  it('preserves expand/collapse state of existing nodes', () => {
    const tv = loadTreeView();
    const container = document.createElement('div');
    const esc = (s) => s;

    const nodes = [
      makeNode('grp', 'Group', { expanded: true, children: [
        makeLeaf(null, 'Item A'),
        makeLeaf(null, 'Item B')
      ]})
    ];
    tv.render(container, nodes, { escapeHtml: esc });

    // Collapse the group via TreeView API
    const nodeEl = container.querySelector('.tree-node[data-tree-id="grp"]');
    tv.toggleNode(nodeEl);
    const childrenEl = container.querySelector('.tree-children');
    expect(childrenEl.classList.contains('expanded')).toBe(false);

    // Patch with same data (expanded: true in data, but DOM is collapsed)
    tv.patch(container, nodes, { escapeHtml: esc });

    // DOM should still be collapsed (preserved from DOM, not data)
    const childrenAfter = container.querySelector('.tree-children');
    expect(childrenAfter.classList.contains('expanded')).toBe(false);
  });

  it('adds new nodes and removes stale nodes', () => {
    const tv = loadTreeView();
    const container = document.createElement('div');
    const esc = (s) => s;

    const nodes1 = [
      makeNode('a', 'Alpha', { children: [] }),
      makeNode('b', 'Beta', { children: [] })
    ];
    tv.render(container, nodes1, { escapeHtml: esc });
    expect(container.querySelectorAll('.tree-entry').length).toBe(2);

    // Remove 'b', add 'c'
    const nodes2 = [
      makeNode('a', 'Alpha', { children: [] }),
      makeNode('c', 'Gamma', { children: [] })
    ];
    tv.patch(container, nodes2, { escapeHtml: esc });

    const entries = container.querySelectorAll('.tree-entry');
    expect(entries.length).toBe(2);

    const ids = Array.from(entries).map(e => {
      const n = e.querySelector('.tree-node[data-tree-id]');
      return n ? n.getAttribute('data-tree-id') : null;
    });
    expect(ids).toEqual(['a', 'c']);
  });

  it('reorders nodes to match new data order', () => {
    const tv = loadTreeView();
    const container = document.createElement('div');
    const esc = (s) => s;

    const nodes1 = [
      makeNode('a', 'Alpha', { children: [] }),
      makeNode('b', 'Beta', { children: [] }),
      makeNode('c', 'Gamma', { children: [] })
    ];
    tv.render(container, nodes1, { escapeHtml: esc });

    // Reverse order
    const nodes2 = [
      makeNode('c', 'Gamma', { children: [] }),
      makeNode('b', 'Beta', { children: [] }),
      makeNode('a', 'Alpha', { children: [] })
    ];
    tv.patch(container, nodes2, { escapeHtml: esc });

    const ids = Array.from(container.querySelectorAll('.tree-entry')).map(e => {
      const n = e.querySelector('.tree-node[data-tree-id]');
      return n ? n.getAttribute('data-tree-id') : null;
    });
    expect(ids).toEqual(['c', 'b', 'a']);
  });
});
