/**
 * Visual Theme — controls board surface, separator, density, and the built-in
 * Lexera application palette.
 *
 * Public board styles are limited to classic and sleek-uniform. The
 * sleek-uniform variant still reuses the historical "sleek" base selectors in
 * CSS, so it applies data-visual-theme="sleek" with a dedicated
 * data-visual-theme-variant marker.
 */
(function () {
  var Settings = typeof LexeraSettings !== 'undefined' ? LexeraSettings : null;

  var colorSchemeMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
  var VISUAL_THEMES = [
    {
      id: 'classic',
      name: 'Classic',
      description: 'Balanced Lexera layout'
    },
    {
      id: 'sleek-uniform',
      baseId: 'sleek',
      name: 'Sleek Uniform',
      description: 'Sleek layout copy for unified typography'
    }
  ];

  function normalizeLexeraVisualThemeId(value) {
    var source = String(value || '').trim().toLowerCase();
    if (!source || source === 'default' || source === 'legacy') return 'sleek-uniform';
    if (source === 'classic') return 'classic';
    if (source === 'sleek' || source === 'minimal' || source === 'modern') return 'sleek-uniform';
    if (source === 'sleek-uniform' || source === 'sleekuniform' || source === 'uniform') return 'sleek-uniform';
    if (source === 'bordered' || source === 'boxed' || source === 'outline') return 'classic';
    if (source === 'gap' || source === 'gap-highlight' || source === 'gaphighlight') return 'sleek-uniform';
    if (source === 'lines' || source === 'line' || source === 'line-separator') return 'sleek-uniform';
    return 'sleek-uniform';
  }

  function findLexeraVisualTheme(id) {
    var normalized = normalizeLexeraVisualThemeId(id);
    for (var i = 0; i < VISUAL_THEMES.length; i++) {
      if (VISUAL_THEMES[i].id === normalized) return VISUAL_THEMES[i];
    }
    return VISUAL_THEMES[0];
  }

  function readStoredVisualThemeId() {
    try {
      var stored = Settings ? Settings.get('visualTheme') : localStorage.getItem('lexera-visual-theme');
      if (stored) return stored;

      var legacyTemplate = localStorage.getItem('lexera-ui-template');
      if (legacyTemplate) {
        return normalizeLexeraVisualThemeId(legacyTemplate);
      }

      var legacyBoardTheme = localStorage.getItem('lexera-board-theme');
      if (legacyBoardTheme) return normalizeLexeraVisualThemeId(legacyBoardTheme);
    } catch (err) {
      /* ignore localStorage errors */
    }
    return 'sleek-uniform';
  }

  var currentThemeId = 'sleek-uniform';

  function applyLexeraVisualTheme(themeId) {
    var theme = findLexeraVisualTheme(themeId);
    var normalized = theme.id;
    var baseThemeId = theme.baseId || normalized;
    var root = document && document.documentElement ? document.documentElement : null;

    currentThemeId = normalized;
    if (root) {
      root.setAttribute('data-visual-theme', baseThemeId);
      root.setAttribute('data-visual-theme-variant', normalized);
    }

    if (typeof applyLexeraTheme === 'function') {
      applyLexeraTheme('lexera');
    }

    try {
      if (Settings) {
        Settings.set('visualTheme', normalized);
      } else {
        localStorage.setItem('lexera-visual-theme', normalized);
      }
    } catch (err) {
      /* ignore localStorage errors */
    }

    // Broadcast visual theme to all board iframes (workspace shell panes)
    if (typeof document !== 'undefined') {
      var iframes = document.querySelectorAll('iframe');
      for (var fi = 0; fi < iframes.length; fi++) {
        try {
          var iframeRoot = iframes[fi].contentDocument && iframes[fi].contentDocument.documentElement;
          if (iframeRoot) {
            iframeRoot.setAttribute('data-visual-theme', baseThemeId);
            iframeRoot.setAttribute('data-visual-theme-variant', normalized);
          }
        } catch (e) {
          // cross-origin iframes will throw — ignore
        }
      }
    }

    return theme;
  }

  function getLexeraCurrentVisualThemeId() {
    return currentThemeId;
  }

  window.LEXERA_VISUAL_THEMES = VISUAL_THEMES;
  window.normalizeLexeraVisualThemeId = normalizeLexeraVisualThemeId;
  window.applyLexeraVisualTheme = applyLexeraVisualTheme;
  window.getLexeraCurrentVisualThemeId = getLexeraCurrentVisualThemeId;

  try {
    applyLexeraVisualTheme(readStoredVisualThemeId());
  } catch (err) {
    applyLexeraVisualTheme('sleek-uniform');
  }

  if (colorSchemeMedia && typeof colorSchemeMedia.addEventListener === 'function') {
    colorSchemeMedia.addEventListener('change', function () {
      applyLexeraVisualTheme(currentThemeId || readStoredVisualThemeId());
    });
  }
})();
