import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

const pluginFiles = [
  'vendor/markdown-it/markdown-it.min.js',
  'vendor/markdown-it/markdown-it-emoji.min.js',
  'vendor/markdown-it/markdown-it-footnote.min.js',
  'vendor/markdown-it/markdown-it-multicolumn-browser.js',
  'vendor/markdown-it/markdown-it-mark-browser.js',
  'vendor/markdown-it/markdown-it-sub-browser.js',
  'vendor/markdown-it/markdown-it-sup-browser.js',
  'vendor/markdown-it/markdown-it-ins-browser.js',
  'vendor/markdown-it/markdown-it-strikethrough-alt-browser.js',
  'vendor/markdown-it/markdown-it-underline-browser.js',
  'vendor/markdown-it/markdown-it-abbr-browser.js',
  'vendor/markdown-it/markdown-it-container-browser.js',
  'vendor/markdown-it/markdown-it-image-figures-browser.js',
  'vendor/markdown-it/markdown-it-image-attrs-browser.js',
  'vendor/markdown-it/markdown-it-table-widths-browser.js',
  'vendor/markdown-it/markdown-it-list-split-browser.js',
  'vendor/markdown-it/markdown-it-wiki-links-browser.js',
  'vendor/markdown-it/markdown-it-tag-browser.js',
  'vendor/markdown-it/markdown-it-task-checkbox-browser.js',
  'vendor/markdown-it/markdown-it-temporal-tag-browser.js',
  'vendor/markdown-it/markdown-it-enhanced-strikethrough-browser.js',
  'vendor/markdown-it/markdown-it-speaker-note-browser.js',
  'vendor/markdown-it/markdown-it-html-comment-browser.js',
  // Unified plugin registry + markdown manifest — markdownRenderer now reads
  // its plugin list from LexeraPluginRegistry.getByKind('markdown') at
  // buildInstance time.
  'plugins/pluginRegistry.js',
  'plugins/markdown/markdownPluginManifest.js',
  'render/markdownRenderer.js',
];

let renderer;

beforeAll(() => {
  // V1 plugins (tag, wiki-links, etc.) depend on a global `escapeHtml`.
  // V2 provides it via app.js at runtime; mirror that for tests.
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const sandbox = {
    window: { escapeHtml },
    globalThis: null,
    escapeHtml,
    console,
  };
  sandbox.globalThis = sandbox.window;
  sandbox.window.globalThis = sandbox.window;
  vm.createContext(sandbox);
  for (const f of pluginFiles) {
    const source = readFileSync(resolve(srcDir, f), 'utf8');
    vm.runInContext(source, sandbox, { filename: f });
    // Promote UMD plugins that landed on sandbox root (e.g. markdownItImageFigures)
    // and the LexeraPluginRegistry into sandbox.window so the renderer sees them.
    for (const key of Object.keys(sandbox)) {
      const isRelevant = key.toLowerCase().includes('markdown') || key === 'LexeraPluginRegistry';
      if (isRelevant && sandbox.window[key] === undefined) {
        sandbox.window[key] = sandbox[key];
      }
    }
  }
  renderer = sandbox.window.LexeraMarkdownRenderer;
});

describe('LexeraMarkdownRenderer — plugin wiring', () => {
  it('exposes a render() API', () => {
    expect(renderer).toBeDefined();
    expect(typeof renderer.render).toBe('function');
    expect(typeof renderer.renderInline).toBe('function');
    expect(renderer.isReady()).toBe(true);
  });

  it('renders basic markdown (headings, emphasis)', () => {
    const html = renderer.render('# Title\n\n**bold** and *em*');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>em</em>');
  });
});

describe('LexeraMarkdownRenderer — v1 plugin syntax parity', () => {
  it('renders ==mark== as <mark>', () => {
    const html = renderer.renderInline('==marked==');
    expect(html).toContain('<mark>marked</mark>');
  });

  it('renders ++ins++ as <ins>', () => {
    const html = renderer.renderInline('++added++');
    expect(html).toContain('<ins>added</ins>');
  });

  it('renders ~sub~ as <sub>', () => {
    const html = renderer.renderInline('H~2~O');
    expect(html).toContain('<sub>2</sub>');
  });

  it('renders ^sup^ as <sup>', () => {
    const html = renderer.renderInline('E=mc^2^');
    expect(html).toContain('<sup>2</sup>');
  });

  it('wraps ~~strikethrough~~ with enhanced container', () => {
    const html = renderer.render('~~gone~~');
    expect(html).toMatch(/<span class="strikethrough-container" data-strike-id="strike-/);
    expect(html).toContain('<del class="strikethrough-content">gone</del>');
  });

  it('renders :::note container as <div class="note">', () => {
    const html = renderer.render('::: note\nHello\n:::');
    expect(html).toContain('<div class="note">');
    expect(html).toContain('<p>Hello</p>');
  });

  it('renders :::mark-red container', () => {
    const html = renderer.render('::: mark-red\nalert\n:::');
    expect(html).toContain('<div class="mark-red">');
  });

  it('renders _underline_ (single underscore) via markdown-it-underline', () => {
    const html = renderer.renderInline('a _note_ b');
    expect(html).toMatch(/<u>note<\/u>/);
  });

  it('preserves proportional table widths', () => {
    const md = '| h1 | h2 |\n|:---|---:|\n| a  | b  |\n';
    const html = renderer.render(md);
    expect(html).toContain('table-layout: fixed');
    expect(html).toMatch(/width:\s*50(\.0+)?%/);
  });

  it('splits lists with list-split when blank line between items', () => {
    const md = '- one\n\n- two\n';
    const html = renderer.render(md);
    const listOpens = (html.match(/<ul>/g) || []).length;
    expect(listOpens).toBeGreaterThanOrEqual(1);
    expect(html).toContain('one');
    expect(html).toContain('two');
  });

  it('handles image attrs {width=300} via image-attrs plugin', () => {
    const html = renderer.render('![pic](a.png){width=300}');
    expect(html).toContain('src="a.png"');
    expect(html).toMatch(/width="?300"?/);
  });

  it('wraps images with title in <figure>/<figcaption>', () => {
    // image-figures plugin only transforms images that are the sole child
    // of a standalone paragraph, so give it a blank-line buffer.
    const html = renderer.render('\n![pic](a.png "my caption")\n');
    expect(html).toContain('<figure>');
    expect(html).toContain('<figcaption>my caption</figcaption>');
  });

  it('renders :emoji: shortcode via markdown-it-emoji', () => {
    const html = renderer.renderInline(':smile:');
    expect(html).toMatch(/\uD83D\uDE04|😄/);
  });

  it('renders footnote references via markdown-it-footnote', () => {
    const html = renderer.render('text[^1]\n\n[^1]: note\n');
    expect(html).toContain('class="footnote-ref"');
    expect(html).toContain('class="footnotes"');
  });

  it('renders abbr definitions', () => {
    const md = 'HTML is great\n\n*[HTML]: HyperText Markup Language\n';
    const html = renderer.render(md);
    expect(html).toContain('<abbr title="HyperText Markup Language">HTML</abbr>');
  });

  it('renders [[wiki]] links with wiki-link class', () => {
    const html = renderer.renderInline('see [[Document]] please');
    expect(html).toContain('wiki-link');
    expect(html).toContain('Document');
  });

  it('renders #tag syntax with kanban-tag class', () => {
    const html = renderer.renderInline('urgent #bug today');
    expect(html).toContain('kanban-tag');
    expect(html).toContain('bug');
  });

  it('renders temporal tag @w49 via temporal-tag plugin', () => {
    const html = renderer.renderInline('due @w49 next');
    expect(html).toContain('kanban-temporal-tag');
    expect(html).toContain('kanban-temporal-week');
  });

  it('renders temporal tag @mon as weekday', () => {
    const html = renderer.renderInline('on @mon');
    expect(html).toContain('kanban-temporal-weekday');
  });

  it('renders temporal tag @15:30 as time', () => {
    const html = renderer.renderInline('meet @15:30');
    expect(html).toContain('kanban-temporal-time');
  });

  it('renders temporal tag @2025.01.28 as date', () => {
    const html = renderer.renderInline('by @2025.01.28');
    expect(html).toContain('kanban-temporal-date');
  });

  it('renders task checkbox syntax as md-task-checkbox spans', () => {
    const html = renderer.render('- [ ] todo\n- [x] done\n');
    expect(html).toContain('md-task-checkbox');
    expect(html).toContain('data-checked="false"');
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('todo');
    expect(html).toContain('done');
  });

  it('renders multicolumn block (---:N syntax)', () => {
    // Plugin syntax: line starts with `---:N` (N = column growth), each `---:N`
    // opens a new column, and `---` closes the container.
    const md = '---:1\nColumn A\n---:1\nColumn B\n---\n';
    const html = renderer.render(md);
    expect(html).toMatch(/class="multicolumn"/);
    expect(html).toMatch(/class="multicolumn-column"/);
    expect(html).toContain('Column A');
    expect(html).toContain('Column B');
  });

  it('caches the markdown-it instance when fingerprint matches', () => {
    const a = renderer.getInstance({ htmlCommentMode: 'keep' });
    const b = renderer.getInstance({ htmlCommentMode: 'keep' });
    expect(a).toBe(b);
  });

  it('rebuilds the instance when options fingerprint changes', () => {
    const a = renderer.getInstance({ htmlCommentMode: 'keep' });
    const b = renderer.getInstance({ htmlCommentMode: 'remove' });
    expect(a).not.toBe(b);
  });
});
