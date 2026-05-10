// Destination kanban auto-reload on hierarchy-board-changed.
//
// User report 2026-05-10: "doesnt immediately drop, it only drops
// after i click on the target board again when drag & dropping from
// workspace to kanban!"
//
// Stage 13 made the apply path shell-only — `relayExternalDnd('drop')`
// is now skipped when a tree-target was resolved + broadcast. The
// shell's `hierarchyDragBridge` does the authoritative apply +
// saveBoard, then broadcasts `hierarchy-board-changed`. Before this
// fix, the destination kanban's in-memory board never refetched
// (embeddedBoardBridge didn't subscribe to that event), so the user
// had to click the tab to trigger a manual reload.
//
// Source-level (regex) test so it doesn't depend on a multi-webview
// Tauri runtime — what we pin is "the bridge subscribes + dispatches
// + app.js handles the message", which is what makes the runtime
// behavior correct.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const embeddedBoardBridge = readFileSync(
  resolve(repoRoot, 'src', 'shell', 'bridges', 'embeddedBoardBridge.js'), 'utf8'
);
const appSrc = readFileSync(
  resolve(repoRoot, 'src', 'app.js'), 'utf8'
);

describe('destination kanban reload on hierarchy-board-changed', () => {
  describe('embeddedBoardBridge.js', () => {
    it('multiview_subscribe events array includes hierarchy-board-changed', () => {
      const subscribeBlock = embeddedBoardBridge.match(
        /multiview_subscribe[\s\S]{0,1500}events:\s*\[([\s\S]*?)\]/
      );
      expect(subscribeBlock, 'multiview_subscribe events array must exist').not.toBeNull();
      expect(subscribeBlock[1]).toMatch(/['"]hierarchy-board-changed['"]/);
    });

    it("wv.listen('hierarchy-board-changed', ...) is registered", () => {
      expect(embeddedBoardBridge).toMatch(
        /wv\.listen\(\s*['"]hierarchy-board-changed['"]\s*,/
      );
    });

    it('the listener forwards as a `lexera-hierarchy-board-changed` message carrying the boardId', () => {
      // The bridge runs IN the kanban webview but the apply path
      // belongs to app.js — message dispatch is the existing
      // bridge→app.js bus (same shape as `lexera-layout-drag`,
      // `lexera-board-action`, etc).
      const idx = embeddedBoardBridge.search(/wv\.listen\(\s*['"]hierarchy-board-changed['"]/);
      expect(idx, 'listener must exist').toBeGreaterThan(-1);
      const tail = embeddedBoardBridge.slice(idx, idx + 800);
      expect(tail).toMatch(/dispatchAsMessage[\s\S]{0,200}lexera-hierarchy-board-changed/);
      expect(tail).toMatch(/boardId\s*:\s*p\.boardId/);
    });

    it('the dispatch is gated on payload.boardId (no boardId → no message)', () => {
      // Without the gate the bridge would emit a message with
      // boardId=undefined and the app.js handler would still skip,
      // but the message bus stays cleaner this way.
      const idx = embeddedBoardBridge.search(/wv\.listen\(\s*['"]hierarchy-board-changed['"]/);
      const tail = embeddedBoardBridge.slice(idx, idx + 800);
      expect(tail).toMatch(/if\s*\(\s*p\.boardId\s*\)/);
    });
  });

  describe('app.js (kanban side reload handler)', () => {
    it('window.addEventListener handler exists for lexera-hierarchy-board-changed', () => {
      // We add a SECOND addEventListener block (separate from the
      // existing lexera-layout-drag listener) so the two stay
      // independently testable.
      const block = appSrc.match(
        /addEventListener\(\s*['"]message['"]\s*,\s*function\s*\(\s*event\s*\)\s*\{[\s\S]{0,800}lexera-hierarchy-board-changed[\s\S]{0,800}\}\s*\)/
      );
      expect(block, 'lexera-hierarchy-board-changed message handler must exist').not.toBeNull();
    });

    it('handler skips when the changed boardId is not the active board', () => {
      // Reloading a non-active board would either no-op or worse
      // mutate the WRONG state, so the gate is critical.
      const idx = appSrc.search(/lexera-hierarchy-board-changed/);
      expect(idx, 'lexera-hierarchy-board-changed reference must exist').toBeGreaterThan(-1);
      const tail = appSrc.slice(idx, idx + 1200);
      expect(tail).toMatch(/data\.boardId\s*!==\s*activeBoardId/);
    });

    it('handler skips when the local board is dirty (preserves unsaved local edits)', () => {
      // If the user has pending edits, auto-reload would clobber
      // them. The existing SSE-fileChanged path uses the same
      // guard at app.js:2744 — same precedent.
      const idx = appSrc.search(/lexera-hierarchy-board-changed/);
      const tail = appSrc.slice(idx, idx + 1200);
      expect(tail).toMatch(/isBoardDirty\(\s*\)/);
    });

    it('handler skips when a save is in flight (avoids races with the kanban saveBoard pipeline)', () => {
      // Same precedent as the SSE-fileChanged path.
      const idx = appSrc.search(/lexera-hierarchy-board-changed/);
      const tail = appSrc.slice(idx, idx + 1200);
      expect(tail).toMatch(/BoardDataStore\.getSaveInFlight\(\s*\)/);
    });

    it('handler reloads via loadBoard(activeBoardId) — same call shape the SSE path uses', () => {
      const idx = appSrc.search(/lexera-hierarchy-board-changed/);
      const tail = appSrc.slice(idx, idx + 1200);
      expect(tail).toMatch(/loadBoard\(\s*activeBoardId\s*\)/);
    });

    it('handler routes errors through logFrontendIssue (in-app log panel surfaces failures)', () => {
      // Per the project's "log into the in-app logger view" rule —
      // never console.* / stderr.
      const idx = appSrc.search(/lexera-hierarchy-board-changed/);
      const tail = appSrc.slice(idx, idx + 1200);
      expect(tail).toMatch(/logFrontendIssue\(/);
    });
  });
});
