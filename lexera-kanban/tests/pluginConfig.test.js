import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function load() {
  // Fresh instance per test — load the single IIFE file with a known fake
  // localStorage so the default backend is deterministic.
  const fakeStorage = {
    _data: {},
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
    setItem: function (k, v) { this._data[k] = String(v); },
    removeItem: function (k) { delete this._data[k]; }
  };
  const Svc = loadIIFE('plugins/pluginConfig.js', 'LexeraPluginConfig', {
    localStorage: fakeStorage,
    console: globalThis.console,
    window: {}
  });
  return { service: Svc.createService(), fakeStorage, LexeraPluginConfig: Svc };
}

describe('LexeraPluginConfig — schema registration', () => {
  it('accepts a valid schema and exposes it back', () => {
    const { service } = load();
    service.register('mermaid', [
      { key: 'url', type: 'string', default: 'https://cdn/m.js', label: 'Mermaid URL' },
      { key: 'darkMode', type: 'boolean', default: true }
    ]);
    const schema = service.getSchema('mermaid');
    expect(schema).toEqual([
      { key: 'url', type: 'string', default: 'https://cdn/m.js', label: 'Mermaid URL' },
      { key: 'darkMode', type: 'boolean', default: true }
    ]);
  });

  it('returns a defensive copy of the schema', () => {
    const { service } = load();
    service.register('x', [{ key: 'k', type: 'string', default: 'a' }]);
    const a = service.getSchema('x');
    a[0].default = 'mutated';
    const b = service.getSchema('x');
    expect(b[0].default).toBe('a');
  });

  it('rejects invalid schema entries', () => {
    const { service } = load();
    expect(() => service.register('x', null)).toThrow(/schema must be an array/);
    expect(() => service.register('', [])).toThrow(/pluginId must be a string/);
    expect(() => service.register('x', [{ type: 'string' }])).toThrow(/field\.key/);
    expect(() => service.register('x', [{ key: 'k', type: 'date' }])).toThrow(/field\.type/);
    expect(() => service.register('x', [
      { key: 'a', type: 'string' },
      { key: 'a', type: 'number' }
    ])).toThrow(/duplicate key/);
  });

  it('getSchema returns null for unregistered plugins', () => {
    const { service } = load();
    expect(service.getSchema('nope')).toBeNull();
  });

  it('listPlugins enumerates registered plugin ids', () => {
    const { service } = load();
    service.register('a', [{ key: 'k', type: 'string' }]);
    service.register('b', [{ key: 'k', type: 'string' }]);
    expect(service.listPlugins().sort()).toEqual(['a', 'b']);
  });
});

describe('LexeraPluginConfig — get / set with defaults', () => {
  it('get returns defaults when nothing has been set', () => {
    const { service } = load();
    service.register('plug', [
      { key: 'count', type: 'number', default: 5 },
      { key: 'label', type: 'string', default: 'hello' },
      { key: 'on', type: 'boolean', default: false }
    ]);
    expect(service.get('plug')).toEqual({ count: 5, label: 'hello', on: false });
  });

  it('set overrides the default and persists via backend.write', () => {
    const { service, fakeStorage } = load();
    service.register('plug', [{ key: 'count', type: 'number', default: 5 }]);
    service.set('plug', 'count', 42);
    expect(service.get('plug').count).toBe(42);
    expect(fakeStorage._data['lexera-plugin-config.plug.count']).toBe('42');
  });

  it('set coerces strings to their declared type', () => {
    const { service } = load();
    service.register('plug', [
      { key: 'count', type: 'number', default: 0 },
      { key: 'on', type: 'boolean', default: false }
    ]);
    service.set('plug', 'count', '17');
    service.set('plug', 'on', 'true');
    expect(service.get('plug')).toEqual({ count: 17, on: true });
  });

  it('getField returns a single value', () => {
    const { service } = load();
    service.register('plug', [
      { key: 'a', type: 'string', default: 'x' },
      { key: 'b', type: 'number', default: 1 }
    ]);
    expect(service.getField('plug', 'a')).toBe('x');
    expect(service.getField('plug', 'b')).toBe(1);
  });

  it('set throws on unknown plugin or unknown key', () => {
    const { service } = load();
    service.register('plug', [{ key: 'k', type: 'string' }]);
    expect(() => service.set('nope', 'k', 'v')).toThrow(/unknown plugin/);
    expect(() => service.set('plug', 'zz', 'v')).toThrow(/unknown config key/);
  });

  it('reset(pluginId, key) reverts a single field to its default', () => {
    const { service } = load();
    service.register('plug', [{ key: 'v', type: 'string', default: 'def' }]);
    service.set('plug', 'v', 'custom');
    expect(service.get('plug').v).toBe('custom');
    service.reset('plug', 'v');
    expect(service.get('plug').v).toBe('def');
  });

  it('reset(pluginId) reverts all fields to defaults', () => {
    const { service } = load();
    service.register('plug', [
      { key: 'a', type: 'string', default: 'x' },
      { key: 'b', type: 'number', default: 1 }
    ]);
    service.set('plug', 'a', 'y');
    service.set('plug', 'b', 2);
    service.reset('plug');
    expect(service.get('plug')).toEqual({ a: 'x', b: 1 });
  });

  it('reads back persisted values from the backend on a fresh service', () => {
    const { fakeStorage } = load();
    // Simulate an earlier session having written to storage.
    fakeStorage._data['lexera-plugin-config.mermaid.url'] = JSON.stringify('https://pinned.example/m.js');
    // Build a new service on the same storage.
    const Svc = loadIIFE('plugins/pluginConfig.js', 'LexeraPluginConfig', {
      localStorage: fakeStorage, console: globalThis.console, window: {}
    });
    const fresh = Svc.createService();
    fresh.register('mermaid', [{ key: 'url', type: 'string', default: 'https://default/m.js' }]);
    expect(fresh.get('mermaid').url).toBe('https://pinned.example/m.js');
  });
});

describe('LexeraPluginConfig — onChange notifications', () => {
  it('fires subscribers on set()', () => {
    const { service } = load();
    service.register('plug', [{ key: 'v', type: 'string', default: 'a' }]);
    const sub = vi.fn();
    service.onChange('plug', sub);
    service.set('plug', 'v', 'b');
    expect(sub).toHaveBeenCalledWith({ v: 'b' });
  });

  it('fires subscribers on reset()', () => {
    const { service } = load();
    service.register('plug', [{ key: 'v', type: 'string', default: 'a' }]);
    service.set('plug', 'v', 'b');
    const sub = vi.fn();
    service.onChange('plug', sub);
    service.reset('plug', 'v');
    expect(sub).toHaveBeenCalledWith({ v: 'a' });
  });

  it('unsubscribe stops further notifications', () => {
    const { service } = load();
    service.register('plug', [{ key: 'v', type: 'string', default: 'a' }]);
    const sub = vi.fn();
    const off = service.onChange('plug', sub);
    service.set('plug', 'v', 'b');
    off();
    service.set('plug', 'v', 'c');
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it('listener exception does not break other listeners', () => {
    const { service } = load();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    service.register('plug', [{ key: 'v', type: 'string', default: 'a' }]);
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    service.onChange('plug', bad);
    service.onChange('plug', good);
    service.set('plug', 'v', 'b');
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('LexeraPluginConfig — installFromRegistry', () => {
  it('auto-registers schemas from plugins that declare configSchema', () => {
    const { service } = load();
    const fakeRegistry = {
      allKinds: () => ['diagram', 'export'],
      getByKind: (kind) => kind === 'diagram'
        ? [{
            kind: 'diagram',
            metadata: { id: 'mermaid', name: 'M', version: '1' },
            configSchema: [{ key: 'url', type: 'string', default: 'https://m' }]
          }]
        : [{
            kind: 'export',
            metadata: { id: 'marp', name: 'Marp', version: '1' }
            // no configSchema — should be skipped
          }]
    };
    const installed = service.installFromRegistry(fakeRegistry);
    expect(installed).toEqual(['mermaid']);
    expect(service.getSchema('mermaid').length).toBe(1);
    expect(service.getSchema('marp')).toBeNull();
  });

  it('wires onConfigChange and fires once with initial values', () => {
    const { service } = load();
    const onCfg = vi.fn();
    const fakeRegistry = {
      allKinds: () => ['diagram'],
      getByKind: () => [{
        kind: 'diagram',
        metadata: { id: 'mermaid', name: 'M', version: '1' },
        configSchema: [{ key: 'theme', type: 'string', default: 'dark' }],
        onConfigChange: onCfg
      }]
    };
    service.installFromRegistry(fakeRegistry);
    expect(onCfg).toHaveBeenCalledWith({ theme: 'dark' });

    // Further set() also fires it
    onCfg.mockClear();
    service.set('mermaid', 'theme', 'light');
    expect(onCfg).toHaveBeenCalledWith({ theme: 'light' });
  });

  it('skips plugins with invalid schema and continues', () => {
    const { service } = load();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fakeRegistry = {
      allKinds: () => ['diagram'],
      getByKind: () => [
        {
          kind: 'diagram',
          metadata: { id: 'bad', name: 'B', version: '1' },
          configSchema: [{ type: 'string' }]   // missing key
        },
        {
          kind: 'diagram',
          metadata: { id: 'good', name: 'G', version: '1' },
          configSchema: [{ key: 'ok', type: 'boolean', default: true }]
        }
      ]
    };
    const installed = service.installFromRegistry(fakeRegistry);
    expect(installed).toEqual(['good']);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('LexeraPluginConfig — pluggable backend', () => {
  it('setBackend swaps the persistence layer', () => {
    const { service } = load();
    const mem = {};
    service.setBackend({
      read: (p, k) => mem[p + '.' + k],
      write: (p, k, v) => { mem[p + '.' + k] = v; }
    });
    service.register('plug', [{ key: 'v', type: 'number', default: 1 }]);
    service.set('plug', 'v', 7);
    expect(mem).toEqual({ 'plug.v': 7 });
    expect(service.get('plug').v).toBe(7);
  });

  it('invalid backend (missing read/write) is ignored', () => {
    const { service } = load();
    service.setBackend({});
    service.setBackend(null);
    // Previous default backend still works
    service.register('plug', [{ key: 'v', type: 'string', default: 'a' }]);
    service.set('plug', 'v', 'b');
    expect(service.get('plug').v).toBe('b');
  });
});
