// Pin the debug-window controller (`views/debug/debug.js`).
//
// Runs in the standalone debug window opened by `lexera-kanban --debug`.
// Has no shell context — every interaction is a Tauri event emit.
// Contract:
//   1. Toggle button flips local state and emits
//      `debug-hide-overlays { hidden }` with the NEW state.
//   2. Refresh button emits `debug-dock-snapshot-request {}` and
//      shows "requesting…" while waiting.
//   3. Open-frontend-tests button emits `debug-open-frontend-tests {}`.
//   4. The debug-overlay-state listener updates UI to match shell.

import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    childNodes: [],
    attributes: {},
    textContent: '',
    style: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] != null ? this.attributes[k] : null; },
    appendChild(c) { this.children.push(c); this.childNodes.push(c); return c; },
    addEventListener() {},
    querySelector() { return null; },
    closest() { return null; }
  };
}

function loadController({ listenSpy, emitSpy, statusEl, btn, snapshotEl } = {}) {
  const listen = listenSpy || vi.fn(() => Promise.resolve(() => {}));
  const emit = emitSpy || vi.fn(() => Promise.resolve());
  const status = statusEl || createElement('span');
  const button = btn || createElement('button');
  const snapshot = snapshotEl || createElement('pre');
  const window = {
    __TAURI__: { event: { listen, emit } },
    addEventListener() {},
    removeEventListener() {}
  };
  const document = {
    readyState: 'complete',
    addEventListener() {},
    body: {
      addEventListener() {}
    },
    querySelector(sel) {
      if (sel === '[data-debug-status="overlays"]') return status;
      if (sel === '[data-debug-action="toggle-overlays"]') return button;
      if (sel === '[data-debug-snapshot-output]') return snapshot;
      return null;
    }
  };
  window.document = document;
  loadIIFE('views/debug/debug.js', null, {
    window,
    document,
    console: { log() {}, warn() {}, error() {}, info() {} }
  });
  return { window, listen, emit, status, button, snapshot };
}

describe('debug-window controller (views/debug/debug.js)', () => {
  it('exposes test seams for direct invocation in vitest', () => {
    const { window } = loadController();
    expect(window.LexeraDebugWindow).toBeTruthy();
    expect(typeof window.LexeraDebugWindow._test_toggleOverlays).toBe('function');
    expect(typeof window.LexeraDebugWindow._test_refreshSnapshots).toBe('function');
    expect(typeof window.LexeraDebugWindow._test_openFrontendTests).toBe('function');
  });

  it('toggleOverlays() emits debug-hide-overlays { hidden: true } on first call', () => {
    const { window, emit } = loadController();
    window.LexeraDebugWindow._test_toggleOverlays();
    expect(emit).toHaveBeenCalledWith('debug-hide-overlays', { hidden: true });
  });

  it('toggleOverlays() flips state on each call (local stays in sync with shell)', () => {
    const { window, emit } = loadController();
    window.LexeraDebugWindow._test_toggleOverlays();
    window.LexeraDebugWindow._test_toggleOverlays();
    window.LexeraDebugWindow._test_toggleOverlays();
    const overlayCalls = emit.mock.calls.filter((c) => c[0] === 'debug-hide-overlays');
    expect(overlayCalls.length).toBe(3);
    expect(overlayCalls[0][1]).toEqual({ hidden: true });
    expect(overlayCalls[1][1]).toEqual({ hidden: false });
    expect(overlayCalls[2][1]).toEqual({ hidden: true });
  });

  it('toggleOverlays() updates the on-screen status text', () => {
    const { window, status, button } = loadController();
    window.LexeraDebugWindow._test_toggleOverlays();
    expect(status.textContent).toBe('hidden');
    expect(button.textContent).toMatch(/Show all/);
    window.LexeraDebugWindow._test_toggleOverlays();
    expect(status.textContent).toBe('visible');
    expect(button.textContent).toMatch(/Hide all/);
  });

  it('refreshSnapshots() emits debug-dock-snapshot-request and writes "requesting…" placeholder', () => {
    const { window, emit, snapshot } = loadController();
    window.LexeraDebugWindow._test_refreshSnapshots();
    expect(emit).toHaveBeenCalledWith('debug-dock-snapshot-request', {});
    expect(snapshot.textContent).toMatch(/requesting/i);
  });

  it('openFrontendTests() emits debug-open-frontend-tests', () => {
    const { window, emit } = loadController();
    window.LexeraDebugWindow._test_openFrontendTests();
    expect(emit).toHaveBeenCalledWith('debug-open-frontend-tests', {});
  });
});
