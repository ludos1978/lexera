var LexeraKeyboardNavigation = (function () {
  var focusedCardEl = null;
  var focusedBoardEntityEl = null;
  var focusedBoardEntityTimer = null;

  var _deps = null;

  function init(deps) {
    _deps = deps;
  }

  function handleKeyNavigation(e) {
    if (_deps.getIsEditing() || _deps.getSearchMode()) return;
    if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

    var key = e.key;
    if ((key === 'ArrowUp' || key === 'ArrowDown') && e.altKey && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);
      if (key === 'ArrowUp' && cj > 0) {
        _deps.moveCard(ci, cj, ci, cj - 1).then(function () {
          var moved = _deps.getElColumnsContainer().querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj - 1) + '"]');
          if (moved) focusCard(moved);
        });
      } else if (key === 'ArrowDown') {
        _deps.moveCard(ci, cj, ci, cj + 2).then(function () {
          var moved = _deps.getElColumnsContainer().querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj + 1) + '"]');
          if (moved) focusCard(moved);
        });
      }
    } else if ((key === 'ArrowLeft' || key === 'ArrowRight') && e.altKey && focusedCardEl) {
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
          var moved = _deps.getElColumnsContainer().querySelector('.card[data-col-index="' + targetColIdx + '"][data-card-index="0"]');
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
      _deps.openCardEditor(focusedCardEl, ci, cj, 'inline');
    } else if (key === 'Home' && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var first = _deps.getElColumnsContainer().querySelector('.card[data-col-index="' + ci + '"][data-card-index="0"]');
      if (first) focusCard(first);
    } else if (key === 'End' && focusedCardEl) {
      e.preventDefault();
      var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
      var colCards = _deps.getElColumnsContainer().querySelectorAll('.card[data-col-index="' + ci + '"]');
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
      var colNum = parseInt(key, 10) - 1;
      var columns = _deps.getActiveBoardColumns();
      if (colNum < columns.length) {
        e.preventDefault();
        var targetColIdx = columns[colNum].index;
        var firstCard = _deps.getElColumnsContainer().querySelector('.card[data-col-index="' + targetColIdx + '"][data-card-index="0"]');
        if (firstCard) focusCard(firstCard);
        else {
          var colEl = _deps.getElColumnsContainer().querySelector('.column[data-col-index="' + targetColIdx + '"]');
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
    var allCards = _deps.getElColumnsContainer().querySelectorAll('.card');
    if (allCards.length === 0) return;

    if (!focusedCardEl || !focusedCardEl.isConnected) {
      focusCard(allCards[0]);
      return;
    }

    var ci = parseInt(focusedCardEl.getAttribute('data-col-index'), 10);
    var cj = parseInt(focusedCardEl.getAttribute('data-card-index'), 10);

    if (key === 'ArrowDown') {
      var next = _deps.getElColumnsContainer().querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj + 1) + '"]');
      if (next) focusCard(next);
    } else if (key === 'ArrowUp') {
      if (cj > 0) {
        var prev = _deps.getElColumnsContainer().querySelector('.card[data-col-index="' + ci + '"][data-card-index="' + (cj - 1) + '"]');
        if (prev) focusCard(prev);
      }
    } else if (key === 'ArrowRight' || key === 'ArrowLeft') {
      var columns = _deps.getActiveBoardColumns();
      var colIndices = columns.map(function (c) { return c.index; });
      var curPos = colIndices.indexOf(ci);
      var targetPos = key === 'ArrowRight' ? curPos + 1 : curPos - 1;
      if (targetPos >= 0 && targetPos < colIndices.length) {
        var targetColIdx = colIndices[targetPos];
        var target = _deps.getElColumnsContainer().querySelector('.card[data-col-index="' + targetColIdx + '"][data-card-index="' + cj + '"]');
        if (!target) {
          var colCards = _deps.getElColumnsContainer().querySelectorAll('.card[data-col-index="' + targetColIdx + '"]');
          if (colCards.length > 0) target = colCards[colCards.length - 1];
        }
        if (target) focusCard(target);
      }
    }
  }

  function focusCard(cardEl) {
    unfocusCard();
    focusedCardEl = cardEl;
    cardEl.classList.add('focused');
    if (_deps.getCurrentArrowKeyFocusScrollMode() !== 'disabled') {
      cardEl.scrollIntoView({
        block: _deps.getCurrentArrowKeyFocusScrollMode() === 'center' ? 'center' : 'nearest',
        behavior: 'smooth'
      });
    }
    _deps.syncSidebarToView();
  }

  function unfocusCard() {
    if (focusedCardEl) {
      focusedCardEl.classList.remove('focused');
      focusedCardEl = null;
    }
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
    focusBoardEntity: focusBoardEntity,
    getFocusedCardEl: getFocusedCardEl
  };
})();
window.LexeraKeyboardNavigation = LexeraKeyboardNavigation;
