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

function createPlaceholder({ active = true, visible = true, rect = { left: 10, top: 20, width: 300, height: 160 } } = {}) {
  const classes = new Set(active ? ['is-active'] : []);
  return {
    isConnected: visible,
    offsetParent: visible ? {} : null,
    innerHTML: '',
    classList: {
      contains(name) { return classes.has(name); },
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); }
    },
    setActive(nextActive) {
      if (nextActive) classes.add('is-active');
      else classes.delete('is-active');
    },
    setVisible(nextVisible) {
      visible = !!nextVisible;
      this.isConnected = visible;
      this.offsetParent = visible ? {} : null;
    },
    getBoundingClientRect() {
      return visible ? rect : { ...rect, width: 0, height: 0 };
    },
    getAttribute() { return ''; },
    setAttribute() {},
    querySelector() { return null; }
  };
}

function multiviewSetVisibleCalls(invoke) {
  return invoke.mock.calls
    .filter(([command]) => command === 'multiview_set_visible')
    .map(([, payload]) => payload);
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

describe('LexeraMultiviewWebview.setAllVisible suppression refcount', () => {
  it('passes the owning top-level window label as the child webview parent', async () => {
    const placeholder = createPlaceholder();
    const invoke = vi.fn((command) => {
      if (command === 'multiview_get_host_geometry') {
        return Promise.resolve({ x: 0, y: 0, width: 1200, height: 800 });
      }
      return Promise.resolve(null);
    });
    const spawn = vi.fn(() => Promise.resolve(null));
    const window = {
      location: { href: 'http://127.0.0.1:1431/?windowLabel=kanban-2', search: '?windowLabel=kanban-2' },
      localStorage: createStorage(),
      addEventListener() {},
      removeEventListener() {},
      LexeraMultiview: {
        invoke,
        spawn,
        pushGeomDeferred: vi.fn(),
        setGeometry: () => Promise.resolve(null)
      }
    };
    const { api } = loadMultiviewWebview({ window });
    api.setup({
      getHostWindowLabel() { return 'kanban-2'; },
      getPlaceholder(tabId) { return tabId === 'tab-a' ? placeholder : null; },
      isPanelTab() { return false; }
    });
    await api.refreshHostGeometryContext(true);

    api.ensure({ id: 'tab-a' }, placeholder, '/board-a.md');
    await Promise.resolve();
    await Promise.resolve();

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      label: 'board-tab-tab-a',
      parentWindow: 'kanban-2'
    }));
  });

  it('only fires hide/show IPCs at the 0↔1 suppression boundary so concurrent suppressors compose', async () => {
    const placeholders = {
      'tab-a': createPlaceholder(),
      'tab-b': createPlaceholder()
    };
    const invoke = vi.fn((command) => {
      if (command === 'multiview_get_host_geometry') {
        return Promise.resolve({ x: 0, y: 0, width: 1200, height: 800 });
      }
      return Promise.resolve(null);
    });
    const pushGeomDeferred = vi.fn();
    const spawn = vi.fn(() => Promise.resolve(null));
    const window = {
      location: { href: 'http://127.0.0.1:1431/', search: '' },
      localStorage: createStorage(),
      addEventListener() {},
      removeEventListener() {},
      LexeraMultiview: {
        invoke,
        spawn,
        pushGeomDeferred,
        setGeometry: () => Promise.resolve(null)
      }
    };
    const { api } = loadMultiviewWebview({ window });
    api.setup({
      getPlaceholder(tabId) { return placeholders[tabId] || null; },
      isPanelTab() { return false; }
    });
    await api.refreshHostGeometryContext(true);

    api.ensure({ id: 'tab-a' }, placeholders['tab-a'], '/board-a.md');
    api.ensure({ id: 'tab-b' }, placeholders['tab-b'], '/board-b.md');
    await Promise.resolve();
    await Promise.resolve();
    expect(spawn).toHaveBeenCalledTimes(2);

    invoke.mockClear();
    pushGeomDeferred.mockClear();
    placeholders['tab-b'].setActive(false);

    api.setAllVisible(false);
    api.setAllVisible(false);
    api.setAllVisible(true);
    expect(multiviewSetVisibleCalls(invoke)).toEqual([
      { label: 'board-tab-tab-a', visible: false },
      { label: 'board-tab-tab-b', visible: false }
    ]);

    api.setAllVisible(true);
    expect(multiviewSetVisibleCalls(invoke)).toEqual([
      { label: 'board-tab-tab-a', visible: false },
      { label: 'board-tab-tab-b', visible: false },
      { label: 'board-tab-tab-a', visible: true },
      { label: 'board-tab-tab-b', visible: false }
    ]);
    expect(pushGeomDeferred).toHaveBeenCalledWith({
      label: 'board-tab-tab-a', x: -50000, y: -50000, width: 1, height: 1
    });
    expect(pushGeomDeferred).toHaveBeenCalledWith({
      label: 'board-tab-tab-b', x: -50000, y: -50000, width: 1, height: 1
    });

    api.setAllVisible(true);
    api.setAllVisible(true);
    expect(multiviewSetVisibleCalls(invoke)).toHaveLength(4);
  });

  it('spawns new webviews offscreen and hidden while suppression is already active', async () => {
    const placeholder = createPlaceholder();
    const invoke = vi.fn((command) => {
      if (command === 'multiview_get_host_geometry') {
        return Promise.resolve({ x: 0, y: 0, width: 1200, height: 800 });
      }
      return Promise.resolve(null);
    });
    const pushGeomDeferred = vi.fn();
    const spawn = vi.fn(() => Promise.resolve(null));
    const window = {
      location: { href: 'http://127.0.0.1:1431/', search: '' },
      localStorage: createStorage(),
      addEventListener() {},
      removeEventListener() {},
      LexeraMultiview: {
        invoke,
        spawn,
        pushGeomDeferred,
        setGeometry: () => Promise.resolve(null)
      }
    };
    const { api } = loadMultiviewWebview({ window });
    api.setup({
      getPlaceholder(tabId) { return tabId === 'tab-a' ? placeholder : null; },
      isPanelTab() { return false; }
    });
    await api.refreshHostGeometryContext(true);

    api.setAllVisible(false);
    invoke.mockClear();
    api.ensure({ id: 'tab-a' }, placeholder, '/board-a.md');
    await Promise.resolve();
    await Promise.resolve();

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      label: 'board-tab-tab-a',
      x: -50000,
      y: -50000,
      width: 1,
      height: 1
    }));
    expect(multiviewSetVisibleCalls(invoke)).toEqual([
      { label: 'board-tab-tab-a', visible: false }
    ]);
    expect(pushGeomDeferred).toHaveBeenCalledWith({
      label: 'board-tab-tab-a', x: -50000, y: -50000, width: 1, height: 1
    });
  });
});
