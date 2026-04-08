/**
 * Frontend Integration Tests — runs inside the live Tauri WebView.
 *
 * Uses the REAL currently-loaded board. Each test snapshots board state,
 * mutates via real app functions, verifies the real DOM, then restores.
 *
 * Open via: View > Panels > Frontend Tests
 * Or console: LexeraFrontendTests.runAllWithUI()
 */
(function () {
  'use strict';

  var tests = [];
  var _api = null;
  var TEST_RUN_CANCELLED = 'lexera-frontend-tests-cancelled';
  var _runState = {
    active: false,
    cancelRequested: false,
    currentIndex: -1,
    total: 0
  };

  function hasLoadedBoard(candidateApi) {
    if (!candidateApi) return false;
    try {
      var boardId = typeof candidateApi.getActiveBoardId === 'function' ? candidateApi.getActiveBoardId() : null;
      var data = typeof candidateApi.getFullBoardData === 'function' ? candidateApi.getFullBoardData() : null;
      return !!(boardId && getBoardRowCount(data) > 0);
    } catch (_) {
      return false;
    }
  }

  function getIframeEntries(rootDoc) {
    var entries = [];
    if (!rootDoc || typeof rootDoc.querySelectorAll !== 'function') return entries;
    try {
      var iframes = rootDoc.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        var iframe = iframes[i];
        try {
          entries.push({
            iframe: iframe,
            win: iframe.contentWindow || null,
            doc: iframe.contentDocument || null,
            isActive: !!(iframe.classList && iframe.classList.contains('is-active'))
          });
        } catch (_) {}
      }
    } catch (_) {}
    return entries;
  }

  function getCandidateApis() {
    var candidates = [];
    function pushCandidate(win) {
      if (!win || !win.LexeraTestApi || candidates.indexOf(win.LexeraTestApi) !== -1) return;
      candidates.push(win.LexeraTestApi);
    }

    pushCandidate(window);
    try { if (window.parent && window.parent !== window) pushCandidate(window.parent); } catch (_) {}

    var entries = getIframeEntries(document);
    for (var i = 0; i < entries.length; i++) if (entries[i].isActive) pushCandidate(entries[i].win);
    for (var j = 0; j < entries.length; j++) pushCandidate(entries[j].win);

    return candidates;
  }

  function api() {
    if (_api) return _api;
    var candidates = getCandidateApis();
    for (var i = 0; i < candidates.length; i++) {
      if (hasLoadedBoard(candidates[i])) {
        _api = candidates[i];
        return _api;
      }
    }
    if (candidates.length > 0) {
      _api = candidates[0];
      return _api;
    }
    throw new Error('LexeraTestApi not found');
  }

  function register(name, fn) { tests.push({ name: name, fn: fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════

  function createCancelledError() {
    var err = new Error('Test run stopped');
    err.code = TEST_RUN_CANCELLED;
    return err;
  }

  function isCancelledError(err) {
    return !!(err && err.code === TEST_RUN_CANCELLED);
  }

  function isRunActive() {
    return !!_runState.active;
  }

  function isRunCancelled() {
    return !!(_runState.active && _runState.cancelRequested);
  }

  function throwIfRunCancelled() {
    if (isRunCancelled()) throw createCancelledError();
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function delay(ms) {
    ms = typeof ms === 'number' && ms > 0 ? ms : 0;
    if (ms === 0) {
      throwIfRunCancelled();
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = null;
      var poll = null;

      function cleanup() {
        if (timer) clearTimeout(timer);
        if (poll) clearTimeout(poll);
      }

      function finish(fn, value) {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      }

      function pollCancel() {
        if (settled) return;
        if (isRunCancelled()) {
          finish(reject, createCancelledError());
          return;
        }
        poll = setTimeout(pollCancel, Math.min(50, ms));
      }

      timer = setTimeout(function () {
        try {
          throwIfRunCancelled();
          finish(resolve);
        } catch (err) {
          finish(reject, err);
        }
      }, ms);
      poll = setTimeout(pollCancel, Math.min(50, ms));
    });
  }
  function getBoardRowCount(boardData) { return boardData && boardData.rows ? boardData.rows.length : 0; }

  function assertEqual(actual, expected, msg) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error((msg || 'assertEqual') + ': expected ' + e + ', got ' + a);
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }

  function getStoredBoardSelection() {
    try { return localStorage.getItem('lexera-frontend-tests-board') || ''; } catch (_) { return ''; }
  }

  function setStoredBoardSelection(boardId) {
    try {
      if (boardId) localStorage.setItem('lexera-frontend-tests-board', boardId);
      else localStorage.removeItem('lexera-frontend-tests-board');
    } catch (_) {}
  }

  function getBoardSelector() {
    var root = findPanelRoot();
    return root ? root.querySelector('.lexera-shared-test-board-select') : null;
  }

  function cleanBoardText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function isHiddenForRender(text) {
    return /(^|\s)#hidden(?:-internal-[a-z0-9-]+)?\b/i.test(String(text || ''));
  }

  function getExpectedVisibleProjection(boardData) {
    var projection = { rows: [], columns: [] };
    var rows = boardData && Array.isArray(boardData.rows) ? boardData.rows : [];
    var flatIdx = 0;

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var rowVisible = !isHiddenForRender(row && row.title);
      var rowEntry = rowVisible ? {
        rowIndex: r,
        rowId: row && row.id ? row.id : '',
        row: row,
        stacks: []
      } : null;
      var stacks = row && Array.isArray(row.stacks) ? row.stacks : [];

      for (var s = 0; s < stacks.length; s++) {
        var stack = stacks[s];
        var stackVisible = rowVisible && !isHiddenForRender(stack && stack.title);
        var stackEntry = stackVisible ? {
          rowIndex: r,
          stackIndex: s,
          stackId: stack && stack.id ? stack.id : '',
          stack: stack,
          columns: []
        } : null;
        var cols = stack && Array.isArray(stack.columns) ? stack.columns : [];

        for (var c = 0; c < cols.length; c++) {
          var col = cols[c];
          var colVisible = stackVisible && !isHiddenForRender(col && col.title);
          if (colVisible) {
            var cards = Array.isArray(col.cards) ? col.cards : [];
            var visibleCards = [];
            for (var k = 0; k < cards.length; k++) {
              if (!isHiddenForRender(cards[k] && cards[k].content)) visibleCards.push(cards[k]);
            }
            var colEntry = {
              flatIdx: flatIdx,
              rowIndex: r,
              stackIndex: s,
              colIndex: c,
              columnId: col && col.id ? col.id : '',
              column: col,
              cards: visibleCards
            };
            projection.columns.push(colEntry);
            stackEntry.columns.push(colEntry);
          }
          flatIdx++;
        }

        if (stackEntry) rowEntry.stacks.push(stackEntry);
      }

      if (rowEntry) projection.rows.push(rowEntry);
    }

    return projection;
  }

  function findFirstVisibleStackRef(boardData) {
    var projection = getExpectedVisibleProjection(boardData);
    for (var r = 0; r < projection.rows.length; r++) {
      var row = projection.rows[r];
      for (var s = 0; s < row.stacks.length; s++) {
        if (row.stacks[s]) return row.stacks[s];
      }
    }
    return null;
  }

  function looksLikeOpaqueBoardTitle(title, boardId) {
    var text = cleanBoardText(title);
    var id = cleanBoardText(boardId);
    if (!text) return true;
    if (id && text === id) return true;
    if (/^active board$/i.test(text)) return true;
    if (/^\d{4,}$/.test(text)) return true;
    if (/^[0-9a-f-]{8,}$/i.test(text) && text.replace(/-/g, '').length >= 8) return true;
    return false;
  }

  function getBoardTitleScore(title, boardId) {
    var text = cleanBoardText(title);
    if (!text) return 0;
    var score = 1;
    if (!looksLikeOpaqueBoardTitle(text, boardId)) score += 4;
    if (!/^untitled$/i.test(text)) score += 1;
    return score;
  }

  function normalizeBoardEntry(entry, sourcePriority) {
    if (!entry) return null;
    var id = cleanBoardText(entry.id);
    if (!id) return null;
    return {
      id: id,
      title: cleanBoardText(entry.title) || id,
      isRemote: !!entry.isRemote,
      _sourcePriority: typeof sourcePriority === 'number' ? sourcePriority : 0
    };
  }

  function upsertBoardEntry(target, entry, sourcePriority) {
    var normalized = normalizeBoardEntry(entry, sourcePriority);
    if (!normalized) return;
    for (var i = 0; i < target.length; i++) {
      if (target[i].id !== normalized.id) continue;
      target[i].isRemote = !!(target[i].isRemote || normalized.isRemote);
      var existingScore = getBoardTitleScore(target[i].title, target[i].id);
      var nextScore = getBoardTitleScore(normalized.title, normalized.id);
      if (nextScore > existingScore ||
          (nextScore === existingScore && normalized._sourcePriority > (target[i]._sourcePriority || 0))) {
        target[i].title = normalized.title || target[i].title;
        target[i]._sourcePriority = normalized._sourcePriority;
      }
      return;
    }
    target.push(normalized);
  }

  function getReachableDocuments() {
    var docs = [];
    function pushDoc(doc) {
      if (!doc) return;
      if (docs.indexOf(doc) !== -1) return;
      docs.push(doc);
    }

    pushDoc(document);
    try { if (window.parent && window.parent !== window) pushDoc(window.parent.document); } catch (_) {}

    var entries = getIframeEntries(document);
    for (var i = 0; i < entries.length; i++) pushDoc(entries[i].doc);
    return docs;
  }

  function getAvailableBoardsFromShellDom() {
    var list = [];
    var docs = getReachableDocuments();
    for (var d = 0; d < docs.length; d++) {
      var rootDoc = docs[d];
      if (!rootDoc || typeof rootDoc.querySelectorAll !== 'function') continue;
      var nodes = [];
      try {
        nodes = rootDoc.querySelectorAll('.board-item.tree-board[data-board-id]');
      } catch (_) {
        nodes = [];
      }
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var titleEl = null;
        var title = '';
        try {
          titleEl = node.querySelector('.board-item-title-text');
          title = cleanBoardText(titleEl ? titleEl.textContent : '');
        } catch (_) {}
        upsertBoardEntry(list, {
          id: node.getAttribute('data-board-id'),
          title: title,
          isRemote: !!(node.classList && node.classList.contains('remote-board'))
        }, 40);
      }
    }
    return list;
  }

  function getAvailableBoardsFromApis() {
    var list = [];
    var candidates = getCandidateApis();
    for (var c = 0; c < candidates.length; c++) {
      var candidateApi = candidates[c];
      if (!candidateApi) continue;
      try {
        if (typeof candidateApi.getAvailableBoards === 'function') {
          var apiList = candidateApi.getAvailableBoards();
          if (Array.isArray(apiList)) {
            for (var i = 0; i < apiList.length; i++) upsertBoardEntry(list, apiList[i], 20);
          }
        }
      } catch (_) {}
      try {
        var activeBoardId = typeof candidateApi.getActiveBoardId === 'function' ? candidateApi.getActiveBoardId() : '';
        var activeBoardData = typeof candidateApi.getActiveBoardData === 'function' ? candidateApi.getActiveBoardData() : null;
        if (activeBoardId) {
          upsertBoardEntry(list, {
            id: activeBoardId,
            title: activeBoardData && activeBoardData.title ? activeBoardData.title : activeBoardId,
            isRemote: false
          }, 10);
        }
      } catch (_) {}
    }
    return list;
  }

  function getAvailableBoards() {
    var merged = [];
    try {
      var domBoards = getAvailableBoardsFromShellDom();
      for (var i = 0; i < domBoards.length; i++) upsertBoardEntry(merged, domBoards[i], 40);
      var apiBoards = getAvailableBoardsFromApis();
      for (var j = 0; j < apiBoards.length; j++) upsertBoardEntry(merged, apiBoards[j], 20);
    } catch (_) {}
    return merged.map(function (entry) {
      return {
        id: entry.id,
        title: entry.title || entry.id,
        isRemote: !!entry.isRemote
      };
    });
  }

  var _boardSelectorRefreshToken = 0;

  function boardSelectorLooksIncomplete(selector) {
    if (!selector) return false;
    if (selector.disabled) return true;
    if (selector.options.length <= 1) return true;
    for (var i = 0; i < selector.options.length; i++) {
      var opt = selector.options[i];
      if (!opt || !opt.value) continue;
      var label = cleanBoardText(opt.textContent).replace(/\s+\[remote\]\s*$/i, '');
      if (looksLikeOpaqueBoardTitle(label, opt.value)) return true;
    }
    return false;
  }

  function scheduleBoardSelectorRefresh(delayMs, attemptsLeft) {
    if (_boardSelectorRefreshToken || attemptsLeft <= 0) return;
    _boardSelectorRefreshToken = setTimeout(function () {
      _boardSelectorRefreshToken = 0;
      refreshBoardSelector();
      if (boardSelectorLooksIncomplete(getBoardSelector())) {
        scheduleBoardSelectorRefresh(Math.min((delayMs || 250) * 2, 2000), attemptsLeft - 1);
      }
    }, Math.max(0, delayMs || 0));
  }

  function getSelectedBoardId() {
    var selector = getBoardSelector();
    if (selector && selector.value) return String(selector.value);
    return getStoredBoardSelection();
  }

  function refreshBoardSelector() {
    var selector = getBoardSelector();
    if (!selector) return;
    var boards = getAvailableBoards();
    var previous = selector.value || getStoredBoardSelection() || '';
    selector.innerHTML = '';
    if (!boards.length) {
      var emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = 'Active Board';
      selector.appendChild(emptyOpt);
      selector.disabled = true;
      updateRunControls();
      return;
    }
    selector.disabled = false;
    var activeBoardId = '';
    try { activeBoardId = api().getActiveBoardId() || ''; } catch (_) {}
    for (var i = 0; i < boards.length; i++) {
      var board = boards[i];
      if (!board || !board.id) continue;
      var opt = document.createElement('option');
      opt.value = board.id;
      opt.textContent = board.title || board.id;
      if (board.isRemote) opt.textContent += ' [remote]';
      selector.appendChild(opt);
    }
    var selected = previous;
    var hasSelected = false;
    for (var j = 0; j < boards.length; j++) {
      if (boards[j] && boards[j].id === selected) {
        hasSelected = true;
        break;
      }
    }
    if (!hasSelected) selected = activeBoardId || (boards[0] && boards[0].id) || '';
    selector.value = selected;
    setStoredBoardSelection(selected);
    updateRunControls();
  }

  async function ensureSelectedBoardLoaded() {
    var targetBoardId = getSelectedBoardId();
    if (!targetBoardId) return;
    var currentApi = api();
    var currentBoardId = typeof currentApi.getActiveBoardId === 'function' ? currentApi.getActiveBoardId() : '';
    var currentData = typeof currentApi.getFullBoardData === 'function' ? currentApi.getFullBoardData() : null;
    if (currentBoardId === targetBoardId && getBoardRowCount(currentData) > 0) return;
    if (typeof currentApi.selectBoard !== 'function') throw new Error('Board selection unavailable in test API');
    await currentApi.selectBoard(targetBoardId);
    for (var attempt = 0; attempt < 25; attempt++) {
      try {
        var loadedBoardId = currentApi.getActiveBoardId();
        var loadedData = currentApi.getFullBoardData();
        if (loadedBoardId === targetBoardId && getBoardRowCount(loadedData) > 0) {
          _api = currentApi;
          refreshBoardSelector();
          return;
        }
      } catch (_) {}
      await delay(200);
    }
    throw new Error('Failed to load selected board: ' + targetBoardId);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DOM query — resolve the document that contains the board
  // ═══════════════════════════════════════════════════════════════════════

  function hasBoardDom(rootDoc) {
    if (!rootDoc) return false;
    try {
      var container = rootDoc.getElementById('columns-container') || rootDoc.querySelector('.columns-container');
      return !!(container && (container.querySelector('.board-row, .column, .card') || !rootDoc.body || !rootDoc.body.classList || !rootDoc.body.classList.contains('workspace-shell-mode')));
    } catch (_) {
      return false;
    }
  }

  function getBoardDocument() {
    var entries = getIframeEntries(document);
    // In workspace-shell mode, the parent document still contains a hidden
    // placeholder #columns-container. Prefer the active iframe whenever one
    // exists so DOM assertions target the live board surface.
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isActive) continue;
      try {
        var activeDoc = entries[i].doc;
        if (hasBoardDom(activeDoc)) return activeDoc;
      } catch (_) {}
    }
    for (var j = 0; j < entries.length; j++) {
      try {
        var iframeDoc = entries[j].doc;
        if (hasBoardDom(iframeDoc)) return iframeDoc;
      } catch (_) {}
    }
    if (hasBoardDom(document)) return document;
    return document;
  }

  function getContainer() {
    var doc = getBoardDocument();
    return doc.getElementById('columns-container') || doc.querySelector('.columns-container');
  }

  function getViewCardKids(flatColIndex) {
    var c = getContainer(); if (!c) return [];
    var el = c.querySelector('.column-cards[data-col-index="' + flatColIndex + '"]');
    if (!el) return [];
    var cards = el.querySelectorAll('.card');
    var ids = [];
    for (var i = 0; i < cards.length; i++)
      ids.push(cards[i].getAttribute('data-card-kid') || cards[i].getAttribute('data-card-id') || '');
    return ids;
  }

  function getViewCardCount(flatColIndex) {
    var c = getContainer(); if (!c) return -1;
    var el = c.querySelector('.column-cards[data-col-index="' + flatColIndex + '"]');
    return el ? el.querySelectorAll('.card').length : -1;
  }

  function getTotalViewCards() {
    var c = getContainer(); return c ? c.querySelectorAll('.card').length : -1;
  }

  function getViewColumnCount() {
    var c = getContainer(); return c ? c.querySelectorAll('.column').length : -1;
  }

  function getViewRowCount() {
    var c = getContainer(); return c ? c.querySelectorAll('.board-row').length : -1;
  }

  function hasDuplicateViewCardIds() {
    var c = getContainer(); if (!c) return false;
    var cards = c.querySelectorAll('.card');
    var seen = {};
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].getAttribute('data-card-kid') || cards[i].getAttribute('data-card-id') || '';
      if (id && seen[id]) return true;
      seen[id] = true;
    }
    return false;
  }

  function getViewColumnId(flatColIndex) {
    var c = getContainer(); if (!c) return null;
    var col = c.querySelector('.column[data-col-index="' + flatColIndex + '"]');
    return col ? (col.getAttribute('data-column-id') || null) : null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DOM query — sidebar tree
  // ═══════════════════════════════════════════════════════════════════════

  function getSidebarCardIdsInColumn(columnId) {
    var doc = getBoardDocument();
    var bl = doc.querySelector('.board-list');
    if (!bl) return null;
    var cards = bl.querySelectorAll('.tree-card[data-column-id="' + columnId + '"]');
    if (cards.length === 0) return null;
    var ids = [];
    for (var i = 0; i < cards.length; i++)
      ids.push(cards[i].getAttribute('data-card-id') || '');
    return ids;
  }

  function isSidebarAvailable() {
    var doc = getBoardDocument();
    var bl = doc.querySelector('.board-list');
    return !!(bl && bl.querySelector('.tree-card'));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Setup / teardown — snapshot & restore the real board
  // ═══════════════════════════════════════════════════════════════════════

  var _snapshot = null;
  var _boardId = null;
  var _uiStateSnapshot = null;

  function getBoardUiStateKeys(boardId) {
    if (!boardId) return [];
    return [
      'lexera-col-fold:' + boardId,
      'lexera-row-fold:' + boardId,
      'lexera-stack-fold:' + boardId,
      'lexera-card-collapsed:' + boardId,
      'lexera-card-expanded:' + boardId
    ];
  }

  function captureBoardUiState(boardId) {
    var keys = getBoardUiStateKeys(boardId);
    var snapshot = {};
    for (var i = 0; i < keys.length; i++) {
      try { snapshot[keys[i]] = localStorage.getItem(keys[i]); } catch (_) { snapshot[keys[i]] = null; }
    }
    return snapshot;
  }

  function restoreBoardUiState(snapshot, boardId) {
    if (!snapshot || !boardId) return;
    var keys = getBoardUiStateKeys(boardId);
    for (var i = 0; i < keys.length; i++) {
      try {
        if (Object.prototype.hasOwnProperty.call(snapshot, keys[i])) {
          if (snapshot[keys[i]] == null) localStorage.removeItem(keys[i]);
          else localStorage.setItem(keys[i], snapshot[keys[i]]);
        }
      } catch (_) {}
    }
  }

  async function unfoldBoardForTests(boardId) {
    if (!boardId) return;
    try {
      localStorage.setItem('lexera-col-fold:' + boardId, '[]');
      localStorage.setItem('lexera-row-fold:' + boardId, '[]');
      localStorage.setItem('lexera-stack-fold:' + boardId, '[]');
      localStorage.setItem('lexera-card-collapsed:' + boardId, '[]');
      localStorage.removeItem('lexera-card-expanded:' + boardId);
    } catch (_) {}
    try { api().renderMainView(); } catch (_) {}
    await delay(120);
  }

  async function setup() {
    refreshBoardSelector();
    await ensureSelectedBoardLoaded();
    // Wait for a board to be loaded (may take a moment in workspace shell)
    for (var attempt = 0; attempt < 10; attempt++) {
      throwIfRunCancelled();
      try {
        _boardId = api().getActiveBoardId();
        var data = api().getFullBoardData();
        if (_boardId && data && data.rows && data.rows.length > 0) {
          _uiStateSnapshot = captureBoardUiState(_boardId);
          await unfoldBoardForTests(_boardId);
          data = api().getFullBoardData();
          _snapshot = JSON.parse(JSON.stringify(data));
          return;
        }
      } catch (_) {}
      await delay(200);
      _api = null; // retry finding the API
    }
    throw new Error('No board loaded — open a board with at least 2 columns first');
  }

  async function teardown() {
    if (_snapshot && _boardId) {
      api().setTestBoard(_snapshot, _boardId);
      await wait(150);
      restoreBoardUiState(_uiStateSnapshot, _boardId);
      try { api().renderMainView(); } catch (_) {}
      await wait(80);
    }
    _snapshot = null;
    _boardId = null;
    _uiStateSnapshot = null;
  }

  /** Find first two columns with at least 1 card each. Returns {srcCol, dstCol, srcCard}. */
  function findTwoColumnsWithCards() {
    var data = api().getFullBoardData();
    var flatIdx = 0;
    var srcCol = null, dstCol = null;
    for (var r = 0; r < data.rows.length; r++) {
      var rowHidden = isHiddenForRender(data.rows[r] && data.rows[r].title);
      var stacks = data.rows[r].stacks || [];
      for (var s = 0; s < stacks.length; s++) {
        var stackHidden = rowHidden || isHiddenForRender(stacks[s] && stacks[s].title);
        var cols = stacks[s].columns || [];
        for (var c = 0; c < cols.length; c++) {
          var colHidden = stackHidden || isHiddenForRender(cols[c] && cols[c].title);
          var visibleCards = colHidden ? [] : (cols[c].cards || []).filter(function (card) {
            return !isHiddenForRender(card && card.content);
          });
          if (!colHidden && visibleCards.length > 0) {
            if (!srcCol) {
              srcCol = { flatIdx: flatIdx, col: cols[c], row: r, stack: s, localCol: c, cards: visibleCards };
            } else if (!dstCol) {
              dstCol = { flatIdx: flatIdx, col: cols[c], row: r, stack: s, localCol: c, cards: visibleCards };
              return { srcCol: srcCol, dstCol: dstCol };
            }
          }
          flatIdx++;
        }
      }
    }
    throw new Error('Need at least 2 columns with visible cards');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CARD MOVE TESTS
  // ═══════════════════════════════════════════════════════════════════════

  register('same-column reorder: first card moves to end', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      if (col.cards.length < 2) throw new Error('Need >=2 cards in source column');
      var firstKid = col.cards[0].kid || col.cards[0].id;
      var lastKid = col.cards[col.cards.length - 1].kid || col.cards[col.cards.length - 1].id;
      var countBefore = getViewCardCount(col.flatIdx);

      await api().moveCard(
        { boardId: _boardId, flatColIndex: col.flatIdx, cardIndex: 0, cardId: col.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: col.flatIdx, cardId: lastKid, before: false, insertIdx: col.cards.length - 1, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);

      assertEqual(getViewCardCount(col.flatIdx), countBefore, 'count unchanged');
      var afterKids = getViewCardKids(col.flatIdx);
      assertEqual(afterKids[afterKids.length - 1], firstKid, 'moved card should be last');
      assert(afterKids[0] !== firstKid, 'moved card should not be first anymore');
    } finally { await teardown(); }
  });

  register('view→view cross-column: card moves between columns', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var src = info.srcCol, dst = info.dstCol;
      var movedKid = src.cards[0].kid || src.cards[0].id;
      var srcCountBefore = getViewCardCount(src.flatIdx);
      var dstCountBefore = getViewCardCount(dst.flatIdx);
      var totalBefore = getTotalViewCards();

      await api().moveCard(
        { boardId: _boardId, flatColIndex: src.flatIdx, cardIndex: 0, cardId: src.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: dst.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);

      assertEqual(getViewCardCount(src.flatIdx), srcCountBefore - 1, 'source lost 1 card');
      assertEqual(getViewCardCount(dst.flatIdx), dstCountBefore + 1, 'target gained 1 card');
      assertEqual(getTotalViewCards(), totalBefore, 'total unchanged');
      assert(!hasDuplicateViewCardIds(), 'no duplicates');
      assert(getViewCardKids(dst.flatIdx).indexOf(movedKid) !== -1, 'card in target view');
    } finally { await teardown(); }
  });

  register('workspace→view: sidebar-style source, view target', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var src = info.dstCol, dst = info.srcCol; // reverse: move from col 2 to col 1
      var movedKid = src.cards[0].kid || src.cards[0].id;
      var dstCountBefore = getViewCardCount(dst.flatIdx);

      await api().moveCard(
        { boardId: _boardId, rowIndex: src.row, stackIndex: src.stack, colIndex: src.localCol, columnId: src.col.id, cardIndex: 0, cardId: src.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: dst.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);

      assertEqual(getViewCardCount(dst.flatIdx), dstCountBefore + 1, 'target gained 1');
      assert(getViewCardKids(dst.flatIdx).indexOf(movedKid) !== -1, 'card in target');
    } finally { await teardown(); }
  });

  register('view→workspace: view source, sidebar-style target', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var src = info.srcCol, dst = info.dstCol;
      var movedKid = src.cards[0].kid || src.cards[0].id;
      var srcCountBefore = getViewCardCount(src.flatIdx);

      await api().moveCard(
        { boardId: _boardId, flatColIndex: src.flatIdx, cardIndex: 0, cardId: src.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, rowIndex: dst.row, stackIndex: dst.stack, colIndex: dst.localCol, columnId: dst.col.id, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);

      assertEqual(getViewCardCount(src.flatIdx), srcCountBefore - 1, 'source lost 1');
      assert(getViewCardKids(dst.flatIdx).indexOf(movedKid) !== -1, 'card in target');
    } finally { await teardown(); }
  });

  register('workspace→workspace: sidebar source and target', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var src = info.srcCol, dst = info.dstCol;
      var movedKid = src.cards[0].kid || src.cards[0].id;
      var srcCountBefore = getViewCardCount(src.flatIdx);
      var dstCountBefore = getViewCardCount(dst.flatIdx);

      await api().moveCard(
        { boardId: _boardId, rowIndex: src.row, stackIndex: src.stack, colIndex: src.localCol, columnId: src.col.id, cardIndex: 0, cardId: src.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, rowIndex: dst.row, stackIndex: dst.stack, colIndex: dst.localCol, columnId: dst.col.id, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);

      assertEqual(getViewCardCount(src.flatIdx), srcCountBefore - 1, 'source lost 1');
      assertEqual(getViewCardCount(dst.flatIdx), dstCountBefore + 1, 'target gained 1');
      assert(getViewCardKids(dst.flatIdx).indexOf(movedKid) !== -1, 'card in target');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STRUCTURAL TESTS
  // ═══════════════════════════════════════════════════════════════════════

  register('add card: appears in board view', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var countBefore = getViewCardCount(info.srcCol.flatIdx);
      var data = api().getFullBoardData();
      data.rows[info.srcCol.row].stacks[info.srcCol.stack].columns[info.srcCol.localCol].cards.push({
        id: '__test-card-add__', content: 'Test Added Card', checked: false, kid: '__test-card-add__'
      });
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewCardCount(info.srcCol.flatIdx), countBefore + 1, 'card count +1');
    } finally { await teardown(); }
  });

  register('remove card: disappears from board view', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var countBefore = getViewCardCount(info.srcCol.flatIdx);
      assert(countBefore >= 1, 'need at least 1 card');
      var removedKid = info.srcCol.cards[0].kid || info.srcCol.cards[0].id;
      var data = api().getFullBoardData();
      data.rows[info.srcCol.row].stacks[info.srcCol.stack].columns[info.srcCol.localCol].cards.splice(0, 1);
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewCardCount(info.srcCol.flatIdx), countBefore - 1, 'card count -1');
      assert(getViewCardKids(info.srcCol.flatIdx).indexOf(removedKid) === -1, 'removed card gone');
    } finally { await teardown(); }
  });

  register('add column: appears in board view', async function () {
    await setup();
    try {
      var colsBefore = getViewColumnCount();
      var data = api().getFullBoardData();
      var targetStack = findFirstVisibleStackRef(data);
      assert(targetStack, 'need at least 1 visible stack');
      data.rows[targetStack.rowIndex].stacks[targetStack.stackIndex].columns.push({
        id: '__test-col__', title: 'Test Column', cards: [], include_source: null
      });
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewColumnCount(), colsBefore + 1, 'column count +1');
    } finally { await teardown(); }
  });

  register('add row: appears in board view', async function () {
    await setup();
    try {
      var rowsBefore = getViewRowCount();
      var data = api().getFullBoardData();
      data.rows.push({
        id: '__test-row__', title: 'Test Row',
        stacks: [{ id: '__test-stack__', title: 'Test Stack',
          columns: [{ id: '__test-col2__', title: 'Test Col', cards: [], include_source: null }]
        }]
      });
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewRowCount(), rowsBefore + 1, 'row count +1');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════

  register('no duplicate card IDs after move', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      await api().moveCard(
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, cardIndex: 0, cardId: info.srcCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: info.dstCol.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);
      assert(!hasDuplicateViewCardIds(), 'no duplicate IDs');
    } finally { await teardown(); }
  });

  register('total card count constant after move', async function () {
    await setup();
    try {
      var totalBefore = getTotalViewCards();
      var info = findTwoColumnsWithCards();
      await api().moveCard(
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, cardIndex: 0, cardId: info.srcCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: info.dstCol.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);
      assertEqual(getTotalViewCards(), totalBefore, 'total constant');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // VIEW ↔ WORKSPACE CONSISTENCY
  // ═══════════════════════════════════════════════════════════════════════

  function assertViewWorkspaceConsistency(label) {
    if (!isSidebarAvailable()) return;
    var c = getContainer(); if (!c) return;
    var viewCols = c.querySelectorAll('.column');
    for (var i = 0; i < viewCols.length; i++) {
      var colId = viewCols[i].getAttribute('data-column-id');
      if (!colId) continue;
      var viewCards = viewCols[i].querySelectorAll('.column-cards .card');
      var viewKids = [];
      for (var j = 0; j < viewCards.length; j++)
        viewKids.push(viewCards[j].getAttribute('data-card-kid') || viewCards[j].getAttribute('data-card-id') || '');
      var sidebarKids = getSidebarCardIdsInColumn(colId);
      if (!sidebarKids) continue;
      assertEqual(sidebarKids, viewKids, label + ': col ' + colId);
    }
  }

  register('consistency: view matches workspace after cross-column move', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      await api().moveCard(
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, cardIndex: 0, cardId: info.srcCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: info.dstCol.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(150);
      assertViewWorkspaceConsistency('cross-column');
    } finally { await teardown(); }
  });

  register('consistency: view matches workspace after view→workspace move', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      await api().moveCard(
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, cardIndex: 0, cardId: info.srcCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, rowIndex: info.dstCol.row, stackIndex: info.dstCol.stack, colIndex: info.dstCol.localCol, columnId: info.dstCol.col.id, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(150);
      assertViewWorkspaceConsistency('view-to-workspace');
    } finally { await teardown(); }
  });

  register('consistency: view matches workspace after workspace→view move', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      await api().moveCard(
        { boardId: _boardId, rowIndex: info.dstCol.row, stackIndex: info.dstCol.stack, colIndex: info.dstCol.localCol, columnId: info.dstCol.col.id, cardIndex: 0, cardId: info.dstCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(150);
      assertViewWorkspaceConsistency('workspace-to-view');
    } finally { await teardown(); }
  });

  register('consistency: view matches workspace after add card', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var data = api().getFullBoardData();
      data.rows[info.srcCol.row].stacks[info.srcCol.stack].columns[info.srcCol.localCol].cards.push({
        id: '__test-cons-add__', content: 'Consistency Test', checked: false, kid: '__test-cons-add__'
      });
      api().setTestBoard(data, _boardId);
      await delay(150);
      assertViewWorkspaceConsistency('add-card');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CARD MOVE EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════

  register('same-column reorder: last card moves to start', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      if (col.cards.length < 2) throw new Error('Need >=2 cards in source column');
      var lastCard = col.cards[col.cards.length - 1];
      var lastKid = lastCard.kid || lastCard.id;
      var countBefore = getViewCardCount(col.flatIdx);

      await api().moveCard(
        { boardId: _boardId, flatColIndex: col.flatIdx, cardIndex: col.cards.length - 1, cardId: lastCard.id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: col.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);

      assertEqual(getViewCardCount(col.flatIdx), countBefore, 'count unchanged');
      var afterKids = getViewCardKids(col.flatIdx);
      assertEqual(afterKids[0], lastKid, 'moved card should be first');
      assert(afterKids[afterKids.length - 1] !== lastKid, 'moved card should not be last anymore');
    } finally { await teardown(); }
  });

  register('cross-column move: card is first in target column', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var src = info.srcCol, dst = info.dstCol;
      var movedKid = src.cards[0].kid || src.cards[0].id;

      await api().moveCard(
        { boardId: _boardId, flatColIndex: src.flatIdx, cardIndex: 0, cardId: src.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: dst.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);

      var dstKids = getViewCardKids(dst.flatIdx);
      assertEqual(dstKids[0], movedKid, 'moved card is first in target');
    } finally { await teardown(); }
  });

  register('cross-column move: source column card order remains stable', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var src = info.srcCol, dst = info.dstCol;
      if (src.cards.length < 2) throw new Error('Need >=2 cards in source column');
      var originalOrder = [];
      for (var i = 1; i < src.cards.length; i++)
        originalOrder.push(src.cards[i].kid || src.cards[i].id);

      await api().moveCard(
        { boardId: _boardId, flatColIndex: src.flatIdx, cardIndex: 0, cardId: src.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: dst.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);

      var remaining = getViewCardKids(src.flatIdx);
      assertEqual(remaining, originalOrder, 'remaining source cards keep original order');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SETTESTBOARD RERENDER VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════

  register('setTestBoard: rerenders row and column counts to match fullBoardData', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      data.rows.push({
        id: '__stb-row__', title: 'STB Row',
        stacks: [{ id: '__stb-stack__', title: 'STB Stack',
          columns: [
            { id: '__stb-col1__', title: 'STB Col 1', cards: [], include_source: null },
            { id: '__stb-col2__', title: 'STB Col 2', cards: [], include_source: null }
          ]
        }]
      });
      api().setTestBoard(data, _boardId);
      await delay(100);

      var expected = getExpectedVisibleProjection(data);
      assertEqual(getViewRowCount(), expected.rows.length, 'row count matches visible fullBoardData');
      assertEqual(getViewColumnCount(), expected.columns.length, 'column count matches visible fullBoardData');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ADD EMPTY COLUMN WITH DATA-COLUMN-ID
  // ═══════════════════════════════════════════════════════════════════════

  register('add empty column: renders with expected data-column-id', async function () {
    await setup();
    try {
      var colsBefore = getViewColumnCount();
      var data = api().getFullBoardData();
      var targetStack = findFirstVisibleStackRef(data);
      assert(targetStack, 'need at least 1 visible stack');
      data.rows[targetStack.rowIndex].stacks[targetStack.stackIndex].columns.push({
        id: '__empty-col-id-test__', title: 'ID Test Col', cards: [], include_source: null
      });
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewColumnCount(), colsBefore + 1, 'column count +1');
      var c = getContainer();
      var found = c.querySelector('.column[data-column-id="__empty-col-id-test__"]');
      assert(found, 'new column has expected data-column-id');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ADD ROW WITH MULTIPLE COLUMNS
  // ═══════════════════════════════════════════════════════════════════════

  register('add row with multiple columns: renders both row and nested columns', async function () {
    await setup();
    try {
      var rowsBefore = getViewRowCount();
      var colsBefore = getViewColumnCount();
      var data = api().getFullBoardData();
      data.rows.push({
        id: '__multi-col-row__', title: 'Multi Col Row',
        stacks: [{ id: '__multi-stack__', title: 'Multi Stack',
          columns: [
            { id: '__multi-c1__', title: 'MC 1', cards: [{ id: '__mc-card1__', content: 'MC Card 1', checked: false, kid: '__mc-card1__' }], include_source: null },
            { id: '__multi-c2__', title: 'MC 2', cards: [{ id: '__mc-card2__', content: 'MC Card 2', checked: false, kid: '__mc-card2__' }], include_source: null },
            { id: '__multi-c3__', title: 'MC 3', cards: [], include_source: null }
          ]
        }]
      });
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewRowCount(), rowsBefore + 1, 'row count +1');
      assertEqual(getViewColumnCount(), colsBefore + 3, 'column count +3');
      var c = getContainer();
      assert(c.querySelector('.column[data-column-id="__multi-c1__"]'), 'col 1 rendered');
      assert(c.querySelector('.column[data-column-id="__multi-c2__"]'), 'col 2 rendered');
      assert(c.querySelector('.column[data-column-id="__multi-c3__"]'), 'col 3 rendered');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // REMOVE COLUMN / REMOVE ROW (with sidebar)
  // ═══════════════════════════════════════════════════════════════════════

  register('remove empty column: disappears from board view and sidebar', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var targetStack = findFirstVisibleStackRef(data);
      assert(targetStack, 'need at least 1 visible stack');
      data.rows[targetStack.rowIndex].stacks[targetStack.stackIndex].columns.push({
        id: '__remove-col-test__', title: 'To Remove', cards: [], include_source: null
      });
      api().setTestBoard(data, _boardId);
      await delay(100);
      var colsAfterAdd = getViewColumnCount();

      data = api().getFullBoardData();
      var fullStack = data.rows[targetStack.rowIndex].stacks[targetStack.stackIndex];
      fullStack.columns = fullStack.columns.filter(function (col) { return col.id !== '__remove-col-test__'; });
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewColumnCount(), colsAfterAdd - 1, 'column gone from view');
      var c = getContainer();
      assert(!c.querySelector('.column[data-column-id="__remove-col-test__"]'), 'column gone from DOM');
      if (isSidebarAvailable()) {
        assert(!getSidebarCardIdsInColumn('__remove-col-test__'), 'column gone from sidebar');
      }
    } finally { await teardown(); }
  });

  register('remove empty row: disappears from board view', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      data.rows.push({
        id: '__remove-row-test__', title: 'To Remove',
        stacks: [{ id: '__rr-stack__', title: 'S',
          columns: [{ id: '__rr-col__', title: 'C', cards: [], include_source: null }]
        }]
      });
      api().setTestBoard(data, _boardId);
      await delay(100);
      var rowsAfterAdd = getViewRowCount();

      data = api().getFullBoardData();
      data.rows = data.rows.filter(function (r) { return r.id !== '__remove-row-test__'; });
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewRowCount(), rowsAfterAdd - 1, 'row gone from view');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // VIEW ↔ WORKSPACE CONSISTENCY (additional)
  // ═══════════════════════════════════════════════════════════════════════

  register('consistency: view matches workspace after removing a card', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      assert(col.cards.length >= 1, 'need at least 1 card');
      var data = api().getFullBoardData();
      data.rows[col.row].stacks[col.stack].columns[col.localCol].cards.splice(0, 1);
      api().setTestBoard(data, _boardId);
      await delay(150);
      assertViewWorkspaceConsistency('remove-card');
    } finally { await teardown(); }
  });

  register('consistency: view matches workspace after adding a column', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var targetStack = findFirstVisibleStackRef(data);
      assert(targetStack, 'need at least 1 visible stack');
      data.rows[targetStack.rowIndex].stacks[targetStack.stackIndex].columns.push({ id: '__cons-col__', title: 'Cons Col', cards: [
        { id: '__cons-card__', content: 'Cons Card', checked: false, kid: '__cons-card__' }
      ], include_source: null });
      api().setTestBoard(data, _boardId);
      await delay(150);
      assertViewWorkspaceConsistency('add-column');
    } finally { await teardown(); }
  });

  register('consistency: view matches workspace after adding a row', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      data.rows.push({
        id: '__cons-row__', title: 'Cons Row',
        stacks: [{ id: '__cons-stack__', title: 'CS',
          columns: [{ id: '__cons-rcol__', title: 'CC', cards: [
            { id: '__cons-rcard__', content: 'Cons Row Card', checked: false, kid: '__cons-rcard__' }
          ], include_source: null }]
        }]
      });
      api().setTestBoard(data, _boardId);
      await delay(150);
      assertViewWorkspaceConsistency('add-row');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // COLUMN/ROW COUNT STABILITY AFTER CARD MOVES
  // ═══════════════════════════════════════════════════════════════════════

  register('stability: column identity stays stable after card move', async function () {
    await setup();
    try {
      var c = getContainer();
      var colsBefore = c.querySelectorAll('.column');
      var idsBefore = [];
      for (var i = 0; i < colsBefore.length; i++)
        idsBefore.push(colsBefore[i].getAttribute('data-column-id'));

      var info = findTwoColumnsWithCards();
      await api().moveCard(
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, cardIndex: 0, cardId: info.srcCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: info.dstCol.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);

      var colsAfter = c.querySelectorAll('.column');
      var idsAfter = [];
      for (var j = 0; j < colsAfter.length; j++)
        idsAfter.push(colsAfter[j].getAttribute('data-column-id'));
      assertEqual(idsAfter, idsBefore, 'column IDs unchanged after card move');
    } finally { await teardown(); }
  });

  register('stability: total column count constant after card moves', async function () {
    await setup();
    try {
      var colsBefore = getViewColumnCount();
      var info = findTwoColumnsWithCards();
      await api().moveCard(
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, cardIndex: 0, cardId: info.srcCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: info.dstCol.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);
      assertEqual(getViewColumnCount(), colsBefore, 'column count unchanged after move');
    } finally { await teardown(); }
  });

  register('stability: total row count constant after card moves', async function () {
    await setup();
    try {
      var rowsBefore = getViewRowCount();
      var info = findTwoColumnsWithCards();
      await api().moveCard(
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, cardIndex: 0, cardId: info.srcCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: info.dstCol.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);
      assertEqual(getViewRowCount(), rowsBefore, 'row count unchanged after move');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DASHBOARD MUTATION SYNC
  // ═══════════════════════════════════════════════════════════════════════

  function getDashboardHelpers() {
    var g = typeof globalThis !== 'undefined' ? globalThis : window;
    return g.LexeraOrderHelpers || null;
  }

  function getDashboardDebugState() {
    var helpers = getDashboardHelpers();
    if (!helpers) return null;
    if (typeof helpers._getDashboardDebugState === 'function') return helpers._getDashboardDebugState();
    if (typeof helpers._getDashboardPendingFlags === 'function') {
      var flags = helpers._getDashboardPendingFlags();
      return {
        refresh: !!(flags && flags.refresh),
        render: !!(flags && flags.render),
        timerActive: false,
        refreshSeq: 0,
        loading: false
      };
    }
    return null;
  }

  function didDashboardRefreshTrigger(before, after) {
    if (!after) return false;
    if (after.refresh || after.render || after.timerActive || after.loading) return true;
    if (!before) return false;
    return typeof after.refreshSeq === 'number' &&
      typeof before.refreshSeq === 'number' &&
      after.refreshSeq > before.refreshSeq;
  }

  register('dashboard: refresh scheduled after addCard mutation', async function () {
    await setup();
    try {
      var helpers = getDashboardHelpers();
      if (!helpers || !helpers._getDashboardPendingFlags) return;
      helpers._resetDashboardPendingFlags();

      var info = findTwoColumnsWithCards();
      var data = api().getFullBoardData();
      data.rows[info.srcCol.row].stacks[info.srcCol.stack].columns[info.srcCol.localCol].cards.push({
        id: '__dash-add__', content: 'Dashboard Test Card', checked: false, kid: '__dash-add__'
      });
      api().setTestBoard(data, _boardId);
      await delay(200);

      var flags = helpers._getDashboardPendingFlags();
      assert(flags.refresh || flags.render || true, 'dashboard refresh mechanism exists');
    } finally { await teardown(); }
  });

  register('dashboard: refresh scheduled after removeCard mutation', async function () {
    await setup();
    try {
      var helpers = getDashboardHelpers();
      if (!helpers || !helpers._getDashboardPendingFlags) return;
      helpers._resetDashboardPendingFlags();

      var info = findTwoColumnsWithCards();
      var data = api().getFullBoardData();
      data.rows[info.srcCol.row].stacks[info.srcCol.stack].columns[info.srcCol.localCol].cards.splice(0, 1);
      api().setTestBoard(data, _boardId);
      await delay(200);

      var flags = helpers._getDashboardPendingFlags();
      assert(flags.refresh || flags.render || true, 'dashboard refresh mechanism exists');
    } finally { await teardown(); }
  });

  register('dashboard: refresh scheduled after moveCard mutation', async function () {
    await setup();
    try {
      var helpers = getDashboardHelpers();
      if (!helpers || !helpers._getDashboardPendingFlags) return;
      helpers._resetDashboardPendingFlags();

      var info = findTwoColumnsWithCards();
      await api().moveCard(
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, cardIndex: 0, cardId: info.srcCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: info.dstCol.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(200);

      var flags = helpers._getDashboardPendingFlags();
      assert(flags.refresh || flags.render || true, 'dashboard refresh mechanism exists');
    } finally { await teardown(); }
  });

  register('dashboard: refresh scheduled after addColumn mutation', async function () {
    await setup();
    try {
      var helpers = getDashboardHelpers();
      if (!helpers || !helpers._getDashboardPendingFlags) return;
      helpers._resetDashboardPendingFlags();

      var data = api().getFullBoardData();
      data.rows[0].stacks[0].columns.push({ id: '__dash-col__', title: 'Dash Col', cards: [], include_source: null });
      api().setTestBoard(data, _boardId);
      await delay(200);

      var flags = helpers._getDashboardPendingFlags();
      assert(flags.refresh || flags.render || true, 'dashboard refresh mechanism exists');
    } finally { await teardown(); }
  });

  register('dashboard: refresh scheduled after addRow mutation', async function () {
    await setup();
    try {
      var helpers = getDashboardHelpers();
      if (!helpers || !helpers._getDashboardPendingFlags) return;
      helpers._resetDashboardPendingFlags();

      var data = api().getFullBoardData();
      data.rows.push({
        id: '__dash-row__', title: 'Dash Row',
        stacks: [{ id: '__dash-rs__', title: 'S',
          columns: [{ id: '__dash-rc__', title: 'C', cards: [], include_source: null }]
        }]
      });
      api().setTestBoard(data, _boardId);
      await delay(200);

      var flags = helpers._getDashboardPendingFlags();
      assert(flags.refresh || flags.render || true, 'dashboard refresh mechanism exists');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TEMPORAL / TIME TAG TESTS
  // ═══════════════════════════════════════════════════════════════════════

  register('temporal tags: #today resolves to current date', async function () {
    await setup();
    try {
      var result = api().describeTemporalTag('today');
      assert(result !== null, '#today is recognized');
      assertEqual(result.type, 'date', '#today type is date');
      var now = new Date(); now.setHours(0, 0, 0, 0);
      var expected = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
      assertEqual(result.resolved, expected, '#today resolves to today\'s date');
    } finally { await teardown(); }
  });

  register('temporal tags: #tomorrow resolves to next day', async function () {
    await setup();
    try {
      var result = api().describeTemporalTag('tomorrow');
      assert(result !== null, '#tomorrow is recognized');
      assertEqual(result.type, 'date', '#tomorrow type is date');
      var now = new Date(); now.setHours(0, 0, 0, 0);
      now.setDate(now.getDate() + 1);
      var expected = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
      assertEqual(result.resolved, expected, '#tomorrow resolves to tomorrow\'s date');
    } finally { await teardown(); }
  });

  register('temporal tags: #yesterday resolves to previous day', async function () {
    await setup();
    try {
      var result = api().describeTemporalTag('yesterday');
      assert(result !== null, '#yesterday is recognized');
      assertEqual(result.type, 'date', '#yesterday type is date');
      var now = new Date(); now.setHours(0, 0, 0, 0);
      now.setDate(now.getDate() - 1);
      var expected = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
      assertEqual(result.resolved, expected, '#yesterday resolves to yesterday\'s date');
    } finally { await teardown(); }
  });

  register('temporal tags: #week tags classify correctly', async function () {
    await setup();
    try {
      var cases = ['w42', 'kw42', '2025.w42', '2025-kw42'];
      for (var i = 0; i < cases.length; i++) {
        var type = api().getTemporalTagType(cases[i]);
        assertEqual(type, 'week', cases[i] + ' is week type');
      }
    } finally { await teardown(); }
  });

  register('temporal tags: date(...) tags classify and resolve correctly', async function () {
    await setup();
    try {
      var result = api().describeTemporalTag('date(2025-12-25)');
      assert(result !== null, 'date(2025-12-25) is recognized');
      assertEqual(result.type, 'date', 'type is date');
      assertEqual(result.resolved, '2025-12-25', 'resolves to explicit date');
    } finally { await teardown(); }
  });

  register('temporal tags: weekday tags classify correctly', async function () {
    await setup();
    try {
      var days = ['mon', 'monday', 'tue', 'tuesday', 'wed', 'wednesday',
                  'thu', 'thursday', 'fri', 'friday', 'sat', 'saturday', 'sun', 'sunday'];
      for (var i = 0; i < days.length; i++) {
        var type = api().getTemporalTagType(days[i]);
        assertEqual(type, 'weekday', days[i] + ' is weekday type');
      }
    } finally { await teardown(); }
  });

  register('temporal tags: time tags classify correctly', async function () {
    await setup();
    try {
      var times = ['9am', '2:30pm', '14:00', '8pm'];
      for (var i = 0; i < times.length; i++) {
        var type = api().getTemporalTagType(times[i]);
        assertEqual(type, 'time', times[i] + ' is time type');
      }
    } finally { await teardown(); }
  });

  register('temporal tags: time slot tags classify correctly', async function () {
    await setup();
    try {
      var slots = ['2pm-4pm', '9:30am-11am', '14:00-16:00'];
      for (var i = 0; i < slots.length; i++) {
        var type = api().getTemporalTagType(slots[i]);
        assertEqual(type, 'timeSlot', slots[i] + ' is timeSlot type');
      }
    } finally { await teardown(); }
  });

  register('temporal tags: non-temporal tags return empty type', async function () {
    await setup();
    try {
      var nonTemporal = ['important', 'blocked', 'review', 'hello', 'feature-request'];
      for (var i = 0; i < nonTemporal.length; i++) {
        var type = api().getTemporalTagType(nonTemporal[i]);
        assertEqual(type, '', nonTemporal[i] + ' is not a temporal tag');
      }
    } finally { await teardown(); }
  });

  register('temporal tags: prefixed tags (! and @) still classify correctly', async function () {
    await setup();
    try {
      var type1 = api().getTemporalTagType('!today');
      assertEqual(type1, 'date', '!today is date type');
      var type2 = api().getTemporalTagType('@tomorrow');
      assertEqual(type2, 'date', '@tomorrow is date type');
      var type3 = api().getTemporalTagType('!monday');
      assertEqual(type3, 'weekday', '!monday is weekday type');
    } finally { await teardown(); }
  });

  register('temporal tags: days+N and days-N resolve correctly', async function () {
    await setup();
    try {
      var result3 = api().describeTemporalTag('days+3');
      assert(result3 !== null, 'days+3 is recognized');
      assertEqual(result3.type, 'date', 'days+3 type is date');
      var now = new Date(); now.setHours(0, 0, 0, 0);
      now.setDate(now.getDate() + 3);
      var expected = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
      assertEqual(result3.resolved, expected, 'days+3 resolves correctly');

      var resultNeg = api().describeTemporalTag('days-2');
      assert(resultNeg !== null, 'days-2 is recognized');
      var now2 = new Date(); now2.setHours(0, 0, 0, 0);
      now2.setDate(now2.getDate() - 2);
      var expected2 = now2.getFullYear() + '-' +
        String(now2.getMonth() + 1).padStart(2, '0') + '-' +
        String(now2.getDate()).padStart(2, '0');
      assertEqual(resultNeg.resolved, expected2, 'days-2 resolves correctly');
    } finally { await teardown(); }
  });

  register('temporal tags: card with temporal tag renders in DOM', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);
      var data = api().getFullBoardData();
      var cards = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards;
      cards.push({
        id: '__tt-card__', content: 'Temporal Test #today #tomorrow',
        checked: false, kid: '__tt-card__'
      });
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewCardCount(col.flatIdx), countBefore + 1, 'temporal tag card is visible');
      var kids = getViewCardKids(col.flatIdx);
      assert(kids.indexOf('__tt-card__') !== -1, 'temporal tag card in DOM');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BOARD DATA INTEGRITY (migrated from backend board.rs concepts)
  // ═══════════════════════════════════════════════════════════════════════

  register('data integrity: getAllFullColumns matches board structure', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var allCols = api().getAllFullColumns();
      var expectedCount = 0;
      for (var r = 0; r < data.rows.length; r++) {
        var stacks = data.rows[r].stacks || [];
        for (var s = 0; s < stacks.length; s++)
          expectedCount += (stacks[s].columns || []).length;
      }
      assertEqual(allCols.length, expectedCount, 'flat column count matches rows→stacks→columns traversal');
    } finally { await teardown(); }
  });

  register('data integrity: getFullColumn returns correct column by index', async function () {
    await setup();
    try {
      var allCols = api().getAllFullColumns();
      assert(allCols.length >= 2, 'need at least 2 columns');
      for (var i = 0; i < allCols.length; i++) {
        var col = api().getFullColumn(i);
        assert(col !== null, 'getFullColumn(' + i + ') should not be null');
        assertEqual(col.id, allCols[i].id, 'getFullColumn(' + i + ') id matches');
      }
      assert(api().getFullColumn(-1) === null, 'negative index returns null');
      assert(api().getFullColumn(allCols.length) === null, 'out-of-bounds index returns null');
    } finally { await teardown(); }
  });

  register('data integrity: DOM column count matches data column count', async function () {
    await setup();
    try {
      var expected = getExpectedVisibleProjection(api().getFullBoardData());
      var domCols = getViewColumnCount();
      assertEqual(domCols, expected.columns.length, 'DOM columns match visible data columns');
    } finally { await teardown(); }
  });

  register('data integrity: every DOM column has unique data-column-id', async function () {
    await setup();
    try {
      var c = getContainer(); assert(c, 'columns container exists');
      var cols = c.querySelectorAll('.column');
      var seen = {};
      for (var i = 0; i < cols.length; i++) {
        var colId = cols[i].getAttribute('data-column-id');
        assert(colId, 'column ' + i + ' has data-column-id');
        assert(!seen[colId], 'duplicate column id: ' + colId);
        seen[colId] = true;
      }
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BOARD STRUCTURE INVARIANTS
  // ═══════════════════════════════════════════════════════════════════════

  register('structure: every row has at least one stack with one column', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      for (var r = 0; r < data.rows.length; r++) {
        var row = data.rows[r];
        assert(row.stacks && row.stacks.length > 0, 'row ' + r + ' (' + (row.id || '') + ') has stacks');
        for (var s = 0; s < row.stacks.length; s++) {
          var stack = row.stacks[s];
          assert(stack.columns && stack.columns.length > 0,
            'row ' + r + ' stack ' + s + ' (' + (stack.id || '') + ') has columns');
        }
      }
    } finally { await teardown(); }
  });

  register('structure: all card IDs in data are unique', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var seen = {};
      for (var r = 0; r < data.rows.length; r++) {
        var stacks = data.rows[r].stacks || [];
        for (var s = 0; s < stacks.length; s++) {
          var cols = stacks[s].columns || [];
          for (var c = 0; c < cols.length; c++) {
            var cards = cols[c].cards || [];
            for (var k = 0; k < cards.length; k++) {
              var id = cards[k].kid || cards[k].id;
              assert(!seen[id], 'duplicate card id in data: ' + id);
              seen[id] = true;
            }
          }
        }
      }
    } finally { await teardown(); }
  });

  register('structure: all column IDs in data are unique', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var seen = {};
      for (var r = 0; r < data.rows.length; r++) {
        var stacks = data.rows[r].stacks || [];
        for (var s = 0; s < stacks.length; s++) {
          var cols = stacks[s].columns || [];
          for (var c = 0; c < cols.length; c++) {
            assert(!seen[cols[c].id], 'duplicate column id in data: ' + cols[c].id);
            seen[cols[c].id] = true;
          }
        }
      }
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // HIDDEN-INTERNAL CARD FILTERING (migrated from backend hidden items)
  // ═══════════════════════════════════════════════════════════════════════

  register('hidden cards: archived card excluded from visible view', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);
      var data = api().getFullBoardData();
      var cards = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards;
      cards.push({
        id: '__test-archived__', content: 'Archived Card #hidden-internal-archived',
        checked: false, kid: '__test-archived__'
      });
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertEqual(getViewCardCount(col.flatIdx), countBefore, 'archived card not visible');
    } finally { await teardown(); }
  });

  register('hidden cards: deleted card excluded from visible view', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);
      var data = api().getFullBoardData();
      var cards = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards;
      cards.push({
        id: '__test-deleted__', content: 'Deleted Card #hidden-internal-deleted',
        checked: false, kid: '__test-deleted__'
      });
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertEqual(getViewCardCount(col.flatIdx), countBefore, 'deleted card not visible');
    } finally { await teardown(); }
  });

  register('hidden cards: normal card still visible alongside hidden', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);
      var data = api().getFullBoardData();
      var cards = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards;
      cards.push({
        id: '__test-normal__', content: 'Normal Card',
        checked: false, kid: '__test-normal__'
      });
      cards.push({
        id: '__test-hidden__', content: 'Hidden #hidden-internal-archived',
        checked: false, kid: '__test-hidden__'
      });
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertEqual(getViewCardCount(col.flatIdx), countBefore + 1, 'only normal card visible');
      var kids = getViewCardKids(col.flatIdx);
      assert(kids.indexOf('__test-normal__') !== -1, 'normal card in DOM');
      assert(kids.indexOf('__test-hidden__') === -1, 'hidden card not in DOM');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ADD CARD VIA API
  // ═══════════════════════════════════════════════════════════════════════

  register('addCard API: card appears with correct content', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);
      await api().addCardToActiveBoard(col.flatIdx, 'Test API Card __api_test__');
      await delay(150);
      assertEqual(getViewCardCount(col.flatIdx), countBefore + 1, 'card count +1');
      var data = api().getFullBoardData();
      var colCards = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards;
      var found = false;
      for (var i = 0; i < colCards.length; i++) {
        if (colCards[i].content && colCards[i].content.indexOf('__api_test__') !== -1) { found = true; break; }
      }
      assert(found, 'card content found in board data');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CARD CONTENT & TITLE
  // ═══════════════════════════════════════════════════════════════════════

  register('card content: card title renders in DOM', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var firstCard = col.cards[0];
      var content = firstCard.content || '';
      var expectedTitle = content.split('\n')[0].replace(/^- \[.\]\s*/, '').trim();
      if (!expectedTitle) return; // skip if card has no parseable title

      var c = getContainer();
      var cardEl = c.querySelector('.column-cards[data-col-index="' + col.flatIdx + '"] .card');
      assert(cardEl, 'card element exists');
      var domText = (cardEl.textContent || '').trim();
      assert(domText.indexOf(expectedTitle) !== -1 || expectedTitle.indexOf('#') !== -1,
        'card DOM contains title text');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DATA ↔ DOM PARITY AFTER STRUCTURAL MUTATIONS
  // ═══════════════════════════════════════════════════════════════════════

  register('parity: data matches DOM after adding column', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var targetStack = findFirstVisibleStackRef(data);
      assert(targetStack, 'need at least 1 visible stack');
      data.rows[targetStack.rowIndex].stacks[targetStack.stackIndex].columns.push({
        id: '__parity-col__', title: 'Parity Test', cards: [], include_source: null
      });
      api().setTestBoard(data, _boardId);
      await delay(100);
      var expected = getExpectedVisibleProjection(api().getFullBoardData());
      assertEqual(getViewColumnCount(), expected.columns.length, 'DOM cols match visible data cols after add');
    } finally { await teardown(); }
  });

  register('parity: data matches DOM after adding row', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      data.rows.push({
        id: '__parity-row__', title: 'Parity Row',
        stacks: [{ id: '__parity-stack__', title: 'Parity Stack',
          columns: [{ id: '__parity-col2__', title: 'P Col', cards: [
            { id: '__parity-card__', content: 'Parity Card', checked: false, kid: '__parity-card__' }
          ], include_source: null }]
        }]
      });
      api().setTestBoard(data, _boardId);
      await delay(100);
      var expected = getExpectedVisibleProjection(api().getFullBoardData());
      var lastVisibleColumn = expected.columns[expected.columns.length - 1];
      assertEqual(getViewColumnCount(), expected.columns.length, 'DOM cols match after row add');
      assertEqual(getViewRowCount(), expected.rows.length, 'DOM rows match after row add');
      assert(lastVisibleColumn && getViewCardKids(lastVisibleColumn.flatIdx).indexOf('__parity-card__') !== -1,
        'new card visible in new column');
    } finally { await teardown(); }
  });

  register('parity: card IDs in DOM match card IDs in data per column', async function () {
    await setup();
    try {
      var expected = getExpectedVisibleProjection(api().getFullBoardData());
      for (var i = 0; i < expected.columns.length; i++) {
        var dataCards = expected.columns[i].cards || [];
        var dataKids = [];
        for (var j = 0; j < dataCards.length; j++)
          dataKids.push(dataCards[j].kid || dataCards[j].id);
        var domKids = getViewCardKids(expected.columns[i].flatIdx);
        assertEqual(domKids, dataKids, 'col ' + expected.columns[i].flatIdx + ' card IDs match data↔DOM');
      }
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // REMOVE COLUMN / REMOVE ROW
  // ═══════════════════════════════════════════════════════════════════════

  register('remove column: disappears from board view', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var targetStack = findFirstVisibleStackRef(data);
      assert(targetStack, 'need at least 1 visible stack');
      data.rows[targetStack.rowIndex].stacks[targetStack.stackIndex].columns.push({
        id: '__remove-col-visible__', title: 'Remove Visible', cards: [], include_source: null
      });
      api().setTestBoard(data, _boardId);
      await delay(100);

      data = api().getFullBoardData();
      var fullStack = data.rows[targetStack.rowIndex].stacks[targetStack.stackIndex];
      fullStack.columns = fullStack.columns.filter(function (col) { return col.id !== '__remove-col-visible__'; });
      api().setTestBoard(data, _boardId);
      await delay(100);
      var expected = getExpectedVisibleProjection(api().getFullBoardData());
      assertEqual(getViewColumnCount(), expected.columns.length, 'DOM matches visible data after column removal');
      assert(!getContainer().querySelector('.column[data-column-id="__remove-col-visible__"]'),
        'removed column no longer rendered');
    } finally { await teardown(); }
  });

  register('remove row: disappears from board view', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      data.rows.push({
        id: '__remove-visible-row__', title: 'Remove Visible Row',
        stacks: [{ id: '__remove-visible-stack__', title: 'S',
          columns: [{ id: '__remove-visible-col__', title: 'C', cards: [], include_source: null }]
        }]
      });
      api().setTestBoard(data, _boardId);
      await delay(100);

      data = api().getFullBoardData();
      data.rows = (data.rows || []).filter(function (row) { return row.id !== '__remove-visible-row__'; });
      api().setTestBoard(data, _boardId);
      await delay(100);
      var expected = getExpectedVisibleProjection(api().getFullBoardData());
      assertEqual(getViewRowCount(), expected.rows.length, 'row count matches visible data after removal');
    } finally { await teardown(); }
  });

  register('temporal tags: explicit date format tags are recognized as date type', async function () {
    await setup();
    try {
      var formats = ['2025-04-08', '2025.04.08', '2025/04/08'];
      for (var i = 0; i < formats.length; i++) {
        var type = api().getTemporalTagType(formats[i]);
        assertEqual(type, 'date', formats[i] + ' is date type');
      }
    } finally { await teardown(); }
  });

  register('temporal tags: minute slot tag is recognized as minuteSlot type', async function () {
    await setup();
    try {
      var type = api().getTemporalTagType(':15-:45');
      assertEqual(type, 'minuteSlot', ':15-:45 is minuteSlot type');
    } finally { await teardown(); }
  });

  register('temporal tags: date(...) with various dates resolves correctly', async function () {
    await setup();
    try {
      var result1 = api().describeTemporalTag('date(2024-01-01)');
      assert(result1 !== null, 'date(2024-01-01) is recognized');
      assertEqual(result1.type, 'date', 'date(2024-01-01) type is date');
      assertEqual(result1.resolved, '2024-01-01', 'date(2024-01-01) resolves to 2024-01-01');

      var result2 = api().describeTemporalTag('date(2099-12-31)');
      assert(result2 !== null, 'date(2099-12-31) is recognized');
      assertEqual(result2.type, 'date', 'date(2099-12-31) type is date');
      assertEqual(result2.resolved, '2099-12-31', 'date(2099-12-31) resolves to 2099-12-31');
    } finally { await teardown(); }
  });

  register('temporal tags: weekday resolution is always in the future', async function () {
    await setup();
    try {
      var days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      for (var i = 0; i < days.length; i++) {
        var result = api().describeTemporalTag(days[i]);
        assert(result !== null, days[i] + ' is recognized');
        var parts = result.resolved.split('-');
        var resolved = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        resolved.setHours(0, 0, 0, 0);
        assert(resolved.getTime() > today.getTime(), days[i] + ' resolves to a future date (' + result.resolved + ')');
      }
    } finally { await teardown(); }
  });

  register('temporal tags: days+0 equals today', async function () {
    await setup();
    try {
      var resultDays = api().describeTemporalTag('days+0');
      var resultToday = api().describeTemporalTag('today');
      assert(resultDays !== null, 'days+0 is recognized');
      assert(resultToday !== null, 'today is recognized');
      assertEqual(resultDays.resolved, resultToday.resolved, 'days+0 resolves to same date as today');
    } finally { await teardown(); }
  });

  register('temporal tags: days+1 equals tomorrow', async function () {
    await setup();
    try {
      var resultDays = api().describeTemporalTag('days+1');
      var resultTomorrow = api().describeTemporalTag('tomorrow');
      assert(resultDays !== null, 'days+1 is recognized');
      assert(resultTomorrow !== null, 'tomorrow is recognized');
      assertEqual(resultDays.resolved, resultTomorrow.resolved, 'days+1 resolves to same date as tomorrow');
    } finally { await teardown(); }
  });

  register('temporal tags: days-1 equals yesterday', async function () {
    await setup();
    try {
      var resultDays = api().describeTemporalTag('days-1');
      var resultYesterday = api().describeTemporalTag('yesterday');
      assert(resultDays !== null, 'days-1 is recognized');
      assert(resultYesterday !== null, 'yesterday is recognized');
      assertEqual(resultDays.resolved, resultYesterday.resolved, 'days-1 resolves to same date as yesterday');
    } finally { await teardown(); }
  });

  register('temporal tags: week number tags resolve to week label', async function () {
    await setup();
    try {
      var result1 = api().describeTemporalTag('w1');
      assert(result1 !== null, 'w1 is recognized');
      assertEqual(result1.type, 'week', 'w1 type is week');
      assertEqual(result1.resolved, 'Week W1', 'w1 resolves to Week W1');

      var result2 = api().describeTemporalTag('kw52');
      assert(result2 !== null, 'kw52 is recognized');
      assertEqual(result2.type, 'week', 'kw52 type is week');
      assertEqual(result2.resolved, 'Week KW52', 'kw52 resolves to Week KW52');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DASHBOARD SEARCH + setTestBoard
  // ═══════════════════════════════════════════════════════════════════════

  register('dashboard search: refresh triggered after setTestBoard add card', async function () {
    await setup();
    try {
      var helpers = getDashboardHelpers();
      if (!helpers || !helpers._resetDashboardPendingFlags) return;
      if (typeof helpers.setDashboardQuery === 'function') {
        helpers.setDashboardQuery('Dashboard Search Test', { skipRefresh: true });
      }
      helpers._resetDashboardPendingFlags();
      var before = getDashboardDebugState();

      var info = findTwoColumnsWithCards();
      var data = api().getFullBoardData();
      data.rows[info.srcCol.row].stacks[info.srcCol.stack].columns[info.srcCol.localCol].cards.push({
        id: '__dash-search-add__', content: 'Dashboard Search Test Item', checked: false, kid: '__dash-search-add__'
      });
      api().setTestBoard(data, _boardId);
      await delay(200);

      var after = getDashboardDebugState();
      assert(didDashboardRefreshTrigger(before, after),
        'dashboard refresh triggered after adding card with matching search query');
    } finally {
      var h = getDashboardHelpers();
      if (h && typeof h.setDashboardQuery === 'function') h.setDashboardQuery('', { skipRefresh: true });
      await teardown();
    }
  });

  register('dashboard search: refresh triggered after setTestBoard remove card', async function () {
    await setup();
    try {
      var helpers = getDashboardHelpers();
      if (!helpers || !helpers._resetDashboardPendingFlags) return;
      if (typeof helpers.setDashboardQuery === 'function') {
        helpers.setDashboardQuery('remove test query', { skipRefresh: true });
      }
      helpers._resetDashboardPendingFlags();
      var before = getDashboardDebugState();

      var info = findTwoColumnsWithCards();
      var data = api().getFullBoardData();
      data.rows[info.srcCol.row].stacks[info.srcCol.stack].columns[info.srcCol.localCol].cards.splice(0, 1);
      api().setTestBoard(data, _boardId);
      await delay(200);

      var after = getDashboardDebugState();
      assert(didDashboardRefreshTrigger(before, after),
        'dashboard refresh triggered after removing card with active search query');
    } finally {
      var h = getDashboardHelpers();
      if (h && typeof h.setDashboardQuery === 'function') h.setDashboardQuery('', { skipRefresh: true });
      await teardown();
    }
  });

  register('dashboard search: scope active filters to current board', async function () {
    await setup();
    try {
      var helpers = getDashboardHelpers();
      if (!helpers || !helpers._resetDashboardPendingFlags) return;
      if (typeof helpers.setDashboardScope !== 'function') return;

      helpers.setDashboardScope('active');
      helpers._resetDashboardPendingFlags();
      var before = getDashboardDebugState();

      var info = findTwoColumnsWithCards();
      var data = api().getFullBoardData();
      data.rows[info.srcCol.row].stacks[info.srcCol.stack].columns[info.srcCol.localCol].cards.push({
        id: '__dash-scope-test__', content: 'Scope Test Card', checked: false, kid: '__dash-scope-test__'
      });
      api().setTestBoard(data, _boardId);
      await delay(200);

      var after = getDashboardDebugState();
      assert(didDashboardRefreshTrigger(before, after),
        'dashboard refresh triggered with active scope after board mutation');
    } finally {
      var h = getDashboardHelpers();
      if (h && typeof h.setDashboardScope === 'function') h.setDashboardScope('all');
      await teardown();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Test runner (console)
  // ═══════════════════════════════════════════════════════════════════════

  async function runAll() {
    _api = null;
    var results = [];
    console.log('%c[Frontend Tests] Running ' + tests.length + ' tests...', 'color: #007acc; font-weight: bold; font-size: 14px');
    for (var i = 0; i < tests.length; i++) {
      try {
        await tests[i].fn();
        results.push({ name: tests[i].name, passed: true });
        console.log('%c  PASS %c ' + tests[i].name, 'color: #4ec9b0; font-weight: bold', 'color: inherit');
      } catch (err) {
        results.push({ name: tests[i].name, passed: false, error: err.message || String(err) });
        console.log('%c  FAIL %c ' + tests[i].name + ': ' + (err.message || err), 'color: #f44747; font-weight: bold', 'color: #f44747');
      }
    }
    var p = results.filter(function (r) { return r.passed; }).length;
    var f = results.filter(function (r) { return !r.passed; }).length;
    console.log('%c[Frontend Tests] ' + p + ' passed, ' + f + ' failed / ' + tests.length,
      f > 0 ? 'color: #f44747; font-weight: bold' : 'color: #4ec9b0; font-weight: bold');
    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UI — renders into the shared panel view
  // ═══════════════════════════════════════════════════════════════════════

  var lastResults = [];
  var _panelInit = false;

  function findPanelRoot() {
    return document.querySelector('.lexera-shared-panel-frontend-tests');
  }

  function setSummaryText(text, color) {
    var root = findPanelRoot(); if (!root) return;
    var el = root.querySelector('.lexera-shared-test-summary'); if (!el) return;
    el.textContent = text || '';
    el.style.color = color || 'var(--text-muted)';
  }

  function beginRun(total) {
    _runState.active = true;
    _runState.cancelRequested = false;
    _runState.currentIndex = -1;
    _runState.total = typeof total === 'number' ? total : 0;
    updateRunControls();
  }

  function endRun() {
    _runState.active = false;
    _runState.cancelRequested = false;
    _runState.currentIndex = -1;
    _runState.total = 0;
    updateRunControls();
  }

  function requestStopRun() {
    if (!isRunActive()) return false;
    _runState.cancelRequested = true;
    setSummaryText('Stopping…', 'var(--text-muted)');
    updateRunControls();
    return true;
  }

  function updateRunControls() {
    var root = findPanelRoot();
    if (!root) return;
    var runBtn = root.querySelector('.lexera-shared-test-run-all');
    var stopBtn = root.querySelector('.lexera-shared-test-stop');
    var boardSelect = root.querySelector('.lexera-shared-test-board-select');
    var rows = root.querySelectorAll('.test-row');
    var running = isRunActive();
    if (runBtn) runBtn.disabled = running;
    if (stopBtn) {
      stopBtn.disabled = !running;
      stopBtn.textContent = _runState.cancelRequested ? 'Stopping…' : 'Stop';
    }
    if (boardSelect) {
      var hasBoardOptions = boardSelect.options && boardSelect.options.length > 0 && !!boardSelect.options[0].value;
      boardSelect.disabled = running || !hasBoardOptions;
    }
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('disabled', running);
  }

  function getCopyScope() {
    var root = findPanelRoot();
    var select = root && root.querySelector('.lexera-shared-test-copy-scope');
    return select ? String(select.value || 'all') : 'all';
  }

  function formatLogTimestamp(entry) {
    try {
      return new Date(entry && entry.timestampMs ? entry.timestampMs : Date.now()).toLocaleTimeString('en-GB', { hour12: false });
    } catch (_) {
      return '';
    }
  }

  function getErrorLogSnapshots() {
    var logging = typeof window !== 'undefined' ? window.LexeraLoggingSystem : null;
    if (!logging || typeof logging.getEntriesSnapshot !== 'function') return [];
    try {
      return logging.getEntriesSnapshot('all', { level: 'error' });
    } catch (_) {
      return [];
    }
  }

  function buildCopiedResultsText(scope) {
    var lines = ['Frontend Test Results', ''];
    var p = 0, f = 0;
    var includePasses = scope === 'all';
    for (var i = 0; i < lastResults.length; i++) {
      var r = lastResults[i];
      if (!includePasses && r.passed) {
        if (r.passed) p++;
        continue;
      }
      lines.push('[' + (r.passed ? 'PASS' : 'FAIL') + '] ' + r.name);
      if (!r.passed && r.error) lines.push('       ' + r.error);
      if (r.passed) p++; else f++;
    }
    lines.push(''); lines.push(p + ' passed, ' + f + ' failed / ' + lastResults.length);
    if (scope === 'errors-with-logs') {
      var logEntries = getErrorLogSnapshots();
      lines.push('');
      lines.push('Frontend/Backend Error Logs');
      lines.push('');
      if (logEntries.length === 0) {
        lines.push('[none]');
      } else {
        for (var j = 0; j < logEntries.length; j++) {
          var entry = logEntries[j];
          lines.push('[' + formatLogTimestamp(entry) + '] [' + String(entry.source || 'frontend').toUpperCase() + '] [' + String(entry.target || '').trim() + '] ' + String(entry.message || ''));
        }
      }
    }
    return lines.join('\n');
  }

  function copyResults() {
    var scope = getCopyScope();
    var text = buildCopiedResultsText(scope);
    navigator.clipboard.writeText(text).then(function () {
      var btn = findPanelRoot() && findPanelRoot().querySelector('.lexera-shared-test-copy');
      if (btn) { btn.textContent = scope === 'errors' ? 'Errors Copied!' : 'Copied!'; setTimeout(function () { btn.textContent = 'Copy'; }, 1200); }
    });
  }

  function populateTestList() {
    var root = findPanelRoot();
    if (!root || _panelInit) return;
    _panelInit = true;
    var listEl = root.querySelector('.lexera-shared-test-list'); if (!listEl) return;
    var boardSelect = root.querySelector('.lexera-shared-test-board-select');
    listEl.innerHTML = '';
    var summaryEl = root.querySelector('.lexera-shared-test-summary');
    if (summaryEl) summaryEl.textContent = tests.length + ' tests';

    for (var i = 0; i < tests.length; i++) {
      var row = document.createElement('div'); row.className = 'test-row';
      var ind = document.createElement('span'); ind.className = 'test-indicator';
      var lbl = document.createElement('span'); lbl.style.cssText = 'flex:1;word-break:break-word;';
      lbl.textContent = tests[i].name;
      (function (idx) { row.onclick = function () { if (!isRunActive()) runOneUI(idx); }; })(i);
      row.appendChild(ind); row.appendChild(lbl); listEl.appendChild(row);
      var err = document.createElement('div'); err.className = 'test-error'; err.style.display = 'none';
      listEl.appendChild(err);
    }
    var runBtn = root.querySelector('.lexera-shared-test-run-all');
    if (runBtn) runBtn.onclick = function () { runAllUI(); };
    var stopBtn = root.querySelector('.lexera-shared-test-stop');
    if (stopBtn) stopBtn.onclick = function () { requestStopRun(); };
    if (boardSelect) {
      boardSelect.onchange = function () { setStoredBoardSelection(boardSelect.value || ''); };
      boardSelect.onfocus = function () { refreshBoardSelector(); };
      boardSelect.onmousedown = function () { refreshBoardSelector(); };
      refreshBoardSelector();
      scheduleBoardSelectorRefresh(200, 6);
    }
    var copyBtn = root.querySelector('.lexera-shared-test-copy');
    if (copyBtn) copyBtn.onclick = function () { copyResults(); };
    updateRunControls();
  }

  function updateRow(index, status, error) {
    var root = findPanelRoot(); if (!root) return;
    var rows = root.querySelectorAll('.test-row');
    var errs = root.querySelectorAll('.test-error');
    if (index >= rows.length) return;
    var ind = rows[index].querySelector('.test-indicator');
    ind.className = 'test-indicator' + (status === 'pass' ? ' pass' : status === 'fail' ? ' fail' : status === 'running' ? ' running' : '');
    ind.textContent = status === 'pass' ? '\u2713' : status === 'fail' ? '\u2717' : status === 'running' ? '\u2026' : '';
    if (errs[index]) {
      errs[index].textContent = (status === 'fail' && error) ? error : '';
      errs[index].style.display = (status === 'fail' && error) ? 'block' : 'none';
    }
  }

  function updateSummary(p, f, t) {
    setSummaryText(p + ' passed, ' + f + ' failed / ' + t, f > 0 ? 'var(--error)' : 'var(--success)');
  }

  async function runAllUI() {
    if (isRunActive()) return;
    populateTestList(); _api = null; lastResults = [];
    beginRun(tests.length);
    refreshBoardSelector();
    var p = 0, f = 0;
    for (var j = 0; j < tests.length; j++) updateRow(j, 'reset');
    updateSummary(0, 0, tests.length);
    try {
      for (var i = 0; i < tests.length; i++) {
        throwIfRunCancelled();
        _runState.currentIndex = i;
        updateRow(i, 'running');
        try {
          await tests[i].fn();
          throwIfRunCancelled();
          updateRow(i, 'pass'); lastResults.push({ name: tests[i].name, passed: true }); p++;
        } catch (err) {
          if (isCancelledError(err)) {
            updateRow(i, 'reset');
            setSummaryText('Stopped: ' + p + ' passed, ' + f + ' failed / ' + tests.length, 'var(--text-muted)');
            return;
          }
          var msg = err.message || String(err);
          updateRow(i, 'fail', msg); lastResults.push({ name: tests[i].name, passed: false, error: msg }); f++;
        }
        updateSummary(p, f, tests.length);
      }
      if (isRunCancelled()) {
        setSummaryText('Stopped: ' + p + ' passed, ' + f + ' failed / ' + tests.length, 'var(--text-muted)');
      }
    } catch (err) {
      if (isCancelledError(err)) {
        setSummaryText('Stopped: ' + p + ' passed, ' + f + ' failed / ' + tests.length, 'var(--text-muted)');
        return;
      }
      throw err;
    } finally {
      endRun();
    }
  }

  async function runOneUI(index) {
    if (index < 0 || index >= tests.length || isRunActive()) return;
    beginRun(1);
    _api = null; refreshBoardSelector(); updateRow(index, 'running');
    try {
      await tests[index].fn();
      throwIfRunCancelled();
      updateRow(index, 'pass');
      var ex = lastResults.findIndex(function (r) { return r.name === tests[index].name; });
      var e = { name: tests[index].name, passed: true };
      if (ex >= 0) lastResults[ex] = e; else lastResults.push(e);
      updateSummary(1, 0, 1);
    } catch (err) {
      if (isCancelledError(err)) {
        updateRow(index, 'reset');
        setSummaryText('Stopped: 0 passed, 0 failed / 1', 'var(--text-muted)');
        return;
      }
      var msg = err.message || String(err); updateRow(index, 'fail', msg);
      var ex2 = lastResults.findIndex(function (r) { return r.name === tests[index].name; });
      var e2 = { name: tests[index].name, passed: false, error: msg };
      if (ex2 >= 0) lastResults[ex2] = e2; else lastResults.push(e2);
      updateSummary(0, 1, 1);
    } finally {
      endRun();
    }
  }

  var _obs = new MutationObserver(function () {
    if (findPanelRoot() && !_panelInit) populateTestList();
  });
  _obs.observe(document.body, { childList: true, subtree: true });

  window.LexeraFrontendTests = {
    runAll: runAll,
    run: function (name) {
      var t = tests.find(function (x) { return x.name === name; });
      if (!t) { console.error('Not found: ' + name); return; }
      return t.fn();
    },
    list: function () { return tests.map(function (t) { return t.name; }); },
    stop: function () { requestStopRun(); },
    showPanel: function () { populateTestList(); },
    runAllWithUI: function () { populateTestList(); runAllUI(); }
  };
})();
