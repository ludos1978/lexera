/**
 * Backend discovery constants and functions for the browser-only web clipper.
 *
 * This is a browser-variant of the discovery logic. The authoritative Tauri
 * implementation lives in lexera-shared/backendDiscovery.js (plain JS
 * IIFE with Tauri invoke support). This TypeScript module cannot import that
 * IIFE, so it maintains its own implementation for the browser extension runtime.
 *
 * Both MUST use the same port candidate list. If you change
 * LEXERA_BACKEND_PORT_CANDIDATES here, update DEFAULT_PORT_CANDIDATES in
 * lexera-shared/backendDiscovery.js to match.
 */
export const LEXERA_BACKEND_PORT_CANDIDATES = [13080, 8083, 1431, 12080, 14080, 11080, 15080];

export const DEFAULT_WEB_CLIPPER_MODE = 'article';

export type WebClipperMode = 'link' | 'selection' | 'page' | 'article' | 'image';
export type WebClipperContentSourceType = 'website' | 'reader' | 'rss';
export type WebClipperFeedKind = 'rss' | 'atom';

export type WebClipperTargetSource = 'saved' | 'incoming' | 'fallback';

export type WebClipperAssetKind = 'embed' | 'link';

export type WebClipperAssetCategory = 'image' | 'video' | 'audio' | 'document' | 'file';

export interface WebClipperTarget {
  boardId: string;
  colIndex?: number;
  cardId?: string;
  boardTitle?: string;
  columnTitle?: string;
  source?: WebClipperTargetSource;
}

export interface WebClipperContext {
  url: string;
  sourceType?: WebClipperContentSourceType;
  sourceLabel?: string;
  sourceUrl?: string;
  feedUrl?: string;
  title?: string;
  linkUrl?: string;
  linkText?: string;
  excerpt?: string;
  selectionText?: string;
  pageText?: string;
  articleText?: string;
  selectionMarkdown?: string;
  pageMarkdown?: string;
  articleMarkdown?: string;
  siteName?: string;
  imageUrl?: string;
  imageAlt?: string;
  capturedAt?: string;
  assets?: WebClipperAsset[];
}

export interface WebClipperFeedCandidate {
  id: string;
  url: string;
  label?: string;
  kind?: WebClipperFeedKind;
  sourceUrl?: string;
}

export interface WebClipperCollectedPageContext {
  website: WebClipperContext;
  reader?: WebClipperContext;
  feedCandidates?: WebClipperFeedCandidate[];
}

export interface WebClipperAsset {
  id: string;
  url: string;
  markdown: string;
  kind: WebClipperAssetKind;
  category: WebClipperAssetCategory;
  alt?: string;
  label?: string;
  title?: string;
  filename?: string;
}

export interface WebClipperBuildOptions {
  mode: WebClipperMode;
  imagePath?: string;
  includeMetadata?: boolean;
}

type WebClipperFetchResponse = {
  ok: boolean;
  json(): Promise<any>;
};

type WebClipperFetch = (
  input: string,
  init?: { signal?: AbortSignal | null },
) => Promise<WebClipperFetchResponse>;

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function escapeMarkdownTitle(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function firstNonEmpty(values: Array<string | undefined | null>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function defaultWebClipperFetch(): WebClipperFetch {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable');
  }
  return fetch as unknown as WebClipperFetch;
}

export function normalizeLexeraBackendBaseUrl(value: string | undefined | null): string {
  return (value || '').trim().replace(/\/+$/, '');
}

export function resolveLexeraBackendStatusBaseUrl(
  candidateBaseUrl: string,
  statusPayload: any,
): string {
  const normalized = normalizeLexeraBackendBaseUrl(candidateBaseUrl);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    if (statusPayload && typeof statusPayload.port === 'number') {
      parsed.port = String(statusPayload.port);
    }
    return normalizeLexeraBackendBaseUrl(parsed.toString());
  } catch (_error) {
    return normalized;
  }
}

export function buildLexeraBackendCandidates(preferredBaseUrl?: string | null): string[] {
  const candidates: string[] = [];
  const pushCandidate = (candidate: string | undefined | null): void => {
    const normalized = normalizeLexeraBackendBaseUrl(candidate);
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  pushCandidate(preferredBaseUrl);
  for (const port of LEXERA_BACKEND_PORT_CANDIDATES) {
    pushCandidate(`http://127.0.0.1:${port}`);
    pushCandidate(`http://localhost:${port}`);
  }
  return candidates;
}

export async function probeLexeraBackend(
  baseUrl: string,
  options?: {
    fetchImpl?: WebClipperFetch;
    timeoutMs?: number;
  },
): Promise<{ baseUrl: string; status: any } | null> {
  const fetchImpl = options?.fetchImpl || defaultWebClipperFetch();
  const timeoutMs = typeof options?.timeoutMs === 'number' ? options.timeoutMs : 1200;
  const normalizedBaseUrl = normalizeLexeraBackendBaseUrl(baseUrl);
  if (!normalizedBaseUrl) return null;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetchImpl(`${normalizedBaseUrl}/status`, {
      signal: controller ? controller.signal : null,
    });
    if (!response.ok) return null;
    const status = await response.json();
    if (status?.status !== 'running') return null;
    return {
      baseUrl: resolveLexeraBackendStatusBaseUrl(normalizedBaseUrl, status),
      status,
    };
  } catch (_error) {
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function discoverLexeraBackend(
  preferredBaseUrl?: string | null,
  options?: {
    fetchImpl?: WebClipperFetch;
    timeoutMs?: number;
  },
): Promise<string | null> {
  const candidates = buildLexeraBackendCandidates(preferredBaseUrl);
  for (const candidate of candidates) {
    const probe = await probeLexeraBackend(candidate, options);
    if (probe) return probe.baseUrl;
  }
  return null;
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

export function normalizeComparableUrl(url: string | undefined | null): string {
  const raw = (url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    const pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = pathname || '/';
    return parsed.toString().replace(/\/$/, '');
  } catch (_error) {
    return raw.replace(/#.*$/, '').replace(/\/+$/, '');
  }
}

export function markdownLink(label: string, url: string): string {
  const display = escapeMarkdownLabel(firstNonEmpty([label, extractUrlHostLabel(url), url]));
  return `[${display}](${url.trim()})`;
}

function markdownTarget(pathOrUrl: string, title?: string): string {
  const normalizedPath = (pathOrUrl || '').trim();
  const normalizedTitle = firstNonEmpty([title]);
  if (!normalizedTitle) return normalizedPath;
  return `${normalizedPath} "${escapeMarkdownTitle(normalizedTitle)}"`;
}

export function markdownFileLink(label: string, pathOrUrl: string, title?: string): string {
  const display = escapeMarkdownLabel(firstNonEmpty([label, extractUrlHostLabel(pathOrUrl), pathOrUrl]));
  return `[${display}](${markdownTarget(pathOrUrl, title)})`;
}

export function markdownImage(altText: string, pathOrUrl: string, title?: string): string {
  const alt = escapeMarkdownLabel(firstNonEmpty([altText, 'image']));
  return `![${alt}](${markdownTarget(pathOrUrl, title)})`;
}

export function buildWebClipperAssetMarkdown(
  asset: Pick<WebClipperAsset, 'kind' | 'category' | 'url' | 'alt' | 'label' | 'title' | 'filename'>,
  pathOrUrl?: string,
): string {
  const target = firstNonEmpty([pathOrUrl, asset.url]);
  if (!target) return '';

  if (asset.kind === 'link') {
    const label = firstNonEmpty([asset.label, asset.filename, extractUrlHostLabel(target), target]);
    return markdownFileLink(label, target, asset.title);
  }

  const alt = firstNonEmpty([asset.alt, asset.label, asset.filename, asset.category, 'file']);
  return markdownImage(alt, target, asset.title);
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'apng', 'tif', 'tiff', 'ico']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv', 'mpg', 'mpeg']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'opus']);
const DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'txt', 'rtf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'tsv',
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'epub',
]);

export function inferWebClipperAssetCategory(url: string | undefined | null): WebClipperAssetCategory | null {
  const raw = (url || '').trim();
  if (!raw) return null;
  const match = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(raw);
  const extension = match ? match[1].toLowerCase() : '';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document';
  return null;
}

export function isDownloadableWebClipperUrl(url: string | undefined | null): boolean {
  return inferWebClipperAssetCategory(url) !== null;
}

export function prependIncomingCaptureTag(markdown: string): string {
  const normalized = normalizeWhitespace(markdown);
  if (!normalized) return '#hidden-internal-incoming';
  return `#hidden-internal-incoming\n${normalized}`;
}

export function dedupeWebClipperFeedCandidates(
  candidates: Array<WebClipperFeedCandidate | null | undefined>,
): WebClipperFeedCandidate[] {
  const seen = new Set<string>();
  const next: WebClipperFeedCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate || !candidate.url) continue;
    const comparableUrl = normalizeComparableUrl(candidate.url);
    if (!comparableUrl || seen.has(comparableUrl)) continue;
    seen.add(comparableUrl);
    next.push({
      ...candidate,
      url: comparableUrl,
    });
  }
  return next;
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
    return normalizeWhitespace(context.selectionMarkdown || context.selectionText || '');
  }
  if (mode === 'article') {
    return normalizeWhitespace(context.articleMarkdown || context.articleText || context.pageText || '');
  }
  if (mode === 'page') {
    return normalizeWhitespace(context.pageMarkdown || context.pageText || context.articleMarkdown || context.articleText || '');
  }
  return '';
}

export function hasUsefulWebClipperBody(context: WebClipperContext | null | undefined): boolean {
  if (!context) return false;
  return Boolean(firstNonEmpty([
    context.selectionMarkdown,
    context.articleMarkdown,
    context.pageMarkdown,
    context.selectionText,
    context.articleText,
    context.pageText,
    context.linkUrl,
    context.imageUrl,
  ]));
}

export function getPreferredWebClipperContext(collected: WebClipperCollectedPageContext): WebClipperContext {
  if (hasUsefulWebClipperBody(collected.reader)) {
    return collected.reader as WebClipperContext;
  }
  return collected.website;
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
  const body = trimPreview(buildArticleBody(context, mode), 200000);

  if (mode === 'link') {
    const sourceUrl = firstNonEmpty([context.linkUrl, context.url]);
    const parts = [markdownFileLink(heading || sourceUrl, sourceUrl)];
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
