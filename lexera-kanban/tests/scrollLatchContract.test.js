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
    // Second param (targetLeft) added 2026-05-10 — see the
    // pre-edit-scrollLeft contract test below for rationale.
    expect(appSrc).toMatch(
      /function\s+lockBoardScrollHorizontal\s*\(\s*durationMs\s*,\s*targetLeft\s*\)/
    );
  });

  it('the latch falls back to capturing scrollLeft when targetLeft isnt supplied', () => {
    const fnBlock = appSrc.match(
      /function\s+lockBoardScrollHorizontal[\s\S]{0,3500}?^\s{2}\}/m
    );
    expect(fnBlock).toBeTruthy();
    expect(fnBlock[0]).toMatch(/getElColumnsContainer\(\)/);
    expect(fnBlock[0]).toMatch(/cc\.scrollLeft/);
    // The fallback branch picks up cc.scrollLeft when targetLeft is
    // not a finite number.
    expect(fnBlock[0]).toMatch(/typeof\s+targetLeft\s*===\s*['"]number['"]/);
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

  it('the runtime export wrapper forwards both durationMs and targetLeft', () => {
    expect(appSrc).toMatch(
      /lockBoardScrollHorizontal:\s*function\s*\(\s*durationMs\s*,\s*targetLeft\s*\)\s*\{\s*return\s+lockBoardScrollHorizontal\(\s*durationMs\s*,\s*targetLeft\s*\)\s*;?\s*\}/
    );
  });

  it('saveCardEdit calls lockBoardScrollHorizontal with the resolved targetLeft', () => {
    const saveBlock = cardEditorSrc.match(
      /async\s+function\s+saveCardEdit[\s\S]{0,3500}?^\s{2}\}/m
    );
    expect(saveBlock).toBeTruthy();
    expect(saveBlock[0]).toMatch(
      /_deps\.lockBoardScrollHorizontal\s*===\s*['"]function['"]/
    );
    // Now passes targetLeft as the second arg (resolved from
    // options.preEditScrollLeft when supplied).
    expect(saveBlock[0]).toMatch(
      /_deps\.lockBoardScrollHorizontal\(\s*400\s*,\s*targetLeft\s*\)/
    );
  });

  it('inlineCardEditor cancel path also calls lockBoardScrollHorizontal with editor.preEditScrollLeft', () => {
    expect(inlineCardEditorSrc).toMatch(
      /_deps\.lockBoardScrollHorizontal\s*===\s*['"]function['"]/
    );
    // Cancel passes editor.preEditScrollLeft directly as the
    // latch's targetLeft — restores the user's pre-edit position.
    expect(inlineCardEditorSrc).toMatch(
      /lockBoardScrollHorizontal\(\s*400\s*,\s*editor\.preEditScrollLeft\s*\)/
    );
  });

  it('the latch accepts an optional targetLeft to restore a pre-edit scrollLeft', () => {
    // User-reported bug (2026-05-10): "view moves even when the
    // card is already in viewport" — the textarea-focus inside the
    // editor shifts scrollLeft mid-edit, so capturing scrollLeft at
    // save time restores the wrong value. Inline editor now stashes
    // pre-edit scrollLeft on the editor record and passes it through
    // saveCardEdit's options as targetLeft.
    expect(appSrc).toMatch(
      /function\s+lockBoardScrollHorizontal\s*\(\s*durationMs\s*,\s*targetLeft\s*\)/
    );
    expect(appSrc).toMatch(
      /lockedLeft\s*=\s*typeof\s+targetLeft\s*===\s*['"]number['"]/
    );
    // Runtime export must also forward the second arg.
    expect(appSrc).toMatch(
      /lockBoardScrollHorizontal:\s*function\s*\(\s*durationMs\s*,\s*targetLeft\s*\)\s*\{\s*return\s+lockBoardScrollHorizontal\(\s*durationMs\s*,\s*targetLeft\s*\)\s*;?\s*\}/
    );
  });

  it('inlineCardEditor opens with preventScroll on textarea.focus + captures pre-edit scrollLeft', () => {
    // preventScroll keeps the browser from shifting scrollLeft
    // when the textarea grabs focus on edit-open.
    expect(inlineCardEditorSrc).toMatch(
      /textarea\.focus\(\s*\{\s*preventScroll:\s*true\s*\}\s*\)/
    );
    // The editor record stashes pre-edit scrollLeft so the close
    // path can restore it via the latch.
    expect(inlineCardEditorSrc).toMatch(/preEditScrollLeft\s*:\s*preEditScrollLeft/);
    expect(inlineCardEditorSrc).toMatch(
      /preCc\.scrollLeft|getElColumnsContainer\(\)/
    );
  });

  it('inlineCardEditor close paths pass preEditScrollLeft through to the latch', () => {
    // Save path: passes via options.preEditScrollLeft to saveCardEdit.
    expect(inlineCardEditorSrc).toMatch(
      /preEditScrollLeft:\s*editor\.preEditScrollLeft/
    );
    // Cancel path: passes directly as the latch's targetLeft arg.
    expect(inlineCardEditorSrc).toMatch(
      /lockBoardScrollHorizontal\(\s*400\s*,\s*editor\.preEditScrollLeft\s*\)/
    );
  });

  it('saveCardEdit forwards options.preEditScrollLeft to the latch as targetLeft', () => {
    expect(cardEditorSrc).toMatch(
      /async\s+function\s+saveCardEdit\s*\([^)]*,\s*options\s*\)/
    );
    const saveBlock = cardEditorSrc.match(
      /async\s+function\s+saveCardEdit[\s\S]{0,3500}?^\s{2}\}/m
    );
    expect(saveBlock).toBeTruthy();
    expect(saveBlock[0]).toMatch(/options\.preEditScrollLeft/);
    expect(saveBlock[0]).toMatch(
      /_deps\.lockBoardScrollHorizontal\(\s*400\s*,\s*targetLeft\s*\)/
    );
  });

  it('the latch auto-cancels on user-input events (wheel / touchstart / pointerdown / keydown)', () => {
    // Fighting a user who scrolls right after exiting an edit would
    // be worse than the original bug. Any of these events on the
    // container detaches the latch immediately. Listed explicitly so
    // a future contributor can't quietly drop one.
    const fnBlock = appSrc.match(
      /function\s+lockBoardScrollHorizontal[\s\S]{0,3500}?^\s{2}\}/m
    );
    expect(fnBlock).toBeTruthy();
    const required = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    for (const evt of required) {
      expect(
        fnBlock[0].includes(`'${evt}'`) || fnBlock[0].includes(`"${evt}"`),
        `latch must register ${evt} as a user-input cancel trigger`
      ).toBe(true);
    }
    // The cancel-handler must call detach (the listener-cleanup fn).
    expect(fnBlock[0]).toMatch(/function\s+onUserInput\(\)\s*\{\s*detach\(\)/);
  });
});
