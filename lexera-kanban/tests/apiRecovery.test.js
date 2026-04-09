import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createApiHarness() {
  const mockFetch = vi.fn();
  const mockDiscoverBackend = vi.fn();
  const mockLexeraLog = vi.fn();
  const mockLexeraLogWithTarget = vi.fn();

  class MockEventSource {
    constructor(url) {
      this.url = url;
    }
    addEventListener() {}
    close() {}
  }

  class MockWebSocket {
    constructor(url) {
      this.url = url;
    }
    close() {}
    send() {}
  }
  MockWebSocket.OPEN = 1;

  const Api = loadIIFE('api.js', 'LexeraApi', {
    window: {
      __TAURI_INTERNALS__: undefined,
      LexeraBackendDiscovery: {
        discoverBackend: mockDiscoverBackend,
      },
    },
    fetch: mockFetch,
    EventSource: MockEventSource,
    WebSocket: MockWebSocket,
    lexeraLog: mockLexeraLog,
    lexeraLogWithTarget: mockLexeraLogWithTarget,
    AbortSignal: globalThis.AbortSignal,
    AbortController: globalThis.AbortController,
    FormData: globalThis.FormData,
    URLSearchParams: globalThis.URLSearchParams,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    Date: globalThis.Date,
    JSON: globalThis.JSON,
    Math: globalThis.Math,
    Object: globalThis.Object,
    String: globalThis.String,
    Error: globalThis.Error,
    console: globalThis.console,
    CustomEvent: globalThis.CustomEvent,
  });

  Api._resetTestState();

  return {
    Api,
    mockFetch,
    mockDiscoverBackend,
    mockLexeraLogWithTarget,
  };
}

function jsonTextResponse(value) {
  return {
    ok: true,
    text: () => Promise.resolve(JSON.stringify(value)),
  };
}

describe('LexeraApi recovery', () => {
  let harness;

  beforeEach(() => {
    harness = createApiHarness();
  });

  it('re-discovers the backend after a transport failure and retries once', async () => {
    const { Api, mockFetch, mockDiscoverBackend } = harness;
    Api._setTestBaseUrl('http://localhost:13080');
    Api._setTestToken('stale-token');
    mockDiscoverBackend.mockResolvedValue('http://localhost:14080');

    mockFetch
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'fresh-token' }),
      })
      .mockResolvedValueOnce(jsonTextResponse({ boards: ['recovered'] }));

    const result = await Api.request('/boards');

    expect(result).toEqual({ boards: ['recovered'] });
    expect(mockDiscoverBackend).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:13080/boards');
    expect(mockFetch.mock.calls[1][0]).toBe('http://localhost:14080/collab/me');
    expect(mockFetch.mock.calls[2][0]).toBe('http://localhost:14080/boards');
    expect(mockFetch.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh-token');
  });

  it('re-discovers the backend after an invalid JSON success body', async () => {
    const { Api, mockFetch, mockDiscoverBackend, mockLexeraLogWithTarget } = harness;
    Api._setTestBaseUrl('http://localhost:13080');
    Api._setTestToken('stale-token');
    mockDiscoverBackend.mockResolvedValue('http://localhost:14080');

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html>bad gateway</html>'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'fresh-token' }),
      })
      .mockResolvedValueOnce(jsonTextResponse({ ok: true }));

    const result = await Api.request('/dashboard/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'test' }),
    });

    expect(result).toEqual({ ok: true });
    expect(mockFetch.mock.calls[2][0]).toBe('http://localhost:14080/dashboard/data');
    expect(mockLexeraLogWithTarget).toHaveBeenCalledWith(
      'warn',
      'api.api.request',
      expect.stringContaining('returned invalid JSON')
    );
  });

  it('refreshes the bearer token after a 401 response and retries once', async () => {
    const { Api, mockFetch, mockDiscoverBackend } = harness;
    Api._setTestBaseUrl('http://localhost:13080');
    Api._setTestToken('stale-token');
    mockDiscoverBackend.mockResolvedValue('http://localhost:13080');

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('{"error":"Invalid token"}'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'fresh-token' }),
      })
      .mockResolvedValueOnce(jsonTextResponse({ items: ['ok'] }));

    const result = await Api.request('/remote-boards');

    expect(result).toEqual({ items: ['ok'] });
    expect(mockDiscoverBackend).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh-token');
  });
});
