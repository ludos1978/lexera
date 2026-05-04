// Phase 1.1 / 1.2: pin that removing a panel tab from a side dock (or
// closing a base panel) destroys the corresponding native webview.
//
// Pre-fix: `removePanelFromDocks` and the base-panel branch of
// `closePanelView` spliced tabs out of leaves without calling
// `multiview.destroy`, leaving Tauri child webviews painting on screen
// at their last position ("views all around" regression).
//
// Test surface: drive a panel into a side dock via `movePanelToDock`,
// then either move it to center via `openPanelInCenter` (exercises
// `removePanelFromDocks`) or close it via `closePanelView` (exercises
// the base-panel branch). Spy on `multiview_destroy` IPC to verify
// the webview lifecycle is closed out.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createClassList(host) {
  const classes = new Set();
  return {
    add(...names) { names.forEach((n) => classes.add(String(n))); host.className = Array.from(classes).join(' '); },
    remove(...names) { names.forEach((n) => classes.delete(String(n))); host.className = Array.from(classes).join(' '); },
    toggle(name, force) {
      const n = String(name);
      if (force === true) { classes.add(n); host.className = Array.from(classes).join(' '); return true; }
      if (force === false) { classes.delete(n); host.className = Array.from(classes).join(' '); return false; }
      if (classes.has(n)) { classes.delete(n); host.className = Array.from(classes).join(' '); return false; }
      classes.add(n); host.className = Array.from(classes).join(' '); return true;
    },
    contains(name) { return classes.has(String(name)); }
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

function createShellHarness({ invokeSpy } = {}) {
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
    // The multiview bridge: a stub that tracks which IPCs were called.
    LexeraMultiview: {
      invoke: invokeSpy || vi.fn(() => Promise.resolve(null)),
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
      'workspace/boardHost.js',
      'workspace/panelHost.js',
      'workspace/multiviewWebview.js',
      'workspace/messageBridge.js',
      'workspace/panelDefinitions.js',
      'workspace/treeRegistry.js',
      'workspace/layoutPersistence.js',
      'workspace/tabDragController.js',
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
      requestAnimationFrame: (fn) => setTimeout(fn, 0),
      cancelAnimationFrame: clearTimeout
    }
  );
  return { shell, window, mainContent };
}

describe('workspace shell panel-dock lifecycle (Phase 1.1 + 1.2)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('moving a side-dock panel to center destroys the side-dock webview (Phase 1.1)', () => {
    vi.useFakeTimers();
    const { shell, window, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    // Place the dashboard panel in the left dock.
    shell.movePanelToDock('dashboard', 'left');
    vi.advanceTimersByTime(50);
    // Snapshot how many destroy calls happened just from setup.
    const destroyCallsBefore = window.LexeraMultiview.destroy.mock.calls.length;

    // Move the SAME panel kind to center. The base-panel-id "dashboard"
    // gets removed from the left dock — and the corresponding webview
    // must be destroyed (Phase 1.1 fix).
    shell.openPanelInCenter('dashboard');
    vi.advanceTimersByTime(50);

    const destroyCallsAfter = window.LexeraMultiview.destroy.mock.calls.length;
    expect(destroyCallsAfter).toBeGreaterThan(destroyCallsBefore);
  });

  it('closing a base panel via closePanelView destroys its webview (Phase 1.2)', () => {
    vi.useFakeTimers();
    const { shell, window, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    shell.movePanelToDock('logs', 'bottom');
    vi.advanceTimersByTime(50);
    const destroyBefore = window.LexeraMultiview.destroy.mock.calls.length;

    shell.closePanelView('logs');
    vi.advanceTimersByTime(50);

    const destroyAfter = window.LexeraMultiview.destroy.mock.calls.length;
    expect(destroyAfter).toBeGreaterThan(destroyBefore);
  });

  it('full-rebuild orphan reaper does not destroy live tabs (Phase 1.4 no-regression)', () => {
    vi.useFakeTimers();
    const { shell, window, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' }
    ]);
    shell.openBoard('alpha');
    shell.openBoard('beta');
    vi.advanceTimersByTime(50);
    const destroyBefore = window.LexeraMultiview.destroy.mock.calls.length;

    // Force a re-render. Both boards stay in the tree; the reaper must
    // NOT destroy either (only orphans — tab.ids no longer in any tree
    // — qualify for reaping).
    shell.render();
    vi.advanceTimersByTime(50);

    expect(window.LexeraMultiview.destroy.mock.calls.length).toBe(destroyBefore);
  });

  it('full-rebuild orphan reaper destroys frameCache entries with no tree presence (Phase 1.4)', () => {
    vi.useFakeTimers();
    const { shell, window, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' }
    ]);
    shell.openBoard('alpha');
    vi.advanceTimersByTime(50);

    // Simulate a missed splice path: inject an orphan frame with the
    // multiview marker so removeFrame routes through multiview.destroy.
    // This is what the reaper exists to defend against — any future
    // mutation path that escapes Phase 1.1-1.3 should be caught here.
    shell._test_seedOrphanFrame('phantom-tab-9999');
    const destroyBefore = window.LexeraMultiview.destroy.mock.calls.length;

    // Force the full-rebuild branch of render() — that's where the
    // reaper runs. Adding a tab inside an existing leaf only changes
    // the structure signature, not leaf topology, so syncDomState
    // patches incrementally and the reaper is bypassed. Invalidating
    // both signatures forces the wipe-and-rebuild path.
    shell._test_forceFullRebuild();
    shell.render();
    vi.advanceTimersByTime(50);

    // multiviewWebview.destroy() resolves the webview label from the
    // tabId via `boardHost.multiviewLabelForTab` (`board-tab-<tabId>`),
    // so the IPC argument is the full label, not the bare tabId.
    const destroyArgs = window.LexeraMultiview.destroy.mock.calls
      .slice(destroyBefore)
      .map((args) => args[0]);
    expect(destroyArgs.some((label) => label.indexOf('phantom-tab-9999') !== -1)).toBe(true);
  });

  it('flattenToActiveLeaf (split-disable action) destroys webviews for non-active tabs (Phase 1.3)', () => {
    vi.useFakeTimers();
    const { shell, window, mainContent } = createShellHarness();
    shell.mount({ getMainContent: () => mainContent });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' },
      { id: 'gamma', title: 'Gamma' }
    ]);
    shell.openBoard('alpha');
    shell.openBoard('beta');
    shell.openBoard('gamma');
    vi.advanceTimersByTime(100);
    const destroyBefore = window.LexeraMultiview.destroy.mock.calls.length;

    // Trigger the action that calls flattenToActiveLeaf. Two of the
    // three center tabs become orphans; both must have their webview
    // destroyed.
    expect(shell.handleBoardAction('split-disable')).toBe(true);
    vi.advanceTimersByTime(50);

    const destroyAfter = window.LexeraMultiview.destroy.mock.calls.length;
    expect(destroyAfter - destroyBefore).toBeGreaterThanOrEqual(2);
  });
});
