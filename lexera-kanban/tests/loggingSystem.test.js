import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loggingSystemPath = resolve(__dirname, '..', 'src', 'logging', 'loggingSystem.js');

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
      const shouldAdd = force === undefined ? !classes.has(normalized) : !!force;
      if (shouldAdd) classes.add(normalized);
      else classes.delete(normalized);
      host.className = Array.from(classes).join(' ');
      return shouldAdd;
    },
    contains(name) {
      return classes.has(String(name));
    }
  };
}

function createNode(className = '') {
  const node = {
    className,
    classList: null,
    style: {},
    textContent: '',
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    querySelector(selector) {
      if (!selector || selector[0] !== '.') return null;
      const cls = selector.slice(1);
      for (let i = 0; i < this.children.length; i++) {
        const child = this.children[i];
        if (child.classList && child.classList.contains(cls)) return child;
      }
      return null;
    }
  };
  node.classList = createClassList(node);
  className.split(/\s+/).filter(Boolean).forEach((name) => node.classList.add(name));
  return node;
}

function createRuntime(initialState = {}) {
  const values = { ...initialState };
  const listeners = {};
  return {
    state: new Proxy({}, {
      get(_, key) {
        return values[key];
      }
    }),
    onStateChange(key, fn) {
      listeners[key] = listeners[key] || [];
      listeners[key].push(fn);
    },
    setState(key, value) {
      values[key] = value;
      (listeners[key] || []).forEach((fn) => fn(value));
    }
  };
}

function loadLoggingSystem(globals) {
  const source = readFileSync(loggingSystemPath, 'utf8');
  const argNames = Object.keys(globals);
  const argValues = argNames.map((key) => globals[key]);
  const factory = new Function(...argNames, source + '\nreturn window;');
  return factory(...argValues);
}

describe('logging folded status badges', () => {
  it('refreshes folded badge counts from runtime board and presence state', () => {
    const foldedDot = createNode('ws-fold-dot');
    const badgeContainer = createNode('ws-fold-status-badges');
    const statusDot = createNode('ws-fold-status-dot');
    const connBadge = createNode('ws-fold-badge ws-fold-badge-conn');
    const logsBadge = createNode('ws-fold-badge ws-fold-badge-logs');
    const usersBadge = createNode('ws-fold-badge ws-fold-badge-users');
    const apiBadge = createNode('ws-fold-badge ws-fold-badge-api');
    badgeContainer.appendChild(statusDot);
    badgeContainer.appendChild(connBadge);
    badgeContainer.appendChild(logsBadge);
    badgeContainer.appendChild(usersBadge);
    badgeContainer.appendChild(apiBadge);

    const listeners = {};
    const runtime = createRuntime({
      activeBoardId: 'board-a',
      boardPresenceCache: { 'board-a': ['u-1', 'u-2'] }
    });
    const localStorage = {
      getItem() { return null; },
      setItem() {},
      removeItem() {}
    };
    const window = {
      LexeraRuntime: runtime,
      LexeraApi: {
        getInFlightCount() {
          return 3;
        }
      },
      LexeraSharedPanels: null,
      location: { search: '' },
      addEventListener(type, fn) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      dispatchEvent(event) {
        (listeners[event.type] || []).forEach((fn) => fn(event));
      },
      document: null
    };
    const document = {
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll(selector) {
        if (selector === '.ws-fold-status-badges') return [badgeContainer];
        if (selector === '.ws-fold-dot') return [foldedDot];
        if (selector === '.log-panel-status') return [];
        if (selector === '.log-panel-status .connection-status-btn') return [];
        return [];
      },
      addEventListener() {}
    };
    window.document = document;

    const consoleMock = {
      log() {},
      warn() {},
      error() {},
      info() {}
    };

    loadLoggingSystem({
      window,
      document,
      console: consoleMock,
      localStorage,
      location: window.location,
      CustomEvent: function CustomEvent(type, init) {
        this.type = type;
        this.detail = init && init.detail ? init.detail : {};
      },
      setTimeout,
      clearTimeout
    });

    consoleMock.log('frontend booted');
    window.setLogBackendConnectionState(true);
    window.updateFoldedLogStatusBadges();

    expect(connBadge.textContent).toBe('Connected');
    expect(logsBadge.textContent).toBe('1 logs');
    expect(usersBadge.textContent).toBe('2 users');
    expect(usersBadge.style.display).toBe('');
    expect(apiBadge.textContent).toBe('3 pending');
    expect(apiBadge.style.display).toBe('');
    expect(statusDot.classList.contains('is-connected')).toBe(true);
    expect(foldedDot.classList.contains('is-connected')).toBe(true);

    runtime.setState('activeBoardId', 'board-b');
    runtime.setState('boardPresenceCache', { 'board-a': ['u-1', 'u-2'], 'board-b': ['u-9'] });

    expect(usersBadge.textContent).toBe('1 user');
    expect(usersBadge.style.display).toBe('');
  });

  it('captures structured frontend actions in the log snapshot with level filtering', () => {
    const listeners = {};
    const window = {
      LexeraRuntime: null,
      LexeraApi: null,
      LexeraSharedPanels: null,
      location: { search: '' },
      addEventListener(type, fn) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      dispatchEvent(event) {
        (listeners[event.type] || []).forEach((fn) => fn(event));
      },
      document: null
    };
    const document = {
      documentElement: { style: { setProperty() {} } },
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement(className) { return createNode(className); },
      addEventListener() {}
    };
    window.document = document;

    loadLoggingSystem({
      window,
      document,
      console: { log() {}, warn() {}, error() {}, info() {} },
      localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
      location: window.location,
      CustomEvent: function CustomEvent(type, init) {
        this.type = type;
        this.detail = init && init.detail ? init.detail : {};
      },
      setTimeout,
      clearTimeout
    });

    window.traceFrontendAction('warn', 'settings.save', 'Saved settings', { panel: 'frontend' });
    window.traceFrontendAction('info', 'calendar.render', 'Rendered calendar');

    const warnEntries = window.LexeraLoggingSystem.getEntriesSnapshot('frontend', { level: 'warn' });
    expect(warnEntries).toHaveLength(1);
    expect(warnEntries[0]).toMatchObject({
      source: 'frontend',
      level: 'warn',
      target: 'settings.save'
    });
    expect(warnEntries[0].message).toContain('Saved settings');
    expect(warnEntries[0].message).toContain('frontend');
  });
});
