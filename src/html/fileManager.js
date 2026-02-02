/**
 * File Manager overlay — unified dialog for file states and conflict resolution
 *
 * ONE dialog, ONE table for both browse mode (Files button) and resolve mode
 * (Cmd+S conflicts, Ctrl+R reload, external changes).
 *
 * Table columns: File | Status | Cache | Saved | Action | Save | Reload | Rel | Abs | Image
 * Both modes render the same table; differences are in dialog chrome (header/footer)
 * and action dropdown defaults.
 */

// ============= STATE =============

let fileManagerVisible = false;
let fileManagerElement = null;
let trackedFilesData = {};
let lastTrackedFilesDataHash = null;
let refreshCount = 0;
let fileManagerNoticeTimer = null;
let syncVerifyTimer = null;
const SYNC_VERIFY_DEBOUNCE_MS = 300;

// Dialog mode state
let dialogMode = null;   // null | 'browse' | 'resolve'
let openMode = null;     // null | 'browse' | 'save_conflict' | 'reload_request' | 'external_change'
let conflictId = null;
let conflictFiles = [];  // from backend message (resolve mode)
let perFileResolutions = new Map(); // path -> action

let autoRefreshTimer = null;

// Verification state
let pendingForceWrite = false;
let lastVerificationResults = null;

// ============= TOAST NOTIFICATION =============

function showFileManagerNotice(message, type = 'info', timeoutMs = 3000) {
    const existing = document.getElementById('file-manager-toast');
    const toast = existing || document.createElement('div');
    if (!existing) {
        toast.id = 'file-manager-toast';
        toast.style.position = 'fixed';
        toast.style.top = '12px';
        toast.style.right = '12px';
        toast.style.zIndex = '100000';
        toast.style.padding = '8px 12px';
        toast.style.borderRadius = '6px';
        toast.style.fontSize = '12px';
        toast.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
        toast.style.pointerEvents = 'none';
        document.body.appendChild(toast);
    }
    const colors = {
        info: { bg: '#2f6feb', fg: '#fff' },
        warn: { bg: '#d29922', fg: '#1b1f23' },
        error: { bg: '#d1242f', fg: '#fff' }
    };
    const theme = colors[type] || colors.info;
    toast.style.background = theme.bg;
    toast.style.color = theme.fg;
    toast.textContent = message;
    toast.style.display = 'block';
    if (fileManagerNoticeTimer) {
        clearTimeout(fileManagerNoticeTimer);
    }
    fileManagerNoticeTimer = setTimeout(() => {
        toast.style.display = 'none';
    }, timeoutMs);
}

// ============= ACTION DEFINITIONS =============

const ALL_ACTIONS = [
    { value: 'overwrite', label: 'Save to disk' },
    { value: 'overwrite_backup_external', label: 'Save to disk (backup existing)' },
    { value: 'load_external', label: 'Load from disk' },
    { value: 'load_external_backup_mine', label: 'Load from disk (backup kanban)' },
    { value: 'skip', label: 'Skip' }
];

function getActionsForFile(file) {
    const hasExternal = file.hasExternalChanges;
    const hasUnsaved = file.hasUnsavedChanges;
    if (hasExternal) {
        return ALL_ACTIONS;
    }
    if (hasUnsaved) {
        return ALL_ACTIONS.filter(a =>
            a.value === 'overwrite' || a.value === 'overwrite_backup_external' || a.value === 'skip'
        );
    }
    return ALL_ACTIONS.filter(a =>
        a.value === 'overwrite' || a.value === 'load_external' || a.value === 'skip'
    );
}

function getDefaultAction(file) {
    if (!openMode || openMode === 'browse') return '';
    if (openMode === 'save_conflict') {
        return file.hasExternalChanges ? 'overwrite' : '';
    }
    if (openMode === 'reload_request') {
        return 'load_external';
    }
    if (openMode === 'external_change') {
        return file.hasExternalChanges ? 'load_external' : '';
    }
    return '';
}

// ============= DIALOG ENTRY POINTS =============

/**
 * Open the dialog in resolve mode. Called by showConflictDialog message handler
 * for save_conflict, reload_request, and external_change modes.
 */
function openUnifiedDialog(message) {
    // Dismiss any external changes notification when dialog opens
    dismissExternalChangesNotification();

    if (message.openMode === 'browse') {
        showFileManager();
        return;
    }

    conflictId = message.conflictId;
    conflictFiles = message.files || [];
    openMode = message.openMode || 'external_change';
    dialogMode = 'resolve';
    perFileResolutions = new Map();

    // Set default actions per file
    conflictFiles.forEach(f => {
        const defaultAction = getDefaultAction(f);
        if (defaultAction) {
            perFileResolutions.set(f.path, defaultAction);
        }
    });

    // Request tracked files data so sync columns are populated
    if (window.vscode) {
        window.vscode.postMessage({ type: 'getTrackedFilesDebugInfo' });
    }

    buildAndShowDialog();
    verifyContentSync(true);
}

/**
 * Open the dialog in browse mode (Files button).
 */
function showFileManager() {
    if (typeof window.vscode === 'undefined') {
        showFileManagerNotice('File manager error: vscode API not available', 'error');
        return;
    }

    dialogMode = 'browse';
    openMode = 'browse';
    conflictId = null;
    conflictFiles = [];
    perFileResolutions.clear();

    window.vscode.postMessage({ type: 'getTrackedFilesDebugInfo' });

    buildAndShowDialog();
    startAutoRefresh();
    verifyContentSync(true);
}

/**
 * Shared dialog builder — creates the DOM element with unified content.
 */
function buildAndShowDialog() {
    // Blur before removing to prevent VS Code trackFocus classList error
    if (document.activeElement && fileManagerElement?.contains(document.activeElement)) {
        document.activeElement.blur();
    }
    if (fileManagerElement) {
        fileManagerElement.remove();
    }

    fileManagerElement = document.createElement('div');
    fileManagerElement.id = 'file-manager';
    fileManagerElement.innerHTML = createDialogContent();
    document.body.appendChild(fileManagerElement);
    fileManagerVisible = true;

    // Click outside panel to close (browse mode only)
    fileManagerElement.addEventListener('click', (e) => {
        if (e.target === fileManagerElement && dialogMode === 'browse') {
            closeDialog();
        }
    });
}

// ============= CLOSE / HIDE =============

function closeDialog() {
    if (dialogMode === 'resolve') {
        cancelConflictResolution();
        return;
    }
    hideFileManager();
}

function hideFileManager() {
    dialogMode = null;
    openMode = null;
    conflictId = null;
    conflictFiles = [];
    perFileResolutions.clear();

    stopAutoRefresh();
    if (syncVerifyTimer) {
        clearTimeout(syncVerifyTimer);
        syncVerifyTimer = null;
    }

    if (fileManagerElement) {
        // Blur before removing to prevent VS Code trackFocus classList error
        if (document.activeElement && fileManagerElement.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        fileManagerElement.remove();
        fileManagerElement = null;
    }
    fileManagerVisible = false;
}

// ============= CONFLICT RESOLUTION =============

function submitConflictResolution() {
    if (!conflictId || !window.vscode) return;

    const resolutions = [];
    perFileResolutions.forEach((action, path) => {
        if (action) {
            resolutions.push({ path, action });
        }
    });

    window.vscode.postMessage({
        type: 'conflictResolution',
        conflictId: conflictId,
        cancelled: false,
        perFileResolutions: resolutions
    });

    hideFileManager();
}

function cancelConflictResolution() {
    if (conflictId && window.vscode) {
        window.vscode.postMessage({
            type: 'conflictResolution',
            conflictId: conflictId,
            cancelled: true,
            perFileResolutions: []
        });
    }
    hideFileManager();
}

function onConflictActionChange(selectElement) {
    const filePath = selectElement.dataset.filePath;
    const action = selectElement.value;
    perFileResolutions.set(filePath, action);
}

function onConflictApplyAll(selectElement) {
    const action = selectElement.value;
    if (!action) return;

    // Update all per-file selects in the DOM
    const selects = fileManagerElement?.querySelectorAll('.conflict-action-select');
    if (selects) {
        selects.forEach(sel => {
            const filePath = sel.dataset.filePath;
            const optionExists = Array.from(sel.options).some(opt => opt.value === action);
            if (optionExists) {
                sel.value = action;
                perFileResolutions.set(filePath, action);
            }
        });
    }
}

// ============= UNIFIED DIALOG CONTENT =============

function createDialogContent() {
    const now = new Date().toLocaleTimeString();
    const isResolve = dialogMode === 'resolve';

    const subtitleMap = {
        save_conflict: 'Pre-save Conflict',
        external_change: 'External Changes Detected',
        reload_request: 'Reload Request'
    };
    const subtitle = isResolve && openMode ? subtitleMap[openMode] || '' : '';

    const panelClass = isResolve ? 'file-manager-panel resolve-mode' : 'file-manager-panel';

    return `
        <div class="${panelClass}">
            <div class="file-manager-header">
                <h3>File Manager</h3>
                ${subtitle ? `<div class="conflict-subtitle">${subtitle}</div>` : ''}
                <div class="file-manager-header-meta">
                    <button onclick="verifyContentSync()" class="file-manager-btn" title="Re-verify all hashes and sync status">
                        Verify Sync
                    </button>
                    <span class="file-manager-timestamp">Updated: ${now}</span>
                </div>
                ${!isResolve ? `
                    <div class="file-manager-controls">
                        <button onclick="closeDialog()" class="file-manager-close">✕</button>
                    </div>
                ` : ''}
            </div>
            <div class="file-manager-content">
                <div class="unified-table-container">
                    ${createUnifiedTable()}
                </div>
            </div>
            ${isResolve ? `
                <div class="conflict-footer">
                    <div class="conflict-footer-content">
                        <div class="conflict-footer-buttons">
                            <button onclick="cancelConflictResolution()" class="conflict-btn conflict-btn-cancel">Cancel</button>
                            <button onclick="submitConflictResolution()" class="conflict-btn conflict-btn-resolve">Resolve</button>
                        </div>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

// ============= UNIFIED FILE LIST =============

/**
 * Build the unified file list by merging trackedFilesData with conflictFiles overlay.
 * In browse mode: uses trackedFilesData only (conflictFiles is empty).
 * In resolve mode: uses conflictFiles as base, enriched with trackedFilesData sync info.
 */
function buildUnifiedFileList() {
    const browseFiles = createAllFilesArray();

    // Use basename for matching — conflictFiles use absolute paths, browseFiles use relative paths
    const basename = (p) => p ? p.split('/').pop() : p;
    const conflictMap = new Map(conflictFiles.map(f => [basename(f.path), f]));
    const browseBasenames = new Set(browseFiles.map(f => basename(f.path)));

    // Start from browse files (has all tracked files with sync data)
    const unified = browseFiles.map(file => {
        const conflict = conflictMap.get(basename(file.path));
        return {
            ...file,
            // Overlay conflict-specific fields when available
            hasExternalChanges: conflict ? conflict.hasExternalChanges : (file.hasExternalChanges || false),
            hasUnsavedChanges: conflict ? conflict.hasUnsavedChanges : (file.hasInternalChanges || false),
            isInEditMode: conflict ? conflict.isInEditMode : false,
            fileType: conflict ? conflict.fileType : (file.isMainFile ? 'main' : file.type),
        };
    });

    // Add any conflict files that aren't in browse data
    conflictFiles.forEach(cf => {
        if (!browseBasenames.has(basename(cf.path))) {
            unified.push({
                path: cf.path,
                relativePath: cf.relativePath || cf.path,
                name: basename(cf.path) || cf.path,
                type: cf.fileType || 'include',
                isMainFile: cf.fileType === 'main',
                exists: true,
                hasExternalChanges: cf.hasExternalChanges || false,
                hasUnsavedChanges: cf.hasUnsavedChanges || false,
                hasInternalChanges: cf.hasUnsavedChanges || false,
                isInEditMode: cf.isInEditMode || false,
                fileType: cf.fileType || 'include',
            });
        }
    });

    return unified;
}

/**
 * Create array of all files (main + included) from trackedFilesData.
 */
function createAllFilesArray() {
    const allFiles = [];

    // Skip main file entry if trackedFilesData hasn't arrived yet
    const mainFile = trackedFilesData.mainFile;
    if (mainFile && mainFile !== 'Unknown') {
        const mainFileInfo = trackedFilesData.watcherDetails || {};
        allFiles.push({
            path: mainFile,
            relativePath: mainFile.split('/').pop(),
            name: mainFile.split('/').pop(),
            type: 'main',
            isMainFile: true,
            exists: true,
            hasInternalChanges: mainFileInfo.hasInternalChanges || false,
            hasExternalChanges: mainFileInfo.hasExternalChanges || false,
            documentVersion: mainFileInfo.documentVersion || 0,
            lastDocumentVersion: mainFileInfo.lastDocumentVersion || -1,
            isUnsavedInEditor: mainFileInfo.isUnsavedInEditor || false,
            lastModified: trackedFilesData.mainFileLastModified || 'Unknown'
        });
    }

    const includeFiles = trackedFilesData.includeFiles || [];
    includeFiles.forEach(file => {
        allFiles.push({
            path: file.path,
            relativePath: file.path,
            name: file.path.split('/').pop(),
            type: file.type || 'include',
            isMainFile: false,
            exists: file.exists !== false,
            hasInternalChanges: file.hasInternalChanges || false,
            hasExternalChanges: file.hasExternalChanges || false,
            isUnsavedInEditor: file.isUnsavedInEditor || false,
            contentLength: file.contentLength || 0,
            baselineLength: file.baselineLength || 0,
            lastModified: file.lastModified || 'Unknown'
        });
    });

    return allFiles;
}

// ============= UNIFIED TABLE =============

/**
 * One table for all modes.
 * Columns: File | Status | Cache | Saved | Action | Save | Reload | Rel | Abs | Image
 */
function createUnifiedTable() {
    const files = buildUnifiedFileList();
    const summary = getFileSyncSummaryCounts();

    // "All Files" row
    const applyAllOptions = ALL_ACTIONS.map(a =>
        `<option value="${a.value}">${a.label}</option>`
    ).join('');

    const allFilesRow = `
        <tr class="files-table-actions" data-file-path="__all__">
            <td class="col-file all-files-label">All Files</td>
            <td class="col-status"></td>
            <td class="col-frontend sync-summary-cell">${renderSyncSummaryCompact(summary.cache)}</td>
            <td class="col-saved sync-summary-cell">${renderSyncSummaryCompact(summary.file)}</td>
            <td class="col-action">
                <div class="dropdown-exec">
                    <select class="conflict-action-select" data-file-path="__all__" data-is-main="false" onchange="onConflictApplyAll(this)">
                        <option value="">--</option>
                        ${applyAllOptions}
                    </select>
                    <button onclick="executeAllActions()" class="action-btn exec-btn" title="Execute selected action for all files">&#9654;</button>
                </div>
            </td>
            <td class="col-paths action-cell">
                <div class="dropdown-exec">
                    <select class="paths-select" data-file-path="__all__" data-is-main="false">
                        <option value="relative">Relative</option>
                        <option value="absolute">Absolute</option>
                    </select>
                    <button onclick="executeAllPaths()" class="action-btn exec-btn" title="Convert all paths">&#9654;</button>
                </div>
            </td>
            <td class="col-image action-cell">
                <button onclick="reloadImages()" class="action-btn reload-images-btn" title="Reload all images in the board">&#x1F5BC;&#xFE0F;</button>
            </td>
        </tr>
    `;

    const fileRows = files.map(file => {
        const mainFileClass = file.isMainFile ? 'main-file' : '';
        const missingFileClass = file.exists === false ? ' missing-file' : '';

        // --- Status column ---
        let statusBadge = '';
        const hasExternal = file.hasExternalChanges;
        const hasUnsaved = file.hasUnsavedChanges || file.hasInternalChanges;
        if (hasExternal && hasUnsaved) {
            statusBadge = '<span class="conflict-badge conflict-both" title="Both external and unsaved changes">External + Unsaved</span>';
        } else if (hasExternal) {
            statusBadge = '<span class="conflict-badge conflict-external" title="External changes detected">External</span>';
        } else if (hasUnsaved) {
            statusBadge = '<span class="conflict-badge conflict-unsaved" title="Unsaved changes">Unsaved</span>';
        } else {
            statusBadge = '<span class="conflict-badge conflict-none">Clean</span>';
        }
        if (file.isInEditMode) {
            statusBadge += ' <span class="conflict-badge" title="Currently being edited">Editing</span>';
        }

        // --- Cache & Saved sync columns ---
        const syncStatus = getFileSyncStatus(file.path);

        let frontendDisplay = '---';
        let frontendClass = 'sync-unknown';
        let frontendTitle = '';
        let registryHash = 'N/A';
        let registryChars = '?';

        let savedDisplay = '---';
        let savedClass = 'sync-unknown';
        let savedTitle = '';

        if (syncStatus) {
            const registryNormalized = syncStatus.registryNormalizedHash
                && syncStatus.registryNormalizedLength !== null
                && syncStatus.registryNormalizedLength !== undefined;
            registryHash = registryNormalized ? syncStatus.registryNormalizedHash : (syncStatus.canonicalHash || 'N/A');
            registryChars = registryNormalized ? syncStatus.registryNormalizedLength : (syncStatus.canonicalContentLength || 0);

            if (syncStatus.frontendHash && syncStatus.frontendContentLength !== null && syncStatus.frontendContentLength !== undefined) {
                if (syncStatus.frontendMatchesRaw === true) {
                    frontendDisplay = '✅';
                    frontendClass = 'sync-good';
                } else if (syncStatus.frontendMatchesNormalized === true) {
                    frontendDisplay = '⚠️';
                    frontendClass = 'sync-warn';
                } else if (syncStatus.frontendRegistryMatch === false) {
                    frontendDisplay = '⚠️';
                    frontendClass = 'sync-warn';
                }
                frontendTitle = `Frontend: ${syncStatus.frontendHash} (${syncStatus.frontendContentLength} chars)\nRegistry: ${registryHash} (${registryChars} chars)`;
            } else if (syncStatus.frontendAvailable === false) {
                frontendDisplay = '❓';
                frontendTitle = 'Frontend hash not available';
            }

            if (syncStatus.savedHash) {
                const savedHashValue = syncStatus.savedNormalizedHash || syncStatus.savedHash;
                const savedCharsValue = syncStatus.savedNormalizedLength ?? (syncStatus.savedContentLength || 0);

                if (syncStatus.canonicalSavedMatch) {
                    savedDisplay = '✅';
                    savedClass = 'sync-good';
                } else {
                    savedDisplay = '⚠️';
                    savedClass = 'sync-warn';
                }

                savedTitle = `Registry: ${registryHash} (${registryChars} chars)\nSaved: ${savedHashValue} (${savedCharsValue} chars)`;
            } else {
                savedDisplay = '❓';
                savedTitle = 'Saved file not available';
            }
        }

        // --- Action dropdown ---
        const actions = getActionsForFile(file);
        const currentAction = perFileResolutions.get(file.path) || '';
        const actionOptions = actions.map(a =>
            `<option value="${a.value}" ${a.value === currentAction ? 'selected' : ''}>${a.label}</option>`
        ).join('');

        // --- File column ---
        const dirPath = file.relativePath.includes('/')
            ? file.relativePath.substring(0, file.relativePath.lastIndexOf('/'))
            : '.';
        const truncatedDirPath = truncatePath(dirPath, 10);

        const fileType = file.fileType || file.type || 'include';
        const typeLabel = file.isMainFile ? 'Main' : getIncludeTypeShortLabel(fileType);
        const escapedPath = file.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        return `
            <tr class="file-row ${mainFileClass}${missingFileClass}" data-file-path="${file.path}">
                <td class="col-file">
                    <div class="file-directory-path" title="${file.path}">
                        ${truncatedDirPath}
                        ${!file.isMainFile ? `<span class="include-type-label ${fileType}">[${typeLabel}]</span>` : ''}
                    </div>
                    <div class="file-name-clickable" onclick="openFile('${escapedPath}')" title="${file.path}">
                        ${file.isMainFile ? '📄' : '📎'} ${file.name}
                    </div>
                </td>
                <td class="col-status">${statusBadge}</td>
                <td class="col-frontend">
                    <div class="hash-display ${frontendClass}" title="${frontendTitle}">
                        ${frontendDisplay}
                    </div>
                </td>
                <td class="col-saved">
                    <div class="hash-display ${savedClass}" title="${savedTitle}">
                        ${savedDisplay}
                    </div>
                </td>
                <td class="col-action">
                    <div class="dropdown-exec">
                        <select class="conflict-action-select" data-file-path="${file.path}" data-is-main="${file.isMainFile}" onchange="onConflictActionChange(this)">
                            <option value="">--</option>
                            ${actionOptions}
                        </select>
                        <button onclick="executeAction(this)" class="action-btn exec-btn" title="Execute action now">&#9654;</button>
                    </div>
                </td>
                <td class="col-paths action-cell">
                    <div class="dropdown-exec">
                        <select class="paths-select" data-file-path="${escapedPath}" data-is-main="${file.isMainFile}">
                            <option value="relative">Relative</option>
                            <option value="absolute">Absolute</option>
                        </select>
                        <button onclick="executePathConvert(this)" class="action-btn exec-btn" title="Convert paths">&#9654;</button>
                    </div>
                </td>
                <td class="col-image action-cell">
                    <button onclick="reloadImages()" class="action-btn reload-images-btn" title="Reload all images in the board">&#x1F5BC;&#xFE0F;</button>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <table class="files-table">
            <thead>
                <tr>
                    <th class="col-file">File</th>
                    <th class="col-status">Status</th>
                    <th class="col-frontend" title="Frontend vs registry (non-canonical)">Cache</th>
                    <th class="col-saved" title="Saved file on disk">Saved</th>
                    <th class="col-action">Action</th>
                    <th class="col-paths">Paths</th>
                    <th class="col-image">Img</th>
                </tr>
            </thead>
            <tbody>
                ${allFilesRow}
                ${fileRows}
            </tbody>
        </table>

        <div class="icon-legend">
            <div class="legend-section">
                <div class="legend-title">Sync Status Icons:</div>
                <div class="legend-items">
                    <div class="legend-item">
                        <span class="legend-icon">✅</span>
                        <span class="legend-text">Matches Registry</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-icon">⚠️</span>
                        <span class="legend-text">Differs from Registry</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-icon">---</span>
                        <span class="legend-text">Not Verified</span>
                    </div>
                </div>
            </div>
            <div class="legend-section">
                <div class="legend-title">Include Types:</div>
                <div class="legend-items">
                    <div class="legend-item">
                        <span class="include-type-label regular legend-badge">[INCLUDE]</span>
                        <span class="legend-text">!!!include() - read-only</span>
                    </div>
                    <div class="legend-item">
                        <span class="include-type-label column legend-badge">[COLINC]</span>
                        <span class="legend-text">!!!include() in column header - bidirectional</span>
                    </div>
                    <div class="legend-item">
                        <span class="include-type-label task legend-badge">[TASKINC]</span>
                        <span class="legend-text">!!!include() in task title - bidirectional</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ============= HELPER FUNCTIONS =============

function getIncludeTypeShortLabel(fileType) {
    switch (fileType) {
        case 'include-regular':
        case 'regular':
            return 'include';
        case 'include-column':
        case 'column':
            return 'colinc';
        case 'include-task':
        case 'task':
            return 'taskinc';
        default:
            return 'include';
    }
}

function getFileSyncStatus(filePath) {
    if (!lastVerificationResults || !lastVerificationResults.fileResults) {
        return null;
    }

    const normalizedInputPath = filePath.replace(/^\.\//, '');
    const inputBasename = filePath.split('/').pop();

    return lastVerificationResults.fileResults.find(f => {
        const resultPath = f.path.replace(/^\.\//, '');
        const resultBasename = f.path.split('/').pop();
        return resultPath === normalizedInputPath ||
               resultBasename === inputBasename ||
               normalizedInputPath.endsWith(resultPath);
    });
}

function getFileSyncSummaryCounts() {
    if (!lastVerificationResults || !lastVerificationResults.fileResults) {
        return {
            cache: { match: 0, diff: 0, unknown: 0, verified: false },
            file: { match: 0, diff: 0, unknown: 0, verified: false }
        };
    }

    const cache = { match: 0, diff: 0, unknown: 0, verified: true };
    const file = { match: 0, diff: 0, unknown: 0, verified: true };

    lastVerificationResults.fileResults.forEach(result => {
        if (result.frontendRegistryMatch === null || result.frontendRegistryMatch === undefined) {
            cache.unknown++;
        } else if (result.frontendRegistryMatch) {
            cache.match++;
        } else {
            cache.diff++;
        }

        if (result.savedHash === null || result.savedHash === undefined) {
            file.unknown++;
        } else if (result.canonicalSavedMatch) {
            file.match++;
        } else {
            file.diff++;
        }
    });

    return { cache, file };
}

function renderSyncSummaryCompact(summary) {
    if (!summary.verified) {
        return `<span class="sync-summary-compact sync-unknown">---</span>`;
    }
    return `
        <span class="sync-summary-compact">
            <span class="sync-summary-item sync-good">${summary.match}</span>
            <span class="sync-summary-item sync-warn">${summary.diff}</span>
            <span class="sync-summary-item sync-unknown">${summary.unknown}</span>
        </span>
    `;
}

function truncatePath(path, maxLength = 10) {
    if (!path || path.length <= maxLength) return path;
    return path.substring(0, maxLength) + '...';
}

function openFile(filePath) {
    if (window.vscode) {
        window.vscode.postMessage({ type: 'openFile', filePath: filePath });
    }
}

function requestOpenFileDialog(mode) {
    if (typeof window.vscode === 'undefined') {
        showFileManagerNotice('File manager error: vscode API not available', 'error');
        return;
    }
    if (mode === 'browse') {
        showFileManager();
    } else {
        window.vscode.postMessage({ type: 'openFileDialog', openMode: mode });
    }
}

// ============= DIALOG CONTENT UPDATE =============

/**
 * Update dialog content.
 * If the set of files changed (rows added/removed), rebuilds the table while preserving
 * dropdown selections. Otherwise, does targeted DOM patches for Status/Cache/Saved only.
 */
function updateDialogContent() {
    if (!fileManagerElement) return;

    requestAnimationFrame(() => {
        // Update timestamp
        const timestampElement = fileManagerElement.querySelector('.file-manager-timestamp');
        if (timestampElement) {
            timestampElement.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
        }

        const tableContainer = fileManagerElement.querySelector('.unified-table-container');
        if (!tableContainer) return;

        // Check if the file list changed (new files appeared or files were removed)
        const files = buildUnifiedFileList();
        const renderedRows = tableContainer.querySelectorAll('tr.file-row');
        const renderedPaths = new Set(Array.from(renderedRows).map(r => r.dataset.filePath));
        const currentPaths = new Set(files.map(f => f.path));
        const fileListChanged = renderedPaths.size !== currentPaths.size ||
            [...currentPaths].some(p => !renderedPaths.has(p));

        if (fileListChanged) {
            // Assign default actions for newly appearing files
            files.forEach(f => {
                if (!perFileResolutions.has(f.path)) {
                    const defaultAction = getDefaultAction(f);
                    if (defaultAction) {
                        perFileResolutions.set(f.path, defaultAction);
                    }
                }
            });

            // Blur any focused element before rebuild to prevent trackFocus classList error
            const focused = tableContainer.querySelector(':focus');
            if (focused) focused.blur();

            // File list changed — full table rebuild, but preserve dropdown state
            const savedState = saveDropdownState(tableContainer);
            tableContainer.innerHTML = createUnifiedTable();
            restoreDropdownState(tableContainer, savedState);
            return;
        }

        // --- File list unchanged: targeted patches only ---

        // Patch "All Files" summary row
        const summary = getFileSyncSummaryCounts();
        const summaryRow = tableContainer.querySelector('tr.files-table-actions');
        if (summaryRow) {
            const cacheSummaryCell = summaryRow.querySelector('.col-frontend.sync-summary-cell');
            if (cacheSummaryCell) {
                const newCacheHTML = renderSyncSummaryCompact(summary.cache);
                if (cacheSummaryCell.innerHTML !== newCacheHTML) {
                    cacheSummaryCell.innerHTML = newCacheHTML;
                }
            }
            const savedSummaryCell = summaryRow.querySelector('.col-saved.sync-summary-cell');
            if (savedSummaryCell) {
                const newSavedHTML = renderSyncSummaryCompact(summary.file);
                if (savedSummaryCell.innerHTML !== newSavedHTML) {
                    savedSummaryCell.innerHTML = newSavedHTML;
                }
            }
        }

        // Patch per-file rows
        files.forEach(file => {
            const row = tableContainer.querySelector(`tr.file-row[data-file-path="${CSS.escape(file.path)}"]`);
            if (!row) return;

            const statusCell = row.querySelector('.col-status');
            if (statusCell) {
                const newStatusHTML = buildStatusBadgeHTML(file);
                if (statusCell.innerHTML !== newStatusHTML) {
                    statusCell.innerHTML = newStatusHTML;
                }
            }

            const cacheCell = row.querySelector('.col-frontend');
            if (cacheCell) {
                const syncStatus = getFileSyncStatus(file.path);
                const newCacheHTML = buildCacheCellHTML(syncStatus);
                if (cacheCell.innerHTML !== newCacheHTML) {
                    cacheCell.innerHTML = newCacheHTML;
                }
            }

            const savedCell = row.querySelector('.col-saved');
            if (savedCell) {
                const syncStatus = getFileSyncStatus(file.path);
                const newSavedHTML = buildSavedCellHTML(syncStatus);
                if (savedCell.innerHTML !== newSavedHTML) {
                    savedCell.innerHTML = newSavedHTML;
                }
            }
        });
    });
}

/** Save all dropdown selections in the table so they survive a rebuild. */
function saveDropdownState(tableContainer) {
    const state = { actions: new Map(), paths: new Map() };
    tableContainer.querySelectorAll('.conflict-action-select').forEach(sel => {
        if (sel.value) state.actions.set(sel.dataset.filePath, sel.value);
    });
    tableContainer.querySelectorAll('.paths-select').forEach(sel => {
        if (sel.value) state.paths.set(sel.dataset.filePath, sel.value);
    });
    return state;
}

/** Restore dropdown selections after a table rebuild. */
function restoreDropdownState(tableContainer, state) {
    state.actions.forEach((value, filePath) => {
        const sel = tableContainer.querySelector(`.conflict-action-select[data-file-path="${CSS.escape(filePath)}"]`);
        if (sel && Array.from(sel.options).some(o => o.value === value)) {
            sel.value = value;
        }
    });
    state.paths.forEach((value, filePath) => {
        const sel = tableContainer.querySelector(`.paths-select[data-file-path="${CSS.escape(filePath)}"]`);
        if (sel && Array.from(sel.options).some(o => o.value === value)) {
            sel.value = value;
        }
    });
}

/** Build status badge HTML for a file (extracted from createUnifiedTable). */
function buildStatusBadgeHTML(file) {
    const hasExternal = file.hasExternalChanges;
    const hasUnsaved = file.hasUnsavedChanges || file.hasInternalChanges;
    let badge = '';
    if (hasExternal && hasUnsaved) {
        badge = '<span class="conflict-badge conflict-both" title="Both external and unsaved changes">External + Unsaved</span>';
    } else if (hasExternal) {
        badge = '<span class="conflict-badge conflict-external" title="External changes detected">External</span>';
    } else if (hasUnsaved) {
        badge = '<span class="conflict-badge conflict-unsaved" title="Unsaved changes">Unsaved</span>';
    } else {
        badge = '<span class="conflict-badge conflict-none">Clean</span>';
    }
    if (file.isInEditMode) {
        badge += ' <span class="conflict-badge" title="Currently being edited">Editing</span>';
    }
    return badge;
}

/** Build Cache cell inner HTML from sync status. */
function buildCacheCellHTML(syncStatus) {
    let display = '---';
    let cssClass = 'sync-unknown';
    let title = '';

    if (syncStatus) {
        const registryNormalized = syncStatus.registryNormalizedHash
            && syncStatus.registryNormalizedLength !== null
            && syncStatus.registryNormalizedLength !== undefined;
        const registryHash = registryNormalized ? syncStatus.registryNormalizedHash : (syncStatus.canonicalHash || 'N/A');
        const registryChars = registryNormalized ? syncStatus.registryNormalizedLength : (syncStatus.canonicalContentLength || 0);

        if (syncStatus.frontendHash && syncStatus.frontendContentLength !== null && syncStatus.frontendContentLength !== undefined) {
            if (syncStatus.frontendMatchesRaw === true) {
                display = '\u2705'; cssClass = 'sync-good';
            } else if (syncStatus.frontendMatchesNormalized === true) {
                display = '\u26A0\uFE0F'; cssClass = 'sync-warn';
            } else if (syncStatus.frontendRegistryMatch === false) {
                display = '\u26A0\uFE0F'; cssClass = 'sync-warn';
            }
            title = `Frontend: ${syncStatus.frontendHash} (${syncStatus.frontendContentLength} chars)\nRegistry: ${registryHash} (${registryChars} chars)`;
        } else if (syncStatus.frontendAvailable === false) {
            display = '\u2753';
            title = 'Frontend hash not available';
        }
    }

    return `<div class="hash-display ${cssClass}" title="${title}">${display}</div>`;
}

/** Build Saved cell inner HTML from sync status. */
function buildSavedCellHTML(syncStatus) {
    let display = '---';
    let cssClass = 'sync-unknown';
    let title = '';

    if (syncStatus) {
        const registryNormalized = syncStatus.registryNormalizedHash
            && syncStatus.registryNormalizedLength !== null
            && syncStatus.registryNormalizedLength !== undefined;
        const registryHash = registryNormalized ? syncStatus.registryNormalizedHash : (syncStatus.canonicalHash || 'N/A');
        const registryChars = registryNormalized ? syncStatus.registryNormalizedLength : (syncStatus.canonicalContentLength || 0);

        if (syncStatus.savedHash) {
            const savedHashValue = syncStatus.savedNormalizedHash || syncStatus.savedHash;
            const savedCharsValue = syncStatus.savedNormalizedLength ?? (syncStatus.savedContentLength || 0);

            if (syncStatus.canonicalSavedMatch) {
                display = '\u2705'; cssClass = 'sync-good';
            } else {
                display = '\u26A0\uFE0F'; cssClass = 'sync-warn';
            }

            title = `Registry: ${registryHash} (${registryChars} chars)\nSaved: ${savedHashValue} (${savedCharsValue} chars)`;
        } else {
            display = '\u2753';
            title = 'Saved file not available';
        }
    }

    return `<div class="hash-display ${cssClass}" title="${title}">${display}</div>`;
}

// ============= REFRESH / AUTO-REFRESH =============

function refreshFileManager() {
    if (!fileManagerVisible || !fileManagerElement) return;
    refreshCount++;
    if (window.vscode) {
        window.vscode.postMessage({ type: 'getTrackedFilesDebugInfo' });
    }
}

function startAutoRefresh() {
    stopAutoRefresh();
    if (!fileManagerVisible) return;
    autoRefreshTimer = setInterval(() => {
        if (fileManagerVisible && dialogMode === 'browse') {
            refreshFileManager();
        } else {
            stopAutoRefresh();
        }
    }, 5000);
}

function stopAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}

// ============= TRACKED FILES DATA =============

function createDataHash(data) {
    try {
        return JSON.stringify(data).replace(/\s/g, '');
    } catch (error) {
        return Math.random().toString();
    }
}

function updateTrackedFilesData(data) {
    const newDataHash = createDataHash(data);
    if (newDataHash === lastTrackedFilesDataHash) return;
    lastTrackedFilesDataHash = newDataHash;
    trackedFilesData = data;

    if (fileManagerVisible && fileManagerElement) {
        updateDialogContent();
    }
}

// ============= VERIFICATION FUNCTIONS =============

function verifyContentSync(silent = false) {
    if (!window.vscode) {
        if (!silent) showFileManagerNotice('Error: vscode API not available', 'error');
        return;
    }
    const frontendSnapshot = window.cachedBoard || window.currentBoard;
    window.vscode.postMessage({
        type: 'verifyContentSync',
        frontendBoard: frontendSnapshot
    });
    if (!silent) {
        showFileManagerNotice('Verifying content synchronization.', 'info', 500);
    }
}

function requestFileManagerSyncRefresh() {
    if (!fileManagerVisible || !window.vscode) return;
    if (syncVerifyTimer) clearTimeout(syncVerifyTimer);
    syncVerifyTimer = setTimeout(() => {
        syncVerifyTimer = null;
        verifyContentSync(true);
    }, SYNC_VERIFY_DEBOUNCE_MS);
}

function showVerificationResults(results) {
    lastVerificationResults = results;
    const resultClass = results.mismatchedFiles > 0 ? 'verification-warning' : 'verification-success';
    const resultsHtml = `
        <div class="verification-results-overlay" id="verification-results">
            <div class="verification-dialog ${resultClass}">
                <div class="verification-header">
                    <h3>Content Synchronization Verification</h3>
                    <button onclick="closeVerificationResults()" class="verification-close-btn">✕</button>
                </div>
                <div class="verification-content">
                    <div class="verification-summary">
                        <div class="summary-stat">
                            <span class="stat-label">Total Files:</span>
                            <span class="stat-value">${results.totalFiles}</span>
                        </div>
                        <div class="summary-stat status-good">
                            <span class="stat-label">Matching:</span>
                            <span class="stat-value">${results.matchingFiles}</span>
                        </div>
                        <div class="summary-stat ${results.mismatchedFiles > 0 ? 'status-warn' : ''}">
                            <span class="stat-label">Mismatched:</span>
                            <span class="stat-value">${results.mismatchedFiles}</span>
                        </div>
                    </div>
                    <div class="verification-details">
                        ${results.frontendSnapshot ? `
                        <div class="verification-summary" style="margin-bottom: 12px;">
                            <div class="summary-stat ${results.frontendSnapshot.matchesRegistry ? 'status-good' : 'status-warn'}">
                                <span class="stat-label">Frontend Snapshot vs Registry:</span>
                                <span class="stat-value">
                                    ${results.frontendSnapshot.hash} (${results.frontendSnapshot.contentLength} chars)
                                    ${results.frontendSnapshot.matchesRegistry ? 'synced' : `differs by ${results.frontendSnapshot.diffChars} chars`}
                                </span>
                            </div>
                        </div>
                        ` : ''}
                        <strong>File Details:</strong>
                        <div class="file-results-list">
                            ${results.fileResults.map(file => `
                                <div class="file-result-item ${file.matches ? 'match' : 'mismatch'}">
                                    <div class="file-result-name">${file.relativePath}</div>
                                    <div class="file-result-status">
                                        ${file.matches ? 'All Match' : 'Differences detected'}
                                    </div>
                                    <div class="file-result-hashes">
                                        <div>Registry: ${file.canonicalHash} (${file.canonicalContentLength} chars)</div>
                                        ${file.savedHash ? `<div>Saved: ${file.savedHash} (${file.savedContentLength} chars)
                                            ${file.canonicalSavedMatch ? 'synced' : 'differs by ' + file.canonicalSavedDiff}</div>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="verification-timestamp">
                        Verified: ${new Date(results.timestamp).toLocaleString()}
                    </div>
                </div>
                <div class="verification-actions">
                    ${results.mismatchedFiles > 0 ?
                        '<button onclick="forceWriteAllContent()" class="btn-force-write">Force Write All</button>' : ''}
                    <button onclick="closeVerificationResults()" class="btn-close">Close</button>
                </div>
            </div>
        </div>
    `;
    const resultsElement = document.createElement('div');
    resultsElement.innerHTML = resultsHtml;
    document.body.appendChild(resultsElement.firstElementChild);
}

function closeVerificationResults() {
    const resultsDialog = document.getElementById('verification-results');
    if (resultsDialog) resultsDialog.remove();
}

// ============= FORCE WRITE =============

function forceWriteAllContent() {
    if (pendingForceWrite) return;
    if (!window.vscode) {
        showFileManagerNotice('Error: vscode API not available', 'error');
        return;
    }
    showForceWriteConfirmation();
}

function showForceWriteConfirmation() {
    const allFiles = createAllFilesArray();
    const filesWithExternalChanges = allFiles.filter(f => f.hasExternalChanges);
    const fileCount = filesWithExternalChanges.length;

    if (fileCount === 0) {
        showFileManagerNotice('No files with external changes detected.', 'info');
        return;
    }

    const confirmHtml = `
        <div class="force-write-confirmation-overlay" id="force-write-confirmation">
            <div class="confirmation-dialog">
                <div class="confirmation-header">
                    <h3>Force Write Files</h3>
                </div>
                <div class="confirmation-content">
                    <p><strong>WARNING:</strong> This will unconditionally write ${fileCount} file${fileCount > 1 ? 's' : ''} with external changes to disk, bypassing change detection.</p>
                    <p>Use this ONLY when:</p>
                    <ul>
                        <li>Normal save is not working</li>
                        <li>You suspect registry/saved content are out of sync</li>
                        <li>You need emergency recovery</li>
                    </ul>
                    <p><strong>A backup will be created before writing.</strong></p>
                    <div class="affected-files">
                        <strong>Files to be written (${fileCount}):</strong>
                        <ul>
                            ${filesWithExternalChanges.map(f => `<li>${f.relativePath}</li>`).slice(0, 10).join('')}
                            ${fileCount > 10 ? `<li><em>... and ${fileCount - 10} more files</em></li>` : ''}
                        </ul>
                    </div>
                </div>
                <div class="confirmation-actions">
                    <button onclick="cancelForceWrite()" class="btn-cancel">Cancel</button>
                    <button onclick="confirmForceWrite()" class="btn-confirm">Force Write ${fileCount} File${fileCount > 1 ? 's' : ''}</button>
                </div>
            </div>
        </div>
    `;
    const confirmElement = document.createElement('div');
    confirmElement.innerHTML = confirmHtml;
    document.body.appendChild(confirmElement.firstElementChild);
}

function cancelForceWrite() {
    const confirmDialog = document.getElementById('force-write-confirmation');
    if (confirmDialog) confirmDialog.remove();
}

function confirmForceWrite() {
    cancelForceWrite();
    pendingForceWrite = true;
    window.vscode.postMessage({ type: 'forceWriteAllContent' });
    showFileManagerNotice('Force write in progress... Please wait.', 'info', 5000);
}

// ============= FILE OPERATIONS =============

function saveIndividualFile(filePath, isMainFile, forceSave = true) {
    if (window.vscode) {
        window.vscode.postMessage({
            type: 'saveIndividualFile',
            filePath: filePath,
            isMainFile: isMainFile,
            forceSave: forceSave
        });
    }
}

function reloadIndividualFile(filePath, isMainFile) {
    if (window.vscode) {
        window.vscode.postMessage({
            type: 'reloadIndividualFile',
            filePath: filePath,
            isMainFile: isMainFile
        });
    }
}

function convertFilePaths(filePath, isMainFile, direction) {
    if (window.vscode) {
        window.vscode.postMessage({
            type: 'convertPaths',
            filePath: filePath,
            isMainFile: isMainFile,
            direction: direction
        });
    }
}

function convertAllPaths(direction) {
    if (window.vscode) {
        window.vscode.postMessage({ type: 'convertAllPaths', direction: direction });
    }
}

// --- Dropdown+execute dispatchers ---

function executeAction(buttonElement) {
    const select = buttonElement.parentElement.querySelector('.conflict-action-select');
    if (!select || !select.value) return;
    const filePath = select.dataset.filePath;
    const isMainFile = select.dataset.isMain === 'true';
    switch (select.value) {
        case 'overwrite':
        case 'overwrite_backup_external':
            saveIndividualFile(filePath, isMainFile, true);
            break;
        case 'load_external':
        case 'load_external_backup_mine':
            reloadIndividualFile(filePath, isMainFile);
            break;
    }
}

function executeAllActions() {
    const select = document.querySelector('.conflict-action-select[data-file-path="__all__"]');
    if (!select || !select.value) return;
    switch (select.value) {
        case 'overwrite':
        case 'overwrite_backup_external':
            forceWriteAllContent();
            break;
        case 'load_external':
        case 'load_external_backup_mine':
            reloadAllIncludedFiles();
            break;
    }
}

function executePathConvert(buttonElement) {
    const select = buttonElement.parentElement.querySelector('.paths-select');
    if (!select) return;
    const filePath = select.dataset.filePath;
    const isMainFile = select.dataset.isMain === 'true';
    convertFilePaths(filePath, isMainFile, select.value);
}

function executeAllPaths() {
    const select = document.querySelector('.paths-select[data-file-path="__all__"]');
    if (!select) return;
    convertAllPaths(select.value);
}

function reloadImages() {
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        if (img.src) {
            const url = new URL(img.src, window.location.href);
            url.searchParams.set('_reload', Date.now().toString());
            img.src = url.toString();
        }
    });
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        if (video.src) {
            const url = new URL(video.src, window.location.href);
            url.searchParams.set('_reload', Date.now().toString());
            video.load();
        }
    });
}

function clearFileManagerCache() {
    trackedFilesData = {};
    refreshCount = 0;
    if (window.vscode) {
        window.vscode.postMessage({ type: 'clearTrackedFilesCache' });
    }
    refreshFileManager();
}

function reloadAllIncludedFiles() {
    if (window.vscode) {
        window.vscode.postMessage({ type: 'reloadAllIncludedFiles' });
        setTimeout(() => { refreshFileManager(); }, 500);
    }
}

// ============= ENHANCED MANUAL REFRESH =============

function enhancedManualRefresh(showFiles = false) {
    if (showFiles) {
        showFileManager();
        return;
    }
    if (typeof originalManualRefresh === 'function') {
        originalManualRefresh();
    }
}

let originalManualRefresh = null;

// ============= KEYBOARD HANDLER =============

function handleFileManagerKeydown(e) {
    if (e.key === 'Escape' && fileManagerVisible) {
        e.preventDefault();
        e.stopPropagation();
        closeDialog();
    }
}

// ============= INITIALIZATION =============

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeFileManager);
} else {
    initializeFileManager();
}

function initializeFileManager() {
    window.showFileManager = showFileManager;
    window.hideFileManager = hideFileManager;
    window.updateTrackedFilesData = updateTrackedFilesData;
    window.clearFileManagerCache = clearFileManagerCache;
    window.openFile = openFile;
    window.requestFileManagerSyncRefresh = requestFileManagerSyncRefresh;
    window.openUnifiedDialog = openUnifiedDialog;
    window.requestOpenFileDialog = requestOpenFileDialog;
    window.submitConflictResolution = submitConflictResolution;
    window.cancelConflictResolution = cancelConflictResolution;
    window.onConflictActionChange = onConflictActionChange;
    window.onConflictApplyAll = onConflictApplyAll;
    window.closeDialog = closeDialog;
    window.executeAction = executeAction;
    window.executeAllActions = executeAllActions;
    window.executePathConvert = executePathConvert;
    window.executeAllPaths = executeAllPaths;

    document.addEventListener('keydown', handleFileManagerKeydown);

    if (typeof window.manualRefresh === 'function') {
        originalManualRefresh = window.manualRefresh;
        window.manualRefresh = enhancedManualRefresh;
    } else {
        setTimeout(() => {
            if (typeof window.manualRefresh === 'function' && !originalManualRefresh) {
                originalManualRefresh = window.manualRefresh;
                window.manualRefresh = enhancedManualRefresh;
            }
        }, 1000);
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || !message.type) return;

        switch (message.type) {
            case 'showConflictDialog':
                openUnifiedDialog(message);
                break;

            case 'trackedFilesDebugInfo':
                if (message.data) {
                    updateTrackedFilesData(message.data);
                }
                break;

            case 'documentStateChanged':
                if (fileManagerVisible && dialogMode === 'browse') {
                    refreshFileManager();
                }
                break;

            case 'saveCompleted':
                if (fileManagerVisible) {
                    verifyContentSync(true);
                }
                break;

            case 'individualFileSaved':
                if (fileManagerVisible && message.success) {
                    verifyContentSync(true);
                }
                break;

            case 'individualFileReloaded':
                if (fileManagerVisible && message.success) {
                    verifyContentSync(true);
                }
                break;

            case 'forceWriteAllResult':
                pendingForceWrite = false;
                if (message.success) {
                    showFileManagerNotice('Force write completed successfully.', 'info', 6000);
                    refreshFileManager();
                } else {
                    showFileManagerNotice('Force write failed. Check console for details.', 'error', 6000);
                }
                break;

            case 'verifyContentSyncResult':
                lastVerificationResults = message;
                if (fileManagerVisible && fileManagerElement) {
                    updateDialogContent();
                }
                break;

            case 'externalChangesDetected':
                showExternalChangesNotification(message.fileCount, message.fileNames);
                break;
        }
    });
}

// ============= EXTERNAL CHANGES NOTIFICATION =============

function showExternalChangesNotification(fileCount, fileNames) {
    // Remove existing notification if present
    const existing = document.getElementById('external-changes-notification');
    if (existing) existing.remove();

    const nameList = fileNames.slice(0, 3).join(', ');
    const extra = fileCount > 3 ? ` and ${fileCount - 3} more` : '';

    const notification = document.createElement('div');
    notification.id = 'external-changes-notification';
    notification.className = 'external-changes-notification';
    notification.innerHTML = `
        <span class="external-changes-text">External changes detected in ${fileCount} file${fileCount > 1 ? 's' : ''}: <strong>${nameList}${extra}</strong></span>
        <button class="external-changes-review-btn" onclick="requestOpenFileDialog('external_change')">Review</button>
        <button class="external-changes-dismiss-btn" onclick="dismissExternalChangesNotification()">✕</button>
    `;
    document.body.appendChild(notification);
}

function dismissExternalChangesNotification() {
    const el = document.getElementById('external-changes-notification');
    if (el) el.remove();
}

window.dismissExternalChangesNotification = dismissExternalChangesNotification;
