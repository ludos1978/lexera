// Plain-media file formats (image / video / audio).
//
// These plugins own the inline emission (`emit`) for their file kinds. No
// runtime `enhance` is declared because the browser loads the media element
// itself via the lazy-src loader in `contentEnhancerRegistry` — there's no
// cache round-trip or worker call. `enhance` is deliberately absent so the
// LexeraFileFormatRegistry.enhance dispatcher returns `null` for these types
// and the embed-container placeholder stays empty (the lazy loader picks up
// the baked `<img data-lazy-src>` / `<video data-lazy-src>` and swaps it
// when it enters the viewport).
(function () {
  if (typeof LexeraPluginRegistry === 'undefined' || typeof LexeraFileFormatHelpers === 'undefined') return;
  var H = LexeraFileFormatHelpers;

  LexeraPluginRegistry.register({
    kind: 'fileFormat',
    metadata: { id: 'image', name: 'Image file', version: '1.0.0' },
    label: 'Image file',
    emoji: '&#128444;',
    assetType: 'image',
    previewPlaceholder: 'Image is rendered inline.',
    // No preview/cache/render config — images render directly via <img>.
    matches: function (normalized) {
      return /\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?|avif)$/i.test(normalized);
    },
    emit: H.makePlainMediaEmit('image')
  });

  LexeraPluginRegistry.register({
    kind: 'fileFormat',
    metadata: { id: 'video', name: 'Video file', version: '1.0.0' },
    label: 'Video file',
    emoji: '&#127909;',
    assetType: 'video',
    previewPlaceholder: 'Video is rendered inline.',
    matches: function (normalized) {
      return /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(normalized);
    },
    emit: H.makePlainMediaEmit('video')
  });

  LexeraPluginRegistry.register({
    kind: 'fileFormat',
    metadata: { id: 'audio', name: 'Audio file', version: '1.0.0' },
    label: 'Audio file',
    emoji: '&#127925;',
    assetType: 'audio',
    previewPlaceholder: 'Audio is rendered inline.',
    matches: function (normalized) {
      return /\.(mp3|wav|ogg|flac|aac|m4a|opus)$/i.test(normalized);
    },
    emit: H.makePlainMediaEmit('audio')
  });
})();
