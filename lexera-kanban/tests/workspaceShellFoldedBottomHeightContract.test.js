// Pin the explicit 22-px height for the folded bottom dock.
//
// User-reported 2026-05-05: with `is-visible is-folded is-fold-locked`
// the dock element computed-height was 0 — the parent grid track was
// supposed to allocate FOLD_SIZE (22px) via gridTemplateRows but the
// `min-height: 0` rule on `.workspace-shell-panel-dock` allowed the
// element to collapse to zero. Result: fold strip in DOM, but
// painted at 0×N — invisible.
//
// Fix in workspaceShell.css adds an explicit height rule on
// `.workspace-shell-panel-dock.is-folded[data-dock="bottom"]`.
// CSS isn't runnable inside Vitest, so this contract test scans the
// stylesheet text and refuses any change that drops the rule.
//
// Why pin this in CSS specifically: the FOLD_SIZE value (22) lives in
// workspaceShell.js too. If they diverge, the grid track and the dock
// element disagree and the bug returns silently. Both sources are
// asserted here.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(__dirname, '..', 'src', 'workspace', 'workspaceShell.css');
const jsPath = resolve(__dirname, '..', 'src', 'workspace', 'workspaceShell.js');

describe('folded bottom-dock fixed-height contract', () => {
  it('CSS sets explicit height on .workspace-shell-panel-dock.is-folded[data-dock="bottom"]', () => {
    const css = readFileSync(cssPath, 'utf8');
    // Match the selector + a height declaration in the same rule body.
    const ruleRe = /\.workspace-shell-panel-dock\.is-folded\[data-dock="bottom"\]\s*\{[^}]*height\s*:\s*22px[^}]*\}/;
    expect(
      ruleRe.test(css),
      'CSS must explicitly set `height: 22px` on the folded bottom dock element. ' +
      'Without this, the parent grid track collapses under min-height:0 and the ' +
      'fold strip paints at 0×N (invisible).'
    ).toBe(true);
  });

  it('CSS rule pins both height AND flex-basis so neither flex nor grid auto-sizing wins', () => {
    const css = readFileSync(cssPath, 'utf8');
    const ruleRe = /\.workspace-shell-panel-dock\.is-folded\[data-dock="bottom"\]\s*\{([^}]*)\}/;
    const m = css.match(ruleRe);
    expect(m, 'rule body must exist').toBeTruthy();
    expect(m[1]).toMatch(/flex\s*:\s*0\s+0\s+22px/);
  });

  it('JS FOLD_SIZE constant matches the CSS 22px so the grid track agrees with the element', () => {
    const js = readFileSync(jsPath, 'utf8');
    // Find `var FOLD_SIZE = N` (it lives inside syncDockGridTracks per the
    // call-site at workspaceShell.js:~1342). Tolerate let/const for future
    // refactors.
    const re = /(?:var|let|const)\s+FOLD_SIZE\s*=\s*(\d+)\s*;/;
    const m = js.match(re);
    expect(m, 'FOLD_SIZE constant must exist in workspaceShell.js').toBeTruthy();
    expect(m[1], 'FOLD_SIZE must be 22 to match the CSS height rule').toBe('22');
  });
});
