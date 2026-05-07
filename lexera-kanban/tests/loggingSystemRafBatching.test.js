import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loggingSystemPath = resolve(__dirname, '..', 'src', 'logging', 'loggingSystem.js');

const counters = {
  appendChildCalls: 0,
  scrollTopWrites: 0
};

function makeClassList(host) {
  const classes = new Set();
  return {
    add(...names) { names.forEach((n) => classes.add(String(n))); host.className = Array.from(classes).join(' '); },
    remove(...names) { names.forEach((n) => classes.delete(String(n))); host.className = Array.from(classes).join(' '); },
    toggle(name, force) {
      const n = String(name);
      const add = force === undefined ? !classes.has(n) : !!force;
      if (add) classes.add(n); else classes.delete(n);
      host.className = Array.from(classes).join(' ');
      return add;
    },
    contains(name) { return classes.has(String(name)); }
  };
}

function makeNode() {
  const node = {
    nodeType: 1,
    className: '',
    textContent: '',
    style: {},
    children: [],
    childNodes: [],
    appendChild(child) {
      this.children.push(child);
      this.childNodes = this.children;
      counters.appendChildCalls++;
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      this.childNodes = this.children;
    },
    set scrollTop(v) { counters.scrollTopWrites++; this._scrollTop = v; },
    get scrollTop() { return this._scrollTop || 0; },
    scrollHeight: 100,
    setAttribute() {},
    getAttribute() { return ''; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    set innerHTML(v) { if (v === '') { this.children = []; this.childNodes = []; } this._html = v; },
    get innerHTML() { return this._html || ''; },
    get firstChild() { return this.children[0] || null; }
  };
  node.classList = makeClassList(node);
  return node;
}

function loadLoggingSystem(globals) {
  const source = readFileSync(loggingSystemPath, 'utf8');
  const argNames = Object.keys(globals);
  const argValues = argNames.map((k) => globals[k]);
  const factory = new Function(...argNames, source + '\nreturn window;');
  return factory(...argValues);
}

function makeEnvironment() {
  counters.appendChildCalls = 0;
  counters.scrollTopWrites = 0;

  const logEntriesEl = makeNode();
  logEntriesEl.id = 'log-entries';
  const broadcastCalls = [];
  const rafQueue = [];
  const fragInfo = { count: 0 };

  const documentMock = {
    documentElement: { style: { setProperty() {} } },
    getElementById(id) { return id === 'log-entries' ? logEntriesEl : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return makeNode(); },
    createDocumentFragment() {
      fragInfo.count++;
      const f = makeNode();
      f.nodeType = 11;
      return f;
    },
    addEventListener() {}
  };
  const windowMock = {
    LexeraRuntime: null,
    LexeraApi: null,
    LexeraSharedPanels: null,
    LexeraMultiview: {
      invoke(name, payload) {
        if (name === 'log_broadcast') broadcastCalls.push(payload);
        return Promise.resolve();
      }
    },
    location: { search: '' },
    addEventListener() {},
    dispatchEvent() {},
    document: documentMock
  };
  loadLoggingSystem({
    window: windowMock,
    document: documentMock,
    console: { log() {}, warn() {}, error() {}, info() {} },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: windowMock.location,
    CustomEvent: function (t, i) { this.type = t; this.detail = i?.detail || {}; },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; }
  });

  return {
    window: windowMock,
    logEntriesEl,
    broadcastCalls,
    rafQueue,
    fragInfo,
    flush: () => {
      const cbs = rafQueue.splice(0, rafQueue.length);
      cbs.forEach((cb) => cb());
    }
  };
}

describe('logging rAF-batched flush', () => {
  it('keeps in-memory store synchronous but defers DOM/IPC to one rAF', () => {
    const env = makeEnvironment();

    for (let i = 0; i < 5; i++) {
      env.window.traceFrontendAction('info', 'test.target', 'msg-' + i);
    }

    // In-memory store reflects all 5 entries immediately.
    const snap = env.window.LexeraLoggingSystem.getEntriesSnapshot('frontend');
    expect(snap).toHaveLength(5);

    // DOM and IPC have NOT been touched yet.
    expect(counters.appendChildCalls).toBe(0);
    expect(counters.scrollTopWrites).toBe(0);
    expect(env.broadcastCalls).toHaveLength(0);

    // Exactly one rAF was scheduled despite 5 log calls.
    expect(env.rafQueue.length).toBe(1);
    expect(env.window.LexeraLoggingSystem._test_isLogFlushScheduled()).toBe(true);

    env.flush();

    // One DocumentFragment built, one panel.appendChild(frag), one scrollTop write.
    expect(env.fragInfo.count).toBe(1);
    expect(counters.scrollTopWrites).toBe(1);
    // IPC fired once per entry (wire format unchanged).
    expect(env.broadcastCalls).toHaveLength(5);
    // Flush flag clears.
    expect(env.window.LexeraLoggingSystem._test_isLogFlushScheduled()).toBe(false);
  });

  it('coalesces a second log within the same frame into the existing rAF', () => {
    const env = makeEnvironment();

    env.window.traceFrontendAction('info', 't', 'a');
    env.window.traceFrontendAction('info', 't', 'b');
    env.window.traceFrontendAction('info', 't', 'c');

    expect(env.rafQueue.length).toBe(1);
    env.flush();
    expect(env.rafQueue.length).toBe(0);

    // After flush, a new log starts a fresh schedule.
    env.window.traceFrontendAction('info', 't', 'd');
    expect(env.rafQueue.length).toBe(1);
  });

  it('exposes _test_flushLogQueue and _test_isLogFlushScheduled seams', () => {
    const env = makeEnvironment();
    expect(typeof env.window.LexeraLoggingSystem._test_flushLogQueue).toBe('function');
    expect(typeof env.window.LexeraLoggingSystem._test_isLogFlushScheduled).toBe('function');
  });
});
