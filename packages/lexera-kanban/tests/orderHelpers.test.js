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
