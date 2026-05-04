// Property-based invariant for the workspace shell's view lifecycle.
//
// Invariant under test: after every render, the set of tab.ids present
// in any layout tree equals the set of "spawned" tab.ids (the model's
// stand-in for `state.frameCache` / `multiviewSpawnedTabs`). When the
// trees and the frame cache disagree, the user sees a ghost view —
// a Tauri webview painting on screen at its last position even though
// no placeholder hosts it. The Phase 2 lifecycle reconciler is what
// keeps the two stores in sync; this test exercises it against
// pseudorandom sequences of mutation ops.
//
// We model the world with three pieces:
//   - `model.dockTree` + side docks (mirrors `state` shape consumed
//     by the reconciler)
//   - `model.spawnedTabs` (a Set; gains a tab.id on `spawn`, loses one
//     on `destroy`)
//   - the reconciler itself, configured with a `removeFrame` that just
//     deletes from `spawnedTabs`
//
// Operations chosen by a seeded RNG: addTab, removeTab, moveTab,
// replaceCenterRoot, addToSideDock, dropSideDock. Every op is followed
// by a render() simulation:
//   1. tree mutation completes
//   2. reconciler.reconcile(model) runs
//   3. for every tab.id newly present in the tree, model "spawns" it
// After step 3 the invariant must hold.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadModule(rel) {
  const code = fs.readFileSync(
    path.resolve(rel),
    'utf8'
  );
  const context = { console };
  context.window = context;
  vm.runInNewContext(code, context, { filename: path.basename(rel) });
  return context.window;
}

const reconcilerWindow = loadModule('src/workspace/lifecycleReconciler.js');
const layoutTreeWindow = loadModule('src/workspace/layoutTree.js');

const Reconciler = reconcilerWindow.LexeraLifecycleReconciler;
const LayoutTree = layoutTreeWindow.LexeraLayoutTree;

// ─── Seeded RNG (mulberry32) ─────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickInt(rng, max) {
  return Math.floor(rng() * max);
}
function pickFrom(rng, arr) {
  return arr[pickInt(rng, arr.length)];
}

// ─── Model ───────────────────────────────────────────────────────────
function createModel() {
  return {
    dockTree: { type: 'tabs', tabs: [] },
    sideDocks: { left: null, right: null, bottom: null },
    spawnedTabs: new Set(),
    nextTabSeq: 1,
  };
}

function nextId(model, prefix) {
  const id = `${prefix || 'tab'}-${model.nextTabSeq++}`;
  return id;
}

function allTreeIds(model) {
  const ids = new Set();
  const trees = [
    model.dockTree,
    model.sideDocks.left,
    model.sideDocks.right,
    model.sideDocks.bottom,
  ];
  for (const tree of trees) {
    if (!tree) continue;
    for (const id of LayoutTree.collectAllTabIds(tree)) {
      ids.add(id);
    }
  }
  return ids;
}

// ─── Op implementations ──────────────────────────────────────────────
function findAllLeaves(tree, out = []) {
  if (!tree) return out;
  if (tree.type === 'tabs') { out.push(tree); return out; }
  if (tree.type === 'split') {
    findAllLeaves(tree.first, out);
    findAllLeaves(tree.second, out);
  }
  return out;
}

function opAddTabToCenter(model, rng) {
  const leaves = findAllLeaves(model.dockTree);
  if (leaves.length === 0) {
    model.dockTree = { type: 'tabs', tabs: [] };
    leaves.push(model.dockTree);
  }
  const leaf = pickFrom(rng, leaves);
  const id = nextId(model);
  leaf.tabs.push({ id, title: id });
  return { kind: 'add-center', id };
}

function opAddTabToSideDock(model, rng) {
  const sides = ['left', 'right', 'bottom'];
  const side = pickFrom(rng, sides);
  if (!model.sideDocks[side]) {
    model.sideDocks[side] = { type: 'tabs', tabs: [] };
  }
  const leaves = findAllLeaves(model.sideDocks[side]);
  const leaf = leaves[0] || (model.sideDocks[side] = { type: 'tabs', tabs: [] });
  const id = nextId(model, `panel-${side}`);
  leaf.tabs.push({ id, title: id });
  return { kind: 'add-side', side, id };
}

function opRemoveRandomTab(model, rng) {
  const treesByLabel = [
    ['center', model.dockTree],
    ['left', model.sideDocks.left],
    ['right', model.sideDocks.right],
    ['bottom', model.sideDocks.bottom],
  ];
  const candidates = [];
  for (const [label, tree] of treesByLabel) {
    if (!tree) continue;
    for (const leaf of findAllLeaves(tree)) {
      for (let i = 0; i < leaf.tabs.length; i++) {
        candidates.push({ label, leaf, idx: i });
      }
    }
  }
  if (candidates.length === 0) return { kind: 'noop-remove' };
  const target = pickFrom(rng, candidates);
  const removed = target.leaf.tabs.splice(target.idx, 1)[0];
  return { kind: 'remove', label: target.label, id: removed && removed.id };
}

function opMoveTab(model, rng) {
  const leaves = [
    ...findAllLeaves(model.dockTree),
    ...findAllLeaves(model.sideDocks.left),
    ...findAllLeaves(model.sideDocks.right),
    ...findAllLeaves(model.sideDocks.bottom),
  ];
  const withTabs = leaves.filter((l) => l.tabs.length > 0);
  if (withTabs.length === 0 || leaves.length < 2) return { kind: 'noop-move' };
  const src = pickFrom(rng, withTabs);
  let dst = pickFrom(rng, leaves);
  // allow same-leaf moves (reorder); they should not change the id set.
  const idx = pickInt(rng, src.tabs.length);
  const [tab] = src.tabs.splice(idx, 1);
  dst.tabs.push(tab);
  return { kind: 'move', id: tab && tab.id };
}

function opReplaceCenterRoot(model, rng) {
  // Replaces the entire center tree with a fresh empty tabs leaf —
  // simulates `flattenToActiveLeaf` style wholesale-replacement paths
  // that historically leaked frames.
  const replaced = LayoutTree.collectAllTabIds(model.dockTree);
  model.dockTree = { type: 'tabs', tabs: [] };
  return { kind: 'replace-center', dropped: replaced.length };
}

function opDropSideDock(model, rng) {
  const sides = ['left', 'right', 'bottom'].filter((s) => model.sideDocks[s]);
  if (sides.length === 0) return { kind: 'noop-drop-side' };
  const side = pickFrom(rng, sides);
  model.sideDocks[side] = null;
  return { kind: 'drop-side', side };
}

function opPromoteCenterToSplit(model, rng) {
  // Wrap the existing center tree in a split, simulating `promoteToSplit`.
  // The id set must not change.
  const existing = model.dockTree;
  model.dockTree = {
    type: 'split',
    direction: pickFrom(rng, ['horizontal', 'vertical']),
    first: existing,
    second: { type: 'tabs', tabs: [] },
  };
  return { kind: 'promote-split' };
}

const OPS = [
  opAddTabToCenter,
  opAddTabToCenter,
  opAddTabToCenter,
  opAddTabToSideDock,
  opRemoveRandomTab,
  opRemoveRandomTab,
  opMoveTab,
  opReplaceCenterRoot,
  opDropSideDock,
  opPromoteCenterToSplit,
];

// ─── Test harness ────────────────────────────────────────────────────
function simulateRender(reconciler, model) {
  // Step 1: reconciler destroys frames whose tab.id is no longer in any tree.
  reconciler.reconcile(model);
  // Step 2: spawn newly-introduced tabs (mirror what the real shell does
  // when a tab is added — `prepareFrame` / `multiview.spawn`).
  for (const id of allTreeIds(model)) {
    if (!model.spawnedTabs.has(id)) model.spawnedTabs.add(id);
  }
}

function assertInvariant(model, opLabel) {
  const treeIds = [...allTreeIds(model)].sort();
  const spawned = [...model.spawnedTabs].sort();
  expect(spawned).toEqual(treeIds);
  // Defensive: no duplicate ids in the tree.
  expect(treeIds.length).toBe(new Set(treeIds).size);
}

function runSequence(seed, opCount) {
  const rng = makeRng(seed);
  const model = createModel();
  const reconciler = Reconciler.create({
    collectAllTabIds: LayoutTree.collectAllTabIds,
    removeFrame: (id) => { model.spawnedTabs.delete(id); },
  });
  // Capture an initial frame so the reconciler has a snapshot.
  simulateRender(reconciler, model);
  assertInvariant(model, 'initial');
  const trace = ['initial'];
  for (let i = 0; i < opCount; i++) {
    const op = pickFrom(rng, OPS);
    const result = op(model, rng);
    trace.push(result.kind || 'unknown');
    simulateRender(reconciler, model);
    try {
      assertInvariant(model, result.kind);
    } catch (err) {
      // Annotate with the op trace so a failing seed is reproducible.
      err.message = `seed=${seed} step=${i} trace=${trace.join('→')}\n${err.message}`;
      throw err;
    }
  }
}

describe('view lifecycle invariant — random op sequences', () => {
  // Deterministic seeds — running the same suite produces the same coverage.
  const SEEDS = [0xA17F, 0xB220, 0xC0FFEE, 0xDEADBE, 0xEEFE, 0xFADE7E];
  const OPS_PER_SEQUENCE = 50;

  for (const seed of SEEDS) {
    it(`tree.tabIds === spawnedTabs after each op (seed=0x${seed.toString(16)})`, () => {
      runSequence(seed, OPS_PER_SEQUENCE);
    });
  }

  it('handles the worst-case "wholesale replace then drop side dock" path', () => {
    // Manual scenario — historically this exact path leaked frames
    // because `flattenToActiveLeaf` reassigned `state.dockTree` before
    // calling `removeFrame` for discarded tabs.
    const model = createModel();
    const reconciler = Reconciler.create({
      collectAllTabIds: LayoutTree.collectAllTabIds,
      removeFrame: (id) => { model.spawnedTabs.delete(id); },
    });
    // Set up: 5 center tabs + 2 left dock tabs.
    model.dockTree = {
      type: 'tabs',
      tabs: [
        { id: 'a', title: 'a' },
        { id: 'b', title: 'b' },
        { id: 'c', title: 'c' },
        { id: 'd', title: 'd' },
        { id: 'e', title: 'e' },
      ],
    };
    model.sideDocks.left = {
      type: 'tabs',
      tabs: [
        { id: 'left-1', title: 'left-1' },
        { id: 'left-2', title: 'left-2' },
      ],
    };
    simulateRender(reconciler, model);
    assertInvariant(model, 'setup');

    // Wholesale replace center.
    model.dockTree = { type: 'tabs', tabs: [{ id: 'only', title: 'only' }] };
    simulateRender(reconciler, model);
    assertInvariant(model, 'after-replace-center');
    // a..e must be gone from spawnedTabs; only 'only', 'left-1', 'left-2' remain.
    expect([...model.spawnedTabs].sort()).toEqual(['left-1', 'left-2', 'only']);

    // Drop the entire left dock.
    model.sideDocks.left = null;
    simulateRender(reconciler, model);
    assertInvariant(model, 'after-drop-left');
    expect([...model.spawnedTabs]).toEqual(['only']);
  });
});
