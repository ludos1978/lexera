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
  var BURGER_MENU_ICON_HTML = '<span class="burger-lines" aria-hidden="true"></span>';

  // --- Internal helpers ---

  function normalizeSidebarDisplayOptions(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    return {
      counts: source.counts !== false,
      presence: source.presence !== false
    };
  }

  function readSidebarDisplayOptions() {
    try {
      var raw = localStorage.getItem('lexera-sidebar-tree-display');
      if (raw) return normalizeSidebarDisplayOptions(JSON.parse(raw));
    } catch (_) { /* ignore malformed or unavailable storage */ }
    try {
      return {
        counts: localStorage.getItem('lexera-sidebar-counts') !== '0',
        presence: localStorage.getItem('lexera-sidebar-presence') !== '0'
      };
    } catch (_) {
      return normalizeSidebarDisplayOptions(null);
    }
  }

  function applySidebarDisplayAttributes(options) {
    var root = typeof document !== 'undefined' && document.documentElement ? document.documentElement : null;
    if (!root) return;
    var normalized = normalizeSidebarDisplayOptions(options);
    root.setAttribute('data-sidebar-tree-counts', normalized.counts ? 'on' : 'off');
    root.setAttribute('data-sidebar-tree-presence', normalized.presence ? 'on' : 'off');
    root.removeAttribute('data-sidebar-tree-grips');
    root.removeAttribute('data-sidebar-tree-menus');
  }

  function installSidebarDisplaySettingsBridge() {
    applySidebarDisplayAttributes(readSidebarDisplayOptions());
    var tauri = typeof window !== 'undefined' ? window.__TAURI__ : null;
    var eventApi = tauri && tauri.event ? tauri.event : null;
    var currentWebview = tauri && tauri.webview && typeof tauri.webview.getCurrentWebview === 'function'
      ? tauri.webview.getCurrentWebview() : null;
    var listen = currentWebview && typeof currentWebview.listen === 'function'
      ? function (eventName, handler) { return currentWebview.listen(eventName, handler); }
      : eventApi && typeof eventApi.listen === 'function'
        ? function (eventName, handler) { return eventApi.listen(eventName, handler); }
        : null;
    if (!listen) return;
    try {
      listen('frontend-setting-changed', function (event) {
        var payload = event && event.payload ? event.payload : null;
        if (!payload || payload.setting !== 'sidebarDisplayOptions') return;
        applySidebarDisplayAttributes(payload.value || readSidebarDisplayOptions());
      });
    } catch (_) { /* listener unavailable outside Tauri */ }
  }

  installSidebarDisplaySettingsBridge();

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
      ? '<button class="tree-meta-action tree-menu-btn burger-menu-btn" title="Options" aria-label="Options" aria-haspopup="menu">' + BURGER_MENU_ICON_HTML + '</button>'
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

      var childIndent = parentLastFlags.concat([isLast]);
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

  // --- Incremental patch ---

  /**
   * Build a map of data-tree-id → DOM entry element for direct children of a container.
   */
  function indexEntries(container) {
    var map = {};
    for (var i = 0; i < container.children.length; i++) {
      var entry = container.children[i];
      if (!entry.classList || !entry.classList.contains('tree-entry')) continue;
      var nodeEl = entry.querySelector(':scope > .tree-node[data-tree-id]');
      if (nodeEl) {
        map[nodeEl.getAttribute('data-tree-id')] = entry;
      }
    }
    return map;
  }

  /**
   * Update an existing tree-node's label and count in-place.
   */
  function updateNodeContent(nodeEl, node, esc) {
    var labelEl = nodeEl.querySelector(':scope > .tree-label');
    if (labelEl) {
      var newLabel = esc(node.label);
      if (labelEl.innerHTML !== newLabel) labelEl.innerHTML = newLabel;
    }
    var countEl = nodeEl.querySelector(':scope > .tree-meta > .tree-count');
    if (countEl) {
      var countText = node.count != null ? esc(String(node.count)) : '';
      if (countEl.textContent !== countText) countEl.textContent = countText;
      countEl.classList.toggle('hidden', node.count == null);
    }
    // Update data-* attributes
    if (node.attrs) {
      var keys = Object.keys(node.attrs);
      for (var k = 0; k < keys.length; k++) {
        var v = node.attrs[keys[k]];
        if (v != null) nodeEl.setAttribute(keys[k], v);
        else nodeEl.removeAttribute(keys[k]);
      }
    }
  }

  /**
   * Patch children of a container incrementally by matching data-tree-id.
   * Nodes without an id are always rebuilt. Groups with matching ids are
   * updated in-place (label, count, attributes) and their children are
   * recursively patched. Expand/collapse state is preserved.
   */
  function patchChildren(container, newNodes, parentLastFlags, options, nodePadLeft, depth) {
    var esc = options.escapeHtml || function (s) { return s; };
    var existingMap = indexEntries(container);
    var usedIds = {};
    // Build ordered list of new entries
    var newEntries = [];
    for (var i = 0; i < newNodes.length; i++) {
      var node = newNodes[i];
      var isLast = i === newNodes.length - 1;
      var nodeId = node.id || null;
      var existing = nodeId ? existingMap[nodeId] : null;

      if (existing && nodeId) {
        usedIds[nodeId] = true;
        // Update the existing entry in-place
        var nodeEl = existing.querySelector(':scope > .tree-node[data-tree-id]');
        if (nodeEl) {
          updateNodeContent(nodeEl, node, esc);
        }
        // Recursively patch children if this is a group node
        if (Array.isArray(node.children)) {
          var childrenEl = existing.querySelector(':scope > .tree-children');
          if (childrenEl) {
            var childIndent = parentLastFlags.concat([isLast]);
            patchChildren(childrenEl, node.children, childIndent, options, nodePadLeft, depth + 1);
          }
        }
        newEntries.push(existing);
      } else {
        // New node — render fresh
        var freshEntry = renderNode(node, parentLastFlags, isLast, options, nodePadLeft, depth);
        newEntries.push(freshEntry);
      }
    }
    // Remove entries not in new data
    for (var id in existingMap) {
      if (!usedIds[id]) {
        var stale = existingMap[id];
        if (stale.parentNode === container) container.removeChild(stale);
      }
    }
    // Also remove non-entry children that aren't in the new set (e.g. empty messages)
    var nonEntryChildren = [];
    for (var c = container.children.length - 1; c >= 0; c--) {
      var ch = container.children[c];
      if (!ch.classList || !ch.classList.contains('tree-entry')) {
        nonEntryChildren.push(ch);
      }
    }
    for (var r = 0; r < nonEntryChildren.length; r++) {
      container.removeChild(nonEntryChildren[r]);
    }
    // Reorder: ensure DOM order matches newEntries order
    for (var j = 0; j < newEntries.length; j++) {
      var expected = newEntries[j];
      var current = container.children[j];
      if (current !== expected) {
        container.insertBefore(expected, current || null);
      }
    }
  }

  /**
   * Incrementally update a tree container. Reuses existing DOM nodes for
   * groups with matching data-tree-id, preserving expand/collapse state.
   * Falls back to full render if the container has no existing tree nodes.
   *
   * @param {HTMLElement} container - Target element with existing tree
   * @param {Array} nodes - New tree node data
   * @param {Object} [options] - Same as render() options
   * @returns {boolean} true if patch was applied, false if full render is needed
   */
  function patch(container, nodes, options) {
    options = options || {};
    // Only patch if container already has tree entries
    var hasEntries = container.querySelector(':scope > .tree-entry') !== null;
    if (!hasEntries) return false;

    container.classList.add('tree-view');
    var nodePadLeft = computeNodePadLeft();
    patchChildren(container, nodes, [], options, nodePadLeft, 1);
    return true;
  }

  return {
    render: render,
    patch: patch,
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
