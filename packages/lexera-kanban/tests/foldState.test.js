import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FoldState = require('../src/fold/foldState.js');

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
      }
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    }
  };
}

function createContainer(entriesBySelector) {
  return {
    querySelectorAll(selector) {
      return entriesBySelector[selector] || [];
    }
  };
}

function createMemoryStorage() {
  return {
    _data: {},
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null;
    },
    setItem(key, value) {
      this._data[key] = String(value);
    },
    clear() {
      this._data = {};
    }
  };
}

let storage;
let container;

beforeEach(() => {
  storage = createMemoryStorage();
  container = createContainer({});
});

describe('fold state keys', () => {
  it('creates distinct column fold keys for duplicate-title columns', () => {
    const first = FoldState.getColumnFoldKey({ title: 'Inbox' }, 0, 0, 0, 0);
    const second = FoldState.getColumnFoldKey({ title: 'Inbox' }, 0, 0, 1, 1);

    expect(first).not.toBe(second);
    expect(first).toBe('column:path:0:0:0');
    expect(second).toBe('column:path:0:0:1');
  });

  it('matches saved fold state by stable key, with legacy title fallback', () => {
    const foldKey = FoldState.getColumnFoldKey({ title: 'Inbox' }, 0, 0, 1, 1);

    expect(FoldState.hasSavedFoldMatch(['column:path:0:0:1'], foldKey, 'Inbox')).toBe(true);
    expect(FoldState.hasSavedFoldMatch(['Inbox'], foldKey, 'Inbox')).toBe(true);
    expect(FoldState.hasSavedFoldMatch(['column:path:0:0:0'], foldKey, 'Other')).toBe(false);
  });

  it('stores folded rows, stacks, and columns by fold key instead of title', () => {
    container = createContainer({
      '.column[data-fold-key]': [
        createFoldable({ 'data-fold-key': 'column:id:col-1', 'data-col-title': 'Inbox' }, true),
        createFoldable({ 'data-fold-key': 'column:id:col-2', 'data-col-title': 'Inbox' }, false)
      ],
      '.board-row[data-fold-key]': [
        createFoldable({ 'data-fold-key': 'row:id:row-1', 'data-row-title': 'Today' }, true)
      ],
      '.board-stack[data-fold-key]': [
        createFoldable({ 'data-fold-key': 'stack:id:stack-1', 'data-stack-title': 'Doing' }, true)
      ]
    });

    FoldState.saveFoldState('board-1', { storage, container });

    expect(FoldState.getFoldedColumns('board-1', storage)).toEqual(['column:id:col-1']);
    expect(FoldState.getFoldedItems('board-1', 'row', storage)).toEqual(['row:id:row-1']);
    expect(FoldState.getFoldedItems('board-1', 'stack', storage)).toEqual(['stack:id:stack-1']);
  });

  it('toggles the folded class on a column element and persists the fold key', () => {
    const columnEl = createFoldable({ 'data-fold-key': 'column:id:col-9', 'data-col-title': 'Inbox' }, false);
    container = createContainer({
      '.column[data-fold-key]': [columnEl],
      '.board-row[data-fold-key]': [],
      '.board-stack[data-fold-key]': []
    });

    expect(columnEl.classList.contains('folded')).toBe(false);
    expect(FoldState.toggleColumnFoldElement(columnEl, false, {
      boardId: 'board-1',
      storage,
      container,
      refreshBoardHeaderActionStates() {},
      isCanvasBoardLayout() { return false; }
    })).toBe(true);
    expect(columnEl.classList.contains('folded')).toBe(true);
    expect(FoldState.getFoldedColumns('board-1', storage)).toEqual(['column:id:col-9']);
  });
});
