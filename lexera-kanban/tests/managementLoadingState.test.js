// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

describe('management panel loading state', () => {
  it('managementWiring initManagementUI does not eagerly remove view-loading', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../src/management/managementWiring.js'), 'utf-8'
    );
    // initManagementUI should NOT contain setViewLoading
    const mgmtInitFn = source.match(/function initManagementUI[\s\S]*?^  \}/m);
    expect(mgmtInitFn).toBeTruthy();
    expect(mgmtInitFn[0]).not.toContain('setViewLoading');
  });
});
