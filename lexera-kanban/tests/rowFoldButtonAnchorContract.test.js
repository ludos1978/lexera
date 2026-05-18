import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');

// Return the declaration bodies of every rule whose selector list is
// EXACTLY `selector` (whitespace-normalised). This deliberately does not
// match grouped/compound selectors like
// `.board-row.folded .board-row-header .row-fold-btn` so we can reason
// about the base rule in isolation.
function ruleBodies(selector) {
  const bodies = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(appCss)) !== null) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
    if (sel === selector) bodies.push(m[2]);
  }
  return bodies;
}

describe('row fold button stays pinned to the row corner across fold state', () => {
  // User contract 2026-05-18: the `.row-fold-btn` must NOT visibly move
  // when a row is folded/unfolded. The header is a rotated vertical rail
  // when unfolded and a flat horizontal bar when folded; if the button
  // inherits the header's `align-items: center` it gets centred in the
  // 34px rail (centre x = rail/2) but is left-anchored (centre x =
  // pad-x + S/2) when folded — a (rail - icon)/2 - pad-x horizontal jump
  // that the rejected `padding: 7px 4px` hack was hand-tuning.
  //
  // The fix is analytic, not a magic offset: anchoring the button to the
  // flex CROSS-start edge makes it resolve to the same physical
  // (pad-x, pad-y) corner in BOTH states (unfolded the cross-start edge
  // maps to x = pad-x after the rail's 180deg rotation; folded it maps
  // to y = pad-y). This test pins that anchor so the brittle padding
  // hack can't be reintroduced.
  it('anchors .board-row-header .row-fold-btn to the cross-start edge', () => {
    const bodies = ruleBodies('.board-row-header .row-fold-btn');
    expect(bodies.length, 'base .board-row-header .row-fold-btn rule must exist').toBeGreaterThan(0);
    const anchored = bodies.some((b) => /align-self\s*:\s*flex-start\s*;/.test(b));
    expect(anchored, '.board-row-header .row-fold-btn must declare align-self: flex-start').toBe(true);
  });

  it('aligns the title TEXT onto the icon-glyph axis via line-height = icon size', () => {
    // User contract 2026-05-18 (follow-up): "the text is not aligned
    // with the rest of the icons!". Icons are `--icon-button-size`
    // squares with flex-centred glyphs (glyph at pad + S/2). The thin
    // title text at flex-start would otherwise centre at
    // pad + lineHeight/2. Pinning the title's line box to the icon size
    // puts its text centre on the same axis in both writing modes.
    const bodies = ruleBodies('.board-row-title');
    expect(bodies.length, 'base .board-row-title rule must exist').toBeGreaterThan(0);
    const aligned = bodies.some((b) =>
      /line-height\s*:\s*var\(\s*--icon-button-size\s*\)\s*;/.test(b));
    expect(aligned, '.board-row-title must set line-height: var(--icon-button-size)').toBe(true);
  });

  it('anchors the whole .board-row-header column to the same cross-start edge', () => {
    // User contract 2026-05-18 (follow-up): "make sure that the rest of
    // the header is also aligned with the fold icon". The grip/title/
    // count/menu must hug the same cross-start edge as the fold button
    // instead of being centred in the 34px rail, so nothing in the
    // header shifts relative to the fold icon on fold/unfold.
    const bodies = ruleBodies('.board-row-header');
    expect(bodies.length, 'base .board-row-header rule must exist').toBeGreaterThan(0);
    const base = bodies.find((b) => /align-items\s*:/.test(b));
    expect(base, '.board-row-header must declare align-items').toBeTruthy();
    expect(base, '.board-row-header must align content to flex-start, not center')
      .toMatch(/align-items\s*:\s*flex-start\s*;/);
    expect(base, '.board-row-header must not re-center its content')
      .not.toMatch(/align-items\s*:\s*center\s*;/);
  });

  it('does not re-center or re-anchor the fold button in the folded variant', () => {
    // The folded override only flips `order`; if it ever sets align-self
    // back to center/auto the button would jump again on unfold.
    const re = /\.board-row\.folded\s+\.board-row-header\s+\.row-fold-btn\s*\{([^}]*)\}/g;
    let m;
    let found = false;
    while ((m = re.exec(appCss)) !== null) {
      found = true;
      expect(m[1], 'folded .row-fold-btn rule must not override align-self').not.toMatch(/align-self\s*:/);
    }
    expect(found, 'folded .row-fold-btn order rule must still exist').toBe(true);
  });
});

// User contract 2026-05-18 (follow-up): "now apply the same structure
// and calculation to all folding icons!". The stack header flips from
// a horizontal bar (unfolded) to a vertical column (folded) so its
// fold icon has the same jump class as the row's; the column header
// stays a bar but gets the same structure for consistency + the
// title-text-on-icon-axis alignment. Mirror of the row contract above.
describe('stack + column fold icons reuse the same anchor structure', () => {
  it('.board-stack-header anchors content to the cross-start edge (not center)', () => {
    const bodies = ruleBodies('.board-stack-header');
    expect(bodies.length, 'base .board-stack-header rule must exist').toBeGreaterThan(0);
    const base = bodies.find((b) => /align-items\s*:/.test(b));
    expect(base, '.board-stack-header must declare align-items').toBeTruthy();
    expect(base).toMatch(/align-items\s*:\s*flex-start\s*;/);
    expect(base).not.toMatch(/align-items\s*:\s*center\s*;/);
  });

  it('the folded .board-stack-header keeps the cross-start anchor (no re-center jump)', () => {
    const m = appCss.match(
      /\.board-stack\.folded\s+\.board-stack-header\s*\{([^}]*)\}/
    );
    expect(m, 'folded .board-stack-header rule must exist').not.toBeNull();
    expect(m[1]).toMatch(/align-items\s*:\s*flex-start\s*;/);
    expect(m[1]).not.toMatch(/align-items\s*:\s*center\s*;/);
  });

  it('the folded .board-stack-header reuses the SAME horizontal padding as the bar', () => {
    // The cross-start anchor only stops the fold-icon jump if the
    // anchored corner is the SAME physical coordinate in both states.
    // The folded header used --space-1 (2px) vs the unfolded bar's
    // --layout-stack-header-pad-x (7px) → a 5px jump. Pin that the
    // folded padding uses the pad-x token and NOT the old --space-1.
    const m = appCss.match(
      /\.board-stack\.folded\s+\.board-stack-header\s*\{([^}]*)\}/
    );
    expect(m, 'folded .board-stack-header rule must exist').not.toBeNull();
    expect(m[1], 'folded stack header must use the pad-x token')
      .toMatch(/padding\s*:\s*var\(\s*--layout-stack-header-pad-y\s*\)\s+var\(\s*--layout-stack-header-pad-x\s*\)\s*;/);
    expect(m[1], 'folded stack header must NOT revert to the narrower --space-1 inset')
      .not.toMatch(/padding\s*:[^;]*--space-1/);
  });

  it('.column-header anchors content to the cross-start edge (not center)', () => {
    const bodies = ruleBodies('.column-header');
    expect(bodies.length, 'base .column-header rule must exist').toBeGreaterThan(0);
    const base = bodies.find((b) => /align-items\s*:/.test(b));
    expect(base, '.column-header must declare align-items').toBeTruthy();
    expect(base).toMatch(/align-items\s*:\s*flex-start\s*;/);
    expect(base).not.toMatch(/align-items\s*:\s*center\s*;/);
  });

  it('the shared stack/column fold-btn rule pins align-self: flex-start', () => {
    // Grouped selector — match the rule directly. align-self is what
    // keeps the icon on the same physical corner across fold state.
    const m = appCss.match(
      /\.board-stack-header\s+\.stack-fold-btn\s*,\s*\.column-header\s+\.column-fold-btn\s*\{([\s\S]*?)\}/
    );
    expect(m, 'shared stack/column fold-btn rule must exist').not.toBeNull();
    expect(m[1]).toMatch(/align-self\s*:\s*flex-start\s*;/);
  });

  it('.board-stack-title and .column-title align text to the icon axis via line-height', () => {
    for (const sel of ['.board-stack-title', '.column-title']) {
      const bodies = ruleBodies(sel);
      const aligned = bodies.some((b) =>
        /line-height\s*:\s*var\(\s*--icon-button-size\s*\)\s*;/.test(b));
      expect(aligned, `${sel} must set line-height: var(--icon-button-size)`).toBe(true);
    }
  });
});
