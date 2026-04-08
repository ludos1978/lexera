/**
 * Base application palette.
 *
 * The application no longer exposes a separate color-theme choice. The built-in
 * Lexera palette is applied as part of the visual-theme flow, while still
 * providing both light and dark variants based on the OS color-scheme.
 *
 * This file intentionally keeps the old API shape (`LEXERA_THEMES`,
 * `applyLexeraTheme()`) so existing runtime code can keep calling into it
 * without a parallel migration path.
 */
/* eslint-disable no-unused-vars */
var LEXERA_THEMES = [
  {
    id: 'lexera', name: 'Lexera',
    light: {
      '--bg-primary': '#ffffff', '--bg-secondary': '#f3f3f3', '--bg-tertiary': '#e8e8e8',
      '--bg-hover': '#e0e0e0', '--bg-active': '#cce5ff', '--border': '#d4d4d4',
      '--font-color-mode': '#000000',
      '--text-primary': '#333333', '--text-muted': '#8a8a8a',
      '--accent': '#007acc', '--accent-hover': '#0066b8', '--success': '#388a6c', '--error': '#d32f2f',
      '--card-bg': '#ffffff', '--card-border': '#d4d4d4', '--card-checked': '#f0f0f0',
      '--scrollbar-thumb': '#c1c1c1', '--scrollbar-thumb-hover': '#a8a8a8', '--scrollbar-track': 'transparent',
      '--btn-bg': '#e0e0e0', '--btn-bg-hover': '#d0d0d0', '--btn-fg': '#333333',
      '--input-bg': '#ffffff', '--input-border': '#c4c4c4'
    },
    dark: {
      '--bg-primary': '#1e1e1e', '--bg-secondary': '#252526', '--bg-tertiary': '#2d2d30',
      '--bg-hover': '#2a2d2e', '--bg-active': '#094771', '--border': '#474747',
      '--font-color-mode': '#ffffff',
      '--text-primary': '#ffffff', '--text-muted': '#707070',
      '--accent': '#007acc', '--accent-hover': '#1a8cff', '--success': '#4ec9b0', '--error': '#f44747',
      '--card-bg': '#1e1e1e', '--card-border': '#474747', '--card-checked': '#2d2d30',
      '--scrollbar-thumb': '#424242', '--scrollbar-thumb-hover': '#5a5a5a', '--scrollbar-track': 'transparent',
      '--btn-bg': '#3a3d41', '--btn-bg-hover': '#45494e', '--btn-fg': '#e0e0e0',
      '--input-bg': '#3c3c3c', '--input-border': '#5a5a5a'
    }
  }
];

var _lexeraCurrentThemeId = 'lexera';

function applyLexeraThemePaletteToRoot(root, palette, isDark) {
  if (!root || !root.style || !palette) return;
  var keys = Object.keys(palette);
  for (var i = 0; i < keys.length; i++) {
    root.style.setProperty(keys[i], palette[keys[i]]);
  }
  root.style.colorScheme = isDark ? 'dark' : 'light';
}

function broadcastLexeraThemePalette(documentRef, palette, isDark) {
  if (!documentRef || typeof documentRef.querySelectorAll !== 'function') return;
  var iframes = documentRef.querySelectorAll('iframe');
  for (var i = 0; i < iframes.length; i++) {
    try {
      var iframeRoot = iframes[i].contentDocument && iframes[i].contentDocument.documentElement;
      applyLexeraThemePaletteToRoot(iframeRoot, palette, isDark);
    } catch (err) {
      // Ignore cross-origin iframe access failures.
    }
  }
}

function getLexeraBaseTheme() {
  return LEXERA_THEMES[0];
}

function clearLegacyThemeSelection() {
  try {
    localStorage.removeItem('lexera-theme');
  } catch (err) {
    /* ignore localStorage errors */
  }
}

function applyLexeraTheme(themeId) {
  var theme = getLexeraBaseTheme();
  _lexeraCurrentThemeId = theme.id;

  var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var palette = isDark ? theme.dark : theme.light;
  var root = document.documentElement;

  applyLexeraThemePaletteToRoot(root, palette, isDark);
  broadcastLexeraThemePalette(document, palette, isDark);
  clearLegacyThemeSelection();

  return theme;
}

function getLexeraCurrentThemeId() {
  return _lexeraCurrentThemeId;
}

// Re-apply on OS light/dark switch
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
  applyLexeraTheme(_lexeraCurrentThemeId || 'lexera');
});
