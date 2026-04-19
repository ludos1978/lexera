var LexeraExportTauriInvoke = (function () {
  function invoke(command, args) {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('window unavailable'));
    }
    if (window.LexeraBackendDiscovery && typeof window.LexeraBackendDiscovery.invokeTauri === 'function') {
      return window.LexeraBackendDiscovery.invokeTauri(command, args);
    }
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
      return window.__TAURI_INTERNALS__.invoke(command, args || {});
    }
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      return window.__TAURI__.core.invoke(command, args || {});
    }
    var available = {
      hasBackendDiscovery: !!(window.LexeraBackendDiscovery && typeof window.LexeraBackendDiscovery.invokeTauri === 'function'),
      hasInternals: !!(window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function'),
      hasGlobalCore: !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function')
    };
    return Promise.reject(new Error('Tauri invoke unavailable for ' + command + ' (state: ' + JSON.stringify(available) + ')'));
  }

  return { invoke: invoke };
})();

if (typeof window !== 'undefined') {
  window.LexeraExportTauriInvoke = LexeraExportTauriInvoke;
}
