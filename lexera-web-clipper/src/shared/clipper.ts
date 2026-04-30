import {
  buildCaptureCardMarkdown,
  buildWebClipperAssetMarkdown,
  filenameFromUrl,
  WebClipperAsset,
  WebClipperContext,
  WebClipperMode,
  WebClipperTarget,
} from '@lexera/shared';
import { submitMarkdownCard, uploadBlobToBoardMedia } from './backend';

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('Invalid data URL');
  }

  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  const raw = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function extensionFromMimeType(contentType: string): string {
  const normalized = (contentType || '').split(';', 1)[0].trim().toLowerCase();
  switch (normalized) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    case 'image/svg+xml': return 'svg';
    case 'image/avif': return 'avif';
    case 'video/mp4': return 'mp4';
    case 'video/webm': return 'webm';
    case 'video/quicktime': return 'mov';
    case 'audio/mpeg': return 'mp3';
    case 'audio/ogg': return 'ogg';
    case 'audio/wav': return 'wav';
    case 'application/pdf': return 'pdf';
    case 'text/plain': return 'txt';
    default: return '';
  }
}

function filenameFromContentDisposition(contentDisposition: string | null): string {
  const raw = String(contentDisposition || '');
  if (!raw) return '';
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(raw);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).trim();
    } catch (_error) {
      return utf8Match[1].trim();
    }
  }
  const quotedMatch = /filename="([^"]+)"/i.exec(raw);
  if (quotedMatch?.[1]) return quotedMatch[1].trim();
  const plainMatch = /filename=([^;]+)/i.exec(raw);
  return plainMatch?.[1]?.trim() || '';
}

function ensureFilenameExtension(filename: string, contentType: string): string {
  const trimmed = (filename || '').trim();
  if (!trimmed) return '';
  if (/\.[a-z0-9]+$/i.test(trimmed)) return trimmed;
  const extension = extensionFromMimeType(contentType);
  return extension ? `${trimmed}.${extension}` : trimmed;
}

async function fetchAssetBlob(assetUrl: string): Promise<{ blob: Blob; filename: string }> {
  if (assetUrl.startsWith('data:')) {
    const blob = dataUrlToBlob(assetUrl);
    return {
      blob,
      filename: ensureFilenameExtension(
        filenameFromUrl(assetUrl, 'clip-asset'),
        blob.type || 'application/octet-stream',
      ),
    };
  }

  const response = await fetch(assetUrl, {
    credentials: 'include',
    cache: 'force-cache',
  });
  if (!response.ok) {
    throw new Error(`Asset download failed: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  const filename = ensureFilenameExtension(
    filenameFromContentDisposition(response.headers.get('content-disposition'))
      || filenameFromUrl(response.url || assetUrl, 'clip-asset'),
    response.headers.get('content-type') || blob.type || '',
  );
  return { blob, filename };
}

async function uploadRemoteAsset(
  baseUrl: string,
  boardId: string,
  asset: WebClipperAsset,
): Promise<string> {
  const { blob, filename } = await fetchAssetBlob(asset.url);
  const upload = await uploadBlobToBoardMedia(baseUrl, boardId, blob, filename || asset.filename || 'clip-asset');
  return upload.path || upload.filename;
}

function rewriteArchivedAsset(markdown: string, asset: WebClipperAsset, localPath: string): string {
  const original = asset.markdown || buildWebClipperAssetMarkdown(asset, asset.url);
  const replacement = buildWebClipperAssetMarkdown(asset, localPath);
  if (!original || !replacement) return markdown;
  return markdown.split(original).join(replacement);
}

async function archiveMarkdownAssets(
  baseUrl: string,
  target: WebClipperTarget,
  markdown: string,
  context: WebClipperContext,
): Promise<string> {
  const assets = Array.isArray(context.assets)
    ? context.assets.filter((asset) => asset.markdown && markdown.includes(asset.markdown))
    : [];
  if (assets.length === 0) return markdown;

  const uploadsByUrl = new Map<string, string>();
  let nextMarkdown = markdown;

  for (const asset of assets) {
    try {
      let localPath = uploadsByUrl.get(asset.url) || '';
      if (!localPath) {
        localPath = await uploadRemoteAsset(baseUrl, target.boardId, asset);
        if (!localPath) continue;
        uploadsByUrl.set(asset.url, localPath);
      }
      nextMarkdown = rewriteArchivedAsset(nextMarkdown, asset, localPath);
    } catch (_error) {
      continue;
    }
  }

  return nextMarkdown;
}

export async function captureContextToBoard(
  baseUrl: string,
  target: WebClipperTarget,
  mode: WebClipperMode,
  context: WebClipperContext,
): Promise<{ markdown: string }> {
  let imagePath = '';

  if (mode === 'image' && context.imageUrl) {
    imagePath = await uploadRemoteAsset(baseUrl, target.boardId, {
      id: 'clip-image',
      url: context.imageUrl,
      markdown: '',
      kind: 'embed',
      category: 'image',
      alt: context.imageAlt || context.title || 'image',
      filename: filenameFromUrl(context.imageUrl || context.url || 'clip-image.png', 'clip-image.png'),
    });
  }

  let markdown = buildCaptureCardMarkdown(context, {
    mode,
    imagePath,
    includeMetadata: true,
  });
  markdown = await archiveMarkdownAssets(baseUrl, target, markdown, context);

  if (!markdown.trim()) {
    throw new Error('Nothing useful could be extracted from the current page');
  }

  await submitMarkdownCard(baseUrl, target, markdown);
  return { markdown };
}
