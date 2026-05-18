// FileDeleted recovery contract — data-loss prevention fence.
//
// User rule (in memory + TODOs-lexera.md): "make sure all changes are
// handled properly so the user can intervene if something is
// accidentially or intentially deleted while he is working on it. We
// must prevent data loss!"
//
// When the board's markdown file is deleted out from under an open
// kanban, the in-memory board is the ONLY surviving copy. The recovery
// path in `handleSSEEvent`'s `FileDeleted` branch (app.js) is what keeps
// that copy from being lost: it marks the board dirty and schedules an
// autosave so the self-healing storage layer recreates the file from
// memory. Backend coverage exists
// (lexera-core test_write_board_recreates_file_deleted_out_from_under_us);
// the frontend trigger had NO test, so a refactor could silently drop
// `markBoardDirty()` / `scheduleAutoSave(...)` and reintroduce
// unrecoverable data loss with green tests.
//
// Static source-contract approach (same family as
// consoleLoggingGuardrailContract / *DepsWiringContract): pin the
// invariants of the recovery block so they cannot regress unnoticed.
// This deliberately does NOT exercise the 170-line closure through the
// app.js extraction harness — the value here is regression-fencing the
// recovery wiring, which a focused source assertion does robustly.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJsPath = resolve(__dirname, '..', 'src', 'app.js');

let recoveryBlock = '';

beforeAll(() => {
  const source = readFileSync(appJsPath, 'utf-8');
  const startMarker = "if (kind === 'FileDeleted') {";
  const startIdx = source.indexOf(startMarker);
  expect(
    startIdx,
    "handleSSEEvent must keep a `if (kind === 'FileDeleted')` branch"
  ).toBeGreaterThan(-1);
  // The recovery block runs from the FileDeleted guard up to the next
  // `if (kind === '...')` branch (IncludeFileChanged), which is where the
  // handler moves on to other event kinds.
  const rest = source.slice(startIdx);
  const nextBranchIdx = rest.indexOf("if (kind === 'IncludeFileChanged'");
  expect(
    nextBranchIdx,
    'FileDeleted block must be bounded by the following SSE branch'
  ).toBeGreaterThan(-1);
  recoveryBlock = rest.slice(0, nextBranchIdx);
});

describe('FileDeleted recovery contract', () => {
  it('treats the in-memory board as unsaved work (markBoardDirty)', () => {
    // Without this, the deleted file is never recreated from memory and
    // the user's open edits are lost on the next failed save.
    expect(recoveryBlock).toMatch(/markBoardDirty\s*\(\s*\)/);
  });

  it('schedules the recovery autosave with the dedicated reason tag', () => {
    // The reason tag keeps the recovery save distinguishable in logs and
    // pins that recovery routes through the established autosave/self-heal
    // pipeline rather than an ad-hoc write.
    expect(recoveryBlock).toMatch(
      /scheduleAutoSave\(\s*['"]file-deleted-recover['"]/
    );
  });

  it('never lets a deletion be silent (notifies the user)', () => {
    // The user must always be told their file vanished — silent recovery
    // would hide accidental/intentional deletion from the person working.
    expect(recoveryBlock).toMatch(/showNotification\s*\(/);
    expect(recoveryBlock).toMatch(/logFrontendIssue\(\s*['"]warn['"]/);
  });

  it('guards recovery when the file is authoritative elsewhere', () => {
    // Live-sync / remote boards have an authoritative copy that is NOT
    // the local file, and a save already in flight will itself recreate
    // the file — recovering in those cases would clobber or double-write.
    // All three guards must precede the markBoardDirty/scheduleAutoSave
    // recovery action.
    const dirtyIdx = recoveryBlock.search(/markBoardDirty\s*\(/);
    expect(dirtyIdx).toBeGreaterThan(-1);
    const guardsRegion = recoveryBlock.slice(0, dirtyIdx);
    expect(guardsRegion).toMatch(/canUseLiveSync\s*\(/);
    expect(guardsRegion).toMatch(/isActiveRemoteBoard\s*\(/);
    expect(guardsRegion).toMatch(/getSaveInFlight\s*\(/);
  });
});
