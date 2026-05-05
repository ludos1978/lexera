// Pin the `LexeraDebug` global API.
//
// Why this exists: when a native child webview paints over shell DOM
// (e.g. a panel webview keeping its last-known geometry after its
// host dock collapses), the user needs a way to flip ALL child
// webviews off without rebuilding so they can see the shell DOM
// underneath. Previously the only way was to call private internals
// from DevTools. This file pins:
//   1. `window.LexeraDebug.hideAllOverlays(true|false)` calls into
//      `LexeraMultiviewWebview.setAllVisible` (the existing
//      refcounted suppression already used during tab drag).
//   2. `isOverlaysHidden()` reflects the suppression state.
//   3. `dockSnapshot(dockId)` proxies to the shell's
//      `_test_inspectDock` diagnostic seam.

import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadDebug({ multiview, shell } = {}) {
  const window = {
    LexeraMultiviewWebview: multiview || undefined,
    LexeraWorkspaceShell: shell || undefined
  };
  loadIIFE('debug/debugApi.js', null, {
    window,
    console: { log() {}, warn() {}, error() {} }
  });
  return window;
}

describe('LexeraDebug global API', () => {
  it('exposes hideAllOverlays / isOverlaysHidden / dockSnapshot on window.LexeraDebug', () => {
    const win = loadDebug();
    expect(win.LexeraDebug).toBeTruthy();
    expect(typeof win.LexeraDebug.hideAllOverlays).toBe('function');
    expect(typeof win.LexeraDebug.isOverlaysHidden).toBe('function');
    expect(typeof win.LexeraDebug.dockSnapshot).toBe('function');
  });

  it('hideAllOverlays(true) calls LexeraMultiviewWebview.setAllVisible(false)', () => {
    const setAllVisible = vi.fn();
    const win = loadDebug({
      multiview: { setAllVisible, isAllVisibleSuppressed: () => false }
    });
    const result = win.LexeraDebug.hideAllOverlays(true);
    expect(setAllVisible).toHaveBeenCalledWith(false);
    expect(result).toEqual({ ok: true, hidden: true });
  });

  it('hideAllOverlays(false) calls LexeraMultiviewWebview.setAllVisible(true)', () => {
    const setAllVisible = vi.fn();
    const win = loadDebug({
      multiview: { setAllVisible, isAllVisibleSuppressed: () => false }
    });
    const result = win.LexeraDebug.hideAllOverlays(false);
    expect(setAllVisible).toHaveBeenCalledWith(true);
    expect(result).toEqual({ ok: true, hidden: false });
  });

  it('hideAllOverlays returns ok:false with a reason when multiview is unavailable', () => {
    const win = loadDebug({ multiview: undefined });
    const result = win.LexeraDebug.hideAllOverlays(true);
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
  });

  it('isOverlaysHidden delegates to LexeraMultiviewWebview.isAllVisibleSuppressed', () => {
    const win1 = loadDebug({
      multiview: { setAllVisible: () => {}, isAllVisibleSuppressed: () => true }
    });
    expect(win1.LexeraDebug.isOverlaysHidden()).toBe(true);

    const win2 = loadDebug({
      multiview: { setAllVisible: () => {}, isAllVisibleSuppressed: () => false }
    });
    expect(win2.LexeraDebug.isOverlaysHidden()).toBe(false);
  });

  it('dockSnapshot delegates to the shell._test_inspectDock seam', () => {
    const inspectDock = vi.fn(() => ({ dockId: 'bottom', dockSize: 0, hasPanels: true }));
    const win = loadDebug({
      shell: { _test_inspectDock: inspectDock }
    });
    const result = win.LexeraDebug.dockSnapshot('bottom');
    expect(inspectDock).toHaveBeenCalledWith('bottom');
    expect(result).toEqual({ dockId: 'bottom', dockSize: 0, hasPanels: true });
  });

  it('dockSnapshot returns ok:false with a reason when shell is unavailable', () => {
    const win = loadDebug({ shell: undefined });
    const result = win.LexeraDebug.dockSnapshot('bottom');
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
  });

  it('dockSnapshot defaults to "bottom" when no dockId is passed (most common debug case)', () => {
    const inspectDock = vi.fn(() => ({ dockId: 'bottom' }));
    const win = loadDebug({
      shell: { _test_inspectDock: inspectDock }
    });
    win.LexeraDebug.dockSnapshot();
    expect(inspectDock).toHaveBeenCalledWith('bottom');
  });
});
