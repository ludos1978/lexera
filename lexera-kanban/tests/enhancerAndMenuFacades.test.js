import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function bootstrapEnhancer() {
  const sandbox = {
    window: {},
    IntersectionObserver: undefined,
    document: { getElementById: vi.fn() }
  };
  const Global = loadIIFE(
    ['plugins/pluginRegistry.js', 'contentEnhancerRegistry.js'],
    'window',
    sandbox
  );
  return Global.LexeraContentEnhancerRegistry;
}

function bootstrapMenu() {
  const Global = loadIIFE(
    ['plugins/pluginRegistry.js', 'menuContributorRegistry.js'],
    'window',
    { window: {} }
  );
  return Global.LexeraMenuContributorRegistry;
}

describe('LexeraContentEnhancerRegistry — facade', () => {
  let Reg;
  beforeEach(() => { Reg = bootstrapEnhancer(); });

  it('ignores enhancers without id', () => {
    Reg.register({ enhance: vi.fn() });
    expect(Reg.getAll()).toEqual([]);
  });

  it('stores and returns enhancers sorted by priority ascending', () => {
    Reg.register({ id: 'b', priority: 100, enhance: vi.fn() });
    Reg.register({ id: 'a', priority: 1, enhance: vi.fn() });
    Reg.register({ id: 'c', priority: 50, enhance: vi.fn() });
    expect(Reg.getAll().map(e => e.id)).toEqual(['a', 'c', 'b']);
  });

  it('remove unregisters by id', () => {
    Reg.register({ id: 'a', priority: 0, enhance: vi.fn() });
    Reg.register({ id: 'b', priority: 0, enhance: vi.fn() });
    Reg.remove('a');
    expect(Reg.getAll().map(e => e.id)).toEqual(['b']);
  });

  it('enhance runs matching enhancers against the root selector', () => {
    const enhanceA = vi.fn();
    const enhanceB = vi.fn();
    Reg.register({ id: 'a', priority: 0, selector: '.x', enhance: enhanceA });
    Reg.register({ id: 'b', priority: 0, selector: '.y', enhance: enhanceB });

    const root = {
      querySelectorAll: (sel) => sel === '.x' ? [{ tag: 'X' }] : []
    };
    Reg.enhance(root, { ctx: 1 });
    expect(enhanceA).toHaveBeenCalledWith({ tag: 'X' }, { ctx: 1 });
    expect(enhanceB).not.toHaveBeenCalled();
  });
});

describe('LexeraMenuContributorRegistry — facade', () => {
  let Reg;
  beforeEach(() => { Reg = bootstrapMenu(); });

  it('assigns auto ids when missing so the registry accepts the contributor', () => {
    Reg.register({ priority: 0, scopes: ['board'], build: () => [] });
    Reg.register({ priority: 0, scopes: ['board'], build: () => [] });
    // Both ended up in the registry with distinct auto-assigned ids.
    const forBoard = Reg.getForScope('board');
    expect(forBoard.length).toBe(2);
    const ids = forBoard.map(c => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('getForScope filters and sorts by priority', () => {
    Reg.register({ id: 'a', priority: 100, scopes: ['board'], build: () => [] });
    Reg.register({ id: 'b', priority: 10, scopes: ['board'], build: () => [] });
    Reg.register({ id: 'c', priority: 20, scopes: ['editor'], build: () => [] });
    expect(Reg.getForScope('board').map(c => c.id)).toEqual(['b', 'a']);
    expect(Reg.getForScope('editor').map(c => c.id)).toEqual(['c']);
  });

  it('buildMenu concatenates items with section separators', () => {
    Reg.register({ id: 'a', priority: 0, scopes: ['board'], section: 'top', build: () => [{ label: '1' }] });
    Reg.register({ id: 'b', priority: 1, scopes: ['board'], section: 'top', build: () => [{ label: '2' }] });
    Reg.register({ id: 'c', priority: 2, scopes: ['board'], section: 'bottom', build: () => [{ label: '3' }] });
    const menu = Reg.buildMenu('board', {});
    expect(menu).toEqual([
      { label: '1' },
      { label: '2' },
      { separator: true },
      { label: '3' }
    ]);
  });

  it('empty contributors contribute nothing and do not emit separators', () => {
    Reg.register({ id: 'a', priority: 0, scopes: ['board'], section: 'top', build: () => [] });
    Reg.register({ id: 'b', priority: 1, scopes: ['board'], section: 'bottom', build: () => [{ label: 'x' }] });
    expect(Reg.buildMenu('board', {})).toEqual([{ label: 'x' }]);
  });

  it('remove unregisters by id', () => {
    Reg.register({ id: 'a', priority: 0, scopes: ['board'], build: () => [] });
    Reg.remove('a');
    expect(Reg.getForScope('board')).toEqual([]);
  });
});
