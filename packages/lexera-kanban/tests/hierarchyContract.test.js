// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { loadIIFE } from './load-iife.js';

const require = createRequire(import.meta.url);
const HierarchyContract = require('../src/hierarchy/hierarchyContract.js');

function loadTreeView() {
  return loadIIFE('treeView.js', 'TreeView', {
    window,
    document,
    getComputedStyle: window.getComputedStyle.bind(window)
  });
}

describe('LexeraHierarchyContract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('normalizes hierarchy node definitions through a shared descriptor', () => {
    const node = HierarchyContract.createNode({
      id: 'row:1',
      label: 'Row 1',
      type: 'row',
      structuralRole: 'group',
      hierarchy: {
        surface: 'workspace',
        kind: 'row',
        entityId: 'row-1',
        capabilities: ['activate', 'menu', 'activate'],
        selectable: true
      }
    });

    expect(node.hierarchy).toEqual({
      surface: 'workspace',
      kind: 'row',
      entityId: 'row-1',
      capabilities: ['activate', 'menu'],
      selectable: true
    });
    expect(node.structuralRole).toBe('group');
    expect(HierarchyContract.nodeSupportsCapability(node.hierarchy, 'menu')).toBe(true);
    expect(HierarchyContract.nodeSupportsCapability(node.hierarchy, 'edit')).toBe(false);
  });

  it('projects hierarchy descriptors into tree DOM attributes', () => {
    const TreeView = loadTreeView();
    const container = document.createElement('div');
    document.body.appendChild(container);

    TreeView.render(container, [
      HierarchyContract.createNode({
        id: 'board:1',
        label: 'Board One',
        type: 'board',
        structuralRole: 'item',
        grip: false,
        hasToggle: false,
        hierarchy: {
          surface: 'files',
          kind: 'board',
          entityId: 'board-1',
          capabilities: ['activate'],
          selectable: true
        }
      })
    ]);

    const node = container.querySelector('.tree-node');
    expect(node).toBeTruthy();
    expect(node.getAttribute('data-hierarchy-surface')).toBe('files');
    expect(node.getAttribute('data-hierarchy-kind')).toBe('board');
    expect(node.getAttribute('data-hierarchy-entity-id')).toBe('board-1');
    expect(node.getAttribute('data-hierarchy-capabilities')).toBe('activate');
    expect(node.getAttribute('data-hierarchy-selectable')).toBe('true');
    expect(HierarchyContract.readDescriptorFromNode(node)).toEqual({
      surface: 'files',
      kind: 'board',
      entityId: 'board-1',
      capabilities: ['activate'],
      selectable: true
    });
    expect(HierarchyContract.readStructuralRoleFromNode(node)).toBe('item');
    expect(node.getAttribute('data-tree-node-role')).toBe('leaf');
    expect(node.getAttribute('data-tree-structural-role')).toBe('item');
  });

  it('marks rendered container nodes as branch roles', () => {
    const TreeView = loadTreeView();
    const container = document.createElement('div');
    document.body.appendChild(container);

    TreeView.render(container, [
      HierarchyContract.createNode({
        id: 'ctx:1',
        label: 'File Embeds',
        type: 'dashboard-group',
        structuralRole: 'group',
        grip: false,
        expanded: true,
        children: [
          HierarchyContract.createNode({
            id: 'file:1',
            label: 'PlantUML Diagram Tests',
            type: 'dashboard-file',
            structuralRole: 'item',
            grip: false,
            hasToggle: false
          })
        ]
      })
    ], { variant: 'compact' });

    const branchNode = container.querySelector('.tree-node[data-tree-id="ctx:1"]');
    expect(branchNode).toBeTruthy();
    expect(branchNode.getAttribute('data-tree-node-role')).toBe('branch');
    expect(branchNode.getAttribute('data-tree-structural-role')).toBe('group');
    expect(branchNode.getAttribute('data-tree-root')).toBe('true');
  });
});
