/**
 * Inspector keystroke detectors.
 *
 * Pure-logic predicates that classify a KeyboardEvent as either:
 *   - the single-window inspector combo (F12 / Cmd-Shift-I / Alt-I), OR
 *   - the all-views inspector combo (Cmd/Ctrl+Alt+Shift+I).
 *
 * Lives outside the app.js IIFE so vitest can exercise the predicates
 * without booting the whole shell. The actual handlers (toggleInspector,
 * openAllInspectors) stay in app.js — they need access to tauriInvoke +
 * notification helpers that are tightly coupled to the shell context.
 *
 * Wired into the shell as `window.LexeraInspectorShortcuts.*` so app.js
 * can pick them up via the same global-bag pattern the rest of the
 * shell uses.
 */
(function () {
  'use strict';

  /**
   * True when `e` is the single-window inspector shortcut.
   *  - F12
   *  - Cmd/Ctrl + Shift + I  (no Alt)
   *  - Alt + I  (no Cmd/Ctrl)
   *
   * @param {KeyboardEvent|null|undefined} e
   * @returns {boolean}
   */
  function isInspectorShortcut(e) {
    if (!e) return false;
    var code = e.code || '';
    if (e.key === 'F12') return true;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && code === 'KeyI') return true;
    if (e.altKey && !e.ctrlKey && !e.metaKey && code === 'KeyI') return true;
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'i' || e.key === 'I')) return true;
    return false;
  }

  /**
   * True when `e` is the open-DevTools-for-EVERY-webview shortcut
   * (Cmd/Ctrl + Alt + Shift + I). Strict superset of the single-window
   * combo, so callers MUST test this BEFORE isInspectorShortcut to win
   * the precedence race.
   *
   * @param {KeyboardEvent|null|undefined} e
   * @returns {boolean}
   */
  function isInspectorAllShortcut(e) {
    if (!e) return false;
    var code = e.code || '';
    var altDown = !!e.altKey;
    var shiftDown = !!e.shiftKey;
    var modDown = !!(e.ctrlKey || e.metaKey);
    if (!modDown || !altDown || !shiftDown) return false;
    if (code === 'KeyI') return true;
    if (e.key === 'i' || e.key === 'I') return true;
    return false;
  }

  if (typeof window !== 'undefined') {
    window.LexeraInspectorShortcuts = {
      isInspectorShortcut: isInspectorShortcut,
      isInspectorAllShortcut: isInspectorAllShortcut
    };
  }
})();
