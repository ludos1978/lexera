import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

let BoardSettings;

function createStorage() {
  const store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    }
  };
}

function buildStackActionsContributor(options = {}) {
  const contributors = [];
  const builders = loadIIFE('menu/contextMenuBuilders.js', 'ContextMenuBuilders', {
    window: {},
    localStorage: createStorage(),
    LexeraSettings: null,
    console: { warn() {}, log() {}, error() {} }
  });

  builders.init({
    MenuContributorRegistry: {
      register(definition) {
        contributors.push(definition);
      }
    },
    TAG_CATEGORIES: {},
    hasTag: () => false,
    getBoardSettingValue: () => options.defaultWidth || '350px',
    normalizeStackWidth: options.normalizeStackWidth,
    isOverlayEditorEnabled: () => false
  });

  return contributors.find((entry) => entry.id === 'stack-actions');
}

beforeAll(() => {
  BoardSettings = loadIIFE('board/boardSettings.js', 'LexeraBoardSettings', {
    window: { LexeraRuntime: null }
  });
});

describe('stack width controls', () => {
  it('normalizes legacy board font-size multipliers instead of collapsing them to raw px values', () => {
    expect(BoardSettings.normalizeBoardFontSizeValue('1_0x')).toBe('13px');
    expect(BoardSettings.normalizeBoardFontSizeValue('0_75x')).toBe('9.75px');
    expect(BoardSettings.normalizeBoardFontSizeValue('1_25x')).toBe('16.25px');
    expect(BoardSettings.normalizeBoardFontSizeValue('bogus')).toBe('13px');
  });

  it('normalizes stack widths into the supported range', () => {
    expect(BoardSettings.normalizeStackWidth('420')).toBe('420px');
    expect(BoardSettings.normalizeStackWidth('120px')).toBe('200px');
    expect(BoardSettings.normalizeStackWidth('1400px')).toBe('1200px');
    expect(BoardSettings.normalizeStackWidth('')).toBe('');
  });

  it('resolves board-level stackWidth from board settings before fallbacks', () => {
    BoardSettings.init({
      getFullBoardData: () => ({
        boardSettings: {
          stackWidth: '480px'
        }
      }),
      getCachedWorkspaceSettings: () => ({ stackWidth: '420px' }),
      getLocalStorage: () => ({
        getItem: vi.fn(() => '350px')
      })
    });

    expect(BoardSettings.getBoardSettingValue('stackWidth', '350px')).toBe('480px');
  });

  it('shows the board default width in the stack context menu when no override tag exists', () => {
    const stackActions = buildStackActionsContributor({
      defaultWidth: '400px',
      normalizeStackWidth: BoardSettings.normalizeStackWidth
    });
    const items = stackActions.build('stack', { elementText: 'Planning' });
    const widthMenu = items.find((item) => item.id === 'stack-width');

    expect(widthMenu).toBeTruthy();
    expect(widthMenu.items[0].label).toBe('Width: 400px (default)');
    expect(widthMenu.items.some((item) => item.id === 'set-stack-width:reset')).toBe(false);
  });

  it('shows per-stack reset controls when a width tag override exists', () => {
    const stackActions = buildStackActionsContributor({
      defaultWidth: '350px',
      normalizeStackWidth: BoardSettings.normalizeStackWidth
    });
    const items = stackActions.build('stack', { elementText: 'Planning #width{500}' });
    const widthMenu = items.find((item) => item.id === 'stack-width');

    expect(widthMenu.items[0].label).toBe('Width: 500px');
    expect(widthMenu.items.some((item) => item.id === 'set-stack-width:reset')).toBe(true);
  });
});
