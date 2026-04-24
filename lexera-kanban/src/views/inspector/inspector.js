// Multiview Inspector — diagnostic sub-app for the multiview migration.
//
// Useful during development to:
//  - confirm process isolation (each row in webview-table = own process)
//  - see real-time geometry as the shell drives child webview placement
//  - tail recent log events to verify the broadcaster pipe works
//  - destroy individual webviews (cleanup after testing)
//
// Subscribes to:
//  - 'log-message' (global broadcast from log_broadcast Rust command)
//
// Calls:
//  - multiview_list  (poll for current child webview registry state)
//  - multiview_destroy (per-row cleanup button)

(function () {
  'use strict';

  function tauri() {
    if (typeof window === 'undefined' || !window.__TAURI__) return null;
    return window.__TAURI__;
  }
  function invoke(cmd, args) {
    var t = tauri();
    if (!t || !t.core) return Promise.reject(new Error('no Tauri'));
    return t.core.invoke(cmd, args || {});
  }
  function getCurrentWebview() {
    try { return tauri().webview.getCurrentWebview(); }
    catch (_) { return null; }
  }

  var procInfoEl = document.getElementById('proc-info');
  var webviewTbody = document.getElementById('webview-tbody');
  var webviewCountEl = document.getElementById('webview-count');
  var logTailEl = document.getElementById('log-tail');
  var fpsEl = document.getElementById('fps');

  function renderRow(label, value) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><b>' + escapeHtml(label) + '</b></td><td>' + escapeHtml(value) + '</td>';
    return tr;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Process info
  var wv = getCurrentWebview();
  procInfoEl.appendChild(renderRow('Webview label', wv ? wv.label : '(no Tauri)'));
  procInfoEl.appendChild(renderRow('User agent', navigator.userAgent.substring(0, 100)));
  procInfoEl.appendChild(renderRow('Platform', navigator.platform));
  procInfoEl.appendChild(renderRow('CPU cores', String(navigator.hardwareConcurrency || '?')));
  procInfoEl.appendChild(renderRow('Memory (heap)', performance.memory
    ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) + ' MB'
    : 'unavailable'));
  procInfoEl.appendChild(renderRow('Timestamp', new Date().toISOString()));

  // Webview list — polling at 1Hz
  var lastList = [];
  var lastHealth = {};
  function refreshWebviewList() {
    Promise.all([
      invoke('multiview_list'),
      invoke('multiview_list_health').catch(function () { return {}; })
    ]).then(function (results) {
      var list = results[0];
      lastHealth = results[1] || {};
      lastList = list;
      webviewCountEl.textContent = '(' + list.length + ')';
      webviewTbody.innerHTML = '';
      list.forEach(function (mv) {
        var health = lastHealth[mv.label] || 'unknown';
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td><span class="inspector-health-dot" data-health="' + escapeHtml(health) + '" title="' + escapeHtml(health) + '"></span></td>' +
          '<td>' + escapeHtml(mv.label) + '</td>' +
          '<td>' + Math.round(mv.x) + '</td>' +
          '<td>' + Math.round(mv.y) + '</td>' +
          '<td>' + Math.round(mv.width) + '</td>' +
          '<td>' + Math.round(mv.height) + '</td>' +
          '<td>' +
            '<button class="destroy-btn" data-label="' + escapeHtml(mv.label) + '" title="Destroy">×</button> ' +
            '<button class="destroy-btn" data-reload="1" data-label="' + escapeHtml(mv.label) + '" title="Reload (destroy + respawn)">↻</button>' +
          '</td>';
        webviewTbody.appendChild(tr);
      });
    }).catch(function (err) {
      webviewTbody.innerHTML = '<tr><td colspan="7">' + escapeHtml(String(err)) + '</td></tr>';
    });
  }
  webviewTbody.addEventListener('click', function (e) {
    var btn = e.target.closest('button.destroy-btn');
    if (!btn) return;
    var label = btn.dataset.label;
    var isReload = btn.dataset.reload === '1';
    if (isReload) {
      // Remember url/geom for respawn
      var prior = lastList.filter(function (w) { return w.label === label; })[0];
      invoke('multiview_destroy', { label: label }).then(function () {
        if (prior && prior.url) {
          return invoke('multiview_spawn', {
            req: {
              label: prior.label, url: prior.url,
              x: prior.x, y: prior.y,
              width: prior.width, height: prior.height
            }
          });
        }
      }).then(refreshWebviewList);
    } else {
      invoke('multiview_destroy', { label: label }).then(refreshWebviewList);
    }
  });
  refreshWebviewList();
  setInterval(refreshWebviewList, 1000);

  // Log tail — subscribe to global 'log-message' broadcasts
  var logEntries = [];
  var LOG_TAIL = 50;
  function appendLog(entry) {
    logEntries.push(entry);
    while (logEntries.length > LOG_TAIL) logEntries.shift();
    rerenderLogTail();
  }
  function rerenderLogTail() {
    logTailEl.innerHTML = '';
    var nearBottom = (logTailEl.scrollHeight - logTailEl.scrollTop - logTailEl.clientHeight) < 30;
    logEntries.forEach(function (e) {
      var line = document.createElement('div');
      line.className = 'log-line ' + (e.level || 'info');
      var t = new Date(e.timestamp_ms);
      var hh = String(t.getHours()).padStart(2, '0');
      var mm = String(t.getMinutes()).padStart(2, '0');
      var ss = String(t.getSeconds()).padStart(2, '0');
      line.textContent = hh + ':' + mm + ':' + ss + ' [' + (e.level || 'info') + '] ' +
        '[' + (e.source || 'frontend') + '] ' + (e.message || '');
      logTailEl.appendChild(line);
    });
    if (nearBottom) logTailEl.scrollTop = logTailEl.scrollHeight;
  }
  if (wv && typeof wv.listen === 'function') {
    wv.listen('log-message', function (event) {
      if (event && event.payload) appendLog(event.payload);
    });
    // Theme bridge
    wv.listen('theme-snapshot', function (event) {
      if (!event || !event.payload || !event.payload.palette) return;
      var root = document.documentElement;
      var p = event.payload.palette;
      Object.keys(p).forEach(function (k) { root.style.setProperty(k, p[k]); });
      if (event.payload.color_scheme) root.style.colorScheme = event.payload.color_scheme;
    });
    try {
      invoke('multiview_broadcast', { event: 'theme-request', payload: {} }).catch(function () {});
    } catch (_) {}
  }

  // FPS
  var frames = 0; var last = performance.now();
  function tick() {
    frames++;
    var now = performance.now();
    if (now - last >= 500) {
      var fps = Math.round((frames * 1000) / (now - last));
      fpsEl.textContent = fps + ' fps';
      frames = 0; last = now;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
