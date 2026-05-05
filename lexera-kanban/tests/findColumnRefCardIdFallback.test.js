// Pin the cardId-fallback in `findColumnRefByStablePath`.
//
// User-reported "drag from workspace to board doesn't work":
// - Stage 1-5 of the cross-view DnD chain delivered the drop correctly
//   (verified by `[xview-dnd]` log output: source.broadcast → forward.emit
//   → receive at the target board webview).
// - But the visible drop result didn't happen because moveCard's
//   resolveColumnRefForCardMutation -> findColumnRefByStablePath was
//   given a tree-style source descriptor `{ boardId, kind: 'card',
//   cardId: <stable card id> }` with NO `columnId`. The original guard
//   bailed at `if (!columnId) return null;` — sourceRef === null,
//   moveCard silently returned, drop disappeared.
//
// Fix: when `descriptor.cardId` is provided but `columnId` isn't, the
// resolver walks the board for a column containing a card with that
// stable ID and returns that column's ref. moveCard's downstream
// `resolveSourceCardIndex(column, _, _, source.cardId)` then finds the
// card index within that column.
//
// This test extracts the function from app.js (same pattern as
// mutations.test.js:194) and exercises the new fallback branch.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS_SRC = readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8');

function extractFunctionByName(name) {
  // Find `function <name>(` and slice forward until the matching `}`.
  const startMarker = 'function ' + name + '(';
  const startIdx = APP_JS_SRC.indexOf(startMarker);
  if (startIdx === -1) throw new Error('function not found: ' + name);
  let depth = 0;
  let inFn = false;
  for (let i = startIdx; i < APP_JS_SRC.length; i++) {
    const ch = APP_JS_SRC[i];
    if (ch === '{') { depth++; inFn = true; continue; }
    if (ch === '}') {
      depth--;
      if (inFn && depth === 0) {
        return APP_JS_SRC.slice(startIdx, i + 1);
      }
    }
  }
  throw new Error('unterminated function: ' + name);
}

// Build an evaluatable harness for findColumnRefByStablePath. Its only
// dependency is `normalizeStableCardMutationId` so we extract that too.
const harness = `
'use strict';
${extractFunctionByName('normalizeStableCardMutationId')}
${extractFunctionByName('findColumnRefByStablePath')}
return { findColumnRefByStablePath: findColumnRefByStablePath };
`;
const fn = new Function(harness);
const { findColumnRefByStablePath } = fn();

function makeBoard() {
  return {
    rows: [
      {
        id: 'row-1',
        stacks: [
          {
            id: 'stack-1',
            columns: [
              {
                id: 'col-1',
                cards: [
                  { id: 'card-A', content: 'A' },
                  { id: 'card-B', content: 'B' }
                ]
              },
              {
                id: 'col-2',
                cards: [
                  { id: 'card-C', content: 'C' }
                ]
              }
            ]
          }
        ]
      },
      {
        id: 'row-2',
        stacks: [
          {
            id: 'stack-2',
            columns: [
              {
                id: 'col-3',
                cards: [
                  { id: 'card-D', content: 'D' }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

describe('findColumnRefByStablePath cardId fallback', () => {
  it('finds the column containing a card by stable cardId when columnId is absent', () => {
    const board = makeBoard();
    const ref = findColumnRefByStablePath(board, { cardId: 'card-A' });
    expect(ref).toBeTruthy();
    expect(ref.column.id).toBe('col-1');
    expect(ref.columnIndex).toBe(0);
    expect(ref.stack.id).toBe('stack-1');
  });

  it('finds a card in a different stack/row via the same fallback', () => {
    const board = makeBoard();
    const ref = findColumnRefByStablePath(board, { cardId: 'card-D' });
    expect(ref).toBeTruthy();
    expect(ref.column.id).toBe('col-3');
    expect(ref.stack.id).toBe('stack-2');
  });

  it('returns null when no card with the given cardId exists', () => {
    const board = makeBoard();
    expect(findColumnRefByStablePath(board, { cardId: 'card-NONEXISTENT' })).toBe(null);
  });

  it('also matches the alternate `kid` field (legacy stable-id alias)', () => {
    const board = {
      rows: [{
        id: 'row-1', stacks: [{
          id: 'stack-1', columns: [{
            id: 'col-1', cards: [{ kid: 'kid-only-1' }]
          }]
        }]
      }]
    };
    const ref = findColumnRefByStablePath(board, { cardId: 'kid-only-1' });
    expect(ref).toBeTruthy();
    expect(ref.column.id).toBe('col-1');
  });

  it('still resolves by columnId when both columnId AND cardId are passed (existing path wins)', () => {
    const board = makeBoard();
    // card-A is in col-1; explicitly request col-2 by columnId — must
    // honor the columnId path, not the cardId fallback.
    const ref = findColumnRefByStablePath(board, { columnId: 'col-2', cardId: 'card-A' });
    expect(ref).toBeTruthy();
    expect(ref.column.id).toBe('col-2');
  });

  it('returns null when neither columnId nor cardId is provided', () => {
    const board = makeBoard();
    expect(findColumnRefByStablePath(board, { rowId: 'row-1' })).toBe(null);
    expect(findColumnRefByStablePath(board, {})).toBe(null);
  });

  it('does not crash on malformed board data (missing rows / stacks / columns / cards)', () => {
    expect(findColumnRefByStablePath(null, { cardId: 'x' })).toBe(null);
    expect(findColumnRefByStablePath({}, { cardId: 'x' })).toBe(null);
    expect(findColumnRefByStablePath({ rows: null }, { cardId: 'x' })).toBe(null);
    expect(findColumnRefByStablePath({ rows: [{}] }, { cardId: 'x' })).toBe(null);
    expect(findColumnRefByStablePath({ rows: [{ stacks: [{}] }] }, { cardId: 'x' })).toBe(null);
    expect(findColumnRefByStablePath({ rows: [{ stacks: [{ columns: [{}] }] }] }, { cardId: 'x' })).toBe(null);
  });
});
