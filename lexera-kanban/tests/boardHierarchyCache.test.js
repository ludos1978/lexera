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
    columns: [],
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
  const localStorage = Object.prototype.hasOwnProperty.call(options, 'localStorage')
    ? options.localStorage
    : createLocalStorage();
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
  it('does not mutate the window workspace when syncing context for a board in another workspace', () => {
    // A window owns exactly one workspace for its lifetime. Selecting a
    // board belonging to a different workspace must NOT change the
    // window's activeWorkspaceId / viewWorkspaceId — only the resolver
    // returns the board's workspace context for callers to inspect.
    const localStorage = createLocalStorage();
    const BoardList = loadBoardList({ localStorage });
    const state = {
      boards: [{ id: 'board-a', title: 'Board A', workspace_ids: ['ws-2'] }],
      remoteBoards: [],
      activeWorkspaceId: 'ws-1',
      viewWorkspaceId: 'ws-1',
    };
    const setActiveWorkspaceIdState = vi.fn();
    const setViewWorkspaceIdState = vi.fn();

    BoardList.init({
      get boards() { return state.boards; },
      get remoteBoards() { return state.remoteBoards; },
      get activeWorkspaceId() { return state.activeWorkspaceId; },
      get viewWorkspaceId() { return state.viewWorkspaceId; },
      get ALL_WORKSPACES_ID() { return '__all__'; },
      setActiveWorkspaceIdState,
      setViewWorkspaceIdState,
    });

    const context = BoardList.syncWorkspaceContextForBoard('board-a', { render: false });

    expect(context.workspaceId).toBe('ws-2');
    expect(state.activeWorkspaceId).toBe('ws-1');
    expect(state.viewWorkspaceId).toBe('ws-1');
    expect(setActiveWorkspaceIdState).not.toHaveBeenCalled();
    expect(setViewWorkspaceIdState).not.toHaveBeenCalled();
    expect(localStorage.getItem('lexera-active-workspace')).toBeNull();
  });

  it('does not mutate the window workspace when the active board belongs to multiple workspaces', () => {
    const localStorage = createLocalStorage();
    const BoardList = loadBoardList({ localStorage });
    const state = {
      boards: [{ id: 'board-a', title: 'Board A', workspace_ids: ['ws-1', 'ws-2'] }],
      remoteBoards: [],
      activeWorkspaceId: 'ws-2',
      viewWorkspaceId: 'ws-1',
    };
    const setActiveWorkspaceIdState = vi.fn();
    const setViewWorkspaceIdState = vi.fn();

    BoardList.init({
      get boards() { return state.boards; },
      get remoteBoards() { return state.remoteBoards; },
      get activeWorkspaceId() { return state.activeWorkspaceId; },
      get viewWorkspaceId() { return state.viewWorkspaceId; },
      get ALL_WORKSPACES_ID() { return '__all__'; },
      setActiveWorkspaceIdState,
      setViewWorkspaceIdState,
    });

    const context = BoardList.syncWorkspaceContextForBoard('board-a', { render: false });

    expect(context.workspaceId).toBe('ws-1');
    expect(state.activeWorkspaceId).toBe('ws-2');
    expect(state.viewWorkspaceId).toBe('ws-1');
    expect(setActiveWorkspaceIdState).not.toHaveBeenCalled();
    expect(setViewWorkspaceIdState).not.toHaveBeenCalled();
  });

  it('does not touch storage or workspace state when localStorage is unavailable', () => {
    const BoardList = loadBoardList({ localStorage: null });
    const state = {
      boards: [{ id: 'board-a', title: 'Board A', workspace_ids: ['ws-2'] }],
      remoteBoards: [],
      activeWorkspaceId: 'ws-1',
      viewWorkspaceId: 'ws-1',
    };
    const setActiveWorkspaceIdState = vi.fn();
    const setViewWorkspaceIdState = vi.fn();

    BoardList.init({
      get boards() { return state.boards; },
      get remoteBoards() { return state.remoteBoards; },
      get activeWorkspaceId() { return state.activeWorkspaceId; },
      get viewWorkspaceId() { return state.viewWorkspaceId; },
      get ALL_WORKSPACES_ID() { return '__all__'; },
      setActiveWorkspaceIdState,
      setViewWorkspaceIdState,
    });

    const context = BoardList.syncWorkspaceContextForBoard('board-a', { render: false });

    expect(context.workspaceId).toBe('ws-2');
    expect(state.activeWorkspaceId).toBe('ws-1');
    expect(state.viewWorkspaceId).toBe('ws-1');
    expect(setActiveWorkspaceIdState).not.toHaveBeenCalled();
    expect(setViewWorkspaceIdState).not.toHaveBeenCalled();
  });

  it('reconciliation never changes the window workspace when later board metadata arrives', () => {
    const localStorage = createLocalStorage();
    const BoardList = loadBoardList({ localStorage });
    const state = {
      activeBoardId: 'board-a',
      boards: [],
      remoteBoards: [],
      activeWorkspaceId: 'ws-1',
      viewWorkspaceId: 'ws-1',
    };
    const setActiveWorkspaceIdState = vi.fn();
    const setViewWorkspaceIdState = vi.fn();

    BoardList.init({
      get activeBoardId() { return state.activeBoardId; },
      get boards() { return state.boards; },
      get remoteBoards() { return state.remoteBoards; },
      get activeWorkspaceId() { return state.activeWorkspaceId; },
      get viewWorkspaceId() { return state.viewWorkspaceId; },
      get ALL_WORKSPACES_ID() { return '__all__'; },
      setActiveWorkspaceIdState,
      setViewWorkspaceIdState,
    });

    BoardList.reconcileActiveWorkspaceContext({ render: false });
    expect(state.activeWorkspaceId).toBe('ws-1');
    expect(state.viewWorkspaceId).toBe('ws-1');

    state.boards = [{ id: 'board-a', title: 'Board A', workspace_ids: ['ws-2'] }];

    const context = BoardList.reconcileActiveWorkspaceContext({ render: false });

    expect(context.workspaceId).toBe('ws-2');
    expect(state.activeWorkspaceId).toBe('ws-1');
    expect(state.viewWorkspaceId).toBe('ws-1');
    expect(setActiveWorkspaceIdState).not.toHaveBeenCalled();
    expect(setViewWorkspaceIdState).not.toHaveBeenCalled();
  });

  it('reconciliation leaves a manually focused workspace view untouched', () => {
    const localStorage = createLocalStorage();
    const BoardList = loadBoardList({ localStorage });
    const state = {
      activeBoardId: 'board-a',
      boards: [{ id: 'board-a', title: 'Board A', workspace_ids: ['ws-2'] }],
      remoteBoards: [],
      workspaces: [{ id: 'ws-1', name: 'Workspace One' }, { id: 'ws-2', name: 'Workspace Two' }],
      activeWorkspaceId: 'ws-2',
      viewWorkspaceId: 'ws-1',
      workspaceViewMode: 'manual',
    };
    const setActiveWorkspaceIdState = vi.fn();
    const setViewWorkspaceIdState = vi.fn();
    const setWorkspaceViewModeState = vi.fn();

    BoardList.init({
      get activeBoardId() { return state.activeBoardId; },
      get boards() { return state.boards; },
      get remoteBoards() { return state.remoteBoards; },
      get workspaces() { return state.workspaces; },
      get activeWorkspaceId() { return state.activeWorkspaceId; },
      get viewWorkspaceId() { return state.viewWorkspaceId; },
      get workspaceViewMode() { return state.workspaceViewMode; },
      get ALL_WORKSPACES_ID() { return '__all__'; },
      setActiveWorkspaceIdState,
      setViewWorkspaceIdState,
      setWorkspaceViewModeState,
    });

    const context = BoardList.reconcileActiveWorkspaceContext({ render: false });

    expect(context.workspaceId).toBe('ws-2');
    expect(state.activeWorkspaceId).toBe('ws-2');
    expect(state.viewWorkspaceId).toBe('ws-1');
    expect(state.workspaceViewMode).toBe('manual');
    expect(setActiveWorkspaceIdState).not.toHaveBeenCalled();
    expect(setViewWorkspaceIdState).not.toHaveBeenCalled();
    expect(setWorkspaceViewModeState).not.toHaveBeenCalled();
  });

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

describe('board hierarchy single-source contract', () => {
  it('skips hierarchy cache writes and rerenders in embedded mode', () => {
    const BoardList = loadBoardList();
    const renderBoardList = vi.fn();
    const api = {
      getBoardHierarchy: vi.fn(),
      getBoardHierarchyCached: vi.fn(),
    };

    BoardList.init({
      get embeddedMode() { return true; },
      renderBoardList,
      get LexeraApi() { return api; },
      get activeBoardId() { return null; },
      get fullBoardData() { return null; },
      get activeBoardData() { return null; },
    });

    BoardList.refreshBoardHierarchyProjection('board-a', createBoardData('Board A'), 'Board A');

    expect(BoardList.getBoardHierarchyRows('board-a')).toBe(null);
    expect(renderBoardList).not.toHaveBeenCalled();
    expect(api.getBoardHierarchy).not.toHaveBeenCalled();
  });

  it('returns an empty hierarchy when board data has no rows (legacy column-based payloads are no longer accepted)', () => {
    const BoardList = loadBoardList();
    BoardList.init({ renderBoardList() {} });

    BoardList.refreshBoardHierarchyProjection('board-no-rows', {
      title: 'No Rows Board',
      rows: [],
      columns: [{
        id: 'col-stale',
        index: 0,
        title: 'Backlog #row2',
        cards: [],
      }],
    }, 'No Rows Board', { render: false });

    // The legacy `columns` field is ignored — boards now use rows only.
    expect(BoardList.getBoardHierarchyRows('board-no-rows')).toEqual([]);
  });

  it('routes live-sync snapshots through commitLocalBoardChange when skipping render', () => {
    const BoardList = loadBoardList();
    const state = {
      activeBoardId: 'board-a',
      fullBoardData: createBoardData('Local Board'),
      activeBoardData: { id: 'board-a', version: 3, revision: 'rev-old' },
      liveSyncState: { boardId: 'board-a', board: null },
      _saveInFlight: false,
    };
    const commitLocalBoardChange = vi.fn();
    const setFullBoardData = vi.fn((nextBoard) => {
      state.fullBoardData = nextBoard;
    });
    const updateActiveBoardData = vi.fn((updater) => {
      const previous = state.activeBoardData;
      const draft = { ...previous };
      const next = updater(draft, previous);
      state.activeBoardData = typeof next === 'undefined' ? draft : next;
      return state.activeBoardData;
    });

    BoardList.init({
      get activeBoardId() { return state.activeBoardId; },
      get fullBoardData() { return state.fullBoardData; },
      get activeBoardData() { return state.activeBoardData; },
      get liveSyncState() { return state.liveSyncState; },
      get _saveInFlight() { return state._saveInFlight; },
      getAllColumnsFromBoardData(boardData) {
        const rows = Array.isArray(boardData && boardData.rows) ? boardData.rows : [];
        const columns = [];
        rows.forEach((row) => {
          const stacks = Array.isArray(row && row.stacks) ? row.stacks : [];
          stacks.forEach((stack) => {
            const stackColumns = Array.isArray(stack && stack.columns) ? stack.columns : [];
            stackColumns.forEach((column) => columns.push(column));
          });
        });
        return columns;
      },
      isBoardDirty() { return false; },
      ensureBoardRowsForMutation() {},
      getMutationBoardTitle(boardId, boardData) {
        return (boardData && boardData.title) || boardId || '';
      },
      setFullBoardData,
      updateActiveBoardData,
      clearBoardDirty() {},
      updateDisplayFromFullBoard() {},
      commitLocalBoardChange,
    });

    const incomingBoard = createBoardData('Incoming Board');
    const previousActiveBoardData = state.activeBoardData;
    BoardList.applyLiveSyncBoardSnapshot('board-a', incomingBoard, { skipRender: true });

    expect(setFullBoardData).toHaveBeenCalled();
    expect(updateActiveBoardData).toHaveBeenCalled();
    expect(state.activeBoardData).not.toBe(previousActiveBoardData);
    expect(state.activeBoardData.version).toBeUndefined();
    expect(state.activeBoardData.revision).toBeUndefined();
    expect(commitLocalBoardChange).toHaveBeenCalledWith(
      'board-a',
      state.fullBoardData,
      expect.objectContaining({
        setLocalState: false,
        refreshHierarchy: true,
      })
    );
  });

  it('routes rebased snapshots through commitLocalBoardChange with revision metadata', () => {
    const BoardList = loadBoardList();
    const state = {
      activeBoardId: 'board-a',
      fullBoardData: null,
      activeBoardData: { id: 'board-a' },
      _lastLoadedRevision: null,
    };
    const commitLocalBoardChange = vi.fn();
    const setFullBoardData = vi.fn((nextBoard) => {
      state.fullBoardData = nextBoard;
    });
    const updateActiveBoardData = vi.fn((updater) => {
      const previous = state.activeBoardData;
      const draft = { ...previous };
      const next = updater(draft, previous);
      state.activeBoardData = typeof next === 'undefined' ? draft : next;
      return state.activeBoardData;
    });

    BoardList.init({
      get activeBoardId() { return state.activeBoardId; },
      get fullBoardData() { return state.fullBoardData; },
      get activeBoardData() { return state.activeBoardData; },
      get _lastLoadedRevision() { return state._lastLoadedRevision; },
      setFullBoardData,
      updateActiveBoardData,
      ensureBoardRowsForMutation() {},
      getMutationBoardTitle(boardId, boardData) {
        return (boardData && boardData.title) || boardId || '';
      },
      setPendingExternalRebaseConflict() {},
      setLastLoadedGeneration() {},
      setLastLoadedRevision(nextRevision) {
        state._lastLoadedRevision = nextRevision;
      },
      updateDisplayFromFullBoard() {},
      commitLocalBoardChange,
      applyBoardSettings() {},
      refreshTargetedElements() {},
      refreshHeaderFileControls() {},
      scheduleDashboardRefresh() {},
      markBoardDirty() {},
      saveLocalBoardDraft() {},
      showNotification() {},
    });

    const workingBoard = createBoardData('Working Board');
    BoardList.applyRebasedBoardSnapshot(
      'board-a',
      workingBoard,
      createBoardData('Current Board'),
      { revision: 'rev-7', version: 11 },
      { silent: true }
    );

    expect(setFullBoardData).toHaveBeenCalledWith(workingBoard);
    expect(updateActiveBoardData).toHaveBeenCalled();
    expect(state.activeBoardData.version).toBe(11);
    expect(state.activeBoardData.revision).toBe('rev-7');
    expect(commitLocalBoardChange).toHaveBeenCalledWith(
      'board-a',
      state.fullBoardData,
      expect.objectContaining({
        setLocalState: false,
        refreshHierarchy: true,
        revision: 'rev-7',
      })
    );
  });
});
