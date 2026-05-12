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

// Reason: when a panel dock folds, the panel-content tabset gets
// `display: none`, which cascades to the placeholder element making
// `placeholder.offsetParent === null`. computeNativeGeometry returns null
// in that state. Without this fix, pushGeometryForLabel silently bailed
// and the native child webview kept painting at its last known position
// — directly on top of the fold strip the shell now wants to render.
// This is the "log viewer invisible when folded" bug.
describe('LexeraMultiviewWebview.pushGeometryForLabel — hidden-placeholder handling', () => {
  it('parks the webview offscreen when the placeholder has no offsetParent (fold case)', async () => {
    const placeholder = createPlaceholder({ visible: true });
    const invoke = vi.fn((command) => {
      if (command === 'multiview_get_host_geometry') {
        return Promise.resolve({ x: 0, y: 0, width: 1200, height: 800 });
      }
      return Promise.resolve(null);
    });
    const pushGeomDeferred = vi.fn();
    const window = {
      location: { href: 'http://127.0.0.1:1431/', search: '' },
      localStorage: createStorage(),
      addEventListener() {},
      removeEventListener() {},
      LexeraMultiview: {
        invoke,
        pushGeomDeferred,
        setGeometry: () => Promise.resolve(null)
      }
    };
    const { api } = loadMultiviewWebview({ window });
    await api.refreshHostGeometryContext(true);

    // Placeholder is currently visible — geometry should be a real rect.
    api._test_pushGeometryForLabel('panel-tab-tab-a', placeholder);
    expect(pushGeomDeferred).toHaveBeenCalledTimes(1);
    expect(pushGeomDeferred).toHaveBeenLastCalledWith(expect.objectContaining({
      label: 'panel-tab-tab-a',
      width: 300,
      height: 160
    }));

    // Fold the parent dock: placeholder loses offsetParent.
    placeholder.setVisible(false);
    api._test_pushGeometryForLabel('panel-tab-tab-a', placeholder);

    // Bug regression: previously this call was a silent no-op, leaving the
    // webview at its last expanded position. After the fix it must park
    // the webview offscreen so it doesn't paint on top of the fold strip.
    expect(pushGeomDeferred).toHaveBeenCalledTimes(2);
    const lastCall = pushGeomDeferred.mock.calls[1][0];
    expect(lastCall.label).toBe('panel-tab-tab-a');
    expect(lastCall.x).toBeLessThan(-1000);
    expect(lastCall.y).toBeLessThan(-1000);
  });

  it('does nothing when label is empty (defensive guard)', async () => {
    const pushGeomDeferred = vi.fn();
    const invoke = vi.fn((command) => {
      if (command === 'multiview_get_host_geometry') {
        return Promise.resolve({ x: 0, y: 0, width: 1200, height: 800 });
      }
      return Promise.resolve(null);
    });
    const window = {
      location: { href: 'http://127.0.0.1:1431/', search: '' },
      localStorage: createStorage(),
      addEventListener() {},
      removeEventListener() {},
      LexeraMultiview: {
        invoke,
        pushGeomDeferred,
        setGeometry: () => Promise.resolve(null)
      }
    };
    const { api } = loadMultiviewWebview({ window });
    await api.refreshHostGeometryContext(true);

    const placeholder = createPlaceholder({ visible: false });
    api._test_pushGeometryForLabel('', placeholder);
    expect(pushGeomDeferred).not.toHaveBeenCalled();
  });

  // Phase 5b safety net: placeholder DOM is missing entirely (not in
  // the document at all). Phase 4.1's MutationObserver should have
  // caught DOM-mutation-driven removals, but any future code path that
  // removes a placeholder without going through destroy must not be
  // able to leave the spawned webview painting at its last position.
  it('parks the webview offscreen when the placeholder is null (orphan safety net)', async () => {
    const pushGeomDeferred = vi.fn();
    const invoke = vi.fn((command) => {
      if (command === 'multiview_get_host_geometry') {
        return Promise.resolve({ x: 0, y: 0, width: 1200, height: 800 });
      }
      return Promise.resolve(null);
    });
    const window = {
      location: { href: 'http://127.0.0.1:1431/', search: '' },
      localStorage: createStorage(),
      addEventListener() {},
      removeEventListener() {},
      LexeraMultiview: {
        invoke,
        pushGeomDeferred,
        setGeometry: () => Promise.resolve(null)
      }
    };
    const { api } = loadMultiviewWebview({ window });
    await api.refreshHostGeometryContext(true);

    api._test_pushGeometryForLabel('panel-tab-orphan', null);

    expect(pushGeomDeferred).toHaveBeenCalledTimes(1);
    const parkCall = pushGeomDeferred.mock.calls[0];
    expect(parkCall[0].label).toBe('panel-tab-orphan');
    expect(parkCall[0].x).toBeLessThan(-1000);
    expect(parkCall[0].y).toBeLessThan(-1000);
    // parkWebviewOffscreen uses immediate: true so the webview moves the
    // same frame the placeholder becomes unmeasurable.
    expect(parkCall[1]).toEqual({ immediate: true });
  });
});

// Reason: refreshAllGeometry() iterates every spawned tab and calls
// pushGeometryForLabel; during a dock-divider drag that fires per frame.
// pushGeomDeferred dedupes IPC at the lower layer, but the debug-geometry
// emit + placeholder annotation in pushGeometryForLabel still run per
// call. Slot-map diffing keyed by label skips all of that work when the
// computed geometry hasn't changed since the last successful push.
describe('LexeraMultiviewWebview.pushGeometryForLabel — slot-map diffing', () => {
  function buildHarness() {
    const invoke = vi.fn((command) => {
      if (command === 'multiview_get_host_geometry') {
        return Promise.resolve({ x: 0, y: 0, width: 1200, height: 800 });
      }
      return Promise.resolve(null);
    });
    const pushGeomDeferred = vi.fn();
    const window = {
      location: { href: 'http://127.0.0.1:1431/', search: '' },
      localStorage: createStorage(),
      addEventListener() {},
      removeEventListener() {},
      LexeraMultiview: {
        invoke,
        pushGeomDeferred,
        setGeometry: () => Promise.resolve(null)
      }
    };
    const { api } = loadMultiviewWebview({ window });
    return { api, invoke, pushGeomDeferred };
  }

  function debugEmitCalls(invoke) {
    return invoke.mock.calls
      .filter(([command, payload]) => command === 'multiview_emit_to' && payload && payload.event === 'debug-geometry')
      .map(([, payload]) => payload);
  }

  it('skips downstream emit + IPC when the next geometry equals the cached one', async () => {
    const { api, invoke, pushGeomDeferred } = buildHarness();
    await api.refreshHostGeometryContext(true);

    const placeholder = createPlaceholder({ visible: true });
    api._test_pushGeometryForLabel('panel-tab-tab-a', placeholder);
    expect(pushGeomDeferred).toHaveBeenCalledTimes(1);
    expect(debugEmitCalls(invoke).length).toBe(1);

    // Same placeholder, same rect → cached value matches, no new work.
    api._test_pushGeometryForLabel('panel-tab-tab-a', placeholder);
    expect(pushGeomDeferred).toHaveBeenCalledTimes(1);
    expect(debugEmitCalls(invoke).length).toBe(1);

    // Snapshot reflects the cached entry for the label.
    const snap = api._test_lastPushedGeometryByLabel();
    expect(snap['panel-tab-tab-a']).toMatchObject({ width: 300, height: 160 });
  });

  it('emits when the geometry changes vs the cached value', async () => {
    const { api, invoke, pushGeomDeferred } = buildHarness();
    await api.refreshHostGeometryContext(true);

    // Visible placeholder with a fixed rect, push once to seed the cache.
    const placeholder = createPlaceholder({ visible: true, rect: { left: 10, top: 20, width: 300, height: 160 } });
    api._test_pushGeometryForLabel('panel-tab-tab-a', placeholder);
    expect(pushGeomDeferred).toHaveBeenCalledTimes(1);

    // Replace with a placeholder reporting a different rect — must re-emit.
    const grown = createPlaceholder({ visible: true, rect: { left: 10, top: 20, width: 400, height: 220 } });
    api._test_pushGeometryForLabel('panel-tab-tab-a', grown);
    expect(pushGeomDeferred).toHaveBeenCalledTimes(2);
    expect(debugEmitCalls(invoke).length).toBe(2);

    const snap = api._test_lastPushedGeometryByLabel();
    expect(snap['panel-tab-tab-a']).toMatchObject({ width: 400, height: 220 });
  });

  it('caches per label — two labels don\'t collide', async () => {
    const { api, pushGeomDeferred } = buildHarness();
    await api.refreshHostGeometryContext(true);

    const phA = createPlaceholder({ visible: true });
    const phB = createPlaceholder({ visible: true, rect: { left: 400, top: 200, width: 500, height: 240 } });

    api._test_pushGeometryForLabel('panel-tab-tab-a', phA);
    api._test_pushGeometryForLabel('panel-tab-tab-b', phB);
    expect(pushGeomDeferred).toHaveBeenCalledTimes(2);

    // Repeating either label is a no-op (cache hits).
    api._test_pushGeometryForLabel('panel-tab-tab-a', phA);
    api._test_pushGeometryForLabel('panel-tab-tab-b', phB);
    expect(pushGeomDeferred).toHaveBeenCalledTimes(2);

    const snap = api._test_lastPushedGeometryByLabel();
    expect(Object.keys(snap).sort()).toEqual(['panel-tab-tab-a', 'panel-tab-tab-b']);
  });

  it('parking offscreen invalidates the cache so the next on-screen push re-emits', async () => {
    const { api, pushGeomDeferred } = buildHarness();
    await api.refreshHostGeometryContext(true);

    const placeholder = createPlaceholder({ visible: true });
    api._test_pushGeometryForLabel('panel-tab-tab-a', placeholder);
    expect(pushGeomDeferred).toHaveBeenCalledTimes(1);

    // Fold the parent dock — placeholder becomes invisible; the bug
    // regression test in the preceding describe already covers the park
    // call. Here we confirm the cache was cleared so that returning to
    // the same on-screen rect re-emits rather than diff-skipping.
    placeholder.setVisible(false);
    api._test_pushGeometryForLabel('panel-tab-tab-a', placeholder);
    expect(pushGeomDeferred).toHaveBeenCalledTimes(2); // the park call
    expect(api._test_lastPushedGeometryByLabel()['panel-tab-tab-a']).toBeUndefined();

    // Restore visibility with the same rect — must re-emit (cache empty).
    placeholder.setVisible(true);
    api._test_pushGeometryForLabel('panel-tab-tab-a', placeholder);
    expect(pushGeomDeferred).toHaveBeenCalledTimes(3);
  });
});

// Reason: cross-Tauri-webview drag (Phase 5 of the workspace-viewer task)
// needs a way to ask "which native child webview is the cursor over?".
// Native Tauri webviews are NOT iframes — `document.elementFromPoint`
// returns the top-window element under their footprint, never the
// webview itself. getWebviewLabelAtTopPoint hit-tests the spawned
// placeholders' top-window rects (placeholder rect + host-window
// origin offset) so the cross-view drag bridge can detect a hover into
// a native webview without an extra IPC round-trip.
describe('LexeraMultiviewWebview.getWebviewLabelAtTopPoint — cursor-to-webview hit-test', () => {
  function buildWith(spawnedTabRects) {
    const placeholders = {};
    Object.keys(spawnedTabRects).forEach((tabId) => {
      placeholders[tabId] = createPlaceholder({ visible: true, rect: spawnedTabRects[tabId] });
    });
    const invoke = vi.fn((command) => {
      if (command === 'multiview_get_host_geometry') {
        return Promise.resolve({ x: 100, y: 50, width: 1200, height: 800 });
      }
      return Promise.resolve(null);
    });
    const spawn = vi.fn(() => Promise.resolve(null));
    const window = {
      location: { href: 'http://127.0.0.1:1431/', search: '' },
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
      getPlaceholder(tabId) { return placeholders[tabId] || null; },
      isPanelTab() { return false; }
    });
    return { api, placeholders };
  }

  it('returns null when no webviews are spawned', async () => {
    const { api } = buildWith({});
    await api.refreshHostGeometryContext(true);
    expect(api.getWebviewLabelAtTopPoint(500, 400)).toBeNull();
  });

  it('returns the label of the webview whose placeholder contains the top-point', async () => {
    const { api, placeholders } = buildWith({
      'tab-a': { left: 10, top: 20, width: 300, height: 200 }
    });
    await api.refreshHostGeometryContext(true);
    api.ensure({ id: 'tab-a' }, placeholders['tab-a'], '/board-a.md');
    await Promise.resolve();
    await Promise.resolve();
    // Placeholder local rect: (10..310, 20..220). Host origin: (100, 50).
    // Top-window rect: (110..410, 70..270). Center is (260, 170).
    expect(api.getWebviewLabelAtTopPoint(260, 170)).toBe('board-tab-tab-a');
  });

  it('returns null for a point outside every spawned placeholder', async () => {
    const { api, placeholders } = buildWith({
      'tab-a': { left: 10, top: 20, width: 300, height: 200 }
    });
    await api.refreshHostGeometryContext(true);
    api.ensure({ id: 'tab-a' }, placeholders['tab-a'], '/board-a.md');
    await Promise.resolve();
    await Promise.resolve();
    // Far outside the top-window rect (110..410, 70..270)
    expect(api.getWebviewLabelAtTopPoint(900, 700)).toBeNull();
  });

  it('skips placeholders with offsetParent=null (folded/hidden ancestor)', async () => {
    const { api, placeholders } = buildWith({
      'tab-a': { left: 10, top: 20, width: 300, height: 200 }
    });
    await api.refreshHostGeometryContext(true);
    api.ensure({ id: 'tab-a' }, placeholders['tab-a'], '/board-a.md');
    await Promise.resolve();
    await Promise.resolve();
    // Center is normally (260,170) — but the placeholder is now hidden
    // because its parent dock folded. The hit-test must NOT report this
    // webview as the cursor target (it's not visible on screen).
    placeholders['tab-a'].setVisible(false);
    expect(api.getWebviewLabelAtTopPoint(260, 170)).toBeNull();
  });

  it('returns the FIRST matching webview when overlapping rects exist', async () => {
    // Two placeholders mapped to the same screen area — should not happen
    // in practice but the function must be deterministic. The first one
    // discovered (insertion order in the spawned-tabs map) wins.
    const { api, placeholders } = buildWith({
      'tab-a': { left: 10, top: 20, width: 300, height: 200 },
      'tab-b': { left: 10, top: 20, width: 300, height: 200 }
    });
    await api.refreshHostGeometryContext(true);
    api.ensure({ id: 'tab-a' }, placeholders['tab-a'], '/board-a.md');
    api.ensure({ id: 'tab-b' }, placeholders['tab-b'], '/board-b.md');
    await Promise.resolve();
    await Promise.resolve();
    const label = api.getWebviewLabelAtTopPoint(260, 170);
    expect(label === 'board-tab-tab-a' || label === 'board-tab-tab-b').toBe(true);
  });

  it('returns null when arguments are not numbers', async () => {
    const { api } = buildWith({});
    await api.refreshHostGeometryContext(true);
    expect(api.getWebviewLabelAtTopPoint(undefined, 100)).toBeNull();
    expect(api.getWebviewLabelAtTopPoint(100, null)).toBeNull();
    expect(api.getWebviewLabelAtTopPoint('foo', 'bar')).toBeNull();
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
    // parkWebviewOffscreen now passes `{ immediate: true }` so the
    // park IPC fires synchronously the same frame the placeholder
    // becomes invisible, without waiting for the rAF-deferred batcher.
    // See multiviewClientPushGeomImmediate.test.js for the rationale.
    expect(pushGeomDeferred).toHaveBeenCalledWith(
      { label: 'board-tab-tab-a', x: -50000, y: -50000, width: 1, height: 1 },
      { immediate: true }
    );
    expect(pushGeomDeferred).toHaveBeenCalledWith(
      { label: 'board-tab-tab-b', x: -50000, y: -50000, width: 1, height: 1 },
      { immediate: true }
    );

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
    // See sibling test above re: { immediate: true }.
    expect(pushGeomDeferred).toHaveBeenCalledWith(
      { label: 'board-tab-tab-a', x: -50000, y: -50000, width: 1, height: 1 },
      { immediate: true }
    );
  });
});
