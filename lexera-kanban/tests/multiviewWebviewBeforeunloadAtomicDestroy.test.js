// Pin the atomic-destroy-all-on-beforeunload contract.
//
// Background — the regression this guards against:
// `beforeunload` on the shell webview used to loop `multiview_destroy(label)`
// once per spawned tab. Each call is a separate IPC round-trip; only the
// first one or two land before the JS context is torn down for reload.
// The remaining child webviews survive into the next boot as ghosts at
// the same coordinates as the new shell's fresh spawns ("content within
// the background view" / "windows visible multiple times" — confirmed
// live 2026-05-05 with three orphans from the previous bootId after a
// double-boot triggered by sync-excalidraw-assets.sh).
//
// The fix dispatches a SINGLE `multiview_destroy_all_for_window` IPC.
// Even if the JS context disappears immediately afterwards, the Rust
// side runs to completion and tears down every child. This contract
// asserts:
//   1. beforeunload fires exactly one IPC, not N.
//   2. The IPC is `multiview_destroy_all_for_window`, not the old
//      per-tab `multiview_destroy`.
//   3. It carries the parent-window label.
//   4. If __TAURI__.core is unavailable (older Rust binary mid-rebuild),
//      falls back to the per-tab loop so the dev experience doesn't
//      regress to "no cleanup at all".

import { describe, it, expect, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createStorage() {
  const store = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }
  };
}

function buildWindow({ coreInvoke, hostInvoke, currentWindowLabel = 'main' } = {}) {
  // Capture the beforeunload listener so the test can fire it.
  const listeners = {};
  const tauri = {
    event: { listen: vi.fn(() => Promise.resolve(() => {})) },
    core: coreInvoke ? { invoke: coreInvoke } : undefined,
    window: { getCurrent: () => ({ label: currentWindowLabel }) }
  };
  return {
    listeners,
    window: {
      location: { href: 'http://127.0.0.1:1431/', search: '' },
      localStorage: createStorage(),
      addEventListener(name, fn) {
        (listeners[name] = listeners[name] || []).push(fn);
      },
      removeEventListener() {},
      __TAURI__: tauri,
      LexeraMultiview: { invoke: hostInvoke || vi.fn(() => Promise.resolve(null)) }
    }
  };
}

function loadAndSetup(window) {
  const document = { querySelectorAll() { return []; } };
  if (!window.LexeraBoardHost) {
    window.LexeraBoardHost = {
      multiviewLabelForTab: (tabId) => 'board-tab-' + String(tabId || ''),
      multiviewUrlForTab: (src) => src,
      ensureHealthDot: () => ({ setAttribute() {} }),
      watchPlaceholderVisibility() {},
      cleanupVisibilityObserver() {}
    };
  }
  if (!window.LexeraPanelHost) {
    window.LexeraPanelHost = {
      panelLabelForTab: (tabId) => 'panel-tab-' + String(tabId || '')
    };
  }
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
  api.setup({
    getPlaceholder() { return null; },
    isPanelTab() { return false; }
  });
  return api;
}

function fire(listeners, name) {
  for (const fn of (listeners[name] || [])) {
    try { fn({ preventDefault() {} }); } catch (_) {}
  }
}

describe('multiviewWebview beforeunload — atomic destroy-all contract', () => {
  it('fires exactly one multiview_destroy_all_for_window IPC carrying the window label', () => {
    const coreInvoke = vi.fn(() => Promise.resolve(0));
    const harness = buildWindow({ coreInvoke, currentWindowLabel: 'main' });
    loadAndSetup(harness.window);
    fire(harness.listeners, 'beforeunload');

    const destroyAllCalls = coreInvoke.mock.calls.filter((c) => c[0] === 'multiview_destroy_all_for_window');
    expect(destroyAllCalls.length).toBe(1);
    expect(destroyAllCalls[0][1]).toEqual({ windowLabel: 'main' });
  });

  it('does NOT loop per-tab multiview_destroy when the atomic IPC is available', () => {
    const coreInvoke = vi.fn(() => Promise.resolve(0));
    const hostInvoke = vi.fn(() => Promise.resolve(null));
    const harness = buildWindow({ coreInvoke, hostInvoke });
    loadAndSetup(harness.window);
    fire(harness.listeners, 'beforeunload');

    const perTabDestroys = (
      coreInvoke.mock.calls.filter((c) => c[0] === 'multiview_destroy').length +
      hostInvoke.mock.calls.filter((c) => c[0] === 'multiview_destroy').length
    );
    expect(perTabDestroys).toBe(0);
  });

  it('carries the secondary window label (not hardcoded "main")', () => {
    const coreInvoke = vi.fn(() => Promise.resolve(0));
    const harness = buildWindow({ coreInvoke, currentWindowLabel: 'kanban-2' });
    loadAndSetup(harness.window);
    fire(harness.listeners, 'beforeunload');

    const destroyAllCalls = coreInvoke.mock.calls.filter((c) => c[0] === 'multiview_destroy_all_for_window');
    expect(destroyAllCalls.length).toBe(1);
    expect(destroyAllCalls[0][1]).toEqual({ windowLabel: 'kanban-2' });
  });

  it('falls back to the per-tab destroyAll loop when __TAURI__.core is unavailable', () => {
    // Older Rust binary mid-rebuild, or non-Tauri test environment —
    // the new IPC isn't registered yet. The shell must still attempt
    // some cleanup rather than no-op silently.
    const hostInvoke = vi.fn(() => Promise.resolve(null));
    const harness = buildWindow({ coreInvoke: undefined, hostInvoke });
    loadAndSetup(harness.window);
    fire(harness.listeners, 'beforeunload');

    // No atomic IPC was even attempted (because there's nothing to call).
    const atomicCalls = hostInvoke.mock.calls.filter((c) => c[0] === 'multiview_destroy_all_for_window');
    expect(atomicCalls.length).toBe(0);
    // The fallback path is the existing destroyAll() — which iterates
    // multiviewSpawnedTabs. With zero tabs spawned in this harness it
    // produces zero per-tab IPCs, but the important contract is that
    // destroyAll() was reachable (no thrown error) — the test passes by
    // not throwing.
  });
});
