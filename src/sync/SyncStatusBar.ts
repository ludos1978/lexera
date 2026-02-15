/**
 * Status bar item showing sync server state.
 *
 * Shows: "Sync: localhost:PORT" when running, "Sync: off" when stopped.
 * Clicking opens the sync status command.
 */

import * as vscode from 'vscode';
import { SyncProcessManager } from './SyncProcessManager';

export class SyncStatusBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private processManager: SyncProcessManager;
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor(processManager: SyncProcessManager) {
    this.processManager = processManager;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      50
    );
    this.statusBarItem.command = 'markdown-kanban.sync.status';
  }

  /**
   * Start showing the status bar item and polling for status.
   */
  activate(): void {
    this.refresh();
    // Poll every 30 seconds
    this.refreshInterval = setInterval(() => this.refresh(), 30000);
    this.statusBarItem.show();
  }

  /**
   * Refresh the status bar display.
   */
  async refresh(): Promise<void> {
    const status = await this.processManager.getStatus();

    if (status.running && status.port) {
      this.statusBarItem.text = `$(sync) Sync: :${status.port}`;
      this.statusBarItem.tooltip = `Ludos Sync running on localhost:${status.port}\nClick for details`;
    } else {
      this.statusBarItem.text = '$(sync-ignored) Sync: off';
      this.statusBarItem.tooltip = 'Ludos Sync is not running\nClick for details';
    }
  }

  dispose(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.statusBarItem.dispose();
  }
}
