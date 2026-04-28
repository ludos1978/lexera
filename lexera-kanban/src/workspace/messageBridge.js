/**
 * LexeraMessageBridge
 *
 * Shell ↔ board-webview IPC. All messages between the workspace shell
 * and embedded board sub-apps go through this module. The shell calls
 * these methods; inbound messages are routed by handleWindowMessage in
 * the shell (Tauri events from boards are listened to elsewhere).
 *
 * Setup contract:
 *   LexeraMessageBridge.setup({ multiview });
 *   // multiview is window.LexeraMultiviewWebview, used for label
 *   // resolution.
 *
 * Public API:
 *   focusHierarchy(tabId, target, options)
 *   boardAction(tab, action)
 *   layoutDrag(active)
 *   broadcastCatalog(snapshot)
 *   sendCatalog(tabId, snapshot)
 *   normalizeCatalog(rawSnapshot)
 *   requestContextMenu(tabId, scope, ctx, timeoutMs) → Promise
 *   dispatchAction(tabId, scope, action, context)
 */
(function () {
  'use strict';

  var multiview = null;

  function setup(deps) {
    if (!deps || !deps.multiview) {
      throw new Error('LexeraMessageBridge.setup requires { multiview }');
    }
    multiview = deps.multiview;
  }

  function tauriCore() {
    return (window.__TAURI__ && window.__TAURI__.core) || null;
  }

  function emitToTabId(tabId, eventName, payload) {
    var core = tauriCore();
    if (!tabId || !core) return false;
    core.invoke('multiview_emit_to', {
      target: multiview.labelForTabId(tabId),
      event: eventName,
      payload: payload
    }).catch(function () {});
    return true;
  }

  function emitToTab(tab, eventName, payload) {
    var core = tauriCore();
    if (!tab || !core) return false;
    core.invoke('multiview_emit_to', {
      target: multiview.labelForTab(tab),
      event: eventName,
      payload: payload
    }).catch(function () {});
    return true;
  }

  function broadcast(eventName, payload) {
    var core = tauriCore();
    if (!core) return false;
    core.invoke('multiview_broadcast', {
      event: eventName,
      payload: payload
    }).catch(function () {});
    return true;
  }

  function focusHierarchy(tabId, target, options) {
    return emitToTabId(tabId, 'focus-hierarchy-target', {
      target: target,
      options: options || {}
    });
  }

  function boardAction(tab, action) {
    return emitToTab(tab, 'board-action', { action: action });
  }

  function layoutDrag(active) {
    return broadcast('layout-drag', { active: !!active });
  }

  function broadcastBackendConnectionState(connected) {
    return broadcast('backend-connection-state', { connected: !!connected });
  }

  function normalizeCatalog(snapshot) {
    snapshot = snapshot || {};
    return {
      boards: Array.isArray(snapshot.boards) ? snapshot.boards.slice() : [],
      remoteBoards: Array.isArray(snapshot.remoteBoards) ? snapshot.remoteBoards.slice() : [],
      workspaces: Array.isArray(snapshot.workspaces) ? snapshot.workspaces.slice() : [],
      activeWorkspaceId: String(snapshot.activeWorkspaceId || ''),
      activeWorkspace: snapshot.activeWorkspace && typeof snapshot.activeWorkspace === 'object'
        ? Object.assign({}, snapshot.activeWorkspace)
        : null,
      viewWorkspaceId: String(snapshot.viewWorkspaceId || ''),
      viewWorkspace: snapshot.viewWorkspace && typeof snapshot.viewWorkspace === 'object'
        ? Object.assign({}, snapshot.viewWorkspace)
        : null,
      workspaceViewMode: snapshot.workspaceViewMode === 'manual' ? 'manual' : 'follow-active-board'
    };
  }

  // Global broadcast — every child webview receives the catalog.
  function broadcastCatalog(snapshot) {
    if (!window.LexeraMultiview || typeof window.LexeraMultiview.broadcastCatalog !== 'function') return false;
    window.LexeraMultiview.broadcastCatalog(snapshot);
    return true;
  }

  // Targeted catalog send — used when a specific pane just activated
  // and may not have been listening when the last broadcast fired.
  function sendCatalog(tabId, snapshot) {
    return emitToTabId(tabId, 'workspace-catalog', snapshot);
  }

  function requestContextMenu(tabId, scope, ctx, timeoutMs) {
    if (!window.LexeraMultiview || typeof window.LexeraMultiview.request !== 'function') {
      return Promise.reject(new Error('LexeraMultiview.request unavailable'));
    }
    return window.LexeraMultiview.request(
      multiview.labelForTabId(tabId),
      'build-context-menu',
      { scope: scope, context: ctx },
      typeof timeoutMs === 'number' ? timeoutMs : 1500
    );
  }

  function dispatchAction(tabId, scope, action, context) {
    return emitToTabId(tabId, 'dispatch-action', {
      scope: scope, action: action, context: context
    });
  }

  window.LexeraMessageBridge = {
    setup: setup,
    focusHierarchy: focusHierarchy,
    boardAction: boardAction,
    layoutDrag: layoutDrag,
    broadcastBackendConnectionState: broadcastBackendConnectionState,
    broadcastCatalog: broadcastCatalog,
    sendCatalog: sendCatalog,
    normalizeCatalog: normalizeCatalog,
    requestContextMenu: requestContextMenu,
    dispatchAction: dispatchAction
  };
})();
