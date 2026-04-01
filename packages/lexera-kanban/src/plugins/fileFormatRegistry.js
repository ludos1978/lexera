var LexeraFileFormatRegistry = (function () {
  var plugins = [];

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

  function clonePlugin(plugin) {
    if (!plugin) return null;
    return Object.assign({}, plugin, {
      preview: plugin.preview ? Object.assign({}, plugin.preview) : null,
      export: plugin.export ? Object.assign({}, plugin.export) : null,
      rendererRequirements: Array.isArray(plugin.rendererRequirements)
        ? plugin.rendererRequirements.map(cloneRendererRequirement)
        : [],
    });
  }

  function register(plugin) {
    if (!plugin || !plugin.id || typeof plugin.matches !== 'function') {
      throw new Error('Invalid file format plugin definition');
    }
    var next = clonePlugin(plugin);
    var replaced = false;
    for (var i = 0; i < plugins.length; i++) {
      if (plugins[i].id === next.id) {
        plugins[i] = next;
        replaced = true;
        break;
      }
    }
    if (!replaced) plugins.push(next);
    return next;
  }

  function getAll() {
    return plugins.map(clonePlugin);
  }

  function getById(id) {
    for (var i = 0; i < plugins.length; i++) {
      if (plugins[i].id === id) return clonePlugin(plugins[i]);
    }
    return null;
  }

  function findByFilePath(filePath) {
    var normalized = normalizeFilePathForDetection(filePath);
    if (!normalized) return null;
    for (var i = 0; i < plugins.length; i++) {
      if (plugins[i].matches(normalized, filePath)) return clonePlugin(plugins[i]);
    }
    return null;
  }

  function findByPreviewKind(previewKind, filePath) {
    var normalizedKind = String(previewKind || '').trim().toLowerCase();
    if (!normalizedKind) return null;
    if (filePath) {
      var exact = findByFilePath(filePath);
      if (exact && exact.preview && exact.preview.kind === normalizedKind) return exact;
    }
    for (var i = 0; i < plugins.length; i++) {
      if (plugins[i].preview && plugins[i].preview.kind === normalizedKind) return clonePlugin(plugins[i]);
    }
    return null;
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
        emoji: plugin.emoji || '&#128196;',
      };
    }
    return { label: 'File', emoji: '&#128196;' };
  }

  function getPreviewPlaceholder(previewKind, filePath) {
    var plugin = findByPreviewKind(previewKind, filePath);
    if (!plugin) return 'Preview is not available in this view yet.';
    return plugin.previewPlaceholder || 'Preview is not available in this view yet.';
  }

  function normalizePageNumber(pageNumber) {
    var parsed = parseInt(pageNumber, 10);
    return parsed > 0 ? parsed : 1;
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
      supportsRuntimeRender: plugin.preview.supportsRuntimeRender !== false,
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
      supportsRuntimeRender: plugin.export.supportsRuntimeRender !== false,
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

  function buildPreviewConfig(kind, cacheFolderName, outputExtension, outputFormat, suffixBuilder) {
    return {
      kind: kind,
      cacheFolderName: cacheFolderName,
      outputExtension: outputExtension,
      outputFormat: outputFormat,
      supportsRuntimeRender: true,
      buildSuffix: suffixBuilder || function () { return ''; },
    };
  }

  function buildExportConfig(outputExtension, outputFormat, suffixBuilder) {
    return {
      outputExtension: outputExtension,
      outputFormat: outputFormat,
      supportsRuntimeRender: true,
      buildSuffix: suffixBuilder || function () { return ''; },
    };
  }

  function pageSuffix(prefix) {
    return function (pageNumber) { return prefix + normalizePageNumber(pageNumber); };
  }

  register({
    id: 'drawio',
    label: 'Draw.io file',
    emoji: '&#128202;',
    assetType: 'diagram',
    editorKind: 'drawio',
    rendererRequirements: [{ id: 'drawio' }],
    previewPlaceholder: 'Draw.io preview is rendered through the draw.io CLI when available.',
    preview: buildPreviewConfig('diagram', 'drawio-cache', 'png', 'png'),
    export: buildExportConfig('svg', 'svg'),
    matches: function (normalized) {
      return normalized.slice(-7) === '.drawio' || normalized.slice(-4) === '.dio';
    },
  });

  register({
    id: 'excalidraw',
    label: 'Excalidraw file',
    emoji: '&#127912;',
    assetType: 'diagram',
    editorKind: 'excalidraw',
    rendererRequirements: [{ id: 'node' }, { id: 'excalidraw-assets' }],
    previewPlaceholder: 'Excalidraw preview is rendered through the integrated export worker when available.',
    preview: buildPreviewConfig('diagram', 'excalidraw-cache', 'svg', 'svg'),
    export: buildExportConfig('svg', 'svg'),
    matches: function (normalized) {
      return normalized.endsWith('.excalidraw.json') ||
        normalized.endsWith('.excalidraw') ||
        normalized.endsWith('.excalidraw.svg');
    },
  });

  register({
    id: 'xlsx',
    label: 'Spreadsheet file',
    emoji: '&#128200;',
    assetType: 'document',
    rendererRequirements: [{ id: 'soffice' }],
    previewPlaceholder: 'Spreadsheet preview is rendered through LibreOffice into a sheet image.',
    preview: buildPreviewConfig('spreadsheet', 'xlsx-cache', 'png', 'png', pageSuffix('-s')),
    export: buildExportConfig('png', 'png', pageSuffix('-s')),
    matches: function (normalized) {
      return /\.(xlsx|xls|ods)$/.test(normalized);
    },
  });

  register({
    id: 'csv',
    label: 'CSV table',
    emoji: '&#128451;',
    assetType: 'document',
    editorKind: 'plaintext',
    rendererRequirements: [{
      id: 'csv-builtin',
      label: 'Built-in CSV Renderer',
      available: true,
      version: null,
      path: null,
      details: 'No external CLI is required for CSV/TSV table rendering.'
    }],
    previewPlaceholder: 'CSV preview is rendered into an SVG table for board view and export compatibility.',
    preview: buildPreviewConfig('table', 'csv-cache', 'svg', 'svg', pageSuffix('-p')),
    export: buildExportConfig('svg', 'svg', pageSuffix('-p')),
    matches: function (normalized) {
      return normalized.endsWith('.csv');
    },
  });

  register({
    id: 'tsv',
    label: 'TSV table',
    emoji: '&#128451;',
    assetType: 'document',
    editorKind: 'plaintext',
    rendererRequirements: [{
      id: 'csv-builtin',
      label: 'Built-in CSV Renderer',
      available: true,
      version: null,
      path: null,
      details: 'No external CLI is required for CSV/TSV table rendering.'
    }],
    previewPlaceholder: 'TSV preview is rendered into an SVG table for board view and export compatibility.',
    preview: buildPreviewConfig('table', 'tsv-cache', 'svg', 'svg', pageSuffix('-p')),
    export: buildExportConfig('svg', 'svg', pageSuffix('-p')),
    matches: function (normalized) {
      return /\.(tsv|tab)$/.test(normalized);
    },
  });

  register({
    id: 'pdf',
    label: 'PDF file',
    emoji: '&#128196;',
    assetType: 'document',
    rendererRequirements: [{ id: 'pdftoppm' }],
    previewPlaceholder: 'PDF preview uses the built-in viewer. Exports can render a page image for compatibility.',
    preview: {
      kind: 'pdf',
      supportsRuntimeRender: false,
    },
    export: buildExportConfig('png', 'png', pageSuffix('-p')),
    matches: function (normalized) {
      return normalized.slice(-4) === '.pdf';
    },
  });

  register({
    id: 'pptx',
    label: 'Presentation file',
    emoji: '&#128202;',
    assetType: 'document',
    rendererRequirements: [{ id: 'soffice' }, { id: 'pdftoppm' }],
    previewPlaceholder: 'Presentation preview is rendered in the browser or through LibreOffice into page images.',
    preview: buildPreviewConfig('document', 'document-cache', 'png', 'png', pageSuffix('-p')),
    export: buildExportConfig('png', 'png', pageSuffix('-p')),
    matches: function (normalized) {
      return /\.(ppt|pptx|odp)$/.test(normalized);
    },
  });

  register({
    id: 'document',
    label: 'Document file',
    emoji: '&#128196;',
    assetType: 'document',
    rendererRequirements: [{ id: 'soffice' }, { id: 'pdftoppm' }],
    previewPlaceholder: 'Document preview is rendered through LibreOffice and Poppler into page images.',
    preview: buildPreviewConfig('document', 'document-cache', 'png', 'png', pageSuffix('-p')),
    export: buildExportConfig('png', 'png', pageSuffix('-p')),
    matches: function (normalized) {
      return /\.(doc|docx|odt|rtf)$/.test(normalized);
    },
  });

  register({
    id: 'epub',
    label: 'EPUB file',
    emoji: '&#128218;',
    assetType: 'document',
    rendererRequirements: [{ id: 'mutool' }],
    previewPlaceholder: 'EPUB preview is rendered through MuPDF into page images.',
    preview: buildPreviewConfig('epub', 'epub-cache', 'png', 'png', pageSuffix('-p')),
    export: buildExportConfig('png', 'png', pageSuffix('-p')),
    matches: function (normalized) {
      return normalized.slice(-5) === '.epub';
    },
  });

  register({
    id: 'plaintext',
    label: 'Text file',
    emoji: '&#128196;',
    assetType: 'document',
    editorKind: 'plaintext',
    previewPlaceholder: 'Text file preview is rendered into an SVG page for board view and export compatibility.',
    preview: buildPreviewConfig('text', 'text-cache', 'svg', 'svg', pageSuffix('-p')),
    export: buildExportConfig('svg', 'svg', pageSuffix('-p')),
    matches: function (normalized) {
      return /\.(txt|text|log|cfg|ini|conf)$/.test(normalized);
    },
  });

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
  };
})();

if (typeof window !== 'undefined') {
  window.LexeraFileFormatRegistry = LexeraFileFormatRegistry;
}
