/**
 * Auto-run bootstrap — loaded as a separate script AFTER frontendTests.js.
 * Polls for /auto-run-config.json written by the Rust --run-tests CLI flag.
 * Completely independent of the test harness IIFE — even if frontendTests.js
 * throws during initialization, this file's XHR still fires.
 */
(function () {
  'use strict';
  if (window.__LEXERA_AUTO_RUN_TESTS_SCHEDULED__) return;

  var attempts = 0;
  var maxAttempts = 30;

  // Best-effort forwarder into the in-app log viewer. Mirrors every
  // bootstrap message into lexeraLog so auto-run diagnostics show up in
  // the Log panel, not just the devtools console. No-ops when lexeraLog
  // isn't mounted yet (very early bootstrap).
  function bootstrapLog(level, message) {
    try {
      if (typeof window.lexeraLog === 'function') { window.lexeraLog(level, message); return; }
    } catch (_) {}
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try {
          var w = iframes[i].contentWindow;
          if (w && typeof w.lexeraLog === 'function') { w.lexeraLog(level, message); return; }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // Pre-test stall watchdog. While the runner sits in a pre-test phase
  // (no test body has started — `currentIndex < 0`, e.g. `pre-run-paint`
  // / `pre-run-board-ready` / `pre-test-paint`) the progress line stays
  // BYTE-IDENTICAL ("test 0/161 [pre-run-board-ready autoRun]"), so a
  // readiness stall is invisible in logs/frontend-tests.log: one frozen
  // line then silence when run-lexera-tests.sh kills the harness. This
  // pure helper turns that into an actionable diagnostic — it names the
  // stuck phase, elapsed time, and the known hard-timeout behaviour so
  // the operator knows it's a board-readiness gate (not a hung test) and
  // that waitForBoardReady() will abort the run at 90s. Returns null
  // when there is nothing actionable to report (run inactive, a test has
  // already started, or still under the warn threshold).
  var STALL_WARN_MS = 30000;
  function describeStall(state, elapsedMs) {
    if (!state || state.active === false) return null;
    var currentIndex = typeof state.currentIndex === 'number' ? state.currentIndex : -1;
    if (currentIndex >= 0) return null; // a test has started — not a pre-test stall
    if (!(typeof elapsedMs === 'number' && elapsedMs >= STALL_WARN_MS)) return null;
    var total = typeof state.total === 'number' ? state.total : 0;
    var phase = state.phase || 'unknown';
    var secs = Math.round(elapsedMs / 1000);
    return '[auto-run] STALL: still in pre-test phase \'' + phase + '\' after ' + secs +
      's — 0/' + total + ' tests started; the board-readiness gate has not been ' +
      'satisfied. waitForBoardReady() has a 90s hard timeout after which the run ' +
      'aborts with "Board not ready: ..." — see the [test.runner] readiness logs ' +
      'for the missing id/rows/dom signal.\n';
  }
  // Companion to the stall watchdog: once a run ends, surface WHY it
  // ended early. frontendTests.js records a `_runState.abort` marker
  // (source/phase/reason) before endRun() when the board-readiness
  // pre-flight fails; without flushing it the output log just shows the
  // frozen pre-test progress line and the operator never learns the
  // actionable reason. Pure — returns null when the run completed
  // normally (no abort marker).
  function describeAbort(state) {
    if (!state || !state.abort || typeof state.abort !== 'object') return null;
    var a = state.abort;
    var source = a.source || 'run';
    var phase = a.phase || 'unknown';
    var reason = a.reason || 'unknown';
    return '[auto-run] ABORTED: ' + source + ' pre-flight failed in phase \'' + phase +
      '\' — ' + reason + ' (no tests executed; this is the actionable reason the ' +
      'run ended early instead of producing results).\n';
  }
  // Test hooks: pure + side-effect-free, exposed in the same spirit as
  // LFT._runState / _buildResults so the watchdog + abort reporter can
  // be unit-tested without driving the whole async progress loop.
  try {
    window.__LEXERA_AUTO_RUN_DESCRIBE_STALL__ = describeStall;
    window.__LEXERA_AUTO_RUN_DESCRIBE_ABORT__ = describeAbort;
  } catch (_) {}

  function normalizeAutoRunConfig(config) {
    if (!config || typeof config !== 'object') return null;
    if (config.auto_run !== true && config.autoRun !== true) return null;
    return {
      board: config.board || '',
      delay: typeof config.delay === 'number'
        ? config.delay
        : (typeof config.delay_ms === 'number' ? config.delay_ms : undefined),
      output: config.output || config.output_path || null,
      quit: !!(config.quit || config.quit_after),
      includeFixturePath: config.includeFixturePath || config.include_fixture_path || '',
      filter: config.filter || config.test_filter || ''
    };
  }

  function startAutoRunIfConfigured(config) {
    var normalized = normalizeAutoRunConfig(config);
    if (!normalized) return false;
    window.__LEXERA_TEST_RUNNER_CONFIG__ = normalized;
    startAutoRun(normalized);
    return true;
  }

  function scheduleRetry() {
    if (attempts < maxAttempts) setTimeout(tryFetchConfig, 1000);
  }

  function tryTauriConfig() {
    try {
      var result = invokeTauriCommand('get_test_runner_config', {});
      if (result && typeof result.then === 'function') {
        return result.then(function (config) {
          return startAutoRunIfConfigured(config);
        }).catch(function () {
          return false;
        });
      }
      return Promise.resolve(startAutoRunIfConfigured(result));
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  function tryFetchConfig() {
    if (window.__LEXERA_AUTO_RUN_TESTS_SCHEDULED__) return;
    attempts++;
    tryTauriConfig().then(function (started) {
      if (started || window.__LEXERA_AUTO_RUN_TESTS_SCHEDULED__) return;
      tryFetchConfigFile();
    });
  }

  function tryFetchConfigFile() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/auto-run-config.json?_=' + Date.now(), true);
      xhr.onload = function () {
        if (xhr.status === 200) {
          try {
            var config = JSON.parse(xhr.responseText);
            if (startAutoRunIfConfigured(config)) {
              return;
            }
          } catch (_) {}
        }
        scheduleRetry();
      };
      xhr.onerror = function () {
        scheduleRetry();
      };
      xhr.send();
    } catch (e) {
      scheduleRetry();
    }
  }

  function tauriInvoke(cmd, args) {
    try {
      if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
        return window.__TAURI__.core.invoke(cmd, args || {});
      }
    } catch (_) {}
    return null;
  }

  function findReachableTauriInvoke() {
    function invokeFrom(win) {
      try {
        if (win && win.__TAURI__ && win.__TAURI__.core && typeof win.__TAURI__.core.invoke === 'function') {
          return function (cmd, args) { return win.__TAURI__.core.invoke(cmd, args || {}); };
        }
        if (win && win.__TAURI_INTERNALS__ && typeof win.__TAURI_INTERNALS__.invoke === 'function') {
          return function (cmd, args) { return win.__TAURI_INTERNALS__.invoke(cmd, args || {}); };
        }
      } catch (_) {}
      return null;
    }

    var direct = invokeFrom(window);
    if (direct) return direct;

    try {
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try {
          var invoke = invokeFrom(iframes[i].contentWindow);
          if (invoke) return invoke;
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  }

  function invokeTauriCommand(cmd, args) {
    var invoke = findReachableTauriInvoke();
    if (invoke) return invoke(cmd, args || {});
    return tauriInvoke(cmd, args || {});
  }

  var backendUrlPromise = null;

  function discoverBackendUrl() {
    if (backendUrlPromise) return backendUrlPromise;
    backendUrlPromise = (async function () {
      try {
        if (window.LexeraApi && typeof window.LexeraApi.discover === 'function') {
          var apiUrl = await window.LexeraApi.discover();
          if (apiUrl) return apiUrl;
        }
      } catch (_) {}

      try {
        if (
          window.LexeraBackendDiscovery &&
          typeof window.LexeraBackendDiscovery.discoverBackend === 'function'
        ) {
          var discovered = await window.LexeraBackendDiscovery.discoverBackend({
            useTauri: true,
            timeoutMs: 1200
          });
          if (discovered) return discovered;
        }
      } catch (_) {}

      return null;
    })();
    backendUrlPromise.then(function (url) {
      if (!url) backendUrlPromise = null;
    }, function () {
      backendUrlPromise = null;
    });
    return backendUrlPromise;
  }

  async function postTestOutputToBackend(outputPath, content) {
    var baseUrl = await discoverBackendUrl();
    if (!baseUrl) throw new Error('Backend URL unavailable');
    var res = await fetch(baseUrl + '/test-results', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
        'X-Output-Path': outputPath
      },
      body: content
    });
    if (!res.ok) {
      var bodyText = '';
      try { bodyText = await res.text(); } catch (_) {}
      throw new Error('Backend /test-results failed: ' + res.status + (bodyText ? ' ' + bodyText : ''));
    }
  }

  async function writeTestOutput(outputPath, content) {
    var backendError = null;
    try {
      await postTestOutputToBackend(outputPath, content);
      return;
    } catch (err) {
      backendError = err;
      console.warn('[auto-run] backend result write failed, trying Tauri fallback:', err);
    }

    var tauriResult = invokeTauriCommand('write_text_file', {
      path: outputPath,
      content: content
    });
    if (tauriResult && typeof tauriResult.then === 'function') {
      await tauriResult;
      return;
    }
    if (tauriResult) return;
    throw backendError || new Error('No test output writer available');
  }

  function startAutoRun(config) {
    try {
      if (window.parent && window.parent !== window && window.parent.__LEXERA_AUTO_RUN_TESTS_SCHEDULED__) return;
    } catch (_) {}
    if (window.__LEXERA_AUTO_RUN_TESTS_SCHEDULED__) return;
    window.__LEXERA_AUTO_RUN_TESTS_SCHEDULED__ = true;

    var outputPath = config.output || null;
    var quitAfter = !!config.quit;
    var pinnedBoard = config.board || '';
    var testFilter = config.filter || '';
    var delayMs = typeof config.delay === 'number' ? config.delay : 10000;
    window.__LEXERA_TEST_RUNNER_CONFIG__ = config;

    // Seed board selection in ALL frames (parent + iframes)
    if (pinnedBoard) {
      try { localStorage.setItem('lexera-frontend-tests-board', pinnedBoard); } catch (_) {}
      try {
        var iframes = document.querySelectorAll('iframe');
        for (var i = 0; i < iframes.length; i++) {
          try { iframes[i].contentWindow.__LEXERA_AUTO_RUN_TESTS_SCHEDULED__ = true; } catch (_) {}
          try { iframes[i].contentWindow.localStorage.setItem('lexera-frontend-tests-board', pinnedBoard); } catch (_) {}
          try { iframes[i].contentWindow.__LEXERA_TEST_RUNNER_CONFIG__ = config; } catch (_) {}
        }
      } catch (_) {}
    } else {
      try { localStorage.removeItem('lexera-frontend-tests-board'); } catch (_) {}
      try {
        var configIframes = document.querySelectorAll('iframe');
        for (var c = 0; c < configIframes.length; c++) {
          try { configIframes[c].contentWindow.__LEXERA_AUTO_RUN_TESTS_SCHEDULED__ = true; } catch (_) {}
          try { configIframes[c].contentWindow.__LEXERA_TEST_RUNNER_CONFIG__ = config; } catch (_) {}
          try { configIframes[c].contentWindow.localStorage.removeItem('lexera-frontend-tests-board'); } catch (_) {}
        }
      } catch (_) {}
    }

    if (testFilter) {
      try {
        var filterInput = document.querySelector('.lexera-shared-test-filter');
        if (filterInput) filterInput.value = testFilter;
      } catch (_) {}
      try {
        var filterIframes = document.querySelectorAll('iframe');
        for (var f = 0; f < filterIframes.length; f++) {
          try {
            var frameInput = filterIframes[f].contentDocument && filterIframes[f].contentDocument.querySelector('.lexera-shared-test-filter');
            if (frameInput) frameInput.value = testFilter;
          } catch (_) {}
        }
      } catch (_) {}
    }

    // Write early marker
    if (outputPath) {
      try {
        writeTestOutput(outputPath, '[auto-run] bootstrap fired, delay=' + delayMs + 'ms, board=' + (pinnedBoard || '(none)') + ', filter=' + (testFilter || '(none)') + '\n').catch(function (err) {
          console.error('[auto-run] failed to write bootstrap marker:', err);
        });
      } catch (_) {}
    }

    // Single readiness poll that checks BOTH board-loaded AND
    // LexeraFrontendTests availability before starting. This eliminates
    // the separate 30s wait inside performAutoRun and the stacked delays.
    var readyStart = Date.now();
    var readyDeadline = readyStart + delayMs;
    var lastStatus = '';
    var readinessObservers = [];
    var readinessPollScheduled = false;
    var readinessTaskPolls = 0;
    var maxReadinessTaskPolls = 120;

    function scheduleReadinessPoll() {
      if (readinessPollScheduled || window.__LEXERA_AUTO_RUN_TESTS_STARTED__) return;
      readinessPollScheduled = true;
      Promise.resolve().then(function () {
        readinessPollScheduled = false;
        pollReady();
      });
    }

    function disconnectReadinessObservers() {
      for (var oi = 0; oi < readinessObservers.length; oi++) {
        try { readinessObservers[oi].disconnect(); } catch (_) {}
      }
      readinessObservers = [];
    }

    function installReadinessObserver(doc) {
      if (!doc || !doc.body || typeof MutationObserver !== 'function') return;
      try {
        if (doc.body.__lexeraAutoRunReadinessObserved) return;
        doc.body.__lexeraAutoRunReadinessObserved = true;
        var obs = new MutationObserver(scheduleReadinessPoll);
        obs.observe(doc.body, { childList: true, subtree: true });
        readinessObservers.push(obs);
      } catch (_) {}
    }

    function installReadinessObservers() {
      installReadinessObserver(document);
      try {
        var iframes = document.querySelectorAll('iframe');
        for (var i = 0; i < iframes.length; i++) {
          try { installReadinessObserver(iframes[i].contentDocument); } catch (_) {}
        }
      } catch (_) {}
    }

    function scheduleReadinessTaskPoll() {
      if (readinessTaskPolls >= maxReadinessTaskPolls || window.__LEXERA_AUTO_RUN_TESTS_STARTED__) return;
      readinessTaskPolls++;
      try {
        if (typeof MessageChannel === 'function') {
          var channel = new MessageChannel();
          channel.port1.onmessage = function () {
            try { channel.port1.close(); } catch (_) {}
            try { channel.port2.close(); } catch (_) {}
            pollReady();
          };
          channel.port2.postMessage(0);
        }
      } catch (_) {}
    }

    function checkBoardReady(win) {
      try {
        if (!win) return false;
        var api = win.LexeraTestApi || (win.LexeraFrontendTests && typeof win.LexeraFrontendTests._getApi === 'function' ? win.LexeraFrontendTests._getApi() : null);
        if (api && typeof api.getActiveBoardId === 'function' && typeof api.getFullBoardData === 'function') {
          var bid = api.getActiveBoardId();
          var data = api.getFullBoardData();
          if (!bid || !data || !data.rows || data.rows.length === 0) return false;
          // Data is loaded — also verify the DOM has rendered at least one column.
          // Without this, tests can start before renderColumns() finishes the
          // initial paint and assertions on DOM counts fail.
          var doc = win.document;
          if (doc) {
            var container = doc.getElementById('columns-container') || doc.querySelector('.columns-container');
            if (container && container.querySelectorAll('.column').length > 0) return true;
          }
          return false;
        }
        var rt = win.LexeraRuntime;
        if (rt && typeof rt.getState === 'function') {
          var boards = rt.getState('boards');
          if (Array.isArray(boards) && boards.length > 0) return true;
        }
      } catch (_) {}
      return false;
    }

    function isFullyReady() {
      var boardReady = checkBoardReady(window);
      if (!boardReady) {
        try {
          var iframes = document.querySelectorAll('iframe');
          for (var i = 0; i < iframes.length && !boardReady; i++) {
            try { boardReady = checkBoardReady(iframes[i].contentWindow); } catch (_) {}
          }
        } catch (_) {}
      }
      var testsReady = !!findLexeraFrontendTests();
      var status = (boardReady ? 'board' : '-') + '/' + (testsReady ? 'tests' : '-');
      if (status !== lastStatus) {
        console.log('[auto-run] readiness: ' + status + ' (' + (Date.now() - readyStart) + 'ms)');
        bootstrapLog('info', '[auto-run] readiness: ' + status + ' (' + (Date.now() - readyStart) + 'ms)');
        if (outputPath) {
          writeTestOutput(outputPath, '[auto-run] readiness: ' + status + ' (' + (Date.now() - readyStart) + 'ms)\n').catch(function (err) {
            console.warn('[auto-run] failed to write readiness status:', err);
          });
        }
        lastStatus = status;
      }
      return boardReady && testsReady;
    }

    function launchTests() {
      performAutoRun(outputPath, quitAfter, testFilter).catch(function (e) {
        console.error('[auto-run] failed:', e);
        if (outputPath) {
          try {
            writeTestOutput(outputPath, '[auto-run] error: ' + (e && e.message ? e.message : String(e))).catch(function (err) {
              console.error('[auto-run] failed to write error output:', err);
            });
          } catch (_) {}
        }
      });
    }

    function setTestingStatus() {
      try {
        var ps = window.LexeraPollingService;
        if (ps && typeof ps.setConnected === 'function') { ps.setConnected('testing'); return; }
        var iframes = document.querySelectorAll('iframe');
        for (var i = 0; i < iframes.length; i++) {
          try {
            var ips = iframes[i].contentWindow && iframes[i].contentWindow.LexeraPollingService;
            if (ips && typeof ips.setConnected === 'function') { ips.setConnected('testing'); return; }
          } catch (_) {}
        }
      } catch (_) {}
    }

    var testingStatusSet = false;
    function pollReady() {
      if (!testingStatusSet) { setTestingStatus(); testingStatusSet = true; }
      if (isFullyReady()) {
        window.__LEXERA_AUTO_RUN_TESTS_STARTED__ = true;
        disconnectReadinessObservers();
        console.log('[auto-run] fully ready, starting tests (' + (Date.now() - readyStart) + 'ms)');
        bootstrapLog('info', '[auto-run] fully ready, starting tests (' + (Date.now() - readyStart) + 'ms)');
        launchTests();
        return;
      }
      // Even if the max-wait deadline fires, the runner's waitForBoardReady
      // pre-flight (runAllUI / runOneUI) will still block until the board
      // is loaded before dispatching any test body.
      if (Date.now() >= readyDeadline) {
        console.warn('[auto-run] max wait (' + delayMs + 'ms) reached, starting tests anyway');
        bootstrapLog('warn', '[auto-run] max wait (' + delayMs + 'ms) reached, starting tests anyway');
        launchTests();
        return;
      }
      installReadinessObservers();
      scheduleReadinessTaskPoll();
      setTimeout(pollReady, 250);
    }

    installReadinessObservers();
    pollReady();
  }

  function findLexeraFrontendTests() {
    // Collect ALL instances (parent + iframes) and pick the one with
    // the most registered tests. In workspace-shell mode, the parent
    // frame has a partial LexeraFrontendTests (only registerDoUndo
    // tests registered before a runtime error stops the IIFE). The
    // board iframe has the full 129-test suite.
    var best = null;
    var bestCount = 0;
    function consider(lft) {
      if (!lft || typeof lft.runAllWithUI !== 'function') return;
      var count = 0;
      try { count = typeof lft.list === 'function' ? lft.list().length : 0; } catch (_) {}
      if (count > bestCount) { best = lft; bestCount = count; }
    }
    try { consider(window.LexeraFrontendTests); } catch (_) {}
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try { consider(iframes[i].contentWindow.LexeraFrontendTests); } catch (_) {}
      }
    } catch (_) {}
    return best;
  }

  async function performAutoRun(outputPath, quitAfter, testFilter) {
    // The readiness poll already confirmed LexeraFrontendTests exists.
    // Re-resolve it here in case the iframe reference changed.
    var LFT = findLexeraFrontendTests();
    if (!LFT || typeof LFT.runAllWithUI !== 'function') {
      // Brief retry — iframe may have reloaded between readiness check and here
      var waitStart = Date.now();
      while (Date.now() - waitStart < 5000) {
        LFT = findLexeraFrontendTests();
        if (LFT && typeof LFT.runAllWithUI === 'function') break;
        LFT = null;
        await new Promise(function (res) { setTimeout(res, 300); });
      }
    }
    if (!LFT || typeof LFT.runAllWithUI !== 'function') {
      var msg = '[auto-run] LexeraFrontendTests not available at ' + new Date().toISOString();
      console.error(msg);
      bootstrapLog('error', msg);
      if (outputPath) {
        try { await writeTestOutput(outputPath, msg); } catch (err) { console.error('[auto-run] write failed:', err); }
      }
      return;
    }

    console.log('[auto-run] starting tests');
    bootstrapLog('info', '[auto-run] starting tests');
    LFT.runAllWithUI({ autoRun: true, filter: testFilter || '' });

    // Wait for the run to become active (runAllWithUI is async —
    // _runState.active starts false and flips to true once beginRun
    // fires). Without this wait, the first poll sees active=false
    // and exits immediately before any test runs.
    var activateDeadline = Date.now() + 10000;
    while (Date.now() < activateDeadline) {
      try { if (LFT._runState && LFT._runState.active) break; } catch (_) {}
      await new Promise(function (res) { setTimeout(res, 100); });
    }

    function describeRunProgress() {
      var state = LFT && LFT._runState ? LFT._runState : null;
      if (!state) return '[auto-run] running: state unavailable\n';
      var currentIndex = typeof state.currentIndex === 'number' ? state.currentIndex : -1;
      var total = typeof state.total === 'number' ? state.total : 0;
      var phase = state.phase || '';
      var autoRun = state.autoRun ? ' autoRun' : '';
      var name = '';
      try {
        if (typeof LFT._currentTestName === 'function') name = LFT._currentTestName();
      } catch (_) {}
      return '[auto-run] running: test ' + (currentIndex + 1) + '/' + total +
        (name ? ' ' + name : '') +
        (phase ? ' [' + phase + autoRun + ']' : '') + '\n';
    }

    // Poll until tests finish
    var lastProgressText = '';
    var lastProgressAt = 0;
    var runActiveSince = Date.now();
    var lastStallAt = 0;
    while (true) {
      try {
        if (LFT._runState && !LFT._runState.active) break;
      } catch (_) {}
      if (outputPath) {
        try {
          var progressText = describeRunProgress();
          var now = Date.now();
          if (progressText !== lastProgressText || now - lastProgressAt > 30000) {
            lastProgressText = progressText;
            lastProgressAt = now;
            await writeTestOutput(outputPath, progressText);
          }
          // Pre-test stall watchdog: escalates every STALL_WARN_MS while
          // stuck before the first test so the frozen progress line gets
          // an actionable companion instead of silence.
          var stallText = describeStall(LFT && LFT._runState ? LFT._runState : null, now - runActiveSince);
          if (stallText && now - lastStallAt >= STALL_WARN_MS) {
            lastStallAt = now;
            await writeTestOutput(outputPath, stallText);
            bootstrapLog('warn', stallText.trim());
          }
        } catch (progressErr) {
          console.warn('[auto-run] failed to write progress:', progressErr);
        }
      }
      await new Promise(function (res) { setTimeout(res, 500); });
    }

    // If the run ended early (e.g. the board-readiness pre-flight timed
    // out and aborted before any test ran), flush the actionable reason
    // so logs/frontend-tests.log explains WHY instead of trailing off
    // after the frozen pre-test progress line.
    if (outputPath) {
      try {
        var abortText = describeAbort(LFT && LFT._runState ? LFT._runState : null);
        if (abortText) {
          await writeTestOutput(outputPath, abortText);
          bootstrapLog('warn', abortText.trim());
        }
      } catch (_) {}
    }

    // Format results
    var outputText = '';
    try {
      if (outputPath) await writeTestOutput(outputPath, '[auto-run] formatting results\n');
      outputText = typeof LFT._buildResults === 'function' ? LFT._buildResults() : 'no results formatter';
    } catch (err) {
      outputText = '[auto-run] failed to format: ' + (err && err.message ? err.message : String(err));
    }

    if (outputPath) {
      try {
        console.log('[auto-run] writing results to ' + outputPath);
        await writeTestOutput(outputPath, outputText);
        console.log('[auto-run] results written');
      } catch (err) {
        console.error('[auto-run] write failed:', err);
      }
    } else {
      console.log('[auto-run] results:\n' + outputText);
    }

    if (quitAfter) {
      console.log('[auto-run] quitting in 2s');
      // Wait 2s after writing results to ensure the file write is
      // fully flushed to disk before the process exits. The backend
      // POST /test-results returns synchronously after writing, but
      // cargo tauri dev may restart the binary before the OS flushes.
      await new Promise(function (res) { setTimeout(res, 2000); });
      try { invokeTauriCommand('quit_app', {}); } catch (_) {}
    }
  }

  // Start checking for config immediately — Tauri command is available
  // as soon as the webview loads. The old 2s delay was unnecessary.
  setTimeout(tryFetchConfig, 200);
})();
