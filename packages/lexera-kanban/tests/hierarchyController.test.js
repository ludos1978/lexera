// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
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
});
