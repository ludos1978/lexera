// Universal health-dot injector for the multiview migration.
//
// Adds ONE colored dot per view, in the top view-header, positioned
// on the right side just before any close/fold/burger icon.
//
// Reports the webview's own health to Rust and updates the dot
// when health-changed events arrive for this webview.

(function () {
  'use strict';
  if (window.__lexeraHealthDotInstalled) return;
  window.__lexeraHealthDotInstalled = true;

  // Top-level view-header candidates, in priority order. We pick
  // the FIRST match in the document and inject only there.
  // Generic "header" / ".header" left out because the kanban uses
  // those for column/card headers too — we'd get many dots.
  var HEADER_SELECTORS = [
    '.shell-header',
    '.board-header',
    '.mgmt-panel-header',
    '.log-panel-header-main',
    '.log-panel-header',
    '.ws-view-header',
    'body > header',
    'body > .header',
    'header.header',  // sub-app pattern: <header class="header">
    'header'           // generic fallback — first <header> element
  ];

  // Selectors of icons/buttons we should sit BEFORE (i.e., the dot
  // appears immediately to the LEFT of these). Search inside the
  // chosen header for the first match.
  var TRAILING_ANCHOR_SELECTORS = [
    '.ws-fold-btn',
    '.fold-btn',
    '.fold-icon',
    '[data-action="fold"]',
    '[data-action="toggle-fold"]',
    '.ws-view-tab-close',
    '.close-btn',
    '.btn-icon',
    'button[title="Close"]'
  ];

  var DOT_CLASS = 'lexera-mv-status-dot';

  function tauri() {
    if (typeof window === 'undefined' || !window.__TAURI__) return null;
    return window.__TAURI__;
  }

  function injectStyles() {
    if (document.getElementById('lexera-mv-status-dot-styles')) return;
    var s = document.createElement('style');
    s.id = 'lexera-mv-status-dot-styles';
    s.textContent =
      '.' + DOT_CLASS + '{display:inline-block;width:10px;height:10px;' +
      'border-radius:50%;background:#888;' +
      'margin:0 8px;flex:0 0 auto;align-self:center;vertical-align:middle;' +
      'border:1px solid rgba(255,255,255,.15);' +
      'transition:background .2s,box-shadow .2s;cursor:default;}' +
      '.' + DOT_CLASS + '[data-health="green"]{background:#4caf50;box-shadow:0 0 6px rgba(76,175,80,.7);}' +
      '.' + DOT_CLASS + '[data-health="yellow"]{background:#f5a623;box-shadow:0 0 6px rgba(245,166,35,.7);}' +
      '.' + DOT_CLASS + '[data-health="red"]{background:#f44336;box-shadow:0 0 6px rgba(244,67,54,.7);}' +
      '.' + DOT_CLASS + '[data-health="unknown"]{background:#888;}';
    document.head.appendChild(s);
  }

  var currentHealth = 'unknown';

  function findAllHeaders() {
    // Return de-duplicated set of matching header elements.
    var seen = new Set();
    var found = [];
    for (var i = 0; i < HEADER_SELECTORS.length; i++) {
      var els = document.querySelectorAll(HEADER_SELECTORS[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (seen.has(el)) continue;
        seen.add(el);
        // Skip headers that are descendants of an already-included
        // header (avoid double-injection in nested header structures
        // like log-panel-header > log-panel-header-main).
        var skip = false;
        for (var k = 0; k < found.length; k++) {
          if (found[k].contains(el) || el.contains(found[k])) {
            skip = true;
            break;
          }
        }
        if (!skip) found.push(el);
      }
    }
    return found;
  }

  function findTrailingAnchor(headerEl) {
    for (var i = 0; i < TRAILING_ANCHOR_SELECTORS.length; i++) {
      var el = headerEl.querySelector(':scope > ' + TRAILING_ANCHOR_SELECTORS[i]) ||
        headerEl.querySelector(TRAILING_ANCHOR_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  function ensureDotIn(headerEl) {
    var existing = headerEl.querySelector(':scope > .' + DOT_CLASS);
    if (existing) {
      existing.setAttribute('data-health', currentHealth);
      existing.setAttribute('title', 'Connection state: ' + currentHealth);
      return existing;
    }
    var dot = document.createElement('span');
    dot.className = DOT_CLASS;
    dot.setAttribute('data-health', currentHealth);
    dot.setAttribute('title', 'Connection state: ' + currentHealth);
    var anchor = findTrailingAnchor(headerEl);
    if (anchor && anchor.parentNode === headerEl) {
      headerEl.insertBefore(dot, anchor);
    } else {
      headerEl.appendChild(dot);
    }
    return dot;
  }

  function ensureDots() {
    var headers = findAllHeaders();
    if (headers.length === 0) return;
    // Remove dots that are NOT in any of the chosen headers (cleans
    // up dots from previous runs that may have ended up elsewhere)
    var allDots = document.querySelectorAll('.' + DOT_CLASS);
    for (var i = 0; i < allDots.length; i++) {
      var inAHeader = false;
      for (var j = 0; j < headers.length; j++) {
        if (allDots[i].parentNode === headers[j]) {
          inAHeader = true;
          break;
        }
      }
      if (!inAHeader) allDots[i].remove();
    }
    // Inject (or refresh) one dot in each chosen header
    for (var h = 0; h < headers.length; h++) {
      ensureDotIn(headers[h]);
    }
  }

  function applyHealth(state) {
    currentHealth = state || 'unknown';
    var dots = document.querySelectorAll('.' + DOT_CLASS);
    if (dots.length === 0) {
      ensureDots();
      dots = document.querySelectorAll('.' + DOT_CLASS);
    }
    for (var i = 0; i < dots.length; i++) {
      dots[i].setAttribute('data-health', currentHealth);
      dots[i].setAttribute('title', 'Connection state: ' + currentHealth);
    }
  }

  function reportSelfHealth(state) {
    var t = tauri();
    if (!t || !t.core || !t.webview) return;
    var wv;
    try { wv = t.webview.getCurrentWebview(); } catch (_) { return; }
    if (!wv || !wv.label) return;
    t.core.invoke('multiview_set_health', { label: wv.label, state: state })
      .catch(function () {});
  }

  function init() {
    injectStyles();
    ensureDots();

    // Watch for re-renders that might remove or duplicate dots.
    if (window.MutationObserver) {
      var pending = false;
      var mo = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () {
          pending = false;
          ensureDots();
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    // Default: green if Tauri context exists, else red
    var t = tauri();
    var initial = (t && t.webview) ? 'green' : 'red';
    applyHealth(initial);
    if (initial === 'green') reportSelfHealth('green');

    // Listen for targeted health-changed events from Rust
    if (t && t.webview && typeof t.webview.getCurrentWebview === 'function') {
      try {
        var wv = t.webview.getCurrentWebview();
        if (wv && typeof wv.listen === 'function') {
          wv.listen('health-changed', function (event) {
            var p = event && event.payload ? event.payload : {};
            if (p.label === wv.label && p.state) {
              applyHealth(p.state);
            }
          });
        }
      } catch (_) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
