var LexeraArchiveFormatting = (function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // Default dependency stubs (overridden via createArchiveFormattingHelpers)
  // ═══════════════════════════════════════════════════════════════════════════

  function defaultGetFileNameFromPath(path) {
    var normalized = String(path || '').replace(/\\/g, '/');
    if (!normalized) return '';
    var idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(idx + 1) : normalized;
  }

  function defaultGetDirNameFromPath(path) {
    var normalized = String(path || '').replace(/\\/g, '/');
    if (!normalized) return '';
    var idx = normalized.lastIndexOf('/');
    return idx > 0 ? normalized.slice(0, idx) : '';
  }

  function defaultStripInternalHiddenTags(text) {
    return String(text || '')
      .replace(/\s*#hidden-internal-(?:incoming|parked|archived|deleted)\b/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  function defaultStripLayoutTags(text) {
    return String(text || '');
  }

  function defaultStripHtmlComments(text) {
    return String(text || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Archive file path helpers
  // ═══════════════════════════════════════════════════════════════════════════

  function buildArchiveFileNameFromBoardPath(boardFilePath, deps) {
    var getFileName = (deps && deps.getFileNameFromPath) || defaultGetFileNameFromPath;
    var fileName = getFileName(boardFilePath);
    if (!fileName) return 'archive.md';
    var extMatch = fileName.match(/(\.[^.]+)$/);
    var ext = extMatch ? extMatch[1] : '.md';
    var stem = extMatch ? fileName.slice(0, -ext.length) : fileName;
    return stem + '-archive' + ext;
  }

  function buildArchiveRelativePathFromBoardPath(boardFilePath, deps) {
    return buildArchiveFileNameFromBoardPath(boardFilePath, deps);
  }

  function buildArchiveFilePathFromBoardPath(boardFilePath, deps) {
    var getDirName = (deps && deps.getDirNameFromPath) || defaultGetDirNameFromPath;
    var filename = buildArchiveFileNameFromBoardPath(boardFilePath, deps);
    var dir = getDirName(boardFilePath);
    return dir ? (dir + '/' + filename) : filename;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Archive markdown formatting
  // ═══════════════════════════════════════════════════════════════════════════

  function buildArchiveFileHeader() {
    return '---\narchived: true\n---\n\n';
  }

  function buildArchiveTagValue(dateValue) {
    var now = dateValue instanceof Date ? dateValue : new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    var hours = String(now.getHours()).padStart(2, '0');
    var minutes = String(now.getMinutes()).padStart(2, '0');
    var seconds = String(now.getSeconds()).padStart(2, '0');
    return '#archived !' + year + '.' + month + '.' + day + ' !' + hours + ':' + minutes + ':' + seconds;
  }

  function buildArchiveSectionHeading(level, label, title, archiveTag) {
    var depth = isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
    var hashes = '';
    for (var i = 0; i < depth; i++) hashes += '#';
    var heading = hashes + ' Archived ' + label;
    if (title) heading += ': ' + title;
    if (archiveTag) heading += ' ' + archiveTag;
    return heading;
  }

  function cleanArchiveHeadingTitle(title, options, deps) {
    options = options || {};
    deps = deps || {};
    var fallback = options.fallback || '';
    var stripHidden = deps.stripInternalHiddenTags || defaultStripInternalHiddenTags;
    var stripLayout = deps.stripLayoutTags || defaultStripLayoutTags;
    var stripComments = deps.stripHtmlComments || defaultStripHtmlComments;
    var cleaned = stripHidden(title || '');
    cleaned = options.isColumn ? stripLayout(cleaned) : stripComments(cleaned);
    cleaned = String(cleaned || '').replace(/\s+/g, ' ').trim();
    return cleaned || fallback;
  }

  function formatArchivedCardMarkdown(card, archiveTag, deps) {
    var stripHidden = (deps && deps.stripInternalHiddenTags) || defaultStripInternalHiddenTags;
    var text = stripHidden(card && card.content ? card.content : '');
    var lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    while (lines.length > 1 && !String(lines[lines.length - 1] || '').trim()) lines.pop();
    if (!lines.length) lines = [''];

    var firstLine = String(lines[0] || '').trim();
    var checked = !!(card && card.checked);
    var checkboxMatch = firstLine.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/);
    if (checkboxMatch) {
      checked = checkboxMatch[1].toLowerCase() === 'x';
      firstLine = checkboxMatch[2] || '';
    }
    firstLine = firstLine.trim() || '(untitled card)';

    var rendered = '- [' + (checked ? 'x' : ' ') + '] ' + firstLine;
    if (archiveTag) rendered += ' ' + archiveTag;

    for (var i = 1; i < lines.length; i++) {
      rendered += '\n    ' + stripHidden(lines[i] || '');
    }
    return rendered;
  }

  function buildArchiveMarkdownForColumn(column, archiveTag, headingLevel, deps) {
    var cleanTitle = cleanArchiveHeadingTitle(column && column.title, {
      isColumn: true,
      fallback: 'Untitled Column'
    }, deps);
    var lines = [buildArchiveSectionHeading(headingLevel || 2, 'Column', cleanTitle, archiveTag), ''];
    var cards = column && Array.isArray(column.cards) ? column.cards : [];
    for (var i = 0; i < cards.length; i++) {
      lines.push(formatArchivedCardMarkdown(cards[i], archiveTag, deps));
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function buildArchiveMarkdownForStack(stack, archiveTag, headingLevel, deps) {
    var cleanTitle = cleanArchiveHeadingTitle(stack && stack.title, { fallback: 'Untitled Stack' }, deps);
    var sections = [buildArchiveSectionHeading(headingLevel || 2, 'Stack', cleanTitle, archiveTag)];
    var columns = stack && Array.isArray(stack.columns) ? stack.columns : [];
    if (columns.length > 0) {
      sections.push('');
      for (var i = 0; i < columns.length; i++) {
        sections.push(buildArchiveMarkdownForColumn(columns[i], archiveTag, (headingLevel || 2) + 1, deps));
      }
    }
    return sections.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function buildArchiveMarkdownForRow(row, archiveTag, headingLevel, deps) {
    var cleanTitle = cleanArchiveHeadingTitle(row && row.title, { fallback: 'Untitled Row' }, deps);
    var sections = [buildArchiveSectionHeading(headingLevel || 1, 'Row', cleanTitle, archiveTag)];
    var stacks = row && Array.isArray(row.stacks) ? row.stacks : [];
    if (stacks.length > 0) {
      sections.push('');
      for (var i = 0; i < stacks.length; i++) {
        sections.push(buildArchiveMarkdownForStack(stacks[i], archiveTag, (headingLevel || 1) + 1, deps));
      }
    }
    return sections.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function buildArchiveMarkdownForHiddenItems(items, options, deps) {
    options = options || {};
    var list = Array.isArray(items) ? items : [];
    if (list.length === 0) return '';

    var archiveTag = buildArchiveTagValue(options.now);
    var sections = [];
    var cards = [];

    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry || !entry.kind || !entry.data) continue;
      if (entry.kind === 'card') {
        cards.push(entry.data);
        continue;
      }
      if (entry.kind === 'row') {
        sections.push(buildArchiveMarkdownForRow(entry.data, archiveTag, 1, deps));
      } else if (entry.kind === 'stack') {
        sections.push(buildArchiveMarkdownForStack(entry.data, archiveTag, 2, deps));
      } else if (entry.kind === 'column') {
        sections.push(buildArchiveMarkdownForColumn(entry.data, archiveTag, 2, deps));
      }
    }

    if (cards.length > 0) {
      var cardLines = ['## Archived Cards', ''];
      for (var c = 0; c < cards.length; c++) {
        cardLines.push(formatArchivedCardMarkdown(cards[c], archiveTag, deps));
      }
      sections.push(cardLines.join('\n').trim());
    }

    return sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function appendArchivedItemsToArchiveContent(existingContent, archivedContent) {
    var incoming = String(archivedContent || '').replace(/\r\n/g, '\n').trim();
    if (!incoming) return String(existingContent || '');

    var existing = String(existingContent || '').replace(/\r\n/g, '\n');
    if (!existing.trim()) return buildArchiveFileHeader() + incoming + '\n';

    var yamlMatch = existing.match(/^---\n[\s\S]*?\n---\n?/);
    if (yamlMatch) {
      var yamlHeader = yamlMatch[0];
      var restOfContent = existing.slice(yamlHeader.length).trim();
      return yamlHeader + (restOfContent ? restOfContent + '\n\n' : '') + incoming + '\n';
    }
    return existing.replace(/\s+$/, '') + '\n\n' + incoming + '\n';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Factory: create helpers with injected dependencies
  // ═══════════════════════════════════════════════════════════════════════════

  function createArchiveFormattingHelpers(deps) {
    deps = deps || {};
    var resolvedDeps = {
      getFileNameFromPath: typeof deps.getFileNameFromPath === 'function'
        ? deps.getFileNameFromPath : defaultGetFileNameFromPath,
      getDirNameFromPath: typeof deps.getDirNameFromPath === 'function'
        ? deps.getDirNameFromPath : defaultGetDirNameFromPath,
      stripInternalHiddenTags: typeof deps.stripInternalHiddenTags === 'function'
        ? deps.stripInternalHiddenTags : defaultStripInternalHiddenTags,
      stripLayoutTags: typeof deps.stripLayoutTags === 'function'
        ? deps.stripLayoutTags : defaultStripLayoutTags,
      stripHtmlComments: typeof deps.stripHtmlComments === 'function'
        ? deps.stripHtmlComments : defaultStripHtmlComments
    };

    return {
      buildArchiveFileNameFromBoardPath: function (boardFilePath) {
        return buildArchiveFileNameFromBoardPath(boardFilePath, resolvedDeps);
      },
      buildArchiveRelativePathFromBoardPath: function (boardFilePath) {
        return buildArchiveRelativePathFromBoardPath(boardFilePath, resolvedDeps);
      },
      buildArchiveFilePathFromBoardPath: function (boardFilePath) {
        return buildArchiveFilePathFromBoardPath(boardFilePath, resolvedDeps);
      },
      buildArchiveFileHeader: buildArchiveFileHeader,
      buildArchiveTagValue: buildArchiveTagValue,
      buildArchiveSectionHeading: buildArchiveSectionHeading,
      cleanArchiveHeadingTitle: function (title, options) {
        return cleanArchiveHeadingTitle(title, options, resolvedDeps);
      },
      formatArchivedCardMarkdown: function (card, archiveTag) {
        return formatArchivedCardMarkdown(card, archiveTag, resolvedDeps);
      },
      buildArchiveMarkdownForColumn: function (column, archiveTag, headingLevel) {
        return buildArchiveMarkdownForColumn(column, archiveTag, headingLevel, resolvedDeps);
      },
      buildArchiveMarkdownForStack: function (stack, archiveTag, headingLevel) {
        return buildArchiveMarkdownForStack(stack, archiveTag, headingLevel, resolvedDeps);
      },
      buildArchiveMarkdownForRow: function (row, archiveTag, headingLevel) {
        return buildArchiveMarkdownForRow(row, archiveTag, headingLevel, resolvedDeps);
      },
      buildArchiveMarkdownForHiddenItems: function (items, options) {
        return buildArchiveMarkdownForHiddenItems(items, options, resolvedDeps);
      },
      appendArchivedItemsToArchiveContent: appendArchivedItemsToArchiveContent
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════════

  return {
    createArchiveFormattingHelpers: createArchiveFormattingHelpers,
    // Expose static helpers that don't need deps
    buildArchiveFileHeader: buildArchiveFileHeader,
    buildArchiveTagValue: buildArchiveTagValue,
    buildArchiveSectionHeading: buildArchiveSectionHeading,
    appendArchivedItemsToArchiveContent: appendArchivedItemsToArchiveContent
  };
})();
