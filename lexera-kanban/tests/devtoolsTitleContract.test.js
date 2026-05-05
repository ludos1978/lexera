// Pin LexeraDevtoolsTitle.deriveSuffix — the helper that decorates
// document.title in app.js so "View > Developer Tools (All Views)"
// produces a stack of UNIQUELY-NAMED inspector windows. Without this
// each WebKit DevTools window inherits the same generic page <title>
// and the user has no way to tell which board / panel is which.

import { describe, it, expect } from 'vitest';
import { loadIIFE } from './load-iife.js';

const Title = loadIIFE('devtools/devtoolsTitle.js', 'window.LexeraDevtoolsTitle', { window: {} });

function params(obj) {
  return new URLSearchParams(Object.entries(obj));
}

describe('LexeraDevtoolsTitle.shortHash', () => {
  it('returns short strings unchanged', () => {
    expect(Title.shortHash('')).toBe('');
    expect(Title.shortHash('abc')).toBe('abc');
    expect(Title.shortHash('012345678901')).toBe('012345678901'); // 12 chars
  });

  it('compresses long strings with an ellipsis', () => {
    expect(Title.shortHash('22d8d19aa2ed0123456789')).toBe('22d8d19a…789');
    expect(Title.shortHash('a'.repeat(40))).toBe('aaaaaaaa…aaa');
  });
});

describe('LexeraDevtoolsTitle.deriveSuffix', () => {
  it('returns "" for the boot main shell (no params, label="main")', () => {
    expect(Title.deriveSuffix(params({}), 'main')).toBe('');
  });

  it('uses the windowLabel for non-main shell windows without other identifying params', () => {
    expect(Title.deriveSuffix(params({}), 'detached-board-1234')).toBe('detached-board-1234');
  });

  it('formats embedded board webviews as "Board <short-id>"', () => {
    const p = params({ embedded: '1', board: '22d8d19aa2ed0123456789' });
    expect(Title.deriveSuffix(p, 'board-tab-morrqnrh-w7kyt-tab-moroy412-e'))
      .toBe('Board 22d8d19a…789');
  });

  it('falls back to the windowLabel when an embedded webview is missing the board param', () => {
    const p = params({ embedded: '1' });
    expect(Title.deriveSuffix(p, 'board-tab-xxx-tab-yyy')).toBe('board-tab-xxx-tab-yyy');
  });

  it('formats workspace-locked windows as "ws:<short-id>"', () => {
    const p = params({ workspace: 'b17aface-a916-4ce1-b9a4-5282b98c128b' });
    expect(Title.deriveSuffix(p, 'main')).toBe('ws:b17aface…28b');
  });

  it('embedded short-circuits over workspace (the embedded child is the more specific identifier)', () => {
    const p = params({ embedded: '1', board: 'shortboard', workspace: 'someworkspaceuuid' });
    expect(Title.deriveSuffix(p, 'board-tab-z')).toBe('Board shortboard');
  });

  it('accepts plain-object urlParams for callers that already parsed', () => {
    expect(Title.deriveSuffix({ embedded: '1', board: '22d8d19aa2ed0123456789' }, 'lbl'))
      .toBe('Board 22d8d19a…789');
  });

  it('returns "" for null / undefined urlParams plus label="main"', () => {
    expect(Title.deriveSuffix(null, 'main')).toBe('');
    expect(Title.deriveSuffix(undefined, 'main')).toBe('');
  });
});
