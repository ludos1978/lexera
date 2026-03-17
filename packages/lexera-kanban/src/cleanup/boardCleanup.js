(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraBoardCleanup = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function defaultStripInternalHiddenTags(text) {
    return String(text || '')
      .replace(/\s*#hidden-internal-(?:incoming|parked|archived|deleted)\b/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  function defaultHasInternalHiddenTag(text, tag) {
    return !!(text && tag && String(text).indexOf(tag) !== -1);
  }

  function defaultStripLayoutTags(text) {
    return String(text || '');
  }

  function defaultGetCardTitle(content) {
    return String(content || '')
      .replace(/^\s*-\s*\[[ xX]\]\s*/, '')
      .split('\n')[0]
      .trim();
  }

  function defaultGetArchiveFileContextForBoard() {
    return null;
  }

  function defaultGetBoardDisplayTitle(boardId, boardData) {
    return boardData && boardData.title ? boardData.title : (boardId || 'Untitled');
  }

  function defaultRemoveEmptyStacksAndRowsInBoard() {}

  function resolveDeps(deps) {
    var resolved = deps || {};
    return {
      stripInternalHiddenTags: typeof resolved.stripInternalHiddenTags === 'function'
        ? resolved.stripInternalHiddenTags
        : defaultStripInternalHiddenTags,
      hasInternalHiddenTag: typeof resolved.hasInternalHiddenTag === 'function'
        ? resolved.hasInternalHiddenTag
        : defaultHasInternalHiddenTag,
      stripLayoutTags: typeof resolved.stripLayoutTags === 'function'
        ? resolved.stripLayoutTags
        : defaultStripLayoutTags,
      getCardTitle: typeof resolved.getCardTitle === 'function'
        ? resolved.getCardTitle
        : defaultGetCardTitle,
      getArchiveFileContextForBoard: typeof resolved.getArchiveFileContextForBoard === 'function'
        ? resolved.getArchiveFileContextForBoard
        : defaultGetArchiveFileContextForBoard,
      getBoardDisplayTitle: typeof resolved.getBoardDisplayTitle === 'function'
        ? resolved.getBoardDisplayTitle
        : defaultGetBoardDisplayTitle,
      removeEmptyStacksAndRowsInBoard: typeof resolved.removeEmptyStacksAndRowsInBoard === 'function'
        ? resolved.removeEmptyStacksAndRowsInBoard
        : defaultRemoveEmptyStacksAndRowsInBoard
    };
  }

  function getRowByLocationInBoard(boardData, rowIndex) {
    if (!boardData || !boardData.rows) return null;
    return boardData.rows[rowIndex] || null;
  }

  function getStackByLocationInBoard(boardData, rowIndex, stackIndex) {
    var row = getRowByLocationInBoard(boardData, rowIndex);
    if (!row || !row.stacks) return null;
    return row.stacks[stackIndex] || null;
  }

  function getColumnByLocationInBoard(boardData, rowIndex, stackIndex, colIndex) {
    var stack = getStackByLocationInBoard(boardData, rowIndex, stackIndex);
    if (!stack || !stack.columns) return null;
    return stack.columns[colIndex] || null;
  }

  function getCardByLocationInBoard(boardData, rowIndex, stackIndex, colIndex, cardIndex) {
    var col = getColumnByLocationInBoard(boardData, rowIndex, stackIndex, colIndex);
    if (!col || !col.cards) return null;
    return col.cards[cardIndex] || null;
  }

  function collectHiddenItemsFromBoardData(boardData, tag, deps) {
    if (!boardData || !boardData.rows) return [];
    var cleanupDeps = resolveDeps(deps);
    var items = [];
    for (var r = 0; r < boardData.rows.length; r++) {
      var row = boardData.rows[r];
      var rowTitle = row.title || ('Row ' + (r + 1));
      var cleanRowTitle = cleanupDeps.stripInternalHiddenTags(rowTitle) || ('Row ' + (r + 1));
      if (cleanupDeps.hasInternalHiddenTag(rowTitle, tag)) {
        items.push({
          kind: 'row',
          rowIndex: r,
          rowTitle: cleanRowTitle,
          title: cleanRowTitle
        });
        continue;
      }
      if (!row.stacks) continue;
      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        var stackTitle = stack.title || ('Stack ' + (s + 1));
        var cleanStackTitle = cleanupDeps.stripInternalHiddenTags(stackTitle) || ('Stack ' + (s + 1));
        if (cleanupDeps.hasInternalHiddenTag(stackTitle, tag)) {
          items.push({
            kind: 'stack',
            rowIndex: r,
            stackIndex: s,
            rowTitle: cleanRowTitle,
            stackTitle: cleanStackTitle,
            title: cleanStackTitle
          });
          continue;
        }
        if (!stack.columns) continue;
        for (var c = 0; c < stack.columns.length; c++) {
          var col = stack.columns[c];
          var cleanColTitle = cleanupDeps.stripLayoutTags(cleanupDeps.stripInternalHiddenTags(col.title || '')) || ('Column ' + (c + 1));
          if (cleanupDeps.hasInternalHiddenTag(col.title || '', tag)) {
            items.push({
              kind: 'column',
              rowIndex: r,
              stackIndex: s,
              colIndex: c,
              rowTitle: cleanRowTitle,
              stackTitle: cleanStackTitle,
              colTitle: cleanColTitle,
              title: cleanColTitle
            });
            continue;
          }
          if (!col.cards) continue;
          for (var i = 0; i < col.cards.length; i++) {
            var card = col.cards[i];
            var content = card && card.content ? card.content : '';
            if (!cleanupDeps.hasInternalHiddenTag(content, tag)) continue;
            items.push({
              kind: 'card',
              rowIndex: r,
              stackIndex: s,
              colIndex: c,
              cardIndex: i,
              rowTitle: cleanRowTitle,
              stackTitle: cleanStackTitle,
              colTitle: cleanColTitle,
              title: cleanupDeps.getCardTitle(cleanupDeps.stripInternalHiddenTags(content)) || '(untitled card)'
            });
          }
        }
      }
    }
    return items;
  }

  function normalizeBoardCleanupAction(action) {
    var normalized = String(action || '').trim().toLowerCase();
    if (normalized === 'empty-trash') return 'trash';
    if (normalized === 'move-to-archive') return 'archive';
    if (normalized === 'clean-both') return 'both';
    if (normalized === 'keep' || normalized === 'skip-cleanup') return 'skip';
    return normalized || 'skip';
  }

  function getBoardCleanupState(boardId, boardData, deps) {
    var cleanupDeps = resolveDeps(deps);
    var archivedItems = collectHiddenItemsFromBoardData(boardData, '#hidden-internal-archived', cleanupDeps);
    var deletedItems = collectHiddenItemsFromBoardData(boardData, '#hidden-internal-deleted', cleanupDeps);
    var archiveContext = cleanupDeps.getArchiveFileContextForBoard(boardId);
    return {
      boardId: boardId,
      boardTitle: cleanupDeps.getBoardDisplayTitle(boardId, boardData),
      archivedItems: archivedItems,
      archivedCount: archivedItems.length,
      deletedItems: deletedItems,
      deletedCount: deletedItems.length,
      archiveContext: archiveContext,
      archiveAvailable: !!archiveContext,
      needsCleanup: archivedItems.length > 0 || deletedItems.length > 0
    };
  }

  function isBoardCleanupActionApplicable(cleanupState, action) {
    var normalized = normalizeBoardCleanupAction(action);
    if (!cleanupState || !cleanupState.needsCleanup) return normalized === 'skip';
    if (normalized === 'skip') return true;
    if (normalized === 'trash') return cleanupState.deletedCount > 0;
    if (normalized === 'archive') return cleanupState.archivedCount > 0 && cleanupState.archiveAvailable;
    if (normalized === 'both') {
      return cleanupState.deletedCount > 0 && cleanupState.archivedCount > 0 && cleanupState.archiveAvailable;
    }
    return false;
  }

  function removeHiddenItemFromBoardData(boardData, item, deps) {
    if (!item || !boardData || !boardData.rows) return false;
    var cleanupDeps = resolveDeps(deps);
    if (item.kind === 'row') {
      if (item.rowIndex < 0 || item.rowIndex >= boardData.rows.length) return false;
      boardData.rows.splice(item.rowIndex, 1);
      return true;
    }
    if (item.kind === 'stack') {
      var row = getRowByLocationInBoard(boardData, item.rowIndex);
      if (!row || !row.stacks || item.stackIndex < 0 || item.stackIndex >= row.stacks.length) return false;
      row.stacks.splice(item.stackIndex, 1);
      cleanupDeps.removeEmptyStacksAndRowsInBoard(boardData);
      return true;
    }
    if (item.kind === 'column') {
      var stack = getStackByLocationInBoard(boardData, item.rowIndex, item.stackIndex);
      if (!stack || !stack.columns || item.colIndex < 0 || item.colIndex >= stack.columns.length) return false;
      stack.columns.splice(item.colIndex, 1);
      cleanupDeps.removeEmptyStacksAndRowsInBoard(boardData);
      return true;
    }
    var col = getColumnByLocationInBoard(boardData, item.rowIndex, item.stackIndex, item.colIndex);
    if (!col || !col.cards || item.cardIndex < 0 || item.cardIndex >= col.cards.length) return false;
    col.cards.splice(item.cardIndex, 1);
    return true;
  }

  function sortHiddenItemsForRemoval(items) {
    return items.slice().sort(function (a, b) {
      if (a.rowIndex !== b.rowIndex) return b.rowIndex - a.rowIndex;
      if (a.stackIndex !== b.stackIndex) return b.stackIndex - a.stackIndex;
      if (a.colIndex !== b.colIndex) return b.colIndex - a.colIndex;
      if (a.kind !== b.kind) return a.kind === 'card' ? 1 : -1;
      var aCardIndex = typeof a.cardIndex === 'number' ? a.cardIndex : -1;
      var bCardIndex = typeof b.cardIndex === 'number' ? b.cardIndex : -1;
      return bCardIndex - aCardIndex;
    });
  }

  function removeHiddenItemsFromBoardData(boardData, items, deps) {
    if (!items || items.length === 0 || !boardData || !boardData.rows) return false;
    var cleanupDeps = resolveDeps(deps);
    var sorted = sortHiddenItemsForRemoval(items);
    for (var i = 0; i < sorted.length; i++) {
      var item = sorted[i];
      if (item.kind === 'row') {
        if (item.rowIndex >= 0 && item.rowIndex < boardData.rows.length) {
          boardData.rows.splice(item.rowIndex, 1);
        }
      } else if (item.kind === 'stack') {
        var row = getRowByLocationInBoard(boardData, item.rowIndex);
        if (row && row.stacks && item.stackIndex >= 0 && item.stackIndex < row.stacks.length) {
          row.stacks.splice(item.stackIndex, 1);
        }
      } else if (item.kind === 'column') {
        var stack = getStackByLocationInBoard(boardData, item.rowIndex, item.stackIndex);
        if (stack && stack.columns && item.colIndex >= 0 && item.colIndex < stack.columns.length) {
          stack.columns.splice(item.colIndex, 1);
        }
      } else {
        var col = getColumnByLocationInBoard(boardData, item.rowIndex, item.stackIndex, item.colIndex);
        if (col && col.cards && item.cardIndex >= 0 && item.cardIndex < col.cards.length) {
          col.cards.splice(item.cardIndex, 1);
        }
      }
    }
    cleanupDeps.removeEmptyStacksAndRowsInBoard(boardData);
    return true;
  }

  return {
    getRowByLocationInBoard: getRowByLocationInBoard,
    getStackByLocationInBoard: getStackByLocationInBoard,
    getColumnByLocationInBoard: getColumnByLocationInBoard,
    getCardByLocationInBoard: getCardByLocationInBoard,
    collectHiddenItemsFromBoardData: collectHiddenItemsFromBoardData,
    normalizeBoardCleanupAction: normalizeBoardCleanupAction,
    getBoardCleanupState: getBoardCleanupState,
    isBoardCleanupActionApplicable: isBoardCleanupActionApplicable,
    removeHiddenItemFromBoardData: removeHiddenItemFromBoardData,
    sortHiddenItemsForRemoval: sortHiddenItemsForRemoval,
    removeHiddenItemsFromBoardData: removeHiddenItemsFromBoardData
  };
}));
