// Settings runtime — shared scaffolding for settings sub-apps.
//
// The legacy in-shell settings panels were hydrated by `settings/frontendSettings.js`,
// `lexera-shared/management.js`, etc., reading/writing settings via:
//   - localStorage (`lexera-default-*` keys for frontend prefs)
//   - the backend REST API (for backendSettings, renderApps, files)
//
// Settings sub-apps now run in their own child webview. They reload the
// SAME settings modules and SAME localStorage / REST API, so persisted
// state is always shared with the rest of the app. What changes is the
// shell-side options object — instead of being constructed in app.js with
// dozens of closures over shell globals, it's reconstructed here from
// localStorage and broadcast helpers.
//
// Live-apply of board-impacting settings (visual theme, UI scale, tag
// visibility) is delivered via the multiview event bus: this runtime
// broadcasts `frontend-setting-changed` events; the board webviews
// listen and apply.
//
// Exposed: `window.LexeraSettingsRuntime`.

(function () {
  'use strict';

  function getLs(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (_) { return fallback; }
  }

  function setLs(key, value) {
    try { localStorage.setItem(key, String(value == null ? '' : value)); }
    catch (_) { /* localStorage unavailable */ }
  }

  function broadcast(event, payload) {
    if (typeof window === 'undefined' || !window.__TAURI__ || !window.__TAURI__.core) return;
    try {
      window.__TAURI__.core.invoke('multiview_broadcast', {
        event: event, payload: payload || {}
      }).catch(function () {});
    } catch (_) { /* offline */ }
  }

  // Visual themes registry — the legacy shell populated this from
  // `visualThemes.js`, including user-installed themes discovered on disk.
  // Child settings views now reload that same registry when it is present,
  // but still fall back to a minimal list in plain browser/test contexts.
  var DEFAULT_VISUAL_THEMES = [
    { id: 'classic', name: 'No style' }
  ];

  function getVisualThemes() {
    if (typeof window !== 'undefined' &&
        Array.isArray(window.LEXERA_VISUAL_THEMES) &&
        window.LEXERA_VISUAL_THEMES.length) {
      return window.LEXERA_VISUAL_THEMES.slice();
    }
    return DEFAULT_VISUAL_THEMES.slice();
  }

  function getCurrentVisualThemeId() {
    if (typeof window !== 'undefined' &&
        typeof window.getLexeraCurrentVisualThemeId === 'function') {
      try {
        var current = window.getLexeraCurrentVisualThemeId();
        if (current) return String(current);
      } catch (_) { /* ignore theme bridge errors */ }
    }
    return getLs('lexera-visual-theme', 'classic');
  }

  function applyVisualTheme(id) {
    var nextId = String(id || 'classic');
    if (typeof window !== 'undefined' &&
        typeof window.applyLexeraVisualTheme === 'function') {
      try {
        var applied = window.applyLexeraVisualTheme(nextId);
        if (applied && applied.id) nextId = String(applied.id);
      } catch (_) { /* ignore theme bridge errors */ }
    }
    setLs('lexera-visual-theme', nextId);
    broadcast('frontend-setting-changed', { setting: 'visualTheme', value: nextId });
  }

  function resolveContextMenuBuilders() {
    if (typeof window !== 'undefined' && window.ContextMenuBuilders) {
      return window.ContextMenuBuilders;
    }
    if (typeof ContextMenuBuilders !== 'undefined') {
      return ContextMenuBuilders;
    }
    return null;
  }

  function buildFrontendSettingsOptions() {
    return {
      getOptions: function () { return buildFrontendSettingsOptions(); },

      // ── Visual theme ─────────────────────────────────────────────
      getVisualThemes: getVisualThemes,
      getCurrentVisualThemeId: getCurrentVisualThemeId,
      applyVisualTheme: applyVisualTheme,

      // ── UI scale ─────────────────────────────────────────────────
      getUiScale: function () { return parseFloat(getLs('lexera-ui-scale', '1')) || 1; },
      applyUiScale: function (v) {
        var num = parseFloat(v) || 1;
        setLs('lexera-ui-scale', num);
        broadcast('frontend-setting-changed', { setting: 'uiScale', value: num });
      },

      // ── Scroll/zoom speed ────────────────────────────────────────
      getScrollSpeed: function () { return getLs('lexera-default-scrollSpeed', '1'); },
      setScrollSpeed: function (v) {
        setLs('lexera-default-scrollSpeed', v);
        broadcast('frontend-setting-changed', { setting: 'scrollSpeed', value: v });
      },
      getZoomSpeed: function () { return getLs('lexera-default-zoomSpeed', '0.06'); },
      setZoomSpeed: function (v) {
        setLs('lexera-default-zoomSpeed', v);
        broadcast('frontend-setting-changed', { setting: 'zoomSpeed', value: v });
      },

      // ── Display ──────────────────────────────────────────────────
      getTagVisibility: function () { return getLs('lexera-default-tagVisibility', 'allexcludinglayout'); },
      setTagVisibility: function (v) {
        setLs('lexera-default-tagVisibility', v);
        broadcast('frontend-setting-changed', { setting: 'tagVisibility', value: v });
      },
      getHtmlCommentMode: function () { return getLs('lexera-default-htmlCommentRenderMode', 'hidden'); },
      setHtmlCommentMode: function (v) {
        setLs('lexera-default-htmlCommentRenderMode', v);
        broadcast('frontend-setting-changed', { setting: 'htmlCommentRenderMode', value: v });
      },
      getHtmlContentMode: function () { return getLs('lexera-default-htmlContentRenderMode', 'html'); },
      setHtmlContentMode: function (v) {
        setLs('lexera-default-htmlContentRenderMode', v);
        broadcast('frontend-setting-changed', { setting: 'htmlContentRenderMode', value: v });
      },

      // ── Sidebar display options ─────────────────────────────────
      getSidebarDisplayOptions: function () {
        return {
          counts: getLs('lexera-sidebar-counts', '1') === '1',
          presence: getLs('lexera-sidebar-presence', '1') === '1',
          grips: getLs('lexera-sidebar-grips', '1') === '1',
          menus: getLs('lexera-sidebar-menus', '1') === '1'
        };
      },
      applySidebarDisplayOptions: function (opts) {
        if (!opts) return;
        if (typeof opts.counts === 'boolean') setLs('lexera-sidebar-counts', opts.counts ? '1' : '0');
        if (typeof opts.presence === 'boolean') setLs('lexera-sidebar-presence', opts.presence ? '1' : '0');
        if (typeof opts.grips === 'boolean') setLs('lexera-sidebar-grips', opts.grips ? '1' : '0');
        if (typeof opts.menus === 'boolean') setLs('lexera-sidebar-menus', opts.menus ? '1' : '0');
        broadcast('frontend-setting-changed', { setting: 'sidebarDisplayOptions', value: opts });
      },

      // ── Editor toggles ──────────────────────────────────────────
      isOverlayEditorEnabled: function () { return getLs('lexera-overlay-editor', '0') === '1'; },
      setOverlayEditorEnabled: function (v) {
        setLs('lexera-overlay-editor', v ? '1' : '0');
        broadcast('frontend-setting-changed', { setting: 'overlayEditor', value: !!v });
      },
      isSpecialCharactersVisible: function () { return getLs('lexera-special-chars', '0') === '1'; },
      setSpecialCharactersVisible: function (v) {
        setLs('lexera-special-chars', v ? '1' : '0');
        broadcast('frontend-setting-changed', { setting: 'specialCharacters', value: !!v });
      },

      // ── Remaining shell-only hooks ──────────────────────────────
      // These were closures over shell-side state in the legacy path.
      // Returning safe no-ops keeps frontendSettings.init() compatible.
      syncMenuCheckStates: function () {},
      getContextMenuBuilders: resolveContextMenuBuilders,
      revealPanel: null,
      showFallbackMenu: function () {}
    };
  }

  // ── Backend API adapter for `lexera-shared/management.js` ─────────
  //
  // The legacy in-shell management UI (consumed by `backendSettings`,
  // `files`, etc.) was wired with an `mgmtApiAdapter` that delegated to
  // `LexeraApi.request(path, options)`. Inside a sub-app webview the
  // same pattern works: `api.js` exposes `window.LexeraApi`, which talks
  // to the backend via Tauri IPC (`backend_ipc_request`) or HTTP loopback.
  // This helper returns the same adapter shape ManagementUI.init expects.
  function buildBackendApiAdapter() {
    var api = window.LexeraApi;
    if (!api || typeof api.request !== 'function') {
      throw new Error('LexeraSettingsRuntime.buildBackendApiAdapter requires window.LexeraApi (load api.js)');
    }
    function jsonReq(method, path, body) {
      return api.request(path, {
        method: method,
        headers: body == null ? undefined : { 'Content-Type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body)
      });
    }
    return {
      get: function (path, options) { return api.request(path, options); },
      post: function (path, body) { return jsonReq('POST', path, body); },
      put: function (path, body) { return jsonReq('PUT', path, body); },
      delete: function (path) { return api.request(path, { method: 'DELETE' }); }
    };
  }

  // Minimal callbacks for ManagementUI mounted inside a sub-app. Most
  // shell-side hooks (poll, board mutations, notify, etc.) are no-ops or
  // delegated to the multiview event bus. The active board webview will
  // see backend mutations through its own polling cycle, so live-apply
  // doesn't need to be wired through these callbacks.
  function buildBackendCallbacks() {
    return {
      openLogStream: function () { return null; },
      onNotify: function (msg) {
        try { console.log('[settings]', msg); } catch (_) {}
      },
      onWorkspacesLoaded: function () {},
      onConfirm: function (msg) {
        try { return Promise.resolve(window.confirm(String(msg || ''))); }
        catch (_) { return Promise.resolve(false); }
      },
      onBoardAdded: function () {
        broadcast('management-board-mutation', { kind: 'added' });
      },
      onBoardRemoved: function (boardId) {
        broadcast('management-board-mutation', { kind: 'removed', boardId: boardId });
      },
      onBoardSettingsSaved: function (boardId, settings) {
        broadcast('management-board-mutation', { kind: 'settings-saved', boardId: boardId, settings: settings });
      },
      onServerRestarted: function () {
        broadcast('management-server-restarted', {});
      }
    };
  }

  if (typeof window !== 'undefined') {
    window.LexeraSettingsRuntime = {
      buildFrontendSettingsOptions: buildFrontendSettingsOptions,
      buildBackendApiAdapter: buildBackendApiAdapter,
      buildBackendCallbacks: buildBackendCallbacks,
      broadcast: broadcast,
      getLs: getLs,
      setLs: setLs
    };
  }
})();
