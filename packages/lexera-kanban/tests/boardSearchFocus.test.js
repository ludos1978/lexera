import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createBoardSearch(container) {
  return loadIIFE('search/boardSearch.js', 'LexeraBoardSearch', {
    window: {},
    document: {},
    getElColumnsContainer() {
      return container;
    }
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

describe('board search local focus targeting', () => {
  it('falls back from a missing card to the owning column via stable ids', () => {
    const stableColumn = {};
    const selectors = {
      '.card[data-card-id="card-hidden"]': null,
      '.column[data-column-id="col-live"]': stableColumn
    };
    const BoardSearch = createBoardSearch({
      querySelector(selector) {
        return Object.prototype.hasOwnProperty.call(selectors, selector) ? selectors[selector] : null;
      }
    });
    BoardSearch.init({
      escapeAttr(value) {
        return String(value);
      }
    });

    expect(BoardSearch.findBoardEntityElement({
      cardId: 'card-hidden',
      columnId: 'col-live',
      rowId: 'row-main',
      stackId: 'stack-active',
      rowIndex: 9,
      stackIndex: 8,
      colLocalIndex: 7,
      cardIndex: 3
    })).toBe(stableColumn);
  });

  it('prefers stable column ids before stale visible path indices', () => {
    const stableColumn = {};
    const staleColumn = {};
    const selectors = {
      '.column[data-column-id="col-live"]': stableColumn,
      '.column[data-row-index="9"][data-stack-index="8"][data-col-local-index="7"]': staleColumn
    };
    const BoardSearch = createBoardSearch({
      querySelector(selector) {
        return Object.prototype.hasOwnProperty.call(selectors, selector) ? selectors[selector] : null;
      }
    });
    BoardSearch.init({
      escapeAttr(value) {
        return String(value);
      }
    });

    expect(BoardSearch.findBoardEntityElement({
      rowIndex: 9,
      stackIndex: 8,
      colLocalIndex: 7,
      columnId: 'col-live'
    })).toBe(stableColumn);
  });

  it('focuses non-card hierarchy targets through stable stack ids', () => {
    const stackEl = {
      classList: createClassList(['board-stack']),
      scrollIntoView: vi.fn()
    };
    const selectors = {
      '.board-stack[data-stack-id="stack-active"]': stackEl
    };
    const BoardSearch = createBoardSearch({
      querySelector(selector) {
        return Object.prototype.hasOwnProperty.call(selectors, selector) ? selectors[selector] : null;
      }
    });
    const unfocusCard = vi.fn();
    const focusBoardEntity = vi.fn();
    const syncSidebarToView = vi.fn();
    BoardSearch.init({
      escapeAttr(value) {
        return String(value);
      },
      unfocusCard,
      focusBoardEntity,
      syncSidebarToView
    });

    expect(BoardSearch.focusHierarchyTargetLocally({
      rowId: 'row-main',
      stackId: 'stack-active',
      rowIndex: 9,
      stackIndex: 8
    })).toBe(true);
    expect(stackEl.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(unfocusCard).toHaveBeenCalledTimes(1);
    expect(focusBoardEntity).toHaveBeenCalledWith(stackEl);
    expect(syncSidebarToView).toHaveBeenCalledTimes(1);
  });

  it('focuses a hidden card target through the owning column when the card itself is not rendered', () => {
    const columnEl = {
      classList: createClassList(['column']),
      scrollIntoView: vi.fn()
    };
    const selectors = {
      '.card[data-card-id="card-hidden"]': null,
      '.column[data-column-id="col-live"]': columnEl
    };
    const BoardSearch = createBoardSearch({
      querySelector(selector) {
        return Object.prototype.hasOwnProperty.call(selectors, selector) ? selectors[selector] : null;
      }
    });
    const unfocusCard = vi.fn();
    const focusBoardEntity = vi.fn();
    const syncSidebarToView = vi.fn();
    BoardSearch.init({
      escapeAttr(value) {
        return String(value);
      },
      unfocusCard,
      focusBoardEntity,
      syncSidebarToView
    });

    expect(BoardSearch.focusHierarchyTargetLocally({
      cardId: 'card-hidden',
      columnId: 'col-live',
      rowId: 'row-main',
      stackId: 'stack-active'
    })).toBe(true);
    expect(columnEl.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(unfocusCard).toHaveBeenCalledTimes(1);
    expect(focusBoardEntity).toHaveBeenCalledWith(columnEl);
    expect(syncSidebarToView).toHaveBeenCalledTimes(1);
  });
});
