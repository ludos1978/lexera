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
    cardId: string,
    columnId: string,
    newContent: string
): BoardAction => ({
    type: 'card:updateContent',
    targets: [{ type: 'card', id: cardId, columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        const task = column?.cards.find(t => t.id === cardId);
        if (!task) return false;

        task.content = normalizeCardContent(newContent);
        return true;
    }
});

/**
 * Update task with partial data (title, description, displayTitle)
 */
export const update = (
    cardId: string,
    columnId: string,
    cardData: Partial<KanbanCard>
): BoardAction => ({
    type: 'card:update',
    targets: [{ type: 'card', id: cardId, columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        const task = column?.cards.find(t => t.id === cardId);
        if (!task) return false;

        if (cardData.content !== undefined) {
            task.content = normalizeCardContent(cardData.content);
        }
        if (cardData.displayTitle !== undefined && task.includeMode) {
            task.displayTitle = cardData.displayTitle;
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
    cardData: Partial<KanbanCard>,
    index?: number
): BoardAction<string | null> => ({
    type: 'card:add',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return null;

        const newCard: KanbanCard = {
            id: cardData.id || IdGenerator.generateCardId(),
            content: normalizeCardContent(cardData.content ?? ''),
            displayTitle: cardData.displayTitle,
            originalTitle: cardData.originalTitle,
            includeMode: cardData.includeMode || false,
            includeFiles: cardData.includeFiles || [],
            regularIncludeFiles: cardData.regularIncludeFiles || []
        };

        if (index !== undefined && index >= 0 && index <= column.cards.length) {
            column.cards.splice(index, 0, newCard);
        } else {
            column.cards.push(newCard);
        }

        return newCard.id;
    }
});

/**
 * Delete a task from a column
 */
export const remove = (
    cardId: string,
    columnId: string
): BoardAction => ({
    type: 'card:delete',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const taskIndex = findCardIndex(column, cardId);
        if (taskIndex === -1) return false;

        column.cards.splice(taskIndex, 1);
        return true;
    }
});

/**
 * Reorder a task within the same column
 */
export const reorder = (
    cardId: string,
    columnId: string,
    newIndex: number
): BoardAction => ({
    type: 'card:reorder',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findCardIndex(column, cardId);
        if (currentIndex === -1) return false;

        const [task] = column.cards.splice(currentIndex, 1);
        column.cards.splice(newIndex, 0, task);
        return true;
    }
});

/**
 * Move a task to the top of its column
 */
export const moveToTop = (
    cardId: string,
    columnId: string
): BoardAction => ({
    type: 'card:moveToTop',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findCardIndex(column, cardId);
        if (currentIndex === -1 || currentIndex === 0) return false;

        const [task] = column.cards.splice(currentIndex, 1);
        column.cards.unshift(task);
        return true;
    }
});

/**
 * Move a task up one position
 */
export const moveUp = (
    cardId: string,
    columnId: string
): BoardAction => ({
    type: 'card:moveUp',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findCardIndex(column, cardId);
        if (currentIndex === -1 || currentIndex === 0) return false;

        // Swap with task above
        const task = column.cards[currentIndex];
        column.cards[currentIndex] = column.cards[currentIndex - 1];
        column.cards[currentIndex - 1] = task;
        return true;
    }
});

/**
 * Move a task down one position
 */
export const moveDown = (
    cardId: string,
    columnId: string
): BoardAction => ({
    type: 'card:moveDown',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findCardIndex(column, cardId);
        if (currentIndex === -1 || currentIndex === column.cards.length - 1) return false;

        // Swap with task below
        const task = column.cards[currentIndex];
        column.cards[currentIndex] = column.cards[currentIndex + 1];
        column.cards[currentIndex + 1] = task;
        return true;
    }
});

/**
 * Move a task to the bottom of its column
 */
export const moveToBottom = (
    cardId: string,
    columnId: string
): BoardAction => ({
    type: 'card:moveToBottom',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return false;

        const currentIndex = findCardIndex(column, cardId);
        if (currentIndex === -1 || currentIndex === column.cards.length - 1) return false;

        const [task] = column.cards.splice(currentIndex, 1);
        column.cards.push(task);
        return true;
    }
});

/**
 * Move a task to a different column at a specific index
 * Targets both source and destination columns
 */
export const move = (
    cardId: string,
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

        const taskIndex = findCardIndex(fromColumn, cardId);
        if (taskIndex === -1) return false;

        const [task] = fromColumn.cards.splice(taskIndex, 1);
        toColumn.cards.splice(newIndex, 0, task);
        return true;
    }
});

/**
 * Move a task to a different column (appends to end)
 * Targets both source and destination columns
 */
export const moveToColumn = (
    cardId: string,
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

        const taskIndex = findCardIndex(fromColumn, cardId);
        if (taskIndex === -1) return false;

        const [task] = fromColumn.cards.splice(taskIndex, 1);
        toColumn.cards.push(task);
        return true;
    }
});

/**
 * Duplicate a task within the same column
 * Returns the new task ID on success
 */
export const duplicate = (
    cardId: string,
    columnId: string
): BoardAction<string | null> => ({
    type: 'card:duplicate',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return null;

        const taskIndex = findCardIndex(column, cardId);
        if (taskIndex === -1) return null;

        const originalCard = column.cards[taskIndex];
        const newCard: KanbanCard = {
            ...JSON.parse(JSON.stringify(originalCard)),
            id: IdGenerator.generateCardId()
        };

        // Insert after the original
        column.cards.splice(taskIndex + 1, 0, newCard);
        return newCard.id;
    }
});

/**
 * Update task include files
 */
export const updateIncludeFiles = (
    cardId: string,
    columnId: string,
    includeFiles: string[],
    includeMode: boolean
): BoardAction => ({
    type: 'card:updateIncludeFiles',
    targets: [{ type: 'card', id: cardId, columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        const task = column?.cards.find(t => t.id === cardId);
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
    cardId: string,
    columnId: string
): BoardAction<string | null> => ({
    type: 'card:insertBefore',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return null;

        const taskIndex = findCardIndex(column, cardId);
        if (taskIndex === -1) return null;

        const newCard: KanbanCard = {
            id: IdGenerator.generateCardId(),
            content: ''
        };

        column.cards.splice(taskIndex, 0, newCard);
        return newCard.id;
    }
});

/**
 * Insert a new empty task after an existing task
 * Returns the new task ID on success
 */
export const insertAfter = (
    cardId: string,
    columnId: string
): BoardAction<string | null> => ({
    type: 'card:insertAfter',
    targets: [{ type: 'column', id: columnId }],
    execute: (board) => {
        const column = findColumn(board, columnId);
        if (!column) return null;

        const taskIndex = findCardIndex(column, cardId);
        if (taskIndex === -1) return null;

        const newCard: KanbanCard = {
            id: IdGenerator.generateCardId(),
            content: ''
        };

        column.cards.splice(taskIndex + 1, 0, newCard);
        return newCard.id;
    }
});
