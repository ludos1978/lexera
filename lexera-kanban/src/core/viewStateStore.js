/**
 * Lexera View State Store — observable UI state built on LexeraRuntime.
 *
 * Registers well-known view-state keys (searchMode, isEditing, connected, etc.)
 * with the runtime's reactive state store so that any module can read, write,
 * and subscribe to changes without ad-hoc closure variables.
 *
 * Usage:
 *   var vs = window.LexeraViewState;
 *   vs.set('searchMode', true);
 *   var active = vs.get('searchMode');
 *   var unsub = vs.on('searchMode', function(val, old) { ... });
 */
// Leading line comment to dodge slice-13 checkJs duplicate-id quirk.

/**
 * @typedef {Object} LexeraViewStateKeyDefaults
 * @property {boolean} searchMode
 * @property {boolean} isEditing
 * @property {boolean} connected
 * @property {boolean} embeddedMode
 * @property {boolean} headerSearchExpanded
 * @property {string | null} addCardColumn
 */

/**
 * @typedef {Object} LexeraViewStateApi
 * @property {(key: string) => unknown} get
 * @property {(key: string, value: unknown) => void} set
 * @property {(key: string, fn: (value: unknown, oldValue: unknown) => void) => (() => void)} on
 * @property {LexeraViewStateKeyDefaults} KEYS
 */

var LexeraViewState = (function () {
  'use strict';

  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

  // All view-state keys with their default values
  /** @type {LexeraViewStateKeyDefaults} */
  var KEYS = {
    searchMode: false,
    isEditing: false,
    connected: false,
    embeddedMode: false,
    headerSearchExpanded: false,
    addCardColumn: null
  };

  // Register every key with the runtime state store
  if (_rt) {
    var keyNames = /** @type {Array<keyof LexeraViewStateKeyDefaults>} */ (Object.keys(KEYS));
    for (var i = 0; i < keyNames.length; i++) {
      _rt.defineState(keyNames[i], KEYS[keyNames[i]]);
    }
  }

  /**
   * Get the current value of a view-state key.
   * @param {string} key
   * @returns {*}
   */
  function get(key) {
    return _rt ? _rt.getState(key) : /** @type {any} */ (KEYS)[key];
  }

  /**
   * Set a view-state key. Notifies all subscribers via LexeraRuntime.
   * @param {string} key
   * @param {*} value
   */
  function set(key, value) {
    if (_rt) _rt.setState(key, value);
  }

  /**
   * Subscribe to changes on a view-state key.
   * @param {string} key
   * @param {(value: unknown, oldValue: unknown) => void} fn - Called with (newValue, oldValue)
   * @returns {() => void} Unsubscribe function
   */
  function on(key, fn) {
    return _rt ? _rt.onStateChange(key, fn) : function () {};
  }

  /** @type {LexeraViewStateApi} */
  var api = {
    get: get,
    set: set,
    on: on,
    KEYS: KEYS
  };
  return api;
})();
if (typeof globalThis !== 'undefined') globalThis.LexeraViewState = LexeraViewState;
if (typeof window !== 'undefined') window.LexeraViewState = LexeraViewState;
