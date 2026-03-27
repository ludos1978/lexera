/**
 * Startup Smoke Tests — verify all scripts load without crashes and
 * all modules are available on window after loading.
 *
 * Catches the class of bugs caused by module extractions: missing
 * function definitions, broken getter copies, undefined globals
 * in strict mode, etc.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createContext, runInContext } from 'vm';

function createBrowserSandbox() {
  const sandbox = createContext({
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, Proxy, Array, Object, String, Number, JSON, Math, Date,
    Error, TypeError, ReferenceError, RegExp, Map, Set, WeakMap, WeakSet,
    Symbol, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    URL, URLSearchParams,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    Event: class { constructor(t) { this.type = t; } preventDefault() {} stopPropagation() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => new Proxy({}, { get: () => '0' }),
    CSS: { supports: () => false },
    fetch: () => Promise.reject('no network'),
    navigator: { clipboard: { writeText: () => Promise.resolve() }, userAgent: 'test' },
    location: { href: 'http://127.0.0.1:1431/', search: '', hostname: '127.0.0.1', protocol: 'http:' },
    localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    sessionStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    Uint8Array, ArrayBuffer,
    TextEncoder: class { encode(s) { return Buffer.from(s); } },
    TextDecoder: class { decode(b) { return Buffer.from(b).toString(); } },
    Blob: class { constructor() {} },
    Image: class { set src(v) {} addEventListener() {} },
    HTMLElement: class {},
    performance: { now: () => Date.now() },
    ClipboardItem: class { constructor() {} },
  });

  // DOM mock
  runInContext(`
    function _mkStyle() { return { setProperty(){}, getPropertyValue(){ return ''; }, removeProperty(){}, cssText: '' }; }
    var _m = {
      classList: { add(){}, remove(){}, toggle(){ return false; }, contains(){ return false; } },
      style: _mkStyle(), setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
      addEventListener(){}, removeEventListener(){},
      querySelector(){ return null; }, querySelectorAll(){ return []; },
      closest(){ return null; },
      appendChild(c){ return c; }, removeChild(){}, insertBefore(){},
      parentNode: null, innerHTML: '', textContent: '', value: '',
      isConnected: true, tagName: 'DIV',
      offsetWidth: 100, offsetHeight: 50, clientWidth: 100, clientHeight: 50,
      scrollTop: 0, scrollHeight: 0,
      getBoundingClientRect(){ return { top:0, left:0, right:100, bottom:50, width:100, height:50 }; },
      scrollIntoView(){}, focus(){}, blur(){}, select(){}, click(){}, remove(){},
      cloneNode(){ return _n(); },
      childNodes: [], children: [], firstChild: null, lastChild: null,
      firstElementChild: null, lastElementChild: null, dataset: {}, id: ''
    };
    function _n() {
      var e = Object.create(_m);
      e.classList = { add(){}, remove(){}, toggle(){ return false; }, contains(){ return false; } };
      e.style = _mkStyle(); e.childNodes = []; e.children = []; e.dataset = {};
      return e;
    }
    var document = {
      getElementById(){ return _n(); }, querySelector(){ return _n(); },
      querySelectorAll(){ return []; },
      addEventListener(){}, removeEventListener(){},
      createElement(t){ var el = _n(); el.tagName = t.toUpperCase(); return el; },
      createTextNode(t){ return { textContent: t }; },
      createDocumentFragment(){ return _n(); },
      documentElement: _n(), body: _n(), head: _n(),
      readyState: 'loading', dispatchEvent(){}, activeElement: null
    };
    document.documentElement.setAttribute = function(){};
    document.body.classList = { add(){}, remove(){}, toggle(){ return false; }, contains(){ return false; } };
    document.body.appendChild = function(c){ return c; };
    document.body.style = _mkStyle();
    var window = this;
    window.document = document;
    window.addEventListener = function(){};
    window.removeEventListener = function(){};
    window.dispatchEvent = function(){};
    var self = window;
    var globalThis = window;
  `, sandbox);

  return sandbox;
}

function loadAllScripts(sandbox) {
  const html = readFileSync('src/index.html', 'utf8');
  const re = /<script src="([^"]+)"><\/script>/g;
  const scripts = [];
  let m;
  while ((m = re.exec(html)) !== null) scripts.push(m[1]);

  const errors = [];
  for (const s of scripts) {
    try {
      runInContext(readFileSync('src/' + s, 'utf8'), sandbox, { filename: s, timeout: 5000 });
    } catch (e) {
      errors.push({ script: s, error: e.message });
    }
  }
  return { scripts, errors };
}

describe('Frontend Startup Smoke Tests', () => {
  let sandbox;
  let result;

  it('loads all scripts without crashes', () => {
    sandbox = createBrowserSandbox();
    result = loadAllScripts(sandbox);
    expect(result.errors).toEqual([]);
  });

  it('loaded all script files', () => {
    expect(result.scripts.length).toBeGreaterThan(60);
  });

  const CRITICAL_MODULES = [
    'LexeraRuntime',
    'LexeraBoardList',
    'LexeraOrderHelpers',
    'LexeraWorkspaceShell',
    'LexeraPollingService',
    'LexeraColumnContextMenu',
    'LexeraRowStackMenu',
    'LexeraKeyboardNavigation',
    'LexeraCanvasMode',
    'LexeraCanvasPan',
    'LexeraCanvasLayout',
    'LexeraSidebarSync',
    'LexeraSidebarTree',
    'LexeraSharedPanels',
    'LexeraEmbedMenu',
    'LexeraActionRegistry',
    'LexeraTagSystem',
    'LexeraDropZoneIndicators',
    'CardEditor',
    'InlineCardEditor',
    'CardContextMenu',
    'BoardSearchReplace',
    'BoardStatsFilter',
    'ContextMenuBuilders',
  ];

  for (const mod of CRITICAL_MODULES) {
    it(`module ${mod} is available on window`, () => {
      expect(sandbox.window[mod] || sandbox[mod]).toBeTruthy();
    });
  }

  it('LexeraRuntime has state store', () => {
    const rt = sandbox.window.LexeraRuntime || sandbox.LexeraRuntime;
    expect(typeof rt.getState).toBe('function');
    expect(typeof rt.setState).toBe('function');
    expect(typeof rt.on).toBe('function');
    expect(typeof rt.emit).toBe('function');
  });
});
