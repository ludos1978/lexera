import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function freshBridge() {
  const win = {};
  const bridge = loadIIFE(
    'shell/bridges/backendStatusBridge.js',
    'window.LexeraBackendStatusBridge',
    { window: win }
  );
  return { bridge, win };
}

function makeDoc() {
  const body = {
    children: [],
    appendChild(el) { this.children.push(el); el.parentNode = this; }
  };
  const elements = new Map();
  return {
    body,
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        id: '',
        style: {},
        dataset: {},
        textContent: '',
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; }
      };
      const proxy = new Proxy(el, {
        set(target, prop, value) {
          if (prop === 'id' && value) elements.set(value, target);
          target[prop] = value;
          return true;
        }
      });
      return proxy;
    }
  };
}

describe('LexeraBackendStatusBridge.describe', () => {
  it('hides indicator when state is connected', () => {
    const { bridge } = freshBridge();
    const view = bridge.describe({ state: 'connected', pid: 1234, endpoint: '/x' });
    expect(view.visible).toBe(false);
    expect(view.tone).toBe('connected');
  });

  it('shows "Connecting" for waiting', () => {
    const { bridge } = freshBridge();
    const view = bridge.describe({ state: 'waiting' });
    expect(view.visible).toBe(true);
    expect(view.label).toMatch(/Connecting/);
    expect(view.tone).toBe('waiting');
  });

  it('shows attempt number for reconnecting', () => {
    const { bridge } = freshBridge();
    const view = bridge.describe({ state: 'reconnecting', attempt: 3 });
    expect(view.visible).toBe(true);
    expect(view.label).toContain('attempt 3');
    expect(view.tone).toBe('reconnecting');
  });

  it('omits attempt suffix when attempt is missing or zero', () => {
    const { bridge } = freshBridge();
    expect(bridge.describe({ state: 'reconnecting' }).label).not.toContain('attempt');
    expect(bridge.describe({ state: 'reconnecting', attempt: 0 }).label).not.toContain('attempt');
  });

  it('includes reason for unavailable', () => {
    const { bridge } = freshBridge();
    const view = bridge.describe({ state: 'unavailable', reason: 'stale descriptor' });
    expect(view.visible).toBe(true);
    expect(view.label).toContain('stale descriptor');
    expect(view.tone).toBe('unavailable');
  });

  it('falls back to a generic waiting view when payload is missing', () => {
    const { bridge } = freshBridge();
    const view = bridge.describe(null);
    expect(view.visible).toBe(true);
    expect(view.tone).toBe('waiting');
  });
});

describe('LexeraBackendStatusBridge.render', () => {
  it('creates the indicator element and shows it for non-connected states', () => {
    const { bridge } = freshBridge();
    const doc = makeDoc();
    bridge.render(doc, { state: 'waiting' });
    const el = doc.getElementById(bridge.INDICATOR_ID);
    expect(el).toBeTruthy();
    expect(el.style.display).toBe('block');
    expect(el.textContent).toMatch(/Connecting/);
    expect(el.dataset.state).toBe('waiting');
    expect(el.dataset.tone).toBe('waiting');
  });

  it('hides the indicator when state becomes connected', () => {
    const { bridge } = freshBridge();
    const doc = makeDoc();
    bridge.render(doc, { state: 'waiting' });
    bridge.render(doc, { state: 'connected', pid: 1, endpoint: '/x' });
    const el = doc.getElementById(bridge.INDICATOR_ID);
    expect(el.style.display).toBe('none');
    expect(el.textContent).toBe('');
    expect(el.dataset.state).toBe('connected');
  });

  it('reuses the same element across renders', () => {
    const { bridge } = freshBridge();
    const doc = makeDoc();
    bridge.render(doc, { state: 'waiting' });
    const first = doc.getElementById(bridge.INDICATOR_ID);
    bridge.render(doc, { state: 'reconnecting', attempt: 2 });
    const second = doc.getElementById(bridge.INDICATOR_ID);
    expect(second).toBe(first);
    expect(first.textContent).toContain('attempt 2');
  });
});

describe('LexeraBackendStatusBridge.installWith', () => {
  it('subscribes to backend-status on the runtime event bus', () => {
    const { bridge } = freshBridge();
    const listen = vi.fn();
    const ok = bridge.installWith({ event: { listen } }, { document: makeDoc() });
    expect(ok).toBe(true);
    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen.mock.calls[0][0]).toBe(bridge.EVENT_NAME);
  });

  it('renders received events through the registered handler', () => {
    const { bridge } = freshBridge();
    let handler = null;
    const listen = vi.fn((name, fn) => { handler = fn; });
    const doc = makeDoc();
    bridge.installWith({ event: { listen } }, { document: doc });
    handler({ payload: { state: 'unavailable', reason: 'no socket' } });
    const el = doc.getElementById(bridge.INDICATOR_ID);
    expect(el.style.display).toBe('block');
    expect(el.textContent).toContain('no socket');
  });

  it('returns false when the runtime is missing event.listen', () => {
    const { bridge } = freshBridge();
    expect(bridge.installWith(null)).toBe(false);
    expect(bridge.installWith({})).toBe(false);
    expect(bridge.installWith({ event: {} })).toBe(false);
  });
});
