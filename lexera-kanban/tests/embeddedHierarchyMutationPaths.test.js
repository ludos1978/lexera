import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function createBoardData(title) {
  return {
    title,
    columns: [],
    rows: [{
      id: 'row-1',
      title: title + ' Row',
      stacks: [{
        id: 'stack-1',
        title: title + ' Stack',
        columns: [{
          id: 'col-1',
          index: 0,
          title: title + ' Column',
          cards: [{ id: 'card-1', content: title + ' Card' }],
        }],
      }],
    }],
  };
}

function loadBoardList() {
  const code = fs.readFileSync(
    path.resolve('src/board/boardList.js'),
    'utf8'
  );
  const context = {
    console,
    Date,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
    structuredClone,
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    lexeraLog: () => {},
    logFrontendIssue: () => {},
  };
  context.window = context;
  vm.runInNewContext(code, context, { filename: 'boardList.js' });
  return context.window.LexeraBoardList;
}

function createParentHierarchyObserver() {
  const BoardList = loadBoardList();
  BoardList.init({
    get embeddedMode() { return false; },
    renderBoardList() {},
  });

  return {
    observe(message) {
      if (!message || message.type !== 'lexera-board-mutated' || !message.boardId || !message.fullBoard) return;
      BoardList.refreshBoardHierarchyProjection(message.boardId, message.fullBoard, '', { render: false });
    },
    getRows(boardId) {
      return BoardList.getBoardHierarchyRows(boardId);
    },
  };
}

function createEmbeddedBoardListHarness(onParentMessage, overrides = {}) {
  const BoardList = loadBoardList();
  const state = {
    activeBoardId: 'board-a',
    fullBoardData: null,
    activeBoardData: null,
    liveSyncState: { boardId: 'board-a', board: null },
    _saveInFlight: false,
    _lastLoadedRevision: null,
    ...overrides,
  };

  BoardList.init({
    get embeddedMode() { return true; },
    get activeBoardId() { return state.activeBoardId; },
    get fullBoardData() { return state.fullBoardData; },
    get activeBoardData() { return state.activeBoardData; },
    get liveSyncState() { return state.liveSyncState; },
    get _saveInFlight() { return state._saveInFlight; },
    get _lastLoadedRevision() { return state._lastLoadedRevision; },
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
    ensureBoardRowsForMutation(boardData, fallbackTitle) {
      if (!boardData) return;
      if (!Array.isArray(boardData.rows)) boardData.rows = [];
      if (!Array.isArray(boardData.columns)) boardData.columns = [];
      if (boardData.rows.length === 0) {
        boardData.rows.push({
          id: 'row-1',
          title: fallbackTitle || boardData.title || 'Board',
          stacks: []
        });
      }
    },
    getMutationBoardTitle(boardId, boardData) {
      return (boardData && boardData.title) || boardId || '';
    },
    setFullBoardData(nextBoard) {
      state.fullBoardData = nextBoard;
    },
    clearBoardDirty() {},
    updateDisplayFromFullBoard() {},
    commitLocalBoardChange(boardId, boardData) {
      if (typeof onParentMessage === 'function') {
        onParentMessage({
          type: 'lexera-board-mutated',
          boardId,
          fullBoard: structuredClone(boardData),
        });
      }
      return boardData;
    },
    setPendingExternalRebaseConflict() {},
    setLastLoadedGeneration() {},
    setLastLoadedRevision(nextRevision) {
      state._lastLoadedRevision = nextRevision;
    },
    applyBoardSettings() {},
    refreshTargetedElements() {},
    refreshHeaderFileControls() {},
    scheduleDashboardRefresh() {},
    markBoardDirty() {},
    saveLocalBoardDraft() {},
    showNotification() {},
  });

  return { BoardList, state };
}

function loadEmbeddedMutationHarness(onParentMessage, onSaveFullBoard) {
  const source = fs.readFileSync(path.resolve('src/app.js'), 'utf8');
  const lines = source.split('\n');

  function findLine(pattern) {
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes(pattern)) return i + 1;
    }
    throw new Error('Could not find: ' + pattern);
  }

  function extractFunction(startLine) {
    let depth = 0;
    let started = false;
    const result = [];
    for (let i = startLine - 1; i < lines.length; i += 1) {
      const line = lines[i];
      result.push(line);
      for (let c = 0; c < line.length; c += 1) {
        if (line[c] === '{') { depth += 1; started = true; }
        if (line[c] === '}') depth -= 1;
      }
      if (started && depth === 0) break;
    }
    return result.join('\n');
  }

  const notifyEmbeddedBoardMutationSource = extractFunction(findLine('function notifyEmbeddedBoardMutation(boardId, boardData) {'));
  const updateActiveBoardDataStateSource = extractFunction(findLine('function updateActiveBoardDataState(updater) {'));
  const commitLocalBoardChangeSource = extractFunction(findLine('function commitLocalBoardChange(boardId, nextBoardData, options) {'));
  const commitBoardMutationsSource = extractFunction(findLine('async function commitBoardMutations(changedBoards, options) {'));
  const applyPollingBoardDeltaSource = extractFunction(findLine('function applyPollingBoardDelta(boardId, payload) {'));

  const wrappedSource = `
    var activeBoardId = '';
    var fullBoardData = null;
    var activeBoardData = null;
    var embeddedMode = true;
    var embeddedPaneId = 'pane-1';
    var lastSaveTime = 0;
    var _lastLoadedGeneration = 1;
    var _lastLoadedRevision = 'rev-1';
    var window = {
      parent: {
        postMessage: function (data) {
          if (typeof onParentMessage === 'function') onParentMessage(data);
        }
      }
    };
    function requestAnimationFrame(fn) { fn(); }
    function setActiveBoardDataState(nextBoardData) { activeBoardData = nextBoardData; }
    function setFullBoardDataState(nextBoardData) { fullBoardData = nextBoardData; }
    function ensureBoardRowsForMutation(boardData, fallbackTitle) {
      if (!boardData) return;
      if (!Array.isArray(boardData.rows)) boardData.rows = [];
      if (!Array.isArray(boardData.columns)) boardData.columns = [];
      if (boardData.rows.length === 0) {
        boardData.rows.push({
          id: 'row-1',
          title: fallbackTitle || boardData.title || 'Board',
          stacks: []
        });
      }
    }
    function getMutationBoardTitle(boardId, boardData) {
      return (boardData && boardData.title) || boardId || '';
    }
    function refreshBoardHierarchyProjection() { return null; }
    function setBoardSaveBase(boardData, baseBoardData) {
      if (boardData) boardData.__saveBase = baseBoardData || null;
      return baseBoardData || null;
    }
    function getBoardSaveBase(boardData) {
      return boardData && boardData.__saveBase ? boardData.__saveBase : null;
    }
    function resolveSavedBoardData(boardData, result) {
      return result && result.board ? result.board : boardData;
    }
    function showSaving() {}
    function hideSaving() {}
    async function saveFullBoard() {
      if (typeof onSaveFullBoard === 'function') {
        return onSaveFullBoard({
          activeBoardId: activeBoardId,
          fullBoardData: structuredClone(fullBoardData),
          activeBoardData: structuredClone(activeBoardData),
        });
      }
      return true;
    }
    function refreshTargetedElements() {}
    function refreshHeaderFileControls() {}
    function scheduleDashboardRefresh() {}
    function markBoardDirty() {}
    function logFrontendIssue() {}
    function traceFrontendAction() {}
    function summarizeBoardHierarchy(boardData) {
      return boardData && Array.isArray(boardData.rows) ? boardData.rows.length : 0;
    }
    function updateDisplayFromFullBoard() {}
    function renderMainView() {}
    var LexeraApi = {
      saveBoard: async function (boardId, boardData) {
        return { board: structuredClone(boardData), revision: 'saved-' + boardId };
      },
      saveBoardWithBase: async function (boardId, _baseBoardData, boardData) {
        return { board: structuredClone(boardData), revision: 'saved-' + boardId };
      }
    };
    function applyBoardDelta(board, delta) {
      if (!board || !delta || !delta.replace || typeof delta.replace !== 'object') return;
      var nextBoard = structuredClone(delta.replace);
      var currentKeys = Object.keys(board);
      for (var i = 0; i < currentKeys.length; i++) delete board[currentKeys[i]];
      var nextKeys = Object.keys(nextBoard);
      for (var j = 0; j < nextKeys.length; j++) board[nextKeys[j]] = nextBoard[nextKeys[j]];
    }

    ${updateActiveBoardDataStateSource}

    // BoardDataStore mock — provides the interface that app.js thin delegation stubs call
    var BoardDataStore = {
      notifyEmbeddedBoardMutation: function (boardId, boardData) {
        if (!embeddedMode || !window.parent || window.parent === window || !boardId) return;
        requestAnimationFrame(function () {
          try {
            window.parent.postMessage({
              type: 'lexera-board-mutated',
              boardId: boardId,
              pane: embeddedPaneId,
              fullBoard: boardData || null
            }, '*');
          } catch (e) { /* ignore */ }
        });
      },
      commitLocalBoardChange: function (boardId, nextBoardData, options) {
        options = options || {};
        var targetBoardId = boardId || activeBoardId || null;
        var hasExplicitBoardData = arguments.length >= 2;
        var shouldSetLocalState = options.setLocalState !== false && hasExplicitBoardData && targetBoardId === activeBoardId;
        if (shouldSetLocalState) { fullBoardData = nextBoardData || null; }
        var boardData = hasExplicitBoardData ? nextBoardData : fullBoardData;
        if (!targetBoardId || !boardData) {
          if (options.notifyParent !== false) BoardDataStore.notifyEmbeddedBoardMutation(targetBoardId, boardData || null);
          return boardData || null;
        }
        if (options.ensureRows !== false) {
          ensureBoardRowsForMutation(boardData, getMutationBoardTitle(targetBoardId, boardData));
          if (!boardData.columns) boardData.columns = [];
        }
        if (targetBoardId === activeBoardId && activeBoardData) {
          updateActiveBoardDataState(function (nextBoardData) { nextBoardData.fullBoard = boardData; });
        }
        if (options.refreshHierarchy !== false) {
          refreshBoardHierarchyProjection(targetBoardId, boardData, getMutationBoardTitle(targetBoardId, boardData), { revision: options.revision || null });
        }
        if (options.notifyParent !== false) {
          BoardDataStore.notifyEmbeddedBoardMutation(targetBoardId, boardData);
        }
        return boardData;
      },
      commitBoardMutations: async function (changedBoards, options) {
        options = options || {};
        var boardIds = Object.keys(changedBoards || {});
        if (boardIds.length === 0) return true;
        try {
          for (var i = 0; i < boardIds.length; i++) {
            var boardId = boardIds[i];
            var boardData = changedBoards[boardId];
            if (!boardData) continue;
            if (boardId === activeBoardId) {
              ensureBoardRowsForMutation(boardData, getMutationBoardTitle(boardId, boardData));
              if (!getBoardSaveBase(boardData)) setBoardSaveBase(boardData, boardData);
              if (fullBoardData !== boardData) fullBoardData = boardData;
              if (!activeBoardData) {
                activeBoardData = { valid: true, title: getMutationBoardTitle(boardId, boardData), fullBoard: boardData, columns: [], rows: [] };
              } else if (activeBoardData.fullBoard !== boardData) {
                updateActiveBoardDataState(function (nextBoardData) { nextBoardData.fullBoard = boardData; if (!nextBoardData.title) nextBoardData.title = getMutationBoardTitle(boardId, boardData); });
              }
              updateDisplayFromFullBoard();
              BoardDataStore.commitLocalBoardChange(boardId, boardData, { setLocalState: false, refreshHierarchy: true });
              markBoardDirty();
              try { await saveFullBoard(); } catch (saveErr) { logFrontendIssue('warn', 'commitBoardMutations', 'Failed to save', saveErr); }
              continue;
            }
            showSaving();
            lastSaveTime = Date.now();
            ensureBoardRowsForMutation(boardData, getMutationBoardTitle(boardId, boardData));
            if (!boardData.columns) boardData.columns = [];
            var baseBoardData = getBoardSaveBase(boardData);
            var result = baseBoardData
              ? await LexeraApi.saveBoardWithBase(boardId, baseBoardData, boardData)
              : await LexeraApi.saveBoard(boardId, boardData);
            var savedBoardData = resolveSavedBoardData(boardData, result, boardId);
            changedBoards[boardId] = savedBoardData;
            BoardDataStore.commitLocalBoardChange(boardId, savedBoardData, { setLocalState: false, refreshHierarchy: true });
          }
          if (typeof options.beforeRefresh === 'function') options.beforeRefresh();
          if (typeof options.afterRefresh === 'function') options.afterRefresh();
          scheduleDashboardRefresh(80);
          return true;
        } catch (err) {
          logFrontendIssue('error', 'commitBoardMutations', 'Save failed', err);
          return false;
        } finally {
          hideSaving();
        }
      },
      setLastLoadedGeneration: function (v) { _lastLoadedGeneration = v; },
      setLastLoadedRevision: function (v) { _lastLoadedRevision = v; }
    };
    function notifyEmbeddedBoardMutation(boardId, boardData) { BoardDataStore.notifyEmbeddedBoardMutation(boardId, boardData); }
    function commitLocalBoardChange(boardId, nextBoardData, options) { return BoardDataStore.commitLocalBoardChange(boardId, nextBoardData, options); }
    async function commitBoardMutations(changedBoards, options) { return BoardDataStore.commitBoardMutations(changedBoards, options); }
    ${applyPollingBoardDeltaSource}

    return {
      setState: function (nextState) {
        if (Object.prototype.hasOwnProperty.call(nextState, 'activeBoardId')) activeBoardId = nextState.activeBoardId;
        if (Object.prototype.hasOwnProperty.call(nextState, 'fullBoardData')) fullBoardData = nextState.fullBoardData;
        if (Object.prototype.hasOwnProperty.call(nextState, 'activeBoardData')) activeBoardData = nextState.activeBoardData;
        if (Object.prototype.hasOwnProperty.call(nextState, '_lastLoadedGeneration')) _lastLoadedGeneration = nextState._lastLoadedGeneration;
        if (Object.prototype.hasOwnProperty.call(nextState, '_lastLoadedRevision')) _lastLoadedRevision = nextState._lastLoadedRevision;
      },
      getState: function () {
        return {
          activeBoardId: activeBoardId,
          fullBoardData: fullBoardData,
          activeBoardData: activeBoardData,
          _lastLoadedGeneration: _lastLoadedGeneration,
          _lastLoadedRevision: _lastLoadedRevision,
        };
      },
      applyPollingBoardDelta: applyPollingBoardDelta,
      commitBoardMutations: commitBoardMutations,
    };
  `;

  const factory = new Function('onParentMessage', 'onSaveFullBoard', 'structuredClone', wrappedSource);
  return factory(onParentMessage, onSaveFullBoard, structuredClone);
}

describe('embedded hierarchy mutation paths', () => {
  it('propagates polling delta structural changes to the parent hierarchy cache', () => {
    const parent = createParentHierarchyObserver();
    const harness = loadEmbeddedMutationHarness((message) => parent.observe(message));
    const initialBoard = createBoardData('Initial');
    const nextBoard = createBoardData('Polled');

    harness.setState({
      activeBoardId: 'board-a',
      fullBoardData: structuredClone(initialBoard),
      activeBoardData: {
        fullBoard: structuredClone(initialBoard),
        rows: structuredClone(initialBoard.rows),
        revision: 'rev-1',
      },
      _lastLoadedGeneration: 1,
      _lastLoadedRevision: 'rev-1',
    });

    const applied = harness.applyPollingBoardDelta('board-a', {
      available: true,
      delta: { replace: structuredClone(nextBoard) },
      generation: 2,
      revision: 'rev-2',
      title: nextBoard.title,
    });

    expect(applied).toBe(true);
    expect(parent.getRows('board-a')).toEqual(nextBoard.rows);
  });

  it('propagates cross-board commit changes for both active and non-active boards', async () => {
    const parent = createParentHierarchyObserver();
    const harness = loadEmbeddedMutationHarness((message) => parent.observe(message));
    const sourceBoard = createBoardData('Source After Move');
    const targetBoard = createBoardData('Target After Move');

    harness.setState({
      activeBoardId: 'board-a',
      fullBoardData: structuredClone(sourceBoard),
      activeBoardData: {
        fullBoard: structuredClone(sourceBoard),
        rows: structuredClone(sourceBoard.rows),
        revision: 'rev-a',
      },
    });

    const committed = await harness.commitBoardMutations({
      'board-a': structuredClone(sourceBoard),
      'board-b': structuredClone(targetBoard),
    }, {
      refreshSidebar: true,
    });

    expect(committed).toBe(true);
    expect(parent.getRows('board-a')).toEqual(sourceBoard.rows);
    expect(parent.getRows('board-b')).toEqual(targetBoard.rows);
  });

  it('hydrates active board state before saving cross-board mutations when local state is missing', async () => {
    const parent = createParentHierarchyObserver();
    let saveSnapshot = null;
    const harness = loadEmbeddedMutationHarness(
      (message) => parent.observe(message),
      (payload) => {
        saveSnapshot = payload;
        return true;
      }
    );
    const activeBoard = createBoardData('Active Missing Local');
    const targetBoard = createBoardData('Target Missing Local');

    harness.setState({
      activeBoardId: 'board-a',
      fullBoardData: null,
      activeBoardData: null,
    });

    const committed = await harness.commitBoardMutations({
      'board-a': structuredClone(activeBoard),
      'board-b': structuredClone(targetBoard),
    }, {
      refreshSidebar: true,
    });

    expect(committed).toBe(true);
    expect(saveSnapshot).not.toBeNull();
    expect(saveSnapshot.fullBoardData.rows).toEqual(activeBoard.rows);
    expect(saveSnapshot.activeBoardData.fullBoard.rows).toEqual(activeBoard.rows);
    expect(harness.getState().fullBoardData.rows).toEqual(activeBoard.rows);
    expect(parent.getRows('board-a')).toEqual(activeBoard.rows);
    expect(parent.getRows('board-b')).toEqual(targetBoard.rows);
  });

  it('propagates live-sync snapshots to the parent hierarchy cache', () => {
    const parent = createParentHierarchyObserver();
    const initialBoard = createBoardData('Local Draft');
    const incomingBoard = createBoardData('Live Sync');
    const { BoardList, state } = createEmbeddedBoardListHarness((message) => parent.observe(message), {
      fullBoardData: structuredClone(initialBoard),
      activeBoardData: {
        rows: structuredClone(initialBoard.rows),
      },
    });

    BoardList.applyLiveSyncBoardSnapshot('board-a', incomingBoard, { skipRender: true });

    expect(state.fullBoardData.rows).toEqual(incomingBoard.rows);
    expect(parent.getRows('board-a')).toEqual(incomingBoard.rows);
  });

  it('propagates rebased snapshots to the parent hierarchy cache', () => {
    const parent = createParentHierarchyObserver();
    const workingBoard = createBoardData('Rebased');
    const { BoardList } = createEmbeddedBoardListHarness((message) => parent.observe(message), {
      activeBoardData: {},
    });

    BoardList.applyRebasedBoardSnapshot(
      'board-a',
      structuredClone(workingBoard),
      createBoardData('Current'),
      { revision: 'rev-7' },
      { silent: true }
    );

    expect(parent.getRows('board-a')).toEqual(workingBoard.rows);
  });
});
