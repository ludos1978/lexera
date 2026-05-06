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
});
