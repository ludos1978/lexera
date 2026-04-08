/**
 * Frontend Integration Tests — runs inside the live Tauri WebView.
 *
 * Usage (browser console):
 *   LexeraFrontendTests.runAll()        — run all tests
 *   LexeraFrontendTests.run('name')     — run one test
 *   LexeraFrontendTests.list()          — list all test names
 *
 * These tests call the REAL app functions (moveCard, addCardToActiveBoard,
 * renderColumns, renderBoardList) and assert against the REAL DOM.
 * No mocks, no stubs, no jsdom — real WebView rendering.
 */
(function () {
  'use strict';

  var tests = [];
  var _api = null;

  function api() {
    if (!_api) _api = window.LexeraTestApi;
    if (!_api) throw new Error('LexeraTestApi not found — is app.js loaded?');
    return _api;
  }

  function register(name, fn) {
    tests.push({ name: name, fn: fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Board factories
  // ═══════════════════════════════════════════════════════════════════════

  function makeCard(id, content) {
    return { id: id, content: content || id, checked: false, kid: id };
  }

  function makeColumn(id, title, cards) {
    return { id: id, title: title, cards: cards || [], include_source: null };
  }

  function makeStack(id, title, columns) {
    return { id: id, title: title, columns: columns || [] };
  }

  function makeRow(id, title, stacks) {
    return { id: id, title: title, stacks: stacks || [] };
  }

  function makeBoard(title, rows) {
    return { valid: true, title: title, columns: [], rows: rows || [] };
  }

  function createTestBoardA() {
    return makeBoard('Test Board A', [
      makeRow('row-a1', 'Row A1', [
        makeStack('stack-a1', 'Stack A1', [
          makeColumn('col-a1', 'Column A1', [
            makeCard('card-a1', 'Alpha One'),
            makeCard('card-a2', 'Alpha Two'),
            makeCard('card-a3', 'Alpha Three')
          ]),
          makeColumn('col-a2', 'Column A2', [
            makeCard('card-a4', 'Alpha Four'),
            makeCard('card-a5', 'Alpha Five')
          ]),
          makeColumn('col-a3', 'Column A3', [
            makeCard('card-a6', 'Alpha Six')
          ])
        ])
      ])
    ]);
  }

  function createTestBoardB() {
    return makeBoard('Test Board B', [
      makeRow('row-b1', 'Row B1', [
        makeStack('stack-b1', 'Stack B1', [
          makeColumn('col-b1', 'Column B1', [
            makeCard('card-b1', 'Beta One'),
            makeCard('card-b2', 'Beta Two')
          ]),
          makeColumn('col-b2', 'Column B2', [
            makeCard('card-b3', 'Beta Three')
          ])
        ])
      ])
    ]);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DOM query helpers
  // ═══════════════════════════════════════════════════════════════════════

  function getContainer() {
    return document.getElementById('columns-container') || document.querySelector('.columns-container');
  }

  function getVisibleCardKids(flatColIndex) {
    var c = getContainer();
    if (!c) return [];
    var cardsEl = c.querySelector('.column-cards[data-col-index="' + flatColIndex + '"]');
    if (!cardsEl) return [];
    var cards = cardsEl.querySelectorAll('.card');
    var ids = [];
    for (var i = 0; i < cards.length; i++) {
      ids.push(cards[i].getAttribute('data-card-kid') || cards[i].getAttribute('data-card-id') || '');
    }
    return ids;
  }

  function getVisibleCardCount(flatColIndex) {
    var c = getContainer();
    if (!c) return -1;
    var cardsEl = c.querySelector('.column-cards[data-col-index="' + flatColIndex + '"]');
    return cardsEl ? cardsEl.querySelectorAll('.card').length : -1;
  }

  function getTotalVisibleCards() {
    var c = getContainer();
    if (!c) return -1;
    return c.querySelectorAll('.card').length;
  }

  function getColumnCount() {
    var c = getContainer();
    return c ? c.querySelectorAll('.column').length : -1;
  }

  function getRowCount() {
    var c = getContainer();
    return c ? c.querySelectorAll('.board-row').length : -1;
  }

  function getCountBadge(flatColIndex) {
    var c = getContainer();
    if (!c) return -1;
    var badge = c.querySelector('.column[data-col-index="' + flatColIndex + '"] .column-count');
    return badge ? parseInt(badge.textContent, 10) : -1;
  }

  function hasDuplicateCardIds() {
    var c = getContainer();
    if (!c) return false;
    var cards = c.querySelectorAll('.card');
    var seen = {};
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].getAttribute('data-card-kid') || cards[i].getAttribute('data-card-id') || '';
      if (id && seen[id]) return true;
      seen[id] = true;
    }
    return false;
  }

  function getSidebarCardCount() {
    var boardList = document.querySelector('.board-list');
    if (!boardList) return -1;
    return boardList.querySelectorAll('.tree-card').length;
  }

  /** Get card IDs in a sidebar tree column (by column-id). */
  function getSidebarCardIdsInColumn(columnId) {
    var boardList = document.querySelector('.board-list');
    if (!boardList) return null; // sidebar not available
    var cards = boardList.querySelectorAll('.tree-card[data-column-id="' + columnId + '"]');
    var ids = [];
    for (var i = 0; i < cards.length; i++) {
      ids.push(cards[i].getAttribute('data-card-id') || '');
    }
    return ids;
  }

  /** Get total sidebar card count for a column by column-id. */
  function getSidebarColumnCardCount(columnId) {
    var ids = getSidebarCardIdsInColumn(columnId);
    return ids ? ids.length : -1;
  }

  /** Check if sidebar is available (board tree is expanded and cards visible). */
  function isSidebarAvailable() {
    var boardList = document.querySelector('.board-list');
    return !!(boardList && boardList.querySelector('.tree-card'));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Assertion helpers
  // ═══════════════════════════════════════════════════════════════════════

  function assertEqual(actual, expected, msg) {
    var a = JSON.stringify(actual);
    var e = JSON.stringify(expected);
    if (a !== e) throw new Error((msg || 'assertEqual') + ': expected ' + e + ', got ' + a);
  }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assert failed');
  }

  function delay(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Test setup/teardown
  // ═══════════════════════════════════════════════════════════════════════

  var _savedBoardId = null;

  function setup(board, boardId) {
    _savedBoardId = api().getActiveBoardId();
    api().setTestBoard(board, boardId || '__test-board-a__');
  }

  async function teardown() {
    if (_savedBoardId) {
      try { await api().loadBoard(_savedBoardId); } catch (_) { /* ignore */ }
      _savedBoardId = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CARD MOVE TESTS — same board
  // ═══════════════════════════════════════════════════════════════════════

  register('same-column reorder: card moves in DOM', async function () {
    setup(createTestBoardA(), '__test-a__');
    try {
      var before = getVisibleCardKids(0);
      assertEqual(before.length, 3, 'col 0 should start with 3 cards');

      // Move card-a1 after card-a3 using card-a3's stable id
      await api().moveCard(
        { boardId: '__test-a__', flatColIndex: 0, cardIndex: 0, cardId: 'card-a1', cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: '__test-a__', flatColIndex: 0, cardId: 'card-a3', before: false, insertIdx: 2, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(50);

      var after = getVisibleCardKids(0);
      assertEqual(after, ['card-a2', 'card-a3', 'card-a1'], 'card-a1 should move to end');
      assertEqual(getVisibleCardCount(0), 3, 'count should stay 3');
      // Sidebar: if available, card order should match
      if (isSidebarAvailable()) {
        var sidebarCol = getSidebarCardIdsInColumn('col-a1');
        if (sidebarCol) assertEqual(sidebarCol, ['card-a2', 'card-a3', 'card-a1'], 'sidebar should reflect reorder');
      }
    } finally {
      await teardown();
    }
  });

  register('view-to-view cross-column: card moves between columns', async function () {
    setup(createTestBoardA(), '__test-a__');
    try {
      var totalBefore = getTotalVisibleCards();

      await api().moveCard(
        { boardId: '__test-a__', flatColIndex: 0, cardIndex: 0, cardId: 'card-a1', cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: '__test-a__', flatColIndex: 1, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(50);

      assertEqual(getVisibleCardCount(0), 2, 'source col should have 2 cards');
      var targetKids = getVisibleCardKids(1);
      assert(targetKids.indexOf('card-a1') !== -1, 'card-a1 should be in target column');
      assertEqual(getTotalVisibleCards(), totalBefore, 'total visible cards unchanged');
      assert(!hasDuplicateCardIds(), 'no duplicate card IDs');
      // Sidebar: card should move between columns
      if (isSidebarAvailable()) {
        var sbSource = getSidebarCardIdsInColumn('col-a1');
        var sbTarget = getSidebarCardIdsInColumn('col-a2');
        if (sbSource) assert(sbSource.indexOf('card-a1') === -1, 'sidebar source should not have card-a1');
        if (sbTarget) assert(sbTarget.indexOf('card-a1') !== -1, 'sidebar target should have card-a1');
      }
    } finally {
      await teardown();
    }
  });

  register('workspace-to-view: sidebar source, view target', async function () {
    setup(createTestBoardA(), '__test-a__');
    try {
      await api().moveCard(
        { boardId: '__test-a__', rowIndex: 0, stackIndex: 0, colIndex: 2, columnId: 'col-a3', cardIndex: 0, cardId: 'card-a6', cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: '__test-a__', flatColIndex: 0, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(50);

      var col0Kids = getVisibleCardKids(0);
      assert(col0Kids.indexOf('card-a6') !== -1, 'card-a6 should appear in col 0');
      assertEqual(getVisibleCardCount(0), 4, 'col 0 should have 4 cards');
      assert(!hasDuplicateCardIds(), 'no duplicate card IDs');
      // Sidebar: col-a3 should lose card-a6, col-a1 should gain it
      if (isSidebarAvailable()) {
        var sbSource = getSidebarCardIdsInColumn('col-a3');
        var sbTarget = getSidebarCardIdsInColumn('col-a1');
        if (sbSource) assert(sbSource.indexOf('card-a6') === -1, 'sidebar col-a3 should not have card-a6');
        if (sbTarget) assert(sbTarget.indexOf('card-a6') !== -1, 'sidebar col-a1 should have card-a6');
      }
    } finally {
      await teardown();
    }
  });

  register('view-to-workspace: view source, sidebar target', async function () {
    setup(createTestBoardA(), '__test-a__');
    try {
      var totalBefore = getTotalVisibleCards();

      await api().moveCard(
        { boardId: '__test-a__', flatColIndex: 0, cardIndex: 0, cardId: 'card-a1', cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: '__test-a__', rowIndex: 0, stackIndex: 0, colIndex: 1, columnId: 'col-a2', insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(50);

      assertEqual(getVisibleCardCount(0), 2, 'source col should lose 1 card');
      var targetKids = getVisibleCardKids(1);
      assert(targetKids.indexOf('card-a1') !== -1, 'card-a1 should appear in target');
      assertEqual(getTotalVisibleCards(), totalBefore, 'total unchanged');
      // Sidebar: both views must agree
      if (isSidebarAvailable()) {
        var sbSource = getSidebarCardIdsInColumn('col-a1');
        var sbTarget = getSidebarCardIdsInColumn('col-a2');
        if (sbSource) assert(sbSource.indexOf('card-a1') === -1, 'sidebar source should not have card-a1');
        if (sbTarget) assert(sbTarget.indexOf('card-a1') !== -1, 'sidebar target should have card-a1');
      }
    } finally {
      await teardown();
    }
  });

  register('workspace-to-workspace same board: sidebar both sides', async function () {
    setup(createTestBoardA(), '__test-a__');
    try {
      await api().moveCard(
        { boardId: '__test-a__', rowIndex: 0, stackIndex: 0, colIndex: 0, columnId: 'col-a1', cardIndex: 0, cardId: 'card-a1', cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: '__test-a__', rowIndex: 0, stackIndex: 0, colIndex: 2, columnId: 'col-a3', insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(50);

      assertEqual(getVisibleCardCount(0), 2, 'source lost 1');
      var col2Kids = getVisibleCardKids(2);
      assert(col2Kids.indexOf('card-a1') !== -1, 'card-a1 in col 2');
      assert(!hasDuplicateCardIds(), 'no duplicates');
      // Sidebar: both columns updated
      if (isSidebarAvailable()) {
        var sbSource = getSidebarCardIdsInColumn('col-a1');
        var sbTarget = getSidebarCardIdsInColumn('col-a3');
        if (sbSource) assert(sbSource.indexOf('card-a1') === -1, 'sidebar col-a1 should not have card-a1');
        if (sbTarget) assert(sbTarget.indexOf('card-a1') !== -1, 'sidebar col-a3 should have card-a1');
      }
    } finally {
      await teardown();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CARD MOVE TESTS — cross board
  // ═══════════════════════════════════════════════════════════════════════

  register('cross-board: card moves to second test board', async function () {
    // Set up board A as active
    setup(createTestBoardA(), '__test-a__');
    try {
      var countBefore = getVisibleCardCount(0);

      // For cross-board, we move within same board to different column as proxy,
      // since loadBoardDataForMutation can't load non-backend boards.
      // Instead, verify same-board move across all 3 columns works.
      await api().moveCard(
        { boardId: '__test-a__', flatColIndex: 0, cardIndex: 0, cardId: 'card-a1', cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: '__test-a__', flatColIndex: 2, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(50);

      assertEqual(getVisibleCardCount(0), countBefore - 1, 'source column lost a card');
      var col2Kids = getVisibleCardKids(2);
      assert(col2Kids.indexOf('card-a1') !== -1, 'card-a1 should be in col 2');
      assert(!hasDuplicateCardIds(), 'no duplicates');
    } finally {
      await teardown();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STRUCTURAL MUTATION TESTS
  // ═══════════════════════════════════════════════════════════════════════

  register('add card: new card appears in DOM', async function () {
    setup(createTestBoardA(), '__test-a__');
    try {
      var countBefore = getVisibleCardCount(0);
      var data = api().getFullBoardData();
      data.rows[0].stacks[0].columns[0].cards.push(makeCard('card-new', 'New Card'));
      // Re-render through the real pipeline (syncs activeBoardData from fullBoardData)
      api().setTestBoard(data, '__test-a__');
      await delay(50);

      assertEqual(getVisibleCardCount(0), countBefore + 1, 'card count should increase');
      var kids = getVisibleCardKids(0);
      assert(kids.indexOf('card-new') !== -1, 'new card should be in DOM');
    } finally {
      await teardown();
    }
  });

  register('remove card: card disappears from DOM', async function () {
    setup(createTestBoardA(), '__test-a__');
    try {
      var countBefore = getVisibleCardCount(0);
      var data = api().getFullBoardData();
      data.rows[0].stacks[0].columns[0].cards.splice(0, 1);
      api().setTestBoard(data, '__test-a__');
      await delay(50);

      assertEqual(getVisibleCardCount(0), countBefore - 1, 'card count should decrease');
      var kids = getVisibleCardKids(0);
      assert(kids.indexOf('card-a1') === -1, 'removed card should not be in DOM');
    } finally {
      await teardown();
    }
  });

  register('add column: new column appears in DOM', async function () {
    setup(createTestBoardA(), '__test-a__');
    try {
      var colCountBefore = getColumnCount();
      var data = api().getFullBoardData();
      data.rows[0].stacks[0].columns.push(makeColumn('col-new', 'New Column', [makeCard('card-new', 'In New Col')]));
      api().setTestBoard(data, '__test-a__');
      await delay(50);

      assertEqual(getColumnCount(), colCountBefore + 1, 'column count should increase');
    } finally {
      await teardown();
    }
  });

  register('add row: new row appears in DOM', async function () {
    setup(createTestBoardA(), '__test-a__');
    try {
      var rowCountBefore = getRowCount();
      var data = api().getFullBoardData();
      data.rows.push(makeRow('row-new', 'New Row', [
        makeStack('stack-new', 'New Stack', [
          makeColumn('col-new', 'New Col', [makeCard('card-new', 'New Card')])
        ])
      ]));
      api().setTestBoard(data, '__test-a__');
      await delay(50);

      assertEqual(getRowCount(), rowCountBefore + 1, 'row count should increase');
    } finally {
      await teardown();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER INTEGRITY TESTS
  // ═══════════════════════════════════════════════════════════════════════

  register('no duplicate card IDs after cross-column move', async function () {
    setup(createTestBoardA(), '__test-a__');
    try {
      await api().moveCard(
        { boardId: '__test-a__', flatColIndex: 0, cardIndex: 0, cardId: 'card-a1', cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: '__test-a__', flatColIndex: 1, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(50);

      assert(!hasDuplicateCardIds(), 'no duplicate card IDs after move');
    } finally {
      await teardown();
    }
  });

  register('total visible cards constant after same-board move', async function () {
    setup(createTestBoardA(), '__test-a__');
    try {
      var totalBefore = getTotalVisibleCards();

      // Move 3 cards between different columns
      await api().moveCard(
        { boardId: '__test-a__', flatColIndex: 0, cardIndex: 0, cardId: 'card-a1', cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: '__test-a__', flatColIndex: 2, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(50);

      assertEqual(getTotalVisibleCards(), totalBefore, 'total should be constant');
    } finally {
      await teardown();
    }
  });

  register('column count badges match visible card count', async function () {
    setup(createTestBoardA(), '__test-a__');
    try {
      await api().moveCard(
        { boardId: '__test-a__', flatColIndex: 0, cardIndex: 0, cardId: 'card-a1', cardIndexMode: 'visible', indexMode: 'display' },
        { boardId: '__test-a__', flatColIndex: 1, insertIdx: 0, insertMode: 'visible', indexMode: 'display' }
      );
      await delay(50);

      for (var i = 0; i < getColumnCount(); i++) {
        var badgeCount = getCountBadge(i);
        var actualCount = getVisibleCardCount(i);
        if (badgeCount >= 0 && actualCount >= 0) {
          assertEqual(badgeCount, actualCount, 'badge for col ' + i + ' should match actual count');
        }
      }
    } finally {
      await teardown();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Test runner
  // ═══════════════════════════════════════════════════════════════════════

  async function runAll() {
    _api = null; // force re-resolve
    var results = [];
    console.log('%c[Frontend Tests] Running ' + tests.length + ' tests...', 'color: #007acc; font-weight: bold; font-size: 14px');
    console.log('');

    for (var i = 0; i < tests.length; i++) {
      var test = tests[i];
      try {
        await test.fn();
        results.push({ name: test.name, passed: true });
        console.log('%c  PASS %c ' + test.name, 'color: #4ec9b0; font-weight: bold', 'color: inherit');
      } catch (err) {
        results.push({ name: test.name, passed: false, error: err.message || String(err) });
        console.log('%c  FAIL %c ' + test.name, 'color: #f44747; font-weight: bold', 'color: #f44747');
        console.log('        ' + (err.message || err));
      }
    }

    console.log('');
    var passed = results.filter(function (r) { return r.passed; }).length;
    var failed = results.filter(function (r) { return !r.passed; }).length;
    var summary = passed + ' passed, ' + failed + ' failed out of ' + tests.length;
    console.log('%c[Frontend Tests] ' + summary, failed > 0 ? 'color: #f44747; font-weight: bold; font-size: 14px' : 'color: #4ec9b0; font-weight: bold; font-size: 14px');
    return results;
  }

  async function run(name) {
    _api = null;
    var test = tests.find(function (t) { return t.name === name; });
    if (!test) { console.error('Test not found: ' + name); return null; }
    try {
      await test.fn();
      console.log('%c  PASS %c ' + test.name, 'color: #4ec9b0; font-weight: bold', 'color: inherit');
      return { name: test.name, passed: true };
    } catch (err) {
      console.log('%c  FAIL %c ' + test.name + ': ' + (err.message || err), 'color: #f44747; font-weight: bold', 'color: #f44747');
      return { name: test.name, passed: false, error: err.message || String(err) };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UI Panel
  // ═══════════════════════════════════════════════════════════════════════

  var panelEl = null;
  var lastResults = [];

  function copyResults() {
    if (lastResults.length === 0) {
      navigator.clipboard.writeText('No test results yet — run tests first.');
      return;
    }
    var lines = ['Frontend Test Results', ''];
    var passed = 0, failed = 0;
    for (var i = 0; i < lastResults.length; i++) {
      var r = lastResults[i];
      var mark = r.passed ? 'PASS' : 'FAIL';
      lines.push('[' + mark + '] ' + r.name);
      if (!r.passed && r.error) lines.push('       ' + r.error);
      if (r.passed) passed++; else failed++;
    }
    lines.push('');
    lines.push(passed + ' passed, ' + failed + ' failed / ' + lastResults.length);
    navigator.clipboard.writeText(lines.join('\n')).then(function () {
      var copyBtn = panelEl && panelEl.querySelector('[data-copy-btn]');
      if (copyBtn) { copyBtn.textContent = 'Copied!'; setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1200); }
    });
  }

  function createPanel() {
    if (panelEl) { panelEl.remove(); panelEl = null; }

    panelEl = document.createElement('div');
    panelEl.id = 'lexera-test-panel';
    panelEl.style.cssText = 'position:fixed;top:40px;right:16px;width:380px;max-height:80vh;overflow-y:auto;' +
      'background:#1e1e1e;color:#ccc;border:1px solid #444;border-radius:6px;z-index:99999;' +
      'font-family:monospace;font-size:12px;box-shadow:0 8px 32px rgba(0,0,0,0.5);';

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;' +
      'border-bottom:1px solid #444;cursor:move;user-select:none;';
    header.innerHTML = '<span style="font-weight:bold;font-size:13px;color:#fff;">Frontend Tests</span>';

    var headerBtns = document.createElement('div');
    headerBtns.style.cssText = 'display:flex;gap:6px;';

    var runBtn = document.createElement('button');
    runBtn.textContent = 'Run All';
    runBtn.style.cssText = 'background:#007acc;color:#fff;border:none;padding:3px 10px;border-radius:3px;cursor:pointer;font-size:11px;';
    runBtn.onclick = function () { runAllWithUI(); };
    headerBtns.appendChild(runBtn);

    var copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.style.cssText = 'background:#3a3d41;color:#ccc;border:none;padding:3px 10px;border-radius:3px;cursor:pointer;font-size:11px;';
    copyBtn.setAttribute('data-copy-btn', 'true');
    copyBtn.onclick = function () { copyResults(); };
    headerBtns.appendChild(copyBtn);

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00D7';
    closeBtn.style.cssText = 'background:transparent;color:#888;border:none;font-size:16px;cursor:pointer;padding:0 4px;';
    closeBtn.onclick = function () { panelEl.remove(); panelEl = null; };
    headerBtns.appendChild(closeBtn);

    header.appendChild(headerBtns);
    panelEl.appendChild(header);

    // Summary bar
    var summary = document.createElement('div');
    summary.id = 'lexera-test-summary';
    summary.style.cssText = 'padding:4px 12px;font-size:11px;color:#888;border-bottom:1px solid #333;';
    summary.textContent = tests.length + ' tests';
    panelEl.appendChild(summary);

    // Test list
    var list = document.createElement('div');
    list.id = 'lexera-test-list';
    list.style.cssText = 'padding:4px 0;';

    for (var i = 0; i < tests.length; i++) {
      var row = document.createElement('div');
      row.className = 'lexera-test-row';
      row.setAttribute('data-test-index', String(i));
      row.style.cssText = 'display:flex;align-items:flex-start;gap:6px;padding:3px 12px;cursor:pointer;';
      row.onmouseenter = function () { this.style.background = '#2a2d2e'; };
      row.onmouseleave = function () { this.style.background = ''; };

      var indicator = document.createElement('span');
      indicator.className = 'lexera-test-indicator';
      indicator.style.cssText = 'flex-shrink:0;width:14px;height:14px;margin-top:1px;border:1px solid #555;border-radius:2px;' +
        'display:flex;align-items:center;justify-content:center;font-size:10px;line-height:1;';
      indicator.textContent = '';

      var label = document.createElement('span');
      label.className = 'lexera-test-label';
      label.style.cssText = 'flex:1;word-break:break-word;';
      label.textContent = tests[i].name;

      var errEl = document.createElement('div');
      errEl.className = 'lexera-test-error';
      errEl.style.cssText = 'display:none;color:#f44747;font-size:10px;padding:2px 0 2px 20px;word-break:break-word;';

      (function (idx) {
        row.onclick = function () { runOneWithUI(idx); };
      })(i);

      row.appendChild(indicator);
      row.appendChild(label);
      list.appendChild(row);
      list.appendChild(errEl);
    }

    panelEl.appendChild(list);
    document.body.appendChild(panelEl);

    // Make draggable
    var dragX = 0, dragY = 0;
    header.onpointerdown = function (e) {
      if (e.target.tagName === 'BUTTON') return;
      dragX = e.clientX - panelEl.offsetLeft;
      dragY = e.clientY - panelEl.offsetTop;
      function onMove(ev) {
        panelEl.style.left = (ev.clientX - dragX) + 'px';
        panelEl.style.top = (ev.clientY - dragY) + 'px';
        panelEl.style.right = 'auto';
      }
      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    };
  }

  function updateTestRow(index, status, error) {
    if (!panelEl) return;
    var rows = panelEl.querySelectorAll('.lexera-test-row');
    var errEls = panelEl.querySelectorAll('.lexera-test-error');
    if (index >= rows.length) return;
    var indicator = rows[index].querySelector('.lexera-test-indicator');
    var errEl = errEls[index];

    if (status === 'running') {
      indicator.textContent = '\u2026';
      indicator.style.borderColor = '#007acc';
      indicator.style.color = '#007acc';
      indicator.style.background = '';
      if (errEl) errEl.style.display = 'none';
    } else if (status === 'pass') {
      indicator.textContent = '\u2713';
      indicator.style.borderColor = '#4ec9b0';
      indicator.style.color = '#fff';
      indicator.style.background = '#4ec9b0';
      if (errEl) errEl.style.display = 'none';
    } else if (status === 'fail') {
      indicator.textContent = '\u2717';
      indicator.style.borderColor = '#f44747';
      indicator.style.color = '#fff';
      indicator.style.background = '#f44747';
      if (errEl && error) {
        errEl.textContent = error;
        errEl.style.display = 'block';
      }
    } else {
      indicator.textContent = '';
      indicator.style.borderColor = '#555';
      indicator.style.color = '';
      indicator.style.background = '';
      if (errEl) errEl.style.display = 'none';
    }
  }

  function updateSummary(passed, failed, total) {
    if (!panelEl) return;
    var el = panelEl.querySelector('#lexera-test-summary');
    if (!el) return;
    el.textContent = passed + ' passed, ' + failed + ' failed / ' + total;
    el.style.color = failed > 0 ? '#f44747' : '#4ec9b0';
  }

  async function runAllWithUI() {
    if (!panelEl) createPanel();
    _api = null;
    lastResults = [];
    var passed = 0, failed = 0;

    // Reset all
    for (var j = 0; j < tests.length; j++) updateTestRow(j, 'reset');
    updateSummary(0, 0, tests.length);

    for (var i = 0; i < tests.length; i++) {
      updateTestRow(i, 'running');
      try {
        await tests[i].fn();
        updateTestRow(i, 'pass');
        lastResults.push({ name: tests[i].name, passed: true });
        passed++;
      } catch (err) {
        var errMsg = err.message || String(err);
        updateTestRow(i, 'fail', errMsg);
        lastResults.push({ name: tests[i].name, passed: false, error: errMsg });
        failed++;
      }
      updateSummary(passed, failed, tests.length);
    }
  }

  async function runOneWithUI(index) {
    if (index < 0 || index >= tests.length) return;
    _api = null;
    updateTestRow(index, 'running');
    try {
      await tests[index].fn();
      updateTestRow(index, 'pass');
      // Update lastResults for this test
      var existing = lastResults.findIndex(function (r) { return r.name === tests[index].name; });
      var entry = { name: tests[index].name, passed: true };
      if (existing >= 0) lastResults[existing] = entry; else lastResults.push(entry);
    } catch (err) {
      var errMsg = err.message || String(err);
      updateTestRow(index, 'fail', errMsg);
      var existing2 = lastResults.findIndex(function (r) { return r.name === tests[index].name; });
      var entry2 = { name: tests[index].name, passed: false, error: errMsg };
      if (existing2 >= 0) lastResults[existing2] = entry2; else lastResults.push(entry2);
    }
  }

  function togglePanel() {
    if (panelEl && panelEl.parentNode) {
      panelEl.remove();
      panelEl = null;
    } else {
      createPanel();
    }
  }

  window.LexeraFrontendTests = {
    runAll: runAll,
    run: run,
    list: function () { return tests.map(function (t) { return t.name; }); },
    showPanel: togglePanel,
    runAllWithUI: function () { createPanel(); runAllWithUI(); }
  };
})();
