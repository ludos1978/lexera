/**
 * Lexera Board Data Store -- board data management extracted from app.js.
 *
 * Owns:
 *   - Board dirty state tracking
 *   - Auto-save scheduling and save pipeline
 *   - Board load / reload
 *   - Board data query helpers (getAllColumnsFromBoardData, getFullColumn, etc.)
 *   - Display update from full board data
 *   - Commit pipeline (commitLocalBoardChange, persistBoardMutation, etc.)
 *
 * All external dependencies are injected via init(deps).
 * State that lives in app.js (fullBoardData, activeBoardData, activeBoardId, etc.)
 * is accessed through getter/setter functions in the deps object.
 */
var LexeraBoardDataStore = (function () {
  'use strict';

  // ── Dependencies (injected via init) ───────────────────────────────
  var _deps = null;

  // ── Internal state ─────────────────────────────────────────────────
  var _boardDirty = false;
  var _boardDirtyGeneration = 0;
  var _lastLoadedGeneration = null;
  var _lastLoadedRevision = null;

  var _saveInFlight = false;
  var _savePending = false;
  var _autoSaveTimer = null;
  var _autoSaveRetryCount = 0;

  var AUTO_SAVE_DELAY_MS = 1200;
  var AUTO_SAVE_REMOTE_DELAY_MS = 180;
  var AUTO_SAVE_MAX_RETRIES = 5;
  var AUTO_SAVE_RETRY_DELAYS = [2000, 5000, 10000, 30000, 60000];

  // ── Dependency accessors (convenience) ─────────────────────────────
  function dep(name) {
    if (!_deps) throw new Error('[boardDataStore] not initialized');
    var fn = _deps[name];
    if (typeof fn !== 'function') throw new Error('[boardDataStore] missing dep: ' + name);
    return fn;
  }

  function getFullBoardData() { return dep('getFullBoardData')(); }
  function getActiveBoardData() { return dep('getActiveBoardData')(); }
  function getActiveBoardId() { return dep('getActiveBoardId')(); }
  function setFullBoardDataState(v) { _invalidateAllColsCache(); dep('setFullBoardDataState')(v); }
  function setActiveBoardDataState(v) { dep('setActiveBoardDataState')(v); }
  function updateActiveBoardDataState(updater) { return dep('updateActiveBoardDataState')(updater); }

  // ── Board data query helpers ───────────────────────────────────────

  /**
   * Get a flat list of all columns from board data (rows->stacks->columns).
   */
  // Cache for getAllColumnsFromBoardData to avoid O(n) rebuilds on every call.
  // Invalidated whenever board structure could change (setFullBoardDataState,
  // commitLocalBoardChange, mutation paths that add/remove rows/stacks/cols).
  var _allColsCacheBoard = null;
  var _allColsCacheResult = null;
  function _invalidateAllColsCache() { _allColsCacheBoard = null; _allColsCacheResult = null; }

  function getAllColumnsFromBoardData(boardData) {
    if (boardData && boardData === _allColsCacheBoard && _allColsCacheResult) {
      return _allColsCacheResult;
    }
    var cols = [];
    if (!boardData || !boardData.rows) return cols;
    for (var r = 0; r < boardData.rows.length; r++) {
      var row = boardData.rows[r];
      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        for (var c = 0; c < stack.columns.length; c++) {
          cols.push(stack.columns[c]);
        }
      }
    }
    _allColsCacheBoard = boardData;
    _allColsCacheResult = cols;
    return cols;
  }

  function getAllFullColumns() {
    return getAllColumnsFromBoardData(getFullBoardData());
  }

  function getFullColumn(flatIndex) {
    var cols = getAllColumnsFromBoardData(getFullBoardData());
    return (flatIndex >= 0 && flatIndex < cols.length) ? cols[flatIndex] : null;
  }

  function getColumnByLocation(rowIndex, stackIndex, colIndex) {
    var fullBoardData = getFullBoardData();
    if (!fullBoardData || !fullBoardData.rows) return null;
    var row = fullBoardData.rows[rowIndex];
    if (!row || !row.stacks) return null;
    var stack = row.stacks[stackIndex];
    if (!stack || !stack.columns) return null;
    return stack.columns[colIndex] || null;
  }

  function getRowByLocation(rowIndex) {
    var fullBoardData = getFullBoardData();
    if (!fullBoardData || !fullBoardData.rows) return null;
    return fullBoardData.rows[rowIndex] || null;
  }

  function getStackByLocation(rowIndex, stackIndex) {
    var row = getRowByLocation(rowIndex);
    if (!row || !row.stacks) return null;
    return row.stacks[stackIndex] || null;
  }

  function getCardByLocation(rowIndex, stackIndex, colIndex, cardIndex) {
    var col = getColumnByLocation(rowIndex, stackIndex, colIndex);
    if (!col || !col.cards) return null;
    return col.cards[cardIndex] || null;
  }

  // ── Renderable column helpers ──────────────────────────────────────

  function cloneVisibleCardForRender(card) {
    return {
      id: card.id,
      content: card.content,
      checked: !!card.checked,
      kid: card.kid,
      params: card.params || {}
    };
  }

  function buildRenderableColumnSnapshot(fullCol, flatIdx) {
    if (!fullCol) return null;
    return {
      index: flatIdx,
      id: fullCol.id,
      title: fullCol.title,
      cards: (fullCol.cards || []).filter(function (card) {
        return !dep('is_archived_or_deleted')(card && card.content ? card.content : '');
      }).map(function (card) {
        return cloneVisibleCardForRender(card);
      }),
      params: fullCol.params || {}
    };
  }

  function getRenderableColumnByIndex(flatIndex) {
    var activeBoardData = getActiveBoardData();
    var visibleCols = activeBoardData && Array.isArray(activeBoardData.columns) ? activeBoardData.columns : [];
    for (var i = 0; i < visibleCols.length; i++) {
      if (visibleCols[i] && visibleCols[i].index === flatIndex) return visibleCols[i];
    }
    return buildRenderableColumnSnapshot(getFullColumn(flatIndex), flatIndex);
  }

  // ── Display update ─────────────────────────────────────────────────

  function updateDisplayFromFullBoard() {
    var _udStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    var fullBoardData = getFullBoardData();
    var activeBoardData = getActiveBoardData();
    if (!fullBoardData || !activeBoardData) return;

    var allCols = getAllFullColumns();
    // Build identity-based index map to avoid O(n) indexOf per column
    var colIndexMap = new Map();
    for (var ci = 0; ci < allCols.length; ci++) colIndexMap.set(allCols[ci], ci);
    var visibleColumns = [];
    var is_archived_or_deleted = dep('is_archived_or_deleted');
    var visibleRows = (fullBoardData.rows || [])
      .filter(function (row) {
        return !is_archived_or_deleted(row && row.title ? row.title : '');
      })
      .map(function (row) {
        var stacks = (row.stacks || [])
          .filter(function (stack) {
            return !is_archived_or_deleted(stack && stack.title ? stack.title : '');
          })
          .map(function (stack) {
            var cols = (stack.columns || [])
              .filter(function (col) { return !is_archived_or_deleted(col && col.title ? col.title : ''); })
              .map(function (col) {
                var cards = (col.cards || []).filter(function (c) {
                  return !is_archived_or_deleted(c && c.content ? c.content : '');
                });
                var flatIdx = colIndexMap.has(col) ? colIndexMap.get(col) : -1;
                var visibleCards = cards.map(function (card) {
                  return cloneVisibleCardForRender(card);
                });
                var visibleCol = {
                  index: flatIdx,
                  id: col.id,
                  title: col.title,
                  cards: visibleCards,
                  params: col.params || {}
                };
                visibleColumns.push(visibleCol);
                return visibleCol;
              });
            return { id: stack.id, title: stack.title, columns: cols, params: stack.params };
          });
        return { id: row.id, title: row.title, stacks: stacks, params: row.params || {} };
      });

    updateActiveBoardDataState(function (nextBoardData) {
      nextBoardData.columns = visibleColumns;
      nextBoardData.rows = visibleRows;
    });
    if (typeof window.traceSlowFrontendTask === 'function') {
      window.traceSlowFrontendTask('board.updateDisplay', 'updateDisplayFromFullBoard', _udStart, {
        columns: visibleColumns.length
      });
    }
  }

  // ── Board structure helpers ────────────────────────────────────────

  function migrateLegacyBoard() {
    var fullBoardData = getFullBoardData();
    if (!fullBoardData) return;
    if (fullBoardData.rows && fullBoardData.rows.length > 0) return;
    var cols = fullBoardData.columns || [];
    if (cols.length === 0) {
      fullBoardData.rows = [];
      return;
    }
    fullBoardData.rows = dep('buildRowsFromLegacyColumns')(cols, fullBoardData.title || 'Default');
    fullBoardData.columns = [];
  }

  function ensureBoardRowsForMutation(boardData, fallbackTitle) {
    if (!boardData) return;
    if (boardData.rows && boardData.rows.length > 0) {
      if (!boardData.columns) boardData.columns = [];
      return;
    }
    var cols = boardData.columns || [];
    if (cols.length === 0) {
      boardData.rows = [];
      boardData.columns = [];
      return;
    }
    boardData.rows = dep('buildRowsFromLegacyColumns')(cols, boardData.title || fallbackTitle || 'Default');
    boardData.columns = [];
  }

  function getMutationBoardTitle(boardId, boardData) {
    if (boardData && boardData.title) return boardData.title;
    var activeBoardId = getActiveBoardId();
    var activeBoardData = getActiveBoardData();
    if (boardId === activeBoardId && activeBoardData && activeBoardData.title) return activeBoardData.title;
    var meta = dep('findBoardMeta')(boardId);
    return meta && meta.title ? meta.title : 'Board';
  }

  // ── Dirty state management ─────────────────────────────────────────

  function resetBoardDirtyState(reason, boardId) {
    clearScheduledAutoSave('resetBoardDirtyState:' + (reason || 'unknown'));
    _boardDirty = false;
    dep('clearPendingExternalRebaseConflict')();
    dep('refreshBoardHeaderActionStates')();
    dep('traceFrontendAction')('info', 'board.dirty.reset', 'Reset board dirty state', {
      boardId: boardId || getActiveBoardId() || null,
      reason: reason || null
    });
  }

  function markBoardDirty() {
    _boardDirtyGeneration++;
    if (_boardDirty) return;
    _boardDirty = true;
    dep('refreshBoardHeaderActionStates')();
  }

  function getBoardDirtyGeneration() {
    return _boardDirtyGeneration;
  }

  function clearBoardDirtyIfUnchanged(savedGeneration) {
    if (_boardDirtyGeneration !== savedGeneration) {
      dep('traceFrontendAction')('info', 'board.dirty.keepDirty', 'Keeping board dirty because mutations arrived during save', {
        boardId: getActiveBoardId() || null,
        savedGeneration: savedGeneration,
        currentGeneration: _boardDirtyGeneration
      });
      scheduleAutoSave('post-save-still-dirty', AUTO_SAVE_DELAY_MS);
      return;
    }
    resetBoardDirtyState('clearBoardDirty', getActiveBoardId());
    dep('clearLocalBoardDraft')(getActiveBoardId());
  }

  function clearBoardDirty() {
    resetBoardDirtyState('clearBoardDirty', getActiveBoardId());
    dep('clearLocalBoardDraft')(getActiveBoardId());
  }

  function isBoardDirty() {
    return _boardDirty;
  }

  // ── Auto-save ──────────────────────────────────────────────────────

  function clearScheduledAutoSave(reason) {
    if (_autoSaveTimer) {
      clearTimeout(_autoSaveTimer);
      _autoSaveTimer = null;
      dep('traceFrontendAction')('info', 'save.auto.cancel', 'Cancelled pending auto-save', {
        boardId: getActiveBoardId() || null,
        reason: reason || null
      });
    }
  }

  function scheduleAutoSave(reason, delayMs) {
    var activeBoardId = getActiveBoardId();
    var fullBoardData = getFullBoardData();
    var waitMs = typeof delayMs === 'number' && isFinite(delayMs) && delayMs >= 0
      ? Math.floor(delayMs)
      : AUTO_SAVE_DELAY_MS;
    if (!activeBoardId || !fullBoardData) {
      dep('traceFrontendAction')('warn', 'save.auto.skip', 'Skipped auto-save scheduling because active board is not ready', {
        boardId: activeBoardId,
        reason: reason || null,
        hasBoardData: !!fullBoardData
      });
      return false;
    }
    if (!isBoardDirty()) {
      dep('traceFrontendAction')('info', 'save.auto.skip', 'Skipped auto-save scheduling because board is not dirty', {
        boardId: activeBoardId,
        reason: reason || null
      });
      return false;
    }
    if (dep('hasPendingExternalRebaseConflict')()) {
      var conflictResult = dep('getPendingExternalRebaseConflict')();
      dep('traceFrontendAction')('warn', 'save.auto.skip', 'Skipped auto-save scheduling because unresolved rebase conflicts exist', {
        boardId: activeBoardId,
        reason: reason || null,
        conflicts: conflictResult && conflictResult.result ? (conflictResult.result.conflicts || 0) : 0
      });
      return false;
    }
    if (_autoSaveTimer) {
      clearTimeout(_autoSaveTimer);
      _autoSaveTimer = null;
    }
    dep('traceFrontendAction')('info', 'save.auto.schedule', 'Scheduled auto-save after board mutation', {
      boardId: activeBoardId,
      reason: reason || null,
      delayMs: waitMs,
      dirty: isBoardDirty(),
      saveInFlight: _saveInFlight
    });
    var boardId = activeBoardId;
    _autoSaveTimer = setTimeout(async function () {
      _autoSaveTimer = null;
      var currentActiveBoardId = getActiveBoardId();
      if (currentActiveBoardId !== boardId) {
        dep('traceFrontendAction')('warn', 'save.auto.skip', 'Skipped auto-save because active board changed before timer fired', {
          scheduledBoardId: boardId,
          activeBoardId: currentActiveBoardId || null,
          reason: reason || null
        });
        return;
      }
      if (!isBoardDirty()) {
        dep('traceFrontendAction')('info', 'save.auto.skip', 'Skipped auto-save because board is no longer dirty', {
          boardId: boardId,
          reason: reason || null
        });
        return;
      }
      if (dep('hasPendingExternalRebaseConflict')()) {
        var conflictResult = dep('getPendingExternalRebaseConflict')();
        dep('traceFrontendAction')('warn', 'save.auto.skip', 'Skipped auto-save because unresolved rebase conflicts exist at execution time', {
          boardId: boardId,
          reason: reason || null,
          conflicts: conflictResult && conflictResult.result ? (conflictResult.result.conflicts || 0) : 0
        });
        return;
      }
      dep('traceFrontendAction')('info', 'save.auto.run', 'Executing auto-save', {
        boardId: boardId,
        reason: reason || null,
        dirty: isBoardDirty(),
        saveInFlight: _saveInFlight
      });
      try {
        var genAtSaveStart = getBoardDirtyGeneration();
        var saved = await saveFullBoard();
        if (saved) {
          _autoSaveRetryCount = 0;
          clearBoardDirtyIfUnchanged(genAtSaveStart);
          dep('traceFrontendAction')('info', 'save.auto.success', 'Auto-save completed successfully', {
            boardId: boardId,
            reason: reason || null
          });
        } else {
          dep('traceFrontendAction')('warn', 'save.auto.blocked', 'Auto-save did not persist changes (blocked or deferred)', {
            boardId: boardId,
            reason: reason || null,
            dirty: isBoardDirty(),
            saveInFlight: _saveInFlight
          });
        }
      } catch (err) {
        dep('logFrontendIssue')('error', 'save.auto', 'Auto-save failed (retry ' + _autoSaveRetryCount + '/' + AUTO_SAVE_MAX_RETRIES + ')', err);
        if (isBoardDirty()) {
          _autoSaveRetryCount++;
          if (_autoSaveRetryCount <= AUTO_SAVE_MAX_RETRIES) {
            var retryDelay = AUTO_SAVE_RETRY_DELAYS[Math.min(_autoSaveRetryCount - 1, AUTO_SAVE_RETRY_DELAYS.length - 1)];
            scheduleAutoSave('retry-after-failure-' + _autoSaveRetryCount, retryDelay);
          } else {
            dep('logFrontendIssue')('error', 'save.auto', 'Auto-save retries exhausted, writing crashsave to prevent data loss');
            writeBoardCrashsave('auto-save-retries-exhausted', getFullBoardData());
          }
        }
      }
    }, waitMs);
    return true;
  }

  // ── Write crash-save ───────────────────────────────────────────────

  async function writeBoardCrashsave(reason, boardData, extra) {
    var activeBoardId = getActiveBoardId();
    if (!activeBoardId || !boardData) return null;
    var payload = boardData;
    var crashsaveReason = reason || 'save-recovery';
    dep('traceFrontendAction')('warn', 'board.crashsave', 'Attempting to persist crashsave for active board', {
      boardId: activeBoardId,
      reason: crashsaveReason,
      summary: window.__lexeraDebugMutations ? dep('summarizeBoardHierarchy')(boardData) : undefined,
      extra: extra || null
    });
    try {
      var result = await dep('LexeraApi')().createBoardCrashsave(activeBoardId, payload, crashsaveReason);
      dep('traceFrontendAction')('warn', 'board.crashsave', 'Crashsave persisted for active board', {
        boardId: activeBoardId,
        reason: crashsaveReason,
        path: result && result.path ? result.path : null,
        filename: result && result.filename ? result.filename : null
      });
      return result || null;
    } catch (err) {
      dep('logFrontendIssue')('error', 'board.crashsave', 'Failed to persist crashsave for active board', err);
      return null;
    }
  }

  // ── Overwrite board with local draft ───────────────────────────────

  async function overwriteBoardWithLocalDraft(trigger) {
    var activeBoardId = getActiveBoardId();
    var fullBoardData = getFullBoardData();
    if (!activeBoardId || !fullBoardData) return false;
    if (_saveInFlight) return false;
    _saveInFlight = true;
    dep('showSaving')();
    try {
      dep('setLastSaveTime')(Date.now());
      ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(activeBoardId, fullBoardData));
      if (!fullBoardData.columns) fullBoardData.columns = [];
      dep('traceFrontendAction')('warn', 'board.save.force', 'Overwriting external board version with local draft', {
        boardId: activeBoardId,
        trigger: trigger || null,
        workingSummary: window.__lexeraDebugMutations ? dep('summarizeBoardHierarchy')(fullBoardData) : undefined,
        conflictSummary: dep('hasPendingExternalRebaseConflict')()
          ? (function () {
              var c = dep('getPendingExternalRebaseConflict')();
              return c && c.result ? { conflicts: c.result.conflicts || 0, autoMerged: c.result.autoMerged || 0 } : null;
            })()
          : null
      });
      var result = await dep('LexeraApi')().saveBoard(activeBoardId, fullBoardData);
      var savedBoard = result && result.board ? result.board : null;
      if (savedBoard) {
        ensureBoardRowsForMutation(savedBoard, getMutationBoardTitle(activeBoardId, savedBoard));
        dep('setBoardSaveBase')(fullBoardData, savedBoard);
      } else {
        dep('setBoardSaveBase')(fullBoardData, fullBoardData);
      }
      dep('clearPendingExternalRebaseConflict')();
      var activeBoardData = getActiveBoardData();
      if (activeBoardData && result) {
        updateActiveBoardDataState(function (nextBoardData) {
          if (typeof result.version === 'number') nextBoardData.version = result.version;
          if (result.revision) nextBoardData.revision = result.revision;
        });
      }
      if (result && typeof result.generation === 'number') {
        _lastLoadedGeneration = result.generation;
      }
      _lastLoadedRevision = result && result.revision ? result.revision : _lastLoadedRevision;
      clearBoardDirty();
      try {
        await dep('reopenLiveSyncSession')(activeBoardId);
      } catch (err) {
        dep('logFrontendIssue')('warn', 'board.save.force', 'Forced overwrite save succeeded but live sync session could not be reopened', err);
      }
      dep('triggerAutoExportAfterBoardSave')(activeBoardId);
      dep('showNotification')('Local draft saved and overwrote the external board version.');
      return true;
    } catch (err) {
      dep('logFrontendIssue')('error', 'board.save.force', 'Failed to overwrite external board version with local draft', err);
      var overwriteCrashsave = await writeBoardCrashsave('force-overwrite-save-exception', getFullBoardData(), {
        error: err && err.message ? err.message : String(err),
        trigger: trigger || null
      });
      dep('showNotification')(
        overwriteCrashsave && overwriteCrashsave.filename
          ? ('Overwrite failed. Recovery copy written: ' + overwriteCrashsave.filename)
          : 'Overwrite failed. The local draft remains open, but crashsave could not be written.'
      );
      return false;
    } finally {
      _saveInFlight = false;
      dep('hideSaving')();
    }
  }

  // ── Save full board ────────────────────────────────────────────────

  async function saveFullBoard() {
    clearScheduledAutoSave('saveFullBoard-start');
    if (dep('hasPendingExternalRebaseConflict')()) {
      var conflictResult = dep('getPendingExternalRebaseConflict')();
      dep('traceFrontendAction')('warn', 'save.blocked.conflict', 'Blocked save because unresolved external rebase conflict exists', {
        boardId: getActiveBoardId() || null,
        conflicts: conflictResult && conflictResult.result ? (conflictResult.result.conflicts || 0) : 0,
        autoMerged: conflictResult && conflictResult.result ? (conflictResult.result.autoMerged || 0) : 0
      });
      dep('showExternalRebaseConflictDialog')(conflictResult ? conflictResult.result : null);
      return false;
    }
    if (_saveInFlight) {
      _savePending = true;
      dep('traceFrontendAction')('info', 'save.coalesce', 'Save request coalesced because another save is in flight', {
        boardId: getActiveBoardId() || null,
        dirty: isBoardDirty()
      });
      return false;
    }
    _saveInFlight = true;
    var saveSucceeded = false;
    var activeBoardId = getActiveBoardId();
    dep('traceFrontendAction')('info', 'save.begin', 'Starting board save', {
      boardId: activeBoardId || null,
      isRemoteBoard: dep('isActiveRemoteBoard')(),
      dirty: isBoardDirty(),
      savePending: _savePending
    });
    dep('showSaving')();
    try {
      var fullBoardData = getFullBoardData();
      if (!fullBoardData) {
        dep('traceFrontendAction')('warn', 'save.skip.no-board', 'Skipped board save because no full board data is loaded', {
          boardId: activeBoardId || null
        });
        return false;
      }
      do {
        _savePending = false;
        dep('setLastSaveTime')(Date.now());
        fullBoardData = getFullBoardData();
        if (!fullBoardData.columns) fullBoardData.columns = [];

        var liveSession = dep('getLiveSyncSession')(activeBoardId);
        if (liveSession && window.__lexeraDebugMutations) {
          dep('traceBoardIdentityPair')('info', 'save.preflight', 'Pre-save identity comparison against live sync session', activeBoardId, 'local', fullBoardData, 'session', liveSession.board);
        }
        if (liveSession && dep('hasBoardIdentityMismatch')(fullBoardData, liveSession.board)) {
          dep('traceFrontendAction')('error', 'save.identityMismatch', 'Blocked save because local board identities do not match live sync session', {
            boardId: activeBoardId,
            local: dep('getBoardCardIdentityStats')(fullBoardData, liveSession.board),
            incomingSummary: dep('summarizeBoardHierarchy')(fullBoardData),
            sessionSummary: dep('summarizeBoardHierarchy')(liveSession.board)
          });
          var liveSessionCrashsave = await writeBoardCrashsave('identity-mismatch-live-session', fullBoardData, {
            sessionSummary: dep('summarizeBoardHierarchy')(liveSession.board)
          });
          dep('showNotification')(
            liveSessionCrashsave && liveSessionCrashsave.filename
              ? ('Save blocked. Recovery copy written: ' + liveSessionCrashsave.filename)
              : 'Save blocked and crashsave failed. The local draft remains open in the app.'
          );
          return false;
        }

        if (window.__lexeraDebugMutations) dep('traceFrontendAction')('debug', 'save.board', 'Saving board', { summary: dep('boardCardSummary')(fullBoardData) });
        if (await dep('applyBoardToLiveSyncSession')(activeBoardId, fullBoardData, { skipBoardReplace: true, syncSaveBase: true })) {
          if (window.__lexeraDebugMutations) dep('traceFrontendAction')('debug', 'save.board', 'Live sync save path succeeded', {});
          if (dep('getPendingRefresh')()) {
            dep('setPendingRefresh')(false);
            await dep('flushPendingLiveSyncUpdates')({ refreshSidebar: true });
          }
          saveSucceeded = true;
          break;
        }
        var baseBoardData = dep('getBoardSaveBase')(fullBoardData);
        if (baseBoardData && window.__lexeraDebugMutations) {
          dep('traceBoardIdentityPair')('info', 'save.preflight', 'Pre-save identity comparison against save base', activeBoardId, 'local', fullBoardData, 'saveBase', baseBoardData);
        }
        if (baseBoardData && dep('hasBoardIdentityMismatch')(fullBoardData, baseBoardData)) {
          dep('traceFrontendAction')('error', 'save.identityMismatch', 'Blocked save because local board identities do not match its save base', {
            boardId: activeBoardId,
            local: dep('getBoardCardIdentityStats')(fullBoardData, baseBoardData),
            incomingSummary: dep('summarizeBoardHierarchy')(fullBoardData),
            baseSummary: dep('summarizeBoardHierarchy')(baseBoardData)
          });
          var baseMismatchCrashsave = await writeBoardCrashsave('identity-mismatch-save-base', fullBoardData, {
            baseSummary: dep('summarizeBoardHierarchy')(baseBoardData)
          });
          dep('showNotification')(
            baseMismatchCrashsave && baseMismatchCrashsave.filename
              ? ('Save blocked. Recovery copy written: ' + baseMismatchCrashsave.filename)
              : 'Save blocked and crashsave failed. The local draft remains open in the app.'
          );
          return false;
        }
        if (window.__lexeraDebugMutations) dep('traceFrontendAction')('debug', 'save.board', 'Using REST save path', { hasBase: !!baseBoardData, baseSummary: baseBoardData ? dep('boardCardSummary')(baseBoardData) : null });
        if (dep('isActiveRemoteBoard')() && window.__lexeraDebugMutations) {
          dep('traceFrontendAction')('info', 'save.remote', 'Saving remote board via REST', {
            boardId: activeBoardId,
            hasBase: !!baseBoardData,
            summary: dep('summarizeBoardHierarchy')(fullBoardData)
          });
        }
        var result;
        try {
          var LexeraApi = dep('LexeraApi')();
          result = baseBoardData
            ? await LexeraApi.saveBoardWithBase(activeBoardId, baseBoardData, fullBoardData)
            : await LexeraApi.saveBoard(activeBoardId, fullBoardData);
        } catch (err) {
          if (err && err.status === 409) {
            dep('traceFrontendAction')('warn', 'board.save.conflict', 'Save blocked by external conflicting changes', {
              boardId: activeBoardId,
              hasBase: !!baseBoardData,
              error: err && err.message ? err.message : String(err)
            });
            if (baseBoardData) {
              try {
                var conflictResult2 = await dep('LexeraApi')().rebaseBoardWithBase(activeBoardId, baseBoardData, fullBoardData);
                if (conflictResult2 && conflictResult2.hasConflicts) {
                  dep('setPendingExternalRebaseConflict')({
                    result: conflictResult2,
                    savedAt: Date.now()
                  });
                  dep('showExternalRebaseConflictDialog')(conflictResult2);
                  return false;
                }
              } catch (rebaseErr) {
                dep('logFrontendIssue')('error', 'board.save.conflict', 'Failed to fetch rebase preview after conflict', rebaseErr);
              }
            }
            dep('showNotification')('Save blocked: the board changed externally and needs to be reloaded or rebased before saving.');
            return false;
          }
          throw err;
        }

        var savedBoard = result && result.board ? result.board : null;
        if (savedBoard) {
          ensureBoardRowsForMutation(savedBoard, getMutationBoardTitle(activeBoardId, savedBoard));
          dep('setBoardSaveBase')(fullBoardData, savedBoard);
          dep('clearPendingExternalRebaseConflict')();
        } else {
          dep('setBoardSaveBase')(fullBoardData, fullBoardData);
        }
        var activeBoardData = getActiveBoardData();
        if (activeBoardData && result) {
          updateActiveBoardDataState(function (nextBoardData) {
            if (result.redirectedPath) nextBoardData.filePath = result.redirectedPath;
            if (typeof result.version === 'number') nextBoardData.version = result.version;
            if (result.revision) nextBoardData.revision = result.revision;
          });
        }
        if (result && result.redirectedPath) {
          dep('traceFrontendAction')('info', 'save.legacy_redirect', 'Board saved to new file to preserve original v1 file', {
            boardId: activeBoardId,
            redirectedPath: result.redirectedPath
          });
        }
        if (result && typeof result.generation === 'number') {
          _lastLoadedGeneration = result.generation;
        }
        _lastLoadedRevision = result && result.revision ? result.revision : _lastLoadedRevision;

        try {
          await dep('reopenLiveSyncSession')(activeBoardId);
        } catch (e) {
          // REST save succeeded even if the live session cannot be refreshed.
        }
        if (result && result.hasConflicts) {
          dep('showConflictDialog')(result.conflicts, result.autoMerged);
        } else if (result && result.merged && result.autoMerged > 0) {
          dep('showNotification')('Auto-merged ' + result.autoMerged + ' change(s) with server version');
        }
        if (dep('isActiveRemoteBoard')()) {
          dep('traceFrontendAction')('info', 'save.remote', 'Remote board save finished', {
            boardId: activeBoardId,
            revision: result && result.revision ? result.revision : null,
            generation: result && typeof result.generation === 'number' ? result.generation : null,
            hasConflicts: !!(result && result.hasConflicts)
          });
        }
        saveSucceeded = true;
      } while (_savePending);
      if (saveSucceeded) dep('triggerAutoExportAfterBoardSave')(activeBoardId);
      return saveSucceeded;
    } catch (err) {
      var saveErrMsg = err && err.message ? err.message : String(err);
      dep('logFrontendIssue')('error', 'board.save', 'Save failed: ' + saveErrMsg, err);
      var failedSaveCrashsave = await writeBoardCrashsave('save-exception', getFullBoardData(), {
        error: saveErrMsg
      });
      dep('showNotification')(
        failedSaveCrashsave && failedSaveCrashsave.filename
          ? ('Save failed (' + saveErrMsg + '). Recovery copy written: ' + failedSaveCrashsave.filename)
          : ('Save failed (' + saveErrMsg + '). The local draft remains open, but crashsave could not be written.')
      );
      throw err;
    } finally {
      _saveInFlight = false;
      dep('hideSaving')();
    }
  }

  // ── Notify embedded board mutation ─────────────────────────────────

  function notifyEmbeddedBoardMutation(boardId, boardData) {
    if (!dep('isEmbeddedMode')() || !window.parent || window.parent === window || !boardId) return;
    var mutatedBoardId = boardId;
    var mutatedPaneId = dep('getEmbeddedPaneId')();
    var serializedBoard = boardData || null;
    requestAnimationFrame(function () {
      try {
        window.parent.postMessage({
          type: 'lexera-board-mutated',
          boardId: mutatedBoardId,
          pane: mutatedPaneId,
          fullBoard: serializedBoard
        }, '*');
      } catch (e) { /* ignore */ }
    });
  }

  // Draft save is already debounced inside saveLocalBoardDraft (boardList.js:401).
  // No need for a second layer of debouncing here.
  var _draftSaveTimer = null; // kept for cancelAllDeferredWork compatibility

  function scheduleDraftSave(boardId) {
    var fullBoardData = getFullBoardData();
    var activeBoardId = getActiveBoardId();
    if (activeBoardId && fullBoardData) {
      dep('saveLocalBoardDraft')(activeBoardId, fullBoardData);
    }
  }

  // ── Debounced hierarchy refresh ────────────────────────────────────

  var _hierarchyRefreshTimer = null;
  var _hierarchyRefreshArgs = null;

  function scheduleHierarchyRefresh(targetBoardId, boardData, title, opts) {
    _hierarchyRefreshArgs = { targetBoardId: targetBoardId, boardData: boardData, title: title, opts: opts };
    if (_hierarchyRefreshTimer) return; // already scheduled
    _hierarchyRefreshTimer = setTimeout(function () {
      _hierarchyRefreshTimer = null;
      var args = _hierarchyRefreshArgs;
      _hierarchyRefreshArgs = null;
      if (args) dep('refreshBoardHierarchyProjection')(args.targetBoardId, args.boardData, args.title, args.opts);
    }, 150);
  }

  function flushHierarchyRefresh() {
    if (_hierarchyRefreshTimer) {
      clearTimeout(_hierarchyRefreshTimer);
      _hierarchyRefreshTimer = null;
    }
    var args = _hierarchyRefreshArgs;
    _hierarchyRefreshArgs = null;
    if (args) dep('refreshBoardHierarchyProjection')(args.targetBoardId, args.boardData, args.title, args.opts);
  }

  // Cancel all pending deferred work (tests use this between runs to avoid
  // stale timers firing during the next test's assertions).
  function cancelAllDeferredWork() {
    if (_draftSaveTimer) { clearTimeout(_draftSaveTimer); _draftSaveTimer = null; }
    if (_hierarchyRefreshTimer) { clearTimeout(_hierarchyRefreshTimer); _hierarchyRefreshTimer = null; }
    _hierarchyRefreshArgs = null;
    if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
  }

  // ── Commit local board change ──────────────────────────────────────

  function commitLocalBoardChange(boardId, nextBoardData, options) {
    options = options || {};
    var activeBoardId = getActiveBoardId();
    var targetBoardId = boardId || activeBoardId || null;
    var hasExplicitBoardData = arguments.length >= 2;
    var shouldSetLocalState = options.setLocalState !== false && hasExplicitBoardData && targetBoardId === activeBoardId;

    if (shouldSetLocalState) {
      setFullBoardDataState(nextBoardData || null);
    }

    var boardData = hasExplicitBoardData ? nextBoardData : getFullBoardData();
    if (!targetBoardId || !boardData) {
      if (options.notifyParent !== false) notifyEmbeddedBoardMutation(targetBoardId, boardData || null);
      return boardData || null;
    }

    if (options.ensureRows !== false) {
      ensureBoardRowsForMutation(boardData, getMutationBoardTitle(targetBoardId, boardData));
      if (!boardData.columns) boardData.columns = [];
    }

    if (targetBoardId === activeBoardId && getActiveBoardData()) {
      updateActiveBoardDataState(function (nextBoardData) {
        nextBoardData.fullBoard = boardData;
      });
    }

    if (options.refreshHierarchy !== false) {
      var hierarchyRevision = options.revision;
      if (hierarchyRevision == null && targetBoardId === activeBoardId && getActiveBoardData()) {
        hierarchyRevision = getActiveBoardData().revision || null;
      }
      scheduleHierarchyRefresh(targetBoardId, boardData, getMutationBoardTitle(targetBoardId, boardData), {
        revision: hierarchyRevision || null
      });
    }

    if (options.notifyParent !== false) {
      notifyEmbeddedBoardMutation(targetBoardId, boardData);
    }

    return boardData;
  }

  // ── Persist board mutation ─────────────────────────────────────────

  function persistBoardMutation(options) {
    var _pmStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    var _phaseTrace = window.__lexeraProfileMutations ? {} : null;
    function _mark(name) {
      if (_phaseTrace) _phaseTrace[name] = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - _pmStart;
    }
    options = options || {};
    var activeBoardId = getActiveBoardId();
    var fullBoardData = getFullBoardData();
    var targets = Array.isArray(options.targets) ? options.targets : [{ type: 'board' }];
    if (window.__lexeraDebugMutations) {
      dep('traceFrontendAction')('info', 'board.persist', 'Persist board mutation (UI refresh, no immediate save)', {
        boardId: activeBoardId || null,
        targets: targets.map(function (t) { return t.type; }),
        skipAutoSave: !!options.skipAutoSave,
        summaryBefore: dep('summarizeBoardHierarchy')(fullBoardData)
      });
    }
    if (typeof options.beforeRefresh === 'function') {
      options.beforeRefresh();
    }
    _mark('afterBeforeRefresh');

    var hasStructural = false;
    var allCardOnly = true;
    for (var ti = 0; ti < targets.length; ti++) {
      var tt = targets[ti].type;
      if (tt === 'board' || tt === 'main-view' || tt === 'row' || tt === 'stack' || tt === 'column' || tt === 'sidebar') {
        hasStructural = true;
      }
      if (tt !== 'card' && tt !== 'card-insert' && tt !== 'card-remove' && tt !== 'card-content') {
        allCardOnly = false;
      }
    }
    // Invalidate column cache for structural mutations (board/row/stack/column)
    // Card-only mutations don't change the column list
    if (hasStructural) _invalidateAllColsCache();
    // Skip expensive display tree rebuild for pure card-only mutations
    if (!allCardOnly) {
      updateDisplayFromFullBoard();
    }
    _mark('afterUpdateDisplay');
    if (hasStructural && activeBoardId && fullBoardData) {
      commitLocalBoardChange(activeBoardId, fullBoardData, {
        setLocalState: false,
        refreshHierarchy: true
      });
    } else if (activeBoardId && fullBoardData) {
      commitLocalBoardChange(activeBoardId, fullBoardData, {
        setLocalState: false,
        refreshHierarchy: false
      });
    }
    _mark('afterCommit');
    dep('refreshTargetedElements')(targets);
    _mark('afterRefreshTargeted');

    if (typeof options.afterRefresh === 'function') {
      options.afterRefresh();
    }
    dep('scheduleDashboardRefresh')(300);
    _mark('afterDashboardSchedule');
    markBoardDirty();
    scheduleDraftSave(activeBoardId);
    _mark('afterDraftSave');
    if (options.skipAutoSave) {
      dep('traceFrontendAction')('info', 'save.auto.skip', 'Skipped auto-save due to explicit persistBoardMutation option', {
        boardId: activeBoardId || null,
        reason: options.autoSaveReason || 'persist-option-skip'
      });
    } else {
      var isRemoteMutationBoard = dep('isActiveRemoteBoard')();
      var autoSaveDelay = typeof options.autoSaveDelayMs === 'number'
        ? options.autoSaveDelayMs
        : (isRemoteMutationBoard ? AUTO_SAVE_REMOTE_DELAY_MS : AUTO_SAVE_DELAY_MS);
      scheduleAutoSave(
        options.autoSaveReason || (isRemoteMutationBoard ? 'persist-remote-board-mutation' : 'persist-board-mutation'),
        autoSaveDelay
      );
    }
    if (window.__lexeraDebugMutations) {
      dep('traceFrontendAction')('info', 'board.persist', 'Persist board mutation success', {
        boardId: activeBoardId || null,
        targets: targets.map(function (t) { return t.type; }),
        summaryAfter: dep('summarizeBoardHierarchy')(getFullBoardData())
      });
      fullBoardData = getFullBoardData();
      if (activeBoardId && fullBoardData) {
        var session = dep('getLiveSyncSession')(activeBoardId);
        if (session && session.board) {
          dep('traceBoardIdentityPair')('info', 'board.persist.identity', 'Identity comparison after board mutation against live sync session', activeBoardId, 'local', fullBoardData, 'session', session.board);
        }
        var saveBase = dep('getBoardSaveBase')(fullBoardData);
        if (saveBase) {
          dep('traceBoardIdentityPair')('info', 'board.persist.identity', 'Identity comparison after board mutation against save base', activeBoardId, 'local', fullBoardData, 'saveBase', saveBase);
        }
      }
    }
    if (_phaseTrace) {
      var _total = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - _pmStart;
      if (!window.__lexeraMutationProfile) window.__lexeraMutationProfile = [];
      window.__lexeraMutationProfile.push({
        total: _total,
        targets: targets.map(function (t) { return t.type; }).join(','),
        phases: _phaseTrace
      });
      // Only warn on genuinely slow mutations so the log isn't spammy
      if (_total > 100) {
        console.warn('[slow persistBoardMutation]', 'total=' + _total.toFixed(1) + 'ms',
          'targets=' + targets.map(function (t) { return t.type; }).join(','),
          _phaseTrace);
      }
    }
    if (typeof window.traceSlowFrontendTask === 'function') {
      window.traceSlowFrontendTask('board.persist', 'persistBoardMutation', _pmStart, {
        targets: (options.targets || []).map(function (t) { return t.type; }).join(',')
      });
    }
    return true;
  }

  // ── Normalize hierarchy edit targets ───────────────────────────────

  function normalizeHierarchyEditTargets(targets) {
    var normalized = Array.isArray(targets)
      ? targets.filter(function (target) { return !!(target && target.type); }).map(function (target) { return Object.assign({}, target); })
      : [];
    if (normalized.length === 0) normalized.push({ type: 'board' });
    var hasSidebarTarget = false;
    for (var i = 0; i < normalized.length; i++) {
      if (normalized[i].type === 'sidebar') {
        hasSidebarTarget = true;
        break;
      }
    }
    if (!hasSidebarTarget) normalized.push({ type: 'sidebar' });
    return normalized;
  }

  // ── Commit hierarchy tree edit ─────────────────────────────────────

  async function commitHierarchyTreeEdit(boardId, boardData, options) {
    if (!boardId || !boardData) return false;
    options = options || {};
    var targets = normalizeHierarchyEditTargets(options.targets);
    var activeBoardId = getActiveBoardId();

    if (boardId === activeBoardId) {
      persistBoardMutation({ targets: targets });
      return true;
    }

    var changedBoards = {};
    changedBoards[boardId] = boardData;
    return commitBoardMutations(changedBoards, { refreshSidebar: true });
  }

  // ── Commit board mutations (cross-board) ───────────────────────────

  async function commitBoardMutations(changedBoards, options) {
    options = options || {};
    var boardIds = Object.keys(changedBoards || {});
    if (boardIds.length === 0) return true;
    var activeBoardId = getActiveBoardId();

    try {
      for (var i = 0; i < boardIds.length; i++) {
        var boardId = boardIds[i];
        var boardData = changedBoards[boardId];
        if (!boardData) continue;

        if (boardId === activeBoardId) {
          ensureBoardRowsForMutation(boardData, getMutationBoardTitle(boardId, boardData));
          if (!dep('getBoardSaveBase')(boardData)) dep('setBoardSaveBase')(boardData, boardData);
          if (getFullBoardData() !== boardData) setFullBoardDataState(boardData);
          if (!getActiveBoardData()) {
            setActiveBoardDataState({
              valid: true,
              title: getMutationBoardTitle(boardId, boardData),
              fullBoard: boardData,
              columns: [],
              rows: []
            });
          } else if (getActiveBoardData().fullBoard !== boardData) {
            updateActiveBoardDataState(function (nextBoardData) {
              nextBoardData.fullBoard = boardData;
              if (!nextBoardData.title) nextBoardData.title = getMutationBoardTitle(boardId, boardData);
            });
          }
          updateDisplayFromFullBoard();
          commitLocalBoardChange(boardId, boardData, {
            setLocalState: false,
            refreshHierarchy: true
          });
          markBoardDirty();
          try {
            await saveFullBoard();
          } catch (saveErr) {
            dep('logFrontendIssue')('warn', 'commitBoardMutations', 'Failed to save active board during cross-board mutation', saveErr);
          }
          continue;
        }

        dep('showSaving')();
        dep('setLastSaveTime')(Date.now());
        ensureBoardRowsForMutation(boardData, getMutationBoardTitle(boardId, boardData));
        if (!boardData.columns) boardData.columns = [];
        var baseBoardData = dep('getBoardSaveBase')(boardData);
        var LexeraApi = dep('LexeraApi')();
        var result = baseBoardData
          ? await LexeraApi.saveBoardWithBase(boardId, baseBoardData, boardData)
          : await LexeraApi.saveBoard(boardId, boardData);
        var savedBoardData = dep('resolveSavedBoardData')(boardData, result, boardId);
        changedBoards[boardId] = savedBoardData;
        commitLocalBoardChange(boardId, savedBoardData, {
          setLocalState: false,
          refreshHierarchy: true
        });
      }
      if (typeof options.beforeRefresh === 'function') options.beforeRefresh();
      var commitTargets = [];
      if (boardIds.indexOf(activeBoardId) !== -1) {
        commitTargets.push({ type: 'board' });
      }
      if (options.refreshSidebar) commitTargets.push({ type: 'sidebar' });
      dep('refreshTargetedElements')(commitTargets);
      if (boardIds.indexOf(activeBoardId) !== -1) dep('refreshHeaderFileControls')();
      if (typeof options.afterRefresh === 'function') options.afterRefresh();
      dep('scheduleDashboardRefresh')(300);
      return true;
    } catch (err) {
      dep('logFrontendIssue')('error', 'commitBoardMutations', 'Save failed for non-active board', err);
      if (typeof options.onError === 'function') options.onError(err);
      return false;
    } finally {
      dep('hideSaving')();
    }
  }

  // ── Load board ─────────────────────────────────────────────────────

  async function loadBoard(boardId) {
    var seq = dep('incrementBoardLoadSeq')();
    var activeBoardId = getActiveBoardId();
    var isBoardSwitch = boardId !== activeBoardId;
    dep('resetBoardStatsFilter')();
    dep('resetColumnSortState')();
    dep('closeSearchReplacePanel')();
    if (isBoardSwitch) {
      if (dep('getCanvasZoom')() !== 1) dep('applyCanvasZoom')(1);
      dep('resetCanvasPan')();
    }
    var loadStage = 'start';
    try {
      loadStage = 'clear-caches';
      dep('clearBoardPreviewCaches')(boardId);
      dep('clearEditingPresenceMap')();
      var activeBoardData = getActiveBoardData();
      var cachedRevision = (!isBoardSwitch && (_lastLoadedRevision || (activeBoardData && activeBoardData.revision)))
        ? (_lastLoadedRevision || activeBoardData.revision)
        : null;
      loadStage = cachedRevision != null ? 'fetch-cached' : 'fetch';
      var LexeraApi = dep('LexeraApi')();
      var response = cachedRevision != null
        ? await LexeraApi.getBoardColumnsCached(boardId, cachedRevision)
        : await LexeraApi.getBoardColumns(boardId);
      if (seq !== dep('getBoardLoadSeq')()) return;
      if (response && response.notModified) {
        dep('traceFrontendAction')('info', 'board.load.notModified', 'Skipped board reload because backend returned not-modified', {
          boardId: boardId,
          revision: cachedRevision || null,
          dirty: isBoardDirty(),
          isRemoteBoard: dep('isRemoteBoardId')(boardId)
        });
        loadStage = 'connect-sync-not-modified';
        dep('connectSyncForBoard')(boardId);
        return;
      }
      loadStage = 'prepare-board-meta';
      var boardMeta = dep('findBoardMeta')(boardId);
      if (boardMeta && boardMeta.filePath) {
        response.filePath = boardMeta.filePath;
      }
      loadStage = 'assign-board-data';
      setFullBoardDataState(response.fullBoard || null);
      var fullBoardData = getFullBoardData();
      if (fullBoardData) dep('setBoardSaveBase')(fullBoardData, fullBoardData);
      var isRemoteBoard = !!(response && response.isRemote);
      if (fullBoardData) {
        dep('traceFrontendAction')('info', 'board.load.identity', 'Loaded board from backend', {
          boardId: boardId,
          identity: dep('summarizeBoardIdentity')(fullBoardData)
        });
      }
      setActiveBoardDataState(response);
      try {
        await dep('refreshAvailableMarpClasses')(false);
      } catch (marpClassErr) {
        dep('logFrontendIssue')('warn', 'board.load.marp-classes', 'Failed to refresh Marp classes during board load', marpClassErr);
      }
      dep('clearPendingExternalRebaseConflict')();
      resetBoardDirtyState('loadBoard-fresh-backend-snapshot', boardId);
      var draftSnapshot = isRemoteBoard ? null : dep('loadLocalBoardDraft')(boardId);
      var shouldPrepareLiveSync = true;
      if (response && typeof response.generation === 'number') {
        _lastLoadedGeneration = response.generation;
      }
      _lastLoadedRevision = response && response.revision ? response.revision : null;
      if (isRemoteBoard) {
        dep('clearLocalBoardDraft')(boardId);
      } else if (fullBoardData && (!fullBoardData.rows || fullBoardData.rows.length === 0)) {
        loadStage = 'migrate-legacy-board';
        migrateLegacyBoard();
        try {
          loadStage = 'save-migrated-board';
          await saveFullBoard();
        } catch (err) {
          dep('logFrontendIssue')('warn', 'board.load.migrate', 'Failed to persist migrated board ' + boardId, err);
        }
        if (seq !== dep('getBoardLoadSeq')()) return;
      }
      if (!isBoardSwitch && draftSnapshot) {
        dep('clearLocalBoardDraft')(boardId);
        draftSnapshot = null;
        dep('traceFrontendAction')('info', 'board.draft.sessionClear',
          'Cleared current-session draft during board reload (not a board switch)', { boardId: boardId });
      }
      if (draftSnapshot && draftSnapshot.board) {
        var currentSerialized = JSON.stringify(dep('cloneBoardData')(fullBoardData));
        var draftSerialized = JSON.stringify(draftSnapshot.board);
        if (currentSerialized !== draftSerialized) {
          var currentBoard = response.fullBoard || null;
          var draftBaseBoard = draftSnapshot.baseBoard || null;
          var sameRevision = !!(draftSnapshot.revision && response.revision && draftSnapshot.revision === response.revision);
          var draftIdentity = dep('getBoardCardIdentityStats')(currentBoard, draftSnapshot.board);
          var draftMatchesCurrentIds = !dep('hasBoardIdentityMismatch')(currentBoard, draftSnapshot.board);
          var draftHasBase = !!draftBaseBoard;
          var canRestoreDirectly = sameRevision && draftMatchesCurrentIds;
          var canRestoreViaRebase = draftHasBase && !sameRevision;
          if (!canRestoreDirectly && !canRestoreViaRebase) {
            loadStage = 'restore-local-draft-blocked';
            shouldPrepareLiveSync = true;
            var discardUnrecoverableDraft = sameRevision && !draftHasBase && draftIdentity.overlap === 0;
            if (discardUnrecoverableDraft) {
              dep('clearLocalBoardDraft')(boardId);
              dep('traceFrontendAction')('info', 'board.draft.discard', 'Discarded incompatible stale local draft during board load', {
                boardId: boardId,
                currentRevision: response.revision || null,
                draftRevision: draftSnapshot.revision || null,
                hasBaseBoard: draftHasBase,
                identity: draftIdentity
              });
            } else {
              dep('traceFrontendAction')('warn', 'board.draft.restore', 'Skipped unsafe local draft restore because card identities no longer match current board', {
                boardId: boardId,
                currentRevision: response.revision || null,
                draftRevision: draftSnapshot.revision || null,
                hasBaseBoard: draftHasBase,
                discarded: false,
                identity: draftIdentity
              });
              dep('showNotification')('A local draft was preserved but not restored because it no longer matches the current board revision safely.');
            }
          } else {
            loadStage = 'restore-local-draft';
            var restoreMessage = canRestoreDirectly
              ? 'Restore the unsaved local draft for this board?\n\nIt was saved automatically on this device.'
              : (canRestoreViaRebase
                ? 'Restore the unsaved local draft for this board?\n\nExternal changes will be rebased against its saved base first.'
                : 'Restore the unsaved local draft for this board?\n\nIt was saved automatically on this device.');
            var restoreDraft = await dep('showConfirmDialog')(restoreMessage);
          }
          if (typeof restoreDraft !== 'undefined') {
            if (restoreDraft) {
              if (canRestoreViaRebase) {
                loadStage = 'restore-local-draft-rebase';
                try {
                  var rebasedDraft = await dep('LexeraApi')().rebaseBoardWithBase(boardId, draftBaseBoard, draftSnapshot.board);
                  if (rebasedDraft && rebasedDraft.currentBoard && !rebasedDraft.hasConflicts) {
                    setFullBoardDataState(rebasedDraft.board || draftSnapshot.board);
                    fullBoardData = getFullBoardData();
                    ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
                    if (!fullBoardData.columns) fullBoardData.columns = [];
                    dep('setBoardSaveBase')(fullBoardData, rebasedDraft.currentBoard || response.fullBoard || fullBoardData);
                    markBoardDirty();
                  } else if (rebasedDraft && rebasedDraft.hasConflicts) {
                    shouldPrepareLiveSync = false;
                    dep('setPendingExternalRebaseConflict')({
                      result: rebasedDraft,
                      savedAt: Date.now()
                    });
                    dep('traceFrontendAction')('warn', 'board.draft.restore', 'Draft restore blocked by rebase conflicts', {
                      boardId: boardId,
                      currentRevision: response.revision || null,
                      draftRevision: draftSnapshot.revision || null,
                      conflicts: rebasedDraft.conflicts || 0
                    });
                    dep('showNotification')('The local draft was preserved, but it conflicts with the current board and was not restored automatically.');
                  }
                } catch (restoreErr) {
                  shouldPrepareLiveSync = false;
                  dep('logFrontendIssue')('warn', 'board.draft.restore', 'Failed to rebase local draft before restore', restoreErr);
                  dep('showNotification')('The local draft was preserved, but automatic restore failed.');
                }
              } else {
                setFullBoardDataState(draftSnapshot.board);
                fullBoardData = getFullBoardData();
                ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
                if (!fullBoardData.columns) fullBoardData.columns = [];
                dep('setBoardSaveBase')(fullBoardData, draftBaseBoard || response.fullBoard || fullBoardData);
                markBoardDirty();
              }
            } else {
              dep('clearLocalBoardDraft')(boardId);
            }
          }
        } else {
          dep('clearLocalBoardDraft')(boardId);
        }
      }
      fullBoardData = getFullBoardData();
      if (fullBoardData) {
        try {
          loadStage = 'prepare-live-sync';
          await dep('closeLiveSyncSession')(boardId);
          if (shouldPrepareLiveSync) {
            await dep('ensureLiveSyncSession')(boardId);
            var liveSyncState = dep('getLiveSyncState')();
            if (liveSyncState && liveSyncState.boardId === boardId && fullBoardData && window.__lexeraDebugMutations) {
              dep('traceBoardIdentityPair')('info', 'board.load.identity', 'Identity comparison after board load session prepare', boardId, 'local', fullBoardData, 'session', liveSyncState.board);
            }
          } else {
            dep('setLiveSyncState')(null);
            dep('LexeraApi')().disconnectSync();
          }
        } catch (e) {
          dep('logFrontendIssue')('warn', 'board.load.live-sync', 'Failed to prepare live sync session for board ' + boardId, e);
        }
      }
      loadStage = 'update-display';
      updateDisplayFromFullBoard();
      loadStage = 'set-board-hierarchy';
      commitLocalBoardChange(boardId, getFullBoardData(), {
        setLocalState: false,
        refreshHierarchy: true,
        revision: response.revision || null
      });
      loadStage = 'render-main-view';
      dep('renderMainView')();
      loadStage = 'schedule-dashboard-refresh';
      dep('scheduleDashboardRefresh')(300);
      loadStage = 'connect-sync';
      dep('connectSyncForBoard')(boardId);
    } catch (err) {
      if (seq !== dep('getBoardLoadSeq')()) return;
      dep('logFrontendIssue')('error', 'board.load', 'Failed to load board ' + boardId + ' during ' + loadStage, err);
      try {
        await dep('closeLiveSyncSession')(boardId);
      } catch (closeErr) {
        dep('logFrontendIssue')('warn', 'board.load.live-sync', 'Failed to close live sync session after load failure for board ' + boardId, closeErr);
      }
      setActiveBoardDataState(null);
      setFullBoardDataState(null);
      _lastLoadedGeneration = null;
      _lastLoadedRevision = null;
      dep('renderMainView')();
      dep('scheduleDashboardRefresh')(300);
    }
  }

  // ── Load board data for mutation ───────────────────────────────────

  async function loadBoardDataForMutation(boardId) {
    if (!boardId) return null;
    var activeBoardId = getActiveBoardId();
    var fullBoardData = getFullBoardData();
    if (boardId === activeBoardId && fullBoardData) {
      ensureBoardRowsForMutation(fullBoardData, getMutationBoardTitle(boardId, fullBoardData));
      if (!dep('getBoardSaveBase')(fullBoardData)) dep('setBoardSaveBase')(fullBoardData, fullBoardData);
      return fullBoardData;
    }
    var response = await dep('LexeraApi')().getBoardColumns(boardId);
    var boardData = response && response.fullBoard ? response.fullBoard : { rows: [], columns: [] };
    ensureBoardRowsForMutation(boardData, response && response.title ? response.title : getMutationBoardTitle(boardId, boardData));
    return dep('setBoardSaveBase')(boardData, boardData);
  }

  // ── Public API ─────────────────────────────────────────────────────

  return {
    init: function (deps) {
      _deps = deps;
    },

    // State accessors for app.js to read internal state
    getLastLoadedGeneration: function () { return _lastLoadedGeneration; },
    setLastLoadedGeneration: function (v) { _lastLoadedGeneration = v; },
    getLastLoadedRevision: function () { return _lastLoadedRevision; },
    setLastLoadedRevision: function (v) { _lastLoadedRevision = v; },
    getSaveInFlight: function () { return _saveInFlight; },
    getSavePending: function () { return _savePending; },
    getAutoSaveTimer: function () { return _autoSaveTimer; },

    // Board data query
    getAllColumnsFromBoardData: getAllColumnsFromBoardData,
    getAllFullColumns: getAllFullColumns,
    getFullColumn: getFullColumn,
    getColumnByLocation: getColumnByLocation,
    getRowByLocation: getRowByLocation,
    getStackByLocation: getStackByLocation,
    getCardByLocation: getCardByLocation,

    // Renderable
    cloneVisibleCardForRender: cloneVisibleCardForRender,
    buildRenderableColumnSnapshot: buildRenderableColumnSnapshot,
    getRenderableColumnByIndex: getRenderableColumnByIndex,

    // Display
    updateDisplayFromFullBoard: updateDisplayFromFullBoard,

    // Board structure
    migrateLegacyBoard: migrateLegacyBoard,
    ensureBoardRowsForMutation: ensureBoardRowsForMutation,
    getMutationBoardTitle: getMutationBoardTitle,

    // Dirty state
    markBoardDirty: markBoardDirty,
    resetBoardDirtyState: resetBoardDirtyState,
    isBoardDirty: isBoardDirty,
    getBoardDirtyGeneration: getBoardDirtyGeneration,
    clearBoardDirtyIfUnchanged: clearBoardDirtyIfUnchanged,
    clearBoardDirty: clearBoardDirty,

    // Auto-save
    clearScheduledAutoSave: clearScheduledAutoSave,
    scheduleAutoSave: scheduleAutoSave,
    AUTO_SAVE_DELAY_MS: AUTO_SAVE_DELAY_MS,
    AUTO_SAVE_REMOTE_DELAY_MS: AUTO_SAVE_REMOTE_DELAY_MS,

    // Deferred work control (for tests and shutdown)
    cancelAllDeferredWork: cancelAllDeferredWork,
    flushHierarchyRefresh: flushHierarchyRefresh,

    // Save pipeline
    saveFullBoard: saveFullBoard,
    writeBoardCrashsave: writeBoardCrashsave,
    overwriteBoardWithLocalDraft: overwriteBoardWithLocalDraft,

    // Load
    loadBoard: loadBoard,
    loadBoardDataForMutation: loadBoardDataForMutation,

    // Commit pipeline
    notifyEmbeddedBoardMutation: notifyEmbeddedBoardMutation,
    commitLocalBoardChange: commitLocalBoardChange,
    persistBoardMutation: persistBoardMutation,
    normalizeHierarchyEditTargets: normalizeHierarchyEditTargets,
    commitHierarchyTreeEdit: commitHierarchyTreeEdit,
    commitBoardMutations: commitBoardMutations
  };
})();

if (typeof window !== 'undefined') window.LexeraBoardDataStore = LexeraBoardDataStore;
if (typeof globalThis !== 'undefined') globalThis.LexeraBoardDataStore = LexeraBoardDataStore;
