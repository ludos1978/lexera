/**
 * File Manager overlay for tracking file states and conflict management
 */

// File manager state
let fileManagerVisible = false;
let fileManagerElement = null;
let trackedFilesData = {};
let lastTrackedFilesDataHash = null;
let refreshCount = 0;
let fileManagerSticky = false;
let fileManagerNoticeTimer = null;
let syncVerifyTimer = null;
const SYNC_VERIFY_DEBOUNCE_MS = 300;

// Conflict mode state
let conflictMode = false;
let conflictId = null;
let conflictType = null; // 'external_changes' | 'presave_conflict'
let conflictFiles = [];  // from backend message
let perFileResolutions = new Map(); // path -> action
let wasOpenBeforeConflict = false;

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

// Hover behavior state
let hoverShowTimer = null;
let hoverHideTimer = null;
let autoRefreshTimer = null;
const HOVER_SHOW_DELAY = 500; // ms
const HOVER_HIDE_DELAY = 300; // ms

/**
 * Create and show the file manager overlay
 */
function showFileManager() {

    if (fileManagerElement) {
        fileManagerElement.remove();
    }

    // Check if vscode is available
    if (typeof window.vscode === 'undefined') {
        console.error('[FileManager] vscode API not available, cannot request file info');
        showFileManagerNotice('File manager error: vscode API not available', 'error');
        return;
    }

    // Request current file tracking state from backend
    window.vscode.postMessage({ type: 'getTrackedFilesDebugInfo' });

    // Create overlay element
    fileManagerElement = document.createElement('div');
    fileManagerElement.id = 'file-manager';
    fileManagerElement.innerHTML = createFileManagerContent();

    // Add to DOM
    document.body.appendChild(fileManagerElement);

    fileManagerVisible = true;

    // Request initial data
    if (window.vscode) {
        window.vscode.postMessage({ type: 'getTrackedFilesDebugInfo' });
    }

    // Handle mouse interactions with the overlay
    fileManagerElement.addEventListener('mouseenter', () => {
        // Cancel hide timer when mouse enters overlay
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
            hoverHideTimer = null;
        }
    });

    fileManagerElement.addEventListener('mouseleave', () => {
        // Don't auto-hide in conflict mode or sticky mode
        if (!fileManagerSticky && !conflictMode) {
            hideFileManagerDelayed();
        }
    });

    // Close on click outside (not in conflict mode)
    fileManagerElement.addEventListener('click', (e) => {
        if (e.target === fileManagerElement && !conflictMode) {
            hideFileManager();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && fileManagerVisible) {
            if (conflictMode) {
                cancelConflictResolution();
            } else {
                hideFileManager();
            }
        }
    });

    fileManagerVisible = true;

    // Start auto-refresh when overlay is visible
    startAutoRefresh();

    // Auto-verify content sync on open (silent mode)
    verifyContentSync(true);

}

/**
 * Hide and remove the file manager overlay
 */
function hideFileManager() {
    // When explicitly closed, clear sticky state too
    fileManagerSticky = false;

    // Stop auto-refresh
    stopAutoRefresh();
    if (syncVerifyTimer) {
        clearTimeout(syncVerifyTimer);
        syncVerifyTimer = null;
    }

    if (fileManagerElement) {
        fileManagerElement.remove();
        fileManagerElement = null;
    }
    fileManagerVisible = false;
}

/**
 * Schedule showing the file manager after hover delay
 */
function scheduleFileManagerShow() {
    // Cancel any pending hide
    if (hoverHideTimer) {
        clearTimeout(hoverHideTimer);
        hoverHideTimer = null;
    }

    // If already visible, don't schedule again
    if (fileManagerVisible) {
        return;
    }

    // Schedule show after delay
    if (!hoverShowTimer) {
        hoverShowTimer = setTimeout(() => {
            showFileManager();
            hoverShowTimer = null;
        }, HOVER_SHOW_DELAY);
    }
}

/**
 * Cancel scheduled file manager show
 */
function cancelFileManagerShow() {
    if (hoverShowTimer) {
        clearTimeout(hoverShowTimer);
        hoverShowTimer = null;
    }
}

/**
 * Hide file manager with delay
 */
function hideFileManagerDelayed() {
    // Don't hide if sticky mode is enabled
    if (fileManagerSticky) {
        return;
    }

    // Don't hide if mouse is over the overlay itself
    if (hoverHideTimer) {
        clearTimeout(hoverHideTimer);
    }

    hoverHideTimer = setTimeout(() => {
        hideFileManager();
        hoverHideTimer = null;
    }, HOVER_HIDE_DELAY);
}

// ============= CONFLICT MODE =============

/**
 * Enter conflict mode - triggered by backend showConflictDialog message
 */
function enterConflictMode(message) {
    wasOpenBeforeConflict = fileManagerVisible;
    conflictMode = true;
    conflictId = message.conflictId;
    conflictType = message.conflictType;
    conflictFiles = message.files || [];
    perFileResolutions = new Map();

    // Set default action per file based on conflict type
    const defaultAction = conflictType === 'presave_conflict' ? 'skip' : 'ignore';
    conflictFiles.forEach(f => {
        if (f.hasExternalChanges || f.hasUnsavedChanges) {
            perFileResolutions.set(f.path, defaultAction);
        }
    });

    // Auto-open and pin the overlay
    if (!fileManagerVisible) {
        showFileManager();
    }
    fileManagerSticky = true;

    // Rebuild content to show conflict UI
    if (fileManagerElement) {
        const panel = fileManagerElement.querySelector('.file-manager-panel');
        if (panel) {
            panel.classList.add('conflict-mode');
        }
        updateConflictModeContent();
    }
}

/**
 * Exit conflict mode and return to normal
 */
function exitConflictMode() {
    const panel = fileManagerElement?.querySelector('.file-manager-panel');
    if (panel) {
        panel.classList.remove('conflict-mode');
    }

    conflictMode = false;
    conflictId = null;
    conflictType = null;
    conflictFiles = [];
    perFileResolutions.clear();

    if (!wasOpenBeforeConflict) {
        hideFileManager();
    } else {
        fileManagerSticky = false;
        // Rebuild normal content
        if (fileManagerElement) {
            updateFileStatesContent();
            // Restore normal header
            const header = fileManagerElement.querySelector('.file-manager-header');
            if (header) {
                const conflictSubtitle = header.querySelector('.conflict-subtitle');
                if (conflictSubtitle) conflictSubtitle.remove();
            }
            // Remove conflict footer
            const footer = fileManagerElement.querySelector('.conflict-footer');
            if (footer) footer.remove();
        }
    }
    wasOpenBeforeConflict = false;
}

/**
 * Update the file manager content to show conflict resolution UI
 */
function updateConflictModeContent() {
    if (!fileManagerElement) return;

    // Update header with conflict subtitle
    const header = fileManagerElement.querySelector('.file-manager-header h3');
    if (header) {
        const typeLabel = conflictType === 'presave_conflict'
            ? 'Pre-save Conflict'
            : 'External Changes Detected';
        // Remove existing subtitle if any
        const existing = fileManagerElement.querySelector('.conflict-subtitle');
        if (existing) existing.remove();
        const subtitle = document.createElement('div');
        subtitle.className = 'conflict-subtitle';
        subtitle.textContent = typeLabel;
        header.parentNode.insertBefore(subtitle, header.nextSibling);
    }

    // Hide pin button and close button in conflict mode
    const pinBtn = fileManagerElement.querySelector('.file-manager-pin-btn');
    if (pinBtn) pinBtn.style.display = 'none';
    const closeBtn = fileManagerElement.querySelector('.file-manager-close');
    if (closeBtn) closeBtn.style.display = 'none';

    // Replace content with conflict file list
    const content = fileManagerElement.querySelector('.file-manager-content');
    if (content) {
        content.innerHTML = createConflictFileList();
    }

    // Add footer with action bar
    let footer = fileManagerElement.querySelector('.conflict-footer');
    if (!footer) {
        footer = document.createElement('div');
        footer.className = 'conflict-footer';
        const panel = fileManagerElement.querySelector('.file-manager-panel');
        if (panel) panel.appendChild(footer);
    }
    footer.innerHTML = createConflictFooter();
}

/**
 * Get available actions based on conflict type
 */
function getConflictActions() {
    if (conflictType === 'presave_conflict') {
        return [
            { value: 'overwrite_backup_external', label: 'Overwrite (backup external)' },
            { value: 'load_external_backup_mine', label: 'Load external (backup mine)' },
            { value: 'skip', label: 'Skip' }
        ];
    }
    // external_changes
    return [
        { value: 'import', label: 'Import from disk' },
        { value: 'ignore', label: 'Ignore' }
    ];
}

/**
 * Create the conflict file list HTML
 */
function createConflictFileList() {
    const actions = getConflictActions();

    const fileRows = conflictFiles.map(file => {
        const hasConflict = file.hasExternalChanges || file.hasUnsavedChanges;
        const currentAction = perFileResolutions.get(file.path) || actions[actions.length - 1].value;
        const fileName = file.relativePath.split('/').pop();
        const dirPath = file.relativePath.includes('/')
            ? file.relativePath.substring(0, file.relativePath.lastIndexOf('/'))
            : '.';

        const conflictBadge = hasConflict
            ? (file.hasExternalChanges && file.hasUnsavedChanges
                ? '<span class="conflict-badge conflict-both" title="Both external and unsaved changes">External + Unsaved</span>'
                : file.hasExternalChanges
                    ? '<span class="conflict-badge conflict-external" title="External changes detected">External</span>'
                    : '<span class="conflict-badge conflict-unsaved" title="Unsaved changes">Unsaved</span>')
            : '<span class="conflict-badge conflict-none">No conflict</span>';

        const typeLabel = file.fileType === 'main' ? '📄 Main'
            : file.fileType === 'include-column' ? '📎 Column'
            : file.fileType === 'include-task' ? '📎 Task'
            : '📎 Include';

        const actionDropdown = hasConflict
            ? `<select class="conflict-action-select" data-file-path="${file.path}" onchange="onConflictActionChange(this)">
                ${actions.map(a => `<option value="${a.value}" ${a.value === currentAction ? 'selected' : ''}>${a.label}</option>`).join('')}
               </select>`
            : '<span class="conflict-no-action">—</span>';

        return `
            <tr class="conflict-file-row ${hasConflict ? 'has-conflict' : 'no-conflict'}">
                <td class="col-file">
                    <div class="file-directory-path" title="${file.path}">
                        ${truncatePath(dirPath, 10)}
                        <span class="include-type-label">[${typeLabel}]</span>
                    </div>
                    <div class="file-name-clickable" title="${file.relativePath}">
                        ${fileName}
                    </div>
                </td>
                <td class="col-conflict-badge">${conflictBadge}</td>
                <td class="col-conflict-action">${actionDropdown}</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="conflict-file-list">
            <table class="conflict-table">
                <thead>
                    <tr>
                        <th class="col-file">File</th>
                        <th class="col-conflict-badge">Status</th>
                        <th class="col-conflict-action">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${fileRows}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * Create the conflict resolution footer HTML
 */
function createConflictFooter() {
    const actions = getConflictActions();
    const applyAllOptions = actions.map(a =>
        `<option value="${a.value}">${a.label}</option>`
    ).join('');

    return `
        <div class="conflict-footer-content">
            <div class="conflict-apply-all">
                <label>Apply to all:</label>
                <select id="conflict-apply-all-select" onchange="onConflictApplyAll(this)">
                    <option value="">— Select —</option>
                    ${applyAllOptions}
                </select>
            </div>
            <div class="conflict-footer-buttons">
                <button onclick="cancelConflictResolution()" class="conflict-btn conflict-btn-cancel">Cancel</button>
                <button onclick="submitConflictResolution()" class="conflict-btn conflict-btn-resolve">Resolve</button>
            </div>
        </div>
    `;
}

/**
 * Handle per-file action dropdown change
 */
function onConflictActionChange(selectElement) {
    const filePath = selectElement.dataset.filePath;
    const action = selectElement.value;
    perFileResolutions.set(filePath, action);
}

/**
 * Handle "Apply to All" dropdown
 */
function onConflictApplyAll(selectElement) {
    const action = selectElement.value;
    if (!action) return;

    // Apply to all files that have conflicts
    conflictFiles.forEach(file => {
        if (file.hasExternalChanges || file.hasUnsavedChanges) {
            perFileResolutions.set(file.path, action);
        }
    });

    // Update all dropdowns in the UI
    const selects = fileManagerElement?.querySelectorAll('.conflict-action-select');
    if (selects) {
        selects.forEach(sel => {
            sel.value = action;
        });
    }
}

/**
 * Submit conflict resolution to backend
 */
function submitConflictResolution() {
    if (!conflictId || !window.vscode) return;

    const resolutions = [];
    perFileResolutions.forEach((action, path) => {
        resolutions.push({ path, action });
    });

    window.vscode.postMessage({
        type: 'conflictResolution',
        conflictId: conflictId,
        cancelled: false,
        perFileResolutions: resolutions
    });

    exitConflictMode();
}

/**
 * Cancel conflict resolution
 */
function cancelConflictResolution() {
    if (!conflictId || !window.vscode) {
        exitConflictMode();
        return;
    }

    window.vscode.postMessage({
        type: 'conflictResolution',
        conflictId: conflictId,
        cancelled: true,
        perFileResolutions: []
    });

    exitConflictMode();
}

/**
 * Update the file manager with fresh data
 */
function refreshFileManager() {

    if (!fileManagerVisible || !fileManagerElement) {
        return;
    }

    refreshCount++;

    // Only request new data if we don't have recent data
    if (window.vscode) {
        window.vscode.postMessage({ type: 'getTrackedFilesDebugInfo' });
    }

    // Don't rebuild DOM here - let updateTrackedFilesData handle it
}

/**
 * Toggle sticky/pin state of file manager
 */
function toggleFileManagerSticky() {
    fileManagerSticky = !fileManagerSticky;

    // Update the pin button appearance
    const pinButton = fileManagerElement?.querySelector('.file-manager-pin-btn');
    if (pinButton) {
        pinButton.textContent = fileManagerSticky ? '📌 Pinned' : '📌 Pin';
    }
}

/**
 * Start auto-refresh timer for sticky mode
 */
function startAutoRefresh() {
    // Clear existing timer
    stopAutoRefresh();

    // Only start timer if overlay is actually visible or sticky
    if (!fileManagerVisible && !fileManagerSticky) {
        return;
    }

    // Start new auto-refresh timer (refresh every 5 seconds, less frequent)
    autoRefreshTimer = setInterval(() => {
        if (fileManagerVisible && (fileManagerSticky || document.querySelector('#file-manager:hover'))) {
            refreshFileManager();
        } else {
            // Stop timer if overlay is no longer visible
            stopAutoRefresh();
        }
    }, 5000);

}

/**
 * Stop auto-refresh timer
 */
function stopAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}

/**
 * Create a simple hash of the data to detect changes
 */
function createDataHash(data) {
    try {
        return JSON.stringify(data).replace(/\s/g, '');
    } catch (error) {
        return Math.random().toString();
    }
}

/**
 * Update tracked files data from backend
 */
function updateTrackedFilesData(data) {

    // Show main file state specifically
    if (data && data.watcherDetails) {
    }

    const newDataHash = createDataHash(data);

    // Only update if data actually changed
    if (newDataHash === lastTrackedFilesDataHash) {
        return;
    }

    lastTrackedFilesDataHash = newDataHash;
    trackedFilesData = data;

    if (fileManagerVisible && fileManagerElement) {
        // Only update the content, preserve scroll position
        updateFileStatesContent();
    }
}

/**
 * Update only the content without rebuilding the entire DOM
 */
function updateFileStatesContent() {

    if (!fileManagerElement) {
        return;
    }

    // Batch DOM updates to reduce reflow
    requestAnimationFrame(() => {
        const allFiles = createAllFilesArray();
        const now = new Date().toLocaleTimeString();

        // Update summary stats (includes timestamp now)
        const summaryElement = fileManagerElement.querySelector('.file-states-summary');
        if (summaryElement) {
            const newSummaryHTML = createFileStatesSummary(allFiles);
            if (summaryElement.innerHTML !== newSummaryHTML) {
                summaryElement.innerHTML = newSummaryHTML;
            }
        }

        const timestampElement = fileManagerElement.querySelector('.file-manager-header-meta .file-manager-timestamp');
        if (timestampElement) {
            timestampElement.textContent = `Updated: ${now}`;
        }

        // Update file list (only if content changed)
        const listElement = fileManagerElement.querySelector('.file-states-list');
        if (listElement) {
            const newListHTML = createFileStatesList(allFiles);
            const htmlChanged = listElement.innerHTML !== newListHTML;
            if (htmlChanged) {
                listElement.innerHTML = newListHTML;
            }
        }
    });
}

/**
 * Create the HTML content for the file manager overlay
 */
function createFileManagerContent() {
    const now = new Date().toLocaleTimeString();
    return `
        <div class="file-manager-panel">
            <div class="file-manager-header">
                <h3>ⓘ File States Overview</h3>
                <div class="file-manager-header-meta">
                    <button onclick="verifyContentSync()" class="file-manager-btn" title="Re-verify all hashes and sync status">
                        🔍 Verify Sync
                    </button>
                    <span class="file-manager-timestamp">Updated: ${now}</span>
                </div>
                <div class="file-manager-controls">
                    <button onclick="toggleFileManagerSticky()" class="file-manager-btn file-manager-pin-btn">
                        📌 Pin
                    </button>
                    <button onclick="hideFileManager()" class="file-manager-close">
                        ✕
                    </button>
                </div>
            </div>
            <div class="file-manager-content">
                ${createFileStatesContent()}
            </div>
        </div>
    `;
}

/**
 * Create the main file states content
 */
function createFileStatesContent() {
    const allFiles = createAllFilesArray();

    return `
        <div class="file-states-section">
            <div class="file-states-summary">
                ${createFileStatesSummary(allFiles)}
            </div>
            <div class="file-states-list">
                ${createFileStatesList(allFiles)}
            </div>
        </div>
    `;
}

/**
 * Create file watcher status section
 */
function createFileWatcherSection() {
    const mainFile = trackedFilesData.mainFile || 'Unknown';
    const watcherActive = trackedFilesData.fileWatcherActive !== false;
    const mainFileInfo = trackedFilesData.watcherDetails || {};
    const hasInternalChanges = mainFileInfo.hasInternalChanges || false;
    const hasExternalChanges = mainFileInfo.hasExternalChanges || false;

    return `
        <div class="file-manager-group">
            <h4>📄 Main File Tracking</h4>
            <div class="file-manager-item">
                <span class="file-manager-label">File:</span>
                <span class="file-manager-value file-path" title="${mainFile}">
                    ${mainFile ? mainFile.split('/').pop() : 'None'}
                </span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Watcher:</span>
                <span class="file-manager-value ${watcherActive ? 'status-good' : 'status-bad'}">
                    ${watcherActive ? '✅ Active' : '❌ Inactive'}
                </span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Internal Changes:</span>
                <span class="file-manager-value ${hasInternalChanges ? 'status-warn' : 'status-good'}">
                    ${hasInternalChanges ? '🟡 Modified' : '🟢 Saved'}
                </span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">External Changes:</span>
                <span class="file-manager-value ${hasExternalChanges ? 'status-warn' : 'status-good'}">
                    ${hasExternalChanges ? '🔄 Externally Modified' : '🟢 In Sync'}
                </span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Document Version:</span>
                <span class="file-manager-value">
                    ${mainFileInfo.documentVersion || 0} (Last: ${mainFileInfo.lastDocumentVersion || -1})
                </span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Last Modified:</span>
                <span class="file-manager-value">
                    ${trackedFilesData.mainFileLastModified || 'Unknown'}
                </span>
            </div>
        </div>
    `;
}

/**
 * Create external file watcher section
 */
function createExternalFileWatcherSection() {
    const watchers = trackedFilesData.externalWatchers || [];

    return `
        <div class="file-manager-group">
            <h4>🔍 External File Watchers</h4>
            <div class="file-manager-item">
                <span class="file-manager-label">Total Watchers:</span>
                <span class="file-manager-value">${watchers.length}</span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Status:</span>
                <span class="file-manager-value ${watchers.length > 0 ? 'status-good' : 'status-warn'}">
                    ${watchers.length > 0 ? '✅ Monitoring' : '⚠️ No watchers'}
                </span>
            </div>
            <div class="watcher-list">
                ${watchers.map(w => `
                    <div class="watcher-item">
                        <span class="watcher-file" title="${w.path}">${w.path.split('/').pop()}</span>
                        <span class="watcher-type ${w.type}">${w.type}</span>
                        <span class="watcher-status ${w.active ? 'active' : 'inactive'}">
                            ${w.active ? '🟢' : '🔴'}
                        </span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

/**
 * Create conflict manager section
 */
function createConflictManagerSection() {
    const conflicts = trackedFilesData.conflictManager || {};

    return `
        <div class="file-manager-group">
            <h4>⚡ Conflict Management</h4>
            <div class="file-manager-item">
                <span class="file-manager-label">System Status:</span>
                <span class="file-manager-value ${conflicts.healthy ? 'status-good' : 'status-bad'}">
                    ${conflicts.healthy ? '✅ Healthy' : '❌ Issues Detected'}
                </span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Tracked Files:</span>
                <span class="file-manager-value">${conflicts.trackedFiles || 0}</span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Pending Conflicts:</span>
                <span class="file-manager-value ${(conflicts.pendingConflicts || 0) > 0 ? 'status-warn' : 'status-good'}">
                    ${conflicts.pendingConflicts || 0}
                </span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Watcher Failures:</span>
                <span class="file-manager-value ${(conflicts.watcherFailures || 0) > 0 ? 'status-bad' : 'status-good'}">
                    ${conflicts.watcherFailures || 0}
                </span>
            </div>
        </div>
    `;
}

/**
 * Create include files section
 */
function createIncludeFilesSection() {
    const includeFiles = trackedFilesData.includeFiles || [];
    const internalChangesCount = includeFiles.filter(f => f.hasInternalChanges).length;
    const externalChangesCount = includeFiles.filter(f => f.hasExternalChanges).length;

    return `
        <div class="file-manager-group">
            <h4>📎 Include Files</h4>
            <div class="file-manager-item">
                <span class="file-manager-label">Total Includes:</span>
                <span class="file-manager-value">${includeFiles.length}</span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Internal:</span>
                <span class="file-manager-value ${internalChangesCount > 0 ? 'status-warn' : 'status-good'}">
                    ${internalChangesCount > 0 ? `🟡 ${internalChangesCount} Modified` : '🟢 All Saved'}
                </span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">External:</span>
                <span class="file-manager-value ${externalChangesCount > 0 ? 'status-warn' : 'status-good'}">
                    ${externalChangesCount > 0 ? `🔄 ${externalChangesCount} Externally Modified` : '🟢 All In Sync'}
                </span>
            </div>
            <div class="file-manager-controls" style="margin: 8px 0;">
                <button onclick="reloadAllIncludedFiles()" class="file-manager-btn" style="width: 100%;">
                    🔄 Reload All Included Files (Images, Videos, Includes)
                </button>
            </div>
            <div class="include-list">
                ${includeFiles.map(file => `
                    <div class="include-item">
                        <div class="include-header">
                            <span class="include-file" title="${file.path}">${file.path.split('/').pop()}</span>
                            <span class="include-type ${file.type}">${
                                file.type === 'regular' || file.type === 'include-regular' ? 'REGULAR' :
                                file.type === 'column' || file.type === 'include-column' ? 'COLUMN' :
                                file.type === 'task' || file.type === 'include-task' ? 'TASK' :
                                file.type
                            }</span>
                            <span class="include-status ${file.exists ? 'exists' : 'missing'}">
                                ${file.exists ? '📄' : '❌'}
                            </span>
                        </div>
                        <div class="include-details">
                            <span class="detail-item">Modified: ${file.lastModified || 'Unknown'}</span>
                            <span class="detail-item">
                                Content: ${file.contentLength || 0} chars
                                ${file.baselineLength > 0 ? `(Baseline: ${file.baselineLength})` : ''}
                            </span>
                            <span class="detail-item ${file.hasInternalChanges ? 'status-warn' : 'status-good'}">
                                Internal: ${file.hasInternalChanges ? '🟡 Modified' : '🟢 Saved'}
                            </span>
                            <span class="detail-item ${file.hasExternalChanges ? 'status-warn' : 'status-good'}">
                                External: ${file.hasExternalChanges ? '🔄 Changed' : '🟢 In Sync'}
                            </span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

/**
 * Create pending changes section
 */
function createPendingChangesSection() {
    const columnChanges = window.pendingColumnChanges?.size || 0;
    const taskChanges = window.pendingTaskChanges?.size || 0;
    const totalChanges = columnChanges + taskChanges;

    return `
        <div class="file-manager-group">
            <h4>💾 Pending Changes</h4>
            <div class="file-manager-item">
                <span class="file-manager-label">Total Pending:</span>
                <span class="file-manager-value ${totalChanges > 0 ? 'status-warn' : 'status-good'}">
                    ${totalChanges}
                </span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Column Changes:</span>
                <span class="file-manager-value">${columnChanges}</span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Task Changes:</span>
                <span class="file-manager-value">${taskChanges}</span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Unsaved Status:</span>
                <span class="file-manager-value ${trackedFilesData.hasUnsavedChanges ? 'status-warn' : 'status-good'}">
                    ${trackedFilesData.hasUnsavedChanges ? '🟡 Has Unsaved' : '🟢 All Saved'}
                </span>
            </div>
        </div>
    `;
}

/**
 * Create system health section
 */
function createSystemHealthSection() {
    const health = trackedFilesData.systemHealth || {};

    return `
        <div class="file-manager-group">
            <h4>🏥 System Health</h4>
            <div class="file-manager-item">
                <span class="file-manager-label">Overall Status:</span>
                <span class="file-manager-value ${health.overall || 'status-unknown'}">
                    ${health.overall === 'good' ? '✅ Good' :
                      health.overall === 'warn' ? '⚠️ Warning' :
                      health.overall === 'bad' ? '❌ Critical' : '❓ Unknown'}
                </span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Extension State:</span>
                <span class="file-manager-value">${health.extensionState || 'Unknown'}</span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Memory Usage:</span>
                <span class="file-manager-value">${health.memoryUsage || 'Unknown'}</span>
            </div>
            <div class="file-manager-item">
                <span class="file-manager-label">Last Error:</span>
                <span class="file-manager-value ${health.lastError ? 'status-bad' : 'status-good'}">
                    ${health.lastError || 'None'}
                </span>
            </div>
        </div>
    `;
}

/**
 * Get short label for include type (for path line)
 */
function getIncludeTypeShortLabel(fileType) {
    let result;
    switch (fileType) {
        case 'include-regular':
        case 'regular':
            result = 'include';
            break;
        case 'include-column':
        case 'column':
            result = 'colinc';
            break;
        case 'include-task':
        case 'task':
            result = 'taskinc';
            break;
        default:
            result = 'include'; // default fallback
            break;
    }
    return result;
}

/**
 * Get user-friendly label for include type
 */
function getIncludeTypeLabel(fileType) {
    switch (fileType) {
        case 'include-regular':
        case 'regular':
            return 'inline';
        case 'include-column':
        case 'column':
            return 'column';
        case 'include-task':
        case 'task':
            return 'task';
        default:
            return 'inline'; // default fallback
    }
}

/**
 * Get description for include type
 */
function getIncludeTypeDescription(fileType) {
    switch (fileType) {
        case 'include-regular':
        case 'regular':
            return 'Regular include (!!!include()) - read-only content insertion';
        case 'include-column':
        case 'column':
            return 'Column include (!!!include() in column header) - bidirectional sync for column tasks';
        case 'include-task':
        case 'task':
            return 'Task include (!!!include() in task title) - bidirectional sync for individual tasks';
        default:
            return 'Regular include (!!!include() in task description) - inline content display';
    }
}

/**
 * Create array of all files (main + included) with their states
 */
function createAllFilesArray() {
    const allFiles = [];

    // Add main file
    const mainFile = trackedFilesData.mainFile || 'Unknown';
    const mainFileInfo = trackedFilesData.watcherDetails || {};


    const mainFileData = {
        path: mainFile,
        relativePath: mainFile ? mainFile.split('/').pop() : 'Unknown', // Just filename for main file
        name: mainFile ? mainFile.split('/').pop() : 'Unknown',
        type: 'main',
        isMainFile: true,
        exists: true,
        hasInternalChanges: mainFileInfo.hasInternalChanges || false,
        hasExternalChanges: mainFileInfo.hasExternalChanges || false,
        documentVersion: mainFileInfo.documentVersion || 0,
        lastDocumentVersion: mainFileInfo.lastDocumentVersion || -1,
        isUnsavedInEditor: mainFileInfo.isUnsavedInEditor || false,
        lastModified: trackedFilesData.mainFileLastModified || 'Unknown'
    };

    allFiles.push(mainFileData);

    // Add include files
    const includeFiles = trackedFilesData.includeFiles || [];

    includeFiles.forEach(file => {

        allFiles.push({
            path: file.path,
            relativePath: file.path, // Use the path from backend directly (it's already relative for includes)
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

/**
 * Create summary of file states
 */
function createFileStatesSummary(allFiles) {
    return '';
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
        return `<span class="sync-summary-compact sync-unknown">⚪</span>`;
    }
    return `
        <span class="sync-summary-compact">
            <span class="sync-summary-item sync-good">✅ <br> ${summary.match}</span>
            <span class="sync-summary-item sync-warn">⚠️ <br> ${summary.diff}</span>
            <span class="sync-summary-item sync-unknown">⚪ <br> ${summary.unknown}</span>
        </span>
    `;
}

/**
 * Truncate path to specified length with ellipsis
 */
function truncatePath(path, maxLength = 10) {
    if (!path || path.length <= maxLength) {
        return path;
    }
    return path.substring(0, maxLength) + '...';
}

/**
 * Get sync status for a file from last verification results
 */
function getFileSyncStatus(filePath) {
    if (!lastVerificationResults || !lastVerificationResults.fileResults) {
        return null;
    }

    // Normalize path for comparison (remove ./ prefix and get basename for main files)
    const normalizedInputPath = filePath.replace(/^\.\//, '');
    const inputBasename = filePath.split('/').pop();

    return lastVerificationResults.fileResults.find(f => {
        const resultPath = f.path.replace(/^\.\//, '');
        const resultBasename = f.path.split('/').pop();

        // Try multiple matching strategies:
        // 1. Exact match on normalized paths
        // 2. Match on basenames (for main file which might be full path vs filename)
        // 3. Match if input path ends with result path (for absolute vs relative)
        return resultPath === normalizedInputPath ||
               resultBasename === inputBasename ||
               normalizedInputPath.endsWith(resultPath);
    });
}

/**
 * Toggle sync details section visibility
 */
function toggleSyncDetails() {
    syncDetailsExpanded = !syncDetailsExpanded;
    if (syncDetailsExpanded && !lastVerificationResults) {
        verifyContentSync(true);
    }
    updateFileStatesContent();
}

/**
 * Create the sync details collapsible section
 */
function createSyncDetailsSection() {
    if (!lastVerificationResults) {
        return `
            <div class="sync-details-section collapsed">
                <div class="sync-details-header" onclick="toggleSyncDetails()">
                    <span class="sync-details-toggle">▶</span>
                    <span class="sync-details-title">🔍 Sync Verification Details</span>
                    <span class="sync-details-hint">(Not run yet - click Verify Sync button)</span>
                </div>
            </div>
        `;
    }

    const toggleIcon = syncDetailsExpanded ? '▼' : '▶';
    const contentClass = syncDetailsExpanded ? 'expanded' : 'collapsed';
    const timestamp = new Date(lastVerificationResults.timestamp).toLocaleString();

    const detailsContent = syncDetailsExpanded ? `
        <div class="sync-details-content">
            <div class="sync-details-summary">
                <div class="sync-stat">
                    <span class="sync-stat-label">Total Files:</span>
                    <span class="sync-stat-value">${lastVerificationResults.totalFiles}</span>
                </div>
                <div class="sync-stat sync-stat-good">
                    <span class="sync-stat-label">✅ Matching:</span>
                    <span class="sync-stat-value">${lastVerificationResults.matchingFiles}</span>
                </div>
                <div class="sync-stat ${lastVerificationResults.mismatchedFiles > 0 ? 'sync-stat-warn' : ''}">
                    <span class="sync-stat-label">⚠️ Mismatched:</span>
                    <span class="sync-stat-value">${lastVerificationResults.mismatchedFiles}</span>
                </div>
                <div class="sync-stat-timestamp">
                    Last verified: ${timestamp}
                </div>
            </div>
            <div class="sync-details-note">
                <strong>Registry is the baseline</strong> - comparing Registry → Saved File
            </div>
            <div class="sync-details-files">
                ${lastVerificationResults.fileResults.map(file => {
                    const savedMatch = file.savedHash ? file.canonicalSavedMatch : null;
                    const allMatch = savedMatch === null ? true : savedMatch;

                    return `
                    <div class="sync-file-detail ${allMatch ? 'sync-match' : 'sync-mismatch'}">
                        <div class="sync-file-header">
                            <span class="sync-file-icon">${allMatch ? '✅' : '⚠️'}</span>
                            <span class="sync-file-name" title="${file.path}">${file.relativePath}</span>
                        </div>
                        <div class="sync-file-stats">
                            <div class="sync-file-stat baseline-stat">
                                <span class="sync-file-stat-label">📋 Registry (Baseline):</span>
                                <span class="sync-file-stat-value">
                                    ${file.registryNormalizedHash ? `${file.registryNormalizedHash} (${file.registryNormalizedLength} chars)` : `${file.canonicalHash} (${file.canonicalContentLength} chars)`}
                                </span>
                            </div>
                            ${file.savedHash ? `
                                <div class="sync-file-stat">
                                    <span class="sync-file-stat-label">Saved File:</span>
                                    <span class="sync-file-stat-value ${savedMatch ? 'sync-match-indicator' : 'sync-mismatch-indicator'}">
                                        ${file.savedNormalizedHash ? `${file.savedNormalizedHash} (${file.savedNormalizedLength} chars)` : `${file.savedHash} (${file.savedContentLength} chars)`}
                                        ${savedMatch ? '✅ synced' : `⚠️ differs by ${file.canonicalSavedDiff} chars`}
                                    </span>
                                </div>
                            ` : '<div class="sync-file-stat"><span class="sync-file-stat-label">Saved File:</span><span class="sync-file-stat-value sync-unknown-indicator">Not available</span></div>'}
                        </div>
                    </div>
                `}).join('')}
            </div>
        </div>
    ` : '';

    return `
        <div class="sync-details-section ${contentClass}">
            <div class="sync-details-header" onclick="toggleSyncDetails()">
                <span class="sync-details-toggle">${toggleIcon}</span>
                <span class="sync-details-title">🔍 Sync Verification Details</span>
                <span class="sync-details-status ${lastVerificationResults.mismatchedFiles > 0 ? 'status-warn' : 'status-good'}">
                    ${lastVerificationResults.matchingFiles} match, ${lastVerificationResults.mismatchedFiles} differ
                </span>
            </div>
            ${detailsContent}
        </div>
    `;
}

/**
 * Create list of all files with their states and action buttons
 */
function createFileStatesList(allFiles) {
    return `
        <div class="files-table-container">
            <table class="files-table">
                <thead>
                    <tr>
                        <th class="col-file">File</th>
                        <th class="col-frontend" title="Frontend vs registry (non-canonical)">Cache</th>
                        <th class="col-saved" title="Saved file on disk">File</th>
                        <th class="col-save">Save</th>
                        <th class="col-reload">Reload</th>
                        <th class="col-relative">Relative</th>
                        <th class="col-absolute">Absolute</th>
                        <th class="col-image">Image</th>
                    </tr>
                </thead>
                <tbody>
                    ${(() => {
                        const summary = getFileSyncSummaryCounts();
                        return `
                            <tr class="files-table-actions">
                                <td class="col-file all-files-label">All Files</td>
                                <td class="col-frontend sync-summary-cell">${renderSyncSummaryCompact(summary.cache)}</td>
                                <td class="col-saved sync-summary-cell">${renderSyncSummaryCompact(summary.file)}</td>
                                <td class="col-save action-cell">
                                    <button onclick="forceWriteAllContent()" class="action-btn save-btn" title="Force save all files">💾</button>
                                </td>
                                <td class="col-reload action-cell">
                                    <button onclick="reloadAllIncludedFiles()" class="action-btn reload-btn" title="Reload all included files from disk">↻</button>
                                </td>
                                <td class="col-relative action-cell">
                                    <button onclick="convertAllPaths('relative')" class="action-btn" title="Convert all paths to relative format">Rel</button>
                                </td>
                                <td class="col-absolute action-cell">
                                    <button onclick="convertAllPaths('absolute')" class="action-btn" title="Convert all paths to absolute format">Abs</button>
                                </td>
                                <td class="col-image action-cell">
                                    <button onclick="reloadImages()" class="action-btn reload-images-btn" title="Reload all images in the board">🖼️</button>
                                </td>
                            </tr>
                        `;
                    })()}
                    ${allFiles.map(file => {
                        const mainFileClass = file.isMainFile ? 'main-file' : '';
                        const missingFileClass = file.exists === false ? ' missing-file' : '';

                        // Get sync status from verification results
                        const syncStatus = getFileSyncStatus(file.path);

                        // Frontend data (non-canonical)
                        let frontendIcon = '⚪';
                        let frontendClass = 'sync-unknown';
                        let frontendDisplay = '⚪ Not verified';
                        let frontendTitle = '';

                        // Registry data (canonical)
                        let registryHash = 'N/A';
                        let registryChars = '?';

                        // Saved file data and sync status
                        let savedIcon = '⚪';
                        let savedClass = 'sync-unknown';
                        let savedDisplay = '⚪ Not verified';
                        let savedTitle = '';

                        if (syncStatus) {
                            // Frontend data (if available)
                            const registryNormalized = syncStatus.registryNormalizedHash
                                && syncStatus.registryNormalizedLength !== null
                                && syncStatus.registryNormalizedLength !== undefined;
                            registryHash = registryNormalized ? syncStatus.registryNormalizedHash : (syncStatus.canonicalHash || 'N/A');
                            registryChars = registryNormalized ? syncStatus.registryNormalizedLength : (syncStatus.canonicalContentLength || 0);

                            if (syncStatus.frontendHash && syncStatus.frontendContentLength !== null && syncStatus.frontendContentLength !== undefined) {
                                if (syncStatus.frontendMatchesRaw === true) {
                                    frontendIcon = '✅';
                                    frontendClass = 'sync-good';
                                } else if (syncStatus.frontendMatchesNormalized === true) {
                                    frontendIcon = '⚠️';
                                    frontendClass = 'sync-warn';
                                } else if (syncStatus.frontendRegistryMatch === false) {
                                    frontendIcon = '⚠️';
                                    frontendClass = 'sync-warn';
                                }
                                frontendDisplay = frontendIcon;
                                frontendTitle = `Frontend: ${syncStatus.frontendHash} (${syncStatus.frontendContentLength} chars)\nRegistry: ${registryHash} (${registryChars} chars)`;
                            } else if (syncStatus.frontendAvailable === false) {
                                frontendDisplay = '❓';
                                frontendTitle = 'Frontend hash not available';
                            }

                            // Saved file data and sync
                            if (syncStatus.savedHash) {
                                const savedHashValue = syncStatus.savedNormalizedHash || syncStatus.savedHash;
                                const savedCharsValue = syncStatus.savedNormalizedLength ?? (syncStatus.savedContentLength || 0);

                                if (syncStatus.canonicalSavedMatch) {
                                    savedIcon = '✅';
                                    savedClass = 'sync-good';
                                } else {
                                    savedIcon = '⚠️';
                                    savedClass = 'sync-warn';
                                }

                                savedDisplay = savedIcon;
                                savedTitle = `Registry: ${registryHash} (${registryChars} chars)\nSaved: ${savedHashValue} (${savedCharsValue} chars)`;
                            } else {
                                savedDisplay = '❓';
                                savedTitle = 'Saved file not available';
                            }
                        }

                        // Truncate directory path
                        const dirPath = file.relativePath.includes('/')
                            ? file.relativePath.substring(0, file.relativePath.lastIndexOf('/'))
                            : '.';
                        const truncatedDirPath = truncatePath(dirPath, 10);

                        return `
                            <tr class="file-row ${mainFileClass}${missingFileClass}" data-file-path="${file.path}">
                                <td class="col-file">
                                    <div class="file-directory-path" title="${file.path}">
                                        ${truncatedDirPath}
                                        ${!file.isMainFile ? `<span class="include-type-label ${file.type || 'include'}">[${getIncludeTypeShortLabel(file.type)}]</span>` : ''}
                                    </div>
                                    <div class="file-name-clickable" onclick="openFile('${file.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')" title="${file.path}">
                                        ${file.isMainFile ? '📄' : '📎'} ${file.name}
                                    </div>
                                </td>
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
                                <td class="col-save action-cell">
                                    <button onclick="saveIndividualFile('${file.path}', ${file.isMainFile}, true)" class="action-btn save-btn" title="Force save file (writes unconditionally)">💾</button>
                                </td>
                                <td class="col-reload action-cell">
                                    <button onclick="reloadIndividualFile('${file.path}', ${file.isMainFile})" class="action-btn reload-btn" title="Reload file from disk">↻</button>
                                </td>
                                <td class="col-relative action-cell">
                                    <button onclick="convertFilePaths('${file.path}', ${file.isMainFile}, 'relative')" class="action-btn" title="Convert paths to relative format">Rel</button>
                                </td>
                                <td class="col-absolute action-cell">
                                    <button onclick="convertFilePaths('${file.path}', ${file.isMainFile}, 'absolute')" class="action-btn" title="Convert paths to absolute format">Abs</button>
                                </td>
                                <td class="col-image action-cell">
                                    <button onclick="reloadImages()" class="action-btn reload-images-btn" title="Reload all images in the board">🖼️</button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
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
                            <span class="legend-icon">⚪</span>
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
        </div>
    `;
}

/**
 * Save an individual file (force write)
 */
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

/**
 * Reload an individual file from saved state
 */
function reloadIndividualFile(filePath, isMainFile) {
    if (window.vscode) {
        window.vscode.postMessage({
            type: 'reloadIndividualFile',
            filePath: filePath,
            isMainFile: isMainFile
        });
    }
}

/**
 * Convert paths in a specific file
 * @param {string} filePath - The file path to convert
 * @param {boolean} isMainFile - Whether this is the main file
 * @param {'relative'|'absolute'} direction - The conversion direction
 */
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

/**
 * Convert all paths in main file and all includes
 * @param {'relative'|'absolute'} direction - The conversion direction
 */
function convertAllPaths(direction) {
    if (window.vscode) {
        window.vscode.postMessage({
            type: 'convertAllPaths',
            direction: direction
        });
    }
}

/**
 * Open a file in VS Code
 */
function openFile(filePath) {
    if (window.vscode) {
        window.vscode.postMessage({
            type: 'openFile',
            filePath: filePath
        });
    }
}


/**
 * Reload images and media content
 */
function reloadImages() {
    // Force reload all images by appending timestamp query parameter
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        if (img.src) {
            const url = new URL(img.src, window.location.href);
            url.searchParams.set('_reload', Date.now().toString());
            img.src = url.toString();
        }
    });

    // Also reload any other media elements
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        if (video.src) {
            const url = new URL(video.src, window.location.href);
            url.searchParams.set('_reload', Date.now().toString());
            video.load();
        }
    });

}

/**
 * Clear file manager cache and request fresh data
 */
function clearFileManagerCache() {
    trackedFilesData = {};
    refreshCount = 0;
    if (window.vscode) {
        window.vscode.postMessage({ type: 'clearTrackedFilesCache' });
    }
    refreshFileManager();
}

/**
 * Reload all included files (images, videos, includes)
 */
function reloadAllIncludedFiles() {
    if (window.vscode) {
        window.vscode.postMessage({ type: 'reloadAllIncludedFiles' });
        // Refresh the file manager after a short delay to show updated data
        setTimeout(() => {
            refreshFileManager();
        }, 500);
    }
}

// Force write state
let pendingForceWrite = false;
let lastVerificationResults = null;
let syncDetailsExpanded = false;

/**
 * Force write all content (EMERGENCY RECOVERY)
 * Writes ALL files unconditionally, bypassing broken change detection
 */
function forceWriteAllContent() {
    if (pendingForceWrite) {
        return;
    }

    if (!window.vscode) {
        showFileManagerNotice('Error: vscode API not available', 'error');
        return;
    }

    // Show confirmation dialog
    showForceWriteConfirmation();
}

/**
 * Show confirmation dialog before force write
 */
function showForceWriteConfirmation() {
    const allFiles = createAllFilesArray();
    const fileCount = allFiles.length;

    const confirmHtml = `
        <div class="force-write-confirmation-overlay" id="force-write-confirmation">
            <div class="confirmation-dialog">
                <div class="confirmation-header">
                    <h3>⚠️ Force Write All Files</h3>
                </div>
                <div class="confirmation-content">
                    <p><strong>WARNING:</strong> This will unconditionally write ALL ${fileCount} files to disk, bypassing change detection.</p>
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
                            ${allFiles.map(f => `<li>${f.relativePath}</li>`).slice(0, 10).join('')}
                            ${fileCount > 10 ? `<li><em>... and ${fileCount - 10} more files</em></li>` : ''}
                        </ul>
                    </div>
                </div>
                <div class="confirmation-actions">
                    <button onclick="cancelForceWrite()" class="btn-cancel">Cancel</button>
                    <button onclick="confirmForceWrite()" class="btn-confirm">Force Write All</button>
                </div>
            </div>
        </div>
    `;

    // Add to DOM
    const confirmElement = document.createElement('div');
    confirmElement.innerHTML = confirmHtml;
    document.body.appendChild(confirmElement.firstElementChild);
}

/**
 * Cancel force write operation
 */
function cancelForceWrite() {
    const confirmDialog = document.getElementById('force-write-confirmation');
    if (confirmDialog) {
        confirmDialog.remove();
    }
}

/**
 * Confirm and execute force write
 */
function confirmForceWrite() {
    // Remove confirmation dialog
    cancelForceWrite();

    // Set pending flag
    pendingForceWrite = true;

    // Send force write message to backend
    window.vscode.postMessage({ type: 'forceWriteAllContent' });

    // Show progress indicator
    showFileManagerNotice('Force write in progress... Please wait.', 'info', 5000);
}

/**
 * Verify content synchronization between registry and saved file
 */
function verifyContentSync(silent = false) {
    if (!window.vscode) {
        if (!silent) {
            showFileManagerNotice('Error: vscode API not available', 'error');
        }
        return;
    }

    const frontendSnapshot = window.cachedBoard || window.currentBoard;

    // Send verification request to backend (registry is canonical)
    window.vscode.postMessage({
        type: 'verifyContentSync',
        frontendBoard: frontendSnapshot
    });

    // Show loading indicator only if not silent
    if (!silent) {
        showFileManagerNotice('Verifying content synchronization.', 'info', 500);
    }
}

function requestFileManagerSyncRefresh() {
    if (!fileManagerVisible || !window.vscode) {
        return;
    }
    if (syncVerifyTimer) {
        clearTimeout(syncVerifyTimer);
    }
    syncVerifyTimer = setTimeout(() => {
        syncVerifyTimer = null;
        verifyContentSync(true);
    }, SYNC_VERIFY_DEBOUNCE_MS);
}

/**
 * Show verification results
 */
function showVerificationResults(results) {
    lastVerificationResults = results;

    const resultClass = results.mismatchedFiles > 0 ? 'verification-warning' : 'verification-success';

    const resultsHtml = `
        <div class="verification-results-overlay" id="verification-results">
            <div class="verification-dialog ${resultClass}">
                <div class="verification-header">
                    <h3>🔍 Content Synchronization Verification</h3>
                    <button onclick="closeVerificationResults()" class="verification-close-btn">✕</button>
                </div>
                <div class="verification-content">
                    <div class="verification-summary">
                        <div class="summary-stat">
                            <span class="stat-label">Total Files:</span>
                            <span class="stat-value">${results.totalFiles}</span>
                        </div>
                        <div class="summary-stat status-good">
                            <span class="stat-label">✅ Matching:</span>
                            <span class="stat-value">${results.matchingFiles}</span>
                        </div>
                        <div class="summary-stat ${results.mismatchedFiles > 0 ? 'status-warn' : ''}">
                            <span class="stat-label">⚠️ Mismatched:</span>
                            <span class="stat-value">${results.mismatchedFiles}</span>
                        </div>
                    </div>
                    <div class="verification-details">
                        ${results.frontendSnapshot ? `
                        <div class="verification-summary" style="margin-bottom: 12px;">
                            <div class="summary-stat ${results.frontendSnapshot.matchesRegistry ? 'status-good' : 'status-warn'}">
                                <span class="stat-label">Frontend Snapshot (non-canonical) vs Registry:</span>
                                <span class="stat-value">
                                    ${results.frontendSnapshot.hash} (${results.frontendSnapshot.contentLength} chars)
                                    ${results.frontendSnapshot.matchesRegistry ? '✅' : `⚠️ differs by ${results.frontendSnapshot.diffChars} chars`}
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
                                        ${file.matches ?
                                            '✅ All Match' :
                                            `⚠️ Differences detected`}
                                    </div>
                                    <div class="file-result-hashes">
                                        <div>Registry: ${file.canonicalHash} (${file.canonicalContentLength} chars)</div>
                                        ${file.savedHash ? `<div>Saved: ${file.savedHash} (${file.savedContentLength} chars)
                                            ${file.canonicalSavedMatch ? '✅' : '⚠️ differs by ' + file.canonicalSavedDiff}</div>` : ''}
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

    // Add to DOM
    const resultsElement = document.createElement('div');
    resultsElement.innerHTML = resultsHtml;
    document.body.appendChild(resultsElement.firstElementChild);
}

/**
 * Close verification results dialog
 */
function closeVerificationResults() {
    const resultsDialog = document.getElementById('verification-results');
    if (resultsDialog) {
        resultsDialog.remove();
    }
}


/**
 * Enhanced manual refresh with file manager toggle
 */
function enhancedManualRefresh(showFiles = false) {
    // Show file manager if requested
    if (showFiles) {
        showFileManager();
        return;
    }

    // Call original manual refresh
    if (typeof originalManualRefresh === 'function') {
        originalManualRefresh();
    }
}

// Store original function (will be done after DOM ready)
let originalManualRefresh = null;

// Keyboard shortcut removed - now using hover behavior

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeFileManager);
} else {
    initializeFileManager();
}

function initializeFileManager() {

    // Make functions globally available immediately
    window.showFileManager = showFileManager;
    window.hideFileManager = hideFileManager;
    window.updateTrackedFilesData = updateTrackedFilesData;
    window.clearFileManagerCache = clearFileManagerCache;
    window.scheduleFileManagerShow = scheduleFileManagerShow;
    window.cancelFileManagerShow = cancelFileManagerShow;
    window.hideFileManagerDelayed = hideFileManagerDelayed;
    window.openFile = openFile;
    window.requestFileManagerSyncRefresh = requestFileManagerSyncRefresh;
    window.enterConflictMode = enterConflictMode;
    window.submitConflictResolution = submitConflictResolution;
    window.cancelConflictResolution = cancelConflictResolution;
    window.onConflictActionChange = onConflictActionChange;
    window.onConflictApplyAll = onConflictApplyAll;

    // Store original manual refresh function
    if (typeof window.manualRefresh === 'function') {
        originalManualRefresh = window.manualRefresh;
        window.manualRefresh = enhancedManualRefresh;
    } else {
        // Try again after a short delay
        setTimeout(() => {
            if (typeof window.manualRefresh === 'function' && !originalManualRefresh) {
                originalManualRefresh = window.manualRefresh;
                window.manualRefresh = enhancedManualRefresh;
            }
        }, 1000);
    }


    // Listen for document state changes from backend to auto-refresh overlay
    window.addEventListener('message', (event) => {
        const message = event.data;

        if (!message || !message.type) return;


        switch (message.type) {
            case 'showConflictDialog':
                enterConflictMode(message);
                break;

            case 'documentStateChanged':
                if (fileManagerVisible) {
                    refreshFileManager();
                }
                break;

            case 'saveCompleted':
                // After save completes, automatically re-verify sync status
                if (fileManagerVisible) {
                    verifyContentSync(true); // Silent mode
                }
                break;

            case 'individualFileSaved':
                // After individual file save completes, automatically re-verify sync status
                if (fileManagerVisible && message.success) {
                    verifyContentSync(true); // Silent mode
                }
                break;

            case 'individualFileReloaded':
                // After individual file reload completes, automatically re-verify sync status
                if (fileManagerVisible && message.success) {
                    verifyContentSync(true); // Silent mode
                }
                break;

            case 'forceWriteAllResult':
                // Clear pending flag
                pendingForceWrite = false;

                // Show result to user
                if (message.success) {
                    const resultMsg = `Force write completed successfully!\n\n` +
                        `Files written: ${message.filesWritten}\n` +
                        `Backup created: ${message.backupCreated ? 'Yes' : 'No'}\n` +
                        `${message.backupPath ? `Backup: ${message.backupPath}` : ''}`;
                    showFileManagerNotice('Force write completed successfully.', 'info', 6000);

                    // Refresh overlay
                    refreshFileManager();
                } else {
                    const errorMsg = `Force write failed!\n\n` +
                        `Errors:\n${message.errors.join('\n')}`;
                    showFileManagerNotice('Force write failed. Check console for details.', 'error', 6000);
                }
                break;

            case 'verifyContentSyncResult':
                // Store verification results and update display
                lastVerificationResults = message;

                // Update the file states content to show sync status
                if (fileManagerVisible && fileManagerElement) {
                    updateFileStatesContent();
                }
                break;
        }
    });
}
