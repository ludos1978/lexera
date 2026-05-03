// IPC StreamRegistry per-window cleanup — source-level contract.
//
// `StreamRegistry` (`ipc_streams.rs`) tracks open IPC subscriptions
// keyed by correlation_id (Uuid). Correlation IDs are globally
// unique so there's no functional collision across windows, but
// without window ownership the registry would grow unbounded over
// multi-window open/close churn — closed windows leave their
// subscriptions running until the backend connection drops.
//
// Fix: store the opener's top-level window label in each
// `StreamEntry`, expose `StreamRegistry::stop_window_blocking`,
// and invoke it from `main.rs` `CloseRequested`.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const streamsRs = readFileSync(
  resolve(__dirname, '..', 'src-tauri', 'src', 'ipc_streams.rs'),
  'utf8'
);
const ipcCommandsRs = readFileSync(
  resolve(__dirname, '..', 'src-tauri', 'src', 'ipc_commands.rs'),
  'utf8'
);
const mainRs = readFileSync(
  resolve(__dirname, '..', 'src-tauri', 'src', 'main.rs'),
  'utf8'
);

describe('StreamRegistry per-window cleanup', () => {
  it('StreamEntry carries owner_window so stop_window can find its rows', () => {
    expect(streamsRs).toMatch(/struct StreamEntry[\s\S]{0,1000}owner_window:\s*String/);
  });

  it('open() takes owner_window and stores it on the entry', () => {
    expect(streamsRs).toMatch(/pub async fn open\([\s\S]{0,400}owner_window:\s*String/);
    expect(streamsRs).toMatch(/StreamEntry\s*\{[\s\S]{0,300}owner_window\s*\}/);
  });

  it('StreamRegistry exposes stop_window_blocking that aborts and removes rows for the window', () => {
    expect(streamsRs).toMatch(/pub fn stop_window_blocking\(&self,\s*window_label:\s*&str\)/);
    // Iterate, collect matching IDs, then remove + abort. The
    // borrow-safe shape (collect IDs first, then remove in a
    // second pass) is what lets this compile under the parking_lot
    // / tokio mutex.
    expect(streamsRs).toMatch(/owner_window\s*==\s*window_label/);
    expect(streamsRs).toMatch(/entry\.handle\.abort\(\)/);
  });
});

describe('Tauri command + close-cleanup wiring', () => {
  it('backend_ipc_stream_open injects caller and forwards window label', () => {
    expect(ipcCommandsRs).toMatch(/pub async fn backend_ipc_stream_open\([\s\S]{0,400}caller:\s*tauri::Webview/);
    expect(ipcCommandsRs).toMatch(/owner_window\s*=\s*caller\.window\(\)\.label\(\)/);
    expect(ipcCommandsRs).toMatch(/ipc_streams::open\([\s\S]{0,200}owner_window\)/);
  });

  it('main.rs CloseRequested calls SharedStreamRegistry::stop_window_blocking', () => {
    expect(mainRs).toMatch(
      /CloseRequested[\s\S]{0,5500}SharedStreamRegistry[\s\S]{0,200}stop_window_blocking\(&closing_label\)/
    );
  });
});
