import { describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

const panelHost = loadIIFE('workspace/panelHost.js', 'window.LexeraPanelHost', {
  window: {}
});

describe('LexeraPanelHost.panelLabelForTab', () => {
  it('uses the panel-tab- prefix to disambiguate from board webviews', () => {
    expect(panelHost.panelLabelForTab('abc')).toBe('panel-tab-abc');
  });

  it('coerces non-string ids', () => {
    expect(panelHost.panelLabelForTab(42)).toBe('panel-tab-42');
    expect(panelHost.panelLabelForTab(null)).toBe('panel-tab-null');
  });
});

describe('LexeraPanelHost.isPanelKindOnWebviewAllowlist', () => {
  it('returns false for unknown kinds', () => {
    expect(panelHost.isPanelKindOnWebviewAllowlist('mystery')).toBe(false);
  });

  it('returns false for empty/null inputs', () => {
    expect(panelHost.isPanelKindOnWebviewAllowlist('')).toBe(false);
    expect(panelHost.isPanelKindOnWebviewAllowlist(null)).toBe(false);
    expect(panelHost.isPanelKindOnWebviewAllowlist(undefined)).toBe(false);
  });

  it('every key in PANEL_WEBVIEW_KINDS is on the allowlist', () => {
    Object.keys(panelHost.PANEL_WEBVIEW_KINDS).forEach((kind) => {
      expect(panelHost.isPanelKindOnWebviewAllowlist(kind)).toBe(true);
    });
  });

  it('includes all 10 panel kinds (aggressive Workstream P migration)', () => {
    // Full migration: every dock-hosted panel kind spawns a child
    // webview. Stub sub-apps cover kinds whose real UI is not yet
    // ported. Each line is intentionally explicit so a future change
    // to the kind taxonomy is caught.
    ['logs', 'dashboard', 'hierarchy', 'weekCalendar', 'monthCalendar',
     'backendSettings', 'frontendSettings', 'renderApps', 'files', 'frontendTests']
      .forEach((kind) => {
        expect(panelHost.isPanelKindOnWebviewAllowlist(kind)).toBe(true);
      });
  });
});

describe('LexeraPanelHost.viewDirForKind', () => {
  it('returns the kind itself for kinds without an override', () => {
    expect(panelHost.viewDirForKind('dashboard')).toBe('dashboard');
    expect(panelHost.viewDirForKind('weekCalendar')).toBe('weekCalendar');
  });

  it('maps logs → log (legacy directory name)', () => {
    expect(panelHost.viewDirForKind('logs')).toBe('log');
  });

  it('uses kind name for hierarchy (its own src/views/hierarchy/ stub)', () => {
    expect(panelHost.viewDirForKind('hierarchy')).toBe('hierarchy');
  });

  it('returns empty string for empty/null', () => {
    expect(panelHost.viewDirForKind('')).toBe('');
    expect(panelHost.viewDirForKind(null)).toBe('');
  });
});

describe('LexeraPanelHost.panelUrlForTab', () => {
  const origin = 'http://127.0.0.1:1431/index.html';

  it('returns empty string when required inputs are missing', () => {
    const tab = { id: 't1', kind: 'panel', panelId: 'logs' };
    expect(panelHost.panelUrlForTab(null, 'logs', origin)).toBe('');
    expect(panelHost.panelUrlForTab(tab, '', origin)).toBe('');
    expect(panelHost.panelUrlForTab(tab, 'logs', '')).toBe('');
  });

  it('routes logs to its dedicated sub-app entrypoint', () => {
    const tab = { id: 't1', kind: 'panel', panelId: 'logs' };
    const result = new URL(panelHost.panelUrlForTab(tab, 'logs', origin));
    expect(result.pathname).toBe('/views/log/index.html');
  });

  it('keeps the panel kind identity in the query string for routing/diagnostics', () => {
    const tab = { id: 't1', kind: 'panel', panelId: 'logs' };
    const result = new URL(panelHost.panelUrlForTab(tab, 'logs', origin));
    expect(result.searchParams.get('panelKind')).toBe('logs');
    expect(result.searchParams.has('panelOnly')).toBe(false);
  });

  it('carries the pane (tabId) and panel (panelInstanceId) params', () => {
    const tab = { id: 't-abc', kind: 'panel', panelId: 'logs-2' };
    const result = new URL(panelHost.panelUrlForTab(tab, 'logs', origin));
    expect(result.searchParams.get('pane')).toBe('t-abc');
    expect(result.searchParams.get('panel')).toBe('logs-2');
  });

  it('falls back panelId to kind when tab.panelId is empty', () => {
    const tab = { id: 't1', kind: 'panel', panelId: '' };
    const result = new URL(panelHost.panelUrlForTab(tab, 'logs', origin));
    expect(result.searchParams.get('panel')).toBe('logs');
  });

  it('strips any preexisting query/hash from the host url', () => {
    const dirty = 'http://127.0.0.1:1431/index.html?stale=1#frag';
    const tab = { id: 't1', kind: 'panel', panelId: 'logs' };
    const result = new URL(panelHost.panelUrlForTab(tab, 'logs', dirty));
    expect(result.searchParams.has('stale')).toBe(false);
    expect(result.hash).toBe('');
  });

  it('assigns the child window label and preserves the host shell label', () => {
    const originWithWindowLabel = 'http://127.0.0.1:1431/index.html?windowLabel=workspace-2';
    const tab = { id: 't1', kind: 'panel', panelId: 'logs' };
    const result = new URL(panelHost.panelUrlForTab(tab, 'logs', originWithWindowLabel));
    expect(result.searchParams.get('windowLabel')).toBe('panel-tab-t1');
    expect(result.searchParams.get('workspaceShellHostLabel')).toBe('workspace-2');
  });

  it('defaults the host shell label to main when the parent url has none', () => {
    const tab = { id: 't1', kind: 'panel', panelId: 'logs' };
    const result = new URL(panelHost.panelUrlForTab(tab, 'logs', origin));
    expect(result.searchParams.get('windowLabel')).toBe('panel-tab-t1');
    expect(result.searchParams.get('workspaceShellHostLabel')).toBe('main');
  });

  it('uses the per-kind view directory for any panel kind', () => {
    const tab = { id: 't1', kind: 'panel', panelId: 'weekCalendar' };
    const result = new URL(panelHost.panelUrlForTab(tab, 'weekCalendar', origin));
    expect(result.pathname).toBe('/views/weekCalendar/index.html');
    expect(result.searchParams.get('panelKind')).toBe('weekCalendar');
  });

  it('honors directory overrides when kind and view directory differ', () => {
    const tab = { id: 't1', kind: 'panel', panelId: 'logs' };
    const result = new URL(panelHost.panelUrlForTab(tab, 'logs', origin));
    expect(result.pathname).toBe('/views/log/index.html');
    expect(result.pathname.includes('/views/logs/')).toBe(false);
  });
});
