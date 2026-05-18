import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dts = readFileSync(
  resolve(__dirname, '..', 'src', 'types', 'lexera-globals.d.ts'),
  'utf8'
);

function interfaceBody(src, name) {
  const m = src.match(new RegExp('interface ' + name + '\\s*\\{([\\s\\S]*?)\\n\\}', 'm'));
  return m ? m[1] : '';
}

// workspaceShell narrow-by-kind paydown: the treeRegistry find* results
// expose real tab/leaf unions, not the loose DockTreeNode (leaf|split).
describe('LexeraTreeRegistry find-result typedef contract', () => {
  it('findLeafInAllTrees yields a tabs-leaf, never a split', () => {
    const body = interfaceBody(dts, 'LexeraTreeRegistryFoundLeaf');
    expect(body).toMatch(/leaf:\s*LexeraDockTreeLeaf;/);
    expect(body).not.toMatch(/leaf:\s*LexeraDockTreeNode;/);
  });

  it('findTabInAllTrees yields the discriminated board|panel tab union', () => {
    const body = interfaceBody(dts, 'LexeraTreeRegistryFoundTab');
    expect(body).toMatch(/tab:\s*LexeraDockTreeTab;/);
    expect(body).toMatch(/leaf:\s*LexeraDockTreeLeaf;/);
    expect(body).not.toMatch(/:\s*LexeraDockTreeNode;/);
  });

  it('findPanelInAllTrees yields a panel-kind tab specifically', () => {
    const body = interfaceBody(dts, 'LexeraTreeRegistryFoundPanel');
    expect(body).toMatch(/tab:\s*LexeraDockTreePanelTab;/);
    expect(body).toMatch(/leaf:\s*LexeraDockTreeLeaf;/);
    expect(body).not.toMatch(/:\s*LexeraDockTreeNode;/);
  });
});
