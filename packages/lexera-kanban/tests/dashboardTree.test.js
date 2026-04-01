import { beforeAll, describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

let DashboardTree;

beforeAll(() => {
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

    expect(nodes).toEqual([
      {
        id: 'dashboard-context-attachments',
        label: 'Attachments',
        count: 2,
        type: 'dashboard-group',
        expanded: true,
        hasToggle: true,
        grip: false,
        attrs: {
          'data-dashboard-target': 'context'
        },
        children: [
          {
            id: null,
            label: 'docs/spec.pdf',
            count: 'Missing · x2',
            type: 'dashboard-file',
            expanded: false,
            hasToggle: false,
            grip: false,
            attrs: {
              'data-dashboard-target': 'file',
              'data-dashboard-status': 'missing',
              title: 'docs/spec.pdf / Attachments / Missing / 2 references'
            }
          },
          {
            id: null,
            label: 'docs/notes.md',
            count: 'Exists',
            type: 'dashboard-file',
            expanded: false,
            hasToggle: false,
            grip: false,
            attrs: {
              'data-dashboard-target': 'file',
              'data-dashboard-status': 'exists',
              title: 'docs/notes.md / Attachments / Exists'
            }
          }
        ]
      },
      {
        id: 'dashboard-context-gallery',
        label: 'Gallery',
        count: 1,
        type: 'dashboard-group',
        expanded: true,
        hasToggle: true,
        grip: false,
        attrs: {
          'data-dashboard-target': 'context'
        },
        children: [
          {
            id: null,
            label: 'media/preview.png',
            count: 'Unknown',
            type: 'dashboard-file',
            expanded: false,
            hasToggle: false,
            grip: false,
            attrs: {
              'data-dashboard-target': 'file',
              'data-dashboard-status': 'unknown',
              title: 'media/preview.png / Gallery / Unknown'
            }
          }
        ]
      }
    ]);
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

    expect(nodes).toEqual([
      {
        id: 'dashboard-broken-image',
        label: 'Image',
        count: 1,
        type: 'dashboard-group',
        expanded: true,
        hasToggle: true,
        grip: false,
        attrs: {
          'data-dashboard-target': 'broken-group',
          'data-dashboard-broken-type': 'image'
        },
        children: [
          {
            id: null,
            label: 'media/missing.png',
            count: 'x3',
            type: 'dashboard-broken',
            expanded: false,
            hasToggle: false,
            grip: false,
            attrs: {
              'data-dashboard-target': 'broken',
              'data-dashboard-col-index': '2',
              'data-dashboard-card-index': '5',
              'data-dashboard-card-id': null,
              'data-dashboard-broken-type': 'image',
              title: 'media/missing.png / Image / 3 occurrences'
            }
          }
        ]
      },
      {
        id: 'dashboard-broken-include',
        label: 'Include',
        count: 1,
        type: 'dashboard-group',
        expanded: true,
        hasToggle: true,
        grip: false,
        attrs: {
          'data-dashboard-target': 'broken-group',
          'data-dashboard-broken-type': 'include'
        },
        children: [
          {
            id: null,
            label: 'docs/missing.md',
            count: null,
            type: 'dashboard-broken',
            expanded: false,
            hasToggle: false,
            grip: false,
            attrs: {
              'data-dashboard-target': 'broken',
              'data-dashboard-col-index': null,
              'data-dashboard-card-index': null,
              'data-dashboard-card-id': null,
              'data-dashboard-broken-type': 'include',
              title: 'docs/missing.md / Include / File not found'
            }
          }
        ]
      }
    ]);
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

    expect(nodes).toEqual([
      {
        id: 'dashboard-tag-blocked',
        label: '#blocked',
        count: 1,
        type: 'dashboard-group',
        expanded: true,
        hasToggle: true,
        grip: false,
        attrs: {
          'data-dashboard-target': 'tag',
          'data-dashboard-tag': '#blocked'
        },
        children: [
          {
            id: 'dashboard-group-board-1',
            label: 'Project Board',
            count: 1,
            type: 'dashboard-group',
            expanded: true,
            hasToggle: true,
            grip: false,
            attrs: {
              'data-dashboard-target': 'board',
              'data-dashboard-board-id': 'board-1'
            },
            children: [
              {
                id: null,
                label: 'Fix release blocker',
                count: null,
                type: 'dashboard-result',
                expanded: false,
                hasToggle: false,
                grip: false,
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
              }
            ]
          }
        ]
      }
    ]);
  });
});
