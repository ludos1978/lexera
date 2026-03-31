/**
 * LexeraBoardSettings — Board setting normalizers and value resolution.
 *
 * Extracted from app.js Main View section.
 * Pure normalizer functions plus getBoardSettingValue with tiered lookup.
 *
 * IIFE module — no const/let, no ES imports.
 */
var LexeraBoardSettings = (function () {
  'use strict';

  var _deps = {};
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      _rt = window.LexeraRuntime;
      _rt.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  // ── Font size normalization ──────────────────────────────────────────

  function normalizeBoardFontSizeValue(rawValue) {
    var source = String(rawValue || '').trim().toLowerCase();
    if (!source || source === 'normal' || source === '1x') return '13px';
    if (source === 'small' || source === '0.75x') return '9.75px';
    if (source === 'large' || source === '1.25x') return '16.25px';
    if (source === '0.5x') return '6.5px';
    if (source === '1.5x') return '19.5px';
    if (source === '2x') return '26px';
    if (/^\d+(?:\.\d+)?px$/.test(source)) return source;
    var numeric = parseFloat(source);
    if (isFinite(numeric) && numeric > 0) return numeric + 'px';
    return '13px';
  }

  // ── Font family normalization ────────────────────────────────────────

  function normalizeBoardFontFamilyToken(rawValue) {
    var source = String(rawValue || '').trim().toLowerCase();
    if (!source || source === 'system') return 'system';
    if (source.indexOf('plus jakarta') !== -1 || source.indexOf('plusjakarta') !== -1) return 'plusjakarta';
    if (source.indexOf('open sans') !== -1 || source.indexOf('opensans') !== -1) return 'opensans';
    if (source.indexOf('new roman') !== -1 || source.indexOf('times') !== -1) return 'times';
    if (source.indexOf('fira code') !== -1 || source.indexOf('firacode') !== -1) return 'firacode';
    if (source.indexOf('jetbrains') !== -1) return 'jetbrains';
    if (source.indexOf('source code') !== -1 || source.indexOf('sourcecodepro') !== -1) return 'sourcecodepro';
    if (source.indexOf('helvetica') !== -1) return 'helvetica';
    if (source.indexOf('arial') !== -1) return 'arial';
    if (source.indexOf('georgia') !== -1) return 'georgia';
    if (source.indexOf('consolas') !== -1) return 'consolas';
    if (source.indexOf('inter') !== -1) return 'inter';
    if (source.indexOf('roboto') !== -1) return 'roboto';
    if (source.indexOf('lato') !== -1) return 'lato';
    if (source.indexOf('poppins') !== -1) return 'poppins';
    return 'system';
  }

  function resolveBoardFontFamilyValue(token) {
    if (!token || token === 'system') return null;
    if (token === 'roboto') return "'Roboto', sans-serif";
    if (token === 'opensans') return "'Open Sans', sans-serif";
    if (token === 'lato') return "'Lato', sans-serif";
    if (token === 'plusjakarta') return "'Plus Jakarta Sans', sans-serif";
    if (token === 'inter') return "'Inter', sans-serif";
    if (token === 'poppins') return "'Poppins', sans-serif";
    if (token === 'helvetica') return "'Helvetica Neue', Helvetica, Arial, sans-serif";
    if (token === 'arial') return "Arial, sans-serif";
    if (token === 'georgia') return "Georgia, serif";
    if (token === 'times') return "'Times New Roman', serif";
    if (token === 'firacode') return "'Fira Code', monospace";
    if (token === 'jetbrains') return "'JetBrains Mono', monospace";
    if (token === 'sourcecodepro') return "'Source Code Pro', monospace";
    if (token === 'consolas') return "Consolas, monospace";
    return null;
  }

  // ── Whitespace normalization ─────────────────────────────────────────

  function normalizeWhitespaceValue(rawValue) {
    var source = String(rawValue || '').trim().toLowerCase();
    if (!source) return '';
    if (source === 'compact') return '8px';
    if (source === 'default' || source === 'normal') return '16px';
    if (source === 'spacious') return '32px';
    var match = source.match(/^(\d+(?:\.\d+)?)px$/);
    if (!match) return '';
    var px = parseFloat(match[1]);
    if (!isFinite(px) || px <= 0) return '';
    if (px <= 12) return '8px';
    if (px >= 24) return '32px';
    return '16px';
  }

  // ── Column width normalization ───────────────────────────────────────

  function normalizeColumnWidth(rawValue) {
    var value = String(rawValue || '').trim();
    if (!value) return '';
    if (/^\d+(\.\d+)?$/.test(value)) value += 'px';

    var pxMatch = value.match(/^(\d+(?:\.\d+)?)px$/i);
    if (pxMatch) {
      var px = parseFloat(pxMatch[1]);
      if (!isFinite(px)) return '';
      px = Math.max(120, Math.min(1200, px));
      return px + 'px';
    }

    if (/^\d+(\.\d+)?(rem|em|ch|vw|vh)$/i.test(value)) return value;
    return '';
  }

  // ── Tag visibility normalization ─────────────────────────────────────

  var TAG_VISIBILITY_MODE_MAP = {
    '': 'allexcludinglayout',
    'show': 'all', 'hide': 'none', 'standard': 'allexcludinglayout',
    'custom': 'customonly', 'mentions': 'mentionsonly',
    'all': 'all', 'allexcludinglayout': 'allexcludinglayout',
    'customonly': 'customonly', 'mentionsonly': 'mentionsonly',
    'none': 'none', 'dim': 'dim'
  };

  function normalizeTagVisibilityMode(rawMode) {
    var mode = String(rawMode || '').trim().toLowerCase();
    return TAG_VISIBILITY_MODE_MAP[mode] || 'all';
  }

  // ── HTML comment render mode normalization ───────────────────────────

  function normalizeHtmlCommentRenderMode(rawMode) {
    var mode = String(rawMode || '').trim().toLowerCase();
    if (!mode) return 'hidden';
    if (mode === 'show') return 'text';
    if (mode === 'hide' || mode === 'hidden') return 'hidden';
    if (mode === 'text' || mode === 'dim') return mode;
    return 'text';
  }

  // ── Arrow key focus scroll mode normalization ────────────────────────

  function normalizeArrowKeyFocusScrollMode(rawMode) {
    var mode = String(rawMode || '').trim().toLowerCase();
    if (!mode || mode === 'enabled') return 'nearest';
    if (mode === 'disabled') return 'disabled';
    if (mode === 'center' || mode === 'nearest') return mode;
    return 'nearest';
  }

  // ── YAML frontmatter scalar normalization ────────────────────────────

  function normalizeYamlFrontmatterScalar(value) {
    if (value == null) return '';
    return String(value)
      .replace(/\r\n?/g, '\n')
      .trim();
  }

  // ── Board setting value lookup (tiered) ──────────────────────────────

  function getBoardSettingValue(key, fallback) {
    // Tier 1: per-board override (YAML header)
    var fullBoardData = typeof _deps.getFullBoardData === 'function' ? _deps.getFullBoardData() : null;
    if (fullBoardData && fullBoardData.boardSettings) {
      var boardValue = fullBoardData.boardSettings[key];
      if (boardValue != null && boardValue !== '') return boardValue;
    }
    // Tier 2: workspace/global settings (from backend)
    var cachedWorkspaceSettings = typeof _deps.getCachedWorkspaceSettings === 'function' ? _deps.getCachedWorkspaceSettings() : null;
    if (cachedWorkspaceSettings && cachedWorkspaceSettings[key] != null) {
      return cachedWorkspaceSettings[key];
    }
    // Tier 3: frontend default (localStorage)
    try {
      var storage = typeof _deps.getLocalStorage === 'function' ? _deps.getLocalStorage() : (typeof localStorage !== 'undefined' ? localStorage : null);
      if (storage) {
        var frontendValue = storage.getItem('lexera-default-' + key);
        if (frontendValue !== null) return frontendValue;
      }
    } catch (_) { /* localStorage unavailable (private browsing) */ }
    // Tier 4: hardcoded fallback
    return fallback;
  }

  // ── HTML content render mode ─────────────────────────────────────────

  function getHtmlContentRenderMode() {
    var mode = getBoardSettingValue('htmlContentRenderMode', 'html');
    return mode === 'html' ? 'html' : 'text';
  }

  // ── Active board color resolution ────────────────────────────────────

  function resolveActiveBoardColor(settings) {
    settings = settings || {};
    var isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (isDark) return settings.boardColorDark || settings.boardColor || '';
    return settings.boardColorLight || settings.boardColor || '';
  }

  // ── Public API ───────────────────────────────────────────────────────

  return {
    init: init,
    normalizeBoardFontSizeValue: normalizeBoardFontSizeValue,
    normalizeBoardFontFamilyToken: normalizeBoardFontFamilyToken,
    resolveBoardFontFamilyValue: resolveBoardFontFamilyValue,
    normalizeWhitespaceValue: normalizeWhitespaceValue,
    normalizeColumnWidth: normalizeColumnWidth,
    normalizeTagVisibilityMode: normalizeTagVisibilityMode,
    normalizeHtmlCommentRenderMode: normalizeHtmlCommentRenderMode,
    normalizeArrowKeyFocusScrollMode: normalizeArrowKeyFocusScrollMode,
    normalizeYamlFrontmatterScalar: normalizeYamlFrontmatterScalar,
    getBoardSettingValue: getBoardSettingValue,
    getHtmlContentRenderMode: getHtmlContentRenderMode,
    resolveActiveBoardColor: resolveActiveBoardColor
  };
})();

if (typeof globalThis !== 'undefined') globalThis.LexeraBoardSettings = LexeraBoardSettings;
if (typeof window !== 'undefined') window.LexeraBoardSettings = LexeraBoardSettings;
if (typeof module !== 'undefined' && module.exports) module.exports = LexeraBoardSettings;
