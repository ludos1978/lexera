// Leading line comment to dodge the slice-13 checkJs duplicate-
// identifier quirk on the first @typedef block in a file.

/**
 * @typedef {Object} LexeraBoardSettingOption
 * @property {unknown} [value]
 * @property {string} [label]
 * @property {boolean} [separator]
 */

/**
 * @typedef {Object} LexeraBoardSettingDescriptor
 * @property {string} id
 * @property {string} [category]
 * @property {string} actionPrefix
 * @property {Array<LexeraBoardSettingOption> | (() => Array<LexeraBoardSettingOption>) | null | undefined} [options]
 */

/**
 * @typedef {Object} LexeraBoardSettingMenuItem
 * @property {string} [id]
 * @property {string} [label]
 * @property {boolean} [separator]
 */

/**
 * @typedef {Object} LexeraBoardSettingRegistryApi
 * @property {(desc: LexeraBoardSettingDescriptor) => void} register
 * @property {(id: string) => (LexeraBoardSettingDescriptor | null)} get
 * @property {() => Array<LexeraBoardSettingDescriptor>} getAll
 * @property {(category: string) => Array<LexeraBoardSettingDescriptor>} getByCategory
 * @property {(id: string, currentValue: unknown) => Array<LexeraBoardSettingMenuItem>} buildMenuItems
 */

(function () {
  /** @type {{ [id: string]: LexeraBoardSettingDescriptor }} */
  var descriptors = {};

  /** @type {LexeraBoardSettingRegistryApi} */
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
      var options = typeof desc.options === 'function' ? desc.options() : desc.options;
      if (!Array.isArray(options)) return [];
      var items = [];
      for (var i = 0; i < options.length; i++) {
        var opt = options[i];
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
