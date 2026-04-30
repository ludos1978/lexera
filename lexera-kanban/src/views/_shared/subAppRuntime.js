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
//  - LexeraSubApp.getPanelInstanceId() / getPanelKind() / getPaneId()
//    for panel-webview identity without shell DOM lookups

(function () {
  'use strict';

  var panelTeardownInstalled = false;
  var panelTeardownRan = false;
  var currentPanelLifecycle = null;
  var teardownCallbacks = [];
  var subAppLoggerInstalled = false;
  var subAppNotificationInstalled = false;
  var subAppNotificationQueue = [];
  var subAppNotificationActive = null;
  var subAppNotificationActiveMessage = null;
  var subAppModalCounter = 0;

  function tauri() {
    if (typeof window === 'undefined' || !window.__TAURI__) return null;
    return window.__TAURI__;
  }
  function invoke(cmd, args) {
    var t = tauri();
    if (!t || !t.core) return Promise.reject(new Error('no Tauri'));
    return t.core.invoke(cmd, args || {});
  }
  function listen(eventName, handler) {
    var t = tauri();
    if (!t || !t.event || typeof t.event.listen !== 'function') {
      return Promise.reject(new Error('no Tauri event runtime'));
    }
    return t.event.listen(String(eventName || ''), handler);
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

  function getUrlParams() {
    try {
      return new URLSearchParams((window.location && window.location.search) || '');
    } catch (_) {
      return new URLSearchParams('');
    }
  }

  function getQueryParam(name) {
    if (!name) return '';
    return String(getUrlParams().get(String(name)) || '');
  }

  function getWindowLabel() {
    return getQueryParam('windowLabel') || 'main';
  }

  function getHostWindowLabel() {
    return getQueryParam('workspaceShellHostLabel') || getWindowLabel();
  }

  var VIEW_DIR_PANEL_KIND_OVERRIDES = {
    log: 'logs'
  };

  function inferPanelKindFromPath() {
    try {
      var path = (window.location && window.location.pathname) || '';
      var match = path.match(/\/views\/([^/]+)\/index\.html$/);
      if (!match) return '';
      var dir = decodeURIComponent(match[1] || '');
      return VIEW_DIR_PANEL_KIND_OVERRIDES[dir] || dir;
    } catch (_) {
      return '';
    }
  }

  function getPanelKind() {
    return getQueryParam('panelKind') || inferPanelKindFromPath();
  }

  function getPanelInstanceId() {
    return getQueryParam('panel');
  }

  function getPaneId() {
    return getQueryParam('pane');
  }

  function getContext() {
    return {
      panelKind: getPanelKind(),
      panelInstanceId: getPanelInstanceId(),
      paneId: getPaneId(),
      windowLabel: getWindowLabel(),
      hostWindowLabel: getHostWindowLabel()
    };
  }

  function normalizeLogMessage(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (value instanceof Error) {
      return value.stack || value.message || String(value);
    }
    try { return JSON.stringify(value); }
    catch (_) { return String(value); }
  }

  function formatLogIssueDetails(error) {
    if (error == null) return '';
    if (error instanceof Error) return error.stack || error.message || String(error);
    return normalizeLogMessage(error);
  }

  function installSubAppNotifications() {
    if (subAppNotificationInstalled || typeof window === 'undefined' || typeof document === 'undefined') return;
    subAppNotificationInstalled = true;

    function drainNotificationQueue() {
      if (subAppNotificationQueue.length === 0) {
        subAppNotificationActive = null;
        subAppNotificationActiveMessage = null;
        return;
      }
      if (!document.body) {
        setTimeout(drainNotificationQueue, 30);
        return;
      }
      var item = subAppNotificationQueue.shift();
      var el = document.createElement('div');
      var variant = item.opts.variant || 'info';
      el.className = 'notification notification-' + variant;
      el.setAttribute('role', 'alert');
      el.setAttribute('aria-live', 'polite');
      var msgSpan = document.createElement('span');
      msgSpan.className = 'notification-msg';
      msgSpan.textContent = item.message;
      el.appendChild(msgSpan);
      var actionList = Array.isArray(item.opts.actions)
        ? item.opts.actions
        : (item.opts.action ? [item.opts.action] : []);
      for (var ai = 0; ai < actionList.length; ai++) {
        (function (action) {
          if (!action || !action.label) return;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'notification-action';
          btn.textContent = action.label;
          btn.addEventListener('click', function () {
            if (typeof action.callback === 'function') {
              try { action.callback(); } catch (_) { /* ignore notification action errors */ }
            }
            if (action.dismissOnClick === false) return;
            el.classList.remove('visible');
            setTimeout(function () {
              if (el.parentNode) el.parentNode.removeChild(el);
              drainNotificationQueue();
            }, 200);
          });
          el.appendChild(btn);
        })(actionList[ai]);
      }
      document.body.appendChild(el);
      el.offsetHeight;
      el.classList.add('visible');
      subAppNotificationActive = el;
      subAppNotificationActiveMessage = item.message;
      setTimeout(function () {
        if (!el.isConnected) return;
        el.classList.remove('visible');
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
          drainNotificationQueue();
        }, 300);
      }, item.opts.duration || 3000);
    }

    if (typeof window.showNotification !== 'function') {
      window.showNotification = function (message, opts) {
        opts = opts || {};
        var text = String(message == null ? '' : message);
        var variant = opts.variant || 'info';
        try {
          if (typeof window.lexeraLogWithTarget === 'function') {
            window.lexeraLogWithTarget(
              variant === 'error' ? 'error' : (variant === 'warn' ? 'warn' : 'info'),
              'notification.' + variant,
              text
            );
          }
        } catch (_) { /* ignore logging failures */ }
        if (opts.dedupe !== false) {
          if (subAppNotificationActiveMessage === text) return;
          for (var qi = 0; qi < subAppNotificationQueue.length; qi++) {
            if (subAppNotificationQueue[qi].message === text) return;
          }
        }
        subAppNotificationQueue.push({ message: text, opts: opts });
        if (!subAppNotificationActive) drainNotificationQueue();
      };
    }
  }

  function installSubAppLogger() {
    if (subAppLoggerInstalled || typeof window === 'undefined') return;
    subAppLoggerInstalled = true;

    function emitLog(level, source, message) {
      invoke('log_broadcast', {
        entry: {
          level: String(level || 'info'),
          source: String(source || 'frontend'),
          message: String(message == null ? '' : message),
          timestamp_ms: Date.now()
        }
      }).catch(function () {});
    }

    if (typeof window.lexeraLog !== 'function') {
      window.lexeraLog = function (level, message) {
        emitLog(level, 'frontend', normalizeLogMessage(message));
      };
    }

    if (typeof window.lexeraLogWithTarget !== 'function') {
      window.lexeraLogWithTarget = function (level, target, message) {
        emitLog(level, target || 'frontend', normalizeLogMessage(message));
      };
    }

    if (typeof window.logFrontendIssue !== 'function') {
      window.logFrontendIssue = function (level, target, context, error) {
        var detail = formatLogIssueDetails(error);
        var message = detail ? (String(context || '') + ': ' + detail) : String(context || '');
        emitLog(level, target || 'frontend', message);
      };
    }

    if (typeof window.traceFrontendAction !== 'function') {
      window.traceFrontendAction = function (level, target, message, details) {
        var detail = normalizeLogMessage(details);
        emitLog(level, target || 'frontend', String(message || '') + (detail ? (' ' + detail) : ''));
      };
    }
  }

  function waitForSingleEvent(eventName, onEvent, onMissingRuntime) {
    var finished = false;
    var unsubscribe = null;

    function finish(callback, event) {
      if (finished) return;
      finished = true;
      if (typeof unsubscribe === 'function') {
        try { unsubscribe(); } catch (_) { /* ignore unsubscribe failures */ }
      }
      unsubscribe = null;
      if (typeof callback === 'function') callback(event);
    }

    listen(String(eventName || ''), function (event) {
      finish(onEvent, event);
    }).then(function (unsub) {
      unsubscribe = typeof unsub === 'function' ? unsub : null;
      if (finished && typeof unsubscribe === 'function') {
        try { unsubscribe(); } catch (_) { /* ignore unsubscribe failures */ }
        unsubscribe = null;
      }
    }).catch(function () {
      finish(onMissingRuntime);
    });

    return {
      cancel: function () {
        finish(null);
      }
    };
  }

  function confirmModal(opts) {
    opts = opts || {};
    var label = 'confirm-modal-' + (++subAppModalCounter);
    var params = new URLSearchParams();
    params.set('label', label);
    if (opts.title) params.set('title', opts.title);
    if (opts.message) params.set('message', opts.message);
    if (opts.okText) params.set('ok', opts.okText);
    if (opts.cancelText) params.set('cancel', opts.cancelText);
    var url = 'views/modals/confirm.html?' + params.toString();
    return new Promise(function (resolve) {
      var waiter = waitForSingleEvent('modal-result-' + label, function (event) {
        resolve(!!(event && event.payload && event.payload.accepted));
      }, function () {
        resolve(false);
      });
      invoke('multiview_open_modal_window', {
        spec: {
          label: label,
          url: url,
          title: opts.title || 'Confirm',
          width: opts.width || 380,
          height: opts.height || 180,
          center: true
        }
      }).catch(function () {
        waiter.cancel();
        resolve(false);
      });
    });
  }

  function promptModal(opts) {
    opts = opts || {};
    var label = 'prompt-modal-' + (++subAppModalCounter);
    var params = new URLSearchParams();
    params.set('label', label);
    if (opts.title) params.set('title', opts.title);
    if (opts.message) params.set('message', opts.message);
    if (opts.initial != null) params.set('initial', String(opts.initial));
    if (opts.okText) params.set('ok', opts.okText);
    if (opts.cancelText) params.set('cancel', opts.cancelText);
    var url = 'views/modals/prompt.html?' + params.toString();
    return new Promise(function (resolve) {
      var waiter = waitForSingleEvent('modal-result-' + label, function (event) {
        var payload = event && event.payload ? event.payload : {};
        resolve(payload.value == null ? null : String(payload.value));
      }, function () {
        resolve(null);
      });
      invoke('multiview_open_modal_window', {
        spec: {
          label: label,
          url: url,
          title: opts.title || 'Input',
          width: opts.width || 420,
          height: opts.height || 200,
          center: true
        }
      }).catch(function () {
        waiter.cancel();
        resolve(null);
      });
    });
  }

  function runTeardownCallbacks() {
    if (panelTeardownRan) return;
    panelTeardownRan = true;
    var callbacks = teardownCallbacks.slice();
    teardownCallbacks.length = 0;
    for (var i = 0; i < callbacks.length; i++) {
      try { callbacks[i](); } catch (_) { /* ignore teardown callback errors */ }
    }
  }

  function installPanelTeardownListener() {
    if (panelTeardownInstalled) return;
    panelTeardownInstalled = true;
    window.addEventListener('beforeunload', function () {
      runTeardownCallbacks();
      if (!currentPanelLifecycle) return;
      invoke('multiview_broadcast', {
        event: 'panel-teardown',
        payload: {
          label: currentPanelLifecycle.label,
          at: Date.now(),
          paneId: currentPanelLifecycle.paneId,
          panelKind: currentPanelLifecycle.panelKind,
          panelInstanceId: currentPanelLifecycle.panelInstanceId,
          windowLabel: currentPanelLifecycle.windowLabel,
          hostWindowLabel: currentPanelLifecycle.hostWindowLabel
        }
      }).catch(function () {});
    });
  }

  function init(opts) {
    opts = opts || {};
    installSubAppLogger();
    installSubAppNotifications();
    if (typeof opts.onTeardown === 'function') {
      teardownCallbacks.push(opts.onTeardown);
      installPanelTeardownListener();
    }
    // Apply the same root/body classes the legacy SHELL set so that all the
    // `body.workspace-shell-mode .board-list { ... }` rules in app.css
    // (and friends) take effect inside this child webview. Without
    // this, panels render with browser defaults instead of the legacy
    // shell look. Adding `data-shell-panel` on both html/body lets the
    // shared CSS stretch the full document root as well, which is required
    // for nested `height: 100%` layouts to fill the webview reliably.
    try {
      var docEl = document.documentElement;
      var bodyEl = document.body;
      var kind = getPanelKind();
      var pane = getPaneId();
      if (docEl) {
        docEl.classList.add('workspace-shell-mode');
        if (kind) docEl.setAttribute('data-shell-panel', kind);
        if (pane) docEl.setAttribute('data-shell-pane', pane);
      }
      if (bodyEl) {
        bodyEl.classList.add('workspace-shell-mode');
        if (kind) bodyEl.setAttribute('data-shell-panel', kind);
        if (pane) bodyEl.setAttribute('data-shell-pane', pane);
      }
    } catch (_) {}
    var wv = getCurrentWebview();
    var ctx = getContext();
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
      payload: {
        label: wv.label,
        at: Date.now(),
        paneId: ctx.paneId,
        panelKind: ctx.panelKind,
        panelInstanceId: ctx.panelInstanceId,
        windowLabel: ctx.windowLabel,
        hostWindowLabel: ctx.hostWindowLabel
      }
    }).catch(function () {});
    if (ctx.panelKind) {
      currentPanelLifecycle = {
        label: wv.label,
        paneId: ctx.paneId,
        panelKind: ctx.panelKind,
        panelInstanceId: ctx.panelInstanceId,
        windowLabel: ctx.windowLabel,
        hostWindowLabel: ctx.hostWindowLabel
      };
      invoke('multiview_broadcast', {
        event: 'panel-ready',
        payload: {
          label: wv.label,
          at: Date.now(),
          paneId: ctx.paneId,
          panelKind: ctx.panelKind,
          panelInstanceId: ctx.panelInstanceId,
          windowLabel: ctx.windowLabel,
          hostWindowLabel: ctx.hostWindowLabel
        }
      }).catch(function () {});
      installPanelTeardownListener();
    }

    // Report health AND inject a visible status dot into the
    // sub-app's own header so the view shows its own state
    // (since floating sub-apps don't appear in the shell's tab bar).
    var currentHealth = 'green';
    function reportSubAppHealth(state) {
      currentHealth = String(state || 'green');
      invoke('multiview_set_health', { label: wv.label, state: currentHealth })
        .catch(function () {});
      updateLocalDot();
    }

    // Inject dot into the first .header / .board-header / .shell-header
    // element if there isn't one already. Sub-apps with custom headers
    // can add `<span class="lexera-mv-status-dot"></span>` in their own
    // HTML and the runtime will populate it.
    function ensureLocalDot() {
      var existing = document.querySelector('.lexera-mv-status-dot');
      if (existing) return existing;
      var header = document.querySelector('header, .header, .board-header, .shell-header');
      if (!header) return null;
      var dot = document.createElement('span');
      dot.className = 'lexera-mv-status-dot';
      dot.setAttribute('data-health', 'green');
      dot.setAttribute('title', 'Connection state: green');
      // Insert before any close-button ([data-mv-close]) or last child
      var closeBtn = header.querySelector('[data-mv-close], .close-btn, .header-close');
      if (closeBtn) {
        header.insertBefore(dot, closeBtn);
      } else {
        header.appendChild(dot);
      }
      return dot;
    }
    function updateLocalDot() {
      var dot = ensureLocalDot();
      if (!dot) return;
      dot.setAttribute('data-health', currentHealth);
      dot.setAttribute('title', 'Connection state: ' + currentHealth);
    }

    // Inject default styling (no-op if a stylesheet already provides it)
    if (!document.getElementById('lexera-mv-status-dot-styles')) {
      var style = document.createElement('style');
      style.id = 'lexera-mv-status-dot-styles';
      style.textContent =
        '.lexera-mv-status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#666;margin:0 6px 0 4px;flex:0 0 auto;vertical-align:middle;transition:background .2s,box-shadow .2s;}' +
        '.lexera-mv-status-dot[data-health="green"]{background:#4caf50;box-shadow:0 0 4px rgba(76,175,80,.55);}' +
        '.lexera-mv-status-dot[data-health="yellow"]{background:#f5a623;box-shadow:0 0 4px rgba(245,166,35,.55);}' +
        '.lexera-mv-status-dot[data-health="red"]{background:#f44336;box-shadow:0 0 4px rgba(244,67,54,.55);}' +
        '.lexera-mv-status-dot[data-health="unknown"]{background:#666;}';
      document.head.appendChild(style);
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
    getQueryParam: getQueryParam,
    getContext: getContext,
    getPanelKind: getPanelKind,
    getPanelInstanceId: getPanelInstanceId,
    getPaneId: getPaneId,
    getWindowLabel: getWindowLabel,
    getHostWindowLabel: getHostWindowLabel,
    getCurrentWebview: getCurrentWebview,
    applyThemeSnapshot: applyThemeSnapshot,
    confirmModal: confirmModal,
    promptModal: promptModal,
    showNotification: function (message, opts) {
      if (typeof window !== 'undefined' && typeof window.showNotification === 'function') {
        return window.showNotification(message, opts);
      }
      return undefined;
    }
  };
})();
