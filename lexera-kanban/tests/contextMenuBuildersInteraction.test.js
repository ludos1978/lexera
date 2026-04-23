import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadIIFE } from './load-iife.js';

function createStorage() {
  const data = {};
  return {
    getItem: vi.fn((key) => Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: vi.fn((key, value) => { data[key] = String(value); }),
    removeItem: vi.fn((key) => { delete data[key]; })
  };
}

function loadContextMenuBuilders(localStorage = createStorage()) {
  const window = {};
  const ContextMenuBuilders = loadIIFE('menu/contextMenuBuilders.js', 'ContextMenuBuilders', {
    window,
    localStorage,
    console: { warn() {} }
  });
  return { ContextMenuBuilders, localStorage };
}

describe('ContextMenuBuilders interactions', () => {
  let storage;
  let CMB;

  beforeEach(() => {
    const loaded = loadContextMenuBuilders();
    CMB = loaded.ContextMenuBuilders;
    storage = loaded.localStorage;
  });

  it('builds custom tag menus only for user tags the card already has', () => {
    CMB.init({
      MenuContributorRegistry: { register: vi.fn() },
      TAG_CATEGORIES: {
        status: ['todo'],
        priority: ['p1']
      },
      extractAllTags: () => ['#todo', '#custom', '#row2', '#hidden-internal-archived', '#p1'],
      isLayoutTagName: (tag) => /^#row\d+$/i.test(tag),
      hasTag: (text, tag) => String(text || '').toLowerCase().includes(tag)
    });

    const submenu = CMB.buildCustomTagsSubmenu('#todo #custom #row2 #p1', 'tag-custom-');

    expect(submenu.label).toBe('Custom Tags');
    expect(submenu.items).toEqual([{ id: 'tag-custom-custom', label: '\u2713 #custom' }]);
  });

  it('persists configured tag groups and reuses them for later menu builds', () => {
    CMB.setTagGroupsForScope('card', ['status', 'priority']);

    expect(storage.setItem).toHaveBeenCalledWith('lexera-tag-groups-card', JSON.stringify(['status', 'priority']));
    expect(CMB.getTagGroupsForScope('card')).toEqual(['status', 'priority']);
  });

  it('registers a canvas background menu item only for a real row target', () => {
    const contributors = [];
    CMB.init({
      MenuContributorRegistry: { register: (contributor) => contributors.push(contributor) },
      TAG_CATEGORIES: {},
      extractAllTags: () => [],
      isLayoutTagName: () => false,
      hasTag: () => false,
      MARP_COLOR_DIRECTIVES: [],
      MARP_TEXT_DIRECTIVES: [],
      getAvailableMarpClassNames: () => [],
      getMarpClassListFromHeader: () => [],
      formatMenuToggleLabel: (active, label) => `${active ? '\u2713 ' : ''}${label}`,
      hasMarpDirectiveValue: () => false,
      getMarpDirectiveValueFromHeader: () => '',
      truncateMarpDirectiveValue: (value) => value,
      getBoardSettingValue: () => '350px',
      normalizeStackWidth: (value) => value
    });

    const canvasContributor = contributors.find((contributor) => contributor.id === 'core-canvas-background');
    expect(canvasContributor.build('canvas', { rowIdx: 2 })).toEqual([
      { id: 'add-stack-here', label: 'Create stack here' }
    ]);
    expect(canvasContributor.build('canvas', {})).toBeNull();
  });
});
