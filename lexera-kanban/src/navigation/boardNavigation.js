(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraBoardNavigation = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function defaultParseOptionalSearchIndex(value) {
    if (value == null || value === '') return null;
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }

  function resolveColumnsContainer(options) {
    if (options && typeof options.getColumnsContainer === 'function') return options.getColumnsContainer();
    return options && options.columnsContainer ? options.columnsContainer : null;
  }

  function getActiveBoardId(options) {
    if (options && typeof options.getActiveBoardId === 'function') return options.getActiveBoardId();
    return options ? options.activeBoardId : null;
  }

  function getActiveBoardData(options) {
    if (options && typeof options.getActiveBoardData === 'function') return options.getActiveBoardData();
    return options ? options.activeBoardData : null;
  }

  function buildHierarchyFocusTargetFromTreeNode(node, boardId, options) {
    if (!node || !node.getAttribute || !node.classList) return null;
    var parse = (options && typeof options.parseOptionalSearchIndex === 'function')
      ? options.parseOptionalSearchIndex
      : defaultParseOptionalSearchIndex;
    var resolvedBoardId = String(boardId || node.getAttribute('data-board-id') || '').trim();
    if (!resolvedBoardId) return null;

    function attr(name) { return parse(node.getAttribute(name)); }

    var target = { boardId: resolvedBoardId };
    var rowId = String(node.getAttribute('data-row-id') || '').trim();
    var stackId = String(node.getAttribute('data-stack-id') || '').trim();
    var columnId = String(node.getAttribute('data-column-id') || '').trim();
    if (rowId) target.rowId = rowId;
    if (stackId) target.stackId = stackId;
    if (columnId) target.columnId = columnId;

    if (node.classList.contains('tree-row')) {
      target.rowIndex = attr('data-row-index');
      return target;
    }
    if (node.classList.contains('tree-stack')) {
      target.rowIndex = attr('data-row-index');
      target.stackIndex = attr('data-stack-index');
      return target;
    }
    if (node.classList.contains('tree-column')) {
      target.rowIndex = attr('data-row-index');
      target.stackIndex = attr('data-stack-index');
      target.colLocalIndex = attr('data-col-local-index');
      target.columnIndex = attr('data-col-index');
      return target;
    }
    if (node.classList.contains('tree-card')) {
      target.rowIndex = attr('data-row-index');
      target.stackIndex = attr('data-stack-index');
      target.colLocalIndex = attr('data-col-local-index');
      target.columnIndex = attr('data-col-index');
      target.cardIndex = attr('data-card-index');
      var cardKid = String(node.getAttribute('data-card-kid') || '').trim();
      if (cardKid) target.cardKid = cardKid;
      var cardId = String(node.getAttribute('data-card-id') || '').trim();
      if (cardId) target.cardId = cardId;
      return target;
    }

    return null;
  }

  function unfoldSearchTarget(result, options) {
    var activeBoardId = getActiveBoardId(options);
    var container = resolveColumnsContainer(options);
    if (!result || !activeBoardId || !container) return false;
    var changed = false;

    var rowEl = null;
    if (result.rowId) {
      rowEl = container.querySelector('.board-row[data-row-id="' + result.rowId + '"]');
    }
    if (!rowEl && typeof result.rowIndex === 'number') {
      rowEl = container.querySelector('.board-row[data-row-index="' + result.rowIndex + '"]');
    }
    if (rowEl) {
      if (rowEl && rowEl.classList.contains('folded')) {
        rowEl.classList.remove('folded');
        changed = true;
      }
    }

    var stackEl = null;
    if (result.stackId) {
      stackEl = container.querySelector('.board-stack[data-stack-id="' + result.stackId + '"]');
    }
    if (!stackEl && typeof result.rowIndex === 'number' && typeof result.stackIndex === 'number') {
      var stackSelector = '.board-stack[data-row-index="' + result.rowIndex + '"][data-stack-index="' + result.stackIndex + '"]';
      stackEl = container.querySelector(stackSelector);
    }
    if (stackEl) {
      if (stackEl && stackEl.classList.contains('folded')) {
        stackEl.classList.remove('folded');
        changed = true;
      }
    }

    var colEl = null;
    if (result.columnId) {
      colEl = container.querySelector('.column[data-column-id="' + result.columnId + '"]');
    }
    if (!colEl && typeof result.columnIndex === 'number') {
      var cardsEl = container.querySelector('.column-cards[data-col-index="' + result.columnIndex + '"]');
      colEl = cardsEl && typeof cardsEl.closest === 'function' ? cardsEl.closest('.column') : null;
    }
    if (colEl) {
      if (colEl && colEl.classList.contains('folded')) {
        colEl.classList.remove('folded');
        changed = true;
      }
    }

    if (changed && options && typeof options.saveFoldState === 'function') {
      options.saveFoldState(activeBoardId);
    }
    return changed;
  }

  async function navigateToHierarchyTarget(target, options) {
    options = options || {};
    if (!target || !target.boardId) return false;

    if (getActiveBoardId(options) !== target.boardId && typeof options.selectBoard === 'function') {
      await options.selectBoard(target.boardId);
    }
    if ((getActiveBoardId(options) !== target.boardId || !getActiveBoardData(options)) && typeof options.loadBoard === 'function') {
      await options.loadBoard(target.boardId);
    }

    if (typeof options.unfoldSearchTarget === 'function') {
      options.unfoldSearchTarget(target);
    }
    return typeof options.focusHierarchyTargetLocally === 'function'
      ? options.focusHierarchyTargetLocally(target)
      : false;
  }

  function focusSearchResultCard(result, options) {
    options = options || {};
    var container = resolveColumnsContainer(options);
    if (!result || !container) return false;
    var escapeAttr = typeof options.escapeAttr === 'function'
      ? options.escapeAttr
      : function (value) { return String(value == null ? '' : value); };
    var focusCard = typeof options.focusCard === 'function' ? options.focusCard : null;
    
    // Priority 0: the persistent card kid. The dashboard / search dataset
    // can diverge from the live CRDT board (the Loro-assigned data-card-id
    // drifts across reloads/syncs), so matching the ephemeral cardId or a
    // positional index lands on a DIFFERENT card. The 8-char kid is stable
    // across parses/syncs (backend dashboard.rs reports it precisely for
    // this) — prefer it, mirroring the workspace focus path
    // (orderHelpers.findBoardEntityElement).
    var cardKid = result.cardKid ? String(result.cardKid) : '';
    if (cardKid) {
      var byKid = container.querySelector('.card[data-card-kid="' + escapeAttr(cardKid) + '"]');
      if (byKid) {
        if (focusCard) focusCard(byKid);
        return true;
      }
    }

    // Priority 1: Try to find by cardId first
    var cardId = result.cardId ? String(result.cardId) : '';
    if (cardId) {
      var byId = container.querySelector('.card[data-card-id="' + escapeAttr(cardId) + '"]');
      if (byId) {
        if (focusCard) focusCard(byId);
        return true;
      }
    }

    // Priority 2: Use cardIndex (visible index) if available - most reliable for broken includes
    if (typeof result.cardIndex === 'number' && typeof result.columnIndex === 'number') {
      var byIndex = container.querySelector('.card[data-col-index="' + result.columnIndex + '"][data-card-index="' + result.cardIndex + '"]');
      if (byIndex) {
        if (focusCard) focusCard(byIndex);
        return true;
      }
    }

    // Priority 3: Fall back to columnIndex + title matching
    if (typeof result.columnIndex === 'number') {
      var candidates = container.querySelectorAll('.card[data-col-index="' + result.columnIndex + '"]');
      if (candidates.length > 0) {
        var firstLine = String(result.cardContent || '').split('\n')[0].trim();
        for (var i = 0; i < candidates.length; i++) {
          var titleEl = candidates[i].querySelector('.card-title-display');
          var titleText = titleEl ? titleEl.textContent.trim() : '';
          if (firstLine && titleText === firstLine) {
            if (focusCard) focusCard(candidates[i]);
            return true;
          }
        }
        // If no title match, use the cardIndex as fallback position
        if (typeof result.cardIndex === 'number' && result.cardIndex < candidates.length) {
          if (focusCard) focusCard(candidates[result.cardIndex]);
          return true;
        }
        // Last resort: first card in column
        if (focusCard) focusCard(candidates[0]);
        return true;
      }
    }

    return false;
  }

  async function navigateToSearchResult(result, options) {
    options = options || {};
    if (!result || !result.boardId) return;
    if (options.searchInput) options.searchInput.value = '';
    if (typeof options.exitSearchMode === 'function') options.exitSearchMode();

    try {
      if (typeof options.selectBoard === 'function') {
        await options.selectBoard(result.boardId);
      }

      if ((getActiveBoardId(options) !== result.boardId || !getActiveBoardData(options)) && typeof options.loadBoard === 'function') {
        await options.loadBoard(result.boardId);
      }

      if (typeof options.unfoldSearchTarget === 'function') {
        options.unfoldSearchTarget(result);
      }
      if (typeof options.focusSearchResultCard === 'function' && !options.focusSearchResultCard(result)) {
        if (typeof options.showNotification === 'function') {
          options.showNotification('Opened board, but could not focus the exact card');
        }
      }
    } catch (err) {
      if (typeof options.lexeraLog === 'function') {
        options.lexeraLog('error', '[search.navigate] Failed to open search result: ' + err);
      }
      if (typeof options.showNotification === 'function') {
        options.showNotification('Failed to open search result');
      }
    }
  }

  return {
    buildHierarchyFocusTargetFromTreeNode: buildHierarchyFocusTargetFromTreeNode,
    unfoldSearchTarget: unfoldSearchTarget,
    navigateToHierarchyTarget: navigateToHierarchyTarget,
    focusSearchResultCard: focusSearchResultCard,
    navigateToSearchResult: navigateToSearchResult
  };
}));
