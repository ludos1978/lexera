// Verifies the no-multiview-IPC fallback path in
// `buildMultiviewPanelPlaceholder`. Background: the lexera-backend
// management window has no Tauri multiview Rust commands and no
// `window.LexeraMultiview` IPC client, so child-webview spawn would
// hang at "spawning…" forever. The shell must instead embed the panel
// DOM element from `getPanelElement(panelId)` directly into the
// placeholder, the same way the pre-multiview architecture rendered
// panels.
import { describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createClassList(host) {
  const classes = new Set();
  return {
    add(...names) {
      names.forEach((name) => classes.add(String(name)));
      host.className = Array.from(classes).join(' ');
    },
    remove(...names) {
      names.forEach((name) => classes.delete(String(name)));
      host.className = Array.from(classes).join(' ');
    },
    toggle(name, force) {
      const normalized = String(name);
      if (force === true) { classes.add(normalized); host.className = Array.from(classes).join(' '); return true; }
      if (force === false) { classes.delete(normalized); host.className = Array.from(classes).join(' '); return false; }
      if (classes.has(normalized)) { classes.delete(normalized); host.className = Array.from(classes).join(' '); return false; }
      classes.add(normalized); host.className = Array.from(classes).join(' '); return true;
    },
    contains(name) { return classes.has(String(name)); }
  };
}

function createElement(tagName = 'div') {
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    className: '',
    classList: null,
    // Real CSSStyleDeclaration exposes setProperty / removeProperty —
    // workspaceShell.js calls `style.removeProperty('flex')` etc. when
    // resetting cached panel elements, so the mock must answer those.
    style: {
      setProperty(name, value) { this[String(name)] = value == null ? '' : String(value); },
      removeProperty(name) { delete this[String(name)]; }
    },
    dataset: {},
    childNodes: [],
    children: [],
    parentNode: null,
    innerHTML: '',
    textContent: '',
    attributes: {},
    appendChild(child) {
      if (!child) return child;
      if (child.parentNode && child.parentNode !== this) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.childNodes = this.childNodes.filter((entry) => entry !== child);
      this.children = this.children.filter((entry) => entry !== child);
      if (child) child.parentNode = null;
      return child;
    },
    insertBefore(child, before) {
      if (!child) return child;
      if (child.parentNode && child.parentNode !== this) child.parentNode.removeChild(child);
      child.parentNode = this;
      const index = this.childNodes.indexOf(before);
      if (index === -1) return this.appendChild(child);
      this.childNodes.splice(index, 0, child);
      this.children.splice(index, 0, child);
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'class') this.className = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : '';
    },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }; }
  };
  element.classList = createClassList(element);
  return element;
}

function createStorage() {
  const store = {};
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; }
  };
}

function createHarness(extraWindowProps = {}) {
  const listeners = {};
  const window = {
    location: { href: 'http://127.0.0.1:1431/', search: '' },
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    innerWidth: 1600,
    innerHeight: 1000,
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((entry) => entry !== handler);
    },
    emit(type, payload) { (listeners[type] || []).forEach((handler) => handler(payload)); },
    close() {},
    ...extraWindowProps
  };
  const body = createElement('body');
  const document = {
    body,
    createElement: (tagName) => createElement(tagName),
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  window.document = document;
  const mainContent = createElement('main');
  body.appendChild(mainContent);
  const shell = loadIIFE([
    'titleHelpers.js', 'workspace/layoutTree.js', 'workspace/lifecycleReconciler.js',
    'workspace/boardHost.js', 'workspace/panelHost.js', 'workspace/multiviewWebview.js',
    'workspace/messageBridge.js', 'workspace/panelDefinitions.js', 'workspace/treeRegistry.js',
    'workspace/layoutPersistence.js', 'workspace/tabDragController.js', 'workspace/geometryObserver.js', 'workspace/workspaceShell.js'
  ], 'window.LexeraWorkspaceShell', {
    window,
    document,
    console: { log() {}, warn() {}, error() {}, info() {} },
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout
  });
  return { shell, window, mainContent };
}

describe('buildMultiviewPanelPlaceholder — multiview-IPC unavailable', () => {
  it('embeds the panel DOM element when window.LexeraMultiview is missing', () => {
    const { shell, window, mainContent } = createHarness();
    expect(window.LexeraMultiview).toBeUndefined();

    const fakePanelEl = createElement('div');
    fakePanelEl.setAttribute('data-shell-panel', 'logs');
    window.LexeraSharedPanels = {
      createPanelElement: () => fakePanelEl
    };

    shell.mount({
      getMainContent: () => mainContent,
      getAllowedPanelKinds: () => ['logs', 'backendSettings', 'files']
    });

    const tab = { id: 'tab-fallback-test', kind: 'panel', panelId: 'logs' };
    const placeholder = shell._test_buildMultiviewPanelPlaceholder(tab, 'logs', 'logs');

    expect(placeholder).toBeTruthy();
    expect(placeholder.getAttribute('data-multiview')).toBe('1');
    expect(placeholder.getAttribute('data-tab-id')).toBe('tab-fallback-test');
    expect(fakePanelEl.parentNode).toBe(placeholder);
    expect(placeholder.classList.contains('is-loaded')).toBe(true);
    expect(placeholder.innerHTML).toBe('');
  });

  it('reuses the cached placeholder and re-attaches the panel element on second call', () => {
    const { shell, window, mainContent } = createHarness();
    const fakePanelEl = createElement('div');
    window.LexeraSharedPanels = { createPanelElement: () => fakePanelEl };
    shell.mount({
      getMainContent: () => mainContent,
      getAllowedPanelKinds: () => ['logs']
    });

    const tab = { id: 'tab-reuse', kind: 'panel', panelId: 'logs' };
    const first = shell._test_buildMultiviewPanelPlaceholder(tab, 'logs', 'logs');
    const second = shell._test_buildMultiviewPanelPlaceholder(tab, 'logs', 'logs');

    expect(second).toBe(first);
    expect(fakePanelEl.parentNode).toBe(first);
  });

  it('skips the multiview spawn path when LexeraMultiview.spawn is missing', () => {
    let spawnCalled = false;
    const { shell, window, mainContent } = createHarness({
      LexeraMultiview: {
        // .spawn intentionally absent — simulates partial IPC client.
        destroy: () => { spawnCalled = true; }
      }
    });
    const fakePanelEl = createElement('div');
    window.LexeraSharedPanels = { createPanelElement: () => fakePanelEl };
    shell.mount({
      getMainContent: () => mainContent,
      getAllowedPanelKinds: () => ['logs']
    });

    const tab = { id: 'tab-no-spawn', kind: 'panel', panelId: 'logs' };
    const placeholder = shell._test_buildMultiviewPanelPlaceholder(tab, 'logs', 'logs');

    expect(spawnCalled).toBe(false);
    expect(fakePanelEl.parentNode).toBe(placeholder);
    expect(placeholder.classList.contains('is-loaded')).toBe(true);
  });
});
