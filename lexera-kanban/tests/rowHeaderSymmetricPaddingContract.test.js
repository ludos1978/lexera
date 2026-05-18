import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');

function tokenValue(name) {
  // Match `--name: <value>;` ignoring any trailing comment.
  const m = appCss.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

describe('board-row-header rail padding is symmetric', () => {
  // User contract 2026-05-18: "the board-row-header needs a left/right
  // padding of the same as the top/bottom". The rail header pulls its
  // padding from `--layout-row-header-pad-y` (top/bottom) and
  // `--layout-row-header-pad-x` (left/right). Historically pad-x was
  // hard-pinned to `0px` to mimic a design rail of `padding: 6px 0`.
  // This test pins the two tokens to the SAME value so a future tweak
  // to one (e.g. retuning the rail thickness) can't silently
  // re-introduce the asymmetric `6px 0` rail.
  it('pins --layout-row-header-pad-x equal to --layout-row-header-pad-y', () => {
    const padY = tokenValue('layout-row-header-pad-y');
    const padX = tokenValue('layout-row-header-pad-x');
    expect(padY, '--layout-row-header-pad-y must be defined').toBeTruthy();
    expect(padX, '--layout-row-header-pad-x must be defined').toBeTruthy();
    expect(padX).toBe(padY);
    // Guard the asymmetric legacy value specifically — pad-x must no
    // longer be the bare `0px` that produced the lopsided rail.
    expect(padX).not.toBe('0px');
  });

  it('still applies both tokens to the .board-row-header padding shorthand', () => {
    // The padding shorthand order is `pad-y pad-x`; both the base rule
    // and the folded variant must keep consuming the tokens so the
    // symmetric values actually reach the rendered rail.
    const padDecl = /padding:\s*var\(--layout-row-header-pad-y\)\s+var\(--layout-row-header-pad-x\)/g;
    const matches = appCss.match(padDecl) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
