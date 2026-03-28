export const MESSAGE_TYPES = {
  popupLoad: 'popup/load',
  popupLoadColumns: 'popup/load-columns',
  popupSearch: 'popup/search',
  popupCapture: 'popup/capture',
  popupSaveSettings: 'popup/save-settings',
  popupTestConnection: 'popup/test-connection',
  contentCollect: 'content/collect',
} as const;

export const CONTEXT_MENU_IDS = {
  page: 'lexera-clip-page',
  selection: 'lexera-clip-selection',
  link: 'lexera-clip-link',
  image: 'lexera-clip-image',
} as const;
