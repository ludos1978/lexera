/**
 * Simple logger for ludos-sync with verbose mode.
 *
 * Normal mode:  key lifecycle events (start, stop, board loaded, sync)
 * Verbose mode: all of the above + HTTP requests, URL resolution, XBEL details
 */

const PREFIX = '[ludos-sync]';

let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function isVerbose(): boolean {
  return verboseEnabled;
}

export const log = {
  /** Always printed — key lifecycle events */
  info(...args: unknown[]): void {
    console.log(PREFIX, ...args);
  },

  /** Always printed — warnings */
  warn(...args: unknown[]): void {
    console.warn(PREFIX, '⚠', ...args);
  },

  /** Always printed — errors */
  error(...args: unknown[]): void {
    console.error(PREFIX, '✗', ...args);
  },

  /** Only printed in --verbose mode */
  verbose(...args: unknown[]): void {
    if (verboseEnabled) {
      console.log(PREFIX, ' ', ...args);
    }
  },

  /** Only printed in --verbose mode — HTTP request/response details */
  http(method: string, path: string, ...args: unknown[]): void {
    if (verboseEnabled) {
      console.log(PREFIX, `→ ${method} ${path}`, ...args);
    }
  },
};
