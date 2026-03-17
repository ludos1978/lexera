(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraScrollBehavior = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeSpeedMultiplierValue(rawValue, minValue, maxValue) {
    var text = String(rawValue == null ? '' : rawValue).trim().toLowerCase();
    if (!text || text === 'default' || text === 'normal') return '1';
    if (text.charAt(text.length - 1) === 'x') text = text.slice(0, -1).trim();
    var parsed = parseFloat(text);
    if (!isFinite(parsed)) return '1';
    if (parsed < minValue) parsed = minValue;
    if (parsed > maxValue) parsed = maxValue;
    return String(Math.round(parsed * 100) / 100);
  }

  function getSpeedMultiplier(source, key, fallback, normalizer) {
    var rawValue = null;
    var resolvedFallback = fallback == null ? '1' : fallback;
    if (typeof source === 'function') {
      rawValue = source(key, resolvedFallback);
    } else if (source && typeof source === 'object') {
      if (source.boardSettings && typeof source.boardSettings === 'object') {
        rawValue = source.boardSettings[key];
      } else {
        rawValue = source[key];
      }
    } else if (source != null) {
      rawValue = source;
    }
    return parseFloat(normalizer(rawValue == null ? resolvedFallback : rawValue)) || 1;
  }

  function normalizeBoardScrollSpeedValue(rawValue) {
    var text = String(rawValue == null ? '' : rawValue).trim().toLowerCase();
    if (!text || text === 'default' || text === 'normal') return '0.06';
    return normalizeSpeedMultiplierValue(text, 0.01, 3);
  }

  function getBoardScrollSpeedMultiplier(source, fallback) {
    return getSpeedMultiplier(source, 'scrollSpeed', fallback == null ? '0.06' : fallback, normalizeBoardScrollSpeedValue);
  }

  function normalizeBoardZoomSpeedValue(rawValue) {
    return normalizeSpeedMultiplierValue(rawValue, 0.01, 2);
  }

  function getBoardZoomSpeedMultiplier(source, fallback) {
    return getSpeedMultiplier(source, 'zoomSpeed', fallback, normalizeBoardZoomSpeedValue);
  }

  function scaleZoomDelta(baseDelta, source, options) {
    options = options || {};
    var delta = Number(baseDelta) || 0;
    if (!delta) return 0;
    var precision = typeof options.precision === 'number' && isFinite(options.precision)
      ? Math.max(0, Math.floor(options.precision))
      : 4;
    var factor = Math.pow(10, precision);
    var scaled = Math.round(Math.abs(delta) * getBoardZoomSpeedMultiplier(source, options.fallback) * factor) / factor;
    if (!scaled) scaled = 1 / factor;
    return delta < 0 ? -scaled : scaled;
  }

  function normalizeWheelDeltaToPixels(delta, deltaMode, options) {
    if (!isFinite(delta) || !delta) return 0;
    if (deltaMode === 1) return delta * 16;
    if (deltaMode === 2) {
      options = options || {};
      var win = options.window || (typeof window !== 'undefined' ? window : null);
      var viewportHeight = typeof options.viewportHeight === 'number'
        ? options.viewportHeight
        : (win && typeof win.innerHeight === 'number' ? win.innerHeight : 800);
      return delta * Math.max(100, viewportHeight * 0.85);
    }
    return delta;
  }

  function canStartCanvasPointerPan(target, button, altKey) {
    if (!target || typeof target.closest !== 'function') return false;
    if (!target.closest('#columns-container')) return false;
    if (target.closest('.card-editor-dialog, .export-dialog, .mgmt-panel')) return false;
    if (button === 1) return true;
    if (button === 0 && altKey) return true;
    if (button !== 0) return false;
    if (!target.closest('.board-row-content, .canvas-scene')) return false;
    if (target.closest('.board-stack, .column, .card, .board-row-header, button, input, textarea, select, a, [contenteditable="true"], .cm-editor, .cm-scroller, .monaco-editor')) {
      return false;
    }
    return true;
  }

  function canScrollableElementConsumeWheelDelta(el, axis, delta, options) {
    if (!el || !delta) return false;
    options = options || {};
    var isHorizontal = axis === 'x';
    var styleGetter = typeof options.getComputedStyle === 'function'
      ? options.getComputedStyle
      : (typeof getComputedStyle === 'function' ? getComputedStyle : null);
    var styles = styleGetter ? styleGetter(el) : null;
    var overflow = styles
      ? String(isHorizontal ? styles.overflowX || '' : styles.overflowY || '').toLowerCase()
      : '';
    if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') return false;
    var maxScroll = isHorizontal
      ? (el.scrollWidth || 0) - (el.clientWidth || 0)
      : (el.scrollHeight || 0) - (el.clientHeight || 0);
    if (!(maxScroll > 0.5)) return false;
    var currentScroll = isHorizontal ? (el.scrollLeft || 0) : (el.scrollTop || 0);
    if (delta < 0) return currentScroll > 0.5;
    return currentScroll < maxScroll - 0.5;
  }

  function shouldHandleBoardViewportWheelEvent(target, container, deltaX, deltaY, options) {
    if (!container || (!deltaX && !deltaY)) return false;
    options = options || {};
    var doc = options.document || (typeof document !== 'undefined' ? document : null);
    var stopNode = doc ? doc.body : null;
    var node = target && target.nodeType === 1 ? target : (target ? target.parentElement : null);
    while (node && node !== container && node !== stopNode) {
      if (canScrollableElementConsumeWheelDelta(node, 'y', deltaY, options) || canScrollableElementConsumeWheelDelta(node, 'x', deltaX, options)) {
        return false;
      }
      node = node.parentElement;
    }
    return true;
  }

  return {
    normalizeBoardScrollSpeedValue: normalizeBoardScrollSpeedValue,
    getBoardScrollSpeedMultiplier: getBoardScrollSpeedMultiplier,
    normalizeBoardZoomSpeedValue: normalizeBoardZoomSpeedValue,
    getBoardZoomSpeedMultiplier: getBoardZoomSpeedMultiplier,
    scaleZoomDelta: scaleZoomDelta,
    normalizeWheelDeltaToPixels: normalizeWheelDeltaToPixels,
    canStartCanvasPointerPan: canStartCanvasPointerPan,
    canScrollableElementConsumeWheelDelta: canScrollableElementConsumeWheelDelta,
    shouldHandleBoardViewportWheelEvent: shouldHandleBoardViewportWheelEvent
  };
}));
