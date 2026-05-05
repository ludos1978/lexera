// Pin Phase 4.1: shell-level MutationObserver for orphan placeholders.
//
// What this guards: any code path that pulls a `[data-multiview="1"]`
// element out of the document WITHOUT going through the shell's render
// path (which would invoke the lifecycle reconciler / orphan reaper).
// Examples that have caused ghost views in the wild:
//   - `parent.innerHTML = ''` on a placeholder ancestor
//   - a third-party library yanking a node
//   - a future code path that splices a placeholder DIV directly
//
// Without this defense, the native webview keeps painting at its last-
// known geometry above shell DOM until something else triggers cleanup.
//
// Two-rAF debounce: a removal followed by a re-attach within 2 frames
// (move/extract/reorder) is NOT a destroy — the observer waits, then
// asks `deps.getPlaceholder(tabId)` whether the element is back.
// Connected → no destroy. Disconnected → destroy(tabId).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadMultiview() {
  const window = {
    location: { href: 'http://127.0.0.1:1431/', search: '' },
    localStorage: { getItem() { return null; }, setItem() {} },
    addEventListener() {},
    removeEventListener() {},
    LexeraBoardHost: {
      multiviewLabelForTab: (id) => 'board-tab-' + id,
      multiviewUrlForTab: (s) => s,
      ensureHealthDot: () => ({ setAttribute() {} }),
      watchPlaceholderVisibility() {},
      cleanupVisibilityObserver() {}
    },
    LexeraPanelHost: {
      panelLabelForTab: (id) => 'panel-tab-' + id
    }
  };
  const document = { querySelectorAll() { return []; } };
  const api = loadIIFE('workspace/multiviewWebview.js', 'window.LexeraMultiviewWebview', {
    window,
    document,
    URL,
    URLSearchParams,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout
  });
  return { api, window };
}

beforeEach(() => {
  // Each test gets a clean observer state.
  const { api } = loadMultiview();
  if (typeof api._test_phaseFourResetState === 'function') api._test_phaseFourResetState();
});

describe('multiviewWebview Phase 4.1 — placeholder MutationObserver', () => {
  it('exposes the install + collect + checkPending seams', () => {
    const { api } = loadMultiview();
    expect(typeof api._test_installPhaseFourPlaceholderObserver).toBe('function');
    expect(typeof api._test_phaseFourCollectRemovedTabIds).toBe('function');
    expect(typeof api._test_phaseFourCheckPending).toBe('function');
  });

  it('collectRemovedTabIds returns ids for direct [data-multiview] removals', () => {
    const { api } = loadMultiview();
    const node = {
      nodeType: 1,
      getAttribute: (k) => k === 'data-multiview' ? '1' : k === 'data-tab-id' ? 'tab-x' : null,
      querySelectorAll: () => []
    };
    expect(api._test_phaseFourCollectRemovedTabIds([node])).toEqual(['tab-x']);
  });

  it('collectRemovedTabIds also picks up nested placeholders inside a removed ancestor', () => {
    const { api } = loadMultiview();
    const nested1 = {
      nodeType: 1,
      getAttribute: (k) => k === 'data-tab-id' ? 'nested-1' : null
    };
    const nested2 = {
      nodeType: 1,
      getAttribute: (k) => k === 'data-tab-id' ? 'nested-2' : null
    };
    const ancestor = {
      nodeType: 1,
      getAttribute: () => null, // not a placeholder itself
      querySelectorAll: () => [nested1, nested2]
    };
    const ids = api._test_phaseFourCollectRemovedTabIds([ancestor]);
    expect(ids.sort()).toEqual(['nested-1', 'nested-2']);
  });

  it('collectRemovedTabIds ignores non-element nodes (text, comment)', () => {
    const { api } = loadMultiview();
    const textNode = { nodeType: 3 }; // TEXT_NODE
    const commentNode = { nodeType: 8 }; // COMMENT_NODE
    expect(api._test_phaseFourCollectRemovedTabIds([textNode, commentNode])).toEqual([]);
  });

  it('checkPending decrements counters and only destroys at zero, AFTER 2 rAF ticks', () => {
    const { api } = loadMultiview();
    api._test_phaseFourResetState();
    const destroy = vi.fn();
    const getPlaceholder = vi.fn(() => null); // detached → must destroy
    // Manual rAF queue — does NOT auto-fire. Lets the test step through
    // decrements one frame at a time and prove the 2-tick debounce.
    const rafQueue = [];
    const rafImpl = (fn) => { rafQueue.push(fn); return 1; };
    api._test_phaseFourPendingState()['tab-x'] = 2;

    // Frame 1: counter 2 → 1. Still pending; reschedules.
    api._test_phaseFourCheckPending(rafImpl, getPlaceholder, destroy);
    expect(destroy).not.toHaveBeenCalled();
    expect(api._test_phaseFourPendingState()['tab-x']).toBe(1);
    expect(rafQueue.length).toBe(1);

    // Frame 2: pull the queued fn — counter 1 → 0 → destroy.
    rafQueue.shift()();
    expect(destroy).toHaveBeenCalledWith('tab-x');
    expect(api._test_phaseFourPendingState()['tab-x']).toBeUndefined();
  });

  it('does NOT destroy if placeholder is back in DOM by debounce-flush time (move/extract reattach)', () => {
    const { api } = loadMultiview();
    api._test_phaseFourResetState();
    const destroy = vi.fn();
    const reconnectedPlaceholder = { isConnected: true };
    const getPlaceholder = vi.fn(() => reconnectedPlaceholder);
    const rafQueue = [];
    const rafImpl = (fn) => { rafQueue.push(fn); return 1; };
    api._test_phaseFourPendingState()['tab-extracted'] = 2;

    // Frame 1.
    api._test_phaseFourCheckPending(rafImpl, getPlaceholder, destroy);
    // Frame 2.
    rafQueue.shift()();
    // After 2 rAF ticks the counter hits 0; getPlaceholder reports the
    // node is back; destroy MUST NOT fire.
    expect(destroy).not.toHaveBeenCalled();
    expect(api._test_phaseFourPendingState()['tab-extracted']).toBeUndefined();
  });

  it('install() is idempotent — calling twice returns the same observer', () => {
    const { api } = loadMultiview();
    api._test_phaseFourResetState();
    const root = { /* opaque element-like target */ };
    // MutationObserver isn't available in node by default; we install a
    // stub via globalThis. The test only verifies idempotence; the
    // observer instance equality is the contract.
    const ctorCalls = [];
    const stubObserver = { observe() {}, disconnect() {} };
    globalThis.MutationObserver = function () {
      ctorCalls.push(1);
      return stubObserver;
    };
    try {
      const a = api._test_installPhaseFourPlaceholderObserver({ root, requestAnimationFrame: (fn) => fn(), getPlaceholder: () => null, destroy: () => {} });
      const b = api._test_installPhaseFourPlaceholderObserver({ root, requestAnimationFrame: (fn) => fn(), getPlaceholder: () => null, destroy: () => {} });
      expect(a).toBe(b);
      expect(ctorCalls.length).toBe(1);
    } finally {
      delete globalThis.MutationObserver;
    }
  });

  it('install() returns null when MutationObserver is unavailable (defensive)', () => {
    const { api } = loadMultiview();
    api._test_phaseFourResetState();
    // MutationObserver not present in node by default — verify graceful
    // bail instead of throwing.
    const result = api._test_installPhaseFourPlaceholderObserver({
      root: {},
      requestAnimationFrame: (fn) => fn(),
      getPlaceholder: () => null,
      destroy: () => {}
    });
    expect(result).toBe(null);
  });

  it('install() returns null when requestAnimationFrame is unavailable (no debounce possible)', () => {
    const { api } = loadMultiview();
    api._test_phaseFourResetState();
    globalThis.MutationObserver = function () {
      return { observe() {}, disconnect() {} };
    };
    try {
      const result = api._test_installPhaseFourPlaceholderObserver({
        root: {},
        requestAnimationFrame: null,
        getPlaceholder: () => null,
        destroy: () => {}
      });
      expect(result).toBe(null);
    } finally {
      delete globalThis.MutationObserver;
    }
  });
});
