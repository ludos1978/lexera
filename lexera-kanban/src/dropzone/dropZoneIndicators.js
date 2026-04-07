/**
 * Drop Zone Indicators — visual drop-zone cosmetics for drag-and-drop.
 *
 * Manages three subsystems:
 *   • Stack drop zones (hit-target zones between stacks during stack drag)
 *   • Drop zone indicators (cosmetic lines between elements during drag)
 *   • Drop zone highlighting (active indicator highlighting during mousemove)
 *
 * Dependencies injected via init():
 *   - getElColumnsContainer()  — returns the board's main columns container element
 *   - isHorizontalCanvasStack(stackEl) — returns true when the stack uses horizontal layout
 */
(function (root, factory) {
  var mod = factory();
  if (typeof root !== 'undefined') root.LexeraDropZoneIndicators = mod;
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  var _deps = {};

  function getContainer() {
    return _deps.getElColumnsContainer ? _deps.getElColumnsContainer() : null;
  }

  function isHorizontal(stackEl) {
    return _deps.isHorizontalCanvasStack ? _deps.isHorizontalCanvasStack(stackEl) : false;
  }

  // ── Stack Drop Zones (hit-target zones) ────────────────────────────

  function insertStackDropZones() {
    var container = getContainer();
    if (!container) return;
    var rowContents = container.querySelectorAll('.board-row-content');
    for (var r = 0; r < rowContents.length; r++) {
      var rowContent = rowContents[r];
      var rowEl = rowContent.closest('.board-row');
      var rowIdx = rowEl.getAttribute('data-row-index');
      var stacks = rowContent.querySelectorAll(':scope > .board-stack');
      if (stacks.length === 0) {
        var emptyZone = document.createElement('div');
        emptyZone.className = 'stack-drop-zone';
        emptyZone.setAttribute('data-row-index', rowIdx);
        emptyZone.setAttribute('data-insert-index', '0');
        emptyZone.style.left = '12px';
        emptyZone.style.height = Math.max(72, rowContent.clientHeight - 8) + 'px';
        rowContent.appendChild(emptyZone);
        continue;
      }

      var zoneHeight = Math.max(72, rowContent.clientHeight - 8);
      for (var s = 0; s <= stacks.length; s++) {
        var anchorX;
        if (s === 0) {
          anchorX = stacks[0].offsetLeft;
        } else if (s === stacks.length) {
          anchorX = stacks[s - 1].offsetLeft + stacks[s - 1].offsetWidth;
        } else {
          anchorX = stacks[s].offsetLeft;
        }
        var zone = document.createElement('div');
        zone.className = 'stack-drop-zone';
        zone.setAttribute('data-row-index', rowIdx);
        zone.setAttribute('data-insert-index', s.toString());
        zone.style.left = anchorX + 'px';
        zone.style.height = zoneHeight + 'px';
        rowContent.appendChild(zone);
      }
    }
  }

  function removeStackDropZones() {
    var container = getContainer();
    if (!container) return;
    var zones = container.querySelectorAll('.stack-drop-zone');
    for (var i = 0; i < zones.length; i++) zones[i].remove();
  }

  // ── Visual Drop Zone Indicators (cosmetic lines) ───────────────────

  function insertDropZoneIndicators(dragType) {
    removeDropZoneIndicators();
    var container = getContainer();
    if (!container) return;
    if (dragType === 'card' || dragType === 'tree-card') {
      var stackContents = container.querySelectorAll('.board-stack-content');
      for (var s = 0; s < stackContents.length; s++) {
        var stackContent = stackContents[s];
        var cols = stackContent.querySelectorAll(':scope > .column:not(.dragging)');
        if (cols.length === 0) continue;
        if (getComputedStyle(stackContent).position === 'static') {
          stackContent.style.position = 'relative';
        }
        for (var c = 0; c <= cols.length; c++) {
          var ind = document.createElement('div');
          ind.className = 'drop-zone-indicator vertical';
          ind.setAttribute('data-drop-zone-type', 'card-column');
          if (c === 0) {
            ind.style.left = '0px';
          } else if (c === cols.length) {
            ind.style.left = (cols[c - 1].offsetLeft + cols[c - 1].offsetWidth) + 'px';
          } else {
            ind.style.left = cols[c].offsetLeft + 'px';
          }
          ind.style.transform = 'translateX(-50%)';
          stackContent.appendChild(ind);
        }
      }
    } else if (dragType === 'board-row' || dragType === 'tree-row') {
      var rows = container.querySelectorAll('.board-row');
      if (rows.length === 0) return;
      if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }
      for (var r = 0; r <= rows.length; r++) {
        var ind = document.createElement('div');
        ind.className = 'drop-zone-indicator horizontal';
        ind.setAttribute('data-drop-zone-type', 'row');
        if (r === 0) {
          ind.style.top = rows[0].offsetTop + 'px';
        } else if (r === rows.length) {
          ind.style.top = (rows[r - 1].offsetTop + rows[r - 1].offsetHeight) + 'px';
        } else {
          ind.style.top = rows[r].offsetTop + 'px';
        }
        ind.style.transform = 'translateY(-50%)';
        container.appendChild(ind);
      }
    } else if (dragType === 'board-stack' || dragType === 'tree-stack') {
      var rowContents = container.querySelectorAll('.board-row-content');
      for (var rc = 0; rc < rowContents.length; rc++) {
        var rowContent = rowContents[rc];
        var stacks = rowContent.querySelectorAll(':scope > .board-stack');
        if (stacks.length === 0) continue;
        if (getComputedStyle(rowContent).position === 'static') {
          rowContent.style.position = 'relative';
        }
        for (var st = 0; st <= stacks.length; st++) {
          var ind = document.createElement('div');
          ind.className = 'drop-zone-indicator vertical';
          ind.setAttribute('data-drop-zone-type', 'stack');
          if (st === 0) {
            ind.style.left = stacks[0].offsetLeft + 'px';
          } else if (st === stacks.length) {
            ind.style.left = (stacks[st - 1].offsetLeft + stacks[st - 1].offsetWidth) + 'px';
          } else {
            ind.style.left = stacks[st].offsetLeft + 'px';
          }
          ind.style.transform = 'translateX(-50%)';
          rowContent.appendChild(ind);
        }
      }
    } else if (dragType === 'column' || dragType === 'tree-column') {
      var stackContents = container.querySelectorAll('.board-stack-content');
      for (var s = 0; s < stackContents.length; s++) {
        var stackContent = stackContents[s];
        var cols = stackContent.querySelectorAll(':scope > .column:not(.dragging)');
        if (cols.length === 0) continue;
        if (getComputedStyle(stackContent).position === 'static') {
          stackContent.style.position = 'relative';
        }
        var horizontal = isHorizontal(stackContent.closest('.board-stack'));
        for (var c = 0; c <= cols.length; c++) {
          var ind = document.createElement('div');
          ind.className = 'drop-zone-indicator ' + (horizontal ? 'vertical' : 'horizontal');
          ind.setAttribute('data-drop-zone-type', 'column');
          if (horizontal) {
            if (c === 0) {
              ind.style.left = cols[0].offsetLeft + 'px';
            } else if (c === cols.length) {
              ind.style.left = (cols[c - 1].offsetLeft + cols[c - 1].offsetWidth) + 'px';
            } else {
              ind.style.left = cols[c].offsetLeft + 'px';
            }
            ind.style.transform = 'translateX(-50%)';
          } else {
            if (c === 0) {
              ind.style.top = cols[0].offsetTop + 'px';
            } else if (c === cols.length) {
              ind.style.top = (cols[c - 1].offsetTop + cols[c - 1].offsetHeight) + 'px';
            } else {
              ind.style.top = cols[c].offsetTop + 'px';
            }
            ind.style.transform = 'translateY(-50%)';
          }
          stackContent.appendChild(ind);
        }
      }
    }
  }

  function removeDropZoneIndicators() {
    var indicators = document.querySelectorAll('.drop-zone-indicator');
    for (var i = 0; i < indicators.length; i++) indicators[i].remove();
  }

  function clearDropZoneIndicatorHighlights() {
    var indicators = document.querySelectorAll('.drop-zone-indicator.active');
    for (var i = 0; i < indicators.length; i++) indicators[i].classList.remove('active');
  }

  function highlightDropZoneIndicator(dragType, mx, my) {
    clearDropZoneIndicatorHighlights();
    var container = getContainer();
    if (!container) return;

    if (dragType === 'card' || dragType === 'tree-card') {
      var overContainer = container.querySelector('.column-cards.card-drag-over');
      if (!overContainer) return;
      var column = overContainer.closest('.column');
      if (!column) return;
      var stackContent = column.closest('.board-stack-content');
      if (!stackContent) return;
      var cols = stackContent.querySelectorAll(':scope > .column:not(.dragging)');
      var colIdx = Array.prototype.indexOf.call(cols, column);
      if (colIdx < 0) return;
      var indicators = stackContent.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="card-column"]');
      var colRect = column.getBoundingClientRect();
      var inLeftHalf = mx < colRect.left + colRect.width / 2;
      var targetIdx = inLeftHalf ? colIdx : colIdx + 1;
      if (targetIdx >= 0 && targetIdx < indicators.length) {
        indicators[targetIdx].classList.add('active');
      }
    } else if (dragType === 'board-row' || dragType === 'tree-row') {
      var topRow = container.querySelector('.board-row.drag-over-top');
      var bottomRow = container.querySelector('.board-row.drag-over-bottom');
      var rows = container.querySelectorAll('.board-row');
      var indicators = container.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="row"]');
      if (topRow) {
        var idx = Array.prototype.indexOf.call(rows, topRow);
        if (idx >= 0 && idx < indicators.length) indicators[idx].classList.add('active');
      } else if (bottomRow) {
        var idx = Array.prototype.indexOf.call(rows, bottomRow);
        if (idx >= 0 && idx + 1 < indicators.length) indicators[idx + 1].classList.add('active');
      }
    } else if (dragType === 'board-stack' || dragType === 'tree-stack') {
      var leftStack = container.querySelector('.board-stack.drag-over-left');
      var rightStack = container.querySelector('.board-stack.drag-over-right');
      if (leftStack) {
        var rowContent = leftStack.closest('.board-row-content');
        if (rowContent) {
          var stacks = rowContent.querySelectorAll(':scope > .board-stack');
          var indicators = rowContent.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="stack"]');
          var idx = Array.prototype.indexOf.call(stacks, leftStack);
          if (idx >= 0 && idx < indicators.length) indicators[idx].classList.add('active');
        }
      } else if (rightStack) {
        var rowContent = rightStack.closest('.board-row-content');
        if (rowContent) {
          var stacks = rowContent.querySelectorAll(':scope > .board-stack');
          var indicators = rowContent.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="stack"]');
          var idx = Array.prototype.indexOf.call(stacks, rightStack);
          if (idx >= 0 && idx + 1 < indicators.length) indicators[idx + 1].classList.add('active');
        }
      }
    } else if (dragType === 'column' || dragType === 'tree-column') {
      var leftCol = container.querySelector('.column.drag-over-left');
      var rightCol = container.querySelector('.column.drag-over-right');
      var topCol = container.querySelector('.column.drag-over-top');
      var bottomCol = container.querySelector('.column.drag-over-bottom');
      if (leftCol) {
        var leftStackContent = leftCol.closest('.board-stack-content');
        if (leftStackContent) {
          var leftCols = leftStackContent.querySelectorAll(':scope > .column:not(.dragging)');
          var leftIndicators = leftStackContent.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="column"]');
          var leftIdx = Array.prototype.indexOf.call(leftCols, leftCol);
          if (leftIdx >= 0 && leftIdx < leftIndicators.length) leftIndicators[leftIdx].classList.add('active');
        }
      } else if (rightCol) {
        var rightStackContent = rightCol.closest('.board-stack-content');
        if (rightStackContent) {
          var rightCols = rightStackContent.querySelectorAll(':scope > .column:not(.dragging)');
          var rightIndicators = rightStackContent.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="column"]');
          var rightIdx = Array.prototype.indexOf.call(rightCols, rightCol);
          if (rightIdx >= 0 && rightIdx + 1 < rightIndicators.length) rightIndicators[rightIdx + 1].classList.add('active');
        }
      } else if (topCol) {
        var stackContent = topCol.closest('.board-stack-content');
        if (stackContent) {
          var cols = stackContent.querySelectorAll(':scope > .column:not(.dragging)');
          var indicators = stackContent.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="column"]');
          var idx = Array.prototype.indexOf.call(cols, topCol);
          if (idx >= 0 && idx < indicators.length) indicators[idx].classList.add('active');
        }
      } else if (bottomCol) {
        var stackContent = bottomCol.closest('.board-stack-content');
        if (stackContent) {
          var cols = stackContent.querySelectorAll(':scope > .column:not(.dragging)');
          var indicators = stackContent.querySelectorAll('.drop-zone-indicator[data-drop-zone-type="column"]');
          var idx = Array.prototype.indexOf.call(cols, bottomCol);
          if (idx >= 0 && idx + 1 < indicators.length) indicators[idx + 1].classList.add('active');
        }
      }
    }
  }

  return {
    init: function (deps) {
      _deps = deps || {};
    },
    insertStackDropZones: insertStackDropZones,
    removeStackDropZones: removeStackDropZones,
    insertDropZoneIndicators: insertDropZoneIndicators,
    removeDropZoneIndicators: removeDropZoneIndicators,
    clearDropZoneIndicatorHighlights: clearDropZoneIndicatorHighlights,
    highlightDropZoneIndicator: highlightDropZoneIndicator
  };
}));
