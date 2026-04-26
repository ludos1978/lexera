(function () {
  'use strict';

  // The shell-side navigation bridge: receives navigation/shortcut/focus
  // events broadcast from sub-app webviews and routes them to the
  // workspace shell or the multiview API.
  //
  // Sub-apps emit:
  //   - 'multiview-navigate' with payload { type, ... } — typically
  //     'open-board' (boardId, options), 'focus-workspace'
  //     (workspaceId), or 'reveal-panel' (panelId).
  //   - 'multiview-shortcut' with payload { action } — keyboard shortcut
  //     forwarded from a board webview because the embedded webview, not
  //     the shell, captured the keystroke.
  //   - 'focus-changed' with payload { label } — a webview gained focus;
  //     the bridge bumps LRU freshness and synthesizes a
  //     `lexera-pane-activated` postMessage for the workspace shell so
  //     pane-activation handling matches the legacy iframe path.
  //
  // No global keydown shortcut is installed here; per
  // `multiviewClient.js`'s prior comment, the main shell window must NOT
  // intercept those events because the legacy kanban code and tests rely
  // on them. Shortcuts only work while a sub-app webview holds focus.

  function tauriRuntime() {
    return (typeof window !== 'undefined' && window.__TAURI__) || null;
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
      } else if (payload.type === 'focus-workspace' && payload.workspaceId && typeof shell.focusWorkspace === 'function') {
        shell.focusWorkspace(payload.workspaceId);
      } else if (payload.type === 'reveal-panel' && payload.panelId && typeof shell.revealPanel === 'function') {
        shell.revealPanel(payload.panelId);
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
      } else if (action === 'run-category' && payload.category && typeof testsApi.runCategory === 'function') {
        result = testsApi.runCategory(payload.category);
      } else if (action === 'clear-results' && typeof testsApi.clearResults === 'function') {
        result = testsApi.clearResults();
      } else if (action === 'clear-category' && payload.category && typeof testsApi.clearCategory === 'function') {
        result = testsApi.clearCategory(payload.category);
      } else if (action === 'stop' && typeof testsApi.stop === 'function') {
        result = testsApi.stop();
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

  // Bridge focus-changed → synthetic 'lexera-pane-activated' message for
  // the workspace shell. When a board webview gains focus, the shell's
  // existing handleWindowMessage handler runs to clear pending focus
  // targets / mark the pane as activated. Also bumps lifecycle freshness
  // so this webview is not the next eviction candidate.
  function handleFocusChanged(event) {
    var p = event && event.payload ? event.payload : {};
    var label = p.label || '';
    var mv = multiviewApi();
    if (mv && mv.lifecycle && typeof mv.lifecycle.touch === 'function') {
      try { mv.lifecycle.touch(label); } catch (_) {}
    }
    var prefix = 'board-tab-';
    if (label.indexOf(prefix) !== 0) return;
    var tabId = label.substring(prefix.length);
    try {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'lexera-pane-activated', pane: tabId }
      }));
    } catch (_) {}
  }

  function install() {
    var t = tauriRuntime();
    if (!t || !t.event || typeof t.event.listen !== 'function') return false;
    t.event.listen('multiview-navigate', handleNavigate);
    t.event.listen('multiview-shortcut', handleShortcut);
    t.event.listen('focus-changed', handleFocusChanged);
    t.event.listen('frontend-tests-command', handleFrontendTestsCommand);
    return true;
  }

  // Test seam: callers can pass a custom event runtime (e.g., a stub
  // exposing `.event.listen`) instead of the global Tauri runtime. The
  // resolvers above for `multiviewApi`/`shellApi` still consult window
  // globals, so unit tests should also stub those when relevant.
  function installWith(runtime) {
    if (!runtime || !runtime.event || typeof runtime.event.listen !== 'function') return false;
    runtime.event.listen('multiview-navigate', handleNavigate);
    runtime.event.listen('multiview-shortcut', handleShortcut);
    runtime.event.listen('focus-changed', handleFocusChanged);
    runtime.event.listen('frontend-tests-command', handleFrontendTestsCommand);
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
