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

  function createLoader() {
    var loaded = false;

    // List of factory functions that return plugin manifests.
    // Phase 1: empty — later phases push built-in plugin factories here.
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

    return {
      addBuiltin: addBuiltin,
      loadBuiltins: loadBuiltins,
      reset: reset,
      isLoaded: isLoaded,
      getBuiltinCount: getBuiltinCount
    };
  }

  var api = createLoader();
  api.createLoader = createLoader;
  return api;
})();
