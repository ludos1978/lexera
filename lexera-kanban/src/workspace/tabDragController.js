/**
 * LexeraTabDragController
 *
 * Pointer-driven drag/drop for tabs and side-dock panels. Handles:
 *   - Threshold-based drag start (squared-distance ≥ 36px)
 *   - Drag ghost (text overlay following the pointer)
 *   - Drop-zone detection: tab-bar reorder vs leaf zones (left/right/
 *     top/bottom/center) vs side-dock panel-drop targets
 *   - Detach-by-drag (point leaves workspace bounds → open detached
 *     window for the tab/panel)
 *
 * Setup contract:
 *   LexeraTabDragController.setup({
 *     state,                       // shell state (live ref)
 *     getBody,                     // () → document.body
 *     // Tree queries:
 *     findTabInAllTrees,
 *     findPanelInAllTrees,
 *     // Tree mutators (each renders internally):
 *     moveTabToLeaf,
 *     moveTabToLeafAtIndex,
 *     splitLeafWithTab,
 *     splitLeafWithPanel,
 *     placePanelInLeaf,
 *     reorderTabInLeaf,
 *     movePanelToDock,
 *     // Detach:
 *     detachTab,
 *     detachPanelView,
 *     // Activation + selection:
 *     activateTab,
 *     activatePanel,
 *     // Panel + tab title for ghost:
 *     resolvePanelTarget,
 *     getPanelTitle,
 *     getTabTitle,
 *     // Panel-drop dock helpers:
 *     clearPanelDropTargets,
 *     setPanelDropTarget,
 *     // Workspace bounds for detach detection:
 *     isPointOutsideWorkspaceBounds,
 *     // After-pointerdown UI updates (selection):
 *     notifyActiveBoardChanged,
 *     // Persistence:
 *     persist
 *   });
 *
 * Public API:
 *   handlePointerDown(event)
 */
(function () {
  'use strict';

  var deps = null;

  var REQUIRED_DEPS = [
    'state', 'getBody',
    'findTabInAllTrees', 'findPanelInAllTrees',
    'moveTabToLeaf', 'moveTabToLeafAtIndex', 'splitLeafWithTab',
    'splitLeafWithPanel', 'placePanelInLeaf', 'reorderTabInLeaf',
    'movePanelToDock', 'detachTab', 'detachPanelView',
    'activateTab', 'activatePanel',
    'resolvePanelTarget', 'getPanelTitle', 'getTabTitle',
    'clearPanelDropTargets', 'setPanelDropTarget',
    'isPointOutsideWorkspaceBounds',
    'notifyActiveBoardChanged', 'persist'
  ];

  function setup(setupDeps) {
    if (!setupDeps) throw new Error('LexeraTabDragController.setup requires deps');
    for (var i = 0; i < REQUIRED_DEPS.length; i++) {
      if (setupDeps[REQUIRED_DEPS[i]] == null) {
        throw new Error('LexeraTabDragController.setup missing dep: ' + REQUIRED_DEPS[i]);
      }
    }
    deps = setupDeps;
  }

  // ── Drop-zone detection / DOM helpers ─────────────────────────────

  function getDropZoneForEvent(tabsetEl, event) {
    var rect = tabsetEl.getBoundingClientRect();
    var x = event.clientX;
    var y = event.clientY;
    var edgeX = Math.min(80, rect.width * 0.24);
    var edgeY = Math.min(80, rect.height * 0.24);
    if (x <= rect.left + edgeX) return 'left';
    if (x >= rect.right - edgeX) return 'right';
    if (y <= rect.top + edgeY) return 'top';
    if (y >= rect.bottom - edgeY) return 'bottom';
    return 'center';
  }

  function clearDropZones() {
    var state = deps.state;
    var containers = [state.dockEl, state.leftDockEl, state.rightDockEl, state.bottomDockEl];
    for (var c = 0; c < containers.length; c++) {
      if (!containers[c]) continue;
      var nodes = containers[c].querySelectorAll('.workspace-shell-tabset[data-drop-zone]');
      for (var i = 0; i < nodes.length; i++) nodes[i].removeAttribute('data-drop-zone');
      var zones = containers[c].querySelectorAll('.workspace-shell-drop-zone.is-active');
      for (var j = 0; j < zones.length; j++) zones[j].classList.remove('is-active');
    }
    state.dragHoverLeafId = '';
    state.dragHoverZone = '';
    clearTabInsertIndicator();
  }

  function getTabInsertIndex(tabsEl, clientX) {
    var children = tabsEl.children;
    var tabs = [];
    for (var j = 0; j < children.length; j++) {
      if (!children[j].classList.contains('ws-tab-insert-marker')) tabs.push(children[j]);
    }
    if (!tabs.length) return 0;
    for (var i = 0; i < tabs.length; i++) {
      var rect = tabs[i].getBoundingClientRect();
      var mid = rect.left + rect.width / 2;
      if (clientX < mid) return i;
    }
    return tabs.length;
  }

  function setTabInsertIndicator(tabsEl, index) {
    clearTabInsertIndicator();
    if (!tabsEl || index < 0) return;
    deps.state.dragHoverTabIndex = index;
    var marker = document.createElement('div');
    marker.className = 'ws-tab-insert-marker';
    var children = tabsEl.children;
    var tabs = [];
    for (var j = 0; j < children.length; j++) {
      if (!children[j].classList.contains('ws-tab-insert-marker')) tabs.push(children[j]);
    }
    if (index < tabs.length) {
      tabsEl.insertBefore(marker, tabs[index]);
    } else {
      tabsEl.appendChild(marker);
    }
  }

  function clearTabInsertIndicator() {
    deps.state.dragHoverTabIndex = -1;
    var markers = document.querySelectorAll('.ws-tab-insert-marker');
    for (var i = 0; i < markers.length; i++) {
      markers[i].parentNode.removeChild(markers[i]);
    }
  }

  function setTabDragModeEnabled(enabled) {
    deps.getBody().classList.toggle('workspace-shell-tab-dragging', !!enabled);
    // Native Tauri child webviews (panels/boards) paint above the shell
    // DOM and capture pointer events at the OS layer, so without hiding
    // them the user can't drop a tab between existing tabs whose tabset
    // overlaps a webview, and the drop indicator would be invisible.
    // Park all spawned webviews offscreen for the duration of the drag.
    if (window.LexeraMultiviewWebview && typeof window.LexeraMultiviewWebview.setAllVisible === 'function') {
      window.LexeraMultiviewWebview.setAllVisible(!enabled);
    }
  }

  function createTabDragGhost(tabId) {
    var found = deps.findTabInAllTrees(tabId);
    if (!found) {
      if (typeof window.lexeraLog === 'function') {
        window.lexeraLog('warn', '[tabDragController.createTabDragGhost] returning null — tab "' + tabId + '" not found in any tree during active drag');
      }
      return null;
    }
    var ghost = document.createElement('div');
    ghost.className = 'workspace-shell-tab-ghost';
    ghost.textContent = deps.getTabTitle(found.tab);
    document.body.appendChild(ghost);
    return ghost;
  }

  function createPanelDragGhost(panelId) {
    var ghost = document.createElement('div');
    ghost.className = 'workspace-shell-tab-ghost';
    ghost.textContent = deps.getPanelTitle(panelId);
    document.body.appendChild(ghost);
    return ghost;
  }

  function positionDragGhost(ghost, x, y) {
    if (!ghost) return;
    ghost.style.left = Math.round(x) + 'px';
    ghost.style.top = Math.round(y) + 'px';
  }

  function destroyDragGhost(ghost) {
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
  }

  function setDropZoneHighlight(leafId, zone) {
    var state = deps.state;
    clearDropZones();
    if (!leafId || !zone) return;
    state.dragHoverLeafId = leafId;
    state.dragHoverZone = zone;
    var containers = [state.dockEl, state.leftDockEl, state.rightDockEl, state.bottomDockEl];
    for (var c = 0; c < containers.length; c++) {
      if (!containers[c]) continue;
      var tabsetEl = containers[c].querySelector('.workspace-shell-tabset[data-node-id="' + leafId + '"]');
      if (tabsetEl) { tabsetEl.setAttribute('data-drop-zone', zone); break; }
    }
    for (var d = 0; d < containers.length; d++) {
      if (!containers[d]) continue;
      var zoneEl = containers[d].querySelector('.workspace-shell-drop-zone[data-ws-drop-leaf="' + leafId + '"][data-zone="' + zone + '"]');
      if (zoneEl) { zoneEl.classList.add('is-active'); break; }
    }
  }

  // ── Pointer handlers ──────────────────────────────────────────────

  function handleTabPointerMove(event) {
    var state = deps.state;
    var drag = state.pointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (deps.isPointOutsideWorkspaceBounds(event.clientX, event.clientY, 40)) {
      drag.detachArmed = true;
    }
    state.dragLastX = event.clientX;
    state.dragLastY = event.clientY;

    if (!drag.started) {
      var dx = event.clientX - drag.startX;
      var dy = event.clientY - drag.startY;
      if ((dx * dx) + (dy * dy) < 36) return;
      drag.started = true;
      state.dragTabId = drag.tabId || '';
      state.dragPanelId = drag.panelId || '';
      state.dragDroppedInternally = false;
      if (drag.tabId) {
        drag.ghost = createTabDragGhost(drag.tabId);
      } else if (drag.panelId) {
        drag.ghost = createPanelDragGhost(drag.panelId);
      }
      setTabDragModeEnabled(true);
    }

    positionDragGhost(drag.ghost, event.clientX, event.clientY);

    var target = document.elementFromPoint(event.clientX, event.clientY);

    // Tab-bar reorder detection: pointer over a tab header
    var headerEl = target ? target.closest('.ws-view-header') : null;
    if (headerEl) {
      var headerTabsetEl = headerEl.closest('.workspace-shell-tabset');
      if (headerTabsetEl) {
        var leafId = headerTabsetEl.getAttribute('data-node-id');
        if (!headerEl.classList.contains('is-single')) {
          var tabsEl = headerEl.querySelector('.ws-view-tabs');
          if (tabsEl && leafId) {
            deps.clearPanelDropTargets();
            clearDropZones();
            var insertIdx = getTabInsertIndex(tabsEl, event.clientX);
            setTabInsertIndicator(tabsEl, insertIdx);
            state.dragHoverLeafId = leafId;
            state.dragHoverZone = 'tab-reorder';
            return;
          }
        }
        if (leafId) {
          deps.clearPanelDropTargets();
          clearTabInsertIndicator();
          setDropZoneHighlight(leafId, 'center');
          return;
        }
      }
    }

    var zoneEl = target ? target.closest('[data-ws-drop-zone][data-ws-drop-leaf]') : null;
    var tabsetEl2 = target ? target.closest('.workspace-shell-tabset') : null;
    if (zoneEl) {
      deps.clearPanelDropTargets();
      setDropZoneHighlight(zoneEl.getAttribute('data-ws-drop-leaf'), zoneEl.getAttribute('data-ws-drop-zone'));
      return;
    }
    if (tabsetEl2) {
      deps.clearPanelDropTargets();
      setDropZoneHighlight(tabsetEl2.getAttribute('data-node-id'), getDropZoneForEvent(tabsetEl2, event));
      return;
    }
    var dockZoneEl = target ? target.closest('[data-ws-panel-drop-dock]') : null;
    if (dockZoneEl) {
      deps.setPanelDropTarget(dockZoneEl.getAttribute('data-ws-panel-drop-dock'));
      return;
    }
    deps.clearPanelDropTargets();
    clearDropZones();
  }

  function finishTabPointerDrag(event) {
    var state = deps.state;
    var drag = state.pointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    window.removeEventListener('pointermove', handleTabPointerMove, true);
    window.removeEventListener('pointerup', finishTabPointerDrag, true);
    window.removeEventListener('pointercancel', finishTabPointerDrag, true);

    if (drag.sourceEl && typeof drag.sourceEl.releasePointerCapture === 'function') {
      try { drag.sourceEl.releasePointerCapture(event.pointerId); } catch (_) { /* ignore */ }
    }

    destroyDragGhost(drag.ghost);
    setTabDragModeEnabled(false);

    if (!drag.started) {
      // Click-without-drag → just activate.
      state.pointerDrag = null;
      state.dragTabId = '';
      state.dragPanelId = '';
      clearDropZones();
      if (drag.panelId) deps.activatePanel(drag.panelId);
      else if (drag.tabId) deps.activateTab(drag.tabId);
      return;
    }

    var tabId = drag.tabId;
    var panelId = drag.panelId || '';
    var x = drag.lastX;
    var y = drag.lastY;
    var leafId = state.dragHoverLeafId;
    var zone = state.dragHoverZone;
    var dockId = state.dragHoverDock || '';

    clearDropZones();
    deps.clearPanelDropTargets();
    state.pointerDrag = null;
    state.dragTabId = '';
    state.dragPanelId = '';

    // Side-dock drop for panel drag
    if (dockId && panelId) {
      deps.movePanelToDock(panelId, dockId);
      deps.activatePanel(panelId);
      state.dragDroppedInternally = false;
      return;
    }

    if (leafId && zone) {
      state.dragDroppedInternally = true;
      var dropTabIndex = state.dragHoverTabIndex;
      clearTabInsertIndicator();

      if (zone === 'tab-reorder' && dropTabIndex >= 0) {
        var effectiveTabId = tabId;
        if (!effectiveTabId && panelId) {
          var panelInfo = deps.findPanelInAllTrees(panelId);
          if (panelInfo) effectiveTabId = panelInfo.tab.id;
        }
        if (effectiveTabId) {
          var tabInfo = deps.findTabInAllTrees(effectiveTabId);
          if (tabInfo && tabInfo.leaf.id === leafId) {
            deps.reorderTabInLeaf(effectiveTabId, leafId, dropTabIndex);
          } else {
            deps.moveTabToLeafAtIndex(effectiveTabId, leafId, dropTabIndex);
          }
        }
      } else if (panelId && !tabId) {
        if (zone === 'center') deps.placePanelInLeaf(panelId, leafId);
        else deps.splitLeafWithPanel(leafId, zone, panelId);
      } else if (tabId) {
        if (zone === 'center') deps.moveTabToLeaf(tabId, leafId);
        else deps.splitLeafWithTab(leafId, zone, tabId);
      }
      state.dragDroppedInternally = false;
      return;
    }

    var outsideWindow = drag.detachArmed && deps.isPointOutsideWorkspaceBounds(x, y, 20);
    if (outsideWindow) {
      if (panelId && !tabId) deps.detachPanelView(panelId);
      else if (tabId) deps.detachTab(tabId);
    }
    state.dragDroppedInternally = false;
  }

  function startPointerDrag(sourceEl, tabId, panelId, event) {
    deps.state.pointerDrag = {
      tabId: tabId,
      panelId: panelId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      detachArmed: false,
      started: false,
      sourceEl: sourceEl,
      ghost: null
    };
    if (typeof sourceEl.setPointerCapture === 'function') {
      try { sourceEl.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
    }
    window.addEventListener('pointermove', handleTabPointerMove, true);
    window.addEventListener('pointerup', finishTabPointerDrag, true);
    window.addEventListener('pointercancel', finishTabPointerDrag, true);
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    var state = deps.state;

    // Panel drag-handle (e.g. dock-strip handle): start unified drag.
    var panelHandleEl = event.target.closest('[data-ws-panel-drag-handle]');
    if (panelHandleEl) {
      event.preventDefault();
      var handledPanelId = deps.resolvePanelTarget(panelHandleEl.getAttribute('data-ws-panel-drag-handle'));
      if (!handledPanelId) return;
      state.activePanelId = handledPanelId;
      var panelFound = deps.findPanelInAllTrees(handledPanelId);
      var dragTabId = panelFound ? panelFound.tab.id : '';
      startPointerDrag(panelHandleEl, dragTabId, handledPanelId, event);
      deps.persist();
      return;
    }
    // Panel tab in side dock: start unified drag (skip close button).
    var panelTabEl = event.target.closest('.ws-view-tab[data-ws-panel-id]');
    if (panelTabEl && !event.target.closest('[data-ws-action="close-panel"]')) {
      event.preventDefault();
      var panelId = panelTabEl.getAttribute('data-ws-panel-id');
      if (!panelId) return;
      state.activePanelId = panelId;
      var panelFound2 = deps.findPanelInAllTrees(panelId);
      var dragTabId2 = panelFound2 ? panelFound2.tab.id : '';
      startPointerDrag(panelTabEl, dragTabId2, panelId, event);
      deps.persist();
      return;
    }
    var panelWindowEl = event.target.closest('.workspace-shell-panel-window[data-panel-id]');
    if (panelWindowEl) {
      var windowPanelId = deps.resolvePanelTarget(panelWindowEl.getAttribute('data-panel-id'));
      if (windowPanelId) {
        state.activePanelId = windowPanelId;
        deps.persist();
      }
    }
    var tabEl = event.target.closest('.ws-view-tab[data-ws-tab-id]') ||
                event.target.closest('.ws-view-drag[data-ws-tab-id]');
    if (tabEl && !event.target.closest('[data-ws-action="close-tab"]')) {
      event.preventDefault();
      var tabId = tabEl.getAttribute('data-ws-tab-id');
      if (!tabId) return;
      var ownerTabset = tabEl.closest('.workspace-shell-tabset');
      if (ownerTabset) {
        state.activeLeafId = ownerTabset.getAttribute('data-node-id') || state.activeLeafId;
        deps.persist();
      }
      startPointerDrag(tabEl, tabId, '', event);
      return;
    }
    var tabset = event.target.closest('.workspace-shell-tabset');
    if (!tabset) return;
    var nodeId = tabset.getAttribute('data-node-id');
    if (!nodeId) return;
    state.activeLeafId = nodeId;
    deps.notifyActiveBoardChanged();
    deps.persist();
  }

  window.LexeraTabDragController = {
    setup: setup,
    handlePointerDown: handlePointerDown,
    // Exposed so the shell's clearPanelDropTargets() can also reset
    // tab-zone highlights without reaching into module internals.
    clearDropZones: clearDropZones
  };
})();
