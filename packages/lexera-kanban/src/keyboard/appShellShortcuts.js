var LexeraAppShellShortcuts = (function () {
  'use strict';

  function isWorkspaceShellShortcutContext(deps, event) {
    return !!(
      deps &&
      deps.workspaceShellEnabled &&
      deps.WorkspaceShell &&
      (event.ctrlKey || event.metaKey) &&
      !deps.isEditing
    );
  }

  function dispatchWorkspaceShellAction(event, deps) {
    if (!isWorkspaceShellShortcutContext(deps, event)) return false;

    if (event.key === 'w' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      deps.WorkspaceShell.handleBoardAction('close-active-tab');
      return true;
    }

    // Use `code` for bracket keys so shifted US layouts still map predictably.
    if (event.shiftKey && event.code === 'BracketRight') {
      event.preventDefault();
      deps.WorkspaceShell.handleBoardAction('next-tab');
      return true;
    }
    if (event.shiftKey && event.code === 'BracketLeft') {
      event.preventDefault();
      deps.WorkspaceShell.handleBoardAction('prev-tab');
      return true;
    }

    if (!event.shiftKey && !event.altKey && event.key === 'PageDown') {
      event.preventDefault();
      deps.WorkspaceShell.handleBoardAction('next-tab');
      return true;
    }
    if (!event.shiftKey && !event.altKey && event.key === 'PageUp') {
      event.preventDefault();
      deps.WorkspaceShell.handleBoardAction('prev-tab');
      return true;
    }

    if (event.key === 'b' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      deps.WorkspaceShell.handleBoardAction('toggle-panel:hierarchy');
      return true;
    }
    if (event.shiftKey && !event.altKey && String(event.key || '').toLowerCase() === 'd') {
      event.preventDefault();
      deps.WorkspaceShell.handleBoardAction('toggle-panel:dashboard');
      return true;
    }
    if (event.shiftKey && !event.altKey && String(event.key || '').toLowerCase() === 'e') {
      event.preventDefault();
      deps.WorkspaceShell.handleBoardAction('toggle-panel:files');
      return true;
    }

    return false;
  }

  return {
    dispatchWorkspaceShellAction: dispatchWorkspaceShellAction
  };
})();

window.LexeraAppShellShortcuts = LexeraAppShellShortcuts;
