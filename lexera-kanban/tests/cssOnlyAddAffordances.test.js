import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8');
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');

describe('empty-child add affordances', () => {
  // Historical note: the board viewer used to always render the
  // "+ Add row/stack/column" placeholders and rely on a CSS `:has()`
  // selector to hide them when children existed. That forced WebKit to
  // re-evaluate the ancestor style on every descendant insertion and
  // caused ~95k redundant style recomputations on a full 917-card
  // render. The render path now guards each placeholder with a JS
  // emptiness branch, and this test is the canary that enforces the
  // pattern so the CSS-based approach isn't accidentally reintroduced.
  it('wires add affordances to emptiness-branches + still appends to each level', () => {
    // Row and stack levels: branch-gated empty placeholders so the
    // "+ Add row" / "+ Add column" affordance is only in the DOM when
    // the container is actually empty (no stale placeholder haunting
    // populated structures and triggering CSS :has() recalc).
    expect(appJs).toContain('if (stackColumnEntries.length === 0)');
    expect(appJs).toContain('if (rowStacks.length === 0)');

    // Column level: the `has-cards` class is JS-driven instead of a
    // CSS :has() selector. Empty columns don't get the class; the
    // footer still renders (Add card button is always available), but
    // stylesheets key off `has-cards` for visual differentiation.
    expect(appJs).toContain("'column' + ((col.cards && col.cards.length > 0) ? ' has-cards' : '')");

    // Column footer still goes through the shared builder.
    expect(appJs).toContain('function buildColumnFooterContent(colIndex) {');
    expect(appJs).toContain('footer.appendChild(buildColumnFooterContent(col.index));');
    // Each empty-placeholder still gets appended inside its branch.
    expect(appJs).toContain('stackContent.appendChild(emptyColumns);');
    expect(appJs).toContain('rowContent.appendChild(emptyStacks);');
  });

  it('keeps the board-level-empty-* class names stable for CSS styling', () => {
    // The placeholders are still styled via these class names — the
    // change was in WHEN they render (conditionally), not HOW they
    // look. Keep the CSS hooks pinned so stylesheets and visual
    // regression tests don't drift apart.
    expect(appJs).toContain('board-level-empty-columns');
    expect(appJs).toContain('board-level-empty-stacks');
    expect(appJs).toContain('board-level-empty-rows');
  });

  it('hides "+ Add card" footer on columns that already have card siblings', () => {
    // The user-visible rule: add affordances must only appear when the
    // parent has no children at the same level. Stack ("+ Add column"),
    // row ("+ Add stack"), and board ("+ Add row") are JS-emptiness-
    // gated; card ("+ Add card") relies on a CSS rule keyed on the
    // `has-cards` class set by buildColumnElement. This test pins the
    // CSS rule that completes the contract for the card level.
    expect(appCss).toMatch(/\.column\.has-cards\s*>\s*\.column-footer[^{]*\{\s*display\s*:\s*none/);
  });

  it('hides "+ Add card" instantly via an adjacent-sibling rule the moment a card lands in column-cards', () => {
    // The JS-driven `.has-cards` class only flips on the next render
    // tick — the user wants the button gone the instant the first card
    // appears. An adjacent-sibling selector keyed on `:not(:empty)`
    // fires on DOM insertion without waiting for re-render. The rule
    // must also exclude `.add-mode` so the inline-edit footer (which
    // expands to a card editor in place of the button) stays visible
    // while typing. Sibling selectors are cheap — the perf trap was
    // the deleted `:has()` descendant selector.
    expect(appCss).toMatch(/\.column-cards:not\(:empty\)\s*\+\s*\.column-footer[^{]*\{\s*display\s*:\s*none/);
    // The :not(.add-mode) carve-out applies to BOTH branches of the
    // hide rule so add-mode stays interactive in either path.
    expect(appCss).toMatch(/\.column-cards:not\(:empty\)\s*\+\s*\.column-footer:not\(\.add-mode\)/);
  });

  it('"+ Add Row / Stack / Column / Card" buttons share visual treatment via the unified add-entity-btn class', () => {
    // The user-visible promise: every add-element button looks the
    // same. The unified `.add-entity-btn` class supplies the visual
    // treatment (border, radius, background, padding, font). Cards
    // additionally tag their button with `add-card-btn` for column-
    // footer-context tweaks (full width + left align). Pin both halves
    // so a refactor that splits the visuals back into per-entity
    // classes is caught.
    expect(appJs).toContain("btnClass: 'add-entity-btn add-card-btn'");
    // `.add-entity-btn` owns the shared visual treatment.
    expect(appCss).toMatch(/\.add-entity-btn\s*\{[^}]*background:\s*var\(--btn-bg\)[^}]*border:\s*1px dashed var\(--border\)[^}]*\}/s);
    // `.add-card-btn` keeps ONLY the context tweaks. `width: 100%` and
    // `text-align: left` belong here; visual treatment must NOT be
    // re-introduced or it would override the shared class.
    const addCardRule = appCss.match(/\.add-card-btn\s*\{([^}]*)\}/);
    expect(addCardRule, '.add-card-btn rule must exist').toBeTruthy();
    expect(addCardRule[1]).toContain('width: 100%');
    expect(addCardRule[1]).toContain('text-align: left');
    expect(addCardRule[1]).not.toMatch(/background\s*:/);
    expect(addCardRule[1]).not.toMatch(/border\s*:/);
    expect(addCardRule[1]).not.toMatch(/border-radius\s*:/);
  });
});
