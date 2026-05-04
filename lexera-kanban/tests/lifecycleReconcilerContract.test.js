import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadModule() {
  const code = fs.readFileSync(
    path.resolve('src/workspace/lifecycleReconciler.js'),
    'utf8'
  );
  const context = { console };
  context.window = context;
  vm.runInNewContext(code, context, { filename: 'lifecycleReconciler.js' });
  return context.window.LexeraLifecycleReconciler;
}

function tabsLeaf(...ids) {
  return {
    type: 'tabs',
    tabs: ids.map((id) => ({ id, title: id })),
  };
}

function makeCollect() {
  // Mirrors LexeraLayoutTree.collectAllTabIds — flatten any nested splits.
  return function collectAllTabIds(tree) {
    const out = [];
    function walk(node) {
      if (!node) return;
      if (node.type === 'tabs' && Array.isArray(node.tabs)) {
        for (const t of node.tabs) {
          if (t && t.id) out.push(t.id);
        }
        return;
      }
      if (node.type === 'split') {
        walk(node.first);
        walk(node.second);
      }
    }
    walk(tree);
    return out;
  };
}

describe('LexeraLifecycleReconciler', () => {
  it('exposes the create() factory', () => {
    const Reconciler = loadModule();
    expect(typeof Reconciler.create).toBe('function');
  });

  it('does not destroy anything on the first reconcile (initial snapshot capture)', () => {
    const Reconciler = loadModule();
    const removeFrame = vi.fn();
    const reconciler = Reconciler.create({
      collectAllTabIds: makeCollect(),
      removeFrame,
    });
    const state = {
      dockTree: tabsLeaf('a', 'b'),
      sideDocks: { left: tabsLeaf('panel-1'), right: null, bottom: null },
    };
    const result = reconciler.reconcile(state);
    expect(removeFrame).not.toHaveBeenCalled();
    expect(result.destroyed).toEqual([]);
    expect(result.snapshot.sort()).toEqual(['a', 'b', 'panel-1']);
  });

  it('does not destroy when a tab is added between reconciles', () => {
    const Reconciler = loadModule();
    const removeFrame = vi.fn();
    const reconciler = Reconciler.create({
      collectAllTabIds: makeCollect(),
      removeFrame,
    });
    reconciler.reconcile({ dockTree: tabsLeaf('a', 'b') });
    const result = reconciler.reconcile({ dockTree: tabsLeaf('a', 'b', 'c') });
    expect(removeFrame).not.toHaveBeenCalled();
    expect(result.destroyed).toEqual([]);
    expect(result.snapshot.sort()).toEqual(['a', 'b', 'c']);
  });

  it('destroys exactly the tabs that were removed since the last reconcile', () => {
    const Reconciler = loadModule();
    const removeFrame = vi.fn();
    const reconciler = Reconciler.create({
      collectAllTabIds: makeCollect(),
      removeFrame,
    });
    reconciler.reconcile({ dockTree: tabsLeaf('a', 'b', 'c', 'd', 'e') });
    const result = reconciler.reconcile({ dockTree: tabsLeaf('a', 'c', 'e') });
    expect(removeFrame).toHaveBeenCalledTimes(2);
    const destroyed = removeFrame.mock.calls.map((args) => args[0]).sort();
    expect(destroyed).toEqual(['b', 'd']);
    expect(result.destroyed.sort()).toEqual(['b', 'd']);
    expect(result.snapshot.sort()).toEqual(['a', 'c', 'e']);
  });

  it('does not re-destroy a tab that has already been removed in a prior reconcile', () => {
    const Reconciler = loadModule();
    const removeFrame = vi.fn();
    const reconciler = Reconciler.create({
      collectAllTabIds: makeCollect(),
      removeFrame,
    });
    reconciler.reconcile({ dockTree: tabsLeaf('a', 'b') });
    reconciler.reconcile({ dockTree: tabsLeaf('a') }); // 1st remove of b
    removeFrame.mockClear();
    const result = reconciler.reconcile({ dockTree: tabsLeaf('a') });
    expect(removeFrame).not.toHaveBeenCalled();
    expect(result.destroyed).toEqual([]);
  });

  it('considers tabs in every side dock (left/right/bottom), not only center', () => {
    const Reconciler = loadModule();
    const removeFrame = vi.fn();
    const reconciler = Reconciler.create({
      collectAllTabIds: makeCollect(),
      removeFrame,
    });
    reconciler.reconcile({
      dockTree: tabsLeaf('center-1'),
      sideDocks: {
        left: tabsLeaf('left-1'),
        right: tabsLeaf('right-1'),
        bottom: tabsLeaf('bottom-1'),
      },
    });
    const result = reconciler.reconcile({
      dockTree: tabsLeaf('center-1'),
      sideDocks: { left: null, right: null, bottom: null },
    });
    const destroyed = removeFrame.mock.calls.map((args) => args[0]).sort();
    expect(destroyed).toEqual(['bottom-1', 'left-1', 'right-1']);
    expect(result.snapshot).toEqual(['center-1']);
  });

  it('walks nested split nodes (not just direct tabs leaves)', () => {
    const Reconciler = loadModule();
    const removeFrame = vi.fn();
    const reconciler = Reconciler.create({
      collectAllTabIds: makeCollect(),
      removeFrame,
    });
    const initialSplit = {
      type: 'split',
      first: tabsLeaf('a', 'b'),
      second: { type: 'split', first: tabsLeaf('c'), second: tabsLeaf('d', 'e') },
    };
    reconciler.reconcile({ dockTree: initialSplit });
    const result = reconciler.reconcile({ dockTree: tabsLeaf('a') });
    const destroyed = removeFrame.mock.calls.map((args) => args[0]).sort();
    expect(destroyed).toEqual(['b', 'c', 'd', 'e']);
    expect(result.snapshot).toEqual(['a']);
  });

  it('reset() drops the previous snapshot so the next reconcile destroys nothing', () => {
    const Reconciler = loadModule();
    const removeFrame = vi.fn();
    const reconciler = Reconciler.create({
      collectAllTabIds: makeCollect(),
      removeFrame,
    });
    reconciler.reconcile({ dockTree: tabsLeaf('a', 'b') });
    reconciler.reset();
    const result = reconciler.reconcile({ dockTree: tabsLeaf('a') });
    expect(removeFrame).not.toHaveBeenCalled();
    expect(result.destroyed).toEqual([]);
    expect(result.snapshot).toEqual(['a']);
  });

  it('returns a no-op when required deps are missing', () => {
    const Reconciler = loadModule();
    const reconcilerMissingRemove = Reconciler.create({
      collectAllTabIds: makeCollect(),
    });
    const result1 = reconcilerMissingRemove.reconcile({ dockTree: tabsLeaf('a') });
    expect(result1.destroyed).toEqual([]);
    expect(result1.snapshot).toEqual([]);

    const removeFrame = vi.fn();
    const reconcilerMissingCollect = Reconciler.create({ removeFrame });
    const result2 = reconcilerMissingCollect.reconcile({ dockTree: tabsLeaf('a') });
    expect(removeFrame).not.toHaveBeenCalled();
    expect(result2.destroyed).toEqual([]);
  });

  it('captures prepareTab in the closure for future phases without invoking it yet', () => {
    const Reconciler = loadModule();
    const prepareTab = vi.fn();
    const reconciler = Reconciler.create({
      collectAllTabIds: makeCollect(),
      removeFrame: vi.fn(),
      prepareTab,
    });
    reconciler.reconcile({ dockTree: tabsLeaf('a', 'b') });
    reconciler.reconcile({ dockTree: tabsLeaf('a', 'b', 'c') });
    expect(prepareTab).not.toHaveBeenCalled();
    expect(reconciler._test_prepareTabBound()).toBe(true);
  });
});
