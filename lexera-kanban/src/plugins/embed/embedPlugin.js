(function () {
  var KNOWN_EXTERNAL_EMBED_PATTERNS = [
    'miro.com/app/live-embed',
    'miro.com/app/embed',
    'figma.com/embed',
    'figma.com/file',
    'figma.com/proto',
    'youtube.com/embed',
    'youtube-nocookie.com/embed',
    'youtu.be',
    'vimeo.com/video',
    'player.vimeo.com',
    'codepen.io/*/embed',
    'codesandbox.io/embed',
    'codesandbox.io/s',
    'stackblitz.com/edit',
    'jsfiddle.net/*/embedded',
    'docs.google.com/presentation',
    'docs.google.com/document',
    'docs.google.com/spreadsheets',
    'notion.so',
    'airtable.com/embed',
    'loom.com/embed',
    'loom.com/share',
    'prezi.com/p/embed',
    'prezi.com/v/embed',
    'ars.particify.de/present'
  ];

  function escapeRegex(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isUrl(value) {
    if (!value) return false;
    try {
      var parsed = new URL(value);
      return !!(parsed.protocol && parsed.host);
    } catch (err) {
      return false;
    }
  }

  function isKnownExternalEmbedUrl(url) {
    if (!isUrl(url)) return false;
    try {
      var parsed = new URL(url);
      var hostPath = (parsed.host + parsed.pathname).toLowerCase();
      for (var i = 0; i < KNOWN_EXTERNAL_EMBED_PATTERNS.length; i++) {
        var pattern = KNOWN_EXTERNAL_EMBED_PATTERNS[i].toLowerCase();
        var regex = new RegExp('^' + escapeRegex(pattern).replace(/\\\*/g, '[^/]+'));
        if (regex.test(hostPath)) return true;
      }
    } catch (err) {
      return false;
    }
    return false;
  }

  // Normalize a user-supplied embed handling mode to a canonical token.
  function normalizeEmbedHandling(mode) {
    var value = String(mode == null ? '' : mode).trim().toLowerCase();
    if (value === 'iframe' || value === 'remove' || value === 'fallback') return value;
    return 'keep';
  }

  var plugin = {
    kind: 'embed',
    metadata: {
      id: 'embed',
      name: 'External Embed Handling',
      version: '1.0.0'
    },
    getKnownPatterns: function () { return KNOWN_EXTERNAL_EMBED_PATTERNS.slice(); },
    isKnownExternalEmbedUrl: isKnownExternalEmbedUrl,
    normalizeEmbedHandling: normalizeEmbedHandling
  };

  if (typeof LexeraPluginRegistry !== 'undefined') {
    LexeraPluginRegistry.register(plugin);
  }

  if (typeof window !== 'undefined') {
    window.LexeraEmbedPlugin = plugin;
  }
})();
