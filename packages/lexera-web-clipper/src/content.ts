import { MESSAGE_TYPES } from './shared/messages';

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

function collectPageContext(): Record<string, unknown> {
  const selectionText = normalizeText(window.getSelection?.()?.toString?.() || '');
  const articleRoot = pickArticleRoot();
  const leadImage = pickLeadImage(articleRoot || document);
  const excerpt = normalizeText(
    readMetaContent('meta[property="og:description"]')
    || readMetaContent('meta[name="description"]')
    || '',
  );

  return {
    url: window.location.href,
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
    articleText: extractPrimaryText(articleRoot),
    pageText: normalizeText(document.body?.innerText || ''),
    imageUrl: leadImage?.src || '',
    imageAlt: leadImage?.alt || '',
    capturedAt: new Date().toISOString(),
  };
}

extensionApi.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: (value: any) => void) => {
  if (message?.type !== MESSAGE_TYPES.contentCollect) {
    return undefined;
  }

  try {
    sendResponse({ ok: true, context: collectPageContext() });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
});
