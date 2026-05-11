// Pin: clicking the card-editor overlay backdrop SAVES the edit.
//
// Per the project rule "WE ALWAYS SAVE — to undo a change there is undo!"
// (feedback_editing_always_saves), no implicit close path on the card
// editor may discard work. The overlay backdrop click handler at the
// top of cardEditor.js previously passed `{ save: false }` (cancel) —
// that has been flipped to `{ save: true }`. This contract keeps
// anyone from re-introducing the silent-discard.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cardEditorPath = resolve(__dirname, '..', 'src/editor/cardEditor.js');

describe('cardEditor overlay backdrop click — always-saves contract', () => {
  const src = readFileSync(cardEditorPath, 'utf8');

  it('the overlay click handler invokes closeCardEditorOverlay({ save: true })', () => {
    // Match: overlay.addEventListener('click', function (e) { if (e.target === overlay) closeCardEditorOverlay({ save: <bool> }); });
    const re = /overlay\.addEventListener\(\s*['"]click['"][\s\S]{0,400}?closeCardEditorOverlay\(\s*\{\s*save:\s*(true|false)\s*\}/;
    const m = src.match(re);
    expect(m, 'overlay click → closeCardEditorOverlay({ save: ... }) call not found').toBeTruthy();
    expect(m[1]).toBe('true');
  });
});
