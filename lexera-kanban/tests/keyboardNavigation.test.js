import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createKeyboardNavigation(documentOverrides = {}) {
  return loadIIFE('keyboard/keyboardNavigation.js', 'LexeraKeyboardNavigation', {
    window: {},
    document: Object.assign({ activeElement: null }, documentOverrides),
    setTimeout,
    clearTimeout
  });
}

function createClassList(initialClasses) {
  const values = new Set(initialClasses || []);
  return {
    add(name) { values.add(name); },
    remove(name) { values.delete(name); },
    contains(name) { return values.has(name); }
  };
}

function createElement(classes, attrs, parent) {
  const classList = createClassList(classes);
  const node = {
    parent: parent || null,
    classList,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs || {}, name) ? attrs[name] : null;
    },
    closest(selector) {
      if (!selector || selector.charAt(0) !== '.') return null;
      const className = selector.slice(1);
      let current = this;
      while (current) {
        if (current.classList && current.classList.contains(className)) return current;
        current = current.parent || null;
      }
      return null;
    }
  };
  return node;
}

function buildBoardElements() {
  const rowEl = createElement(['board-row'], {
    'data-row-id': 'row-main',
    'data-row-index': '9'
  });
  const stackEl = createElement(['board-stack'], {
    'data-row-id': 'row-main',
    'data-stack-id': 'stack-active',
    'data-row-index': '9',
    'data-stack-index': '8'
  }, rowEl);
  const columnEl = createElement(['column'], {
    'data-row-id': 'row-main',
    'data-stack-id': 'stack-active',
    'data-column-id': 'col-todo',
    'data-row-index': '9',
    'data-stack-index': '8',
    'data-col-local-index': '7',
    'data-col-index': '42'
  }, stackEl);
  return { rowEl, stackEl, columnEl };
}

function buildActiveBoardData() {
  return {
    rows: [{
      id: 'row-main',
      title: 'Main',
      stacks: [{
        id: 'stack-active',
        title: 'Active',
        columns: [
          { id: 'col-todo', index: 5, title: 'Todo', cards: [] },
          { id: 'col-next', index: 9, title: 'Next', cards: [] }
        ]
      }, {
        id: 'stack-review',
        title: 'Review',
        columns: []
      }]
    }, {
      id: 'row-secondary',
      title: 'Secondary',
      stacks: []
    }]
  };
}

function initKeyboardNavigation(module, overrides = {}) {
  const deps = {
    getIsEditing: () => false,
    getSearchMode: () => false,
    getMgmtPanelOpen: () => false,
    getActiveBoardData: () => buildActiveBoardData(),
    getActiveBoardColumns: () => [],
    reorderRows: vi.fn(),
    moveStack: vi.fn(),
    moveColumnWithinBoard: vi.fn()
  };
  Object.assign(deps, overrides);
  module.init(deps);
  return deps;
}

describe('keyboard navigation stable board-entity targeting', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures a stable board-entity target and keeps it after the highlight timeout', () => {
    vi.useFakeTimers();
    const KeyboardNavigation = createKeyboardNavigation();
    initKeyboardNavigation(KeyboardNavigation);
    const { columnEl } = buildBoardElements();

    expect(KeyboardNavigation.focusBoardEntity(columnEl)).toBe(true);
    expect(KeyboardNavigation.getFocusedBoardEntityTarget()).toMatchObject({
      scope: 'column',
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo',
      rowIndex: 9,
      stackIndex: 8,
      colLocalIndex: 7,
      columnIndex: 42
    });
    expect(columnEl.classList.contains('board-focus-highlight')).toBe(true);

    vi.advanceTimersByTime(1601);

    expect(columnEl.classList.contains('board-focus-highlight')).toBe(false);
    expect(KeyboardNavigation.getFocusedBoardEntityTarget()).toMatchObject({
      scope: 'column',
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo'
    });
  });

  it('resolves focused board entities by stable ids before stale DOM indices', () => {
    const KeyboardNavigation = createKeyboardNavigation();
    initKeyboardNavigation(KeyboardNavigation);
    const { columnEl } = buildBoardElements();

    KeyboardNavigation.focusBoardEntity(columnEl);

    expect(KeyboardNavigation.resolveFocusedBoardEntityContext()).toMatchObject({
      scope: 'column',
      rowId: 'row-main',
      stackId: 'stack-active',
      columnId: 'col-todo',
      rowIndex: 0,
      stackIndex: 0,
      colLocalIndex: 0,
      columnIndex: 5
    });
  });

  it('reorders focused columns using resolved stable ids instead of stale DOM positions', () => {
    const KeyboardNavigation = createKeyboardNavigation();
    const deps = initKeyboardNavigation(KeyboardNavigation);
    const { columnEl } = buildBoardElements();
    const preventDefault = vi.fn();

    KeyboardNavigation.focusBoardEntity(columnEl);
    KeyboardNavigation.handleKeyNavigation({
      key: 'ArrowRight',
      ctrlKey: true,
      altKey: true,
      metaKey: false,
      preventDefault
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(deps.moveColumnWithinBoard).toHaveBeenCalledWith(0, 0, 0, 0, 0, 1, false);
  });

  it('reorders focused rows from the persisted target even after the highlight timeout', () => {
    vi.useFakeTimers();
    const KeyboardNavigation = createKeyboardNavigation();
    const deps = initKeyboardNavigation(KeyboardNavigation);
    const { rowEl } = buildBoardElements();
    const preventDefault = vi.fn();

    KeyboardNavigation.focusBoardEntity(rowEl);
    vi.advanceTimersByTime(1601);

    KeyboardNavigation.handleKeyNavigation({
      key: 'ArrowDown',
      ctrlKey: true,
      altKey: true,
      metaKey: false,
      preventDefault
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(deps.reorderRows).toHaveBeenCalledWith(0, 1, false);
  });
});
