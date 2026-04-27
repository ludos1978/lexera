// Frontend Tests multiview sub-app.
//
// The heavy runner still lives in the main shell window, but this child
// webview now restores the legacy shared-panel layout and talks to the
// runner through the multiview bridge instead of shell-mounted DOM.

(function () {
  'use strict';

  var root = document.querySelector('.lexera-shared-panel-frontend-tests');
  var summaryEl = root ? root.querySelector('.lexera-shared-test-summary') : null;
  var listEl = root ? root.querySelector('.lexera-shared-test-list') : null;
  var boardSelectEl = root ? root.querySelector('.lexera-shared-test-board-select') : null;
  var filterEl = root ? root.querySelector('.lexera-shared-test-filter') : null;
  var runAllBtn = root ? root.querySelector('.lexera-shared-test-run-all') : null;
  var stopBtn = root ? root.querySelector('.lexera-shared-test-stop') : null;
  var clearBtn = root ? root.querySelector('.lexera-shared-test-clear-results') : null;
  var expandAllBtn = root ? root.querySelector('.lexera-shared-test-expand-all') : null;
  var collapseAllBtn = root ? root.querySelector('.lexera-shared-test-collapse-all') : null;
  var manualInspectEl = root ? root.querySelector('.lexera-shared-test-manual-inspect') : null;
  var continueUndoBtn = root ? root.querySelector('.lexera-shared-test-continue-undo') : null;
  var copyScopeEl = root ? root.querySelector('.lexera-shared-test-copy-scope') : null;
  var copyBtn = root ? root.querySelector('.lexera-shared-test-copy') : null;
  var refreshBtn = root ? root.querySelector('.lexera-shared-test-refresh') : null;
  var copyFeedbackEl = root ? root.querySelector('.lexera-shared-test-copy-feedback') : null;

  var latestState = null;
  var pollTimer = 0;
  var filterText = '';
  var expandedCategories = Object.create(null);
  var feedbackTimer = 0;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDuration(ms, phases) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '';
    var label = '';
    if (ms < 1) label = '<1ms';
    else if (ms < 1000) label = Math.round(ms) + 'ms';
    else label = (ms / 1000).toFixed(2) + 's';
    if (phases && (typeof phases.setupMs === 'number' || typeof phases.bodyMs === 'number' || typeof phases.teardownMs === 'number')) {
      label += ' (s:' + formatDurationPart(phases.setupMs) +
        ' b:' + formatDurationPart(phases.bodyMs) +
        ' t:' + formatDurationPart(phases.teardownMs) + ')';
    }
    return label;
  }

  function formatDurationPart(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '0ms';
    if (ms < 1) return '<1ms';
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(2) + 's';
  }

  function normalizedFilter() {
    return String(filterText || '').trim().toLowerCase();
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
    return sendCommand('refresh-state').catch(function () {
      setFeedback('Runner unavailable', true);
    });
  }

  function setFeedback(text, isError) {
    if (!copyFeedbackEl) return;
    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
      feedbackTimer = 0;
    }
    copyFeedbackEl.textContent = text || '';
    if (text) {
      copyFeedbackEl.style.color = isError ? 'var(--error, #d65454)' : 'var(--success, #2f8f46)';
      feedbackTimer = setTimeout(function () {
        copyFeedbackEl.textContent = '';
        feedbackTimer = 0;
      }, 2500);
    }
  }

  function buildResultMap(results) {
    var byName = Object.create(null);
    if (!Array.isArray(results)) return byName;
    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      if (!result || !result.name) continue;
      byName[result.name] = result;
    }
    return byName;
  }

  function buildTestsByCategory(testDefs) {
    var byCategory = Object.create(null);
    if (!Array.isArray(testDefs)) return byCategory;
    for (var i = 0; i < testDefs.length; i++) {
      var testDef = testDefs[i];
      if (!testDef || !testDef.name) continue;
      var categories = Array.isArray(testDef.categories) && testDef.categories.length
        ? testDef.categories
        : ['uncategorized'];
      for (var j = 0; j < categories.length; j++) {
        var categoryName = String(categories[j] || 'uncategorized');
        if (!byCategory[categoryName]) byCategory[categoryName] = [];
        byCategory[categoryName].push(testDef);
      }
    }
    return byCategory;
  }

  function buildCategoryState(payload) {
    var categories = Array.isArray(payload && payload.categories) ? payload.categories : [];
    var testsByCategory = buildTestsByCategory(payload && payload.tests);
    var ordered = [];
    var seen = Object.create(null);
    for (var i = 0; i < categories.length; i++) {
      var category = categories[i];
      if (!category || !category.name) continue;
      seen[category.name] = true;
      ordered.push({
        name: category.name,
        meta: category,
        tests: testsByCategory[category.name] || []
      });
    }
    var extraNames = Object.keys(testsByCategory);
    for (var j = 0; j < extraNames.length; j++) {
      if (seen[extraNames[j]]) continue;
      ordered.push({
        name: extraNames[j],
        meta: {
          name: extraNames[j],
          total: testsByCategory[extraNames[j]].length,
          completed: 0,
          passed: 0,
          failed: 0
        },
        tests: testsByCategory[extraNames[j]]
      });
    }
    return ordered;
  }

  function matchesFilter(testDef, categoryName) {
    var filter = normalizedFilter();
    if (!filter) return true;
    var categoryText = String(categoryName || '').toLowerCase();
    if (categoryText.indexOf(filter) >= 0) return true;
    return String(testDef && testDef.name ? testDef.name : '').toLowerCase().indexOf(filter) >= 0;
  }

  function isCategoryExpanded(categoryName, hasMatches) {
    if (normalizedFilter()) return !!hasMatches;
    if (!Object.prototype.hasOwnProperty.call(expandedCategories, categoryName)) return false;
    return expandedCategories[categoryName] === true;
  }

  function setSummary(text, tone) {
    if (!summaryEl) return;
    summaryEl.textContent = text || '';
    summaryEl.classList.remove('is-running', 'is-error', 'is-success');
    if (tone) summaryEl.classList.add(tone);
  }

  function renderSummary(payload) {
    if (!payload || payload.available !== true) {
      setSummary(payload && payload.error ? String(payload.error) : 'Frontend tests runner unavailable.', 'is-error');
      return;
    }
    var runState = payload.runState || {};
    var summary = payload.summary || {};
    var total = typeof summary.total === 'number' ? summary.total : 0;
    var completed = typeof summary.completed === 'number' ? summary.completed : 0;
    var passed = typeof summary.passed === 'number' ? summary.passed : 0;
    var failed = typeof summary.failed === 'number' ? summary.failed : 0;
    var selectedBoard = payload.selectedBoardId ? ' [' + payload.selectedBoardId + ']' : '';
    if (payload.awaitingUndo) {
      setSummary('Inspect the current board state, then click Restore Snapshot.' + selectedBoard, 'is-running');
      return;
    }
    if (runState.active) {
      var label = runState.currentTestName ? 'Running ' + runState.currentTestName : 'Run in progress';
      setSummary(label + ' · ' + completed + '/' + total + ' complete' + selectedBoard, 'is-running');
      return;
    }
    if (completed === 0) {
      setSummary(total + ' tests' + selectedBoard, '');
      return;
    }
    setSummary(passed + ' passed, ' + failed + ' failed / ' + total + selectedBoard, failed > 0 ? 'is-error' : 'is-success');
  }

  function renderBoardOptions(payload) {
    if (!boardSelectEl) return;
    var options = Array.isArray(payload && payload.boardOptions) ? payload.boardOptions : [];
    var selectedBoardId = payload && payload.selectedBoardId ? String(payload.selectedBoardId) : '';
    boardSelectEl.innerHTML = '';
    if (!options.length) {
      boardSelectEl.disabled = true;
      boardSelectEl.innerHTML = '<option value="">Active Board</option>';
      return;
    }
    var matchedSelection = false;
    for (var i = 0; i < options.length; i++) {
      var option = options[i];
      if (!option || !option.id) continue;
      var opt = document.createElement('option');
      opt.value = option.id;
      opt.textContent = (option.title || option.id) + (option.isRemote ? ' [remote]' : '');
      if (option.id === selectedBoardId) matchedSelection = true;
      boardSelectEl.appendChild(opt);
    }
    if (!matchedSelection && selectedBoardId) {
      var extra = document.createElement('option');
      extra.value = selectedBoardId;
      extra.textContent = selectedBoardId;
      boardSelectEl.appendChild(extra);
    }
    boardSelectEl.value = matchedSelection || selectedBoardId ? selectedBoardId : (boardSelectEl.options[0] ? boardSelectEl.options[0].value : '');
  }

  function updateControlState(payload) {
    var available = !!(payload && payload.available === true);
    var runState = payload && payload.runState ? payload.runState : {};
    var running = !!runState.active;
    var awaitingUndo = !!(payload && payload.awaitingUndo);
    var visibleCount = countVisibleTests(payload);
    var totalCount = payload && typeof payload.totalTests === 'number' ? payload.totalTests : 0;

    if (runAllBtn) {
      runAllBtn.disabled = !available || running;
      runAllBtn.textContent = normalizedFilter() ? ('Run ' + visibleCount + '/' + totalCount) : 'Run All';
    }
    if (stopBtn) {
      stopBtn.disabled = !available || !running;
      stopBtn.textContent = runState.cancelRequested ? 'Stopping…' : 'Stop Run';
    }
    if (clearBtn) clearBtn.disabled = !available || running;
    if (copyBtn) copyBtn.disabled = !available;
    if (copyScopeEl) copyScopeEl.disabled = !available;
    if (boardSelectEl) boardSelectEl.disabled = !available || running || boardSelectEl.options.length === 0;
    if (manualInspectEl) {
      manualInspectEl.checked = !!(payload && payload.manualInspectEnabled);
      manualInspectEl.disabled = !available || (running && !awaitingUndo);
    }
    if (continueUndoBtn) continueUndoBtn.disabled = !available || !awaitingUndo;
    if (filterEl) filterEl.disabled = !available;
    if (refreshBtn) refreshBtn.disabled = false;
    if (expandAllBtn) expandAllBtn.disabled = !available;
    if (collapseAllBtn) collapseAllBtn.disabled = !available;
  }

  function countVisibleTests(payload) {
    var categories = buildCategoryState(payload || {});
    var seen = Object.create(null);
    var visible = 0;
    for (var i = 0; i < categories.length; i++) {
      for (var j = 0; j < categories[i].tests.length; j++) {
        var testDef = categories[i].tests[j];
        if (!testDef || !testDef.name || seen[testDef.name]) continue;
        if (matchesFilter(testDef, categories[i].name)) {
          seen[testDef.name] = true;
          visible++;
        }
      }
    }
    return visible;
  }

  function renderEmpty(text) {
    if (!listEl) return;
    listEl.innerHTML = '<div class="test-state-empty">' + escapeHtml(text) + '</div>';
  }

  function buildCategoryCount(meta, totalCount, visibleCount) {
    var filter = normalizedFilter();
    var className = 'test-category-count';
    var text = String(totalCount);
    if (filter) {
      text = String(visibleCount) + '/' + String(totalCount);
    } else if (meta && (meta.passed > 0 || meta.failed > 0)) {
      text = String(meta.passed || 0) + '/' + String(totalCount);
      if (meta.failed > 0) {
        text += ' · ' + String(meta.failed) + ' failed';
        className += ' has-fail';
      } else {
        className += ' has-pass';
      }
    }
    return { text: text, className: className };
  }

  function renderList(payload) {
    if (!listEl) return;
    if (!payload || payload.available !== true) {
      renderEmpty('Runner unavailable.');
      return;
    }
    var categories = buildCategoryState(payload);
    var resultMap = buildResultMap(payload.results);
    var runState = payload.runState || {};
    var running = !!runState.active;
    if (!categories.length) {
      renderEmpty('No tests available.');
      return;
    }

    listEl.innerHTML = '';
    for (var i = 0; i < categories.length; i++) {
      var category = categories[i];
      var visibleTests = [];
      for (var j = 0; j < category.tests.length; j++) {
        if (matchesFilter(category.tests[j], category.name)) visibleTests.push(category.tests[j]);
      }
      if (normalizedFilter() && visibleTests.length === 0 && String(category.name || '').toLowerCase().indexOf(normalizedFilter()) === -1) {
        continue;
      }
      var expanded = isCategoryExpanded(category.name, visibleTests.length > 0);
      var wrapper = document.createElement('div');
      wrapper.className = 'test-category' + (expanded ? '' : ' collapsed');
      wrapper.setAttribute('data-category', category.name);

      var countState = buildCategoryCount(category.meta || {}, category.tests.length, visibleTests.length);
      var header = document.createElement('div');
      header.className = 'test-category-header';
      header.innerHTML =
        '<span class="test-category-caret">▾</span>' +
        '<span class="test-category-name">' + escapeHtml(category.name) + '</span>' +
        '<span class="' + countState.className + '">' + escapeHtml(countState.text) + '</span>' +
        '<button class="test-panel-btn test-category-run" data-category="' + escapeHtml(category.name) + '" type="button">Run</button>' +
        '<button class="test-panel-btn test-category-clear" data-category="' + escapeHtml(category.name) + '" type="button">Clear</button>';
      wrapper.appendChild(header);

      var body = document.createElement('div');
      body.className = 'test-category-body';
      if (!visibleTests.length) {
        body.innerHTML = '<div class="test-state-empty">No matching tests.</div>';
      } else {
        for (var k = 0; k < visibleTests.length; k++) {
          var testDef = visibleTests[k];
          var result = resultMap[testDef.name] || null;
          var row = document.createElement('div');
          var indicatorClass = 'test-indicator';
          var indicatorLabel = '';
          if (running && runState.currentTestName === testDef.name) {
            indicatorClass += ' running';
            indicatorLabel = '…';
          } else if (result && result.passed) {
            indicatorClass += ' pass';
            indicatorLabel = '✓';
          } else if (result && result.passed === false) {
            indicatorClass += ' fail';
            indicatorLabel = '✗';
          }
          row.className = 'test-row' + (running ? ' disabled' : '');
          row.setAttribute('data-test-name', testDef.name);
          row.innerHTML =
            '<span class="' + indicatorClass + '">' + indicatorLabel + '</span>' +
            '<div class="test-row-body">' +
              '<div class="test-row-label">' + escapeHtml(testDef.name) + '</div>' +
              '<div class="test-duration">' + escapeHtml(
                running && runState.currentTestName === testDef.name
                  ? '…'
                  : (result ? formatDuration(result.durationMs, result) : '')
              ) + '</div>' +
            '</div>';
          body.appendChild(row);

          var error = document.createElement('div');
          error.className = 'test-error';
          error.style.display = result && result.passed === false && result.error ? 'block' : 'none';
          error.textContent = result && result.passed === false ? (result.error || '') : '';
          body.appendChild(error);
        }
      }
      wrapper.appendChild(body);
      listEl.appendChild(wrapper);
    }
    if (!listEl.children.length) renderEmpty('No matching tests.');
  }

  function render(payload) {
    renderSummary(payload);
    renderBoardOptions(payload || {});
    if (filterEl && filterEl.value !== filterText) filterEl.value = filterText;
    updateControlState(payload || {});
    renderList(payload || {});
  }

  function applyState(payload) {
    latestState = payload || null;
    render(latestState);
  }

  if (listEl) {
    listEl.addEventListener('click', function (event) {
      var clearBtnTarget = event.target.closest('button.test-category-clear');
      if (clearBtnTarget) {
        event.stopPropagation();
        sendCommand('clear-category', {
          category: clearBtnTarget.getAttribute('data-category') || ''
        }).catch(function () {
          setFeedback('Runner unavailable', true);
        });
        return;
      }

      var runBtnTarget = event.target.closest('button.test-category-run');
      if (runBtnTarget) {
        event.stopPropagation();
        sendCommand('run-category', {
          category: runBtnTarget.getAttribute('data-category') || ''
        }).catch(function () {
          setFeedback('Runner unavailable', true);
        });
        return;
      }

      var headerTarget = event.target.closest('.test-category-header');
      if (headerTarget) {
        var categoryName = headerTarget.parentElement ? headerTarget.parentElement.getAttribute('data-category') : '';
        if (categoryName) expandedCategories[categoryName] = !isCategoryExpanded(categoryName, true);
        render(latestState);
        return;
      }

      var rowTarget = event.target.closest('.test-row');
      if (rowTarget) {
        sendCommand('run-test', {
          testName: rowTarget.getAttribute('data-test-name') || ''
        }).catch(function () {
          setFeedback('Runner unavailable', true);
        });
      }
    });
  }

  if (filterEl) {
    filterEl.addEventListener('input', function () {
      filterText = String(filterEl.value || '');
      render(latestState);
    });
  }

  if (boardSelectEl) {
    boardSelectEl.addEventListener('change', function () {
      sendCommand('set-board-selection', {
        boardId: boardSelectEl.value || ''
      }).catch(function () {
        setFeedback('Runner unavailable', true);
      });
    });
  }

  if (manualInspectEl) {
    manualInspectEl.addEventListener('change', function () {
      sendCommand('set-manual-inspect', {
        enabled: manualInspectEl.checked === true
      }).catch(function () {
        setFeedback('Runner unavailable', true);
      });
    });
  }

  if (runAllBtn) {
    runAllBtn.addEventListener('click', function () {
      var options = {};
      if (normalizedFilter()) options.filter = normalizedFilter();
      sendCommand('run-all', { options: options }).catch(function () {
        setFeedback('Runner unavailable', true);
      });
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', function () {
      sendCommand('stop').catch(function () {
        setFeedback('Runner unavailable', true);
      });
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      sendCommand('clear-results').catch(function () {
        setFeedback('Runner unavailable', true);
      });
    });
  }

  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', function () {
      var categories = buildCategoryState(latestState || {});
      for (var i = 0; i < categories.length; i++) expandedCategories[categories[i].name] = true;
      render(latestState);
    });
  }

  if (collapseAllBtn) {
    collapseAllBtn.addEventListener('click', function () {
      var categories = buildCategoryState(latestState || {});
      for (var i = 0; i < categories.length; i++) expandedCategories[categories[i].name] = false;
      render(latestState);
    });
  }

  if (continueUndoBtn) {
    continueUndoBtn.addEventListener('click', function () {
      sendCommand('continue-undo').catch(function () {
        setFeedback('Runner unavailable', true);
      });
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      setFeedback('Copying…', false);
      sendCommand('copy-results', {
        scope: copyScopeEl ? (copyScopeEl.value || 'all') : 'all'
      }).then(function () {
        setFeedback('Copied to clipboard', false);
        requestState();
      }).catch(function () {
        setFeedback('Clipboard copy failed', true);
      });
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', function () {
      requestState();
    });
  }

  if (window.LexeraSubApp && typeof window.LexeraSubApp.init === 'function') {
    window.LexeraSubApp.init({
      onReady: function () {
        requestState();
        if (!pollTimer) pollTimer = setInterval(requestState, 1000);
      },
      onError: function (err) {
        applyState({
          available: false,
          error: String(err)
        });
      },
      onCustom: {
        'frontend-tests-state': applyState
      }
    });
  } else {
    applyState({
      available: false,
      error: 'No Tauri context.'
    });
  }
})();
