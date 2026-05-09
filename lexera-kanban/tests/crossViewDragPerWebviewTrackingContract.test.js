// Per-webview cross-view-drag tracking contract.
//
// Pointer / mouse events do NOT cross separate Tauri WKWebView
// boundaries — when the user drags from a sub-app webview into a
// kanban-view webview, the source's own pointermove stops firing
// the moment the cursor crosses out of the source's bounds. The
// shell-side `hierarchyDragBridge` chain (source.broadcast →
// shell.forward → destination.receive) only fires when the source's
// pointermove is alive, so without per-webview tracking the
// destination kanban view never gets `external-dnd-hover` events.
//
// User report 2026-05-09: "still doesnt allow dragging to the
// kanban view from the workspace view!!!". Fix (commits TBD): each
// receiver webview tracks its OWN pointermove / pointerup while a
// drag is in flight, and routes local (clientX, clientY) straight
// into `__lexeraExternalDnd.hover/drop`.
//
// This contract test is source-level (regex) so it doesn't depend
// on a multi-webview Tauri runtime — what we pin is "the bridge
// subscribes to the right events AND wires the right callbacks",
// which is what makes the runtime behavior correct.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const embeddedBoardBridge = readFileSync(
  resolve(repoRoot, 'src', 'shell', 'bridges', 'embeddedBoardBridge.js'), 'utf8'
);
const hierarchySrc = readFileSync(
  resolve(repoRoot, 'src', 'views', 'hierarchy', 'hierarchy.js'), 'utf8'
);
const workspacesSrc = readFileSync(
  resolve(repoRoot, 'src', 'views', 'workspaces', 'workspaces.js'), 'utf8'
);

describe('per-webview cross-view-drag tracking', () => {
  describe('embeddedBoardBridge.js (destination side)', () => {
    it('subscribes to hierarchy-entity-drag-start and cross-view-drag-handled in the multiview_subscribe events list', () => {
      // The events array MUST include both names so the receiver
      // webview is wired before the source broadcasts drag-start.
      const subscribeBlock = embeddedBoardBridge.match(
        /multiview_subscribe[\s\S]{0,400}events:\s*\[([\s\S]*?)\]/
      );
      expect(subscribeBlock, 'multiview_subscribe events array must exist').not.toBeNull();
      const events = subscribeBlock[1];
      expect(events).toMatch(/['"]hierarchy-entity-drag-start['"]/);
      expect(events).toMatch(/['"]cross-view-drag-handled['"]/);
    });

    it('arms a local pointermove tracker on hierarchy-entity-drag-start that routes through window.__lexeraExternalDnd.hover', () => {
      // The drag-start listener exists.
      const startIdx = embeddedBoardBridge.search(
        /wv\.listen\(\s*['"]hierarchy-entity-drag-start['"]/
      );
      expect(startIdx, 'drag-start listener must exist').toBeGreaterThan(-1);
      // The pointer listeners and the hover() routing live AFTER the
      // drag-start listener registration in the same module.
      const tail = embeddedBoardBridge.slice(startIdx);
      expect(tail).toMatch(/document\.addEventListener\(\s*['"]pointermove['"]/);
      expect(tail).toMatch(/document\.addEventListener\(\s*['"]pointerup['"]/);
      expect(tail).toMatch(/document\.addEventListener\(\s*['"]pointercancel['"]/);
      // The pointermove handler routes to __lexeraExternalDnd.hover
      // with the local (clientX, clientY) — that's the whole point.
      expect(tail).toMatch(/__lexeraExternalDnd[\s\S]{0,400}hover/);
    });

    it('translates source.kind into the type string __lexeraExternalDnd expects (tree-row / tree-stack / tree-column / tree-card)', () => {
      // Mirror of hierarchyDragBridge.js:415 KIND_TO_TYPE table; if
      // these drift the receiver's hover() call gets the wrong type
      // and silently falls through.
      expect(embeddedBoardBridge).toMatch(/row:\s*['"]tree-row['"]/);
      expect(embeddedBoardBridge).toMatch(/stack:\s*['"]tree-stack['"]/);
      expect(embeddedBoardBridge).toMatch(/column:\s*['"]tree-column['"]/);
      expect(embeddedBoardBridge).toMatch(/card:\s*['"]tree-card['"]/);
    });

    it('on local pointerup: resolves a tree-target + broadcasts hierarchy-entity-drop AND cross-view-drag-handled', () => {
      // The destination MUST NOT call `__lexeraExternalDnd.drop` —
      // that path mutates the local kanban's board data, which is
      // wrong for cross-board moves (the source entity still lives
      // in source.boardId; only the shell can load both boards and
      // apply atomically). User report 2026-05-09: "doesnt work".
      // Fix: resolve a tree-shaped target from the destination's DOM
      // and broadcast `hierarchy-entity-drop` so
      // hierarchyDragBridge.applyDrop on the shell side handles the
      // four-helper dispatch (same/cross-board × same/cross-kind).
      expect(embeddedBoardBridge).toMatch(/function\s+resolveCrossViewTreeTarget\s*\(/);
      // Tree-target resolution reads canonical kanban DOM data
      // attributes — card / column / stack / row IDs.
      expect(embeddedBoardBridge).toMatch(/['"]\.card\[data-card-id\]['"]/);
      expect(embeddedBoardBridge).toMatch(/['"]\.column\[data-column-id\]['"]/);
      expect(embeddedBoardBridge).toMatch(/['"]\.board-stack\[data-stack-id\]['"]/);
      expect(embeddedBoardBridge).toMatch(/['"]\.board-row\[data-row-id\]['"]/);
      // Active board id for the destination is read off
      // window.LexeraDashboard so the tree-target carries boardId.
      expect(embeddedBoardBridge).toMatch(/LexeraDashboard[\s\S]{0,80}getActiveBoardId/);
      // Cards carry `position: 'before' | 'after'` for sibling
      // reorder; the column / stack / row branches do NOT set
      // position (cross-kind absorb appends to children).
      expect(embeddedBoardBridge).toMatch(
        /closest\(\s*['"]\.card\[data-card-id\]['"][\s\S]{0,400}position/
      );
      // The pointerup handler broadcasts BOTH the persistence event
      // (hierarchy-entity-drop) AND the cleanup echo
      // (cross-view-drag-handled). Persistence broadcast comes
      // FIRST so the shell applies before sibling webviews tear down.
      const dropBroadcast = embeddedBoardBridge.search(/['"]hierarchy-entity-drop['"]/);
      const handledBroadcast = embeddedBoardBridge.indexOf(
        "'cross-view-drag-handled'", dropBroadcast > -1 ? dropBroadcast : 0
      );
      expect(dropBroadcast, 'hierarchy-entity-drop broadcast must exist').toBeGreaterThan(-1);
      expect(handledBroadcast, 'cross-view-drag-handled echo must exist after the drop broadcast').toBeGreaterThan(dropBroadcast);
    });

    it('listens for cross-view-drag-handled to tear down its own tracker (sibling-webview echo)', () => {
      // When ANY destination handles a drop, EVERY other webview
      // tears down its own tracker. Without this, stale __lexeraExternalDnd
      // indicators survive in sibling kanbans.
      expect(embeddedBoardBridge).toMatch(
        /wv\.listen\(\s*['"]cross-view-drag-handled['"]\s*,/
      );
    });

    it('sets a 30s safety-timeout teardown so a missed pointerup doesn\'t leak handlers', () => {
      expect(embeddedBoardBridge).toMatch(/setTimeout\([\s\S]{0,200}30000/);
    });
  });

  describe('hierarchy.js / workspaces.js (source side cleanup)', () => {
    it('hierarchy.js handles cross-view-drag-handled to call its endDrag — source pointerup never fires for cross-webview drops', () => {
      // The source webview's own pointerup never fires when the
      // user releases over a destination webview, so the dashed
      // outline + activeDrag state would persist forever without
      // this echo.
      expect(hierarchySrc).toMatch(
        /['"]cross-view-drag-handled['"][\s\S]{0,200}_hierarchyEndDrag/
      );
    });

    it('workspaces.js handles cross-view-drag-handled to call its endDrag', () => {
      expect(workspacesSrc).toMatch(
        /['"]cross-view-drag-handled['"][\s\S]{0,200}_workspacesEndDrag/
      );
    });
  });
});
