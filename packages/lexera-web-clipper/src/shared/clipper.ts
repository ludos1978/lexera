import {
  buildCaptureCardMarkdown,
  filenameFromUrl,
  WebClipperContext,
  WebClipperMode,
  WebClipperTarget,
} from '../../../shared/src/webClipper';
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

export async function captureContextToBoard(
  baseUrl: string,
  target: WebClipperTarget,
  mode: WebClipperMode,
  context: WebClipperContext,
): Promise<{ markdown: string }> {
  let imagePath = '';

  if (mode === 'image' && context.imageUrl?.startsWith('data:')) {
    const blob = dataUrlToBlob(context.imageUrl);
    const upload = await uploadBlobToBoardMedia(
      baseUrl,
      target.boardId,
      blob,
      filenameFromUrl(context.imageUrl || context.url || 'clip-image.png', 'clip-image.png'),
    );
    imagePath = upload.path;
  } else if (mode === 'image' && context.imageUrl) {
    imagePath = context.imageUrl;
  }

  const markdown = buildCaptureCardMarkdown(context, {
    mode,
    imagePath,
    includeMetadata: true,
  });

  if (!markdown.trim()) {
    throw new Error('Nothing useful could be extracted from the current page');
  }

  await submitMarkdownCard(baseUrl, target, markdown);
  return { markdown };
}
