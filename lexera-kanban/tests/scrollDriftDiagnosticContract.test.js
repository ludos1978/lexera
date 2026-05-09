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

  // ── Universal scroll watcher (.columns-container) ─────────────────
  // Companion diagnostic to preserveBoardScroll — the universal
  // watcher captures scroll events even when they fire OUTSIDE the
  // restoreBoardScroll() window (browser-initiated scroll-anchoring,
  // focus-driven scroll-into-view, post-decode layout shifts). Same
  // localStorage flag (LEXERA_SCROLL_DRIFT_DEBUG=1) gates the log
  // emission. The activeElement field is the smoking gun for
  // focus-driven horizontal drift: empty JS stack + a card/textarea
  // activeElement at scroll time means the browser's
  // scroll-into-view-on-focus is the trigger, not anchoring.

  it('app.js installs the universal scroll watcher on .columns-container', () => {
    expect(appSrc).toMatch(/installBoardScrollDriftWatcher/);
    expect(appSrc).toMatch(/__lexeraDriftWatcherInstalled/);
    expect(appSrc).toMatch(/document\.querySelector\(['"]\.columns-container['"]\)/);
  });

  it('the universal watcher gates log emission on LEXERA_SCROLL_DRIFT_DEBUG', () => {
    // Same flag the preserveBoardScroll-side logger uses, so toggling
    // one flag turns BOTH diagnostics on at once.
    const watcherBlock = appSrc.match(/installBoardScrollDriftWatcher[\s\S]{0,4000}/);
    expect(watcherBlock).toBeTruthy();
    expect(watcherBlock[0]).toMatch(/LEXERA_SCROLL_DRIFT_DEBUG/);
  });

  it('the universal watcher emits via logFrontendIssue with the scroll-drift topic', () => {
    expect(appSrc).toMatch(/logFrontendIssue\(\s*['"]debug['"]\s*,\s*['"]scroll-drift['"]/);
  });

  it('the universal watcher captures document.activeElement at scroll time', () => {
    // Empty JS stack + activeElement = focus-driven horizontal scroll
    // (the leading hypothesis); empty stack + body = anchoring.
    expect(appSrc).toMatch(/document\.activeElement/);
    expect(appSrc).toMatch(/active=/);
  });

  it('the universal watcher includes scrollWidth/clientWidth so deltaLeft → maxScrollLeft can be decoded', () => {
    expect(appSrc).toMatch(/scrollWidth=/);
    expect(appSrc).toMatch(/clientWidth=/);
  });

  // ── Focus-trace watcher (document-level focusin listener) ────────
  // Companion to the universal scroll watcher. Logs every focus
  // change with the activeElement's bounding rect + viewport size +
  // an `inView` boolean. Same LEXERA_SCROLL_DRIFT_DEBUG gate. The
  // user's hypothesis is that focus is landing on an element OUTSIDE
  // the visible viewport ("focuses in an area where the view isnt"),
  // and the browser auto-scrolls to follow it. Without focus tracing
  // we can only see the scroll, not the trigger.

  it('app.js installs the focus-trace watcher on document', () => {
    expect(appSrc).toMatch(/installFocusTraceWatcher/);
    expect(appSrc).toMatch(/__lexeraFocusTraceInstalled/);
    expect(appSrc).toMatch(/document\.addEventListener\(\s*['"]focusin['"]/);
  });

  it('the focus-trace watcher gates log emission on LEXERA_SCROLL_DRIFT_DEBUG', () => {
    const block = appSrc.match(/installFocusTraceWatcher[\s\S]{0,3500}/);
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/LEXERA_SCROLL_DRIFT_DEBUG/);
  });

  it('the focus-trace watcher emits via logFrontendIssue with the focus-trace topic', () => {
    expect(appSrc).toMatch(/logFrontendIssue\(\s*['"]debug['"]\s*,\s*['"]focus-trace['"]/);
  });

  it('the focus-trace watcher captures bounding rect + viewport size + inView flag', () => {
    const block = appSrc.match(/installFocusTraceWatcher[\s\S]{0,3500}/);
    expect(block[0]).toMatch(/getBoundingClientRect/);
    expect(block[0]).toMatch(/window\.innerWidth/);
    expect(block[0]).toMatch(/inView=/);
  });
});
