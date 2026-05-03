(function () {
  'use strict';

  var INDICATOR_ID = 'lexera-backend-status-indicator';
  var EVENT_NAME = 'backend-status';

  function describe(payload) {
    if (!payload || typeof payload !== 'object') {
      return { visible: true, label: 'Connecting to backend…', tone: 'waiting' };
    }
    var state = payload.state;
    if (state === 'connected') {
      return { visible: false, label: '', tone: 'connected' };
    }
    if (state === 'waiting') {
      return { visible: true, label: 'Connecting to backend…', tone: 'waiting' };
    }
    if (state === 'reconnecting') {
      var attempt = Number.isFinite(payload.attempt) ? payload.attempt : 0;
      var suffix = attempt > 0 ? ' (attempt ' + attempt + ')' : '';
      return { visible: true, label: 'Reconnecting to backend' + suffix + '…', tone: 'reconnecting' };
    }
    if (state === 'unavailable') {
      var reason = payload.reason ? ': ' + payload.reason : '';
      return { visible: true, label: 'Backend unavailable' + reason, tone: 'unavailable' };
    }
    return { visible: true, label: 'Backend status: ' + String(state || 'unknown'), tone: 'unknown' };
  }

  function ensureElement(doc) {
    if (!doc || typeof doc.getElementById !== 'function') return null;
    var el = doc.getElementById(INDICATOR_ID);
    if (el) return el;
    if (typeof doc.createElement !== 'function' || !doc.body) return null;
    el = doc.createElement('div');
    el.id = INDICATOR_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.position = 'fixed';
    el.style.top = '8px';
    el.style.right = '8px';
    el.style.zIndex = '999999';
    el.style.padding = '6px 10px';
    el.style.borderRadius = '4px';
    el.style.font = '12px/1.4 system-ui, -apple-system, sans-serif';
    el.style.background = 'var(--lexera-status-bg, rgba(40, 40, 40, 0.92))';
    el.style.color = 'var(--lexera-status-fg, #f0f0f0)';
    el.style.border = '1px solid var(--lexera-status-border, rgba(255, 255, 255, 0.18))';
    el.style.pointerEvents = 'none';
    el.style.display = 'none';
    el.style.maxWidth = '50vw';
    el.style.overflow = 'hidden';
    el.style.textOverflow = 'ellipsis';
    el.style.whiteSpace = 'nowrap';
    doc.body.appendChild(el);
    return el;
  }

  function render(doc, payload) {
    var view = describe(payload);
    var el = ensureElement(doc);
    if (!el) return view;
    el.dataset.state = (payload && payload.state) || 'unknown';
    el.dataset.tone = view.tone;
    if (view.visible) {
      el.textContent = view.label;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
      el.textContent = '';
    }
    return view;
  }

  function installWith(runtime, options) {
    var opts = options || {};
    var doc = opts.document || (typeof document !== 'undefined' ? document : null);
    if (!runtime || !runtime.event || typeof runtime.event.listen !== 'function') {
      return false;
    }
    runtime.event.listen(EVENT_NAME, function (event) {
      render(doc, event && event.payload);
    });
    return true;
  }

  var api = {
    EVENT_NAME: EVENT_NAME,
    INDICATOR_ID: INDICATOR_ID,
    describe: describe,
    render: render,
    installWith: installWith
  };

  if (typeof window !== 'undefined') {
    window.LexeraBackendStatusBridge = api;
  }
})();
