import { describe, it, expect, beforeEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

function bootstrap() {
  const fakeWindow = {};
  const Registry = loadIIFE(
    ['plugins/pluginRegistry.js', 'plugins/embed/embedPlugin.js'],
    'LexeraPluginRegistry',
    { window: fakeWindow, URL }
  );
  return { Registry, fakeWindow };
}

describe('Embed plugin — registration and manifest', () => {
  let Registry;
  beforeEach(() => { Registry = bootstrap().Registry; });

  it('registers under kind=embed with id embed', () => {
    const plugin = Registry.getById('embed', 'embed');
    expect(plugin).toBeTruthy();
    expect(plugin.metadata.name).toBe('External Embed Handling');
    expect(plugin.metadata.version).toBe('1.0.0');
  });

  it('exposes getKnownPatterns() that returns a copy of the pattern list', () => {
    const plugin = Registry.getById('embed', 'embed');
    const a = plugin.getKnownPatterns();
    const b = plugin.getKnownPatterns();
    expect(a).not.toBe(b);          // copy
    expect(a).toEqual(b);           // same content
    expect(a.length).toBeGreaterThan(10);
  });

  it('known patterns include the v1 baseline set', () => {
    const patterns = Registry.getById('embed', 'embed').getKnownPatterns();
    for (const needed of [
      'miro.com/app/embed',
      'figma.com/embed',
      'youtube.com/embed',
      'vimeo.com/video',
      'docs.google.com/presentation',
      'notion.so',
      'loom.com/share'
    ]) {
      expect(patterns).toContain(needed);
    }
  });

  it('publishes itself as window.LexeraEmbedPlugin', () => {
    const { fakeWindow } = bootstrap();
    expect(fakeWindow.LexeraEmbedPlugin).toBeDefined();
    expect(fakeWindow.LexeraEmbedPlugin.metadata.id).toBe('embed');
  });
});

describe('Embed plugin — isKnownExternalEmbedUrl', () => {
  let plugin;
  beforeEach(() => { plugin = bootstrap().Registry.getById('embed', 'embed'); });

  it('matches the canonical host forms for each known embed provider', () => {
    // Patterns are anchored at the start of host+path, so bare hosts
    // (without www.) are what the v1 matcher recognizes.
    expect(plugin.isKnownExternalEmbedUrl('https://miro.com/app/embed/abc')).toBe(true);
    expect(plugin.isKnownExternalEmbedUrl('https://youtube.com/embed/xyz')).toBe(true);
    expect(plugin.isKnownExternalEmbedUrl('https://vimeo.com/video/12345')).toBe(true);
    expect(plugin.isKnownExternalEmbedUrl('https://figma.com/embed/foo')).toBe(true);
    expect(plugin.isKnownExternalEmbedUrl('https://docs.google.com/presentation/d/abc')).toBe(true);
    expect(plugin.isKnownExternalEmbedUrl('https://loom.com/share/xyz')).toBe(true);
    expect(plugin.isKnownExternalEmbedUrl('https://notion.so/page')).toBe(true);
  });

  it('is anchored: www. prefix does NOT match (v1-faithful)', () => {
    // Document the ^-anchor behaviour so a future refactor knows this was
    // deliberate. If we later want www.-tolerance, swap patterns to include
    // an optional www. prefix.
    expect(plugin.isKnownExternalEmbedUrl('https://www.youtube.com/embed/x')).toBe(false);
    expect(plugin.isKnownExternalEmbedUrl('https://www.figma.com/embed/y')).toBe(false);
  });

  it('does not match arbitrary URLs', () => {
    expect(plugin.isKnownExternalEmbedUrl('https://example.com/foo')).toBe(false);
    expect(plugin.isKnownExternalEmbedUrl('https://random.site/embed')).toBe(false);
  });

  it('rejects non-URLs', () => {
    expect(plugin.isKnownExternalEmbedUrl('')).toBe(false);
    expect(plugin.isKnownExternalEmbedUrl(null)).toBe(false);
    expect(plugin.isKnownExternalEmbedUrl(undefined)).toBe(false);
    expect(plugin.isKnownExternalEmbedUrl('not a url')).toBe(false);
    expect(plugin.isKnownExternalEmbedUrl('/relative/path')).toBe(false);
  });

  it('matches wildcards (codepen.io/*/embed)', () => {
    expect(plugin.isKnownExternalEmbedUrl('https://codepen.io/someuser/embed/abc')).toBe(true);
    expect(plugin.isKnownExternalEmbedUrl('https://jsfiddle.net/user/embedded/result')).toBe(true);
  });
});

describe('Embed plugin — normalizeEmbedHandling', () => {
  let plugin;
  beforeEach(() => { plugin = bootstrap().Registry.getById('embed', 'embed'); });

  it('preserves canonical tokens', () => {
    expect(plugin.normalizeEmbedHandling('iframe')).toBe('iframe');
    expect(plugin.normalizeEmbedHandling('remove')).toBe('remove');
    expect(plugin.normalizeEmbedHandling('fallback')).toBe('fallback');
    expect(plugin.normalizeEmbedHandling('keep')).toBe('keep');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(plugin.normalizeEmbedHandling('  IFRAME  ')).toBe('iframe');
    expect(plugin.normalizeEmbedHandling('Remove')).toBe('remove');
  });

  it('defaults unknown / empty input to keep', () => {
    expect(plugin.normalizeEmbedHandling('')).toBe('keep');
    expect(plugin.normalizeEmbedHandling(null)).toBe('keep');
    expect(plugin.normalizeEmbedHandling(undefined)).toBe('keep');
    expect(plugin.normalizeEmbedHandling('unknown-mode')).toBe('keep');
  });
});
