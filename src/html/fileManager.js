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
let trackedFilesSnapshotToken = null;
let conflictSnapshotToken = null;
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
let perFileResolutions = new Map(); // normalizedPath -> { path, action }
let inFlightFiles = new Set();      // paths currently executing save/reload in backend
let inFlightTimeouts = new Map();   // normalizedPath -> timeout handle for action acknowledgement watchdog
let staleActionFiles = new Set();   // paths with timed-out actions; require fresh state sync before new actions

const FILE_ACTION_RESPONSE_TIMEOUT_MS = 45_000;

let autoRefreshTimer = null;

// Diff panel state
let diffActiveFile = null;  // path of file currently showing diff, or null
let diffData = null;        // { kanbanContent, diskContent, baselineContent } or null

// Verification state
let pendingForceWrite = false;
let lastVerificationResults = null;
let lastMismatchCount = null;
let lastDuplicationIssueCount = null;

function normalizeResolutionPath(pathValue) {
    if (!pathValue || typeof pathValue !== 'string') {
        return '';
    }
    return pathValue.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
}

function resolutionKey(pathValue) {
    return normalizeResolutionPath(pathValue);
}

function setResolution(pathValue, action) {
    if (!pathValue) return;
    const key = resolutionKey(pathValue);
    if (!key) return;
    const existing = perFileResolutions.get(key);
    perFileResolutions.set(key, {
        path: existing?.path || pathValue,
        action
    });
}

function getResolutionAction(pathValue) {
    const key = resolutionKey(pathValue);
    return perFileResolutions.get(key)?.action || '';
}

function markInFlight(pathValue) {
    const key = resolutionKey(pathValue);
    if (key) {
        inFlightFiles.add(key);
        staleActionFiles.delete(key);
        const existingTimeout = inFlightTimeouts.get(key);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }
        const timeoutHandle = setTimeout(() => {
            if (!inFlightFiles.has(key)) {
                inFlightTimeouts.delete(key);
                return;
            }
            inFlightFiles.delete(key);
            inFlightTimeouts.delete(key);
            staleActionFiles.add(key);
            trackedFilesSnapshotToken = null;
            const displayPath = pathValue || key;
            showFileManagerNotice(
                `File action timed out for "${displayPath}". Refresh states before retrying.`,
                'error',
                7000
            );
            refreshFileManager();
            updateDialogContent(true);
        }, FILE_ACTION_RESPONSE_TIMEOUT_MS);
        inFlightTimeouts.set(key, timeoutHandle);
    }
}

function clearInFlight(pathValue) {
    const key = resolutionKey(pathValue);
    if (key) {
        const timeoutHandle = inFlightTimeouts.get(key);
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            inFlightTimeouts.delete(key);
        }
        inFlightFiles.delete(key);
        staleActionFiles.delete(key);
    }
}

function isInFlight(pathValue) {
    const key = resolutionKey(pathValue);
    return key ? inFlightFiles.has(key) : false;
}

function isStaleAction(pathValue) {
    const key = resolutionKey(pathValue);
    return key ? staleActionFiles.has(key) : false;
}

function clearAllInFlightState() {
    for (const timeoutHandle of inFlightTimeouts.values()) {
        clearTimeout(timeoutHandle);
    }
    inFlightTimeouts.clear();
    inFlightFiles.clear();
    staleActionFiles.clear();
}

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

const READ_ONLY_INCLUDE_TYPES = new Set();
const INACCESSIBLE_ACCESS_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);

function resolveUnsavedFlags(file) {
    const hasInternalChanges = !!(file.hasInternalChanges ?? false);
    const hasEditorUnsaved = !!file.isUnsavedInEditor;
    const hasAnyUnsaved = !!(
        file.hasAnyUnsavedChanges
        ?? file.hasUnsavedChanges
        ?? (hasInternalChanges || hasEditorUnsaved)
    );
    const hasUnsavedChanges = hasAnyUnsaved;

    return {
        hasInternalChanges,
        hasUnsavedChanges,
        hasEditorUnsaved,
        hasAnyUnsaved
    };
}

function getFileStateFlags(file) {
    const fileType = file.fileType || file.type || '';
    const isReadOnlyInclude = READ_ONLY_INCLUDE_TYPES.has(fileType);
    const accessErrorCode = file.lastAccessErrorCode || null;
    const isMissing = file.exists === false || accessErrorCode === 'ENOENT';
    const isInaccessible = INACCESSIBLE_ACCESS_CODES.has(accessErrorCode);
    const hasExternal = !!file.hasExternalChanges;
    const unsaved = resolveUnsavedFlags(file);

    return {
        fileType,
        isReadOnlyInclude,
        accessErrorCode,
        isMissing,
        isInaccessible,
        hasExternal,
        ...unsaved
    };
}

function getActionsForFile(file) {
    const state = getFileStateFlags(file);

    if (state.isMissing || state.isInaccessible) {
        return ALL_ACTIONS.filter(a => a.value === 'skip');
    }

    if (state.isReadOnlyInclude) {
        if (state.hasEditorUnsaved || state.hasInternalChanges) {
            return ALL_ACTIONS.filter(a =>
                a.value === 'load_external_backup_mine' || a.value === 'skip'
            );
        }
        if (state.hasExternal) {
            return ALL_ACTIONS.filter(a =>
                a.value === 'load_external' || a.value === 'load_external_backup_mine' || a.value === 'skip'
            );
        }
        return ALL_ACTIONS.filter(a => a.value === 'skip');
    }

    if (state.hasExternal && state.hasEditorUnsaved) {
        return ALL_ACTIONS.filter(a =>
            a.value === 'load_external_backup_mine' || a.value === 'skip'
        );
    }

    if (state.hasEditorUnsaved) {
        return ALL_ACTIONS.filter(a =>
            a.value === 'load_external_backup_mine' || a.value === 'skip'
        );
    }

    if (state.hasExternal && state.hasInternalChanges) {
        return ALL_ACTIONS.filter(a =>
            a.value === 'overwrite'
            || a.value === 'overwrite_backup_external'
            || a.value === 'load_external_backup_mine'
            || a.value === 'skip'
        );
    }

    if (state.hasExternal) {
        return ALL_ACTIONS;
    }
    if (state.hasInternalChanges) {
        return ALL_ACTIONS.filter(a =>
            a.value === 'overwrite' || a.value === 'overwrite_backup_external' || a.value === 'skip'
        );
    }
    return ALL_ACTIONS.filter(a =>
        a.value === 'overwrite' || a.value === 'load_external' || a.value === 'skip'
    );
}

function getDefaultAction(file) {
    const state = getFileStateFlags(file);

    if (state.isMissing || state.isInaccessible) {
        return 'skip';
    }

    if (state.isReadOnlyInclude) {
        if (state.hasAnyUnsaved) {
            return 'load_external_backup_mine';
        }
        return state.hasExternal ? 'load_external' : 'skip';
    }

    switch (openMode) {
        case 'save_conflict':
            if (state.hasExternal && state.hasEditorUnsaved) {
                return 'load_external_backup_mine';
            }
            return state.hasExternal ? 'overwrite_backup_external' : 'skip';
        case 'reload_request':
            if (state.hasAnyUnsaved) {
                return 'load_external_backup_mine';
            }
            return 'load_external';
        case 'external_change':
            if (state.hasExternal && state.hasEditorUnsaved) {
                return 'load_external_backup_mine';
            }
            if (state.hasExternal && state.hasAnyUnsaved) {
                return 'overwrite_backup_external';
            }
            return state.hasExternal ? 'load_external' : 'skip';
        default:
            // Browse mode — pick a safe default based on file state
            if (state.hasEditorUnsaved) {
                return 'load_external_backup_mine';
            }
            if (state.hasExternal && state.hasInternalChanges) {
                return 'overwrite_backup_external';
            }
            if (state.hasExternal) {
                return 'load_external';
            }
            if (state.hasInternalChanges) {
                return 'overwrite';
            }
            return 'skip';
    }
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
    conflictSnapshotToken = message.snapshotToken || null;
    conflictFiles = message.files || [];
    openMode = message.openMode || 'external_change';
    dialogMode = 'resolve';
    perFileResolutions = new Map();
    clearAllInFlightState();

    // Set default actions per file using canonical path keys
    conflictFiles.forEach(f => {
        const defaultAction = getDefaultAction(f);
        if (defaultAction) {
            setResolution(f.path, defaultAction);
        }
    });

    // Request tracked files data so sync columns are populated
    if (window.vscode) {
        window.vscode.postMessage({ type: 'getTrackedFilesDebugInfo' });
    }

    if (!conflictSnapshotToken) {
        showFileManagerNotice('Conflict snapshot missing. Refresh and re-open the dialog if actions are blocked.', 'warn', 5000);
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
    conflictSnapshotToken = null;
    conflictFiles = [];
    perFileResolutions.clear();
    clearAllInFlightState();

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
    conflictSnapshotToken = null;
    conflictFiles = [];
    trackedFilesSnapshotToken = null;
    perFileResolutions.clear();
    clearAllInFlightState();

    // Close any open VS Code diff views
    closeAllDiffs();

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

function cancelConflictResolution() {
    if (conflictId && window.vscode) {
        window.vscode.postMessage({
            type: 'conflictResolution',
            conflictId: conflictId,
            cancelled: true,
            snapshotToken: conflictSnapshotToken || undefined,
            perFileResolutions: []
        });
    }
    hideFileManager();
}

function clearResolutionForFile(filePath) {
    if (!filePath) return;
    perFileResolutions.delete(resolutionKey(filePath));
}

function buildConflictResolutions() {
    const files = conflictFiles && conflictFiles.length > 0
        ? conflictFiles
        : buildUnifiedFileList();

    return files.map(file => {
        const resolutionPath = file.path || file.relativePath || '';
        const selectedAction = getResolutionAction(file.path) || getResolutionAction(file.relativePath || file.path);
        const normalizedAction = ALL_ACTIONS.some(actionOption => actionOption.value === selectedAction)
            ? selectedAction
            : 'skip';
        return {
            path: resolutionPath,
            action: normalizedAction
        };
    });
}

function onConflictActionChange(selectElement) {
    const filePath = selectElement.dataset.filePath;
    const action = selectElement.value;
    if (filePath === '__all__') return;
    if (!action) {
        clearResolutionForFile(filePath);
        return;
    }
    setResolution(filePath, action);
}

function onConflictApplyAll(selectElement) {
    const action = selectElement.value;
    if (!action) return;

    // Update all per-file selects in the DOM
    const selects = fileManagerElement?.querySelectorAll('.conflict-action-select');
    if (selects) {
        selects.forEach(sel => {
            const filePath = sel.dataset.filePath;
            if (filePath === '__all__') return;
            if (isStaleAction(filePath)) return;
            const optionExists = Array.from(sel.options).some(opt => opt.value === action);
            if (optionExists) {
                sel.value = action;
                setResolution(filePath, action);
            }
        });
    }
}

function getSnapshotStatus() {
    const actionSnapshotReady = !!trackedFilesSnapshotToken;
    const resolveMode = dialogMode === 'resolve';

    if (resolveMode && !conflictSnapshotToken) {
        return {
            label: 'Snapshot: missing',
            cssClass: 'snapshot-stale',
            title: 'Conflict snapshot is missing. Close and re-open this dialog before applying actions.'
        };
    }

    if (!actionSnapshotReady) {
        return {
            label: resolveMode ? 'Snapshot: locked, refreshing' : 'Snapshot: refreshing',
            cssClass: 'snapshot-stale',
            title: resolveMode
                ? 'Conflict snapshot is locked, but action snapshot is stale. Wait for refresh before applying actions.'
                : 'Action snapshot is stale. Refresh File Manager before running save/reload actions.'
        };
    }

    return {
        label: resolveMode ? 'Snapshot: locked, ready' : 'Snapshot: ready',
        cssClass: 'snapshot-ready',
        title: resolveMode
            ? 'Conflict snapshot is locked for this dialog. Use per-file ▶ or Apply All to execute actions.'
            : 'Action snapshot is ready.'
    };
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
    const snapshotStatus = getSnapshotStatus();

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
                    <button onclick="removeDeletedItemsFromFiles()" class="file-manager-btn file-manager-btn-danger" title="Permanently remove all deleted items from files">
                        Remove Deleted
                    </button>
                    <span class="file-manager-snapshot-status ${snapshotStatus.cssClass}" title="${snapshotStatus.title}">
                        ${snapshotStatus.label}
                    </span>
                    <span class="file-manager-timestamp">Updated: ${now}</span>
                </div>
                <div class="file-manager-controls">
                    <button onclick="${isResolve ? 'cancelConflictResolution()' : 'closeDialog()'}" class="file-manager-close" title="${isResolve ? 'Close without applying actions' : 'Close'}">✕</button>
                </div>
            </div>
            <div class="file-manager-content">
                <div class="unified-table-container">
                    ${createUnifiedTable()}
                </div>
            </div>
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

    // Match files by normalized full/relative paths (never by basename only)
    const conflictMap = new Map();
    const registerConflict = (candidatePath, conflictFile) => {
        const key = normalizeResolutionPath(candidatePath);
        if (!key || conflictMap.has(key)) {
            return;
        }
        conflictMap.set(key, conflictFile);
    };
    conflictFiles.forEach(conflictFile => {
        registerConflict(conflictFile.path, conflictFile);
        registerConflict(conflictFile.relativePath, conflictFile);
    });

    const browsePathKeys = new Set();
    browseFiles.forEach(file => {
        browsePathKeys.add(normalizeResolutionPath(file.path));
        browsePathKeys.add(normalizeResolutionPath(file.relativePath || file.path));
    });

    // Start from browse files (has all tracked files with sync data)
    const unified = browseFiles.map(file => {
        const conflict = conflictMap.get(normalizeResolutionPath(file.path))
            || conflictMap.get(normalizeResolutionPath(file.relativePath || file.path));
        const mergedPath = conflict?.path || file.path;
        const mergedRelativePath = conflict?.relativePath || file.relativePath || file.path;
        const mergedName = window.getBasename
            ? window.getBasename(mergedRelativePath || mergedPath)
            : (mergedRelativePath || mergedPath);
        const mergedEditorUnsaved = conflict
            ? !!(conflict.isUnsavedInEditor ?? file.isUnsavedInEditor)
            : !!file.isUnsavedInEditor;
        const mergedInternalChanges = conflict
            ? !!(conflict.hasInternalChanges ?? (conflict.hasUnsavedChanges && !mergedEditorUnsaved))
            : !!(file.hasInternalChanges ?? false);
        const mergedAnyUnsaved = conflict
            ? !!(conflict.hasUnsavedChanges ?? (mergedInternalChanges || mergedEditorUnsaved))
            : !!(file.hasAnyUnsavedChanges ?? file.hasUnsavedChanges ?? (mergedInternalChanges || mergedEditorUnsaved));
        const unsavedFlags = resolveUnsavedFlags({
            hasAnyUnsavedChanges: mergedAnyUnsaved,
            hasUnsavedChanges: mergedAnyUnsaved,
            hasInternalChanges: mergedInternalChanges,
            isUnsavedInEditor: mergedEditorUnsaved
        });
        return {
            ...file,
            path: mergedPath,
            relativePath: mergedRelativePath,
            name: mergedName,
            // Overlay conflict-specific fields when available
            hasExternalChanges: conflict ? conflict.hasExternalChanges : (file.hasExternalChanges || false),
            hasUnsavedChanges: unsavedFlags.hasAnyUnsaved,
            hasAnyUnsavedChanges: unsavedFlags.hasAnyUnsaved,
            hasInternalChanges: unsavedFlags.hasInternalChanges,
            isUnsavedInEditor: unsavedFlags.hasEditorUnsaved,
            isInEditMode: conflict ? conflict.isInEditMode : false,
            fileType: conflict ? conflict.fileType : (file.isMainFile ? 'main' : file.type),
        };
    });

    // Add any conflict files that aren't in browse data
    conflictFiles.forEach(cf => {
        const conflictPathKey = normalizeResolutionPath(cf.path);
        const conflictRelativeKey = normalizeResolutionPath(cf.relativePath || cf.path);
        if (!browsePathKeys.has(conflictPathKey) && !browsePathKeys.has(conflictRelativeKey)) {
            const displayPath = cf.relativePath || cf.path;
            const displayName = window.getBasename ? window.getBasename(displayPath) : displayPath;
            const unsavedFlags = resolveUnsavedFlags({
                hasAnyUnsavedChanges: cf.hasUnsavedChanges || false,
                hasUnsavedChanges: cf.hasUnsavedChanges || false,
                hasInternalChanges: cf.hasInternalChanges || false,
                isUnsavedInEditor: cf.isUnsavedInEditor || false
            });
            unified.push({
                path: cf.path,
                relativePath: displayPath,
                name: displayName || cf.path,
                type: cf.fileType || 'include',
                isMainFile: cf.fileType === 'main',
                exists: true,
                hasExternalChanges: cf.hasExternalChanges || false,
                hasUnsavedChanges: unsavedFlags.hasAnyUnsaved,
                hasAnyUnsavedChanges: unsavedFlags.hasAnyUnsaved,
                hasInternalChanges: unsavedFlags.hasInternalChanges,
                isUnsavedInEditor: unsavedFlags.hasEditorUnsaved,
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
        const mainBasename = window.getBasename ? window.getBasename(mainFile) : mainFile.split('/').pop();
        allFiles.push({
            path: mainFile,
            relativePath: mainBasename,
            name: mainBasename,
            type: 'main',
            isMainFile: true,
            exists: mainFileInfo.exists !== false,
            lastAccessErrorCode: mainFileInfo.lastAccessErrorCode || null,
            hasInternalChanges: mainFileInfo.hasInternalChanges || false,
            hasUnsavedChanges: mainFileInfo.hasAnyUnsavedChanges
                ?? mainFileInfo.hasInternalChanges
                ?? false,
            hasAnyUnsavedChanges: mainFileInfo.hasAnyUnsavedChanges
                ?? mainFileInfo.hasInternalChanges
                ?? false,
            hasExternalChanges: mainFileInfo.hasExternalChanges || false,
            documentVersion: mainFileInfo.documentVersion || 0,
            lastDocumentVersion: mainFileInfo.lastDocumentVersion || -1,
            isUnsavedInEditor: mainFileInfo.isUnsavedInEditor || false,
            lastModified: trackedFilesData.mainFileLastModified || 'Unknown'
        });
    }

    const includeFiles = trackedFilesData.includeFiles || [];
    includeFiles.forEach(file => {
        const fileBasename = window.getBasename ? window.getBasename(file.path) : file.path.split('/').pop();
        allFiles.push({
            path: file.path,
            relativePath: file.path,
            name: fileBasename,
            type: file.type || 'include',
            isMainFile: false,
            exists: file.exists !== false,
            lastAccessErrorCode: file.lastAccessErrorCode || null,
            hasInternalChanges: file.hasInternalChanges || false,
            hasUnsavedChanges: file.hasAnyUnsavedChanges
                ?? file.hasUnsavedChanges
                ?? file.hasInternalChanges
                ?? false,
            hasAnyUnsavedChanges: file.hasAnyUnsavedChanges
                ?? file.hasUnsavedChanges
                ?? file.hasInternalChanges
                ?? false,
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
    const hasInFlight = files.some(file => isInFlight(file.path));
    const hasStaleActions = files.some(file => isStaleAction(file.path));

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
                    <select class="conflict-action-select" data-file-path="__all__" data-is-main="false" onchange="onConflictApplyAll(this)" ${(hasInFlight || hasStaleActions) ? 'disabled' : ''}>
                        <option value="">--</option>
                        ${applyAllOptions}
                    </select>
                    <button onclick="executeAllActions()" class="action-btn exec-btn" title="Execute selected action for all files" ${(hasInFlight || hasStaleActions) ? 'disabled' : ''}>&#9654;</button>
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
            <td class="col-diff"></td>
        </tr>
    `;

    const fileRows = files.map(file => {
        const mainFileClass = file.isMainFile ? 'main-file' : '';
        const missingFileClass = file.exists === false ? ' missing-file' : '';
        const rowInFlight = isInFlight(file.path);
        const rowStale = isStaleAction(file.path);
        const rowActionDisabled = rowInFlight || rowStale;

        // --- Status column ---
        const statusBadge = buildStatusBadgeHTML(file);

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
        const currentAction = getResolutionAction(file.path);
        const actionOptions = actions.map(a =>
            `<option value="${a.value}" ${a.value === currentAction ? 'selected' : ''}>${a.label}</option>`
        ).join('');
        const execDisabled = rowActionDisabled;
        const execTitle = 'Execute action now';

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
                    <span class="file-name-clickable" onclick="openFile('${escapedPath}')" title="${file.path}">${file.isMainFile ? '📄' : '📎'} ${file.name}</span>
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
                        <select class="conflict-action-select" data-file-path="${file.path}" data-is-main="${file.isMainFile}" onchange="onConflictActionChange(this)" ${rowActionDisabled ? 'disabled' : ''}>
                            <option value="">--</option>
                            ${actionOptions}
                        </select>
                        <button onclick="executeAction(this)" class="action-btn exec-btn" title="${execTitle}" ${execDisabled ? 'disabled' : ''}>&#9654;</button>
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
                <td class="col-diff">
                    <input type="checkbox" class="diff-checkbox" data-file-path="${escapedPath}" onclick="toggleDiffForFile('${escapedPath}')" ${diffActiveFile === file.path ? 'checked' : ''} title="Show diff for this file" />
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
                    <th class="col-diff">Diff</th>
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
                        <span class="include-type-label column legend-badge">[COLINC]</span>
                        <span class="legend-text">!!!include() in column header - bidirectional</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-icon">Note</span>
                        <span class="legend-text">Task/body includes are deprecated; use embeds with ![](...).</span>
                    </div>
                </div>
            </div>
            <div class="legend-section">
                <div class="legend-title">Safety Rules:</div>
                <div class="legend-items">
                    <div class="legend-item">
                        <span class="legend-icon">Editor Unsaved</span>
                        <span class="legend-text">Overwrite actions are blocked while a text editor buffer is dirty.</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-icon">Read-only Include</span>
                        <span class="legend-text">Include-regular files support reload actions only; overwrite is blocked.</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-icon">Missing/Inaccessible</span>
                        <span class="legend-text">Fix missing files or permissions first; File Manager blocks unsafe save/reload actions.</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-icon">Running</span>
                        <span class="legend-text">Wait for backend completion before closing or re-running file actions.</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-icon">Apply All</span>
                        <span class="legend-text">Runs as one backend batch with preflight checks before any file action executes.</span>
                    </div>
                    <div class="legend-item">
                        <span class="legend-icon">Resolve Mode</span>
                        <span class="legend-text">Choose actions per file and execute with ▶, or use Apply All to run all at once.</span>
                    </div>
                </div>
            </div>
        </div>

    `;
}

// ============= VS CODE DIFF =============

/**
 * Toggle VS Code diff view for a file.
 * Opens native VS Code diff editor with kanban buffer (editable) on left
 * and disk content (read-only) on right.
 */
function toggleDiffForFile(filePath) {
    if (diffActiveFile === filePath) {
        // Close the diff
        closeDiff();
        return;
    }

    // Close any existing diff first
    if (diffActiveFile && window.vscode) {
        window.vscode.postMessage({ type: 'closeVscodeDiff', filePath: diffActiveFile });
    }

    diffActiveFile = filePath;
    updateDiffCheckboxStates();

    if (window.vscode) {
        window.vscode.postMessage({ type: 'openVscodeDiff', filePath });
    }
}

/**
 * Close the current VS Code diff view.
 */
function closeDiff() {
    if (diffActiveFile && window.vscode) {
        window.vscode.postMessage({ type: 'closeVscodeDiff', filePath: diffActiveFile });
    }
    diffActiveFile = null;
    diffData = null;
    updateDiffCheckboxStates();
}

/**
 * Close all VS Code diff views.
 */
function closeAllDiffs() {
    if (window.vscode) {
        window.vscode.postMessage({ type: 'closeAllVscodeDiffs' });
    }
    diffActiveFile = null;
    diffData = null;
    updateDiffCheckboxStates();
}

/**
 * Update checkbox states to reflect which file's diff is currently open.
 */
function updateDiffCheckboxStates() {
    if (!fileManagerElement) return;
    const checkboxes = fileManagerElement.querySelectorAll('.diff-checkbox');
    checkboxes.forEach(cb => {
        const filePath = cb.dataset.filePath;
        cb.checked = (filePath === diffActiveFile);
    });
}

// ============= HELPER FUNCTIONS =============

function getIncludeTypeShortLabel(fileType) {
    switch (fileType) {
        case 'include-column':
        case 'column':
            return 'colinc';
        default:
            return 'include';
    }
}

function getFileSyncStatus(filePath) {
    if (!lastVerificationResults || !lastVerificationResults.fileResults) {
        return null;
    }

    const normalizedInputPath = normalizeResolutionPath(filePath);

    return lastVerificationResults.fileResults.find(f => {
        const resultPath = normalizeResolutionPath(f.path);
        const resultRelativePath = normalizeResolutionPath(f.relativePath || '');
        return resultPath === normalizedInputPath || resultRelativePath === normalizedInputPath;
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
function updateDialogContent(forceRebuild = false) {
    if (!fileManagerElement) return;

    requestAnimationFrame(() => {
        // Update timestamp
        const timestampElement = fileManagerElement.querySelector('.file-manager-timestamp');
        if (timestampElement) {
            timestampElement.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
        }
        const snapshotElement = fileManagerElement.querySelector('.file-manager-snapshot-status');
        if (snapshotElement) {
            const snapshotStatus = getSnapshotStatus();
            snapshotElement.textContent = snapshotStatus.label;
            snapshotElement.title = snapshotStatus.title;
            snapshotElement.classList.remove('snapshot-ready', 'snapshot-stale');
            snapshotElement.classList.add(snapshotStatus.cssClass);
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

        if (forceRebuild || fileListChanged) {
            // Assign default actions for newly appearing files
            files.forEach(f => {
                if (!perFileResolutions.has(resolutionKey(f.path))) {
                    const defaultAction = getDefaultAction(f);
                    if (defaultAction) {
                        setResolution(f.path, defaultAction);
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
    const running = isInFlight(file.path);
    const staleAction = isStaleAction(file.path);
    const state = getFileStateFlags(file);
    let badge = '';
    if (state.isMissing) {
        badge = '<span class="conflict-badge conflict-both" title="File is missing on disk. Save and reload actions are blocked until the file is restored.">Missing</span>';
    } else if (state.isInaccessible) {
        badge = `<span class="conflict-badge conflict-both" title="File exists but is not accessible (${state.accessErrorCode}). Check file permissions before saving or reloading.">Inaccessible</span>`;
    } else if (state.accessErrorCode) {
        badge = `<span class="conflict-badge conflict-both" title="File I/O error (${state.accessErrorCode}). Review the file system state before saving.">I/O Error</span>`;
    } else if (state.hasExternal && state.hasAnyUnsaved) {
        badge = '<span class="conflict-badge conflict-both" title="Both external and unsaved changes">External + Unsaved</span>';
    } else if (state.hasExternal) {
        badge = '<span class="conflict-badge conflict-external" title="External changes detected">External</span>';
    } else if (state.hasEditorUnsaved && !state.hasInternalChanges) {
        badge = '<span class="conflict-badge conflict-unsaved" title="Unsaved text editor changes. Overwrite is blocked until the editor buffer is saved or discarded.">Editor Unsaved</span>';
    } else if (state.hasAnyUnsaved) {
        badge = '<span class="conflict-badge conflict-unsaved" title="Unsaved changes">Unsaved</span>';
    } else {
        badge = '<span class="conflict-badge conflict-none">Clean</span>';
    }
    if (file.isInEditMode) {
        badge += ' <span class="conflict-badge" title="Currently being edited">Editing</span>';
    }
    if (running) {
        badge += ' <span class="conflict-badge conflict-running" title="Action is currently running">Running</span>';
    }
    if (staleAction) {
        badge += ' <span class="conflict-badge conflict-stale-action" title="Action response timed out. Refresh file states before retrying.">Needs Refresh</span>';
    }
    return badge;
}

function getRegistrySyncReference(syncStatus) {
    const registryNormalized = syncStatus.registryNormalizedHash
        && syncStatus.registryNormalizedLength !== null
        && syncStatus.registryNormalizedLength !== undefined;
    const registryHash = registryNormalized ? syncStatus.registryNormalizedHash : (syncStatus.canonicalHash || 'N/A');
    const registryChars = registryNormalized ? syncStatus.registryNormalizedLength : (syncStatus.canonicalContentLength || 0);

    return {
        registryHash,
        registryChars
    };
}

function buildHashCellHTML(display, cssClass, title) {
    return `<div class="hash-display ${cssClass}" title="${title}">${display}</div>`;
}

function buildSyncHashCell(syncStatus, resolver) {
    let display = '---';
    let cssClass = 'sync-unknown';
    let title = '';

    if (syncStatus) {
        const registryReference = getRegistrySyncReference(syncStatus);
        const resolved = resolver(syncStatus, registryReference);
        if (resolved?.display) {
            display = resolved.display;
        }
        if (resolved?.cssClass) {
            cssClass = resolved.cssClass;
        }
        if (resolved?.title) {
            title = resolved.title;
        }
    }

    return buildHashCellHTML(display, cssClass, title);
}

/** Build Cache cell inner HTML from sync status. */
function buildCacheCellHTML(syncStatus) {
    return buildSyncHashCell(syncStatus, (syncState, { registryHash, registryChars }) => {
        let display = '---';
        let cssClass = 'sync-unknown';
        let title = '';
        if (syncState.frontendHash && syncState.frontendContentLength !== null && syncState.frontendContentLength !== undefined) {
            if (syncState.frontendMatchesRaw === true) {
                display = '\u2705'; cssClass = 'sync-good';
            } else if (syncState.frontendMatchesNormalized === true) {
                display = '\u26A0\uFE0F'; cssClass = 'sync-warn';
            } else if (syncState.frontendRegistryMatch === false) {
                display = '\u26A0\uFE0F'; cssClass = 'sync-warn';
            }
            title = `Frontend: ${syncState.frontendHash} (${syncState.frontendContentLength} chars)\nRegistry: ${registryHash} (${registryChars} chars)`;
        } else if (syncState.frontendAvailable === false) {
            display = '\u2753';
            title = 'Frontend hash not available';
        }
        return { display, cssClass, title };
    });
}

/** Build Saved cell inner HTML from sync status. */
function buildSavedCellHTML(syncStatus) {
    return buildSyncHashCell(syncStatus, (syncState, { registryHash, registryChars }) => {
        let display = '---';
        let cssClass = 'sync-unknown';
        let title = '';
        if (syncState.savedHash) {
            const savedHashValue = syncState.savedNormalizedHash || syncState.savedHash;
            const savedCharsValue = syncState.savedNormalizedLength ?? (syncState.savedContentLength || 0);

            if (syncState.canonicalSavedMatch) {
                display = '\u2705'; cssClass = 'sync-good';
            } else {
                display = '\u26A0\uFE0F'; cssClass = 'sync-warn';
            }

            title = `Registry: ${registryHash} (${registryChars} chars)\nSaved: ${savedHashValue} (${savedCharsValue} chars)`;
        } else {
            display = '\u2753';
            title = 'Saved file not available';
        }
        return { display, cssClass, title };
    });
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
    staleActionFiles.clear();
    const newDataHash = createDataHash(data);
    if (newDataHash === lastTrackedFilesDataHash) return;
    lastTrackedFilesDataHash = newDataHash;
    trackedFilesData = data;
    trackedFilesSnapshotToken = data?.snapshotToken || null;

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
    const frontendSnapshot = window.cachedBoard || null;
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
    const duplicationVerification = results.duplicationVerification || null;
    const duplicationIssueCount = duplicationVerification?.issueCount || 0;
    const duplicationIssues = Array.isArray(duplicationVerification?.issues)
        ? duplicationVerification.issues
        : [];
    const duplicationCopies = Array.isArray(duplicationVerification?.copies)
        ? duplicationVerification.copies
        : [];
    const formatHash = (hash) => hash ? String(hash).substring(0, 8) : 'n/a';

    const duplicationIssuesHtml = duplicationIssues.length > 0
        ? duplicationIssues.map(issue => {
            const details = issue.details
                ? `<div class="file-result-hashes">Details: ${JSON.stringify(issue.details)}</div>`
                : '';
            return `
                <div class="file-result-item ${issue.severity === 'error' ? 'mismatch' : ''}">
                    <div class="file-result-name">${issue.code}</div>
                    <div class="file-result-status">${issue.message}</div>
                    ${details}
                </div>
            `;
        }).join('')
        : '<div class="file-result-item match"><div class="file-result-status">No duplication issues detected.</div></div>';

    const duplicationCopiesHtml = duplicationCopies.length > 0
        ? duplicationCopies.map(copy => `
            <div class="file-result-item ${copy.available ? '' : 'mismatch'}">
                <div class="file-result-name">${copy.id}</div>
                <div class="file-result-status">${copy.available ? 'available' : 'missing'}</div>
                <div class="file-result-hashes">
                    <div>Hash: ${formatHash(copy.hash)}</div>
                    <div>Length: ${copy.length ?? 'n/a'} chars</div>
                </div>
            </div>
        `).join('')
        : '<div class="file-result-item"><div class="file-result-status">No copy-state metadata provided.</div></div>';

    const resultClass = (results.mismatchedFiles > 0 || duplicationIssueCount > 0)
        ? 'verification-warning'
        : 'verification-success';
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
                        <div class="summary-stat ${duplicationIssueCount > 0 ? 'status-warn' : 'status-good'}">
                            <span class="stat-label">Duplication Issues:</span>
                            <span class="stat-value">${duplicationIssueCount}</span>
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
                        ${duplicationIssueCount > 0 ? `
                        <div class="verification-summary" style="margin-bottom: 12px;">
                            <div class="summary-stat status-warn">
                                <span class="stat-label">Duplication Verification:</span>
                                <span class="stat-value">${duplicationIssueCount} issue(s) detected</span>
                            </div>
                        </div>
                        ` : ''}
                        <strong>State Copy Hashes:</strong>
                        <div class="file-results-list" style="margin-bottom: 12px;">
                            ${duplicationCopiesHtml}
                        </div>
                        <strong>Duplication Verification Issues:</strong>
                        <div class="file-results-list" style="margin-bottom: 12px;">
                            ${duplicationIssuesHtml}
                        </div>
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

function findUnifiedFileByPath(filePath) {
    const key = resolutionKey(filePath);
    if (!key) return null;
    const files = buildUnifiedFileList();
    return files.find(file => {
        const pathKey = resolutionKey(file.path);
        const relativeKey = resolutionKey(file.relativePath || file.path);
        return pathKey === key || relativeKey === key;
    }) || null;
}

function convertFilePaths(filePath, isMainFile, direction) {
    if (!window.vscode) {
        window.kanbanDebug?.warn('[FileManager.convertFilePaths] ABORTED: window.vscode undefined');
        return;
    }
    window.vscode.postMessage({
        type: 'convertPaths',
        filePath: filePath,
        isMainFile: isMainFile,
        direction: direction
    });
}

function convertAllPaths(direction) {
    if (!window.vscode) {
        window.kanbanDebug?.warn('[FileManager.convertAllPaths] ABORTED: window.vscode undefined');
        return;
    }
    window.vscode.postMessage({ type: 'convertAllPaths', direction: direction });
}

// --- Dropdown+execute dispatchers ---

function executeAction(buttonElement) {
    if (!buttonElement) {
        window.kanbanDebug?.warn('[FileManager.executeAction] ABORTED: No button element provided');
        return;
    }
    const select = buttonElement.parentElement?.querySelector('.conflict-action-select');
    if (!select) {
        window.kanbanDebug?.warn('[FileManager.executeAction] ABORTED: No select element found in parent');
        return;
    }
    if (!select.value) {
        window.kanbanDebug?.warn('[FileManager.executeAction] ABORTED: No action selected in dropdown');
        return;
    }
    const filePath = select.dataset.filePath;
    const action = select.value;

    if (!filePath) {
        window.kanbanDebug?.warn('[FileManager.executeAction] ABORTED: No file path in select dataset');
        return;
    }
    if (isStaleAction(filePath)) {
        showFileManagerNotice('File action state is stale. Refresh File Manager before retrying.', 'warn', 5000);
        refreshFileManager();
        return;
    }
    if (isInFlight(filePath)) {
        showFileManagerNotice('Action already running for this file. Wait for completion before retrying.', 'warn', 4000);
        return;
    }

    const targetFile = findUnifiedFileByPath(filePath);
    if (targetFile) {
        const actionAllowed = getActionsForFile(targetFile).some(item => item.value === action);
        if (!actionAllowed) {
            window.kanbanDebug?.warn('[FileManager.executeAction] ABORTED: Action not allowed for file state', { filePath, action });
            showFileManagerNotice('Selected action is not valid for this file state.', 'warn', 4000);
            return;
        }
    }

    setResolution(filePath, action);

    window.kanbanDebug?.warn('[FileManager.executeAction] Dispatching action', { filePath, action });

    if (action === 'skip') {
        showFileManagerNotice('Skip selected. No file action executed.', 'info', 2500);
        updateDialogContent(true);
        return;
    }

    if (!window.vscode) {
        window.kanbanDebug?.warn('[FileManager.executeAction] ABORTED: window.vscode undefined');
        return;
    }
    if (!trackedFilesSnapshotToken) {
        showFileManagerNotice('File state snapshot missing. Refresh File Manager before applying actions.', 'warn', 5000);
        refreshFileManager();
        return;
    }

    markInFlight(filePath);
    window.vscode.postMessage({
        type: 'applyBatchFileActions',
        snapshotToken: trackedFilesSnapshotToken,
        actions: [{ path: filePath, action }]
    });

    updateDialogContent(true);
}

function executeAllActions() {
    const files = buildUnifiedFileList();
    if (files.some(file => isStaleAction(file.path))) {
        showFileManagerNotice('One or more file actions timed out. Refresh File Manager before applying all.', 'warn', 5000);
        refreshFileManager();
        return;
    }
    if (files.some(file => isInFlight(file.path))) {
        showFileManagerNotice('Wait for running file actions to finish before applying all.', 'warn', 4000);
        return;
    }

    const select = document.querySelector('.conflict-action-select[data-file-path="__all__"]');
    if (!select) {
        window.kanbanDebug?.warn('[FileManager.executeAllActions] ABORTED: No "apply all" select element found');
        return;
    }
    if (!select.value) {
        window.kanbanDebug?.warn('[FileManager.executeAllActions] ABORTED: No action selected in "apply all" dropdown');
        return;
    }
    const action = select.value;
    if (action === 'skip') {
        showFileManagerNotice('Skip selected. No file actions executed.', 'info', 2500);
        return;
    }

    const targetFiles = buildUnifiedFileList();

    window.kanbanDebug?.warn('[FileManager.executeAllActions] Dispatching action', { action, fileCount: targetFiles.length });

    if (!targetFiles || targetFiles.length === 0) {
        window.kanbanDebug?.warn('[FileManager.executeAllActions] ABORTED: No files available for apply-all action');
        return;
    }

    if (!window.vscode) {
        window.kanbanDebug?.warn('[FileManager.executeAllActions] ABORTED: window.vscode undefined (browse mode)');
        return;
    }
    if (!trackedFilesSnapshotToken) {
        showFileManagerNotice('File state snapshot missing. Refresh File Manager before applying all.', 'warn', 5000);
        refreshFileManager();
        return;
    }

    const batchActions = [];

    targetFiles.forEach(file => {
        const actionAllowed = getActionsForFile(file).some(item => item.value === action);
        if (!actionAllowed) {
            return;
        }
        const filePath = file.path;
        if (!filePath) {
            return;
        }
        if (isInFlight(filePath)) {
            return;
        }

        setResolution(filePath, action);
        batchActions.push({ path: filePath, action });
    });

    if (batchActions.length === 0) {
        showFileManagerNotice('Selected action is not valid for the current file states.', 'warn', 4000);
        return;
    }

    batchActions.forEach(item => markInFlight(item.path));
    window.vscode.postMessage({
        type: 'applyBatchFileActions',
        snapshotToken: trackedFilesSnapshotToken,
        actions: batchActions
    });

    updateDialogContent(true);
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
    trackedFilesSnapshotToken = null;
    refreshCount = 0;
    if (window.vscode) {
        window.vscode.postMessage({ type: 'clearTrackedFilesCache' });
    }
    refreshFileManager();
}

function reloadAllIncludedFiles() {
    if (!window.vscode) {
        window.kanbanDebug?.warn('[FileManager.reloadAllIncludedFiles] ABORTED: window.vscode undefined');
        return;
    }
    window.vscode.postMessage({ type: 'reloadAllIncludedFiles' });
    setTimeout(() => { refreshFileManager(); }, 500);
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
    if (!fileManagerVisible) return;

    // Escape to close dialog
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeDialog();
        return;
    }

    // Cmd+S / Ctrl+S to save and refresh the file manager
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        e.stopPropagation();

        // Call the global save function if available
        if (typeof window.saveCachedBoard === 'function') {
            window.saveCachedBoard();
        }

        // Refresh file manager display after a short delay to allow save to complete
        setTimeout(() => {
            refreshFileManager();
            verifyContentSync(true);
        }, 200);
    }
}

// ============= INITIALIZATION =============

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeFileManager);
} else {
    initializeFileManager();
}

function isFileManagerVisible() {
    return fileManagerVisible;
}

function initializeFileManager() {
    window.showFileManager = showFileManager;
    window.hideFileManager = hideFileManager;
    window.isFileManagerVisible = isFileManagerVisible;
    window.updateTrackedFilesData = updateTrackedFilesData;
    window.clearFileManagerCache = clearFileManagerCache;
    window.openFile = openFile;
    window.requestFileManagerSyncRefresh = requestFileManagerSyncRefresh;
    window.openUnifiedDialog = openUnifiedDialog;
    window.requestOpenFileDialog = requestOpenFileDialog;
    window.cancelConflictResolution = cancelConflictResolution;
    window.onConflictActionChange = onConflictActionChange;
    window.onConflictApplyAll = onConflictApplyAll;
    window.closeDialog = closeDialog;
    window.executeAction = executeAction;
    window.executeAllActions = executeAllActions;
    window.executePathConvert = executePathConvert;
    window.executeAllPaths = executeAllPaths;
    window.toggleDiffForFile = toggleDiffForFile;
    window.showFileManagerNotice = showFileManagerNotice;

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
                if (fileManagerVisible) {
                    trackedFilesSnapshotToken = null;
                    refreshFileManager();
                }
                break;

            case 'saveCompleted':
                if (fileManagerVisible) {
                    trackedFilesSnapshotToken = null;
                    if (message.success === false) {
                        showFileManagerNotice(`Save failed: ${message.error || 'Unknown error'}`, 'error', 5000);
                    }
                    verifyContentSync(true);
                }
                break;

            case 'saveError':
                if (fileManagerVisible) {
                    trackedFilesSnapshotToken = null;
                    showFileManagerNotice(`Save failed: ${message.error || 'Unknown error'}`, 'error', 5000);
                    verifyContentSync(true);
                }
                break;

            case 'batchFileActionsResult':
                if (fileManagerVisible) {
                    const results = Array.isArray(message.results) ? message.results : [];
                    let appliedCount = 0;
                    let failedCount = 0;
                    let skippedCount = 0;
                    let backupCount = 0;
                    let firstError = null;

                    if (results.length === 0) {
                        clearAllInFlightState();
                    } else {
                        results.forEach(result => {
                            clearInFlight(result.path);

                            if (result.status === 'applied') {
                                appliedCount++;
                            } else if (result.status === 'failed') {
                                failedCount++;
                                if (!firstError && result.error) {
                                    firstError = result.error;
                                }
                            } else {
                                skippedCount++;
                            }

                            if (result.backupCreated) {
                                backupCount++;
                            }
                        });
                    }

                    trackedFilesSnapshotToken = null;
                    updateDialogContent(true);

                    if (failedCount > 0) {
                        const detail = firstError ? ` First error: ${firstError}` : '';
                        showFileManagerNotice(
                            `Batch actions finished with failures (${appliedCount} applied, ${failedCount} failed, ${skippedCount} skipped).${detail}`,
                            'error',
                            7000
                        );
                    } else if (appliedCount > 0) {
                        const backupSuffix = backupCount > 0 ? ` ${backupCount} backup(s) created.` : '';
                        showFileManagerNotice(
                            `Batch actions applied to ${appliedCount} file(s).${backupSuffix}`,
                            'info',
                            4500
                        );
                    } else {
                        showFileManagerNotice('Batch actions completed with no applied file changes.', 'info', 3500);
                    }

                    refreshFileManager();
                    verifyContentSync(true);
                }
                break;

            case 'forceWriteAllResult':
                pendingForceWrite = false;
                if (message.success) {
                    showFileManagerNotice('Force write completed successfully.', 'info', 6000);
                } else {
                    const errorCount = message.errors?.length || 0;
                    const written = message.filesWritten || 0;
                    showFileManagerNotice(`Force write: ${written} saved, ${errorCount} failed. Check console.`, 'error', 6000);
                }
                refreshFileManager();
                verifyContentSync(true);
                break;

            case 'verifyContentSyncResult':
                lastVerificationResults = message;
                if (typeof message.mismatchedFiles === 'number') {
                    const mismatchCount = message.mismatchedFiles;
                    if (mismatchCount > 0 && mismatchCount !== lastMismatchCount) {
                        showFileManagerNotice(`Consistency warning: ${mismatchCount} file(s) differ from registry.`, 'warn', 6000);
                    } else if (mismatchCount === 0 && (lastMismatchCount || 0) > 0) {
                        showFileManagerNotice('Consistency restored: all tracked files are synchronized.', 'info', 3000);
                    }
                    lastMismatchCount = mismatchCount;
                }
                if (message.duplicationVerification && typeof message.duplicationVerification.issueCount === 'number') {
                    const issueCount = message.duplicationVerification.issueCount;
                    if (issueCount > 0 && issueCount !== lastDuplicationIssueCount) {
                        const firstIssue = Array.isArray(message.duplicationVerification.issues)
                            ? message.duplicationVerification.issues[0]
                            : null;
                        const firstIssueText = firstIssue?.code
                            ? ` First issue: ${firstIssue.code}.`
                            : '';
                        showFileManagerNotice(
                            `Data duplication verification detected ${issueCount} issue(s). Review sync state before saving.${firstIssueText}`,
                            'warn',
                            7000
                        );
                    } else if (issueCount === 0 && (lastDuplicationIssueCount || 0) > 0) {
                        showFileManagerNotice(
                            'Data duplication verification passed: no duplicate state sources detected.',
                            'info',
                            3500
                        );
                    }
                    lastDuplicationIssueCount = issueCount;
                }
                if (fileManagerVisible && fileManagerElement) {
                    updateDialogContent();
                }
                break;

            case 'vscodeDiffClosed':
                // VS Code diff was closed externally (user closed the tab)
                if (message.filePath === diffActiveFile) {
                    diffActiveFile = null;
                    diffData = null;
                    updateDiffCheckboxStates();
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

/**
 * Remove all deleted items (tagged with #hidden-internal-deleted) from files.
 * This permanently removes them from the markdown files, not just from memory.
 * Items with #hidden-internal-parked are NOT removed.
 */
function removeDeletedItemsFromFiles() {
    // Get all file paths from the current board
    const filePaths = [];
    if (window.currentFileInfo?.filePath) {
        filePaths.push(window.currentFileInfo.filePath);
    }
    // Also include any included files
    if (window.cachedBoard?.includedFiles) {
        window.cachedBoard.includedFiles.forEach(f => {
            if (f.path && !filePaths.includes(f.path)) {
                filePaths.push(f.path);
            }
        });
    }

    if (filePaths.length === 0) {
        alert('No files to process.');
        return;
    }

    // Confirm action
    if (!confirm(`Permanently remove all deleted items (tagged with #hidden-internal-deleted) from ${filePaths.length} file(s)?\n\nThis cannot be undone. Items in Park will NOT be affected.`)) {
        return;
    }

    // Send message to backend to remove deleted items from files
    if (window.vscode) {
        window.vscode.postMessage({
            type: 'removeDeletedItemsFromFiles',
            filePaths: filePaths
        });
    }
}

window.dismissExternalChangesNotification = dismissExternalChangesNotification;
window.removeDeletedItemsFromFiles = removeDeletedItemsFromFiles;
