// Workspaces sub-app — uses LexeraSubApp shared runtime.
//
// Shows the current workspace and its boards as a single TreeView
// (treeView.js) — same component the dashboard, files panel, and
// main board sidebar use. Boards are the top-level tree roots; each
// board lazily fetches its own row/stack/column/card hierarchy on
// expand. The synthetic Remote Boards workspace flows through the
// same path with `remoteBoards` as the source list.

(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function resolveBoardLabel(b) {
    return window.LexeraTitleHelpers.resolveBoardLabel(b);
  }

  var statusEl = document.getElementById('status');
  var localBoardsEl = document.getElementById('local-boards');
  var currentWorkspaceEl = document.getElementById('current-workspace');
  var localCountEl = document.getElementById('local-count');

  var activeBoardId = null;
  var currentWorkspace = null;
  var REMOTE_WORKSPACE_ID = '__remote_boards__';
  var REMOTE_WORKSPACE_NAME = 'Remote Boards';

  // Per-board fold state + hierarchy cache. `boardHierarchies[id]` is
  // one of: undefined | 'loading' | 'error' | KanbanRow[].
  var expandedBoardIds = {};
  var boardHierarchies = {};
  var latestBoardsRendered = [];

  function findRenderedBoard(boardId) {
    for (var i = 0; i < latestBoardsRendered.length; i++) {
      if (String(latestBoardsRendered[i] && latestBoardsRendered[i].id || '') === String(boardId || '')) {
        return latestBoardsRendered[i];
      }
    }
    return null;
  }

  function closeBoardActionMenus() {
    var menus = document.querySelectorAll('.tree-board-action-menu');
    for (var i = 0; i < menus.length; i++) menus[i].remove();
  }

  function runBoardAction(boardId, action) {
    var board = findRenderedBoard(boardId);
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
    var board = findRenderedBoard(boardId);
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

  // User contract 2026-05-11: same items as the kanban view's burger
  // menu plus a "Focus <Kind>" item at the top. See hierarchy.js for
  // the full architectural note — both sub-apps render the identical
  // menu and broadcast the same `hierarchy-entity-menu-action` for
  // execution in the kanban frame.
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
      // User report 2026-05-13: same kid can appear under multiple
      // columns when an include file is referenced from > 1 column on
      // the same board. Harvest ancestor column / stack / row ids from
      // the tree DOM so the kanban-side `findBoardEntityElement` can
      // scope its lookup. Mirror of the same fix in hierarchy.js.
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
    // User report 2026-05-14 with trace `columnId:null`: the focus
    // precursor for non-focus menu actions (Edit, Park, Archive,
    // Delete, etc.) was sending bare `{boardId, cardId, columnId:null,
    // ...}` so the kanban-side scope-by-ancestor lookup had nothing to
    // scope by → board-wide first match → wrong card copy. Harvest
    // ancestor ids/title the same way the focus action does.
    var precursorTarget = { boardId: boardId };
    if (dragKind === 'card')        precursorTarget.cardId   = entityId;
    else if (dragKind === 'column') precursorTarget.columnId = entityId;
    else if (dragKind === 'stack')  precursorTarget.stackId  = entityId;
    else if (dragKind === 'row')    precursorTarget.rowId    = entityId;
    var precursorAncestor = node && node.parentElement;
    while (precursorAncestor) {
      if (precursorAncestor.classList && precursorAncestor.classList.contains('tree-entry')) {
        var precAncNode = precursorAncestor.querySelector(':scope > .tree-node[data-tree-id]');
        if (precAncNode) {
          var precAncKind = precAncNode.getAttribute('data-drag-kind') || '';
          var precAncId   = precAncNode.getAttribute('data-tree-id')  || '';
          if (precAncKind && precAncId) {
            if (precAncKind === 'column' && !precursorTarget.columnId) {
              precursorTarget.columnId = precAncId;
              var precAncLabel = precAncNode.querySelector(':scope > .tree-label');
              if (precAncLabel) precursorTarget.columnTitle = (precAncLabel.textContent || '').trim();
            } else if (precAncKind === 'stack' && !precursorTarget.stackId) {
              precursorTarget.stackId = precAncId;
            } else if (precAncKind === 'row' && !precursorTarget.rowId) {
              precursorTarget.rowId = precAncId;
            }
          }
        }
      }
      precursorAncestor = precursorAncestor.parentElement;
    }
    LexeraSubApp.navigate({ type: 'focus-hierarchy-target', target: precursorTarget });
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

  function refreshActiveHighlight() {
    if (!localBoardsEl) return;
    var nodes = localBoardsEl.querySelectorAll('.tree-node[data-tree-target="board"]');
    for (var i = 0; i < nodes.length; i++) {
      var bid = nodes[i].getAttribute('data-board-id') || '';
      nodes[i].classList.toggle('is-active', bid === activeBoardId);
    }
  }

  // ── TreeView node builders ──────────────────────────────────────
  function nodeLabel(item) {
    var label = window.LexeraTitleHelpers.resolveBoardLabel(item);
    if (label === 'Untitled') label = item.title || item.name || '';
    return label || '(no title)';
  }
  // Phase 2a: drag grip + Phase 2b-1: native `draggable="true"` on
  // every entity inside an expanded board so the browser fires
  // dragstart events. Drop wiring is Phase 2b-2.
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
    // Prefer the persistent `card.kid` (8-char hex) over `card.id`
    // (Loro CRDT container id) so the data-tree-id surfaced in the
    // tree DOM survives a `getBoardColumns` reload that re-instantiates
    // Loro with different container ids. The shell-side
    // hierarchyDragBridge.locateEntity matches against EITHER form
    // (Stage 7 — commit 9ec8cb82), so the kid path stays stable even
    // when a sibling kanban view's DOM still uses card.id-form
    // attributes. Reported 2026-05-10.
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
      label: resolveBoardLabel(board),
      type: 'board',
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

  function fetchBoardHierarchy(boardId, renderMode) {
    var api = window.LexeraApi;
    if (!api || typeof api.getBoardHierarchy !== 'function') {
      boardHierarchies[boardId] = 'error';
      return;
    }
    boardHierarchies[boardId] = 'loading';
    api.getBoardHierarchy(boardId).then(function (data) {
      boardHierarchies[boardId] = (data && Array.isArray(data.rows)) ? data.rows : [];
      if (renderMode === 'patch' && (patchBoardHierarchy(boardId) || patchLocalBoards())) return;
      rerenderLocalBoards();
    }).catch(function () {
      boardHierarchies[boardId] = 'error';
      if (renderMode === 'patch' && (patchBoardHierarchy(boardId) || patchLocalBoards())) return;
      rerenderLocalBoards();
    });
  }
  function toggleBoardExpand(boardId) {
    var nowExpanded = !expandedBoardIds[boardId];
    expandedBoardIds[boardId] = nowExpanded;
    if (nowExpanded && boardHierarchies[boardId] == null) {
      fetchBoardHierarchy(boardId);
    }
    rerenderLocalBoards();
  }

  function rerenderLocalBoards() {
    renderBoards(localBoardsEl, latestBoardsRendered, localCountEl);
    refreshActiveHighlight();
  }

  function patchOrRenderLocalBoards(boards) {
    latestBoardsRendered = boards;
    if (localCountEl) localCountEl.textContent = '(' + boards.length + ')';
    if (!boards.length) {
      renderBoards(localBoardsEl, boards, localCountEl);
      refreshActiveHighlight();
      return;
    }
    if (!patchLocalBoards()) {
      renderBoards(localBoardsEl, boards, localCountEl);
      refreshActiveHighlight();
    }
  }

  function patchLocalBoards() {
    if (!localBoardsEl || !window.TreeView || typeof window.TreeView.patch !== 'function') return false;
    var patched = window.TreeView.patch(
      localBoardsEl,
      latestBoardsRendered.map(buildBoardNode),
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

  function renderBoards(target, boards, counterEl) {
    latestBoardsRendered = boards;
    counterEl.textContent = '(' + boards.length + ')';
    target.innerHTML = '';
    if (!boards.length) {
      var empty = document.createElement('div');
      empty.className = 'hierarchical-empty empty';
      empty.textContent = 'none';
      target.appendChild(empty);
      return;
    }
    if (window.TreeView && typeof window.TreeView.render === 'function') {
      window.TreeView.render(target, boards.map(buildBoardNode), { escapeHtml: escapeHtml });
    }
  }

  // Pointer-based drag/drop (Phase 2-4). HTML5 native draggable does
  // not work reliably in WKWebView / WebView2 for this codebase —
  // every other Lexera drag surface (sidebar tree in `dndListeners.js`,
  // workspace shell tabs in `tabDragController.js`) uses the same
  // mousedown → distance-threshold → mousemove → mouseup pattern.
  // Mirror that here so the broadcast contract (and the bridge that
  // listens for it) stays unchanged.
  // Module-scope reference to the drag-block's endDrag so the
  // LexeraSubApp.init `onCustom` handlers below can clean up local
  // state when the destination webview broadcasts that it handled
  // the cross-view drop. The source's own pointerup may never fire
  // when the user releases over a sibling Tauri webview.
  var _workspacesEndDrag = null;
  // Cross-view receive-side handler — the kanban view's
  // `tryExternalNativeHover/Drop` dispatches `external-dnd-hover` /
  // `external-dnd-drop` to whichever webview the cursor lands on.
  // Without a receiver here, kanban→workspace drag is a no-op
  // (user report 2026-05-10 "i cant drag from the kanban to the
  // workspace!"). Wired in the drag-bound block below; called from
  // `LexeraSubApp.init`'s `onCustom` so the events go through the
  // same scoped wv.listen path the rest of the sub-app uses.
  var _workspacesOnExternalDnd = null;
  // Stage 17b cross-view RECEIVE-side per-webview pointer tracker.
  // See hierarchy.js for the architectural rationale (mirror of
  // embeddedBoardBridge.js's tracker).
  var _workspacesArmCrossDragTracker = null;
  var _workspacesTeardownCrossDragTracker = null;

  if (localBoardsEl && !localBoardsEl.__workspacesDragBound) {
    // Container relations: drop kind X onto kind Y where Y can hold X.
    //   card   → column  (card joins column.cards)
    //   column → stack   (column joins stack.columns)
    //   stack  → row     (stack joins row.stacks)
    //   row    → board   (row joins board.rows — drop on the kanban
    //                     directly)
    var ABSORB_KINDS = { card: 'column', column: 'stack', stack: 'row', row: 'board' };
    var DRAG_THRESHOLD_PX = 5;
    var pendingDrag = null;   // { startX, startY, source }
    var activeDrag = null;    // { source } — set once threshold is exceeded
    var activeDropTargetEl = null;
    // Pointer capture state — set when pointerdown captures the source
    // tree-node so pointermove/pointerup keep firing even after the
    // cursor crosses into a sibling Tauri webview (the kanban view).
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
      // Drag-kind nodes are the canonical drop targets (rows, stacks,
      // columns, cards). Board nodes (TreeView roots) are also valid
      // drop targets but ONLY for row-onto-board absorbs — they don't
      // carry `data-drag-kind`.
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
      // Same-kind drops carry a position ('before' | 'after') derived
      // from the cursor's Y vs the target's vertical midpoint. Cross-
      // kind absorbs (including row → board) always append.
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
    // the `_workspacesEndDrag` declaration just above this block.
    _workspacesEndDrag = endDrag;

    // Sub-app's own webview label — used to tag drag-move broadcasts
    // so the shell-side router can translate this document's cursor
    // coords into top-window coords. Looked up lazily so the runtime
    // is fully initialised by the time we need it.
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
    // per-webview pointer tracker. hierarchy.js wires the same module
    // with its own readDropTargetFromPoint closure.
    if (window.LexeraTreeCrossViewDrop &&
        typeof window.LexeraTreeCrossViewDrop.install === 'function') {
      var crossViewDropReceiver = window.LexeraTreeCrossViewDrop.install({
        readDropTargetFromPoint: readDropTargetFromPoint,
        getOwnWebviewLabel: getOwnWebviewLabel
      });
      _workspacesOnExternalDnd = crossViewDropReceiver.onExternalDnd;
      _workspacesArmCrossDragTracker = crossViewDropReceiver.armCrossDragTracker;
      _workspacesTeardownCrossDragTracker = crossViewDropReceiver.teardownCrossDragTracker;
    }

    // First-fire flag: log ONE [xview-dnd] source.route line per
    // drag session so the user can see in the in-app Log panel that
    // the source side IS routing (rules out "stage 1 never fires"
    // failure mode). drag-move fires ~60Hz; we don't spam.
    var _xviewSourceLogged = false;
    // rAF throttle — see hierarchy.js for the rationale (user report
    // 2026-05-10 "extremely slow when dragging from workspace to
    // kanban"). Per-pointermove routing would be an IPC roundtrip to
    // the destination hover handler at ~60Hz; rAF coalesces to 1/frame.
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
          window.lexeraLog('debug', '[xview-dnd] source.route { view: "workspaces", sourceLabel: "' +
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
      // Surface IPC failures: silent failure here is the most common
      // cause of "drag from workspace doesn't fire any event".
      if (promise && typeof promise.catch === 'function') {
        promise.catch(function (err) {
          if (typeof window.lexeraLog === 'function') {
            try {
              window.lexeraLog('warn', '[xview-dnd] source.route.failed view=workspaces err=' +
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
          // Include sourceWebviewLabel for destination self-skip
          // (Stage 17b — see hierarchy.js for the same pattern).
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
      // — surface that as a class so the user sees which side the
      // dragged sibling will land on. Cross-kind absorbs (no
      // position) get `.is-drop-absorb` so the parent itself
      // highlights — append-as-last semantics per user contract
      // 2026-05-09.
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
      // No local target: cursor may be over a different webview.
      // Route drag-move by source-client coords for sibling webviews,
      // with screen coords as the cross-window fallback. Pointer
      // capture (set on pointerdown) keeps these events flowing even
      // after the cursor crosses into a sibling Tauri webview.
      if (!match) broadcastCrossViewMove(e.clientX, e.clientY, e.screenX, e.screenY);
    };
    var onUp = function (e) {
      if (!activeDrag) {
        // Mousedown without crossing the drag threshold — let the click
        // listener handle navigation/toggle.
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
      _xviewSourceLogged = false; // re-log on the next drag session
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      if (window.LexeraSubApp && typeof window.LexeraSubApp.broadcast === 'function') {
        if (hadLocalDrop) {
          // Local within-panel reorder/absorb. The shell's
          // `hierarchy-entity-drop` listener applies the drop and
          // calls saveBoard. Logged so the user can verify in the Log
          // panel that the drop fired AND see the apply outcome.
          if (typeof window.lexeraLog === 'function') {
            try {
              window.lexeraLog('debug', '[xview-dnd] source.local-drop { view: "workspaces", srcKind: "' +
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
                  window.lexeraLog('warn', '[xview-dnd] source.local-drop.failed view=workspaces err=' +
                    ((err && err.message) ? err.message : String(err)));
                } catch (_) {}
              }
            });
          }
        } else {
          // Cursor was outside this webview at release. Dispatch this
          // as `external-dnd-drop` to the single webview under the
          // pointer. The native route ignores it if no
          // other webview matches.
          var endLabel = getOwnWebviewLabel();
          if (typeof window.lexeraLog === 'function') {
            try {
              window.lexeraLog('debug', '[xview-dnd] source.drag-end-external { view: "workspaces", sourceLabel: "' +
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
                  window.lexeraLog('warn', '[xview-dnd] source.drag-end-external.failed view=workspaces err=' +
                    ((err && err.message) ? err.message : String(err)));
                } catch (_) {}
              }
            });
          }
        }
      }
    };
    localBoardsEl.addEventListener('pointerdown', function (e) {
      // Only left mouse button starts a drag. Skip clicks on the
      // toggle (TreeView fold caret) so toggling stays click-driven.
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('.tree-toggle')) return;
      var source = readSourceFromNode(e.target);
      if (!source) return;
      // Pointer capture on the source tree-node so pointermove/pointerup
      // keep firing on this webview even after the user drags the
      // cursor into a sibling Tauri webview (the kanban view). Without
      // this, mouse events stop at the webview boundary and the direct
      // external-DnD route never fires for cross-webview drops. Mirrors
      // the kanban tab-drag pattern in tabDragController.js.
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
    // Cancel an in-flight drag if the window loses focus or the page
    // becomes hidden — common gesture-loss scenarios.
    window.addEventListener('blur', endDrag);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) endDrag();
    });
    localBoardsEl.__workspacesDragBound = true;
  }

  // Right-click is intentionally not assigned in this view — suppress
  // the browser's default context menu so it doesn't pop up over the
  // tree.
  if (localBoardsEl && !localBoardsEl.__workspacesContextMenuBound) {
    localBoardsEl.addEventListener('contextmenu', function (e) {
      if (e.target && e.target.closest && e.target.closest('.tree-node[data-drag-kind]')) {
        e.preventDefault();
      }
    });
    localBoardsEl.__workspacesContextMenuBound = true;
  }

  // Double-click on a row / stack / column / card label opens an
  // inline editor. Enter / blur commits + broadcasts
  // `hierarchy-entity-rename`; Escape cancels. Boards (TreeView roots
  // that don't carry `data-drag-kind`) are intentionally not editable
  // here — renaming a board changes the file name, which is a heavier
  // operation that belongs in the in-board surface.
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
  if (localBoardsEl && !localBoardsEl.__workspacesDblClickBound) {
    localBoardsEl.addEventListener('dblclick', function (e) {
      var node = e.target && e.target.closest
        ? e.target.closest('.tree-node[data-drag-kind]')
        : null;
      if (!node) return;
      // Don't hijack a dblclick on the toggle/grip — those have their
      // own behaviours.
      if (e.target.closest('.tree-toggle')) return;
      if (e.target.closest('.tree-menu-btn')) return;
      if (e.target.closest('.tree-grip')) return;
      e.preventDefault();
      startInlineRename(node);
    });
    localBoardsEl.__workspacesDblClickBound = true;
  }

  // Single delegated click listener — keeps wiring simple.
  if (localBoardsEl && !localBoardsEl.__workspacesClickBound) {
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
          // gets a burger menu, not just boards.
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
        if (target === 'board') {
          // Boards lazy-fetch their hierarchy and rebuild the tree —
          // route through state-mutating toggle rather than the
          // DOM-only TreeView helper.
          var bid = node.getAttribute('data-board-id') || '';
          if (bid) toggleBoardExpand(bid);
          return;
        }
        // Rows / stacks / columns already have children in the DOM —
        // toggle in place via TreeView's helper, same pattern the
        // dashboard / files panel / main board sidebar use.
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
      // opens the kanban if not already open. Mirror of the same
      // handler in hierarchy.js — clicks on the burger menu
      // (`.tree-menu-btn`) and drag icon (`.tree-grip`) intentionally
      // NOT routed here.
      if (e.target.closest && (e.target.closest('.tree-menu-btn') || e.target.closest('.tree-grip'))) {
        return;
      }
      var dragKind = node.getAttribute('data-drag-kind') || '';
      if (!dragKind) return;
      var focusBoardId = node.getAttribute('data-drag-board-id') || '';
      if (!focusBoardId) return;
      // Workspace tree nodes carry only `data-tree-id` (the entity id,
      // kid-preferred) and `data-drag-kind` — see the matching note
      // in hierarchy.js. Route the single id into the right field.
      var entityId = node.getAttribute('data-tree-id') || '';
      if (!entityId) return;
      var focusTarget = { boardId: focusBoardId };
      if (dragKind === 'card') focusTarget.cardId = entityId;
      else if (dragKind === 'column') focusTarget.columnId = entityId;
      else if (dragKind === 'stack') focusTarget.stackId = entityId;
      else if (dragKind === 'row') focusTarget.rowId = entityId;
      else return;
      // User report 2026-05-14: harvest stable disambiguators (title +
      // position) alongside ids — `column.id` can drift between the
      // workspace tree's cached hierarchy fetch and the kanban's
      // current DOM after any board edit. Mirror of the loop in
      // hierarchy.js — see that file for the full rationale.
      var ancestor = node && node.parentElement;
      while (ancestor) {
        if (ancestor.classList && ancestor.classList.contains('tree-entry')) {
          var ancNode = ancestor.querySelector(':scope > .tree-node[data-tree-id]');
          if (ancNode) {
            var ancKind = ancNode.getAttribute('data-drag-kind') || '';
            var ancId = ancNode.getAttribute('data-tree-id') || '';
            if (ancKind && ancId) {
              if (ancKind === 'column' && !focusTarget.columnId) {
                focusTarget.columnId = ancId;
                // DO NOT emit a `columnIndex` from tree position: tree
                // siblings are STACK-LOCAL but the kanban's data-col-index
                // is BOARD-FLAT. Passing the stack-local value matched
                // the WRONG column (user's "3 stacks left" symptom).
                var ancLabel = ancNode.querySelector(':scope > .tree-label');
                if (ancLabel) focusTarget.columnTitle = (ancLabel.textContent || '').trim();
              }
              else if (ancKind === 'stack' && !focusTarget.stackId) focusTarget.stackId = ancId;
              else if (ancKind === 'row' && !focusTarget.rowId) focusTarget.rowId = ancId;
            }
          }
        }
        ancestor = ancestor.parentElement;
      }
      // Diagnostic — see hierarchy.js for the rationale; mirror log
      // so workspace clicks emit the same trace.
      if (typeof window.lexeraLog === 'function') {
        try {
          window.lexeraLog('debug', '[focus-trace] workspaces.click.navigate ' +
            JSON.stringify({ kind: dragKind, boardId: focusBoardId, cardId: focusTarget.cardId, columnId: focusTarget.columnId, stackId: focusTarget.stackId, rowId: focusTarget.rowId }));
        } catch (_) { /* non-fatal */ }
      }
      LexeraSubApp.navigate({
        type: 'focus-hierarchy-target',
        target: focusTarget
      });
    });
    localBoardsEl.__workspacesClickBound = true;
  }

  function findCurrentWorkspace(snap) {
    if (snap && snap.activeWorkspace && snap.activeWorkspace.id) return snap.activeWorkspace;
    var activeId = snap && snap.activeWorkspaceId ? String(snap.activeWorkspaceId) : '';
    if (activeId === REMOTE_WORKSPACE_ID) {
      return { id: REMOTE_WORKSPACE_ID, name: REMOTE_WORKSPACE_NAME, isRemoteWorkspace: true };
    }
    var workspaces = snap && Array.isArray(snap.workspaces) ? snap.workspaces : [];
    if (activeId) {
      for (var i = 0; i < workspaces.length; i++) {
        if (String(workspaces[i] && workspaces[i].id || '') === activeId) return workspaces[i];
      }
      return { id: activeId, name: activeId };
    }
    return workspaces.length ? workspaces[0] : null;
  }

  function renderCurrentWorkspace(snap) {
    var workspace = findCurrentWorkspace(snap || {});
    currentWorkspace = workspace;
    if (!currentWorkspaceEl) return;
    if (!workspace) {
      currentWorkspaceEl.innerHTML = '<span class="empty">none</span>';
      return;
    }
    currentWorkspaceEl.dataset.workspaceId = workspace.id || '';
    currentWorkspaceEl.innerHTML =
      '<span class="current-workspace-name">' + escapeHtml(workspace.name || '(untitled)') + '</span>' +
      '<span class="current-workspace-id">' + escapeHtml(workspace.id ? String(workspace.id).substring(0, 8) : '') + '</span>';
  }

  // After a drag-drop reorder, the shell-side bridge broadcasts
  // `hierarchy-board-changed` so sub-apps can drop their cached
  // hierarchy. Without this, we'd re-render from stale rows and the
  // user would see no visible change.
  function invalidateBoardHierarchy(boardId) {
    if (!boardId) return;
    delete boardHierarchies[boardId];
    if (expandedBoardIds[boardId]) {
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
      // this echo the drag state would persist past the release.
      'cross-view-drag-handled': function () {
        if (typeof _workspacesEndDrag === 'function') _workspacesEndDrag();
        if (typeof _workspacesTeardownCrossDragTracker === 'function') {
          _workspacesTeardownCrossDragTracker();
        }
      },
      // Stage 17b: arm the per-webview pointer tracker when ANY
      // sibling webview broadcasts drag-start (mirror of hierarchy.js).
      'hierarchy-entity-drag-start': function (payload) {
        if (typeof _workspacesArmCrossDragTracker === 'function') {
          _workspacesArmCrossDragTracker(payload || null);
        }
      },
      // Cross-view receive (kanban → workspace). Subscribing ensures
      // wv.listen is registered for these events so multiview_emit_to
      // delivers them; the closures route into the destination handler
      // wired up inside the drag-bound block above.
      'external-dnd-hover': function (payload) {
        if (typeof _workspacesOnExternalDnd === 'function') _workspacesOnExternalDnd('hover', payload);
      },
      'external-dnd-drop': function (payload) {
        if (typeof _workspacesOnExternalDnd === 'function') _workspacesOnExternalDnd('drop', payload);
      },
      'external-dnd-clear': function () {
        if (typeof _workspacesOnExternalDnd === 'function') _workspacesOnExternalDnd('clear', null);
      }
    },
    onCatalog: function (snap) {
      var workspace = findCurrentWorkspace(snap || {});
      var visibleBoards = workspace && workspace.id === REMOTE_WORKSPACE_ID
        ? (snap.remoteBoards || [])
        : (snap.boards || []);
      patchOrRenderLocalBoards(visibleBoards);
      renderCurrentWorkspace(snap || {});
      refreshActiveHighlight();
      statusEl.textContent = 'connected';
    },
    onActiveBoard: function (boardId) {
      activeBoardId = boardId;
      refreshActiveHighlight();
    },
    onError: function (err) {
      statusEl.textContent = String(err);
    }
  });

  // ── Test API ──────────────────────────────────────────────────────
  // User-interaction surface for vitest + autoRun integration tests.
  // Mirrors LexeraDashboardTestApi: every operation drives the SAME
  // DOM and event paths a real user does.
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
  function collectListItemState() {
    if (!localBoardsEl) return [];
    var nodes = localBoardsEl.querySelectorAll('.tree-node[data-tree-target="board"]');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var labelEl = nodes[i].querySelector('.tree-label');
      out.push({
        id: nodes[i].getAttribute('data-board-id') || '',
        label: labelEl ? labelEl.textContent : '',
        active: nodes[i].classList.contains('is-active')
      });
    }
    return out;
  }
  window.LexeraWorkspacesTestApi = {
    collectState: function () {
      return {
        status: statusEl ? statusEl.textContent : '',
        activeBoardId: activeBoardId,
        local: collectListItemState(),
        remote: [],
        currentWorkspace: currentWorkspace ? {
          id: currentWorkspace.id || '',
          label: currentWorkspace.name || '(untitled)'
        } : null,
        workspaces: []
      };
    },
    clickBoard: function (boardId, scope) {
      // Drives the same `LexeraSubApp.navigate({ type: 'open-board' })`
      // a real label click does.
      void scope;
      var node = findBoardNode(boardId);
      if (!node) return false;
      var label = node.querySelector('.tree-label') || node;
      return dispatchClick(label);
    },
    clickOpenWorkspace: function (workspaceId) {
      void workspaceId;
      return false;
    }
  };
})();
