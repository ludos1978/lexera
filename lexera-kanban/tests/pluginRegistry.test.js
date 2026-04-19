import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

let Registry;
let Loader;

function makePlugin(overrides) {
  return Object.assign(
    {
      kind: 'fileFormat',
      metadata: {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0'
      }
    },
    overrides || {}
  );
}

beforeEach(() => {
  Registry = loadIIFE('plugins/pluginRegistry.js', 'LexeraPluginRegistry', {});
  Loader = loadIIFE('plugins/pluginLoader.js', 'LexeraPluginLoader', {});
});

describe('LexeraPluginRegistry — validation', () => {
  it('rejects non-objects', () => {
    expect(Registry.validate(null).valid).toBe(false);
    expect(Registry.validate(undefined).valid).toBe(false);
    expect(Registry.validate('nope').valid).toBe(false);
  });

  it('rejects invalid kind', () => {
    const v = Registry.validate(makePlugin({ kind: 'bogus' }));
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toMatch(/invalid or missing kind/);
  });

  it('rejects missing metadata fields', () => {
    expect(Registry.validate(makePlugin({ metadata: null })).valid).toBe(false);
    expect(Registry.validate(makePlugin({ metadata: { id: '', name: 'x', version: '1' } })).valid).toBe(false);
    expect(Registry.validate(makePlugin({ metadata: { id: 'a', name: 'x', version: '' } })).valid).toBe(false);
  });

  it('rejects non-number priority and non-array requires', () => {
    expect(Registry.validate(makePlugin({
      metadata: { id: 'a', name: 'x', version: '1', priority: 'high' }
    })).valid).toBe(false);
    expect(Registry.validate(makePlugin({
      metadata: { id: 'a', name: 'x', version: '1', requires: 'soffice' }
    })).valid).toBe(false);
  });

  it('accepts a minimal well-formed plugin', () => {
    expect(Registry.validate(makePlugin()).valid).toBe(true);
  });

  it('lists supported kinds', () => {
    expect(Registry.VALID_KINDS).toEqual(
      expect.arrayContaining(['fileFormat', 'diagram', 'export', 'contentEnhancer', 'menuContributor', 'embed'])
    );
  });
});

describe('LexeraPluginRegistry — registration', () => {
  let reg;
  beforeEach(() => {
    reg = Registry.createRegistry();
  });

  it('registers a valid plugin and returns true', () => {
    expect(reg.register(makePlugin())).toBe(true);
    expect(reg.getById('fileFormat', 'test-plugin')).toBeTruthy();
  });

  it('returns false and does not store invalid plugins', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(reg.register({})).toBe(false);
    expect(reg.register(makePlugin({ kind: 'nope' }))).toBe(false);
    expect(reg.stats().total).toBe(0);
    errSpy.mockRestore();
  });

  it('replaces an existing registration and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reg.register(makePlugin({ metadata: { id: 'x', name: 'A', version: '1.0.0' } }));
    reg.register(makePlugin({ metadata: { id: 'x', name: 'B', version: '2.0.0' } }));
    expect(reg.getById('fileFormat', 'x').metadata.name).toBe('B');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('counts plugins per kind', () => {
    reg.register(makePlugin({ metadata: { id: 'a', name: 'A', version: '1' } }));
    reg.register(makePlugin({ kind: 'diagram', metadata: { id: 'b', name: 'B', version: '1' } }));
    reg.register(makePlugin({ kind: 'export', metadata: { id: 'c', name: 'C', version: '1' } }));
    const s = reg.stats();
    expect(s.total).toBe(3);
    expect(s.byKind.fileFormat).toBe(1);
    expect(s.byKind.diagram).toBe(1);
    expect(s.byKind.export).toBe(1);
  });
});

describe('LexeraPluginRegistry — discovery', () => {
  let reg;
  beforeEach(() => {
    reg = Registry.createRegistry();
    reg.register(makePlugin({ metadata: { id: 'low', name: 'L', version: '1', priority: 1 } }));
    reg.register(makePlugin({ metadata: { id: 'high', name: 'H', version: '1', priority: 100 } }));
    reg.register(makePlugin({ metadata: { id: 'zero', name: 'Z', version: '1' } }));
  });

  it('sorts by priority descending when requested', () => {
    const list = reg.getByKind('fileFormat', { sortByPriority: true });
    expect(list.map(p => p.metadata.id)).toEqual(['high', 'low', 'zero']);
  });

  it('returns all when not sorted', () => {
    expect(reg.getByKind('fileFormat').length).toBe(3);
  });

  it('findBy returns the highest-priority matching plugin', () => {
    const found = reg.findBy('fileFormat', p => p.metadata.id !== 'zero');
    expect(found.metadata.id).toBe('high');
  });

  it('findBy returns null when predicate never matches', () => {
    expect(reg.findBy('fileFormat', () => false)).toBeNull();
  });

  it('findBy survives a throwing predicate', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const found = reg.findBy('fileFormat', p => {
      if (p.metadata.id === 'high') throw new Error('boom');
      return p.metadata.id === 'low';
    });
    expect(found.metadata.id).toBe('low');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('LexeraPluginRegistry — enable/disable', () => {
  let reg;
  beforeEach(() => {
    reg = Registry.createRegistry();
    reg.register(makePlugin({ metadata: { id: 'on', name: 'O', version: '1' } }));
    reg.register(makePlugin({ metadata: { id: 'off', name: 'F', version: '1' } }));
  });

  it('hides disabled plugins from default discovery', () => {
    reg.setEnabled('off', false);
    expect(reg.isEnabled('on')).toBe(true);
    expect(reg.isEnabled('off')).toBe(false);
    const list = reg.getByKind('fileFormat');
    expect(list.map(p => p.metadata.id)).toEqual(['on']);
  });

  it('includes disabled plugins when asked', () => {
    reg.setEnabled('off', false);
    const list = reg.getByKind('fileFormat', { includeDisabled: true });
    expect(list.map(p => p.metadata.id).sort()).toEqual(['off', 'on']);
  });

  it('can re-enable a disabled plugin', () => {
    reg.setEnabled('off', false);
    reg.setEnabled('off', true);
    expect(reg.getByKind('fileFormat').map(p => p.metadata.id).sort()).toEqual(['off', 'on']);
  });
});

describe('LexeraPluginRegistry — lifecycle', () => {
  let reg;
  beforeEach(() => {
    reg = Registry.createRegistry();
  });

  it('calls activate on enabled plugins and skips disabled ones', async () => {
    const onA = vi.fn().mockResolvedValue();
    const onB = vi.fn().mockResolvedValue();
    reg.register(makePlugin({ metadata: { id: 'a', name: 'A', version: '1' }, activate: onA }));
    reg.register(makePlugin({ metadata: { id: 'b', name: 'B', version: '1' }, activate: onB }));
    reg.setEnabled('b', false);

    await reg.activate({ foo: 1 });
    expect(onA).toHaveBeenCalledWith({ foo: 1 });
    expect(onB).not.toHaveBeenCalled();
    expect(reg.isActivated()).toBe(true);
  });

  it('continues activating other plugins when one fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onGood = vi.fn().mockResolvedValue();
    const onBad = vi.fn().mockRejectedValue(new Error('boom'));
    reg.register(makePlugin({ metadata: { id: 'good', name: 'G', version: '1' }, activate: onGood }));
    reg.register(makePlugin({ metadata: { id: 'bad', name: 'B', version: '1' }, activate: onBad }));

    await reg.activate({});
    expect(onGood).toHaveBeenCalled();
    expect(onBad).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('activate is idempotent', async () => {
    const fn = vi.fn().mockResolvedValue();
    reg.register(makePlugin({ activate: fn }));
    await reg.activate({});
    await reg.activate({});
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('deactivate calls deactivate() on all plugins (including disabled)', async () => {
    const offA = vi.fn().mockResolvedValue();
    const offB = vi.fn().mockResolvedValue();
    reg.register(makePlugin({ metadata: { id: 'a', name: 'A', version: '1' }, deactivate: offA }));
    reg.register(makePlugin({ metadata: { id: 'b', name: 'B', version: '1' }, deactivate: offB }));
    reg.setEnabled('b', false);
    await reg.activate({});

    await reg.deactivate();
    expect(offA).toHaveBeenCalled();
    expect(offB).toHaveBeenCalled();
    expect(reg.isActivated()).toBe(false);
  });

  it('unregister on an activated plugin triggers deactivate', async () => {
    const off = vi.fn().mockResolvedValue();
    reg.register(makePlugin({ deactivate: off }));
    await reg.activate({});
    expect(reg.unregister('fileFormat', 'test-plugin')).toBe(true);
    expect(off).toHaveBeenCalled();
    expect(reg.getById('fileFormat', 'test-plugin')).toBeNull();
  });
});

describe('LexeraPluginRegistry — conflict detection', () => {
  let reg;
  beforeEach(() => { reg = Registry.createRegistry(); });

  it('warns when two diagram plugins share a language', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reg.register({
      kind: 'diagram',
      metadata: { id: 'mermaid', name: 'M', version: '1' },
      languages: ['mermaid']
    });
    reg.register({
      kind: 'diagram',
      metadata: { id: 'mermaid-fork', name: 'MF', version: '1' },
      languages: ['mermaid', 'plantuml']
    });
    const warnings = warnSpy.mock.calls.map(c => c.join(' '));
    expect(warnings.some(w => /language overlap/.test(w) && /mermaid/.test(w))).toBe(true);
    warnSpy.mockRestore();
  });

  it('does not warn when diagram plugins have disjoint languages', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reg.register({
      kind: 'diagram',
      metadata: { id: 'mermaid', name: 'M', version: '1' },
      languages: ['mermaid']
    });
    reg.register({
      kind: 'diagram',
      metadata: { id: 'plantuml', name: 'P', version: '1' },
      languages: ['plantuml', 'puml']
    });
    const overlap = warnSpy.mock.calls.some(c => /language overlap/.test(c.join(' ')));
    expect(overlap).toBe(false);
    warnSpy.mockRestore();
  });

  it('warns when two export plugins produce the same format id', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reg.register({
      kind: 'export',
      metadata: { id: 'marp-a', name: 'MA', version: '1' },
      getSupportedFormats: () => [{ id: 'presentation-pdf' }]
    });
    reg.register({
      kind: 'export',
      metadata: { id: 'marp-b', name: 'MB', version: '1' },
      getSupportedFormats: () => [{ id: 'presentation-pdf' }, { id: 'custom-foo' }]
    });
    const warnings = warnSpy.mock.calls.map(c => c.join(' '));
    expect(warnings.some(w => /format id overlap/.test(w) && /presentation-pdf/.test(w))).toBe(true);
    warnSpy.mockRestore();
  });

  it('does not warn when export plugins have disjoint formats', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reg.register({
      kind: 'export',
      metadata: { id: 'marp', name: 'M', version: '1' },
      getSupportedFormats: () => [{ id: 'presentation-pdf' }]
    });
    reg.register({
      kind: 'export',
      metadata: { id: 'pandoc', name: 'P', version: '1' },
      getSupportedFormats: () => [{ id: 'document-docx' }]
    });
    const overlap = warnSpy.mock.calls.some(c => /format id overlap/.test(c.join(' ')));
    expect(overlap).toBe(false);
    warnSpy.mockRestore();
  });

  it('detectConflicts() is exposed as a standalone helper', () => {
    const a = {
      kind: 'diagram',
      metadata: { id: 'a', name: 'A', version: '1' },
      languages: ['x', 'y']
    };
    const b = {
      kind: 'diagram',
      metadata: { id: 'b', name: 'B', version: '1' },
      languages: ['y', 'z']
    };
    const warnings = Registry.detectConflicts(b, [a]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/language overlap with a/);
    expect(warnings[0]).toMatch(/y/);
  });

  it('replacing a plugin with the same id does not warn against itself', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reg.register({
      kind: 'diagram',
      metadata: { id: 'mermaid', name: 'M1', version: '1' },
      languages: ['mermaid']
    });
    warnSpy.mockClear();
    reg.register({
      kind: 'diagram',
      metadata: { id: 'mermaid', name: 'M2', version: '2' },
      languages: ['mermaid']
    });
    const warnings = warnSpy.mock.calls.map(c => c.join(' '));
    // Expect the `replacing existing` warning but NOT a conflict warning
    // against itself.
    expect(warnings.some(w => /replacing existing/.test(w))).toBe(true);
    expect(warnings.some(w => /language overlap/.test(w))).toBe(false);
    warnSpy.mockRestore();
  });
});

describe('LexeraPluginLoader', () => {
  let reg;
  let loader;
  beforeEach(() => {
    reg = Registry.createRegistry();
    loader = Loader.createLoader();
  });

  it('loadBuiltins with no builtins still applies disabled list', () => {
    const result = loader.loadBuiltins(reg, { disabled: ['foo', 'bar'] });
    expect(result.loaded).toBe(true);
    expect(result.registered).toBe(0);
    expect(reg.isEnabled('foo')).toBe(false);
    expect(reg.isEnabled('bar')).toBe(false);
  });

  it('registers builtins added via addBuiltin', () => {
    loader.addBuiltin(() => makePlugin({ metadata: { id: 'one', name: 'One', version: '1' } }));
    loader.addBuiltin(() => makePlugin({ kind: 'diagram', metadata: { id: 'two', name: 'Two', version: '1' } }));
    const result = loader.loadBuiltins(reg, {});
    expect(result.registered).toBe(2);
    expect(reg.getById('fileFormat', 'one')).toBeTruthy();
    expect(reg.getById('diagram', 'two')).toBeTruthy();
  });

  it('honors disabled list across factories', () => {
    loader.addBuiltin(() => makePlugin({ metadata: { id: 'keep', name: 'K', version: '1' } }));
    loader.addBuiltin(() => makePlugin({ metadata: { id: 'skip', name: 'S', version: '1' } }));
    loader.loadBuiltins(reg, { disabled: ['skip'] });
    expect(reg.isEnabled('keep')).toBe(true);
    expect(reg.isEnabled('skip')).toBe(false);
  });

  it('is idempotent unless force is set', () => {
    const factory = vi.fn(() => makePlugin({ metadata: { id: 'only', name: 'O', version: '1' } }));
    loader.addBuiltin(factory);
    loader.loadBuiltins(reg, {});
    loader.loadBuiltins(reg, {});
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('survives a throwing factory and continues with the rest', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    loader.addBuiltin(() => { throw new Error('bad factory'); });
    loader.addBuiltin(() => makePlugin({ metadata: { id: 'survivor', name: 'S', version: '1' } }));
    const result = loader.loadBuiltins(reg, {});
    expect(result.registered).toBe(1);
    expect(reg.getById('fileFormat', 'survivor')).toBeTruthy();
    errSpy.mockRestore();
  });
});
