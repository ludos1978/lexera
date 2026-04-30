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

  function getSafeLocalStorage() {
    try {
      return (typeof localStorage !== 'undefined' && localStorage) ? localStorage : null;
    } catch (_) {
      return null;
    }
  }

  function readLocalStorageItem(key) {
    var storage = getSafeLocalStorage();
    if (!storage || typeof storage.getItem !== 'function') return null;
    return storage.getItem(key);
  }

  function writeLocalStorageItem(key, value) {
    var storage = getSafeLocalStorage();
    if (!storage || typeof storage.setItem !== 'function') return false;
    storage.setItem(key, value);
    return true;
  }

  function removeLocalStorageItem(key) {
    var storage = getSafeLocalStorage();
    if (!storage || typeof storage.removeItem !== 'function') return false;
    storage.removeItem(key);
    return true;
  }

  function getLocalStorageLength() {
    var storage = getSafeLocalStorage();
    return storage && typeof storage.length === 'number' ? storage.length : 0;
  }

  function getLocalStorageKey(index) {
    var storage = getSafeLocalStorage();
    if (!storage || typeof storage.key !== 'function') return null;
    return storage.key(index);
  }

  function patchActiveBoardData(updater) {
    if (typeof updater !== 'function') return _dep('activeBoardData');
    if (typeof _deps.updateActiveBoardData === 'function') {
      return _callDep('updateActiveBoardData', updater);
    }
    var currentBoardData = _dep('activeBoardData');
    if (!currentBoardData) return currentBoardData;
    var draftBoardData = Object.assign({}, currentBoardData);
    var nextBoardData = updater(draftBoardData, currentBoardData);
    if (typeof nextBoardData === 'undefined') nextBoardData = draftBoardData;
    if (nextBoardData === currentBoardData) nextBoardData = Object.assign({}, currentBoardData);
    if (typeof _deps.setActiveBoardData === 'function') _callDep('setActiveBoardData', nextBoardData);
    return nextBoardData;
  }

  function normalizeWorkspaceId(workspaceId) {
    return workspaceId || null;
  }

  function getWorkspaceViewId() {
    var viewWorkspaceId = _dep('viewWorkspaceId');
    if (viewWorkspaceId != null && viewWorkspaceId !== '') {
      return normalizeWorkspaceId(viewWorkspaceId);
    }
    return normalizeWorkspaceId(_dep('activeWorkspaceId'));
  }

  function getWorkspaceViewMode() {
    return _dep('workspaceViewMode') === 'manual' ? 'manual' : 'follow-active-board';
  }

  function setWorkspaceViewMode(mode) {
    if (typeof _deps.setWorkspaceViewModeState === 'function') {
      _deps.setWorkspaceViewModeState(mode === 'manual' ? 'manual' : 'follow-active-board');
    }
  }

  var _runtimeSubscriptionsBound = false;
  var _runtimeSubscriptions = [];
  var _scheduledRefresh = {
    workspace: false,
    list: false,
    mirrors: false,
    invalidate: false
  };
  var _scheduledRefreshToken = 0;

  function resetScheduledRefreshFlags() {
    _scheduledRefresh.workspace = false;
    _scheduledRefresh.list = false;
    _scheduledRefresh.mirrors = false;
    _scheduledRefresh.invalidate = false;
  }

  function flushScheduledRefresh() {
    _scheduledRefreshToken = 0;
    var shouldRefreshWorkspace = _scheduledRefresh.workspace;
    var shouldRefreshList = _scheduledRefresh.list;
    var shouldRefreshMirrors = _scheduledRefresh.mirrors;
    var shouldInvalidate = _scheduledRefresh.invalidate;
    resetScheduledRefreshFlags();
    if (shouldInvalidate) invalidateBoardListFingerprint();
    if (shouldRefreshWorkspace) refreshWorkspaceMirrors();
    if (shouldRefreshList) renderBoardList();
    else if (!shouldRefreshWorkspace && shouldRefreshMirrors) syncMirroredWorkspaceViews();
  }

  function scheduleDistributedRefresh(options) {
    options = options || {};
    if (options.workspace) _scheduledRefresh.workspace = true;
    if (options.list) _scheduledRefresh.list = true;
    if (options.mirrors) _scheduledRefresh.mirrors = true;
    if (options.invalidate) _scheduledRefresh.invalidate = true;
    if (_scheduledRefreshToken) return;
    var flush = function () { flushScheduledRefresh(); };
    if (typeof requestAnimationFrame === 'function') {
      _scheduledRefreshToken = requestAnimationFrame(flush);
      return;
    }
    _scheduledRefreshToken = setTimeout(flush, 0);
  }

  function bindRuntimeSubscriptions() {
    if (_runtimeSubscriptionsBound || !_rt) return;
    _runtimeSubscriptionsBound = true;
    _runtimeSubscriptions.push(_rt.onStateChange('boards', function () {
      reconcileActiveWorkspaceContext({ render: false });
      scheduleDistributedRefresh({ list: true });
    }));
    _runtimeSubscriptions.push(_rt.onStateChange('remoteBoards', function () {
      reconcileActiveWorkspaceContext({ render: false });
      scheduleDistributedRefresh({ list: true });
    }));
    _runtimeSubscriptions.push(_rt.onStateChange('workspaces', function () {
      reconcileActiveWorkspaceContext({ render: false });
      scheduleDistributedRefresh({ workspace: true, list: true });
    }));
    _runtimeSubscriptions.push(_rt.onStateChange('activeWorkspaceId', function () {
      scheduleDistributedRefresh({ workspace: true, list: true });
    }));
    _runtimeSubscriptions.push(_rt.onStateChange('viewWorkspaceId', function () {
      scheduleDistributedRefresh({ workspace: true, list: true });
    }));
    _runtimeSubscriptions.push(_rt.onStateChange('activeBoardId', function () {
      reconcileActiveWorkspaceContext({ render: false });
      scheduleDistributedRefresh({ list: true });
    }));
    _runtimeSubscriptions.push(_rt.on('boardHierarchyProjection:changed', function (detail) {
      if (detail && detail.mirrorsOnly) {
        scheduleDistributedRefresh({ mirrors: true });
        return;
      }
      scheduleDistributedRefresh({ list: true, invalidate: true });
    }));
  }

  function emitHierarchyProjectionChanged(detail) {
    if (_rt) _rt.emit('boardHierarchyProjection:changed', detail || {});
  }

  // ─── Sidebar expanded boards ──────────────────────────────────────

  function getSidebarExpandedBoards() {
    if (_Settings) return _Settings.get('sidebarExpanded') || [];
    try { return JSON.parse(readLocalStorageItem('lexera-sidebar-expanded') || '[]'); } catch (e) {
      logFrontendIssue('warn', 'sidebar.state', 'Failed to read expanded sidebar boards', e);
      return [];
    }
  }
  function saveSidebarExpandedBoards(ids) {
    if (_Settings) { _Settings.set('sidebarExpanded', ids); return; }
    writeLocalStorageItem('lexera-sidebar-expanded', JSON.stringify(ids));
  }

  // ─── Sidebar tree state ───────────────────────────────────────────

  function getSidebarTreeState(boardId) {
    try {
      var all = _Settings ? (_Settings.get('sidebarTreeState') || {}) : JSON.parse(readLocalStorageItem('lexera-sidebar-tree-state') || '{}');
      return all[boardId] || { rows: [], stacks: [], columns: [] };
    } catch (e) {
      logFrontendIssue('warn', 'sidebar.tree', 'Failed to read sidebar tree state for board ' + boardId, e);
      return { rows: [], stacks: [], columns: [] };
    }
  }

  function hasSidebarTreeState(boardId) {
    try {
      var all = _Settings ? (_Settings.get('sidebarTreeState') || {}) : JSON.parse(readLocalStorageItem('lexera-sidebar-tree-state') || '{}');
      return Object.prototype.hasOwnProperty.call(all, boardId);
    } catch (e) {
      logFrontendIssue('warn', 'sidebar.tree', 'Failed to check sidebar tree state for board ' + boardId, e);
      return false;
    }
  }

  function saveSidebarTreeState(boardId, state) {
    try {
      var all = _Settings ? (_Settings.get('sidebarTreeState') || {}) : JSON.parse(readLocalStorageItem('lexera-sidebar-tree-state') || '{}');
      all[boardId] = state;
      if (_Settings) { _Settings.set('sidebarTreeState', all); }
      else { writeLocalStorageItem('lexera-sidebar-tree-state', JSON.stringify(all)); }
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
        else { writeLocalStorageItem(boardDraftStorageKey(boardId), JSON.stringify(draftPayload)); }
      } catch (err) {
        logFrontendIssue('warn', 'board.draft.save', 'Failed to persist local board draft', err);
      }
    }, 500);
  }

  function cancelPendingDraftSave() {
    if (_draftSaveTimer) { clearTimeout(_draftSaveTimer); _draftSaveTimer = null; }
  }

  function loadLocalBoardDraft(boardId) {
    if (!boardId) return null;
    try {
      if (_Settings) {
        var parsed = _Settings.getForBoard('boardDraft', boardId);
        return parsed && parsed.board ? parsed : null;
      }
      var raw = readLocalStorageItem(boardDraftStorageKey(boardId));
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
      removeLocalStorageItem(boardDraftStorageKey(boardId));
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
      for (var k = 0; k < getLocalStorageLength(); k++) {
        var key = getLocalStorageKey(k);
        if (key && key.indexOf(PREFIX) === 0) {
          var draftBoardId = key.slice(PREFIX.length);
          if (!idSet[draftBoardId]) keysToRemove.push(key);
        }
      }
      for (var j = 0; j < keysToRemove.length; j++) {
        var pruneBoardId = keysToRemove[j].slice(PREFIX.length);
        if (_Settings) { _Settings.removeForBoard('boardDraft', pruneBoardId); }
        else { removeLocalStorageItem(keysToRemove[j]); }
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
    return setBoardSaveBase(savedBoard, savedBoard);
  }

  function resolveLiveSyncBoardData(boardData, boardId) {
    if (!boardData) return null;
    _callDep('ensureBoardRowsForMutation', boardData, _callDep('getMutationBoardTitle', boardId, boardData));
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
    patchActiveBoardData(function (nextBoardData) {
      delete nextBoardData.version;
      delete nextBoardData.revision;
    });
    _callDep('updateDisplayFromFullBoard');
    if (options.skipRender) {
      _deps.commitLocalBoardChange(boardId, fullBoardData, {
        setLocalState: false,
        refreshHierarchy: true
      });
      return;
    }
    _callDep('applyBoardSettings');

    // Targeted refresh pipeline — three levels of specificity, each
    // falls through to the next. The rule: a full board render should
    // only ever happen on initial board load. Live-sync snapshots must
    // always diff and use targeted refresh, even for structural changes,
    // so Miro iframes and untouched card DOM survive the update.
    var didTargetedRefresh = false;
    if (!options.refreshMainView && oldBoardForDelta && fullBoardData) {
      var BoardDelta = (typeof globalThis !== 'undefined' && globalThis.LexeraBoardDelta) ? globalThis.LexeraBoardDelta : null;
      if (BoardDelta) {
        var liveSyncDelta = BoardDelta.computeBoardDelta(oldBoardForDelta, fullBoardData);
        // Level 1 (fastest): per-card content update for card-content-only
        // deltas. Tries to minimize DOM churn even further than our generic
        // target handlers by updating just the .card-content innerHTML.
        if (isDeltaCardContentOnly(liveSyncDelta)) {
          didTargetedRefresh = tryIncrementalCardUpdate(liveSyncDelta, fullBoardData);
        }
        // Level 2: generic deltaToTargets path. Covers card add/remove,
        // column/stack/row title changes, etc. Computes against the PRE-
        // delta activeBoardData (which we cached in oldBoardForDelta) so
        // index lookups are stable.
        if (!didTargetedRefresh && typeof BoardDelta.deltaToTargets === 'function') {
          try {
            // Build a temporary active-like view from oldBoardForDelta so
            // deltaToTargets can resolve ids → positions against the
            // pre-apply state. updateDisplayFromFullBoard() has already
            // run above, updating the real activeBoardData to the new
            // state; but position lookups must match what the DOM has
            // right now, which is the old state.
            var prevActiveLike = _dep('activeBoardData');
            var lsTargets = BoardDelta.deltaToTargets(liveSyncDelta, prevActiveLike);
            if (lsTargets && lsTargets.length > 0) {
              _callDep('refreshTargetedElements', lsTargets);
              didTargetedRefresh = true;
            }
          } catch (_) { /* fall through */ }
        }
      }
    }
    if (!didTargetedRefresh) {
      // Level 3 (slow fallback): full board render. Should only happen
      // on structural deltas our helper can't express (row add/remove,
      // board settings changes) or the very first render of a board.
      // Every hit here is a performance bug worth investigating.
      _callDep('refreshTargetedElements', [{ type: 'board' }]);
    }
    _deps.commitLocalBoardChange(boardId, fullBoardData, {
      setLocalState: false,
      refreshHierarchy: true
    });
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
    setBoardSaveBase(fullBoardData, currentBoard || workingBoard);
    _callDep('setPendingExternalRebaseConflict', null);
    if (result) {
      patchActiveBoardData(function (nextBoardData) {
        if (typeof result.version === 'number') nextBoardData.version = result.version;
        if (result.revision) nextBoardData.revision = result.revision;
      });
    }
    if (result && typeof result.generation === 'number') {
      _callDep('setLastLoadedGeneration', result.generation);
    }
    _callDep('setLastLoadedRevision', result && result.revision ? result.revision : _dep('_lastLoadedRevision'));
    _callDep('updateDisplayFromFullBoard');
    _deps.commitLocalBoardChange(boardId, fullBoardData, {
      setLocalState: false,
      refreshHierarchy: true,
      revision: result && result.revision ? result.revision : null
    });
    _callDep('applyBoardSettings');
    _callDep('refreshTargetedElements', [{ type: 'board' }]);
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

  function rowsForBoardData(fullBoard) {
    if (fullBoard && fullBoard.rows && fullBoard.rows.length > 0) {
      return cloneRows(fullBoard.rows);
    }
    return [];
  }

  // ─── Board hierarchy cache ────────────────────────────────────────

  var boardHierarchyCache = {};
  var boardHierarchyInflight = {};
  var boardHierarchyProjectionVersion = 0;
  var BOARD_HIERARCHY_CACHE_STALE_MS = 60000;
  var BOARD_HIERARCHY_REFRESH_CONCURRENCY = 2;

  function bumpBoardHierarchyProjectionVersion() {
    boardHierarchyProjectionVersion += 1;
  }

  function setBoardHierarchyProjection(boardId, rows, options) {
    if (!boardId || _dep('embeddedMode')) return;
    options = options || {};
    boardHierarchyCache[boardId] = {
      rows: cloneRows(rows),
      updatedAt: Date.now(),
      revision: options.revision || null,
    };
    invalidateBoardListFingerprint();
    bumpBoardHierarchyProjectionVersion();
    if (options.emit !== false) {
      emitHierarchyProjectionChanged({
        boardId: boardId || null,
        mirrorsOnly: !!options.mirrorsOnly
      });
    }
  }

  function setBoardHierarchyRows(boardId, fullBoard, fallbackTitle, options) {
    return setBoardHierarchyProjection(boardId, rowsForBoardData(fullBoard), options);
  }

  function clearBoardHierarchyProjection(boardId, options) {
    if (!boardId) return;
    options = options || {};
    if (!boardHierarchyCache[boardId] && !boardHierarchyInflight[boardId]) return;
    delete boardHierarchyCache[boardId];
    delete boardHierarchyInflight[boardId];
    invalidateBoardListFingerprint();
    bumpBoardHierarchyProjectionVersion();
    if (options.emit !== false) {
      emitHierarchyProjectionChanged({ boardId: boardId || null, removed: true });
    }
  }

  function pruneBoardHierarchyCacheEntries(keep) {
    var cachedIds = Object.keys(boardHierarchyCache);
    var removed = false;
    for (var i = 0; i < cachedIds.length; i++) {
      if (keep[cachedIds[i]]) continue;
      clearBoardHierarchyProjection(cachedIds[i], { emit: false });
      removed = true;
    }
    return removed;
  }

  function getBoardHierarchyRows(boardId) {
    // Always prefer the cache — it's updated from the iframe's fullBoardData
    // via refreshBoardHierarchy. The activeBoardData in the parent window is
    // stale in workspace shell mode (boards load in iframes, not the parent).
    var cached = boardHierarchyCache[boardId];
    if (cached && cached.rows) return cached.rows;
    // Fallback: use activeBoardData only if no cache exists (non-workspace mode)
    var activeBoardId = _dep('activeBoardId');
    var activeBoardData = _dep('activeBoardData');
    if (boardId && boardId === activeBoardId && activeBoardData && activeBoardData.rows) {
      return activeBoardData.rows;
    }
    return null;
  }

  function deleteBoardHierarchyCacheEntry(boardId) {
    clearBoardHierarchyProjection(boardId);
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
      setBoardHierarchyProjection(
        boardMeta.id,
        rowsForBoardData(response || null),
        {
          revision: response && response.revision ? response.revision : null,
          emit: false
        }
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
      emitHierarchyProjectionChanged({ boardId: boardMeta.id, mirrorsOnly: true });
    }).catch(function (err) {
      lexeraLog('warn', '[hierarchy.cache] Failed to load board ' + boardMeta.id + ': ' + err.message);
    }).finally(function () {
      delete boardHierarchyInflight[boardMeta.id];
    });

    boardHierarchyInflight[boardMeta.id] = promise;
    return promise;
  }

  async function refreshBoardHierarchyCache(boardList) {
    if (_dep('embeddedMode')) return;
    var activeBoardId = _dep('activeBoardId');
    var fullBoardData = _dep('fullBoardData');
    var activeBoardData = _dep('activeBoardData');
    var LexeraApi = _dep('LexeraApi');
    var expandedIds = getSidebarExpandedBoards();
    var projectionChanged = false;
    var keep = {};
    for (var i = 0; i < boardList.length; i++) keep[boardList[i].id] = true;
    projectionChanged = pruneBoardHierarchyCacheEntries(keep) || projectionChanged;

    var tasks = [];
    for (var k = 0; k < boardList.length; k++) {
      (function (boardMeta) {
        if (
          boardMeta.id === activeBoardId &&
          fullBoardData &&
          activeBoardData &&
          activeBoardData.rows
        ) {
          setBoardHierarchyProjection(boardMeta.id, fullBoardData.rows, {
            revision: activeBoardData.revision || null,
            emit: false
          });
          projectionChanged = true;
          return;
        }
        if (!shouldHydrateBoardHierarchy(boardMeta, expandedIds, activeBoardId)) return;
        var cached = boardHierarchyCache[boardMeta.id];
        if (!shouldRefreshBoardHierarchyEntry(boardMeta, cached)) return;
        tasks.push(boardMeta);
      })(boardList[k]);
    }
    if (tasks.length === 0) {
      if (projectionChanged) emitHierarchyProjectionChanged({ boardId: activeBoardId || null });
      return;
    }

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
    if (projectionChanged) emitHierarchyProjectionChanged({ boardId: activeBoardId || null });
  }

  function refreshBoardHierarchyProjection(boardId, fullBoard, fallbackTitle, options) {
    if (_dep('embeddedMode')) return fullBoard || null;
    options = options || {};
    setBoardHierarchyProjection(boardId, rowsForBoardData(fullBoard), {
      revision: options.revision || null,
      emit: options.render !== false && options.emit !== false,
      mirrorsOnly: !!options.mirrorsOnly
    });
    if (options.render === false) return;
    if (_rt) return;
    renderBoardList();
  }

  function cardPreviewText(content) {
    return _callDep('getSidebarTreeApi').cardPreviewText(content);
  }

  // ─── Workspace helpers ────────────────────────────────────────────

  function findBoardMetaById(boardId) {
    if (!boardId) return null;
    var groups = [_dep('boards') || [], _dep('remoteBoards') || []];
    for (var g = 0; g < groups.length; g++) {
      var list = groups[g];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === boardId) return list[i];
      }
    }
    return null;
  }

  function resolveWorkspaceContextForBoard(boardId, options) {
    options = options || {};
    var viewWorkspaceId = getWorkspaceViewId();
    var activeWorkspaceId = normalizeWorkspaceId(_dep('activeWorkspaceId'));
    var boardMeta = findBoardMetaById(boardId);
    var workspaceIds = boardMeta ? getBoardWorkspaceIds(boardMeta) : [];
    var nextWorkspaceId = viewWorkspaceId;
    var preferredWorkspaceId = normalizeWorkspaceId(options.preferredWorkspaceId);

    if (workspaceIds.length > 0) {
      if (preferredWorkspaceId && workspaceIds.indexOf(preferredWorkspaceId) >= 0) {
        nextWorkspaceId = preferredWorkspaceId;
      } else if (viewWorkspaceId && workspaceIds.indexOf(viewWorkspaceId) >= 0) {
        nextWorkspaceId = viewWorkspaceId;
      } else if (activeWorkspaceId && workspaceIds.indexOf(activeWorkspaceId) >= 0) {
        nextWorkspaceId = activeWorkspaceId;
      } else {
        nextWorkspaceId = workspaceIds[0];
      }
    } else if (boardMeta) {
      nextWorkspaceId = null;
    }

    return {
      boardId: boardId || null,
      board: boardMeta,
      workspaceIds: workspaceIds,
      workspaceId: nextWorkspaceId
    };
  }

  function setActiveWorkspaceId(workspaceId) {
    // Per-window in-memory state ONLY — never persist to the shared
    // Settings store. Each window owns exactly one workspace for its
    // lifetime; persisting the choice would broadcast a `storage`
    // event into sibling windows and yank their view to this
    // workspace.
    var normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    setWorkspaceViewMode('follow-active-board');
    if (typeof _deps.setViewWorkspaceIdState === 'function') {
      _deps.setViewWorkspaceIdState(normalizedWorkspaceId);
    }
    _callDep('setActiveWorkspaceIdState', normalizedWorkspaceId, { syncView: true });
  }

  function setWorkspaceViewId(workspaceId, options) {
    options = options || {};
    var normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    setWorkspaceViewMode(options.mode === 'manual' ? 'manual' : 'follow-active-board');
    if (typeof _deps.setViewWorkspaceIdState === 'function') {
      _deps.setViewWorkspaceIdState(normalizedWorkspaceId);
      return normalizedWorkspaceId;
    }
    setActiveWorkspaceId(normalizedWorkspaceId);
    return normalizedWorkspaceId;
  }

  function isWorkspaceViewIdKnown(workspaceId) {
    var normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!normalizedWorkspaceId) return false;
    var workspaces = Array.isArray(_dep('workspaces')) ? _dep('workspaces') : [];
    for (var i = 0; i < workspaces.length; i++) {
      if (workspaces[i] && workspaces[i].id === normalizedWorkspaceId) return true;
    }
    return false;
  }

  function syncWorkspaceContextForBoard(boardId, options) {
    options = options || {};
    var context = resolveWorkspaceContextForBoard(boardId, options);
    var preserveManualView = options.preserveManualView === true && getWorkspaceViewMode() === 'manual';
    var nextViewWorkspaceId = context.workspaceId;
    var nextViewMode = 'follow-active-board';
    if (preserveManualView) {
      var manualWorkspaceId = getWorkspaceViewId();
      if (isWorkspaceViewIdKnown(manualWorkspaceId)) {
        nextViewWorkspaceId = manualWorkspaceId;
        nextViewMode = 'manual';
      }
    }
    if (
      options.syncSelection !== false &&
      normalizeWorkspaceId(_dep('activeWorkspaceId')) !== context.workspaceId
    ) {
      // Per-window state only — see setActiveWorkspaceId for why
      // persisting via Settings would leak into sibling windows.
      _callDep('setActiveWorkspaceIdState', context.workspaceId, { syncView: !preserveManualView });
    }
    if (typeof _deps.setViewWorkspaceIdState === 'function') {
      _deps.setViewWorkspaceIdState(nextViewWorkspaceId);
    }
    setWorkspaceViewMode(nextViewMode);
    if (options.render === false) return context;
    if (!_rt) {
      refreshWorkspaceMirrors();
      renderBoardList();
    }
    return context;
  }

  function reconcileActiveWorkspaceContext(options) {
    options = options || {};
    var activeBoardId = _dep('activeBoardId');
    if (!activeBoardId) {
      var workspaceId = getWorkspaceViewId();
      if (typeof _deps.setViewWorkspaceIdState === 'function') {
        _deps.setViewWorkspaceIdState(workspaceId);
      }
      return {
        boardId: null,
        board: null,
        workspaceIds: [],
        workspaceId: workspaceId
      };
    }
    if (options.preserveManualView !== false) options.preserveManualView = true;
    return syncWorkspaceContextForBoard(activeBoardId, options);
  }

  function resolveActiveWorkspaceId(defaultWorkspaceId) {
    var activeWorkspaceId = _dep('activeWorkspaceId');
    var workspaces = _dep('workspaces');
    var knownWorkspaceIds = workspaces.map(function (ws) { return ws.id; });
    if (activeWorkspaceId && knownWorkspaceIds.indexOf(activeWorkspaceId) >= 0) return;
    if (defaultWorkspaceId && knownWorkspaceIds.indexOf(defaultWorkspaceId) >= 0) {
      setActiveWorkspaceId(defaultWorkspaceId);
      return;
    }
    if (knownWorkspaceIds.length > 0) {
      setActiveWorkspaceId(knownWorkspaceIds[0]);
      return;
    }
    // No workspaces yet — leave the active id unset; setWorkspacesState
    // will pick a default once the catalog hydrates.
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
    var anyTreeNode = sourceTarget.closest('.tree-node');
    var boardRow = sourceTarget.closest('.board-item[data-board-id]');
    if (sourceTarget.closest('.board-item-ws-menu') && boardRow) {
      return boardList.querySelector('.board-item[data-board-id="' + boardRow.getAttribute('data-board-id') + '"] .board-item-ws-menu');
    }
    if (sourceTarget.closest('.board-item-toggle') && boardRow) {
      return boardList.querySelector('.board-item[data-board-id="' + boardRow.getAttribute('data-board-id') + '"] .board-item-toggle');
    }
    if (sourceTarget.closest('.tree-toggle') && treeNode) {
      return boardList.querySelector('.tree-node[data-tree-id="' + treeNode.getAttribute('data-tree-id') + '"] .tree-toggle');
    }
    if (sourceTarget.closest('.tree-menu-btn') && treeNode) {
      return boardList.querySelector('.tree-node[data-tree-id="' + treeNode.getAttribute('data-tree-id') + '"] .tree-menu-btn');
    }
    // Card tree-nodes lack data-tree-id — resolve via data-card-id or index attrs
    if (sourceTarget.closest('.tree-menu-btn') && anyTreeNode && !treeNode) {
      var resolved = _resolveCanonicalTreeNodeByAttrs(boardList, anyTreeNode);
      if (resolved) {
        var resolvedBtn = resolved.querySelector('.tree-menu-btn');
        if (resolvedBtn) return resolvedBtn;
      }
    }
    if (treeNode) {
      return boardList.querySelector('.tree-node[data-tree-id="' + treeNode.getAttribute('data-tree-id') + '"]');
    }
    // Tree-nodes without data-tree-id (cards) — resolve via attrs
    if (anyTreeNode && !treeNode) {
      return _resolveCanonicalTreeNodeByAttrs(boardList, anyTreeNode);
    }
    if (boardRow) {
      return boardList.querySelector('.board-item[data-board-id="' + boardRow.getAttribute('data-board-id') + '"]');
    }
    return null;
  }

  function _resolveCanonicalTreeNodeByAttrs(boardList, mirrorNode) {
    var cardId = mirrorNode.getAttribute('data-card-id');
    var boardId = mirrorNode.getAttribute('data-board-id');
    // Prefer data-card-id lookup (unique within a board)
    if (cardId && boardId) {
      var byCardId = boardList.querySelector('.board-item[data-board-id="' + boardId + '"] .tree-node[data-card-id="' + cardId + '"]');
      if (byCardId) return byCardId;
    }
    // Fall back to col-index + card-index within the board
    var colIndex = mirrorNode.getAttribute('data-col-index');
    var cardIndex = mirrorNode.getAttribute('data-card-index');
    if (colIndex != null && cardIndex != null && boardId) {
      var byIndex = boardList.querySelector(
        '.board-item[data-board-id="' + boardId + '"] .tree-node[data-col-index="' + colIndex + '"][data-card-index="' + cardIndex + '"]'
      );
      if (byIndex) return byIndex;
    }
    return null;
  }

  function bindMirroredWorkspaceView(rootEl) {
    if (!rootEl || rootEl.__lexeraWorkspaceMirrorBound) return;
    rootEl.__lexeraWorkspaceMirrorBound = true;
    ensureGlobalWsMenuGuard();

    rootEl.addEventListener('click', function (e) {
      var menuBtn = e.target.closest('.lexera-shared-workspace-menu');
      if (menuBtn) {
        e.preventDefault();
        e.stopPropagation();
        _callDep('showSidebarHierarchyMenu', menuBtn);
        return;
      }
      // Board burger menu — handle locally in the mirror (avoid re-dispatching
      // a canonical click, which would trigger unrelated focus/board-select
      // side effects like ws-shell.boardChange).
      var wsMenuBtn = e.target.closest('.board-item-ws-menu');
      if (wsMenuBtn) {
        e.preventDefault();
        e.stopPropagation();
        var mirrorRow = wsMenuBtn.closest('.board-item[data-board-id]');
        var mirrorWrap = wsMenuBtn.closest('.board-item-wrapper');
        if (!mirrorRow || !mirrorWrap) return;
        var mirrorBoardId = mirrorRow.getAttribute('data-board-id') || '';
        var mirrorWsId = mirrorWrap.getAttribute('data-workspace-id') || '';
        if (!mirrorBoardId) return;
        var rect = wsMenuBtn.getBoundingClientRect();
        showBoardActionsMenuFor(mirrorBoardId, mirrorWsId, rect.right, rect.bottom);
        return;
      }
      var canonicalTarget = findCanonicalHierarchyTarget(e.target);
      if (!canonicalTarget) return;
      e.preventDefault();
      e.stopPropagation();
      dispatchMirrorMouseEvent(canonicalTarget, 'click', e);
    });

    rootEl.addEventListener('contextmenu', function (e) {
      // Board row right-click — handle locally with the same menu as the burger.
      var mirrorRightRow = e.target.closest('.board-item[data-board-id]');
      if (mirrorRightRow && !mirrorRightRow.classList.contains('remote-board') &&
          !e.target.closest('.board-item-toggle') &&
          !e.target.closest('.tree-grip') &&
          !e.target.closest('.tree-toggle')) {
        var mirrorRightWrap = mirrorRightRow.closest('.board-item-wrapper');
        var rightBoardId = mirrorRightRow.getAttribute('data-board-id') || '';
        var rightWsId = mirrorRightWrap ? (mirrorRightWrap.getAttribute('data-workspace-id') || '') : '';
        if (rightBoardId) {
          e.preventDefault();
          e.stopPropagation();
          showBoardActionsMenuFor(rightBoardId, rightWsId, e.clientX, e.clientY);
          return;
        }
      }
      var canonicalTarget = findCanonicalHierarchyTarget(e.target);
      if (!canonicalTarget) return;
      e.preventDefault();
      e.stopPropagation();
      dispatchMirrorMouseEvent(canonicalTarget, 'contextmenu', e);
    });

    rootEl.addEventListener('dblclick', function (e) {
      if (e.target.closest('.tree-toggle') ||
          e.target.closest('.tree-grip') ||
          e.target.closest('.tree-menu-btn')) {
        return;
      }
      var mirrorNode = e.target.closest('.tree-node[data-board-id]');
      if (!mirrorNode) {
        var mirrorBoardRow = e.target.closest('.board-item.tree-board[data-board-id]');
        if (mirrorBoardRow && !mirrorBoardRow.classList.contains('remote-board')) {
          if (!e.target.closest('.board-item-title')) return;
          mirrorNode = mirrorBoardRow;
        }
      }
      if (!mirrorNode) return;
      var boardId = String(mirrorNode.getAttribute('data-board-id') || '').trim();
      if (!boardId) return;
      e.preventDefault();
      e.stopPropagation();
      beginHierarchyNodeInlineEdit(mirrorNode, boardId).then(function (handled) {
        if (handled) return;
        var canonicalTarget = findCanonicalHierarchyTarget(mirrorNode);
        if (!canonicalTarget) return;
        dispatchMirrorMouseEvent(canonicalTarget, 'dblclick', e);
      }).catch(function (err) {
        logFrontendIssue('warn', 'sidebar.mirror-dblclick-edit', 'Failed to start mirrored hierarchy edit', err);
      });
    });
  }

  function isMirrorRootVisible(rootEl) {
    return rootEl.offsetParent !== null;
  }

  function getWorkspaceHeaderState() {
    var viewWorkspaceId = getWorkspaceViewId();
    if (!viewWorkspaceId) return { label: 'Workspace' };
    var workspaces = Array.isArray(_dep('workspaces')) ? _dep('workspaces') : [];
    for (var i = 0; i < workspaces.length; i++) {
      var workspace = workspaces[i];
      if (!workspace || workspace.id !== viewWorkspaceId) continue;
      return { label: String(workspace.name || 'Untitled Workspace') };
    }
    return { label: 'Workspace' };
  }

  function renderWorkspaceHeaderTitle(titleEl, state) {
    if (!titleEl) return;
    state = state || { label: 'Workspace' };
    titleEl.textContent = '';
    titleEl.setAttribute('title', state.label || 'Workspace');
    var textEl = document.createElement('span');
    textEl.className = 'sidebar-header-title-text';
    textEl.textContent = state.label || 'Workspace';
    titleEl.appendChild(textEl);
  }

  function syncWorkspaceHeaderTitles() {
    var state = getWorkspaceHeaderState();
    var titleEl = document.getElementById('workspace-header-title');
    if (titleEl) {
      renderWorkspaceHeaderTitle(titleEl, state);
    }
    var mirroredTitles = document.querySelectorAll('.lexera-shared-workspace-title');
    for (var i = 0; i < mirroredTitles.length; i++) {
      renderWorkspaceHeaderTitle(mirroredTitles[i], state);
    }
  }

  function syncMirroredWorkspaceViews() {
    var workspaceRoots = _callDep('getSharedPanelRoots', 'hierarchy');
    var normalizedWorkspaceRoots = Array.isArray(workspaceRoots) ? workspaceRoots : [];
    var workspaceRootCount = normalizedWorkspaceRoots.length;
    syncWorkspaceHeaderTitles();
    if (!workspaceRootCount) return;
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
      var boardListEl = rootEl.querySelector('.lexera-shared-board-list');
      if (boardListEl && canonicalBoardList) {
        boardListEl.innerHTML = canonicalBoardList.innerHTML;
      }
    }
  }

  // ─── Workspace header rendering ───────────────────────────────────

  function refreshWorkspaceMirrors() {
    resolveActiveWorkspaceId(null);
    syncMirroredWorkspaceViews();
  }

  function getBoardWorkspaceIds(board) {
    return board.workspace_ids || board.workspaceIds || (board.workspace_id || board.workspaceId ? [board.workspace_id || board.workspaceId] : []);
  }

  // ─── Remove board ─────────────────────────────────────────────────

  // Rule: pressing the .board-item-ws-menu burger never initiates a drag and
  // never activates the enclosing dock tabset. Must run at the document
  // capture phase so it fires before the workspace-shell root's pointerdown
  // listener (which would otherwise call notifyActiveBoardChanged()).
  var _globalWsMenuGuardBound = false;
  function ensureGlobalWsMenuGuard() {
    if (_globalWsMenuGuardBound || typeof document === 'undefined') return;
    _globalWsMenuGuardBound = true;
    function swallow(e) {
      var t = e.target;
      if (t && typeof t.closest === 'function' && t.closest('.board-item-ws-menu')) {
        e.stopPropagation();
        e.preventDefault();
      }
    }
    document.addEventListener('mousedown', swallow, true);
    document.addEventListener('pointerdown', swallow, true);
    document.addEventListener('dragstart', swallow, true);
  }

  function showBoardActionsMenuFor(boardId, wsId, x, y) {
    if (!boardId) return;
    var boards = _dep('boards') || [];
    var boardMeta = null;
    for (var i = 0; i < boards.length; i++) {
      if (String(boards[i].id) === String(boardId)) { boardMeta = boards[i]; break; }
    }
    var boardFilePath = boardMeta ? (boardMeta.filePath || '') : '';
    var canRemoveFromWs = !!(wsId && wsId !== '__unassigned__');
    var items = [
      { id: 'open-tab', label: 'Open / Focus Tab' },
      { id: 'detach', label: 'Open in Detached Window' },
      { separator: true },
      { id: 'backend-settings', label: 'Backend Settings' },
      { separator: true },
      { id: 'reveal', label: 'Reveal in Finder' }
    ];
    if (canRemoveFromWs) {
      items.push({ separator: true });
      items.push({ id: 'remove-from-ws', label: 'Remove board from workspace' });
    }
    _callDep('showNativeMenu', items, x, y).then(async function (action) {
      if (action === 'open-tab') {
        _callDep('selectBoard', boardId);
      } else if (action === 'detach') {
        if (_dep('hasTauri')) _callDep('tauriInvoke', 'open_new_window', { boardId: boardId, profile: 'detachedBoard' });
      } else if (action === 'backend-settings') {
        _callDep('openConnectionWindow');
      } else if (action === 'reveal' && boardFilePath) {
        _callDep('showInFinder', boardFilePath);
      } else if (action === 'remove-from-ws' && canRemoveFromWs) {
        await removeBoardFromWorkspace(boardId, wsId);
      }
    });
  }

  async function removeBoardFromWorkspace(boardId, wsId) {
    if (!boardId || !wsId || wsId === '__unassigned__') return false;
    var boards = _dep('boards') || [];
    var board = null;
    for (var i = 0; i < boards.length; i++) {
      if (String(boards[i].id) === String(boardId)) { board = boards[i]; break; }
    }
    if (!board) return false;
    var current = getBoardWorkspaceIds(board).slice();
    var next = current.filter(function (id) { return String(id) !== String(wsId); });
    if (next.length === current.length) return false;

    var LexeraApi = _dep('LexeraApi');
    try {
      await LexeraApi.request('/config/boards/' + encodeURIComponent(boardId) + '/workspaces', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_ids: next })
      });
    } catch (err) {
      lexeraLog('error', '[sidebar.remove-from-ws] Backend error: ' + (err && err.message ? err.message : err));
      _callDep('showNotification', 'Failed to remove board from workspace');
      _callDep('poll');
      return false;
    }
    board.workspace_ids = next;
    renderBoardList();
    _callDep('poll');
    return true;
  }

  async function removeBoardFromSidebar(boardId, boardName) {
    var cleanupOk = await _callDep('cleanupBoardBeforeSidebarClose', boardId);
    if (!cleanupOk) return false;
    if (!(await _callDep('showConfirmDialog', 'Remove "' + boardName + '" from sidebar?\n(The file will not be deleted.)'))) return false;

    var boards = _dep('boards');
    _callDep('setBoards', boards.filter(function (b) { return b.id !== boardId; }));
    clearBoardHierarchyProjection(boardId, { emit: false });
    var activeBoardId = _dep('activeBoardId');
    if (activeBoardId === boardId) {
      _callDep('setActiveBoardId', null);
      _callDep('setActiveBoardData', null);
      _callDep('setFullBoardData', null);
      if (_Settings) { _Settings.set('lastBoard', ''); }
      else { removeLocalStorageItem('lexera-last-board'); }
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

  function _buildRenderFingerprint(boards, remoteBoards, workspaces, workspaceViewId, activeBoardId) {
    var parts = [workspaceViewId || '', activeBoardId || ''];
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
    parts.push('|H|');
    parts.push(String(boardHierarchyProjectionVersion));
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
    var wsId = el.getAttribute('data-workspace-id');
    if (wsId) return 'ws:' + wsId;
    if (el.classList.contains('sidebar-section-divider')) return '__remote_divider__';
    var boardId = el.getAttribute('data-board-id');
    if (boardId && el.classList.contains('remote-board')) return 'remote:' + boardId;
    if (boardId) return 'board:' + boardId;
    return null;
  }

  /** Create a remote board element. */
  function _createRemoteBoardEl(rb, activeBoardId) {
    var rbEl = document.createElement('div');
    rbEl.className = 'board-item tree-node tree-board remote-board' + (rb.id === activeBoardId ? ' active' : '');
    rbEl.setAttribute('data-board-id', rb.id);
    rbEl.setAttribute('data-tree-depth', '0');
    rbEl.setAttribute('data-tree-node-role', 'leaf');
    rbEl.setAttribute('data-tree-structural-role', 'group');
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
        '<span class="tree-grip tree-grip-spacer" aria-hidden="true"></span>' +
      '</span>';
  }

  /** Create a board wrapper element with all sub-elements and event listeners. */
  function _createBoardWrapperEl(board, boardIndex, isExpanded, isActive, rows, totalCards, isWorkspaceChild, tv, SidebarSync, workspaceShellEnabled, WorkspaceShell, workspaceChildWsId) {
    var wrapper = document.createElement('div');
    wrapper.className = 'board-item-wrapper tree-view-host tree-view-host-compact' + (isWorkspaceChild ? ' board-item-wrapper-workspace-child' : '');
    wrapper.setAttribute('data-board-id', board.id);
    if (isWorkspaceChild) wrapper.setAttribute('data-workspace-child', 'true');
    if (workspaceChildWsId && workspaceChildWsId !== '__unassigned__') {
      wrapper.setAttribute('data-workspace-id', workspaceChildWsId);
    }

    var el = document.createElement('div');
    el.className = 'board-item tree-node tree-board' + (isActive ? ' active' : '');
    el.setAttribute('data-board-index', boardIndex.toString());
    el.setAttribute('data-board-id', board.id);
    el.setAttribute('data-tree-depth', '0');
    el.setAttribute('data-tree-structural-role', 'group');
    el.setAttribute('data-tree-node-role', rows.length > 0 ? 'branch' : 'leaf');

    _updateBoardItemContent(el, board, boardIndex, isExpanded, isActive, rows, totalCards, isWorkspaceChild, SidebarSync, workspaceChildWsId);

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
  function _updateBoardItemContent(el, board, boardIndex, isExpanded, isActive, rows, totalCards, isWorkspaceChild, SidebarSync, workspaceChildWsId) {
    var boardName = board.title || _callDep('getDisplayNameFromPath', board.filePath || '') || 'Untitled';
    var hasContent = rows.length > 0;
    var displayTitle = _callDep('escapeHtml', boardName);
    var boardPresenceCache = _dep('boardPresenceCache');
    var presenceCount = (boardPresenceCache[board.id] || []).length;
    var presenceBadge = '<span class="tree-meta-presence board-presence-badge' + (presenceCount > 0 ? '' : ' hidden') + '"' +
      (presenceCount > 0 ? (' title="' + presenceCount + ' user(s) online"') : '') + '>' +
      (presenceCount > 0 ? presenceCount : '') +
      '</span>';
    var locked = SidebarSync && SidebarSync.isHierarchyLocked();
    // Every board row shows the burger menu regardless of workspace membership.
    // The × remove-board button has been removed entirely — board deletion is
    // available through the burger menu / context menu instead.
    var actionButton = '<button class="tree-meta-action tree-menu-btn burger-menu-btn board-item-ws-menu' + (locked ? ' hidden' : '') + '" type="button" draggable="false" title="Board actions" aria-label="Board actions" aria-haspopup="menu"><span class="burger-lines" aria-hidden="true"></span></button>';
    var boardGrip = '<span class="tree-grip entity-drag-icon entity-drag-icon-board" title="Drag to reorder">' +
      _callDep('getCreationEntityDragIconSvg', 'board') +
      '</span>';

    if (isActive) { el.classList.add('active'); } else { el.classList.remove('active'); }
    el.setAttribute('data-board-index', boardIndex.toString());

    // Find the wrapper — may be el's direct parent or grandparent (if indent-group exists)
    var wrapper = el.closest('.board-item-wrapper');
    if (wrapper) {
      wrapper.classList.toggle('board-item-wrapper-workspace-child', !!isWorkspaceChild);
      if (isWorkspaceChild) {
        wrapper.setAttribute('data-workspace-child', 'true');
      } else {
        wrapper.removeAttribute('data-workspace-child');
      }
      // Expose workspace id for the burger menu handler. Unassigned boards
      // leave it empty — showBoardActionsMenuFor handles that (it just omits
      // the "Remove from workspace" item when wsId is empty or __unassigned__).
      if (workspaceChildWsId && workspaceChildWsId !== '__unassigned__') {
        wrapper.setAttribute('data-workspace-id', workspaceChildWsId);
      } else {
        wrapper.removeAttribute('data-workspace-id');
      }
    }

    if (hasContent) {
      el.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      el.setAttribute('data-tree-node-role', 'branch');
    } else {
      el.removeAttribute('aria-expanded');
      el.setAttribute('data-tree-node-role', 'leaf');
    }
    el.innerHTML =
      '<span class="tree-indent tree-indent-root" aria-hidden="true"></span>' +
      '<span class="tree-toggle board-item-toggle' + (isExpanded ? ' expanded' : '') + '"></span>' +
      '<span class="tree-label board-item-title"><span class="board-item-title-text">' + displayTitle + '</span></span>' +
      '<span class="tree-meta board-item-meta">' +
        presenceBadge +
        '<span class="tree-count board-item-count">' + totalCards + '</span>' +
        actionButton +
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
    var rowIdx = parseInt(node.getAttribute('data-row-index') || '', 10);
    var stackIdx = parseInt(node.getAttribute('data-stack-index') || '', 10);
    var colLocalIdx = parseInt(node.getAttribute('data-col-local-index') || '', 10);
    var colIdx = parseInt(node.getAttribute('data-col-index') || '', 10);
    var cardIdx = parseInt(node.getAttribute('data-card-index') || '', 10);
    var rowId = String(node.getAttribute('data-row-id') || '').trim();
    var stackId = String(node.getAttribute('data-stack-id') || '').trim();
    var columnId = String(node.getAttribute('data-column-id') || '').trim();
    var cardId = String(node.getAttribute('data-card-id') || '').trim();
    if (node.classList.contains('tree-board') && !node.classList.contains('remote-board')) {
      scope = 'board';
    } else if (node.classList.contains('tree-card')) {
      scope = 'card';
      ctx.colIndex = isNaN(colIdx) ? -1 : colIdx;
      ctx.cardIndex = isNaN(cardIdx) ? 0 : cardIdx;
      ctx.rowIdx = isNaN(rowIdx) ? 0 : rowIdx;
      ctx.stackIdx = isNaN(stackIdx) ? 0 : stackIdx;
      ctx.colLocalIdx = isNaN(colLocalIdx) ? 0 : colLocalIdx;
      if (rowId) ctx.rowId = rowId;
      if (stackId) ctx.stackId = stackId;
      if (columnId) ctx.columnId = columnId;
      if (cardId) ctx.cardId = cardId;
    } else if (node.classList.contains('tree-column')) {
      scope = 'column';
      ctx.colIndex = isNaN(colIdx) ? -1 : colIdx;
      ctx.rowIdx = isNaN(rowIdx) ? 0 : rowIdx;
      ctx.stackIdx = isNaN(stackIdx) ? 0 : stackIdx;
      ctx.colLocalIdx = isNaN(colLocalIdx) ? 0 : colLocalIdx;
      if (rowId) ctx.rowId = rowId;
      if (stackId) ctx.stackId = stackId;
      if (columnId) ctx.columnId = columnId;
    } else if (node.classList.contains('tree-stack')) {
      scope = 'stack';
      ctx.rowIdx = isNaN(rowIdx) ? 0 : rowIdx;
      ctx.stackIdx = isNaN(stackIdx) ? 0 : stackIdx;
      if (rowId) ctx.rowId = rowId;
      if (stackId) ctx.stackId = stackId;
    } else if (node.classList.contains('tree-row')) {
      scope = 'row';
      ctx.rowIdx = isNaN(rowIdx) ? 0 : rowIdx;
      if (rowId) ctx.rowId = rowId;
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

  function _getHierarchyControllerApi() {
    var api = _callDep('getHierarchyControllerApi');
    if (api) return api;
    if (typeof globalThis !== 'undefined' && globalThis.LexeraHierarchyController) {
      return globalThis.LexeraHierarchyController;
    }
    return null;
  }

  function _loadBoardDataForHierarchyEdit(boardId) {
    if (typeof _deps.loadBoardDataForMutation === 'function') {
      return Promise.resolve(_callDep('loadBoardDataForMutation', boardId));
    }
    if (boardId === _dep('activeBoardId') && _dep('fullBoardData')) {
      return Promise.resolve(_dep('fullBoardData'));
    }
    return Promise.resolve(null);
  }

  function _findBoardRowRef(boardData, ctx) {
    var rows = boardData && Array.isArray(boardData.rows) ? boardData.rows : [];
    var rowId = ctx && ctx.rowId ? String(ctx.rowId) : '';
    var rowIdx = ctx && typeof ctx.rowIdx === 'number' ? ctx.rowIdx : -1;
    var i;
    if (rowId) {
      for (i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].id != null && String(rows[i].id) === rowId) {
          return { row: rows[i], rowIdx: i };
        }
      }
    }
    if (rowIdx >= 0 && rowIdx < rows.length && rows[rowIdx]) {
      return { row: rows[rowIdx], rowIdx: rowIdx };
    }
    return null;
  }

  function _findBoardStackRef(boardData, ctx) {
    var rowRef = _findBoardRowRef(boardData, ctx);
    if (!rowRef || !rowRef.row) return null;
    var stacks = Array.isArray(rowRef.row.stacks) ? rowRef.row.stacks : [];
    var stackId = ctx && ctx.stackId ? String(ctx.stackId) : '';
    var stackIdx = ctx && typeof ctx.stackIdx === 'number' ? ctx.stackIdx : -1;
    var i;
    if (stackId) {
      for (i = 0; i < stacks.length; i++) {
        if (stacks[i] && stacks[i].id != null && String(stacks[i].id) === stackId) {
          return {
            row: rowRef.row,
            rowIdx: rowRef.rowIdx,
            stack: stacks[i],
            stackIdx: i
          };
        }
      }
    }
    if (stackIdx >= 0 && stackIdx < stacks.length && stacks[stackIdx]) {
      return {
        row: rowRef.row,
        rowIdx: rowRef.rowIdx,
        stack: stacks[stackIdx],
        stackIdx: stackIdx
      };
    }
    return null;
  }

  function _findBoardColumnRef(boardData, ctx) {
    var stackRef = _findBoardStackRef(boardData, ctx);
    var columnId = ctx && ctx.columnId ? String(ctx.columnId) : '';
    var colIndex = ctx && typeof ctx.colIndex === 'number' ? ctx.colIndex : -1;
    var colLocalIdx = ctx && typeof ctx.colLocalIdx === 'number' ? ctx.colLocalIdx : -1;
    var rows = boardData && Array.isArray(boardData.rows) ? boardData.rows : [];
    var ri;
    var si;
    var ci;

    if (columnId || colIndex >= 0) {
      for (ri = 0; ri < rows.length; ri++) {
        var row = rows[ri];
        var stacks = row && Array.isArray(row.stacks) ? row.stacks : [];
        for (si = 0; si < stacks.length; si++) {
          var stack = stacks[si];
          var columns = stack && Array.isArray(stack.columns) ? stack.columns : [];
          for (ci = 0; ci < columns.length; ci++) {
            var column = columns[ci];
            if (!column) continue;
            if (columnId && column.id != null && String(column.id) === columnId) {
              return {
                row: row,
                rowIdx: ri,
                stack: stack,
                stackIdx: si,
                column: column,
                colLocalIdx: ci
              };
            }
            if (!columnId && colIndex >= 0 && column.index === colIndex) {
              return {
                row: row,
                rowIdx: ri,
                stack: stack,
                stackIdx: si,
                column: column,
                colLocalIdx: ci
              };
            }
          }
        }
      }
    }

    if (!stackRef || !stackRef.stack) return null;
    var columnsInStack = Array.isArray(stackRef.stack.columns) ? stackRef.stack.columns : [];
    if (colLocalIdx >= 0 && colLocalIdx < columnsInStack.length && columnsInStack[colLocalIdx]) {
      return {
        row: stackRef.row,
        rowIdx: stackRef.rowIdx,
        stack: stackRef.stack,
        stackIdx: stackRef.stackIdx,
        column: columnsInStack[colLocalIdx],
        colLocalIdx: colLocalIdx
      };
    }
    return null;
  }

  function _isHiddenHierarchyCardContent(content) {
    var sidebarTreeApi = _callDep('getSidebarTreeApi');
    if (sidebarTreeApi && typeof sidebarTreeApi.isHiddenCard === 'function') {
      return sidebarTreeApi.isHiddenCard(content);
    }
    return /#hidden-internal-(?:deleted|archived|parked|incoming)\b|(^|\s)#hidden(\s|$)/.test(content || '');
  }

  function _findBoardCardRef(boardData, ctx) {
    var columnRef = _findBoardColumnRef(boardData, ctx);
    if (!columnRef || !columnRef.column) return null;
    var cards = Array.isArray(columnRef.column.cards) ? columnRef.column.cards : [];
    var cardId = ctx && ctx.cardId ? String(ctx.cardId) : '';
    var visibleCardIdx = ctx && typeof ctx.cardIndex === 'number' ? ctx.cardIndex : -1;
    var i;
    var visibleIdx = 0;

    if (cardId) {
      for (i = 0; i < cards.length; i++) {
        var byIdCard = cards[i];
        if (!byIdCard) continue;
        var isHiddenById = _isHiddenHierarchyCardContent(byIdCard.content);
        if (byIdCard.id != null && String(byIdCard.id) === cardId) {
          return {
            row: columnRef.row,
            rowIdx: columnRef.rowIdx,
            stack: columnRef.stack,
            stackIdx: columnRef.stackIdx,
            column: columnRef.column,
            colLocalIdx: columnRef.colLocalIdx,
            card: byIdCard,
            fullCardIdx: i,
            visibleCardIdx: isHiddenById ? -1 : visibleIdx
          };
        }
        if (!isHiddenById) visibleIdx++;
      }
    }

    if (visibleCardIdx >= 0) {
      visibleIdx = 0;
      for (i = 0; i < cards.length; i++) {
        var byVisibleCard = cards[i];
        if (!byVisibleCard || _isHiddenHierarchyCardContent(byVisibleCard.content)) continue;
        if (visibleIdx === visibleCardIdx) {
          return {
            row: columnRef.row,
            rowIdx: columnRef.rowIdx,
            stack: columnRef.stack,
            stackIdx: columnRef.stackIdx,
            column: columnRef.column,
            colLocalIdx: columnRef.colLocalIdx,
            card: byVisibleCard,
            fullCardIdx: i,
            visibleCardIdx: visibleIdx
          };
        }
        visibleIdx++;
      }
    }

    return null;
  }

  function _resolveHierarchyTreeEditSpec(boardData, node) {
    var result = _extractTreeNodeScopeCtx(node);
    if (!result) return null;
    var labelEl = node.querySelector('.tree-label');
    var initialDisplayValue = String(labelEl ? labelEl.textContent || '' : '');

    if (result.scope === 'board') {
      var boardTitle = boardData && boardData.title != null ? String(boardData.title) : initialDisplayValue;
      return {
        scope: 'board',
        initialValue: boardTitle,
        initialDisplayValue: initialDisplayValue,
        targets: [{ type: 'board' }, { type: 'sidebar' }],
        renderLabel: function (targetLabelEl, nextDisplayValue) {
          targetLabelEl.textContent = '';
          var titleTextEl = document.createElement('span');
          titleTextEl.className = 'board-item-title-text';
          titleTextEl.textContent = nextDisplayValue;
          targetLabelEl.appendChild(titleTextEl);
        },
        apply: function (nextValue) {
          boardData.title = nextValue;
        }
      };
    }

    if (result.scope === 'row') {
      var rowRef = _findBoardRowRef(boardData, result.ctx);
      if (!rowRef || !rowRef.row) return null;
      var rowTitle = rowRef.row.title || '';
      return {
        scope: 'row',
        initialValue: _callDep('stripHtmlComments', rowTitle),
        initialDisplayValue: initialDisplayValue,
        targets: [{ type: 'row', rowIndex: rowRef.rowIdx }, { type: 'sidebar' }],
        apply: function (nextValue) {
          rowRef.row.title = _callDep('rebuildTitleWithPreservedComments', nextValue, rowTitle);
        }
      };
    }

    if (result.scope === 'stack') {
      var stackRef = _findBoardStackRef(boardData, result.ctx);
      if (!stackRef || !stackRef.stack) return null;
      var stackTitle = stackRef.stack.title || '';
      return {
        scope: 'stack',
        initialValue: _callDep('stripHtmlComments', stackTitle),
        initialDisplayValue: initialDisplayValue,
        targets: [{ type: 'stack', rowIndex: stackRef.rowIdx, stackIndex: stackRef.stackIdx }, { type: 'sidebar' }],
        apply: function (nextValue) {
          stackRef.stack.title = _callDep('rebuildTitleWithPreservedComments', nextValue, stackTitle);
        }
      };
    }

    if (result.scope === 'column') {
      var columnRef = _findBoardColumnRef(boardData, result.ctx);
      if (!columnRef || !columnRef.column) return null;
      var column = columnRef.column;
      var columnTitle = column.title || '';
      return {
        scope: 'column',
        initialValue: _callDep('stripHtmlComments', columnTitle),
        initialDisplayValue: initialDisplayValue,
        targets: typeof column.index === 'number' && column.index >= 0
          ? [{ type: 'column', colIndex: column.index }, { type: 'sidebar' }]
          : [{ type: 'board' }, { type: 'sidebar' }],
        apply: function (nextValue) {
          column.title = _callDep('reconstructColumnTitle', nextValue, columnTitle);
        }
      };
    }

    if (result.scope === 'card') {
      var cardRef = _findBoardCardRef(boardData, result.ctx);
      if (!cardRef || !cardRef.card) return null;
      var initialContent = String(cardRef.card.content || '');
      var cardTargets =
        typeof cardRef.column.index === 'number' &&
        cardRef.column.index >= 0 &&
        typeof cardRef.visibleCardIdx === 'number' &&
        cardRef.visibleCardIdx >= 0
          ? [{ type: 'card', colIndex: cardRef.column.index, cardIndex: cardRef.visibleCardIdx }, { type: 'sidebar' }]
          : [{ type: 'board' }, { type: 'sidebar' }];
      return {
        scope: 'card',
        multiline: true,
        allowEmpty: true,
        autoResize: true,
        rows: 4,
        selectAll: false,
        commitKeys: ['Mod+Enter'],
        initialValue: initialContent,
        initialDisplayValue: initialDisplayValue,
        inputClassName: 'card-edit-input tree-inline-card-textarea',
        placeholder: 'Card content',
        targets: cardTargets,
        normalizeValue: function (nextValue) {
          return String(nextValue == null ? '' : nextValue).replace(/\r\n?/g, '\n');
        },
        getDisplayValue: function (nextValue) {
          return cardPreviewText(nextValue);
        },
        onStart: function (ctx) {
          if (ctx && ctx.input && typeof ctx.input.setSelectionRange === 'function') {
            var end = ctx.input.value.length;
            ctx.input.setSelectionRange(end, end);
          }
        },
        apply: function (nextValue) {
          cardRef.card.content = nextValue;
        }
      };
    }

    return null;
  }

  function beginHierarchyNodeInlineEdit(node, boardId) {
    var controller = _getHierarchyControllerApi();
    if (!node || !boardId || !controller || typeof controller.beginInlineLabelEdit !== 'function') {
      return Promise.resolve(false);
    }

    var scope = _extractTreeNodeScopeCtx(node);
    if (!scope) {
      return Promise.resolve(false);
    }

    return _loadBoardDataForHierarchyEdit(boardId).then(function (boardData) {
      if (!boardData) return false;
      var spec = _resolveHierarchyTreeEditSpec(boardData, node);
      if (!spec) return false;

      controller.beginInlineLabelEdit(node, {
        initialValue: spec.initialValue,
        initialDisplayValue: spec.initialDisplayValue,
        multiline: spec.multiline === true,
        allowEmpty: spec.allowEmpty === true,
        autoResize: spec.autoResize !== false,
        rows: spec.rows,
        selectAll: spec.selectAll,
        commitKeys: spec.commitKeys,
        placeholder: spec.placeholder,
        inputClassName: spec.inputClassName || 'column-rename-input tree-inline-rename-input',
        normalizeValue: spec.normalizeValue,
        getDisplayValue: spec.getDisplayValue,
        renderLabel: spec.renderLabel,
        onStart: spec.onStart,
        onCommit: function (nextValue, ctx) {
          try {
            if (boardId === _dep('activeBoardId') && typeof _deps.pushUndo === 'function') {
              _callDep('pushUndo');
            }
            spec.apply(nextValue);
          } catch (err) {
            logFrontendIssue('warn', 'sidebar.hierarchy-inline-edit', 'Failed to apply hierarchy inline edit', err);
            return false;
          }
          if (typeof _deps.commitHierarchyTreeEdit !== 'function') return false;
          return Promise.resolve(_callDep('commitHierarchyTreeEdit', boardId, boardData, {
            targets: spec.targets
          })).then(function (saved) {
            if (saved === false) {
              ctx.restoreOriginal();
              _callDep('showNotification', 'Failed to update hierarchy item');
              return false;
            }
            return true;
          }).catch(function (err) {
            logFrontendIssue('warn', 'sidebar.hierarchy-inline-edit', 'Failed to persist hierarchy inline edit', err);
            ctx.restoreOriginal();
            _callDep('showNotification', 'Failed to update hierarchy item');
            return false;
          });
        },
        onError: function (err) {
          logFrontendIssue('warn', 'sidebar.hierarchy-inline-edit', 'Hierarchy inline edit failed', err);
          _callDep('showNotification', 'Failed to update hierarchy item');
        }
      });

      return true;
    }).catch(function (err) {
      logFrontendIssue('warn', 'sidebar.hierarchy-inline-edit', 'Failed to load board data for hierarchy edit', err);
      _callDep('showNotification', 'Failed to edit hierarchy item');
      return false;
    });
  }

  function _bindBoardTreeInteractions(treeEl, boardId, workspaceShellEnabled, WorkspaceShell) {
    var controller = _getHierarchyControllerApi();
    if (!controller || typeof controller.bindTreeInteractions !== 'function') return false;

    controller.bindTreeInteractions(treeEl, {
      TreeView: _dep('TreeView'),
      getNodeChildrenContainer: function (node) {
        return getSidebarTreeChildrenContainer(node);
      },
      onNodeMenu: function (node, event) {
        if (!node) return;
        var target = event && event.target && typeof event.target.closest === 'function'
          ? event.target.closest('.tree-menu-btn')
          : null;
        var anchorRect = target && typeof target.getBoundingClientRect === 'function'
          ? target.getBoundingClientRect()
          : { right: event.clientX, bottom: event.clientY };
        _showTreeNodeContextMenu(boardId, node, anchorRect.right, anchorRect.bottom, workspaceShellEnabled, WorkspaceShell);
      },
      onNodeToggle: function (node, event, helpers) {
        if (!node) return null;
        var children = helpers && typeof helpers.getNodeChildrenContainer === 'function'
          ? helpers.getNodeChildrenContainer(node)
          : null;
        if (!children) return null;
        if (event.altKey) {
          var childNodes = children.querySelectorAll('.tree-children');
          var allCollapsed = true;
          for (var ci = 0; ci < childNodes.length; ci++) {
            if (childNodes[ci].classList.contains('expanded')) { allCollapsed = false; break; }
          }
          setDescendantTreeState(children, allCollapsed, boardId);
          return allCollapsed;
        }
        var toggle = event && event.target && typeof event.target.closest === 'function'
          ? event.target.closest('.tree-toggle')
          : null;
        var expanding = !children.classList.contains('expanded');
        children.classList.toggle('expanded');
        if (toggle) toggle.classList.toggle('expanded');
        node.setAttribute('aria-expanded', expanding ? 'true' : 'false');
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
        return expanding;
      },
      onNodeActivate: function (node) {
        if (!node) return;
        var navTarget = _callDep('buildHierarchyFocusTargetFromTreeNode', node, boardId);
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
      },
      onNodeContextMenu: function (node, event) {
        if (!node) return;
        _showTreeNodeContextMenu(boardId, node, event.clientX, event.clientY, workspaceShellEnabled, WorkspaceShell);
      },
      onNodeEdit: function (node) {
        if (!node) return;
        beginHierarchyNodeInlineEdit(node, boardId).then(function (handled) {
          if (handled) return;
          var editTarget = _callDep('buildHierarchyFocusTargetFromTreeNode', node, boardId);
          if (!editTarget) return;
          if (workspaceShellEnabled && WorkspaceShell && typeof WorkspaceShell.focusHierarchyTarget === 'function') {
            WorkspaceShell.focusHierarchyTarget(editTarget, boardId, { edit: true });
            return;
          }
          _callDep('navigateToHierarchyTarget', editTarget).then(function () {
            var dash = typeof window !== 'undefined' ? window.LexeraDashboard : null;
            if (dash && typeof dash.openEditForHierarchyTarget === 'function') {
              dash.openEditForHierarchyTarget(editTarget);
            }
          }).catch(function (err) {
            logFrontendIssue('warn', 'sidebar.hierarchy-dblclick-edit', 'Failed to focus hierarchy target for edit', err);
          });
        }).catch(function (err) {
          logFrontendIssue('warn', 'sidebar.hierarchy-dblclick-edit', 'Failed to start hierarchy inline edit', err);
        });
      }
    });
    return true;
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
      if (treeEl && !_bindBoardTreeInteractions(treeEl, boardId, workspaceShellEnabled, WorkspaceShell)) {
        treeEl.addEventListener('click', function (e) {
          var target = e.target;
          var gripTarget = target && typeof target.closest === 'function' ? target.closest('.tree-grip') : null;
          var menuTarget = target && typeof target.closest === 'function' ? target.closest('.tree-menu-btn') : null;
          var toggleTarget = target && typeof target.closest === 'function' ? target.closest('.tree-toggle') : null;

          // Grip click — do nothing (grip is for drag only)
          if (gripTarget) {
            e.stopPropagation();
            return;
          }

          // Menu button click — open context menu for this node
          if (menuTarget) {
            e.stopPropagation();
            var menuNode = menuTarget.closest('.tree-node');
            if (menuNode) {
              var btnRect = menuTarget.getBoundingClientRect();
              _showTreeNodeContextMenu(boardId, menuNode, btnRect.right, btnRect.bottom, workspaceShellEnabled, WorkspaceShell);
            }
            return;
          }

          // Toggle arrow click (Alt+click = fold children only, not self)
          if (toggleTarget) {
            e.stopPropagation();
            var node = toggleTarget.closest('.tree-node');
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
                toggleTarget.classList.toggle('expanded');
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

        // Tree node double-click: focus + enter edit mode for the target entity
        // (card edit, row/stack/column rename). Mirrors the single-click focus
        // path but forwards `edit: true` through the workspace-shell bridge so
        // the iframe's own ActionRegistry performs the edit. Non-shell mode
        // falls back to the local focus pipeline and dispatches the action
        // directly against the board in the current window.
        treeEl.addEventListener('dblclick', function (e) {
          // Ignore double-clicks on controls that already have their own handler
          // (toggle arrow, grip, burger menu button).
          if ((e.target && typeof e.target.closest === 'function' && e.target.closest('.tree-toggle')) ||
              (e.target && typeof e.target.closest === 'function' && e.target.closest('.tree-grip')) ||
              (e.target && typeof e.target.closest === 'function' && e.target.closest('.tree-menu-btn'))) {
            return;
          }
          var node = e.target.closest('.tree-node');
          if (!node) return;
          e.preventDefault();
          e.stopPropagation();
          beginHierarchyNodeInlineEdit(node, boardId).then(function (handled) {
            if (handled) return;
            var editTarget = _callDep('buildHierarchyFocusTargetFromTreeNode', node, boardId);
            if (!editTarget) return;
            if (workspaceShellEnabled && WorkspaceShell && typeof WorkspaceShell.focusHierarchyTarget === 'function') {
              WorkspaceShell.focusHierarchyTarget(editTarget, boardId, { edit: true });
              return;
            }
            // Non-shell fallback: navigate locally then dispatch the edit action
            // via the same mapping the iframe uses. Requires LexeraDashboard to
            // have loaded in this window (it has — this file is loaded by it).
            _callDep('navigateToHierarchyTarget', editTarget).then(function () {
              var dash = typeof window !== 'undefined' ? window.LexeraDashboard : null;
              if (dash && typeof dash.openEditForHierarchyTarget === 'function') {
                dash.openEditForHierarchyTarget(editTarget);
              }
            }).catch(function (err) {
              logFrontendIssue('warn', 'sidebar.hierarchy-dblclick-edit', 'Failed to focus hierarchy target for edit', err);
            });
          }).catch(function (err) {
            logFrontendIssue('warn', 'sidebar.hierarchy-dblclick-edit', 'Failed to start hierarchy inline edit', err);
          });
        });

        // Tree DnD is handled by the pointer-based drag system (mousedown on getElBoardList())
      }

      var boardRow = wrapperEl.querySelector('.board-item');

      // Rule: clicking the .board-item-ws-menu burger never initiates a drag
      // and never activates the enclosing dock tabset — enforced once at the
      // document capture phase so it runs before any ancestor handler.
      ensureGlobalWsMenuGuard();

      function showBoardActionsMenu(x, y) {
        var wsId = wrapperEl.getAttribute('data-workspace-id') || '';
        showBoardActionsMenuFor(boardId, wsId, x, y);
      }

      boardRow.addEventListener('click', async function (e) {
        // Toggle click is handled by the delegation handler above — skip here
        if (e.target.closest('.board-item-toggle')) return;
        // Workspace burger menu click — open the per-workspace actions menu
        var wsMenuBtn = e.target.closest('.board-item-ws-menu');
        if (wsMenuBtn) {
          e.preventDefault();
          e.stopPropagation();
          var rect = wsMenuBtn.getBoundingClientRect();
          showBoardActionsMenu(rect.right, rect.bottom);
          return;
        }
        _callDep('exitSearchMode');
        _callDep('selectBoard', boardId);
      });

      boardRow.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showBoardActionsMenu(e.clientX, e.clientY);
      });
      boardRow.addEventListener('dblclick', function (e) {
        if (!e.target.closest('.board-item-title') ||
            e.target.closest('.board-item-toggle') ||
            e.target.closest('.board-item-ws-menu') ||
            e.target.closest('.tree-grip')) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        beginHierarchyNodeInlineEdit(boardRow, boardId).catch(function (err) {
          logFrontendIssue('warn', 'sidebar.board-inline-edit', 'Failed to start board inline edit', err);
        });
      });
      // Board DnD is handled by the pointer-based drag system (mousedown on getElBoardList())
    })(boardId, boardIndex, wrapperEl, boardFilePath);
  }

  /**
   * Build the flat ordered list of keyed entries that renderBoardList should display.
   * Each entry has { key, type, ... } plus type-specific data.
   */
  function _buildDesiredEntries(boards, remoteBoards, workspaces, workspaceViewId, activeBoardId) {
    // Each window owns exactly one workspace — no "all workspaces"
    // pseudo-mode. When the catalog hasn't hydrated and no workspace
    // is selected yet, render only remote boards (if any). The catalog
    // hydrate path promotes the window to a real workspace via
    // setWorkspacesState, after which the local boards filter applies.
    var filteredBoards = workspaceViewId
      ? boards.filter(function (b) { return getBoardWorkspaceIds(b).indexOf(workspaceViewId) >= 0; })
      : [];
    var orderedBoards = _callDep('getOrderedItems', filteredBoards, 'lexera-board-order', function (b) { return b.id; }) || filteredBoards;

    // Detect upstream duplicates in the boards array so we can trace
    // the source instead of silently deduplicating.
    if (orderedBoards.length > 0) {
      var _dupCheck = {};
      var _dupCount = 0;
      for (var _di = 0; _di < orderedBoards.length; _di++) {
        var _did = orderedBoards[_di] && orderedBoards[_di].id;
        if (_did && _dupCheck[_did]) _dupCount++;
        if (_did) _dupCheck[_did] = true;
      }
      if (_dupCount > 0) {
        logFrontendIssue('warn', 'boardList.buildEntries', 'Upstream boards array contains ' + _dupCount + ' duplicate ID(s) out of ' + orderedBoards.length + ' entries. Deduplicating.', {
          ids: orderedBoards.map(function (b) { return b && b.id; }),
          stack: new Error().stack
        });
      }
    }

    var expandedIds = getSidebarExpandedBoards();
    var entries = [];

    // Single-workspace view — flat list of boards belonging to the
    // active workspace. Carry the workspaceId so the per-board action
    // renders as the "Remove from workspace" burger instead of ×.
    var flatSeen = {};
    var flatWsId = String(workspaceViewId || '');
    for (var si = 0; si < orderedBoards.length; si++) {
      var fb = orderedBoards[si];
      if (!fb || !fb.id) continue;
      if (flatSeen[fb.id]) continue;
      flatSeen[fb.id] = true;
      entries.push({ key: 'board:' + fb.id, type: 'board', board: fb, index: entries.length, workspaceId: flatWsId });
    }

    // Remote boards. Dedupe by id for the same reason as above.
    if (remoteBoards.length > 0) {
      entries.push({ key: '__remote_divider__', type: 'remote_divider' });
      var remoteSeen = {};
      for (var ri = 0; ri < remoteBoards.length; ri++) {
        var rb = remoteBoards[ri];
        if (!rb || !rb.id) continue;
        if (remoteSeen[rb.id]) continue;
        remoteSeen[rb.id] = true;
        entries.push({ key: 'remote:' + rb.id, type: 'remote_board', rb: rb });
      }
    }

    // Fix board indices to be sequential
    var boardIdx = 0;
    for (var fi = 0; fi < entries.length; fi++) {
      if (entries[fi].type === 'board') { entries[fi].index = boardIdx++; }
    }

    return entries;
  }

  function renderBoardList() {
    var boardListEl = getElBoardList();
    if (!boardListEl) return;
    var rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

    var workspaceViewId = getWorkspaceViewId();
    var boards = _dep('boards');
    var remoteBoards = _dep('remoteBoards');

    // Keep loading indicator until we actually have board data.
    // Return early so setViewEmpty at the end doesn't strip the spinner.
    var hasData = (Array.isArray(boards) && boards.length > 0) ||
                  (Array.isArray(remoteBoards) && remoteBoards.length > 0);
    if (!hasData) {
      if (rt) rt.setViewLoading(boardListEl, true);
      return;
    }
    if (rt) rt.setViewLoading(boardListEl, false);
    var activeBoardId = _dep('activeBoardId');

    // Skip expensive DOM rebuild if nothing changed since last render
    var workspaces = _dep('workspaces') || [];
    var renderFp = _buildRenderFingerprint(boards, remoteBoards, workspaces, workspaceViewId, activeBoardId);
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
    var desired = _buildDesiredEntries(boards, remoteBoards, workspaces, workspaceViewId, activeBoardId);

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

    // Helper: reconcile a single board entry into a target container.
    // Optional localKeyMap overrides the global existingByKey — used by
    // workspace-section reconciliation where nested board nodes live in
    // a different container than the top-level boardListEl.
    function _reconcileBoardEntry(bEntry, bIdx, targetEl, boardIdx, localKeyMap) {
      var board = bEntry.board;
      var isExpanded = expandedIds.indexOf(board.id) !== -1;
      var isActive = board.id === activeBoardId;
      var rows = getBoardHierarchyRows(board.id) || [];
      var totalCards = countCardsInRows(rows);
      bEntry.index = boardIdx;
      var existingBoard = (localKeyMap || existingByKey)[bEntry.key];
      var boardNode;
      var wsChildWorkspaceId = bEntry.workspaceId || '';
      if (existingBoard) {
        var boardItem = existingBoard.querySelector('.board-item');
        if (boardItem) {
          _updateBoardItemContent(boardItem, board, boardIdx, isExpanded, isActive, rows, totalCards, !!bEntry.workspaceChild, SidebarSync, wsChildWorkspaceId);
        }
        var treeEl = existingBoard.querySelector('.board-item-tree');
        if (treeEl) {
          if (isExpanded) { treeEl.classList.add('expanded'); } else { treeEl.classList.remove('expanded'); }
          if (rows.length > 0) {
            _renderBoardTree(treeEl, board.id, rows, tv);
          } else {
            treeEl.innerHTML = '';
          }
        }
        boardNode = existingBoard;
      } else {
        boardNode = _createBoardWrapperEl(board, boardIdx, isExpanded, isActive, rows, totalCards, !!bEntry.workspaceChild, tv, SidebarSync, workspaceShellEnabled, WorkspaceShell, wsChildWorkspaceId);
      }
      if (boardNode) {
        boardNode.setAttribute('data-list-key', bEntry.key);
        var currentAtPos = targetEl.children[bIdx];
        if (currentAtPos !== boardNode) {
          targetEl.insertBefore(boardNode, currentAtPos || null);
        }
      }
      return boardNode;
    }

    // Reconcile: walk the desired list and ensure each entry is at the right position
    // with correct content. Reuse existing nodes where possible.
    var globalBoardIdx = 0;
    for (var i = 0; i < desired.length; i++) {
      var entry = desired[i];
      var existing = existingByKey[entry.key];
      var node;

      if (entry.type === 'board') {
        _reconcileBoardEntry(entry, i, boardListEl, globalBoardIdx++);
        node = null; // already placed by _reconcileBoardEntry
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
    bindRuntimeSubscriptions();
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
    cancelPendingDraftSave: cancelPendingDraftSave,
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
    rowsForBoardData: rowsForBoardData,
    getBoardHierarchyRows: getBoardHierarchyRows,
    deleteBoardHierarchyCacheEntry: deleteBoardHierarchyCacheEntry,
    refreshBoardHierarchyCache: refreshBoardHierarchyCache,
    refreshBoardHierarchyProjection: refreshBoardHierarchyProjection,
    cardPreviewText: cardPreviewText,
    setActiveWorkspaceId: setActiveWorkspaceId,
    resolveActiveWorkspaceId: resolveActiveWorkspaceId,
    resolveWorkspaceContextForBoard: resolveWorkspaceContextForBoard,
    syncWorkspaceContextForBoard: syncWorkspaceContextForBoard,
    reconcileActiveWorkspaceContext: reconcileActiveWorkspaceContext,
    dispatchMirrorMouseEvent: dispatchMirrorMouseEvent,
    findCanonicalHierarchyTarget: findCanonicalHierarchyTarget,
    bindMirroredWorkspaceView: bindMirroredWorkspaceView,
    syncMirroredWorkspaceViews: syncMirroredWorkspaceViews,
    beginHierarchyNodeInlineEdit: beginHierarchyNodeInlineEdit,
    refreshWorkspaceMirrors: refreshWorkspaceMirrors,
    getBoardWorkspaceIds: getBoardWorkspaceIds,
    removeBoardFromSidebar: removeBoardFromSidebar,
    renderBoardList: renderBoardList,
    invalidateBoardListFingerprint: invalidateBoardListFingerprint,
    _buildDesiredEntries: _buildDesiredEntries
  };
})();
window.LexeraBoardList = LexeraBoardList;
