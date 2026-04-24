// Log view sub-app — runs in its own Tauri child webview.
//
// Subscribes to the global 'log-message' event broadcast by the
// main kanban via the Rust `log_broadcast` command. Each lexeraLog
// call in the main webview reaches here as an event delivery.
//
// CRITICAL: scoped to this webview via getCurrentWebview().listen().
// The global @tauri-apps/api/event listen() defaults to Any target
// and would receive events emitted_to other webviews — NOT what we
// want. Global broadcasts (app.emit) DO reach scoped listeners
// because their target is "all".

(function () {
  'use strict';

  var entriesEl = document.getElementById('entries');
  var statusEl = document.getElementById('status');
  var clearBtn = document.getElementById('clear-btn');
  var filtersEl = document.getElementById('filters');

  var MAX_ENTRIES = 1000;
  var entries = [];
  var activeLevels = { error: true, warn: true, info: true, debug: true, trace: true };
  var levels = ['error', 'warn', 'info', 'debug', 'trace'];

  // Render filter chips
  levels.forEach(function (lvl) {
    var chip = document.createElement('span');
    chip.className = 'filter-chip active';
    chip.textContent = lvl;
    chip.dataset.level = lvl;
    chip.addEventListener('click', function () {
      activeLevels[lvl] = !activeLevels[lvl];
      chip.classList.toggle('active', activeLevels[lvl]);
      rerender();
    });
    filtersEl.appendChild(chip);
  });

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
    el.className = 'entry level-' + (entry.level || 'info');
    el.dataset.level = entry.level || 'info';
    el.innerHTML =
      '<span class="timestamp">' + formatTimestamp(entry.timestamp_ms) + '</span>' +
      '<span class="source">' + escapeHtml(entry.source || 'frontend') + '</span>' +
      '<span class="message">' + escapeHtml(entry.message || '') + '</span>';
    return el;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function shouldShow(entry) {
    return !!activeLevels[entry.level || 'info'];
  }

  function rerender() {
    entriesEl.innerHTML = '';
    var visible = entries.filter(shouldShow);
    var frag = document.createDocumentFragment();
    visible.forEach(function (e) { frag.appendChild(makeEntryEl(e)); });
    entriesEl.appendChild(frag);
    entriesEl.scrollTop = entriesEl.scrollHeight;
    updateStatus();
  }

  function appendOne(entry) {
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    if (!shouldShow(entry)) {
      updateStatus();
      return;
    }
    var nearBottom = (entriesEl.scrollHeight - entriesEl.scrollTop - entriesEl.clientHeight) < 60;
    entriesEl.appendChild(makeEntryEl(entry));
    // Trim DOM if it exceeds visible cap
    while (entriesEl.children.length > MAX_ENTRIES) {
      entriesEl.removeChild(entriesEl.firstChild);
    }
    if (nearBottom) entriesEl.scrollTop = entriesEl.scrollHeight;
    updateStatus();
  }

  function updateStatus() {
    var visible = entries.filter(shouldShow).length;
    statusEl.textContent = visible + '/' + entries.length + ' entries';
  }

  clearBtn.addEventListener('click', function () {
    entries.length = 0;
    rerender();
  });

  // Subscribe to log-message events from the Rust broadcaster.
  function getCurrentWebview() {
    try { return window.__TAURI__.webview.getCurrentWebview(); }
    catch (_) { return null; }
  }
  var wv = getCurrentWebview();
  if (wv && typeof wv.listen === 'function') {
    wv.listen('log-message', function (event) {
      if (event && event.payload) appendOne(event.payload);
    });
    // Theme bridge — apply received palette + request initial snapshot
    wv.listen('theme-snapshot', function (event) {
      if (!event || !event.payload || !event.payload.palette) return;
      var root = document.documentElement;
      var p = event.payload.palette;
      Object.keys(p).forEach(function (k) { root.style.setProperty(k, p[k]); });
      if (event.payload.color_scheme) root.style.colorScheme = event.payload.color_scheme;
    });
    // Ask the main webview to broadcast its theme now that we're listening
    try {
      window.__TAURI__.core.invoke('multiview_broadcast', {
        event: 'theme-request',
        payload: {}
      }).catch(function () {});
    } catch (_) {}
    statusEl.textContent = 'connected';
    // Report health 'green' (we're connected) and update local dot
    try {
      window.__TAURI__.core.invoke('multiview_set_health', {
        label: wv.label, state: 'green'
      }).catch(function () {});
      var dot = document.querySelector('.lexera-mv-status-dot');
      if (dot) dot.setAttribute('data-health', 'green');
    } catch (_) {}
  } else {
    statusEl.textContent = 'no Tauri context';
    var dot2 = document.querySelector('.lexera-mv-status-dot');
    if (dot2) dot2.setAttribute('data-health', 'red');
  }
})();
