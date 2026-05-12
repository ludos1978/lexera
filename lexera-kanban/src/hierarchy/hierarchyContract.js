// Leading line comment to dodge slice-13 checkJs duplicate-id quirk.

/**
 * @typedef {Object} LexeraHierarchyDescriptor
 * @property {string | null} surface
 * @property {string | null} kind
 * @property {string | null} entityId
 * @property {Array<string>} capabilities
 * @property {boolean} selectable
 */

/**
 * @typedef {Object} LexeraHierarchyDescriptorInput
 * @property {unknown} [surface]
 * @property {unknown} [kind]
 * @property {unknown} [entityId]
 * @property {unknown} [capabilities]
 * @property {unknown} [selectable]
 */

/**
 * @typedef {{ [k: string]: unknown }} LexeraHierarchyAttrs
 */

/**
 * @typedef {Object} LexeraHierarchyNodeDefinition
 * @property {unknown} [id]
 * @property {unknown} [label]
 * @property {unknown} [count]
 * @property {unknown} [type]
 * @property {unknown} [structuralRole]
 * @property {Array<unknown> | null | undefined} [children]
 * @property {unknown} [expanded]
 * @property {unknown} [hasToggle]
 * @property {unknown} [grip]
 * @property {unknown} [menu]
 * @property {LexeraHierarchyAttrs | null | undefined} [attrs]
 * @property {unknown} [gripTitle]
 * @property {LexeraHierarchyDescriptorInput | null | undefined} [hierarchy]
 */

/**
 * @typedef {Object} LexeraHierarchyNode
 * @property {unknown} id
 * @property {string} label
 * @property {unknown} count
 * @property {string | null} type
 * @property {string | null} structuralRole
 * @property {Array<unknown> | null | undefined} children
 * @property {boolean} expanded
 * @property {unknown} hasToggle
 * @property {boolean} grip
 * @property {boolean} menu
 * @property {LexeraHierarchyAttrs} attrs
 * @property {string} [gripTitle]
 * @property {LexeraHierarchyDescriptor} [hierarchy]
 */

/**
 * @typedef {Object} LexeraHierarchyContractApi
 * @property {(value: unknown) => Array<string>} normalizeCapabilities
 * @property {(descriptor: LexeraHierarchyDescriptorInput | null | undefined) => LexeraHierarchyDescriptor} normalizeDescriptor
 * @property {(value: unknown) => (string | null)} normalizeStructuralRole
 * @property {(attrs: LexeraHierarchyAttrs | null | undefined, descriptor: LexeraHierarchyDescriptorInput | null | undefined) => LexeraHierarchyAttrs} applyDescriptorToAttrs
 * @property {(baseType: unknown, modifiers: { [k: string]: unknown } | null | undefined) => string} composeNodeType
 * @property {(definition: LexeraHierarchyNodeDefinition | null | undefined) => LexeraHierarchyNode} createNode
 * @property {(definition: LexeraHierarchyNodeDefinition | null | undefined) => LexeraHierarchyNode} createHierarchyNode
 * @property {(node: Element | null | undefined) => (LexeraHierarchyDescriptor | null)} readDescriptorFromNode
 * @property {(node: Element | null | undefined) => (string | null)} readStructuralRoleFromNode
 * @property {(nodeOrDescriptor: Element | LexeraHierarchyDescriptor | null | undefined, capability: unknown) => boolean} nodeSupportsCapability
 */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  /** @type {any} */ (root).LexeraHierarchyContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** @param {unknown} value */
  function normalizeString(value) {
    var text = String(value == null ? '' : value).trim();
    return text || null;
  }

  function normalizeStructuralRole(value) {
    var text = normalizeString(value);
    return text ? text.toLowerCase() : null;
  }

  /** @param {unknown} value */
  function normalizeCapabilities(value) {
    /** @type {Array<unknown>} */
    var raw = [];
    if (Array.isArray(value)) {
      raw = value.slice();
    } else if (value != null && value !== '') {
      raw = String(value).split(/[\s,]+/);
    }
    /** @type {Record<string, boolean>} */
    var seen = Object.create(null);
    /** @type {Array<string>} */
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

  /** @param {LexeraHierarchyAttrs | null | undefined} attrs */
  function copyAttrs(attrs) {
    /** @type {LexeraHierarchyAttrs} */
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

  /**
   * @param {unknown} baseType
   * @param {{ [k: string]: unknown } | null | undefined} modifiers
   */
  function composeNodeType(baseType, modifiers) {
    /** @type {Array<string>} */
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

  /** @type {LexeraHierarchyContractApi} */
  var publicApi = {
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
  return publicApi;
}));
