/**
 * Canvas Pan — drag-pan logic for canvas boards.
 *
 * Registers a `canvas.move` drag handler with LexeraControlsDispatcher.
 * The dispatcher owns the event wiring and the (mode, action) match;
 * this module only owns the pan state and the apply-pan side effect.
 */

/**
 * @typedef {Object} LexeraCanvasPanDeps
 * @property {() => unknown} getActiveBoardData
 * @property {() => boolean} isCanvasBoardLayout
 * @property {(target: EventTarget | null, button: number, altKey: boolean) => boolean} canStartCanvasPointerPan
 * @property {() => (HTMLElement | null)} getElColumnsContainer
 * @property {() => number} getCanvasPanX
 * @property {() => number} getCanvasPanY
 * @property {(panX: number, panY: number) => void} applyCanvasPan
 */

/**
 * @typedef {Object} LexeraCanvasPanDragContext
 * @property {EventTarget | null} target
 * @property {HTMLElement | null} container
 * @property {{ button: number; altKey: boolean }} event
 */

/**
 * @typedef {Object} LexeraCanvasPanState
 * @property {HTMLElement | null} container
 * @property {number} startPanX
 * @property {number} startPanY
 */

/**
 * @typedef {Object} LexeraCanvasPanApi
 * @property {(deps: LexeraCanvasPanDeps) => void} init
 * @property {() => void} detach
 * @property {() => boolean} isPanning
 * @property {() => void} cancelPan
 */

var LexeraCanvasPan = (function () {
  'use strict';

  /** @type {Partial<LexeraCanvasPanDeps>} */
  var _deps = {};
  var _registered = false;
  /** @type {LexeraCanvasPanState | null} */
  var _panState = null;
  var _scrollSuppressionAttached = false;

  function getActiveBoardData() { return _deps.getActiveBoardData ? _deps.getActiveBoardData() : null; }
  function isCanvasBoardLayout() { return !!(_deps.isCanvasBoardLayout && _deps.isCanvasBoardLayout()); }
  /**
   * @param {EventTarget | null} target
   * @param {number} button
   * @param {boolean} altKey
   */
  function canStartCanvasPointerPan(target, button, altKey) {
    return !!(_deps.canStartCanvasPointerPan && _deps.canStartCanvasPointerPan(target, button, altKey));
  }
  function getElColumnsContainer() { return _deps.getElColumnsContainer ? _deps.getElColumnsContainer() : null; }
  function getCanvasPanX() { return _deps.getCanvasPanX ? _deps.getCanvasPanX() : 0; }
  function getCanvasPanY() { return _deps.getCanvasPanY ? _deps.getCanvasPanY() : 0; }
  /**
   * @param {number} panX
   * @param {number} panY
   */
  function applyCanvasPan(panX, panY) { if (_deps.applyCanvasPan) _deps.applyCanvasPan(panX, panY); }

  var dragHandler = {
    canStart: function (ctx) {
      if (!getActiveBoardData() || !isCanvasBoardLayout()) return false;
      return canStartCanvasPointerPan(ctx.target, ctx.event.button, !!ctx.event.altKey);
    },
    start: function (ctx) {
      _panState = {
        container: ctx.container,
        startPanX: getCanvasPanX(),
        startPanY: getCanvasPanY()
      };
      if (ctx.container) {
        ctx.container.classList.add('canvas-panning');
        ctx.container.style.cursor = 'grabbing';
      }
    },
    move: function (_ctx, dx, dy) {
      if (!_panState) return;
      applyCanvasPan(_panState.startPanX + dx, _panState.startPanY + dy);
    },
    end: function () {
      if (!_panState) return;
      if (_panState.container) {
        _panState.container.classList.remove('canvas-panning');
        _panState.container.style.cursor = '';
      }
      _panState = null;
    }
  };

  function handleScroll() {
    if (!isCanvasBoardLayout()) return;
    var container = getElColumnsContainer();
    if (!container) return;
    if (container.scrollLeft !== 0 || container.scrollTop !== 0) {
      container.scrollLeft = 0;
      container.scrollTop = 0;
    }
  }

  function attachScrollSuppression() {
    if (_scrollSuppressionAttached) return;
    _scrollSuppressionAttached = true;
    document.addEventListener('scroll', handleScroll, true);
  }

  function detachScrollSuppression() {
    if (!_scrollSuppressionAttached) return;
    _scrollSuppressionAttached = false;
    document.removeEventListener('scroll', handleScroll, true);
  }

  function registerHandler() {
    if (_registered) return;
    if (!window.LexeraControlsDispatcher) return;
    window.LexeraControlsDispatcher.register('canvas', 'move', { drag: dragHandler });
    _registered = true;
  }

  function isPanning() {
    return _panState !== null;
  }

  function cancelPan() {
    if (!_panState) return;
    dragHandler.end();
    if (window.LexeraControlsDispatcher) window.LexeraControlsDispatcher.cancelDrag();
  }

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
    registerHandler();
    attachScrollSuppression();
  }

  function detach() {
    cancelPan();
    detachScrollSuppression();
  }

  /** @type {LexeraCanvasPanApi} */
  var api = {
    init: init,
    detach: detach,
    isPanning: isPanning,
    cancelPan: cancelPan
  };
  return api;
})();
window.LexeraCanvasPan = LexeraCanvasPan;
