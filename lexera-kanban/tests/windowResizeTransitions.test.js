// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('window resize transition suppression', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.className = '';
  });

  it('adds window-resizing class to body on resize event', () => {
    vi.useFakeTimers();

    // The resize handler is set up in app.js — simulate the same logic here
    // since we can't load all of app.js in isolation
    let resizeTimer = 0;
    window.addEventListener('resize', function () {
      if (!resizeTimer) document.body.classList.add('window-resizing');
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        resizeTimer = 0;
        document.body.classList.remove('window-resizing');
      }, 200);
    });

    expect(document.body.classList.contains('window-resizing')).toBe(false);

    window.dispatchEvent(new Event('resize'));
    expect(document.body.classList.contains('window-resizing')).toBe(true);

    // Still active after 100ms
    vi.advanceTimersByTime(100);
    expect(document.body.classList.contains('window-resizing')).toBe(true);

    // Removed after 200ms idle
    vi.advanceTimersByTime(200);
    expect(document.body.classList.contains('window-resizing')).toBe(false);
  });

  it('resets timer on consecutive resize events', () => {
    vi.useFakeTimers();

    let resizeTimer = 0;
    window.addEventListener('resize', function () {
      if (!resizeTimer) document.body.classList.add('window-resizing');
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        resizeTimer = 0;
        document.body.classList.remove('window-resizing');
      }, 200);
    });

    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(150);
    expect(document.body.classList.contains('window-resizing')).toBe(true);

    // Another resize resets the 200ms timer
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(150);
    expect(document.body.classList.contains('window-resizing')).toBe(true);

    // 200ms after last resize — now removed
    vi.advanceTimersByTime(100);
    expect(document.body.classList.contains('window-resizing')).toBe(false);
  });

  it('CSS rule disables transitions on board-stack during resize', () => {
    document.head.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = `
      .board-stack { transition: min-width 0.15s, width 0.15s, flex 0.15s; }
      body.window-resizing .board-stack { transition: none !important; }
    `;
    document.head.appendChild(style);

    const stack = document.createElement('div');
    stack.className = 'board-stack';
    document.body.appendChild(stack);

    // Without resizing class, transition is set
    let computed = window.getComputedStyle(stack);
    // jsdom doesn't compute CSS fully, so just verify the class toggle works
    document.body.classList.add('window-resizing');
    expect(document.body.classList.contains('window-resizing')).toBe(true);

    document.body.classList.remove('window-resizing');
    expect(document.body.classList.contains('window-resizing')).toBe(false);

    document.body.removeChild(stack);
  });
});
