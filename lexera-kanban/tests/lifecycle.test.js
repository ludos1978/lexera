import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function freshFactory() {
  const win = {};
  const factory = loadIIFE('shell/lifecycle.js', 'window.LexeraLifecycle', {
    window: win
  });
  return { factory, win };
}

function makeStubTransport(overrides = {}) {
  return {
    spawn: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(() => Promise.resolve()),
    setGeometry: vi.fn(() => Promise.resolve()),
    navigateWebview: vi.fn(() => Promise.resolve()),
    listWebviews: vi.fn(() => Promise.resolve([])),
    ...overrides
  };
}

describe('LexeraLifecycle.defaultConfig', () => {
  it('returns sensible defaults for empty search', () => {
    const { factory } = freshFactory();
    const cfg = factory.defaultConfig('');
    expect(cfg.softCap).toBe(8);
    expect(cfg.poolSize).toBe(0);
    expect(cfg.poolUrl).toBe('multiview-demo.html');
    expect(cfg.pinnedLabels).toContain('inspector');
  });

  it('reads ?multiview-cap= override', () => {
    const { factory } = freshFactory();
    expect(factory.defaultConfig('?multiview-cap=20').softCap).toBe(20);
  });

  it('reads ?multiview-pool= override (including 0 to disable)', () => {
    const { factory } = freshFactory();
    expect(factory.defaultConfig('?multiview-pool=2').poolSize).toBe(2);
    expect(factory.defaultConfig('?multiview-pool=0').poolSize).toBe(0);
  });

  it('ignores invalid override values', () => {
    const { factory } = freshFactory();
    expect(factory.defaultConfig('?multiview-cap=NaN').softCap).toBe(8);
    expect(factory.defaultConfig('?multiview-cap=-5').softCap).toBe(8);
  });
});

describe('LexeraLifecycle.create', () => {
  it('throws when transport deps are missing', () => {
    const { factory } = freshFactory();
    expect(() => factory.create({})).toThrow(/missing required transport deps/);
    expect(() => factory.create({ spawn: () => {} })).toThrow();
  });

  it('exposes the lifecycle API surface', () => {
    const { factory } = freshFactory();
    const lc = factory.create({ ...makeStubTransport(), locationSearch: '' });
    expect(typeof lc.configure).toBe('function');
    expect(typeof lc.status).toBe('function');
    expect(typeof lc.spawn).toBe('function');
    expect(typeof lc.touch).toBe('function');
    expect(typeof lc.evictOldestIfOverCap).toBe('function');
    expect(typeof lc.refillPool).toBe('function');
  });
});

describe('LexeraLifecycle.touch + status', () => {
  it('records freshness timestamps per label', () => {
    const { factory } = freshFactory();
    const lc = factory.create({ ...makeStubTransport(), locationSearch: '' });
    lc.touch('board-tab-1');
    lc.touch('board-tab-2');
    const fresh = lc.status().freshness;
    expect(fresh['board-tab-1']).toBeTypeOf('number');
    expect(fresh['board-tab-2']).toBeTypeOf('number');
  });
});

describe('LexeraLifecycle.spawn', () => {
  it('cold spawn when pool is empty: returns { label, fromPool: false }', async () => {
    const { factory } = freshFactory();
    const t = makeStubTransport();
    const lc = factory.create({ ...t, locationSearch: '' });
    const result = await lc.spawn({ label: 'board-tab-1', url: 'index.html?board=a', x: 0, y: 0, width: 100, height: 50 });
    expect(t.spawn).toHaveBeenCalledOnce();
    expect(result).toEqual({ label: 'board-tab-1', fromPool: false });
    expect(lc.status().freshness['board-tab-1']).toBeTypeOf('number');
  });

  it('triggers eviction after spawn', async () => {
    const { factory } = freshFactory();
    const t = makeStubTransport();
    const lc = factory.create({ ...t, locationSearch: '' });
    await lc.spawn({ label: 'board-tab-1', url: 'x', x: 0, y: 0, width: 1, height: 1 });
    expect(t.listWebviews).toHaveBeenCalled();
  });
});

describe('LexeraLifecycle.evictOldestIfOverCap', () => {
  it('returns null when under cap', async () => {
    const { factory } = freshFactory();
    const t = makeStubTransport({
      listWebviews: vi.fn(() => Promise.resolve([{ label: 'a' }, { label: 'b' }]))
    });
    const lc = factory.create({ ...t, locationSearch: '' });
    expect(await lc.evictOldestIfOverCap()).toBe(null);
    expect(t.destroy).not.toHaveBeenCalled();
  });

  it('evicts the oldest by freshness when over cap', async () => {
    const { factory } = freshFactory();
    const labels = Array.from({ length: 10 }, (_, i) => ({ label: 'b' + i }));
    const t = makeStubTransport({
      listWebviews: vi.fn(() => Promise.resolve(labels))
    });
    const lc = factory.create({ ...t, locationSearch: '' });
    // touch them in reverse order so b9 is freshest, b0 is empty (should be evicted first)
    for (let i = 1; i < 10; i++) lc.touch('b' + i);
    await lc.evictOldestIfOverCap();
    expect(t.destroy).toHaveBeenCalledOnce();
    // b0 has no freshness entry → oldest by default
    expect(t.destroy).toHaveBeenCalledWith('b0');
  });

  it('skips pinned labels and pool labels', async () => {
    const { factory } = freshFactory();
    // 12 webviews, 4 pinned. Cap is 8. Evictable = 12-4 = 8 → no eviction.
    const labels = [
      'inspector', 'log-view', 'workspaces', 'dashboard',  // pinned
      ...Array.from({ length: 8 }, (_, i) => 'b' + i)
    ].map((label) => ({ label }));
    const t = makeStubTransport({
      listWebviews: vi.fn(() => Promise.resolve(labels))
    });
    const lc = factory.create({ ...t, locationSearch: '' });
    expect(await lc.evictOldestIfOverCap()).toBe(null);
    expect(t.destroy).not.toHaveBeenCalled();
  });
});

describe('LexeraLifecycle.refillPool', () => {
  it('is a no-op when poolSize is 0 (default)', async () => {
    const { factory } = freshFactory();
    const t = makeStubTransport();
    const lc = factory.create({ ...t, locationSearch: '' });
    await lc.refillPool();
    expect(t.spawn).not.toHaveBeenCalled();
  });

  it('spawns to fill deficit when poolSize > 0', async () => {
    const { factory } = freshFactory();
    const t = makeStubTransport();
    const lc = factory.create({ ...t, locationSearch: '?multiview-pool=2' });
    await lc.refillPool();
    expect(t.spawn).toHaveBeenCalledTimes(2);
    expect(lc.status().pool.length).toBe(2);
  });

  it('subsequent refill is a no-op when pool is full', async () => {
    const { factory } = freshFactory();
    const t = makeStubTransport();
    const lc = factory.create({ ...t, locationSearch: '?multiview-pool=2' });
    await lc.refillPool();
    t.spawn.mockClear();
    await lc.refillPool();
    expect(t.spawn).not.toHaveBeenCalled();
  });
});

describe('LexeraLifecycle.configure', () => {
  it('updates config and returns a copy', () => {
    const { factory } = freshFactory();
    const lc = factory.create({ ...makeStubTransport(), locationSearch: '' });
    const updated = lc.configure({ softCap: 16 });
    expect(updated.softCap).toBe(16);
    expect(lc.status().config.softCap).toBe(16);
  });
});
