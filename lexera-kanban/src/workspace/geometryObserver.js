(function () {
  'use strict';

  // Workspace shell geometry observation. Currently encapsulates the
  // tab-strip overflow observer: a single ResizeObserver watches every
  // .ws-view-tabs element and recomputes which tabs fit / overflow into
  // the dropdown when its container width changes.
  //
  // Extracted from workspaceShell.js so that future ResizeObserver-based
  // shell observation (panel / dock geometry, etc.) has a clear home and
  // doesn't grow inside the 5k-line shell module.
  //
  // The instance receives an `onTabsLayoutChanged` callback so it stays
  // decoupled from the shell's overlay-menu state — the shell uses that
  // hook to close any open overflow dropdown when the visible-tab set
  // changes underneath it.

  function recomputeOverflow(headerEl) {
    var tabsEl = headerEl.querySelector('.ws-view-tabs');
    var overflowBtn = headerEl.querySelector('.ws-tab-overflow-btn');
    if (!tabsEl || !overflowBtn) return false;
    var tabs = tabsEl.querySelectorAll('.ws-view-tab');
    if (tabs.length === 0) {
      overflowBtn.classList.remove('is-visible');
      return false;
    }

    for (var r = 0; r < tabs.length; r++) tabs[r].classList.remove('is-tab-overflowed');
    overflowBtn.classList.remove('is-visible');

    var containerWidth = tabsEl.clientWidth;
    if (containerWidth <= 0) return false;

    var totalTabWidth = 0;
    for (var t = 0; t < tabs.length; t++) totalTabWidth += tabs[t].offsetWidth;
    if (totalTabWidth <= containerWidth) return false;

    overflowBtn.classList.add('is-visible');
    var btnWidth = overflowBtn.offsetWidth || 32;
    overflowBtn.classList.remove('is-visible');

    var usedWidth = 0;
    var overflowCount = 0;
    var activeOverflowed = false;
    for (var i = 0; i < tabs.length; i++) {
      var tabWidth = tabs[i].offsetWidth;
      if (overflowCount > 0 || usedWidth + tabWidth > containerWidth - btnWidth) {
        tabs[i].classList.add('is-tab-overflowed');
        overflowCount++;
        if (tabs[i].classList.contains('is-active')) activeOverflowed = true;
      } else {
        usedWidth += tabWidth;
      }
    }

    if (activeOverflowed && overflowCount < tabs.length) {
      var lastVisibleIdx = tabs.length - overflowCount - 1;
      if (lastVisibleIdx >= 0) {
        tabs[lastVisibleIdx].classList.add('is-tab-overflowed');
        for (var a = 0; a < tabs.length; a++) {
          if (tabs[a].classList.contains('is-active')) {
            tabs[a].classList.remove('is-tab-overflowed');
            break;
          }
        }
      }
    }

    if (overflowCount > 0) {
      overflowBtn.classList.add('is-visible');
      var countEl = overflowBtn.querySelector('.ws-tab-overflow-count');
      if (countEl) countEl.textContent = '+' + overflowCount;
    }

    return overflowCount > 0;
  }

  function create(deps) {
    deps = deps || {};
    var onTabsLayoutChanged = typeof deps.onTabsLayoutChanged === 'function'
      ? deps.onTabsLayoutChanged
      : function () {};

    var sharedObserver = null;
    var pendingRafId = 0;
    var hasResizeObserver = typeof ResizeObserver !== 'undefined';
    var hasRaf = typeof requestAnimationFrame === 'function';

    function updateTabOverflow(headerEl) {
      if (!headerEl) return;
      recomputeOverflow(headerEl);
      onTabsLayoutChanged(headerEl);
    }

    function ensureSharedObserver() {
      if (sharedObserver || !hasResizeObserver) return;
      sharedObserver = new ResizeObserver(function (entries) {
        if (pendingRafId) return;
        var headers = [];
        for (var i = 0; i < entries.length; i++) {
          var headerEl = entries[i].target.closest('.ws-view-header');
          if (headerEl && headers.indexOf(headerEl) === -1) headers.push(headerEl);
        }
        var flush = function () {
          pendingRafId = 0;
          for (var j = 0; j < headers.length; j++) updateTabOverflow(headers[j]);
        };
        if (hasRaf) {
          pendingRafId = requestAnimationFrame(flush);
        } else {
          flush();
        }
      });
    }

    function observeTabOverflow(headerEl) {
      if (!headerEl) return;
      var tabsEl = headerEl.querySelector('.ws-view-tabs');
      if (!tabsEl) return;
      ensureSharedObserver();
      if (sharedObserver) sharedObserver.observe(tabsEl);
      if (hasRaf) {
        requestAnimationFrame(function () { updateTabOverflow(headerEl); });
      } else {
        updateTabOverflow(headerEl);
      }
    }

    function destroy() {
      if (sharedObserver) {
        sharedObserver.disconnect();
        sharedObserver = null;
      }
      if (pendingRafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(pendingRafId);
      }
      pendingRafId = 0;
    }

    return {
      updateTabOverflow: updateTabOverflow,
      observeTabOverflow: observeTabOverflow,
      destroy: destroy,
      _test_hasObserver: function () { return !!sharedObserver; },
      _test_pendingRafId: function () { return pendingRafId; }
    };
  }

  var api = {
    create: create,
    _recomputeOverflow: recomputeOverflow
  };

  if (typeof window !== 'undefined') {
    window.LexeraGeometryObserver = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
