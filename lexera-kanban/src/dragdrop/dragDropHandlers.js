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
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

  // --- State ---
  var cardDrag = null;
  var ptrDrag = null;
  var DRAG_THRESHOLD = 5;
  var dragLayoutLocks = null;
  var crossViewBridge = null;
  var _dragRectCache = null; // Array of { el, rect } cached at drag start

  // --- Dependency accessors ---
  function getElColumnsContainer() { return _deps.getElColumnsContainer(); }
  function getElBoardList() { return _deps.getElBoardList(); }

  // --- Geometry Rect Cache ---
  // Caches bounding rects at drag start so mousemove hit-testing avoids
  // repeated live DOM geometry queries (getBoundingClientRect).

  function cacheDropTargetGeometry() {
    _dragRectCache = [];
    var containers = [getElColumnsContainer(), getElBoardList(), document.body];
    for (var c = 0; c < containers.length; c++) {
      if (!containers[c]) continue;
      var targets = containers[c].querySelectorAll(
        '.column, .column-cards, .board-row, .board-stack, .stack-drop-zone, ' +
        '.card, .card:not(.dragging), ' +
        '.tree-node, .board-item, .tree-children.tree-stack-drop-zone, ' +
        '#btn-incoming, #btn-parked, #btn-archived, #btn-trash'
      );
      for (var i = 0; i < targets.length; i++) {
        _dragRectCache.push({ el: targets[i], rect: targets[i].getBoundingClientRect() });
      }
    }
  }

  function clearDropTargetGeometryCache() {
    _dragRectCache = null;
  }

  function getCachedRect(el) {
    if (_dragRectCache) {
      for (var i = 0; i < _dragRectCache.length; i++) {
        if (_dragRectCache[i].el === el) return _dragRectCache[i].rect;
      }
    }
    return el.getBoundingClientRect();
  }

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
      var rect = getCachedRect(nodeList[i]);
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

  // --- Drop-Target Kind Validator ----------------------------------------
  //
  // Each draggable element kind has a strict set of valid drop targets
  // (see TODOs-lexera.md):
  //   row    — above / between / below other rows, or on the empty board
  //   stack  — before / between / after other stacks, or on an empty row
  //   column — before / between / after other columns, or on an empty stack
  //   card   — only inside .column-cards, before / between / after other cards
  //
  // Header dock buttons (incoming / parked / archive / trash) are universal
  // drop tags accepted for every kind except 'board'.
  //
  // Returns true if the element under (mx,my) is a valid target for dragKind.
  // Used as defense-in-depth: dragover skips visual feedback for invalid
  // hovers, and apply functions reject the drop on their own re-check.
  // The kind-specific selector queries elsewhere in this module would
  // already filter most cases — this helper centralises and documents the
  // rules so they can't drift.
  function isDropTargetValidForKind(dragKind, mx, my) {
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return true;
    var targetEl = document.elementFromPoint(mx, my);
    if (!targetEl || typeof targetEl.closest !== 'function') return false;

    if (dragKind !== 'board' && (
      targetEl.closest('#btn-incoming') ||
      targetEl.closest('#btn-parked') ||
      targetEl.closest('#btn-archived') ||
      targetEl.closest('#btn-trash')
    )) return true;

    switch (dragKind) {
      case 'row':
      case 'tree-row':
      case 'board-row':
        return !!(
          targetEl.closest('.board-row') ||
          targetEl.closest('.tree-node[data-tree-drag="tree-row"]') ||
          targetEl.closest('.columns-container')
        );
      case 'stack':
      case 'tree-stack':
      case 'board-stack':
        return !!(
          targetEl.closest('.board-stack') ||
          targetEl.closest('.board-row-content') ||
          targetEl.closest('.board-row') ||
          targetEl.closest('.tree-node[data-tree-drag="tree-stack"]')
        );
      case 'column':
      case 'tree-column':
        return !!(
          targetEl.closest('.column') ||
          targetEl.closest('.board-stack') ||
          targetEl.closest('.tree-node[data-tree-drag="tree-column"]') ||
          targetEl.closest('.tree-node[data-tree-drag="tree-stack"]') ||
          targetEl.closest('.tree-children.tree-stack-drop-zone')
        );
      case 'card':
      case 'tree-card':
        return !!(
          targetEl.closest('.column-cards') ||
          targetEl.closest('.column') ||
          targetEl.closest('.tree-node[data-tree-drag="tree-card"]') ||
          targetEl.closest('.tree-column')
        );
      case 'board':
        return !!targetEl.closest('.board-item');
      default:
        return false;
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

  // --- Column ID lookup helpers ---

  function findColumnByIdInRows(rows, columnId) {
    if (!rows || !columnId) return null;
    for (var r = 0; r < rows.length; r++) {
      var stacks = rows[r] && rows[r].stacks ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        var cols = stacks[s] && stacks[s].columns ? stacks[s].columns : [];
        for (var c = 0; c < cols.length; c++) {
          if (cols[c] && String(cols[c].id) === columnId) return cols[c];
        }
      }
    }
    return null;
  }

  function findColumnByIdInBoardData(boardData, columnId) {
    if (!boardData || !columnId) return null;
    return findColumnByIdInRows(boardData.rows || [], columnId);
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
        rowId: row && row.id != null ? String(row.id) : null,
        stackId: stack && stack.id != null ? String(stack.id) : null,
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
      rowId: row && row.id != null ? String(row.id) : null,
      stackId: stack && stack.id != null ? String(stack.id) : null,
      columnId: targetCol && targetCol.id != null ? String(targetCol.id) : null,
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
        rowId: rows[0] && rows[0].id != null ? String(rows[0].id) : null,
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
      var rect = getCachedRect(cards[i]);
      if (mouseY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return cards.length;
  }

  function findSidebarCardInsertIndex(mouseY, sidebarColNode) {
    var childContainer = sidebarColNode.querySelector('.tree-children');
    if (!childContainer) return null;
    var treeCards = childContainer.querySelectorAll(':scope > .tree-node[data-tree-drag="tree-card"]');
    for (var i = 0; i < treeCards.length; i++) {
      var rect = getCachedRect(treeCards[i]);
      if (mouseY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return treeCards.length;
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
    var containerRect = getCachedRect(cardsEl);
    var y;
    if (insertIdx < cards.length && cards[insertIdx]) {
      y = getCachedRect(cards[insertIdx]).top;
    } else if (cards.length > 0) {
      y = getCachedRect(cards[cards.length - 1]).bottom;
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
    if (incomingBtn && isPointInsideRect(mx, my, getCachedRect(incomingBtn))) {
      return { kind: 'header-incoming', sidebarNode: null, container: null };
    }
    if (parkedBtn && isPointInsideRect(mx, my, getCachedRect(parkedBtn))) {
      return { kind: 'header-park', sidebarNode: null, container: null };
    }
    if (archiveBtn && isPointInsideRect(mx, my, getCachedRect(archiveBtn))) {
      return { kind: 'header-archive', sidebarNode: null, container: null };
    }
    if (trashBtn && isPointInsideRect(mx, my, getCachedRect(trashBtn))) {
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
          rowId: treeCardTarget.rowId || null,
          stackId: treeCardTarget.stackId || null,
          columnId: treeCardTarget.columnId || null,
          cardId: treeCardTarget.cardId || null,
          before: treeCardTarget.before,
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
        var sidebarColumnId = String(sidebarCol.getAttribute('data-column-id') || '').trim() || null;
        if (sidebarBoardId === activeBoardId && _deps.getFullBoardData()) {
          // Use stable column ID to find the column in fullBoardData.
          // Sidebar data-row-index/data-stack-index are full-data indices
          // (they include hidden items), but findFullDataStack expects
          // display indices — so we bypass index lookup entirely.
          var activeTargetCol = sidebarColumnId
            ? findColumnByIdInBoardData(_deps.getFullBoardData(), sidebarColumnId)
            : null;
          var sidebarPosIdx = findSidebarCardInsertIndex(my, sidebarCol);
          sidebarInsertIdx = sidebarPosIdx != null ? sidebarPosIdx : getVisibleCardCountInColumn(activeTargetCol);
        } else {
          var sidebarRows = _deps.getBoardHierarchyRows(sidebarBoardId) || [];
          var sidebarTargetCol = sidebarColumnId
            ? findColumnByIdInRows(sidebarRows, sidebarColumnId)
            : null;
          if (!sidebarTargetCol) {
            var sidebarRow = sidebarRows[sidebarRowIdx];
            var sidebarStack = sidebarRow && sidebarRow.stacks ? sidebarRow.stacks[sidebarStackIdx] : null;
            sidebarTargetCol = sidebarStack && sidebarStack.columns ? sidebarStack.columns[sidebarColIdx] : null;
          }
          var sidebarPosIdx2 = findSidebarCardInsertIndex(my, sidebarCol);
          sidebarInsertIdx = sidebarPosIdx2 != null ? sidebarPosIdx2 : getVisibleCardCountInColumn(sidebarTargetCol);
        }
        return {
          kind: 'sidebar',
          boardId: sidebarBoardId,
          rowIndex: sidebarRowIdx,
          stackIndex: sidebarStackIdx,
          colIndex: sidebarColIdx,
          rowId: String(sidebarCol.getAttribute('data-row-id') || '').trim() || null,
          stackId: String(sidebarCol.getAttribute('data-stack-id') || '').trim() || null,
          columnId: String(sidebarCol.getAttribute('data-column-id') || '').trim() || null,
          indexMode: sidebarBoardId === activeBoardId ? 'display' : 'full',
          insertIdx: sidebarInsertIdx,
          insertMode: 'visible',
          sidebarNode: sidebarCol,
          container: null
        };
      }
    }

    // Cards can only be dropped onto columns or between other cards.
    // Sidebar stacks, rows, and boards are NOT valid card drop targets.

    var targetContainer = findColumnCardsContainerAt(mx, my);
    if (targetContainer) {
      var targetColIndex = parseInt(targetContainer.getAttribute('data-col-index'), 10);
      if (!isNaN(targetColIndex)) {
        return {
          kind: 'main',
          boardId: activeBoardId,
          flatColIndex: targetColIndex,
          rowId: targetContainer.getAttribute('data-row-id') || null,
          stackId: targetContainer.getAttribute('data-stack-id') || null,
          columnId: targetContainer.getAttribute('data-column-id') || null,
          indexMode: 'display',
          insertIdx: findCardInsertIndex(my, targetContainer),
          insertMode: 'visible',
          sidebarNode: null,
          container: targetContainer
        };
      }
    }

    // Main board stacks and rows are NOT valid card drop targets.
    // Cards can only land on column-cards containers (columns) or between cards.

    return null;
  }

  // --- Card Drag Lifecycle ---

  function startCardDrag(e) {
    var el = cardDrag.el;
    lockBoardLayoutForDrag();
    startCrossViewBridge('card');
    broadcastCrossViewDragStart();
    el.classList.add('dragging');
    _deps.insertDropZoneIndicators('card');
    cacheDropTargetGeometry();

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

    if (target.container) {
      target.container.classList.add('card-drag-over');
      showCardDropIndicator(target.container, target.insertIdx);
      _deps.highlightDropZoneIndicator('card', mx, my);
      return true;
    }
    return false;
  }

  function applyCardDropByPoint(source, mx, my, onFailure) {
    if (!isDropTargetValidForKind('card', mx, my)) return false;
    var target = resolveCardDropTarget(mx, my);
    if (!target) return false;

    // Cross-view tree-source translation: when `source` arrives from
    // the workspaces / hierarchy panel via the cross-view DnD chain,
    // it carries `{ boardId, kind: 'card', entityId }` (entityId is
    // the card's stable ID per `data-tree-id` in workspaces.js:203).
    // moveCard's resolveColumnRefForCardMutation needs `columnId` OR
    // indexed positions to find the source — none of which a tree
    // source has. Translate `entityId` → `cardId` so the cardId
    // fallback in `findColumnRefByStablePath` (app.js) walks the
    // board to find the column containing this card. This is the
    // user-reported "drag from workspace to board doesn't work" fix:
    // every other stage of the chain delivered the drop correctly,
    // but moveCard bailed at sourceRef === null.
    if (source && source.entityId && !source.cardId &&
        typeof source.flatColIndex !== 'number') {
      source = Object.assign({}, source, { cardId: source.entityId });
    }

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

    // findCardInsertIndex queries `.card:not(.dragging)`, so its insertIdx
    // counts in the without-source space. moveCard's resolveInsertCardIndex
    // counts in the with-source space (column data still contains the
    // source card). For same-column drops, slots past the source slip one
    // position too high — re-add the source slot so the math agrees.
    if (
      target.kind === 'main' &&
      typeof target.insertIdx === 'number' &&
      typeof source.cardIndex === 'number' &&
      source.boardId === target.boardId &&
      typeof source.flatColIndex === 'number' &&
      typeof target.flatColIndex === 'number' &&
      source.flatColIndex === target.flatColIndex &&
      target.insertIdx > source.cardIndex
    ) {
      target.insertIdx += 1;
    }

    _deps.moveCard(source, target).catch(function (err) {
      _deps.logFrontendIssue('error', 'moveCard', 'Drop failed', err);
      if (typeof onFailure === 'function') {
        try { onFailure(); } catch (_) { /* ignore */ }
      }
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
      rowId: cardDrag.rowId || null,
      stackId: cardDrag.stackId || null,
      columnId: cardDrag.columnId || null,
      cardId: cardDrag.cardId || null,
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
    // Hide the source card element immediately so it does not flash at the
    // old position while the async moveCard rebuilds the DOM. The
    // successful path (column refresh / card-remove) replaces this DOM
    // node, so the inline display:none is harmless. The two failure paths
    // — no valid drop target, and a moveCard rejection — must restore
    // visibility, otherwise the card silently "disappears" from the
    // user's view at its original position.
    var sourceEl = cardDrag.el;
    if (sourceEl) sourceEl.style.display = 'none';
    var restoreSourceVisibility = function () {
      if (sourceEl) sourceEl.style.display = '';
    };
    var handled = applyCardDropByPoint(source, mx, my, restoreSourceVisibility);
    if (!handled) restoreSourceVisibility();
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
    clearDropTargetGeometryCache();
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

  /**
   * Unified cursor → drag-target resolver for a top-window screen point.
   *
   * Three possible outcomes:
   *   - `{ kind: 'iframe', win: Window }`   — cursor is over a same-document
   *     iframe; the existing cross-frame `__lexeraExternalDnd` path can call
   *     `win.__lexeraExternalDnd.hover(...)` directly.
   *   - `{ kind: 'native-webview', label: string }` — cursor is over a
   *     Tauri-native child webview (separate OS-level window). The bridge
   *     can't reach it with cross-frame JS; it must forward hover/drop via
   *     IPC. The `label` identifies which spawned webview.
   *   - `null` — cursor is over plain shell DOM (no foreign drop target).
   *
   * Iframe hits take precedence: if a same-document iframe footprint
   * overlaps a native-webview footprint at the same screen coord (rare
   * — would mean the iframe is in front in z-order), the iframe wins
   * because the cursor is in fact intercepting it.
   *
   * Used by Phase 5 of the workspace-viewer cross-webview-drag work.
   */
  function getDragTargetAtTopPoint(topX, topY) {
    var topWin = getTopWindowSafe();
    var hit = (topWin && topWin.document && topWin.document.elementFromPoint)
      ? topWin.document.elementFromPoint(topX, topY) : null;
    if (hit && hit.tagName === 'IFRAME' && hit.contentWindow) {
      return { kind: 'iframe', win: hit.contentWindow };
    }
    var multiview = (typeof window !== 'undefined') ? window.LexeraMultiviewWebview : null;
    if (multiview && typeof multiview.getWebviewLabelAtTopPoint === 'function') {
      var label = multiview.getWebviewLabelAtTopPoint(topX, topY);
      if (label) return { kind: 'native-webview', label: label };
    }
    return null;
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

  function toLocalFramePoint(target, topX, topY) {
    var topWin = getTopWindowSafe();
    if (!target) return null;
    if (target.kind === 'iframe') {
      var targetWin = target.win;
      if (targetWin === topWin) return { x: topX, y: topY };
      var rect = getFrameRectInTopWindow(targetWin);
      if (!rect) return null;
      return { x: topX - rect.left, y: topY - rect.top };
    }
    if (target.kind === 'native-webview') {
      var rect2 = getWebviewRectSafe(target.label);
      if (!rect2) return null;
      return { x: topX - rect2.left, y: topY - rect2.top };
    }
    return { x: topX, y: topY };
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
        rowId: cardDrag.rowId || null,
        stackId: cardDrag.stackId || null,
        columnId: cardDrag.columnId || null,
        cardId: cardDrag.cardId || null,
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
    var localPoint = toLocalFramePoint({ kind: 'iframe', win: targetWin }, topX, topY);
    if (!localPoint) return false;
    return !!api.drop(payload, localPoint.x, localPoint.y);
  }

  function tryExternalFrameHover(targetWin, payload, topX, topY) {
    if (!targetWin || !payload || !payload.source) return false;
    var api = targetWin.__lexeraExternalDnd;
    if (!api || typeof api.hover !== 'function') return false;
    var localPoint = toLocalFramePoint({ kind: 'iframe', win: targetWin }, topX, topY);
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

  function tryExternalNativeHover(label, payload, topX, topY) {
    var multiview = (typeof window !== 'undefined') ? window.LexeraMultiview : null;
    if (!multiview || typeof multiview.invoke !== 'function') return false;
    var localPoint = toLocalFramePoint({ kind: 'native-webview', label: label }, topX, topY);
    if (!localPoint) return false;

    multiview.invoke('multiview_emit_to', {
      target: label,
      event: 'external-dnd-hover',
      payload: {
        payload: payload,
        x: localPoint.x,
        y: localPoint.y
      }
    }).catch(function () { /* non-fatal */ });
    return true;
  }

  function tryExternalNativeDrop(label, payload, topX, topY) {
    var multiview = (typeof window !== 'undefined') ? window.LexeraMultiview : null;
    if (!multiview || typeof multiview.invoke !== 'function') return false;
    var localPoint = toLocalFramePoint({ kind: 'native-webview', label: label }, topX, topY);
    if (!localPoint) return false;

    multiview.invoke('multiview_emit_to', {
      target: label,
      event: 'external-dnd-drop',
      payload: {
        payload: payload,
        x: localPoint.x,
        y: localPoint.y
      }
    }).catch(function () { /* non-fatal */ });
    return true;
  }

  function tryExternalNativeClear(label) {
    var multiview = (typeof window !== 'undefined') ? window.LexeraMultiview : null;
    if (!multiview || typeof multiview.invoke !== 'function') return;

    multiview.invoke('multiview_emit_to', {
      target: label,
      event: 'external-dnd-clear',
      payload: {}
    }).catch(function () { /* non-fatal */ });
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
    if (!crossViewBridge) return;
    if (crossViewBridge.hoverWin) {
      tryExternalFrameClear(crossViewBridge.hoverWin);
      crossViewBridge.hoverWin = null;
    }
    if (crossViewBridge.hoverLabel) {
      tryExternalNativeClear(crossViewBridge.hoverLabel);
      crossViewBridge.hoverLabel = null;
    }
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
    // Skip if target is the drag source window (can't drop on yourself)
    if (!targetWin || targetWin === crossViewBridge.sourceWin) {
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
    if (!topWin) return;
    var sourceWin = window; // the window where the drag originated

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
      // Show ghost when hovering over any window that isn't the drag source
      if (targetWin && targetWin !== sourceWin) {
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
      // Skip if target is the drag source (handled by local mouseup)
      if (!targetWin || targetWin === sourceWin) return;
      var crossedThreshold = hasCrossViewDragMovedBeyondThreshold(kind, topPoint);
      if (!crossedThreshold) {
        if (kind === 'card' && cardDrag && !cardDrag.started) cancelCardDrag();
        else if (kind === 'ptr' && ptrDrag && !ptrDrag.started) cleanupPtrDrag();
        stopCrossViewBridge();
        return;
      }

      var payload = getCrossViewDragPayload(kind);
      var dropped =
        payload && targetWin !== sourceWin
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

    crossViewBridge = { topWin: topWin, sourceWin: sourceWin, kind: kind, targets: bridgeTargets, hoverWin: null, topGhost: null };
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

    // Reject hovers over targets that don't match the dragged element's kind
    // (e.g. dragging a row over a card). No drop indicator is shown so the
    // user gets clear visual feedback that this drop will be rejected.
    if (!isDropTargetValidForKind(type, mx, my)) return false;

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
      // Stacks can only drop onto rows or between other stacks — not between rows.
      return false;
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
      // Columns can only drop onto stacks or between other columns — not onto rows.
      return false;
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
      var rect = getCachedRect(nodeList[i]);
      if (isPointInsideRect(mx, my, rect)) {
        var before = vertical ? (my < rect.top + rect.height / 2) : (mx < rect.left + rect.width / 2);
        return { node: nodeList[i], before: before };
      }
    }

    var lastInRange = null;
    for (var i = 0; i < nodeList.length; i++) {
      var rect = getCachedRect(nodeList[i]);
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
      var rect = getCachedRect(nodeList[i]);
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
    // Columns can only drop onto stacks or between other columns.
    // Stack drop zones (between stacks) are NOT valid — columns don't create new stacks.
    var column = findDraggableColumnAt(mx, my);
    if (column) {
      var colRect = getCachedRect(column);
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
    if (incomingBtn && isPointInsideRect(mx, my, getCachedRect(incomingBtn))) return '#hidden-internal-incoming';
    if (parkedBtn && isPointInsideRect(mx, my, getCachedRect(parkedBtn))) return '#hidden-internal-parked';
    if (archiveBtn && isPointInsideRect(mx, my, getCachedRect(archiveBtn))) return '#hidden-internal-archived';
    if (trashBtn && isPointInsideRect(mx, my, getCachedRect(trashBtn))) return '#hidden-internal-deleted';
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
          await _deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
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
          rowId: String(boardTarget.node.getAttribute('data-row-id') || '').trim() || null,
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
          rowId: String(treeTarget.node.getAttribute('data-row-id') || '').trim() || null,
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
      var boardRect = getCachedRect(boardRowNode);
      var boardEdge = Math.min(40, boardRect.height * 0.25);
      if (my > boardRect.top + boardEdge && my < boardRect.bottom - boardEdge) {
        var boardRowIdx = parseInt(boardRowNode.getAttribute('data-row-index'), 10);
        if (!isNaN(boardRowIdx)) {
          return {
            node: boardRowNode,
            boardId: activeBoardId,
            rowIndex: boardRowIdx,
            rowId: String(boardRowNode.getAttribute('data-row-id') || '').trim() || null,
            indexMode: 'display'
          };
        }
      }
    }

    var treeRowNode = findNodeAtPoint(getElBoardList().querySelectorAll('.tree-node[data-tree-drag="tree-row"]'), mx, my);
    if (treeRowNode) {
      var treeRect = getCachedRect(treeRowNode);
      var treeEdge = Math.min(16, treeRect.height * 0.25);
      if (my > treeRect.top + treeEdge && my < treeRect.bottom - treeEdge) {
        var treeBoardId = treeRowNode.getAttribute('data-board-id') || activeBoardId;
        var treeRowIdx = parseInt(treeRowNode.getAttribute('data-row-index'), 10);
        if (!isNaN(treeRowIdx)) {
          return {
            node: treeRowNode,
            boardId: treeBoardId,
            rowIndex: treeRowIdx,
            rowId: String(treeRowNode.getAttribute('data-row-id') || '').trim() || null,
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
            rowId: rowNode ? (String(rowNode.getAttribute('data-row-id') || '').trim() || null) : null,
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
          rowId: String(boardTarget.node.getAttribute('data-row-id') || '').trim() || null,
          stackId: String(boardTarget.node.getAttribute('data-stack-id') || '').trim() || null,
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
          rowId: String(treeTarget.node.getAttribute('data-row-id') || '').trim() || null,
          stackId: String(treeTarget.node.getAttribute('data-stack-id') || '').trim() || null,
          before: treeTarget.before,
          indexMode: treeBoardId === activeBoardId ? 'display' : 'full'
        };
      }
    }
    return null;
  }

  function applyRowDropByPoint(source, mx, my) {
    if (!source) return false;
    if (!isDropTargetValidForKind('row', mx, my)) return false;
    // Cross-view tree-source: entityId is the row's stable ID. Translate
    // to rowId so resolveRowForMutation's stable-lookup path can find
    // the row when no indexed position is available. Same pattern as
    // commit 966c921f for cards.
    if (source.entityId && !source.rowId && typeof source.rowIndex !== 'number') {
      source = Object.assign({}, source, { rowId: source.entityId });
    }
    var activeBoardId = _deps.getActiveBoardId();
    var srcBoardId = source.boardId || activeBoardId;
    var srcRowIdx = getSourceRowIndex(source);
    if (!srcBoardId) return false;
    // Allow tree-source (rowIdx === -1) through when source has rowId —
    // moveRowAcrossBoards walks the loaded board to find the row by id.
    if (srcRowIdx < 0 && !source.rowId) return false;

    var rowTarget = getRowDropTarget(mx, my);
    if (!rowTarget || !rowTarget.boardId || rowTarget.rowIndex < 0) return false;

    var srcIndexMode = source.indexMode || (srcBoardId === activeBoardId ? 'display' : 'full');
    var targetIndexMode = rowTarget.indexMode || (rowTarget.boardId === activeBoardId ? 'display' : 'full');

    if (
      srcRowIdx >= 0 && // tree-source has no indexed position; skip fast path
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
      {
        boardId: srcBoardId,
        rowIndex: srcRowIdx,
        rowId: source.rowId || null,
        indexMode: srcIndexMode
      },
      {
        boardId: rowTarget.boardId,
        rowIndex: rowTarget.rowIndex,
        rowId: rowTarget.rowId || null,
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
    if (!isDropTargetValidForKind('stack', mx, my)) return false;
    // Cross-view tree-source: entityId is the stack's stable ID.
    // Translate to stackId so resolveStackForMutation's stable-lookup
    // path can find the stack when no indexed position is available.
    if (source.entityId && !source.stackId && typeof source.stackIndex !== 'number') {
      source = Object.assign({}, source, { stackId: source.entityId });
    }
    var activeBoardId = _deps.getActiveBoardId();
    var srcBoardId = source.boardId || activeBoardId;
    var srcRowIdx = parseInt(source.rowIndex, 10);
    var srcStackIdx = parseInt(source.stackIndex, 10);
    var hasIndexed = !isNaN(srcRowIdx) && !isNaN(srcStackIdx) && srcRowIdx >= 0 && srcStackIdx >= 0;
    if (!srcBoardId) return false;
    // Tree-source has no indexed position — proceed if we have stackId
    // for stable lookup. Stack drops always go through
    // moveStackAcrossBoards (no same-board fast path uses indices for
    // the cross-view case).
    if (!hasIndexed && !source.stackId) return false;

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
        {
          boardId: srcBoardId,
          rowIndex: srcRowIdx,
          stackIndex: srcStackIdx,
          rowId: source.rowId || null,
          stackId: source.stackId || null,
          indexMode: srcIndexMode
        },
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
        hasIndexed && // tree-source has no indexed position; skip fast path
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
        {
          boardId: srcBoardId,
          rowIndex: srcRowIdx,
          stackIndex: srcStackIdx,
          rowId: source.rowId || null,
          stackId: source.stackId || null,
          indexMode: srcIndexMode
        },
        {
          boardId: stackTarget.boardId,
          rowIndex: stackTarget.rowIndex,
          stackIndex: stackTarget.stackIndex,
          rowId: stackTarget.rowId || null,
          stackId: stackTarget.stackId || null,
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
        {
          boardId: srcBoardId,
          rowIndex: srcRowIdx,
          stackIndex: srcStackIdx,
          rowId: source.rowId || null,
          stackId: source.stackId || null,
          indexMode: srcIndexMode
        },
        {
          kind: 'row',
          boardId: rowBodyTarget.boardId,
          rowIndex: rowBodyTarget.rowIndex,
          rowId: rowBodyTarget.rowId || null,
          indexMode: rowBodyTarget.indexMode
        }
      ).catch(function (err) {
        _deps.lexeraLog('error', '[moveStackAcrossBoards] Drop to row failed: ' + err);
      });
      return true;
    }

    // Stacks can only drop onto rows or between other stacks — not between rows.
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
      _deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
      return true;
    }
    if (!sourceStack.params) sourceStack.params = {};
    sourceStack.params.x = String(newX);
    sourceStack.params.y = String(newY);
    clearCanvasDragStyles(stackEl);
    _deps.persistBoardMutation({ targets: [{ type: 'board' }, { type: 'sidebar' }] });
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
    if (isNaN(rowIdx) || isNaN(stackIdx) || isNaN(colIdx)) {
      if (typeof window.lexeraLog === 'function') {
        window.lexeraLog('warn', '[dragDropHandlers.getTreeColumnDropTarget] returning null — tree-column node missing/corrupt data-row/stack/col-local-index attributes (render bug)');
      }
      return null;
    }
    return {
      boardId: boardId,
      rowIndex: rowIdx,
      stackIndex: stackIdx,
      colIndex: colIdx,
      rowId: String(treeTarget.node.getAttribute('data-row-id') || '').trim() || null,
      stackId: String(treeTarget.node.getAttribute('data-stack-id') || '').trim() || null,
      columnId: String(treeTarget.node.getAttribute('data-column-id') || '').trim() || null,
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
          rowId: String(treeTarget.node.getAttribute('data-row-id') || '').trim() || null,
          stackId: String(treeTarget.node.getAttribute('data-stack-id') || '').trim() || null,
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
    if (isNaN(zoneRowIdx) || isNaN(zoneStackIdx)) {
      if (typeof window.lexeraLog === 'function') {
        window.lexeraLog('warn', '[dragDropHandlers.getTreeStackDropTarget] returning null — tree-stack-drop-zone missing/corrupt data-row/stack-index attributes (render bug)');
      }
      return null;
    }
    return {
      boardId: zoneBoardId,
      rowIndex: zoneRowIdx,
      stackIndex: zoneStackIdx,
      rowId: String(zone.getAttribute('data-row-id') || '').trim() || null,
      stackId: String(zone.getAttribute('data-stack-id') || '').trim() || null,
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
    if (isNaN(rowIdx) || isNaN(stackIdx) || isNaN(colIdx) || isNaN(cardIdx)) {
      if (typeof window.lexeraLog === 'function') {
        window.lexeraLog('warn', '[dragDropHandlers.getTreeCardDropTarget] returning null — tree-card node missing/corrupt data-row/stack/col-local/card-index attributes (render bug)');
      }
      return null;
    }
    return {
      kind: 'sidebar',
      boardId: boardId,
      rowIndex: rowIdx,
      stackIndex: stackIdx,
      colIndex: colIdx,
      cardIndex: cardIdx,
      rowId: String(treeTarget.node.getAttribute('data-row-id') || '').trim() || null,
      stackId: String(treeTarget.node.getAttribute('data-stack-id') || '').trim() || null,
      columnId: String(treeTarget.node.getAttribute('data-column-id') || '').trim() || null,
      cardId: String(treeTarget.node.getAttribute('data-card-id') || '').trim() || null,
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
      var t = ptrFindDropTarget(getElBoardList().querySelectorAll('.board-item[data-board-index][data-board-id]'), mx, my, true);
      if (t) {
        var targetIdx = parseInt(t.node.getAttribute('data-board-index'), 10);
        var targetBoardId = String(t.node.getAttribute('data-board-id') || '').trim();
        var sourceBoardId = src && src.boardId ? String(src.boardId || '').trim() : '';
        if ((sourceBoardId && sourceBoardId !== targetBoardId) || (!sourceBoardId && src.index !== targetIdx)) {
          _deps.reorderBoards(sourceBoardId || src.index, targetBoardId || targetIdx, t.before);
        }
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
    if (!isDropTargetValidForKind('column', mx, my)) return;
    // Cross-view tree-source: entityId is the column's stable ID.
    // Translate to columnId so moveColumnAcrossBoards's stable-lookup
    // path can find the source column by id when no indexed position
    // is available. Same pattern as commits 966c921f (card) and
    // ed770031 (row + stack). The indexMode check below sends
    // tree-sources through the cross-board path automatically because
    // tree-source doesn't carry `indexMode === 'display'`.
    if (src && src.entityId && !src.columnId &&
        typeof src.colIndex !== 'number') {
      src = Object.assign({}, src, { columnId: src.entityId });
    }
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

    // Stack drop zones (between stacks) are NOT valid for column drops.
    // Columns can only go onto stacks or between other columns.
    var column = findDraggableColumnAt(mx, my);
    if (column) {
      var colRect = getCachedRect(column);
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
        rowId: String(column.getAttribute('data-row-id') || '').trim() || null,
        stackId: String(column.getAttribute('data-stack-id') || '').trim() || null,
        columnId: String(column.getAttribute('data-column-id') || '').trim() || null,
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
        rowId: String(stack.getAttribute('data-row-id') || '').trim() || null,
        stackId: String(stack.getAttribute('data-stack-id') || '').trim() || null,
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
          rowId: treeColTarget.rowId || null,
          stackId: treeColTarget.stackId || null,
          columnId: treeColTarget.columnId || null,
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
          rowId: treeStackTarget.rowId || null,
          stackId: treeStackTarget.stackId || null,
          indexMode: treeStackTarget.indexMode
        });
      }
      return;
    }
    // Columns can only drop onto stacks or between columns — not onto rows.
  }

  // --- Ptr Drag Cleanup ---

  // Broadcast `hierarchy-entity-drag-start` so OTHER webviews
  // (workspace tree sub-apps in hierarchy.js / workspaces.js, sibling
  // kanban webviews via embeddedBoardBridge) can arm per-webview
  // pointer trackers. Mouse events DO NOT cross Tauri WKWebView
  // boundaries, so without per-webview tracking the destination's
  // pointermove / pointerup never fire when the cursor crosses out
  // of the source kanban. Mirror of the workspace → kanban
  // hierarchy-entity-drag-start broadcast in hierarchy.js / workspaces.js.
  // User report 2026-05-10: "dragging from kanban to workspace isnt
  // working" — for embedded kanbans, `tryExternalNativeHover/Drop`
  // are dead code (LexeraMultiviewWebview is shell-only), so this is
  // the only path that wakes up the workspace tree's drop receiver.
  function broadcastCrossViewDragStart() {
    function _xviewLog(stage, info) {
      if (typeof window !== 'undefined' && typeof window.lexeraLog === 'function') {
        try { window.lexeraLog('debug', '[xview-dnd] ' + stage + ' ' + JSON.stringify(info || {})); }
        catch (_) { /* non-fatal */ }
      }
    }
    if (typeof window === 'undefined' ||
        !window.LexeraMultiview ||
        typeof window.LexeraMultiview.invoke !== 'function') {
      _xviewLog('kanban.broadcast.skip(no-multiview)', {});
      return;
    }
    var sourceWebviewLabel = '';
    try {
      // The public API on `LexeraMultiview` is `getMyLabel()` —
      // returns the current webview's label string. There is NO
      // `getCurrentWebview()` on the public api (it's an internal
      // helper inside multiviewClient.js). Without the right API,
      // sourceWebviewLabel stayed empty, the embeddedBoardBridge
      // self-skip never matched, and the SOURCE kanban armed a
      // tracker against its OWN drag — the phantom pointerup with
      // negative coords beat the workspace tree's pointerup to the
      // drop persist path.
      if (typeof window.LexeraMultiview.getMyLabel === 'function') {
        sourceWebviewLabel = String(window.LexeraMultiview.getMyLabel() || '');
      }
    } catch (_) { /* non-fatal */ }
    var payload = null;
    if (cardDrag && cardDrag.boardId && cardDrag.cardId) {
      payload = {
        boardId: cardDrag.boardId,
        kind: 'card',
        entityId: cardDrag.cardId
      };
    } else if (ptrDrag && ptrDrag.type) {
      var typeToKind = {
        'tree-card': 'card',
        'tree-column': 'column', 'column': 'column',
        'tree-stack': 'stack', 'board-stack': 'stack',
        'tree-row': 'row', 'board-row': 'row'
      };
      var kind = typeToKind[ptrDrag.type];
      if (!kind) {
        _xviewLog('kanban.broadcast.skip(unsupported-ptr-type)', { ptrType: ptrDrag.type });
        return;
      }
      var src = ptrDrag.source || {};
      var entityId =
        kind === 'card' ? src.cardId :
        kind === 'column' ? src.columnId :
        kind === 'stack' ? src.stackId :
        src.rowId;
      if (!entityId) {
        _xviewLog('kanban.broadcast.skip(no-entityId)', { kind: kind, srcKeys: Object.keys(src) });
        return;
      }
      payload = {
        boardId: src.boardId || '',
        kind: kind,
        entityId: entityId
      };
    }
    if (!payload || !payload.boardId || !payload.entityId) {
      _xviewLog('kanban.broadcast.skip(no-payload)', { hasCardDrag: !!cardDrag, hasPtrDrag: !!ptrDrag });
      return;
    }
    payload.sourceWebviewLabel = sourceWebviewLabel;
    _xviewLog('kanban.broadcast.drag-start', {
      kind: payload.kind, sourceWebviewLabel: sourceWebviewLabel
    });
    window.LexeraMultiview.invoke('multiview_broadcast', {
      event: 'hierarchy-entity-drag-start',
      payload: payload
    }).catch(function (err) {
      _xviewLog('kanban.broadcast.failed', {
        err: (err && err.message) ? err.message : String(err)
      });
    });
  }

  // Defensive cleanup invoked from the `cross-view-drag-handled`
  // echo. When the user releases over a DIFFERENT webview, the
  // source kanban's own mouseup never fires (events stay local to
  // the destination). Without this echo-driven cleanup, the dragging
  // class + ghost element survive past the drop. Both `cleanupCardDrag`
  // and `cleanupPtrDrag` null-check the drag state, so calling them
  // when no drag is active is a no-op — safe to invoke unconditionally.
  function cleanupAllDrag() {
    if (cardDrag) cleanupCardDrag();
    if (ptrDrag) cleanupPtrDrag();
  }

  function cleanupPtrDrag() {
    _deps.removeStackDropZones();
    _deps.removeDropZoneIndicators();
    clearHeaderDropTargetHighlights();
    stopCrossViewBridge();
    unlockBoardLayoutForDrag();
    clearDropTargetGeometryCache();
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
    var _externalDragType = null;
    window.__lexeraExternalDnd = {
      hover: function (payload, x, y) {
        if (!payload || !payload.source) return false;
        // Insert drop zones on first hover for a new drag type
        if (payload.type !== _externalDragType) {
          _externalDragType = payload.type;
          // Stack drop zones are NOT inserted for column drag — columns can only
          // drop onto existing stacks or between other columns, not create new stacks.
          _deps.insertDropZoneIndicators(payload.type);
          cacheDropTargetGeometry();
        }
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
        _externalDragType = null;
        clearPtrDropIndicators();
      }
    };
  }

  // --- Init & Public API ---

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      _rt = window.LexeraRuntime;
      _rt.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
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

    // Geometry rect cache
    cacheDropTargetGeometry: cacheDropTargetGeometry,
    clearDropTargetGeometryCache: clearDropTargetGeometryCache,

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

    // Kind-aware drop target validator (gatekeeper used by dragover and apply)
    isDropTargetValidForKind: isDropTargetValidForKind,

    // Unified cursor->drag-target resolver (iframe Window OR native-webview label)
    getDragTargetAtTopPoint: getDragTargetAtTopPoint,

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

    // Cross-view broadcast (Stage 17a): wakes per-webview pointer
    // trackers in workspace tree sub-apps + sibling kanban webviews.
    broadcastCrossViewDragStart: broadcastCrossViewDragStart,
    // Echo-driven cleanup: source kanban's own mouseup never fires
    // when user releases over a different webview.
    cleanupAllDrag: cleanupAllDrag,

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
