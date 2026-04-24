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

  // ── Stage 8: Lazy spawn + LRU eviction + pre-warm pool ─────────
  //
  // Memory budget for the multi-webview architecture: each webview
  // is its own OS process at ~50-150MB. Without bounds, opening
  // many boards consumes GBs of RAM. These helpers manage:
  //  - LRU tracking: bump a webview's freshness on use; evict the
  //    oldest when over the soft cap
  //  - Pre-warm pool: keep N empty webviews ready to be repurposed
  //    via webview.navigate(), so first-show is near-instant
  //
  // Configurable via LexeraMultiview.lifecycle.config({...}).

  var lifecycleConfig = {
    softCap: 8,           // max simultaneously alive non-pinned webviews
    poolSize: 0,          // pre-warmed empty webviews (0 = disabled)
    poolUrl: 'multiview-demo.html', // simplest possible page for pre-warming
    pinnedLabels: ['inspector', 'log-view', 'workspaces', 'dashboard']
  };
  var freshness = {};       // label -> timestamp of last touch
  var pool = [];            // pre-warmed webview labels

  function touch(label) {
    freshness[label] = Date.now();
  }

  function evictOldestIfOverCap() {
    return listWebviews().then(function (list) {
      var evictable = list.filter(function (w) {
        return lifecycleConfig.pinnedLabels.indexOf(w.label) < 0
          && pool.indexOf(w.label) < 0;
      });
      if (evictable.length <= lifecycleConfig.softCap) return null;
      // Sort by freshness ascending (oldest first)
      evictable.sort(function (a, b) {
        return (freshness[a.label] || 0) - (freshness[b.label] || 0);
      });
      var victim = evictable[0].label;
      console.log('[lifecycle] evicting LRU webview:', victim);
      delete freshness[victim];
      return destroy(victim);
    });
  }

  // Spawn that participates in lifecycle (touches freshness, may
  // trigger eviction). Use this for ordinary view spawning instead
  // of the bare spawn() when you want lifecycle semantics.
  function lifecycleSpawn(opts) {
    return spawn(opts).then(function (result) {
      touch(opts.label);
      evictOldestIfOverCap();
      return result;
    });
  }

  // Repurpose a pool webview by navigating it to a new URL.
  // Returns a Promise<bool> — true if a pool webview was used.
  function tryRepurposeFromPool(targetLabel, url, position, size) {
    if (!pool.length) return Promise.resolve(false);
    var poolLabel = pool.shift();
    var t = tauri();
    var win = null;
    try { win = t.window ? t.window.getCurrentWindow() : null; } catch (_) {}
    // We can't rename a webview, so the pool webview's label stays as
    // poolLabel. Caller still gets the spawned webview at poolLabel.
    // For the migration this is fine since we use unique labels per view.
    return setGeometry([{ label: poolLabel, x: position.x, y: position.y, width: size.width, height: size.height }])
      .then(function () {
        // Navigate via the webview API. Tauri 2 webview has `setUrl`?
        // For now, destroy+respawn at the requested label is reliable.
        return destroy(poolLabel).then(function () {
          return spawn({ label: targetLabel, url: url, x: position.x, y: position.y, width: size.width, height: size.height });
        });
      })
      .then(function () {
        // Re-fill the pool in the background
        refillPool();
        return true;
      });
  }

  function refillPool() {
    var deficit = lifecycleConfig.poolSize - pool.length;
    if (deficit <= 0) return Promise.resolve();
    var spawns = [];
    for (var i = 0; i < deficit; i++) {
      var poolLabel = '_pool_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
      pool.push(poolLabel);
      // Spawn off-screen at 0x0 size so it's invisible until repurposed
      spawns.push(spawn({
        label: poolLabel, url: lifecycleConfig.poolUrl,
        x: -10000, y: -10000, width: 1, height: 1
      }).catch(function () { /* ignore */ }));
    }
    return Promise.all(spawns);
  }

  function lifecycleConfigure(updates) {
    Object.keys(updates || {}).forEach(function (k) { lifecycleConfig[k] = updates[k]; });
    if (lifecycleConfig.poolSize > 0) refillPool();
    return Object.assign({}, lifecycleConfig);
  }

  function lifecycleStatus() {
    return {
      config: Object.assign({}, lifecycleConfig),
      freshness: Object.assign({}, freshness),
      pool: pool.slice()
    };
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

  // ── Workspaces sub-app ────────────────────────────────────────
  //
  // Console:
  //   await LexeraMultiview.openWorkspaces({ side: 'left', size: 280 })
  //   // shows boards + workspaces; click a board → main shell opens it
  //   await LexeraMultiview.closeWorkspaces()
  function openWorkspaces(opts) {
    opts = opts || {};
    if (opts.side) {
      return openAsSidePanel({
        label: 'workspaces',
        url: 'views/workspaces/index.html',
        side: opts.side, size: opts.size, topInset: opts.topInset
      }).then(function () {
        console.log('[workspaces] opened as ' + opts.side + ' side panel');
      });
    }
    return spawn({
      label: 'workspaces',
      url: 'views/workspaces/index.html',
      x: opts.x != null ? opts.x : 100,
      y: opts.y != null ? opts.y : 100,
      width: opts.width != null ? opts.width : 320,
      height: opts.height != null ? opts.height : 600
    }).then(function () {
      console.log('[workspaces] opened');
    });
  }
  function closeWorkspaces() {
    return closeSidePanel('workspaces');
  }

  // ── Dashboard sub-app ─────────────────────────────────────────
  //
  // Console:
  //   await LexeraMultiview.openDashboard({ side: 'right', size: 320 })
  //   await LexeraMultiview.closeDashboard()
  function openDashboard(opts) {
    opts = opts || {};
    if (opts.side) {
      return openAsSidePanel({
        label: 'dashboard',
        url: 'views/dashboard/index.html',
        side: opts.side, size: opts.size, topInset: opts.topInset
      }).then(function () {
        console.log('[dashboard] opened as ' + opts.side + ' side panel');
      });
    }
    return spawn({
      label: 'dashboard',
      url: 'views/dashboard/index.html',
      x: opts.x != null ? opts.x : 100,
      y: opts.y != null ? opts.y : 100,
      width: opts.width != null ? opts.width : 380,
      height: opts.height != null ? opts.height : 500
    }).then(function () {
      console.log('[dashboard] opened');
    });
  }
  function closeDashboard() {
    return closeSidePanel('dashboard');
  }

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

  // ── Catalog bridge ────────────────────────────────────────────
  //
  // The main shell (LexeraWorkspaceShell) holds the active catalog
  // (boards + remote boards + workspaces). Per-view sub-apps that
  // show board lists / picker UIs need this. Broadcast every time
  // the catalog updates; sub-apps receive 'catalog-snapshot'.
  var lastCatalogSnapshot = null;

  function broadcastCatalog(snapshot) {
    if (!snapshot) return Promise.resolve();
    lastCatalogSnapshot = snapshot;
    return invoke('multiview_broadcast', {
      event: 'catalog-snapshot',
      payload: snapshot
    }).catch(function () { /* ignore */ });
  }

  function wrapCatalogUpdates() {
    if (typeof window === 'undefined' || !window.LexeraWorkspaceShell) return;
    var shell = window.LexeraWorkspaceShell;
    if (window.__lexeraMultiviewCatalogWrapped) return;
    var orig = shell.onCatalogUpdated;
    if (typeof orig !== 'function') return;
    shell.onCatalogUpdated = function (snapshot) {
      try { broadcastCatalog(snapshot); } catch (_) {}
      return orig.apply(this, arguments);
    };
    window.__lexeraMultiviewCatalogWrapped = true;
  }

  // ── Active board broadcast ────────────────────────────────────
  //
  // Wrap LexeraWorkspaceShell.openBoard so every board switch is
  // broadcast as 'active-board-changed' for sub-apps that need to
  // highlight the current board (workspaces picker, etc).
  var lastActiveBoardId = null;
  function broadcastActiveBoard(boardId) {
    if (boardId === lastActiveBoardId) return Promise.resolve();
    lastActiveBoardId = boardId;
    return invoke('multiview_broadcast', {
      event: 'active-board-changed',
      payload: { boardId: boardId || null }
    }).catch(function () {});
  }
  function wrapOpenBoard() {
    if (typeof window === 'undefined' || !window.LexeraWorkspaceShell) return;
    var shell = window.LexeraWorkspaceShell;
    if (window.__lexeraMultiviewOpenBoardWrapped) return;
    var orig = shell.openBoard;
    if (typeof orig !== 'function') return;
    shell.openBoard = function (boardId) {
      var result = orig.apply(this, arguments);
      try { broadcastActiveBoard(boardId); } catch (_) {}
      return result;
    };
    window.__lexeraMultiviewOpenBoardWrapped = true;
  }

  // ── Navigation requests ───────────────────────────────────────
  //
  // Sub-apps emit 'multiview-navigate' events to ask the main shell
  // to act on their behalf (open a board, reveal a panel, etc).
  // The main shell receives these and routes to LexeraWorkspaceShell.
  //
  // Payload shape: { type: 'open-board' | 'reveal-panel' | ..., ... }
  function installNavigationHandler() {
    var t = tauri();
    if (!t || !t.event || typeof t.event.listen !== 'function') return;
    t.event.listen('multiview-navigate', function (event) {
      var payload = event && event.payload ? event.payload : {};
      var shell = window.LexeraWorkspaceShell;
      if (!shell) return;
      try {
        if (payload.type === 'open-board' && payload.boardId && typeof shell.openBoard === 'function') {
          shell.openBoard(payload.boardId, payload.options || {});
        } else if (payload.type === 'reveal-panel' && payload.panelId && typeof shell.revealPanel === 'function') {
          shell.revealPanel(payload.panelId);
        }
      } catch (err) {
        console.warn('[multiview-navigate] handler failed:', err);
      }
    });
    // Multiview shortcut handler: receives 'multiview-shortcut' from
    // any sub-app (via Ctrl+Shift+L etc) and runs the corresponding
    // open helper in the main shell. This means panel toggles work
    // consistently regardless of which webview has focus.
    var SHORTCUT_ACTIONS = {
      'open-log-view': function () {
        if (window.LexeraMultiview && window.LexeraMultiview.openLogView) {
          return window.LexeraMultiview.openLogView({ side: 'bottom', size: 280 });
        }
      },
      'open-inspector': function () {
        if (window.LexeraMultiview && window.LexeraMultiview.openInspector) {
          return window.LexeraMultiview.openInspector({ side: 'right', size: 400 });
        }
      },
      'open-workspaces': function () {
        if (window.LexeraMultiview && window.LexeraMultiview.openWorkspaces) {
          return window.LexeraMultiview.openWorkspaces({ side: 'left', size: 280 });
        }
      },
      'open-dashboard': function () {
        if (window.LexeraMultiview && window.LexeraMultiview.openDashboard) {
          return window.LexeraMultiview.openDashboard({ side: 'right', size: 360 });
        }
      }
    };
    t.event.listen('multiview-shortcut', function (event) {
      var payload = event && event.payload ? event.payload : {};
      var action = payload.action;
      var fn = SHORTCUT_ACTIONS[action];
      if (fn) {
        try { fn(); } catch (err) { console.warn('[multiview-shortcut]', action, err); }
      }
    });
    // Wire global keyboard shortcuts for the MAIN shell window.
    // Uses Alt (not Shift) to avoid conflicting with existing kanban
    // shortcuts (e.g., Cmd+Shift+L toggles the legacy log panel).
    var MAIN_SHORTCUTS = {
      'Ctrl+Alt+L': 'open-log-view',
      'Meta+Alt+L': 'open-log-view',
      'Ctrl+Alt+I': 'open-inspector',
      'Meta+Alt+I': 'open-inspector',
      'Ctrl+Alt+W': 'open-workspaces',
      'Meta+Alt+W': 'open-workspaces',
      'Ctrl+Alt+D': 'open-dashboard',
      'Meta+Alt+D': 'open-dashboard'
    };
    document.addEventListener('keydown', function (event) {
      var parts = [];
      if (event.ctrlKey) parts.push('Ctrl');
      if (event.metaKey) parts.push('Meta');
      if (event.shiftKey) parts.push('Shift');
      if (event.altKey) parts.push('Alt');
      if (event.key && event.key.length === 1) parts.push(event.key.toUpperCase());
      else if (event.key) parts.push(event.key);
      var combo = parts.join('+');
      var action = MAIN_SHORTCUTS[combo];
      if (action) {
        var fn = SHORTCUT_ACTIONS[action];
        if (fn) {
          event.preventDefault();
          try { fn(); } catch (err) { console.warn('[shortcut]', action, err); }
        }
      }
    });
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
      t.event.listen('catalog-request', function () {
        if (lastCatalogSnapshot) broadcastCatalog(lastCatalogSnapshot);
      });
    }
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        initThemeBridge();
        wrapCatalogUpdates();
        wrapOpenBoard();
        installNavigationHandler();
      }, { once: true });
    } else {
      initThemeBridge();
      wrapCatalogUpdates();
      wrapOpenBoard();
      installNavigationHandler();
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
    closeSidePanel: closeSidePanel,
    // Catalog bridge (active boards/workspaces broadcast)
    broadcastCatalog: broadcastCatalog,
    getLastCatalog: function () { return lastCatalogSnapshot; },
    // Workspaces sub-app (Stage 4)
    openWorkspaces: openWorkspaces,
    closeWorkspaces: closeWorkspaces,
    // Dashboard sub-app (Stage 4)
    openDashboard: openDashboard,
    closeDashboard: closeDashboard,
    // Modal-as-window dialogs (Stage 6)
    confirmModal: confirmModal,
    // Stage 8 lifecycle
    lifecycle: {
      configure: lifecycleConfigure,
      status: lifecycleStatus,
      spawn: lifecycleSpawn,
      touch: touch,
      evictOldestIfOverCap: evictOldestIfOverCap,
      refillPool: refillPool
    }
  };
})();
