// Pin the rAF-batched swap-in queue in virtualScroll.js.
//
// Bug: a fast scroll past N hidden cards in a virtualised column made
// the IntersectionObserver fire with ~N entries in a single tick, and
// each entry's vsSwapIn() ran synchronously — N parentNode.replaceChild
// calls + N markdown re-renders + N enhancer-callback chains, all on
// one main-thread frame. On large boards this manifested as scroll jank.
//
// Fix: vsHandleIntersections now calls vsScheduleSwapIn(sentinel) which
// queues the work and drains it in rAF batches with a per-frame budget
// (VS_SWAP_IN_BUDGET_PER_FRAME). Pointer hit-testing during drag still
// sees every card via vsDrainSwapInQueue() inside vsMaterialiseAll().
//
// This contract exercises the test seams exposed by the IIFE — no full
// board boot. We run the IIFE in a vm context with a minimal browser
// shim so the module installs as `globalThis.LexeraVirtualScroll`.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(__dirname, '..', 'src', 'virtualscroll', 'virtualScroll.js');
const moduleSrc = readFileSync(modulePath, 'utf-8');

function makeSentinel(name) {
  // The queue skips sentinels whose parentNode is null (they were
  // discarded between schedule and process), so the test must give
  // each one a stub parent. vsSwapIn will then look up an owning
  // column state, find none, and return harmlessly — but the budget
  // counter still decrements, which is what we want to assert.
  const fakeParent = { replaceChild: () => {} };
  return { __name: name, parentNode: fakeParent, classList: { contains: () => false } };
}

function bootModule({ rafSchedules }) {
  const sandbox = {
    console,
    Set, Map,
    requestAnimationFrame: (fn) => { rafSchedules.push(fn); return rafSchedules.length; },
    cancelAnimationFrame: (id) => { /* no-op for the budget test */ },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  };
  const ctx = createContext(sandbox);
  runInContext(moduleSrc, ctx);
  return ctx.LexeraVirtualScroll;
}

describe('virtualScroll — rAF-batched swap-in queue', () => {
  let rafSchedules;
  let api;

  beforeEach(() => {
    rafSchedules = [];
    api = bootModule({ rafSchedules });
  });

  it('exposes a per-frame budget greater than 1 (so single-card scrolls still flush quickly)', () => {
    const budget = api._test_swapInBudget();
    expect(budget).toBeGreaterThan(1);
    // Loose upper bound — if someone bumps it past ~16 the batching
    // benefit collapses (a fast scroll hydrates everything in one frame
    // again). Force a deliberate update if that's the intent.
    expect(budget).toBeLessThanOrEqual(16);
  });

  it('queues swap-ins instead of executing them synchronously', () => {
    // Schedule 20 sentinels — more than the per-frame budget.
    const sentinels = [];
    for (let i = 0; i < 20; i++) {
      const s = makeSentinel('s' + i);
      sentinels.push(s);
      api._test_scheduleSwapIn(s);
    }
    // Nothing has been drained yet because we never invoked the rAF
    // callback. The queue holds all 20.
    expect(api._test_swapInQueueLength()).toBe(20);
    // Exactly one rAF was scheduled — repeated scheduleSwapIn calls
    // dedupe on the existing rAF.
    expect(rafSchedules.length).toBe(1);
  });

  it('dedupes a sentinel scheduled twice without flushing in between', () => {
    const s = makeSentinel('dup');
    api._test_scheduleSwapIn(s);
    api._test_scheduleSwapIn(s);
    api._test_scheduleSwapIn(s);
    expect(api._test_swapInQueueLength()).toBe(1);
  });

  it('processes at most BUDGET sentinels per rAF tick', () => {
    const budget = api._test_swapInBudget();
    const total = budget * 3 + 1;
    const sentinels = [];
    for (let i = 0; i < total; i++) {
      const s = makeSentinel('s' + i);
      sentinels.push(s);
      api._test_scheduleSwapIn(s);
    }
    expect(api._test_swapInQueueLength()).toBe(total);

    // Tick 1.
    api._test_processSwapInQueue();
    expect(api._test_swapInQueueLength()).toBe(total - budget);
    // It should have re-armed rAF for the remainder.
    expect(rafSchedules.length).toBeGreaterThanOrEqual(2);

    // Tick 2.
    api._test_processSwapInQueue();
    expect(api._test_swapInQueueLength()).toBe(total - budget * 2);

    // Drain the rest.
    api._test_processSwapInQueue();
    api._test_processSwapInQueue();
    expect(api._test_swapInQueueLength()).toBe(0);
  });

  it('drainSwapInQueue empties the queue synchronously (used at drag start)', () => {
    for (let i = 0; i < 10; i++) {
      api._test_scheduleSwapIn(makeSentinel('s' + i));
    }
    expect(api._test_swapInQueueLength()).toBe(10);
    api._test_drainSwapInQueue();
    expect(api._test_swapInQueueLength()).toBe(0);
  });
});
