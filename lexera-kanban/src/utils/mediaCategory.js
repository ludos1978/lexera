// Leading line comment to dodge slice-13 checkJs duplicate-id quirk.

/**
 * @typedef {Object} LexeraMediaCategoryDeps
 * @property {(url: string | null | undefined) => boolean} isExternalHttpUrl
 * @property {(path: string | null | undefined) => string} normalizeFilePathForDetection
 * @property {(path: string) => string} getFileNameFromPath
 */

/**
 * @typedef {'image' | 'video' | 'audio' | 'document' | 'unknown' | ''} LexeraMediaCategoryKind
 */

/**
 * @typedef {Object} LexeraMediaCategoryApi
 * @property {(deps: LexeraMediaCategoryDeps) => void} init
 * @property {(ext: string | null | undefined) => LexeraMediaCategoryKind} getMediaCategory
 * @property {(url: string | null | undefined) => LexeraMediaCategoryKind} inferExternalMediaCategoryFromUrl
 * @property {(path: string | null | undefined) => string} getFileExtension
 * @property {(path: string | null | undefined) => string} getInlineFileEmbedExtension
 */

var LexeraMediaCategory = (function () {
  'use strict';
  /** @type {Partial<LexeraMediaCategoryDeps>} */
  var _deps = {};
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      _rt = window.LexeraRuntime;
      _rt.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  /**
   * @param {string | null | undefined} ext
   * @returns {LexeraMediaCategoryKind}
   */
  function getMediaCategory(ext) {
    if (!ext) return 'unknown';
    ext = ext.toLowerCase();
    /** @type {{ [k: string]: Array<string> }} */
    var cats = {
      image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif'],
      video: ['mp4', 'webm', 'mov', 'avi', 'mkv'],
      audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
      document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'txt', 'md', 'csv', 'json', 'epub'],
    };
    for (var cat in cats) {
      if (cats[cat].indexOf(ext) !== -1) return /** @type {LexeraMediaCategoryKind} */ (cat);
    }
    return 'unknown';
  }

  /**
   * @param {string | null | undefined} url
   * @returns {LexeraMediaCategoryKind}
   */
  function inferExternalMediaCategoryFromUrl(url) {
    if (!_deps.isExternalHttpUrl || !_deps.isExternalHttpUrl(url)) return '';
    try {
      var parsed = new URL(String(url || ''));
      var host = (parsed.hostname || '').toLowerCase();
      if (
        /(^|\.)googleusercontent\.com$/.test(host) ||
        /(^|\.)ggpht\.com$/.test(host) ||
        /(^|\.)ytimg\.com$/.test(host)
      ) {
        return 'image';
      }
      var formatHint = (
        parsed.searchParams.get('format') ||
        parsed.searchParams.get('fm') ||
        parsed.searchParams.get('mime')
      );
      var hintedExt = getFileExtension(formatHint || '');
      if (hintedExt) return getMediaCategory(hintedExt);
    } catch (err) {
      return '';
    }
    return '';
  }

  /**
   * @param {string | null | undefined} path
   * @returns {string}
   */
  function getFileExtension(path) {
    if (!_deps.normalizeFilePathForDetection || !_deps.getFileNameFromPath) return '';
    var value = _deps.normalizeFilePathForDetection(path);
    if (!value) return '';
    var fileName = _deps.getFileNameFromPath(value);
    var dot = fileName.lastIndexOf('.');
    if (dot <= 0 || dot === fileName.length - 1) return '';
    return fileName.substring(dot + 1).toLowerCase();
  }

  /** @type {{ [k: string]: boolean }} */
  var INLINE_FILE_EMBED_EXTENSIONS = {
    md: true,
    markdown: true,
    txt: true,
    log: true,
    csv: true,
    tsv: true,
    json: true,
    yaml: true,
    yml: true,
    toml: true,
    ini: true,
    cfg: true,
    conf: true,
    xml: true,
    html: true,
    htm: true
  };

  function getInlineFileEmbedExtension(path) {
    var ext = getFileExtension(path);
    return INLINE_FILE_EMBED_EXTENSIONS[ext] ? ext : '';
  }

  /** @type {LexeraMediaCategoryApi} */
  var api = {
    init: init,
    getMediaCategory: getMediaCategory,
    inferExternalMediaCategoryFromUrl: inferExternalMediaCategoryFromUrl,
    getFileExtension: getFileExtension,
    getInlineFileEmbedExtension: getInlineFileEmbedExtension
  };
  return api;
})();
if (typeof globalThis !== 'undefined') globalThis.LexeraMediaCategory = LexeraMediaCategory;
if (typeof window !== 'undefined') window.LexeraMediaCategory = LexeraMediaCategory;
