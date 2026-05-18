/**
 * DnD Mutations — display-to-full index resolution and structural mutation
 * helpers for drag-and-drop operations on the kanban board.
 *
 * Dependencies injected via init():
 *   - getFullBoardData()            — returns fullBoardData reference
 *   - getActiveBoardData()          — returns activeBoardData reference
 *   - getActiveBoardId()            — returns activeBoardId string
 *   - pushUndo()                    — snapshot undo before non-reversible mutation fallback
 *   - pushUndoOperation(operation)  — optional explicit operation undo
 *   - finalizePendingUndo()         — optional pending snapshot finalization
 *   - persistBoardMutation(opts)    — persist after local-board mutation
 *   - addColumnToStack(r, s, idx)   — add column at index in stack
 *   - applyDefaultCanvasPlacementToStack(row, stack)
 *   - getDisplayOrderedColumnEntries(columns)
 *   - stripInternalHiddenTags(text)
 *   - stripHtmlComments(text)
 *   - traceFrontendAction(level, tag, msg, data)
 *   - resolveRowForMutation(boardId, boardData, rowIndex, indexMode)
 *   - resolveStackForMutation(boardId, boardData, rowIndex, stackIndex, indexMode)
 *   - resolveColumnRefForCardMutation(boardId, boardData, descriptor)
 */
var LexeraDndMutations = (function () {
  'use strict';

  var _deps = {};
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
  var _undoOperationSuppressDepth = 0;

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      _rt = window.LexeraRuntime;
      _rt.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  // ── Dependency accessors ──────────────────────────────────────────

  function fullBoardData() { return _deps.getFullBoardData ? _deps.getFullBoardData() : null; }
  function activeBoardData() { return _deps.getActiveBoardData ? _deps.getActiveBoardData() : null; }
  function activeBoardId() { return _deps.getActiveBoardId ? _deps.getActiveBoardId() : null; }

  function getDndMutationsUndoRedoSystem() {
    var root = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null);
    return root && root.LexeraUndoRedo ? root.LexeraUndoRedo : null;
  }

  function isDndMutationUndoOperationRecordingSuppressed() {
    return _undoOperationSuppressDepth > 0;
  }

  async function runWithoutDndMutationUndoOperationRecording(fn) {
    _undoOperationSuppressDepth++;
    try {
      return await fn();
    } finally {
      _undoOperationSuppressDepth--;
    }
  }

  function finalizePendingDndMutationUndo() {
    if (isDndMutationUndoOperationRecordingSuppressed()) return;
    if (typeof _deps.finalizePendingUndo === 'function') {
      _deps.finalizePendingUndo();
      return;
    }
    var undoRedo = getDndMutationsUndoRedoSystem();
    if (undoRedo && typeof undoRedo.finalizePendingUndo === 'function') undoRedo.finalizePendingUndo();
  }

  function pushDndMutationUndoOperation(operation) {
    if (isDndMutationUndoOperationRecordingSuppressed()) return false;
    if (!operation || typeof operation.undo !== 'function') return false;
    if (typeof _deps.pushUndoOperation === 'function') {
      _deps.pushUndoOperation(operation);
      return true;
    }
    var undoRedo = getDndMutationsUndoRedoSystem();
    if (undoRedo && typeof undoRedo.pushUndoOperation === 'function') {
      undoRedo.pushUndoOperation(operation);
      return true;
    }
    return false;
  }

  function afterDndMutationPersist(persistResult, recordOperation) {
    return Promise.resolve(persistResult).then(function (result) {
      if (typeof recordOperation === 'function') recordOperation();
      return result;
    });
  }

  // ── Display-to-full index resolution helpers ──────────────────────

  /**
   * Find the fullBoardData row that corresponds to a display row index.
   * Matches by row id from activeBoardData.rows.
   */
  function findFullDataRow(displayRowIdx) {
    var abd = activeBoardData();
    var fbd = fullBoardData();
    if (!abd || !abd.rows || displayRowIdx >= abd.rows.length) return null;
    var displayRow = abd.rows[displayRowIdx];
    for (var i = 0; i < fbd.rows.length; i++) {
      if (fbd.rows[i].id === displayRow.id) return fbd.rows[i];
    }
    if (typeof window !== 'undefined' && typeof window.lexeraLog === 'function') {
      window.lexeraLog('warn', '[dndMutations.findFullDataRow] returning null — display row id "' + displayRow.id + '" not found in fullBoardData (active/full board desync)');
    }
    return null;
  }

  function findFullDataStack(displayRowIdx, displayStackIdx) {
    var row = findFullDataRow(displayRowIdx);
    var abd = activeBoardData();
    if (!row || !abd || !abd.rows || displayRowIdx < 0 || displayRowIdx >= abd.rows.length) return null;
    var displayRow = abd.rows[displayRowIdx];
    if (!displayRow || displayStackIdx < 0 || displayStackIdx >= displayRow.stacks.length) return null;
    var displayStack = displayRow.stacks[displayStackIdx];
    for (var i = 0; i < row.stacks.length; i++) {
      if (row.stacks[i].id === displayStack.id) return row.stacks[i];
    }
    if (typeof window !== 'undefined' && typeof window.lexeraLog === 'function') {
      window.lexeraLog('warn', '[dndMutations.findFullDataStack] returning null — display stack id "' + displayStack.id + '" not found in fullBoardData row (active/full board desync)');
    }
    return null;
  }

  function findFullDataRowIndex(displayRowIdx) {
    var abd = activeBoardData();
    var fbd = fullBoardData();
    if (!abd || !abd.rows || displayRowIdx < 0 || displayRowIdx >= abd.rows.length) return -1;
    var displayRow = abd.rows[displayRowIdx];
    for (var i = 0; i < fbd.rows.length; i++) {
      if (fbd.rows[i].id === displayRow.id) return i;
    }
    return -1;
  }

  function findInsertRowIndex(displayInsertAtIdx) {
    var fbd = fullBoardData();
    var abd = activeBoardData();
    if (!fbd || !fbd.rows) return 0;
    if (!abd || !abd.rows || displayInsertAtIdx >= abd.rows.length) {
      return fbd.rows.length;
    }
    if (displayInsertAtIdx <= 0) {
      var first = abd.rows[0];
      if (first && first.id) {
        for (var i = 0; i < fbd.rows.length; i++) {
          if (fbd.rows[i].id === first.id) return i;
        }
      }
      return 0;
    }
    var target = abd.rows[displayInsertAtIdx];
    if (target && target.id) {
      for (var i = 0; i < fbd.rows.length; i++) {
        if (fbd.rows[i].id === target.id) return i;
      }
    }
    return fbd.rows.length;
  }

  function visibleColumnIndicesInStack(stack) {
    var result = [];
    if (!stack || !stack.columns) return result;
    var entries = _deps.getDisplayOrderedColumnEntries(stack.columns || []);
    for (var i = 0; i < entries.length; i++) {
      result.push(entries[i].fullIndex);
    }
    return result;
  }

  function findFullDataStackIndex(fullRow, displayRowIdx, displayStackIdx) {
    var abd = activeBoardData();
    if (!fullRow || !abd || !abd.rows || displayRowIdx < 0 || displayRowIdx >= abd.rows.length) return -1;
    var displayRow = abd.rows[displayRowIdx];
    if (!displayRow || displayStackIdx < 0 || displayStackIdx >= displayRow.stacks.length) return -1;
    var displayStack = displayRow.stacks[displayStackIdx];

    if (displayStack.id) {
      for (var i = 0; i < fullRow.stacks.length; i++) {
        if (fullRow.stacks[i].id === displayStack.id) return i;
      }
    }

    // Fallback when IDs are missing: map by visible stack order.
    var visibleStackIdx = -1;
    for (var i = 0; i < fullRow.stacks.length; i++) {
      if (visibleColumnIndicesInStack(fullRow.stacks[i]).length === 0) continue;
      visibleStackIdx++;
      if (visibleStackIdx === displayStackIdx) return i;
    }
    return -1;
  }

  function findFullColumnIndexInStack(stack, displayColIdx) {
    if (!stack || displayColIdx < 0) return -1;
    var visible = visibleColumnIndicesInStack(stack);
    return displayColIdx < visible.length ? visible[displayColIdx] : -1;
  }

  function findInsertStackIndexInRow(fullRow, displayRowIdx, displayInsertAtIdx) {
    var abd = activeBoardData();
    if (!fullRow || !fullRow.stacks) return 0;
    if (!abd || !abd.rows || displayRowIdx < 0 || displayRowIdx >= abd.rows.length) {
      return fullRow.stacks.length;
    }
    var displayRow = abd.rows[displayRowIdx];
    if (!displayRow || !displayRow.stacks || displayInsertAtIdx >= displayRow.stacks.length) {
      return fullRow.stacks.length;
    }
    if (displayInsertAtIdx <= 0) {
      // Insert before the first visible stack
      var first = displayRow.stacks[0];
      if (first && first.id) {
        for (var i = 0; i < fullRow.stacks.length; i++) {
          if (fullRow.stacks[i].id === first.id) return i;
        }
      }
      return 0;
    }
    // Insert before the display stack at displayInsertAtIdx
    var target = displayRow.stacks[displayInsertAtIdx];
    if (target && target.id) {
      for (var i = 0; i < fullRow.stacks.length; i++) {
        if (fullRow.stacks[i].id === target.id) return i;
      }
    }
    return fullRow.stacks.length;
  }

  function findInsertColumnIndexInStack(stack, displayColIdx, insertBefore) {
    if (!stack) return -1;
    var visible = visibleColumnIndicesInStack(stack);
    if (displayColIdx < 0 || displayColIdx >= visible.length) {
      return stack.columns.length;
    }
    return insertBefore ? visible[displayColIdx] : (visible[displayColIdx] + 1);
  }

  function normalizeDndMutationEntityId(value) {
    var normalized = String(value == null ? '' : value).trim();
    return normalized || null;
  }

  function cloneDndMutationValue(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    var json = JSON.stringify(value);
    return typeof json === 'undefined' ? undefined : JSON.parse(json);
  }

  function cloneDndMutationContainerShell(entity, childKey) {
    if (!entity || typeof entity !== 'object') return null;
    var shell = {};
    var keys = Object.keys(entity);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key === childKey) continue;
      shell[key] = cloneDndMutationValue(entity[key]);
    }
    shell[childKey] = [];
    return shell;
  }

  function findDndMutationItemIndexById(items, id) {
    id = normalizeDndMutationEntityId(id);
    if (!id || !Array.isArray(items)) return -1;
    for (var i = 0; i < items.length; i++) {
      if (normalizeDndMutationEntityId(items[i] && items[i].id) === id) return i;
    }
    return -1;
  }

  function captureDndMutationSiblingAnchor(items, index) {
    var list = Array.isArray(items) ? items : [];
    return {
      index: typeof index === 'number' ? index : list.length,
      prevId: index > 0 ? normalizeDndMutationEntityId(list[index - 1] && list[index - 1].id) : null,
      nextId: index >= 0 && index + 1 < list.length ? normalizeDndMutationEntityId(list[index + 1] && list[index + 1].id) : null
    };
  }

  function resolveDndMutationInsertIndexFromAnchor(items, anchor) {
    var list = Array.isArray(items) ? items : [];
    var nextIdx = findDndMutationItemIndexById(list, anchor && anchor.nextId);
    if (nextIdx !== -1) return nextIdx;
    var prevIdx = findDndMutationItemIndexById(list, anchor && anchor.prevId);
    if (prevIdx !== -1) return prevIdx + 1;
    var fallback = anchor && typeof anchor.index === 'number' ? anchor.index : list.length;
    if (fallback < 0) fallback = 0;
    if (fallback > list.length) fallback = list.length;
    return fallback;
  }

  function findDndMutationRowLocationById(boardData, rowId) {
    var rows = Array.isArray(boardData && boardData.rows) ? boardData.rows : [];
    var rowIndex = findDndMutationItemIndexById(rows, rowId);
    if (rowIndex === -1) return null;
    return { row: rows[rowIndex], rowIndex: rowIndex };
  }

  function findDndMutationStackLocationById(boardData, stackId) {
    stackId = normalizeDndMutationEntityId(stackId);
    var rows = Array.isArray(boardData && boardData.rows) ? boardData.rows : [];
    if (!stackId) return null;
    for (var r = 0; r < rows.length; r++) {
      var stacks = Array.isArray(rows[r] && rows[r].stacks) ? rows[r].stacks : [];
      var stackIndex = findDndMutationItemIndexById(stacks, stackId);
      if (stackIndex !== -1) {
        return {
          row: rows[r],
          rowIndex: r,
          stack: stacks[stackIndex],
          stackIndex: stackIndex
        };
      }
    }
    return null;
  }

  function ensureDndMutationRowForUndo(boardData, rowId, rowShell, rowAnchor) {
    var rowLoc = findDndMutationRowLocationById(boardData, rowId);
    if (rowLoc) return rowLoc;
    if (!rowShell) return null;
    if (!Array.isArray(boardData.rows)) boardData.rows = [];
    var restoredRow = cloneDndMutationValue(rowShell);
    if (!Array.isArray(restoredRow.stacks)) restoredRow.stacks = [];
    var insertAt = resolveDndMutationInsertIndexFromAnchor(boardData.rows, rowAnchor);
    boardData.rows.splice(insertAt, 0, restoredRow);
    return { row: restoredRow, rowIndex: insertAt };
  }

  async function moveDndMutationRowByOperation(operation, anchorName) {
    var boardData = fullBoardData();
    if (!operation || !boardData || activeBoardId() !== operation.boardId) return;
    var rows = Array.isArray(boardData.rows) ? boardData.rows : null;
    if (!rows) return;
    var currentIdx = findDndMutationItemIndexById(rows, operation.rowId);
    if (currentIdx === -1) return;
    var row = rows.splice(currentIdx, 1)[0];
    var insertAt = resolveDndMutationInsertIndexFromAnchor(rows, operation[anchorName]);
    rows.splice(insertAt, 0, row);
    await _deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
  }

  async function moveDndMutationStackByOperation(operation, rowName, stackAnchorName, rowAnchorName, rowShellName) {
    var boardData = fullBoardData();
    if (!operation || !boardData || activeBoardId() !== operation.boardId) return;
    var stackLoc = findDndMutationStackLocationById(boardData, operation.stackId);
    if (!stackLoc || !stackLoc.row || !Array.isArray(stackLoc.row.stacks)) return;
    var stack = stackLoc.row.stacks.splice(stackLoc.stackIndex, 1)[0];
    removeEmptyStacksAndRows();
    var targetRow = ensureDndMutationRowForUndo(
      boardData,
      operation[rowName],
      operation[rowShellName],
      operation[rowAnchorName]
    );
    if (!targetRow || !targetRow.row) return;
    if (!Array.isArray(targetRow.row.stacks)) targetRow.row.stacks = [];
    var insertAt = resolveDndMutationInsertIndexFromAnchor(targetRow.row.stacks, operation[stackAnchorName]);
    targetRow.row.stacks.splice(insertAt, 0, stack);
    removeEmptyStacksAndRows();
    await _deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
  }

  function recordDndMutationRowMoveUndo(operation) {
    pushDndMutationUndoOperation({
      meta: {
        type: 'same-board-row-reorder',
        boardId: operation.boardId,
        entityId: operation.rowId
      },
      undo: function () {
        return runWithoutDndMutationUndoOperationRecording(function () {
          return moveDndMutationRowByOperation(operation, 'sourceAnchor');
        });
      },
      redo: function () {
        return runWithoutDndMutationUndoOperationRecording(function () {
          return moveDndMutationRowByOperation(operation, 'targetAnchor');
        });
      }
    });
  }

  function recordDndMutationStackMoveUndo(operation) {
    pushDndMutationUndoOperation({
      meta: {
        type: 'same-board-stack-move',
        boardId: operation.boardId,
        entityId: operation.stackId
      },
      undo: function () {
        return runWithoutDndMutationUndoOperationRecording(function () {
          return moveDndMutationStackByOperation(operation, 'sourceRowId', 'sourceStackAnchor', 'sourceRowAnchor', 'sourceRowShell');
        });
      },
      redo: function () {
        return runWithoutDndMutationUndoOperationRecording(function () {
          return moveDndMutationStackByOperation(operation, 'targetRowId', 'targetStackAnchor', 'targetRowAnchor', 'targetRowShell');
        });
      }
    });
  }

  // ── Row / column relative insertion ───────────────────────────────

  function addColumnRelativeToDisplayPosition(displayRowIdx, displayStackIdx, displayColIdx, insertBefore) {
    var stack = findFullDataStack(displayRowIdx, displayStackIdx);
    if (!stack) {
      _deps.traceFrontendAction('warn', 'column.insert.relative', 'Failed to resolve stack for display-relative insert', {
        boardId: activeBoardId() || null,
        displayRowIdx: displayRowIdx,
        displayStackIdx: displayStackIdx,
        displayColIdx: displayColIdx,
        insertBefore: !!insertBefore
      });
      return false;
    }
    var visibleIndices = visibleColumnIndicesInStack(stack);
    var insertAt = findInsertColumnIndexInStack(stack, displayColIdx, insertBefore);
    if (insertAt < 0) {
      _deps.traceFrontendAction('warn', 'column.insert.relative', 'Failed to compute insert index for display-relative insert', {
        boardId: activeBoardId() || null,
        displayRowIdx: displayRowIdx,
        displayStackIdx: displayStackIdx,
        displayColIdx: displayColIdx,
        insertBefore: !!insertBefore,
        stackId: stack.id || null,
        visibleIndices: visibleIndices
      });
      return false;
    }
    _deps.traceFrontendAction('info', 'column.insert.relative', 'Resolved display-relative insert position', {
      boardId: activeBoardId() || null,
      displayRowIdx: displayRowIdx,
      displayStackIdx: displayStackIdx,
      displayColIdx: displayColIdx,
      insertBefore: !!insertBefore,
      stackId: stack.id || null,
      stackTitle: stack.title || '',
      insertAt: insertAt,
      visibleIndices: visibleIndices
    });
    return _deps.addColumnToStack(displayRowIdx, displayStackIdx, insertAt);
  }

  // ── Reorder / move within active board ────────────────────────────

  function reorderRows(sourceIdx, targetIdx, insertBefore) {
    var fbd = fullBoardData();
    if (!fbd) return;

    var sourceFullIdx = findFullDataRowIndex(sourceIdx);
    var targetFullIdx = findFullDataRowIndex(targetIdx);
    if (sourceFullIdx === -1 || targetFullIdx === -1 || sourceFullIdx === targetFullIdx) return;

    var insertAt = targetFullIdx;
    if (sourceFullIdx < targetFullIdx) insertAt--;
    if (!insertBefore) insertAt++;
    if (insertAt === sourceFullIdx) return;

    var sourceAnchor = captureDndMutationSiblingAnchor(fbd.rows, sourceFullIdx);
    finalizePendingDndMutationUndo();
    var moved = fbd.rows.splice(sourceFullIdx, 1)[0];
    if (!moved) return;
    fbd.rows.splice(insertAt, 0, moved);
    var movedIdx = fbd.rows.indexOf(moved);
    var operation = {
      boardId: activeBoardId(),
      rowId: normalizeDndMutationEntityId(moved.id),
      sourceAnchor: sourceAnchor,
      targetAnchor: captureDndMutationSiblingAnchor(fbd.rows, movedIdx)
    };
    return afterDndMutationPersist(
      _deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] }),
      function () { if (operation.rowId) recordDndMutationRowMoveUndo(operation); }
    );
  }

  function moveStack(fromRowIdx, fromStackIdx, toRowIdx, toStackIdx, insertBefore) {
    var fbd = fullBoardData();
    if (!fbd) return;

    var fromRow = findFullDataRow(fromRowIdx);
    var toRow = findFullDataRow(toRowIdx);
    if (!fromRow || !toRow) return;
    var fromFullStackIdx = findFullDataStackIndex(fromRow, fromRowIdx, fromStackIdx);
    var toFullStackIdx = findFullDataStackIndex(toRow, toRowIdx, toStackIdx);
    if (fromFullStackIdx === -1 || toFullStackIdx === -1) return;
    var insertAt = toFullStackIdx;
    if (fromRow === toRow && fromFullStackIdx < toFullStackIdx) insertAt--;
    if (!insertBefore) insertAt++;
    if (fromRow === toRow && insertAt === fromFullStackIdx) return;

    var sourceRowIndex = fbd.rows.indexOf(fromRow);
    var targetRowIndex = fbd.rows.indexOf(toRow);
    var sourceRowShell = cloneDndMutationContainerShell(fromRow, 'stacks');
    var targetRowShell = cloneDndMutationContainerShell(toRow, 'stacks');
    var sourceRowAnchor = captureDndMutationSiblingAnchor(fbd.rows, sourceRowIndex);
    var targetRowAnchor = captureDndMutationSiblingAnchor(fbd.rows, targetRowIndex);
    var sourceStackAnchor = captureDndMutationSiblingAnchor(fromRow.stacks, fromFullStackIdx);
    finalizePendingDndMutationUndo();
    var moved = fromRow.stacks.splice(fromFullStackIdx, 1)[0];
    if (!moved) return;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > toRow.stacks.length) insertAt = toRow.stacks.length;
    toRow.stacks.splice(insertAt, 0, moved);
    var movedStackIdx = toRow.stacks.indexOf(moved);
    var operation = {
      boardId: activeBoardId(),
      stackId: normalizeDndMutationEntityId(moved.id),
      sourceRowId: normalizeDndMutationEntityId(fromRow.id),
      targetRowId: normalizeDndMutationEntityId(toRow.id),
      sourceRowShell: sourceRowShell,
      targetRowShell: targetRowShell,
      sourceRowAnchor: sourceRowAnchor,
      targetRowAnchor: targetRowAnchor,
      sourceStackAnchor: sourceStackAnchor,
      targetStackAnchor: captureDndMutationSiblingAnchor(toRow.stacks, movedStackIdx)
    };
    removeEmptyStacksAndRows();

    return afterDndMutationPersist(
      _deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] }),
      function () { if (operation.stackId) recordDndMutationStackMoveUndo(operation); }
    );
  }

  // ── Mutation entity ID generation ─────────────────────────────────

  var mutationEntityIdSeed = 0;

  function nextMutationEntityId(prefix) {
    mutationEntityIdSeed = (mutationEntityIdSeed + 1) % 1000000;
    return prefix + '-' + Date.now() + '-' + mutationEntityIdSeed;
  }

  // ── Structural helpers ────────────────────────────────────────────

  function isUnnamedStructuralTitle(title) {
    return _deps.stripInternalHiddenTags(_deps.stripHtmlComments(String(title || ''))).trim() === '';
  }

  function createUnnamedColumnForMutation(cards) {
    return {
      id: nextMutationEntityId('col'),
      title: '',
      cards: Array.isArray(cards) ? cards : []
    };
  }

  function createUnnamedStackForMutation(columns) {
    return {
      id: nextMutationEntityId('stack'),
      title: '',
      columns: Array.isArray(columns) ? columns : []
    };
  }

  function createUnnamedRowForMutation(stacks) {
    return {
      id: nextMutationEntityId('row'),
      title: '',
      stacks: Array.isArray(stacks) ? stacks : []
    };
  }

  // ── Cross-board mutation insertion helpers ─────────────────────────

  function resolveRowInsertIndexForMutation(boardId, boardData, target) {
    if (!boardData || !boardData.rows) return 0;
    if (!target || typeof target.rowIndex !== 'number') return boardData.rows.length;

    var rowInfo = _deps.resolveRowForMutation(
      boardId,
      boardData,
      target.rowIndex,
      target.indexMode || (boardId === activeBoardId() ? 'display' : 'full'),
      target
    );
    if (!rowInfo || !rowInfo.row) return boardData.rows.length;

    var insertAt = target.before ? rowInfo.rowIndex : (rowInfo.rowIndex + 1);
    if (insertAt < 0) insertAt = 0;
    if (insertAt > boardData.rows.length) insertAt = boardData.rows.length;
    return insertAt;
  }

  function insertUnnamedRowForMutation(boardId, boardData, target, stacks) {
    if (!boardData) return null;
    if (!boardData.rows) boardData.rows = [];
    var row = createUnnamedRowForMutation(stacks);
    var insertAt = resolveRowInsertIndexForMutation(boardId, boardData, target);
    boardData.rows.splice(insertAt, 0, row);
    return { row: row, rowIndex: insertAt };
  }

  function insertUnnamedStackIntoRowForMutation(boardId, boardData, target) {
    if (!target || typeof target.rowIndex !== 'number') return null;
    var rowInfo = _deps.resolveRowForMutation(
      boardId,
      boardData,
      target.rowIndex,
      target.indexMode || (boardId === activeBoardId() ? 'display' : 'full'),
      target
    );
    if (!rowInfo || !rowInfo.row) return null;

    if (!rowInfo.row.stacks) rowInfo.row.stacks = [];
    var stack = createUnnamedStackForMutation([]);
    _deps.applyDefaultCanvasPlacementToStack(rowInfo.row, stack);
    var insertAt = rowInfo.row.stacks.length;
    if (typeof target.insertAtStackIdx === 'number') {
      if ((target.indexMode || (boardId === activeBoardId() ? 'display' : 'full')) === 'display' && boardId === activeBoardId()) {
        insertAt = findInsertStackIndexInRow(rowInfo.row, target.rowIndex, target.insertAtStackIdx);
      } else {
        insertAt = target.insertAtStackIdx;
      }
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > rowInfo.row.stacks.length) insertAt = rowInfo.row.stacks.length;
    rowInfo.row.stacks.splice(insertAt, 0, stack);
    return {
      row: rowInfo.row,
      rowIndex: rowInfo.rowIndex,
      stack: stack,
      stackIndex: insertAt
    };
  }

  function resolvePreferredCardColumnRefInStack(stack, preferLast) {
    if (!stack || !Array.isArray(stack.columns)) return null;
    var entries = _deps.getDisplayOrderedColumnEntries(stack.columns || []);
    if (entries.length > 0) {
      var entry = preferLast ? entries[entries.length - 1] : entries[0];
      return {
        column: stack.columns[entry.fullIndex],
        columnIndex: entry.fullIndex,
        stack: stack
      };
    }
    if (stack.columns.length > 0) {
      var idx = preferLast ? (stack.columns.length - 1) : 0;
      return {
        column: stack.columns[idx],
        columnIndex: idx,
        stack: stack
      };
    }
    return null;
  }

  function ensureCardTargetColumnForMutation(boardId, boardData, descriptor) {
    var existing = _deps.resolveColumnRefForCardMutation(boardId, boardData, descriptor);
    if (existing && existing.column) return existing;
    if (!descriptor) return null;

    var indexMode = descriptor.indexMode || (boardId === activeBoardId() ? 'display' : 'full');

    if (typeof descriptor.rowIndex === 'number' && typeof descriptor.stackIndex === 'number') {
      var stackInfo = _deps.resolveStackForMutation(boardId, boardData, descriptor.rowIndex, descriptor.stackIndex, indexMode, descriptor);
      if (!stackInfo || !stackInfo.stack) return null;
      if (!stackInfo.stack.columns) stackInfo.stack.columns = [];
      var preferredColumn = resolvePreferredCardColumnRefInStack(stackInfo.stack, true);
      if (preferredColumn) return preferredColumn;
      var newColumn = createUnnamedColumnForMutation([]);
      stackInfo.stack.columns.push(newColumn);
      return {
        column: newColumn,
        columnIndex: stackInfo.stack.columns.length - 1,
        stack: stackInfo.stack
      };
    }

    if (typeof descriptor.rowIndex === 'number') {
      var rowInfo = _deps.resolveRowForMutation(boardId, boardData, descriptor.rowIndex, indexMode, descriptor);
      if (!rowInfo || !rowInfo.row) return null;
      if (!rowInfo.row.stacks) rowInfo.row.stacks = [];
      for (var i = 0; i < rowInfo.row.stacks.length; i++) {
        var stackTarget = resolvePreferredCardColumnRefInStack(rowInfo.row.stacks[i], false);
        if (stackTarget) return stackTarget;
      }
      var insertedStackInfo = insertUnnamedStackIntoRowForMutation(boardId, boardData, descriptor);
      if (!insertedStackInfo || !insertedStackInfo.stack) return null;
      var insertedColumn = createUnnamedColumnForMutation([]);
      insertedStackInfo.stack.columns.push(insertedColumn);
      return {
        column: insertedColumn,
        columnIndex: insertedStackInfo.stack.columns.length - 1,
        stack: insertedStackInfo.stack
      };
    }

    return null;
  }

  // ── Cleanup helpers ───────────────────────────────────────────────

  function cleanupUnnamedStructuralContainersInBoard(boardData) {
    if (!boardData || !boardData.rows) return;
    for (var r = boardData.rows.length - 1; r >= 0; r--) {
      var row = boardData.rows[r];
      if (!row.stacks) row.stacks = [];
      for (var s = row.stacks.length - 1; s >= 0; s--) {
        var stack = row.stacks[s];
        if (!stack.columns) stack.columns = [];
        for (var c = stack.columns.length - 1; c >= 0; c--) {
          var column = stack.columns[c];
          var cards = column && Array.isArray(column.cards) ? column.cards : [];
          if (cards.length === 0 && isUnnamedStructuralTitle(column && column.title ? column.title : '')) {
            stack.columns.splice(c, 1);
          }
        }
        if (stack.columns.length === 0 && isUnnamedStructuralTitle(stack && stack.title ? stack.title : '')) {
          row.stacks.splice(s, 1);
        }
      }
      if (row.stacks.length === 0 && isUnnamedStructuralTitle(row && row.title ? row.title : '')) {
        boardData.rows.splice(r, 1);
      }
    }
  }

  function removeEmptyStacksAndRowsInBoard(boardData) {
    if (!boardData || !boardData.rows) return;
    cleanupUnnamedStructuralContainersInBoard(boardData);
    for (var r = boardData.rows.length - 1; r >= 0; r--) {
      var row = boardData.rows[r];
      if (!row.stacks) row.stacks = [];
      if (row.stacks.length === 0) {
        boardData.rows.splice(r, 1);
      }
    }
  }

  function removeEmptyStacksAndRows() {
    removeEmptyStacksAndRowsInBoard(fullBoardData());
  }

  // ── Public API ────────────────────────────────────────────────────

  return {
    init: init,
    reorderRows: reorderRows,
    moveStack: moveStack,
    findFullDataRow: findFullDataRow,
    findFullDataStack: findFullDataStack,
    findFullDataRowIndex: findFullDataRowIndex,
    findInsertRowIndex: findInsertRowIndex,
    visibleColumnIndicesInStack: visibleColumnIndicesInStack,
    findFullDataStackIndex: findFullDataStackIndex,
    findFullColumnIndexInStack: findFullColumnIndexInStack,
    findInsertStackIndexInRow: findInsertStackIndexInRow,
    findInsertColumnIndexInStack: findInsertColumnIndexInStack,
    addColumnRelativeToDisplayPosition: addColumnRelativeToDisplayPosition,
    nextMutationEntityId: nextMutationEntityId,
    isUnnamedStructuralTitle: isUnnamedStructuralTitle,
    createUnnamedColumnForMutation: createUnnamedColumnForMutation,
    createUnnamedStackForMutation: createUnnamedStackForMutation,
    createUnnamedRowForMutation: createUnnamedRowForMutation,
    resolveRowInsertIndexForMutation: resolveRowInsertIndexForMutation,
    insertUnnamedRowForMutation: insertUnnamedRowForMutation,
    insertUnnamedStackIntoRowForMutation: insertUnnamedStackIntoRowForMutation,
    resolvePreferredCardColumnRefInStack: resolvePreferredCardColumnRefInStack,
    ensureCardTargetColumnForMutation: ensureCardTargetColumnForMutation,
    cleanupUnnamedStructuralContainersInBoard: cleanupUnnamedStructuralContainersInBoard,
    removeEmptyStacksAndRowsInBoard: removeEmptyStacksAndRowsInBoard,
    removeEmptyStacksAndRows: removeEmptyStacksAndRows
  };
})();
(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : {}).LexeraDndMutations = LexeraDndMutations;
