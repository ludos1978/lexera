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
      try {
        var configIframes = document.querySelectorAll('iframe');
        for (var c = 0; c < configIframes.length; c++) {
          try { configIframes[c].contentWindow.__LEXERA_AUTO_RUN_TESTS_SCHEDULED__ = true; } catch (_) {}
          try { configIframes[c].contentWindow.__LEXERA_TEST_RUNNER_CONFIG__ = config; } catch (_) {}
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

    // Poll for backend connectivity + board loaded instead of a fixed delay.
    // delayMs is the maximum wait — tests start as soon as the app is ready.
    var readyDeadline = Date.now() + delayMs;

    function isAppReady() {
      // Check for a loaded board in any reachable window (parent or iframe).
      // A board is loaded when LexeraTestApi (or the app's test API) reports
      // an active board id and fullBoardData with rows.
      function checkWindow(win) {
        try {
          if (!win) return false;
          var api = win.LexeraTestApi || (win.LexeraFrontendTests && typeof win.LexeraFrontendTests._getApi === 'function' ? win.LexeraFrontendTests._getApi() : null);
          if (api && typeof api.getActiveBoardId === 'function' && typeof api.getFullBoardData === 'function') {
            var bid = api.getActiveBoardId();
            var data = api.getFullBoardData();
            if (bid && data && data.rows && data.rows.length > 0) return true;
          }
          // Fallback: check runtime state directly
          var rt = win.LexeraRuntime;
          if (rt && typeof rt.getState === 'function') {
            var boards = rt.getState('boards');
            if (Array.isArray(boards) && boards.length > 0) return true;
          }
        } catch (_) {}
        return false;
      }
      if (checkWindow(window)) return true;
      try {
        var iframes = document.querySelectorAll('iframe');
        for (var i = 0; i < iframes.length; i++) {
          try { if (checkWindow(iframes[i].contentWindow)) return true; } catch (_) {}
        }
      } catch (_) {}
      return false;
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

    function pollReady() {
      if (isAppReady()) {
        console.log('[auto-run] app ready, starting tests (' + (Date.now() - (readyDeadline - delayMs)) + 'ms elapsed)');
        launchTests();
        return;
      }
      if (Date.now() >= readyDeadline) {
        console.warn('[auto-run] max wait (' + delayMs + 'ms) reached, starting tests anyway');
        launchTests();
        return;
      }
      setTimeout(pollReady, 300);
    }

    setTimeout(pollReady, 500);
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
    // Wait up to 30s for LexeraFrontendTests to become available
    // (board iframe may still be loading)
    var LFT = null;
    var waitStart = Date.now();
    while (Date.now() - waitStart < 30000) {
      LFT = findLexeraFrontendTests();
      if (LFT && typeof LFT.runAllWithUI === 'function') break;
      LFT = null;
      await new Promise(function (res) { setTimeout(res, 500); });
    }
    if (!LFT || typeof LFT.runAllWithUI !== 'function') {
      var msg = '[auto-run] LexeraFrontendTests not available after 30s at ' + new Date().toISOString();
      console.error(msg);
      if (outputPath) {
        try { await writeTestOutput(outputPath, msg); } catch (err) { console.error('[auto-run] write failed:', err); }
      }
      return;
    }

    console.log('[auto-run] starting tests');
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
        } catch (progressErr) {
          console.warn('[auto-run] failed to write progress:', progressErr);
        }
      }
      await new Promise(function (res) { setTimeout(res, 500); });
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

  // Start polling 2s after load
  setTimeout(tryFetchConfig, 2000);
})();
