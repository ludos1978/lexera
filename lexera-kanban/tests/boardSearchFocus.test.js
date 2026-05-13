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
  it('returns null when cardId is set but the card isnt rendered (NO column fallback — user contract 2026-05-14: must use unique card identifier)', () => {
    // User report: "we MUST use some unique identifier to highlight
    // cards! any other way is fruitless!". Previously this function
    // fell back to `.column[data-column-id=X]` when the cardId lookup
    // missed, focusing the wrong target. Per the contract update,
    // cardId targets must EITHER resolve to a specific card OR return
    // null — never a non-card surrogate. The orderHelpers retry loop
    // then attempts again as the DOM stabilises; if the card truly
    // doesn't exist, focus silently fails instead of landing on the
    // wrong thing.
    const columnEl = {};
    const selectors = {
      '.card[data-card-id="card-hidden"]': null,
      '.column[data-column-id="col-live"]': columnEl
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
    })).toBe(null);
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

  it('does NOT fall back to a column when cardId is set but card isnt rendered (waits via retry instead)', () => {
    // Mirrors the contract change in the findBoardEntityElement test
    // above. focusHierarchyTargetLocally returns false (no element
    // found) instead of focusing the column surrogate. The
    // orderHelpers attempt() retry loop will re-try up to ~3s; if
    // the card never appears, focus silently fails — better than
    // landing on the wrong target the user can't act on.
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

    // First attempt returns false (card not rendered). The retry
    // loop schedules another via setTimeout, but in test environment
    // we just verify the initial attempt's return value.
    expect(BoardSearch.focusHierarchyTargetLocally({
      cardId: 'card-hidden',
      columnId: 'col-live',
      rowId: 'row-main',
      stackId: 'stack-active'
    })).toBe(false);
    expect(columnEl.scrollIntoView).not.toHaveBeenCalled();
    expect(focusBoardEntity).not.toHaveBeenCalled();
  });

  it('focuses a card by visible column/card indices when no stable card id is available', () => {
    const cardEl = {
      classList: createClassList(['card']),
      scrollIntoView: vi.fn()
    };
    const selectors = {
      '.card[data-col-index="7"][data-card-index="3"]': cardEl
    };
    const BoardSearch = createBoardSearch({
      querySelector(selector) {
        return Object.prototype.hasOwnProperty.call(selectors, selector) ? selectors[selector] : null;
      }
    });
    const focusCard = vi.fn();
    BoardSearch.init({
      escapeAttr: (v) => String(v),
      focusCard
    });

    expect(BoardSearch.focusHierarchyTargetLocally({
      columnIndex: 7,
      cardIndex: 3
    })).toBe(true);

    expect(focusCard).toHaveBeenCalledWith(cardEl);
  });

  // Dashboard-result click reveals the matching card in the board view —
  // the action ultimately routes to focusHierarchyTargetLocally with a
  // `cardId`. When the card is rendered, the helper must call
  // focusCard(el) (which highlights + reveals the card) and skip the
  // column-fallback path that would scroll an entire column instead.
  it('focuses the rendered card directly when the card element exists (dashboard reveal happy path)', () => {
    const cardEl = {
      classList: createClassList(['card']),
      scrollIntoView: vi.fn()
    };
    const selectors = {
      '.card[data-card-id="card-rendered"]': cardEl
    };
    const BoardSearch = createBoardSearch({
      querySelector(selector) {
        return Object.prototype.hasOwnProperty.call(selectors, selector) ? selectors[selector] : null;
      }
    });
    const focusCard = vi.fn();
    const unfocusCard = vi.fn();
    const focusBoardEntity = vi.fn();
    const syncSidebarToView = vi.fn();
    BoardSearch.init({
      escapeAttr: (v) => String(v),
      focusCard,
      unfocusCard,
      focusBoardEntity,
      syncSidebarToView
    });

    expect(BoardSearch.focusHierarchyTargetLocally({
      cardId: 'card-rendered',
      columnId: 'col-live'
    })).toBe(true);

    // Card-specific path: focusCard called with the rendered element.
    expect(focusCard).toHaveBeenCalledTimes(1);
    expect(focusCard).toHaveBeenCalledWith(cardEl);
    // Column-fallback signals must NOT have fired — the rendered card
    // already handled focus + reveal on its own.
    expect(unfocusCard).not.toHaveBeenCalled();
    expect(focusBoardEntity).not.toHaveBeenCalled();
    expect(syncSidebarToView).not.toHaveBeenCalled();
    expect(cardEl.scrollIntoView).not.toHaveBeenCalled();
  });

  it('returns false when no entity matches and no fallback is available (silent no-op)', () => {
    const BoardSearch = createBoardSearch({
      querySelector() { return null; }
    });
    const focusCard = vi.fn();
    const unfocusCard = vi.fn();
    const focusBoardEntity = vi.fn();
    BoardSearch.init({
      escapeAttr: (v) => String(v),
      focusCard,
      unfocusCard,
      focusBoardEntity
    });

    expect(BoardSearch.focusHierarchyTargetLocally({
      cardId: 'no-such-card',
      columnId: 'no-such-column',
      rowId: 'no-such-row',
      stackId: 'no-such-stack'
    })).toBe(false);

    // No focus side-effects when nothing was found.
    expect(focusCard).not.toHaveBeenCalled();
    expect(unfocusCard).not.toHaveBeenCalled();
    expect(focusBoardEntity).not.toHaveBeenCalled();
  });
});

describe('board search wiki search routing', () => {
  it('routes wiki searches into dashboard search instead of mutating header search input', async () => {
    const searchInput = { value: '' };
    const openDashboardSearch = vi.fn().mockResolvedValue(true);
    const performSearch = vi.fn();
    const BoardSearch = createBoardSearch({
      querySelector() {
        return null;
      }
    });

    BoardSearch.init({
      $searchInput: searchInput,
      isHeaderSearchExpanded() {
        return false;
      },
      setHeaderSearchExpanded: vi.fn(),
      openDashboardSearch,
      LexeraApi: {
        search: performSearch
      }
    });

    await BoardSearch.openWikiSearch('#priority');

    expect(openDashboardSearch).toHaveBeenCalledWith('#priority', undefined);
    expect(searchInput.value).toBe('');
    expect(performSearch).not.toHaveBeenCalled();
  });

  it('opens tag wiki documents through dashboard search', async () => {
    const openDashboardSearch = vi.fn().mockResolvedValue(true);
    const BoardSearch = createBoardSearch({
      querySelector() {
        return null;
      }
    });

    BoardSearch.init({
      resolveWikiDocument(name) {
        return { kind: 'tag', document: String(name || '').trim() };
      },
      openDashboardSearch
    });

    const resolved = await BoardSearch.openWikiDocument('#backend');

    expect(resolved).toEqual({ kind: 'tag', document: '#backend' });
    expect(openDashboardSearch).toHaveBeenCalledWith('#backend', undefined);
  });
});

describe('board search workspace-shell result routing', () => {
  it('preserves dashboard focus coordinates when routing through the workspace shell', async () => {
    const focusHierarchyTarget = vi.fn();
    const BoardSearch = createBoardSearch({
      querySelector() {
        return null;
      }
    });
    BoardSearch.init({
      isWorkspaceShellEnabled() {
        return true;
      },
      getWorkspaceShell() {
        return { focusHierarchyTarget };
      },
      getDashboardTreeApi() {
        return {
          parseOptionalSearchIndex(value) {
            if (value == null || value === '') return null;
            const parsed = parseInt(value, 10);
            return Number.isNaN(parsed) ? null : parsed;
          }
        };
      }
    });

    await BoardSearch.navigateToSearchResult({
      boardId: 'board-2',
      rowId: 'row-1',
      stackId: 'stack-1',
      columnId: 'col-1',
      cardId: '',
      columnIndex: '7',
      rowIndex: '2',
      stackIndex: '3',
      colLocalIndex: '4',
      cardIndex: '5',
      brokenSrc: 'docs/missing.md'
    });

    expect(focusHierarchyTarget).toHaveBeenCalledWith({
      boardId: 'board-2',
      rowId: 'row-1',
      stackId: 'stack-1',
      columnId: 'col-1',
      cardId: '',
      columnIndex: 7,
      rowIndex: 2,
      stackIndex: 3,
      colLocalIndex: 4,
      cardIndex: 5,
      brokenSrc: 'docs/missing.md'
    }, 'board-2', {});
  });
});
