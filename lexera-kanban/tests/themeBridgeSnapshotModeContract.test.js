import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(__dirname, '..', 'src', 'shell', 'bridges', 'themeBridge.js'),
  'utf8'
);

function loadThemeBridge(window) {
  const factory = new Function('window', 'document', 'getComputedStyle', source +
    '\nreturn window.LexeraThemeBridge;');
  return factory(window, window.document, window.getComputedStyle.bind(window));
}

// Regression: the shell resolves dark/light into `:root[data-theme-mode]`
// via appearance.js, and app.css gates EVERY dark-mode token on that
// attribute selector. Sub-app webviews don't load appearance.js, so the
// snapshot must carry the resolved mode — otherwise already-open views
// only ever get the ~28 enumerated palette vars and the rest of the dark
// token set never flips ("individual views don't always switch").
describe('LexeraThemeBridge snapshot carries the resolved theme mode', () => {
  it('snapshotTheme reads data-theme-mode / data-theme-mode-requested off :root', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/index.html'
    });
    const { window } = dom;
    window.document.documentElement.setAttribute('data-theme-mode', 'dark');
    window.document.documentElement.setAttribute('data-theme-mode-requested', 'auto');

    const bridge = loadThemeBridge(window);
    const snap = bridge.snapshotTheme();

    expect(snap).toBeTruthy();
    expect(snap.theme_mode).toBe('dark');
    expect(snap.theme_mode_requested).toBe('auto');
    expect(snap.color_scheme).toBe('dark');
  });

  it('applyThemeSnapshot writes the resolved mode back onto :root', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/views/dashboard/index.html'
    });
    const { window } = dom;
    const bridge = loadThemeBridge(window);

    bridge.applyThemeSnapshot({
      palette: { '--bg-primary': '#10141b' },
      color_scheme: 'dark',
      theme_mode: 'dark',
      theme_mode_requested: 'auto'
    });

    const root = window.document.documentElement;
    expect(root.getAttribute('data-theme-mode')).toBe('dark');
    expect(root.getAttribute('data-theme-mode-requested')).toBe('auto');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('snapshotTheme carries visual theme attributes and loaded user theme CSS', () => {
    const dom = new JSDOM('<!doctype html><html><head><style id="lexera-visual-theme-user-style">:root { --custom-theme-token: 1; }</style></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/index.html'
    });
    const { window } = dom;
    const root = window.document.documentElement;
    root.setAttribute('data-visual-theme', 'sleek');
    root.setAttribute('data-visual-theme-variant', 'midnight-grid');
    root.setAttribute('data-visual-theme-lineage', 'sleek-uniform midnight-grid');

    const bridge = loadThemeBridge(window);
    const snap = bridge.snapshotTheme();

    expect(snap.visual_theme).toBe('sleek');
    expect(snap.visual_theme_variant).toBe('midnight-grid');
    expect(snap.visual_theme_lineage).toBe('sleek-uniform midnight-grid');
    expect(snap.visual_theme_user_css).toContain('--custom-theme-token');
  });

  it('applyThemeSnapshot mirrors visual theme attributes and clears them for no-style', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/views/log/index.html'
    });
    const { window } = dom;
    const bridge = loadThemeBridge(window);

    bridge.applyThemeSnapshot({
      palette: {},
      color_scheme: 'light',
      visual_theme: 'sleek',
      visual_theme_variant: 'midnight-grid',
      visual_theme_lineage: 'sleek-uniform midnight-grid',
      visual_theme_user_css: ':root { --custom-theme-token: 1; }'
    });

    const root = window.document.documentElement;
    expect(root.getAttribute('data-visual-theme')).toBe('sleek');
    expect(root.getAttribute('data-visual-theme-variant')).toBe('midnight-grid');
    expect(root.getAttribute('data-visual-theme-lineage')).toBe('sleek-uniform midnight-grid');
    expect(window.document.getElementById('lexera-visual-theme-user-style').textContent).toContain('--custom-theme-token');

    bridge.applyThemeSnapshot({
      palette: {},
      color_scheme: 'light',
      visual_theme: '',
      visual_theme_variant: '',
      visual_theme_lineage: '',
      visual_theme_user_css: ''
    });

    expect(root.getAttribute('data-visual-theme')).toBe(null);
    expect(root.getAttribute('data-visual-theme-variant')).toBe(null);
    expect(root.getAttribute('data-visual-theme-lineage')).toBe(null);
    expect(window.document.getElementById('lexera-visual-theme-user-style')).toBe(null);
  });

  it('falls back to color_scheme when no data-theme-mode attribute is set', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      url: 'http://127.0.0.1:1431/index.html'
    });
    const { window } = dom;
    const bridge = loadThemeBridge(window);
    const snap = bridge.snapshotTheme();

    // No attribute, no explicit colorScheme → defaults to light, and the
    // mode fields must still be populated so subscribers can apply them.
    expect(snap.theme_mode).toBe('light');
    expect(snap.theme_mode_requested).toBe('light');
  });
});
