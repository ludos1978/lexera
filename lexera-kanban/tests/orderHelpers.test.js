import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

let OrderHelpers;
let localStorageMock;
let renderBoardList;

function createStorage(initialValues = {}) {
  const store = { ...initialValues };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    }
  };
}

beforeAll(() => {
  OrderHelpers = loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers', {
    window: {},
    document: {}
  });
});

beforeEach(() => {
  localStorageMock = createStorage();
  renderBoardList = vi.fn();
  globalThis.localStorage = localStorageMock;
  OrderHelpers.init({
    boards: [
      { id: 'board-a', title: 'A' },
      { id: 'board-b', title: 'B' },
      { id: 'board-c', title: 'C' }
    ],
    renderBoardList
  });
});

describe('orderHelpers.reorderBoards', () => {
  it('reorders persisted board order by board id', () => {
    localStorageMock.setItem('lexera-board-order', JSON.stringify(['board-a', 'board-b', 'board-c']));

    OrderHelpers.reorderBoards('board-c', 'board-a', true);

    expect(localStorageMock.getItem('lexera-board-order')).toBe(JSON.stringify(['board-c', 'board-a', 'board-b']));
    expect(renderBoardList).toHaveBeenCalledTimes(1);
  });

  it('ignores invalid numeric refs instead of saving undefined entries', () => {
    localStorageMock.setItem('lexera-board-order', JSON.stringify(['board-a', 'board-b', 'board-c']));

    expect(() => OrderHelpers.reorderBoards(9, 0, true)).not.toThrow();
    expect(localStorageMock.getItem('lexera-board-order')).toBe(JSON.stringify(['board-a', 'board-b', 'board-c']));
    expect(renderBoardList).not.toHaveBeenCalled();
  });
});

describe('orderHelpers.setShellActiveBoard', () => {
  it('routes shell board activation through workspace context sync', () => {
    vi.useFakeTimers();
    try {
      const setActiveBoardId = vi.fn();
      const syncWorkspaceContextForBoard = vi.fn();
      const trackRecentBoard = vi.fn();

      OrderHelpers.init({
        setActiveBoardId,
        syncWorkspaceContextForBoard,
        trackRecentBoard,
        embeddedMode: false,
        getElDashboardRoot: () => null
      });

      OrderHelpers.setShellActiveBoard('board-b');

      expect(setActiveBoardId).toHaveBeenCalledWith('board-b');
      expect(syncWorkspaceContextForBoard).toHaveBeenCalledWith('board-b');
      expect(trackRecentBoard).toHaveBeenCalledWith('board-b');
      // Active board is per-window in-memory state — must NOT be
      // persisted to the shared Settings store, otherwise sibling
      // windows would auto-mirror each other on cold start.
      expect(localStorageMock.getItem('lexera-last-board')).toBeNull();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('orderHelpers.handleEmbeddedHierarchyFocusMessage', () => {
  it('hydrates embedded board metadata from the parent workspace catalog', () => {
    const setBoards = vi.fn();
    const setRemoteBoards = vi.fn();
    const setWorkspaces = vi.fn();

    OrderHelpers.init({
      embeddedMode: true,
      setBoards,
      setRemoteBoards,
      setWorkspaces
    });

    OrderHelpers.handleEmbeddedHierarchyFocusMessage({
      data: {
        type: 'lexera-workspace-catalog',
        boards: [{ id: 'board-a', title: 'Board A' }],
        remoteBoards: [{ id: 'remote-a', title: 'Remote A' }],
        workspaces: [{ id: 'ws-1', name: 'Workspace 1' }]
      }
    });

    expect(setBoards).toHaveBeenCalledWith([{ id: 'board-a', title: 'Board A' }]);
    expect(setRemoteBoards).toHaveBeenCalledWith([{ id: 'remote-a', title: 'Remote A' }]);
    expect(setWorkspaces).toHaveBeenCalledWith([{ id: 'ws-1', name: 'Workspace 1' }]);
  });

  it('focuses hierarchy targets locally inside the embedded board frame', async () => {
    const focusCard = vi.fn();
    const navigateLocallyThroughBoardNavigation = vi.fn();
    const routeThroughWorkspaceNavigation = vi.fn();
    const cardEl = {
      classList: {
        contains(name) {
          return name === 'card';
        }
      },
      scrollIntoView: vi.fn()
    };
    const container = {
      querySelector(selector) {
        if (selector === '.card[data-card-id="card-1"]') return cardEl;
        return null;
      }
    };
    const EmbeddedOrderHelpers = loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers', {
      window: {},
      document: {
        getElementById(id) {
          return id === 'columns-container' ? container : null;
        }
      }
    });
    EmbeddedOrderHelpers.init({
      embeddedMode: true,
      getBoardNavigationApi() {
        return {
          navigateToHierarchyTarget(target, options) {
            navigateLocallyThroughBoardNavigation(target);
            return Promise.resolve(options.focusHierarchyTargetLocally(target));
          }
        };
      },
      getActiveBoardData() {
        return { id: 'board-1' };
      },
      focusBoardEntity: vi.fn(),
      focusCard,
      // The embedded-iframe focus path now delegates to the canonical
      // findBoardEntityElement (defined in boardSearch.js, exposed via
      // app.js wiring). In test fixtures we mock it to mirror what the
      // production implementation would return for this target shape.
      findBoardEntityElement(target) {
        return target && target.cardId === 'card-1' ? cardEl : null;
      },
      navigateToHierarchyTarget: routeThroughWorkspaceNavigation
    });

    EmbeddedOrderHelpers.handleEmbeddedHierarchyFocusMessage({
      data: {
        type: 'lexera-focus-hierarchy-target',
        target: {
          boardId: 'board-1',
          cardId: 'card-1'
        }
      }
    });

    await vi.waitFor(() => expect(focusCard).toHaveBeenCalledWith(cardEl));
    expect(navigateLocallyThroughBoardNavigation).toHaveBeenCalledWith({
      boardId: 'board-1',
      cardId: 'card-1'
    });
    expect(routeThroughWorkspaceNavigation).not.toHaveBeenCalled();
  });

  it('listens for dashboard navigation broadcasts inside the matching embedded board', async () => {
    const focusCard = vi.fn();
    let dashboardNavigateHandler = null;
    const cardEl = {
      classList: {
        contains(name) {
          return name === 'card';
        }
      },
      scrollIntoView: vi.fn()
    };
    const container = {
      querySelector(selector) {
        if (selector === '.card[data-card-id="card-1"]') return cardEl;
        return null;
      }
    };
    const EmbeddedOrderHelpers = loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers', {
      window: {
        __TAURI__: {
          event: {
            listen(eventName, handler) {
              if (eventName === 'dashboard-navigate') dashboardNavigateHandler = handler;
            }
          }
        }
      },
      document: {
        getElementById(id) {
          return id === 'columns-container' ? container : null;
        }
      }
    });
    EmbeddedOrderHelpers.init({
      embeddedMode: true,
      activeBoardId: 'board-1',
      getBoardNavigationApi() {
        return {
          navigateToHierarchyTarget(target, options) {
            return Promise.resolve(options.focusHierarchyTargetLocally(target));
          }
        };
      },
      getActiveBoardData() {
        return { id: 'board-1' };
      },
      focusBoardEntity: vi.fn(),
      focusCard,
      findBoardEntityElement(target) {
        return target && target.cardId === 'card-1' ? cardEl : null;
      }
    });

    expect(typeof dashboardNavigateHandler).toBe('function');
    dashboardNavigateHandler({
      payload: {
        nav: {
          boardId: 'board-1',
          cardId: 'card-1'
        }
      }
    });

    await vi.waitFor(() => expect(focusCard).toHaveBeenCalledWith(cardEl));
  });
});

describe('orderHelpers.navigateHierarchyTargetInIframe', () => {
  it('falls back from a hidden card target to the owning column in embedded mode', async () => {
    const focusBoardEntity = vi.fn();
    const focusCard = vi.fn();
    const columnEl = {
      classList: {
        contains(name) {
          return name === 'column';
        }
      },
      scrollIntoView: vi.fn()
    };
    const container = {
      querySelector(selector) {
        if (selector === '.card[data-card-id="card-hidden"]') return null;
        if (selector === '.column[data-column-id="col-live"]') return columnEl;
        return null;
      }
    };
    const documentMock = {
      getElementById(id) {
        return id === 'columns-container' ? container : null;
      }
    };
    const EmbeddedOrderHelpers = loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers', {
      window: {},
      document: documentMock
    });
    EmbeddedOrderHelpers.init({
      getBoardNavigationApi() {
        return {
          navigateToHierarchyTarget(target, options) {
            return Promise.resolve(options.focusHierarchyTargetLocally(target));
          }
        };
      },
      getActiveBoardData() {
        return { id: 'board-1' };
      },
      focusBoardEntity,
      focusCard,
      // Mock the canonical lookup: 'card-hidden' is intentionally
      // not in the DOM, so findBoardEntityElement falls through to
      // the columnId branch (mirroring its real selector chain:
      // cardId → columnIndex/cardIndex → columnId → ...).
      findBoardEntityElement(target) {
        if (!target) return null;
        if (target.columnId === 'col-live') return columnEl;
        return null;
      }
    });

    const result = await EmbeddedOrderHelpers.navigateHierarchyTargetInIframe({
      boardId: 'board-1',
      cardId: 'card-hidden',
      columnId: 'col-live',
      rowId: 'row-main',
      stackId: 'stack-active'
    });

    expect(result).toBe(true);
    expect(columnEl.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(focusBoardEntity).toHaveBeenCalledWith(columnEl);
    expect(focusCard).not.toHaveBeenCalled();
  });

  it('focuses a dashboard target by visible column/card indices inside an embedded board', async () => {
    const focusBoardEntity = vi.fn();
    const focusCard = vi.fn();
    const cardEl = {
      classList: {
        contains(name) {
          return name === 'card';
        }
      },
      scrollIntoView: vi.fn()
    };
    const container = {
      querySelector(selector) {
        if (selector === '.card[data-col-index="7"][data-card-index="3"]') return cardEl;
        return null;
      }
    };
    const documentMock = {
      getElementById(id) {
        return id === 'columns-container' ? container : null;
      }
    };
    const EmbeddedOrderHelpers = loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers', {
      window: {},
      document: documentMock
    });
    EmbeddedOrderHelpers.init({
      getBoardNavigationApi() {
        return {
          navigateToHierarchyTarget(target, options) {
            return Promise.resolve(options.focusHierarchyTargetLocally(target));
          }
        };
      },
      getActiveBoardData() {
        return { id: 'board-1' };
      },
      focusBoardEntity,
      focusCard,
      // Mock the canonical lookup: visible column/card indices match.
      findBoardEntityElement(target) {
        if (target && target.columnIndex === 7 && target.cardIndex === 3) return cardEl;
        return null;
      }
    });

    const result = await EmbeddedOrderHelpers.navigateHierarchyTargetInIframe({
      boardId: 'board-1',
      columnIndex: 7,
      cardIndex: 3
    });

    expect(result).toBe(true);
    expect(cardEl.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(focusCard).toHaveBeenCalledWith(cardEl);
    expect(focusBoardEntity).not.toHaveBeenCalled();
  });

  it('handler still focuses when init has not yet wired the embeddedMode dep, as long as URL has ?embedded=1', async () => {
    // Regression fence (paired with the IIFE-load listener fix at
    // 9bea04a3). Even if the listener is registered at module load,
    // the handler body's internal `embeddedMode` gate could still
    // silently bail if `_dep('embeddedMode')` hasn't been populated
    // by OrderHelpers.init yet. Stage 3b: when the dep is missing,
    // fall back to the URL param the shell uses to identify the
    // board webview (`?embedded=1` per app.js:636).
    const focusCard = vi.fn();
    function makeClassList(classes) {
      const set = new Set(classes);
      return {
        contains(name) { return set.has(name); },
        add(name) { set.add(name); },
        remove(name) { set.delete(name); }
      };
    }
    const cardEl = {
      classList: makeClassList(['card']),
      scrollIntoView: vi.fn(),
      parentNode: null
    };
    const documentMock = { getElementById() { return { querySelector: () => null }; } };
    const EmbeddedOrderHelpers = loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers', {
      window: {
        // No `LexeraSubApp` / `__TAURI__` — same shape as a board webview
        // mid-bootstrap before deps wire up.
        location: { search: '?embedded=1&pane=test-pane' }
      },
      document: documentMock
    });
    // init() with NO embeddedMode key — simulates the init-time race
    // where the dep is missing.
    EmbeddedOrderHelpers.init({
      // No embeddedMode property — falsy via _dep.
      getBoardNavigationApi() {
        return {
          navigateToHierarchyTarget(target, options) {
            return Promise.resolve(options.focusHierarchyTargetLocally(target));
          }
        };
      },
      getActiveBoardData() { return { id: 'board-1' }; },
      focusCard,
      findBoardEntityElement() { return cardEl; }
    });

    // Drive the handler directly with a focus message — the URL-fallback
    // gate should let it through even though the dep is undefined.
    EmbeddedOrderHelpers.handleEmbeddedHierarchyFocusMessage({
      data: {
        type: 'lexera-focus-hierarchy-target',
        target: { boardId: 'board-1', cardId: 'kid-abc' }
      }
    });

    await vi.waitFor(() => expect(focusCard).toHaveBeenCalledWith(cardEl));
  });

  it('registers handleEmbeddedHierarchyFocusMessage on window.message at module load (bootstrap-time, not init-time)', () => {
    // Regression fence (user report 2026-05-13: "focussing a card in the
    // kanban view by selecting it in the workspace still doesnt work").
    // Trace showed embeddedBoardBridge.dispatch fired a MessageEvent on
    // window but orderHelpers.handlerEnter never ran — because the
    // listener was previously only wired inside setupEmbeddedPaneActivation
    // which gated on `_dep('embeddedMode')`, an init-time race the
    // bootstrap couldn't survive. Now the listener registers once at
    // IIFE evaluation; the handler body's own embeddedMode gate keeps
    // non-embedded contexts no-op.
    const listeners = [];
    const fakeWindow = {
      addEventListener(type, handler) {
        listeners.push({ type: type, handler: handler });
      }
    };
    loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers', {
      window: fakeWindow,
      document: {}
    });
    const messageListeners = listeners.filter((entry) => entry.type === 'message');
    expect(messageListeners).toHaveLength(1);
    expect(typeof messageListeners[0].handler).toBe('function');
  });

  it('unfolds any folded ancestors before scrollIntoView so a workspace-tree card click reveals the card', async () => {
    // User report 2026-05-13: focussing a card from the workspace view
    // doesn't work because workspace tree clicks only carry the card id
    // (no row/stack/column ancestor ids), so the upstream
    // `unfoldSearchTarget` can't unfold anything. Fix: walk up the DOM
    // ancestor chain from the found card element and remove `.folded`
    // from any ancestor that has it.
    const focusCard = vi.fn();
    const saveFoldState = vi.fn();
    function makeClassList(classes) {
      const set = new Set(classes);
      return {
        contains(name) { return set.has(name); },
        add(name) { set.add(name); },
        remove(name) { set.delete(name); }
      };
    }
    // DOM chain: rowEl (folded) > stackEl (folded) > columnEl (folded) > cardEl
    const cardEl = {
      classList: makeClassList(['card']),
      scrollIntoView: vi.fn(),
      parentNode: null
    };
    const columnEl = { classList: makeClassList(['column', 'folded']), parentNode: null };
    const stackEl = { classList: makeClassList(['board-stack', 'folded']), parentNode: null };
    const rowEl = { classList: makeClassList(['board-row', 'folded']), parentNode: null };
    cardEl.parentNode = columnEl;
    columnEl.parentNode = stackEl;
    stackEl.parentNode = rowEl;
    // rowEl.parentNode left null — loop terminates naturally.
    const documentMock = {
      getElementById(id) {
        return id === 'columns-container'
          ? { querySelector: () => null }
          : null;
      }
    };
    const EmbeddedOrderHelpers = loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers', {
      window: {},
      document: documentMock
    });
    EmbeddedOrderHelpers.init({
      getBoardNavigationApi() {
        return {
          navigateToHierarchyTarget(target, options) {
            return Promise.resolve(options.focusHierarchyTargetLocally(target));
          }
        };
      },
      getActiveBoardData() { return { id: 'board-1' }; },
      focusCard,
      saveFoldState,
      // Workspace-tree click target has only { boardId, cardId } —
      // mirror findBoardEntityElement returning the cardEl from the kid lookup.
      findBoardEntityElement(target) {
        return target && target.cardId === 'kid-abc123' ? cardEl : null;
      }
    });

    const result = await EmbeddedOrderHelpers.navigateHierarchyTargetInIframe({
      boardId: 'board-1',
      cardId: 'kid-abc123'
      // no rowId / stackId / columnId — matches workspace tree click shape
    });

    expect(result).toBe(true);
    // All three folded ancestors were unfolded before scrollIntoView fired
    expect(columnEl.classList.contains('folded')).toBe(false);
    expect(stackEl.classList.contains('folded')).toBe(false);
    expect(rowEl.classList.contains('folded')).toBe(false);
    expect(cardEl.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(focusCard).toHaveBeenCalledWith(cardEl);
    expect(saveFoldState).toHaveBeenCalledTimes(1);
  });

  it('does not call saveFoldState when no folded ancestor was found', async () => {
    // Negative case: if all ancestors are already unfolded the saveFoldState
    // hook stays untouched so we don't churn localStorage unnecessarily.
    const focusCard = vi.fn();
    const saveFoldState = vi.fn();
    function makeClassList(classes) {
      const set = new Set(classes);
      return {
        contains(name) { return set.has(name); },
        add(name) { set.add(name); },
        remove(name) { set.delete(name); }
      };
    }
    const cardEl = {
      classList: makeClassList(['card']),
      scrollIntoView: vi.fn(),
      parentNode: { classList: makeClassList(['column']), parentNode: null }
    };
    const documentMock = {
      getElementById() { return { querySelector: () => null }; }
    };
    const EmbeddedOrderHelpers = loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers', {
      window: {},
      document: documentMock
    });
    EmbeddedOrderHelpers.init({
      getBoardNavigationApi() {
        return {
          navigateToHierarchyTarget(target, options) {
            return Promise.resolve(options.focusHierarchyTargetLocally(target));
          }
        };
      },
      getActiveBoardData() { return { id: 'board-1' }; },
      focusCard,
      saveFoldState,
      findBoardEntityElement() { return cardEl; }
    });

    const result = await EmbeddedOrderHelpers.navigateHierarchyTargetInIframe({
      boardId: 'board-1',
      cardId: 'any'
    });

    expect(result).toBe(true);
    expect(saveFoldState).not.toHaveBeenCalled();
    expect(cardEl.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe('orderHelpers dashboard scope filtering', () => {
  it('keeps all-scope dashboard results within the workspace currently shown by the shell', () => {
    OrderHelpers.init({
      dashboardState: { scope: 'all' },
      workspaceShellEnabled: true,
      ALL_WORKSPACES_ID: '__all__',
      viewWorkspaceId: 'ws-1',
      activeWorkspaceId: 'ws-2',
      boards: [
        { id: 'board-1', workspace_ids: ['ws-1'] },
        { id: 'board-2', workspace_ids: ['ws-2'] },
        { id: 'board-3', workspace_ids: ['ws-1', 'ws-2'] }
      ]
    });

    expect(OrderHelpers.filterDashboardResultsByScope([
      { boardId: 'board-1', cardId: 'a' },
      { boardId: 'board-2', cardId: 'b' },
      { boardId: 'board-3', cardId: 'c' },
      { boardId: 'board-missing', cardId: 'd' }
    ])).toEqual([
      { boardId: 'board-1', cardId: 'a' },
      { boardId: 'board-3', cardId: 'c' }
    ]);
    expect(OrderHelpers.getDashboardScopedBoardIds()).toEqual(['board-1', 'board-3']);
  });

  it('active dashboard scope still narrows to the active board only', () => {
    OrderHelpers.init({
      dashboardState: { scope: 'active' },
      workspaceShellEnabled: true,
      activeBoardId: 'board-2',
      viewWorkspaceId: 'ws-1',
      boards: [
        { id: 'board-1', workspace_ids: ['ws-1'] },
        { id: 'board-2', workspace_ids: ['ws-2'] }
      ]
    });

    expect(OrderHelpers.filterDashboardResultsByScope([
      { boardId: 'board-1', cardId: 'a' },
      { boardId: 'board-2', cardId: 'b' }
    ])).toEqual([
      { boardId: 'board-2', cardId: 'b' }
    ]);
    expect(OrderHelpers.buildDashboardDataRequestOptions(
      'login',
      ['#important'],
      { limit: 30, truncate: 200 },
      { limit: 20 }
    )).toEqual({
      q: 'login',
      tags: ['#important'],
      searchLimit: 30,
      searchTruncate: 200,
      calendarLimit: 20,
      boardIds: ['board-2']
    });
  });
});
