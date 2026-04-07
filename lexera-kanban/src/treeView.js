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
 *   hierarchy: Object|null, // optional shared hierarchy descriptor
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

  var GUIDE_WIDTH = 12; // fallback px per indent level

  // --- Internal helpers ---

  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function readCssPixelVar(name, fallback) {
    var raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    var value = parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  function computeNodePadLeft() {
    var s = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale');
    return 6 * (parseFloat(s) || 1);
  }

  function computeGuideWidth() {
    return readCssPixelVar('--tree-indent-step', GUIDE_WIDTH);
  }

  function getNodeDragIconSvg(nodeType) {
    var value = String(nodeType || '').trim().toLowerCase();
    if (value === 'board') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1"></rect><rect x="6" y="6" width="5" height="5" rx="1"></rect><rect x="13" y="6" width="5" height="5" rx="1"></rect><rect x="6" y="13" width="12" height="5" rx="1"></rect></svg>';
    }
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


  function getNodeEntry(nodeEl) {
    if (!nodeEl || !nodeEl.parentElement) return null;
    var entry = nodeEl.parentElement;
    return entry.classList && entry.classList.contains('tree-entry') ? entry : null;
  }

  function getNodeChildrenContainer(nodeEl) {
    var entry = getNodeEntry(nodeEl);
    if (!entry) return null;
    for (var i = 0; i < entry.children.length; i++) {
      var child = entry.children[i];
      if (child.classList && child.classList.contains('tree-children')) {
        return child;
      }
    }
    return null;
  }

  function getChildrenOwnerNode(childrenEl) {
    if (!childrenEl || !childrenEl.parentElement) return null;
    var entry = childrenEl.parentElement;
    if (!entry.classList || !entry.classList.contains('tree-entry')) return null;
    for (var i = 0; i < entry.children.length; i++) {
      var child = entry.children[i];
      if (child.classList && child.classList.contains('tree-node')) {
        return child;
      }
    }
    return null;
  }

  function applyHierarchyDescriptorAttrs(targetEl, hierarchy) {
    if (!targetEl || !hierarchy) return;
    var surface = hierarchy.surface != null ? String(hierarchy.surface).trim() : '';
    var kind = hierarchy.kind != null ? String(hierarchy.kind).trim() : '';
    var entityId = hierarchy.entityId != null ? String(hierarchy.entityId).trim() : '';
    var capabilities = Array.isArray(hierarchy.capabilities) ? hierarchy.capabilities : [];
    var capabilityTokens = [];
    for (var i = 0; i < capabilities.length; i++) {
      var token = String(capabilities[i] == null ? '' : capabilities[i]).trim().toLowerCase();
      if (!token) continue;
      if (capabilityTokens.indexOf(token) !== -1) continue;
      capabilityTokens.push(token);
    }
    if (surface) targetEl.setAttribute('data-hierarchy-surface', surface);
    if (kind) targetEl.setAttribute('data-hierarchy-kind', kind);
    if (entityId) targetEl.setAttribute('data-hierarchy-entity-id', entityId);
    if (capabilityTokens.length > 0) {
      targetEl.setAttribute('data-hierarchy-capabilities', capabilityTokens.join(' '));
    }
    if (hierarchy.selectable === true) {
      targetEl.setAttribute('data-hierarchy-selectable', 'true');
    }
  }

  // --- Recursive renderer ---

  function renderNode(node, parentLastFlags, isLast, options, nodePadLeft, depth) {
    var esc = options.escapeHtml || function (s) { return s; };
    var level = depth || 0;

    // Determine toggle
    var hasChildren = node.children && node.children.length > 0;
    var isContainerNode = Array.isArray(node.children);
    var showToggle = node.hasToggle != null ? node.hasToggle : hasChildren;
    var showGrip = node.grip !== false;
    var nodeRole = (isContainerNode || showToggle) ? 'branch' : 'leaf';
    var structuralRole = node && node.structuralRole ? String(node.structuralRole).trim().toLowerCase() : '';
    if (!structuralRole) structuralRole = nodeRole === 'branch' ? 'group' : 'item';

    var entry = document.createElement('div');
    entry.className = 'tree-entry' + (node.type ? ' tree-entry-' + node.type : '');
    entry.setAttribute('data-tree-depth', String(level));
    entry.setAttribute('data-tree-node-role', nodeRole);
    entry.setAttribute('data-tree-structural-role', structuralRole);
    if (level === 1) entry.setAttribute('data-tree-root', 'true');
    entry.setAttribute('role', 'none');

    // Create .tree-node
    var el = document.createElement('div');
    el.className = 'tree-node' + (node.type ? ' tree-' + node.type : '');
    if (node.id) el.setAttribute('data-tree-id', node.id);
    el.setAttribute('data-tree-depth', String(level));
    el.setAttribute('data-tree-node-role', nodeRole);
    el.setAttribute('data-tree-structural-role', structuralRole);
    if (level === 1) el.setAttribute('data-tree-root', 'true');
    el.setAttribute('role', 'treeitem');
    el.setAttribute('aria-level', String(level));
    if (showToggle) {
      el.setAttribute('aria-expanded', node.expanded ? 'true' : 'false');
    }

    // Set arbitrary attributes
    if (node.attrs) {
      var keys = Object.keys(node.attrs);
      for (var k = 0; k < keys.length; k++) {
        var v = node.attrs[keys[k]];
        if (v != null) el.setAttribute(keys[k], v);
      }
    }
    applyHierarchyDescriptorAttrs(el, node.hierarchy);

    var presenceHtml = '<span class="tree-meta-presence tree-meta-presence-spacer" aria-hidden="true"></span>';
    var countHtml = '<span class="tree-count' + (node.count != null ? '' : ' hidden') + '">' +
      (node.count != null ? esc(String(node.count)) : '') +
      '</span>';
    var actionHtml = node.menu
      ? '<button class="tree-meta-action tree-menu-btn burger-menu-btn" title="Options" aria-haspopup="menu">\u2261</button>'
      : '<span class="tree-meta-action tree-meta-action-spacer" aria-hidden="true"></span>';
    var gripHtml = showGrip
      ? '<span class="tree-grip entity-drag-icon entity-drag-icon-' + escAttr(node.type || 'card') + '" title="' + escAttr(node.gripTitle || 'Drag to reorder') + '">' + getNodeDragIconSvg(node.type) + '</span>'
      : '<span class="tree-grip tree-grip-spacer" aria-hidden="true"></span>';

    el.innerHTML =
      buildIndentHtml(parentLastFlags, isLast) +
      (showToggle
        ? '<span class="tree-toggle' + (node.expanded ? ' expanded' : '') + '"></span>'
        : '<span class="tree-toggle-spacer"></span>') +
      '<span class="tree-label">' + esc(node.label) + '</span>' +
      '<span class="tree-meta">' +
        presenceHtml +
        countHtml +
        actionHtml +
        gripHtml +
      '</span>';

    entry.appendChild(el);

    // Render children container (also for empty arrays — supports empty drop zones)
    if (Array.isArray(node.children)) {
      var childContainer = document.createElement('div');
      childContainer.className = 'tree-children' + (node.expanded ? ' expanded' : '');
      childContainer.setAttribute('data-tree-depth', String(level + 1));
      childContainer.setAttribute('role', 'group');

      // Let caller customize the children container (e.g. add drop-zone classes)
      if (options.onChildrenContainer) {
        options.onChildrenContainer(childContainer, node);
      }

      var compactRootFlatten = options && options.variant === 'compact' && level === 1;
      var childIndent = compactRootFlatten ? [] : parentLastFlags.concat([isLast]);
      for (var i = 0; i < node.children.length; i++) {
        var childIsLast = i === node.children.length - 1;
        var childFrag = renderNode(node.children[i], childIndent, childIsLast, options, nodePadLeft, level + 1);
        childContainer.appendChild(childFrag);
      }
      entry.appendChild(childContainer);
    }

    return entry;
  }

  // --- Public API ---

  /**
   * Render a tree into a container element.
   * @param {HTMLElement} container - Target element (tree nodes are appended)
   * @param {Array} nodes - Array of root-level tree node objects
   * @param {Object} [options] - Rendering options
   * @param {Function} [options.escapeHtml] - HTML escape function for labels
   * @param {Function} [options.onChildrenContainer] - Callback(el, node) to customize children containers
   * @param {string} [options.variant] - Optional visual variant (adds .tree-view-{variant})
   */
  function render(container, nodes, options) {
    options = options || {};
    container.classList.add('tree-view');
    if (options.variant) {
      container.classList.add('tree-view-' + options.variant);
    }
    var nodePadLeft = computeNodePadLeft();
    for (var i = 0; i < nodes.length; i++) {
      var isLast = i === nodes.length - 1;
      container.appendChild(renderNode(nodes[i], [], isLast, options, nodePadLeft, 1));
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
    var children = getNodeChildrenContainer(nodeEl);
    if (!children) return null;
    var expanding = !children.classList.contains('expanded');
    children.classList.toggle('expanded');
    toggle.classList.toggle('expanded');
    nodeEl.setAttribute('aria-expanded', expanding ? 'true' : 'false');
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
      var ownerNode = getChildrenOwnerNode(childContainers[i]);
      if (ownerNode) ownerNode.setAttribute('aria-expanded', expand ? 'true' : 'false');
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
    getNodeChildrenContainer: getNodeChildrenContainer,
    getChildrenOwnerNode: getChildrenOwnerNode,
    buildIndentHtml: buildIndentHtml,
    computeNodePadLeft: computeNodePadLeft,
    computeGuideWidth: computeGuideWidth,
    GUIDE_WIDTH: GUIDE_WIDTH
  };
})();
// Ensure TreeView is on window so management.js and other shared modules
// can find it via window.TreeView even in strict-mode or module contexts.
if (typeof window !== 'undefined') window.TreeView = TreeView;
