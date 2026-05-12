/**
 * LexeraMultiviewWebview
 *
 * Spawns and tracks Tauri child webviews ("multiview") that float above
 * placeholder DIVs in the workspace shell. Every board and panel tab is
 * hosted by a child webview — there is no iframe fallback.
 *
 * Owns:
 *   - per-tab spawn lifecycle state machine (pending → ready → destroying)
 *   - per-label in-flight spawn locks (prevents racing IPC calls)
 *   - circuit breaker (auto-disables on runaway spawn loops)
 *   - geometry pushers (placeholder rect → webview position)
 *   - health-dot painting
 *   - "already exists" adoption path (shell-reload recovery)
 *   - LRU lifecycle integration (spawn / touch via window.LexeraMultiview.lifecycle)
 *
 * Type shapes (TabRecordState / TabRecord / TabRecordMap) live in
 * dedicated typedef blocks below this one — keeping them in
 * separate comments avoids a TypeScript checkJs quirk where multiple
 * typedef declarations sharing a single comment with surrounding
 * prose are treated as duplicate identifiers.
 *
 * Setup contract:
 *   LexeraMultiviewWebview.setup({
 *     traceShell,               // function (string) → void
 *     getActiveLeafId,          // () → string
 *     getPlaceholder,           // (tabId) → DOM element or null
 *     findTabInAllTrees,        // (tabId) → { tab, leaf } or null
 *     isPanelTab,               // (tab) → boolean
 *     getPanelKind,             // (panelId) → string
 *     getEmbeddedUrlForTab,     // (tab) → string
 *     getHostWindowLabel        // () → top-level window label for child webview parent
 *   });
 *
 * Public API:
 *   ensure(tab, placeholder, src), destroy(tabId),
 *   cleanupLocalState(tabId), applyHealth(tabId, state),
 *   reapplyAllHealthDots(), labelForTab(tab), labelForTabId(tabId),
 *   tabIdFromLabel(label), spawnedLabel(tabId), destroyAll().
 */

/**
 * @typedef {('pending'|'ready'|'destroying')} TabRecordState
 *   Lifecycle state of one spawned child webview. Strings (not enum)
 *   so the value can travel through JSON / IPC payloads unchanged.
 */

/**
 * @typedef {Object} TabRecord
 * @property {string} url - Source URL the child webview is loading.
 *   Stable for the life of the record (a re-spawn replaces the
 *   record entirely).
 * @property {TabRecordState} state - Current lifecycle state. Read
 *   by dispatch sites to gate IPC ordering (e.g.
 *   `entry.state !== 'ready'` skips broadcasts).
 * @property {string} label - Tauri webview label this record owns.
 *   Globally unique across windows; suffixed with the shell's
 *   bootId to survive reload.
 * @property {number} [attempts] - Spawn-retry counter. Present only
 *   on records created via the retry loop; absent (undefined) on
 *   first-shot records.
 */

/**
 * @typedef {Object<string, TabRecord>} TabRecordMap
 *   Keyed by `tab.id` (the layout-tree tab identity, NOT the
 *   webview label). Use `labelForTabId(id)` to bridge between the
 *   two.
 */
(function () {
  'use strict';

  var boardHost = (typeof window !== 'undefined' && window.LexeraBoardHost) || null;
  if (!boardHost) {
    throw new Error('LexeraBoardHost global is required before multiviewWebview.js');
  }
  var panelHost = (typeof window !== 'undefined' && window.LexeraPanelHost) || null;
  if (!panelHost) {
    throw new Error('LexeraPanelHost global is required before multiviewWebview.js');
  }

  var deps = null;

  // Per-tab spawn lifecycle:
  //   absent      — no webview, no spawn in flight
  //   'pending'   — spawn IPC issued, awaiting Rust ack
  //   'ready'     — spawn confirmed, webview exists at .url
  //   'destroying'— destroy IPC issued, awaiting Rust ack
  // Encoding the state explicitly (rather than presence/url alone)
  // prevents render-loop re-entry and destroy/spawn races from
  // producing duplicate Rust webviews.
  /** @type {TabRecordMap} keyed by tab.id (NOT webview label). */
  var multiviewSpawnedTabs = {};
  var multiviewGeometryObservers = {};
  // Per-tab watchers that retry doSpawn() once the placeholder becomes
  // measurable (paint-visible, > 0×0). Without this, a placeholder
  // that's hidden at initial render would stay "spawning…" forever.
  var multiviewSpawnRetryWatchers = {};
  // Per-LABEL in-flight spawn promise. Hard fence against duplicate
  // `multiview_spawn` IPCs racing for the same Tauri webview label.
  var multiviewLabelSpawnLocks = {};
  var multiviewPendingLocalDestroyAcks = {};

  // Last-known health per tab so re-renders reapply the state.
  var lastKnownHealth = {};

  // Emergency kill switch for runaway-spawn loops.
  var MULTIVIEW_SPAWN_DISABLED = false;
  var CIRCUIT_BREAKER_THRESHOLD = 12;
  var CIRCUIT_BREAKER_WINDOW_MS = 1000;
  var ensureCallTimestamps = {};
  var debugGeometryOverrides = {};
  var lastDebugGeometryPayloads = {};
  // Slot-map: label → {x, y, width, height} actually pushed via
  // `pushGeometryForLabel`. When a refresh produces an update identical
  // to the previously-pushed one for the same label, skip the downstream
  // emit + IPC entirely. `pushGeomDeferred` already dedupes at the IPC
  // layer, but the debug-geometry emit + placeholder annotation here
  // fire on every call. `refreshAllGeometry` can run dozens of times per
  // second during a dock-divider drag — slot-map diffing eliminates the
  // hot loop's redundant work for slots whose geometry hasn't shifted.
  //
  // Invalidated when the slot is forcibly moved out-of-band:
  //   - parkWebviewOffscreen (the slot's actual position no longer
  //     matches the cached on-screen value)
  //   - destroy / cleanupLocalState (the label may be re-spawned later)
  var lastPushedGeometryByLabel = {};
  var hostGeometryContext = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    ready: false
  };
  var pendingHostGeometryPromise = null;
  var HOST_GEOMETRY_RETRY_MS = 50;

  // Verbose multiview tracing. Gated so per-ensure / per-doSpawn chatter
  // doesn't flood normal runs. Enable via `?ws-debug=1` URL param or
  // localStorage['ws-debug']='1'. ADOPT, BOOT, BEFOREUNLOAD markers always
  // print regardless.
  var WS_DEBUG_VERBOSE = (function () {
    try {
      var p = new URLSearchParams(window.location.search || '');
      if (p.get('ws-debug') === '1') return true;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('ws-debug') === '1') return true;
    } catch (_) {}
    return false;
  })();
  var _wsDebugSeq = 0;

  function wsDebug(msg, opts) {
    var force = !!(opts && opts.force);
    if (!force && !WS_DEBUG_VERBOSE) return;
    var seq = ++_wsDebugSeq;
    try {
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        window.__TAURI__.core.invoke('ws_debug_log', { message: '#' + seq + ' ' + String(msg) });
      }
    } catch (_) {}
  }
  function wsDebugForce(msg) { wsDebug(msg, { force: true }); }

  function labelForTabId(tabId) {
    return boardHost.multiviewLabelForTab(tabId);
  }

  // Compute the multiview webview label for a tab object, taking its
  // kind into account. Panel webviews use the 'panel-tab-' prefix so
  // the multiview-destroyed listener and LRU registry can disambiguate
  // them from board webviews ('board-tab-' prefix).
  function labelForTab(tab) {
    if (deps && deps.isPanelTab(tab)) return panelHost.panelLabelForTab(tab.id);
    return boardHost.multiviewLabelForTab(tab.id);
  }

  // Reverse lookup: tabId for a given webview label. Handles three
  // cases:
  //   1. Formula labels with our 'board-tab-<bootId>-' /
  //      'panel-tab-<bootId>-' prefixes — delegate to the host
  //      modules so the bootId is stripped correctly.
  //   2. Pool labels ('_pool_<n>') that were repurposed and now own
  //      a tab — we find the tabId by scanning the spawn registry
  //   3. Anything else: returns the original label so callers can
  //      surface it in logs/diagnostics.
  function tabIdFromLabel(label) {
    if (typeof label !== 'string') return '';
    if (label.indexOf('board-tab-') === 0) {
      return boardHost.tabIdFromBoardLabel(label);
    }
    if (label.indexOf('panel-tab-') === 0) {
      return panelHost.tabIdFromPanelLabel(label);
    }
    var tabIds = Object.keys(multiviewSpawnedTabs);
    for (var i = 0; i < tabIds.length; i++) {
      if (multiviewSpawnedTabs[tabIds[i]].label === label) return tabIds[i];
    }
    return label;
  }

  function noteLocalDestroy(label) {
    var key = String(label || '');
    if (!key) return;
    multiviewPendingLocalDestroyAcks[key] = (multiviewPendingLocalDestroyAcks[key] || 0) + 1;
  }

  function consumeLocalDestroyAck(label) {
    var key = String(label || '');
    var count = multiviewPendingLocalDestroyAcks[key] || 0;
    if (count <= 0) return false;
    if (count === 1) delete multiviewPendingLocalDestroyAcks[key];
    else multiviewPendingLocalDestroyAcks[key] = count - 1;
    return true;
  }

  function ensureHealthDot(placeholderEl) {
    return boardHost.ensureHealthDot(placeholderEl, document);
  }

  // Reapply known health states to all health dots in the DOM.
  // Called after render() so freshly-built tab headers get the
  // right color instead of the default 'unknown'.
  function reapplyAllHealthDots() {
    var dots = document.querySelectorAll('.ws-view-tab-health[data-tab-id]');
    for (var i = 0; i < dots.length; i++) {
      var id = dots[i].getAttribute('data-tab-id');
      if (!id) continue;
      var s = lastKnownHealth[id] || 'unknown';
      dots[i].setAttribute('data-health', s);
      dots[i].setAttribute('title', 'Connection state: ' + s);
    }
  }

  function applyHealth(tabId, healthState) {
    var s = healthState || 'unknown';
    lastKnownHealth[tabId] = s;
    var headerDots = document.querySelectorAll(
      '.ws-view-tab-health[data-tab-id="' + (tabId || '').replace(/"/g, '') + '"]');
    for (var i = 0; i < headerDots.length; i++) {
      headerDots[i].setAttribute('data-health', s);
      headerDots[i].setAttribute('title', 'Connection state: ' + s);
    }
    var placeholderEl = deps && deps.getPlaceholder ? deps.getPlaceholder(tabId) : null;
    if (placeholderEl && typeof placeholderEl.querySelector === 'function' &&
        placeholderEl.getAttribute && placeholderEl.getAttribute('data-multiview') === '1') {
      var dot = ensureHealthDot(placeholderEl);
      dot.setAttribute('data-health', s);
      dot.setAttribute('title', 'Connection state: ' + s);
    }
  }

  function multiviewUrlForTab(desiredSrc) {
    return boardHost.multiviewUrlForTab(desiredSrc);
  }

  function getMultiviewInset() {
    try {
      var p = new URLSearchParams(window.location.search || '');
      var v = parseInt(p.get('multiview-inset') || '0', 10);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    } catch (_) {
      return 0;
    }
  }

  function normalizeHostGeometryContext(raw) {
    raw = raw || {};
    return {
      x: Number(raw.x) || 0,
      y: Number(raw.y) || 0,
      width: Number(raw.width) || 0,
      height: Number(raw.height) || 0,
      ready: true
    };
  }

  function emptyHostGeometryContext() {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      ready: false
    };
  }

  function hasDesktopTauriBridge() {
    return !!(
      (window.LexeraMultiview && typeof window.LexeraMultiview.invoke === 'function') ||
      (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function')
    );
  }

  function shouldUseZeroHostGeometryFallback() {
    return !window.LexeraMultiview && !(window.__TAURI__ && window.__TAURI__.core);
  }

  function scheduleHostGeometryRetry(force) {
    pendingHostGeometryPromise = new Promise(function (resolve) {
      setTimeout(function () {
        pendingHostGeometryPromise = null;
        refreshHostGeometryContext(force).then(resolve);
      }, HOST_GEOMETRY_RETRY_MS);
    });
    return pendingHostGeometryPromise;
  }

  function getHostGeometryContext() {
    return {
      x: Number(hostGeometryContext.x) || 0,
      y: Number(hostGeometryContext.y) || 0,
      width: Number(hostGeometryContext.width) || 0,
      height: Number(hostGeometryContext.height) || 0,
      ready: !!hostGeometryContext.ready
    };
  }

  function refreshHostGeometryContext(force) {
    if (!force && hostGeometryContext.ready) return Promise.resolve(getHostGeometryContext());
    if (pendingHostGeometryPromise) return pendingHostGeometryPromise;
    var invoker = hasDesktopTauriBridge()
      ? ((window.LexeraMultiview && typeof window.LexeraMultiview.invoke === 'function' && window.LexeraMultiview.invoke) ||
        (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function' && window.__TAURI__.core.invoke))
      : null;
    if (!invoker) {
      if (shouldUseZeroHostGeometryFallback()) {
        hostGeometryContext = normalizeHostGeometryContext(null);
        return Promise.resolve(getHostGeometryContext());
      }
      hostGeometryContext = emptyHostGeometryContext();
      return scheduleHostGeometryRetry(force);
    }
    var requestPromise = invoker('multiview_get_host_geometry', {})
      .then(function (payload) {
        hostGeometryContext = normalizeHostGeometryContext(payload);
        return getHostGeometryContext();
      })
      .catch(function () {
        hostGeometryContext = emptyHostGeometryContext();
        return scheduleHostGeometryRetry(force);
      })
      .finally(function () {
        if (pendingHostGeometryPromise === requestPromise) {
          pendingHostGeometryPromise = null;
        }
      });
    pendingHostGeometryPromise = requestPromise;
    return requestPromise;
  }

  function getNativeGeometryConfig() {
    var host = getHostGeometryContext();
    return {
      inset: getMultiviewInset(),
      hostX: host.x,
      hostY: host.y,
      hostWidth: host.width,
      hostHeight: host.height,
      hostReady: host.ready
    };
  }

  function normalizeDebugGeometryOverride(raw) {
    raw = raw || {};
    return {
      x: Number(raw.x) || 0,
      y: Number(raw.y) || 0,
      width: Number(raw.width) || 0,
      height: Number(raw.height) || 0
    };
  }

  function getDebugGeometryOverride(label) {
    return normalizeDebugGeometryOverride(debugGeometryOverrides[String(label || '')]);
  }

  function setDebugGeometryOverride(label, override) {
    var key = String(label || '');
    if (!key) return;
    var normalized = normalizeDebugGeometryOverride(override);
    if (!normalized.x && !normalized.y && !normalized.width && !normalized.height) {
      delete debugGeometryOverrides[key];
      return;
    }
    debugGeometryOverrides[key] = normalized;
  }

  function computeNativeGeometry(label, placeholderEl) {
    if (!label || !placeholderEl || placeholderEl.offsetParent === null) return null;
    var r = placeholderEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    var config = getNativeGeometryConfig();
    var inset = config.inset;
    var adjust = getDebugGeometryOverride(label);

    return {
      label: label,
      x: config.hostX + r.left + inset + adjust.x,
      y: config.hostY + r.top + inset + adjust.y,
      width: Math.max(1, r.width - 2 * inset + adjust.width),
      height: Math.max(1, r.height - 2 * inset + adjust.height)
    };
  }

  function roundDebugGeometryValue(value) {
    return Math.round(Number(value) || 0);
  }

  function getPlaceholderBoardId(placeholderEl) {
    if (!placeholderEl || !placeholderEl.getAttribute) return '';
    var raw = placeholderEl.getAttribute('data-loaded-src') ||
      placeholderEl.getAttribute('data-src') || '';
    if (!raw) return '';
    try {
      var url = new URL(raw, window.location.href);
      return String(url.searchParams.get('board') || '');
    } catch (_) {
      return '';
    }
  }

  function describePlaceholderDebugTarget(label, placeholderEl) {
    if (!placeholderEl || !placeholderEl.getAttribute) return String(label || 'view');
    var panelKind = placeholderEl.getAttribute('data-panel-kind') || '';
    if (panelKind) return 'panel ' + panelKind;
    var boardId = getPlaceholderBoardId(placeholderEl);
    if (boardId) return 'board ' + boardId;
    var tabId = placeholderEl.getAttribute('data-tab-id') || '';
    return tabId ? ('view ' + tabId) : String(label || 'view');
  }

  function updatePlaceholderDebugGeometry(label, placeholderEl, update) {
    if (!placeholderEl || !placeholderEl.setAttribute || !update) return;
    var r = placeholderEl.getBoundingClientRect();
    var target = describePlaceholderDebugTarget(label, placeholderEl);
    var adjust = getDebugGeometryOverride(label);
    placeholderEl.setAttribute(
      'data-debug-shell-geometry',
      target +
      ' shell ' + roundDebugGeometryValue(r.left) + ',' + roundDebugGeometryValue(r.top) +
      ' ' + roundDebugGeometryValue(r.width) + 'x' + roundDebugGeometryValue(r.height) +
      ' delta ' + roundDebugGeometryValue(adjust.x) + ',' + roundDebugGeometryValue(adjust.y) +
      ' ' + roundDebugGeometryValue(adjust.width) + 'x' + roundDebugGeometryValue(adjust.height)
    );
  }

  function buildDebugGeometryPayload(label, placeholderEl, update) {
    if (!label || !placeholderEl || !update) return null;
    var r = placeholderEl.getBoundingClientRect();
    return {
      label: String(label),
      kind: placeholderEl.getAttribute ? String(placeholderEl.getAttribute('data-panel-kind') || '') : '',
      panelId: placeholderEl.getAttribute ? String(placeholderEl.getAttribute('data-panel-id') || '') : '',
      tabId: placeholderEl.getAttribute ? String(placeholderEl.getAttribute('data-tab-id') || '') : '',
      boardId: getPlaceholderBoardId(placeholderEl),
      adjust: getDebugGeometryOverride(label),
      shell: {
        x: roundDebugGeometryValue(r.left),
        y: roundDebugGeometryValue(r.top),
        width: roundDebugGeometryValue(r.width),
        height: roundDebugGeometryValue(r.height)
      },
      native: {
        x: roundDebugGeometryValue(update.x),
        y: roundDebugGeometryValue(update.y),
        width: roundDebugGeometryValue(update.width),
        height: roundDebugGeometryValue(update.height)
      }
    };
  }

  function emitDebugGeometryPayload(label, payload) {
    if (!label || !payload || !window.LexeraMultiview ||
        typeof window.LexeraMultiview.invoke !== 'function') {
      return;
    }
    lastDebugGeometryPayloads[String(label)] = payload;
    window.LexeraMultiview.invoke('multiview_emit_to', {
      target: String(label),
      event: 'debug-geometry',
      payload: payload
    }).catch(function () {});
  }

  function emitChildDebugGeometry(label, placeholderEl, update) {
    var payload = buildDebugGeometryPayload(label, placeholderEl, update);
    if (!payload) return;
    emitDebugGeometryPayload(label, payload);
  }

  function pushGeometryForLabel(label, placeholderEl) {
    if (!hostGeometryContext.ready) {
      refreshHostGeometryContext().then(function () {
        pushGeometryForLabel(label, placeholderEl);
      });
      return;
    }
    var update = computeNativeGeometry(label, placeholderEl);
    if (!update) {
      // Park whenever the placeholder isn't measurable. Covers:
      //   (a) offsetParent === null — an ancestor has display:none
      //       (e.g. dock fold collapses the panel content tabset). The
      //       native webview MUST be moved offscreen, not left at its
      //       previous position; otherwise it keeps painting on top of
      //       whatever now occupies that screen area (e.g. the fold
      //       strip). Root cause of "log viewer invisible when folded".
      //   (b) placeholderEl is missing entirely — Phase 5b safety net.
      //       The placeholder DOM was removed without going through the
      //       destroy path (MutationObserver should have caught it, but
      //       belt-and-braces against any future DOM-mutation path).
      //       Park the spawned webview offscreen so it cannot keep
      //       painting at its last on-screen position above the shell.
      if (label) parkWebviewOffscreen(label);
      return;
    }
    // Slot-map diff: if this slot's geometry is unchanged since the last
    // push, skip the debug emit + IPC entirely. See
    // `lastPushedGeometryByLabel` comment at module scope for the
    // rationale + invalidation rules.
    var prev = lastPushedGeometryByLabel[label];
    if (prev
        && prev.x === update.x
        && prev.y === update.y
        && prev.width === update.width
        && prev.height === update.height) {
      return;
    }
    lastPushedGeometryByLabel[label] = {
      x: update.x, y: update.y,
      width: update.width, height: update.height
    };
    updatePlaceholderDebugGeometry(label, placeholderEl, update);
    emitChildDebugGeometry(label, placeholderEl, update);
    if (typeof window.LexeraMultiview.pushGeomDeferred === 'function') {
      window.LexeraMultiview.pushGeomDeferred(update);
    } else {
      window.LexeraMultiview.setGeometry([update]).catch(function () {});
    }
  }

  function handleDebugGeometryAdjust(payload) {
    payload = payload || {};
    var label = String(payload.label || '');
    if (!label || !isHostedTabLabel(label)) return;
    var field = String(payload.field || '');
    if (['x', 'y', 'width', 'height'].indexOf(field) === -1) return;
    var delta = Number(payload.delta);
    if (!Number.isFinite(delta) || !delta) return;
    var next = getDebugGeometryOverride(label);
    next[field] += delta;
    setDebugGeometryOverride(label, next);
    var tabId = tabIdFromLabel(label);
    if (!deps || typeof deps.getPlaceholder !== 'function') return;
    var placeholderEl = deps.getPlaceholder(tabId);
    if (!placeholderEl) return;
    pushGeometryForLabel(label, placeholderEl);
  }

  function handleDebugGeometryRequest(payload) {
    payload = payload || {};
    var label = String(payload.label || '');
    if (!label || !isHostedTabLabel(label)) return;
    if (!hostGeometryContext.ready) {
      refreshHostGeometryContext().then(function () {
        handleDebugGeometryRequest(payload);
      });
      return;
    }
    var tabId = tabIdFromLabel(label);
    var placeholderEl = deps && typeof deps.getPlaceholder === 'function'
      ? deps.getPlaceholder(tabId)
      : null;
    if (placeholderEl) {
      var update = computeNativeGeometry(label, placeholderEl);
      if (update) {
        updatePlaceholderDebugGeometry(label, placeholderEl, update);
        emitChildDebugGeometry(label, placeholderEl, update);
        return;
      }
    }
    emitDebugGeometryPayload(label, lastDebugGeometryPayloads[label]);
  }

  function refreshAllGeometry() {
    if (!deps || typeof deps.getPlaceholder !== 'function') return;
    var tabIds = Object.keys(multiviewSpawnedTabs || {});
    for (var i = 0; i < tabIds.length; i++) {
      var tabId = tabIds[i];
      var entry = multiviewSpawnedTabs[tabId];
      if (!entry || entry.state !== 'ready' || !entry.label) continue;
      pushGeometryForLabel(entry.label, deps.getPlaceholder(tabId));
    }
  }

  /**
   * Find the native child-webview LABEL at a top-window screen coordinate,
   * by iterating the spawned-tabs map and hit-testing each placeholder's
   * top-window rect (placeholder rect + host-window origin offset).
   *
   * This is the Tauri-native equivalent of getFrameWindowAtTopPoint in
   * dragDropHandlers.js: that function walks `<iframe>` elements via
   * `topWin.document.elementFromPoint`, which doesn't see native Tauri
   * child webviews — those live in separate OS-level windows. Phase 5 of
   * the workspace-viewer cross-webview-drag work needs a way to ask
   * "which native webview is the cursor over?" and this primitive
   * provides it without an extra IPC round-trip (we already track the
   * geometry of every spawned webview via setGeometry).
   *
   * Returns the spawned-webview label string, or null if no spawned
   * webview's placeholder is hit (e.g. cursor is over plain shell DOM,
   * or the placeholder's offsetParent is null because an ancestor is
   * folded/hidden).
   *
   * @param {number} topX - x in TOP-window/host-window screen coordinates
   * @param {number} topY - y in TOP-window/host-window screen coordinates
   * @returns {string|null}
   */
  function getWebviewLabelAtTopPoint(topX, topY) {
    if (!deps || typeof deps.getPlaceholder !== 'function') return null;
    if (typeof topX !== 'number' || typeof topY !== 'number') return null;
    var config = getNativeGeometryConfig();
    var hostX = (config && typeof config.hostX === 'number') ? config.hostX : 0;
    var hostY = (config && typeof config.hostY === 'number') ? config.hostY : 0;
    var inset = (config && typeof config.inset === 'number') ? config.inset : 0;
    var tabIds = Object.keys(multiviewSpawnedTabs || {});
    for (var i = 0; i < tabIds.length; i++) {
      var tabId = tabIds[i];
      var entry = multiviewSpawnedTabs[tabId];
      if (!entry || entry.state !== 'ready' || !entry.label) continue;
      var ph = deps.getPlaceholder(tabId);
      if (!ph || ph.offsetParent === null) continue;
      if (typeof ph.getBoundingClientRect !== 'function') continue;
      var rect = ph.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) continue;
      var left = hostX + rect.left + inset;
      var top = hostY + rect.top + inset;
      var right = left + Math.max(0, rect.width - 2 * inset);
      var bottom = top + Math.max(0, rect.height - 2 * inset);
      if (topX >= left && topX <= right && topY >= top && topY <= bottom) {
        return entry.label;
      }
    }
    return null;
  }

  /**
   * Top-window rect for a given spawned webview, or null when the
   * webview isn't ready or its placeholder isn't laid out. Pairs
   * with `getWebviewLabelAtTopPoint` for the cross-webview drag
   * router (`hierarchyDragBridge.routeCrossViewDragPoint`): given a
   * source webview label + a cursor point in the source's document
   * coords, the bridge needs the source rect to convert to top-
   * window coords, and the target rect to convert back to the
   * target's local coords.
   *
   * @param {string} label
   * @returns {{left:number, top:number, right:number, bottom:number}|null}
   */
  function getWebviewRect(label) {
    if (!label || !deps || typeof deps.getPlaceholder !== 'function') return null;
    var config = getNativeGeometryConfig();
    var hostX = (config && typeof config.hostX === 'number') ? config.hostX : 0;
    var hostY = (config && typeof config.hostY === 'number') ? config.hostY : 0;
    var inset = (config && typeof config.inset === 'number') ? config.inset : 0;
    var tabIds = Object.keys(multiviewSpawnedTabs || {});
    for (var i = 0; i < tabIds.length; i++) {
      var entry = multiviewSpawnedTabs[tabIds[i]];
      if (!entry || entry.state !== 'ready' || entry.label !== label) continue;
      var ph = deps.getPlaceholder(tabIds[i]);
      if (!ph || ph.offsetParent === null) return null;
      if (typeof ph.getBoundingClientRect !== 'function') return null;
      var rect = ph.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return null;
      return {
        left: hostX + rect.left + inset,
        top: hostY + rect.top + inset,
        right: hostX + rect.left + inset + Math.max(0, rect.width - 2 * inset),
        bottom: hostY + rect.top + inset + Math.max(0, rect.height - 2 * inset)
      };
    }
    return null;
  }

  // Globally suppress (or restore) all spawned multiview webviews.
  // Used during drag and while shell-DOM overlays (dropdowns/menus) are
  // open so native child webviews don't paint over the shell's drop
  // indicators or popovers. Refcounted so concurrent suppressors (e.g.
  // user opens an overflow menu, then drags a tab) compose: webviews
  // stay hidden until every suppression is released.
  var _suppressionCount = 0;

  function shouldRestoreTabVisible(tabId) {
    if (!deps || typeof deps.getPlaceholder !== 'function') return true;
    var placeholderEl = deps.getPlaceholder(tabId);
    if (!placeholderEl) return false;
    var rect = (typeof placeholderEl.getBoundingClientRect === 'function')
      ? placeholderEl.getBoundingClientRect() : null;
    return (placeholderEl.classList && placeholderEl.classList.contains('is-active')) &&
      placeholderEl.offsetParent !== null &&
      rect && rect.width > 0;
  }

  function parkWebviewOffscreen(label) {
    // Invalidate the slot-map cache: parking moves the webview out-of-
    // band relative to the on-screen geometry we cached, so the next
    // valid on-screen pushGeometryForLabel must re-emit rather than diff
    // against a stale value.
    if (label) delete lastPushedGeometryByLabel[label];
    var update = { label: label, x: -50000, y: -50000, width: 1, height: 1 };
    if (typeof window.LexeraMultiview.pushGeomDeferred === 'function') {
      // `immediate: true` bypasses the rAF batcher so the webview moves
      // off-screen the same frame the placeholder becomes invisible.
      // Without this, a `collapseDock` reflow leaves the webview painting
      // at its pre-collapse coordinates for one animation tick — long
      // enough to cover the fold strip the user is supposed to click
      // to restore the dock. See `pushGeomDeferred` in multiviewClient.js.
      window.LexeraMultiview.pushGeomDeferred(update, { immediate: true });
    } else {
      window.LexeraMultiview.setGeometry([update]).catch(function () {});
    }
  }

  function syncSuppressedEntryVisibility(tabId, entry, nowSuppressed) {
    if (!entry || entry.state !== 'ready' || !entry.label) return;
    var shouldShow = !nowSuppressed && shouldRestoreTabVisible(tabId);
    window.LexeraMultiview.invoke('multiview_set_visible', {
      label: entry.label, visible: shouldShow
    }).catch(function () {});
    if (!shouldShow) {
      // Park offscreen too — belt-and-braces in case the OS hide is
      // delayed or unreliable on this platform.
      parkWebviewOffscreen(entry.label);
    }
  }

  function isAllVisibleSuppressed() {
    return _suppressionCount > 0;
  }

  function setAllVisible(visible) {
    var prevCount = _suppressionCount;
    if (visible) {
      if (_suppressionCount === 0) return;
      _suppressionCount -= 1;
    } else {
      _suppressionCount += 1;
    }
    var nowSuppressed = _suppressionCount > 0;
    var wasSuppressed = prevCount > 0;
    if (nowSuppressed === wasSuppressed) return;
    if (!window.LexeraMultiview || typeof window.LexeraMultiview.invoke !== 'function') return;
    var tabIds = Object.keys(multiviewSpawnedTabs || {});
    for (var i = 0; i < tabIds.length; i++) {
      var tabId = tabIds[i];
      var entry = multiviewSpawnedTabs[tabId];
      syncSuppressedEntryVisibility(tabId, entry, nowSuppressed);
    }
    if (!nowSuppressed) refreshAllGeometry();
  }

  function watchPlaceholderVisibility(tab, placeholderEl, pushGeomFn) {
    if (!tab || !tab.id) return;
    boardHost.watchPlaceholderVisibility(
      tab.id,
      placeholderEl,
      pushGeomFn,
      labelForTab(tab)
    );
  }

  function noteEnsureCall(tabId, label, url) {
    var now = Date.now();
    var arr = ensureCallTimestamps[tabId] || (ensureCallTimestamps[tabId] = []);
    arr.push(now);
    while (arr.length > 0 && now - arr[0] > CIRCUIT_BREAKER_WINDOW_MS) arr.shift();
    if (arr.length >= CIRCUIT_BREAKER_THRESHOLD && !MULTIVIEW_SPAWN_DISABLED) {
      MULTIVIEW_SPAWN_DISABLED = true;
      var msg = '[multiview] CIRCUIT BREAKER tripped — ' + arr.length +
        ' ensure() calls in ' + CIRCUIT_BREAKER_WINDOW_MS + 'ms for tab="' +
        tabId + '" label="' + label + '" url="' + url +
        '". Spawn auto-disabled. Reload after fix.';
      try { console.error(msg); } catch (_) {}
      try { if (window.lexeraLog) window.lexeraLog('error', msg); } catch (_) {}
    }
    return MULTIVIEW_SPAWN_DISABLED;
  }

  function ensure(tab, placeholderEl, desiredSrc) {
    if (!window.LexeraMultiview) return;
    if (MULTIVIEW_SPAWN_DISABLED) {
      placeholderEl.classList.add('is-loaded');
      placeholderEl.innerHTML = '<div class="mv-error-msg" style="padding:12px;opacity:.6">multiview spawn disabled (kill-switch active)</div>';
      return;
    }
    var label = labelForTab(tab);
    var url = multiviewUrlForTab(desiredSrc);
    var _e = multiviewSpawnedTabs[tab.id];
    wsDebug('ensure tab=' + tab.id + ' label=' + label +
      ' entryState=' + (_e ? _e.state : 'none') +
      ' lock=' + (multiviewLabelSpawnLocks[label] ? 'yes' : 'no') +
      ' urlMatch=' + (_e && _e.url === url));
    if (noteEnsureCall(tab.id, label, url)) {
      placeholderEl.classList.add('is-loaded');
      placeholderEl.innerHTML = '<div class="mv-error-msg" style="padding:12px;opacity:.6">circuit breaker tripped — see log</div>';
      return;
    }

    function pushGeom() {
      if (_suppressionCount > 0) {
        parkWebviewOffscreen(label);
        return;
      }
      pushGeometryForLabel(label, placeholderEl);
    }
    // One-shot retry: when doSpawn() can't measure the placeholder yet
    // (dock collapsed, layout hasn't settled, etc.), wait for the next
    // visibility / resize signal then try again.
    function scheduleSpawnRetryWhenMeasurable() {
      if (multiviewSpawnRetryWatchers[tab.id]) return;
      var disposers = [];
      function fire() {
        if (!multiviewSpawnRetryWatchers[tab.id]) return;
        multiviewSpawnRetryWatchers[tab.id] = null;
        for (var i = 0; i < disposers.length; i++) {
          try { disposers[i](); } catch (_) {}
        }
        ensure(tab, placeholderEl, desiredSrc);
      }
      multiviewSpawnRetryWatchers[tab.id] = { fire: fire, disposers: disposers };
      if (typeof ResizeObserver !== 'undefined') {
        var ro = new ResizeObserver(function () {
          var rr = placeholderEl.getBoundingClientRect();
          if (placeholderEl.isConnected && placeholderEl.offsetParent !== null &&
              rr.width > 0 && rr.height > 0) fire();
        });
        try { ro.observe(placeholderEl); disposers.push(function () { ro.disconnect(); }); }
        catch (_) {}
      }
      if (typeof IntersectionObserver !== 'undefined') {
        var io = new IntersectionObserver(function (entries) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting && entries[i].intersectionRatio > 0) { fire(); return; }
          }
        });
        try { io.observe(placeholderEl); disposers.push(function () { io.disconnect(); }); }
        catch (_) {}
      }
      if (typeof MutationObserver !== 'undefined' && placeholderEl.parentNode) {
        var mo = new MutationObserver(function () {
          var rr = placeholderEl.getBoundingClientRect();
          if (placeholderEl.isConnected && placeholderEl.offsetParent !== null &&
              rr.width > 0 && rr.height > 0) fire();
        });
        try {
          mo.observe(placeholderEl, { attributes: true, attributeFilter: ['class', 'style'] });
          if (placeholderEl.parentNode) {
            mo.observe(placeholderEl.parentNode, { attributes: true, attributeFilter: ['class', 'style'] });
          }
          disposers.push(function () { mo.disconnect(); });
        } catch (_) {}
      }
      // Fallback: poll every 500ms for up to 10s in case observers miss
      // (e.g., display:none → display:block via ancestor; intermittent
      // layout). 20 attempts × 500ms = 10s total, way under the
      // circuit-breaker window.
      var polls = 0;
      var pollInterval = setInterval(function () {
        polls += 1;
        var rr = placeholderEl.getBoundingClientRect();
        if (placeholderEl.isConnected && placeholderEl.offsetParent !== null &&
            rr.width > 0 && rr.height > 0) {
          clearInterval(pollInterval);
          fire();
        } else if (polls >= 20) {
          clearInterval(pollInterval);
          multiviewSpawnRetryWatchers[tab.id] = null;
          for (var i = 0; i < disposers.length; i++) {
            try { disposers[i](); } catch (_) {}
          }
        }
      }, 500);
      disposers.push(function () { clearInterval(pollInterval); });
    }
    function showSpawnErrorUi(err) {
      placeholderEl.classList.add('has-error');
      placeholderEl.classList.remove('is-loaded');
      placeholderEl.innerHTML =
        '<div class="mv-error-msg">Failed to load board webview.' +
        '<br><small>' + String(err && err.message || err).replace(/</g, '&lt;') + '</small>' +
        '<br><button type="button" data-mv-retry="1">Retry</button></div>';
      var retryBtn = placeholderEl.querySelector('[data-mv-retry]');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          placeholderEl.classList.remove('has-error');
          placeholderEl.innerHTML = '';
          delete multiviewSpawnedTabs[tab.id];
          ensure(tab, placeholderEl, desiredSrc);
        });
      }
    }
    function onSpawned() {
      multiviewSpawnedTabs[tab.id] = { url: url, state: 'ready', label: label };
      if (_suppressionCount > 0 && window.LexeraMultiview &&
          typeof window.LexeraMultiview.invoke === 'function') {
        syncSuppressedEntryVisibility(tab.id, multiviewSpawnedTabs[tab.id], true);
      }
      if (typeof window.lexeraLog === 'function') {
        window.lexeraLog('debug', '[multiview] spawned ' + label);
      }
      // Delay two frames so the browser can paint the spawning ring
      // transition before we mark loaded (otherwise the ring never shows).
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          placeholderEl.classList.add('is-loaded');
        });
      });
      // Multi-step geometry push: spawn-time, next frame, and 50/200ms
      // later. Catches the case where the placeholder is briefly mis-sized
      // while the dock layout is still settling — common during initial
      // render and tab activation cascades.
      requestAnimationFrame(pushGeom);
      setTimeout(pushGeom, 50);
      setTimeout(pushGeom, 200);
      if (typeof ResizeObserver !== 'undefined' && !multiviewGeometryObservers[tab.id]) {
        var ro = new ResizeObserver(function () { pushGeom(); });
        ro.observe(placeholderEl);
        multiviewGeometryObservers[tab.id] = ro;
      }
      window.addEventListener('resize', function () {
        refreshHostGeometryContext(true).then(pushGeom);
      });
      watchPlaceholderVisibility(tab, placeholderEl, pushGeom);
    }
    function doSpawn() {
      if (!hostGeometryContext.ready) {
        refreshHostGeometryContext().then(function () {
          doSpawn();
        });
        return;
      }
      wsDebug('doSpawn tab=' + tab.id + ' label=' + label +
        ' entryState=' + (multiviewSpawnedTabs[tab.id] ? multiviewSpawnedTabs[tab.id].state : 'none') +
        ' lock=' + (multiviewLabelSpawnLocks[label] ? 'yes' : 'no'));
      var update = computeNativeGeometry(label, placeholderEl);
      if (!placeholderEl.isConnected || !update) {
        // Placeholder is in the DOM but not yet measurable. Hook a
        // one-shot watcher that re-attempts as soon as the placeholder is
        // connected, paint-visible, and >0×0.
        scheduleSpawnRetryWhenMeasurable();
        return;
      }
      var x = update.x;
      var y = update.y;
      var w = update.width;
      var h = update.height;
      if (_suppressionCount > 0) {
        x = -50000;
        y = -50000;
        w = 1;
        h = 1;
      }
      if (deps && typeof deps.traceShell === 'function') {
        deps.traceShell(
          'spawn label=' + label +
          ' tab=' + tab.id +
          ' pos=(' + x + ', ' + y + ')' +
          ' size=(' + w + ', ' + h + ')' +
          ' active=' + placeholderEl.classList.contains('is-active') +
          ' connected=' + (!!placeholderEl.isConnected) +
          ' offsetParent=' + (placeholderEl.offsetParent ? 'set' : 'null')
        );
      }
      // Label-level in-flight lock. Hard fence so concurrent ensure()
      // calls share the same promise instead of issuing duplicate IPCs.
      if (multiviewLabelSpawnLocks[label]) {
        wsDebugForce('DEDUPE label=' + label + ' (in-flight)');
        if (typeof window.lexeraLog === 'function') {
          window.lexeraLog('debug', '[multiview] spawn de-duplicated for ' + label);
        }
        multiviewLabelSpawnLocks[label].then(onSpawned).catch(function (err) {
          if (typeof window.lexeraLog === 'function') {
            window.lexeraLog('warn', '[multiview] de-dupe wait for ' + label + ' failed: ' + (err && err.message || err));
          }
        });
        return;
      }
      // Mark pending BEFORE the IPC so render-loop re-entry sees a spawn
      // in flight and short-circuits. `attempts` accumulates across
      // recovery cycles for this tab; loop-stop guard for "already exists".
      var prior = multiviewSpawnedTabs[tab.id];
      var attempts = (prior && prior.attempts) ? prior.attempts : 0;
      multiviewSpawnedTabs[tab.id] = { url: url, state: 'pending', label: label, attempts: attempts };
      var lifecycleApi = window.LexeraMultiview.lifecycle;
      var parentWindow = deps && typeof deps.getHostWindowLabel === 'function'
        ? String(deps.getHostWindowLabel() || '')
        : '';
      var args = {
        label: label,
        url: url,
        x: x,
        y: y,
        width: w,
        height: h,
        parentWindow: parentWindow || null
      };
      var spawnPromise = lifecycleApi && typeof lifecycleApi.spawn === 'function'
        ? lifecycleApi.spawn(args)
        : window.LexeraMultiview.spawn(args).then(function () {
            return { label: label, fromPool: false };
          });
      multiviewLabelSpawnLocks[label] = spawnPromise.finally
        ? spawnPromise.finally(function () { delete multiviewLabelSpawnLocks[label]; })
        : spawnPromise.then(
            function (r) { delete multiviewLabelSpawnLocks[label]; return r; },
            function (e) { delete multiviewLabelSpawnLocks[label]; throw e; }
          );
      spawnPromise.then(function (result) {
        // Pool fast-path: actual webview lives at `result.label`
        // (e.g. `_pool_3`), not the formula label. Rebind so subsequent
        // ops (pushGeom, destroy, retry) address the correct webview.
        if (result && result.label && result.label !== label) {
          label = result.label;
          multiviewSpawnedTabs[tab.id].label = label;
        }
        onSpawned();
      }).catch(function (err) {
        console.warn('[multiview] spawn failed for', tab.id, err);
        if (typeof window.lexeraLog === 'function') {
          window.lexeraLog('warn', '[multiview] spawn failed for ' + label + ': ' + (err && err.message || err));
        }
        var msg = String(err && err.message || err || '');
        if (/already exists/i.test(msg)) {
          // ADOPT path: shell reload mid-session leaves Rust-side webviews
          // alive at our formula labels. Treat spawn as effectively
          // succeeded — populate local entry as 'ready' and run onSpawned.
          wsDebugForce('ADOPT label=' + label + ' (already exists in Rust)');
          if (typeof window.lexeraLog === 'function') {
            window.lexeraLog('info', '[multiview] adopting pre-existing webview ' + label);
          }
          multiviewSpawnedTabs[tab.id] = { url: url, state: 'ready', label: label, attempts: 0 };
          onSpawned();
          return;
        }
        delete multiviewSpawnedTabs[tab.id];
        showSpawnErrorUi(err);
      });
    }

    var entry = multiviewSpawnedTabs[tab.id];
    if (!entry) {
      doSpawn();
      return;
    }
    if (entry.state === 'pending' || entry.state === 'destroying') {
      // An IPC op is already in flight for this tab. Whichever resolver
      // eventually runs reconciles to the latest desired url via the
      // next render-driven ensure() call.
      return;
    }
    // entry.state === 'ready'
    if (entry.url !== url) {
      // URL change — destroy then respawn. Mark destroying first so
      // any concurrent ensure() short-circuits instead of stacking
      // additional spawn attempts on top.
      multiviewSpawnedTabs[tab.id] = { url: entry.url, state: 'destroying', label: label };
      noteLocalDestroy(label);
      window.LexeraMultiview.destroy(label).then(function () {
        delete multiviewSpawnedTabs[tab.id];
        ensure(tab, placeholderEl, desiredSrc);
      }).catch(function () {
        // Even on destroy failure, clear and retry — the next spawn
        // will surface the real error (or recover via "already exists").
        delete multiviewSpawnedTabs[tab.id];
        ensure(tab, placeholderEl, desiredSrc);
      });
      return;
    }
    // Already spawned at correct URL — refresh geometry only.
    requestAnimationFrame(pushGeom);
    // Hard fence (Phase 4.2): even if already ready, the placeholder element
    // might have been re-created by a shell re-render. Re-attach the visibility
    // observer to the new element so hover-unparking continues to work.
    watchPlaceholderVisibility(tab, placeholderEl, pushGeom);
  }

  function destroy(tabId) {
    if (!window.LexeraMultiview) return;
    var entry = multiviewSpawnedTabs[tabId];
    // Recover the panel/board-correct label from the lifecycle entry.
    // Fallback to the board prefix only if no entry exists — matches
    // legacy behavior for orphan-cleanup paths.
    var label = (entry && entry.label) || labelForTabId(tabId);
    if (label) delete lastPushedGeometryByLabel[label];
    if (multiviewGeometryObservers[tabId]) {
      try { multiviewGeometryObservers[tabId].disconnect(); } catch (_) {}
      delete multiviewGeometryObservers[tabId];
    }
    var _spawnRetry = multiviewSpawnRetryWatchers[tabId];
    if (_spawnRetry) {
      multiviewSpawnRetryWatchers[tabId] = null;
      var _disposers = _spawnRetry.disposers || [];
      for (var _ri = 0; _ri < _disposers.length; _ri++) {
        try { _disposers[_ri](); } catch (_) {}
      }
    }
    boardHost.cleanupVisibilityObserver(tabId);
    // Mark destroying BEFORE the IPC so a concurrent ensure() for the
    // same tab short-circuits instead of trying to spawn on top of a
    // half-torn-down webview. Keep the entry until Rust confirms.
    if (entry) {
      multiviewSpawnedTabs[tabId] = {
        url: entry.url,
        state: 'destroying',
        label: label
      };
    }
    noteLocalDestroy(label);
    window.LexeraMultiview.destroy(label).then(function () {
      delete multiviewSpawnedTabs[tabId];
    }).catch(function () {
      delete multiviewSpawnedTabs[tabId];
    });
  }

  // Local cleanup invoked when Rust unilaterally destroyed our webview
  // (LRU eviction or external destroy via the `multiview-destroyed`
  // event). Distinct from destroy() which initiates the destroy.
  function cleanupLocalState(tabId) {
    var entry = multiviewSpawnedTabs[tabId];
    if (entry && entry.label) delete lastPushedGeometryByLabel[entry.label];
    if (multiviewGeometryObservers[tabId]) {
      try { multiviewGeometryObservers[tabId].disconnect(); } catch (_) {}
      delete multiviewGeometryObservers[tabId];
    }
    var _spawnRetry = multiviewSpawnRetryWatchers[tabId];
    if (_spawnRetry) {
      multiviewSpawnRetryWatchers[tabId] = null;
      var _disposers = _spawnRetry.disposers || [];
      for (var _ri = 0; _ri < _disposers.length; _ri++) {
        try { _disposers[_ri](); } catch (_) {}
      }
    }
    boardHost.cleanupVisibilityObserver(tabId);
    // Preserve a 'pending' entry: if a fresh spawn is in flight, this
    // destroy event refers to an earlier lifecycle and must not stomp
    // the new one.
    var entry = multiviewSpawnedTabs[tabId];
    if (!entry || entry.state !== 'pending') {
      delete multiviewSpawnedTabs[tabId];
    }
  }

  function isHostedTabLabel(label) {
    if (typeof label !== 'string') return false;
    if (label.indexOf('board-tab-') === 0) return true;
    if (label.indexOf('panel-tab-') === 0) return true;
    // Pool-derived labels: a `_pool_<n>` webview that has been
    // repurposed for a tab is registered with that label.
    var tabIds = Object.keys(multiviewSpawnedTabs);
    for (var i = 0; i < tabIds.length; i++) {
      if (multiviewSpawnedTabs[tabIds[i]].label === label) return true;
    }
    return false;
  }

  function destroyAll() {
    var tabIds = Object.keys(multiviewSpawnedTabs);
    for (var i = 0; i < tabIds.length; i++) {
      try { destroy(tabIds[i]); } catch (_) {}
    }
  }

  function spawnedLabel(tabId) {
    var entry = multiviewSpawnedTabs[tabId];
    return entry && entry.label ? entry.label : '';
  }

  // ── Phase 4.1: orphan-placeholder MutationObserver ─────────────────
  //
  // Defense in depth on top of the lifecycle reconciler (Phase 2.2) and
  // the orphan reaper (Phase 1.4). Those two paths catch state-tree-
  // driven removals (`render()` rebuilds, `flattenToActiveLeaf`, etc.).
  // This observer catches DOM-mutation-driven removals — anything that
  // pulls a `[data-multiview="1"]` element out of the document without
  // going through the shell's render path. Examples that have caused
  // ghost views in the wild: `innerHTML = ''` on a parent container,
  // a third-party library yanking a node, a future code path that
  // splices a placeholder DIV directly.
  //
  // Two-rAF debounce: a placeholder removal followed by a re-attach
  // within 2 animation frames (move/extract/reorder) is NOT a real
  // removal, so the observer doesn't trigger destroy. The reattach
  // path will populate the element back into the DOM and the
  // `placeholder.isConnected` check at debounce flush time finds it.
  //
  // Lives in module scope so the unit test can drive it without
  // booting the whole shell.
  var _phaseFourObserverState = {
    observer: null,
    pending: {} // tabId → frames-remaining-before-flush
  };
  function _phaseFourCheckPending(rafImpl, getPlaceholderFn, destroyFn) {
    var ids = Object.keys(_phaseFourObserverState.pending);
    var stillPending = false;
    for (var i = 0; i < ids.length; i++) {
      var tabId = ids[i];
      _phaseFourObserverState.pending[tabId] -= 1;
      if (_phaseFourObserverState.pending[tabId] > 0) {
        stillPending = true;
        continue;
      }
      delete _phaseFourObserverState.pending[tabId];
      // After the debounce window, ask deps whether the placeholder is
      // back in DOM. If it is, the removal was a transient extract/
      // reattach and we leave the webview alone. Otherwise destroy.
      var ph = null;
      try { ph = typeof getPlaceholderFn === 'function' ? getPlaceholderFn(tabId) : null; }
      catch (_) {}
      var stillConnected = !!(ph && (ph.isConnected !== false));
      if (!stillConnected) {
        try { destroyFn(tabId); } catch (_) {}
      }
    }
    if (stillPending && typeof rafImpl === 'function') {
      rafImpl(function () { _phaseFourCheckPending(rafImpl, getPlaceholderFn, destroyFn); });
    }
  }
  function _phaseFourCollectRemovedTabIds(removedNodes) {
    var ids = [];
    if (!removedNodes) return ids;
    for (var i = 0; i < removedNodes.length; i++) {
      var n = removedNodes[i];
      if (!n || n.nodeType !== 1) continue; // elements only
      if (typeof n.getAttribute === 'function' && n.getAttribute('data-multiview') === '1') {
        var tabId = n.getAttribute('data-tab-id');
        if (tabId) ids.push(tabId);
      }
      // Also catch placeholders that were descendants of a removed
      // ancestor (e.g. dock-tabset removed wholesale).
      if (typeof n.querySelectorAll === 'function') {
        var nested = n.querySelectorAll('[data-multiview="1"]');
        for (var j = 0; j < nested.length; j++) {
          var nestedId = nested[j].getAttribute && nested[j].getAttribute('data-tab-id');
          if (nestedId) ids.push(nestedId);
        }
      }
    }
    return ids;
  }
  function installPhaseFourPlaceholderObserver(opts) {
    opts = opts || {};
    if (_phaseFourObserverState.observer) return _phaseFourObserverState.observer;
    if (typeof MutationObserver !== 'function') return null;
    var root = opts.root || (typeof document !== 'undefined' ? document.body : null);
    if (!root) return null;
    var rafImpl = opts.requestAnimationFrame
      || (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame
            : null);
    var getPlaceholderFn = opts.getPlaceholder
      || (deps && typeof deps.getPlaceholder === 'function' ? deps.getPlaceholder : null);
    var destroyFn = opts.destroy || destroy;
    if (!rafImpl) return null; // can't debounce without rAF
    var obs = new MutationObserver(function (mutations) {
      var any = false;
      for (var m = 0; m < mutations.length; m++) {
        var ids = _phaseFourCollectRemovedTabIds(mutations[m].removedNodes);
        for (var i = 0; i < ids.length; i++) {
          _phaseFourObserverState.pending[ids[i]] = 2;
          any = true;
        }
      }
      if (any) {
        rafImpl(function () { _phaseFourCheckPending(rafImpl, getPlaceholderFn, destroyFn); });
      }
    });
    try { obs.observe(root, { childList: true, subtree: true }); }
    catch (_) { return null; }
    _phaseFourObserverState.observer = obs;
    return obs;
  }

  function setup(setupDeps) {
    deps = setupDeps || {};

    if (typeof window === 'undefined') return;
    refreshHostGeometryContext();
    // Install the placeholder-removal observer once. Idempotent — if
    // already installed (e.g. setup() called twice for shell-reload
    // recovery) it returns the existing observer.
    try { installPhaseFourPlaceholderObserver(); } catch (_) {}

    if (window.__TAURI__ && window.__TAURI__.event) {
      window.__TAURI__.event.listen('health-changed', function (event) {
        var p = event && event.payload ? event.payload : {};
        var label = p.label || '';
        if (!isHostedTabLabel(label)) return;
        var tabId = tabIdFromLabel(label);
        applyHealth(tabId, p.state);
      });
      window.__TAURI__.event.listen('multiview-destroyed', function (event) {
        var p = event && event.payload ? event.payload : {};
        var label = p.label || '';
        if (!isHostedTabLabel(label)) return;
        var locallyInitiated = consumeLocalDestroyAck(label);
        if (deps && typeof deps.traceShell === 'function') {
          deps.traceShell('destroyed label=' + label + ' local=' + locallyInitiated);
        }
        wsDebugForce('multiview-destroyed event label=' + label + ' local=' + locallyInitiated);
        var tabId = tabIdFromLabel(label);
        cleanupLocalState(tabId);
        if (locallyInitiated) return;
        // Auto-respawn if this tab is the active tab of the active leaf
        // (user currently sees its placeholder). Otherwise lazy-spawn
        // happens on next activateTab as usual.
        var foundTab = deps.findTabInAllTrees ? deps.findTabInAllTrees(tabId) : null;
        if (!foundTab || !foundTab.leaf) return;
        var isActiveInLeaf = foundTab.leaf.activeTabId === tabId;
        var isActiveLeaf = deps.getActiveLeafId && deps.getActiveLeafId() === foundTab.leaf.id;
        if (isActiveInLeaf && isActiveLeaf) {
          var placeholderEl = deps.getPlaceholder ? deps.getPlaceholder(tabId) : null;
          if (placeholderEl && placeholderEl.getAttribute &&
              placeholderEl.getAttribute('data-multiview') === '1') {
            var desiredSrc;
            if (deps.isPanelTab(foundTab.tab)) {
              var panelKind = deps.getPanelKind(foundTab.tab.panelId);
              desiredSrc = panelHost.panelUrlForTab(foundTab.tab, panelKind, window.location.href);
            } else {
              desiredSrc = deps.getEmbeddedUrlForTab(foundTab.tab);
            }
            if (typeof window.lexeraLog === 'function') {
              window.lexeraLog('info', '[multiview] auto-respawning ' + label +
                ' (destroyed while visible)');
            }
            requestAnimationFrame(function () {
              ensure(foundTab.tab, placeholderEl, desiredSrc);
            });
          }
        }
      });
      window.__TAURI__.event.listen('debug-geometry-adjust', function (event) {
        handleDebugGeometryAdjust(event && event.payload ? event.payload : {});
      });
      window.__TAURI__.event.listen('debug-geometry-request', function (event) {
        handleDebugGeometryRequest(event && event.payload ? event.payload : {});
      });

      // Shell ('main') subscriptions: ensure the shell receives requests from
      // sub-apps even when other subscribers for these events exist.
      var shellLabel = 'main';
      try {
        if (window.__TAURI__ && window.__TAURI__.webview) {
          var _wv = null;
          if (typeof window.__TAURI__.webview.getCurrent === 'function') _wv = window.__TAURI__.webview.getCurrent();
          else if (typeof window.__TAURI__.webview.getCurrentWebview === 'function') _wv = window.__TAURI__.webview.getCurrentWebview();
          if (_wv) shellLabel = _wv.label || 'main';
        }
      } catch (_) {}

      if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
        window.__TAURI__.core.invoke('multiview_subscribe', {
          label: shellLabel,
          events: ['log-snapshot-request', 'log-reload-request', 'log-clear-request', 'log-message']
        }).catch(function () {});
      }
    }

    // Best-effort cleanup on main-window unload — destroys all child
    // webviews we've spawned. Tauri should cascade cleanup when the
    // window closes anyway, but explicit destroy minimizes orphaned
    // WebContent processes during dev/reload.
    if (deps && typeof deps.traceShell === 'function') {
      deps.traceShell('boot href=' + window.location.href);
    }
    wsDebugForce('BOOT shell href=' + window.location.href + ' label=' +
      ((window.__TAURI__ && window.__TAURI__.webview && window.__TAURI__.webview.getCurrent && window.__TAURI__.webview.getCurrent().label) || '?'));
    window.addEventListener('beforeunload', function () {
      if (deps && typeof deps.traceShell === 'function') {
        deps.traceShell('beforeunload');
      }
      wsDebugForce('BEFOREUNLOAD shell href=' + window.location.href);
      // One atomic Rust IPC instead of N fire-and-forget per-tab IPCs.
      // The previous loop racing the reload only landed the first one
      // or two destroy calls — the rest were dropped and the discarded
      // child webviews survived as ghosts at the new shell's spawn
      // coordinates. The Rust side now iterates and tears them down in
      // its own thread, so JS context teardown can't truncate the work.
      // Falls back to the per-tab loop if the new IPC isn't registered
      // (older Rust binary during a partial dev rebuild).
      var dispatchedAtomic = false;
      try {
        if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
          var winLabel = '';
          try {
            if (window.__TAURI__.window && typeof window.__TAURI__.window.getCurrent === 'function') {
              var w = window.__TAURI__.window.getCurrent();
              if (w && w.label) winLabel = String(w.label);
            }
          } catch (_) {}
          if (!winLabel && window.__TAURI__.webview && typeof window.__TAURI__.webview.getCurrentWebview === 'function') {
            try {
              var wv = window.__TAURI__.webview.getCurrentWebview();
              if (wv && wv.label) winLabel = String(wv.label);
            } catch (_) {}
          }
          if (!winLabel) winLabel = 'main';
          window.__TAURI__.core.invoke('multiview_destroy_all_for_window', { windowLabel: winLabel });
          dispatchedAtomic = true;
        }
      } catch (_) {}
      if (!dispatchedAtomic) destroyAll();
      if (window.LexeraMultiview && typeof window.LexeraMultiview.ghostHide === 'function') {
        try { window.LexeraMultiview.ghostHide(); } catch (_) {}
      }
    });
  }

  window.LexeraMultiviewWebview = {
    setup: setup,
    ensure: ensure,
    destroy: destroy,
    cleanupLocalState: cleanupLocalState,
    refreshAllGeometry: refreshAllGeometry,
    getWebviewLabelAtTopPoint: getWebviewLabelAtTopPoint,
    getWebviewRect: getWebviewRect,
    setAllVisible: setAllVisible,
    isAllVisibleSuppressed: isAllVisibleSuppressed,
    computeNativeGeometry: computeNativeGeometry,
    getNativeGeometryConfig: getNativeGeometryConfig,
    getHostGeometryContext: getHostGeometryContext,
    refreshHostGeometryContext: refreshHostGeometryContext,
    getDebugGeometryOverride: getDebugGeometryOverride,
    applyHealth: applyHealth,
    reapplyAllHealthDots: reapplyAllHealthDots,
    labelForTab: labelForTab,
    labelForTabId: labelForTabId,
    tabIdFromLabel: tabIdFromLabel,
    spawnedLabel: spawnedLabel,
    destroyAll: destroyAll,
    noteLocalDestroy: noteLocalDestroy,
    // Phase 4.1 placeholder MutationObserver — exposed so tests can
    // drive the install + collect path without mocking the entire
    // setup() boot sequence.
    _test_installPhaseFourPlaceholderObserver: installPhaseFourPlaceholderObserver,
    _test_phaseFourCollectRemovedTabIds: _phaseFourCollectRemovedTabIds,
    _test_phaseFourCheckPending: _phaseFourCheckPending,
    _test_phaseFourPendingState: function () { return _phaseFourObserverState.pending; },
    _test_phaseFourResetState: function () {
      _phaseFourObserverState.pending = {};
      if (_phaseFourObserverState.observer && typeof _phaseFourObserverState.observer.disconnect === 'function') {
        try { _phaseFourObserverState.observer.disconnect(); } catch (_) {}
      }
      _phaseFourObserverState.observer = null;
    },
    // Exposed for tests: lets a test verify that an invisible placeholder
    // causes the native webview to be parked offscreen rather than left at
    // its previous position (which would cover whatever now occupies the
    // shell-DOM area, e.g. the fold strip when a dock collapses).
    _test_pushGeometryForLabel: pushGeometryForLabel,
    // Read-only snapshot of the slot-map diff cache so tests can verify
    // that unchanged-slot suppression doesn't run debug emit + IPC.
    _test_lastPushedGeometryByLabel: function () {
      /** @type {{ [k: string]: { x: number; y: number; width: number; height: number } }} */
      var out = {};
      var keys = Object.keys(lastPushedGeometryByLabel);
      for (var i = 0; i < keys.length; i++) {
        var v = lastPushedGeometryByLabel[keys[i]];
        out[keys[i]] = { x: v.x, y: v.y, width: v.width, height: v.height };
      }
      return out;
    },
    // Diagnostic snapshot of webview lifecycle state. Read-only. Used by
    // the workspace shell's view-lifecycle audit (toggled via
    // `localStorage.LEXERA_VIEW_LEAK_AUDIT`) and by Vitest contracts.
    _test_leakReport: function () {
      /** @type {{ [k: string]: unknown }} */
      var spawnedDetail = {};
      var keys = Object.keys(multiviewSpawnedTabs);
      for (var i = 0; i < keys.length; i++) {
        var entry = multiviewSpawnedTabs[keys[i]];
        spawnedDetail[keys[i]] = entry ? {
          state: entry.state,
          label: entry.label,
          url: entry.url,
          attempts: entry.attempts || 0
        } : null;
      }
      return {
        spawnedTabs: keys.length,
        spawnedDetail: spawnedDetail,
        spawnedTabIds: keys.slice(),
        geometryObservers: Object.keys(multiviewGeometryObservers).length,
        spawnRetryWatchers: Object.keys(multiviewSpawnRetryWatchers).filter(function (k) {
          return !!multiviewSpawnRetryWatchers[k];
        }).length,
        spawnLocks: Object.keys(multiviewLabelSpawnLocks).length
      };
    }
  };
})();
