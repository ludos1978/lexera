import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readViewHtml(kind) {
  return readFileSync(
    resolve(__dirname, '..', '..', 'src', 'views', kind, 'index.html'),
    'utf8'
  );
}

function expectManagementTreeResources(html) {
  expect(html).toContain('<link rel="stylesheet" href="../../hierarchical.css">');
  expect(html).toContain('<script src="../../treeView.js"></script>');
  expect(html).toContain('<script src="../../hierarchy/hierarchyContract.js"></script>');
  expect(html).toContain('<script src="../../hierarchy/hierarchyController.js"></script>');

  expect(html.indexOf('<script src="../../treeView.js"></script>'))
    .toBeLessThan(html.indexOf('<script src="../../management.js"></script>'));
  expect(html.indexOf('<script src="../../hierarchy/hierarchyContract.js"></script>'))
    .toBeLessThan(html.indexOf('<script src="../../management.js"></script>'));
  expect(html.indexOf('<script src="../../hierarchy/hierarchyController.js"></script>'))
    .toBeLessThan(html.indexOf('<script src="../../management.js"></script>'));
}

function expectViewportFillContract(html) {
  expect(html).not.toContain('height: 100vh;');
  expect(html).toContain('height: 100%;');
  expect(html).toContain('min-height: 0;');
}

describe('management settings sub-app HTML entries', () => {
  it('backendSettings loads the shared hierarchy tree stack before management.js', () => {
    const html = readViewHtml('backendSettings');
    expectManagementTreeResources(html);
    expectViewportFillContract(html);
  });

  it('files loads the shared hierarchy tree stack before management.js', () => {
    const html = readViewHtml('files');
    expectManagementTreeResources(html);
    expectViewportFillContract(html);
  });

  it('frontendSettings uses the shared viewport-fill contract instead of a 100vh root', () => {
    expectViewportFillContract(readViewHtml('frontendSettings'));
  });
});
