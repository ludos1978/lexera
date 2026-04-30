// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function makeBoardData(title) {
  return {
    title: 'Board',
    rows: [{
      id: 'row-1',
      title: 'Row A',
      stacks: [{
        id: 'stack-1',
        title: 'Stack A',
        columns: [{
          id: 'col-1',
          index: 0,
          title: title,
          cards: []
        }]
      }]
    }],
    columns: []
  };
}

function makeDeps(store) {
  return {
    getFullBoardData: () => store.fullBoardData,
    getActiveBoardData: () => store.activeBoardData,
    getActiveBoardId: () => store.activeBoardId,
    setFullBoardDataState: (v) => { store.setFullBoardDataStateCalls.push(v); store.fullBoardData = v; },
    setActiveBoardDataState: (v) => { store.activeBoardData = v; },
    updateActiveBoardDataState: (updater) => {
      if (!store.activeBoardData || typeof updater !== 'function') return store.activeBoardData;
      updater(store.activeBoardData, store.activeBoardData);
      return store.activeBoardData;
    },
    is_archived_or_deleted: () => false,
    findBoardMeta: () => null,
    cloneBoardData: (bd) => JSON.parse(JSON.stringify(bd)),
    refreshBoardHeaderActionStates: () => {},
    clearPendingExternalRebaseConflict: () => {},
    hasPendingExternalRebaseConflict: () => false,
    getPendingExternalRebaseConflict: () => null,
    setPendingExternalRebaseConflict: () => {},
    clearLocalBoardDraft: () => {},
    saveLocalBoardDraft: () => {},
    loadLocalBoardDraft: () => null,
    traceFrontendAction: () => {},
    logFrontendIssue: () => {},
    showSaving: () => {},
    hideSaving: () => {},
    showNotification: () => {},
    showConfirmDialog: () => false,
    showExternalRebaseConflictDialog: () => {},
    showConflictDialog: () => {},
    setLastSaveTime: () => {},
    isActiveRemoteBoard: () => false,
    isRemoteBoardId: () => false,
    LexeraApi: () => ({
      getBoardColumns: () => Promise.resolve({ fullBoard: null }),
      saveBoard: () => Promise.resolve({}),
      saveBoardWithBase: () => Promise.resolve({})
    }),
    setBoardSaveBase: (bd) => bd,
    getBoardSaveBase: () => null,
    hasBoardIdentityMismatch: () => false,
    getBoardCardIdentityStats: () => ({}),
    summarizeBoardHierarchy: () => ({}),
    summarizeBoardIdentity: () => ({}),
    boardCardSummary: () => '',
    traceBoardIdentityPair: () => {},
    resolveSavedBoardData: (bd) => bd,
    getLiveSyncSession: () => null,
    getLiveSyncState: () => null,
    setLiveSyncState: () => {},
    closeLiveSyncSession: () => Promise.resolve(),
    ensureLiveSyncSession: () => Promise.resolve(),
    reopenLiveSyncSession: () => Promise.resolve(),
    applyBoardToLiveSyncSession: () => Promise.resolve(false),
    flushPendingLiveSyncUpdates: () => Promise.resolve(),
    getPendingRefresh: () => false,
    setPendingRefresh: () => {},
    triggerAutoExportAfterBoardSave: () => {},
    renderMainView: () => {},
    renderColumns: () => {},
    refreshTargetedElements: (targets) => { store.refreshTargetedCalls.push(targets); },
    refreshHeaderFileControls: () => {},
    scheduleDashboardRefresh: () => {},
    refreshBoardHierarchyProjection: () => {},
    isEmbeddedMode: () => false,
    getEmbeddedPaneId: () => '',
    incrementBoardLoadSeq: () => 0,
    getBoardLoadSeq: () => 0,
    resetBoardStatsFilter: () => {},
    resetColumnSortState: () => {},
    closeSearchReplacePanel: () => {},
    getCanvasZoom: () => 1,
    applyCanvasZoom: () => {},
    resetCanvasPan: () => {},
    clearBoardPreviewCaches: () => {},
    clearEditingPresenceMap: () => {},
    refreshAvailableMarpClasses: () => Promise.resolve(),
    connectSyncForBoard: () => {},
    getMutationBoardTitle: (boardId, bd) => (bd && bd.title) || 'Board',
    ensureBoardRowsForMutation: () => {},
    getAllColumnsFromBoardData: (bd) => {
      const cols = [];
      const rows = (bd && bd.rows) || [];
      for (const row of rows) {
        for (const stack of row.stacks || []) {
          for (const col of stack.columns || []) cols.push(col);
        }
      }
      return cols;
    },
    cloneVisibleCardForRender: (c) => ({ ...c }),
    scheduleHierarchyRefresh: () => {},
    notifyEmbeddedBoardMutation: () => {}
  };
}

function loadBoardDataStore() {
  return loadIIFE('core/boardDataStore.js', 'LexeraBoardDataStore', {
    window: globalThis.window || { __lexeraDebugMutations: false },
    performance: globalThis.performance || { now: () => Date.now() },
    Map: Map
  });
}

describe('BoardDataStore.commitHierarchyTreeEdit — cross-window delegation sync', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      delete window.__lexeraDebugMutations;
      delete window.__lexeraProfileMutations;
    }
  });

  it('adopts incoming boardData into fullBoardData when called with a new reference (iframe receiving delegated commit)', async () => {
    const BoardDataStore = loadBoardDataStore();

    // Iframe's live state: fullBoardData holds the OLD title.
    const ironState = {
      fullBoardData: makeBoardData('Old Title'),
      activeBoardData: null,
      activeBoardId: 'board-1',
      setFullBoardDataStateCalls: [],
      refreshTargetedCalls: []
    };
    ironState.activeBoardData = {
      valid: true,
      title: 'Board',
      fullBoard: ironState.fullBoardData,
      columns: [],
      rows: []
    };

    BoardDataStore.init(makeDeps(ironState));

    // Workspace window built a fresh boardData from the backend and applied
    // the rename locally — this is a DIFFERENT object reference than the
    // iframe's fullBoardData.
    const incomingBoardData = makeBoardData('Renamed From Workspace');
    expect(incomingBoardData).not.toBe(ironState.fullBoardData);

    const result = await BoardDataStore.commitHierarchyTreeEdit('board-1', incomingBoardData, {
      targets: [{ type: 'column', colIndex: 0 }, { type: 'sidebar' }]
    });

    expect(result).toBe(true);
    // Core assertion: the iframe adopted the incoming boardData so
    // persistBoardMutation + updateDisplayFromFullBoard render the new title.
    expect(ironState.fullBoardData).toBe(incomingBoardData);
    expect(ironState.fullBoardData.rows[0].stacks[0].columns[0].title).toBe('Renamed From Workspace');
    expect(ironState.setFullBoardDataStateCalls).toContain(incomingBoardData);
    // And the column refresh was scheduled.
    expect(ironState.refreshTargetedCalls.length).toBeGreaterThan(0);
  });

  it('does not redundantly swap fullBoardData when boardData is the same reference (single-window case)', async () => {
    const BoardDataStore = loadBoardDataStore();

    const sharedBoardData = makeBoardData('Title');
    const state = {
      fullBoardData: sharedBoardData,
      activeBoardData: null,
      activeBoardId: 'board-1',
      setFullBoardDataStateCalls: [],
      refreshTargetedCalls: []
    };
    state.activeBoardData = {
      valid: true,
      title: 'Board',
      fullBoard: state.fullBoardData,
      columns: [],
      rows: []
    };

    BoardDataStore.init(makeDeps(state));

    // Single-window: spec.apply mutated sharedBoardData in place, so boardData
    // === fullBoardData. No swap should occur.
    sharedBoardData.rows[0].stacks[0].columns[0].title = 'In-Place Renamed';
    await BoardDataStore.commitHierarchyTreeEdit('board-1', sharedBoardData, {
      targets: [{ type: 'column', colIndex: 0 }, { type: 'sidebar' }]
    });

    expect(state.fullBoardData).toBe(sharedBoardData);
    // No redundant setFullBoardDataState call from the new sync logic
    // (commitLocalBoardChange downstream may still set it, which is fine —
    // what we care about is that the new sync branch didn't fire).
    // The assertion we can make cleanly: the swap didn't replace the ref
    // with something else.
    expect(state.fullBoardData.rows[0].stacks[0].columns[0].title).toBe('In-Place Renamed');
  });
});
