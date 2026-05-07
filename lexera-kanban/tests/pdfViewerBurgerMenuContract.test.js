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

  it('pdf.js plugin exposes window.LexeraPdfViewer with the three valid modes', () => {
    expect(pdfPluginJs).toMatch(/window\.LexeraPdfViewer/);
    // The mode keys are part of the public API surface used by
    // embedMenu.js; pin all three.
    expect(pdfPluginJs).toMatch(/scrolled\s*:\s*1/);
    expect(pdfPluginJs).toMatch(/overview\s*:\s*1/);
    expect(pdfPluginJs).toMatch(/stacked\s*:\s*1/);
  });

  it('pdf view-mode persistence routes through LexeraSettings (not raw localStorage)', () => {
    // Per the project-wide localStorageGuardrailContract: every new
    // file MUST go through LexeraSettings. Pin both that the plugin
    // uses the settings API and that the corresponding `pdfViewMode`
    // DEF is registered with the canonical storage key.
    expect(pdfPluginJs).not.toMatch(/localStorage\.(getItem|setItem)/);
    expect(pdfPluginJs).toMatch(/LexeraSettings/);
    expect(pdfPluginJs).toMatch(/['"]pdfViewMode['"]/);
    expect(settingsStoreJs).toMatch(/pdfViewMode\s*:\s*\{[^}]*lexera-pdf-view-mode/);
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

  it('embedMenu.js handles the pdf-view-* actions by calling LexeraPdfViewer.writeMode + applyModeToAll', () => {
    expect(embedMenuJs).toMatch(/action === ['"]pdf-view-scrolled['"]/);
    expect(embedMenuJs).toMatch(/LexeraPdfViewer\.writeMode/);
    expect(embedMenuJs).toMatch(/LexeraPdfViewer\.applyModeToAll/);
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
