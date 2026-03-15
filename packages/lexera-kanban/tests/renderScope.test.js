import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadRenderScopeHelpers() {
  const source = readFileSync(resolve(srcDir, 'app.js'), 'utf-8');
  const lines = source.split('\n');

  function findLine(pattern) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(pattern)) return i + 1;
    }
    throw new Error('Could not find: ' + pattern);
  }

  function extractRegion(startPattern, endPattern) {
    const startLine = findLine(startPattern);
    const endLine = findLine(endPattern);
    return lines.slice(startLine - 1, endLine - 1).join('\n');
  }

  const wrappedSource = `
    ${extractRegion('function renderTitleInline(', 'function renderTable(')}
    ${extractRegion('function renderInline(', 'function getTemporalTagType(')}

    return {
      renderTitleInline,
      renderInline
    };
  `;

  function stashRenderedHtmlToken(htmlTokens, html) {
    const token = '@@HTMLTOKEN' + htmlTokens.length + '@@';
    htmlTokens.push(String(html || ''));
    return token;
  }

  function restoreRenderedHtmlTokens(text, htmlTokens) {
    let restored = String(text || '');
    for (let i = 0; i < htmlTokens.length; i++) {
      restored = restored.replace('@@HTMLTOKEN' + i + '@@', htmlTokens[i]);
    }
    return restored;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  const factory = new Function(
    'activeBoardId',
    'extractAngleBracketAutolinks',
    'stripHtmlComments',
    'escapeHtml',
    'stashRenderedHtmlToken',
    'restoreRenderedHtmlTokens',
    'renderIncludeDirectiveHtml',
    'parseMarkdownTarget',
    'escapeAttr',
    'renderBoardFileLinkHtml',
    'buildAngleBracketAutolinkHtml',
    'decodeHtmlEntities',
    'renderWikiLinkHtml',
    'getTagColor',
    'renderTemporalTagHtml',
    'renderEmojiShortcodes',
    'getHtmlContentRenderMode',
    'parseLocalFileReference',
    'normalizeMarkdownAttrValue',
    'parseMarkdownImageAttributes',
    'getFileExtension',
    'isExternalHttpUrl',
    'getExternalEmbedConfig',
    'getInlineFileEmbedExtension',
    'getMediaCategory',
    'inferExternalMediaCategoryFromUrl',
    'LexeraApi',
    'getMarkdownMediaStyleAttr',
    'getEmbedPreviewKind',
    'renderInlineFileEmbedHtml',
    'getFileEmbedChipHtml',
    'getDisplayFileNameFromPath',
    'isRenderedSpecialPreviewKind',
    'applyAbbreviationsToHtml',
    wrappedSource
  );

  return factory(
    '',
    (text) => ({ text: String(text || ''), links: [] }),
    (text) => String(text || ''),
    escapeHtml,
    stashRenderedHtmlToken,
    restoreRenderedHtmlTokens,
    (rawPath) => '<include path="' + escapeAttr(rawPath) + '"></include>',
    (raw) => ({ path: String(raw || '').trim(), title: '' }),
    escapeAttr,
    (href, _boardId, label) => '<board-link href="' + escapeAttr(href) + '">' + escapeHtml(label) + '</board-link>',
    (href) => '<a href="' + escapeAttr(href) + '">' + escapeHtml(href) + '</a>',
    (value) => String(value || ''),
    (_documentName, label) => '<wiki-link>' + escapeHtml(label) + '</wiki-link>',
    () => '#336699',
    (tag) => '<time-tag>' + escapeHtml(tag) + '</time-tag>',
    (value) => String(value || ''),
    () => 'text',
    (path) => ({ path: String(path || ''), pageNumber: null }),
    (value) => String(value || ''),
    () => ({ values: {} }),
    (path) => {
      const parts = String(path || '').split('.');
      return parts.length > 1 ? parts.pop().toLowerCase() : '';
    },
    () => false,
    () => null,
    () => '',
    (ext) => (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext) ? 'image' : 'unknown'),
    () => null,
    { fileUrl: (boardId, path) => '/file/' + boardId + '/' + path },
    () => '',
    () => '',
    () => '<inline-file></inline-file>',
    () => '<file-chip></file-chip>',
    (path) => String(path || '').split('/').pop() || '',
    () => false,
    (html) => html
  );
}

let RenderScopeHelpers;

beforeAll(() => {
  RenderScopeHelpers = loadRenderScopeHelpers();
});

describe('render scopes', () => {
  it('keeps include syntax literal in titles unless explicitly enabled for column headers', () => {
    const literal = RenderScopeHelpers.renderTitleInline('Title !!!include(parts.md)!!!', 'board-1');
    expect(literal).toContain('!!!include(parts.md)!!!');
    expect(literal).not.toContain('<include path=');

    const header = RenderScopeHelpers.renderTitleInline(
      'Title !!!include(parts.md)!!!',
      'board-1',
      { allowIncludeDirectives: true }
    );
    expect(header).toContain('<include path="parts.md"></include>');
  });

  it('keeps embed markdown literal in titles, including column headers', () => {
    const title = RenderScopeHelpers.renderTitleInline('Title ![Preview](image.png)', 'board-1');
    expect(title).toContain('![Preview](image.png)');
    expect(title).not.toContain('embed-container');
    expect(title).not.toContain('<board-link');

    const columnHeader = RenderScopeHelpers.renderTitleInline(
      'Title ![Preview](image.png)',
      'board-1',
      { allowIncludeDirectives: true }
    );
    expect(columnHeader).toContain('![Preview](image.png)');
    expect(columnHeader).not.toContain('embed-container');
    expect(columnHeader).not.toContain('<board-link');
  });

  it('renders embeds in card content but keeps include syntax literal there', () => {
    const includeText = RenderScopeHelpers.renderInline('!!!include(parts.md)!!!', 'board-1', {});
    expect(includeText).toContain('!!!include(parts.md)!!!');
    expect(includeText).not.toContain('<include path=');

    const embedHtml = RenderScopeHelpers.renderInline('![Preview](image.png)', 'board-1', {});
    expect(embedHtml).toContain('embed-container');
    expect(embedHtml).toContain('/file/board-1/image.png');
  });
});
