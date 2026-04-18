/**
 * Controls Dispatcher — single router for configurable input bindings.
 *
 * Owns the document-level wheel / pointer / auxclick listeners. For each
 * event it determines the current view mode ('kanban' or 'canvas'),
 * consults LexeraControlsSettings for a matching (mode, action) binding,
 * then invokes the handler registered by the relevant feature module.
 *
 * Feature modules register once via register(mode, action, handler).
 * The dispatcher owns the drag state machine so handlers stay small.
 *
 * Handler shape (populate only what applies):
 *   {
 *     scroll: function(ctx, deltaX, deltaY) -> boolean?,
 *     drag:   {
 *       canStart: function(ctx) -> boolean,
 *       start:    function(ctx),
 *       move:     function(ctx, dx, dy),
 *       end:      function(ctx)
 *     }
 *   }
 * Return `false` from `scroll` to let the next action try the event;
 * anything else (including undefined) claims it.
 *
 * ctx = { event, mode, target, container, extras }
 *
 * Keyboard and dblclick bindings are honoured by the existing keydown /
 * dblclick handlers (keyboardNavigation.js, dndListeners.js) gating their
 * actions through LexeraControlsSettings.matchesKey / matchesDblclick —
 * so the full settings surface is live without duplicating listeners.
 */
var LexeraControlsDispatcher = (function () {
  'use strict';

  var _deps = {};
  var _handlers = { kanban: {}, canvas: {} };
  var _dragState = null;
  var _attached = false;

  function getCS() {
    return typeof LexeraControlsSettings !== 'undefined' ? LexeraControlsSettings : null;
  }

  function getActiveBoardData() {
    return _deps.getActiveBoardData ? _deps.getActiveBoardData() : null;
  }

  function isCanvasBoardLayout() {
    return _deps.isCanvasBoardLayout ? _deps.isCanvasBoardLayout() : false;
  }

  function getElColumnsContainer() {
    return _deps.getElColumnsContainer ? _deps.getElColumnsContainer() : null;
  }

  function currentMode() {
    return isCanvasBoardLayout() ? 'canvas' : 'kanban';
  }

  function isInBoardScope(target) {
    if (!target || typeof target.closest !== 'function') return false;
    if (!target.closest('#board-header, #columns-container')) return false;
    if (target.closest('.card-editor-dialog, .export-dialog, .mgmt-panel')) return false;
    return true;
  }

  function isInEditableField(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return !!target.closest('input, textarea, select, [contenteditable="true"], .cm-editor, .cm-scroller, .monaco-editor');
  }

  function register(mode, action, handler) {
    if (!_handlers[mode]) _handlers[mode] = {};
    if (!_handlers[mode][action]) _handlers[mode][action] = {};
    var existing = _handlers[mode][action];
    if (!handler) return;
    var keys = Object.keys(handler);
    for (var i = 0; i < keys.length; i++) existing[keys[i]] = handler[keys[i]];
  }

  function getHandler(mode, action) {
    return (_handlers[mode] && _handlers[mode][action]) || null;
  }

  var SCROLL_ACTION_ORDER = ['zoom', 'move'];
  var DRAG_ACTION_ORDER = ['move'];

  function onWheel(e) {
    if (e.ctrlKey || e.metaKey) return;
    if (!getActiveBoardData()) return;
    var target = e.target;
    if (!isInBoardScope(target)) return;
    if (isInEditableField(target)) return;

    var CS = getCS();
    var mode = currentMode();
    for (var i = 0; i < SCROLL_ACTION_ORDER.length; i++) {
      var action = SCROLL_ACTION_ORDER[i];
      var h = getHandler(mode, action);
      if (!h || !h.scroll) continue;
      if (CS && !CS.matchesScroll(e, mode, action)) continue;
      var ctx = { event: e, mode: mode, action: action, target: target, container: getElColumnsContainer() };
      if (h.scroll(ctx, e.deltaX, e.deltaY) !== false) return;
    }
  }

  function onMouseDown(e) {
    if (_dragState) return;
    if (!getActiveBoardData()) return;
    var target = e.target;
    if (!isInBoardScope(target)) return;
    if (isInEditableField(target)) return;

    var CS = getCS();
    var mode = currentMode();
    for (var i = 0; i < DRAG_ACTION_ORDER.length; i++) {
      var action = DRAG_ACTION_ORDER[i];
      var h = getHandler(mode, action);
      if (!h || !h.drag) continue;
      if (CS && !CS.matchesDrag(e, mode, action)) continue;
      var ctx = { event: e, mode: mode, action: action, target: target, container: getElColumnsContainer() };
      if (h.drag.canStart && !h.drag.canStart(ctx)) continue;
      e.preventDefault();
      _dragState = {
        mode: mode,
        action: action,
        handler: h.drag,
        startX: e.clientX,
        startY: e.clientY,
        context: ctx
      };
      if (h.drag.start) h.drag.start(ctx);
      return;
    }
  }

  function onMouseMove(e) {
    if (!_dragState) return;
    var dx = e.clientX - _dragState.startX;
    var dy = e.clientY - _dragState.startY;
    if (_dragState.handler.move) _dragState.handler.move(_dragState.context, dx, dy);
  }

  function onMouseUp() {
    if (!_dragState) return;
    var s = _dragState;
    _dragState = null;
    if (s.handler.end) s.handler.end(s.context);
  }

  function onAuxClick(e) {
    // Suppress browser auto-scroll on middle-click only inside canvas boards,
    // matching the pre-dispatcher behaviour. Kanban boards fall through to
    // the native middle-click behaviour.
    if (e.button !== 1) return;
    var target = e.target;
    if (!isInBoardScope(target)) return;
    if (!isCanvasBoardLayout()) return;
    e.preventDefault();
  }

  function attach() {
    if (_attached) return;
    _attached = true;
    document.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('auxclick', onAuxClick);
  }

  function detach() {
    if (!_attached) return;
    _attached = false;
    document.removeEventListener('wheel', onWheel, { passive: false });
    document.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('auxclick', onAuxClick);
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

  function cancelDrag() {
    if (!_dragState) return;
    var s = _dragState;
    _dragState = null;
    if (s.handler.end) s.handler.end(s.context);
  }

  return {
    init: init,
    detach: detach,
    register: register,
    cancelDrag: cancelDrag,
    isDragging: function () { return !!_dragState; },
    // Helpers exposed for tests and handler internals
    _currentMode: currentMode,
    _isInBoardScope: isInBoardScope,
    _isInEditableField: isInEditableField
  };
})();
if (typeof window !== 'undefined') window.LexeraControlsDispatcher = LexeraControlsDispatcher;
