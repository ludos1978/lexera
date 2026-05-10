// Workspace tree per-webview pointer tracker contract (Stage 17b).
//
// User report 2026-05-10: "dragging from kanban to workspace doesnt
// work at all (no cross window drag indicator, no highlight, etc)".
//
// Stage 17a wired the SOURCE side: kanban now broadcasts
// `hierarchy-entity-drag-start`. Stage 17b (this test) wires the
// DESTINATION side: workspace tree sub-apps (hierarchy.js,
// workspaces.js) install document-level pointer listeners on
// receipt, drive `_hierarchyOnExternalDnd` / `_workspacesOnExternalDnd`
// with LOCAL pointer coords on pointermove, and broadcast
// `hierarchy-entity-drop` on pointerup.
//
// Source-level (regex) test pinning the wiring exists.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const hierarchySrc = readFileSync(
  resolve(repoRoot, 'src', 'views', 'hierarchy', 'hierarchy.js'), 'utf8'
);
const workspacesSrc = readFileSync(
  resolve(repoRoot, 'src', 'views', 'workspaces', 'workspaces.js'), 'utf8'
);

function pinTracker(label, src, prefix, externalDndVar) {
  describe(label, () => {
    it('declares the arm + teardown tracker hooks at module scope so onCustom can call them', () => {
      // Module-scoped vars (set inside the drag-bound block) so the
      // LexeraSubApp.init onCustom callbacks can reach them.
      expect(src).toMatch(new RegExp(`var\\s+_${prefix}ArmCrossDragTracker\\s*=\\s*null`));
      expect(src).toMatch(new RegExp(`var\\s+_${prefix}TeardownCrossDragTracker\\s*=\\s*null`));
    });

    it('arm function self-skips when sourceWebviewLabel === own label', () => {
      // Otherwise the workspace's own drag (which broadcasts
      // hierarchy-entity-drag-start) would arm against itself and
      // double-track. Mirror of embeddedBoardBridge's self-skip.
      const armIdx = src.search(new RegExp(`_${prefix}ArmCrossDragTracker\\s*=\\s*function`));
      expect(armIdx, 'arm function definition must exist').toBeGreaterThan(-1);
      const tail = src.slice(armIdx, armIdx + 3000);
      expect(tail).toMatch(/sourceWebviewLabel\s*&&\s*ownLabel\s*&&\s*src\.sourceWebviewLabel\s*===\s*ownLabel/);
    });

    it('arm function maps source.kind → KIND_TO_TYPE for the destination handler', () => {
      // The handler expects `payload.payload.type` to be one of
      // 'tree-card' / 'tree-column' / 'tree-stack' / 'tree-row'.
      const armIdx = src.search(new RegExp(`_${prefix}ArmCrossDragTracker\\s*=\\s*function`));
      const tail = src.slice(armIdx, armIdx + 3000);
      expect(tail).toMatch(/KIND_TO_TYPE/);
      expect(tail).toMatch(/row\s*:\s*['"]tree-row['"]/);
      expect(tail).toMatch(/card\s*:\s*['"]tree-card['"]/);
    });

    it('arm function installs document pointermove + pointerup + pointercancel listeners', () => {
      const armIdx = src.search(new RegExp(`_${prefix}ArmCrossDragTracker\\s*=\\s*function`));
      const tail = src.slice(armIdx, armIdx + 3000);
      expect(tail).toMatch(/document\.addEventListener\(\s*['"]pointermove['"]/);
      expect(tail).toMatch(/document\.addEventListener\(\s*['"]pointerup['"]/);
      expect(tail).toMatch(/document\.addEventListener\(\s*['"]pointercancel['"]/);
    });

    it('move handler routes through the existing _OnExternalDnd handler with hover + local x/y', () => {
      // The existing Stage-14 handler already maps the kanban payload
      // shape and paints the indicator — the tracker just feeds it
      // local coords from THIS webview's pointer events.
      const armIdx = src.search(new RegExp(`_${prefix}ArmCrossDragTracker\\s*=\\s*function`));
      const tail = src.slice(armIdx, armIdx + 3000);
      expect(tail).toMatch(new RegExp(`${externalDndVar}\\(\\s*['"]hover['"]`));
      expect(tail).toMatch(/x\s*:\s*e\.clientX/);
      expect(tail).toMatch(/y\s*:\s*e\.clientY/);
    });

    it('up handler routes through the _OnExternalDnd drop path then teardown', () => {
      // The drop branch of _OnExternalDnd already broadcasts
      // hierarchy-entity-drop + cross-view-drag-handled (Stage 14).
      const armIdx = src.search(new RegExp(`_${prefix}ArmCrossDragTracker\\s*=\\s*function`));
      const tail = src.slice(armIdx, armIdx + 3000);
      expect(tail).toMatch(new RegExp(`${externalDndVar}\\(\\s*['"]drop['"]`));
    });

    it('30-second safety teardown installed (catches missed pointerup from window blur / OS gesture-loss)', () => {
      const armIdx = src.search(new RegExp(`_${prefix}ArmCrossDragTracker\\s*=\\s*function`));
      const tail = src.slice(armIdx, armIdx + 3000);
      expect(tail).toMatch(/setTimeout\([\s\S]{0,300}30000/);
    });

    it('teardown function removes all three pointer listeners + clears the safety timer + clears destination indicator', () => {
      const teardownIdx = src.search(new RegExp(`_${prefix}TeardownCrossDragTracker\\s*=\\s*function`));
      expect(teardownIdx, 'teardown function must exist').toBeGreaterThan(-1);
      const tail = src.slice(teardownIdx, teardownIdx + 1500);
      expect(tail).toMatch(/removeEventListener\(\s*['"]pointermove['"]/);
      expect(tail).toMatch(/removeEventListener\(\s*['"]pointerup['"]/);
      expect(tail).toMatch(/removeEventListener\(\s*['"]pointercancel['"]/);
      expect(tail).toMatch(/clearTimeout/);
      expect(tail).toMatch(new RegExp(`${externalDndVar}\\(\\s*['"]clear['"]`));
    });

    it("LexeraSubApp.init's onCustom subscribes to hierarchy-entity-drag-start and routes through the arm hook", () => {
      // Without subscription the wv.listen never registers; without
      // routing to the arm hook the tracker never gets installed.
      expect(src).toMatch(/['"]hierarchy-entity-drag-start['"]\s*:/);
      expect(src).toMatch(new RegExp(`_${prefix}ArmCrossDragTracker\\(`));
    });

    it("cross-view-drag-handled handler also tears down the destination tracker", () => {
      // The echo means SOMEONE handled the drop; we should release
      // any partially-armed tracker even if it wasn't us.
      const idx = src.search(/['"]cross-view-drag-handled['"]\s*:/);
      expect(idx).toBeGreaterThan(-1);
      const tail = src.slice(idx, idx + 1000);
      expect(tail).toMatch(new RegExp(`_${prefix}TeardownCrossDragTracker\\(`));
    });

    it('drag-start broadcast (source side) now includes sourceWebviewLabel for the self-skip', () => {
      // Without it, the workspace's own drag broadcast would arm a
      // tracker against itself.
      const idx = src.search(/broadcast\(\s*['"]hierarchy-entity-drag-start['"]/);
      expect(idx).toBeGreaterThan(-1);
      const tail = src.slice(Math.max(0, idx - 400), idx + 200);
      expect(tail).toMatch(/sourceWebviewLabel\s*:\s*getOwnWebviewLabel\(/);
    });
  });
}

describe('workspace tree per-webview cross-view drag tracker (Stage 17b)', () => {
  pinTracker('hierarchy.js', hierarchySrc, 'hierarchy', '_hierarchyOnExternalDnd');
  pinTracker('workspaces.js', workspacesSrc, 'workspaces', '_workspacesOnExternalDnd');
});
