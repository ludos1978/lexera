// Leading line comment to dodge slice-13 checkJs duplicate-id quirk.

/**
 * @typedef {Object} LexeraDiagramPlugin
 * @property {string} id
 * @property {Array<string>} languages
 * @property {(elementId: string, code: string, boardId?: string | null) => Promise<string>} render
 * @property {() => boolean} isReady
 * @property {() => Promise<unknown>} init
 * @property {string} [kind]
 * @property {{ id: string; name: string; version: string }} [metadata]
 */

/**
 * @typedef {Object} LexeraDiagramQueueItem
 * @property {string} pluginId
 * @property {string} elementId
 * @property {string} code
 * @property {string | null | undefined} [boardId]
 */

/**
 * @typedef {Object} LexeraDiagramRegistryApi
 * @property {(plugin: LexeraDiagramPlugin) => void} register
 * @property {(id: string) => (LexeraDiagramPlugin | null)} getById
 * @property {(lang: string) => (LexeraDiagramPlugin | null)} findByLanguage
 * @property {() => Array<LexeraDiagramPlugin>} getAll
 * @property {(prefix: string) => string} nextId
 * @property {(pluginId: string, elementId: string, code: string, boardId?: string | null) => void} enqueue
 * @property {() => void} flush
 */

(function () {
  var KIND = 'diagram';
  /** @type {Array<LexeraDiagramQueueItem>} */
  var queue = [];
  var idCounter = 0;
  var processing = false;

  function getRegistry() {
    return typeof LexeraPluginRegistry !== 'undefined' ? LexeraPluginRegistry : null;
  }

  /** @type {LexeraDiagramRegistryApi} */
  var DiagramRegistry = {
    register: function (plugin) {
      var reg = getRegistry();
      if (!reg) return;
      if (!plugin || !plugin.id || !plugin.languages || !plugin.render) return;
      // Augment the legacy plugin with v2 manifest fields in place so identity is preserved
      // for stateful plugins that mutate themselves (e.g. mermaid _ready, _loading).
      plugin.kind = KIND;
      if (!plugin.metadata) {
        plugin.metadata = { id: plugin.id, name: plugin.id, version: '1.0.0' };
      }
      reg.register(plugin);
    },

    getById: function (id) {
      var reg = getRegistry();
      if (!reg) return null;
      return reg.getById(KIND, id);
    },

    findByLanguage: function (lang) {
      var reg = getRegistry();
      if (!reg) return null;
      return reg.findBy(KIND, function (p) {
        return Array.isArray(p.languages) && p.languages.indexOf(lang) !== -1;
      });
    },

    getAll: function () {
      var reg = getRegistry();
      return reg ? reg.getByKind(KIND).slice() : [];
    },

    nextId: function (prefix) {
      return prefix + '-' + (++idCounter);
    },

    enqueue: function (pluginId, elementId, code, boardId) {
      queue.push({ pluginId: pluginId, elementId: elementId, code: code, boardId: boardId });
    },

    flush: function () {
      if (processing || queue.length === 0) return;
      processing = true;
      var batch = queue.slice();
      queue = [];

      /** @type {{ [pluginId: string]: Array<LexeraDiagramQueueItem> }} */
      var groups = {};
      batch.forEach(function (item) {
        if (!groups[item.pluginId]) groups[item.pluginId] = [];
        groups[item.pluginId].push(item);
      });

      Object.keys(groups).forEach(function (pluginId) {
        var plugin = DiagramRegistry.getById(pluginId);
        if (!plugin) return;

        function processItems() {
          var items = groups[pluginId];
          items.forEach(function (item) {
            var el = document.getElementById(item.elementId);
            if (!el) return;
            try {
              plugin.render(item.elementId, item.code, item.boardId).then(function (html) {
                el.className = pluginId + '-diagram';
                el.innerHTML = html;
                var svg = el.querySelector('svg');
                if (svg) {
                  svg.style.display = 'block';
                  svg.style.maxWidth = '100%';
                  svg.style.height = 'auto';
                }
              }).catch(function (err) {
                el.innerHTML = '<span class="' + pluginId + '-error">' + pluginId + ' error: ' + (err.message || String(err)) + '</span>';
              });
            } catch (err) {
              el.innerHTML = '<span class="' + pluginId + '-error">' + pluginId + ' error: ' + (err.message || String(err)) + '</span>';
            }
          });
        }

        if (plugin.isReady()) {
          processItems();
        } else {
          plugin.init().then(processItems).catch(function (err) {
            groups[pluginId].forEach(function (item) {
              var el = document.getElementById(item.elementId);
              if (el) el.innerHTML = '<span class="' + pluginId + '-error">Failed to load ' + pluginId + '</span>';
            });
          });
        }
      });

      processing = false;
      if (queue.length > 0) DiagramRegistry.flush();
    }
  };

  window.LexeraDiagramRegistry = DiagramRegistry;
})();
