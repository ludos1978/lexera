import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

function createBoardData(title) {
  return {
    title,
    rows: [{
      id: 'row-1',
      title: 'Row',
      stacks: [{
        id: 'stack-1',
        title: 'Stack',
        columns: [{
          id: 'col-1',
          index: 0,
          title: 'Column',
          cards: [{ id: 'card-1', content: 'Card' }],
        }],
      }],
    }],
  };
}

function loadBoardList(options = {}) {
  const code = fs.readFileSync(
    path.resolve('src/board/boardList.js'),
    'utf8'
  );
  const localStorage = options.localStorage || createLocalStorage();
  const context = {
    console,
    Date,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
    structuredClone,
    localStorage,
    lexeraLog: () => {},
    logFrontendIssue: () => {},
  };
  context.window = context;
  vm.runInNewContext(code, context, { filename: 'boardList.js' });
  return context.window.LexeraBoardList;
}

describe('board hierarchy cache refresh', () => {
  it('reuses cached hierarchy rows instead of reloading every board on each pass', async () => {
    const localStorage = createLocalStorage();
    localStorage.setItem('lexera-sidebar-expanded', JSON.stringify(['board-b', 'board-c']));
    const BoardList = loadBoardList({ localStorage });
    const state = {
      activeBoardId: 'board-a',
      fullBoardData: createBoardData('Active Board'),
      activeBoardData: {
        rows: createBoardData('Active Board').rows,
        revision: 'rev-active',
      },
    };
    const api = {
      getBoardHierarchy: vi.fn(async (boardId) => ({
        title: 'Board ' + boardId,
        revision: 'rev-' + boardId,
        rows: createBoardData('Board ' + boardId).rows,
      })),
      getBoardHierarchyCached: vi.fn(),
    };
    const renderBoardList = vi.fn();

    BoardList.init({
      get activeBoardId() { return state.activeBoardId; },
      get fullBoardData() { return state.fullBoardData; },
      get activeBoardData() { return state.activeBoardData; },
      get LexeraApi() { return api; },
      renderBoardList,
    });

    const boards = [
      { id: 'board-a', title: 'Active Board' },
      { id: 'board-b', title: 'Board B' },
      { id: 'board-c', title: 'Board C' },
    ];

    await BoardList.refreshBoardHierarchyCache(boards);
    await BoardList.refreshBoardHierarchyCache(boards);

    expect(api.getBoardHierarchy).toHaveBeenCalledTimes(2);
    expect(api.getBoardHierarchy).toHaveBeenCalledWith('board-b');
    expect(api.getBoardHierarchy).toHaveBeenCalledWith('board-c');
    expect(api.getBoardHierarchyCached).not.toHaveBeenCalled();
    expect(BoardList.getBoardHierarchyRows('board-a')).toEqual(state.fullBoardData.rows);
  });

  it('only hydrates hierarchy for the active or expanded boards', async () => {
    const localStorage = createLocalStorage();
    localStorage.setItem('lexera-sidebar-expanded', JSON.stringify(['board-b']));
    const BoardList = loadBoardList({ localStorage });
    const state = {
      activeBoardId: 'board-a',
      fullBoardData: createBoardData('Active Board'),
      activeBoardData: {
        rows: createBoardData('Active Board').rows,
        revision: 'rev-active',
      },
    };
    const api = {
      getBoardHierarchy: vi.fn(async (boardId) => ({
        title: 'Board ' + boardId,
        revision: 'rev-' + boardId,
        rows: createBoardData('Board ' + boardId).rows,
      })),
      getBoardHierarchyCached: vi.fn(),
    };
    BoardList.init({
      get activeBoardId() { return state.activeBoardId; },
      get fullBoardData() { return state.fullBoardData; },
      get activeBoardData() { return state.activeBoardData; },
      get LexeraApi() { return api; },
      renderBoardList: () => {},
    });

    const boards = [
      { id: 'board-a', title: 'Active Board' },
      { id: 'board-b', title: 'Board B' },
      { id: 'board-c', title: 'Board C' },
    ];

    await BoardList.refreshBoardHierarchyCache(boards);

    expect(api.getBoardHierarchy).toHaveBeenCalledTimes(1);
    expect(api.getBoardHierarchy).toHaveBeenCalledWith('board-b');
  });

  it('dedupes in-flight hierarchy loads and caps refresh concurrency', async () => {
    const localStorage = createLocalStorage();
    localStorage.setItem('lexera-sidebar-expanded', JSON.stringify(['board-1', 'board-2', 'board-3']));
    const BoardList = loadBoardList({ localStorage });
    const state = {
      activeBoardId: '',
      fullBoardData: null,
      activeBoardData: null,
    };
    let concurrent = 0;
    let maxConcurrent = 0;
    const api = {
      getBoardHierarchy: vi.fn((boardId) => new Promise((resolve) => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        setTimeout(() => {
          concurrent -= 1;
          resolve({
            title: 'Board ' + boardId,
            revision: 'rev-' + boardId,
            rows: createBoardData('Board ' + boardId).rows,
          });
        }, 0);
      })),
      getBoardHierarchyCached: vi.fn(),
    };

    BoardList.init({
      get activeBoardId() { return state.activeBoardId; },
      get fullBoardData() { return state.fullBoardData; },
      get activeBoardData() { return state.activeBoardData; },
      get LexeraApi() { return api; },
      renderBoardList: () => {},
    });

    const boards = [
      { id: 'board-1', title: 'Board 1' },
      { id: 'board-2', title: 'Board 2' },
      { id: 'board-3', title: 'Board 3' },
    ];

    await Promise.all([
      BoardList.refreshBoardHierarchyCache(boards),
      BoardList.refreshBoardHierarchyCache(boards),
    ]);

    expect(api.getBoardHierarchy).toHaveBeenCalledTimes(3);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});
