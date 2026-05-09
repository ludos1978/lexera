// @typedef declarations live at file scope so they're visible to
// every JSDoc annotation below. A leading line comment is required —
// without it, TS 5.9 parses the very first JSDoc block as both a
// module-description comment AND a typedef, producing a spurious
// `Duplicate identifier` error.

/**
 * @typedef {Object} LifecycleConfig
 * @property {number} softCap
 * @property {number} poolSize
 * @property {string} poolUrl
 * @property {string[]} pinnedLabels
 */

/**
 * @typedef {Object} SpawnOptions
 * @property {string} label
 * @property {string} url
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} GeometryUpdate
 * @property {string} label
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} WebviewListEntry
 * @property {string} label
 */

/**
 * @typedef {Object} LifecycleDeps
 * @property {(opts: SpawnOptions) => Promise<*>} spawn
 * @property {(label: string) => Promise<*>} destroy
 * @property {(updates: GeometryUpdate[]) => Promise<*>} setGeometry
 * @property {(label: string, url: string) => Promise<*>} navigateWebview
 * @property {() => Promise<WebviewListEntry[]>} listWebviews
 * @property {string} [locationSearch]
 * @property {LifecycleConfig} [config]
 */

/**
 * @typedef {Object} LifecycleSpawnResult
 * @property {string} label
 * @property {boolean} fromPool
 */

/**
 * @typedef {Object} LifecycleStatus
 * @property {LifecycleConfig} config
 * @property {Object<string, number>} freshness
 * @property {string[]} pool
 */

/**
 * @typedef {Object} LifecycleInstance
 * @property {(updates: Partial<LifecycleConfig>) => LifecycleConfig} configure
 * @property {() => LifecycleStatus} status
 * @property {(opts: SpawnOptions) => Promise<LifecycleSpawnResult>} spawn
 * @property {(label: string) => void} touch
 * @property {() => Promise<*>} evictOldestIfOverCap
 * @property {() => Promise<*>} refillPool
 * @property {() => LifecycleConfig} _getConfig
 * @property {() => Object<string, number>} _getFreshness
 * @property {() => string[]} _getPool
 */

/**
 * @typedef {Object} LexeraLifecycleApi
 * @property {(deps: LifecycleDeps) => LifecycleInstance} create
 * @property {(searchString?: string) => LifecycleConfig} defaultConfig
 */

(function () {
  'use strict';

  // Webview lifecycle: LRU freshness tracking, soft-cap eviction, and a
  // pre-warmed webview pool that the spawn fast-path can repurpose via
  // navigate (renderer process kept alive — much cheaper than add_child).
  //
  // The transport primitives (`spawn`, `destroy`, `setGeometry`,
  // `navigateWebview`, `listWebviews`) live in `multiviewClient.js` and
  // are dependency-injected via `create({...})`. Returns the lifecycle
  // API object — `multiviewClient.js` exposes it on
  // `LexeraMultiview.lifecycle`.

  /**
   * @param {string} [searchString]
   * @returns {LifecycleConfig}
   */
  function defaultConfig(searchString) {
    var defaults = {
      softCap: 8,
      // Perf #1 pool TEMPORARILY DISABLED while debugging the
      // "panel views are empty" regression. Panel webviews navigated
      // via the pool fast-path appear blank on macOS — we suspect the
      // navigate URL doesn't end up at the asset protocol's expected
      // scheme. The bare-spawn path uses Tauri's WebviewBuilder::App
      // which is known-good. Override with `?multiview-pool=2`.
      poolSize: 0,
      poolUrl: 'multiview-demo.html',
      pinnedLabels: ['inspector', 'log-view', 'workspaces', 'dashboard']
    };
    try {
      var params = new URLSearchParams(searchString || '');
      var cap = parseInt(params.get('multiview-cap') || '', 10);
      var pool = parseInt(params.get('multiview-pool') || '', 10);
      if (Number.isFinite(cap) && cap > 0) defaults.softCap = cap;
      if (Number.isFinite(pool) && pool >= 0) defaults.poolSize = pool;
    } catch (_) {}
    return defaults;
  }

  /**
   * @param {LifecycleDeps} deps
   * @returns {LifecycleInstance}
   */
  function create(deps) {
    if (!deps) deps = /** @type {LifecycleDeps} */ ({});
    var spawn = deps.spawn;
    var destroy = deps.destroy;
    var setGeometry = deps.setGeometry;
    var navigateWebview = deps.navigateWebview;
    var listWebviews = deps.listWebviews;
    if (typeof spawn !== 'function' || typeof destroy !== 'function' ||
        typeof setGeometry !== 'function' || typeof navigateWebview !== 'function' ||
        typeof listWebviews !== 'function') {
      throw new Error('LexeraLifecycle.create: missing required transport deps (spawn, destroy, setGeometry, navigateWebview, listWebviews)');
    }
    var locationSearch = deps.locationSearch != null ? deps.locationSearch
      : (typeof window !== 'undefined' && window.location ? window.location.search : '');
    var config = deps.config || defaultConfig(locationSearch);
    /** @type {Object<string, number>} */
    var freshness = {};       // label -> timestamp of last touch
    /** @type {string[]} */
    var pool = [];            // pre-warmed webview labels

    /** @param {string} label */
    function touch(label) {
      freshness[label] = Date.now();
    }

    /** @returns {Promise<*>} */
    function evictOldestIfOverCap() {
      return listWebviews().then(function (list) {
        var evictable = list.filter(function (w) {
          return config.pinnedLabels.indexOf(w.label) < 0
            && pool.indexOf(w.label) < 0;
        });
        if (evictable.length <= config.softCap) return null;
        evictable.sort(function (a, b) {
          return (freshness[a.label] || 0) - (freshness[b.label] || 0);
        });
        var victim = evictable[0].label;
        if (typeof console !== 'undefined' && console.log) {
          console.log('[lifecycle] evicting LRU webview:', victim);
        }
        if (typeof window !== 'undefined' && typeof window.lexeraLog === 'function') {
          window.lexeraLog('info', '[lifecycle] LRU evicted ' + victim +
            ' (' + evictable.length + '/' + config.softCap + ' over cap)');
        }
        delete freshness[victim];
        return destroy(victim);
      });
    }

    // Repurpose a pool webview by navigating it to a new URL. Returns
    // Promise<string|null> — the label of the repurposed webview if used
    // (caller MUST use this label going forward, NOT the originally
    // requested target — Tauri can't rename webviews), or null if no
    // pool member was available or navigation failed.
    /**
     * @param {string} _targetLabel
     * @param {string} url
     * @param {{x: number, y: number}} position
     * @param {{width: number, height: number}} size
     * @returns {Promise<string|null>}
     */
    function tryRepurposeFromPool(_targetLabel, url, position, size) {
      if (!pool.length) return Promise.resolve(null);
      var poolLabel = pool.shift();
      return setGeometry([{
        label: poolLabel, x: position.x, y: position.y,
        width: size.width, height: size.height
      }])
        .then(function () { return navigateWebview(poolLabel, url); })
        .then(function () {
          refillPool();
          return poolLabel;
        })
        .catch(function () {
          return null;
        });
    }

    /** @returns {Promise<*>} */
    function refillPool() {
      var deficit = config.poolSize - pool.length;
      if (deficit <= 0) return Promise.resolve();
      var spawns = [];
      for (var i = 0; i < deficit; i++) {
        var poolLabel = '_pool_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
        pool.push(poolLabel);
        spawns.push(spawn({
          label: poolLabel, url: config.poolUrl,
          x: -10000, y: -10000, width: 1, height: 1
        }).catch(function () { /* ignore */ }));
      }
      return Promise.all(spawns);
    }

    // Spawn that participates in lifecycle (touches freshness, may
    // trigger eviction). Tries the pre-warmed pool first via
    // `tryRepurposeFromPool` for instant first-show; falls back to a
    // cold `spawn` if the pool is empty or pool consumption fails.
    //
    // Returns Promise<{ label, fromPool }>. Callers MUST use the
    // returned `label` for all subsequent operations on the webview —
    // it differs from `opts.label` when the pool was consumed.
    /**
     * @param {SpawnOptions} opts
     * @returns {Promise<LifecycleSpawnResult>}
     */
    function lifecycleSpawn(opts) {
      var requestedLabel = opts.label;
      var position = { x: opts.x, y: opts.y };
      var size = { width: opts.width, height: opts.height };
      return tryRepurposeFromPool(requestedLabel, opts.url, position, size)
        .then(function (poolLabel) {
          if (poolLabel) {
            touch(poolLabel);
            evictOldestIfOverCap();
            return { label: poolLabel, fromPool: true };
          }
          return spawn(opts).then(function () {
            touch(requestedLabel);
            evictOldestIfOverCap();
            return { label: requestedLabel, fromPool: false };
          });
        });
    }

    /**
     * @param {Partial<LifecycleConfig>} updates
     * @returns {LifecycleConfig}
     */
    function configure(updates) {
      Object.keys(updates || {}).forEach(function (k) { config[k] = updates[k]; });
      if (config.poolSize > 0) refillPool();
      return Object.assign({}, config);
    }

    /** @returns {LifecycleStatus} */
    function status() {
      return {
        config: Object.assign({}, config),
        freshness: Object.assign({}, freshness),
        pool: pool.slice()
      };
    }

    return {
      configure: configure,
      status: status,
      spawn: lifecycleSpawn,
      touch: touch,
      evictOldestIfOverCap: evictOldestIfOverCap,
      refillPool: refillPool,
      // Test/inspection seam — read-only views of internal state.
      _getConfig: function () { return config; },
      _getFreshness: function () { return freshness; },
      _getPool: function () { return pool; }
    };
  }

  /** @type {LexeraLifecycleApi} */
  var api = {
    create: create,
    defaultConfig: defaultConfig
  };

  if (typeof window !== 'undefined') {
    window.LexeraLifecycle = api;
  }
})();
