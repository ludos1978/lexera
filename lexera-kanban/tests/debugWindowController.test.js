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

function loadController({
  listenSpy, emitSpy, statusEl, btn, snapshotEl, durationInput,
  profileOutput, profileCopyBtn, profileStatusEl, clipboard
} = {}) {
  const listen = listenSpy || vi.fn(() => Promise.resolve(() => {}));
  const emit = emitSpy || vi.fn(() => Promise.resolve());
  const status = statusEl || createElement('span');
  const button = btn || createElement('button');
  const snapshot = snapshotEl || createElement('pre');
  const profOut = profileOutput || createElement('pre');
  const profCopy = profileCopyBtn || createElement('button');
  const profStatus = profileStatusEl || createElement('span');
  const profileBtn = createElement('button');
  const window = {
    __TAURI__: { event: { listen, emit } },
    addEventListener() {},
    removeEventListener() {}
  };
  // The IIFE reads `navigator.clipboard` directly, not `window.navigator`,
  // so the loader has to inject `navigator` as a top-level global.
  const navigator = clipboard !== undefined ? { clipboard } : {};
  const document = {
    readyState: 'complete',
    addEventListener() {},
    body: {
      addEventListener() {}
    },
    querySelector(sel) {
      if (sel === '[data-debug-status="overlays"]') return status;
      if (sel === '[data-debug-status="profile"]') return profStatus;
      if (sel === '[data-debug-action="toggle-overlays"]') return button;
      if (sel === '[data-debug-action="profile-render"]') return profileBtn;
      if (sel === '[data-debug-snapshot-output]') return snapshot;
      if (sel === '[data-debug-profile-duration]') return durationInput || null;
      if (sel === '[data-debug-profile-output]') return profOut;
      if (sel === '[data-debug-profile-copy]') return profCopy;
      return null;
    }
  };
  window.document = document;
  loadIIFE('views/debug/debug.js', null, {
    window,
    document,
    navigator,
    console: { log() {}, warn() {}, error() {}, info() {} }
  });
  return {
    window, listen, emit, status, button, snapshot,
    profileOutput: profOut, profileCopyBtn: profCopy,
    profileStatus: profStatus
  };
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

  it('startRenderProfile() emits debug-profile-render-request with a durationMs', () => {
    const { window, emit } = loadController();
    window.LexeraDebugWindow._test_startRenderProfile();
    const call = emit.mock.calls.find((c) => c[0] === 'debug-profile-render-request');
    expect(call).toBeTruthy();
    expect(typeof call[1].durationMs).toBe('number');
    expect(call[1].durationMs).toBeGreaterThan(0);
  });

  it('startRenderProfile() reads the duration input (seconds) and converts to ms', () => {
    const durationInput = { value: '15' };
    const { window, emit } = loadController({ durationInput });
    window.LexeraDebugWindow._test_startRenderProfile();
    const call = emit.mock.calls.find((c) => c[0] === 'debug-profile-render-request');
    expect(call[1].durationMs).toBe(15000);
  });

  it('startRenderProfile() clamps the duration input to 1..60 seconds', () => {
    const tooSmall = { value: '0.2' };
    let res = loadController({ durationInput: tooSmall });
    res.window.LexeraDebugWindow._test_startRenderProfile();
    let call = res.emit.mock.calls.find((c) => c[0] === 'debug-profile-render-request');
    expect(call[1].durationMs).toBe(1000);

    const tooLarge = { value: '300' };
    res = loadController({ durationInput: tooLarge });
    res.window.LexeraDebugWindow._test_startRenderProfile();
    call = res.emit.mock.calls.find((c) => c[0] === 'debug-profile-render-request');
    expect(call[1].durationMs).toBe(60000);
  });

  it('startRenderProfile() falls back to 5000ms when the input is missing or NaN', () => {
    // Missing input element (older debug-window build) — defaults to 5s.
    let res = loadController({ durationInput: null });
    res.window.LexeraDebugWindow._test_startRenderProfile();
    let call = res.emit.mock.calls.find((c) => c[0] === 'debug-profile-render-request');
    expect(call[1].durationMs).toBe(5000);

    // Garbage value — also defaults to 5s rather than emitting NaN.
    res = loadController({ durationInput: { value: 'abc' } });
    res.window.LexeraDebugWindow._test_startRenderProfile();
    call = res.emit.mock.calls.find((c) => c[0] === 'debug-profile-render-request');
    expect(call[1].durationMs).toBe(5000);
  });

  it('copyProfileAsJson() with no recorded payload tells the user to record first', () => {
    const { window, profileStatus } = loadController();
    window.LexeraDebugWindow._test_copyProfileAsJson();
    expect(profileStatus.textContent).toMatch(/nothing to copy/);
  });

  it('copyProfileAsJson() writes the cached payload to navigator.clipboard when available', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const { window, profileStatus } = loadController({ clipboard: { writeText } });
    // Seed the cached payload as if a record had completed.
    window.LexeraDebugWindow._test_profileState.lastPayload = {
      entries: [{ name: 'self', duration: 100, startTime: 0 }],
      events: [], paints: [], shifts: [], notes: []
    };
    window.LexeraDebugWindow._test_copyProfileAsJson();
    expect(writeText).toHaveBeenCalledTimes(1);
    const written = writeText.mock.calls[0][0];
    expect(written).toContain('"entries"');
    expect(written).toContain('"duration": 100');
    // Status update happens in the .then() — flush the microtask queue.
    await Promise.resolve();
    expect(profileStatus.textContent).toMatch(/copied to clipboard/);
  });

  it('copyProfileAsJson() shows the JSON in the output pane when clipboard is missing', () => {
    // No clipboard property on navigator at all.
    const { window, profileOutput, profileStatus } = loadController({ clipboard: null });
    window.LexeraDebugWindow._test_profileState.lastPayload = {
      entries: [], events: [], paints: [], shifts: [], notes: []
    };
    window.LexeraDebugWindow._test_copyProfileAsJson();
    expect(profileOutput.textContent).toContain('"entries"');
    expect(profileStatus.textContent).toMatch(/clipboard unavailable/);
  });

  it('the no-Long-Tasks message distinguishes "no activity" from "activity but no main-thread block"', () => {
    // Two scenarios share entries.length === 0:
    //   (a) nothing happened — user didn't scroll/drag/type. The
    //       message should nudge them to interact.
    //   (b) events fired but every handler stayed <50ms. That's
    //       a real finding ("main thread isn't your bottleneck").
    //
    // Drive the registered debug-profile-render-response handler
    // directly with crafted payloads and assert the output pane
    // text picks the right message.
    function findResponseHandler(listen) {
      const call = listen.mock.calls.find(
        (c) => c[0] === 'debug-profile-render-response'
      );
      return call && call[1];
    }

    // (a) no entries + no events → "no activity" wording.
    let res = loadController();
    let handler = findResponseHandler(res.listen);
    expect(typeof handler).toBe('function');
    handler({ payload: { entries: [], events: [], paints: [], shifts: [], notes: [] } });
    expect(res.profileOutput.textContent).toMatch(/No input events fired/);
    expect(res.profileOutput.textContent).toMatch(/may not be receiving/);

    // (b) no entries + has events → "main thread isn't bottleneck".
    res = loadController();
    handler = findResponseHandler(res.listen);
    handler({ payload: {
      entries: [],
      events: [
        { name: 'wheel', duration: 12, startTime: 100 },
        { name: 'wheel', duration: 8, startTime: 200 }
      ],
      paints: [], shifts: [], notes: []
    } });
    expect(res.profileOutput.textContent).toMatch(/2 input events fired/);
    expect(res.profileOutput.textContent).toMatch(/Main thread isn't the bottleneck/);
  });

  it('copyProfileAsJson() falls back to output pane when clipboard.writeText is rejected', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowed')));
    const { window, profileOutput, profileStatus } = loadController({ clipboard: { writeText } });
    window.LexeraDebugWindow._test_profileState.lastPayload = {
      entries: [], events: [], paints: [], shifts: [], notes: []
    };
    window.LexeraDebugWindow._test_copyProfileAsJson();
    // Flush the rejected-promise handler.
    await Promise.resolve();
    await Promise.resolve();
    expect(profileOutput.textContent).toContain('"entries"');
    expect(profileStatus.textContent).toMatch(/clipboard refused/);
  });
});
