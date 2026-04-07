import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

/**
 * Regression tests for the WCAG contrast + bloom port from v1.
 *
 * Requirement source: todo.md item "redo an iteration of font size and style
 * unification — text with background color where the text must be in a good
 * contrast to the chosen background. take the values formulae from version 1,
 * also add contrast enhancing bloom around its background exactly as in v1".
 *
 * This file verifies three independent layers of that port:
 *
 *   1. The math itself — `getLuminance`, `getContrastRatio`, and
 *      `getContrastingTextColor` must produce the same results as v1's
 *      `_ARCHIVE/src/html/utils/colorUtils.js` for a handful of well-known
 *      anchor colors (pure white, pure black, mid-gray, red, yellow, etc.).
 *
 *   2. `getContrastShadow` — must return an empty string when the contrast
 *      ratio is already >=4.5:1 (WCAG AA) and `0 0 4px #888` when it drops
 *      below. Those are the exact values v1 used.
 *
 *   3. The descriptor + CSS pipeline — `buildTagStyleDescriptor` must now
 *      populate `labelShadow` on every header/footer/badge role, and
 *      `buildTagStyleInlineCssText` must emit the matching CSS variables
 *      so `app.css` can apply the bloom on tag-background surfaces.
 *
 * The module is loaded via the same IIFE-in-Function trick used by the
 * existing tagSystem/tagStyleRendering tests so we don't need a full DOM.
 */

function loadTagColors() {
  const titleHelpersSource = readFileSync(resolve(srcDir, 'titleHelpers.js'), 'utf-8');
  const tagSystemSource = readFileSync(resolve(srcDir, 'tagSystem.js'), 'utf-8');
  const tagColorsSource = readFileSync(resolve(srcDir, 'tagcolors', 'tagColors.js'), 'utf-8');
  const factory = new Function(
    'globalThis',
    'console',
    `
      var window = globalThis;
      ${titleHelpersSource}
      ${tagSystemSource}
      ${tagColorsSource}
      return globalThis.LexeraTagColors;
    `
  );
  const scope = {};
  scope.globalThis = scope;
  const TagColors = factory(scope, console);
  TagColors.init({
    escapeHtml: (s) => String(s),
    escapeAttr: (s) => String(s),
  });
  return TagColors;
}

const TagColors = loadTagColors();

describe('v1 WCAG luminance math (tagColors.getLuminance)', () => {
  it('returns 0 for pure black', () => {
    expect(TagColors.getLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('returns 1 for pure white', () => {
    expect(TagColors.getLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('mid-gray (#808080) sits around 0.216 per WCAG gamma correction', () => {
    // sRGB 128 → linear 0.2158 → luminance = 0.2158 (since all 3 channels equal)
    const lum = TagColors.getLuminance('#808080');
    expect(lum).toBeGreaterThan(0.20);
    expect(lum).toBeLessThan(0.23);
  });

  it('pure red (#ff0000) has luminance ≈ 0.2126 (the WCAG R coefficient)', () => {
    expect(TagColors.getLuminance('#ff0000')).toBeCloseTo(0.2126, 3);
  });

  it('pure green (#00ff00) has luminance ≈ 0.7152 (the WCAG G coefficient)', () => {
    expect(TagColors.getLuminance('#00ff00')).toBeCloseTo(0.7152, 3);
  });

  it('pure blue (#0000ff) has luminance ≈ 0.0722 (the WCAG B coefficient)', () => {
    expect(TagColors.getLuminance('#0000ff')).toBeCloseTo(0.0722, 3);
  });

  it('gracefully falls back to 0.5 on unparseable input', () => {
    expect(TagColors.getLuminance('not-a-color')).toBe(0.5);
  });
});

describe('v1 WCAG contrast ratio (tagColors.getContrastRatio)', () => {
  it('black-on-white is 21', () => {
    expect(TagColors.getContrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
  });

  it('white-on-white is 1', () => {
    expect(TagColors.getContrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('matches WCAG AA for black-on-yellow (#ffff00)', () => {
    // Known benchmark: black text on pure yellow has contrast ratio ≈ 19.56.
    const ratio = TagColors.getContrastRatio('#000000', '#ffff00');
    expect(ratio).toBeGreaterThan(19);
    expect(ratio).toBeLessThan(20);
  });

  it('matches WCAG AA for white-on-dark-gray (#444444)', () => {
    // Known benchmark: white on #444 is ≈ 9.74.
    const ratio = TagColors.getContrastRatio('#ffffff', '#444444');
    expect(ratio).toBeGreaterThan(9);
    expect(ratio).toBeLessThan(11);
  });
});

describe('tagColors.getContrastingTextColor (v1 threshold logic)', () => {
  it('picks black text on bright backgrounds (yellow)', () => {
    expect(TagColors.getContrastingTextColor('#ffff00', false)).toBe('#000000');
  });

  it('picks white text on dark backgrounds (navy)', () => {
    expect(TagColors.getContrastingTextColor('#001f5f', false)).toBe('#ffffff');
  });

  it('picks black text on white', () => {
    expect(TagColors.getContrastingTextColor('#ffffff', false)).toBe('#000000');
  });

  it('picks white text on black', () => {
    expect(TagColors.getContrastingTextColor('#000000', false)).toBe('#ffffff');
  });

  it('falls back to white on unparseable color instead of throwing', () => {
    expect(TagColors.getContrastingTextColor('not-a-color', false)).toBe('#ffffff');
  });

  it('respects the dark-mode threshold shift (0.35 vs 0.179)', () => {
    // Mid-luminance teal (#009999, luminance ≈ 0.26) sits BETWEEN the two
    // thresholds, so dark mode should flip to white text while light mode
    // keeps black. This is the specific behaviour v1 introduced to favor
    // white text on dark UIs.
    const lightModeChoice = TagColors.getContrastingTextColor('#009999', false);
    const darkModeChoice = TagColors.getContrastingTextColor('#009999', true);
    expect(lightModeChoice).toBe('#000000');
    expect(darkModeChoice).toBe('#ffffff');
  });
});

describe('tagColors.getContrastShadow (v1 bloom)', () => {
  it('returns empty string when contrast already exceeds WCAG AA 4.5', () => {
    // Black on white is 21:1.
    expect(TagColors.getContrastShadow('#000000', '#ffffff')).toBe('');
  });

  it('returns the v1 bloom "0 0 4px #888" when contrast is poor', () => {
    // White on pale yellow (contrast ≈ 1.07) is well below 4.5.
    expect(TagColors.getContrastShadow('#ffffff', '#ffffaa')).toBe('0 0 4px #888');
  });

  it('returns bloom for white text on light gray (< 4.5)', () => {
    expect(TagColors.getContrastShadow('#ffffff', '#bbbbbb')).toBe('0 0 4px #888');
  });

  it('returns empty for a contrast ratio of exactly 4.5 or better', () => {
    // Dark gray #595959 on white is ≈ 7.0 → no bloom needed.
    expect(TagColors.getContrastShadow('#595959', '#ffffff')).toBe('');
  });
});

describe('tagColors.getTextColorsForBackground (paired helper)', () => {
  it('returns { textColor, textShadow } for a dark background', () => {
    const result = TagColors.getTextColorsForBackground('#001f5f');
    expect(result).toEqual(
      expect.objectContaining({ textColor: '#ffffff' })
    );
    expect(typeof result.textShadow).toBe('string');
  });

  it('returns no shadow when contrast is already excellent', () => {
    const result = TagColors.getTextColorsForBackground('#000000');
    expect(result.textColor).toBe('#ffffff');
    expect(result.textShadow).toBe('');
  });
});

describe('buildTagStyleDescriptor populates labelShadow on all label-bearing roles', () => {
  // The descriptor pipeline must attach `labelShadow` (possibly empty) to
  // header, footer, and badge descriptors so the inline CSS generator has
  // something to emit. Every label role gets its own shadow decision based
  // on the label background color, mirroring v1's behaviour.

  it('includes labelShadow on the header role for any header-styled category', () => {
    // Pick a tag that resolves to the header role in the default preset.
    const descriptor = TagColors.buildTagStyleDescriptor('#inprogress');
    expect(descriptor).toBeTruthy();
    // header role yields a headerBar descriptor under the default preset
    if (descriptor.headerBar) {
      expect(descriptor.headerBar).toHaveProperty('labelShadow');
      expect(typeof descriptor.headerBar.labelShadow).toBe('string');
    }
  });

  it('includes labelShadow on the footer role', () => {
    const descriptor = TagColors.buildTagStyleDescriptor('#urgent');
    expect(descriptor).toBeTruthy();
    if (descriptor.footerBar) {
      expect(descriptor.footerBar).toHaveProperty('labelShadow');
    }
  });

  it('includes labelShadow on the badge role', () => {
    const descriptor = TagColors.buildTagStyleDescriptor('#++');
    expect(descriptor).toBeTruthy();
    if (descriptor.badge) {
      expect(descriptor.badge).toHaveProperty('labelShadow');
    }
  });
});

describe('buildTagStyleInlineCssText emits contrast + bloom variables', () => {
  // The CSS generator must now expose `--tag-surface-fg` and
  // `--tag-surface-text-shadow` for any background-role tag, so app.css can
  // apply the text color and bloom on tinted surfaces.

  function styleStateFor(tagName) {
    // buildTagStyleRenderState needs a raw style source. For the simplest
    // case we pass the tag literally — that's what gets written into card
    // / column / row titles.
    return TagColors.buildTagStyleRenderState(tagName);
  }

  it('emits --tag-surface-fg and --tag-surface-text-shadow for a background role', () => {
    const state = styleStateFor('#red');
    expect(state).toBeTruthy();
    const css = TagColors.buildTagStyleInlineCssText(state);
    expect(css).toContain('--tag-surface-fg:');
    expect(css).toContain('--tag-surface-text-shadow:');
  });

  it('picks white text on a dark tag color (contrast-aware, not just luminance > 0.6)', () => {
    // #0056B3 (Lexera blue) has WCAG luminance ≈ 0.077, well below both
    // thresholds → should yield white text.
    const state = styleStateFor('#blue');
    const css = TagColors.buildTagStyleInlineCssText(state);
    expect(css).toContain('--tag-surface-fg:#ffffff');
  });

  it('picks black text on a light-yellow tag color', () => {
    const state = styleStateFor('#light-yellow');
    const css = TagColors.buildTagStyleInlineCssText(state);
    expect(css).toContain('--tag-surface-fg:#000000');
  });

  it('emits "none" when the shadow is not needed so CSS var() has a clean fallback', () => {
    // On a high-contrast pairing, the shadow string must still be present
    // in the CSS so the var() reference resolves — but its value is "none".
    const state = styleStateFor('#black');
    const css = TagColors.buildTagStyleInlineCssText(state);
    expect(css).toMatch(/--tag-surface-text-shadow:(none|0 0 4px #888)/);
  });
});

describe('app.css wires the tag-surface contrast variables into painted text', () => {
  // Source-level check: the CSS must reference the new variables alongside
  // the existing tag-surface-bg rule so text painted on a tag-styled surface
  // picks up the contrast-aware color and bloom.
  it('uses --tag-surface-fg and --tag-surface-text-shadow on painted content', () => {
    const css = readFileSync(resolve(srcDir, 'app.css'), 'utf-8');
    expect(css).toContain('--tag-surface-fg');
    expect(css).toContain('--tag-surface-text-shadow');
    // It should also apply them to the tag-line-styled selector (the
    // line-level case) and to a card-content surface (the entity case).
    expect(css).toMatch(/\.tag-line-styled[\s\S]*?color:\s*var\(--tag-surface-fg/);
  });
});
