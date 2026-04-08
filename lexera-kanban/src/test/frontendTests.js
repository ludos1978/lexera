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

  function api() {
    if (_api) return _api;
    // Try current window first (standalone mode)
    if (window.LexeraTestApi) { _api = window.LexeraTestApi; return _api; }
    // Try parent window (workspace shell mode — panel is in parent, app.js is in iframe)
    try { if (window.parent && window.parent.LexeraTestApi) { _api = window.parent.LexeraTestApi; return _api; } } catch (_) {}
    // Try iframes (workspace shell mode — panel is in shell, app.js is in board iframe)
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try {
          if (iframes[i].contentWindow && iframes[i].contentWindow.LexeraTestApi) {
            _api = iframes[i].contentWindow.LexeraTestApi;
            return _api;
          }
        } catch (_) {}
      }
    } catch (_) {}
    throw new Error('LexeraTestApi not found');
  }

  function register(name, fn) { tests.push({ name: name, fn: fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function assertEqual(actual, expected, msg) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e) throw new Error((msg || 'assertEqual') + ': expected ' + e + ', got ' + a);
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }

  // ═══════════════════════════════════════════════════════════════════════
  // DOM query — resolve the document that contains the board
  // ═══════════════════════════════════════════════════════════════════════

  function getBoardDocument() {
    // Check current document
    var el = document.getElementById('columns-container') || document.querySelector('.columns-container');
    if (el) return document;
    // Check iframes (workspace shell)
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try {
          var doc = iframes[i].contentDocument;
          if (doc && (doc.getElementById('columns-container') || doc.querySelector('.columns-container'))) return doc;
        } catch (_) {}
      }
    } catch (_) {}
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

  async function setup() {
    // Wait for a board to be loaded (may take a moment in workspace shell)
    for (var attempt = 0; attempt < 10; attempt++) {
      try {
        _boardId = api().getActiveBoardId();
        var data = api().getFullBoardData();
        if (_boardId && data && data.rows && data.rows.length > 0) {
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
      await delay(150);
    }
    _snapshot = null;
    _boardId = null;
  }

  /** Find first two columns with at least 1 card each. Returns {srcCol, dstCol, srcCard}. */
  function findTwoColumnsWithCards() {
    var data = api().getFullBoardData();
    var flatIdx = 0;
    var srcCol = null, dstCol = null;
    for (var r = 0; r < data.rows.length; r++) {
      var stacks = data.rows[r].stacks || [];
      for (var s = 0; s < stacks.length; s++) {
        var cols = stacks[s].columns || [];
        for (var c = 0; c < cols.length; c++) {
          var visibleCards = (cols[c].cards || []).filter(function (card) {
            return !card.content || card.content.indexOf('#hidden-internal') === -1;
          });
          if (visibleCards.length > 0) {
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
      var lastStack = data.rows[0].stacks[data.rows[0].stacks.length - 1];
      lastStack.columns.push({ id: '__test-col__', title: 'Test Column', cards: [], include_source: null });
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

  function copyResults() {
    var lines = ['Frontend Test Results', ''];
    var p = 0, f = 0;
    for (var i = 0; i < lastResults.length; i++) {
      var r = lastResults[i];
      lines.push('[' + (r.passed ? 'PASS' : 'FAIL') + '] ' + r.name);
      if (!r.passed && r.error) lines.push('       ' + r.error);
      if (r.passed) p++; else f++;
    }
    lines.push(''); lines.push(p + ' passed, ' + f + ' failed / ' + lastResults.length);
    navigator.clipboard.writeText(lines.join('\n')).then(function () {
      var btn = findPanelRoot() && findPanelRoot().querySelector('.lexera-shared-test-copy');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = 'Copy'; }, 1200); }
    });
  }

  function populateTestList() {
    var root = findPanelRoot();
    if (!root || _panelInit) return;
    _panelInit = true;
    var listEl = root.querySelector('.lexera-shared-test-list'); if (!listEl) return;
    listEl.innerHTML = '';
    var summaryEl = root.querySelector('.lexera-shared-test-summary');
    if (summaryEl) summaryEl.textContent = tests.length + ' tests';

    for (var i = 0; i < tests.length; i++) {
      var row = document.createElement('div'); row.className = 'test-row';
      var ind = document.createElement('span'); ind.className = 'test-indicator';
      var lbl = document.createElement('span'); lbl.style.cssText = 'flex:1;word-break:break-word;';
      lbl.textContent = tests[i].name;
      (function (idx) { row.onclick = function () { runOneUI(idx); }; })(i);
      row.appendChild(ind); row.appendChild(lbl); listEl.appendChild(row);
      var err = document.createElement('div'); err.className = 'test-error'; err.style.display = 'none';
      listEl.appendChild(err);
    }
    var runBtn = root.querySelector('.lexera-shared-test-run-all');
    if (runBtn) runBtn.onclick = function () { runAllUI(); };
    var copyBtn = root.querySelector('.lexera-shared-test-copy');
    if (copyBtn) copyBtn.onclick = function () { copyResults(); };
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
    var root = findPanelRoot(); if (!root) return;
    var el = root.querySelector('.lexera-shared-test-summary'); if (!el) return;
    el.textContent = p + ' passed, ' + f + ' failed / ' + t;
    el.style.color = f > 0 ? 'var(--error)' : 'var(--success)';
  }

  async function runAllUI() {
    populateTestList(); _api = null; lastResults = [];
    var p = 0, f = 0;
    for (var j = 0; j < tests.length; j++) updateRow(j, 'reset');
    updateSummary(0, 0, tests.length);
    for (var i = 0; i < tests.length; i++) {
      updateRow(i, 'running');
      try {
        await tests[i].fn();
        updateRow(i, 'pass'); lastResults.push({ name: tests[i].name, passed: true }); p++;
      } catch (err) {
        var msg = err.message || String(err);
        updateRow(i, 'fail', msg); lastResults.push({ name: tests[i].name, passed: false, error: msg }); f++;
      }
      updateSummary(p, f, tests.length);
    }
  }

  async function runOneUI(index) {
    if (index < 0 || index >= tests.length) return;
    _api = null; updateRow(index, 'running');
    try {
      await tests[index].fn(); updateRow(index, 'pass');
      var ex = lastResults.findIndex(function (r) { return r.name === tests[index].name; });
      var e = { name: tests[index].name, passed: true };
      if (ex >= 0) lastResults[ex] = e; else lastResults.push(e);
    } catch (err) {
      var msg = err.message || String(err); updateRow(index, 'fail', msg);
      var ex2 = lastResults.findIndex(function (r) { return r.name === tests[index].name; });
      var e2 = { name: tests[index].name, passed: false, error: msg };
      if (ex2 >= 0) lastResults[ex2] = e2; else lastResults.push(e2);
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
    showPanel: function () { populateTestList(); },
    runAllWithUI: function () { populateTestList(); runAllUI(); }
  };
})();
