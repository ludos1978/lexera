/**
 * TreeView — Generic reusable tree rendering component.
 *
 * Renders a hierarchical tree with indent guides, toggle buttons,
 * labels, count badges, and optional drag grips.
 *
 * Node data model:
 * {
 *   id: string|null,        // unique identifier for state tracking
 *   label: string,          // display text (plain text — escaped by renderer)
 *   count: number|null,     // optional count badge
 *   type: string|null,      // CSS class suffix → .tree-{type}
 *   children: Array|null,   // child nodes
 *   expanded: boolean,      // expand/collapse state
 *   hasToggle: boolean,     // show toggle vs spacer (default: auto from children)
 *   grip: boolean,          // show drag grip (default: true)
 *   gripTitle: string,      // tooltip for grip
 *   attrs: Object|null,     // data-* attributes on .tree-node
 * }
 */
var TreeView = (function () {
  'use strict';

  var GUIDE_WIDTH = 12; // px per indent level

  // --- Internal helpers ---

  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function computeNodePadLeft() {
    var s = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale');
    return 6 * (parseFloat(s) || 1);
  }

  function getNodeDragIconSvg(nodeType) {
    var value = String(nodeType || '').trim().toLowerCase();
    if (value === 'row') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="6" rx="1"></rect><rect x="3" y="13" width="18" height="8" rx="1"></rect></svg>';
    }
    if (value === 'stack') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="4" height="18" rx="1"></rect><rect x="10" y="3" width="4" height="18" rx="1"></rect><rect x="17" y="3" width="4" height="18" rx="1"></rect></svg>';
    }
    if (value === 'column') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="13" height="11" rx="2" stroke-dasharray="4 2"></rect><rect x="9" y="9" width="13" height="11" rx="2"></rect></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="8" y1="9" x2="16" y2="9"></line><line x1="8" y1="13" x2="13" y2="13"></line></svg>';
  }

  function buildIndentHtml(parentLastFlags, isLast) {
    var h = '<span class="tree-indent">';
    for (var g = 0; g < parentLastFlags.length; g++) {
      h += '<span class="indent-guide' + (parentLastFlags[g] ? ' last' : '') + '"></span>';
    }
    h += '<span class="indent-guide ' + (isLast ? 'corner' : 'branch') + '"></span>';
    h += '</span>';
    return h;
  }

  function applyChildrenGuides(container, parentLastFlags, nodeLeftPad) {
    container.style.position = 'relative';
    for (var g = 0; g < parentLastFlags.length; g++) {
      if (!parentLastFlags[g]) {
        var line = document.createElement('span');
        line.className = 'tree-children-guide';
        line.style.left = (nodeLeftPad + g * GUIDE_WIDTH + 5) + 'px';
        container.appendChild(line);
      }
    }
  }

  // --- Recursive renderer ---

  function renderNode(node, parentLastFlags, isLast, options, nodePadLeft, depth) {
    var fragment = document.createDocumentFragment();
    var esc = options.escapeHtml || function (s) { return s; };
    var level = depth || 0;

    // Determine toggle
    var hasChildren = node.children && node.children.length > 0;
    var showToggle = node.hasToggle != null ? node.hasToggle : hasChildren;
    var showGrip = node.grip !== false;

    // Create .tree-node
    var el = document.createElement('div');
    el.className = 'tree-node' + (node.type ? ' tree-' + node.type : '');
    if (node.id) el.setAttribute('data-tree-id', node.id);
    el.setAttribute('data-tree-depth', String(level));

    // Set arbitrary attributes
    if (node.attrs) {
      var keys = Object.keys(node.attrs);
      for (var k = 0; k < keys.length; k++) {
        var v = node.attrs[keys[k]];
        if (v != null) el.setAttribute(keys[k], v);
      }
    }

    el.innerHTML =
      buildIndentHtml(parentLastFlags, isLast) +
      (showToggle
        ? '<span class="tree-toggle' + (node.expanded ? ' expanded' : '') + '"></span>'
        : '<span class="tree-toggle-spacer"></span>') +
      '<span class="tree-label">' + esc(node.label) + '</span>' +
      (node.count != null ? '<span class="tree-count">' + node.count + '</span>' : '') +
      (showGrip
        ? '<span class="tree-grip entity-drag-icon entity-drag-icon-' + escAttr(node.type || 'card') + '" title="' + escAttr(node.gripTitle || 'Drag to reorder') + '">' + getNodeDragIconSvg(node.type) + '</span>'
        : '');

    fragment.appendChild(el);

    // Render children container (also for empty arrays — supports empty drop zones)
    if (Array.isArray(node.children)) {
      var childContainer = document.createElement('div');
      childContainer.className = 'tree-children' + (node.expanded ? ' expanded' : '');
      childContainer.setAttribute('data-tree-depth', String(level + 1));

      // Let caller customize the children container (e.g. add drop-zone classes)
      if (options.onChildrenContainer) {
        options.onChildrenContainer(childContainer, node);
      }

      var childIndent = parentLastFlags.concat([isLast]);
      applyChildrenGuides(childContainer, childIndent, nodePadLeft);

      for (var i = 0; i < node.children.length; i++) {
        var childIsLast = i === node.children.length - 1;
        var childFrag = renderNode(node.children[i], childIndent, childIsLast, options, nodePadLeft, level + 1);
        childContainer.appendChild(childFrag);
      }
      fragment.appendChild(childContainer);
    }

    return fragment;
  }

  // --- Public API ---

  /**
   * Render a tree into a container element.
   * @param {HTMLElement} container - Target element (tree nodes are appended)
   * @param {Array} nodes - Array of root-level tree node objects
   * @param {Object} [options] - Rendering options
   * @param {Function} [options.escapeHtml] - HTML escape function for labels
   * @param {Function} [options.onChildrenContainer] - Callback(el, node) to customize children containers
   */
  function render(container, nodes, options) {
    options = options || {};
    var nodePadLeft = computeNodePadLeft();
    for (var i = 0; i < nodes.length; i++) {
      var isLast = i === nodes.length - 1;
      container.appendChild(renderNode(nodes[i], [], isLast, options, nodePadLeft, 0));
    }
  }

  /**
   * Toggle expand/collapse on a tree node element.
   * @param {HTMLElement} nodeEl - A .tree-node element
   * @returns {boolean|null} New expanded state, or null if no toggle found
   */
  function toggleNode(nodeEl) {
    var toggle = nodeEl.querySelector('.tree-toggle');
    if (!toggle) return null;
    var children = nodeEl.nextElementSibling;
    if (!children || !children.classList.contains('tree-children')) return null;
    var expanding = !children.classList.contains('expanded');
    children.classList.toggle('expanded');
    toggle.classList.toggle('expanded');
    return expanding;
  }

  /**
   * Recursively expand or collapse all descendants inside a container.
   * @param {HTMLElement} container - Container element
   * @param {boolean} expand - true = expand, false = collapse
   */
  function setDescendantsExpanded(container, expand) {
    var childContainers = container.querySelectorAll('.tree-children');
    var childToggles = container.querySelectorAll('.tree-toggle');
    for (var i = 0; i < childContainers.length; i++) {
      if (expand) childContainers[i].classList.add('expanded');
      else childContainers[i].classList.remove('expanded');
    }
    for (var i = 0; i < childToggles.length; i++) {
      if (expand) childToggles[i].classList.add('expanded');
      else childToggles[i].classList.remove('expanded');
    }
  }

  return {
    render: render,
    toggleNode: toggleNode,
    setDescendantsExpanded: setDescendantsExpanded,
    buildIndentHtml: buildIndentHtml,
    applyChildrenGuides: applyChildrenGuides,
    computeNodePadLeft: computeNodePadLeft,
    GUIDE_WIDTH: GUIDE_WIDTH
  };
})();
