// LexeraTitleHelpers.resolveCardLabel — card title derivation contract.
//
// Cards have no `title` field; their displayed title is derived from
// `card.content`. This test pins the same algorithm app.js's
// `getCardTitle()` uses, so the workspace tree, hierarchy panel, and
// kanban view all agree on what a card is called.

import { describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadHelpers() {
  return loadIIFE('titleHelpers.js', 'window.LexeraTitleHelpers', {
    window: {},
    globalThis: {}
  });
}

describe('LexeraTitleHelpers.resolveCardLabel', () => {
  const th = loadHelpers();

  it('returns the first non-empty line of plain content', () => {
    expect(th.resolveCardLabel({ content: 'Hello world' })).toBe('Hello world');
  });

  it('strips a leading H1 / H2 / H3 marker and returns just the heading text', () => {
    expect(th.resolveCardLabel({ content: '# Sprint review' })).toBe('Sprint review');
    expect(th.resolveCardLabel({ content: '## Sprint review' })).toBe('Sprint review');
    expect(th.resolveCardLabel({ content: '### Sprint review' })).toBe('Sprint review');
  });

  it('skips image-only first lines and uses the next text line', () => {
    expect(th.resolveCardLabel({ content: '![alt](img.png)\nReal title' }))
      .toBe('Real title');
  });

  it('returns the second line when the first is blank', () => {
    expect(th.resolveCardLabel({ content: '\nSecond line title' }))
      .toBe('Second line title');
  });

  it('strips HTML comments before deciding the title', () => {
    expect(th.resolveCardLabel({ content: '<!-- internal note -->\nThe title' }))
      .toBe('The title');
    // Inline comment on the title line gets stripped too.
    expect(th.resolveCardLabel({ content: 'Real title <!-- meta -->' }))
      .toBe('Real title');
  });

  it('strips internal-hidden tags from the title line', () => {
    expect(th.resolveCardLabel({ content: 'My task #hidden-internal-deleted' }))
      .toBe('My task');
    expect(th.resolveCardLabel({ content: 'Inbox item #hidden-internal-incoming' }))
      .toBe('Inbox item');
    expect(th.resolveCardLabel({ content: 'Parked thought #hidden-internal-parked' }))
      .toBe('Parked thought');
    expect(th.resolveCardLabel({ content: 'Old task #hidden-internal-archived' }))
      .toBe('Old task');
  });

  it('returns "Untitled" when content is empty / whitespace / missing', () => {
    expect(th.resolveCardLabel({ content: '' })).toBe('Untitled');
    expect(th.resolveCardLabel({ content: '   \n   ' })).toBe('Untitled');
    expect(th.resolveCardLabel({})).toBe('Untitled');
    expect(th.resolveCardLabel(null)).toBe('Untitled');
    expect(th.resolveCardLabel(undefined)).toBe('Untitled');
  });

  it('returns the bare hash when a heading marker has no body text (parity with getCardTitle)', () => {
    // `# \nBody` — line 0 trims to '#', heading regex requires text after
    // \s+, so it falls through to `return trimmed` and yields '#'. Pinned
    // to match app.js getCardTitle exactly so the surfaces don't diverge.
    expect(th.resolveCardLabel({ content: '#   ' })).toBe('#');
    expect(th.resolveCardLabel({ content: '# \nBody' })).toBe('#');
  });

  it('only returns the FIRST line when multiple text lines are present', () => {
    expect(th.resolveCardLabel({ content: 'First line\nSecond line\nThird' }))
      .toBe('First line');
  });

  it('uses the fallback scan when the first block is comment-only', () => {
    expect(th.resolveCardLabel({ content: '<!-- only this -->\n\nReal body' }))
      .toBe('Real body');
  });

  it('does not strip ordinary user tags (only internal-hidden tags)', () => {
    expect(th.resolveCardLabel({ content: 'Plan trip #travel #urgent' }))
      .toBe('Plan trip #travel #urgent');
  });

  it('honors a pre-derived `title` on the card object before falling back to content', () => {
    // boardCleanup and some cleanup paths stash a derived `title` on the
    // card; if present, it wins over re-deriving from content.
    expect(th.resolveCardLabel({ title: 'Pre-derived', content: 'Different content' }))
      .toBe('Pre-derived');
    // Whitespace-only `title` is not a real title — fall through to
    // content derivation.
    expect(th.resolveCardLabel({ title: '   ', content: 'Real title' }))
      .toBe('Real title');
  });
});
