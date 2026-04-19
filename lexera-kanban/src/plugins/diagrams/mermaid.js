(function () {
  if (typeof window === 'undefined' || !window.LexeraDiagramRegistry) return;

  var DEFAULT_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
  var DEFAULT_THEME = 'dark';

  function getDeps() {
    return window.LexeraDiagramDeps || {};
  }

  function getSettings() {
    return typeof LexeraSettings !== 'undefined' ? LexeraSettings : null;
  }

  // Read the effective CDN URL / theme. Preference order:
  //   1. LexeraPluginConfig (new per-plugin config) if registered
  //   2. LexeraSettings('mermaidUrl') / localStorage fallback (legacy)
  //   3. Hardcoded defaults
  function resolveConfig() {
    var cfg = { url: DEFAULT_CDN, theme: DEFAULT_THEME };
    if (window.LexeraPluginConfig && typeof window.LexeraPluginConfig.get === 'function') {
      var schema = window.LexeraPluginConfig.getSchema ? window.LexeraPluginConfig.getSchema('mermaid') : null;
      if (schema) {
        var values = window.LexeraPluginConfig.get('mermaid');
        if (values.url) cfg.url = values.url;
        if (values.theme) cfg.theme = values.theme;
        return cfg;
      }
    }
    try {
      var settings = getSettings();
      var custom = settings ? settings.get('mermaidUrl') : localStorage.getItem('lexera-mermaid-url');
      if (custom) cfg.url = custom;
    } catch (_) { /* localStorage unavailable */ }
    return cfg;
  }

  window.LexeraDiagramRegistry.register({
    id: 'mermaid',
    metadata: { id: 'mermaid', name: 'Mermaid Diagram', version: '1.0.0', requires: ['mermaid-cdn'] },
    languages: ['mermaid'],
    configSchema: [
      { key: 'url', type: 'string', default: DEFAULT_CDN, label: 'Mermaid CDN URL', description: 'Custom CDN path for the Mermaid library' },
      { key: 'theme', type: 'string', default: DEFAULT_THEME, label: 'Mermaid theme', description: 'dark | default | forest | neutral' }
    ],
    _ready: false,
    _loading: false,
    _activationCtx: null,
    activate: function (ctx) {
      // Lifecycle hook actually used: store activation context so tooling
      // that wants the runtime (logger, deps) can consult it later.
      this._activationCtx = ctx || null;
    },
    deactivate: function () {
      // If a deactivation happens, drop the script tag so the next activate
      // cleanly re-loads the library.
      this._ready = false;
      this._loading = false;
      this._activationCtx = null;
    },
    onConfigChange: function (values) {
      // If config changes AFTER mermaid is already loaded, re-initialize the
      // theme live. The URL change requires a reload (rare — config UI
      // surfaces that caveat).
      if (this._ready && typeof mermaid !== 'undefined' && values && values.theme) {
        try {
          mermaid.initialize({
            startOnLoad: false,
            theme: values.theme,
            securityLevel: 'loose',
            fontFamily: 'inherit'
          });
        } catch (e) { /* mermaid not loaded yet */ }
      }
    },
    isReady: function () { return this._ready; },
    init: function () {
      var self = this;
      if (self._ready) return Promise.resolve();
      if (self._loading) {
        return new Promise(function (resolve) {
          var check = setInterval(function () {
            if (self._ready) { clearInterval(check); resolve(); }
          }, 50);
        });
      }
      self._loading = true;
      var cfg = resolveConfig();
      return new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = cfg.url;
        script.onload = function () {
          mermaid.initialize({
            startOnLoad: false,
            theme: cfg.theme,
            securityLevel: 'loose',
            fontFamily: 'inherit'
          });
          self._ready = true;
          self._loading = false;
          resolve();
        };
        script.onerror = function () {
          self._loading = false;
          reject(new Error('Failed to load Mermaid library'));
        };
        document.head.appendChild(script);
      });
    },
    render: function (id, code) {
      return mermaid.render(id + '-svg', code).then(function (result) { return result.svg; });
    },
    placeholder: function (id) {
      return '<div class="mermaid-placeholder" id="' + id + '">Loading diagram...</div>';
    },
    menuItems: function () {
      return [
        { id: 'copy-svg', label: 'Copy SVG' },
        { id: 'copy-code', label: 'Copy Mermaid Code' }
      ];
    },
    handleMenuAction: function (action, container) {
      var deps = getDeps();
      if (deps.handleDiagramAction) deps.handleDiagramAction(action, container);
    }
  });
})();
