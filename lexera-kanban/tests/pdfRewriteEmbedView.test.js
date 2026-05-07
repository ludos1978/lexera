// Pure-logic tests for `LexeraPdfViewer._test_rewriteEmbedView`, the
// markdown-source rewriter that powers the burger menu's per-embed
// "PDF View: …" picks. The function takes:
//
//   rewriteEmbedView(content, filePath, targetIndex, mode) → newContent
//
// where `targetIndex` is the embed-counter the inline renderer uses
// for `data-embed-index` (so multiple PDFs in the same card can be
// disambiguated). The function rewrites only the matching `![](…)`
// occurrence — every other inline image / non-matching path stays
// byte-identical.

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

let rewriteEmbedView;

beforeAll(() => {
  // The plugin auto-registers with LexeraPluginRegistry at IIFE time,
  // so the loader needs both globals stubbed; we don't care about the
  // registration result, only the API surfaced on
  // `window.LexeraPdfViewer._test_rewriteEmbedView`.
  const code = readFileSync(
    resolve(__dirname, '..', 'src', 'plugins', 'formats', 'pdf.js'),
    'utf8'
  );
  const sandbox = {
    LexeraPluginRegistry: { register() {} },
    LexeraFileFormatHelpers: {
      buildExportConfig() { return {}; },
      pageSuffix() { return ''; },
      makeRenderFile() { return function () {}; },
      makeSpecialPreviewEmit() { return function () { return ''; }; }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'pdf.js' });
  rewriteEmbedView = sandbox.LexeraPdfViewer._test_rewriteEmbedView;
});

describe('rewriteEmbedView', () => {
  it('appends {view=…} to a bare embed (no existing attrs block)', () => {
    const out = rewriteEmbedView(
      '![](Media/sample.pdf)',
      'Media/sample.pdf',
      0,
      'stacked'
    );
    expect(out).toBe('![](Media/sample.pdf){view=stacked}');
  });

  it('replaces an existing view= attribute in place', () => {
    const out = rewriteEmbedView(
      '![](Media/sample.pdf){view=overview}',
      'Media/sample.pdf',
      0,
      'stacked'
    );
    expect(out).toBe('![](Media/sample.pdf){view=stacked}');
  });

  it('preserves other attributes when adding view=', () => {
    // Existing `width=` must survive untouched; the `view=` is appended.
    const out = rewriteEmbedView(
      '![sample](Media/sample.pdf){width=400}',
      'Media/sample.pdf',
      0,
      'overview'
    );
    expect(out).toBe('![sample](Media/sample.pdf){width=400 view=overview}');
  });

  it('preserves other attributes when replacing view=', () => {
    const out = rewriteEmbedView(
      '![](Media/sample.pdf){width=400 view=scrolled height=200}',
      'Media/sample.pdf',
      0,
      'stacked'
    );
    expect(out).toBe('![](Media/sample.pdf){width=400 view=stacked height=200}');
  });

  it('only rewrites the embed at the given target index — others are byte-identical', () => {
    const src =
      'first: ![](Media/a.pdf)\n' +
      'second: ![](Media/b.pdf)\n' +
      'third: ![](Media/c.pdf)\n';
    const out = rewriteEmbedView(src, 'Media/b.pdf', 1, 'overview');
    expect(out).toBe(
      'first: ![](Media/a.pdf)\n' +
      'second: ![](Media/b.pdf){view=overview}\n' +
      'third: ![](Media/c.pdf)\n'
    );
  });

  it('skips the targeted match when the file path does not equal the embed at that index', () => {
    // Defensive: if the embed-index disambiguator picks a position
    // whose path doesn't match the embed we expected to update (e.g.
    // the markdown was edited between render and click), leave the
    // content unchanged rather than corrupting an unrelated embed.
    const src = '![](Media/a.pdf)\n![](Media/b.pdf)\n';
    const out = rewriteEmbedView(src, 'Media/c.pdf', 0, 'stacked');
    expect(out).toBe(src);
  });

  it('preserves a Markdown title in the path part', () => {
    // `![alt](path "title")` — the title should stay verbatim.
    const out = rewriteEmbedView(
      '![alt](Media/sample.pdf "Sample title")',
      'Media/sample.pdf',
      0,
      'stacked'
    );
    expect(out).toBe('![alt](Media/sample.pdf "Sample title"){view=stacked}');
  });

  it('returns the input unchanged when no embed matches the target index', () => {
    expect(rewriteEmbedView('no embeds here', 'foo.pdf', 0, 'stacked'))
      .toBe('no embeds here');
  });
});
