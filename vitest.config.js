// Root-level vitest config. The actual test suite lives in lexera-kanban/
// (which has its own vitest.config.js pinning `tests/**/*.test.js`). This
// root config exists only to keep `npx vitest run` at repo root from
// descending into obsolete or build-output trees that still contain
// *.test.{js,ts} files and would otherwise produce hundreds of unrelated
// ERR_MODULE_NOT_FOUND failures (vscode imports, etc).
//
// No `import { defineConfig } from 'vitest/config'` on purpose — vitest
// isn't installed at the root, only inside lexera-kanban. Plain-object
// config still works.
export default {
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '_ARCHIVE/**',
      'out/**'
    ]
  }
};
