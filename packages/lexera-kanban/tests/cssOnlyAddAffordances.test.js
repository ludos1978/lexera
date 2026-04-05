import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8');
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');

describe('css-only empty-child add affordances', () => {
  it('renders row, stack, and column add affordances without JS emptiness branches', () => {
    expect(appJs).not.toContain('if (col.cards.length === 0) {');
    expect(appJs).not.toContain('if (stackColumnEntries.length === 0) {');
    expect(appJs).not.toContain('if (rowStacks.length === 0) {');

    expect(appJs).toContain('function buildColumnFooterContent(colIndex) {');
    expect(appJs).toContain("footer.appendChild(buildColumnFooterContent(col.index));");
    expect(appJs).toContain("stackContent.appendChild(emptyColumns);");
    expect(appJs).toContain("rowContent.appendChild(emptyStacks);");
    expect(appJs).toContain("getElColumnsContainer().appendChild(emptyRows);");
    expect(appJs).toContain("if (!rows || rows.length === 0) return;");
  });

  it('uses CSS structure selectors to hide add affordances when children exist', () => {
    expect(appCss).toContain('.columns-container.new-format:has(> .board-row) > .board-level-empty-rows');
    expect(appCss).toContain('.board-row-content:has(> .board-stack) > .board-level-empty-stacks');
    expect(appCss).toContain('.board-row-content:has(> .canvas-scene > .board-stack) > .board-level-empty-stacks');
    expect(appCss).toContain('.board-stack-content:has(> .column) > .board-level-empty-columns');
    expect(appCss).toContain('.column:has(> .column-cards > .card) > .column-footer:not(:has(.add-card-input))');
  });
});
