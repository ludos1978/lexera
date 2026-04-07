import { describe, it, expect, beforeAll } from 'vitest';
import { loadIIFE } from './load-iife.js';

// Provide a minimal document stub so the IIFE loads without errors in Node
const docStub = {
  createElement: () => ({ className: '', innerHTML: '', style: {}, appendChild: () => {}, querySelectorAll: () => [], querySelector: () => null }),
  body: { appendChild: () => {}, contains: () => false },
  addEventListener: () => {},
  removeEventListener: () => {},
};

let AC;

beforeAll(() => {
  AC = loadIIFE('editor/editorAutocomplete.js', 'EditorAutocomplete', {
    document: docStub,
    window: { innerHeight: 800 },
    requestAnimationFrame: () => {},
  });
});

// ─── collectBoardTags ────────────────────────────────────────────────────────

describe('collectBoardTags', () => {
  it('returns empty array for null boardData', () => {
    expect(AC.collectBoardTags(null)).toEqual([]);
  });

  it('extracts user tags from flat columns', () => {
    const boardData = {
      columns: [
        { cards: [{ content: 'hello #urgent #important' }] },
        { cards: [{ content: 'world #urgent' }] },
      ],
    };
    const tags = AC.collectBoardTags(boardData);
    expect(tags).toContain('#important');
    expect(tags).toContain('#urgent');
  });

  it('deduplicates tags and lowercases them', () => {
    const boardData = {
      columns: [
        { cards: [{ content: '#Foo #foo #FOO' }] },
      ],
    };
    const tags = AC.collectBoardTags(boardData);
    expect(tags).toEqual(['#foo']);
  });

  it('excludes structural layout tags', () => {
    const boardData = {
      columns: [
        { cards: [{ content: '#row5 #stack #span2 #header #footer #wip-3 #sticky #hidden #hidden-internal-archived #mytag' }] },
      ],
    };
    const tags = AC.collectBoardTags(boardData);
    expect(tags).toContain('#mytag');
    expect(tags).not.toContain('#row5');
    expect(tags).not.toContain('#stack');
    expect(tags).not.toContain('#span2');
    expect(tags).not.toContain('#header');
    expect(tags).not.toContain('#footer');
    expect(tags).not.toContain('#wip-3');
    expect(tags).not.toContain('#sticky');
    expect(tags).not.toContain('#hidden');
    expect(tags).not.toContain('#hidden-internal-archived');
  });

  it('extracts tags from hierarchical rows/stacks/columns', () => {
    const boardData = {
      rows: [
        {
          stacks: [
            {
              columns: [
                { cards: [{ content: '#nested-tag' }] },
              ],
            },
          ],
        },
      ],
    };
    const tags = AC.collectBoardTags(boardData);
    expect(tags).toContain('#nested-tag');
  });

  it('returns tags sorted alphabetically', () => {
    const boardData = {
      columns: [
        { cards: [{ content: '#zebra #apple #mango' }] },
      ],
    };
    const tags = AC.collectBoardTags(boardData);
    expect(tags).toEqual(['#apple', '#mango', '#zebra']);
  });

  it('handles cards with no content', () => {
    const boardData = {
      columns: [
        { cards: [{ content: null }, {}, { content: '#ok' }] },
      ],
    };
    expect(AC.collectBoardTags(boardData)).toEqual(['#ok']);
  });
});

// ─── getDateItems ─────────────────────────────────────────────────────────────

describe('getDateItems', () => {
  it('includes today and tomorrow entries', () => {
    const items = AC.getDateItems();
    const labels = items.map(i => i.label);
    expect(labels.some(l => l.startsWith('today'))).toBe(true);
    expect(labels.some(l => l.startsWith('tomorrow'))).toBe(true);
  });

  it('all values start with @', () => {
    const items = AC.getDateItems();
    items.forEach(item => {
      expect(item.value).toMatch(/^@/);
    });
  });

  it('includes KW week entries with valid week numbers', () => {
    const items = AC.getDateItems();
    const kwItems = items.filter(i => i.label.startsWith('KW'));
    expect(kwItems.length).toBe(2);
    // Both KW values must be valid ISO week numbers (1–53)
    kwItems.forEach(item => {
      const kw = parseInt(item.value.replace('@KW', ''), 10);
      expect(kw).toBeGreaterThanOrEqual(1);
      expect(kw).toBeLessThanOrEqual(53);
    });
    // "next week" KW value should differ from "this week"
    const [thisKw, nextKw] = kwItems.map(i => parseInt(i.value.replace('@KW', ''), 10));
    expect(nextKw).not.toBe(thisKw);
  });

  it('includes weekday entries (Mon–Fri only)', () => {
    const items = AC.getDateItems();
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const dayItems = items.filter(i => weekdays.some(d => i.label.startsWith(d)));
    // At least some weekdays in the next 7 days
    expect(dayItems.length).toBeGreaterThan(0);
    // No weekend entries
    const badDays = ['Sat', 'Sun'];
    const hasWeekend = items.some(i => badDays.some(d => i.label.startsWith(d)));
    expect(hasWeekend).toBe(false);
  });
});
