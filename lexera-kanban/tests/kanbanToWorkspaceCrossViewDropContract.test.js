// Kanban → Workspace cross-view drop contract.
//
// User report 2026-05-10: "i cant drag from the kanban to the
// workspace!". Reverse direction of the workspace → kanban chain
// fixed in stages 1-13. The kanban view's `dragDropHandlers.js`
// dispatches `external-dnd-hover` / `external-dnd-drop` to whichever
// webview the cursor lands on (via `multiview_emit_to(label, ...)`).
// Without a listener on the workspace tree side, those events are
// dropped on the floor and the user sees no drop indicator + no
// persistence.
//
// Source-level (regex) test so it doesn't depend on a multi-webview
// Tauri runtime — what we pin is "the sub-app subscribes to the right
// events AND wires the right callbacks", which is what makes the
// runtime behavior correct.

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

function pinReceiverWiring(label, src, handlerVarName) {
  describe(label, () => {
    it('subscribes to external-dnd-hover, external-dnd-drop, and external-dnd-clear via LexeraSubApp.init onCustom', () => {
      // Without these keys the runtime never registers wv.listen for
      // the events the kanban dispatches — the destination silently
      // drops every hover/drop frame.
      expect(src).toMatch(/['"]external-dnd-hover['"]\s*:/);
      expect(src).toMatch(/['"]external-dnd-drop['"]\s*:/);
      expect(src).toMatch(/['"]external-dnd-clear['"]\s*:/);
    });

    it(`onCustom callbacks delegate to ${handlerVarName} with the right event-kind tag`, () => {
      // The keys exist (asserted above); they MUST route into the
      // destination handler closure so the DOM hit-test + indicator
      // actually run.
      expect(src).toMatch(new RegExp(`${handlerVarName}\\s*\\(\\s*['"]hover['"]`));
      expect(src).toMatch(new RegExp(`${handlerVarName}\\s*\\(\\s*['"]drop['"]`));
      expect(src).toMatch(new RegExp(`${handlerVarName}\\s*\\(\\s*['"]clear['"]`));
    });

    it('handler maps kanban-format payload (type-discriminated, per-kind id field) into a hierarchy source { boardId, kind, entityId }', () => {
      // The kanban's `getCrossViewDragPayload` emits source as
      //   { boardId, cardId | columnId | stackId | rowId, ... }
      // with `type: 'tree-card' | 'tree-column' | 'tree-stack' | 'tree-row'`.
      // The shell-forwarder format already carries { kind, entityId }.
      // The mapper must accept BOTH or kanban→workspace silently
      // returns null and the indicator never paints.
      expect(src).toMatch(/function\s+mapXviewSourceFromPayload\s*\(/);
      // Shell-forwarder shortcut (already shaped correctly).
      expect(src).toMatch(/src\.kind\s*&&\s*src\.entityId/);
      // Per-kind type discrimination from the kanban payload.
      expect(src).toMatch(/['"]tree-card['"]/);
      expect(src).toMatch(/['"]tree-column['"]/);
      expect(src).toMatch(/['"]tree-stack['"]/);
      expect(src).toMatch(/['"]tree-row['"]/);
      // Per-kind id field lookup.
      expect(src).toMatch(/src\.cardId/);
      expect(src).toMatch(/src\.columnId/);
      expect(src).toMatch(/src\.stackId/);
      expect(src).toMatch(/src\.rowId/);
    });

    it('on hover: paints is-drop-before / is-drop-after / is-drop-absorb based on match.info.position', () => {
      // Without the position-aware classes, the user sees no visible
      // landing position — the same regression Stage 3 fixed for the
      // source-side highlight is fixed here for the destination side.
      const handlerStart = src.search(new RegExp(`${handlerVarName}\\s*=\\s*function`));
      expect(handlerStart, `${handlerVarName} function definition must exist`).toBeGreaterThan(-1);
      const tail = src.slice(handlerStart);
      expect(tail).toMatch(/is-drop-before/);
      expect(tail).toMatch(/is-drop-after/);
      expect(tail).toMatch(/is-drop-absorb/);
      expect(tail).toMatch(/match\.info\.position\s*===\s*['"]before['"]/);
      expect(tail).toMatch(/match\.info\.position\s*===\s*['"]after['"]/);
    });

    it('on drop: broadcasts hierarchy-entity-drop with { source, target } AND cross-view-drag-handled echo', () => {
      // The shell-side hierarchyDragBridge listens for
      // `hierarchy-entity-drop` and runs applyDrop+saveBoard. Without
      // this broadcast the resolved target is dead-letter.
      const handlerStart = src.search(new RegExp(`${handlerVarName}\\s*=\\s*function`));
      expect(handlerStart, `${handlerVarName} function definition must exist`).toBeGreaterThan(-1);
      const tail = src.slice(handlerStart);
      expect(tail).toMatch(/broadcast\(\s*['"]hierarchy-entity-drop['"]/);
      // The cross-view-drag-handled echo lets the kanban source's drag
      // UI clean up — same role as embeddedBoardBridge's broadcast on
      // its own drop.
      expect(tail).toMatch(/broadcast\(\s*['"]cross-view-drag-handled['"]/);
    });

    it('on drop: only broadcasts when a target was actually resolved (no dead-letter on miss)', () => {
      // Releasing over an empty area of the workspace tree must NOT
      // fire `hierarchy-entity-drop` — that would carry an undefined
      // target and the shell would log
      // `apply.local-drop.skip(missing-source-or-target)`.
      const handlerStart = src.search(new RegExp(`${handlerVarName}\\s*=\\s*function`));
      const tail = src.slice(handlerStart);
      // The broadcast guard is `if (match && source && ...)`. Allow
      // a generous gap because the actual guard also tests the
      // LexeraSubApp.broadcast availability + a comment may sit
      // between the guard and the call.
      expect(tail).toMatch(/if\s*\(\s*match\s*&&\s*source\s*&&[\s\S]{0,600}broadcast\(\s*['"]hierarchy-entity-drop['"]/);
    });
  });
}

describe('kanban → workspace cross-view drop', () => {
  pinReceiverWiring('hierarchy.js', hierarchySrc, '_hierarchyOnExternalDnd');
  pinReceiverWiring('workspaces.js', workspacesSrc, '_workspacesOnExternalDnd');
});
