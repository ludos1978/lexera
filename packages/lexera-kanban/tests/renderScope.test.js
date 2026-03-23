import { describe, it, expect, beforeAll } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadRenderScopeHelpers() {
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

  const InlineRenderer = loadIIFE('render/inlineRenderer.js', 'LexeraInlineRenderer');
  return InlineRenderer.createInlineRenderers({
    getActiveBoardId: () => '',
    extractAngleBracketAutolinks: (text) => ({ text: String(text || ''), links: [] }),
    stripHtmlComments: (text) => String(text || ''),
    escapeHtml,
    stashRenderedHtmlToken,
    restoreRenderedHtmlTokens,
    renderIncludeDirectiveHtml: (rawPath) => '<include path="' + escapeAttr(rawPath) + '"></include>',
    parseMarkdownTarget: (raw) => ({ path: String(raw || '').trim(), title: '' }),
    escapeAttr,
    renderBoardFileLinkHtml: (href, _boardId, label) => '<board-link href="' + escapeAttr(href) + '">' + escapeHtml(label) + '</board-link>',
    buildAngleBracketAutolinkHtml: (href) => '<a href="' + escapeAttr(href) + '">' + escapeHtml(href) + '</a>',
    decodeHtmlEntities: (value) => String(value || ''),
    renderWikiLinkHtml: (_documentName, label) => '<wiki-link>' + escapeHtml(label) + '</wiki-link>',
    renderTagChipHtml: (tag) => '<tag-chip>' + escapeHtml(tag) + '</tag-chip>',
    renderTemporalTagHtml: (tag) => '<time-tag>' + escapeHtml(tag) + '</time-tag>',
    renderEmojiShortcodes: (value) => String(value || ''),
    getHtmlContentRenderMode: () => 'text',
    parseLocalFileReference: (path) => ({ path: String(path || ''), pageNumber: null }),
    normalizeMarkdownAttrValue: (value) => String(value || ''),
    parseMarkdownImageAttributes: () => ({ values: {} }),
    getFileExtension: (path) => {
      const parts = String(path || '').split('.');
      return parts.length > 1 ? parts.pop().toLowerCase() : '';
    },
    isExternalHttpUrl: () => false,
    getExternalEmbedConfig: () => null,
    getInlineFileEmbedExtension: () => '',
    getMediaCategory: (ext) => (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext) ? 'image' : 'unknown'),
    inferExternalMediaCategoryFromUrl: () => null,
    LexeraApi: { fileUrl: (boardId, path) => '/file/' + boardId + '/' + path },
    getMarkdownMediaStyleAttr: () => '',
    getEmbedPreviewKind: () => '',
    renderInlineFileEmbedHtml: () => '<inline-file></inline-file>',
    getFileEmbedChipHtml: () => '<file-chip></file-chip>',
    getDisplayFileNameFromPath: (path) => String(path || '').split('/').pop() || '',
    isRenderedSpecialPreviewKind: () => false,
    applyAbbreviationsToHtml: (html) => html,
    sanitizeCssLength: (value) => String(value || '').trim(),
  });
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
