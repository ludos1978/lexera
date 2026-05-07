/**
 * Shell-side bridge for the standalone --debug window.
 *
 * Listens for Tauri events emitted by `views/debug/debug.js` and
 * translates them into local `LexeraDebug` calls + response emits:
 *
 *   debug-hide-overlays { hidden }      → LexeraDebug.hideAllOverlays
 *   debug-dock-snapshot-request          → emit debug-dock-snapshot-response
 *                                          { left, right, bottom }
 *   debug-open-frontend-tests            → reveal/spawn the frontend-tests panel
 *
 * Lives only in the workspace shell webview (label = "main"); the
 * other webviews don't host LexeraDebug, so listening there would be
 * a no-op anyway. We gate on `LexeraWorkspaceShell.isEnabled()` so
 * panel-only and embedded-board webviews skip the registration.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  function isShellWebview() {
    var shell = window.LexeraWorkspaceShell;
    return !!(shell && typeof shell.isEnabled === 'function' && shell.isEnabled());
  }
  function tauriEvent() {
    return (window.__TAURI__ && window.__TAURI__.event) || null;
  }
  function tauriCore() {
    return (window.__TAURI__ && window.__TAURI__.core) || null;
  }

  function listen(eventName, handler) {
    var ev = tauriEvent();
    if (ev && typeof ev.listen === 'function') {
      try { return ev.listen(eventName, handler); } catch (_) {}
    }
    return Promise.resolve(function () {});
  }
  function emit(eventName, payload) {
    var ev = tauriEvent();
    if (ev && typeof ev.emit === 'function') {
      try { return ev.emit(eventName, payload || {}); } catch (_) {}
    }
    var core = tauriCore();
    if (core && typeof core.invoke === 'function') {
      try {
        return core.invoke('plugin:event|emit', {
          event: String(eventName || ''),
          payload: payload || {}
        });
      } catch (_) {}
    }
    return Promise.reject(new Error('no Tauri event runtime'));
  }

  function handleHideOverlays(event) {
    var payload = (event && event.payload) || {};
    var hidden = !!payload.hidden;
    if (window.LexeraDebug && typeof window.LexeraDebug.hideAllOverlays === 'function') {
      window.LexeraDebug.hideAllOverlays(hidden);
    }
    if (typeof window.lexeraLog === 'function') {
      window.lexeraLog('info', '[debug-bridge] overlays ' + (hidden ? 'hidden' : 'shown'));
    }
    // Echo back the new state so the debug window UI stays in sync if
    // multiple toggles happen out of order.
    emit('debug-overlay-state', { hidden: hidden }).catch(function () {});
  }

  function buildSnapshotResponse() {
    var debug = window.LexeraDebug;
    if (!debug || typeof debug.dockSnapshot !== 'function') {
      return { ok: false, reason: 'LexeraDebug.dockSnapshot unavailable' };
    }
    return {
      left: debug.dockSnapshot('left'),
      right: debug.dockSnapshot('right'),
      bottom: debug.dockSnapshot('bottom'),
      overlaysHidden: typeof debug.isOverlaysHidden === 'function' ? !!debug.isOverlaysHidden() : null
    };
  }

  function handleSnapshotRequest() {
    emit('debug-dock-snapshot-response', buildSnapshotResponse()).catch(function () {});
  }

  function handleOpenFrontendTests() {
    var shell = window.LexeraWorkspaceShell;
    if (shell && typeof shell.handleBoardAction === 'function') {
      // Use the existing reveal-panel action so the frontend-tests
      // panel pops into whatever dock the shell wants — same path
      // as clicking View > Panels > Frontend Tests in the menubar.
      shell.handleBoardAction('reveal-panel:frontendTests');
    }
  }

  // Render-profile capture: subscribe a PerformanceObserver per
  // entryType for `durationMs`, collect entries from each, emit back
  // a structured payload. Lives in the shell so the timings captured
  // are the SHELL's own main-thread activity — i.e. the kanban-board
  // render path, which is exactly what stutters on a large board.
  //
  // Per-type observers (rather than one observer with multiple
  // entryTypes) so an unsupported type degrades silently instead of
  // breaking the others. WKWebView's support for `event` and
  // `layout-shift` is uneven; `longtask` and `paint` are reliable.
  // The `notes` array surfaces the reasons unsupported types were
  // skipped, so the debug window can show "no event data because
  // this WebKit version refused".
  function handleProfileRenderRequest(event) {
    var p = (event && event.payload) || {};
    var durationMs = Number(p.durationMs) || 5000;
    if (typeof PerformanceObserver !== 'function') {
      emit('debug-profile-render-response', {
        entries: [],
        events: [],
        paints: [],
        shifts: [],
        notes: ['PerformanceObserver unavailable in this webview runtime.'],
        note: 'PerformanceObserver unavailable in this webview runtime.'
      }).catch(function () {});
      return;
    }
    var longtasks = [];
    var events = [];
    var paints = [];
    var shifts = [];
    var notes = [];
    var observers = [];

    function startObserver(entryType, sink, mapper) {
      try {
        var po = new PerformanceObserver(function (list) {
          var batch = list.getEntries();
          for (var i = 0; i < batch.length; i++) sink.push(mapper(batch[i]));
        });
        po.observe({ entryTypes: [entryType] });
        observers.push(po);
      } catch (err) {
        notes.push('PerformanceObserver(' + entryType + ') refused: ' +
          (err && err.message ? err.message : String(err)));
      }
    }

    startObserver('longtask', longtasks, function (e) {
      return {
        name: String(e.name || ''),
        duration: Number(e.duration) || 0,
        startTime: Number(e.startTime) || 0
      };
    });
    startObserver('event', events, function (e) {
      return {
        name: String(e.name || ''),
        duration: Number(e.duration) || 0,
        startTime: Number(e.startTime) || 0,
        processingStart: Number(e.processingStart) || 0,
        target: e.target && e.target.tagName ? String(e.target.tagName) : ''
      };
    });
    startObserver('paint', paints, function (e) {
      return {
        name: String(e.name || ''),
        startTime: Number(e.startTime) || 0
      };
    });
    startObserver('layout-shift', shifts, function (e) {
      return {
        value: Number(e.value) || 0,
        startTime: Number(e.startTime) || 0
      };
    });

    if (observers.length === 0) {
      emit('debug-profile-render-response', {
        entries: [],
        events: [],
        paints: [],
        shifts: [],
        notes: notes,
        // Back-compat: callers still using the old single-string
        // `note` field get the first reason here.
        note: notes[0] || 'no PerformanceObserver entryType supported'
      }).catch(function () {});
      return;
    }
    setTimeout(function () {
      for (var i = 0; i < observers.length; i++) {
        try { observers[i].disconnect(); } catch (_) {}
      }
      longtasks.sort(function (a, b) { return b.duration - a.duration; });
      events.sort(function (a, b) { return b.duration - a.duration; });
      paints.sort(function (a, b) { return a.startTime - b.startTime; });
      shifts.sort(function (a, b) { return a.startTime - b.startTime; });
      emit('debug-profile-render-response', {
        entries: longtasks,
        events: events,
        paints: paints,
        shifts: shifts,
        notes: notes
      }).catch(function () {});
    }, durationMs);
  }

  function install() {
    if (!isShellWebview()) return;
    listen('debug-hide-overlays', handleHideOverlays);
    listen('debug-dock-snapshot-request', handleSnapshotRequest);
    listen('debug-open-frontend-tests', handleOpenFrontendTests);
    listen('debug-profile-render-request', handleProfileRenderRequest);
  }

  // Wait until the shell is enabled before installing — the IIFE in
  // workspaceShell.js sets up `LexeraWorkspaceShell` synchronously on
  // load, so by the time this script runs (debugBridge.js comes after
  // workspaceShell.js in index.html) the API is ready.
  install();

  window.LexeraDebugBridge = {
    _test_install: install,
    _test_handleHideOverlays: handleHideOverlays,
    _test_handleSnapshotRequest: handleSnapshotRequest,
    _test_handleOpenFrontendTests: handleOpenFrontendTests,
    _test_handleProfileRenderRequest: handleProfileRenderRequest,
    _test_buildSnapshotResponse: buildSnapshotResponse
  };
})();
