/**
 * Sidebar Sync — synchronizes the sidebar tree highlight with the board view.
 *
 * Manages:
 *   - Sync-highlight of the sidebar tree node matching the current viewport
 *   - Sidebar lock toggle (editable vs read-only hierarchy)
 *   - Sidebar hierarchy burger menu (sync, lock, fold/unfold, display options)
 *   - Debounced scroll-sync listener
 *
 * Dependencies injected via init():
 *   - getFocusedCardEl()                — returns the currently focused card element (or null)
 *   - getElColumnsContainer()           — returns the board's main columns container element
 *   - getElBoardList()                  — returns the sidebar board-list element
 *   - getSidebarTreeOwnerNode(el)       — returns the tree-node that owns a .tree-children container
 *   - renderBoardList()                 — re-renders the sidebar board list
 *   - buildSidebarHierarchyDisplayMenuItems() — returns display toggle menu items
 *   - formatMenuToggleLabel(on, label)  — formats a toggle menu label
 *   - showNativeMenu(items, x, y, id)  — shows a native context menu, returns Promise<string|null>
 *   - getActionRegistry()               — returns the ActionRegistry instance (or null)
 */
(function (root, factory) {
  var mod = factory();
  if (typeof root !== 'undefined') root.LexeraSidebarSync = mod;
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  var _deps = {};

  var sidebarSyncEnabled = false;
  var hierarchyLocked = false;
  var scrollSyncTimer = null;

  // ── Dependency accessors ──────────────────────────────────────────

  function getFocusedCardEl() {
    return _deps.getFocusedCardEl ? _deps.getFocusedCardEl() : null;
  }

  function getContainer() {
    return _deps.getElColumnsContainer ? _deps.getElColumnsContainer() : null;
  }

  function getBoardList() {
    return _deps.getElBoardList ? _deps.getElBoardList() : null;
  }

  function getOwnerNode(el) {
    return _deps.getSidebarTreeOwnerNode ? _deps.getSidebarTreeOwnerNode(el) : null;
  }

  function doRenderBoardList() {
    if (_deps.renderBoardList) _deps.renderBoardList();
  }

  function getDisplayMenuItems() {
    return _deps.buildSidebarHierarchyDisplayMenuItems ? _deps.buildSidebarHierarchyDisplayMenuItems() : [];
  }

  function fmtToggle(on, label) {
    return _deps.formatMenuToggleLabel ? _deps.formatMenuToggleLabel(on, label) : (on ? '[x] ' : '[ ] ') + label;
  }

  function nativeMenu(items, x, y, id) {
    if (_deps.showNativeMenu) return _deps.showNativeMenu(items, x, y, id);
    return Promise.resolve(null);
  }

  function getRegistry() {
    return _deps.getActionRegistry ? _deps.getActionRegistry() : null;
  }

  // ── Sidebar Sync ──────────────────────────────────────────────────

  function syncSidebarToView() {
    if (!sidebarSyncEnabled) return;

    // Priority 1: focused card
    var focused = getFocusedCardEl();
    if (focused && focused.isConnected) {
      var colIdx = focused.getAttribute('data-col-index');
      var cardIdx = focused.getAttribute('data-card-index');
      highlightSidebarNode('.tree-card[data-col-index="' + colIdx + '"][data-card-index="' + cardIdx + '"]');
      return;
    }

    // Priority 2: first visible column in viewport
    var container = getContainer();
    if (!container) return;
    var columns = container.querySelectorAll('.column');
    var containerRect = container.getBoundingClientRect();
    for (var i = 0; i < columns.length; i++) {
      var rect = columns[i].getBoundingClientRect();
      if (rect.left >= containerRect.left && rect.right > containerRect.left) {
        var colCards = columns[i].querySelector('.column-cards');
        if (colCards) {
          var ci = colCards.getAttribute('data-col-index');
          if (ci != null) {
            highlightSidebarNode('.tree-column[data-col-index="' + ci + '"]');
            return;
          }
        }
      }
    }
  }

  function highlightSidebarNode(selector) {
    var boardList = getBoardList();
    if (!boardList) return;

    // Remove previous highlight
    var prev = boardList.querySelector('.sync-highlight');
    if (prev) prev.classList.remove('sync-highlight');

    var node = boardList.querySelector(selector);
    if (!node) return;

    // Expand all parent .tree-children containers
    var parent = node.parentElement;
    while (parent && parent !== boardList) {
      if (parent.classList.contains('tree-children') && !parent.classList.contains('expanded')) {
        parent.classList.add('expanded');
        var toggleNode = getOwnerNode(parent);
        if (toggleNode) {
          toggleNode.setAttribute('aria-expanded', 'true');
          var toggle = toggleNode.querySelector('.tree-toggle');
          if (toggle) toggle.classList.add('expanded');
        }
      }
      if (parent.classList.contains('board-item-tree') && !parent.classList.contains('expanded')) {
        parent.classList.add('expanded');
        var boardItem = parent.previousElementSibling;
        if (boardItem) {
          var toggle2 = boardItem.querySelector('.board-item-toggle');
          if (toggle2) toggle2.classList.add('expanded');
        }
      }
      parent = parent.parentElement;
    }

    // Highlight and scroll
    node.classList.add('sync-highlight');
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Sidebar sync button handler
  // Sidebar hierarchy burger menu — replaces individual sync/lock buttons
  function toggleSidebarSync() {
    sidebarSyncEnabled = !sidebarSyncEnabled;
    localStorage.setItem('lexera-sidebar-sync', sidebarSyncEnabled ? 'true' : 'false');
    if (sidebarSyncEnabled) syncSidebarToView();
    else {
      var boardList = getBoardList();
      if (boardList) {
        var prev = boardList.querySelector('.sync-highlight');
        if (prev) prev.classList.remove('sync-highlight');
      }
    }
  }

  function toggleSidebarLock() {
    hierarchyLocked = !hierarchyLocked;
    localStorage.setItem('lexera-hierarchy-locked', hierarchyLocked ? 'true' : 'false');
    doRenderBoardList();
  }

  function showSidebarHierarchyMenu(anchorEl) {
    if (!anchorEl) return;
    var rect = anchorEl.getBoundingClientRect();
    var displayItems = getDisplayMenuItems();
    var items = [
      { id: 'toggle-sidebar-sync', label: fmtToggle(sidebarSyncEnabled, 'Sync with View') },
      { id: 'toggle-sidebar-lock', label: fmtToggle(!hierarchyLocked, 'Editable') },
      { separator: true },
      { id: 'toggle-sidebar-counts', label: displayItems[0] ? displayItems[0].label : '' },
      { id: 'toggle-sidebar-presence', label: displayItems[1] ? displayItems[1].label : '' },
      { id: 'toggle-sidebar-grips', label: displayItems[2] ? displayItems[2].label : '' },
      { separator: true },
      { id: 'sidebar-fold-all', label: 'Fold All' },
      { id: 'sidebar-unfold-all', label: 'Unfold All' }
    ];
    nativeMenu(items, rect.right, rect.bottom, 'menu.sidebar').then(function (action) {
      if (!action) return;
      if (action === 'toggle-sidebar-sync') { toggleSidebarSync(); return; }
      if (action === 'toggle-sidebar-lock') { toggleSidebarLock(); return; }
      if (action === 'sidebar-fold-all' || action === 'sidebar-unfold-all') {
        var expand = action === 'sidebar-unfold-all';
        var boardList = getBoardList();
        if (boardList) {
          var allChildren = boardList.querySelectorAll('.tree-children');
          var allToggles = boardList.querySelectorAll('.tree-toggle');
          for (var i = 0; i < allChildren.length; i++) {
            allChildren[i].classList.toggle('expanded', expand);
          }
          for (var j = 0; j < allToggles.length; j++) {
            allToggles[j].classList.toggle('expanded', expand);
          }
        }
        doRenderBoardList();
        return;
      }
      var registry = getRegistry();
      if (registry) registry.dispatch('board', action, {});
    });
  }

  // ── Scroll Sync Binding ───────────────────────────────────────────

  function bindScrollSync() {
    var container = getContainer();
    if (!container) return;
    container.addEventListener('scroll', function () {
      if (!sidebarSyncEnabled) return;
      clearTimeout(scrollSyncTimer);
      scrollSyncTimer = setTimeout(syncSidebarToView, 300);
    });
  }

  // ── Menu Button Binding ───────────────────────────────────────────

  function bindMenuButton() {
    var menuBtn = document.getElementById('btn-sidebar-menu');
    if (!menuBtn) return;
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      showSidebarHierarchyMenu(menuBtn);
    });
  }

  // ── Init ──────────────────────────────────────────────────────────

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
    sidebarSyncEnabled = localStorage.getItem('lexera-sidebar-sync') === 'true';
    hierarchyLocked = localStorage.getItem('lexera-hierarchy-locked') === 'true';
    bindScrollSync();
    bindMenuButton();
  }

  // ── Public API ────────────────────────────────────────────────────

  return {
    init: init,
    syncSidebarToView: syncSidebarToView,
    highlightSidebarNode: highlightSidebarNode,
    toggleSidebarSync: toggleSidebarSync,
    toggleSidebarLock: toggleSidebarLock,
    showSidebarHierarchyMenu: showSidebarHierarchyMenu,
    isSyncEnabled: function () { return sidebarSyncEnabled; },
    isHierarchyLocked: function () { return hierarchyLocked; }
  };
}));
