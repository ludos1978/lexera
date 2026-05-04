import { describe, expect, it, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(__dirname, '..', 'src', 'shell', 'inspectorShortcuts.js'),
  'utf8'
);

let api;

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const fn = new Function('window', 'document', source + '\nreturn window.LexeraInspectorShortcuts;');
  api = fn(dom.window, dom.window.document);
});

// Build a synthetic KeyboardEvent shape — vitest jsdom env honors all
// the `*Key` flags, but we lean on plain objects to keep the test
// matrix readable. The predicate only reads .key, .code, .ctrlKey,
// .metaKey, .altKey, .shiftKey.
function ev(parts) {
  return Object.assign({
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false
  }, parts);
}

describe('LexeraInspectorShortcuts.isInspectorShortcut', () => {
  it('matches plain F12 (the canonical macOS combo)', () => {
    expect(api.isInspectorShortcut(ev({ key: 'F12' }))).toBe(true);
  });

  it('matches Cmd+Shift+I and Ctrl+Shift+I (Chrome devtools default)', () => {
    expect(api.isInspectorShortcut(ev({ metaKey: true, shiftKey: true, code: 'KeyI' }))).toBe(true);
    expect(api.isInspectorShortcut(ev({ ctrlKey: true, shiftKey: true, code: 'KeyI' }))).toBe(true);
  });

  it('matches Alt+I as the WebKit-style fallback', () => {
    expect(api.isInspectorShortcut(ev({ altKey: true, code: 'KeyI' }))).toBe(true);
    expect(api.isInspectorShortcut(ev({ altKey: true, key: 'i' }))).toBe(true);
    expect(api.isInspectorShortcut(ev({ altKey: true, key: 'I' }))).toBe(true);
  });

  it('does not match the all-views combo (Cmd+Alt+Shift+I)', () => {
    // Critical precedence guard: the all-views detector handles this case.
    // If the single-window matcher also accepted it, the call-site order in
    // app.js (all-shortcut tested FIRST) would still be correct, but the
    // precedence test below would mask any future order regression.
    expect(api.isInspectorShortcut(ev({
      metaKey: true, altKey: true, shiftKey: true, code: 'KeyI'
    }))).toBe(false);
  });

  it('rejects unrelated keys', () => {
    expect(api.isInspectorShortcut(ev({ key: 'F11' }))).toBe(false);
    expect(api.isInspectorShortcut(ev({ key: 'a' }))).toBe(false);
    expect(api.isInspectorShortcut(ev({ ctrlKey: true, code: 'KeyI' }))).toBe(false); // missing Shift
    expect(api.isInspectorShortcut(ev({ metaKey: true, code: 'KeyI' }))).toBe(false); // missing Shift
  });

  it('handles null / missing event without throwing', () => {
    expect(api.isInspectorShortcut(null)).toBe(false);
    expect(api.isInspectorShortcut(undefined)).toBe(false);
  });
});

describe('LexeraInspectorShortcuts.isInspectorAllShortcut', () => {
  it('matches Cmd+Alt+Shift+I (macOS)', () => {
    expect(api.isInspectorAllShortcut(ev({
      metaKey: true, altKey: true, shiftKey: true, code: 'KeyI'
    }))).toBe(true);
  });

  it('matches Ctrl+Alt+Shift+I (Linux/Windows)', () => {
    expect(api.isInspectorAllShortcut(ev({
      ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyI'
    }))).toBe(true);
  });

  it('accepts both code=KeyI and key=I/i (browser variation)', () => {
    expect(api.isInspectorAllShortcut(ev({
      metaKey: true, altKey: true, shiftKey: true, key: 'i'
    }))).toBe(true);
    expect(api.isInspectorAllShortcut(ev({
      metaKey: true, altKey: true, shiftKey: true, key: 'I'
    }))).toBe(true);
  });

  it('rejects when any of {Cmd|Ctrl, Alt, Shift} is missing', () => {
    expect(api.isInspectorAllShortcut(ev({                  altKey: true, shiftKey: true, code: 'KeyI' }))).toBe(false);
    expect(api.isInspectorAllShortcut(ev({ metaKey: true,                 shiftKey: true, code: 'KeyI' }))).toBe(false);
    expect(api.isInspectorAllShortcut(ev({ metaKey: true, altKey: true,                  code: 'KeyI' }))).toBe(false);
  });

  it('rejects unrelated keys even with all three modifiers', () => {
    expect(api.isInspectorAllShortcut(ev({
      metaKey: true, altKey: true, shiftKey: true, code: 'KeyJ'
    }))).toBe(false);
  });

  it('handles null / missing event without throwing', () => {
    expect(api.isInspectorAllShortcut(null)).toBe(false);
    expect(api.isInspectorAllShortcut(undefined)).toBe(false);
  });
});
