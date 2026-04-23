import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { loadIIFE } from './load-iife.js';

function createEditorHarness() {
  const dom = new JSDOM('<!doctype html><div class="card"><div class="card-content"></div></div>', {
    pretendToBeVisual: true,
    url: 'http://127.0.0.1/'
  });
  const { window } = dom;
  const cardEl = window.document.querySelector('.card');
  const card = { kid: 'card-1', content: 'Original task' };
  const column = { cards: [card] };
  const deps = {
    getCurrentCardEditor: vi.fn(() => null),
    getFullBoardData: vi.fn(() => ({ rows: [] })),
    getFullColumn: vi.fn(() => column),
    getFullCardIndex: vi.fn((_, idx) => idx),
    setIsEditing: vi.fn(),
    escapeAttr: vi.fn((value) => String(value || '').replace(/"/g, '&quot;')),
    shouldBroadcastEditingPresence: vi.fn(() => false),
    getSyncUserName: vi.fn(() => 'Tester'),
    getSyncUserId: vi.fn(() => 'tester-id'),
    LexeraApi: {
      isSyncConnected: vi.fn(() => true),
      sendEditingPresence: vi.fn()
    },
    queueCardDraftLiveSync: vi.fn(),
    queueEditingPresenceBroadcast: vi.fn(),
    handleTextareaTabIndent: vi.fn(() => false),
    insertFormatting: vi.fn(),
    resolveDropContent: vi.fn(() => Promise.resolve('')),
    handleEditorPasteImage: vi.fn(),
    clearPendingCardDraftSync: vi.fn(),
    clearEditingPresenceQueue: vi.fn(),
    saveCardEdit: vi.fn(() => Promise.resolve(true)),
    renderCardDisplayState: vi.fn(),
    revertCardDraftLiveSync: vi.fn(() => Promise.resolve(true)),
    flushDeferredBoardRefresh: vi.fn(() => Promise.resolve(true))
  };

  const InlineCardEditor = loadIIFE('editor/inlineCardEditor.js', 'InlineCardEditor', {
    window,
    document: window.document,
    requestAnimationFrame: (fn) => {
      fn();
      return 1;
    },
    cancelAnimationFrame: vi.fn(),
    logFrontendIssue: vi.fn()
  });
  InlineCardEditor.init(deps);
  return { window, cardEl, deps, InlineCardEditor };
}

describe('InlineCardEditor user interactions', () => {
  let harness;

  beforeEach(() => {
    harness = createEditorHarness();
  });

  it('opens inline editing, live-syncs typed content, and saves with Alt+Enter', () => {
    const { window, cardEl, deps, InlineCardEditor } = harness;

    InlineCardEditor.enterInlineCardEditMode(cardEl, 0, 0);
    const textarea = cardEl.querySelector('.card-inline-textarea');
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe('Original task');
    expect(deps.setIsEditing).toHaveBeenCalledWith(true);

    textarea.value = 'Updated task';
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(deps.queueCardDraftLiveSync).toHaveBeenCalledWith(0, 0, 'Updated task');

    textarea.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'Enter',
      altKey: true,
      bubbles: true,
      cancelable: true
    }));

    expect(deps.clearPendingCardDraftSync).toHaveBeenCalled();
    expect(deps.saveCardEdit).toHaveBeenCalledWith(cardEl, 0, 0, 'Updated task');
    expect(deps.setIsEditing).toHaveBeenLastCalledWith(false);
  });

  it('cancels with Escape and restores the original card display', async () => {
    const { window, cardEl, deps, InlineCardEditor } = harness;

    InlineCardEditor.enterInlineCardEditMode(cardEl, 0, 0);
    const textarea = cardEl.querySelector('.card-inline-textarea');
    textarea.value = 'Unsaved draft';
    const event = new window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    });

    textarea.dispatchEvent(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(deps.saveCardEdit).not.toHaveBeenCalled();
    expect(deps.renderCardDisplayState).toHaveBeenCalledWith(cardEl, 'Original task');
    expect(deps.revertCardDraftLiveSync).toHaveBeenCalledWith(0, 0, 'Original task');
    expect(deps.flushDeferredBoardRefresh).toHaveBeenCalledWith({ refreshSidebar: true });
  });
});
