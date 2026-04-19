import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function bootstrap(documentImpl) {
  const sandbox = {
    window: {},
    document: documentImpl || { getElementById: vi.fn() }
  };
  const DR = loadIIFE(
    ['plugins/pluginRegistry.js', 'diagramRegistry.js'],
    'window',
    sandbox
  );
  return DR.LexeraDiagramRegistry;
}

describe('LexeraDiagramRegistry — facade over unified registry', () => {
  let DR;

  beforeEach(() => {
    DR = bootstrap();
  });

  it('register ignores plugins missing id/languages/render', () => {
    DR.register(null);
    DR.register({});
    DR.register({ id: 'no-langs', render: () => Promise.resolve('') });
    DR.register({ id: 'no-render', languages: ['x'] });
    expect(DR.getAll()).toEqual([]);
  });

  it('registers a valid diagram plugin and finds it by language', () => {
    const plugin = {
      id: 'mermaid',
      languages: ['mermaid'],
      isReady: () => true,
      init: () => Promise.resolve(),
      render: () => Promise.resolve('<svg/>')
    };
    DR.register(plugin);
    expect(DR.getById('mermaid')).toBe(plugin);
    expect(DR.findByLanguage('mermaid')).toBe(plugin);
    expect(DR.getAll()).toEqual([plugin]);
  });

  it('preserves plugin identity so mutable state survives', () => {
    const plugin = {
      id: 'stateful',
      languages: ['foo'],
      _ready: false,
      isReady: function () { return this._ready; },
      init: function () { this._ready = true; return Promise.resolve(); },
      render: () => Promise.resolve('')
    };
    DR.register(plugin);
    const fetched = DR.getById('stateful');
    fetched._ready = true;
    expect(plugin._ready).toBe(true);
  });

  it('attaches kind and metadata without clobbering existing metadata', () => {
    const plugin = {
      id: 'plantuml',
      metadata: { id: 'plantuml', name: 'Custom', version: '2.0.0' },
      languages: ['plantuml', 'puml'],
      isReady: () => true,
      init: () => Promise.resolve(),
      render: () => Promise.resolve('')
    };
    DR.register(plugin);
    expect(plugin.kind).toBe('diagram');
    expect(plugin.metadata.version).toBe('2.0.0');
  });

  it('findByLanguage returns null when no plugin matches', () => {
    DR.register({
      id: 'x',
      languages: ['a'],
      isReady: () => true,
      init: () => Promise.resolve(),
      render: () => Promise.resolve('')
    });
    expect(DR.findByLanguage('b')).toBeNull();
  });

  it('nextId produces unique ids per prefix', () => {
    const a = DR.nextId('d');
    const b = DR.nextId('d');
    expect(a).not.toBe(b);
  });

  it('enqueue + flush dispatch to the matching plugin', async () => {
    const render = vi.fn().mockResolvedValue('<svg>ok</svg>');
    const el = { className: '', innerHTML: '', querySelector: () => null };
    const mockDoc = { getElementById: vi.fn().mockReturnValue(el) };
    const reg = bootstrap(mockDoc);

    reg.register({
      id: 'mermaid',
      languages: ['mermaid'],
      isReady: () => true,
      init: () => Promise.resolve(),
      render: render
    });
    reg.enqueue('mermaid', 'elem-1', 'graph TD; A-->B', 'board-1');
    reg.flush();
    await new Promise(r => setTimeout(r, 10));
    expect(render).toHaveBeenCalledWith('elem-1', 'graph TD; A-->B', 'board-1');
    expect(el.className).toBe('mermaid-diagram');
    expect(el.innerHTML).toBe('<svg>ok</svg>');
  });
});
