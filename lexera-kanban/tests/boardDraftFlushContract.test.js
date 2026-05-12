// @vitest-environment jsdom

// Pins the draft-save 500ms-loss-window fix:
//   - flushPendingDraftSave fires the pending save synchronously
//   - cancelPendingDraftSave clears the pending state without firing
//   - boardDataStore.js loadBoard flushes on board switch
//   - boardDataStore.js saveFullBoard catch path flushes on save failure
//   - app.js installs a pagehide listener that calls flushPendingDraftSave
//
// Bug context: saveLocalBoardDraft in boardList.js debounces by 500ms.
// On critical boundaries (pagehide, board switch, save failure, app
// shutdown) the pending save could be silently dropped if the 500ms
// timer hadn't fired yet — up to 500ms of edits lost on cold restart.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIIFE } from './load-iife.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); }
  };
}

function loadBoardList(settingsSink) {
  // boardList.js captures `_Settings = typeof LexeraSettings !== 'undefined' ? LexeraSettings : null`
  // at module-eval. The Settings dep on `init()` cannot replace `_Settings`,
  // so we must expose LexeraSettings on the eval scope before loadIIFE.
  const LexeraSettings = {
    setForBoard(_key, boardId, payload) { settingsSink.calls.push({ boardId, payload }); },
    getForBoard() { return null; },
    set() {}, get() {}
  };
  return loadIIFE('board/boardList.js', 'LexeraBoardList', {
    window,
    document,
    localStorage: createLocalStorage(),
    LexeraSettings,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    structuredClone,
    lexeraLog: vi.fn(),
    logFrontendIssue: vi.fn(),
    traceFrontendAction: vi.fn()
  });
}

function initBoardListForDraft(BoardList, settingsSink) {
  // Minimal init — enough that saveLocalBoardDraft / flushPendingDraftSave
  // can run. The dep surface covers the fields _executeDraftSave reads
  // off the deps bag (`fullBoardData`, `_lastLoadedRevision`,
  // `activeBoardData`) plus the `isRemoteBoardId` predicate.
  BoardList.init({
    boards: [],
    remoteBoards: [],
    workspaces: [{ id: 'ws-1', name: 'WS' }],
    activeWorkspaceId: 'ws-1',
    viewWorkspaceId: 'ws-1',
    workspaceViewMode: 'follow-active-board',
    activeBoardId: '',
    boardPresenceCache: {},
    fullBoardData: { columns: [], revision: 'r1' },
    activeBoardData: { revision: 'r1' },
    _lastLoadedRevision: 'r1',
    setActiveWorkspaceIdState() {},
    setViewWorkspaceIdState() {},
    setWorkspaceViewModeState() {},
    getOrderedItems(items) { return items; },
    getSharedPanelRoots() { return []; },
    getCreationEntityDragIconSvg() { return ''; },
    getDisplayNameFromPath(path) { return path || ''; },
    escapeHtml(text) { return String(text || ''); },
    isRemoteBoardId() { return false; },
    Settings: {
      setForBoard(_key, boardId, payload) { settingsSink.calls.push({ boardId, payload }); },
      getForBoard() { return null; }
    }
  });
}

describe('draft-save flush contract — 500ms loss-window fix', () => {
  beforeEach(() => {
    window.LexeraRuntime = {
      setViewLoading() {}, setViewConnected() {}, setViewEmpty() {},
      mergeDeps(target, source) {
        Object.keys(source).forEach(function (k) {
          Object.defineProperty(target, k, Object.getOwnPropertyDescriptor(source, k));
        });
      },
      onStateChange() { return function () {}; },
      on() { return function () {}; },
      getState() { return undefined; },
      defineState() {}
    };
  });

  it('flushPendingDraftSave fires the pending save synchronously', () => {
    const sink = { calls: [] };
    const BoardList = loadBoardList(sink);
    initBoardListForDraft(BoardList, sink);

    BoardList.saveLocalBoardDraft('board-1', { columns: [], revision: 'r1' });
    expect(sink.calls.length).toBe(0); // still debounced

    const fired = BoardList.flushPendingDraftSave();
    expect(fired).toBe(true);
    expect(sink.calls.length).toBe(1);
    expect(sink.calls[0].boardId).toBe('board-1');
    expect(sink.calls[0].payload.board).toBeTruthy();
  });

  it('flushPendingDraftSave returns false when nothing is pending', () => {
    const sink = { calls: [] };
    const BoardList = loadBoardList(sink);
    initBoardListForDraft(BoardList, sink);

    expect(BoardList.flushPendingDraftSave()).toBe(false);
    expect(sink.calls.length).toBe(0);
  });

  it('flush clears pending state — subsequent flush is a no-op', () => {
    const sink = { calls: [] };
    const BoardList = loadBoardList(sink);
    initBoardListForDraft(BoardList, sink);

    BoardList.saveLocalBoardDraft('board-1', { columns: [], revision: 'r1' });
    BoardList.flushPendingDraftSave();
    expect(sink.calls.length).toBe(1);

    // Second flush with no fresh save: nothing happens.
    const second = BoardList.flushPendingDraftSave();
    expect(second).toBe(false);
    expect(sink.calls.length).toBe(1);
  });

  it('cancelPendingDraftSave drops the pending payload without firing', () => {
    const sink = { calls: [] };
    const BoardList = loadBoardList(sink);
    initBoardListForDraft(BoardList, sink);

    BoardList.saveLocalBoardDraft('board-1', { columns: [], revision: 'r1' });
    BoardList.cancelPendingDraftSave();
    expect(BoardList.flushPendingDraftSave()).toBe(false);
    expect(sink.calls.length).toBe(0);
  });
});

describe('flush wiring at critical boundaries (source-grep contracts)', () => {
  // The boundary call sites can't be exercised in isolation without
  // pulling in the whole BoardDataStore + app.js scaffolding, so we
  // pin them as source-level contracts. If any of these refactor away
  // without a matching replacement, the test fails loudly.

  it('boardDataStore.loadBoard flushes pending draft on board switch', () => {
    const src = readFileSync(resolve(srcDir, 'core', 'boardDataStore.js'), 'utf-8');
    // The loadBoard function defines isBoardSwitch and must flush
    // before the in-memory state changeover.
    const loadBoardIdx = src.indexOf('async function loadBoard(');
    expect(loadBoardIdx).toBeGreaterThan(-1);
    const window = src.slice(loadBoardIdx, loadBoardIdx + 800);
    expect(window).toMatch(/isBoardSwitch/);
    expect(window).toMatch(/flushPendingDraftSave/);
  });

  it('boardDataStore.saveFullBoard catch path flushes pending draft', () => {
    const src = readFileSync(resolve(srcDir, 'core', 'boardDataStore.js'), 'utf-8');
    const saveIdx = src.indexOf('async function saveFullBoard(');
    expect(saveIdx).toBeGreaterThan(-1);
    // The catch block must include a flushPendingDraftSave call before
    // the crashsave attempt so the draft on disk matches the in-memory
    // state at the moment of failure.
    const tail = src.slice(saveIdx, src.indexOf('async function ', saveIdx + 50));
    expect(tail).toMatch(/} catch \(err\)/);
    expect(tail).toMatch(/flushPendingDraftSave/);
    expect(tail.indexOf('flushPendingDraftSave')).toBeGreaterThan(tail.indexOf('} catch (err)'));
  });

  it('app.js installs a pagehide listener that flushes pending draft', () => {
    const src = readFileSync(resolve(srcDir, 'app.js'), 'utf-8');
    // pagehide listener must call flushPendingDraftSave. We assert
    // both the event name and the call appear in a short window.
    const idx = src.indexOf("addEventListener('pagehide'");
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 300);
    expect(window).toMatch(/flushPendingDraftSave/);
  });

  it('boardDataStore init wiring includes flushPendingDraftSave dep', () => {
    const src = readFileSync(resolve(srcDir, 'app.js'), 'utf-8');
    // The dep is passed to BoardDataStore.init so the data store can
    // call dep('flushPendingDraftSave') from loadBoard / saveFullBoard.
    expect(src).toMatch(/flushPendingDraftSave:\s*function/);
  });
});
