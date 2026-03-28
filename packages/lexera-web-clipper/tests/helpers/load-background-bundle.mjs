import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..', '..');
const bundlePath = path.join(packageDir, 'dist', 'chrome', 'background.js');

function clone(value) {
  if (typeof value === 'undefined') return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function loadBackgroundBundle({
  fetchImpl,
  initialClipperState = {},
  apiStyle = 'callback',
} = {}) {
  const source = readFileSync(bundlePath, 'utf8');
  const listeners = {
    runtimeMessage: null,
    installed: null,
    startup: null,
    contextMenuClick: null,
  };
  const storageState = {
    lexeraWebClipperState: clone(initialClipperState),
  };

  const extensionApi = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) {
          listeners.runtimeMessage = listener;
        },
      },
      onInstalled: {
        addListener(listener) {
          listeners.installed = listener;
        },
      },
      onStartup: {
        addListener(listener) {
          listeners.startup = listener;
        },
      },
    },
    storage: {
      local: {
        get(_keys, callback) {
          callback({ lexeraWebClipperState: clone(storageState.lexeraWebClipperState) });
        },
        set(values, callback) {
          if (Object.prototype.hasOwnProperty.call(values, 'lexeraWebClipperState')) {
            storageState.lexeraWebClipperState = clone(values.lexeraWebClipperState);
          }
          callback?.();
        },
      },
    },
    tabs: {
      query(_queryInfo, callback) {
        callback([]);
      },
      sendMessage(_tabId, _message, callback) {
        callback?.({ ok: false });
      },
    },
    scripting: {
      executeScript(_details, callback) {
        callback?.([]);
      },
    },
    contextMenus: {
      removeAll(callback) {
        callback?.();
      },
      create(_properties, callback) {
        callback?.();
      },
      onClicked: {
        addListener(listener) {
          listeners.contextMenuClick = listener;
        },
      },
    },
    notifications: {
      create(id, _options, callback) {
        callback?.(id);
      },
    },
  };

  if (apiStyle === 'promise') {
    extensionApi.storage.local.get = async () => ({ lexeraWebClipperState: clone(storageState.lexeraWebClipperState) });
    extensionApi.storage.local.set = async (values) => {
      if (Object.prototype.hasOwnProperty.call(values, 'lexeraWebClipperState')) {
        storageState.lexeraWebClipperState = clone(values.lexeraWebClipperState);
      }
    };
    extensionApi.tabs.query = async () => [];
    extensionApi.tabs.sendMessage = async () => ({ ok: false });
    extensionApi.scripting.executeScript = async () => [];
    extensionApi.contextMenus.removeAll = async () => undefined;
    extensionApi.contextMenus.create = async () => undefined;
    extensionApi.notifications.create = async (id) => id;
  }

  const sandbox = {
    fetch: fetchImpl || (async () => {
      throw new Error('Unexpected fetch call');
    }),
    console,
    setTimeout,
    clearTimeout,
    AbortController: globalThis.AbortController,
    AbortSignal: globalThis.AbortSignal,
    Blob: globalThis.Blob,
    File: globalThis.File,
    FormData: globalThis.FormData,
    URL,
    URLSearchParams,
  };
  if (apiStyle === 'promise') {
    sandbox.browser = extensionApi;
  } else {
    sandbox.chrome = extensionApi;
  }
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: bundlePath });

  if (typeof listeners.runtimeMessage !== 'function') {
    throw new Error('Background bundle did not register a runtime message listener');
  }

  return {
    async invokeMessage(message) {
      return await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('Timed out waiting for background response')), 500);
        listeners.runtimeMessage(message, {}, (response) => {
          clearTimeout(timeoutId);
          resolve(clone(response));
        });
      });
    },
    readStoredState() {
      return clone(storageState.lexeraWebClipperState) || {};
    },
  };
}
