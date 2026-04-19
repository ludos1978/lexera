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
