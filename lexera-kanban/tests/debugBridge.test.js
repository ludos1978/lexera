// Pin the shell-side `--debug` window event bridge.
//
// Lives in src/debug/debugBridge.js and translates Tauri events
// emitted by the standalone debug window into local LexeraDebug
// calls + response emits. Contract:
//   1. `debug-hide-overlays { hidden }` → LexeraDebug.hideAllOverlays(hidden)
//      AND echoes `debug-overlay-state { hidden }` so the debug
//      window's UI stays in sync.
//   2. `debug-dock-snapshot-request {}` → emit
//      `debug-dock-snapshot-response` with snapshots for left,
//      right, bottom plus the overlaysHidden flag.
//   3. `debug-open-frontend-tests {}` → calls the shell's
//      `handleBoardAction('reveal-panel:frontendTests')`.
//   4. The bridge installs only on the shell webview (skipped on
//      panel-only and embedded-board webviews).

import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadBridge({ shell, debugApi, listenSpy, emitSpy } = {}) {
  const listen = listenSpy || vi.fn(() => Promise.resolve(() => {}));
  const emit = emitSpy || vi.fn(() => Promise.resolve());
  const window = {
    LexeraWorkspaceShell: shell || undefined,
    LexeraDebug: debugApi || undefined,
    __TAURI__: {
      event: { listen, emit }
    },
    lexeraLog: vi.fn()
  };
  loadIIFE('debug/debugBridge.js', null, {
    window,
    console: { log() {}, warn() {}, error() {}, info() {} }
  });
  return { window, listen, emit };
}

describe('debugBridge — shell-side translator for the --debug window', () => {
  it('only registers listeners when running in the shell webview', () => {
    // Panel-only / embedded-board webviews: `LexeraWorkspaceShell.isEnabled`
    // returns false. Bridge must NOT register listeners — otherwise every
    // open webview reacts to every debug event, causing duplicated state
    // updates.
    const { listen } = loadBridge({
      shell: { isEnabled: () => false }
    });
    expect(listen).not.toHaveBeenCalled();
  });

  it('registers all three listeners when running in the shell webview', () => {
    const { listen } = loadBridge({
      shell: { isEnabled: () => true, handleBoardAction: () => {} }
    });
    const events = listen.mock.calls.map((c) => c[0]);
    expect(events).toContain('debug-hide-overlays');
    expect(events).toContain('debug-dock-snapshot-request');
    expect(events).toContain('debug-open-frontend-tests');
  });

  it('debug-hide-overlays handler calls LexeraDebug.hideAllOverlays with the payload bool', () => {
    const hideAllOverlays = vi.fn();
    const { window } = loadBridge({
      shell: { isEnabled: () => true, handleBoardAction: () => {} },
      debugApi: { hideAllOverlays, isOverlaysHidden: () => false }
    });
    window.LexeraDebugBridge._test_handleHideOverlays({ payload: { hidden: true } });
    expect(hideAllOverlays).toHaveBeenCalledWith(true);

    window.LexeraDebugBridge._test_handleHideOverlays({ payload: { hidden: false } });
    expect(hideAllOverlays).toHaveBeenLastCalledWith(false);
  });

  it('debug-hide-overlays handler echoes debug-overlay-state for UI sync', () => {
    const { window, emit } = loadBridge({
      shell: { isEnabled: () => true, handleBoardAction: () => {} },
      debugApi: { hideAllOverlays: () => {}, isOverlaysHidden: () => false }
    });
    window.LexeraDebugBridge._test_handleHideOverlays({ payload: { hidden: true } });
    expect(emit).toHaveBeenCalledWith('debug-overlay-state', { hidden: true });
  });

  it('debug-dock-snapshot-request handler emits a response with all three docks', () => {
    const dockSnapshot = vi.fn((dockId) => ({ dockId, hasPanels: true }));
    const { window, emit } = loadBridge({
      shell: { isEnabled: () => true, handleBoardAction: () => {} },
      debugApi: { dockSnapshot, isOverlaysHidden: () => false }
    });
    window.LexeraDebugBridge._test_handleSnapshotRequest();
    expect(dockSnapshot).toHaveBeenCalledWith('left');
    expect(dockSnapshot).toHaveBeenCalledWith('right');
    expect(dockSnapshot).toHaveBeenCalledWith('bottom');
    const responseCall = emit.mock.calls.find((c) => c[0] === 'debug-dock-snapshot-response');
    expect(responseCall).toBeTruthy();
    expect(responseCall[1]).toEqual(expect.objectContaining({
      left: expect.objectContaining({ dockId: 'left' }),
      right: expect.objectContaining({ dockId: 'right' }),
      bottom: expect.objectContaining({ dockId: 'bottom' }),
      overlaysHidden: false
    }));
  });

  it('snapshot response surfaces ok:false when LexeraDebug is unavailable', () => {
    const { window } = loadBridge({
      shell: { isEnabled: () => true, handleBoardAction: () => {} },
      debugApi: undefined
    });
    const response = window.LexeraDebugBridge._test_buildSnapshotResponse();
    expect(response.ok).toBe(false);
    expect(typeof response.reason).toBe('string');
  });

  it('debug-open-frontend-tests handler calls handleBoardAction("reveal-panel:frontendTests")', () => {
    const handleBoardAction = vi.fn();
    const { window } = loadBridge({
      shell: { isEnabled: () => true, handleBoardAction },
      debugApi: { hideAllOverlays: () => {}, isOverlaysHidden: () => false }
    });
    window.LexeraDebugBridge._test_handleOpenFrontendTests();
    expect(handleBoardAction).toHaveBeenCalledWith('reveal-panel:frontendTests');
  });

  it('debug-profile-render-request emits a graceful response when PerformanceObserver is unavailable', async () => {
    // node test environment doesn't have PerformanceObserver. The
    // handler must NOT throw — it must emit a `note: …` response so
    // the debug window can show the user why the profile failed.
    const emit = vi.fn(() => Promise.resolve());
    const { window } = loadBridge({
      shell: { isEnabled: () => true, handleBoardAction: () => {} },
      emitSpy: emit
    });
    // PerformanceObserver MUST NOT be defined in this test scope.
    delete globalThis.PerformanceObserver;
    window.LexeraDebugBridge._test_handleProfileRenderRequest({ payload: { durationMs: 100 } });
    // Synchronous emit happens immediately for the unavailable case.
    const responseCall = emit.mock.calls.find((c) => c[0] === 'debug-profile-render-response');
    expect(responseCall).toBeTruthy();
    expect(responseCall[1].entries).toEqual([]);
    expect(responseCall[1].note).toMatch(/PerformanceObserver unavailable/);
  });

  it('debug-profile-render-request installs one observer per entryType and surfaces refusal as a note without breaking siblings', async () => {
    // The profiler captures `longtask`, `event`, `paint`, and
    // `layout-shift` to let the user correlate Long Tasks with the
    // scroll/wheel/pointer event that triggered them. WKWebView's
    // support for `event` and `layout-shift` is uneven, so each
    // observer installs in its own try/catch — a refusal must NOT
    // prevent the other types from being captured. The refusal
    // reason is surfaced in `notes[]`.
    const emit = vi.fn(() => Promise.resolve());
    const observed = [];
    const installedObservers = [];
    class FakePO {
      constructor(cb) { this._cb = cb; installedObservers.push(this); }
      observe(opts) {
        const t = opts.entryTypes && opts.entryTypes[0];
        observed.push(t);
        // Pretend WKWebView refuses `layout-shift` — every other
        // type installs and synchronously delivers one entry.
        if (t === 'layout-shift') {
          throw new Error('Type "layout-shift" not supported.');
        }
        if (t === 'longtask') {
          this._cb({ getEntries: () => [{ name: 'self', duration: 120, startTime: 1000 }] });
        }
        if (t === 'event') {
          this._cb({ getEntries: () => [{
            name: 'wheel', duration: 80, startTime: 1500, processingStart: 1490,
            target: { tagName: 'DIV' }
          }] });
        }
        if (t === 'paint') {
          this._cb({ getEntries: () => [{ name: 'first-paint', startTime: 50 }] });
        }
      }
      disconnect() { this._disconnected = true; }
    }
    globalThis.PerformanceObserver = FakePO;
    const { window } = loadBridge({
      shell: { isEnabled: () => true, handleBoardAction: () => {} },
      emitSpy: emit
    });
    vi.useFakeTimers();
    try {
      window.LexeraDebugBridge._test_handleProfileRenderRequest({ payload: { durationMs: 50 } });
      // All four types attempted (longtask, event, paint, layout-shift).
      expect(observed).toEqual(['longtask', 'event', 'paint', 'layout-shift']);
      // Run the setTimeout that emits the response.
      vi.advanceTimersByTime(60);
      const responseCall = emit.mock.calls.find((c) => c[0] === 'debug-profile-render-response');
      expect(responseCall).toBeTruthy();
      const payload = responseCall[1];
      // Long-tasks shape preserved (back-compat with the old single-key payload).
      expect(payload.entries).toHaveLength(1);
      expect(payload.entries[0]).toEqual({ name: 'self', duration: 120, startTime: 1000 });
      // New per-type buckets present.
      expect(payload.events).toHaveLength(1);
      expect(payload.events[0]).toEqual(expect.objectContaining({
        name: 'wheel', duration: 80, target: 'DIV'
      }));
      expect(payload.paints).toEqual([{ name: 'first-paint', startTime: 50 }]);
      // The unsupported type didn't crash siblings — it lands in notes.
      expect(payload.shifts).toEqual([]);
      expect(payload.notes).toEqual(expect.arrayContaining([
        expect.stringMatching(/layout-shift.*Type "layout-shift" not supported/)
      ]));
      // Surviving observers were disconnected at the end of the window.
      const installed = installedObservers.filter((o) => o._disconnected);
      expect(installed.length).toBe(3); // longtask + event + paint, layout-shift never installed
    } finally {
      vi.useRealTimers();
      delete globalThis.PerformanceObserver;
    }
  });

  it('debug-profile-render-request includes a self-describing meta block on every response', async () => {
    // When a JSON trace is shared (Copy as JSON button), the reader
    // needs to know WHEN it was captured, for how long, in which
    // webview, and on which UA — otherwise the numbers float
    // context-free. Pin: every code path that emits
    // debug-profile-render-response includes a `meta` block with
    // recordedAt + durationMs + webviewLabel + userAgent.
    const emit = vi.fn(() => Promise.resolve());
    // (a) PerformanceObserver unavailable path
    delete globalThis.PerformanceObserver;
    let res = loadBridge({
      shell: { isEnabled: () => true, handleBoardAction: () => {}, getWindowLabel: () => 'main' },
      emitSpy: emit
    });
    res.window.LexeraDebugBridge._test_handleProfileRenderRequest({ payload: { durationMs: 7000 } });
    let call = emit.mock.calls.find((c) => c[0] === 'debug-profile-render-response');
    expect(call[1].meta).toBeTruthy();
    expect(call[1].meta.durationMs).toBe(7000);
    expect(call[1].meta.webviewLabel).toBe('main');
    expect(typeof call[1].meta.recordedAt).toBe('string');
    expect(call[1].meta.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // (b) every-entryType-refused path — meta still present.
    emit.mockClear();
    class RefusingPO {
      observe() { throw new Error('refused'); }
      disconnect() {}
    }
    globalThis.PerformanceObserver = RefusingPO;
    res = loadBridge({
      shell: { isEnabled: () => true, handleBoardAction: () => {}, getWindowLabel: () => 'kanban-3' },
      emitSpy: emit
    });
    res.window.LexeraDebugBridge._test_handleProfileRenderRequest({ payload: { durationMs: 200 } });
    call = emit.mock.calls.find((c) => c[0] === 'debug-profile-render-response');
    expect(call[1].meta).toBeTruthy();
    expect(call[1].meta.durationMs).toBe(200);
    expect(call[1].meta.webviewLabel).toBe('kanban-3');

    // (c) successful capture path — meta also present.
    emit.mockClear();
    class FakePO {
      constructor(cb) { this._cb = cb; }
      observe(opts) {
        if (opts.entryTypes[0] === 'longtask') {
          this._cb({ getEntries: () => [] });
        }
      }
      disconnect() {}
    }
    globalThis.PerformanceObserver = FakePO;
    res = loadBridge({
      shell: { isEnabled: () => true, handleBoardAction: () => {}, getWindowLabel: () => 'main' },
      emitSpy: emit
    });
    vi.useFakeTimers();
    try {
      res.window.LexeraDebugBridge._test_handleProfileRenderRequest({ payload: { durationMs: 50 } });
      vi.advanceTimersByTime(60);
      call = emit.mock.calls.find((c) => c[0] === 'debug-profile-render-response');
      expect(call[1].meta).toBeTruthy();
      expect(call[1].meta.durationMs).toBe(50);
      expect(call[1].meta.webviewLabel).toBe('main');
    } finally {
      vi.useRealTimers();
      delete globalThis.PerformanceObserver;
    }
  });

  it('debug-profile-render-request emits a notes-only response when EVERY entryType is refused', async () => {
    // If the WebKit version is so old that no observer type is
    // accepted, the handler still needs to emit a response (so the
    // UI can say so) instead of silently hanging the recording badge.
    const emit = vi.fn(() => Promise.resolve());
    class RefusingPO {
      constructor() {}
      observe() { throw new Error('refused'); }
      disconnect() {}
    }
    globalThis.PerformanceObserver = RefusingPO;
    const { window } = loadBridge({
      shell: { isEnabled: () => true, handleBoardAction: () => {} },
      emitSpy: emit
    });
    try {
      window.LexeraDebugBridge._test_handleProfileRenderRequest({ payload: { durationMs: 100 } });
      // Synchronous emit when no observers installed.
      const responseCall = emit.mock.calls.find((c) => c[0] === 'debug-profile-render-response');
      expect(responseCall).toBeTruthy();
      expect(responseCall[1].entries).toEqual([]);
      expect(responseCall[1].events).toEqual([]);
      expect(responseCall[1].paints).toEqual([]);
      expect(responseCall[1].shifts).toEqual([]);
      expect(responseCall[1].notes.length).toBeGreaterThan(0);
      expect(responseCall[1].note).toMatch(/refused/);
    } finally {
      delete globalThis.PerformanceObserver;
    }
  });
});
