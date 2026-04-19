import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function bootstrap() {
  const fakeWindow = {};
  const Registry = loadIIFE(
    ['plugins/pluginRegistry.js', 'plugins/markdown/markdownPluginManifest.js'],
    'LexeraPluginRegistry',
    { window: fakeWindow }
  );
  return { Registry, fakeWindow };
}

describe('markdown plugin manifest', () => {
  let Registry;
  beforeEach(() => { Registry = bootstrap().Registry; });

  it('registers at least the v1 set of markdown-it plugins', () => {
    const entries = Registry.getByKind('markdown');
    const ids = entries.map(e => e.metadata.id).sort();
    const expected = [
      'abbr', 'container', 'date-person-tag', 'emoji',
      'enhanced-strikethrough', 'footnote', 'html-comment',
      'image-attrs', 'image-figures', 'ins', 'list-split', 'mark',
      'multicolumn', 'speaker-note', 'strikethrough-alt', 'sub',
      'sup', 'table-widths', 'tag', 'task-checkbox',
      'temporal-tag', 'underline', 'wiki-links'
    ];
    expect(ids).toEqual(expected);
  });

  it('every entry carries a valid v2 manifest', () => {
    const entries = Registry.getByKind('markdown');
    for (const e of entries) {
      expect(e.kind).toBe('markdown');
      expect(typeof e.metadata.id).toBe('string');
      expect(typeof e.metadata.name).toBe('string');
      expect(typeof e.metadata.version).toBe('string');
      expect(typeof e.metadata.priority).toBe('number');
      expect(typeof e.apply).toBe('function');
    }
  });

  it('entries default to scope=both (applied in both frontend and export)', () => {
    const entries = Registry.getByKind('markdown');
    for (const e of entries) {
      expect(e.scope).toBe('both');
    }
  });

  it('priorities are unique so sort order is deterministic', () => {
    const entries = Registry.getByKind('markdown');
    const priorities = entries.map(e => e.metadata.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it('wiki-links loads first (lowest priority)', () => {
    const sorted = Registry.getByKind('markdown').slice()
      .sort((a, b) => a.metadata.priority - b.metadata.priority);
    expect(sorted[0].metadata.id).toBe('wiki-links');
  });
});

describe('markdown plugin apply functions (lazy global lookup)', () => {
  it('apply is a safe no-op when the vendor global is missing', () => {
    const { Registry, fakeWindow } = bootstrap();
    // fakeWindow has no markdownit* globals → every apply is a no-op
    for (const key of Object.keys(fakeWindow)) delete fakeWindow[key];
    const entries = Registry.getByKind('markdown');
    const md = { use: vi.fn() };
    const ctx = { htmlCommentMode: 'keep', htmlContentMode: 'keep' };
    for (const e of entries) {
      expect(() => e.apply(md, ctx)).not.toThrow();
    }
    expect(md.use).not.toHaveBeenCalled();
  });

  it('wiki-links apply uses the vendor global with the wiki-link className option', () => {
    const { Registry, fakeWindow } = bootstrap();
    const wikiLinks = Registry.getByKind('markdown').find(e => e.metadata.id === 'wiki-links');
    const mockPlugin = vi.fn();
    fakeWindow.markdownitWikiLinks = mockPlugin;
    const md = { use: vi.fn() };
    wikiLinks.apply(md, {});
    expect(md.use).toHaveBeenCalledWith(mockPlugin, { className: 'wiki-link' });
  });

  it('html-comment apply threads commentMode + contentMode from the ctx', () => {
    const { Registry, fakeWindow } = bootstrap();
    const htmlComment = Registry.getByKind('markdown').find(e => e.metadata.id === 'html-comment');
    const mockPlugin = vi.fn();
    fakeWindow.markdownitHtmlComment = mockPlugin;
    const md = { use: vi.fn() };
    htmlComment.apply(md, { htmlCommentMode: 'remove', htmlContentMode: 'keep' });
    expect(md.use).toHaveBeenCalledWith(mockPlugin, { commentMode: 'remove', contentMode: 'keep' });
  });

  it('container apply registers all documented container names', () => {
    const { Registry, fakeWindow } = bootstrap();
    const container = Registry.getByKind('markdown').find(e => e.metadata.id === 'container');
    fakeWindow.markdownitContainer = vi.fn();
    const md = { use: vi.fn() };
    container.apply(md, {});
    const names = md.use.mock.calls.map(args => args[1]).sort();
    expect(names).toEqual([
      'caption', 'center', 'center100', 'comment', 'highlight',
      'mark-blue', 'mark-cyan', 'mark-green', 'mark-magenta',
      'mark-red', 'mark-yellow', 'note', 'right'
    ]);
  });

  it('emoji apply prefers .full, falls back to .light, then to the module itself', () => {
    // full preferred
    let { Registry, fakeWindow } = bootstrap();
    let emoji = Registry.getByKind('markdown').find(e => e.metadata.id === 'emoji');
    const full = vi.fn(), light = vi.fn();
    fakeWindow.markdownitEmoji = { full, light };
    const md1 = { use: vi.fn() };
    emoji.apply(md1, {});
    expect(md1.use).toHaveBeenCalledWith(full);

    // falls back to light
    ({ Registry, fakeWindow } = bootstrap());
    emoji = Registry.getByKind('markdown').find(e => e.metadata.id === 'emoji');
    fakeWindow.markdownitEmoji = { light };
    const md2 = { use: vi.fn() };
    emoji.apply(md2, {});
    expect(md2.use).toHaveBeenCalledWith(light);

    // falls back to the module itself
    ({ Registry, fakeWindow } = bootstrap());
    emoji = Registry.getByKind('markdown').find(e => e.metadata.id === 'emoji');
    const plain = function () {};
    fakeWindow.markdownitEmoji = plain;
    const md3 = { use: vi.fn() };
    emoji.apply(md3, {});
    expect(md3.use).toHaveBeenCalledWith(plain);
  });
});
