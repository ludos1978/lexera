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

  // Back-compat: accept legacy-shape plugins (flat, no kind/metadata) and forward to the unified registry.
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
    reg.register(manifest);
    return projectPlugin(manifest);
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
    normalizeFilePathForDetection: normalizeFilePathForDetection
  };
})();

if (typeof window !== 'undefined') {
  window.LexeraFileFormatRegistry = LexeraFileFormatRegistry;
}
