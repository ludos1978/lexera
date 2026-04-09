/**
 * Lexera State Manager
 *
 * Thin facade that wraps the "Settings ? Settings.get() : localStorage" pattern
 * used throughout the lexera-kanban frontend into a single, consistent API.
 *
 * Resolution order:
 *   1. LexeraSettings (typed, with defaults and change notifications)
 *   2. localStorage (raw fallback when Settings Store is not yet loaded)
 *   3. Registry default from LexeraStateKeyRegistry
 *
 * Usage:
 *   var SM = window.LexeraStateManager;
 *   var theme = SM.get('lexera-theme');                   // -> 'lexera'
 *   SM.set('lexera-theme', 'dark');                       // persists + notifies
 *   SM.remove('lexera-theme');                            // clears from both stores
 *   SM.getForBoard('lexera-card-collapsed', boardId);     // per-board key
 *   SM.setForBoard('lexera-card-collapsed', boardId, []); // per-board write
 *
 * All public methods accept the raw localStorage key (e.g. 'lexera-theme'),
 * NOT the Settings Store alias (e.g. 'theme'). This keeps call sites simple
 * and lets the facade handle the mapping internally.
 */
var LexeraStateManager = (function () {
  'use strict';

  // ── Lazy references (resolved on first use) ───────────────────────

  function _settings() {
    return (typeof LexeraSettings !== 'undefined') ? LexeraSettings : null;
  }

  function _registry() {
    return (typeof LexeraStateKeyRegistry !== 'undefined') ? LexeraStateKeyRegistry : null;
  }

  // ── Reverse lookup caches ─────────────────────────────────────────
  // Maps raw localStorage key -> Settings Store alias name
  // Built lazily on first call and cached.

  var _defsMap = null;       // storageKey -> { alias, collection: 'DEFS' }
  var _boardDefsMap = null;  // storageKey template -> { alias, collection: 'BOARD_DEFS' }
  var _scopedDefsMap = null; // storageKey template -> { alias, collection: 'SCOPED_DEFS' }

  function _ensureMaps() {
    if (_defsMap) return;
    _defsMap = {};
    _boardDefsMap = {};
    _scopedDefsMap = {};

    var s = _settings();
    if (!s) return;

    var k;
    if (s.DEFS) {
      for (k in s.DEFS) {
        if (s.DEFS.hasOwnProperty(k)) {
          _defsMap[s.DEFS[k].key] = { alias: k, collection: 'DEFS' };
        }
      }
    }
    if (s.BOARD_DEFS) {
      for (k in s.BOARD_DEFS) {
        if (s.BOARD_DEFS.hasOwnProperty(k)) {
          _boardDefsMap[s.BOARD_DEFS[k].key] = { alias: k, collection: 'BOARD_DEFS' };
        }
      }
    }
    if (s.SCOPED_DEFS) {
      for (k in s.SCOPED_DEFS) {
        if (s.SCOPED_DEFS.hasOwnProperty(k)) {
          _scopedDefsMap[s.SCOPED_DEFS[k].key] = { alias: k, collection: 'SCOPED_DEFS' };
        }
      }
    }
  }

  /** Find the Settings Store alias for a raw localStorage key. */
  function _lookupAlias(storageKey) {
    _ensureMaps();
    return _defsMap[storageKey] || null;
  }

  // ── Type coercion helpers ─────────────────────────────────────────

  function _coerce(raw, type, fallback) {
    if (raw === null || raw === undefined) return fallback;
    if (type === 'boolean') return raw === 'true';
    if (type === 'number') {
      var n = parseFloat(raw);
      return isNaN(n) ? fallback : n;
    }
    if (type === 'json') {
      try { return JSON.parse(raw); } catch (e) { return fallback; }
    }
    return raw; // string
  }

  function _serialize(value, type) {
    if (value === null || value === undefined) return null;
    if (type === 'json') return JSON.stringify(value);
    return String(value);
  }

  /** Look up registry entry for a key to get type and default. */
  function _registryEntry(storageKey) {
    var reg = _registry();
    return reg ? reg[storageKey] || null : null;
  }

  // ── Board / Scoped key helpers ────────────────────────────────────

  /**
   * Try to match a concrete storage key (e.g. 'lexera-card-collapsed:abc123')
   * against BOARD_DEFS templates (e.g. 'lexera-card-collapsed:{boardId}').
   * Returns { alias, boardId } or null.
   */
  function _matchBoardKey(storageKey) {
    _ensureMaps();
    for (var template in _boardDefsMap) {
      if (!_boardDefsMap.hasOwnProperty(template)) continue;
      // Build a regex from the template: replace {boardId} with a capture group
      var escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var pattern = escaped.replace('\\{boardId\\}', '(.+)');
      var re = new RegExp('^' + pattern + '$');
      var m = storageKey.match(re);
      if (m) {
        return { alias: _boardDefsMap[template].alias, boardId: m[1] };
      }
    }
    return null;
  }

  /**
   * Try to match a concrete storage key against SCOPED_DEFS templates.
   * Returns { alias, scope } or null.
   */
  function _matchScopedKey(storageKey) {
    _ensureMaps();
    for (var template in _scopedDefsMap) {
      if (!_scopedDefsMap.hasOwnProperty(template)) continue;
      var escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var pattern = escaped.replace('\\{scope\\}', '(.+)');
      var re = new RegExp('^' + pattern + '$');
      var m = storageKey.match(re);
      if (m) {
        return { alias: _scopedDefsMap[template].alias, scope: m[1] };
      }
    }
    return null;
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Get a value by its raw localStorage key.
   *
   * @param {string} storageKey - The localStorage key (e.g. 'lexera-theme')
   * @param {*} [defaultValue] - Override default; if omitted, uses registry/Settings default
   * @returns {*} The resolved value, typed according to the registry
   */
  function get(storageKey, defaultValue) {
    var s = _settings();
    var regEntry = _registryEntry(storageKey);
    var explicitDefault = arguments.length >= 2;

    // 1. Try Settings Store (global DEFS)
    if (s) {
      var info = _lookupAlias(storageKey);
      if (info) {
        var val = s.get(info.alias);
        // Settings.get returns the def.default when nothing stored,
        // so we only override with caller's default if explicitly provided
        // and the stored value is actually absent.
        if (val !== undefined) return val;
      }

      // 2. Try board keys
      var boardMatch = _matchBoardKey(storageKey);
      if (boardMatch) {
        return s.getForBoard(boardMatch.alias, boardMatch.boardId);
      }

      // 3. Try scoped keys
      var scopedMatch = _matchScopedKey(storageKey);
      if (scopedMatch) {
        return s.getScoped(scopedMatch.alias, scopedMatch.scope);
      }
    }

    // 4. Fall back to raw localStorage
    var fallback = explicitDefault ? defaultValue
      : (regEntry ? regEntry.default : undefined);
    var type = regEntry ? regEntry.type : 'string';

    try {
      var raw = localStorage.getItem(storageKey);
      return _coerce(raw, type, fallback);
    } catch (e) {
      return fallback;
    }
  }

  /**
   * Set a value by its raw localStorage key.
   * Writes through Settings Store when available, otherwise writes raw localStorage.
   *
   * @param {string} storageKey - The localStorage key
   * @param {*} value - The value to store
   */
  function set(storageKey, value) {
    var s = _settings();

    // 1. Try Settings Store (global DEFS)
    if (s) {
      var info = _lookupAlias(storageKey);
      if (info) {
        s.set(info.alias, value);
        return;
      }

      // 2. Try board keys
      var boardMatch = _matchBoardKey(storageKey);
      if (boardMatch) {
        s.setForBoard(boardMatch.alias, boardMatch.boardId, value);
        return;
      }

      // 3. Try scoped keys
      var scopedMatch = _matchScopedKey(storageKey);
      if (scopedMatch) {
        s.setScoped(scopedMatch.alias, scopedMatch.scope, value);
        return;
      }
    }

    // 4. Fall back to raw localStorage
    var regEntry = _registryEntry(storageKey);
    var type = regEntry ? regEntry.type : 'string';

    try {
      if (value === null || value === undefined) {
        localStorage.removeItem(storageKey);
      } else {
        var serialized = _serialize(value, type);
        if (serialized !== null) {
          localStorage.setItem(storageKey, serialized);
        }
      }
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.warn('[LexeraStateManager] set failed for ' + storageKey + ':', e);
      }
    }
  }

  /**
   * Remove a value from both Settings Store and localStorage.
   *
   * @param {string} storageKey - The localStorage key
   */
  function remove(storageKey) {
    var s = _settings();

    if (s) {
      // Setting to null/undefined triggers removal in Settings Store
      var info = _lookupAlias(storageKey);
      if (info) {
        s.set(info.alias, null);
      }

      var boardMatch = _matchBoardKey(storageKey);
      if (boardMatch) {
        s.removeForBoard(boardMatch.alias, boardMatch.boardId);
      }
    }

    // Always clear localStorage too (belt and suspenders)
    try {
      localStorage.removeItem(storageKey);
    } catch (e) { /* ignore */ }
  }

  /**
   * Convenience: get a per-board value using the key template and board ID.
   *
   * @param {string} keyTemplate - Template key (e.g. 'lexera-card-collapsed:{boardId}')
   * @param {string} boardId - The board ID
   * @param {*} [defaultValue] - Override default
   * @returns {*} The resolved value
   */
  function getForBoard(keyTemplate, boardId) {
    var concreteKey = keyTemplate.replace('{boardId}', boardId);
    return arguments.length >= 3 ? get(concreteKey, arguments[2]) : get(concreteKey);
  }

  /**
   * Convenience: set a per-board value using the key template and board ID.
   *
   * @param {string} keyTemplate - Template key
   * @param {string} boardId - The board ID
   * @param {*} value - The value to store
   */
  function setForBoard(keyTemplate, boardId, value) {
    var concreteKey = keyTemplate.replace('{boardId}', boardId);
    set(concreteKey, value);
  }

  /**
   * Convenience: remove a per-board value.
   *
   * @param {string} keyTemplate - Template key
   * @param {string} boardId - The board ID
   */
  function removeForBoard(keyTemplate, boardId) {
    var concreteKey = keyTemplate.replace('{boardId}', boardId);
    remove(concreteKey);
  }

  /**
   * Subscribe to changes on a setting (delegates to Settings Store).
   * Returns a no-op if Settings Store is not available.
   *
   * @param {string} storageKey - The localStorage key
   * @param {function} fn - Callback receiving the new value
   * @returns {function} Unsubscribe function
   */
  function onChange(storageKey, fn) {
    var s = _settings();
    if (!s) return function () {};

    var info = _lookupAlias(storageKey);
    if (info) {
      return s.on(info.alias, fn);
    }

    // For board keys, subscribe using alias:boardId
    var boardMatch = _matchBoardKey(storageKey);
    if (boardMatch) {
      return s.on(boardMatch.alias + ':' + boardMatch.boardId, fn);
    }

    return function () {};
  }

  /**
   * Invalidate the internal lookup caches.
   * Call this if Settings Store is loaded/reloaded after StateManager init.
   */
  function invalidateCache() {
    _defsMap = null;
    _boardDefsMap = null;
    _scopedDefsMap = null;
  }

  return {
    get: get,
    set: set,
    remove: remove,
    getForBoard: getForBoard,
    setForBoard: setForBoard,
    removeForBoard: removeForBoard,
    onChange: onChange,
    invalidateCache: invalidateCache
  };
})();

if (typeof window !== 'undefined') window.LexeraStateManager = LexeraStateManager;
