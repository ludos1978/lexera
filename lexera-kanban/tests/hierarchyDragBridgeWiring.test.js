// Pins the production wiring of LexeraHierarchyDragBridge into the
// shell bootstrap. The pure helper + IPC consumer are tested in
// hierarchyDragBridge.test.js; this file just guards the integration:
//
//   1. index.html loads the bridge BEFORE multiviewClient.
//   2. multiviewClient declares an `installHierarchyDragBridge` wrapper
//      that calls the bridge's `install()` with `loadBoard` and
//      `saveBoard` callbacks routed through `window.LexeraApi`.
//   3. `bootMultiview` calls the wrapper, so the listener is active
//      whenever the shell boots.
//
// A future refactor that quietly removes the wiring would have to
// touch one of these strings — the test fails the build instead.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(__dirname, '..', 'src', 'index.html'), 'utf8');
const multiviewClientJs = readFileSync(
  resolve(__dirname, '..', 'src', 'shell', 'multiviewClient.js'), 'utf8'
);

function codeOnly(text) {
  return text.split('\n').map((line) => {
    const idx = line.indexOf('//');
    return idx === -1 ? line : line.substring(0, idx);
  }).join('\n');
}

describe('hierarchy drag bridge — production wiring', () => {
  it('index.html loads hierarchyDragBridge.js before multiviewClient.js', () => {
    const bridgeIdx = indexHtml.indexOf('shell/bridges/hierarchyDragBridge.js');
    const clientIdx = indexHtml.indexOf('shell/multiviewClient.js');
    expect(bridgeIdx).toBeGreaterThan(0);
    expect(clientIdx).toBeGreaterThan(bridgeIdx);
  });

  it('multiviewClient declares installHierarchyDragBridge', () => {
    expect(multiviewClientJs).toMatch(/function installHierarchyDragBridge\s*\(/);
  });

  it('the wrapper resolves the bridge from window.LexeraHierarchyDragBridge', () => {
    expect(multiviewClientJs).toMatch(/window\.LexeraHierarchyDragBridge/);
  });

  it('the wrapper passes loadBoard + saveBoard callbacks routed through LexeraApi', () => {
    const code = codeOnly(multiviewClientJs);
    // Both callback names appear inside the install() call.
    expect(code).toMatch(/loadBoard:\s*function/);
    expect(code).toMatch(/saveBoard:\s*function/);
    // loadBoard pulls full board data via getBoardColumns(...).fullBoard.
    expect(code).toMatch(/api\.getBoardColumns/);
    expect(code).toMatch(/response\.fullBoard/);
    // saveBoard delegates to LexeraApi.saveBoard.
    expect(code).toMatch(/api\.saveBoard\(boardId, board\)/);
  });

  it('bootMultiview calls installHierarchyDragBridge so the listener is active on boot', () => {
    const code = codeOnly(multiviewClientJs);
    const bootStart = code.indexOf('function bootMultiview');
    expect(bootStart).toBeGreaterThan(-1);
    // Take a generous window of source after bootMultiview to find the
    // call without false-positives from elsewhere in the file.
    const bootSlice = code.substring(bootStart, bootStart + 4000);
    expect(bootSlice).toMatch(/installHierarchyDragBridge\(\)/);
  });
});
