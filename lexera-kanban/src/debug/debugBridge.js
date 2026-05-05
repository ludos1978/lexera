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

  function install() {
    if (!isShellWebview()) return;
    listen('debug-hide-overlays', handleHideOverlays);
    listen('debug-dock-snapshot-request', handleSnapshotRequest);
    listen('debug-open-frontend-tests', handleOpenFrontendTests);
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
    _test_buildSnapshotResponse: buildSnapshotResponse
  };
})();
