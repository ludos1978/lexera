/**
 * Backend-window transport shim.
 *
 * Used by the connection-settings and quick-capture webviews, which run
 * inside the `lexera-backend` Tauri process. Monkey-patches `window.fetch`
 * and `window.EventSource` so that requests to loopback backend URLs go
 * through in-process Tauri commands (`backend_local_api`,
 * `backend_local_subscribe_*`) instead of over HTTP.
 *
 * Consequence: these windows work even if the HTTP server is disabled.
 * When Tauri is not available (browser/dev), the shim is a no-op and
 * native `fetch` / `EventSource` remain in place.
 */
(function () {
  'use strict';

  function resolveCore() {
    if (typeof window === 'undefined') return null;
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      return window.__TAURI_INTERNALS__;
    }
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      return window.__TAURI__.core;
    }
    return null;
  }

  var core = resolveCore();
  if (!core) return;

  function isBackendLikeUrl(url) {
    if (typeof url !== 'string') return false;
    if (url.startsWith('/')) return true;
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
  }

  function pathFromUrl(url) {
    if (url.startsWith('/')) return url;
    return url.replace(/^https?:\/\/[^/]+/, '');
  }

  function headersFromInit(headersInit) {
    var list = [];
    if (!headersInit) return list;
    if (typeof headersInit.forEach === 'function') {
      headersInit.forEach(function (v, k) { list.push([String(k), String(v)]); });
    } else if (Array.isArray(headersInit)) {
      for (var i = 0; i < headersInit.length; i++) {
        list.push([String(headersInit[i][0]), String(headersInit[i][1])]);
      }
    } else if (typeof headersInit === 'object') {
      for (var k in headersInit) {
        if (Object.prototype.hasOwnProperty.call(headersInit, k)) {
          list.push([k, String(headersInit[k])]);
        }
      }
    }
    return list;
  }

  function bodyToStringForIpc(body) {
    if (body == null) return null;
    if (typeof body === 'string') return body;
    if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
    if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
    // FormData / URLSearchParams are not part of the Phase 6 JSON paths; let
    // the caller see an error if they try. Returning undefined will surface
    // the body as "undefined" which the backend route can then reject.
    return String(body);
  }

  function makeResponse(r) {
    var bodyText = typeof r.body === 'string' ? r.body : '';
    var headers = r.headers || [];
    var headerLookup = Object.create(null);
    for (var i = 0; i < headers.length; i++) {
      headerLookup[String(headers[i][0]).toLowerCase()] = headers[i][1];
    }
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: '',
      headers: {
        get: function (name) {
          return headerLookup[String(name).toLowerCase()] || null;
        }
      },
      text: function () { return Promise.resolve(bodyText); },
      json: function () {
        try { return Promise.resolve(JSON.parse(bodyText)); }
        catch (e) { return Promise.reject(e); }
      }
    };
  }

  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url);
    if (!isBackendLikeUrl(url)) {
      return origFetch.call(this, input, init);
    }
    var method = (init && init.method) || (input && input.method) || 'GET';
    var arg = {
      method: String(method).toUpperCase(),
      uri: pathFromUrl(url),
      headers: headersFromInit(init && init.headers),
      body: bodyToStringForIpc(init && init.body)
    };
    return core.invoke('backend_local_api', { arg: arg }).then(makeResponse);
  };

  var OrigEventSource = window.EventSource;
  window.EventSource = function (url) {
    if (!isBackendLikeUrl(url)) {
      return new OrigEventSource(url);
    }
    var path = pathFromUrl(url).split('?')[0];
    var command;
    if (path === '/events') command = 'backend_local_subscribe_events';
    else if (path === '/logs/stream') command = 'backend_local_subscribe_logs';
    else return new OrigEventSource(url);

    var channel;
    try {
      channel = new core.Channel();
    } catch (e) {
      return new OrigEventSource(url);
    }

    var messageHandlers = [];
    var errorHandlers = [];
    var openHandlers = [];
    var typedHandlers = Object.create(null);
    var subscriptionId = null;
    var closed = false;

    function dispatch(listeners, evt) {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](evt); } catch (e) { /* ignore listener error */ }
      }
    }

    channel.onmessage = function (msg) {
      if (closed) return;
      if (msg && msg.end !== undefined && msg.end !== null) {
        var errEvt = { type: 'error' };
        if (es.onerror) try { es.onerror(errEvt); } catch (e) {}
        dispatch(errorHandlers, errEvt);
        return;
      }
      if (!msg || typeof msg.payload !== 'string') return;
      var evt = { data: msg.payload, type: 'message' };
      if (es.onmessage) try { es.onmessage(evt); } catch (e) {}
      dispatch(messageHandlers, evt);
      if (typedHandlers.message) dispatch(typedHandlers.message, evt);
    };

    var es = {
      url: url,
      readyState: 0,
      withCredentials: false,
      onmessage: null,
      onerror: null,
      onopen: null,
      addEventListener: function (name, handler) {
        if (typeof handler !== 'function') return;
        if (name === 'message') messageHandlers.push(handler);
        else if (name === 'error') errorHandlers.push(handler);
        else if (name === 'open') openHandlers.push(handler);
        else {
          typedHandlers[name] = typedHandlers[name] || [];
          typedHandlers[name].push(handler);
        }
      },
      removeEventListener: function (name, handler) {
        function drop(list) {
          var idx = list.indexOf(handler);
          if (idx !== -1) list.splice(idx, 1);
        }
        if (name === 'message') drop(messageHandlers);
        else if (name === 'error') drop(errorHandlers);
        else if (name === 'open') drop(openHandlers);
        else if (typedHandlers[name]) drop(typedHandlers[name]);
      },
      close: function () {
        closed = true;
        es.readyState = 2;
        if (subscriptionId) {
          core.invoke('backend_local_unsubscribe', { subscriptionId: subscriptionId })
            .catch(function () { /* best-effort */ });
          subscriptionId = null;
        }
      },
      dispatchEvent: function () { return true; }
    };

    core.invoke(command, { channel: channel })
      .then(function (id) {
        if (closed) {
          // Subscription won the race; close immediately.
          core.invoke('backend_local_unsubscribe', { subscriptionId: id }).catch(function () {});
          return;
        }
        subscriptionId = id;
        es.readyState = 1;
        var openEvt = { type: 'open' };
        if (es.onopen) try { es.onopen(openEvt); } catch (e) {}
        dispatch(openHandlers, openEvt);
      })
      .catch(function (e) {
        var errEvt = { type: 'error', error: e };
        if (es.onerror) try { es.onerror(errEvt); } catch (err) {}
        dispatch(errorHandlers, errEvt);
      });

    return es;
  };
  // Preserve the standard readyState constants on the shim.
  window.EventSource.CONNECTING = 0;
  window.EventSource.OPEN = 1;
  window.EventSource.CLOSED = 2;
})();
