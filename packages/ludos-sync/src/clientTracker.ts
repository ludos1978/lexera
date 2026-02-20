/**
 * Tracks which macOS processes are connecting to the server.
 * Resolves process names from remote ports via `lsof`.
 */

import { execFile } from 'child_process';
import { log } from './logger';

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 30 * 1000;

interface AccessEntry {
  timestamp: number;
  method: string;
  path: string;
}

interface ClientRecord {
  processName: string;
  entries: AccessEntry[];
}

// processName → ClientRecord
const clients = new Map<string, ClientRecord>();

// remotePort → resolved process name (short-lived cache)
const portCache = new Map<number, string>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Resolve which process owns a given remote TCP port using lsof.
 */
export function resolveProcessName(remoteAddr: string | undefined, remotePort: number | undefined): Promise<string> {
  if (!remoteAddr || !remotePort) return Promise.resolve('unknown');

  // Check cache first
  const cached = portCache.get(remotePort);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    // Normalize address for lsof
    let addr: string;
    if (remoteAddr === '::1') {
      addr = '[::1]';
    } else if (remoteAddr === '::ffff:127.0.0.1') {
      addr = '127.0.0.1';
    } else {
      addr = remoteAddr;
    }

    execFile(
      'lsof',
      ['-n', '-P', '-i', `TCP@${addr}:${remotePort}`, '-F', 'c'],
      { timeout: 2000 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve('unknown');
          return;
        }
        // -F c output: lines like "p1234\ncCalendarAgent\n"
        const match = stdout.match(/^c(.+)$/m);
        const name = match ? match[1] : 'unknown';

        // Cache briefly (port gets reused after connection closes)
        portCache.set(remotePort, name);
        setTimeout(() => portCache.delete(remotePort), 30_000);

        resolve(name);
      }
    );
  });
}

/**
 * Record an access from a named process.
 */
export function recordAccess(processName: string, method: string, path: string): void {
  if (!processName || processName === 'unknown') return;

  let record = clients.get(processName);
  if (!record) {
    record = { processName, entries: [] };
    clients.set(processName, record);
  }

  record.entries.push({
    timestamp: Date.now(),
    method,
    path,
  });

  ensureCleanupRunning();
}

/**
 * Get recent client accesses within the last 5 minutes, sorted by name.
 */
export function getRecentClients(): {
  processName: string;
  requestCount: number;
  lastAccess: string; // ISO string
}[] {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const result: { processName: string; requestCount: number; lastAccess: string }[] = [];

  for (const [name, record] of clients) {
    const recent = record.entries.filter(e => e.timestamp >= cutoff);
    if (recent.length === 0) continue;

    const lastTs = Math.max(...recent.map(e => e.timestamp));
    result.push({
      processName: name,
      requestCount: recent.length,
      lastAccess: new Date(lastTs).toISOString(),
    });
  }

  result.sort((a, b) => a.processName.localeCompare(b.processName));
  return result;
}

/**
 * Prune entries older than 5 minutes.
 */
function cleanup(): void {
  const cutoff = Date.now() - WINDOW_MS;

  for (const [name, record] of clients) {
    record.entries = record.entries.filter(e => e.timestamp >= cutoff);
    if (record.entries.length === 0) {
      clients.delete(name);
    }
  }

  if (clients.size === 0 && cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

function ensureCleanupRunning(): void {
  if (!cleanupTimer) {
    cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref(); // Don't prevent process exit
  }
}

/**
 * Stop tracking (for clean shutdown).
 */
export function stopTracking(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  clients.clear();
  portCache.clear();
}
