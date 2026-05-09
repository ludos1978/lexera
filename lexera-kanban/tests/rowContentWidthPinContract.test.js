import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Source-text contract for the .board-row-content width pin.
//
// Why pin at all: with .board-row-content { width: auto } and
// content-visibility: auto on .card / .column, WebKit recomputes the row's
// max-content on every layout pass and feeds descendant intrinsic-size
// placeholders into that calculation when content-visibility flips on
// scroll. Result: scrollWidth oscillates by 100s–1000s of px and the
// browser auto-clamps scrollLeft (visible "snap back to the left").
//
// Pinning .board-row-content to a measured pixel width short-circuits the
// auto-width recomputation entirely, so the row stays stable as offscreen
// cards/columns flip their content-visibility state.
//
// This contract test pins three things:
//   1. The pin function exists.
//   2. It writes an explicit pixel width onto .board-row-content using
//      stack offsetLeft + offsetWidth + paddingRight.
//   3. It runs after every render, after every targeted refresh, AND on
//      the next animation frame after any column/stack/row fold-toggle.
//      Without the fold trigger, unfolding a stack would not extend the
//      row, defeating the original symptom that brought us here.

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8');

describe('.board-row-content width pin contract', () => {
  it('defines syncRenderedRowWidths', () => {
    expect(appJs).toMatch(/function\s+syncRenderedRowWidths\s*\(/);
  });

  it('writes an explicit pixel width on .board-row-content using measured stack geometry', () => {
    const fnMatch = appJs.match(/function\s+syncRenderedRowWidths\s*\(\)\s*\{[\s\S]*?\n  \}/);
    expect(fnMatch).toBeTruthy();
    const body = fnMatch[0];
    expect(body).toContain(".querySelectorAll('.board-row')");
    expect(body).toContain(".board-row-content");
    expect(body).toMatch(/stack\.offsetLeft\s*\+\s*stack\.offsetWidth/);
    expect(body).toMatch(/content\.style\.width\s*=/);
    expect(body).toMatch(/paddingRight/);
  });

  it('clears the pin on folded rows so a folded row does not lock to a stale wide value', () => {
    const fnMatch = appJs.match(/function\s+syncRenderedRowWidths\s*\(\)\s*\{[\s\S]*?\n  \}/);
    const body = fnMatch[0];
    expect(body).toMatch(/classList\.contains\(['"]folded['"]\)/);
    expect(body).toMatch(/content\.style\.width\s*=\s*['"]['"]/);
  });

  it('runs after the post-render rAF and on the targeted-refresh path', () => {
    expect(appJs).toMatch(/needsStructuralVs[\s\S]{0,200}syncRenderedRowWidths\(\)/);
    expect(appJs).toMatch(/requestAnimationFrame\(function\s*\(\)\s*\{[\s\S]{0,400}syncRenderedRowWidths\(\)/);
  });

  it('re-pins on next frame after column / stack / row fold toggles', () => {
    for (const kind of ['Column', 'Stack', 'Row']) {
      const re = new RegExp(`function\\s+toggle${kind}FoldElement[\\s\\S]*?requestAnimationFrame\\(syncRenderedRowWidths\\)`);
      expect(appJs, `toggle${kind}FoldElement must schedule syncRenderedRowWidths via rAF after the underlying toggle`).toMatch(re);
    }
  });
});
