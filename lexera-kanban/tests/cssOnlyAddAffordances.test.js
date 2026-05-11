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

    // Column level: the "+ Add card" footer visibility is PURE CSS
    // (adjacent-sibling on `.column-cards:not(:empty)`). No JS class
    // toggle remains — the build path just sets a plain `'column'`
    // className. User contract 2026-05-11: "REMOVE ALL OTHER CODE
    // THAT SHOWS OR HIDES THESE BUTTONS".
    expect(appJs).toMatch(/colEl\.className\s*=\s*['"]column['"]\s*;/);
    expect(appJs).not.toContain("has-cards");

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

  it('hides "+ Add card" via a single CSS adjacent-sibling selector — no other show/hide code exists', () => {
    // User contract 2026-05-11: "+ Add card MUST ONLY SHOW WHEN
    // THERE ARE NO CARDS. SOLVE THIS WITH CSS SELECTORS. REMOVE
    // ALL OTHER CODE THAT SHOWS OR HIDES THESE BUTTONS."
    //
    // The sole hide rule is `.column-cards:not(:empty) +
    // .column-footer:not(.add-mode) { display: none }`:
    //   - `:not(:empty)` flips the moment the first card lands.
    //   - `:not(.add-mode)` keeps the inline composer visible.
    //   - Adjacent-sibling combinator is cheap on WebKit (the
    //     historical perf trap was `:has()` descendant selector).
    expect(appCss).toMatch(/\.column-cards:not\(:empty\)\s*\+\s*\.column-footer:not\(\.add-mode\)\s*\{\s*display\s*:\s*none/);

    // The legacy `.column.has-cards > .column-footer { display: none }`
    // selector AND its JS-driven class toggle have been removed. The
    // CSS file must NOT contain the .has-cards rule anymore.
    expect(appCss).not.toMatch(/\.column\.has-cards/);
    // The JS must NOT toggle a .has-cards class anywhere.
    expect(appJs).not.toContain("'has-cards'");
    expect(appJs).not.toContain('"has-cards"');
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
