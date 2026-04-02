/**
 * Column Context Menu & Operations — column context menu, rename, include mode,
 * column CRUD (add/duplicate/move/delete), card sorting, reveal/collapse,
 * numeric tag extraction, and related utilities.
 *
 * Dependencies injected via init().
 */
var LexeraColumnContextMenu = (function () {
  'use strict';

  // -- Injected dependencies --
  var deps = {};

  // ── Column context menu state ──────────────────────────────────────

  var activeColMenu = null;

  function getActiveColMenu() {
    return activeColMenu;
  }

  function closeColumnContextMenu() {
    if (activeColMenu) { activeColMenu.remove(); activeColMenu = null; }
  }

  function showColumnContextMenu(x, y, colIndex, context) {
    var ctx = { colIndex: colIndex };
    if (context) { ctx.rowIdx = context.rowIdx; ctx.stackIdx = context.stackIdx; ctx.colLocalIdx = context.colLocalIdx; }
    deps.showElementContextMenu('column', x, y, ctx);
  }

  // ── Include mode operations ────────────────────────────────────────

  async function setColumnIncludePath(colIndex, nextPath) {
    var col = deps.getFullColumn(colIndex);
    if (!col || !deps.getFullBoardData() || !deps.getActiveBoardId()) return false;
    var cleanPath = String(nextPath || '').trim();
    if (!cleanPath) return false;
    var nextTitle = deps.reconstructColumnTitle(
      deps.addIncludeSyntaxToTitle(col.title || '', cleanPath),
      col.title || ''
    );
    if (nextTitle === col.title && col.includeSource && col.includeSource.rawPath === cleanPath) {
      return false;
    }
    deps.pushUndo();
    col.title = nextTitle;
    col.includeSource = { rawPath: cleanPath };
    return deps.persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  async function enableColumnIncludeMode(colIndex) {
    var col = deps.getFullColumn(colIndex);
    if (!col) return;
    var requested = window.prompt('Include file path', deps.suggestIncludePathForColumn(col.title || ''));
    if (requested == null) return;
    await setColumnIncludePath(colIndex, requested);
  }

  async function editColumnIncludeFile(colIndex) {
    var col = deps.getFullColumn(colIndex);
    if (!col) return;
    var currentPath = col && col.includeSource && col.includeSource.rawPath
      ? String(col.includeSource.rawPath)
      : deps.extractIncludePathFromTitle(col.title || '');
    if (!currentPath) {
      deps.showNotification('This column is not in include mode');
      return;
    }
    var requested = window.prompt('Edit include file path', currentPath);
    if (requested == null) return;
    await setColumnIncludePath(colIndex, requested);
  }

  async function disableColumnIncludeMode(colIndex) {
    var col = deps.getFullColumn(colIndex);
    if (!col) return;
    var currentPath = col && col.includeSource && col.includeSource.rawPath
      ? String(col.includeSource.rawPath)
      : deps.extractIncludePathFromTitle(col.title || '');
    if (!currentPath) return;
    if (!(await deps.showConfirmDialog('Disable include mode? Included cards will be written back into this board as regular cards.'))) {
      return;
    }
    var cleanTitle = deps.removeIncludeSyntaxFromTitle(col.title || '');
    if (!cleanTitle) {
      cleanTitle = deps.getDisplayNameFromPath(currentPath).replace(/\.[^.]+$/, '') || 'Untitled Column';
    }
    deps.pushUndo();
    col.title = deps.reconstructColumnTitle(cleanTitle, col.title || '');
    col.includeSource = null;
    await deps.persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
  }

  // ── Move column to stack ───────────────────────────────────────────

  async function moveColumnToStack(colIndex, targetRowIdx, targetStackIdx) {
    if (!deps.getFullBoardData() || !deps.getFullBoardData().rows) {
      deps.traceFrontendAction('warn', 'column.move', 'Aborted move because fullBoardData is missing', {
        boardId: deps.getActiveBoardId() || null,
        colIndex: colIndex,
        targetRowIdx: targetRowIdx,
        targetStackIdx: targetStackIdx
      });
      return;
    }
    var col = deps.getFullColumn(colIndex);
    if (!col) {
      deps.traceFrontendAction('warn', 'column.move', 'Aborted move because source column could not be resolved', {
        boardId: deps.getActiveBoardId() || null,
        colIndex: colIndex,
        targetRowIdx: targetRowIdx,
        targetStackIdx: targetStackIdx
      });
      return;
    }
    var container = findColumnContainer(colIndex);
    if (!container) {
      deps.traceFrontendAction('warn', 'column.move', 'Aborted move because source container could not be resolved', {
        boardId: deps.getActiveBoardId() || null,
        colIndex: colIndex,
        targetRowIdx: targetRowIdx,
        targetStackIdx: targetStackIdx,
        columnId: col.id || null
      });
      return;
    }
    var targetStack = deps.findFullDataStack(targetRowIdx, targetStackIdx);
    if (!targetStack) {
      deps.traceFrontendAction('warn', 'column.move', 'Aborted move because target stack could not be resolved', {
        boardId: deps.getActiveBoardId() || null,
        colIndex: colIndex,
        columnId: col.id || null,
        targetRowIdx: targetRowIdx,
        targetStackIdx: targetStackIdx
      });
      return;
    }
    if (container.stack === targetStack) {
      deps.traceFrontendAction('warn', 'column.move', 'Skipping move because source and target stack are identical', {
        boardId: deps.getActiveBoardId() || null,
        colIndex: colIndex,
        columnId: col.id || null,
        rowIdx: container.rowIdx,
        stackIdx: container.stackIdx
      });
      return;
    }
    deps.traceFrontendAction('info', 'column.move', 'Moving column to stack', {
      boardId: deps.getActiveBoardId() || null,
      colIndex: colIndex,
      columnId: col.id || null,
      sourceRowIdx: container.rowIdx,
      sourceStackIdx: container.stackIdx,
      targetRowIdx: targetRowIdx,
      targetStackIdx: targetStackIdx
    });
    deps.pushUndo();
    var removed = container.arr.splice(container.localIdx, 1)[0];
    targetStack.columns.push(removed);
    deps.removeEmptyStacksAndRows();
    await deps.persistBoardMutation({ refreshSidebar: true });
  }

  // ── Hidden tag ─────────────────────────────────────────────────────

  async function setColumnHiddenTag(colIndex, tag) {
    deps.traceFrontendAction('info', 'column.hiddenTag', 'setColumnHiddenTag called', { colIndex: colIndex, tag: tag });
    if (!deps.getFullBoardData() || !deps.getActiveBoardId()) return;
    var col = deps.getFullColumn(colIndex);
    if (!col) {
      deps.traceFrontendAction('warn', 'column.hiddenTag', 'getFullColumn returned null', { colIndex: colIndex });
      return;
    }
    var nextTitle = deps.applyInternalHiddenTag(col.title || '', tag);
    deps.traceFrontendAction('info', 'column.hiddenTag', 'Title transformation', { oldTitle: col.title, nextTitle: nextTitle, same: nextTitle === col.title });
    if (nextTitle === col.title) return;
    deps.pushUndo();
    col.title = nextTitle;
    await deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
    var postSaveCol = deps.getFullColumn(colIndex);
    var postTitle = postSaveCol ? postSaveCol.title : '(col gone)';
    var tagSurvived = postTitle.indexOf(tag) !== -1;
    deps.traceFrontendAction(tagSurvived ? 'info' : 'error', 'column.hiddenTag', 'Post-save verification', {
      colIndex: colIndex,
      expectedTag: tag,
      postSaveTitle: postTitle,
      tagSurvived: tagSurvived
    });
  }

  // ── Card sorting ───────────────────────────────────────────────────

  var columnSortState = {};

  function resetColumnSortState() {
    columnSortState = {};
  }

  function getColumnSortState() {
    return columnSortState;
  }

  function compareNumericTagParts(aParts, bParts) {
    var left = Array.isArray(aParts) ? aParts : null;
    var right = Array.isArray(bParts) ? bParts : null;
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    var maxLen = Math.max(left.length, right.length);
    for (var i = 0; i < maxLen; i++) {
      var lv = i < left.length ? left[i] : 0;
      var rv = i < right.length ? right[i] : 0;
      if (lv !== rv) return lv - rv;
    }
    return left.length - right.length;
  }

  function extractFirstTemporalDateValue(content) {
    var tokens = deps.collectHeaderTagTokens(content, { includeHash: false, includeAt: true, includeTemporalBang: true });
    for (var i = 0; i < tokens.length; i++) {
      var type = deps.getTemporalTagType(tokens[i]);
      if (type === 'date' || type === 'weekday') {
        var resolved = deps.resolveTemporalTag(tokens[i]);
        if (resolved) return resolved;
      }
    }
    return '';
  }

  function compareCardsForSort(a, b, mode) {
    if (mode === 'title') {
      var titleA = String((a && a.content ? a.content : '')).split('\n')[0].toLowerCase();
      var titleB = String((b && b.content ? b.content : '')).split('\n')[0].toLowerCase();
      return titleA < titleB ? -1 : titleA > titleB ? 1 : 0;
    }
    if (mode === 'tag') {
      return compareNumericTagParts(extractNumericTag(a && a.content ? a.content : ''), extractNumericTag(b && b.content ? b.content : ''));
    }
    if (mode === 'duedate') {
      var dateA = extractFirstTemporalDateValue(a && a.content ? a.content : '');
      var dateB = extractFirstTemporalDateValue(b && b.content ? b.content : '');
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA < dateB ? -1 : dateA > dateB ? 1 : 0;
    }
    return 0;
  }

  async function sortColumnCards(colIndex, mode) {
    var col = deps.getFullColumn(colIndex);
    if (!col || col.cards.length < 2) return;
    var key = colIndex + ':' + mode;
    var prevDir = columnSortState[key] || 'asc';
    var dir = prevDir === 'asc' ? 'desc' : 'asc';
    columnSortState[key] = dir;
    deps.pushUndo();
    col.cards.sort(function (a, b) {
      var cmp = compareCardsForSort(a, b, mode);
      return dir === 'desc' ? -cmp : cmp;
    });
    await deps.persistBoardMutation();
  }

  function sortColumnsCards(columns, mode) {
    var changed = false;
    for (var i = 0; i < columns.length; i++) {
      var col = columns[i];
      if (!col || !Array.isArray(col.cards) || col.cards.length < 2) continue;
      col.cards.sort(function (a, b) { return compareCardsForSort(a, b, mode); });
      changed = true;
    }
    return changed;
  }

  async function sortRowCards(rowIdx, mode) {
    var row = deps.findFullDataRow(rowIdx);
    if (!row || !row.stacks) return;
    var cols = [];
    for (var s = 0; s < row.stacks.length; s++) {
      var stack = row.stacks[s];
      if (stack && stack.columns) cols = cols.concat(stack.columns);
    }
    if (cols.length === 0) return;
    deps.pushUndo();
    sortColumnsCards(cols, mode);
    await deps.persistBoardMutation();
  }

  async function sortStackCards(rowIdx, stackIdx, mode) {
    var stack = deps.findFullDataStack(rowIdx, stackIdx);
    if (!stack || !stack.columns) return;
    deps.pushUndo();
    sortColumnsCards(stack.columns, mode);
    await deps.persistBoardMutation();
  }

  async function sortAllCardsAcrossBoard(mode) {
    if (!deps.getFullBoardData() || !deps.getActiveBoardId()) return;
    var allCols = deps.getAllColumnsFromBoardData(deps.getFullBoardData());
    if (!allCols || allCols.length === 0) return;

    var plans = [];
    for (var i = 0; i < allCols.length; i++) {
      var col = allCols[i];
      if (!col || !Array.isArray(col.cards) || col.cards.length < 2) continue;
      var sorted = col.cards.slice().sort(function (a, b) { return compareCardsForSort(a, b, mode); });
      var different = false;
      for (var j = 0; j < sorted.length; j++) {
        if (sorted[j] !== col.cards[j]) {
          different = true;
          break;
        }
      }
      if (different) plans.push({ column: col, cards: sorted });
    }
    if (plans.length === 0) return;

    deps.pushUndo();
    for (var p = 0; p < plans.length; p++) {
      plans[p].column.cards = plans[p].cards;
    }
    await deps.persistBoardMutation();
  }

  // ── Numeric tag extraction ─────────────────────────────────────────

  function extractNumericTag(content) {
    var numericTags = extractAllNumericTags(content);
    return numericTags.length > 0 ? numericTags[0].parts.slice() : null;
  }

  function extractAllNumericTags(content) {
    var tokens = deps.collectHeaderTagTokens(content, {
      includeHash: true,
      includeAt: false,
      includeTemporalBang: false
    });
    var out = [];
    var seen = {};
    for (var i = 0; i < tokens.length; i++) {
      var token = String(tokens[i] || '');
      if (!deps.isNumericIndexTag(token)) continue;
      var normalizedToken = token.toLowerCase();
      if (seen[normalizedToken]) continue;
      seen[normalizedToken] = true;
      var parts = token.slice(1).split('.');
      var numbers = [];
      for (var p = 0; p < parts.length; p++) {
        var part = parseInt(parts[p], 10);
        if (!isFinite(part)) {
          numbers = null;
          break;
        }
        numbers.push(part);
      }
      if (numbers && numbers.length > 0) {
        out.push({
          tag: token,
          parts: numbers
        });
      }
    }
    return out;
  }

  // ── Utility ────────────────────────────────────────────────────────

  function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Column rename ──────────────────────────────────────────────────

  function enterColumnRename(colEl, colIndex) {
    if (!deps.getFullBoardData()) return;
    var col = deps.getFullColumn(colIndex);
    if (!col) return;
    var titleEl = colEl.querySelector('.column-title');
    if (!titleEl) return;
    var includePath = deps.extractIncludePathFromTitle(col.title);
    var currentTitle = deps.removeIncludeSyntaxFromTitle(deps.stripLayoutTags(col.title));
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'column-rename-input';
    input.value = currentTitle;
    titleEl.textContent = '';
    titleEl.appendChild(input);
    input.focus();
    input.select();

    var done = false;
    function save() {
      if (done) return;
      done = true;
      var newTitle = input.value.trim();
      if (newTitle && newTitle !== currentTitle) {
        deps.pushUndo();
        var rebuilt = deps.reconstructColumnTitle(newTitle, col.title);
        if (includePath) {
          rebuilt = deps.addIncludeSyntaxToTitle(rebuilt, includePath);
        }
        col.title = rebuilt;
        // Update title in place — no full re-render needed
        var displayNew = includePath ? deps.addIncludeSyntaxToTitle(newTitle, includePath) : newTitle;
        titleEl.innerHTML = deps.renderTitleInline(displayNew, deps.getActiveBoardId(), { allowIncludeDirectives: true });
        deps.persistBoardMutation({ skipRender: true });
      } else {
        var displayTitle = includePath ? deps.addIncludeSyntaxToTitle(currentTitle, includePath) : currentTitle;
        titleEl.innerHTML = deps.renderTitleInline(displayTitle, deps.getActiveBoardId(), { allowIncludeDirectives: true });
      }
    }
    input.addEventListener('blur', save);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); save(); }
    });
  }

  // ── Column container lookup ────────────────────────────────────────

  function getBoardColumnByPath(boardData, rowIdx, stackIdx, colIdx) {
    if (!boardData || !boardData.rows) return null;
    if (rowIdx < 0 || rowIdx >= boardData.rows.length) return null;
    var row = boardData.rows[rowIdx];
    if (!row.stacks || stackIdx < 0 || stackIdx >= row.stacks.length) return null;
    var stack = row.stacks[stackIdx];
    if (!stack.columns || colIdx < 0 || colIdx >= stack.columns.length) return null;
    return stack.columns[colIdx];
  }

  function findColumnContainerInBoard(boardData, flatIndex) {
    if (!boardData || !boardData.rows) return null;
    var idx = 0;
    for (var r = 0; r < boardData.rows.length; r++) {
      var row = boardData.rows[r];
      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        for (var c = 0; c < stack.columns.length; c++) {
          if (idx === flatIndex) {
            return {
              arr: stack.columns,
              localIdx: c,
              row: row,
              rowIdx: r,
              stack: stack,
              stackIdx: s
            };
          }
          idx++;
        }
      }
    }
    return null;
  }

  function findColumnContainer(flatIndex) {
    return findColumnContainerInBoard(deps.getFullBoardData(), flatIndex);
  }

  // ── Column CRUD ────────────────────────────────────────────────────

  async function addColumn(atIndex) {
    if (!deps.getFullBoardData() || !deps.getActiveBoardId()) {
      deps.traceFrontendAction('warn', 'column.create.flat', 'Aborted flat add column because board data is missing', {
        boardId: deps.getActiveBoardId() || null,
        atIndex: atIndex
      });
      return false;
    }
    deps.pushUndo();
    var newCol = { id: 'col-' + Date.now(), title: 'New Column', cards: [] };
    var container = findColumnContainer(atIndex);
    if (container) {
      deps.traceFrontendAction('info', 'column.create.flat', 'Resolved flat insertion container', {
        boardId: deps.getActiveBoardId() || null,
        atIndex: atIndex,
        rowIdx: container.rowIdx,
        stackIdx: container.stackIdx,
        localIdx: container.localIdx,
        columnId: newCol.id
      });
    } else {
      deps.traceFrontendAction('warn', 'column.create.flat', 'Flat insertion fell back to last visible stack', {
        boardId: deps.getActiveBoardId() || null,
        atIndex: atIndex,
        columnId: newCol.id
      });
    }
    if (container) {
      container.arr.splice(container.localIdx, 0, newCol);
    } else {
      var fullBoardData = deps.getFullBoardData();
      if (!fullBoardData.rows || fullBoardData.rows.length === 0) {
        fullBoardData.rows = [{
          id: 'row-' + Date.now(),
          title: fullBoardData.title || 'Board',
          stacks: []
        }];
      }
      var lastRow = fullBoardData.rows[fullBoardData.rows.length - 1];
      if (!lastRow.stacks || lastRow.stacks.length === 0) {
        lastRow.stacks = [{
          id: 'stack-' + Date.now(),
          title: 'Default',
          columns: []
        }];
      }
      lastRow.stacks[lastRow.stacks.length - 1].columns.push(newCol);
    }
    var saved = await deps.persistBoardMutation();
    deps.traceFrontendAction(saved ? 'info' : 'warn', 'column.create.flat', saved ? 'Persisted flat column insertion' : 'Flat column insertion persist reported failure', {
      boardId: deps.getActiveBoardId() || null,
      atIndex: atIndex,
      columnId: newCol.id
    });
    return saved;
  }

  async function deleteColumn(colIndex) {
    deps.traceFrontendAction('info', 'column.delete', 'deleteColumn called', { colIndex: colIndex });
    if (!deps.getFullBoardData() || !deps.getActiveBoardId()) {
      deps.traceFrontendAction('warn', 'column.delete', 'No fullBoardData or activeBoardId');
      return;
    }
    var col = deps.getFullColumn(colIndex);
    if (!col) {
      deps.traceFrontendAction('warn', 'column.delete', 'getFullColumn returned null', { colIndex: colIndex });
      return;
    }
    var visibleCards = (col.cards || []).filter(function (c) { return !deps.is_archived_or_deleted(c.content || ''); });
    deps.traceFrontendAction('info', 'column.delete', 'Column found', { title: col.title, totalCards: col.cards.length, visibleCards: visibleCards.length });
    if (visibleCards.length > 0) {
      var confirmed = await deps.showConfirmDialog('Move column "' + deps.stripLayoutTags(col.title) + '" and ' + visibleCards.length + ' card(s) to trash?');
      deps.traceFrontendAction('info', 'column.delete', 'Confirm dialog result', { confirmed: confirmed });
      if (!confirmed) return;
    }
    deps.traceFrontendAction('info', 'column.delete', 'Calling setColumnHiddenTag');
    await setColumnHiddenTag(colIndex, '#hidden-internal-deleted');
  }

  async function duplicateColumn(colIndex) {
    if (!deps.getFullBoardData() || !deps.getActiveBoardId()) return;
    var container = findColumnContainer(colIndex);
    if (!container) return;
    var col = container.arr[container.localIdx];
    if (!col) return;
    deps.pushUndo();
    var clone = structuredClone(col);
    var ts = Date.now();
    clone.id = 'col-' + ts;
    for (var k = 0; k < clone.cards.length; k++) {
      clone.cards[k].id = 'dup-' + ts + '-' + k;
      clone.cards[k].kid = null;
    }
    container.arr.splice(container.localIdx + 1, 0, clone);
    await deps.persistBoardMutation({ refreshSidebar: true });
  }

  // ── Collapse / reveal ──────────────────────────────────────────────

  function toggleColCards(colIndex, collapse) {
    if (deps.isCanvasBoardLayout()) return;
    var cards = deps.getElColumnsContainer().querySelectorAll('.card[data-col-index="' + colIndex + '"]');
    for (var i = 0; i < cards.length; i++) {
      if (collapse) {
        cards[i].classList.add('collapsed');
      } else {
        cards[i].classList.remove('collapsed');
      }
      var toggle = cards[i].querySelector('.card-collapse-toggle');
      if (toggle) {
        if (collapse) toggle.classList.remove('expanded');
        else toggle.classList.add('expanded');
      }
    }
    deps.saveCardCollapseState(deps.getActiveBoardId());
  }

  function revealCardContent(colIndex, cardIndex) {
    var card = deps.getElColumnsContainer().querySelector('.card[data-col-index="' + colIndex + '"][data-card-index="' + cardIndex + '"]');
    if (!card) return;
    if (card.hasAttribute('data-hidden-revealed')) {
      card.removeAttribute('data-hidden-revealed');
    } else {
      card.setAttribute('data-hidden-revealed', '');
    }
  }

  function toggleRevealedCards(cards) {
    if (!cards || !cards.length) return;
    var allRevealed = true;
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].hasAttribute('data-hidden-revealed')) { allRevealed = false; break; }
    }
    for (var j = 0; j < cards.length; j++) {
      if (allRevealed) cards[j].removeAttribute('data-hidden-revealed');
      else cards[j].setAttribute('data-hidden-revealed', '');
    }
  }

  function revealColumnContent(colIndex) {
    toggleRevealedCards(deps.getElColumnsContainer().querySelectorAll('.card[data-col-index="' + colIndex + '"]'));
  }

  function revealRowContent(rowIdx) {
    var rowEl = deps.getElColumnsContainer().querySelectorAll('.kanban-row')[rowIdx];
    if (rowEl) toggleRevealedCards(rowEl.querySelectorAll('.card'));
  }

  function revealStackContent(rowIdx, stackIdx) {
    var rowEl = deps.getElColumnsContainer().querySelectorAll('.kanban-row')[rowIdx];
    var stackEl = rowEl ? rowEl.querySelectorAll('.kanban-column-stack')[stackIdx] : null;
    if (stackEl) toggleRevealedCards(stackEl.querySelectorAll('.card'));
  }

  // ── Init ───────────────────────────────────────────────────────────

  function init(d) {
    deps = d || {};
  }

  // ── Public API ─────────────────────────────────────────────────────

  return {
    init: init,
    // Column menu state
    getActiveColMenu: getActiveColMenu,
    closeColumnContextMenu: closeColumnContextMenu,
    showColumnContextMenu: showColumnContextMenu,
    // Include mode
    setColumnIncludePath: setColumnIncludePath,
    enableColumnIncludeMode: enableColumnIncludeMode,
    editColumnIncludeFile: editColumnIncludeFile,
    disableColumnIncludeMode: disableColumnIncludeMode,
    // Move
    moveColumnToStack: moveColumnToStack,
    // Hidden tag
    setColumnHiddenTag: setColumnHiddenTag,
    // Sorting
    resetColumnSortState: resetColumnSortState,
    getColumnSortState: getColumnSortState,
    compareNumericTagParts: compareNumericTagParts,
    extractFirstTemporalDateValue: extractFirstTemporalDateValue,
    compareCardsForSort: compareCardsForSort,
    sortColumnCards: sortColumnCards,
    sortColumnsCards: sortColumnsCards,
    sortRowCards: sortRowCards,
    sortStackCards: sortStackCards,
    sortAllCardsAcrossBoard: sortAllCardsAcrossBoard,
    // Numeric tags
    extractNumericTag: extractNumericTag,
    extractAllNumericTags: extractAllNumericTags,
    // Utility
    escapeAttr: escapeAttr,
    // Rename
    enterColumnRename: enterColumnRename,
    // Container lookup
    getBoardColumnByPath: getBoardColumnByPath,
    findColumnContainerInBoard: findColumnContainerInBoard,
    findColumnContainer: findColumnContainer,
    // CRUD
    addColumn: addColumn,
    deleteColumn: deleteColumn,
    duplicateColumn: duplicateColumn,
    // Collapse / reveal
    toggleColCards: toggleColCards,
    revealCardContent: revealCardContent,
    revealColumnContent: revealColumnContent,
    revealRowContent: revealRowContent,
    revealStackContent: revealStackContent
  };
})();
window.LexeraColumnContextMenu = LexeraColumnContextMenu;
