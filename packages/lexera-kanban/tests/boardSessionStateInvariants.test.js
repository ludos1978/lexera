import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Reactive-state invariant tests for board-session metadata in `app.js`.
 *
 * Background: `fullBoardData` and `activeBoardData` are both held as module-
 * level variables in `packages/lexera-kanban/src/app.js`, and both are mirrored
 * into `LexeraRuntime` state via dedicated setters:
 *
 *   setFullBoardDataState(...)    -> writes fullBoardData + syncRuntimeState
 *   setActiveBoardDataState(...)  -> writes activeBoardData + syncRuntimeState
 *
 * Every caller that changes these values MUST go through the setters so that
 * `boardList.js` / `orderHelpers.js` (which read through `LexeraRuntime.getState`)
 * observe the change. Direct raw assignments silently break cross-module
 * reactivity — the workspace sidebar goes stale, mirrored panels miss updates,
 * and any future subscriber is simply not notified.
 *
 * The invariants below enforce this at the source-text level:
 *   1. There is exactly ONE raw `fullBoardData = …` assignment in `app.js`
 *      (inside the body of `setFullBoardDataState`).
 *   2. There is exactly ONE raw `activeBoardData = …` assignment in `app.js`
 *      (inside the body of `setActiveBoardDataState`).
 *   3. Every setter-body assignment is followed by a `syncRuntimeState` call
 *      for the same key, so runtime listeners always fire.
 *
 * Any future refactor that re-introduces a raw assignment will fail these
 * tests with a precise line number.
 */

const appSource = fs.readFileSync(
  path.resolve('src/app.js'),
  'utf8'
);
const boardListSource = fs.readFileSync(
  path.resolve('src/board/boardList.js'),
  'utf8'
);

const lines = appSource.split('\n');
const boardListLines = boardListSource.split('\n');

function findRawAssignments(symbol) {
  // Match anywhere on a line (not just at line-start):
  //   <symbol>  = <something that isn't another = sign>
  // Word-boundary before the symbol so we don't match `xfullBoardData`.
  // Negative-lookahead after the symbol so we don't match field access like
  // `activeBoardData.version = …` or index access `activeBoardData[key] = …`.
  // The negative-lookahead on `[^=]` after `=` rules out equality checks
  // (`==`, `===`).
  //
  // Object-field mutations like `activeBoardData.version = …` are a separate
  // concern (see todo.md note on in-place mutations); this invariant is
  // specifically about rebinding the module-level variable.
  //
  // Lines that are declarations (`let foo = …` / `var foo = …` / `const foo = …`)
  // are excluded so the module-level initializer doesn't trip the test.
  const pattern = new RegExp('\\b' + symbol + '(?![.\\[])\\s*=\\s*[^=]');
  const declPattern = new RegExp('\\b(?:let|var|const)\\s+' + symbol + '\\b');
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (declPattern.test(lines[i])) continue;
    if (pattern.test(lines[i])) {
      hits.push({ lineNumber: i + 1, text: lines[i] });
    }
  }
  return hits;
}

function findSetterBodyLine(functionName) {
  // Locate the opening brace line of a top-level `function <name>(` declaration.
  const signature = 'function ' + functionName + '(';
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(signature)) return i + 1; // 1-indexed
  }
  throw new Error('Could not find function ' + functionName);
}

function findSetterBodyRange(functionName) {
  // Returns the [startLine, endLine] (1-indexed, inclusive) of the function body.
  const startLine = findSetterBodyLine(functionName);
  let depth = 0;
  let started = false;
  let endLine = startLine;
  for (let i = startLine - 1; i < lines.length; i += 1) {
    const line = lines[i];
    for (let c = 0; c < line.length; c += 1) {
      if (line[c] === '{') { depth += 1; started = true; }
      if (line[c] === '}') depth -= 1;
    }
    if (started && depth === 0) {
      endLine = i + 1;
      break;
    }
  }
  return { startLine, endLine };
}

function isLineInsideRange(lineNumber, range) {
  return lineNumber >= range.startLine && lineNumber <= range.endLine;
}

function findPropertyMutations(sourceLines, baseIdentifiers) {
  const names = Array.isArray(baseIdentifiers) ? baseIdentifiers : [baseIdentifiers];
  const namePattern = '(?:' + names.join('|') + ')';
  const assignPattern = new RegExp('\\b' + namePattern + '\\.[A-Za-z_][A-Za-z0-9_]*\\s*=\\s*');
  const deletePattern = new RegExp('\\bdelete\\s+' + namePattern + '\\.[A-Za-z_][A-Za-z0-9_]*');
  const hits = [];
  for (let i = 0; i < sourceLines.length; i += 1) {
    const line = sourceLines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (assignPattern.test(line) || deletePattern.test(line)) {
      hits.push({ lineNumber: i + 1, text: line });
    }
  }
  return hits;
}

describe('board-session reactive-state invariants (app.js)', () => {
  it('fullBoardData has exactly one raw assignment, inside setFullBoardDataState', () => {
    const hits = findRawAssignments('fullBoardData');
    const setterRange = findSetterBodyRange('setFullBoardDataState');
    const outside = hits.filter((h) => !isLineInsideRange(h.lineNumber, setterRange));

    expect(hits.length).toBeGreaterThan(0);
    expect(outside).toEqual([]);

    // The one allowed write must be inside the setter body and write the
    // incoming parameter (not null literally, for example).
    const insideHits = hits.filter((h) => isLineInsideRange(h.lineNumber, setterRange));
    expect(insideHits).toHaveLength(1);
    expect(insideHits[0].text).toMatch(/fullBoardData\s*=\s*nextBoardData\s*;?/);
  });

  it('activeBoardData has exactly one raw assignment, inside setActiveBoardDataState', () => {
    const hits = findRawAssignments('activeBoardData');
    const setterRange = findSetterBodyRange('setActiveBoardDataState');
    const outside = hits.filter((h) => !isLineInsideRange(h.lineNumber, setterRange));

    expect(hits.length).toBeGreaterThan(0);
    expect(outside).toEqual([]);

    const insideHits = hits.filter((h) => isLineInsideRange(h.lineNumber, setterRange));
    expect(insideHits).toHaveLength(1);
    expect(insideHits[0].text).toMatch(/activeBoardData\s*=\s*nextBoardData\s*;?/);
  });

  it('setFullBoardDataState emits syncRuntimeState("fullBoardData", …)', () => {
    const { startLine, endLine } = findSetterBodyRange('setFullBoardDataState');
    const body = lines.slice(startLine - 1, endLine).join('\n');
    expect(body).toMatch(/syncRuntimeState\s*\(\s*['"]fullBoardData['"]\s*,/);
  });

  it('setActiveBoardDataState emits syncRuntimeState("activeBoardData", …)', () => {
    const { startLine, endLine } = findSetterBodyRange('setActiveBoardDataState');
    const body = lines.slice(startLine - 1, endLine).join('\n');
    expect(body).toMatch(/syncRuntimeState\s*\(\s*['"]activeBoardData['"]\s*,/);
  });

  it('updateActiveBoardDataState delegates through setActiveBoardDataState', () => {
    const { startLine, endLine } = findSetterBodyRange('updateActiveBoardDataState');
    const body = lines.slice(startLine - 1, endLine).join('\n');
    expect(body).toMatch(/setActiveBoardDataState\s*\(\s*nextBoardData\s*\)/);
  });

  it('every dep bag that exposes setActiveBoardData routes through setActiveBoardDataState', () => {
    // The four dep bags that used to have a bypassing stub `activeBoardData = v;`
    // must all delegate to the reactive setter. Any future dep bag added to
    // `app.js` should be added here too.
    const exposures = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (/setActiveBoardData\s*:\s*function/.test(lines[i])) {
        exposures.push({ lineNumber: i + 1, text: lines[i] });
      }
    }
    expect(exposures.length).toBeGreaterThan(0);
    exposures.forEach((exposure) => {
      expect(
        exposure.text,
        'dep bag at line ' + exposure.lineNumber + ' must call setActiveBoardDataState'
      ).toContain('setActiveBoardDataState');
    });
  });

  it('every dep bag that exposes setFullBoardData routes through setFullBoardDataState', () => {
    const exposures = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (/setFullBoardData\s*:\s*function/.test(lines[i])) {
        exposures.push({ lineNumber: i + 1, text: lines[i] });
      }
    }
    expect(exposures.length).toBeGreaterThan(0);
    exposures.forEach((exposure) => {
      expect(
        exposure.text,
        'dep bag at line ' + exposure.lineNumber + ' must call setFullBoardDataState'
      ).toContain('setFullBoardDataState');
    });
  });

  it('every dep bag that exposes updateActiveBoardData routes through updateActiveBoardDataState', () => {
    const exposures = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (/updateActiveBoardData\s*:\s*function/.test(lines[i])) {
        exposures.push({ lineNumber: i + 1, text: lines[i] });
      }
    }
    expect(exposures.length).toBeGreaterThan(0);
    exposures.forEach((exposure) => {
      expect(
        exposure.text,
        'dep bag at line ' + exposure.lineNumber + ' must call updateActiveBoardDataState'
      ).toContain('updateActiveBoardDataState');
    });
  });

  it('app.js does not directly mutate activeBoardData fields', () => {
    const hits = findPropertyMutations(lines, 'activeBoardData');
    expect(hits).toEqual([]);
  });

  it('boardList.js does not directly mutate activeBoardData fields', () => {
    const hits = findPropertyMutations(boardListLines, ['activeBoardData', 'activeBoardDataRef']);
    expect(hits).toEqual([]);
  });
});
