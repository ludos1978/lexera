var LexeraCanvasMode = (function () {
  'use strict';
  function defaultStripHtmlComments(text) {
    return String(text || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function createCanvasModeHelpers(deps) {
    deps = deps || {};
    var stripHtmlComments = typeof deps.stripHtmlComments === 'function'
      ? deps.stripHtmlComments
      : defaultStripHtmlComments;

    function normalizeBoardLayoutValue(value) {
      var normalized = String(value == null ? '' : value).trim().toLowerCase();
      if (normalized === 'canvas') return 'canvas';
      return 'kanban';
    }

    function normalizeCanvasGridValue(value) {
      var normalized = String(value == null ? '' : value).trim().toLowerCase();
      if (!normalized || normalized === 'default' || normalized === 'medium') return '32';
      if (normalized === 'off' || normalized === 'none' || normalized === 'hidden') return 'off';
      if (normalized === 'fine' || normalized === 'small') return '16';
      if (normalized === 'large') return '64';
      if (normalized === 'largest' || normalized === 'largest-element' || normalized === 'auto') return 'largest';
      var parsed = parseFloat(normalized);
      if (!isFinite(parsed) || parsed <= 0) return '32';
      return String(Math.round(parsed));
    }

    function parseCanvasParamMap(raw) {
      var out = {};
      var text = String(raw || '').trim();
      if (!text) return out;
      var parts = text.split(',');
      for (var i = 0; i < parts.length; i++) {
        var pair = String(parts[i] || '').trim();
        if (!pair) continue;
        var colon = pair.indexOf(':');
        if (colon === -1) continue;
        var key = pair.substring(0, colon).trim();
        var value = pair.substring(colon + 1).trim();
        if (!key) continue;
        out[key] = value;
      }
      return out;
    }

    function extractCanvasConnectionSpecs(title) {
      var out = [];
      var text = stripHtmlComments(String(title || ''));
      var connectionRe = /\[(#[^\]\s]+)\]\u007B([^\u007D]+)\u007D/gi;
      var match;
      while ((match = connectionRe.exec(text))) {
        out.push({
          targetTag: String(match[1] || '').toLowerCase(),
          params: parseCanvasParamMap(match[2])
        });
      }
      return out;
    }

    function getCanvasColumnWidthSpec(value) {
      var raw = String(value == null ? '' : value).trim().toLowerCase();
      if (!raw) return null;
      if (/^-?\d+(\.\d+)?%$/.test(raw)) {
        return { kind: 'percent', value: Math.max(0, parseFloat(raw)) };
      }
      var fractionMatch = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
      if (fractionMatch) {
        var numerator = parseFloat(fractionMatch[1]);
        var denominator = parseFloat(fractionMatch[2]);
        if (isFinite(numerator) && isFinite(denominator) && denominator > 0) {
          return { kind: 'percent', value: Math.max(0, (numerator / denominator) * 100) };
        }
      }
      var numeric = parseFloat(raw);
      if (!isFinite(numeric) || numeric <= 0) return null;
      if (numeric <= 1) return { kind: 'percent', value: numeric * 100 };
      if (numeric <= 100) return { kind: 'percent', value: numeric };
      return { kind: 'px', value: numeric };
    }

    return {
      normalizeBoardLayoutValue: normalizeBoardLayoutValue,
      normalizeCanvasGridValue: normalizeCanvasGridValue,
      parseCanvasParamMap: parseCanvasParamMap,
      extractCanvasConnectionSpecs: extractCanvasConnectionSpecs,
      getCanvasColumnWidthSpec: getCanvasColumnWidthSpec
    };
  }

  return {
    createCanvasModeHelpers: createCanvasModeHelpers
  };
})();
if (typeof window !== 'undefined') window.LexeraCanvasMode = LexeraCanvasMode;
