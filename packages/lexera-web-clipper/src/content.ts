import { MESSAGE_TYPES } from './shared/messages';
import {
  captureNodeMarkdown,
  captureHtmlMarkdown,
  captureSelectionMarkdown,
} from './shared/documentMarkdown';
import {
  dedupeWebClipperFeedCandidates,
  type WebClipperCollectedPageContext,
  type WebClipperFeedCandidate,
} from '../../shared/src/webClipper';

declare const browser: any;
declare const chrome: any;

function getNamespace(): any {
  if (typeof globalThis.browser !== 'undefined') return globalThis.browser;
  if (typeof globalThis.chrome !== 'undefined') return globalThis.chrome;
  if (typeof browser !== 'undefined') return browser;
  if (typeof chrome !== 'undefined') return chrome;
  throw new Error('Browser extension APIs are unavailable');
}

const extensionApi = getNamespace();

function readMetaContent(selector: string): string {
  const el = document.querySelector(selector) as HTMLMetaElement | null;
  return el?.content?.trim() || '';
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function pickLeadImage(root: ParentNode): { src: string; alt: string } | null {
  const candidates = Array.from(root.querySelectorAll('img'))
    .map((img) => ({
      src: (() => {
        const raw = (img.getAttribute('src') || '').trim();
        if (!raw) return '';
        try {
          return new URL(raw, document.baseURI).href;
        } catch (_error) {
          return raw;
        }
      })(),
      alt: (img.getAttribute('alt') || '').trim(),
      score: ((img.naturalWidth || 0) * (img.naturalHeight || 0)),
    }))
    .filter((img) => img.src);

  if (candidates.length === 0) return null;
  candidates.sort((left, right) => right.score - left.score);
  return {
    src: candidates[0].src,
    alt: candidates[0].alt,
  };
}

function extractPrimaryText(root: ParentNode | null): string {
  if (!root) return '';
  const blocks = Array.from(root.querySelectorAll('h1, h2, h3, p, li, blockquote, pre'))
    .map((node) => normalizeText((node.textContent || '').trim()))
    .filter(Boolean);
  return normalizeText(blocks.join('\n\n'));
}

function pickArticleRoot(): HTMLElement | null {
  const direct = document.querySelector('article, main, [role="main"]') as HTMLElement | null;
  if (direct) return direct;

  const candidates = Array.from(document.querySelectorAll('section, div'))
    .map((node) => ({
      node: node as HTMLElement,
      length: normalizeText((node.textContent || '').trim()).length,
    }))
    .filter((candidate) => candidate.length > 500);

  candidates.sort((left, right) => right.length - left.length);
  return candidates[0]?.node || document.body;
}

const READER_STRIP_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'form',
  'button',
  'input',
  'select',
  'textarea',
  'nav',
  'aside',
  'footer',
  '[role="navigation"]',
  '[role="search"]',
  '[aria-hidden="true"]',
  '[hidden]',
  '.advertisement',
  '.advertising',
  '.ads',
  '.ad',
  '.promo',
  '.promoted',
  '.share',
  '.social',
  '.sidebar',
  '.related',
  '.recommend',
  '.comments',
  '.comment',
  '.cookie',
  '.consent',
] as const;

function pruneReaderRoot(root: HTMLElement): void {
  root.querySelectorAll(READER_STRIP_SELECTORS.join(', ')).forEach((node) => node.remove());

  Array.from(root.querySelectorAll('*')).forEach((element) => {
    const idAndClass = `${element.id || ''} ${element.className || ''}`.toLowerCase();
    const suspicious = /(advert|promo|related|recommend|comment|share|cookie|consent|sidebar|footer|header)/.test(idAndClass);
    const hasMedia = Boolean(element.querySelector('img, picture, video, audio, figure'));
    const textLength = normalizeText(element.textContent || '').length;
    if (suspicious && !hasMedia && textLength < 300) {
      element.remove();
      return;
    }
    if (
      !hasMedia
      && element.children.length > 0
      && textLength === 0
      && !/^h[1-6]$/i.test(element.tagName)
    ) {
      element.remove();
    }
  });
}

function buildReaderRoot(articleRoot: HTMLElement | null): HTMLElement | null {
  if (!articleRoot) return null;
  const clone = articleRoot.cloneNode(true) as HTMLElement;
  pruneReaderRoot(clone);
  const textLength = normalizeText(clone.textContent || '').length;
  if (textLength < 120) {
    return articleRoot;
  }
  return clone;
}

function detectFeedCandidates(): WebClipperFeedCandidate[] {
  const candidates: WebClipperFeedCandidate[] = [];
  const pageUrl = window.location.href.replace(/\/+$/, '');

  document.querySelectorAll('link[rel~="alternate"]').forEach((node) => {
    const element = node as HTMLLinkElement;
    const type = (element.type || '').trim().toLowerCase();
    if (!/(rss|atom|xml)/.test(type)) return;
    const href = (element.href || '').trim();
    if (!href) return;
    candidates.push({
      id: href,
      url: href,
      label: (element.title || '').trim() || 'Feed',
      kind: type.includes('atom') ? 'atom' : 'rss',
      sourceUrl: pageUrl,
    });
  });

  if (/reddit\.com$/i.test(window.location.hostname) && !/\.rss(?:$|[?#])/i.test(pageUrl)) {
    candidates.push({
      id: `${pageUrl}.rss`,
      url: `${pageUrl}.rss`,
      label: 'Reddit RSS',
      kind: 'rss',
      sourceUrl: pageUrl,
    });
  }

  return dedupeWebClipperFeedCandidates(candidates);
}

function collectPageContext(): WebClipperCollectedPageContext {
  const selectionText = normalizeText(window.getSelection?.()?.toString?.() || '');
  const selectionCapture = captureSelectionMarkdown(window.getSelection?.() || null, {
    baseUrl: window.location.href,
  });
  const articleRoot = pickArticleRoot();
  const readerRoot = buildReaderRoot(articleRoot);
  const articleCapture = captureNodeMarkdown(articleRoot, { baseUrl: window.location.href });
  const pageCapture = captureNodeMarkdown(document.body, { baseUrl: window.location.href });
  const readerCapture = readerRoot
    ? captureNodeMarkdown(readerRoot, { baseUrl: window.location.href })
    : captureHtmlMarkdown('', { baseUrl: window.location.href });
  const leadImage = pickLeadImage(readerRoot || articleRoot || document);
  const excerpt = normalizeText(
    readMetaContent('meta[property="og:description"]')
    || readMetaContent('meta[name="description"]')
    || '',
  );

  const websiteContext = {
    url: window.location.href,
    sourceType: 'website' as const,
    sourceLabel: 'Website',
    title: normalizeText(
      readMetaContent('meta[property="og:title"]')
      || document.title
      || '',
    ),
    siteName: normalizeText(
      readMetaContent('meta[property="og:site_name"]')
      || window.location.hostname
      || '',
    ),
    excerpt,
    selectionText,
    selectionMarkdown: selectionCapture.markdown,
    articleText: extractPrimaryText(articleRoot),
    articleMarkdown: articleCapture.markdown,
    pageText: normalizeText(document.body?.innerText || ''),
    pageMarkdown: pageCapture.markdown,
    imageUrl: leadImage?.src || '',
    imageAlt: leadImage?.alt || '',
    capturedAt: new Date().toISOString(),
    assets: [
      ...selectionCapture.assets,
      ...articleCapture.assets,
      ...pageCapture.assets,
    ],
  };

  const readerText = extractPrimaryText(readerRoot || articleRoot);
  const readerContext = normalizeText(readerCapture.markdown || readerText)
    ? {
        ...websiteContext,
        sourceType: 'reader' as const,
        sourceLabel: 'Reader',
        excerpt: excerpt || trimReaderExcerpt(readerText),
        articleText: readerText || websiteContext.articleText,
        articleMarkdown: readerCapture.markdown || websiteContext.articleMarkdown,
        pageText: readerText || websiteContext.pageText,
        pageMarkdown: readerCapture.markdown || websiteContext.articleMarkdown,
        selectionText: selectionText || readerText,
        selectionMarkdown: selectionCapture.markdown || readerCapture.markdown,
        assets: [
          ...selectionCapture.assets,
          ...readerCapture.assets,
        ],
      }
    : undefined;

  return {
    website: websiteContext,
    reader: readerContext,
    feedCandidates: detectFeedCandidates(),
  };
}

function trimReaderExcerpt(value: string): string {
  return normalizeText(value).slice(0, 280).trim();
}

extensionApi.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (value: any) => void) => {
  if (message?.type !== MESSAGE_TYPES.contentCollect) {
    return undefined;
  }

  try {
    const collection = collectPageContext();
    sendResponse({
      ok: true,
      collection,
      context: collection.reader || collection.website,
    });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
});
