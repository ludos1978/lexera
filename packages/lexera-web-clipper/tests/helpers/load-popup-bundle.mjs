import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..', '..');
const htmlPath = path.join(packageDir, 'src', 'popup.html');
const bundlePath = path.join(packageDir, 'dist', 'chrome', 'popup.js');

function clone(value) {
  if (typeof value === 'undefined') return undefined;
  return JSON.parse(JSON.stringify(value));
}

async function flush(window, turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

export async function loadPopupBundle({ handleMessage, apiStyle = 'callback' }) {
  const html = readFileSync(htmlPath, 'utf8');
  const source = readFileSync(bundlePath, 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://extension.local/popup.html',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const calls = [];

  window.HTMLElement.prototype.scrollIntoView = () => {};
  const extensionApi = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        calls.push(clone(message));
        Promise.resolve(handleMessage(clone(message)))
          .then((response) => callback(clone(response)))
          .catch((error) => callback({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      },
    },
  };
  if (apiStyle === 'promise') {
    extensionApi.runtime.sendMessage = (message) => {
      calls.push(clone(message));
      return Promise.resolve(handleMessage(clone(message)));
    };
    window.browser = extensionApi;
  } else {
    window.chrome = extensionApi;
  }
  window.fetch = async (input) => {
    throw new Error(`Unexpected fetch call in popup test: ${String(input)}`);
  };
  window.console = console;
  window.AbortController = globalThis.AbortController;
  window.AbortSignal = globalThis.AbortSignal;
  window.URLSearchParams = globalThis.URLSearchParams;
  window.setTimeout = globalThis.setTimeout;
  window.clearTimeout = globalThis.clearTimeout;

  window.eval(source);
  await flush(window);

  return {
    window,
    document: window.document,
    calls,
    async flush(turns = 4) {
      await flush(window, turns);
    },
    cleanup() {
      window.close();
    },
  };
}
