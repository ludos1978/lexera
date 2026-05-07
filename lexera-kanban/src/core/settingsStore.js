/**
 * Lexera Settings Store — centralized, typed access to all localStorage-backed settings.
 *
 * Replaces scattered raw localStorage.getItem/setItem calls with a single API that provides:
 *   - Typed get/set with automatic JSON serialization
 *   - Default values
 *   - Change notifications via LexeraRuntime event bus
 *   - Per-board parameterized keys
 *   - Single source of truth for all storage key names
 *
 * Usage:
 *   var Settings = window.LexeraSettings;
 *   var scale = Settings.get('uiScale');           // returns number, default 1
 *   Settings.set('uiScale', 1.2);                  // persists + emits 'setting:uiScale'
 *   Settings.on('uiScale', function(val) { ... }); // change listener
 *   Settings.getForBoard('cardCollapsed', boardId); // per-board key
 */
var LexeraSettings = (function () {
  'use strict';

  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

  // ── Key Definitions ─────────────────────────────────────────────
  // Each entry: { key: localStorage key, type: 'string'|'boolean'|'number'|'json', default: value }

  var DEFS = {
    // --- Appearance ---
    visualTheme:          { key: 'lexera-visual-theme',           type: 'string',  default: 'classic' },
    theme:                { key: 'lexera-theme',                  type: 'string',  default: 'lexera' },
    uiScale:              { key: 'lexera-ui-scale',               type: 'number',  default: 1 },
    overlayEditorEnabled: { key: 'lexera-overlay-editor-enabled', type: 'boolean', default: true },
    specialCharsVisible:  { key: 'lexera-show-special-characters',type: 'boolean', default: false },

    // --- Sidebar (sidebarSplitRatio, sidebarWidth, hierarchyLocked
    //     moved to WINDOW_DEFS — they are per-window UX state) ---
    sidebarSync:          { key: 'lexera-sidebar-sync',           type: 'boolean', default: false },
    sidebarExpanded:      { key: 'lexera-sidebar-expanded',       type: 'json',    default: [] },
    sidebarTreeState:     { key: 'lexera-sidebar-tree-state',     type: 'json',    default: {} },
    sidebarTreeDisplay:   { key: 'lexera-sidebar-tree-display',   type: 'json',    default: {} },

    // --- Header & Search ---
    headerSearchExpanded: { key: 'lexera-header-search-expanded', type: 'boolean', default: false },

    // --- Navigation ---
    // activeWorkspace removed: was a global key whose `setItem` fired
    // a `storage` event in sibling windows and yanked them to the
    // same workspace. Active workspace is now per-window in-memory
    // only, sourced from URL `?workspace=<id>` + the catalog's
    // default-picker (commits 93c81a22 / 83dff022 / 96758e21 /
    // 82417477 dropped the writes + cold-start read; this entry
    // removal closes the loop so the def can't be revived without
    // re-introducing the leak).

    // --- Dashboard (state moved to WINDOW_DEFS — query / scope /
    //     pinned / tags / collapsed are per-window UX state) ---

    // --- Board ordering ---
    boardOrder:           { key: 'lexera-board-order',            type: 'json',    default: [] },

    // --- Editor ---
    cardEditorMode:       { key: 'lexera-card-editor-mode',       type: 'string',  default: 'dual' },
    cardEditorFontScale:  { key: 'lexera-card-editor-font-scale', type: 'number',  default: 1 },

    // --- Tag styling ---
    tagColorOverrides:    { key: 'lexera-tag-color-overrides',    type: 'json',    default: {} },
    tagStyleConfig:       { key: 'lexera-tag-style-config',       type: 'json',    default: {} },

    // --- Layout ---
    layoutPresets:        { key: 'lexera-layout-presets',         type: 'json',    default: {} },
    dockPanel:            { key: 'lexera-dock-panel',             type: 'string',  default: '' },

    // --- Logging (filters moved to WINDOW_DEFS — log panel state is
    //     per-window UX, not a global setting) ---

    // --- Custom URLs ---
    mermaidUrl:           { key: 'lexera-mermaid-url',            type: 'string',  default: '' },

    // --- PDF preview view-mode (single global preference set from the
    //     embed burger menu). Valid values: 'scrolled' | 'overview'
    //     | 'stacked'. Anything else is treated as 'scrolled' by the
    //     consumer. Stored as a string so the existing settings-store
    //     migration path applies. ---
    pdfViewMode:          { key: 'lexera-pdf-view-mode',          type: 'string',  default: 'scrolled' }
  };

  // Per-board key templates: the {boardId} placeholder is replaced at runtime
  var BOARD_DEFS = {
    cardCollapsed:  { key: 'lexera-card-collapsed:{boardId}',  type: 'json',   default: [] },
    boardDraft:     { key: 'lexera-board-draft:{boardId}',     type: 'json',   default: null },
    scrollSpeed:    { key: 'lexera-board-scroll-speed:{boardId}', type: 'string', default: '1' },
    zoomSpeed:      { key: 'lexera-board-zoom-speed:{boardId}',   type: 'string', default: '0.06' }
  };

  // Scoped key templates
  var SCOPED_DEFS = {
    tagGroups: { key: 'lexera-tag-groups-{scope}', type: 'json', default: [] }
  };

  // Per-window key templates: the {windowScope} placeholder is filled
  // at runtime by `_resolveWindowScope()` — workspace id from the
  // `?workspace=` URL param when set (so two windows pinned to the
  // same workspace share state), otherwise window label from
  // `?windowLabel=` so detached panel-only windows and the boot main
  // window before catalog hydrate stay isolated.
  //
  // Use these for any UI state that's truly per-window (sidebar size,
  // dashboard query, log panel filters, …). Storing such keys in DEFS
  // would write a single global localStorage entry that fires a
  // `storage` event in every other open window — Tauri uses one
  // shared cookie/storage origin, so cross-window leaks are silent
  // and surprising.
  var WINDOW_DEFS = {
    // --- Sidebar (per-window: each workspace remembers its own size,
    //     each detached window keeps its own preference) ---
    sidebarSplitRatio: { key: 'lexera-sidebar-split-ratio:{windowScope}', type: 'number',  default: 0.2 },
    sidebarWidth:      { key: 'lexera-sidebar-width:{windowScope}',       type: 'number',  default: 220 },
    hierarchyLocked:   { key: 'lexera-hierarchy-locked:{windowScope}',    type: 'boolean', default: false },

    // --- Dashboard (per-window: each workspace keeps its own search /
    //     scope / pinned queries / collapsed state; two windows on
    //     the same workspace share state, last save wins) ---
    dashboardQuery:         { key: 'lexera-dashboard-query:{windowScope}',          type: 'string', default: '' },
    dashboardScope:         { key: 'lexera-dashboard-scope:{windowScope}',          type: 'string', default: '' },
    dashboardActivePinned:  { key: 'lexera-dashboard-active-pinned:{windowScope}',  type: 'string', default: '' },
    dashboardPinnedQueries: { key: 'lexera-dashboard-pinned-queries:{windowScope}', type: 'json',   default: [] },
    dashboardTags:          { key: 'lexera-dashboard-tags:{windowScope}',           type: 'json',   default: [] },
    dashboardCollapsed:     { key: 'lexera-dashboard-collapsed:{windowScope}',      type: 'json',   default: {} },

    // --- Logging (per-window: each window keeps its own log panel
    //     filter state). Categories / levels store comma-separated
    //     ids; `null` default means "all on" so a missing key
    //     differs from a stored empty string ("none on"). ---
    logSource:     { key: 'lexera-log-source:{windowScope}',     type: 'string', default: '' },
    logCategories: { key: 'lexera-log-categories:{windowScope}', type: 'string', default: null },
    logLevels:     { key: 'lexera-log-levels:{windowScope}',     type: 'string', default: null },
    logSearch:     { key: 'lexera-log-search:{windowScope}',     type: 'string', default: '' }
  };

  function _resolveWindowScope() {
    try {
      var params = new URLSearchParams(
        (typeof window !== 'undefined' && window.location && window.location.search) || ''
      );
      var workspace = params.get('workspace');
      if (workspace) return 'ws:' + workspace;
      var label = params.get('windowLabel');
      if (label) return 'wl:' + label;
    } catch (_) {
      // URLSearchParams unavailable or location inaccessible — fall through.
    }
    return 'wl:main';
  }

  // ── Change listeners ────────────────────────────────────────────
  var _listeners = {};

  function _notify(name, value) {
    var fns = _listeners[name];
    if (fns) {
      for (var i = 0; i < fns.length; i++) {
        try { fns[i](value); } catch (e) {
          if (typeof console !== 'undefined') console.error('[LexeraSettings] listener error for ' + name + ':', e);
        }
      }
    }
    if (_rt) _rt.emit('setting:' + name, value);
  }

  // ── Core read/write ─────────────────────────────────────────────

  function _read(storageKey, type, fallback) {
    try {
      var raw = localStorage.getItem(storageKey);
      if (raw === null || raw === undefined) return fallback;

      if (type === 'boolean') return raw === 'true';
      if (type === 'number') {
        var n = parseFloat(raw);
        return isNaN(n) ? fallback : n;
      }
      if (type === 'json') {
        return JSON.parse(raw);
      }
      return raw; // string
    } catch (e) {
      return fallback;
    }
  }

  function _write(storageKey, type, value) {
    try {
      if (value === null || value === undefined) {
        localStorage.removeItem(storageKey);
      } else if (type === 'json') {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } else {
        localStorage.setItem(storageKey, String(value));
      }
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[LexeraSettings] write failed for ' + storageKey + ':', e);
    }
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Get a setting value by name.
   * @param {string} name - Setting name (e.g. 'uiScale', 'visualTheme')
   * @returns {*} The setting value, or its default if not stored
   */
  function get(name) {
    var def = DEFS[name];
    if (!def) return undefined;
    return _read(def.key, def.type, def.default);
  }

  /**
   * Set a setting value by name. Persists to localStorage and notifies listeners.
   * @param {string} name - Setting name
   * @param {*} value - The value to store
   */
  function set(name, value) {
    var def = DEFS[name];
    if (!def) return;
    _write(def.key, def.type, value);
    _notify(name, value);
  }

  /**
   * Get a per-board setting.
   * @param {string} name - Board setting name (e.g. 'cardCollapsed')
   * @param {string} boardId - The board ID
   * @returns {*} The value or default
   */
  function getForBoard(name, boardId) {
    var def = BOARD_DEFS[name];
    if (!def || !boardId) return def ? def.default : undefined;
    var storageKey = def.key.replace('{boardId}', boardId);
    return _read(storageKey, def.type, def.default);
  }

  /**
   * Set a per-board setting.
   */
  function setForBoard(name, boardId, value) {
    var def = BOARD_DEFS[name];
    if (!def || !boardId) return;
    var storageKey = def.key.replace('{boardId}', boardId);
    _write(storageKey, def.type, value);
    _notify(name + ':' + boardId, value);
  }

  /**
   * Remove a per-board setting (e.g. when board is deleted).
   */
  function removeForBoard(name, boardId) {
    var def = BOARD_DEFS[name];
    if (!def || !boardId) return;
    var storageKey = def.key.replace('{boardId}', boardId);
    try { localStorage.removeItem(storageKey); } catch (e) { /* ignore */ }
  }

  /**
   * Get a per-window setting. Scope is auto-resolved from the
   * `?workspace=` URL param (preferred — windows on the same workspace
   * share state) or the `?windowLabel=` URL param (fallback — windows
   * with no workspace stay isolated).
   */
  function getForWindow(name) {
    var def = WINDOW_DEFS[name];
    if (!def) return undefined;
    var storageKey = def.key.replace('{windowScope}', _resolveWindowScope());
    return _read(storageKey, def.type, def.default);
  }

  /**
   * Set a per-window setting. See `getForWindow` for scope rules.
   */
  function setForWindow(name, value) {
    var def = WINDOW_DEFS[name];
    if (!def) return;
    var storageKey = def.key.replace('{windowScope}', _resolveWindowScope());
    _write(storageKey, def.type, value);
    _notify(name, value);
  }

  /**
   * Remove a per-window setting (current scope only).
   */
  function removeForWindow(name) {
    var def = WINDOW_DEFS[name];
    if (!def) return;
    var storageKey = def.key.replace('{windowScope}', _resolveWindowScope());
    try { localStorage.removeItem(storageKey); } catch (e) { /* ignore */ }
  }

  /**
   * Get a scoped setting (e.g. tag groups per scope).
   */
  function getScoped(name, scope) {
    var def = SCOPED_DEFS[name];
    if (!def || !scope) return def ? def.default : undefined;
    var storageKey = def.key.replace('{scope}', scope);
    return _read(storageKey, def.type, def.default);
  }

  /**
   * Set a scoped setting.
   */
  function setScoped(name, scope, value) {
    var def = SCOPED_DEFS[name];
    if (!def || !scope) return;
    var storageKey = def.key.replace('{scope}', scope);
    _write(storageKey, def.type, value);
  }

  /**
   * Subscribe to changes on a setting.
   * @returns {function} Unsubscribe function
   */
  function on(name, fn) {
    if (!_listeners[name]) _listeners[name] = [];
    _listeners[name].push(fn);
    return function unsubscribe() {
      var arr = _listeners[name];
      var idx = arr ? arr.indexOf(fn) : -1;
      if (idx !== -1) arr.splice(idx, 1);
    };
  }

  /**
   * Get the raw localStorage key for a setting (for debugging/migration).
   */
  function keyOf(name) {
    var def = DEFS[name] || BOARD_DEFS[name] || SCOPED_DEFS[name] || WINDOW_DEFS[name];
    return def ? def.key : null;
  }

  /**
   * Get all defined setting names.
   */
  function allKeys() {
    return Object.keys(DEFS);
  }

  /**
   * Get the definition object for a setting.
   */
  function defOf(name) {
    return DEFS[name] || BOARD_DEFS[name] || SCOPED_DEFS[name] || WINDOW_DEFS[name] || null;
  }

  return {
    get: get,
    set: set,
    getForBoard: getForBoard,
    setForBoard: setForBoard,
    removeForBoard: removeForBoard,
    getScoped: getScoped,
    setScoped: setScoped,
    getForWindow: getForWindow,
    setForWindow: setForWindow,
    removeForWindow: removeForWindow,
    on: on,
    keyOf: keyOf,
    allKeys: allKeys,
    defOf: defOf,
    DEFS: DEFS,
    BOARD_DEFS: BOARD_DEFS,
    SCOPED_DEFS: SCOPED_DEFS,
    WINDOW_DEFS: WINDOW_DEFS
  };
})();
if (typeof globalThis !== 'undefined') globalThis.LexeraSettings = LexeraSettings;
if (typeof window !== 'undefined') window.LexeraSettings = LexeraSettings;
