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

  /**
   * @typedef {Object} MultiviewLabelResolver
   *   The narrow surface of `window.LexeraMultiviewWebview` this module
   *   actually uses — pure label resolution. Decoupling lets the
   *   typedef-check focus on this contract instead of the full
   *   multiview API.
   * @property {function(string): string} labelForTabId
   * @property {function(*): string} labelForTab
   */

  /**
   * @typedef {Object} MessageBridgeSetupDeps
   * @property {MultiviewLabelResolver} multiview
   */

  /**
   * @typedef {Object} CatalogSnapshot
   *   The cleaned-up catalog payload `normalizeCatalog` produces. Field
   *   shapes mirror the workspace shell's `state.catalogSnapshot` for
   *   compatibility with the catalog bridge.
   * @property {Array<*>} boards
   * @property {Array<*>} remoteBoards
   * @property {Array<*>} workspaces
   * @property {string} activeWorkspaceId
   * @property {Object|null} activeWorkspace
   * @property {string} viewWorkspaceId
   * @property {Object|null} viewWorkspace
   * @property {('manual'|'follow-active-board')} workspaceViewMode
   */

  /**
   * @typedef {Object} TauriCore
   * @property {function(string, Object=): Promise<*>} invoke
   */

  /** @type {MultiviewLabelResolver|null} */
  var multiview = null;

  /**
   * @param {MessageBridgeSetupDeps} deps
   * @returns {void}
   */
  function setup(deps) {
    if (!deps || !deps.multiview) {
      throw new Error('LexeraMessageBridge.setup requires { multiview }');
    }
    multiview = deps.multiview;
  }

  /**
   * @returns {TauriCore|null}
   */
  function tauriCore() {
    return (window.__TAURI__ && window.__TAURI__.core) || null;
  }

  /**
   * @param {string} tabId
   * @param {string} eventName
   * @param {*} payload
   * @returns {boolean}
   */
  function emitToTabId(tabId, eventName, payload) {
    var core = tauriCore();
    if (!tabId || !core || !multiview) return false;
    core.invoke('multiview_emit_to', {
      target: multiview.labelForTabId(tabId),
      event: eventName,
      payload: payload
    }).catch(function () {});
    return true;
  }

  /**
   * @param {*} tab
   * @param {string} eventName
   * @param {*} payload
   * @returns {boolean}
   */
  function emitToTab(tab, eventName, payload) {
    var core = tauriCore();
    if (!tab || !core || !multiview) return false;
    core.invoke('multiview_emit_to', {
      target: multiview.labelForTab(tab),
      event: eventName,
      payload: payload
    }).catch(function () {});
    return true;
  }

  /**
   * @param {string} eventName
   * @param {*} payload
   * @returns {boolean}
   */
  function broadcast(eventName, payload) {
    var core = tauriCore();
    if (!core) return false;
    core.invoke('multiview_broadcast', {
      event: eventName,
      payload: payload
    }).catch(function () {});
    return true;
  }

  /**
   * @param {string} tabId
   * @param {*} target
   * @param {Object} [options]
   * @returns {boolean}
   */
  function focusHierarchy(tabId, target, options) {
    if (typeof window !== 'undefined' && typeof window.lexeraLog === 'function') {
      try {
        var resolvedLabel = multiview && typeof multiview.labelForTabId === 'function'
          ? multiview.labelForTabId(tabId) : null;
        window.lexeraLog('debug', '[focus-trace] messageBridge.focusHierarchy ' +
          JSON.stringify({
            tabId: tabId,
            targetLabel: resolvedLabel,
            hasTauriCore: !!tauriCore(),
            hasMultiview: !!multiview,
            boardId: target && target.boardId,
            cardId: target && target.cardId
          }));
      } catch (_) { /* non-fatal */ }
    }
    return emitToTabId(tabId, 'focus-hierarchy-target', {
      target: target,
      options: options || {}
    });
  }

  /**
   * @param {*} tab
   * @param {string} action
   * @returns {boolean}
   */
  function boardAction(tab, action) {
    return emitToTab(tab, 'board-action', { action: action });
  }

  /**
   * @param {boolean} active
   * @returns {boolean}
   */
  function layoutDrag(active) {
    return broadcast('layout-drag', { active: !!active });
  }

  /**
   * @param {boolean} connected
   * @returns {boolean}
   */
  function broadcastBackendConnectionState(connected) {
    return broadcast('backend-connection-state', { connected: !!connected });
  }

  /**
   * @param {Partial<CatalogSnapshot>|null|undefined} snapshot
   * @returns {CatalogSnapshot}
   */
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

  /**
   * Global broadcast — every child webview receives the catalog.
   * @param {CatalogSnapshot} snapshot
   * @returns {boolean}
   */
  function broadcastCatalog(snapshot) {
    if (!window.LexeraMultiview || typeof window.LexeraMultiview.broadcastCatalog !== 'function') return false;
    window.LexeraMultiview.broadcastCatalog(snapshot);
    return true;
  }

  /**
   * Targeted catalog send — used when a specific pane just activated
   * and may not have been listening when the last broadcast fired.
   * @param {string} tabId
   * @param {CatalogSnapshot} snapshot
   * @returns {boolean}
   */
  function sendCatalog(tabId, snapshot) {
    return emitToTabId(tabId, 'workspace-catalog', snapshot);
  }

  /**
   * @param {string} tabId
   * @param {string} scope
   * @param {*} ctx
   * @param {number} [timeoutMs]
   * @returns {Promise<*>}
   */
  function requestContextMenu(tabId, scope, ctx, timeoutMs) {
    if (!window.LexeraMultiview || typeof window.LexeraMultiview.request !== 'function') {
      return Promise.reject(new Error('LexeraMultiview.request unavailable'));
    }
    if (!multiview) {
      return Promise.reject(new Error('LexeraMessageBridge.setup not called'));
    }
    return window.LexeraMultiview.request(
      multiview.labelForTabId(tabId),
      'build-context-menu',
      { scope: scope, context: ctx },
      typeof timeoutMs === 'number' ? timeoutMs : 1500
    );
  }

  /**
   * @param {string} tabId
   * @param {string} scope
   * @param {string} action
   * @param {*} context
   * @returns {boolean}
   */
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
