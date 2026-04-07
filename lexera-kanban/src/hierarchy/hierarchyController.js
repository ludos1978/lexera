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

  function getHierarchyContractApi(options) {
    if (options && options.HierarchyContract) return options.HierarchyContract;
    if (typeof LexeraHierarchyContract !== 'undefined' && LexeraHierarchyContract) {
      return LexeraHierarchyContract;
    }
    if (typeof globalThis !== 'undefined' && globalThis.LexeraHierarchyContract) {
      return globalThis.LexeraHierarchyContract;
    }
    return null;
  }

  function readNodeDescriptor(node, options) {
    if (!node) return null;
    var hierarchyContract = getHierarchyContractApi(options);
    if (hierarchyContract && typeof hierarchyContract.readDescriptorFromNode === 'function') {
      return hierarchyContract.readDescriptorFromNode(node);
    }
    return null;
  }

  function nodeSupportsCapability(node, capability, options) {
    var descriptor = readNodeDescriptor(node, options);
    if (!descriptor) return true;
    var hierarchyContract = getHierarchyContractApi(options);
    if (hierarchyContract && typeof hierarchyContract.nodeSupportsCapability === 'function') {
      return hierarchyContract.nodeSupportsCapability(descriptor, capability);
    }
    return true;
  }

  function findTreeNode(target, container) {
    return closestWithin(target, '.tree-node', container);
  }

  function autoResizeMultilineInput(input) {
    if (!input || input.tagName !== 'TEXTAREA') return;
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
  }

  function matchesEditShortcut(event, shortcut) {
    if (!event || !shortcut) return false;
    var tokens = String(shortcut || '').toLowerCase().split('+');
    var expectedKey = '';
    var wantsCtrl = false;
    var wantsMeta = false;
    var wantsAlt = false;
    var wantsShift = false;
    var wantsMod = false;
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i].trim();
      if (!token) continue;
      if (token === 'ctrl' || token === 'control') wantsCtrl = true;
      else if (token === 'meta' || token === 'cmd' || token === 'command') wantsMeta = true;
      else if (token === 'alt' || token === 'option') wantsAlt = true;
      else if (token === 'shift') wantsShift = true;
      else if (token === 'mod') wantsMod = true;
      else expectedKey = token;
    }
    if (!expectedKey) return false;
    if (wantsMod) {
      if (!(event.ctrlKey || event.metaKey)) return false;
    } else {
      if (!!event.ctrlKey !== wantsCtrl) return false;
      if (!!event.metaKey !== wantsMeta) return false;
    }
    if (!!event.altKey !== wantsAlt) return false;
    if (!!event.shiftKey !== wantsShift) return false;
    return String(event.key || '').toLowerCase() === expectedKey;
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
        var gripNode = findTreeNode(grip, targetEl);
        if (!nodeSupportsCapability(gripNode, 'drag', options)) return;
        if (typeof options.onGripClick === 'function') {
          options.onGripClick(gripNode, event, helpers);
        } else {
          event.stopPropagation();
        }
        return;
      }

      var menu = closestWithin(target, menuSelector, targetEl);
      if (menu) {
        var menuNode = findTreeNode(menu, targetEl);
        if (!nodeSupportsCapability(menuNode, 'menu', options)) return;
        if (typeof options.onNodeMenu === 'function') {
          event.stopPropagation();
          options.onNodeMenu(menuNode, event, helpers);
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
      if (!nodeSupportsCapability(node, 'activate', options)) return;
      event.stopPropagation();
      options.onNodeActivate(node, event, helpers);
    });

    if (typeof options.onNodeContextMenu === 'function') {
      targetEl.addEventListener('contextmenu', function (event) {
        var node = findTreeNode(event.target, targetEl);
        if (!node) return;
        if (!nodeSupportsCapability(node, 'menu', options)) return;
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
        if (!nodeSupportsCapability(node, 'edit', options)) return;
        event.preventDefault();
        event.stopPropagation();
        options.onNodeEdit(node, event, helpers);
      });
    }

    targetEl.__lexeraHierarchyControllerBound = true;
    return targetEl;
  }

  function beginInlineLabelEdit(node, options) {
    if (!node) return null;

    options = options || {};
    var labelEl = typeof options.getLabelElement === 'function'
      ? options.getLabelElement(node)
      : node.querySelector('.tree-label');
    if (!labelEl) return null;

    if (typeof node.__lexeraHierarchyInlineEditCleanup === 'function') {
      node.__lexeraHierarchyInlineEditCleanup();
    }

    var initialValue = options.initialValue != null
      ? String(options.initialValue)
      : String(labelEl.textContent || '');
    var initialDisplayValue = options.initialDisplayValue != null
      ? String(options.initialDisplayValue)
      : String(labelEl.textContent || '');
    var multiline = options.multiline === true;
    var input = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = 'text';
    input.className = options.inputClassName || 'column-rename-input tree-inline-edit-input';
    input.value = initialValue;
    if (multiline && typeof options.rows === 'number' && options.rows > 0) input.rows = options.rows;
    if (typeof options.placeholder === 'string') input.placeholder = options.placeholder;

    function renderLabel(nextDisplayValue) {
      labelEl.textContent = '';
      if (typeof options.renderLabel === 'function') {
        options.renderLabel(labelEl, nextDisplayValue, {
          node: node,
          input: input,
          labelEl: labelEl
        });
        return;
      }
      labelEl.textContent = nextDisplayValue;
    }

    node.classList.add('tree-inline-editing');
    node.setAttribute('data-tree-inline-editing', 'true');
    labelEl.textContent = '';
    labelEl.appendChild(input);
    if (multiline && options.autoResize !== false) autoResizeMultilineInput(input);

    if (typeof options.onStart === 'function') {
      options.onStart({
        node: node,
        input: input,
        labelEl: labelEl,
        initialValue: initialValue,
        initialDisplayValue: initialDisplayValue
      });
    }

    if (typeof input.focus === 'function') input.focus();
    if (options.selectAll !== false && typeof input.select === 'function') input.select();

    var done = false;

    function clearEditingState() {
      node.classList.remove('tree-inline-editing');
      node.removeAttribute('data-tree-inline-editing');
      node.classList.remove('tree-inline-saving');
      node.removeAttribute('data-tree-inline-saving');
      node.__lexeraHierarchyInlineEditCleanup = null;
    }

    function restoreOriginal() {
      clearEditingState();
      renderLabel(initialDisplayValue);
    }

    function finish(mode) {
      if (done) return;
      done = true;

      if (mode === 'cancel') {
        restoreOriginal();
        if (typeof options.onCancel === 'function') {
          options.onCancel({
            node: node,
            input: input,
            labelEl: labelEl,
            initialValue: initialValue,
            initialDisplayValue: initialDisplayValue
          });
        }
        return;
      }

      var nextValue = typeof options.normalizeValue === 'function'
        ? options.normalizeValue(input.value, {
            node: node,
            input: input,
            labelEl: labelEl,
            initialValue: initialValue
          })
        : String(input.value || '').trim();

      if ((!options.allowEmpty && !nextValue) || nextValue === initialValue) {
        restoreOriginal();
        return;
      }

      var displayValue = typeof options.getDisplayValue === 'function'
        ? options.getDisplayValue(nextValue, {
            node: node,
            input: input,
            labelEl: labelEl,
            initialValue: initialValue
          })
        : nextValue;

      clearEditingState();
      renderLabel(displayValue);

      if (typeof options.onCommit !== 'function') return;

      var commitContext = {
        node: node,
        input: input,
        labelEl: labelEl,
        initialValue: initialValue,
        initialDisplayValue: initialDisplayValue,
        displayValue: displayValue,
        restoreOriginal: restoreOriginal,
        renderLabel: renderLabel
      };

      try {
        var commitResult = options.onCommit(nextValue, commitContext);
        if (commitResult === false) {
          restoreOriginal();
          return;
        }
        if (commitResult && typeof commitResult.then === 'function') {
          node.classList.add('tree-inline-saving');
          node.setAttribute('data-tree-inline-saving', 'true');
          commitResult.then(function (resolved) {
            node.classList.remove('tree-inline-saving');
            node.removeAttribute('data-tree-inline-saving');
            if (resolved === false) restoreOriginal();
          }).catch(function (err) {
            node.classList.remove('tree-inline-saving');
            node.removeAttribute('data-tree-inline-saving');
            restoreOriginal();
            if (typeof options.onError === 'function') {
              options.onError(err, commitContext);
            }
          });
        }
      } catch (err) {
        restoreOriginal();
        if (typeof options.onError === 'function') {
          options.onError(err, commitContext);
        }
      }
    }

    input.addEventListener('blur', function () {
      if (options.commitOnBlur === false) return;
      finish('commit');
    });
    input.addEventListener('input', function (event) {
      if (multiline && options.autoResize !== false) autoResizeMultilineInput(input);
      if (typeof options.onInput === 'function') {
        options.onInput(event, {
          node: node,
          input: input,
          labelEl: labelEl,
          initialValue: initialValue,
          initialDisplayValue: initialDisplayValue
        });
      }
    });
    input.addEventListener('keydown', function (event) {
      var commitKeys = Array.isArray(options.commitKeys) ? options.commitKeys : [];
      for (var i = 0; i < commitKeys.length; i++) {
        if (matchesEditShortcut(event, commitKeys[i])) {
          event.preventDefault();
          finish('commit');
          return;
        }
      }
      if (event.key === 'Enter' && !multiline) {
        event.preventDefault();
        finish('commit');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish('cancel');
      }
    });

    node.__lexeraHierarchyInlineEditCleanup = restoreOriginal;

    return {
      node: node,
      labelEl: labelEl,
      input: input,
      cancel: function () { finish('cancel'); },
      commit: function () { finish('commit'); }
    };
  }

  return {
    bindTreeInteractions: bindTreeInteractions,
    findTreeNode: findTreeNode,
    closestWithin: closestWithin,
    beginInlineLabelEdit: beginInlineLabelEdit
  };
}));
