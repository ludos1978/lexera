import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { loadIIFE } from './load-iife.js';

function createEditorHarness() {
  const dom = new JSDOM(
    '<!doctype html>' +
      '<div class="columns-container">' +
        '<div class="column">' +
          '<div class="column-header"></div>' +
          '<div class="column-cards">' +
            '<div class="card" data-card-id="card-1"><div class="card-content"></div></div>' +
            '<div class="card other-card" data-card-id="card-2"><div class="card-content">Other</div></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="dialog-overlay outside-board"><div class="dialog"><button class="dialog-btn">OK</button></div></div>',
    {
      pretendToBeVisual: true,
      url: 'http://127.0.0.1/'
    }
  );
  const { window } = dom;
  const columnsContainer = window.document.querySelector('.columns-container');
  const cardEl = window.document.querySelector('.card');
  const otherCardEl = window.document.querySelector('.other-card');
  const dialogBtn = window.document.querySelector('.dialog-btn');
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
    flushDeferredBoardRefresh: vi.fn(() => Promise.resolve(true)),
    getElColumnsContainer: vi.fn(() => columnsContainer),
    lockBoardScrollHorizontal: vi.fn()
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
  return { window, cardEl, otherCardEl, dialogBtn, columnsContainer, deps, InlineCardEditor };
}

function dispatchMousedown(window, target, opts = {}) {
  const event = new window.MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...opts
  });
  target.dispatchEvent(event);
  return event;
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
    // 5th arg `options.preEditScrollLeft` added 2026-05-10 so the
    // save-side latch can restore the user's pre-edit scroll
    // position instead of capturing whatever scrollLeft is at save
    // time. Harness has no columns-container, so the value is 0.
    expect(deps.saveCardEdit).toHaveBeenCalledWith(
      cardEl, 0, 0, 'Updated task', { preEditScrollLeft: 0 }
    );
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

  it('saves and closes on mousedown outside the card but inside the columns container', () => {
    const { window, cardEl, otherCardEl, deps, InlineCardEditor } = harness;

    InlineCardEditor.enterInlineCardEditMode(cardEl, 0, 0);
    const textarea = cardEl.querySelector('.card-inline-textarea');
    textarea.value = 'Edited via click-outside';
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));

    dispatchMousedown(window, otherCardEl);

    expect(deps.saveCardEdit).toHaveBeenCalledWith(
      cardEl, 0, 0, 'Edited via click-outside', { preEditScrollLeft: 0 }
    );
    expect(deps.setIsEditing).toHaveBeenLastCalledWith(false);
    expect(InlineCardEditor.getCurrentInlineCardEditor()).toBeNull();
  });

  it('does NOT close on mousedown inside the editing card', () => {
    const { window, cardEl, InlineCardEditor, deps } = harness;

    InlineCardEditor.enterInlineCardEditMode(cardEl, 0, 0);
    const textarea = cardEl.querySelector('.card-inline-textarea');

    dispatchMousedown(window, textarea);

    expect(deps.saveCardEdit).not.toHaveBeenCalled();
    expect(InlineCardEditor.getCurrentInlineCardEditor()).not.toBeNull();
  });

  it('does NOT close on mousedown outside the columns container (dialog overlay)', () => {
    const { window, cardEl, dialogBtn, InlineCardEditor, deps } = harness;

    InlineCardEditor.enterInlineCardEditMode(cardEl, 0, 0);

    dispatchMousedown(window, dialogBtn);

    expect(deps.saveCardEdit).not.toHaveBeenCalled();
    expect(InlineCardEditor.getCurrentInlineCardEditor()).not.toBeNull();
  });

  it('ignores right-click (non-primary button) outside the card', () => {
    const { window, cardEl, otherCardEl, InlineCardEditor, deps } = harness;

    InlineCardEditor.enterInlineCardEditMode(cardEl, 0, 0);

    dispatchMousedown(window, otherCardEl, { button: 2 });

    expect(deps.saveCardEdit).not.toHaveBeenCalled();
    expect(InlineCardEditor.getCurrentInlineCardEditor()).not.toBeNull();
  });

  it('removes the outside-mousedown listener after closing so a later click does not re-fire save', () => {
    const { window, cardEl, otherCardEl, InlineCardEditor, deps } = harness;

    InlineCardEditor.enterInlineCardEditMode(cardEl, 0, 0);
    dispatchMousedown(window, otherCardEl);
    expect(deps.saveCardEdit).toHaveBeenCalledTimes(1);

    // After close, another click outside should not invoke saveCardEdit again.
    dispatchMousedown(window, otherCardEl);
    expect(deps.saveCardEdit).toHaveBeenCalledTimes(1);
  });
});
