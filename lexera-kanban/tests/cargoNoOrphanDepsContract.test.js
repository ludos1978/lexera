// Guards `lexera-core/Cargo.toml` and `lexera-backend/src-tauri/Cargo.toml`
// against orphan dependencies. Every entry under `[dependencies]` and
// `[dev-dependencies]` must have at least one usage site in the crate's
// source tree (rust source under `src/`), surfaced via a `use ...`,
// `extern crate ...`, or `<dep>::` qualified-path reference.
//
// Catches the failure mode that motivated the audit: a dep added during
// some experiment, never removed, that bloats build time and surface area
// without contributing anything.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

// Crate-name → snake_case import-name overrides for deps whose Rust crate
// identifier differs from the Cargo entry. Most crates infer correctly via
// `dep.replace(/-/g, '_')`, but tauri-plugin-* and tauri-build are not
// imported by their full names.
const IMPORT_NAME_OVERRIDES = {
  'tauri-plugin-global-shortcut': null, // registered via tauri::Builder, not a `use`
  'tauri-plugin-clipboard-manager': null,
  'tauri-build': null, // build-dependency only
};

const CRATES = [
  {
    label: 'lexera-core',
    cargoToml: 'lexera-core/Cargo.toml',
    src: 'lexera-core/src',
  },
  {
    label: 'lexera-backend',
    cargoToml: 'lexera-backend/src-tauri/Cargo.toml',
    src: 'lexera-backend/src-tauri/src',
  },
];

function* walkRust(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let s;
    try { s = statSync(full); } catch (_) { continue; }
    if (s.isDirectory()) yield* walkRust(full);
    else if (s.isFile() && full.endsWith('.rs')) yield full;
  }
}

function readSourceConcat(srcDir) {
  let buf = '';
  for (const file of walkRust(srcDir)) {
    buf += readFileSync(file, 'utf-8') + '\n';
  }
  return buf;
}

// Pull declared dependency names out of a Cargo.toml. Skips path/git deps that
// are workspace-internal (those don't bloat the compiled-from-crates surface).
function declaredDeps(cargoToml) {
  const text = readFileSync(cargoToml, 'utf-8');
  const out = new Set();
  let section = '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      section = trimmed.replace(/[\[\]]/g, '');
      continue;
    }
    if (!['dependencies', 'dev-dependencies', 'build-dependencies'].includes(section)) continue;
    const m = trimmed.match(/^([a-zA-Z0-9][a-zA-Z0-9_-]*)\s*=/);
    if (!m) continue;
    const name = m[1];
    // Skip workspace-internal path crates — they're inherently used by being linked.
    if (/path\s*=/.test(line)) continue;
    out.add(name);
  }
  return [...out].sort();
}

function isUsed(snake, source) {
  // Match `use snake`, `use snake::`, `extern crate snake;`, or
  // qualified-path `snake::` anywhere in the source. The trailing `::` form
  // catches one-shot calls like `hex::encode(...)` that don't carry a `use`.
  const re = new RegExp(
    `(?:use\\s+${snake}\\b|extern\\s+crate\\s+${snake}\\b|\\b${snake}::)`,
  );
  return re.test(source);
}

describe('Cargo dependency audit — no orphan deps', () => {
  for (const crate of CRATES) {
    const cargoPath = resolve(repoRoot, crate.cargoToml);
    const srcPath = resolve(repoRoot, crate.src);
    if (!existsSync(cargoPath) || !existsSync(srcPath)) {
      it.skip(`${crate.label}: Cargo.toml or src/ missing`, () => {});
      continue;
    }
    const source = readSourceConcat(srcPath);
    const deps = declaredDeps(cargoPath);

    describe(crate.label, () => {
      it('declares at least one dependency', () => {
        expect(deps.length).toBeGreaterThan(0);
      });

      for (const dep of deps) {
        const overrideEntry = Object.prototype.hasOwnProperty.call(IMPORT_NAME_OVERRIDES, dep);
        if (overrideEntry && IMPORT_NAME_OVERRIDES[dep] === null) {
          // Documented opt-out (registered indirectly, e.g. tauri plugins).
          continue;
        }
        const importName = overrideEntry
          ? IMPORT_NAME_OVERRIDES[dep]
          : dep.replace(/-/g, '_');
        it(`${dep} (as \`${importName}\`) has at least one usage site`, () => {
          if (!isUsed(importName, source)) {
            throw new Error(
              `${dep} is declared in ${crate.cargoToml} but no \`use ${importName}\`, ` +
              `\`extern crate ${importName}\`, or \`${importName}::\` reference was found ` +
              `under ${crate.src}. Either find/add a usage, remove the dep, or add an ` +
              `IMPORT_NAME_OVERRIDES entry with a reason.`,
            );
          }
        });
      }
    });
  }
});
