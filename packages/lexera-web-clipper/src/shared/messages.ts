export const MESSAGE_TYPES = {
  popupLoad: 'popup/load',
  popupLoadColumns: 'popup/load-columns',
  popupCapture: 'popup/capture',
  popupSetBackendUrl: 'popup/set-backend-url',
  contentCollect: 'content/collect',
} as const;

export const CONTEXT_MENU_IDS = {
  page: 'lexera-clip-page',
  selection: 'lexera-clip-selection',
  link: 'lexera-clip-link',
  image: 'lexera-clip-image',
} as const;
