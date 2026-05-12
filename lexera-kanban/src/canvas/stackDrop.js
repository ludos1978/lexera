// Leading line comment to dodge slice-13 checkJs duplicate-id quirk.

/**
 * @typedef {Object} LexeraCanvasStackDropDropTarget
 * @property {string} boardId
 * @property {string} indexMode
 * @property {number} rowIndex
 */

/**
 * @typedef {Object} LexeraCanvasStackDropResolved
 * @property {'row'} kind
 * @property {string} boardId
 * @property {number} rowIndex
 * @property {'display'} indexMode
 * @property {{ x: number; y: number }} canvasPosition
 */

/**
 * @typedef {Object} LexeraCanvasStackDropOptions
 * @property {boolean} isCanvasLayout
 * @property {string} activeBoardId
 * @property {number} clientX
 * @property {number} clientY
 * @property {number} [grabOffsetX]
 * @property {number} [grabOffsetY]
 * @property {Element | null} [fallbackRowContent]
 * @property {(clientX: number, clientY: number) => (LexeraCanvasStackDropDropTarget | null)} resolveCanvasRowContentDropTarget
 * @property {(target: LexeraCanvasStackDropDropTarget, fallback?: Element | null) => (Element | null)} getCanvasRowContentNodeFromDropTarget
 * @property {(rowContent: Element, clientX: number, clientY: number, grabOffsetX?: number, grabOffsetY?: number) => ({ x: number; y: number } | null)} getCanvasDropPositionInRowContent
 */

/**
 * @typedef {Object} LexeraCanvasStackDropStack
 * @property {{ [k: string]: string }} [params]
 */

/**
 * @typedef {Object} LexeraCanvasStackDropApi
 * @property {(options: LexeraCanvasStackDropOptions | null | undefined) => (LexeraCanvasStackDropResolved | null)} resolveCanvasStackDropTarget
 * @property {(targetBoardId: string, activeBoardId: string, isCanvasLayout: boolean, target: LexeraCanvasStackDropResolved | null | undefined, stack: LexeraCanvasStackDropStack | null) => LexeraCanvasStackDropStack | null} applyCanvasDropPositionToStack
 */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  /** @type {any} */ (root).LexeraCanvasStackDrop = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** @param {unknown} value */
  function normalizeCanvasDropCoordinate(value) {
    var numericValue = Number(value);
    if (!isFinite(numericValue)) return null;
    return Math.round(numericValue);
  }

  /**
   * @param {Partial<LexeraCanvasStackDropOptions> | null | undefined} options
   * @returns {LexeraCanvasStackDropResolved | null}
   */
  function resolveCanvasStackDropTarget(options) {
    if (!options) return null;
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

  /** @type {LexeraCanvasStackDropApi} */
  var publicApi = {
    resolveCanvasStackDropTarget: resolveCanvasStackDropTarget,
    applyCanvasDropPositionToStack: applyCanvasDropPositionToStack
  };
  return publicApi;
}));
