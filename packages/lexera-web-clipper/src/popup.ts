import {
  DEFAULT_WEB_CLIPPER_MODE,
  WebClipperContext,
  buildCaptureCardMarkdown,
  normalizeClipperMode,
  trimPreview,
} from '../../shared/src/webClipper';
import { sendRuntimeMessage } from './shared/browser';
import { MESSAGE_TYPES } from './shared/messages';

const INCOMING_COLUMN_VALUE = '__incoming__';

const elements = {
  backendStatus: document.getElementById('backend-status') as HTMLParagraphElement,
  backendUrlInput: document.getElementById('backend-url-input') as HTMLInputElement,
  boardSelect: document.getElementById('board-select') as HTMLSelectElement,
  columnSelect: document.getElementById('column-select') as HTMLSelectElement,
  modeSelect: document.getElementById('mode-select') as HTMLSelectElement,
  rememberTarget: document.getElementById('remember-target') as HTMLInputElement,
  captureButton: document.getElementById('capture-button') as HTMLButtonElement,
  refreshButton: document.getElementById('refresh-button') as HTMLButtonElement,
  resultStatus: document.getElementById('result-status') as HTMLParagraphElement,
  previewTitle: document.getElementById('preview-title') as HTMLParagraphElement,
  previewUrl: document.getElementById('preview-url') as HTMLParagraphElement,
  previewBody: document.getElementById('preview-body') as HTMLPreElement,
};

type PopupBoard = {
  id: string;
  title?: string;
  filePath?: string;
  file_path?: string;
};

let boards: PopupBoard[] = [];
let columns: Array<{ index: number; title: string }> = [];
let previewContext: WebClipperContext | undefined;

function currentBackendUrl(): string {
  return elements.backendUrlInput.value.trim();
}

function setStatus(message: string): void {
  elements.resultStatus.textContent = message;
}

function setBackendStatus(message: string): void {
  elements.backendStatus.textContent = message;
}

function setControlsEnabled(enabled: boolean): void {
  elements.boardSelect.disabled = !enabled;
  elements.columnSelect.disabled = !enabled;
  elements.modeSelect.disabled = !enabled;
  elements.rememberTarget.disabled = !enabled;
  elements.captureButton.disabled = !enabled;
}

function boardFilePath(board: PopupBoard | undefined): string {
  if (!board) return '';
  if (typeof board.filePath === 'string' && board.filePath.trim()) return board.filePath.trim();
  if (typeof board.file_path === 'string' && board.file_path.trim()) return board.file_path.trim();
  return '';
}

function boardFileLabel(board: PopupBoard | undefined): string {
  const filePath = boardFilePath(board);
  if (!filePath) return '';
  const lastSegment = filePath.split(/[\\/]/).pop() || filePath;
  return lastSegment.replace(/\.md$/i, '');
}

function boardDisplayLabel(board: PopupBoard | undefined): string {
  if (!board) return '';
  const title = typeof board.title === 'string' ? board.title.trim() : '';
  const fileLabel = boardFileLabel(board);
  if (title && fileLabel && title !== fileLabel) {
    return `${title} (${fileLabel})`;
  }
  if (title) return title;
  if (fileLabel) return fileLabel;
  return board.id;
}

function renderBoardOptions(selectedBoardId?: string): void {
  elements.boardSelect.innerHTML = '';
  if (boards.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No boards available';
    elements.boardSelect.appendChild(option);
    return;
  }
  for (const board of boards) {
    const option = document.createElement('option');
    option.value = board.id;
    option.textContent = boardDisplayLabel(board);
    if (board.id === selectedBoardId) option.selected = true;
    elements.boardSelect.appendChild(option);
  }
}

function renderColumnOptions(selectedColumnIndex?: number, selectIncoming = false): void {
  elements.columnSelect.innerHTML = '';
  const incomingOption = document.createElement('option');
  incomingOption.value = INCOMING_COLUMN_VALUE;
  incomingOption.textContent = 'Incoming';
  incomingOption.selected = selectIncoming || typeof selectedColumnIndex !== 'number';
  elements.columnSelect.appendChild(incomingOption);
  for (const column of columns) {
    const option = document.createElement('option');
    option.value = String(column.index);
    option.textContent = column.title || `Column ${column.index}`;
    if (column.index === selectedColumnIndex) option.selected = true;
    elements.columnSelect.appendChild(option);
  }
}

function currentClipMode() {
  return normalizeClipperMode(elements.modeSelect.value || DEFAULT_WEB_CLIPPER_MODE);
}

function renderPreview(context: WebClipperContext | undefined): void {
  previewContext = context;

  const title = typeof context?.title === 'string' ? context.title : '';
  const url = typeof context?.url === 'string' ? context.url : '';
  const markdownPreview = context
    ? buildCaptureCardMarkdown(context, {
        mode: currentClipMode(),
        includeMetadata: true,
      })
    : '';

  elements.previewTitle.textContent = title || 'No active page context';
  elements.previewUrl.textContent = url;
  elements.previewBody.textContent = trimPreview(markdownPreview, 1200) || 'Nothing extracted for this capture type.';
}

async function loadColumns(boardId: string, selectedColumnIndex?: number): Promise<void> {
  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.popupLoadColumns,
    boardId,
    backendUrl: currentBackendUrl(),
  });

  if (!response?.ok) {
    throw new Error(response?.error || 'Failed to load columns');
  }

  columns = Array.isArray(response.columns) ? response.columns : [];
  renderColumnOptions(selectedColumnIndex);
}

async function refreshPopup(): Promise<void> {
  setStatus('');
  setBackendStatus('Connecting to backend…');

  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.popupLoad,
    backendUrl: currentBackendUrl(),
  });
  if (typeof response?.backendUrl === 'string') {
    elements.backendUrlInput.value = response.backendUrl;
  }
  if (!response?.ok) {
    setBackendStatus('Backend unavailable');
    boards = [];
    columns = [];
    renderBoardOptions();
    renderColumnOptions();
    renderPreview(undefined);
    setControlsEnabled(false);
    throw new Error(response?.error || 'Failed to initialize popup');
  }

  boards = Array.isArray(response.boards) ? response.boards : [];
  columns = Array.isArray(response.columns) ? response.columns : [];

  renderBoardOptions(response.target?.boardId);
  renderColumnOptions(
    response.target?.colIndex,
    response.target?.source === 'incoming' || typeof response.target?.colIndex !== 'number',
  );
  elements.modeSelect.value = normalizeClipperMode(response.mode || DEFAULT_WEB_CLIPPER_MODE);
  renderPreview(response.context);
  setControlsEnabled(true);
  setBackendStatus(`Connected to ${response.backendUrl}`);
}

async function submitCapture(): Promise<void> {
  const boardId = elements.boardSelect.value;
  const columnValue = elements.columnSelect.value;
  const mode = normalizeClipperMode(elements.modeSelect.value || DEFAULT_WEB_CLIPPER_MODE);
  const selectedBoard = boards.find((board) => board.id === boardId);

  if (!boardId) {
    throw new Error('Pick a board first');
  }

  const target = columnValue === INCOMING_COLUMN_VALUE
    ? { boardId }
    : { boardId, colIndex: Number(columnValue) };

  if (columnValue !== INCOMING_COLUMN_VALUE && Number.isNaN(target.colIndex)) {
    throw new Error('Pick a valid column');
  }

  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.popupCapture,
    mode,
    backendUrl: currentBackendUrl(),
    rememberTarget: elements.rememberTarget.checked,
    target,
  });

  if (!response?.ok) {
    throw new Error(response?.error || 'Capture failed');
  }

  const savedToIncoming = response.target?.source === 'incoming' || typeof response.target?.colIndex !== 'number';
  setStatus(
    savedToIncoming
      ? `Saved ${mode} to incoming of ${boardDisplayLabel(selectedBoard) || boardId}`
      : `Saved ${mode} to ${boardDisplayLabel(selectedBoard) || boardId}`,
  );
  renderPreview(response.context);
}

elements.refreshButton.addEventListener('click', () => {
  refreshPopup().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
});

elements.boardSelect.addEventListener('change', () => {
  const boardId = elements.boardSelect.value;
  if (!boardId) return;
  loadColumns(boardId)
    .then(() => renderColumnOptions(undefined, true))
    .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
});

elements.captureButton.addEventListener('click', () => {
  submitCapture().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
});

elements.modeSelect.addEventListener('change', () => {
  renderPreview(previewContext);
});

elements.backendUrlInput.addEventListener('change', () => {
  sendRuntimeMessage({
    type: MESSAGE_TYPES.popupSetBackendUrl,
    backendUrl: currentBackendUrl(),
  }).catch(() => undefined);
});

setControlsEnabled(false);
refreshPopup().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error));
});
