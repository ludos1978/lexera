(function () {
  'use strict';

  function tauriRuntime() {
    return (typeof window !== 'undefined' && window.__TAURI__) || null;
  }

  function getCurrentWebview() {
    var t = tauriRuntime();
    if (!t || !t.webview || typeof t.webview.getCurrentWebview !== 'function') return null;
    try { return t.webview.getCurrentWebview(); } catch (_) { return null; }
  }

  function normalizeWorkspacesPayload(event) {
    var payload = event && event.payload ? event.payload : {};
    return {
      workspaces: Array.isArray(payload.workspaces) ? payload.workspaces.slice() : [],
      defaultWorkspaceId: payload.defaultWorkspaceId || null
    };
  }

  function normalizeBoardMutationPayload(event) {
    var payload = event && event.payload ? event.payload : {};
    return {
      kind: String(payload.kind || ''),
      boardId: payload.boardId || null,
      settings: payload.settings && typeof payload.settings === 'object'
        ? Object.assign({}, payload.settings)
        : null
    };
  }

  function normalizeRenderAppsConfigPayload(event) {
    var payload = event && event.payload ? event.payload : {};
    return {
      values: payload.values && typeof payload.values === 'object'
        ? Object.assign({}, payload.values)
        : {}
    };
  }

  function handleWorkspacesLoaded(event, handlers) {
    var payload = normalizeWorkspacesPayload(event);
    if (!handlers || typeof handlers.onWorkspacesLoaded !== 'function') return false;
    handlers.onWorkspacesLoaded(payload.workspaces, payload.defaultWorkspaceId);
    return true;
  }

  function handleBoardMutation(event, handlers) {
    var payload = normalizeBoardMutationPayload(event);
    if (!handlers) return false;
    if (payload.kind === 'added' && typeof handlers.onBoardAdded === 'function') {
      handlers.onBoardAdded();
      return true;
    }
    if (payload.kind === 'removed' && payload.boardId && typeof handlers.onBoardRemoved === 'function') {
      handlers.onBoardRemoved(payload.boardId);
      return true;
    }
    if (payload.kind === 'settings-saved' && payload.boardId && typeof handlers.onBoardSettingsSaved === 'function') {
      handlers.onBoardSettingsSaved(payload.boardId, payload.settings || {});
      return true;
    }
    return false;
  }

  function handleRenderAppsConfigSaved(event, handlers) {
    var payload = normalizeRenderAppsConfigPayload(event);
    if (!handlers || typeof handlers.onRenderAppsConfigSaved !== 'function') return false;
    handlers.onRenderAppsConfigSaved(payload.values);
    return true;
  }

  function installWith(runtime, handlers) {
    if (!runtime || !runtime.event || typeof runtime.event.listen !== 'function') return false;
    runtime.event.listen('management-workspaces-loaded', function (event) {
      handleWorkspacesLoaded(event, handlers || {});
    });
    runtime.event.listen('management-board-mutation', function (event) {
      handleBoardMutation(event, handlers || {});
    });
    runtime.event.listen('render-apps-config-saved', function (event) {
      handleRenderAppsConfigSaved(event, handlers || {});
    });
    return true;
  }

  function install(handlers) {
    var wv = getCurrentWebview();
    if (!wv || typeof wv.listen !== 'function') return false;
    wv.listen('management-workspaces-loaded', function (event) {
      handleWorkspacesLoaded(event, handlers || {});
    });
    wv.listen('management-board-mutation', function (event) {
      handleBoardMutation(event, handlers || {});
    });
    wv.listen('render-apps-config-saved', function (event) {
      handleRenderAppsConfigSaved(event, handlers || {});
    });
    return true;
  }

  var api = {
    install: install,
    installWith: installWith,
    handleWorkspacesLoaded: handleWorkspacesLoaded,
    handleBoardMutation: handleBoardMutation,
    handleRenderAppsConfigSaved: handleRenderAppsConfigSaved,
    normalizeWorkspacesPayload: normalizeWorkspacesPayload,
    normalizeBoardMutationPayload: normalizeBoardMutationPayload,
    normalizeRenderAppsConfigPayload: normalizeRenderAppsConfigPayload
  };

  if (typeof window !== 'undefined') {
    window.LexeraManagementBridge = api;
  }
})();
