// Pins the Rust error-type baseline so future drift fails closed.
//
// Audit findings (2026-05-11, TODOs-lexera.md L275 Slice 1):
//   - lexera-core, lexera-local-ipc, lexera-backend ALL depend on
//     `thiserror = "2"` and define domain error enums via
//     `#[derive(thiserror::Error)]`.
//   - Zero usage of `anyhow`, `eyre`, `snafu`, or `miette` anywhere
//     in the workspace — no general-purpose error-erasure crate has
//     crept in.
//   - The two Tauri-glue crates (lexera-kanban, lexera-capture-ios)
//     intentionally use `Result<_, String>` at command boundaries
//     (Tauri requires Serialize errors) and have no domain logic of
//     their own, so they're excluded from these assertions.
//
// What this guards against:
//   - Someone adds `anyhow` for "convenience" and starts erasing
//     typed errors back into untyped strings.
//   - A crate silently loses its `thiserror` dep during a refactor.
//   - An existing error enum gets deleted/renamed without an
//     intentional update here.
//
// What this does NOT guard:
//   - The exact set of variants inside each enum (those evolve
//     freely as the domain grows).
//   - `Result<_, String>` inside the backend's internal helpers
//     (10 files have it as of audit time). Paying that down is a
//     later slice; this test deliberately tolerates it for now.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const DOMAIN_CRATES = [
  {
    label: 'lexera-core',
    cargoToml: 'lexera-core/Cargo.toml',
    src: 'lexera-core/src',
    expectedErrorEnums: ['PluginRegistryError', 'StorageError', 'XbelError'],
  },
  {
    label: 'lexera-local-ipc',
    cargoToml: 'lexera-local-ipc/Cargo.toml',
    src: 'lexera-local-ipc/src',
    expectedErrorEnums: ['IpcError'],
  },
  {
    label: 'lexera-backend',
    cargoToml: 'lexera-backend/src-tauri/Cargo.toml',
    src: 'lexera-backend/src-tauri/src',
    expectedErrorEnums: ['DispatchError', 'InviteError', 'AuthError', 'PublicRoomError'],
  },
];

const FORBIDDEN_ERROR_CRATES = ['anyhow', 'eyre', 'snafu', 'miette'];

function readCargo(rel) {
  return readFileSync(resolve(repoRoot, rel), 'utf-8');
}

function declaresDep(cargoText, depName) {
  const re = new RegExp('^' + depName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*=', 'm');
  return re.test(cargoText);
}

function grepRepo(pattern, srcDir) {
  try {
    const out = execSync(
      `grep -rln --include='*.rs' ${JSON.stringify(pattern)} ${JSON.stringify(resolve(repoRoot, srcDir))}`,
      { stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString();
    return out.split('\n').filter(Boolean);
  } catch (_) {
    return [];
  }
}

describe('Rust error-type baseline (TODOs L275 Slice 1)', () => {
  for (const crate of DOMAIN_CRATES) {
    describe(crate.label, () => {
      const cargoText = readCargo(crate.cargoToml);

      it('depends on thiserror = "2"', () => {
        // Match `thiserror = "2"` or `thiserror = "2.x"` or table form.
        expect(cargoText).toMatch(/^thiserror\s*=\s*"?2/m);
      });

      for (const forbidden of FORBIDDEN_ERROR_CRATES) {
        it(`does NOT depend on ${forbidden}`, () => {
          expect(declaresDep(cargoText, forbidden)).toBe(false);
        });
      }

      for (const enumName of crate.expectedErrorEnums) {
        it(`defines error enum ${enumName} with #[derive(thiserror::Error)]`, () => {
          // Find the file declaring this enum, then assert the derive sits
          // on the same enum (within a short window above the enum line).
          // Accepts either the fully-qualified `thiserror::Error` form or
          // the bare `Error` form when the file has `use thiserror::Error;`.
          const hits = grepRepo(`pub enum ${enumName}`, crate.src);
          expect(hits.length).toBeGreaterThan(0);
          const file = hits[0];
          const body = readFileSync(file, 'utf-8');
          const lines = body.split('\n');
          const idx = lines.findIndex((l) => l.includes(`pub enum ${enumName}`));
          expect(idx).toBeGreaterThan(-1);
          const window = lines.slice(Math.max(0, idx - 6), idx).join('\n');
          const hasFullyQualified = /derive\([^)]*\bthiserror::Error\b/.test(window);
          const hasBareDerive = /derive\([^)]*\bError\b/.test(window);
          const fileImportsThiserrorError = /use\s+thiserror::Error\s*;/.test(body);
          const ok = hasFullyQualified || (hasBareDerive && fileImportsThiserrorError);
          expect(ok, `expected ${enumName} in ${file} to derive thiserror::Error (full path) OR derive Error with a 'use thiserror::Error;' import`).toBe(true);
        });
      }
    });
  }
});
