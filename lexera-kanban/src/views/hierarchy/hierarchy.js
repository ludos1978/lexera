// Hierarchy sub-app — workspace navigation panel.
//
// The whole panel renders as a single TreeView (treeView.js) — same
// component the dashboard, files panel, and main board sidebar use, so
// every hierarchical surface in the app shares one visual treatment.
// Tree shape (boards are the top-level roots — the workspace name lives
// in the panel header, not inside the tree):
//
//   board (root, type='board')          ← lazy-loads its children on expand
//   └── row (type='row')
//       └── stack (type='stack')
//           └── column (type='column')
//               └── card (type='card')
//
// Per-board hierarchy (rows/stacks/columns/cards) is fetched once via
// `LexeraApi.getBoardHierarchy(id)` and cached for the panel lifetime.

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function resolveBoardLabel(board) {
    return window.LexeraTitleHelpers.resolveBoardLabel(board);
  }

  var statusEl = document.getElementById('status');
  var titleEl = document.getElementById('title');
  var viewModeEl = document.getElementById('view-mode');
  var localBoardsEl = document.getElementById('local-boards');
  var localCountEl = document.getElementById('local-count');

  var activeBoardId = null;
  var REMOTE_WORKSPACE_ID = '__remote_boards__';
  var REMOTE_WORKSPACE_NAME = 'Remote Boards';
  var selectedWorkspaceId = null;
  var latestCatalog = null;
  // Per-board fold state + hierarchy cache. `boardHierarchies[id]` is
  // one of: undefined | 'loading' | 'error' | KanbanRow[].
  var expandedBoardIds = {};
  var boardHierarchies = {};

  function findCatalogBoard(boardId) {
    var snap = latestCatalog || {};
    var lists = [snap.boards || [], snap.remoteBoards || []];
    for (var l = 0; l < lists.length; l++) {
      for (var i = 0; i < lists[l].length; i++) {
        if (String(lists[l][i] && lists[l][i].id || '') === String(boardId || '')) return lists[l][i];
      }
    }
    return null;
  }

  function closeBoardActionMenus() {
    var menus = document.querySelectorAll('.tree-board-action-menu');
    for (var i = 0; i < menus.length; i++) menus[i].remove();
  }

  function runBoardAction(boardId, action) {
    var board = findCatalogBoard(boardId);
    var filePath = board && (board.filePath || board.path || '');
    if (action === 'open-tab') {
      LexeraSubApp.navigate({ type: 'open-board', boardId: boardId });
    } else if (action === 'detach') {
      LexeraSubApp.invoke('open_new_window', { boardId: boardId, profile: 'detachedBoard' }).catch(function () {});
    } else if (action === 'backend-settings') {
      LexeraSubApp.navigate({ type: 'reveal-panel', panelId: 'backendSettings' });
    } else if (action === 'reveal' && filePath) {
      LexeraSubApp.invoke('show_in_folder', { path: filePath }).catch(function () {});
    }
  }

  function showBoardActionMenu(boardId, anchorEl) {
    if (!boardId || !anchorEl) return;
    var board = findCatalogBoard(boardId);
    var filePath = board && (board.filePath || board.path || '');
    var items = [
      { id: 'open-tab', label: 'Open / Focus Tab' },
      { id: 'detach', label: 'Open in Detached Window' },
      { id: 'backend-settings', label: 'Backend Settings' }
    ];
    if (filePath) items.push({ id: 'reveal', label: 'Reveal in Finder' });
    renderMenuAt(anchorEl, items, function (action) {
      runBoardAction(boardId, action);
    });
  }

  // User contract 2026-05-11: "an element in the workspace view
  // must have the same burger menu items as it has in the kanban
  // view (maybe add the focus element) but otherwise it's the same!"
  //
  // Items mirror the kanban's MenuContributorRegistry registrations
  // for the 'card-actions' / 'column-actions' / 'stack-actions' /
  // 'row-actions' sections (contextMenuBuilders.js:258-426). Tag /
  // marp submenus are omitted here because they need board context
  // that isn't available from the workspace tree without a load
  // round-trip — those still surface in the kanban's own native
  // menu when the user opens it there.
  //
  // The extra "Focus <Kind>" item the user asked for sits at the
  // very top so the most-common workspace-tree action stays one
  // click away.
  function buildEntityMenuItems(kind) {
    if (kind === 'card') {
      return [
        { id: 'focus',         label: 'Focus card in Kanban' },
        { separator: true },
        { id: 'insert-before', label: 'Add card before' },
        { id: 'insert-after',  label: 'Add card after' },
        { id: 'duplicate',     label: 'Duplicate card' },
        { separator: true },
        { id: 'copy-markdown', label: 'Copy as markdown' },
        { id: 'copy-html',     label: 'Copy as formatted' },
        { separator: true },
        { id: 'edit',          label: 'Edit card' },
        { separator: true },
        { id: 'park',          label: 'Park card' },
        { id: 'park-copy',     label: 'Park copy' },
        { id: 'archive',       label: 'Archive' },
        { id: 'delete',        label: 'Delete' }
      ];
    }
    if (kind === 'column') {
      return [
        { id: 'focus',         label: 'Focus column in Kanban' },
        { separator: true },
        { id: 'rename',        label: 'Rename column' },
        { id: 'add-card',      label: 'Add card' },
        { id: 'add-after',     label: 'Add column after' },
        { id: 'duplicate',     label: 'Duplicate column' },
        { separator: true },
        { id: 'copy-markdown', label: 'Copy as markdown' },
        { id: 'copy-html',     label: 'Copy as formatted' },
        { id: 'export-column', label: 'Export column' },
        { separator: true },
        { id: 'park',          label: 'Park column' },
        { id: 'archive',       label: 'Archive column' },
        { id: 'delete',        label: 'Delete column' }
      ];
    }
    if (kind === 'stack') {
      return [
        { id: 'focus',            label: 'Focus stack in Kanban' },
        { separator: true },
        { id: 'rename',           label: 'Rename stack' },
        { id: 'add-column',       label: 'Add column' },
        { id: 'add-stack-before', label: 'Add stack before' },
        { id: 'add-stack-after',  label: 'Add stack after' },
        { id: 'duplicate',        label: 'Duplicate stack' },
        { separator: true },
        { id: 'copy-markdown',    label: 'Copy as markdown' },
        { id: 'copy-html',        label: 'Copy as formatted' },
        { id: 'export-stack',     label: 'Export stack' },
        { separator: true },
        { id: 'park',             label: 'Park stack' },
        { id: 'archive',          label: 'Archive stack' },
        { id: 'delete',           label: 'Delete stack' }
      ];
    }
    if (kind === 'row') {
      return [
        { id: 'focus',         label: 'Focus row in Kanban' },
        { separator: true },
        { id: 'rename',        label: 'Rename row' },
        { id: 'add-stack',     label: 'Add stack' },
        { id: 'add-row-after', label: 'Add row after' },
        { id: 'duplicate',     label: 'Duplicate row' },
        { separator: true },
        { id: 'copy-markdown', label: 'Copy as markdown' },
        { id: 'copy-html',     label: 'Copy as formatted' },
        { id: 'export-row',    label: 'Export row' },
        { separator: true },
        { id: 'park',          label: 'Park row' },
        { id: 'archive',       label: 'Archive row' },
        { id: 'delete',        label: 'Delete row' }
      ];
    }
    return [];
  }

  function runEntityAction(node, action) {
    var dragKind = node.getAttribute('data-drag-kind') || '';
    var boardId = node.getAttribute('data-drag-board-id') || '';
    var entityId = node.getAttribute('data-tree-id') || '';
    if (action === 'focus') {
      var focusTarget = { boardId: boardId };
      if (dragKind === 'card') focusTarget.cardId = entityId;
      else if (dragKind === 'column') focusTarget.columnId = entityId;
      else if (dragKind === 'stack') focusTarget.stackId = entityId;
      else if (dragKind === 'row') focusTarget.rowId = entityId;
      else return;
      // User report 2026-05-13: "the card focus system STILL doesnt
      // focus the correct card!!!". Root cause: when the same include
      // file is referenced from multiple columns of the same board (or
      // when the same card-kid appears in multiple DOM positions for
      // any other reason), `findBoardEntityElement` does a board-wide
      // `data-card-kid=<id>` query that returns the FIRST match — which
      // can be a different column's copy than the one the user actually
      // clicked. Fix: harvest ancestor column / stack / row ids from
      // the tree DOM so the kanban-side lookup can scope to the right
      // subtree. Each tree-entry's `.tree-node` carries its own
      // data-drag-kind + data-tree-id; walking up `.tree-entry` parents
      // collects the chain.
      var ancestor = node && node.parentElement;
      while (ancestor) {
        if (ancestor.classList && ancestor.classList.contains('tree-entry')) {
          var ancNode = ancestor.querySelector(':scope > .tree-node[data-tree-id]');
          if (ancNode) {
            var ancKind = ancNode.getAttribute('data-drag-kind') || '';
            var ancId = ancNode.getAttribute('data-tree-id') || '';
            if (ancKind && ancId) {
              if (ancKind === 'column' && !focusTarget.columnId) focusTarget.columnId = ancId;
              else if (ancKind === 'stack' && !focusTarget.stackId) focusTarget.stackId = ancId;
              else if (ancKind === 'row' && !focusTarget.rowId) focusTarget.rowId = ancId;
            }
          }
        }
        ancestor = ancestor.parentElement;
      }
      LexeraSubApp.navigate({ type: 'focus-hierarchy-target', target: focusTarget });
      return;
    }
    if (action === 'rename') {
      startInlineRename(node);
      return;
    }
    // All other actions are dispatched to the kanban frame via the
    // existing per-board IPC channel. The kanban frame's app.js
    // listens for `hierarchy-entity-menu-action`, resolves the
    // entityId → kanban-local indices, and dispatches through
    // ActionRegistry — same path the kanban's own native context
    // menu uses. Board must be open in a tab (we focus first so
    // the kanban frame is alive + has the right active board).
    LexeraSubApp.navigate({ type: 'focus-hierarchy-target', target: {
      boardId: boardId,
      cardId:   dragKind === 'card'   ? entityId : null,
      columnId: dragKind === 'column' ? entityId : null,
      stackId:  dragKind === 'stack'  ? entityId : null,
      rowId:    dragKind === 'row'    ? entityId : null
    } });
    if (window.LexeraSubApp && typeof window.LexeraSubApp.broadcast === 'function') {
      window.LexeraSubApp.broadcast('hierarchy-entity-menu-action', {
        boardId: boardId,
        kind: dragKind,
        entityId: entityId,
        action: action
      });
    }
  }

  function showEntityActionMenu(node, anchorEl) {
    if (!node || !anchorEl) return;
    var dragKind = node.getAttribute('data-drag-kind') || '';
    var items = buildEntityMenuItems(dragKind);
    if (!items.length) return;
    renderMenuAt(anchorEl, items, function (action) {
      runEntityAction(node, action);
    });
  }

  // Shared menu renderer — anchors a dropdown to anchorEl, populates
  // it from items[], routes clicks to onAction.
  function renderMenuAt(anchorEl, items, onAction) {
    closeBoardActionMenus();
    var menu = document.createElement('div');
    menu.className = 'ws-tab-overflow-menu tree-board-action-menu is-open';
    for (var i = 0; i < items.length; i++) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'ws-tab-overflow-menu-item';
      item.setAttribute('data-action', items[i].id);
      var label = document.createElement('span');
      label.className = 'ws-tab-overflow-menu-item-label';
      label.textContent = items[i].label;
      item.appendChild(label);
      menu.appendChild(item);
    }
    menu.addEventListener('click', function (event) {
      var item = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      var action = item.getAttribute('data-action') || '';
      closeBoardActionMenus();
      onAction(action);
    });
    document.body.appendChild(menu);
    var rect = anchorEl.getBoundingClientRect();
    menu.style.top = Math.round(rect.bottom + 2) + 'px';
    menu.style.left = Math.round(Math.max(8, Math.min(rect.right, window.innerWidth - menu.offsetWidth - 8))) + 'px';
    setTimeout(function () {
      document.addEventListener('mousedown', closeBoardActionMenus, { once: true });
    }, 0);
  }

  function resolveWorkspaceFromSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return null;
    if (snap.viewWorkspace && snap.viewWorkspace.id) return snap.viewWorkspace;
    if (snap.activeWorkspace && snap.activeWorkspace.id) return snap.activeWorkspace;
    var preferredId = snap.viewWorkspaceId != null && snap.viewWorkspaceId !== ''
      ? String(snap.viewWorkspaceId)
      : String(snap.activeWorkspaceId || '');
    if (!preferredId) return null;
    if (preferredId === REMOTE_WORKSPACE_ID) {
      return { id: REMOTE_WORKSPACE_ID, name: REMOTE_WORKSPACE_NAME, isRemoteWorkspace: true };
    }
    var workspaces = Array.isArray(snap.workspaces) ? snap.workspaces : [];
    for (var i = 0; i < workspaces.length; i++) {
      if (workspaces[i] && workspaces[i].id === preferredId) return workspaces[i];
    }
    return null;
  }

  function getBoardWorkspaceIds(board) {
    if (!board || typeof board !== 'object') return [];
    if (Array.isArray(board.workspace_ids)) return board.workspace_ids.filter(Boolean);
    if (Array.isArray(board.workspaceIds)) return board.workspaceIds.filter(Boolean);
    if (board.workspace_id) return [board.workspace_id];
    if (board.workspaceId) return [board.workspaceId];
    return [];
  }

  // ── TreeView node builders ──────────────────────────────────────
  function nodeLabel(item) {
    var label = window.LexeraTitleHelpers.resolveBoardLabel(item);
    if (label === 'Untitled') label = item.title || item.name || '';
    return label || '(no title)';
  }
  // Phase 2a: row / stack / column / card nodes carry the canonical
  // TreeView drag grip — same SVG affordance the dashboard, files
  // panel, and main board sidebar use.
  // Phase 2b-1: also mark the `.tree-node` `draggable="true"` so the
  // browser fires native dragstart events. The drop wiring lands in
  // 2b-2; this slice only enables the source half.
  function dragAttrs(boardId, kind) {
    // Pointer-based drag: identify draggable rows by `data-drag-kind`
    // rather than the HTML5 `draggable` attribute (which doesn't fire
    // reliably in WKWebView for these element types).
    return {
      'data-drag-kind': kind,
      'data-drag-board-id': boardId
    };
  }
  function cardDragAttrs(boardId, card) {
    var attrs = dragAttrs(boardId, 'card');
    if (card && card.id != null) attrs['data-card-id'] = String(card.id);
    if (card && card.kid != null) attrs['data-card-kid'] = String(card.kid);
    return attrs;
  }
  function buildCardNode(card, ctx) {
    // Prefer the persistent `card.kid` (8-char hex, surfaces in the
    // backend's `state_kids` log) over `card.id` (a Loro CRDT
    // container id like `crdt-N-…`). Loro container ids regenerate
    // when a board's CRDT state is re-instantiated by a separate
    // `getBoardColumns` call (the path `loadBoard` in the shell-side
    // hierarchyDragBridge follows), so the workspace tree's captured
    // id can drift from the loaded snapshot's id even though they
    // describe the same card. The kid is stable across those calls.
    // Falls back to `card.id` when `card.kid` isn't set (older
    // boards / non-CRDT sources). Reported 2026-05-10:
    // `srcLocated: false` for cross-board drops where the source
    // came from the workspace tree.
    return { id: (card.kid || card.id) || null,
             label: window.LexeraTitleHelpers.resolveCardLabel(card),
             type: 'card',
             children: null, expanded: false, hasToggle: false, grip: true,
             menu: true,
             gripTitle: 'Drag card to reorder',
             attrs: cardDragAttrs(ctx.boardId, card) };
  }
  function buildColumnNode(column, ctx) {
    var cards = Array.isArray(column.cards) ? column.cards : [];
    return { id: column.id || null, label: nodeLabel(column), type: 'column',
             children: cards.map(function (c) { return buildCardNode(c, ctx); }),
             expanded: true, grip: true,
             menu: true,
             gripTitle: 'Drag column to reorder',
             attrs: dragAttrs(ctx.boardId, 'column') };
  }
  function buildStackNode(stack, ctx) {
    var cols = Array.isArray(stack.columns) ? stack.columns : [];
    return { id: stack.id || null, label: nodeLabel(stack), type: 'stack',
             children: cols.map(function (c) { return buildColumnNode(c, ctx); }),
             expanded: true, grip: true,
             menu: true,
             gripTitle: 'Drag stack to reorder',
             attrs: dragAttrs(ctx.boardId, 'stack') };
  }
  function buildRowNode(row, ctx) {
    var stacks = Array.isArray(row.stacks) ? row.stacks : [];
    return { id: row.id || null, label: nodeLabel(row), type: 'row',
             children: stacks.map(function (s) { return buildStackNode(s, ctx); }),
             expanded: true, grip: true,
             menu: true,
             gripTitle: 'Drag row to reorder',
             attrs: dragAttrs(ctx.boardId, 'row') };
  }
  function buildPlaceholderNode(text) {
    return { id: null, label: text, type: 'placeholder',
             children: null, expanded: false, hasToggle: false, grip: false };
  }
  function buildBoardChildren(boardId) {
    var children = [];
    if (expandedBoardIds[boardId]) {
      var hierarchy = boardHierarchies[boardId];
      var ctx = { boardId: boardId };
      if (Array.isArray(hierarchy)) {
        children = hierarchy.length > 0
          ? hierarchy.map(function (r) { return buildRowNode(r, ctx); })
          : [buildPlaceholderNode('(empty board)')];
      } else if (hierarchy === 'error') {
        children = [buildPlaceholderNode('Failed to load board structure')];
      } else {
        children = [buildPlaceholderNode('Loading…')];
      }
    }
    return children;
  }
  function buildBoardNode(board) {
    var boardId = board.id || '';
    var isExpanded = !!expandedBoardIds[boardId];
    return {
      id: 'board:' + boardId,
      label: nodeLabel(board),
      type: 'board',
      // Always show a toggle so the user knows the board is expandable
      // before the first lazy fetch fills children.
      hasToggle: true,
      expanded: isExpanded,
      grip: false,
      menu: true,
      children: buildBoardChildren(boardId),
      attrs: {
        'data-board-id': boardId,
        'data-tree-target': 'board'
      }
    };
  }

  function selectBoardsForWorkspace(boards, remoteBoards, workspaceId) {
    var normalized = String(workspaceId || '');
    if (!normalized) return [];
    if (normalized === REMOTE_WORKSPACE_ID) return remoteBoards || [];
    return (boards || []).filter(function (board) {
      return getBoardWorkspaceIds(board).indexOf(normalized) >= 0;
    });
  }

  function refreshActiveHighlight() {
    if (!localBoardsEl) return;
    var nodes = localBoardsEl.querySelectorAll('.tree-node[data-tree-target="board"]');
    for (var i = 0; i < nodes.length; i++) {
      var bid = nodes[i].getAttribute('data-board-id') || '';
      nodes[i].classList.toggle('is-active', bid === activeBoardId);
    }
  }

  function fetchBoardHierarchy(boardId, renderMode) {
    var api = window.LexeraApi;
    if (!api || typeof api.getBoardHierarchy !== 'function') {
      boardHierarchies[boardId] = 'error';
      return;
    }
    boardHierarchies[boardId] = 'loading';
    api.getBoardHierarchy(boardId).then(function (data) {
      boardHierarchies[boardId] = (data && Array.isArray(data.rows)) ? data.rows : [];
      if (renderMode === 'patch' && (patchBoardHierarchy(boardId) || patchFromCatalog())) return;
      renderFromCatalog();
    }).catch(function () {
      boardHierarchies[boardId] = 'error';
      if (renderMode === 'patch' && (patchBoardHierarchy(boardId) || patchFromCatalog())) return;
      renderFromCatalog();
    });
  }
  function toggleBoardExpand(boardId) {
    var nowExpanded = !expandedBoardIds[boardId];
    expandedBoardIds[boardId] = nowExpanded;
    if (nowExpanded && boardHierarchies[boardId] == null) {
      fetchBoardHierarchy(boardId);
    }
    renderFromCatalog();
  }

  function renderFromCatalog() {
    var snap = latestCatalog || {};
    renderTree(snap.boards || [], snap.remoteBoards || [], selectedWorkspaceId);
    refreshActiveHighlight();
  }

  function patchOrRenderFromCatalog() {
    var snap = latestCatalog || {};
    var workspaceBoards = selectBoardsForWorkspace(
      snap.boards || [],
      snap.remoteBoards || [],
      selectedWorkspaceId
    );
    if (!workspaceBoards.length || !patchFromCatalog()) {
      renderTree(snap.boards || [], snap.remoteBoards || [], selectedWorkspaceId);
      refreshActiveHighlight();
    }
  }

  function patchFromCatalog() {
    if (!localBoardsEl || !window.TreeView || typeof window.TreeView.patch !== 'function') return false;
    var snap = latestCatalog || {};
    var workspaceBoards = selectBoardsForWorkspace(
      snap.boards || [],
      snap.remoteBoards || [],
      selectedWorkspaceId
    );
    var patched = window.TreeView.patch(
      localBoardsEl,
      workspaceBoards.map(buildBoardNode),
      { escapeHtml: escapeHtml }
    );
    if (patched) refreshActiveHighlight();
    return !!patched;
  }

  function cssAttrValue(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function getBoardEntryLastFlag(boardNode) {
    var entry = boardNode && boardNode.parentElement;
    if (!entry || !entry.parentElement) return true;
    var entries = entry.parentElement.querySelectorAll(':scope > .tree-entry');
    return entries.length === 0 || entries[entries.length - 1] === entry;
  }

  function patchBoardHierarchy(boardId) {
    if (!localBoardsEl || !boardId || !expandedBoardIds[boardId]) return false;
    if (!window.TreeView || typeof window.TreeView.patch !== 'function' ||
        typeof window.TreeView.getNodeChildrenContainer !== 'function') return false;
    var boardNode = localBoardsEl.querySelector(
      '.tree-node[data-tree-target="board"][data-board-id="' + cssAttrValue(boardId) + '"]'
    );
    var childrenEl = window.TreeView.getNodeChildrenContainer(boardNode);
    if (!childrenEl) return false;
    var patched = window.TreeView.patch(
      childrenEl,
      buildBoardChildren(boardId),
      {
        escapeHtml: escapeHtml,
        depth: 2,
        parentLastFlags: [getBoardEntryLastFlag(boardNode)]
      }
    );
    if (patched) refreshActiveHighlight();
    return !!patched;
  }

  function renderTree(boards, remoteBoards, workspaceId) {
    if (!localBoardsEl) return;
    var workspaceBoards = selectBoardsForWorkspace(boards, remoteBoards, workspaceId);
    if (localCountEl) localCountEl.textContent = '(' + workspaceBoards.length + ')';
    localBoardsEl.innerHTML = '';
    if (!workspaceBoards.length) {
      var empty = document.createElement('div');
      empty.className = 'hierarchical-empty empty';
      empty.textContent = 'none';
      localBoardsEl.appendChild(empty);
      return;
    }
    if (window.TreeView && typeof window.TreeView.render === 'function') {
      window.TreeView.render(
        localBoardsEl,
        workspaceBoards.map(buildBoardNode),
        { escapeHtml: escapeHtml }
      );
    }
  }

  // Pointer-based drag/drop. HTML5 native `draggable` does not fire
  // reliably in WKWebView / WebView2 for these element types; every
  // other Lexera drag surface (sidebar tree in `dndListeners.js`,
  // workspace shell tabs in `tabDragController.js`) uses the same
  // mousedown → distance-threshold → mousemove → mouseup pattern,
  // so we mirror it here. Broadcast contract stays the same:
  // `hierarchy-entity-drag-start` once the threshold is crossed,
  // `hierarchy-entity-drop` on a valid mouseup target.
  // Module-scope reference to the drag-block's endDrag so the
  // LexeraSubApp.init `onCustom` handlers below can clean up local
  // state when the destination webview broadcasts that it handled
  // the cross-view drop. The source's own pointerup may never fire
  // when the user releases over a sibling Tauri webview (events
  // don't cross WKWebView boundaries) — without this echo the
  // `is-drop-target` outline + `pendingDrag` / `activeDrag` state
  // would persist past the drop.
  var _hierarchyEndDrag = null;
  // Cross-view receive-side handler — the kanban view's
  // `tryExternalNativeHover/Drop` dispatches `external-dnd-hover` /
  // `external-dnd-drop` to whichever webview the cursor lands on.
  // Without a receiver here, kanban→workspace drag is a no-op
  // (user report 2026-05-10 "i cant drag from the kanban to the
  // workspace!"). Wired in the drag-bound block below; called from
  // `LexeraSubApp.init`'s `onCustom` so the events go through the
  // same scoped wv.listen path the rest of the sub-app uses.
  var _hierarchyOnExternalDnd = null;
  // Stage 17b cross-view RECEIVE-side per-webview pointer tracker.
  // Mouse events DO NOT cross Tauri WKWebView boundaries, so when a
  // sibling webview (kanban or another workspace) broadcasts
  // `hierarchy-entity-drag-start`, we install document-level pointer
  // listeners HERE that fire when the cursor enters this webview's
  // bounds. Mirror of the per-webview tracker in
  // embeddedBoardBridge.js. Self-skips when the broadcast came from
  // THIS webview (sourceWebviewLabel === own label) so the workspace
  // tree's own drag doesn't double-track.
  var _hierarchyArmCrossDragTracker = null;
  var _hierarchyTeardownCrossDragTracker = null;

  if (localBoardsEl && !localBoardsEl.__hierarchyDragBound) {
    // Container relations:
    //   card → column, column → stack, stack → row, row → board
    var ABSORB_KINDS = { card: 'column', column: 'stack', stack: 'row', row: 'board' };
    var DRAG_THRESHOLD_PX = 5;
    var pendingDrag = null;
    var activeDrag = null;
    var activeDropTargetEl = null;
    // Pointer capture state — set when pointerdown captures the source
    // tree-node so pointermove/pointerup keep firing even when the
    // cursor crosses into another Tauri webview (the failure mode for
    // workspace → kanban cross-view drag with bare mouse events).
    var capturedPointerId = -1;
    var capturedSourceEl = null;
    var releasePointerCaptureSafely = function () {
      if (capturedSourceEl && capturedPointerId !== -1 &&
          typeof capturedSourceEl.releasePointerCapture === 'function') {
        try { capturedSourceEl.releasePointerCapture(capturedPointerId); } catch (_) { /* ignore */ }
      }
      capturedSourceEl = null;
      capturedPointerId = -1;
    };

    var readEntityIdsFromNode = function (node, kind) {
      var ids = [];
      function add(value) {
        var text = String(value == null ? '' : value).trim();
        if (text && ids.indexOf(text) === -1) ids.push(text);
      }
      add(node && node.getAttribute('data-tree-id'));
      if (kind === 'card') {
        add(node && node.getAttribute('data-card-kid'));
        add(node && node.getAttribute('data-card-id'));
      }
      return ids;
    };
    var readSourceFromNode = function (el) {
      var src = el && el.closest ? el.closest('.tree-node[data-drag-kind]') : null;
      if (!src || !localBoardsEl.contains(src)) return null;
      var kind = src.getAttribute('data-drag-kind') || '';
      return {
        boardId: src.getAttribute('data-drag-board-id') || '',
        kind: kind,
        entityId: src.getAttribute('data-tree-id') || '',
        entityIds: readEntityIdsFromNode(src, kind)
      };
    };
    var readDropTargetFromPoint = function (clientX, clientY, dragSource) {
      var hit = document.elementFromPoint(clientX, clientY);
      // Drag-kind nodes are canonical drop targets; board nodes (the
      // TreeView root for each kanban) are also valid targets, but
      // only for row → board absorbs.
      var tgt = hit && hit.closest
        ? hit.closest('.tree-node[data-drag-kind], .tree-node[data-tree-target="board"]')
        : null;
      if (!tgt || !localBoardsEl.contains(tgt)) return null;
      var info;
      if (tgt.getAttribute('data-drag-kind')) {
        var targetKind = tgt.getAttribute('data-drag-kind') || '';
        info = {
          boardId: tgt.getAttribute('data-drag-board-id') || '',
          kind: targetKind,
          entityId: tgt.getAttribute('data-tree-id') || '',
          entityIds: readEntityIdsFromNode(tgt, targetKind)
        };
      } else if (tgt.getAttribute('data-tree-target') === 'board') {
        var bid = tgt.getAttribute('data-board-id') || '';
        info = { boardId: bid, kind: 'board', entityId: bid };
      } else {
        return null;
      }
      if (!dragSource) return null;
      if (info.entityId === dragSource.entityId) return null;
      var sameKind = info.kind === dragSource.kind;
      if (!sameKind) {
        var absorbInto = ABSORB_KINDS[dragSource.kind];
        if (absorbInto !== info.kind) return null;
        // User contract 2026-05-09: "if dropped on a parent it should
        // highlight it and append as last item". Allow absorb on ANY
        // matching parent kind (no longer gated on "empty container");
        // applyEntityAbsorb appends to the end of the children array
        // regardless of how many siblings already exist.
      }
      if (sameKind) {
        var rect = tgt.getBoundingClientRect();
        info.position = (rect.height > 0 && clientY >= rect.top + rect.height / 2)
          ? 'after' : 'before';
      }
      return { node: tgt, info: info };
    };
    var clearDropTargetEl = function () {
      if (activeDropTargetEl) {
        activeDropTargetEl.classList.remove('is-drop-target');
        activeDropTargetEl.classList.remove('is-drop-before');
        activeDropTargetEl.classList.remove('is-drop-after');
        activeDropTargetEl.classList.remove('is-drop-absorb');
        activeDropTargetEl = null;
      }
    };
    var endDrag = function () {
      clearDropTargetEl();
      releasePointerCaptureSafely();
      pendingDrag = null;
      activeDrag = null;
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
    };
    // Expose to the LexeraSubApp.init `onCustom` handlers below — see
    // the `_hierarchyEndDrag` declaration just above this block.
    _hierarchyEndDrag = endDrag;

    var getOwnWebviewLabel = function () {
      try {
        var wv = window.LexeraSubApp && typeof window.LexeraSubApp.getCurrentWebview === 'function'
          ? window.LexeraSubApp.getCurrentWebview() : null;
        return (wv && wv.label) || '';
      } catch (_) { return ''; }
    };

    // ── Cross-view DROP receiver (Stage 14 + 17b, consolidated) ────
    // Wire the shared `LexeraTreeCrossViewDrop` module — it owns the
    // payload-shape mapper, destination indicator paint logic, and
    // per-webview pointer tracker. workspaces.js wires the same
    // module with its own readDropTargetFromPoint closure.
    if (window.LexeraTreeCrossViewDrop &&
        typeof window.LexeraTreeCrossViewDrop.install === 'function') {
      var crossViewDropReceiver = window.LexeraTreeCrossViewDrop.install({
        readDropTargetFromPoint: readDropTargetFromPoint,
        getOwnWebviewLabel: getOwnWebviewLabel
      });
      _hierarchyOnExternalDnd = crossViewDropReceiver.onExternalDnd;
      _hierarchyArmCrossDragTracker = crossViewDropReceiver.armCrossDragTracker;
      _hierarchyTeardownCrossDragTracker = crossViewDropReceiver.teardownCrossDragTracker;
    }

    // Same `[xview-dnd]` instrumentation as workspaces.js. First-fire
    // flag logs once per drag so the in-app Log panel shows that the
    // source IS routing AND the resolved sourceLabel is non-empty.
    // Drag-move fires ~60Hz; we log only the first call per drag.
    var _xviewSourceLogged = false;
    // Throttle drag-move routing to one per animation frame.
    // Without this, every pointermove (~60Hz under pointer capture)
    // would fire an IPC route to the destination hover handler.
    // User report 2026-05-10 "extremely slow when dragging from
    // workspace to kanban". rAF coalesces to 1/frame and adapts to
    // system load. Pointer capture means pointermove fires AT the
    // source even after cursor leaves; we just always remember the
    // most recent coords and flush once per frame.
    var _xviewMoveRaf = 0;
    var _xviewLastClientX = null;
    var _xviewLastClientY = null;
    var _xviewLastScreenX = null;
    var _xviewLastScreenY = null;
    var getExternalDndType = function (source) {
      var kindToType = { row: 'tree-row', stack: 'tree-stack', column: 'tree-column', card: 'tree-card' };
      return kindToType[source && source.kind] || ('tree-' + (source && source.kind));
    };
    var routeExternalDndAtPointer = function (eventName, source, sourceWebviewLabel, clientX, clientY, screenX, screenY) {
      var hasSourcePoint = typeof clientX === 'number' && typeof clientY === 'number';
      var hasScreenPoint = typeof screenX === 'number' && typeof screenY === 'number';
      if (!source || (!hasSourcePoint && !hasScreenPoint)) return null;
      if (!window.LexeraSubApp || typeof window.LexeraSubApp.invoke !== 'function') return null;
      return window.LexeraSubApp.invoke('multiview_route_external_dnd', {
        request: {
          event: eventName,
          sourceWebviewLabel: sourceWebviewLabel || null,
          sourceClientX: hasSourcePoint ? clientX : null,
          sourceClientY: hasSourcePoint ? clientY : null,
          screenX: hasScreenPoint ? screenX : null,
          screenY: hasScreenPoint ? screenY : null,
          source: source,
          dndType: getExternalDndType(source)
        }
      });
    };
    var _flushCrossViewMove = function () {
      _xviewMoveRaf = 0;
      if (!activeDrag) return;
      if (!window.LexeraSubApp || typeof window.LexeraSubApp.invoke !== 'function') return;
      var label = getOwnWebviewLabel();
      if (!_xviewSourceLogged && typeof window.lexeraLog === 'function') {
        try {
          window.lexeraLog('debug', '[xview-dnd] source.route { view: "hierarchy", sourceLabel: "' +
            String(label) + '", hasLabel: ' + (!!label) + ' }');
        } catch (_) {}
        _xviewSourceLogged = true;
      }
      var promise = routeExternalDndAtPointer(
        'external-dnd-hover',
        activeDrag.source,
        label,
        _xviewLastClientX,
        _xviewLastClientY,
        _xviewLastScreenX,
        _xviewLastScreenY
      );
      if (promise && typeof promise.catch === 'function') {
        promise.catch(function (err) {
          if (typeof window.lexeraLog === 'function') {
            try {
              window.lexeraLog('warn', '[xview-dnd] source.route.failed view=hierarchy err=' +
                ((err && err.message) ? err.message : String(err)));
            } catch (_) {}
          }
        });
      }
    };
    var broadcastCrossViewMove = function (clientX, clientY, screenX, screenY) {
      _xviewLastClientX = typeof clientX === 'number' ? clientX : null;
      _xviewLastClientY = typeof clientY === 'number' ? clientY : null;
      _xviewLastScreenX = typeof screenX === 'number' ? screenX : null;
      _xviewLastScreenY = typeof screenY === 'number' ? screenY : null;
      if (_xviewMoveRaf) return; // already scheduled — coalesce
      if (typeof requestAnimationFrame === 'function') {
        _xviewMoveRaf = requestAnimationFrame(_flushCrossViewMove);
      } else {
        _flushCrossViewMove();
      }
    };

    var onMove = function (e) {
      if (!pendingDrag) return;
      if (!activeDrag) {
        var dx = e.clientX - pendingDrag.startX;
        var dy = e.clientY - pendingDrag.startY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        activeDrag = { source: pendingDrag.source };
        if (window.LexeraSubApp && typeof window.LexeraSubApp.broadcast === 'function') {
          // Include sourceWebviewLabel so destination trackers can
          // self-skip when the broadcast came from THIS webview
          // (Stage 17b — workspace tree subapps now also arm
          // per-webview pointer trackers on drag-start, mirroring
          // embeddedBoardBridge; without the label, a workspace
          // dragging within itself would arm against its own drag).
          var dragStartPayload = Object.assign({}, activeDrag.source, {
            sourceWebviewLabel: getOwnWebviewLabel()
          });
          window.LexeraSubApp.broadcast('hierarchy-entity-drag-start', dragStartPayload);
        }
      }
      var match = readDropTargetFromPoint(e.clientX, e.clientY, activeDrag.source);
      if (activeDropTargetEl !== (match && match.node)) {
        clearDropTargetEl();
        if (match) {
          match.node.classList.add('is-drop-target');
          activeDropTargetEl = match.node;
        }
      }
      // Same-kind reorder uses match.info.position ('before' | 'after')
      // — surface that as a class on the target so the user sees which
      // side the dragged sibling will land on. Cross-kind absorbs
      // (no position) get `.is-drop-absorb` so the parent itself
      // highlights — append-as-last semantics per user contract
      // 2026-05-09 ("if dropped on a parent it should highlight it
      // and append as last item").
      if (activeDropTargetEl) {
        activeDropTargetEl.classList.remove('is-drop-before');
        activeDropTargetEl.classList.remove('is-drop-after');
        activeDropTargetEl.classList.remove('is-drop-absorb');
        if (match && match.info && match.info.position === 'before') {
          activeDropTargetEl.classList.add('is-drop-before');
        } else if (match && match.info && match.info.position === 'after') {
          activeDropTargetEl.classList.add('is-drop-after');
        } else if (match && match.info) {
          // Cross-kind absorb — no position, the whole parent
          // highlights to mean "append into me".
          activeDropTargetEl.classList.add('is-drop-absorb');
        }
      }
      // No local target: cursor may be over another webview. Route
      // the source-client cursor position directly to the sibling
      // webview under it; screen coords remain the cross-window
      // fallback. Pointer capture (set on pointerdown) keeps these
      // events flowing even when the cursor has crossed into a
      // sibling Tauri webview.
      if (!match) broadcastCrossViewMove(e.clientX, e.clientY, e.screenX, e.screenY);
    };
    var onUp = function (e) {
      if (!activeDrag) {
        // Below threshold — let the click handler take care of the
        // navigate / toggle path.
        endDrag();
        return;
      }
      var match = readDropTargetFromPoint(e.clientX, e.clientY, activeDrag.source);
      var src = activeDrag.source;
      var clientX = e.clientX, clientY = e.clientY;
      clearDropTargetEl();
      releasePointerCaptureSafely();
      var hadLocalDrop = !!match;
      var dropPayload = match ? { source: src, target: match.info } : null;
      pendingDrag = null;
      activeDrag = null;
      _xviewSourceLogged = false; // reset for next drag session
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      if (window.LexeraSubApp && typeof window.LexeraSubApp.broadcast === 'function') {
        if (hadLocalDrop) {
          // Local within-panel reorder/absorb. Logged so the user can
          // verify in the Log panel that the drop fired.
          if (typeof window.lexeraLog === 'function') {
            try {
              window.lexeraLog('debug', '[xview-dnd] source.local-drop { view: "hierarchy", srcKind: "' +
                (src && src.kind || '') + '", tgtKind: "' + (match && match.info && match.info.kind || '') +
                '", srcBoard: "' + (src && src.boardId || '') +
                '", tgtBoard: "' + (match && match.info && match.info.boardId || '') + '" }');
            } catch (_) {}
          }
          var localPromise = window.LexeraSubApp.broadcast('hierarchy-entity-drop', dropPayload);
          if (localPromise && typeof localPromise.catch === 'function') {
            localPromise.catch(function (err) {
              if (typeof window.lexeraLog === 'function') {
                try {
                  window.lexeraLog('warn', '[xview-dnd] source.local-drop.failed view=hierarchy err=' +
                    ((err && err.message) ? err.message : String(err)));
                } catch (_) {}
              }
            });
          }
        } else {
          // Cursor was outside this webview. Dispatch this as
          // `external-dnd-drop` to the single webview under the
          // pointer.
          var endLabel = getOwnWebviewLabel();
          if (typeof window.lexeraLog === 'function') {
            try {
              window.lexeraLog('debug', '[xview-dnd] source.drag-end-external { view: "hierarchy", sourceLabel: "' +
                String(endLabel) + '", x: ' + clientX + ', y: ' + clientY + ' }');
            } catch (_) {}
          }
          var endPromise = routeExternalDndAtPointer(
            'external-dnd-drop',
            src,
            endLabel,
            clientX,
            clientY,
            typeof e.screenX === 'number' ? e.screenX : null,
            typeof e.screenY === 'number' ? e.screenY : null
          );
          if (endPromise && typeof endPromise.catch === 'function') {
            endPromise.catch(function (err) {
              if (typeof window.lexeraLog === 'function') {
                try {
                  window.lexeraLog('warn', '[xview-dnd] source.drag-end-external.failed view=hierarchy err=' +
                    ((err && err.message) ? err.message : String(err)));
                } catch (_) {}
              }
            });
          }
        }
      }
    };
    localBoardsEl.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      // Clicks on the toggle stay click-driven so fold/unfold isn't
      // hijacked by a tiny drag.
      if (e.target && e.target.closest && e.target.closest('.tree-toggle')) return;
      var source = readSourceFromNode(e.target);
      if (!source) return;
      // Pointer capture on the source tree-node so pointermove/pointerup
      // keep firing on the SOURCE webview even after the user drags
      // the cursor into a sibling Tauri webview (the kanban view).
      // Without this, mouse events stop at the webview boundary and
      // the direct external-DnD route never fires for cross-webview
      // drops. Mirrors the kanban tab-drag pattern in tabDragController.js.
      var srcEl = e.target.closest && e.target.closest('.tree-node[data-drag-kind]');
      if (srcEl && typeof srcEl.setPointerCapture === 'function' && typeof e.pointerId === 'number') {
        try {
          srcEl.setPointerCapture(e.pointerId);
          capturedSourceEl = srcEl;
          capturedPointerId = e.pointerId;
        } catch (_) { /* not all environments expose pointer capture */ }
      }
      pendingDrag = { startX: e.clientX, startY: e.clientY, source: source };
      activeDrag = null;
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
    });
    window.addEventListener('blur', endDrag);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) endDrag();
    });
    localBoardsEl.__hierarchyDragBound = true;
  }

  // Right-click on a tree-node is intentionally not assigned here —
  // suppress the browser's default context menu so it doesn't pop up
  // over the tree.
  if (localBoardsEl && !localBoardsEl.__hierarchyContextMenuBound) {
    localBoardsEl.addEventListener('contextmenu', function (e) {
      if (e.target && e.target.closest && e.target.closest('.tree-node[data-drag-kind]')) {
        e.preventDefault();
      }
    });
    localBoardsEl.__hierarchyContextMenuBound = true;
  }

  // Double-click on a row / stack / column / card label opens an
  // inline editor. Enter / blur commits + broadcasts
  // `hierarchy-entity-rename`; Escape cancels. Boards (TreeView roots
  // without `data-drag-kind`) stay non-editable here — renaming a
  // board file is a heavier operation that belongs in the in-board
  // surface.
  function startInlineRename(nodeEl) {
    if (!nodeEl) return;
    if (nodeEl.querySelector('.tree-rename-input')) return;
    var labelEl = nodeEl.querySelector('.tree-label');
    if (!labelEl) return;
    var source = {
      boardId: nodeEl.getAttribute('data-drag-board-id') || '',
      kind: nodeEl.getAttribute('data-drag-kind') || '',
      entityId: nodeEl.getAttribute('data-tree-id') || ''
    };
    if (!source.boardId || !source.kind || !source.entityId) return;
    var originalText = labelEl.textContent || '';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'tree-rename-input';
    input.value = originalText;
    labelEl.style.display = 'none';
    labelEl.parentNode.insertBefore(input, labelEl.nextSibling);
    input.focus();
    input.select();
    var done = false;
    function finish(commit) {
      if (done) return;
      done = true;
      var next = String(input.value || '').trim();
      if (input.parentNode) input.parentNode.removeChild(input);
      labelEl.style.display = '';
      if (commit && next && next !== originalText) {
        if (window.LexeraSubApp && typeof window.LexeraSubApp.broadcast === 'function') {
          window.LexeraSubApp.broadcast('hierarchy-entity-rename', {
            source: source, newTitle: next
          });
        }
      }
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
  }
  if (localBoardsEl && !localBoardsEl.__hierarchyDblClickBound) {
    localBoardsEl.addEventListener('dblclick', function (e) {
      var node = e.target && e.target.closest
        ? e.target.closest('.tree-node[data-drag-kind]')
        : null;
      if (!node) return;
      if (e.target.closest('.tree-toggle')) return;
      if (e.target.closest('.tree-menu-btn')) return;
      if (e.target.closest('.tree-grip')) return;
      e.preventDefault();
      startInlineRename(node);
    });
    localBoardsEl.__hierarchyDblClickBound = true;
  }

  // Single delegated click listener — keeps wiring simple even though
  // the tree is rebuilt on every state change.
  if (localBoardsEl && !localBoardsEl.__hierarchyClickBound) {
    localBoardsEl.addEventListener('click', function (e) {
      var toggle = e.target.closest && e.target.closest('.tree-toggle');
      var node = e.target.closest && e.target.closest('.tree-node');
      if (!node || !localBoardsEl.contains(node)) return;
      var target = node.getAttribute('data-tree-target') || '';
      var menuButton = e.target.closest && e.target.closest('.tree-menu-btn');
      if (menuButton) {
        e.preventDefault();
        e.stopPropagation();
        if (target === 'board') {
          showBoardActionMenu(node.getAttribute('data-board-id') || '', menuButton);
        } else if (node.getAttribute('data-drag-kind')) {
          // User contract 2026-05-11: every workspace tree node
          // (rows / stacks / columns / cards) gets a burger menu,
          // not just boards. Mirror of legacy sidebarTree.js.
          showEntityActionMenu(node, menuButton);
        }
        return;
      }
      if (e.target.closest && e.target.closest('.tree-grip')) return;
      if (toggle) {
        // Alt+click on a toggle → fold/unfold all descendants while
        // leaving the clicked node's own expand state unchanged.
        // Mirrors the kanban sidebar pattern in boardList.js. For
        // boards we only take this branch when the board's children
        // container is currently `.expanded` AND has at least one
        // descendant `.tree-children` — otherwise (collapsed board, or
        // expanded board whose children haven't fetched yet) we fall
        // through to the regular toggleBoardExpand path so alt+click
        // on a collapsed board still expands it.
        if (e.altKey && window.TreeView &&
            typeof window.TreeView.getNodeChildrenContainer === 'function' &&
            typeof window.TreeView.setDescendantsExpanded === 'function') {
          var altChildren = window.TreeView.getNodeChildrenContainer(node);
          if (altChildren) {
            var altDescendants = altChildren.querySelectorAll('.tree-children');
            if (altDescendants.length > 0 && altChildren.classList.contains('expanded')) {
              var altAllCollapsed = true;
              for (var ai = 0; ai < altDescendants.length; ai++) {
                if (altDescendants[ai].classList.contains('expanded')) { altAllCollapsed = false; break; }
              }
              window.TreeView.setDescendantsExpanded(altChildren, altAllCollapsed);
              return;
            }
          }
        }
        // Toggle path — never navigates open the board.
        if (target === 'board') {
          // Boards lazy-fetch their hierarchy on first expand and the
          // tree is rebuilt from scratch on every state change, so we
          // route through `toggleBoardExpand` (which mutates state)
          // rather than `TreeView.toggleNode` (which only flips DOM).
          var bid = node.getAttribute('data-board-id') || '';
          if (bid) toggleBoardExpand(bid);
          return;
        }
        // Rows / stacks / columns / cards already have their full
        // children rendered when the board is expanded — toggle them
        // purely in the DOM via TreeView's helper, same as the
        // dashboard / files panel / main board sidebar.
        if (window.TreeView && typeof window.TreeView.toggleNode === 'function') {
          window.TreeView.toggleNode(node);
        }
        return;
      }
      // Whole-row click on a board → navigate-open.
      if (target === 'board') {
        var rowBid = node.getAttribute('data-board-id') || '';
        if (rowBid) LexeraSubApp.navigate({ type: 'open-board', boardId: rowBid });
        return;
      }
      // User contract 2026-05-11: clicking a row / stack / column /
      // card tree-node focuses that entity in the kanban view AND
      // opens the kanban if not already open. Clicks on the burger
      // menu (`.tree-menu-btn`) and drag icon (`.tree-grip`) are
      // intentionally NOT routed here so they keep their own behavior.
      if (e.target.closest && (e.target.closest('.tree-menu-btn') || e.target.closest('.tree-grip'))) {
        return;
      }
      var dragKind = node.getAttribute('data-drag-kind') || '';
      if (!dragKind) return;
      var focusBoardId = node.getAttribute('data-drag-board-id') || '';
      if (!focusBoardId) return;
      // The workspace tree only carries TWO ids per node:
      //   data-tree-id      — entity id (card.kid || card.id || row.id / etc)
      //   data-drag-board-id
      // (Verified by the drag-source `readSourceFromNode` which reads
      // exactly these two attributes — hierarchy.js:339-346.) The
      // per-kind `data-row-id` / `data-stack-id` / `data-column-id` /
      // `data-card-id` attributes the previous version of this handler
      // tried to read don't exist on workspace tree nodes — so every
      // id field landed as null and findBoardEntityElement had nothing
      // to query. User log 2026-05-11 confirmed all-null payload.
      // Route `data-tree-id` into the right field by `data-drag-kind`.
      var entityId = node.getAttribute('data-tree-id') || '';
      if (!entityId) return;
      var focusTarget = { boardId: focusBoardId };
      if (dragKind === 'card') focusTarget.cardId = entityId;
      else if (dragKind === 'column') focusTarget.columnId = entityId;
      else if (dragKind === 'stack') focusTarget.stackId = entityId;
      else if (dragKind === 'row') focusTarget.rowId = entityId;
      else return;
      // Diagnostic — user-reported "click doesn't focus" is impossible
      // to debug without runtime evidence that the click actually
      // produced a focus-target navigate call. Pair with the
      // corresponding receive-side logs in navigationBridge and
      // orderHelpers to trace the whole chain.
      if (typeof window.lexeraLog === 'function') {
        try {
          window.lexeraLog('debug', '[focus-trace] hierarchy.click.navigate ' +
            JSON.stringify({ kind: dragKind, boardId: focusBoardId, cardId: focusTarget.cardId, columnId: focusTarget.columnId, stackId: focusTarget.stackId, rowId: focusTarget.rowId }));
        } catch (_) { /* non-fatal */ }
      }
      LexeraSubApp.navigate({
        type: 'focus-hierarchy-target',
        target: focusTarget
      });
    });
    localBoardsEl.__hierarchyClickBound = true;
  }

  // After a drag-drop reorder, the shell-side bridge persists the new
  // board state and broadcasts `hierarchy-board-changed` so sub-apps
  // can drop their cached hierarchy. Without this, the user would see
  // no visible reorder because we'd re-render from stale rows.
  function invalidateBoardHierarchy(boardId) {
    if (!boardId) return;
    delete boardHierarchies[boardId];
    if (expandedBoardIds[boardId]) {
      // Re-fetch immediately so the user sees the updated structure
      // without having to collapse and re-expand the board.
      fetchBoardHierarchy(boardId, 'patch');
    }
  }

  LexeraSubApp.init({
    onCustom: {
      'hierarchy-board-changed': function (payload) {
        invalidateBoardHierarchy((payload && payload.boardId) || '');
      },
      // Echo emitted by the destination webview (embeddedBoardBridge.js)
      // when it has handled a cross-view drop. The source's own
      // pointerup never fires for cross-WKWebView drops, so without
      // this echo the dashed `.is-drop-target` outline + drag state
      // would persist past the release.
      'cross-view-drag-handled': function () {
        if (typeof _hierarchyEndDrag === 'function') _hierarchyEndDrag();
        // Stage 17b: also tear down our destination-side tracker
        // (in case THIS webview is a sibling that armed a tracker
        // but didn't end up handling the drop).
        if (typeof _hierarchyTeardownCrossDragTracker === 'function') {
          _hierarchyTeardownCrossDragTracker();
        }
      },
      // Stage 17b: arm the per-webview pointer tracker when ANY
      // sibling webview (kanban or another workspace) starts a drag.
      // The tracker self-skips when payload.sourceWebviewLabel ===
      // own label so this webview's own drag doesn't double-track.
      'hierarchy-entity-drag-start': function (payload) {
        if (typeof _hierarchyArmCrossDragTracker === 'function') {
          _hierarchyArmCrossDragTracker(payload || null);
        }
      },
      // Cross-view receive (kanban → workspace). Subscribing ensures
      // wv.listen is registered for these events so multiview_emit_to
      // delivers them; the closures route into the destination handler
      // wired up inside the drag-bound block above.
      'external-dnd-hover': function (payload) {
        if (typeof _hierarchyOnExternalDnd === 'function') _hierarchyOnExternalDnd('hover', payload);
      },
      'external-dnd-drop': function (payload) {
        if (typeof _hierarchyOnExternalDnd === 'function') _hierarchyOnExternalDnd('drop', payload);
      },
      'external-dnd-clear': function () {
        if (typeof _hierarchyOnExternalDnd === 'function') _hierarchyOnExternalDnd('clear', null);
      }
    },
    onCatalog: function (snap) {
      latestCatalog = snap || null;
      var previousWorkspaceId = selectedWorkspaceId;
      var ws = resolveWorkspaceFromSnapshot(snap);
      if (ws && ws.name) {
        titleEl.textContent = ws.name;
        selectedWorkspaceId = ws.id || null;
      } else {
        titleEl.textContent = 'Workspace';
        selectedWorkspaceId = null;
      }
      viewModeEl.textContent = snap && snap.workspaceViewMode === 'manual' ? 'manual view' : 'follow active board';
      if (previousWorkspaceId === selectedWorkspaceId) {
        patchOrRenderFromCatalog();
      } else {
        renderFromCatalog();
      }
      // Status pill removed from the panel chrome — keep the assignment
      // null-safe so onCatalog still runs cleanly, and the test API can
      // still surface the most-recent label when a fixture mounts one.
      if (statusEl) statusEl.textContent = 'connected';
    },
    onActiveBoard: function (boardId) {
      activeBoardId = boardId;
      refreshActiveHighlight();
    },
    onError: function (err) {
      if (statusEl) statusEl.textContent = String(err);
    }
  });

  // ── Test API ──────────────────────────────────────────────────────
  // User-interaction surface for vitest + autoRun integration tests.
  // Drives the SAME DOM events a real user would.
  function dispatchClick(node) {
    if (!node) return false;
    var ev = typeof MouseEvent === 'function'
      ? new MouseEvent('click', { bubbles: true, cancelable: true })
      : document.createEvent('MouseEvent');
    if (ev.initMouseEvent) {
      ev.initMouseEvent('click', true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);
    }
    node.dispatchEvent(ev);
    return true;
  }
  function findBoardNode(boardId) {
    if (!localBoardsEl) return null;
    var sel = '.tree-node[data-tree-target="board"][data-board-id="' + String(boardId || '').replace(/"/g, '\\"') + '"]';
    return localBoardsEl.querySelector(sel);
  }
  function collectBoardItems() {
    if (!localBoardsEl) return [];
    var nodes = localBoardsEl.querySelectorAll('.tree-node[data-tree-target="board"]');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var labelEl = nodes[i].querySelector('.tree-label');
      out.push({
        id: nodes[i].getAttribute('data-board-id') || '',
        label: labelEl ? labelEl.textContent : '',
        active: nodes[i].classList.contains('is-active'),
        expanded: nodes[i].getAttribute('aria-expanded') === 'true'
      });
    }
    return out;
  }
  window.LexeraHierarchyTestApi = {
    collectState: function () {
      // Boards are the top-level tree roots — no workspace node anymore.
      // The header (#title) shows the workspace name; tests can read
      // `state.title` for that. `groups` is a single synthetic group
      // wrapping the current workspace's boards so existing test calls
      // continue to work.
      var boards = collectBoardItems();
      var groups = selectedWorkspaceId
        ? [{
            id: selectedWorkspaceId,
            name: titleEl ? titleEl.textContent : '',
            expanded: true,
            active: true,
            boards: boards
          }]
        : [];
      return {
        status: statusEl ? statusEl.textContent : '',
        title: titleEl ? titleEl.textContent : '',
        viewMode: viewModeEl ? viewModeEl.textContent : '',
        activeBoardId: activeBoardId,
        selectedWorkspaceId: selectedWorkspaceId,
        groups: groups,
        remote: [],
        workspaces: []
      };
    },
    clickBoard: function (boardId, scope) {
      void scope;
      // Click the board's tree-label — same DOM path a real click takes.
      var node = findBoardNode(boardId);
      if (!node) return false;
      var label = node.querySelector('.tree-label') || node;
      return dispatchClick(label);
    },
    clickWorkspace: function (workspaceId) {
      void workspaceId;
      return false;
    },
    clickWorkspaceGroupHeader: function (groupId) {
      // The workspace lives in the panel header, not inside the tree —
      // there's nothing to toggle here. Kept on the API surface so
      // callers don't need a feature check.
      void groupId;
      return false;
    }
  };
})();
