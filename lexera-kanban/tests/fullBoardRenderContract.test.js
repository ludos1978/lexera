import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8');
const rowStackMenuJs = readFileSync(resolve(__dirname, '..', 'src', 'menu', 'rowStackMenu.js'), 'utf8');
const actionRegistrationsJs = readFileSync(resolve(__dirname, '..', 'src', 'core', 'actionRegistrations.js'), 'utf8');

describe('full-board-render contract', () => {
  // Targeted persistence (column / stack / row / card-insert / card-remove)
  // is the default — every mutation is expected to refresh the smallest
  // possible scope. A handful of mutations genuinely change the entire
  // board's structure or display rules and DO need a full board render.
  // This test pins that exact set so a refactor can't (a) accidentally
  // promote a targeted mutation to full-board (perf regression), nor
  // (b) demote one of these to a targeted refresh (correctness bug —
  // hidden display indices and class derivations would not refresh).

  it('row hidden-tag mutation requests a full board render', () => {
    // Hiding a row changes which display rows are visible at all — display
    // indices for every row below shift, so a per-row target would write
    // to the wrong slot. The comment in setRowHiddenTag explicitly calls
    // this out.
    const setRowHiddenTagBlock = rowStackMenuJs.match(/async function setRowHiddenTag[\s\S]*?\n  \}/);
    expect(setRowHiddenTagBlock, 'setRowHiddenTag function must exist in rowStackMenu.js').toBeTruthy();
    expect(setRowHiddenTagBlock[0]).toMatch(/persistBoardMutation\(\s*\{\s*targets:\s*\[\s*\{\s*type:\s*['"]board['"]\s*\}\s*,\s*\{\s*type:\s*['"]sidebar['"]\s*\}/);
  });

  it('stack hidden-tag mutation uses a row-targeted refresh (not full board)', () => {
    // Hiding a stack does NOT remove the parent row — the row's
    // displayRowIdx stays stable, so targeting the row is correct and
    // avoids the full-board renderColumns() path. Soft-delete / archive /
    // park on a stack all share this code path.
    const setStackHiddenTagBlock = rowStackMenuJs.match(/async function setStackHiddenTag[\s\S]*?\n  \}/);
    expect(setStackHiddenTagBlock, 'setStackHiddenTag function must exist in rowStackMenu.js').toBeTruthy();
    expect(setStackHiddenTagBlock[0]).toMatch(/persistBoardMutation\(\s*\{[\s\S]*targets:\s*\[\s*\{\s*type:\s*['"]row['"]/);
    expect(setStackHiddenTagBlock[0]).not.toMatch(/targets:\s*\[\s*\{\s*type:\s*['"]board['"]/);
  });

  it('board frontmatter changes request a full board render', () => {
    // Frontmatter drives valid-flag, MARP rendering, and per-board
    // settings via the YAML header — mass display behavior change.
    const setFrontmatterBlock = appJs.match(/async function setBoardFrontmatterValue[\s\S]{0,800}?persistBoardMutation\([^)]+\)/);
    expect(setFrontmatterBlock, 'setBoardFrontmatterValue must call persistBoardMutation').toBeTruthy();
    expect(setFrontmatterBlock[0]).toMatch(/type:\s*['"]board['"]/);
  });

  it('board settings (per-board key/value) changes request a full board render', () => {
    // Board settings determine layout (kanban vs canvas), filters, etc. —
    // a single setting flip can re-key everything visible.
    const setBoardSettingBlock = appJs.match(/async function setBoardSettingValue[\s\S]{0,1200}?persistBoardMutation\([^)]+\)/);
    expect(setBoardSettingBlock, 'setBoardSettingValue must call persistBoardMutation').toBeTruthy();
    expect(setBoardSettingBlock[0]).toMatch(/type:\s*['"]board['"]/);
  });

  it('tag style preset switch refreshes the whole board view (display-only — no persist)', () => {
    // Tag style preset is a display setting, not a file mutation, so
    // it goes through refreshTargetedElements with a board target —
    // every card needs re-rendering since tag CSS classes change.
    const presetBlock = actionRegistrationsJs.match(/id:\s*['"]tagStylePreset['"][\s\S]{0,400}?refreshTargetedElements\([^)]+\)/);
    expect(presetBlock, 'tagStylePreset registration must call refreshTargetedElements').toBeTruthy();
    expect(presetBlock[0]).toMatch(/type:\s*['"]board['"]/);
  });
});
