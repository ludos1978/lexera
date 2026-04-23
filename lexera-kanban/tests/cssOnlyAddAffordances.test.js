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
});
