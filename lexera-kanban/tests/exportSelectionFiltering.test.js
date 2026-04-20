/**
 * End-to-end check of selection filtering:
 *   build tree → setOnlySelection('stack-0-0') → getSelection() must yield
 *   columnIds limited to that stack's columns. If not, the backend gets an
 *   empty filter and exports the whole board.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadIIFE } from './load-iife.js';

let ExportTreeBuilder;
beforeAll(() => {
  ExportTreeBuilder = loadIIFE('export/exportTreeBuilder.js', 'ExportTreeBuilder', { window: {} });
});

function twoRowBoard() {
  return {
    rows: [
      {
        title: 'Row 0', id: 'r0',
        stacks: [
          {
            title: 'S0', id: 's0',
            columns: [
              { id: 'col-A', title: 'A' },
              { id: 'col-B', title: 'B' },
            ],
          },
          {
            title: 'S1', id: 's1',
            columns: [
              { id: 'col-C', title: 'C' },
            ],
          },
        ],
      },
      {
        title: 'Row 1', id: 'r1',
        stacks: [
          {
            title: 'S2', id: 's2',
            columns: [
              { id: 'col-D', title: 'D' },
              { id: 'col-E', title: 'E' },
            ],
          },
        ],
      },
    ],
  };
}

describe('selection → columnIds sent to backend', () => {
  it('stack-0-0 selection yields columnIds for ONLY that stack', () => {
    const tree = ExportTreeBuilder.buildExportTree(twoRowBoard());
    ExportTreeBuilder.setOnlySelection(tree, 'stack-0-0');
    const sel = ExportTreeBuilder.getSelection(tree);
    expect(sel.hasSelection).toBe(true);
    expect(sel.isFullBoard).toBe(false);
    expect(sel.columnIds.sort()).toEqual(['col-A', 'col-B']);
    // scopes describes what the user picked so the backend/logs can reason.
    expect(sel.scopes[0].scope).toBe('stack');
    expect(sel.scopes[0].rowIndex).toBe(0);
    expect(sel.scopes[0].stackIndex).toBe(0);
  });

  it('stack-1-0 yields only that stack (columns in row 1)', () => {
    const tree = ExportTreeBuilder.buildExportTree(twoRowBoard());
    ExportTreeBuilder.setOnlySelection(tree, 'stack-1-0');
    const sel = ExportTreeBuilder.getSelection(tree);
    expect(sel.columnIds.sort()).toEqual(['col-D', 'col-E']);
  });

  it('row-0 yields all columns under row 0, none from row 1', () => {
    const tree = ExportTreeBuilder.buildExportTree(twoRowBoard());
    ExportTreeBuilder.setOnlySelection(tree, 'row-0');
    const sel = ExportTreeBuilder.getSelection(tree);
    expect(sel.columnIds.sort()).toEqual(['col-A', 'col-B', 'col-C']);
  });

  it('column-0-0-1 yields just that one column', () => {
    const tree = ExportTreeBuilder.buildExportTree(twoRowBoard());
    ExportTreeBuilder.setOnlySelection(tree, 'column-0-0-1');
    const sel = ExportTreeBuilder.getSelection(tree);
    expect(sel.columnIds).toEqual(['col-B']);
  });

  it('root selection yields every columnId (back-end will no-op this)', () => {
    const tree = ExportTreeBuilder.buildExportTree(twoRowBoard());
    ExportTreeBuilder.setOnlySelection(tree, 'root');
    const sel = ExportTreeBuilder.getSelection(tree);
    expect(sel.isFullBoard).toBe(true);
    expect(sel.columnIds.sort()).toEqual(['col-A', 'col-B', 'col-C', 'col-D', 'col-E']);
  });

  it('when column.id is missing from source data, selection falls back to columnIndexes', () => {
    // Regression guard: if the parser / activeBoardData strips `id`, we rely
    // on the flat-column index. Backend OR's ids + indexes so this still
    // filters correctly.
    const board = twoRowBoard();
    delete board.rows[0].stacks[0].columns[0].id;
    delete board.rows[0].stacks[0].columns[1].id;
    const tree = ExportTreeBuilder.buildExportTree(board);
    ExportTreeBuilder.setOnlySelection(tree, 'stack-0-0');
    const sel = ExportTreeBuilder.getSelection(tree);
    expect(sel.columnIds).toEqual([]); // ids unavailable
    expect(sel.columnIndexes).toEqual([0, 1]);
    expect(sel.hasSelection).toBe(true);
  });
});
