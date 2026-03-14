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
    if (!source || source === 'classic' || source === 'default' || source === 'legacy') return 'classic';
    if (source === 'sleek' || source === 'minimal' || source === 'modern') return 'sleek';
    if (source === 'bordered' || source === 'boxed' || source === 'outline') return 'classic';
    if (source === 'gap' || source === 'gap-highlight' || source === 'gaphighlight') return 'gap';
    if (source === 'lines' || source === 'line' || source === 'line-separator') return 'lines';
    return 'classic';
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
    return 'classic';
  }

  var currentThemeId = 'classic';

  function applyLexeraVisualTheme(themeId) {
    var theme = findLexeraVisualTheme(themeId);
    var normalized = theme.id;
    var root = document && document.documentElement ? document.documentElement : null;

    currentThemeId = normalized;
    if (root) root.setAttribute('data-visual-theme', normalized);

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
    applyLexeraVisualTheme('classic');
  }
})();
