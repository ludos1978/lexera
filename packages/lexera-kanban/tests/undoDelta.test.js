import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

/**
 * Extract delta-related functions from app.js for isolated testing.
 */
function loadDeltaFunctions() {
  const source = readFileSync(resolve(srcDir, 'app.js'), 'utf-8');
  const lines = source.split('\n');

  function extractFunction(startLine) {
    let depth = 0;
    let started = false;
    const result = [];
    for (let i = startLine - 1; i < lines.length; i++) {
      const line = lines[i];
      result.push(line);
      for (let c = 0; c < line.length; c++) {
        if (line[c] === '{') { depth++; started = true; }
        if (line[c] === '}') depth--;
      }
      if (started && depth === 0) break;
    }
    return result.join('\n');
  }

  function findLine(pattern) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(pattern)) return i + 1;
    }
    throw new Error('Could not find: ' + pattern);
  }

  const fnDefs = [
    extractFunction(findLine('function computeBoardDelta(')),
    extractFunction(findLine('function diffFlatObject(')),
    extractFunction(findLine('function diffIdArray(')),
    extractFunction(findLine('function diffRow(')),
    extractFunction(findLine('function diffStack(')),
    extractFunction(findLine('function diffColumn(')),
    extractFunction(findLine('function diffCard(')),
    extractFunction(findLine('function applyBoardDelta(')),
    extractFunction(findLine('function applyFlatObjectDelta(')),
    extractFunction(findLine('function applyIdArrayDelta(')),
    extractFunction(findLine('function applyRowDelta(')),
    extractFunction(findLine('function applyStackDelta(')),
    extractFunction(findLine('function applyColumnDelta(')),
    extractFunction(findLine('function applyCardDelta(')),
    extractFunction(findLine('function estimateDeltaSize(')),
  ];

  const wrappedSource = `
    ${fnDefs.join('\n\n')}
    return {
      computeBoardDelta,
      diffFlatObject,
      diffIdArray,
      diffRow,
      diffStack,
      diffColumn,
      diffCard,
      applyBoardDelta,
      applyFlatObjectDelta,
      applyIdArrayDelta,
      applyRowDelta,
      applyStackDelta,
      applyColumnDelta,
      applyCardDelta,
      estimateDeltaSize,
    };
  `;

  const factory = new Function(wrappedSource);
  return factory();
}

let D;

beforeAll(() => {
  D = loadDeltaFunctions();
});

// Helper: create a minimal board structure
function makeBoard(overrides) {
  return Object.assign({
    valid: true,
    title: 'Test Board',
    columns: [],
    rows: [],
    yamlHeader: null,
    kanbanFooter: null,
    boardSettings: null,
  }, overrides);
}

function makeCard(id, content, opts) {
  return Object.assign({ id: id, content: content, checked: false, kid: null }, opts);
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

// ═══════════════════════════════════════════════════════════════════════════
// diffCard
// ═══════════════════════════════════════════════════════════════════════════

describe('diffCard', () => {
  it('returns null for identical cards', () => {
    const card = makeCard('c1', 'hello');
    expect(D.diffCard(card, { ...card })).toBeNull();
  });

  it('detects content change', () => {
    const old = makeCard('c1', 'hello');
    const nw = makeCard('c1', 'world');
    const delta = D.diffCard(old, nw);
    expect(delta).toEqual({ content: { o: 'hello', n: 'world' } });
  });

  it('detects checked change', () => {
    const old = makeCard('c1', 'hello', { checked: false });
    const nw = makeCard('c1', 'hello', { checked: true });
    const delta = D.diffCard(old, nw);
    expect(delta).toEqual({ checked: { o: false, n: true } });
  });

  it('detects multiple field changes', () => {
    const old = makeCard('c1', 'hello', { kid: 'abc' });
    const nw = makeCard('c1', 'world', { kid: 'def' });
    const delta = D.diffCard(old, nw);
    expect(delta).toEqual({
      content: { o: 'hello', n: 'world' },
      kid: { o: 'abc', n: 'def' }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// diffFlatObject
// ═══════════════════════════════════════════════════════════════════════════

describe('diffFlatObject', () => {
  it('returns null for identical objects', () => {
    expect(D.diffFlatObject({ a: 1 }, { a: 1 })).toBeNull();
  });

  it('returns null for both null', () => {
    expect(D.diffFlatObject(null, null)).toBeNull();
  });

  it('detects null to object', () => {
    const diff = D.diffFlatObject(null, { a: 1 });
    expect(diff.__replaced).toEqual({ o: null, n: { a: 1 } });
  });

  it('detects object to null', () => {
    const diff = D.diffFlatObject({ a: 1 }, null);
    expect(diff.__replaced).toEqual({ o: { a: 1 }, n: null });
  });

  it('detects changed values', () => {
    const diff = D.diffFlatObject({ a: 1, b: 2 }, { a: 1, b: 3 });
    expect(diff).toEqual({ b: { o: 2, n: 3 } });
  });

  it('detects added keys', () => {
    const diff = D.diffFlatObject({ a: 1 }, { a: 1, b: 2 });
    expect(diff).toEqual({ b: { o: undefined, n: 2 } });
  });

  it('detects removed keys', () => {
    const diff = D.diffFlatObject({ a: 1, b: 2 }, { a: 1 });
    expect(diff).toEqual({ b: { o: 2, n: undefined } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// diffIdArray
// ═══════════════════════════════════════════════════════════════════════════

describe('diffIdArray', () => {
  it('returns null for identical arrays', () => {
    const arr = [makeCard('c1', 'a'), makeCard('c2', 'b')];
    expect(D.diffIdArray(arr, arr.map(c => ({ ...c })), D.diffCard)).toBeNull();
  });

  it('detects added items', () => {
    const old = [makeCard('c1', 'a')];
    const nw = [makeCard('c1', 'a'), makeCard('c2', 'b')];
    const delta = D.diffIdArray(old, nw, D.diffCard);
    expect(delta.added).toBeDefined();
    expect(delta.added['c2']).toBeDefined();
    expect(delta.added['c2'].content).toBe('b');
  });

  it('detects removed items', () => {
    const old = [makeCard('c1', 'a'), makeCard('c2', 'b')];
    const nw = [makeCard('c1', 'a')];
    const delta = D.diffIdArray(old, nw, D.diffCard);
    expect(delta.removed).toBeDefined();
    expect(delta.removed['c2']).toBeDefined();
  });

  it('detects modified items', () => {
    const old = [makeCard('c1', 'a')];
    const nw = [makeCard('c1', 'changed')];
    const delta = D.diffIdArray(old, nw, D.diffCard);
    expect(delta.modified).toBeDefined();
    expect(delta.modified['c1']).toEqual({ content: { o: 'a', n: 'changed' } });
  });

  it('detects reordering', () => {
    const old = [makeCard('c1', 'a'), makeCard('c2', 'b')];
    const nw = [makeCard('c2', 'b'), makeCard('c1', 'a')];
    const delta = D.diffIdArray(old, nw, D.diffCard);
    expect(delta.oldOrder).toEqual(['c1', 'c2']);
    expect(delta.newOrder).toEqual(['c2', 'c1']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeBoardDelta + applyBoardDelta round-trip
// ═══════════════════════════════════════════════════════════════════════════

describe('computeBoardDelta + applyBoardDelta round-trip', () => {
  it('handles no changes (empty delta)', () => {
    const board = makeBoard();
    const delta = D.computeBoardDelta(board, { ...board });
    expect(delta).toEqual({});
  });

  it('handles title change and reverses it', () => {
    const old = makeBoard({ title: 'Old Title' });
    const nw = makeBoard({ title: 'New Title' });
    const delta = D.computeBoardDelta(old, nw);
    expect(delta.title).toEqual({ o: 'Old Title', n: 'New Title' });

    // Apply forward to a clone of old
    const forwardTarget = JSON.parse(JSON.stringify(old));
    D.applyBoardDelta(forwardTarget, delta, false);
    expect(forwardTarget.title).toBe('New Title');

    // Apply reverse to get back
    D.applyBoardDelta(forwardTarget, delta, true);
    expect(forwardTarget.title).toBe('Old Title');
  });

  it('handles card content edit (most common operation)', () => {
    const col = makeColumn('col1', 'Todo', [makeCard('c1', 'original'), makeCard('c2', 'keep')]);
    const stack = makeStack('s1', 'Stack', [col]);
    const row = makeRow('r1', 'Row', [stack]);
    const old = makeBoard({ rows: [row] });

    const newBoard = JSON.parse(JSON.stringify(old));
    newBoard.rows[0].stacks[0].columns[0].cards[0].content = 'edited';

    const delta = D.computeBoardDelta(old, newBoard);
    // Only the card change should be stored
    expect(delta.rows.modified['r1'].stacks.modified['s1'].columns.modified['col1'].cards.modified['c1'])
      .toEqual({ content: { o: 'original', n: 'edited' } });

    // Apply forward
    const testBoard = JSON.parse(JSON.stringify(old));
    D.applyBoardDelta(testBoard, delta, false);
    expect(testBoard.rows[0].stacks[0].columns[0].cards[0].content).toBe('edited');
    expect(testBoard.rows[0].stacks[0].columns[0].cards[1].content).toBe('keep');

    // Apply reverse
    D.applyBoardDelta(testBoard, delta, true);
    expect(testBoard.rows[0].stacks[0].columns[0].cards[0].content).toBe('original');
  });

  it('handles card addition', () => {
    const col = makeColumn('col1', 'Todo', [makeCard('c1', 'existing')]);
    const stack = makeStack('s1', 'Stack', [col]);
    const row = makeRow('r1', 'Row', [stack]);
    const old = makeBoard({ rows: [row] });

    const newBoard = JSON.parse(JSON.stringify(old));
    newBoard.rows[0].stacks[0].columns[0].cards.push(makeCard('c2', 'new card'));

    const delta = D.computeBoardDelta(old, newBoard);

    // Apply forward
    const testBoard = JSON.parse(JSON.stringify(old));
    D.applyBoardDelta(testBoard, delta, false);
    expect(testBoard.rows[0].stacks[0].columns[0].cards).toHaveLength(2);
    expect(testBoard.rows[0].stacks[0].columns[0].cards[1].content).toBe('new card');

    // Apply reverse (undo the addition)
    D.applyBoardDelta(testBoard, delta, true);
    expect(testBoard.rows[0].stacks[0].columns[0].cards).toHaveLength(1);
    expect(testBoard.rows[0].stacks[0].columns[0].cards[0].id).toBe('c1');
  });

  it('handles card removal', () => {
    const col = makeColumn('col1', 'Todo', [makeCard('c1', 'keep'), makeCard('c2', 'remove')]);
    const stack = makeStack('s1', 'Stack', [col]);
    const row = makeRow('r1', 'Row', [stack]);
    const old = makeBoard({ rows: [row] });

    const newBoard = JSON.parse(JSON.stringify(old));
    newBoard.rows[0].stacks[0].columns[0].cards = [newBoard.rows[0].stacks[0].columns[0].cards[0]];

    const delta = D.computeBoardDelta(old, newBoard);

    // Apply forward
    const testBoard = JSON.parse(JSON.stringify(old));
    D.applyBoardDelta(testBoard, delta, false);
    expect(testBoard.rows[0].stacks[0].columns[0].cards).toHaveLength(1);
    expect(testBoard.rows[0].stacks[0].columns[0].cards[0].id).toBe('c1');

    // Apply reverse (undo the removal)
    D.applyBoardDelta(testBoard, delta, true);
    expect(testBoard.rows[0].stacks[0].columns[0].cards).toHaveLength(2);
    expect(testBoard.rows[0].stacks[0].columns[0].cards[1].id).toBe('c2');
  });

  it('handles card reordering', () => {
    const col = makeColumn('col1', 'Todo', [makeCard('c1', 'first'), makeCard('c2', 'second'), makeCard('c3', 'third')]);
    const stack = makeStack('s1', 'Stack', [col]);
    const row = makeRow('r1', 'Row', [stack]);
    const old = makeBoard({ rows: [row] });

    const newBoard = JSON.parse(JSON.stringify(old));
    // Reverse card order
    newBoard.rows[0].stacks[0].columns[0].cards.reverse();

    const delta = D.computeBoardDelta(old, newBoard);

    // Apply forward
    const testBoard = JSON.parse(JSON.stringify(old));
    D.applyBoardDelta(testBoard, delta, false);
    expect(testBoard.rows[0].stacks[0].columns[0].cards.map(c => c.id)).toEqual(['c3', 'c2', 'c1']);

    // Apply reverse
    D.applyBoardDelta(testBoard, delta, true);
    expect(testBoard.rows[0].stacks[0].columns[0].cards.map(c => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('handles boardSettings change', () => {
    const old = makeBoard({ boardSettings: { columnWidth: '300px', fontSize: '14px' } });
    const nw = makeBoard({ boardSettings: { columnWidth: '400px', fontSize: '14px' } });
    const delta = D.computeBoardDelta(old, nw);

    expect(delta.boardSettings).toEqual({ columnWidth: { o: '300px', n: '400px' } });

    const testBoard = JSON.parse(JSON.stringify(old));
    D.applyBoardDelta(testBoard, delta, false);
    expect(testBoard.boardSettings.columnWidth).toBe('400px');
    expect(testBoard.boardSettings.fontSize).toBe('14px');

    D.applyBoardDelta(testBoard, delta, true);
    expect(testBoard.boardSettings.columnWidth).toBe('300px');
  });

  it('handles boardSettings null to object', () => {
    const old = makeBoard({ boardSettings: null });
    const nw = makeBoard({ boardSettings: { columnWidth: '300px' } });
    const delta = D.computeBoardDelta(old, nw);

    const testBoard = JSON.parse(JSON.stringify(old));
    D.applyBoardDelta(testBoard, delta, false);
    expect(testBoard.boardSettings).toEqual({ columnWidth: '300px' });

    D.applyBoardDelta(testBoard, delta, true);
    expect(testBoard.boardSettings).toBeNull();
  });

  it('handles column title change', () => {
    const col = makeColumn('col1', 'Old Name', []);
    const stack = makeStack('s1', 'Stack', [col]);
    const row = makeRow('r1', 'Row', [stack]);
    const old = makeBoard({ rows: [row] });

    const newBoard = JSON.parse(JSON.stringify(old));
    newBoard.rows[0].stacks[0].columns[0].title = 'New Name';

    const delta = D.computeBoardDelta(old, newBoard);

    const testBoard = JSON.parse(JSON.stringify(old));
    D.applyBoardDelta(testBoard, delta, false);
    expect(testBoard.rows[0].stacks[0].columns[0].title).toBe('New Name');

    D.applyBoardDelta(testBoard, delta, true);
    expect(testBoard.rows[0].stacks[0].columns[0].title).toBe('Old Name');
  });

  it('handles moving card between columns (add+remove)', () => {
    const col1 = makeColumn('col1', 'Todo', [makeCard('c1', 'task'), makeCard('c2', 'another')]);
    const col2 = makeColumn('col2', 'Done', []);
    const stack = makeStack('s1', 'Stack', [col1, col2]);
    const row = makeRow('r1', 'Row', [stack]);
    const old = makeBoard({ rows: [row] });

    // Move c1 from col1 to col2
    const newBoard = JSON.parse(JSON.stringify(old));
    var moved = newBoard.rows[0].stacks[0].columns[0].cards.shift();
    newBoard.rows[0].stacks[0].columns[1].cards.push(moved);

    const delta = D.computeBoardDelta(old, newBoard);

    // Apply forward
    const testBoard = JSON.parse(JSON.stringify(old));
    D.applyBoardDelta(testBoard, delta, false);
    expect(testBoard.rows[0].stacks[0].columns[0].cards.map(c => c.id)).toEqual(['c2']);
    expect(testBoard.rows[0].stacks[0].columns[1].cards.map(c => c.id)).toEqual(['c1']);

    // Apply reverse
    D.applyBoardDelta(testBoard, delta, true);
    expect(testBoard.rows[0].stacks[0].columns[0].cards.map(c => c.id)).toEqual(['c1', 'c2']);
    expect(testBoard.rows[0].stacks[0].columns[1].cards).toHaveLength(0);
  });

  it('handles complex multi-change scenario', () => {
    const col1 = makeColumn('col1', 'Todo', [makeCard('c1', 'task1'), makeCard('c2', 'task2')]);
    const col2 = makeColumn('col2', 'Done', [makeCard('c3', 'done1')]);
    const stack = makeStack('s1', 'Stack', [col1, col2]);
    const row = makeRow('r1', 'Row', [stack]);
    const old = makeBoard({
      title: 'My Board',
      rows: [row],
      boardSettings: { columnWidth: '300px' }
    });

    const newBoard = JSON.parse(JSON.stringify(old));
    // Change title
    newBoard.title = 'Renamed Board';
    // Edit a card
    newBoard.rows[0].stacks[0].columns[0].cards[0].content = 'edited task1';
    // Remove a card
    newBoard.rows[0].stacks[0].columns[0].cards.splice(1, 1);
    // Add a card to col2
    newBoard.rows[0].stacks[0].columns[1].cards.push(makeCard('c4', 'new done'));
    // Change setting
    newBoard.boardSettings.columnWidth = '400px';

    const delta = D.computeBoardDelta(old, newBoard);

    // Apply forward
    const testBoard = JSON.parse(JSON.stringify(old));
    D.applyBoardDelta(testBoard, delta, false);
    expect(testBoard.title).toBe('Renamed Board');
    expect(testBoard.rows[0].stacks[0].columns[0].cards).toHaveLength(1);
    expect(testBoard.rows[0].stacks[0].columns[0].cards[0].content).toBe('edited task1');
    expect(testBoard.rows[0].stacks[0].columns[1].cards).toHaveLength(2);
    expect(testBoard.boardSettings.columnWidth).toBe('400px');

    // Apply reverse
    D.applyBoardDelta(testBoard, delta, true);
    expect(testBoard.title).toBe('My Board');
    expect(testBoard.rows[0].stacks[0].columns[0].cards).toHaveLength(2);
    expect(testBoard.rows[0].stacks[0].columns[0].cards[0].content).toBe('task1');
    expect(testBoard.rows[0].stacks[0].columns[1].cards).toHaveLength(1);
    expect(testBoard.boardSettings.columnWidth).toBe('300px');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// estimateDeltaSize
// ═══════════════════════════════════════════════════════════════════════════

describe('estimateDeltaSize', () => {
  it('returns the JSON string length of the delta', () => {
    const delta = { title: { o: 'a', n: 'b' } };
    expect(D.estimateDeltaSize(delta)).toBe(JSON.stringify(delta).length);
  });

  it('returns 2 for empty delta', () => {
    expect(D.estimateDeltaSize({})).toBe(2); // '{}'
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Memory savings verification
// ═══════════════════════════════════════════════════════════════════════════

describe('memory savings', () => {
  it('delta is much smaller than full snapshot for single card edit', () => {
    // Simulate a board with many cards
    const cards = [];
    for (let i = 0; i < 200; i++) {
      cards.push(makeCard('c' + i, 'Card content for item number ' + i + ' with some description text'));
    }
    const col = makeColumn('col1', 'Big Column', cards);
    const stack = makeStack('s1', 'Stack', [col]);
    const row = makeRow('r1', 'Row', [stack]);
    const board = makeBoard({ rows: [row] });

    const fullSize = JSON.stringify(board).length;

    // Edit one card
    const newBoard = JSON.parse(JSON.stringify(board));
    newBoard.rows[0].stacks[0].columns[0].cards[50].content = 'Modified content';

    const delta = D.computeBoardDelta(board, newBoard);
    const deltaSize = D.estimateDeltaSize(delta);

    // Delta should be much smaller than full snapshot
    expect(deltaSize).toBeLessThan(fullSize / 5);

    // Verify round-trip correctness
    const testBoard = JSON.parse(JSON.stringify(board));
    D.applyBoardDelta(testBoard, delta, false);
    expect(testBoard.rows[0].stacks[0].columns[0].cards[50].content).toBe('Modified content');
    D.applyBoardDelta(testBoard, delta, true);
    expect(testBoard.rows[0].stacks[0].columns[0].cards[50].content).toBe('Card content for item number 50 with some description text');
  });
});
