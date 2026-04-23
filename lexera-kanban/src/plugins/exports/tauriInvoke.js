var LexeraExportTauriInvoke = (function () {
  // Mirrors resolveExportTauriIpc in src/export/exportService.js. The kanban
  // UI runs inside a workspace-shell iframe; Tauri 2 does NOT inject
  // __TAURI_INTERNALS__ into sub-frames, so we walk up to the parent window
  // (same-origin) when the current window is bare. Without this, every Tauri
  // command dispatched from an export plugin (Marp / Pandoc status checks,
  // engine path resolution, etc.) rejects with "Tauri invoke unavailable".
  function resolveIpc() {
    if (typeof window === 'undefined') return null;
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      return window.__TAURI_INTERNALS__;
    }
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      return window.__TAURI__.core;
    }
    try {
      if (window.parent && window.parent !== window) {
        if (window.parent.__TAURI_INTERNALS__ && typeof window.parent.__TAURI_INTERNALS__.invoke === 'function') {
          return window.parent.__TAURI_INTERNALS__;
        }
        if (window.parent.__TAURI__ && window.parent.__TAURI__.core && typeof window.parent.__TAURI__.core.invoke === 'function') {
          return window.parent.__TAURI__.core;
        }
      }
    } catch (e) { /* cross-origin — ignore */ }
    return null;
  }

  function invoke(command, args) {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('window unavailable'));
    }
    // Priority 1: LexeraBackendDiscovery.invokeTauri — lets a shared
    // abstraction layer interpose (e.g. route through an embedded
    // shell's transport). Forward args as-is so the abstraction layer
    // can define its own contract.
    if (window.LexeraBackendDiscovery && typeof window.LexeraBackendDiscovery.invokeTauri === 'function') {
      return window.LexeraBackendDiscovery.invokeTauri(command, args);
    }
    // Priority 2–3: direct Tauri IPC. Both internals and __TAURI__.core
    // expect an args object — normalize `undefined` to `{}` so callers
    // can omit args for zero-arg commands without tripping the IPC
    // contract.
    var ipc = resolveIpc();
    if (ipc) {
      return ipc.invoke(command, args === undefined ? {} : args);
    }
    var available = {
      hasIpc: !!ipc,
      hasBackendDiscovery: !!(window.LexeraBackendDiscovery && typeof window.LexeraBackendDiscovery.invokeTauri === 'function'),
      hasInternals: !!(window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function'),
      hasParentInternals: (function () { try { return !!(window.parent && window.parent.__TAURI_INTERNALS__); } catch (e) { return false; } })(),
      hasGlobalCore: !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function')
    };
    return Promise.reject(new Error('Tauri invoke unavailable for ' + command + ' (state: ' + JSON.stringify(available) + ')'));
  }

  return { invoke: invoke };
})();

if (typeof window !== 'undefined') {
  window.LexeraExportTauriInvoke = LexeraExportTauriInvoke;
}
