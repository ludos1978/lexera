var LexeraKeyboardNavigation = (function () {
  'use strict';
  var focusedCardEl = null;
  var focusedBoardEntityEl = null;
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
    } else if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
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
      if (!_deps.getFullBoardData || !_deps.reorderRows) return;
      var fbd = _deps.getFullBoardData();
      if (!fbd || !fbd.rows || fbd.rows.length < 2) return;
      e.preventDefault();
      var rowEls = columnsContainer ? columnsContainer.querySelectorAll('.board-row') : [];
      if (rowEls.length < 2) return;
      var focusedRowIdx = 0;
      if (focusedBoardEntityEl) {
        var rowEl = focusedBoardEntityEl.closest('.board-row');
        if (rowEl) {
          for (var ri = 0; ri < rowEls.length; ri++) {
            if (rowEls[ri] === rowEl) { focusedRowIdx = ri; break; }
          }
        }
      }
      var targetIdx = key === 'ArrowUp' ? focusedRowIdx - 1 : focusedRowIdx + 1;
      if (targetIdx >= 0 && targetIdx < rowEls.length) {
        _deps.reorderRows(focusedRowIdx, targetIdx, key === 'ArrowUp');
      }
    } else if ((key === 'ArrowLeft' || key === 'ArrowRight') && e.ctrlKey && e.altKey && !focusedCardEl) {
      // Ctrl+Alt+Left/Right: reorder stacks within a row, or columns within a stack
      if (!columnsContainer) return;
      e.preventDefault();
      var direction = key === 'ArrowLeft' ? -1 : 1;
      // Try to find a focused column or stack from focusedBoardEntityEl
      var focusedCol = focusedBoardEntityEl ? focusedBoardEntityEl.closest('.column') : null;
      var focusedStack = focusedBoardEntityEl ? focusedBoardEntityEl.closest('.board-stack') : null;
      if (!focusedCol && !focusedStack && focusedCardEl) {
        focusedCol = focusedCardEl.closest('.column');
        focusedStack = focusedCardEl.closest('.board-stack');
      }
      if (focusedCol && focusedStack && _deps.moveColumnWithinBoard) {
        // Reorder column within its stack
        var stackContent = focusedStack.querySelector('.board-stack-content');
        var cols = stackContent ? stackContent.querySelectorAll(':scope > .column') : [];
        if (cols.length < 2) return;
        var colIdx = Array.prototype.indexOf.call(cols, focusedCol);
        var targetColIdx = colIdx + direction;
        if (targetColIdx < 0 || targetColIdx >= cols.length) return;
        var rowIdx = parseInt(focusedStack.getAttribute('data-row-index'), 10);
        var stackIdx = parseInt(focusedStack.getAttribute('data-stack-index'), 10);
        _deps.moveColumnWithinBoard(rowIdx, stackIdx, colIdx, rowIdx, stackIdx, targetColIdx, direction < 0);
      } else if (focusedStack && _deps.moveStack) {
        // Reorder stack within its row
        var rowContent = focusedStack.closest('.board-row-content');
        var stacks = rowContent ? rowContent.querySelectorAll(':scope > .board-stack') : [];
        if (stacks.length < 2) return;
        var stackIdx = Array.prototype.indexOf.call(stacks, focusedStack);
        var targetStackIdx = stackIdx + direction;
        if (targetStackIdx < 0 || targetStackIdx >= stacks.length) return;
        var rowIdx = parseInt(focusedStack.getAttribute('data-row-index'), 10);
        _deps.moveStack(rowIdx, stackIdx, rowIdx, targetStackIdx, direction < 0);
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
    focusBoardEntity: focusBoardEntity,
    getFocusedCardEl: getFocusedCardEl
  };
})();
window.LexeraKeyboardNavigation = LexeraKeyboardNavigation;
