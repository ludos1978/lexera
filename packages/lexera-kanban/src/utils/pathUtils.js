(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LexeraPathUtils = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // Path helper utilities
  // ═══════════════════════════════════════════════════════════════════════════

  function normalizePathForCompare(path) {
    return String(path || '').replace(/\\/g, '/');
  }

  function decodeHtmlEntities(value) {
    if (value == null || value === '') return '';
    var textarea = document.createElement('textarea');
    textarea.innerHTML = String(value);
    return textarea.value;
  }

  function isExternalHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || ''));
  }

  function stripPathSearchAndHash(path) {
    var value = String(path || '').trim();
    if (!value) return '';
    try {
      if (isExternalHttpUrl(value)) value = new URL(value).pathname || '';
    } catch (e) {
      // Fall back to simple path parsing below.
    }
    return value.split('#')[0].split('?')[0];
  }

  function decodePathDisplayValue(value) {
    var raw = String(value || '');
    if (!raw) return '';
    try {
      return decodeURIComponent(raw);
    } catch (e) {
      return raw;
    }
  }

  function getFileNameFromPath(path) {
    var normalized = normalizePathForCompare(stripPathSearchAndHash(path));
    if (!normalized) return '';
    var idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(idx + 1) : normalized;
  }

  function getDisplayFileNameFromPath(path) {
    return decodePathDisplayValue(getFileNameFromPath(path));
  }

  function getDirNameFromPath(path) {
    var normalized = normalizePathForCompare(stripPathSearchAndHash(path));
    if (!normalized) return '';
    var idx = normalized.lastIndexOf('/');
    return idx > 0 ? normalized.slice(0, idx) : '';
  }

  function getDisplayNameFromPath(path) {
    var fileName = getDisplayFileNameFromPath(path);
    return fileName ? fileName.replace(/\.[^.]+$/, '') : '';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Board-relative path utilities
  // ═══════════════════════════════════════════════════════════════════════════

  function isAbsoluteFilePath(value) {
    var normalized = normalizePathForCompare(String(value || ''));
    return normalized.charAt(0) === '/' || /^[a-zA-Z]:\//.test(normalized);
  }

  function isBoardRelativePath(value) {
    var normalized = decodeHtmlEntities(String(value || '').trim());
    if (!normalized) return false;
    if (normalized.charAt(0) === '#') return false;
    if (/^(https?:\/\/|mailto:|data:)/i.test(normalized)) return false;
    return !isAbsoluteFilePath(normalized);
  }

  function joinBoardRelativePath(baseDir, relativePath) {
    var rel = normalizePathForCompare(decodeHtmlEntities(String(relativePath || '').trim()));
    if (!rel) return rel;
    if (!isBoardRelativePath(rel)) return rel;

    var base = normalizePathForCompare(String(baseDir || ''));
    var prefix = '';
    var parts = [];

    if (/^[a-zA-Z]:\//.test(base)) {
      prefix = base.slice(0, 2);
      base = base.slice(2);
    }

    parts = base.split('/');
    if (parts.length && parts[parts.length - 1] === '') parts.pop();
    if (parts.length && parts[0] === '') {
      prefix = prefix || '/';
      parts.shift();
    }

    var relParts = rel.split('/');
    for (var i = 0; i < relParts.length; i++) {
      var part = relParts[i];
      if (!part || part === '.') continue;
      if (part === '..') {
        if (parts.length > 0) parts.pop();
        continue;
      }
      parts.push(part);
    }

    if (prefix === '/') return '/' + parts.join('/');
    if (prefix) return prefix + '/' + parts.join('/');
    return parts.join('/');
  }

  /// Compute the relative path from `fromDir` to `toPath`, both relative to the
  /// same base directory. Returns the shortest relative path.
  function computeRelativePath(fromDir, toPath) {
    var from = normalizePathForCompare(String(fromDir || '')).split('/').filter(function (s) { return s && s !== '.'; });
    var to = normalizePathForCompare(String(toPath || '')).split('/').filter(function (s) { return s && s !== '.'; });

    // Resolve .. in both paths
    function resolveSegments(parts) {
      var res = [];
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] === '..') { if (res.length > 0) res.pop(); }
        else res.push(parts[i]);
      }
      return res;
    }
    from = resolveSegments(from);
    to = resolveSegments(to);

    // Find common prefix length
    var common = 0;
    while (common < from.length && common < to.length && from[common] === to[common]) common++;

    // Build relative path: go up for remaining fromDir segments, then down for remaining toPath segments
    var result = [];
    for (var u = common; u < from.length; u++) result.push('..');
    for (var d = common; d < to.length; d++) result.push(to[d]);
    return result.join('/') || '.';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MD5 hash implementation
  // ═══════════════════════════════════════════════════════════════════════════

  function encodeUtf8Base64(value) {
    try {
      return btoa(encodeURIComponent(String(value || '')).replace(/%([0-9A-F]{2})/g, function (_, hex) {
        return String.fromCharCode(parseInt(hex, 16));
      }));
    } catch (e) {
      return '';
    }
  }

  function utf8EncodeBytes(value) {
    var text = String(value || '');
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(text);
    }
    var encoded = unescape(encodeURIComponent(text));
    var out = new Uint8Array(encoded.length);
    for (var i = 0; i < encoded.length; i++) out[i] = encoded.charCodeAt(i);
    return out;
  }

  var MD5_SHIFT_VALUES = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  var md5KValues = null;

  function getMd5KValues() {
    if (md5KValues) return md5KValues;
    md5KValues = [];
    for (var i = 0; i < 64; i++) {
      md5KValues.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0);
    }
    return md5KValues;
  }

  function leftRotate32(value, bits) {
    return (value << bits) | (value >>> (32 - bits));
  }

  function toHexLittleEndian(value) {
    var out = '';
    for (var i = 0; i < 4; i++) {
      out += ('0' + ((value >>> (i * 8)) & 255).toString(16)).slice(-2);
    }
    return out;
  }

  function md5Hex(value) {
    var bytes = utf8EncodeBytes(value);
    var originalLength = bytes.length;
    var totalLength = (((originalLength + 8) >> 6) + 1) * 64;
    var padded = new Uint8Array(totalLength);
    padded.set(bytes);
    padded[originalLength] = 0x80;

    var bitLength = BigInt(originalLength) * 8n;
    for (var i = 0; i < 8; i++) {
      padded[totalLength - 8 + i] = Number((bitLength >> BigInt(i * 8)) & 255n);
    }

    var a0 = 1732584193;
    var b0 = -271733879;
    var c0 = -1732584194;
    var d0 = 271733878;
    var kValues = getMd5KValues();

    for (var offset = 0; offset < padded.length; offset += 64) {
      var words = new Int32Array(16);
      for (var j = 0; j < 16; j++) {
        var idx = offset + (j * 4);
        words[j] = padded[idx] |
          (padded[idx + 1] << 8) |
          (padded[idx + 2] << 16) |
          (padded[idx + 3] << 24);
      }

      var a = a0;
      var b = b0;
      var c = c0;
      var d = d0;

      for (var round = 0; round < 64; round++) {
        var f = 0;
        var g = 0;
        if (round < 16) {
          f = (b & c) | ((~b) & d);
          g = round;
        } else if (round < 32) {
          f = (d & b) | ((~d) & c);
          g = (5 * round + 1) % 16;
        } else if (round < 48) {
          f = b ^ c ^ d;
          g = (3 * round + 5) % 16;
        } else {
          f = c ^ (b | (~d));
          g = (7 * round) % 16;
        }

        var nextD = d;
        d = c;
        c = b;
        var rotated = leftRotate32((a + f + kValues[round] + words[g]) | 0, MD5_SHIFT_VALUES[round]);
        b = (b + rotated) | 0;
        a = nextD;
      }

      a0 = (a0 + a) | 0;
      b0 = (b0 + b) | 0;
      c0 = (c0 + c) | 0;
      d0 = (d0 + d) | 0;
    }

    return toHexLittleEndian(a0) + toHexLittleEndian(b0) + toHexLittleEndian(c0) + toHexLittleEndian(d0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════════

  return {
    normalizePathForCompare: normalizePathForCompare,
    decodeHtmlEntities: decodeHtmlEntities,
    isExternalHttpUrl: isExternalHttpUrl,
    stripPathSearchAndHash: stripPathSearchAndHash,
    decodePathDisplayValue: decodePathDisplayValue,
    getFileNameFromPath: getFileNameFromPath,
    getDisplayFileNameFromPath: getDisplayFileNameFromPath,
    getDirNameFromPath: getDirNameFromPath,
    getDisplayNameFromPath: getDisplayNameFromPath,
    isAbsoluteFilePath: isAbsoluteFilePath,
    isBoardRelativePath: isBoardRelativePath,
    joinBoardRelativePath: joinBoardRelativePath,
    computeRelativePath: computeRelativePath,
    encodeUtf8Base64: encodeUtf8Base64,
    utf8EncodeBytes: utf8EncodeBytes,
    md5Hex: md5Hex
  };
}));
