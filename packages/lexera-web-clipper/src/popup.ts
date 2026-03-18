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
} from '../../shared/src/webClipper';
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
  backendStatus: document.getElementById('backend-status') as HTMLParagraphElement,
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

function currentBackendUrl(): string {
  return elements.backendUrlInput.value.trim();
}

async function apiGet(path: string): Promise<any> {
  const response = await fetch(`${currentBackendUrl().replace(/\/+$/, '')}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status}`);
  }
  return response.json();
}

function setStatus(message: string): void {
  elements.resultStatus.textContent = message;
}

function setBackendStatus(message: string): void {
  elements.backendStatus.textContent = message;
}

function setControlsEnabled(enabled: boolean): void {
  elements.searchInput.disabled = !enabled;
  elements.modeSelect.disabled = !enabled;
  elements.sourceSelect.disabled = !enabled || sourceOptions.length <= 1;
  elements.rememberTarget.disabled = !enabled;
  elements.captureButton.disabled = !enabled;
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
    const payload = await apiGet(`/boards/${encodeURIComponent(node.boardId)}/columns`);
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
      const payload = await apiGet(`/boards/${encodeURIComponent(node.boardId || '')}/columns`);
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
        const payload = await apiGet(`/boards/${encodeURIComponent(node.boardId)}/columns`);
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
        void drillFromSearch(node);
      } else {
        void drillInto(node);
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
    void performSearch(query);
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
    const payload = await apiGet(`/search?q=${encodeURIComponent(query)}`);
    const remoteResults = Array.isArray(payload?.results) ? payload.results : [];
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
        const payload = await apiGet(`/boards/${encodeURIComponent(selectedTarget.boardId)}/columns`);
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
        const payload = await apiGet(`/boards/${encodeURIComponent(selectedTarget.boardId)}/columns`);
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
  setBackendStatus(`Connected to ${response.backendUrl}`);
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
    backendUrl: currentBackendUrl(),
    rememberTarget: elements.rememberTarget.checked,
    target,
    context: captureContext,
  });

  if (!response?.ok) {
    throw new Error(response?.error || 'Capture failed');
  }

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
  refreshPopup().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
});

elements.captureButton.addEventListener('click', () => {
  submitCapture().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
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

window.addEventListener('paste', (event) => {
  if (document.activeElement === elements.backendUrlInput) return;
  if (isSearchInputFocused()) return;
  const text = event.clipboardData?.getData('text');
  if (!text) return;
  event.preventDefault();
  insertIntoSearchInput(text);
});

elements.backendUrlInput.addEventListener('change', () => {
  sendRuntimeMessage({
    type: MESSAGE_TYPES.popupSetBackendUrl,
    backendUrl: currentBackendUrl(),
  }).catch(() => undefined);
});

window.addEventListener('keydown', (event) => {
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
      void drillFromSearch(node);
    } else {
      void drillInto(node);
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
    void submitCapture().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
    return;
  }

  if (event.key === 'Enter') {
    if (editableControlFocused || (searchFocused && activeSearchIndex < 0)) return;
    event.preventDefault();
    void submitCapture().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
    return;
  }

  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && !editableControlFocused && !searchFocused) {
    event.preventDefault();
    insertIntoSearchInput(event.key);
  }
});

setControlsEnabled(false);
refreshPopup().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error));
});
