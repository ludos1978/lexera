var LexeraCanvasLayout = (function () {
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

  function normalizeCanvasStackDirection(value) {
    var normalized = String(value == null ? '' : value).trim().toLowerCase();
    if (normalized === 'horizontal') normalized = 'row';
    if (normalized === 'vertical') normalized = 'column';
    return normalized === 'row' ? 'row' : 'column';
  }

  function normalizeCanvasAnchorSide(value, fallback) {
    var normalized = String(value == null ? '' : value).trim().toLowerCase();
    if (normalized === 'l') normalized = 'left';
    if (normalized === 'r') normalized = 'right';
    if (normalized === 't') normalized = 'top';
    if (normalized === 'b') normalized = 'bottom';
    if (normalized === 'middle' || normalized === 'centre') normalized = 'center';
    return normalized === 'left' || normalized === 'right' || normalized === 'top' || normalized === 'bottom' || normalized === 'center'
      ? normalized
      : fallback;
  }

  function parseCanvasAnchorOffset(value, size, start, center, end) {
    if (value == null || value === '') return null;
    var raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'start' || raw === 'left' || raw === 'top') return start;
    if (raw === 'middle' || raw === 'center' || raw === 'centre') return center;
    if (raw === 'end' || raw === 'right' || raw === 'bottom') return end;
    if (/^-?\d+(\.\d+)?%$/.test(raw)) return (parseFloat(raw) / 100) * size;
    var n = parseFloat(raw);
    if (!isFinite(n)) return null;
    if (n >= 0 && n <= 1) return n * size;
    return n;
  }

  function getDefaultCanvasConnectionSide(sourceBox, targetBox, role) {
    var sourceCenterX = sourceBox.x + sourceBox.w / 2;
    var sourceCenterY = sourceBox.y + sourceBox.h / 2;
    var targetCenterX = targetBox.x + targetBox.w / 2;
    var targetCenterY = targetBox.y + targetBox.h / 2;
    var dx = targetCenterX - sourceCenterX;
    var dy = targetCenterY - sourceCenterY;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (role === 'source') return dx >= 0 ? 'right' : 'left';
      return dx >= 0 ? 'left' : 'right';
    }
    if (role === 'source') return dy >= 0 ? 'bottom' : 'top';
    return dy >= 0 ? 'top' : 'bottom';
  }

  function resolveCanvasConnectionAnchor(box, params, keys, fallbackSide) {
    var side = normalizeCanvasAnchorSide(
      params[keys.side] || params[keys.aliasSide] || params[keys.position],
      fallbackSide || 'center'
    );
    var x = box.x + box.w / 2;
    var y = box.y + box.h / 2;
    if (side === 'left') x = box.x;
    else if (side === 'right') x = box.x + box.w;
    if (side === 'top') y = box.y;
    else if (side === 'bottom') y = box.y + box.h;

    var xOffset = parseCanvasAnchorOffset(params[keys.x], box.w, 0, box.w / 2, box.w);
    var yOffset = parseCanvasAnchorOffset(params[keys.y], box.h, 0, box.h / 2, box.h);
    if (xOffset != null) x = box.x + xOffset;
    if (yOffset != null) y = box.y + yOffset;

    return { x: x, y: y, side: side };
  }

  function canvasSideToVector(side) {
    switch (side) {
      case 'left':   return { x: -1, y:  0 };
      case 'right':  return { x:  1, y:  0 };
      case 'top':    return { x:  0, y: -1 };
      case 'bottom': return { x:  0, y:  1 };
      default:       return { x:  0, y:  0 };
    }
  }

  function getCanvasConnectionPath(sourceAnchor, targetAnchor) {
    var sourceVector = canvasSideToVector(sourceAnchor.side);
    var targetVector = canvasSideToVector(targetAnchor.side);
    var dx = targetAnchor.x - sourceAnchor.x;
    var dy = targetAnchor.y - sourceAnchor.y;
    var control = Math.max(40, Math.min(180, Math.max(Math.abs(dx), Math.abs(dy)) * 0.38));
    var c1x = sourceAnchor.x + sourceVector.x * control;
    var c1y = sourceAnchor.y + sourceVector.y * control;
    var c2x = targetAnchor.x - targetVector.x * control;
    var c2y = targetAnchor.y - targetVector.y * control;
    return 'M ' + sourceAnchor.x + ' ' + sourceAnchor.y +
      ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + targetAnchor.x + ' ' + targetAnchor.y;
  }

  function extractCanvasStackTags(title) {
    var stripLayoutTags = typeof _deps.stripLayoutTags === 'function'
      ? _deps.stripLayoutTags
      : function (t) { return String(t || ''); };
    var cleanTitle = stripLayoutTags(title);
    var tags = cleanTitle.match(/#[A-Za-z0-9._/-]+/g) || [];
    var out = [];
    var seen = {};
    for (var i = 0; i < tags.length; i++) {
      var normalized = String(tags[i] || '').toLowerCase();
      if (!normalized || seen[normalized]) continue;
      seen[normalized] = true;
      out.push(normalized);
    }
    return out;
  }

  function applyCanvasColumnLayout(colEl, col) {
    if (!colEl) return;
    var getCanvasColumnWidthSpec = typeof _deps.getCanvasColumnWidthSpec === 'function'
      ? _deps.getCanvasColumnWidthSpec
      : function () { return null; };
    var colParams = col && col.params ? col.params : {};
    var widthSpec = getCanvasColumnWidthSpec(colParams.w);
    colEl.style.flex = '1 1 100%';
    colEl.style.maxWidth = '';
    colEl.style.minWidth = '0';
    colEl.removeAttribute('data-canvas-width-mode');
    if (!widthSpec) return;
    if (widthSpec.kind === 'percent') {
      var widthValue = Math.max(0, Math.min(100, widthSpec.value));
      var widthCss = widthValue.toFixed(4).replace(/\.?0+$/, '') + '%';
      colEl.style.flex = '0 0 ' + widthCss;
      colEl.style.maxWidth = widthCss;
      colEl.setAttribute('data-canvas-width-mode', 'percent');
      return;
    }
    colEl.style.flex = '0 0 ' + Math.round(widthSpec.value) + 'px';
    colEl.style.maxWidth = Math.round(widthSpec.value) + 'px';
    colEl.setAttribute('data-canvas-width-mode', 'fixed');
  }

  return {
    init: init,
    normalizeCanvasStackDirection: normalizeCanvasStackDirection,
    normalizeCanvasAnchorSide: normalizeCanvasAnchorSide,
    parseCanvasAnchorOffset: parseCanvasAnchorOffset,
    getDefaultCanvasConnectionSide: getDefaultCanvasConnectionSide,
    resolveCanvasConnectionAnchor: resolveCanvasConnectionAnchor,
    canvasSideToVector: canvasSideToVector,
    getCanvasConnectionPath: getCanvasConnectionPath,
    extractCanvasStackTags: extractCanvasStackTags,
    applyCanvasColumnLayout: applyCanvasColumnLayout
  };
})();
window.LexeraCanvasLayout = LexeraCanvasLayout;
