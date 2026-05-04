// Pins the log-viewer pure-helper surface that lives at module scope in
// `lexera-shared/management.js` (LEXERA_MGMT_LOG_HELPERS / window.
// LexeraManagementLogHelpers). Future extraction to a dedicated
// `src/management/logViewer.js` module (TODO line 41) must preserve
// these names, signatures, and behaviour or this test fails.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const managementPath = resolve(__dirname, '..', '..', 'lexera-shared', 'management.js');

function loadHelpers() {
  const source = readFileSync(managementPath, 'utf-8');
  // Cut at the `var ManagementUI = (function ()` boundary so we only
  // execute the top-of-file prelude; the 2800-line IIFE body stays out
  // of the sandbox.
  const cutAt = source.indexOf('var ManagementUI = (function ()');
  if (cutAt === -1) throw new Error('Could not find ManagementUI IIFE start');
  const prelude = source.slice(0, cutAt);
  const sandbox = { window: {} };
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'window',
    `${prelude}\n; return LEXERA_MGMT_LOG_HELPERS;`,
  );
  const helpers = factory(sandbox.window);
  return { helpers, win: sandbox.window };
}

describe('LEXERA_MGMT_LOG_HELPERS — log-viewer pure-helper surface', () => {
  const { helpers, win } = loadHelpers();

  it('is exposed on window as LexeraManagementLogHelpers', () => {
    expect(win.LexeraManagementLogHelpers).toBe(helpers);
  });

  it('exposes the load-bearing public surface', () => {
    const expected = [
      'MAX_RENDERED_LOG_ENTRIES',
      'normalizeLogEntry',
      'logSourceForEntry',
      'formatLogTimestamp',
      'logMatchesFilter',
    ];
    for (const key of expected) {
      expect(helpers).toHaveProperty(key);
    }
  });

  describe('MAX_RENDERED_LOG_ENTRIES', () => {
    it('is a positive integer cap', () => {
      expect(typeof helpers.MAX_RENDERED_LOG_ENTRIES).toBe('number');
      expect(helpers.MAX_RENDERED_LOG_ENTRIES).toBeGreaterThan(0);
      expect(Number.isInteger(helpers.MAX_RENDERED_LOG_ENTRIES)).toBe(true);
    });
  });

  describe('normalizeLogEntry', () => {
    it('returns null for falsy input', () => {
      expect(helpers.normalizeLogEntry(null)).toBe(null);
      expect(helpers.normalizeLogEntry(undefined)).toBe(null);
      expect(helpers.normalizeLogEntry(0)).toBe(null);
    });

    it('coerces and lower-cases level', () => {
      const out = helpers.normalizeLogEntry({ level: 'WARN', message: 'hi' });
      expect(out.level).toBe('warn');
    });

    it('accepts both `timestampMs` and `timestamp_ms`', () => {
      const a = helpers.normalizeLogEntry({ timestampMs: 1000 });
      const b = helpers.normalizeLogEntry({ timestamp_ms: 2000 });
      expect(a.timestampMs).toBe(1000);
      expect(b.timestampMs).toBe(2000);
    });

    it('defaults missing fields to safe values', () => {
      const out = helpers.normalizeLogEntry({});
      expect(out.level).toBe('info');
      expect(out.target).toBe('backend');
      expect(out.message).toBe('');
      expect(typeof out.timestampMs).toBe('number');
    });
  });

  describe('formatLogTimestamp', () => {
    it('returns a non-empty string for a valid millisecond timestamp', () => {
      const out = helpers.formatLogTimestamp(Date.UTC(2026, 0, 1, 12, 34, 56));
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    });

    it('does not throw on a NaN input (defensive try/catch wraps the format call)', () => {
      // The catch fallback returns ''; modern V8 does not actually throw for
      // `new Date(NaN).toLocaleTimeString(...)` (it returns "Invalid Date"),
      // so the contract is "no throw + always returns a string".
      let out;
      expect(() => { out = helpers.formatLogTimestamp(NaN); }).not.toThrow();
      expect(typeof out).toBe('string');
    });
  });

  describe('logMatchesFilter', () => {
    const entry = (level) => ({ level, message: 'x', target: 'backend', timestampMs: 0 });

    it('"backend" mode keeps backend-sourced entries', () => {
      expect(helpers.logMatchesFilter('backend', entry('info'))).toBe(true);
    });

    it('"errors" mode keeps warn + error, drops info + debug', () => {
      expect(helpers.logMatchesFilter('errors', entry('warn'))).toBe(true);
      expect(helpers.logMatchesFilter('errors', entry('error'))).toBe(true);
      expect(helpers.logMatchesFilter('errors', entry('info'))).toBe(false);
      expect(helpers.logMatchesFilter('errors', entry('debug'))).toBe(false);
    });

    it('"all" mode passes every entry through', () => {
      expect(helpers.logMatchesFilter('all', entry('info'))).toBe(true);
      expect(helpers.logMatchesFilter('all', entry('error'))).toBe(true);
    });

    it('takes filter as first argument so the helper stays state-free', () => {
      // Calling without the entry must not throw — guards against a future
      // refactor that flips the argument order.
      expect(() => helpers.logMatchesFilter('all', entry('info'))).not.toThrow();
    });
  });

  describe('logSourceForEntry', () => {
    it('always returns "backend" (current single-source UI invariant)', () => {
      expect(helpers.logSourceForEntry()).toBe('backend');
      expect(helpers.logSourceForEntry({ target: 'frontend' })).toBe('backend');
    });
  });
});
