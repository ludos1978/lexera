// Cold-pane cross-view DnD contract.
//
// User report 2026-05-11: first drag from one kanban/workspace view
// into another visible kanban pane does not drop; the second drag
// works. The first attempt was being consumed by lazy child-webview
// startup. Drag-start must warm visible board panes immediately, and
// embedded boards must buffer routed DnD events briefly while their
// kanban DnD API is still registering.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function read(rel) {
  return readFileSync(resolve(repoRoot, 'src', rel), 'utf8');
}

describe('cross-view DnD cold-pane startup', () => {
  const workspaceShell = read('workspace/workspaceShell.js');
  const hierarchyDragBridge = read('shell/bridges/hierarchyDragBridge.js');
  const embeddedBoardBridge = read('shell/bridges/embeddedBoardBridge.js');

  it('workspace shell exposes a visible-board-frame warmer that forces active panes through multiview.ensure', () => {
    expect(workspaceShell).toMatch(/function\s+ensureVisibleBoardFramesLoaded\s*\(/);
    expect(workspaceShell).toMatch(/ensureVisibleBoardFramesLoaded\s*:\s*ensureVisibleBoardFramesLoaded/);
    expect(workspaceShell).toMatch(/function\s+forceLoadBoardFrame\s*\(/);
    expect(workspaceShell).toMatch(/multiview\.ensure\(tab,\s*view,\s*desiredSrc\)/);
    expect(workspaceShell).toMatch(/allTreeIds\(\)/);
    expect(workspaceShell).toMatch(/visitTree\(root/);
    expect(workspaceShell).toMatch(/state\.deferredBoardLoadQueue\s*=\s*state\.deferredBoardLoadQueue\.filter/);
  });

  it('shell hierarchy bridge receives drag-start and asks the workspace shell to warm visible boards', () => {
    const subscribeIdx = hierarchyDragBridge.search(/multiview_subscribe/);
    expect(subscribeIdx).toBeGreaterThan(-1);
    const subscribeTail = hierarchyDragBridge.slice(subscribeIdx, subscribeIdx + 900);
    expect(subscribeTail).toMatch(/['"]hierarchy-entity-drag-start['"]/);

    const listenIdx = hierarchyDragBridge.search(/wv\.listen\(\s*['"]hierarchy-entity-drag-start['"]/);
    expect(listenIdx).toBeGreaterThan(-1);
    const listenTail = hierarchyDragBridge.slice(listenIdx, listenIdx + 900);
    expect(listenTail).toMatch(/LexeraWorkspaceShell/);
    expect(listenTail).toMatch(/ensureVisibleBoardFramesLoaded\(\s*['"]xview-drag-start['"]\s*\)/);
  });

  it('embedded kanban receivers queue early routed DnD until __lexeraExternalDnd is ready', () => {
    expect(embeddedBoardBridge).toMatch(/function\s+queueExternalDndUntilHandlerReady\s*\(/);
    expect(embeddedBoardBridge).toMatch(/function\s+flushPendingExternalDnd\s*\(/);
    expect(embeddedBoardBridge).toMatch(/PENDING_EXTERNAL_DND_MAX_MS/);
    expect(embeddedBoardBridge).toMatch(/receive\.queue\(no-handler\)/);
    expect(embeddedBoardBridge).toMatch(/receive\.queue\.flush/);
    expect(embeddedBoardBridge).toMatch(/relayExternalDnd\(queued\[qi\]\.method,\s*queued\[qi\]\.event,\s*\{\s*noQueue:\s*true\s*\}\)/);
  });

  it('embedded kanban drop handling retries while the board drop surface is still booting', () => {
    expect(embeddedBoardBridge).toMatch(/function\s+handleExternalDndDrop\s*\(/);
    expect(embeddedBoardBridge).toMatch(/function\s+isKanbanDropSurfaceBootingForSource\s*\(/);
    expect(embeddedBoardBridge).toMatch(/EXTERNAL_DROP_MAX_RETRIES/);
    expect(embeddedBoardBridge).toMatch(/receive\.drop\.retry\(waiting-for-surface\)/);
    expect(embeddedBoardBridge).toMatch(/setTimeout\([\s\S]{0,160}handleExternalDndDrop\(event,\s*attempt\s*\+\s*1\)/);
  });

  it('boot-state heuristic covers all four drag kinds (card / column / stack / row)', () => {
    // User TODO line 38: "Fix any remaining first-drag failure where a
    // cold destination board loads first and only the second drag
    // succeeds". The boot-state heuristic previously early-returned
    // `false` for kind === 'row', so row-drags bypassed the retry
    // path entirely and a row dropped on a cold pane was lost on the
    // first attempt every time. Each branch must check that the DOM
    // structure the source needs to land on is present; missing → retry.
    expect(embeddedBoardBridge).toMatch(
      /kind\s*!==\s*['"]card['"]\s*&&\s*kind\s*!==\s*['"]column['"]\s*&&\s*kind\s*!==\s*['"]stack['"]\s*&&\s*kind\s*!==\s*['"]row['"]/
    );
    // Row branch checks for a `.board-row[data-row-id]` element — the
    // minimum signal that the destination's board data has rendered.
    expect(embeddedBoardBridge).toMatch(
      /if\s*\(kind\s*===\s*['"]row['"]\)\s*\{[\s\S]{0,400}\.board-row\[data-row-id\]/
    );
  });
});
