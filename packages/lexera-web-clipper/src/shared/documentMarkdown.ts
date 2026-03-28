import {
  WebClipperAsset,
  WebClipperAssetCategory,
  buildWebClipperAssetMarkdown,
  filenameFromUrl,
  isDownloadableWebClipperUrl,
  markdownFileLink,
  inferWebClipperAssetCategory,
} from '@ludos/shared';

type CaptureResult = {
  markdown: string;
  assets: WebClipperAsset[];
};

type CaptureOptions = {
  baseUrl?: string;
};

type RenderContext = {
  assetCounter: number;
  assets: WebClipperAsset[];
  baseUrl: string;
};

const BLOCK_TAGS = new Set([
  'article', 'aside', 'blockquote', 'body', 'div', 'dl', 'figure', 'figcaption', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p',
  'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function absoluteUrl(rawUrl: string | null | undefined, baseUrl?: string): string {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    return new URL(value, baseUrl || document.baseURI).href;
  } catch (_error) {
    return value;
  }
}

function isBlockElement(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE
    && BLOCK_TAGS.has((node as HTMLElement).tagName.toLowerCase());
}

function hasMeaningfulText(node: Node | null | undefined): boolean {
  return normalizeText(node?.textContent || '').length > 0;
}

function dedupeAssets(assets: WebClipperAsset[]): WebClipperAsset[] {
  const seen = new Set<string>();
  const next: WebClipperAsset[] = [];
  for (const asset of assets) {
    const key = `${asset.markdown}\n${asset.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(asset);
  }
  return next;
}

function registerAsset(
  context: RenderContext,
  asset: Omit<WebClipperAsset, 'id'>,
): string {
  const id = `clip-asset-${context.assetCounter++}`;
  const nextAsset: WebClipperAsset = { id, ...asset };
  context.assets.push(nextAsset);
  return nextAsset.markdown;
}

function buildAssetToken(
  context: RenderContext,
  kind: WebClipperAsset['kind'],
  category: WebClipperAssetCategory,
  url: string,
  options?: {
    alt?: string;
    label?: string;
    title?: string;
    filename?: string;
  },
): string {
  const absolute = absoluteUrl(url, context.baseUrl);
  if (!absolute) return '';
  const asset: Omit<WebClipperAsset, 'id'> = {
    url: absolute,
    kind,
    category,
    alt: options?.alt,
    label: options?.label,
    title: options?.title,
    filename: options?.filename || filenameFromUrl(absolute, 'clip'),
    markdown: '',
  };
  asset.markdown = buildWebClipperAssetMarkdown(asset, absolute);
  return registerAsset(context, asset);
}

function escapeInlineCode(text: string): string {
  return text.replace(/`/g, '\\`');
}

function getImageSource(element: Element, context: RenderContext): string {
  if (element instanceof HTMLImageElement) {
    return absoluteUrl(element.currentSrc || element.getAttribute('src'), context.baseUrl);
  }
  const img = element.querySelector('img');
  if (img) {
    return absoluteUrl((img as HTMLImageElement).currentSrc || img.getAttribute('src'), context.baseUrl);
  }
  const source = element.querySelector('source');
  return absoluteUrl(
    source?.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] || source?.getAttribute('src'),
    context.baseUrl,
  );
}

function getMediaSource(element: HTMLMediaElement, context: RenderContext): string {
  return absoluteUrl(
    element.currentSrc
    || element.getAttribute('src')
    || element.querySelector('source')?.getAttribute('src')
    || '',
    context.baseUrl,
  );
}

function getAnchorCategory(anchor: HTMLAnchorElement, href: string): WebClipperAssetCategory | null {
  const hrefCategory = inferWebClipperAssetCategory(href);
  if (hrefCategory) return hrefCategory;
  const declaredType = (anchor.getAttribute('type') || '').trim().toLowerCase();
  if (declaredType.startsWith('image/')) return 'image';
  if (declaredType.startsWith('video/')) return 'video';
  if (declaredType.startsWith('audio/')) return 'audio';
  if (declaredType.startsWith('application/')) return 'document';
  if (anchor.hasAttribute('download')) return 'file';
  return null;
}

function renderInlineChildren(node: ParentNode, context: RenderContext): string {
  let output = '';
  for (const child of Array.from(node.childNodes)) {
    output += renderInlineNode(child, context);
  }
  return output.replace(/[ \t]+\n/g, '\n');
}

function renderAnchor(anchor: HTMLAnchorElement, context: RenderContext): string {
  const href = absoluteUrl(anchor.getAttribute('href'), context.baseUrl);
  const title = normalizeText(anchor.getAttribute('title') || '');
  if (!href) {
    return renderInlineChildren(anchor, context);
  }

  const imageChild = anchor.querySelector('img, picture, video, audio');
  if (imageChild && !hasMeaningfulText(anchor)) {
    return renderInlineChildren(anchor, context);
  }

  const label = normalizeText(renderInlineChildren(anchor, context).replace(/\s+/g, ' ')) || anchor.textContent?.trim() || filenameFromUrl(href, href);
  const category = getAnchorCategory(anchor, href);
  if (category || isDownloadableWebClipperUrl(href)) {
    return buildAssetToken(context, 'link', category || 'file', href, {
      label,
      title,
    });
  }
  return markdownFileLink(label, href, title);
}

function renderImageElement(element: Element, context: RenderContext, titleOverride?: string): string {
  const src = getImageSource(element, context);
  if (!src) return '';
  const alt = normalizeText(
    (element instanceof HTMLImageElement ? element.alt : '')
    || element.getAttribute('aria-label')
    || element.getAttribute('title')
    || '',
  );
  const title = normalizeText(titleOverride || element.getAttribute('title') || '');
  return buildAssetToken(context, 'embed', 'image', src, {
    alt,
    title,
  });
}

function renderMediaElement(element: HTMLMediaElement, context: RenderContext, titleOverride?: string): string {
  const src = getMediaSource(element, context);
  if (!src) return '';
  const tagName = element.tagName.toLowerCase();
  const category: WebClipperAssetCategory = tagName === 'audio' ? 'audio' : 'video';
  const label = normalizeText(
    titleOverride
    || element.getAttribute('title')
    || element.getAttribute('aria-label')
    || filenameFromUrl(src, category)
    || category,
  );
  return buildAssetToken(context, 'embed', category, src, {
    alt: label,
    title: titleOverride || element.getAttribute('title') || '',
  });
}

function renderInlineNode(node: Node, context: RenderContext): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ? node.textContent.replace(/\s+/g, ' ') : '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();

  if (tagName === 'br') return '  \n';
  if (tagName === 'img' || tagName === 'picture') return renderImageElement(element, context);
  if (tagName === 'video' || tagName === 'audio') return renderMediaElement(element as HTMLMediaElement, context);
  if (tagName === 'a') return renderAnchor(element as HTMLAnchorElement, context);

  const content = renderInlineChildren(element, context).trim();
  if (!content) return '';

  if (tagName === 'strong' || tagName === 'b') return `**${content}**`;
  if (tagName === 'em' || tagName === 'i') return `*${content}*`;
  if (tagName === 'code') return `\`${escapeInlineCode(content)}\``;
  if (tagName === 's' || tagName === 'del' || tagName === 'strike') return `~~${content}~~`;

  return content;
}

function indentLines(text: string, prefix: string): string {
  return text.split('\n').map((line) => (line ? `${prefix}${line}` : prefix.trimEnd())).join('\n');
}

function renderTable(table: HTMLTableElement, context: RenderContext): string {
  const rows = Array.from(table.querySelectorAll('tr')).map((row) => (
    Array.from(row.children)
      .filter((cell) => cell.tagName.toLowerCase() === 'td' || cell.tagName.toLowerCase() === 'th')
      .map((cell) => normalizeText(renderInlineChildren(cell, context)))
  )).filter((row) => row.length > 0);

  if (rows.length === 0) return '';

  const header = rows[0];
  const divider = header.map(() => '---');
  const bodyRows = rows.slice(1);
  const output = [
    `| ${header.join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
    ...bodyRows.map((row) => `| ${row.join(' | ')} |`),
  ];
  return output.join('\n');
}

function renderList(list: HTMLOListElement | HTMLUListElement, context: RenderContext, depth = 0): string {
  const ordered = list.tagName.toLowerCase() === 'ol';
  const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === 'li');
  const lines: string[] = [];

  items.forEach((item, index) => {
    const prefix = ordered ? `${index + 1}. ` : '- ';
    const inlineNodes: Node[] = [];
    const nestedBlocks: string[] = [];

    Array.from(item.childNodes).forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tagName = (child as HTMLElement).tagName.toLowerCase();
        if (tagName === 'ul' || tagName === 'ol') {
          const nested = renderList(child as HTMLOListElement | HTMLUListElement, context, depth + 1);
          if (nested) nestedBlocks.push(nested);
          return;
        }
        if (isBlockElement(child) && tagName !== 'p' && tagName !== 'span') {
          const nested = renderBlockNode(child, context);
          if (nested) nestedBlocks.push(nested);
          return;
        }
      }
      inlineNodes.push(child);
    });

    const inlineText = normalizeText(inlineNodes.map((child) => renderInlineNode(child, context)).join(' '));
    const itemLines: string[] = [];
    if (inlineText) {
      itemLines.push(`${'  '.repeat(depth)}${prefix}${inlineText}`);
    } else {
      itemLines.push(`${'  '.repeat(depth)}${prefix}`.trimEnd());
    }

    for (const nested of nestedBlocks) {
      itemLines.push(indentLines(nested, `${'  '.repeat(depth + 1)}`));
    }

    lines.push(itemLines.join('\n'));
  });

  return lines.join('\n');
}

function renderFigure(figure: HTMLElement, context: RenderContext): string {
  const caption = normalizeText(figure.querySelector('figcaption')?.textContent || '');
  const media = Array.from(figure.children).find((child) => {
    const tagName = child.tagName.toLowerCase();
    return tagName === 'img' || tagName === 'picture' || tagName === 'video' || tagName === 'audio';
  }) as HTMLElement | undefined;

  if (media) {
    const tagName = media.tagName.toLowerCase();
    if (tagName === 'img' || tagName === 'picture') {
      return renderImageElement(media, context, caption);
    }
    if (tagName === 'video' || tagName === 'audio') {
      return renderMediaElement(media as HTMLMediaElement, context, caption);
    }
  }

  const blocks = Array.from(figure.childNodes)
    .filter((child) => !(child instanceof HTMLElement && child.tagName.toLowerCase() === 'figcaption'))
    .map((child) => renderBlockNode(child, context))
    .filter(Boolean);

  if (caption) {
    blocks.push(`> ${caption}`);
  }
  return blocks.join('\n\n');
}

function renderBlockNode(node: Node, context: RenderContext): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeText(node.textContent || '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();

  if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') return '';
  if (tagName === 'figure') return renderFigure(element, context);
  if (tagName === 'img' || tagName === 'picture') return renderImageElement(element, context);
  if (tagName === 'video' || tagName === 'audio') return renderMediaElement(element as HTMLMediaElement, context);
  if (tagName === 'hr') return '---';
  if (tagName === 'pre') {
    const code = element.textContent?.replace(/\r\n/g, '\n').trimEnd() || '';
    if (!code) return '';
    return `\`\`\`\n${code}\n\`\`\``;
  }
  if (tagName === 'blockquote') {
    const nested = renderBlockChildren(element, context);
    if (!nested) return '';
    return nested.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
  }
  if (tagName === 'ul' || tagName === 'ol') {
    return renderList(element as HTMLOListElement | HTMLUListElement, context);
  }
  if (tagName === 'table') {
    return renderTable(element as HTMLTableElement, context);
  }
  if (/^h[1-6]$/.test(tagName)) {
    const level = Number.parseInt(tagName.slice(1), 10) || 1;
    const text = normalizeText(renderInlineChildren(element, context));
    return text ? `${'#'.repeat(level)} ${text}` : '';
  }
  if (tagName === 'p' || tagName === 'figcaption') {
    return normalizeText(renderInlineChildren(element, context));
  }
  if (tagName === 'li') {
    const listWrapper = element.ownerDocument?.createElement('ul') || document.createElement('ul');
    listWrapper.innerHTML = element.outerHTML;
    return renderList(listWrapper, context);
  }
  if (tagName === 'iframe') {
    const src = absoluteUrl(element.getAttribute('src'), context.baseUrl);
    if (!src) return '';
    return markdownFileLink(normalizeText(element.getAttribute('title') || 'Embedded page'), src);
  }

  return renderBlockChildren(element, context);
}

function renderBlockChildren(root: ParentNode, context: RenderContext): string {
  const blocks: string[] = [];
  const inlineBuffer: string[] = [];

  function flushInlineBuffer(): void {
    const text = normalizeText(inlineBuffer.join(' '));
    if (text) blocks.push(text);
    inlineBuffer.length = 0;
  }

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = normalizeText(child.textContent || '');
      if (text) inlineBuffer.push(text);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }

    if (isBlockElement(child)) {
      flushInlineBuffer();
      const block = renderBlockNode(child, context);
      if (block) blocks.push(block);
      continue;
    }

    const inline = renderInlineNode(child, context);
    if (inline) inlineBuffer.push(inline);
  }

  flushInlineBuffer();
  return blocks.join('\n\n');
}

function captureRoot(root: ParentNode | null | undefined, options?: CaptureOptions): CaptureResult {
  const baseUrl = (options?.baseUrl || root?.ownerDocument?.baseURI || document.baseURI || '').trim();
  const context: RenderContext = {
    assetCounter: 0,
    assets: [],
    baseUrl,
  };
  const markdown = normalizeMarkdown(renderBlockChildren(root || document.body, context));
  return {
    markdown,
    assets: dedupeAssets(context.assets),
  };
}

export function captureNodeMarkdown(root: ParentNode | null | undefined, options?: CaptureOptions): CaptureResult {
  return captureRoot(root, options);
}

export function captureSelectionMarkdown(selection: Selection | null | undefined, options?: CaptureOptions): CaptureResult {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return { markdown: '', assets: [] };
  }

  const ownerDocument = selection.anchorNode?.ownerDocument || document;
  const container = ownerDocument.createElement('div');
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const fragment = selection.getRangeAt(index).cloneContents();
    container.appendChild(fragment);
  }
  return captureRoot(container, options);
}

export function captureHtmlMarkdown(html: string, options?: CaptureOptions): CaptureResult {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html || '', 'text/html');
  return captureRoot(parsed.body, {
    baseUrl: options?.baseUrl || parsed.baseURI || document.baseURI,
  });
}
