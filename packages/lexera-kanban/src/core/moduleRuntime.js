/**
 * Lexera Module Runtime — shared infrastructure for IIFE modules.
 *
 * Provides:
 *   1. Safe dependency injection that preserves getters
 *   2. A shared reactive state store (read/write with change notifications)
 *   3. An event bus for decoupled inter-module communication
 *   4. Module registration with lifecycle hooks
 *
 * Usage in modules:
 *   var runtime = window.LexeraRuntime;
 *   // Read live state:
 *   var boards = runtime.state.boards;
 *   // Subscribe to changes:
 *   runtime.on('boards:changed', function(boards) { renderBoardList(); });
 *   // Emit events:
 *   runtime.emit('board:selected', { boardId: '123' });
 */
var LexeraRuntime = (function () {
  'use strict';

  // ── Reactive State Store ────────────────────────────────────────
  var _stateValues = {};
  var _stateListeners = {};

  function defineState(key, initialValue) {
    _stateValues[key] = initialValue;
    if (!_stateListeners[key]) _stateListeners[key] = [];
  }

  function setState(key, value) {
    var old = _stateValues[key];
    _stateValues[key] = value;
    // Notify direct state listeners
    var listeners = _stateListeners[key];
    if (listeners) {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](value, old); } catch (e) {
          console.error('[LexeraRuntime] state listener error for ' + key + ':', e);
        }
      }
    }
    // Also emit as event for the event bus
    emit(key + ':changed', { key: key, value: value, previous: old });
  }

  function getState(key) {
    return _stateValues[key];
  }

  function onStateChange(key, fn) {
    if (!_stateListeners[key]) _stateListeners[key] = [];
    _stateListeners[key].push(fn);
    return function unsubscribe() {
      var arr = _stateListeners[key];
      var idx = arr ? arr.indexOf(fn) : -1;
      if (idx !== -1) arr.splice(idx, 1);
    };
  }

  // Proxy-based state accessor — modules read runtime.state.boards etc.
  var state = typeof Proxy === 'function'
    ? new Proxy({}, {
        get: function (_, key) { return getState(key); },
        set: function (_, key, value) { setState(key, value); return true; }
      })
    : _stateValues; // fallback for environments without Proxy

  // ── Event Bus ───────────────────────────────────────────────────
  var _eventListeners = {};

  function on(event, fn) {
    if (!_eventListeners[event]) _eventListeners[event] = [];
    _eventListeners[event].push(fn);
    return function unsubscribe() {
      var arr = _eventListeners[event];
      var idx = arr ? arr.indexOf(fn) : -1;
      if (idx !== -1) arr.splice(idx, 1);
    };
  }

  function emit(event, data) {
    var listeners = _eventListeners[event];
    if (!listeners) return;
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](data); } catch (e) {
        console.error('[LexeraRuntime] event listener error for ' + event + ':', e);
      }
    }
  }

  // ── Safe Dependency Merger ──────────────────────────────────────
  // Preserves getters/setters when copying deps into a target object.
  function mergeDeps(target, source) {
    if (!source) return target;
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
      var desc = Object.getOwnPropertyDescriptor(source, keys[i]);
      if (desc && (desc.get || desc.set)) {
        Object.defineProperty(target, keys[i], desc);
      } else {
        target[keys[i]] = source[keys[i]];
      }
    }
    return target;
  }

  // ── Module Registry ─────────────────────────────────────────────
  var _modules = {};

  function registerModule(name, mod) {
    _modules[name] = mod;
  }

  function getModule(name) {
    return _modules[name] || null;
  }

  // ── Auto-discovery ───────────────────────────────────────────────
  // Called after all scripts load to register known modules from window.
  var KNOWN_MODULES = [
    'LexeraBoardList', 'LexeraOrderHelpers', 'LexeraWorkspaceShell',
    'LexeraPollingService', 'LexeraColumnContextMenu', 'LexeraRowStackMenu',
    'LexeraKeyboardNavigation', 'LexeraCanvasMode', 'LexeraCanvasPan',
    'LexeraCanvasLayout', 'LexeraDragDropHandlers', 'LexeraSidebarSync',
    'LexeraSidebarTree', 'LexeraSidebarResize', 'LexeraSharedPanels',
    'LexeraCardContentRenderer', 'LexeraInlineRenderer', 'LexeraEmbedMenu',
    'LexeraActionRegistry', 'LexeraKeybindingRegistry', 'LexeraBoardSettingRegistry',
    'LexeraMenuContributorRegistry', 'LexeraDiagramRegistry', 'LexeraFileFormatRegistry',
    'LexeraTagSystem', 'LexeraPathUtils', 'LexeraDropZoneIndicators',
    'CardEditor', 'InlineCardEditor', 'CardContextMenu',
    'BoardSearchReplace', 'BoardStatsFilter', 'LexeraDndMutations',
    'LexeraDashboard', 'LexeraApi', 'LexeraTemplates',
    'LexeraExportUiPreferences', 'LexeraContentEnhancerRegistry'
  ];

  function discoverModules() {
    if (typeof window === 'undefined') return;
    for (var i = 0; i < KNOWN_MODULES.length; i++) {
      var name = KNOWN_MODULES[i];
      if (window[name] && !_modules[name]) {
        _modules[name] = window[name];
      }
    }
  }

  function getStartupReport() {
    var found = [];
    var missing = [];
    for (var i = 0; i < KNOWN_MODULES.length; i++) {
      if (_modules[KNOWN_MODULES[i]]) found.push(KNOWN_MODULES[i]);
      else missing.push(KNOWN_MODULES[i]);
    }
    return { found: found, missing: missing, total: KNOWN_MODULES.length };
  }

  // ── Public API ──────────────────────────────────────────────────
  return {
    // State store
    state: state,
    defineState: defineState,
    getState: getState,
    setState: setState,
    onStateChange: onStateChange,
    // Event bus
    on: on,
    emit: emit,
    // Dependency injection
    mergeDeps: mergeDeps,
    // Module registry
    registerModule: registerModule,
    getModule: getModule,
    discoverModules: discoverModules,
    getStartupReport: getStartupReport,
    KNOWN_MODULES: KNOWN_MODULES
  };
})();
window.LexeraRuntime = LexeraRuntime;
