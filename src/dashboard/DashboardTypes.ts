/**
 * Type definitions for the Kanban Dashboard side panel
 *
 * The dashboard aggregates data from multiple kanban boards,
 * showing upcoming items and tag summaries.
 */

/**
 * Calendar sharing mode: how this board is exposed via CalDAV
 * - 'workspace': calendar named after the workspace
 * - 'board': calendar named after the board file
 * - 'disabled': no calendar sharing
 */
export type CalendarSharingMode = 'workspace' | 'board' | 'disabled';

/**
 * Per-board calendar sharing setting.
 * 'default' inherits from the All Boards global setting.
 */
export type CalendarSharingPerBoard = 'default' | CalendarSharingMode;

/**
 * Configuration for a single board in the dashboard
 */
export interface DashboardBoardConfig {
    /** File URI of the kanban board */
    uri: string;
    /** Timeframe in days for showing upcoming items (0 = use default, 3, 7, or 30) */
    timeframe: 0 | 3 | 7 | 30;
    /** Tags to filter/highlight in this board */
    tagFilters: string[];
    /** Whether this board is enabled in the dashboard */
    enabled: boolean;
    /** Calendar sharing mode ('default' inherits All Boards setting) */
    calendarSharing?: CalendarSharingPerBoard;
}

/**
 * Overall dashboard configuration stored in workspace settings
 */
export interface DashboardConfig {
    /** List of boards included in the dashboard */
    boards: DashboardBoardConfig[];
    /** Default timeframe for new boards */
    defaultTimeframe: 3 | 7 | 30;
}

/**
 * An upcoming item (task with temporal tag within timeframe)
 */
export interface UpcomingItem {
    /** File URI of the board containing this item */
    boardUri: string;
    /** Display name of the board (filename) */
    boardName: string;
    /** Column index (0-based) for position-based navigation */
    columnIndex: number;
    /** Column title */
    columnTitle: string;
    /** Task index (0-based) within column for position-based navigation */
    taskIndex: number;
    /** Task summary line (may include tags) */
    taskSummary: string;
    /** The temporal tag that matched (e.g., "@2026.1.20" - NEW: @ prefix for temporal) */
    temporalTag: string;
    /** Parsed date for sorting (may be undefined for week/weekday tags) */
    date?: Date;
    /** Week number if this is a week tag */
    week?: number;
    /** Year for week tag */
    year?: number;
    /** Weekday (0=Sun, 1=Mon, ..., 6=Sat) if combined with week */
    weekday?: number;
    /** Time slot if this is a time tag (e.g., "@06:00-12:00") */
    timeSlot?: string;
    /** Original raw title with all tags */
    rawTitle: string;
    /** True if this is an overdue deadline task (unchecked and past date) */
    isOverdue?: boolean;
}

/**
 * Tag information with usage count
 *
 * NEW TAG SYSTEM:
 * - hash (#): all tags including people (people are just tags)
 * - temporal (@): all temporal (dates, times, weeks, weekdays)
 */
export interface TagInfo {
    /** Tag name (without prefix) */
    name: string;
    /** Number of occurrences in the board */
    count: number;
    /** Tag type: hash (#) for tags including people, temporal (@) for dates/times */
    type: 'hash' | 'temporal';
}

/**
 * Summary of tags used in a board
 */
export interface BoardTagSummary {
    /** File URI of the board */
    boardUri: string;
    /** Display name of the board */
    boardName: string;
    /** List of tags with counts */
    tags: TagInfo[];
    /** Total number of tasks in the board */
    totalTasks: number;
    /** Number of tasks with temporal tags */
    temporalTasks: number;
    /** Board color from YAML frontmatter */
    boardColor?: string;
    boardColorDark?: string;
    boardColorLight?: string;
}

/**
 * Sort mode for dashboard results display
 */
export type DashboardSortMode = 'boardFirst' | 'merged';

/**
 * A broken element found during board scanning
 */
export interface DashboardBrokenElement {
    /** Type of broken element */
    type: 'image' | 'include' | 'link' | 'media' | 'diagram';
    /** The path that is broken */
    path: string;
    /** Board file URI */
    boardUri: string;
    /** Board display name */
    boardName: string;
    /** Column title where element was found */
    columnTitle: string;
    /** Task summary if in a task */
    taskSummary?: string;
    /** Column index for position-based navigation */
    columnIndex: number;
    /** Task index for position-based navigation */
    taskIndex?: number;
}

/**
 * A search result from pinned search re-execution
 */
export interface DashboardSearchResult {
    /** The search query */
    query: string;
    /** Whether the search is pinned */
    pinned: boolean;
    /** Board file URI */
    boardUri: string;
    /** Board display name */
    boardName: string;
    /** The matched text */
    matchText: string;
    /** Surrounding context */
    context: string;
    /** Column title where match was found */
    columnTitle: string;
    /** Task summary if in a task */
    taskSummary?: string;
    /** Column ID for navigation */
    columnId: string;
    /** Task ID for navigation */
    taskId?: string;
}

/**
 * Complete dashboard data sent to the webview
 */
export interface DashboardData {
    /** Upcoming items across all boards, sorted by date */
    upcomingItems: UpcomingItem[];
    /** Tag summaries per board */
    boardSummaries: BoardTagSummary[];
    /** Current dashboard configuration */
    config: DashboardConfig;
    /** Items matching configured tag filters */
    taggedItems: TagSearchResult[];
    /** Broken elements found across boards */
    brokenElements: DashboardBrokenElement[];
    /** Pinned search results */
    searchResults: DashboardSearchResult[];
    /** Current sort mode */
    sortMode: DashboardSortMode;
}

// Message types for dashboard webview communication

/**
 * Message sent when dashboard webview is ready
 */
export interface DashboardReadyMessage {
    type: 'dashboardReady';
}

/**
 * Request to refresh dashboard data
 */
export interface DashboardRefreshMessage {
    type: 'dashboardRefresh';
}

/**
 * Request to add a board to the dashboard
 */
export interface DashboardAddBoardMessage {
    type: 'dashboardAddBoard';
    boardUri: string;
}

/**
 * Request to remove a board from the dashboard
 */
export interface DashboardRemoveBoardMessage {
    type: 'dashboardRemoveBoard';
    boardUri: string;
}

/**
 * Request to update a board's configuration
 */
export interface DashboardUpdateConfigMessage {
    type: 'dashboardUpdateConfig';
    boardUri: string;
    timeframe?: 0 | 3 | 7 | 30;
    tagFilters?: string[];
    enabled?: boolean;
}

/**
 * Request to navigate to a specific task
 */
export interface DashboardNavigateMessage {
    type: 'dashboardNavigate';
    boardUri: string;
    columnIndex: number;
    taskIndex: number;
}

/**
 * Result from tag search
 */
export interface TagSearchResult {
    /** File URI of the board containing this task */
    boardUri: string;
    /** Display name of the board */
    boardName: string;
    /** Column index (0-based) for navigation */
    columnIndex: number;
    /** Column title */
    columnTitle: string;
    /** Task index (0-based) within column */
    taskIndex: number;
    /** Task summary line */
    taskSummary: string;
    /** The tag that matched the search */
    matchedTag: string;
}

/**
 * Request to search for tasks by tag
 */
export interface DashboardTagSearchMessage {
    type: 'dashboardTagSearch';
    tag: string;
}

/**
 * Request to add a tag filter to a board
 */
export interface DashboardAddTagFilterMessage {
    type: 'dashboardAddTagFilter';
    boardUri: string;
    tag: string;
}

/**
 * Request to remove a tag filter from a board
 */
export interface DashboardRemoveTagFilterMessage {
    type: 'dashboardRemoveTagFilter';
    boardUri: string;
    tag: string;
}

/**
 * Request to set the sort mode
 */
export interface DashboardSetSortModeMessage {
    type: 'dashboardSetSortMode';
    sortMode: DashboardSortMode;
}

/**
 * Request to navigate to a specific element by column/task IDs
 */
export interface DashboardNavigateToElementMessage {
    type: 'dashboardNavigateToElement';
    boardUri: string;
    columnId: string;
    taskId?: string;
}

/**
 * Tag search results from backend to webview
 */
export interface DashboardTagSearchResultsMessage {
    type: 'dashboardTagSearchResults';
    tag: string;
    results: TagSearchResult[];
}

/**
 * Data sent from backend to dashboard webview
 */
export interface DashboardDataMessage {
    type: 'dashboardData';
    data: DashboardData;
}

/**
 * Notification that configuration was updated
 */
export interface DashboardConfigUpdatedMessage {
    type: 'dashboardConfigUpdated';
    config: DashboardConfig;
}

/**
 * Request to perform a text search
 */
export interface DashboardSearchTextMessage {
    type: 'searchText';
    query: string;
    useRegex?: boolean;
    scope?: string;
    saveSearch?: boolean;
}

/**
 * Request to navigate to a search result element
 */
export interface DashboardNavigateToSearchElementMessage {
    type: 'navigateToElement';
    columnId: string;
    taskId?: string;
    elementPath?: string;
    elementType?: string;
    field?: 'columnTitle' | 'taskContent';
    matchText?: string;
    boardUri?: string;
}

/**
 * Request to pin/unpin a search
 */
export interface DashboardPinSearchMessage {
    type: 'pinSearch';
    query: string;
}

/**
 * Request to remove a search
 */
export interface DashboardRemoveSearchMessage {
    type: 'removeSearch';
    query: string;
}

/**
 * Union type for all dashboard messages from webview to backend
 */
export type DashboardIncomingMessage =
    | DashboardReadyMessage
    | DashboardRefreshMessage
    | DashboardAddBoardMessage
    | DashboardRemoveBoardMessage
    | DashboardUpdateConfigMessage
    | DashboardNavigateMessage
    | DashboardNavigateToElementMessage
    | DashboardTagSearchMessage
    | DashboardAddTagFilterMessage
    | DashboardRemoveTagFilterMessage
    | DashboardSetSortModeMessage
    | DashboardSearchTextMessage
    | DashboardNavigateToSearchElementMessage
    | DashboardPinSearchMessage
    | DashboardRemoveSearchMessage;

/**
 * Union type for all dashboard messages from backend to webview
 */
export type DashboardOutgoingMessage =
    | DashboardDataMessage
    | DashboardConfigUpdatedMessage
    | DashboardTagSearchResultsMessage;
