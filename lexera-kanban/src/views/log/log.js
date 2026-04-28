// Log view sub-app — converged onto the shared LexeraSubApp runtime.
//
// The runtime owns theme inheritance, scoped event subscriptions,
// focus reporting, health, and panel lifecycle handshakes. This file
// owns the log-specific rendering/filtering behavior for the canonical
// markup (matches `sharedPanels.js#createLogsPanelElement`):
//   - source filter dropdown    (button + menu)
//   - level filter dropdown     (button + menu)
//   - text search input         (filter chips removed; use the search)
//   - reload / copy / clear actions
//   - connection status pill
//   - status row (visible / total counter)
//   - entries area + stats area

(function () {
  'use strict';

  var entriesEl = document.getElementById('log-entries');
  var statsEl = document.getElementById('log-entries-stats');
  var statusEl = document.getElementById('status-msg');
  var connectionBtn = document.getElementById('btn-connection-status');
  var connectionLabel = connectionBtn ? connectionBtn.querySelector('.connection-status-label') : null;
  var clearBtn = document.getElementById('log-clear-btn');
  var refreshBtn = document.getElementById('log-refresh-btn');
  var copyBtn = document.getElementById('log-copy-btn');
  var searchInput = document.getElementById('log-search-input');
  var searchClear = document.getElementById('log-search-clear');
  var sourceBtn = document.getElementById('log-source-btn');
  var sourceLabel = document.getElementById('log-source-label');
  var sourceMenu = document.getElementById('log-source-menu');
  var sourceClear = document.getElementById('log-source-clear');
  var levelBtn = document.getElementById('log-level-btn');
  var levelLabel = document.getElementById('log-level-label');
  var levelMenu = document.getElementById('log-level-menu');
  var levelClear = document.getElementById('log-level-clear');

  var MAX_ENTRIES = 1000;
  var entries = [];
  var LEVELS = ['error', 'warn', 'info', 'debug', 'trace'];
  var activeLevels = { error: true, warn: true, info: true, debug: true, trace: true };
  // Tracks every source seen so far so the dropdown reflects what is
  // actually available. `null` keys (no source) get the literal string
  // 'frontend' as a fallback identifier.
  var seenSources = Object.create(null);
  var activeSources = Object.create(null);
  var sourceFilterAll = true;
  var searchText = '';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatTimestamp(ms) {
    var d = new Date(ms);
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    var ss = String(d.getSeconds()).padStart(2, '0');
    var msStr = String(d.getMilliseconds()).padStart(3, '0');
    return hh + ':' + mm + ':' + ss + '.' + msStr;
  }

  function makeEntryEl(entry) {
    var el = document.createElement('div');
    var lvl = entry.level || 'info';
    el.className = 'entry level-' + lvl;
    el.dataset.level = lvl;
    el.dataset.source = entry.source || 'frontend';
    el.innerHTML =
      '<span class="timestamp">' + formatTimestamp(entry.timestamp_ms) + '</span>' +
      '<span class="source">' + escapeHtml(entry.source || 'frontend') + '</span>' +
      '<span class="message">' + escapeHtml(entry.message || '') + '</span>';
    return el;
  }

  function shouldShow(entry) {
    var lvl = entry.level || 'info';
    if (!activeLevels[lvl]) return false;
    var src = entry.source || 'frontend';
    if (!sourceFilterAll && !activeSources[src]) return false;
    if (searchText) {
      var hay = ((entry.message || '') + ' ' + (entry.source || '')).toLowerCase();
      if (hay.indexOf(searchText) === -1) return false;
    }
    return true;
  }

  function rerender() {
    if (!entriesEl) return;
    entriesEl.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < entries.length; i++) {
      if (shouldShow(entries[i])) frag.appendChild(makeEntryEl(entries[i]));
    }
    entriesEl.appendChild(frag);
    entriesEl.scrollTop = entriesEl.scrollHeight;
    updateStatus();
  }

  function appendOne(entry) {
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    var src = entry.source || 'frontend';
    if (!seenSources[src]) {
      seenSources[src] = true;
      activeSources[src] = true;
      buildSourceMenu();
    }
    if (!shouldShow(entry)) {
      updateStatus();
      return;
    }
    var nearBottom = (entriesEl.scrollHeight - entriesEl.scrollTop - entriesEl.clientHeight) < 60;
    entriesEl.appendChild(makeEntryEl(entry));
    while (entriesEl.children.length > MAX_ENTRIES) {
      entriesEl.removeChild(entriesEl.firstChild);
    }
    if (nearBottom) entriesEl.scrollTop = entriesEl.scrollHeight;
    updateStatus();
  }

  function updateStatus() {
    if (!statusEl) return;
    var visible = entries.filter(shouldShow).length;
    statusEl.textContent = visible + '/' + entries.length + ' entries';
  }

  function buildSourceMenu() {
    if (!sourceMenu) return;
    var keys = Object.keys(seenSources).sort();
    sourceMenu.innerHTML = '';
    if (!keys.length) return;
    keys.forEach(function (src) {
      var item = document.createElement('label');
      item.className = 'log-panel-source-menu-item';
      item.style.display = 'flex';
      item.style.gap = '6px';
      item.style.padding = '3px 8px';
      item.style.cursor = 'pointer';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!activeSources[src];
      cb.addEventListener('change', function () {
        activeSources[src] = cb.checked;
        sourceFilterAll = Object.keys(seenSources).every(function (k) { return activeSources[k]; });
        if (sourceLabel) {
          var n = Object.keys(activeSources).filter(function (k) { return activeSources[k]; }).length;
          sourceLabel.textContent = sourceFilterAll ? 'Sources' : (n + '/' + keys.length);
        }
        if (sourceClear) sourceClear.classList.toggle('hidden', sourceFilterAll);
        rerender();
      });
      item.appendChild(cb);
      var span = document.createElement('span');
      span.textContent = src;
      item.appendChild(span);
      sourceMenu.appendChild(item);
    });
  }

  function buildLevelMenu() {
    if (!levelMenu) return;
    levelMenu.innerHTML = '';
    LEVELS.forEach(function (lvl) {
      var item = document.createElement('label');
      item.className = 'log-panel-source-menu-item';
      item.style.display = 'flex';
      item.style.gap = '6px';
      item.style.padding = '3px 8px';
      item.style.cursor = 'pointer';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!activeLevels[lvl];
      cb.addEventListener('change', function () {
        activeLevels[lvl] = cb.checked;
        var n = LEVELS.filter(function (l) { return activeLevels[l]; }).length;
        var allOn = n === LEVELS.length;
        if (levelLabel) levelLabel.textContent = allOn ? 'Levels' : (n + '/' + LEVELS.length);
        if (levelClear) levelClear.classList.toggle('hidden', allOn);
        rerender();
      });
      item.appendChild(cb);
      var span = document.createElement('span');
      span.textContent = lvl;
      item.appendChild(span);
      levelMenu.appendChild(item);
    });
  }
  buildLevelMenu();

  function toggleMenu(menuEl, btnEl) {
    if (!menuEl || !btnEl) return;
    var isHidden = menuEl.classList.contains('hidden');
    if (sourceMenu) sourceMenu.classList.add('hidden');
    if (levelMenu) levelMenu.classList.add('hidden');
    if (isHidden) {
      menuEl.classList.remove('hidden');
      btnEl.setAttribute('aria-expanded', 'true');
    } else {
      btnEl.setAttribute('aria-expanded', 'false');
    }
  }

  if (sourceBtn) sourceBtn.addEventListener('click', function () { toggleMenu(sourceMenu, sourceBtn); });
  if (levelBtn) levelBtn.addEventListener('click', function () { toggleMenu(levelMenu, levelBtn); });

  if (sourceClear) sourceClear.addEventListener('click', function () {
    Object.keys(seenSources).forEach(function (s) { activeSources[s] = true; });
    sourceFilterAll = true;
    if (sourceLabel) sourceLabel.textContent = 'Sources';
    sourceClear.classList.add('hidden');
    buildSourceMenu();
    rerender();
  });
  if (levelClear) levelClear.addEventListener('click', function () {
    LEVELS.forEach(function (l) { activeLevels[l] = true; });
    if (levelLabel) levelLabel.textContent = 'Levels';
    levelClear.classList.add('hidden');
    buildLevelMenu();
    rerender();
  });

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      searchText = String(searchInput.value || '').toLowerCase();
      if (searchClear) searchClear.classList.toggle('hidden', !searchText);
      rerender();
    });
  }
  if (searchClear) searchClear.addEventListener('click', function () {
    if (searchInput) searchInput.value = '';
    searchText = '';
    searchClear.classList.add('hidden');
    rerender();
  });

  if (clearBtn) clearBtn.addEventListener('click', function () {
    entries.length = 0;
    rerender();
  });
  if (copyBtn) copyBtn.addEventListener('click', function () {
    var visible = entries.filter(shouldShow);
    var text = visible.map(function (e) {
      return formatTimestamp(e.timestamp_ms) + ' [' + (e.level || 'info') + '] ' +
             (e.source || 'frontend') + ': ' + (e.message || '');
    }).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (statusEl) statusEl.textContent = 'Copied ' + visible.length + ' entries';
      }).catch(function () { /* ignore */ });
    }
  });
  if (refreshBtn) refreshBtn.addEventListener('click', function () {
    if (window.LexeraSubApp && typeof window.LexeraSubApp.broadcast === 'function') {
      window.LexeraSubApp.broadcast('log-reload-request', {});
    }
  });

  function updateConnectionStatus(connected) {
    if (!connectionBtn) return;
    connectionBtn.classList.toggle('connected', !!connected);
    connectionBtn.classList.toggle('disconnected', !connected);
    connectionBtn.title = connected ? 'Backend connected' : 'Backend disconnected';
    connectionBtn.setAttribute('aria-label', connected ? 'Backend connected' : 'Backend disconnected');
    if (connectionLabel) connectionLabel.textContent = connected ? 'Connected' : 'Disconnected';
  }

  // Close menus on outside click
  document.addEventListener('click', function (ev) {
    if (sourceMenu && !sourceMenu.classList.contains('hidden')) {
      if (!sourceMenu.contains(ev.target) && ev.target !== sourceBtn && !sourceBtn.contains(ev.target)) {
        sourceMenu.classList.add('hidden');
        if (sourceBtn) sourceBtn.setAttribute('aria-expanded', 'false');
      }
    }
    if (levelMenu && !levelMenu.classList.contains('hidden')) {
      if (!levelMenu.contains(ev.target) && ev.target !== levelBtn && !levelBtn.contains(ev.target)) {
        levelMenu.classList.add('hidden');
        if (levelBtn) levelBtn.setAttribute('aria-expanded', 'false');
      }
    }
  });

  if (window.LexeraSubApp && typeof window.LexeraSubApp.init === 'function') {
    window.LexeraSubApp.init({
      onLog: appendOne,
      onReady: function () {
        if (statusEl) statusEl.textContent = '0/0 entries';
        var main = document.querySelector('.log-panel-main');
        if (main) main.classList.remove('view-loading');
        if (typeof window.LexeraSubApp.broadcast === 'function') {
          window.LexeraSubApp.broadcast('backend-connection-state-request', {});
        }
      },
      onError: function (err) {
        if (statusEl) statusEl.textContent = String(err);
        var dot = document.querySelector('.lexera-mv-status-dot');
        if (dot) dot.setAttribute('data-health', 'red');
      },
      onCustom: {
        // SHELL broadcasts connection state on this event so the
        // connection pill in the log header reflects the live status.
        'backend-connection-state': function (payload) {
          updateConnectionStatus(payload && payload.connected);
        }
      }
    });
  } else if (statusEl) {
    statusEl.textContent = 'no Tauri context';
  }
})();
