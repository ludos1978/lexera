import { describe, it, expect, beforeAll } from 'vitest';
import { loadIIFE } from './load-iife.js';

let ExportTreeBuilder;

beforeAll(() => {
  ExportTreeBuilder = loadIIFE('export/exportTreeBuilder.js', 'ExportTreeBuilder', {
    window: {},
  });
});

function buildBoard() {
  return {
    title: 'Board',
    rows: [
      {
        id: 'row-1',
        title: 'Planning <!-- hidden comment -->',
        stacks: [
          {
            id: 'stack-1',
            title: 'Ideas',
            columns: [
              { id: 'col-1', title: 'Inbox', cards: [] },
              { id: 'col-2', title: 'Skipped #exclude', cards: [] },
            ],
          },
          {
            id: 'stack-2',
            title: 'Hidden Stack #hidden-internal-parked',
            columns: [
              { id: 'col-hidden', title: 'Should not show', cards: [] },
            ],
          },
        ],
      },
      {
        id: 'row-2',
        title: 'Delivery',
        stacks: [
          {
            id: 'stack-3',
            title: 'Ship',
            columns: [
              { id: 'col-3', title: 'Release', cards: [] },
              { id: 'col-4', title: 'Secret #hidden', cards: [] },
            ],
          },
        ],
      },
    ],
  };
}

describe('ExportTreeBuilder', () => {
  it('builds a row/stack/column tree from board rows and hides hidden items', () => {
    const tree = ExportTreeBuilder.buildExportTree(buildBoard());

    expect(tree.type).toBe('root');
    expect(tree.label).toBe('Full Board');
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].label).toBe('Planning');
    expect(tree.children[0].children).toHaveLength(1);
    expect(tree.children[0].children[0].label).toBe('Ideas');
    expect(tree.children[0].children[0].children).toHaveLength(2);
    expect(tree.children[1].children[0].children).toHaveLength(1);
    expect(tree.children[1].children[0].children[0].label).toBe('Release');
  });

  it('returns scope-aware selections and flattens them to column ids and indexes', () => {
    let tree = ExportTreeBuilder.buildExportTree(buildBoard());
    tree = ExportTreeBuilder.setOnlySelection(tree, 'stack-0-0');

    const selection = ExportTreeBuilder.getSelection(tree);
    expect(selection.hasSelection).toBe(true);
    expect(selection.isFullBoard).toBe(false);
    expect(selection.columnIds).toEqual(['col-1']);
    expect(selection.columnIndexes).toEqual([0]);
    expect(selection.scopes).toEqual([
      expect.objectContaining({ scope: 'stack', label: 'Ideas', rowIndex: 0, stackIndex: 0 }),
    ]);
    expect(selection.summary.key).toBe('ideas');
  });

  it('resolves selections by path, id, or flat visible column index', () => {
    const tree = ExportTreeBuilder.buildExportTree(buildBoard());

    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree, { scope: 'board' })).toBe('root');
    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree, { scope: 'row', rowIndex: 1 })).toBe('row-1');
    expect(
      ExportTreeBuilder.resolveNodeIdForSelection(tree, {
        scope: 'column',
        rowIndex: 1,
        stackIndex: 0,
        columnIndex: 0,
      })
    ).toBe('column-1-0-0');
    expect(
      ExportTreeBuilder.resolveNodeIdForSelection(tree, {
        scope: 'column',
        columnId: 'col-3',
      })
    ).toBe('column-1-0-0');
    expect(
      ExportTreeBuilder.resolveNodeIdForSelection(tree, {
        scope: 'column',
        flatColumnIndex: 2,
      })
    ).toBe('column-1-0-0');
  });

  it('marks parent nodes as partial when only some descendants are selected', () => {
    let tree = ExportTreeBuilder.buildExportTree(buildBoard());
    tree = ExportTreeBuilder.toggleSelection(tree, 'column-0-0-0', true);

    expect(tree.partial).toBe(true);
    expect(tree.children[0].partial).toBe(true);
    expect(tree.children[0].children[0].partial).toBe(true);
    expect(tree.children[0].children[0].children[0].selected).toBe(true);
    expect(tree.children[1].selected).toBe(false);
  });
});
