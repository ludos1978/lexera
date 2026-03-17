declare const browser: any;
declare const chrome: any;

function getNamespace(): any {
  if (typeof globalThis.browser !== 'undefined') return globalThis.browser;
  if (typeof globalThis.chrome !== 'undefined') return globalThis.chrome;
  if (typeof browser !== 'undefined') return browser;
  if (typeof chrome !== 'undefined') return chrome;
  throw new Error('Browser extension APIs are unavailable');
}

export const extensionApi = getNamespace();
const NOTIFICATION_ICON =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s6mL4AAAAAASUVORK5CYII=';

function maybePromise(result: any, resolve: (value: any) => void, reject: (error: Error) => void): void {
  if (!result || typeof result.then !== 'function') return;
  result.then(resolve).catch(reject);
}

function callbackCall(target: any, methodName: string, args: any[] = []): Promise<any> {
  const method = target?.[methodName];
  if (typeof method !== 'function') {
    return Promise.reject(new Error(`Missing browser API method ${methodName}`));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finishResolve = (value: any) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    try {
      const result = method.call(target, ...args, (value: any) => {
        const runtimeError = extensionApi?.runtime?.lastError;
        if (runtimeError) {
          finishReject(new Error(runtimeError.message || String(runtimeError)));
          return;
        }
        finishResolve(value);
      });
      maybePromise(result, finishResolve, finishReject);
    } catch (error) {
      finishReject(error as Error);
    }
  });
}

export function addRuntimeMessageListener(
  handler: (message: any, sender: any) => Promise<any> | any,
): void {
  extensionApi.runtime.onMessage.addListener((message: any, sender: any, sendResponse: (value: any) => void) => {
    Promise.resolve(handler(message, sender))
      .then((value) => sendResponse(value))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
}

export function addInstalledListener(handler: () => void): void {
  extensionApi.runtime.onInstalled.addListener(() => handler());
}

export function addStartupListener(handler: () => void): void {
  if (extensionApi?.runtime?.onStartup?.addListener) {
    extensionApi.runtime.onStartup.addListener(() => handler());
  }
}

export async function getLocalStorage<T = Record<string, unknown>>(keys: string | string[] | Record<string, unknown>): Promise<T> {
  return callbackCall(extensionApi.storage.local, 'get', [keys]);
}

export async function setLocalStorage(values: Record<string, unknown>): Promise<void> {
  await callbackCall(extensionApi.storage.local, 'set', [values]);
}

export async function queryTabs(queryInfo: Record<string, unknown>): Promise<any[]> {
  return callbackCall(extensionApi.tabs, 'query', [queryInfo]);
}

export async function sendRuntimeMessage(message: any): Promise<any> {
  return callbackCall(extensionApi.runtime, 'sendMessage', [message]);
}

export async function sendTabMessage(tabId: number, message: any): Promise<any> {
  return callbackCall(extensionApi.tabs, 'sendMessage', [tabId, message]);
}

export async function executeScript(details: Record<string, unknown>): Promise<any> {
  return callbackCall(extensionApi.scripting, 'executeScript', [details]);
}

export async function removeAllContextMenus(): Promise<void> {
  await callbackCall(extensionApi.contextMenus, 'removeAll', []);
}

export async function createContextMenu(createProperties: Record<string, unknown>): Promise<void> {
  try {
    await callbackCall(extensionApi.contextMenus, 'create', [createProperties]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/duplicate id/i.test(message)) {
      return;
    }
    throw error;
  }
}

export function addContextMenuListener(handler: (info: any, tab: any) => void): void {
  extensionApi.contextMenus.onClicked.addListener((info: any, tab: any) => handler(info, tab));
}

export async function showNotification(title: string, message: string): Promise<void> {
  const notificationId = `lexera-web-clipper-${Date.now()}`;
  await callbackCall(extensionApi.notifications, 'create', [
    notificationId,
    {
      type: 'basic',
      iconUrl: NOTIFICATION_ICON,
      title,
      message,
    },
  ]).catch(() => undefined);
}
