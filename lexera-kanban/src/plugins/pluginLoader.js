// Leading line comment to dodge slice-13 checkJs duplicate-id quirk.

/** @typedef {{ register(plugin: unknown): boolean; setEnabled(id: string, enabled: boolean): void; getDisabledIds(): Array<string>; [k: string]: unknown }} LexeraPluginLoaderRegistry */

/** @typedef {{ force?: boolean; disabled?: Array<string>; [k: string]: unknown }} LexeraPluginLoaderOpts */

/** @typedef {{ loaded: boolean; registered: number; disabled: number }} LexeraPluginLoaderLoadResult */

/** @typedef {(opts: LexeraPluginLoaderOpts) => unknown} LexeraPluginLoaderFactory */

/**
 * @typedef {Object} LexeraPluginLoaderInstance
 * @property {(factory: LexeraPluginLoaderFactory) => void} addBuiltin
 * @property {(registry: LexeraPluginLoaderRegistry | null | undefined, opts?: LexeraPluginLoaderOpts) => LexeraPluginLoaderLoadResult} loadBuiltins
 * @property {() => void} reset
 * @property {() => boolean} isLoaded
 * @property {() => number} getBuiltinCount
 */

/**
 * @typedef {LexeraPluginLoaderInstance & { createLoader(): LexeraPluginLoaderInstance }} LexeraPluginLoaderApi
 */

var LexeraPluginLoader = (function () {
  function logInfo(msg, detail) {
    if (typeof console !== 'undefined' && console.log) {
      if (detail !== undefined) console.log('[PluginLoader] ' + msg, detail);
      else console.log('[PluginLoader] ' + msg);
    }
  }

  function logError(msg, detail) {
    if (typeof console !== 'undefined' && console.error) {
      if (detail !== undefined) console.error('[PluginLoader] ' + msg, detail);
      else console.error('[PluginLoader] ' + msg);
    }
  }

  /** @returns {LexeraPluginLoaderInstance} */
  function createLoader() {
    var loaded = false;

    // List of factory functions that return plugin manifests.
    // Phase 1: empty — later phases push built-in plugin factories here.
    /** @type {Array<LexeraPluginLoaderFactory>} */
    var builtinFactories = [];

    function addBuiltin(factory) {
      if (typeof factory !== 'function') {
        logError('addBuiltin: factory must be a function');
        return;
      }
      builtinFactories.push(factory);
    }

    function loadBuiltins(registry, opts) {
      opts = opts || {};
      if (!registry || typeof registry.register !== 'function') {
        logError('loadBuiltins: invalid registry');
        return { loaded: false, registered: 0, disabled: 0 };
      }
      if (loaded && !opts.force) {
        return { loaded: true, registered: 0, disabled: registry.getDisabledIds().length };
      }
      loaded = true;

      var disabled = Array.isArray(opts.disabled) ? opts.disabled : [];
      disabled.forEach(function (id) {
        if (typeof id === 'string' && id.trim() !== '') {
          registry.setEnabled(id, false);
        }
      });

      var registeredCount = 0;
      builtinFactories.forEach(function (factory) {
        var plugin;
        try {
          plugin = factory(opts);
        } catch (err) {
          logError('builtin factory threw', err);
          return;
        }
        if (plugin && registry.register(plugin)) {
          registeredCount++;
        }
      });

      logInfo('loaded ' + registeredCount + ' built-in plugin(s); ' + disabled.length + ' marked disabled');
      return { loaded: true, registered: registeredCount, disabled: disabled.length };
    }

    function reset() {
      loaded = false;
      builtinFactories = [];
    }

    function isLoaded() {
      return loaded;
    }

    function getBuiltinCount() {
      return builtinFactories.length;
    }

    /** @type {LexeraPluginLoaderInstance} */
    var inst = {
      addBuiltin: addBuiltin,
      loadBuiltins: loadBuiltins,
      reset: reset,
      isLoaded: isLoaded,
      getBuiltinCount: getBuiltinCount
    };
    return inst;
  }

  /** @type {LexeraPluginLoaderApi} */
  var api = /** @type {LexeraPluginLoaderApi} */ (createLoader());
  api.createLoader = createLoader;
  return api;
})();
