(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraHierarchyController = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function closestWithin(target, selector, container) {
    if (!target || typeof target.closest !== 'function') return null;
    var match = target.closest(selector);
    if (!match) return null;
    if (container && typeof container.contains === 'function' && !container.contains(match)) return null;
    return match;
  }

  function findTreeNode(target, container) {
    return closestWithin(target, '.tree-node', container);
  }

  function buildHelpers(options) {
    options = options || {};
    var TreeView = options.TreeView || null;
    var helpers = {};

    helpers.getNodeChildrenContainer = function (node) {
      if (typeof options.getNodeChildrenContainer === 'function') {
        return options.getNodeChildrenContainer(node);
      }
      if (TreeView && typeof TreeView.getNodeChildrenContainer === 'function') {
        return TreeView.getNodeChildrenContainer(node);
      }
      return null;
    };

    helpers.toggleNode = function (node, event) {
      if (!node) return null;
      if (typeof options.onNodeToggle === 'function') {
        return options.onNodeToggle(node, event, helpers);
      }
      if (TreeView && typeof TreeView.toggleNode === 'function') {
        return TreeView.toggleNode(node);
      }
      return null;
    };

    return helpers;
  }

  function bindTreeInteractions(targetEl, options) {
    if (!targetEl || targetEl.__lexeraHierarchyControllerBound) return targetEl;

    options = options || {};
    var helpers = buildHelpers(options);
    var menuSelector = options.menuSelector || '.tree-menu-btn';
    var toggleSelector = options.toggleSelector || '.tree-toggle';
    var gripSelector = options.gripSelector || '.tree-grip';

    targetEl.addEventListener('click', function (event) {
      var target = event.target;
      if (!target) return;

      var grip = closestWithin(target, gripSelector, targetEl);
      if (grip) {
        if (typeof options.onGripClick === 'function') {
          options.onGripClick(findTreeNode(grip, targetEl), event, helpers);
        } else {
          event.stopPropagation();
        }
        return;
      }

      var menu = closestWithin(target, menuSelector, targetEl);
      if (menu) {
        if (typeof options.onNodeMenu === 'function') {
          event.stopPropagation();
          options.onNodeMenu(findTreeNode(menu, targetEl), event, helpers);
        }
        return;
      }

      var toggle = closestWithin(target, toggleSelector, targetEl);
      if (toggle) {
        var toggleNode = findTreeNode(toggle, targetEl);
        if (!toggleNode) return;
        event.stopPropagation();
        helpers.toggleNode(toggleNode, event);
        return;
      }

      if (typeof options.onNodeActivate !== 'function') return;
      var node = findTreeNode(target, targetEl);
      if (!node) return;
      event.stopPropagation();
      options.onNodeActivate(node, event, helpers);
    });

    if (typeof options.onNodeContextMenu === 'function') {
      targetEl.addEventListener('contextmenu', function (event) {
        var node = findTreeNode(event.target, targetEl);
        if (!node) return;
        event.preventDefault();
        event.stopPropagation();
        options.onNodeContextMenu(node, event, helpers);
      });
    }

    if (typeof options.onNodeEdit === 'function') {
      targetEl.addEventListener('dblclick', function (event) {
        if (closestWithin(event.target, toggleSelector, targetEl) ||
            closestWithin(event.target, gripSelector, targetEl) ||
            closestWithin(event.target, menuSelector, targetEl)) {
          return;
        }
        var node = findTreeNode(event.target, targetEl);
        if (!node) return;
        event.preventDefault();
        event.stopPropagation();
        options.onNodeEdit(node, event, helpers);
      });
    }

    targetEl.__lexeraHierarchyControllerBound = true;
    return targetEl;
  }

  return {
    bindTreeInteractions: bindTreeInteractions,
    findTreeNode: findTreeNode,
    closestWithin: closestWithin
  };
}));
