import { describe, expect, it, vi, beforeEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

function freshBridge() {
  const win = {};
  const bridge = loadIIFE('shell/navigationBridge.js', 'window.LexeraNavigationBridge', {
    window: win
  });
  return { bridge, win };
}

describe('LexeraNavigationBridge.installWith', () => {
  it('attaches three event listeners on the runtime', () => {
    const { bridge } = freshBridge();
    const listen = vi.fn();
    bridge.installWith({ event: { listen } });
    expect(listen).toHaveBeenCalledTimes(3);
    const events = listen.mock.calls.map((c) => c[0]);
    expect(events).toContain('multiview-navigate');
    expect(events).toContain('multiview-shortcut');
    expect(events).toContain('focus-changed');
  });

  it('returns false when the runtime has no event.listen', () => {
    const { bridge } = freshBridge();
    expect(bridge.installWith(null)).toBe(false);
    expect(bridge.installWith({})).toBe(false);
    expect(bridge.installWith({ event: {} })).toBe(false);
  });
});

describe('LexeraNavigationBridge.handleNavigate', () => {
  it('routes open-board to LexeraWorkspaceShell.openBoard', () => {
    const { bridge, win } = freshBridge();
    const openBoard = vi.fn();
    win.LexeraWorkspaceShell = { openBoard };
    bridge.handleNavigate({ payload: { type: 'open-board', boardId: 'b1', options: { focus: true } } });
    expect(openBoard).toHaveBeenCalledWith('b1', { focus: true });
  });

  it('routes reveal-panel to LexeraWorkspaceShell.revealPanel', () => {
    const { bridge, win } = freshBridge();
    const revealPanel = vi.fn();
    win.LexeraWorkspaceShell = { revealPanel };
    bridge.handleNavigate({ payload: { type: 'reveal-panel', panelId: 'logs' } });
    expect(revealPanel).toHaveBeenCalledWith('logs');
  });

  it('is a no-op when shell is missing', () => {
    const { bridge } = freshBridge();
    expect(() => bridge.handleNavigate({ payload: { type: 'open-board', boardId: 'b1' } })).not.toThrow();
  });

  it('ignores unknown payload types', () => {
    const { bridge, win } = freshBridge();
    const openBoard = vi.fn();
    const revealPanel = vi.fn();
    win.LexeraWorkspaceShell = { openBoard, revealPanel };
    bridge.handleNavigate({ payload: { type: 'mystery' } });
    expect(openBoard).not.toHaveBeenCalled();
    expect(revealPanel).not.toHaveBeenCalled();
  });
});

describe('LexeraNavigationBridge.handleShortcut', () => {
  let mv;
  beforeEach(() => {
    mv = {
      openLogView: vi.fn(),
      openInspector: vi.fn(),
      openWorkspaces: vi.fn(),
      openDashboard: vi.fn()
    };
  });

  it('open-log-view → multiview.openLogView with bottom dock', () => {
    const { bridge, win } = freshBridge();
    win.LexeraMultiview = mv;
    bridge.handleShortcut({ payload: { action: 'open-log-view' } });
    expect(mv.openLogView).toHaveBeenCalledWith({ side: 'bottom', size: 280 });
  });

  it('open-inspector → multiview.openInspector with right dock', () => {
    const { bridge, win } = freshBridge();
    win.LexeraMultiview = mv;
    bridge.handleShortcut({ payload: { action: 'open-inspector' } });
    expect(mv.openInspector).toHaveBeenCalledWith({ side: 'right', size: 400 });
  });

  it('open-workspaces → multiview.openWorkspaces with left dock', () => {
    const { bridge, win } = freshBridge();
    win.LexeraMultiview = mv;
    bridge.handleShortcut({ payload: { action: 'open-workspaces' } });
    expect(mv.openWorkspaces).toHaveBeenCalledWith({ side: 'left', size: 280 });
  });

  it('open-dashboard → multiview.openDashboard with right dock', () => {
    const { bridge, win } = freshBridge();
    win.LexeraMultiview = mv;
    bridge.handleShortcut({ payload: { action: 'open-dashboard' } });
    expect(mv.openDashboard).toHaveBeenCalledWith({ side: 'right', size: 360 });
  });

  it('ignores unknown actions', () => {
    const { bridge, win } = freshBridge();
    win.LexeraMultiview = mv;
    bridge.handleShortcut({ payload: { action: 'mystery' } });
    Object.values(mv).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('survives a launcher that throws', () => {
    const { bridge, win } = freshBridge();
    win.LexeraMultiview = { openLogView: () => { throw new Error('boom'); } };
    expect(() => bridge.handleShortcut({ payload: { action: 'open-log-view' } })).not.toThrow();
  });
});

describe('LexeraNavigationBridge.handleFocusChanged', () => {
  it('bumps lifecycle.touch for any label', () => {
    const { bridge, win } = freshBridge();
    const touch = vi.fn();
    win.LexeraMultiview = { lifecycle: { touch } };
    bridge.handleFocusChanged({ payload: { label: 'panel-tab-x1' } });
    expect(touch).toHaveBeenCalledWith('panel-tab-x1');
  });

  it('synthesizes lexera-pane-activated for board-tab- labels', () => {
    const { bridge, win } = freshBridge();
    const dispatched = [];
    win.dispatchEvent = (ev) => dispatched.push(ev.data);
    win.MessageEvent = MessageEvent;
    bridge.handleFocusChanged({ payload: { label: 'board-tab-tab42' } });
    expect(dispatched).toEqual([{ type: 'lexera-pane-activated', pane: 'tab42' }]);
  });

  it('does not synthesize pane-activated for panel-tab- labels', () => {
    const { bridge, win } = freshBridge();
    const dispatched = [];
    win.dispatchEvent = (ev) => dispatched.push(ev.data);
    win.MessageEvent = MessageEvent;
    bridge.handleFocusChanged({ payload: { label: 'panel-tab-x1' } });
    expect(dispatched).toEqual([]);
  });

  it('is a no-op for empty payload', () => {
    const { bridge } = freshBridge();
    expect(() => bridge.handleFocusChanged({})).not.toThrow();
    expect(() => bridge.handleFocusChanged({ payload: {} })).not.toThrow();
  });
});
