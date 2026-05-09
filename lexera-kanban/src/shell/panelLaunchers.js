// Panel launchers — DevTools console helpers for opening Stage-4
// utility sub-apps (log, inspector, workspaces, dashboard) as either
// floating webviews or side-docked panels.
//
// Workstream 5 extraction: split out from `multiviewClient.js`.
// `multiviewClient.js` keeps thin delegation wrappers so the
// `LexeraMultiview.openLogView()` etc. public APIs continue to work.
//
// Side-panel mechanics (computeSlotRect, openAsSidePanel,
// closeSidePanel) live here too — they're the underlying primitive
// every per-kind launcher uses, and they're not used outside the
// launcher path.
//
// Public API (window.LexeraPanelLaunchers):
//   - openAsSidePanel(opts) / closeSidePanel(label)
//   - openLogView(opts) / closeLogView()
//   - openInspector(opts) / closeInspector()
//   - openWorkspaces(opts) / closeWorkspaces()
//   - openDashboard(opts) / closeDashboard()
//
// Launcher options shape:
//   { side?: 'left'|'right'|'bottom'|'top', size?: number,
//     topInset?: number, x?, y?, width?, height? }
// If `side` is set the launcher uses openAsSidePanel; otherwise the
// webview floats at (x, y) with the given size.

/**
 * @typedef {'left'|'right'|'bottom'|'top'} SidePanelEdge
 */

/**
 * @typedef {Object} SidePanelOpts
 * @property {string} label
 * @property {string} url
 * @property {SidePanelEdge} [side]
 * @property {number} [size]
 * @property {number} [topInset]
 */

/**
 * @typedef {Object} LauncherOpts
 * @property {SidePanelEdge} [side]
 * @property {number} [size]
 * @property {number} [topInset]
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * @typedef {Object} FloatingDefaults
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} SlotRect
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {(opts?: LauncherOpts) => Promise<*>} Launcher
 */

(function () {
  'use strict';

  /** @returns {*} */
  function multiview() {
    if (typeof window !== 'undefined' && window.LexeraMultiview) return window.LexeraMultiview;
    return null;
  }

  // ── Side-panel positioning ──────────────────────────────────────

  /** @type {Object<string, () => void>} */
  var sidePanelSubscriptions = {};

  /** @returns {SlotRect | null} */
  function getMainWindowClientRect() {
    if (typeof document === 'undefined' || !document.body) return null;
    var r = document.body.getBoundingClientRect();
    return { x: 0, y: 0, width: r.width, height: r.height };
  }

  /**
   * @param {SidePanelEdge} side
   * @param {number} size
   * @param {LauncherOpts | SidePanelOpts | undefined} opts
   * @returns {SlotRect | null}
   */
  function computeSlotRect(side, size, opts) {
    var topInset = opts && opts.topInset != null ? opts.topInset : 32;
    var rect = getMainWindowClientRect();
    if (!rect) return null;
    if (side === 'right') {
      return { x: rect.width - size, y: topInset, width: size, height: rect.height - topInset };
    }
    if (side === 'left') {
      return { x: 0, y: topInset, width: size, height: rect.height - topInset };
    }
    if (side === 'bottom') {
      return { x: 0, y: rect.height - size, width: rect.width, height: size };
    }
    if (side === 'top') {
      return { x: 0, y: topInset, width: rect.width, height: size };
    }
    return null;
  }

  /**
   * @param {SidePanelOpts} opts
   * @returns {Promise<*>}
   */
  function openAsSidePanel(opts) {
    var mv = multiview();
    if (!mv) return Promise.reject(new Error('LexeraMultiview not loaded'));
    var label = String(opts.label || 'side-panel');
    var url = String(opts.url || '');
    var side = opts.side || 'right';
    var size = opts.size != null ? opts.size : (side === 'bottom' || side === 'top' ? 250 : 380);
    var slot = computeSlotRect(side, size, opts);
    if (!slot) return Promise.reject(new Error('Could not compute slot rect'));

    var promise = mv.spawn({
      label: label, url: url,
      x: slot.x, y: slot.y, width: slot.width, height: slot.height
    });

    var resizeHandler = function () {
      var newSlot = computeSlotRect(side, size, opts);
      if (!newSlot) return;
      mv.setGeometry([{ label: label, x: newSlot.x, y: newSlot.y, width: newSlot.width, height: newSlot.height }])
        .catch(function () { /* webview may have been destroyed */ });
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', resizeHandler);
    }
    sidePanelSubscriptions[label] = resizeHandler;

    return promise;
  }

  /**
   * @param {string} label
   * @returns {Promise<*>}
   */
  function closeSidePanel(label) {
    var handler = sidePanelSubscriptions[label];
    if (handler && typeof window !== 'undefined') {
      window.removeEventListener('resize', handler);
      delete sidePanelSubscriptions[label];
    }
    var mv = multiview();
    return mv ? mv.destroy(label).catch(function () {}) : Promise.resolve();
  }

  // ── Per-kind launcher factory ────────────────────────────────────
  //
  // Every utility sub-app launcher is "open at side-panel | floating
  // window with default geometry". Factor that out so each launcher
  // is a 1-line registration.

  /**
   * @param {string} label
   * @param {string} url
   * @param {FloatingDefaults} floatingDefaults
   * @param {string | string[]} [openMessage]
   * @returns {Launcher}
   */
  function makeLauncher(label, url, floatingDefaults, openMessage) {
    return function launcher(opts) {
      opts = opts || {};
      var mv = multiview();
      if (!mv) return Promise.reject(new Error('LexeraMultiview not loaded'));
      // Activate the log/catalog/active-board bridges so the sub-app
      // can subscribe and immediately get current state.
      if (typeof mv.activateBridges === 'function') mv.activateBridges();
      if (opts.side) {
        return openAsSidePanel({
          label: label, url: url,
          side: opts.side, size: opts.size, topInset: opts.topInset
        }).then(function () {
          console.log('[' + label + '] opened as ' + opts.side + ' side panel');
        });
      }
      return mv.spawn({
        label: label, url: url,
        x: opts.x != null ? opts.x : (floatingDefaults.x || 100),
        y: opts.y != null ? opts.y : (floatingDefaults.y || 100),
        width: opts.width != null ? opts.width : floatingDefaults.width,
        height: opts.height != null ? opts.height : floatingDefaults.height
      }).then(function () {
        if (Array.isArray(openMessage)) openMessage.forEach(function (m) { console.log(m); });
        else if (openMessage) console.log(openMessage);
        else console.log('[' + label + '] opened');
      });
    };
  }

  var openLogView = makeLauncher(
    'log-view', 'views/log/index.html',
    { width: 800, height: 500 },
    [
      '[log-view] opened — every lexeraLog() will appear here',
      '[log-view] cleanup: await LexeraMultiview.closeLogView()'
    ]
  );
  var closeLogView = function () { return closeSidePanel('log-view'); };

  var openInspector = makeLauncher(
    'inspector', 'views/inspector/index.html',
    { width: 700, height: 600 }
  );
  var closeInspector = function () { return closeSidePanel('inspector'); };

  var openWorkspaces = makeLauncher(
    'workspaces', 'views/workspaces/index.html',
    { width: 320, height: 600 }
  );
  var closeWorkspaces = function () { return closeSidePanel('workspaces'); };

  var openDashboard = makeLauncher(
    'dashboard', 'views/dashboard/index.html',
    { width: 380, height: 500 }
  );
  var closeDashboard = function () { return closeSidePanel('dashboard'); };

  if (typeof window !== 'undefined') {
    window.LexeraPanelLaunchers = {
      openAsSidePanel: openAsSidePanel,
      closeSidePanel: closeSidePanel,
      openLogView: openLogView,
      closeLogView: closeLogView,
      openInspector: openInspector,
      closeInspector: closeInspector,
      openWorkspaces: openWorkspaces,
      closeWorkspaces: closeWorkspaces,
      openDashboard: openDashboard,
      closeDashboard: closeDashboard
    };
  }
})();
