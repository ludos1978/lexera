export const LEXERA_BACKEND_PORT_CANDIDATES = [13080, 8083, 1431, 12080, 14080, 11080, 15080];

export const DEFAULT_WEB_CLIPPER_MODE = 'article';

export type WebClipperMode = 'link' | 'selection' | 'page' | 'article' | 'image';

export type WebClipperTargetSource = 'saved' | 'incoming' | 'fallback';

export interface WebClipperTarget {
  boardId: string;
  colIndex?: number;
  boardTitle?: string;
  columnTitle?: string;
  source?: WebClipperTargetSource;
}

export interface WebClipperContext {
  url: string;
  title?: string;
  linkUrl?: string;
  linkText?: string;
  excerpt?: string;
  selectionText?: string;
  pageText?: string;
  articleText?: string;
  siteName?: string;
  imageUrl?: string;
  imageAlt?: string;
  capturedAt?: string;
}

export interface WebClipperBuildOptions {
  mode: WebClipperMode;
  imagePath?: string;
  includeMetadata?: boolean;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function firstNonEmpty(values: Array<string | undefined | null>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function normalizeClipperMode(value: string | undefined | null): WebClipperMode {
  switch ((value || '').trim()) {
    case 'link':
    case 'selection':
    case 'page':
    case 'article':
    case 'image':
      return value as WebClipperMode;
    default:
      return DEFAULT_WEB_CLIPPER_MODE;
  }
}

export function extractUrlHostLabel(url: string): string {
  const match = /^([a-z]+):\/\/([^/?#:]+)/i.exec((url || '').trim());
  if (!match) return '';
  return match[2].replace(/^www\./i, '');
}

export function markdownLink(label: string, url: string): string {
  const display = escapeMarkdownLabel(firstNonEmpty([label, extractUrlHostLabel(url), url]));
  return `[${display}](${url.trim()})`;
}

export function markdownImage(altText: string, pathOrUrl: string): string {
  const alt = escapeMarkdownLabel(firstNonEmpty([altText, 'image']));
  return `![${alt}](${pathOrUrl.trim()})`;
}

export function prependIncomingCaptureTag(markdown: string): string {
  const normalized = normalizeWhitespace(markdown);
  if (!normalized) return '#hidden-internal-incoming';
  return `#hidden-internal-incoming\n${normalized}`;
}

export function trimPreview(value: string | undefined | null, limit: number): string {
  const normalized = normalizeWhitespace(value || '');
  if (!normalized || normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function filenameFromUrl(url: string | undefined | null, fallbackStem = 'clip'): string {
  const raw = (url || '').trim();
  const lastSegment = raw.split(/[?#]/, 1)[0].split('/').filter(Boolean).pop() || fallbackStem;
  const clean = lastSegment.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || fallbackStem;
}

function buildMetadataLines(context: WebClipperContext): string[] {
  const sourceUrl = firstNonEmpty([context.linkUrl, context.url]);
  const sourceLabel = firstNonEmpty([context.siteName, extractUrlHostLabel(sourceUrl), sourceUrl]);
  const capturedAt = firstNonEmpty([context.capturedAt, new Date().toISOString()]);
  const lines = [];

  if (sourceUrl) {
    lines.push(`Source: ${markdownLink(sourceLabel, sourceUrl)}`);
  }
  if (capturedAt) {
    lines.push(`Captured: ${capturedAt}`);
  }
  return lines;
}

function buildArticleBody(context: WebClipperContext, mode: WebClipperMode): string {
  if (mode === 'selection') {
    return normalizeWhitespace(context.selectionText || '');
  }
  if (mode === 'article') {
    return normalizeWhitespace(context.articleText || context.pageText || '');
  }
  if (mode === 'page') {
    return normalizeWhitespace(context.pageText || context.articleText || '');
  }
  return '';
}

export function buildCaptureCardMarkdown(
  context: WebClipperContext,
  options: WebClipperBuildOptions,
): string {
  const mode = normalizeClipperMode(options.mode);
  const includeMetadata = options.includeMetadata !== false;
  const heading = firstNonEmpty([
    context.linkText,
    context.title,
    context.siteName,
    extractUrlHostLabel(firstNonEmpty([context.linkUrl, context.url])),
    firstNonEmpty([context.linkUrl, context.url]),
  ]);
  const excerpt = trimPreview(context.excerpt, 280);
  const metadata = includeMetadata ? buildMetadataLines(context) : [];
  const body = trimPreview(buildArticleBody(context, mode), 20000);

  if (mode === 'link') {
    const sourceUrl = firstNonEmpty([context.linkUrl, context.url]);
    const parts = [markdownLink(heading || sourceUrl, sourceUrl)];
    if (excerpt) parts.push(`> ${excerpt}`);
    if (metadata.length > 0) parts.push(metadata.join('\n'));
    return normalizeWhitespace(parts.join('\n\n'));
  }

  if (mode === 'image') {
    const imageTarget = firstNonEmpty([options.imagePath, context.imageUrl]);
    const parts = [];
    if (imageTarget) {
      parts.push(markdownImage(firstNonEmpty([context.imageAlt, heading, 'image']), imageTarget));
    }
    if (heading) parts.push(`Title: ${heading}`);
    if (excerpt) parts.push(`> ${excerpt}`);
    if (metadata.length > 0) parts.push(metadata.join('\n'));
    return normalizeWhitespace(parts.join('\n\n'));
  }

  const parts = [];
  if (mode === 'selection') {
    if (body) parts.push(body);
    if (metadata.length > 0) parts.push(metadata.join('\n'));
    return normalizeWhitespace(parts.join('\n\n'));
  }

  if (heading) parts.push(`# ${heading}`);
  if (excerpt) parts.push(`> ${excerpt}`);
  if (metadata.length > 0) parts.push(metadata.join('\n'));
  if (body) parts.push(body);

  if (parts.length === 0) {
    const fallbackUrl = firstNonEmpty([context.linkUrl, context.url]);
    return fallbackUrl ? markdownLink(fallbackUrl, fallbackUrl) : '';
  }

  return normalizeWhitespace(parts.join('\n\n'));
}
