/**
 * OS-specific service installation for ludos-sync.
 *
 * macOS:   ~/Library/LaunchAgents/com.ludos.sync.plist
 * Linux:   ~/.config/systemd/user/ludos-sync.service
 * Windows: schtasks (Task Scheduler)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const SERVICE_LABEL = 'com.ludos.sync';
const SYSTEMD_SERVICE_NAME = 'ludos-sync';

export async function installService(configPath: string): Promise<void> {
  const platform = process.platform;
  const nodePath = process.execPath;
  const cliPath = path.resolve(__dirname, 'cli.js');

  switch (platform) {
    case 'darwin':
      return installLaunchd(nodePath, cliPath, configPath);
    case 'linux':
      return installSystemd(nodePath, cliPath, configPath);
    case 'win32':
      return installWindows(nodePath, cliPath, configPath);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export async function uninstallService(): Promise<void> {
  const platform = process.platform;

  switch (platform) {
    case 'darwin':
      return uninstallLaunchd();
    case 'linux':
      return uninstallSystemd();
    case 'win32':
      return uninstallWindows();
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

// --- macOS: launchd ---

function installLaunchd(nodePath: string, cliPath: string, configPath: string): void {
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${cliPath}</string>
        <string>start</string>
        <string>--config</string>
        <string>${configPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(os.homedir(), '.ludos-sync.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(os.homedir(), '.ludos-sync.err.log')}</string>
</dict>
</plist>`;

  const dir = path.dirname(plistPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(plistPath, plist, 'utf8');
  execSync(`launchctl load ${plistPath}`);
  console.log(`[ludos-sync] Installed launchd service: ${plistPath}`);
}

function uninstallLaunchd(): void {
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);

  if (fs.existsSync(plistPath)) {
    try { execSync(`launchctl unload ${plistPath}`); } catch { /* may not be loaded */ }
    fs.unlinkSync(plistPath);
    console.log(`[ludos-sync] Removed launchd service: ${plistPath}`);
  } else {
    console.log('[ludos-sync] No launchd service found.');
  }
}

// --- Linux: systemd user service ---

function installSystemd(nodePath: string, cliPath: string, configPath: string): void {
  const serviceDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const servicePath = path.join(serviceDir, `${SYSTEMD_SERVICE_NAME}.service`);

  const serviceFile = `[Unit]
Description=Ludos Sync WebDAV Server
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${cliPath} start --config ${configPath}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;

  if (!fs.existsSync(serviceDir)) {
    fs.mkdirSync(serviceDir, { recursive: true });
  }

  fs.writeFileSync(servicePath, serviceFile, 'utf8');
  execSync('systemctl --user daemon-reload');
  execSync(`systemctl --user enable ${SYSTEMD_SERVICE_NAME}`);
  execSync(`systemctl --user start ${SYSTEMD_SERVICE_NAME}`);
  console.log(`[ludos-sync] Installed systemd service: ${servicePath}`);
}

function uninstallSystemd(): void {
  const serviceDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const servicePath = path.join(serviceDir, `${SYSTEMD_SERVICE_NAME}.service`);

  if (fs.existsSync(servicePath)) {
    try { execSync(`systemctl --user stop ${SYSTEMD_SERVICE_NAME}`); } catch { /* may not be running */ }
    try { execSync(`systemctl --user disable ${SYSTEMD_SERVICE_NAME}`); } catch { /* may not be enabled */ }
    fs.unlinkSync(servicePath);
    execSync('systemctl --user daemon-reload');
    console.log(`[ludos-sync] Removed systemd service: ${servicePath}`);
  } else {
    console.log('[ludos-sync] No systemd service found.');
  }
}

// --- Windows: schtasks ---

function installWindows(nodePath: string, cliPath: string, configPath: string): void {
  const taskName = 'LudosSync';
  const cmd = `"${nodePath}" "${cliPath}" start --config "${configPath}"`;

  execSync(
    `schtasks /Create /TN "${taskName}" /SC ONLOGON /TR "${cmd}" /F /RL LIMITED`,
    { stdio: 'inherit' }
  );
  // Also start it now
  execSync(`schtasks /Run /TN "${taskName}"`, { stdio: 'inherit' });
  console.log(`[ludos-sync] Installed Windows scheduled task: ${taskName}`);
}

function uninstallWindows(): void {
  const taskName = 'LudosSync';
  try {
    execSync(`schtasks /End /TN "${taskName}"`, { stdio: 'inherit' });
  } catch { /* may not be running */ }
  try {
    execSync(`schtasks /Delete /TN "${taskName}" /F`, { stdio: 'inherit' });
    console.log(`[ludos-sync] Removed Windows scheduled task: ${taskName}`);
  } catch {
    console.log('[ludos-sync] No Windows scheduled task found.');
  }
}
