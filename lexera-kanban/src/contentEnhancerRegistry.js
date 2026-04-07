(function () {
  var enhancers = [];

  // ── Lazy-loading infrastructure ────────────────────────────────────
  var lazyObserver = null;
  var LAZY_ROOT_MARGIN = '200px'; // start loading 200px before element enters viewport

  function getLazyObserver() {
    if (lazyObserver) return lazyObserver;
    if (typeof IntersectionObserver === 'undefined') return null;
    lazyObserver = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        var el = entries[i].target;
        lazyObserver.unobserve(el);
        var pendingEnhance = el.__lazyEnhance;
        if (typeof pendingEnhance === 'function') {
          delete el.__lazyEnhance;
          el.removeAttribute('data-lazy-pending');
          pendingEnhance();
        }
        // Also handle lazy images inside this element
        swapLazyImages(el);
      }
    }, { rootMargin: LAZY_ROOT_MARGIN });
    return lazyObserver;
  }

  // ── Lazy image handling ────────────────────────────────────────────
  // Images with data-lazy-src get their src swapped when observed
  var imageObserver = null;

  function getImageObserver() {
    if (imageObserver) return imageObserver;
    if (typeof IntersectionObserver === 'undefined') return null;
    imageObserver = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        var img = entries[i].target;
        imageObserver.unobserve(img);
        var lazySrc = img.getAttribute('data-lazy-src');
        if (lazySrc) {
          img.src = lazySrc;
          img.removeAttribute('data-lazy-src');
        }
      }
    }, { rootMargin: LAZY_ROOT_MARGIN });
    return imageObserver;
  }

  function observeLazyImages(root) {
    if (!root) return;
    var observer = getImageObserver();
    if (!observer) return;
    var imgs = root.querySelectorAll('img[data-lazy-src]');
    for (var i = 0; i < imgs.length; i++) {
      observer.observe(imgs[i]);
    }
  }

  function swapLazyImages(el) {
    if (!el) return;
    // Swap images within the element that just became visible
    var imgs = el.querySelectorAll ? el.querySelectorAll('img[data-lazy-src]') : [];
    for (var i = 0; i < imgs.length; i++) {
      var lazySrc = imgs[i].getAttribute('data-lazy-src');
      if (lazySrc) {
        imgs[i].src = lazySrc;
        imgs[i].removeAttribute('data-lazy-src');
      }
    }
  }

  // ── Registry ───────────────────────────────────────────────────────

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
      var observer = getLazyObserver();
      var sorted = ContentEnhancerRegistry.getAll();
      for (var i = 0; i < sorted.length; i++) {
        var enhancer = sorted[i];
        if (enhancer.selector) {
          var elements = root.querySelectorAll(enhancer.selector);
          for (var j = 0; j < elements.length; j++) {
            var el = elements[j];
            if (enhancer.lazy && observer) {
              // Defer enhancement until element enters viewport
              el.setAttribute('data-lazy-pending', enhancer.id);
              el.__lazyEnhance = (function (enhanceFn, element, ctx) {
                return function () { enhanceFn(element, ctx); };
              })(enhancer.enhance, el, context);
              observer.observe(el);
            } else {
              enhancer.enhance(el, context);
            }
          }
        } else {
          enhancer.enhance(root, context);
        }
      }
      // Observe any lazy images in the rendered content
      observeLazyImages(root);
    },
    observeLazyImages: observeLazyImages
  };

  window.LexeraContentEnhancerRegistry = ContentEnhancerRegistry;
})();
