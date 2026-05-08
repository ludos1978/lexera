// Scroll-drift diagnostic contract.
//
// User reported (2026-05-08): when an inline card edit ends, the
// board scrolls so the just-edited card flies off the LEFT edge of
// the viewport. preserveBoardScroll() at app.js was meant to be the
// safety net but it had no visibility — when scrollLeft drifts
// between the snapshot and the rAF restore, we couldn't tell which
// of the four call sites (refreshTargetedElements, renderColumns,
// refreshAllRenderedCards, renderCardDisplayState) was bleeding.
//
// This contract pins the diagnostic that exposes which site drifts:
//   - preserveBoardScroll accepts an optional label
//   - reads localStorage.LEXERA_SCROLL_DRIFT_DEBUG === '1' to gate
//   - emits via logFrontendIssue('debug', 'render.scrollDrift', …)
//   - every call site passes a distinct label
//
// Why a static contract rather than a behavioural unit test:
// preserveBoardScroll is a closure inside the app.js IIFE, not
// reachable without the heavyweight tests/appUtils.js bootstrap. A
// regex-on-source contract is enough to catch accidental removal
// during future refactors and is the same baseline-pinning approach
// used by `consoleLoggingGuardrailContract` and friends.
//
// Once the user reproduces the bug with the diagnostic on, the
// follow-up slice can introduce a behavioural test that asserts
// the actual fix.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '..', 'src');

function read(rel) {
  return readFileSync(resolve(srcRoot, rel), 'utf8');
}

describe('scroll-drift diagnostic contract', () => {
  const appSrc = read('app.js');
  const cardEditorSrc = read('editor/cardEditor.js');

  it('preserveBoardScroll accepts an optional label parameter', () => {
    expect(appSrc).toMatch(/function\s+preserveBoardScroll\s*\(\s*label\s*\)/);
  });

  it('preserveBoardScroll reads LEXERA_SCROLL_DRIFT_DEBUG from localStorage', () => {
    expect(appSrc).toMatch(/LEXERA_SCROLL_DRIFT_DEBUG/);
    expect(appSrc).toMatch(/localStorage\.getItem\(['"]LEXERA_SCROLL_DRIFT_DEBUG['"]\)/);
  });

  it('preserveBoardScroll emits via logFrontendIssue with the render.scrollDrift topic', () => {
    expect(appSrc).toMatch(/logFrontendIssue\(\s*['"]debug['"]\s*,\s*['"]render\.scrollDrift['"]/);
  });

  it('the runtime export wrapper forwards the label arg', () => {
    expect(appSrc).toMatch(
      /preserveBoardScroll:\s*function\s*\(\s*label\s*\)\s*\{\s*return\s+preserveBoardScroll\(\s*label\s*\)\s*;\s*\}/
    );
  });

  it('refreshTargetedElements passes a label including each target type', () => {
    // Built like 'refreshTargetedElements:card,card-insert' so the
    // log entry tells the reader exactly which mutation drifted.
    expect(appSrc).toMatch(/refreshTargetedElements:/);
    expect(appSrc).toMatch(/preserveBoardScroll\(\s*rtScrollLabel\s*\)/);
  });

  it('renderColumns passes a "renderColumns" label', () => {
    expect(appSrc).toMatch(/preserveBoardScroll\(\s*['"]renderColumns['"]\s*\)/);
  });

  it('refreshAllRenderedCards passes a "refreshAllRenderedCards" label', () => {
    expect(appSrc).toMatch(/preserveBoardScroll\(\s*['"]refreshAllRenderedCards['"]\s*\)/);
  });

  it('renderCardDisplayState in cardEditor passes a "renderCardDisplayState" label', () => {
    expect(cardEditorSrc).toMatch(
      /preserveBoardScroll\(\s*['"]renderCardDisplayState['"]\s*\)/
    );
  });

  it('app.js has no remaining unlabeled preserveBoardScroll() call sites', () => {
    // Match the function-CALL form preserveBoardScroll() — i.e. an
    // open paren immediately followed by close paren — so the
    // wrapper definition `function preserveBoardScroll(label) {`
    // (which has the label param between the parens) is not flagged.
    // Also exclude the runtime-export wrapper line that legitimately
    // uses `function (label) { return preserveBoardScroll(label); }`.
    const offenders = appSrc
      .split('\n')
      .map((line, idx) => ({ line, idx: idx + 1 }))
      .filter(({ line }) => /\bpreserveBoardScroll\(\s*\)/.test(line));
    expect(offenders, offenders.map((o) => `line ${o.idx}: ${o.line.trim()}`).join('\n'))
      .toEqual([]);
  });

  it('cardEditor.js has no remaining unlabeled preserveBoardScroll() call sites', () => {
    const offenders = cardEditorSrc
      .split('\n')
      .map((line, idx) => ({ line, idx: idx + 1 }))
      .filter(({ line }) => /\bpreserveBoardScroll\(\s*\)/.test(line));
    expect(offenders, offenders.map((o) => `line ${o.idx}: ${o.line.trim()}`).join('\n'))
      .toEqual([]);
  });
});
