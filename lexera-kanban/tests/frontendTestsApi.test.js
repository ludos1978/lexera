import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadFrontendTestsApi() {
  const document = {
    body: {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() {
      return {
        style: {},
        setAttribute() {},
        appendChild() {},
        removeChild() {},
        focus() {},
        select() {},
        classList: { add() {}, remove() {}, toggle() {} }
      };
    }
  };
  const window = {
    document,
    parent: null,
    console: { log() {}, warn() {}, error() {} },
    fetch: vi.fn(() => Promise.reject(new Error('network disabled'))),
    navigator: {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
  };
  window.parent = window;
  return loadIIFE('test/frontendTests.js', 'window.LexeraFrontendTests', {
    window,
    document,
    console: window.console,
    fetch: window.fetch,
    navigator: window.navigator,
    localStorage: window.localStorage,
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: vi.fn(() => 1),
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
    performance: { now: () => 0 },
    XMLHttpRequest: function () {
      this.open = function () {};
      this.send = function () {};
    }
  });
}

describe('LexeraFrontendTests public API', () => {
  it('exposes a state snapshot and copy/result helpers without a mounted panel root', () => {
    const api = loadFrontendTestsApi();

    expect(typeof api.getStateSnapshot).toBe('function');
    expect(typeof api.buildResults).toBe('function');
    expect(typeof api.copyResults).toBe('function');

    const snapshot = api.getStateSnapshot();
    expect(snapshot.totalTests).toBeGreaterThan(0);
    expect(snapshot.summary.total).toBe(snapshot.totalTests);
    expect(snapshot.summary.completed).toBe(0);
    expect(api.buildResults('all')).toContain('Frontend Test Results');
  });
});
