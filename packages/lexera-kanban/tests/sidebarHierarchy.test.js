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
    expect(nodes[0].count).toBeNull();
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children[0].type).toBe('stack');
    expect(nodes[0].children[0].count).toBeNull();
    expect(nodes[0].children[0].children).toHaveLength(1);
    expect(nodes[0].children[0].children[0].type).toBe('column');
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
});
