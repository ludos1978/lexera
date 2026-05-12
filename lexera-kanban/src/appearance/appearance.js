/**
 * LexeraAppearance — Appearance settings extracted from LexeraDashboard.
 *
 * Provides: theme application, visual themes, sidebar tree display options,
 * UI scale, overlay editor toggle, special characters visibility,
 * Marp settings, and menu check-state sync.
 *
 * IIFE module — no const/let, no ES imports.
 */
var LexeraAppearance = (function () {
  'use strict';

  var Settings = typeof LexeraSettings !== 'undefined' ? LexeraSettings : null;

  // --- Dependencies (injected via init) ---
  var _deps = {};

  function _dep(name) {
    return _deps[name];
  }

  function _callDep(name) {
    var fn = _deps[name];
    if (typeof fn === 'function') return fn.apply(null, Array.prototype.slice.call(arguments, 1));
    return undefined;
  }

  // ─── Themes ───────────────────────────────────────────────────────────

  var THEMES = (typeof LEXERA_THEMES !== 'undefined') ? LEXERA_THEMES : [];
  var VISUAL_THEMES = (typeof LEXERA_VISUAL_THEMES !== 'undefined') ? LEXERA_VISUAL_THEMES : [
    { id: 'warm-paper', name: 'Warm Paper', description: 'Lexera warm-paper board appearance' },
    { id: 'no-style', name: 'No style', description: 'Do not apply visual theme overrides' }
  ];
  var VISUAL_THEME_LABELS = (typeof LEXERA_VISUAL_THEME_LABELS !== 'undefined') ? LEXERA_VISUAL_THEME_LABELS : {};

  function rebuildVisualThemeLabels() {
    var keys = Object.keys(VISUAL_THEME_LABELS);
    var idx;
    for (idx = 0; idx < keys.length; idx++) delete VISUAL_THEME_LABELS[keys[idx]];
    for (idx = 0; idx < VISUAL_THEMES.length; idx++) {
      VISUAL_THEME_LABELS[VISUAL_THEMES[idx].id] = VISUAL_THEMES[idx].name;
    }
  }
  rebuildVisualThemeLabels();

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('lexera-visual-themes-changed', function () {
      rebuildVisualThemeLabels();
      _callDep('renderFrontendSettingsPanel');
    });
  }

  function applyVisualTheme(themeId) {
    if (typeof applyLexeraVisualTheme === 'function') {
      return applyLexeraVisualTheme(themeId);
    }
    return null;
  }

  // ─── Sidebar tree display options ─────────────────────────────────────

  var SIDEBAR_TREE_DISPLAY_OPTIONS = {
    counts: true,
    presence: true
  };

  function applySidebarTreeDisplayOptions() {
    var root = document && document.documentElement ? document.documentElement : null;
    if (root) {
      root.setAttribute('data-sidebar-tree-counts', 'on');
      root.setAttribute('data-sidebar-tree-presence', 'on');
      root.removeAttribute('data-sidebar-tree-grips');
      root.removeAttribute('data-sidebar-tree-menus');
    }
    _callDep('renderFrontendSettingsPanel');
    return getSidebarTreeDisplayOptions();
  }

  function getSidebarTreeDisplayOptions() {
    return {
      counts: SIDEBAR_TREE_DISPLAY_OPTIONS.counts,
      presence: SIDEBAR_TREE_DISPLAY_OPTIONS.presence
    };
  }

  function toggleSidebarTreeDisplayOption() {
    return applySidebarTreeDisplayOptions();
  }

  function buildSidebarHierarchyDisplayMenuItems() {
    return [];
  }

  // Apply initial sidebar tree display options
  applySidebarTreeDisplayOptions();

  // ─── Theme application ────────────────────────────────────────────────

  function applyTheme(themeId) {
    try {
      if (Settings) Settings.set('theme', 'lexera');
      else localStorage.removeItem('lexera-theme');
    } catch (err) {
      /* ignore legacy storage cleanup failures */
    }
    _callDep('applyBoardSettings');
    _callDep('renderFrontendSettingsPanel');
  }

  // Re-apply the active visual theme on OS light/dark switch. The legacy
  // palette writer is intentionally not used here; visual themes own the
  // appearance tokens now.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    var visualTheme = (typeof getLexeraCurrentVisualThemeId === 'function' && getLexeraCurrentVisualThemeId()) ||
      (Settings ? Settings.get('visualTheme') : localStorage.getItem('lexera-visual-theme')) || 'warm-paper';
    applyVisualTheme(visualTheme);
  });

  // ─── UI scale ─────────────────────────────────────────────────────────

  var _uiScale = 1;

  function normalizeUiScale(value) {
    var parsed = parseFloat(value);
    if (!isFinite(parsed)) return 1;
    if (parsed < 0.75) return 0.75;
    if (parsed > 1.5) return 1.5;
    return Math.round(parsed * 10000) / 10000;
  }

  function applyUiScale(scale) {
    var normalized = normalizeUiScale(scale);
    _uiScale = normalized;
    document.documentElement.style.setProperty('--ui-scale', String(normalized));
    if (Settings) {
      Settings.set('uiScale', normalized);
    } else {
      localStorage.setItem('lexera-ui-scale', String(normalized));
    }
  }

  function getUiScale() {
    return _uiScale;
  }

  function getUiScalePercentLabel() {
    return Math.round(_uiScale * 100) + '%';
  }

  function nudgeUiScale(delta) {
    var next = normalizeUiScale(_uiScale + delta);
    if (next === _uiScale) return false;
    applyUiScale(next);
    _callDep('showNotification', 'Zoom ' + getUiScalePercentLabel());
    return true;
  }

  // ─── Editor toggles ──────────────────────────────────────────────────

  function isOverlayEditorEnabled() {
    if (Settings) return Settings.get('overlayEditorEnabled');
    return localStorage.getItem('lexera-overlay-editor-enabled') !== 'false';
  }

  function setOverlayEditorEnabled(enabled) {
    if (Settings) {
      Settings.set('overlayEditorEnabled', !!enabled);
    } else {
      localStorage.setItem('lexera-overlay-editor-enabled', enabled ? 'true' : 'false');
    }
    if (!enabled) {
      var CardEditorModule = _dep('CardEditorModule');
      if (CardEditorModule && CardEditorModule.getCurrentCardEditor()) {
        _callDep('closeCardEditorOverlay', { save: true });
      }
    }
    _callDep('renderFrontendSettingsPanel');
  }

  // ─── Special characters visibility ────────────────────────────────────

  function isSpecialCharactersVisible() {
    if (Settings) return Settings.get('specialCharsVisible');
    return localStorage.getItem('lexera-show-special-characters') === 'true';
  }

  function applySpecialCharactersVisibilitySetting() {
    document.body.classList.toggle('show-special-characters', isSpecialCharactersVisible());
  }

  function setSpecialCharactersVisible(enabled) {
    if (Settings) {
      Settings.set('specialCharsVisible', !!enabled);
    } else {
      localStorage.setItem('lexera-show-special-characters', enabled ? 'true' : 'false');
    }
    applySpecialCharactersVisibilitySetting();
    _callDep('renderFrontendSettingsPanel');
  }

  // ─── Menu check states ────────────────────────────────────────────────

  /** Sync all View toggle check states to the native OS menu bar. */
  function syncMenuCheckStates() {
    if (!_dep('hasTauri')) return;
    var states = {
      'view-special-chars': isSpecialCharactersVisible(),
      'view-overlay-editor': isOverlayEditorEnabled()
    };
    Object.keys(states).forEach(function (id) {
      _callDep('tauriInvoke', 'set_menu_check_state', { id: id, checked: states[id] });
    });
  }

  // ─── Boot-time apply ──────────────────────────────────────────────────

  function applyInitialSettings() {
    var visualTheme = Settings ? Settings.get('visualTheme') : (localStorage.getItem('lexera-visual-theme') || 'warm-paper');
    var uiScaleRaw = Settings ? Settings.get('uiScale') : (localStorage.getItem('lexera-ui-scale') || '0.95');
    applyVisualTheme(visualTheme);
    _uiScale = normalizeUiScale(uiScaleRaw);
    applyUiScale(_uiScale);
    applySpecialCharactersVisibilitySetting();
  }

  // ─── init ─────────────────────────────────────────────────────────────

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────

  return {
    init: init,
    // Themes
    THEMES: THEMES,
    VISUAL_THEMES: VISUAL_THEMES,
    VISUAL_THEME_LABELS: VISUAL_THEME_LABELS,
    applyVisualTheme: applyVisualTheme,
    applyTheme: applyTheme,
    // Sidebar tree display
    getSidebarTreeDisplayOptions: getSidebarTreeDisplayOptions,
    applySidebarTreeDisplayOptions: applySidebarTreeDisplayOptions,
    toggleSidebarTreeDisplayOption: toggleSidebarTreeDisplayOption,
    buildSidebarHierarchyDisplayMenuItems: buildSidebarHierarchyDisplayMenuItems,
    // UI scale
    normalizeUiScale: normalizeUiScale,
    applyUiScale: applyUiScale,
    getUiScale: getUiScale,
    getUiScalePercentLabel: getUiScalePercentLabel,
    nudgeUiScale: nudgeUiScale,
    // Editor toggles
    isOverlayEditorEnabled: isOverlayEditorEnabled,
    setOverlayEditorEnabled: setOverlayEditorEnabled,
    // Special characters
    isSpecialCharactersVisible: isSpecialCharactersVisible,
    applySpecialCharactersVisibilitySetting: applySpecialCharactersVisibilitySetting,
    setSpecialCharactersVisible: setSpecialCharactersVisible,
    // Menu sync
    syncMenuCheckStates: syncMenuCheckStates,
    // Boot
    applyInitialSettings: applyInitialSettings
  };
})();
(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : {}).LexeraAppearance = LexeraAppearance;
