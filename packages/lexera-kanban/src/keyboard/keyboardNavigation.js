var LexeraKeyboardNavigation = (function () {
  'use strict';
  var focusedCardEl = null;
  var focusedBoardEntityEl = null;
  var focusedBoardEntityTarget = null;
  var focusedBoardEntityTimer = null;
  var selectedCardEls = [];

  var _deps = {};

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  function hasDep(name) {
    return !!(_deps && typeof _deps[name] === 'function');
  }

  function parseOptionalIndex(value) {
    if (value == null || value === '') return null;
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }

  function normalizeEntityId(value) {
    if (value == null) return '';
    var normalized = String(value).trim();
    return normalized ? normalized : '';
  }

  function cloneTarget(rawTarget) {
    if (!rawTarget) return null;
    var clone = {};
    var keys = Object.keys(rawTarget);
    for (var i = 0; i < keys.length; i++) clone[keys[i]] = rawTarget[keys[i]];
    return clone;
  }

  function getActiveBoardData() {
    return hasDep('getActiveBoardData') ? _deps.getActiveBoardData() : null;
  }

  function buildBoardEntityFocusTarget(el) {
    if (!el || typeof el.closest !== 'function') return null;

    var rowEl = el.closest('.board-row');
    var stackEl = el.closest('.board-stack');
    var columnEl = el.closest('.column');
    var cardEl = el.closest('.card');
    var target = {};

    if (cardEl) target.scope = 'card';
    else if (columnEl) target.scope = 'column';
    else if (stackEl) target.scope = 'stack';
    else if (rowEl) target.scope = 'row';
    else return null;

    var rowId = normalizeEntityId((rowEl && rowEl.getAttribute && rowEl.getAttribute('data-row-id')) || (el.getAttribute && el.getAttribute('data-row-id')));
    var stackId = normalizeEntityId((stackEl && stackEl.getAttribute && stackEl.getAttribute('data-stack-id')) || (el.getAttribute && el.getAttribute('data-stack-id')));
    var columnId = normalizeEntityId((columnEl && columnEl.getAttribute && columnEl.getAttribute('data-column-id')) || (el.getAttribute && el.getAttribute('data-column-id')));
    var cardId = normalizeEntityId((cardEl && cardEl.getAttribute && cardEl.getAttribute('data-card-id')) || (el.getAttribute && el.getAttribute('data-card-id')));

    if (rowId) target.rowId = rowId;
    if (stackId) target.stackId = stackId;
    if (columnId) target.columnId = columnId;
    if (cardId) target.cardId = cardId;

    target.rowIndex = parseOptionalIndex((rowEl && rowEl.getAttribute && rowEl.getAttribute('data-row-index')) || (el.getAttribute && el.getAttribute('data-row-index')));
    target.stackIndex = parseOptionalIndex((stackEl && stackEl.getAttribute && stackEl.getAttribute('data-stack-index')) || (el.getAttribute && el.getAttribute('data-stack-index')));
    target.colLocalIndex = parseOptionalIndex((columnEl && columnEl.getAttribute && columnEl.getAttribute('data-col-local-index')) || (el.getAttribute && el.getAttribute('data-col-local-index')));
    target.columnIndex = parseOptionalIndex((columnEl && columnEl.getAttribute && columnEl.getAttribute('data-col-index')) || (el.getAttribute && el.getAttribute('data-col-index')));
    target.cardIndex = parseOptionalIndex((cardEl && cardEl.getAttribute && cardEl.getAttribute('data-card-index')) || (el.getAttribute && el.getAttribute('data-card-index')));

    return target;
  }

  function findRowContextById(rows, rowId) {
    rowId = normalizeEntityId(rowId);
    if (!rowId) return null;
    for (var r = 0; r < rows.length; r++) {
      if (normalizeEntityId(rows[r] && rows[r].id) === rowId) {
        return { row: rows[r], rowIndex: r };
      }
    }
    return null;
  }

  function findStackContextById(rows, rowId, stackId) {
    stackId = normalizeEntityId(stackId);
    if (!stackId) return null;
    var normalizedRowId = normalizeEntityId(rowId);
    for (var r = 0; r < rows.length; r++) {
      if (normalizedRowId && normalizeEntityId(rows[r] && rows[r].id) !== normalizedRowId) continue;
      var stacks = rows[r] && Array.isArray(rows[r].stacks) ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        if (normalizeEntityId(stacks[s] && stacks[s].id) === stackId) {
          return { row: rows[r], rowIndex: r, stack: stacks[s], stackIndex: s };
        }
      }
    }
    return null;
  }

  function findColumnContextById(rows, rowId, stackId, columnId) {
    columnId = normalizeEntityId(columnId);
    if (!columnId) return null;
    var normalizedRowId = normalizeEntityId(rowId);
    var normalizedStackId = normalizeEntityId(stackId);
    for (var r = 0; r < rows.length; r++) {
      if (normalizedRowId && normalizeEntityId(rows[r] && rows[r].id) !== normalizedRowId) continue;
      var stacks = rows[r] && Array.isArray(rows[r].stacks) ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        if (normalizedStackId && normalizeEntityId(stacks[s] && stacks[s].id) !== normalizedStackId) continue;
        var columns = stacks[s] && Array.isArray(stacks[s].columns) ? stacks[s].columns : [];
        for (var c = 0; c < columns.length; c++) {
          if (normalizeEntityId(columns[c] && columns[c].id) === columnId) {
            return {
              row: rows[r],
              rowIndex: r,
              stack: stacks[s],
              stackIndex: s,
              column: columns[c],
              colLocalIndex: c
            };
          }
        }
      }
    }
    return null;
  }

  function findCardContextById(rows, rowId, stackId, columnId, cardId) {
    cardId = normalizeEntityId(cardId);
    if (!cardId) return null;
    var normalizedRowId = normalizeEntityId(rowId);
    var normalizedStackId = normalizeEntityId(stackId);
    var normalizedColumnId = normalizeEntityId(columnId);
    for (var r = 0; r < rows.length; r++) {
      if (normalizedRowId && normalizeEntityId(rows[r] && rows[r].id) !== normalizedRowId) continue;
      var stacks = rows[r] && Array.isArray(rows[r].stacks) ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        if (normalizedStackId && normalizeEntityId(stacks[s] && stacks[s].id) !== normalizedStackId) continue;
        var columns = stacks[s] && Array.isArray(stacks[s].columns) ? stacks[s].columns : [];
        for (var c = 0; c < columns.length; c++) {
          if (normalizedColumnId && normalizeEntityId(columns[c] && columns[c].id) !== normalizedColumnId) continue;
          var cards = columns[c] && Array.isArray(columns[c].cards) ? columns[c].cards : [];
          for (var k = 0; k < cards.length; k++) {
            if (normalizeEntityId(cards[k] && cards[k].id) === cardId) {
              return {
                row: rows[r],
                rowIndex: r,
                stack: stacks[s],
                stackIndex: s,
                column: columns[c],
                colLocalIndex: c,
                card: cards[k],
                cardIndex: k
              };
            }
          }
        }
      }
    }
    return null;
  }

  function resolveFocusedBoardEntityContext(rawTarget) {
    var target = cloneTarget(rawTarget || focusedBoardEntityTarget);
    if (!target) return null;

    var activeBoardData = getActiveBoardData();
    var rows = activeBoardData && Array.isArray(activeBoardData.rows) ? activeBoardData.rows : [];
    if (!rows.length) return target;

    var cardContext = target.cardId ? findCardContextById(rows, target.rowId, target.stackId, target.columnId, target.cardId) : null;
    if (cardContext) {
      target.rowIndex = cardContext.rowIndex;
      target.stackIndex = cardContext.stackIndex;
      target.colLocalIndex = cardContext.colLocalIndex;
      target.columnIndex = typeof cardContext.column.index === 'number' ? cardContext.column.index : target.columnIndex;
      target.cardIndex = cardContext.cardIndex;
      return target;
    }

    var columnContext = target.columnId ? findColumnContextById(rows, target.rowId, target.stackId, target.columnId) : null;
    if (columnContext) {
      target.rowIndex = columnContext.rowIndex;
      target.stackIndex = columnContext.stackIndex;
      target.colLocalIndex = columnContext.colLocalIndex;
      target.columnIndex = typeof columnContext.column.index === 'number' ? columnContext.column.index : target.columnIndex;
      return target;
    }

    var stackContext = target.stackId ? findStackContextById(rows, target.rowId, target.stackId) : null;
    if (stackContext) {
      target.rowIndex = stackContext.rowIndex;
      target.stackIndex = stackContext.stackIndex;
      return target;
    }

    var rowContext = target.rowId ? findRowContextById(rows, target.rowId) : null;
    if (rowContext) {
      target.rowIndex = rowContext.rowIndex;
    }

    return target;
  }

  function handleKeyNavigation(e) {
    if (!hasDep('getIsEditing') || !hasDep('getSearchMode')) return;
    if (_deps.getIsEditing() || _deps.getSearchMode()) return;
    if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

    var columnsContainer = hasDep('getElColumnsContainer') ? _deps.getElColumnsContainer() : null;
    var key = e.key;
    if ((key === 'ArrowUp' || key === 'ArrowDown') && e.altKey && focusedCardEl) {
      if (!columnsContainer) return;
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      if (key === 'ArrowUp' && cj > 0) {
        _deps.moveCard(ci, cj, ci, cj - 1).then(function () {
          var moved = columnsContainer.querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj - 1) + '"]');
          if (moved) focusCard(moved);
        });
      } else if (key === 'ArrowDown') {
        _deps.moveCard(ci, cj, ci, cj + 2).then(function () {
          var moved = columnsContainer.querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj + 1) + '"]');
          if (moved) focusCard(moved);
        });
      }
    } else if ((key === 'ArrowLeft' || key === 'ArrowRight') && e.altKey && focusedCardEl) {
      if (!columnsContainer) return;
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      var columns = _deps.getActiveBoardColumns();
      var colIndices = columns.map(function (c) { return c.index; });
      var curPos = colIndices.indexOf(ci);
      var targetPos = key === 'ArrowRight' ? curPos + 1 : curPos - 1;
      if (targetPos >= 0 && targetPos < colIndices.length) {
        var targetColIdx = colIndices[targetPos];
        _deps.moveCard(ci, cj, targetColIdx, 0).then(function () {
          var moved = columnsContainer.querySelector('.card[data-col-index="' + targetColIdx + '"][data-card-index="0"]');
          if (moved) focusCard(moved);
        });
      }
    } else if ((key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') && !(e.ctrlKey && e.altKey)) {
      e.preventDefault();
      navigateCards(key);
    } else if (key === 'Enter' && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      var editorMode = _deps.isOverlayEditorEnabled && _deps.isOverlayEditorEnabled() ? 'overlay' : 'inline';
      _deps.openCardEditor(focusedCardEl, ci, cj, editorMode);
    } else if (key === 'Home' && focusedCardEl) {
      if (!columnsContainer) return;
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var first = columnsContainer.querySelector('.card[data-col-index="' + ci + '"][data-card-index="0"]');
      if (first) focusCard(first);
    } else if (key === 'End' && focusedCardEl) {
      if (!columnsContainer) return;
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var colCards = columnsContainer.querySelectorAll('.card[data-col-index="' + ci + '"]');
      if (colCards.length > 0) focusCard(colCards[colCards.length - 1]);
    } else if ((key === 'd' || key === 'D') && (e.ctrlKey || e.metaKey) && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      _deps.duplicateCard(ci, cj);
    } else if ((key === 'Delete' || key === 'Backspace') && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      _deps.deleteCard(ci, cj);
    } else if (key === 'p' && !e.ctrlKey && !e.metaKey && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      _deps.tagCard(ci, cj, '#hidden-internal-parked');
    } else if (key === 'r' && !e.ctrlKey && !e.metaKey && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      _deps.revealCardContent(ci, cj);
    } else if (key === 'i' && !e.ctrlKey && !e.metaKey && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      _deps.insertCardAtIndex(ci, cj + 1);
    } else if (key === 'c' && !e.ctrlKey && !e.metaKey && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      _deps.copyElementAsMarkdown('card', { colIndex: ci, cardIndex: cj });
    } else if (key === 'e' && !e.ctrlKey && !e.metaKey && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      if (_deps.isOverlayEditorEnabled()) {
        _deps.openCardEditor(focusedCardEl, ci, cj, 'overlay');
      } else {
        _deps.openCardEditor(focusedCardEl, ci, cj, 'inline');
      }
    } else if (key === ' ' && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      var rect = focusedCardEl.getBoundingClientRect();
      _deps.showCardContextMenu(rect.left + 20, rect.top + 20, ci, cj);
    } else if (key >= '1' && key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!columnsContainer) return;
      var colNum = parseInt(key, 10) - 1;
      var columns = _deps.getActiveBoardColumns();
      if (colNum < columns.length) {
        e.preventDefault();
        var targetColIdx = columns[colNum].index;
        var firstCard = columnsContainer.querySelector('.card[data-col-index="' + targetColIdx + '"][data-card-index="0"]');
        if (firstCard) focusCard(firstCard);
        else {
          var colEl = columnsContainer.querySelector('.column[data-col-index="' + targetColIdx + '"]');
          if (colEl) colEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    } else if (key === 'n' && !e.ctrlKey && !e.metaKey && !focusedCardEl && !_deps.getMgmtPanelOpen()) {
      e.preventDefault();
      var columns = _deps.getActiveBoardColumns();
      if (columns.length > 0) {
        _deps.setAddCardColumn(columns[0].index);
        _deps.renderColumns();
      }
    } else if ((key === 'ArrowUp' || key === 'ArrowDown') && e.ctrlKey && e.altKey && !focusedCardEl) {
      // Ctrl+Alt+Up/Down: reorder rows
      if (!_deps.reorderRows) return;
      var activeBoardData = getActiveBoardData();
      if (!activeBoardData || !activeBoardData.rows || activeBoardData.rows.length < 2) return;
      e.preventDefault();
      var focusedRowContext = resolveFocusedBoardEntityContext();
      var focusedRowIdx = focusedRowContext && typeof focusedRowContext.rowIndex === 'number'
        ? focusedRowContext.rowIndex
        : 0;
      var targetIdx = key === 'ArrowUp' ? focusedRowIdx - 1 : focusedRowIdx + 1;
      if (targetIdx >= 0 && targetIdx < activeBoardData.rows.length) {
        _deps.reorderRows(focusedRowIdx, targetIdx, key === 'ArrowUp');
      }
    } else if ((key === 'ArrowLeft' || key === 'ArrowRight') && e.ctrlKey && e.altKey && !focusedCardEl) {
      // Ctrl+Alt+Left/Right: reorder stacks within a row, or columns within a stack
      var activeBoardData = getActiveBoardData();
      if (!activeBoardData || !activeBoardData.rows) return;
      e.preventDefault();
      var direction = key === 'ArrowLeft' ? -1 : 1;
      var focusedEntityContext = resolveFocusedBoardEntityContext();
      if (!focusedEntityContext) return;
      if (
        focusedEntityContext.scope === 'column' &&
        typeof focusedEntityContext.rowIndex === 'number' &&
        typeof focusedEntityContext.stackIndex === 'number' &&
        typeof focusedEntityContext.colLocalIndex === 'number' &&
        _deps.moveColumnWithinBoard
      ) {
        var rowForColumn = activeBoardData.rows[focusedEntityContext.rowIndex];
        var stackForColumn = rowForColumn && Array.isArray(rowForColumn.stacks)
          ? rowForColumn.stacks[focusedEntityContext.stackIndex]
          : null;
        var columns = stackForColumn && Array.isArray(stackForColumn.columns) ? stackForColumn.columns : [];
        if (columns.length < 2) return;
        var targetColIdx = focusedEntityContext.colLocalIndex + direction;
        if (targetColIdx < 0 || targetColIdx >= columns.length) return;
        _deps.moveColumnWithinBoard(
          focusedEntityContext.rowIndex,
          focusedEntityContext.stackIndex,
          focusedEntityContext.colLocalIndex,
          focusedEntityContext.rowIndex,
          focusedEntityContext.stackIndex,
          targetColIdx,
          direction < 0
        );
      } else if (
        typeof focusedEntityContext.rowIndex === 'number' &&
        typeof focusedEntityContext.stackIndex === 'number' &&
        _deps.moveStack
      ) {
        var rowForStack = activeBoardData.rows[focusedEntityContext.rowIndex];
        var stacks = rowForStack && Array.isArray(rowForStack.stacks) ? rowForStack.stacks : [];
        if (stacks.length < 2) return;
        var targetStackIdx = focusedEntityContext.stackIndex + direction;
        if (targetStackIdx < 0 || targetStackIdx >= stacks.length) return;
        _deps.moveStack(
          focusedEntityContext.rowIndex,
          focusedEntityContext.stackIndex,
          focusedEntityContext.rowIndex,
          targetStackIdx,
          direction < 0
        );
      }
    } else if (key === 'Escape' && _deps.getMgmtPanelOpen()) {
      e.preventDefault();
      _deps.closeManagementPanel();
    } else if (key === 'Escape' && focusedCardEl) {
      e.preventDefault();
      unfocusCard();
    } else if (key === 'Escape') {
      e.preventDefault();
    }
  }

  function navigateCards(key) {
    if (!hasDep('getElColumnsContainer')) return;
    var columnsContainer = _deps.getElColumnsContainer();
    if (!columnsContainer) return;
    var allCards = columnsContainer.querySelectorAll('.card');
    if (allCards.length === 0) return;

    if (!focusedCardEl || !focusedCardEl.isConnected) {
      focusCard(allCards[0]);
      return;
    }

    var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
    var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);

    if (key === 'ArrowDown') {
      var next = columnsContainer.querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj + 1) + '"]');
      if (next) focusCard(next);
    } else if (key === 'ArrowUp') {
      if (cj > 0) {
        var prev = columnsContainer.querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj - 1) + '"]');
        if (prev) focusCard(prev);
      }
    } else if (key === 'ArrowRight' || key === 'ArrowLeft') {
      var columns = _deps.getActiveBoardColumns();
      var colIndices = columns.map(function (c) { return c.index; });
      var curPos = colIndices.indexOf(ci);
      var targetPos = key === 'ArrowRight' ? curPos + 1 : curPos - 1;
      if (targetPos >= 0 && targetPos < colIndices.length) {
        var targetColIdx = colIndices[targetPos];
        var target = columnsContainer.querySelector('.card[data-col-index="' + targetColIdx + '"][data-card-index="' + cj + '"]');
        if (!target) {
          var colCards = columnsContainer.querySelectorAll('.card[data-col-index="' + targetColIdx + '"]');
          if (colCards.length > 0) target = colCards[colCards.length - 1];
        }
        if (target) focusCard(target);
      }
    }
  }

  function focusCard(cardEl) {
    if (!cardEl) return;
    unfocusCard();
    focusedCardEl = cardEl;
    cardEl.classList.add('focused');
    if (hasDep('getCurrentArrowKeyFocusScrollMode') && _deps.getCurrentArrowKeyFocusScrollMode() !== 'disabled') {
      cardEl.scrollIntoView({
        block: _deps.getCurrentArrowKeyFocusScrollMode() === 'center' ? 'center' : 'nearest',
        behavior: 'smooth'
      });
    }
    if (hasDep('syncSidebarToView')) _deps.syncSidebarToView();
  }

  function unfocusCard() {
    if (focusedCardEl) {
      focusedCardEl.classList.remove('focused');
      focusedCardEl = null;
    }
  }

  // ── Multi-selection ───────────────────────────────────────────────

  function clearSelection() {
    for (var i = 0; i < selectedCardEls.length; i++) {
      selectedCardEls[i].classList.remove('selected');
    }
    selectedCardEls = [];
  }

  function selectCard(cardEl) {
    clearSelection();
    unfocusCard();
    if (!cardEl) return;
    cardEl.classList.add('selected');
    selectedCardEls = [cardEl];
    focusedCardEl = cardEl;
    cardEl.classList.add('focused');
  }

  function toggleCardSelection(cardEl) {
    if (!cardEl) return;
    var idx = selectedCardEls.indexOf(cardEl);
    if (idx !== -1) {
      cardEl.classList.remove('selected');
      selectedCardEls.splice(idx, 1);
      if (focusedCardEl === cardEl) {
        focusedCardEl = selectedCardEls.length > 0 ? selectedCardEls[selectedCardEls.length - 1] : null;
        if (focusedCardEl) focusedCardEl.classList.add('focused');
      }
    } else {
      if (focusedCardEl) focusedCardEl.classList.remove('focused');
      cardEl.classList.add('selected');
      selectedCardEls.push(cardEl);
      focusedCardEl = cardEl;
      cardEl.classList.add('focused');
    }
  }

  function selectCardRange(cardEl) {
    if (!cardEl) return;
    var container = hasDep('getElColumnsContainer') ? _deps.getElColumnsContainer() : null;
    if (!container) { selectCard(cardEl); return; }
    var anchor = selectedCardEls.length > 0 ? selectedCardEls[0] : focusedCardEl;
    if (!anchor || !anchor.isConnected) { selectCard(cardEl); return; }
    var allCards = Array.prototype.slice.call(container.querySelectorAll('.card'));
    var anchorIdx = allCards.indexOf(anchor);
    var targetIdx = allCards.indexOf(cardEl);
    if (anchorIdx === -1 || targetIdx === -1) { selectCard(cardEl); return; }
    var start = Math.min(anchorIdx, targetIdx);
    var end = Math.max(anchorIdx, targetIdx);
    clearSelection();
    for (var i = start; i <= end; i++) {
      allCards[i].classList.add('selected');
      selectedCardEls.push(allCards[i]);
    }
    if (focusedCardEl) focusedCardEl.classList.remove('focused');
    focusedCardEl = cardEl;
    cardEl.classList.add('focused');
  }

  function getSelectedCardEls() {
    return selectedCardEls.slice();
  }

  function focusBoardEntity(el) {
    if (!el) return false;
    focusedBoardEntityTarget = buildBoardEntityFocusTarget(el);
    if (focusedBoardEntityTimer) {
      clearTimeout(focusedBoardEntityTimer);
      focusedBoardEntityTimer = null;
    }
    if (focusedBoardEntityEl && focusedBoardEntityEl !== el) {
      focusedBoardEntityEl.classList.remove('board-focus-highlight');
    }
    focusedBoardEntityEl = el;
    el.classList.add('board-focus-highlight');
    focusedBoardEntityTimer = setTimeout(function () {
      el.classList.remove('board-focus-highlight');
      if (focusedBoardEntityEl === el) focusedBoardEntityEl = null;
      focusedBoardEntityTimer = null;
    }, 1600);
    return true;
  }

  function getFocusedCardEl() {
    return focusedCardEl;
  }

  return {
    init: init,
    handleKeyNavigation: handleKeyNavigation,
    navigateCards: navigateCards,
    focusCard: focusCard,
    unfocusCard: unfocusCard,
    selectCard: selectCard,
    toggleCardSelection: toggleCardSelection,
    selectCardRange: selectCardRange,
    clearSelection: clearSelection,
    getSelectedCardEls: getSelectedCardEls,
    buildBoardEntityFocusTarget: buildBoardEntityFocusTarget,
    focusBoardEntity: focusBoardEntity,
    getFocusedCardEl: getFocusedCardEl,
    getFocusedBoardEntityTarget: function () { return cloneTarget(focusedBoardEntityTarget); },
    resolveFocusedBoardEntityContext: resolveFocusedBoardEntityContext
  };
})();
window.LexeraKeyboardNavigation = LexeraKeyboardNavigation;
