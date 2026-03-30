import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

let OrderHelpers;

function createFakeClassList(classNames) {
  const set = new Set(classNames || []);
  return {
    contains(name) {
      return set.has(name);
    }
  };
}

function createFakeCard(colIndex, cardIndex) {
  return {
    getAttribute(name) {
      if (name === 'data-col-index') return String(colIndex);
      if (name === 'data-card-index') return String(cardIndex);
      return '';
    }
  };
}

function createFakeElement(options = {}) {
  return {
    classList: createFakeClassList(options.classNames),
    getAttribute(name) {
      return options.attributes && Object.prototype.hasOwnProperty.call(options.attributes, name)
        ? options.attributes[name]
        : '';
    },
    querySelector(selector) {
      if (options.querySelectors && Object.prototype.hasOwnProperty.call(options.querySelectors, selector)) {
        return options.querySelectors[selector];
      }
      return null;
    },
    closest(selector) {
      if (selector === '.card') return options.card || null;
      if (options.closestSelectors && Object.prototype.hasOwnProperty.call(options.closestSelectors, selector)) {
        return options.closestSelectors[selector];
      }
      return null;
    }
  };
}

function createFakeColumn(title) {
  return {
    getAttribute(name) {
      if (name === 'data-col-title') return title;
      return '';
    },
    querySelector(selector) {
      if (selector === '.column-title') return { textContent: title };
      return null;
    }
  };
}

function getFileExtension(path) {
  const normalized = String(path || '').trim().split(/[?#]/, 1)[0];
  const slashIndex = normalized.lastIndexOf('/');
  const fileName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
}

function initDashboardDeps(overrides = {}) {
  OrderHelpers.init({
    stripInternalHiddenTags: (value) => String(value || ''),
    hasTag: () => false,
    is_archived_or_deleted: () => false,
    parseMarkdownTarget: (raw) => ({ path: String(raw || '').trim(), title: '' }),
    parseLocalFileReference: (path) => ({ path: String(path || '').trim() }),
    isExternalHttpUrl: (value) => /^https?:\/\//i.test(String(value || '').trim()),
    getFileExtension,
    getMediaCategory: (ext) => {
      if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp' || ext === 'svg') {
        return 'image';
      }
      if (ext === 'mp4' || ext === 'webm') return 'video';
      return '';
    },
    resolveMarkdownRelativeTargets: (content) => String(content || ''),
    LexeraTagSystem: {
      stripLayoutTags: (value) => String(value || ''),
      stripLegacyStructureTags: (value) => String(value || ''),
      extractLayoutTags: () => ({ rowRaw: '', spanRaw: '', stack: false, header: false, footer: false, wip: 0 }),
      getElementSizeTag: () => ''
    },
    ...overrides
  });
}

beforeAll(() => {
  OrderHelpers = loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers');
});

beforeEach(() => {
  initDashboardDeps();
});

describe('dashboard inventory helpers', () => {
  it('collects included files from board data and groups duplicate paths', () => {
    const items = OrderHelpers.collectDashboardIncludedFiles({
      rows: [
        {
          stacks: [
            {
              columns: [
                { title: 'Slides !!!include(slides/intro.md)!!!', includeSource: { rawPath: 'slides/intro.md' } },
                { title: 'Notes !!!include(notes.md)!!!' },
                { title: 'Reuse !!!include(slides/intro.md)!!!' },
                { title: 'Regular Column' }
              ]
            }
          ]
        }
      ]
    });

    expect(items).toEqual([
      {
        kind: 'include',
        path: 'slides/intro.md',
        count: 2,
        firstContextLabel: 'Slides',
        extension: 'md',
        mediaCategory: ''
      },
      {
        kind: 'include',
        path: 'notes.md',
        count: 1,
        firstContextLabel: 'Notes',
        extension: 'md',
        mediaCategory: ''
      }
    ]);
  });

  it('resolves file embeds and nested includes relative to the included file', () => {
    initDashboardDeps({
      resolveMarkdownRelativeTargets: (content, includeFilePath) => {
        expect(includeFilePath).toBe('docs/include.md');
        return String(content || '')
          .replace('(./assets/pic.png)', '(docs/assets/pic.png)')
          .replace('!!!include(./nested.md)!!!', '!!!include(docs/nested.md)!!!');
      }
    });

    const refs = OrderHelpers.collectDashboardFileReferences({
      rows: [
        {
          stacks: [
            {
              columns: [
                {
                  title: 'Imported Notes !!!include(docs/include.md)!!!',
                  includeSource: { rawPath: 'docs/include.md' },
                  cards: [
                    {
                      content: [
                        '![Preview](./assets/pic.png)',
                        '!!!include(./nested.md)!!!',
                        '![Skip Remote](https://example.com/remote.png)'
                      ].join('\n')
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });

    expect(refs.fileEmbeds).toEqual([
      {
        kind: 'embed',
        path: 'docs/assets/pic.png',
        count: 1,
        firstContextLabel: 'Imported Notes',
        extension: 'png',
        mediaCategory: 'image'
      }
    ]);

    expect(refs.includedFiles).toEqual([
      {
        kind: 'include',
        path: 'docs/include.md',
        count: 1,
        firstContextLabel: 'Imported Notes',
        extension: 'md',
        mediaCategory: ''
      },
      {
        kind: 'include',
        path: 'docs/nested.md',
        count: 1,
        firstContextLabel: 'Imported Notes',
        extension: 'md',
        mediaCategory: ''
      }
    ]);
  });

  it('collects local markdown file links as file embeds while skipping external links', () => {
    const refs = OrderHelpers.collectDashboardFileReferences({
      rows: [
        {
          stacks: [
            {
              columns: [
                {
                  title: 'Attachments',
                  cards: [
                    {
                      content: [
                        '[Deck](slides/plan.pdf)',
                        '[Local Notes](docs/reference.md)',
                        '[Remote](https://example.com/reference.pdf)',
                        '[Jump](#overview)'
                      ].join('\n')
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });

    expect(refs.fileEmbeds).toEqual([
      {
        kind: 'embed',
        path: 'slides/plan.pdf',
        count: 1,
        firstContextLabel: 'Attachments',
        extension: 'pdf',
        mediaCategory: ''
      },
      {
        kind: 'embed',
        path: 'docs/reference.md',
        count: 1,
        firstContextLabel: 'Attachments',
        extension: 'md',
        mediaCategory: ''
      }
    ]);
  });

  it('collects file embeds and included files from the rendered board container', () => {
    const column = createFakeColumn('Attachments !!!include(notes/include.md)!!!');
    const embedCard = createFakeCard(4, 1);
    const embedContainer = createFakeElement({
      attributes: { 'data-file-path': 'docs/spec.pdf' },
      card: embedCard,
      closestSelectors: { '.column': column }
    });
    const linkContainer = createFakeElement({
      attributes: { 'data-file-path': 'docs/reference.md' },
      card: embedCard,
      closestSelectors: { '.column': column }
    });
    const includeBadge = createFakeElement({
      attributes: { 'data-include-path': 'notes/include.md' },
      closestSelectors: { '.column': column }
    });
    const inlineInclude = createFakeElement({
      attributes: { 'data-file-path': 'notes/nested.md' },
      closestSelectors: { '.column': column }
    });
    const container = {
      querySelectorAll(selector) {
        if (selector.includes('.embed-container')) return [embedContainer, linkContainer];
        if (selector.includes('.column-include-badge')) return [includeBadge, inlineInclude];
        return [];
      }
    };

    const refs = OrderHelpers.collectDashboardFileReferencesFromContainer(container);

    expect(refs.fileEmbeds).toEqual([
      {
        kind: 'embed',
        path: 'docs/spec.pdf',
        count: 1,
        firstContextLabel: 'Attachments',
        extension: 'pdf',
        mediaCategory: ''
      },
      {
        kind: 'embed',
        path: 'docs/reference.md',
        count: 1,
        firstContextLabel: 'Attachments',
        extension: 'md',
        mediaCategory: ''
      }
    ]);

    expect(refs.includedFiles).toEqual([
      {
        kind: 'include',
        path: 'notes/include.md',
        count: 1,
        firstContextLabel: 'Attachments',
        extension: 'md',
        mediaCategory: ''
      },
      {
        kind: 'include',
        path: 'notes/nested.md',
        count: 1,
        firstContextLabel: 'Attachments',
        extension: 'md',
        mediaCategory: ''
      }
    ]);
  });

  it('collects broken embeds and broken include badges from the rendered container', () => {
    const image = createFakeElement({
      attributes: { src: '/assets/broken.png' }
    });
    const brokenEmbed = createFakeElement({
      classNames: ['embed-broken'],
      attributes: { 'data-file-path': 'media/missing.png' },
      querySelectors: { 'img[src]': image, video: null, '.broken-include-placeholder': null },
      card: createFakeCard(2, 5)
    });
    const brokenIncludeBadge = createFakeElement({
      classNames: ['include-broken'],
      attributes: { 'data-include-path': 'docs/missing.md' },
      querySelectors: { 'img[src]': null, video: null, '.broken-include-placeholder': null },
      card: null
    });
    const container = {
      querySelectorAll(selector) {
        expect(selector).toContain('.embed-broken');
        expect(selector).toContain('.include-broken');
        return [brokenEmbed, brokenIncludeBadge];
      }
    };

    const items = OrderHelpers.scanBrokenElementsFromContainer(container);

    expect(items).toEqual([
      {
        type: 'image',
        src: 'media/missing.png',
        colIndex: 2,
        cardIndex: 5
      },
      {
        type: 'include',
        src: 'docs/missing.md',
        colIndex: -1,
        cardIndex: -1
      }
    ]);
  });

  it('collects browser-fallback embeds and wysiwyg media failures as broken elements', () => {
    const brokenExternal = createFakeElement({
      classNames: ['external-embed-container'],
      attributes: {
        'data-embed-url': 'https://example.com/embed',
        'data-external-policy-action': 'open_in_browser',
        'data-external-policy-reason': 'Blocked by iframe policy'
      },
      querySelectors: { 'img[src]': null, video: null, audio: null, '.broken-include-placeholder': null },
      card: null
    });
    const brokenWysiwygImage = createFakeElement({
      classNames: ['wysiwyg-media', 'image-broken'],
      attributes: {
        'data-file-path': 'media/missing-diagram.png',
        'data-media-type': 'image'
      },
      querySelectors: { 'img[src]': null, video: null, audio: null, '.broken-include-placeholder': null },
      card: createFakeCard(1, 2)
    });
    const container = {
      querySelectorAll() {
        return [brokenExternal, brokenWysiwygImage];
      }
    };

    const items = OrderHelpers.scanBrokenElementsFromContainer(container);

    expect(items).toEqual([
      {
        type: 'external',
        src: 'https://example.com/embed',
        colIndex: -1,
        cardIndex: -1,
        reason: 'Blocked by iframe policy'
      },
      {
        type: 'image',
        src: 'media/missing-diagram.png',
        colIndex: 1,
        cardIndex: 2
      }
    ]);
  });

  it('prefers the active workspace-shell board container when scanning broken elements', () => {
    const iframeBroken = createFakeElement({
      classNames: ['embed-broken'],
      attributes: { 'data-file-path': 'iframe/missing.png' },
      querySelectors: { 'img[src]': null, video: null, audio: null, '.broken-include-placeholder': null },
      card: createFakeCard(7, 3)
    });
    const shellContainer = {
      querySelectorAll(selector) {
        expect(selector).toContain('.embed-broken');
        return [iframeBroken];
      }
    };
    const hostContainer = {
      querySelectorAll() {
        throw new Error('host container should not be scanned when shell container exists');
      }
    };

    initDashboardDeps({
      workspaceShellEnabled: true,
      WorkspaceShell: {
        getActiveBoardColumnsContainer: () => shellContainer
      },
      getElColumnsContainer: () => hostContainer
    });

    const items = OrderHelpers.scanBrokenElements();

    expect(items).toEqual([
      {
        type: 'embed',
        src: 'iframe/missing.png',
        colIndex: 7,
        cardIndex: 3
      }
    ]);
  });
});
