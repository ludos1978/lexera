/**
 * SidebarResize — handles sidebar width and section (hierarchy/dashboard) resize.
 *
 * Dependencies are injected via init() so this module does not reach into app.js globals.
 * Uses the global getEl* cached element getters from loggingSystem.js.
 */
var LexeraSidebarResize = (function () {
  'use strict';

  var Settings = typeof LexeraSettings !== 'undefined' ? LexeraSettings : null;

  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════

  var sidebarSplitRatio = Settings.getForWindow('sidebarSplitRatio');
  var sidebarWidth = Settings.getForWindow('sidebarWidth');

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
      // Mark layout-drag state so observers, CSS content-visibility and
      // transitions can suppress expensive work until pointerup.
      if (document && document.body) document.body.classList.add('is-dragging-layout');
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
        if (document && document.body) document.body.classList.remove('is-dragging-layout');
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

  function requestUiFrame(callback) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
    return setTimeout(callback, 16);
  }

  function cancelUiFrame(handle) {
    if (!handle) return;
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(handle);
      return;
    }
    clearTimeout(handle);
  }

  function measureSidebarSectionLayoutMetrics() {
    var sidebarEl = getElSidebar();
    var boardListEl = getElBoardList();
    var dashboardEl = getElDashboardRoot();
    var dividerEl = getElSidebarDashboardDivider();
    if (!sidebarEl || !boardListEl || !dashboardEl || dashboardEl.classList.contains('hidden')) return null;

    var sidebarHeight = sidebarEl.clientHeight || 0;
    var headerHeight = getElSidebarHeader() ? getElSidebarHeader().offsetHeight : 0;
    var dividerHeight = dividerEl ? (dividerEl.offsetHeight || 8) : 0;
    var available = sidebarHeight - headerHeight - dividerHeight;
    if (available <= 0) return null;

    var styles = window.getComputedStyle(sidebarEl);
    var hierarchyMin = parseFloat(styles.getPropertyValue('--sidebar-hierarchy-min')) || 140;
    var dashboardMin = parseFloat(styles.getPropertyValue('--sidebar-dashboard-min')) || 180;
    var minSum = hierarchyMin + dashboardMin;
    if (available < minSum) {
      var scaledHierarchyMin = Math.max(80, Math.floor((hierarchyMin / minSum) * available));
      hierarchyMin = scaledHierarchyMin;
      dashboardMin = Math.max(140, available - scaledHierarchyMin);
    }

    return {
      boardListEl: boardListEl,
      dashboardEl: dashboardEl,
      available: available,
      hierarchyMin: hierarchyMin,
      dashboardMin: dashboardMin
    };
  }

  function writeSidebarSectionLayout(metrics, rawRatio) {
    if (!metrics || !metrics.boardListEl) return;
    var ratio = normalizeSidebarSplitRatio(rawRatio);
    var boardRatio = Math.max(0.1, Math.min(0.9, ratio));
    var sidebar = metrics.boardListEl.closest('.sidebar');
    if (sidebar) {
      sidebar.style.setProperty('--sidebar-board-ratio', boardRatio);
      sidebar.style.setProperty('--sidebar-dash-ratio', 1 - boardRatio);
    }
  }

  function scheduleSidebarDragLayout(ctx, writer) {
    if (!ctx) return;
    ctx.pendingLayoutWriter = writer;
    if (ctx.layoutFrameId) return;
    ctx.layoutFrameId = requestUiFrame(function () {
      ctx.layoutFrameId = 0;
      var pendingWriter = ctx.pendingLayoutWriter;
      ctx.pendingLayoutWriter = null;
      if (pendingWriter) pendingWriter();
    });
  }

  function flushSidebarDragLayout(ctx) {
    if (!ctx) return;
    if (ctx.layoutFrameId) {
      cancelUiFrame(ctx.layoutFrameId);
      ctx.layoutFrameId = 0;
    }
    var pendingWriter = ctx.pendingLayoutWriter;
    ctx.pendingLayoutWriter = null;
    if (pendingWriter) pendingWriter();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Section layout (hierarchy / dashboard split)
  // ═══════════════════════════════════════════════════════════════════════════

  function applySidebarSectionLayout(options) {
    options = options || {};
    if (!getElSidebar() || !getElBoardList()) return;
    if (_isWorkspaceShellEnabled()) {
      if (getElSidebarDashboardDivider()) getElSidebarDashboardDivider().classList.add('hidden');
      return;
    }
    var dashboardHidden = !getElDashboardRoot() || getElDashboardRoot().classList.contains('hidden');

    if (dashboardHidden) {
      if (getElSidebarDashboardDivider()) getElSidebarDashboardDivider().classList.add('hidden');
      return;
    }

    if (getElSidebarDashboardDivider()) getElSidebarDashboardDivider().classList.remove('hidden');
    sidebarSplitRatio = normalizeSidebarSplitRatio(sidebarSplitRatio);
    var metrics = options.metrics || measureSidebarSectionLayoutMetrics();
    if (!metrics) return;
    writeSidebarSectionLayout(metrics, options.ratio != null ? options.ratio : sidebarSplitRatio);
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
          trackSize: Math.max(1, trackSize),
          layoutMetrics: measureSidebarSectionLayoutMetrics(),
          pendingRatio: normalizeSidebarSplitRatio(sidebarSplitRatio),
          layoutFrameId: 0,
          pendingLayoutWriter: null
        };
      },
      onMove: function (ev, ctx) {
        ctx.pendingRatio = normalizeSidebarSplitRatio((ev.clientY - ctx.trackStart) / ctx.trackSize);
        sidebarSplitRatio = ctx.pendingRatio;
        scheduleSidebarDragLayout(ctx, function () {
          if (ctx.layoutMetrics) writeSidebarSectionLayout(ctx.layoutMetrics, ctx.pendingRatio);
          else applySidebarSectionLayout({ ratio: ctx.pendingRatio });
        });
      },
      onEnd: function (ev, ctx) {
        flushSidebarDragLayout(ctx);
        getElSidebar().classList.remove('resizing-sections');
        Settings.setForWindow('sidebarSplitRatio', normalizeSidebarSplitRatio(sidebarSplitRatio));
        applySidebarSectionLayout();
      },
      onDoubleClick: function () {
        sidebarSplitRatio = 0.5;
        Settings.setForWindow('sidebarSplitRatio', 0.5);
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
        return {
          left: sidebarRect.left,
          layoutMetrics: measureSidebarSectionLayoutMetrics(),
          pendingWidth: sidebarWidth,
          layoutFrameId: 0,
          pendingLayoutWriter: null
        };
      },
      onMove: function (ev, ctx) {
        var newWidth = ev.clientX - ctx.left;
        if (Math.abs(newWidth - SIDEBAR_DEFAULT) < SNAP_THRESHOLD) newWidth = SIDEBAR_DEFAULT;
        newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, newWidth));
        ctx.pendingWidth = newWidth;
        sidebarWidth = newWidth;
        scheduleSidebarDragLayout(ctx, function () {
          document.documentElement.style.setProperty('--sidebar-width', ctx.pendingWidth + 'px');
          if (ctx.layoutMetrics) writeSidebarSectionLayout(ctx.layoutMetrics, sidebarSplitRatio);
        });
      },
      onEnd: function (ev, ctx) {
        flushSidebarDragLayout(ctx);
        getElLayout().classList.remove('resizing-sidebar-width');
        Settings.setForWindow('sidebarWidth', sidebarWidth);
        applySidebarSectionLayout();
      },
      onDoubleClick: function () {
        sidebarWidth = SIDEBAR_DEFAULT;
        document.documentElement.style.setProperty('--sidebar-width', SIDEBAR_DEFAULT + 'px');
        Settings.setForWindow('sidebarWidth', SIDEBAR_DEFAULT);
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
