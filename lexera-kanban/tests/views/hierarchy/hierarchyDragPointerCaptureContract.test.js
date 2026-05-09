// Hierarchy / workspaces sub-app drag — pointer-capture contract.
//
// Cross-webview drag from the workspace tree → into a kanban view
// requires pointer events with setPointerCapture on the source
// tree-node. With bare mouse events, mousemove stops firing the
// moment the cursor crosses the source webview's bounds — so the
// `hierarchy-entity-drag-move` broadcast never fires, the shell
// never forwards `external-dnd-hover` to the destination kanban,
// and no drop preview / drop ever happens.
//
// The fix (2026-05-09) ports the pattern from tabDragController.js:
// listen for pointerdown / pointermove / pointerup, and call
// setPointerCapture(pointerId) on the source `.tree-node` so events
// keep flowing on the source even after the cursor crosses into a
// sibling Tauri webview.
//
// This contract test is source-level (regex over the JS files) so
// it doesn't depend on JSDOM's pointer-capture support — what we
// pin is "the drag handlers are wired to pointer events AND call
// setPointerCapture", which is what makes the runtime behavior
// correct.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const hierarchySrc = readFileSync(resolve(repoRoot, 'src', 'views', 'hierarchy', 'hierarchy.js'), 'utf8');
const workspacesSrc = readFileSync(resolve(repoRoot, 'src', 'views', 'workspaces', 'workspaces.js'), 'utf8');
const hierarchyCss = readFileSync(resolve(repoRoot, 'src', 'views', 'hierarchy', 'hierarchy.css'), 'utf8');
const workspacesCss = readFileSync(resolve(repoRoot, 'src', 'views', 'workspaces', 'workspaces.css'), 'utf8');

const surfaces = [
  { name: 'hierarchy.js', src: hierarchySrc },
  { name: 'workspaces.js', src: workspacesSrc }
];
const stylesheets = [
  { name: 'hierarchy.css', src: hierarchyCss },
  { name: 'workspaces.css', src: workspacesCss }
];

describe('hierarchy / workspaces drag — pointer-capture contract', () => {
  for (const { name, src } of surfaces) {
    describe(name, () => {
      it('listens for pointerdown on the tree container (not mousedown)', () => {
        expect(src).toMatch(/localBoardsEl\.addEventListener\(\s*['"]pointerdown['"]/);
        // Affirmative: no surviving mousedown drag listener on the
        // container. (The `dblclick` / `click` listeners stay — the
        // grep is anchored to `addEventListener('mousedown'` only.)
        expect(src).not.toMatch(/localBoardsEl\.addEventListener\(\s*['"]mousedown['"]/);
      });

      it('registers pointermove + pointerup + pointercancel on the document during drag', () => {
        expect(src).toMatch(/document\.addEventListener\(\s*['"]pointermove['"]\s*,\s*onMove\s*,\s*true\s*\)/);
        expect(src).toMatch(/document\.addEventListener\(\s*['"]pointerup['"]\s*,\s*onUp\s*,\s*true\s*\)/);
        expect(src).toMatch(/document\.addEventListener\(\s*['"]pointercancel['"]\s*,\s*onUp\s*,\s*true\s*\)/);
      });

      it('removes the same pointer listeners in endDrag and onUp (symmetric add/remove)', () => {
        const removeMoves = (src.match(/document\.removeEventListener\(\s*['"]pointermove['"]/g) || []).length;
        const removeUps = (src.match(/document\.removeEventListener\(\s*['"]pointerup['"]/g) || []).length;
        const removeCancels = (src.match(/document\.removeEventListener\(\s*['"]pointercancel['"]/g) || []).length;
        // Two call sites each: endDrag (for blur / visibilitychange
        // cleanup) and onUp (the normal drop path).
        expect(removeMoves).toBeGreaterThanOrEqual(2);
        expect(removeUps).toBeGreaterThanOrEqual(2);
        expect(removeCancels).toBeGreaterThanOrEqual(2);
      });

      it('captures the source tree-node on pointerdown and releases on cleanup', () => {
        // setPointerCapture call is what actually keeps events
        // flowing across webview boundaries. Without it, this fix
        // is a wiring-only swap that doesn't solve cross-view drag.
        expect(src).toMatch(/setPointerCapture\(\s*e\.pointerId\s*\)/);
        // Release symmetrically so a cancelled drag doesn't leave
        // the source element holding pointer capture forever.
        expect(src).toMatch(/releasePointerCapture\(\s*capturedPointerId\s*\)/);
        // releasePointerCaptureSafely is invoked from BOTH endDrag
        // (gesture-loss safety net) and onUp (drop path).
        const callSites = (src.match(/releasePointerCaptureSafely\(\)/g) || []).length;
        expect(callSites).toBeGreaterThanOrEqual(2);
      });

      it('emits a directional drop class (`is-drop-before` / `is-drop-after`) for same-kind reorder', () => {
        // Without the directional class the user sees only the
        // dashed-outline `.is-drop-target` — same outline above and
        // below the target, so dropping a card above vs below a
        // sibling looks identical. This is the UX gap the user
        // called out as "drag highlight is bad and unusable".
        expect(src).toMatch(/classList\.add\(\s*['"]is-drop-before['"]/);
        expect(src).toMatch(/classList\.add\(\s*['"]is-drop-after['"]/);
        // Both directional classes are stripped on hover off / end
        // (otherwise stale classes accumulate as the cursor moves).
        expect(src).toMatch(/classList\.remove\(\s*['"]is-drop-before['"]/);
        expect(src).toMatch(/classList\.remove\(\s*['"]is-drop-after['"]/);
      });
    });
  }

  for (const { name, src } of stylesheets) {
    describe(name, () => {
      it('renders a 2px solid accent bar at the matching edge for `.is-drop-target.is-drop-before/after`', () => {
        // Solid bar at the precise edge — the only drag visual the
        // user contract permits ("only a placement at a position is
        // valid", 2026-05-09).
        expect(src).toMatch(
          /\.tree-node\.is-drop-target\.is-drop-before\s*\{[\s\S]{0,160}box-shadow:\s*0\s+-2px\s+0\s+0\s+var\(--accent[^)]*\)/
        );
        expect(src).toMatch(
          /\.tree-node\.is-drop-target\.is-drop-after\s*\{[\s\S]{0,160}box-shadow:\s*0\s+2px\s+0\s+0\s+var\(--accent[^)]*\)/
        );
      });

      it('does NOT render a dashed-outline whole-row highlight on `.is-drop-target` (regression fence — user removed it 2026-05-09)', () => {
        // The previous Phase 2b "subtle accent outline rather than a
        // full-row highlight" rule (`outline: 1.5px dashed var(--accent)`
        // bound to bare `.is-drop-target` without the directional
        // suffix) was removed because it competed with hover styles
        // and didn't tell the user where exactly the drop would land.
        // Future regressions that re-introduce the bare-class outline
        // must update this expectation deliberately.
        expect(src).not.toMatch(
          /\.tree-node\.is-drop-target\s*\{[\s\S]{0,200}outline:\s*1(?:\.5)?px\s+dashed/
        );
      });
    });
  }
});
