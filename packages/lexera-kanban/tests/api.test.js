import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

// ── Bootstrap ──────────────────────────────────────────────────────────────
// Load the IIFE with mocked globals so every test shares the same object.

let Api; // LexeraApi
const mockLexeraLog = vi.fn();
const mockLexeraLogWithTarget = vi.fn();

// Minimal EventSource mock
class MockEventSource {
  constructor(url) {
    this.url = url;
    this.onmessage = null;
    this.onerror = null;
  }
  close() {}
}

// Minimal WebSocket mock
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
  }
  send() {}
  close() {}
}
MockWebSocket.OPEN = 1;

// We need a fresh module for each describe block that touches internal state,
// but for pure URL-builder tests a shared instance is fine.
let mockFetch;

beforeAll(() => {
  mockFetch = vi.fn();

  Api = loadIIFE('api.js', 'LexeraApi', {
    window: { __TAURI_INTERNALS__: undefined },
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
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// mediaUrl — pure URL builder
// ═══════════════════════════════════════════════════════════════════════════

describe('mediaUrl', () => {
  it('builds a media URL from boardId and filename', () => {
    // baseUrl is null initially, so (baseUrl || '') produces ''
    const url = Api.mediaUrl('board-1', 'image.png');
    expect(url).toBe('/boards/board-1/media/image.png');
  });

  it('encodes special characters in filename', () => {
    const url = Api.mediaUrl('board-1', 'my file (1).png');
    expect(url).toBe('/boards/board-1/media/my%20file%20(1).png');
  });

  it('encodes unicode characters in filename', () => {
    const url = Api.mediaUrl('b1', 'bild-überblick.jpg');
    expect(url).toBe('/boards/b1/media/bild-%C3%BCberblick.jpg');
  });

  it('handles empty boardId', () => {
    const url = Api.mediaUrl('', 'photo.jpg');
    expect(url).toBe('/boards//media/photo.jpg');
  });

  it('handles filename with slashes', () => {
    const url = Api.mediaUrl('b1', 'sub/dir/file.png');
    expect(url).toBe('/boards/b1/media/sub%2Fdir%2Ffile.png');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fileUrl — pure URL builder
// ═══════════════════════════════════════════════════════════════════════════

describe('fileUrl', () => {
  it('builds a file URL from boardId and path', () => {
    const url = Api.fileUrl('board-1', 'docs/readme.md');
    expect(url).toBe('/boards/board-1/file?path=docs%2Freadme.md');
  });

  it('encodes special characters in path', () => {
    const url = Api.fileUrl('b1', 'path with spaces/file.txt');
    expect(url).toBe('/boards/b1/file?path=path%20with%20spaces%2Ffile.txt');
  });

  it('handles empty path', () => {
    const url = Api.fileUrl('b1', '');
    expect(url).toBe('/boards/b1/file?path=');
  });

  it('handles path with query-like characters', () => {
    const url = Api.fileUrl('b1', 'file?name=test&x=1');
    expect(url).toBe('/boards/b1/file?path=file%3Fname%3Dtest%26x%3D1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isSyncConnected / getSyncBoardId — state queries (initial state)
// ═══════════════════════════════════════════════════════════════════════════

describe('sync state queries (initial)', () => {
  it('isSyncConnected returns false when no sync is active', () => {
    expect(Api.isSyncConnected()).toBe(false);
  });

  it('getSyncBoardId returns null when no sync is active', () => {
    expect(Api.getSyncBoardId()).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sendSyncUpdate — returns false when not connected
// ═══════════════════════════════════════════════════════════════════════════

describe('sendSyncUpdate', () => {
  it('returns false when no WebSocket is connected', () => {
    expect(Api.sendSyncUpdate('some-data')).toBe(false);
  });

  it('returns false when updates is empty/null', () => {
    expect(Api.sendSyncUpdate('')).toBe(false);
    expect(Api.sendSyncUpdate(null)).toBe(false);
    expect(Api.sendSyncUpdate(undefined)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sendEditingPresence — returns false when not connected
// ═══════════════════════════════════════════════════════════════════════════

describe('sendEditingPresence', () => {
  it('returns false when no WebSocket is connected', () => {
    expect(Api.sendEditingPresence('card-1', 'Alice', 0, false)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// disconnectSync — safe to call when not connected
// ═══════════════════════════════════════════════════════════════════════════

describe('disconnectSync', () => {
  it('can be called safely when no sync is active', () => {
    expect(() => Api.disconnectSync()).not.toThrow();
    expect(Api.isSyncConnected()).toBe(false);
    expect(Api.getSyncBoardId()).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// connectSSE — returns null when baseUrl is not set
// ═══════════════════════════════════════════════════════════════════════════

describe('connectSSE', () => {
  it('returns null when baseUrl has not been discovered', () => {
    const result = Api.connectSSE(vi.fn());
    expect(result).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// connectLogStream — returns null when baseUrl is not set
// ═══════════════════════════════════════════════════════════════════════════

describe('connectLogStream', () => {
  it('returns null when baseUrl has not been discovered', () => {
    const result = Api.connectLogStream(vi.fn());
    expect(result).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// discover — port scanning behavior
// ═══════════════════════════════════════════════════════════════════════════

describe('discover', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when no backend responds', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));
    const result = await Api.discover();
    expect(result).toBe(null);
  });

  it('finds a backend on a scanned port', async () => {
    // All calls fail except for port 13080
    mockFetch.mockImplementation((url) => {
      if (url === 'http://localhost:13080/status') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'running', port: 13080 }),
        });
      }
      return Promise.reject(new Error('Connection refused'));
    });

    const result = await Api.discover();
    expect(result).toBe('http://localhost:13080');
  });

  it('returns cached baseUrl on subsequent calls', async () => {
    // After the previous test set baseUrl, discover should return it immediately
    mockFetch.mockClear();
    const result = await Api.discover();
    expect(result).toBe('http://localhost:13080');
    // fetch should not have been called because baseUrl is cached
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// mediaUrl and fileUrl with discovered baseUrl
// ═══════════════════════════════════════════════════════════════════════════

describe('mediaUrl with baseUrl set', () => {
  it('prepends the discovered baseUrl', () => {
    // After discover() succeeded above, baseUrl is 'http://localhost:13080'
    const url = Api.mediaUrl('b1', 'img.png');
    expect(url).toBe('http://localhost:13080/boards/b1/media/img.png');
  });
});

describe('fileUrl with baseUrl set', () => {
  it('prepends the discovered baseUrl', () => {
    const url = Api.fileUrl('b1', 'readme.md');
    expect(url).toBe('http://localhost:13080/boards/b1/file?path=readme.md');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// request — HTTP request behavior with mocked fetch
// ═══════════════════════════════════════════════════════════════════════════

describe('request', () => {
  it('makes a GET request and returns parsed JSON', async () => {
    const payload = { boards: ['a', 'b'] };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(payload),
    });

    const result = await Api.request('/boards');
    expect(result).toEqual(payload);
    // The call should have been made to baseUrl + path
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:13080/boards',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('defaults method to GET when not specified', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await Api.request('/test');
    const callArgs = mockFetch.mock.calls[0];
    // No explicit method in options means GET
    expect(callArgs[1].method).toBeUndefined();
  });

  it('throws on non-ok response with status text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: () => Promise.resolve('Resource not found'),
    });

    await expect(Api.request('/missing')).rejects.toThrow('404: Resource not found');
  });

  it('throws on non-ok response and falls back to statusText when text() fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.reject(new Error('stream error')),
    });

    await expect(Api.request('/broken')).rejects.toThrow('500: Internal Server Error');
  });

  it('throws when JSON parsing fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    });

    await expect(Api.request('/bad-json')).rejects.toThrow('Unexpected token');
  });

  it('passes custom method and headers through', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ saved: true }),
    });

    await Api.request('/boards/b1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test' }),
    });

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].method).toBe('PUT');
    expect(callArgs[1].headers['Content-Type']).toBe('application/json');
    expect(callArgs[1].body).toBe('{"title":"Test"}');
  });

  it('logs warnings for 4xx errors and errors for 5xx errors', async () => {
    // 4xx: should log as 'warn'
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: () => Promise.resolve('Invalid input'),
    });

    try { await Api.request('/bad'); } catch (e) { /* expected */ }
    expect(mockLexeraLogWithTarget).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('api.'),
      expect.stringContaining('failed')
    );

    mockLexeraLogWithTarget.mockClear();

    // 5xx: should log as 'error'
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: () => Promise.resolve('Down'),
    });

    try { await Api.request('/down'); } catch (e) { /* expected */ }
    expect(mockLexeraLogWithTarget).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('api.'),
      expect.stringContaining('failed')
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getBoards / getBoardColumns — thin wrappers over request
// ═══════════════════════════════════════════════════════════════════════════

describe('getBoards', () => {
  it('calls request with /boards', async () => {
    const boards = [{ id: 'b1', title: 'Board 1' }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(boards),
    });

    const result = await Api.getBoards();
    expect(result).toEqual(boards);
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:13080/boards');
  });
});

describe('getBoardColumns', () => {
  it('calls request with /boards/{id}/columns', async () => {
    const columns = [{ title: 'Todo' }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(columns),
    });

    const result = await Api.getBoardColumns('board-42');
    expect(result).toEqual(columns);
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:13080/boards/board-42/columns');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getBoardColumnsCached — ETag / 304 handling
// ═══════════════════════════════════════════════════════════════════════════

describe('getBoardColumnsCached', () => {
  it('sends If-None-Match header when version is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ columns: [] }),
    });

    await Api.getBoardColumnsCached('b1', 'v5');

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers['If-None-Match']).toBe('"v5"');
  });

  it('returns notModified: true on 304 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 304,
    });

    const result = await Api.getBoardColumnsCached('b1', 'v5');
    expect(result).toEqual({ notModified: true, version: 'v5' });
  });

  it('does not send If-None-Match when version is null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ columns: [] }),
    });

    await Api.getBoardColumnsCached('b1', null);

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers['If-None-Match']).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// addCard — POST with JSON body
// ═══════════════════════════════════════════════════════════════════════════

describe('addCard', () => {
  it('sends POST with content in JSON body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'card-1' }),
    });

    await Api.addCard('b1', 2, 'New task');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:13080/boards/b1/columns/2/cards');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ content: 'New task' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// search — query parameter building
// ═══════════════════════════════════════════════════════════════════════════

describe('search', () => {
  it('builds query params with just the query string', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    await Api.search('hello');

    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain('/search?');
    expect(url).toContain('q=hello');
  });

  it('includes regex and caseSensitive params when set', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    await Api.search('pattern.*', { regex: true, caseSensitive: true });

    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain('regex=true');
    expect(url).toContain('caseSensitive=true');
  });

  it('handles empty query string', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    await Api.search('');

    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain('q=');
  });

  it('handles null query string', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    await Api.search(null);

    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain('q=');
  });
});

describe('getCalendarTasks', () => {
  it('requests /calendar/tasks', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    const result = await Api.getCalendarTasks();

    expect(result).toEqual({ results: [] });
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:13080/calendar/tasks');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// saveBoard — PUT request
// ═══════════════════════════════════════════════════════════════════════════

describe('saveBoard', () => {
  it('sends PUT with board data as JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const boardData = { title: 'My Board', columns: [] };
    await Api.saveBoard('b1', boardData);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:13080/boards/b1');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual(boardData);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// saveBoardWithBase — POST with base and board data
// ═══════════════════════════════════════════════════════════════════════════

describe('saveBoardWithBase', () => {
  it('sends POST with baseBoard and board in JSON body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const base = { version: 1 };
    const board = { version: 2 };
    await Api.saveBoardWithBase('b1', base, board);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:13080/boards/b1/sync-save');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ baseBoard: base, board: board });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// addBoard / removeBoard — board management
// ═══════════════════════════════════════════════════════════════════════════

describe('addBoard', () => {
  it('sends POST with file path in JSON body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'new-board' }),
    });

    await Api.addBoard('/path/to/board.md');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:13080/boards');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ file: '/path/to/board.md' });
  });
});

describe('removeBoard', () => {
  it('sends DELETE to /boards/{id}', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await Api.removeBoard('b1');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:13080/boards/b1');
    expect(opts.method).toBe('DELETE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// checkStatus — returns boolean
// ═══════════════════════════════════════════════════════════════════════════

describe('checkStatus', () => {
  it('returns true when backend responds ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await Api.checkStatus();
    expect(result).toBe(true);
  });

  it('returns false when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('refused'));

    const result = await Api.checkStatus();
    expect(result).toBe(false);
  });

  it('returns false when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const result = await Api.checkStatus();
    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Collaboration API URL construction
// ═══════════════════════════════════════════════════════════════════════════

describe('collaboration API helpers', () => {
  it('getMe calls /collab/me', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user_id: 'u1', name: 'Alice' }),
    });

    await Api.getMe();
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:13080/collab/me');
  });

  it('updateMe sends PUT to /collab/me with name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await Api.updateMe('Bob');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:13080/collab/me');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ name: 'Bob' });
  });

  it('createInvite sends POST with role and encodes userId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: 'abc' }),
    });

    await Api.createInvite('b1', 'user@test', 'editor', 5);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/collab/rooms/b1/invites?user=user%40test');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.role).toBe('editor');
    expect(body.max_uses).toBe(5);
  });

  it('createInvite omits max_uses when not positive', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: 'abc' }),
    });

    await Api.createInvite('b1', 'u1', 'viewer', 0);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_uses).toBeUndefined();
  });

  it('acceptInvite sends POST with token and userId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ board_id: 'b1' }),
    });

    await Api.acceptInvite('token-xyz', 'u1');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/collab/invites/token-xyz/accept?user=u1');
    expect(opts.method).toBe('POST');
  });

  it('listMembers sends GET with userId encoded', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await Api.listMembers('b1', 'user with spaces');

    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain('/collab/rooms/b1/members?user=user');
    // URLSearchParams may encode spaces as + or %20; just verify it's present
    expect(url).toMatch(/user(%20|\+)with(%20|\+)spaces/);
  });

  it('makePublic sends POST with defaultRole and maxUsers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await Api.makePublic('b1', 'u1', 'viewer', 10);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.default_role).toBe('viewer');
    expect(body.max_users).toBe(10);
  });

  it('makePublic sends null max_users when not provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await Api.makePublic('b1', 'u1', 'editor');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_users).toBe(null);
  });

  it('makePrivate sends DELETE', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await Api.makePrivate('b1', 'u1');

    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Live sync session API
// ═══════════════════════════════════════════════════════════════════════════

describe('live sync session API', () => {
  it('openLiveSyncSession sends POST to /boards/{id}/live-sync/open', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ session_id: 'sess-1' }),
    });

    await Api.openLiveSyncSession('b1');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:13080/boards/b1/live-sync/open');
    expect(opts.method).toBe('POST');
  });

  it('applyLiveSyncBoard sends POST with board data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const boardData = { columns: [] };
    await Api.applyLiveSyncBoard('sess-1', boardData);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/live-sync/sess-1/apply');
    expect(JSON.parse(opts.body)).toEqual({ board: boardData });
  });

  it('importLiveSyncUpdates sends POST with updates', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await Api.importLiveSyncUpdates('sess-1', 'update-data');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.updates).toBe('update-data');
  });

  it('importLiveSyncUpdates uses empty string when updates is null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await Api.importLiveSyncUpdates('sess-1', null);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.updates).toBe('');
  });

  it('closeLiveSyncSession sends DELETE with encoded sessionId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await Api.closeLiveSyncSession('sess/special');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/live-sync/sess%2Fspecial');
    expect(opts.method).toBe('DELETE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// connectSSE — with baseUrl set (after discover)
// ═══════════════════════════════════════════════════════════════════════════

describe('connectSSE (with baseUrl)', () => {
  it('creates an EventSource pointing to /events', () => {
    const onEvent = vi.fn();
    const es = Api.connectSSE(onEvent);
    expect(es).not.toBe(null);
    expect(es.url).toBe('http://localhost:13080/events');
  });

  it('calls onEvent with parsed JSON on message', () => {
    const onEvent = vi.fn();
    const es = Api.connectSSE(onEvent);

    // Simulate a message
    es.onmessage({ data: '{"type":"board_changed","boardId":"b1"}' });
    expect(onEvent).toHaveBeenCalledWith({ type: 'board_changed', boardId: 'b1' });
  });

  it('does not throw on invalid JSON message', () => {
    const onEvent = vi.fn();
    const es = Api.connectSSE(onEvent);

    expect(() => es.onmessage({ data: 'not json' })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('does not throw on error event', () => {
    const onEvent = vi.fn();
    const es = Api.connectSSE(onEvent);

    expect(() => es.onerror(new Event('error'))).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// connectLogStream — with baseUrl set (after discover)
// ═══════════════════════════════════════════════════════════════════════════

describe('connectLogStream (with baseUrl)', () => {
  it('creates an EventSource pointing to /logs/stream', () => {
    const onEntry = vi.fn();
    const es = Api.connectLogStream(onEntry);
    expect(es).not.toBe(null);
    expect(es.url).toBe('http://localhost:13080/logs/stream');
  });

  it('calls onEntry with parsed JSON on message', () => {
    const onEntry = vi.fn();
    const es = Api.connectLogStream(onEntry);

    es.onmessage({ data: '{"level":"info","message":"test"}' });
    expect(onEntry).toHaveBeenCalledWith({ level: 'info', message: 'test' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatApiError — tested indirectly via logApiIssue paths
// ═══════════════════════════════════════════════════════════════════════════

describe('formatApiError (indirect via log stream error handler)', () => {
  it('handles an Event-like object on log stream error without throwing', () => {
    // Use connectLogStream instead of connectSSE to get a different dedupeKey
    // that has not been triggered by earlier tests
    const es = Api.connectLogStream(vi.fn());
    mockLexeraLogWithTarget.mockClear();
    // Simulate an error event (plain object, not an Error instance)
    expect(() => es.onerror({ type: 'error' })).not.toThrow();
    // logApiIssue calls lexeraLogWithTarget internally; the dedupeKey
    // for log stream errors is 'api.logs.stream.error' which differs from
    // the SSE one, so it should fire if not recently triggered.
    // If dedupe suppresses it (from earlier connectLogStream tests),
    // we at least verify no crash occurred.
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Remote board and connection helpers
// ═══════════════════════════════════════════════════════════════════════════

describe('remote board and connection helpers', () => {
  it('getRemoteBoards calls /remote-boards', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await Api.getRemoteBoards();
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:13080/remote-boards');
  });

  it('connectRemote sends POST with server_url and token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ board_id: 'remote-b1' }),
    });

    await Api.connectRemote('https://remote.example.com', 'my-token');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.server_url).toBe('https://remote.example.com');
    expect(body.token).toBe('my-token');
  });

  it('disconnectRemote sends DELETE to /collab/connect/{localBoardId}', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await Api.disconnectRemote('local-b1');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:13080/collab/connect/local-b1');
    expect(opts.method).toBe('DELETE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Board settings
// ═══════════════════════════════════════════════════════════════════════════

describe('board settings', () => {
  it('getBoardSettings calls GET /boards/{id}/settings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ autoSave: true }),
    });

    const result = await Api.getBoardSettings('b1');
    expect(result).toEqual({ autoSave: true });
    expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:13080/boards/b1/settings');
  });

  it('updateBoardSettings sends PUT with settings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await Api.updateBoardSettings('b1', { autoSave: false });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:13080/boards/b1/settings');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ autoSave: false });
  });
});
