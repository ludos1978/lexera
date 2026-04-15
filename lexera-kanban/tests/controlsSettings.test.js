import { beforeEach, describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); }
  };
}

function loadCS() {
  const localStorage = createLocalStorage();
  return {
    CS: loadIIFE('settings/controlsSettings.js', 'LexeraControlsSettings', {
      window: { LexeraControlsSettings: undefined },
      localStorage,
      JSON
    }),
    localStorage
  };
}

describe('LexeraControlsSettings', () => {
  describe('defaults', () => {
    it('returns default bindings for kanban mode', () => {
      const { CS } = loadCS();
      const move = CS.getBindings('kanban', 'move');
      expect(move.length).toBe(3);
      expect(move[0]).toEqual({ type: 'scroll' });
      expect(move[1]).toEqual({ type: 'drag', button: 2 });
      expect(move[2]).toEqual({ type: 'drag', button: 0, alt: true });
    });

    it('returns default bindings for canvas mode', () => {
      const { CS } = loadCS();
      const zoom = CS.getBindings('canvas', 'zoom');
      expect(zoom.length).toBe(1);
      expect(zoom[0]).toEqual({ type: 'scroll' });
    });

    it('canvas move has no scroll binding by default', () => {
      const { CS } = loadCS();
      const move = CS.getBindings('canvas', 'move');
      const hasScroll = move.some(b => b.type === 'scroll');
      expect(hasScroll).toBe(false);
    });

    it('kanban zoom uses alt+scroll by default', () => {
      const { CS } = loadCS();
      const zoom = CS.getBindings('kanban', 'zoom');
      expect(zoom.length).toBe(1);
      expect(zoom[0]).toEqual({ type: 'scroll', alt: true });
    });
  });

  describe('add/remove', () => {
    it('adds a binding and persists to localStorage', () => {
      const { CS, localStorage } = loadCS();
      CS.addBinding('kanban', 'zoom', { type: 'key', key: 'z', ctrl: true });
      const zoom = CS.getBindings('kanban', 'zoom');
      expect(zoom.length).toBe(2);
      expect(zoom[1]).toEqual({ type: 'key', key: 'z', ctrl: true });
      // Check persistence
      const raw = localStorage.getItem('lexera-controls-settings');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw);
      expect(parsed.kanban.zoom.length).toBe(2);
    });

    it('prevents duplicate bindings', () => {
      const { CS } = loadCS();
      const added1 = CS.addBinding('kanban', 'move', { type: 'scroll' });
      expect(added1).toBe(false); // already exists
    });

    it('removes a binding by index', () => {
      const { CS } = loadCS();
      CS.removeBinding('kanban', 'move', 0);
      const move = CS.getBindings('kanban', 'move');
      expect(move.length).toBe(2);
      expect(move[0]).toEqual({ type: 'drag', button: 2 });
    });
  });

  describe('reset', () => {
    it('restores defaults after modifications', () => {
      const { CS } = loadCS();
      CS.setBindings('kanban', 'move', []);
      expect(CS.getBindings('kanban', 'move').length).toBe(0);
      CS.resetToDefaults();
      expect(CS.getBindings('kanban', 'move').length).toBe(3);
    });
  });

  describe('matching', () => {
    it('matchesScroll returns true for plain scroll in kanban move', () => {
      const { CS } = loadCS();
      const event = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false };
      expect(CS.matchesScroll(event, 'kanban', 'move')).toBe(true);
    });

    it('matchesScroll returns false for plain scroll in kanban zoom', () => {
      const { CS } = loadCS();
      const event = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false };
      expect(CS.matchesScroll(event, 'kanban', 'zoom')).toBe(false);
    });

    it('matchesScroll returns true for alt+scroll in kanban zoom', () => {
      const { CS } = loadCS();
      const event = { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false };
      expect(CS.matchesScroll(event, 'kanban', 'zoom')).toBe(true);
    });

    it('matchesScroll returns true for plain scroll in canvas zoom', () => {
      const { CS } = loadCS();
      const event = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false };
      expect(CS.matchesScroll(event, 'canvas', 'zoom')).toBe(true);
    });

    it('matchesScroll never matches ctrl+scroll', () => {
      const { CS } = loadCS();
      const event = { altKey: false, shiftKey: false, ctrlKey: true, metaKey: false };
      expect(CS.matchesScroll(event, 'kanban', 'move')).toBe(false);
      expect(CS.matchesScroll(event, 'canvas', 'zoom')).toBe(false);
    });

    it('matchesDrag returns true for right-drag in kanban move', () => {
      const { CS } = loadCS();
      const event = { button: 2, altKey: false, shiftKey: false };
      expect(CS.matchesDrag(event, 'kanban', 'move')).toBe(true);
    });

    it('matchesDrag returns true for alt+left-drag in canvas move', () => {
      const { CS } = loadCS();
      const event = { button: 0, altKey: true, shiftKey: false };
      expect(CS.matchesDrag(event, 'canvas', 'move')).toBe(true);
    });

    it('matchesKey returns true for Enter in edit action', () => {
      const { CS } = loadCS();
      const event = { key: 'Enter', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
      expect(CS.matchesKey(event, 'kanban', 'edit')).toBe(true);
      expect(CS.matchesKey(event, 'canvas', 'edit')).toBe(true);
    });

    it('matchesDblclick returns true for edit action', () => {
      const { CS } = loadCS();
      expect(CS.matchesDblclick('kanban', 'edit')).toBe(true);
      expect(CS.matchesDblclick('canvas', 'edit')).toBe(true);
    });

    it('matchesDblclick returns false for move action', () => {
      const { CS } = loadCS();
      expect(CS.matchesDblclick('kanban', 'move')).toBe(false);
    });
  });

  describe('bindingLabel', () => {
    it('formats scroll bindings', () => {
      const { CS } = loadCS();
      expect(CS.bindingLabel({ type: 'scroll' })).toBe('Scroll');
      expect(CS.bindingLabel({ type: 'scroll', alt: true })).toBe('Alt+Scroll');
    });

    it('formats drag bindings', () => {
      const { CS } = loadCS();
      expect(CS.bindingLabel({ type: 'drag', button: 2 })).toBe('Right-Drag');
      expect(CS.bindingLabel({ type: 'drag', button: 0, alt: true })).toBe('Alt+Left-Drag');
    });

    it('formats key bindings', () => {
      const { CS } = loadCS();
      expect(CS.bindingLabel({ type: 'key', key: 'Enter' })).toBe('Enter');
      expect(CS.bindingLabel({ type: 'key', key: 'z', ctrl: true })).toBe('Ctrl+z');
    });

    it('formats dblclick', () => {
      const { CS } = loadCS();
      expect(CS.bindingLabel({ type: 'dblclick' })).toBe('Double-Click');
    });
  });
});
