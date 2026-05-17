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
        firstBoardId: 'board-1',
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
        'data-dashboard-board-id': 'board-1',
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
        boardId: 'board-1',
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
        'data-dashboard-board-id': 'board-1',
        'data-dashboard-col-index': '2',
        'data-dashboard-column-index': '2',
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

describe('dashboard tree click → nav payload (temporal-section routing)', () => {
  // The Overdue / Upcoming / Due-soon dashboard sections render result
  // items as `data-dashboard-target="result"` tree nodes carrying the
  // boardId / cardId / row-stack-col indices on data-* attributes.
  // Clicking a node hits `activateDashboardTreeNode` → calls
  // `buildDashboardNavResultFromTreeNode(node)` → routes through
  // `navigateToSearchResult(navResult)` → focusHierarchyTargetLocally
  // → focusCard. This test pins the FIRST hop of that chain: a clicked
  // node produces the exact nav payload the focus code expects.

  function makeFakeNode(attrs) {
    return {
      getAttribute: function (name) {
        return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
      }
    };
  }

  it('extracts the canonical nav payload from a temporal-section result node', () => {
    const node = makeFakeNode({
      'data-dashboard-target': 'result',
      'data-dashboard-board-id': 'board-1',
      'data-dashboard-card-id': 'card-42',
      'data-dashboard-column-index': '2',
      'data-dashboard-row-index': '0',
      'data-dashboard-stack-index': '1',
      'data-dashboard-col-local-index': '3',
      'data-dashboard-card-index': '4',
      'data-dashboard-column-title': 'Doing'
    });

    const payload = DashboardTree.buildDashboardNavResultFromTreeNode(node);
    expect(payload).toEqual({
      boardId: 'board-1',
      cardKid: null,
      cardId: 'card-42',
      columnIndex: 2,
      rowIndex: 0,
      stackIndex: 1,
      colLocalIndex: 3,
      cardIndex: 4,
      columnTitle: 'Doing'
    });
  });

  // The result node DOES carry the stable kid (backend dashboard.rs
  // card_kid → data-dashboard-card-kid). It must reach the nav payload so
  // focusSearchResultCard can prefer it over the drifty cardId — without
  // this read-back the kid was written to the DOM but silently dropped.
  it('carries the stable cardKid into the nav payload when present', () => {
    const node = makeFakeNode({
      'data-dashboard-target': 'result',
      'data-dashboard-board-id': 'board-1',
      'data-dashboard-card-kid': 'a1b2c3d4',
      'data-dashboard-card-id': 'loro:container:42',
      'data-dashboard-column-index': '2'
    });
    const payload = DashboardTree.buildDashboardNavResultFromTreeNode(node);
    expect(payload.cardKid).toBe('a1b2c3d4');
    expect(payload.cardId).toBe('loro:container:42');
  });

  it('returns null when the node carries no boardId — the focus chain bails before navigating', () => {
    const node = makeFakeNode({
      'data-dashboard-target': 'result',
      'data-dashboard-card-id': 'card-orphan'
    });
    expect(DashboardTree.buildDashboardNavResultFromTreeNode(node)).toBeNull();
  });

  it('preserves null indices when the data-* attribute is absent (overdue items lacking position)', () => {
    const node = makeFakeNode({
      'data-dashboard-board-id': 'board-1',
      'data-dashboard-card-id': 'card-no-position'
    });
    const payload = DashboardTree.buildDashboardNavResultFromTreeNode(node);
    expect(payload).toEqual({
      boardId: 'board-1',
      cardKid: null,
      cardId: 'card-no-position',
      columnIndex: null,
      rowIndex: null,
      stackIndex: null,
      colLocalIndex: null,
      cardIndex: null,
      columnTitle: null
    });
  });

  it('coerces numeric strings on indices but leaves cardId / columnTitle as strings', () => {
    const node = makeFakeNode({
      'data-dashboard-board-id': 'b',
      'data-dashboard-card-id': 'c',
      'data-dashboard-row-index': '5',
      'data-dashboard-stack-index': '3',
      'data-dashboard-column-index': '7',
      'data-dashboard-column-title': 'Backlog'
    });
    const payload = DashboardTree.buildDashboardNavResultFromTreeNode(node);
    expect(payload.rowIndex).toBe(5);
    expect(payload.stackIndex).toBe(3);
    expect(payload.columnIndex).toBe(7);
    expect(payload.cardId).toBe('c');
    expect(payload.columnTitle).toBe('Backlog');
  });
});

describe('dashboardCardTitle', () => {
  it('returns the first non-empty line', () => {
    expect(DashboardTree.dashboardCardTitle('Hello world')).toBe('Hello world');
  });

  it('strips heading markers', () => {
    expect(DashboardTree.dashboardCardTitle('# Sprint review')).toBe('Sprint review');
    expect(DashboardTree.dashboardCardTitle('## Sprint review')).toBe('Sprint review');
    expect(DashboardTree.dashboardCardTitle('### Sprint review')).toBe('Sprint review');
  });

  it('skips image-only first lines', () => {
    expect(DashboardTree.dashboardCardTitle('![alt](img.png)\nReal title')).toBe('Real title');
  });

  it('strips hidden-internal tags', () => {
    expect(DashboardTree.dashboardCardTitle('Card title #hidden-internal-archived')).toBe('Card title');
  });

  it('strips HTML comments', () => {
    expect(DashboardTree.dashboardCardTitle('<!-- comment -->Title text')).toBe('Title text');
  });

  it('stops at the first empty line (card header boundary)', () => {
    expect(DashboardTree.dashboardCardTitle('Title\n\nMore content')).toBe('Title');
  });

  it('returns (empty card) for empty content', () => {
    expect(DashboardTree.dashboardCardTitle('')).toBe('(empty card)');
    expect(DashboardTree.dashboardCardTitle(null)).toBe('(empty card)');
  });

  it('truncates long lines with ellipsis', () => {
    var long = 'x'.repeat(70);
    var result = DashboardTree.dashboardCardTitle(long);
    expect(result.length).toBeLessThan(65);
    expect(result.endsWith('...')).toBe(true);
  });
});
