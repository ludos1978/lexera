(function () {
  var KIND = 'contentEnhancer';

  // ── Lazy-loading infrastructure ────────────────────────────────────
  var lazyObserver = null;
  var LAZY_ROOT_MARGIN = '200px';

  function getRegistry() {
    return typeof LexeraPluginRegistry !== 'undefined' ? LexeraPluginRegistry : null;
  }

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
        swapLazyImages(el);
      }
    }, { rootMargin: LAZY_ROOT_MARGIN });
    return lazyObserver;
  }

  var imageObserver = null;

  function _activateLazyMedia(el) {
    if (!el) return;
    var lazySrc = el.getAttribute('data-lazy-src');
    if (!lazySrc) return;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'img') {
      el.src = lazySrc;
    } else if (tag === 'video' || tag === 'audio') {
      el.src = lazySrc;
      try { if (typeof el.load === 'function') el.load(); } catch (_) {}
    } else {
      el.src = lazySrc;
    }
    el.removeAttribute('data-lazy-src');
  }

  function getImageObserver() {
    if (imageObserver) return imageObserver;
    if (typeof IntersectionObserver === 'undefined') return null;
    imageObserver = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        var el = entries[i].target;
        imageObserver.unobserve(el);
        _activateLazyMedia(el);
      }
    }, { rootMargin: LAZY_ROOT_MARGIN });
    return imageObserver;
  }

  function observeLazyImages(root) {
    if (!root) return;
    var observer = getImageObserver();
    if (!observer) return;
    var els = root.querySelectorAll('img[data-lazy-src], video[data-lazy-src], audio[data-lazy-src]');
    for (var i = 0; i < els.length; i++) {
      observer.observe(els[i]);
    }
  }

  function swapLazyImages(el) {
    if (!el) return;
    var els = el.querySelectorAll ? el.querySelectorAll('img[data-lazy-src], video[data-lazy-src], audio[data-lazy-src]') : [];
    for (var i = 0; i < els.length; i++) _activateLazyMedia(els[i]);
  }

  // ── Registry facade ──────────────────────────────────────────────
  // Enhancers registered here are stored in LexeraPluginRegistry under kind='contentEnhancer'.
  // The legacy object shape (id, priority, selector, lazy, enhance) is preserved via
  // in-place augmentation with kind + metadata so registry identity is kept.

  var ContentEnhancerRegistry = {
    register: function (enhancer) {
      var reg = getRegistry();
      if (!reg || !enhancer || !enhancer.id) return;
      enhancer.kind = KIND;
      if (!enhancer.metadata) {
        enhancer.metadata = {
          id: enhancer.id,
          name: enhancer.name || enhancer.id,
          version: enhancer.version || '1.0.0',
          priority: typeof enhancer.priority === 'number' ? enhancer.priority : 0
        };
      }
      reg.register(enhancer);
    },

    remove: function (id) {
      var reg = getRegistry();
      if (!reg) return;
      reg.unregister(KIND, id);
    },

    getAll: function () {
      var reg = getRegistry();
      if (!reg) return [];
      // Ascending priority (lower first) matches the original contract.
      return reg.getByKind(KIND).slice().sort(function (a, b) {
        return (a.priority || 0) - (b.priority || 0);
      });
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
      observeLazyImages(root);
    },

    observeLazyImages: observeLazyImages
  };

  window.LexeraContentEnhancerRegistry = ContentEnhancerRegistry;
})();
