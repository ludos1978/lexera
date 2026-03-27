/**
 * Drag-Drop Handlers — pointer-based drag-and-drop logic for cards,
 * rows, stacks, columns, and boards.
 *
 * Manages:
 *   - Card drag (mousedown/mousemove/mouseup on board cards)
 *   - Pointer drag (rows, stacks, columns, boards via grips)
 *   - Cross-view bridge (multi-frame drag coordination)
 *   - Drop target resolution & visual indicators
 *   - External DnD bridge registration
 *
 * Dependencies injected via init().
 */
var LexeraDragDropHandlers = (function () {
  'use strict';

  var _deps = {};

  // --- State ---
  var cardDrag = null;
  var ptrDrag = null;
  var DRAG_THRESHOLD = 5;
  var dragLayoutLocks = null;
  var crossViewBridge = null;

  // --- Dependency accessors ---
  function getElColumnsContainer() { return _deps.getElColumnsContainer(); }
  function getElBoardList() { return _deps.getElBoardList(); }

  // --- Board Layout Lock ---

  function lockBoardLayoutForDrag() {
    if (dragLayoutLocks) return;
    var nodes = getElColumnsContainer().querySelectorAll('.board-row, .board-stack, .column');
    dragLayoutLocks = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      dragLayoutLocks.push({
        el: el,
        width: el.style.width,
        minWidth: el.style.minWidth,
        maxWidth: el.style.maxWidth,
        height: el.style.height,
        minHeight: el.style.minHeight,
        maxHeight: el.style.maxHeight
      });
      el.style.width = rect.width + 'px';
      el.style.minWidth = rect.width + 'px';
      el.style.maxWidth = rect.width + 'px';
      el.style.height = rect.height + 'px';
      el.style.minHeight = rect.height + 'px';
      el.style.maxHeight = rect.height + 'px';
      el.classList.add('layout-locked');
    }
    if (dragLayoutLocks.length === 0) dragLayoutLocks = null;
  }

  function unlockBoardLayoutForDrag() {
    if (!dragLayoutLocks) return;
    for (var i = 0; i < dragLayoutLocks.length; i++) {
      var prev = dragLayoutLocks[i];
      prev.el.style.width = prev.width;
      prev.el.style.minWidth = prev.minWidth;
      prev.el.style.maxWidth = prev.maxWidth;
      prev.el.style.height = prev.height;
      prev.el.style.minHeight = prev.minHeight;
      prev.el.style.maxHeight = prev.maxHeight;
      prev.el.classList.remove('layout-locked');
    }
    dragLayoutLocks = null;
  }

  // --- Geometry Helpers ---

  function isPointInsideRect(mx, my, rect) {
    return mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom;
  }

  function findNodeAtPoint(nodeList, mx, my) {
    for (var i = 0; i < nodeList.length; i++) {
      var rect = nodeList[i].getBoundingClientRect();
      if (isPointInsideRect(mx, my, rect)) return nodeList[i];
    }
    return null;
  }

  function removeClassFromNodeList(nodeList, className) {
    for (var i = 0; i < nodeList.length; i++) nodeList[i].classList.remove(className);
  }

  function removeClassesFromNodeList(nodeList, classNames) {
    for (var i = 0; i < nodeList.length; i++) {
      nodeList[i].classList.remove.apply(nodeList[i].classList, classNames);
    }
  }

  // --- Element Finders ---

  function getColumnCardsContainers() {
    return getElColumnsContainer().querySelectorAll('.column-cards');
  }

  function findColumnCardsContainerAt(mx, my) {
    return findNodeAtPoint(getColumnCardsContainers(), mx, my);
  }

  function clearCardDragOverHighlights() {
    removeClassFromNodeList(getColumnCardsContainers(), 'card-drag-over');
  }

  function findStackDropZoneAt(mx, my) {
    return findNodeAtPoint(getElColumnsContainer().querySelectorAll('.stack-drop-zone'), mx, my);
  }

  function findDraggableColumnAt(mx, my) {
    return findNodeAtPoint(getElColumnsContainer().querySelectorAll('.column:not(.dragging)'), mx, my);
  }

  function findBoardStackAt(mx, my) {
    return findNodeAtPoint(getElColumnsContainer().querySelectorAll('.board-stack'), mx, my);
  }

  function clearSidebarDropHighlights() {
    removeClassFromNodeList(
      getElBoardList().querySelectorAll('.tree-column.drop-target, .tree-stack.drop-target, .tree-row.drop-target, .board-item.drop-target'),
      'drop-target'
    );
    removeClassesFromNodeList(
      getElBoardList().querySelectorAll('.tree-drop-above, .tree-drop-below'),
      ['tree-drop-above', 'tree-drop-below']
    );
  }

  function findSidebarColumnAt(mx, my) {
    return findNodeAtPoint(getElBoardList().querySelectorAll('.tree-column[data-tree-drag="tree-column"]'), mx, my);
  }

  // --- Card Drop Helpers ---

  function getVisibleCardCountInColumn(col) {
    if (!col || !col.cards) return 0;
    var count = 0;
    for (var i = 0; i < col.cards.length; i++) {
      if (!_deps.is_archived_or_deleted(col.cards[i].content || '')) count++;
    }
    return count;
  }

  function buildSidebarCardTarget(boardId, rowIdx, stackIdx, colIdx, sidebarNode) {
    if (!boardId || isNaN(rowIdx) || isNaN(stackIdx)) return null;
    var rows = _deps.getBoardHierarchyRows(boardId) || [];
    var row = rows[rowIdx];
    var stack = row && row.stacks ? row.stacks[stackIdx] : null;
    if (!stack) return null;
    var activeBoardId = _deps.getActiveBoardId();
    if (!stack.columns || stack.columns.length === 0) {
      return {
        kind: 'sidebar',
        boardId: boardId,
        rowIndex: rowIdx,
        stackIndex: stackIdx,
        indexMode: boardId === activeBoardId ? 'display' : 'full',
        insertIdx: 0,
        insertMode: 'full',
        sidebarNode: sidebarNode || null,
        container: null
      };
    }

    var resolvedColIdx = (typeof colIdx === 'number' && colIdx >= 0 && colIdx < stack.columns.length)
      ? colIdx
      : (stack.columns.length - 1);
    var targetCol = stack.columns[resolvedColIdx];
    var insertIdx = getVisibleCardCountInColumn(targetCol);

    return {
      kind: 'sidebar',
      boardId: boardId,
      rowIndex: rowIdx,
      stackIndex: stackIdx,
      colIndex: resolvedColIdx,
      indexMode: boardId === activeBoardId ? 'display' : 'full',
      insertIdx: insertIdx,
      insertMode: 'visible',
      sidebarNode: sidebarNode || null,
      container: null
    };
  }

  function getFirstSidebarCardTargetForBoard(boardId, sidebarNode) {
    if (!boardId) return null;
    var rows = _deps.getBoardHierarchyRows(boardId) || [];
    var activeBoardId = _deps.getActiveBoardId();
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !row.stacks) continue;
      for (var s = 0; s < row.stacks.length; s++) {
        var stack = row.stacks[s];
        if (!stack || !stack.columns || stack.columns.length === 0) continue;
        return buildSidebarCardTarget(boardId, r, s, 0, sidebarNode || null);
      }
    }
    if (rows.length > 0) {
      return {
        kind: 'sidebar',
        boardId: boardId,
        rowIndex: 0,
        indexMode: boardId === activeBoardId ? 'display' : 'full',
        insertIdx: 0,
        insertMode: 'full',
        sidebarNode: sidebarNode || null,
        container: null
      };
    }
    return null;
  }

  // --- Card Drop Indicator ---

  function findCardInsertIndex(mouseY, cardsEl) {
    var cards = cardsEl.querySelectorAll('.card:not(.dragging)');
    for (var i = 0; i < cards.length; i++) {
      var rect = cards[i].getBoundingClientRect();
      if (mouseY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return cards.length;
  }

  function showCardDropIndicator(cardsEl, insertIdx) {
    if (!cardsEl) return;
    var indicator = document.querySelector('.card-drop-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'card-drop-indicator';
      document.body.appendChild(indicator);
    }
    var cards = cardsEl.querySelectorAll('.card:not(.dragging)');
    var containerRect = cardsEl.getBoundingClientRect();
    var y;
    if (insertIdx < cards.length && cards[insertIdx]) {
      y = cards[insertIdx].getBoundingClientRect().top;
    } else if (cards.length > 0) {
      y = cards[cards.length - 1].getBoundingClientRect().bottom;
    } else {
      y = containerRect.top + 8;
    }
    indicator.style.top = Math.round(y) + 'px';
    indicator.style.left = Math.round(containerRect.left + 6) + 'px';
    indicator.style.width = Math.max(24, Math.round(containerRect.width - 12)) + 'px';
  }

  function clearCardDropIndicators() {
    var indicators = document.querySelectorAll('.card-drop-indicator');
    for (var i = 0; i < indicators.length; i++) {
      indicators[i].remove();
    }
  }

  function clearHeaderDropTargetHighlights() {
    var p = document.getElementById('btn-parked');
    var a = document.getElementById('btn-archived');
    var t = document.getElementById('btn-trash');
    if (p) p.classList.remove('drop-target');
    if (a) a.classList.remove('drop-target');
    if (t) t.classList.remove('drop-target');
  }

  // --- Card Drop Target Resolution ---

  function resolveCardDropTarget(mx, my) {
    var activeBoardId = _deps.getActiveBoardId();
    var incomingBtn = document.getElementById('btn-incoming');
    var parkedBtn = document.getElementById('btn-parked');
    var archiveBtn = document.getElementById('btn-archived');
    var trashBtn = document.getElementById('btn-trash');
    if (incomingBtn && isPointInsideRect(mx, my, incomingBtn.getBoundingClientRect())) {
      return { kind: 'header-incoming', sidebarNode: null, container: null };
    }
    if (parkedBtn && isPointInsideRect(mx, my, parkedBtn.getBoundingClientRect())) {
      return { kind: 'header-park', sidebarNode: null, container: null };
    }
    if (archiveBtn && isPointInsideRect(mx, my, archiveBtn.getBoundingClientRect())) {
      return { kind: 'header-archive', sidebarNode: null, container: null };
    }
    if (trashBtn && isPointInsideRect(mx, my, trashBtn.getBoundingClientRect())) {
      return { kind: 'header-trash', sidebarNode: null, container: null };
    }

    var isCardDrag = (ptrDrag && ptrDrag.type === 'tree-card') || (cardDrag && cardDrag.started);

    if (isCardDrag) {
      var treeCardTarget = getTreeCardDropTarget(mx, my);
      if (treeCardTarget) {
        var tcInsertIdx = treeCardTarget.before ? treeCardTarget.cardIndex : treeCardTarget.cardIndex + 1;
        return {
          kind: 'sidebar',
          boardId: treeCardTarget.boardId,
          rowIndex: treeCardTarget.rowIndex,
          stackIndex: treeCardTarget.stackIndex,
          colIndex: treeCardTarget.colIndex,
          indexMode: treeCardTarget.indexMode,
          insertIdx: tcInsertIdx,
          insertMode: treeCardTarget.boardId === activeBoardId ? 'visible' : 'full',
          sidebarNode: null,
          container: null
        };
      }
    }

    var sidebarCol = findSidebarColumnAt(mx, my);
    if (sidebarCol) {
      var sidebarBoardId = sidebarCol.getAttribute('data-board-id');
      var sidebarRowIdx = parseInt(sidebarCol.getAttribute('data-row-index'), 10);
      var sidebarStackIdx = parseInt(sidebarCol.getAttribute('data-stack-index'), 10);
      var sidebarColIdx = parseInt(sidebarCol.getAttribute('data-col-local-index'), 10);
      if (sidebarBoardId && !isNaN(sidebarRowIdx) && !isNaN(sidebarStackIdx) && !isNaN(sidebarColIdx)) {
        var sidebarInsertIdx = 0;
        if (sidebarBoardId === activeBoardId && _deps.getFullBoardData()) {
          var activeTargetCol = null;
          var activeTargetStack = _deps.findFullDataStack(sidebarRowIdx, sidebarStackIdx);
          if (activeTargetStack) {
            var activeTargetColIdx = _deps.findFullColumnIndexInStack(activeTargetStack, sidebarColIdx);
            if (activeTargetColIdx >= 0 && activeTargetColIdx < activeTargetStack.columns.length) {
              activeTargetCol = activeTargetStack.columns[activeTargetColIdx];
            }
          }
          sidebarInsertIdx = getVisibleCardCountInColumn(activeTargetCol);
        } else {
          var sidebarRows = _deps.getBoardHierarchyRows(sidebarBoardId) || [];
          var sidebarRow = sidebarRows[sidebarRowIdx];
          var sidebarStack = sidebarRow && sidebarRow.stacks ? sidebarRow.stacks[sidebarStackIdx] : null;
          var sidebarTargetCol = sidebarStack && sidebarStack.columns ? sidebarStack.columns[sidebarColIdx] : null;
          sidebarInsertIdx = getVisibleCardCountInColumn(sidebarTargetCol);
        }
        return {
          kind: 'sidebar',
          boardId: sidebarBoardId,
          rowIndex: sidebarRowIdx,
          stackIndex: sidebarStackIdx,
          colIndex: sidebarColIdx,
          indexMode: sidebarBoardId === activeBoardId ? 'display' : 'full',
          insertIdx: sidebarInsertIdx,
          insertMode: 'visible',
          sidebarNode: sidebarCol,
          container: null
        };
      }
    }

    var isTreeOnlyCardDrag = ptrDrag && ptrDrag.type === 'tree-card';
    if (!isTreeOnlyCardDrag) {
      var sidebarStackNode = findNodeAtPoint(getElBoardList().querySelectorAll('.tree-stack[data-tree-drag="tree-stack"]'), mx, my);
      if (sidebarStackNode) {
        var stackBoardId = sidebarStackNode.getAttribute('data-board-id');
        var stackRowIdx = parseInt(sidebarStackNode.getAttribute('data-row-index'), 10);
        var stackIdx = parseInt(sidebarStackNode.getAttribute('data-stack-index'), 10);
        var stackTarget = buildSidebarCardTarget(stackBoardId, stackRowIdx, stackIdx, Number.POSITIVE_INFINITY, sidebarStackNode);
        if (stackTarget) return stackTarget;
      }

      var sidebarRowNode = findNodeAtPoint(getElBoardList().querySelectorAll('.tree-row[data-tree-drag="tree-row"]'), mx, my);
      if (sidebarRowNode) {
        var rowBoardId = sidebarRowNode.getAttribute('data-board-id');
        var rowIdx = parseInt(sidebarRowNode.getAttribute('data-row-index'), 10);
        var rowDataSet = _deps.getBoardHierarchyRows(rowBoardId) || [];
        var rowData = rowDataSet[rowIdx];
        if (rowData && rowData.stacks) {
          for (var rs = 0; rs < rowData.stacks.length; rs++) {
            if (rowData.stacks[rs] && rowData.stacks[rs].columns && rowData.stacks[rs].columns.length > 0) {
              var rowTarget = buildSidebarCardTarget(rowBoardId, rowIdx, rs, 0, sidebarRowNode);
              if (rowTarget) return rowTarget;
              break;
            }
          }
          return {
            kind: 'sidebar',
            boardId: rowBoardId,
            rowIndex: rowIdx,
            indexMode: rowBoardId === activeBoardId ? 'display' : 'full',
            insertIdx: 0,
            insertMode: 'full',
            sidebarNode: sidebarRowNode,
            container: null
          };
        }
      }

      var sidebarBoardNode = findNodeAtPoint(getElBoardList().querySelectorAll('.board-item[data-board-id]'), mx, my);
      if (sidebarBoardNode) {
        var boardNodeId = sidebarBoardNode.getAttribute('data-board-id');
        var boardTarget = getFirstSidebarCardTargetForBoard(boardNodeId, sidebarBoardNode);
        if (boardTarget) return boardTarget;
      }
    }

    var targetContainer = findColumnCardsContainerAt(mx, my);
    if (targetContainer) {
      var targetColIndex = parseInt(targetContainer.getAttribute('data-col-index'), 10);
      if (!isNaN(targetColIndex)) {
        return {
          kind: 'main',
          boardId: activeBoardId,
          flatColIndex: targetColIndex,
          indexMode: 'display',
          insertIdx: findCardInsertIndex(my, targetContainer),
          insertMode: 'visible',
          sidebarNode: null,
          container: targetContainer
        };
      }
    }

    var targetStackEl = findBoardStackAt(mx, my);
    if (targetStackEl) {
      var stackRowIdx = parseInt(targetStackEl.getAttribute('data-row-index'), 10);
      var stackIdx = parseInt(targetStackEl.getAttribute('data-stack-index'), 10);
      if (!isNaN(stackRowIdx) && !isNaN(stackIdx)) {
        return {
          kind: 'main',
          boardId: activeBoardId,
          rowIndex: stackRowIdx,
          stackIndex: stackIdx,
          indexMode: 'display',
          insertIdx: 0,
          insertMode: 'full',
          sidebarNode: null,
          container: null
        };
      }
    }

    var targetRowEl = findNodeAtPoint(getElColumnsContainer().querySelectorAll('.board-row'), mx, my);
    if (targetRowEl) {
      var mainRowIdx = parseInt(targetRowEl.getAttribute('data-row-index'), 10);
      if (!isNaN(mainRowIdx)) {
        return {
          kind: 'main',
          boardId: activeBoardId,
          rowIndex: mainRowIdx,
          indexMode: 'display',
          insertIdx: 0,
          insertMode: 'full',
          sidebarNode: null,
          container: null
        };
      }
    }

    return null;
  }

  // --- Card Drag Lifecycle ---

  function startCardDrag(e) {
    var el = cardDrag.el;
    lockBoardLayoutForDrag();
    startCrossViewBridge('card');
    el.classList.add('dragging');
    _deps.insertDropZoneIndicators('card');

    var ghost = document.createElement('div');
    ghost.className = 'card-drag-ghost';
    var titleEl = el.querySelector('.card-title-display');
    ghost.textContent = (titleEl ? titleEl.textContent : el.textContent).substring(0, 80);
    ghost.style.width = el.offsetWidth + 'px';
    ghost.style.left = (e.clientX + 8) + 'px';
    ghost.style.top = (e.clientY - 12) + 'px';
    document.body.appendChild(ghost);
    cardDrag.ghost = ghost;

    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  }

  function updateCardDropTarget(mx, my) {
    clearCardDropIndicators();
    clearSidebarDropHighlights();
    clearCardDragOverHighlights();
    _deps.clearDropZoneIndicatorHighlights();

    var target = resolveCardDropTarget(mx, my);
    clearHeaderDropTargetHighlights();

    if (!target) return false;

    if (target.kind === 'header-incoming' || target.kind === 'header-park' || target.kind === 'header-archive' || target.kind === 'header-trash') {
      var hdrBtnId = target.kind === 'header-incoming' ? 'btn-incoming' : target.kind === 'header-park' ? 'btn-parked' : target.kind === 'header-archive' ? 'btn-archived' : 'btn-trash';
      var hdrBtn = document.getElementById(hdrBtnId);
      if (hdrBtn) hdrBtn.classList.add('drop-target');
      return true;
    }

    if (target.kind === 'sidebar') {
      if (target.sidebarNode) target.sidebarNode.classList.add('drop-target');
      return true;
    }

    if (target.kind === 'main') {
      if (typeof target.stackIndex === 'number') {
        var stackSelector = '.board-stack[data-row-index="' + target.rowIndex + '"][data-stack-index="' + target.stackIndex + '"]';
        var stackTarget = getElColumnsContainer().querySelector(stackSelector);
        if (stackTarget) stackTarget.classList.add('column-drop-target');
        return true;
      }
      if (typeof target.rowIndex === 'number') {
        var rowSelector = '.board-row[data-row-index="' + target.rowIndex + '"]';
        var rowTarget = getElColumnsContainer().querySelector(rowSelector);
        if (rowTarget) rowTarget.classList.add('drop-target');
        return true;
      }
    }

    if (target.container) {
      target.container.classList.add('card-drag-over');
      showCardDropIndicator(target.container, target.insertIdx);
      _deps.highlightDropZoneIndicator('card', mx, my);
      return true;
    }
    return false;
  }

  function applyCardDropByPoint(source, mx, my) {
    var target = resolveCardDropTarget(mx, my);
    if (!target) return false;

    if (target.kind === 'header-incoming' || target.kind === 'header-park' || target.kind === 'header-archive' || target.kind === 'header-trash') {
      var tag = target.kind === 'header-incoming' ? '#hidden-internal-incoming'
        : target.kind === 'header-park' ? '#hidden-internal-parked'
        : target.kind === 'header-archive' ? '#hidden-internal-archived'
        : '#hidden-internal-deleted';
      var srcColIndex = source.flatColIndex;
      var srcCardIndex = source.cardIndex;
      if (typeof srcColIndex === 'number' && typeof srcCardIndex === 'number') {
        _deps.tagCard(srcColIndex, srcCardIndex, tag);
      }
      return true;
    }

    _deps.moveCard(source, target).catch(function (err) {
      _deps.logFrontendIssue('error', 'moveCard', 'Drop failed', err);
    });
    return true;
  }

  function finishCardDrag(mx, my) {
    clearCardDropIndicators();
    clearSidebarDropHighlights();
    clearCardDragOverHighlights();
    var source = {
      boardId: cardDrag.boardId,
      flatColIndex: cardDrag.flatColIndex,
      cardIndex: cardDrag.cardIndex,
      cardIndexMode: 'visible',
      indexMode: 'display'
    };
    if (
      typeof cardDrag.rowIndex === 'number' &&
      typeof cardDrag.stackIndex === 'number' &&
      typeof cardDrag.colIndex === 'number' &&
      cardDrag.rowIndex >= 0 &&
      cardDrag.stackIndex >= 0 &&
      cardDrag.colIndex >= 0
    ) {
      source.rowIndex = cardDrag.rowIndex;
      source.stackIndex = cardDrag.stackIndex;
      source.colIndex = cardDrag.colIndex;
    }
    applyCardDropByPoint(source, mx, my);
    cleanupCardDrag();
  }

  function cancelCardDrag() {
    clearCardDropIndicators();
    clearSidebarDropHighlights();
    clearCardDragOverHighlights();
    clearHeaderDropTargetHighlights();
    cleanupCardDrag();
  }

  function cleanupCardDrag() {
    _deps.removeDropZoneIndicators();
    clearHeaderDropTargetHighlights();
    if (cardDrag) {
      if (cardDrag.el) cardDrag.el.classList.remove('dragging');
      if (cardDrag.ghost) cardDrag.ghost.remove();
      cardDrag = null;
    }
    stopCrossViewBridge();
    unlockBoardLayoutForDrag();
    _deps.vsRestoreAfterDrag();
  }

  // --- Cross-View Bridge ---

  function getTopWindowSafe() {
    try {
      if (window.top && window.top.document) return window.top;
    } catch (e) {
      _deps.logFrontendIssue('warn', 'cross-frame', 'Failed to access top window', e);
    }
    return window;
  }

  function getFrameWindowAtTopPoint(topX, topY) {
    var topWin = getTopWindowSafe();
    if (!topWin || !topWin.document || !topWin.document.elementFromPoint) return window;
    var hit = topWin.document.elementFromPoint(topX, topY);
    if (!hit) return window;
    if (hit.tagName === 'IFRAME' && hit.contentWindow) return hit.contentWindow;
    return topWin;
  }

  function getFrameRectInTopWindow(targetWin) {
    var topWin = getTopWindowSafe();
    if (!targetWin || targetWin === topWin) return { left: 0, top: 0 };
    try {
      var iframes = topWin.document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        if (iframes[i].contentWindow === targetWin) {
          return iframes[i].getBoundingClientRect();
        }
      }
    } catch (e) {
      _deps.logFrontendIssue('warn', 'cross-frame', 'Failed to resolve iframe bounds in top window', e);
    }
    return null;
  }

  function toTopFramePoint(sourceWin, localX, localY) {
    var topWin = getTopWindowSafe();
    if (!sourceWin) return null;
    if (sourceWin === topWin) return { x: localX, y: localY };
    var rect = getFrameRectInTopWindow(sourceWin);
    if (!rect) return null;
    return { x: localX + rect.left, y: localY + rect.top };
  }

  function toLocalFramePoint(targetWin, topX, topY) {
    var topWin = getTopWindowSafe();
    if (!targetWin) return null;
    if (targetWin === topWin) return { x: topX, y: topY };
    var rect = getFrameRectInTopWindow(targetWin);
    if (!rect) return null;
    return { x: topX - rect.left, y: topY - rect.top };
  }

  function getDragStartTopPoint(kind) {
    if (kind === 'card' && cardDrag) {
      if (typeof cardDrag.startTopX === 'number' && typeof cardDrag.startTopY === 'number') {
        return { x: cardDrag.startTopX, y: cardDrag.startTopY };
      }
      return toTopFramePoint(window, cardDrag.startX, cardDrag.startY);
    }
    if (kind === 'ptr' && ptrDrag) {
      if (typeof ptrDrag.startTopX === 'number' && typeof ptrDrag.startTopY === 'number') {
        return { x: ptrDrag.startTopX, y: ptrDrag.startTopY };
      }
      return toTopFramePoint(window, ptrDrag.startX, ptrDrag.startY);
    }
    return null;
  }

  function hasCrossViewDragMovedBeyondThreshold(kind, topPoint) {
    if (!topPoint) return false;
    if (kind === 'card' && cardDrag && cardDrag.started) return true;
    if (kind === 'ptr' && ptrDrag && ptrDrag.started) return true;
    var startPoint = getDragStartTopPoint(kind);
    if (!startPoint) return false;
    var dx = topPoint.x - startPoint.x;
    var dy = topPoint.y - startPoint.y;
    return Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD;
  }

  function getCrossViewDragPayload(kind) {
    if (kind === 'card' && cardDrag) {
      var source = {
        boardId: cardDrag.boardId,
        flatColIndex: cardDrag.flatColIndex,
        cardIndex: cardDrag.cardIndex,
        cardIndexMode: 'visible',
        indexMode: 'display'
      };
      if (
        typeof cardDrag.rowIndex === 'number' &&
        typeof cardDrag.stackIndex === 'number' &&
        typeof cardDrag.colIndex === 'number' &&
        cardDrag.rowIndex >= 0 &&
        cardDrag.stackIndex >= 0 &&
        cardDrag.colIndex >= 0
      ) {
        source.rowIndex = cardDrag.rowIndex;
        source.stackIndex = cardDrag.stackIndex;
        source.colIndex = cardDrag.colIndex;
      }
      return {
        type: 'tree-card',
        source: source
      };
    }
    if (kind === 'ptr' && ptrDrag) {
      if (
        ptrDrag.type !== 'tree-card' &&
        ptrDrag.type !== 'column' &&
        ptrDrag.type !== 'tree-column' &&
        ptrDrag.type !== 'board-row' &&
        ptrDrag.type !== 'tree-row' &&
        ptrDrag.type !== 'board-stack' &&
        ptrDrag.type !== 'tree-stack'
      ) {
        return null;
      }
      return {
        type: ptrDrag.type,
        source: structuredClone(ptrDrag.source || {})
      };
    }
    return null;
  }

  function tryExternalFrameDrop(targetWin, payload, topX, topY) {
    if (!targetWin || !payload || !payload.source) return false;
    var api = targetWin.__lexeraExternalDnd;
    if (!api || typeof api.drop !== 'function') return false;
    var localPoint = toLocalFramePoint(targetWin, topX, topY);
    if (!localPoint) return false;
    return !!api.drop(payload, localPoint.x, localPoint.y);
  }

  function tryExternalFrameHover(targetWin, payload, topX, topY) {
    if (!targetWin || !payload || !payload.source) return false;
    var api = targetWin.__lexeraExternalDnd;
    if (!api || typeof api.hover !== 'function') return false;
    var localPoint = toLocalFramePoint(targetWin, topX, topY);
    if (!localPoint) return false;
    return !!api.hover(payload, localPoint.x, localPoint.y);
  }

  function tryExternalFrameClear(targetWin) {
    if (!targetWin) return;
    var api = targetWin.__lexeraExternalDnd;
    if (api && typeof api.clear === 'function') {
      api.clear();
    }
  }

  function getCrossViewGhostLabel(kind) {
    if (kind === 'card' && cardDrag && cardDrag.el) {
      var titleEl = cardDrag.el.querySelector('.card-title-display');
      var text = titleEl ? titleEl.textContent : cardDrag.el.textContent;
      return (text || 'Drag').trim().substring(0, 80);
    }
    if (kind === 'ptr' && ptrDrag) {
      return getPtrDragLabel();
    }
    return 'Drag';
  }

  function getCrossViewBridgeWindows(topWin) {
    var result = [];
    var seen = [];
    function pushWin(win) {
      if (!win) return;
      if (seen.indexOf(win) !== -1) return;
      seen.push(win);
      result.push(win);
    }
    pushWin(topWin);
    if (!topWin || !topWin.document) return result;
    try {
      var iframes = topWin.document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        if (iframes[i] && iframes[i].contentWindow) pushWin(iframes[i].contentWindow);
      }
    } catch (e) {
      // ignore cross-frame access issues
    }
    return result;
  }

  function clearCrossViewHoverTarget() {
    if (!crossViewBridge || !crossViewBridge.hoverWin) return;
    tryExternalFrameClear(crossViewBridge.hoverWin);
    crossViewBridge.hoverWin = null;
  }

  function hideCrossViewTopGhost() {
    if (!crossViewBridge || !crossViewBridge.topGhost) return;
    crossViewBridge.topGhost.style.display = 'none';
  }

  function ensureCrossViewTopGhost(kind) {
    if (!crossViewBridge || !crossViewBridge.topWin || !crossViewBridge.topWin.document) return null;
    if (!crossViewBridge.topGhost || !crossViewBridge.topGhost.isConnected) {
      var ghost = crossViewBridge.topWin.document.createElement('div');
      ghost.className = 'card-drag-ghost cross-view-drag-ghost';
      ghost.style.display = 'none';
      crossViewBridge.topWin.document.body.appendChild(ghost);
      crossViewBridge.topGhost = ghost;
    }
    var label = getCrossViewGhostLabel(kind);
    crossViewBridge.topGhost.textContent = label || 'Drag';
    return crossViewBridge.topGhost;
  }

  function updateCrossViewTopGhost(kind, topX, topY) {
    var ghost = ensureCrossViewTopGhost(kind);
    if (!ghost) return;
    ghost.style.left = (topX + 8) + 'px';
    ghost.style.top = (topY - 12) + 'px';
    ghost.style.display = 'block';
  }

  function removeCrossViewTopGhost() {
    if (!crossViewBridge || !crossViewBridge.topGhost) return;
    crossViewBridge.topGhost.remove();
    crossViewBridge.topGhost = null;
  }

  function updateCrossViewExternalHover(kind, topX, topY) {
    if (!crossViewBridge) return;
    var payload = getCrossViewDragPayload(kind);
    if (!payload) {
      clearCrossViewHoverTarget();
      return;
    }
    var targetWin = getFrameWindowAtTopPoint(topX, topY);
    if (!targetWin || targetWin === window || targetWin === crossViewBridge.topWin) {
      clearCrossViewHoverTarget();
      return;
    }
    if (crossViewBridge.hoverWin && crossViewBridge.hoverWin !== targetWin) {
      tryExternalFrameClear(crossViewBridge.hoverWin);
      crossViewBridge.hoverWin = null;
    }
    var hovered = tryExternalFrameHover(targetWin, payload, topX, topY);
    if (hovered) {
      crossViewBridge.hoverWin = targetWin;
      return;
    }
    if (crossViewBridge.hoverWin === targetWin) {
      tryExternalFrameClear(targetWin);
      crossViewBridge.hoverWin = null;
    }
  }

  function startCrossViewBridge(kind) {
    if (crossViewBridge) return;
    var topWin = getTopWindowSafe();
    if (!topWin || topWin === window) return;

    var bridgeTargets = [];
    var bridgeWindows = getCrossViewBridgeWindows(topWin);

    function onAnyMouseMove(originWin, e) {
      var topPoint = toTopFramePoint(originWin, e.clientX, e.clientY);
      if (!topPoint) return;
      var crossedThreshold = hasCrossViewDragMovedBeyondThreshold(kind, topPoint);
      if (!crossedThreshold) {
        hideCrossViewTopGhost();
        clearCrossViewHoverTarget();
        return;
      }
      var targetWin = getFrameWindowAtTopPoint(topPoint.x, topPoint.y);
      if (targetWin && targetWin !== window) {
        updateCrossViewTopGhost(kind, topPoint.x, topPoint.y);
      } else {
        hideCrossViewTopGhost();
      }
      updateCrossViewExternalHover(kind, topPoint.x, topPoint.y);
    }

    function onAnyMouseUp(originWin, e) {
      var topPoint = toTopFramePoint(originWin, e.clientX, e.clientY);
      if (!topPoint) return;
      var targetWin = getFrameWindowAtTopPoint(topPoint.x, topPoint.y);
      if (!targetWin || targetWin === window) return;
      var crossedThreshold = hasCrossViewDragMovedBeyondThreshold(kind, topPoint);
      if (!crossedThreshold) {
        if (kind === 'card' && cardDrag && !cardDrag.started) cancelCardDrag();
        else if (kind === 'ptr' && ptrDrag && !ptrDrag.started) cleanupPtrDrag();
        stopCrossViewBridge();
        return;
      }

      var payload = getCrossViewDragPayload(kind);
      var dropped =
        payload && targetWin !== topWin
          ? tryExternalFrameDrop(targetWin, payload, topPoint.x, topPoint.y)
          : false;
      if (kind === 'card' && cardDrag) {
        if (dropped) cleanupCardDrag();
        else cancelCardDrag();
      } else if (kind === 'ptr' && ptrDrag) {
        cleanupPtrDrag();
      }
      if (dropped) _deps.poll();
      stopCrossViewBridge();
    }

    for (var i = 0; i < bridgeWindows.length; i++) {
      (function (targetWin) {
        function upListener(e) {
          onAnyMouseUp(targetWin, e);
        }
        function moveListener(e) {
          onAnyMouseMove(targetWin, e);
        }
        targetWin.addEventListener('mouseup', upListener, true);
        targetWin.addEventListener('mousemove', moveListener, true);
        bridgeTargets.push({ win: targetWin, upListener: upListener, moveListener: moveListener });
      })(bridgeWindows[i]);
    }

    crossViewBridge = { topWin: topWin, kind: kind, targets: bridgeTargets, hoverWin: null, topGhost: null };
  }

  function stopCrossViewBridge() {
    if (!crossViewBridge) return;
    var targets = crossViewBridge.targets || [];
    for (var i = 0; i < targets.length; i++) {
      var target = targets[i];
      if (target && target.win && target.upListener) {
        target.win.removeEventListener('mouseup', target.upListener, true);
      }
      if (target && target.win && target.moveListener) {
        target.win.removeEventListener('mousemove', target.moveListener, true);
      }
    }
    clearCrossViewHoverTarget();
    removeCrossViewTopGhost();
    crossViewBridge = null;
  }

  // --- Pointer Drag (rows/stacks/columns/boards) ---

  function getPtrDragLabel() {
    var type = ptrDrag.type;
    var labelEl;
    if (type === 'board') {
      labelEl = ptrDrag.el.querySelector('.board-item-title');
    } else if (type === 'board-row' || type === 'tree-row') {
      labelEl = ptrDrag.el.querySelector('.board-row-title, .tree-label');
    } else if (type === 'board-stack' || type === 'tree-stack') {
      labelEl = ptrDrag.el.querySelector('.board-stack-title, .tree-label');
    } else if (type === 'column' || type === 'tree-column') {
      labelEl = ptrDrag.el.querySelector('.column-title, .tree-label');
    } else if (type === 'tree-card') {
      labelEl = ptrDrag.el.querySelector('.tree-label');
    }
    return labelEl ? labelEl.textContent : 'Drag';
  }

  function updatePtrDropTarget(mx, my) {
    if (!ptrDrag) return false;
    return updatePtrDropTargetByType(ptrDrag.type, mx, my);
  }

  function updatePtrDropTargetByType(type, mx, my) {
    clearPtrDropIndicators();
    _deps.clearDropZoneIndicatorHighlights();
    clearHeaderDropTargetHighlights();

    if (type !== 'board') {
      var headerTag = resolveHeaderDropTag(mx, my);
      if (headerTag) {
        var hdrBtnId = headerTag === '#hidden-internal-incoming' ? 'btn-incoming'
          : headerTag === '#hidden-internal-parked' ? 'btn-parked'
          : headerTag === '#hidden-internal-archived' ? 'btn-archived' : 'btn-trash';
        var hdrBtn = document.getElementById(hdrBtnId);
        if (hdrBtn) hdrBtn.classList.add('drop-target');
        return true;
      }
    }

    var activeBoardId = _deps.getActiveBoardId();
    if (type === 'tree-row' || type === 'board-row') {
      var rowBoardHit = ptrFindHitNode(getElColumnsContainer().querySelectorAll('.board-row'), mx, my, 'drag-over-top', 'drag-over-bottom', true);
      var rowTreeHit = ptrFindHitNode(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-row"]'), mx, my, 'tree-drop-above', 'tree-drop-below', true);
      if (rowBoardHit) _deps.highlightDropZoneIndicator(type, mx, my);
      return !!(rowBoardHit || rowTreeHit);
    } else if (type === 'tree-stack' || type === 'board-stack') {
      if (_deps.isCanvasBoardLayout()) {
        var canvasStackRowTarget = resolveCanvasRowContentDropTarget(mx, my);
        if (canvasStackRowTarget && canvasStackRowTarget.node) {
          canvasStackRowTarget.node.classList.add('drop-target');
          return true;
        }
      }
      var stackBoardHit = ptrFindHitNode(getElColumnsContainer().querySelectorAll('.board-stack'), mx, my, 'drag-over-left', 'drag-over-right', false);
      var stackTreeHit = ptrFindHitNode(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-stack"]'), mx, my, 'tree-drop-above', 'tree-drop-below', true);
      if (stackBoardHit) {
        _deps.highlightDropZoneIndicator(type, mx, my);
        return true;
      }
      if (stackTreeHit) return true;
      var stackRowBodyTarget = resolveRowBodyDropTarget(mx, my);
      if (stackRowBodyTarget && stackRowBodyTarget.node) {
        stackRowBodyTarget.node.classList.add('drop-target');
        return true;
      }
      var stackRowBoardHit = ptrFindHitNode(getElColumnsContainer().querySelectorAll('.board-row'), mx, my, 'drag-over-top', 'drag-over-bottom', true);
      var stackRowTreeHit = ptrFindHitNode(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-row"]'), mx, my, 'tree-drop-above', 'tree-drop-below', true);
      return !!(stackRowBoardHit || stackRowTreeHit);
    } else if (type === 'tree-column' || type === 'column') {
      var boardColumnHit = updateColumnPtrDropTarget(mx, my);
      var treeColHit = ptrFindStrictHitNode(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-column"]'), mx, my, 'tree-drop-above', 'tree-drop-below', true);
      if (treeColHit) return true;
      if (!treeColHit) {
        var treeStackHit = ptrFindStrictHitNode(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-stack"]'), mx, my, 'tree-drop-above', 'tree-drop-below', true);
        if (treeStackHit) return true;
        if (!treeStackHit) {
          var stackZone = findNodeAtPoint(getElBoardList().querySelectorAll('.tree-children.tree-stack-drop-zone'), mx, my);
          if (stackZone) {
            stackZone.classList.add('tree-drop-stack-target');
            return true;
          }
        }
      }
      if (boardColumnHit) {
        _deps.highlightDropZoneIndicator(type, mx, my);
        return true;
      }
      var columnRowBodyTarget = resolveRowBodyDropTarget(mx, my);
      if (columnRowBodyTarget && columnRowBodyTarget.node) {
        columnRowBodyTarget.node.classList.add('drop-target');
        return true;
      }
      var columnRowBoardHit = ptrFindHitNode(getElColumnsContainer().querySelectorAll('.board-row'), mx, my, 'drag-over-top', 'drag-over-bottom', true);
      var columnRowTreeHit = ptrFindHitNode(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-row"]'), mx, my, 'tree-drop-above', 'tree-drop-below', true);
      return !!(columnRowBoardHit || columnRowTreeHit);
    } else if (type === 'tree-card') {
      clearCardDropIndicators();
      clearSidebarDropHighlights();
      clearCardDragOverHighlights();
      var treeCardHit = ptrFindStrictHitNode(
        getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-card"]'),
        mx, my, 'tree-drop-above', 'tree-drop-below', true
      );
      if (treeCardHit) return true;
      var treeColNode = findSidebarColumnAt(mx, my);
      if (treeColNode) { treeColNode.classList.add('drop-target'); return true; }
      var mainCol = findColumnCardsContainerAt(mx, my);
      if (mainCol) {
        mainCol.classList.add('card-drag-over');
        showCardDropIndicator(mainCol, findCardInsertIndex(my, mainCol));
        _deps.highlightDropZoneIndicator('tree-card', mx, my);
        return true;
      }
      return false;
    } else if (type === 'board') {
      var boardHit = ptrFindHitNode(getElBoardList().querySelectorAll('.board-item'), mx, my, 'drag-over-top', 'drag-over-bottom', true);
      return !!boardHit;
    }
    return false;
  }

  // --- Drop Target Resolution Helpers ---

  function resolveDropTarget(nodeList, mx, my, vertical) {
    for (var i = 0; i < nodeList.length; i++) {
      var rect = nodeList[i].getBoundingClientRect();
      if (isPointInsideRect(mx, my, rect)) {
        var before = vertical ? (my < rect.top + rect.height / 2) : (mx < rect.left + rect.width / 2);
        return { node: nodeList[i], before: before };
      }
    }

    var lastInRange = null;
    for (var i = 0; i < nodeList.length; i++) {
      var rect = nodeList[i].getBoundingClientRect();
      var inCross = vertical ? (mx >= rect.left && mx <= rect.right) : (my >= rect.top && my <= rect.bottom);
      if (!inCross) continue;
      if (vertical ? (my <= rect.top) : (mx <= rect.left)) {
        return { node: nodeList[i], before: true };
      }
      if (vertical ? (my >= rect.bottom) : (mx >= rect.right)) {
        lastInRange = nodeList[i];
      }
    }
    if (lastInRange) return { node: lastInRange, before: false };
    return null;
  }

  function resolveDropTargetStrict(nodeList, mx, my, vertical) {
    for (var i = 0; i < nodeList.length; i++) {
      var rect = nodeList[i].getBoundingClientRect();
      if (isPointInsideRect(mx, my, rect)) {
        var before = vertical ? (my < rect.top + rect.height / 2) : (mx < rect.left + rect.width / 2);
        return { node: nodeList[i], before: before };
      }
    }
    return null;
  }

  function ptrFindHitNode(nodeList, mx, my, classBefore, classAfter, vertical) {
    var target = resolveDropTarget(nodeList, mx, my, vertical);
    if (!target) return null;
    target.node.classList.add(target.before ? classBefore : classAfter);
    return target;
  }

  function ptrFindStrictHitNode(nodeList, mx, my, classBefore, classAfter, vertical) {
    var target = resolveDropTargetStrict(nodeList, mx, my, vertical);
    if (!target) return null;
    target.node.classList.add(target.before ? classBefore : classAfter);
    return target;
  }

  function ptrFindDropTarget(nodeList, mx, my, vertical) {
    return resolveDropTarget(nodeList, mx, my, vertical);
  }

  // --- Ptr Column Drop Target ---

  function updateColumnPtrDropTarget(mx, my) {
    var zone = findStackDropZoneAt(mx, my);
    if (zone) {
      zone.classList.add('active');
      return true;
    }
    var column = findDraggableColumnAt(mx, my);
    if (column) {
      var colRect = column.getBoundingClientRect();
      var stackEl = column.closest('.board-stack');
      if (_deps.isHorizontalCanvasStackElement(stackEl)) {
        if (mx < colRect.left + colRect.width / 2) {
          column.classList.add('drag-over-left');
        } else {
          column.classList.add('drag-over-right');
        }
      } else {
        if (my < colRect.top + colRect.height / 2) {
          column.classList.add('drag-over-top');
        } else {
          column.classList.add('drag-over-bottom');
        }
      }
      return true;
    }
    var stack = findBoardStackAt(mx, my);
    if (stack) {
      stack.classList.add('column-drop-target');
      return true;
    }
    return false;
  }

  function clearPtrDropIndicators() {
    removeClassesFromNodeList(getElBoardList().querySelectorAll('.tree-node'), ['tree-drop-above', 'tree-drop-below']);
    removeClassesFromNodeList(getElBoardList().querySelectorAll('.board-item'), ['drag-over-top', 'drag-over-bottom']);
    removeClassesFromNodeList(getElColumnsContainer().querySelectorAll('.board-row'), ['drag-over-top', 'drag-over-bottom', 'drop-target']);
    removeClassesFromNodeList(getElColumnsContainer().querySelectorAll('.board-stack'), ['drag-over-left', 'drag-over-right', 'column-drop-target']);
    removeClassesFromNodeList(getElColumnsContainer().querySelectorAll('.column'), ['drag-over-top', 'drag-over-bottom', 'drag-over-left', 'drag-over-right']);
    removeClassFromNodeList(getElColumnsContainer().querySelectorAll('.stack-drop-zone'), 'active');
    removeClassFromNodeList(getElBoardList().querySelectorAll('.tree-children.tree-stack-drop-zone.tree-drop-stack-target'), 'tree-drop-stack-target');
    removeClassFromNodeList(getElBoardList().querySelectorAll('.tree-node.drop-target'), 'drop-target');
    clearCardDropIndicators();
    clearCardDragOverHighlights();
    clearSidebarDropHighlights();
  }

  // --- Header Drop Tag ---

  function resolveHeaderDropTag(mx, my) {
    var incomingBtn = document.getElementById('btn-incoming');
    var parkedBtn = document.getElementById('btn-parked');
    var archiveBtn = document.getElementById('btn-archived');
    var trashBtn = document.getElementById('btn-trash');
    if (incomingBtn && isPointInsideRect(mx, my, incomingBtn.getBoundingClientRect())) return '#hidden-internal-incoming';
    if (parkedBtn && isPointInsideRect(mx, my, parkedBtn.getBoundingClientRect())) return '#hidden-internal-parked';
    if (archiveBtn && isPointInsideRect(mx, my, archiveBtn.getBoundingClientRect())) return '#hidden-internal-archived';
    if (trashBtn && isPointInsideRect(mx, my, trashBtn.getBoundingClientRect())) return '#hidden-internal-deleted';
    return null;
  }

  async function applyPtrDragHiddenTag(type, src, tag) {
    if (type === 'tree-row' || type === 'board-row') {
      await _deps.setRowHiddenTag(src.rowIndex, tag);
    } else if (type === 'tree-stack' || type === 'board-stack') {
      await _deps.setStackHiddenTag(src.rowIndex, src.stackIndex, tag);
    } else if (type === 'column' || type === 'tree-column') {
      var stack = _deps.findFullDataStack(src.rowIndex, src.stackIndex);
      if (stack) {
        var fullColIdx = _deps.findFullColumnIndexInStack(stack, src.colIndex);
        if (fullColIdx >= 0 && stack.columns[fullColIdx]) {
          _deps.pushUndo();
          stack.columns[fullColIdx].title = _deps.applyInternalHiddenTag(stack.columns[fullColIdx].title || '', tag);
          await _deps.persistBoardMutation({ refreshMainView: true, refreshSidebar: true });
        }
      }
    } else if (type === 'tree-card') {
      if (typeof src.flatColIndex === 'number' && typeof src.cardIndex === 'number') {
        _deps.tagCard(src.flatColIndex, src.cardIndex, tag);
      }
    }
  }

  // --- Row/Stack/Column Drop ---

  function getSourceRowIndex(source) {
    if (!source) return -1;
    if (typeof source.rowIndex === 'number') return source.rowIndex;
    if (typeof source.index === 'number') return source.index;
    return -1;
  }

  function getRowDropTarget(mx, my) {
    var activeBoardId = _deps.getActiveBoardId();
    var boardTarget = ptrFindDropTarget(getElColumnsContainer().querySelectorAll('.board-row'), mx, my, true);
    if (boardTarget) {
      var boardRowIdx = parseInt(boardTarget.node.getAttribute('data-row-index'), 10);
      if (!isNaN(boardRowIdx)) {
        return {
          boardId: activeBoardId,
          rowIndex: boardRowIdx,
          before: boardTarget.before,
          indexMode: 'display'
        };
      }
    }
    var treeTarget = ptrFindDropTarget(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-row"]'), mx, my, true);
    if (treeTarget) {
      var treeBoardId = treeTarget.node.getAttribute('data-board-id') || activeBoardId;
      var treeRowIdx = parseInt(treeTarget.node.getAttribute('data-row-index'), 10);
      if (!isNaN(treeRowIdx)) {
        return {
          boardId: treeBoardId,
          rowIndex: treeRowIdx,
          before: treeTarget.before,
          indexMode: treeBoardId === activeBoardId ? 'display' : 'full'
        };
      }
    }
    return null;
  }

  function resolveRowBodyDropTarget(mx, my) {
    var activeBoardId = _deps.getActiveBoardId();
    var boardRowNode = findNodeAtPoint(getElColumnsContainer().querySelectorAll('.board-row'), mx, my);
    if (boardRowNode) {
      var boardRect = boardRowNode.getBoundingClientRect();
      var boardEdge = Math.min(40, boardRect.height * 0.25);
      if (my > boardRect.top + boardEdge && my < boardRect.bottom - boardEdge) {
        var boardRowIdx = parseInt(boardRowNode.getAttribute('data-row-index'), 10);
        if (!isNaN(boardRowIdx)) {
          return {
            node: boardRowNode,
            boardId: activeBoardId,
            rowIndex: boardRowIdx,
            indexMode: 'display'
          };
        }
      }
    }

    var treeRowNode = findNodeAtPoint(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-row"]'), mx, my);
    if (treeRowNode) {
      var treeRect = treeRowNode.getBoundingClientRect();
      var treeEdge = Math.min(16, treeRect.height * 0.25);
      if (my > treeRect.top + treeEdge && my < treeRect.bottom - treeEdge) {
        var treeBoardId = treeRowNode.getAttribute('data-board-id') || activeBoardId;
        var treeRowIdx = parseInt(treeRowNode.getAttribute('data-row-index'), 10);
        if (!isNaN(treeRowIdx)) {
          return {
            node: treeRowNode,
            boardId: treeBoardId,
            rowIndex: treeRowIdx,
            indexMode: treeBoardId === activeBoardId ? 'display' : 'full'
          };
        }
      }
    }
    return null;
  }

  function resolveCanvasRowContentDropTarget(mx, my) {
    var activeBoardId = _deps.getActiveBoardId();
    if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function') {
      var hit = document.elementFromPoint(mx, my);
      var rowContent = hit && typeof hit.closest === 'function' ? hit.closest('.board-row-content') : null;
      if (rowContent) {
        var rowNode = rowContent.closest('.board-row');
        var rowIndex = rowNode ? parseInt(rowNode.getAttribute('data-row-index'), 10) : NaN;
        if (!isNaN(rowIndex)) {
          return {
            node: rowNode,
            contentNode: rowContent,
            boardId: activeBoardId,
            rowIndex: rowIndex,
            indexMode: 'display'
          };
        }
      }
    }
    return resolveRowBodyDropTarget(mx, my);
  }

  function getCanvasRowContentNodeFromDropTarget(target, fallbackNode) {
    return _deps.getCanvasDomApi().getCanvasRowContentNodeFromDropTarget(target, fallbackNode);
  }

  function getStackDropTarget(mx, my) {
    var activeBoardId = _deps.getActiveBoardId();
    var boardTarget = ptrFindDropTarget(getElColumnsContainer().querySelectorAll('.board-stack'), mx, my, false);
    if (boardTarget) {
      var boardRowIdx = parseInt(boardTarget.node.getAttribute('data-row-index'), 10);
      var boardStackIdx = parseInt(boardTarget.node.getAttribute('data-stack-index'), 10);
      if (!isNaN(boardRowIdx) && !isNaN(boardStackIdx)) {
        return {
          boardId: activeBoardId,
          rowIndex: boardRowIdx,
          stackIndex: boardStackIdx,
          before: boardTarget.before,
          indexMode: 'display'
        };
      }
    }
    var treeTarget = ptrFindDropTarget(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-stack"]'), mx, my, true);
    if (treeTarget) {
      var treeBoardId = treeTarget.node.getAttribute('data-board-id') || activeBoardId;
      var treeRowIdx = parseInt(treeTarget.node.getAttribute('data-row-index'), 10);
      var treeStackIdx = parseInt(treeTarget.node.getAttribute('data-stack-index'), 10);
      if (!isNaN(treeRowIdx) && !isNaN(treeStackIdx)) {
        return {
          boardId: treeBoardId,
          rowIndex: treeRowIdx,
          stackIndex: treeStackIdx,
          before: treeTarget.before,
          indexMode: treeBoardId === activeBoardId ? 'display' : 'full'
        };
      }
    }
    return null;
  }

  function applyRowDropByPoint(source, mx, my) {
    if (!source) return false;
    var activeBoardId = _deps.getActiveBoardId();
    var srcBoardId = source.boardId || activeBoardId;
    var srcRowIdx = getSourceRowIndex(source);
    if (!srcBoardId || srcRowIdx < 0) return false;

    var rowTarget = getRowDropTarget(mx, my);
    if (!rowTarget || !rowTarget.boardId || rowTarget.rowIndex < 0) return false;

    var srcIndexMode = source.indexMode || (srcBoardId === activeBoardId ? 'display' : 'full');
    var targetIndexMode = rowTarget.indexMode || (rowTarget.boardId === activeBoardId ? 'display' : 'full');

    if (
      srcBoardId === rowTarget.boardId &&
      srcBoardId === activeBoardId &&
      srcIndexMode === 'display' &&
      targetIndexMode === 'display'
    ) {
      if (srcRowIdx !== rowTarget.rowIndex) {
        _deps.reorderRows(srcRowIdx, rowTarget.rowIndex, rowTarget.before);
      }
      return true;
    }

    _deps.moveRowAcrossBoards(
      { boardId: srcBoardId, rowIndex: srcRowIdx, indexMode: srcIndexMode },
      {
        boardId: rowTarget.boardId,
        rowIndex: rowTarget.rowIndex,
        before: rowTarget.before,
        indexMode: targetIndexMode
      }
    ).catch(function (err) {
      _deps.lexeraLog('error', '[moveRowAcrossBoards] Drop failed: ' + err);
    });
    return true;
  }

  function applyStackDropByPoint(source, mx, my) {
    if (!source) return false;
    var activeBoardId = _deps.getActiveBoardId();
    var srcBoardId = source.boardId || activeBoardId;
    var srcRowIdx = parseInt(source.rowIndex, 10);
    var srcStackIdx = parseInt(source.stackIndex, 10);
    if (!srcBoardId || isNaN(srcRowIdx) || isNaN(srcStackIdx) || srcRowIdx < 0 || srcStackIdx < 0) return false;

    var srcIndexMode = source.indexMode || (srcBoardId === activeBoardId ? 'display' : 'full');
    var canvasStackTarget = _deps.getCanvasStackDropApi().resolveCanvasStackDropTarget({
      isCanvasLayout: _deps.isCanvasBoardLayout(),
      activeBoardId: activeBoardId,
      clientX: mx,
      clientY: my,
      grabOffsetX: ptrDrag && typeof ptrDrag.grabOffsetX === 'number' ? ptrDrag.grabOffsetX : 0,
      grabOffsetY: ptrDrag && typeof ptrDrag.grabOffsetY === 'number' ? ptrDrag.grabOffsetY : 0,
      fallbackRowContent: ptrDrag && ptrDrag.canvasSourceRowContent ? ptrDrag.canvasSourceRowContent : null,
      resolveCanvasRowContentDropTarget: resolveCanvasRowContentDropTarget,
      getCanvasRowContentNodeFromDropTarget: getCanvasRowContentNodeFromDropTarget,
      getCanvasDropPositionInRowContent: getCanvasDropPositionInRowContent
    });
    if (canvasStackTarget) {
      _deps.moveStackAcrossBoards(
        { boardId: srcBoardId, rowIndex: srcRowIdx, stackIndex: srcStackIdx, indexMode: srcIndexMode },
        canvasStackTarget
      ).catch(function (err) {
        _deps.lexeraLog('error', '[moveStackAcrossBoards] Canvas drop failed: ' + err);
      });
      return true;
    }

    var stackTarget = getStackDropTarget(mx, my);
    if (stackTarget && stackTarget.boardId && stackTarget.rowIndex >= 0 && stackTarget.stackIndex >= 0) {
      var targetIndexMode = stackTarget.indexMode || (stackTarget.boardId === activeBoardId ? 'display' : 'full');

      if (
        srcBoardId === stackTarget.boardId &&
        srcBoardId === activeBoardId &&
        srcIndexMode === 'display' &&
        targetIndexMode === 'display'
      ) {
        if (srcRowIdx !== stackTarget.rowIndex || srcStackIdx !== stackTarget.stackIndex) {
          _deps.moveStack(srcRowIdx, srcStackIdx, stackTarget.rowIndex, stackTarget.stackIndex, stackTarget.before);
        }
        return true;
      }

      _deps.moveStackAcrossBoards(
        { boardId: srcBoardId, rowIndex: srcRowIdx, stackIndex: srcStackIdx, indexMode: srcIndexMode },
        {
          boardId: stackTarget.boardId,
          rowIndex: stackTarget.rowIndex,
          stackIndex: stackTarget.stackIndex,
          before: stackTarget.before,
          indexMode: targetIndexMode
        }
      ).catch(function (err) {
        _deps.lexeraLog('error', '[moveStackAcrossBoards] Drop failed: ' + err);
      });
      return true;
    }

    var rowBodyTarget = resolveRowBodyDropTarget(mx, my);
    if (rowBodyTarget && rowBodyTarget.boardId) {
      _deps.moveStackAcrossBoards(
        { boardId: srcBoardId, rowIndex: srcRowIdx, stackIndex: srcStackIdx, indexMode: srcIndexMode },
        {
          kind: 'row',
          boardId: rowBodyTarget.boardId,
          rowIndex: rowBodyTarget.rowIndex,
          indexMode: rowBodyTarget.indexMode
        }
      ).catch(function (err) {
        _deps.lexeraLog('error', '[moveStackAcrossBoards] Drop to row failed: ' + err);
      });
      return true;
    }

    var rowTarget = getRowDropTarget(mx, my);
    if (rowTarget && rowTarget.boardId && rowTarget.rowIndex >= 0) {
      _deps.moveStackAcrossBoards(
        { boardId: srcBoardId, rowIndex: srcRowIdx, stackIndex: srcStackIdx, indexMode: srcIndexMode },
        {
          kind: 'new-row',
          boardId: rowTarget.boardId,
          rowIndex: rowTarget.rowIndex,
          before: rowTarget.before,
          indexMode: rowTarget.indexMode
        }
      ).catch(function (err) {
        _deps.lexeraLog('error', '[moveStackAcrossBoards] Drop to new row failed: ' + err);
      });
      return true;
    }
    return false;
  }

  function getCanvasDropPositionInRowContent(rowContent, clientX, clientY, grabOffsetX, grabOffsetY) {
    return _deps.getCanvasPositionFromViewportPoint(rowContent, clientX, clientY, grabOffsetX, grabOffsetY);
  }

  function clearCanvasDragStyles(stackEl) {
    if (!stackEl) return;
    stackEl.style.zIndex = '';
    stackEl.style.width = '';
    stackEl.style.position = '';
    stackEl.style.pointerEvents = '';
  }

  function applyCanvasStackDrop(source, mx, my) {
    if (!source || !ptrDrag || !ptrDrag.el) return false;
    var activeBoardId = _deps.getActiveBoardId();
    var stackEl = ptrDrag.el;
    var sourceRow = _deps.findFullDataRow(source.rowIndex);
    var sourceStack = _deps.findFullDataStack(source.rowIndex, source.stackIndex);
    if (!sourceRow || !sourceStack) return false;

    var targetRow = sourceRow;
    var targetRowTarget = resolveCanvasRowContentDropTarget(mx, my);
    var targetRowContent = ptrDrag.canvasSourceRowContent || stackEl.closest('.board-row-content');
    if (
      targetRowTarget &&
      targetRowTarget.boardId === activeBoardId &&
      targetRowTarget.indexMode === 'display'
    ) {
      var resolvedTargetRow = _deps.findFullDataRow(targetRowTarget.rowIndex);
      if (resolvedTargetRow) {
        targetRow = resolvedTargetRow;
      }
      targetRowContent = getCanvasRowContentNodeFromDropTarget(targetRowTarget, targetRowContent);
    }
    var nextCanvasPos = getCanvasDropPositionInRowContent(
      targetRowContent,
      mx,
      my,
      ptrDrag.grabOffsetX,
      ptrDrag.grabOffsetY
    );
    var newX = nextCanvasPos.x;
    var newY = nextCanvasPos.y;

    _deps.pushUndo();
    if (targetRow !== sourceRow) {
      var sourceFullStackIdx = _deps.findFullDataStackIndex(sourceRow, source.rowIndex, source.stackIndex);
      if (sourceFullStackIdx === -1) {
        clearCanvasDragStyles(stackEl);
        return false;
      }
      var movedStack = sourceRow.stacks.splice(sourceFullStackIdx, 1)[0];
      if (!movedStack) {
        clearCanvasDragStyles(stackEl);
        return false;
      }
      if (!movedStack.params) movedStack.params = {};
      movedStack.params.x = String(newX);
      movedStack.params.y = String(newY);
      if (!Array.isArray(targetRow.stacks)) targetRow.stacks = [];
      targetRow.stacks.push(movedStack);
      _deps.removeEmptyStacksAndRows();
      clearCanvasDragStyles(stackEl);
      _deps.persistBoardMutation({ refreshSidebar: true });
      return true;
    }
    if (!sourceStack.params) sourceStack.params = {};
    sourceStack.params.x = String(newX);
    sourceStack.params.y = String(newY);
    clearCanvasDragStyles(stackEl);
    _deps.persistBoardMutation({ refreshSidebar: true });
    return true;
  }

  // --- Tree Drop Targets ---

  function getTreeColumnDropTarget(mx, my) {
    var activeBoardId = _deps.getActiveBoardId();
    var treeTarget = resolveDropTargetStrict(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-column"]'), mx, my, true);
    if (!treeTarget) return null;
    var boardId = treeTarget.node.getAttribute('data-board-id') || activeBoardId;
    var rowIdx = parseInt(treeTarget.node.getAttribute('data-row-index'), 10);
    var stackIdx = parseInt(treeTarget.node.getAttribute('data-stack-index'), 10);
    var colIdx = parseInt(treeTarget.node.getAttribute('data-col-local-index'), 10);
    if (isNaN(rowIdx) || isNaN(stackIdx) || isNaN(colIdx)) return null;
    return {
      boardId: boardId,
      rowIndex: rowIdx,
      stackIndex: stackIdx,
      colIndex: colIdx,
      before: treeTarget.before,
      indexMode: boardId === activeBoardId ? 'display' : 'full'
    };
  }

  function getTreeStackDropTarget(mx, my) {
    var activeBoardId = _deps.getActiveBoardId();
    var treeTarget = resolveDropTargetStrict(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-stack"]'), mx, my, true);
    if (treeTarget) {
      var boardId = treeTarget.node.getAttribute('data-board-id') || activeBoardId;
      var rowIdx = parseInt(treeTarget.node.getAttribute('data-row-index'), 10);
      var stackIdx = parseInt(treeTarget.node.getAttribute('data-stack-index'), 10);
      if (!isNaN(rowIdx) && !isNaN(stackIdx)) {
        return {
          boardId: boardId,
          rowIndex: rowIdx,
          stackIndex: stackIdx,
          before: treeTarget.before,
          indexMode: boardId === activeBoardId ? 'display' : 'full'
        };
      }
    }
    var zone = findNodeAtPoint(getElBoardList().querySelectorAll('.tree-children.tree-stack-drop-zone'), mx, my);
    if (!zone) return null;
    var zoneBoardId = zone.getAttribute('data-board-id') || activeBoardId;
    var zoneRowIdx = parseInt(zone.getAttribute('data-row-index'), 10);
    var zoneStackIdx = parseInt(zone.getAttribute('data-stack-index'), 10);
    if (isNaN(zoneRowIdx) || isNaN(zoneStackIdx)) return null;
    return {
      boardId: zoneBoardId,
      rowIndex: zoneRowIdx,
      stackIndex: zoneStackIdx,
      before: false,
      indexMode: zoneBoardId === activeBoardId ? 'display' : 'full'
    };
  }

  function getTreeCardDropTarget(mx, my) {
    var activeBoardId = _deps.getActiveBoardId();
    var treeTarget = ptrFindStrictHitNode(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-card"]'), mx, my, 'tree-drop-above', 'tree-drop-below', true);
    if (!treeTarget) return null;
    var boardId = treeTarget.node.getAttribute('data-board-id') || activeBoardId;
    var rowIdx = parseInt(treeTarget.node.getAttribute('data-row-index'), 10);
    var stackIdx = parseInt(treeTarget.node.getAttribute('data-stack-index'), 10);
    var colIdx = parseInt(treeTarget.node.getAttribute('data-col-local-index'), 10);
    var cardIdx = parseInt(treeTarget.node.getAttribute('data-card-index'), 10);
    if (isNaN(rowIdx) || isNaN(stackIdx) || isNaN(colIdx) || isNaN(cardIdx)) return null;
    return {
      kind: 'sidebar',
      boardId: boardId,
      rowIndex: rowIdx,
      stackIndex: stackIdx,
      colIndex: colIdx,
      cardIndex: cardIdx,
      before: treeTarget.before,
      indexMode: boardId === activeBoardId ? 'display' : 'full'
    };
  }

  // --- Execute Ptr Drop ---

  function executePtrDrop(mx, my) {
    var type = ptrDrag.type;
    var src = ptrDrag.source;

    if (type !== 'board') {
      var headerTag = resolveHeaderDropTag(mx, my);
      if (headerTag) {
        applyPtrDragHiddenTag(type, src, headerTag);
        return;
      }
    }

    if (type === 'tree-row' || type === 'board-row') {
      applyRowDropByPoint(src, mx, my);
    } else if (type === 'tree-stack' || type === 'board-stack') {
      if (ptrDrag.canvasMove) {
        applyCanvasStackDrop(src, mx, my);
      } else {
        applyStackDropByPoint(src, mx, my);
      }
    } else if (type === 'board') {
      var t = ptrFindDropTarget(getElBoardList().querySelectorAll('.board-item'), mx, my, true);
      if (t) {
        var targetIdx = parseInt(t.node.getAttribute('data-board-index'), 10);
        if (src.index !== targetIdx) _deps.reorderBoards(src.index, targetIdx, t.before);
      }
    } else if (type === 'column' || type === 'tree-column') {
      executeColumnPtrDrop(mx, my, src);
    } else if (type === 'tree-card') {
      if (!isNaN(src.cardIndex)) {
        applyCardDropByPoint(src, mx, my);
      }
    }
  }

  function executeColumnPtrDrop(mx, my, src) {
    var activeBoardId = _deps.getActiveBoardId();

    function isSameActiveBoardDisplayTarget(target) {
      return (
        src &&
        src.boardId === activeBoardId &&
        src.indexMode === 'display' &&
        target &&
        target.boardId === activeBoardId &&
        target.indexMode === 'display'
      );
    }

    function moveAcross(targetDef) {
      _deps.moveColumnAcrossBoards(src, targetDef).catch(function (err) {
        _deps.lexeraLog('error', '[moveColumnAcrossBoards] Drop failed: ' + err);
      });
    }

    var zone = findStackDropZoneAt(mx, my);
    if (zone) {
      var targetRowIdx = parseInt(zone.getAttribute('data-row-index'), 10);
      var insertIdx = parseInt(zone.getAttribute('data-insert-index'), 10);
      var zoneTarget = {
        kind: 'new-stack',
        boardId: activeBoardId,
        rowIndex: targetRowIdx,
        insertAtStackIdx: insertIdx,
        indexMode: 'display'
      };
      if (isSameActiveBoardDisplayTarget(zoneTarget)) {
        _deps.moveColumnToNewStack(src.rowIndex, src.stackIndex, src.colIndex, targetRowIdx, insertIdx);
      } else {
        moveAcross(zoneTarget);
      }
      return;
    }
    var column = findDraggableColumnAt(mx, my);
    if (column) {
      var colRect = column.getBoundingClientRect();
      var stackEl = column.closest('.board-stack');
      var targetRowIdx = parseInt(stackEl.getAttribute('data-row-index'), 10);
      var targetStackIdx = parseInt(stackEl.getAttribute('data-stack-index'), 10);
      var columns = stackEl.querySelectorAll('.board-stack-content > .column');
      var targetColIdx = Array.prototype.indexOf.call(columns, column);
      var insertBefore = _deps.isHorizontalCanvasStackElement(stackEl)
        ? (mx < colRect.left + colRect.width / 2)
        : (my < colRect.top + colRect.height / 2);
      var colTarget = {
        kind: 'column',
        boardId: activeBoardId,
        rowIndex: targetRowIdx,
        stackIndex: targetStackIdx,
        colIndex: targetColIdx,
        before: insertBefore,
        indexMode: 'display'
      };
      if (isSameActiveBoardDisplayTarget(colTarget)) {
        _deps.moveColumnWithinBoard(src.rowIndex, src.stackIndex, src.colIndex, targetRowIdx, targetStackIdx, targetColIdx, insertBefore);
      } else {
        moveAcross(colTarget);
      }
      return;
    }
    var stack = findBoardStackAt(mx, my);
    if (stack) {
      var targetRowIdx = parseInt(stack.getAttribute('data-row-index'), 10);
      var targetStackIdx = parseInt(stack.getAttribute('data-stack-index'), 10);
      var stackTarget = {
        kind: 'stack',
        boardId: activeBoardId,
        rowIndex: targetRowIdx,
        stackIndex: targetStackIdx,
        indexMode: 'display'
      };
      if (isSameActiveBoardDisplayTarget(stackTarget)) {
        if (src.rowIndex !== targetRowIdx || src.stackIndex !== targetStackIdx) {
          _deps.moveColumnToExistingStack(src.rowIndex, src.stackIndex, src.colIndex, targetRowIdx, targetStackIdx);
        }
      } else {
        moveAcross(stackTarget);
      }
      return;
    }

    var treeColTarget = getTreeColumnDropTarget(mx, my);
    if (treeColTarget) {
      if (isSameActiveBoardDisplayTarget(treeColTarget)) {
        if (src.rowIndex !== treeColTarget.rowIndex || src.stackIndex !== treeColTarget.stackIndex || src.colIndex !== treeColTarget.colIndex) {
          _deps.moveColumnWithinBoard(
            src.rowIndex,
            src.stackIndex,
            src.colIndex,
            treeColTarget.rowIndex,
            treeColTarget.stackIndex,
            treeColTarget.colIndex,
            treeColTarget.before
          );
        }
      } else {
        moveAcross({
          kind: 'column',
          boardId: treeColTarget.boardId,
          rowIndex: treeColTarget.rowIndex,
          stackIndex: treeColTarget.stackIndex,
          colIndex: treeColTarget.colIndex,
          before: treeColTarget.before,
          indexMode: treeColTarget.indexMode
        });
      }
      return;
    }

    var treeStackTarget = getTreeStackDropTarget(mx, my);
    if (treeStackTarget) {
      if (isSameActiveBoardDisplayTarget(treeStackTarget)) {
        if (src.rowIndex !== treeStackTarget.rowIndex || src.stackIndex !== treeStackTarget.stackIndex) {
          _deps.moveColumnToExistingStack(src.rowIndex, src.stackIndex, src.colIndex, treeStackTarget.rowIndex, treeStackTarget.stackIndex);
        }
      } else {
        moveAcross({
          kind: 'stack',
          boardId: treeStackTarget.boardId,
          rowIndex: treeStackTarget.rowIndex,
          stackIndex: treeStackTarget.stackIndex,
          indexMode: treeStackTarget.indexMode
        });
      }
      return;
    }

    var rowBodyTarget = resolveRowBodyDropTarget(mx, my);
    if (rowBodyTarget && rowBodyTarget.boardId) {
      moveAcross({
        kind: 'row',
        boardId: rowBodyTarget.boardId,
        rowIndex: rowBodyTarget.rowIndex,
        indexMode: rowBodyTarget.indexMode
      });
      return;
    }

    var rowTarget = getRowDropTarget(mx, my);
    if (rowTarget && rowTarget.boardId && rowTarget.rowIndex >= 0) {
      moveAcross({
        kind: 'new-row',
        boardId: rowTarget.boardId,
        rowIndex: rowTarget.rowIndex,
        before: rowTarget.before,
        indexMode: rowTarget.indexMode
      });
    }
  }

  // --- Ptr Drag Cleanup ---

  function cleanupPtrDrag() {
    _deps.removeStackDropZones();
    _deps.removeDropZoneIndicators();
    clearHeaderDropTargetHighlights();
    stopCrossViewBridge();
    unlockBoardLayoutForDrag();
    if (ptrDrag) {
      if (ptrDrag.el) {
        ptrDrag.el.classList.remove('dragging');
        if (ptrDrag.canvasMove) {
          ptrDrag.el.style.zIndex = '';
          ptrDrag.el.style.width = '';
          ptrDrag.el.style.position = '';
          ptrDrag.el.style.pointerEvents = '';
        }
      }
      if (ptrDrag.ghost) ptrDrag.ghost.remove();
      ptrDrag = null;
    }
    clearPtrDropIndicators();
    _deps.vsRestoreAfterDrag();
  }

  // --- External DnD Bridge Registration ---

  function registerExternalDndBridge() {
    window.__lexeraExternalDnd = {
      hover: function (payload, x, y) {
        if (!payload || !payload.source) return false;
        if (payload.type === 'tree-card') {
          return updateCardDropTarget(x, y);
        }
        if (
          payload.type === 'board-row' ||
          payload.type === 'tree-row' ||
          payload.type === 'board-stack' ||
          payload.type === 'tree-stack' ||
          payload.type === 'column' ||
          payload.type === 'tree-column'
        ) {
          return updatePtrDropTargetByType(payload.type, x, y);
        }
        return false;
      },
      drop: function (payload, x, y) {
        if (!payload || !payload.source) return false;
        if (payload.type === 'tree-card') {
          return applyCardDropByPoint(payload.source, x, y);
        }
        if (payload.type === 'board-row' || payload.type === 'tree-row') {
          return applyRowDropByPoint(payload.source, x, y);
        }
        if (payload.type === 'board-stack' || payload.type === 'tree-stack') {
          return applyStackDropByPoint(payload.source, x, y);
        }
        if (payload.type === 'column' || payload.type === 'tree-column') {
          executeColumnPtrDrop(x, y, payload.source);
          return true;
        }
        return false;
      },
      clear: function () {
        clearPtrDropIndicators();
      }
    };
  }

  // --- Init & Public API ---

  function init(deps) {
    _deps = deps || {};
  }

  return {
    init: init,

    // State accessors
    getCardDrag: function () { return cardDrag; },
    setCardDrag: function (v) { cardDrag = v; },
    getPtrDrag: function () { return ptrDrag; },
    setPtrDrag: function (v) { ptrDrag = v; },
    getDragLayoutLocks: function () { return dragLayoutLocks; },
    DRAG_THRESHOLD: DRAG_THRESHOLD,

    // Card drag lifecycle
    startCardDrag: startCardDrag,
    updateCardDropTarget: updateCardDropTarget,
    applyCardDropByPoint: applyCardDropByPoint,
    finishCardDrag: finishCardDrag,
    cancelCardDrag: cancelCardDrag,
    cleanupCardDrag: cleanupCardDrag,

    // Board layout lock
    lockBoardLayoutForDrag: lockBoardLayoutForDrag,
    unlockBoardLayoutForDrag: unlockBoardLayoutForDrag,

    // Card drop indicators
    clearCardDropIndicators: clearCardDropIndicators,
    showCardDropIndicator: showCardDropIndicator,
    findCardInsertIndex: findCardInsertIndex,
    clearHeaderDropTargetHighlights: clearHeaderDropTargetHighlights,
    clearCardDragOverHighlights: clearCardDragOverHighlights,
    clearSidebarDropHighlights: clearSidebarDropHighlights,

    // Geometry helpers
    isPointInsideRect: isPointInsideRect,
    findNodeAtPoint: findNodeAtPoint,
    removeClassFromNodeList: removeClassFromNodeList,
    removeClassesFromNodeList: removeClassesFromNodeList,

    // Element finders
    findStackDropZoneAt: findStackDropZoneAt,
    findDraggableColumnAt: findDraggableColumnAt,
    findBoardStackAt: findBoardStackAt,
    findColumnCardsContainerAt: findColumnCardsContainerAt,
    findSidebarColumnAt: findSidebarColumnAt,

    // Drop target resolution
    resolveCardDropTarget: resolveCardDropTarget,
    resolveDropTarget: resolveDropTarget,
    resolveDropTargetStrict: resolveDropTargetStrict,
    resolveRowBodyDropTarget: resolveRowBodyDropTarget,
    resolveCanvasRowContentDropTarget: resolveCanvasRowContentDropTarget,
    resolveHeaderDropTag: resolveHeaderDropTag,

    // Ptr drag
    getPtrDragLabel: getPtrDragLabel,
    updatePtrDropTarget: updatePtrDropTarget,
    updatePtrDropTargetByType: updatePtrDropTargetByType,
    updateColumnPtrDropTarget: updateColumnPtrDropTarget,
    clearPtrDropIndicators: clearPtrDropIndicators,
    executePtrDrop: executePtrDrop,
    executeColumnPtrDrop: executeColumnPtrDrop,
    cleanupPtrDrag: cleanupPtrDrag,
    applyPtrDragHiddenTag: applyPtrDragHiddenTag,

    // Row/Stack/Column drop
    applyRowDropByPoint: applyRowDropByPoint,
    applyStackDropByPoint: applyStackDropByPoint,
    applyCanvasStackDrop: applyCanvasStackDrop,
    getRowDropTarget: getRowDropTarget,
    getStackDropTarget: getStackDropTarget,
    getTreeColumnDropTarget: getTreeColumnDropTarget,
    getTreeStackDropTarget: getTreeStackDropTarget,
    getTreeCardDropTarget: getTreeCardDropTarget,
    getCanvasDropPositionInRowContent: getCanvasDropPositionInRowContent,
    getCanvasRowContentNodeFromDropTarget: getCanvasRowContentNodeFromDropTarget,
    clearCanvasDragStyles: clearCanvasDragStyles,

    // Cross-view bridge
    startCrossViewBridge: startCrossViewBridge,
    stopCrossViewBridge: stopCrossViewBridge,
    toTopFramePoint: toTopFramePoint,
    toLocalFramePoint: toLocalFramePoint,
    getDragStartTopPoint: getDragStartTopPoint,
    hasCrossViewDragMovedBeyondThreshold: hasCrossViewDragMovedBeyondThreshold,
    getCrossViewDragPayload: getCrossViewDragPayload,

    // External DnD bridge
    registerExternalDndBridge: registerExternalDndBridge,

    // Hit-test helpers (exposed for delegation stubs)
    ptrFindHitNode: ptrFindHitNode,
    ptrFindStrictHitNode: ptrFindStrictHitNode,
    ptrFindDropTarget: ptrFindDropTarget,

    // Sidebar card target helpers
    buildSidebarCardTarget: buildSidebarCardTarget,
    getFirstSidebarCardTargetForBoard: getFirstSidebarCardTargetForBoard,
    getVisibleCardCountInColumn: getVisibleCardCountInColumn,
    getSourceRowIndex: getSourceRowIndex
  };
})();
window.LexeraDragDropHandlers = LexeraDragDropHandlers;
