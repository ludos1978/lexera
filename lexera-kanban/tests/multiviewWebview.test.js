import { describe, expect, it, vi } from 'vitest';
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

function loadMultiviewWebview(overrides = {}) {
  const window = overrides.window || {
    location: { href: 'http://127.0.0.1:1431/', search: '' },
    localStorage: createStorage(),
    addEventListener() {},
    removeEventListener() {}
  };
  if (!window.LexeraBoardHost) {
    window.LexeraBoardHost = {
      multiviewLabelForTab(tabId) { return 'board-tab-' + String(tabId || ''); },
      multiviewUrlForTab(src) { return src; },
      ensureHealthDot() { return { setAttribute() {} }; },
      watchPlaceholderVisibility() {},
      cleanupVisibilityObserver() {}
    };
  }
  if (!window.LexeraPanelHost) {
    window.LexeraPanelHost = {
      panelLabelForTab(tabId) { return 'panel-tab-' + String(tabId || ''); }
    };
  }
  const document = overrides.document || {
    querySelectorAll() { return []; }
  };
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
  const api = loadIIFE('workspace/multiviewWebview.js', 'window.LexeraMultiviewWebview', globals);
  return { api, window };
}

describe('LexeraMultiviewWebview native geometry mapping', () => {
  it('adds the native host-webview origin reported by Rust instead of using a hardcoded top offset', async () => {
    const invoke = vi.fn((command) => {
      if (command === 'multiview_get_host_geometry') {
        return Promise.resolve({ x: 3, y: 28, width: 1200, height: 772 });
      }
      return Promise.resolve(null);
    });
    const { api, window } = loadMultiviewWebview({
      window: {
        location: { href: 'http://127.0.0.1:1431/', search: '' },
        localStorage: createStorage(),
        addEventListener() {},
        removeEventListener() {},
        LexeraMultiview: { invoke }
      }
    });

    await api.refreshHostGeometryContext(true);

    const placeholder = {
      offsetParent: {},
      getBoundingClientRect() {
        return { left: 100, top: 40, width: 320, height: 200 };
      }
    };

    expect(api.getNativeGeometryConfig()).toMatchObject({
      hostX: 3,
      hostY: 28,
      hostWidth: 1200,
      hostHeight: 772,
      hostReady: true
    });
    expect(api.computeNativeGeometry('panel-tab-tab-1', placeholder)).toEqual({
      label: 'panel-tab-tab-1',
      x: 103,
      y: 68,
      width: 320,
      height: 200
    });
    expect(invoke).toHaveBeenCalledWith('multiview_get_host_geometry', {});
    expect(window.LexeraMultiview.invoke).toBe(invoke);
  });

  it('falls back to a zero host origin when no Tauri invoke bridge is available', async () => {
    const { api } = loadMultiviewWebview();

    await api.refreshHostGeometryContext(true);

    const placeholder = {
      offsetParent: {},
      getBoundingClientRect() {
        return { left: 12, top: 18, width: 200, height: 100 };
      }
    };

    expect(api.computeNativeGeometry('panel-tab-tab-2', placeholder)).toEqual({
      label: 'panel-tab-tab-2',
      x: 12,
      y: 18,
      width: 200,
      height: 100
    });
  });

  it('waits for the desktop invoke bridge instead of locking in a zero host origin too early', async () => {
    vi.useFakeTimers();
    try {
      const invoke = vi.fn((command) => {
        if (command === 'multiview_get_host_geometry') {
          return Promise.resolve({ x: 0, y: 28, width: 1200, height: 772 });
        }
        return Promise.resolve(null);
      });
      const window = {
        location: { href: 'http://127.0.0.1:1431/', search: '' },
        localStorage: createStorage(),
        addEventListener() {},
        removeEventListener() {},
        LexeraMultiview: {}
      };
      const { api } = loadMultiviewWebview({ window });

      const pending = api.refreshHostGeometryContext(true);
      expect(api.getHostGeometryContext().ready).toBe(false);

      window.LexeraMultiview.invoke = invoke;
      await vi.advanceTimersByTimeAsync(50);

      await expect(pending).resolves.toMatchObject({
        x: 0,
        y: 28,
        width: 1200,
        height: 772,
        ready: true
      });
      expect(invoke).toHaveBeenCalledWith('multiview_get_host_geometry', {});
    } finally {
      vi.useRealTimers();
    }
  });
});
