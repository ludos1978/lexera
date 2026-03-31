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
    { id: 'classic', name: 'Classic', description: 'Balanced Lexera layout' }
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

  var DEFAULT_SIDEBAR_TREE_DISPLAY_OPTIONS = {
    counts: true,
    presence: true,
    grips: true
  };

  function normalizeSidebarTreeDisplayOptions(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      counts: source.counts !== false,
      presence: source.presence !== false,
      grips: source.grips !== false
    };
  }

  function readStoredSidebarTreeDisplayOptions() {
    if (Settings) {
      return normalizeSidebarTreeDisplayOptions(Settings.get('sidebarTreeDisplay'));
    }
    try {
      var raw = localStorage.getItem('lexera-sidebar-tree-display');
      if (!raw) return normalizeSidebarTreeDisplayOptions(DEFAULT_SIDEBAR_TREE_DISPLAY_OPTIONS);
      return normalizeSidebarTreeDisplayOptions(JSON.parse(raw));
    } catch (err) {
      return normalizeSidebarTreeDisplayOptions(DEFAULT_SIDEBAR_TREE_DISPLAY_OPTIONS);
    }
  }

  var sidebarTreeDisplayOptions = readStoredSidebarTreeDisplayOptions();

  function applySidebarTreeDisplayOptions(nextOptions) {
    sidebarTreeDisplayOptions = normalizeSidebarTreeDisplayOptions(nextOptions);
    var root = document && document.documentElement ? document.documentElement : null;
    if (root) {
      root.setAttribute('data-sidebar-tree-counts', sidebarTreeDisplayOptions.counts ? 'on' : 'off');
      root.setAttribute('data-sidebar-tree-presence', sidebarTreeDisplayOptions.presence ? 'on' : 'off');
      root.setAttribute('data-sidebar-tree-grips', sidebarTreeDisplayOptions.grips ? 'on' : 'off');
    }
    if (Settings) {
      Settings.set('sidebarTreeDisplay', sidebarTreeDisplayOptions);
    } else {
      try {
        localStorage.setItem('lexera-sidebar-tree-display', JSON.stringify(sidebarTreeDisplayOptions));
      } catch (err) {
        /* ignore localStorage errors */
      }
    }
    _callDep('renderFrontendSettingsPanel');
    return getSidebarTreeDisplayOptions();
  }

  function getSidebarTreeDisplayOptions() {
    return {
      counts: !!sidebarTreeDisplayOptions.counts,
      presence: !!sidebarTreeDisplayOptions.presence,
      grips: !!sidebarTreeDisplayOptions.grips
    };
  }

  function toggleSidebarTreeDisplayOption(optionKey) {
    var next = getSidebarTreeDisplayOptions();
    if (!Object.prototype.hasOwnProperty.call(next, optionKey)) return next;
    next[optionKey] = !next[optionKey];
    return applySidebarTreeDisplayOptions(next);
  }

  function buildSidebarHierarchyDisplayMenuItems() {
    var options = getSidebarTreeDisplayOptions();
    return [
      { id: 'toggle-sidebar-counts', label: _callDep('formatMenuToggleLabel', options.counts, 'Counts') },
      { id: 'toggle-sidebar-presence', label: _callDep('formatMenuToggleLabel', options.presence, 'Presence Badges') },
      { id: 'toggle-sidebar-grips', label: _callDep('formatMenuToggleLabel', options.grips, 'Drag Icons') }
    ];
  }

  // Apply initial sidebar tree display options
  applySidebarTreeDisplayOptions(sidebarTreeDisplayOptions);

  // ─── Theme application ────────────────────────────────────────────────

  function applyTheme(themeId) {
    // Use shared theme applier for base CSS variables
    if (typeof applyLexeraTheme === 'function') {
      applyLexeraTheme(themeId);
    }

    // Find the active theme and palette for kanban-specific derived tokens
    var theme = null;
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === themeId) { theme = THEMES[i]; break; }
    }
    if (!theme) theme = THEMES[0];
    if (!theme) return;

    var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var palette = isDark ? theme.dark : theme.light;
    var root = document.documentElement;

    // Derive extended style tokens from the active palette so spacing/colors stay unified.
    root.style.setProperty('--board-bg', palette['--bg-primary'] || '');
    root.style.setProperty('--surface-row-bg', palette['--bg-primary'] || '');
    root.style.setProperty('--surface-row-border', palette['--border'] || '');
    root.style.setProperty('--surface-stack-bg', palette['--bg-secondary'] || '');
    root.style.setProperty('--surface-stack-border', palette['--border'] || '');
    root.style.setProperty('--surface-column-bg', palette['--bg-secondary'] || '');
    root.style.setProperty('--surface-column-border', palette['--border'] || '');
    root.style.setProperty('--surface-header-bg', palette['--bg-tertiary'] || palette['--bg-secondary'] || '');
    root.style.setProperty('--surface-header-border', palette['--border'] || '');
    root.style.setProperty('--surface-footer-bg', palette['--bg-secondary'] || '');
    root.style.setProperty('--title-row-color', palette['--text-bright'] || '');
    root.style.setProperty('--title-stack-color', palette['--text-secondary'] || '');
    root.style.setProperty('--title-column-color', palette['--text-bright'] || '');

    root.style.setProperty('--icon-btn-bg', palette['--bg-tertiary'] || palette['--btn-bg'] || '');
    root.style.setProperty('--icon-btn-bg-hover', palette['--bg-hover'] || palette['--btn-bg-hover'] || '');
    root.style.setProperty('--icon-btn-bg-active', 'rgba(0, 122, 204, 0.22)');
    root.style.setProperty('--icon-btn-border', palette['--text-secondary'] || palette['--border'] || '');
    root.style.setProperty('--icon-btn-border-hover', palette['--text-bright'] || palette['--text-primary'] || '');
    root.style.setProperty('--icon-btn-fg', palette['--text-bright'] || palette['--btn-fg'] || '');
    root.style.setProperty('--icon-btn-fg-hover', palette['--text-bright'] || palette['--text-primary'] || '');

    // Update theme selector if present
    var themeSelectors = [
      document.getElementById('theme-select'),
      document.getElementById('mgmt-theme-select'),
      document.getElementById('frontend-settings-theme-select')
    ];
    for (var selIndex = 0; selIndex < themeSelectors.length; selIndex++) {
      var sel = themeSelectors[selIndex];
      if (sel && sel.value !== theme.id) sel.value = theme.id;
    }

    _callDep('applyBoardSettings');
    _callDep('renderFrontendSettingsPanel');
  }

  // Re-apply kanban-specific derived tokens on OS light/dark switch
  // (base variables are already re-applied by themes.js listener)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    var themeId = (typeof getLexeraCurrentThemeId === 'function' && getLexeraCurrentThemeId()) ||
                  (Settings ? Settings.get('theme') : localStorage.getItem('lexera-theme')) || 'lexera';
    applyTheme(themeId);
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
    var visualTheme = Settings ? Settings.get('visualTheme') : (localStorage.getItem('lexera-visual-theme') || 'sleek-uniform');
    var themeId = Settings ? Settings.get('theme') : (localStorage.getItem('lexera-theme') || 'lexera');
    var uiScaleRaw = Settings ? Settings.get('uiScale') : (localStorage.getItem('lexera-ui-scale') || '0.95');
    applyVisualTheme(visualTheme);
    applyTheme(themeId);
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
