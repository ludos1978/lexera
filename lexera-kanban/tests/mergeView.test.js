// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

let LexeraMergeView;

const CONFLICTS = [
  { cardId: 'k1', columnTitle: 'Todo', field: 'Content', baseValue: 'b1', theirsValue: 't1', oursValue: 'o1' },
  { cardId: 'k2', columnTitle: 'Doing', field: 'Content', baseValue: 'b2', theirsValue: 't2', oursValue: 'o2' }
];

beforeEach(() => {
  document.body.innerHTML = '';
  LexeraMergeView = loadIIFE('merge/mergeView.js', 'LexeraMergeView', {});
});

describe('LexeraMergeView.buildResolution (pure)', () => {
  it('defaults every conflict to "theirs" when nothing picked', () => {
    const r = LexeraMergeView.buildResolution('b', CONFLICTS, { strategy: 'card-identity-three-way' });
    expect(r.boardId).toBe('b');
    expect(r.strategy).toBe('card-identity-three-way');
    expect(r.choices).toEqual([
      { cardId: 'k1', pick: 'theirs' },
      { cardId: 'k2', pick: 'theirs' }
    ]);
    expect(r.backupKeep).toBeUndefined();
  });

  it('honours explicit per-card picks (ours/base)', () => {
    const r = LexeraMergeView.buildResolution('b', CONFLICTS, {
      strategy: 'card-identity-three-way',
      picks: { k1: 'ours', k2: 'base' }
    });
    expect(r.choices).toEqual([
      { cardId: 'k1', pick: 'ours' },
      { cardId: 'k2', pick: 'base' }
    ]);
  });

  it('ignores invalid picks, falling back to theirs', () => {
    const r = LexeraMergeView.buildResolution('b', CONFLICTS, {
      strategy: 'card-identity-three-way',
      picks: { k1: 'garbage' }
    });
    expect(r.choices[0]).toEqual({ cardId: 'k1', pick: 'theirs' });
  });

  it('conflict-file-backup carries backupKeep and empty choices', () => {
    const r = LexeraMergeView.buildResolution('b', CONFLICTS, {
      strategy: 'conflict-file-backup',
      backupKeep: 'ours'
    });
    expect(r.strategy).toBe('conflict-file-backup');
    expect(r.backupKeep).toBe('ours');
    expect(r.choices).toEqual([]);
  });

  it('backup defaults to theirs and normalizes unknown strategy to 3-way', () => {
    expect(
      LexeraMergeView.buildResolution('b', CONFLICTS, { strategy: 'conflict-file-backup' }).backupKeep
    ).toBe('theirs');
    expect(
      LexeraMergeView.buildResolution('b', CONFLICTS, { strategy: 'whatever' }).strategy
    ).toBe('card-identity-three-way');
  });

  it('skips conflicts with no cardId', () => {
    const r = LexeraMergeView.buildResolution('b', [{ columnTitle: 'X' }, { cardId: 'k9' }], {});
    expect(r.choices).toEqual([{ cardId: 'k9', pick: 'theirs' }]);
  });
});

describe('LexeraMergeView.open (DOM)', () => {
  it('renders one row per conflict and a strategy selector', () => {
    LexeraMergeView.open({ boardId: 'b', conflicts: CONFLICTS, api: {} });
    expect(document.querySelectorAll('.merge-row').length).toBe(2);
    expect(document.querySelector('input[name="mc-strategy"]')).toBeTruthy();
    expect(document.querySelector('.lexera-merge-overlay')).toBeTruthy();
  });

  it('Apply posts the built resolution then reloads and closes', async () => {
    const resolveMerge = vi.fn().mockResolvedValue({ success: true });
    const reload = vi.fn();
    LexeraMergeView.open({
      boardId: 'board-7',
      conflicts: CONFLICTS,
      baseBoard: { b: 1 },
      incoming: { i: 1 },
      api: { resolveMerge },
      reload
    });
    // Pick "ours" for k1, leave k2 default.
    document.querySelector('.merge-row[data-card-id="k1"] input[value="ours"]').checked = true;
    document.querySelector('[data-mc-action="apply"]').click();
    await vi.waitFor(() => expect(resolveMerge).toHaveBeenCalledTimes(1));

    const [boardId, base, incoming, resolution] = resolveMerge.mock.calls[0];
    expect(boardId).toBe('board-7');
    expect(base).toEqual({ b: 1 });
    expect(incoming).toEqual({ i: 1 });
    expect(resolution).toEqual({
      boardId: 'board-7',
      strategy: 'card-identity-three-way',
      choices: [
        { cardId: 'k1', pick: 'ours' },
        { cardId: 'k2', pick: 'theirs' }
      ]
    });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.lexera-merge-overlay')).toBeNull();
  });

  it('Cancel closes without calling the API', () => {
    const resolveMerge = vi.fn();
    LexeraMergeView.open({ boardId: 'b', conflicts: CONFLICTS, api: { resolveMerge } });
    document.querySelector('[data-mc-action="cancel"]').click();
    expect(resolveMerge).not.toHaveBeenCalled();
    expect(document.querySelector('.lexera-merge-overlay')).toBeNull();
  });
});
