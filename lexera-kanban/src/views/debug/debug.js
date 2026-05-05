/**
 * Debug-window controller.
 *
 * Runs in a separate top-level Tauri webview opened when the user
 * launches `lexera-kanban --debug` (see `main.rs`). The page itself
 * has no shell context, so all interactions are routed via Tauri
 * events that the shell webview (label = "main") is listening for.
 *
 * Event protocol:
 *   - emit `debug-hide-overlays` { hidden: bool } — shell flips
 *     `LexeraMultiviewWebview.setAllVisible` accordingly.
 *   - emit `debug-dock-snapshot-request` {} — shell responds with
 *     `debug-dock-snapshot-response` { left, right, bottom } where
 *     each value is a `_test_inspectDock(dockId)` result object.
 *   - emit `debug-open-frontend-tests` {} — shell opens the
 *     existing `views/frontendTests/index.html` webview.
 *
 * Lives in its own file so the debug window is fully standalone —
 * no dependency on workspaceShell.js or the IIFE soup, only on the
 * tiny `LexeraEmbedMenu.tauriEmit` shim it shares with the rest
 * of the codebase.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function tauriCore() {
    return (window.__TAURI__ && window.__TAURI__.core) || null;
  }
  function tauriEvent() {
    return (window.__TAURI__ && window.__TAURI__.event) || null;
  }

  // Best-effort emit using whichever Tauri 2 API surface is available.
  // The IPC layer accepts the event name + payload; transports differ
  // by Tauri build.
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
  function listen(eventName, handler) {
    var ev = tauriEvent();
    if (ev && typeof ev.listen === 'function') {
      try { return ev.listen(eventName, handler); } catch (_) {}
    }
    return Promise.resolve(function () {});
  }

  var state = { overlaysHidden: false };

  function setOverlayStatusUi(hidden) {
    var el = document.querySelector('[data-debug-status="overlays"]');
    if (el) {
      el.textContent = hidden ? 'hidden' : 'visible';
      el.setAttribute('data-state', hidden ? 'hidden' : 'visible');
    }
    var btn = document.querySelector('[data-debug-action="toggle-overlays"]');
    if (btn) btn.textContent = hidden ? 'Show all overlay webviews' : 'Hide all overlay webviews';
  }

  function toggleOverlays() {
    var nextHidden = !state.overlaysHidden;
    state.overlaysHidden = nextHidden;
    setOverlayStatusUi(nextHidden);
    emit('debug-hide-overlays', { hidden: nextHidden }).catch(function (err) {
      // If the IPC fails, fall back to local-only state so the toggle
      // visibly stays in sync; another retry can be triggered by the
      // user clicking again.
      console.warn('[debug] emit debug-hide-overlays failed:', err && err.message ? err.message : err);
    });
  }

  function refreshSnapshots() {
    var out = document.querySelector('[data-debug-snapshot-output]');
    if (out) out.textContent = 'requesting…';
    emit('debug-dock-snapshot-request', {}).catch(function (err) {
      if (out) out.textContent = 'request failed: ' + (err && err.message ? err.message : String(err));
    });
  }

  function openFrontendTests() {
    emit('debug-open-frontend-tests', {}).catch(function (err) {
      console.warn('[debug] emit debug-open-frontend-tests failed:', err);
    });
  }

  // Snapshot response handler: pretty-print every dock's snapshot.
  function installListeners() {
    listen('debug-dock-snapshot-response', function (event) {
      var payload = (event && event.payload) || {};
      var out = document.querySelector('[data-debug-snapshot-output]');
      if (!out) return;
      try {
        out.textContent = JSON.stringify(payload, null, 2);
      } catch (_) {
        out.textContent = String(payload);
      }
    });
    // Shell may also push the current overlay state on connect so the
    // debug window can show the right UI before any toggle is clicked.
    listen('debug-overlay-state', function (event) {
      var payload = (event && event.payload) || {};
      if (typeof payload.hidden === 'boolean') {
        state.overlaysHidden = payload.hidden;
        setOverlayStatusUi(payload.hidden);
      }
    });
  }

  // Click delegation on the body so the layout can be edited in HTML
  // without rewiring listeners. Each interactive element carries a
  // `data-debug-action` attribute.
  function bindActions() {
    document.body.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-debug-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-debug-action');
      if (action === 'toggle-overlays') return toggleOverlays();
      if (action === 'refresh-snapshots') return refreshSnapshots();
      if (action === 'open-frontend-tests') return openFrontendTests();
    });
  }

  function init() {
    bindActions();
    installListeners();
    setOverlayStatusUi(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose internals so vitest can drive the controller without a
  // real DOM-event pipeline.
  window.LexeraDebugWindow = {
    _test_emit: emit,
    _test_listen: listen,
    _test_state: state,
    _test_toggleOverlays: toggleOverlays,
    _test_refreshSnapshots: refreshSnapshots,
    _test_openFrontendTests: openFrontendTests,
    _test_setOverlayStatusUi: setOverlayStatusUi
  };
})();
