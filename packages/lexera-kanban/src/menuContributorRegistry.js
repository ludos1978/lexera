(function () {
  var contributors = [];

  var MenuContributorRegistry = {
    register: function (contributor) {
      contributors.push(contributor);
      contributors.sort(function (a, b) { return a.priority - b.priority; });
    },

    getForScope: function (scope) {
      return contributors.filter(function (c) {
        return c.scopes.indexOf(scope) !== -1;
      });
    },

    remove: function (id) {
      for (var i = contributors.length - 1; i >= 0; i--) {
        if (contributors[i].id === id) contributors.splice(i, 1);
      }
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
