// Leading line comment to dodge slice-13 checkJs duplicate-id quirk.

/**
 * @typedef {Object} LexeraCanvasViewportRect
 * @property {number} left
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * @typedef {Object} LexeraCanvasViewportStackMetric
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * @typedef {Object} LexeraCanvasViewportFocusOptions
 * @property {number} [padding]
 * @property {number} [minZoom]
 * @property {number} [maxZoom]
 * @property {number} [surfaceOffsetX]
 * @property {number} [surfaceOffsetY]
 */

/**
 * @typedef {Object} LexeraCanvasViewportFocusResult
 * @property {number} zoom
 * @property {number} panX
 * @property {number} panY
 * @property {LexeraCanvasViewportRect} bounds
 */

/**
 * @typedef {Object} LexeraCanvasViewportApi
 * @property {(a: LexeraCanvasViewportRect | null | undefined, b: LexeraCanvasViewportRect | null | undefined) => boolean} rectsIntersect
 * @property {(stackRects: Array<LexeraCanvasViewportRect> | null | undefined, viewportRect: LexeraCanvasViewportRect | null | undefined) => boolean} hasAnyVisibleCanvasStack
 * @property {(stackMetrics: Array<LexeraCanvasViewportStackMetric> | null | undefined) => (LexeraCanvasViewportRect | null)} getCanvasStackBounds
 * @property {(stackMetrics: Array<LexeraCanvasViewportStackMetric> | null | undefined, viewportSize: { width?: number; height?: number } | null | undefined, options?: LexeraCanvasViewportFocusOptions) => (LexeraCanvasViewportFocusResult | null)} calculateCanvasFocusViewport
 */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  /** @type {any} */ (root).LexeraCanvasViewport = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** @param {LexeraCanvasViewportRect | null | undefined} rect */
  function normalizeRect(rect) {
    if (!rect) return null;
    var left = Number(rect.left);
    var top = Number(rect.top);
    var right = Number(rect.right);
    var bottom = Number(rect.bottom);
    if (!isFinite(left) || !isFinite(top) || !isFinite(right) || !isFinite(bottom)) return null;
    return {
      left: left,
      top: top,
      right: right,
      bottom: bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
  }

  function rectsIntersect(a, b) {
    var rectA = normalizeRect(a);
    var rectB = normalizeRect(b);
    if (!rectA || !rectB) return false;
    return rectA.left < rectB.right &&
      rectA.right > rectB.left &&
      rectA.top < rectB.bottom &&
      rectA.bottom > rectB.top;
  }

  function hasAnyVisibleCanvasStack(stackRects, viewportRect) {
    var rects = Array.isArray(stackRects) ? stackRects : [];
    for (var i = 0; i < rects.length; i++) {
      if (rectsIntersect(rects[i], viewportRect)) return true;
    }
    return false;
  }

  function getCanvasStackBounds(stackMetrics) {
    var metrics = Array.isArray(stackMetrics) ? stackMetrics : [];
    var minLeft = null;
    var minTop = null;
    var maxRight = null;
    var maxBottom = null;
    for (var i = 0; i < metrics.length; i++) {
      var metric = metrics[i] || {};
      var left = Number(metric.x);
      var top = Number(metric.y);
      var width = Number(metric.w);
      var height = Number(metric.h);
      if (!isFinite(left) || !isFinite(top) || !isFinite(width) || !isFinite(height)) continue;
      if (width <= 0 || height <= 0) continue;
      var right = left + width;
      var bottom = top + height;
      if (minLeft == null || left < minLeft) minLeft = left;
      if (minTop == null || top < minTop) minTop = top;
      if (maxRight == null || right > maxRight) maxRight = right;
      if (maxBottom == null || bottom > maxBottom) maxBottom = bottom;
    }
    if (minLeft == null || minTop == null || maxRight == null || maxBottom == null) return null;
    return {
      left: minLeft,
      top: minTop,
      right: maxRight,
      bottom: maxBottom,
      width: maxRight - minLeft,
      height: maxBottom - minTop
    };
  }

  function calculateCanvasFocusViewport(stackMetrics, viewportSize, options) {
    var bounds = getCanvasStackBounds(stackMetrics);
    if (!bounds) return null;

    viewportSize = viewportSize || {};
    options = options || {};

    var viewportWidth = Math.max(1, Number(viewportSize.width) || 0);
    var viewportHeight = Math.max(1, Number(viewportSize.height) || 0);
    var padding = Math.max(0, Number(options.padding) || 0);
    var minZoom = Math.max(0.01, Number(options.minZoom) || 0.25);
    var maxZoom = Math.max(minZoom, Number(options.maxZoom) || 3);
    var surfaceOffsetX = isFinite(Number(options.surfaceOffsetX)) ? Number(options.surfaceOffsetX) : 0;
    var surfaceOffsetY = isFinite(Number(options.surfaceOffsetY)) ? Number(options.surfaceOffsetY) : 0;

    var availableWidth = Math.max(1, viewportWidth - padding * 2);
    var availableHeight = Math.max(1, viewportHeight - padding * 2);
    var focusWidth = Math.max(1, bounds.width);
    var focusHeight = Math.max(1, bounds.height);

    var zoom = Math.min(availableWidth / focusWidth, availableHeight / focusHeight, maxZoom);
    if (!isFinite(zoom) || zoom <= 0) zoom = minZoom;
    if (zoom < minZoom) zoom = minZoom;

    var contentWidth = focusWidth * zoom;
    var contentHeight = focusHeight * zoom;
    var desiredLeft = padding + Math.max(0, (availableWidth - contentWidth) / 2);
    var desiredTop = padding + Math.max(0, (availableHeight - contentHeight) / 2);
    var panX = desiredLeft - surfaceOffsetX - bounds.left * zoom;
    var panY = desiredTop - surfaceOffsetY - bounds.top * zoom;

    return {
      zoom: Math.round(zoom * 10000) / 10000,
      panX: Math.round(panX * 100) / 100,
      panY: Math.round(panY * 100) / 100,
      bounds: bounds
    };
  }

  /** @type {LexeraCanvasViewportApi} */
  var publicApi = {
    rectsIntersect: rectsIntersect,
    hasAnyVisibleCanvasStack: hasAnyVisibleCanvasStack,
    getCanvasStackBounds: getCanvasStackBounds,
    calculateCanvasFocusViewport: calculateCanvasFocusViewport
  };
  return publicApi;
}));
