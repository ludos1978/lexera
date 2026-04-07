import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

/**
 * Regression tests for the text-style primitive tags:
 *   #font-light, #font-normal, #font-bold,
 *   #font-italic, #font-underline, #font-uppercase.
 *
 * These were added in 2026-04-05 to close the remaining part of todo.md
 * "Redo the font/style unification pass — Keep only: light/normal/bold,
 * italic/underlined, uppercase, and high-contrast background tags …".
 *
 * Requirements pinned here:
 *
 *   1. Each tag resolves to a `text-style` role in TAG_STYLE_ROLE_BY_CATEGORY.
 *   2. `buildTagStyleDescriptor` populates a `textStyle` sub-object with
 *      exactly one typographic property per tag.
 *   3. Text-style tags do NOT emit a border on their own (border === null)
 *      so `#font-bold` by itself does not paint a color stripe.
 *   4. `buildCombinedTagStyleDescriptor` merges `textStyle` across multiple
 *      tags so `#font-bold #font-italic` stacks. "Last wins" per-field
 *      when two tags target the same property (e.g. `#font-light #font-bold`).
 *   5. `buildTagStyleInlineCssText` emits the right CSS custom properties:
 *      `--tag-text-weight`, `--tag-text-font-style`, `--tag-text-decoration`,
 *      `--tag-text-transform`.
 *   6. Combining a text-style tag with a color tag preserves the color's
 *      background/border AND picks up the text-style.
 *   7. `app.css` references all four text-style variables on the canonical
 *      content selectors.
 *
 * The module is loaded via the same sandboxed-IIFE pattern used by
 * `tagContrastFormula.test.js` so there's no DOM/framework dependency.
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

describe('font-style category registration', () => {
  it('exposes all six text-style tags under the font-style category', () => {
    const fontStyleTags = TagColors.TAG_CATEGORIES['font-style'];
    expect(fontStyleTags).toEqual([
      'font-light',
      'font-normal',
      'font-bold',
      'font-italic',
      'font-underline',
      'font-uppercase',
    ]);
  });

  it('maps the font-style category to the text-style role', () => {
    expect(TagColors.TAG_STYLE_ROLE_BY_CATEGORY['font-style']).toBe('text-style');
  });

  it('resolves the role via getResolvedCategoryRole (default preset)', () => {
    expect(TagColors.getResolvedCategoryRole('font-style')).toBe('text-style');
  });
});

describe('buildTagStyleDescriptor: text-style role', () => {
  function descriptorFor(tag) {
    return TagColors.buildTagStyleDescriptor(tag);
  }

  it('#font-light sets textStyle.weight to 300', () => {
    const d = descriptorFor('#font-light');
    expect(d).toBeTruthy();
    expect(d.textStyle).toEqual({ weight: '300' });
  });

  it('#font-normal sets textStyle.weight to 400', () => {
    expect(descriptorFor('#font-normal').textStyle).toEqual({ weight: '400' });
  });

  it('#font-bold sets textStyle.weight to 700', () => {
    expect(descriptorFor('#font-bold').textStyle).toEqual({ weight: '700' });
  });

  it('#font-italic sets textStyle.italic true', () => {
    expect(descriptorFor('#font-italic').textStyle).toEqual({ italic: true });
  });

  it('#font-underline sets textStyle.underline true', () => {
    expect(descriptorFor('#font-underline').textStyle).toEqual({ underline: true });
  });

  it('#font-uppercase sets textStyle.uppercase true', () => {
    expect(descriptorFor('#font-uppercase').textStyle).toEqual({ uppercase: true });
  });

  it('text-style tags emit NO border on their own', () => {
    // The border:null guarantee is what keeps `#font-bold` from painting a
    // 2 px color stripe alongside a stand-alone bolded card.
    for (const tag of [
      '#font-light',
      '#font-normal',
      '#font-bold',
      '#font-italic',
      '#font-underline',
      '#font-uppercase',
    ]) {
      const d = descriptorFor(tag);
      expect(d.border, tag + ' should have null border').toBeNull();
    }
  });

  it('text-style tags emit NO background/headerBar/footerBar/badge', () => {
    const d = descriptorFor('#font-bold');
    expect(d.background).toBeNull();
    expect(d.headerBar).toBeNull();
    expect(d.footerBar).toBeNull();
    expect(d.badge).toBeNull();
  });
});

describe('buildCombinedTagStyleDescriptor: text-style merging', () => {
  it('stacks independent text-style flags from multiple tags', () => {
    const combined = TagColors.buildCombinedTagStyleDescriptor([
      '#font-bold',
      '#font-italic',
    ]);
    expect(combined.textStyle).toEqual({
      weight: '700',
      italic: true,
    });
  });

  it('stacks all four typographic dimensions at once', () => {
    const combined = TagColors.buildCombinedTagStyleDescriptor([
      '#font-bold',
      '#font-italic',
      '#font-underline',
      '#font-uppercase',
    ]);
    expect(combined.textStyle).toEqual({
      weight: '700',
      italic: true,
      underline: true,
      uppercase: true,
    });
  });

  it('last-wins for the same typographic dimension (#font-light #font-bold → bold)', () => {
    const combined = TagColors.buildCombinedTagStyleDescriptor([
      '#font-light',
      '#font-bold',
    ]);
    expect(combined.textStyle).toEqual({ weight: '700' });
  });

  it('last-wins flipped order (#font-bold #font-light → light)', () => {
    const combined = TagColors.buildCombinedTagStyleDescriptor([
      '#font-bold',
      '#font-light',
    ]);
    expect(combined.textStyle).toEqual({ weight: '300' });
  });

  it('merges text-style with a color tag without clobbering the color', () => {
    const combined = TagColors.buildCombinedTagStyleDescriptor([
      '#red',
      '#font-bold',
    ]);
    // Red contributes the background descriptor.
    expect(combined.background).toBeTruthy();
    // And #font-bold still contributes the weight.
    expect(combined.textStyle).toEqual({ weight: '700' });
  });

  it('returns null textStyle when no text-style tag is present', () => {
    const combined = TagColors.buildCombinedTagStyleDescriptor(['#red']);
    expect(combined.textStyle).toBeNull();
  });
});

describe('buildTagStyleInlineCssText: text-style CSS variables', () => {
  function cssFor(tagText) {
    const state = TagColors.buildTagStyleRenderState(tagText);
    if (!state) return '';
    return TagColors.buildTagStyleInlineCssText(state);
  }

  it('emits --tag-text-weight for #font-bold', () => {
    const css = cssFor('#font-bold');
    expect(css).toContain('--tag-text-weight:700');
  });

  it('emits --tag-text-font-style for #font-italic', () => {
    const css = cssFor('#font-italic');
    expect(css).toContain('--tag-text-font-style:italic');
  });

  it('emits --tag-text-decoration for #font-underline', () => {
    const css = cssFor('#font-underline');
    expect(css).toContain('--tag-text-decoration:underline');
  });

  it('emits --tag-text-transform for #font-uppercase', () => {
    const css = cssFor('#font-uppercase');
    expect(css).toContain('--tag-text-transform:uppercase');
  });

  it('emits all four variables when every text-style tag is combined', () => {
    const css = cssFor('#font-bold #font-italic #font-underline #font-uppercase');
    expect(css).toContain('--tag-text-weight:700');
    expect(css).toContain('--tag-text-font-style:italic');
    expect(css).toContain('--tag-text-decoration:underline');
    expect(css).toContain('--tag-text-transform:uppercase');
  });

  it('#font-light emits weight 300 (not 700)', () => {
    const css = cssFor('#font-light');
    expect(css).toContain('--tag-text-weight:300');
    expect(css).not.toContain('--tag-text-weight:700');
  });

  it('#font-normal emits weight 400', () => {
    const css = cssFor('#font-normal');
    expect(css).toContain('--tag-text-weight:400');
  });

  it('combining #red and #font-bold emits BOTH background and weight vars', () => {
    const css = cssFor('#red #font-bold');
    expect(css).toContain('--tag-surface-bg:');
    expect(css).toContain('--tag-text-weight:700');
  });

  it('does not emit text-style vars for a plain color tag', () => {
    const css = cssFor('#red');
    expect(css).not.toContain('--tag-text-weight:');
    expect(css).not.toContain('--tag-text-font-style:');
    expect(css).not.toContain('--tag-text-decoration:');
    expect(css).not.toContain('--tag-text-transform:');
  });
});

describe('app.css wires the text-style variables into content selectors', () => {
  // Source-level check: the CSS must reference all four variables on a
  // canonical content selector so text-style tags actually affect rendered
  // text. Without this wiring the CSS variables would be set but unused.
  const css = readFileSync(resolve(srcDir, 'app.css'), 'utf-8');

  it('references --tag-text-weight in a content rule', () => {
    expect(css).toMatch(/font-weight:\s*var\(--tag-text-weight/);
  });

  it('references --tag-text-font-style in a content rule', () => {
    expect(css).toMatch(/font-style:\s*var\(--tag-text-font-style/);
  });

  it('references --tag-text-decoration in a content rule', () => {
    expect(css).toMatch(/text-decoration:\s*var\(--tag-text-decoration/);
  });

  it('references --tag-text-transform in a content rule', () => {
    expect(css).toMatch(/text-transform:\s*var\(--tag-text-transform/);
  });

  it('applies the text-style variables to .tag-line-styled (line-level case)', () => {
    // The canonical selector block must list .tag-line-styled alongside the
    // entity-level card content selectors so a line like
    // `**bold text** #font-bold` gets the weight applied to that line only.
    const blockMatch = css.match(
      /\.card\.tag-styled \.card-content[^}]*?\.tag-line-styled[^}]*?font-weight:\s*var\(--tag-text-weight/s
    );
    expect(blockMatch).not.toBeNull();
  });
});
