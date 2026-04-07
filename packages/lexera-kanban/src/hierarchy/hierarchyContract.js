(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LexeraHierarchyContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeString(value) {
    var text = String(value == null ? '' : value).trim();
    return text || null;
  }

  function normalizeStructuralRole(value) {
    var text = normalizeString(value);
    return text ? text.toLowerCase() : null;
  }

  function normalizeCapabilities(value) {
    var raw = [];
    if (Array.isArray(value)) {
      raw = value.slice();
    } else if (value != null && value !== '') {
      raw = String(value).split(/[\s,]+/);
    }
    var seen = Object.create(null);
    var normalized = [];
    for (var i = 0; i < raw.length; i++) {
      var token = normalizeString(raw[i]);
      if (!token) continue;
      token = token.toLowerCase();
      if (seen[token]) continue;
      seen[token] = true;
      normalized.push(token);
    }
    return normalized;
  }

  function copyAttrs(attrs) {
    var result = {};
    var source = attrs && typeof attrs === 'object' ? attrs : null;
    if (!source) return result;
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
      result[keys[i]] = source[keys[i]];
    }
    return result;
  }

  function normalizeDescriptor(descriptor) {
    descriptor = descriptor || {};
    var capabilities = normalizeCapabilities(descriptor.capabilities);
    return {
      surface: normalizeString(descriptor.surface),
      kind: normalizeString(descriptor.kind),
      entityId: normalizeString(descriptor.entityId),
      capabilities: capabilities,
      selectable: descriptor.selectable === true
    };
  }

  function applyDescriptorToAttrs(attrs, descriptor) {
    var nextAttrs = copyAttrs(attrs);
    var normalized = normalizeDescriptor(descriptor);
    if (normalized.surface) nextAttrs['data-hierarchy-surface'] = normalized.surface;
    if (normalized.kind) nextAttrs['data-hierarchy-kind'] = normalized.kind;
    if (normalized.entityId) nextAttrs['data-hierarchy-entity-id'] = normalized.entityId;
    if (normalized.capabilities.length > 0) {
      nextAttrs['data-hierarchy-capabilities'] = normalized.capabilities.join(' ');
    }
    if (normalized.selectable) {
      nextAttrs['data-hierarchy-selectable'] = 'true';
    }
    return nextAttrs;
  }

  function composeNodeType(baseType, modifiers) {
    var tokens = [];
    var normalizedBase = normalizeString(baseType);
    if (normalizedBase) tokens.push(normalizedBase);
    modifiers = modifiers || {};
    var keys = Object.keys(modifiers);
    for (var i = 0; i < keys.length; i++) {
      if (!modifiers[keys[i]]) continue;
      var token = normalizeString(keys[i]);
      if (!token) continue;
      tokens.push(token);
    }
    return tokens.join(' ');
  }

  function createNode(definition) {
    definition = definition || {};
    var node = {
      id: definition.id == null ? null : definition.id,
      label: definition.label == null ? '' : String(definition.label),
      count: definition.count == null ? null : definition.count,
      type: definition.type == null ? null : String(definition.type),
      structuralRole: normalizeStructuralRole(definition.structuralRole),
      children: Array.isArray(definition.children) ? definition.children : definition.children === null ? null : definition.children,
      expanded: definition.expanded === true,
      hasToggle: definition.hasToggle != null ? definition.hasToggle : undefined,
      grip: definition.grip !== false,
      menu: definition.menu === true,
      attrs: copyAttrs(definition.attrs)
    };
    if (definition.gripTitle != null) node.gripTitle = String(definition.gripTitle);
    if (definition.hierarchy) {
      node.hierarchy = normalizeDescriptor(definition.hierarchy);
    }
    return node;
  }

  function readDescriptorFromNode(node) {
    if (!node || typeof node.getAttribute !== 'function') return null;
    var descriptor = normalizeDescriptor({
      surface: node.getAttribute('data-hierarchy-surface'),
      kind: node.getAttribute('data-hierarchy-kind'),
      entityId: node.getAttribute('data-hierarchy-entity-id'),
      capabilities: node.getAttribute('data-hierarchy-capabilities'),
      selectable: node.getAttribute('data-hierarchy-selectable') === 'true'
    });
    if (!descriptor.surface && !descriptor.kind && !descriptor.entityId && descriptor.capabilities.length === 0 && !descriptor.selectable) {
      return null;
    }
    return descriptor;
  }

  function readStructuralRoleFromNode(node) {
    if (!node || typeof node.getAttribute !== 'function') return null;
    return normalizeStructuralRole(node.getAttribute('data-tree-structural-role'));
  }

  function nodeSupportsCapability(nodeOrDescriptor, capability) {
    var descriptor = nodeOrDescriptor;
    if (descriptor && typeof descriptor.getAttribute === 'function') {
      descriptor = readDescriptorFromNode(descriptor);
    }
    if (!descriptor) return true;
    var normalizedCapability = normalizeString(capability);
    if (!normalizedCapability) return true;
    var capabilities = normalizeCapabilities(descriptor.capabilities);
    if (capabilities.length === 0) return false;
    return capabilities.indexOf(normalizedCapability.toLowerCase()) !== -1;
  }

  return {
    normalizeCapabilities: normalizeCapabilities,
    normalizeDescriptor: normalizeDescriptor,
    normalizeStructuralRole: normalizeStructuralRole,
    applyDescriptorToAttrs: applyDescriptorToAttrs,
    composeNodeType: composeNodeType,
    createNode: createNode,
    createHierarchyNode: createNode,
    readDescriptorFromNode: readDescriptorFromNode,
    readStructuralRoleFromNode: readStructuralRoleFromNode,
    nodeSupportsCapability: nodeSupportsCapability
  };
}));
