/**
 * CLI entry point for ludos-sync.
 *
 * Commands:
 *   ludos-sync                          Start with default config
 *   ludos-sync --config ./my-sync.json  Custom config path
 *   ludos-sync --port 8080              Override port
 *   ludos-sync install                  Register as OS startup service
 *   ludos-sync uninstall                Remove OS startup service
 *   ludos-sync status                   Check if running, show port
 */

import { Command } from 'commander';
import { ConfigManager, getDefaultConfigPath } from './config';
import { SyncServer } from './server';
import { installService, uninstallService } from './serviceInstaller';
import { setVerbose, log } from './logger';
import * as http from 'http';
import * as path from 'path';

const defaultConfigPath = getDefaultConfigPath();

const program = new Command();

program
  .name('ludos-sync')
  .description('WebDAV sync server for Ludos Kanban markdown files')
  .version('0.1.0')
  .option('-c, --config <path>', `Path to sync config file (default: ${defaultConfigPath})`, defaultConfigPath)
  .option('-p, --port <number>', 'Override server port', parseInt)
  .option('-v, --verbose', 'Enable verbose logging');

program
  .command('start', { isDefault: true })
  .description('Start the sync server')
  .action(async () => {
    const opts = program.opts();
    if (opts.verbose) setVerbose(true);

    const configPath = path.resolve(opts.config);
    log.verbose(`Config: ${configPath}`);
    log.verbose(`Verbose logging enabled`);

    const configManager = new ConfigManager(configPath);
    configManager.ensureConfigExists();

    // Override port from CLI
    if (opts.port !== undefined) {
      const config = configManager.getConfig();
      config.port = opts.port;
      log.verbose(`Port overridden from CLI: ${opts.port}`);
    }

    const server = new SyncServer(configManager);

    // Graceful shutdown
    const shutdown = async () => {
      log.info('Shutting down...');
      await server.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
      const info = await server.start();
      log.info(`Ready. Configure Floccus with: http://localhost:${info.port}/bookmarks/`);
    } catch (err) {
      log.error('Failed to start:', err);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check if server is running')
  .action(async () => {
    const opts = program.opts();
    const configPath = path.resolve(opts.config);
    const configManager = new ConfigManager(configPath);
    const config = configManager.getConfig();

    if (config.port === 0) {
      console.log('[ludos-sync] Port is auto-select (0). Cannot probe without knowing the port.');
      console.log('[ludos-sync] Check the server output or config for the actual port.');
      return;
    }

    try {
      const result = await probeStatus(config.port);
      console.log(`[ludos-sync] Server is running on port ${config.port}`);
      console.log(JSON.stringify(result, null, 2));
    } catch {
      console.log(`[ludos-sync] Server is not running on port ${config.port}`);
    }
  });

program
  .command('install')
  .description('Register ludos-sync as an OS startup service')
  .action(async () => {
    const opts = program.opts();
    const configPath = path.resolve(opts.config);
    try {
      await installService(configPath);
      console.log('[ludos-sync] Service installed successfully.');
    } catch (err) {
      console.error('[ludos-sync] Failed to install service:', err);
      process.exit(1);
    }
  });

program
  .command('uninstall')
  .description('Remove ludos-sync OS startup service')
  .action(async () => {
    try {
      await uninstallService();
      console.log('[ludos-sync] Service uninstalled successfully.');
    } catch (err) {
      console.error('[ludos-sync] Failed to uninstall service:', err);
      process.exit(1);
    }
  });

function probeStatus(port: number): Promise<unknown> {
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

program.parse();
