// LexeraTitleHelpers.resolveBoardLabel — canonical label resolver.
//
// Single source of truth used by boardHeader (in-board pane title),
// workspaceShell (tab headers), workspaces sub-app, and hierarchy
// sub-app. User contract 2026-05-03: "the title should be everywhere
// the same!" — this is the function that enforces it. If this test
// passes, every surface that calls it produces the same label for
// the same input.
//
// Priority chain:
//   1. parsed `title` (markdown H1 — `KanbanBoard.title` from
//      lexera-core's parser, surfaced via `BoardInfo.title`).
//   2. filename basename of `filePath` (or legacy `file_path`),
//      stripped of the `.md` extension.
//   3. legacy `name` field (older payload shapes).
//   4. literal `'Untitled'`.

import { describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadHelpers() {
  return loadIIFE('titleHelpers.js', 'window.LexeraTitleHelpers', {
    window: {},
    globalThis: {}
  });
}

describe('LexeraTitleHelpers.resolveBoardLabel', () => {
  const th = loadHelpers();

  it('returns the parsed title when present', () => {
    expect(th.resolveBoardLabel({ title: 'Sprint Planning' })).toBe('Sprint Planning');
  });

  it('falls back to filename basename without .md when title is empty', () => {
    expect(th.resolveBoardLabel({ title: '', filePath: '/workspace/Sprint Plan.md' }))
      .toBe('Sprint Plan');
  });

  it('ignores legacy snake_case file_path (legacy alias removed)', () => {
    expect(th.resolveBoardLabel({ title: '', file_path: '/workspace/Roadmap.md' }))
      .toBe('Untitled');
  });

  it('falls back to legacy name field when both title and filePath are absent', () => {
    expect(th.resolveBoardLabel({ name: 'Legacy Board' })).toBe('Legacy Board');
  });

  it('returns "Untitled" when meta is missing entirely', () => {
    expect(th.resolveBoardLabel(null)).toBe('Untitled');
    expect(th.resolveBoardLabel(undefined)).toBe('Untitled');
  });

  it('returns "Untitled" when every candidate field is empty', () => {
    expect(th.resolveBoardLabel({})).toBe('Untitled');
    expect(th.resolveBoardLabel({ title: '', filePath: '', name: '' })).toBe('Untitled');
  });

  it('title wins over name when both are present', () => {
    expect(th.resolveBoardLabel({ title: 'Canonical', name: 'Stale' })).toBe('Canonical');
  });

  it('title wins over filePath when both are present', () => {
    expect(th.resolveBoardLabel({ title: 'Canonical', filePath: '/x/Different Name.md' }))
      .toBe('Canonical');
  });

  it('strips .md case-insensitively', () => {
    expect(th.resolveBoardLabel({ title: '', filePath: '/x/Roadmap.MD' })).toBe('Roadmap');
    expect(th.resolveBoardLabel({ title: '', filePath: '/x/Roadmap.Md' })).toBe('Roadmap');
  });

  it('handles paths with backslashes (Windows) and forward slashes', () => {
    expect(th.resolveBoardLabel({ filePath: 'C:\\Users\\foo\\Plan.md' })).toBe('Plan');
    expect(th.resolveBoardLabel({ filePath: '/home/foo/Plan.md' })).toBe('Plan');
  });

  it('trims whitespace from title before deciding', () => {
    // Whitespace-only title is treated as empty.
    expect(th.resolveBoardLabel({ title: '   ', filePath: '/x/Fallback.md' }))
      .toBe('Fallback');
  });
});
