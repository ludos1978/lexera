// LexeraHierarchyDragBridge — same-board sibling reorder.
//
// Phase 2b-2-c of "boards must be re-orderable" (TODOs-lexera.md).
// The sub-app side (`hierarchy.js`, `workspaces.js`) emits
// `hierarchy-entity-drop` broadcasts; this bridge consumes them in the
// shell, applies the move, and persists via `LexeraApi.saveBoard`.
//
// `applyEntityReorder` is a pure function — these tests pin the
// reorder semantics for every entity kind without going through any
// Tauri / IPC layer. The `install()` path is exercised separately
// with stubbed deps.

import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadBridge(windowObj = {}) {
  return loadIIFE('shell/bridges/hierarchyDragBridge.js', 'window.LexeraHierarchyDragBridge', {
    window: windowObj,
    globalThis: {}
  });
}

function makeBoard() {
  return {
    title: 'Test',
    columns: [],
    rows: [
      {
        id: 'r1', title: 'Row 1',
        stacks: [
          {
            id: 's1', title: 'Stack 1',
            columns: [
              {
                id: 'c1', title: 'Col 1',
                cards: [
                  { id: 'card-1', title: 'A' },
                  { id: 'card-2', title: 'B' },
                  { id: 'card-3', title: 'C' }
                ]
              },
              {
                id: 'c2', title: 'Col 2',
                cards: [{ id: 'card-4', title: 'D' }]
              }
            ]
          },
          {
            id: 's2', title: 'Stack 2',
            columns: [{ id: 'c3', title: 'Col 3', cards: [] }]
          }
        ]
      },
      {
        id: 'r2', title: 'Row 2',
        stacks: [{ id: 's3', title: 'Stack 3', columns: [] }]
      }
    ]
  };
}

describe('LexeraHierarchyDragBridge.applyEntityReorder', () => {
  const bridge = loadBridge();

  it('reorders cards within the same column (drop semantic: source lands before target)', () => {
    const board = makeBoard();
    const ok = bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'card', entityId: 'card-3' }
    );
    expect(ok).toBe(true);
    const cards = board.rows[0].stacks[0].columns[0].cards.map((c) => c.id);
    // Drop card-1 onto card-3: card-1 takes the slot immediately
    // before card-3, target shifts right by one.
    expect(cards).toEqual(['card-2', 'card-1', 'card-3']);
  });

  it('drop zone "after" places source past the target sibling', () => {
    // [card-1, card-2, card-3] → drop card-1 AFTER card-2 →
    // [card-2, card-1, card-3]. Zone-based reorder lets the user
    // choose which side of the target the source lands on.
    const board = makeBoard();
    const ok = bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'card', entityId: 'card-2', position: 'after' }
    );
    expect(ok).toBe(true);
    expect(board.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(['card-2', 'card-1', 'card-3']);
  });

  it('drop zone "after" the LAST sibling appends source at the end', () => {
    const board = makeBoard();
    const ok = bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'card', entityId: 'card-3', position: 'after' }
    );
    expect(ok).toBe(true);
    expect(board.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(['card-2', 'card-3', 'card-1']);
  });

  it('drop zone "before" matches the legacy default', () => {
    // Explicit position: 'before' should equal the no-position case.
    const a = makeBoard();
    const b = makeBoard();
    bridge.applyEntityReorder(a,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'card', entityId: 'card-3' });
    bridge.applyEntityReorder(b,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'card', entityId: 'card-3', position: 'before' });
    expect(a.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(b.rows[0].stacks[0].columns[0].cards.map((c) => c.id));
  });

  it('reorders cards backwards within the same column', () => {
    const board = makeBoard();
    const ok = bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-3' },
      { boardId: 'b1', kind: 'card', entityId: 'card-1' }
    );
    expect(ok).toBe(true);
    const cards = board.rows[0].stacks[0].columns[0].cards.map((c) => c.id);
    expect(cards).toEqual(['card-3', 'card-1', 'card-2']);
  });

  it('reorders columns within the same stack', () => {
    const board = makeBoard();
    const ok = bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'column', entityId: 'c2' },
      { boardId: 'b1', kind: 'column', entityId: 'c1' }
    );
    expect(ok).toBe(true);
    const cols = board.rows[0].stacks[0].columns.map((c) => c.id);
    expect(cols).toEqual(['c2', 'c1']);
  });

  it('reorders stacks within the same row', () => {
    const board = makeBoard();
    const ok = bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'stack', entityId: 's2' },
      { boardId: 'b1', kind: 'stack', entityId: 's1' }
    );
    expect(ok).toBe(true);
    const stacks = board.rows[0].stacks.map((s) => s.id);
    expect(stacks).toEqual(['s2', 's1']);
  });

  it('reorders rows at the top level', () => {
    const board = makeBoard();
    const ok = bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'row', entityId: 'r2' },
      { boardId: 'b1', kind: 'row', entityId: 'r1' }
    );
    expect(ok).toBe(true);
    expect(board.rows.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('moves cross-parent same-kind drops to the target sibling list (cross-column card move)', () => {
    // 2026-05-09 user contract: dragging card-1 from column c1 onto
    // card-4 (which lives in column c2) inside the same board MUST
    // succeed. The previous "rejects, deferred to Phase 3" behaviour
    // surfaced as `applyDrop returned false` in the in-app log; the
    // user explicitly requires cross-column reorder to work.
    const board = makeBoard();
    const ok = bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'card', entityId: 'card-4' }
    );
    expect(ok).toBe(true);
    // card-1 was removed from c1.
    expect(board.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(['card-2', 'card-3']);
    // …and lands BEFORE card-4 in c2 (no `target.position` defaults
    // to 'before', the same convention applyEntityReorder uses for
    // same-parent reorder).
    expect(board.rows[0].stacks[0].columns[1].cards.map((c) => c.id))
      .toEqual(['card-1', 'card-4']);
  });

  it("honours target.position === 'after' on cross-parent moves", () => {
    const board = makeBoard();
    const ok = bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'card', entityId: 'card-4', position: 'after' }
    );
    expect(ok).toBe(true);
    expect(board.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(['card-2', 'card-3']);
    // 'after' lands the moved entity below card-4.
    expect(board.rows[0].stacks[0].columns[1].cards.map((c) => c.id))
      .toEqual(['card-4', 'card-1']);
  });

  it('matches cards by `kid` when source.entityId is the persistent 8-char hex', () => {
    // 2026-05-10 user-reported regression: targetEntityId in the
    // [xview-dnd] log was `crdt-…` (Loro container id stored on
    // card.id) but the source.entityId can be the persistent kid
    // form. Without the kid fallback, locateEntity returned null and
    // applyEntityReorder bailed → `apply.local-drop.skip(applyDrop
    // -returned-false)` repeatedly, drop never landed.
    const board = {
      rows: [{
        id: 'r1', title: 'R',
        stacks: [{
          id: 's1', title: 'S',
          columns: [{
            id: 'c1', title: 'C',
            cards: [
              { id: 'crdt-1-a', kid: 'a6db6c9a', title: 'A' },
              { id: 'crdt-1-b', kid: 'c88eb77c', title: 'B' }
            ]
          }]
        }]
      }]
    };
    // Source carries the kid form; target carries the Loro id form.
    // The mixed payload is exactly what the user's log surfaced — both
    // ends of the chain must accept either id or kid.
    const ok = bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'a6db6c9a' },
      { boardId: 'b1', kind: 'card', entityId: 'crdt-1-b' }
    );
    expect(ok).toBe(true);
    expect(board.rows[0].stacks[0].columns[0].cards.map((c) => c.kid))
      .toEqual(['a6db6c9a', 'c88eb77c']);
  });

  it('rejects cross-kind drops', () => {
    const board = makeBoard();
    const ok = bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'column', entityId: 'c1' }
    );
    expect(ok).toBe(false);
  });

  it('rejects when source or target is not found', () => {
    const board = makeBoard();
    expect(bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'missing' },
      { boardId: 'b1', kind: 'card', entityId: 'card-1' }
    )).toBe(false);
    expect(bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'card', entityId: 'missing' }
    )).toBe(false);
  });

  it('rejects when source equals target', () => {
    const board = makeBoard();
    const ok = bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'card', entityId: 'card-1' }
    );
    expect(ok).toBe(false);
  });

  it('returns false on missing/invalid input', () => {
    expect(bridge.applyEntityReorder(null, {}, {})).toBe(false);
    expect(bridge.applyEntityReorder({ rows: [] }, null, {})).toBe(false);
    expect(bridge.applyEntityReorder({ rows: [] }, {}, null)).toBe(false);
  });
});

describe('LexeraHierarchyDragBridge.applyEntityAbsorb', () => {
  const bridge = loadBridge();

  it('absorbs a card into a column (appends to cards array)', () => {
    const board = makeBoard();
    const ok = bridge.applyEntityAbsorb(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'column', entityId: 'c2' }
    );
    expect(ok).toBe(true);
    // card-1 left c1, joined the END of c2's cards.
    expect(board.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(['card-2', 'card-3']);
    expect(board.rows[0].stacks[0].columns[1].cards.map((c) => c.id))
      .toEqual(['card-4', 'card-1']);
  });

  it('absorbs a column into a stack', () => {
    const board = makeBoard();
    const ok = bridge.applyEntityAbsorb(
      board,
      { boardId: 'b1', kind: 'column', entityId: 'c1' },
      { boardId: 'b1', kind: 'stack', entityId: 's2' }
    );
    expect(ok).toBe(true);
    // c1 leaves s1, joins the END of s2's columns.
    expect(board.rows[0].stacks[0].columns.map((c) => c.id)).toEqual(['c2']);
    expect(board.rows[0].stacks[1].columns.map((c) => c.id)).toEqual(['c3', 'c1']);
  });

  it('absorbs a stack into a row', () => {
    const board = makeBoard();
    const ok = bridge.applyEntityAbsorb(
      board,
      { boardId: 'b1', kind: 'stack', entityId: 's1' },
      { boardId: 'b1', kind: 'row', entityId: 'r2' }
    );
    expect(ok).toBe(true);
    expect(board.rows[0].stacks.map((s) => s.id)).toEqual(['s2']);
    expect(board.rows[1].stacks.map((s) => s.id)).toEqual(['s3', 's1']);
  });

  it('absorbs a row directly into the kanban (row → board appends to board.rows)', () => {
    // Drag the second top-level row onto the board itself. The row is
    // pulled out of board.rows and pushed onto the same board.rows
    // array — net effect: r2 lands at the end (it was already after
    // r1, but now it's been re-stamped at the tail in case the user
    // wanted to "anchor" it there).
    const board = makeBoard();
    const ok = bridge.applyEntityAbsorb(
      board,
      { boardId: 'b1', kind: 'row', entityId: 'r2' },
      { boardId: 'b1', kind: 'board', entityId: 'b1' }
    );
    expect(ok).toBe(true);
    expect(board.rows.map((r) => r.id)).toEqual(['r1', 'r2']);

    // Now move r1 to the end.
    const ok2 = bridge.applyEntityAbsorb(
      board,
      { boardId: 'b1', kind: 'row', entityId: 'r1' },
      { boardId: 'b1', kind: 'board', entityId: 'b1' }
    );
    expect(ok2).toBe(true);
    expect(board.rows.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('rejects non-row absorb into board (only rows can sit at the top level)', () => {
    const board = makeBoard();
    expect(bridge.applyEntityAbsorb(board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'board', entityId: 'b1' }
    )).toBe(false);
    expect(bridge.applyEntityAbsorb(board,
      { boardId: 'b1', kind: 'stack', entityId: 's1' },
      { boardId: 'b1', kind: 'board', entityId: 'b1' }
    )).toBe(false);
  });

  it('rejects same-kind drops (caller should use applyEntityReorder)', () => {
    const board = makeBoard();
    const ok = bridge.applyEntityAbsorb(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'card', entityId: 'card-2' }
    );
    expect(ok).toBe(false);
  });

  it('rejects non-adjacent cross-kind drops (card → row, card → stack)', () => {
    const board = makeBoard();
    expect(bridge.applyEntityAbsorb(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'row', entityId: 'r1' }
    )).toBe(false);
    expect(bridge.applyEntityAbsorb(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'stack', entityId: 's1' }
    )).toBe(false);
  });

  it('rejects when source or target is not found', () => {
    const board = makeBoard();
    expect(bridge.applyEntityAbsorb(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'missing' },
      { boardId: 'b1', kind: 'column', entityId: 'c1' }
    )).toBe(false);
  });
});

describe('LexeraHierarchyDragBridge.applyCrossBoardEntityReorder', () => {
  const bridge = loadBridge();

  function makeBoardWithCards(prefix) {
    return {
      title: prefix,
      columns: [],
      rows: [{
        id: prefix + '-r1', title: 'Row',
        stacks: [{
          id: prefix + '-s1', title: 'Stack',
          columns: [{
            id: prefix + '-c1', title: 'Col',
            cards: [
              { id: prefix + '-card-1', title: 'A' },
              { id: prefix + '-card-2', title: 'B' }
            ]
          }]
        }]
      }]
    };
  }

  it('moves a card from board A into board B at the target index', () => {
    const a = makeBoardWithCards('a');
    const b = makeBoardWithCards('b');
    const ok = bridge.applyCrossBoardEntityReorder(a, b,
      { boardId: 'A', kind: 'card', entityId: 'a-card-1' },
      { boardId: 'B', kind: 'card', entityId: 'b-card-2' }
    );
    expect(ok).toBe(true);
    // Source board lost the card.
    expect(a.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(['a-card-2']);
    // Target board gained the card right before b-card-2.
    expect(b.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(['b-card-1', 'a-card-1', 'b-card-2']);
  });

  it('rejects when the boards are the same (caller should use applyEntityReorder)', () => {
    const a = makeBoardWithCards('a');
    const ok = bridge.applyCrossBoardEntityReorder(a, a,
      { boardId: 'A', kind: 'card', entityId: 'a-card-1' },
      { boardId: 'A', kind: 'card', entityId: 'a-card-2' }
    );
    expect(ok).toBe(false);
  });

  it('rejects cross-kind moves', () => {
    const a = makeBoardWithCards('a');
    const b = makeBoardWithCards('b');
    const ok = bridge.applyCrossBoardEntityReorder(a, b,
      { boardId: 'A', kind: 'card', entityId: 'a-card-1' },
      { boardId: 'B', kind: 'column', entityId: 'b-c1' }
    );
    expect(ok).toBe(false);
  });

  it('rejects when source or target id is missing', () => {
    const a = makeBoardWithCards('a');
    const b = makeBoardWithCards('b');
    expect(bridge.applyCrossBoardEntityReorder(a, b,
      { boardId: 'A', kind: 'card', entityId: 'missing' },
      { boardId: 'B', kind: 'card', entityId: 'b-card-1' }
    )).toBe(false);
    expect(bridge.applyCrossBoardEntityReorder(a, b,
      { boardId: 'A', kind: 'card', entityId: 'a-card-1' },
      { boardId: 'B', kind: 'card', entityId: 'missing' }
    )).toBe(false);
  });

  it('returns false on missing/invalid input', () => {
    expect(bridge.applyCrossBoardEntityReorder(null, {}, {}, {})).toBe(false);
    expect(bridge.applyCrossBoardEntityReorder({}, null, {}, {})).toBe(false);
    expect(bridge.applyCrossBoardEntityReorder({}, {}, null, {})).toBe(false);
    expect(bridge.applyCrossBoardEntityReorder({}, {}, {}, null)).toBe(false);
  });
});

describe('LexeraHierarchyDragBridge.applyCrossBoardEntityAbsorb', () => {
  const bridge = loadBridge();

  function makeBoardWithStructure(prefix) {
    return {
      title: prefix, columns: [],
      rows: [{ id: prefix + '-r1', title: 'Row', stacks: [{
        id: prefix + '-s1', title: 'Stack', columns: [
          { id: prefix + '-c1', title: 'Col 1', cards: [{ id: prefix + '-card-1', title: 'A' }] },
          { id: prefix + '-c2', title: 'Col 2', cards: [] }
        ]
      }] }]
    };
  }

  it('absorbs a card from board A into a column in board B', () => {
    const a = makeBoardWithStructure('a');
    const b = makeBoardWithStructure('b');
    const ok = bridge.applyCrossBoardEntityAbsorb(a, b,
      { boardId: 'A', kind: 'card', entityId: 'a-card-1' },
      { boardId: 'B', kind: 'column', entityId: 'b-c2' }
    );
    expect(ok).toBe(true);
    // Source board's column lost the card.
    expect(a.rows[0].stacks[0].columns[0].cards.length).toBe(0);
    // Target column gained it at the end.
    expect(b.rows[0].stacks[0].columns[1].cards.map((c) => c.id))
      .toEqual(['a-card-1']);
  });

  it('rejects same-board moves (caller should use applyEntityAbsorb)', () => {
    const a = makeBoardWithStructure('a');
    const ok = bridge.applyCrossBoardEntityAbsorb(a, a,
      { boardId: 'A', kind: 'card', entityId: 'a-card-1' },
      { boardId: 'A', kind: 'column', entityId: 'a-c2' }
    );
    expect(ok).toBe(false);
  });

  it('rejects same-kind drops (use applyCrossBoardEntityReorder)', () => {
    const a = makeBoardWithStructure('a');
    const b = makeBoardWithStructure('b');
    const ok = bridge.applyCrossBoardEntityAbsorb(a, b,
      { boardId: 'A', kind: 'card', entityId: 'a-card-1' },
      { boardId: 'B', kind: 'card', entityId: 'b-card-1' }
    );
    expect(ok).toBe(false);
  });

  it('rejects non-adjacent cross-kind drops (card → row)', () => {
    const a = makeBoardWithStructure('a');
    const b = makeBoardWithStructure('b');
    const ok = bridge.applyCrossBoardEntityAbsorb(a, b,
      { boardId: 'A', kind: 'card', entityId: 'a-card-1' },
      { boardId: 'B', kind: 'row', entityId: 'b-r1' }
    );
    expect(ok).toBe(false);
  });

  it('returns false on missing/invalid input', () => {
    expect(bridge.applyCrossBoardEntityAbsorb(null, {}, {}, {})).toBe(false);
    expect(bridge.applyCrossBoardEntityAbsorb({}, null, {}, {})).toBe(false);
    expect(bridge.applyCrossBoardEntityAbsorb({}, {}, null, {})).toBe(false);
    expect(bridge.applyCrossBoardEntityAbsorb({}, {}, {}, null)).toBe(false);
  });
});

describe('LexeraHierarchyDragBridge.applyEntityRename', () => {
  const bridge = loadBridge();

  it('renames a card by id', () => {
    const board = makeBoard();
    const ok = bridge.applyEntityRename(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      'New title'
    );
    expect(ok).toBe(true);
    expect(board.rows[0].stacks[0].columns[0].cards[0].title).toBe('New title');
  });

  it('renames a column / stack / row by id', () => {
    const board = makeBoard();
    expect(bridge.applyEntityRename(board,
      { boardId: 'b1', kind: 'column', entityId: 'c1' }, 'Cols!')).toBe(true);
    expect(board.rows[0].stacks[0].columns[0].title).toBe('Cols!');
    expect(bridge.applyEntityRename(board,
      { boardId: 'b1', kind: 'stack', entityId: 's1' }, 'Stk!')).toBe(true);
    expect(board.rows[0].stacks[0].title).toBe('Stk!');
    expect(bridge.applyEntityRename(board,
      { boardId: 'b1', kind: 'row', entityId: 'r1' }, 'Rw!')).toBe(true);
    expect(board.rows[0].title).toBe('Rw!');
  });

  it('trims whitespace before applying', () => {
    const board = makeBoard();
    bridge.applyEntityRename(board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' }, '   spaces around   ');
    expect(board.rows[0].stacks[0].columns[0].cards[0].title).toBe('spaces around');
  });

  it('rejects empty / whitespace-only titles', () => {
    const board = makeBoard();
    expect(bridge.applyEntityRename(board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' }, '')).toBe(false);
    expect(bridge.applyEntityRename(board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' }, '   ')).toBe(false);
  });

  it('rejects no-op renames (same as existing title)', () => {
    const board = makeBoard();
    // Existing title for card-1 is 'A' (see makeBoard()).
    const ok = bridge.applyEntityRename(board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' }, 'A');
    expect(ok).toBe(false);
  });

  it('rejects when source entity is missing', () => {
    const board = makeBoard();
    expect(bridge.applyEntityRename(board,
      { boardId: 'b1', kind: 'card', entityId: 'missing' }, 'Whatever')).toBe(false);
  });

  it('returns false on missing/invalid input', () => {
    expect(bridge.applyEntityRename(null, {}, 'X')).toBe(false);
    expect(bridge.applyEntityRename({}, null, 'X')).toBe(false);
  });
});

describe('LexeraHierarchyDragBridge.applyDrop (unified dispatch)', () => {
  const bridge = loadBridge();

  it('routes same-board same-kind to applyEntityReorder', () => {
    const board = makeBoard();
    const ok = bridge.applyDrop(board, board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'card', entityId: 'card-3' }
    );
    expect(ok).toBe(true);
    expect(board.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(['card-2', 'card-1', 'card-3']);
  });

  it('routes same-board cross-kind to applyEntityAbsorb', () => {
    const board = makeBoard();
    const ok = bridge.applyDrop(board, board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'column', entityId: 'c2' }
    );
    expect(ok).toBe(true);
    expect(board.rows[0].stacks[0].columns[1].cards.map((c) => c.id))
      .toEqual(['card-4', 'card-1']);
  });

  it('routes cross-board same-kind to applyCrossBoardEntityReorder', () => {
    function mk(prefix) {
      return {
        title: prefix, columns: [],
        rows: [{ id: prefix + '-r', title: 'R', stacks: [{
          id: prefix + '-s', title: 'S', columns: [{
            id: prefix + '-c', title: 'C',
            cards: [{ id: prefix + '-card', title: 'X' }]
          }]
        }] }]
      };
    }
    const a = mk('a'), b = mk('b');
    const ok = bridge.applyDrop(a, b,
      { boardId: 'A', kind: 'card', entityId: 'a-card' },
      { boardId: 'B', kind: 'card', entityId: 'b-card' }
    );
    expect(ok).toBe(true);
    expect(a.rows[0].stacks[0].columns[0].cards.length).toBe(0);
    expect(b.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(['a-card', 'b-card']);
  });

  it('routes cross-board cross-kind to applyCrossBoardEntityAbsorb', () => {
    function mk(prefix) {
      return {
        title: prefix, columns: [],
        rows: [{ id: prefix + '-r', title: 'R', stacks: [{
          id: prefix + '-s', title: 'S', columns: [
            { id: prefix + '-c1', title: 'C1', cards: [{ id: prefix + '-card', title: 'X' }] },
            { id: prefix + '-c2', title: 'C2', cards: [] }
          ]
        }] }]
      };
    }
    const a = mk('a'), b = mk('b');
    const ok = bridge.applyDrop(a, b,
      { boardId: 'A', kind: 'card', entityId: 'a-card' },
      { boardId: 'B', kind: 'column', entityId: 'b-c2' }
    );
    expect(ok).toBe(true);
    expect(a.rows[0].stacks[0].columns[0].cards.length).toBe(0);
    expect(b.rows[0].stacks[0].columns[1].cards.map((c) => c.id))
      .toEqual(['a-card']);
  });

  it('returns false on missing source or target', () => {
    expect(bridge.applyDrop({}, {}, null, {})).toBe(false);
    expect(bridge.applyDrop({}, {}, {}, null)).toBe(false);
  });
});

describe('LexeraHierarchyDragBridge.routeCrossViewDragPoint', () => {
  const bridge = loadBridge();

  // Source webview lives at top-window (50, 100), 200x300.
  // Target webview lives at top-window (300, 100), 200x300.
  function fixture() {
    return {
      sourceWebviewLabel: 'sub-app-1',
      getWebviewRect: function (label) {
        if (label === 'sub-app-1') return { left: 50, top: 100, right: 250, bottom: 400 };
        if (label === 'kanban-board-1') return { left: 300, top: 100, right: 500, bottom: 400 };
        return null;
      },
      getWebviewLabelAtTopPoint: function (topX, topY) {
        if (topX >= 50 && topX <= 250 && topY >= 100 && topY <= 400) return 'sub-app-1';
        if (topX >= 300 && topX <= 500 && topY >= 100 && topY <= 400) return 'kanban-board-1';
        return null;
      }
    };
  }

  it('returns target label + local coords when the cursor is over a different webview', () => {
    const f = fixture();
    // Cursor at sourceClientX=300, sourceClientY=50. Source webview
    // is at top (50, 100), so topX=350, topY=150 — over the kanban
    // webview (which starts at top.left=300).
    f.sourceClientX = 300;
    f.sourceClientY = 50;
    const out = bridge.routeCrossViewDragPoint(f);
    expect(out).toBeTruthy();
    expect(out.targetLabel).toBe('kanban-board-1');
    expect(out.topX).toBe(350);
    expect(out.topY).toBe(150);
    // Target webview starts at top.left=300, so localX = 350 - 300 = 50.
    expect(out.localX).toBe(50);
    expect(out.localY).toBe(50);
  });

  it('returns null when the cursor stays inside the source webview', () => {
    const f = fixture();
    f.sourceClientX = 50;
    f.sourceClientY = 50;
    // topX = 100, topY = 150 → still over sub-app-1.
    expect(bridge.routeCrossViewDragPoint(f)).toBeNull();
  });

  it('returns null when the cursor is outside every known webview', () => {
    const f = fixture();
    f.sourceClientX = 1000;
    f.sourceClientY = 1000;
    expect(bridge.routeCrossViewDragPoint(f)).toBeNull();
  });

  it('returns null when source webview rect is unknown', () => {
    const f = fixture();
    f.sourceWebviewLabel = 'never-spawned';
    f.sourceClientX = 10;
    f.sourceClientY = 10;
    expect(bridge.routeCrossViewDragPoint(f)).toBeNull();
  });

  it('returns null on missing / non-numeric coords', () => {
    const f = fixture();
    expect(bridge.routeCrossViewDragPoint(null)).toBeNull();
    expect(bridge.routeCrossViewDragPoint(Object.assign({}, f))).toBeNull(); // no coords
    expect(bridge.routeCrossViewDragPoint(Object.assign({}, f, {
      sourceClientX: 'oops', sourceClientY: 50
    }))).toBeNull();
  });
});

describe('LexeraHierarchyDragBridge.install', () => {
  const bridge = loadBridge();

  function makeWebview() {
    const listeners = {};
    return {
      label: 'main',
      listen: vi.fn((eventName, handler) => { listeners[eventName] = handler; }),
      _fire: (eventName, payload) => {
        if (listeners[eventName]) listeners[eventName]({ payload });
      }
    };
  }
  // Mock the shell-detection deps. As of 2026-05-10 (Stage 13) the
  // bridge's apply listeners are gated on these — only the shell
  // (which has LexeraMultiviewWebview) wires hierarchy-entity-drop
  // / hierarchy-entity-rename, so sub-app + embedded-kanban webviews
  // don't double-apply. Tests that exercise the apply path must
  // pass these to put the bridge in shell mode.
  const shellGeomDeps = {
    getWebviewLabelAtTopPoint: () => null,
    getWebviewRect: () => null
  };

  it('subscribes to hierarchy-entity-drop and persists same-board sibling reorders', async () => {
    const wv = makeWebview();
    const invoke = vi.fn(() => Promise.resolve());
    const board = makeBoard();
    const loadBoard = vi.fn(() => Promise.resolve(board));
    const saveBoard = vi.fn(() => Promise.resolve());
    const onApplied = vi.fn();
    const ok = bridge.install({
      getCurrentWebview: () => wv,
      invoke: invoke,
      loadBoard: loadBoard,
      saveBoard: saveBoard,
      onApplied: onApplied,
      ...shellGeomDeps
    });
    expect(ok).toBe(true);

    // multiview_subscribe was called for ALL the apply + cross-view
    // events in a single subscribe (Stage 13 consolidation — shell-only
    // gate now wraps both sets).
    expect(invoke).toHaveBeenCalledWith('multiview_subscribe', {
      label: 'main',
      events: [
        'hierarchy-entity-drop',
        'hierarchy-entity-rename',
        'hierarchy-entity-drag-start',
        'hierarchy-entity-drag-move',
        'hierarchy-entity-drag-end-external'
      ]
    });
    expect(wv.listen).toHaveBeenCalledWith('hierarchy-entity-drop', expect.any(Function));
    expect(wv.listen).toHaveBeenCalledWith('hierarchy-entity-rename', expect.any(Function));

    // Fire a drop event.
    wv._fire('hierarchy-entity-drop', {
      source: { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      target: { boardId: 'b1', kind: 'card', entityId: 'card-3' }
    });
    // Wait for the handler's promise chain to settle.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(loadBoard).toHaveBeenCalledWith('b1');
    expect(saveBoard).toHaveBeenCalledTimes(1);
    const [savedId, savedBoard] = saveBoard.mock.calls[0];
    expect(savedId).toBe('b1');
    // Same "source lands before target" semantic as the unit tests.
    expect(savedBoard.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(['card-2', 'card-1', 'card-3']);
    expect(onApplied).toHaveBeenCalledWith('b1');
  });

  it('warms visible board webviews on hierarchy-entity-drag-start so first cross-view drops are not lost to cold panes', () => {
    const wv = makeWebview();
    const invoke = vi.fn(() => Promise.resolve());
    const ensureVisibleBoardFramesLoaded = vi.fn(() => 2);
    const bridgeWithShell = loadBridge({
      LexeraWorkspaceShell: { ensureVisibleBoardFramesLoaded },
      lexeraLog: vi.fn()
    });

    const ok = bridgeWithShell.install({
      getCurrentWebview: () => wv,
      invoke,
      loadBoard: () => Promise.resolve(makeBoard()),
      saveBoard: () => Promise.resolve(),
      ...shellGeomDeps
    });

    expect(ok).toBe(true);
    wv._fire('hierarchy-entity-drag-start', {
      boardId: 'b1',
      kind: 'card',
      entityId: 'card-1'
    });

    expect(ensureVisibleBoardFramesLoaded).toHaveBeenCalledWith('xview-drag-start');
  });

  it('persists cross-parent same-kind drops (cross-column card move) — saveBoard fires once with the rebuilt board', async () => {
    // 2026-05-09 user contract update: cross-column card moves
    // within the same board MUST persist. The previous "does not
    // call saveBoard" expectation pinned the deferred-Phase-3
    // behaviour that surfaced as `applyDrop returned false` in the
    // user-pasted in-app log.
    const wv = makeWebview();
    const board = makeBoard();
    const saveBoard = vi.fn(() => Promise.resolve());
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: vi.fn(() => Promise.resolve()),
      loadBoard: () => Promise.resolve(board),
      saveBoard: saveBoard,
      ...shellGeomDeps
    });
    wv._fire('hierarchy-entity-drop', {
      source: { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      target: { boardId: 'b1', kind: 'card', entityId: 'card-4' }
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(saveBoard).toHaveBeenCalledTimes(1);
    const [savedId, savedBoard] = saveBoard.mock.calls[0];
    expect(savedId).toBe('b1');
    // card-1 was removed from c1 …
    expect(savedBoard.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(['card-2', 'card-3']);
    // … and inserted before card-4 in c2 (default `position`).
    expect(savedBoard.rows[0].stacks[0].columns[1].cards.map((c) => c.id))
      .toEqual(['card-1', 'card-4']);
  });

  it('returns false when required deps are missing', () => {
    expect(bridge.install({})).toBe(false);
    expect(bridge.install({
      getCurrentWebview: () => ({ label: 'm', listen: vi.fn() }),
      invoke: vi.fn(),
      loadBoard: vi.fn()
      // saveBoard missing
    })).toBe(false);
  });

  it('routes same-board cross-kind drops through applyEntityAbsorb', async () => {
    const wv = makeWebview();
    const board = makeBoard();
    const saveBoard = vi.fn(() => Promise.resolve());
    const onApplied = vi.fn();
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: vi.fn(() => Promise.resolve()),
      loadBoard: () => Promise.resolve(board),
      saveBoard: saveBoard,
      onApplied: onApplied,
      ...shellGeomDeps
    });

    // card-1 → column c2 absorb.
    wv._fire('hierarchy-entity-drop', {
      source: { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      target: { boardId: 'b1', kind: 'column', entityId: 'c2' }
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(saveBoard).toHaveBeenCalledTimes(1);
    const [savedId, savedBoard] = saveBoard.mock.calls[0];
    expect(savedId).toBe('b1');
    expect(savedBoard.rows[0].stacks[0].columns[1].cards.map((c) => c.id))
      .toEqual(['card-4', 'card-1']);
    expect(onApplied).toHaveBeenCalledWith('b1');
  });

  it('cross-board drop loads BOTH boards, applies the move, saves BOTH, and fires onApplied per board', async () => {
    const wv = makeWebview();
    const invoke = vi.fn(() => Promise.resolve());
    function makeBoardWithCards(prefix) {
      return {
        title: prefix,
        columns: [],
        rows: [{ id: prefix + '-r1', title: 'Row', stacks: [{
          id: prefix + '-s1', title: 'Stack', columns: [{
            id: prefix + '-c1', title: 'Col', cards: [
              { id: prefix + '-card-1', title: 'A' },
              { id: prefix + '-card-2', title: 'B' }
            ]
          }]
        }] }]
      };
    }
    const boardA = makeBoardWithCards('a');
    const boardB = makeBoardWithCards('b');
    const loadBoard = vi.fn((id) => Promise.resolve(id === 'A' ? boardA : boardB));
    const saveBoard = vi.fn(() => Promise.resolve());
    const onApplied = vi.fn();
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: invoke,
      loadBoard: loadBoard,
      saveBoard: saveBoard,
      onApplied: onApplied,
      ...shellGeomDeps
    });

    wv._fire('hierarchy-entity-drop', {
      source: { boardId: 'A', kind: 'card', entityId: 'a-card-1' },
      target: { boardId: 'B', kind: 'card', entityId: 'b-card-2' }
    });
    // Wait for the Promise.all chain to settle.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(loadBoard).toHaveBeenCalledWith('A');
    expect(loadBoard).toHaveBeenCalledWith('B');
    expect(saveBoard).toHaveBeenCalledTimes(2);
    const savedIds = saveBoard.mock.calls.map((c) => c[0]).sort();
    expect(savedIds).toEqual(['A', 'B']);
    // Source lost the card; target gained it before its anchor.
    const savedA = saveBoard.mock.calls.find((c) => c[0] === 'A')[1];
    const savedB = saveBoard.mock.calls.find((c) => c[0] === 'B')[1];
    expect(savedA.rows[0].stacks[0].columns[0].cards.map((c) => c.id)).toEqual(['a-card-2']);
    expect(savedB.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(['b-card-1', 'a-card-1', 'b-card-2']);
    // onApplied fires once per affected board.
    expect(onApplied).toHaveBeenCalledWith('A');
    expect(onApplied).toHaveBeenCalledWith('B');
  });

  it('routes cross-board cross-kind drops through applyCrossBoardEntityAbsorb', async () => {
    const wv = makeWebview();
    function makeBoardWithStructure(prefix) {
      return {
        title: prefix, columns: [],
        rows: [{ id: prefix + '-r1', title: 'Row', stacks: [{
          id: prefix + '-s1', title: 'Stack', columns: [
            { id: prefix + '-c1', title: 'C1', cards: [{ id: prefix + '-card-1', title: 'A' }] },
            { id: prefix + '-c2', title: 'C2', cards: [] }
          ]
        }] }]
      };
    }
    const a = makeBoardWithStructure('a');
    const b = makeBoardWithStructure('b');
    const loadBoard = vi.fn((id) => Promise.resolve(id === 'A' ? a : b));
    const saveBoard = vi.fn(() => Promise.resolve());
    const onApplied = vi.fn();
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: vi.fn(() => Promise.resolve()),
      loadBoard: loadBoard,
      saveBoard: saveBoard,
      onApplied: onApplied,
      ...shellGeomDeps
    });

    // a-card-1 → b-c2 absorb (cross-board, cross-kind).
    wv._fire('hierarchy-entity-drop', {
      source: { boardId: 'A', kind: 'card', entityId: 'a-card-1' },
      target: { boardId: 'B', kind: 'column', entityId: 'b-c2' }
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(saveBoard).toHaveBeenCalledTimes(2);
    const savedA = saveBoard.mock.calls.find((c) => c[0] === 'A')[1];
    const savedB = saveBoard.mock.calls.find((c) => c[0] === 'B')[1];
    expect(savedA.rows[0].stacks[0].columns[0].cards.length).toBe(0);
    expect(savedB.rows[0].stacks[0].columns[1].cards.map((c) => c.id))
      .toEqual(['a-card-1']);
    expect(onApplied).toHaveBeenCalledWith('A');
    expect(onApplied).toHaveBeenCalledWith('B');
  });

  it('after a successful drop, broadcasts hierarchy-board-changed for every affected board', async () => {
    const wv = makeWebview();
    // The same `invoke` mock handles both subscribe AND broadcast
    // calls; we filter by command name in the assertions.
    const invoke = vi.fn(() => Promise.resolve());
    const board = makeBoard();
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: invoke,
      loadBoard: () => Promise.resolve(board),
      saveBoard: () => Promise.resolve(),
      ...shellGeomDeps
    });

    // Same-board drop → one broadcast for the affected board.
    wv._fire('hierarchy-entity-drop', {
      source: { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      target: { boardId: 'b1', kind: 'card', entityId: 'card-3' }
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const broadcasts = invoke.mock.calls.filter((c) => c[0] === 'multiview_broadcast_global_subscribers');
    const hierarchyBroadcasts = broadcasts.filter((c) =>
      c[1] && c[1].event === 'hierarchy-board-changed');
    expect(hierarchyBroadcasts.length).toBe(1);
    expect(hierarchyBroadcasts[0][1].payload).toEqual({ boardId: 'b1' });
  });

  it('cross-board drop broadcasts hierarchy-board-changed for BOTH boards', async () => {
    const wv = makeWebview();
    const invoke = vi.fn(() => Promise.resolve());
    function mk(prefix) {
      return {
        title: prefix, columns: [],
        rows: [{ id: prefix + '-r', title: 'R', stacks: [{
          id: prefix + '-s', title: 'S', columns: [{
            id: prefix + '-c', title: 'C',
            cards: [{ id: prefix + '-card', title: 'X' }]
          }]
        }] }]
      };
    }
    const a = mk('a'), b = mk('b');
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: invoke,
      loadBoard: (id) => Promise.resolve(id === 'A' ? a : b),
      saveBoard: () => Promise.resolve(),
      ...shellGeomDeps
    });
    wv._fire('hierarchy-entity-drop', {
      source: { boardId: 'A', kind: 'card', entityId: 'a-card' },
      target: { boardId: 'B', kind: 'card', entityId: 'b-card' }
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const hierarchyBroadcasts = invoke.mock.calls
      .filter((c) => c[0] === 'multiview_broadcast_global_subscribers' && c[1] && c[1].event === 'hierarchy-board-changed')
      .map((c) => c[1].payload.boardId)
      .sort();
    expect(hierarchyBroadcasts).toEqual(['A', 'B']);
  });

  it('hierarchy-entity-rename loads, mutates, saves, and broadcasts hierarchy-board-changed', async () => {
    const wv = makeWebview();
    const invoke = vi.fn(() => Promise.resolve());
    const board = makeBoard();
    const saveBoard = vi.fn(() => Promise.resolve());
    const onApplied = vi.fn();
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: invoke,
      loadBoard: () => Promise.resolve(board),
      saveBoard: saveBoard,
      onApplied: onApplied,
      ...shellGeomDeps
    });

    wv._fire('hierarchy-entity-rename', {
      source: { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      newTitle: 'Renamed!'
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(saveBoard).toHaveBeenCalledTimes(1);
    const [savedId, savedBoard] = saveBoard.mock.calls[0];
    expect(savedId).toBe('b1');
    expect(savedBoard.rows[0].stacks[0].columns[0].cards[0].title).toBe('Renamed!');
    expect(onApplied).toHaveBeenCalledWith('b1');
    // Bridge fires hierarchy-board-changed so sub-apps invalidate cache.
    const broadcasts = invoke.mock.calls.filter((c) =>
      c[0] === 'multiview_broadcast_global_subscribers' && c[1] && c[1].event === 'hierarchy-board-changed');
    expect(broadcasts.length).toBe(1);
    expect(broadcasts[0][1].payload.boardId).toBe('b1');
  });

  it('hierarchy-entity-rename with empty title does not save', async () => {
    const wv = makeWebview();
    const board = makeBoard();
    const saveBoard = vi.fn(() => Promise.resolve());
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: vi.fn(() => Promise.resolve()),
      loadBoard: () => Promise.resolve(board),
      saveBoard: saveBoard,
      ...shellGeomDeps
    });
    wv._fire('hierarchy-entity-rename', {
      source: { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      newTitle: ''
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(saveBoard).not.toHaveBeenCalled();
  });

  it('forwards hierarchy-entity-drag-move to the target webview as external-dnd-hover', async () => {
    const wv = makeWebview();
    const invoke = vi.fn(() => Promise.resolve());
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: invoke,
      loadBoard: () => Promise.resolve(makeBoard()),
      saveBoard: () => Promise.resolve(),
      // Cross-view geometry: sub-app at top (50,100), kanban at (300,100).
      getWebviewRect: function (label) {
        if (label === 'sub-app-1') return { left: 50, top: 100, right: 250, bottom: 400 };
        if (label === 'kanban-board-1') return { left: 300, top: 100, right: 500, bottom: 400 };
        return null;
      },
      getWebviewLabelAtTopPoint: function (topX, topY) {
        if (topX >= 300 && topX <= 500 && topY >= 100 && topY <= 400) return 'kanban-board-1';
        return null;
      }
    });

    // Sub-app fires drag-move with cursor at sourceClientX=300,
    // sourceClientY=50 → topX=350, topY=150 → kanban webview.
    wv._fire('hierarchy-entity-drag-move', {
      source: { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      sourceWebviewLabel: 'sub-app-1',
      sourceClientX: 300,
      sourceClientY: 50
    });
    await new Promise((r) => setTimeout(r, 0));

    const emits = invoke.mock.calls.filter((c) => c[0] === 'multiview_emit_to');
    expect(emits.length).toBe(1);
    expect(emits[0][1].target).toBe('kanban-board-1');
    expect(emits[0][1].event).toBe('external-dnd-hover');
    expect(emits[0][1].payload.payload).toEqual({
      source: { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      type: 'tree-card'
    });
    expect(emits[0][1].payload.x).toBe(50);  // 350 - 300 (target.left)
    expect(emits[0][1].payload.y).toBe(50);  // 150 - 100 (target.top)
  });

  it('forwards hierarchy-entity-drag-end-external as external-dnd-drop', async () => {
    const wv = makeWebview();
    const invoke = vi.fn(() => Promise.resolve());
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: invoke,
      loadBoard: () => Promise.resolve(makeBoard()),
      saveBoard: () => Promise.resolve(),
      getWebviewRect: function (label) {
        return label === 'sub-app-1' ? { left: 0, top: 0, right: 100, bottom: 100 }
          : label === 'kanban-board-1' ? { left: 100, top: 0, right: 200, bottom: 100 }
          : null;
      },
      getWebviewLabelAtTopPoint: function (topX, topY) {
        return topX >= 100 ? 'kanban-board-1' : 'sub-app-1';
      }
    });

    // Cursor at sourceClientX=150 → topX=150 (source.left=0) → over kanban.
    wv._fire('hierarchy-entity-drag-end-external', {
      source: { boardId: 'b1', kind: 'row', entityId: 'r1' },
      sourceWebviewLabel: 'sub-app-1',
      sourceClientX: 150, sourceClientY: 50
    });
    await new Promise((r) => setTimeout(r, 0));

    const emits = invoke.mock.calls.filter((c) => c[0] === 'multiview_emit_to');
    expect(emits.length).toBe(1);
    expect(emits[0][1].event).toBe('external-dnd-drop');
    expect(emits[0][1].payload.payload.type).toBe('tree-row');
  });

  it('does not forward when the cursor stays inside the source webview', async () => {
    const wv = makeWebview();
    const invoke = vi.fn(() => Promise.resolve());
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: invoke,
      loadBoard: () => Promise.resolve(makeBoard()),
      saveBoard: () => Promise.resolve(),
      getWebviewRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
      getWebviewLabelAtTopPoint: () => 'sub-app-1'  // cursor is over source
    });
    wv._fire('hierarchy-entity-drag-move', {
      source: { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      sourceWebviewLabel: 'sub-app-1',
      sourceClientX: 10, sourceClientY: 10
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(invoke.mock.calls.find((c) => c[0] === 'multiview_emit_to')).toBeFalsy();
  });

  it('install bails (returns false, no subscribes, no listeners) when geometry deps are missing — apply path is shell-only', async () => {
    // Stage 13 (2026-05-10): the bridge is now shell-only. Without
    // `getWebviewRect` + `getWebviewLabelAtTopPoint`, install runs
    // in a non-shell webview (sub-app or embedded kanban) and must
    // bail BEFORE subscribing or wiring listeners. Previously every
    // webview with LexeraApi subscribed and applied, causing 3+
    // duplicate loadBoard+applyDrop+saveBoard runs per drop — the
    // observed lag + "External Changes Need Resolution" warning.
    const wv = makeWebview();
    const invoke = vi.fn(() => Promise.resolve());
    const ok = bridge.install({
      getCurrentWebview: () => wv,
      invoke: invoke,
      loadBoard: () => Promise.resolve(makeBoard()),
      saveBoard: () => Promise.resolve()
      // No getWebviewRect / getWebviewLabelAtTopPoint — non-shell webview.
    });
    expect(ok).toBe(false);
    const subscribes = invoke.mock.calls.filter((c) => c[0] === 'multiview_subscribe');
    expect(subscribes.length).toBe(0);
    expect(wv.listen).not.toHaveBeenCalled();
  });

  it('routes errors through onError', async () => {
    const wv = makeWebview();
    const onError = vi.fn();
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: vi.fn(() => Promise.resolve()),
      loadBoard: () => Promise.reject(new Error('load failed')),
      saveBoard: vi.fn(),
      onError: onError,
      ...shellGeomDeps
    });
    wv._fire('hierarchy-entity-drop', {
      source: { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      target: { boardId: 'b1', kind: 'card', entityId: 'card-2' }
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalled();
  });

  // 2026-05-10: user reported "drag from workspace tree to kanban
  // (same board) takes ~10s vs instant within-kanban". Root cause in
  // their pasted log: TWO `apply.local-drop.received` lines fire at
  // the same millisecond for a single broadcast — the shell has the
  // apply listener subscribed twice. Both load+apply+save the same
  // drop, the second save races the first → backend reports
  // "Same generation but different content, accepting external edit"
  // → MainFileChanged cascade → live-sync snapshot adopt + full
  // board reload + 2× full renderColumns of 2324 cards (1745ms +
  // 1502ms). The double subscription happens whenever
  // `bootMultiview()` runs twice in the shell — a known regression
  // (TODOs line 147, fb907e38). The contract here is independent of
  // why the second call happened: install() must be idempotent per
  // webview so any future double-boot can't cause the cascade again.
  it('is idempotent per webview — second install() in the same shell webview is a no-op', async () => {
    const wv = makeWebview();
    const invoke = vi.fn(() => Promise.resolve());
    const saveBoard = vi.fn(() => Promise.resolve());
    const board = makeBoard();
    const deps = {
      getCurrentWebview: () => wv,
      invoke: invoke,
      loadBoard: () => Promise.resolve(board),
      saveBoard: saveBoard,
      ...shellGeomDeps
    };

    const firstOk = bridge.install(deps);
    expect(firstOk).toBe(true);
    const subscribesAfterFirst = invoke.mock.calls.filter((c) => c[0] === 'multiview_subscribe').length;
    const listensAfterFirst = wv.listen.mock.calls.length;
    expect(subscribesAfterFirst).toBe(1);
    // Shell-mode wires 5 listeners: drop, rename, drag-start preload,
    // drag-move, drag-end-external.
    expect(listensAfterFirst).toBe(5);

    const secondOk = bridge.install(deps);
    // Second call is a no-op — return value indicates "we did not
    // re-wire anything in this webview".
    expect(secondOk).toBe(false);
    // Crucially: NO additional multiview_subscribe and NO additional
    // wv.listen calls. Without this guard each broadcast fires every
    // listener twice → 2× loadBoard + 2× saveBoard for a single drop.
    const subscribesAfterSecond = invoke.mock.calls.filter((c) => c[0] === 'multiview_subscribe').length;
    const listensAfterSecond = wv.listen.mock.calls.length;
    expect(subscribesAfterSecond).toBe(subscribesAfterFirst);
    expect(listensAfterSecond).toBe(listensAfterFirst);

    // End-to-end: a single drop broadcast must produce a single
    // saveBoard, even though install() was called twice.
    wv._fire('hierarchy-entity-drop', {
      source: { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      target: { boardId: 'b1', kind: 'card', entityId: 'card-3' }
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(saveBoard).toHaveBeenCalledTimes(1);
  });

  it('idempotency is keyed per-webview — install() in a SECOND webview still wires its own listeners', async () => {
    // Different shell webviews (e.g., a popped-out window) must each
    // be able to install — the guard is a "don't wire the same
    // webview twice", not a "only one webview ever".
    const wvA = makeWebview();
    const wvB = makeWebview();
    const invokeA = vi.fn(() => Promise.resolve());
    const invokeB = vi.fn(() => Promise.resolve());

    bridge.install({
      getCurrentWebview: () => wvA,
      invoke: invokeA,
      loadBoard: () => Promise.resolve(makeBoard()),
      saveBoard: () => Promise.resolve(),
      ...shellGeomDeps
    });
    const okB = bridge.install({
      getCurrentWebview: () => wvB,
      invoke: invokeB,
      loadBoard: () => Promise.resolve(makeBoard()),
      saveBoard: () => Promise.resolve(),
      ...shellGeomDeps
    });
    expect(okB).toBe(true);
    expect(invokeB).toHaveBeenCalledWith('multiview_subscribe', expect.objectContaining({
      label: 'main'
    }));
    expect(wvB.listen).toHaveBeenCalledWith('hierarchy-entity-drop', expect.any(Function));
  });
});
