// Frontend Tests control panel — child-webview UI for the legacy
// shell-owned test runner. The heavy runner still executes in the main
// shell window; this view is a multiview control surface over it.

(function () {
  'use strict';

  var statusEl = document.getElementById('status');
  var summaryEl = document.getElementById('summary');
  var progressEl = document.getElementById('progress');
  var activeBoardEl = document.getElementById('active-board');
  var categoriesEl = document.getElementById('categories');
  var resultsEl = document.getElementById('results');
  var runAllBtn = document.getElementById('run-all');
  var stopBtn = document.getElementById('stop');
  var clearBtn = document.getElementById('clear');
  var copyBtn = document.getElementById('copy');
  var refreshBtn = document.getElementById('refresh');
  var copyScopeEl = document.getElementById('copy-scope');

  var latestState = null;
  var pollTimer = 0;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDuration(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '';
    if (ms < 1) return '<1ms';
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(2) + 's';
  }

  function sendCommand(action, extra) {
    if (!window.LexeraSubApp || typeof window.LexeraSubApp.broadcast !== 'function') {
      return Promise.reject(new Error('no Tauri context'));
    }
    return window.LexeraSubApp.broadcast('frontend-tests-command', Object.assign({
      action: String(action || 'refresh-state')
    }, extra || {}));
  }

  function requestState() {
    return sendCommand('refresh-state').catch(function () {});
  }

  function renderEmpty(target, text) {
    target.innerHTML = '<div class="empty">' + escapeHtml(text) + '</div>';
  }

  function renderCategories(categories, running) {
    if (!Array.isArray(categories) || categories.length === 0) {
      renderEmpty(categoriesEl, 'No categories available.');
      return;
    }
    categoriesEl.innerHTML = '';
    categories.forEach(function (category) {
      var item = document.createElement('div');
      item.className = 'category-item';
      item.innerHTML =
        '<div class="category-row">' +
          '<div class="category-name">' + escapeHtml(category.name || '') + '</div>' +
          '<div class="category-stats">' +
            escapeHtml(String(category.completed || 0) + '/' + String(category.total || 0)) +
            ' complete · ' +
            escapeHtml(String(category.failed || 0)) +
            ' failed' +
          '</div>' +
        '</div>' +
        '<div class="category-actions">' +
          '<button class="mini-btn" data-action="run-category" data-category="' + escapeHtml(category.name || '') + '" type="button">Run</button>' +
          '<button class="mini-btn" data-action="clear-category" data-category="' + escapeHtml(category.name || '') + '" type="button">Clear</button>' +
        '</div>';
      categoriesEl.appendChild(item);
    });
    var buttons = categoriesEl.querySelectorAll('button[data-action]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].disabled = !!running;
    }
  }

  function renderResults(results) {
    if (!Array.isArray(results) || results.length === 0) {
      renderEmpty(resultsEl, 'No test results yet.');
      return;
    }
    var recent = results.slice(Math.max(0, results.length - 20)).reverse();
    resultsEl.innerHTML = '';
    recent.forEach(function (result) {
      var item = document.createElement('div');
      item.className = 'result-item ' + (result.passed ? 'pass' : 'fail');
      item.innerHTML =
        '<div class="result-head">' +
          '<div class="result-status">' + escapeHtml(result.passed ? 'PASS' : 'FAIL') + '</div>' +
          '<div class="result-name">' + escapeHtml(result.name || '') + '</div>' +
          '<div class="result-duration">' + escapeHtml(formatDuration(result.durationMs)) + '</div>' +
        '</div>' +
        (result.passed ? '' : '<div class="result-error">' + escapeHtml(result.error || 'Unknown failure') + '</div>');
      resultsEl.appendChild(item);
    });
  }

  function applyState(payload) {
    latestState = payload || null;
    if (!payload || payload.available !== true) {
      statusEl.textContent = payload && payload.error ? String(payload.error) : 'runner unavailable';
      summaryEl.textContent = 'Frontend tests runner unavailable.';
      progressEl.textContent = 'No run in progress';
      activeBoardEl.textContent = 'Board: none';
      runAllBtn.disabled = true;
      stopBtn.disabled = true;
      clearBtn.disabled = true;
      copyBtn.disabled = true;
      copyScopeEl.disabled = true;
      refreshBtn.disabled = false;
      renderEmpty(categoriesEl, 'Runner unavailable.');
      renderEmpty(resultsEl, 'Runner unavailable.');
      return;
    }

    var runState = payload.runState || {};
    var summary = payload.summary || {};
    var running = !!runState.active;
    var currentName = runState.currentTestName ? String(runState.currentTestName) : '';
    statusEl.textContent = running ? 'running' : 'connected';
    summaryEl.textContent =
      String(summary.completed || 0) + '/' + String(summary.total || 0) +
      ' completed · ' +
      String(summary.passed || 0) + ' passed · ' +
      String(summary.failed || 0) + ' failed';
    progressEl.textContent = running
      ? ('Running: ' + (currentName || 'starting') + (runState.phase ? ' · ' + runState.phase : ''))
      : 'No run in progress';
    activeBoardEl.textContent = 'Board: ' + (payload.activeBoardId || 'none');
    runAllBtn.disabled = running;
    stopBtn.disabled = !running;
    clearBtn.disabled = running;
    copyBtn.disabled = false;
    copyScopeEl.disabled = false;
    refreshBtn.disabled = false;
    renderCategories(payload.categories || [], running);
    renderResults(payload.results || []);
  }

  function handleCategoryClick(event) {
    var btn = event.target.closest('button[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    var category = btn.getAttribute('data-category') || '';
    if (action === 'run-category') {
      statusEl.textContent = 'running';
      sendCommand('run-category', { category: category }).catch(function () {
        statusEl.textContent = 'runner unavailable';
      });
    } else if (action === 'clear-category') {
      sendCommand('clear-category', { category: category }).catch(function () {
        statusEl.textContent = 'runner unavailable';
      });
    }
  }

  categoriesEl.addEventListener('click', handleCategoryClick);
  runAllBtn.addEventListener('click', function () {
    statusEl.textContent = 'running';
    sendCommand('run-all').catch(function () {
      statusEl.textContent = 'runner unavailable';
    });
  });
  stopBtn.addEventListener('click', function () {
    sendCommand('stop').catch(function () {
      statusEl.textContent = 'runner unavailable';
    });
  });
  clearBtn.addEventListener('click', function () {
    sendCommand('clear-results').catch(function () {
      statusEl.textContent = 'runner unavailable';
    });
  });
  copyBtn.addEventListener('click', function () {
    statusEl.textContent = 'copying';
    sendCommand('copy-results', { scope: copyScopeEl.value || 'all' }).then(function () {
      requestState();
    }).catch(function () {
      statusEl.textContent = 'runner unavailable';
    });
  });
  refreshBtn.addEventListener('click', function () {
    requestState();
  });

  if (window.LexeraSubApp && typeof window.LexeraSubApp.init === 'function') {
    window.LexeraSubApp.init({
      onReady: function () {
        statusEl.textContent = 'connected';
        requestState();
        if (!pollTimer) {
          pollTimer = setInterval(requestState, 1000);
        }
      },
      onError: function (err) {
        statusEl.textContent = String(err);
      },
      onCustom: {
        'frontend-tests-state': applyState
      }
    });
  } else {
    statusEl.textContent = 'no Tauri context';
    summaryEl.textContent = 'Frontend tests runner unavailable.';
    renderEmpty(categoriesEl, 'No Tauri context.');
    renderEmpty(resultsEl, 'No Tauri context.');
  }
})();
