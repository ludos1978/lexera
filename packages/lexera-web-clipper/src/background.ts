import {
  DEFAULT_WEB_CLIPPER_MODE,
  WebClipperContext,
  WebClipperMode,
  WebClipperTarget,
  extractUrlHostLabel,
  normalizeClipperMode,
  trimPreview,
} from '../../shared/src/webClipper';
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
  listColumns,
  readClipperState,
  resolveCaptureTarget,
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

async function collectTabContext(tab: any): Promise<WebClipperContext> {
  const fallbackContext: WebClipperContext = {
    url: typeof tab?.url === 'string' ? tab.url : '',
    title: typeof tab?.title === 'string' ? tab.title : '',
    capturedAt: new Date().toISOString(),
  };

  if (!tabCanBeInspected(tab)) {
    return fallbackContext;
  }

  try {
    await ensureContentCapture(tab.id);
    const response = await sendTabMessage(tab.id, { type: MESSAGE_TYPES.contentCollect });
    if (response?.ok && response.context) {
      return {
        ...fallbackContext,
        ...response.context,
      };
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
  const backendUrl = await discoverBackend(state.backendUrl);
  if (!backendUrl) {
    return {
      ok: false,
      error: 'Lexera Backend is not reachable on localhost',
      backendUrl: state.backendUrl || '',
    };
  }

  const [boards, activeTab, target] = await Promise.all([
    listBoards(backendUrl),
    getActiveTab(),
    resolveCaptureTarget(backendUrl, state.target),
  ]);
  const context = await collectTabContext(activeTab);
  const columns = target?.boardId ? await listColumns(backendUrl, target.boardId) : [];

  await writeClipperState({ backendUrl });

  return {
    ok: true,
    backendUrl,
    boards,
    columns,
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

async function performCapture(mode: WebClipperMode, explicitTarget?: WebClipperTarget | null): Promise<any> {
  const state = await readClipperState();
  const backendUrl = await discoverBackend(state.backendUrl);
  if (!backendUrl) {
    throw new Error('Lexera Backend is not reachable');
  }

  const target = await resolveCaptureTarget(backendUrl, explicitTarget || state.target);
  const activeTab = await getActiveTab();
  const context = await collectTabContext(activeTab);
  const result = await captureContextToBoard(backendUrl, target, mode, context);

  await writeClipperState({
    backendUrl,
    mode,
  });

  return {
    ok: true,
    backendUrl,
    target,
    context,
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
    const target = await resolveCaptureTarget(backendUrl, state.target);
    const baseContext = await collectTabContext(tab);
    const context = mergeContextMenuInfo(mode, baseContext, info, tab);

    await captureContextToBoard(backendUrl, target, mode, context);
    await writeClipperState({
      backendUrl,
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
      const preferredBackendUrl = typeof message.backendUrl === 'string' ? message.backendUrl.trim() : '';
      if (typeof message.backendUrl === 'string') {
        await writeClipperState({ backendUrl: preferredBackendUrl });
      }
      return loadPopupState();
    }

    case MESSAGE_TYPES.popupLoadColumns: {
      const state = await readClipperState();
      const preferredBackendUrl = typeof message.backendUrl === 'string' ? message.backendUrl.trim() : '';
      if (typeof message.backendUrl === 'string') {
        await writeClipperState({ backendUrl: preferredBackendUrl });
      }
      const backendUrl = await discoverBackend(preferredBackendUrl || state.backendUrl);
      if (!backendUrl) {
        return { ok: false, error: 'Lexera Backend is not reachable' };
      }
      const columns = await listColumns(backendUrl, message.boardId);
      return { ok: true, columns };
    }

    case MESSAGE_TYPES.popupSetBackendUrl: {
      const preferredBackendUrl = typeof message.backendUrl === 'string' ? message.backendUrl.trim() : '';
      await writeClipperState({ backendUrl: preferredBackendUrl });
      return { ok: true };
    }

    case MESSAGE_TYPES.popupCapture: {
      const mode = normalizeClipperMode(message.mode || DEFAULT_WEB_CLIPPER_MODE);
      const explicitTarget = message.target || null;
      const preferredBackendUrl = typeof message.backendUrl === 'string' ? message.backendUrl.trim() : '';
      if (typeof message.backendUrl === 'string') {
        await writeClipperState({ backendUrl: preferredBackendUrl });
      }
      const result = await performCapture(mode, explicitTarget);
      if (message.rememberTarget !== false && explicitTarget?.boardId) {
        await writeClipperState({
          target: {
            ...explicitTarget,
            source: 'saved',
          },
          mode,
          backendUrl: preferredBackendUrl || result.backendUrl,
        });
      }
      return result;
    }

    default:
      return { ok: false, error: 'Unknown message type' };
  }
});
