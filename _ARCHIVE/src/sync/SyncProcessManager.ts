/**
 * Manages the ludos-sync process from within VS Code.
 *
 * - Probes if ludos-sync is already running (by checking /status endpoint)
 * - Spawns ludos-sync as a detached child process if autoStart is enabled
 * - Does NOT kill the server on deactivation (it's meant to run independently)
 * - Provides commands: start, stop, status
 */

import * as vscode from 'vscode';
import * as http from 'http';
import { ChildProcess, spawn } from 'child_process';
import { SyncConfigBridge } from './SyncConfigBridge';
import { logger } from '../utils/logger';

export class SyncProcessManager implements vscode.Disposable {
  private childProcess: ChildProcess | null = null;
  private configBridge: SyncConfigBridge;
  private serverPort: number | null = null;

  constructor(configBridge: SyncConfigBridge) {
    this.configBridge = configBridge;
  }

  /**
   * Check if a ludos-sync server is already running on the configured port.
   */
  async isRunning(): Promise<boolean> {
    const port = this.serverPort || this.configBridge.getPort();
    if (!port || port === 0) return false;

    try {
      await this.probeStatus(port);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start ludos-sync as a detached child process.
   * The process continues running after VS Code closes.
   */
  async start(): Promise<number | null> {
    if (await this.isRunning()) {
      logger.debug('[SyncProcessManager] Server already running');
      return this.serverPort;
    }

    const configPath = this.configBridge.getConfigPath();

    try {
      // Try to find ludos-sync in node_modules or as a global command
      const syncCmd = this.findSyncCommand();
      if (!syncCmd) {
        logger.warn('[SyncProcessManager] ludos-sync not found. Install with: npm install -g ludos-sync');
        return null;
      }

      this.childProcess = spawn(
        syncCmd.command,
        [...syncCmd.args, 'start', '--config', configPath],
        {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env },
        }
      );

      // Unref so VS Code can exit without killing the process
      this.childProcess.unref();

      // Wait briefly and check if it started
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Try to discover the port from the running server
      const config = this.configBridge.readConfig();
      if (config.port > 0) {
        this.serverPort = config.port;
      }

      logger.debug(`[SyncProcessManager] Started ludos-sync (PID: ${this.childProcess.pid})`);
      return this.serverPort;
    } catch (err) {
      logger.error('[SyncProcessManager] Failed to start ludos-sync:', err);
      return null;
    }
  }

  /**
   * Stop the ludos-sync process we spawned.
   */
  async stop(): Promise<void> {
    if (this.childProcess && this.childProcess.pid) {
      try {
        process.kill(this.childProcess.pid, 'SIGTERM');
        logger.debug('[SyncProcessManager] Sent SIGTERM to ludos-sync');
      } catch {
        // Process may have already exited
      }
      this.childProcess = null;
      this.serverPort = null;
    }
  }

  /**
   * Get server status info.
   */
  async getStatus(): Promise<{ running: boolean; port: number | null; boards?: unknown[] }> {
    const port = this.serverPort || this.configBridge.getPort();
    if (!port || port === 0) {
      return { running: false, port: null };
    }

    try {
      const status = await this.probeStatus(port) as Record<string, unknown>;
      return {
        running: true,
        port,
        boards: status.boards as unknown[] | undefined,
      };
    } catch {
      return { running: false, port };
    }
  }

  getServerPort(): number | null {
    return this.serverPort;
  }

  dispose(): void {
    // Do NOT kill the server — it's meant to run independently
    this.childProcess = null;
  }

  private findSyncCommand(): { command: string; args: string[] } | null {
    // Try npx first
    return { command: 'npx', args: ['ludos-sync'] };
  }

  private probeStatus(port: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/status', method: 'GET', timeout: 3000 },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch { resolve(data); }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
  }
}
