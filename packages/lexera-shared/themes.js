/**
 * Shared theme definitions for all Lexera UIs (kanban, connection-settings, quick-capture).
 * Provides LEXERA_THEMES array and applyLexeraTheme() function.
 */
/* eslint-disable no-unused-vars */
var LEXERA_THEMES = [
  {
    id: 'lexera', name: 'Lexera',
    font: "'Segoe UI Variable', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif",
    light: {
      '--bg-primary': '#ffffff', '--bg-secondary': '#f3f3f3', '--bg-tertiary': '#e8e8e8',
      '--bg-hover': '#e0e0e0', '--bg-active': '#cce5ff', '--border': '#d4d4d4',
      '--text-primary': '#333333', '--text-secondary': '#717171', '--text-bright': '#1e1e1e',
      '--accent': '#007acc', '--accent-hover': '#0066b8', '--success': '#388a6c', '--error': '#d32f2f',
      '--card-bg': '#ffffff', '--card-border': '#d4d4d4', '--card-checked': '#f0f0f0',
      '--scrollbar-thumb': '#c1c1c1', '--scrollbar-track': 'transparent',
      '--btn-bg': '#e0e0e0', '--btn-bg-hover': '#d0d0d0', '--btn-fg': '#333333',
      '--input-bg': '#ffffff', '--input-border': '#c4c4c4'
    },
    dark: {
      '--bg-primary': '#1e1e1e', '--bg-secondary': '#252526', '--bg-tertiary': '#2d2d30',
      '--bg-hover': '#2a2d2e', '--bg-active': '#094771', '--border': '#474747',
      '--text-primary': '#d4d4d4', '--text-secondary': '#858585', '--text-bright': '#e8e8e8',
      '--accent': '#007acc', '--accent-hover': '#1a8cff', '--success': '#4ec9b0', '--error': '#f44747',
      '--card-bg': '#1e1e1e', '--card-border': '#474747', '--card-checked': '#2d2d30',
      '--scrollbar-thumb': '#424242', '--scrollbar-track': 'transparent',
      '--btn-bg': '#3a3d41', '--btn-bg-hover': '#45494e', '--btn-fg': '#cccccc',
      '--input-bg': '#3c3c3c', '--input-border': '#5a5a5a'
    }
  },
  {
    id: 'mono', name: 'Mono',
    font: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    light: {
      '--bg-primary': '#fafafa', '--bg-secondary': '#f0f0f0', '--bg-tertiary': '#e4e4e4',
      '--bg-hover': '#dcdcdc', '--bg-active': '#c8dff0', '--border': '#cccccc',
      '--text-primary': '#2e2e2e', '--text-secondary': '#6e6e6e', '--text-bright': '#111111',
      '--accent': '#0969da', '--accent-hover': '#0550ae', '--success': '#1a7f37', '--error': '#cf222e',
      '--card-bg': '#fafafa', '--card-border': '#d0d0d0', '--card-checked': '#eeeeee',
      '--scrollbar-thumb': '#c0c0c0', '--scrollbar-track': 'transparent',
      '--btn-bg': '#e2e2e2', '--btn-bg-hover': '#d2d2d2', '--btn-fg': '#2e2e2e',
      '--input-bg': '#ffffff', '--input-border': '#c0c0c0'
    },
    dark: {
      '--bg-primary': '#0d1117', '--bg-secondary': '#161b22', '--bg-tertiary': '#21262d',
      '--bg-hover': '#30363d', '--bg-active': '#1f3a5f', '--border': '#30363d',
      '--text-primary': '#c9d1d9', '--text-secondary': '#8b949e', '--text-bright': '#f0f6fc',
      '--accent': '#58a6ff', '--accent-hover': '#79c0ff', '--success': '#3fb950', '--error': '#f85149',
      '--card-bg': '#0d1117', '--card-border': '#30363d', '--card-checked': '#161b22',
      '--scrollbar-thumb': '#484f58', '--scrollbar-track': 'transparent',
      '--btn-bg': '#21262d', '--btn-bg-hover': '#30363d', '--btn-fg': '#c9d1d9',
      '--input-bg': '#0d1117', '--input-border': '#30363d'
    }
  },
  {
    id: 'warm', name: 'Warm',
    font: "Georgia, 'Times New Roman', serif",
    light: {
      '--bg-primary': '#fdf6e3', '--bg-secondary': '#f5eedc', '--bg-tertiary': '#eee8d5',
      '--bg-hover': '#e8dfca', '--bg-active': '#ddd6c1', '--border': '#d6cdb7',
      '--text-primary': '#5b4636', '--text-secondary': '#8a7560', '--text-bright': '#3b2a1a',
      '--accent': '#b58900', '--accent-hover': '#a07800', '--success': '#859900', '--error': '#dc322f',
      '--card-bg': '#fdf6e3', '--card-border': '#d6cdb7', '--card-checked': '#f0e8d4',
      '--scrollbar-thumb': '#c8bfa8', '--scrollbar-track': 'transparent',
      '--btn-bg': '#eee8d5', '--btn-bg-hover': '#e0d8c2', '--btn-fg': '#5b4636',
      '--input-bg': '#fdf6e3', '--input-border': '#d6cdb7'
    },
    dark: {
      '--bg-primary': '#2b2018', '--bg-secondary': '#33261c', '--bg-tertiary': '#3d2e22',
      '--bg-hover': '#483828', '--bg-active': '#4a3520', '--border': '#5a4530',
      '--text-primary': '#d4c4a8', '--text-secondary': '#9a8a70', '--text-bright': '#f0e0c8',
      '--accent': '#d4a017', '--accent-hover': '#e8b830', '--success': '#a8b820', '--error': '#e8503a',
      '--card-bg': '#2b2018', '--card-border': '#5a4530', '--card-checked': '#33261c',
      '--scrollbar-thumb': '#5a4a35', '--scrollbar-track': 'transparent',
      '--btn-bg': '#3d2e22', '--btn-bg-hover': '#483828', '--btn-fg': '#d4c4a8',
      '--input-bg': '#33261c', '--input-border': '#5a4530'
    }
  },
  {
    id: 'nord', name: 'Nord',
    font: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    light: {
      '--bg-primary': '#eceff4', '--bg-secondary': '#e5e9f0', '--bg-tertiary': '#d8dee9',
      '--bg-hover': '#d0d6e1', '--bg-active': '#c8d0e0', '--border': '#c8ced9',
      '--text-primary': '#2e3440', '--text-secondary': '#4c566a', '--text-bright': '#1a1e28',
      '--accent': '#5e81ac', '--accent-hover': '#4c6d96', '--success': '#a3be8c', '--error': '#bf616a',
      '--card-bg': '#eceff4', '--card-border': '#d0d6e1', '--card-checked': '#e0e4ec',
      '--scrollbar-thumb': '#b8c0cc', '--scrollbar-track': 'transparent',
      '--btn-bg': '#d8dee9', '--btn-bg-hover': '#c8ced9', '--btn-fg': '#2e3440',
      '--input-bg': '#eceff4', '--input-border': '#c8ced9'
    },
    dark: {
      '--bg-primary': '#2e3440', '--bg-secondary': '#3b4252', '--bg-tertiary': '#434c5e',
      '--bg-hover': '#4c566a', '--bg-active': '#3d4a5e', '--border': '#4c566a',
      '--text-primary': '#d8dee9', '--text-secondary': '#81a1c1', '--text-bright': '#eceff4',
      '--accent': '#88c0d0', '--accent-hover': '#8fbcbb', '--success': '#a3be8c', '--error': '#bf616a',
      '--card-bg': '#2e3440', '--card-border': '#4c566a', '--card-checked': '#3b4252',
      '--scrollbar-thumb': '#4c566a', '--scrollbar-track': 'transparent',
      '--btn-bg': '#434c5e', '--btn-bg-hover': '#4c566a', '--btn-fg': '#d8dee9',
      '--input-bg': '#3b4252', '--input-border': '#4c566a'
    }
  }
];

var _lexeraCurrentThemeId = null;

function applyLexeraTheme(themeId) {
  var theme = null;
  for (var i = 0; i < LEXERA_THEMES.length; i++) {
    if (LEXERA_THEMES[i].id === themeId) { theme = LEXERA_THEMES[i]; break; }
  }
  if (!theme) theme = LEXERA_THEMES[0];
  _lexeraCurrentThemeId = theme.id;

  var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var palette = isDark ? theme.dark : theme.light;
  var root = document.documentElement;

  var keys = Object.keys(palette);
  for (var i = 0; i < keys.length; i++) {
    root.style.setProperty(keys[i], palette[keys[i]]);
  }
  root.style.setProperty('--theme-font', theme.font);

  localStorage.setItem('lexera-theme', theme.id);

  return theme;
}

function getLexeraCurrentThemeId() {
  return _lexeraCurrentThemeId;
}

// Re-apply on OS light/dark switch
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
  applyLexeraTheme(_lexeraCurrentThemeId || localStorage.getItem('lexera-theme') || 'lexera');
});
