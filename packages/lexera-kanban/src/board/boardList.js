/**
 * LexeraBoardList — Board List extracted from LexeraDashboard.
 *
 * Provides: sidebar tree state, board hierarchy cache, board draft storage,
 * board identity helpers, live-sync snapshot, rebase, workspace select,
 * mirrored workspace views, board list rendering.
 *
 * IIFE module — no const/let, no ES imports.
 */
var LexeraBoardList = (function () {
  'use strict';

  // --- Dependencies (injected via init) ---
  var _deps = {};
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
  var _Settings = typeof LexeraSettings !== 'undefined' ? LexeraSettings : null;

  // Read deps — runtime state takes priority over injected deps for shared state
  function _dep(name) {
    if (_rt && _rt.getState(name) !== undefined) return _rt.getState(name);
    return _deps[name];
  }

  function _callDep(name) {
    var fn = _deps[name];
    if (typeof fn === 'function') return fn.apply(null, Array.prototype.slice.call(arguments, 1));
    return undefined;
  }

  // ─── Sidebar expanded boards ──────────────────────────────────────

  function getSidebarExpandedBoards() {
    if (_Settings) return _Settings.get('sidebarExpanded') || [];
    try { return JSON.parse(localStorage.getItem('lexera-sidebar-expanded') || '[]'); } catch (e) {
      logFrontendIssue('warn', 'sidebar.state', 'Failed to read expanded sidebar boards', e);
      return [];
    }
  }
  function saveSidebarExpandedBoards(ids) {
    if (_Settings) { _Settings.set('sidebarExpanded', ids); return; }
    localStorage.setItem('lexera-sidebar-expanded', JSON.stringify(ids));
  }

  // ─── Sidebar tree state ───────────────────────────────────────────

  function getSidebarTreeState(boardId) {
    try {
      var all = _Settings ? (_Settings.get('sidebarTreeState') || {}) : JSON.parse(localStorage.getItem('lexera-sidebar-tree-state') || '{}');
      return all[boardId] || { rows: [], stacks: [], columns: [] };
    } catch (e) {
      logFrontendIssue('warn', 'sidebar.tree', 'Failed to read sidebar tree state for board ' + boardId, e);
      return { rows: [], stacks: [], columns: [] };
    }
  }

  function hasSidebarTreeState(boardId) {
    try {
      var all = _Settings ? (_Settings.get('sidebarTreeState') || {}) : JSON.parse(localStorage.getItem('lexera-sidebar-tree-state') || '{}');
      return Object.prototype.hasOwnProperty.call(all, boardId);
    } catch (e) {
      logFrontendIssue('warn', 'sidebar.tree', 'Failed to check sidebar tree state for board ' + boardId, e);
      return false;
    }
  }

  function saveSidebarTreeState(boardId, state) {
    try {
      var all = _Settings ? (_Settings.get('sidebarTreeState') || {}) : JSON.parse(localStorage.getItem('lexera-sidebar-tree-state') || '{}');
      all[boardId] = state;
      if (_Settings) { _Settings.set('sidebarTreeState', all); }
      else { localStorage.setItem('lexera-sidebar-tree-state', JSON.stringify(all)); }
    } catch (e) {
      logFrontendIssue('warn', 'sidebar.tree', 'Failed to persist sidebar tree state for board ' + boardId, e);
    }
  }

  function getSidebarTreeChildrenContainer(node) {
    var tv = _dep('TreeView');
    if (tv && typeof tv.getNodeChildrenContainer === 'function') {
      return tv.getNodeChildrenContainer(node);
    }
    if (!node) return null;
    var next = node.nextElementSibling;
    return next && next.classList && next.classList.contains('tree-children') ? next : null;
  }

  function getSidebarTreeOwnerNode(container) {
    var tv = _dep('TreeView');
    if (tv && typeof tv.getChildrenOwnerNode === 'function') {
      return tv.getChildrenOwnerNode(container);
    }
    if (!container) return null;
    var prev = container.previousElementSibling;
    return prev && prev.classList && prev.classList.contains('tree-node') ? prev : null;
  }

  function toggleSidebarTreeNode(boardId, kind, id) {
    var state = getSidebarTreeState(boardId);
    var arr = state[kind] || [];
    var idx = arr.indexOf(id);
    if (idx !== -1) { arr.splice(idx, 1); } else { arr.push(id); }
    state[kind] = arr;
    saveSidebarTreeState(boardId, state);
  }

  // Alt+click helper: expand or collapse all descendant tree nodes inside a container.
  // `expand` = true means set children to expanded state; false = collapsed.
  function setDescendantTreeState(container, expand, boardId) {
    var tv = _dep('TreeView');
    if (tv && typeof tv.setDescendantsExpanded === 'function') {
      tv.setDescendantsExpanded(container, expand);
    }
    // Persist: collect all descendant tree-node IDs and batch-update state
    var state = getSidebarTreeState(boardId);
    var nodes = container.querySelectorAll('.tree-node[data-tree-id]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var treeId = n.getAttribute('data-tree-id');
      if (!treeId) continue;
      var kind = n.classList.contains('tree-row') ? 'rows'
        : n.classList.contains('tree-stack') ? 'stacks'
        : n.classList.contains('tree-column') ? 'columns' : null;
      if (!kind) continue;
      var arr = state[kind] || [];
      var idx = arr.indexOf(treeId);
      // rows/stacks: in array = collapsed; columns: in array = expanded
      if (kind === 'columns') {
        if (expand && idx === -1) arr.push(treeId);
        else if (!expand && idx !== -1) arr.splice(idx, 1);
      } else {
        if (expand && idx !== -1) arr.splice(idx, 1);
        else if (!expand && idx === -1) arr.push(treeId);
      }
      state[kind] = arr;
    }
    saveSidebarTreeState(boardId, state);
  }

  // Convert kanban rows/stacks/columns/cards into generic TreeView node arrays.
  // Keep the full row -> stack -> column -> card structure even for single-row or
  // single-stack boards. Collapsing those levels into breadcrumbs saves a few pixels
  // but harms scanability and makes the sidebar tree less trustworthy as a hierarchy.
  function buildSidebarTreeNodes(rows, boardId, treeState, hasTreeState) {
    return _callDep('getSidebarTreeApi').buildSidebarTreeNodes(rows, boardId, treeState, hasTreeState, {
      stripLayoutTags: function (t) { return _callDep('stripLayoutTags', t); },
      getDisplayOrderedColumnEntries: function (cols, opts) { return _callDep('getDisplayOrderedColumnEntries', cols, opts); }
    });
  }

  function countCardsInRow(row) {
    return _callDep('getSidebarTreeApi').countCardsInRow(row);
  }

  function countCardsInStack(stack) {
    return _callDep('getSidebarTreeApi').countCardsInStack(stack);
  }

  function countCardsInRows(rows) {
    var total = 0;
    for (var i = 0; i < rows.length; i++) {
      total += countCardsInRow(rows[i]);
    }
    return total;
  }

  // ─── Clone helpers ────────────────────────────────────────────────

  function cloneRows(rows) {
    return structuredClone(rows || []);
  }

  function cloneBoardData(boardData) {
    if (!boardData) return null;
    return structuredClone(boardData);
  }

  // ─── Board draft storage ──────────────────────────────────────────

  function boardDraftStorageKey(boardId) {
    return boardId ? ('lexera-board-draft:' + boardId) : '';
  }

  // ─── Board identity helpers ───────────────────────────────────────

  function getBoardCardKids(boardData) {
    var kids = [];
    var cols = _callDep('getAllColumnsFromBoardData', boardData);
    for (var i = 0; i < cols.length; i++) {
      var cards = cols[i] && cols[i].cards ? cols[i].cards : [];
      for (var j = 0; j < cards.length; j++) {
        if (cards[j] && cards[j].kid) kids.push(cards[j].kid);
      }
    }
    return kids;
  }

  function getBoardCardIdentityStats(boardA, boardB) {
    var aKids = getBoardCardKids(boardA);
    var bKids = getBoardCardKids(boardB);
    var seen = Object.create(null);
    var overlap = 0;
    for (var i = 0; i < aKids.length; i++) seen[aKids[i]] = true;
    for (var j = 0; j < bKids.length; j++) {
      if (seen[bKids[j]]) overlap++;
    }
    return {
      boardACards: aKids.length,
      boardBCards: bKids.length,
      overlap: overlap
    };
  }

  function summarizeBoardIdentity(boardData, limit) {
    var kids = getBoardCardKids(boardData);
    var max = typeof limit === 'number' ? limit : 6;
    return {
      summary: summarizeBoardHierarchy(boardData),
      cards: kids.length,
      sampleKids: kids.slice(0, max)
    };
  }

  function describeBoardIdentityPair(labelA, boardA, labelB, boardB, limit) {
    var max = typeof limit === 'number' ? limit : 6;
    var aKids = getBoardCardKids(boardA);
    var bKids = getBoardCardKids(boardB);
    var seenA = Object.create(null);
    var seenB = Object.create(null);
    var overlap = 0;
    var onlyA = [];
    var onlyB = [];
    var i;
    for (i = 0; i < aKids.length; i++) seenA[aKids[i]] = true;
    for (i = 0; i < bKids.length; i++) seenB[bKids[i]] = true;
    for (i = 0; i < aKids.length; i++) {
      if (seenB[aKids[i]]) overlap++;
      else if (onlyA.length < max) onlyA.push(aKids[i]);
    }
    for (i = 0; i < bKids.length; i++) {
      if (!seenA[bKids[i]] && onlyB.length < max) onlyB.push(bKids[i]);
    }
    return {
      labels: [labelA, labelB],
      stats: {
        boardACards: aKids.length,
        boardBCards: bKids.length,
        overlap: overlap
      },
      onlyA: onlyA,
      onlyB: onlyB,
      summaryA: summarizeBoardHierarchy(boardA),
      summaryB: summarizeBoardHierarchy(boardB)
    };
  }

  function traceBoardIdentityPair(level, target, message, boardId, labelA, boardA, labelB, boardB, extra) {
    var details = {
      boardId: boardId || null,
      pair: describeBoardIdentityPair(labelA, boardA, labelB, boardB)
    };
    if (extra && typeof extra === 'object') {
      for (var key in extra) details[key] = extra[key];
    }
    traceFrontendAction(level, target, message, details);
  }

  function hasBoardIdentityMismatch(boardA, boardB) {
    if (!boardA || !boardB) return false;
    var stats = getBoardCardIdentityStats(boardA, boardB);
    return stats.boardACards > 0 && stats.boardBCards > 0 && stats.overlap === 0;
  }

  // ─── Local board draft ────────────────────────────────────────────

  var _draftSaveTimer = null;
  function saveLocalBoardDraft(boardId, boardData) {
    if (!boardId || !boardData) return;
    if (_callDep('isRemoteBoardId', boardId)) return;
    // Debounce: draft save does 2 deep clones + JSON.stringify of the entire board.
    // On large boards this is expensive. Delay 500ms to coalesce rapid mutations.
    if (_draftSaveTimer) clearTimeout(_draftSaveTimer);
    _draftSaveTimer = setTimeout(function () {
      _draftSaveTimer = null;
      try {
        var bd = _dep('fullBoardData') || boardData;
        var baseBoard = getBoardSaveBase(bd) || bd;
        var draftPayload = {
          savedAt: Date.now(),
          revision: _dep('_lastLoadedRevision') || (function () {
            var abd = _dep('activeBoardData');
            return abd && abd.revision ? abd.revision : null;
          })(),
          board: cloneBoardData(bd),
          baseBoard: cloneBoardData(baseBoard)
        };
        if (_Settings) { _Settings.setForBoard('boardDraft', boardId, draftPayload); }
        else { localStorage.setItem(boardDraftStorageKey(boardId), JSON.stringify(draftPayload)); }
      } catch (err) {
        logFrontendIssue('warn', 'board.draft.save', 'Failed to persist local board draft', err);
      }
    }, 500);
  }

  function loadLocalBoardDraft(boardId) {
    if (!boardId) return null;
    try {
      if (_Settings) {
        var parsed = _Settings.getForBoard('boardDraft', boardId);
        return parsed && parsed.board ? parsed : null;
      }
      var raw = localStorage.getItem(boardDraftStorageKey(boardId));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.board ? parsed : null;
    } catch (err) {
      logFrontendIssue('warn', 'board.draft.load', 'Failed to load local board draft', err);
      return null;
    }
  }

  function clearLocalBoardDraft(boardId) {
    if (!boardId) return;
    try {
      if (_Settings) { _Settings.removeForBoard('boardDraft', boardId); return; }
      localStorage.removeItem(boardDraftStorageKey(boardId));
    } catch (err) {
      logFrontendIssue('warn', 'board.draft.clear', 'Failed to clear local board draft', err);
    }
  }

  /**
   * Remove draft entries for boards that no longer exist in the board list.
   * Called during board list refresh to prevent unbounded localStorage growth.
   */
  function pruneOrphanedDrafts(boardIds) {
    if (!boardIds || !Array.isArray(boardIds)) return;
    var idSet = {};
    for (var i = 0; i < boardIds.length; i++) idSet[boardIds[i]] = true;
    var PREFIX = 'lexera-board-draft:';
    try {
      var keysToRemove = [];
      for (var k = 0; k < localStorage.length; k++) {
        var key = localStorage.key(k);
        if (key && key.indexOf(PREFIX) === 0) {
          var draftBoardId = key.slice(PREFIX.length);
          if (!idSet[draftBoardId]) keysToRemove.push(key);
        }
      }
      for (var j = 0; j < keysToRemove.length; j++) {
        var pruneBoardId = keysToRemove[j].slice(PREFIX.length);
        if (_Settings) { _Settings.removeForBoard('boardDraft', pruneBoardId); }
        else { localStorage.removeItem(keysToRemove[j]); }
        logFrontendIssue('info', 'board.draft.prune', 'Removed orphaned draft for board ' + pruneBoardId);
      }
    } catch (err) {
      logFrontendIssue('warn', 'board.draft.prune', 'Failed to prune orphaned drafts', err);
    }
  }

  function boardCardSummary(bd) {
    if (!bd) return '(null)';
    var cols = (bd.rows && bd.rows.length > 0)
      ? bd.rows.flatMap(function(r) { return (r.stacks || []).flatMap(function(s) { return s.columns || []; }); })
      : (bd.columns || []);
    return cols.map(function(c) {
      var kids = (c.cards || []).map(function(card) { return card.kid || '??'; });
      return '[' + c.title + ':' + kids.join(',') + ']';
    }).join(' ');
  }

  // ─── Board save base ──────────────────────────────────────────────

  function setBoardSaveBase(boardData, baseBoardData) {
    if (!boardData || typeof boardData !== 'object') return boardData;
    Object.defineProperty(boardData, '__lexeraSaveBase', {
      value: cloneBoardData(baseBoardData || boardData),
      writable: true,
      configurable: true,
      enumerable: false
    });
    return boardData;
  }

  function getBoardSaveBase(boardData) {
    return boardData && boardData.__lexeraSaveBase ? boardData.__lexeraSaveBase : null;
  }

  function resolveSavedBoardData(boardData, result, boardId) {
    var savedBoard = result && result.board ? result.board : boardData;
    _callDep('ensureBoardRowsForMutation', savedBoard, _callDep('getMutationBoardTitle', boardId, savedBoard));
    if (!savedBoard.columns) savedBoard.columns = [];
    return setBoardSaveBase(savedBoard, savedBoard);
  }

  function resolveLiveSyncBoardData(boardData, boardId) {
    if (!boardData) return null;
    _callDep('ensureBoardRowsForMutation', boardData, _callDep('getMutationBoardTitle', boardId, boardData));
    if (!boardData.columns) boardData.columns = [];
    return setBoardSaveBase(boardData, boardData);
  }

  // ─── Live sync incremental update helpers ─────────────────────────

  /**
   * Check whether a board delta contains only card-content modifications
   * (no structural changes like column/row/stack adds, removes, or reorders).
   * Returns true when it is safe to skip renderColumns() and use
   * updateCardElementInPlace() for each changed card instead.
   */
  function isDeltaCardContentOnly(delta) {
    if (!delta) return true;
    // Any top-level scalar or settings change requires full render
    var scalarKeys = ['valid', 'title', 'yamlHeader', 'kanbanFooter'];
    for (var k = 0; k < scalarKeys.length; k++) {
      if (delta[scalarKeys[k]]) return false;
    }
    if (delta.boardSettings) return false;
    // Flat columns format (legacy)
    if (delta.columns) {
      if (!isIdArrayDeltaCardContentOnly(delta.columns)) return false;
    }
    // Hierarchical rows format
    if (delta.rows) {
      if (!isIdArrayDeltaModifiedOnly(delta.rows, isRowDeltaCardContentOnly)) return false;
    }
    return true;
  }

  /** Check that an id-array delta has no adds, removes, or reorders — only modifications. */
  function isIdArrayDeltaModifiedOnly(idArrayDelta, itemCheckFn) {
    if (!idArrayDelta) return true;
    if (idArrayDelta.added || idArrayDelta.removed) return false;
    if (idArrayDelta.oldOrder || idArrayDelta.newOrder) return false;
    if (idArrayDelta.modified) {
      for (var id in idArrayDelta.modified) {
        if (!itemCheckFn(idArrayDelta.modified[id])) return false;
      }
    }
    return true;
  }

  function isRowDeltaCardContentOnly(rowDelta) {
    if (!rowDelta) return true;
    if (rowDelta.title) return false;
    if (rowDelta.stacks) {
      if (!isIdArrayDeltaModifiedOnly(rowDelta.stacks, isStackDeltaCardContentOnly)) return false;
    }
    return true;
  }

  function isStackDeltaCardContentOnly(stackDelta) {
    if (!stackDelta) return true;
    if (stackDelta.title) return false;
    if (stackDelta.columns) {
      if (!isIdArrayDeltaCardContentOnly(stackDelta.columns)) return false;
    }
    return true;
  }

  function isIdArrayDeltaCardContentOnly(colsDelta) {
    if (!colsDelta) return true;
    if (colsDelta.added || colsDelta.removed) return false;
    if (colsDelta.oldOrder || colsDelta.newOrder) return false;
    if (colsDelta.modified) {
      for (var id in colsDelta.modified) {
        var colDelta = colsDelta.modified[id];
        if (colDelta.title || colDelta.include_source) return false;
        if (colDelta.cards) {
          if (colDelta.cards.added || colDelta.cards.removed) return false;
          if (colDelta.cards.oldOrder || colDelta.cards.newOrder) return false;
          // cards.modified is fine — those are content-only changes
        }
      }
    }
    return true;
  }

  /**
   * Collect all modified card IDs from a card-content-only delta,
   * grouped by their column ID.
   * Returns an array of { columnId, cardIds: [cardId, ...] }.
   */
  function collectModifiedCardIdsFromDelta(delta, boardData) {
    var result = [];
    // Hierarchical format (rows > stacks > columns > cards)
    if (delta.rows && delta.rows.modified) {
      var rows = boardData.rows || [];
      for (var rowId in delta.rows.modified) {
        var rowDelta = delta.rows.modified[rowId];
        if (!rowDelta.stacks || !rowDelta.stacks.modified) continue;
        for (var stackId in rowDelta.stacks.modified) {
          var stackDelta = rowDelta.stacks.modified[stackId];
          if (!stackDelta.columns || !stackDelta.columns.modified) continue;
          for (var colId in stackDelta.columns.modified) {
            var colDelta = stackDelta.columns.modified[colId];
            if (!colDelta.cards || !colDelta.cards.modified) continue;
            var cardIds = [];
            for (var cardId in colDelta.cards.modified) {
              cardIds.push(cardId);
            }
            if (cardIds.length > 0) result.push({ columnId: colId, cardIds: cardIds });
          }
        }
      }
    }
    // Flat columns format (legacy)
    if (delta.columns && delta.columns.modified) {
      for (var fColId in delta.columns.modified) {
        var fColDelta = delta.columns.modified[fColId];
        if (!fColDelta.cards || !fColDelta.cards.modified) continue;
        var fCardIds = [];
        for (var fCardId in fColDelta.cards.modified) {
          fCardIds.push(fCardId);
        }
        if (fCardIds.length > 0) result.push({ columnId: fColId, cardIds: fCardIds });
      }
    }
    return result;
  }

  /**
   * Try to apply a card-content-only delta incrementally by updating
   * individual card DOM elements instead of re-rendering the full board.
   * Returns true if successful, false if a full render is needed.
   */
  function tryIncrementalCardUpdate(delta, boardData) {
    var modifiedGroups = collectModifiedCardIdsFromDelta(delta, boardData);
    if (modifiedGroups.length === 0) return true;
    // Build a map from column ID to flat column index
    var allCols = _callDep('getAllColumnsFromBoardData', boardData);
    var colIdToIndex = {};
    for (var ci = 0; ci < allCols.length; ci++) {
      colIdToIndex[allCols[ci].id] = ci;
    }
    for (var g = 0; g < modifiedGroups.length; g++) {
      var group = modifiedGroups[g];
      var colIndex = colIdToIndex[group.columnId];
      if (colIndex === undefined) return false;
      for (var c = 0; c < group.cardIds.length; c++) {
        var visIdx = _callDep('findVisibleCardIndexById', colIndex, group.cardIds[c]);
        if (visIdx === -1) continue; // card is archived/deleted, skip
        _callDep('updateCardElementInPlace', colIndex, visIdx);
      }
      _callDep('updateColumnCountBadge', colIndex);
    }
    return true;
  }

  // ─── Live sync snapshot ───────────────────────────────────────────

  function applyLiveSyncBoardSnapshot(boardId, boardData, options) {
    options = options || {};
    var activeBoardId = _dep('activeBoardId');
    var fullBoardData = _dep('fullBoardData');
    var liveSyncState = _dep('liveSyncState');
    if (!boardData || boardId !== activeBoardId) return;
    var replaceLocalBoard = !!options.replaceLocalBoard || (!_callDep('isBoardDirty') && !_dep('_saveInFlight'));
    traceFrontendAction('info', 'liveSync.snapshot', replaceLocalBoard
      ? 'Adopting live sync snapshot into active board'
      : 'Updating save base from live sync response while preserving dirty local board', {
      boardId: boardId,
      replaceLocalBoard: replaceLocalBoard,
      incomingSummary: summarizeBoardHierarchy(boardData),
      currentSummary: summarizeBoardHierarchy(fullBoardData)
    });
    var canonicalBoard = resolveLiveSyncBoardData(cloneBoardData(boardData), boardId);
    if (liveSyncState && liveSyncState.boardId === boardId) {
      liveSyncState.board = canonicalBoard;
    }
    if (fullBoardData) {
      traceBoardIdentityPair(replaceLocalBoard ? 'info' : 'warn', 'liveSync.snapshot', 'Identity comparison before applying live sync snapshot', boardId, 'local', fullBoardData, 'incoming', canonicalBoard, {
        replaceLocalBoard: replaceLocalBoard
      });
    }
    // Capture old board for incremental delta computation
    var oldBoardForDelta = (replaceLocalBoard && fullBoardData) ? cloneBoardData(fullBoardData) : null;
    if (replaceLocalBoard) {
      fullBoardData = cloneBoardData(canonicalBoard);
      _callDep('ensureBoardRowsForMutation', fullBoardData, _callDep('getMutationBoardTitle', boardId, fullBoardData));
      if (!fullBoardData.columns) fullBoardData.columns = [];
      setBoardSaveBase(fullBoardData, canonicalBoard);
      _callDep('setFullBoardData', fullBoardData);
      _callDep('clearBoardDirty');
    } else if (fullBoardData) {
      setBoardSaveBase(fullBoardData, canonicalBoard);
    }
    // Re-read in case setFullBoardData changed the reference
    fullBoardData = _dep('fullBoardData');
    if (fullBoardData) {
      traceBoardIdentityPair('info', 'liveSync.snapshot', 'Identity comparison after applying live sync snapshot', boardId, 'local', fullBoardData, 'saveBase', getBoardSaveBase(fullBoardData));
      if (liveSyncState && liveSyncState.boardId === boardId) {
        traceBoardIdentityPair('info', 'liveSync.snapshot', 'Identity comparison after syncing live sync snapshot into session', boardId, 'local', fullBoardData, 'session', liveSyncState.board);
      }
    }
    var activeBoardDataRef = _dep('activeBoardData');
    if (activeBoardDataRef) {
      delete activeBoardDataRef.version;
      delete activeBoardDataRef.revision;
    }
    _callDep('updateDisplayFromFullBoard');
    setBoardHierarchyRows(boardId, fullBoardData, fullBoardData ? (fullBoardData.title || '') : '');
    if (options.skipRender) return;
    _callDep('applyBoardSettings');

    // Try incremental card update when only card content changed
    var didIncrementalUpdate = false;
    if (!options.refreshMainView && oldBoardForDelta && fullBoardData) {
      var BoardDelta = (typeof globalThis !== 'undefined' && globalThis.LexeraBoardDelta) ? globalThis.LexeraBoardDelta : null;
      if (BoardDelta) {
        var liveSyncDelta = BoardDelta.computeBoardDelta(oldBoardForDelta, fullBoardData);
        if (isDeltaCardContentOnly(liveSyncDelta)) {
          didIncrementalUpdate = tryIncrementalCardUpdate(liveSyncDelta, fullBoardData);
        }
      }
    }
    if (!didIncrementalUpdate) {
      _callDep('refreshTargetedElements', [{ type: 'board' }]);
    }
    renderBoardList();
    _callDep('refreshHeaderFileControls');
    _callDep('scheduleDashboardRefresh', 80);
  }

  var _rebaseInFlight = null;

  function applyRebasedBoardSnapshot(boardId, workingBoard, currentBoard, result, options) {
    options = options || {};
    var activeBoardId = _dep('activeBoardId');
    if (!workingBoard || boardId !== activeBoardId) return;
    _callDep('setFullBoardData', workingBoard);
    var fullBoardData = _dep('fullBoardData');
    _callDep('ensureBoardRowsForMutation', fullBoardData, _callDep('getMutationBoardTitle', boardId, fullBoardData));
    if (!fullBoardData.columns) fullBoardData.columns = [];
    setBoardSaveBase(fullBoardData, currentBoard || workingBoard);
    _callDep('setPendingExternalRebaseConflict', null);
    var activeBoardDataRef = _dep('activeBoardData');
    if (activeBoardDataRef) {
      if (result && typeof result.version === 'number') activeBoardDataRef.version = result.version;
      if (result && result.revision) activeBoardDataRef.revision = result.revision;
    }
    if (result && typeof result.generation === 'number') {
      _callDep('setLastLoadedGeneration', result.generation);
    }
    _callDep('setLastLoadedRevision', result && result.revision ? result.revision : _dep('_lastLoadedRevision'));
    _callDep('updateDisplayFromFullBoard');
    setBoardHierarchyRows(boardId, fullBoardData, _callDep('getMutationBoardTitle', boardId, fullBoardData));
    _callDep('applyBoardSettings');
    _callDep('refreshTargetedElements', [{ type: 'board' }]);
    renderBoardList();
    _callDep('refreshHeaderFileControls');
    _callDep('scheduleDashboardRefresh', 80);
    _callDep('markBoardDirty');
    saveLocalBoardDraft(boardId, fullBoardData);
    if (!options.silent) {
      if (result && result.merged && result.autoMerged > 0) {
        _callDep('showNotification', 'Integrated external changes into your draft (' + result.autoMerged + ' auto-merge(s)).');
      } else {
        _callDep('showNotification', 'Integrated external changes into your draft.');
      }
    }
  }

  async function rebaseDirtyBoardFromServer(triggerKind) {
    var activeBoardId = _dep('activeBoardId');
    var fullBoardData = _dep('fullBoardData');
    if (!activeBoardId || !fullBoardData) return false;
    if (_rebaseInFlight) return _rebaseInFlight;
    var baseBoardData = getBoardSaveBase(fullBoardData);
    if (!baseBoardData) {
      setBoardSaveBase(fullBoardData, fullBoardData);
      baseBoardData = getBoardSaveBase(fullBoardData);
    }
    _rebaseInFlight = (async function () {
      try {
        traceFrontendAction('info', 'board.rebase', 'Rebasing dirty board against latest external state', {
          boardId: activeBoardId,
          trigger: triggerKind || null,
          baseSummary: summarizeBoardHierarchy(baseBoardData),
          workingSummary: summarizeBoardHierarchy(fullBoardData)
        });
        traceBoardIdentityPair('info', 'board.rebase', 'Identity comparison before rebase request', activeBoardId, 'working', fullBoardData, 'base', baseBoardData, {
          trigger: triggerKind || null
        });
        var LexeraApi = _dep('LexeraApi');
        var result = await LexeraApi.rebaseBoardWithBase(activeBoardId, baseBoardData, fullBoardData);
        var currentBoard = result && result.currentBoard ? result.currentBoard : null;
        if (!result || !currentBoard) return false;
        traceBoardIdentityPair('info', 'board.rebase', 'Identity comparison between rebase current board and working board', activeBoardId, 'working', fullBoardData, 'current', currentBoard, {
          trigger: triggerKind || null,
          hasConflicts: !!(result && result.hasConflicts)
        });
        if (result.hasConflicts) {
          _callDep('setPendingExternalRebaseConflict', {
            result: result,
            savedAt: Date.now()
          });
          traceFrontendAction('warn', 'board.rebase.conflict', 'External changes conflict with local draft; preserving local draft', {
            boardId: activeBoardId,
            trigger: triggerKind || null,
            conflicts: result.conflicts || 0,
            autoMerged: result.autoMerged || 0
          });
          _callDep('showExternalRebaseConflictDialog', result);
          return false;
        }
        applyRebasedBoardSnapshot(activeBoardId, result.board || fullBoardData, currentBoard, result);
        return true;
      } catch (err) {
        logFrontendIssue('error', 'board.rebase', 'Failed to rebase dirty board against latest external state', err);
        return false;
      } finally {
        _rebaseInFlight = null;
      }
    })();
    return _rebaseInFlight;
  }

  // ─── Row helpers ──────────────────────────────────────────────────

  function rowsFromLegacyColumns(columns, boardTitle) {
    var cols = (columns || []).map(function (col) {
      return {
        index: col.index,
        title: col.title,
        cards: (col.cards || []).map(function (card) {
          return {
            id: card.id,
            content: card.content,
            checked: !!card.checked,
            kid: card.kid || null,
          };
        }),
      };
    });
    if (cols.length === 0) return [];

    var groups = [];
    for (var i = 0; i < cols.length; i++) {
      var hasStackTag = _callDep('hasTag', cols[i].title, '#stack');
      if (hasStackTag && groups.length > 0) groups[groups.length - 1].push(cols[i]);
      else groups.push([cols[i]]);
    }

    var stacks = [];
    for (var g = 0; g < groups.length; g++) {
      for (var c = 0; c < groups[g].length; c++) {
        groups[g][c].title = _callDep('stripStackTag', groups[g][c].title);
      }
      stacks.push({
        id: 'stack-' + (g + 1),
        title: 'Stack ' + (g + 1),
        columns: groups[g],
      });
    }

    return [{
      id: 'row-1',
      title: boardTitle || 'Board',
      stacks: stacks,
    }];
  }

  function rowsForBoardData(fullBoard, fallbackTitle) {
    if (fullBoard && fullBoard.rows && fullBoard.rows.length > 0) {
      return cloneRows(fullBoard.rows);
    }
    if (fullBoard && fullBoard.columns) {
      return rowsFromLegacyColumns(fullBoard.columns, fullBoard.title || fallbackTitle || 'Board');
    }
    return [];
  }

  // ─── Board hierarchy cache ────────────────────────────────────────

  var boardHierarchyCache = {};
  var boardHierarchyInflight = {};
  var BOARD_HIERARCHY_CACHE_STALE_MS = 60000;
  var BOARD_HIERARCHY_REFRESH_CONCURRENCY = 2;

  function setBoardHierarchyRows(boardId, fullBoard, fallbackTitle, options) {
    if (!boardId) return;
    options = options || {};
    boardHierarchyCache[boardId] = {
      rows: rowsForBoardData(fullBoard, fallbackTitle),
      updatedAt: Date.now(),
      revision: options.revision || null,
    };
  }

  function getBoardHierarchyRows(boardId) {
    var activeBoardId = _dep('activeBoardId');
    var activeBoardData = _dep('activeBoardData');
    if (boardId && boardId === activeBoardId && activeBoardData && activeBoardData.rows) {
      return activeBoardData.rows;
    }
    var cached = boardHierarchyCache[boardId];
    return cached && cached.rows ? cached.rows : null;
  }

  function deleteBoardHierarchyCacheEntry(boardId) {
    delete boardHierarchyCache[boardId];
    delete boardHierarchyInflight[boardId];
  }

  function touchBoardHierarchyCacheEntry(boardId) {
    var cached = boardHierarchyCache[boardId];
    if (!cached) return;
    cached.updatedAt = Date.now();
  }

  function shouldHydrateBoardHierarchy(boardMeta, expandedIds, activeBoardId) {
    if (!boardMeta || !boardMeta.id) return false;
    if (boardMeta.id === activeBoardId) return true;
    return Array.isArray(expandedIds) && expandedIds.indexOf(boardMeta.id) !== -1;
  }

  function shouldRefreshBoardHierarchyEntry(boardMeta, cached) {
    if (!boardMeta || !boardMeta.id) return false;
    if (!cached) return true;
    if (boardHierarchyInflight[boardMeta.id]) return false;
    return Date.now() - (cached.updatedAt || 0) >= BOARD_HIERARCHY_CACHE_STALE_MS;
  }

  function fetchBoardHierarchyEntry(boardMeta, LexeraApi) {
    if (!boardMeta || !boardMeta.id || !LexeraApi) return Promise.resolve();
    if (boardHierarchyInflight[boardMeta.id]) return boardHierarchyInflight[boardMeta.id];

    var cached = boardHierarchyCache[boardMeta.id] || null;
    var request = (cached && cached.revision)
      ? LexeraApi.getBoardHierarchyCached(boardMeta.id, cached.revision)
      : LexeraApi.getBoardHierarchy(boardMeta.id);

    var promise = Promise.resolve(request).then(function (response) {
      if (response && response.notModified) {
        touchBoardHierarchyCacheEntry(boardMeta.id);
        return;
      }
      setBoardHierarchyRows(
        boardMeta.id,
        response || null,
        response && response.title ? response.title : (boardMeta.title || 'Board'),
        { revision: response && response.revision ? response.revision : null }
      );
      // Update ALL instances of this board's tree in-place
      var boardListEl = getElBoardList();
      if (boardListEl) {
        var wrappers = boardListEl.querySelectorAll('.board-item-wrapper[data-board-id="' + boardMeta.id + '"]');
        var rows = getBoardHierarchyRows(boardMeta.id) || [];
        for (var wi = 0; wi < wrappers.length; wi++) {
          var treeEl = wrappers[wi].querySelector('.board-item-tree');
          if (treeEl && rows.length > 0) {
            _renderBoardTree(treeEl, boardMeta.id, rows, _dep('TreeView'));
            if (treeEl.classList.contains('expanded')) {
              // Already expanded — keep it
            }
          }
        }
      }
    }).catch(function (err) {
      lexeraLog('warn', '[hierarchy.cache] Failed to load board ' + boardMeta.id + ': ' + err.message);
    }).finally(function () {
      delete boardHierarchyInflight[boardMeta.id];
    });

    boardHierarchyInflight[boardMeta.id] = promise;
    return promise;
  }

  async function refreshBoardHierarchyCache(boardList) {
    var activeBoardId = _dep('activeBoardId');
    var fullBoardData = _dep('fullBoardData');
    var activeBoardData = _dep('activeBoardData');
    var LexeraApi = _dep('LexeraApi');
    var expandedIds = getSidebarExpandedBoards();
    var keep = {};
    for (var i = 0; i < boardList.length; i++) keep[boardList[i].id] = true;
    var cachedIds = Object.keys(boardHierarchyCache);
    for (var j = 0; j < cachedIds.length; j++) {
      if (!keep[cachedIds[j]]) delete boardHierarchyCache[cachedIds[j]];
    }

    var tasks = [];
    for (var k = 0; k < boardList.length; k++) {
      (function (boardMeta) {
        if (
          boardMeta.id === activeBoardId &&
          fullBoardData &&
          activeBoardData &&
          activeBoardData.rows
        ) {
          setBoardHierarchyRows(boardMeta.id, fullBoardData, boardMeta.title || 'Board', {
            revision: activeBoardData.revision || null
          });
          return;
        }
        if (!shouldHydrateBoardHierarchy(boardMeta, expandedIds, activeBoardId)) return;
        var cached = boardHierarchyCache[boardMeta.id];
        if (!shouldRefreshBoardHierarchyEntry(boardMeta, cached)) return;
        tasks.push(boardMeta);
      })(boardList[k]);
    }
    if (tasks.length === 0) return;

    var queueIndex = 0;
    var workerCount = Math.min(BOARD_HIERARCHY_REFRESH_CONCURRENCY, tasks.length);
    var workers = [];
    for (var workerIndex = 0; workerIndex < workerCount; workerIndex++) {
      workers.push((async function () {
        while (queueIndex < tasks.length) {
          var taskIndex = queueIndex++;
          await fetchBoardHierarchyEntry(tasks[taskIndex], LexeraApi);
        }
      })());
    }
    await Promise.all(workers);
  }

  function cardPreviewText(content) {
    return _callDep('getSidebarTreeApi').cardPreviewText(content);
  }

  // ─── Workspace helpers ────────────────────────────────────────────

  function setActiveWorkspaceId(workspaceId) {
    _callDep('setActiveWorkspaceIdState', workspaceId || _dep('ALL_WORKSPACES_ID'));
    if (_Settings) { _Settings.set('activeWorkspace', _dep('activeWorkspaceId')); }
    else { localStorage.setItem('lexera-active-workspace', _dep('activeWorkspaceId')); }
  }

  function resolveActiveWorkspaceId(defaultWorkspaceId) {
    var activeWorkspaceId = _dep('activeWorkspaceId');
    var ALL_WORKSPACES_ID = _dep('ALL_WORKSPACES_ID');
    var workspaces = _dep('workspaces');
    var knownWorkspaceIds = workspaces.map(function (ws) { return ws.id; });
    var storedIsValid = activeWorkspaceId === ALL_WORKSPACES_ID
      || knownWorkspaceIds.indexOf(activeWorkspaceId) >= 0;

    if (storedIsValid) return;

    if (defaultWorkspaceId && knownWorkspaceIds.indexOf(defaultWorkspaceId) >= 0) {
      setActiveWorkspaceId(defaultWorkspaceId);
      return;
    }
    if (knownWorkspaceIds.length > 0) {
      setActiveWorkspaceId(knownWorkspaceIds[0]);
      return;
    }
    setActiveWorkspaceId(ALL_WORKSPACES_ID);
  }

  // ─── Mirrored workspace views ─────────────────────────────────────

  function dispatchMirrorMouseEvent(targetEl, eventType, sourceEvent) {
    if (!targetEl) return false;
    targetEl.dispatchEvent(new MouseEvent(eventType, {
      bubbles: true,
      cancelable: true,
      clientX: sourceEvent && typeof sourceEvent.clientX === 'number' ? sourceEvent.clientX : 0,
      clientY: sourceEvent && typeof sourceEvent.clientY === 'number' ? sourceEvent.clientY : 0,
      button: sourceEvent && typeof sourceEvent.button === 'number' ? sourceEvent.button : 0,
      altKey: !!(sourceEvent && sourceEvent.altKey),
      ctrlKey: !!(sourceEvent && sourceEvent.ctrlKey),
      shiftKey: !!(sourceEvent && sourceEvent.shiftKey),
      metaKey: !!(sourceEvent && sourceEvent.metaKey)
    }));
    return true;
  }

  function findCanonicalHierarchyTarget(sourceTarget) {
    var boardList = getElBoardList();
    if (!boardList || !sourceTarget || typeof sourceTarget.closest !== 'function') return null;
    var treeNode = sourceTarget.closest('.tree-node[data-tree-id]');
    var boardRow = sourceTarget.closest('.board-item[data-board-id]');
    if (sourceTarget.closest('.board-item-remove') && boardRow) {
      return boardList.querySelector('.board-item[data-board-id="' + boardRow.getAttribute('data-board-id') + '"] .board-item-remove');
    }
    if (sourceTarget.closest('.board-item-toggle') && boardRow) {
      return boardList.querySelector('.board-item[data-board-id="' + boardRow.getAttribute('data-board-id') + '"] .board-item-toggle');
    }
    if (sourceTarget.closest('.tree-toggle') && treeNode) {
      return boardList.querySelector('.tree-node[data-tree-id="' + treeNode.getAttribute('data-tree-id') + '"] .tree-toggle');
    }
    if (treeNode) {
      return boardList.querySelector('.tree-node[data-tree-id="' + treeNode.getAttribute('data-tree-id') + '"]');
    }
    if (boardRow) {
      return boardList.querySelector('.board-item[data-board-id="' + boardRow.getAttribute('data-board-id') + '"]');
    }
    return null;
  }

  function bindMirroredWorkspaceView(rootEl) {
    if (!rootEl || rootEl.__lexeraWorkspaceMirrorBound) return;
    rootEl.__lexeraWorkspaceMirrorBound = true;

    rootEl.addEventListener('change', function (e) {
      var selectEl = e.target.closest('.lexera-shared-workspace-select');
      if (!selectEl) return;
      setActiveWorkspaceId(selectEl.value);
      renderWorkspaceSelect();
      renderBoardList();
    });

    rootEl.addEventListener('click', function (e) {
      var menuBtn = e.target.closest('.lexera-shared-workspace-menu');
      if (menuBtn) {
        e.preventDefault();
        e.stopPropagation();
        _callDep('showSidebarHierarchyMenu', menuBtn);
        return;
      }
      var canonicalTarget = findCanonicalHierarchyTarget(e.target);
      if (!canonicalTarget) return;
      e.preventDefault();
      e.stopPropagation();
      dispatchMirrorMouseEvent(canonicalTarget, 'click', e);
    });

    rootEl.addEventListener('contextmenu', function (e) {
      var canonicalTarget = findCanonicalHierarchyTarget(e.target);
      if (!canonicalTarget) return;
      e.preventDefault();
      e.stopPropagation();
      dispatchMirrorMouseEvent(canonicalTarget, 'contextmenu', e);
    });
  }

  function isMirrorRootVisible(rootEl) {
    return rootEl.offsetParent !== null;
  }

  function syncMirroredWorkspaceViews() {
    var workspaceRoots = _callDep('getSharedPanelRoots', 'hierarchy');
    var normalizedWorkspaceRoots = Array.isArray(workspaceRoots) ? workspaceRoots : [];
    var workspaceRootCount = normalizedWorkspaceRoots.length;
    if (!workspaceRootCount) return;
    var activeWorkspaceId = _dep('activeWorkspaceId');
    var ALL_WORKSPACES_ID = _dep('ALL_WORKSPACES_ID');
    var canonicalSelect = document.getElementById('workspace-select');
    var canonicalBoardList = getElBoardList();
    for (var i = 0; i < workspaceRootCount; i++) {
      var rootEl = normalizedWorkspaceRoots[i];
      if (!rootEl) continue;
      if (!isMirrorRootVisible(rootEl)) {
        rootEl.setAttribute('data-mirror-stale', 'true');
        continue;
      }
      rootEl.removeAttribute('data-mirror-stale');
      bindMirroredWorkspaceView(rootEl);
      var selectEl = rootEl.querySelector('.lexera-shared-workspace-select');
      var boardListEl = rootEl.querySelector('.lexera-shared-board-list');
      if (selectEl && canonicalSelect) {
        selectEl.innerHTML = canonicalSelect.innerHTML;
        selectEl.value = activeWorkspaceId || canonicalSelect.value || ALL_WORKSPACES_ID;
      }
      if (boardListEl && canonicalBoardList) {
        boardListEl.innerHTML = canonicalBoardList.innerHTML;
      }
    }
  }

  // ─── Workspace select rendering ───────────────────────────────────

  function renderWorkspaceSelect() {
    var sel = document.getElementById('workspace-select');
    // console.log('[ws-debug] renderWorkspaceSelect: sel=' + (sel ? sel.id + ' connected=' + sel.isConnected + ' parent=' + (sel.parentNode ? sel.parentNode.className : 'null') : 'NULL'));
    if (!sel) return;

    resolveActiveWorkspaceId(null);

    var activeWorkspaceId = _dep('activeWorkspaceId');
    var ALL_WORKSPACES_ID = _dep('ALL_WORKSPACES_ID');
    var workspaces = _dep('workspaces');
    // console.log('[ws-debug] renderWorkspaceSelect: workspaces=' + (workspaces ? workspaces.length : 'null') + ', activeWs=' + activeWorkspaceId + ', ALL=' + ALL_WORKSPACES_ID);

    sel.innerHTML = '';

    var allOpt = document.createElement('option');
    allOpt.value = ALL_WORKSPACES_ID;
    allOpt.textContent = 'All Workspaces';
    if (activeWorkspaceId === ALL_WORKSPACES_ID) allOpt.selected = true;
    sel.appendChild(allOpt);

    for (var i = 0; i < workspaces.length; i++) {
      var ws = workspaces[i];
      var opt = document.createElement('option');
      opt.value = ws.id;
      var boardCount = typeof ws.board_count === 'number' ? ws.board_count : null;
      opt.textContent = boardCount != null ? (ws.name + ' (' + boardCount + ')') : ws.name;
      if (ws.id === activeWorkspaceId) opt.selected = true;
      sel.appendChild(opt);
      // console.log('[ws-debug] renderWorkspaceSelect: added option "' + opt.textContent + '" value=' + opt.value);
    }
    // console.log('[ws-debug] renderWorkspaceSelect: sel.children=' + sel.children.length + ', sel.innerHTML.length=' + sel.innerHTML.length);
    // Check how many workspace-select and board-list elements exist in the DOM
    var allSelects = document.querySelectorAll('.workspace-select');
    var allBoardLists = document.querySelectorAll('.board-list');
    // console.log('[ws-debug] DOM totals: workspace-selects=' + allSelects.length + ', board-lists=' + allBoardLists.length);
    for (var si = 0; si < allSelects.length; si++) {
      // console.log('[ws-debug]   select[' + si + ']: id=' + (allSelects[si].id || 'none') + ', children=' + allSelects[si].children.length + ', connected=' + allSelects[si].isConnected + ', visible=' + (allSelects[si].offsetParent !== null));
    }

    if (!sel.value) {
      setActiveWorkspaceId(ALL_WORKSPACES_ID);
      sel.value = ALL_WORKSPACES_ID;
    } else if (sel.value !== activeWorkspaceId) {
      setActiveWorkspaceId(sel.value);
    }

    sel.onchange = function () {
      setActiveWorkspaceId(sel.value);
      renderWorkspaceSelect();
      renderBoardList();
    };
    syncMirroredWorkspaceViews();
  }

  function getBoardWorkspaceIds(board) {
    return board.workspace_ids || board.workspaceIds || (board.workspace_id || board.workspaceId ? [board.workspace_id || board.workspaceId] : []);
  }

  // ─── Remove board ─────────────────────────────────────────────────

  async function removeBoardFromSidebar(boardId, boardName) {
    var cleanupOk = await _callDep('cleanupBoardBeforeSidebarClose', boardId);
    if (!cleanupOk) return false;
    if (!(await _callDep('showConfirmDialog', 'Remove "' + boardName + '" from sidebar?\n(The file will not be deleted.)'))) return false;

    var boards = _dep('boards');
    _callDep('setBoards', boards.filter(function (b) { return b.id !== boardId; }));
    delete boardHierarchyCache[boardId];
    var activeBoardId = _dep('activeBoardId');
    if (activeBoardId === boardId) {
      _callDep('setActiveBoardId', null);
      _callDep('setActiveBoardData', null);
      _callDep('setFullBoardData', null);
      if (_Settings) { _Settings.set('lastBoard', ''); }
      else { localStorage.removeItem('lexera-last-board'); }
    }
    renderBoardList();
    _callDep('renderMainView');
    _callDep('scheduleDashboardRefresh', 60);

    var LexeraApi = _dep('LexeraApi');
    LexeraApi.removeBoard(boardId).catch(function (err) {
      lexeraLog('error', '[sidebar.remove] Backend error: ' + err.message);
      _callDep('showNotification', 'Failed to remove board');
      _callDep('poll');
    });
    return true;
  }

  // ─── Board list rendering ─────────────────────────────────────────

  // Fingerprint of the last successful renderBoardList call.
  // If the inputs haven't changed we skip the expensive DOM rebuild.
  var _lastRenderFingerprint = '';

  function _buildRenderFingerprint(boards, remoteBoards, workspaces, activeWorkspaceId, activeBoardId) {
    var parts = [activeWorkspaceId || '', activeBoardId || ''];
    var i;
    if (boards) for (i = 0; i < boards.length; i++) parts.push(boards[i].id + ':' + (boards[i].title || '') + ':' + (boards[i].generation !== undefined ? boards[i].generation : ''));
    parts.push('|R|');
    if (remoteBoards) for (i = 0; i < remoteBoards.length; i++) parts.push(remoteBoards[i].id + ':' + (remoteBoards[i].title || ''));
    parts.push('|W|');
    if (workspaces) for (i = 0; i < workspaces.length; i++) parts.push(workspaces[i].id + ':' + (workspaces[i].name || ''));
    // Include sidebar expanded state so fold toggles always trigger a re-render
    parts.push('|E|');
    var expanded = getSidebarExpandedBoards();
    if (expanded.length > 0) parts.push(expanded.join(';'));
    return parts.join(',');
  }

  /** Call with true to bypass the fingerprint check (e.g. after fold toggle). */
  function invalidateBoardListFingerprint() {
    _lastRenderFingerprint = '';
  }

  // ─── DOM node key helpers for incremental reconciliation ─────────

  /** Extract the reconciliation key from a board-list child element. */
  function _nodeKey(el) {
    if (!el || !el.getAttribute) return null;
    var explicitKey = el.getAttribute('data-list-key');
    if (explicitKey) return explicitKey;
    if (el.classList.contains('workspace-nav-up')) return '__nav_up__';
    var wsId = el.getAttribute('data-workspace-id');
    if (wsId) return 'ws:' + wsId;
    if (el.classList.contains('sidebar-section-divider')) return '__remote_divider__';
    var boardId = el.getAttribute('data-board-id');
    if (boardId && el.classList.contains('remote-board')) return 'remote:' + boardId;
    if (boardId) return 'board:' + boardId;
    return null;
  }

  /** Create a "Go up" nav element for workspace sub-views. */
  function _createNavUpEl() {
    var upEl = document.createElement('div');
    upEl.className = 'board-item-wrapper workspace-nav-up';
    upEl.innerHTML = '<div class="tree-node workspace-nav-item" data-tree-depth="0"><span class="workspace-nav-icon">\u2190</span> All Workspaces</div>';
    upEl.addEventListener('dblclick', function () {
      setActiveWorkspaceId(_dep('ALL_WORKSPACES_ID'));
      renderWorkspaceSelect();
      renderBoardList();
    });
    return upEl;
  }

  /** Create a workspace section header element. */
  function _createWsHeaderEl(wsInfo) {
    var wsHeader = document.createElement('div');
    wsHeader.className = 'workspace-section-header' + (wsInfo.expanded ? ' expanded' : '');
    wsHeader.setAttribute('data-workspace-id', wsInfo.ws.id);
    _updateWsHeaderContent(wsHeader, wsInfo);
    if (wsInfo.unassigned) wsHeader.classList.add('workspace-unassigned');
    (function (wsId) {
      wsHeader.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        setActiveWorkspaceId(wsId);
        renderWorkspaceSelect();
        renderBoardList();
      });
      wsHeader.addEventListener('click', function (e) {
        if (e.detail > 1) return;
        var ids = getSidebarExpandedBoards();
        var key = 'ws:' + wsId;
        var idx = ids.indexOf(key);
        if (idx !== -1) ids.splice(idx, 1); else ids.push(key);
        saveSidebarExpandedBoards(ids);
        renderBoardList();
      });
    })(wsInfo.ws.id);
    return wsHeader;
  }

  /** Update workspace header content in place. */
  function _updateWsHeaderContent(wsHeader, wsInfo) {
    var expanded = wsInfo.expanded;
    if (expanded) { wsHeader.classList.add('expanded'); } else { wsHeader.classList.remove('expanded'); }
    wsHeader.innerHTML =
      '<span class="workspace-section-toggle">' + (expanded ? '\u25BC' : '\u25B6') + '</span>' +
      '<span class="workspace-section-name">' + _callDep('escapeHtml', wsInfo.ws.name || 'Untitled') + '</span>' +
      (wsInfo.count ? '<span class="workspace-section-count">' + wsInfo.count + '</span>' : '');
  }

  /** Create a remote board element. */
  function _createRemoteBoardEl(rb, activeBoardId) {
    var rbEl = document.createElement('div');
    rbEl.className = 'board-item tree-node tree-board remote-board' + (rb.id === activeBoardId ? ' active' : '');
    rbEl.setAttribute('data-board-id', rb.id);
    rbEl.setAttribute('data-tree-depth', '0');
    _updateRemoteBoardContent(rbEl, rb, activeBoardId);
    (function (boardId) {
      rbEl.addEventListener('click', function () {
        _callDep('exitSearchMode');
        _callDep('selectBoard', boardId);
      });
    })(rb.id);
    return rbEl;
  }

  /** Update a remote board element in place. */
  function _updateRemoteBoardContent(rbEl, rb, activeBoardId) {
    if (rb.id === activeBoardId) { rbEl.classList.add('active'); } else { rbEl.classList.remove('active'); }
    rbEl.innerHTML =
      '<span class="tree-indent tree-indent-root" aria-hidden="true"></span>' +
      '<span class="tree-toggle-spacer board-item-toggle-spacer"></span>' +
      '<span class="tree-label board-item-title board-item-title-with-icon">' +
        '<span class="board-item-remote-icon" title="Remote board">&#127760;</span>' +
        '<span class="board-item-title-text">' + _callDep('escapeHtml', rb.title || rb.id) + '</span>' +
      '</span>' +
      '<span class="tree-meta board-item-meta">' +
        '<span class="tree-meta-presence board-presence-badge hidden" aria-hidden="true"></span>' +
        '<span class="tree-count board-item-count">' + (rb.card_count || 0) + '</span>' +
        '<span class="tree-meta-action board-item-remove hidden" aria-hidden="true"></span>' +
        '<span class="tree-grip tree-grip-spacer" aria-hidden="true"></span>' +
      '</span>';
  }

  /** Create a board wrapper element with all sub-elements and event listeners. */
  function _createBoardWrapperEl(board, boardIndex, isExpanded, isActive, rows, totalCards, tv, SidebarSync, workspaceShellEnabled, WorkspaceShell) {
    var wrapper = document.createElement('div');
    wrapper.className = 'board-item-wrapper tree-view-host tree-view-host-compact';
    wrapper.setAttribute('data-board-id', board.id);

    var el = document.createElement('div');
    el.className = 'board-item tree-node tree-board' + (isActive ? ' active' : '');
    el.setAttribute('data-board-index', boardIndex.toString());
    el.setAttribute('data-board-id', board.id);
    el.setAttribute('data-tree-depth', '0');

    _updateBoardItemContent(el, board, boardIndex, isExpanded, isActive, rows, totalCards, SidebarSync);

    // Tree sub-list
    var tree = document.createElement('div');
    tree.className = 'board-item-tree tree-children' + (isExpanded ? ' expanded' : '');
    tree.setAttribute('data-tree-depth', '1');
    tree.setAttribute('role', 'tree');

    var hasContent = rows.length > 0;
    if (hasContent) {
      _renderBoardTree(tree, board.id, rows, tv);
    }

    wrapper.appendChild(el);
    wrapper.appendChild(tree);

    _bindBoardWrapperEvents(wrapper, board.id, boardIndex, board.filePath, workspaceShellEnabled, WorkspaceShell);

    return wrapper;
  }

  /** Update the board-item row content (title, count, presence, active, expand state). */
  function _updateBoardItemContent(el, board, boardIndex, isExpanded, isActive, rows, totalCards, SidebarSync) {
    var boardName = board.title || _callDep('getDisplayNameFromPath', board.filePath || '') || 'Untitled';
    var hasContent = rows.length > 0;
    var displayTitle = _callDep('escapeHtml', boardName);
    var boardPresenceCache = _dep('boardPresenceCache');
    var presenceCount = (boardPresenceCache[board.id] || []).length;
    var presenceBadge = '<span class="tree-meta-presence board-presence-badge' + (presenceCount > 0 ? '' : ' hidden') + '"' +
      (presenceCount > 0 ? (' title="' + presenceCount + ' user(s) online"') : '') + '>' +
      (presenceCount > 0 ? presenceCount : '') +
      '</span>';
    var removeButton = '<span class="tree-meta-action board-item-remove' + ((SidebarSync && SidebarSync.isHierarchyLocked()) ? ' hidden' : '') + '" title="Remove board">\u00D7</span>';
    var boardGrip = '<span class="tree-grip entity-drag-icon entity-drag-icon-board" title="Drag to reorder">' +
      _callDep('getCreationEntityDragIconSvg', 'board') +
      '</span>';

    if (isActive) { el.classList.add('active'); } else { el.classList.remove('active'); }
    el.setAttribute('data-board-index', boardIndex.toString());

    if (hasContent) {
      el.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    } else {
      el.removeAttribute('aria-expanded');
    }
    el.innerHTML =
      '<span class="tree-indent tree-indent-root" aria-hidden="true"></span>' +
      '<span class="tree-toggle board-item-toggle' + (isExpanded ? ' expanded' : '') + '"></span>' +
      '<span class="tree-label board-item-title"><span class="board-item-title-text">' + displayTitle + '</span></span>' +
      '<span class="tree-meta board-item-meta">' +
        presenceBadge +
        '<span class="tree-count board-item-count">' + totalCards + '</span>' +
        removeButton +
        boardGrip +
      '</span>';
  }

  /** Render tree content into a board's tree container. */
  function _renderBoardTree(treeEl, boardId, rows, tv) {
    treeEl.innerHTML = '';
    var treeState = getSidebarTreeState(boardId);
    var hasTreeState = hasSidebarTreeState(boardId);
    var treeNodes = buildSidebarTreeNodes(rows, boardId, treeState, hasTreeState);
    if (tv && typeof tv.render === 'function') {
      tv.render(treeEl, treeNodes, {
        escapeHtml: function (s) { return _callDep('escapeHtml', s); },
        variant: 'compact',
        onChildrenContainer: function (el, node) {
          if (node.type === 'stack') {
            el.classList.add('tree-stack-drop-zone');
            if (node.attrs) {
              if (node.attrs['data-board-id']) el.setAttribute('data-board-id', node.attrs['data-board-id']);
              if (node.attrs['data-row-index']) el.setAttribute('data-row-index', node.attrs['data-row-index']);
              if (node.attrs['data-stack-index']) el.setAttribute('data-stack-index', node.attrs['data-stack-index']);
            }
            if (!node.children || node.children.length === 0) {
              el.classList.add('tree-stack-drop-zone-empty');
            }
          }
        }
      });
    }
  }

  function _extractTreeNodeScopeCtx(node) {
    var scope = null;
    var ctx = {};
    if (node.classList.contains('tree-card')) {
      scope = 'card';
      var colIdx = node.getAttribute('data-col-index');
      ctx.colIndex = colIdx != null ? parseInt(colIdx, 10) : -1;
      ctx.cardIndex = parseInt(node.getAttribute('data-card-index') || '0', 10);
    } else if (node.classList.contains('tree-column')) {
      scope = 'column';
      var colIdx2 = node.getAttribute('data-col-index');
      ctx.colIndex = colIdx2 != null ? parseInt(colIdx2, 10) : -1;
      ctx.rowIdx = parseInt(node.getAttribute('data-row-index') || '0', 10);
      ctx.stackIdx = parseInt(node.getAttribute('data-stack-index') || '0', 10);
      ctx.colLocalIdx = parseInt(node.getAttribute('data-col-local-index') || '0', 10);
    } else if (node.classList.contains('tree-stack')) {
      scope = 'stack';
      ctx.rowIdx = parseInt(node.getAttribute('data-row-index') || '0', 10);
      ctx.stackIdx = parseInt(node.getAttribute('data-stack-index') || '0', 10);
    } else if (node.classList.contains('tree-row')) {
      scope = 'row';
      ctx.rowIdx = parseInt(node.getAttribute('data-row-index') || '0', 10);
    }
    return scope ? { scope: scope, ctx: ctx } : null;
  }

  function _showTreeNodeContextMenu(boardId, node, x, y, workspaceShellEnabled, WorkspaceShell) {
    var result = _extractTreeNodeScopeCtx(node);
    if (!result) return;
    if (workspaceShellEnabled && WorkspaceShell && typeof WorkspaceShell.showContextMenuInBoardFrame === 'function') {
      WorkspaceShell.showContextMenuInBoardFrame(boardId, result.scope, x, y, result.ctx);
    } else {
      _callDep('showElementContextMenu', result.scope, x, y, result.ctx);
    }
  }

  /** Bind all event listeners on a board wrapper (toggle, tree clicks, board click, context menu). */
  function _bindBoardWrapperEvents(wrapperEl, boardId, boardIndex, boardFilePath, workspaceShellEnabled, WorkspaceShell) {
    (function (boardId, boardIndex, wrapperEl, boardFilePath) {
      // Toggle expand on board arrow click (Alt+click = recursive)
      // Use delegation on the board-item div so the handler survives innerHTML updates.
      var boardItemEl = wrapperEl.querySelector('.board-item');
      if (boardItemEl) {
        boardItemEl.addEventListener('click', function (e) {
          var toggle = e.target.closest('.board-item-toggle');
          if (!toggle) return;
          e.stopPropagation();
          var ids = getSidebarExpandedBoards();
          var idx = ids.indexOf(boardId);
          var treeContainer = wrapperEl.querySelector('.board-item-tree');
          if (idx !== -1) {
            ids.splice(idx, 1);
            toggle.classList.remove('expanded');
            treeContainer.classList.remove('expanded');
            boardRow.setAttribute('aria-expanded', 'false');
            if (e.altKey) setDescendantTreeState(treeContainer, false, boardId);
          } else {
            ids.push(boardId);
            toggle.classList.add('expanded');
            treeContainer.classList.add('expanded');
            boardRow.setAttribute('aria-expanded', 'true');
            if (e.altKey) setDescendantTreeState(treeContainer, true, boardId);
            // Fetch hierarchy if not cached
            var cached = boardHierarchyCache[boardId];
            if (!cached || !cached.rows || cached.rows.length === 0) {
              var allBoards = (_dep('boards') || []).concat(_dep('remoteBoards') || []);
              for (var bi = 0; bi < allBoards.length; bi++) {
                if (allBoards[bi].id === boardId) {
                  fetchBoardHierarchyEntry(allBoards[bi], _dep('LexeraApi'));
                  break;
                }
              }
            }
          }
          saveSidebarExpandedBoards(ids);
          syncMirroredWorkspaceViews();
        });
      }

      // Tree node toggle, click, and DnD handlers (event delegation on tree container)
      var treeEl = wrapperEl.querySelector('.board-item-tree');
      if (treeEl) {
        treeEl.addEventListener('click', function (e) {
          var target = e.target;

          // Grip click — do nothing (grip is for drag only)
          if (target.classList.contains('tree-grip')) {
            e.stopPropagation();
            return;
          }

          // Menu button click — open context menu for this node
          if (target.classList.contains('tree-menu-btn')) {
            e.stopPropagation();
            var menuNode = target.closest('.tree-node');
            if (menuNode) {
              var btnRect = target.getBoundingClientRect();
              _showTreeNodeContextMenu(boardId, menuNode, btnRect.right, btnRect.bottom, workspaceShellEnabled, WorkspaceShell);
            }
            return;
          }

          // Toggle arrow click (Alt+click = fold children only, not self)
          if (target.classList.contains('tree-toggle')) {
            e.stopPropagation();
            var node = target.closest('.tree-node');
            if (!node) return;
            var children = getSidebarTreeChildrenContainer(node);
            if (children) {
              if (e.altKey) {
                // Alt+click: fold/unfold all descendants, leave self unchanged
                var childNodes = children.querySelectorAll('.tree-children');
                var allCollapsed = true;
                for (var ci = 0; ci < childNodes.length; ci++) {
                  if (childNodes[ci].classList.contains('expanded')) { allCollapsed = false; break; }
                }
                setDescendantTreeState(children, allCollapsed, boardId);
              } else {
                var expanding = !children.classList.contains('expanded');
                children.classList.toggle('expanded');
                target.classList.toggle('expanded');
                node.setAttribute('aria-expanded', expanding ? 'true' : 'false');
                // Persist fold state
                var treeId = node.getAttribute('data-tree-id');
                if (treeId) {
                  if (node.classList.contains('tree-row')) {
                    toggleSidebarTreeNode(boardId, 'rows', treeId);
                  } else if (node.classList.contains('tree-stack')) {
                    toggleSidebarTreeNode(boardId, 'stacks', treeId);
                  } else if (node.classList.contains('tree-column')) {
                    toggleSidebarTreeNode(boardId, 'columns', treeId);
                  }
                }
                syncMirroredWorkspaceViews();
              }
            }
            return;
          }
          var anyNode = target.closest('.tree-node');
          if (!anyNode) return;
          e.stopPropagation();
          var navTarget = _callDep('buildHierarchyFocusTargetFromTreeNode', anyNode, boardId);
          if (!navTarget) {
            if (boardId !== _dep('activeBoardId')) _callDep('selectBoard', boardId);
            return;
          }
          if (workspaceShellEnabled && WorkspaceShell && typeof WorkspaceShell.focusHierarchyTarget === 'function') {
            WorkspaceShell.focusHierarchyTarget(navTarget, boardId);
            return;
          }
          _callDep('navigateToHierarchyTarget', navTarget).catch(function (err) {
            logFrontendIssue('warn', 'sidebar.hierarchy-focus', 'Failed to focus hierarchy target', err);
            _callDep('showNotification', 'Failed to focus hierarchy item');
          });
        });

        // Tree node right-click context menu (same menus as board view)
        treeEl.addEventListener('contextmenu', function (e) {
          var node = e.target.closest('.tree-node');
          if (!node) return;
          e.preventDefault();
          e.stopPropagation();
          _showTreeNodeContextMenu(boardId, node, e.clientX, e.clientY, workspaceShellEnabled, WorkspaceShell);
        });

        // Tree DnD is handled by the pointer-based drag system (mousedown on getElBoardList())
      }

      var boardRow = wrapperEl.querySelector('.board-item');
      boardRow.addEventListener('click', async function (e) {
        // Toggle click is handled by the delegation handler above — skip here
        if (e.target.closest('.board-item-toggle')) return;
        // Remove button click — handle inline via delegation
        if (_callDep('targetClosest', e.target, '.board-item-remove')) {
          e.preventDefault();
          e.stopPropagation();
          var boardName = boardRow.querySelector('.board-item-title').textContent;
          await removeBoardFromSidebar(boardId, boardName);
          return;
        }
        _callDep('exitSearchMode');
        _callDep('selectBoard', boardId);
      });

      boardRow.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var items = [
          { id: 'open-tab', label: 'Open / Focus Tab' },
          { id: 'detach', label: 'Open in Detached Window' },
          { separator: true },
          { id: 'backend-settings', label: 'Backend Settings' },
          { separator: true },
          { id: 'reveal', label: 'Reveal in Finder' }
        ];
        _callDep('showNativeMenu', items, e.clientX, e.clientY).then(async function (action) {
          if (action === 'open-tab') {
            _callDep('selectBoard', boardId);
          } else if (action === 'detach') {
            if (_dep('hasTauri')) _callDep('tauriInvoke', 'open_new_window', { boardId: boardId, profile: 'detachedBoard' });
          } else if (action === 'backend-settings') {
            _callDep('openConnectionWindow');
          } else if (action === 'reveal' && boardFilePath) {
            _callDep('showInFinder', boardFilePath);
          }
        });
      });
      // Board DnD is handled by the pointer-based drag system (mousedown on getElBoardList())
    })(boardId, boardIndex, wrapperEl, boardFilePath);
  }

  /**
   * Build the flat ordered list of keyed entries that renderBoardList should display.
   * Each entry has { key, type, ... } plus type-specific data.
   */
  function _buildDesiredEntries(boards, remoteBoards, workspaces, activeWorkspaceId, activeBoardId) {
    var ALL_WORKSPACES_ID = _dep('ALL_WORKSPACES_ID');
    var isAllView = !activeWorkspaceId || activeWorkspaceId === ALL_WORKSPACES_ID;
    var filteredBoards = isAllView
      ? boards
      : boards.filter(function (b) { return getBoardWorkspaceIds(b).indexOf(activeWorkspaceId) >= 0; });
    var orderedBoards = _callDep('getOrderedItems', filteredBoards, 'lexera-board-order', function (b) { return b.id; }) || filteredBoards;
    var expandedIds = getSidebarExpandedBoards();
    var entries = [];

    // "Go up" entry when inside a specific workspace
    if (!isAllView) {
      entries.push({ key: '__nav_up__', type: 'nav_up' });
    }

    // In "All Workspaces" view, show workspace section headers
    if (isAllView && workspaces.length > 0) {
      var wsBoardMap = {};
      var assignedBoardIds = {};
      for (var wi = 0; wi < workspaces.length; wi++) wsBoardMap[workspaces[wi].id] = [];
      for (var bi = 0; bi < orderedBoards.length; bi++) {
        var bws = getBoardWorkspaceIds(orderedBoards[bi]);
        for (var bwi = 0; bwi < bws.length; bwi++) {
          if (wsBoardMap[bws[bwi]]) { wsBoardMap[bws[bwi]].push(orderedBoards[bi]); assignedBoardIds[orderedBoards[bi].id] = true; }
        }
      }
      for (var wgi = 0; wgi < workspaces.length; wgi++) {
        var ws = workspaces[wgi];
        var wsBoards = wsBoardMap[ws.id] || [];
        if (wsBoards.length === 0) continue;
        var wsExpanded = expandedIds.indexOf('ws:' + ws.id) !== -1;
        entries.push({ key: 'ws:' + ws.id, type: 'ws_header', ws: ws, count: wsBoards.length, expanded: wsExpanded, unassigned: false });
        if (wsExpanded) {
          for (var wbi = 0; wbi < wsBoards.length; wbi++) {
            var wb = wsBoards[wbi];
            entries.push({ key: 'board:' + ws.id + ':' + wb.id, type: 'board', board: wb, index: entries.length });
          }
        }
      }
      // Unassigned
      var hasUnassigned = false;
      for (var ubi = 0; ubi < orderedBoards.length; ubi++) {
        if (!assignedBoardIds[orderedBoards[ubi].id]) {
          if (!hasUnassigned) {
            entries.push({ key: 'ws:__unassigned__', type: 'ws_header', ws: { id: '__unassigned__', name: 'Unassigned' }, count: 0, expanded: true, unassigned: true });
            hasUnassigned = true;
          }
          entries.push({ key: 'board:' + orderedBoards[ubi].id, type: 'board', board: orderedBoards[ubi], index: entries.length });
        }
      }
    } else {
      // Simple flat list or single-workspace view
      for (var si = 0; si < orderedBoards.length; si++) {
        entries.push({ key: 'board:' + orderedBoards[si].id, type: 'board', board: orderedBoards[si], index: entries.length });
      }
    }

    // Remote boards
    if (remoteBoards.length > 0) {
      entries.push({ key: '__remote_divider__', type: 'remote_divider' });
      for (var ri = 0; ri < remoteBoards.length; ri++) {
        entries.push({ key: 'remote:' + remoteBoards[ri].id, type: 'remote_board', rb: remoteBoards[ri] });
      }
    }

    // Fix board indices to be sequential among board entries only
    var boardIdx = 0;
    for (var fi = 0; fi < entries.length; fi++) {
      if (entries[fi].type === 'board') { entries[fi].index = boardIdx++; }
    }

    return entries;
  }

  function renderBoardList() {
    var boardListEl = getElBoardList();
    var rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;
    if (rt) rt.setViewLoading(boardListEl, false);

    var activeWorkspaceId = _dep('activeWorkspaceId');
    var ALL_WORKSPACES_ID = _dep('ALL_WORKSPACES_ID');
    var boards = _dep('boards');
    var remoteBoards = _dep('remoteBoards');
    var activeBoardId = _dep('activeBoardId');

    // Skip expensive DOM rebuild if nothing changed since last render
    var workspaces = _dep('workspaces') || [];
    var renderFp = _buildRenderFingerprint(boards, remoteBoards, workspaces, activeWorkspaceId, activeBoardId);
    if (renderFp === _lastRenderFingerprint && boardListEl.childNodes.length > 0) {
      return;
    }
    _lastRenderFingerprint = renderFp;

    var SidebarSync = _dep('SidebarSync');
    var tv = _dep('TreeView');
    var workspaceShellEnabled = _dep('workspaceShellEnabled');
    var WorkspaceShell = _dep('WorkspaceShell');
    var expandedIds = getSidebarExpandedBoards();

    // Build the desired flat list of keyed entries
    var desired = _buildDesiredEntries(boards, remoteBoards, workspaces, activeWorkspaceId, activeBoardId);

    // Build a map of existing DOM children by key for reuse
    var existingByKey = {};
    var children = boardListEl.children;
    for (var ci = children.length - 1; ci >= 0; ci--) {
      var k = _nodeKey(children[ci]);
      if (k) {
        existingByKey[k] = children[ci];
      }
    }

    // Track which keys are in the desired list
    var desiredKeys = {};
    for (var di = 0; di < desired.length; di++) {
      desiredKeys[desired[di].key] = true;
    }

    // Remove DOM children that are no longer in the desired list
    for (var ri = children.length - 1; ri >= 0; ri--) {
      var rk = _nodeKey(children[ri]);
      if (!rk || !desiredKeys[rk]) {
        boardListEl.removeChild(children[ri]);
      }
    }

    // Reconcile: walk the desired list and ensure each entry is at the right position
    // with correct content. Reuse existing nodes where possible.
    for (var i = 0; i < desired.length; i++) {
      var entry = desired[i];
      var existing = existingByKey[entry.key];
      var node;

      if (entry.type === 'nav_up') {
        // Nav-up is static, reuse if exists
        node = existing || _createNavUpEl();
      } else if (entry.type === 'ws_header') {
        if (existing) {
          _updateWsHeaderContent(existing, entry);
          node = existing;
        } else {
          node = _createWsHeaderEl(entry);
        }
      } else if (entry.type === 'board') {
        var board = entry.board;
        var isExpanded = expandedIds.indexOf(board.id) !== -1;
        var isActive = board.id === activeBoardId;
        var rows = getBoardHierarchyRows(board.id) || [];
        var totalCards = rows.length > 0
          ? countCardsInRows(rows)
          : board.columns.reduce(function (sum, c) { return sum + c.cardCount; }, 0);

        if (existing) {
          // Update existing board wrapper in place
          var boardItem = existing.querySelector('.board-item');
          if (boardItem) {
            _updateBoardItemContent(boardItem, board, entry.index, isExpanded, isActive, rows, totalCards, SidebarSync);
          }
          // Update tree content
          var treeEl = existing.querySelector('.board-item-tree');
          if (treeEl) {
            if (isExpanded) { treeEl.classList.add('expanded'); } else { treeEl.classList.remove('expanded'); }
            var hasContent = rows.length > 0;
            if (hasContent) {
              _renderBoardTree(treeEl, board.id, rows, tv);
            } else {
              treeEl.innerHTML = '';
            }
          }
          node = existing;
        } else {
          node = _createBoardWrapperEl(board, entry.index, isExpanded, isActive, rows, totalCards, tv, SidebarSync, workspaceShellEnabled, WorkspaceShell);
        }
      } else if (entry.type === 'remote_divider') {
        if (existing) {
          node = existing;
        } else {
          var remoteDivider = document.createElement('div');
          remoteDivider.className = 'sidebar-section-divider';
          remoteDivider.innerHTML = '<span class="sidebar-section-label">Remote</span>';
          node = remoteDivider;
        }
      } else if (entry.type === 'remote_board') {
        if (existing) {
          _updateRemoteBoardContent(existing, entry.rb, activeBoardId);
          node = existing;
        } else {
          node = _createRemoteBoardEl(entry.rb, activeBoardId);
        }
      }

      // Stamp the reconciliation key on the node for future lookups
      if (node && entry.key) {
        node.setAttribute('data-list-key', entry.key);
      }
      // Ensure node is at position i
      if (node) {
        var currentAtPos = boardListEl.children[i];
        if (currentAtPos !== node) {
          boardListEl.insertBefore(node, currentAtPos || null);
        }
      }
    }

    var hasBoardItems = boardListEl.children.length > 0;
    if (rt) rt.setViewEmpty(boardListEl, !hasBoardItems, 'No boards');

    // Clean up draft entries for boards that no longer exist
    var allBoardIds = (boards || []).map(function (b) { return b.id; });
    pruneOrphanedDrafts(allBoardIds);

    syncMirroredWorkspaceViews();
  }

  // ─── Global function accessors (not injected via init) ────────────

  function getElBoardList() {
    return typeof window.getElBoardList === 'function' ? window.getElBoardList() : document.getElementById('board-list');
  }

  function logFrontendIssue(level, area, msg, err) {
    if (typeof window.logFrontendIssue === 'function') {
      window.logFrontendIssue(level, area, msg, err);
    }
  }

  function lexeraLog(level, msg) {
    if (typeof window.lexeraLog === 'function') {
      window.lexeraLog(level, msg);
    }
  }

  function traceFrontendAction(level, target, message, details) {
    if (typeof window.traceFrontendAction === 'function') {
      window.traceFrontendAction(level, target, message, details);
    }
  }

  function summarizeBoardHierarchy(boardData) {
    if (typeof window.summarizeBoardHierarchy === 'function') {
      return window.summarizeBoardHierarchy(boardData);
    }
    return null;
  }

  // ─── Init ─────────────────────────────────────────────────────────

  function init(deps) {
    if (!deps) return;
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
      var keys = Object.keys(deps);
      for (var i = 0; i < keys.length; i++) {
        var desc = Object.getOwnPropertyDescriptor(deps, keys[i]);
        if (desc && (desc.get || desc.set)) {
          Object.defineProperty(_deps, keys[i], desc);
        } else {
          _deps[keys[i]] = deps[keys[i]];
        }
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────

  return {
    init: init,
    getSidebarExpandedBoards: getSidebarExpandedBoards,
    saveSidebarExpandedBoards: saveSidebarExpandedBoards,
    getSidebarTreeState: getSidebarTreeState,
    hasSidebarTreeState: hasSidebarTreeState,
    saveSidebarTreeState: saveSidebarTreeState,
    getSidebarTreeChildrenContainer: getSidebarTreeChildrenContainer,
    getSidebarTreeOwnerNode: getSidebarTreeOwnerNode,
    toggleSidebarTreeNode: toggleSidebarTreeNode,
    setDescendantTreeState: setDescendantTreeState,
    buildSidebarTreeNodes: buildSidebarTreeNodes,
    countCardsInRow: countCardsInRow,
    countCardsInStack: countCardsInStack,
    countCardsInRows: countCardsInRows,
    cloneRows: cloneRows,
    cloneBoardData: cloneBoardData,
    boardDraftStorageKey: boardDraftStorageKey,
    getBoardCardKids: getBoardCardKids,
    getBoardCardIdentityStats: getBoardCardIdentityStats,
    summarizeBoardIdentity: summarizeBoardIdentity,
    describeBoardIdentityPair: describeBoardIdentityPair,
    traceBoardIdentityPair: traceBoardIdentityPair,
    hasBoardIdentityMismatch: hasBoardIdentityMismatch,
    saveLocalBoardDraft: saveLocalBoardDraft,
    loadLocalBoardDraft: loadLocalBoardDraft,
    clearLocalBoardDraft: clearLocalBoardDraft,
    boardCardSummary: boardCardSummary,
    setBoardSaveBase: setBoardSaveBase,
    getBoardSaveBase: getBoardSaveBase,
    resolveSavedBoardData: resolveSavedBoardData,
    resolveLiveSyncBoardData: resolveLiveSyncBoardData,
    applyLiveSyncBoardSnapshot: applyLiveSyncBoardSnapshot,
    applyRebasedBoardSnapshot: applyRebasedBoardSnapshot,
    rebaseDirtyBoardFromServer: rebaseDirtyBoardFromServer,
    rowsFromLegacyColumns: rowsFromLegacyColumns,
    rowsForBoardData: rowsForBoardData,
    setBoardHierarchyRows: setBoardHierarchyRows,
    getBoardHierarchyRows: getBoardHierarchyRows,
    deleteBoardHierarchyCacheEntry: deleteBoardHierarchyCacheEntry,
    refreshBoardHierarchyCache: refreshBoardHierarchyCache,
    cardPreviewText: cardPreviewText,
    setActiveWorkspaceId: setActiveWorkspaceId,
    resolveActiveWorkspaceId: resolveActiveWorkspaceId,
    dispatchMirrorMouseEvent: dispatchMirrorMouseEvent,
    findCanonicalHierarchyTarget: findCanonicalHierarchyTarget,
    bindMirroredWorkspaceView: bindMirroredWorkspaceView,
    syncMirroredWorkspaceViews: syncMirroredWorkspaceViews,
    renderWorkspaceSelect: renderWorkspaceSelect,
    getBoardWorkspaceIds: getBoardWorkspaceIds,
    removeBoardFromSidebar: removeBoardFromSidebar,
    renderBoardList: renderBoardList,
    invalidateBoardListFingerprint: invalidateBoardListFingerprint
  };
})();
window.LexeraBoardList = LexeraBoardList;
