// Card-edit horizontal scroll-latch contract.
//
// User reported (2026-05-08, traced 2026-05-09): when an inline card
// edit ends, scrollLeft snaps to maxScrollLeft within ~140 ms with
// an empty JS stack — i.e. the scroll happens AFTER both
// `restoreBoardScroll` calls (sync + 1 rAF) and is browser-initiated
// (focus-driven scroll-into-view, content-visibility: auto reflow,
// or post-decode embed layout shift).
//
// `lockBoardScrollHorizontal(durationMs)` is a defensive scroll-latch
// — installs a scroll listener that resets `scrollLeft` to its
// pre-save value for ~400 ms. The latch covers all three plausible
// triggers without having to identify which one fired.
//
// This contract pins:
//   - app.js declares the lockBoardScrollHorizontal function
//   - it's exported through `_deps.lockBoardScrollHorizontal`
//   - both editor paths (saveCardEdit + cancel-path
//     closeInlineCardEditor) call it before re-rendering the card
//
// Behavioural test (DOM scroll listener semantics) needs the full
// shell bootstrap and is deferred; this static contract is enough
// to catch accidental removal during refactors.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '..', 'src');

function read(rel) {
  return readFileSync(resolve(srcRoot, rel), 'utf8');
}

describe('card-edit horizontal scroll-latch contract', () => {
  const appSrc = read('app.js');
  const cardEditorSrc = read('editor/cardEditor.js');
  const inlineCardEditorSrc = read('editor/inlineCardEditor.js');

  it('app.js declares lockBoardScrollHorizontal', () => {
    expect(appSrc).toMatch(/function\s+lockBoardScrollHorizontal\s*\(\s*durationMs\s*\)/);
  });

  it('the latch reads scrollLeft from .columns-container at install time', () => {
    const fnBlock = appSrc.match(
      /function\s+lockBoardScrollHorizontal[\s\S]{0,2500}?^\s{2}\}/m
    );
    expect(fnBlock).toBeTruthy();
    expect(fnBlock[0]).toMatch(/getElColumnsContainer\(\)/);
    expect(fnBlock[0]).toMatch(/lockedLeft\s*=\s*cc\.scrollLeft/);
  });

  it('the latch installs a scroll listener that resets drift to lockedLeft', () => {
    const fnBlock = appSrc.match(
      /function\s+lockBoardScrollHorizontal[\s\S]{0,2500}?^\s{2}\}/m
    );
    expect(fnBlock[0]).toMatch(/cc\.addEventListener\(\s*['"]scroll['"]/);
    expect(fnBlock[0]).toMatch(/cc\.scrollLeft\s*=\s*lockedLeft/);
  });

  it('the latch hard-uninstalls after the deadline via setTimeout', () => {
    const fnBlock = appSrc.match(
      /function\s+lockBoardScrollHorizontal[\s\S]{0,2500}?^\s{2}\}/m
    );
    expect(fnBlock[0]).toMatch(/setTimeout\(\s*detach/);
  });

  it('the latch defaults to 400ms when durationMs is omitted or non-positive', () => {
    const fnBlock = appSrc.match(
      /function\s+lockBoardScrollHorizontal[\s\S]{0,2500}?^\s{2}\}/m
    );
    expect(fnBlock[0]).toMatch(/typeof\s+durationMs\s*===\s*['"]number['"]/);
    expect(fnBlock[0]).toMatch(/\b400\b/);
  });

  it('the runtime export wrapper forwards the durationMs arg', () => {
    expect(appSrc).toMatch(
      /lockBoardScrollHorizontal:\s*function\s*\(\s*durationMs\s*\)\s*\{\s*return\s+lockBoardScrollHorizontal\(\s*durationMs\s*\)\s*;\s*\}/
    );
  });

  it('saveCardEdit calls lockBoardScrollHorizontal before persisting', () => {
    // Match the call inside the saveCardEdit body — guarded by
    // `typeof _deps.lockBoardScrollHorizontal === 'function'` so the
    // test setup doesn't need to stub it.
    const saveBlock = cardEditorSrc.match(
      /async\s+function\s+saveCardEdit[\s\S]{0,3000}?^\s{2}\}/m
    );
    expect(saveBlock).toBeTruthy();
    expect(saveBlock[0]).toMatch(
      /_deps\.lockBoardScrollHorizontal\s*===\s*['"]function['"]/
    );
    expect(saveBlock[0]).toMatch(/_deps\.lockBoardScrollHorizontal\(\s*400\s*\)/);
  });

  it('inlineCardEditor cancel path also calls lockBoardScrollHorizontal', () => {
    // Cancel rebuilds the card via renderCardDisplayState — same
    // scroll-jump risk as save, so the latch must be installed there
    // too.
    expect(inlineCardEditorSrc).toMatch(
      /_deps\.lockBoardScrollHorizontal\s*===\s*['"]function['"]/
    );
    expect(inlineCardEditorSrc).toMatch(
      /_deps\.lockBoardScrollHorizontal\(\s*400\s*\)/
    );
  });
});
