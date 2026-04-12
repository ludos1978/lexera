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

  // ── Lazy media handling ────────────────────────────────────────────
  // <img>, <video>, and <audio> elements with `data-lazy-src` stay
  // empty (no network fetch) until they enter the viewport. Without
  // this, every card with a video/audio tag would fire a network
  // request for the media URL on every render — including broken
  // references that generate 404s logged to the console.
  //
  // The image pattern uses a 1x1 gif placeholder for `src`; video and
  // audio don't need any placeholder since empty src is valid HTML
  // and doesn't load anything.
  var imageObserver = null;

  function _activateLazyMedia(el) {
    if (!el) return;
    var lazySrc = el.getAttribute('data-lazy-src');
    if (!lazySrc) return;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'img') {
      el.src = lazySrc;
    } else if (tag === 'video' || tag === 'audio') {
      // For video/audio, setting .src triggers a metadata load based on
      // the `preload` attribute already on the element.
      el.src = lazySrc;
      // If the element is already in the DOM, `load()` re-reads the
      // new src according to the preload attribute. Otherwise setting
      // src is enough.
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
    // Cover img, video, and audio with a single observer.
    var els = root.querySelectorAll('img[data-lazy-src], video[data-lazy-src], audio[data-lazy-src]');
    for (var i = 0; i < els.length; i++) {
      observer.observe(els[i]);
    }
  }

  function swapLazyImages(el) {
    if (!el) return;
    // Activate any lazy media within the element that just became visible.
    var els = el.querySelectorAll ? el.querySelectorAll('img[data-lazy-src], video[data-lazy-src], audio[data-lazy-src]') : [];
    for (var i = 0; i < els.length; i++) _activateLazyMedia(els[i]);
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
