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
      expect(localStorageMock.getItem('lexera-last-board')).toBe('board-b');
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
});
