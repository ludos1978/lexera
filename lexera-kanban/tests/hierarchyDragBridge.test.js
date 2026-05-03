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

function loadBridge() {
  return loadIIFE('shell/bridges/hierarchyDragBridge.js', 'window.LexeraHierarchyDragBridge', {
    window: {},
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

  it('rejects cross-parent same-kind moves (deferred to Phase 3)', () => {
    const board = makeBoard();
    // card-1 lives in column c1; card-4 lives in column c2 — different parents.
    const ok = bridge.applyEntityReorder(
      board,
      { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      { boardId: 'b1', kind: 'card', entityId: 'card-4' }
    );
    expect(ok).toBe(false);
    // Board untouched.
    expect(board.rows[0].stacks[0].columns[0].cards.map((c) => c.id))
      .toEqual(['card-1', 'card-2', 'card-3']);
    expect(board.rows[0].stacks[0].columns[1].cards.map((c) => c.id))
      .toEqual(['card-4']);
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
      onApplied: onApplied
    });
    expect(ok).toBe(true);

    // multiview_subscribe was called for the drop event.
    expect(invoke).toHaveBeenCalledWith('multiview_subscribe', {
      label: 'main',
      events: ['hierarchy-entity-drop']
    });
    expect(wv.listen).toHaveBeenCalledWith('hierarchy-entity-drop', expect.any(Function));

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

  it('does not call saveBoard when the move is not a sibling reorder', async () => {
    const wv = makeWebview();
    const board = makeBoard();
    const saveBoard = vi.fn(() => Promise.resolve());
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: vi.fn(() => Promise.resolve()),
      loadBoard: () => Promise.resolve(board),
      saveBoard: saveBoard
    });
    // Cross-parent (different columns) — applyEntityReorder rejects.
    wv._fire('hierarchy-entity-drop', {
      source: { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      target: { boardId: 'b1', kind: 'card', entityId: 'card-4' }
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(saveBoard).not.toHaveBeenCalled();
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
      onApplied: onApplied
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
      onApplied: onApplied
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

  it('routes errors through onError', async () => {
    const wv = makeWebview();
    const onError = vi.fn();
    bridge.install({
      getCurrentWebview: () => wv,
      invoke: vi.fn(() => Promise.resolve()),
      loadBoard: () => Promise.reject(new Error('load failed')),
      saveBoard: vi.fn(),
      onError: onError
    });
    wv._fire('hierarchy-entity-drop', {
      source: { boardId: 'b1', kind: 'card', entityId: 'card-1' },
      target: { boardId: 'b1', kind: 'card', entityId: 'card-2' }
    });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalled();
  });
});
