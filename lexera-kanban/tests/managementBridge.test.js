import { describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function freshBridge() {
  const win = {};
  const bridge = loadIIFE('shell/managementBridge.js', 'window.LexeraManagementBridge', {
    window: win
  });
  return { bridge, win };
}

describe('LexeraManagementBridge.installWith', () => {
  it('attaches the management listeners on the runtime', () => {
    const { bridge } = freshBridge();
    const listen = vi.fn();
    bridge.installWith({ event: { listen } }, {});
    expect(listen).toHaveBeenCalledTimes(3);
    const events = listen.mock.calls.map((call) => call[0]);
    expect(events).toContain('management-workspaces-loaded');
    expect(events).toContain('management-board-mutation');
    expect(events).toContain('render-apps-config-saved');
  });

  it('returns false when the runtime has no event.listen', () => {
    const { bridge } = freshBridge();
    expect(bridge.installWith(null, {})).toBe(false);
    expect(bridge.installWith({}, {})).toBe(false);
    expect(bridge.installWith({ event: {} }, {})).toBe(false);
  });
});

describe('LexeraManagementBridge.handleWorkspacesLoaded', () => {
  it('routes workspace snapshots to the injected handler', () => {
    const { bridge } = freshBridge();
    const onWorkspacesLoaded = vi.fn();

    const handled = bridge.handleWorkspacesLoaded({
      payload: {
        workspaces: [{ id: 'ws-1', name: 'Alpha' }],
        defaultWorkspaceId: 'ws-1'
      }
    }, { onWorkspacesLoaded });

    expect(handled).toBe(true);
    expect(onWorkspacesLoaded).toHaveBeenCalledWith(
      [{ id: 'ws-1', name: 'Alpha' }],
      'ws-1'
    );
  });

  it('normalizes missing payload fields and no-ops without a handler', () => {
    const { bridge } = freshBridge();
    expect(bridge.handleWorkspacesLoaded({ payload: {} }, {})).toBe(false);
    expect(bridge.normalizeWorkspacesPayload({ payload: {} })).toEqual({
      workspaces: [],
      defaultWorkspaceId: null
    });
  });
});

describe('LexeraManagementBridge.handleBoardMutation', () => {
  it('routes board-added to the injected handler', () => {
    const { bridge } = freshBridge();
    const onBoardAdded = vi.fn();

    const handled = bridge.handleBoardMutation({
      payload: { kind: 'added' }
    }, { onBoardAdded });

    expect(handled).toBe(true);
    expect(onBoardAdded).toHaveBeenCalled();
  });

  it('routes board-removed and settings-saved to the injected handlers', () => {
    const { bridge } = freshBridge();
    const onBoardRemoved = vi.fn();
    const onBoardSettingsSaved = vi.fn();

    expect(bridge.handleBoardMutation({
      payload: { kind: 'removed', boardId: 'board-1' }
    }, { onBoardRemoved })).toBe(true);
    expect(onBoardRemoved).toHaveBeenCalledWith('board-1');

    expect(bridge.handleBoardMutation({
      payload: { kind: 'settings-saved', boardId: 'board-2', settings: { theme: 'paper' } }
    }, { onBoardSettingsSaved })).toBe(true);
    expect(onBoardSettingsSaved).toHaveBeenCalledWith('board-2', { theme: 'paper' });
  });
});

describe('LexeraManagementBridge.handleRenderAppsConfigSaved', () => {
  it('routes plugin-settings saves to the injected handler', () => {
    const { bridge } = freshBridge();
    const onRenderAppsConfigSaved = vi.fn();

    const handled = bridge.handleRenderAppsConfigSaved({
      payload: {
        values: {
          marpEnginePath: '/tools/marp/engine.js',
          marpTemplatesPath: '/themes/marp'
        }
      }
    }, { onRenderAppsConfigSaved });

    expect(handled).toBe(true);
    expect(onRenderAppsConfigSaved).toHaveBeenCalledWith({
      marpEnginePath: '/tools/marp/engine.js',
      marpTemplatesPath: '/themes/marp'
    });
  });

  it('normalizes missing payload fields and no-ops without a handler', () => {
    const { bridge } = freshBridge();
    expect(bridge.handleRenderAppsConfigSaved({ payload: {} }, {})).toBe(false);
    expect(bridge.normalizeRenderAppsConfigPayload({ payload: {} })).toEqual({
      values: {}
    });
  });
});
