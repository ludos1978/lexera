// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadIIFE } from './load-iife.js';

// Phase 3B contract tests: the floating export-processes module tracks
// active auto-exports (stop button) and recent one-shot exports (open /
// reveal / report buttons), driven by `lexera-export-process-changed`
// window events.

function freshModule() {
  // A minimal DOM. jsdom is default in vitest; no extra setup needed.
  document.body.innerHTML = '';
  const mockInvoke = vi.fn().mockResolvedValue(null);
  const mockWindow = {
    __TAURI__: { core: { invoke: mockInvoke } },
    document: document,
    dispatchEvent: window.dispatchEvent.bind(window),
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    CustomEvent: window.CustomEvent,
  };
  const P = loadIIFE('export/exportProcesses.js', 'LexeraExportProcesses', {
    window: mockWindow,
    document: document,
    CustomEvent: window.CustomEvent,
  });
  P._reset();
  return { P, mockInvoke };
}

describe('LexeraExportProcesses — state tracking', () => {
  it('records an active entry on active-start and clears it on active-stop', () => {
    const { P } = freshModule();
    P.handleEvent({ kind: 'active-start', boardId: 'b1', boardName: 'Board 1', outputPath: '/out/b1.md' });
    expect(Object.keys(P._getActive())).toEqual(['b1']);
    expect(P._getActive().b1.boardName).toBe('Board 1');

    P.handleEvent({ kind: 'active-stop', boardId: 'b1' });
    expect(Object.keys(P._getActive())).toEqual([]);
  });

  it('records a completed entry newest-first and caps at 10', () => {
    const { P } = freshModule();
    for (let i = 0; i < 15; i++) {
      P.handleEvent({ kind: 'completed', boardId: 'b' + i, outputPath: '/out/' + i + '.pdf', success: true });
    }
    const recent = P._getRecent();
    expect(recent).toHaveLength(10);
    // Most recent (b14) at head.
    expect(recent[0].boardId).toBe('b14');
    expect(recent[9].boardId).toBe('b5');
  });

  it('preserves failure info for failed exports', () => {
    const { P } = freshModule();
    P.handleEvent({ kind: 'completed', boardId: 'b1', success: false, message: 'Marp crashed' });
    const [entry] = P._getRecent();
    expect(entry.success).toBe(false);
    expect(entry.message).toBe('Marp crashed');
  });

  it('carries reportEntries through so the popover can render warnings', () => {
    const { P } = freshModule();
    const reportEntries = {
      skipped: [{ path: '/big.mp4', category: 'video', sizeBytes: 200 * 1024 * 1024 }],
      embedded: [{ path: '/small.mp3', category: 'audio', sizeBytes: 5 * 1024 * 1024, outputFormat: 'keep' }],
    };
    P.handleEvent({ kind: 'completed', boardId: 'b1', success: true, outputPath: '/out/b1.md', reportEntries: reportEntries });
    const [entry] = P._getRecent();
    expect(entry.reportEntries.skipped).toHaveLength(1);
    expect(entry.reportEntries.embedded).toHaveLength(1);
  });
});

describe('LexeraExportProcesses — DOM + event listener', () => {
  it('mounts a floating root element in document.body the first time an event fires', () => {
    const { P } = freshModule();
    expect(P._isMounted()).toBe(false);
    P.handleEvent({ kind: 'completed', boardId: 'b1', success: true, outputPath: '/out/b1.pdf' });
    expect(P._isMounted()).toBe(true);
    expect(document.querySelector('[data-lexera-export-processes]')).toBeTruthy();
  });

  it('listens to lexera-export-process-changed window events', () => {
    const { P } = freshModule();
    window.dispatchEvent(new CustomEvent('lexera-export-process-changed', {
      detail: { kind: 'completed', boardId: 'b1', success: true, outputPath: '/out/b1.pdf' },
    }));
    expect(P._getRecent()).toHaveLength(1);
    expect(P._getRecent()[0].boardId).toBe('b1');
  });

  it('ignores events without a kind', () => {
    const { P } = freshModule();
    P.handleEvent(null);
    P.handleEvent({});
    expect(P._getRecent()).toHaveLength(0);
  });
});
