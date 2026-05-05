/**
 * LexeraDebug — runtime debug helpers reachable from DevTools.
 *
 * Exposes a small global on `window.LexeraDebug` so a developer (or
 * support session) can toggle visibility of native child webviews
 * without rebuilding the app. The native webviews paint at the OS
 * window layer above all shell DOM, so when something inside the
 * shell looks broken (fold strip not visible, drag overlay covered,
 * z-order surprise) it's frequently a webview occluding shell DOM
 * at its last-known geometry. This API lets the user verify that
 * hypothesis in seconds:
 *
 *   LexeraDebug.hideAllOverlays(true)   // every child webview hides
 *   LexeraDebug.hideAllOverlays(false)  // restore
 *   LexeraDebug.isOverlaysHidden()      // current suppression state
 *   LexeraDebug.dockSnapshot('bottom')  // dock-level diagnostic
 *
 * Wraps existing primitives:
 *   - `LexeraMultiviewWebview.setAllVisible(false)` — refcounted
 *     suppression already used by tab drag + overflow menus.
 *   - `LexeraWorkspaceShell._test_inspectDock(dockId)` — dock-level
 *     state snapshot used by the `_test_inspectDock` test seam.
 *
 * Lives in its own file so the global is registered ONCE at load
 * time, regardless of whether the shell has mounted yet, and so
 * the test harness can opt into loading it independently.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  function getMultiview() {
    return (typeof window !== 'undefined' && window.LexeraMultiviewWebview) || null;
  }
  function getShell() {
    return (typeof window !== 'undefined' && window.LexeraWorkspaceShell) || null;
  }

  function hideAllOverlays(hide) {
    var mv = getMultiview();
    if (!mv || typeof mv.setAllVisible !== 'function') {
      return { ok: false, reason: 'LexeraMultiviewWebview.setAllVisible unavailable' };
    }
    mv.setAllVisible(!hide);
    return { ok: true, hidden: !!hide };
  }

  function isOverlaysHidden() {
    var mv = getMultiview();
    if (!mv || typeof mv.isAllVisibleSuppressed !== 'function') return null;
    return !!mv.isAllVisibleSuppressed();
  }

  function dockSnapshot(dockId) {
    var shell = getShell();
    if (!shell || typeof shell._test_inspectDock !== 'function') {
      return { ok: false, reason: 'LexeraWorkspaceShell._test_inspectDock unavailable (shell not enabled?)' };
    }
    return shell._test_inspectDock(String(dockId || 'bottom'));
  }

  window.LexeraDebug = window.LexeraDebug || {};
  window.LexeraDebug.hideAllOverlays = hideAllOverlays;
  window.LexeraDebug.isOverlaysHidden = isOverlaysHidden;
  window.LexeraDebug.dockSnapshot = dockSnapshot;
})();
