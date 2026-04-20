import { describe, it, expect, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

// Shared Tauri invoker resolver. The plugin file sits between plugins and the
// Tauri IPC bridge and walks a 4-branch priority chain:
//   1. LexeraBackendDiscovery.invokeTauri (abstraction layer)
//   2. __TAURI_INTERNALS__.invoke
//   3. __TAURI__.core.invoke
//   4. reject with a diagnostic state object

function load(fakeWindow) {
  return loadIIFE('plugins/exports/tauriInvoke.js', 'LexeraExportTauriInvoke', {
    window: fakeWindow || {}
  });
}

describe('LexeraExportTauriInvoke.invoke — resolver priority', () => {
  it('prefers LexeraBackendDiscovery.invokeTauri when present', async () => {
    const discovery = vi.fn().mockResolvedValue({ source: 'discovery' });
    const internals = vi.fn().mockResolvedValue({ source: 'internals' });
    const core = vi.fn().mockResolvedValue({ source: 'core' });
    const Svc = load({
      LexeraBackendDiscovery: { invokeTauri: discovery },
      __TAURI_INTERNALS__: { invoke: internals },
      __TAURI__: { core: { invoke: core } }
    });
    const result = await Svc.invoke('some_cmd', { foo: 1 });
    expect(result).toEqual({ source: 'discovery' });
    expect(discovery).toHaveBeenCalledWith('some_cmd', { foo: 1 });
    expect(internals).not.toHaveBeenCalled();
    expect(core).not.toHaveBeenCalled();
  });

  it('falls back to __TAURI_INTERNALS__.invoke when BackendDiscovery is absent', async () => {
    const internals = vi.fn().mockResolvedValue({ source: 'internals' });
    const core = vi.fn().mockResolvedValue({ source: 'core' });
    const Svc = load({
      __TAURI_INTERNALS__: { invoke: internals },
      __TAURI__: { core: { invoke: core } }
    });
    const result = await Svc.invoke('some_cmd', { foo: 1 });
    expect(result).toEqual({ source: 'internals' });
    expect(internals).toHaveBeenCalledWith('some_cmd', { foo: 1 });
    expect(core).not.toHaveBeenCalled();
  });

  it('falls back to __TAURI__.core.invoke when the first two are absent', async () => {
    const core = vi.fn().mockResolvedValue({ source: 'core' });
    const Svc = load({
      __TAURI__: { core: { invoke: core } }
    });
    const result = await Svc.invoke('some_cmd', { foo: 1 });
    expect(result).toEqual({ source: 'core' });
    expect(core).toHaveBeenCalledWith('some_cmd', { foo: 1 });
  });

  it('rejects with a diagnostic state object when no invoker is available', async () => {
    const Svc = load({});   // empty window — no invoker path present
    let caught;
    try {
      await Svc.invoke('missing_cmd');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toMatch(/Tauri invoke unavailable for missing_cmd/);
    expect(caught.message).toMatch(/hasBackendDiscovery/);
    expect(caught.message).toMatch(/hasInternals/);
    expect(caught.message).toMatch(/hasGlobalCore/);
  });

  it('normalizes missing args to {} for INTERNALS / core paths', async () => {
    const internals = vi.fn().mockResolvedValue(null);
    const Svc = load({ __TAURI_INTERNALS__: { invoke: internals } });
    await Svc.invoke('no_args_cmd');
    expect(internals).toHaveBeenCalledWith('no_args_cmd', {});

    const core = vi.fn().mockResolvedValue(null);
    const Svc2 = load({ __TAURI__: { core: { invoke: core } } });
    await Svc2.invoke('no_args_cmd');
    expect(core).toHaveBeenCalledWith('no_args_cmd', {});
  });

  it('does NOT inject {} on the BackendDiscovery path — args are forwarded as-is', async () => {
    // BackendDiscovery takes responsibility for its own args contract, so the
    // invoker forwards undefined unchanged. This documents an asymmetry between
    // the resolver branches that a future refactor should preserve (or fix).
    const discovery = vi.fn().mockResolvedValue(null);
    const Svc = load({ LexeraBackendDiscovery: { invokeTauri: discovery } });
    await Svc.invoke('cmd_without_args');
    expect(discovery).toHaveBeenCalledWith('cmd_without_args', undefined);
  });
});
