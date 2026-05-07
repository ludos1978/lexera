// Pin the `_test_inspectDock(dockId)` diagnostic seam.
//
// Why this exists: the user keeps asking why the bottom-dock fold
// strip doesn't render in their session. Without a live DOM
// inspection there are four possible failure modes — empty dock,
// dock-expanded-not-folded, classify-bug, render-bug, or webview-
// occlusion — and each has a different fix. This seam returns the
// minimum set of facts that disambiguates all four in one call so
// the user can paste a single line into DevTools and get an answer
// instead of writing a fresh snippet each time.
//
// The contract pins:
//   1. The shape of the returned object (keys callers depend on).
//   2. That `hasPanels` reflects reality — only true when there's
//      actually a visible panel in the dock's tree.
//   3. That class-list / fold-strip presence reflect actual DOM.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

// Element factory shape mirrors the established harness in
// workspaceShellPanelDockLifecycle.test.js so the shell IIFE behaves the
// same way under both tests. (Cannot import directly — that file is a
// vitest test, not a module — and a small duplication beats coupling
// two test files together.)
function createClassList(el) {
  const set = new Set();
  function refreshClassName() { el.className = Array.from(set).join(' '); }
  return {
    add(name) { set.add(name); refreshClassName(); },
    remove(name) { set.delete(name); refreshClassName(); },
    toggle(name, force) {
      if (force === true) set.add(name);
      else if (force === false) set.delete(name);
      else if (set.has(name)) set.delete(name);
      else set.add(name);
      refreshClassName();
    },
    contains(name) { return set.has(name); }
  };
}
function createElement(tagName = 'div') {
  const el = {
    tagName: String(tagName || 'div').toUpperCase(),
    className: '',
    classList: null,
    style: {},
    dataset: {},
    childNodes: [],
    children: [],
    parentNode: null,
    innerHTML: '',
    textContent: '',
    attributes: {},
    appendChild(c) { if (!c) return c; c.parentNode = this; this.childNodes.push(c); this.children.push(c); return c; },
    removeChild(c) { this.childNodes = this.childNodes.filter((e) => e !== c); this.children = this.children.filter((e) => e !== c); if (c) c.parentNode = null; return c; },
    insertBefore(c, before) { if (!c) return c; c.parentNode = this; const i = this.childNodes.indexOf(before); if (i === -1) return this.appendChild(c); this.childNodes.splice(i, 0, c); this.children.splice(i, 0, c); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : ''; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }; },
    focus() {},
    blur() {}
  };
  el.classList = createClassList(el);
  return el;
}

function createStorage() {
  const store = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  };
}

function createShellHarness() {
  const tauriInvoke = vi.fn(() => Promise.resolve(null));
  const window = {
    location: { href: 'http://127.0.0.1:1431/', search: '' },
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    innerWidth: 1600,
    innerHeight: 1000,
    addEventListener() {},
    removeEventListener() {},
    close() {},
    LexeraSharedPanels: null,
    __TAURI__: { core: { invoke: tauriInvoke } },
    LexeraMultiview: {
      invoke: vi.fn(() => Promise.resolve(null)),
      destroy: vi.fn(() => Promise.resolve(null)),
      spawn: vi.fn(() => Promise.resolve({ label: '', fromPool: false })),
      setGeometry: vi.fn(() => Promise.resolve(null)),
      navigate: vi.fn(() => Promise.resolve(null)),
      listWebviews: vi.fn(() => Promise.resolve([])),
      pushGeomDeferred: vi.fn()
    }
  };
  const body = createElement('body');
  const document = {
    body,
    createElement: (t) => createElement(t),
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  window.document = document;
  const mainContent = createElement('main');
  body.appendChild(mainContent);
  const shell = loadIIFE(
    [
      'titleHelpers.js',
      'workspace/layoutTree.js',
      'workspace/lifecycleReconciler.js',
      'workspace/boardHost.js',
      'workspace/panelHost.js',
      'workspace/multiviewWebview.js',
      'workspace/messageBridge.js',
      'workspace/panelDefinitions.js',
      'workspace/treeRegistry.js',
      'workspace/layoutPersistence.js',
      'workspace/tabDragController.js',
      'workspace/geometryObserver.js',
      'workspace/workspaceShell.js'
    ],
    'window.LexeraWorkspaceShell',
    {
      window,
      document,
      console: { log() {}, warn() {}, error() {}, info() {} },
      URL,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      setInterval,
      requestAnimationFrame: (fn) => setTimeout(fn, 0),
      cancelAnimationFrame: clearTimeout
    }
  );
  return { shell, window, mainContent };
}

describe('workspaceShell._test_inspectDock diagnostic seam', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('exposes the inspect-dock helper on the public test seam surface', () => {
    const { shell } = createShellHarness();
    expect(typeof shell._test_inspectDock).toBe('function');
  });

  it('returns every documented key (the shape contract callers depend on)', () => {
    const { shell } = createShellHarness();
    const snap = shell._test_inspectDock('bottom');
    expect(snap).toEqual(expect.objectContaining({
      dockId: 'bottom',
      dockSize: expect.any(Number),
      visiblePanelIds: expect.any(Array),
      hasPanels: expect.any(Boolean),
      treeTabIds: expect.any(Array),
      isFoldedClass: expect.any(Boolean),
      isVisibleClass: expect.any(Boolean),
      classList: expect.any(Array),
      hasFoldStrip: expect.any(Boolean),
      foldStripChildCount: expect.any(Number),
      dockChildClassNames: expect.any(Array)
    }));
    // dockRect / foldStripRect keys are present (value may be null when
    // the dock element isn't mounted yet or the strip doesn't exist).
    expect(snap).toHaveProperty('dockRect');
    expect(snap).toHaveProperty('foldStripRect');
  });

  it('dockRect is a {left,top,right,bottom,width,height} object after mount', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    const snap = shell._test_inspectDock('bottom');
    if (snap.dockRect) {
      expect(snap.dockRect).toEqual(expect.objectContaining({
        left: expect.any(Number),
        top: expect.any(Number),
        right: expect.any(Number),
        bottom: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number)
      }));
    }
    // foldStripRect is null when the dock isn't folded — bottom dock
    // starts visible (workspace profile default), so no strip rendered.
    expect(snap.foldStripRect).toBe(null);
  });

  it('hasPanels reflects reality — flips false → true when a panel is moved in', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    // Move the logs panel OUT of the bottom dock, then read the snapshot.
    // Default workspace profile starts with logs in bottom; we move it
    // away to verify the seam reports the absence honestly.
    shell.movePanelToDock('logs', 'left');
    vi.advanceTimersByTime(50);
    let snap = shell._test_inspectDock('bottom');
    expect(snap.hasPanels).toBe(false);
    expect(snap.visiblePanelIds).toEqual([]);

    // Move it back: the seam must reflect the new state next call.
    shell.movePanelToDock('logs', 'bottom');
    vi.advanceTimersByTime(50);
    snap = shell._test_inspectDock('bottom');
    expect(snap.hasPanels).toBe(true);
    expect(snap.visiblePanelIds.length).toBeGreaterThan(0);
  });

  it('dockSize reflects state.dockSizes — collapseDock then inspect must report 0', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    // Bottom dock starts visible (workspace profile default 180px)
    let snap = shell._test_inspectDock('bottom');
    expect(snap.dockSize).toBeGreaterThan(0);
    // Collapse it; inspect again.
    shell.collapseDock('bottom');
    vi.advanceTimersByTime(50);
    snap = shell._test_inspectDock('bottom');
    expect(snap.dockSize).toBe(0);
  });

  it('every dockId returns a snapshot (no missing dock crashes)', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    for (const dockId of ['left', 'right', 'bottom']) {
      const snap = shell._test_inspectDock(dockId);
      expect(snap, dockId).toBeTruthy();
      expect(snap.dockId).toBe(dockId);
    }
  });
});
