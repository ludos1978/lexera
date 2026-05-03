/**
 * LexeraHierarchyDragBridge — shell-side handler for the
 * `hierarchy-entity-drop` broadcasts emitted by the workspaces and
 * hierarchy sub-apps when the user drags a row / stack / column / card
 * onto a sibling (Phase 2 of "boards must be re-orderable").
 *
 * The bridge is split into:
 *
 *   - `applyEntityReorder(board, source, target)` — pure function that
 *     mutates a `KanbanBoard` in place by moving the source entity to
 *     the target's index inside the same parent. Returns true when the
 *     move was applied, false when source and target are not siblings
 *     (cross-parent / cross-board moves are Phase 3 / 4 territory).
 *
 *   - `install({ invoke, getCurrentWebview, ... })` — wires the
 *     listener so the production shell receives drop events and
 *     persists the move via `LexeraApi.saveBoard`. Kept dependency-
 *     injected so the pure helper can be tested without any Tauri
 *     globals.
 *
 * IIFE module — no const/let, no ES imports.
 */
(function () {
  'use strict';

  // Walk the hierarchy looking for an entity with `targetId`. Returns
  // `{ parent: Array, index: number }` so the caller can splice.
  // Returns null when not found.
  function locateEntity(board, kind, entityId) {
    if (!board || !entityId) return null;
    var rows = Array.isArray(board.rows) ? board.rows : null;
    if (!rows) return null;
    if (kind === 'row') {
      for (var ri = 0; ri < rows.length; ri++) {
        if (rows[ri] && rows[ri].id === entityId) return { parent: rows, index: ri };
      }
      return null;
    }
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var stacks = row && Array.isArray(row.stacks) ? row.stacks : [];
      if (kind === 'stack') {
        for (var si = 0; si < stacks.length; si++) {
          if (stacks[si] && stacks[si].id === entityId) return { parent: stacks, index: si };
        }
        continue;
      }
      for (var s = 0; s < stacks.length; s++) {
        var stack = stacks[s];
        var cols = stack && Array.isArray(stack.columns) ? stack.columns : [];
        if (kind === 'column') {
          for (var ci = 0; ci < cols.length; ci++) {
            if (cols[ci] && cols[ci].id === entityId) return { parent: cols, index: ci };
          }
          continue;
        }
        for (var c = 0; c < cols.length; c++) {
          var col = cols[c];
          var cards = col && Array.isArray(col.cards) ? col.cards : [];
          if (kind === 'card') {
            for (var ki = 0; ki < cards.length; ki++) {
              if (cards[ki] && cards[ki].id === entityId) return { parent: cards, index: ki };
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Move `source` to `target.index` inside its parent array within a
   * SINGLE board. Returns true on success, false when the move is not
   * a sibling reorder (different parents, missing entity, mismatched
   * kind, identity equals). Mutates `board` in place — the caller is
   * expected to pass the full `KanbanBoard` it intends to send back
   * to `saveBoard`.
   */
  function applyEntityReorder(board, source, target) {
    if (!board || !source || !target) return false;
    if (source.kind !== target.kind) return false;
    if (source.entityId === target.entityId) return false;
    var src = locateEntity(board, source.kind, source.entityId);
    var tgt = locateEntity(board, target.kind, target.entityId);
    if (!src || !tgt) return false;
    // Sibling reorder requires both entities live in the same parent
    // array. Cross-parent moves within the same board are not handled
    // here — Phase 4 (tree↔board) covers that surface.
    if (src.parent !== tgt.parent) return false;
    var moved = src.parent.splice(src.index, 1)[0];
    var insertAt = tgt.index;
    if (src.index < tgt.index) insertAt -= 1;
    src.parent.splice(insertAt, 0, moved);
    return true;
  }

  /**
   * Move `source` from `srcBoard` into the parent array containing
   * `target` inside `tgtBoard`. Used when the user drags an entity
   * onto a sibling that lives in a DIFFERENT board (Phase 3). Both
   * boards are mutated in place; the caller is expected to persist
   * BOTH via `saveBoard` so the source is removed from board A and
   * the destination's new ordering is recorded on board B.
   *
   * Returns true on success; false when the kinds mismatch, the
   * source/target IDs are missing, or the boards are the same (the
   * caller should route to `applyEntityReorder` for same-board
   * moves).
   */
  function applyCrossBoardEntityReorder(srcBoard, tgtBoard, source, target) {
    if (!srcBoard || !tgtBoard || !source || !target) return false;
    if (source.kind !== target.kind) return false;
    if (source.boardId === target.boardId) return false;
    if (source.entityId === target.entityId) return false;
    var src = locateEntity(srcBoard, source.kind, source.entityId);
    var tgt = locateEntity(tgtBoard, target.kind, target.entityId);
    if (!src || !tgt) return false;
    var moved = src.parent.splice(src.index, 1)[0];
    tgt.parent.splice(tgt.index, 0, moved);
    return true;
  }

  /**
   * Production wiring. Listens for `hierarchy-entity-drop` events
   * from any sub-app webview, looks up the matching board via
   * dependency-injected callbacks, applies the reorder, and persists
   * via `saveBoard`. All IO is dependency-injected so the bridge is
   * fully testable.
   *
   * deps: {
   *   getCurrentWebview() => { listen, label },
   *   invoke(cmd, args),
   *   loadBoard(boardId) => Promise<KanbanBoard>,
   *   saveBoard(boardId, board) => Promise,
   *   onApplied?(boardId) => void   // optional success hook
   *   onError?(err) => void          // optional error hook
   * }
   */
  function install(deps) {
    deps = deps || {};
    var getCurrentWebview = deps.getCurrentWebview;
    var invoke = deps.invoke;
    var loadBoard = deps.loadBoard;
    var saveBoard = deps.saveBoard;
    if (typeof getCurrentWebview !== 'function') return false;
    if (typeof invoke !== 'function') return false;
    if (typeof loadBoard !== 'function') return false;
    if (typeof saveBoard !== 'function') return false;

    var wv = getCurrentWebview();
    if (!wv || typeof wv.listen !== 'function') return false;

    invoke('multiview_subscribe', {
      label: wv.label,
      events: ['hierarchy-entity-drop']
    }).catch(function () { /* non-fatal */ });

    wv.listen('hierarchy-entity-drop', function (event) {
      var p = (event && event.payload) || {};
      var source = p.source || null;
      var target = p.target || null;
      if (!source || !target) return;
      if (!source.boardId || !target.boardId) return;
      // Same-board: load one board, apply sibling reorder, save one.
      if (source.boardId === target.boardId) {
        var boardId = source.boardId;
        Promise.resolve(loadBoard(boardId)).then(function (board) {
          if (!board) return;
          if (!applyEntityReorder(board, source, target)) return;
          return Promise.resolve(saveBoard(boardId, board)).then(function () {
            if (typeof deps.onApplied === 'function') deps.onApplied(boardId);
          });
        }).catch(function (err) {
          if (typeof deps.onError === 'function') deps.onError(err);
        });
        return;
      }
      // Cross-board (Phase 3): load BOTH boards, splice source out of
      // A and into B, save BOTH. `onApplied` fires once per affected
      // board so listeners can refresh per-board state.
      Promise.all([
        Promise.resolve(loadBoard(source.boardId)),
        Promise.resolve(loadBoard(target.boardId))
      ]).then(function (boards) {
        var srcBoard = boards[0];
        var tgtBoard = boards[1];
        if (!srcBoard || !tgtBoard) return;
        if (!applyCrossBoardEntityReorder(srcBoard, tgtBoard, source, target)) return;
        return Promise.all([
          Promise.resolve(saveBoard(source.boardId, srcBoard)),
          Promise.resolve(saveBoard(target.boardId, tgtBoard))
        ]).then(function () {
          if (typeof deps.onApplied === 'function') {
            deps.onApplied(source.boardId);
            deps.onApplied(target.boardId);
          }
        });
      }).catch(function (err) {
        if (typeof deps.onError === 'function') deps.onError(err);
      });
    });

    return true;
  }

  var api = {
    applyEntityReorder: applyEntityReorder,
    applyCrossBoardEntityReorder: applyCrossBoardEntityReorder,
    install: install
  };
  if (typeof window !== 'undefined') window.LexeraHierarchyDragBridge = api;
  if (typeof globalThis !== 'undefined') globalThis.LexeraHierarchyDragBridge = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
