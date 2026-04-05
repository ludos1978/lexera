import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');

describe('kanban font unification css', () => {
  it('keeps the non-canvas font override block for major board elements', () => {
    expect(appCss).toContain('.columns-container:not(.layout-canvas) .board-row-title');
    expect(appCss).toContain('.columns-container:not(.layout-canvas) .board-stack-title');
    expect(appCss).toContain('.columns-container:not(.layout-canvas) .column-header');
    expect(appCss).toContain('.columns-container:not(.layout-canvas) .card');
    expect(appCss).toContain('.columns-container:not(.layout-canvas) .card h1');
    expect(appCss).toContain('.columns-container:not(.layout-canvas) .card code');
    expect(appCss).toContain('.columns-container:not(.layout-canvas) .card .tag');
    expect(appCss).toContain('.columns-container:not(.layout-canvas) .add-card-btn');
    expect(appCss).toContain('.columns-container:not(.layout-canvas) .add-entity-btn');
    expect(appCss).toContain('font-size: var(--board-font-size, var(--font-size-base));');
  });

  it('keeps canvas mode outside the kanban-only font override block', () => {
    expect(appCss).toContain('.columns-container.layout-canvas {');
    expect(appCss).toContain('.columns-container:not(.layout-canvas)');
  });
});
