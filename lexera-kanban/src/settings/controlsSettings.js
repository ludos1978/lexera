/**
 * Controls Settings — configurable input bindings for kanban and canvas modes.
 *
 * Each view mode has independently configurable bindings for:
 *   - move: pan/scroll the board viewport
 *   - zoom: zoom in/out
 *   - edit: enter edit mode on the focused element
 *
 * Binding types:
 *   { type: 'scroll', alt?: true, shift?: true }
 *   { type: 'drag', button: 0|1|2, alt?: true, shift?: true }
 *   { type: 'dblclick' }
 *   { type: 'key', key: 'Enter'|'F2'|..., ctrl?: true, alt?: true, shift?: true, meta?: true }
 *
 * IIFE module — no const/let, no ES imports.
 */
var LexeraControlsSettings = (function () {
  'use strict';

  var STORAGE_KEY = 'lexera-controls-settings';

  // ── Default bindings ──

  var DEFAULTS = {
    kanban: {
      move: [
        { type: 'scroll' },
        { type: 'drag', button: 2 },
        { type: 'drag', button: 0, alt: true }
      ],
      zoom: [
        { type: 'scroll', alt: true }
      ],
      edit: [
        { type: 'dblclick' },
        { type: 'key', key: 'Enter' }
      ]
    },
    canvas: {
      move: [
        { type: 'drag', button: 2 },
        { type: 'drag', button: 0, alt: true }
      ],
      zoom: [
        { type: 'scroll' }
      ],
      edit: [
        { type: 'dblclick' },
        { type: 'key', key: 'Enter' }
      ]
    }
  };

  var ACTIONS = ['move', 'zoom', 'edit'];
  var MODES = ['kanban', 'canvas'];

  // ── State ──

  var _bindings = null; // lazy-loaded

  // ── Persistence ──

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return normalize(parsed);
      }
    } catch (e) { /* corrupt or unavailable */ }
    return deepClone(DEFAULTS);
  }

  function save() {
    if (!_bindings) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_bindings));
    } catch (e) { /* quota or private mode */ }
  }

  function ensureLoaded() {
    if (!_bindings) _bindings = load();
    return _bindings;
  }

  // ── Normalization ──

  function normalize(data) {
    var result = {};
    for (var mi = 0; mi < MODES.length; mi++) {
      var mode = MODES[mi];
      result[mode] = {};
      var src = (data && data[mode]) || {};
      for (var ai = 0; ai < ACTIONS.length; ai++) {
        var action = ACTIONS[ai];
        result[mode][action] = Array.isArray(src[action]) ? src[action].slice() : [];
      }
    }
    return result;
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ── Public API: get/set ──

  function getBindings(mode, action) {
    var all = ensureLoaded();
    if (!all[mode] || !all[mode][action]) return [];
    return all[mode][action].slice();
  }

  function setBindings(mode, action, bindings) {
    var all = ensureLoaded();
    if (!all[mode]) all[mode] = {};
    all[mode][action] = Array.isArray(bindings) ? bindings.slice() : [];
    save();
  }

  function addBinding(mode, action, binding) {
    var all = ensureLoaded();
    if (!all[mode]) all[mode] = {};
    if (!Array.isArray(all[mode][action])) all[mode][action] = [];
    // Avoid exact duplicates
    var key = bindingKey(binding);
    for (var i = 0; i < all[mode][action].length; i++) {
      if (bindingKey(all[mode][action][i]) === key) return false;
    }
    all[mode][action].push(binding);
    save();
    return true;
  }

  function removeBinding(mode, action, index) {
    var all = ensureLoaded();
    if (!all[mode] || !Array.isArray(all[mode][action])) return;
    all[mode][action].splice(index, 1);
    save();
  }

  function resetToDefaults() {
    _bindings = deepClone(DEFAULTS);
    save();
  }

  function getAllBindings() {
    return deepClone(ensureLoaded());
  }

  // ── Binding key (for dedup) ──

  function bindingKey(b) {
    if (!b) return '';
    var parts = [b.type || ''];
    if (b.type === 'drag') parts.push('btn' + (b.button || 0));
    if (b.type === 'key') parts.push(b.key || '');
    if (b.ctrl) parts.push('ctrl');
    if (b.alt) parts.push('alt');
    if (b.shift) parts.push('shift');
    if (b.meta) parts.push('meta');
    return parts.join('+');
  }

  // ── Matching: does an event match any binding for (mode, action)? ──

  function matchesScroll(event, mode, action) {
    var list = getBindings(mode, action);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.type !== 'scroll') continue;
      if (!!b.alt !== !!event.altKey) continue;
      if (!!b.shift !== !!event.shiftKey) continue;
      // Never match ctrl/meta scroll — reserved for browser zoom
      if (event.ctrlKey || event.metaKey) continue;
      return true;
    }
    return false;
  }

  function matchesDrag(event, mode, action) {
    var list = getBindings(mode, action);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.type !== 'drag') continue;
      if ((b.button || 0) !== event.button) continue;
      if (!!b.alt !== !!event.altKey) continue;
      if (!!b.shift !== !!event.shiftKey) continue;
      return true;
    }
    return false;
  }

  function matchesKey(event, mode, action) {
    var list = getBindings(mode, action);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.type !== 'key') continue;
      if (b.key !== event.key) continue;
      if (!!b.ctrl !== !!event.ctrlKey) continue;
      if (!!b.alt !== !!event.altKey) continue;
      if (!!b.shift !== !!event.shiftKey) continue;
      if (!!b.meta !== !!event.metaKey) continue;
      return true;
    }
    return false;
  }

  function matchesDblclick(mode, action) {
    var list = getBindings(mode, action);
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === 'dblclick') return true;
    }
    return false;
  }

  // ── Display label for a binding ──

  function bindingLabel(b) {
    if (!b) return '';
    var parts = [];
    if (b.ctrl) parts.push('Ctrl');
    if (b.meta) parts.push('Cmd');
    if (b.alt) parts.push('Alt');
    if (b.shift) parts.push('Shift');
    if (b.type === 'scroll') {
      parts.push('Scroll');
    } else if (b.type === 'drag') {
      var btnNames = { 0: 'Left', 1: 'Middle', 2: 'Right' };
      parts.push((btnNames[b.button] || 'Button ' + b.button) + '-Drag');
    } else if (b.type === 'dblclick') {
      parts.push('Double-Click');
    } else if (b.type === 'key') {
      parts.push(b.key || '?');
    }
    return parts.join('+');
  }

  // ── Defaults access ──

  function getDefaults() {
    return deepClone(DEFAULTS);
  }

  return {
    ACTIONS: ACTIONS,
    MODES: MODES,
    getBindings: getBindings,
    setBindings: setBindings,
    addBinding: addBinding,
    removeBinding: removeBinding,
    resetToDefaults: resetToDefaults,
    getAllBindings: getAllBindings,
    getDefaults: getDefaults,
    matchesScroll: matchesScroll,
    matchesDrag: matchesDrag,
    matchesKey: matchesKey,
    matchesDblclick: matchesDblclick,
    bindingLabel: bindingLabel,
    bindingKey: bindingKey
  };
})();
if (typeof window !== 'undefined') window.LexeraControlsSettings = LexeraControlsSettings;
