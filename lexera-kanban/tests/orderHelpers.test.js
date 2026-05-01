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
      focusCard
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
      focusCard
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
      focusCard
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
