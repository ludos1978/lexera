(function () {
  var descriptors = {};

  var BoardSettingRegistry = {
    register: function (desc) {
      descriptors[desc.id] = desc;
    },

    get: function (id) {
      return descriptors[id] || null;
    },

    getAll: function () {
      var result = [];
      var keys = Object.keys(descriptors);
      for (var i = 0; i < keys.length; i++) result.push(descriptors[keys[i]]);
      return result;
    },

    getByCategory: function (category) {
      return BoardSettingRegistry.getAll().filter(function (d) { return d.category === category; });
    },

    buildMenuItems: function (id, currentValue) {
      var desc = descriptors[id];
      if (!desc || !desc.options) return [];
      var items = [];
      for (var i = 0; i < desc.options.length; i++) {
        var opt = desc.options[i];
        if (opt && opt.separator) { items.push({ separator: true }); continue; }
        items.push({
          id: desc.actionPrefix + ':' + opt.value,
          label: (currentValue === opt.value ? '\u2713 ' : '') + opt.label
        });
      }
      return items;
    }
  };

  window.LexeraBoardSettingRegistry = BoardSettingRegistry;
})();
