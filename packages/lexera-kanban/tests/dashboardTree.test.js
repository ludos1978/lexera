import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../src/dashboard/dashboardTree.js');

function makeTreeNode(attrs) {
  const attrMap = Object.assign({}, attrs);
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrMap, name) ? attrMap[name] : null;
    }
  };
}

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
