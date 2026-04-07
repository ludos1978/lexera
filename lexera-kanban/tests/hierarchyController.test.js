// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HierarchyContract = require('../src/hierarchy/hierarchyContract.js');
const HierarchyController = require('../src/hierarchy/hierarchyController.js');

function createTreeDom() {
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="tree-entry">
      <div class="tree-node tree-result" data-tree-id="node-1" data-dashboard-target="result">
        <span class="tree-toggle"></span>
        <span class="tree-label">Node</span>
        <button class="tree-menu-btn" type="button">Menu</button>
        <span class="tree-grip"></span>
      </div>
      <div class="tree-children expanded"></div>
    </div>
  `;
  document.body.appendChild(container);
  return {
    container,
    node: container.querySelector('.tree-node'),
    toggle: container.querySelector('.tree-toggle'),
    label: container.querySelector('.tree-label'),
    menu: container.querySelector('.tree-menu-btn'),
    grip: container.querySelector('.tree-grip')
  };
}

describe('LexeraHierarchyController.bindTreeInteractions', () => {
  it('uses TreeView.toggleNode by default for toggle clicks', () => {
    const dom = createTreeDom();
    const toggleNode = vi.fn();
    const onNodeActivate = vi.fn();

    HierarchyController.bindTreeInteractions(dom.container, {
      TreeView: { toggleNode },
      onNodeActivate
    });

    dom.toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(toggleNode).toHaveBeenCalledTimes(1);
    expect(toggleNode).toHaveBeenCalledWith(dom.node);
    expect(onNodeActivate).not.toHaveBeenCalled();
  });

  it('routes activate, menu, contextmenu, and edit events to callbacks', () => {
    const dom = createTreeDom();
    const onNodeActivate = vi.fn();
    const onNodeMenu = vi.fn();
    const onNodeContextMenu = vi.fn();
    const onNodeEdit = vi.fn();

    HierarchyController.bindTreeInteractions(dom.container, {
      TreeView: { toggleNode: vi.fn() },
      onNodeActivate,
      onNodeMenu,
      onNodeContextMenu,
      onNodeEdit
    });

    dom.label.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    dom.menu.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const contextEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 24 });
    dom.label.dispatchEvent(contextEvent);
    dom.label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    dom.menu.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

    expect(onNodeActivate).toHaveBeenCalledTimes(1);
    expect(onNodeActivate).toHaveBeenCalledWith(dom.node, expect.any(MouseEvent), expect.any(Object));
    expect(onNodeMenu).toHaveBeenCalledTimes(1);
    expect(onNodeMenu).toHaveBeenCalledWith(dom.node, expect.any(MouseEvent), expect.any(Object));
    expect(onNodeContextMenu).toHaveBeenCalledTimes(1);
    expect(onNodeContextMenu).toHaveBeenCalledWith(dom.node, expect.any(MouseEvent), expect.any(Object));
    expect(contextEvent.defaultPrevented).toBe(true);
    expect(onNodeEdit).toHaveBeenCalledTimes(1);
    expect(onNodeEdit).toHaveBeenCalledWith(dom.node, expect.any(MouseEvent), expect.any(Object));
  });

  it('binds only once per container', () => {
    const dom = createTreeDom();
    const onNodeActivate = vi.fn();

    HierarchyController.bindTreeInteractions(dom.container, {
      onNodeActivate
    });
    HierarchyController.bindTreeInteractions(dom.container, {
      onNodeActivate
    });

    dom.label.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onNodeActivate).toHaveBeenCalledTimes(1);
  });

  it('respects hierarchy capability gating for activate, menu, edit, and drag affordances', () => {
    const dom = createTreeDom();
    dom.node.setAttribute('data-hierarchy-capabilities', 'activate');
    const onNodeActivate = vi.fn();
    const onNodeMenu = vi.fn();
    const onNodeEdit = vi.fn();
    const onGripClick = vi.fn();

    HierarchyController.bindTreeInteractions(dom.container, {
      HierarchyContract,
      onNodeActivate,
      onNodeMenu,
      onNodeEdit,
      onGripClick
    });

    dom.label.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    dom.menu.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    dom.label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    dom.grip.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onNodeActivate).toHaveBeenCalledTimes(1);
    expect(onNodeMenu).not.toHaveBeenCalled();
    expect(onNodeEdit).not.toHaveBeenCalled();
    expect(onGripClick).not.toHaveBeenCalled();
  });
});

describe('LexeraHierarchyController.beginInlineLabelEdit', () => {
  it('commits a renamed label and restores on escape', async () => {
    const dom = createTreeDom();
    const onCommit = vi.fn(() => Promise.resolve(true));

    const editSession = HierarchyController.beginInlineLabelEdit(dom.node, {
      initialValue: 'Original',
      initialDisplayValue: 'Original',
      onCommit
    });

    expect(editSession).toBeTruthy();
    expect(dom.node.getAttribute('data-tree-inline-editing')).toBe('true');
    editSession.input.value = 'Renamed';
    editSession.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onCommit).toHaveBeenCalledWith('Renamed', expect.objectContaining({
      initialValue: 'Original',
      displayValue: 'Renamed'
    }));
    expect(dom.node.querySelector('.tree-label').textContent).toBe('Renamed');

    await Promise.resolve();

    const secondSession = HierarchyController.beginInlineLabelEdit(dom.node, {
      initialValue: 'Renamed',
      initialDisplayValue: 'Renamed',
      onCommit
    });
    secondSession.input.value = 'Discarded';
    secondSession.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(dom.node.querySelector('.tree-label').textContent).toBe('Renamed');
  });

  it('supports multiline editing, empty commits, and shortcut-based save', () => {
    const dom = createTreeDom();
    const onCommit = vi.fn(() => true);

    const editSession = HierarchyController.beginInlineLabelEdit(dom.node, {
      initialValue: 'Original body',
      initialDisplayValue: 'Original preview',
      multiline: true,
      allowEmpty: true,
      commitKeys: ['Mod+Enter'],
      selectAll: false,
      onCommit
    });

    expect(editSession.input.tagName).toBe('TEXTAREA');
    editSession.input.value = '';
    editSession.input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true
    }));

    expect(onCommit).toHaveBeenCalledWith('', expect.objectContaining({
      initialValue: 'Original body',
      displayValue: ''
    }));
  });
});
