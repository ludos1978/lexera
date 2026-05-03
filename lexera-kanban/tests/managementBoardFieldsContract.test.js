// Pins the BOARD_SETTINGS_FIELDS schema in lexera-shared/management.js so
// future decompositions (extracting into a dedicated module, switching to
// JSON, etc.) cannot silently drop or rename a field.
//
// Reads management.js as text from `lexera-shared/` (the source of truth —
// the per-app copies in `lexera-kanban/src/` are gitignored synced builds).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const managementPath = resolve(__dirname, '..', '..', 'lexera-shared', 'management.js');

function loadFields() {
  const source = readFileSync(managementPath, 'utf-8');
  // Execute the prelude before the IIFE so the `var BOARD_SETTINGS_FIELDS`
  // hoisted to module scope becomes a property of our sandbox object.
  // Cut the source at the first `var ManagementUI = (function () {` — we only
  // need the field definitions, not the 2800-line IIFE body.
  const cutAt = source.indexOf('var ManagementUI = (function ()');
  if (cutAt === -1) {
    throw new Error('Could not find ManagementUI IIFE start in management.js');
  }
  const prelude = source.slice(0, cutAt);
  const sandbox = {};
  const factory = new Function(`${prelude}\n; return BOARD_SETTINGS_FIELDS;`);
  return factory.call(sandbox);
}

describe('BOARD_SETTINGS_FIELDS contract', () => {
  const fields = loadFields();

  it('is hoisted to module scope, not buried inside the IIFE', () => {
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.length).toBeGreaterThan(0);
  });

  it('every entry has a key, label, placeholder, and type', () => {
    for (const f of fields) {
      expect(typeof f.key).toBe('string');
      expect(f.key.length).toBeGreaterThan(0);
      expect(typeof f.label).toBe('string');
      expect(typeof f.placeholder).toBe('string');
      expect(['text', 'number', 'select']).toContain(f.type);
    }
  });

  it('select fields carry an options array starting with the empty string', () => {
    const selects = fields.filter((f) => f.type === 'select');
    expect(selects.length).toBeGreaterThan(0);
    for (const f of selects) {
      expect(Array.isArray(f.options)).toBe(true);
      expect(f.options.length).toBeGreaterThan(0);
      expect(f.options[0]).toBe('');
    }
  });

  it('field keys are unique', () => {
    const keys = fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('exposes the load-bearing keys the management UI rendering depends on', () => {
    // These specific keys are referenced by the rendering loop in
    // ManagementUI.renderBoardSettings; missing one would break the form.
    const required = [
      'columnWidth', 'layoutRows', 'layoutPreset', 'fontSize', 'fontFamily',
      'rowHeight', 'maxRowHeight', 'cardMinHeight', 'tagVisibility', 'whitespace',
      'stickyStackMode', 'htmlCommentRenderMode', 'htmlContentRenderMode',
      'arrowKeyFocusScroll', 'layoutSpacing',
      'boardColor', 'boardColorLight', 'boardColorDark'
    ];
    const present = new Set(fields.map((f) => f.key));
    for (const key of required) {
      expect(present.has(key)).toBe(true);
    }
  });
});
