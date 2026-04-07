(function () {
  var plugins = [];
  var queue = [];
  var idCounter = 0;
  var processing = false;

  var DiagramRegistry = {
    register: function (plugin) {
      if (!plugin || !plugin.id || !plugin.languages || !plugin.render) {
        return;
      }
      plugins.push(plugin);
    },

    getById: function (id) {
      for (var i = 0; i < plugins.length; i++) {
        if (plugins[i].id === id) return plugins[i];
      }
      return null;
    },

    findByLanguage: function (lang) {
      for (var i = 0; i < plugins.length; i++) {
        var languages = plugins[i].languages;
        for (var j = 0; j < languages.length; j++) {
          if (languages[j] === lang) return plugins[i];
        }
      }
      return null;
    },

    getAll: function () {
      return plugins.slice();
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
