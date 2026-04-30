import {
  DEFAULT_WEB_CLIPPER_MODE,
  WebClipperCollectedPageContext,
  WebClipperContext,
  WebClipperMode,
  WebClipperTarget,
  extractUrlHostLabel,
  getPreferredWebClipperContext,
  normalizeClipperMode,
  trimPreview,
} from '@lexera/shared';
import {
  addContextMenuListener,
  addInstalledListener,
  addRuntimeMessageListener,
  addStartupListener,
  executeScript,
  queryTabs,
  removeAllContextMenus,
  createContextMenu,
  sendTabMessage,
  showNotification,
} from './shared/browser';
import {
  discoverBackend,
  listBoards,
  listWorkspaces,
  loadBoardTargetData,
  readClipperState,
  resolveCaptureTarget,
  searchCards,
  testBackendConnection,
  writeClipperState,
} from './shared/backend';
import { captureContextToBoard } from './shared/clipper';
import { CONTEXT_MENU_IDS, MESSAGE_TYPES } from './shared/messages';

function clipModeForMenuItem(menuItemId: string): WebClipperMode {
  switch (menuItemId) {
    case CONTEXT_MENU_IDS.selection:
      return 'selection';
    case CONTEXT_MENU_IDS.link:
      return 'link';
    case CONTEXT_MENU_IDS.image:
      return 'image';
    default:
      return 'article';
  }
}

function tabCanBeInspected(tab: any): boolean {
  return typeof tab?.id === 'number'
    && typeof tab?.url === 'string'
    && /^(https?|file):/i.test(tab.url);
}

async function ensureContentCapture(tabId: number): Promise<void> {
  await executeScript({
    target: { tabId },
    files: ['content.js'],
  });
}

function fallbackCollectedContext(tab: any): WebClipperCollectedPageContext {
  const fallbackContext: WebClipperContext = {
    url: typeof tab?.url === 'string' ? tab.url : '',
    title: typeof tab?.title === 'string' ? tab.title : '',
    sourceType: 'website',
    sourceLabel: 'Website',
    capturedAt: new Date().toISOString(),
  };
  return { website: fallbackContext, feedCandidates: [] };
}

function normalizeCollectedContext(
  tab: any,
  collection: any,
  context: any,
): WebClipperCollectedPageContext {
  const fallback = fallbackCollectedContext(tab);
  const website = collection?.website || context || {};
  const normalizedWebsite: WebClipperContext = {
    ...fallback.website,
    ...website,
    sourceType: website?.sourceType || 'website',
    sourceLabel: website?.sourceLabel || 'Website',
  };
  const normalizedReader = collection?.reader
    ? {
        ...normalizedWebsite,
        ...collection.reader,
        sourceType: 'reader' as const,
        sourceLabel: collection.reader?.sourceLabel || 'Reader',
      }
    : undefined;

  return {
    website: normalizedWebsite,
    reader: normalizedReader,
    feedCandidates: Array.isArray(collection?.feedCandidates) ? collection.feedCandidates : [],
  };
}

async function collectTabContext(tab: any): Promise<WebClipperCollectedPageContext> {
  const fallbackContext = fallbackCollectedContext(tab);

  if (!tabCanBeInspected(tab)) {
    return fallbackContext;
  }

  try {
    await ensureContentCapture(tab.id);
    const response = await sendTabMessage(tab.id, { type: MESSAGE_TYPES.contentCollect });
    if (response?.ok) {
      return normalizeCollectedContext(tab, response.collection, response.context);
    }
  } catch (_error) {
    return fallbackContext;
  }

  return fallbackContext;
}

async function getActiveTab(): Promise<any | null> {
  const tabs = await queryTabs({
    active: true,
    currentWindow: true,
  });
  return tabs[0] || null;
}

async function loadPopupState(): Promise<any> {
  const state = await readClipperState();
  const configuredBackendUrl = typeof state.backendUrl === 'string' ? state.backendUrl.trim() : '';
  const rememberTarget = state.rememberTarget !== false;
  const resolvedBackendUrl = await discoverBackend(configuredBackendUrl);
  if (!resolvedBackendUrl) {
    return {
      ok: false,
      error: 'Lexera Backend is not reachable on localhost',
      configuredBackendUrl,
      resolvedBackendUrl: '',
      rememberTarget,
    };
  }

  const [boards, workspacePayload, activeTab, target] = await Promise.all([
    listBoards(resolvedBackendUrl),
    listWorkspaces(resolvedBackendUrl),
    getActiveTab(),
    resolveCaptureTarget(resolvedBackendUrl),
  ]);
  const collectedContext = await collectTabContext(activeTab);
  const context = getPreferredWebClipperContext(collectedContext);
  const targetData = target?.boardId ? await loadBoardTargetData(resolvedBackendUrl, target.boardId) : null;

  return {
    ok: true,
    configuredBackendUrl,
    resolvedBackendUrl,
    rememberTarget,
    boards,
    workspaces: workspacePayload.workspaces,
    defaultWorkspace: workspacePayload.defaultWorkspace || null,
    columns: targetData?.columns || [],
    fullBoard: targetData?.fullBoard || null,
    collectedContext,
    context,
    target,
    mode: normalizeClipperMode(state.mode || DEFAULT_WEB_CLIPPER_MODE),
  };
}

function mergeContextMenuInfo(
  mode: WebClipperMode,
  baseContext: WebClipperContext,
  info: any,
  tab: any,
): WebClipperContext {
  const nextContext: WebClipperContext = {
    ...baseContext,
    url: baseContext.url || info.pageUrl || tab?.url || '',
    title: baseContext.title || tab?.title || '',
  };

  if (mode === 'selection' && typeof info.selectionText === 'string' && info.selectionText.trim()) {
    nextContext.selectionText = info.selectionText.trim();
  }

  if (mode === 'link' && typeof info.linkUrl === 'string' && info.linkUrl.trim()) {
    nextContext.linkUrl = info.linkUrl.trim();
    nextContext.linkText = nextContext.title || extractUrlHostLabel(info.linkUrl.trim());
  }

  if (mode === 'image' && typeof info.srcUrl === 'string' && info.srcUrl.trim()) {
    nextContext.imageUrl = info.srcUrl.trim();
    nextContext.imageAlt = nextContext.imageAlt || nextContext.title || 'image';
  }

  nextContext.capturedAt = new Date().toISOString();
  return nextContext;
}

async function performCapture(
  mode: WebClipperMode,
  explicitTarget?: WebClipperTarget | null,
  explicitContext?: WebClipperContext | null,
): Promise<any> {
  const state = await readClipperState();
  const resolvedBackendUrl = await discoverBackend(state.backendUrl);
  if (!resolvedBackendUrl) {
    throw new Error('Lexera Backend is not reachable');
  }

  const target = await resolveCaptureTarget(resolvedBackendUrl, explicitTarget || null);
  const activeTab = await getActiveTab();
  const collectedContext = await collectTabContext(activeTab);
  const context = explicitContext || getPreferredWebClipperContext(collectedContext);
  const result = await captureContextToBoard(resolvedBackendUrl, target, mode, context);

  await writeClipperState({
    mode,
  });

  return {
    ok: true,
    resolvedBackendUrl,
    target,
    context,
    collectedContext,
    markdownPreview: trimPreview(result.markdown, 400),
  };
}

let contextMenuSetupPromise: Promise<void> | null = null;

async function setupContextMenus(): Promise<void> {
  if (contextMenuSetupPromise) {
    return contextMenuSetupPromise;
  }

  contextMenuSetupPromise = (async () => {
    await removeAllContextMenus();
    await createContextMenu({
      id: CONTEXT_MENU_IDS.page,
      title: 'Clip page to Lexera',
      contexts: ['page'],
    });
    await createContextMenu({
      id: CONTEXT_MENU_IDS.selection,
      title: 'Clip selection to Lexera',
      contexts: ['selection'],
    });
    await createContextMenu({
      id: CONTEXT_MENU_IDS.link,
      title: 'Clip link to Lexera',
      contexts: ['link'],
    });
    await createContextMenu({
      id: CONTEXT_MENU_IDS.image,
      title: 'Clip image to Lexera',
      contexts: ['image'],
    });
  })();

  try {
    await contextMenuSetupPromise;
  } finally {
    contextMenuSetupPromise = null;
  }
}

addInstalledListener(async () => {
  await setupContextMenus().catch(() => undefined);
});

addStartupListener(async () => {
  await setupContextMenus().catch(() => undefined);
});

addContextMenuListener(async (info, tab) => {
  try {
    const state = await readClipperState();
    const backendUrl = await discoverBackend(state.backendUrl);
    if (!backendUrl) {
      throw new Error('Lexera Backend is not reachable');
    }

    const mode = clipModeForMenuItem(info.menuItemId);
    const target = await resolveCaptureTarget(backendUrl);
    const collectedContext = await collectTabContext(tab);
    const baseContext = getPreferredWebClipperContext(collectedContext);
    const context = mergeContextMenuInfo(mode, baseContext, info, tab);

    await captureContextToBoard(backendUrl, target, mode, context);
    await writeClipperState({
      mode,
    });
    await showNotification('Lexera Web Clipper', `Saved ${mode} to ${target.boardId}`);
  } catch (error) {
    await showNotification(
      'Lexera Web Clipper',
      error instanceof Error ? error.message : String(error),
    );
  }
});

addRuntimeMessageListener(async (message) => {
  switch (message?.type) {
    case MESSAGE_TYPES.popupLoad: {
      return loadPopupState();
    }

    case MESSAGE_TYPES.popupLoadColumns: {
      const state = await readClipperState();
      const backendUrl = await discoverBackend(state.backendUrl);
      if (!backendUrl) {
        return { ok: false, error: 'Lexera Backend is not reachable' };
      }
      const targetData = await loadBoardTargetData(backendUrl, message.boardId);
      return { ok: true, columns: targetData.columns, fullBoard: targetData.fullBoard || null };
    }

    case MESSAGE_TYPES.popupSearch: {
      const state = await readClipperState();
      const backendUrl = await discoverBackend(state.backendUrl);
      if (!backendUrl) {
        return { ok: false, error: 'Lexera Backend is not reachable' };
      }
      const query = typeof message.query === 'string' ? message.query.trim() : '';
      const results = query ? await searchCards(backendUrl, query) : [];
      return { ok: true, results };
    }

    case MESSAGE_TYPES.popupSaveSettings: {
      const backendUrl = typeof message.backendUrl === 'string' ? message.backendUrl.trim() : '';
      const rememberTarget = message.rememberTarget !== false;
      await writeClipperState({
        backendUrl,
        rememberTarget,
        ...(rememberTarget ? {} : { target: undefined }),
      });
      return {
        ok: true,
        configuredBackendUrl: backendUrl,
        rememberTarget,
      };
    }

    case MESSAGE_TYPES.popupTestConnection: {
      const backendUrl = typeof message.backendUrl === 'string' ? message.backendUrl.trim() : '';
      return testBackendConnection(backendUrl);
    }

    case MESSAGE_TYPES.popupCapture: {
      const mode = normalizeClipperMode(message.mode || DEFAULT_WEB_CLIPPER_MODE);
      const explicitTarget = message.target || null;
      const explicitContext = message.context || null;
      const rememberTarget = message.rememberTarget !== false;
      await writeClipperState({
        rememberTarget,
        ...(rememberTarget ? {} : { target: undefined }),
      });
      const result = await performCapture(mode, explicitTarget, explicitContext);
      if (rememberTarget && explicitTarget?.boardId) {
        await writeClipperState({
          target: {
            ...explicitTarget,
            source: 'saved',
          },
          mode,
          rememberTarget,
        });
      } else {
        await writeClipperState({
          target: undefined,
          mode,
          rememberTarget,
        });
      }
      return result;
    }

    default:
      return { ok: false, error: 'Unknown message type' };
  }
});
