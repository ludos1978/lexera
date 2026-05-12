import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function readSource(name) {
  return readFileSync(resolve(srcDir, name), 'utf-8');
}

describe('tag style rendering parity', () => {
  it('keeps explicit named color tag mappings instead of hashing them', () => {
    const moduleSource = readSource('tagcolors/tagColors.js');
    const tagColorsMatch = moduleSource.match(/var TAG_COLORS = \{[\s\S]*?\n  \};/);
    expect(tagColorsMatch).not.toBeNull();
    const tagColors = new Function(`${tagColorsMatch[0]}; return TAG_COLORS;`)();

    expect(tagColors['#red']).toBe('#DC3545');
    expect(tagColors['#blue']).toBe('#0056B3');
    expect(tagColors['#green']).toBe('#198754');
    expect(tagColors['#dark-red']).toBe('#8B0000');
    expect(tagColors['#light-blue']).toBe('#A3D3FF');
    expect(tagColors['#accessible-indigo']).toBe('#332288');
  });

  it('allows surface-style tags on all styled entities and the board header', () => {
    const appSource = readSource('app.js');
    const boardHeaderSource = readSource('board/boardHeader.js');
    const moduleSource = readSource('tagcolors/tagColors.js');
    const cssSource = readSource('app.css');
    const combinedAppSource = appSource + boardHeaderSource;

    expect(combinedAppSource.includes("descriptor.normalizedTag === 'surface' && entityType !== 'card'")).toBe(false);
    // Board header tag styling is applied via _callDep in boardHeader.js module
    expect(boardHeaderSource.includes("_callDep('applyTagStyleToEntity', boardHeaderEl")).toBe(true);
    expect(combinedAppSource.includes("applyTagStyleToEntity(cardEl, getCardContainerStyleSource(card.content || ''))")).toBe(true);
    expect(combinedAppSource.includes('skipFirstLineTagStyle: true')).toBe(true);
    expect(moduleSource.includes('buildCombinedTagStyleDescriptor(styleTags)')).toBe(true);
    expect(cssSource.includes('.board-header.tag-styled')).toBe(true);
    expect(cssSource.includes('.tag-line-styled')).toBe(true);
  });

  it('does not re-render tag labels or badge rails into headers/footers', () => {
    const appSource = readSource('app.js');
    expect(appSource.includes('renderTagStyleBadgeRail(')).toBe(false);
    expect(appSource.includes('buildTagStyleBadgeDescriptor(')).toBe(false);
    expect(appSource.includes("setAttribute('data-tag-style-label'")).toBe(false);
  });

  it('does not include generated tag label or badge CSS hooks', () => {
    const cssSource = readSource('app.css');
    expect(cssSource.includes('data-tag-style-label')).toBe(false);
    expect(cssSource.includes('.tag-style-badge-rail')).toBe(false);
    expect(cssSource.includes('.tag-style-badge')).toBe(false);
  });

  it('renders inline tag chips with a visible border treatment', () => {
    const appSource = readSource('app.js');
    const embedMenuSource = readSource('menu/embedMenu.js');
    const cssSource = readSource('app.css');
    const combinedSource = appSource + embedMenuSource;

    expect(combinedSource.includes('function renderTagChipHtml(tag)')).toBe(true);
    expect(combinedSource.includes('--tag-chip-border-color:')).toBe(true);
    expect(cssSource.includes('--tag-chip-border-color')).toBe(true);
  });

  it('keeps the card left tag border on the same spine width token as normal cards', () => {
    const cssSource = readSource('app.css');
    expect(cssSource).toContain('.card.tag-styled[data-tag-border-position="left"]');
    expect(cssSource).toContain('border-left: var(--tag-border-width, var(--spine-card-width))');
  });
});
