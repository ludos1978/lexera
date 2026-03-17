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

  function resolveParseOptionalSearchIndex(options) {
    if (options && typeof options.parseOptionalSearchIndex === 'function') {
      return options.parseOptionalSearchIndex;
    }
    if (typeof globalThis !== 'undefined' && globalThis.LexeraDashboardTree && typeof globalThis.LexeraDashboardTree.parseOptionalSearchIndex === 'function') {
      return globalThis.LexeraDashboardTree.parseOptionalSearchIndex;
    }
    return defaultParseOptionalSearchIndex;
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
    var parseOptionalSearchIndex = resolveParseOptionalSearchIndex(options);
    var resolvedBoardId = String(boardId || node.getAttribute('data-board-id') || '').trim();
    if (!resolvedBoardId) return null;

    var target = {
      boardId: resolvedBoardId
    };

    if (node.classList.contains('tree-row')) {
      target.rowIndex = parseOptionalSearchIndex(node.getAttribute('data-row-index'));
      return target;
    }
    if (node.classList.contains('tree-stack')) {
      target.rowIndex = parseOptionalSearchIndex(node.getAttribute('data-row-index'));
      target.stackIndex = parseOptionalSearchIndex(node.getAttribute('data-stack-index'));
      return target;
    }
    if (node.classList.contains('tree-column')) {
      target.rowIndex = parseOptionalSearchIndex(node.getAttribute('data-row-index'));
      target.stackIndex = parseOptionalSearchIndex(node.getAttribute('data-stack-index'));
      target.colLocalIndex = parseOptionalSearchIndex(node.getAttribute('data-col-local-index'));
      target.columnIndex = parseOptionalSearchIndex(node.getAttribute('data-col-index'));
      return target;
    }
    if (node.classList.contains('tree-card')) {
      target.rowIndex = parseOptionalSearchIndex(node.getAttribute('data-row-index'));
      target.stackIndex = parseOptionalSearchIndex(node.getAttribute('data-stack-index'));
      target.colLocalIndex = parseOptionalSearchIndex(node.getAttribute('data-col-local-index'));
      target.columnIndex = parseOptionalSearchIndex(node.getAttribute('data-col-index'));
      target.cardIndex = parseOptionalSearchIndex(node.getAttribute('data-card-index'));
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

    if (typeof result.rowIndex === 'number') {
      var rowEl = container.querySelector('.board-row[data-row-index="' + result.rowIndex + '"]');
      if (rowEl && rowEl.classList.contains('folded')) {
        rowEl.classList.remove('folded');
        changed = true;
      }
    }

    if (typeof result.rowIndex === 'number' && typeof result.stackIndex === 'number') {
      var stackSelector = '.board-stack[data-row-index="' + result.rowIndex + '"][data-stack-index="' + result.stackIndex + '"]';
      var stackEl = container.querySelector(stackSelector);
      if (stackEl && stackEl.classList.contains('folded')) {
        stackEl.classList.remove('folded');
        changed = true;
      }
    }

    if (typeof result.columnIndex === 'number') {
      var cardsEl = container.querySelector('.column-cards[data-col-index="' + result.columnIndex + '"]');
      var colEl = cardsEl && typeof cardsEl.closest === 'function' ? cardsEl.closest('.column') : null;
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

    if (!options.embeddedMode && options.splitViewMode !== 'single' && !options.skipSplitRouting) {
      var pane = typeof options.normalizeSplitPane === 'function'
        ? options.normalizeSplitPane(options.pane || options.activeSplitPane)
        : (options.pane || options.activeSplitPane);
      if (typeof options.selectBoard === 'function') {
        await options.selectBoard(target.boardId, { pane: pane });
      }
      if (typeof options.scheduleHierarchyFocusMessageToPane === 'function') {
        options.scheduleHierarchyFocusMessageToPane(pane, target);
      }
      return true;
    }

    if (getActiveBoardId(options) !== target.boardId && typeof options.selectBoard === 'function') {
      await options.selectBoard(target.boardId, { routeToPane: false });
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
    var cardId = result.cardId ? String(result.cardId) : '';
    if (cardId) {
      var byId = container.querySelector('.card[data-card-id="' + escapeAttr(cardId) + '"]');
      if (byId) {
        if (focusCard) focusCard(byId);
        return true;
      }
    }

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

      if (!options.embeddedMode && options.splitViewMode !== 'single') {
        if (typeof options.showNotification === 'function') {
          options.showNotification('Opened result board in active split view');
        }
        return;
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
