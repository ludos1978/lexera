import {
  LEXERA_BACKEND_PORT_CANDIDATES,
  WebClipperTarget,
  prependIncomingCaptureTag,
} from '../../../shared/src/webClipper';
import { getLocalStorage, setLocalStorage } from './browser';

const STORAGE_KEY = 'lexeraWebClipperState';

export interface ClipperState {
  backendUrl?: string;
  target?: WebClipperTarget;
  mode?: string;
}

export interface BackendBoardSummary {
  id: string;
  title: string;
  filePath?: string;
}

export interface BackendColumnSummary {
  index: number;
  title: string;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

async function fetchJson(baseUrl: string, path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function readClipperState(): Promise<ClipperState> {
  const stored = await getLocalStorage<Record<string, ClipperState>>(STORAGE_KEY);
  return stored?.[STORAGE_KEY] || {};
}

export async function writeClipperState(nextState: Partial<ClipperState>): Promise<ClipperState> {
  const current = await readClipperState();
  const merged = { ...current, ...nextState };
  await setLocalStorage({ [STORAGE_KEY]: merged });
  return merged;
}

export async function probeBackend(baseUrl: string): Promise<any | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1200);
  try {
    return await fetchJson(baseUrl, '/status', {
      signal: controller.signal,
    });
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function discoverBackend(preferredBaseUrl?: string): Promise<string | null> {
  const candidates = [];
  if (preferredBaseUrl && preferredBaseUrl.trim()) {
    candidates.push(normalizeBaseUrl(preferredBaseUrl));
  }

  for (const port of LEXERA_BACKEND_PORT_CANDIDATES) {
    candidates.push(`http://127.0.0.1:${port}`);
    candidates.push(`http://localhost:${port}`);
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const status = await probeBackend(candidate);
    if (status?.status === 'running') {
      const livePort = typeof status.port === 'number' ? status.port : null;
      if (livePort && !candidate.endsWith(`:${livePort}`)) {
        return `http://127.0.0.1:${livePort}`;
      }
      return candidate;
    }
  }

  return null;
}

export async function fetchBackendStatus(baseUrl: string): Promise<any> {
  return fetchJson(baseUrl, '/status');
}

export async function listBoards(baseUrl: string): Promise<BackendBoardSummary[]> {
  const payload = await fetchJson(baseUrl, '/boards');
  return Array.isArray(payload?.boards) ? payload.boards : [];
}

export async function listColumns(baseUrl: string, boardId: string): Promise<BackendColumnSummary[]> {
  const payload = await fetchJson(baseUrl, `/boards/${encodeURIComponent(boardId)}/columns`);
  return Array.isArray(payload?.columns) ? payload.columns : [];
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

export async function resolveCaptureTarget(
  baseUrl: string,
  explicitTarget?: WebClipperTarget | null,
): Promise<WebClipperTarget> {
  if (explicitTarget?.boardId) {
    return explicitTarget;
  }

  const state = await readClipperState();
  if (isRememberedTarget(state.target)) {
    return { ...state.target, source: 'saved' };
  }

  const status = await fetchBackendStatus(baseUrl);
  const incomingTarget = targetFromIncoming(status);
  if (incomingTarget) {
    return incomingTarget;
  }

  if (state.target?.boardId) {
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
  const response = await fetch(
    `${normalizeBaseUrl(baseUrl)}/boards/${encodeURIComponent(target.boardId)}/columns/${colIndex}/cards`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content: nextContent }),
    },
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
  const response = await fetch(
    `${normalizeBaseUrl(baseUrl)}/boards/${encodeURIComponent(boardId)}/media`,
    {
      method: 'POST',
      body: formData,
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to upload media: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
