import {
  DEFAULT_WEB_CLIPPER_MODE,
  WebClipperCollectedPageContext,
  WebClipperContext,
  WebClipperFeedCandidate,
  WebClipperTarget,
  buildCaptureCardMarkdown,
  getPreferredWebClipperContext,
  normalizeClipperMode,
  trimPreview,
} from '@lexera/shared';
import { sendRuntimeMessage } from './shared/browser';
import { fetchFeedContext } from './shared/feed';
import { MESSAGE_TYPES } from './shared/messages';

const UNASSIGNED_WORKSPACE_ID = '__lexera_unassigned_workspace__';

const BADGE_LABELS = {
  workspace: 'WS',
  board: 'Board',
  row: 'Row',
  stack: 'Stack',
  column: 'Col',
  card: 'Card',
} as const;

const elements = {
  primaryView: document.getElementById('primary-view') as HTMLElement,
  settingsView: document.getElementById('settings-view') as HTMLElement,
  backendStatus: document.getElementById('backend-status') as HTMLParagraphElement,
  settingsConnection: document.getElementById('settings-connection') as HTMLParagraphElement,
  settingsButton: document.getElementById('settings-button') as HTMLButtonElement,
  settingsBackButton: document.getElementById('settings-back-button') as HTMLButtonElement,
  settingsTestButton: document.getElementById('settings-test-button') as HTMLButtonElement,
  settingsSaveButton: document.getElementById('settings-save-button') as HTMLButtonElement,
  settingsTestStatus: document.getElementById('settings-test-status') as HTMLParagraphElement,
  settingsTestResponse: document.getElementById('settings-test-response') as HTMLPreElement,
  settingsConnectionError: document.getElementById('settings-connection-error') as HTMLPreElement,
  backendUrlInput: document.getElementById('backend-url-input') as HTMLInputElement,
  searchInput: document.getElementById('search-input') as HTMLInputElement,
  browseArea: document.getElementById('browse-area') as HTMLDivElement,
  modeSelect: document.getElementById('mode-select') as HTMLSelectElement,
  sourceSelect: document.getElementById('source-select') as HTMLSelectElement,
  rememberTarget: document.getElementById('remember-target') as HTMLInputElement,
  captureButton: document.getElementById('capture-button') as HTMLButtonElement,
  refreshButton: document.getElementById('refresh-button') as HTMLButtonElement,
  resultStatus: document.getElementById('result-status') as HTMLParagraphElement,
  previewTitle: document.getElementById('preview-title') as HTMLParagraphElement,
  previewUrl: document.getElementById('preview-url') as HTMLParagraphElement,
  previewBody: document.getElementById('preview-body') as HTMLPreElement,
};

type PopupColumn = {
  index: number;
  title: string;
  id?: string;
  cards?: Array<{ id: string; content: string }>;
};

type PopupBoard = {
  id: string;
  title?: string;
  filePath?: string;
  file_path?: string;
  workspaceIds?: string[];
  workspace_ids?: string[];
  columns?: PopupColumn[];
};

type PopupWorkspace = {
  id: string;
  name?: string;
};

type PopupNodeType = 'workspace' | 'board' | 'row' | 'stack' | 'column' | 'card';

type PopupNode = {
  type: PopupNodeType;
  id: string;
  title: string;
  detail?: string;
  context?: string;
  workspaceId?: string;
  boardId?: string;
  colIndex?: number;
  cardId?: string;
  data?: any;
  columns?: PopupColumn[];
};

type PopupLevel = {
  title: string;
  items: PopupNode[];
  activeIndex: number;
};

type PopupSourceOption = {
  id: string;
  label: string;
  description?: string;
  context: WebClipperContext;
  preferred?: boolean;
};

let boards: PopupBoard[] = [];
let workspaces: PopupWorkspace[] = [];
let defaultWorkspaceId = '';
let navStack: PopupLevel[] = [];
let isSearchMode = false;
let searchResults: PopupNode[] = [];
let activeSearchIndex = -1;
let searchDebounceTimer: number | null = null;
let previewContext: WebClipperContext | undefined;
let collectedPreviewContext: WebClipperCollectedPageContext | undefined;
let sourceOptions: PopupSourceOption[] = [];
let selectedSourceId = '';
let sourceLoadVersion = 0;
let configuredBackendUrl = '';
let resolvedBackendUrl = '';
let lastBackendError = '';
let rememberTargetPreference = true;
let activeView: 'primary' | 'settings' = 'primary';

function currentSettingsBackendUrl(): string {
  return elements.backendUrlInput.value.trim();
}

async function loadBoardTargetPayload(boardId: string): Promise<{ columns: any[]; fullBoard: any }> {
  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.popupLoadColumns,
    boardId,
  });
  if (!response?.ok) {
    const errorMessage = typeof response?.error === 'string' ? response.error : 'Failed to load board data';
    recordBackendFailure(errorMessage);
    throw new Error(errorMessage);
  }
  return {
    columns: Array.isArray(response?.columns) ? response.columns : [],
    fullBoard: response?.fullBoard || null,
  };
}

async function searchBackendCards(query: string): Promise<any[]> {
  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.popupSearch,
    query,
  });
  if (!response?.ok) {
    const errorMessage = typeof response?.error === 'string' ? response.error : 'Failed to search Lexera';
    recordBackendFailure(errorMessage);
    throw new Error(errorMessage);
  }
  return Array.isArray(response?.results) ? response.results : [];
}

function setStatus(message: string): void {
  elements.resultStatus.textContent = message;
}

function setBackendStatus(message: string): void {
  elements.backendStatus.textContent = message;
}

function reportUiError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (looksLikeBackendError(message)) {
    recordBackendFailure(message);
  }
  setStatus(message);
}

function renderSettingsConnectionError(): void {
  const errorMessage = lastBackendError.trim();
  elements.settingsConnectionError.textContent = errorMessage;
  elements.settingsConnectionError.hidden = !errorMessage;
}

function isAuthorizationError(message: string): boolean {
  return /(unauthorized|invalid token|authorization|auth token|forbidden)/i.test(message);
}

function looksLikeBackendError(message: string): boolean {
  return /(unauthorized|invalid token|authorization|auth token|forbidden|not reachable|failed to fetch|network|timed out|econnrefused|backend|http \d{3}|failed to load board data|failed to search lexera|failed to add card|failed to upload media|capture failed)/i.test(message);
}

function summarizeBackendStatus(errorMessage = ''): string {
  const trimmed = errorMessage.trim();
  if (!trimmed) {
    return 'Connected and authorized';
  }
  if (isAuthorizationError(trimmed)) {
    return 'Backend auth failed';
  }
  if (/not reachable|failed to fetch|network|timed out|load failed|econnrefused/i.test(trimmed)) {
    return 'Backend unavailable';
  }
  return 'Backend error';
}

function clearBackendFailure(): void {
  lastBackendError = '';
  renderSettingsConnection();
  setBackendStatus(summarizeBackendStatus());
}

function recordBackendFailure(errorMessage: string): void {
  lastBackendError = errorMessage.trim();
  renderSettingsConnection();
  setBackendStatus(summarizeBackendStatus(lastBackendError));
}

function describeConnectionTarget(): string {
  return resolvedBackendUrl || configuredBackendUrl || '';
}

function clearSettingsTestFeedback(): void {
  elements.settingsTestStatus.textContent = '';
  elements.settingsTestStatus.classList.remove('is-success', 'is-error');
  elements.settingsTestResponse.hidden = true;
  elements.settingsTestResponse.textContent = '';
}

function setSettingsTestFeedback(
  message: string,
  tone: 'success' | 'error' | 'neutral' = 'neutral',
  details = '',
): void {
  elements.settingsTestStatus.textContent = message;
  elements.settingsTestStatus.classList.remove('is-success', 'is-error');
  if (tone === 'success') {
    elements.settingsTestStatus.classList.add('is-success');
  } else if (tone === 'error') {
    elements.settingsTestStatus.classList.add('is-error');
  }
  elements.settingsTestResponse.textContent = details;
  elements.settingsTestResponse.hidden = !details;
}

function syncSettingsFields(): void {
  elements.backendUrlInput.value = configuredBackendUrl;
  elements.rememberTarget.checked = rememberTargetPreference;
}

function renderSettingsConnection(): void {
  if (lastBackendError) {
    const connectionTarget = describeConnectionTarget();
    if (configuredBackendUrl) {
      if (isAuthorizationError(lastBackendError)) {
        elements.settingsConnection.textContent = connectionTarget
          ? `Backend at ${connectionTarget} reached, but authorization failed`
          : 'Saved URL reached the backend, but authorization failed';
      } else {
        elements.settingsConnection.textContent = connectionTarget
          ? `Backend at ${connectionTarget} reported an error`
          : 'Saved URL is not reachable right now';
      }
      renderSettingsConnectionError();
      return;
    }
    if (connectionTarget) {
      elements.settingsConnection.textContent = isAuthorizationError(lastBackendError)
        ? `Backend at ${connectionTarget} reached, but authorization failed`
        : `Backend at ${connectionTarget} reported an error`;
    } else {
      elements.settingsConnection.textContent = isAuthorizationError(lastBackendError)
        ? 'Auto-discovery reached a backend, but authorization failed'
        : 'Auto-discovery is not connected';
    }
    renderSettingsConnectionError();
    return;
  }
  if (resolvedBackendUrl) {
    elements.settingsConnection.textContent = `Authorized at ${resolvedBackendUrl}`;
    renderSettingsConnectionError();
    return;
  }
  if (configuredBackendUrl) {
    elements.settingsConnection.textContent = 'Saved URL is not reachable right now';
    renderSettingsConnectionError();
    return;
  }
  elements.settingsConnection.textContent = 'Auto-discovery is not connected';
  renderSettingsConnectionError();
}

function setConfiguredSettings(backendUrl: string, rememberTarget: boolean): void {
  configuredBackendUrl = backendUrl.trim();
  rememberTargetPreference = rememberTarget;
  syncSettingsFields();
  renderSettingsConnection();
}

function setResolvedBackendConnection(backendUrl: string): void {
  resolvedBackendUrl = backendUrl.trim();
  renderSettingsConnection();
}

function setActiveView(view: 'primary' | 'settings'): void {
  activeView = view;
  const showingSettings = view === 'settings';
  elements.primaryView.hidden = showingSettings;
  elements.settingsView.hidden = !showingSettings;
}

function setControlsEnabled(enabled: boolean): void {
  elements.searchInput.disabled = !enabled;
  elements.modeSelect.disabled = !enabled;
  elements.sourceSelect.disabled = !enabled || sourceOptions.length <= 1;
  elements.captureButton.disabled = !enabled;
}

function openSettingsView(): void {
  syncSettingsFields();
  setActiveView('settings');
  renderSettingsConnection();
  elements.backendUrlInput.focus();
  elements.backendUrlInput.select();
}

function closeSettingsView(): void {
  syncSettingsFields();
  setActiveView('primary');
}

function selectedSourceOption(): PopupSourceOption | null {
  if (!sourceOptions.length) return null;
  const match = sourceOptions.find((option) => option.id === selectedSourceId);
  return match || sourceOptions[0] || null;
}

function selectedSourceContext(): WebClipperContext | undefined {
  return selectedSourceOption()?.context;
}

function ensureSelectedSource(): void {
  if (!sourceOptions.length) {
    selectedSourceId = '';
    return;
  }
  if (sourceOptions.some((option) => option.id === selectedSourceId)) return;
  const preferred = sourceOptions.find((option) => option.preferred) || sourceOptions[0];
  selectedSourceId = preferred.id;
}

function renderSourceOptions(): void {
  const currentValue = selectedSourceId;
  elements.sourceSelect.innerHTML = '';
  sourceOptions.forEach((option) => {
    const node = document.createElement('option');
    node.value = option.id;
    node.textContent = option.description ? `${option.label} - ${option.description}` : option.label;
    elements.sourceSelect.appendChild(node);
  });
  ensureSelectedSource();
  elements.sourceSelect.value = selectedSourceId || currentValue || '';
  elements.sourceSelect.disabled = sourceOptions.length <= 1;
}

function setBaseSourceOptions(collectedContext: WebClipperCollectedPageContext | undefined): void {
  collectedPreviewContext = collectedContext;
  if (!collectedContext) {
    sourceOptions = [];
    selectedSourceId = '';
    renderSourceOptions();
    return;
  }

  const options: PopupSourceOption[] = [];
  if (collectedContext.reader) {
    options.push({
      id: 'reader',
      label: 'Reader',
      description: 'Preferred',
      context: collectedContext.reader,
      preferred: true,
    });
  }
  if (collectedContext.website) {
    options.push({
      id: 'website',
      label: 'Website',
      context: collectedContext.website,
    });
  }
  if (options.length === 0 && collectedContext.website) {
    options.push({
      id: 'website',
      label: 'Website',
      context: collectedContext.website,
      preferred: true,
    });
  }
  sourceOptions = options;
  if (!selectedSourceId && options.length > 0) {
    selectedSourceId = (options.find((option) => option.preferred) || options[0]).id;
  }
  renderSourceOptions();
}

async function appendFeedSourceOptions(
  feedCandidates: WebClipperFeedCandidate[] | undefined,
  pageUrl: string,
): Promise<void> {
  const nextLoadVersion = sourceLoadVersion + 1;
  sourceLoadVersion = nextLoadVersion;
  const candidates = Array.isArray(feedCandidates) ? feedCandidates : [];
  if (candidates.length === 0) return;

  const feedOptions = await Promise.all(candidates.map(async (candidate, index) => {
    try {
      const context = await fetchFeedContext(candidate, pageUrl);
      if (!context) return null;
      return {
        id: `rss-${index}-${candidate.url}`,
        label: context.sourceLabel || candidate.label || 'RSS',
        description: extractFeedOptionDescription(context, candidate),
        context,
      } satisfies PopupSourceOption;
    } catch (_error) {
      return null;
    }
  }));

  if (nextLoadVersion !== sourceLoadVersion) return;

  const validOptions = feedOptions.filter((option): option is PopupSourceOption => Boolean(option));
  if (validOptions.length === 0) return;
  sourceOptions = [
    ...sourceOptions.filter((option) => !option.id.startsWith('rss-')),
    ...validOptions,
  ];
  renderSourceOptions();
}

function extractFeedOptionDescription(context: WebClipperContext, candidate: WebClipperFeedCandidate): string {
  return context.siteName || candidate.label || 'Feed';
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

function getBoardWorkspaceIds(board: PopupBoard | undefined): string[] {
  if (!board) return [];
  const raw = Array.isArray(board.workspaceIds)
    ? board.workspaceIds
    : (Array.isArray(board.workspace_ids) ? board.workspace_ids : []);
  const unique: string[] = [];
  for (const workspaceId of raw) {
    const trimmed = String(workspaceId || '').trim();
    if (!trimmed || unique.includes(trimmed)) continue;
    unique.push(trimmed);
  }
  return unique;
}

function getWorkspaceNameById(workspaceId: string): string {
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  return typeof workspace?.name === 'string' ? workspace.name.trim() : '';
}

function workspaceLabelForId(workspaceId: string): string {
  if (workspaceId === UNASSIGNED_WORKSPACE_ID) return 'Unassigned';
  const name = getWorkspaceNameById(workspaceId);
  if (name) return name;
  const compactId = workspaceId.slice(0, 8);
  return compactId ? `Workspace ${compactId}` : 'Workspace';
}

function getWorkspaceLabelsForBoard(board: PopupBoard | undefined): string[] {
  const workspaceIds = getBoardWorkspaceIds(board);
  if (workspaceIds.length === 0) return ['Unassigned'];
  return workspaceIds.map((workspaceId) => workspaceLabelForId(workspaceId));
}

function currentClipMode() {
  return normalizeClipperMode(elements.modeSelect.value || DEFAULT_WEB_CLIPPER_MODE);
}

function currentLevel(): PopupLevel | null {
  return navStack.length > 0 ? navStack[navStack.length - 1] : null;
}

function activeLevel(): PopupLevel | { items: PopupNode[]; activeIndex: number } | null {
  return isSearchMode
    ? { items: searchResults, activeIndex: activeSearchIndex }
    : currentLevel();
}

function activeTarget(): PopupNode | null {
  const level = activeLevel();
  if (!level || level.activeIndex < 0 || level.activeIndex >= level.items.length) return null;
  return level.items[level.activeIndex];
}

function isSearchInputFocused(): boolean {
  return document.activeElement === elements.searchInput;
}

function focusSearchInput(): void {
  elements.searchInput.focus();
  const end = elements.searchInput.value.length;
  elements.searchInput.setSelectionRange(end, end);
}

function insertIntoSearchInput(text: string): void {
  focusSearchInput();
  const input = elements.searchInput;
  const start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
  const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : input.value.length;
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  const caret = start + text.length;
  input.setSelectionRange(caret, caret);
  onSearchInput();
}

function activateSearchSelection(direction: 'down' | 'up'): boolean {
  if (!isSearchMode || searchResults.length === 0) return false;
  if (activeSearchIndex < 0) {
    activeSearchIndex = direction === 'down' ? 0 : searchResults.length - 1;
  } else if (direction === 'down') {
    activeSearchIndex = Math.min(activeSearchIndex + 1, searchResults.length - 1);
  } else {
    activeSearchIndex = Math.max(activeSearchIndex - 1, 0);
  }
  if (isSearchInputFocused()) {
    elements.searchInput.blur();
  }
  renderLevel();
  return true;
}

function buildWorkspaceItems(): PopupNode[] {
  const workspaceOrder: string[] = [];
  const workspaceMap: Record<string, { id: string; name: string; boards: PopupNode[] }> = {};

  function ensureWorkspace(id: string, name: string): { id: string; name: string; boards: PopupNode[] } {
    if (!workspaceMap[id]) {
      workspaceMap[id] = { id, name: name || 'Workspace', boards: [] };
      workspaceOrder.push(id);
    } else if (name && !workspaceMap[id].name) {
      workspaceMap[id].name = name;
    }
    return workspaceMap[id];
  }

  for (const workspace of workspaces) {
    if (!workspace?.id) continue;
    ensureWorkspace(workspace.id, String(workspace.name || '').trim() || 'Workspace');
  }

  for (const board of boards) {
    const workspaceIds = getBoardWorkspaceIds(board);
    const targetWorkspaceIds = workspaceIds.length > 0 ? workspaceIds : [UNASSIGNED_WORKSPACE_ID];
    for (const workspaceId of targetWorkspaceIds) {
      const workspace = ensureWorkspace(workspaceId, workspaceLabelForId(workspaceId));
      workspace.boards.push({
        type: 'board',
        id: board.id,
        title: boardDisplayLabel(board),
        detail: `${Array.isArray(board.columns) ? board.columns.length : 0} columns`,
        boardId: board.id,
        workspaceId,
        columns: Array.isArray(board.columns) ? board.columns : [],
        data: board,
      });
    }
  }

  return workspaceOrder.map((workspaceId) => {
    const workspace = workspaceMap[workspaceId];
    return {
      type: 'workspace',
      id: workspace.id,
      title: workspace.name,
      detail: `${workspace.boards.length} boards`,
      workspaceId: workspace.id,
      data: { id: workspace.id, name: workspace.name, boards: workspace.boards },
    };
  });
}

function pushWorkspacesLevel(): void {
  const items = buildWorkspaceItems();
  navStack = [{ items, activeIndex: items.length > 0 ? 0 : -1, title: 'Workspaces' }];
}

function rebuildNavStackForBoard(boardId: string, preferredWorkspaceId?: string | null): PopupNode | null {
  const workspaceItems = buildWorkspaceItems();
  let workspaceIndex = -1;

  if (preferredWorkspaceId) {
    workspaceIndex = workspaceItems.findIndex((workspace) => (
      workspace.id === preferredWorkspaceId
      && Array.isArray(workspace.data?.boards)
      && workspace.data.boards.some((board: PopupNode) => board.id === boardId)
    ));
  }

  if (workspaceIndex < 0) {
    workspaceIndex = workspaceItems.findIndex((workspace) => (
      Array.isArray(workspace.data?.boards)
      && workspace.data.boards.some((board: PopupNode) => board.id === boardId)
    ));
  }

  if (workspaceIndex < 0) workspaceIndex = 0;
  navStack = [{ items: workspaceItems, activeIndex: workspaceIndex, title: 'Workspaces' }];

  const workspaceNode = workspaceItems[workspaceIndex];
  const boardItems = Array.isArray(workspaceNode?.data?.boards) ? workspaceNode.data.boards : [];
  if (boardItems.length === 0) return null;

  let boardIndex = boardItems.findIndex((board: PopupNode) => board.id === boardId);
  if (boardIndex < 0) boardIndex = 0;
  navStack.push({ items: boardItems, activeIndex: boardIndex, title: workspaceNode.title });
  return boardItems[boardIndex];
}

async function loadChildren(node: PopupNode): Promise<PopupNode[]> {
  if (node.type === 'workspace') {
    return Array.isArray(node.data?.boards) ? node.data.boards.slice() : [];
  }

  if (node.type === 'board' && node.boardId) {
    const payload = await loadBoardTargetPayload(node.boardId);
    const fullBoard = payload?.fullBoard;
    if (Array.isArray(fullBoard?.rows) && fullBoard.rows.length > 0) {
      return fullBoard.rows.map((row: any) => ({
        type: 'row',
        id: row.id,
        title: row.title || 'Default',
        detail: `${Array.isArray(row.stacks) ? row.stacks.length : 0} stacks`,
        boardId: node.boardId,
        data: row,
      }));
    }
    const columns = Array.isArray(payload?.columns) ? payload.columns : [];
    return columns.map((column: any) => ({
      type: 'column',
      id: column.id || `col-${column.index}`,
      title: column.title,
      detail: `${Array.isArray(column.cards) ? column.cards.length : 0} cards`,
      boardId: node.boardId,
      colIndex: column.index,
      data: column,
    }));
  }

  if (node.type === 'row') {
    const stacks = Array.isArray(node.data?.stacks) ? node.data.stacks : [];
    return stacks.map((stack: any) => ({
      type: 'stack',
      id: stack.id,
      title: stack.title || 'Default',
      detail: `${Array.isArray(stack.columns) ? stack.columns.length : 0} columns`,
      boardId: node.boardId,
      data: stack,
    }));
  }

  if (node.type === 'stack') {
    const columns = Array.isArray(node.data?.columns) ? node.data.columns : [];
    let flatColumns: PopupColumn[] = [];
    try {
      const payload = await loadBoardTargetPayload(node.boardId || '');
      flatColumns = Array.isArray(payload?.columns) ? payload.columns : [];
    } catch (_error) {
      flatColumns = [];
    }
    return columns.map((column: any) => {
      const flatMatch = flatColumns.find((flatColumn) => (
        (typeof flatColumn.id === 'string' && flatColumn.id === column.id)
        || flatColumn.title === column.title
      ));
      return {
        type: 'column',
        id: column.id || `col-${flatMatch?.index ?? 0}`,
        title: column.title,
        detail: `${Array.isArray(column.cards) ? column.cards.length : 0} cards`,
        boardId: node.boardId,
        colIndex: flatMatch?.index ?? 0,
        data: column,
      };
    });
  }

  if (node.type === 'column' && node.boardId && typeof node.colIndex === 'number') {
    let cards = Array.isArray(node.data?.cards) ? node.data.cards : [];
    if (cards.length === 0) {
      try {
        const payload = await loadBoardTargetPayload(node.boardId);
        const columns = Array.isArray(payload?.columns) ? payload.columns : [];
        const column = columns.find((entry: any) => entry.index === node.colIndex);
        if (column) cards = Array.isArray(column.cards) ? column.cards : [];
      } catch (_error) {
        cards = [];
      }
    }
    return cards.map((card: any) => ({
      type: 'card',
      id: card.id,
      title: typeof card.content === 'string' && card.content.length > 100
        ? `${card.content.substring(0, 100)}...`
        : card.content,
      boardId: node.boardId,
      colIndex: node.colIndex,
      cardId: card.id,
    }));
  }

  return [];
}

async function drillInto(node: PopupNode): Promise<void> {
  const children = await loadChildren(node);
  if (!children || children.length === 0) return;
  navStack.push({ items: children, activeIndex: 0, title: node.title });
  renderLevel();
}

function goUp(): void {
  if (navStack.length <= 1) return;
  navStack.pop();
  renderLevel();
}

function renderLevel(): void {
  elements.browseArea.innerHTML = '';
  const level = activeLevel();
  if (!level || level.items.length === 0) {
    elements.browseArea.innerHTML = '<div class="browse-empty">No items</div>';
    return;
  }

  if (!isSearchMode) {
    const breadcrumb = document.createElement('div');
    breadcrumb.className = 'level-breadcrumb';
    breadcrumb.textContent = `/${navStack.slice(1).map((entry) => entry.title).join('/')}`;
    elements.browseArea.appendChild(breadcrumb);
  }

  level.items.forEach((node, index) => {
    const item = document.createElement('div');
    item.className = `level-item${index === level.activeIndex ? ' active' : ''}`;
    item.dataset.index = String(index);

    const badge = document.createElement('span');
    badge.className = `item-badge badge-${node.type}`;
    badge.textContent = BADGE_LABELS[node.type];
    item.appendChild(badge);

    const info = document.createElement('div');
    info.className = 'item-info';
    if (node.context) {
      const context = document.createElement('span');
      context.className = 'item-context';
      context.textContent = node.context;
      info.appendChild(context);
    }

    const label = document.createElement('span');
    label.className = 'item-label';
    label.textContent = node.title;
    info.appendChild(label);

    if (node.detail) {
      const detail = document.createElement('span');
      detail.className = 'item-detail';
      detail.textContent = node.detail;
      info.appendChild(detail);
    }

    item.appendChild(info);

    if (node.type !== 'card') {
      const drill = document.createElement('span');
      drill.className = 'level-drill';
      drill.textContent = '›';
      item.appendChild(drill);
    }

    item.addEventListener('click', () => {
      if (isSearchMode) {
        activeSearchIndex = index;
      } else {
        const current = currentLevel();
        if (current) current.activeIndex = index;
      }
      renderLevel();
    });

    item.addEventListener('dblclick', () => {
      if (node.type === 'card') return;
      if (isSearchMode) {
        void drillFromSearch(node).catch(reportUiError);
      } else {
        void drillInto(node).catch(reportUiError);
      }
    });

    elements.browseArea.appendChild(item);
  });

  const activeItem = elements.browseArea.querySelector('.level-item.active');
  activeItem?.scrollIntoView({ block: 'nearest' });
}

function enterSearchMode(): void {
  isSearchMode = true;
}

function exitSearchMode(): void {
  isSearchMode = false;
  searchResults = [];
  activeSearchIndex = -1;
  renderLevel();
}

async function drillFromSearch(node: PopupNode): Promise<void> {
  if (node.type === 'card') return;
  isSearchMode = false;
  searchResults = [];
  activeSearchIndex = -1;
  elements.searchInput.value = '';

  if (node.type === 'workspace') {
    const workspaceItems = buildWorkspaceItems();
    const workspaceIndex = Math.max(0, workspaceItems.findIndex((workspace) => workspace.id === node.id));
    navStack = [{ items: workspaceItems, activeIndex: workspaceIndex, title: 'Workspaces' }];
    const workspaceNode = navStack[0].items[workspaceIndex];
    if (workspaceNode) {
      await drillInto(workspaceNode);
    } else {
      renderLevel();
    }
    return;
  }

  const boardNode = rebuildNavStackForBoard(node.boardId || '', node.workspaceId);
  if (!boardNode) {
    renderLevel();
    return;
  }

  if (node.type === 'board') {
    await drillInto(boardNode);
    return;
  }

  await drillInto(node);
}

function onSearchInput(): void {
  const query = elements.searchInput.value.trim();
  if (!query) {
    exitSearchMode();
    return;
  }
  activeSearchIndex = -1;
  enterSearchMode();
  renderLevel();
  if (searchDebounceTimer != null) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = window.setTimeout(() => {
    void performSearch(query).catch(reportUiError);
  }, 250);
}

async function performSearch(query: string): Promise<void> {
  const lowerQuery = query.toLowerCase();
  const results: PopupNode[] = [];
  const workspaceItems = buildWorkspaceItems();
  const boardsById: Record<string, PopupBoard> = {};

  for (const workspace of workspaceItems) {
    if (workspace.title.toLowerCase().includes(lowerQuery)) {
      results.push({
        type: 'workspace',
        id: workspace.id,
        title: workspace.title,
        detail: workspace.detail,
        workspaceId: workspace.id,
        data: workspace.data,
      });
    }
  }

  for (const board of boards) {
    boardsById[board.id] = board;
    const boardName = boardDisplayLabel(board);
    const boardWorkspaceIds = getBoardWorkspaceIds(board);
    const primaryWorkspaceId = boardWorkspaceIds[0] || UNASSIGNED_WORKSPACE_ID;
    const workspaceContext = getWorkspaceLabelsForBoard(board).join(', ');

    if (boardName.toLowerCase().includes(lowerQuery)) {
      results.push({
        type: 'board',
        id: board.id,
        title: boardName,
        context: workspaceContext,
        boardId: board.id,
        workspaceId: primaryWorkspaceId,
        columns: Array.isArray(board.columns) ? board.columns : [],
        data: board,
      });
    }

    for (const column of Array.isArray(board.columns) ? board.columns : []) {
      if ((column.title || '').toLowerCase().includes(lowerQuery)) {
        results.push({
          type: 'column',
          id: `${board.id}-col-${column.index}`,
          title: column.title,
          context: workspaceContext ? `${workspaceContext} / ${boardName}` : boardName,
          boardId: board.id,
          workspaceId: primaryWorkspaceId,
          colIndex: column.index,
          data: column,
        });
      }
    }
  }

  try {
    const remoteResults = await searchBackendCards(query);
    for (const result of remoteResults) {
      const board = boardsById[result.boardId] || null;
      const workspaceContext = board ? getWorkspaceLabelsForBoard(board).join(', ') : '';
      const workspaceId = board ? (getBoardWorkspaceIds(board)[0] || UNASSIGNED_WORKSPACE_ID) : undefined;
      results.push({
        type: 'card',
        id: result.cardId,
        title: typeof result.cardContent === 'string' && result.cardContent.length > 100
          ? `${result.cardContent.substring(0, 100)}...`
          : result.cardContent,
        context: `${workspaceContext ? `${workspaceContext} / ` : ''}${result.boardTitle} / ${result.columnTitle}`,
        boardId: result.boardId,
        workspaceId,
        colIndex: result.columnIndex,
        cardId: result.cardId,
      });
    }
  } catch (error) {
    console.log('[lexera-web-clipper] Search API error', error);
  }

  searchResults = results;
  activeSearchIndex = -1;
  enterSearchMode();
  renderLevel();
}

function buildInitialNavigator(preferredTarget?: WebClipperTarget | null): void {
  const workspaceItems = buildWorkspaceItems();
  if (workspaceItems.length === 0) {
    navStack = [{ items: [], activeIndex: -1, title: 'Workspaces' }];
    renderLevel();
    return;
  }

  if (preferredTarget?.boardId) {
    const board = boards.find((entry) => entry.id === preferredTarget.boardId);
    const preferredWorkspaceId = getBoardWorkspaceIds(board)[0] || defaultWorkspaceId || null;
    const boardNode = rebuildNavStackForBoard(preferredTarget.boardId, preferredWorkspaceId);
    if (boardNode) {
      renderLevel();
      return;
    }
  }

  let workspaceIndex = defaultWorkspaceId
    ? workspaceItems.findIndex((workspace) => workspace.id === defaultWorkspaceId)
    : -1;
  if (workspaceIndex < 0) {
    workspaceIndex = workspaceItems.findIndex((workspace) => Array.isArray(workspace.data?.boards) && workspace.data.boards.length > 0);
  }
  if (workspaceIndex < 0) workspaceIndex = 0;

  navStack = [{ items: workspaceItems, activeIndex: workspaceIndex, title: 'Workspaces' }];
  const workspaceNode = workspaceItems[workspaceIndex];
  const boardItems = Array.isArray(workspaceNode?.data?.boards) ? workspaceNode.data.boards : [];
  if (boardItems.length > 0) {
    navStack.push({ items: boardItems, activeIndex: 0, title: workspaceNode.title });
  }
  renderLevel();
}

async function resolveCaptureTargetForNode(selectedTarget: PopupNode): Promise<WebClipperTarget> {
  if (!selectedTarget.boardId) {
    throw new Error('Select a board, row, stack, column, or card');
  }

  if (selectedTarget.type === 'board') {
    return { boardId: selectedTarget.boardId };
  }

  if (selectedTarget.type === 'card') {
    return { boardId: selectedTarget.boardId, cardId: selectedTarget.cardId };
  }

  if (selectedTarget.type === 'column') {
    return { boardId: selectedTarget.boardId, colIndex: selectedTarget.colIndex };
  }

  let colIndex = 0;
  if (selectedTarget.type === 'row') {
    const stacks = Array.isArray(selectedTarget.data?.stacks) ? selectedTarget.data.stacks : [];
    if (stacks.length > 0 && Array.isArray(stacks[0].columns) && stacks[0].columns.length > 0) {
      try {
        const payload = await loadBoardTargetPayload(selectedTarget.boardId);
        const flatColumns = Array.isArray(payload?.columns) ? payload.columns : [];
        const firstColumnTitle = stacks[0].columns[0].title;
        const match = flatColumns.find((column: any) => column.title === firstColumnTitle);
        if (match && typeof match.index === 'number') colIndex = match.index;
      } catch (_error) {
        colIndex = 0;
      }
    }
  } else if (selectedTarget.type === 'stack') {
    const columns = Array.isArray(selectedTarget.data?.columns) ? selectedTarget.data.columns : [];
    if (columns.length > 0) {
      try {
        const payload = await loadBoardTargetPayload(selectedTarget.boardId);
        const flatColumns = Array.isArray(payload?.columns) ? payload.columns : [];
        const match = flatColumns.find((column: any) => column.title === columns[0].title);
        if (match && typeof match.index === 'number') colIndex = match.index;
      } catch (_error) {
        colIndex = 0;
      }
    }
  }

  return { boardId: selectedTarget.boardId, colIndex };
}

function renderPreview(context: WebClipperContext | undefined): void {
  const activeContext = context || selectedSourceContext() || previewContext;
  previewContext = activeContext;

  const title = typeof activeContext?.title === 'string' ? activeContext.title : '';
  const url = typeof activeContext?.url === 'string' ? activeContext.url : '';
  const markdownPreview = activeContext
    ? buildCaptureCardMarkdown(activeContext, {
        mode: currentClipMode(),
        includeMetadata: true,
      })
    : '';

  elements.previewTitle.textContent = title || 'No active page context';
  elements.previewUrl.textContent = url;
  elements.previewBody.textContent = trimPreview(markdownPreview, 1200) || 'Nothing extracted for this capture type.';
}

async function refreshPopup(): Promise<void> {
  setStatus('');
  setBackendStatus('Connecting to backend…');
  setResolvedBackendConnection('');
  clearBackendFailure();

  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.popupLoad,
  });
  setConfiguredSettings(
    typeof response?.configuredBackendUrl === 'string' ? response.configuredBackendUrl : '',
    response?.rememberTarget !== false,
  );
  if (!response?.ok) {
    recordBackendFailure(typeof response?.error === 'string' ? response.error : 'Failed to initialize popup');
    boards = [];
    workspaces = [];
    defaultWorkspaceId = '';
    navStack = [];
    sourceOptions = [];
    selectedSourceId = '';
    renderLevel();
    renderSourceOptions();
    renderPreview(undefined);
    setControlsEnabled(false);
    throw new Error(response?.error || 'Failed to initialize popup');
  }

  setResolvedBackendConnection(
    typeof response?.resolvedBackendUrl === 'string' ? response.resolvedBackendUrl : '',
  );
  boards = Array.isArray(response.boards) ? response.boards : [];
  workspaces = Array.isArray(response.workspaces) ? response.workspaces : [];
  defaultWorkspaceId = typeof response.defaultWorkspace === 'string' ? response.defaultWorkspace : '';
  buildInitialNavigator(response.target);
  elements.modeSelect.value = normalizeClipperMode(response.mode || DEFAULT_WEB_CLIPPER_MODE);
  setBaseSourceOptions(response.collectedContext || (response.context ? { website: response.context } : undefined));
  renderPreview(selectedSourceContext() || response.context);
  void appendFeedSourceOptions(response.collectedContext?.feedCandidates, response.context?.url || '')
    .then(() => {
      renderPreview(selectedSourceContext() || response.context);
    })
    .catch(() => undefined);
  setControlsEnabled(true);
  clearBackendFailure();
}

async function saveSettings(): Promise<void> {
  const backendUrl = currentSettingsBackendUrl();
  const rememberTarget = elements.rememberTarget.checked;

  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.popupSaveSettings,
    backendUrl,
    rememberTarget,
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'Failed to save settings');
  }

  setConfiguredSettings(
    typeof response?.configuredBackendUrl === 'string' ? response.configuredBackendUrl : backendUrl,
    response?.rememberTarget !== false,
  );
  await refreshPopup();
  setStatus('Settings saved');
  setActiveView('primary');
}

async function testConnectionNow(): Promise<void> {
  const backendUrl = currentSettingsBackendUrl();
  setSettingsTestFeedback('Testing connection…');

  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.popupTestConnection,
    backendUrl,
  });

  if (response?.ok) {
    const usedFallback = response?.usedFallback === true;
    setSettingsTestFeedback(
      usedFallback
        ? `Connected and authorized via fallback ${response.resolvedBackendUrl}`
        : `Connected and authorized at ${response.resolvedBackendUrl}`,
      'success',
      typeof response?.details === 'string' ? response.details : '',
    );
    return;
  }

  const detailParts = [
    typeof response?.error === 'string' ? response.error : 'Connection test failed',
    typeof response?.details === 'string' ? response.details : '',
  ].filter(Boolean);
  setSettingsTestFeedback(
    'Connection test failed',
    'error',
    detailParts.join('\n\n'),
  );
}

async function submitCapture(): Promise<void> {
  const mode = normalizeClipperMode(elements.modeSelect.value || DEFAULT_WEB_CLIPPER_MODE);
  const selectedTarget = activeTarget();
  const captureContext = selectedSourceContext()
    || previewContext
    || (collectedPreviewContext ? getPreferredWebClipperContext(collectedPreviewContext) : undefined);

  if (!selectedTarget || selectedTarget.type === 'workspace' || !selectedTarget.boardId) {
    throw new Error('Select a board, row, stack, column, or card');
  }
  if (!captureContext) {
    throw new Error('No page content is available to capture');
  }

  const target = await resolveCaptureTargetForNode(selectedTarget);

  const response = await sendRuntimeMessage({
    type: MESSAGE_TYPES.popupCapture,
    mode,
    rememberTarget: rememberTargetPreference,
    target,
    context: captureContext,
  });

  if (!response?.ok) {
    const errorMessage = typeof response?.error === 'string' ? response.error : 'Capture failed';
    recordBackendFailure(errorMessage);
    throw new Error(errorMessage);
  }

  setResolvedBackendConnection(
    typeof response?.resolvedBackendUrl === 'string' ? response.resolvedBackendUrl : resolvedBackendUrl,
  );
  clearBackendFailure();

  const selectedBoard = boards.find((board) => board.id === selectedTarget.boardId);
  const savedToIncoming = selectedTarget.type === 'board'
    || response.target?.source === 'incoming'
    || typeof response.target?.colIndex !== 'number';
  setStatus(
    selectedTarget.type === 'card'
      ? `Appended ${mode} to ${selectedTarget.title}`
      : savedToIncoming
        ? `Saved ${mode} to incoming of ${boardDisplayLabel(selectedBoard) || selectedTarget.boardId}`
        : `Saved ${mode} to ${selectedTarget.context ? `${selectedTarget.context} / ${selectedTarget.title}` : selectedTarget.title}`,
  );
  setBaseSourceOptions(response.collectedContext || collectedPreviewContext);
  renderPreview(selectedSourceContext() || response.context);
  void appendFeedSourceOptions(response.collectedContext?.feedCandidates, response.context?.url || '')
    .then(() => {
      renderPreview(selectedSourceContext() || response.context);
    })
    .catch(() => undefined);
}

elements.refreshButton.addEventListener('click', () => {
  refreshPopup().catch(reportUiError);
});

elements.settingsButton.addEventListener('click', () => {
  openSettingsView();
});

elements.settingsBackButton.addEventListener('click', () => {
  closeSettingsView();
});

elements.settingsTestButton.addEventListener('click', () => {
  testConnectionNow().catch((error) => {
    setSettingsTestFeedback(
      'Connection test failed',
      'error',
      error instanceof Error ? error.message : String(error),
    );
  });
});

elements.settingsSaveButton.addEventListener('click', () => {
  saveSettings().catch(reportUiError);
});

elements.captureButton.addEventListener('click', () => {
  submitCapture().catch(reportUiError);
});

elements.modeSelect.addEventListener('change', () => {
  renderPreview(selectedSourceContext() || previewContext);
});

elements.sourceSelect.addEventListener('change', () => {
  selectedSourceId = elements.sourceSelect.value;
  renderPreview(selectedSourceContext() || previewContext);
});

elements.searchInput.addEventListener('input', () => {
  onSearchInput();
});

elements.backendUrlInput.addEventListener('input', () => {
  clearSettingsTestFeedback();
});

window.addEventListener('paste', (event) => {
  if (activeView === 'settings') return;
  if (document.activeElement === elements.backendUrlInput) return;
  if (isSearchInputFocused()) return;
  const text = event.clipboardData?.getData('text');
  if (!text) return;
  event.preventDefault();
  insertIntoSearchInput(text);
});

window.addEventListener('keydown', (event) => {
  if (activeView === 'settings') {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSettingsView();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void saveSettings().catch(reportUiError);
    }
    return;
  }

  const level = activeLevel();
  const searchFocused = isSearchInputFocused();
  const query = elements.searchInput.value.trim();
  const editableControlFocused = document.activeElement === elements.backendUrlInput;

  if (event.key === 'Escape') {
    if (isSearchMode || elements.searchInput.value.trim()) {
      event.preventDefault();
      elements.searchInput.value = '';
      exitSearchMode();
    }
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
    if (editableControlFocused) return;
    if (!searchFocused) {
      focusSearchInput();
    }
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (isSearchMode && query) {
      activateSearchSelection('down');
      return;
    }
    if (!level || level.items.length === 0) return;
    const maxIndex = level.items.length - 1;
    const nextIndex = Math.min((level.activeIndex < 0 ? -1 : level.activeIndex) + 1, maxIndex);
    if (isSearchMode) {
      activeSearchIndex = nextIndex;
    } else {
      const current = currentLevel();
      if (current) current.activeIndex = nextIndex;
    }
    renderLevel();
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (isSearchMode && query) {
      activateSearchSelection('up');
      return;
    }
    if (!level || level.items.length === 0) return;
    const nextIndex = Math.max((level.activeIndex < 0 ? 1 : level.activeIndex) - 1, 0);
    if (isSearchMode) {
      activeSearchIndex = nextIndex;
    } else {
      const current = currentLevel();
      if (current) current.activeIndex = nextIndex;
    }
    renderLevel();
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (isSearchMode && activeSearchIndex < 0) return;
    if (!level || level.activeIndex < 0 || level.activeIndex >= level.items.length) return;
    const node = level.items[level.activeIndex];
    if (node.type === 'card') return;
    if (isSearchMode) {
      void drillFromSearch(node).catch(reportUiError);
    } else {
      void drillInto(node).catch(reportUiError);
    }
    return;
  }

  if (event.key === 'ArrowLeft' && !isSearchMode) {
    event.preventDefault();
    goUp();
    return;
  }

  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void submitCapture().catch(reportUiError);
    return;
  }

  if (event.key === 'Enter') {
    if (editableControlFocused || (searchFocused && activeSearchIndex < 0)) return;
    event.preventDefault();
    void submitCapture().catch(reportUiError);
    return;
  }

  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && !editableControlFocused && !searchFocused) {
    event.preventDefault();
    insertIntoSearchInput(event.key);
  }
});

setActiveView('primary');
syncSettingsFields();
renderSettingsConnection();
setControlsEnabled(false);
refreshPopup().catch((error) => {
  reportUiError(error);
});
