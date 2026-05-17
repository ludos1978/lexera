// Plain-media file formats (image / video / audio).
//
// These plugins own the inline emission (`emit`) for their file kinds. No
// runtime `enhance` is declared because the browser loads the media element
// itself via the lazy-src loader in `contentEnhancerRegistry` — there's no
// cache round-trip or worker call. Timed media declares
// `supportsRuntimeRender:false`, so LexeraFileFormatRegistry.enhance
// acknowledges the embed as handled and does not fall through to the text
// preview path.
//
// Image needs no export conversion — Marp/Pandoc embed images natively.
// Video and audio do: a presentation target that cannot play media
// (Marp PDF/PPTX) would otherwise carry a broken `![](clip.mp4)` link.
// They therefore declare an export render config + renderFile (same
// cache scheme as pdf/drawio) BUT gate it via `appliesToFormat` so the
// embed only converts to a still image for non-playable targets
// ('pdf' / 'pptx'). For Marp HTML (the default) and the live board the
// real `<video>`/`<audio>` element is kept playable — the preview block
// stays `supportsRuntimeRender:false` so the board still mounts the live
// element via the lazy loader and the export's media-pack / data-URI
// pipeline carries the source file for in-bundle playback.
(function () {
  if (typeof LexeraPluginRegistry === 'undefined' || typeof LexeraFileFormatHelpers === 'undefined') return;
  var H = LexeraFileFormatHelpers;

  // Shared predicate for the timed-media plugins: a still image is only
  // needed when the export target cannot play the element. Marp HTML
  // ('html' / '' default) and the live board keep the playable element;
  // PDF/PPTX get the converted image.
  function convertsForNonPlayableTarget(targetFormat) {
    return targetFormat === 'pdf' || targetFormat === 'pptx';
  }

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
    rendererRequirements: [{ id: 'ffmpeg' }],
    previewPlaceholder: 'Video plays inline. Exports to PDF/PPTX render a poster frame for compatibility.',
    // supportsRuntimeRender:false → the board keeps the live <video> via
    // the lazy loader (embedMenu's preview-cache render no-ops on false);
    // cacheFolderName + outputExtension exist only so the EXPORT path's
    // getPreviewRenderConfig() returns a cache target. Conversion itself
    // is gated by export.appliesToFormat below.
    preview: {
      kind: 'video',
      cacheFolderName: 'video-cache',
      outputExtension: 'png',
      outputFormat: 'png',
      supportsRuntimeRender: false,
      buildSuffix: function () { return ''; }
    },
    export: H.buildExportConfig('png', 'png', null, convertsForNonPlayableTarget),
    matches: function (normalized) {
      return /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(normalized);
    },
    canRenderFile: function (path) {
      return this.matches(String(path || '').toLowerCase());
    },
    renderFile: H.makeRenderFile('video'),
    emit: H.makePlainMediaEmit('video')
  });

  LexeraPluginRegistry.register({
    kind: 'fileFormat',
    metadata: { id: 'audio', name: 'Audio file', version: '1.0.0' },
    label: 'Audio file',
    emoji: '&#127925;',
    assetType: 'audio',
    rendererRequirements: [{ id: 'ffmpeg' }],
    previewPlaceholder: 'Audio plays inline. Exports to PDF/PPTX render a waveform image for compatibility.',
    preview: {
      kind: 'audio',
      cacheFolderName: 'audio-cache',
      outputExtension: 'png',
      outputFormat: 'png',
      supportsRuntimeRender: false,
      buildSuffix: function () { return ''; }
    },
    export: H.buildExportConfig('png', 'png', null, convertsForNonPlayableTarget),
    matches: function (normalized) {
      return /\.(mp3|wav|ogg|flac|aac|m4a|opus)$/i.test(normalized);
    },
    canRenderFile: function (path) {
      return this.matches(String(path || '').toLowerCase());
    },
    renderFile: H.makeRenderFile('audio'),
    emit: H.makePlainMediaEmit('audio')
  });
})();
