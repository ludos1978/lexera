// Pin: PDF preview uses pdfjs-dist canvas rendering (not the legacy
// browser-iframe viewer) AND its three view modes are wired into the
// embed burger menu — never into a right-click or hover element.
//
// Why this contract exists: WKWebView's native PDF viewer ships a
// floating mini-toolbar that ignores `#toolbar=0&navpanes=0` and was
// breaking the kanban's clean-card aesthetic. The fix swapped the
// `<iframe>` for a PDF.js canvas render with three modes (scrolled /
// overview / stacked) selectable from the same `.embed-menu-btn`
// burger dropdown that already overlays PDFs. The user has been
// explicit that settings must NOT be exposed via right-click or
// hover. This test fences both invariants.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfPluginJs = readFileSync(
  resolve(__dirname, '..', 'src', 'plugins', 'formats', 'pdf.js'),
  'utf8'
);
const embedMenuJs = readFileSync(
  resolve(__dirname, '..', 'src', 'menu', 'embedMenu.js'),
  'utf8'
);
const indexHtml = readFileSync(
  resolve(__dirname, '..', 'src', 'index.html'),
  'utf8'
);
const settingsStoreJs = readFileSync(
  resolve(__dirname, '..', 'src', 'core', 'settingsStore.js'),
  'utf8'
);

describe('PDF preview — pdfjs-dist + burger-menu view modes', () => {
  it('vendors pdfjs-dist UMD bundle + worker', () => {
    expect(existsSync(resolve(__dirname, '..', 'src', 'vendor', 'pdfjs', 'pdf.min.js'))).toBe(true);
    expect(existsSync(resolve(__dirname, '..', 'src', 'vendor', 'pdfjs', 'pdf.worker.min.js'))).toBe(true);
  });

  it('index.html loads pdfjs-dist before app scripts', () => {
    // The PDF plugin reads `window.pdfjsLib` at enhance() time, so the
    // UMD bundle must be in the script-tag list. Worker is loaded
    // lazily by the plugin (GlobalWorkerOptions.workerSrc) and does
    // not need its own <script>.
    expect(indexHtml).toMatch(/<script\s+src="vendor\/pdfjs\/pdf\.min\.js"\s*><\/script>/);
  });

  it('pdf.js plugin no longer creates an <iframe> for the preview', () => {
    // The legacy implementation created a `<iframe>` pointing at the
    // backend file URL with `#toolbar=0&navpanes=0`. The replacement
    // mounts a `<div class="pdf-viewer">` and calls pdfjsLib.getDocument.
    // Catching `createElement('iframe')` keeps the iframe path from
    // sneaking back in.
    expect(pdfPluginJs).not.toMatch(/createElement\(\s*['"]iframe['"]\s*\)/);
    expect(pdfPluginJs).not.toMatch(/#toolbar=0/);
    expect(pdfPluginJs).toMatch(/pdfjsLib\.getDocument/);
  });

  it('pdf.js plugin pre-fetches bytes via fetch() and passes them as `data:` (not `url:`) to pdfjsLib.getDocument', () => {
    // Background: PDF.js's `getDocument({ url })` path uses HTTP Range
    // requests against the URL. The custom `lexera-asset://` Tauri
    // scheme returns status 0 against that probe — user saw
    // "Failed to load PDF: Unexpected server response (0)".
    //
    // The fix routes through plain `fetch()` (which the asset protocol
    // does handle) → `arrayBuffer()` → `getDocument({ data, disableRange,
    // disableStream })`. A future regression that resurrects the URL
    // path would silently break PDF preview against the asset protocol;
    // this test catches it.
    expect(pdfPluginJs).toMatch(/fetch\(\s*url\b/);
    expect(pdfPluginJs).toMatch(/arrayBuffer\(\)/);
    expect(pdfPluginJs).toMatch(/getDocument\(\s*\{[\s\S]{0,200}\bdata\s*:/);
    expect(pdfPluginJs).toMatch(/disableRange\s*:\s*true/);
    expect(pdfPluginJs).toMatch(/disableStream\s*:\s*true/);
    // Belt and braces: the URL form must NOT come back. Catches a
    // patch that adds `getDocument({ url: url })` next to (or instead
    // of) the data form.
    expect(pdfPluginJs).not.toMatch(/getDocument\(\s*\{\s*url\s*:/);
  });

  it('pdf.js plugin exposes window.LexeraPdfViewer with the three valid modes', () => {
    expect(pdfPluginJs).toMatch(/window\.LexeraPdfViewer/);
    // The mode keys are part of the public API surface used by
    // embedMenu.js; pin all three.
    expect(pdfPluginJs).toMatch(/scrolled\s*:\s*1/);
    expect(pdfPluginJs).toMatch(/overview\s*:\s*1/);
    expect(pdfPluginJs).toMatch(/stacked\s*:\s*1/);
  });

  it('pdf plugin does NOT touch localStorage or LexeraSettings — view mode lives entirely in the markdown source', () => {
    // The original implementation routed view-mode through a
    // LexeraSettings flag. After the user clarified that scrolled is
    // the implicit default and `{view=…}` is the only configurable
    // signal, the global setting became misleading dead code. Pin
    // its absence so a future "let's add a global default" patch is
    // explicit instead of quietly bringing back the divergence.
    expect(pdfPluginJs).not.toMatch(/localStorage\.(getItem|setItem)/);
    expect(pdfPluginJs).not.toMatch(/LexeraSettings/);
    expect(pdfPluginJs).not.toMatch(/['"]pdfViewMode['"]/);
    expect(settingsStoreJs).not.toMatch(/pdfViewMode/);
    expect(settingsStoreJs).not.toMatch(/lexera-pdf-view-mode/);
  });

  it('embedMenu.js inserts PDF view-mode items into the burger menu (showEmbedMenu) for previewKind === pdf', () => {
    // The picker MUST be added inside showEmbedMenu — the burger-button
    // entry point. Right-click / hover paths build their own menus
    // (showBoardFileLinkMenu, showDiagramMenu, etc.) and must not
    // receive these items.
    const showEmbedMenuMatch = embedMenuJs.match(
      /async function showEmbedMenu\(container, btn\)\s*\{[\s\S]*?\n\s\s\}/
    );
    expect(showEmbedMenuMatch).not.toBeNull();
    const body = showEmbedMenuMatch[0];
    expect(body).toMatch(/previewKind\s*===\s*['"]pdf['"]/);
    expect(body).toMatch(/pdf-view-scrolled/);
    expect(body).toMatch(/pdf-view-overview/);
    expect(body).toMatch(/pdf-view-stacked/);
  });

  it('embedMenu.js handles the pdf-view-* actions by calling applyModeToEmbed (per-embed, writes markdown)', () => {
    // The picker is now per-embed: it persists the choice into the
    // card's markdown source as `{view=…}` instead of writing a single
    // global LexeraSettings flag. `applyModeToEmbed` is the entry
    // point that combines local viewer.setMode + DOM data-attr update
    // + markdown source rewrite.
    expect(embedMenuJs).toMatch(/action === ['"]pdf-view-scrolled['"]/);
    expect(embedMenuJs).toMatch(/LexeraPdfViewer\.applyModeToEmbed/);
  });

  it('parsed pdfDoc is cached per URL so a re-mount (after card re-render) skips fetch + getDocument', () => {
    // The user reported "the layout still changes a while after first
    // rendered" — the lag was the second mount triggered by the
    // burger picker's save flow re-fetching + re-parsing the same
    // file. Pin the cache so a future cleanup that moves cache logic
    // around can't quietly bring back the lag.
    expect(pdfPluginJs).toMatch(/_pdfDocCache\s*=\s*\{\s*\}/);
    expect(pdfPluginJs).toMatch(/_pdfDocCache\s*\[\s*url\s*\]/);
    // A cache HIT path must short-circuit before fetch.
    expect(pdfPluginJs).toMatch(
      /if\s*\(\s*_pdfDocCache\[\s*url\s*\]\s*\)[\s\S]{0,80}Promise\.resolve\(\s*_pdfDocCache\[\s*url\s*\]\s*\)/
    );
  });

  it('loading state reserves a min-height so the loading → rendered transition does not push parent layout', () => {
    // Without a min-height on `.pdf-viewer-loading`, the host shrank
    // to ~30px (just the text) during fetch+parse and then expanded
    // to ~360px (or full doc height in stacked mode) once pages
    // committed — visibly pulling the surrounding card layout up
    // and then down again.
    const appCss = readFileSync(
      resolve(__dirname, '..', 'src', 'app.css'),
      'utf8'
    );
    expect(appCss).toMatch(
      /\.pdf-viewer-loading[\s\S]{0,600}min-height:\s*\d+px/
    );
  });

  it('mountPdfViewer applies the mode class IMMEDIATELY (before fetch+parse) and commits all pages in one DocumentFragment', () => {
    // User reported "modifies the layout quite a bit after first
    // rendered". Two reflow sources had to be eliminated:
    //   (a) mode class applied late ⇒ host briefly rendered against
    //       the legacy .embed-preview-pdf rule and then resized when
    //       renderPages added pdf-mode-<X>.
    //   (b) renderPages appended pages one at a time inside a `.then`
    //       chain ⇒ N layout reflows for an N-page PDF.
    //
    // Pin both fixes:
    //   - mountPdfViewer must call applyModeClass(host, …) BEFORE
    //     the fetch starts.
    //   - renderPages must commit pages via a DocumentFragment
    //     (single appendChild on the host).
    const mountMatch = pdfPluginJs.match(
      /function\s+mountPdfViewer\s*\([^)]*\)\s*\{([\s\S]*?)\n\s\s\}\n/
    );
    expect(mountMatch).not.toBeNull();
    const mountBody = mountMatch[1];
    const fetchIdx = mountBody.indexOf('fetch(');
    const applyClassIdx = mountBody.indexOf('applyModeClass');
    expect(applyClassIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(applyClassIdx).toBeLessThan(fetchIdx);
    // renderPages: single fragment commit, no per-page appendChild.
    const renderMatch = pdfPluginJs.match(
      /function\s+renderPages\s*\([^)]*\)\s*\{([\s\S]*?)\n\s\s\}\n/
    );
    expect(renderMatch).not.toBeNull();
    const renderBody = renderMatch[1];
    expect(renderBody).toMatch(/createDocumentFragment\(\)/);
    expect(renderBody).toMatch(/container\.appendChild\(\s*frag\s*\)/);
    expect(renderBody).not.toMatch(/container\.appendChild\(\s*pageEl\s*\)/);
  });

  it('setMode is a CSS-only swap — no per-mode page re-render', () => {
    // Earlier each setMode call cancelled the in-flight render and
    // restarted renderPages() at the new mode's intrinsic resolution
    // (overview = 220 px, scrolled/stacked = 720 px). For an N-page
    // doc that meant N × ~300 ms before the new layout settled, with
    // pages flickering in one at a time. The user reported the lag
    // as "redraws after a long time, first vertically stacked, then
    // side-by-side".
    //
    // Fix: pages render once at RENDER_WIDTH_PX and CSS sizes them
    // for display per mode, so setMode can just swap the class. Pin
    // both halves so a future "let's render at the optimal mode
    // resolution" patch can't quietly bring back the lag.
    // Match `setMode: function (mode) { … }` by walking up to the
    // first `},` after the opening brace. Greedy regex over JS code
    // is fragile; this windowed match covers the whole body up to a
    // reasonable cap.
    const setModeMatch = pdfPluginJs.match(
      /setMode\s*:\s*function\s*\([^)]*\)\s*\{([\s\S]{0,800}?)\},/
    );
    expect(setModeMatch).not.toBeNull();
    const setModeBody = setModeMatch[1];
    expect(setModeBody).not.toMatch(/renderPages\(/);
    expect(setModeBody).toMatch(/applyModeClass\s*\(/);
    // The single intrinsic-resolution constant must still exist.
    expect(pdfPluginJs).toMatch(/RENDER_WIDTH_PX\s*=\s*\d+/);
    // And the per-mode width map must be gone (the old foot-gun).
    expect(pdfPluginJs).not.toMatch(/PAGE_WIDTH_BY_MODE/);
  });

  it('renderPageToCanvas does NOT set inline canvas.style.height (preserves aspect ratio in narrow containers)', () => {
    // Setting BOTH inline width AND inline height squashes the rendered
    // page when `max-width: 100%` clamps the displayed width — the user
    // reported "bad image aspect ratio" in stacked mode. Fix: only set
    // inline width; CSS uses `height: auto` so the intrinsic
    // `canvas.width × canvas.height` attributes drive the height.
    const renderFn = pdfPluginJs.match(
      /function\s+renderPageToCanvas\s*\([^)]*\)\s*\{[\s\S]*?\n\s\s\}/
    );
    expect(renderFn).not.toBeNull();
    expect(renderFn[0]).toMatch(/canvas\.style\.width\s*=/);
    expect(renderFn[0]).not.toMatch(/canvas\.style\.height\s*=/);
  });

  it('overview + stacked override the legacy `width: min(680px, 100%)` cap so the gallery uses every available pixel', () => {
    // The host element is .embed-preview-pdf — its base rule caps
    // width at 680 px (carry-over from the iframe styling). Modal
    // previews and wide cards have far more horizontal room than
    // that, and the cap was wasting the right ~30 % of the modal in
    // overview mode. Scrolled keeps the cap because >680 px single-
    // column hurts read flow; overview + stacked must explicitly
    // override.
    const appCss = readFileSync(
      resolve(__dirname, '..', 'src', 'app.css'),
      'utf8'
    );
    expect(appCss).toMatch(
      /\.embed-preview-pdf\.pdf-mode-overview[\s\S]{0,80}\.pdf-mode-stacked[\s\S]{0,200}width:\s*100%/
    );
  });

  it('overview mode CSS uses a small enough column min that narrow cards still pack 2+ columns', () => {
    // User reported "one page in half the width — still no gallery"
    // when the grid track minimum was 140 px: narrow cards (~250 px)
    // collapsed to a single column with the canvas centred inside,
    // visually identical to scrolled. Pin the small (100 px) min so a
    // future tightening can't bring back the collapse.
    const appCss = readFileSync(
      resolve(__dirname, '..', 'src', 'app.css'),
      'utf8'
    );
    expect(appCss).toMatch(
      /\.pdf-viewer\.pdf-mode-overview[^{]*\{[\s\S]*?grid-template-columns:\s*repeat\(\s*auto-fill\s*,\s*minmax\(\s*100px/
    );
    // Canvas must fill its grid cell, otherwise a "stretch" cell
    // with a fixed-width canvas inside reproduces the half-width
    // appearance even when the grid HAS multiple columns.
    expect(appCss).toMatch(
      /\.pdf-viewer\.pdf-mode-overview\s+\.pdf-page-canvas[^{]*\{[\s\S]*?width:\s*100%/
    );
  });

  it('stacked mode CSS lets the host grow (height: auto) so all pages are visible without inner scroll', () => {
    // The host element is BOTH `.embed-preview-pdf` (fixed height,
    // overflow:auto inherited from the legacy iframe styling) AND
    // `.pdf-viewer`. Without a mode-class override on
    // `.embed-preview-pdf.pdf-mode-stacked`, pages 2..N rendered into
    // the host but were clipped behind the 360 px box and only page 1
    // was visible.
    const appCss = readFileSync(
      resolve(__dirname, '..', 'src', 'app.css'),
      'utf8'
    );
    expect(appCss).toMatch(
      /\.embed-preview-pdf\.pdf-mode-stacked[^{]*\{[\s\S]*?height:\s*auto/
    );
    expect(appCss).toMatch(
      /\.embed-preview-pdf\.pdf-mode-stacked[^{]*\{[\s\S]*?overflow:\s*visible/
    );
  });

  it('inlineRenderer emits data-pdf-view on the embed container when the markdown carries {view=…}', () => {
    // Per-embed view-mode override syntax: `![](sample.pdf){view=stacked}`.
    // The renderer must:
    //   - validate the value (only scrolled/overview/stacked are emitted)
    //   - serialize as `data-pdf-view="<value>"` on the embed container
    // A typo or unknown value silently falls back to scrolled (the
    // implicit default) — the data-attribute is never emitted in that
    // case.
    const inlineJs = readFileSync(
      resolve(__dirname, '..', 'src', 'render', 'inlineRenderer.js'),
      'utf8'
    );
    expect(inlineJs).toMatch(/imageAttrs\.values\.view/);
    expect(inlineJs).toMatch(/['"]scrolled['"]\s*\|\|/);
    expect(inlineJs).toMatch(/['"]overview['"]\s*\|\|/);
    expect(inlineJs).toMatch(/['"]stacked['"]\s*\)/);
    expect(inlineJs).toMatch(/data-pdf-view=/);
  });

  it('pdf.js plugin honours data-pdf-view as the initial-mode override, falling back to DEFAULT_MODE (scrolled)', () => {
    // The plugin reads `container.getAttribute('data-pdf-view')` and
    // uses it iff valid; empty / invalid values fall through to
    // DEFAULT_MODE (scrolled). No LexeraSettings lookup.
    expect(pdfPluginJs).toMatch(/getAttribute\(\s*['"]data-pdf-view['"]\s*\)/);
    expect(pdfPluginJs).toMatch(/VALID_MODES\[\s*perEmbedView\s*\]\s*\?\s*perEmbedView\s*:\s*DEFAULT_MODE/);
  });

  it('modal preview synthesizes data-pdf-view from the source card so {view=…} carries through', () => {
    // Modal preview builds a fresh `.embed-container` from
    // (boardId, filePath) — without explicit propagation it would
    // lose the source's `{view=…}` and fall back to the global
    // default. The fix queries the live DOM for the source card
    // embed (`.embed-container[data-file-path="…"][data-pdf-view]`)
    // and forwards its attribute. Best-effort: if the source isn't
    // in the same webview the lookup returns null and the modal
    // falls through to the default. Pin the lookup wiring so a
    // future refactor can't quietly drop it.
    expect(embedMenuJs).toMatch(/\.embed-container\[data-file-path/);
    expect(embedMenuJs).toMatch(/\[data-pdf-view\]/);
    expect(embedMenuJs).toMatch(/sourceEmbed\.getAttribute\(\s*['"]data-pdf-view['"]\s*\)/);
    // The synthesized modal `.embed-container` line must include the
    // optional `pdfViewAttr` so the propagated value lands in the DOM.
    expect(embedMenuJs).toMatch(/embed-container-modal[\s\S]{0,400}pdfViewAttr/);
  });

  it('embedMenu.js does NOT wire pdf-view-* into the right-click contextmenu path', () => {
    // The right-click handler builds menuItems literally inline; we
    // catch any future regression that adds pdf-view items there.
    const contextmenuBlock = embedMenuJs.match(
      /document\.addEventListener\(\s*['"]contextmenu['"][\s\S]*?\}\s*\}\s*,\s*true\s*\)/
    ) || embedMenuJs.match(
      /document\.addEventListener\(\s*['"]contextmenu['"][\s\S]{0,8000}/
    );
    expect(contextmenuBlock).not.toBeNull();
    expect(contextmenuBlock[0]).not.toMatch(/pdf-view-scrolled/);
    expect(contextmenuBlock[0]).not.toMatch(/pdf-view-overview/);
    expect(contextmenuBlock[0]).not.toMatch(/pdf-view-stacked/);
  });
});
