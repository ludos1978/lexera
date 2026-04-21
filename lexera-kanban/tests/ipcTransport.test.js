// Gap #10 from IPC-Migration-Plan.md: unit tests for the IPC transport
// helpers inside LexeraApi. Mocks Tauri's `__TAURI_INTERNALS__.invoke` and
// verifies:
//   - getTransportMode() resolves to `local-ipc` when Tauri is present
//     and ignores a `LEXERA_TRANSPORT=http` override on desktop
//   - LexeraApi.request() routes through invoke('backend_ipc_request')
//     with a correctly-shaped argument
//   - LexeraApi.mediaUrl / fileUrl return lexera-asset:// URLs in IPC mode
//   - LexeraApi.backendIpcStatus invokes backend_ipc_status
//
// No real IPC socket is opened — the goal is to cover the JS side of the
// transport contract, not the Rust handshake (the crate's integration
// tests already cover that end-to-end).

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

describe('LexeraApi IPC transport (Tauri desktop mode)', () => {
  let Api;
  let mockInvoke;
  let mockChannelCtor;

  beforeAll(() => {
    mockInvoke = vi.fn();
    // Minimal mock of Tauri's Channel: onmessage property; constructor
    // returns an object compatible with the serializer Tauri uses.
    mockChannelCtor = vi.fn(function () {
      this.onmessage = null;
      this.id = Math.random();
    });

    Api = loadIIFE('api.js', 'LexeraApi', {
      window: {
        __TAURI_INTERNALS__: { invoke: mockInvoke },
        __TAURI__: { core: { invoke: mockInvoke, Channel: mockChannelCtor } },
        LEXERA_TRANSPORT: 'http', // deliberately set; Tauri mode must ignore.
      },
      fetch: vi.fn(),
      EventSource: class {},
      WebSocket: class {},
      lexeraLog: vi.fn(),
      lexeraLogWithTarget: vi.fn(),
      AbortSignal: globalThis.AbortSignal,
      AbortController: globalThis.AbortController,
      FormData: globalThis.FormData,
      Response: globalThis.Response,
      URLSearchParams: globalThis.URLSearchParams,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      Date: globalThis.Date,
      JSON: globalThis.JSON,
      Math: globalThis.Math,
      Object: globalThis.Object,
      String: globalThis.String,
      Array: globalThis.Array,
      Error: globalThis.Error,
      TextDecoder: globalThis.TextDecoder,
      TextEncoder: globalThis.TextEncoder,
      console: globalThis.console,
      Promise: globalThis.Promise,
    });
  });

  beforeEach(() => {
    mockInvoke.mockReset();
    // Default: any invoke call returns a harmless 200 shape. Individual
    // tests override via mockImplementationOnce below when they need to
    // assert on a specific response.
    mockInvoke.mockImplementation(() =>
      Promise.resolve({ status: 200, headers: [], body: '{}' })
    );
    Api._resetTestState?.();
  });

  it('transport mode resolves to local-ipc under Tauri', () => {
    expect(Api.getTransportMode()).toBe('local-ipc');
  });

  it('ignores LEXERA_TRANSPORT=http override on desktop (Phase 7 pin)', () => {
    // Even though window.LEXERA_TRANSPORT = 'http' was set during setup,
    // Tauri-mode resolution must win. Covered by the transport mode check
    // above — explicit here for documentation.
    expect(Api.getTransportMode()).not.toBe('http');
  });

  it('mediaUrl returns a lexera-asset:// URL with encoded params', () => {
    const url = Api.mediaUrl('board-abc', 'my photo.png');
    expect(url).toMatch(/^lexera-asset:\/\/localhost\/\?/);
    expect(url).toContain('b=board-abc');
    expect(url).toContain('k=m');
    expect(url).toContain('v=my%20photo.png');
  });

  it('fileUrl returns a lexera-asset:// URL with kind=f', () => {
    const url = Api.fileUrl('board-abc', 'sub/dir/file.md');
    expect(url).toMatch(/^lexera-asset:\/\/localhost\/\?/);
    expect(url).toContain('k=f');
    expect(url).toContain('v=sub%2Fdir%2Ffile.md');
  });

  it('mediaUrl never contains auth_token in IPC mode', () => {
    // Phase 4 invariant: asset URLs must not carry bearer tokens.
    Api._setTestToken?.('test-bearer-token');
    const url = Api.mediaUrl('board-abc', 'photo.png');
    expect(url).not.toContain('auth_token');
    expect(url).not.toContain('test-bearer-token');
  });

  it('request() dispatches through backend_ipc_request', async () => {
    // Note: `ensureBearerToken` also uses transportFetch, so `/collab/me`
    // may fire first. Filter for the call we care about.
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'backend_ipc_request' && args?.arg?.uri === '/status') {
        return Promise.resolve({
          status: 200,
          headers: [['content-type', 'application/json']],
          body: JSON.stringify({ status: 'running' }),
        });
      }
      return Promise.resolve({ status: 200, headers: [], body: '{}' });
    });
    const result = await Api.request('/status');
    const statusCall = mockInvoke.mock.calls.find(
      (c) => c[0] === 'backend_ipc_request' && c[1]?.arg?.uri === '/status'
    );
    expect(statusCall).toBeDefined();
    expect(statusCall[1].arg.method).toBe('GET');
    expect(result).toEqual({ status: 'running' });
  });

  it('request() POST carries JSON body through the IPC arg', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'backend_ipc_request') {
        return Promise.resolve({
          status: 200,
          headers: [['content-type', 'application/json']],
          body: '{"ok":true}',
        });
      }
      return Promise.resolve({ status: 200, headers: [], body: '{}' });
    });
    await Api.request('/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    const ipcCall = mockInvoke.mock.calls.find(
      (c) => c[0] === 'backend_ipc_request' && c[1].arg.uri === '/echo'
    );
    expect(ipcCall).toBeDefined();
    expect(ipcCall[1].arg.method).toBe('POST');
    expect(ipcCall[1].arg.body).toBe('{"hello":"world"}');
    expect(ipcCall[1].arg.headers).toEqual(
      expect.arrayContaining([['Content-Type', 'application/json']])
    );
  });

  it('non-2xx IPC response is surfaced as a thrown Error with status', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'backend_ipc_request' && args?.arg?.uri === '/missing') {
        return Promise.resolve({
          status: 404,
          headers: [],
          body: '{"error":"Not found"}',
        });
      }
      return Promise.resolve({ status: 200, headers: [], body: '{}' });
    });
    await expect(Api.request('/missing')).rejects.toThrowError(/404/);
  });

  it('backendIpcStatus invokes the corresponding Tauri command', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'backend_ipc_status') {
        return Promise.resolve({ state: 'connected', pid: 1234, endpoint: '/tmp/ipc.sock' });
      }
      return Promise.resolve({ status: 200, headers: [], body: '{}' });
    });
    const status = await Api.backendIpcStatus();
    expect(mockInvoke).toHaveBeenCalledWith('backend_ipc_status');
    expect(status.state).toBe('connected');
    expect(status.pid).toBe(1234);
  });
});

describe('LexeraApi IPC transport (browser/dev mode — no Tauri)', () => {
  let Api;
  let mockFetch;

  beforeAll(() => {
    mockFetch = vi.fn();
    Api = loadIIFE('api.js', 'LexeraApi', {
      window: {
        __TAURI_INTERNALS__: undefined,
        __TAURI__: undefined,
        LexeraBackendDiscovery: { discoverBackend: async () => 'http://127.0.0.1:13080' },
      },
      fetch: mockFetch,
      EventSource: class {},
      WebSocket: class {},
      lexeraLog: vi.fn(),
      lexeraLogWithTarget: vi.fn(),
      AbortSignal: globalThis.AbortSignal,
      AbortController: globalThis.AbortController,
      FormData: globalThis.FormData,
      Response: globalThis.Response,
      URLSearchParams: globalThis.URLSearchParams,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      Date: globalThis.Date,
      JSON: globalThis.JSON,
      Math: globalThis.Math,
      Object: globalThis.Object,
      String: globalThis.String,
      Array: globalThis.Array,
      Error: globalThis.Error,
      console: globalThis.console,
      Promise: globalThis.Promise,
    });
  });

  it('transport mode resolves to http outside Tauri', () => {
    expect(Api.getTransportMode()).toBe('http');
  });

  it('mediaUrl builds an HTTP URL (not lexera-asset://) in browser mode', () => {
    Api._setTestToken?.('bearer-xyz');
    const url = Api.mediaUrl('board-1', 'photo.png');
    // HTTP path uses absolute /boards/... plus appended auth_token query.
    expect(url).toMatch(/\/boards\/board-1\/media\/photo\.png/);
    expect(url).toContain('auth_token=bearer-xyz');
    expect(url).not.toContain('lexera-asset://');
  });
});
