// Leading line comment so checkJs doesn't parse the first @typedef
// block as a module-description comment + typedef and emit duplicates
// (slice-13 lesson — see TODOs-lexera.md commit 8bbc91c5).

/** @typedef {(action: string, context: Record<string, unknown>) => void} LexeraActionHandler */

/** @typedef {string | RegExp} LexeraActionPattern */

/**
 * @typedef {Object} LexeraParsedExact
 * @property {'exact'} type
 * @property {LexeraActionPattern} value
 * @property {LexeraActionPattern} raw
 */

/**
 * @typedef {Object} LexeraParsedPrefix
 * @property {'prefix'} type
 * @property {string} prefix
 * @property {LexeraActionPattern} raw
 */

/**
 * @typedef {Object} LexeraParsedRegex
 * @property {'regex'} type
 * @property {RegExp} regex
 * @property {string} raw
 */

/**
 * @typedef {LexeraParsedExact | LexeraParsedPrefix | LexeraParsedRegex} LexeraParsedPattern
 */

/**
 * @typedef {Object} LexeraActionRegistryEntry
 * @property {LexeraParsedPattern} parsed
 * @property {LexeraActionHandler} handler
 */

/**
 * @typedef {Object} LexeraActionRegistryApi
 * @property {(scope: string, pattern: LexeraActionPattern, handler: LexeraActionHandler) => void} register
 * @property {(scope: string, entries: Array<[LexeraActionPattern, LexeraActionHandler]>) => void} registerGroup
 * @property {(scope: string, action: string | null | undefined, context?: Record<string, unknown>) => boolean} dispatch
 * @property {(scope: string, action: string) => (LexeraActionRegistryEntry | null)} find
 */

(function () {
  // handlers is a map: scope -> array of { pattern, handler, type }
  // type is 'exact', 'prefix', or 'regex'
  /** @type {{ [scope: string]: Array<LexeraActionRegistryEntry> }} */
  var handlers = {};

  /**
   * @param {LexeraActionPattern} pattern
   * @returns {LexeraParsedPattern}
   */
  function parsePattern(pattern) {
    if (pattern instanceof RegExp) return { type: 'regex', regex: pattern, raw: pattern.source };
    if (typeof pattern === 'string' && pattern.indexOf('*') === pattern.length - 1) {
      return { type: 'prefix', prefix: pattern.slice(0, -1), raw: pattern };
    }
    return { type: 'exact', value: pattern, raw: pattern };
  }

  /**
   * @param {LexeraParsedPattern} parsed
   * @param {string} action
   */
  function matches(parsed, action) {
    if (parsed.type === 'exact') return action === parsed.value;
    if (parsed.type === 'prefix') return action.indexOf(parsed.prefix) === 0;
    if (parsed.type === 'regex') return parsed.regex.test(action);
    return false;
  }

  /** @type {LexeraActionRegistryApi} */
  var ActionRegistry = {
    register: function (scope, pattern, handler) {
      if (!handlers[scope]) handlers[scope] = [];
      handlers[scope].push({ parsed: parsePattern(pattern), handler: handler });
    },

    registerGroup: function (scope, entries) {
      for (var i = 0; i < entries.length; i++) {
        ActionRegistry.register(scope, entries[i][0], entries[i][1]);
      }
    },

    dispatch: function (scope, action, context) {
      if (!action) return false;
      var list = handlers[scope];
      if (!list) return false;
      for (var i = 0; i < list.length; i++) {
        if (matches(list[i].parsed, action)) {
          list[i].handler(action, context || {});
          return true;
        }
      }
      return false;
    },

    find: function (scope, action) {
      var list = handlers[scope];
      if (!list) return null;
      for (var i = 0; i < list.length; i++) {
        if (matches(list[i].parsed, action)) return list[i];
      }
      return null;
    }
  };

  window.LexeraActionRegistry = ActionRegistry;
})();
