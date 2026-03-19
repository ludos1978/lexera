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
    const moduleSource = readSource('tagcolors/tagColors.js');
    const cssSource = readSource('app.css');

    expect(appSource.includes("descriptor.normalizedTag === 'surface' && entityType !== 'card'")).toBe(false);
    expect(appSource.includes("applyTagStyleToEntity(getElBoardHeader(), activeBoardData && activeBoardData.title ? activeBoardData.title : '')")).toBe(true);
    expect(appSource.includes("applyTagStyleToEntity(cardEl, getCardContainerStyleSource(card.content || ''))")).toBe(true);
    expect(appSource.includes('skipFirstLineTagStyle: true')).toBe(true);
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
});
