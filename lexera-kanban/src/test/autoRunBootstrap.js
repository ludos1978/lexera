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

  function tryFetchConfig() {
    if (window.__LEXERA_AUTO_RUN_TESTS_SCHEDULED__) return;
    attempts++;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/auto-run-config.json?_=' + Date.now(), true);
      xhr.onload = function () {
        if (xhr.status === 200) {
          try {
            var config = JSON.parse(xhr.responseText);
            if (config && typeof config === 'object') {
              startAutoRun(config);
              return;
            }
          } catch (_) {}
        }
        if (attempts < maxAttempts) setTimeout(tryFetchConfig, 1000);
      };
      xhr.onerror = function () {
        if (attempts < maxAttempts) setTimeout(tryFetchConfig, 1000);
      };
      xhr.send();
    } catch (e) {
      if (attempts < maxAttempts) setTimeout(tryFetchConfig, 1000);
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

  function startAutoRun(config) {
    if (window.__LEXERA_AUTO_RUN_TESTS_SCHEDULED__) return;
    window.__LEXERA_AUTO_RUN_TESTS_SCHEDULED__ = true;

    var outputPath = config.output || null;
    var quitAfter = !!config.quit;
    var pinnedBoard = config.board || '';
    var delayMs = typeof config.delay === 'number' ? config.delay : 10000;

    // Seed board selection in ALL frames (parent + iframes)
    if (pinnedBoard) {
      try { localStorage.setItem('lexera-frontend-tests-board', pinnedBoard); } catch (_) {}
      try {
        var iframes = document.querySelectorAll('iframe');
        for (var i = 0; i < iframes.length; i++) {
          try { iframes[i].contentWindow.localStorage.setItem('lexera-frontend-tests-board', pinnedBoard); } catch (_) {}
        }
      } catch (_) {}
    }

    // Write early marker
    if (outputPath) {
      try {
        tauriInvoke('write_text_file', {
          path: outputPath,
          content: '[auto-run] bootstrap fired, delay=' + delayMs + 'ms, board=' + (pinnedBoard || '(none)') + '\n'
        });
      } catch (_) {}
    }

    // Wait for the configured delay, then start tests
    setTimeout(function () {
      performAutoRun(outputPath, quitAfter).catch(function (e) {
        console.error('[auto-run] failed:', e);
        if (outputPath) {
          try { tauriInvoke('write_text_file', { path: outputPath, content: '[auto-run] error: ' + (e && e.message ? e.message : String(e)) }); } catch (_) {}
        }
      });
    }, delayMs);
  }

  function findLexeraFrontendTests() {
    // Check parent window first
    if (window.LexeraFrontendTests) return window.LexeraFrontendTests;
    // In workspace-shell mode, the test harness lives inside an iframe
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try {
          var win = iframes[i].contentWindow;
          if (win && win.LexeraFrontendTests) return win.LexeraFrontendTests;
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  }

  async function performAutoRun(outputPath, quitAfter) {
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
        try { tauriInvoke('write_text_file', { path: outputPath, content: msg }); } catch (_) {}
      }
      return;
    }

    console.log('[auto-run] starting tests');
    LFT.runAllWithUI();

    // Poll until tests finish
    while (true) {
      try {
        if (LFT._runState && !LFT._runState.active) break;
      } catch (_) {}
      await new Promise(function (res) { setTimeout(res, 500); });
    }

    // Format results
    var outputText = '';
    try {
      outputText = typeof LFT._buildResults === 'function' ? LFT._buildResults() : 'no results formatter';
    } catch (err) {
      outputText = '[auto-run] failed to format: ' + (err && err.message ? err.message : String(err));
    }

    if (outputPath) {
      try {
        console.log('[auto-run] writing results to ' + outputPath);
        await tauriInvoke('write_text_file', { path: outputPath, content: outputText });
        console.log('[auto-run] results written');
      } catch (err) {
        console.error('[auto-run] write failed:', err);
      }
    } else {
      console.log('[auto-run] results:\n' + outputText);
    }

    if (quitAfter) {
      console.log('[auto-run] quitting');
      setTimeout(function () {
        try { tauriInvoke('quit_app', {}); } catch (_) {}
      }, 500);
    }
  }

  // Start polling 2s after load
  setTimeout(tryFetchConfig, 2000);
})();
