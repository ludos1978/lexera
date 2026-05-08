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

  /**
   * @typedef {('left'|'right'|'top'|'bottom'|'center'|'tab-reorder')} DropZone
   *   Where the pointer is hovering inside a leaf during drag.
   *   `tab-reorder` is the tab-bar-internal mode (insert between
   *   existing tabs); the other five drive split / center-merge.
   */

  /**
   * @typedef {Object} PointerDragRecord
   *   The drag-in-flight record the controller stashes on
   *   `state.pointerDrag`. Mirrors `WorkspaceShellDragState`'s
   *   PointerDragState typedef on the consumer side.
   * @property {string} tabId - Empty string when the drag started
   *   from a panel handle without a backing tab id.
   * @property {string} panelId - Empty string when the drag started
   *   from a board tab (no panel involvement).
   * @property {number} pointerId
   * @property {number} startX
   * @property {number} startY
   * @property {number} lastX
   * @property {number} lastY
   * @property {boolean} detachArmed - Set when the pointer leaves the
   *   workspace bounds; allows finishTabPointerDrag to fire detach.
   * @property {boolean} started - False until the pointer crosses the
   *   threshold (squared distance ≥ 36px); guard so a click doesn't
   *   spawn a ghost.
   * @property {Element} sourceEl - The element pointer-capture is held
   *   on (tab header / drag handle).
   * @property {HTMLElement|null} ghost - The drag-ghost overlay, or
   *   `null` until the threshold trips.
   */

  /**
   * @typedef {Object} TabDragControllerState
   *   Structural subset of the workspace shell `state` this module
   *   reads + writes. Decouples from the umbrella WorkspaceShellState
   *   typedef in workspaceShell.js — same pattern as the reconciler /
   *   treeRegistry / messageBridge / layoutPersistence slices.
   * @property {PointerDragRecord|null} pointerDrag
   * @property {string} activePanelId
   * @property {string} activeLeafId
   * @property {string} dragTabId
   * @property {string} dragPanelId
   * @property {string} dragHoverLeafId
   * @property {DropZone|''} dragHoverZone
   * @property {number} dragHoverTabIndex
   * @property {string} dragHoverDock
   * @property {boolean} dragDroppedInternally
   * @property {number} dragLastX
   * @property {number} dragLastY
   * @property {HTMLElement|null} dockEl
   * @property {HTMLElement|null} leftDockEl
   * @property {HTMLElement|null} rightDockEl
   * @property {HTMLElement|null} bottomDockEl
   */

  /**
   * @typedef {Object} TabFindResult
   * @property {{id: string}} tab
   * @property {{id: string}} leaf
   * @property {number} index
   */

  /**
   * @typedef {Object} PanelFindResult
   * @property {{id: string}} tab
   * @property {{id: string}} leaf
   */

  /**
   * @typedef {Object} TabDragControllerDeps
   * @property {TabDragControllerState} state
   * @property {function(): HTMLElement} getBody
   * @property {function(string): TabFindResult|null} findTabInAllTrees
   * @property {function(string): PanelFindResult|null} findPanelInAllTrees
   * @property {function(string, string): void} moveTabToLeaf
   * @property {function(string, string, number): void} moveTabToLeafAtIndex
   * @property {function(string, DropZone, string): void} splitLeafWithTab
   * @property {function(string, DropZone, string): void} splitLeafWithPanel
   * @property {function(string, string): void} placePanelInLeaf
   * @property {function(string, string, number): void} reorderTabInLeaf
   * @property {function(string, string): void} movePanelToDock
   * @property {function(string): void} detachTab
   * @property {function(string): void} detachPanelView
   * @property {function(string): void} activateTab
   * @property {function(string): void} activatePanel
   * @property {function(string|null|undefined): string} resolvePanelTarget
   * @property {function(string): string} getPanelTitle
   * @property {function(*): string} getTabTitle
   * @property {function(): void} clearPanelDropTargets
   * @property {function(string): void} setPanelDropTarget
   * @property {function(number, number, number): boolean} isPointOutsideWorkspaceBounds
   * @property {function(): void} notifyActiveBoardChanged
   * @property {function(): void} persist
   */

  /** @type {TabDragControllerDeps|null} */
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

  /**
   * @param {TabDragControllerDeps} setupDeps
   * @returns {void}
   */
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

  /**
   * @param {Element} tabsetEl
   * @param {{clientX: number, clientY: number}} event
   * @returns {DropZone}
   */
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

  /**
   * @returns {void}
   */
  function clearDropZones() {
    if (!deps) return;
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

  /**
   * @param {Element} tabsEl
   * @param {number} clientX
   * @returns {number}
   */
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

  /**
   * @param {Element|null} tabsEl
   * @param {number} index
   * @returns {void}
   */
  function setTabInsertIndicator(tabsEl, index) {
    clearTabInsertIndicator();
    if (!tabsEl || index < 0 || !deps) return;
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

  /**
   * @returns {void}
   */
  function clearTabInsertIndicator() {
    if (deps) deps.state.dragHoverTabIndex = -1;
    var markers = document.querySelectorAll('.ws-tab-insert-marker');
    for (var i = 0; i < markers.length; i++) {
      var node = markers[i];
      if (node.parentNode) node.parentNode.removeChild(node);
    }
  }

  /**
   * @param {boolean} enabled
   * @returns {void}
   */
  function setTabDragModeEnabled(enabled) {
    if (!deps) return;
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

  /**
   * @param {string} tabId
   * @returns {HTMLElement|null}
   */
  function createTabDragGhost(tabId) {
    if (!deps) return null;
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

  /**
   * @param {string} panelId
   * @returns {HTMLElement|null}
   */
  function createPanelDragGhost(panelId) {
    if (!deps) return null;
    var ghost = document.createElement('div');
    ghost.className = 'workspace-shell-tab-ghost';
    ghost.textContent = deps.getPanelTitle(panelId);
    document.body.appendChild(ghost);
    return ghost;
  }

  /**
   * @param {HTMLElement|null} ghost
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  function positionDragGhost(ghost, x, y) {
    if (!ghost) return;
    ghost.style.left = Math.round(x) + 'px';
    ghost.style.top = Math.round(y) + 'px';
  }

  /**
   * @param {HTMLElement|null} ghost
   * @returns {void}
   */
  function destroyDragGhost(ghost) {
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
  }

  /**
   * @param {string} leafId
   * @param {DropZone|''} zone
   * @returns {void}
   */
  function setDropZoneHighlight(leafId, zone) {
    if (!deps) return;
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

  /**
   * @param {PointerEvent} event
   * @returns {void}
   */
  function handleTabPointerMove(event) {
    if (!deps) return;
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

    var target = /** @type {Element|null} */ (document.elementFromPoint(event.clientX, event.clientY));

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
      setDropZoneHighlight(
        zoneEl.getAttribute('data-ws-drop-leaf') || '',
        /** @type {DropZone} */ (zoneEl.getAttribute('data-ws-drop-zone') || '')
      );
      return;
    }
    if (tabsetEl2) {
      deps.clearPanelDropTargets();
      setDropZoneHighlight(tabsetEl2.getAttribute('data-node-id') || '', getDropZoneForEvent(tabsetEl2, event));
      return;
    }
    var dockZoneEl = target ? target.closest('[data-ws-panel-drop-dock]') : null;
    if (dockZoneEl) {
      deps.setPanelDropTarget(dockZoneEl.getAttribute('data-ws-panel-drop-dock') || '');
      return;
    }
    deps.clearPanelDropTargets();
    clearDropZones();
  }

  /**
   * @param {PointerEvent} event
   * @returns {void}
   */
  function finishTabPointerDrag(event) {
    if (!deps) return;
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

      if (zone === /** @type {DropZone} */ ('tab-reorder') && dropTabIndex >= 0) {
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
        else deps.splitLeafWithPanel(leafId, /** @type {DropZone} */ (zone), panelId);
      } else if (tabId) {
        if (zone === 'center') deps.moveTabToLeaf(tabId, leafId);
        else deps.splitLeafWithTab(leafId, /** @type {DropZone} */ (zone), tabId);
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

  /**
   * @param {Element} sourceEl
   * @param {string} tabId
   * @param {string} panelId
   * @param {PointerEvent} event
   * @returns {void}
   */
  function startPointerDrag(sourceEl, tabId, panelId, event) {
    if (!deps) return;
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

  /**
   * @param {PointerEvent} event
   * @returns {void}
   */
  function handlePointerDown(event) {
    if (event.button !== 0 || !deps) return;
    var state = deps.state;
    var eventTarget = /** @type {Element} */ (event.target);

    // Panel drag-handle (e.g. dock-strip handle): start unified drag.
    var panelHandleEl = eventTarget.closest('[data-ws-panel-drag-handle]');
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
    var panelTabEl = eventTarget.closest('.ws-view-tab[data-ws-panel-id]');
    if (panelTabEl && !eventTarget.closest('[data-ws-action="close-panel"]')) {
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
    var panelWindowEl = eventTarget.closest('.workspace-shell-panel-window[data-panel-id]');
    if (panelWindowEl) {
      var windowPanelId = deps.resolvePanelTarget(panelWindowEl.getAttribute('data-panel-id'));
      if (windowPanelId) {
        state.activePanelId = windowPanelId;
        deps.persist();
      }
    }
    var tabEl = eventTarget.closest('.ws-view-tab[data-ws-tab-id]') ||
                eventTarget.closest('.ws-view-drag[data-ws-tab-id]');
    if (tabEl && !eventTarget.closest('[data-ws-action="close-tab"]')) {
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
    var tabset = eventTarget.closest('.workspace-shell-tabset');
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
