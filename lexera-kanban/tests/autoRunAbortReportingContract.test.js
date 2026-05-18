import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendTests = readFileSync(
  resolve(__dirname, '..', 'src', 'test', 'frontendTests.js'), 'utf8');
const bootstrap = readFileSync(
  resolve(__dirname, '..', 'src', 'test', 'autoRunBootstrap.js'), 'utf8');

// Slice 2 of "make ./run-lexera-tests.sh readiness/pre-test stalls
// actionable": a board-readiness pre-flight timeout aborts the run via
// endRun(), but the reason was only testLog()'d to the in-app panel and
// never reached logs/frontend-tests.log — so an integration run that
// stalls just shows the frozen pre-test progress line and dies silent.
// frontendTests.js now records a `_runState.abort` marker (which
// endRun() deliberately leaves intact) and the bootstrap flushes it.
// These source-level pins keep that contract from silently regressing.
describe('auto-run pre-flight abort is recorded and flushed to the log', () => {
  it('_runState carries an abort slot initialised to null', () => {
    expect(frontendTests).toMatch(/var _runState = \{[\s\S]*?\babort: null\b[\s\S]*?\};/);
  });

  it('defines recordPreflightAbort capturing source/phase/reason', () => {
    expect(frontendTests).toMatch(/function recordPreflightAbort\(source, message\)/);
    const m = frontendTests.match(/function recordPreflightAbort\(source, message\)\s*\{([\s\S]*?)\n  \}/);
    expect(m, 'recordPreflightAbort body must exist').not.toBeNull();
    expect(m[1]).toMatch(/_runState\.abort\s*=\s*\{/);
    expect(m[1]).toMatch(/source:/);
    expect(m[1]).toMatch(/phase:/);
    expect(m[1]).toMatch(/reason:/);
  });

  it('beginRun() clears any stale abort from a prior run', () => {
    const m = frontendTests.match(/function beginRun\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
    expect(m, 'beginRun body must exist').not.toBeNull();
    expect(m[1]).toMatch(/_runState\.abort\s*=\s*null\s*;/);
  });

  it('endRun() does NOT reset abort, so it survives for the bootstrap', () => {
    const m = frontendTests.match(/function endRun\(\)\s*\{([\s\S]*?)\n  \}/);
    expect(m, 'endRun body must exist').not.toBeNull();
    expect(m[1], 'endRun must leave _runState.abort intact').not.toMatch(/\babort\b/);
  });

  it('both pre-flight aborts record BEFORE endRun()', () => {
    expect(frontendTests).toMatch(
      /recordPreflightAbort\('runAll',\s*preflightMsg\);\s*endRun\(\);/);
    expect(frontendTests).toMatch(
      /recordPreflightAbort\('runOne',\s*preflightMsg\);\s*endRun\(\);/);
  });

  it('the bootstrap flushes describeAbort to the output log post-run', () => {
    // describeAbort wired in, and emitted before the results formatter
    // so the actionable reason precedes the (empty) results block.
    expect(bootstrap).toMatch(/function describeAbort\(state\)/);
    const abortIdx = bootstrap.indexOf('var abortText = describeAbort(');
    expect(abortIdx, 'describeAbort must be invoked in the post-loop flush').toBeGreaterThan(-1);
    const resultsIdx = bootstrap.indexOf('// Format results');
    expect(resultsIdx).toBeGreaterThan(-1);
    expect(abortIdx).toBeLessThan(resultsIdx);
    const flush = bootstrap.slice(abortIdx, resultsIdx);
    expect(flush).toMatch(/writeTestOutput\(outputPath, abortText\)/);
  });
});
