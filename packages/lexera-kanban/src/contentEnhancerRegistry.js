(function () {
  var enhancers = [];

  var ContentEnhancerRegistry = {
    register: function (enhancer) {
      if (!enhancer || !enhancer.id) return;
      // Replace existing with same id
      for (var i = 0; i < enhancers.length; i++) {
        if (enhancers[i].id === enhancer.id) {
          enhancers[i] = enhancer;
          return;
        }
      }
      enhancers.push(enhancer);
    },
    remove: function (id) {
      enhancers = enhancers.filter(function (e) { return e.id !== id; });
    },
    getAll: function () {
      return enhancers.slice().sort(function (a, b) { return (a.priority || 0) - (b.priority || 0); });
    },
    enhance: function (root, context) {
      if (!root) return;
      var sorted = ContentEnhancerRegistry.getAll();
      for (var i = 0; i < sorted.length; i++) {
        var enhancer = sorted[i];
        if (enhancer.selector) {
          var elements = root.querySelectorAll(enhancer.selector);
          for (var j = 0; j < elements.length; j++) {
            enhancer.enhance(elements[j], context);
          }
        } else {
          enhancer.enhance(root, context);
        }
      }
    }
  };

  window.LexeraContentEnhancerRegistry = ContentEnhancerRegistry;
})();
