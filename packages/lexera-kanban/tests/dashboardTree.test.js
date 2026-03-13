import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function loadDashboardTreeHarness() {
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

  const wrappedSource = `
    ${extractFunction(findLine('function parseOptionalSearchIndex('))}
    ${extractFunction(findLine('function buildSearchResultLocation('))}
    ${extractFunction(findLine('function dashboardCardTitle('))}
    ${extractFunction(findLine('function dashboardItemTitle('))}
    ${extractFunction(findLine('function dashboardDueLabel('))}
    ${extractFunction(findLine('function dashboardTreeNodeTooltip('))}
    ${extractFunction(findLine('function buildDashboardResultTreeNodes('))}
    ${extractFunction(findLine('function buildDashboardNavResultFromTreeNode('))}

    return {
      buildDashboardResultTreeNodes,
      buildDashboardNavResultFromTreeNode
    };
  `;

  return new Function(wrappedSource)();
}

function makeTreeNode(attrs) {
  const attrMap = Object.assign({}, attrs);
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrMap, name) ? attrMap[name] : null;
    }
  };
}

let H;

beforeAll(() => {
  H = loadDashboardTreeHarness();
});

describe('buildDashboardResultTreeNodes', () => {
  it('groups dashboard items by board and adds due labels as meta text', () => {
    const nodes = H.buildDashboardResultTreeNodes([
      {
        boardId: 'board-a',
        boardTitle: 'Board A',
        cardId: 'card-1',
        cardContent: 'Alpha task',
        columnTitle: 'Todo',
        dueDate: '2026-03-14'
      },
      {
        boardId: 'board-a',
        boardTitle: 'Board A',
        cardId: 'card-2',
        cardContent: 'Beta task',
        columnTitle: 'Doing',
        displayDate: 'Today'
      },
      {
        boardId: 'board-b',
        boardTitle: 'Board B',
        cardId: 'card-3',
        cardContent: 'Gamma task',
        columnTitle: 'Done'
      }
    ]);

    expect(nodes).toHaveLength(2);
    expect(nodes[0].label).toBe('Board A');
    expect(nodes[0].count).toBe(2);
    expect(nodes[0].expanded).toBe(true);
    expect(nodes[0].children).toHaveLength(2);
    expect(nodes[0].children[0].type).toBe('dashboard-result');
    expect(nodes[0].children[0].count).toBe('2026-03-14');
    expect(nodes[0].children[1].count).toBe('Today');
    expect(nodes[1].label).toBe('Board B');
    expect(nodes[1].count).toBe(1);
  });
});

describe('buildDashboardNavResultFromTreeNode', () => {
  it('parses navigation attrs from a dashboard result tree node', () => {
    const result = H.buildDashboardNavResultFromTreeNode(makeTreeNode({
      'data-dashboard-board-id': 'board-7',
      'data-dashboard-card-id': 'card-99',
      'data-dashboard-column-index': '4',
      'data-dashboard-row-index': '1',
      'data-dashboard-stack-index': '2',
      'data-dashboard-column-title': 'Backlog'
    }));

    expect(result).toEqual({
      boardId: 'board-7',
      cardId: 'card-99',
      columnIndex: 4,
      rowIndex: 1,
      stackIndex: 2,
      columnTitle: 'Backlog'
    });
  });
});
