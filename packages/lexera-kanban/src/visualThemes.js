/**
 * Board Style — controls board surface, separator, and density visual style.
 *
 * Each board style (classic, sleek, sleek-uniform, gap, lines) defines the
 * visual treatment of cards, separators, and whitespace on the board.
 * Applied via the data-visual-theme attribute on <html>.
 *
 * Color palette is a separate concern handled by themes.js (Application Theme layer).
 */
(function () {
  var VISUAL_THEMES = [
    {
      id: 'classic',
      name: 'Classic',
      description: 'Balanced Lexera layout'
    },
    {
      id: 'sleek',
      name: 'Sleek',
      description: 'Swiss-style minimal layout'
    },
    {
      id: 'sleek-uniform',
      baseId: 'sleek',
      name: 'Sleek Uniform',
      description: 'Sleek layout copy for unified typography'
    },
    {
      id: 'gap',
      name: 'Gap',
      description: 'Whitespace and separators over boxes'
    },
    {
      id: 'lines',
      name: 'Lines',
      description: 'Clean line separators, no boxes'
    }
  ];

  function normalizeLexeraVisualThemeId(value) {
    var source = String(value || '').trim().toLowerCase();
    if (!source || source === 'default' || source === 'legacy') return 'sleek-uniform';
    if (source === 'classic') return 'classic';
    if (source === 'sleek' || source === 'minimal' || source === 'modern') return 'sleek';
    if (source === 'sleek-uniform' || source === 'sleekuniform' || source === 'uniform') return 'sleek-uniform';
    if (source === 'bordered' || source === 'boxed' || source === 'outline') return 'classic';
    if (source === 'gap' || source === 'gap-highlight' || source === 'gaphighlight') return 'gap';
    if (source === 'lines' || source === 'line' || source === 'line-separator') return 'lines';
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
      var stored = localStorage.getItem('lexera-visual-theme');
      if (stored) return stored;

      var legacyTemplate = localStorage.getItem('lexera-ui-template');
      if (legacyTemplate) {
        var normalizedLegacyTemplate = normalizeLexeraVisualThemeId(legacyTemplate);
        if (normalizedLegacyTemplate === 'sleek') return 'sleek';
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

    try {
      localStorage.setItem('lexera-visual-theme', normalized);
    } catch (err) {
      /* ignore localStorage errors */
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
})();
