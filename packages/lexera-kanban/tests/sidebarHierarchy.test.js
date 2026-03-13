import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadSidebarHierarchyUtils() {
  const source = readFileSync(resolve(srcDir, 'app.js'), 'utf-8');
  const lines = source.split('\n');

  function extractFunction(startLine) {
    let depth = 0;
    let started = false;
    const result = [];
    for (let i = startLine - 1; i < lines.length; i++) {
      const line = lines[i];
      result.push(line);
      for (let c = 0; c < line.length; c++) {
        if (line[c] === '{') { depth++; started = true; }
        if (line[c] === '}') depth--;
      }
      if (started && depth === 0) break;
    }
    return result.join('\n');
  }

  function findLine(pattern) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(pattern)) return i + 1;
    }
    throw new Error('Could not find: ' + pattern);
  }

  const fnDefs = [
    extractFunction(findLine('function extractHtmlComments(')),
    extractFunction(findLine('function stripHtmlComments(')),
    extractFunction(findLine('function stripLayoutTags(')),
    extractFunction(findLine('function countCardsInRow(')),
    extractFunction(findLine('function countCardsInStack(')),
    extractFunction(findLine('function cardPreviewText(')),
    extractFunction(findLine('function buildSidebarTreeNodes(')),
  ];

  const wrappedSource = `
    function is_archived_or_deleted() { return false; }
    function isColumnHeaderTagged() { return false; }
    function isColumnFooterTagged() { return false; }
    function getDisplayOrderedColumnEntries(columns) {
      return (Array.isArray(columns) ? columns : []).map(function (col, index) {
        return { col: col, fullIndex: index };
      });
    }

    ${fnDefs.join('\n\n')}

    return {
      buildSidebarTreeNodes,
    };
  `;

  return new Function(wrappedSource)();
}

let U;

beforeAll(() => {
  U = loadSidebarHierarchyUtils();
});

describe('buildSidebarTreeNodes', () => {
  it('keeps row and stack nodes even for single-row single-stack boards', () => {
    const rows = [{
      id: 'row-1',
      title: 'Only Row',
      stacks: [{
        id: 'stack-1',
        title: 'Only Stack',
        columns: [{
          id: 'col-1',
          index: 0,
          title: 'Only Column',
          cards: [{ content: 'Single card' }],
        }],
      }],
    }];

    const nodes = U.buildSidebarTreeNodes(rows, 'board-1', { rows: [], stacks: [], columns: [] }, false);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('row');
    expect(nodes[0].count).toBeNull();
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children[0].type).toBe('stack');
    expect(nodes[0].children[0].count).toBeNull();
    expect(nodes[0].children[0].children).toHaveLength(1);
    expect(nodes[0].children[0].children[0].type).toBe('column');
  });

  it('only auto-expands the single visible row and single visible stack by default', () => {
    const rows = [{
      id: 'row-1',
      title: 'Only Row',
      stacks: [{
        id: 'stack-1',
        title: 'Only Stack',
        columns: [{
          id: 'col-1',
          index: 0,
          title: 'Only Column',
          cards: [{ content: 'Single card' }],
        }],
      }],
    }];

    const nodes = U.buildSidebarTreeNodes(rows, 'board-1', { rows: [], stacks: [], columns: [] }, false);
    expect(nodes[0].expanded).toBe(true);
    expect(nodes[0].children[0].expanded).toBe(true);
    expect(nodes[0].children[0].children[0].expanded).toBe(false);
  });

  it('keeps every row as a top-level node when multiple rows exist', () => {
    const rows = [
      {
        id: 'row-a',
        title: 'Row A',
        stacks: [{ id: 'stack-a', title: 'Stack A', columns: [{ index: 0, title: 'Col A', cards: [] }] }],
      },
      {
        id: 'row-b',
        title: 'Row B',
        stacks: [{ id: 'stack-b', title: 'Stack B', columns: [{ index: 1, title: 'Col B', cards: [] }] }],
      },
    ];

    const nodes = U.buildSidebarTreeNodes(rows, 'board-1', { rows: [], stacks: [], columns: [] }, false);
    expect(nodes.map((node) => node.type)).toEqual(['row', 'row']);
    expect(nodes[0].children[0].type).toBe('stack');
    expect(nodes[1].children[0].type).toBe('stack');
  });
});
