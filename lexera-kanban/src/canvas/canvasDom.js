(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraCanvasDom = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function getCanvasRowContentNodeFromDropTarget(target, fallbackNode) {
    if (target && target.contentNode) return target.contentNode;
    var targetNode = target && target.node ? target.node : null;
    if (targetNode) {
      if (targetNode.classList && targetNode.classList.contains('board-row-content')) return targetNode;
      if (typeof targetNode.querySelector === 'function') {
        var nestedContent = targetNode.querySelector(':scope > .board-row-content');
        if (nestedContent) return nestedContent;
      }
    }
    return fallbackNode || null;
  }

  return {
    getCanvasRowContentNodeFromDropTarget: getCanvasRowContentNodeFromDropTarget
  };
}));
