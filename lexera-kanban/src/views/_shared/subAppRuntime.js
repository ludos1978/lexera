// Shared sub-app runtime — common boilerplate every view needs.
//
// Usage from a sub-app:
//   <script src="../_shared/subAppRuntime.js"></script>
//   <script>
//     LexeraSubApp.init({
//       onCatalog: function (snap) { /* render board lists */ },
//       onActiveBoard: function (boardId) { /* highlight board */ },
//       onLog: function (entry) { /* append to log tail */ },
//       requestCatalog: true,    // if you need catalog snapshot
//       requestTheme: true,      // theme snapshot (default true)
//     });
//   </script>
//
// Provides:
//  - automatic theme inheritance (subscribes to 'theme-snapshot',
//    requests an initial snapshot, applies CSS vars)
//  - scoped event listening via the current webview (NOT global
//    listen — see TODOs-lexera-multiview.md "Architectural rules")
//  - typed callbacks for the most common bridges
//  - LexeraSubApp.navigate(payload) helper to send navigation requests
//  - LexeraSubApp.broadcast(event, payload) for ad-hoc broadcasts
//  - LexeraSubApp.invoke(cmd, args) for direct IPC

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

  function applyThemeSnapshot(snap) {
    if (!snap || !snap.palette) return;
    var root = document.documentElement;
    Object.keys(snap.palette).forEach(function (k) { root.style.setProperty(k, snap.palette[k]); });
    if (snap.color_scheme) root.style.colorScheme = snap.color_scheme;
  }

  function init(opts) {
    opts = opts || {};
    var wv = getCurrentWebview();
    if (!wv || typeof wv.listen !== 'function') {
      if (typeof opts.onError === 'function') opts.onError(new Error('no Tauri context'));
      return;
    }

    // Build the list of events this view will subscribe to so we can
    // register interest with Rust's SubscriptionRegistry. Filtering
    // happens server-side, so views receive only what they need.
    var declaredEvents = [];
    if (opts.requestTheme !== false) declaredEvents.push('theme-snapshot');
    if (typeof opts.onCatalog === 'function') declaredEvents.push('catalog-snapshot');
    if (typeof opts.onActiveBoard === 'function') declaredEvents.push('active-board-changed');
    if (typeof opts.onLog === 'function') declaredEvents.push('log-message');
    if (typeof opts.onDragBegan === 'function') declaredEvents.push('drag-began');
    if (typeof opts.onDragEnter === 'function') declaredEvents.push('drag-enter');
    if (typeof opts.onDragOver === 'function') declaredEvents.push('drag-over');
    if (typeof opts.onDragLeave === 'function') declaredEvents.push('drag-leave');
    if (typeof opts.onDrop === 'function') declaredEvents.push('drop');
    if (typeof opts.onDragEnded === 'function') declaredEvents.push('drag-ended');
    if (opts.onCustom && typeof opts.onCustom === 'object') {
      Object.keys(opts.onCustom).forEach(function (e) { declaredEvents.push(e); });
    }
    if (declaredEvents.length > 0) {
      invoke('multiview_subscribe', {
        label: wv.label, events: declaredEvents
      }).catch(function () {});
    }

    // Theme: always subscribe (cheap), default true
    if (opts.requestTheme !== false) {
      wv.listen('theme-snapshot', function (event) {
        if (event && event.payload) applyThemeSnapshot(event.payload);
        if (typeof opts.onTheme === 'function') opts.onTheme(event.payload);
      });
      invoke('multiview_broadcast', { event: 'theme-request', payload: {} }).catch(function () {});
    }

    if (typeof opts.onCatalog === 'function') {
      wv.listen('catalog-snapshot', function (event) {
        if (event && event.payload) opts.onCatalog(event.payload);
      });
      if (opts.requestCatalog !== false) {
        invoke('multiview_broadcast', { event: 'catalog-request', payload: {} }).catch(function () {});
      }
    }

    if (typeof opts.onActiveBoard === 'function') {
      wv.listen('active-board-changed', function (event) {
        if (event && event.payload) opts.onActiveBoard(event.payload.boardId);
      });
    }

    if (typeof opts.onLog === 'function') {
      wv.listen('log-message', function (event) {
        if (event && event.payload) opts.onLog(event.payload);
      });
    }

    if (typeof opts.onDragBegan === 'function') {
      wv.listen('drag-began', function (event) { opts.onDragBegan(event && event.payload); });
    }
    if (typeof opts.onDragEnter === 'function') {
      wv.listen('drag-enter', function (event) { opts.onDragEnter(event && event.payload); });
    }
    if (typeof opts.onDragOver === 'function') {
      wv.listen('drag-over', function (event) { opts.onDragOver(event && event.payload); });
    }
    if (typeof opts.onDragLeave === 'function') {
      wv.listen('drag-leave', function (event) { opts.onDragLeave(event && event.payload); });
    }
    if (typeof opts.onDrop === 'function') {
      wv.listen('drop', function (event) { opts.onDrop(event && event.payload); });
    }
    if (typeof opts.onDragEnded === 'function') {
      wv.listen('drag-ended', function () { opts.onDragEnded(); });
    }

    if (typeof opts.onCustom === 'object' && opts.onCustom) {
      Object.keys(opts.onCustom).forEach(function (eventName) {
        wv.listen(eventName, function (event) { opts.onCustom[eventName](event && event.payload); });
      });
    }

    // Auto-report focus state if requested (default: true)
    if (opts.reportFocus !== false) {
      function reportFocus(focused) {
        invoke('multiview_set_focused', { label: wv.label, focused: focused })
          .catch(function () {});
      }
      window.addEventListener('focus', function () { reportFocus(true); });
      window.addEventListener('blur', function () { reportFocus(false); });
      // Set initial state
      reportFocus(document.hasFocus());
    }

    // Global keyboard shortcuts — the same keybindings work in every
    // sub-app so users don't have to refocus the main shell to toggle
    // multiview panels. Shortcut → action map is configurable via
    // opts.shortcuts = { 'Ctrl+Shift+L': 'open-log-view', ... }.
    // Actions are broadcast as 'multiview-shortcut' events so the
    // main shell (or whoever subscribes) can handle them.
    if (opts.shortcuts !== false) {
      // Defaults use Alt (not Shift) to avoid conflicting with the
      // existing kanban shortcuts (e.g., Cmd+Shift+L toggles the
      // legacy log panel inside loggingSystem.js).
      var shortcuts = (opts.shortcuts && typeof opts.shortcuts === 'object')
        ? opts.shortcuts
        : {
            'Ctrl+Alt+L': 'open-log-view',
            'Meta+Alt+L': 'open-log-view',
            'Ctrl+Alt+I': 'open-inspector',
            'Meta+Alt+I': 'open-inspector',
            'Ctrl+Alt+W': 'open-workspaces',
            'Meta+Alt+W': 'open-workspaces',
            'Ctrl+Alt+D': 'open-dashboard',
            'Meta+Alt+D': 'open-dashboard'
          };
      document.addEventListener('keydown', function (event) {
        var parts = [];
        if (event.ctrlKey) parts.push('Ctrl');
        if (event.metaKey) parts.push('Meta');
        if (event.shiftKey) parts.push('Shift');
        if (event.altKey) parts.push('Alt');
        if (event.key && event.key.length === 1) parts.push(event.key.toUpperCase());
        else if (event.key) parts.push(event.key);
        var combo = parts.join('+');
        var action = shortcuts[combo];
        if (action) {
          event.preventDefault();
          invoke('multiview_broadcast', {
            event: 'multiview-shortcut',
            payload: { action: action, from: wv.label }
          }).catch(function () {});
        }
      });
    }

    // Emit a 'sub-app-mounted' broadcast so the shell + other views
    // can react (e.g., log panel shows when a sub-app connects).
    invoke('multiview_broadcast', {
      event: 'sub-app-mounted',
      payload: { label: wv.label, at: Date.now() }
    }).catch(function () {});

    // Report health: sub-apps mark themselves healthy once init
    // completes (they're thin viewers — no backend-sync state to
    // track). If a sub-app has complex state, it can override
    // via opts.getHealth() returning 'green'/'yellow'/'red'.
    function reportSubAppHealth(state) {
      invoke('multiview_set_health', { label: wv.label, state: state })
        .catch(function () {});
    }
    if (typeof opts.getHealth === 'function') {
      setInterval(function () {
        try { reportSubAppHealth(String(opts.getHealth() || 'green')); }
        catch (_) {}
      }, 2000);
      reportSubAppHealth(String(opts.getHealth() || 'green'));
    } else {
      reportSubAppHealth('green');
    }

    if (typeof opts.onReady === 'function') opts.onReady(wv);
  }

  function navigate(payload) {
    return invoke('multiview_broadcast', {
      event: 'multiview-navigate',
      payload: payload || {}
    });
  }

  function broadcast(event, payload) {
    return invoke('multiview_broadcast', { event: event, payload: payload || {} });
  }

  window.LexeraSubApp = {
    init: init,
    navigate: navigate,
    broadcast: broadcast,
    invoke: invoke,
    getCurrentWebview: getCurrentWebview,
    applyThemeSnapshot: applyThemeSnapshot
  };
})();
