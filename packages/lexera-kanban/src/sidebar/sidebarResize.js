/**
 * SidebarResize — handles sidebar width and section (hierarchy/dashboard) resize.
 *
 * Dependencies are injected via init() so this module does not reach into app.js globals.
 * Uses the global getEl* cached element getters from loggingSystem.js.
 */
var LexeraSidebarResize = (function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════

  var sidebarSplitRatio = parseFloat(localStorage.getItem('lexera-sidebar-split-ratio') || '0.58');
  var sidebarWidth = parseInt(localStorage.getItem('lexera-sidebar-width'), 10) || 0;

  // Injected via init()
  var _isWorkspaceShellEnabled = function () { return false; };

  // ═══════════════════════════════════════════════════════════════════════════
  // Utility: normalizeRatio
  // ═══════════════════════════════════════════════════════════════════════════

  function normalizeRatio(rawRatio, options) {
    options = options || {};
    var ratio = Number(rawRatio);
    var fallback = isFinite(options.fallback) ? options.fallback : 0.5;
    var min = isFinite(options.min) ? options.min : 0.2;
    var max = isFinite(options.max) ? options.max : 0.8;
    var snap = isFinite(options.snap) ? options.snap : 0.5;
    var snapThreshold = isFinite(options.snapThreshold) ? options.snapThreshold : 0.04;

    if (!isFinite(ratio)) ratio = fallback;
    if (ratio < min) ratio = min;
    if (ratio > max) ratio = max;
    if (Math.abs(ratio - snap) <= snapThreshold) ratio = snap;
    return ratio;
  }

  function normalizeSidebarSplitRatio(rawRatio) {
    return normalizeRatio(rawRatio, {
      fallback: 0.58,
      min: 0.2,
      max: 0.8,
      snap: 0.5,
      snapThreshold: 0.03
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Pointer-based divider drag
  // ═══════════════════════════════════════════════════════════════════════════

  function bindPointerDividerDrag(divider, handlers) {
    if (!divider || !handlers) return;
    divider.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (handlers.canStart && !handlers.canStart(e)) return;
      e.preventDefault();

      var pointerId = e.pointerId;
      var finished = false;
      var ctx = {};
      if (handlers.onStart) {
        var startCtx = handlers.onStart(e);
        if (startCtx && typeof startCtx === 'object') ctx = startCtx;
      }

      function onMove(ev) {
        if (ev.pointerId !== pointerId) return;
        if (handlers.onMove) handlers.onMove(ev, ctx);
      }

      function finish(ev) {
        if (finished) return;
        if (ev && ev.pointerId != null && ev.pointerId !== pointerId) return;
        finished = true;
        divider.removeEventListener('pointermove', onMove, true);
        divider.removeEventListener('pointerup', finish, true);
        divider.removeEventListener('pointercancel', finish, true);
        divider.removeEventListener('lostpointercapture', finish, true);
        try {
          if (divider.hasPointerCapture && divider.hasPointerCapture(pointerId)) {
            divider.releasePointerCapture(pointerId);
          }
        } catch (err) {
          // no-op
        }
        if (handlers.onEnd) handlers.onEnd(ev, ctx);
      }

      try {
        divider.setPointerCapture(pointerId);
      } catch (err) {
        // no-op
      }

      onMove(e);
      divider.addEventListener('pointermove', onMove, true);
      divider.addEventListener('pointerup', finish, true);
      divider.addEventListener('pointercancel', finish, true);
      divider.addEventListener('lostpointercapture', finish, true);
    });

    if (handlers.onDoubleClick) {
      divider.addEventListener('dblclick', handlers.onDoubleClick);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Section layout (hierarchy / dashboard split)
  // ═══════════════════════════════════════════════════════════════════════════

  function applySidebarSectionLayout() {
    if (!getElSidebar() || !getElBoardList()) return;
    if (_isWorkspaceShellEnabled()) {
      if (getElSidebarDashboardDivider()) getElSidebarDashboardDivider().classList.add('hidden');
      getElBoardList().style.flex = '1 1 auto';
      getElBoardList().style.height = '';
      if (getElDashboardRoot()) {
        getElDashboardRoot().style.flex = '1 1 auto';
        getElDashboardRoot().style.height = '';
      }
      return;
    }
    var dashboardHidden = !getElDashboardRoot() || getElDashboardRoot().classList.contains('hidden');

    if (dashboardHidden) {
      if (getElSidebarDashboardDivider()) getElSidebarDashboardDivider().classList.add('hidden');
      getElBoardList().style.flex = '1 1 auto';
      getElBoardList().style.height = '';
      if (getElDashboardRoot()) {
        getElDashboardRoot().style.flex = '';
        getElDashboardRoot().style.height = '';
      }
      return;
    }

    if (getElSidebarDashboardDivider()) getElSidebarDashboardDivider().classList.remove('hidden');
    sidebarSplitRatio = normalizeSidebarSplitRatio(sidebarSplitRatio);

    var sidebarHeight = getElSidebar().clientHeight || 0;
    var headerHeight = getElSidebarHeader() ? getElSidebarHeader().offsetHeight : 0;
    var dividerHeight = getElSidebarDashboardDivider() ? (getElSidebarDashboardDivider().offsetHeight || 8) : 0;
    var available = sidebarHeight - headerHeight - dividerHeight;
    if (available <= 0) return;

    var styles = window.getComputedStyle(getElSidebar());
    var hierarchyMin = parseFloat(styles.getPropertyValue('--sidebar-hierarchy-min')) || 140;
    var dashboardMin = parseFloat(styles.getPropertyValue('--sidebar-dashboard-min')) || 180;
    var minSum = hierarchyMin + dashboardMin;
    if (available < minSum) {
      var scaledHierarchyMin = Math.max(80, Math.floor((hierarchyMin / minSum) * available));
      hierarchyMin = scaledHierarchyMin;
      dashboardMin = Math.max(100, available - scaledHierarchyMin);
    }

    var boardHeight = Math.round(available * sidebarSplitRatio);
    var minBoard = Math.min(hierarchyMin, Math.max(0, available - dashboardMin));
    var maxBoard = Math.max(minBoard, available - dashboardMin);
    boardHeight = Math.max(minBoard, Math.min(maxBoard, boardHeight));
    var dashboardHeight = Math.max(0, available - boardHeight);

    getElBoardList().style.flex = '0 0 ' + boardHeight + 'px';
    getElBoardList().style.height = boardHeight + 'px';
    if (getElDashboardRoot()) {
      getElDashboardRoot().style.flex = '0 0 ' + dashboardHeight + 'px';
      getElDashboardRoot().style.height = dashboardHeight + 'px';
    }
  }

  function setupSidebarSectionResize() {
    if (_isWorkspaceShellEnabled()) {
      applySidebarSectionLayout();
      return;
    }
    if (!getElSidebar() || !getElSidebarDashboardDivider()) return;
    sidebarSplitRatio = normalizeSidebarSplitRatio(sidebarSplitRatio);
    applySidebarSectionLayout();
    window.addEventListener('resize', applySidebarSectionLayout);

    bindPointerDividerDrag(getElSidebarDashboardDivider(), {
      canStart: function () {
        return !!getElDashboardRoot() && !getElDashboardRoot().classList.contains('hidden');
      },
      onStart: function () {
        var sidebarRect = getElSidebar().getBoundingClientRect();
        var headerBottom = getElSidebarHeader() ? getElSidebarHeader().getBoundingClientRect().bottom : sidebarRect.top;
        var dividerHeight = getElSidebarDashboardDivider().offsetHeight || 8;
        var trackStart = headerBottom;
        var trackSize = sidebarRect.height - (headerBottom - sidebarRect.top) - dividerHeight;
        getElSidebar().classList.add('resizing-sections');
        return {
          trackStart: trackStart,
          trackSize: Math.max(1, trackSize)
        };
      },
      onMove: function (ev, ctx) {
        var next = (ev.clientY - ctx.trackStart) / ctx.trackSize;
        sidebarSplitRatio = normalizeSidebarSplitRatio(next);
        applySidebarSectionLayout();
      },
      onEnd: function () {
        getElSidebar().classList.remove('resizing-sections');
        localStorage.setItem('lexera-sidebar-split-ratio', String(normalizeSidebarSplitRatio(sidebarSplitRatio)));
        applySidebarSectionLayout();
      },
      onDoubleClick: function () {
        sidebarSplitRatio = 0.5;
        localStorage.setItem('lexera-sidebar-split-ratio', '0.5');
        applySidebarSectionLayout();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Sidebar width resize
  // ═══════════════════════════════════════════════════════════════════════════

  function applySidebarWidth() {
    if (!getElSidebar()) return;
    if (_isWorkspaceShellEnabled()) return;
    if (sidebarWidth > 0) {
      document.documentElement.style.setProperty('--sidebar-width', sidebarWidth + 'px');
    }
  }

  function setupSidebarWidthResize() {
    if (_isWorkspaceShellEnabled()) return;
    if (!getElSidebar() || !getElSidebarWidthDivider() || !getElLayout()) return;
    var SIDEBAR_MIN = 180;
    var SIDEBAR_MAX = 600;
    var SIDEBAR_DEFAULT = 300;
    var SNAP_THRESHOLD = 15;

    applySidebarWidth();

    bindPointerDividerDrag(getElSidebarWidthDivider(), {
      onStart: function () {
        var sidebarRect = getElSidebar().getBoundingClientRect();
        getElLayout().classList.add('resizing-sidebar-width');
        return { left: sidebarRect.left };
      },
      onMove: function (ev, ctx) {
        var newWidth = ev.clientX - ctx.left;
        if (Math.abs(newWidth - SIDEBAR_DEFAULT) < SNAP_THRESHOLD) newWidth = SIDEBAR_DEFAULT;
        newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, newWidth));
        sidebarWidth = newWidth;
        document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
        applySidebarSectionLayout();
      },
      onEnd: function () {
        getElLayout().classList.remove('resizing-sidebar-width');
        localStorage.setItem('lexera-sidebar-width', String(sidebarWidth));
        applySidebarSectionLayout();
      },
      onDoubleClick: function () {
        sidebarWidth = SIDEBAR_DEFAULT;
        document.documentElement.style.setProperty('--sidebar-width', SIDEBAR_DEFAULT + 'px');
        localStorage.setItem('lexera-sidebar-width', String(SIDEBAR_DEFAULT));
        applySidebarSectionLayout();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Init + public API
  // ═══════════════════════════════════════════════════════════════════════════

  function init(deps) {
    deps = deps || {};
    if (typeof deps.isWorkspaceShellEnabled === 'function') {
      _isWorkspaceShellEnabled = deps.isWorkspaceShellEnabled;
    }
  }

  return {
    init: init,
    setupSidebarSectionResize: setupSidebarSectionResize,
    setupSidebarWidthResize: setupSidebarWidthResize,
    applySidebarSectionLayout: applySidebarSectionLayout,
    applySidebarWidth: applySidebarWidth,
    // Exposed for tests
    normalizeRatio: normalizeRatio
  };
})();

window.LexeraSidebarResize = LexeraSidebarResize;
