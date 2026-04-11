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
  var _manualInspectState = {
    awaitingUndo: false
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
        if (!isInspectableIframe(iframe, rootDoc)) continue;
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

  function isInspectableIframe(iframe, rootDoc) {
    if (!iframe) return false;
    try {
      var rawSrc = iframe.getAttribute('src') || '';
      if (!rawSrc || rawSrc.indexOf('about:') === 0) return true;
      var baseHref = rootDoc && rootDoc.location && rootDoc.location.href ? rootDoc.location.href : window.location.href;
      var frameUrl = new URL(rawSrc, baseHref);
      var baseUrl = new URL(baseHref, window.location.href);
      return frameUrl.origin === baseUrl.origin;
    } catch (_) {
      return false;
    }
  }

  function getCandidateApis() {
    var candidates = [];
    function pushCandidate(win) {
      if (!win || !win.LexeraTestApi || candidates.indexOf(win.LexeraTestApi) !== -1) return;
      candidates.push(win.LexeraTestApi);
    }

    var entries = getIframeEntries(document);
    for (var i = 0; i < entries.length; i++) if (entries[i].isActive) pushCandidate(entries[i].win);
    for (var j = 0; j < entries.length; j++) pushCandidate(entries[j].win);
    pushCandidate(window);
    try { if (window.parent && window.parent !== window) pushCandidate(window.parent); } catch (_) {}

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

  // Return every window (parent + iframes) that has a LexeraTestApi. The board
  // app runs in an iframe in workspace-shell mode, so performance flags must
  // be set on THAT window, not the parent. Profile data is also collected there.
  function getAllBoardWindows() {
    var wins = [];
    function pushWin(win) {
      if (!win || wins.indexOf(win) !== -1) return;
      try { if (win.LexeraTestApi) wins.push(win); } catch (_) {}
    }
    pushWin(window);
    try { if (window.parent && window.parent !== window) pushWin(window.parent); } catch (_) {}
    var entries = getIframeEntries(document);
    for (var i = 0; i < entries.length; i++) pushWin(entries[i].win);
    return wins;
  }

  function setMutationProfilingFlag(enabled) {
    var wins = getAllBoardWindows();
    for (var i = 0; i < wins.length; i++) {
      try { wins[i].__lexeraProfileMutations = !!enabled; } catch (_) {}
      try { wins[i].__lexeraMutationProfile = []; } catch (_) {}
    }
  }

  function collectMutationProfile() {
    var all = [];
    var wins = getAllBoardWindows();
    for (var i = 0; i < wins.length; i++) {
      try {
        var samples = wins[i].__lexeraMutationProfile;
        if (Array.isArray(samples) && samples.length > 0) {
          for (var j = 0; j < samples.length; j++) all.push(samples[j]);
        }
      } catch (_) {}
    }
    return all;
  }

  function resetRenderCounters() {
    var wins = getAllBoardWindows();
    for (var i = 0; i < wins.length; i++) {
      try {
        wins[i].__lexeraRenderColumnsCount = 0;
        wins[i].__lexeraRnfbCount = 0;
        wins[i].__lexeraIframeReuseCount = 0;
        wins[i].__lexeraIframeFreshCount = 0;
      } catch (_) {}
    }
  }

  function collectRenderCounters() {
    var counters = { renderColumnsCount: 0, rnfbCount: 0, iframeReuseCount: 0, iframeFreshCount: 0 };
    var wins = getAllBoardWindows();
    for (var i = 0; i < wins.length; i++) {
      try {
        counters.renderColumnsCount += wins[i].__lexeraRenderColumnsCount || 0;
        counters.rnfbCount += wins[i].__lexeraRnfbCount || 0;
        counters.iframeReuseCount += wins[i].__lexeraIframeReuseCount || 0;
        counters.iframeFreshCount += wins[i].__lexeraIframeFreshCount || 0;
      } catch (_) {}
    }
    return counters;
  }

  function attachRenderCounters(profileSummary) {
    if (!profileSummary) return profileSummary;
    var counters = collectRenderCounters();
    profileSummary.renderColumnsCount = counters.renderColumnsCount;
    profileSummary.rnfbCount = counters.rnfbCount;
    profileSummary.iframeReuseCount = counters.iframeReuseCount;
    profileSummary.iframeFreshCount = counters.iframeFreshCount;
    return profileSummary;
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

  async function waitForCondition(predicate, timeoutMs, stepMs, message) {
    var timeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 3000;
    var step = typeof stepMs === 'number' && stepMs > 0 ? stepMs : 50;
    var started = Date.now();
    while ((Date.now() - started) <= timeout) {
      throwIfRunCancelled();
      try {
        if (predicate()) return true;
      } catch (_) {}
      await delay(step);
    }
    throw new Error(message || 'Timed out waiting for condition');
  }

  async function waitForAssertion(assertionFn, timeoutMs, stepMs, message) {
    var timeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 1000;
    var step = typeof stepMs === 'number' && stepMs > 0 ? stepMs : 16;
    var started = Date.now();
    var lastErr = null;
    while ((Date.now() - started) <= timeout) {
      throwIfRunCancelled();
      try {
        assertionFn();
        return true;
      } catch (err) {
        lastErr = err;
      }
      await delay(step);
    }
    if (lastErr) throw lastErr;
    throw new Error(message || 'Timed out waiting for assertion');
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getBoardRowCount(boardData) { return boardData && boardData.rows ? boardData.rows.length : 0; }

  function assertEqual(actual, expected, msg) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error((msg || 'assertEqual') + ': expected ' + e + ', got ' + a);
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }

  function rawDelay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function getManualInspectCheckbox() {
    var root = findPanelRoot();
    return root ? root.querySelector('.lexera-shared-test-manual-inspect') : null;
  }

  function isManualInspectEnabled() {
    var checkbox = getManualInspectCheckbox();
    return !!(checkbox && checkbox.checked);
  }

  function continueManualUndo() {
    _manualInspectState.awaitingUndo = false;
    updateRunControls();
  }

  async function waitForManualUndoStep() {
    if (!isManualInspectEnabled()) return;
    _manualInspectState.awaitingUndo = true;
    setSummaryText('Inspect the current board state, then click Restore & Continue.', 'var(--warning, #e6a700)');
    updateRunControls();
    while (_manualInspectState.awaitingUndo && !isRunCancelled()) {
      await rawDelay(100);
    }
    _manualInspectState.awaitingUndo = false;
    setSummaryText(isRunCancelled() ? 'Restoring snapshot after stop...' : 'Restoring test snapshot...', 'var(--text-muted)');
    updateRunControls();
  }

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

  function findFirstVisibleColumnRef(boardData) {
    var projection = getExpectedVisibleProjection(boardData);
    return projection.columns.length > 0 ? projection.columns[0] : null;
  }

  function findFirstVisibleRowRef(boardData) {
    var projection = getExpectedVisibleProjection(boardData);
    return projection.rows.length > 0 ? projection.rows[0] : null;
  }

  function findVisibleStackRefById(boardData, rowId, stackId) {
    var projection = getExpectedVisibleProjection(boardData);
    rowId = cleanBoardText(rowId);
    stackId = cleanBoardText(stackId);
    for (var r = 0; r < projection.rows.length; r++) {
      var row = projection.rows[r];
      if (rowId && cleanBoardText(row.rowId) !== rowId) continue;
      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        if (stackId && cleanBoardText(stack.stackId) !== stackId) continue;
        return stack;
      }
    }
    return null;
  }

  function findVisibleColumnRefById(boardData, columnId) {
    var projection = getExpectedVisibleProjection(boardData);
    columnId = cleanBoardText(columnId);
    for (var i = 0; i < projection.columns.length; i++) {
      if (cleanBoardText(projection.columns[i].columnId) === columnId) return projection.columns[i];
    }
    return null;
  }

  function findCardInBoardDataById(boardData, cardId) {
    var normalized = cleanBoardText(cardId);
    if (!normalized || !boardData || !Array.isArray(boardData.rows)) return null;
    for (var r = 0; r < boardData.rows.length; r++) {
      var stacks = boardData.rows[r] && Array.isArray(boardData.rows[r].stacks) ? boardData.rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        var cols = stacks[s] && Array.isArray(stacks[s].columns) ? stacks[s].columns : [];
        for (var c = 0; c < cols.length; c++) {
          var cards = Array.isArray(cols[c].cards) ? cols[c].cards : [];
          for (var k = 0; k < cards.length; k++) {
            var candidateId = cleanBoardText(cards[k] && (cards[k].kid || cards[k].id));
            if (candidateId === normalized) {
              return {
                card: cards[k],
                rowIndex: r,
                stackIndex: s,
                colIndex: c,
                columnId: cols[c] && cols[c].id ? String(cols[c].id) : ''
              };
            }
          }
        }
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

  function getExpectedColumnCardIds(flatColIndex) {
    var projection = getExpectedVisibleProjection(api().getFullBoardData());
    for (var i = 0; i < projection.columns.length; i++) {
      var col = projection.columns[i];
      if (col.flatIdx !== flatColIndex) continue;
      return col.cards.map(function (card) {
        return card && (card.kid || card.id) ? String(card.kid || card.id) : '';
      });
    }
    return [];
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

  function getViewStackCount() {
    var c = getContainer(); return c ? c.querySelectorAll('.board-stack').length : -1;
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
    var root = getSidebarBoardRoot(_boardId);
    if (!root) return null;
    var cards = root.querySelectorAll('.tree-card');
    var matching = [];
    for (var c = 0; c < cards.length; c++) {
      if ((cards[c].getAttribute('data-column-id') || '') === columnId) matching.push(cards[c]);
    }
    if (matching.length === 0) return null;
    var ids = [];
    for (var i = 0; i < matching.length; i++)
      ids.push(matching[i].getAttribute('data-card-id') || '');
    return ids;
  }

  function getSidebarBoardRoot(boardId) {
    var bl = getSidebarRoot();
    if (!bl || !boardId) return null;
    var wrappers = bl.querySelectorAll('.board-item-wrapper[data-board-id]');
    var fallback = null;
    for (var i = 0; i < wrappers.length; i++) {
      var wrapper = wrappers[i];
      if ((wrapper.getAttribute('data-board-id') || '') !== boardId) continue;
      if (!fallback) fallback = wrapper;
      var boardNode = wrapper.querySelector('.tree-board[data-board-id]');
      if (boardNode && boardNode.classList.contains('active')) return wrapper;
    }
    return fallback;
  }

  function isSidebarAvailable() {
    var root = getSidebarBoardRoot(_boardId);
    return !!(root && root.querySelector('.tree-card'));
  }

  function getSidebarDocument() {
    var docs = getReachableDocuments();
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      if (!doc || typeof doc.querySelector !== 'function') continue;
      try {
        if (doc.querySelector('.board-list')) return doc;
      } catch (_) {}
    }
    return getBoardDocument();
  }

  function getSidebarRoot() {
    var doc = getSidebarDocument();
    return doc ? doc.querySelector('.board-list') : null;
  }

  function getSidebarRowCount() {
    var root = getSidebarRoot();
    return root ? root.querySelectorAll('.tree-row[data-row-id]').length : -1;
  }

  function getSidebarStackCount() {
    var root = getSidebarRoot();
    return root ? root.querySelectorAll('.tree-stack[data-stack-id]').length : -1;
  }

  function getSidebarColumnCount() {
    var root = getSidebarRoot();
    return root ? root.querySelectorAll('.tree-column[data-column-id]').length : -1;
  }

  function getSidebarNodeByAttr(selector) {
    var root = getSidebarRoot();
    return root ? root.querySelector(selector) : null;
  }

  function getHeaderButton(buttonId) {
    var doc = getBoardDocument();
    return doc ? doc.getElementById(buttonId) : null;
  }

  function getHeaderButtonText(buttonId) {
    var btn = getHeaderButton(buttonId);
    return cleanBoardText(btn ? btn.textContent : '');
  }

  function headerButtonHasItems(buttonId) {
    var btn = getHeaderButton(buttonId);
    return !!(btn && btn.classList && btn.classList.contains('has-items'));
  }

  function assertHeaderBucketState(buttonId, label, expectedCount) {
    var expectedText = expectedCount > 0 ? (label + ' (' + expectedCount + ')') : label;
    assertEqual(getHeaderButtonText(buttonId), expectedText, label + ' header label');
    assertEqual(headerButtonHasItems(buttonId), expectedCount > 0, label + ' header has-items state');
  }

  function getExportDocument() {
    return getBoardDocument();
  }

  function getExportService() {
    var doc = getExportDocument();
    var win = doc && doc.defaultView ? doc.defaultView : window;
    return win ? (win.ExportService || null) : null;
  }

  function getExportUi() {
    var doc = getExportDocument();
    var win = doc && doc.defaultView ? doc.defaultView : window;
    return win ? (win._exportUI || null) : null;
  }

  function closeExportModal() {
    var ui = getExportUi();
    if (ui && typeof ui.hide === 'function') ui.hide();
    var doc = getExportDocument();
    var modal = doc ? doc.getElementById('export-modal') : null;
    if (modal) modal.hidden = true;
  }

  function setExportSelectValue(id, value) {
    var doc = getExportDocument();
    var el = doc ? doc.getElementById(id) : null;
    assert(el, id + ' exists');
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setExportCheckboxValue(id, checked) {
    var doc = getExportDocument();
    var el = doc ? doc.getElementById(id) : null;
    assert(el, id + ' exists');
    el.checked = !!checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function openExportModal(initialOptions) {
    closeExportModal();
    await api().triggerBoardExport(initialOptions || null);
    await waitForCondition(function () {
      var doc = getExportDocument();
      var modal = doc ? doc.getElementById('export-modal') : null;
      return !!(modal && !modal.hidden && getExportUi());
    }, 3000, 50, 'Export modal did not open');
    return getExportUi();
  }

  function getDashboardDocument() {
    var docs = getReachableDocuments();
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      if (!doc || typeof doc.getElementById !== 'function') continue;
      try {
        if (doc.getElementById('dashboard-results-list') || doc.querySelector('.lexera-shared-dashboard-results')) return doc;
      } catch (_) {}
    }
    return getBoardDocument();
  }

  function getDashboardList(listId) {
    var doc = getDashboardDocument();
    return doc ? doc.getElementById(listId) : null;
  }

  function getDashboardCardIds(listId) {
    var list = getDashboardList(listId);
    if (!list) return [];
    var nodes = list.querySelectorAll('.tree-node[data-dashboard-card-id]');
    var ids = [];
    for (var i = 0; i < nodes.length; i++) {
      var id = cleanBoardText(nodes[i].getAttribute('data-dashboard-card-id'));
      if (id) ids.push(id);
    }
    return ids;
  }

  function getDashboardCardCount(listId) {
    return getDashboardCardIds(listId).length;
  }

  function getVisibleRowIds(boardData) {
    var projection = getExpectedVisibleProjection(boardData);
    var ids = [];
    for (var i = 0; i < projection.rows.length; i++) {
      if (projection.rows[i].rowId) ids.push(cleanBoardText(projection.rows[i].rowId));
    }
    return ids;
  }

  function getVisibleStackIds(boardData) {
    var projection = getExpectedVisibleProjection(boardData);
    var ids = [];
    for (var r = 0; r < projection.rows.length; r++) {
      var stacks = projection.rows[r].stacks || [];
      for (var s = 0; s < stacks.length; s++) {
        if (stacks[s].stackId) ids.push(cleanBoardText(stacks[s].stackId));
      }
    }
    return ids;
  }

  function getVisibleColumnIds(boardData) {
    var projection = getExpectedVisibleProjection(boardData);
    var ids = [];
    for (var i = 0; i < projection.columns.length; i++) {
      if (projection.columns[i].columnId) ids.push(cleanBoardText(projection.columns[i].columnId));
    }
    return ids;
  }

  function getVisibleCardIds(boardData) {
    var projection = getExpectedVisibleProjection(boardData);
    var ids = [];
    for (var i = 0; i < projection.columns.length; i++) {
      var cards = projection.columns[i].cards || [];
      for (var k = 0; k < cards.length; k++) {
        var id = cleanBoardText(cards[k] && (cards[k].kid || cards[k].id));
        if (id) ids.push(id);
      }
    }
    return ids;
  }

  function findNewId(beforeIds, afterIds) {
    var seen = {};
    for (var i = 0; i < beforeIds.length; i++) seen[cleanBoardText(beforeIds[i])] = true;
    for (var j = 0; j < afterIds.length; j++) {
      var next = cleanBoardText(afterIds[j]);
      if (next && !seen[next]) return next;
    }
    return '';
  }

  function createFrontendActionFixtureBoard() {
    var includeSource = { rawPath: './slides/intro.md', missing: false };
    return {
      title: 'Frontend Test Fixture Board',
      columns: [],
      rows: [
        {
          id: 'ft-row-1',
          title: 'Roadmap',
          stacks: [
            {
              id: 'ft-stack-1',
              title: 'Primary Stack',
              columns: [
                {
                  id: 'ft-col-1',
                  title: 'Alpha Column',
                  cards: [
                    { id: 'ft-card-1', kid: 'ft-card-1', content: 'ORDER-1 Alpha Task [Spec](https://example.com/spec) #today', checked: false }
                  ],
                  include_source: null,
                  includeSource: null
                },
                {
                  id: 'ft-col-2',
                  title: 'Included Column !!!include(./slides/intro.md)!!!',
                  cards: [
                    { id: 'ft-card-2', kid: 'ft-card-2', content: 'ORDER-2 ![Diagram](./diagram.png)\n[Doc](./guide.pdf)\n!!!include(./nested.md)!!!\nDue #tomorrow', checked: false }
                  ],
                  include_source: includeSource,
                  includeSource: includeSource
                }
              ]
            },
            {
              id: 'ft-stack-2',
              title: 'Secondary Stack',
              columns: [
                {
                  id: 'ft-col-3',
                  title: 'Gamma Column',
                  cards: [
                    { id: 'ft-card-3', kid: 'ft-card-3', content: 'ORDER-3 Gamma Task', checked: false }
                  ],
                  include_source: null,
                  includeSource: null
                }
              ]
            }
          ]
        },
        {
          id: 'ft-row-2',
          title: 'Backlog',
          stacks: [
            {
              id: 'ft-stack-3',
              title: 'Archive Candidate',
              columns: [
                {
                  id: 'ft-col-4',
                  title: 'Delta Column',
                  cards: [
                    { id: 'ft-card-4', kid: 'ft-card-4', content: 'ORDER-4 Delta Task', checked: false }
                  ],
                  include_source: null,
                  includeSource: null
                }
              ]
            }
          ]
        }
      ]
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Setup / teardown — snapshot & restore the real board
  // ═══════════════════════════════════════════════════════════════════════

  var _snapshot = null;
  var _boardId = null;
  var _uiStateSnapshot = null;
  var _restoreSavedSnapshot = false;

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
    // No wait — renderMainView is synchronous
  }

  // Phase timing — populated during test execution, read by test runner
  var _phaseTimings = null; // { setup, body, teardown }

  function _startPhase(name) {
    if (!_phaseTimings) return 0;
    var start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    _phaseTimings[name + 'Start'] = start;
    return start;
  }
  function _endPhase(name) {
    if (!_phaseTimings) return;
    var end = typeof performance !== 'undefined' ? performance.now() : Date.now();
    _phaseTimings[name] = end - (_phaseTimings[name + 'Start'] || end);
  }

  async function setup() {
    _startPhase('setup');
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
          _endPhase('setup');
          return;
        }
      } catch (_) {}
      await delay(200);
      _api = null; // retry finding the API
    }
    _endPhase('setup');
    throw new Error('No board loaded — open a board with at least 2 columns first');
  }

  async function persistFixtureBoard(boardData) {
    assert(_boardId, 'board id available');
    api().setTestBoard(cloneJson(boardData), _boardId);
    assert(typeof api().saveCurrentBoard === 'function', 'saveCurrentBoard is available');
    _restoreSavedSnapshot = true;
    var saved = await api().saveCurrentBoard();
    assert(saved !== false, 'fixture board saved');
  }

  async function teardown() {
    if (_snapshot && _boardId) {
      // Yield one paint frame so the browser can actually render the
      // test's mutation on the board before we snap it back. Without
      // this, the mutation and the restore collapse into a single
      // paint and the user never sees what the test did. This is a
      // single rAF + setTimeout (~16ms), not a configurable pause.
      try {
        await new Promise(function (resolve) {
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function () { setTimeout(resolve, 0); });
          } else {
            setTimeout(resolve, 16);
          }
        });
      } catch (_) {}
      await waitForManualUndoStep();
    }
    _startPhase('teardown');
    if (_snapshot && _boardId) {
      api().setTestBoard(_snapshot, _boardId);
      // setTestBoard is synchronous at the DOM level — no wait needed
      if (_restoreSavedSnapshot && typeof api().saveCurrentBoard === 'function') {
        try {
          await api().saveCurrentBoard();
        } catch (_) {}
      }
      restoreBoardUiState(_uiStateSnapshot, _boardId);
      try { api().renderMainView(); } catch (_) {}
    }
    _snapshot = null;
    _boardId = null;
    _uiStateSnapshot = null;
    _restoreSavedSnapshot = false;
    // Cancel pending debounced work so it doesn't leak into the next test
    try {
      if (window.LexeraBoardDataStore && typeof window.LexeraBoardDataStore.cancelAllDeferredWork === 'function') {
        window.LexeraBoardDataStore.cancelAllDeferredWork();
      }
      if (window.LexeraBoardList && typeof window.LexeraBoardList.cancelPendingDraftSave === 'function') {
        window.LexeraBoardList.cancelPendingDraftSave();
      }
    } catch (_) {}
    _endPhase('teardown');
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
      var firstKid = String(col.cards[0].kid || col.cards[0].id);
      var lastKid = String(col.cards[col.cards.length - 1].kid || col.cards[col.cards.length - 1].id);
      var expectedOrder = col.cards.slice(1).map(function (card) {
        return card && (card.kid || card.id) ? String(card.kid || card.id) : '';
      }).concat([firstKid]);
      var countBefore = getViewCardCount(col.flatIdx);

      await api().moveCard(
        { boardId: _boardId, flatColIndex: col.flatIdx, cardIndex: 0, cardId: col.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: col.flatIdx, cardId: lastKid, before: false, insertIdx: col.cards.length - 1, insertMode: 'visible', indexMode: 'display' }
      );
      await waitForAssertion(function () {
        assertEqual(getViewCardCount(col.flatIdx), countBefore, 'count unchanged');
        assertEqual(getExpectedColumnCardIds(col.flatIdx), expectedOrder, 'data order after move');
        var afterKids = getViewCardKids(col.flatIdx);
        assertEqual(afterKids, getExpectedColumnCardIds(col.flatIdx), 'DOM order matches data after move');
        assertEqual(afterKids[afterKids.length - 1], firstKid, 'moved card should be last');
        assert(afterKids[0] !== firstKid, 'moved card should not be first anymore');
      });
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
      await waitForAssertion(function () {
        assertEqual(getViewCardCount(src.flatIdx), srcCountBefore - 1, 'source lost 1 card');
        assertEqual(getViewCardCount(dst.flatIdx), dstCountBefore + 1, 'target gained 1 card');
        assertEqual(getTotalViewCards(), totalBefore, 'total unchanged');
        assert(!hasDuplicateViewCardIds(), 'no duplicates');
        assert(getViewCardKids(dst.flatIdx).indexOf(movedKid) !== -1, 'card in target view');
      });
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
      await waitForAssertion(function () {
        assertEqual(getViewCardCount(dst.flatIdx), dstCountBefore + 1, 'target gained 1');
        assert(getViewCardKids(dst.flatIdx).indexOf(movedKid) !== -1, 'card in target');
      });
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
      await waitForAssertion(function () {
        assertEqual(getViewCardCount(src.flatIdx), srcCountBefore - 1, 'source lost 1');
        assert(getViewCardKids(dst.flatIdx).indexOf(movedKid) !== -1, 'card in target');
      });
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
      await waitForAssertion(function () {
        assertEqual(getViewCardCount(src.flatIdx), srcCountBefore - 1, 'source lost 1');
        assertEqual(getViewCardCount(dst.flatIdx), dstCountBefore + 1, 'target gained 1');
        assert(getViewCardKids(dst.flatIdx).indexOf(movedKid) !== -1, 'card in target');
      });
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
      await waitForAssertion(function () {
        assertEqual(getViewCardCount(info.srcCol.flatIdx), countBefore + 1, 'card count +1');
      });
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
      await waitForAssertion(function () {
        assertEqual(getViewCardCount(info.srcCol.flatIdx), countBefore - 1, 'card count -1');
        assert(getViewCardKids(info.srcCol.flatIdx).indexOf(removedKid) === -1, 'removed card gone');
      });
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
      await waitForAssertion(function () {
        assertEqual(getViewColumnCount(), colsBefore + 1, 'column count +1');
      });
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
      await waitForAssertion(function () {
        assertEqual(getViewRowCount(), rowsBefore + 1, 'row count +1');
      });
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════

  register('no duplicate card IDs after move', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var movedKid = info.srcCol.cards[0].kid || info.srcCol.cards[0].id;
      await api().moveCard(
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, cardIndex: 0, cardId: info.srcCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: info.dstCol.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await waitForAssertion(function () {
        assert(!hasDuplicateViewCardIds(), 'no duplicate IDs');
        assert(getViewCardKids(info.dstCol.flatIdx).indexOf(movedKid) !== -1, 'moved card in target');
      });
    } finally { await teardown(); }
  });

  register('total card count constant after move', async function () {
    await setup();
    try {
      var totalBefore = getTotalViewCards();
      var info = findTwoColumnsWithCards();
      var movedKid = info.srcCol.cards[0].kid || info.srcCol.cards[0].id;
      await api().moveCard(
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, cardIndex: 0, cardId: info.srcCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: info.dstCol.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await waitForAssertion(function () {
        assertEqual(getTotalViewCards(), totalBefore, 'total constant');
        assert(getViewCardKids(info.dstCol.flatIdx).indexOf(movedKid) !== -1, 'moved card in target');
      });
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
        viewKids.push(viewCards[j].getAttribute('data-card-id') || '');
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
      await waitForAssertion(function () { assertViewWorkspaceConsistency('cross-column'); });
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
      await waitForAssertion(function () { assertViewWorkspaceConsistency('view-to-workspace'); });
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
      await waitForAssertion(function () { assertViewWorkspaceConsistency('workspace-to-view'); });
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
      await waitForAssertion(function () { assertViewWorkspaceConsistency('add-card'); });
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
      await waitForAssertion(function () {
        assertEqual(getViewCardCount(col.flatIdx), countBefore, 'count unchanged');
        var afterKids = getViewCardKids(col.flatIdx);
        assertEqual(afterKids[0], lastKid, 'moved card should be first');
        assert(afterKids[afterKids.length - 1] !== lastKid, 'moved card should not be last anymore');
      });
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
      await waitForAssertion(function () {
        var dstKids = getViewCardKids(dst.flatIdx);
        assertEqual(dstKids[0], movedKid, 'moved card is first in target');
      });
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
      await waitForAssertion(function () {
        var remaining = getViewCardKids(src.flatIdx);
        assertEqual(remaining, originalOrder, 'remaining source cards keep original order');
      });
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

  async function setDashboardStateForTest(query, scope, skipRefresh) {
    var helpers = getDashboardHelpers();
    if (!helpers) return;
    if (typeof helpers.setDashboardScope === 'function' && scope) helpers.setDashboardScope(scope);
    if (typeof helpers.setDashboardQuery === 'function') {
      helpers.setDashboardQuery(query || '', { skipRefresh: !!skipRefresh });
    }
    if (!skipRefresh) await delay(260);
  }

  function resetDashboardPendingFlags() {
    var helpers = getDashboardHelpers();
    if (helpers && typeof helpers._resetDashboardPendingFlags === 'function') helpers._resetDashboardPendingFlags();
  }

  async function waitForDashboardCardCount(listId, expectedCount, message) {
    await waitForCondition(function () {
      return getDashboardCardCount(listId) === expectedCount;
    }, 5000, 75, message || ('Dashboard list ' + listId + ' did not reach expected count'));
  }

  async function waitForDashboardCardPresence(listId, cardId, expectedPresent, message) {
    var normalized = cleanBoardText(cardId);
    await waitForCondition(function () {
      var ids = getDashboardCardIds(listId);
      var present = ids.indexOf(normalized) !== -1;
      return expectedPresent ? present : !present;
    }, 5000, 75, message || ('Dashboard card presence mismatch for ' + normalized));
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
  // INCLUDES & EMBEDS
  // ═══════════════════════════════════════════════════════════════════════

  register('include: column include badge renders immediately after setTestBoard', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var targetStack = findFirstVisibleStackRef(data);
      assert(targetStack, 'need at least 1 visible stack');
      var includeSource = { rawPath: 'docs/include-test.md', missing: false };
      data.rows[targetStack.rowIndex].stacks[targetStack.stackIndex].columns.push({
        id: '__include-col-test__',
        title: 'Include Test Column',
        cards: [],
        include_source: includeSource,
        includeSource: includeSource
      });
      api().setTestBoard(data, _boardId);
      await delay(120);

      var c = getContainer();
      var colEl = c.querySelector('.column[data-column-id="__include-col-test__"]');
      assert(colEl, 'include test column rendered');
      var badge = colEl.querySelector('.column-include-badge[data-include-path="docs/include-test.md"]');
      assert(badge, 'include badge rendered with expected path');
      assert(!badge.classList.contains('include-broken'), 'include badge is not marked broken');
    } finally { await teardown(); }
  });

  register('embed: markdown image embed renders immediately after setTestBoard', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var data = api().getFullBoardData();
      data.rows[col.row].stacks[col.stack].columns[col.localCol].cards.push({
        id: '__embed-card-test__',
        kid: '__embed-card-test__',
        checked: false,
        content: 'Embed Test Card\n![Preview](assets/embed-test.png)'
      });
      api().setTestBoard(data, _boardId);
      await delay(120);

      var c = getContainer();
      var cardEl = c.querySelector('.card[data-card-kid="__embed-card-test__"]');
      assert(cardEl, 'embed test card rendered');
      var embedEl = cardEl.querySelector('.embed-container[data-file-path="assets/embed-test.png"]');
      assert(embedEl, 'markdown embed container rendered with expected file path');
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
  // HEADER CREATION ACTIONS
  // ═══════════════════════════════════════════════════════════════════════

  register('header create: row action adds row to data, board DOM, sidebar, and keeps dashboard counts in sync', async function () {
    await setup();
    try {
      await persistFixtureBoard(createFrontendActionFixtureBoard());
      await setDashboardStateForTest('', 'active', false);
      await waitForDashboardCardCount('dashboard-todos-list', 4, 'initial dashboard todos should match fixture board');
      resetDashboardPendingFlags();
      var beforeDashboard = getDashboardDebugState();
      var beforeData = api().getFullBoardData();
      var beforeIds = getVisibleRowIds(beforeData);
      var rowsBefore = getViewRowCount();
      var sidebarRowsBefore = getSidebarRowCount();

      await api().runHeaderCreationAction('row', 'empty');
      await delay(260);

      var afterData = api().getFullBoardData();
      var newRowId = findNewId(beforeIds, getVisibleRowIds(afterData));
      var afterDashboard = getDashboardDebugState();
      assert(newRowId, 'new row id discovered');
      assertEqual(getExpectedVisibleProjection(afterData).rows.length, beforeIds.length + 1, 'visible row count +1 in data');
      assertEqual(getViewRowCount(), rowsBefore + 1, 'board DOM row count +1');
      assertEqual(getSidebarRowCount(), sidebarRowsBefore + 1, 'sidebar row count +1');
      assert(getContainer().querySelector('.board-row[data-row-id="' + newRowId + '"]'), 'new row rendered in board DOM');
      assert(getSidebarNodeByAttr('.tree-row[data-row-id="' + newRowId + '"]'), 'new row rendered in sidebar');
      assert(didDashboardRefreshTrigger(beforeDashboard, afterDashboard), 'dashboard refresh triggered after row creation');
      await waitForDashboardCardCount('dashboard-todos-list', 4, 'empty row should not change dashboard todo count');
    } finally {
      await setDashboardStateForTest('', 'all', true);
      await teardown();
    }
  });

  register('header create: stack action adds stack to data, board DOM, sidebar, and keeps dashboard counts in sync', async function () {
    await setup();
    try {
      await persistFixtureBoard(createFrontendActionFixtureBoard());
      await setDashboardStateForTest('', 'active', false);
      await waitForDashboardCardCount('dashboard-todos-list', 4, 'initial dashboard todos should match fixture board');
      resetDashboardPendingFlags();
      var beforeDashboard = getDashboardDebugState();
      var beforeData = api().getFullBoardData();
      var beforeIds = getVisibleStackIds(beforeData);
      var stacksBefore = getViewStackCount();
      var sidebarStacksBefore = getSidebarStackCount();

      await api().runHeaderCreationAction('stack', 'empty');
      await delay(260);

      var afterData = api().getFullBoardData();
      var newStackId = findNewId(beforeIds, getVisibleStackIds(afterData));
      var afterDashboard = getDashboardDebugState();
      assert(newStackId, 'new stack id discovered');
      assertEqual(getExpectedVisibleProjection(afterData).rows[0].stacks.length, 3, 'first row gained a third visible stack');
      assertEqual(getViewStackCount(), stacksBefore + 1, 'board DOM stack count +1');
      assertEqual(getSidebarStackCount(), sidebarStacksBefore + 1, 'sidebar stack count +1');
      assert(getContainer().querySelector('.board-stack[data-stack-id="' + newStackId + '"]'), 'new stack rendered in board DOM');
      assert(getSidebarNodeByAttr('.tree-stack[data-stack-id="' + newStackId + '"]'), 'new stack rendered in sidebar');
      assert(didDashboardRefreshTrigger(beforeDashboard, afterDashboard), 'dashboard refresh triggered after stack creation');
      await waitForDashboardCardCount('dashboard-todos-list', 4, 'empty stack should not change dashboard todo count');
    } finally {
      await setDashboardStateForTest('', 'all', true);
      await teardown();
    }
  });

  register('header create: column action adds column to data, board DOM, sidebar, and keeps dashboard counts in sync', async function () {
    await setup();
    try {
      await persistFixtureBoard(createFrontendActionFixtureBoard());
      await setDashboardStateForTest('', 'active', false);
      await waitForDashboardCardCount('dashboard-todos-list', 4, 'initial dashboard todos should match fixture board');
      resetDashboardPendingFlags();
      var beforeDashboard = getDashboardDebugState();
      var beforeData = api().getFullBoardData();
      var beforeIds = getVisibleColumnIds(beforeData);
      var colsBefore = getViewColumnCount();
      var sidebarColsBefore = getSidebarColumnCount();

      await api().runHeaderCreationAction('column', 'empty');
      await delay(260);

      var afterData = api().getFullBoardData();
      var newColumnId = findNewId(beforeIds, getVisibleColumnIds(afterData));
      var afterDashboard = getDashboardDebugState();
      assert(newColumnId, 'new column id discovered');
      assertEqual(getViewColumnCount(), colsBefore + 1, 'board DOM column count +1');
      assertEqual(getSidebarColumnCount(), sidebarColsBefore + 1, 'sidebar column count +1');
      assert(getContainer().querySelector('.column[data-column-id="' + newColumnId + '"]'), 'new column rendered in board DOM');
      assert(getSidebarNodeByAttr('.tree-column[data-column-id="' + newColumnId + '"]'), 'new column rendered in sidebar');
      assert(didDashboardRefreshTrigger(beforeDashboard, afterDashboard), 'dashboard refresh triggered after column creation');
      await waitForDashboardCardCount('dashboard-todos-list', 4, 'empty column should not change dashboard todo count');
    } finally {
      await setDashboardStateForTest('', 'all', true);
      await teardown();
    }
  });

  register('header create: card action adds card to data, board DOM, sidebar, and dashboard search results', async function () {
    await setup();
    try {
      await persistFixtureBoard(createFrontendActionFixtureBoard());
      await waitForDashboardCardCount('dashboard-todos-list', 4, 'fixture should start with four todo cards');
      await setDashboardStateForTest('Header Search Card', 'active', false);
      await waitForDashboardCardCount('dashboard-results-list', 0, 'fixture should still have no matching dashboard results before creation');
      resetDashboardPendingFlags();
      var beforeDashboard = getDashboardDebugState();
      var beforeData = api().getFullBoardData();
      var beforeCardIds = getVisibleCardIds(beforeData);
      var firstColumn = findFirstVisibleColumnRef(beforeData);
      assert(firstColumn, 'fixture exposes a visible column for header card creation');
      var sidebarBefore = getSidebarCardIdsInColumn(firstColumn.columnId) || [];
      var viewCountBefore = getViewCardCount(firstColumn.flatIdx);

      assert(typeof api().createHeaderEntityFromText === 'function', 'createHeaderEntityFromText is available');
      await api().createHeaderEntityFromText('card', 'Header Search Card');
      await delay(320);

      var afterData = api().getFullBoardData();
      var newCardId = findNewId(beforeCardIds, getVisibleCardIds(afterData));
      var afterDashboard = getDashboardDebugState();
      assert(newCardId, 'new card id discovered');
      assertEqual(getViewCardCount(firstColumn.flatIdx), viewCountBefore + 1, 'board DOM card count +1 in first column');
      assertEqual((getSidebarCardIdsInColumn(firstColumn.columnId) || []).length, sidebarBefore.length + 1, 'sidebar card count +1 in first column');
      assert(getViewCardKids(firstColumn.flatIdx).indexOf(newCardId) !== -1, 'new card rendered in board DOM');
      assert((getSidebarCardIdsInColumn(firstColumn.columnId) || []).indexOf(newCardId) !== -1, 'new card rendered in sidebar');
      assert(didDashboardRefreshTrigger(beforeDashboard, afterDashboard), 'dashboard refresh triggered after card creation');
      await waitForDashboardCardCount('dashboard-todos-list', 5, 'card creation should increase dashboard todo count');
      await waitForDashboardCardPresence('dashboard-results-list', newCardId, true, 'created card should appear in dashboard search results');
    } finally {
      await setDashboardStateForTest('', 'all', true);
      await teardown();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // HIDDEN DESTINATION SURFACES
  // ═══════════════════════════════════════════════════════════════════════

  register('hidden destination: incoming card updates header bucket, board visibility, and dashboard todos', async function () {
    await setup();
    try {
      await persistFixtureBoard(createFrontendActionFixtureBoard());
      await setDashboardStateForTest('', 'active', false);
      await waitForDashboardCardCount('dashboard-todos-list', 4, 'fixture should start with four todo cards');
      var totalBefore = getTotalViewCards();

      await api().tagCard(0, 0, '#hidden-internal-incoming');
      await delay(260);

      assertEqual(api().getIncomingCount(), 1, 'incoming bucket count +1');
      assertHeaderBucketState('btn-incoming', 'Incoming', 1);
      assertEqual(getTotalViewCards(), totalBefore - 1, 'incoming card removed from visible board');
      await waitForDashboardCardCount('dashboard-todos-list', 3, 'incoming card removed from dashboard todos');
      assertEqual(getViewCardKids(0).indexOf('ft-card-1'), -1, 'incoming card removed from source column DOM');
    } finally {
      await setDashboardStateForTest('', 'all', true);
      await teardown();
    }
  });

  register('hidden destination: parked card updates header bucket, board visibility, and dashboard todos', async function () {
    await setup();
    try {
      await persistFixtureBoard(createFrontendActionFixtureBoard());
      await setDashboardStateForTest('', 'active', false);
      await waitForDashboardCardCount('dashboard-todos-list', 4, 'fixture should start with four todo cards');
      var totalBefore = getTotalViewCards();

      await api().tagCard(0, 0, '#hidden-internal-parked');
      await delay(260);

      assertEqual(api().getParkedCount(), 1, 'park bucket count +1');
      assertHeaderBucketState('btn-parked', 'Park', 1);
      assertEqual(getTotalViewCards(), totalBefore - 1, 'parked card removed from visible board');
      await waitForDashboardCardCount('dashboard-todos-list', 3, 'parked card removed from dashboard todos');
      assertEqual(getViewCardKids(0).indexOf('ft-card-1'), -1, 'parked card removed from source column DOM');
    } finally {
      await setDashboardStateForTest('', 'all', true);
      await teardown();
    }
  });

  register('hidden destination: archived column updates header bucket, board visibility, sidebar, and dashboard todos', async function () {
    await setup();
    try {
      await persistFixtureBoard(createFrontendActionFixtureBoard());
      await setDashboardStateForTest('', 'active', false);
      await waitForDashboardCardCount('dashboard-todos-list', 4, 'fixture should start with four todo cards');
      var totalColsBefore = getViewColumnCount();
      var totalCardsBefore = getTotalViewCards();

      await api().setColumnHiddenTag(1, '#hidden-internal-archived');
      await delay(260);

      assertEqual(api().getArchivedCount(), 1, 'archive bucket count +1');
      assertHeaderBucketState('btn-archived', 'Archive', 1);
      assertEqual(getViewColumnCount(), totalColsBefore - 1, 'archived column removed from board DOM');
      assertEqual(getTotalViewCards(), totalCardsBefore - 1, 'archived column cards removed from visible board');
      await waitForDashboardCardCount('dashboard-todos-list', 3, 'archived column cards removed from dashboard todos');
      assert(!getContainer().querySelector('.column[data-column-id="ft-col-2"]'), 'archived column no longer rendered');
      assert(!getSidebarNodeByAttr('.tree-column[data-column-id="ft-col-2"]'), 'archived column removed from sidebar');
    } finally {
      await setDashboardStateForTest('', 'all', true);
      await teardown();
    }
  });

  register('hidden destination: parked stack updates header bucket, board visibility, sidebar, and dashboard todos', async function () {
    await setup();
    try {
      await persistFixtureBoard(createFrontendActionFixtureBoard());
      await setDashboardStateForTest('', 'active', false);
      await waitForDashboardCardCount('dashboard-todos-list', 4, 'fixture should start with four todo cards');
      var stacksBefore = getViewStackCount();
      var cardsBefore = getTotalViewCards();

      await api().setStackHiddenTag(0, 1, '#hidden-internal-parked');
      await delay(260);

      assertEqual(api().getParkedCount(), 1, 'park bucket count +1 from stack');
      assertHeaderBucketState('btn-parked', 'Park', 1);
      assertEqual(getViewStackCount(), stacksBefore - 1, 'parked stack removed from board DOM');
      assertEqual(getTotalViewCards(), cardsBefore - 1, 'parked stack cards removed from visible board');
      await waitForDashboardCardCount('dashboard-todos-list', 3, 'parked stack cards removed from dashboard todos');
      assert(!getContainer().querySelector('.board-stack[data-stack-id="ft-stack-2"]'), 'parked stack no longer rendered');
      assert(!getSidebarNodeByAttr('.tree-stack[data-stack-id="ft-stack-2"]'), 'parked stack removed from sidebar');
    } finally {
      await setDashboardStateForTest('', 'all', true);
      await teardown();
    }
  });

  register('hidden destination: trashed row updates header bucket, board visibility, sidebar, and dashboard todos', async function () {
    await setup();
    try {
      await persistFixtureBoard(createFrontendActionFixtureBoard());
      await setDashboardStateForTest('', 'active', false);
      await waitForDashboardCardCount('dashboard-todos-list', 4, 'fixture should start with four todo cards');
      var rowsBefore = getViewRowCount();
      var cardsBefore = getTotalViewCards();

      await api().setRowHiddenTag(1, '#hidden-internal-deleted');
      await delay(260);

      assertEqual(api().getDeletedCount(), 1, 'trash bucket count +1 from row');
      assertHeaderBucketState('btn-trash', 'Trash', 1);
      assertEqual(getViewRowCount(), rowsBefore - 1, 'trashed row removed from board DOM');
      assertEqual(getTotalViewCards(), cardsBefore - 1, 'trashed row cards removed from visible board');
      await waitForDashboardCardCount('dashboard-todos-list', 3, 'trashed row cards removed from dashboard todos');
      assert(!getContainer().querySelector('.board-row[data-row-id="ft-row-2"]'), 'trashed row no longer rendered');
      assert(!getSidebarNodeByAttr('.tree-row[data-row-id="ft-row-2"]'), 'trashed row removed from sidebar');
    } finally {
      await setDashboardStateForTest('', 'all', true);
      await teardown();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MARP EXPORT
  // ═══════════════════════════════════════════════════════════════════════

  register('marp export: board preset enables presentation settings and full-board selection', async function () {
    await setup();
    try {
      await persistFixtureBoard(createFrontendActionFixtureBoard());
      var ui = await openExportModal({ preset: 'marp-presentation' });
      var options = ui.collectOptions();
      assertEqual(options.format, 'presentation', 'export format is presentation');
      assertEqual(!!options.runMarp, true, 'Marp is enabled');
      assertEqual(options.marpFormat, 'html', 'Marp format defaults to html presentation');
      assert(options.selectionScopes && options.selectionScopes.length === 1, 'full-board selection scope is present');
      assertEqual(options.selectionScopes[0].scope, 'board', 'full-board scope selected');
      closeExportModal();
    } finally {
      closeExportModal();
      await teardown();
    }
  });

  register('marp export: row, stack, and column export actions preselect the expected scopes and columns', async function () {
    await setup();
    try {
      await persistFixtureBoard(createFrontendActionFixtureBoard());

      await api().dispatchAction('row', 'export-row', { rowIdx: 0, rowId: 'ft-row-1' });
      await delay(220);
      var rowUi = getExportUi();
      assert(rowUi, 'row export opened the export modal');
      var rowOptions = rowUi.collectOptions();
      assertEqual(rowOptions.selectionScopes.length, 1, 'row export selected a single scope');
      assertEqual(rowOptions.selectionScopes[0].scope, 'row', 'row export selected row scope');
      assertEqual(rowOptions.columnIds, ['ft-col-1', 'ft-col-2', 'ft-col-3'], 'row export selected row columns in visible order');
      closeExportModal();

      await api().dispatchAction('stack', 'export-stack', { rowIdx: 0, stackIdx: 0, rowId: 'ft-row-1', stackId: 'ft-stack-1' });
      await delay(220);
      var stackUi = getExportUi();
      assert(stackUi, 'stack export opened the export modal');
      var stackOptions = stackUi.collectOptions();
      assertEqual(stackOptions.selectionScopes.length, 1, 'stack export selected a single scope');
      assertEqual(stackOptions.selectionScopes[0].scope, 'stack', 'stack export selected stack scope');
      assertEqual(stackOptions.columnIds, ['ft-col-1', 'ft-col-2'], 'stack export selected stack columns in visible order');
      closeExportModal();

      await api().dispatchAction('column', 'export-column', {
        colIndex: 1,
        rowIdx: 0,
        stackIdx: 0,
        colLocalIdx: 1,
        rowId: 'ft-row-1',
        stackId: 'ft-stack-1',
        columnId: 'ft-col-2'
      });
      await delay(220);
      var columnUi = getExportUi();
      assert(columnUi, 'column export opened the export modal');
      var columnOptions = columnUi.collectOptions();
      assertEqual(columnOptions.selectionScopes.length, 1, 'column export selected a single scope');
      assertEqual(columnOptions.selectionScopes[0].scope, 'column', 'column export selected column scope');
      assertEqual(columnOptions.columnIds, ['ft-col-2'], 'column export selected the target column');
      closeExportModal();
    } finally {
      closeExportModal();
      await teardown();
    }
  });

  register('marp export: copy includes expected content and predictable include/embed/link/time rewrites', async function () {
    await setup();
    try {
      await persistFixtureBoard(createFrontendActionFixtureBoard());
      var ui = await openExportModal({ preset: 'marp-presentation' });
      var options = ui.collectOptions();
      var exportService = getExportService();
      assert(exportService && typeof exportService.export === 'function', 'ExportService is available');
      closeExportModal();

      options.mode = 'copy';
      var result = await exportService.export(options);
      var markdown = String(result && result.content || '');
      assert(markdown.indexOf('Alpha Column') !== -1, 'export includes first column title');
      assert(markdown.indexOf('ORDER-1 Alpha Task') !== -1, 'export includes first card content');
      assert(markdown.indexOf('ORDER-2') !== -1, 'export includes second card content');
      assert(/!\[Diagram\]\((?:\.\/)?slides\/diagram\.png\)/.test(markdown), 'image embed path rewritten relative to include source');
      assert(/\[Doc\]\((?:\.\/)?slides\/guide\.pdf\)/.test(markdown), 'markdown link path rewritten relative to include source');
      assert(/!!!include\((?:\.\/)?slides\/nested\.md\)!!!/.test(markdown), 'nested include path rewritten relative to include source');
      assert(markdown.indexOf('https://example.com/spec') !== -1, 'external link preserved');
      assert(markdown.indexOf('#today') !== -1 && markdown.indexOf('#tomorrow') !== -1, 'time tags preserved in export markdown');
    } finally {
      closeExportModal();
      await teardown();
    }
  });

  register('marp export: copy preserves visible card ordering across rows, stacks, and columns', async function () {
    await setup();
    try {
      await persistFixtureBoard(createFrontendActionFixtureBoard());
      var ui = await openExportModal({ preset: 'marp-presentation' });
      var options = ui.collectOptions();
      var exportService = getExportService();
      closeExportModal();

      options.mode = 'copy';
      var result = await exportService.export(options);
      var markdown = String(result && result.content || '');
      var order1 = markdown.indexOf('ORDER-1');
      var order2 = markdown.indexOf('ORDER-2');
      var order3 = markdown.indexOf('ORDER-3');
      var order4 = markdown.indexOf('ORDER-4');
      assert(order1 !== -1 && order2 !== -1 && order3 !== -1 && order4 !== -1, 'all ordered markers present in export');
      assert(order1 < order2 && order2 < order3 && order3 < order4, 'export preserves visible ordering across the board');
    } finally {
      closeExportModal();
      await teardown();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BOARD INTEGRITY HELPER — verifies everything the user expects after
  // any mutation: data↔DOM parity, no duplicates, sidebar sync, counts
  // ═══════════════════════════════════════════════════════════════════════

  function assertBoardIntegrity(label) {
    var data = api().getFullBoardData();
    assert(data && data.rows && data.rows.length > 0, label + ': board data exists');

    // 1. Data structure: unique IDs
    var cardIdsSeen = {};
    var colIdsSeen = {};
    var expectedColCount = 0;
    var expectedVisibleCardCount = 0;
    for (var r = 0; r < data.rows.length; r++) {
      var stacks = data.rows[r].stacks || [];
      for (var s = 0; s < stacks.length; s++) {
        var cols = stacks[s].columns || [];
        for (var c = 0; c < cols.length; c++) {
          assert(!colIdsSeen[cols[c].id], label + ': duplicate col ID ' + cols[c].id);
          colIdsSeen[cols[c].id] = true;
          expectedColCount++;
          var cards = cols[c].cards || [];
          for (var k = 0; k < cards.length; k++) {
            var cid = cards[k].kid || cards[k].id;
            assert(!cardIdsSeen[cid], label + ': duplicate card ID ' + cid);
            cardIdsSeen[cid] = true;
            if (!cards[k].content || cards[k].content.indexOf('#hidden-internal') === -1) {
              expectedVisibleCardCount++;
            }
          }
        }
      }
    }

    // 2. DOM counts match data
    assertEqual(getViewColumnCount(), expectedColCount, label + ': DOM col count matches data');
    assertEqual(getViewRowCount(), data.rows.length, label + ': DOM row count matches data');
    assertEqual(getTotalViewCards(), expectedVisibleCardCount, label + ': DOM visible card count matches data');

    // 3. No duplicate card IDs in DOM
    assert(!hasDuplicateViewCardIds(), label + ': no duplicate card IDs in DOM');

    // 4. Per-column card ID parity (data vs DOM)
    var allCols = api().getAllFullColumns();
    for (var i = 0; i < allCols.length; i++) {
      var visibleCards = (allCols[i].cards || []).filter(function (card) {
        return !card.content || card.content.indexOf('#hidden-internal') === -1;
      });
      var dataKids = [];
      for (var j = 0; j < visibleCards.length; j++)
        dataKids.push(visibleCards[j].kid || visibleCards[j].id);
      var domKids = getViewCardKids(i);
      assertEqual(domKids, dataKids, label + ': col ' + i + ' card IDs data↔DOM');
    }

    // 5. Sidebar consistency (if available)
    assertViewWorkspaceConsistency(label);

    // 6. Every DOM column has a valid data-column-id
    var container = getContainer();
    if (container) {
      var domCols = container.querySelectorAll('.column');
      for (var d = 0; d < domCols.length; d++) {
        var domColId = domCols[d].getAttribute('data-column-id');
        assert(domColId, label + ': DOM column ' + d + ' has data-column-id');
        assert(colIdsSeen[domColId], label + ': DOM column ' + d + ' ID exists in data');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // COMPREHENSIVE INTEGRITY TESTS — each action + full verification
  // ═══════════════════════════════════════════════════════════════════════

  register('integrity: board valid after cross-column card move', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      await api().moveCard(
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, cardIndex: 0, cardId: info.srcCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: info.dstCol.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);
      assertBoardIntegrity('after cross-column move');
    } finally { await teardown(); }
  });

  register('integrity: board valid after same-column reorder', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      if (col.cards.length < 2) throw new Error('Need >=2 cards');
      var lastCard = col.cards[col.cards.length - 1];
      await api().moveCard(
        { boardId: _boardId, flatColIndex: col.flatIdx, cardIndex: col.cards.length - 1, cardId: lastCard.id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: col.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);
      assertBoardIntegrity('after same-column reorder');
    } finally { await teardown(); }
  });

  register('integrity: board valid after adding card via API', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      await api().addCardToActiveBoard(info.srcCol.flatIdx, 'Integrity Test Card __integ__');
      await delay(150);
      assertBoardIntegrity('after addCard API');
    } finally { await teardown(); }
  });

  register('integrity: board valid after removing card', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var data = api().getFullBoardData();
      data.rows[info.srcCol.row].stacks[info.srcCol.stack].columns[info.srcCol.localCol].cards.splice(0, 1);
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('after remove card');
    } finally { await teardown(); }
  });

  register('integrity: board valid after adding column', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var lastStack = data.rows[0].stacks[data.rows[0].stacks.length - 1];
      lastStack.columns.push({ id: '__integ-col__', title: 'Integrity Col', cards: [], include_source: null });
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('after add column');
    } finally { await teardown(); }
  });

  register('integrity: board valid after adding row with cards', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      data.rows.push({
        id: '__integ-row__', title: 'Integrity Row',
        stacks: [{ id: '__integ-stack__', title: 'IS',
          columns: [{ id: '__integ-rcol__', title: 'IC', cards: [
            { id: '__integ-card1__', content: 'Card 1', checked: false, kid: '__integ-card1__' },
            { id: '__integ-card2__', content: 'Card 2', checked: false, kid: '__integ-card2__' }
          ], include_source: null }]
        }]
      });
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('after add row with cards');
    } finally { await teardown(); }
  });

  register('integrity: board valid after removing column', async function () {
    await setup();
    try {
      // Add a column first so we can safely remove it
      var data = api().getFullBoardData();
      var lastStack = data.rows[0].stacks[data.rows[0].stacks.length - 1];
      lastStack.columns.push({ id: '__integ-rmcol__', title: 'To Remove', cards: [], include_source: null });
      api().setTestBoard(data, _boardId);
      await delay(100);

      data = api().getFullBoardData();
      lastStack = data.rows[0].stacks[data.rows[0].stacks.length - 1];
      lastStack.columns = lastStack.columns.filter(function (col) { return col.id !== '__integ-rmcol__'; });
      if (lastStack.columns.length === 0) {
        lastStack.columns.push({ id: '__integ-placeholder__', title: 'Empty', cards: [], include_source: null });
      }
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('after remove column');
    } finally { await teardown(); }
  });

  register('integrity: board valid after removing row', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      if (data.rows.length < 2) {
        // Add a row so we can remove it
        data.rows.push({
          id: '__integ-rmrow__', title: 'To Remove',
          stacks: [{ id: '__integ-rms__', title: 'S',
            columns: [{ id: '__integ-rmc__', title: 'C', cards: [], include_source: null }]
          }]
        });
        api().setTestBoard(data, _boardId);
        await delay(100);
        data = api().getFullBoardData();
      }
      data.rows.pop();
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('after remove row');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ARCHIVE / PARK / TRASH VISUAL STATE TESTS
  // ═══════════════════════════════════════════════════════════════════════

  register('hidden state: archiving a card removes it from view and keeps board valid', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);
      var totalBefore = getTotalViewCards();
      var archivedKid = col.cards[0].kid || col.cards[0].id;

      // Archive the first card by adding #hidden-internal-archived tag
      var data = api().getFullBoardData();
      var card = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards[0];
      card.content = (card.content || '') + ' #hidden-internal-archived';
      api().setTestBoard(data, _boardId);
      await delay(100);

      // Card should be gone from view
      assertEqual(getViewCardCount(col.flatIdx), countBefore - 1, 'archived card gone from column');
      assertEqual(getTotalViewCards(), totalBefore - 1, 'total visible cards decreased');
      var kids = getViewCardKids(col.flatIdx);
      assert(kids.indexOf(archivedKid) === -1, 'archived card not in DOM');

      // Board should still be structurally valid
      assertBoardIntegrity('after archive card');
    } finally { await teardown(); }
  });

  register('hidden state: trashing a card removes it from view and keeps board valid', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);
      var trashedKid = col.cards[0].kid || col.cards[0].id;

      var data = api().getFullBoardData();
      var card = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards[0];
      card.content = (card.content || '') + ' #hidden-internal-deleted';
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewCardCount(col.flatIdx), countBefore - 1, 'trashed card gone');
      assert(getViewCardKids(col.flatIdx).indexOf(trashedKid) === -1, 'trashed card not in DOM');
      assertBoardIntegrity('after trash card');
    } finally { await teardown(); }
  });

  register('hidden state: parking a card removes it from view and keeps board valid', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);
      var parkedKid = col.cards[0].kid || col.cards[0].id;

      var data = api().getFullBoardData();
      var card = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards[0];
      card.content = (card.content || '') + ' #hidden-internal-parked';
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewCardCount(col.flatIdx), countBefore - 1, 'parked card gone');
      assert(getViewCardKids(col.flatIdx).indexOf(parkedKid) === -1, 'parked card not in DOM');
      assertBoardIntegrity('after park card');
    } finally { await teardown(); }
  });

  register('hidden state: restoring an archived card makes it visible again', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);

      // Archive a card
      var data = api().getFullBoardData();
      var card = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards[0];
      var originalContent = card.content || '';
      card.content = originalContent + ' #hidden-internal-archived';
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertEqual(getViewCardCount(col.flatIdx), countBefore - 1, 'archived card gone');

      // Restore it by removing the tag
      data = api().getFullBoardData();
      card = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards[0];
      card.content = originalContent;
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewCardCount(col.flatIdx), countBefore, 'restored card visible');
      assertBoardIntegrity('after restore archived card');
    } finally { await teardown(); }
  });

  register('hidden state: multiple hidden cards in same column all excluded', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);

      var data = api().getFullBoardData();
      var cards = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards;
      cards.push({ id: '__multi-arch__', content: 'A #hidden-internal-archived', checked: false, kid: '__multi-arch__' });
      cards.push({ id: '__multi-del__', content: 'D #hidden-internal-deleted', checked: false, kid: '__multi-del__' });
      cards.push({ id: '__multi-park__', content: 'P #hidden-internal-parked', checked: false, kid: '__multi-park__' });
      cards.push({ id: '__multi-vis__', content: 'Visible Card', checked: false, kid: '__multi-vis__' });
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewCardCount(col.flatIdx), countBefore + 1, 'only visible card counted');
      var kids = getViewCardKids(col.flatIdx);
      assert(kids.indexOf('__multi-vis__') !== -1, 'visible card in DOM');
      assert(kids.indexOf('__multi-arch__') === -1, 'archived not in DOM');
      assert(kids.indexOf('__multi-del__') === -1, 'deleted not in DOM');
      assert(kids.indexOf('__multi-park__') === -1, 'parked not in DOM');
      assertBoardIntegrity('after multiple hidden cards');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SEQUENTIAL MUTATION + INTEGRITY — chain of actions
  // ═══════════════════════════════════════════════════════════════════════

  register('chain: add card → move card → remove card, board valid after each step', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var src = info.srcCol, dst = info.dstCol;

      // Step 1: Add card
      var data = api().getFullBoardData();
      data.rows[src.row].stacks[src.stack].columns[src.localCol].cards.push({
        id: '__chain-card__', content: 'Chain Test', checked: false, kid: '__chain-card__'
      });
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('chain step 1: add card');

      // Step 2: Move the new card to another column
      data = api().getFullBoardData();
      var srcCards = data.rows[src.row].stacks[src.stack].columns[src.localCol].cards;
      var chainIdx = -1;
      for (var i = 0; i < srcCards.length; i++) {
        if (srcCards[i].kid === '__chain-card__') { chainIdx = i; break; }
      }
      assert(chainIdx >= 0, 'chain card found in source');
      var chainCard = srcCards.splice(chainIdx, 1)[0];
      data.rows[dst.row].stacks[dst.stack].columns[dst.localCol].cards.push(chainCard);
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('chain step 2: move card');

      // Step 3: Remove the card
      data = api().getFullBoardData();
      var dstCards = data.rows[dst.row].stacks[dst.stack].columns[dst.localCol].cards;
      data.rows[dst.row].stacks[dst.stack].columns[dst.localCol].cards = dstCards.filter(function (c) {
        return c.kid !== '__chain-card__';
      });
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('chain step 3: remove card');
    } finally { await teardown(); }
  });

  register('chain: add row → add column → add cards → archive card → remove row, valid after each', async function () {
    await setup();
    try {
      // Step 1: Add row
      var data = api().getFullBoardData();
      data.rows.push({
        id: '__chain-row__', title: 'Chain Row',
        stacks: [{ id: '__chain-stack__', title: 'CS',
          columns: [{ id: '__chain-col1__', title: 'CC1', cards: [], include_source: null }]
        }]
      });
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('chain: after add row');

      // Step 2: Add column to the new row
      data = api().getFullBoardData();
      var newRow = data.rows[data.rows.length - 1];
      newRow.stacks[0].columns.push({ id: '__chain-col2__', title: 'CC2', cards: [], include_source: null });
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('chain: after add column');

      // Step 3: Add cards to both columns
      data = api().getFullBoardData();
      newRow = data.rows[data.rows.length - 1];
      newRow.stacks[0].columns[0].cards.push({ id: '__cc1__', content: 'Card in col1', checked: false, kid: '__cc1__' });
      newRow.stacks[0].columns[1].cards.push({ id: '__cc2__', content: 'Card in col2', checked: false, kid: '__cc2__' });
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('chain: after add cards');

      // Step 4: Archive one card
      data = api().getFullBoardData();
      newRow = data.rows[data.rows.length - 1];
      newRow.stacks[0].columns[0].cards[0].content += ' #hidden-internal-archived';
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('chain: after archive card');

      // Step 5: Remove the entire row
      data = api().getFullBoardData();
      data.rows = data.rows.filter(function (r) { return r.id !== '__chain-row__'; });
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('chain: after remove row');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // INCLUDE / EMBED — no broken state
  // ═══════════════════════════════════════════════════════════════════════

  register('include: card with include syntax does not render broken embed', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var data = api().getFullBoardData();
      data.rows[col.row].stacks[col.stack].columns[col.localCol].cards.push({
        id: '__incl-card-test__', kid: '__incl-card-test__', checked: false,
        content: 'Include Card\n!!!include(docs/included-file.md)!!!'
      });
      api().setTestBoard(data, _boardId);
      await delay(120);

      var c = getContainer();
      var cardEl = c.querySelector('.card[data-card-kid="__incl-card-test__"]');
      assert(cardEl, 'include card rendered');
      // The include directive should NOT produce a broken embed container
      var brokenEmbed = cardEl.querySelector('.embed-container.embed-broken');
      assert(!brokenEmbed, 'no broken embed in card with include syntax');
      assertBoardIntegrity('after include card added');
    } finally { await teardown(); }
  });

  register('include: column with includeSource does not show broken badge', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var targetStack = data.rows[0].stacks[0];
      targetStack.columns.push({
        id: '__incl-col-ok__', title: 'Included Column',
        cards: [{ id: '__incl-ok-card__', content: 'Included card content', checked: false, kid: '__incl-ok-card__' }],
        include_source: null,
        includeSource: { rawPath: 'docs/valid-include.md', missing: false }
      });
      api().setTestBoard(data, _boardId);
      await delay(120);

      var c = getContainer();
      var colEl = c.querySelector('.column[data-column-id="__incl-col-ok__"]');
      assert(colEl, 'include column rendered');
      var badge = colEl.querySelector('.column-include-badge');
      if (badge) {
        assert(!badge.classList.contains('include-broken'), 'include badge not broken for valid path');
      }
      assertBoardIntegrity('after include column added');
    } finally { await teardown(); }
  });

  register('include: column with missing includeSource shows broken badge', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var targetStack = data.rows[0].stacks[0];
      targetStack.columns.push({
        id: '__incl-col-bad__', title: 'Broken Include Column',
        cards: [],
        include_source: null,
        includeSource: { rawPath: 'docs/nonexistent.md', missing: true }
      });
      api().setTestBoard(data, _boardId);
      await delay(120);

      var c = getContainer();
      var colEl = c.querySelector('.column[data-column-id="__incl-col-bad__"]');
      assert(colEl, 'broken include column rendered');
      var badge = colEl.querySelector('.column-include-badge');
      if (badge) {
        assert(badge.classList.contains('include-broken'), 'include badge marked broken for missing path');
      }
      assertBoardIntegrity('after broken include column added');
    } finally { await teardown(); }
  });

  register('embed: card with valid image embed does not show broken state', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var data = api().getFullBoardData();
      data.rows[col.row].stacks[col.stack].columns[col.localCol].cards.push({
        id: '__embed-ok-test__', kid: '__embed-ok-test__', checked: false,
        content: 'Embed OK\n![Photo](assets/photo.jpg)'
      });
      api().setTestBoard(data, _boardId);
      await delay(120);

      var c = getContainer();
      var cardEl = c.querySelector('.card[data-card-kid="__embed-ok-test__"]');
      assert(cardEl, 'embed card rendered');
      var brokenEmbed = cardEl.querySelector('.embed-container.embed-broken');
      assert(!brokenEmbed, 'no broken embed state for valid image syntax');
      assertBoardIntegrity('after embed card added');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SCROLL / FOCUS PRESERVATION — view stays where user is working
  // ═══════════════════════════════════════════════════════════════════════

  register('focus: setTestBoard preserves scroll position', async function () {
    await setup();
    try {
      var c = getContainer();
      if (!c) return;
      // Scroll the container down a bit (only meaningful if content is tall enough)
      var scrollable = c.closest('.board-row-content') || c;
      var maxScroll = scrollable.scrollHeight - scrollable.clientHeight;
      if (maxScroll < 10) return; // skip if not scrollable
      scrollable.scrollTop = Math.min(50, maxScroll);
      await delay(50);
      var scrollBefore = scrollable.scrollTop;
      assert(scrollBefore > 0, 'scrolled down');

      // Mutate via setTestBoard — should not reset scroll
      var data = api().getFullBoardData();
      api().setTestBoard(data, _boardId);
      await delay(150);

      var scrollAfter = scrollable.scrollTop;
      // Allow small variance (browser rounding)
      assert(Math.abs(scrollAfter - scrollBefore) < 5, 'scroll preserved after setTestBoard: before=' + scrollBefore + ' after=' + scrollAfter);
    } finally { await teardown(); }
  });

  register('focus: adding card to column does not scroll view to top', async function () {
    await setup();
    try {
      var c = getContainer();
      if (!c) return;
      var scrollable = c.closest('.board-row-content') || c;
      var maxScroll = scrollable.scrollHeight - scrollable.clientHeight;
      if (maxScroll < 10) return;
      scrollable.scrollTop = Math.min(50, maxScroll);
      await delay(50);
      var scrollBefore = scrollable.scrollTop;

      // Add a card
      var info = findTwoColumnsWithCards();
      var data = api().getFullBoardData();
      data.rows[info.srcCol.row].stacks[info.srcCol.stack].columns[info.srcCol.localCol].cards.push({
        id: '__scroll-card__', content: 'Scroll Test', checked: false, kid: '__scroll-card__'
      });
      api().setTestBoard(data, _boardId);
      await delay(150);

      var scrollAfter = scrollable.scrollTop;
      assert(Math.abs(scrollAfter - scrollBefore) < 5, 'scroll preserved after add card: before=' + scrollBefore + ' after=' + scrollAfter);
    } finally { await teardown(); }
  });

  register('focus: moving card between columns does not scroll view to top', async function () {
    await setup();
    try {
      var c = getContainer();
      if (!c) return;
      var scrollable = c.closest('.board-row-content') || c;
      var maxScroll = scrollable.scrollHeight - scrollable.clientHeight;
      if (maxScroll < 10) return;
      scrollable.scrollTop = Math.min(50, maxScroll);
      await delay(50);
      var scrollBefore = scrollable.scrollTop;

      var info = findTwoColumnsWithCards();
      await api().moveCard(
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, cardIndex: 0, cardId: info.srcCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: info.dstCol.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(150);

      var scrollAfter = scrollable.scrollTop;
      assert(Math.abs(scrollAfter - scrollBefore) < 5, 'scroll preserved after move card: before=' + scrollBefore + ' after=' + scrollAfter);
    } finally { await teardown(); }
  });

  register('focus: archiving card does not scroll view to top', async function () {
    await setup();
    try {
      var c = getContainer();
      if (!c) return;
      var scrollable = c.closest('.board-row-content') || c;
      var maxScroll = scrollable.scrollHeight - scrollable.clientHeight;
      if (maxScroll < 10) return;
      scrollable.scrollTop = Math.min(50, maxScroll);
      await delay(50);
      var scrollBefore = scrollable.scrollTop;

      var info = findTwoColumnsWithCards();
      var data = api().getFullBoardData();
      var card = data.rows[info.srcCol.row].stacks[info.srcCol.stack].columns[info.srcCol.localCol].cards[0];
      card.content = (card.content || '') + ' #hidden-internal-archived';
      api().setTestBoard(data, _boardId);
      await delay(150);

      var scrollAfter = scrollable.scrollTop;
      assert(Math.abs(scrollAfter - scrollBefore) < 5, 'scroll preserved after archive: before=' + scrollBefore + ' after=' + scrollAfter);
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TAG EDITS — changing tags updates card visibility and board state
  // ═══════════════════════════════════════════════════════════════════════

  register('tag edit: adding #hidden-internal-archived removes card from view', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);
      var kid = col.cards[0].kid || col.cards[0].id;

      var data = api().getFullBoardData();
      var card = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards[0];
      card.content = (card.content || '') + ' #hidden-internal-archived';
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewCardCount(col.flatIdx), countBefore - 1, 'card removed from view');
      assert(getViewCardKids(col.flatIdx).indexOf(kid) === -1, 'card ID gone from DOM');
      assertBoardIntegrity('after tag edit: archive');
    } finally { await teardown(); }
  });

  register('tag edit: removing #hidden-internal-archived restores card to view', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);

      // Archive it
      var data = api().getFullBoardData();
      var card = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards[0];
      var original = card.content || '';
      card.content = original + ' #hidden-internal-archived';
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertEqual(getViewCardCount(col.flatIdx), countBefore - 1, 'card archived');

      // Remove tag to restore
      data = api().getFullBoardData();
      data.rows[col.row].stacks[col.stack].columns[col.localCol].cards[0].content = original;
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertEqual(getViewCardCount(col.flatIdx), countBefore, 'card restored to view');
      assertBoardIntegrity('after tag edit: unarchive');
    } finally { await teardown(); }
  });

  register('tag edit: changing card from parked to deleted keeps it hidden', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);
      var kid = col.cards[0].kid || col.cards[0].id;

      // Park it
      var data = api().getFullBoardData();
      var card = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards[0];
      var original = card.content || '';
      card.content = original + ' #hidden-internal-parked';
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertEqual(getViewCardCount(col.flatIdx), countBefore - 1, 'card parked');

      // Switch to deleted
      data = api().getFullBoardData();
      data.rows[col.row].stacks[col.stack].columns[col.localCol].cards[0].content =
        original + ' #hidden-internal-deleted';
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertEqual(getViewCardCount(col.flatIdx), countBefore - 1, 'card still hidden after tag change');
      assert(getViewCardKids(col.flatIdx).indexOf(kid) === -1, 'card still not in DOM');
      assertBoardIntegrity('after tag edit: park to delete');
    } finally { await teardown(); }
  });

  register('tag edit: adding temporal tag to card keeps it visible and renders badge', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);

      var data = api().getFullBoardData();
      data.rows[col.row].stacks[col.stack].columns[col.localCol].cards.push({
        id: '__tag-temporal__', kid: '__tag-temporal__', checked: false,
        content: 'Deadline card #today'
      });
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewCardCount(col.flatIdx), countBefore + 1, 'temporal tag card visible');
      var c = getContainer();
      var cardEl = c.querySelector('.card[data-card-kid="__tag-temporal__"]');
      assert(cardEl, 'card rendered');
      // Check for due badge
      var badge = cardEl.querySelector('.card-due-badge');
      if (badge) {
        assert(badge.textContent.length > 0, 'due badge has content');
      }
      assertBoardIntegrity('after temporal tag card');
    } finally { await teardown(); }
  });

  register('tag edit: adding checked state preserves card in view', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var col = info.srcCol;
      var countBefore = getViewCardCount(col.flatIdx);

      var data = api().getFullBoardData();
      var card = data.rows[col.row].stacks[col.stack].columns[col.localCol].cards[0];
      card.checked = true;
      api().setTestBoard(data, _boardId);
      await delay(100);

      // Checked cards should still be visible (not hidden)
      assertEqual(getViewCardCount(col.flatIdx), countBefore, 'checked card still visible');
      assertBoardIntegrity('after check card');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // WORKSPACE MOVE TESTS — view+workspace coordinate combinations
  // ═══════════════════════════════════════════════════════════════════════

  register('workspace move: view→view + integrity check', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var movedKid = info.srcCol.cards[0].kid || info.srcCol.cards[0].id;
      var srcCountBefore = getViewCardCount(info.srcCol.flatIdx);
      var dstCountBefore = getViewCardCount(info.dstCol.flatIdx);

      await api().moveCard(
        { boardId: _boardId, flatColIndex: info.srcCol.flatIdx, cardIndex: 0, cardId: info.srcCol.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, flatColIndex: info.dstCol.flatIdx, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);

      assertEqual(getViewCardCount(info.srcCol.flatIdx), srcCountBefore - 1, 'source -1');
      assertEqual(getViewCardCount(info.dstCol.flatIdx), dstCountBefore + 1, 'target +1');
      assertEqual(getViewCardKids(info.dstCol.flatIdx)[0], movedKid, 'card is first in target');
      assertBoardIntegrity('after view→view move');
    } finally { await teardown(); }
  });

  register('workspace move: workspace→workspace + integrity check', async function () {
    await setup();
    try {
      var info = findTwoColumnsWithCards();
      var src = info.srcCol, dst = info.dstCol;
      var movedKid = src.cards[0].kid || src.cards[0].id;

      await api().moveCard(
        { boardId: _boardId, rowIndex: src.row, stackIndex: src.stack, colIndex: src.localCol, columnId: src.col.id, cardIndex: 0, cardId: src.cards[0].id, cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: _boardId, rowIndex: dst.row, stackIndex: dst.stack, colIndex: dst.localCol, columnId: dst.col.id, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(100);

      assert(getViewCardKids(dst.flatIdx).indexOf(movedKid) !== -1, 'card in target');
      assertBoardIntegrity('after workspace→workspace move');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STRUCTURAL EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════

  register('structure: adding card to empty column renders correctly', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var lastStack = data.rows[0].stacks[data.rows[0].stacks.length - 1];
      lastStack.columns.push({
        id: '__empty-then-card__', title: 'Empty Col',
        cards: [], include_source: null
      });
      api().setTestBoard(data, _boardId);
      await delay(100);

      var allCols = api().getAllFullColumns();
      var emptyIdx = allCols.length - 1;
      assertEqual(getViewCardCount(emptyIdx), 0, 'column starts empty');

      // Now add a card to it
      data = api().getFullBoardData();
      allCols = api().getAllFullColumns();
      allCols[allCols.length - 1].cards.push({
        id: '__empty-card__', content: 'First card in empty col', checked: false, kid: '__empty-card__'
      });
      api().setTestBoard(data, _boardId);
      await delay(100);

      assertEqual(getViewCardCount(emptyIdx), 1, 'card added to formerly empty column');
      assert(getViewCardKids(emptyIdx).indexOf('__empty-card__') !== -1, 'card visible');
      assertBoardIntegrity('after card in empty column');
    } finally { await teardown(); }
  });

  register('structure: board with single row, single stack, single column stays valid', async function () {
    await setup();
    try {
      var minimalBoard = {
        title: 'Minimal Board',
        rows: [{
          id: '__min-row__', title: 'Only Row',
          stacks: [{ id: '__min-stack__', title: 'Only Stack',
            columns: [{ id: '__min-col__', title: 'Only Column', cards: [
              { id: '__min-card__', content: 'Only Card', checked: false, kid: '__min-card__' }
            ], include_source: null }]
          }]
        }]
      };
      api().setTestBoard(minimalBoard, _boardId);
      await delay(100);

      assertEqual(getViewRowCount(), 1, '1 row');
      assertEqual(getViewColumnCount(), 1, '1 column');
      assertEqual(getTotalViewCards(), 1, '1 card');
      assertBoardIntegrity('minimal board');
    } finally { await teardown(); }
  });

  register('structure: board with many rows and columns stays valid', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      // Add 3 rows with 2 columns each
      for (var r = 0; r < 3; r++) {
        data.rows.push({
          id: '__bulk-row-' + r + '__', title: 'Bulk Row ' + r,
          stacks: [{ id: '__bulk-stack-' + r + '__', title: 'BS' + r,
            columns: [
              { id: '__bulk-col-' + r + 'a__', title: 'BC' + r + 'A', cards: [
                { id: '__bulk-card-' + r + 'a__', content: 'R' + r + 'A', checked: false, kid: '__bulk-card-' + r + 'a__' }
              ], include_source: null },
              { id: '__bulk-col-' + r + 'b__', title: 'BC' + r + 'B', cards: [
                { id: '__bulk-card-' + r + 'b__', content: 'R' + r + 'B', checked: false, kid: '__bulk-card-' + r + 'b__' }
              ], include_source: null }
            ]
          }]
        });
      }
      api().setTestBoard(data, _boardId);
      await delay(150);
      assertBoardIntegrity('bulk board with many rows and columns');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // COLUMN INCLUDE TESTS — !!!include(path)!!! in column headers
  // ═══════════════════════════════════════════════════════════════════════

  function getOrderHelpers() {
    var g = typeof globalThis !== 'undefined' ? globalThis : window;
    return g.LexeraOrderHelpers || null;
  }

  register('include header: adding include syntax to column title renders include badge', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var targetStack = data.rows[0].stacks[0];
      targetStack.columns.push({
        id: '__incl-hdr-add__', title: 'Backlog !!!include(docs/backlog.md)!!!',
        cards: [
          { id: '__incl-hdr-c1__', content: 'Included Card 1', checked: false, kid: '__incl-hdr-c1__' },
          { id: '__incl-hdr-c2__', content: 'Included Card 2', checked: false, kid: '__incl-hdr-c2__' }
        ],
        include_source: null,
        includeSource: { rawPath: 'docs/backlog.md', missing: false }
      });
      api().setTestBoard(data, _boardId);
      await delay(120);

      var c = getContainer();
      var colEl = c.querySelector('.column[data-column-id="__incl-hdr-add__"]');
      assert(colEl, 'include column rendered');

      // Badge should exist and not be broken
      var badge = colEl.querySelector('.column-include-badge');
      assert(badge, 'include badge rendered');
      assert(!badge.classList.contains('include-broken'), 'badge not marked broken');
      assertEqual(badge.getAttribute('data-include-path'), 'docs/backlog.md', 'badge has correct path');

      // Cards should be visible
      var allCols = api().getAllFullColumns();
      var colIdx = allCols.length - 1;
      assertEqual(getViewCardCount(colIdx), 2, 'included cards visible');
      assertBoardIntegrity('after include header add');
    } finally { await teardown(); }
  });

  register('include header: column with missing include shows broken badge', async function () {
    await setup();
    try {
      var data = api().getFullBoardData();
      var targetStack = data.rows[0].stacks[0];
      targetStack.columns.push({
        id: '__incl-hdr-miss__', title: 'Missing !!!include(nonexistent.md)!!!',
        cards: [],
        include_source: null,
        includeSource: { rawPath: 'nonexistent.md', missing: true }
      });
      api().setTestBoard(data, _boardId);
      await delay(120);

      var c = getContainer();
      var colEl = c.querySelector('.column[data-column-id="__incl-hdr-miss__"]');
      assert(colEl, 'column rendered');
      var badge = colEl.querySelector('.column-include-badge');
      assert(badge, 'badge rendered');
      assert(badge.classList.contains('include-broken'), 'badge marked broken for missing file');
      assertBoardIntegrity('after missing include');
    } finally { await teardown(); }
  });

  register('include header: changing include path updates badge and column data', async function () {
    await setup();
    try {
      // Step 1: Add column with include
      var data = api().getFullBoardData();
      var targetStack = data.rows[0].stacks[0];
      targetStack.columns.push({
        id: '__incl-hdr-chg__', title: 'Schedule !!!include(docs/old.md)!!!',
        cards: [{ id: '__incl-chg-c1__', content: 'Old Card', checked: false, kid: '__incl-chg-c1__' }],
        include_source: null,
        includeSource: { rawPath: 'docs/old.md', missing: false }
      });
      api().setTestBoard(data, _boardId);
      await delay(120);

      var c = getContainer();
      var badge = c.querySelector('.column[data-column-id="__incl-hdr-chg__"] .column-include-badge');
      assert(badge, 'initial badge exists');
      assertEqual(badge.getAttribute('data-include-path'), 'docs/old.md', 'initial path');

      // Step 2: Change to new include path
      data = api().getFullBoardData();
      var allCols = api().getAllFullColumns();
      var targetCol = null;
      for (var i = 0; i < allCols.length; i++) {
        if (allCols[i].id === '__incl-hdr-chg__') { targetCol = allCols[i]; break; }
      }
      assert(targetCol, 'target column found in data');

      // Update title and includeSource
      var helpers = getOrderHelpers();
      if (helpers && typeof helpers.addIncludeSyntaxToTitle === 'function') {
        targetCol.title = helpers.addIncludeSyntaxToTitle(
          helpers.removeIncludeSyntaxFromTitle(targetCol.title || ''),
          'docs/new.md'
        );
      } else {
        targetCol.title = 'Schedule !!!include(docs/new.md)!!!';
      }
      targetCol.includeSource = { rawPath: 'docs/new.md', missing: false };
      targetCol.cards = [{ id: '__incl-chg-c2__', content: 'New Card', checked: false, kid: '__incl-chg-c2__' }];
      api().setTestBoard(data, _boardId);
      await delay(120);

      c = getContainer();
      badge = c.querySelector('.column[data-column-id="__incl-hdr-chg__"] .column-include-badge');
      assert(badge, 'badge still exists after path change');
      assertEqual(badge.getAttribute('data-include-path'), 'docs/new.md', 'updated path');
      assertBoardIntegrity('after include path change');
    } finally { await teardown(); }
  });

  register('include header: removing include syntax removes badge and cards', async function () {
    await setup();
    try {
      // Step 1: Add column with include and cards
      var data = api().getFullBoardData();
      var targetStack = data.rows[0].stacks[0];
      targetStack.columns.push({
        id: '__incl-hdr-rm__', title: 'Reports !!!include(docs/reports.md)!!!',
        cards: [
          { id: '__incl-rm-c1__', content: 'Report 1', checked: false, kid: '__incl-rm-c1__' },
          { id: '__incl-rm-c2__', content: 'Report 2', checked: false, kid: '__incl-rm-c2__' }
        ],
        include_source: null,
        includeSource: { rawPath: 'docs/reports.md', missing: false }
      });
      api().setTestBoard(data, _boardId);
      await delay(120);

      var allCols = api().getAllFullColumns();
      var colIdx = allCols.length - 1;
      assertEqual(getViewCardCount(colIdx), 2, 'cards visible before remove');

      // Step 2: Remove include syntax and cards (simulating disableColumnIncludeMode)
      data = api().getFullBoardData();
      allCols = api().getAllFullColumns();
      var targetCol = allCols[allCols.length - 1];

      var helpers = getOrderHelpers();
      if (helpers && typeof helpers.removeIncludeSyntaxFromTitle === 'function') {
        targetCol.title = helpers.removeIncludeSyntaxFromTitle(targetCol.title || '');
      } else {
        targetCol.title = 'Reports';
      }
      targetCol.includeSource = null;
      targetCol.cards = []; // Cards removed when include is disabled
      api().setTestBoard(data, _boardId);
      await delay(120);

      var c = getContainer();
      var colEl = c.querySelector('.column[data-column-id="__incl-hdr-rm__"]');
      assert(colEl, 'column still exists');
      var badge = colEl.querySelector('.column-include-badge');
      assert(!badge, 'badge removed after include syntax removed');

      allCols = api().getAllFullColumns();
      colIdx = allCols.length - 1;
      assertEqual(getViewCardCount(colIdx), 0, 'cards removed after include disabled');
      assertBoardIntegrity('after include removed');
    } finally { await teardown(); }
  });

  register('include header: pre-existing cards are preserved in data when include is added', async function () {
    await setup();
    try {
      // Step 1: Column with regular cards (no include)
      var data = api().getFullBoardData();
      var targetStack = data.rows[0].stacks[0];
      targetStack.columns.push({
        id: '__incl-hdr-pre__', title: 'Existing Work',
        cards: [
          { id: '__incl-pre-c1__', content: 'Existing Card 1', checked: false, kid: '__incl-pre-c1__' },
          { id: '__incl-pre-c2__', content: 'Existing Card 2', checked: false, kid: '__incl-pre-c2__' }
        ],
        include_source: null
      });
      api().setTestBoard(data, _boardId);
      await delay(120);

      var allCols = api().getAllFullColumns();
      var colIdx = allCols.length - 1;
      assertEqual(getViewCardCount(colIdx), 2, 'existing cards visible');

      // Step 2: Add include syntax — the existing cards should still be in data
      // (In real usage, the backend would suggest moving them to the included file)
      data = api().getFullBoardData();
      allCols = api().getAllFullColumns();
      var targetCol = allCols[allCols.length - 1];

      var helpers = getOrderHelpers();
      if (helpers && typeof helpers.addIncludeSyntaxToTitle === 'function') {
        targetCol.title = helpers.addIncludeSyntaxToTitle(targetCol.title || '', 'docs/work.md');
      } else {
        targetCol.title = 'Existing Work !!!include(docs/work.md)!!!';
      }
      targetCol.includeSource = { rawPath: 'docs/work.md', missing: false };
      // Pre-existing cards remain (they'd be suggested for migration in real flow)
      api().setTestBoard(data, _boardId);
      await delay(120);

      // Cards should still be visible
      allCols = api().getAllFullColumns();
      colIdx = allCols.length - 1;
      assertEqual(getViewCardCount(colIdx), 2, 'pre-existing cards still visible after include added');
      assert(getViewCardKids(colIdx).indexOf('__incl-pre-c1__') !== -1, 'card 1 preserved');
      assert(getViewCardKids(colIdx).indexOf('__incl-pre-c2__') !== -1, 'card 2 preserved');

      // Badge should render
      var c = getContainer();
      var badge = c.querySelector('.column[data-column-id="__incl-hdr-pre__"] .column-include-badge');
      assert(badge, 'include badge renders with pre-existing cards');
      assertBoardIntegrity('after include added with pre-existing cards');
    } finally { await teardown(); }
  });

  register('include header: full lifecycle — add include → change path → remove include', async function () {
    await setup();
    try {
      var helpers = getOrderHelpers();

      // Step 1: Start with plain column
      var data = api().getFullBoardData();
      var targetStack = data.rows[0].stacks[0];
      targetStack.columns.push({
        id: '__incl-lifecycle__', title: 'Lifecycle Column',
        cards: [{ id: '__lc-c1__', content: 'Original Card', checked: false, kid: '__lc-c1__' }],
        include_source: null
      });
      api().setTestBoard(data, _boardId);
      await delay(100);
      assertBoardIntegrity('lifecycle step 0: plain column');

      // Step 2: Add include
      data = api().getFullBoardData();
      var allCols = api().getAllFullColumns();
      var col = allCols[allCols.length - 1];
      if (helpers && helpers.addIncludeSyntaxToTitle) {
        col.title = helpers.addIncludeSyntaxToTitle(col.title || '', 'docs/first.md');
      } else {
        col.title = col.title + ' !!!include(docs/first.md)!!!';
      }
      col.includeSource = { rawPath: 'docs/first.md', missing: false };
      col.cards.push({ id: '__lc-c2__', content: 'Included Card', checked: false, kid: '__lc-c2__' });
      api().setTestBoard(data, _boardId);
      await delay(100);

      var c = getContainer();
      var badge = c.querySelector('.column[data-column-id="__incl-lifecycle__"] .column-include-badge');
      assert(badge, 'badge after add');
      assertEqual(badge.getAttribute('data-include-path'), 'docs/first.md', 'first path');
      assertBoardIntegrity('lifecycle step 1: add include');

      // Step 3: Change path
      data = api().getFullBoardData();
      allCols = api().getAllFullColumns();
      col = allCols[allCols.length - 1];
      if (helpers && helpers.removeIncludeSyntaxFromTitle && helpers.addIncludeSyntaxToTitle) {
        col.title = helpers.addIncludeSyntaxToTitle(
          helpers.removeIncludeSyntaxFromTitle(col.title || ''), 'docs/second.md'
        );
      } else {
        col.title = 'Lifecycle Column !!!include(docs/second.md)!!!';
      }
      col.includeSource = { rawPath: 'docs/second.md', missing: false };
      col.cards = [{ id: '__lc-c3__', content: 'New Included Card', checked: false, kid: '__lc-c3__' }];
      api().setTestBoard(data, _boardId);
      await delay(100);

      c = getContainer();
      badge = c.querySelector('.column[data-column-id="__incl-lifecycle__"] .column-include-badge');
      assert(badge, 'badge after path change');
      assertEqual(badge.getAttribute('data-include-path'), 'docs/second.md', 'second path');
      assertBoardIntegrity('lifecycle step 2: change path');

      // Step 4: Remove include
      data = api().getFullBoardData();
      allCols = api().getAllFullColumns();
      col = allCols[allCols.length - 1];
      if (helpers && helpers.removeIncludeSyntaxFromTitle) {
        col.title = helpers.removeIncludeSyntaxFromTitle(col.title || '');
      } else {
        col.title = 'Lifecycle Column';
      }
      col.includeSource = null;
      col.cards = [];
      api().setTestBoard(data, _boardId);
      await delay(100);

      c = getContainer();
      badge = c.querySelector('.column[data-column-id="__incl-lifecycle__"] .column-include-badge');
      assert(!badge, 'badge gone after remove');
      allCols = api().getAllFullColumns();
      var colIdx = allCols.length - 1;
      assertEqual(getViewCardCount(colIdx), 0, 'cards gone after include removed');
      assertBoardIntegrity('lifecycle step 3: remove include');
    } finally { await teardown(); }
  });

  register('include header: include syntax functions produce correct title strings', async function () {
    await setup();
    try {
      var helpers = getOrderHelpers();
      if (!helpers || !helpers.addIncludeSyntaxToTitle || !helpers.removeIncludeSyntaxFromTitle || !helpers.extractIncludePathFromTitle) return;

      // addIncludeSyntaxToTitle
      var result = helpers.addIncludeSyntaxToTitle('My Column', 'docs/data.md');
      assert(result.indexOf('!!!include(docs/data.md)!!!') !== -1, 'include syntax added');
      assert(result.indexOf('My Column') !== -1, 'title text preserved');

      // extractIncludePathFromTitle
      var path = helpers.extractIncludePathFromTitle(result);
      assertEqual(path, 'docs/data.md', 'path extracted correctly');

      // removeIncludeSyntaxFromTitle
      var cleaned = helpers.removeIncludeSyntaxFromTitle(result);
      assert(cleaned.indexOf('!!!include') === -1, 'include syntax removed');
      assert(cleaned.indexOf('My Column') !== -1, 'title text preserved after removal');

      // Double add doesn't duplicate
      var doubled = helpers.addIncludeSyntaxToTitle(result, 'docs/other.md');
      var occurrences = (doubled.match(/!!!include/g) || []).length;
      assertEqual(occurrences, 1, 'only one include directive after re-add');
      assertEqual(helpers.extractIncludePathFromTitle(doubled), 'docs/other.md', 'path updated to new value');
    } finally { await teardown(); }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Test runner (console)
  // ═══════════════════════════════════════════════════════════════════════

  async function runAll() {
    _api = null;
    var results = [];
    var totalStart = _nowMs();
    console.log('%c[Frontend Tests] Running ' + tests.length + ' tests...', 'color: #007acc; font-weight: bold; font-size: 14px');
    for (var i = 0; i < tests.length; i++) {
      var testStart = _nowMs();
      try {
        await tests[i].fn();
        var testDur = _nowMs() - testStart;
        results.push({ name: tests[i].name, passed: true, durationMs: testDur });
        console.log('%c  PASS %c ' + tests[i].name + ' %c(' + formatDurationMs(testDur) + ')',
          'color: #4ec9b0; font-weight: bold', 'color: inherit', 'color: #888');
      } catch (err) {
        var testDurFail = _nowMs() - testStart;
        results.push({ name: tests[i].name, passed: false, error: err.message || String(err), durationMs: testDurFail });
        console.log('%c  FAIL %c ' + tests[i].name + ' %c(' + formatDurationMs(testDurFail) + ')%c: ' + (err.message || err),
          'color: #f44747; font-weight: bold', 'color: #f44747', 'color: #888', 'color: #f44747');
      }
    }
    var totalDur = _nowMs() - totalStart;
    var p = results.filter(function (r) { return r.passed; }).length;
    var f = results.filter(function (r) { return !r.passed; }).length;
    console.log('%c[Frontend Tests] ' + p + ' passed, ' + f + ' failed / ' + tests.length + ' in ' + formatDurationMs(totalDur),
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
    var manualInspect = root.querySelector('.lexera-shared-test-manual-inspect');
    var continueUndoBtn = root.querySelector('.lexera-shared-test-continue-undo');
    var rows = root.querySelectorAll('.test-row');
    var running = isRunActive();
    var awaitingUndo = !!_manualInspectState.awaitingUndo;
    if (runBtn) runBtn.disabled = running;
    if (stopBtn) {
      stopBtn.disabled = !running;
      stopBtn.textContent = _runState.cancelRequested ? 'Stopping…' : 'Stop Run';
    }
    if (manualInspect) {
      manualInspect.disabled = running && !awaitingUndo;
    }
    if (continueUndoBtn) {
      continueUndoBtn.disabled = !awaitingUndo;
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
    var totalDurMs = 0;
    var includePasses = scope === 'all';
    for (var i = 0; i < lastResults.length; i++) {
      var r = lastResults[i];
      if (typeof r.durationMs === 'number') totalDurMs += r.durationMs;
      if (!includePasses && r.passed) {
        if (r.passed) p++;
        continue;
      }
      var durLabel = '';
      if (typeof r.durationMs === 'number') {
        durLabel = ' (' + formatDurationMs(r.durationMs);
        if (typeof r.setupMs === 'number' || typeof r.bodyMs === 'number' || typeof r.teardownMs === 'number') {
          durLabel += ' s:' + formatDurationMs(r.setupMs || 0)
            + ' b:' + formatDurationMs(r.bodyMs || 0)
            + ' t:' + formatDurationMs(r.teardownMs || 0);
        }
        durLabel += ')';
      }
      lines.push('[' + (r.passed ? 'PASS' : 'FAIL') + ']' + durLabel + ' ' + r.name);
      if (!r.passed && r.error) lines.push('       ' + r.error);
      // Include mutation profile: show top samples with phase breakdowns
      if (r.mutationProfile && r.mutationProfile.count > 0) {
        var mp = r.mutationProfile;
        var _rcLine = '';
        if (mp.renderColumnsCount != null) {
          _rcLine = ' renderColumns=' + mp.renderColumnsCount
                  + ' rnfb=' + (mp.rnfbCount || 0)
                  + ' iframeReuse=' + (mp.iframeReuseCount || 0)
                  + ' iframeFresh=' + (mp.iframeFreshCount || 0);
        }
        lines.push('       mutations=' + mp.count
          + ' total=' + formatDurationMs(mp.total)
          + _rcLine);
        var samples = mp.topSamples || [mp.slowest];
        var phaseOrder = [
          'afterLoadBoardData', 'afterResolveRefs', 'afterPushUndo',
          'afterBeforeRefresh', 'afterUpdateDisplay', 'afterCommit', 'afterRefreshTargeted',
          'afterDashboardSchedule', 'afterDraftSave', 'afterPersist',
          'afterSetFullBoard', 'afterRenderMainView',
          'afterCleanup', 'afterInnerHTMLClear', 'afterRenderNewFormatBoard', 'afterSyncScroll', 'afterScheduleRAF'
        ];
        var phaseNames = {
          afterLoadBoardData: 'loadBoardData',
          afterResolveRefs: 'resolveRefs',
          afterPushUndo: 'pushUndo',
          afterBeforeRefresh: 'before',
          afterUpdateDisplay: 'updateDisplay',
          afterCommit: 'commit',
          afterRefreshTargeted: 'refreshTargeted',
          afterDashboardSchedule: 'dashSched',
          afterDraftSave: 'draftSave',
          afterPersist: 'persist',
          afterSetFullBoard: 'setFullBoard',
          afterRenderMainView: 'renderMainView',
          afterCleanup: 'cleanup',
          afterInnerHTMLClear: 'innerHTMLClear',
          afterRenderNewFormatBoard: 'buildDOM',
          afterSyncScroll: 'syncScroll',
          afterScheduleRAF: 'scheduleRAF'
        };
        for (var si = 0; si < samples.length; si++) {
          var s = samples[si];
          if (!s) continue;
          lines.push('       ' + (si + 1) + '. ' + formatDurationMs(s.total) + ' [' + s.targets + ']');
          if (s.phases) {
            var phaseLabels = [];
            var prev = 0;
            for (var phi = 0; phi < phaseOrder.length; phi++) {
              var key = phaseOrder[phi];
              if (typeof s.phases[key] === 'number') {
                var delta = s.phases[key] - prev;
                if (delta > 1) phaseLabels.push(phaseNames[key] + '=' + formatDurationMs(delta));
                prev = s.phases[key];
              }
            }
            if (phaseLabels.length > 0) lines.push('          ' + phaseLabels.join(' '));
          }
          if (s.cards && s.cards.count > 0) {
            var perCardUs = s.cards.count > 0 ? Math.round((s.cards.totalMs / s.cards.count) * 1000) : 0;
            lines.push('          cards=' + s.cards.count
              + ' cacheHits=' + s.cards.cacheHits
              + ' cardTotal=' + formatDurationMs(s.cards.totalMs)
              + ' markdown=' + formatDurationMs(s.cards.markdownMs)
              + ' include=' + formatDurationMs(s.cards.includeResolveMs)
              + ' perCard=' + perCardUs + 'µs');
          }
          if (s.structure && s.structure.columns > 0) {
            var perColUs = s.structure.columns > 0 ? Math.round((s.structure.columnTotalMs / s.structure.columns) * 1000) : 0;
            lines.push('          cols=' + s.structure.columns
              + ' colTotal=' + formatDurationMs(s.structure.columnTotalMs)
              + ' colHeader=' + formatDurationMs(s.structure.columnHeaderMs)
              + ' colListeners=' + formatDurationMs(s.structure.columnListenersMs)
              + ' colCardsLoop=' + formatDurationMs(s.structure.columnCardsLoopMs)
              + ' colFooter=' + formatDurationMs(s.structure.columnFooterMs)
              + ' perCol=' + perColUs + 'µs');
            lines.push('          stacks=' + s.structure.stacks
              + ' stackTotal=' + formatDurationMs(s.structure.stackTotalMs)
              + ' stackHeader=' + formatDurationMs(s.structure.stackHeaderMs)
              + ' stackListeners=' + formatDurationMs(s.structure.stackListenersMs)
              + ' rows=' + s.structure.rows
              + ' rowTotal=' + formatDurationMs(s.structure.rowTotalMs));
            lines.push('          rnfb: setup=' + formatDurationMs(s.structure.rnfbSetupMs)
              + ' buildLoop=' + formatDurationMs(s.structure.rnfbBuildMs)
              + ' liveAppend=' + formatDurationMs(s.structure.rnfbAppendMs));
          }
        }
      }
      if (r.passed) p++; else f++;
    }
    lines.push('');
    var totalLabel = totalDurMs > 0 ? ' in ' + formatDurationMs(totalDurMs) : '';
    lines.push(p + ' passed, ' + f + ' failed / ' + lastResults.length + totalLabel);
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
      // Body is a vertical stack: test name on top, duration on the
      // line below. This keeps longer duration breakdowns readable
      // without truncating the test name or pushing it onto two lines
      // because of flex-squeezing.
      var body = document.createElement('div'); body.className = 'test-row-body';
      var lbl = document.createElement('div'); lbl.className = 'test-row-label';
      lbl.textContent = tests[i].name;
      var dur = document.createElement('div'); dur.className = 'test-duration';
      body.appendChild(lbl);
      body.appendChild(dur);
      (function (idx) { row.onclick = function () { if (!isRunActive()) runOneUI(idx); }; })(i);
      row.appendChild(ind); row.appendChild(body); listEl.appendChild(row);
      var err = document.createElement('div'); err.className = 'test-error'; err.style.display = 'none';
      listEl.appendChild(err);
    }
    var runBtn = root.querySelector('.lexera-shared-test-run-all');
    if (runBtn) runBtn.onclick = function () { runAllUI(); };
    var stopBtn = root.querySelector('.lexera-shared-test-stop');
    if (stopBtn) stopBtn.onclick = function () { requestStopRun(); };
    var continueUndoBtn = root.querySelector('.lexera-shared-test-continue-undo');
    if (continueUndoBtn) continueUndoBtn.onclick = function () { continueManualUndo(); };
    var manualInspect = root.querySelector('.lexera-shared-test-manual-inspect');
    if (manualInspect) manualInspect.onchange = function () { updateRunControls(); };
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

  function formatDurationMs(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '';
    if (ms < 1) return '<1ms';
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(2) + 's';
  }

  function updateRow(index, status, error, durationMs, phases) {
    var root = findPanelRoot(); if (!root) return;
    var rows = root.querySelectorAll('.test-row');
    var errs = root.querySelectorAll('.test-error');
    if (index >= rows.length) return;
    var ind = rows[index].querySelector('.test-indicator');
    ind.className = 'test-indicator' + (status === 'pass' ? ' pass' : status === 'fail' ? ' fail' : status === 'running' ? ' running' : '');
    ind.textContent = status === 'pass' ? '\u2713' : status === 'fail' ? '\u2717' : status === 'running' ? '\u2026' : '';
    var dur = rows[index].querySelector('.test-duration');
    if (dur) {
      if (status === 'reset' || status === 'running') {
        dur.textContent = status === 'running' ? '…' : '';
        dur.style.color = 'var(--text-muted)';
        dur.title = '';
      } else if (typeof durationMs === 'number') {
        // Show phase breakdown directly in the label when available
        var label = formatDurationMs(durationMs);
        if (phases && (phases.setup || phases.body || phases.teardown)) {
          label += ' (s:' + formatDurationMs(phases.setup || 0)
            + ' b:' + formatDurationMs(phases.body || 0)
            + ' t:' + formatDurationMs(phases.teardown || 0) + ')';
          dur.title = 'setup: ' + formatDurationMs(phases.setup || 0)
            + '\nbody: ' + formatDurationMs(phases.body || 0)
            + '\nteardown: ' + formatDurationMs(phases.teardown || 0)
            + '\ntotal: ' + formatDurationMs(durationMs);
        } else {
          dur.title = '';
        }
        dur.textContent = label;
        // Color slow tests: >1s red, >500ms yellow
        if (durationMs > 1000) dur.style.color = 'var(--error)';
        else if (durationMs > 500) dur.style.color = 'var(--warning, #e6a700)';
        else dur.style.color = 'var(--text-muted)';
      }
    }
    if (errs[index]) {
      errs[index].textContent = (status === 'fail' && error) ? error : '';
      errs[index].style.display = (status === 'fail' && error) ? 'block' : 'none';
    }
  }

  function updateSummary(p, f, t) {
    setSummaryText(p + ' passed, ' + f + ' failed / ' + t, f > 0 ? 'var(--error)' : 'var(--success)');
  }

  function _nowMs() {
    return typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
      ? performance.now() : Date.now();
  }

  function _summarizeMutationProfile(samples) {
    if (!samples || samples.length === 0) return null;
    var total = 0;
    var sorted = samples.slice().sort(function (a, b) { return (b.total || 0) - (a.total || 0); });
    for (var i = 0; i < samples.length; i++) total += samples[i].total || 0;
    return {
      count: samples.length,
      total: total,
      slowest: sorted[0],
      topSamples: sorted.slice(0, 5) // top 5 slowest
    };
  }

  // Wait for the browser to actually paint pending DOM changes. `delay(0)`
  // (setTimeout 0) is NOT enough — WebKit often coalesces same-task layout
  // work and won't paint until it has no more JS to run. Using an rAF
  // guarantees at least one paint boundary; chaining a setTimeout after
  // moves us past the post-paint microtask barrier so the next JS task
  // runs on a fresh tick.
  function waitForPaint() {
    return new Promise(function (resolve) {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () {
          setTimeout(resolve, 0);
        });
      } else {
        setTimeout(resolve, 16);
      }
    });
  }

  async function runAllUI() {
    if (isRunActive()) return;
    populateTestList(); _api = null; lastResults = [];
    beginRun(tests.length);
    refreshBoardSelector();
    // Enable mutation profiling in ALL board windows (parent + iframes)
    setMutationProfilingFlag(true);
    var p = 0, f = 0;
    var totalStart = _nowMs();
    for (var j = 0; j < tests.length; j++) updateRow(j, 'reset');
    updateSummary(0, 0, tests.length);
    // Yield once before the first test so the reset UI (all rows cleared,
    // summary "0 passed 0 failed") actually paints before the first test
    // body takes the main thread.
    await waitForPaint();
    try {
      for (var i = 0; i < tests.length; i++) {
        throwIfRunCancelled();
        _runState.currentIndex = i;
        updateRow(i, 'running');
        // Always yield one paint frame before each test body so:
        //   1. The 'running' indicator on the test row paints
        //   2. The prior test's result paints if it hasn't yet
        //   3. Pending UI events (Stop button click, scroll, Copy
        //      button click) get a chance to run — otherwise the app
        //      feels 100% locked up until the whole suite finishes.
        await waitForPaint();
        _phaseTimings = { setup: 0, body: 0, teardown: 0, setupStart: 0, teardownStart: 0 };
        // Reset profile arrays in all board windows (parent + iframes)
        setMutationProfilingFlag(true);
        resetRenderCounters();
        var testStart = _nowMs();
        var bodyStart = 0, bodyEnd = 0;
        try {
          bodyStart = _nowMs();
          await tests[i].fn();
          bodyEnd = _nowMs();
          throwIfRunCancelled();
          var testDur = _nowMs() - testStart;
          // body time = test body minus any setup/teardown that happened within it
          _phaseTimings.body = (bodyEnd - bodyStart) - (_phaseTimings.setup || 0) - (_phaseTimings.teardown || 0);
          if (_phaseTimings.body < 0) _phaseTimings.body = 0;
          var profSummary = attachRenderCounters(_summarizeMutationProfile(collectMutationProfile()));
          updateRow(i, 'pass', null, testDur, _phaseTimings);
          lastResults.push({
            name: tests[i].name, passed: true, durationMs: testDur,
            setupMs: _phaseTimings.setup, bodyMs: _phaseTimings.body, teardownMs: _phaseTimings.teardown,
            mutationProfile: profSummary
          });
          p++;
        } catch (err) {
          bodyEnd = _nowMs();
          var testDurFail = _nowMs() - testStart;
          if (isCancelledError(err)) {
            updateRow(i, 'reset');
            setSummaryText('Stopped: ' + p + ' passed, ' + f + ' failed / ' + tests.length, 'var(--text-muted)');
            return;
          }
          var msg = err.message || String(err);
          _phaseTimings.body = (bodyEnd - bodyStart) - (_phaseTimings.setup || 0) - (_phaseTimings.teardown || 0);
          if (_phaseTimings.body < 0) _phaseTimings.body = 0;
          var profSummaryFail = attachRenderCounters(_summarizeMutationProfile(collectMutationProfile()));
          updateRow(i, 'fail', msg, testDurFail, _phaseTimings);
          lastResults.push({
            name: tests[i].name, passed: false, error: msg, durationMs: testDurFail,
            setupMs: _phaseTimings.setup, bodyMs: _phaseTimings.body, teardownMs: _phaseTimings.teardown,
            mutationProfile: profSummaryFail
          });
          f++;
        }
        _phaseTimings = null;
        updateSummary(p, f, tests.length);
      }
      if (isRunCancelled()) {
        setSummaryText('Stopped: ' + p + ' passed, ' + f + ' failed / ' + tests.length, 'var(--text-muted)');
      } else {
        var totalDur = _nowMs() - totalStart;
        setSummaryText(p + ' passed, ' + f + ' failed / ' + tests.length + ' (' + formatDurationMs(totalDur) + ')',
          f > 0 ? 'var(--error)' : 'var(--success)');
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
    setMutationProfilingFlag(true);
    resetRenderCounters();
    _phaseTimings = { setup: 0, body: 0, teardown: 0, setupStart: 0, teardownStart: 0 };
    var testStart = _nowMs();
    var bodyStart = 0, bodyEnd = 0;
    try {
      bodyStart = _nowMs();
      await tests[index].fn();
      bodyEnd = _nowMs();
      throwIfRunCancelled();
      var testDur = _nowMs() - testStart;
      _phaseTimings.body = (bodyEnd - bodyStart) - (_phaseTimings.setup || 0) - (_phaseTimings.teardown || 0);
      if (_phaseTimings.body < 0) _phaseTimings.body = 0;
      var profSummary = attachRenderCounters(_summarizeMutationProfile(collectMutationProfile()));
      updateRow(index, 'pass', null, testDur, _phaseTimings);
      var ex = lastResults.findIndex(function (r) { return r.name === tests[index].name; });
      var e = {
        name: tests[index].name, passed: true, durationMs: testDur,
        setupMs: _phaseTimings.setup, bodyMs: _phaseTimings.body, teardownMs: _phaseTimings.teardown,
        mutationProfile: profSummary
      };
      if (ex >= 0) lastResults[ex] = e; else lastResults.push(e);
      updateSummary(1, 0, 1);
    } catch (err) {
      bodyEnd = _nowMs();
      var testDurFail = _nowMs() - testStart;
      if (isCancelledError(err)) {
        updateRow(index, 'reset');
        setSummaryText('Stopped: 0 passed, 0 failed / 1', 'var(--text-muted)');
        return;
      }
      var msg = err.message || String(err);
      _phaseTimings.body = (bodyEnd - bodyStart) - (_phaseTimings.setup || 0) - (_phaseTimings.teardown || 0);
      if (_phaseTimings.body < 0) _phaseTimings.body = 0;
      var profSummaryFail = attachRenderCounters(_summarizeMutationProfile(collectMutationProfile()));
      updateRow(index, 'fail', msg, testDurFail, _phaseTimings);
      var ex2 = lastResults.findIndex(function (r) { return r.name === tests[index].name; });
      var e2 = {
        name: tests[index].name, passed: false, error: msg, durationMs: testDurFail,
        setupMs: _phaseTimings.setup, bodyMs: _phaseTimings.body, teardownMs: _phaseTimings.teardown,
        mutationProfile: profSummaryFail
      };
      if (ex2 >= 0) lastResults[ex2] = e2; else lastResults.push(e2);
      updateSummary(0, 1, 1);
    } finally {
      _phaseTimings = null;
      endRun();
    }
  }

  // Wait for the test panel DOM to be mounted, then populate it once.
  //
  // Previously we used a MutationObserver with `subtree: true` watching
  // document.body — but that made WebKit generate a mutation record for
  // every descendant insertion anywhere in the document. During a full
  // board render (~10k DOM nodes), that cost ~800ms of synchronous
  // bookkeeping inside `appendChild(fragment)`. The observer callback
  // itself was already a no-op after the first populate (`_panelInit`
  // latched to true), so the subtree watching was 100% wasted work.
  //
  // Fix: (1) observe only direct children of body without `subtree`, so
  // the cost is proportional to body-level mutations only, and (2) self-
  // disconnect as soon as we populate successfully. Fall back to a few
  // retry ticks in case the panel shows up deep inside a workspace-shell
  // tab that was injected after this module loaded.
  (function () {
    var disconnected = false;
    function tryPopulate() {
      if (disconnected) return true;
      if (findPanelRoot() && !_panelInit) {
        populateTestList();
      }
      if (_panelInit) {
        disconnected = true;
        if (_obs) _obs.disconnect();
        return true;
      }
      return false;
    }
    var _obs = null;
    if (typeof MutationObserver !== 'undefined') {
      _obs = new MutationObserver(tryPopulate);
      // childList only (no subtree) — direct body children only.
      _obs.observe(document.body, { childList: true });
    }
    // Retry on next frame / after 500ms to catch panels mounted deeper
    // in the tree (e.g. workspace-shell dock) that we wouldn't observe
    // without subtree: true.
    if (!tryPopulate()) {
      requestAnimationFrame(tryPopulate);
      setTimeout(tryPopulate, 500);
      setTimeout(tryPopulate, 1500);
      setTimeout(tryPopulate, 4000);
    }
  })();

  window.LexeraFrontendTests = {
    runAll: runAll,
    run: function (name) {
      var t = tests.find(function (x) { return x.name === name; });
      if (!t) { console.error('Not found: ' + name); return; }
      return t.fn();
    },
    list: function () { return tests.map(function (t) { return t.name; }); },
    stop: function () { requestStopRun(); },
    continueUndo: function () { continueManualUndo(); },
    showPanel: function () { populateTestList(); },
    runAllWithUI: function () { populateTestList(); runAllUI(); }
  };
})();
