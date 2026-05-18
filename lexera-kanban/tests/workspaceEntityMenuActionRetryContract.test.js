// Workspace tree burger-menu action → kanban dispatch retry contract.
//
// User report 2026-05-18: "the burger menu functions in the workspace
// dont work properly! for example insert stack before isnt working!"
//
// Root cause: workspaces.js `runEntityAction` fires
// `focus-hierarchy-target` (an ASYNC board switch + render) and then
// SYNCHRONOUSLY broadcasts `hierarchy-entity-menu-action`. The kanban
// frame's `lexera-hierarchy-entity-menu-action` handler used to bail
// PERMANENTLY when (a) the target board wasn't active yet, or (b)
// findBoardEntityElement returned null because the entity DOM hadn't
// rendered yet. For a cross-board action both are true on arrival, so
// the action was silently dropped.
//
// Fix mirrors the proven `focusHierarchyTargetLocally` bounded-retry
// (~30 × 100ms ≈ 3s): re-check the active board AND re-resolve the
// entity element each tick; warn-log only once retries exhaust.
//
// Source-level (regex) test pinning the retry so the permanent-bail
// regression can't return.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8');

// Isolate the message handler body so assertions can't accidentally
// match an unrelated part of app.js.
const handlerMatch = appSrc.match(
  /data\.type\s*!==\s*['"]lexera-hierarchy-entity-menu-action['"][\s\S]{0,6000}?attemptHierarchyEntityMenuAction\(\s*30\s*\)\s*;/
);

describe('workspace entity menu action survives the async board-switch race', () => {
  it('wraps resolution+dispatch in a bounded retry kicked off with 30 attempts', () => {
    expect(handlerMatch, 'menu-action handler block must be present').not.toBeNull();
    expect(appSrc).toMatch(
      /var\s+attemptHierarchyEntityMenuAction\s*=\s*function\s*\(\s*attemptsLeft\s*\)/
    );
    expect(appSrc).toMatch(/attemptHierarchyEntityMenuAction\(\s*30\s*\)\s*;/);
  });

  it('no longer permanently bails on a board mismatch (the regression)', () => {
    // The exact old line that dropped every cross-board action.
    expect(appSrc).not.toMatch(
      /if\s*\(\s*data\.boardId\s*&&\s*data\.boardId\s*!==\s*activeBoardId\s*\)\s*return\s*;/
    );
  });

  it('retries (not bare-returns) when the board is not active yet', () => {
    const body = handlerMatch ? handlerMatch[0] : '';
    expect(body).toMatch(
      /data\.boardId\s*&&\s*data\.boardId\s*!==\s*activeBoardId[\s\S]{0,200}attemptsLeft\s*>\s*0[\s\S]{0,160}setTimeout\([\s\S]{0,120}attemptHierarchyEntityMenuAction\(\s*attemptsLeft\s*-\s*1\s*\)[\s\S]{0,40}100\s*\)/
    );
  });

  it('retries when the entity element is not rendered yet', () => {
    const body = handlerMatch ? handlerMatch[0] : '';
    expect(body).toMatch(
      /if\s*\(\s*!el\s*\)\s*\{[\s\S]{0,160}attemptsLeft\s*>\s*0[\s\S]{0,160}setTimeout\([\s\S]{0,120}attemptHierarchyEntityMenuAction\(\s*attemptsLeft\s*-\s*1\s*\)[\s\S]{0,40}100\s*\)/
    );
  });

  it('still dispatches through ActionRegistry on the first successful attempt', () => {
    const body = handlerMatch ? handlerMatch[0] : '';
    expect(body).toMatch(
      /ActionRegistry\.dispatch\(\s*data\.kind\s*,\s*data\.action\s*,\s*ctx\s*\)/
    );
  });

  it('warn-logs only after retries are exhausted, with distinct board vs lookup reasons', () => {
    const body = handlerMatch ? handlerMatch[0] : '';
    expect(body).toMatch(/hierarchy-entity-menu-action\.board/);
    expect(body).toMatch(/hierarchy-entity-menu-action\.lookup/);
  });
});
