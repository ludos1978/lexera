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

  // 2026-05-10: track which webviews have already had install() wire
  // their listeners, to make the call idempotent. The user reported
  // workspace→kanban drag (same board) taking ~10s vs instant within-
  // kanban; their pasted log showed TWO `apply.local-drop.received`
  // lines firing at the same millisecond for a single broadcast →
  // the shell had the apply listener subscribed twice, both ran
  // loadBoard+applyDrop+saveBoard, the second save raced the first
  // and the backend treated it as an external edit, triggering a
  // MainFileChanged cascade + live-sync snapshot adopt + 2× full
  // renderColumns of 2324 cards (1745ms + 1502ms). Root cause: a
  // second `bootMultiview()` call in the shell (separate regression
  // tracked at TODOs line 147 / fb907e38). The guard below is the
  // belt-and-braces protection: even if bootMultiview re-runs, the
  // second install() is a no-op so the listeners stay single-fire.
  // Keyed by the `wv` object itself (WeakSet) so different shell
  // webviews — main window + popped-out window — each install
  // independently; only "same wv twice" is rejected.
  var _installedWebviews = (typeof WeakSet === 'function') ? new WeakSet() : null;

  // Diagnostic helper: collect a summary of every card's (id, kid)
  // pair from a loaded KanbanBoard plus an explicit presence check
  // for `lookupKid` against the WHOLE board (not just the
  // truncated sample). Sample is capped at `limit` so a 100-card
  // board doesn't flood the log; `total` reports the real count.
  // `lookupKidFound` answers the headline question: is the
  // source's entityId actually in the loaded board, or is the
  // workspace tree showing stale data?
  function collectCardIdSummary(board, limit, lookupKid) {
    var sample = [];
    var total = 0;
    var lookupFound = false;
    var rows = board && Array.isArray(board.rows) ? board.rows : [];
    for (var r = 0; r < rows.length; r++) {
      var stacks = (rows[r] && Array.isArray(rows[r].stacks)) ? rows[r].stacks : [];
      for (var s = 0; s < stacks.length; s++) {
        var cols = (stacks[s] && Array.isArray(stacks[s].columns)) ? stacks[s].columns : [];
        for (var c = 0; c < cols.length; c++) {
          var cards = (cols[c] && Array.isArray(cols[c].cards)) ? cols[c].cards : [];
          for (var k = 0; k < cards.length; k++) {
            var card = cards[k];
            if (!card) continue;
            total++;
            if (lookupKid && (card.id === lookupKid || card.kid === lookupKid)) {
              lookupFound = true;
            }
            if (sample.length < limit) {
              sample.push({ id: card.id || null, kid: card.kid || null });
            }
          }
        }
      }
    }
    return {
      total: total,
      lookupKid: lookupKid || null,
      lookupKidFound: lookupKid ? lookupFound : null,
      sample: sample
    };
  }

  // Walk the hierarchy looking for an entity with `targetId`. Returns
  // `{ parent: Array, index: number }` so the caller can splice.
  // Returns null when not found.
  //
  // Cards match against EITHER `card.id` (the Loro container id —
  // shape "crdt-N-…") OR `card.kid` (the persistent 8-char hex id
  // backend logs report as `state_kids`). The source can carry
  // either form depending on which API populated the workspace
  // tree (`getBoardHierarchy` vs `getBoardColumns`); the destination
  // DOM also exposes both as `data-card-id` / `data-card-kid`. This
  // mirrors the same id-OR-kid fallback `findColumnRefByStablePath`
  // uses (commit 966c921f) — without it, a workspace-tree → kanban
  // card drop with mismatched id formats hits applyEntityReorder,
  // returns false at locateEntity, and the user-pasted log's
  // `apply.local-drop.skip(applyDrop-returned-false)` line fires.
  // Rows / stacks / columns only have `id` so they keep the
  // single-field match.
  function matchesCardEntity(card, entityId) {
    if (!card) return false;
    if (card.id === entityId) return true;
    if (card.kid && card.kid === entityId) return true;
    return false;
  }
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
              if (matchesCardEntity(cards[ki], entityId)) return { parent: cards, index: ki };
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Move `source` so it lands beside `target` within a SINGLE board.
   * Handles BOTH same-parent reorder (sibling shuffle inside one
   * column / stack / row) AND cross-parent move (drag a card from
   * column A to column B inside the same board, etc). Returns true
   * on success, false when the kinds don't match, an id is missing,
   * or source === target. Mutates `board` in place; caller is
   * expected to pass the full `KanbanBoard` going to `saveBoard`.
   *
   * 2026-05-09 user-reported regression: cross-column card moves
   * within the same board hit the source's local-drop path (cursor
   * stayed inside source webview) and applyDrop returned false
   * because the previous implementation rejected `src.parent !==
   * tgt.parent`. Now both cases share the splice + reinsert path;
   * the same-parent index adjustment only fires when the parents
   * truly are the same array.
   */
  function applyEntityReorder(board, source, target) {
    if (!board || !source || !target) return false;
    if (source.kind !== target.kind) return false;
    if (source.entityId === target.entityId) return false;
    var src = locateEntity(board, source.kind, source.entityId);
    var tgt = locateEntity(board, target.kind, target.entityId);
    if (!src || !tgt) return false;
    var moved = src.parent.splice(src.index, 1)[0];
    var insertAt = tgt.index;
    // Only adjust for the removed slot when source and target share
    // the parent array — cross-parent moves don't shift the target's
    // index because the splice happened in a different list.
    if (src.parent === tgt.parent && src.index < tgt.index) insertAt -= 1;
    // `target.position` ('before' | 'after') controls which side of
    // the target the source lands on. Defaults to 'before' so old
    // call sites (no zone-aware drop) keep their existing behaviour.
    if (target.position === 'after') insertAt += 1;
    tgt.parent.splice(insertAt, 0, moved);
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
    'stack->row': function (row) { return row && Array.isArray(row.stacks) ? row.stacks : null; },
    // Drop a row directly onto the kanban (board) — row joins
    // `board.rows`. The "container" passed to this picker is the
    // KanbanBoard itself, since rows sit at the top level.
    'row->board': function (b) { return b && Array.isArray(b.rows) ? b.rows : null; }
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
    if (!src) return false;
    // The board itself is the absorb container for the special
    // `row -> board` case — there's nothing to "locate" since the
    // board is the root. Other targets (column / stack / row) live
    // inside the hierarchy and need a regular lookup.
    var children;
    if (target.kind === 'board') {
      children = rule(board);
    } else {
      var tgt = locateEntityRich(board, target.kind, target.entityId);
      if (!tgt) return false;
      children = rule(tgt.entity);
    }
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
    // No `src.index` adjustment needed — source and target live in
    // different arrays. Honour `target.position` ('before' | 'after').
    var insertAt = target.position === 'after' ? tgt.index + 1 : tgt.index;
    tgt.parent.splice(insertAt, 0, moved);
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
    if (!src) return false;
    var children;
    if (target.kind === 'board') {
      children = rule(tgtBoard);
    } else {
      var tgt = locateEntityRich(tgtBoard, target.kind, target.entityId);
      if (!tgt) return false;
      children = rule(tgt.entity);
    }
    if (!children) return false;
    var moved = src.parent.splice(src.index, 1)[0];
    children.push(moved);
    return true;
  }

  /**
   * In-place rename of an existing entity. Mutates `board` in place
   * and returns true when the entity was found and renamed; false
   * when the kind is unknown, the entity is missing, the new title
   * is the same as the existing one (no-op), or the new title is
   * empty (we don't allow blanking a title from this surface).
   */
  function applyEntityRename(board, source, newTitle) {
    if (!board || !source) return false;
    var trimmed = String(newTitle == null ? '' : newTitle).trim();
    if (!trimmed) return false;
    var found = locateEntity(board, source.kind, source.entityId);
    if (!found) return false;
    var entity = found.parent[found.index];
    if (!entity) return false;
    if (String(entity.title || '') === trimmed) return false;
    entity.title = trimmed;
    return true;
  }

  /**
   * Translate a drag mousemove fired inside ONE webview's document
   * to the host-window screen coordinates and look up which webview
   * the cursor is currently over. Returns the target webview's label
   * + that webview's local x/y so the shell can forward the drag via
   * `multiview_emit_to(targetLabel, 'external-dnd-hover', { x, y, ... })`.
   *
   * Pure function — all geometry is dependency-injected so the helper
   * can be unit-tested without Tauri / shell DOM. Returns `null` when
   * the cursor is outside any known webview, or when the lookup
   * resolves to the SOURCE webview itself (the sub-app handles its
   * own in-document drops; we only forward when the cursor actually
   * crosses a webview boundary).
   *
   * deps: {
   *   sourceWebviewLabel,           // label of the webview firing the
   *                                 // drag mousemove
   *   sourceClientX, sourceClientY, // in source-document client coords
   *   getWebviewRect(label) =>      // top-window rect for any webview
   *     { left, top, right, bottom } | null,
   *   getWebviewLabelAtTopPoint(    // shell helper from multiviewWebview.js
   *     topX, topY) => string | null
   * }
   */
  function routeCrossViewDragPoint(deps) {
    if (!deps) return null;
    var sourceLabel = deps.sourceWebviewLabel || '';
    if (!sourceLabel) return null;
    if (typeof deps.sourceClientX !== 'number' || typeof deps.sourceClientY !== 'number') return null;
    if (typeof deps.getWebviewRect !== 'function') return null;
    if (typeof deps.getWebviewLabelAtTopPoint !== 'function') return null;
    var srcRect = deps.getWebviewRect(sourceLabel);
    if (!srcRect) return null;
    var topX = srcRect.left + deps.sourceClientX;
    var topY = srcRect.top + deps.sourceClientY;
    var targetLabel = deps.getWebviewLabelAtTopPoint(topX, topY);
    if (!targetLabel || targetLabel === sourceLabel) return null;
    var tgtRect = deps.getWebviewRect(targetLabel);
    if (!tgtRect) return null;
    return {
      targetLabel: targetLabel,
      // Local coords inside the target webview's document. The shell
      // emits these straight to `__lexeraExternalDnd.hover(payload, x, y)`
      // running inside the target.
      localX: topX - tgtRect.left,
      localY: topY - tgtRect.top,
      topX: topX,
      topY: topY
    };
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

    // Idempotency guard — bail if this webview already has listeners
    // wired from a prior install() call. Returns false to signal
    // "didn't wire anything this time"; the listeners attached by
    // the first call are still active. See the WeakSet comment at
    // module top for the user-reported lag this protects against.
    if (_installedWebviews && _installedWebviews.has(wv)) {
      if (typeof window !== 'undefined' && typeof window.lexeraLog === 'function') {
        try {
          window.lexeraLog('debug',
            '[xview-dnd] install.idempotent-skip {"label":"' + (wv.label || '?') + '"}');
        } catch (_) { /* non-fatal */ }
      }
      return false;
    }
    if (_installedWebviews) _installedWebviews.add(wv);

    // NOTE: subscription to `hierarchy-entity-drop` and
    // `hierarchy-entity-rename` is now gated on shell-detection
    // below (the cross-view forwarder block) — `install` runs in
    // EVERY webview that has LexeraApi (workspace tree sub-apps,
    // every embedded kanban webview, AND the shell), and unconditional
    // subscription meant 3+ subscribers all ran loadBoard +
    // applyDrop + saveBoard for each broadcast. The redundant saves
    // raced against the destination kanban's own legacy local-apply
    // path (`__lexeraExternalDnd.drop` via embeddedBoardBridge's
    // relayExternalDnd) and surfaced as the user-visible
    // "External Changes Need Resolution" warning + visible apply lag.
    // Reported 2026-05-10. Only the SHELL needs to subscribe.

    // Cross-view drag forwarding (Phase 5).
    //
    // Sub-app webviews can emit `hierarchy-entity-drag-move` /
    // `hierarchy-entity-drag-end-external` broadcasts while the user
    // is dragging an entity. We translate the cursor's source-doc
    // coords to top-window coords, look up which webview the cursor
    // is over, and emit `external-dnd-hover` / `external-dnd-drop`
    // straight to that target webview. Receivers install
    // `window.__lexeraExternalDnd.{hover,drop}` to consume.
    //
    // `getWebviewLabelAtTopPoint` and `getWebviewRect` come from
    // `LexeraMultiview` (`multiviewWebview.js`); they're optional
    // deps on `install()` so the bridge stays unit-testable without
    // Tauri.
    var getWebviewLabelAtTopPoint = deps.getWebviewLabelAtTopPoint;
    var getWebviewRect = deps.getWebviewRect;
    // Diagnostic logger for the cross-view DnD chain. Each handoff
    // emits one line so the user can open the Log panel filtered to
    // `debug` level and SEE where the drag falls off (no payload =
    // stage 1 fail; routed=null = stage 3 fail; emit error = stage 4
    // fail; etc.). User-reported "cross view drag & drop doesn't work"
    // is impossible to fix without runtime evidence; this surfaces it.
    // Drag-move spam is throttled — only the first drag-move per drag
    // session logs the route info; subsequent moves stay quiet.
    var _xviewLogged = { dragMove: false };
    function xviewLog(stage, info) {
      if (typeof window === 'undefined' || typeof window.lexeraLog !== 'function') return;
      try {
        window.lexeraLog('debug', '[xview-dnd] ' + stage + ' ' + JSON.stringify(info || {}));
      } catch (_) { /* non-fatal */ }
    }
    function broadcastBoardChanged(boardId) {
      return invoke('multiview_broadcast_global_subscribers', {
        event: 'hierarchy-board-changed',
        payload: { boardId: boardId }
      });
    }
    function getExternalDndType(source) {
      var kindToType = { row: 'tree-row', stack: 'tree-stack', column: 'tree-column', card: 'tree-card' };
      var kind = source && source.kind;
      return kindToType[kind] || ('tree-' + kind);
    }
    function logNoForwardTarget(eventName, payload, isDragEnd) {
      if (isDragEnd || !_xviewLogged.dragMove) {
        xviewLog('forward.skip(no-target-webview-at-cursor)', {
          eventName: eventName,
          sourceWebviewLabel: payload && payload.sourceWebviewLabel,
          sourceClientX: payload && payload.sourceClientX,
          sourceClientY: payload && payload.sourceClientY,
          sourceScreenX: payload && payload.sourceScreenX,
          sourceScreenY: payload && payload.sourceScreenY
        });
        _xviewLogged.dragMove = !isDragEnd;
      }
    }
    function emitForwardedDnd(eventName, payload, routed) {
      var isDragEnd = eventName === 'external-dnd-drop';
      var type = getExternalDndType(payload.source);
      if (isDragEnd || !_xviewLogged.dragMove) {
        xviewLog('forward.emit', {
          eventName: eventName,
          targetLabel: routed.targetLabel,
          kind: payload.source.kind,
          type: type
        });
        _xviewLogged.dragMove = !isDragEnd;
      }
      if (isDragEnd) _xviewLogged.dragMove = false; // reset for next drag
      invoke('multiview_emit_to', {
        target: routed.targetLabel,
        event: eventName,
        payload: {
          payload: { source: payload.source, type: type },
          x: routed.localX,
          y: routed.localY
        }
      }).catch(function (err) {
        xviewLog('forward.emit.failed', {
          eventName: eventName,
          targetLabel: routed.targetLabel,
          err: (err && err.message) ? err.message : String(err)
        });
      });
    }
    function forwardCrossViewDrag(eventName, payload) {
      var isDragEnd = eventName === 'external-dnd-drop';
      if (!payload || !payload.source) {
        xviewLog('forward.skip(no-payload-source)', { eventName: eventName });
        return;
      }
      var routed = routeCrossViewDragPoint({
        sourceWebviewLabel: payload.sourceWebviewLabel || '',
        sourceClientX: payload.sourceClientX,
        sourceClientY: payload.sourceClientY,
        getWebviewRect: getWebviewRect,
        getWebviewLabelAtTopPoint: getWebviewLabelAtTopPoint
      });
      if (routed) {
        emitForwardedDnd(eventName, payload, routed);
        return;
      }

      // Top-level-window to top-level-window routing cannot be
      // resolved from the source shell's local webview registry. Only
      // the shell that owns the source webview asks Rust for a global
      // screen-coordinate hit-test, then emits directly to the target
      // label. Other shells receive the global drag lifecycle event
      // too, but ignore it because they do not own sourceWebviewLabel.
      var ownsSource = false;
      try {
        ownsSource = !!(payload.sourceWebviewLabel && getWebviewRect(payload.sourceWebviewLabel));
      } catch (_) { ownsSource = false; }
      if (!ownsSource ||
          typeof payload.sourceScreenX !== 'number' ||
          typeof payload.sourceScreenY !== 'number') {
        logNoForwardTarget(eventName, payload, isDragEnd);
        return;
      }

      invoke('multiview_webview_at_screen_point', {
        screenX: payload.sourceScreenX,
        screenY: payload.sourceScreenY,
        sourceWebviewLabel: payload.sourceWebviewLabel || null
      }).then(function (hit) {
        if (!hit || !hit.label) {
          logNoForwardTarget(eventName, payload, isDragEnd);
          return;
        }
        emitForwardedDnd(eventName, payload, {
          targetLabel: hit.label,
          localX: hit.localX,
          localY: hit.localY,
          topX: hit.screenX,
          topY: hit.screenY
        });
      }).catch(function (err) {
        xviewLog('forward.global-hit-test.failed', {
          eventName: eventName,
          err: (err && err.message) ? err.message : String(err)
        });
      });
    }
    var isShellWebview = (typeof getWebviewLabelAtTopPoint === 'function' && typeof getWebviewRect === 'function');
    if (isShellWebview) {
      // Subscribe to ALL hierarchy-drop / rename / drag-move events
      // and install their listeners. Only the shell does the apply
      // work — sub-app webviews and embedded kanban webviews skip
      // this block, so loadBoard + applyDrop + saveBoard fire
      // exactly once per drop instead of once per subscriber.
      invoke('multiview_subscribe', {
        label: wv.label,
        events: [
          'hierarchy-entity-drop',
          'hierarchy-entity-rename',
          'hierarchy-entity-drag-start',
          'hierarchy-entity-drag-move',
          'hierarchy-entity-drag-end-external'
        ]
      }).catch(function () {});
      wv.listen('hierarchy-entity-drag-start', function (event) {
        try {
          var shell = (typeof window !== 'undefined') ? window.LexeraWorkspaceShell : null;
          if (!shell || typeof shell.ensureVisibleBoardFramesLoaded !== 'function') return;
          var p = (event && event.payload) || {};
          var count = shell.ensureVisibleBoardFramesLoaded('xview-drag-start');
          xviewLog('preload.visible-board-frames.requested', {
            count: count,
            sourceKind: p && p.kind,
            sourceBoard: p && p.boardId
          });
        } catch (err) {
          xviewLog('preload.visible-board-frames.failed', {
            err: (err && err.message) ? err.message : String(err)
          });
        }
      });
      wv.listen('hierarchy-entity-drag-move', function (event) {
        forwardCrossViewDrag('external-dnd-hover', (event && event.payload) || null);
      });
      wv.listen('hierarchy-entity-drag-end-external', function (event) {
        forwardCrossViewDrag('external-dnd-drop', (event && event.payload) || null);
      });
      xviewLog('install.cross-view-enabled', { label: wv.label });
    } else {
      // Cross-view drag forwarder NOT activated in this webview. Most
      // common reason: this is a sub-app webview where
      // LexeraMultiviewWebview (which owns getWebviewLabelAtTopPoint /
      // getWebviewRect) isn't loaded — that's expected; cross-view
      // routing is shell-only. But if this fires in the SHELL webview
      // it's a real problem (probably a load-order regression where
      // multiviewClient.bootMultiview ran before multiviewWebview.js
      // was parsed). The log surfaces the case so the user sees it
      // when opening the in-app Log panel filtered to `debug`.
      xviewLog('install.same-board-only(no-multiview-deps)', {
        label: wv.label,
        hasGetLabelAtTopPoint: typeof getWebviewLabelAtTopPoint === 'function',
        hasGetWebviewRect: typeof getWebviewRect === 'function'
      });
      // Sub-app / embedded-kanban webviews bail BEFORE installing
      // the apply listeners. Only the shell holds the authoritative
      // apply path. Returning here keeps the `install()` contract
      // (return true means "apply path is wired") honest — true
      // ONLY in the shell.
      return false;
    }

    wv.listen('hierarchy-entity-rename', function (event) {
      var p = (event && event.payload) || {};
      var source = p.source || null;
      var newTitle = p.newTitle;
      if (!source || !source.boardId) return;
      Promise.resolve(loadBoard(source.boardId)).then(function (board) {
        if (!board) return;
        if (!applyEntityRename(board, source, newTitle)) return;
        return Promise.resolve(saveBoard(source.boardId, board)).then(function () {
          broadcastBoardChanged(source.boardId).catch(function () { /* non-fatal */ });
          if (typeof deps.onApplied === 'function') deps.onApplied(source.boardId);
        });
      }).catch(function (err) {
        if (typeof deps.onError === 'function') deps.onError(err);
      });
    });

    wv.listen('hierarchy-entity-drop', function (event) {
      var p = (event && event.payload) || {};
      var source = p.source || null;
      var target = p.target || null;
      // Diagnostic: log every local-drop arrival on the shell so the
      // user can see in the Log panel that the drop reached the apply
      // path. Same `[xview-dnd]` prefix as the cross-view chain so a
      // single Log-panel filter shows local + cross-view together.
      xviewLog('apply.local-drop.received', {
        srcKind: source && source.kind,
        srcId: source && source.entityId,
        tgtKind: target && target.kind,
        tgtId: target && target.entityId,
        tgtPosition: target && target.position,
        srcBoard: source && source.boardId,
        tgtBoard: target && target.boardId,
        sameBoard: source && target && source.boardId === target.boardId
      });
      if (!source || !target) {
        xviewLog('apply.local-drop.skip(missing-source-or-target)', {});
        return;
      }
      if (!source.boardId || !target.boardId) {
        xviewLog('apply.local-drop.skip(missing-boardId)', {});
        return;
      }
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
        if (!srcBoard || !tgtBoard) {
          xviewLog('apply.local-drop.skip(loadBoard-returned-null)', {
            hasSrc: !!srcBoard, hasTgt: !!tgtBoard
          });
          return;
        }
        var applied = applyDrop(srcBoard, tgtBoard, source, target);
        if (!applied) {
          // Diagnose WHY applyDrop bailed. Re-runs locateEntity with
          // the same id to surface whether the source / target /
          // both were not findable. Tells the user-pasted log
          // exactly what id format is in play and which side of the
          // pair is missing — without this, "applyDrop-returned-false"
          // is opaque and we can't tell self-drop / id-mismatch /
          // missing-card / etc apart.
          var srcLocated = locateEntity(srcBoard, source.kind, source.entityId);
          var tgtLocated = locateEntity(tgtBoard, target.kind, target.entityId);
          xviewLog('apply.local-drop.skip(applyDrop-returned-false)', {
            srcKind: source.kind,
            srcId: source.entityId,
            srcLocated: !!srcLocated,
            tgtKind: target.kind,
            tgtId: target.entityId,
            tgtLocated: !!tgtLocated,
            sameKind: source.kind === target.kind,
            sameEntity: source.entityId === target.entityId,
            tgtPosition: target.position
          });
          // When the lookup of source / target failed, dump card
          // (id, kid) pairs from the loaded boards. The dump now
          // explicitly checks whether the looked-up kid is present
          // in the WHOLE board (not just the truncated sample), so
          // `lookupKidFound: false` is the smoking gun for stale
          // workspace-tree cache vs id-format issue.
          if (source.kind === 'card' && (!srcLocated || !tgtLocated)) {
            xviewLog('apply.local-drop.skip.diagnose', {
              srcBoardCards: collectCardIdSummary(srcBoard, 30, source.entityId),
              tgtBoardCards: sameBoard ? '(sameBoard — see srcBoardCards)' : collectCardIdSummary(tgtBoard, 30, target.entityId)
            });
          }
          // Cache-invalidation: if the SOURCE wasn't findable in
          // the loaded board, the workspace tree is showing stale
          // data — broadcast `hierarchy-board-changed` for the
          // source's boardId so the tree re-fetches its hierarchy
          // and the user's NEXT drag carries fresh ids. Same fix
          // path the post-saveBoard broadcast already uses; here it
          // fires on bail too. The user still loses this drop, but
          // the next attempt should succeed without manual reload.
          if (!srcLocated && source.boardId) {
            xviewLog('apply.local-drop.refresh-stale-tree', { boardId: source.boardId });
            try {
              broadcastBoardChanged(source.boardId).catch(function () { /* non-fatal */ });
            } catch (_) { /* non-fatal */ }
          }
          return;
        }
        var saves = sameBoard
          ? [Promise.resolve(saveBoard(source.boardId, srcBoard))]
          : [
              Promise.resolve(saveBoard(source.boardId, srcBoard)),
              Promise.resolve(saveBoard(target.boardId, tgtBoard))
            ];
        return Promise.all(saves).then(function () {
          xviewLog('apply.local-drop.saved', { affected: sameBoard ? 1 : 2 });
          // Notify every webview in the window that the affected boards
          // changed so sub-apps can drop their cached hierarchy and
          // refetch. Without this, the user sees no visible reorder
          // because the workspaces / hierarchy sub-app re-renders from
          // its stale `boardHierarchies` cache.
          var affected = sameBoard ? [source.boardId] : [source.boardId, target.boardId];
          for (var i = 0; i < affected.length; i++) {
            broadcastBoardChanged(affected[i]).catch(function () { /* non-fatal */ });
          }
          if (typeof deps.onApplied === 'function') {
            deps.onApplied(source.boardId);
            if (!sameBoard) deps.onApplied(target.boardId);
          }
        });
      }).catch(function (err) {
        xviewLog('apply.local-drop.failed', {
          err: (err && err.message) ? err.message : String(err)
        });
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
    applyEntityRename: applyEntityRename,
    applyDrop: applyDrop,
    routeCrossViewDragPoint: routeCrossViewDragPoint,
    install: install
  };
  if (typeof window !== 'undefined') window.LexeraHierarchyDragBridge = api;
  if (typeof globalThis !== 'undefined') globalThis.LexeraHierarchyDragBridge = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
