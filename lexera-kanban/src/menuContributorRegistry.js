// Leading line comment to dodge slice-13 checkJs duplicate-id quirk
// on the first @typedef block in the file.

/**
 * @typedef {Object} LexeraMenuContributorItem
 * @property {string} [id]
 * @property {string} [label]
 * @property {boolean} [separator]
 */

/**
 * @typedef {Object} LexeraMenuContributor
 * @property {string} [id]
 * @property {string} [name]
 * @property {string} [version]
 * @property {number} [priority]
 * @property {string} [section]
 * @property {Array<string>} [scopes]
 * @property {(scope: string, context: unknown) => Array<LexeraMenuContributorItem>} build
 * @property {string} [kind]
 * @property {{ id: string; name: string; version: string; priority: number }} [metadata]
 */

/**
 * @typedef {Object} LexeraMenuContributorRegistryApi
 * @property {(contributor: LexeraMenuContributor) => void} register
 * @property {(scope: string) => Array<LexeraMenuContributor>} getForScope
 * @property {(id: string) => void} remove
 * @property {(scope: string, context: unknown) => Array<LexeraMenuContributorItem>} buildMenu
 */

(function () {
  var KIND = 'menuContributor';
  var autoIdCounter = 0;

  function getRegistry() {
    return typeof LexeraPluginRegistry !== 'undefined' ? LexeraPluginRegistry : null;
  }

  /** @type {LexeraMenuContributorRegistryApi} */
  var MenuContributorRegistry = {
    register: function (contributor) {
      var reg = getRegistry();
      if (!reg || !contributor) return;
      if (!contributor.id) contributor.id = 'menu-contrib-' + (++autoIdCounter);
      contributor.kind = KIND;
      if (!contributor.metadata) {
        contributor.metadata = {
          id: contributor.id,
          name: contributor.name || contributor.id,
          version: contributor.version || '1.0.0',
          priority: typeof contributor.priority === 'number' ? contributor.priority : 0
        };
      }
      reg.register(contributor);
    },

    getForScope: function (scope) {
      var reg = getRegistry();
      if (!reg) return [];
      // Ascending priority (lower first) — matches original contract.
      return reg.getByKind(KIND)
        .filter(function (c) { return Array.isArray(c.scopes) && c.scopes.indexOf(scope) !== -1; })
        .sort(function (a, b) { return (a.priority || 0) - (b.priority || 0); });
    },

    remove: function (id) {
      var reg = getRegistry();
      if (!reg) return;
      reg.unregister(KIND, id);
    },

    buildMenu: function (scope, context) {
      var applicable = MenuContributorRegistry.getForScope(scope);
      var allItems = [];
      var lastSection = null;

      for (var i = 0; i < applicable.length; i++) {
        var contrib = applicable[i];
        var items = contrib.build(scope, context);
        if (!items || items.length === 0) continue;

        if (lastSection !== null && contrib.section !== lastSection && allItems.length > 0) {
          allItems.push({ separator: true });
        }

        for (var j = 0; j < items.length; j++) {
          allItems.push(items[j]);
        }
        lastSection = contrib.section;
      }

      return allItems;
    }
  };

  window.LexeraMenuContributorRegistry = MenuContributorRegistry;
})();
