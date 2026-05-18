import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');
const embedMenuJs = readFileSync(resolve(__dirname, '..', 'src', 'menu', 'embedMenu.js'), 'utf8');

describe('include menu layout contract', () => {
  it('keeps include burger buttons inline instead of overlaying column controls', () => {
    expect(embedMenuJs).toContain('class="embed-menu-btn include-menu-btn"');
    expect(appCss).toMatch(
      /\.include-link-container \.include-menu-btn,\s*\.include-inline-container \.include-menu-btn\s*\{[\s\S]*position:\s*static;[\s\S]*top:\s*auto;[\s\S]*right:\s*auto;[\s\S]*opacity:\s*1;[\s\S]*z-index:\s*auto;/
    );
  });

  it('sizes the column include badge to the shared icon tokens, not a hardcoded box', () => {
    // User contract 2026-05-18: "make the icons that show when something
    // is included the same size as the other icons!". The badge used to
    // be a hardcoded 22px square with a --font-size-md (13px) glyph while
    // every other card/stack icon button is a var(--icon-button-size)
    // square with a var(--icon-glyph-size) glyph. Pin the badge to the
    // same tokens so it can't drift back to the oversized fixed box and
    // so it scales with --ui-scale like the rest of the icons.
    const m = appCss.match(/\.column-include-badge\s*\{([^}]*)\}/);
    expect(m, 'base .column-include-badge rule must exist').not.toBeNull();
    const body = m[1];
    expect(body, 'width must use var(--icon-button-size)')
      .toMatch(/width\s*:\s*var\(\s*--icon-button-size\s*\)\s*;/);
    expect(body, 'height must use var(--icon-button-size)')
      .toMatch(/height\s*:\s*var\(\s*--icon-button-size\s*\)\s*;/);
    expect(body, 'font-size must use var(--icon-glyph-size)')
      .toMatch(/font-size\s*:\s*var\(\s*--icon-glyph-size\s*\)\s*;/);
    expect(body, 'must not reintroduce a hardcoded px box/glyph')
      .not.toMatch(/(width|height|font-size)\s*:\s*\d/);
  });
});
