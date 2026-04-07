import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(resolve(__dirname, '..', 'src', 'app.js'), 'utf8');
const hiddenItemsSource = readFileSync(resolve(__dirname, '..', 'src', 'hiddenItems', 'hiddenItemsDropdown.js'), 'utf8');

describe('header source insertion wiring', () => {
  it('passes the shared text-content insertion seam into HiddenItemsDropdown', () => {
    expect(appJs).toContain('insertTextContentForEntity: insertTextContentForEntity');
  });

  it('delegates header source text insertion through the shared seam when available', () => {
    expect(hiddenItemsSource).toContain('if (_deps.insertTextContentForEntity) {');
    expect(hiddenItemsSource).toContain('return _deps.insertTextContentForEntity(entityType, text, context);');
  });
});
