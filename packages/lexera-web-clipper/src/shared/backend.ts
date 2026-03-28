import {
  WebClipperTarget,
  buildLexeraBackendCandidates,
  discoverLexeraBackend,
  normalizeLexeraBackendBaseUrl,
  prependIncomingCaptureTag,
  resolveLexeraBackendStatusBaseUrl,
} from '@ludos/shared';
import { getLocalStorage, setLocalStorage } from './browser';

const STORAGE_KEY = 'lexeraWebClipperState';

export interface ClipperState {
  backendUrl?: string;
  target?: WebClipperTarget;
  mode?: string;
  rememberTarget?: boolean;
}

export interface BackendBoardSummary {
  id: string;
  title: string;
  filePath?: string;
  file_path?: string;
  workspaceIds?: string[];
  workspace_ids?: string[];
  columns?: BackendColumnSummary[];
}

export interface BackendWorkspaceSummary {
  id: string;
  name: string;
  board_count?: number;
}

export interface BackendColumnSummary {
  index: number;
  title: string;
  id?: string;
}

export interface BackendBoardTargetData {
  columns: BackendColumnSummary[];
  fullBoard?: any;
}

export interface BackendSearchResult {
  boardId: string;
  boardTitle: string;
  columnIndex: number;
  columnTitle: string;
  cardId: string;
  cardContent: string;
}

export interface BackendConnectionTestResult {
  ok: boolean;
  configuredBackendUrl: string;
  resolvedBackendUrl: string;
  error?: string;
  details?: string;
  usedFallback?: boolean;
}

function normalizeBaseUrl(value: string): string {
  return normalizeLexeraBackendBaseUrl(value);
}

const authTokenCache = new Map<string, Promise<string>>();

function normalizeResponseText(responseText: string): string {
  return String(responseText || '').trim();
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [String(key), String(value)]));
  }
  if (typeof (headers as { forEach?: unknown }).forEach === 'function') {
    const record: Record<string, string> = {};
    (headers as { forEach: (cb: (value: string, key: string) => void) => void }).forEach((value, key) => {
      record[String(key)] = String(value);
    });
    return record;
  }
  return Object.fromEntries(
    Object.entries(headers as Record<string, string>).map(([key, value]) => [String(key), String(value)]),
  );
}

function buildRequestInit(
  init?: RequestInit,
  extraHeaders?: Record<string, string>,
): RequestInit | undefined {
  if (!init && (!extraHeaders || Object.keys(extraHeaders).length === 0)) {
    return undefined;
  }
  return {
    ...(init || {}),
    headers: {
      ...headersToRecord(init?.headers),
      ...(extraHeaders || {}),
    },
  };
}

function extractErrorMessage(responseText: string): string {
  if (!responseText) return '';
  try {
    const payload = JSON.parse(responseText);
    return typeof payload?.error === 'string' ? payload.error.trim() : '';
  } catch (_error) {
    return '';
  }
}

function formatResponseError(response: Response, responseText: string): string {
  const statusLine = `${response.status} ${response.statusText}`.trim();
  const apiError = extractErrorMessage(responseText);
  if (apiError) {
    return `${statusLine}: ${apiError}`;
  }
  if (responseText) {
    return `${statusLine}: ${responseText}`;
  }
  return statusLine;
}

async function parseJsonResponse(response: Response, path: string): Promise<any> {
  const responseText = normalizeResponseText(await response.text().catch(() => ''));
  if (!response.ok) {
    throw new Error(formatResponseError(response, responseText));
  }
  if (!responseText) {
    return null;
  }
  try {
    return JSON.parse(responseText);
  } catch (_error) {
    throw new Error(`Invalid JSON response from ${path}`);
  }
}

async function fetchAuthToken(baseUrl: string): Promise<string> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const cached = authTokenCache.get(normalizedBaseUrl);
  if (cached) {
    return cached;
  }

  const nextToken = (async () => {
    const response = await fetch(`${normalizedBaseUrl}/collab/me`);
    const payload = await parseJsonResponse(response, '/collab/me');
    const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
    if (!token) {
      throw new Error('Backend did not return an auth token');
    }
    return token;
  })();

  authTokenCache.set(normalizedBaseUrl, nextToken);
  try {
    return await nextToken;
  } catch (error) {
    authTokenCache.delete(normalizedBaseUrl);
    throw error;
  }
}

async function fetchBackendResponse(
  baseUrl: string,
  path: string,
  init?: RequestInit,
  options?: { auth?: boolean; retryOnUnauthorized?: boolean },
): Promise<Response> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const requiresAuth = options?.auth === true;
  const retryOnUnauthorized = options?.retryOnUnauthorized !== false;

  const run = async (): Promise<Response> => {
    const authHeaders = requiresAuth
      ? { authorization: `Bearer ${await fetchAuthToken(normalizedBaseUrl)}` }
      : undefined;
    return fetch(`${normalizedBaseUrl}${path}`, buildRequestInit(init, authHeaders));
  };

  let response = await run();
  if (requiresAuth && retryOnUnauthorized && response.status === 401) {
    authTokenCache.delete(normalizedBaseUrl);
    response = await run();
  }
  return response;
}

async function fetchJson(
  baseUrl: string,
  path: string,
  init?: RequestInit,
  options?: { auth?: boolean; retryOnUnauthorized?: boolean },
): Promise<any> {
  const response = await fetchBackendResponse(baseUrl, path, init, options);
  return parseJsonResponse(response, path);
}

export async function readClipperState(): Promise<ClipperState> {
  const stored = await getLocalStorage<Record<string, ClipperState>>(STORAGE_KEY);
  return stored?.[STORAGE_KEY] || {};
}

function compactClipperState(state: ClipperState): ClipperState {
  const compact: ClipperState = {};
  const backendUrl = typeof state.backendUrl === 'string' ? state.backendUrl.trim() : '';
  const mode = typeof state.mode === 'string' ? state.mode.trim() : '';

  if (backendUrl) {
    compact.backendUrl = backendUrl;
  }
  if (state.target?.boardId) {
    compact.target = state.target;
  }
  if (mode) {
    compact.mode = mode;
  }
  if (typeof state.rememberTarget === 'boolean') {
    compact.rememberTarget = state.rememberTarget;
  }

  return compact;
}

export async function writeClipperState(nextState: Partial<ClipperState>): Promise<ClipperState> {
  const current = await readClipperState();
  const merged = compactClipperState({ ...current, ...nextState });
  await setLocalStorage({ [STORAGE_KEY]: merged });
  return merged;
}

export async function discoverBackend(preferredBaseUrl?: string): Promise<string | null> {
  return discoverLexeraBackend(preferredBaseUrl);
}

type BackendConnectionProbeResult =
  | {
      ok: true;
      baseUrl: string;
      responseText: string;
      statusPayload: any;
    }
  | {
      ok: false;
      baseUrl: string;
      error: string;
      responseText: string;
    };

async function probeBackendConnection(baseUrl: string): Promise<BackendConnectionProbeResult> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  try {
    const response = await fetch(`${normalizedBaseUrl}/status`);
    const trimmedResponseText = normalizeResponseText(await response.text().catch(() => ''));
    if (!response.ok) {
      return {
        ok: false,
        baseUrl: normalizedBaseUrl,
        error: `HTTP ${response.status} ${response.statusText}`.trim(),
        responseText: trimmedResponseText,
      };
    }

    let statusPayload: any = null;
    try {
      statusPayload = trimmedResponseText ? JSON.parse(trimmedResponseText) : null;
    } catch (_error) {
      return {
        ok: false,
        baseUrl: normalizedBaseUrl,
        error: 'Invalid JSON response from /status',
        responseText: trimmedResponseText,
      };
    }

    if (statusPayload?.status !== 'running') {
      return {
        ok: false,
        baseUrl: normalizedBaseUrl,
        error: `Unexpected backend status: ${statusPayload?.status ?? 'unknown'}`,
        responseText: trimmedResponseText,
      };
    }

    return {
      ok: true,
      baseUrl: resolveLexeraBackendStatusBaseUrl(normalizedBaseUrl, statusPayload),
      responseText: trimmedResponseText,
      statusPayload,
    };
  } catch (error) {
    return {
      ok: false,
      baseUrl: normalizedBaseUrl,
      error: error instanceof Error ? error.message : String(error),
      responseText: '',
    };
  }
}

function formatProbeFailure(result: Extract<BackendConnectionProbeResult, { ok: false }>): string {
  const parts = [`${result.baseUrl}: ${result.error}`];
  if (result.responseText) {
    parts.push(result.responseText);
  }
  return parts.join('\n');
}

export async function testBackendConnection(preferredBaseUrl?: string): Promise<BackendConnectionTestResult> {
  const configuredBackendUrl = normalizeBaseUrl(preferredBaseUrl);
  const candidates = buildLexeraBackendCandidates(configuredBackendUrl || undefined);
  const failures: Array<Extract<BackendConnectionProbeResult, { ok: false }>> = [];

  for (const candidate of candidates) {
    const probe = await probeBackendConnection(candidate);
    if (!probe.ok) {
      failures.push(probe);
      continue;
    }

    try {
      await fetchAuthToken(probe.baseUrl);
      const usedFallback = Boolean(configuredBackendUrl && candidate !== configuredBackendUrl);
      const details = usedFallback && failures.length > 0
        ? [
            `Configured URL failed, fallback succeeded via ${probe.baseUrl}.`,
            ...failures.map((failure) => formatProbeFailure(failure)),
          ].join('\n\n')
        : '';
      return {
        ok: true,
        configuredBackendUrl,
        resolvedBackendUrl: probe.baseUrl,
        details,
        usedFallback,
      };
    } catch (error) {
      failures.push({
        ok: false,
        baseUrl: probe.baseUrl,
        error: error instanceof Error ? error.message : String(error),
        responseText: '',
      });
    }
  }

  return {
    ok: false,
    configuredBackendUrl,
    resolvedBackendUrl: '',
    error: configuredBackendUrl
      ? `Could not connect to ${configuredBackendUrl}`
      : 'Lexera Backend is not reachable on localhost',
    details: failures.map((failure) => formatProbeFailure(failure)).join('\n\n'),
  };
}

export async function fetchBackendStatus(baseUrl: string): Promise<any> {
  return fetchJson(baseUrl, '/status');
}

export async function listBoards(baseUrl: string): Promise<BackendBoardSummary[]> {
  const payload = await fetchJson(baseUrl, '/boards', undefined, { auth: true });
  return Array.isArray(payload?.boards) ? payload.boards : [];
}

export async function listWorkspaces(
  baseUrl: string,
): Promise<{ workspaces: BackendWorkspaceSummary[]; defaultWorkspace?: string | null }> {
  const payload = await fetchJson(baseUrl, '/config/workspaces', undefined, { auth: true });
  return {
    workspaces: Array.isArray(payload?.workspaces) ? payload.workspaces : [],
    defaultWorkspace: typeof payload?.default_workspace === 'string' ? payload.default_workspace : null,
  };
}

export async function listColumns(baseUrl: string, boardId: string): Promise<BackendColumnSummary[]> {
  const payload = await loadBoardTargetData(baseUrl, boardId);
  return payload.columns;
}

export async function loadBoardTargetData(baseUrl: string, boardId: string): Promise<BackendBoardTargetData> {
  const payload = await fetchJson(baseUrl, `/boards/${encodeURIComponent(boardId)}/columns`, undefined, { auth: true });
  return {
    columns: Array.isArray(payload?.columns) ? payload.columns : [],
    fullBoard: payload?.fullBoard || null,
  };
}

export async function searchCards(baseUrl: string, query: string): Promise<BackendSearchResult[]> {
  const payload = await fetchJson(baseUrl, `/search?q=${encodeURIComponent(query)}`, undefined, { auth: true });
  return Array.isArray(payload?.results) ? payload.results : [];
}

function targetFromIncoming(statusPayload: any): WebClipperTarget | null {
  const incoming = statusPayload?.incoming;
  if (!incoming || typeof incoming.board_id !== 'string') return null;
  return {
    boardId: incoming.board_id,
    colIndex: typeof incoming.column === 'number' ? incoming.column : 0,
    source: 'incoming',
  };
}

function isRememberedTarget(target: WebClipperTarget | undefined): boolean {
  return Boolean(target?.boardId && target.source === 'saved');
}

function shouldUsePersistedTarget(state: ClipperState): boolean {
  return state.rememberTarget !== false;
}

export async function resolveCaptureTarget(
  baseUrl: string,
  explicitTarget?: WebClipperTarget | null,
): Promise<WebClipperTarget> {
  if (explicitTarget?.boardId) {
    return explicitTarget;
  }

  const state = await readClipperState();
  if (shouldUsePersistedTarget(state) && isRememberedTarget(state.target)) {
    return { ...state.target, source: 'saved' };
  }

  const status = await fetchBackendStatus(baseUrl);
  const incomingTarget = targetFromIncoming(status);
  if (incomingTarget) {
    return incomingTarget;
  }

  if (shouldUsePersistedTarget(state) && state.target?.boardId) {
    return { ...state.target, source: state.target.source || 'fallback' };
  }

  const boards = await listBoards(baseUrl);
  if (boards.length === 0) {
    throw new Error('No Lexera boards are configured in the backend');
  }

  const firstBoard = boards[0];
  const columns = await listColumns(baseUrl, firstBoard.id);
  if (columns.length === 0) {
    throw new Error(`Board "${firstBoard.title}" has no writable columns`);
  }

  return {
    boardId: firstBoard.id,
    boardTitle: firstBoard.title,
    source: 'fallback',
  };
}

export async function submitMarkdownCard(
  baseUrl: string,
  target: WebClipperTarget,
  content: string,
): Promise<void> {
  if (typeof target.cardId === 'string' && target.cardId.trim()) {
    const response = await fetchBackendResponse(
      baseUrl,
      `/boards/${encodeURIComponent(target.boardId)}/cards/${encodeURIComponent(target.cardId)}/append`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ content }),
      },
      { auth: true },
    );
    if (!response.ok) {
      throw new Error(`Failed to add card: ${response.status} ${response.statusText}`);
    }
    return;
  }

  let colIndex = target.colIndex;
  if (typeof colIndex !== 'number') {
    const columns = await listColumns(baseUrl, target.boardId);
    if (columns.length === 0) {
      throw new Error(`Board "${target.boardTitle || target.boardId}" has no writable columns`);
    }
    colIndex = columns[0].index;
  }

  const nextContent = target.source === 'incoming' || typeof target.colIndex !== 'number'
    ? prependIncomingCaptureTag(content)
    : content;
  const response = await fetchBackendResponse(
    baseUrl,
    `/boards/${encodeURIComponent(target.boardId)}/columns/${colIndex}/cards`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content: nextContent }),
    },
    { auth: true },
  );
  if (!response.ok) {
    throw new Error(`Failed to add card: ${response.status} ${response.statusText}`);
  }
}

export async function uploadBlobToBoardMedia(
  baseUrl: string,
  boardId: string,
  blob: Blob,
  filename: string,
): Promise<{ path: string; filename: string }> {
  const formData = new FormData();
  formData.append('file', new File([blob], filename, { type: blob.type || 'application/octet-stream' }));
  const response = await fetchBackendResponse(
    baseUrl,
    `/boards/${encodeURIComponent(boardId)}/media`,
    {
      method: 'POST',
      body: formData,
    },
    { auth: true },
  );
  if (!response.ok) {
    throw new Error(`Failed to upload media: ${response.status} ${response.statusText}`);
  }
  return parseJsonResponse(response, `/boards/${encodeURIComponent(boardId)}/media`);
}
