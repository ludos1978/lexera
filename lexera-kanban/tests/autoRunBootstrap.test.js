import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '..', 'src', 'test', 'autoRunBootstrap.js'), 'utf8');

class FakeMessageChannel {
  constructor() {
    this.port1 = { onmessage: null, close() {} };
    this.port2 = {
      close() {},
      postMessage: () => {
        setImmediate(() => {
          if (typeof this.port1.onmessage === 'function') this.port1.onmessage({ data: 0 });
        });
      }
    };
  }
}

async function waitFor(predicate, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return true;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return false;
}

function createSandbox({ parentTests, iframeTests } = {}) {
  const parentRunState = { active: false, currentIndex: -1, total: 0, phase: 'idle' };
  const iframeRunState = { active: false, currentIndex: -1, total: 0, phase: 'idle' };
  const parentRun = vi.fn(() => {
    parentRunState.active = true;
    parentRunState.currentIndex = 0;
    parentRunState.total = parentTests || 1;
  });
  const iframeRun = vi.fn(() => {
    iframeRunState.active = true;
    iframeRunState.currentIndex = 0;
    iframeRunState.total = iframeTests || 0;
  });

  const parentLft = {
    runAllWithUI: parentRun,
    list: () => Array.from({ length: parentTests || 1 }, (_, i) => `parent ${i}`),
    _runState: parentRunState,
    _buildResults: () => 'parent results'
  };
  const iframeLft = {
    runAllWithUI: iframeRun,
    list: () => Array.from({ length: iframeTests || 0 }, (_, i) => `iframe ${i}`),
    _runState: iframeRunState,
    _buildResults: () => 'iframe results'
  };

  const iframe = iframeTests == null ? null : {
    contentWindow: { LexeraFrontendTests: iframeLft },
    contentDocument: { querySelector: () => null }
  };

  const document = {
    querySelector: () => null,
    querySelectorAll: (selector) => selector === 'iframe' && iframe ? [iframe] : [],
  };

  const window = {
    document,
    parent: null,
    console: { log() {}, warn() {}, error() {} },
    fetch: () => Promise.reject(new Error('network disabled')),
    MessageChannel: FakeMessageChannel,
    LexeraFrontendTests: parentLft,
    __TAURI__: {
      core: {
        invoke(command) {
          if (command === 'get_test_runner_config') {
            return Promise.resolve({
              auto_run: true,
              delay: 0,
              output: null,
              quit: false,
              filter: ''
            });
          }
          return Promise.resolve(null);
        }
      }
    }
  };
  window.parent = window;

  return {
    parentRun,
    iframeRun,
    sandbox: {
      window,
      document,
      console: window.console,
      Promise,
      Date,
      Error,
      MessageChannel: FakeMessageChannel,
      setTimeout: vi.fn((fn, ms) => {
        if (ms === 200) setImmediate(fn);
        return 1;
      }),
      clearTimeout: vi.fn()
    }
  };
}

describe('autoRunBootstrap', () => {
  it('starts tests from the Tauri test-runner config after the startup timer fires', async () => {
    const { sandbox, parentRun } = createSandbox({ parentTests: 2 });

    runInNewContext(source, sandbox, { filename: 'autoRunBootstrap.js' });

    expect(await waitFor(() => parentRun.mock.calls.length > 0)).toBe(true);
    expect(parentRun).toHaveBeenCalledWith({ autoRun: true, filter: '' });
  });

  it('runs the iframe test harness when it has the fuller suite', async () => {
    const { sandbox, parentRun, iframeRun } = createSandbox({ parentTests: 1, iframeTests: 3 });

    runInNewContext(source, sandbox, { filename: 'autoRunBootstrap.js' });

    expect(await waitFor(() => iframeRun.mock.calls.length > 0)).toBe(true);
    expect(parentRun).not.toHaveBeenCalled();
    expect(iframeRun).toHaveBeenCalledWith({ autoRun: true, filter: '' });
  });
});
