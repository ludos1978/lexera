import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures', 'boards');
const expectedBoards = [
  'dashboard-deadlines.md',
  'embed-matrix.md',
  'hierarchy-depth.md',
  'multi-row-scroll.md',
  'tag-style-and-layout.md',
  'wide-overflow.md',
];

function readFixture(name) {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

describe('board fixtures', () => {
  it('provides dedicated QA boards for core layout and feature states', () => {
    const files = readdirSync(fixturesDir).filter((file) => file.endsWith('.md') && file !== 'README.md').sort();
    expect(files).toEqual(expectedBoards.slice().sort());
  });

  it('stores every fixture as a valid board markdown skeleton', () => {
    for (const name of expectedBoards) {
      const source = readFixture(name);
      expect(source).toContain('kanban-plugin: board');
      expect(/^#\s/m.test(source)).toBe(true);
      expect(/^##\s/m.test(source)).toBe(true);
      expect(/^###\s/m.test(source)).toBe(true);
    }
  });

  it('keeps referenced embed and include assets beside the fixtures', () => {
    const source = readFixture('embed-matrix.md');
    const matches = Array.from(source.matchAll(/!\[[^\]]*\]\(([^)]+)\)|!!!include\(([^)]+)\)!!!/g));
    const refs = matches.map((match) => match[1] || match[2]).filter(Boolean);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(existsSync(resolve(fixturesDir, ref))).toBe(true);
    }
  });
});
