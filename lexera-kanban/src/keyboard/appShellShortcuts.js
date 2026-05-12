/**
 * @typedef {Object} LexeraAppShellShortcutsWorkspaceShell
 * @property {(action: string) => void} handleBoardAction
 */

/**
 * @typedef {Object} LexeraAppShellShortcutsDeps
 * @property {boolean} workspaceShellEnabled
 * @property {LexeraAppShellShortcutsWorkspaceShell | null | undefined} WorkspaceShell
 * @property {boolean} isEditing
 */

/**
 * @typedef {Object} LexeraAppShellShortcutsApi
 * @property {(event: KeyboardEvent, deps: LexeraAppShellShortcutsDeps) => boolean} dispatchWorkspaceShellAction
 */

var LexeraAppShellShortcuts = (function () {
  'use strict';

  /**
   * @param {LexeraAppShellShortcutsDeps} deps
   * @param {KeyboardEvent} event
   */
  function isWorkspaceShellShortcutContext(deps, event) {
    return !!(
      deps &&
      deps.workspaceShellEnabled &&
      deps.WorkspaceShell &&
      (event.ctrlKey || event.metaKey) &&
      !deps.isEditing
    );
  }

  /**
   * @param {KeyboardEvent} event
   * @param {LexeraAppShellShortcutsDeps} deps
   * @returns {boolean}
   */
  function dispatchWorkspaceShellAction(event, deps) {
    if (!isWorkspaceShellShortcutContext(deps, event)) return false;
    // The context guard above already enforced this, but hoist a
    // non-null local so the type checker can narrow without a custom
    // type predicate.
    var wsShell = deps.WorkspaceShell;
    if (!wsShell) return false;

    if (event.key === 'w' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      wsShell.handleBoardAction('close-active-tab');
      return true;
    }

    // Use `code` for bracket keys so shifted US layouts still map predictably.
    if (event.shiftKey && event.code === 'BracketRight') {
      event.preventDefault();
      wsShell.handleBoardAction('next-tab');
      return true;
    }
    if (event.shiftKey && event.code === 'BracketLeft') {
      event.preventDefault();
      wsShell.handleBoardAction('prev-tab');
      return true;
    }

    if (!event.shiftKey && !event.altKey && event.key === 'PageDown') {
      event.preventDefault();
      wsShell.handleBoardAction('next-tab');
      return true;
    }
    if (!event.shiftKey && !event.altKey && event.key === 'PageUp') {
      event.preventDefault();
      wsShell.handleBoardAction('prev-tab');
      return true;
    }

    if (event.key === 'b' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      wsShell.handleBoardAction('toggle-panel:hierarchy');
      return true;
    }
    if (event.shiftKey && !event.altKey && String(event.key || '').toLowerCase() === 'd') {
      event.preventDefault();
      wsShell.handleBoardAction('toggle-panel:dashboard');
      return true;
    }
    if (event.shiftKey && !event.altKey && String(event.key || '').toLowerCase() === 'e') {
      event.preventDefault();
      wsShell.handleBoardAction('toggle-panel:files');
      return true;
    }

    return false;
  }

  /** @type {LexeraAppShellShortcutsApi} */
  var api = {
    dispatchWorkspaceShellAction: dispatchWorkspaceShellAction
  };
  return api;
})();

window.LexeraAppShellShortcuts = LexeraAppShellShortcuts;
