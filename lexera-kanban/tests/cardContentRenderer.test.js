import { beforeAll, describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

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

function buildTagStyledLineHtml(tag, innerHtml, _lineStyleSource, options = {}) {
  const attrs = [];
  if (options.className) attrs.push('class="' + escapeAttr(options.className) + '"');
  if (options.styleText) attrs.push('style="' + escapeAttr(options.styleText) + '"');
  if (options.attrs) attrs.push(String(options.attrs));
  if (options.selfClosing) return '<' + tag + (attrs.length ? ' ' + attrs.join(' ') : '') + '>';
  return '<' + tag + (attrs.length ? ' ' + attrs.join(' ') : '') + '>' + (innerHtml || '') + '</' + tag + '>';
}

function createInlineHelpers(htmlMode) {
  const InlineRenderer = loadIIFE('render/inlineRenderer.js', 'LexeraInlineRenderer', {
    window: {},
  });

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
    getHtmlContentRenderMode: () => htmlMode,
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

function createCardContentRenderer(htmlMode = 'html') {
  const CardContentRenderer = loadIIFE('render/cardContentRenderer.js', 'LexeraCardContentRenderer', {
    window: {},
  });
  const inlineHelpers = createInlineHelpers(htmlMode);
  CardContentRenderer.init({
    escapeHtml,
    escapeAttr,
    buildTagStyledLineHtml,
    wrapRenderedLineBlockHtml: (html) => html,
    DiagramRegistry: null,
    getActiveBoardId: () => '',
    getInlineRendererHelpers: () => inlineHelpers,
  });
  return CardContentRenderer;
}

let CardContentRenderer;

beforeAll(() => {
  CardContentRenderer = createCardContentRenderer('html');
});

describe('cardContentRenderer raw html blocks', () => {
  it('keeps raw iframe wrapper markup together as one block', () => {
    const source = [
      "<div style='position: relative; padding: 0px; height: 650px; overflow: hidden;'>",
      "  <iframe src='https://example.com/embed' style='position: absolute; top: 0; left: 0; width:100%; height:650px'></iframe>",
      '</div>'
    ].join('\n');

    const html = CardContentRenderer.renderCardContent(source, 'board-1', {}, {});

    expect((html.match(/md-raw-html-block/g) || []).length).toBe(1);
    expect(html).toContain("<div style='position: relative; padding: 0px; height: 650px; overflow: hidden;'>");
    expect(html).toContain("<iframe src='https://example.com/embed' style='position: absolute; top: 0; left: 0; width:100%; height:650px'></iframe>");
  });
});
