/**
 * Task Actions - Factory functions for task operations
 *
 * Each function creates a BoardAction for a specific task operation.
 * Actions know their targets for proper undo/redo handling.
 */

import { BoardAction } from './types';
import { KanbanCard } from '../markdownParser';
import { findColumn, findCardIndex } from './helpers';
import { IdGenerator } from '../utils/idGenerator';
import { normalizeCardContent } from '../utils/cardContent';

// ============= CONTENT UPDATES (target: task) =============

/**
 * Update unified task content
 */
export const updateContent = (
    taskId: string,
    columnId: string,
    newContent: string
): BoardAction => ({
    type: 'card:updateContent',
    targets: [{ type: 'task', id: taskId, columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        const task = column?.tasks.find(t => t.id === taskId);
        if (!task) return false;

        task.content = normalizeCardContent(newContent);
        return true;
    }
});

/**
 * Update task with partial data (title, description, displayTitle)
 */
export const update = (
    taskId: string,
    columnId: string,
    taskData: Partial<KanbanCard>
): BoardAction => ({
    type: 'card:update',
    targets: [{ type: 'task', id: taskId, columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        const task = column?.tasks.find(t => t.id === taskId);
        if (!task) return false;

        if (taskData.content !== undefined) {
            task.content = normalizeCardContent(taskData.content);
        }
        if (taskData.displayTitle !== undefined && task.includeMode) {
            task.displayTitle = taskData.displayTitle;
        }
        return true;
    }
});


// ============= STRUCTURAL CHANGES (target: column) =============

/**
 * Add a new task to a column
 * Returns the new task ID on success
 */
export const add = (
    columnId: string,
    taskData: Partial<KanbanCard>,
    index?: number
): BoardAction<string | null> => ({
    type: 'card:add',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return null;

        const newCard: KanbanCard = {
            id: taskData.id || IdGenerator.generateCardId(),
            content: normalizeCardContent(taskData.content ?? ''),
            displayTitle: taskData.displayTitle,
            originalTitle: taskData.originalTitle,
            includeMode: taskData.includeMode || false,
            includeFiles: taskData.includeFiles || [],
            regularIncludeFiles: taskData.regularIncludeFiles || []
        };

        if (index !== undefined && index >= 0 && index <= column.tasks.length) {
            column.tasks.splice(index, 0, newCard);
        } else {
            column.tasks.push(newCard);
        }

        return newCard.id;
    }
});

/**
 * Delete a task from a column
 */
export const remove = (
    taskId: string,
    columnId: string
): BoardAction => ({
    type: 'card:delete',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const taskIndex = findCardIndex(column, taskId);
        if (taskIndex === -1) return false;

        column.tasks.splice(taskIndex, 1);
        return true;
    }
});

/**
 * Reorder a task within the same column
 */
export const reorder = (
    taskId: string,
    columnId: string,
    newIndex: number
): BoardAction => ({
    type: 'card:reorder',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findCardIndex(column, taskId);
        if (currentIndex === -1) return false;

        const [task] = column.tasks.splice(currentIndex, 1);
        column.tasks.splice(newIndex, 0, task);
        return true;
    }
});

/**
 * Move a task to the top of its column
 */
export const moveToTop = (
    taskId: string,
    columnId: string
): BoardAction => ({
    type: 'card:moveToTop',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findCardIndex(column, taskId);
        if (currentIndex === -1 || currentIndex === 0) return false;

        const [task] = column.tasks.splice(currentIndex, 1);
        column.tasks.unshift(task);
        return true;
    }
});

/**
 * Move a task up one position
 */
export const moveUp = (
    taskId: string,
    columnId: string
): BoardAction => ({
    type: 'card:moveUp',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findCardIndex(column, taskId);
        if (currentIndex === -1 || currentIndex === 0) return false;

        // Swap with task above
        const task = column.tasks[currentIndex];
        column.tasks[currentIndex] = column.tasks[currentIndex - 1];
        column.tasks[currentIndex - 1] = task;
        return true;
    }
});

/**
 * Move a task down one position
 */
export const moveDown = (
    taskId: string,
    columnId: string
): BoardAction => ({
    type: 'card:moveDown',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findCardIndex(column, taskId);
        if (currentIndex === -1 || currentIndex === column.tasks.length - 1) return false;

        // Swap with task below
        const task = column.tasks[currentIndex];
        column.tasks[currentIndex] = column.tasks[currentIndex + 1];
        column.tasks[currentIndex + 1] = task;
        return true;
    }
});

/**
 * Move a task to the bottom of its column
 */
export const moveToBottom = (
    taskId: string,
    columnId: string
): BoardAction => ({
    type: 'card:moveToBottom',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findCardIndex(column, taskId);
        if (currentIndex === -1 || currentIndex === column.tasks.length - 1) return false;

        const [task] = column.tasks.splice(currentIndex, 1);
        column.tasks.push(task);
        return true;
    }
});

/**
 * Move a task to a different column at a specific index
 * Targets both source and destination columns
 */
export const move = (
    taskId: string,
    fromColumnId: string,
    toColumnId: string,
    newIndex: number
): BoardAction => ({
    type: 'card:move',
    targets: [
        { type: 'column', id: fromColumnId },
        { type: 'column', id: toColumnId }
    ],
    execute: (board) => {
        const fromColumn = findColumn(board, fromColumnId);
        const toColumn = findColumn(board, toColumnId);
        if (!fromColumn || !toColumn) return false;

        const taskIndex = findCardIndex(fromColumn, taskId);
        if (taskIndex === -1) return false;

        const [task] = fromColumn.tasks.splice(taskIndex, 1);
        toColumn.tasks.splice(newIndex, 0, task);
        return true;
    }
});

/**
 * Move a task to a different column (appends to end)
 * Targets both source and destination columns
 */
export const moveToColumn = (
    taskId: string,
    fromColumnId: string,
    toColumnId: string
): BoardAction => ({
    type: 'card:moveToColumn',
    targets: [
        { type: 'column', id: fromColumnId },
        { type: 'column', id: toColumnId }
    ],
    execute: (board) => {
        const fromColumn = findColumn(board, fromColumnId);
        const toColumn = findColumn(board, toColumnId);
        if (!fromColumn || !toColumn) return false;

        const taskIndex = findCardIndex(fromColumn, taskId);
        if (taskIndex === -1) return false;

        const [task] = fromColumn.tasks.splice(taskIndex, 1);
        toColumn.tasks.push(task);
        return true;
    }
});

/**
 * Duplicate a task within the same column
 * Returns the new task ID on success
 */
export const duplicate = (
    taskId: string,
    columnId: string
): BoardAction<string | null> => ({
    type: 'card:duplicate',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return null;

        const taskIndex = findCardIndex(column, taskId);
        if (taskIndex === -1) return null;

        const originalCard = column.tasks[taskIndex];
        const newCard: KanbanCard = {
            ...JSON.parse(JSON.stringify(originalCard)),
            id: IdGenerator.generateCardId()
        };

        // Insert after the original
        column.tasks.splice(taskIndex + 1, 0, newCard);
        return newCard.id;
    }
});

/**
 * Update task include files
 */
export const updateIncludeFiles = (
    taskId: string,
    columnId: string,
    includeFiles: string[],
    includeMode: boolean
): BoardAction => ({
    type: 'card:updateIncludeFiles',
    targets: [{ type: 'task', id: taskId, columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        const task = column?.tasks.find(t => t.id === taskId);
        if (!task) return false;

        task.includeFiles = includeFiles;
        task.includeMode = includeMode;
        return true;
    }
});

/**
 * Insert a new empty task before an existing task
 * Returns the new task ID on success
 */
export const insertBefore = (
    taskId: string,
    columnId: string
): BoardAction<string | null> => ({
    type: 'card:insertBefore',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return null;

        const taskIndex = findCardIndex(column, taskId);
        if (taskIndex === -1) return null;

        const newCard: KanbanCard = {
            id: IdGenerator.generateCardId(),
            content: ''
        };

        column.tasks.splice(taskIndex, 0, newCard);
        return newCard.id;
    }
});

/**
 * Insert a new empty task after an existing task
 * Returns the new task ID on success
 */
export const insertAfter = (
    taskId: string,
    columnId: string
): BoardAction<string | null> => ({
    type: 'card:insertAfter',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return null;

        const taskIndex = findCardIndex(column, taskId);
        if (taskIndex === -1) return null;

        const newCard: KanbanCard = {
            id: IdGenerator.generateCardId(),
            content: ''
        };

        column.tasks.splice(taskIndex + 1, 0, newCard);
        return newCard.id;
    }
});
