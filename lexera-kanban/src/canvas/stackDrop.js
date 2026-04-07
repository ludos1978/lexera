(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraCanvasStackDrop = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeCanvasDropCoordinate(value) {
    var numericValue = Number(value);
    if (!isFinite(numericValue)) return null;
    return Math.round(numericValue);
  }

  function resolveCanvasStackDropTarget(options) {
    options = options || {};
    if (!options.isCanvasLayout || !options.activeBoardId) return null;
    if (typeof options.resolveCanvasRowContentDropTarget !== 'function') return null;
    if (typeof options.getCanvasRowContentNodeFromDropTarget !== 'function') return null;
    if (typeof options.getCanvasDropPositionInRowContent !== 'function') return null;

    var target = options.resolveCanvasRowContentDropTarget(options.clientX, options.clientY);
    if (!target || target.boardId !== options.activeBoardId || target.indexMode !== 'display') return null;
    if (!isFinite(target.rowIndex)) return null;

    var rowContent = options.getCanvasRowContentNodeFromDropTarget(target, options.fallbackRowContent || null);
    if (!rowContent) return null;

    var position = options.getCanvasDropPositionInRowContent(
      rowContent,
      options.clientX,
      options.clientY,
      options.grabOffsetX,
      options.grabOffsetY
    );
    if (!position) return null;

    var x = normalizeCanvasDropCoordinate(position.x);
    var y = normalizeCanvasDropCoordinate(position.y);
    if (x == null || y == null) return null;

    return {
      kind: 'row',
      boardId: options.activeBoardId,
      rowIndex: target.rowIndex,
      indexMode: 'display',
      canvasPosition: { x: x, y: y }
    };
  }

  function applyCanvasDropPositionToStack(targetBoardId, activeBoardId, isCanvasLayout, target, stack) {
    if (!isCanvasLayout || !target || !stack) return stack;
    if (targetBoardId !== activeBoardId) return stack;
    if (!target.canvasPosition) return stack;

    var x = normalizeCanvasDropCoordinate(target.canvasPosition.x);
    var y = normalizeCanvasDropCoordinate(target.canvasPosition.y);
    if (x == null || y == null) return stack;

    if (!stack.params || typeof stack.params !== 'object') stack.params = {};
    stack.params.x = String(x);
    stack.params.y = String(y);
    return stack;
  }

  return {
    resolveCanvasStackDropTarget: resolveCanvasStackDropTarget,
    applyCanvasDropPositionToStack: applyCanvasDropPositionToStack
  };
}));
