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

  // Cross-kind "absorb" rules (Phase 4). When the user drags an
  // entity onto a CONTAINER one level above its own kind, the entity
  // joins the end of the container's children array. Defined as a
  // table so future absorb relations (column → stack, stack → row)
  // can be added by appending entries.
  var ABSORB_RULES = {
    'card->column': function (col) { return col && Array.isArray(col.cards) ? col.cards : null; },
    'column->stack': function (st) { return st && Array.isArray(st.columns) ? st.columns : null; },
    'stack->row': function (row) { return row && Array.isArray(row.stacks) ? row.stacks : null; }
  };
  // Locate an entity AND return its underlying object so the absorb
  // helpers can hand it to the kind-specific child-array picker.
  function locateEntityRich(board, kind, entityId) {
    var found = locateEntity(board, kind, entityId);
    if (!found) return null;
    return {
      parent: found.parent,
      index: found.index,
      entity: found.parent[found.index]
    };
  }

  /**
   * Same-board cross-kind drop: append `source` to `target`'s children
   * array. Mutates `board` in place. Returns true when the kinds form
   * a valid container relation (card→column, column→stack, stack→row),
   * false otherwise.
   */
  function applyEntityAbsorb(board, source, target) {
    if (!board || !source || !target) return false;
    if (source.kind === target.kind) return false;
    var rule = ABSORB_RULES[source.kind + '->' + target.kind];
    if (!rule) return false;
    var src = locateEntity(board, source.kind, source.entityId);
    var tgt = locateEntityRich(board, target.kind, target.entityId);
    if (!src || !tgt) return false;
    var children = rule(tgt.entity);
    if (!children) return false;
    var moved = src.parent.splice(src.index, 1)[0];
    children.push(moved);
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
   * Cross-board cross-kind absorb: take `source` out of `srcBoard`
   * and append to `target`'s children array inside `tgtBoard`.
   * Mirrors `applyEntityAbsorb` but across boards. Same kind-pair
   * rules apply (card→column, column→stack, stack→row).
   *
   * Returns true on success; false when the kind pair is not a
   * valid one-level absorb, the boards are the same (caller should
   * route to `applyEntityAbsorb`), or any required entity is missing.
   */
  function applyCrossBoardEntityAbsorb(srcBoard, tgtBoard, source, target) {
    if (!srcBoard || !tgtBoard || !source || !target) return false;
    if (source.kind === target.kind) return false;
    if (source.boardId === target.boardId) return false;
    var rule = ABSORB_RULES[source.kind + '->' + target.kind];
    if (!rule) return false;
    var src = locateEntity(srcBoard, source.kind, source.entityId);
    var tgt = locateEntityRich(tgtBoard, target.kind, target.entityId);
    if (!src || !tgt) return false;
    var children = rule(tgt.entity);
    if (!children) return false;
    var moved = src.parent.splice(src.index, 1)[0];
    children.push(moved);
    return true;
  }

  /**
   * Unified dispatch. Picks the right pure helper based on whether
   * the move is same-board / cross-board, and same-kind / cross-kind:
   *
   *   same-board same-kind  → applyEntityReorder
   *   same-board cross-kind → applyEntityAbsorb
   *   cross-board same-kind → applyCrossBoardEntityReorder
   *   cross-board cross-kind→ applyCrossBoardEntityAbsorb
   *
   * Returns `true` when a helper applied the move (one or both boards
   * mutated in place); `false` when nothing matched. The caller is
   * expected to persist the affected board(s) themselves — this
   * helper does NOT call `saveBoard`. `install()` wraps this with
   * the IO dispatch.
   *
   * For same-board calls the second board argument is ignored, but
   * passing the same reference for both keeps the caller branchless.
   */
  function applyDrop(srcBoard, tgtBoard, source, target) {
    if (!source || !target) return false;
    var sameBoard = source.boardId === target.boardId;
    if (sameBoard) {
      return source.kind === target.kind
        ? applyEntityReorder(srcBoard, source, target)
        : applyEntityAbsorb(srcBoard, source, target);
    }
    return source.kind === target.kind
      ? applyCrossBoardEntityReorder(srcBoard, tgtBoard, source, target)
      : applyCrossBoardEntityAbsorb(srcBoard, tgtBoard, source, target);
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
      var sameBoard = source.boardId === target.boardId;
      // Load the affected board(s); for same-board the second slot is
      // a duplicate so `applyDrop` can stay branchless.
      var loads = sameBoard
        ? [Promise.resolve(loadBoard(source.boardId))]
        : [
            Promise.resolve(loadBoard(source.boardId)),
            Promise.resolve(loadBoard(target.boardId))
          ];
      Promise.all(loads).then(function (boards) {
        var srcBoard = boards[0];
        var tgtBoard = sameBoard ? srcBoard : boards[1];
        if (!srcBoard || !tgtBoard) return;
        if (!applyDrop(srcBoard, tgtBoard, source, target)) return;
        var saves = sameBoard
          ? [Promise.resolve(saveBoard(source.boardId, srcBoard))]
          : [
              Promise.resolve(saveBoard(source.boardId, srcBoard)),
              Promise.resolve(saveBoard(target.boardId, tgtBoard))
            ];
        return Promise.all(saves).then(function () {
          if (typeof deps.onApplied === 'function') {
            deps.onApplied(source.boardId);
            if (!sameBoard) deps.onApplied(target.boardId);
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
    applyEntityAbsorb: applyEntityAbsorb,
    applyCrossBoardEntityReorder: applyCrossBoardEntityReorder,
    applyCrossBoardEntityAbsorb: applyCrossBoardEntityAbsorb,
    applyDrop: applyDrop,
    install: install
  };
  if (typeof window !== 'undefined') window.LexeraHierarchyDragBridge = api;
  if (typeof globalThis !== 'undefined') globalThis.LexeraHierarchyDragBridge = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
