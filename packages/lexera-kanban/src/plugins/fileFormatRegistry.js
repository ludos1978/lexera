const LexeraFileFormatRegistry = (function () {
  var plugins = [];

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

  register({
    id: 'drawio',
    label: 'Draw.io file',
    emoji: '&#128202;',
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
    previewPlaceholder: 'Spreadsheet preview is rendered through LibreOffice into a sheet image.',
    preview: buildPreviewConfig('spreadsheet', 'xlsx-cache', 'png', 'png', function (pageNumber) {
      return '-s' + normalizePageNumber(pageNumber);
    }),
    export: buildExportConfig('png', 'png', function (pageNumber) {
      return '-s' + normalizePageNumber(pageNumber);
    }),
    matches: function (normalized) {
      return /\.(xlsx|xls|ods)$/.test(normalized);
    },
  });

  register({
    id: 'csv',
    label: 'CSV table',
    emoji: '&#128451;',
    previewPlaceholder: 'CSV preview is rendered into an SVG table for board view and export compatibility.',
    preview: buildPreviewConfig('table', 'csv-cache', 'svg', 'svg', function (pageNumber) {
      return '-p' + normalizePageNumber(pageNumber);
    }),
    export: buildExportConfig('svg', 'svg', function (pageNumber) {
      return '-p' + normalizePageNumber(pageNumber);
    }),
    matches: function (normalized) {
      return normalized.endsWith('.csv');
    },
  });

  register({
    id: 'pdf',
    label: 'PDF file',
    emoji: '&#128196;',
    previewPlaceholder: 'PDF preview uses the built-in viewer. Exports can render a page image for compatibility.',
    preview: {
      kind: 'pdf',
      supportsRuntimeRender: false,
    },
    export: buildExportConfig('png', 'png', function (pageNumber) {
      return '-p' + normalizePageNumber(pageNumber);
    }),
    matches: function (normalized) {
      return normalized.slice(-4) === '.pdf';
    },
  });

  register({
    id: 'document',
    label: 'Document file',
    emoji: '&#128196;',
    previewPlaceholder: 'Document preview is rendered through LibreOffice and Poppler into page images.',
    preview: buildPreviewConfig('document', 'document-cache', 'png', 'png', function (pageNumber) {
      return '-p' + normalizePageNumber(pageNumber);
    }),
    export: buildExportConfig('png', 'png', function (pageNumber) {
      return '-p' + normalizePageNumber(pageNumber);
    }),
    matches: function (normalized) {
      return /\.(doc|docx|odt|ppt|pptx|odp)$/.test(normalized);
    },
  });

  register({
    id: 'epub',
    label: 'EPUB file',
    emoji: '&#128218;',
    previewPlaceholder: 'EPUB preview is rendered through MuPDF into page images.',
    preview: buildPreviewConfig('epub', 'epub-cache', 'png', 'png', function (pageNumber) {
      return '-p' + normalizePageNumber(pageNumber);
    }),
    export: buildExportConfig('png', 'png', function (pageNumber) {
      return '-p' + normalizePageNumber(pageNumber);
    }),
    matches: function (normalized) {
      return normalized.slice(-5) === '.epub';
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
    supportsExportReplacement: supportsExportReplacement,
    normalizeFilePathForDetection: normalizeFilePathForDetection,
  };
})();

if (typeof window !== 'undefined') {
  window.LexeraFileFormatRegistry = LexeraFileFormatRegistry;
}
