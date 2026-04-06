import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SidebarTree = require('../src/sidebar/sidebarTree.js');

describe('buildSidebarTreeNodes', () => {
  it('keeps row and stack nodes even for single-row single-stack boards', () => {
    const rows = [{
      id: 'row-1',
      title: 'Only Row',
      stacks: [{
        id: 'stack-1',
        title: 'Only Stack',
        columns: [{
          id: 'col-1',
          index: 0,
          title: 'Only Column',
          cards: [{ content: 'Single card' }],
        }],
      }],
    }];

    const nodes = SidebarTree.buildSidebarTreeNodes(rows, 'board-1', { rows: [], stacks: [], columns: [] }, false);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('row');
    expect(nodes[0].structuralRole).toBe('group');
    expect(nodes[0].count).toBeNull();
    expect(nodes[0].hierarchy).toEqual({
      surface: 'workspace',
      kind: 'row',
      entityId: 'row-1',
      capabilities: ['activate', 'menu', 'drag', 'edit'],
      selectable: false
    });
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children[0].type).toBe('stack');
    expect(nodes[0].children[0].structuralRole).toBe('group');
    expect(nodes[0].children[0].count).toBeNull();
    expect(nodes[0].children[0].children).toHaveLength(1);
    expect(nodes[0].children[0].children[0].type).toBe('column');
    expect(nodes[0].children[0].children[0].structuralRole).toBe('group');
  });

  it('only auto-expands the single visible row and single visible stack by default', () => {
    const rows = [{
      id: 'row-1',
      title: 'Only Row',
      stacks: [{
        id: 'stack-1',
        title: 'Only Stack',
        columns: [{
          id: 'col-1',
          index: 0,
          title: 'Only Column',
          cards: [{ content: 'Single card' }],
        }],
      }],
    }];

    const nodes = SidebarTree.buildSidebarTreeNodes(rows, 'board-1', { rows: [], stacks: [], columns: [] }, false);
    expect(nodes[0].expanded).toBe(true);
    expect(nodes[0].children[0].expanded).toBe(true);
    expect(nodes[0].children[0].children[0].expanded).toBe(false);
  });

  it('keeps every row as a top-level node when multiple rows exist', () => {
    const rows = [
      {
        id: 'row-a',
        title: 'Row A',
        stacks: [{ id: 'stack-a', title: 'Stack A', columns: [{ index: 0, title: 'Col A', cards: [] }] }],
      },
      {
        id: 'row-b',
        title: 'Row B',
        stacks: [{ id: 'stack-b', title: 'Stack B', columns: [{ index: 1, title: 'Col B', cards: [] }] }],
      },
    ];

    const nodes = SidebarTree.buildSidebarTreeNodes(rows, 'board-1', { rows: [], stacks: [], columns: [] }, false);
    expect(nodes.map((node) => node.type)).toEqual(['row', 'row']);
    expect(nodes[0].children[0].type).toBe('stack');
    expect(nodes[1].children[0].type).toBe('stack');
  });

  it('assigns visible card indexes to tree card nodes, skipping hidden cards', () => {
    // Regression for "add card after" inserting two after the selected card.
    // The sidebar tree receives rows cloned from fullBoardData, which contains
    // hidden cards alongside visible ones. `data-card-index` on each tree-card
    // node MUST be the VISIBLE index, because downstream actions (insert-after,
    // duplicate, edit, delete…) all treat ctx.cardIndex as a visible index and
    // run it through getFullCardIndex to re-map. Using the full-array index
    // here caused off-by-one insertions whenever a hidden card preceded the
    // selection.
    const rows = [{
      id: 'row-1',
      title: 'Row',
      stacks: [{
        id: 'stack-1',
        title: 'Stack',
        columns: [{
          id: 'col-1',
          index: 0,
          title: 'Column',
          cards: [
            { id: 'card-a', content: 'Visible A' },
            { id: 'card-h1', content: 'Hidden 1 #hidden-internal-archived' },
            { id: 'card-b', content: 'Visible B' },
            { id: 'card-h2', content: 'Hidden 2 #hidden-internal-deleted' },
            { id: 'card-c', content: 'Visible C' },
          ],
        }],
      }],
    }];

    const nodes = SidebarTree.buildSidebarTreeNodes(rows, 'board-1', { rows: [], stacks: [], columns: [] }, false);
    const columnNode = nodes[0].children[0].children[0];
    expect(columnNode.type).toBe('column');

    // Exactly 3 visible cards should make it into the tree (the 2 hidden ones
    // are skipped entirely).
    expect(columnNode.children).toHaveLength(3);

    // Each visible card node must carry its VISIBLE index as data-card-index,
    // not its position in the full `cards` array. Expect 0, 1, 2 — NOT 0, 2, 4.
    expect(columnNode.children[0].attrs['data-card-id']).toBe('card-a');
    expect(columnNode.children[0].attrs['data-card-index']).toBe('0');
    expect(columnNode.children[0].structuralRole).toBe('item');
    expect(columnNode.children[0].hierarchy).toEqual({
      surface: 'workspace',
      kind: 'card',
      entityId: 'card-a',
      capabilities: ['activate', 'menu', 'drag', 'edit'],
      selectable: false
    });

    expect(columnNode.children[1].attrs['data-card-id']).toBe('card-b');
    expect(columnNode.children[1].attrs['data-card-index']).toBe('1');

    expect(columnNode.children[2].attrs['data-card-id']).toBe('card-c');
    expect(columnNode.children[2].attrs['data-card-index']).toBe('2');
  });

  it('assigns sequential visible card indexes when there are no hidden cards', () => {
    // Baseline: without any hidden cards the visible index equals the array
    // index, so the off-by-one fix must still produce the correct sequence.
    const rows = [{
      id: 'row-1',
      title: 'Row',
      stacks: [{
        id: 'stack-1',
        title: 'Stack',
        columns: [{
          id: 'col-1',
          index: 0,
          title: 'Column',
          cards: [
            { id: 'card-a', content: 'A' },
            { id: 'card-b', content: 'B' },
            { id: 'card-c', content: 'C' },
          ],
        }],
      }],
    }];

    const nodes = SidebarTree.buildSidebarTreeNodes(rows, 'board-1', { rows: [], stacks: [], columns: [] }, false);
    const columnNode = nodes[0].children[0].children[0];
    expect(columnNode.children).toHaveLength(3);
    expect(columnNode.children[0].attrs['data-card-index']).toBe('0');
    expect(columnNode.children[1].attrs['data-card-index']).toBe('1');
    expect(columnNode.children[2].attrs['data-card-index']).toBe('2');
  });
});
