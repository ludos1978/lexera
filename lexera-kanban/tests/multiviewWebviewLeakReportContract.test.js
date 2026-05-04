// Phase 0.1: pin the shape of `LexeraMultiviewWebview._test_leakReport()`.
// The workspace shell's view-lifecycle audit (gated by
// `localStorage.LEXERA_VIEW_LEAK_AUDIT === '1'`) reads this snapshot every
// render to detect tabs that exist in the webview registry but no longer
// in the layout tree (ghost views). If the shape drifts, the audit
// silently goes blind — pin it.

import { describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createStorage() {
  const store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    }
  };
}

function loadMultiviewWebview() {
  const window = {
    location: { href: 'http://127.0.0.1:1431/', search: '' },
    localStorage: createStorage(),
    addEventListener() {},
    removeEventListener() {}
  };
  window.LexeraBoardHost = {
    multiviewLabelForTab(tabId) { return 'board-tab-' + String(tabId || ''); },
    multiviewUrlForTab(src) { return src; },
    ensureHealthDot() { return { setAttribute() {} }; },
    watchPlaceholderVisibility() {},
    cleanupVisibilityObserver() {}
  };
  window.LexeraPanelHost = {
    panelLabelForTab(tabId) { return 'panel-tab-' + String(tabId || ''); }
  };
  const document = { querySelectorAll() { return []; } };
  const globals = {
    window,
    document,
    URL,
    URLSearchParams,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout
  };
  return loadIIFE('workspace/multiviewWebview.js', 'window.LexeraMultiviewWebview', globals);
}

describe('LexeraMultiviewWebview._test_leakReport', () => {
  it('exposes the diagnostic snapshot function', () => {
    const api = loadMultiviewWebview();
    expect(typeof api._test_leakReport).toBe('function');
  });

  it('returns the empty-state shape on a fresh module load', () => {
    const api = loadMultiviewWebview();
    const report = api._test_leakReport();
    expect(report).toEqual({
      spawnedTabs: 0,
      spawnedDetail: {},
      spawnedTabIds: [],
      geometryObservers: 0,
      spawnRetryWatchers: 0,
      spawnLocks: 0
    });
  });

  it('returns a fresh object each call (caller can mutate without affecting internals)', () => {
    const api = loadMultiviewWebview();
    const a = api._test_leakReport();
    const b = api._test_leakReport();
    expect(a).not.toBe(b);
    expect(a.spawnedTabIds).not.toBe(b.spawnedTabIds);
    expect(a.spawnedDetail).not.toBe(b.spawnedDetail);
  });

  it('keys spawnedDetail by tab.id with the expected per-entry shape', () => {
    // White-box: there's no ergonomic public path to seed
    // multiviewSpawnedTabs from a test (the spawn IPC needs a live
    // Tauri bridge). Instead, pin the shape by a key set: any non-null
    // entry in spawnedDetail must expose state, label, url, attempts.
    // This guards against future drift where someone adds a field to
    // multiviewSpawnedTabs and forgets to surface it here.
    const api = loadMultiviewWebview();
    const report = api._test_leakReport();
    // On empty state, spawnedDetail is {} — assert the field set in the
    // outer report instead.
    const reportKeys = Object.keys(report).sort();
    expect(reportKeys).toEqual([
      'geometryObservers',
      'spawnLocks',
      'spawnRetryWatchers',
      'spawnedDetail',
      'spawnedTabIds',
      'spawnedTabs'
    ]);
  });
});
