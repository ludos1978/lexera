// Multiview client — browser-side transport plus shell bridges for the
// Rust IPC commands in webview_mgr + drag_coordinator.
//
// This file is part of the active multiview path in the normal desktop
// shell. It exposes window.LexeraMultiview, launches utility views,
// handles theme/catalog/focus/shortcut/modal bridges, and carries the
// embedded-board compatibility layer. Embedded mode and some tests
// still use iframe fallbacks, so transport and migration glue
// currently coexist in this file.
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

  // Per-frame coalescer for geometry updates. Multiple `pushGeomDeferred`
  // calls in the same animation frame collapse to a single IPC. The
  // last update for any given label wins. Updates identical to the
  // last-sent geometry for that label are dropped before IPC so the
  // render loop can call this freely without thrashing Rust.
  // Eliminates the N×M setGeometry storm during dock-divider drags
  // (Perf #2 in TODOs-lexera-multiview.md).
  var pendingGeometry = {};   // label → next update
  var lastSentGeometry = {};  // label → last update actually sent
  var geometryFlushScheduled = false;

  function geomEquals(a, b) {
    return !!a && !!b
      && a.x === b.x && a.y === b.y
      && a.width === b.width && a.height === b.height;
  }

  function flushPendingGeometry() {
    geometryFlushScheduled = false;
    var labels = Object.keys(pendingGeometry);
    if (labels.length === 0) return;
    var batch = [];
    for (var i = 0; i < labels.length; i++) {
      var l = labels[i];
      var u = pendingGeometry[l];
      if (geomEquals(u, lastSentGeometry[l])) continue; // no-op suppression
      batch.push(u);
      lastSentGeometry[l] = u;
    }
    pendingGeometry = {};
    if (batch.length === 0) return;
    setGeometry(batch).catch(function () { /* swallowed */ });
  }

  /**
   * Coalesce a single geometry update into the next animation frame's
   * batched IPC. Cheaper than calling `setGeometry([...])` per webview
   * during dock-divider drag because all updates collapse into one IPC,
   * and identical-to-last-sent updates are dropped before IPC.
   */
  function pushGeomDeferred(update) {
    if (!update || !update.label) return;
    pendingGeometry[update.label] = {
      label: String(update.label),
      x: Number(update.x) || 0,
      y: Number(update.y) || 0,
      width: Number(update.width) || 0,
      height: Number(update.height) || 0
    };
    if (geometryFlushScheduled) return;
    geometryFlushScheduled = true;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(flushPendingGeometry);
    } else {
      setTimeout(flushPendingGeometry, 16);
    }
  }

  function listWebviews() {
    return invoke('multiview_list', {});
  }

  /**
   * Navigate an existing child webview to a new URL via Rust's
   * `multiview_navigate` command. Used by the lifecycle pool fast-path:
   * pre-warmed webviews are repurposed without destroy+spawn, which is
   * dramatically faster (renderer process is already running).
   */
  function navigateWebview(label, url) {
    return invoke('multiview_navigate', { label: String(label || ''), url: String(url || '') });
  }

  // ── Lifecycle (Stage 8) ───────────────────────────────────────────
  //
  // LRU freshness, soft-cap eviction, and the pre-warmed webview pool
  // live in `src/shell/lifecycle.js`. Transport primitives are injected
  // so the lifecycle module is self-contained. The instance is created
  // lazily on first access so unit tests that load the IIFE without the
  // lifecycle bridge stay quiet (they don't touch lifecycle features).
  var _lifecycleInstance = null;
  function lifecycle() {
    if (_lifecycleInstance) return _lifecycleInstance;
    var factory = (typeof window !== 'undefined' && window.LexeraLifecycle) || null;
    if (!factory || typeof factory.create !== 'function') return null;
    _lifecycleInstance = factory.create({
      spawn: spawn,
      destroy: destroy,
      setGeometry: setGeometry,
      navigateWebview: navigateWebview,
      listWebviews: listWebviews,
      locationSearch: (typeof window !== 'undefined' && window.location ? window.location.search : '')
    });
    return _lifecycleInstance;
  }
  function lifecycleApi() {
    var l = lifecycle();
    if (l) return l;
    // Hard-stub so DevTools calls don't crash when the bridge file is
    // missing (e.g., test harness, partial deploy). Reads are
    // best-effort; writes are no-ops.
    return {
      configure: function () { return {}; },
      status: function () { return { config: {}, freshness: {}, pool: [] }; },
      spawn: function (opts) { return spawn(opts).then(function () { return { label: opts.label, fromPool: false }; }); },
      touch: function () {},
      evictOldestIfOverCap: function () { return Promise.resolve(null); },
      refillPool: function () { return Promise.resolve(); }
    };
  }

  // ── FPS meter (Perf #10) ──────────────────────────────────────────
  //
  // Quick FPS sampler for measuring dock-divider drag and cross-webview
  // drag performance from DevTools:
  //
  //   await LexeraMultiview.fpsMeter()           // 5-second sample
  //   await LexeraMultiview.fpsMeter(10000)      // 10-second sample
  //
  // Returns { samples, durationMs, fps, min, max, p50, p95 }.
  // Use to pin baseline numbers in prototypes/multiview/RESULTS.md.
  function fpsMeter(durationMs) {
    durationMs = Number(durationMs) || 5000;
    return new Promise(function (resolve) {
      var frames = 0;
      var frameTimes = [];
      var startMs = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      var lastMs = startMs;
      function tick(t) {
        var now = t || ((typeof performance !== 'undefined' && performance.now)
          ? performance.now() : Date.now());
        frameTimes.push(now - lastMs);
        lastMs = now;
        frames++;
        if (now - startMs < durationMs) {
          requestAnimationFrame(tick);
        } else {
          var elapsed = now - startMs;
          var sorted = frameTimes.slice().sort(function (a, b) { return a - b; });
          var p = function (q) {
            return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0;
          };
          var minF = sorted[0] || 0;
          var maxF = sorted[sorted.length - 1] || 0;
          var result = {
            samples: frames,
            durationMs: Math.round(elapsed),
            fps: +((frames / elapsed) * 1000).toFixed(1),
            minFrameMs: +minF.toFixed(2),
            maxFrameMs: +maxF.toFixed(2),
            p50FrameMs: +p(0.5).toFixed(2),
            p95FrameMs: +p(0.95).toFixed(2)
          };
          if (typeof console !== 'undefined') console.log('[fps-meter]', result);
          resolve(result);
        }
      }
      requestAnimationFrame(tick);
    });
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

  // ── Drag ghost window helpers (Stage 7) ───────────────────────
  function ghostEnsure(opts) {
    opts = opts || {};
    return invoke('drag_ghost_ensure', {
      spec: {
        url: opts.url || 'views/drag-ghost/index.html',
        width: opts.width != null ? opts.width : 220,
        height: opts.height != null ? opts.height : 60
      }
    });
  }
  function ghostMove(x, y, visible) {
    return invoke('drag_ghost_move', {
      m: { x: Number(x), y: Number(y), visible: visible == null ? null : !!visible }
    });
  }
  function ghostHide() {
    return invoke('drag_ghost_hide', {});
  }
  function ghostSetContent(html) {
    return invoke('drag_ghost_set_content', { html: String(html || '') });
  }


  // ── Request/response IPC pattern ──────────────────────────────
  //
  // Lives in `src/shell/requestBridge.js`. Created lazily on first
  // access so the bridge picks up the current tauri runtime + invoke
  // wrapper from this client. Falls back to a stub that surfaces the
  // missing-bridge condition as a clear rejection.
  var _requestBridge = null;
  function requestBridge() {
    if (_requestBridge) return _requestBridge;
    var factory = (typeof window !== 'undefined' && window.LexeraRequestBridge) || null;
    if (!factory || typeof factory.create !== 'function') return null;
    _requestBridge = factory.create({ tauri: tauri, invoke: invoke });
    return _requestBridge;
  }
  function request(targetLabel, requestEvent, payload, timeoutMs) {
    var b = requestBridge();
    if (!b) return Promise.reject(new Error('LexeraRequestBridge not loaded'));
    return b.request(targetLabel, requestEvent, payload, timeoutMs);
  }
  function handleRequest(requestEvent, handler) {
    var b = requestBridge();
    if (!b) return Promise.reject(new Error('LexeraRequestBridge not loaded'));
    return b.handleRequest(requestEvent, handler);
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

  // Gate: log wrapping only activates when at least one log
  // subscriber exists. Tests + non-multiview usage pay zero IPC
  // cost. Activated by openLogView (and by anyone calling
  // LexeraMultiview.activateLogBridge()).
  var logBridgeActive = false;
  function wrapLexeraLog() {
    if (typeof window === 'undefined') return;
    if (window.__lexeraMultiviewLogWrapped) return;

    var origLexeraLog = window.lexeraLog;
    if (typeof origLexeraLog === 'function') {
      window.lexeraLog = function (level, message) {
        if (logBridgeActive) {
          try { broadcastLog(level, 'frontend', message); } catch (_) {}
        }
        return origLexeraLog.apply(this, arguments);
      };
    }

    var origWithTarget = window.lexeraLogWithTarget;
    if (typeof origWithTarget === 'function') {
      window.lexeraLogWithTarget = function (level, target, message) {
        if (logBridgeActive) {
          try { broadcastLog(level, target, message); } catch (_) {}
        }
        return origWithTarget.apply(this, arguments);
      };
    }

    window.__lexeraMultiviewLogWrapped = true;
  }
  function activateLogBridge() { logBridgeActive = true; }
  function deactivateLogBridge() { logBridgeActive = false; }

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

  // Side-panel positioning + per-kind launchers moved to
  // shell/panelLaunchers.js (Workstream 5). The thin wrappers below
  // keep the existing LexeraMultiview public API unchanged.
  function panelLaunchers() {
    if (typeof window !== 'undefined' && window.LexeraPanelLaunchers) return window.LexeraPanelLaunchers;
    return null;
  }
  function openAsSidePanel(opts) {
    var p = panelLaunchers();
    return p ? p.openAsSidePanel(opts) : Promise.reject(new Error('LexeraPanelLaunchers not loaded'));
  }
  function closeSidePanel(label) {
    var p = panelLaunchers();
    return p ? p.closeSidePanel(label) : Promise.resolve();
  }


  // ── Log view sub-app ──────────────────────────────────────────
  //
  // Open the Stage 4 log sub-app as a child webview overlaid on the
  // running kanban. Subscribes to 'log-message' events broadcast by
  // the Rust log_broadcast command; every lexeraLog() call in the
  // main webview is mirrored here.
  //
  // Per-kind launchers moved to shell/panelLaunchers.js. Thin wrappers
  // below keep the LexeraMultiview public API unchanged for DevTools
  // console use (`await LexeraMultiview.openLogView()` etc.).
  function delegateLauncher(name) {
    return function () {
      var p = panelLaunchers();
      if (!p || typeof p[name] !== 'function') {
        return Promise.reject(new Error('LexeraPanelLaunchers not loaded'));
      }
      return p[name].apply(null, arguments);
    };
  }
  var openLogView = delegateLauncher('openLogView');
  var closeLogView = delegateLauncher('closeLogView');
  var openInspector = delegateLauncher('openInspector');
  var closeInspector = delegateLauncher('closeInspector');
  var openWorkspaces = delegateLauncher('openWorkspaces');
  var closeWorkspaces = delegateLauncher('closeWorkspaces');
  var openDashboard = delegateLauncher('openDashboard');
  var closeDashboard = delegateLauncher('closeDashboard');

  // ── Modal-as-window dialogs (Stage 6 architectural fix) ───────
  //
  // Native child webviews paint above HTML, so HTML-overlay dialogs
  // no longer suffice once we have child webviews. Instead, spawn a
  // top-level Tauri window for each modal — it composites above all
  // child webviews automatically.
  //
  // Returns Promise<boolean> for confirm dialogs. The modal HTML
  // emits 'modal-result-<label>' and self-closes.
  var modalCounter = 0;

  function confirmModal(opts) {
    opts = opts || {};
    var label = 'confirm-modal-' + (++modalCounter);
    var params = new URLSearchParams();
    params.set('label', label);
    if (opts.title) params.set('title', opts.title);
    if (opts.message) params.set('message', opts.message);
    if (opts.okText) params.set('ok', opts.okText);
    if (opts.cancelText) params.set('cancel', opts.cancelText);
    var url = 'views/modals/confirm.html?' + params.toString();
    return new Promise(function (resolve) {
      var t = tauri();
      if (!t || !t.event || typeof t.event.listen !== 'function') {
        resolve(false);
        return;
      }
      var unsubPromise = t.event.listen('modal-result-' + label, function (event) {
        unsubPromise.then(function (unsub) { try { unsub(); } catch (_) {} });
        resolve(!!(event && event.payload && event.payload.accepted));
      });
      invoke('multiview_open_modal_window', {
        spec: {
          label: label, url: url,
          title: opts.title || 'Confirm',
          width: opts.width || 380,
          height: opts.height || 180,
          center: true
        }
      }).catch(function () { resolve(false); });
    });
  }

  // promptModal: returns Promise<string|null>. null on cancel.
  function promptModal(opts) {
    opts = opts || {};
    var label = 'prompt-modal-' + (++modalCounter);
    var params = new URLSearchParams();
    params.set('label', label);
    if (opts.title) params.set('title', opts.title);
    if (opts.message) params.set('message', opts.message);
    if (opts.initial != null) params.set('initial', String(opts.initial));
    if (opts.okText) params.set('ok', opts.okText);
    if (opts.cancelText) params.set('cancel', opts.cancelText);
    var url = 'views/modals/prompt.html?' + params.toString();
    return new Promise(function (resolve) {
      var t = tauri();
      if (!t || !t.event || typeof t.event.listen !== 'function') {
        resolve(null);
        return;
      }
      var unsubPromise = t.event.listen('modal-result-' + label, function (event) {
        unsubPromise.then(function (unsub) { try { unsub(); } catch (_) {} });
        var p = event && event.payload ? event.payload : {};
        resolve(p.value == null ? null : String(p.value));
      });
      invoke('multiview_open_modal_window', {
        spec: {
          label: label, url: url,
          title: opts.title || 'Input',
          width: opts.width || 420,
          height: opts.height || 200,
          center: true
        }
      }).catch(function () { resolve(null); });
    });
  }

  // ── Theme bridging ────────────────────────────────────────────
  //
  // The main kanban applies a palette as CSS custom properties on
  // :root via lexera-shared/themes.js. Per-view sub-apps don't run
  // that code; they need the same palette so their UI matches.
  //
  // Broadcast a snapshot whenever the theme might have changed.
  // Sub-apps subscribe via 'theme-snapshot' and apply to their root.

  // Theme bridge moved to shell/themeBridge.js (Workstream 5). Local
  // bindings here keep the existing call sites working unchanged.
  function themeBridge() {
    if (typeof window !== 'undefined' && window.LexeraThemeBridge) return window.LexeraThemeBridge;
    return null;
  }
  function snapshotTheme() {
    var b = themeBridge();
    return b ? b.snapshotTheme() : null;
  }
  function broadcastTheme() {
    var b = themeBridge();
    return b ? b.broadcastTheme() : Promise.resolve();
  }
  function applyThemeSnapshot(snapshot) {
    var b = themeBridge();
    if (b) b.applyThemeSnapshot(snapshot);
  }

  // Catalog + active-board bridges moved to shell/catalogBridge.js
  // (Workstream 5). Local bindings here keep existing call sites and
  // the public LexeraMultiview API working unchanged.
  function catalogBridge() {
    if (typeof window !== 'undefined' && window.LexeraCatalogBridge) return window.LexeraCatalogBridge;
    return null;
  }
  function broadcastCatalog(snapshot) {
    var b = catalogBridge();
    return b ? b.broadcastCatalog(snapshot) : Promise.resolve();
  }
  function wrapCatalogUpdates() {
    var b = catalogBridge();
    if (b) b.wrapShellMethods();
  }
  function activateCatalogBridge() {
    var b = catalogBridge();
    if (b) b.activateCatalog();
  }
  function deactivateCatalogBridge() {
    var b = catalogBridge();
    if (b) b.deactivateCatalog();
  }
  function broadcastActiveBoard(boardId) {
    var b = catalogBridge();
    return b ? b.broadcastActiveBoard(boardId) : Promise.resolve();
  }
  function wrapOpenBoard() {
    var b = catalogBridge();
    if (b) b.wrapShellMethods();
  }
  function activateActiveBoardBridge() {
    var b = catalogBridge();
    if (b) b.activateActiveBoard();
  }
  function deactivateActiveBoardBridge() {
    var b = catalogBridge();
    if (b) b.deactivateActiveBoard();
  }
  // Last-snapshot accessor used by the public API.
  function getLastCatalog() {
    var b = catalogBridge();
    return b ? b.getLastCatalog() : null;
  }

  // Activates all the bridges. Call this when opening any sub-app
  // that needs cross-view state. Ensures tests + non-multiview
  // sessions pay zero overhead.
  function activateBridges() {
    activateLogBridge();
    activateCatalogBridge();
    activateActiveBoardBridge();
  }

  // ── Embedded-board bridge ──────────────────────────────────────
  //
  // The embedded-board bridge (catalog/board-action/layout-drag/focus/
  // health/shortcuts/delegate-mutation, plus context-menu request
  // handler) lives in `src/shell/embeddedBoardBridge.js`. Tauri-runtime
  // dependencies are injected so the bridge file is self-contained.
  function isEmbeddedKanban() {
    var bridge = (typeof window !== 'undefined' && window.LexeraEmbeddedBoardBridge) || null;
    if (bridge && typeof bridge.isEmbeddedKanban === 'function') return bridge.isEmbeddedKanban();
    try {
      var p = new URLSearchParams(window.location.search || '');
      return p.get('embedded') === '1';
    } catch (_) { return false; }
  }

  function installEmbeddedBoardBridge() {
    var bridge = (typeof window !== 'undefined' && window.LexeraEmbeddedBoardBridge) || null;
    if (!bridge || typeof bridge.install !== 'function') return;
    bridge.install({
      getCurrentWebview: getCurrentWebview,
      invoke: invoke,
      handleRequest: handleRequest
    });
  }

  // ── Navigation requests ───────────────────────────────────────
  //
  // The shell-side navigation/shortcut/focus listeners live in
  // `src/shell/navigationBridge.js`. This wrapper preserves the prior
  // call site (`bootMultiview` invokes `installNavigationHandler()`).
  function installNavigationHandler() {
    var bridge = (typeof window !== 'undefined' && window.LexeraNavigationBridge) || null;
    if (!bridge) return;
    if (typeof bridge.installWith === 'function') {
      bridge.installWith(tauri());
    } else if (typeof bridge.install === 'function') {
      bridge.install();
    }
  }

  // Theme + catalog listeners now live in their own bridge modules.
  // This wrapper is kept so existing call sites (`bootMultiview`)
  // continue to work without changes.
  function initThemeBridge() {
    var t = themeBridge();
    if (t) t.initListeners();
    var c = catalogBridge();
    if (c) c.initListeners();
  }
  if (typeof document !== 'undefined') {
    function bootMultiview() {
      initThemeBridge();
      wrapCatalogUpdates();
      wrapOpenBoard();
      // Wrap window.lexeraLog so every frontend log entry produced in
      // this webview is also forwarded to Rust's log_broadcast — which
      // in turn relays the entry to any sub-app webview that subscribed
      // to 'log-message' (the log panel webview being the first such
      // subscriber). Without this wrap, the log panel stays empty.
      wrapLexeraLog();
      installNavigationHandler();
      installEmbeddedBoardBridge();
      // If we're hosting child webviews (default mode in main shell),
      // any embedded board webview will need catalog updates as soon
      // as it loads. Activate the catalog bridge so broadcasts flow.
      if (typeof window !== 'undefined' && !isEmbeddedKanban()) {
        activateBridges();
        // Pre-warm the pool so first-show of any board webview hits
        // the navigate fast-path (Perf #1). Defer one frame so the
        // shell has time to mount before we add load.
        var lc = lifecycleApi();
        var lcCfg = lc.status().config;
        if (lcCfg.poolSize && lcCfg.poolSize > 0) {
          requestAnimationFrame(function () {
            lc.refillPool().catch(function () {});
          });
        }
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootMultiview, { once: true });
    } else {
      bootMultiview();
    }
  }

  window.LexeraMultiview = {
    // Webview lifecycle
    spawn: spawn,
    destroy: destroy,
    setGeometry: setGeometry,
    pushGeomDeferred: pushGeomDeferred,
    fpsMeter: fpsMeter,
    navigate: navigateWebview,
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
    closeSidePanel: closeSidePanel,
    // Catalog bridge (active boards/workspaces broadcast)
    broadcastCatalog: broadcastCatalog,
    getLastCatalog: getLastCatalog,
    // Workspaces sub-app (Stage 4)
    openWorkspaces: openWorkspaces,
    closeWorkspaces: closeWorkspaces,
    // Dashboard sub-app (Stage 4)
    openDashboard: openDashboard,
    closeDashboard: closeDashboard,
    // Modal-as-window dialogs (Stage 6)
    confirmModal: confirmModal,
    promptModal: promptModal,
    // Drag ghost window (Stage 7)
    ghostEnsure: ghostEnsure,
    ghostMove: ghostMove,
    ghostHide: ghostHide,
    ghostSetContent: ghostSetContent,
    // Request/response IPC pattern (for cross-webview features
    // that need a return value, e.g., context menu items query)
    request: request,
    handleRequest: handleRequest,
    // Stage 8 lifecycle (extracted to src/shell/lifecycle.js).
    // Each property is a forwarder so the public surface stays stable
    // even though the underlying implementation lives in another file
    // and is created lazily on first transport availability.
    lifecycle: {
      configure: function (updates) { return lifecycleApi().configure(updates); },
      status: function () { return lifecycleApi().status(); },
      spawn: function (opts) { return lifecycleApi().spawn(opts); },
      touch: function (label) { return lifecycleApi().touch(label); },
      evictOldestIfOverCap: function () { return lifecycleApi().evictOldestIfOverCap(); },
      refillPool: function () { return lifecycleApi().refillPool(); }
    }
  };
})();
