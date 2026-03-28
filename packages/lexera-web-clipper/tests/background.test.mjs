import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBackgroundBundle } from './helpers/load-background-bundle.mjs';

function jsonResponse(
  payload,
  ok = true,
  status = ok ? 200 : 500,
  statusText = ok ? 'OK' : 'Internal Server Error',
) {
  const body = JSON.stringify(payload);
  return {
    ok,
    status,
    statusText,
    async text() {
      return body;
    },
    async json() {
      return payload;
    },
  };
}

function textResponse(body, status = 500, statusText = 'Internal Server Error') {
  return {
    ok: false,
    status,
    statusText,
    async text() {
      return body;
    },
  };
}

test('popup load keeps the configured backend URL separate from the resolved live connection', async () => {
  const requests = [];
  const bundle = loadBackgroundBundle({
    initialClipperState: {
      backendUrl: 'http://preferred.local:9999',
      rememberTarget: true,
      mode: 'page',
      target: {
        boardId: 'board-1',
        source: 'saved',
      },
    },
    fetchImpl: async (url, init) => {
      requests.push({
        url,
        authorization: init?.headers?.authorization || '',
      });
      switch (url) {
        case 'http://preferred.local:9999/status':
          return jsonResponse({}, false);
        case 'http://127.0.0.1:13080/status':
          return jsonResponse({ status: 'running' });
        case 'http://127.0.0.1:13080/collab/me':
          return jsonResponse({
            id: 'user-1',
            name: 'Clipper',
            token: 'token-123',
          });
        case 'http://127.0.0.1:13080/boards':
          assert.equal(init?.headers?.authorization, 'Bearer token-123');
          return jsonResponse({
            boards: [
              {
                id: 'board-1',
                title: 'Board 1',
                workspaceIds: ['workspace-1'],
                columns: [{ index: 0, title: 'Inbox' }],
              },
            ],
          });
        case 'http://127.0.0.1:13080/config/workspaces':
          assert.equal(init?.headers?.authorization, 'Bearer token-123');
          return jsonResponse({
            workspaces: [{ id: 'workspace-1', name: 'Workspace 1' }],
            default_workspace: 'workspace-1',
          });
        case 'http://127.0.0.1:13080/boards/board-1/columns':
          assert.equal(init?.headers?.authorization, 'Bearer token-123');
          return jsonResponse({
            columns: [{ index: 0, title: 'Inbox' }],
            fullBoard: null,
          });
        default:
          throw new Error(`Unexpected fetch URL: ${url}`);
      }
    },
  });

  const response = await bundle.invokeMessage({ type: 'popup/load' });

  assert.equal(response.ok, true);
  assert.equal(response.configuredBackendUrl, 'http://preferred.local:9999');
  assert.equal(response.resolvedBackendUrl, 'http://127.0.0.1:13080');
  assert.equal(response.rememberTarget, true);
  assert.equal(response.mode, 'page');
  assert.deepEqual(bundle.readStoredState(), {
    backendUrl: 'http://preferred.local:9999',
    rememberTarget: true,
    mode: 'page',
    target: {
      boardId: 'board-1',
      source: 'saved',
    },
  });
  assert.deepEqual(requests.map((entry) => entry.url), [
    'http://preferred.local:9999/status',
    'http://127.0.0.1:13080/status',
    'http://127.0.0.1:13080/collab/me',
    'http://127.0.0.1:13080/boards',
    'http://127.0.0.1:13080/config/workspaces',
    'http://127.0.0.1:13080/boards/board-1/columns',
  ]);
});

test('saving settings can clear the remembered target and stored backend URL', async () => {
  const bundle = loadBackgroundBundle({
    initialClipperState: {
      backendUrl: 'http://preferred.local:9999',
      rememberTarget: true,
      mode: 'article',
      target: {
        boardId: 'board-1',
        source: 'saved',
      },
    },
  });

  const response = await bundle.invokeMessage({
    type: 'popup/save-settings',
    backendUrl: '',
    rememberTarget: false,
  });

  assert.deepEqual(response, {
    ok: true,
    configuredBackendUrl: '',
    rememberTarget: false,
  });
  assert.deepEqual(bundle.readStoredState(), {
    mode: 'article',
    rememberTarget: false,
  });
});

test('popup load ignores stale stored targets when rememberTarget is disabled', async () => {
  const requests = [];
  const bundle = loadBackgroundBundle({
    initialClipperState: {
      rememberTarget: false,
      target: {
        boardId: 'stale-board',
        source: 'saved',
      },
    },
    fetchImpl: async (url, init) => {
      requests.push(url);
      switch (url) {
        case 'http://127.0.0.1:13080/status':
          return jsonResponse({ status: 'running' });
        case 'http://127.0.0.1:13080/collab/me':
          return jsonResponse({
            id: 'user-1',
            name: 'Clipper',
            token: 'token-123',
          });
        case 'http://127.0.0.1:13080/boards':
          assert.equal(init?.headers?.authorization, 'Bearer token-123');
          return jsonResponse({
            boards: [
              {
                id: 'board-1',
                title: 'Board 1',
                workspaceIds: ['workspace-1'],
                columns: [{ index: 0, title: 'Inbox' }],
              },
            ],
          });
        case 'http://127.0.0.1:13080/config/workspaces':
          assert.equal(init?.headers?.authorization, 'Bearer token-123');
          return jsonResponse({
            workspaces: [{ id: 'workspace-1', name: 'Workspace 1' }],
            default_workspace: 'workspace-1',
          });
        case 'http://127.0.0.1:13080/boards/board-1/columns':
          assert.equal(init?.headers?.authorization, 'Bearer token-123');
          return jsonResponse({
            columns: [{ index: 0, title: 'Inbox' }],
            fullBoard: null,
          });
        default:
          throw new Error(`Unexpected fetch URL: ${url}`);
      }
    },
  });

  const response = await bundle.invokeMessage({ type: 'popup/load' });

  assert.equal(response.ok, true);
  assert.equal(response.rememberTarget, false);
  assert.deepEqual(response.target, {
    boardId: 'board-1',
    boardTitle: 'Board 1',
    source: 'fallback',
  });
  assert.equal(requests.includes('http://127.0.0.1:13080/status'), true);
  assert.equal(requests.includes('http://127.0.0.1:13080/collab/me'), true);
  assert.equal(requests.includes('http://127.0.0.1:13080/boards'), true);
  assert.equal(requests.includes('http://127.0.0.1:13080/config/workspaces'), true);
  assert.equal(requests.includes('http://127.0.0.1:13080/boards/board-1/columns'), true);
  assert.equal(requests.some((url) => url.includes('stale-board')), false);
});

test('popup load works with promise-style browser APIs', async () => {
  const bundle = loadBackgroundBundle({
    apiStyle: 'promise',
    initialClipperState: {
      backendUrl: 'http://preferred.local:9999',
    },
    fetchImpl: async (url, init) => {
      switch (url) {
        case 'http://preferred.local:9999/status':
          return jsonResponse({}, false);
        case 'http://127.0.0.1:13080/status':
          return jsonResponse({ status: 'running' });
        case 'http://127.0.0.1:13080/collab/me':
          return jsonResponse({
            id: 'user-1',
            name: 'Clipper',
            token: 'token-123',
          });
        case 'http://127.0.0.1:13080/boards':
          assert.equal(init?.headers?.authorization, 'Bearer token-123');
          return jsonResponse({
            boards: [
              {
                id: 'board-1',
                title: 'Board 1',
                workspaceIds: ['workspace-1'],
                columns: [{ index: 0, title: 'Inbox' }],
              },
            ],
          });
        case 'http://127.0.0.1:13080/config/workspaces':
          assert.equal(init?.headers?.authorization, 'Bearer token-123');
          return jsonResponse({
            workspaces: [{ id: 'workspace-1', name: 'Workspace 1' }],
            default_workspace: 'workspace-1',
          });
        case 'http://127.0.0.1:13080/boards/board-1/columns':
          assert.equal(init?.headers?.authorization, 'Bearer token-123');
          return jsonResponse({
            columns: [{ index: 0, title: 'Inbox' }],
            fullBoard: null,
          });
        default:
          throw new Error(`Unexpected fetch URL: ${url}`);
      }
    },
  });

  const response = await bundle.invokeMessage({ type: 'popup/load' });

  assert.equal(response.ok, true);
  assert.equal(response.resolvedBackendUrl, 'http://127.0.0.1:13080');
});

test('popup load succeeds against protected board routes by using the backend auth token', async () => {
  const bundle = loadBackgroundBundle({
    fetchImpl: async (url, init) => {
      switch (url) {
        case 'http://127.0.0.1:13080/status':
          return jsonResponse({ status: 'running' });
        case 'http://127.0.0.1:13080/collab/me':
          return jsonResponse({
            id: 'user-1',
            name: 'Clipper',
            token: 'token-123',
          });
        case 'http://127.0.0.1:13080/boards':
          if (init?.headers?.authorization !== 'Bearer token-123') {
            return textResponse('{"error":"Unauthorized"}', 401, 'Unauthorized');
          }
          return jsonResponse({
            boards: [
              {
                id: 'board-1',
                title: 'Board 1',
                workspaceIds: ['workspace-1'],
                columns: [{ index: 0, title: 'Inbox' }],
              },
            ],
          });
        case 'http://127.0.0.1:13080/config/workspaces':
          if (init?.headers?.authorization !== 'Bearer token-123') {
            return textResponse('{"error":"Unauthorized"}', 401, 'Unauthorized');
          }
          return jsonResponse({
            workspaces: [{ id: 'workspace-1', name: 'Workspace 1' }],
            default_workspace: 'workspace-1',
          });
        case 'http://127.0.0.1:13080/boards/board-1/columns':
          if (init?.headers?.authorization !== 'Bearer token-123') {
            return textResponse('{"error":"Unauthorized"}', 401, 'Unauthorized');
          }
          return jsonResponse({
            columns: [{ index: 0, title: 'Inbox' }],
            fullBoard: null,
          });
        default:
          throw new Error(`Unexpected fetch URL: ${url}`);
      }
    },
  });

  const response = await bundle.invokeMessage({ type: 'popup/load' });

  assert.equal(response.ok, true);
  assert.equal(response.resolvedBackendUrl, 'http://127.0.0.1:13080');
  assert.equal(response.boards[0].id, 'board-1');
});

test('capture writes use the backend auth token on protected routes', async () => {
  const requests = [];
  const bundle = loadBackgroundBundle({
    initialClipperState: {
      backendUrl: 'http://127.0.0.1:13080',
      rememberTarget: true,
    },
    fetchImpl: async (url, init) => {
      requests.push({
        url,
        method: init?.method || 'GET',
        authorization: init?.headers?.authorization || '',
      });
      switch (url) {
        case 'http://127.0.0.1:13080/status':
          return jsonResponse({ status: 'running' });
        case 'http://127.0.0.1:13080/collab/me':
          return jsonResponse({
            id: 'user-1',
            name: 'Clipper',
            token: 'token-123',
          });
        case 'http://127.0.0.1:13080/boards/board-1/columns/0/cards':
          assert.equal(init?.method, 'POST');
          assert.equal(init?.headers?.authorization, 'Bearer token-123');
          return jsonResponse({ ok: true });
        default:
          throw new Error(`Unexpected fetch URL: ${url}`);
      }
    },
  });

  const response = await bundle.invokeMessage({
    type: 'popup/capture',
    mode: 'article',
    rememberTarget: true,
    target: {
      boardId: 'board-1',
      colIndex: 0,
    },
    context: {
      url: 'https://example.com/article',
      title: 'Example Article',
      sourceType: 'website',
      sourceLabel: 'Website',
      capturedAt: '2026-03-27T00:00:00.000Z',
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(requests.map((entry) => `${entry.method} ${entry.url}`), [
    'GET http://127.0.0.1:13080/status',
    'GET http://127.0.0.1:13080/collab/me',
    'POST http://127.0.0.1:13080/boards/board-1/columns/0/cards',
  ]);
});

test('test connection verifies both backend status and auth availability', async () => {
  const bundle = loadBackgroundBundle({
    fetchImpl: async (url) => {
      switch (url) {
        case 'http://127.0.0.1:13080/status':
          return jsonResponse({ status: 'running' });
        case 'http://127.0.0.1:13080/collab/me':
          return jsonResponse({
            id: 'user-1',
            name: 'Clipper',
            token: 'token-123',
          });
        default:
          throw new Error(`Unexpected fetch URL: ${url}`);
      }
    },
  });

  const response = await bundle.invokeMessage({
    type: 'popup/test-connection',
    backendUrl: 'http://127.0.0.1:13080',
  });

  assert.deepEqual(response, {
    ok: true,
    configuredBackendUrl: 'http://127.0.0.1:13080',
    resolvedBackendUrl: 'http://127.0.0.1:13080',
    details: '',
    usedFallback: false,
  });
});

test('test connection returns failure details including the backend response body', async () => {
  const customUrl = 'http://bad.example:13080';
  const bundle = loadBackgroundBundle({
    fetchImpl: async (url) => {
      if (url === `${customUrl}/status`) {
        return textResponse('{"error":"boom"}');
      }
      return textResponse('not here', 404, 'Not Found');
    },
  });

  const response = await bundle.invokeMessage({
    type: 'popup/test-connection',
    backendUrl: customUrl,
  });

  assert.equal(response.ok, false);
  assert.equal(response.error, `Could not connect to ${customUrl}`);
  assert.equal(response.details.includes(`${customUrl}: HTTP 500 Internal Server Error`), true);
  assert.equal(response.details.includes('{"error":"boom"}'), true);
});
