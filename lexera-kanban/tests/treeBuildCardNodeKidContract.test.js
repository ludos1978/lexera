// Workspace/hierarchy tree builder — `buildCardNode` must prefer
// `card.kid` over `card.id` so the data-tree-id surfaced in the tree
// DOM is the persistent 8-char hex, not a Loro CRDT container id.
//
// Why: Loro container ids regenerate when a board's CRDT state is
// re-instantiated by a separate `getBoardColumns` call (the path
// shell-side hierarchyDragBridge follows on cross-board drops), so
// the workspace tree's captured id can drift from the freshly-loaded
// snapshot's id even though they describe the same card. The kid is
// stable across those reloads.
//
// The destination side (locateEntity in shell hierarchyDragBridge)
// already accepts either id or kid (Stage 7 — commit 9ec8cb82); this
// pins the source side so the tree always emits the stable form
// when a kid is available.
//
// Reported 2026-05-10: `srcLocated: false` for cross-board drops
// where the workspace tree had captured a Loro id that no longer
// matched the freshly-loaded srcBoard.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '..', 'src');

function read(rel) {
  return readFileSync(resolve(srcRoot, rel), 'utf8');
}

describe('tree buildCardNode kid-preferred contract', () => {
  const hierarchySrc = read('views/hierarchy/hierarchy.js');
  const workspacesSrc = read('views/workspaces/workspaces.js');

  it('hierarchy view buildCardNode prefers card.kid over card.id', () => {
    expect(hierarchySrc).toMatch(/function\s+buildCardNode\s*\(/);
    // Match the full body so we don't accidentally pass on a
    // stray `card.id` in another helper.
    const body = hierarchySrc.match(
      /function\s+buildCardNode[\s\S]{0,1500}?\}\s*\n/m
    );
    expect(body).toBeTruthy();
    expect(body[0]).toMatch(/id\s*:\s*\(\s*card\.kid\s*\|\|\s*card\.id\s*\)/);
  });

  it('workspaces view buildCardNode prefers card.kid over card.id', () => {
    expect(workspacesSrc).toMatch(/function\s+buildCardNode\s*\(/);
    const body = workspacesSrc.match(
      /function\s+buildCardNode[\s\S]{0,1500}?\}\s*\n/m
    );
    expect(body).toBeTruthy();
    expect(body[0]).toMatch(/id\s*:\s*\(\s*card\.kid\s*\|\|\s*card\.id\s*\)/);
  });

  it('embeddedBoardBridge readCardId fallback prefers data-card-kid', () => {
    // Mirror on the kanban-side hover-routing: the cursor-hit DOM
    // element's `data-card-kid` is preferred over `data-card-id`
    // when emitting the resolved drop target's `entityId`. Without
    // this the kanban routes drops by Loro id, which the
    // freshly-loaded source board may no longer carry.
    const bridgeSrc = read('shell/bridges/embeddedBoardBridge.js');
    expect(bridgeSrc).toMatch(/function\s+readCardId\s*\(\s*el\s*\)/);
    const body = bridgeSrc.match(
      /function\s+readCardId[\s\S]{0,800}?\}\s*\n/m
    );
    expect(body).toBeTruthy();
    expect(body[0]).toMatch(/getAttribute\(\s*['"]data-card-kid['"]\s*\)/);
    expect(body[0]).toMatch(/getAttribute\(\s*['"]data-card-id['"]\s*\)/);
    // kid must be checked before id (preferred form).
    const kidIdx = body[0].indexOf('data-card-kid');
    const idIdx = body[0].indexOf('data-card-id');
    expect(kidIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeGreaterThan(kidIdx);
  });
});
