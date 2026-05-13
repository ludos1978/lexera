var LexeraBoardSearch = (function () {
  'use strict';
  var _deps = {};
  var searchDebounce = null;

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  // ── dependency accessors ──

  function getSearchInput() {
    return _deps.$searchInput || null;
  }

  function getSearchMode() {
    return typeof _deps.getSearchMode === 'function' ? _deps.getSearchMode() : false;
  }

  function setSearchMode(v) {
    if (typeof _deps.setSearchMode === 'function') _deps.setSearchMode(v);
  }

  function getSearchResults() {
    return typeof _deps.getSearchResults === 'function' ? _deps.getSearchResults() : null;
  }

  function setSearchResults(v) {
    if (typeof _deps.setSearchResults === 'function') _deps.setSearchResults(v);
  }

  function getActiveBoardId() {
    return typeof _deps.getActiveBoardId === 'function' ? _deps.getActiveBoardId() : null;
  }

  function getActiveBoardData() {
    return typeof _deps.getActiveBoardData === 'function' ? _deps.getActiveBoardData() : null;
  }

  function isHeaderSearchExpanded() {
    return typeof _deps.isHeaderSearchExpanded === 'function' ? _deps.isHeaderSearchExpanded() : false;
  }

  function setHeaderSearchExpanded(v) {
    if (typeof _deps.setHeaderSearchExpanded === 'function') _deps.setHeaderSearchExpanded(v);
  }

  function updateHeaderSearchVisibility() {
    if (typeof _deps.updateHeaderSearchVisibility === 'function') _deps.updateHeaderSearchVisibility();
  }

  function renderMainView() {
    if (typeof _deps.renderMainView === 'function') _deps.renderMainView();
  }

  function selectBoard(id, opts) {
    return typeof _deps.selectBoard === 'function' ? _deps.selectBoard(id, opts) : Promise.resolve();
  }

  function loadBoard() {
    return typeof _deps.loadBoard === 'function' ? _deps.loadBoard() : Promise.resolve();
  }

  function resolveWikiDocument(name) {
    return typeof _deps.resolveWikiDocument === 'function' ? _deps.resolveWikiDocument(name) : { kind: 'unknown' };
  }

  function showNotification(msg) {
    if (typeof _deps.showNotification === 'function') _deps.showNotification(msg);
  }

  function lexeraLog(level, msg) {
    if (typeof _deps.lexeraLog === 'function') _deps.lexeraLog(level, msg);
  }

  function logFrontendIssue(level, area, msg, err) {
    if (typeof _deps.logFrontendIssue === 'function') _deps.logFrontendIssue(level, area, msg, err);
  }

  function escapeHtml(s) {
    return typeof _deps.escapeHtml === 'function' ? _deps.escapeHtml(s) : String(s);
  }

  function escapeAttr(s) {
    return typeof _deps.escapeAttr === 'function' ? _deps.escapeAttr(s) : String(s);
  }

  function focusCard(el) {
    if (typeof _deps.focusCard === 'function') _deps.focusCard(el);
  }

  function unfocusCard() {
    if (typeof _deps.unfocusCard === 'function') _deps.unfocusCard();
  }

  function focusBoardEntity(el) {
    if (typeof _deps.focusBoardEntity === 'function') _deps.focusBoardEntity(el);
  }

  function syncSidebarToView() {
    if (typeof _deps.syncSidebarToView === 'function') _deps.syncSidebarToView();
  }

  function saveFoldState() {
    if (typeof _deps.saveFoldState === 'function') _deps.saveFoldState();
  }

  function isWorkspaceShellEnabled() {
    return typeof _deps.isWorkspaceShellEnabled === 'function' ? _deps.isWorkspaceShellEnabled() : false;
  }

  function getWorkspaceShell() {
    return typeof _deps.getWorkspaceShell === 'function' ? _deps.getWorkspaceShell() : null;
  }

  function getDashboardTreeApi() {
    return typeof _deps.getDashboardTreeApi === 'function' ? _deps.getDashboardTreeApi() : null;
  }

  function getBoardNavigationApi() {
    return typeof _deps.getBoardNavigationApi === 'function' ? _deps.getBoardNavigationApi() : null;
  }

  function getLexeraApi() {
    return _deps.LexeraApi || null;
  }

  function openDashboardSearch(query, options) {
    if (typeof _deps.openDashboardSearch === 'function') {
      return _deps.openDashboardSearch(query, options);
    }
    return Promise.resolve(false);
  }

  // ── search functions ──

  function onSearchInput() {
    clearTimeout(searchDebounce);
    var input = getSearchInput();
    var q = input ? input.value.trim() : '';
    if (!q) {
      exitSearchMode();
      updateHeaderSearchVisibility();
      return;
    }
    if (!isHeaderSearchExpanded()) setHeaderSearchExpanded(true);
    searchDebounce = setTimeout(function () { performSearch(q); }, 300);
  }

  async function performSearch(query) {
    try {
      var api = getLexeraApi();
      var results = await api.search(query);
      setSearchResults(results);
      setSearchMode(true);
      updateHeaderSearchVisibility();
      renderSearchResults();
    } catch (err) {
      logFrontendIssue('warn', 'search.perform', 'Search failed for query "' + query + '"', err);
    }
  }

  function openWikiSearch(query) {
    var value = String(query || '').trim();
    if (!value) return Promise.resolve(false);
    return openDashboardSearch(value);
  }

  async function openWikiDocument(documentName, options) {
    options = options || {};
    var resolved = resolveWikiDocument(documentName);
    if (resolved.kind === 'tag') {
      openWikiSearch(resolved.document);
      return resolved;
    }
    if (resolved.kind !== 'board' || !resolved.boardId) {
      if (!options.silent) showNotification('Wiki link not found: ' + String(documentName || ''));
      return resolved;
    }
    try {
      await selectBoard(resolved.boardId, { duplicate: !!options.duplicate });
    } catch (err) {
      lexeraLog('error', '[wiki] Failed to open document: ' + resolved.document + ' ' + err);
      if (!options.silent) showNotification('Failed to open wiki link');
    }
    return resolved;
  }

  function exitSearchMode() {
    setSearchMode(false);
    setSearchResults(null);
    getElSearchResults().classList.add('hidden');
    updateHeaderSearchVisibility();
    renderMainView();
  }

  function parseOptionalSearchIndex(value) {
    return getDashboardTreeApi().parseOptionalSearchIndex(value);
  }

  function buildSearchResultLocation(item) {
    return getDashboardTreeApi().buildSearchResultLocation(item);
  }

  function buildHierarchyFocusTargetFromTreeNode(node, boardId) {
    return getBoardNavigationApi().buildHierarchyFocusTargetFromTreeNode(node, boardId, {
      parseOptionalSearchIndex: parseOptionalSearchIndex
    });
  }

  function findBoardEntityElement(target) {
    if (!target || !getElColumnsContainer()) return null;

    if (target.cardId) {
      var cardIdStr = escapeAttr(String(target.cardId));
      // Cards carry BOTH `data-card-id` (the Loro container id, shape
      // "crdt-N-…") AND `data-card-kid` (the persistent 8-char hex id
      // backend logs report as `state_kids`). Callers source the id
      // from different places — the workspace tree's data-tree-id is
      // populated from `card.kid || card.id` (commit b3f17185), so
      // a workspace-click target arrives as the kid form. The kanban
      // search-result target arrives as the Loro id. Try kid first
      // (workspace-click + most other callers), fall back to the
      // Loro id (legacy search-result path). Same id-OR-kid fallback
      // `findColumnRefByStablePath` uses for kanban-internal moves.
      //
      // User report 2026-05-13: "the card focus system STILL doesnt
      // focus the correct card!!!". Root cause: when the SAME card-kid
      // appears in multiple DOM positions on the same board (e.g. an
      // include file referenced from > 1 column, slide cards parsed
      // independently per column so each gets the same kid), the
      // board-wide `querySelector('.card[data-card-kid=X]')` returns
      // the FIRST match — which can be a different column's copy than
      // the one the user actually clicked in the workspace tree. The
      // workspace tree's click handler now harvests ancestor column /
      // stack / row ids and passes them in `target`. Here we scope the
      // card lookup into the matching ancestor's subtree when those
      // hints are present; fall back to the board-wide lookup when
      // they aren't (legacy search-result path, dashboard click, etc.).
      var scopeEl = null;
      if (target.columnId) {
        scopeEl = getElColumnsContainer().querySelector(
          '.column[data-column-id="' + escapeAttr(String(target.columnId)) + '"]'
        );
      }
      if (!scopeEl && target.stackId) {
        scopeEl = getElColumnsContainer().querySelector(
          '.board-stack[data-stack-id="' + escapeAttr(String(target.stackId)) + '"]'
        );
      }
      if (!scopeEl && target.rowId) {
        scopeEl = getElColumnsContainer().querySelector(
          '.board-row[data-row-id="' + escapeAttr(String(target.rowId)) + '"]'
        );
      }
      // Pick a search root that ACTUALLY exposes querySelector. The
      // ancestor scope might be a non-Element object (e.g. test mocks)
      // or null when the ancestor wasn't rendered yet; fall back to
      // the board's column container in either case.
      var searchRoot = (scopeEl && typeof scopeEl.querySelector === 'function')
        ? scopeEl
        : getElColumnsContainer();
      var byCardKid = searchRoot.querySelector('.card[data-card-kid="' + cardIdStr + '"]');
      if (byCardKid) return byCardKid;
      var byCardId = searchRoot.querySelector('.card[data-card-id="' + cardIdStr + '"]');
      if (byCardId) return byCardId;
      // Defensive fallback: if scoping found nothing (ancestor not yet
      // rendered, or DOM out of sync), try board-wide before giving up.
      if (scopeEl && searchRoot !== getElColumnsContainer()) {
        var byKidGlobal = getElColumnsContainer().querySelector('.card[data-card-kid="' + cardIdStr + '"]');
        if (byKidGlobal) return byKidGlobal;
        var byIdGlobal = getElColumnsContainer().querySelector('.card[data-card-id="' + cardIdStr + '"]');
        if (byIdGlobal) return byIdGlobal;
      }
    }

    if (typeof target.columnIndex === 'number' && typeof target.cardIndex === 'number') {
      var byVisibleCardIndex = getElColumnsContainer().querySelector(
        '.card[data-col-index="' + target.columnIndex + '"][data-card-index="' + target.cardIndex + '"]'
      );
      if (byVisibleCardIndex) return byVisibleCardIndex;
    }

    if (target.columnId) {
      var byColumnId = getElColumnsContainer().querySelector('.column[data-column-id="' + escapeAttr(String(target.columnId)) + '"]');
      if (byColumnId) return byColumnId;
    }

    if (typeof target.columnIndex === 'number') {
      var byVisibleColumnIndex = getElColumnsContainer().querySelector('.column-cards[data-col-index="' + target.columnIndex + '"]');
      var byVisibleColumn = byVisibleColumnIndex && typeof byVisibleColumnIndex.closest === 'function'
        ? byVisibleColumnIndex.closest('.column')
        : null;
      if (byVisibleColumn) return byVisibleColumn;
    }

    if (target.stackId) {
      var byStackId = getElColumnsContainer().querySelector('.board-stack[data-stack-id="' + escapeAttr(String(target.stackId)) + '"]');
      if (byStackId) return byStackId;
    }

    if (target.rowId) {
      var byRowId = getElColumnsContainer().querySelector('.board-row[data-row-id="' + escapeAttr(String(target.rowId)) + '"]');
      if (byRowId) return byRowId;
    }

    if (
      typeof target.rowIndex === 'number' &&
      typeof target.stackIndex === 'number' &&
      typeof target.colLocalIndex === 'number' &&
      typeof target.cardIndex === 'number'
    ) {
      var cardSelector =
        '.column[data-row-index="' + target.rowIndex + '"][data-stack-index="' + target.stackIndex + '"][data-col-local-index="' + target.colLocalIndex + '"] ' +
        '.card[data-card-index="' + target.cardIndex + '"]';
      var byPath = getElColumnsContainer().querySelector(cardSelector);
      if (byPath) return byPath;
    }

    if (
      typeof target.rowIndex === 'number' &&
      typeof target.stackIndex === 'number' &&
      typeof target.colLocalIndex === 'number'
    ) {
      var columnSelector = '.column[data-row-index="' + target.rowIndex + '"][data-stack-index="' + target.stackIndex + '"][data-col-local-index="' + target.colLocalIndex + '"]';
      var columnEl = getElColumnsContainer().querySelector(columnSelector);
      if (columnEl) return columnEl;
    }

    if (typeof target.rowIndex === 'number' && typeof target.stackIndex === 'number') {
      var stackSelector = '.board-stack[data-row-index="' + target.rowIndex + '"][data-stack-index="' + target.stackIndex + '"]';
      var stackEl = getElColumnsContainer().querySelector(stackSelector);
      if (stackEl) return stackEl;
    }

    if (typeof target.rowIndex === 'number') {
      return getElColumnsContainer().querySelector('.board-row[data-row-index="' + target.rowIndex + '"]');
    }

    return null;
  }

  function focusHierarchyTargetLocally(target) {
    var el = findBoardEntityElement(target);
    if (!el) return false;

    if (el.classList.contains('card')) {
      focusCard(el);
      return true;
    }

    unfocusCard();
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    focusBoardEntity(el);
    syncSidebarToView();
    return true;
  }

  function unfoldSearchTarget(result) {
    return getBoardNavigationApi().unfoldSearchTarget(result, {
      getActiveBoardId: function () { return getActiveBoardId(); },
      getColumnsContainer: getElColumnsContainer,
      saveFoldState: saveFoldState
    });
  }

  async function navigateToHierarchyTarget(target, options) {
    options = options || {};
    var ws = getWorkspaceShell();
    if (isWorkspaceShellEnabled() && ws && target && target.boardId) {
      ws.focusHierarchyTarget(target, target.boardId, options || {});
      return true;
    }
    return getBoardNavigationApi().navigateToHierarchyTarget(target, {
      selectBoard: selectBoard,
      getActiveBoardId: function () { return getActiveBoardId(); },
      getActiveBoardData: function () { return getActiveBoardData(); },
      loadBoard: loadBoard,
      unfoldSearchTarget: unfoldSearchTarget,
      focusHierarchyTargetLocally: focusHierarchyTargetLocally
    });
  }

  function focusSearchResultCard(result) {
    return getBoardNavigationApi().focusSearchResultCard(result, {
      getColumnsContainer: getElColumnsContainer,
      escapeAttr: escapeAttr,
      focusCard: focusCard
    });
  }

  async function navigateToSearchResult(result) {
    var ws = getWorkspaceShell();
    if (isWorkspaceShellEnabled() && ws && result && result.boardId) {
      var focusTarget = {
        boardId: result.boardId,
        rowId: result.rowId || null,
        stackId: result.stackId || null,
        columnId: result.columnId || null,
        cardId: result.cardId,
        columnIndex: parseOptionalSearchIndex(result.columnIndex),
        rowIndex: parseOptionalSearchIndex(result.rowIndex),
        stackIndex: parseOptionalSearchIndex(result.stackIndex),
        colLocalIndex: parseOptionalSearchIndex(result.colLocalIndex),
        cardIndex: parseOptionalSearchIndex(result.cardIndex),
        brokenSrc: result.brokenSrc || null
      };
      ws.focusHierarchyTarget(focusTarget, result.boardId, {});
      return true;
    }
    var input = getSearchInput();
    return getBoardNavigationApi().navigateToSearchResult(result, {
      searchInput: input,
      exitSearchMode: exitSearchMode,
      selectBoard: selectBoard,
      getActiveBoardId: function () { return getActiveBoardId(); },
      getActiveBoardData: function () { return getActiveBoardData(); },
      loadBoard: loadBoard,
      unfoldSearchTarget: unfoldSearchTarget,
      focusSearchResultCard: focusSearchResultCard,
      showNotification: showNotification,
      lexeraLog: lexeraLog
    });
  }

  function renderSearchResults() {
    getElBoardHeader().classList.add('hidden');
    getElColumnsContainer().classList.add('hidden');
    getElEmptyState().classList.add('hidden');
    getElSearchResults().classList.remove('hidden');

    var searchResults = getSearchResults();

    if (!searchResults || !searchResults.results.length) {
      getElSearchResults().innerHTML =
        '<div class="search-results-title">Search: "' + escapeHtml(searchResults ? searchResults.query : '') + '"</div>' +
        '<div class="empty-state" style="height:auto;padding:40px"><div>No results found</div></div>';
      return;
    }

    var groups = {};
    for (var i = 0; i < searchResults.results.length; i++) {
      var r = searchResults.results[i];
      var key = r.boardId;
      if (!groups[key]) groups[key] = { title: r.boardTitle, boardId: r.boardId, items: [] };
      groups[key].items.push(r);
    }

    var html = '<div class="search-results-title" role="status">Search: "' + escapeHtml(searchResults.query) + '" (' + searchResults.results.length + ' results)</div>';

    var keys = Object.keys(groups);
    var resultCursor = 0;
    for (var g = 0; g < keys.length; g++) {
      var group = groups[keys[g]];
      html += '<div class="search-group" role="group" aria-label="' + escapeAttr(group.title || 'Untitled') + '">';
      html += '<div class="search-group-title">' + escapeHtml(group.title || 'Untitled') + '</div>';

      for (var j = 0; j < group.items.length; j++) {
        var item = group.items[j];
        var resultIdx = resultCursor;
        resultCursor += 1;
        var location = buildSearchResultLocation(item);
        html += '<div class="search-result-item" data-result-index="' + resultIdx + '"' +
          ' data-board="' + escapeAttr(String(item.boardId || '')) + '"' +
          ' data-card-id="' + escapeAttr(String(item.cardId || '')) + '"' +
          ' data-column-index="' + escapeAttr(String(item.columnIndex)) + '"' +
          ' data-row-index="' + escapeAttr(String(item.rowIndex == null ? '' : item.rowIndex)) + '"' +
          ' data-stack-index="' + escapeAttr(String(item.stackIndex == null ? '' : item.stackIndex)) + '"' +
          '>';
        html += '<div class="search-result-column">' + escapeHtml(location) + '</div>';
        html += '<div class="search-result-content">' + escapeHtml(item.cardContent) + '</div>';
        html += '</div>';
      }
      html += '</div>';
    }

    getElSearchResults().innerHTML = html;

    var resultItems = getElSearchResults().querySelectorAll('.search-result-item');
    for (var k = 0; k < resultItems.length; k++) {
      resultItems[k].addEventListener('click', function () {
        var idx = parseOptionalSearchIndex(this.getAttribute('data-result-index'));
        var sr = getSearchResults();
        if (idx == null || !sr || !sr.results || idx < 0 || idx >= sr.results.length) {
          return;
        }
        var raw = sr.results[idx];
        var nav = {
          boardId: raw.boardId,
          cardId: raw.cardId,
          cardContent: raw.cardContent,
          columnIndex: parseOptionalSearchIndex(raw.columnIndex),
          rowIndex: parseOptionalSearchIndex(raw.rowIndex),
          stackIndex: parseOptionalSearchIndex(raw.stackIndex),
          columnTitle: raw.columnTitle
        };
        navigateToSearchResult(nav);
      });
    }
  }

  return {
    init: init,
    onSearchInput: onSearchInput,
    performSearch: performSearch,
    openWikiSearch: openWikiSearch,
    openWikiDocument: openWikiDocument,
    exitSearchMode: exitSearchMode,
    parseOptionalSearchIndex: parseOptionalSearchIndex,
    buildSearchResultLocation: buildSearchResultLocation,
    buildHierarchyFocusTargetFromTreeNode: buildHierarchyFocusTargetFromTreeNode,
    findBoardEntityElement: findBoardEntityElement,
    focusHierarchyTargetLocally: focusHierarchyTargetLocally,
    unfoldSearchTarget: unfoldSearchTarget,
    navigateToHierarchyTarget: navigateToHierarchyTarget,
    focusSearchResultCard: focusSearchResultCard,
    navigateToSearchResult: navigateToSearchResult,
    renderSearchResults: renderSearchResults
  };
})();
window.LexeraBoardSearch = LexeraBoardSearch;
