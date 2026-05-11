import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function buildService() {
  return loadIIFE('sync/pollingService.js', 'LexeraPollingService', {
    window: {},
    console: globalThis.console,
    MouseEvent: globalThis.MouseEvent,
  });
}

function buildDeps(overrides = {}) {
  const deps = {
    connected: false,
    activeBoardId: 'board-1',
    fullBoardData: { rows: [] },
    boards: [],
    remoteBoards: [],
    searchMode: false,
    isEditing: false,
    workspaceShellEnabled: false,
    embeddedMode: false,
    embeddedPreferredBoardId: null,
    urlParams: new URLSearchParams(),
    _lastLoadedRevision: 'r-1',
    _lastLoadedGeneration: 1,
    LexeraApi: {
      checkStatus: vi.fn().mockResolvedValue(true),
      discover: vi.fn().mockResolvedValue('http://127.0.0.1:3456'),
      request: vi.fn().mockResolvedValue({ workspaces: [], default_workspace: null }),
      getBoards: vi.fn().mockResolvedValue({
        boards: [{ id: 'board-1', title: 'Board 1', generation: 2 }],
      }),
      getRemoteBoards: vi.fn().mockResolvedValue({ boards: [] }),
      getBoardChanges: vi.fn().mockResolvedValue({
        available: true,
        delta: { rows: {} },
        generation: 2,
        revision: 'r-2',
      }),
    },
    setConnectedState: vi.fn(function (value) { deps.connected = value; }),
    setWorkspaces: vi.fn(),
    resolveActiveWorkspaceId: vi.fn(),
    refreshWorkspaceMirrors: vi.fn(),
    setBoards: vi.fn(function (value) { deps.boards = value; }),
    setRemoteBoards: vi.fn(function (value) { deps.remoteBoards = value; }),
    renderBoardList: vi.fn(),
    refreshBoardHierarchyCache: vi.fn().mockResolvedValue(),
    findBoardMeta: vi.fn().mockReturnValue({ id: 'board-1', title: 'Board 1' }),
    refreshHeaderFileControls: vi.fn(),
    scheduleDashboardRefresh: vi.fn(),
    isBoardDirty: vi.fn().mockReturnValue(false),
    loadBoard: vi.fn().mockResolvedValue(true),
    applyPollingBoardDelta: vi.fn().mockReturnValue(true),
    connectSSEIfReady: vi.fn(),
    connectBackendLogStreamIfReady: vi.fn(),
    traceFrontendAction: vi.fn(),
    logFrontendIssue: vi.fn(),
    setShellActiveBoard: vi.fn(),
    renderMainView: vi.fn(),
    selectBoard: vi.fn(),
    closeLiveSyncSession: vi.fn(),
    setActiveBoardId: vi.fn(),
    setActiveBoardData: vi.fn(),
    setFullBoardData: vi.fn(),
    setLastLoadedGeneration: vi.fn(),
    setLastLoadedRevision: vi.fn(),
    isActiveRemoteBoard: vi.fn().mockReturnValue(false),
    summarizeBoardHierarchy: vi.fn().mockReturnValue({ rows: 0 }),
    loadTemplatesOnce: vi.fn(),
  };
  return Object.assign(deps, overrides);
}

describe('LexeraPollingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies a board delta instead of fully reloading the active board', async () => {
    const service = buildService();
    const deps = buildDeps();

    service.init(deps);
    await service.poll();

    expect(deps.LexeraApi.getBoardChanges).toHaveBeenCalledWith('board-1', 1);
    expect(deps.applyPollingBoardDelta).toHaveBeenCalledWith(
      'board-1',
      expect.objectContaining({
        available: true,
        generation: 2,
      })
    );
    expect(deps.loadBoard).not.toHaveBeenCalled();
  });

  it('falls back to full board reload when the delta is unavailable', async () => {
    const service = buildService();
    const deps = buildDeps({
      applyPollingBoardDelta: vi.fn().mockReturnValue(false),
    });

    service.init(deps);
    await service.poll();

    expect(deps.LexeraApi.getBoardChanges).toHaveBeenCalledWith('board-1', 1);
    expect(deps.loadBoard).toHaveBeenCalledWith('board-1');
  });

  it('refreshes workspace state after workspace reload', async () => {
    const service = buildService();
    const deps = buildDeps({
      activeWorkspaceId: 'ws-1',
      LexeraApi: {
        checkStatus: vi.fn().mockResolvedValue(true),
      discover: vi.fn().mockResolvedValue('http://127.0.0.1:3456'),
        request: vi.fn().mockResolvedValue({
          workspaces: [{ id: 'ws-1', name: 'Workspace 1' }],
          default_workspace: 'ws-1',
        }),
        getBoards: vi.fn().mockResolvedValue({
          boards: [{ id: 'board-1', title: 'Board 1', generation: 2 }],
        }),
        getRemoteBoards: vi.fn().mockResolvedValue({ boards: [] }),
        getBoardChanges: vi.fn().mockResolvedValue({
          available: true,
          delta: { rows: {} },
          generation: 2,
          revision: 'r-2',
        }),
      },
    });

    service.init(deps);
    await service.poll();

    expect(deps.setWorkspaces).toHaveBeenCalledWith([{ id: 'ws-1', name: 'Workspace 1', isDefault: true }]);
    expect(deps.resolveActiveWorkspaceId).toHaveBeenCalledWith('ws-1');
    expect(deps.refreshWorkspaceMirrors).toHaveBeenCalled();
  });

  it('does not treat board generation-only changes as workspace catalog changes', async () => {
    const service = buildService();
    const workspaceShell = { onBoardsUpdated: vi.fn() };
    const deps = buildDeps({
      workspaceShellEnabled: true,
      WorkspaceShell: workspaceShell,
      LexeraApi: {
        checkStatus: vi.fn().mockResolvedValue(true),
        discover: vi.fn().mockResolvedValue('http://127.0.0.1:3456'),
        request: vi.fn().mockResolvedValue({ workspaces: [], default_workspace: null }),
        getBoards: vi.fn()
          .mockResolvedValueOnce({ boards: [{ id: 'board-1', title: 'Board 1', generation: 1 }] })
          .mockResolvedValueOnce({ boards: [{ id: 'board-1', title: 'Board 1', generation: 2 }] }),
        getRemoteBoards: vi.fn().mockResolvedValue({ boards: [] }),
        getBoardChanges: vi.fn(),
      },
    });

    service.init(deps);
    await service.poll();
    await service.poll();

    expect(deps.setBoards).toHaveBeenCalledTimes(1);
    expect(deps.renderBoardList).toHaveBeenCalledTimes(1);
    expect(workspaceShell.onBoardsUpdated).toHaveBeenCalledTimes(1);
    expect(deps.refreshBoardHierarchyCache).toHaveBeenCalledTimes(2);
  });

  it('still refreshes the workspace catalog when board list metadata changes', async () => {
    const service = buildService();
    const workspaceShell = { onBoardsUpdated: vi.fn() };
    const deps = buildDeps({
      workspaceShellEnabled: true,
      WorkspaceShell: workspaceShell,
      LexeraApi: {
        checkStatus: vi.fn().mockResolvedValue(true),
        discover: vi.fn().mockResolvedValue('http://127.0.0.1:3456'),
        request: vi.fn().mockResolvedValue({ workspaces: [], default_workspace: null }),
        getBoards: vi.fn()
          .mockResolvedValueOnce({ boards: [{ id: 'board-1', title: 'Board 1', generation: 1 }] })
          .mockResolvedValueOnce({ boards: [{ id: 'board-1', title: 'Renamed Board', generation: 1 }] }),
        getRemoteBoards: vi.fn().mockResolvedValue({ boards: [] }),
        getBoardChanges: vi.fn(),
      },
    });

    service.init(deps);
    await service.poll();
    await service.poll();

    expect(deps.setBoards).toHaveBeenCalledTimes(2);
    expect(deps.renderBoardList).toHaveBeenCalledTimes(2);
    expect(workspaceShell.onBoardsUpdated).toHaveBeenCalledTimes(2);
  });

  it('skips global workspace and sidebar refreshes in embedded mode', async () => {
    const service = buildService();
    const deps = buildDeps({
      embeddedMode: true,
      embeddedPreferredBoardId: 'board-1',
    });

    service.init(deps);
    await service.poll();

    expect(deps.LexeraApi.request).not.toHaveBeenCalled();
    expect(deps.LexeraApi.getBoards).not.toHaveBeenCalled();
    expect(deps.LexeraApi.getRemoteBoards).not.toHaveBeenCalled();
    expect(deps.renderBoardList).not.toHaveBeenCalled();
    expect(deps.refreshBoardHierarchyCache).not.toHaveBeenCalled();
    expect(deps.LexeraApi.getBoardChanges).toHaveBeenCalledWith('board-1', 1);
    expect(deps.applyPollingBoardDelta).toHaveBeenCalledWith(
      'board-1',
      expect.objectContaining({
        available: true,
        generation: 2,
      })
    );
    expect(deps.scheduleDashboardRefresh).not.toHaveBeenCalled();
  });

  it('does not rerender embedded boards when generation is unchanged', async () => {
    const service = buildService();
    const deps = buildDeps({
      embeddedMode: true,
      embeddedPreferredBoardId: 'board-1',
      LexeraApi: {
        checkStatus: vi.fn().mockResolvedValue(true),
      discover: vi.fn().mockResolvedValue('http://127.0.0.1:3456'),
        request: vi.fn(),
        getBoards: vi.fn(),
        getRemoteBoards: vi.fn(),
        getBoardChanges: vi.fn().mockResolvedValue({
          available: true,
          delta: {},
          generation: 1,
          revision: 'r-1',
        }),
      },
    });

    service.init(deps);
    await service.poll();

    expect(deps.LexeraApi.getBoardChanges).toHaveBeenCalledWith('board-1', 1);
    expect(deps.applyPollingBoardDelta).not.toHaveBeenCalled();
    expect(deps.loadBoard).not.toHaveBeenCalled();
    expect(deps.scheduleDashboardRefresh).not.toHaveBeenCalled();
  });

  it('selects the embedded preferred board without loading workspace lists', async () => {
    const service = buildService();
    const deps = buildDeps({
      embeddedMode: true,
      activeBoardId: null,
      embeddedPreferredBoardId: 'board-2',
    });

    service.init(deps);
    await service.poll();

    expect(deps.selectBoard).toHaveBeenCalledWith('board-2');
    expect(deps.LexeraApi.request).not.toHaveBeenCalled();
    expect(deps.LexeraApi.getBoards).not.toHaveBeenCalled();
    expect(deps.LexeraApi.getRemoteBoards).not.toHaveBeenCalled();
  });
});
