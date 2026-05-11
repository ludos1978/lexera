(function () {
  'use strict';

  function getOwnWindowLabel() {
    try {
      return new URLSearchParams(window.location.search || '').get('windowLabel') || 'main';
    } catch (_) { return 'main'; }
  }

  function isEventForThisWindow(event) {
    var source = event && event.payload && event.payload._sourceWindow;
    if (!source) return true;
    return source === getOwnWindowLabel();
  }
  'use strict';

  function tauriRuntime() {
    return (typeof window !== 'undefined' && window.__TAURI__) || null;
  }

  function getCurrentWebview() {
    // Dual-API resolution; see commit 1d19e940 for the bug class.
    var t = tauriRuntime();
    if (!t || !t.webview) return null;
    try {
      if (typeof t.webview.getCurrent === 'function') return t.webview.getCurrent();
      if (typeof t.webview.getCurrentWebview === 'function') return t.webview.getCurrentWebview();
    } catch (_) {}
    return null;
  }

  function multiviewApi() {
    return (typeof window !== 'undefined' && window.LexeraMultiview) || null;
  }

  function shellApi() {
    return (typeof window !== 'undefined' && window.LexeraWorkspaceShell) || null;
  }

  function frontendTestsApi() {
    return (typeof window !== 'undefined' && window.LexeraFrontendTests) || null;
  }

  function broadcastToSubApps(eventName, payload) {
    var t = tauriRuntime();
    if (!t || !t.core || typeof t.core.invoke !== 'function') return Promise.resolve(false);
    return t.core.invoke('multiview_broadcast', {
      event: String(eventName || ''),
      payload: payload || {}
    }).then(function () {
      return true;
    }).catch(function () {
      return false;
    });
  }

  function getFrontendTestsStatePayload() {
    var testsApi = frontendTestsApi();
    if (!testsApi || typeof testsApi.getStateSnapshot !== 'function') {
      return { available: false, error: 'Frontend tests runner unavailable' };
    }
    try {
      var snapshot = testsApi.getStateSnapshot();
      snapshot.available = true;
      return snapshot;
    } catch (err) {
      return {
        available: false,
        error: err && err.message ? err.message : String(err)
      };
    }
  }

  function broadcastFrontendTestsState() {
    return broadcastToSubApps('frontend-tests-state', getFrontendTestsStatePayload());
  }

  var SHORTCUT_ACTIONS = {
    'open-log-view': function () {
      var mv = multiviewApi();
      if (mv && typeof mv.openLogView === 'function') {
        return mv.openLogView({ side: 'bottom', size: 280 });
      }
    },
    'open-inspector': function () {
      var mv = multiviewApi();
      if (mv && typeof mv.openInspector === 'function') {
        return mv.openInspector({ side: 'right', size: 400 });
      }
    },
    'open-workspaces': function () {
      var mv = multiviewApi();
      if (mv && typeof mv.openWorkspaces === 'function') {
        return mv.openWorkspaces({ side: 'left', size: 280 });
      }
    },
    'open-dashboard': function () {
      var mv = multiviewApi();
      if (mv && typeof mv.openDashboard === 'function') {
        return mv.openDashboard({ side: 'right', size: 360 });
      }
    }
  };

  function handleNavigate(event) {
    var payload = event && event.payload ? event.payload : {};
    var shell = shellApi();
    if (!shell) return;
    try {
      if (payload.type === 'open-board' && payload.boardId && typeof shell.openBoard === 'function') {
        shell.openBoard(payload.boardId, payload.options || {});
      } else if (payload.type === 'open-workspace-window' && payload.workspaceId && typeof shell.openWorkspaceWindow === 'function') {
        shell.openWorkspaceWindow(payload.workspaceId);
      } else if (payload.type === 'reveal-panel' && payload.panelId && typeof shell.revealPanel === 'function') {
        shell.revealPanel(payload.panelId);
      } else if (payload.type === 'focus-hierarchy-target' && payload.target && payload.target.boardId && typeof shell.focusHierarchyTarget === 'function') {
        // User contract 2026-05-11: clicking a tree-node in the
        // workspace must focus that entity in the kanban view AND
        // open the kanban if it isn't already open. shell.focusHierarchyTarget
        // already does both: openBoard({ preferExisting: true }) +
        // post-mount delivery of the focus-hierarchy-target event to
        // the frame. We just route the sub-app's navigate call here.
        shell.focusHierarchyTarget(payload.target, payload.target.boardId, payload.options || {});
      }
    } catch (err) {
      console.warn('[multiview-navigate] handler failed:', err);
    }
  }

  function handleShortcut(event) {
    var payload = event && event.payload ? event.payload : {};
    var action = payload.action;
    var fn = SHORTCUT_ACTIONS[action];
    if (!fn) return;
    try { fn(); } catch (err) { console.warn('[multiview-shortcut]', action, err); }
  }

  function handleFrontendTestsCommand(event) {
    var payload = event && event.payload ? event.payload : {};
    var action = String(payload.action || 'refresh-state');
    var testsApi = frontendTestsApi();
    if (!testsApi) {
      broadcastFrontendTestsState();
      return;
    }
    try {
      var result = null;
      if (action === 'run-all' && typeof testsApi.runAllWithUI === 'function') {
        result = testsApi.runAllWithUI(payload.options || {});
      } else if (action === 'run-test' && payload.testName && typeof testsApi.runTest === 'function') {
        result = testsApi.runTest(payload.testName);
      } else if (action === 'run-category' && payload.category && typeof testsApi.runCategory === 'function') {
        result = testsApi.runCategory(payload.category);
      } else if (action === 'clear-results' && typeof testsApi.clearResults === 'function') {
        result = testsApi.clearResults();
      } else if (action === 'clear-category' && payload.category && typeof testsApi.clearCategory === 'function') {
        result = testsApi.clearCategory(payload.category);
      } else if (action === 'stop' && typeof testsApi.stop === 'function') {
        result = testsApi.stop();
      } else if (action === 'continue-undo' && typeof testsApi.continueUndo === 'function') {
        result = testsApi.continueUndo();
      } else if (action === 'set-board-selection' && typeof testsApi.setBoardSelection === 'function') {
        result = testsApi.setBoardSelection(payload.boardId || '');
      } else if (action === 'set-manual-inspect' && typeof testsApi.setManualInspectEnabled === 'function') {
        result = testsApi.setManualInspectEnabled(payload.enabled === true);
      } else if (action === 'copy-results' && typeof testsApi.copyResults === 'function') {
        result = testsApi.copyResults(payload.scope || 'all');
      }
      broadcastFrontendTestsState();
      if (result && typeof result.then === 'function') {
        result.then(function () {
          broadcastFrontendTestsState();
        }).catch(function () {
          broadcastFrontendTestsState();
        });
      }
    } catch (err) {
      console.warn('[frontend-tests-command]', action, err);
      broadcastFrontendTestsState();
    }
  }

  function handleFocusChanged(event) {
    var p = event && event.payload ? event.payload : {};
    var label = p.label || '';
    var mv = multiviewApi();
    if (mv && mv.lifecycle && typeof mv.lifecycle.touch === 'function') {
      try { mv.lifecycle.touch(label); } catch (_) {}
    }
    if (label.indexOf('board-tab-') !== 0) return;
    // Strip the 'board-tab-' prefix AND the per-shell bootId suffix
    // via boardHost so this code stays correct regardless of whether
    // the label format is `board-tab-<tabId>` (legacy / unit tests
    // without setup) or `board-tab-<bootId>-<tabId>` (production).
    var boardHost = (typeof window !== 'undefined' && window.LexeraBoardHost) || null;
    var tabId = boardHost && typeof boardHost.tabIdFromBoardLabel === 'function'
      ? boardHost.tabIdFromBoardLabel(label)
      : label.substring('board-tab-'.length);
    try {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'lexera-pane-activated', pane: tabId }
      }));
    } catch (_) {}
  }

  function install() {
    var wv = getCurrentWebview();
    if (!wv || typeof wv.listen !== 'function') return false;
    wv.listen('multiview-navigate', handleNavigate);
    wv.listen('multiview-shortcut', handleShortcut);
    wv.listen('focus-changed', handleFocusChanged);
    wv.listen('frontend-tests-command', handleFrontendTestsCommand);
    return true;
  }

  function installWith(runtime) {
    if (!runtime || !runtime.event || typeof runtime.event.listen !== 'function') return false;
    // Prefer webview-scoped listeners for events emitted via emit_to().
    // Due to a Tauri 2 behaviour (see tauri-apps/tauri#11379), runtime.event.listen()
    // with kind:'Any' receives events from ALL windows, including emit_to events
    // targeted at other windows.  wv.listen() scopes to this webview only.
    var wv = getCurrentWebview();
    var useWv = wv && typeof wv.listen === 'function';
    if (useWv) {
      wv.listen('multiview-navigate', handleNavigate);
      wv.listen('multiview-shortcut', handleShortcut);
      wv.listen('frontend-tests-command', handleFrontendTestsCommand);
    } else {
      runtime.event.listen('multiview-navigate', handleNavigate);
      runtime.event.listen('multiview-shortcut', handleShortcut);
      runtime.event.listen('frontend-tests-command', handleFrontendTestsCommand);
    }
    // focus-changed is a true global broadcast (app.emit), so it must use
    // runtime.event.listen().
    runtime.event.listen('focus-changed', handleFocusChanged);
    return true;
  }

  var api = {
    install: install,
    installWith: installWith,
    handleNavigate: handleNavigate,
    handleShortcut: handleShortcut,
    handleFocusChanged: handleFocusChanged,
    handleFrontendTestsCommand: handleFrontendTestsCommand,
    broadcastFrontendTestsState: broadcastFrontendTestsState,
    SHORTCUT_ACTIONS: SHORTCUT_ACTIONS
  };

  if (typeof window !== 'undefined') {
    window.LexeraNavigationBridge = api;
  }
})();
