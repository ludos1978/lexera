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

  // ── Render-perf profiler ───────────────────────────────────────
  //
  // 5-second window of `PerformanceObserver({ entryTypes: ['longtask'] })`
  // captured in the SHELL webview (where the kanban board's render
  // happens). Surfaces every Long Task ≥50ms — the threshold the
  // browser uses for "this blocked the main thread noticeably". Sorted
  // by duration desc so the worst offenders are at the top.
  //
  // Lives in the debug window (this file) for the UI; the actual
  // capture runs in the shell via Tauri events. The shell-side
  // listener captures + emits the result back here.
  var _profileState = { running: false, lastPayload: null };
  function setProfileStatusUi(text, isRunning) {
    var el = document.querySelector('[data-debug-status="profile"]');
    if (el) {
      el.textContent = text;
      el.setAttribute('data-state', isRunning ? 'hidden' : 'visible');
    }
    var btn = document.querySelector('[data-debug-action="profile-render"]');
    if (btn) btn.disabled = !!isRunning;
  }
  // Reads the duration input, clamps to 1..60 seconds, returns ms.
  // Falls back to 5000 if the input is missing or unparseable so the
  // button still works when index.html ships without the field
  // (older debug-window builds).
  function readProfileDurationMs() {
    var input = document.querySelector('[data-debug-profile-duration]');
    if (!input) return 5000;
    var seconds = parseFloat(input.value);
    if (!isFinite(seconds) || seconds <= 0) return 5000;
    if (seconds < 1) seconds = 1;
    if (seconds > 60) seconds = 60;
    return Math.round(seconds * 1000);
  }
  // Copy the most recent profile payload as JSON. Used to share a
  // trace with someone (paste into a bug or chat) without screenshot
  // gymnastics. Falls back to writing the JSON into the output pane
  // when navigator.clipboard is unavailable (older WKWebView, or no
  // user gesture context). The status badge surfaces the outcome so
  // the user knows whether to find the payload in their clipboard or
  // in the pane below.
  function copyProfileAsJson() {
    var out = document.querySelector('[data-debug-profile-output]');
    var payload = _profileState.lastPayload;
    if (!payload) {
      setProfileStatusUi('nothing to copy — record first', false);
      return;
    }
    var text;
    try { text = JSON.stringify(payload, null, 2); }
    catch (_) { text = String(payload); }
    var clipboard = (typeof navigator !== 'undefined' && navigator.clipboard) || null;
    if (clipboard && typeof clipboard.writeText === 'function') {
      clipboard.writeText(text).then(function () {
        setProfileStatusUi('copied to clipboard', false);
      }, function () {
        if (out) out.textContent = text;
        setProfileStatusUi('clipboard refused — JSON shown below', false);
      });
      return;
    }
    if (out) out.textContent = text;
    setProfileStatusUi('clipboard unavailable — JSON shown below', false);
  }

  function startRenderProfile() {
    if (_profileState.running) return;
    _profileState.running = true;
    var durationMs = readProfileDurationMs();
    var seconds = Math.round(durationMs / 1000);
    setProfileStatusUi('recording (' + seconds + 's)…', true);
    var out = document.querySelector('[data-debug-profile-output]');
    if (out) out.textContent = 'capturing for ' + seconds +
      ' seconds — go interact with the slow board…';
    emit('debug-profile-render-request', { durationMs: durationMs }).catch(function (err) {
      _profileState.running = false;
      setProfileStatusUi('emit failed', false);
      if (out) out.textContent = 'emit debug-profile-render-request failed: ' +
        (err && err.message ? err.message : String(err));
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
    // Render-profile result delivered by the shell-side bridge.
    // Payload shape is { entries, events, paints, shifts, notes }
    // — `entries` keeps its original meaning (Long Tasks) for
    // back-compat with anything reading the old protocol.
    listen('debug-profile-render-response', function (event) {
      var payload = (event && event.payload) || {};
      _profileState.running = false;
      _profileState.lastPayload = payload;
      var copyBtn = document.querySelector('[data-debug-profile-copy]');
      if (copyBtn) copyBtn.disabled = false;
      var entries = Array.isArray(payload.entries) ? payload.entries : [];
      var events = Array.isArray(payload.events) ? payload.events : [];
      var paints = Array.isArray(payload.paints) ? payload.paints : [];
      var shifts = Array.isArray(payload.shifts) ? payload.shifts : [];
      var notes = Array.isArray(payload.notes) ? payload.notes :
        (payload.note ? [payload.note] : []);
      setProfileStatusUi(entries.length + ' long tasks, ' +
        events.length + ' events', false);
      var out = document.querySelector('[data-debug-profile-output]');
      if (!out) return;

      function renderLongTasks() {
        if (entries.length === 0) {
          return 'No Long Tasks (≥50ms) recorded.\n  ' +
            'The board may not be re-rendering during this sample. ' +
            'Hold mouse, type in a card, or scroll to provoke renders, then re-record.';
        }
        var top = entries.slice(0, 30);
        var lines = top.map(function (e, i) {
          return '  ' + (i + 1) + '. ' + Math.round(e.duration) +
            'ms @ t=' + Math.round(e.startTime) + 'ms' +
            (e.name ? '  ' + e.name : '');
        });
        return 'Top ' + top.length + ' Long Tasks (≥50ms) by duration:\n' +
          lines.join('\n');
      }
      function renderEvents() {
        if (events.length === 0) return 'No event-timing entries.';
        var top = events.slice(0, 30);
        var lines = top.map(function (e, i) {
          return '  ' + (i + 1) + '. ' + Math.round(e.duration) +
            'ms  ' + (e.name || '?') +
            (e.target ? ' on <' + e.target.toLowerCase() + '>' : '') +
            ' @ t=' + Math.round(e.startTime) + 'ms';
        });
        return 'Top ' + top.length + ' event-timing entries by duration:\n' +
          lines.join('\n');
      }
      function renderPaints() {
        if (paints.length === 0) return 'No paint entries.';
        var lines = paints.map(function (p) {
          return '  ' + p.name + ' @ t=' + Math.round(p.startTime) + 'ms';
        });
        return 'Paint timeline:\n' + lines.join('\n');
      }
      function renderShifts() {
        if (shifts.length === 0) return 'No layout-shift entries.';
        var total = shifts.reduce(function (s, e) { return s + e.value; }, 0);
        var lines = shifts.slice(0, 10).map(function (e) {
          return '  shift=' + e.value.toFixed(4) +
            ' @ t=' + Math.round(e.startTime) + 'ms';
        });
        return 'Layout shifts (cumulative=' + total.toFixed(4) +
          ', showing first 10):\n' + lines.join('\n');
      }
      function renderNotes() {
        if (notes.length === 0) return '';
        return 'Notes:\n  - ' + notes.join('\n  - ');
      }

      function renderMeta() {
        var meta = payload.meta;
        if (!meta || typeof meta !== 'object') return '';
        var dur = Number(meta.durationMs) || 0;
        var seconds = (dur / 1000).toFixed(1);
        var lines = ['Recorded: ' + (meta.recordedAt || '?') +
          '  duration: ' + seconds + 's' +
          '  webview: ' + (meta.webviewLabel || '?')];
        if (meta.userAgent) lines.push('UA: ' + meta.userAgent);
        return lines.join('\n');
      }

      try {
        var sections = [
          renderMeta(),
          renderLongTasks(),
          renderEvents(),
          renderPaints(),
          renderShifts(),
          renderNotes()
        ].filter(function (s) { return s; });
        out.textContent = sections.join('\n\n');
      } catch (_) { out.textContent = JSON.stringify(payload, null, 2); }
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
      if (action === 'profile-render') return startRenderProfile();
      if (action === 'profile-copy-json') return copyProfileAsJson();
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
    _test_setOverlayStatusUi: setOverlayStatusUi,
    _test_startRenderProfile: startRenderProfile,
    _test_profileState: _profileState,
    _test_readProfileDurationMs: readProfileDurationMs,
    _test_copyProfileAsJson: copyProfileAsJson
  };
})();
