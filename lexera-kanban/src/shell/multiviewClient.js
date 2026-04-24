// Multiview client — thin JS wrapper around the Rust IPC commands
// added in Stage 2 (webview_mgr + drag_coordinator).
//
// This file is loaded by index.html but is INERT until a per-view
// sub-app explicitly opts into the multiview path. Loading it costs
// nothing at runtime; it just exposes window.LexeraMultiview for use
// by future view migrations (Stage 4).
//
// IPC contract is documented in TODOs-lexera-multiview.md
// "Architectural rules". The most important rule: when listening for
// drag / view events from the Rust side, ALWAYS use
// `getCurrentWebview().listen()` — the global `listen()` from
// `@tauri-apps/api/event` defaults to EventTarget::Any and will
// receive every event regardless of intended target.

(function () {
  'use strict';

  function tauri() {
    if (typeof window === 'undefined' || !window.__TAURI__) return null;
    return window.__TAURI__;
  }

  function invoke(cmd, args) {
    var t = tauri();
    if (!t || !t.core || typeof t.core.invoke !== 'function') {
      return Promise.reject(new Error('Tauri IPC unavailable'));
    }
    return t.core.invoke(cmd, args || {});
  }

  function getCurrentWebview() {
    var t = tauri();
    if (!t || !t.webview || typeof t.webview.getCurrentWebview !== 'function') return null;
    try { return t.webview.getCurrentWebview(); } catch (_) { return null; }
  }

  // ── Webview lifecycle ──────────────────────────────────────────

  function spawn(opts) {
    return invoke('multiview_spawn', {
      req: {
        label: String(opts.label || ''),
        url: String(opts.url || ''),
        x: Number(opts.x) || 0,
        y: Number(opts.y) || 0,
        width: Number(opts.width) || 0,
        height: Number(opts.height) || 0,
        parent_window: opts.parentWindow || null
      }
    });
  }

  function destroy(label) {
    return invoke('multiview_destroy', { label: String(label || '') });
  }

  function setGeometry(updates) {
    if (!Array.isArray(updates)) return Promise.reject(new Error('updates must be an array'));
    return invoke('multiview_set_geometry', {
      updates: updates.map(function (u) {
        return {
          label: String(u.label || ''),
          x: Number(u.x) || 0,
          y: Number(u.y) || 0,
          width: Number(u.width) || 0,
          height: Number(u.height) || 0
        };
      })
    });
  }

  function listWebviews() {
    return invoke('multiview_list', {});
  }

  // ── Drag coordinator ──────────────────────────────────────────

  function dragStart(source, payload) {
    return invoke('drag_start', {
      payload: { source: String(source || ''), payload: payload }
    });
  }

  function dragPointerMove(x, y) {
    return invoke('drag_pointer_move', { pos: { x: Number(x), y: Number(y) } });
  }

  function dragPointerUp(x, y) {
    return invoke('drag_pointer_up', { pos: { x: Number(x), y: Number(y) } });
  }

  function dragCancel() {
    return invoke('drag_cancel', {});
  }

  function dropAck(accepted) {
    return invoke('drop_ack', { ack: { accepted: !!accepted } });
  }

  // ── Scoped event listener ─────────────────────────────────────
  //
  // Scopes a listener to the CURRENT webview only. Events emitted via
  // Rust `app.emit_to(label, ...)` will fire here only when this
  // webview's label matches. Use this for: drag-enter / drag-over /
  // drag-leave / drop / drag-complete / drag-cancelled — all of which
  // are routed to specific targets.
  //
  // For events emitted via `app.emit(...)` (broadcast to all), the
  // global @tauri-apps/api/event `listen()` is fine because the event
  // has no specific target.
  function listen(eventName, handler) {
    var wv = getCurrentWebview();
    if (!wv || typeof wv.listen !== 'function') {
      return Promise.reject(new Error('current webview unavailable'));
    }
    return wv.listen(eventName, handler);
  }

  function getMyLabel() {
    var wv = getCurrentWebview();
    return wv ? wv.label : null;
  }

  // ── Log broadcasting bridge ───────────────────────────────────
  //
  // Wrap the existing global lexeraLog/lexeraLogWithTarget so that
  // every log entry produced in the main webview is also broadcast
  // via Tauri to any per-view sub-apps that subscribed to
  // 'log-message'. The original behavior is preserved — this is
  // purely additive. Wrap is idempotent (only happens once even if
  // multiviewClient.js loads twice).
  function broadcastLog(level, source, message) {
    invoke('log_broadcast', {
      entry: {
        level: String(level || 'info'),
        source: String(source || 'frontend'),
        message: String(message == null ? '' : message),
        timestamp_ms: Date.now()
      }
    }).catch(function () { /* best effort — main log is unaffected */ });
  }

  function wrapLexeraLog() {
    if (typeof window === 'undefined') return;
    if (window.__lexeraMultiviewLogWrapped) return;

    var origLexeraLog = window.lexeraLog;
    if (typeof origLexeraLog === 'function') {
      window.lexeraLog = function (level, message) {
        try { broadcastLog(level, 'frontend', message); } catch (_) {}
        return origLexeraLog.apply(this, arguments);
      };
    }

    var origWithTarget = window.lexeraLogWithTarget;
    if (typeof origWithTarget === 'function') {
      window.lexeraLogWithTarget = function (level, target, message) {
        try { broadcastLog(level, target, message); } catch (_) {}
        return origWithTarget.apply(this, arguments);
      };
    }

    window.__lexeraMultiviewLogWrapped = true;
  }

  // Wrap as soon as loggingSystem.js has finished defining the globals.
  // loggingSystem.js loads later in index.html (no dependency); we wait
  // for DOMContentLoaded which fires after all sync scripts have run.
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wrapLexeraLog, { once: true });
    } else {
      wrapLexeraLog();
    }
  }

  // Demo: spawn 3 child webviews overlaid on the running kanban.
  // Each loads multiview-demo.html. Useful for proving end-to-end
  // wiring works in production. Run from DevTools console:
  //   await LexeraMultiview.demo()
  // Then verify in Activity Monitor that 3 new WebContent processes
  // appeared. Call LexeraMultiview.demoStop() to remove them.
  function demo() {
    var labels = ['demo-a', 'demo-b', 'demo-c'];
    var widthEach = 400;
    var heightEach = 400;
    var startX = 100;
    var startY = 200;
    var promises = labels.map(function (label, i) {
      return spawn({
        label: label,
        url: 'multiview-demo.html',
        x: startX + i * (widthEach + 10),
        y: startY,
        width: widthEach,
        height: heightEach
      });
    });
    return Promise.all(promises).then(function () {
      console.log('[multiview-demo] spawned:', labels.join(', '));
      console.log('[multiview-demo] check Activity Monitor for new WebContent processes');
      console.log('[multiview-demo] cleanup: await LexeraMultiview.demoStop()');
      return labels;
    });
  }

  function demoStop() {
    var labels = ['demo-a', 'demo-b', 'demo-c'];
    return Promise.all(labels.map(function (l) {
      return destroy(l).catch(function () { /* ignore */ });
    })).then(function () {
      console.log('[multiview-demo] destroyed all demo webviews');
    });
  }

  // ── Side-panel positioning ────────────────────────────────────
  //
  // Treat a sub-app webview like a docked side panel: anchor to one
  // edge of the main window's client area, full height (minus a small
  // top inset for the toolbar). Re-position on window resize so the
  // panel stays attached.
  //
  // Sides supported: 'right' | 'left' | 'bottom' | 'top'
  // Top inset defaults to ~32px to clear a toolbar row.

  var sidePanelSubscriptions = {};

  function getMainWindowClientRect() {
    // Main webview's body (this script runs in the main webview)
    if (typeof document === 'undefined' || !document.body) return null;
    var r = document.body.getBoundingClientRect();
    return { x: 0, y: 0, width: r.width, height: r.height };
  }

  function computeSlotRect(side, size, opts) {
    var topInset = opts && opts.topInset != null ? opts.topInset : 32;
    var rect = getMainWindowClientRect();
    if (!rect) return null;
    if (side === 'right') {
      return { x: rect.width - size, y: topInset, width: size, height: rect.height - topInset };
    }
    if (side === 'left') {
      return { x: 0, y: topInset, width: size, height: rect.height - topInset };
    }
    if (side === 'bottom') {
      return { x: 0, y: rect.height - size, width: rect.width, height: size };
    }
    if (side === 'top') {
      return { x: 0, y: topInset, width: rect.width, height: size };
    }
    return null;
  }

  function openAsSidePanel(opts) {
    var label = String(opts.label || 'side-panel');
    var url = String(opts.url || '');
    var side = opts.side || 'right';
    var size = opts.size != null ? opts.size : (side === 'bottom' || side === 'top' ? 250 : 380);
    var slot = computeSlotRect(side, size, opts);
    if (!slot) return Promise.reject(new Error('Could not compute slot rect'));

    var promise = spawn({
      label: label, url: url,
      x: slot.x, y: slot.y, width: slot.width, height: slot.height
    });

    // Auto-reposition on main window resize.
    var resizeHandler = function () {
      var newSlot = computeSlotRect(side, size, opts);
      if (!newSlot) return;
      setGeometry([{ label: label, x: newSlot.x, y: newSlot.y, width: newSlot.width, height: newSlot.height }])
        .catch(function () { /* webview may have been destroyed */ });
    };
    window.addEventListener('resize', resizeHandler);
    sidePanelSubscriptions[label] = resizeHandler;

    return promise;
  }

  function closeSidePanel(label) {
    var handler = sidePanelSubscriptions[label];
    if (handler) {
      window.removeEventListener('resize', handler);
      delete sidePanelSubscriptions[label];
    }
    return destroy(label).catch(function () { /* ignore */ });
  }

  // ── Log view sub-app ──────────────────────────────────────────
  //
  // Open the Stage 4 log sub-app as a child webview overlaid on the
  // running kanban. Subscribes to 'log-message' events broadcast by
  // the Rust log_broadcast command; every lexeraLog() call in the
  // main webview is mirrored here.
  //
  // Run from DevTools console:
  //   await LexeraMultiview.openLogView()                    // floating
  //   await LexeraMultiview.openLogView({ side: 'right' })   // docked
  //   await LexeraMultiview.openLogView({ side: 'bottom' })
  //   await LexeraMultiview.closeLogView()
  function openLogView(opts) {
    opts = opts || {};
    if (opts.side) {
      return openAsSidePanel({
        label: 'log-view',
        url: 'views/log/index.html',
        side: opts.side, size: opts.size, topInset: opts.topInset
      }).then(function () {
        console.log('[log-view] opened as ' + opts.side + ' side panel');
      });
    }
    return spawn({
      label: 'log-view',
      url: 'views/log/index.html',
      x: opts.x != null ? opts.x : 100,
      y: opts.y != null ? opts.y : 100,
      width: opts.width != null ? opts.width : 800,
      height: opts.height != null ? opts.height : 500
    }).then(function () {
      console.log('[log-view] opened — every lexeraLog() will appear here');
      console.log('[log-view] cleanup: await LexeraMultiview.closeLogView()');
    });
  }

  function closeLogView() {
    return closeSidePanel('log-view');
  }

  // ── Inspector view sub-app ────────────────────────────────────
  //
  // Diagnostic sub-app showing:
  //   - process info for the inspector's webview
  //   - live list of all child webviews with destroy buttons
  //   - tail of recent log-message events
  //
  // Useful during multiview development. Run from console:
  //   await LexeraMultiview.openInspector()
  //   await LexeraMultiview.closeInspector()
  function openInspector(opts) {
    opts = opts || {};
    if (opts.side) {
      return openAsSidePanel({
        label: 'inspector',
        url: 'views/inspector/index.html',
        side: opts.side, size: opts.size, topInset: opts.topInset
      }).then(function () {
        console.log('[inspector] opened as ' + opts.side + ' side panel');
      });
    }
    return spawn({
      label: 'inspector',
      url: 'views/inspector/index.html',
      x: opts.x != null ? opts.x : 100,
      y: opts.y != null ? opts.y : 100,
      width: opts.width != null ? opts.width : 700,
      height: opts.height != null ? opts.height : 600
    }).then(function () {
      console.log('[inspector] opened');
    });
  }
  function closeInspector() {
    return closeSidePanel('inspector');
  }

  // ── Theme bridging ────────────────────────────────────────────
  //
  // The main kanban applies a palette as CSS custom properties on
  // :root via lexera-shared/themes.js. Per-view sub-apps don't run
  // that code; they need the same palette so their UI matches.
  //
  // Broadcast a snapshot whenever the theme might have changed.
  // Sub-apps subscribe via 'theme-snapshot' and apply to their root.

  var THEME_VAR_NAMES = [
    '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover', '--bg-active',
    '--border', '--font-color-mode', '--text-primary', '--text-muted',
    '--accent', '--accent-hover', '--success', '--error',
    '--card-bg', '--card-border', '--card-checked',
    '--scrollbar-thumb', '--scrollbar-thumb-hover', '--scrollbar-track',
    '--btn-bg', '--btn-bg-hover', '--btn-fg',
    '--input-bg', '--input-border',
    '--font-size-base', '--font-size-s', '--font-size-l'
  ];

  function snapshotTheme() {
    if (typeof document === 'undefined' || !document.documentElement) return null;
    var cs = getComputedStyle(document.documentElement);
    var palette = {};
    for (var i = 0; i < THEME_VAR_NAMES.length; i++) {
      var v = cs.getPropertyValue(THEME_VAR_NAMES[i]);
      if (v) palette[THEME_VAR_NAMES[i]] = v.trim();
    }
    var isDark = (document.documentElement.style.colorScheme === 'dark') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    return { palette: palette, color_scheme: isDark ? 'dark' : 'light' };
  }

  function broadcastTheme() {
    var snap = snapshotTheme();
    if (!snap) return Promise.resolve();
    return invoke('multiview_broadcast', {
      event: 'theme-snapshot',
      payload: snap
    }).catch(function () { /* ignore */ });
  }

  // Apply a received palette to this webview's :root. Used by sub-apps.
  function applyThemeSnapshot(snapshot) {
    if (!snapshot || !snapshot.palette) return;
    var root = document.documentElement;
    var keys = Object.keys(snapshot.palette);
    for (var i = 0; i < keys.length; i++) {
      root.style.setProperty(keys[i], snapshot.palette[keys[i]]);
    }
    if (snapshot.color_scheme) root.style.colorScheme = snapshot.color_scheme;
  }

  // Auto-broadcast on init (after main theme loads) and on prefers-
  // color-scheme changes. Sub-apps will request a snapshot on their
  // own startup via a 'theme-request' event handled below.
  function initThemeBridge() {
    // Initial broadcast after theme has been applied.
    setTimeout(broadcastTheme, 200);
    // Re-broadcast on color scheme changes.
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var handler = function () { setTimeout(broadcastTheme, 50); };
      if (mq.addEventListener) mq.addEventListener('change', handler);
      else if (mq.addListener) mq.addListener(handler);
    }
    // Re-broadcast on demand when a sub-app requests it.
    var t = tauri();
    if (t && t.event && typeof t.event.listen === 'function') {
      t.event.listen('theme-request', function () { broadcastTheme(); });
    }
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initThemeBridge, { once: true });
    } else {
      initThemeBridge();
    }
  }

  window.LexeraMultiview = {
    // Webview lifecycle
    spawn: spawn,
    destroy: destroy,
    setGeometry: setGeometry,
    listWebviews: listWebviews,
    // Drag coordinator
    dragStart: dragStart,
    dragPointerMove: dragPointerMove,
    dragPointerUp: dragPointerUp,
    dragCancel: dragCancel,
    dropAck: dropAck,
    // Scoped event listener
    listen: listen,
    getMyLabel: getMyLabel,
    // Underlying invoke for future commands
    invoke: invoke,
    // Demo: prove the architecture works in production
    demo: demo,
    demoStop: demoStop,
    // Log view sub-app (Stage 4 — first real per-view migration)
    openLogView: openLogView,
    closeLogView: closeLogView,
    // Inspector sub-app (Stage 4 — diagnostic)
    openInspector: openInspector,
    closeInspector: closeInspector,
    // Internal log broadcasting helper (also called by the wrapper)
    broadcastLog: broadcastLog,
    // Theme bridge — sub-apps use applyThemeSnapshot in their JS,
    // main app calls broadcastTheme to push current palette.
    broadcastTheme: broadcastTheme,
    snapshotTheme: snapshotTheme,
    applyThemeSnapshot: applyThemeSnapshot,
    // Side-panel positioning helpers
    openAsSidePanel: openAsSidePanel,
    closeSidePanel: closeSidePanel
  };
})();
