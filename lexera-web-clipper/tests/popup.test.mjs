import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPopupBundle } from './helpers/load-popup-bundle.mjs';

function createPopupLoadResponse(overrides = {}) {
  const websiteContext = {
    url: 'https://example.com/article',
    title: 'Example Article',
    sourceType: 'website',
    sourceLabel: 'Website',
    capturedAt: '2026-03-27T00:00:00.000Z',
  };

  return {
    ok: true,
    configuredBackendUrl: '',
    resolvedBackendUrl: 'http://127.0.0.1:13080',
    rememberTarget: true,
    boards: [
      {
        id: 'board-1',
        title: 'Board 1',
        workspaceIds: ['workspace-1'],
        columns: [{ index: 0, title: 'Inbox' }],
      },
    ],
    workspaces: [
      {
        id: 'workspace-1',
        name: 'Workspace 1',
      },
    ],
    defaultWorkspace: 'workspace-1',
    target: {
      boardId: 'board-1',
    },
    mode: 'article',
    context: websiteContext,
    collectedContext: {
      website: websiteContext,
      feedCandidates: [],
    },
    ...overrides,
  };
}

test('the popup keeps connection configuration in the dedicated settings view', async () => {
  const popup = await loadPopupBundle({
    handleMessage(message) {
      assert.equal(message.type, 'popup/load');
      return createPopupLoadResponse({
        configuredBackendUrl: 'http://preferred.local:9999',
        rememberTarget: false,
      });
    },
  });

  try {
    const { document, calls } = popup;
    assert.deepEqual(calls.map((call) => call.type), ['popup/load']);
    assert.equal(document.getElementById('backend-status').textContent, 'Connected and authorized');
    assert.equal(document.getElementById('primary-view').hidden, false);
    assert.equal(document.getElementById('settings-view').hidden, true);
    assert.equal(document.getElementById('primary-view').querySelector('#backend-url-input'), null);
    assert.equal(document.getElementById('backend-url-input').value, 'http://preferred.local:9999');
    assert.equal(document.getElementById('remember-target').checked, false);
    assert.equal(document.getElementById('settings-connection').textContent, 'Authorized at http://127.0.0.1:13080');
    assert.equal(document.getElementById('settings-connection-error').hidden, true);
  } finally {
    popup.cleanup();
  }
});

test('saving popup settings is explicit and refreshes the primary view state', async () => {
  let popupState = createPopupLoadResponse();
  const popup = await loadPopupBundle({
    handleMessage(message) {
      if (message.type === 'popup/load') {
        return popupState;
      }
      if (message.type === 'popup/save-settings') {
        popupState = createPopupLoadResponse({
          configuredBackendUrl: message.backendUrl,
          rememberTarget: message.rememberTarget,
        });
        return {
          ok: true,
          configuredBackendUrl: message.backendUrl,
          rememberTarget: message.rememberTarget,
        };
      }
      throw new Error(`Unexpected popup message: ${message.type}`);
    },
  });

  try {
    const { document, calls } = popup;
    document.getElementById('settings-button').click();
    await popup.flush();

    assert.equal(document.getElementById('primary-view').hidden, true);
    assert.equal(document.getElementById('settings-view').hidden, false);

    const backendUrlInput = document.getElementById('backend-url-input');
    const rememberTarget = document.getElementById('remember-target');
    backendUrlInput.value = 'http://127.0.0.1:13080';
    rememberTarget.checked = false;

    document.getElementById('settings-save-button').click();
    await popup.flush(6);

    assert.deepEqual(calls.map((call) => call.type), [
      'popup/load',
      'popup/save-settings',
      'popup/load',
    ]);
    assert.equal(calls[1].backendUrl, 'http://127.0.0.1:13080');
    assert.equal(calls[1].rememberTarget, false);
    assert.equal(document.getElementById('primary-view').hidden, false);
    assert.equal(document.getElementById('settings-view').hidden, true);
    assert.equal(document.getElementById('backend-url-input').value, 'http://127.0.0.1:13080');
    assert.equal(document.getElementById('remember-target').checked, false);
    assert.equal(document.getElementById('backend-status').textContent, 'Connected and authorized');
    assert.equal(document.getElementById('result-status').textContent, 'Settings saved');
  } finally {
    popup.cleanup();
  }
});

test('the popup can initialize through promise-style browser messaging', async () => {
  const popup = await loadPopupBundle({
    apiStyle: 'promise',
    handleMessage(message) {
      assert.equal(message.type, 'popup/load');
      return createPopupLoadResponse({
        configuredBackendUrl: 'http://preferred.local:9999',
      });
    },
  });

  try {
    const { document, calls } = popup;
    assert.deepEqual(calls.map((call) => call.type), ['popup/load']);
    assert.equal(document.getElementById('backend-status').textContent, 'Connected and authorized');
    assert.equal(document.getElementById('backend-url-input').value, 'http://preferred.local:9999');
  } finally {
    popup.cleanup();
  }
});

test('the settings view shows connection test failure details', async () => {
  const popup = await loadPopupBundle({
    handleMessage(message) {
      if (message.type === 'popup/load') {
        return createPopupLoadResponse();
      }
      if (message.type === 'popup/test-connection') {
        return {
          ok: false,
          error: 'Could not connect to http://bad.example:13080',
          details: 'http://bad.example:13080: HTTP 500 Internal Server Error\n{"error":"boom"}',
        };
      }
      throw new Error(`Unexpected popup message: ${message.type}`);
    },
  });

  try {
    const { document, calls } = popup;
    document.getElementById('settings-button').click();
    await popup.flush();

    const backendUrlInput = document.getElementById('backend-url-input');
    backendUrlInput.value = 'http://bad.example:13080';
    backendUrlInput.dispatchEvent(new popup.window.Event('input', { bubbles: true }));
    document.getElementById('settings-test-button').click();
    await popup.flush(6);

    assert.deepEqual(calls.map((call) => call.type), [
      'popup/load',
      'popup/test-connection',
    ]);
    assert.equal(document.getElementById('settings-test-status').textContent, 'Connection test failed');
    assert.equal(document.getElementById('settings-test-response').hidden, false);
    assert.equal(
      document.getElementById('settings-test-response').textContent.includes('HTTP 500 Internal Server Error'),
      true,
    );
    assert.equal(
      document.getElementById('settings-test-response').textContent.includes('{"error":"boom"}'),
      true,
    );
  } finally {
    popup.cleanup();
  }
});

test('the target browser loads board details through background messages instead of direct fetches', async () => {
  const popup = await loadPopupBundle({
    handleMessage(message) {
      if (message.type === 'popup/load') {
        return createPopupLoadResponse();
      }
      if (message.type === 'popup/load-columns') {
        return {
          ok: true,
          columns: [{ index: 0, title: 'Inbox', cards: [] }],
          fullBoard: {
            rows: [
              {
                id: 'row-1',
                title: 'Row 1',
                stacks: [],
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected popup message: ${message.type}`);
    },
  });

  try {
    const { document, calls, window } = popup;
    const activeItem = document.querySelector('.level-item.active');
    assert.ok(activeItem);
    activeItem.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    await popup.flush(6);

    assert.deepEqual(calls.map((call) => call.type), [
      'popup/load',
      'popup/load-columns',
    ]);
    assert.equal(document.querySelector('.item-badge')?.textContent, 'Row');
  } finally {
    popup.cleanup();
  }
});

test('runtime board-load auth failures update the connection state and error detail', async () => {
  const popup = await loadPopupBundle({
    handleMessage(message) {
      if (message.type === 'popup/load') {
        return createPopupLoadResponse();
      }
      if (message.type === 'popup/load-columns') {
        return {
          ok: false,
          error: '401 Unauthorized: Unauthorized',
        };
      }
      throw new Error(`Unexpected popup message: ${message.type}`);
    },
  });

  try {
    const { document, calls, window } = popup;
    const activeItem = document.querySelector('.level-item.active');
    assert.ok(activeItem);
    activeItem.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    await popup.flush(6);

    assert.deepEqual(calls.map((call) => call.type), [
      'popup/load',
      'popup/load-columns',
    ]);
    assert.equal(document.getElementById('backend-status').textContent, 'Backend auth failed');
    assert.equal(
      document.getElementById('settings-connection').textContent,
      'Backend at http://127.0.0.1:13080 reached, but authorization failed',
    );
    assert.equal(document.getElementById('settings-connection-error').hidden, false);
    assert.equal(document.getElementById('settings-connection-error').textContent, '401 Unauthorized: Unauthorized');
    assert.equal(document.getElementById('result-status').textContent, '401 Unauthorized: Unauthorized');
  } finally {
    popup.cleanup();
  }
});

test('startup auth failures are surfaced as auth failures instead of backend unavailability', async () => {
  const popup = await loadPopupBundle({
    handleMessage(message) {
      if (message.type === 'popup/load') {
        return {
          ok: false,
          configuredBackendUrl: 'http://127.0.0.1:13080',
          resolvedBackendUrl: '',
          rememberTarget: true,
          error: '401 Unauthorized: Unauthorized',
        };
      }
      throw new Error(`Unexpected popup message: ${message.type}`);
    },
  });

  try {
    const { document, calls } = popup;
    assert.deepEqual(calls.map((call) => call.type), ['popup/load']);
    assert.equal(document.getElementById('backend-status').textContent, 'Backend auth failed');
    assert.equal(
      document.getElementById('settings-connection').textContent,
      'Backend at http://127.0.0.1:13080 reached, but authorization failed',
    );
    assert.equal(document.getElementById('settings-connection-error').hidden, false);
    assert.equal(
      document.getElementById('settings-connection-error').textContent,
      '401 Unauthorized: Unauthorized',
    );
    assert.equal(document.getElementById('result-status').textContent, '401 Unauthorized: Unauthorized');
  } finally {
    popup.cleanup();
  }
});
