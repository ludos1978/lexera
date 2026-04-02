/**
 * DnD Listeners — pointer-based drag-and-drop event listeners for rows,
 * stacks, columns, boards, and cards, plus cross-board mutation helpers.
 *
 * Manages:
 *   - Sidebar tree-node mousedown (board list)
 *   - Board area mousedown (rows, stacks, columns, card grips)
 *   - Document mousemove/mouseup for card drag and pointer drag
 *   - Fold-button click delegation
 *   - Card click-to-select, double-click-to-edit
 *   - Delayed link click / double-click cancel
 *   - Window blur / visibilitychange safety net
 *   - Window resize canvas sync
 *   - resolveColumnLocationForMutation / resolveStackForMutation / resolveRowForMutation
 *   - moveRowAcrossBoards / moveStackAcrossBoards / moveColumnAcrossBoards
 *
 * Dependencies injected via init().
 */
var LexeraDndListeners = (function () {
  'use strict';

  var _deps = {};
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

  var DRAG_THRESHOLD = 5;
  var _linkClickTimer = null;

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      _rt = window.LexeraRuntime;
      _rt.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  // --- Dependency accessors ---
  function getElBoardList() { return _deps.getElBoardList(); }
  function getElColumnsContainer() { return _deps.getElColumnsContainer(); }
  function getActiveBoardId() { return _deps.getActiveBoardId(); }
  function getFullBoardData() { return _deps.getFullBoardData(); }
  function getDragDropHandlers() { return _deps.getDragDropHandlers(); }

  // --- Safe event binding ---
  function _on(el, event, handler) { if (el) el.addEventListener(event, handler); }

  // ── Event listener registration ──────────────────────────────────

  function bindAll() {
    _bindBoardListMousedown();
    _bindColumnsContainerClick();
    _bindCardClickToSelect();
    _bindDelayedLinkClick();
    _bindDblclickEdit();
    _bindColumnsContainerMousedown();
    _bindCardDragMousemoveMouseup();
    _bindPtrDragMousemoveMouseup();
    _bindSafetyNet();
    _bindResize();
  }

  function _bindBoardListMousedown() {
    _on(getElBoardList(), 'mousedown', function (e) {
      try {
      if (e.button !== 0) return;
      var DDH = getDragDropHandlers();
      var ptrDrag = DDH ? DDH.getPtrDrag() : null;
      var cardDrag = DDH ? DDH.getCardDrag() : null;
      if (ptrDrag || cardDrag) return;

      var grip = e.target.closest('.tree-grip');
      if (!grip) return;

      var treeNode = grip.closest('.tree-node[data-tree-drag]');
      if (treeNode) {
        var dragType = treeNode.getAttribute('data-tree-drag');
        var ownerBoardId = treeNode.getAttribute('data-board-id');
        if (!ownerBoardId) {
          var ownerWrapper = treeNode.closest('.board-item-wrapper');
          ownerBoardId = ownerWrapper ? ownerWrapper.getAttribute('data-board-id') : null;
        }
        var activeBoardId = getActiveBoardId();
        var source = { type: dragType, boardId: ownerBoardId || activeBoardId };
        if (dragType === 'tree-row') {
          source.rowIndex = parseInt(treeNode.getAttribute('data-row-index'), 10);
          source.indexMode = source.boardId === activeBoardId ? 'display' : 'full';
        } else if (dragType === 'tree-stack') {
          source.rowIndex = parseInt(treeNode.getAttribute('data-row-index'), 10);
          source.stackIndex = parseInt(treeNode.getAttribute('data-stack-index'), 10);
          source.indexMode = source.boardId === activeBoardId ? 'display' : 'full';
        } else if (dragType === 'tree-column') {
          source.rowIndex = parseInt(treeNode.getAttribute('data-row-index'), 10);
          source.stackIndex = parseInt(treeNode.getAttribute('data-stack-index'), 10);
          source.colIndex = parseInt(treeNode.getAttribute('data-col-local-index'), 10);
          source.indexMode = source.boardId === activeBoardId ? 'display' : 'full';
        } else if (dragType === 'tree-card') {
          source.rowIndex = parseInt(treeNode.getAttribute('data-row-index'), 10);
          source.stackIndex = parseInt(treeNode.getAttribute('data-stack-index'), 10);
          source.colIndex = parseInt(treeNode.getAttribute('data-col-local-index'), 10);
          source.flatColIndex = parseInt(treeNode.getAttribute('data-col-index'), 10);
          source.cardIndex = parseInt(treeNode.getAttribute('data-card-index'), 10);
          source.cardIndexMode = source.boardId === activeBoardId ? 'visible' : 'full';
          source.indexMode = source.boardId === activeBoardId ? 'display' : 'full';
        }
        var newPtrDrag = { type: dragType, source: source, startX: e.clientX, startY: e.clientY, startTopX: null, startTopY: null, started: false, ghost: null, el: treeNode };
        var treeStartTop = _deps.toTopFramePoint(window, e.clientX, e.clientY);
        if (treeStartTop) {
          newPtrDrag.startTopX = treeStartTop.x;
          newPtrDrag.startTopY = treeStartTop.y;
        }
        DDH.setPtrDrag(newPtrDrag);
        _deps.startCrossViewBridge('ptr');
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      var boardItem = grip.closest('.board-item[data-board-index][data-board-id]');
      if (boardItem) {
        var boardIndex = parseInt(boardItem.getAttribute('data-board-index'), 10);
        var boardId = String(boardItem.getAttribute('data-board-id') || '').trim();
        if (isNaN(boardIndex)) return;
        var newPtrDrag = { type: 'board', source: { type: 'board', index: boardIndex, boardId: boardId }, startX: e.clientX, startY: e.clientY, startTopX: null, startTopY: null, started: false, ghost: null, el: boardItem };
        var boardStartTop = _deps.toTopFramePoint(window, e.clientX, e.clientY);
        if (boardStartTop) {
          newPtrDrag.startTopX = boardStartTop.x;
          newPtrDrag.startTopY = boardStartTop.y;
        }
        DDH.setPtrDrag(newPtrDrag);
        _deps.startCrossViewBridge('ptr');
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      } catch (err) {
        logFrontendIssue('error', 'drag.ptr', 'Error in sidebar mousedown handler', err);
      }
    });
  }

  function _bindColumnsContainerClick() {
    _on(getElColumnsContainer(), 'click', function (e) {
      try {
        var columnFoldBtn = _deps.targetClosest(e.target, '.column-fold-btn');
        if (columnFoldBtn) {
          e.preventDefault();
          e.stopPropagation();
          _deps.toggleColumnFoldElement(_deps.targetClosest(columnFoldBtn, '.column'), !!e.altKey);
          return;
        }

        var stackFoldBtn = _deps.targetClosest(e.target, '.stack-fold-btn');
        if (stackFoldBtn) {
          e.preventDefault();
          e.stopPropagation();
          _deps.toggleStackFoldElement(_deps.targetClosest(stackFoldBtn, '.board-stack'), !!e.altKey);
          return;
        }

        var rowFoldBtn = _deps.targetClosest(e.target, '.row-fold-btn');
        if (rowFoldBtn) {
          e.preventDefault();
          e.stopPropagation();
          _deps.toggleRowFoldElement(_deps.targetClosest(rowFoldBtn, '.board-row'), !!e.altKey);
        }
      } catch (err) {
        logFrontendIssue('error', 'fold.click', 'Error in delegated fold click handler', err);
      }
    });
  }

  function _bindCardClickToSelect() {
    // Click on card → select it (Cmd/Ctrl+click toggles, Shift+click selects range)
    _on(getElColumnsContainer(), 'click', function (e) {
      try {
        if (e.target.closest('button, input, textarea, select, a, .card-menu-btn, .card-checkbox, .card-collapse-toggle, .column-fold-btn, .stack-fold-btn, .row-fold-btn, .card-drag-handle, .drag-grip')) return;
        var cardEl = e.target.closest('.card');
        if (cardEl && !cardEl.classList.contains('editing')) {
          if (e.shiftKey) {
            e.preventDefault(); // prevent text selection on shift+click
            _deps.selectCardRange(cardEl);
          } else if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            _deps.toggleCardSelection(cardEl);
          } else {
            _deps.selectCard(cardEl);
          }
          return;
        }
        // Click on empty area → clear selection
        if (!e.target.closest('.card, .column-header, .board-row-header, .board-stack-header')) {
          _deps.clearCardSelection();
          _deps.unfocusCard();
        }
      } catch (err) {
        logFrontendIssue('error', 'card.click-select', 'Error in delegated card click-to-select handler', err);
      }
    });
  }

  function _bindDelayedLinkClick() {
    // Delayed link click — single click opens link after 300ms, double-click cancels
    _on(getElColumnsContainer(), 'click', function (e) {
      var link = e.target.closest('.card-content a[href]');
      if (!link) return;
      e.preventDefault();
      if (_linkClickTimer) clearTimeout(_linkClickTimer);
      _linkClickTimer = setTimeout(function () {
        _linkClickTimer = null;
        var href = link.getAttribute('href');
        if (href) window.open(href, '_blank', 'noopener,noreferrer');
      }, 300);
    });
  }

  function _bindDblclickEdit() {
    // Double-click on card → open inline editor (cancels pending link click)
    // Double-click on column/row/stack title → start rename
    _on(getElColumnsContainer(), 'dblclick', function (e) {
      try {
        if (_linkClickTimer) { clearTimeout(_linkClickTimer); _linkClickTimer = null; }
        if (e.target.closest('button, input, textarea, select, .card-menu-btn, .card-checkbox, .card-collapse-toggle, .column-fold-btn, .stack-fold-btn, .row-fold-btn')) return;

        // Card content → edit
        var cardEl = e.target.closest('.card');
        if (cardEl && !cardEl.classList.contains('editing')) {
          var colIndex = parseInt(cardEl.getAttribute('data-col-index'), 10);
          var cardIndex = parseInt(cardEl.getAttribute('data-card-index'), 10);
          if (!isNaN(colIndex) && !isNaN(cardIndex)) {
            e.stopPropagation();
            _deps.openCardEditor(cardEl, colIndex, cardIndex, _deps.isOverlayEditorEnabled() ? 'overlay' : 'inline');
          }
          return;
        }

        // Column title → rename
        var colTitle = e.target.closest('.column-title');
        if (colTitle) {
          var colEl = colTitle.closest('.column');
          if (!colEl) return;
          var colCardsEl = colEl.querySelector('.column-cards[data-col-index]');
          var cIdx = colCardsEl ? parseInt(colCardsEl.getAttribute('data-col-index'), 10) : NaN;
          if (!isNaN(cIdx)) _deps.enterColumnRename(colEl, cIdx);
          return;
        }

        // Row title → rename
        var rowTitle = e.target.closest('.board-row-title');
        if (rowTitle) {
          var rowEl = rowTitle.closest('.board-row');
          if (!rowEl) return;
          var rowIdx = parseInt(rowEl.getAttribute('data-row-index'), 10);
          if (!isNaN(rowIdx)) _deps.renameRowOrStack('row', rowIdx);
          return;
        }

        // Stack title → rename
        var stackTitle = e.target.closest('.board-stack-title');
        if (stackTitle) {
          var stackEl = stackTitle.closest('.board-stack');
          if (!stackEl) return;
          var rIdx = parseInt(stackEl.getAttribute('data-row-index'), 10);
          var sIdx = parseInt(stackEl.getAttribute('data-stack-index'), 10);
          if (!isNaN(rIdx) && !isNaN(sIdx)) _deps.renameRowOrStack('stack', rIdx, sIdx);
          return;
        }
      } catch (err) {
        logFrontendIssue('error', 'dblclick-edit', 'Error in delegated double-click edit handler', err);
      }
    });
  }

  function _bindColumnsContainerMousedown() {
    _on(getElColumnsContainer(), 'mousedown', function (e) {
      try {
      if (e.button !== 0) return;
      var DDH = getDragDropHandlers();
      var ptrDrag = DDH ? DDH.getPtrDrag() : null;
      var cardDrag = DDH ? DDH.getCardDrag() : null;
      if (ptrDrag || cardDrag) return;
      if (e.target.closest('.board-row-title, .board-stack-title, .column-title')) return;
      if (e.target.closest('button, input, textarea, select, a, .column-rename-input, .card-menu-btn, .card-collapse-toggle, .card-checkbox')) {
        return;
      }

      var activeBoardId = getActiveBoardId();

      var rowHeader = e.target.closest('.board-row-header');
      if (rowHeader) {
        var rowEl = rowHeader.closest('.board-row');
        var rowIdx = parseInt(rowEl.getAttribute('data-row-index'), 10);
        var newPtrDrag = { type: 'board-row', source: { type: 'board-row', boardId: activeBoardId, rowIndex: rowIdx, indexMode: 'display' }, startX: e.clientX, startY: e.clientY, startTopX: null, startTopY: null, started: false, ghost: null, el: rowEl };
        var rowStartTop = _deps.toTopFramePoint(window, e.clientX, e.clientY);
        if (rowStartTop) {
          newPtrDrag.startTopX = rowStartTop.x;
          newPtrDrag.startTopY = rowStartTop.y;
        }
        DDH.setPtrDrag(newPtrDrag);
        _deps.startCrossViewBridge('ptr');
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      var stackHeader = e.target.closest('.board-stack-header');
      if (stackHeader) {
        var stackEl = stackHeader.closest('.board-stack');
        var rowIdx = parseInt(stackEl.getAttribute('data-row-index'), 10);
        var stackIdx = parseInt(stackEl.getAttribute('data-stack-index'), 10);
        var stackRect = stackEl.getBoundingClientRect();
        var rowContentEl = stackEl.closest('.board-row-content');
        var newPtrDrag = {
          type: 'board-stack',
          source: { type: 'board-stack', boardId: activeBoardId, rowIndex: rowIdx, stackIndex: stackIdx, indexMode: 'display' },
          startX: e.clientX,
          startY: e.clientY,
          startTopX: null,
          startTopY: null,
          started: false,
          ghost: null,
          el: stackEl,
          grabOffsetX: e.clientX - stackRect.left,
          grabOffsetY: e.clientY - stackRect.top,
          canvasSourceRowContent: rowContentEl || null
        };
        var stackStartTop = _deps.toTopFramePoint(window, e.clientX, e.clientY);
        if (stackStartTop) {
          newPtrDrag.startTopX = stackStartTop.x;
          newPtrDrag.startTopY = stackStartTop.y;
        }
        DDH.setPtrDrag(newPtrDrag);
        _deps.startCrossViewBridge('ptr');
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      var columnHeader = e.target.closest('.column-header');
      if (columnHeader) {
        var colEl = columnHeader.closest('.column');
        var stackEl = colEl.closest('.board-stack');
        var rowIdx = parseInt(stackEl.getAttribute('data-row-index'), 10);
        var stackIdx = parseInt(stackEl.getAttribute('data-stack-index'), 10);
        var columns = stackEl.querySelectorAll('.board-stack-content > .column');
        var colIdx = Array.prototype.indexOf.call(columns, colEl);
        var newPtrDrag = {
          type: 'column',
          source: {
            type: 'column',
            boardId: activeBoardId,
            rowIndex: rowIdx,
            stackIndex: stackIdx,
            colIndex: colIdx,
            indexMode: 'display'
          },
          startX: e.clientX,
          startY: e.clientY,
          startTopX: null,
          startTopY: null,
          started: false,
          ghost: null,
          el: colEl
        };
        var colStartTop = _deps.toTopFramePoint(window, e.clientX, e.clientY);
        if (colStartTop) {
          newPtrDrag.startTopX = colStartTop.x;
          newPtrDrag.startTopY = colStartTop.y;
        }
        DDH.setPtrDrag(newPtrDrag);
        _deps.startCrossViewBridge('ptr');
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Card drag: initiated from the card drag handle or the card header row
      var cardGrip = e.target.closest('.card-drag-handle, .drag-grip');
      if (cardGrip) {
        var cardEl = cardGrip.closest('.card');
        if (cardEl) {
          var colEl = cardEl.closest('.column');
          var stackEl = colEl ? colEl.closest('.board-stack') : null;
          var flatColIndex = colEl ? parseInt(colEl.getAttribute('data-col-index'), 10) : -1;
          var colLocalIndex = colEl ? parseInt(colEl.getAttribute('data-col-local-index'), 10) : -1;
          var rowIdx = stackEl ? parseInt(stackEl.getAttribute('data-row-index'), 10) : -1;
          var stackIdx = stackEl ? parseInt(stackEl.getAttribute('data-stack-index'), 10) : -1;
          var visibleCards = colEl ? colEl.querySelectorAll('.column-cards > .card:not(.hidden-card)') : [];
          var cardIdx = Array.prototype.indexOf.call(visibleCards, cardEl);

          DDH.setCardDrag({
            el: cardEl,
            boardId: activeBoardId,
            flatColIndex: flatColIndex,
            colIndex: colLocalIndex,
            rowIndex: rowIdx,
            stackIndex: stackIdx,
            cardIndex: cardIdx,
            startX: e.clientX,
            startY: e.clientY,
            started: false,
            ghost: null
          });
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      } catch (err) {
        logFrontendIssue('error', 'drag.ptr', 'Error in board mousedown handler', err);
      }
    });
  }

  function _bindCardDragMousemoveMouseup() {
    // Card drag: mousemove + mouseup
    document.addEventListener('mousemove', function (e) {
      var DDH = getDragDropHandlers();
      var cd = DDH ? DDH.getCardDrag() : null;
      if (!cd) return;
      if (!cd.started) {
        var dx = e.clientX - cd.startX;
        var dy = e.clientY - cd.startY;
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        cd.started = true;
        _deps.startCardDrag(e);
      }
      if (cd.ghost) {
        cd.ghost.style.left = (e.clientX + 8) + 'px';
        cd.ghost.style.top = (e.clientY - 12) + 'px';
      }
      if (DDH.updateCardDropTarget) DDH.updateCardDropTarget(e.clientX, e.clientY);
    });
    document.addEventListener('mouseup', function (e) {
      var DDH = getDragDropHandlers();
      var cd = DDH ? DDH.getCardDrag() : null;
      if (!cd) return;
      if (!cd.started) {
        DDH.setCardDrag(null);
        return;
      }
      _deps.finishCardDrag(e.clientX, e.clientY);
      _deps.cleanupCardDrag();
    });
  }

  function _bindPtrDragMousemoveMouseup() {
    // Pointer drag: mousemove
    document.addEventListener('mousemove', function (e) {
      var DDH = getDragDropHandlers();
      var ptrDrag = DDH ? DDH.getPtrDrag() : null;
      if (!ptrDrag) return;
      try {
      if (!ptrDrag.started) {
        var dx = e.clientX - ptrDrag.startX;
        var dy = e.clientY - ptrDrag.startY;
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        ptrDrag.started = true;
        if (ptrDrag.type === 'board-stack' && _deps.isCanvasBoardLayout()) {
          ptrDrag.canvasMove = true;
          ptrDrag.el.classList.add('dragging');
          ptrDrag.el.style.pointerEvents = 'none';
          ptrDrag.el.style.zIndex = '100';
          var sel = window.getSelection();
          if (sel) sel.removeAllRanges();
          return;
        }
        _deps.vsMaterialiseAll();
        ptrDrag.el.classList.add('dragging');
        var lockableDragType =
          ptrDrag.type === 'board-row' ||
          ptrDrag.type === 'tree-row' ||
          ptrDrag.type === 'board-stack' ||
          ptrDrag.type === 'tree-stack' ||
          ptrDrag.type === 'column' ||
          ptrDrag.type === 'tree-column' ||
          ptrDrag.type === 'tree-card';
        if (lockableDragType) {
          _deps.lockBoardLayoutForDrag();
        }
        _deps.startCrossViewBridge('ptr');
        if (ptrDrag.type === 'column' || ptrDrag.type === 'tree-column') {
          _deps.insertStackDropZones();
        }
        _deps.insertDropZoneIndicators(ptrDrag.type);
        _deps.cacheDropTargetGeometry();

        var ghost = document.createElement('div');
        ghost.className = 'card-drag-ghost';
        ghost.textContent = _deps.getPtrDragLabel();
        ghost.style.left = (e.clientX + 8) + 'px';
        ghost.style.top = (e.clientY - 12) + 'px';
        document.body.appendChild(ghost);
        ptrDrag.ghost = ghost;

        var sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      }

      if (ptrDrag.canvasMove) {
        _deps.clearPtrDropIndicators();
        var canvasHeaderTag = _deps.resolveHeaderDropTag(e.clientX, e.clientY);
        var canvasRowTarget;
        if (canvasHeaderTag) {
          var canvasHeaderBtnId = canvasHeaderTag === '#hidden-internal-incoming' ? 'btn-incoming'
            : canvasHeaderTag === '#hidden-internal-parked' ? 'btn-parked'
            : canvasHeaderTag === '#hidden-internal-archived' ? 'btn-archived' : 'btn-trash';
          var canvasHeaderBtn = document.getElementById(canvasHeaderBtnId);
          if (canvasHeaderBtn) canvasHeaderBtn.classList.add('drop-target');
        } else {
          canvasRowTarget = _deps.resolveCanvasRowContentDropTarget(e.clientX, e.clientY);
          if (canvasRowTarget && canvasRowTarget.node) canvasRowTarget.node.classList.add('drop-target');
        }

        var activeCanvasRowContent = _deps.getCanvasRowContentNodeFromDropTarget(
          canvasRowTarget,
          ptrDrag.canvasSourceRowContent || ptrDrag.el.closest('.board-row-content')
        );
        if (!activeCanvasRowContent) return;
        var nextCanvasPos = _deps.getCanvasDropPositionInRowContent(
          activeCanvasRowContent,
          e.clientX,
          e.clientY,
          ptrDrag.grabOffsetX,
          ptrDrag.grabOffsetY
        );
        ptrDrag.el.style.left = Math.round(nextCanvasPos.x) + 'px';
        ptrDrag.el.style.top = Math.round(nextCanvasPos.y) + 'px';
        return;
      }

      if (ptrDrag.ghost) {
        ptrDrag.ghost.style.left = (e.clientX + 8) + 'px';
        ptrDrag.ghost.style.top = (e.clientY - 12) + 'px';
      }

      _deps.updatePtrDropTarget(e.clientX, e.clientY);
      } catch (err) {
        logFrontendIssue('error', 'drag.ptr', 'Error in ptr mousemove handler', err);
        _deps.cleanupPtrDrag();
      }
    });

    // Pointer drag: mouseup
    document.addEventListener('mouseup', function (e) {
      var DDH = getDragDropHandlers();
      var ptrDrag = DDH ? DDH.getPtrDrag() : null;
      if (!ptrDrag) return;
      try {
      if (!ptrDrag.started) {
        DDH.setPtrDrag(null);
        _deps.stopCrossViewBridge();
        return;
      }
      // If the drop lands on an iframe, let the cross-view bridge handle it
      var hitEl = document.elementFromPoint(e.clientX, e.clientY);
      if (hitEl && hitEl.tagName === 'IFRAME') {
        return;
      }
      _deps.executePtrDrop(e.clientX, e.clientY);
      _deps.cleanupPtrDrag();
      } catch (err) {
        logFrontendIssue('error', 'drag.ptr', 'Error in ptr mouseup handler', err);
        _deps.cleanupPtrDrag();
      }
    });
  }

  function _bindSafetyNet() {
    // Safety net for interrupted drags (window focus loss, tab hide).
    window.addEventListener('blur', function () {
      var DDH = getDragDropHandlers();
      var ptrDrag = DDH ? DDH.getPtrDrag() : null;
      var dragLayoutLocks = DDH ? DDH.getDragLayoutLocks() : null;
      if (ptrDrag || dragLayoutLocks) {
        var wasCanvas = ptrDrag && ptrDrag.canvasMove;
        _deps.cleanupPtrDrag();
        if (wasCanvas) _deps.renderColumns();
      }
    });
    document.addEventListener('visibilitychange', function () {
      var DDH = getDragDropHandlers();
      var ptrDrag = DDH ? DDH.getPtrDrag() : null;
      var dragLayoutLocks = DDH ? DDH.getDragLayoutLocks() : null;
      if (document.visibilityState === 'hidden' && (ptrDrag || dragLayoutLocks)) {
        var wasCanvas = ptrDrag && ptrDrag.canvasMove;
        _deps.cleanupPtrDrag();
        if (wasCanvas) _deps.renderColumns();
      }
    });
  }

  function _bindResize() {
    window.addEventListener('resize', function () {
      if (!_deps.isCanvasBoardLayout()) return;
      var container = getElColumnsContainer();
      if (!container) return;
      _deps.scheduleCanvasRowBoundsSync(container);
      _deps.scheduleCanvasFocusStacksControlSync(container);
    });
  }

  // ── Cross-board mutation helpers ─────────────────────────────────

  function resolveColumnLocationForMutation(boardId, boardData, rowIndex, stackIndex, colIndex, indexMode) {
    if (!boardData || !boardData.rows) return null;
    if (indexMode === 'display' && boardId === getActiveBoardId()) {
      var row = _deps.findFullDataRow(rowIndex);
      var stack = _deps.findFullDataStack(rowIndex, stackIndex);
      if (!row || !stack) return null;
      var fullColIdx = _deps.findFullColumnIndexInStack(stack, colIndex);
      if (fullColIdx === -1) return null;
      return {
        row: row,
        stack: stack,
        rowIndex: getFullBoardData().rows.indexOf(row),
        stackIndex: row.stacks.indexOf(stack),
        colIndex: fullColIdx
      };
    }
    if (indexMode === 'display') {
      var displayRow = boardData.rows[rowIndex];
      if (!displayRow || !displayRow.stacks || stackIndex < 0 || stackIndex >= displayRow.stacks.length) return null;
      var displayStack = displayRow.stacks[stackIndex];
      if (!displayStack || !displayStack.columns) return null;
      var mappedColIdx = _deps.findFullColumnIndexInStack(displayStack, colIndex);
      if (mappedColIdx === -1) return null;
      return {
        row: displayRow,
        stack: displayStack,
        rowIndex: rowIndex,
        stackIndex: stackIndex,
        colIndex: mappedColIdx
      };
    }
    var targetRow = boardData.rows[rowIndex];
    if (!targetRow || !targetRow.stacks || stackIndex < 0 || stackIndex >= targetRow.stacks.length) return null;
    var targetStack = targetRow.stacks[stackIndex];
    if (!targetStack || !targetStack.columns || colIndex < 0 || colIndex >= targetStack.columns.length) return null;
    return {
      row: targetRow,
      stack: targetStack,
      rowIndex: rowIndex,
      stackIndex: stackIndex,
      colIndex: colIndex
    };
  }

  function resolveStackForMutation(boardId, boardData, rowIndex, stackIndex, indexMode) {
    if (!boardData || !boardData.rows) return null;
    if (indexMode === 'display' && boardId === getActiveBoardId()) {
      var row = _deps.findFullDataRow(rowIndex);
      var stack = _deps.findFullDataStack(rowIndex, stackIndex);
      if (!row || !stack) return null;
      return {
        row: row,
        stack: stack,
        rowIndex: getFullBoardData().rows.indexOf(row),
        stackIndex: row.stacks.indexOf(stack)
      };
    }
    var targetRow = boardData.rows[rowIndex];
    if (!targetRow || !targetRow.stacks || stackIndex < 0 || stackIndex >= targetRow.stacks.length) return null;
    return {
      row: targetRow,
      stack: targetRow.stacks[stackIndex],
      rowIndex: rowIndex,
      stackIndex: stackIndex
    };
  }

  function resolveRowForMutation(boardId, boardData, rowIndex, indexMode) {
    if (!boardData || !boardData.rows) return null;
    if (indexMode === 'display' && boardId === getActiveBoardId()) {
      var row = _deps.findFullDataRow(rowIndex);
      if (!row) return null;
      return { row: row, rowIndex: getFullBoardData().rows.indexOf(row) };
    }
    if (rowIndex < 0 || rowIndex >= boardData.rows.length) return null;
    return { row: boardData.rows[rowIndex], rowIndex: rowIndex };
  }

  async function moveRowAcrossBoards(source, target) {
    if (!source || !target || !source.boardId || !target.boardId) return;

    var sourceBoardId = source.boardId;
    var targetBoardId = target.boardId;
    var sourceBoardData = await _deps.loadBoardDataForMutation(sourceBoardId);
    if (!sourceBoardData) return;
    var targetBoardData = sourceBoardId === targetBoardId
      ? sourceBoardData
      : await _deps.loadBoardDataForMutation(targetBoardId);
    if (!targetBoardData) return;

    var sourceRowInfo = resolveRowForMutation(
      sourceBoardId,
      sourceBoardData,
      source.rowIndex,
      source.indexMode || 'full'
    );
    if (!sourceRowInfo || !sourceRowInfo.row) return;

    var targetRowInfo = resolveRowForMutation(
      targetBoardId,
      targetBoardData,
      target.rowIndex,
      target.indexMode || 'full'
    );

    var activeTouched = sourceBoardId === getActiveBoardId() || targetBoardId === getActiveBoardId();
    if (activeTouched && getFullBoardData()) _deps.pushUndo();

    var movedRow = sourceBoardData.rows.splice(sourceRowInfo.rowIndex, 1)[0];
    if (!movedRow) return;

    var insertAt = targetBoardData.rows.length;
    if (targetRowInfo && targetRowInfo.row) {
      insertAt = target.before ? targetRowInfo.rowIndex : (targetRowInfo.rowIndex + 1);
      if (sourceBoardData === targetBoardData && sourceRowInfo.rowIndex < insertAt) insertAt--;
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > targetBoardData.rows.length) insertAt = targetBoardData.rows.length;

    if (sourceBoardData === targetBoardData && insertAt === sourceRowInfo.rowIndex) {
      sourceBoardData.rows.splice(sourceRowInfo.rowIndex, 0, movedRow);
      return;
    }

    targetBoardData.rows.splice(insertAt, 0, movedRow);

    _deps.removeEmptyStacksAndRowsInBoard(sourceBoardData);
    if (sourceBoardData !== targetBoardData) _deps.removeEmptyStacksAndRowsInBoard(targetBoardData);

    var changedRows = {};
    changedRows[sourceBoardId] = sourceBoardData;
    if (targetBoardId !== sourceBoardId) changedRows[targetBoardId] = targetBoardData;
    await _deps.commitBoardMutations(changedRows, { refreshSidebar: true });
  }

  async function moveStackAcrossBoards(source, target) {
    if (!source || !target || !source.boardId || !target.boardId) return;

    var sourceBoardId = source.boardId;
    var targetBoardId = target.boardId;
    var sourceBoardData = await _deps.loadBoardDataForMutation(sourceBoardId);
    if (!sourceBoardData) return;
    var targetBoardData = sourceBoardId === targetBoardId
      ? sourceBoardData
      : await _deps.loadBoardDataForMutation(targetBoardId);
    if (!targetBoardData) return;

    var sourceStackInfo = resolveStackForMutation(
      sourceBoardId,
      sourceBoardData,
      source.rowIndex,
      source.stackIndex,
      source.indexMode || 'full'
    );
    if (!sourceStackInfo || !sourceStackInfo.stack || !sourceStackInfo.row) return;

    var activeTouched = sourceBoardId === getActiveBoardId() || targetBoardId === getActiveBoardId();
    var targetRowInfo = null;
    if (target.kind !== 'new-row') {
      targetRowInfo = resolveRowForMutation(
        targetBoardId,
        targetBoardData,
        target.rowIndex,
        target.indexMode || 'full'
      );
    }
    if (
      target.kind === 'row' &&
      targetRowInfo &&
      targetRowInfo.row &&
      sourceBoardData === targetBoardData &&
      sourceStackInfo.row === targetRowInfo.row &&
      target.canvasPosition
    ) {
      if (activeTouched && getFullBoardData()) _deps.pushUndo();
      _deps.getCanvasStackDropApi().applyCanvasDropPositionToStack(
        targetBoardId,
        getActiveBoardId(),
        _deps.isCanvasBoardLayout(),
        target,
        sourceStackInfo.stack
      );
      var changedCanvasPlacement = {};
      changedCanvasPlacement[sourceBoardId] = sourceBoardData;
      await _deps.commitBoardMutations(changedCanvasPlacement, { refreshSidebar: true });
      return;
    }
    if (activeTouched && getFullBoardData()) _deps.pushUndo();

    var movedStack = sourceStackInfo.row.stacks.splice(sourceStackInfo.stackIndex, 1)[0];
    if (!movedStack) return;
    _deps.getCanvasStackDropApi().applyCanvasDropPositionToStack(
      targetBoardId,
      getActiveBoardId(),
      _deps.isCanvasBoardLayout(),
      target,
      movedStack
    );

    if (target.kind === 'new-row') {
      _deps.insertUnnamedRowForMutation(targetBoardId, targetBoardData, target, [movedStack]);
      _deps.removeEmptyStacksAndRowsInBoard(sourceBoardData);
      if (sourceBoardData !== targetBoardData) _deps.removeEmptyStacksAndRowsInBoard(targetBoardData);
      var changedNewRows = {};
      changedNewRows[sourceBoardId] = sourceBoardData;
      if (targetBoardId !== sourceBoardId) changedNewRows[targetBoardId] = targetBoardData;
      await _deps.commitBoardMutations(changedNewRows, { refreshSidebar: true });
      return;
    }

    if (!targetRowInfo || !targetRowInfo.row || !targetRowInfo.row.stacks) {
      sourceStackInfo.row.stacks.splice(sourceStackInfo.stackIndex, 0, movedStack);
      return;
    }

    if (target.kind === 'row') {
      targetRowInfo.row.stacks.push(movedStack);
      _deps.removeEmptyStacksAndRowsInBoard(sourceBoardData);
      if (sourceBoardData !== targetBoardData) _deps.removeEmptyStacksAndRowsInBoard(targetBoardData);
      var changedRows = {};
      changedRows[sourceBoardId] = sourceBoardData;
      if (targetBoardId !== sourceBoardId) changedRows[targetBoardId] = targetBoardData;
      await _deps.commitBoardMutations(changedRows, { refreshSidebar: true });
      return;
    }

    var targetStackInfo = resolveStackForMutation(
      targetBoardId,
      targetBoardData,
      target.rowIndex,
      target.stackIndex,
      target.indexMode || 'full'
    );

    var insertAt = targetRowInfo.row.stacks.length;
    if (targetStackInfo && targetStackInfo.stack) {
      insertAt = target.before ? targetStackInfo.stackIndex : (targetStackInfo.stackIndex + 1);
      if (sourceBoardData === targetBoardData && sourceStackInfo.row === targetRowInfo.row && sourceStackInfo.stackIndex < insertAt) {
        insertAt--;
      }
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > targetRowInfo.row.stacks.length) insertAt = targetRowInfo.row.stacks.length;

    if (sourceBoardData === targetBoardData && sourceStackInfo.row === targetRowInfo.row && insertAt === sourceStackInfo.stackIndex) {
      sourceStackInfo.row.stacks.splice(sourceStackInfo.stackIndex, 0, movedStack);
      return;
    }

    targetRowInfo.row.stacks.splice(insertAt, 0, movedStack);

    _deps.removeEmptyStacksAndRowsInBoard(sourceBoardData);
    if (sourceBoardData !== targetBoardData) _deps.removeEmptyStacksAndRowsInBoard(targetBoardData);

    var changedStacks = {};
    changedStacks[sourceBoardId] = sourceBoardData;
    if (targetBoardId !== sourceBoardId) changedStacks[targetBoardId] = targetBoardData;
    await _deps.commitBoardMutations(changedStacks, { refreshSidebar: true });
  }

  async function moveColumnAcrossBoards(source, target) {
    if (!source || !target || !source.boardId || !target.boardId) { lexeraLogWithTarget('warn', 'COL-XBOARD', 'abort: missing source/target boardId'); return; }

    var sourceBoardId = source.boardId;
    var targetBoardId = target.boardId;
    var sourceBoardData = await _deps.loadBoardDataForMutation(sourceBoardId);
    if (!sourceBoardData) { lexeraLogWithTarget('warn', 'COL-XBOARD', 'abort: no sourceBoardData'); return; }
    var targetBoardData = sourceBoardId === targetBoardId
      ? sourceBoardData
      : await _deps.loadBoardDataForMutation(targetBoardId);
    if (!targetBoardData) { lexeraLogWithTarget('warn', 'COL-XBOARD', 'abort: no targetBoardData'); return; }

    var sourceLoc = resolveColumnLocationForMutation(
      sourceBoardId,
      sourceBoardData,
      source.rowIndex,
      source.stackIndex,
      source.colIndex,
      source.indexMode || 'full'
    );
    if (!sourceLoc || !sourceLoc.stack || !sourceLoc.stack.columns) { lexeraLogWithTarget('warn', 'COL-XBOARD', 'abort: sourceLoc not resolved'); return; }

    var activeTouched = sourceBoardId === getActiveBoardId() || targetBoardId === getActiveBoardId();
    if (activeTouched && getFullBoardData()) _deps.pushUndo();

    var movedColumn = sourceLoc.stack.columns.splice(sourceLoc.colIndex, 1)[0];
    if (!movedColumn) return;

    var insertStack = null;
    var insertAt = 0;

    if (target.kind === 'new-row') {
      var insertedRow = _deps.insertUnnamedRowForMutation(
        targetBoardId,
        targetBoardData,
        target,
        [_deps.createUnnamedStackForMutation([movedColumn])]
      );
      if (!insertedRow || !insertedRow.row) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
      _deps.removeEmptyStacksAndRowsInBoard(sourceBoardData);
      if (sourceBoardData !== targetBoardData) _deps.removeEmptyStacksAndRowsInBoard(targetBoardData);
      var changedNewRows = {};
      changedNewRows[sourceBoardId] = sourceBoardData;
      if (targetBoardId !== sourceBoardId) changedNewRows[targetBoardId] = targetBoardData;
      await _deps.commitBoardMutations(changedNewRows, { refreshSidebar: true });
      return;
    }

    if (target.kind === 'row') {
      var insertedStackInfo = _deps.insertUnnamedStackIntoRowForMutation(targetBoardId, targetBoardData, target);
      if (!insertedStackInfo || !insertedStackInfo.stack) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
      if (!insertedStackInfo.stack.columns) insertedStackInfo.stack.columns = [];
      insertedStackInfo.stack.columns.push(movedColumn);
      _deps.removeEmptyStacksAndRowsInBoard(sourceBoardData);
      if (sourceBoardData !== targetBoardData) _deps.removeEmptyStacksAndRowsInBoard(targetBoardData);
      var changedNewStacks = {};
      changedNewStacks[sourceBoardId] = sourceBoardData;
      if (targetBoardId !== sourceBoardId) changedNewStacks[targetBoardId] = targetBoardData;
      await _deps.commitBoardMutations(changedNewStacks, { refreshSidebar: true });
      return;
    }

    if (target.kind === 'new-stack') {
      var targetRowInfo = resolveRowForMutation(
        targetBoardId,
        targetBoardData,
        target.rowIndex,
        target.indexMode || 'full'
      );
      if (!targetRowInfo || !targetRowInfo.row || !targetRowInfo.row.stacks) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
      var newStack = {
        id: 'stack-' + Date.now(),
        title: '',
        columns: [movedColumn]
      };
      var stackInsertIdx;
      if (typeof target.insertAtStackIdx === 'number' && (target.indexMode || 'full') === 'display' && targetBoardId === getActiveBoardId()) {
        stackInsertIdx = _deps.findInsertStackIndexInRow(targetRowInfo.row, target.rowIndex, target.insertAtStackIdx);
      } else if (typeof target.insertAtStackIdx === 'number') {
        stackInsertIdx = target.insertAtStackIdx;
      } else {
        stackInsertIdx = targetRowInfo.row.stacks.length;
      }
      if (stackInsertIdx < 0) stackInsertIdx = 0;
      if (stackInsertIdx > targetRowInfo.row.stacks.length) stackInsertIdx = targetRowInfo.row.stacks.length;
      targetRowInfo.row.stacks.splice(stackInsertIdx, 0, newStack);
      _deps.removeEmptyStacksAndRowsInBoard(sourceBoardData);
      if (sourceBoardData !== targetBoardData) _deps.removeEmptyStacksAndRowsInBoard(targetBoardData);
      var changedNewStackBoards = {};
      changedNewStackBoards[sourceBoardId] = sourceBoardData;
      if (targetBoardId !== sourceBoardId) changedNewStackBoards[targetBoardId] = targetBoardData;
      await _deps.commitBoardMutations(changedNewStackBoards, { refreshSidebar: true });
      return;
    }

    if (target.kind === 'stack') {
      var targetStackInfo = resolveStackForMutation(
        targetBoardId,
        targetBoardData,
        target.rowIndex,
        target.stackIndex,
        target.indexMode || 'full'
      );
      if (!targetStackInfo || !targetStackInfo.stack || !targetStackInfo.stack.columns) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
      insertStack = targetStackInfo.stack;
      insertAt = insertStack.columns.length;
    } else if (target.kind === 'column') {
      var targetStackForCol = resolveStackForMutation(
        targetBoardId,
        targetBoardData,
        target.rowIndex,
        target.stackIndex,
        target.indexMode || 'full'
      );
      if (!targetStackForCol || !targetStackForCol.stack || !targetStackForCol.stack.columns) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
      insertStack = targetStackForCol.stack;
      if (target.indexMode === 'display' && targetBoardId === getActiveBoardId()) {
        insertAt = _deps.findInsertColumnIndexInStack(insertStack, target.colIndex, target.before);
      } else {
        insertAt = target.before ? target.colIndex : (target.colIndex + 1);
      }
    } else {
      sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
      return;
    }

    if (!insertStack || !insertStack.columns) {
      sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
      return;
    }
    if (insertAt < 0) insertAt = 0;
    if (insertAt > insertStack.columns.length) insertAt = insertStack.columns.length;

    if (sourceBoardData === targetBoardData && sourceLoc.stack === insertStack) {
      if (sourceLoc.colIndex < insertAt) insertAt--;
      if (insertAt === sourceLoc.colIndex) {
        sourceLoc.stack.columns.splice(sourceLoc.colIndex, 0, movedColumn);
        return;
      }
    }

    insertStack.columns.splice(insertAt, 0, movedColumn);
    _deps.removeEmptyStacksAndRowsInBoard(sourceBoardData);
    if (sourceBoardData !== targetBoardData) _deps.removeEmptyStacksAndRowsInBoard(targetBoardData);

    var changed = {};
    changed[sourceBoardId] = sourceBoardData;
    if (targetBoardId !== sourceBoardId) changed[targetBoardId] = targetBoardData;
    await _deps.commitBoardMutations(changed, { refreshSidebar: true });
    return;
  }

  // ── Public API ────────────────────────────────────────────────────

  return {
    init: init,
    bindAll: bindAll,
    resolveColumnLocationForMutation: resolveColumnLocationForMutation,
    resolveStackForMutation: resolveStackForMutation,
    resolveRowForMutation: resolveRowForMutation,
    moveRowAcrossBoards: moveRowAcrossBoards,
    moveStackAcrossBoards: moveStackAcrossBoards,
    moveColumnAcrossBoards: moveColumnAcrossBoards
  };
})();
window.LexeraDndListeners = LexeraDndListeners;
