import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function freshFactory() {
  const win = {};
  const factory = loadIIFE('shell/requestBridge.js', 'window.LexeraRequestBridge', {
    window: win
  });
  return { factory, win };
}

function makeStubRuntime() {
  const listeners = []; // { event, handler, unsub }
  const unsubFns = [];
  const tauriRuntime = {
    event: {
      listen: vi.fn((event, handler) => {
        const entry = { event, handler };
        listeners.push(entry);
        const unsub = vi.fn();
        unsubFns.push(unsub);
        entry.unsub = unsub;
        return Promise.resolve(unsub);
      })
    }
  };
  return {
    tauri: () => tauriRuntime,
    listeners,
    unsubFns,
    fireResponse(event, payload) {
      listeners.filter((l) => l.event === event).forEach((l) => l.handler({ payload }));
    }
  };
}

describe('LexeraRequestBridge.create', () => {
  it('throws when deps are missing', () => {
    const { factory } = freshFactory();
    expect(() => factory.create({})).toThrow(/missing required deps/);
    expect(() => factory.create({ tauri: () => null })).toThrow();
    expect(() => factory.create({ invoke: () => Promise.resolve() })).toThrow();
  });

  it('exposes request and handleRequest', () => {
    const { factory } = freshFactory();
    const b = factory.create({ tauri: () => ({ event: {} }), invoke: () => Promise.resolve() });
    expect(typeof b.request).toBe('function');
    expect(typeof b.handleRequest).toBe('function');
  });
});

describe('LexeraRequestBridge.request', () => {
  it('rejects when there is no Tauri event API', async () => {
    const { factory } = freshFactory();
    const invoke = vi.fn(() => Promise.resolve());
    const b = factory.create({ tauri: () => null, invoke });
    await expect(b.request('label', 'evt', {})).rejects.toThrow(/no Tauri event API/);
  });

  it('emits via multiview_emit_to with a correlation id', async () => {
    const { factory } = freshFactory();
    const stub = makeStubRuntime();
    const invoke = vi.fn((cmd, args) => {
      // simulate the responder broadcasting the response with same _corr
      if (cmd === 'multiview_emit_to') {
        const corr = args.payload._corr;
        queueMicrotask(() => stub.fireResponse('evt-response', { _corr: corr, data: { hello: 'world' } }));
        return Promise.resolve();
      }
      return Promise.resolve();
    });
    const b = factory.create({ tauri: stub.tauri, invoke });
    const result = await b.request('panel-tab-1', 'evt', { x: 1 }, 1000);
    expect(invoke).toHaveBeenCalledWith('multiview_emit_to', expect.objectContaining({
      target: 'panel-tab-1', event: 'evt'
    }));
    expect(result).toEqual({ hello: 'world' });
  });

  it('rejects with the error message when responder reports _error', async () => {
    const { factory } = freshFactory();
    const stub = makeStubRuntime();
    const invoke = vi.fn((cmd, args) => {
      if (cmd === 'multiview_emit_to') {
        const corr = args.payload._corr;
        queueMicrotask(() => stub.fireResponse('evt-response', { _corr: corr, _error: 'boom' }));
      }
      return Promise.resolve();
    });
    const b = factory.create({ tauri: stub.tauri, invoke });
    await expect(b.request('label', 'evt', {})).rejects.toThrow(/boom/);
  });

  it('times out when no response arrives', async () => {
    const { factory } = freshFactory();
    const stub = makeStubRuntime();
    const invoke = vi.fn(() => Promise.resolve());
    const b = factory.create({ tauri: stub.tauri, invoke });
    await expect(b.request('label', 'evt', {}, 50)).rejects.toThrow(/timed out/);
  });

  it('ignores responses with mismatched _corr ids', async () => {
    const { factory } = freshFactory();
    const stub = makeStubRuntime();
    const invoke = vi.fn((cmd, args) => {
      if (cmd === 'multiview_emit_to') {
        // emit response with WRONG corr first, then the right one
        queueMicrotask(() => stub.fireResponse('evt-response', { _corr: 'wrong', data: { wrong: true } }));
        queueMicrotask(() => stub.fireResponse('evt-response', { _corr: args.payload._corr, data: { right: true } }));
      }
      return Promise.resolve();
    });
    const b = factory.create({ tauri: stub.tauri, invoke });
    const result = await b.request('label', 'evt', {});
    expect(result).toEqual({ right: true });
  });

  it('rejects when the emit invocation itself fails', async () => {
    const { factory } = freshFactory();
    const stub = makeStubRuntime();
    const invoke = vi.fn(() => Promise.reject(new Error('emit failed')));
    const b = factory.create({ tauri: stub.tauri, invoke });
    await expect(b.request('label', 'evt', {})).rejects.toThrow(/emit failed/);
  });
});

describe('LexeraRequestBridge.handleRequest', () => {
  it('rejects when there is no Tauri event API', async () => {
    const { factory } = freshFactory();
    const invoke = vi.fn(() => Promise.resolve());
    const b = factory.create({ tauri: () => null, invoke });
    await expect(b.handleRequest('evt', () => {})).rejects.toThrow(/no Tauri event API/);
  });

  it('listens for the request event and broadcasts the response with same _corr', async () => {
    const { factory } = freshFactory();
    const stub = makeStubRuntime();
    const invoke = vi.fn(() => Promise.resolve());
    const b = factory.create({ tauri: stub.tauri, invoke });
    await b.handleRequest('evt', (data) => ({ doubled: data.x * 2 }));
    expect(stub.tauri().event.listen).toHaveBeenCalledWith('evt', expect.any(Function));
    // Fire a request event and verify a response broadcast follows
    stub.fireResponse('evt', { _corr: 'corr-1', data: { x: 5 } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', expect.objectContaining({
      event: 'evt-response',
      payload: { _corr: 'corr-1', data: { doubled: 10 } }
    }));
  });

  it('catches handler exceptions and broadcasts _error', async () => {
    const { factory } = freshFactory();
    const stub = makeStubRuntime();
    const invoke = vi.fn(() => Promise.resolve());
    const b = factory.create({ tauri: stub.tauri, invoke });
    await b.handleRequest('evt', () => { throw new Error('handler boom'); });
    stub.fireResponse('evt', { _corr: 'corr-x', data: {} });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', expect.objectContaining({
      payload: { _corr: 'corr-x', _error: expect.stringContaining('handler boom') }
    }));
  });

  it('handles async handlers that resolve', async () => {
    const { factory } = freshFactory();
    const stub = makeStubRuntime();
    const invoke = vi.fn(() => Promise.resolve());
    const b = factory.create({ tauri: stub.tauri, invoke });
    await b.handleRequest('evt', async (data) => {
      await new Promise((r) => setTimeout(r, 5));
      return { async: true, x: data.x };
    });
    stub.fireResponse('evt', { _corr: 'corr-async', data: { x: 7 } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', expect.objectContaining({
      payload: { _corr: 'corr-async', data: { async: true, x: 7 } }
    }));
  });

  it('handles async handlers that reject', async () => {
    const { factory } = freshFactory();
    const stub = makeStubRuntime();
    const invoke = vi.fn(() => Promise.resolve());
    const b = factory.create({ tauri: stub.tauri, invoke });
    await b.handleRequest('evt', async () => {
      await new Promise((r) => setTimeout(r, 5));
      throw new Error('async fail');
    });
    stub.fireResponse('evt', { _corr: 'corr-r', data: {} });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(invoke).toHaveBeenCalledWith('multiview_broadcast', expect.objectContaining({
      payload: { _corr: 'corr-r', _error: expect.stringContaining('async fail') }
    }));
  });
});
