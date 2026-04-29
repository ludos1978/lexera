// @vitest-environment jsdom

/**
 * DOM-level tests for the card drag-drop target resolution path.
 *
 * These tests build real DOM (column-cards, cards, stacks, rows) and exercise:
 *   - resolveCardDropTarget(mx, my)   — hit-tests DOM elements at a coordinate
 *   - applyCardDropByPoint(source, mx, my) — runs the full drop pipeline
 *
 * This is the path that the workspace view uses when dropping cards.
 *
 * Why this file exists: the pure-function tests in mutations.test.js call
 * moveCard() directly with hand-crafted source/target objects — they skip the
 * entire DOM hit-test + drop-target-resolution pipeline, so bugs in that
 * pipeline (e.g. workspace card reorder failing) pass tests while broken in
 * production.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// ═══════════════════════════════════════════════════════════════════════════
// Test harness
// ═══════════════════════════════════════════════════════════════════════════

function loadDragDropHandlers() {
  const source = readFileSync(resolve(srcDir, 'dragdrop/dragDropHandlers.js'), 'utf-8');
  // Strip the trailing `window.LexeraDragDropHandlers = ...` assignment so the
  // IIFE's return value is what we get; execute in a Function scope.
  const wrappedSource = `
    ${source}
    return LexeraDragDropHandlers;
  `;
  const factory = new Function(wrappedSource);
  return factory();
}

function makeCard(id, content) {
  return { id: id, content: content, checked: false, kid: null };
}
function makeColumn(id, title, cards) {
  return { id: id, title: title, cards: cards || [], include_source: null };
}
function makeStack(id, title, columns) {
  return { id: id, title: title, columns: columns || [] };
}
function makeRow(id, title, stacks) {
  return { id: id, title: title, stacks: stacks || [] };
}
function makeBoard(rows) {
  return { valid: true, title: 'Test Board', columns: [], rows: rows || [] };
}

/**
 * Builds a real DOM representation of a board in jsdom, using the same
 * classes/attributes that dragDropHandlers.resolveCardDropTarget expects.
 *
 * Each element gets a fixed geometry via getBoundingClientRect override, since
 * jsdom doesn't compute layout.
 */
function buildBoardDom(board, { boardId = 'test-board' } = {}) {
  document.body.innerHTML = '';

  // Sidebar board list (required by dragDropHandlers — may be empty)
  const boardList = document.createElement('div');
  boardList.id = 'board-list';
  boardList.className = 'board-list';
  document.body.appendChild(boardList);

  // Main columns container
  const columnsContainer = document.createElement('div');
  columnsContainer.id = 'columns-container';
  columnsContainer.className = 'columns-container';
  document.body.appendChild(columnsContainer);

  // Geometry layout: stack rows vertically, stacks horizontally inside a row,
  // columns horizontally inside a stack, cards vertically inside column-cards.
  const ROW_H = 400, STACK_W = 300, COL_W = 280, CARD_H = 40, HEADER_H = 30;
  let flatColIdx = 0;
  const rects = []; // { el, rect }
  let yOffset = 0;

  for (let r = 0; r < board.rows.length; r++) {
    const row = board.rows[r];
    const rowEl = document.createElement('div');
    rowEl.className = 'board-row';
    rowEl.setAttribute('data-row-index', String(r));
    rowEl.setAttribute('data-row-id', row.id);
    const rowRect = { left: 0, top: yOffset, right: 1200, bottom: yOffset + ROW_H, width: 1200, height: ROW_H };
    rects.push({ el: rowEl, rect: rowRect });

    const rowContent = document.createElement('div');
    rowContent.className = 'board-row-content';
    let stackX = 0;
    for (let s = 0; s < (row.stacks || []).length; s++) {
      const stack = row.stacks[s];
      const stackEl = document.createElement('div');
      stackEl.className = 'board-stack';
      stackEl.setAttribute('data-row-index', String(r));
      stackEl.setAttribute('data-stack-index', String(s));
      stackEl.setAttribute('data-row-id', row.id);
      stackEl.setAttribute('data-stack-id', stack.id);
      const stackRect = { left: stackX, top: yOffset + HEADER_H, right: stackX + STACK_W, bottom: yOffset + ROW_H, width: STACK_W, height: ROW_H - HEADER_H };
      rects.push({ el: stackEl, rect: stackRect });

      let colX = stackX;
      for (let c = 0; c < (stack.columns || []).length; c++) {
        const col = stack.columns[c];
        const colEl = document.createElement('div');
        colEl.className = 'column';
        colEl.setAttribute('data-col-index', String(flatColIdx));
        colEl.setAttribute('data-col-local-index', String(c));
        colEl.setAttribute('data-row-id', row.id);
        colEl.setAttribute('data-stack-id', stack.id);
        colEl.setAttribute('data-column-id', col.id);
        const colRect = { left: colX, top: yOffset + HEADER_H, right: colX + COL_W, bottom: yOffset + ROW_H, width: COL_W, height: ROW_H - HEADER_H };
        rects.push({ el: colEl, rect: colRect });

        const cardsEl = document.createElement('div');
        cardsEl.className = 'column-cards';
        cardsEl.setAttribute('data-col-index', String(flatColIdx));
        cardsEl.setAttribute('data-row-id', row.id);
        cardsEl.setAttribute('data-stack-id', stack.id);
        cardsEl.setAttribute('data-column-id', col.id);
        const cardsTop = yOffset + HEADER_H + 20; // extra for column header
        const cardsRect = { left: colX, top: cardsTop, right: colX + COL_W, bottom: yOffset + ROW_H, width: COL_W, height: (yOffset + ROW_H) - cardsTop };
        rects.push({ el: cardsEl, rect: cardsRect });

        let cardY = cardsTop;
        let visibleIdx = 0;
        for (let k = 0; k < col.cards.length; k++) {
          const card = col.cards[k];
          if (card.content && card.content.indexOf('#hidden-internal-deleted') !== -1) continue;
          const cardEl = document.createElement('div');
          cardEl.className = 'card';
          cardEl.setAttribute('data-col-index', String(flatColIdx));
          cardEl.setAttribute('data-card-index', String(visibleIdx));
          cardEl.setAttribute('data-card-id', card.id);
          cardEl.textContent = card.content;
          const cardRect = { left: colX, top: cardY, right: colX + COL_W, bottom: cardY + CARD_H, width: COL_W, height: CARD_H };
          rects.push({ el: cardEl, rect: cardRect });
          cardsEl.appendChild(cardEl);
          cardY += CARD_H;
          visibleIdx++;
        }
        colEl.appendChild(cardsEl);
        stackEl.appendChild(colEl);
        colX += COL_W;
        flatColIdx++;
      }
      rowContent.appendChild(stackEl);
      stackX += STACK_W;
    }
    rowEl.appendChild(rowContent);
    columnsContainer.appendChild(rowEl);
    yOffset += ROW_H;
  }

  // Install getBoundingClientRect stubs so hit-testing works in jsdom
  for (const { el, rect } of rects) {
    el.getBoundingClientRect = () => rect;
  }
  // The columns container itself needs a rect for the geometry cache walk
  columnsContainer.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: yOffset, width: 1200, height: yOffset });
  boardList.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });

  return { columnsContainer, boardList };
}

function makeDeps({ board, activeBoardId = 'test-board', moveCardSpy, tagCardSpy }) {
  return {
    getElColumnsContainer: () => document.getElementById('columns-container'),
    getElBoardList: () => document.getElementById('board-list'),
    getActiveBoardId: () => activeBoardId,
    getFullBoardData: () => board,
    getBoardHierarchyRows: () => (board && board.rows) || [],
    moveCard: moveCardSpy || vi.fn().mockResolvedValue(),
    tagCard: tagCardSpy || vi.fn(),
    logFrontendIssue: () => {},
    lexeraLog: () => {},
    // Drop zone indicator stubs
    insertDropZoneIndicators: () => {},
    removeDropZoneIndicators: () => {},
    highlightDropZoneIndicator: () => {},
    clearDropZoneIndicatorHighlights: () => {},
    insertStackDropZones: () => {},
    removeStackDropZones: () => {},
    // Other no-op deps
    vsMaterialiseAll: () => {},
    vsRestoreAfterDrag: () => {},
    poll: () => {},
    findFullDataRow: () => null,
    findFullDataStack: () => null,
    findFullColumnIndexInStack: () => -1,
    findFullDataStackIndex: () => -1,
    removeEmptyStacksAndRows: () => {},
    persistBoardMutation: () => Promise.resolve(),
    pushUndo: () => {},
    applyInternalHiddenTag: (t) => t,
    isCanvasBoardLayout: () => false,
    isHorizontalCanvasStackElement: () => false,
    getCanvasStackDropApi: () => ({
      resolveCanvasStackDropTarget: () => null,
      applyCanvasDropPositionToStack: (_, __, ___, ____, s) => s,
    }),
    getCanvasDomApi: () => ({
      getCanvasRowContentNodeFromDropTarget: (_, fb) => fb,
    }),
    getCanvasPositionFromViewportPoint: () => ({ x: 0, y: 0 }),
    setRowHiddenTag: () => Promise.resolve(),
    setStackHiddenTag: () => Promise.resolve(),
    reorderRows: () => {},
    moveStack: () => {},
    moveStackAcrossBoards: () => Promise.resolve(),
    moveRowAcrossBoards: () => Promise.resolve(),
    moveColumnAcrossBoards: () => Promise.resolve(),
    moveColumnWithinBoard: () => {},
    moveColumnToExistingStack: () => {},
    moveColumnToNewStack: () => {},
    reorderBoards: () => {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests: resolveCardDropTarget
// ═══════════════════════════════════════════════════════════════════════════

let DDH;

beforeAll(() => {
  DDH = loadDragDropHandlers();
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('resolveCardDropTarget — drop target hit-testing', () => {
  it('returns a main-column target when hovering over a column-cards container', () => {
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('col-1', 'Col A', [makeCard('card-a', 'A'), makeCard('card-b', 'B')]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    DDH.init(makeDeps({ board }));
    // Simulate an active card drag so isCardDrag is true (not strictly needed
    // for the main-column branch, but matches production state)
    DDH.setCardDrag({ started: true, el: null, boardId: 'test-board', flatColIndex: 0, cardIndex: 0 });

    // Click in the middle of the column-cards region for column 0
    // column-cards rect is left 0..280, top 50..400 based on geometry above
    const target = DDH.resolveCardDropTarget(100, 100);
    expect(target).toBeTruthy();
    expect(target.kind).toBe('main');
    expect(target.flatColIndex).toBe(0);
    expect(target.columnId).toBe('col-1');

    DDH.setCardDrag(null);
  });

  it('returns a main-column target when the column contains multiple cards', () => {
    // This is the exact scenario the user reported: reorder within a column
    // in the workspace view
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('col-1', 'Col A', [
            makeCard('card-a', 'A'),
            makeCard('card-b', 'B'),
            makeCard('card-c', 'C'),
          ]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    DDH.init(makeDeps({ board }));
    DDH.setCardDrag({ started: true, el: null, boardId: 'test-board', flatColIndex: 0, cardIndex: 0 });

    // Hover in the middle of column-cards (between card B and C)
    const target = DDH.resolveCardDropTarget(100, 130);
    expect(target).toBeTruthy();
    expect(target.kind).toBe('main');
    expect(target.flatColIndex).toBe(0);
    expect(typeof target.insertIdx).toBe('number');
    expect(target.insertIdx).toBeGreaterThanOrEqual(0);

    DDH.setCardDrag(null);
  });

  it('returns null (not a stack target) when hovering over a stack region outside any column', () => {
    // A card drag hovering over a stack (but not inside any column-cards) must
    // NOT resolve to a stack — per the drop-target hierarchy rules, cards can
    // only land on columns.
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack A', [
          makeColumn('col-1', 'Col', [makeCard('card-a', 'A')]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    DDH.init(makeDeps({ board }));
    DDH.setCardDrag({ started: true, el: null, boardId: 'test-board', flatColIndex: 0, cardIndex: 0 });

    // Hover ABOVE all columns (in the stack header band, above column-cards):
    // column-cards top is 50; stack top is 30; so y=35 is inside the stack but
    // above all column-cards regions.
    const target = DDH.resolveCardDropTarget(100, 35);
    // Old behavior: returned a 'main' target with stackIndex. Our fix: null
    // because cards are only allowed on columns/between cards.
    if (target) {
      expect(target.kind).not.toBe('main');
      expect(typeof target.stackIndex).not.toBe('number');
    }

    DDH.setCardDrag(null);
  });

  it('returns null when hovering in empty space outside any column', () => {
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('col-1', 'Col', [makeCard('card-a', 'A')]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    DDH.init(makeDeps({ board }));
    DDH.setCardDrag({ started: true, el: null, boardId: 'test-board', flatColIndex: 0, cardIndex: 0 });

    // Far below any row
    const target = DDH.resolveCardDropTarget(100, 10000);
    expect(target).toBeNull();

    DDH.setCardDrag(null);
  });

  it('finds the correct column when there are multiple columns side-by-side', () => {
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('col-left', 'Left', [makeCard('card-a', 'A')]),
          makeColumn('col-right', 'Right', [makeCard('card-b', 'B')]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    DDH.init(makeDeps({ board }));
    DDH.setCardDrag({ started: true, el: null, boardId: 'test-board', flatColIndex: 0, cardIndex: 0 });

    // Left column is x=0..280, right is 0..560? Actually columns stack inside
    // a stack at stackX + colOffset. In our geometry, stack width 300 but
    // columns each 280 wide starting at stackX. Left col: 0..280. Right col:
    // 280..560. Hit right column at x=350.
    const targetLeft = DDH.resolveCardDropTarget(100, 100);
    expect(targetLeft.flatColIndex).toBe(0);
    expect(targetLeft.columnId).toBe('col-left');

    const targetRight = DDH.resolveCardDropTarget(350, 100);
    expect(targetRight.flatColIndex).toBe(1);
    expect(targetRight.columnId).toBe('col-right');

    DDH.setCardDrag(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests: applyCardDropByPoint (the full drop pipeline)
// ═══════════════════════════════════════════════════════════════════════════

describe('applyCardDropByPoint — end-to-end drop pipeline', () => {
  it('calls moveCard with valid source+target when dropping inside a column', async () => {
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('col-1', 'Col', [makeCard('card-a', 'A'), makeCard('card-b', 'B')]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    const moveCardSpy = vi.fn().mockResolvedValue();
    DDH.init(makeDeps({ board, moveCardSpy }));
    DDH.setCardDrag({ started: true, el: null, boardId: 'test-board', flatColIndex: 0, cardIndex: 0, cardId: 'card-a' });

    const source = {
      boardId: 'test-board',
      flatColIndex: 0,
      cardIndex: 0,
      cardId: 'card-a',
      indexMode: 'display',
      cardIndexMode: 'visible',
    };
    // Drop in the middle of the column-cards
    const handled = DDH.applyCardDropByPoint(source, 100, 100);
    expect(handled).toBe(true);
    expect(moveCardSpy).toHaveBeenCalledTimes(1);

    const [calledSource, calledTarget] = moveCardSpy.mock.calls[0];
    expect(calledSource.cardId).toBe('card-a');
    expect(calledTarget.kind).toBe('main');
    expect(calledTarget.flatColIndex).toBe(0);
    expect(calledTarget.columnId).toBe('col-1');
    expect(typeof calledTarget.insertIdx).toBe('number');

    DDH.setCardDrag(null);
  });

  it('calls moveCard with the destination column when dropping cross-column', async () => {
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('col-left', 'Left', [makeCard('card-a', 'A'), makeCard('card-b', 'B')]),
          makeColumn('col-right', 'Right', [makeCard('card-c', 'C')]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    const moveCardSpy = vi.fn().mockResolvedValue();
    DDH.init(makeDeps({ board, moveCardSpy }));
    DDH.setCardDrag({ started: true, el: null, boardId: 'test-board', flatColIndex: 0, cardIndex: 0, cardId: 'card-a' });

    const source = {
      boardId: 'test-board',
      flatColIndex: 0,
      cardIndex: 0,
      cardId: 'card-a',
      indexMode: 'display',
      cardIndexMode: 'visible',
    };
    // Drop onto the right column
    const handled = DDH.applyCardDropByPoint(source, 350, 100);
    expect(handled).toBe(true);

    const [, calledTarget] = moveCardSpy.mock.calls[0];
    expect(calledTarget.flatColIndex).toBe(1);
    expect(calledTarget.columnId).toBe('col-right');

    DDH.setCardDrag(null);
  });

  it('returns false (no move) when dropping outside any valid target', () => {
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('col-1', 'Col', [makeCard('card-a', 'A')]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    const moveCardSpy = vi.fn().mockResolvedValue();
    DDH.init(makeDeps({ board, moveCardSpy }));
    DDH.setCardDrag({ started: true, el: null, boardId: 'test-board', flatColIndex: 0, cardIndex: 0, cardId: 'card-a' });

    const source = {
      boardId: 'test-board',
      flatColIndex: 0,
      cardIndex: 0,
      cardId: 'card-a',
      indexMode: 'display',
      cardIndexMode: 'visible',
    };
    // Drop far outside any element
    const handled = DDH.applyCardDropByPoint(source, 100, 10000);
    expect(handled).toBe(false);
    expect(moveCardSpy).not.toHaveBeenCalled();

    DDH.setCardDrag(null);
  });

  // Regression: finishCardDrag set the source's inline style.display to
  // 'none' before invoking moveCard so the card wouldn't flash at its old
  // position during the async DOM rebuild. On the failure paths (no
  // valid drop target, or moveCard rejecting) the rebuild never ran, so
  // the source kept the inline display:none and the user saw the card
  // "disappear". Both paths must restore visibility.

  it('restores source visibility when the drop has no valid target', () => {
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('col-1', 'Col', [makeCard('card-a', 'A')]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    const moveCardSpy = vi.fn().mockResolvedValue();
    DDH.init(makeDeps({ board, moveCardSpy }));

    const sourceEl = document.querySelector('.card[data-card-id="card-a"]');
    expect(sourceEl).toBeTruthy();
    DDH.setCardDrag({
      started: true, el: sourceEl, boardId: 'test-board',
      flatColIndex: 0, cardIndex: 0, cardId: 'card-a'
    });

    // Drop far outside any drop target.
    DDH.finishCardDrag(100, 10000);

    expect(sourceEl.style.display).not.toBe('none');
    expect(moveCardSpy).not.toHaveBeenCalled();
  });

  it('restores source visibility when moveCard rejects', async () => {
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('col-1', 'Col', [makeCard('card-a', 'A'), makeCard('card-b', 'B')]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    const moveCardSpy = vi.fn().mockRejectedValue(new Error('boom'));
    DDH.init(makeDeps({ board, moveCardSpy }));

    const sourceEl = document.querySelector('.card[data-card-id="card-a"]');
    expect(sourceEl).toBeTruthy();
    DDH.setCardDrag({
      started: true, el: sourceEl, boardId: 'test-board',
      flatColIndex: 0, cardIndex: 0, cardId: 'card-a'
    });

    // Drop inside the same column (valid target → moveCard runs but rejects).
    DDH.finishCardDrag(100, 100);

    expect(moveCardSpy).toHaveBeenCalledTimes(1);
    // Allow the rejection's catch handler to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sourceEl.style.display).not.toBe('none');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests: drop target hierarchy rules
// ═══════════════════════════════════════════════════════════════════════════

describe('drop target hierarchy rules — type must match allowed drop targets', () => {
  it('card drags never resolve to a main stack target (cards go on columns only)', () => {
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('col-1', 'Col', [makeCard('card-a', 'A')]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    DDH.init(makeDeps({ board }));
    DDH.setCardDrag({ started: true, el: null, boardId: 'test-board', flatColIndex: 0, cardIndex: 0 });

    // Hover at every point inside a board-stack but outside column-cards
    // (the header band): none should produce a 'main' target with stackIndex.
    for (let y = 30; y < 50; y++) {
      const target = DDH.resolveCardDropTarget(100, y);
      if (target && target.kind === 'main') {
        expect(typeof target.stackIndex).not.toBe('number');
      }
    }

    DDH.setCardDrag(null);
  });

  it('card drags never resolve to a main row target (cards go on columns only)', () => {
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('col-1', 'Col', [makeCard('card-a', 'A')]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    DDH.init(makeDeps({ board }));
    DDH.setCardDrag({ started: true, el: null, boardId: 'test-board', flatColIndex: 0, cardIndex: 0 });

    // Hover in the row area but outside any stack or column
    const target = DDH.resolveCardDropTarget(1100, 200); // far right of row
    if (target && target.kind === 'main') {
      // Must NOT be a row-only target: a 'main' target must have a flatColIndex
      // (i.e. point at a column-cards container), not just a rowIndex.
      expect(typeof target.flatColIndex).toBe('number');
    }

    DDH.setCardDrag(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests: full mouse-event-driven drag flow (mousedown → mousemove → mouseup)
//
// These tests bind the real dndListeners, simulate mouse events on real card
// elements, and verify that moveCard is called with the expected source and
// target. This exercises the FULL pipeline — the exact path a user's drag
// takes in production — so that bugs in any layer (listener wiring, cardDrag
// state construction, drop target resolution, apply) will be caught.
// ═══════════════════════════════════════════════════════════════════════════

function loadDndListeners() {
  const source = readFileSync(resolve(srcDir, 'dragdrop/dndListeners.js'), 'utf-8');
  const wrappedSource = `
    ${source}
    return LexeraDndListeners;
  `;
  const factory = new Function(wrappedSource);
  return factory();
}

function dispatchMouse(target, type, x, y, opts = {}) {
  // jsdom MouseEvent supports clientX/clientY via init dict
  const ev = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
    ...opts,
  });
  target.dispatchEvent(ev);
  return ev;
}

function addCardDragHandles() {
  // The real app adds a .card-drag-handle inside each card. Our test DOM
  // doesn't, so we add them so mousedown on a card resolves to a grip.
  document.querySelectorAll('.card').forEach((cardEl) => {
    if (cardEl.querySelector('.card-drag-handle')) return;
    const handle = document.createElement('div');
    handle.className = 'card-drag-handle';
    // Inherit the card's own rect so hit-testing works (we dispatch events on
    // the card element, and closest('.card-drag-handle') finds this child).
    handle.getBoundingClientRect = cardEl.getBoundingClientRect.bind(cardEl);
    cardEl.insertBefore(handle, cardEl.firstChild);
  });
}

describe('full mouse flow — mousedown → mousemove → mouseup produces moveCard', () => {
  let DndListeners;

  beforeAll(() => {
    DndListeners = loadDndListeners();
  });

  it('reorder within a column: drag card-a down past card-b, drop below it', async () => {
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('col-1', 'Col', [
            makeCard('card-a', 'A'),
            makeCard('card-b', 'B'),
            makeCard('card-c', 'C'),
          ]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    addCardDragHandles();

    const moveCardSpy = vi.fn().mockResolvedValue();
    const deps = makeDeps({ board, moveCardSpy });
    DDH.init(deps);

    DndListeners.init({
      ...deps,
      getDragDropHandlers: () => DDH,
      toTopFramePoint: (win, x, y) => ({ x, y }),
      startCrossViewBridge: DDH.startCrossViewBridge,
      stopCrossViewBridge: DDH.stopCrossViewBridge,
      startCardDrag: DDH.startCardDrag,
      finishCardDrag: DDH.finishCardDrag,
      cleanupCardDrag: DDH.cleanupCardDrag,
      updateCardDropTarget: DDH.updateCardDropTarget,
      clearPtrDropIndicators: DDH.clearPtrDropIndicators,
      lockBoardLayoutForDrag: DDH.lockBoardLayoutForDrag,
      unlockBoardLayoutForDrag: DDH.unlockBoardLayoutForDrag,
      cacheDropTargetGeometry: DDH.cacheDropTargetGeometry,
      clearDropTargetGeometryCache: DDH.clearDropTargetGeometryCache,
      executePtrDrop: DDH.executePtrDrop,
      getPtrDragLabel: DDH.getPtrDragLabel,
      updatePtrDropTarget: DDH.updatePtrDropTarget,
      resolveHeaderDropTag: DDH.resolveHeaderDropTag,
      resolveCanvasRowContentDropTarget: DDH.resolveCanvasRowContentDropTarget,
      getCanvasRowContentNodeFromDropTarget: DDH.getCanvasRowContentNodeFromDropTarget,
      getCanvasDropPositionInRowContent: DDH.getCanvasDropPositionInRowContent,
    });
    DndListeners.bindAll();

    // Find the first card
    const cardA = document.querySelector('.card[data-card-id="card-a"]');
    expect(cardA).toBeTruthy();
    const gripA = cardA.querySelector('.card-drag-handle');
    expect(gripA).toBeTruthy();

    const startRect = cardA.getBoundingClientRect();
    const startX = startRect.left + 10;
    const startY = startRect.top + 10;

    // mousedown on card-a's drag handle (grip is where real users click)
    dispatchMouse(gripA, 'mousedown', startX, startY);
    expect(DDH.getCardDrag()).toBeTruthy();
    expect(DDH.getCardDrag().cardId).toBe('card-a');
    expect(DDH.getCardDrag().started).toBe(false);

    // mousemove beyond threshold (5px) triggers startCardDrag
    dispatchMouse(document, 'mousemove', startX + 20, startY + 20);
    expect(DDH.getCardDrag().started).toBe(true);

    // Drop below card-c at the end of the column
    const cardC = document.querySelector('.card[data-card-id="card-c"]');
    const cRect = cardC.getBoundingClientRect();
    const dropX = cRect.left + 10;
    const dropY = cRect.bottom + 5; // just below card-c, still inside column-cards

    dispatchMouse(document, 'mouseup', dropX, dropY);

    // Verify moveCard was called correctly
    expect(moveCardSpy).toHaveBeenCalledTimes(1);
    const [src, tgt] = moveCardSpy.mock.calls[0];
    expect(src.cardId).toBe('card-a');
    expect(src.flatColIndex).toBe(0);
    expect(tgt.kind).toBe('main');
    expect(tgt.flatColIndex).toBe(0); // same column
    // Dropped below the last card — insert at the end (note: the source card
    // is visually hidden during drop resolution, so it isn't counted).
    expect(tgt.insertIdx).toBeGreaterThanOrEqual(2);

    // Drag state must be cleared
    expect(DDH.getCardDrag()).toBeNull();
  });

  it('cross-column drag: drop card-a onto another column', async () => {
    const board = makeBoard([
      makeRow('r1', 'Row', [
        makeStack('s1', 'Stack', [
          makeColumn('col-left', 'Left', [makeCard('card-a', 'A'), makeCard('card-b', 'B')]),
          makeColumn('col-right', 'Right', [makeCard('card-c', 'C')]),
        ]),
      ]),
    ]);
    buildBoardDom(board);
    addCardDragHandles();

    const moveCardSpy = vi.fn().mockResolvedValue();
    const deps = makeDeps({ board, moveCardSpy });
    DDH.init(deps);

    DndListeners.init({
      ...deps,
      getDragDropHandlers: () => DDH,
      toTopFramePoint: (win, x, y) => ({ x, y }),
      startCrossViewBridge: DDH.startCrossViewBridge,
      stopCrossViewBridge: DDH.stopCrossViewBridge,
      startCardDrag: DDH.startCardDrag,
      finishCardDrag: DDH.finishCardDrag,
      cleanupCardDrag: DDH.cleanupCardDrag,
      updateCardDropTarget: DDH.updateCardDropTarget,
      clearPtrDropIndicators: DDH.clearPtrDropIndicators,
      lockBoardLayoutForDrag: DDH.lockBoardLayoutForDrag,
      unlockBoardLayoutForDrag: DDH.unlockBoardLayoutForDrag,
      cacheDropTargetGeometry: DDH.cacheDropTargetGeometry,
      clearDropTargetGeometryCache: DDH.clearDropTargetGeometryCache,
      executePtrDrop: DDH.executePtrDrop,
      getPtrDragLabel: DDH.getPtrDragLabel,
      updatePtrDropTarget: DDH.updatePtrDropTarget,
      resolveHeaderDropTag: DDH.resolveHeaderDropTag,
      resolveCanvasRowContentDropTarget: DDH.resolveCanvasRowContentDropTarget,
      getCanvasRowContentNodeFromDropTarget: DDH.getCanvasRowContentNodeFromDropTarget,
      getCanvasDropPositionInRowContent: DDH.getCanvasDropPositionInRowContent,
    });
    DndListeners.bindAll();

    const cardA = document.querySelector('.card[data-card-id="card-a"]');
    const gripA = cardA.querySelector('.card-drag-handle');
    const startRect = cardA.getBoundingClientRect();
    dispatchMouse(gripA, 'mousedown', startRect.left + 10, startRect.top + 10);
    dispatchMouse(document, 'mousemove', startRect.left + 20, startRect.top + 20);

    // Drop on card-c in the right column
    const cardC = document.querySelector('.card[data-card-id="card-c"]');
    const cRect = cardC.getBoundingClientRect();
    dispatchMouse(document, 'mouseup', cRect.left + 10, cRect.top + 5);

    expect(moveCardSpy).toHaveBeenCalledTimes(1);
    const [src, tgt] = moveCardSpy.mock.calls[0];
    expect(src.cardId).toBe('card-a');
    expect(tgt.kind).toBe('main');
    expect(tgt.flatColIndex).toBe(1); // target is right column
    expect(tgt.columnId).toBe('col-right');
  });
});
