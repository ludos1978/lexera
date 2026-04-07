import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');
const appJs = readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8');
const indexHtml = readFileSync(resolve(__dirname, '..', 'src', 'index.html'), 'utf8');
const fontsCss = readFileSync(resolve(__dirname, '..', 'src', 'fonts.css'), 'utf8');

describe('kanban font unification css', () => {
  it('keeps one board font override block for major board elements in both kanban and canvas', () => {
    expect(appCss).toContain('.columns-container .board-row-title');
    expect(appCss).toContain('.columns-container .board-stack-title');
    expect(appCss).toContain('.columns-container .column-header');
    expect(appCss).toContain('.columns-container .card');
    expect(appCss).toContain('.columns-container .card h1');
    expect(appCss).toContain('.columns-container .card code');
    expect(appCss).toContain('.columns-container .card .tag');
    expect(appCss).toContain('.columns-container .add-card-btn');
    expect(appCss).toContain('.columns-container .add-entity-btn');
    expect(appCss).toContain('font-size: var(--board-font-size, var(--font-size-base));');
    expect(appCss).not.toContain('.columns-container:not(.layout-canvas) .board-row-title');
  });

  it('keeps canvas layout behavior while sharing the same board typography contract', () => {
    expect(appCss).toContain('.columns-container.layout-canvas {');
    expect(appCss).toContain('Canvas still zooms as a scene');
    expect(appCss).toContain('font-size: var(--board-font-size, var(--font-size-base));');
  });

  it('uses the shared base font token for shell and board fallbacks', () => {
    expect(appCss).toContain('body {');
    expect(appCss).toContain('font-size: var(--font-size-base);');
    expect(appCss).toContain('font-size: var(--board-font-size, var(--font-size-base));');
  });

  it('loads the local Poppins font bundle used by the board and shell typography', () => {
    expect(indexHtml).toContain('<link rel="stylesheet" href="fonts.css">');
    expect(fontsCss).toContain("font-family: 'Poppins';");
    expect(fontsCss).toContain("url('fonts/Poppins-Regular.ttf') format('truetype')");
    expect(fontsCss).toContain("url('fonts/Poppins-Medium.ttf') format('truetype')");
    expect(fontsCss).toContain("url('fonts/Poppins-SemiBold.ttf') format('truetype')");
    expect(fontsCss).toContain("url('fonts/Poppins-Bold.ttf') format('truetype')");
  });

  it('normalizes legacy board font settings before applying them to board css vars', () => {
    expect(appJs).toContain('var normalizedFontSize = normalizeBoardFontSizeValue(s.fontSize);');
    expect(appJs).toContain("var resolvedFontFamily = resolveBoardFontFamilyValue(normalizeBoardFontFamilyToken(s.fontFamily));");
    expect(appJs).toContain("container.style.setProperty('--board-font-size', normalizedFontSize);");
    expect(appJs).toContain("container.style.setProperty('--board-font-family', resolvedFontFamily);");
  });
});
