import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function bootstrap() {
  const sandbox = {
    window: {},
    document: {
      getElementById: vi.fn(),
      createElement: vi.fn(() => ({ onload: null, onerror: null })),
      head: { appendChild: vi.fn() }
    }
  };
  const Global = loadIIFE(
    [
      'plugins/pluginRegistry.js',
      'diagramRegistry.js',
      'plugins/diagrams/mermaid.js',
      'plugins/diagrams/plantuml.js'
    ],
    'window',
    sandbox
  );
  return { DR: Global.LexeraDiagramRegistry, win: Global };
}

describe('Mermaid diagram plugin', () => {
  let DR, win;
  beforeEach(() => { const b = bootstrap(); DR = b.DR; win = b.win; });

  it('self-registers with id mermaid and language mermaid', () => {
    const plugin = DR.getById('mermaid');
    expect(plugin).toBeTruthy();
    expect(plugin.metadata.id).toBe('mermaid');
    expect(plugin.metadata.version).toBe('1.0.0');
    expect(plugin.languages).toEqual(['mermaid']);
  });

  it('found by language', () => {
    expect(DR.findByLanguage('mermaid')).toBe(DR.getById('mermaid'));
  });

  it('declares mermaid-cdn as a runtime requirement', () => {
    expect(DR.getById('mermaid').metadata.requires).toContain('mermaid-cdn');
  });

  it('starts not-ready and exposes init() that returns a Promise', () => {
    const plugin = DR.getById('mermaid');
    expect(plugin.isReady()).toBe(false);
    expect(plugin.init()).toBeInstanceOf(Promise);
  });

  it('placeholder returns mermaid-placeholder markup', () => {
    const html = DR.getById('mermaid').placeholder('elem-1');
    expect(html).toContain('mermaid-placeholder');
    expect(html).toContain('id="elem-1"');
  });

  it('menuItems lists copy-svg and copy-code', () => {
    const items = DR.getById('mermaid').menuItems();
    expect(items.map(i => i.id).sort()).toEqual(['copy-code', 'copy-svg']);
  });

  it('handleMenuAction delegates to window.LexeraDiagramDeps.handleDiagramAction', () => {
    const spy = vi.fn();
    win.LexeraDiagramDeps = { handleDiagramAction: spy };
    DR.getById('mermaid').handleMenuAction('copy-svg', { tag: 'DIV' });
    expect(spy).toHaveBeenCalledWith('copy-svg', { tag: 'DIV' });
  });

  it('handleMenuAction is a no-op when deps are not set', () => {
    // Should not throw.
    expect(() => DR.getById('mermaid').handleMenuAction('copy-svg', {})).not.toThrow();
  });
});

describe('Mermaid plugin — config + lifecycle', () => {
  function bootstrapWithMermaid(mermaidImpl) {
    // Like bootstrap() but also exposes a `mermaid` global in the sandbox so
    // onConfigChange can exercise the `typeof mermaid !== 'undefined'` branch.
    const sandbox = {
      window: {},
      document: {
        getElementById: vi.fn(),
        createElement: vi.fn(() => ({ onload: null, onerror: null })),
        head: { appendChild: vi.fn() }
      },
      mermaid: mermaidImpl
    };
    const Global = loadIIFE(
      [
        'plugins/pluginRegistry.js',
        'diagramRegistry.js',
        'plugins/diagrams/mermaid.js',
        'plugins/diagrams/plantuml.js'
      ],
      'window',
      sandbox
    );
    return { DR: Global.LexeraDiagramRegistry, win: Global, sandbox };
  }

  it('declares a configSchema with url + theme fields', () => {
    const { DR } = bootstrapWithMermaid(undefined);
    const plugin = DR.getById('mermaid');
    expect(Array.isArray(plugin.configSchema)).toBe(true);
    const keys = plugin.configSchema.map(f => f.key).sort();
    expect(keys).toEqual(['theme', 'url']);
    for (const field of plugin.configSchema) {
      expect(typeof field.type).toBe('string');
      expect(['string', 'number', 'boolean']).toContain(field.type);
    }
  });

  it('configSchema defaults match DEFAULT_CDN and DEFAULT_THEME', () => {
    const { DR } = bootstrapWithMermaid(undefined);
    const fields = DR.getById('mermaid').configSchema;
    const url = fields.find(f => f.key === 'url');
    const theme = fields.find(f => f.key === 'theme');
    // Phase 7.5 gap #6: Mermaid is vendored; no longer a CDN default.
    expect(url.default).toBe('./vendor/mermaid/mermaid.min.js');
    expect(theme.default).toBe('dark');
  });

  it('activate(ctx) stores the context on the plugin', () => {
    const { DR } = bootstrapWithMermaid(undefined);
    const plugin = DR.getById('mermaid');
    const ctx = { logger: { info: () => {} }, settings: null };
    plugin.activate(ctx);
    expect(plugin._activationCtx).toBe(ctx);
  });

  it('deactivate resets _ready, _loading, and _activationCtx', () => {
    const { DR } = bootstrapWithMermaid(undefined);
    const plugin = DR.getById('mermaid');
    plugin.activate({ logger: {} });
    plugin._ready = true;
    plugin._loading = true;
    plugin.deactivate();
    expect(plugin._ready).toBe(false);
    expect(plugin._loading).toBe(false);
    expect(plugin._activationCtx).toBeNull();
  });

  it('onConfigChange is a safe no-op when the mermaid global is absent', () => {
    // mermaid is undefined in this sandbox
    const { DR } = bootstrapWithMermaid(undefined);
    const plugin = DR.getById('mermaid');
    plugin._ready = true; // simulate loaded state
    expect(() => plugin.onConfigChange({ theme: 'light' })).not.toThrow();
  });

  it('onConfigChange re-initializes mermaid with the new theme when ready', () => {
    const initialize = vi.fn();
    const mermaidStub = { initialize };
    const { DR } = bootstrapWithMermaid(mermaidStub);
    const plugin = DR.getById('mermaid');
    plugin._ready = true;
    plugin.onConfigChange({ theme: 'light' });
    expect(initialize).toHaveBeenCalledTimes(1);
    const [opts] = initialize.mock.calls[0];
    expect(opts.theme).toBe('light');
    expect(opts.startOnLoad).toBe(false);
    expect(opts.securityLevel).toBe('loose');
  });

  it('onConfigChange does nothing when the plugin is not yet ready', () => {
    const initialize = vi.fn();
    const mermaidStub = { initialize };
    const { DR } = bootstrapWithMermaid(mermaidStub);
    const plugin = DR.getById('mermaid');
    // _ready remains false
    plugin.onConfigChange({ theme: 'light' });
    expect(initialize).not.toHaveBeenCalled();
  });
});

describe('PlantUML diagram plugin', () => {
  let DR, win;
  beforeEach(() => { const b = bootstrap(); DR = b.DR; win = b.win; });

  it('self-registers with id plantuml and languages plantuml + puml', () => {
    const plugin = DR.getById('plantuml');
    expect(plugin).toBeTruthy();
    expect(plugin.metadata.id).toBe('plantuml');
    expect(plugin.languages).toEqual(['plantuml', 'puml']);
  });

  it('findByLanguage resolves both plantuml and puml tags to the same plugin', () => {
    expect(DR.findByLanguage('plantuml').metadata.id).toBe('plantuml');
    expect(DR.findByLanguage('puml').metadata.id).toBe('plantuml');
  });

  it('declares plantuml-backend as a runtime requirement', () => {
    expect(DR.getById('plantuml').metadata.requires).toContain('plantuml-backend');
  });

  it('is always ready (no lazy load required)', () => {
    const plugin = DR.getById('plantuml');
    expect(plugin.isReady()).toBe(true);
    expect(plugin.init()).toBeInstanceOf(Promise);
  });

  it('render calls deps.requestRenderedPlantUmlSvg(boardId, code)', async () => {
    const spy = vi.fn().mockResolvedValue('<svg>done</svg>');
    win.LexeraDiagramDeps = { requestRenderedPlantUmlSvg: spy };
    const result = await DR.getById('plantuml').render('elem-1', '@startuml\nA->B\n@enduml', 'board-1');
    expect(spy).toHaveBeenCalledWith('board-1', '@startuml\nA->B\n@enduml');
    expect(result).toBe('<svg>done</svg>');
  });

  it('render rejects when the dep is not set', async () => {
    await expect(DR.getById('plantuml').render('id', 'code', 'board')).rejects.toThrow(/requestRenderedPlantUmlSvg not available/);
  });

  it('placeholder uses deps.escapeHtml when available', () => {
    win.LexeraDiagramDeps = { escapeHtml: (s) => '[escaped:' + s + ']' };
    const html = DR.getById('plantuml').placeholder('elem-1', '@startuml');
    expect(html).toContain('[escaped:@startuml]');
    expect(html).toContain('plantuml-placeholder');
    expect(html).toContain('language-plantuml');
  });

  it('placeholder falls back to raw code when no escapeHtml dep is set', () => {
    const html = DR.getById('plantuml').placeholder('elem-1', 'code-content');
    expect(html).toContain('code-content');
  });

  it('menuItems lists copy-svg and copy-code', () => {
    const items = DR.getById('plantuml').menuItems();
    expect(items.map(i => i.id).sort()).toEqual(['copy-code', 'copy-svg']);
  });
});
