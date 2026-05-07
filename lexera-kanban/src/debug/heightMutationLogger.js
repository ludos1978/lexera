// LexeraHeightMutationLogger
//
// Diagnostic instrumentation for the scroll-drift bug where columns /
// stacks / cards re-flow when scrolling back up. Watches every
// `.card`, `.column`, and `.board-stack` element via a single
// ResizeObserver and logs height changes (with id / index, previous
// height, and delta) into the in-app Log panel via `lexeraLog`.
//
// Activation: `localStorage.setItem('LEXERA_HEIGHT_MUTATION_DEBUG','1')`
// then reload. The auto-boot path runs at DOMContentLoaded; calling
// `LexeraHeightMutationLogger.start({ lexeraLog })` works too if you
// want to drive it from elsewhere.
//
// Output shape (one line per change, throttled to 50ms per element):
//   [height-mut] card id=<cardId> idx=<n> h=128 prev=120 delta=+8
//   [height-mut] stack idx=<n> h=480 prev=472 delta=+8
//   [height-mut] column idx=<n> h=820 prev=810 delta=+10
//
// Pure diagnostic; off by default. No production behavior change.

(function () {
  'use strict';

  var FLAG_KEY = 'LEXERA_HEIGHT_MUTATION_DEBUG';
  var SELECTOR = '.card, .column, .board-stack';
  var THROTTLE_MS = 50;

  var ro = null;
  var mo = null;
  var lastHeights = null;
  var lastEmit = null;
  var observedRoot = null;
  var logFn = null;

  function isFlagSet() {
    try {
      var ls = (typeof window !== 'undefined') ? window.localStorage : null;
      return !!(ls && ls.getItem(FLAG_KEY) === '1');
    } catch (_) {
      return false;
    }
  }

  function describeElement(el) {
    if (!el || !el.classList) return 'unknown';
    if (el.classList.contains('card')) {
      var cardId = el.getAttribute('data-card-id') || '';
      var idx = el.getAttribute('data-card-index');
      return 'card id=' + (cardId || '?') + (idx != null ? ' idx=' + idx : '');
    }
    if (el.classList.contains('board-stack')) {
      var sidx = el.getAttribute('data-stack-index') || el.getAttribute('data-stack-id') || '?';
      return 'stack idx=' + sidx;
    }
    if (el.classList.contains('column')) {
      var cidx = el.getAttribute('data-col-index') || el.getAttribute('data-column-index') || '?';
      return 'column idx=' + cidx;
    }
    return 'unknown';
  }

  function handleEntry(entry) {
    if (!entry || !entry.target || !logFn) return;
    var el = entry.target;
    var rect = entry.contentRect;
    var newHeight = Math.round(rect && typeof rect.height === 'number' ? rect.height : (el.offsetHeight || 0));
    var prev = lastHeights.has(el) ? lastHeights.get(el) : null;
    if (prev !== null && Math.abs(newHeight - prev) < 1) return;

    var nowFn = (typeof Date !== 'undefined' && Date.now) ? Date.now : function () { return 0; };
    var now = nowFn();
    var lastTs = lastEmit.has(el) ? lastEmit.get(el) : 0;
    if (now - lastTs < THROTTLE_MS) {
      lastHeights.set(el, newHeight);
      return;
    }

    var msg;
    if (prev === null) {
      msg = '[height-mut] ' + describeElement(el) + ' h=' + newHeight + ' (initial)';
    } else {
      var delta = newHeight - prev;
      msg = '[height-mut] ' + describeElement(el)
        + ' h=' + newHeight
        + ' prev=' + prev
        + ' delta=' + (delta >= 0 ? '+' : '') + delta;
    }
    logFn('debug', msg);
    lastHeights.set(el, newHeight);
    lastEmit.set(el, now);
  }

  function observeAllInRoot(root) {
    if (!ro || !root || typeof root.querySelectorAll !== 'function') return;
    var els = root.querySelectorAll(SELECTOR);
    for (var i = 0; i < els.length; i++) {
      try { ro.observe(els[i]); } catch (_) {}
    }
  }

  function handleMutations(mutations) {
    if (!ro) return;
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      if (!added) continue;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (!node || node.nodeType !== 1) continue;
        if (typeof node.matches === 'function' && node.matches(SELECTOR)) {
          try { ro.observe(node); } catch (_) {}
        }
        observeAllInRoot(node);
      }
    }
  }

  function start(deps) {
    deps = deps || {};
    var lex = deps.lexeraLog || (typeof window !== 'undefined' ? window.lexeraLog : null);
    if (typeof lex !== 'function') return false;
    if (typeof window === 'undefined') return false;
    if (typeof window.ResizeObserver !== 'function') {
      lex('warn', '[height-mut] ResizeObserver unavailable — logger inactive');
      return false;
    }
    if (typeof window.MutationObserver !== 'function') {
      lex('warn', '[height-mut] MutationObserver unavailable — logger inactive');
      return false;
    }
    if (ro) return true;

    logFn = lex;
    lastHeights = new WeakMap();
    lastEmit = new WeakMap();
    observedRoot = deps.root || (typeof document !== 'undefined' ? document.body : null);
    if (!observedRoot) {
      lex('warn', '[height-mut] no observable root — logger inactive');
      return false;
    }

    ro = new window.ResizeObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) handleEntry(entries[i]);
    });
    mo = new window.MutationObserver(handleMutations);
    mo.observe(observedRoot, { childList: true, subtree: true });
    observeAllInRoot(observedRoot);
    lex('info', '[height-mut] logger started — observing ' + SELECTOR);
    return true;
  }

  function stop() {
    if (ro) { try { ro.disconnect(); } catch (_) {} ro = null; }
    if (mo) { try { mo.disconnect(); } catch (_) {} mo = null; }
    lastHeights = null;
    lastEmit = null;
    observedRoot = null;
    logFn = null;
  }

  function isActive() { return !!ro; }

  function autoStartIfFlagged() {
    if (!isFlagSet()) return;
    if (typeof window === 'undefined' || typeof window.lexeraLog !== 'function') return;
    start({ lexeraLog: window.lexeraLog });
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      if (typeof setTimeout === 'function') setTimeout(autoStartIfFlagged, 0);
    } else {
      document.addEventListener('DOMContentLoaded', autoStartIfFlagged);
    }
  }

  if (typeof window !== 'undefined') {
    window.LexeraHeightMutationLogger = {
      start: start,
      stop: stop,
      isActive: isActive,
      _test_handleEntry: handleEntry,
      _test_describeElement: describeElement,
      _test_isFlagSet: isFlagSet,
      _test_FLAG_KEY: FLAG_KEY,
      _test_SELECTOR: SELECTOR
    };
  }
})();
