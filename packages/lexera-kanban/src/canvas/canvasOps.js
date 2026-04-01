/**
 * Canvas Ops — canvas viewport, zoom, pan, grid, connections, scroll indicators,
 * focus-stacks control, row-bounds sync, and DOM helpers for canvas boards.
 *
 * Dependencies injected via init().
 */
var LexeraCanvasOps = (function () {
  'use strict';

  var _deps = {};

  // ── State ──
  var _canvasZoom = 1;
  var _canvasPanX = 0;
  var _canvasPanY = 0;

  // ── Dependency accessors ──
  function getElColumnsContainer() { return _deps.getElColumnsContainer(); }
  function isCanvasBoardLayout() { return _deps.isCanvasBoardLayout(); }
  function showNotification(msg) { _deps.showNotification(msg); }
  function getTagColor(tag) { return _deps.getTagColor(tag); }
  function getBoardSettingValue(key, fallback) { return _deps.getBoardSettingValue(key, fallback); }
  function normalizeCanvasGridValue(value) { return _deps.normalizeCanvasGridValue(value); }
  function getCanvasMathApi() { return _deps.getCanvasMathApi(); }
  function getCanvasViewportApi() { return _deps.getCanvasViewportApi(); }
  function getCanvasLayoutApi() { return _deps.getCanvasLayoutApi(); }
  function getScrollBehaviorApi() { return _deps.getScrollBehaviorApi(); }
  function extractCanvasConnectionSpecs(title) { return _deps.extractCanvasConnectionSpecs(title); }
  function extractCanvasStackTags(title) { return _deps.extractCanvasStackTags(title); }
  function getCanvasRenderedStackMetrics(stackEl) { return _deps.getCanvasRenderedStackMetrics(stackEl); }
  function getCanvasConnectionPath(sourceAnchor, targetAnchor) { return _deps.getCanvasConnectionPath(sourceAnchor, targetAnchor); }
  function getDefaultCanvasConnectionSide(sourceBox, targetBox, role) { return _deps.getDefaultCanvasConnectionSide(sourceBox, targetBox, role); }
  function resolveCanvasConnectionAnchor(box, params, keys, fallbackSide) { return _deps.resolveCanvasConnectionAnchor(box, params, keys, fallbackSide); }
  function parseCanvasLayoutNumber(value, fallback) { return _deps.parseCanvasLayoutNumber(value, fallback); }
  function calculateCanvasSurface(stackMetrics, options) { return _deps.calculateCanvasSurface(stackMetrics, options); }
  function resolveCanvasGridStep(stackMetrics, rawValue) { return _deps.resolveCanvasGridStep(stackMetrics, rawValue); }
  function getNextCanvasStackPlacement(stacks) { return _deps.getNextCanvasStackPlacement(stacks); }

  // ── Constants ──
  var CANVAS_MIN_ROW_WIDTH = 960;
  var CANVAS_MIN_ROW_HEIGHT = 640;

  // ── DOM helpers ──

  function getCanvasSceneElement(rowContent, createIfMissing) {
    if (!rowContent || typeof rowContent.querySelector !== 'function') return null;
    var scene = rowContent.querySelector(':scope > .canvas-scene');
    if (!scene && createIfMissing && typeof document !== 'undefined' && document.createElement) {
      scene = document.createElement('div');
      scene.className = 'canvas-scene';
      rowContent.insertBefore(scene, rowContent.firstChild);
    }
    return scene;
  }

  function getCanvasStackElements(rowContent) {
    if (!rowContent || typeof rowContent.querySelectorAll !== 'function') return [];
    var scene = getCanvasSceneElement(rowContent, false);
    if (scene && typeof scene.querySelectorAll === 'function') {
      return scene.querySelectorAll(':scope > .board-stack');
    }
    return rowContent.querySelectorAll(':scope > .board-stack');
  }

  function getCanvasConnectionLayerElement(rowContent) {
    var scene = getCanvasSceneElement(rowContent, false);
    var root = scene || rowContent;
    if (!root || typeof root.querySelector !== 'function') return null;
    return root.querySelector(':scope > .canvas-connection-layer');
  }

  function getPrimaryCanvasRowContent(container) {
    if (!container || typeof container.querySelector !== 'function') return null;
    return container.querySelector('.board-row-content');
  }

  // ── Grid background ──

  function updateCanvasGridBackground(rowContent, gridStep) {
    if (!rowContent) return;
    if (gridStep <= 0) {
      rowContent.style.backgroundImage = 'none';
      return;
    }
    var cs = getComputedStyle(rowContent);
    var borderColor = cs.getPropertyValue('--border').trim() || '#888';
    var size = gridStep;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '">'
      + '<rect x="0" y="0" width="1" height="' + size + '" fill="' + borderColor + '" opacity="0.34"/>'
      + '<rect x="0" y="0" width="' + size + '" height="1" fill="' + borderColor + '" opacity="0.34"/>'
      + '</svg>';
    rowContent.style.backgroundImage = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  // ── Row connections ──

  function syncCanvasRowConnections(rowContent) {
    if (!rowContent || !rowContent.querySelectorAll) return;
    var existingLayer = getCanvasConnectionLayerElement(rowContent);
    if (existingLayer) existingLayer.remove();

    var stackEls = getCanvasStackElements(rowContent);
    if (!stackEls.length) return;

    var scene = getCanvasSceneElement(rowContent, false);
    var layerRoot = scene || rowContent;

    var stackEntries = [];
    var tagIndex = {};
    for (var i = 0; i < stackEls.length; i++) {
      var stackEl = stackEls[i];
      var title = stackEl.getAttribute('data-stack-title') || '';
      var box = getCanvasRenderedStackMetrics(stackEl);
      var entry = {
        el: stackEl,
        title: title,
        box: box,
        tags: extractCanvasStackTags(title)
      };
      stackEntries.push(entry);
      for (var t = 0; t < entry.tags.length; t++) {
        if (!tagIndex[entry.tags[t]]) tagIndex[entry.tags[t]] = entry;
      }
    }

    var zoom = _canvasZoom || 1;
    var width = Math.max(
      parseCanvasLayoutNumber(scene && scene.style.width, CANVAS_MIN_ROW_WIDTH),
      layerRoot.scrollWidth || 0,
      (rowContent.clientWidth || 0) / zoom
    );
    var height = Math.max(
      parseCanvasLayoutNumber(scene && scene.style.height, CANVAS_MIN_ROW_HEIGHT),
      layerRoot.scrollHeight || 0,
      (rowContent.clientHeight || 0) / zoom
    );
    var svgNs = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'canvas-connection-layer');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('aria-hidden', 'true');

    var defs = document.createElementNS(svgNs, 'defs');
    var marker = document.createElementNS(svgNs, 'marker');
    marker.setAttribute('id', 'canvas-connection-arrow');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('orient', 'auto-start-reverse');
    var markerPath = document.createElementNS(svgNs, 'path');
    markerPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    markerPath.setAttribute('fill', 'context-stroke');
    marker.appendChild(markerPath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    var hasPaths = false;
    for (var s = 0; s < stackEntries.length; s++) {
      var sourceEntry = stackEntries[s];
      var specs = extractCanvasConnectionSpecs(sourceEntry.title);
      for (var c = 0; c < specs.length; c++) {
        var spec = specs[c];
        var targetEntry = tagIndex[spec.targetTag];
        if (!targetEntry || targetEntry === sourceEntry) continue;
        var sourceFallbackSide = getDefaultCanvasConnectionSide(sourceEntry.box, targetEntry.box, 'source');
        var targetFallbackSide = getDefaultCanvasConnectionSide(sourceEntry.box, targetEntry.box, 'target');
        var sourceAnchor = resolveCanvasConnectionAnchor(sourceEntry.box, spec.params, {
          side: 'source',
          aliasSide: 'from',
          position: 'sourcePosition',
          x: spec.params.sourceX != null ? 'sourceX' : 'sx',
          y: spec.params.sourceY != null ? 'sourceY' : 'sy'
        }, sourceFallbackSide);
        var targetAnchor = resolveCanvasConnectionAnchor(targetEntry.box, spec.params, {
          side: 'target',
          aliasSide: 'to',
          position: 'targetPosition',
          x: spec.params.targetX != null ? 'targetX' : 'tx',
          y: spec.params.targetY != null ? 'targetY' : 'ty'
        }, targetFallbackSide);
        var path = document.createElementNS(svgNs, 'path');
        path.setAttribute('class', 'canvas-connection-path');
        path.setAttribute('d', getCanvasConnectionPath(sourceAnchor, targetAnchor));
        path.setAttribute('marker-end', 'url(#canvas-connection-arrow)');
        path.setAttribute('stroke', getTagColor(spec.targetTag));
        svg.appendChild(path);
        hasPaths = true;
      }
    }

    if (!hasPaths) return;
    layerRoot.insertBefore(svg, layerRoot.firstChild);
  }

  // ── Row bounds ──

  function syncCanvasRowBounds(root) {
    if (!isCanvasBoardLayout()) return;
    var container = root && typeof root.querySelectorAll === 'function' ? root : getElColumnsContainer();
    if (!container || !container.querySelectorAll) return;
    var rowContents = container.querySelectorAll('.board-row-content');
    for (var i = 0; i < rowContents.length; i++) {
      var rowContent = rowContents[i];
      var scene = getCanvasSceneElement(rowContent, true);
      var stackEls = getCanvasStackElements(rowContent);
      var metrics = [];
      for (var s = 0; s < stackEls.length; s++) {
        metrics.push(getCanvasRenderedStackMetrics(stackEls[s]));
      }
      var gridMode = normalizeCanvasGridValue(getBoardSettingValue('canvasGrid', '32'));
      var surface = calculateCanvasSurface(metrics);
      var gridStep = resolveCanvasGridStep(metrics, gridMode);
      if (scene) {
        var stableOffsetX = container.__canvasSceneOffsetX != null ? container.__canvasSceneOffsetX : surface.offsetX;
        var stableOffsetY = container.__canvasSceneOffsetY != null ? container.__canvasSceneOffsetY : surface.offsetY;
        container.__canvasSceneOffsetX = stableOffsetX;
        container.__canvasSceneOffsetY = stableOffsetY;
        scene.style.left = stableOffsetX + 'px';
        scene.style.top = stableOffsetY + 'px';
        scene.style.width = surface.width + 'px';
        scene.style.height = surface.height + 'px';
      }
      rowContent.style.setProperty('--canvas-grid-size', Math.max(1, gridStep) + 'px');
      updateCanvasGridBackground(rowContent, gridStep);
      rowContent.style.setProperty('--canvas-scene-offset-x', (container.__canvasSceneOffsetX || 0) + 'px');
      rowContent.style.setProperty('--canvas-scene-offset-y', (container.__canvasSceneOffsetY || 0) + 'px');
      rowContent.setAttribute('data-canvas-grid', gridMode);
      rowContent.__canvasSurface = surface;
      syncCanvasRowConnections(rowContent);
    }
    updateCanvasScrollIndicators(container);
    scheduleCanvasFocusStacksControlSync(container);
  }

  function scheduleCanvasRowBoundsSync(root) {
    var container = root && typeof root.querySelectorAll === 'function' ? root : getElColumnsContainer();
    if (!container) return;
    if (container.__canvasBoundsSyncScheduled) return;
    container.__canvasBoundsSyncScheduled = true;
    requestAnimationFrame(function () {
      container.__canvasBoundsSyncScheduled = false;
      if (!container.isConnected) return;
      syncCanvasRowBounds(container);
    });
  }

  // ── Scroll indicators ──

  function updateCanvasScrollIndicators(container) {
    if (!container) container = getElColumnsContainer();
    if (!container) return;
    var hBar = container.querySelector('.canvas-scroll-indicator-h');
    var vBar = container.querySelector('.canvas-scroll-indicator-v');
    if (!hBar || !vBar) return;
    var rowContent = container.querySelector('.board-row-content');
    var surface = rowContent && rowContent.__canvasSurface;
    if (!surface) { hBar.style.opacity = '0'; vBar.style.opacity = '0'; return; }
    var zoom = _canvasZoom || 1;
    var viewW = container.clientWidth || 1;
    var viewH = container.clientHeight || 1;
    var visW = viewW / zoom;
    var visH = viewH / zoom;
    var visLeft = (-surface.offsetX - _canvasPanX) / zoom;
    var visTop = (-surface.offsetY - _canvasPanY) / zoom;
    var totalLeft = Math.min(surface.left, visLeft);
    var totalTop = Math.min(surface.top, visTop);
    var totalW = (Math.max(surface.left + surface.width, visLeft + visW) - totalLeft) || 1;
    var totalH = (Math.max(surface.top + surface.height, visTop + visH) - totalTop) || 1;
    var thumbLeft = (visLeft - totalLeft) / totalW;
    var thumbWidth = visW / totalW;
    var thumbTop = (visTop - totalTop) / totalH;
    var thumbHeight = visH / totalH;
    if (thumbWidth >= 0.98 && thumbHeight >= 0.98) {
      hBar.style.opacity = '0';
      vBar.style.opacity = '0';
      return;
    }
    var barMargin = 8;
    var trackW = viewW - barMargin * 2;
    var trackH = viewH - barMargin * 2;
    hBar.style.left = Math.round(barMargin + thumbLeft * trackW) + 'px';
    hBar.style.width = Math.max(24, Math.round(thumbWidth * trackW)) + 'px';
    vBar.style.top = Math.round(barMargin + thumbTop * trackH) + 'px';
    vBar.style.height = Math.max(24, Math.round(thumbHeight * trackH)) + 'px';
    hBar.style.removeProperty('opacity');
    vBar.style.removeProperty('opacity');
  }

  function ensureCanvasScrollIndicators(container) {
    if (!container) return;
    if (container.querySelector('.canvas-scroll-indicator-h')) return;
    var hBar = document.createElement('div');
    hBar.className = 'canvas-scroll-indicator canvas-scroll-indicator-h';
    var vBar = document.createElement('div');
    vBar.className = 'canvas-scroll-indicator canvas-scroll-indicator-v';
    container.appendChild(hBar);
    container.appendChild(vBar);
  }

  function removeCanvasScrollIndicators() {
    var container = getElColumnsContainer();
    if (!container) return;
    var indicators = container.querySelectorAll('.canvas-scroll-indicator');
    for (var i = 0; i < indicators.length; i++) {
      indicators[i].remove();
    }
  }

  // ── Metric collection ──

  function collectCanvasStackMetrics(rowContent) {
    var stackEls = getCanvasStackElements(rowContent);
    var metrics = [];
    for (var i = 0; i < stackEls.length; i++) {
      metrics.push(getCanvasRenderedStackMetrics(stackEls[i]));
    }
    return metrics;
  }

  function collectRenderedCanvasStackRects(rowContent) {
    var stackEls = getCanvasStackElements(rowContent);
    var rects = [];
    for (var i = 0; i < stackEls.length; i++) {
      var rect = stackEls[i].getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      rects.push({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      });
    }
    return rects;
  }

  // ── Focus-stacks control ──

  function ensureCanvasFocusStacksControl(container) {
    if (!container || typeof document === 'undefined' || !document.createElement) return null;
    var control = container.querySelector('.canvas-focus-stacks-control');
    if (control) return control;
    control = document.createElement('div');
    control.className = 'canvas-focus-stacks-control';
    control.hidden = true;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'board-action-btn canvas-focus-stacks-btn';
    button.textContent = 'Focus stacks';
    button.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      focusCanvasStacks();
    });
    control.appendChild(button);
    container.appendChild(control);
    return control;
  }

  function removeCanvasFocusStacksControl() {
    var container = getElColumnsContainer();
    if (!container) return;
    var control = container.querySelector('.canvas-focus-stacks-control');
    if (control) control.remove();
  }

  function updateCanvasFocusStacksControl(container) {
    if (!container) container = getElColumnsContainer();
    if (!container) return;
    if (!isCanvasBoardLayout()) {
      removeCanvasFocusStacksControl();
      return;
    }
    var rowContent = getPrimaryCanvasRowContent(container);
    if (!rowContent) {
      removeCanvasFocusStacksControl();
      return;
    }
    var stackRects = collectRenderedCanvasStackRects(rowContent);
    if (!stackRects.length) {
      removeCanvasFocusStacksControl();
      return;
    }
    var control = ensureCanvasFocusStacksControl(container);
    if (!control) return;
    var viewportRect = container.getBoundingClientRect();
    var hasVisibleStack = getCanvasViewportApi().hasAnyVisibleCanvasStack(stackRects, viewportRect);
    control.hidden = hasVisibleStack;
  }

  function scheduleCanvasFocusStacksControlSync(container) {
    if (!container) container = getElColumnsContainer();
    if (!container || container.__canvasFocusStacksControlScheduled) return;
    container.__canvasFocusStacksControlScheduled = true;
    requestAnimationFrame(function () {
      container.__canvasFocusStacksControlScheduled = false;
      if (!container.isConnected) return;
      updateCanvasFocusStacksControl(container);
    });
  }

  function focusCanvasStacks() {
    var container = getElColumnsContainer();
    if (!container || !isCanvasBoardLayout()) return;
    var rowContent = getPrimaryCanvasRowContent(container);
    if (!rowContent) return;
    var stackMetrics = collectCanvasStackMetrics(rowContent);
    if (!stackMetrics.length) return;
    var surface = rowContent.__canvasSurface || calculateCanvasSurface(stackMetrics);
    var focusViewport = getCanvasViewportApi().calculateCanvasFocusViewport(
      stackMetrics,
      {
        width: container.clientWidth || 0,
        height: container.clientHeight || 0
      },
      {
        padding: 36,
        minZoom: 0.25,
        maxZoom: 3,
        surfaceOffsetX: container.__canvasSceneOffsetX != null ? container.__canvasSceneOffsetX : (surface ? surface.offsetX : 0),
        surfaceOffsetY: container.__canvasSceneOffsetY != null ? container.__canvasSceneOffsetY : (surface ? surface.offsetY : 0)
      }
    );
    if (!focusViewport) return;
    applyCanvasZoom(focusViewport.zoom);
    applyCanvasPan(focusViewport.panX, focusViewport.panY);
    scheduleCanvasFocusStacksControlSync(container);
  }

  // ── Pan ──

  function applyCanvasPan(panX, panY) {
    _canvasPanX = panX;
    _canvasPanY = panY;
    var container = getElColumnsContainer();
    if (!container) return;
    container.style.setProperty('--canvas-pan-x', panX + 'px');
    container.style.setProperty('--canvas-pan-y', panY + 'px');
    updateCanvasScrollIndicators(container);
    scheduleCanvasFocusStacksControlSync(container);
  }

  function resetCanvasPan() {
    _canvasPanX = 0;
    _canvasPanY = 0;
    var container = getElColumnsContainer();
    if (container) {
      container.style.setProperty('--canvas-pan-x', '0px');
      container.style.setProperty('--canvas-pan-y', '0px');
      delete container.__canvasSceneOffsetX;
      delete container.__canvasSceneOffsetY;
    }
  }

  // ── Zoom ──

  function buildCanvasZoomMenuItems() {
    var levels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
    return levels.map(function (z) {
      return { id: 'set-canvas-zoom:' + z, label: Math.round(z * 100) + '%', checked: Math.abs(_canvasZoom - z) < 0.01 };
    });
  }

  function applyCanvasZoom(zoom, localOriginX, localOriginY) {
    var container = getElColumnsContainer();
    if (!container) return;
    var oldZoom = _canvasZoom;
    _canvasZoom = zoom;
    container.style.zoom = '';
    container.style.setProperty('--canvas-zoom', String(zoom));
    // Adjust pan to keep the point under the cursor stationary
    // Screen position of canvas point cx: containerLeft + offsetX + panX + cx * zoom
    // So origin relative to transform base: localOriginX - offsetX
    if (localOriginX != null && localOriginY != null && oldZoom !== zoom) {
      var ratio = zoom / oldZoom;
      var offsetX = container.__canvasSceneOffsetX || 0;
      var offsetY = container.__canvasSceneOffsetY || 0;
      var newPanX = _canvasPanX * ratio + (localOriginX - offsetX) * (1 - ratio);
      var newPanY = _canvasPanY * ratio + (localOriginY - offsetY) * (1 - ratio);
      applyCanvasPan(newPanX, newPanY);
    }
    scheduleCanvasRowBoundsSync(container);
    scheduleCanvasFocusStacksControlSync(container);
    showNotification('Canvas Zoom ' + Math.round(zoom * 100) + '%');
  }

  function nudgeCanvasZoom(delta, localOriginX, localOriginY) {
    var next = Math.round((_canvasZoom + delta) * 10000) / 10000;
    if (next < 0.25) next = 0.25;
    if (next > 3) next = 3;
    if (next === _canvasZoom) return;
    applyCanvasZoom(next, localOriginX, localOriginY);
  }

  function getCanvasZoomStep(delta) {
    return getScrollBehaviorApi().scaleZoomDelta(delta, getBoardSettingValue, { fallback: '1', precision: 4 });
  }

  // ── Placement ──

  function applyDefaultCanvasPlacementToStack(row, stack) {
    if (!isCanvasBoardLayout() || !row || !stack) return stack;
    if (!stack.params) stack.params = {};
    if (stack.params.x != null || stack.params.y != null) return stack;
    var placement = getNextCanvasStackPlacement(row.stacks || []);
    stack.params.x = String(placement.x);
    stack.params.y = String(placement.y);
    return stack;
  }

  // ── State accessors ──

  function getCanvasZoom() { return _canvasZoom; }
  function getCanvasPanX() { return _canvasPanX; }
  function getCanvasPanY() { return _canvasPanY; }
  function setCanvasZoom(v) { _canvasZoom = v; }
  function setCanvasPanX(v) { _canvasPanX = v; }
  function setCanvasPanY(v) { _canvasPanY = v; }

  // ── Lifecycle ──

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  return {
    init: init,
    // State
    getCanvasZoom: getCanvasZoom,
    getCanvasPanX: getCanvasPanX,
    getCanvasPanY: getCanvasPanY,
    setCanvasZoom: setCanvasZoom,
    setCanvasPanX: setCanvasPanX,
    setCanvasPanY: setCanvasPanY,
    // DOM helpers
    getCanvasSceneElement: getCanvasSceneElement,
    getCanvasStackElements: getCanvasStackElements,
    getCanvasConnectionLayerElement: getCanvasConnectionLayerElement,
    getPrimaryCanvasRowContent: getPrimaryCanvasRowContent,
    // Grid
    updateCanvasGridBackground: updateCanvasGridBackground,
    // Connections
    syncCanvasRowConnections: syncCanvasRowConnections,
    // Row bounds
    syncCanvasRowBounds: syncCanvasRowBounds,
    scheduleCanvasRowBoundsSync: scheduleCanvasRowBoundsSync,
    // Scroll indicators
    updateCanvasScrollIndicators: updateCanvasScrollIndicators,
    ensureCanvasScrollIndicators: ensureCanvasScrollIndicators,
    removeCanvasScrollIndicators: removeCanvasScrollIndicators,
    // Metrics
    collectCanvasStackMetrics: collectCanvasStackMetrics,
    collectRenderedCanvasStackRects: collectRenderedCanvasStackRects,
    // Focus-stacks control
    ensureCanvasFocusStacksControl: ensureCanvasFocusStacksControl,
    removeCanvasFocusStacksControl: removeCanvasFocusStacksControl,
    updateCanvasFocusStacksControl: updateCanvasFocusStacksControl,
    scheduleCanvasFocusStacksControlSync: scheduleCanvasFocusStacksControlSync,
    focusCanvasStacks: focusCanvasStacks,
    // Pan
    applyCanvasPan: applyCanvasPan,
    resetCanvasPan: resetCanvasPan,
    // Zoom
    buildCanvasZoomMenuItems: buildCanvasZoomMenuItems,
    applyCanvasZoom: applyCanvasZoom,
    nudgeCanvasZoom: nudgeCanvasZoom,
    getCanvasZoomStep: getCanvasZoomStep,
    // Placement
    applyDefaultCanvasPlacementToStack: applyDefaultCanvasPlacementToStack
  };
})();
if (typeof globalThis !== 'undefined') globalThis.LexeraCanvasOps = LexeraCanvasOps;
if (typeof window !== 'undefined') window.LexeraCanvasOps = LexeraCanvasOps;
