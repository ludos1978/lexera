(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraVirtualScroll = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var deps = {};

  // ═══════════════════════════════════════════════════════════════════════════
  // Virtual Scrolling for Large Board Columns
  // ═══════════════════════════════════════════════════════════════════════════
  // For columns with many cards (>30), only renders cards near the viewport.
  // Off-screen cards are replaced with lightweight placeholder elements that
  // preserve the correct scroll height.  During drag-and-drop all cards are
  // materialised so hit-testing works correctly.  Edited cards are always kept
  // rendered regardless of visibility.
  // ═══════════════════════════════════════════════════════════════════════════

  var VIRTUAL_SCROLL_CARD_THRESHOLD = 30;

  /** Per-column state, keyed by the column-cards DOM element. */
  var vsColumnStates = new Map();

  /** 
   * Mapping from card or sentinel element to its owning column state.
   * Replaces O(N) linear searches during intersection handling.
   */
  var vsElementToState = new WeakMap();

  /**
   * Mapping from card element to its current placeholder sentinel.
   */
  var vsCardToSentinel = new WeakMap();

  /** Single IntersectionObserver shared by all virtualised columns. */
  var vsObserver = null;

  /**
   * Queue of placeholder sentinels waiting to be swapped back in. Drained in
   * rAF batches with a per-frame budget so a fast scroll past N hidden cards
   * doesn't stall the main thread on N synchronous DOM mounts + markdown
   * renders. A small cap is fine in practice — users perceive a 1-frame
   * delay (≈16ms) before content paints, but never see scroll jank.
   */
  var vsSwapInQueue = [];
  var vsSwapInQueued = new Set();
  var vsSwapInRafId = 0;
  var VS_SWAP_IN_BUDGET_PER_FRAME = 6;

  /**
   * Generation counter incremented on each full activate() call.
   * Each measured column is stamped with the current generation so that
   * activate() can skip columns that have not changed since the last pass.
   */
  var vsGeneration = 0;

  /** Root element used for IntersectionObserver (the scroll container). */
  function vsGetRoot() {
    return deps.getColumnsContainer ? deps.getColumnsContainer() : null;
  }

  /**
   * Ensure the shared IntersectionObserver exists.  Re-uses an existing
   * observer if one is already active, so incremental activate calls do
   * not destroy it.
   */
  function vsEnsureObserver() {
    if (vsObserver) return;
    var root = vsGetRoot();
    if (!root) return;
    vsObserver = new IntersectionObserver(vsHandleIntersections, {
      root: root,
      rootMargin: '600px 0px 600px 0px',
      threshold: 0
    });
  }

  /**
   * Tear down all virtual-scrolling state.  Called at the start of every
   * renderColumns() so stale observers are never left behind.
   */
  function vsTeardown() {
    if (vsObserver) {
      vsObserver.disconnect();
      vsObserver = null;
    }
    vsColumnStates.clear();
    vsCancelSwapInQueue();
    vsGeneration++;
  }

  function vsCancelSwapInQueue() {
    if (vsSwapInRafId) {
      cancelAnimationFrame(vsSwapInRafId);
      vsSwapInRafId = 0;
    }
    vsSwapInQueue.length = 0;
    vsSwapInQueued.clear();
  }

  function vsScheduleSwapIn(sentinel) {
    if (vsSwapInQueued.has(sentinel)) return;
    vsSwapInQueued.add(sentinel);
    vsSwapInQueue.push(sentinel);
    if (vsSwapInRafId) return;
    if (typeof requestAnimationFrame !== 'function') {
      // Fallback for headless environments without rAF — drain
      // synchronously so behaviour matches the pre-batching path.
      vsProcessSwapInQueue();
      return;
    }
    vsSwapInRafId = requestAnimationFrame(vsProcessSwapInQueue);
  }

  function vsProcessSwapInQueue() {
    vsSwapInRafId = 0;
    var ptrDrag = deps.getPtrDrag ? deps.getPtrDrag() : null;
    var cardDrag = deps.getCardDrag ? deps.getCardDrag() : null;
    if (ptrDrag || cardDrag) {
      // Drag took over; vsMaterialiseAll handles full hydration. Drop
      // the queue so a paused-scroll-then-drag transition doesn't fire
      // stale swap-ins after the materialise pass.
      vsSwapInQueue.length = 0;
      vsSwapInQueued.clear();
      return;
    }
    var budget = VS_SWAP_IN_BUDGET_PER_FRAME;
    while (budget > 0 && vsSwapInQueue.length > 0) {
      var sentinel = vsSwapInQueue.shift();
      vsSwapInQueued.delete(sentinel);
      // Sentinel may have been removed from DOM (column torn down or
      // remeasureColumn discarded it) between schedule and process.
      if (!sentinel.parentNode) continue;
      vsSwapIn(sentinel);
      budget--;
    }
    if (vsSwapInQueue.length > 0 && typeof requestAnimationFrame === 'function') {
      vsSwapInRafId = requestAnimationFrame(vsProcessSwapInQueue);
    }
  }

  /**
   * Drain every pending swap-in synchronously. Used by vsMaterialiseAll
   * (drag start) so pointer hit-testing sees every card mounted, with no
   * partially-flushed batch lingering.
   */
  function vsDrainSwapInQueue() {
    if (vsSwapInRafId) {
      cancelAnimationFrame(vsSwapInRafId);
      vsSwapInRafId = 0;
    }
    while (vsSwapInQueue.length > 0) {
      var sentinel = vsSwapInQueue.shift();
      vsSwapInQueued.delete(sentinel);
      if (sentinel.parentNode) vsSwapIn(sentinel);
    }
  }

  /**
   * Tear down virtual-scrolling state for a single column container.
   * Unobserves all sentinels/cards belonging to that column and removes
   * the state entry, but leaves other columns untouched.
   */
  function vsTeardownColumn(container) {
    var state = vsColumnStates.get(container);
    if (!state) return;
    if (vsObserver) {
      state.sentinels.forEach(function (info, sentinel) {
        vsObserver.unobserve(sentinel);
        vsObserver.unobserve(info.cardEl);
      });
    }
    // Drop any queued swap-ins for sentinels owned by this column —
    // their parent is about to be replaced and the swap would target
    // a stale DOM node.
    state.sentinels.forEach(function (_info, sentinel) {
      if (vsSwapInQueued.has(sentinel)) {
        vsSwapInQueued.delete(sentinel);
        var idx = vsSwapInQueue.indexOf(sentinel);
        if (idx !== -1) vsSwapInQueue.splice(idx, 1);
      }
    });
    // Swap all virtualised cards back in so the DOM is clean
    state.sentinels.forEach(function (info, sentinel) {
      if (sentinel.parentNode && state.virtualised.has(info.cardEl)) {
        sentinel.parentNode.replaceChild(info.cardEl, sentinel);
      }
    });
    vsColumnStates.delete(container);
    var colEl = container.closest('.column');
    if (colEl) colEl.classList.remove('virtual-scrolling');
  }

  function vsCreatePlaceholder(card, height) {
    var sentinel = document.createElement('div');
    sentinel.className = 'vs-placeholder';
    sentinel.style.height = height + 'px';
    sentinel.setAttribute('data-vs-card-id', card.getAttribute('data-card-id') || '');
    sentinel.setAttribute('data-vs-card-kid', card.getAttribute('data-card-kid') || '');
    sentinel.setAttribute('data-vs-col-index', card.getAttribute('data-col-index') || '');
    sentinel.setAttribute('data-vs-card-index', card.getAttribute('data-card-index') || '');
    return sentinel;
  }

  /**
   * Set up virtual scrolling for a single column-cards container.
   * Assumes the shared observer already exists (call vsEnsureObserver first).
   */
  function vsSetupColumn(container, cards) {
    var colEl = container.closest('.column');
    if (colEl) colEl.classList.add('virtual-scrolling');

    var state = {
      container: container,
      /** Map from sentinel element -> { cardEl, height } */
      sentinels: new Map(),
      /** Set of card elements currently replaced by placeholders */
      virtualised: new Set(),
      /** Card count at time of measurement, used to detect changes */
      cardCount: cards.length,
      /** Generation at time of measurement */
      generation: vsGeneration
    };
    vsColumnStates.set(container, state);

    // Measure every card, create a sentinel for each, then replace
    // non-visible cards with their sentinels.
    for (var j = 0; j < cards.length; j++) {
      var card = cards[j];
      var height = card.offsetHeight;
      var sentinel = vsCreatePlaceholder(card, height);

      state.sentinels.set(sentinel, { cardEl: card, height: height });

      // Populate O(1) caches
      vsElementToState.set(card, state);
      vsElementToState.set(sentinel, state);
      vsCardToSentinel.set(card, sentinel);

      // Start by observing every card AND its sentinel.  Cards that are
      // currently visible stay rendered; those off-screen will be swapped
      // out in the first intersection callback.
      vsObserver.observe(card);
    }

    // Use requestAnimationFrame to let the observer fire its initial
    // batch, then do the first swap pass.
    (function (st) {
      requestAnimationFrame(function () {
        vsInitialSwap(st);
      });
    })(state);
  }

  /**
   * Scan all rendered columns and activate virtual scrolling on those whose
   * card count exceeds the threshold.  Must be called AFTER the DOM is fully
   * built by renderColumns() (including content enhancement).
   *
   * Incremental: columns that were already measured in a previous pass and
   * whose card count has not changed are skipped entirely.
   */
  function vsActivate() {
    vsGeneration++;

    var root = vsGetRoot();
    if (!root) return;

    // Collect all current column-cards containers so we can detect removed ones
    var allCardsContainers = root.querySelectorAll('.column-cards');
    var currentContainers = new Set();
    var qualifying = [];
    for (var i = 0; i < allCardsContainers.length; i++) {
      var container = allCardsContainers[i];
      currentContainers.add(container);
      var cards = container.querySelectorAll(':scope > .card');
      if (cards.length > VIRTUAL_SCROLL_CARD_THRESHOLD) {
        qualifying.push({ container: container, cards: cards });
      }
    }

    // Tear down state for columns that no longer exist in the DOM, or that
    // have dropped below the threshold
    var toRemove = [];
    vsColumnStates.forEach(function (state, key) {
      if (!currentContainers.has(key)) {
        toRemove.push(key);
      }
    });
    for (var r = 0; r < toRemove.length; r++) {
      vsTeardownColumn(toRemove[r]);
    }
    // Also tear down columns that dropped below threshold
    vsColumnStates.forEach(function (state, key) {
      if (!qualifying.some(function (q) { return q.container === key; })) {
        vsTeardownColumn(key);
      }
    });

    if (qualifying.length === 0) {
      // No qualifying columns — tear down the observer if it exists
      if (vsObserver) {
        vsObserver.disconnect();
        vsObserver = null;
      }
      return;
    }

    vsEnsureObserver();

    for (var q = 0; q < qualifying.length; q++) {
      var info = qualifying[q];
      var existingState = vsColumnStates.get(info.container);

      // Skip this column if it already has state and the card count matches
      if (existingState && existingState.cardCount === info.cards.length) {
        // Stamp with current generation so it survives future prune passes
        existingState.generation = vsGeneration;
        continue;
      }

      // Column is new or card count changed — tear down old state and re-setup
      if (existingState) {
        vsTeardownColumn(info.container);
      }
      vsSetupColumn(info.container, info.cards);
    }
  }

  /**
   * Re-measure a single column after a card was updated in place.
   * Finds the column state by colIndex attribute, then updates the
   * sentinel mapping for any card that was replaced in the DOM.
   */
  function vsRemeasureColumn(colIndex) {
    var root = vsGetRoot();
    if (!root) return;
    var container = root.querySelector('.column-cards[data-col-index="' + colIndex + '"]');
    if (!container) return;

    var state = vsColumnStates.get(container);
    if (!state) return;

    // Build a map of card-id -> current sentinel for fast lookup
    var cardIdToSentinel = new Map();
    state.sentinels.forEach(function (info, sentinel) {
      var cardId = sentinel.getAttribute('data-vs-card-id') || '';
      if (cardId) cardIdToSentinel.set(cardId, sentinel);
    });

    var currentCardIds = Object.create(null);
    var currentCards = container.querySelectorAll(':scope > .card');
    for (var i = 0; i < currentCards.length; i++) {
      var card = currentCards[i];
      var cardId = card.getAttribute('data-card-id') || '';
      if (!cardId) continue;
      currentCardIds[cardId] = card;

      var existingSentinel = cardIdToSentinel.get(cardId);
      if (!existingSentinel) {
        var newHeight = card.offsetHeight;
        var newSentinel = vsCreatePlaceholder(card, newHeight);
        state.sentinels.set(newSentinel, { cardEl: card, height: newHeight });

        vsElementToState.set(card, state);
        vsElementToState.set(newSentinel, state);
        vsCardToSentinel.set(card, newSentinel);

        if (vsObserver) vsObserver.observe(card);
        continue;
      }

      var oldInfo = state.sentinels.get(existingSentinel);
      if (!oldInfo) continue;

      // Check if the card element was replaced (new DOM node for same card-id)
      if (oldInfo.cardEl !== card) {
        // Update the sentinel mapping to point to the new card element
        if (vsObserver) {
          if (oldInfo.cardEl) vsObserver.unobserve(oldInfo.cardEl);
          vsObserver.observe(card);
        }
        state.virtualised.delete(oldInfo.cardEl);
        oldInfo.cardEl = card;
        vsElementToState.set(card, state);
        vsCardToSentinel.set(card, existingSentinel);
      }

      // Update the sentinel height to match the (possibly resized) card
      var measuredHeight = card.offsetHeight;
      if (measuredHeight !== oldInfo.height) {
        oldInfo.height = measuredHeight;
        existingSentinel.style.height = measuredHeight + 'px';
      }
      existingSentinel.setAttribute('data-vs-card-id', cardId);
      existingSentinel.setAttribute('data-vs-card-kid', card.getAttribute('data-card-kid') || '');
      existingSentinel.setAttribute('data-vs-col-index', card.getAttribute('data-col-index') || '');
      existingSentinel.setAttribute('data-vs-card-index', card.getAttribute('data-card-index') || '');
    }

    var sentinelsToDelete = [];
    state.sentinels.forEach(function (info, sentinel) {
      var trackedCardId = sentinel.getAttribute('data-vs-card-id') || '';
      if (!trackedCardId) return;
      if (currentCardIds[trackedCardId]) return;
      if (sentinel.parentNode === container) return;
      if (vsObserver) {
        vsObserver.unobserve(sentinel);
        if (info.cardEl) vsObserver.unobserve(info.cardEl);
      }
      state.virtualised.delete(info.cardEl);
      sentinelsToDelete.push(sentinel);
    });
    for (var j = 0; j < sentinelsToDelete.length; j++) {
      var deletedSentinel = sentinelsToDelete[j];
      state.sentinels.delete(deletedSentinel);
      // Drop queued swap-ins for sentinels we just discarded so the rAF
      // tick doesn't try to mount them into a stale parent.
      if (vsSwapInQueued.has(deletedSentinel)) {
        vsSwapInQueued.delete(deletedSentinel);
        var qIdx = vsSwapInQueue.indexOf(deletedSentinel);
        if (qIdx !== -1) vsSwapInQueue.splice(qIdx, 1);
      }
    }

    // Update card count in case cards were added/removed
    var allCards = container.querySelectorAll(':scope > .card');
    var allPlaceholders = container.querySelectorAll(':scope > .vs-placeholder');
    state.cardCount = allCards.length + allPlaceholders.length;
  }

  /**
   * After the observer has had a chance to fire once, swap out any cards that
   * are NOT intersecting with placeholders.
   */
  function vsInitialSwap(state) {
    if (!vsObserver) return;
    state.sentinels.forEach(function (info, sentinel) {
      var card = info.cardEl;
      // If the card is still in the DOM and not near the viewport, replace it
      if (card.parentNode === state.container && !vsIsNearViewport(card)) {
        // Don't virtualise cards that are being edited
        var currentCardEditor = deps.getCurrentCardEditor ? deps.getCurrentCardEditor() : null;
        if (currentCardEditor && currentCardEditor.cardEl === card) return;
        state.container.replaceChild(sentinel, card);
        state.virtualised.add(card);
        vsObserver.observe(sentinel);
      }
    });
  }

  /**
   * Quick check whether an element is near the scroll viewport.
   */
  function vsIsNearViewport(el) {
    var root = vsGetRoot();
    if (!root) return true;
    var rootRect = root.getBoundingClientRect();
    var elRect = el.getBoundingClientRect();
    var buffer = 600;
    return (
      elRect.bottom >= rootRect.top - buffer &&
      elRect.top <= rootRect.bottom + buffer
    );
  }

  /**
   * IntersectionObserver callback.  When a sentinel scrolls into view, swap
   * the real card back in.  When a card scrolls out of view, swap the
   * sentinel back in.
   */
  function vsHandleIntersections(entries) {
    // During drag, do nothing — all cards need to be in the DOM.
    var ptrDrag = deps.getPtrDrag ? deps.getPtrDrag() : null;
    var cardDrag = deps.getCardDrag ? deps.getCardDrag() : null;
    if (ptrDrag || cardDrag) return;

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var el = entry.target;

      if (el.classList.contains('vs-placeholder')) {
        // A placeholder just became visible — queue a swap-in. Batched
        // in rAF with a per-frame budget so a fast scroll past N hidden
        // cards doesn't synchronously mount + render N cards in one tick.
        if (entry.isIntersecting) {
          vsScheduleSwapIn(el);
        }
      } else if (el.classList.contains('card')) {
        // A real card just left the viewport — swap it out
        if (!entry.isIntersecting) {
          vsSwapOut(el);
        }
      }
    }
  }

  /**
   * Replace a sentinel/placeholder with its real card element.
   */
  function vsSwapIn(sentinel) {
    var state = vsFindStateForElement(sentinel);
    if (!state) return;
    var info = state.sentinels.get(sentinel);
    if (!info) return;
    var card = info.cardEl;
    if (sentinel.parentNode) {
      sentinel.parentNode.replaceChild(card, sentinel);
      state.virtualised.delete(card);
      // Observe the real card so we know when it scrolls away
      if (vsObserver) {
        vsObserver.unobserve(sentinel);
        vsObserver.observe(card);
      }
    }
  }

  /**
   * Replace a real card element with its sentinel/placeholder.
   */
  function vsSwapOut(card) {
    // Don't virtualise cards that are being edited
    var currentCardEditor = deps.getCurrentCardEditor ? deps.getCurrentCardEditor() : null;
    if (currentCardEditor && currentCardEditor.cardEl === card) return;

    var state = vsFindStateForElement(card);
    if (!state) return;
    var sentinel = vsFindSentinelForCard(state, card);
    if (!sentinel) return;

    if (card.parentNode) {
      // Update placeholder height in case the card was resized
      sentinel.style.height = card.offsetHeight + 'px';
      card.parentNode.replaceChild(sentinel, card);
      state.virtualised.add(card);
      if (vsObserver) {
        vsObserver.unobserve(card);
        vsObserver.observe(sentinel);
      }
    }
  }

  function vsFindStateForElement(el) {
    return vsElementToState.get(el) || null;
  }

  function vsFindSentinelForCard(state, card) {
    return vsCardToSentinel.get(card) || null;
  }

  /**
   * During drag start, materialise ALL virtualised cards so that pointer
   * hit-testing works on every card.  Called from the drag start path.
   */
  function vsMaterialiseAll() {
    // Drain any pending swap-ins synchronously so pointer hit-testing
    // sees a fully consistent DOM — no half-flushed batch lingering.
    vsDrainSwapInQueue();
    if (vsColumnStates.size === 0) return;
    vsColumnStates.forEach(function (state) {
      state.sentinels.forEach(function (info, sentinel) {
        if (sentinel.parentNode && state.virtualised.has(info.cardEl)) {
          sentinel.parentNode.replaceChild(info.cardEl, sentinel);
          state.virtualised.delete(info.cardEl);
          if (vsObserver) {
            vsObserver.unobserve(sentinel);
            vsObserver.observe(info.cardEl);
          }
        }
      });
    });
  }

  /**
   * After drag ends, re-evaluate which cards should be virtualised.
   * Called from the drag cleanup path.
   */
  function vsRestoreAfterDrag() {
    if (vsColumnStates.size === 0) return;
    vsColumnStates.forEach(function (state) {
      state.sentinels.forEach(function (info, sentinel) {
        var card = info.cardEl;
        if (card.parentNode === state.container && !vsIsNearViewport(card)) {
          var currentCardEditor = deps.getCurrentCardEditor ? deps.getCurrentCardEditor() : null;
          if (currentCardEditor && currentCardEditor.cardEl === card) return;
          sentinel.style.height = card.offsetHeight + 'px';
          state.container.replaceChild(sentinel, card);
          state.virtualised.add(card);
          if (vsObserver) {
            vsObserver.unobserve(card);
            vsObserver.observe(sentinel);
          }
        }
      });
    });
  }

  return {
    init: function(d) {
      deps = d || {};
    },
    activate: vsActivate,
    teardown: vsTeardown,
    teardownColumn: vsTeardownColumn,
    remeasureColumn: vsRemeasureColumn,
    materialiseAll: vsMaterialiseAll,
    restoreAfterDrag: vsRestoreAfterDrag,
    // Test seams: the swap-in batching path needs deterministic
    // inspection without booting the full board renderer.
    _test_scheduleSwapIn: vsScheduleSwapIn,
    _test_processSwapInQueue: vsProcessSwapInQueue,
    _test_drainSwapInQueue: vsDrainSwapInQueue,
    _test_swapInQueueLength: function () { return vsSwapInQueue.length; },
    _test_swapInBudget: function () { return VS_SWAP_IN_BUDGET_PER_FRAME; }
  };
}));
