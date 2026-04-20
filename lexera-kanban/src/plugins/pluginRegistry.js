var LexeraPluginRegistry = (function () {
  var VALID_KINDS = [
    'fileFormat',
    'diagram',
    'export',
    'contentEnhancer',
    'menuContributor',
    'embed',
    'markdown'
  ];

  function logError(msg, detail) {
    if (typeof console !== 'undefined' && console.error) {
      if (detail !== undefined) console.error('[PluginRegistry] ' + msg, detail);
      else console.error('[PluginRegistry] ' + msg);
    }
  }

  function logWarn(msg, detail) {
    if (typeof console !== 'undefined' && console.warn) {
      if (detail !== undefined) console.warn('[PluginRegistry] ' + msg, detail);
      else console.warn('[PluginRegistry] ' + msg);
    }
  }

  function validate(plugin) {
    var errors = [];
    if (!plugin || typeof plugin !== 'object') {
      errors.push('plugin must be an object');
      return { valid: false, errors: errors };
    }
    if (!plugin.kind || VALID_KINDS.indexOf(plugin.kind) === -1) {
      errors.push('invalid or missing kind: ' + String(plugin.kind));
    }
    if (!plugin.metadata || typeof plugin.metadata !== 'object') {
      errors.push('missing metadata object');
    } else {
      if (!plugin.metadata.id || typeof plugin.metadata.id !== 'string' || plugin.metadata.id.trim() === '') {
        errors.push('missing or empty metadata.id');
      }
      if (!plugin.metadata.name || typeof plugin.metadata.name !== 'string') {
        errors.push('missing metadata.name');
      }
      if (typeof plugin.metadata.version !== 'string' || plugin.metadata.version.trim() === '') {
        errors.push('missing metadata.version');
      }
      if (plugin.metadata.priority !== undefined && typeof plugin.metadata.priority !== 'number') {
        errors.push('metadata.priority must be a number when provided');
      }
      if (plugin.metadata.requires !== undefined && !Array.isArray(plugin.metadata.requires)) {
        errors.push('metadata.requires must be an array when provided');
      }
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // Detect structural overlaps between a new plugin and existing plugins of the
  // same kind. Returns warning strings — these don't block registration, but
  // surface silent conflicts that v1's PluginRegistry also warned on.
  function detectConflicts(plugin, existingList) {
    var warnings = [];
    if (!plugin || !plugin.kind || !existingList || existingList.length === 0) return warnings;

    if (plugin.kind === 'diagram' && Array.isArray(plugin.languages)) {
      for (var i = 0; i < existingList.length; i++) {
        var other = existingList[i];
        if (!Array.isArray(other.languages)) continue;
        var langOverlap = plugin.languages.filter(function (lang) {
          return other.languages.indexOf(lang) !== -1;
        });
        if (langOverlap.length > 0) {
          warnings.push('diagram language overlap with ' + other.metadata.id + ': ' + langOverlap.join(', '));
        }
      }
    }

    if (plugin.kind === 'export' && typeof plugin.getSupportedFormats === 'function') {
      var newFormats;
      try {
        newFormats = plugin.getSupportedFormats().map(function (f) { return f && f.id; }).filter(Boolean);
      } catch (e) { newFormats = []; }
      if (newFormats.length > 0) {
        for (var j = 0; j < existingList.length; j++) {
          var ex = existingList[j];
          if (typeof ex.getSupportedFormats !== 'function') continue;
          var otherFormats;
          try {
            otherFormats = ex.getSupportedFormats().map(function (f) { return f && f.id; }).filter(Boolean);
          } catch (e) { continue; }
          var fmtOverlap = newFormats.filter(function (id) { return otherFormats.indexOf(id) !== -1; });
          if (fmtOverlap.length > 0) {
            warnings.push('export format id overlap with ' + ex.metadata.id + ': ' + fmtOverlap.join(', '));
          }
        }
      }
    }

    if (plugin.kind === 'markdown' && typeof plugin.apply === 'function') {
      // Markdown entries are uniquely keyed by id (and validate() already
      // ensures metadata.id). Overlap would manifest as duplicate metadata.id
      // — handled by the `replacing existing` warning elsewhere. No kind-
      // specific check needed.
    }

    return warnings;
  }

  function priorityOf(plugin) {
    var p = plugin && plugin.metadata ? plugin.metadata.priority : undefined;
    return typeof p === 'number' ? p : 0;
  }

  function settledAll(promises) {
    // Minimal Promise.allSettled polyfill — runs all, collects outcomes, never rejects.
    var wrapped = promises.map(function (p) {
      return Promise.resolve(p).then(
        function (value) { return { status: 'fulfilled', value: value }; },
        function (reason) { return { status: 'rejected', reason: reason }; }
      );
    });
    return Promise.all(wrapped);
  }

  function createRegistry() {
    var buckets = {};
    VALID_KINDS.forEach(function (k) { buckets[k] = {}; });

    var disabled = {};
    var activated = false;
    var activationCtx = null;

    function register(plugin) {
      var v = validate(plugin);
      if (!v.valid) {
        logError('invalid plugin registration: ' + v.errors.join('; '), plugin);
        return false;
      }
      var kind = plugin.kind;
      var id = plugin.metadata.id;
      if (buckets[kind][id]) {
        logWarn('replacing existing ' + kind + '/' + id);
      }
      // Structural conflict detection: warn on language/format overlap with
      // other plugins of the same kind (skip self-replacement case above).
      var existing = Object.keys(buckets[kind])
        .filter(function (existingId) { return existingId !== id; })
        .map(function (existingId) { return buckets[kind][existingId]; });
      var conflicts = detectConflicts(plugin, existing);
      for (var i = 0; i < conflicts.length; i++) {
        logWarn('conflict registering ' + kind + '/' + id + ': ' + conflicts[i]);
      }
      buckets[kind][id] = plugin;
      return true;
    }

    function unregister(kind, id) {
      if (!buckets[kind] || !buckets[kind][id]) return false;
      var plugin = buckets[kind][id];
      if (activated && typeof plugin.deactivate === 'function') {
        try {
          var r = plugin.deactivate();
          if (r && typeof r.catch === 'function') {
            r.catch(function (err) { logError('deactivate failed for ' + kind + '/' + id, err); });
          }
        } catch (err) {
          logError('deactivate threw for ' + kind + '/' + id, err);
        }
      }
      delete buckets[kind][id];
      return true;
    }

    function getById(kind, id) {
      return buckets[kind] && buckets[kind][id] ? buckets[kind][id] : null;
    }

    function getByKind(kind, opts) {
      opts = opts || {};
      var bucket = buckets[kind] || {};
      var list = Object.keys(bucket).map(function (id) { return bucket[id]; });
      if (!opts.includeDisabled) {
        list = list.filter(function (p) { return !disabled[p.metadata.id]; });
      }
      if (opts.sortByPriority) {
        list.sort(function (a, b) { return priorityOf(b) - priorityOf(a); });
      }
      return list;
    }

    function findBy(kind, predicate) {
      if (typeof predicate !== 'function') return null;
      var list = getByKind(kind, { sortByPriority: true });
      for (var i = 0; i < list.length; i++) {
        try {
          if (predicate(list[i])) return list[i];
        } catch (err) {
          logError('predicate threw for ' + kind + '/' + list[i].metadata.id, err);
        }
      }
      return null;
    }

    function allKinds() {
      return VALID_KINDS.slice();
    }

    function setEnabled(id, enabled) {
      if (enabled) delete disabled[id];
      else disabled[id] = true;
    }

    function isEnabled(id) {
      return !disabled[id];
    }

    function getDisabledIds() {
      return Object.keys(disabled);
    }

    function collectEnabled() {
      var all = [];
      VALID_KINDS.forEach(function (kind) {
        getByKind(kind).forEach(function (p) { all.push(p); });
      });
      return all;
    }

    function collectAll() {
      var all = [];
      VALID_KINDS.forEach(function (kind) {
        getByKind(kind, { includeDisabled: true }).forEach(function (p) { all.push(p); });
      });
      return all;
    }

    function activate(ctx) {
      if (activated) return Promise.resolve();
      activated = true;
      activationCtx = ctx || {};
      var plugins = collectEnabled();
      var tasks = plugins.map(function (p) {
        if (typeof p.activate !== 'function') return Promise.resolve();
        try {
          return Promise.resolve(p.activate(activationCtx));
        } catch (err) {
          return Promise.reject(err);
        }
      });
      return settledAll(tasks).then(function (results) {
        results.forEach(function (r, i) {
          if (r.status === 'rejected') {
            logError('activate failed for ' + plugins[i].kind + '/' + plugins[i].metadata.id, r.reason);
          }
        });
      });
    }

    function deactivate() {
      if (!activated) return Promise.resolve();
      activated = false;
      var plugins = collectAll();
      var tasks = plugins.map(function (p) {
        if (typeof p.deactivate !== 'function') return Promise.resolve();
        try {
          return Promise.resolve(p.deactivate());
        } catch (err) {
          return Promise.reject(err);
        }
      });
      return settledAll(tasks).then(function (results) {
        results.forEach(function (r, i) {
          if (r.status === 'rejected') {
            logError('deactivate failed for ' + plugins[i].kind + '/' + plugins[i].metadata.id, r.reason);
          }
        });
        activationCtx = null;
      });
    }

    function isActivated() {
      return activated;
    }

    function stats() {
      var result = { total: 0, byKind: {}, disabled: Object.keys(disabled).length };
      VALID_KINDS.forEach(function (k) {
        var count = Object.keys(buckets[k]).length;
        result.byKind[k] = count;
        result.total += count;
      });
      return result;
    }

    function clear() {
      VALID_KINDS.forEach(function (k) { buckets[k] = {}; });
      disabled = {};
      activated = false;
      activationCtx = null;
    }

    return {
      register: register,
      unregister: unregister,
      getById: getById,
      getByKind: getByKind,
      findBy: findBy,
      allKinds: allKinds,
      setEnabled: setEnabled,
      isEnabled: isEnabled,
      getDisabledIds: getDisabledIds,
      activate: activate,
      deactivate: deactivate,
      isActivated: isActivated,
      stats: stats,
      clear: clear
    };
  }

  var api = createRegistry();
  api.createRegistry = createRegistry;
  api.validate = validate;
  api.detectConflicts = detectConflicts;
  api.VALID_KINDS = VALID_KINDS.slice();
  return api;
})();

if (typeof window !== 'undefined') {
  window.LexeraPluginRegistry = LexeraPluginRegistry;
}
