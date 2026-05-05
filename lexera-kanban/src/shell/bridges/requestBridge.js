(function () {
  'use strict';

  // Request/response IPC pattern over Tauri events.
  //
  // Tauri events are fire-and-forget. For cross-webview features that
  // need a return value (e.g., "what context menu items do you have for
  // this scope?"), this bridge pairs a request event with a response
  // event using a unique correlation ID:
  //
  //   - Caller: emits <event> to the target webview with { _corr, data }
  //     and listens for <event>-response filtered by _corr.
  //   - Responder: listens for <event>, runs the handler, broadcasts
  //     <event>-response with { _corr, data } (or { _corr, _error }).
  //
  // Tauri-runtime accessors (tauri, invoke) are dependency-injected
  // so the bridge file is self-contained and unit-testable.

  function create(deps) {
    deps = deps || {};
    var tauri = deps.tauri;
    var invoke = deps.invoke;
    if (typeof tauri !== 'function' || typeof invoke !== 'function') {
      throw new Error('LexeraRequestBridge.create: missing required deps (tauri, invoke)');
    }
    var requestCounter = 0;

    function getCurrentWebview() {
      // Dual-API resolution; see commit 1d19e940 for the bug class.
      var t = tauri();
      if (!t || !t.webview) return null;
      try {
        if (typeof t.webview.getCurrent === 'function') return t.webview.getCurrent();
        if (typeof t.webview.getCurrentWebview === 'function') return t.webview.getCurrentWebview();
      } catch (_) {}
      return null;
    }

    // Caller side: send a request to a specific webview and resolve
    // with its response. Times out after timeoutMs (default 2000).
    function request(targetLabel, requestEvent, payload, timeoutMs) {
      timeoutMs = timeoutMs == null ? 2000 : timeoutMs;
      var corrId = 'req-' + (++requestCounter) + '-' + Date.now();
      var responseEvent = requestEvent + '-response';
      var t = tauri();
      var wv = getCurrentWebview();
      var listenFn = (wv && typeof wv.listen === 'function') ? wv.listen.bind(wv) : (t && t.event && t.event.listen);

      if (typeof listenFn !== 'function') {
        return Promise.reject(new Error('no Tauri event API'));
      }
      return new Promise(function (resolve, reject) {
        var unsubPromise = Promise.resolve(listenFn(responseEvent, function (event) {
          var p = event && event.payload ? event.payload : {};
          if (p._corr !== corrId) return;
          unsubPromise.then(function (unsub) { try { unsub(); } catch (_) {} });
          clearTimeout(timeoutHandle);
          if (p._error) reject(new Error(p._error));
          else resolve(p.data);
        }));
        var timeoutHandle = setTimeout(function () {
          unsubPromise.then(function (unsub) { try { unsub(); } catch (_) {} });
          reject(new Error('request ' + requestEvent + ' timed out after ' + timeoutMs + 'ms'));
        }, timeoutMs);
        invoke('multiview_emit_to', {
          target: targetLabel, event: requestEvent,
          payload: { _corr: corrId, data: payload || {} }
        }).catch(function (err) {
          unsubPromise.then(function (unsub) { try { unsub(); } catch (_) {} });
          clearTimeout(timeoutHandle);
          reject(err);
        });
      });
    }

    // Responder side: install a handler for a request event that
    // automatically broadcasts the response with the correlation ID.
    function handleRequest(requestEvent, handler) {
      var t = tauri();
      var wv = getCurrentWebview();
      var listenFn = (wv && typeof wv.listen === 'function') ? wv.listen.bind(wv) : (t && t.event && t.event.listen);

      if (typeof listenFn !== 'function') {
        return Promise.reject(new Error('no Tauri event API'));
      }
      var responseEvent = requestEvent + '-response';
      return listenFn(requestEvent, function (event) {
        var p = event && event.payload ? event.payload : {};
        var corr = p._corr;
        Promise.resolve()
          .then(function () { return handler(p.data || {}); })
          .then(function (data) {
            invoke('multiview_broadcast', {
              event: responseEvent,
              payload: { _corr: corr, data: data }
            }).catch(function () {});
          })
          .catch(function (err) {
            invoke('multiview_broadcast', {
              event: responseEvent,
              payload: { _corr: corr, _error: String(err && err.message || err) }
            }).catch(function () {});
          });
      });
    }

    return {
      request: request,
      handleRequest: handleRequest
    };
  }

  var api = { create: create };

  if (typeof window !== 'undefined') {
    window.LexeraRequestBridge = api;
  }
})();
