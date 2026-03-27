(function () {
  var rootEl = document.getElementById('excalidraw-overlay-root');
  var statusEl = document.getElementById('excalidraw-overlay-status');
  var excalidrawAPI = null;
  var currentScene = {
    elements: [],
    appState: { viewBackgroundColor: '#ffffff', gridSize: null },
    files: {}
  };
  var initialized = false;

  function setStatus(message, state) {
    if (!statusEl) return;
    statusEl.textContent = String(message || '');
    statusEl.setAttribute('data-state', state || 'loading');
  }

  function postToParent(type, payload) {
    if (!window.parent) return;
    window.parent.postMessage({
      source: 'lexera-excalidraw-frame',
      type: type,
      payload: payload || {}
    }, '*');
  }

  function safeJsonClone(value) {
    try {
      return structuredClone(value || null);
    } catch (err) {
      return value || null;
    }
  }

  function getLibraryApi() {
    return window.ExcalidrawLib || window.Excalidraw || null;
  }

  function buildSerializedScene() {
    var api = getLibraryApi();
    if (!api || typeof api.serializeAsJSON !== 'function') {
      throw new Error('Excalidraw serializeAsJSON API is not available');
    }
    var elements = excalidrawAPI && typeof excalidrawAPI.getSceneElementsIncludingDeleted === 'function'
      ? excalidrawAPI.getSceneElementsIncludingDeleted()
      : currentScene.elements;
    var appState = excalidrawAPI && typeof excalidrawAPI.getAppState === 'function'
      ? excalidrawAPI.getAppState()
      : currentScene.appState;
    var files = excalidrawAPI && typeof excalidrawAPI.getFiles === 'function'
      ? excalidrawAPI.getFiles()
      : currentScene.files;
    return api.serializeAsJSON(elements || [], appState || {}, files || {}, 'local');
  }

  function renderScene(scene) {
    var api = getLibraryApi();
    if (!window.React || !window.ReactDOM || !api || !api.Excalidraw) {
      throw new Error('Excalidraw editor assets are not available');
    }

    currentScene = {
      elements: Array.isArray(scene && scene.elements) ? scene.elements : [],
      appState: scene && scene.appState ? scene.appState : { viewBackgroundColor: '#ffffff', gridSize: null },
      files: scene && scene.files ? scene.files : {}
    };

    var props = {
      initialData: safeJsonClone(currentScene),
      excalidrawAPI: function (nextApi) {
        excalidrawAPI = nextApi;
        if (!initialized) {
          initialized = true;
          setStatus('Editor ready', 'ready');
          postToParent('ready', {});
        }
      },
      onChange: function (elements, appState, files) {
        currentScene = {
          elements: safeJsonClone(elements) || [],
          appState: safeJsonClone(appState) || {},
          files: safeJsonClone(files) || {}
        };
        if (initialized) {
          postToParent('dirty', {});
        }
      },
      UIOptions: {
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false
        }
      },
      name: 'Lexera Excalidraw',
      langCode: 'en',
      theme: 'light',
      detectScroll: false,
      handleKeyboardGlobally: false,
      autoFocus: true
    };

    window.ReactDOM.render(
      window.React.createElement(api.Excalidraw, props),
      rootEl
    );
  }

  window.addEventListener('message', function (event) {
    var message = event && event.data ? event.data : null;
    if (!message || message.source !== 'lexera-excalidraw-parent') return;

    if (message.type === 'init') {
      try {
        renderScene(message.payload || {});
      } catch (err) {
        setStatus(err && err.message ? err.message : String(err), 'error');
        postToParent('error', { message: err && err.message ? err.message : String(err) });
      }
      return;
    }

    if (message.type === 'request-save') {
      try {
        var serialized = buildSerializedScene();
        postToParent('save-response', { content: serialized });
      } catch (err) {
        postToParent('error', { message: err && err.message ? err.message : String(err) });
      }
      return;
    }

    if (message.type === 'request-current-scene') {
      postToParent('scene-response', safeJsonClone(currentScene) || {});
    }
  });

  setStatus('Waiting for file data…', 'loading');
  postToParent('frame-loaded', {});
})();
