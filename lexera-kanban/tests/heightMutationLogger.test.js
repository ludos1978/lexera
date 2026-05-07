// Pin LexeraHeightMutationLogger — diagnostic logger for the
// scroll-drift bug. Watches `.card` / `.column` / `.board-stack`
// height changes via ResizeObserver + MutationObserver and emits
// one `lexeraLog('debug', '[height-mut] …')` line per change
// (50ms throttled per element).
//
// Off by default; opt in with localStorage.LEXERA_HEIGHT_MUTATION_DEBUG=1.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

function makeStubElement(classes, attrs) {
  var classList = (classes || '').split(/\s+/).filter(Boolean);
  return {
    nodeType: 1,
    classList: {
      contains: (c) => classList.indexOf(c) !== -1
    },
    getAttribute: (name) => (attrs && Object.prototype.hasOwnProperty.call(attrs, name)) ? attrs[name] : null,
    offsetHeight: 0,
    matches: (sel) => {
      var sels = sel.split(',').map(s => s.trim().replace(/^\./, ''));
      return classList.some(c => sels.indexOf(c) !== -1);
    },
    querySelectorAll: () => []
  };
}

function loadLogger({ localStorage, ResizeObserver, MutationObserver, lexeraLog, document } = {}) {
  const window = {
    localStorage: localStorage || { getItem: () => null },
    ResizeObserver: ResizeObserver,
    MutationObserver: MutationObserver,
    lexeraLog: lexeraLog
  };
  loadIIFE('debug/heightMutationLogger.js', null, {
    window,
    document: document || { readyState: 'loading', addEventListener() {} },
    setTimeout: (fn) => { /* no-op so auto-boot doesn't fire in tests */ },
    Date,
    WeakMap
  });
  return window;
}

describe('LexeraHeightMutationLogger', () => {
  let lastROCallback;
  let lastMOCallback;
  let observed;
  let RO;
  let MO;

  beforeEach(() => {
    observed = [];
    RO = vi.fn().mockImplementation(function (cb) {
      lastROCallback = cb;
      this.observe = (el) => { observed.push(el); };
      this.disconnect = vi.fn();
    });
    MO = vi.fn().mockImplementation(function (cb) {
      lastMOCallback = cb;
      this.observe = vi.fn();
      this.disconnect = vi.fn();
    });
  });

  afterEach(() => { lastROCallback = null; lastMOCallback = null; });

  it('exposes a public API on window.LexeraHeightMutationLogger', () => {
    const win = loadLogger();
    expect(win.LexeraHeightMutationLogger).toBeTruthy();
    expect(typeof win.LexeraHeightMutationLogger.start).toBe('function');
    expect(typeof win.LexeraHeightMutationLogger.stop).toBe('function');
    expect(typeof win.LexeraHeightMutationLogger.isActive).toBe('function');
  });

  it('isFlagSet returns false when localStorage flag absent', () => {
    const win = loadLogger();
    expect(win.LexeraHeightMutationLogger._test_isFlagSet()).toBe(false);
  });

  it('isFlagSet returns true when LEXERA_HEIGHT_MUTATION_DEBUG=1', () => {
    const win = loadLogger({
      localStorage: { getItem: (k) => k === 'LEXERA_HEIGHT_MUTATION_DEBUG' ? '1' : null }
    });
    expect(win.LexeraHeightMutationLogger._test_isFlagSet()).toBe(true);
  });

  it('describeElement formats card with id + idx', () => {
    const win = loadLogger();
    const el = makeStubElement('card', { 'data-card-id': 'abc123', 'data-card-index': '4' });
    expect(win.LexeraHeightMutationLogger._test_describeElement(el)).toBe('card id=abc123 idx=4');
  });

  it('describeElement formats stack and column with index', () => {
    const win = loadLogger();
    const stackEl = makeStubElement('board-stack', { 'data-stack-index': '2' });
    expect(win.LexeraHeightMutationLogger._test_describeElement(stackEl)).toBe('stack idx=2');
    const colEl = makeStubElement('column', { 'data-col-index': '7' });
    expect(win.LexeraHeightMutationLogger._test_describeElement(colEl)).toBe('column idx=7');
  });

  it('start() returns false without lexeraLog', () => {
    const win = loadLogger({ ResizeObserver: RO, MutationObserver: MO });
    expect(win.LexeraHeightMutationLogger.start({ root: {} })).toBe(false);
  });

  it('start() returns false when ResizeObserver missing', () => {
    const lex = vi.fn();
    const win = loadLogger({ MutationObserver: MO, lexeraLog: lex });
    expect(win.LexeraHeightMutationLogger.start({ root: {} })).toBe(false);
    expect(lex).toHaveBeenCalledWith('warn', expect.stringContaining('ResizeObserver unavailable'));
  });

  it('start() returns false when MutationObserver missing', () => {
    const lex = vi.fn();
    const win = loadLogger({ ResizeObserver: RO, lexeraLog: lex });
    expect(win.LexeraHeightMutationLogger.start({ root: {} })).toBe(false);
    expect(lex).toHaveBeenCalledWith('warn', expect.stringContaining('MutationObserver unavailable'));
  });

  it('start() boots observers and logs an info line', () => {
    const lex = vi.fn();
    const root = { querySelectorAll: () => [] };
    const win = loadLogger({ ResizeObserver: RO, MutationObserver: MO, lexeraLog: lex });
    expect(win.LexeraHeightMutationLogger.start({ root, lexeraLog: lex })).toBe(true);
    expect(win.LexeraHeightMutationLogger.isActive()).toBe(true);
    expect(lex).toHaveBeenCalledWith('info', expect.stringContaining('logger started'));
  });

  it('handleEntry emits initial line on first measurement', () => {
    const lex = vi.fn();
    const win = loadLogger({ ResizeObserver: RO, MutationObserver: MO, lexeraLog: lex });
    win.LexeraHeightMutationLogger.start({ root: { querySelectorAll: () => [] }, lexeraLog: lex });

    const card = makeStubElement('card', { 'data-card-id': 'c1', 'data-card-index': '0' });
    win.LexeraHeightMutationLogger._test_handleEntry({ target: card, contentRect: { height: 120 } });

    const initialCall = lex.mock.calls.find(c => String(c[1]).includes('(initial)'));
    expect(initialCall).toBeTruthy();
    expect(initialCall[0]).toBe('debug');
    expect(initialCall[1]).toContain('card id=c1 idx=0 h=120 (initial)');
  });

  it('handleEntry emits delta line on subsequent change', () => {
    const lex = vi.fn();
    const win = loadLogger({ ResizeObserver: RO, MutationObserver: MO, lexeraLog: lex });
    win.LexeraHeightMutationLogger.start({ root: { querySelectorAll: () => [] }, lexeraLog: lex });

    const card = makeStubElement('card', { 'data-card-id': 'c1', 'data-card-index': '0' });
    win.LexeraHeightMutationLogger._test_handleEntry({ target: card, contentRect: { height: 100 } });
    // Wait past the throttle window
    const realNow = Date.now;
    let nowOffset = 100;
    Date.now = () => realNow.call(Date) + nowOffset;
    nowOffset += 200;
    win.LexeraHeightMutationLogger._test_handleEntry({ target: card, contentRect: { height: 142 } });
    Date.now = realNow;

    const deltaCall = lex.mock.calls.find(c => String(c[1]).includes('delta='));
    expect(deltaCall).toBeTruthy();
    expect(deltaCall[1]).toContain('h=142 prev=100 delta=+42');
  });

  it('handleEntry skips sub-pixel noise (<1px change)', () => {
    const lex = vi.fn();
    const win = loadLogger({ ResizeObserver: RO, MutationObserver: MO, lexeraLog: lex });
    win.LexeraHeightMutationLogger.start({ root: { querySelectorAll: () => [] }, lexeraLog: lex });

    const card = makeStubElement('card', { 'data-card-id': 'c1' });
    lex.mockClear();
    win.LexeraHeightMutationLogger._test_handleEntry({ target: card, contentRect: { height: 100 } });
    const before = lex.mock.calls.length;
    win.LexeraHeightMutationLogger._test_handleEntry({ target: card, contentRect: { height: 100.4 } });
    expect(lex.mock.calls.length).toBe(before);
  });

  it('stop() disconnects observers and clears active state', () => {
    const lex = vi.fn();
    const win = loadLogger({ ResizeObserver: RO, MutationObserver: MO, lexeraLog: lex });
    win.LexeraHeightMutationLogger.start({ root: { querySelectorAll: () => [] }, lexeraLog: lex });
    expect(win.LexeraHeightMutationLogger.isActive()).toBe(true);
    win.LexeraHeightMutationLogger.stop();
    expect(win.LexeraHeightMutationLogger.isActive()).toBe(false);
  });
});
