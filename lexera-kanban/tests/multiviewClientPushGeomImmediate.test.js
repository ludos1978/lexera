// Pin the `pushGeomDeferred(update, { immediate: true })` contract.
//
// Why: `parkWebviewOffscreen` (multiviewWebview.js) calls this path
// when a placeholder becomes invisible — typically because
// `collapseDock` collapsed the placeholder's host. Without the
// `immediate` flag the geometry update is batched into the next
// rAF tick, during which the native webview keeps painting at its
// previous (full-size) coordinates. On the bottom dock that means
// the panel webview covers the 22-px fold strip for one frame,
// briefly making the strip invisible AND the click target unreachable.
//
// Contract pinned here:
//   1. immediate=true fires `multiview_set_geometry` synchronously
//      (no rAF wait).
//   2. immediate=true clears any pending rAF entry for the same
//      label so a queued flush won't undo the park by re-sending
//      the older coordinates.
//   3. immediate=true updates `lastSentGeometry` so a subsequent
//      `pushGeomDeferred` (non-immediate) for the same coords
//      de-dupes correctly.
//   4. The default (no opts) behaviour stays rAF-batched.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadClient({ invoke } = {}) {
  const tauriInvoke = invoke || vi.fn(() => Promise.resolve(null));
  let raf = null;
  const window = {
    __TAURI__: { core: { invoke: tauriInvoke } },
    LexeraMultiview: {},
    requestAnimationFrame(fn) { raf = fn; return 1; },
    cancelAnimationFrame() { raf = null; }
  };
  const api = loadIIFE('shell/multiviewClient.js', 'window.LexeraMultiview', {
    window,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout
  });
  return {
    api,
    invoke: tauriInvoke,
    fireRaf() { const fn = raf; raf = null; if (fn) fn(); }
  };
}

function geometryCalls(invoke) {
  return invoke.mock.calls.filter((c) => c[0] === 'multiview_set_geometry');
}

describe('pushGeomDeferred immediate-flag contract', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('without opts, defers IPC to the next animation frame', () => {
    const { api, invoke, fireRaf } = loadClient();
    api.pushGeomDeferred({ label: 'a', x: 10, y: 20, width: 100, height: 50 });
    // No IPC yet.
    expect(geometryCalls(invoke).length).toBe(0);
    fireRaf();
    // After rAF, exactly one batched IPC.
    expect(geometryCalls(invoke).length).toBe(1);
    expect(geometryCalls(invoke)[0][1].updates[0]).toEqual({
      label: 'a', x: 10, y: 20, width: 100, height: 50
    });
  });

  it('with immediate=true, fires the IPC synchronously without waiting for rAF', () => {
    const { api, invoke } = loadClient();
    api.pushGeomDeferred(
      { label: 'a', x: -50000, y: -50000, width: 1, height: 1 },
      { immediate: true }
    );
    expect(geometryCalls(invoke).length).toBe(1);
    expect(geometryCalls(invoke)[0][1].updates[0]).toEqual({
      label: 'a', x: -50000, y: -50000, width: 1, height: 1
    });
  });

  it('immediate clears a previously-queued rAF entry for the same label', () => {
    const { api, invoke, fireRaf } = loadClient();
    // 1. Queue an rAF update.
    api.pushGeomDeferred({ label: 'a', x: 10, y: 20, width: 100, height: 50 });
    // 2. Park immediately. Must drop the queued update so the rAF
    //    flush doesn't undo the park by re-sending (10,20,100,50).
    api.pushGeomDeferred(
      { label: 'a', x: -50000, y: -50000, width: 1, height: 1 },
      { immediate: true }
    );
    expect(geometryCalls(invoke).length).toBe(1);
    // 3. Fire the rAF: should NOT send another IPC for the same label
    //    because the queue is empty.
    fireRaf();
    expect(geometryCalls(invoke).length).toBe(1);
  });

  it('immediate updates lastSentGeometry — subsequent non-immediate matching call de-dupes', () => {
    const { api, invoke, fireRaf } = loadClient();
    api.pushGeomDeferred(
      { label: 'a', x: 5, y: 5, width: 50, height: 50 },
      { immediate: true }
    );
    expect(geometryCalls(invoke).length).toBe(1);
    // Subsequent non-immediate push with IDENTICAL coords: the rAF
    // flush should drop it as no-op (de-dup against lastSentGeometry).
    api.pushGeomDeferred({ label: 'a', x: 5, y: 5, width: 50, height: 50 });
    fireRaf();
    expect(geometryCalls(invoke).length).toBe(1);
  });

  it('immediate skips IPC entirely if value matches lastSentGeometry', () => {
    const { api, invoke } = loadClient();
    // Send once.
    api.pushGeomDeferred({ label: 'a', x: 5, y: 5, width: 50, height: 50 }, { immediate: true });
    expect(geometryCalls(invoke).length).toBe(1);
    // Same coords again — should be a no-op.
    api.pushGeomDeferred({ label: 'a', x: 5, y: 5, width: 50, height: 50 }, { immediate: true });
    expect(geometryCalls(invoke).length).toBe(1);
  });

  it('immediate does not affect pending entries for OTHER labels', () => {
    const { api, invoke, fireRaf } = loadClient();
    // Queue 'a', then immediately park 'b'. The queued 'a' must
    // survive intact and fire on the next rAF.
    api.pushGeomDeferred({ label: 'a', x: 1, y: 2, width: 3, height: 4 });
    api.pushGeomDeferred(
      { label: 'b', x: -50000, y: -50000, width: 1, height: 1 },
      { immediate: true }
    );
    expect(geometryCalls(invoke).length).toBe(1); // immediate for 'b'
    expect(geometryCalls(invoke)[0][1].updates[0].label).toBe('b');
    fireRaf();
    expect(geometryCalls(invoke).length).toBe(2); // rAF for 'a'
    expect(geometryCalls(invoke)[1][1].updates[0].label).toBe('a');
  });
});
