// Leading line comment so checkJs doesn't parse the first @typedef
// block as a module-description comment + typedef duplicate
// (slice-13 lesson).

/**
 * @typedef {Object} LexeraCanvasDomDropTarget
 * @property {Element | null | undefined} [node]
 * @property {Element | null | undefined} [contentNode]
 */

/**
 * @typedef {Object} LexeraCanvasDomApi
 * @property {(target: LexeraCanvasDomDropTarget | null | undefined, fallbackNode?: Element | null) => (Element | null)} getCanvasRowContentNodeFromDropTarget
 */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  /** @type {any} */ (root).LexeraCanvasDom = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * @param {LexeraCanvasDomDropTarget | null | undefined} target
   * @param {Element | null} [fallbackNode]
   * @returns {Element | null}
   */
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

  /** @type {LexeraCanvasDomApi} */
  var publicApi = {
    getCanvasRowContentNodeFromDropTarget: getCanvasRowContentNodeFromDropTarget
  };
  return publicApi;
}));
