// Workspace tree click → focus entity in kanban view contract.
//
// User contract 2026-05-11: "when clicking on an element in the
// workspace (not on the burger menu or the drag icon) then it
// should focus that element in the kanban view (if the kanban
// isnt open, then open it!)"
//
// Wiring:
//   hierarchy.js / workspaces.js click handler →
//     LexeraSubApp.navigate({ type: 'focus-hierarchy-target', target })
//   → shell's navigationBridge.handleNavigate →
//     LexeraWorkspaceShell.focusHierarchyTarget(target, boardId, options)
//   → openBoard({ preferExisting: true }) +
//     messageBridge.focusHierarchy(tabId, target) to the kanban frame
//
// Source-level (regex) test pinning each link in that chain.

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
const navigationBridgeSrc = readFileSync(
  resolve(repoRoot, 'src', 'shell', 'bridges', 'navigationBridge.js'), 'utf8'
);
const orderHelpersSrc = readFileSync(
  resolve(repoRoot, 'src', 'board', 'orderHelpers.js'), 'utf8'
);
const boardSearchSrc = readFileSync(
  resolve(repoRoot, 'src', 'search', 'boardSearch.js'), 'utf8'
);

function pinSubAppClickWiring(label, src) {
  describe(label + ' — click handler routes non-board tree-nodes to focus-hierarchy-target', () => {
    it('navigates with type=focus-hierarchy-target carrying { boardId, kind ids, indices }', () => {
      expect(src).toMatch(/LexeraSubApp\.navigate\(\s*\{\s*[\s\S]{0,400}type\s*:\s*['"]focus-hierarchy-target['"]/);
      expect(src).toMatch(/target\s*:\s*focusTarget/);
    });

    it('skips clicks on the burger menu (.tree-menu-btn) and drag icon (.tree-grip)', () => {
      // User contract: clicks on these elements MUST keep their own
      // behavior and not navigate. The early-return is what guards it.
      expect(src).toMatch(/closest\(['"]\.tree-menu-btn['"]\)\s*\|\|\s*[\s\S]{0,100}closest\(['"]\.tree-grip['"]\)/);
    });

    it('only navigates when the node has data-drag-kind (rows/stacks/columns/cards)', () => {
      // Without data-drag-kind, the node is either a board row (handled
      // above) or a structural placeholder — early return.
      expect(src).toMatch(/getAttribute\(\s*['"]data-drag-kind['"]\s*\)/);
      expect(src).toMatch(/if\s*\(\s*!dragKind\s*\)\s*return\s*;/);
    });

    it('reads the single data-tree-id and routes it into the right field by data-drag-kind', () => {
      // Workspace tree nodes carry only TWO ids: `data-tree-id` (the
      // entity id, populated kid-first via `card.kid || card.id` etc.
      // per the buildXxxNode functions) and `data-drag-board-id`.
      // The previous version of this handler queried per-kind attrs
      // (`data-card-kid`, `data-row-id`, ...) that never existed,
      // leaving the focus payload all-null (user log 2026-05-11
      // confirmed). Pin the single-id read + the four-way routing
      // table so it can't drift back.
      expect(src).toMatch(/var\s+entityId\s*=\s*node\.getAttribute\(\s*['"]data-tree-id['"]/);
      expect(src).toMatch(/if\s*\(\s*!entityId\s*\)\s*return\s*;/);
      expect(src).toMatch(/dragKind\s*===\s*['"]card['"][\s\S]{0,80}cardId\s*=\s*entityId/);
      expect(src).toMatch(/dragKind\s*===\s*['"]column['"][\s\S]{0,80}columnId\s*=\s*entityId/);
      expect(src).toMatch(/dragKind\s*===\s*['"]stack['"][\s\S]{0,80}stackId\s*=\s*entityId/);
      expect(src).toMatch(/dragKind\s*===\s*['"]row['"][\s\S]{0,80}rowId\s*=\s*entityId/);
      // Defensive — unknown drag kinds early-return so a future
      // kind addition doesn't silently navigate with a half-baked
      // payload.
      expect(src).toMatch(/else\s+return\s*;/);
    });

    it('the existing open-board branch returns early so non-board navigation is mutually exclusive', () => {
      // Without `return`, clicking a board row would ALSO route to
      // focus-hierarchy-target with cardId=null etc. — meaningless,
      // and shell.focusHierarchyTarget might re-enter openBoard. The
      // explicit return after open-board navigate prevents that.
      expect(src).toMatch(/type\s*:\s*['"]open-board['"][\s\S]{0,200}return\s*;/);
    });
  });
}

describe('workspace tree click → focus kanban entity (user contract 2026-05-11)', () => {
  pinSubAppClickWiring('hierarchy.js', hierarchySrc);
  pinSubAppClickWiring('workspaces.js', workspacesSrc);

  describe('navigationBridge.js — focus-hierarchy-target dispatch', () => {
    it('handleNavigate routes type=focus-hierarchy-target to shell.focusHierarchyTarget(target, boardId, options)', () => {
      // Without this branch, the sub-app's navigate call falls through
      // and the kanban never opens / focuses.
      expect(navigationBridgeSrc).toMatch(/payload\.type\s*===\s*['"]focus-hierarchy-target['"]/);
      expect(navigationBridgeSrc).toMatch(/shell\.focusHierarchyTarget\(\s*payload\.target\s*,\s*payload\.target\.boardId/);
    });

    it('gates on payload.target.boardId so a missing payload silently no-ops', () => {
      // Defensive — sub-app builds the target from DOM attributes that
      // could be empty for malformed tree-nodes. Without the gate,
      // shell.focusHierarchyTarget would be called with undefined boardId.
      expect(navigationBridgeSrc).toMatch(/payload\.target\s*&&\s*payload\.target\.boardId/);
    });
  });

  describe('orderHelpers.js — focusHierarchyTargetLocally retries on board-data load race', () => {
    // User report 2026-05-13: "focussing a card from the workspace view
    // still doesnt work". Root cause: shell delivers the focus message
    // at 60ms/220ms after openBoard + on lexera-pane-activated, but for
    // a cross-board click the destination board's async data load can
    // take > 220ms. All three deliveries can fire BEFORE col.cards are
    // populated and the DOM is built, so findBoardEntityElement returns
    // null and the focus silently falls off. The shell deletes the
    // pending target at 220ms so later pane-activated has nothing to
    // deliver. Fix: retry the lookup inside the iframe via setTimeout
    // for up to ~3s so the focus survives the load race.

    it('schedules deferred retries via setTimeout when the lookup misses', () => {
      // The retry mechanism MUST exist for the cross-board focus to
      // survive the load race — without it the focus is lost forever.
      expect(orderHelpersSrc).toMatch(/function\s+attempt\s*\(\s*n\s*\)/);
      expect(orderHelpersSrc).toMatch(
        /setTimeout\(\s*function\s*\(\)\s*\{\s*attempt\(\s*n\s*\+\s*1\s*\)/
      );
    });

    it('caps retries to ~3s so we do not loop forever on a permanently-missing entity', () => {
      // The bounded-retry contract — without a cap, a deleted card or
      // a target on a board that never loads would spin a setTimeout
      // loop indefinitely.
      expect(orderHelpersSrc).toMatch(/FOCUS_RETRY_MAX_ATTEMPTS\s*=\s*30/);
      expect(orderHelpersSrc).toMatch(/FOCUS_RETRY_INTERVAL_MS\s*=\s*100/);
    });

    it('still applies focus immediately on the first successful attempt (no extra delay for the common case)', () => {
      // When the board is already loaded (same-board focus, or a board
      // that loaded fast), the first attempt finds the element and
      // applies focus synchronously. Pin this by asserting the SYNC
      // return path inside `attempt(0)`.
      expect(orderHelpersSrc).toMatch(/applyFocusToEl\(el\)/);
      expect(orderHelpersSrc).toMatch(/if\s*\(el\)\s*\{\s*applyFocusToEl/);
    });

    it('uses the canonical findBoardEntityElement on every retry attempt', () => {
      // Each retry must re-invoke the canonical lookup; calling it once
      // and caching the null result would defeat the retry.
      // The findBoardEntityElement call must be INSIDE the attempt fn.
      var attemptFnMatch = orderHelpersSrc.match(
        /function\s+attempt\s*\(\s*n\s*\)\s*\{[\s\S]{0,800}?findBoardEntityElement/
      );
      expect(attemptFnMatch).not.toBeNull();
    });
  });

  describe('focus the RIGHT card when the same kid appears in multiple DOM positions', () => {
    // User report 2026-05-13: "the card focus system STILL doesnt
    // focus the correct card!!!". Root cause: when an include file is
    // referenced from > 1 column on the same board, slide cards parsed
    // independently per column all share the same kid → the board-wide
    // `data-card-kid=X` selector returns the FIRST match, which may be
    // a different column's copy than the user clicked. Fix is two-part:
    // (a) workspace tree click harvests ancestor column / stack / row
    // ids from the DOM and threads them into the focus target;
    // (b) boardSearch.findBoardEntityElement uses those hints to scope
    // the card lookup into the matching ancestor's subtree.

    it('hierarchy.js focus click walks tree-entry ancestors and writes ids onto target', () => {
      // The harvest loop must climb past every tree-entry and copy the
      // tree-node's data-tree-id into the matching target field by
      // data-drag-kind. Ancestors only fill the field if not already
      // set (the clicked node's own kind got the original assignment).
      expect(hierarchySrc).toMatch(/while\s*\(\s*ancestor\s*\)/);
      expect(hierarchySrc).toMatch(/ancestor\.classList\.contains\(['"]tree-entry['"]\)/);
      expect(hierarchySrc).toMatch(/:scope\s*>\s*\.tree-node\[data-tree-id\]/);
      expect(hierarchySrc).toMatch(/ancKind\s*===\s*['"]column['"][\s\S]{0,80}!focusTarget\.columnId/);
      expect(hierarchySrc).toMatch(/ancKind\s*===\s*['"]stack['"][\s\S]{0,80}!focusTarget\.stackId/);
      expect(hierarchySrc).toMatch(/ancKind\s*===\s*['"]row['"][\s\S]{0,80}!focusTarget\.rowId/);
    });

    it('hierarchy.js DIRECT-click handler ALSO harvests ancestors (not just runEntityAction)', () => {
      // User report 2026-05-14: focus still wrong after 7a967330 because
      // that commit patched runEntityAction (burger-menu path) only.
      // The DIRECT-click handler at the bottom of hierarchy.js has its
      // own focus-target build — must apply the same harvest.
      //
      // Pin BOTH occurrences of the harvest loop in hierarchy.js so
      // future edits can't drop one and leave the other.
      var harvestMatches = hierarchySrc.match(/while\s*\(\s*ancestor\s*\)/g) || [];
      expect(harvestMatches.length).toBeGreaterThanOrEqual(2);
      // Direct-click handler is anchored by __hierarchyClickBound; the
      // harvest must appear within it.
      expect(hierarchySrc).toMatch(
        /__hierarchyClickBound[\s\S]{0,5000}|[\s\S]{0,5000}__hierarchyClickBound/
      );
      // Loose proximity check: the click handler's navigate call must
      // be preceded by the ancestor walk so the target carries ids
      // before dispatch.
      var clickHandlerSlice = hierarchySrc.match(
        /localBoardsEl\.addEventListener\(['"]click['"][\s\S]+?__hierarchyClickBound/
      );
      expect(clickHandlerSlice).not.toBeNull();
      expect(clickHandlerSlice[0]).toMatch(/while\s*\(\s*ancestor\s*\)/);
      expect(clickHandlerSlice[0]).toMatch(/ancKind\s*===\s*['"]column['"]/);
    });

    it('workspaces.js mirrors the same ancestor-harvest loop in BOTH the menu and click paths', () => {
      // workspaces.js + hierarchy.js are independent sub-apps; both
      // must apply the same fix or the bug repros from one of them.
      // Two harvest loops: runEntityAction + direct-click handler.
      var harvestMatches = workspacesSrc.match(/while\s*\(\s*ancestor\s*\)/g) || [];
      expect(harvestMatches.length).toBeGreaterThanOrEqual(2);
      expect(workspacesSrc).toMatch(/ancestor\.classList\.contains\(['"]tree-entry['"]\)/);
      expect(workspacesSrc).toMatch(/ancKind\s*===\s*['"]column['"][\s\S]{0,80}!focusTarget\.columnId/);
      var clickHandlerSlice = workspacesSrc.match(
        /localBoardsEl\.addEventListener\(['"]click['"][\s\S]+?__workspacesClickBound/
      );
      expect(clickHandlerSlice).not.toBeNull();
      expect(clickHandlerSlice[0]).toMatch(/while\s*\(\s*ancestor\s*\)/);
    });

    it('boardSearch.findBoardEntityElement scopes card lookup to the ancestor subtree when columnId/stackId/rowId is provided', () => {
      // Card lookup needs to query within the ancestor's subtree first
      // — without this scoping, a board-wide querySelector returns the
      // FIRST `data-card-kid=X` element which may be the wrong column.
      expect(boardSearchSrc).toMatch(/target\.columnId[\s\S]{0,200}\.column\[data-column-id=/);
      // searchRoot picks an Element-shaped scope when one exists, else
      // falls back to the board container. The exact shape can be
      // `scopeEl ||` OR a type-guard `(scopeEl && typeof ...) ?` —
      // both are valid; pin the fall-back-when-no-scope behavior.
      expect(boardSearchSrc).toMatch(/searchRoot[\s\S]{0,200}getElColumnsContainer\(\)/);
      // The defensive fallback must still query the whole container if
      // the ancestor wasn't rendered yet (DOM-not-ready race).
      expect(boardSearchSrc).toMatch(/byKidGlobal\s*=\s*getElColumnsContainer\(\)\.querySelector/);
    });
  });
});
