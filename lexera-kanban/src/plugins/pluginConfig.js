/**
 * Per-plugin config service.
 *
 * Each plugin may expose a `configSchema: ConfigField[]` on its manifest. The
 * service introspects the schema, provides a typed get/set API, persists
 * values through a pluggable storage backend (default: localStorage under
 * `lexera-plugin-config.{pluginId}.{key}`), and notifies subscribers on
 * change.
 *
 * Minimal ConfigField:
 *   { key: string, type: 'string'|'number'|'boolean', default?: any,
 *     label?: string, description?: string }
 *
 * Typical wiring at app boot:
 *   LexeraPluginConfig.installFromRegistry(LexeraPluginRegistry);
 */
var LexeraPluginConfig = (function () {
  function createService() {
    var schemas = {};      // { pluginId: [fields...] }
    var overrides = {};    // { pluginId: { key: value } } — in-memory layer
    var listeners = {};    // { pluginId: [fn, ...] }
    var backend = defaultBackend();

    function defaultBackend() {
      if (typeof localStorage === 'undefined') {
        var mem = {};
        return {
          read: function (pluginId, key) { var k = pluginId + '.' + key; return mem.hasOwnProperty(k) ? mem[k] : undefined; },
          write: function (pluginId, key, value) { mem[pluginId + '.' + key] = value; },
          remove: function (pluginId, key) { delete mem[pluginId + '.' + key]; }
        };
      }
      return {
        read: function (pluginId, key) {
          var raw = localStorage.getItem('lexera-plugin-config.' + pluginId + '.' + key);
          if (raw == null) return undefined;
          try { return JSON.parse(raw); } catch (e) { return raw; }
        },
        write: function (pluginId, key, value) {
          try {
            localStorage.setItem('lexera-plugin-config.' + pluginId + '.' + key, JSON.stringify(value));
          } catch (e) { /* quota / disabled — drop */ }
        },
        remove: function (pluginId, key) {
          try { localStorage.removeItem('lexera-plugin-config.' + pluginId + '.' + key); }
          catch (e) { /* ignore */ }
        }
      };
    }

    function setBackend(customBackend) {
      if (customBackend && typeof customBackend.read === 'function' && typeof customBackend.write === 'function') {
        backend = customBackend;
      }
    }

    function validateField(field) {
      if (!field || typeof field !== 'object') return 'field must be an object';
      if (typeof field.key !== 'string' || field.key.trim() === '') return 'field.key must be a non-empty string';
      var allowed = ['string', 'number', 'boolean'];
      if (allowed.indexOf(field.type) === -1) return 'field.type must be one of ' + allowed.join(', ');
      return null;
    }

    function register(pluginId, schema) {
      if (!pluginId || typeof pluginId !== 'string') {
        throw new Error('register: pluginId must be a string');
      }
      if (!Array.isArray(schema)) {
        throw new Error('register: schema must be an array of ConfigField');
      }
      var clean = [];
      for (var i = 0; i < schema.length; i++) {
        var err = validateField(schema[i]);
        if (err) throw new Error('invalid schema for ' + pluginId + '[' + i + ']: ' + err);
        clean.push(Object.assign({}, schema[i]));
      }
      // Guard against duplicate keys within the same plugin
      var seen = {};
      for (var j = 0; j < clean.length; j++) {
        if (seen[clean[j].key]) throw new Error('duplicate key in schema for ' + pluginId + ': ' + clean[j].key);
        seen[clean[j].key] = true;
      }
      schemas[pluginId] = clean;
    }

    function unregister(pluginId) {
      delete schemas[pluginId];
      delete overrides[pluginId];
      delete listeners[pluginId];
    }

    function getSchema(pluginId) {
      var list = schemas[pluginId];
      return list ? list.map(function (f) { return Object.assign({}, f); }) : null;
    }

    function listPlugins() {
      return Object.keys(schemas);
    }

    function coerce(value, type) {
      if (value === undefined || value === null) return value;
      if (type === 'string') return String(value);
      if (type === 'number') { var n = Number(value); return isNaN(n) ? undefined : n; }
      if (type === 'boolean') {
        if (typeof value === 'boolean') return value;
        if (value === 'true' || value === 1) return true;
        if (value === 'false' || value === 0) return false;
        return Boolean(value);
      }
      return value;
    }

    function get(pluginId) {
      var schema = schemas[pluginId];
      if (!schema) return {};
      var result = {};
      for (var i = 0; i < schema.length; i++) {
        var field = schema[i];
        var value;
        if (overrides[pluginId] && Object.prototype.hasOwnProperty.call(overrides[pluginId], field.key)) {
          value = overrides[pluginId][field.key];
        } else {
          var stored = backend.read(pluginId, field.key);
          value = stored === undefined ? field.default : stored;
        }
        var coerced = coerce(value, field.type);
        result[field.key] = coerced === undefined ? field.default : coerced;
      }
      return result;
    }

    function getField(pluginId, key) {
      var values = get(pluginId);
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
    }

    function set(pluginId, key, value) {
      var schema = schemas[pluginId];
      if (!schema) throw new Error('unknown plugin: ' + pluginId);
      var field = null;
      for (var i = 0; i < schema.length; i++) {
        if (schema[i].key === key) { field = schema[i]; break; }
      }
      if (!field) throw new Error('unknown config key for ' + pluginId + ': ' + key);
      var coerced = coerce(value, field.type);
      if (!overrides[pluginId]) overrides[pluginId] = {};
      overrides[pluginId][key] = coerced;
      backend.write(pluginId, key, coerced);
      _notify(pluginId);
    }

    function reset(pluginId, key) {
      var schema = schemas[pluginId];
      if (!schema) return;
      function wipeKey(k) {
        if (overrides[pluginId]) delete overrides[pluginId][k];
        if (typeof backend.remove === 'function') {
          try { backend.remove(pluginId, k); } catch (e) { /* ignore */ }
        }
      }
      if (key === undefined) {
        for (var i = 0; i < schema.length; i++) wipeKey(schema[i].key);
        delete overrides[pluginId];
      } else {
        wipeKey(key);
      }
      _notify(pluginId);
    }

    function onChange(pluginId, fn) {
      if (!listeners[pluginId]) listeners[pluginId] = [];
      listeners[pluginId].push(fn);
      return function unsubscribe() {
        var arr = listeners[pluginId];
        var idx = arr ? arr.indexOf(fn) : -1;
        if (idx !== -1) arr.splice(idx, 1);
      };
    }

    function _notify(pluginId) {
      var arr = listeners[pluginId];
      if (!arr || arr.length === 0) return;
      var values = get(pluginId);
      for (var i = 0; i < arr.length; i++) {
        try { arr[i](values); }
        catch (e) {
          if (typeof console !== 'undefined' && console.error) {
            console.error('[PluginConfig] listener for ' + pluginId + ' threw:', e);
          }
        }
      }
    }

    function installFromRegistry(registry) {
      if (!registry || typeof registry.allKinds !== 'function') return [];
      var installed = [];
      var kinds = registry.allKinds();
      for (var i = 0; i < kinds.length; i++) {
        var plugins = registry.getByKind(kinds[i], { includeDisabled: true });
        for (var j = 0; j < plugins.length; j++) {
          var p = plugins[j];
          if (Array.isArray(p.configSchema) && p.metadata && p.metadata.id) {
            try {
              register(p.metadata.id, p.configSchema);
              installed.push(p.metadata.id);
              // Optional: if the plugin exposes onConfigChange(values), wire it.
              if (typeof p.onConfigChange === 'function') {
                onChange(p.metadata.id, p.onConfigChange.bind(p));
                // Fire once with initial values so the plugin starts configured.
                try { p.onConfigChange(get(p.metadata.id)); }
                catch (e) {
                  if (typeof console !== 'undefined' && console.error) {
                    console.error('[PluginConfig] initial onConfigChange for ' + p.metadata.id + ' threw:', e);
                  }
                }
              }
            } catch (err) {
              if (typeof console !== 'undefined' && console.warn) {
                console.warn('[PluginConfig] failed to install schema for ' + p.metadata.id + ':', err && err.message);
              }
            }
          }
        }
      }
      return installed;
    }

    function clear() {
      schemas = {};
      overrides = {};
      listeners = {};
    }

    return {
      register: register,
      unregister: unregister,
      getSchema: getSchema,
      listPlugins: listPlugins,
      get: get,
      getField: getField,
      set: set,
      reset: reset,
      onChange: onChange,
      installFromRegistry: installFromRegistry,
      setBackend: setBackend,
      clear: clear
    };
  }

  var api = createService();
  api.createService = createService;
  return api;
})();

if (typeof window !== 'undefined') {
  window.LexeraPluginConfig = LexeraPluginConfig;
}
