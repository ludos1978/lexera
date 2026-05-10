// Shared cross-view drop receiver for workspace tree sub-apps.
//
// hierarchy.js and workspaces.js previously each carried near-
// identical destination-side wiring (Stage 14: external-dnd-hover/
// drop/clear handler + payload-shape mapper) AND a near-identical
// per-webview pointer tracker (Stage 17b: armed on
// hierarchy-entity-drag-start, drives the same handler with local
// pointer coords). This module owns the duplicated logic; each
// sub-app now passes its DOM-bound deps and gets back the receiver
// callbacks to wire into its LexeraSubApp.init onCustom.
//
// Architecture:
//   - The DESTINATION's `_OnExternalDnd(eventKind, payload)` handler
//     resolves a tree target via the caller-supplied
//     `readDropTargetFromPoint`, paints `is-drop-{before,after,absorb}`
//     classes, and on drop broadcasts `hierarchy-entity-drop` +
//     `cross-view-drag-handled` (the shell's hierarchyDragBridge then
//     persists via applyDrop+saveBoard).
//   - The per-webview pointer tracker is needed because pointer/
//     mouse events DO NOT cross Tauri WKWebView boundaries. Source
//     broadcasts `hierarchy-entity-drag-start`; this module arms
//     local pointermove/pointerup/pointercancel listeners that drive
//     the handler with LOCAL coords.
//   - Self-skip: when payload.sourceWebviewLabel === the receiver's
//     own label, the tracker bails so the SOURCE webview's own drag
//     doesn't double-track.
//
// IIFE module — no ES imports, no const/let.
(function () {
  'use strict';

  var KIND_TO_TYPE = {
    row: 'tree-row',
    stack: 'tree-stack',
    column: 'tree-column',
    card: 'tree-card'
  };

  // Two payload shapes arrive at the receiver:
  //   shell-forwarder (workspace→workspace / workspace→kanban):
  //     payload.payload = { source: { boardId, kind, entityId }, type }
  //   kanban dispatch (kanban→workspace via Stage 17a):
  //     payload.payload = { source: { boardId, cardId|columnId|stackId|rowId, ... }, type }
  // The receiver normalises both into { boardId, kind, entityId }.
  function mapXviewSourceFromPayload(p) {
    var inner = p && p.payload;
    var src = inner && inner.source;
    var type = inner && inner.type;
    if (!src) return null;
    if (src.kind && src.entityId) {
      return { boardId: src.boardId || '', kind: src.kind, entityId: src.entityId };
    }
    if (!type) return null;
    var kind = (type === 'tree-card') ? 'card'
      : (type === 'tree-column') ? 'column'
      : (type === 'tree-stack') ? 'stack'
      : (type === 'tree-row') ? 'row'
      : null;
    if (!kind) return null;
    var entityId =
      (kind === 'card') ? (src.cardId || '') :
      (kind === 'column') ? (src.columnId || '') :
      (kind === 'stack') ? (src.stackId || '') :
      (src.rowId || '');
    if (!entityId) return null;
    return { boardId: src.boardId || '', kind: kind, entityId: entityId };
  }

  /**
   * Install the destination-side cross-view drop receiver.
   *
   * Required deps:
   *   readDropTargetFromPoint(clientX, clientY, source)
   *     => { node: Element, info: { boardId, kind, entityId, position? } } | null
   *
   * Optional deps:
   *   getOwnWebviewLabel() => string  (for self-skip; default: '' so
   *     no skipping ever happens)
   *
   * Returns:
   *   {
   *     onExternalDnd(eventKind, payload),       // wire to onCustom
   *                                              //   external-dnd-hover/-drop/-clear
   *     armCrossDragTracker(payload),            // wire to onCustom
   *                                              //   hierarchy-entity-drag-start
   *     teardownCrossDragTracker(),              // wire to onCustom
   *                                              //   cross-view-drag-handled
   *   }
   */
  function install(deps) {
    deps = deps || {};
    var readDropTargetFromPoint = deps.readDropTargetFromPoint;
    var getOwnWebviewLabel = (typeof deps.getOwnWebviewLabel === 'function')
      ? deps.getOwnWebviewLabel
      : function () { return ''; };
    if (typeof readDropTargetFromPoint !== 'function') {
      throw new Error('LexeraTreeCrossViewDrop.install: readDropTargetFromPoint dep is required');
    }

    // Destination-side highlight state. Tracked separately from the
    // sub-app's source-side `activeDropTargetEl` so a workspace that
    // is BOTH dragging AND receiving (e.g., two workspace webviews
    // open) doesn't conflate the two.
    var xviewDestTargetEl = null;
    function clearXviewDestTargetEl() {
      if (xviewDestTargetEl) {
        xviewDestTargetEl.classList.remove('is-drop-target');
        xviewDestTargetEl.classList.remove('is-drop-before');
        xviewDestTargetEl.classList.remove('is-drop-after');
        xviewDestTargetEl.classList.remove('is-drop-absorb');
        xviewDestTargetEl = null;
      }
    }

    // First-fire flags so 60Hz pointermove doesn't spam the log; one
    // diagnostic line per drag session per outcome.
    var _xviewLogFlags = { hoverNoMatch: false, hoverMatch: false };
    function onExternalDnd(eventKind, payload) {
      if (eventKind === 'clear') { clearXviewDestTargetEl(); return; }
      var source = mapXviewSourceFromPayload(payload);
      var x = (payload && typeof payload.x === 'number') ? payload.x : 0;
      var y = (payload && typeof payload.y === 'number') ? payload.y : 0;
      var match = source ? readDropTargetFromPoint(x, y, source) : null;
      if (eventKind === 'hover') {
        // Diagnose: log once per drag whether the local DOM hit-test
        // returns null (no tree-node under cursor / self-drop filter
        // tripped / cross-kind ABSORB rejected) versus a real match.
        // Without this the user only sees `tree.tracker.armed` and
        // can't tell whether the cursor is actually entering the
        // workspace's bounds or whether the target lookup is failing.
        if (match && !_xviewLogFlags.hoverMatch) {
          _xviewLog('tree.tracker.hover.match', {
            x: x, y: y,
            kind: match.info && match.info.kind,
            entityId: match.info && match.info.entityId,
            position: match.info && match.info.position
          });
          _xviewLogFlags.hoverMatch = true;
          _xviewLogFlags.hoverNoMatch = false;
        } else if (!match && !_xviewLogFlags.hoverNoMatch) {
          _xviewLog('tree.tracker.hover.no-match', {
            x: x, y: y,
            sourceKind: source && source.kind,
            sourceEntityId: source && source.entityId
          });
          _xviewLogFlags.hoverNoMatch = true;
        }
        if (xviewDestTargetEl !== (match && match.node)) {
          clearXviewDestTargetEl();
          if (match) {
            match.node.classList.add('is-drop-target');
            xviewDestTargetEl = match.node;
          }
        }
        if (xviewDestTargetEl) {
          xviewDestTargetEl.classList.remove('is-drop-before');
          xviewDestTargetEl.classList.remove('is-drop-after');
          xviewDestTargetEl.classList.remove('is-drop-absorb');
          if (match && match.info) {
            if (match.info.position === 'before') xviewDestTargetEl.classList.add('is-drop-before');
            else if (match.info.position === 'after') xviewDestTargetEl.classList.add('is-drop-after');
            else xviewDestTargetEl.classList.add('is-drop-absorb');
          }
        }
        return;
      }
      if (eventKind === 'drop') {
        clearXviewDestTargetEl();
        if (match && source && window.LexeraSubApp && typeof window.LexeraSubApp.broadcast === 'function') {
          // Persistence broadcast — shell's hierarchyDragBridge picks
          // this up and runs applyDrop + saveBoard.
          window.LexeraSubApp.broadcast('hierarchy-entity-drop', { source: source, target: match.info });
          // Cleanup echo — siblings tear down their trackers; the
          // source's drag UI clears.
          window.LexeraSubApp.broadcast('cross-view-drag-handled', {});
        }
      }
    }

    // ── Per-webview pointer tracker ──────────────────────────────────
    var crossDragPayload = null;
    var crossDragMoveHandler = null;
    var crossDragUpHandler = null;
    var crossDragSafetyTimer = 0;

    function teardownCrossDragTracker(reason) {
      // Diagnose teardown cause — when the user-pasted log shows
      // `tree.tracker.armed` followed by silence (no pointerup), this
      // line tells whether the 30s safety timer expired, the
      // cross-view-drag-handled echo arrived from a sibling, or the
      // pointerup handler itself ran cleanup. Without it the silent
      // teardown is opaque.
      var hadHandler = !!(crossDragMoveHandler || crossDragUpHandler);
      if (hadHandler && typeof window !== 'undefined' && typeof window.lexeraLog === 'function') {
        try {
          window.lexeraLog('debug', '[xview-dnd] tree.tracker.teardown ' +
            JSON.stringify({ reason: reason || 'unknown' }));
        } catch (_) { /* non-fatal */ }
      }
      if (crossDragMoveHandler) {
        document.removeEventListener('pointermove', crossDragMoveHandler, true);
        crossDragMoveHandler = null;
      }
      if (crossDragUpHandler) {
        document.removeEventListener('pointerup', crossDragUpHandler, true);
        document.removeEventListener('pointercancel', crossDragUpHandler, true);
        crossDragUpHandler = null;
      }
      if (crossDragSafetyTimer) {
        clearTimeout(crossDragSafetyTimer);
        crossDragSafetyTimer = 0;
      }
      crossDragPayload = null;
      onExternalDnd('clear', null);
    }

    function _xviewLog(stage, info) {
      if (typeof window !== 'undefined' && typeof window.lexeraLog === 'function') {
        try { window.lexeraLog('debug', '[xview-dnd] ' + stage + ' ' + JSON.stringify(info || {})); }
        catch (_) { /* non-fatal */ }
      }
    }
    function armCrossDragTracker(src) {
      if (!src || !src.kind || !src.entityId) {
        _xviewLog('tree.tracker.skip(no-source-kind)', { hasSrc: !!src });
        return;
      }
      // Self-skip: when this webview is the SOURCE, the regular
      // source-side drag handler is already running. Don't double-track.
      var ownLabel = getOwnWebviewLabel();
      if (src.sourceWebviewLabel && ownLabel && src.sourceWebviewLabel === ownLabel) {
        _xviewLog('tree.tracker.skip(self)', { label: ownLabel });
        return;
      }
      var type = KIND_TO_TYPE[src.kind] || ('tree-' + src.kind);
      // Replace any previous tracker (defensive — a missed cleanup
      // must not leak stale handlers).
      teardownCrossDragTracker('arm-replace');
      crossDragPayload = { source: src, type: type };
      // Reset diagnostic flags so the next drag's first hover line
      // emits regardless of what the previous drag logged.
      _xviewLogFlags.hoverNoMatch = false;
      _xviewLogFlags.hoverMatch = false;
      var _firstMoveLogged = false;
      crossDragMoveHandler = function (e) {
        if (!crossDragPayload) return;
        // Log the FIRST pointermove per drag session so the user
        // knows the workspace's document is actually receiving the
        // cursor (rules out the "OS routes pointer events to the
        // pointerdown owner" hypothesis where the workspace never
        // sees the move at all).
        if (!_firstMoveLogged) {
          _firstMoveLogged = true;
          _xviewLog('tree.tracker.pointermove(first)', {
            x: e.clientX, y: e.clientY
          });
        }
        onExternalDnd('hover', { payload: crossDragPayload, x: e.clientX, y: e.clientY });
      };
      crossDragUpHandler = function (e) {
        if (!crossDragPayload) return;
        _xviewLog('tree.tracker.pointerup', {
          x: e.clientX, y: e.clientY, kind: src.kind
        });
        // onExternalDnd('drop', ...) broadcasts hierarchy-entity-drop +
        // cross-view-drag-handled itself.
        onExternalDnd('drop', { payload: crossDragPayload, x: e.clientX, y: e.clientY });
        teardownCrossDragTracker('pointerup');
      };
      document.addEventListener('pointermove', crossDragMoveHandler, true);
      document.addEventListener('pointerup', crossDragUpHandler, true);
      document.addEventListener('pointercancel', crossDragUpHandler, true);
      // 30s safety timeout — if no pointerup ever fires (window blur,
      // OS gesture-loss, etc.), the tracker self-cleans.
      crossDragSafetyTimer = setTimeout(function () {
        teardownCrossDragTracker('safety-timeout-30s');
      }, 30000);
      _xviewLog('tree.tracker.armed', {
        sourceKind: src.kind,
        sourceLabel: src.sourceWebviewLabel || '',
        ownLabel: ownLabel
      });
    }

    return {
      onExternalDnd: onExternalDnd,
      armCrossDragTracker: armCrossDragTracker,
      teardownCrossDragTracker: teardownCrossDragTracker
    };
  }

  var api = {
    install: install,
    mapXviewSourceFromPayload: mapXviewSourceFromPayload,
    KIND_TO_TYPE: KIND_TO_TYPE
  };
  if (typeof window !== 'undefined') window.LexeraTreeCrossViewDrop = api;
  if (typeof globalThis !== 'undefined') globalThis.LexeraTreeCrossViewDrop = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
