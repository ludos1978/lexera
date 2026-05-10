// Kanban-side cross-view drag source broadcast contract (Stage 17a).
//
// User report 2026-05-10: "dragging from kanban to workspace isnt
// working". Pointer / mouse events do NOT cross Tauri WKWebView
// boundaries. The kanban's existing tryExternalNativeHover/Drop in
// dragDropHandlers.js (defined but never called for native
// webviews — LexeraMultiviewWebview.getWebviewLabelAtTopPoint is
// shell-only and returns null in embedded kanbans) means kanban →
// other-webview drag has never worked in embedded mode.
//
// Stage 17a (this test) wires the SOURCE side: kanban broadcasts
// hierarchy-entity-drag-start so destinations can arm per-webview
// trackers. Stage 17b will add the destination tracker in
// hierarchy.js / workspaces.js.
//
// Source-level (regex) test pinning the wiring exists.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const dragDropHandlersSrc = readFileSync(
  resolve(repoRoot, 'src', 'dragdrop', 'dragDropHandlers.js'), 'utf8'
);
const dndListenersSrc = readFileSync(
  resolve(repoRoot, 'src', 'dragdrop', 'dndListeners.js'), 'utf8'
);
const embeddedBoardBridgeSrc = readFileSync(
  resolve(repoRoot, 'src', 'shell', 'bridges', 'embeddedBoardBridge.js'), 'utf8'
);
const appSrc = readFileSync(resolve(repoRoot, 'src', 'app.js'), 'utf8');

describe('kanban cross-view drag source broadcast (Stage 17a)', () => {
  describe('dragDropHandlers.js — broadcastCrossViewDragStart', () => {
    it('defines broadcastCrossViewDragStart and exports it on the public API', () => {
      expect(dragDropHandlersSrc).toMatch(/function\s+broadcastCrossViewDragStart\s*\(\s*\)/);
      expect(dragDropHandlersSrc).toMatch(/broadcastCrossViewDragStart\s*:\s*broadcastCrossViewDragStart/);
    });

    it('helper guards on window.LexeraMultiview availability (degrades gracefully outside Tauri)', () => {
      const idx = dragDropHandlersSrc.search(/function\s+broadcastCrossViewDragStart\s*\(\s*\)/);
      const tail = dragDropHandlersSrc.slice(idx, idx + 2500);
      expect(tail).toMatch(/window\.LexeraMultiview/);
      expect(tail).toMatch(/typeof\s+window\.LexeraMultiview\.invoke\s*===\s*['"]function['"]/);
    });

    it('helper builds a workspace-shape payload { boardId, kind, entityId } for cardDrag and ptrDrag', () => {
      const idx = dragDropHandlersSrc.search(/function\s+broadcastCrossViewDragStart\s*\(\s*\)/);
      const tail = dragDropHandlersSrc.slice(idx, idx + 2500);
      // cardDrag → kind: 'card' + entityId from cardDrag.cardId.
      expect(tail).toMatch(/cardDrag[\s\S]{0,200}kind\s*:\s*['"]card['"]/);
      expect(tail).toMatch(/entityId\s*:\s*cardDrag\.cardId/);
      // ptrDrag → typeToKind table maps drag types ('tree-card', 'tree-column',
      // 'tree-stack', 'tree-row', 'board-row', 'board-stack', 'column') to
      // workspace kinds.
      expect(tail).toMatch(/['"]tree-card['"]\s*:\s*['"]card['"]/);
      expect(tail).toMatch(/['"]tree-column['"]/);
      expect(tail).toMatch(/['"]tree-stack['"]/);
      expect(tail).toMatch(/['"]tree-row['"]/);
      expect(tail).toMatch(/['"]board-row['"]/);
      expect(tail).toMatch(/['"]board-stack['"]/);
    });

    it('helper attaches sourceWebviewLabel for embeddedBoardBridge self-skip', () => {
      // The label is what lets the source kanban skip its OWN broadcast
      // (avoids double-application via its own embeddedBoardBridge tracker).
      const idx = dragDropHandlersSrc.search(/function\s+broadcastCrossViewDragStart\s*\(\s*\)/);
      const tail = dragDropHandlersSrc.slice(idx, idx + 2500);
      expect(tail).toMatch(/getCurrentWebview/);
      expect(tail).toMatch(/sourceWebviewLabel/);
    });

    it('helper invokes multiview_broadcast with event=hierarchy-entity-drag-start', () => {
      const idx = dragDropHandlersSrc.search(/function\s+broadcastCrossViewDragStart\s*\(\s*\)/);
      const tail = dragDropHandlersSrc.slice(idx, idx + 2500);
      expect(tail).toMatch(/multiview_broadcast/);
      expect(tail).toMatch(/event\s*:\s*['"]hierarchy-entity-drag-start['"]/);
    });

    it('startCardDrag invokes broadcastCrossViewDragStart after startCrossViewBridge', () => {
      // Hook is right after the existing iframe bridge starts so the
      // kanban-internal drag setup is unchanged.
      const idx = dragDropHandlersSrc.search(/function\s+startCardDrag\s*\(/);
      expect(idx).toBeGreaterThan(-1);
      const tail = dragDropHandlersSrc.slice(idx, idx + 800);
      expect(tail).toMatch(/startCrossViewBridge\(\s*['"]card['"][\s\S]{0,200}broadcastCrossViewDragStart\(/);
    });
  });

  describe('dragDropHandlers.js — cleanupAllDrag', () => {
    it('defines cleanupAllDrag and exports it', () => {
      expect(dragDropHandlersSrc).toMatch(/function\s+cleanupAllDrag\s*\(\s*\)/);
      expect(dragDropHandlersSrc).toMatch(/cleanupAllDrag\s*:\s*cleanupAllDrag/);
    });

    it('cleanupAllDrag null-checks cardDrag and ptrDrag before calling cleanups', () => {
      // No-op when no drag is in flight — safe to call from cross-view
      // drag-handled echo regardless of state.
      const idx = dragDropHandlersSrc.search(/function\s+cleanupAllDrag\s*\(/);
      const tail = dragDropHandlersSrc.slice(idx, idx + 400);
      expect(tail).toMatch(/if\s*\(\s*cardDrag\s*\)\s*cleanupCardDrag\(/);
      expect(tail).toMatch(/if\s*\(\s*ptrDrag\s*\)\s*cleanupPtrDrag\(/);
    });
  });

  describe('dndListeners.js — ptr drag broadcast hook', () => {
    it('every _deps.startCrossViewBridge(\'ptr\') call is followed by _deps.broadcastCrossViewDragStart()', () => {
      // 5 separate ptrDrag entry points (line ~137, 156, 404, 445, 462,
      // 588 in current source). All must broadcast.
      const startCalls = dndListenersSrc.match(/_deps\.startCrossViewBridge\(\s*['"]ptr['"]/g);
      expect(startCalls, 'must have multiple ptr drag entry points').not.toBeNull();
      expect(startCalls.length).toBeGreaterThanOrEqual(5);
      // Each entry point's surrounding code must guard on the function's
      // availability (graceful degradation pre-Stage-17a deps).
      const broadcastCalls = dndListenersSrc.match(/_deps\.broadcastCrossViewDragStart/g);
      expect(broadcastCalls, 'must call _deps.broadcastCrossViewDragStart').not.toBeNull();
      // Same count — every ptr-bridge-start has a paired broadcast.
      expect(broadcastCalls.length).toBeGreaterThanOrEqual(startCalls.length);
    });
  });

  describe('app.js — DndListeners.init dep wiring', () => {
    it('passes broadcastCrossViewDragStart through to the dndListeners deps', () => {
      // Without this dep, dndListeners' broadcast call falls through to
      // the typeof guard and the broadcast never fires.
      const block = appSrc.match(/DndListeners\.init\(\{[\s\S]{0,4000}?\}\)/);
      expect(block, 'DndListeners.init dep block must exist').not.toBeNull();
      expect(block[0]).toMatch(/broadcastCrossViewDragStart/);
      expect(block[0]).toMatch(/DragDropHandlers\.broadcastCrossViewDragStart/);
    });
  });

  describe('embeddedBoardBridge.js — self-skip + echo cleanup', () => {
    it('hierarchy-entity-drag-start handler skips when payload.sourceWebviewLabel === wv.label', () => {
      // Without this guard the source kanban arms a tracker against
      // its OWN drag and double-applies on local pointerup.
      const idx = embeddedBoardBridgeSrc.search(/wv\.listen\(\s*['"]hierarchy-entity-drag-start['"]/);
      expect(idx).toBeGreaterThan(-1);
      const tail = embeddedBoardBridgeSrc.slice(idx, idx + 1500);
      expect(tail).toMatch(/src\.sourceWebviewLabel\s*&&\s*wv\.label\s*&&\s*src\.sourceWebviewLabel\s*===\s*wv\.label/);
    });

    it('cross-view-drag-handled handler calls LexeraDragDropHandlers.cleanupAllDrag', () => {
      // When THIS webview is the source kanban, its own mouseup never
      // fires (cursor released over a different webview). The echo is
      // the only cleanup signal.
      const idx = embeddedBoardBridgeSrc.search(/wv\.listen\(\s*['"]cross-view-drag-handled['"]/);
      expect(idx).toBeGreaterThan(-1);
      const tail = embeddedBoardBridgeSrc.slice(idx, idx + 1500);
      expect(tail).toMatch(/LexeraDragDropHandlers[\s\S]{0,300}cleanupAllDrag/);
    });
  });
});
