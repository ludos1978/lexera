/**
 * Consistency Checker - Debug mode only
 *
 * Compares frontend DOM, cachedBoard, and savedBoardState to detect
 * synchronization issues early. Shows toast alerts when mismatches found.
 */

(function() {
    'use strict';

    const CHECK_INTERVAL_MS = 5000; // Check every 5 seconds in debug mode
    let checkIntervalId = null;
    let lastCheckTime = 0;
    let suppressedWarnings = new Set(); // Don't spam same warning

    /**
     * Run all consistency checks
     * @returns {Array} Array of issue objects { type, severity, message, details }
     */
    function runConsistencyChecks() {
        const issues = [];

        if (!window.cachedBoard?.columns) {
            return issues; // No board loaded yet
        }

        // Check 1: DOM columns vs cachedBoard columns
        const domIssues = checkDomVsCachedBoard();
        issues.push(...domIssues);

        // Check 1b: Ensure we don't keep divergent board copies in globals.
        const boardAliasIssues = checkBoardAliasConsistency();
        issues.push(...boardAliasIssues);

        // Check 2: Duplicate IDs in cachedBoard
        const dupIssues = checkDuplicateIds();
        issues.push(...dupIssues);

        // Check 3: Task parent consistency (tasks reference correct columns)
        const taskIssues = checkTaskParentConsistency();
        issues.push(...taskIssues);

        // Check 4: cachedBoard vs savedBoardState (unexpected unsaved changes)
        const saveIssues = checkSavedStateConsistency();
        issues.push(...saveIssues);

        return issues;
    }

    /**
     * Check 1b: window.currentBoard must be the same instance as window.cachedBoard.
     * If they diverge, frontend code is writing board state into two places.
     */
    function checkBoardAliasConsistency() {
        const issues = [];
        if (!window.cachedBoard && !window.currentBoard) {
            return issues;
        }

        if (window.cachedBoard !== window.currentBoard) {
            issues.push({
                type: 'board-alias-diverged',
                severity: 'error',
                message: 'window.currentBoard diverged from window.cachedBoard',
                details: {
                    hasCachedBoard: !!window.cachedBoard,
                    hasCurrentBoard: !!window.currentBoard
                }
            });
        }

        return issues;
    }

    /**
     * Check 1: Verify DOM columns match cachedBoard
     */
    function checkDomVsCachedBoard() {
        const issues = [];
        const domColumns = document.querySelectorAll('.kanban-full-height-column[data-column-id]');
        const cachedIds = new Set(window.cachedBoard.columns.map(c => c.id));

        // Columns in DOM but not in cachedBoard
        const domOnlyIds = [];
        domColumns.forEach(el => {
            const id = el.dataset.columnId;
            if (!cachedIds.has(id)) {
                domOnlyIds.push(id);
            }
        });

        if (domOnlyIds.length > 0) {
            issues.push({
                type: 'dom-cache-mismatch',
                severity: 'error',
                message: `${domOnlyIds.length} DOM column(s) not in cachedBoard`,
                details: { domOnlyIds: domOnlyIds.slice(0, 5) }
            });
        }

        // Visible columns in cachedBoard but not in DOM (excluding parked/deleted/archived)
        const domIdSet = new Set();
        domColumns.forEach(el => domIdSet.add(el.dataset.columnId));

        const PARKED_TAG = '#hidden-internal-parked';
        const DELETED_TAG = '#hidden-internal-deleted';
        const ARCHIVED_TAG = '#hidden-internal-archived';

        const cacheOnlyIds = [];
        window.cachedBoard.columns.forEach(col => {
            const isHidden = col.title?.includes(PARKED_TAG) ||
                             col.title?.includes(DELETED_TAG) ||
                             col.title?.includes(ARCHIVED_TAG);
            if (!isHidden && !domIdSet.has(col.id)) {
                cacheOnlyIds.push(col.id);
            }
        });

        if (cacheOnlyIds.length > 0) {
            issues.push({
                type: 'cache-dom-mismatch',
                severity: 'warning',
                message: `${cacheOnlyIds.length} visible cachedBoard column(s) not in DOM`,
                details: { cacheOnlyIds: cacheOnlyIds.slice(0, 5) }
            });
        }

        return issues;
    }

    /**
     * Check 2: Detect duplicate IDs
     */
    function checkDuplicateIds() {
        const issues = [];

        // Check column IDs
        const colIds = window.cachedBoard.columns.map(c => c.id);
        const colDupes = colIds.filter((id, idx) => colIds.indexOf(id) !== idx);
        if (colDupes.length > 0) {
            issues.push({
                type: 'duplicate-column-ids',
                severity: 'error',
                message: `Duplicate column IDs: ${[...new Set(colDupes)].join(', ')}`,
                details: { duplicates: [...new Set(colDupes)] }
            });
        }

        // Check task IDs across all columns
        const allTaskIds = [];
        window.cachedBoard.columns.forEach(col => {
            (col.cards || []).forEach(task => {
                allTaskIds.push(task.id);
            });
        });
        const taskDupes = allTaskIds.filter((id, idx) => allTaskIds.indexOf(id) !== idx);
        if (taskDupes.length > 0) {
            issues.push({
                type: 'duplicate-task-ids',
                severity: 'error',
                message: `Duplicate task IDs found: ${[...new Set(taskDupes)].slice(0, 3).join(', ')}`,
                details: { duplicates: [...new Set(taskDupes)].slice(0, 10) }
            });
        }

        return issues;
    }

    /**
     * Check 3: Verify tasks in DOM are in correct columns
     */
    function checkTaskParentConsistency() {
        const issues = [];
        const domTasks = document.querySelectorAll('.task-item[data-card-id]');

        // Build a map of cardId -> columnId from cachedBoard
        const taskToColumn = new Map();
        window.cachedBoard.columns.forEach(col => {
            (col.cards || []).forEach(task => {
                taskToColumn.set(task.id, col.id);
            });
        });

        const misplacedTasks = [];
        domTasks.forEach(taskEl => {
            const cardId = taskEl.dataset.cardId;
            const domColumnEl = taskEl.closest('.kanban-full-height-column');
            const domColumnId = domColumnEl?.dataset.columnId;
            const cachedColumnId = taskToColumn.get(cardId);

            if (cachedColumnId && domColumnId && cachedColumnId !== domColumnId) {
                misplacedTasks.push({ cardId, domColumnId, cachedColumnId });
            }
        });

        if (misplacedTasks.length > 0) {
            issues.push({
                type: 'task-parent-mismatch',
                severity: 'error',
                message: `${misplacedTasks.length} task(s) in wrong column`,
                details: { misplacedTasks: misplacedTasks.slice(0, 5) }
            });
        }

        return issues;
    }

    /**
     * Check 4: Unexpected differences between cachedBoard and savedBoardState
     */
    function checkSavedStateConsistency() {
        const issues = [];

        if (!window.savedBoardState?.columns || !window.cachedBoard?.columns) {
            return issues;
        }

        // Only check if hasUnsavedChanges is false but there are actual differences
        if (window.hasUnsavedChanges === false) {
            const cachedStr = JSON.stringify(window.cachedBoard.columns.map(c => ({ id: c.id, title: c.title })));
            const savedStr = JSON.stringify(window.savedBoardState.columns.map(c => ({ id: c.id, title: c.title })));

            if (cachedStr !== savedStr) {
                issues.push({
                    type: 'unsaved-state-mismatch',
                    severity: 'warning',
                    message: 'cachedBoard differs from savedBoardState but hasUnsavedChanges=false',
                    details: {
                        cachedColumnCount: window.cachedBoard.columns.length,
                        savedColumnCount: window.savedBoardState.columns.length
                    }
                });
            }
        }

        return issues;
    }

    /**
     * Show toast notification for issues
     */
    function showIssueToast(issues) {
        const errorCount = issues.filter(i => i.severity === 'error').length;
        const warnCount = issues.filter(i => i.severity === 'warning').length;

        if (errorCount === 0 && warnCount === 0) return;

        // Create unique key for this set of issues to avoid spam
        const issueKey = issues.map(i => i.type).sort().join(',');
        if (suppressedWarnings.has(issueKey)) return;
        suppressedWarnings.add(issueKey);

        // Clear suppression after 30 seconds
        setTimeout(() => suppressedWarnings.delete(issueKey), 30000);

        const message = errorCount > 0
            ? `Consistency: ${errorCount} error(s), ${warnCount} warning(s)`
            : `Consistency: ${warnCount} warning(s)`;

        const type = errorCount > 0 ? 'error' : 'warn';

        // Use existing toast system if available
        if (typeof window.showFileManagerNotice === 'function') {
            window.showFileManagerNotice(message, type, 5000);
        }

        // Always log details to console
        console.group(`[ConsistencyChecker] ${message}`);
        issues.forEach(issue => {
            const logFn = issue.severity === 'error' ? console.error : console.warn;
            logFn(`[${issue.type}] ${issue.message}`, issue.details);
        });
        console.groupEnd();
    }

    /**
     * Run check and show results
     */
    function checkAndReport() {
        if (!window.kanbanDebug?.enabled) return;
        if (!window.cachedBoard) return;

        // Debounce - don't check more than once per second
        const now = Date.now();
        if (now - lastCheckTime < 1000) return;
        lastCheckTime = now;

        const issues = runConsistencyChecks();
        if (issues.length > 0) {
            showIssueToast(issues);
        }
    }

    /**
     * Start periodic checking (debug mode only)
     */
    function startPeriodicCheck() {
        stopPeriodicCheck();
        if (window.kanbanDebug?.enabled) {
            checkIntervalId = setInterval(checkAndReport, CHECK_INTERVAL_MS);
        }
    }

    /**
     * Stop periodic checking
     */
    function stopPeriodicCheck() {
        if (checkIntervalId) {
            clearInterval(checkIntervalId);
            checkIntervalId = null;
        }
    }

    /**
     * Manual trigger for immediate check
     */
    function checkNow() {
        suppressedWarnings.clear(); // Allow re-reporting
        const issues = runConsistencyChecks();
        if (issues.length === 0) {
            console.log('[ConsistencyChecker] All checks passed');
            if (typeof window.showFileManagerNotice === 'function') {
                window.showFileManagerNotice('Consistency check: OK', 'info', 2000);
            }
        } else {
            showIssueToast(issues);
        }
        return issues;
    }

    // Expose API
    window.consistencyChecker = {
        check: checkNow,
        start: startPeriodicCheck,
        stop: stopPeriodicCheck,
        runChecks: runConsistencyChecks
    };

    // Auto-start if debug mode is already enabled
    if (window.kanbanDebug?.enabled) {
        startPeriodicCheck();
    }

    // Listen for debug mode changes
    const originalSetDebugMode = window.setDebugMode;
    if (typeof originalSetDebugMode === 'function') {
        window.setDebugMode = function(enabled, options) {
            originalSetDebugMode(enabled, options);
            if (enabled) {
                startPeriodicCheck();
            } else {
                stopPeriodicCheck();
            }
        };
    }

    // Run check after board renders
    const originalOnBoardRenderingComplete = window.onBoardRenderingComplete;
    window.onBoardRenderingComplete = function() {
        if (originalOnBoardRenderingComplete) {
            originalOnBoardRenderingComplete();
        }
        // Delay check slightly to ensure DOM is fully updated
        setTimeout(checkAndReport, 100);
    };

    console.log('[ConsistencyChecker] Loaded. Use window.consistencyChecker.check() to run manual check.');
})();
