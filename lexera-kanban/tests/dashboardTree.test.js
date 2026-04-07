import { beforeAll, describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';
import { createRequire } from 'node:module';

let DashboardTree;
const require = createRequire(import.meta.url);
const HierarchyContract = require('../src/hierarchy/hierarchyContract.js');

beforeAll(() => {
  globalThis.LexeraHierarchyContract = HierarchyContract;
  DashboardTree = loadIIFE('dashboard/dashboardTree.js', 'LexeraDashboardTree');
});

describe('dashboard tree builders', () => {
  it('groups inventory items by context label into nested tree nodes', () => {
    const nodes = DashboardTree.buildDashboardInventoryTreeNodes([
      {
        kind: 'embed',
        path: 'docs/spec.pdf',
        count: 2,
        firstContextLabel: 'Attachments',
        status: 'missing'
      },
      {
        kind: 'embed',
        path: 'docs/notes.md',
        count: 1,
        firstContextLabel: 'Attachments',
        status: 'exists'
      },
      {
        kind: 'embed',
        path: 'media/preview.png',
        count: 1,
        firstContextLabel: 'Gallery',
        status: 'unknown'
      }
    ]);

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      id: 'dashboard-context-attachments',
      label: 'Attachments',
      count: 2,
      type: 'dashboard-group',
      structuralRole: 'group',
      hierarchy: {
        surface: 'dashboard',
        kind: 'context-group',
        entityId: 'Attachments',
        capabilities: [],
        selectable: false
      },
      attrs: {
        'data-dashboard-target': 'context'
      }
    });
    expect(nodes[0].children[0]).toMatchObject({
      label: 'docs/spec.pdf',
      count: 'Missing · x2',
      type: 'dashboard-file',
      structuralRole: 'item',
      hierarchy: {
        surface: 'dashboard',
        kind: 'file-result',
        entityId: null,
        capabilities: ['activate'],
        selectable: false
      },
      attrs: {
        'data-dashboard-target': 'file',
        'data-dashboard-status': 'missing',
        title: 'docs/spec.pdf / Attachments / Missing / 2 references'
      }
    });
    expect(nodes[1]).toMatchObject({
      id: 'dashboard-context-gallery',
      label: 'Gallery',
      count: 1,
      hierarchy: {
        surface: 'dashboard',
        kind: 'context-group',
        entityId: 'Gallery',
        capabilities: [],
        selectable: false
      }
    });
  });

  it('groups broken items by type and preserves navigation attributes on leaves', () => {
    const nodes = DashboardTree.buildDashboardBrokenTreeNodes([
      {
        type: 'image',
        src: 'media/missing.png',
        colIndex: 2,
        cardIndex: 5,
        count: 3
      },
      {
        type: 'include',
        src: 'docs/missing.md',
        reason: 'File not found'
      }
    ]);

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      id: 'dashboard-broken-image',
      label: 'Image',
      structuralRole: 'group',
      hierarchy: {
        surface: 'dashboard',
        kind: 'broken-group',
        entityId: 'image',
        capabilities: [],
        selectable: false
      },
      attrs: {
        'data-dashboard-target': 'broken-group',
        'data-dashboard-broken-type': 'image'
      }
    });
    expect(nodes[0].children[0]).toMatchObject({
      label: 'media/missing.png',
      count: 'x3',
      structuralRole: 'item',
      hierarchy: {
        surface: 'dashboard',
        kind: 'broken-result',
        entityId: 'media/missing.png',
        capabilities: ['activate'],
        selectable: false
      },
      attrs: {
        'data-dashboard-target': 'broken',
        'data-dashboard-col-index': '2',
        'data-dashboard-card-index': '5',
        title: 'media/missing.png / Image / 3 occurrences'
      }
    });
    expect(nodes[1].children[0]).toMatchObject({
      label: 'docs/missing.md',
      attrs: {
        'data-dashboard-target': 'broken',
        'data-dashboard-broken-type': 'include'
      }
    });
  });

  it('builds tagged dashboard trees with tag roots above board result groups', () => {
    const nodes = DashboardTree.buildDashboardTaggedTreeNodes([
      {
        tag: '#blocked',
        items: [
          {
            boardId: 'board-1',
            boardTitle: 'Project Board',
            cardId: 'card-1',
            cardContent: 'Fix release blocker',
            columnTitle: 'Doing',
            rowIndex: 0,
            stackIndex: 1,
            columnIndex: 2
          }
        ]
      }
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: 'dashboard-tag-blocked',
      label: '#blocked',
      structuralRole: 'group',
      hierarchy: {
        surface: 'dashboard',
        kind: 'tag-group',
        entityId: '#blocked',
        capabilities: [],
        selectable: false
      },
      attrs: {
        'data-dashboard-target': 'tag',
        'data-dashboard-tag': '#blocked'
      }
    });
    expect(nodes[0].children[0]).toMatchObject({
      id: 'dashboard-group-board-1',
      label: 'Project Board',
      structuralRole: 'group',
      hierarchy: {
        surface: 'dashboard',
        kind: 'board-group',
        entityId: 'board-1',
        capabilities: [],
        selectable: false
      },
      attrs: {
        'data-dashboard-target': 'board',
        'data-dashboard-board-id': 'board-1'
      }
    });
    expect(nodes[0].children[0].children[0]).toMatchObject({
      label: 'Fix release blocker',
      structuralRole: 'item',
      hierarchy: {
        surface: 'dashboard',
        kind: 'result',
        entityId: 'card-1',
        capabilities: ['activate'],
        selectable: false
      },
      attrs: {
        'data-dashboard-target': 'result',
        'data-dashboard-board-id': 'board-1',
        'data-dashboard-card-id': 'card-1',
        'data-dashboard-column-index': '2',
        'data-dashboard-row-index': '0',
        'data-dashboard-stack-index': '1',
        'data-dashboard-column-title': 'Doing',
        title: 'Project Board / Row 1 / Stack 2 / Doing'
      }
    });
  });
});
