import { afterEach, describe, expect, it, vi } from 'vitest';
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
      if (force === true) {
        classes.add(normalized);
        host.className = Array.from(classes).join(' ');
        return true;
      }
      if (force === false) {
        classes.delete(normalized);
        host.className = Array.from(classes).join(' ');
        return false;
      }
      if (classes.has(normalized)) {
        classes.delete(normalized);
        host.className = Array.from(classes).join(' ');
        return false;
      }
      classes.add(normalized);
      host.className = Array.from(classes).join(' ');
      return true;
    },
    contains(name) {
      return classes.has(String(name));
    }
  };
}

function createElement(tagName = 'div') {
  const element = {
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
    appendChild(child) {
      if (!child) return child;
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
      child.parentNode = this;
      const index = this.childNodes.indexOf(before);
      if (index === -1) return this.appendChild(child);
      this.childNodes.splice(index, 0, child);
      this.children.splice(index, 0, child);
      return child;
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'class') this.className = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : '';
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 };
    },
    focus() {},
    blur() {}
  };
  element.classList = createClassList(element);
  return element;
}

function createStorage() {
  const store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    }
  };
}

function createShellHarness() {
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
    emit(type, payload) {
      (listeners[type] || []).forEach((handler) => handler(payload));
    },
    close() {},
    LexeraSharedPanels: null
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
  const shell = loadIIFE('workspace/workspaceShell.js', 'window.LexeraWorkspaceShell', {
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

describe('workspace shell active-board notifications', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('notifies when openBoard activates a board tab', () => {
    vi.useFakeTimers();
    const { shell, mainContent } = createShellHarness();
    const onActiveBoardChanged = vi.fn();

    shell.mount({
      getMainContent: () => mainContent,
      onActiveBoardChanged
    });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' }
    ]);

    shell.openBoard('alpha');
    vi.advanceTimersByTime(150);
    expect(onActiveBoardChanged).toHaveBeenLastCalledWith('alpha');

    shell.openBoard('beta');
    vi.advanceTimersByTime(150);
    expect(onActiveBoardChanged).toHaveBeenLastCalledWith('beta');
  });

  it('notifies when an embedded pane re-activates another board tab', () => {
    vi.useFakeTimers();
    const { shell, window, mainContent } = createShellHarness();
    const onActiveBoardChanged = vi.fn();

    shell.mount({
      getMainContent: () => mainContent,
      onActiveBoardChanged
    });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' }
    ]);

    const alphaTab = shell.openBoard('alpha');
    vi.advanceTimersByTime(150);
    shell.openBoard('beta');
    vi.advanceTimersByTime(150);

    window.emit('message', {
      data: {
        type: 'lexera-pane-activated',
        pane: alphaTab.id
      }
    });
    vi.advanceTimersByTime(150);

    expect(onActiveBoardChanged).toHaveBeenLastCalledWith('alpha');
  });

  it('notifies when an embedded pane changes its board id', () => {
    vi.useFakeTimers();
    const { shell, window, mainContent } = createShellHarness();
    const onActiveBoardChanged = vi.fn();

    shell.mount({
      getMainContent: () => mainContent,
      onActiveBoardChanged
    });
    shell.onBoardsUpdated([
      { id: 'alpha', title: 'Alpha' },
      { id: 'beta', title: 'Beta' }
    ]);

    const alphaTab = shell.openBoard('alpha');
    vi.advanceTimersByTime(150);

    window.emit('message', {
      data: {
        type: 'lexera-pane-board-change',
        pane: alphaTab.id,
        boardId: 'beta'
      }
    });
    vi.advanceTimersByTime(150);

    expect(onActiveBoardChanged).toHaveBeenLastCalledWith('beta');
  });
});
