/**
 * DnD Mutations — display-to-full index resolution and structural mutation
 * helpers for drag-and-drop operations on the kanban board.
 *
 * Dependencies injected via init():
 *   - getFullBoardData()            — returns fullBoardData reference
 *   - getActiveBoardData()          — returns activeBoardData reference
 *   - getActiveBoardId()            — returns activeBoardId string
 *   - pushUndo()                    — snapshot undo before mutation
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

  function init(deps) {
    _deps = deps || {};
  }

  // ── Dependency accessors ──────────────────────────────────────────

  function fullBoardData() { return _deps.getFullBoardData ? _deps.getFullBoardData() : null; }
  function activeBoardData() { return _deps.getActiveBoardData ? _deps.getActiveBoardData() : null; }
  function activeBoardId() { return _deps.getActiveBoardId ? _deps.getActiveBoardId() : null; }

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

    _deps.pushUndo();
    var moved = fbd.rows.splice(sourceFullIdx, 1)[0];
    fbd.rows.splice(insertAt, 0, moved);
    return _deps.persistBoardMutation({ refreshSidebar: true });
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

    _deps.pushUndo();
    var moved = fromRow.stacks.splice(fromFullStackIdx, 1)[0];
    if (insertAt < 0) insertAt = 0;
    if (insertAt > toRow.stacks.length) insertAt = toRow.stacks.length;
    toRow.stacks.splice(insertAt, 0, moved);
    removeEmptyStacksAndRows();

    return _deps.persistBoardMutation({ refreshSidebar: true });
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
      target.indexMode || (boardId === activeBoardId() ? 'display' : 'full')
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
      target.indexMode || (boardId === activeBoardId() ? 'display' : 'full')
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
      var stackInfo = _deps.resolveStackForMutation(boardId, boardData, descriptor.rowIndex, descriptor.stackIndex, indexMode);
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
      var rowInfo = _deps.resolveRowForMutation(boardId, boardData, descriptor.rowIndex, indexMode);
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
