/**
 * Regression test for the "Could not pre-select stack" bug.
 *
 * The burger menu on a row/stack/column captures rowIdx/stackIdx/colLocalIdx
 * from the rendered DOM. The DOM is rendered from activeBoardData — which
 * updateDisplayFromFullBoard() filters to drop archived / deleted / hidden
 * rows, stacks, and columns. fullBoardData keeps everything.
 *
 * Export tree MUST be built from activeBoardData so that the tree's row-N /
 * stack-N-M / column-N-M-K node IDs match the indexes the DOM and the menu
 * saw. Otherwise burger-menu "Export stack" etc. resolves to `root` and the
 * whole board gets selected instead of the targeted stack.
 *
 * This test locks that behaviour in by comparing tree resolution against
 * both data sources for a board where archived rows/stacks shift indexes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadIIFE } from './load-iife.js';

let ExportTreeBuilder;
beforeAll(() => {
  ExportTreeBuilder = loadIIFE('export/exportTreeBuilder.js', 'ExportTreeBuilder', { window: {} });
});

/**
 * Simulates the filter applied by updateDisplayFromFullBoard(): drop any
 * row/stack/column whose title carries an archived/deleted/hidden tag.
 * Mirrors core/boardDataStore.js:updateDisplayFromFullBoard for the fields
 * the export tree reads (id, title, stacks, columns, cards). Tag semantics
 * must match tagSystem.js:IS_ARCHIVED_RE exactly — that's what the real
 * filter uses in production.
 */
const HIDDEN_RE = /#hidden-internal-(?:archived|deleted|parked)\b|(^|\s)#hidden(\s|$)/;
function isArchivedOrDeleted(title) {
  return HIDDEN_RE.test(String(title || ''));
}

function deriveActiveFromFull(full) {
  return {
    rows: (full.rows || [])
      .filter((r) => !isArchivedOrDeleted(r.title))
      .map((r) => ({
        id: r.id,
        title: r.title,
        stacks: (r.stacks || [])
          .filter((s) => !isArchivedOrDeleted(s.title))
          .map((s) => ({
            id: s.id,
            title: s.title,
            columns: (s.columns || [])
              .filter((c) => !isArchivedOrDeleted(c.title))
              .map((c) => ({ id: c.id, title: c.title, cards: c.cards || [] })),
          })),
      })),
  };
}

// fullBoardData: archived row + archived stack in row 1 + visible content.
// After the filter, activeBoardData shifts everything "up".
function buildTestBoard() {
  return {
    rows: [
      {
        id: 'row-archived-id',
        title: 'Archived Row #hidden-internal-archived',
        stacks: [
          { id: 's-dead', title: 'Dead', columns: [{ id: 'c-dead', title: 'Dead col' }] },
        ],
      },
      {
        id: 'row-visible-A',
        title: 'Visible Row A',
        stacks: [
          {
            id: 's-arch-in-rowA',
            title: 'Archived Stack #hidden-internal-archived',
            columns: [{ id: 'c-arch', title: 'Archived col' }],
          },
          {
            id: 's-keep-in-rowA',
            title: 'Real Stack',
            columns: [
              { id: 'c-A-real-0', title: 'Keep A0' },
              { id: 'c-A-real-1', title: 'Keep A1' },
            ],
          },
        ],
      },
      {
        id: 'row-visible-B',
        title: 'Visible Row B',
        stacks: [
          { id: 's-B-0', title: 'B stack 0', columns: [{ id: 'c-B0', title: 'Keep B0' }] },
        ],
      },
    ],
  };
}

describe('Export tree indexing: active vs full boardData', () => {
  it('fullBoardData index 0 is the archived row — buildExportTree would label it row-0', () => {
    // Sanity check: using fullBoardData directly, row-0 maps to the archived
    // row's SURVIVING contents (isHiddenItem will drop #archived stacks/cols).
    // The archived row's only stack + column are #archived-tagged, so they're
    // dropped and the row itself gets no children → not pushed into the tree.
    const full = buildTestBoard();
    const fullTree = ExportTreeBuilder.buildExportTree(full);
    // Row 0 was archived; tree builder drops it.
    expect(fullTree.children.find((n) => n.rowIndex === 0)).toBeUndefined();
    // row-1 is the visible-A row; its stack-1-0 is archived, stack-1-1 survives.
    const rowA = fullTree.children.find((n) => n.rowIndex === 1);
    expect(rowA).toBeDefined();
    expect(rowA.children.map((s) => s.stackIndex)).toEqual([1]);
  });

  it('activeBoardData-derived tree labels the first visible row as row-0 and its surviving stack as stack-0-0', () => {
    const full = buildTestBoard();
    const active = deriveActiveFromFull(full);
    const tree = ExportTreeBuilder.buildExportTree(active);

    // The DOM (rendered from active) labels visible-A as data-row-index=0.
    const rowA = tree.children.find((n) => n.rowIndex === 0);
    expect(rowA).toBeDefined();
    expect(rowA.label).toContain('Visible Row A');

    // Its one remaining stack becomes stack-0-0 — which is what the burger
    // menu will send when the user right-clicks that stack.
    expect(rowA.children).toHaveLength(1);
    expect(rowA.children[0].stackIndex).toBe(0);
    expect(rowA.children[0].columnIndex).toBeUndefined(); // stack node
  });

  it('burger-menu selection {scope:"stack", rowIndex:0, stackIndex:0} resolves via activeBoardData tree', () => {
    const full = buildTestBoard();
    const active = deriveActiveFromFull(full);
    const tree = ExportTreeBuilder.buildExportTree(active);

    const nodeId = ExportTreeBuilder.resolveNodeIdForSelection(tree, {
      scope: 'stack', rowIndex: 0, stackIndex: 0,
    });
    expect(nodeId).toBe('stack-0-0');
  });

  it('same burger-menu selection fails to resolve against fullBoardData tree (the bug)', () => {
    // Documents the pre-fix failure mode: if the tree is built from
    // fullBoardData, row-0 is the archived row (dropped) and the resolver
    // returns null, which upstream defaults to 'root' (the whole board).
    const full = buildTestBoard();
    const tree = ExportTreeBuilder.buildExportTree(full);

    const nodeId = ExportTreeBuilder.resolveNodeIdForSelection(tree, {
      scope: 'stack', rowIndex: 0, stackIndex: 0,
    });
    expect(nodeId).toBeNull();
  });

  it('column selection scope uses the same active-indexing path', () => {
    const full = buildTestBoard();
    const active = deriveActiveFromFull(full);
    const tree = ExportTreeBuilder.buildExportTree(active);

    // Visible Row A → its surviving stack → first surviving column.
    // DOM would render that column with rowIdx=0, stackIdx=0, columnIdx=0.
    const nodeId = ExportTreeBuilder.resolveNodeIdForSelection(tree, {
      scope: 'column', rowIndex: 0, stackIndex: 0, columnIndex: 0,
    });
    expect(nodeId).toBe('column-0-0-0');
  });

  it('row selection scope resolves row-0 to the first visible row', () => {
    const full = buildTestBoard();
    const active = deriveActiveFromFull(full);
    const tree = ExportTreeBuilder.buildExportTree(active);
    const nodeId = ExportTreeBuilder.resolveNodeIdForSelection(tree, {
      scope: 'row', rowIndex: 0,
    });
    expect(nodeId).toBe('row-0');
  });

  it('columnId resolution works regardless of which source builds the tree', () => {
    // Stable column IDs are the escape hatch — they identify the entity even
    // when numeric indexes disagree. Both trees resolve the same id.
    const full = buildTestBoard();
    const active = deriveActiveFromFull(full);
    const fullTree = ExportTreeBuilder.buildExportTree(full);
    const activeTree = ExportTreeBuilder.buildExportTree(active);

    const fullId = ExportTreeBuilder.resolveNodeIdForSelection(fullTree, {
      scope: 'column', columnId: 'c-B0',
    });
    const activeId = ExportTreeBuilder.resolveNodeIdForSelection(activeTree, {
      scope: 'column', columnId: 'c-B0',
    });
    // Tree node IDs differ because the underlying rowIndex differs, but both
    // trees find the right column. This is why column menus pass columnId in
    // addition to numeric indexes (see menu/embedMenu.js:buildExportSelectionForColumn).
    expect(fullId).toBe('column-2-0-0');
    expect(activeId).toBe('column-1-0-0');
  });
});
