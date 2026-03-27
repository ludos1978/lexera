/**
 * Canvas Pan — middle-mouse or alt+left-mouse drag panning for canvas boards.
 *
 * Manages:
 *   - Middle-mouse drag pan
 *   - Alt+left-mouse drag pan
 *   - Prevent default middle-click auto-scroll in canvas mode
 *   - Suppress programmatic scrolling in canvas mode
 *
 * Dependencies injected via init().
 */
var LexeraCanvasPan = (function () {
  'use strict';

  var _deps = {};

  // --- State ---
  var _canvasPan = null;

  // --- Dependency accessors ---
  function getActiveBoardData() { return _deps.getActiveBoardData(); }
  function isCanvasBoardLayout() { return _deps.isCanvasBoardLayout(); }
  function canStartCanvasPointerPan(target, button, altKey) { return _deps.canStartCanvasPointerPan(target, button, altKey); }
  function getElColumnsContainer() { return _deps.getElColumnsContainer(); }
  function getCanvasPanX() { return _deps.getCanvasPanX(); }
  function getCanvasPanY() { return _deps.getCanvasPanY(); }
  function applyCanvasPan(panX, panY) { _deps.applyCanvasPan(panX, panY); }

  // --- Event handlers ---

  function handleMouseDown(e) {
    if (!getActiveBoardData() || !isCanvasBoardLayout()) return;
    var target = e.target;
    if (!canStartCanvasPointerPan(target, e.button, !!e.altKey)) return;
    var container = getElColumnsContainer();
    if (!container) return;
    e.preventDefault();
    _canvasPan = {
      container: container,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: getCanvasPanX(),
      startPanY: getCanvasPanY()
    };
    container.classList.add('canvas-panning');
    container.style.cursor = 'grabbing';
  }

  function handleMouseMove(e) {
    if (!_canvasPan) return;
    var dx = e.clientX - _canvasPan.startX;
    var dy = e.clientY - _canvasPan.startY;
    applyCanvasPan(_canvasPan.startPanX + dx, _canvasPan.startPanY + dy);
  }

  function handleMouseUp(e) {
    if (!_canvasPan) return;
    _canvasPan.container.classList.remove('canvas-panning');
    _canvasPan.container.style.cursor = '';
    _canvasPan = null;
  }

  function handleAuxClick(e) {
    if (e.button === 1 && getActiveBoardData() && isCanvasBoardLayout()) {
      var target = e.target;
      if (target && typeof target.closest === 'function' && target.closest('#columns-container')) {
        e.preventDefault();
      }
    }
  }

  function handleScroll() {
    if (!isCanvasBoardLayout()) return;
    var container = getElColumnsContainer();
    if (!container) return;
    if (container.scrollLeft !== 0 || container.scrollTop !== 0) {
      container.scrollLeft = 0;
      container.scrollTop = 0;
    }
  }

  // --- Lifecycle ---

  var _attached = false;

  function attach() {
    if (_attached) return;
    _attached = true;
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('auxclick', handleAuxClick);
    document.addEventListener('scroll', handleScroll, true);
  }

  function detach() {
    if (!_attached) return;
    _attached = false;
    cancelPan();
    document.removeEventListener('mousedown', handleMouseDown);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('auxclick', handleAuxClick);
    document.removeEventListener('scroll', handleScroll, true);
  }

  function isPanning() {
    return _canvasPan !== null;
  }

  function cancelPan() {
    if (!_canvasPan) return;
    _canvasPan.container.classList.remove('canvas-panning');
    _canvasPan.container.style.cursor = '';
    _canvasPan = null;
  }

  function init(deps) {
    detach();
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
    attach();
  }

  return {
    init: init,
    detach: detach,
    isPanning: isPanning,
    cancelPan: cancelPan
  };
})();
window.LexeraCanvasPan = LexeraCanvasPan;
