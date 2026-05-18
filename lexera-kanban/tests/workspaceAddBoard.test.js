// Adding boards to a workspace — drag-in + right-click "New Board…".
//
// User request (2026-05-17): "be able to add an existing kanban board
// to a workspace by dragging it into the workspace; right-click should
// have an option to add a new board by defining a filename and a folder
// where to store the new file".
//
// These tests drive the user-visible outcomes:
//   1. Dropping a board file into the workspace registers it AND opens
//      it as a tab (addBoardsByPath with { select: true }).
//   2. "New Board…" prompts a name, picks a folder, writes the bare
//      board template, registers it and opens it — and never silently
//      clobbers an existing file.
//   3. The workspace context menu reaches createNewBoardFile through
//      the exact `shell.mount` hook handleRootContextMenu invokes
//      (`state.hooks.createNewBoard()`).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function makeDialogs(overrides = {}) {
  return {
    prompt: vi.fn(() => Promise.resolve('My Board')),
    confirm: vi.fn(() => Promise.resolve(true)),
    ...overrides
  };
}

function loadOrderHelpers(LexeraDialogs, win = {}) {
  return loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers', {
    window: win,
    document: {},
    LexeraDialogs
  });
}

describe('addBoardsByPath — drag a board file into the workspace', () => {
  it('registers every dropped .md and opens each in the workspace when select:true', async () => {
    const OrderHelpers = loadOrderHelpers(makeDialogs());
    const addBoard = vi.fn((p) => Promise.resolve({ boardId: 'id::' + p }));
    const poll = vi.fn(() => Promise.resolve());
    const selectBoard = vi.fn();
    OrderHelpers.init({
      hierarchyLocked: false,
      LexeraApi: { addBoard },
      poll,
      selectBoard,
      lexeraLog: vi.fn()
    });

    await OrderHelpers.addBoardsByPath(
      ['/Users/x/alpha.md', '/Users/x/beta.md'],
      { select: true }
    );

    expect(addBoard.mock.calls.map((c) => c[0]))
      .toEqual(['/Users/x/alpha.md', '/Users/x/beta.md']);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(selectBoard.mock.calls.map((c) => c[0]))
      .toEqual(['id::/Users/x/alpha.md', 'id::/Users/x/beta.md']);
  });

  it('keeps the library-add behavior (no tab opened) when select is omitted', async () => {
    const OrderHelpers = loadOrderHelpers(makeDialogs());
    const addBoard = vi.fn((p) => Promise.resolve({ boardId: 'id::' + p }));
    const poll = vi.fn(() => Promise.resolve());
    const selectBoard = vi.fn();
    OrderHelpers.init({
      hierarchyLocked: false,
      LexeraApi: { addBoard },
      poll,
      selectBoard,
      lexeraLog: vi.fn()
    });

    await OrderHelpers.addBoardsByPath(['/Users/x/alpha.md']);

    expect(addBoard).toHaveBeenCalledWith('/Users/x/alpha.md');
    expect(poll).toHaveBeenCalledTimes(1);
    expect(selectBoard).not.toHaveBeenCalled();
  });

  it('ignores non-markdown / non-absolute drops', async () => {
    const OrderHelpers = loadOrderHelpers(makeDialogs());
    const addBoard = vi.fn(() => Promise.resolve({ boardId: 'x' }));
    OrderHelpers.init({
      hierarchyLocked: false,
      LexeraApi: { addBoard },
      poll: vi.fn(() => Promise.resolve()),
      selectBoard: vi.fn(),
      lexeraLog: vi.fn()
    });

    OrderHelpers.addBoardsByPath(['relative.md', '/Users/x/notes.txt'], { select: true });

    expect(addBoard).not.toHaveBeenCalled();
  });
});

describe('createNewBoardFile — right-click New Board…', () => {
  let LexeraApi;
  let tauriInvoke;
  let poll;
  let selectBoard;
  let showNotification;
  let lexeraLog;

  function baseDeps() {
    return {
      hasTauri: true,
      tauriInvoke,
      LexeraApi,
      poll,
      selectBoard,
      showNotification,
      lexeraLog
    };
  }

  beforeEach(() => {
    LexeraApi = { addBoard: vi.fn(() => Promise.resolve({ boardId: 'new-board-id' })) };
    poll = vi.fn(() => Promise.resolve());
    selectBoard = vi.fn();
    showNotification = vi.fn();
    lexeraLog = vi.fn();
  });

  it('prompts name, picks folder, writes the bare template, registers and opens it', async () => {
    tauriInvoke = vi.fn((cmd) => {
      if (cmd === 'browse_folder') return Promise.resolve('/tmp/boards');
      if (cmd === 'read_text_file') return Promise.reject(new Error('ENOENT'));
      if (cmd === 'write_text_file') return Promise.resolve();
      return Promise.resolve();
    });
    const dialogs = makeDialogs({ prompt: vi.fn(() => Promise.resolve('My Board')) });
    const OrderHelpers = loadOrderHelpers(dialogs);
    OrderHelpers.init(baseDeps());

    await OrderHelpers.createNewBoardFile();

    expect(dialogs.prompt).toHaveBeenCalledWith('New board file name', 'board.md');
    expect(tauriInvoke).toHaveBeenCalledWith('browse_folder', {
      title: 'Choose a folder for the new board'
    });
    // Overwrite guard probes the target path first.
    expect(tauriInvoke).toHaveBeenCalledWith('read_text_file', {
      path: '/tmp/boards/My Board.md'
    });
    // Bare board template (user choice 2026-05-17): frontmatter + title row.
    expect(tauriInvoke).toHaveBeenCalledWith('write_text_file', {
      path: '/tmp/boards/My Board.md',
      content: '---\nkanban-plugin: board\n---\n\n# My Board\n'
    });
    expect(LexeraApi.addBoard).toHaveBeenCalledWith('/tmp/boards/My Board.md');
    expect(poll).toHaveBeenCalledTimes(1);
    expect(selectBoard).toHaveBeenCalledWith('new-board-id');
    expect(showNotification).toHaveBeenCalledWith('Created board My Board.md');
  });

  it('aborts when the folder picker is cancelled (no file written)', async () => {
    tauriInvoke = vi.fn((cmd) => {
      if (cmd === 'browse_folder') return Promise.resolve(null);
      return Promise.resolve();
    });
    const OrderHelpers = loadOrderHelpers(makeDialogs());
    OrderHelpers.init(baseDeps());

    await OrderHelpers.createNewBoardFile();

    expect(tauriInvoke).not.toHaveBeenCalledWith('write_text_file', expect.anything());
    expect(LexeraApi.addBoard).not.toHaveBeenCalled();
    expect(selectBoard).not.toHaveBeenCalled();
  });

  it('does not clobber an existing file when overwrite is declined', async () => {
    tauriInvoke = vi.fn((cmd) => {
      if (cmd === 'browse_folder') return Promise.resolve('/tmp/boards');
      if (cmd === 'read_text_file') return Promise.resolve('# existing board');
      if (cmd === 'write_text_file') return Promise.resolve();
      return Promise.resolve();
    });
    const dialogs = makeDialogs({ confirm: vi.fn(() => Promise.resolve(false)) });
    const OrderHelpers = loadOrderHelpers(dialogs);
    OrderHelpers.init(baseDeps());

    await OrderHelpers.createNewBoardFile();

    expect(dialogs.confirm).toHaveBeenCalled();
    expect(tauriInvoke).not.toHaveBeenCalledWith('write_text_file', expect.anything());
    expect(LexeraApi.addBoard).not.toHaveBeenCalled();
  });
});

describe('workspace context-menu wiring', () => {
  it('setupWorkspaceShell exposes createNewBoard hook that runs the create flow', async () => {
    const tauriInvoke = vi.fn((cmd) => {
      if (cmd === 'browse_folder') return Promise.resolve('/tmp/boards');
      if (cmd === 'read_text_file') return Promise.reject(new Error('ENOENT'));
      if (cmd === 'write_text_file') return Promise.resolve();
      return Promise.resolve();
    });
    const dialogs = makeDialogs();
    const OrderHelpers = loadOrderHelpers(dialogs, {
      __TAURI__: { event: { listen() {} }, webview: {} }
    });

    let capturedHooks = null;
    const WorkspaceShell = {
      mount: vi.fn((hooks) => { capturedHooks = hooks; }),
      isPanelVisible: () => true,
      revealPanel: vi.fn()
    };
    const selectBoard = vi.fn();
    OrderHelpers.init({
      workspaceShellEnabled: true,
      WorkspaceShell,
      getElMainContent: () => null,
      hasTauri: true,
      tauriInvoke,
      LexeraApi: { addBoard: vi.fn(() => Promise.resolve({ boardId: 'wired-id' })) },
      poll: vi.fn(() => Promise.resolve()),
      selectBoard,
      showNotification: vi.fn(),
      lexeraLog: vi.fn()
    });

    OrderHelpers.setupWorkspaceShell();

    expect(WorkspaceShell.mount).toHaveBeenCalledTimes(1);
    expect(capturedHooks).toBeTruthy();
    expect(typeof capturedHooks.createNewBoard).toBe('function');

    // This is exactly what handleRootContextMenu calls on the empty
    // workspace area: state.hooks.createNewBoard().
    await capturedHooks.createNewBoard();

    expect(dialogs.prompt).toHaveBeenCalledWith('New board file name', 'board.md');
    expect(tauriInvoke).toHaveBeenCalledWith('write_text_file', {
      path: '/tmp/boards/My Board.md',
      content: '---\nkanban-plugin: board\n---\n\n# My Board\n'
    });
    expect(selectBoard).toHaveBeenCalledWith('wired-id');
  });
});
