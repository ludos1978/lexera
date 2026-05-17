import { describe, it, expect, beforeAll } from 'vitest';
import { loadIIFE } from './load-iife.js';

let ExportTreeBuilder;
beforeAll(() => {
  ExportTreeBuilder = loadIIFE('export/exportTreeBuilder.js', 'ExportTreeBuilder', { window: {} });
});

function sampleBoard() {
  return {
    rows: [
      {
        title: 'Row A',
        stacks: [
          {
            title: 'Stack A1',
            columns: [
              { title: 'Col A1a', id: 'col-a1a' },
              { title: 'Col A1b', id: 'col-a1b' },
            ],
          },
        ],
      },
      {
        title: 'Row B',
        stacks: [
          {
            title: 'Stack B1',
            columns: [
              { title: 'Col B1a', id: 'col-b1a' },
              { title: 'Col B1b', id: 'col-b1b' },
            ],
          },
          {
            title: 'Stack B2',
            columns: [
              { title: 'Col B2a', id: 'col-b2a' },
            ],
          },
        ],
      },
    ],
  };
}

describe('ExportTreeBuilder.resolveNodeIdForSelection', () => {
  const tree = () => ExportTreeBuilder.buildExportTree(sampleBoard());

  it('returns root for scope="board"', () => {
    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree(), { scope: 'board' })).toBe('root');
  });

  it('returns root for empty selection', () => {
    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree(), {})).toBe('root');
  });

  it('resolves a row by rowIndex', () => {
    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree(), { scope: 'row', rowIndex: 0 })).toBe('row-0');
    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree(), { scope: 'row', rowIndex: 1 })).toBe('row-1');
  });

  it('returns null for a row index that does not exist (caller falls back to root)', () => {
    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree(), { scope: 'row', rowIndex: 99 })).toBeNull();
  });

  it('resolves a stack by rowIndex + stackIndex', () => {
    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree(), { scope: 'stack', rowIndex: 1, stackIndex: 1 })).toBe('stack-1-1');
  });

  it('resolves a column by explicit row/stack/column indexes', () => {
    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree(), {
      scope: 'column', rowIndex: 1, stackIndex: 0, columnIndex: 1,
    })).toBe('column-1-0-1');
  });

  it('resolves a column by columnId when indexes are missing', () => {
    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree(), {
      scope: 'column', columnId: 'col-b2a',
    })).toBe('column-1-1-0');
  });

  it('resolves a column by flatColumnIndex when indexes are missing', () => {
    // flatColumnIndex is assigned in visible order:
    // row0-stack0-col0 → 0, row0-stack0-col1 → 1, row1-stack0-col0 → 2, …
    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree(), {
      scope: 'column', flatColumnIndex: 2,
    })).toBe('column-1-0-0');
  });

  it('rejects a row selection when rowIndex is a string (must be numeric)', () => {
    // Guards against upstream bugs where data-row-index wasn't parseInt'd.
    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree(), { scope: 'row', rowIndex: '0' })).toBeNull();
  });

  // Regression: the column burger menu derives rowIndex/stackIndex/
  // columnIndex from the rendered DOM, but the tree's positional ids come
  // from the board data model. Hidden/folded/CRDT-reordered columns make
  // those positions disagree — the positional id still resolves to a
  // *different but existing* node. The stable columnId must win so the
  // user exports the column they actually clicked.
  it('prefers the stable columnId over conflicting positional indexes', () => {
    // col-b2a really lives at column-1-1-0, but the menu also passed
    // stale positional indexes pointing at column-1-0-1 (col-b1b).
    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree(), {
      scope: 'column',
      columnId: 'col-b2a',
      rowIndex: 1,
      stackIndex: 0,
      columnIndex: 1,
      flatColumnIndex: 3,
    })).toBe('column-1-1-0');
  });

  it('falls back to positional indexes when the columnId does not resolve', () => {
    // Unknown/stale columnId (e.g. CRDT regenerated it) must not strand the
    // selection — positional resolution still applies.
    expect(ExportTreeBuilder.resolveNodeIdForSelection(tree(), {
      scope: 'column',
      columnId: 'col-does-not-exist',
      rowIndex: 1,
      stackIndex: 0,
      columnIndex: 1,
    })).toBe('column-1-0-1');
  });
});

describe('ExportTreeBuilder.setOnlySelection drives single-element selection', () => {
  it('marks only the requested row as selected', () => {
    const tree = ExportTreeBuilder.buildExportTree(sampleBoard());
    ExportTreeBuilder.setOnlySelection(tree, 'row-1');
    const summary = ExportTreeBuilder.getSelection(tree);
    expect(summary.hasSelection).toBe(true);
    expect(summary.isFullBoard).toBe(false);
    // Only row 1's columns should be in the selection.
    expect(summary.columnIndexes.every((c) => c >= 2)).toBe(true);
  });

  it('marks only the requested column as selected', () => {
    const tree = ExportTreeBuilder.buildExportTree(sampleBoard());
    ExportTreeBuilder.setOnlySelection(tree, 'column-1-1-0');
    const summary = ExportTreeBuilder.getSelection(tree);
    expect(summary.columnIds).toEqual(['col-b2a']);
  });
});
