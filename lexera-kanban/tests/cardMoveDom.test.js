// @vitest-environment jsdom

/**
 * DOM-level card move tests — verify that mutations produce visible DOM changes.
 *
 * These tests load the real rendering pipeline (buildCardElement, buildColumnElement,
 * refreshTargetedElements) and verify the DOM output matches expectations after
 * each mutation type.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// ═══════════════════════════════════════════════════════════════════════════
// Minimal board renderer — extracts just enough from app.js to render and
// mutate board DOM, then verify the result.
// ═══════════════════════════════════════════════════════════════════════════

function createBoardRenderer() {
  // Load globals needed by rendering code
  new Function(readFileSync(resolve(srcDir, 'titleHelpers.js'), 'utf-8'))();
  new Function(readFileSync(resolve(srcDir, 'tagSystem.js'), 'utf-8'))();

  // State
  var fullBoardData = null;
  var activeBoardId = null;
  var columnsContainer = document.createElement('div');
  columnsContainer.id = 'columns-container';
  columnsContainer.className = 'columns-container new-format';
  document.body.appendChild(columnsContainer);

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

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Minimal renderer: produces column DOM from fullBoardData ──────────

  function buildCardEl(card, colIndex, cardIndex) {
    var el = document.createElement('div');
    el.className = 'card';
    el.setAttribute('data-col-index', String(colIndex));
    el.setAttribute('data-card-index', String(cardIndex));
    el.setAttribute('data-card-id', card.id || '');
    el.innerHTML = '<div class="card-content">' + escapeHtml(card.content) + '</div>';
    return el;
  }

  function buildColumnEl(col, colIndex) {
    var el = document.createElement('div');
    el.className = 'column';
    el.setAttribute('data-col-index', String(colIndex));
    el.setAttribute('data-column-id', col.id || '');

    var header = document.createElement('div');
    header.className = 'column-header';
    header.innerHTML = '<span class="column-title">' + escapeHtml(col.title) + '</span>' +
      '<span class="column-count">' + col.cards.length + '</span>';
    el.appendChild(header);

    var cardsContainer = document.createElement('div');
    cardsContainer.className = 'column-cards';
    cardsContainer.setAttribute('data-col-index', String(colIndex));
    var visibleIdx = 0;
    for (var i = 0; i < col.cards.length; i++) {
      var card = col.cards[i];
      if (card.content && card.content.indexOf('#hidden-internal-deleted') !== -1) continue;
      cardsContainer.appendChild(buildCardEl(card, colIndex, visibleIdx));
      visibleIdx++;
    }
    el.appendChild(cardsContainer);
    return el;
  }

  function renderBoard() {
    columnsContainer.innerHTML = '';
    if (!fullBoardData || !fullBoardData.rows) return;
    var flatIdx = 0;
    for (var r = 0; r < fullBoardData.rows.length; r++) {
      var row = fullBoardData.rows[r];
      var rowEl = document.createElement('div');
      rowEl.className = 'board-row';
      rowEl.setAttribute('data-row-index', String(r));
      rowEl.setAttribute('data-row-id', row.id || '');

      var rowContent = document.createElement('div');
      rowContent.className = 'board-row-content';
      for (var s = 0; s < (row.stacks || []).length; s++) {
        var stack = row.stacks[s];
        var stackEl = document.createElement('div');
        stackEl.className = 'board-stack';
        stackEl.setAttribute('data-stack-index', String(s));
        stackEl.setAttribute('data-stack-id', stack.id || '');
        stackEl.setAttribute('data-row-index', String(r));

        for (var c = 0; c < (stack.columns || []).length; c++) {
          stackEl.appendChild(buildColumnEl(stack.columns[c], flatIdx));
          flatIdx++;
        }
        rowContent.appendChild(stackEl);
      }
      rowEl.appendChild(rowContent);
      columnsContainer.appendChild(rowEl);
    }
  }

  function refreshColumn(flatColIndex) {
    var col = getColumnByFlatIndex(flatColIndex);
    if (!col) return;
    var oldColEl = columnsContainer.querySelector('.column[data-col-index="' + flatColIndex + '"]');
    if (!oldColEl) return;
    var newColEl = buildColumnEl(col, flatColIndex);
    oldColEl.parentNode.replaceChild(newColEl, oldColEl);
  }

  function getVisibleNodes(cardsEl) {
    return cardsEl ? cardsEl.querySelectorAll(':scope > .card, :scope > .vs-placeholder') : [];
  }

  function setVisibleNodeIndex(node, index) {
    if (!node) return;
    if (node.classList.contains('vs-placeholder')) {
      node.setAttribute('data-vs-card-index', String(index));
      return;
    }
    node.setAttribute('data-card-index', String(index));
  }

  function reindexVisibleNodes(cardsEl) {
    var nodes = getVisibleNodes(cardsEl);
    for (var i = 0; i < nodes.length; i++) {
      setVisibleNodeIndex(nodes[i], i);
    }
  }

  function buildPlaceholder(flatColIndex, cardIndex, card) {
    var el = document.createElement('div');
    el.className = 'vs-placeholder';
    el.setAttribute('data-vs-col-index', String(flatColIndex));
    el.setAttribute('data-vs-card-index', String(cardIndex));
    el.setAttribute('data-vs-card-id', card && card.id ? card.id : '');
    return el;
  }

  function removeCard(flatColIndex, cardIndex) {
    var cardsEl = columnsContainer.querySelector('.column-cards[data-col-index="' + flatColIndex + '"]');
    if (!cardsEl) return;
    var cards = getVisibleNodes(cardsEl);
    if (cardIndex >= 0 && cardIndex < cards.length) {
      cards[cardIndex].remove();
      reindexVisibleNodes(cardsEl);
    }
    // Update count badge
    var countEl = cardsEl.closest('.column').querySelector('.column-count');
    if (countEl) countEl.textContent = String(getVisibleNodes(cardsEl).length);
  }

  function insertCard(flatColIndex, cardIndex) {
    var col = getColumnByFlatIndex(flatColIndex);
    if (!col) return;
    var cardsEl = columnsContainer.querySelector('.column-cards[data-col-index="' + flatColIndex + '"]');
    if (!cardsEl) return;
    // Find the visible card at the data index
    var visibleCards = col.cards.filter(function (c) {
      return !c.content || c.content.indexOf('#hidden-internal-deleted') === -1;
    });
    var card = visibleCards[cardIndex];
    if (!card) return;
    var newEl = buildCardEl(card, flatColIndex, cardIndex);
    var existingCards = getVisibleNodes(cardsEl);
    if (cardIndex < existingCards.length) {
      cardsEl.insertBefore(newEl, existingCards[cardIndex]);
    } else {
      cardsEl.appendChild(newEl);
    }
    reindexVisibleNodes(cardsEl);
    // Update count
    var countEl = cardsEl.closest('.column').querySelector('.column-count');
    if (countEl) countEl.textContent = String(getVisibleNodes(cardsEl).length);
  }

  function getColumnByFlatIndex(flatIndex) {
    if (!fullBoardData || !fullBoardData.rows) return null;
    var idx = 0;
    for (var r = 0; r < fullBoardData.rows.length; r++) {
      var stacks = fullBoardData.rows[r].stacks || [];
      for (var s = 0; s < stacks.length; s++) {
        var cols = stacks[s].columns || [];
        for (var c = 0; c < cols.length; c++) {
          if (idx === flatIndex) return cols[c];
          idx++;
        }
      }
    }
    return null;
  }

  // ── refreshTargetedElements (mirrors real app.js logic) ───────────────

  function refreshTargetedElements(targets) {
    if (!targets || targets.length === 0) return;
    var didFullRender = false;
    for (var i = 0; i < targets.length; i++) {
      if (targets[i].type === 'board') { renderBoard(); didFullRender = true; break; }
    }
    if (!didFullRender) {
      for (var j = 0; j < targets.length; j++) {
        var t = targets[j];
        if (t.type === 'column') refreshColumn(t.colIndex);
        if (t.type === 'card-remove') removeCard(t.colIndex, t.cardIndex);
        if (t.type === 'card-insert') insertCard(t.colIndex, t.cardIndex);
      }
    }
  }

  // ── DOM query helpers ─────────────────────────────────────────────────

  function getVisibleCardIds(flatColIndex) {
    var cardsEl = columnsContainer.querySelector('.column-cards[data-col-index="' + flatColIndex + '"]');
    if (!cardsEl) return [];
    var cards = cardsEl.querySelectorAll('.card');
    var ids = [];
    for (var i = 0; i < cards.length; i++) {
      ids.push(cards[i].getAttribute('data-card-id'));
    }
    return ids;
  }

  function getVisibleCardContents(flatColIndex) {
    var cardsEl = columnsContainer.querySelector('.column-cards[data-col-index="' + flatColIndex + '"]');
    if (!cardsEl) return [];
    var cards = cardsEl.querySelectorAll('.card .card-content');
    var contents = [];
    for (var i = 0; i < cards.length; i++) {
      contents.push(cards[i].textContent.trim());
    }
    return contents;
  }

  function getColumnCount(flatColIndex) {
    var countEl = columnsContainer.querySelector('.column[data-col-index="' + flatColIndex + '"] .column-count');
    return countEl ? parseInt(countEl.textContent, 10) : -1;
  }

  function getRowCount() {
    return columnsContainer.querySelectorAll('.board-row').length;
  }

  function getStackCount(rowIndex) {
    var row = columnsContainer.querySelector('.board-row[data-row-index="' + rowIndex + '"]');
    return row ? row.querySelectorAll('.board-stack').length : 0;
  }

  function getColumnCountInStack(rowIndex, stackIndex) {
    var stack = columnsContainer.querySelector('.board-stack[data-row-index="' + rowIndex + '"][data-stack-index="' + stackIndex + '"]');
    return stack ? stack.querySelectorAll('.column').length : 0;
  }

  return {
    makeCard, makeColumn, makeStack, makeRow, makeBoard,
    setState: function (board, boardId) {
      fullBoardData = board;
      activeBoardId = boardId || 'test-board';
    },
    getState: function () { return fullBoardData; },
    renderBoard,
    refreshTargetedElements,
    getVisibleCardIds,
    getVisibleCardContents,
    getColumnCount,
    getRowCount,
    getStackCount,
    getColumnCountInStack,
    getContainer: function () { return columnsContainer; },
    addPlaceholder: function (flatCol, cardIndex, cardId) {
      var cardsEl = columnsContainer.querySelector('.column-cards[data-col-index="' + flatCol + '"]');
      var col = getColumnByFlatIndex(flatCol);
      if (!cardsEl || !col) return null;
      var visibleCards = col.cards.filter(function (c) {
        return !c.content || c.content.indexOf('#hidden-internal-deleted') === -1;
      });
      var card = visibleCards[cardIndex] || { id: cardId || '' };
      var placeholder = buildPlaceholder(flatCol, cardIndex, card);
      var current = cardsEl.querySelector('.card[data-card-index="' + cardIndex + '"]');
      if (current) current.replaceWith(placeholder);
      reindexVisibleNodes(cardsEl);
      return placeholder;
    },
    // Direct data mutations (simulating what moveCard does to fullBoardData)
    spliceCard: function (srcFlatCol, srcIdx, dstFlatCol, dstIdx) {
      var srcCol = getColumnByFlatIndex(srcFlatCol);
      var dstCol = getColumnByFlatIndex(dstFlatCol);
      if (!srcCol || !dstCol) return null;
      var card = srcCol.cards.splice(srcIdx, 1)[0];
      if (!card) return null;
      if (srcCol === dstCol && srcIdx < dstIdx) dstIdx--;
      dstCol.cards.splice(dstIdx, 0, card);
      return card;
    },
    addCard: function (flatCol, idx, card) {
      var col = getColumnByFlatIndex(flatCol);
      if (!col) return;
      col.cards.splice(idx, 0, card);
    },
    removeCardFromData: function (flatCol, idx) {
      var col = getColumnByFlatIndex(flatCol);
      if (!col) return null;
      return col.cards.splice(idx, 1)[0];
    },
    addRow: function (row) {
      fullBoardData.rows.push(row);
    },
    addStackToRow: function (rowIdx, stack) {
      fullBoardData.rows[rowIdx].stacks.push(stack);
    },
    addColumnToStack: function (rowIdx, stackIdx, col) {
      fullBoardData.rows[rowIdx].stacks[stackIdx].columns.push(col);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

let R;

beforeAll(() => {
  R = createBoardRenderer();
});

beforeEach(() => {
  // Reset DOM between tests
  R.getContainer().innerHTML = '';
});

describe('Card mutations appear immediately in DOM', () => {

  it('same-column reorder: card moves to new position in DOM', () => {
    var board = R.makeBoard([R.makeRow('r1', 'Row', [R.makeStack('s1', 'Stack', [
      R.makeColumn('c1', 'Col 1', [R.makeCard('a', 'Alpha'), R.makeCard('b', 'Beta'), R.makeCard('c', 'Charlie')])
    ])])]);
    R.setState(board, 'board-1');
    R.renderBoard();

    expect(R.getVisibleCardIds(0)).toEqual(['a', 'b', 'c']);

    // Mutate data: move 'a' to end
    R.spliceCard(0, 0, 0, 3);
    // Refresh just the column (same as same-column reorder path)
    R.refreshTargetedElements([{ type: 'column', colIndex: 0 }]);

    expect(R.getVisibleCardIds(0)).toEqual(['b', 'c', 'a']);
    expect(R.getColumnCount(0)).toBe(3);
  });

  it('cross-column move: card disappears from source, appears in target', () => {
    var board = R.makeBoard([R.makeRow('r1', 'Row', [R.makeStack('s1', 'Stack', [
      R.makeColumn('c1', 'Source', [R.makeCard('a', 'Alpha'), R.makeCard('b', 'Beta')]),
      R.makeColumn('c2', 'Target', [R.makeCard('c', 'Charlie')])
    ])])]);
    R.setState(board, 'board-1');
    R.renderBoard();

    expect(R.getVisibleCardIds(0)).toEqual(['a', 'b']);
    expect(R.getVisibleCardIds(1)).toEqual(['c']);

    // Mutate data: move 'a' from col 0 to col 1 at position 0
    R.spliceCard(0, 0, 1, 0);
    // Full board refresh (cross-column path)
    R.refreshTargetedElements([{ type: 'board' }]);

    expect(R.getVisibleCardIds(0)).toEqual(['b']);
    expect(R.getVisibleCardIds(1)).toEqual(['a', 'c']);
    expect(R.getColumnCount(0)).toBe(1);
    expect(R.getColumnCount(1)).toBe(2);
  });

  it('cross-column move updates counts when the moved source card is virtualised as a placeholder', () => {
    var board = R.makeBoard([R.makeRow('r1', 'Row', [R.makeStack('s1', 'Stack', [
      R.makeColumn('c1', 'Source', [R.makeCard('a', 'Alpha'), R.makeCard('b', 'Beta')]),
      R.makeColumn('c2', 'Target', [R.makeCard('c', 'Charlie')])
    ])])]);
    R.setState(board, 'board-1');
    R.renderBoard();
    R.addPlaceholder(0, 0, 'a');

    R.spliceCard(0, 0, 1, 0);
    R.refreshTargetedElements([{ type: 'card-remove', colIndex: 0, cardIndex: 0 }, { type: 'card-insert', colIndex: 1, cardIndex: 0 }]);

    expect(R.getColumnCount(0)).toBe(1);
    expect(R.getVisibleCardIds(0)).toEqual(['b']);
    expect(R.getVisibleCardIds(1)).toEqual(['a', 'c']);
  });

  it('add card: new card appears at correct position', () => {
    var board = R.makeBoard([R.makeRow('r1', 'Row', [R.makeStack('s1', 'Stack', [
      R.makeColumn('c1', 'Col', [R.makeCard('a', 'Alpha')])
    ])])]);
    R.setState(board, 'board-1');
    R.renderBoard();

    expect(R.getVisibleCardIds(0)).toEqual(['a']);

    // Mutate data: insert new card at index 0
    R.addCard(0, 0, R.makeCard('new', 'New Card'));
    R.refreshTargetedElements([{ type: 'column', colIndex: 0 }]);

    expect(R.getVisibleCardIds(0)).toEqual(['new', 'a']);
    expect(R.getVisibleCardContents(0)).toEqual(['New Card', 'Alpha']);
    expect(R.getColumnCount(0)).toBe(2);
  });

  it('remove card: card disappears and count updates', () => {
    var board = R.makeBoard([R.makeRow('r1', 'Row', [R.makeStack('s1', 'Stack', [
      R.makeColumn('c1', 'Col', [R.makeCard('a', 'Alpha'), R.makeCard('b', 'Beta'), R.makeCard('c', 'Charlie')])
    ])])]);
    R.setState(board, 'board-1');
    R.renderBoard();

    expect(R.getVisibleCardIds(0)).toEqual(['a', 'b', 'c']);

    // Mutate data: remove card at index 1
    R.removeCardFromData(0, 1);
    R.refreshTargetedElements([{ type: 'column', colIndex: 0 }]);

    expect(R.getVisibleCardIds(0)).toEqual(['a', 'c']);
    expect(R.getColumnCount(0)).toBe(2);
  });
});

describe('Structural mutations appear immediately in DOM', () => {

  it('add row: new row appears in DOM', () => {
    var board = R.makeBoard([R.makeRow('r1', 'Row 1', [R.makeStack('s1', 'Stack', [
      R.makeColumn('c1', 'Col', [R.makeCard('a', 'Alpha')])
    ])])]);
    R.setState(board, 'board-1');
    R.renderBoard();

    expect(R.getRowCount()).toBe(1);

    // Add a new row
    R.addRow(R.makeRow('r2', 'Row 2', [R.makeStack('s2', 'Stack 2', [
      R.makeColumn('c2', 'Col 2', [R.makeCard('b', 'Beta')])
    ])]));
    R.refreshTargetedElements([{ type: 'board' }]);

    expect(R.getRowCount()).toBe(2);
    expect(R.getVisibleCardIds(1)).toEqual(['b']);
  });

  it('add stack: new stack appears in row', () => {
    var board = R.makeBoard([R.makeRow('r1', 'Row', [R.makeStack('s1', 'Stack 1', [
      R.makeColumn('c1', 'Col 1', [R.makeCard('a', 'Alpha')])
    ])])]);
    R.setState(board, 'board-1');
    R.renderBoard();

    expect(R.getStackCount(0)).toBe(1);

    // Add a new stack to row 0
    R.addStackToRow(0, R.makeStack('s2', 'Stack 2', [
      R.makeColumn('c2', 'Col 2', [R.makeCard('b', 'Beta')])
    ]));
    R.refreshTargetedElements([{ type: 'board' }]);

    expect(R.getStackCount(0)).toBe(2);
    expect(R.getVisibleCardIds(1)).toEqual(['b']);
  });

  it('add column: new column appears in stack', () => {
    var board = R.makeBoard([R.makeRow('r1', 'Row', [R.makeStack('s1', 'Stack', [
      R.makeColumn('c1', 'Col 1', [R.makeCard('a', 'Alpha')])
    ])])]);
    R.setState(board, 'board-1');
    R.renderBoard();

    expect(R.getColumnCountInStack(0, 0)).toBe(1);

    // Add column to stack
    R.addColumnToStack(0, 0, R.makeColumn('c2', 'Col 2', [R.makeCard('b', 'Beta')]));
    R.refreshTargetedElements([{ type: 'board' }]);

    expect(R.getColumnCountInStack(0, 0)).toBe(2);
    expect(R.getVisibleCardIds(0)).toEqual(['a']);
    expect(R.getVisibleCardIds(1)).toEqual(['b']);
  });
});

describe('Multi-step operations produce correct final DOM', () => {

  it('move card across columns then back: DOM matches data', () => {
    var board = R.makeBoard([R.makeRow('r1', 'Row', [R.makeStack('s1', 'Stack', [
      R.makeColumn('c1', 'Left', [R.makeCard('a', 'Alpha'), R.makeCard('b', 'Beta')]),
      R.makeColumn('c2', 'Right', [R.makeCard('c', 'Charlie')])
    ])])]);
    R.setState(board, 'board-1');
    R.renderBoard();

    // Move 'a' from Left to Right
    R.spliceCard(0, 0, 1, 0);
    R.refreshTargetedElements([{ type: 'board' }]);
    expect(R.getVisibleCardIds(0)).toEqual(['b']);
    expect(R.getVisibleCardIds(1)).toEqual(['a', 'c']);

    // Move 'a' back to Left at end
    R.spliceCard(1, 0, 0, 1);
    R.refreshTargetedElements([{ type: 'board' }]);
    expect(R.getVisibleCardIds(0)).toEqual(['b', 'a']);
    expect(R.getVisibleCardIds(1)).toEqual(['c']);
  });

  it('multiple card adds then remove: counts stay correct', () => {
    var board = R.makeBoard([R.makeRow('r1', 'Row', [R.makeStack('s1', 'Stack', [
      R.makeColumn('c1', 'Col', [])
    ])])]);
    R.setState(board, 'board-1');
    R.renderBoard();

    expect(R.getColumnCount(0)).toBe(0);

    R.addCard(0, 0, R.makeCard('a', 'A'));
    R.refreshTargetedElements([{ type: 'column', colIndex: 0 }]);
    expect(R.getColumnCount(0)).toBe(1);

    R.addCard(0, 1, R.makeCard('b', 'B'));
    R.refreshTargetedElements([{ type: 'column', colIndex: 0 }]);
    expect(R.getColumnCount(0)).toBe(2);

    R.addCard(0, 2, R.makeCard('c', 'C'));
    R.refreshTargetedElements([{ type: 'column', colIndex: 0 }]);
    expect(R.getColumnCount(0)).toBe(3);

    R.removeCardFromData(0, 1);
    R.refreshTargetedElements([{ type: 'column', colIndex: 0 }]);
    expect(R.getColumnCount(0)).toBe(2);
    expect(R.getVisibleCardIds(0)).toEqual(['a', 'c']);
  });

  it('add row + add card to new row: visible immediately', () => {
    var board = R.makeBoard([R.makeRow('r1', 'Row 1', [R.makeStack('s1', 'Stack', [
      R.makeColumn('c1', 'Col', [R.makeCard('a', 'Alpha')])
    ])])]);
    R.setState(board, 'board-1');
    R.renderBoard();

    // Add row
    R.addRow(R.makeRow('r2', 'Row 2', [R.makeStack('s2', 'Stack 2', [
      R.makeColumn('c2', 'Col 2', [])
    ])]));
    R.refreshTargetedElements([{ type: 'board' }]);
    expect(R.getRowCount()).toBe(2);
    expect(R.getVisibleCardIds(1)).toEqual([]);

    // Add card to new row's column
    R.addCard(1, 0, R.makeCard('b', 'Beta'));
    R.refreshTargetedElements([{ type: 'column', colIndex: 1 }]);
    expect(R.getVisibleCardIds(1)).toEqual(['b']);
    expect(R.getColumnCount(1)).toBe(1);
  });
});
