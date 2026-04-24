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
  // Tauri events are fire-and-forget. For cross-webview features
  // that need a return value (e.g., "what context menu items do
  // you have for this scope?"), pair a request event with a response
  // event using a unique correlation ID. The caller listens for the
  // response, the responder listens for the request and emits the
  // response keyed to the correlation ID.

  var requestCounter = 0;

  // Caller side: send a request to a specific webview and resolve
  // with its response. Times out after `timeoutMs` (default 2000).
  function request(targetLabel, requestEvent, payload, timeoutMs) {
    timeoutMs = timeoutMs == null ? 2000 : timeoutMs;
    var corrId = 'req-' + (++requestCounter) + '-' + Date.now();
    var responseEvent = requestEvent + '-response';
    var t = tauri();
    if (!t || !t.event || typeof t.event.listen !== 'function') {
      return Promise.reject(new Error('no Tauri event API'));
    }
    return new Promise(function (resolve, reject) {
      var unsubPromise = t.event.listen(responseEvent, function (event) {
        var p = event && event.payload ? event.payload : {};
        if (p._corr !== corrId) return;
        unsubPromise.then(function (unsub) { try { unsub(); } catch (_) {} });
        clearTimeout(timeoutHandle);
        if (p._error) reject(new Error(p._error));
        else resolve(p.data);
      });
      var timeoutHandle = setTimeout(function () {
        unsubPromise.then(function (unsub) { try { unsub(); } catch (_) {} });
        reject(new Error('request ' + requestEvent + ' timed out after ' + timeoutMs + 'ms'));
      }, timeoutMs);
      invoke('multiview_emit_to', {
        target: targetLabel, event: requestEvent,
        payload: { _corr: corrId, data: payload || {} }
      }).catch(function (err) {
        unsubPromise.then(function (unsub) { try { unsub(); } catch (_) {} });
        clearTimeout(timeoutHandle);
        reject(err);
      });
    });
  }

  // Responder side: install a handler for a request event that
  // automatically broadcasts the response with the correlation ID.
  function handleRequest(requestEvent, handler) {
    var t = tauri();
    if (!t || !t.event || typeof t.event.listen !== 'function') {
      return Promise.reject(new Error('no Tauri event API'));
    }
    var responseEvent = requestEvent + '-response';
    return t.event.listen(requestEvent, function (event) {
      var p = event && event.payload ? event.payload : {};
      var corr = p._corr;
      Promise.resolve()
        .then(function () { return handler(p.data || {}); })
        .then(function (data) {
          invoke('multiview_broadcast', {
            event: responseEvent,
            payload: { _corr: corr, data: data }
          }).catch(function () {});
        })
        .catch(function (err) {
          invoke('multiview_broadcast', {
            event: responseEvent,
            payload: { _corr: corr, _error: String(err && err.message || err) }
          }).catch(function () {});
        });
    });
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

  // Default lifecycle config, overrideable via URL params:
  //   ?multiview-cap=12    — soft cap (max non-pinned webviews alive)
  //   ?multiview-pool=2    — pre-warmed pool size (0 = disabled)
  var lifecycleConfig = (function () {
    var defaults = {
      softCap: 8,
      poolSize: 0,
      poolUrl: 'multiview-demo.html',
      pinnedLabels: ['inspector', 'log-view', 'workspaces', 'dashboard']
    };
    try {
      var params = new URLSearchParams(window.location.search || '');
      var cap = parseInt(params.get('multiview-cap') || '', 10);
      var pool = parseInt(params.get('multiview-pool') || '', 10);
      if (Number.isFinite(cap) && cap > 0) defaults.softCap = cap;
      if (Number.isFinite(pool) && pool >= 0) defaults.poolSize = pool;
    } catch (_) {}
    return defaults;
  })();
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
      if (typeof window !== 'undefined' && typeof window.lexeraLog === 'function') {
        window.lexeraLog('info', '[lifecycle] LRU evicted ' + victim +
          ' (' + evictable.length + '/' + lifecycleConfig.softCap + ' over cap)');
      }
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
    activateBridges(); // log + catalog + active-board broadcasts now hot
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
    activateBridges();
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
    activateBridges();
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
    activateBridges();
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

  // Gate: catalog broadcasting only when activated. Same reasoning
  // as logBridgeActive — avoid IPC overhead for non-multiview users.
  var catalogBridgeActive = false;
  function wrapCatalogUpdates() {
    if (typeof window === 'undefined' || !window.LexeraWorkspaceShell) return;
    var shell = window.LexeraWorkspaceShell;
    if (window.__lexeraMultiviewCatalogWrapped) return;
    var orig = shell.onCatalogUpdated;
    if (typeof orig !== 'function') return;
    shell.onCatalogUpdated = function (snapshot) {
      if (catalogBridgeActive) {
        try { broadcastCatalog(snapshot); } catch (_) {}
      }
      return orig.apply(this, arguments);
    };
    window.__lexeraMultiviewCatalogWrapped = true;
  }
  function activateCatalogBridge() { catalogBridgeActive = true; }
  function deactivateCatalogBridge() { catalogBridgeActive = false; }

  // Gate: active-board broadcasting only when activated.
  var activeBoardBridgeActive = false;
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
      if (activeBoardBridgeActive) {
        try { broadcastActiveBoard(boardId); } catch (_) {}
      }
      return result;
    };
    window.__lexeraMultiviewOpenBoardWrapped = true;
  }
  function activateActiveBoardBridge() { activeBoardBridgeActive = true; }
  function deactivateActiveBoardBridge() { activeBoardBridgeActive = false; }

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
  // When this script runs inside a child webview that hosts an
  // embedded board (URL has ?embedded=1), bridge the new Tauri
  // 'catalog-snapshot' event into the existing postMessage shape
  // ('lexera-workspace-catalog') so the embedded board's existing
  // handler in orderHelpers.js processes it without modification.
  // Also bridge active-board-changed so the embedded board can
  // highlight its state.
  function isEmbeddedKanban() {
    try {
      var p = new URLSearchParams(window.location.search || '');
      return p.get('embedded') === '1';
    } catch (_) { return false; }
  }

  function installEmbeddedBoardBridge() {
    if (!isEmbeddedKanban()) return;
    var wv = getCurrentWebview();
    if (!wv || typeof wv.listen !== 'function') return;

    function dispatchAsMessage(data) {
      try {
        window.dispatchEvent(new MessageEvent('message', { data: data }));
      } catch (_) {}
    }

    wv.listen('catalog-snapshot', function (event) {
      var p = (event && event.payload) || {};
      dispatchAsMessage({
        type: 'lexera-workspace-catalog',
        boards: Array.isArray(p.boards) ? p.boards : [],
        remoteBoards: Array.isArray(p.remoteBoards) ? p.remoteBoards : [],
        workspaces: Array.isArray(p.workspaces) ? p.workspaces : []
      });
    });

    // Targeted board action — fires on this webview when shell calls
    // multiview_emit_to(<this label>, 'board-action', { action }).
    wv.listen('board-action', function (event) {
      var p = (event && event.payload) || {};
      if (p.action) {
        dispatchAsMessage({ type: 'lexera-board-action', action: p.action });
      }
    });

    // Global layout drag toggle — broadcast to all child webviews so
    // their CSS content-visibility / observer short-circuits apply.
    wv.listen('layout-drag', function (event) {
      var p = (event && event.payload) || {};
      dispatchAsMessage({ type: 'lexera-layout-drag', active: !!p.active });
    });

    // Targeted hierarchy focus — shell asks this board webview to
    // scroll/focus a specific row/stack/column/card.
    wv.listen('focus-hierarchy-target', function (event) {
      var p = (event && event.payload) || {};
      if (p.target) {
        dispatchAsMessage({
          type: 'lexera-focus-hierarchy-target',
          target: p.target
        });
      }
    });

    // Re-request snapshots in case the board mounted after the last
    // broadcast — main shell re-emits on receiving these requests.
    invoke('multiview_broadcast', { event: 'catalog-request', payload: {} })
      .catch(function () {});

    // Report focus state to Rust so the shell can detect pane
    // activation in multiview mode (replaces the old window.parent
    // postMessage path that doesn't work cross-process).
    function reportFocus(focused) {
      invoke('multiview_set_focused', { label: wv.label, focused: focused })
        .catch(function () {});
    }
    window.addEventListener('focus', function () { reportFocus(true); });
    window.addEventListener('blur', function () { reportFocus(false); });
    // Coarse-grained: any pointerdown counts as activation
    document.addEventListener('pointerdown', function () { reportFocus(true); }, true);
    if (document.hasFocus()) reportFocus(true);

    // Cross-webview request handler: shell asks for context menu
    // items, this board computes via its own LexeraRowStackMenu.
    handleRequest('build-context-menu', function (req) {
      try {
        var rsm = window.LexeraRowStackMenu;
        if (!rsm || typeof rsm.buildContextMenuItemsAndContext !== 'function') {
          return { items: [], context: req.context || {} };
        }
        var built = rsm.buildContextMenuItemsAndContext(req.scope, req.context || {});
        return {
          items: (built && built.items) || [],
          context: (built && built.context) || (req.context || {})
        };
      } catch (e) {
        return { items: [], context: req.context || {}, error: String(e && e.message) };
      }
    });

    // Cross-webview command: shell sends action dispatch back after
    // user picks a menu item. Board executes via LexeraActionRegistry.
    wv.listen('dispatch-action', function (event) {
      var p = (event && event.payload) || {};
      try {
        var ar = window.LexeraActionRegistry;
        if (ar && typeof ar.dispatch === 'function' && p.scope && p.action) {
          ar.dispatch(p.scope, p.action, p.context || {});
        }
      } catch (_) {}
    });

    // Mutation delegation from shell-window app.js. Replaces the
    // old iframe path of `frameWin.LexeraDashboard[method](...args)`.
    // Fire-and-forget; the result lands in the board's own
    // fullBoardData and propagates via Loro CRDT sync to other
    // observers.
    wv.listen('delegate-mutation', function (event) {
      var p = (event && event.payload) || {};
      try {
        var dash = window.LexeraDashboard;
        if (dash && typeof dash[p.method] === 'function') {
          dash[p.method].apply(dash, Array.isArray(p.args) ? p.args : []);
        }
      } catch (e) {
        try {
          if (typeof window.lexeraLog === 'function') {
            window.lexeraLog('warn', '[multiview] delegate-mutation failed: ' + (e && e.message || e));
          }
        } catch (_) {}
      }
    });
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
    // Bridge focus-changed → synthetic 'lexera-pane-activated' message
    // for the workspace shell. When a board webview gains focus, the
    // shell's existing handleWindowMessage handler runs to clear
    // pending focus targets / mark the pane as activated. Also bump
    // lifecycle freshness so this webview is not the next eviction
    // candidate.
    t.event.listen('focus-changed', function (event) {
      var p = event && event.payload ? event.payload : {};
      var label = p.label || '';
      // Bump LRU regardless of label so all view types get freshness updates
      if (window.LexeraMultiview && window.LexeraMultiview.lifecycle &&
          typeof window.LexeraMultiview.lifecycle.touch === 'function') {
        try { window.LexeraMultiview.lifecycle.touch(label); } catch (_) {}
      }
      // Only synthesize pane-activated for board-tab-* labels
      var prefix = 'board-tab-';
      if (label.indexOf(prefix) !== 0) return;
      var tabId = label.substring(prefix.length);
      try {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'lexera-pane-activated', pane: tabId }
        }));
      } catch (_) {}
    });
    // Note: a global keydown handler in the MAIN shell window is
    // tempting but would intercept events the existing kanban code
    // and tests rely on. Kept the shortcut handler ONLY in sub-app
    // webviews (subAppRuntime.js). Users opening the multiview
    // panels via DevTools console always works; opening via
    // keyboard requires a sub-app to be focused first. This is a
    // deliberate trade-off for non-invasive coexistence.
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
    function bootMultiview() {
      initThemeBridge();
      wrapCatalogUpdates();
      wrapOpenBoard();
      installNavigationHandler();
      installEmbeddedBoardBridge();
      // If we're hosting child webviews (default mode in main shell),
      // any embedded board webview will need catalog updates as soon
      // as it loads. Activate the catalog bridge so broadcasts flow.
      if (typeof window !== 'undefined' && !isEmbeddedKanban()) {
        activateBridges();
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
