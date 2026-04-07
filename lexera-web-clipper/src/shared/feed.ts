import {
  extractUrlHostLabel,
  normalizeComparableUrl,
  trimPreview,
  type WebClipperContext,
  type WebClipperFeedCandidate,
} from '@ludos/shared';
import { captureHtmlMarkdown } from './documentMarkdown';

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

function firstElements(root: ParentNode, tagNames: string[]): Element[] {
  for (const tagName of tagNames) {
    const matches = Array.from((root as Document | Element).getElementsByTagName(tagName));
    if (matches.length > 0) return matches;
  }
  return [];
}

function firstText(root: ParentNode, tagNames: string[]): string {
  const nodes = firstElements(root, tagNames);
  for (const node of nodes) {
    const text = normalizeWhitespace(node.textContent || '');
    if (text) return text;
  }
  return '';
}

function firstAttr(root: ParentNode, tagNames: string[], attribute: string): string {
  const nodes = firstElements(root, tagNames);
  for (const node of nodes) {
    const value = normalizeWhitespace(node.getAttribute(attribute) || '');
    if (value) return value;
  }
  return '';
}

function feedTitle(documentRoot: XMLDocument): string {
  const channel = documentRoot.getElementsByTagName('channel')[0];
  if (channel) {
    const title = firstText(channel, ['title']);
    if (title) return title;
  }
  const feed = documentRoot.getElementsByTagName('feed')[0];
  if (feed) {
    const title = firstText(feed, ['title']);
    if (title) return title;
  }
  return '';
}

function entryLink(entry: Element): string {
  const tagName = entry.tagName.toLowerCase();
  if (tagName === 'entry') {
    const links = Array.from(entry.getElementsByTagName('link'));
    for (const link of links) {
      const rel = (link.getAttribute('rel') || '').trim().toLowerCase();
      const href = (link.getAttribute('href') || '').trim();
      if (!href) continue;
      if (!rel || rel === 'alternate') return href;
    }
  }
  return firstText(entry, ['link']) || firstAttr(entry, ['link'], 'href');
}

function findEntryContent(entry: Element): string {
  return firstText(entry, ['content:encoded'])
    || firstText(entry, ['content'])
    || firstText(entry, ['summary'])
    || firstText(entry, ['description']);
}

function stripHtmlText(html: string): string {
  if (!html) return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return normalizeWhitespace(parsed.body.textContent || '');
}

type FeedEnclosure = {
  url: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  label: string;
};

function inferEnclosureKind(typeValue: string, url: string): FeedEnclosure['kind'] {
  const type = (typeValue || '').trim().toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (/\.(png|jpe?g|gif|webp|svg|avif)(?:$|[?#])/i.test(url)) return 'image';
  if (/\.(mp4|mov|webm|mkv)(?:$|[?#])/i.test(url)) return 'video';
  if (/\.(mp3|ogg|wav|m4a|flac)(?:$|[?#])/i.test(url)) return 'audio';
  return 'file';
}

function collectEnclosures(entry: Element): FeedEnclosure[] {
  const enclosures: FeedEnclosure[] = [];

  Array.from(entry.getElementsByTagName('enclosure')).forEach((node) => {
    const url = normalizeWhitespace(node.getAttribute('url') || '');
    if (!url) return;
    enclosures.push({
      url,
      kind: inferEnclosureKind(node.getAttribute('type') || '', url),
      label: normalizeWhitespace(node.getAttribute('title') || '') || 'Attachment',
    });
  });

  ['media:content', 'media:thumbnail'].forEach((tagName) => {
    Array.from(entry.getElementsByTagName(tagName)).forEach((node) => {
      const url = normalizeWhitespace(node.getAttribute('url') || '');
      if (!url) return;
      enclosures.push({
        url,
        kind: inferEnclosureKind(node.getAttribute('type') || node.getAttribute('medium') || '', url),
        label: normalizeWhitespace(node.getAttribute('title') || '') || 'Media',
      });
    });
  });

  const seen = new Set<string>();
  return enclosures.filter((enclosure) => {
    const comparable = normalizeComparableUrl(enclosure.url);
    if (!comparable || seen.has(comparable)) return false;
    seen.add(comparable);
    return true;
  });
}

function enclosureHtml(enclosures: FeedEnclosure[]): string {
  return enclosures.map((enclosure) => {
    const label = escapeHtml(enclosure.label || 'Attachment');
    const url = escapeHtml(enclosure.url);
    if (enclosure.kind === 'image') {
      return `<figure><img src="${url}" alt="${label}"></figure>`;
    }
    if (enclosure.kind === 'video') {
      return `<video controls src="${url}"></video>`;
    }
    if (enclosure.kind === 'audio') {
      return `<audio controls src="${url}"></audio>`;
    }
    return `<p><a href="${url}">${label}</a></p>`;
  }).join('\n');
}

function normalizeFeedBodyHtml(rawHtml: string, enclosures: FeedEnclosure[]): string {
  const normalized = normalizeWhitespace(rawHtml);
  if (normalized && looksLikeHtml(normalized)) {
    return normalized;
  }
  if (normalized) {
    return normalized
      .split(/\n{2,}/)
      .map((block) => `<p>${escapeHtml(block)}</p>`)
      .join('\n');
  }
  return enclosureHtml(enclosures);
}

function chooseFeedEntry(documentRoot: XMLDocument, pageUrl?: string): Element | null {
  const entries = [
    ...Array.from(documentRoot.getElementsByTagName('item')),
    ...Array.from(documentRoot.getElementsByTagName('entry')),
  ];
  if (entries.length === 0) return null;

  const preferredUrl = normalizeComparableUrl(pageUrl);
  if (preferredUrl) {
    const exactMatch = entries.find((entry) => normalizeComparableUrl(entryLink(entry)) === preferredUrl);
    if (exactMatch) return exactMatch;

    const looseMatch = entries.find((entry) => {
      const comparable = normalizeComparableUrl(entryLink(entry));
      return comparable && (comparable.startsWith(preferredUrl) || preferredUrl.startsWith(comparable));
    });
    if (looseMatch) return looseMatch;

    return null;
  }

  return entries[0];
}

function firstImageUrlFromHtml(html: string, fallbackBaseUrl: string): string {
  if (!html) return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const image = parsed.querySelector('img');
  if (!image) return '';
  try {
    return new URL(image.getAttribute('src') || '', fallbackBaseUrl).href;
  } catch (_error) {
    return (image.getAttribute('src') || '').trim();
  }
}

export async function fetchFeedContext(
  candidate: WebClipperFeedCandidate,
  pageUrl?: string,
): Promise<WebClipperContext | null> {
  const response = await fetch(candidate.url, {
    credentials: 'include',
    cache: 'force-cache',
  });
  if (!response.ok) {
    throw new Error(`Feed fetch failed: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.querySelector('parsererror')) {
    throw new Error('Feed response is not valid XML');
  }

  const entry = chooseFeedEntry(parsed, pageUrl || candidate.sourceUrl);
  if (!entry) return null;

  const entryUrl = entryLink(entry) || candidate.sourceUrl || candidate.url;
  const enclosures = collectEnclosures(entry);
  const bodyHtml = normalizeFeedBodyHtml(findEntryContent(entry), enclosures);
  const capture = captureHtmlMarkdown(bodyHtml, {
    baseUrl: entryUrl || candidate.url,
  });
  const bodyText = stripHtmlText(bodyHtml);
  const title = firstText(entry, ['title']) || extractUrlHostLabel(entryUrl);
  const siteName = feedTitle(parsed) || candidate.label || extractUrlHostLabel(candidate.url);
  const excerpt = trimPreview(
    stripHtmlText(firstText(entry, ['summary']) || firstText(entry, ['description']) || bodyHtml),
    280,
  );
  const leadImage = firstImageUrlFromHtml(bodyHtml, entryUrl || candidate.url) || (
    enclosures.find((enclosure) => enclosure.kind === 'image')?.url || ''
  );

  return {
    url: entryUrl,
    sourceType: 'rss',
    sourceLabel: candidate.label || `RSS: ${siteName}`,
    sourceUrl: candidate.sourceUrl || pageUrl || entryUrl,
    feedUrl: candidate.url,
    title,
    siteName,
    excerpt,
    selectionText: bodyText,
    selectionMarkdown: capture.markdown,
    articleText: bodyText,
    articleMarkdown: capture.markdown,
    pageText: bodyText,
    pageMarkdown: capture.markdown,
    imageUrl: leadImage,
    imageAlt: title || 'image',
    capturedAt: new Date().toISOString(),
    assets: capture.assets,
  };
}
