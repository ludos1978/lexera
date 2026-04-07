import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

let AppShellShortcuts;

function createEvent(overrides = {}) {
  return {
    key: '',
    code: '',
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...overrides
  };
}

beforeAll(() => {
  AppShellShortcuts = loadIIFE('keyboard/appShellShortcuts.js', 'LexeraAppShellShortcuts', {
    window: {}
  });
});

describe('LexeraAppShellShortcuts.dispatchWorkspaceShellAction', () => {
  it('dispatches Cmd/Ctrl+W to close the active tab', () => {
    const handleBoardAction = vi.fn();
    const event = createEvent({ key: 'w' });

    const handled = AppShellShortcuts.dispatchWorkspaceShellAction(event, {
      workspaceShellEnabled: true,
      WorkspaceShell: { handleBoardAction },
      isEditing: false
    });

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(handleBoardAction).toHaveBeenCalledWith('close-active-tab');
  });

  it('does not fire shell shortcuts while editing', () => {
    const handleBoardAction = vi.fn();
    const event = createEvent({ key: 'w' });

    const handled = AppShellShortcuts.dispatchWorkspaceShellAction(event, {
      workspaceShellEnabled: true,
      WorkspaceShell: { handleBoardAction },
      isEditing: true
    });

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(handleBoardAction).not.toHaveBeenCalled();
  });

  it('uses event.code for shifted bracket tab-cycling shortcuts', () => {
    const handleBoardAction = vi.fn();
    const nextEvent = createEvent({ key: '}', code: 'BracketRight', shiftKey: true });
    const prevEvent = createEvent({ key: '{', code: 'BracketLeft', shiftKey: true });

    expect(AppShellShortcuts.dispatchWorkspaceShellAction(nextEvent, {
      workspaceShellEnabled: true,
      WorkspaceShell: { handleBoardAction },
      isEditing: false
    })).toBe(true);
    expect(AppShellShortcuts.dispatchWorkspaceShellAction(prevEvent, {
      workspaceShellEnabled: true,
      WorkspaceShell: { handleBoardAction },
      isEditing: false
    })).toBe(true);

    expect(handleBoardAction.mock.calls).toEqual([
      ['next-tab'],
      ['prev-tab']
    ]);
  });

  it('dispatches PageDown and PageUp tab cycling shortcuts', () => {
    const handleBoardAction = vi.fn();
    const nextEvent = createEvent({ key: 'PageDown' });
    const prevEvent = createEvent({ key: 'PageUp' });

    expect(AppShellShortcuts.dispatchWorkspaceShellAction(nextEvent, {
      workspaceShellEnabled: true,
      WorkspaceShell: { handleBoardAction },
      isEditing: false
    })).toBe(true);
    expect(AppShellShortcuts.dispatchWorkspaceShellAction(prevEvent, {
      workspaceShellEnabled: true,
      WorkspaceShell: { handleBoardAction },
      isEditing: false
    })).toBe(true);

    expect(handleBoardAction.mock.calls).toEqual([
      ['next-tab'],
      ['prev-tab']
    ]);
  });

  it('dispatches panel toggle shortcuts', () => {
    const handleBoardAction = vi.fn();
    const hierarchyEvent = createEvent({ key: 'b' });
    const dashboardEvent = createEvent({ key: 'D', shiftKey: true });
    const filesEvent = createEvent({ key: 'e', shiftKey: true });

    AppShellShortcuts.dispatchWorkspaceShellAction(hierarchyEvent, {
      workspaceShellEnabled: true,
      WorkspaceShell: { handleBoardAction },
      isEditing: false
    });
    AppShellShortcuts.dispatchWorkspaceShellAction(dashboardEvent, {
      workspaceShellEnabled: true,
      WorkspaceShell: { handleBoardAction },
      isEditing: false
    });
    AppShellShortcuts.dispatchWorkspaceShellAction(filesEvent, {
      workspaceShellEnabled: true,
      WorkspaceShell: { handleBoardAction },
      isEditing: false
    });

    expect(handleBoardAction.mock.calls).toEqual([
      ['toggle-panel:hierarchy'],
      ['toggle-panel:dashboard'],
      ['toggle-panel:files']
    ]);
  });
});
