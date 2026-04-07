import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIIFE } from './load-iife.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

let T;

beforeAll(() => {
  // tagSystem.js expects LexeraTitleHelpers to be available globally
  new Function(readFileSync(resolve(srcDir, 'titleHelpers.js'), 'utf-8'))();
  T = loadIIFE('tagSystem.js', 'LexeraTagSystem');
});

// ═══════════════════════════════════════════════════════════════════════════
// Layout tag vocabulary
// ═══════════════════════════════════════════════════════════════════════════

describe('LAYOUT_TAGS vocabulary', () => {
  it('defines all expected layout tags', () => {
    const names = T.LAYOUT_TAGS.map(t => t.name);
    expect(names).toContain('row');
    expect(names).toContain('span');
    expect(names).toContain('stack');
    expect(names).toContain('header');
    expect(names).toContain('footer');
    expect(names).toContain('wip');
    expect(names).toContain('sticky');
    expect(names).toContain('width');
    expect(names).toContain('height');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// stripLayoutTags
// ═══════════════════════════════════════════════════════════════════════════

describe('stripLayoutTags', () => {
  it('removes all layout tags from title', () => {
    expect(T.stripLayoutTags('Tasks #row2 #span3 #stack #header #footer #wip-5'))
      .toBe('Tasks');
  });
  it('removes width/height tags', () => {
    expect(T.stripLayoutTags('Title #width{200} #height{300}')).toBe('Title');
  });
  it('returns clean title when no tags', () => {
    expect(T.stripLayoutTags('Simple Title')).toBe('Simple Title');
  });
  it('handles null/undefined', () => {
    expect(T.stripLayoutTags(null)).toBe('');
    expect(T.stripLayoutTags(undefined)).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isLayoutTag
// ═══════════════════════════════════════════════════════════════════════════

describe('isLayoutTag', () => {
  it('identifies all layout tags', () => {
    expect(T.isLayoutTag('#row1')).toBe(true);
    expect(T.isLayoutTag('#span3')).toBe(true);
    expect(T.isLayoutTag('#stack')).toBe(true);
    expect(T.isLayoutTag('#header')).toBe(true);
    expect(T.isLayoutTag('#footer')).toBe(true);
    expect(T.isLayoutTag('#wip-5')).toBe(true);
    expect(T.isLayoutTag('#sticky')).toBe(true);
    expect(T.isLayoutTag('#width{200}')).toBe(true);
    expect(T.isLayoutTag('#height{100}')).toBe(true);
  });
  it('rejects non-layout tags', () => {
    expect(T.isLayoutTag('#todo')).toBe(false);
    expect(T.isLayoutTag('#bug')).toBe(false);
    expect(T.isLayoutTag('#done')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// extractLayoutTags
// ═══════════════════════════════════════════════════════════════════════════

describe('extractLayoutTags', () => {
  it('extracts all layout tag values', () => {
    const t = T.extractLayoutTags('Title #row2 #span3 #stack #header #footer #wip-5');
    expect(t.row).toBe(2);
    expect(t.span).toBe(3);
    expect(t.stack).toBe(true);
    expect(t.header).toBe(true);
    expect(t.footer).toBe(true);
    expect(t.wip).toBe(5);
  });
  it('returns defaults for plain title', () => {
    const t = T.extractLayoutTags('Plain Title');
    expect(t.row).toBe(0);
    expect(t.span).toBe(0);
    expect(t.stack).toBe(false);
    expect(t.header).toBe(false);
    expect(t.footer).toBe(false);
    expect(t.wip).toBe(0);
  });
  it('extracts width and height', () => {
    const t = T.extractLayoutTags('Title #width{200} #height{150}');
    expect(t.width).toBe(200);
    expect(t.height).toBe(150);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// reconstructTitle
// ═══════════════════════════════════════════════════════════════════════════

describe('reconstructTitle', () => {
  it('preserves layout tags from original when user input has none', () => {
    expect(T.reconstructTitle('New Title', 'Old #row2 #span3 #stack'))
      .toBe('New Title #row2 #span3 #stack');
  });
  it('user-specified layout tags override originals', () => {
    expect(T.reconstructTitle('New #row3 #span2', 'Old #row2 #span3'))
      .toBe('New #row3 #span2');
  });
  it('removes span with #nospan directive', () => {
    expect(T.reconstructTitle('Title #nospan', 'Old #span3')).toBe('Title');
  });
  it('removes stack with #nostack directive', () => {
    expect(T.reconstructTitle('Title #nostack', 'Old #stack')).toBe('Title');
  });
  it('drops #row1 because it is the default', () => {
    expect(T.reconstructTitle('New Title', 'Old #row1')).toBe('New Title');
  });
  it('preserves HTML comments from original', () => {
    expect(T.reconstructTitle('New', 'Old <!-- comment -->')).toBe('New <!-- comment -->');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Internal hidden tags
// ═══════════════════════════════════════════════════════════════════════════

describe('internal hidden tags', () => {
  it('strips all internal hidden tags', () => {
    expect(T.stripInternalHiddenTags('Title #hidden-internal-deleted').trim())
      .toBe('Title');
  });
  it('detects archived/deleted/parked', () => {
    expect(T.isArchivedOrDeleted('text #hidden-internal-deleted')).toBe(true);
    expect(T.isArchivedOrDeleted('text #hidden-internal-archived')).toBe(true);
    expect(T.isArchivedOrDeleted('text #hidden-internal-parked')).toBe(true);
    expect(T.isArchivedOrDeleted('text #hidden')).toBe(true);
    expect(T.isArchivedOrDeleted('normal text')).toBe(false);
  });
  it('applies internal hidden tag', () => {
    const result = T.applyInternalHiddenTag('Title', '#hidden-internal-deleted');
    expect(result).toBe('Title #hidden-internal-deleted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Header tag tokenization
// ═══════════════════════════════════════════════════════════════════════════

describe('collectHeaderTagTokens', () => {
  it('extracts hash and temporal tags', () => {
    const tokens = T.collectHeaderTagTokens('task #todo @today !tomorrow');
    expect(tokens).toContain('#todo');
    expect(tokens).toContain('@today');
    expect(tokens).toContain('!tomorrow');
  });
  it('stops at empty line', () => {
    const tokens = T.collectHeaderTagTokens('title #visible\n\nbody #invisible');
    expect(tokens).toContain('#visible');
    expect(tokens).not.toContain('#invisible');
  });
  it('respects option filters', () => {
    const tokens = T.collectHeaderTagTokens('#hash @at', { includeAt: false });
    expect(tokens).toContain('#hash');
    expect(tokens).not.toContain('@at');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tag expressions
// ═══════════════════════════════════════════════════════════════════════════

describe('tag expressions', () => {
  it('evaluates simple tag lookup', () => {
    expect(T.hasTag('task #todo #bug', '#todo')).toBe(true);
    expect(T.hasTag('task #todo', '#done')).toBe(false);
  });
  it('evaluates AND expressions', () => {
    expect(T.hasTag('task #todo #bug', '#todo & #bug')).toBe(true);
    expect(T.hasTag('task #todo', '#todo & #bug')).toBe(false);
  });
  it('evaluates OR expressions', () => {
    expect(T.hasTag('task #todo', '#todo | #done')).toBe(true);
    expect(T.hasTag('task #done', '#todo | #done')).toBe(true);
  });
  it('evaluates NOT expressions', () => {
    expect(T.hasTag('task #todo', '!#done')).toBe(true);
    expect(T.hasTag('task #todo #done', '!#done')).toBe(false);
  });
  it('evaluates parenthesized expressions', () => {
    expect(T.hasTag('task #todo #later @today', '#todo & (#later | #blocked)')).toBe(true);
    expect(T.hasTag('task #todo #blocked @today', '(#todo | #done) & !#blocked')).toBe(false);
    expect(T.hasTag('task #todo #blocked @today', '(#todo | #done) & (@today | @tomorrow)')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tag classification
// ═══════════════════════════════════════════════════════════════════════════

describe('tag classification', () => {
  it('identifies numeric index tags', () => {
    expect(T.isNumericIndexTag('#1')).toBe(true);
    expect(T.isNumericIndexTag('#1.2.3')).toBe(true);
    expect(T.isNumericIndexTag('#todo')).toBe(false);
  });
  it('determines style eligibility', () => {
    expect(T.isTagStyleEligible('#todo')).toBe(true);
    expect(T.isTagStyleEligible('#1')).toBe(false); // numeric
    expect(T.isTagStyleEligible('#row2')).toBe(false); // layout
    expect(T.isTagStyleEligible('#hidden-internal-deleted')).toBe(false); // internal
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tag manipulation
// ═══════════════════════════════════════════════════════════════════════════

describe('tag manipulation', () => {
  it('adds tag to header', () => {
    expect(T.addTagToHeader('task', '#todo')).toBe('task #todo');
  });
  it('does not duplicate existing tag', () => {
    expect(T.addTagToHeader('task #todo', '#todo')).toBe('task #todo');
  });
  it('removes tag from header', () => {
    expect(T.removeTagFromHeader('task #todo #bug', '#todo').trim()).toBe('task #bug');
  });
  it('replaces tag in header', () => {
    expect(T.replaceTagInHeader('task #todo', '#todo', '#done')).toBe('task #done');
  });
  it('clears all removable tags', () => {
    const result = T.clearRemovableTags('task #todo #bug #row2');
    expect(result.trim()).toBe('task #row2');
  });
  it('normalizes prompt tag tokens', () => {
    expect(T.normalizePromptTagToken('todo')).toBe('#todo');
    expect(T.normalizePromptTagToken('#TODO')).toBe('#todo');
    expect(T.normalizePromptTagToken('@today')).toBe('');
  });
});
