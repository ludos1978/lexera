/**
 * String and Path Utilities for Webview
 *
 * Provides shared escaping and path handling helpers across webview scripts.
 * Path utilities mirror the backend TypeScript stringUtils.ts for consistency.
 */

(function () {
    'use strict';

    // ============= STRING ESCAPING =============

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeRegExp(value) {
        return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ============= PATH UTILITIES =============

    /**
     * Normalizes path separators to forward slashes.
     * Use for cross-platform path consistency.
     * @param {string} filePath - The file path to normalize
     * @returns {string} Path with forward slashes only
     */
    function toForwardSlashes(filePath) {
        if (!filePath) return '';
        return filePath.replace(/\\/g, '/');
    }

    /**
     * Safely decodes a URI component, returning the original string if decoding fails.
     * @param {string} str - The string to decode
     * @returns {string} The decoded string, or original if decoding fails
     */
    function safeDecodeURIComponent(str) {
        if (!str || !str.includes('%')) {
            return str || '';
        }
        try {
            return decodeURIComponent(str);
        } catch {
            return str;
        }
    }

    /**
     * Normalizes a file path for case-insensitive lookup.
     * Converts to lowercase, normalizes path separators, and trims whitespace.
     * @param {string} filePath - The file path to normalize
     * @returns {string} Normalized path for use as lookup key
     */
    function normalizePathForLookup(filePath) {
        if (!filePath) return '';
        let normalized = toForwardSlashes(filePath.trim().toLowerCase());
        while (normalized.startsWith('./')) {
            normalized = normalized.slice(2);
        }
        return normalized;
    }

    /**
     * Compares two paths for equality using normalized comparison.
     * Case-insensitive and platform-independent (handles both / and \).
     * @param {string} path1 - First path to compare
     * @param {string} path2 - Second path to compare
     * @returns {boolean} true if paths are equivalent after normalization
     */
    function isSamePath(path1, path2) {
        return normalizePathForLookup(path1) === normalizePathForLookup(path2);
    }

    /**
     * Extracts the basename (filename) from a path.
     * Handles both forward slashes and backslashes.
     * @param {string} filePath - The file path
     * @returns {string} The basename (filename with extension)
     */
    function getBasename(filePath) {
        if (!filePath) return '';
        const normalized = toForwardSlashes(filePath);
        return normalized.split('/').pop() || filePath;
    }

    /**
     * Extracts the directory path from a file path.
     * Handles both forward slashes and backslashes.
     * @param {string} filePath - The file path
     * @returns {string} The directory path (without trailing slash)
     */
    function getDirname(filePath) {
        if (!filePath) return '';
        const normalized = toForwardSlashes(filePath);
        const lastSlash = normalized.lastIndexOf('/');
        return lastSlash > 0 ? normalized.substring(0, lastSlash) : '';
    }

    /**
     * Checks if a path is absolute.
     * @param {string} filePath - The file path to check
     * @returns {boolean} true if the path is absolute
     */
    function isAbsolutePath(filePath) {
        if (!filePath) return false;
        // Unix absolute path starts with /
        if (filePath.startsWith('/')) return true;
        // Windows absolute path like C:\ or C:/
        if (/^[a-zA-Z]:[\\/]/.test(filePath)) return true;
        return false;
    }

    // ============= GLOBAL EXPORTS =============

    if (typeof window !== 'undefined') {
        // Legacy escaping functions (maintain backward compatibility)
        if (!window.escapeHtml) {
            window.escapeHtml = escapeHtml;
        }
        if (!window.escapeRegExp) {
            window.escapeRegExp = escapeRegExp;
        }

        // Path utilities (new)
        if (!window.toForwardSlashes) {
            window.toForwardSlashes = toForwardSlashes;
        }
        if (!window.safeDecodeURIComponent) {
            window.safeDecodeURIComponent = safeDecodeURIComponent;
        }
        if (!window.normalizePathForLookup) {
            window.normalizePathForLookup = normalizePathForLookup;
        }
        if (!window.isSamePath) {
            window.isSamePath = isSamePath;
        }
        if (!window.getBasename) {
            window.getBasename = getBasename;
        }
        if (!window.getDirname) {
            window.getDirname = getDirname;
        }
        if (!window.isAbsolutePath) {
            window.isAbsolutePath = isAbsolutePath;
        }

        // Unified stringUtils object
        if (!window.stringUtils) {
            window.stringUtils = {};
        }
        Object.assign(window.stringUtils, {
            escapeHtml,
            escapeRegExp,
            toForwardSlashes,
            safeDecodeURIComponent,
            normalizePathForLookup,
            isSamePath,
            getBasename,
            getDirname,
            isAbsolutePath
        });
    }
})();
