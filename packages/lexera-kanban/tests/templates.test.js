import { describe, it, expect, vi, beforeAll } from 'vitest';
import { loadIIFE } from './load-iife.js';

// ── Bootstrap ──────────────────────────────────────────────────────────────
// Load the IIFE with mocked globals so every test shares the same object.

let T; // LexeraTemplates
const mockLog = vi.fn();
let mockApiRequest;

beforeAll(() => {
  mockApiRequest = vi.fn();
  T = loadIIFE('templates.js', 'LexeraTemplates', {
    lexeraLog: mockLog,
    LexeraApi: { request: mockApiRequest }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// substitute  (public — exercises substituteVariables + processConditionals)
// ═══════════════════════════════════════════════════════════════════════════

describe('substitute', () => {
  it('replaces a simple variable', () => {
    const result = T.substitute('Hello {name}!', { name: 'World' }, []);
    expect(result).toBe('Hello World!');
  });

  it('replaces multiple variables', () => {
    const result = T.substitute('{a} and {b}', { a: 'X', b: 'Y' }, []);
    expect(result).toBe('X and Y');
  });

  it('leaves undefined variables as-is', () => {
    const result = T.substitute('Hello {unknown}!', {}, []);
    expect(result).toBe('Hello {unknown}!');
  });

  it('applies inline format specifier', () => {
    const result = T.substitute('v{num:03d}', { num: 7 }, []);
    expect(result).toBe('v007');
  });

  it('picks up format from the variables array when no inline format', () => {
    const vars = [{ name: 'num', format: '02d' }];
    const result = T.substitute('v{num}', { num: 3 }, vars);
    expect(result).toBe('v03');
  });

  it('converts non-string values to string', () => {
    const result = T.substitute('{x}', { x: 42 }, []);
    expect(result).toBe('42');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// substituteFilename
// ═══════════════════════════════════════════════════════════════════════════

describe('substituteFilename', () => {
  it('substitutes variables and sanitizes forbidden filename characters', () => {
    const result = T.substituteFilename('{name}.md', { name: 'a<b>c:d' }, []);
    expect(result).toBe('a_b_c_d.md');
  });

  it('strips question marks and asterisks', () => {
    const result = T.substituteFilename('{x}', { x: 'why?*ok' }, []);
    expect(result).toBe('why__ok');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Format specifiers (tested indirectly via substitute)
// ═══════════════════════════════════════════════════════════════════════════

describe('format specifiers', () => {
  it('d — plain integer', () => {
    expect(T.substitute('{v:d}', { v: 42 }, [])).toBe('42');
    expect(T.substitute('{v:d}', { v: '7' }, [])).toBe('7');
  });

  it('02d — zero-padded integer', () => {
    expect(T.substitute('{v:02d}', { v: 5 }, [])).toBe('05');
  });

  it('03d — three-digit zero-padded', () => {
    expect(T.substitute('{v:03d}', { v: 42 }, [])).toBe('042');
  });

  it('s — string passthrough', () => {
    expect(T.substitute('{v:s}', { v: 'hello' }, [])).toBe('hello');
  });

  it('.2f — fixed-point float', () => {
    expect(T.substitute('{v:.2f}', { v: 3.1 }, [])).toBe('3.10');
  });

  it('upper / U — uppercase', () => {
    expect(T.substitute('{v:upper}', { v: 'hello' }, [])).toBe('HELLO');
    expect(T.substitute('{v:U}', { v: 'hello' }, [])).toBe('HELLO');
  });

  it('lower / L — lowercase', () => {
    expect(T.substitute('{v:lower}', { v: 'HeLLo' }, [])).toBe('hello');
    expect(T.substitute('{v:L}', { v: 'HeLLo' }, [])).toBe('hello');
  });

  it('title / T — title case', () => {
    expect(T.substitute('{v:title}', { v: 'hello world' }, [])).toBe('Hello World');
    expect(T.substitute('{v:T}', { v: 'foo bar' }, [])).toBe('Foo Bar');
  });

  it('slug — slugifies the value', () => {
    expect(T.substitute('{v:slug}', { v: 'Hello World!' }, [])).toBe('hello-world');
  });

  it('unknown format falls back to String()', () => {
    expect(T.substitute('{v:xyz}', { v: 99 }, [])).toBe('99');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Conditionals (tested indirectly via substitute)
// ═══════════════════════════════════════════════════════════════════════════

describe('conditionals', () => {
  it('includes body when variable is truthy', () => {
    const result = T.substitute('{#if show}visible{/if}', { show: 'yes' }, []);
    expect(result).toBe('visible');
  });

  it('removes body when variable is falsy', () => {
    const result = T.substitute('{#if show}visible{/if}', { show: '' }, []);
    expect(result).toBe('');
  });

  it('handles {#else} branch — truthy', () => {
    const tpl = '{#if flag}A{#else}B{/if}';
    expect(T.substitute(tpl, { flag: true }, [])).toBe('A');
  });

  it('handles {#else} branch — falsy', () => {
    const tpl = '{#if flag}A{#else}B{/if}';
    expect(T.substitute(tpl, { flag: false }, [])).toBe('B');
  });

  it('undefined variable is falsy', () => {
    const tpl = '{#if missing}A{#else}B{/if}';
    expect(T.substitute(tpl, {}, [])).toBe('B');
  });

  it('number 0 is falsy', () => {
    const tpl = '{#if n}yes{#else}no{/if}';
    expect(T.substitute(tpl, { n: 0 }, [])).toBe('no');
  });

  it('number 1 is truthy', () => {
    const tpl = '{#if n}yes{#else}no{/if}';
    expect(T.substitute(tpl, { n: 1 }, [])).toBe('yes');
  });

  it('handles nested conditionals', () => {
    const tpl = '{#if a}{#if b}AB{/if}{/if}';
    expect(T.substitute(tpl, { a: true, b: true }, [])).toBe('AB');
    expect(T.substitute(tpl, { a: true, b: false }, [])).toBe('');
    expect(T.substitute(tpl, { a: false, b: true }, [])).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyDefaults
// ═══════════════════════════════════════════════════════════════════════════

describe('applyDefaults', () => {
  it('fills in missing values from variable defaults', () => {
    const vars = [
      { name: 'a', default: 'defaultA' },
      { name: 'b', default: 'defaultB' }
    ];
    const result = T.applyDefaults(vars, { a: 'custom' });
    expect(result).toEqual({ a: 'custom', b: 'defaultB' });
  });

  it('does not overwrite provided values', () => {
    const vars = [{ name: 'x', default: 'fallback' }];
    const result = T.applyDefaults(vars, { x: 'given' });
    expect(result.x).toBe('given');
  });

  it('returns a new object (does not mutate input)', () => {
    const original = { a: 1 };
    const result = T.applyDefaults([], original);
    expect(result).not.toBe(original);
    expect(result).toEqual({ a: 1 });
  });

  it('handles variables with no default', () => {
    const vars = [{ name: 'x' }]; // no default property
    const result = T.applyDefaults(vars, {});
    expect(result.x).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Template parsing (via getFullTemplate + mocked LexeraApi)
// ═══════════════════════════════════════════════════════════════════════════

describe('template parsing (via getFullTemplate)', () => {
  it('parses a card template with frontmatter', async () => {
    const templateContent = [
      '---',
      'name: "Test Card"',
      'type: card',
      'description: "A test"',
      'icon: "star"',
      'variables:',
      '  - name: title',
      '    label: "Card Title"',
      '    type: string',
      '    required: true',
      '  - name: priority',
      '    label: "Priority"',
      '    type: number',
      '    default: 1',
      '---',
      '# {title}',
      'Priority: {priority}'
    ].join('\n');

    mockApiRequest.mockResolvedValueOnce({ content: templateContent, files: [] });
    const result = await T.getFullTemplate('test-card');

    expect(result.parsed.name).toBe('Test Card');
    expect(result.parsed.type).toBe('card');
    expect(result.parsed.description).toBe('A test');
    expect(result.parsed.icon).toBe('star');
    expect(result.parsed.variables).toHaveLength(2);
    expect(result.parsed.variables[0].name).toBe('title');
    expect(result.parsed.variables[0].label).toBe('Card Title');
    expect(result.parsed.variables[0].type).toBe('string');
    expect(result.parsed.variables[0].required).toBe(true);
    expect(result.parsed.variables[1].name).toBe('priority');
    expect(result.parsed.variables[1].type).toBe('number');
    expect(result.parsed.variables[1].default).toBe(1);
    expect(result.parsed.body.cardContent).toBe('# {title}\nPriority: {priority}');
  });

  it('parses a column template with ## headers and task items', async () => {
    const templateContent = [
      '---',
      'name: "Sprint"',
      'type: column',
      '---',
      '## To Do',
      '- [ ] Task one',
      '- [x] Task two',
      '## Done',
      '- [ ] Task three'
    ].join('\n');

    mockApiRequest.mockResolvedValueOnce({ content: templateContent, files: [] });
    const result = await T.getFullTemplate('sprint');

    expect(result.parsed.type).toBe('column');
    expect(result.parsed.body.columns).toHaveLength(2);
    expect(result.parsed.body.columns[0].title).toBe('To Do');
    expect(result.parsed.body.columns[0].cards).toHaveLength(2);
    expect(result.parsed.body.columns[0].cards[0].content).toBe('Task one');
    expect(result.parsed.body.columns[0].cards[0].checked).toBe(false);
    expect(result.parsed.body.columns[0].cards[1].content).toBe('Task two');
    expect(result.parsed.body.columns[0].cards[1].checked).toBe(true);
    expect(result.parsed.body.columns[1].title).toBe('Done');
    expect(result.parsed.body.columns[1].cards).toHaveLength(1);
  });

  it('parses a row template with # stacks and ## columns', async () => {
    const templateContent = [
      '---',
      'name: "Board"',
      'type: row',
      '---',
      '# Stack A',
      '## Col 1',
      '- [ ] Item 1',
      '## Col 2',
      '- [ ] Item 2',
      '# Stack B',
      '## Col 3',
      '- [ ] Item 3'
    ].join('\n');

    mockApiRequest.mockResolvedValueOnce({ content: templateContent, files: [] });
    const result = await T.getFullTemplate('board');

    expect(result.parsed.type).toBe('row');
    expect(result.parsed.body.stacks).toHaveLength(2);
    expect(result.parsed.body.stacks[0].title).toBe('Stack A');
    expect(result.parsed.body.stacks[0].columns).toHaveLength(2);
    expect(result.parsed.body.stacks[0].columns[0].title).toBe('Col 1');
    expect(result.parsed.body.stacks[0].columns[0].cards[0].content).toBe('Item 1');
    expect(result.parsed.body.stacks[1].title).toBe('Stack B');
    expect(result.parsed.body.stacks[1].columns).toHaveLength(1);
  });

  it('handles content without frontmatter', async () => {
    mockApiRequest.mockResolvedValueOnce({ content: 'Just plain text', files: [] });
    const result = await T.getFullTemplate('plain');

    expect(result.parsed.name).toBe('');
    expect(result.parsed.type).toBe('card');
    expect(result.parsed.body.cardContent).toBe('Just plain text');
  });

  it('parses task descriptions (indented continuation lines)', async () => {
    const templateContent = [
      '---',
      'name: "Tasks"',
      'type: column',
      '---',
      '## Backlog',
      '- [ ] Main task',
      '  This is a description',
      '  on multiple lines'
    ].join('\n');

    mockApiRequest.mockResolvedValueOnce({ content: templateContent, files: [] });
    const result = await T.getFullTemplate('tasks');

    const card = result.parsed.body.columns[0].cards[0];
    expect(card.content).toBe('Main task\nThis is a description\non multiple lines');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Frontmatter variable parsing edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('frontmatter variable edge cases', () => {
  it('handles quoted and unquoted values', async () => {
    const content = [
      '---',
      "name: 'Single Quoted'",
      'type: "Double Quoted"',
      'description: Unquoted',
      '---',
      'body'
    ].join('\n');

    mockApiRequest.mockResolvedValueOnce({ content, files: [] });
    const result = await T.getFullTemplate('quoted');

    expect(result.parsed.name).toBe('Single Quoted');
    expect(result.parsed.type).toBe('Double Quoted');
    expect(result.parsed.description).toBe('Unquoted');
  });

  it('normalizes variables with defaults', async () => {
    const content = [
      '---',
      'name: Test',
      'type: card',
      'variables:',
      '  - name: count',
      '    type: number',
      '    default: 5',
      '    required: false',
      '---',
      '{count}'
    ].join('\n');

    mockApiRequest.mockResolvedValueOnce({ content, files: [] });
    const result = await T.getFullTemplate('defaults');

    const v = result.parsed.variables[0];
    expect(v.name).toBe('count');
    expect(v.type).toBe('number');
    expect(v.default).toBe(5);
    expect(v.required).toBe(false);
    expect(v.label).toBe('count'); // falls back to name
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getTemplatesForType / loadTemplates
// ═══════════════════════════════════════════════════════════════════════════

describe('loadTemplates and getTemplatesForType', () => {
  it('caches and filters templates by type', async () => {
    mockApiRequest.mockResolvedValueOnce([
      { id: 'a', templateType: 'card' },
      { id: 'b', templateType: 'column' },
      { id: 'c', templateType: 'card' }
    ]);

    await T.loadTemplates();
    const cards = T.getTemplatesForType('card');
    expect(cards).toHaveLength(2);
    expect(cards[0].id).toBe('a');
    expect(cards[1].id).toBe('c');

    const columns = T.getTemplatesForType('column');
    expect(columns).toHaveLength(1);
  });

  it('returns empty array when API fails', async () => {
    mockApiRequest.mockRejectedValueOnce(new Error('network'));
    await T.loadTemplates();
    expect(T.getTemplatesForType('card')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Entity builders
// ═══════════════════════════════════════════════════════════════════════════

describe('buildCardFromTemplate', () => {
  it('builds a card with substituted content', () => {
    const parsed = {
      variables: [{ name: 'title', format: null }],
      body: { cardContent: '# {title}\nSome content' }
    };
    const card = T.buildCardFromTemplate(parsed, { title: 'My Card' });
    expect(card.content).toBe('# My Card\nSome content');
    expect(card.checked).toBe(false);
    expect(card.id).toMatch(/^card-/);
  });
});

describe('buildColumnFromTemplate', () => {
  it('builds columns with substituted titles and cards', () => {
    const parsed = {
      variables: [],
      body: {
        columns: [
          {
            title: '{phase}',
            cards: [
              { content: '{task}', checked: false },
              { content: 'Static', checked: true }
            ]
          }
        ]
      }
    };
    const cols = T.buildColumnFromTemplate(parsed, { phase: 'Alpha', task: 'Do stuff' });
    expect(cols).toHaveLength(1);
    expect(cols[0].title).toBe('Alpha');
    expect(cols[0].cards[0].content).toBe('Do stuff');
    expect(cols[0].cards[1].content).toBe('Static');
    expect(cols[0].cards[1].checked).toBe(true);
  });

  it('returns a fallback empty column when body has no columns', () => {
    const parsed = { variables: [], body: { columns: [] } };
    const cols = T.buildColumnFromTemplate(parsed, {});
    expect(cols).toHaveLength(1);
    expect(cols[0].title).toBe('New Column');
  });
});

describe('buildStackFromTemplate', () => {
  it('builds a stack with substituted name', () => {
    const parsed = {
      name: '{project} Stack',
      variables: [],
      body: {
        columns: [{ title: 'Col', cards: [] }]
      }
    };
    const stack = T.buildStackFromTemplate(parsed, { project: 'Demo' });
    expect(stack.title).toBe('Demo Stack');
    expect(stack.id).toMatch(/^stack-/);
    expect(stack.columns).toHaveLength(1);
  });
});

describe('buildRowFromTemplate', () => {
  it('builds a row from stacks', () => {
    const parsed = {
      name: '{name} Row',
      variables: [],
      body: {
        stacks: [
          {
            title: 'Stack {idx}',
            columns: [
              {
                title: 'Col',
                cards: [{ content: 'Card {idx}', checked: false }]
              }
            ]
          }
        ]
      }
    };
    const row = T.buildRowFromTemplate(parsed, { name: 'Test', idx: '1' });
    expect(row.title).toBe('Test Row');
    expect(row.id).toMatch(/^row-/);
    expect(row.stacks).toHaveLength(1);
    expect(row.stacks[0].title).toBe('Stack 1');
    expect(row.stacks[0].columns[0].cards[0].content).toBe('Card 1');
  });

  it('falls back to columns as single stack when no stacks in body', () => {
    const parsed = {
      name: 'Fallback',
      variables: [],
      body: {
        columns: [{ title: 'Only Col', cards: [] }]
      }
    };
    const row = T.buildRowFromTemplate(parsed, {});
    expect(row.stacks).toHaveLength(1);
    expect(row.stacks[0].columns[0].title).toBe('Only Col');
  });

  it('falls back to empty stack when body has neither stacks nor columns', () => {
    const parsed = {
      name: 'Empty',
      variables: [],
      body: {}
    };
    const row = T.buildRowFromTemplate(parsed, {});
    expect(row.stacks).toHaveLength(1);
    expect(row.stacks[0].title).toBe('Default');
    expect(row.stacks[0].columns[0].title).toBe('New Column');
  });
});
