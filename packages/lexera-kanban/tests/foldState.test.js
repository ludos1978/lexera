import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadFoldStateUtils() {
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
    extractFunction(findLine('function normalizeFoldStorageList(')),
    extractFunction(findLine('function getRowFoldKey(')),
    extractFunction(findLine('function getStackFoldKey(')),
    extractFunction(findLine('function getColumnFoldKey(')),
    extractFunction(findLine('function hasSavedFoldMatch(')),
    extractFunction(findLine('function getFoldedColumns(')),
    extractFunction(findLine('function getFoldedItems(')),
    extractFunction(findLine('function saveFoldState(')),
    extractFunction(findLine('function toggleColumnFoldElement(')),
  ];

  const wrappedSource = `
    var __columnsContainer = null;
    var activeBoardId = 'board-1';
    function getElColumnsContainer() { return __columnsContainer; }
    function setColumnChildrenFoldState() {}
    function saveCardCollapseState() {}
    function refreshBoardHeaderActionStates() {}
    function isCanvasBoardLayout() { return false; }
    var localStorage = {
      _data: {},
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null;
      },
      setItem: function (key, value) {
        this._data[key] = String(value);
      },
      clear: function () {
        this._data = {};
      }
    };

    ${fnDefs.join('\n\n')}

    return {
      normalizeFoldStorageList,
      getRowFoldKey,
      getStackFoldKey,
      getColumnFoldKey,
      hasSavedFoldMatch,
      getFoldedColumns,
      getFoldedItems,
      saveFoldState,
      toggleColumnFoldElement,
      __setColumnsContainer: function (value) { __columnsContainer = value; },
      __clearStorage: function () { localStorage.clear(); }
    };
  `;

  return new Function(wrappedSource)();
}

function createFoldable(attrs, folded) {
  let foldedState = !!folded;
  return {
    classList: {
      contains(name) {
        return name === 'folded' ? foldedState : false;
      },
      add(name) {
        if (name === 'folded') foldedState = true;
      },
      remove(name) {
        if (name === 'folded') foldedState = false;
      },
      toggle(name, force) {
        if (name !== 'folded') return false;
        if (force === undefined) foldedState = !foldedState;
        else foldedState = !!force;
        return foldedState;
      },
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
  };
}

function createContainer(entriesBySelector) {
  return {
    querySelectorAll(selector) {
      return entriesBySelector[selector] || [];
    },
  };
}

let U;

beforeAll(() => {
  U = loadFoldStateUtils();
});

beforeEach(() => {
  U.__clearStorage();
  U.__setColumnsContainer(createContainer({}));
});

describe('fold state keys', () => {
  it('creates distinct column fold keys for duplicate-title columns', () => {
    const first = U.getColumnFoldKey({ title: 'Inbox' }, 0, 0, 0, 0);
    const second = U.getColumnFoldKey({ title: 'Inbox' }, 0, 0, 1, 1);

    expect(first).not.toBe(second);
    expect(first).toBe('column:path:0:0:0');
    expect(second).toBe('column:path:0:0:1');
  });

  it('matches saved fold state by stable key, with legacy title fallback', () => {
    const foldKey = U.getColumnFoldKey({ title: 'Inbox' }, 0, 0, 1, 1);

    expect(U.hasSavedFoldMatch(['column:path:0:0:1'], foldKey, 'Inbox')).toBe(true);
    expect(U.hasSavedFoldMatch(['Inbox'], foldKey, 'Inbox')).toBe(true);
    expect(U.hasSavedFoldMatch(['column:path:0:0:0'], foldKey, 'Other')).toBe(false);
  });

  it('stores folded rows, stacks, and columns by fold key instead of title', () => {
    U.__setColumnsContainer(createContainer({
      '.column[data-fold-key]': [
        createFoldable({ 'data-fold-key': 'column:id:col-1', 'data-col-title': 'Inbox' }, true),
        createFoldable({ 'data-fold-key': 'column:id:col-2', 'data-col-title': 'Inbox' }, false),
      ],
      '.board-row[data-fold-key]': [
        createFoldable({ 'data-fold-key': 'row:id:row-1', 'data-row-title': 'Today' }, true),
      ],
      '.board-stack[data-fold-key]': [
        createFoldable({ 'data-fold-key': 'stack:id:stack-1', 'data-stack-title': 'Doing' }, true),
      ],
    }));

    U.saveFoldState('board-1');

    expect(U.getFoldedColumns('board-1')).toEqual(['column:id:col-1']);
    expect(U.getFoldedItems('board-1', 'row')).toEqual(['row:id:row-1']);
    expect(U.getFoldedItems('board-1', 'stack')).toEqual(['stack:id:stack-1']);
  });

  it('toggles the folded class on a column element and persists the fold key', () => {
    const columnEl = createFoldable({ 'data-fold-key': 'column:id:col-9', 'data-col-title': 'Inbox' }, false);
    U.__setColumnsContainer(createContainer({
      '.column[data-fold-key]': [columnEl],
      '.board-row[data-fold-key]': [],
      '.board-stack[data-fold-key]': [],
    }));

    expect(columnEl.classList.contains('folded')).toBe(false);
    expect(U.toggleColumnFoldElement(columnEl, false)).toBe(true);
    expect(columnEl.classList.contains('folded')).toBe(true);
    expect(U.getFoldedColumns('board-1')).toEqual(['column:id:col-9']);
  });
});
