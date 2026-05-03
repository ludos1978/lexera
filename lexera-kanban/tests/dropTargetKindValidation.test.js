// @vitest-environment jsdom

/**
 * Tests for the kind-aware drop-target gatekeeper:
 *   isDropTargetValidForKind(dragKind, mx, my)
 *
 * Pins the four rules the gatekeeper enforces (per TODOs-lexera.md):
 *   row    — only above/between/below other rows or in the empty board
 *   stack  — only before/between/after other stacks or in an empty row
 *   column — only before/between/after other columns or in an empty stack
 *   card   — only inside .column-cards (between cards)
 *
 * Header dock buttons (#btn-incoming/#btn-parked/#btn-archived/#btn-trash) are
 * universal valid targets for every kind except 'board'.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadDragDropHandlers() {
  const source = readFileSync(resolve(srcDir, 'dragdrop/dragDropHandlers.js'), 'utf-8');
  const wrappedSource = `${source}\nreturn LexeraDragDropHandlers;`;
  return new Function(wrappedSource)();
}

let DDH;

beforeAll(() => {
  DDH = loadDragDropHandlers();
});

beforeEach(() => {
  document.body.innerHTML = '';
});

/**
 * Stub document.elementFromPoint to return a specific element for a probe call.
 * The gatekeeper consults document.elementFromPoint(mx, my) to find the
 * hovered element; jsdom returns null without layout, so we override.
 */
function stubElementFromPoint(el) {
  document.elementFromPoint = () => el;
}

function makeBoardSkeleton() {
  document.body.innerHTML = '';
  const cc = document.createElement('div');
  cc.className = 'columns-container';
  const row = document.createElement('div');
  row.className = 'board-row';
  const rowContent = document.createElement('div');
  rowContent.className = 'board-row-content';
  const stack = document.createElement('div');
  stack.className = 'board-stack';
  const column = document.createElement('div');
  column.className = 'column';
  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'column-cards';
  const card = document.createElement('div');
  card.className = 'card';
  cardsContainer.appendChild(card);
  column.appendChild(cardsContainer);
  stack.appendChild(column);
  rowContent.appendChild(stack);
  row.appendChild(rowContent);
  cc.appendChild(row);
  document.body.appendChild(cc);
  return { cc, row, rowContent, stack, column, cardsContainer, card };
}

describe('isDropTargetValidForKind — row drag', () => {
  it('accepts hover on a board-row', () => {
    const { row } = makeBoardSkeleton();
    stubElementFromPoint(row);
    expect(DDH.isDropTargetValidForKind('row', 10, 10)).toBe(true);
  });

  it('accepts hover on a board-row descendant (target.closest(.board-row))', () => {
    const { card } = makeBoardSkeleton();
    stubElementFromPoint(card);
    // A card lives inside a row, so closest('.board-row') resolves to its parent
    expect(DDH.isDropTargetValidForKind('row', 10, 10)).toBe(true);
  });

  it('accepts hover on the empty .columns-container', () => {
    const { cc } = makeBoardSkeleton();
    stubElementFromPoint(cc);
    expect(DDH.isDropTargetValidForKind('row', 10, 10)).toBe(true);
  });

  it('rejects hover on an unrelated element outside the board', () => {
    const outside = document.createElement('div');
    outside.className = 'unrelated';
    document.body.appendChild(outside);
    stubElementFromPoint(outside);
    expect(DDH.isDropTargetValidForKind('row', 10, 10)).toBe(false);
  });

  it('accepts the same kinds for tree-row and board-row aliases', () => {
    const { row } = makeBoardSkeleton();
    stubElementFromPoint(row);
    expect(DDH.isDropTargetValidForKind('tree-row', 10, 10)).toBe(true);
    expect(DDH.isDropTargetValidForKind('board-row', 10, 10)).toBe(true);
  });
});

describe('isDropTargetValidForKind — stack drag', () => {
  it('accepts hover on a board-stack', () => {
    const { stack } = makeBoardSkeleton();
    stubElementFromPoint(stack);
    expect(DDH.isDropTargetValidForKind('stack', 10, 10)).toBe(true);
  });

  it('accepts hover on a board-row-content (empty row body)', () => {
    const { rowContent } = makeBoardSkeleton();
    stubElementFromPoint(rowContent);
    expect(DDH.isDropTargetValidForKind('stack', 10, 10)).toBe(true);
  });

  it('rejects hover on a node outside any row/stack', () => {
    const outside = document.createElement('div');
    outside.className = 'sidebar-misc';
    document.body.appendChild(outside);
    stubElementFromPoint(outside);
    expect(DDH.isDropTargetValidForKind('stack', 10, 10)).toBe(false);
  });
});

describe('isDropTargetValidForKind — column drag', () => {
  it('accepts hover on a column', () => {
    const { column } = makeBoardSkeleton();
    stubElementFromPoint(column);
    expect(DDH.isDropTargetValidForKind('column', 10, 10)).toBe(true);
  });

  it('accepts hover on a board-stack (drop into stack)', () => {
    const { stack } = makeBoardSkeleton();
    stubElementFromPoint(stack);
    expect(DDH.isDropTargetValidForKind('column', 10, 10)).toBe(true);
  });

  it('rejects hover on a row content with no stack ancestor', () => {
    // Build a row content with no stack inside
    const cc = document.createElement('div');
    cc.className = 'columns-container';
    const row = document.createElement('div');
    row.className = 'board-row';
    const rc = document.createElement('div');
    rc.className = 'board-row-content';
    row.appendChild(rc);
    cc.appendChild(row);
    document.body.appendChild(cc);
    stubElementFromPoint(rc);
    // Row body alone is NOT a valid column drop — columns must land in stacks
    expect(DDH.isDropTargetValidForKind('column', 10, 10)).toBe(false);
  });
});

describe('isDropTargetValidForKind — card drag', () => {
  it('accepts hover on a column-cards container', () => {
    const { cardsContainer } = makeBoardSkeleton();
    stubElementFromPoint(cardsContainer);
    expect(DDH.isDropTargetValidForKind('card', 10, 10)).toBe(true);
  });

  it('accepts hover on a card (descendant of column-cards)', () => {
    const { card } = makeBoardSkeleton();
    stubElementFromPoint(card);
    expect(DDH.isDropTargetValidForKind('card', 10, 10)).toBe(true);
  });

  it('rejects hover on a board-stack with no .column ancestor', () => {
    // Build an empty stack (no columns inside)
    const cc = document.createElement('div');
    cc.className = 'columns-container';
    const row = document.createElement('div');
    row.className = 'board-row';
    const rc = document.createElement('div');
    rc.className = 'board-row-content';
    const stack = document.createElement('div');
    stack.className = 'board-stack';
    rc.appendChild(stack);
    row.appendChild(rc);
    cc.appendChild(row);
    document.body.appendChild(cc);
    stubElementFromPoint(stack);
    // Stack alone (no column inside it) is NOT a valid card target
    expect(DDH.isDropTargetValidForKind('card', 10, 10)).toBe(false);
  });

  it('rejects hover on a row content with no column ancestor', () => {
    const cc = document.createElement('div');
    cc.className = 'columns-container';
    const row = document.createElement('div');
    row.className = 'board-row';
    const rc = document.createElement('div');
    rc.className = 'board-row-content';
    row.appendChild(rc);
    cc.appendChild(row);
    document.body.appendChild(cc);
    stubElementFromPoint(rc);
    expect(DDH.isDropTargetValidForKind('card', 10, 10)).toBe(false);
  });
});

describe('isDropTargetValidForKind — header dock buttons', () => {
  it('accepts header dock buttons for every non-board kind', () => {
    const btn = document.createElement('button');
    btn.id = 'btn-trash';
    document.body.appendChild(btn);
    stubElementFromPoint(btn);
    expect(DDH.isDropTargetValidForKind('row', 10, 10)).toBe(true);
    expect(DDH.isDropTargetValidForKind('stack', 10, 10)).toBe(true);
    expect(DDH.isDropTargetValidForKind('column', 10, 10)).toBe(true);
    expect(DDH.isDropTargetValidForKind('card', 10, 10)).toBe(true);
  });

  it('rejects header buttons for board drag (board kind has its own rules)', () => {
    const btn = document.createElement('button');
    btn.id = 'btn-incoming';
    document.body.appendChild(btn);
    stubElementFromPoint(btn);
    expect(DDH.isDropTargetValidForKind('board', 10, 10)).toBe(false);
  });
});

describe('isDropTargetValidForKind — board drag', () => {
  it('accepts hover on a board-item', () => {
    const item = document.createElement('div');
    item.className = 'board-item';
    document.body.appendChild(item);
    stubElementFromPoint(item);
    expect(DDH.isDropTargetValidForKind('board', 10, 10)).toBe(true);
  });

  it('rejects hover outside any board-item', () => {
    const item = document.createElement('div');
    item.className = 'random';
    document.body.appendChild(item);
    stubElementFromPoint(item);
    expect(DDH.isDropTargetValidForKind('board', 10, 10)).toBe(false);
  });
});

describe('isDropTargetValidForKind — kind cross-rejection', () => {
  // The four rules' core promise: a drag of one kind never accepts the
  // exclusive zones of another kind.
  it('rejects card-drag over a row-only zone', () => {
    // A row body alone (no column inside) is a stack target, NOT a card target
    const cc = document.createElement('div');
    cc.className = 'columns-container';
    const row = document.createElement('div');
    row.className = 'board-row';
    const rc = document.createElement('div');
    rc.className = 'board-row-content';
    row.appendChild(rc);
    cc.appendChild(row);
    document.body.appendChild(cc);
    stubElementFromPoint(rc);
    expect(DDH.isDropTargetValidForKind('card', 10, 10)).toBe(false);
  });

  it('rejects stack-drag over a board-item (sidebar board entry)', () => {
    const item = document.createElement('div');
    item.className = 'board-item';
    document.body.appendChild(item);
    stubElementFromPoint(item);
    expect(DDH.isDropTargetValidForKind('stack', 10, 10)).toBe(false);
  });

  it('rejects column-drag over a board-item', () => {
    const item = document.createElement('div');
    item.className = 'board-item';
    document.body.appendChild(item);
    stubElementFromPoint(item);
    expect(DDH.isDropTargetValidForKind('column', 10, 10)).toBe(false);
  });

  it('returns false for an unknown drag kind', () => {
    const { row } = makeBoardSkeleton();
    stubElementFromPoint(row);
    expect(DDH.isDropTargetValidForKind('mystery', 10, 10)).toBe(false);
  });

  it('returns false when elementFromPoint returns null', () => {
    document.elementFromPoint = () => null;
    expect(DDH.isDropTargetValidForKind('row', 10, 10)).toBe(false);
  });
});
