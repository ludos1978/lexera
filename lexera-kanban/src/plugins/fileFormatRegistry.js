var LexeraFileFormatRegistry = (function () {
  var FILE_FORMAT_KIND = 'fileFormat';
  var helpers = typeof LexeraFileFormatHelpers !== 'undefined' ? LexeraFileFormatHelpers : null;

  function normalizePageNumber(pageNumber) {
    if (helpers) return helpers.normalizePageNumber(pageNumber);
    var parsed = parseInt(pageNumber, 10);
    return parsed > 0 ? parsed : 1;
  }

  function cloneRendererRequirement(requirement) {
    return requirement && typeof requirement === 'object'
      ? Object.assign({}, requirement)
      : requirement;
  }

  function normalizeFilePathForDetection(path) {
    var value = String(path || '').trim();
    if (!value) return '';
    try {
      if (/^https?:\/\//i.test(value)) value = new URL(value).pathname || '';
    } catch (err) {
      // Fall back to simple string parsing below.
    }
    return value.split('#')[0].split('?')[0].toLowerCase();
  }

  function projectPlugin(plugin) {
    if (!plugin) return null;
    // Map a v2 plugin manifest to the legacy flat shape consumers expect.
    var projected = {
      id: plugin.metadata && plugin.metadata.id,
      label: plugin.label,
      emoji: plugin.emoji,
      assetType: plugin.assetType,
      editorKind: plugin.editorKind,
      previewPlaceholder: plugin.previewPlaceholder,
      preview: plugin.preview ? Object.assign({}, plugin.preview) : null,
      export: plugin.export ? Object.assign({}, plugin.export) : null,
      rendererRequirements: Array.isArray(plugin.rendererRequirements)
        ? plugin.rendererRequirements.map(cloneRendererRequirement)
        : [],
      matches: plugin.matches
    };
    // Carry render capability through when the plugin declares it, so
    // ExportService.renderFileEmbedsForExport (and similar callers) can
    // dispatch through the plugin instead of invoking Tauri directly.
    if (typeof plugin.canRenderFile === 'function') {
      projected.canRenderFile = plugin.canRenderFile.bind(plugin);
    }
    if (typeof plugin.renderFile === 'function') {
      projected.renderFile = plugin.renderFile.bind(plugin);
    }
    // Plugin-owned DOM enhance — called by LexeraEmbedMenu.enhanceSingleEmbedContainer
    // as the single runtime dispatcher. Plugins that don't declare this
    // method leave the projected value undefined, which the dispatcher
    // treats as "no runtime rendering for this type".
    if (typeof plugin.enhance === 'function') {
      projected.enhance = plugin.enhance.bind(plugin);
    }
    // Plugin-owned HTML emission — called by the inlineRenderer during
    // markdown → HTML generation (sync) to produce the inner HTML of the
    // `.embed-container` placeholder. Plugins that don't declare this leave
    // the dispatch path to fall back to the generic file-link template.
    if (typeof plugin.emit === 'function') {
      projected.emit = plugin.emit.bind(plugin);
    }
    return projected;
  }

  function getRegistry() {
    return typeof LexeraPluginRegistry !== 'undefined' ? LexeraPluginRegistry : null;
  }

  function getAll() {
    var reg = getRegistry();
    if (!reg) return [];
    return reg.getByKind(FILE_FORMAT_KIND).map(projectPlugin);
  }

  function getById(id) {
    var reg = getRegistry();
    if (!reg) return null;
    return projectPlugin(reg.getById(FILE_FORMAT_KIND, id));
  }

  function findByFilePath(filePath) {
    var reg = getRegistry();
    if (!reg) return null;
    var normalized = normalizeFilePathForDetection(filePath);
    if (!normalized) return null;
    var hit = reg.findBy(FILE_FORMAT_KIND, function (plugin) {
      return typeof plugin.matches === 'function' && plugin.matches(normalized, filePath);
    });
    return projectPlugin(hit);
  }

  function findByPreviewKind(previewKind, filePath) {
    var reg = getRegistry();
    if (!reg) return null;
    var normalizedKind = String(previewKind || '').trim().toLowerCase();
    if (!normalizedKind) return null;
    if (filePath) {
      var exact = findByFilePath(filePath);
      if (exact && exact.preview && exact.preview.kind === normalizedKind) return exact;
    }
    var hit = reg.findBy(FILE_FORMAT_KIND, function (plugin) {
      return plugin.preview && plugin.preview.kind === normalizedKind;
    });
    return projectPlugin(hit);
  }

  function getPreviewKind(filePath) {
    var plugin = findByFilePath(filePath);
    return plugin && plugin.preview ? plugin.preview.kind : '';
  }

  function getPreviewMeta(previewKind, filePath) {
    var plugin = findByPreviewKind(previewKind, filePath);
    if (plugin) {
      return {
        label: plugin.label || 'File',
        emoji: plugin.emoji || '&#128196;'
      };
    }
    return { label: 'File', emoji: '&#128196;' };
  }

  function getPreviewPlaceholder(previewKind, filePath) {
    var plugin = findByPreviewKind(previewKind, filePath);
    if (!plugin) return 'Preview is not available in this view yet.';
    return plugin.previewPlaceholder || 'Preview is not available in this view yet.';
  }

  function getPreviewRenderConfig(filePath, options) {
    var plugin = findByFilePath(filePath);
    if (!plugin || !plugin.preview || !plugin.preview.cacheFolderName || !plugin.preview.outputExtension) {
      return null;
    }
    var page = normalizePageNumber(options && options.pageNumber);
    return {
      pluginId: plugin.id,
      previewKind: plugin.preview.kind || '',
      cacheFolderName: plugin.preview.cacheFolderName,
      extension: plugin.preview.outputExtension,
      outputFormat: plugin.preview.outputFormat || plugin.preview.outputExtension,
      pageNumber: page,
      suffix: typeof plugin.preview.buildSuffix === 'function' ? plugin.preview.buildSuffix(page) : '',
      supportsRuntimeRender: plugin.preview.supportsRuntimeRender !== false
    };
  }

  function getExportRenderConfig(filePath, options) {
    var plugin = findByFilePath(filePath);
    if (!plugin || !plugin.export || !plugin.export.outputExtension) return null;
    // Format-aware gate: a plugin whose export config declares
    // appliesToFormat opts out of conversion for targets where the
    // embed is natively usable (e.g. video/audio stay playable in Marp
    // HTML but convert to a still image for PDF/PPTX). Returning null
    // makes renderFileEmbedsForExport skip the embed for this target.
    var targetFormat = options && options.outputFormat
      ? String(options.outputFormat).trim().toLowerCase()
      : '';
    if (typeof plugin.export.appliesToFormat === 'function' &&
        targetFormat &&
        !plugin.export.appliesToFormat(targetFormat)) {
      return null;
    }
    var page = normalizePageNumber(options && options.pageNumber);
    return {
      pluginId: plugin.id,
      previewKind: plugin.preview ? plugin.preview.kind : '',
      outputExtension: plugin.export.outputExtension,
      outputFormat: plugin.export.outputFormat || plugin.export.outputExtension,
      pageNumber: page,
      suffix: typeof plugin.export.buildSuffix === 'function' ? plugin.export.buildSuffix(page) : '',
      supportsRuntimeRender: plugin.export.supportsRuntimeRender !== false
    };
  }

  function supportsExportReplacement(filePath) {
    var plugin = findByFilePath(filePath);
    return !!(plugin && plugin.export && plugin.export.outputExtension);
  }

  function getRendererRequirements(filePath) {
    var plugin = findByFilePath(filePath);
    return plugin && Array.isArray(plugin.rendererRequirements)
      ? plugin.rendererRequirements.map(cloneRendererRequirement)
      : [];
  }

  function getAssetType(filePath) {
    var plugin = findByFilePath(filePath);
    return plugin && typeof plugin.assetType === 'string' ? plugin.assetType : '';
  }

  function getEditorKind(filePath) {
    var plugin = findByFilePath(filePath);
    return plugin && typeof plugin.editorKind === 'string' ? plugin.editorKind : '';
  }

  // Back-compat: accept legacy-shape plugins (flat `{ id, label, matches, ... }`,
  // no `kind`/`metadata` wrapper) and forward them to the unified plugin
  // registry. Preserves the optional `emit`/`enhance`/`canRenderFile`/
  // `renderFile` functions so the dispatchers find them after projection.
  function register(plugin) {
    var reg = getRegistry();
    if (!reg) throw new Error('LexeraPluginRegistry not available');
    if (!plugin || !plugin.id || typeof plugin.matches !== 'function') {
      throw new Error('Invalid file format plugin definition');
    }
    var manifest = {
      kind: FILE_FORMAT_KIND,
      metadata: {
        id: plugin.id,
        name: plugin.label || plugin.id,
        version: plugin.version || '1.0.0'
      },
      label: plugin.label,
      emoji: plugin.emoji,
      assetType: plugin.assetType,
      editorKind: plugin.editorKind,
      previewPlaceholder: plugin.previewPlaceholder,
      preview: plugin.preview ? Object.assign({}, plugin.preview) : null,
      export: plugin.export ? Object.assign({}, plugin.export) : null,
      rendererRequirements: Array.isArray(plugin.rendererRequirements)
        ? plugin.rendererRequirements.map(cloneRendererRequirement)
        : [],
      matches: plugin.matches
    };
    if (typeof plugin.canRenderFile === 'function') manifest.canRenderFile = plugin.canRenderFile;
    if (typeof plugin.renderFile === 'function') manifest.renderFile = plugin.renderFile;
    if (typeof plugin.emit === 'function') manifest.emit = plugin.emit;
    if (typeof plugin.enhance === 'function') manifest.enhance = plugin.enhance;
    reg.register(manifest);
    return projectPlugin(manifest);
  }

  // Single runtime dispatcher. Called by LexeraEmbedMenu.enhanceSingleEmbedContainer
  // (which is itself called by card-render, SSE MediaChanged, modal-open,
  // and Retry-Render). Looks up the plugin matching the container's
  // `data-file-path` and delegates to its `enhance` method.
  //
  // Returns:
  //   Promise<true>  — plugin rendered successfully (or acknowledged)
  //   Promise<false> — plugin ran but reported failure
  //   Promise<null>  — no plugin matched this file type (caller may fall
  //                    back to a non-plugin code path, e.g. text preview)
  function enhance(container, opts) {
    opts = opts || {};
    var filePath = opts.filePath ||
      (container && typeof container.getAttribute === 'function'
        ? container.getAttribute('data-file-path')
        : '') || '';
    if (!filePath) return Promise.resolve(null);
    var plugin = findByFilePath(filePath);
    if (!plugin || typeof plugin.enhance !== 'function') return Promise.resolve(null);
    var normalizedOpts = {
      boardId: opts.boardId || (container && typeof container.getAttribute === 'function'
        ? container.getAttribute('data-board-id') : '') || '',
      filePath: filePath,
      variant: opts.variant ||
        (container && typeof container.getAttribute === 'function'
          ? container.getAttribute('data-variant') : '') || '',
      forceRerender: !!opts.forceRerender,
      previewKind: plugin.preview && plugin.preview.kind
    };
    try {
      var result = plugin.enhance(container, normalizedOpts);
      return Promise.resolve(result);
    } catch (err) {
      if (typeof window !== 'undefined' && typeof window.logFrontendIssue === 'function') {
        window.logFrontendIssue(
          'error',
          'embed.enhance.dispatch',
          'Plugin ' + (plugin.id || '?') + '.enhance threw: ' + (err && err.message ? err.message : String(err)),
          err
        );
      }
      return Promise.resolve(false);
    }
  }

  // Single emission dispatcher. Called by the inlineRenderer during
  // markdown → HTML for every `![alt](path)` token. Returns the inner HTML
  // the caller should place inside `.embed-container`, or null if no plugin
  // matches (caller falls back to the generic file-link template).
  //
  // ctx shape (provided by inlineRenderer):
  //   { filePath, boardId, alt, titleText, src, mediaStyleAttr, helpers }
  function emitPlaceholder(filePath, ctx) {
    if (!filePath) return null;
    var plugin = findByFilePath(filePath);
    if (!plugin || typeof plugin.emit !== 'function') return null;
    var normalizedCtx = Object.assign({}, ctx || {}, {
      filePath: filePath,
      previewKind: plugin.preview && plugin.preview.kind
    });
    try {
      var html = plugin.emit(normalizedCtx);
      return typeof html === 'string' ? html : null;
    } catch (err) {
      if (typeof window !== 'undefined' && typeof window.logFrontendIssue === 'function') {
        window.logFrontendIssue(
          'error',
          'embed.emit.dispatch',
          'Plugin ' + (plugin.id || '?') + '.emit threw: ' + (err && err.message ? err.message : String(err)),
          err
        );
      }
      return null;
    }
  }

  return {
    register: register,
    getAll: getAll,
    getById: getById,
    findByFilePath: findByFilePath,
    findByPreviewKind: findByPreviewKind,
    getPreviewKind: getPreviewKind,
    getPreviewMeta: getPreviewMeta,
    getPreviewPlaceholder: getPreviewPlaceholder,
    getPreviewRenderConfig: getPreviewRenderConfig,
    getExportRenderConfig: getExportRenderConfig,
    getRendererRequirements: getRendererRequirements,
    getAssetType: getAssetType,
    getEditorKind: getEditorKind,
    supportsExportReplacement: supportsExportReplacement,
    normalizeFilePathForDetection: normalizeFilePathForDetection,
    enhance: enhance,
    emitPlaceholder: emitPlaceholder
  };
})();

if (typeof window !== 'undefined') {
  window.LexeraFileFormatRegistry = LexeraFileFormatRegistry;
}
