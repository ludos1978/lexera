(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraCanvasMath = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CANVAS_DEFAULT_STACK_X = 24;
  var CANVAS_DEFAULT_STACK_Y = 24;
  var CANVAS_DEFAULT_STACK_W = 300;
  var CANVAS_DEFAULT_STACK_H = 220;
  var CANVAS_STACK_SPACING = 28;
  var CANVAS_ROW_PADDING = 40;
  var CANVAS_MIN_ROW_WIDTH = 960;
  var CANVAS_MIN_ROW_HEIGHT = 640;
  var CANVAS_SURFACE_OVERSCAN_X = Math.floor(CANVAS_MIN_ROW_WIDTH / 2);
  var CANVAS_SURFACE_OVERSCAN_Y = Math.floor(CANVAS_MIN_ROW_HEIGHT / 2);

  function parseCanvasLayoutNumber(value, fallback) {
    var n = parseInt(value, 10);
    return isFinite(n) ? n : fallback;
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

  function getCanvasFallbackStackBox(stackIndex, width) {
    width = Math.max(180, parseCanvasLayoutNumber(width, CANVAS_DEFAULT_STACK_W));
    var height = CANVAS_DEFAULT_STACK_H;
    return {
      x: CANVAS_DEFAULT_STACK_X + (stackIndex % 4) * (width + CANVAS_STACK_SPACING),
      y: CANVAS_DEFAULT_STACK_Y + Math.floor(stackIndex / 4) * (height + CANVAS_STACK_SPACING),
      w: width,
      h: height
    };
  }

  function getCanvasStackLayoutBox(stack, stackIndex) {
    var params = stack && stack.params ? stack.params : {};
    var fallback = getCanvasFallbackStackBox(stackIndex, params.w);
    return {
      x: parseCanvasLayoutNumber(params.x, fallback.x),
      y: parseCanvasLayoutNumber(params.y, fallback.y),
      w: Math.max(180, parseCanvasLayoutNumber(params.w, fallback.w)),
      h: fallback.h
    };
  }

  function getCanvasRenderedStackMetrics(stackEl) {
    return {
      x: parseCanvasLayoutNumber(stackEl.style.left, stackEl.offsetLeft || 0),
      y: parseCanvasLayoutNumber(stackEl.style.top, stackEl.offsetTop || 0),
      w: stackEl.offsetWidth || parseCanvasLayoutNumber(stackEl.style.width, CANVAS_DEFAULT_STACK_W),
      h: stackEl.offsetHeight || parseCanvasLayoutNumber(stackEl.style.height, CANVAS_DEFAULT_STACK_H)
    };
  }

  function roundUpCanvasUnit(value, step) {
    var numericValue = parseCanvasLayoutNumber(value, 0);
    var numericStep = Math.max(1, parseCanvasLayoutNumber(step, 1));
    return Math.ceil(numericValue / numericStep) * numericStep;
  }

  function resolveCanvasLargestElementSize(stackMetrics) {
    var metrics = Array.isArray(stackMetrics) ? stackMetrics : [];
    var largest = Math.max(CANVAS_DEFAULT_STACK_W, CANVAS_DEFAULT_STACK_H);
    for (var i = 0; i < metrics.length; i++) {
      var metric = metrics[i] || {};
      largest = Math.max(
        largest,
        Math.max(0, parseCanvasLayoutNumber(metric.w, 0)),
        Math.max(0, parseCanvasLayoutNumber(metric.h, 0))
      );
    }
    return largest;
  }

  function resolveCanvasGridStep(stackMetrics, rawValue) {
    var normalized = normalizeCanvasGridValue(rawValue);
    if (normalized === 'off') return 0;
    if (normalized === 'largest') {
      return Math.max(64, roundUpCanvasUnit(resolveCanvasLargestElementSize(stackMetrics), 16));
    }
    return Math.max(8, parseCanvasLayoutNumber(normalized, 32));
  }

  function calculateCanvasSurface(stackMetrics, options) {
    options = options || {};
    var padding = Math.max(0, parseCanvasLayoutNumber(options.padding, CANVAS_ROW_PADDING));
    var emptyWidth = Math.max(0, parseCanvasLayoutNumber(options.emptyWidth, CANVAS_MIN_ROW_WIDTH));
    var emptyHeight = Math.max(0, parseCanvasLayoutNumber(options.emptyHeight, CANVAS_MIN_ROW_HEIGHT));
    var overscanX = Math.max(0, parseCanvasLayoutNumber(options.overscanX, CANVAS_SURFACE_OVERSCAN_X));
    var overscanY = Math.max(0, parseCanvasLayoutNumber(options.overscanY, CANVAS_SURFACE_OVERSCAN_Y));
    var metrics = Array.isArray(stackMetrics) ? stackMetrics : [];
    var minLeft = 0;
    var minTop = 0;
    var maxRight = 0;
    var maxBottom = 0;
    var hasMetrics = false;

    for (var i = 0; i < metrics.length; i++) {
      var metric = metrics[i] || {};
      var left = parseCanvasLayoutNumber(metric.x, 0);
      var top = parseCanvasLayoutNumber(metric.y, 0);
      var width = Math.max(0, parseCanvasLayoutNumber(metric.w, 0));
      var height = Math.max(0, parseCanvasLayoutNumber(metric.h, 0));
      if (!hasMetrics) {
        minLeft = left;
        minTop = top;
        maxRight = left + width;
        maxBottom = top + height;
        hasMetrics = true;
      } else {
        minLeft = Math.min(minLeft, left);
        minTop = Math.min(minTop, top);
        maxRight = Math.max(maxRight, left + width);
        maxBottom = Math.max(maxBottom, top + height);
      }
    }

    if (!hasMetrics) {
      var emptyLeft = -Math.max(Math.floor(emptyWidth / 2), overscanX);
      var emptyTop = -Math.max(Math.floor(emptyHeight / 2), overscanY);
      return {
        left: emptyLeft,
        top: emptyTop,
        width: Math.max(emptyWidth, Math.abs(emptyLeft) * 2),
        height: Math.max(emptyHeight, Math.abs(emptyTop) * 2),
        offsetX: Math.abs(emptyLeft),
        offsetY: Math.abs(emptyTop)
      };
    }

    var surfaceLeft = minLeft - padding - overscanX;
    var surfaceTop = minTop - padding - overscanY;
    var surfaceRight = maxRight + padding + overscanX;
    var surfaceBottom = maxBottom + padding + overscanY;
    var width = Math.max(emptyWidth, surfaceRight - surfaceLeft);
    var height = Math.max(emptyHeight, surfaceBottom - surfaceTop);

    return {
      left: surfaceLeft,
      top: surfaceTop,
      width: width,
      height: height,
      offsetX: -surfaceLeft,
      offsetY: -surfaceTop
    };
  }

  function getNextCanvasStackPlacement(stacks) {
    var items = Array.isArray(stacks) ? stacks : [];
    if (items.length === 0) {
      return { x: CANVAS_DEFAULT_STACK_X, y: CANVAS_DEFAULT_STACK_Y };
    }
    var maxRight = null;
    var anchorY = null;
    for (var i = 0; i < items.length; i++) {
      var box = getCanvasStackLayoutBox(items[i], i);
      if (maxRight == null || (box.x + box.w) > maxRight) maxRight = box.x + box.w;
      if (anchorY == null || box.y < anchorY) anchorY = box.y;
    }
    return {
      x: (maxRight == null ? CANVAS_DEFAULT_STACK_X : maxRight + CANVAS_STACK_SPACING),
      y: anchorY == null ? CANVAS_DEFAULT_STACK_Y : anchorY
    };
  }

  function getCanvasRowContentMetrics(rowContent, options) {
    options = options || {};
    var rect = rowContent && typeof rowContent.getBoundingClientRect === 'function'
      ? rowContent.getBoundingClientRect()
      : { left: 0, top: 0 };
    var zoom = parseFloat(options.zoom);
    if (!isFinite(zoom) || zoom <= 0) zoom = 1;
    var styleGetter = typeof options.getComputedStyle === 'function'
      ? options.getComputedStyle
      : (typeof getComputedStyle === 'function' ? getComputedStyle : null);
    var styles = styleGetter && rowContent ? styleGetter(rowContent) : null;
    var borderLeft = styles ? parseFloat(styles.borderLeftWidth) || 0 : 0;
    var borderTop = styles ? parseFloat(styles.borderTopWidth) || 0 : 0;
    var container = options.container || null;
    var sceneLeft = container && container.__canvasSceneOffsetX != null ? Number(container.__canvasSceneOffsetX) || 0 : 0;
    var sceneTop = container && container.__canvasSceneOffsetY != null ? Number(container.__canvasSceneOffsetY) || 0 : 0;
    var panX = Number(options.panX);
    var panY = Number(options.panY);
    if (!isFinite(panX)) panX = 0;
    if (!isFinite(panY)) panY = 0;
    return {
      rect: rect,
      zoom: zoom,
      originLeft: rect.left + borderLeft + sceneLeft + panX,
      originTop: rect.top + borderTop + sceneTop + panY
    };
  }

  function getCanvasPositionFromViewportPoint(rowContent, clientX, clientY, grabOffsetX, grabOffsetY, options) {
    if (!rowContent) return { x: 0, y: 0 };
    var metrics = getCanvasRowContentMetrics(rowContent, options);
    return {
      x: Math.round((clientX - metrics.originLeft - (grabOffsetX || 0)) / metrics.zoom),
      y: Math.round((clientY - metrics.originTop - (grabOffsetY || 0)) / metrics.zoom)
    };
  }

  return {
    getCanvasStackLayoutBox: getCanvasStackLayoutBox,
    getCanvasRenderedStackMetrics: getCanvasRenderedStackMetrics,
    resolveCanvasGridStep: resolveCanvasGridStep,
    getNextCanvasStackPlacement: getNextCanvasStackPlacement,
    calculateCanvasSurface: calculateCanvasSurface,
    getCanvasRowContentMetrics: getCanvasRowContentMetrics,
    getCanvasPositionFromViewportPoint: getCanvasPositionFromViewportPoint
  };
}));
