/**
 * Board CRUD Operations for Kanban board
 * Handles task and column create, read, update, delete operations
 */

import { KanbanBoard, KanbanColumn, KanbanCard } from '../markdownParser';
import { IdGenerator } from '../utils/idGenerator';
import { normalizeCardContent } from '../utils/cardContent';
import {
    applyColumnOrder,
    buildColumnOrderAfterMove,
    extractNumericTag,
    getColumnRow,
    setColumnRowTag
} from '../actions/helpers';

/**
 * Input data for creating a new task
 */
export interface NewTaskInput {
    content?: string;
}

/**
 * Core CRUD operations for Kanban board tasks and columns
 */
export class BoardCrudOperations {
    /**
     * @deprecated Original task order is now stored in BoardStore.
     * Kept for test compatibility only.
     */
    private _originalTaskOrder: Map<string, string[]> = new Map();

    private generateId(type: 'column' | 'task'): string {
        if (type === 'column') {
            return IdGenerator.generateColumnId();
        } else {
            return IdGenerator.generateCardId();
        }
    }

    /**
     * @deprecated Use BoardStore.setOriginalTaskOrder() instead.
     * Kept for test compatibility only.
     */
    public setOriginalTaskOrder(board: KanbanBoard): void {
        this._originalTaskOrder.clear();
        board.columns.forEach(column => {
            this._originalTaskOrder.set(column.id, column.cards.map(t => t.id));
        });
    }

    private findColumn(board: KanbanBoard, columnId: string): KanbanColumn | undefined {
        return board.columns.find(col => col.id === columnId);
    }

    private findTask(board: KanbanBoard, columnId: string, cardId: string): { column: KanbanColumn; task: KanbanCard; index: number } | undefined {
        const column = this.findColumn(board, columnId);
        if (!column) { return undefined; }

        const taskIndex = column.cards.findIndex(task => task.id === cardId);
        if (taskIndex === -1) { return undefined; }

        return {
            column,
            task: column.cards[taskIndex],
            index: taskIndex
        };
    }

    // ============= TASK OPERATIONS =============
    // @deprecated These methods are superseded by CardActions (src/actions/card.ts).
    // Kept for test compatibility. Production code should use Actions instead.

    /** @deprecated Use CardActions.move() instead */
    public moveTask(board: KanbanBoard, cardId: string, fromColumnId: string, toColumnId: string, newIndex: number): boolean {
        const fromColumn = this.findColumn(board, fromColumnId);
        const toColumn = this.findColumn(board, toColumnId);

        if (!fromColumn || !toColumn) {
            return false;
        }

        const taskIndex = fromColumn.cards.findIndex(task => task.id === cardId);
        if (taskIndex === -1) {
            return false;
        }

        const task = fromColumn.cards.splice(taskIndex, 1)[0];
        toColumn.cards.splice(newIndex, 0, task);
        return true;
    }

    public addTask(board: KanbanBoard, columnId: string, cardData: NewTaskInput): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        const newTask: KanbanCard = {
            id: this.generateId('task'),
            content: normalizeCardContent(cardData.content ?? '')
        };

        column.cards.push(newTask);
        return true;
    }

    public addTaskAtPosition(board: KanbanBoard, columnId: string, cardData: NewTaskInput, insertionIndex: number): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        const newTask: KanbanCard = {
            id: this.generateId('task'),
            content: normalizeCardContent(cardData.content ?? '')
        };

        if (insertionIndex >= 0 && insertionIndex <= column.cards.length) {
            column.cards.splice(insertionIndex, 0, newTask);
        } else {
            column.cards.push(newTask);
        }
        return true;
    }

    public deleteTask(board: KanbanBoard, cardId: string, columnId: string): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        const taskIndex = column.cards.findIndex(task => task.id === cardId);
        if (taskIndex === -1) { return false; }

        column.cards.splice(taskIndex, 1);
        return true;
    }

    public editTask(
        board: KanbanBoard,
        cardId: string,
        columnId: string,
        cardData: Partial<KanbanCard>
    ): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        const task = column.cards.find(t => t.id === cardId);
        if (!task) { return false; }

        if (cardData.content !== undefined) {
            task.content = normalizeCardContent(cardData.content);
        }
        if (cardData.displayTitle !== undefined && task.includeMode) {
            task.displayTitle = cardData.displayTitle;
        }

        return true;
    }

    public duplicateTask(board: KanbanBoard, cardId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, cardId);
        if (!result) { return false; }

        const newTask: KanbanCard = {
            id: this.generateId('task'),
            content: result.task.content,
            includeMode: result.task.includeMode,
            includeFiles: result.task.includeFiles
                ? result.task.includeFiles.map(f => f.trim())
                : undefined,
            originalTitle: result.task.originalTitle,
            displayTitle: result.task.displayTitle
        };

        result.column.cards.splice(result.index + 1, 0, newTask);
        return true;
    }

    public insertTaskBefore(board: KanbanBoard, cardId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, cardId);
        if (!result) { return false; }

        const newTask: KanbanCard = {
            id: this.generateId('task'),
            content: ''
        };

        result.column.cards.splice(result.index, 0, newTask);
        return true;
    }

    public insertTaskAfter(board: KanbanBoard, cardId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, cardId);
        if (!result) { return false; }

        const newTask: KanbanCard = {
            id: this.generateId('task'),
            content: ''
        };

        result.column.cards.splice(result.index + 1, 0, newTask);
        return true;
    }

    public moveTaskToTop(board: KanbanBoard, cardId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, cardId);
        if (!result || result.index === 0) { return false; }

        const task = result.column.cards.splice(result.index, 1)[0];
        result.column.cards.unshift(task);
        return true;
    }

    public moveTaskUp(board: KanbanBoard, cardId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, cardId);
        if (!result || result.index === 0) { return false; }

        const task = result.column.cards[result.index];
        result.column.cards[result.index] = result.column.cards[result.index - 1];
        result.column.cards[result.index - 1] = task;
        return true;
    }

    public moveTaskDown(board: KanbanBoard, cardId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, cardId);
        if (!result || result.index === result.column.cards.length - 1) { return false; }

        const task = result.column.cards[result.index];
        result.column.cards[result.index] = result.column.cards[result.index + 1];
        result.column.cards[result.index + 1] = task;
        return true;
    }

    public moveTaskToBottom(board: KanbanBoard, cardId: string, columnId: string): boolean {
        const result = this.findTask(board, columnId, cardId);
        if (!result || result.index === result.column.cards.length - 1) { return false; }

        const task = result.column.cards.splice(result.index, 1)[0];
        result.column.cards.push(task);
        return true;
    }

    public moveTaskToColumn(board: KanbanBoard, cardId: string, fromColumnId: string, toColumnId: string): boolean {
        const fromColumn = this.findColumn(board, fromColumnId);
        const toColumn = this.findColumn(board, toColumnId);

        if (!fromColumn || !toColumn) { return false; }

        const taskIndex = fromColumn.cards.findIndex(task => task.id === cardId);
        if (taskIndex === -1) { return false; }

        const task = fromColumn.cards.splice(taskIndex, 1)[0];
        toColumn.cards.push(task);
        return true;
    }

    // ============= COLUMN OPERATIONS =============
    // @deprecated These methods are superseded by ColumnActions (src/actions/column.ts).
    // Kept for test compatibility. Production code should use Actions instead.
    // Exception: sortColumn() is still used for 'unsorted' feature (requires _originalTaskOrder state).

    /** @deprecated Use ColumnActions.add() instead */
    public addColumn(board: KanbanBoard, title: string): boolean {
        const newColumn: KanbanColumn = {
            id: this.generateId('column'),
            title: title,
            cards: []
        };

        const targetRow = getColumnRow({ title } as KanbanColumn);
        let insertIndex = board.columns.length;

        for (let i = 0; i < board.columns.length; i++) {
            const columnRow = getColumnRow(board.columns[i]);

            if (columnRow > targetRow) {
                insertIndex = i;
                break;
            }
        }

        board.columns.splice(insertIndex, 0, newColumn);
        this._originalTaskOrder.set(newColumn.id, []);
        return true;
    }

    public moveColumn(board: KanbanBoard, fromIndex: number, toIndex: number): boolean {
        if (fromIndex === toIndex) { return false; }

        const columns = board.columns;
        const column = columns.splice(fromIndex, 1)[0];
        columns.splice(toIndex, 0, column);
        return true;
    }

    public deleteColumn(board: KanbanBoard, columnId: string): boolean {
        const index = board.columns.findIndex(col => col.id === columnId);
        if (index === -1) { return false; }

        board.columns.splice(index, 1);
        this._originalTaskOrder.delete(columnId);
        return true;
    }

    public insertColumnBefore(board: KanbanBoard, columnId: string, title: string): boolean {
        const index = board.columns.findIndex(col => col.id === columnId);
        if (index === -1) { return false; }

        const newColumn: KanbanColumn = {
            id: this.generateId('column'),
            title: title,
            cards: []
        };

        board.columns.splice(index, 0, newColumn);
        this._originalTaskOrder.set(newColumn.id, []);
        return true;
    }

    public insertColumnAfter(board: KanbanBoard, columnId: string, title: string): boolean {
        const index = board.columns.findIndex(col => col.id === columnId);
        if (index === -1) { return false; }

        const newColumn: KanbanColumn = {
            id: this.generateId('column'),
            title: title,
            cards: []
        };

        board.columns.splice(index + 1, 0, newColumn);
        this._originalTaskOrder.set(newColumn.id, []);
        return true;
    }

    public editColumnTitle(board: KanbanBoard, columnId: string, title: string): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        column.title = title;
        return true;
    }

    public reorderColumns(board: KanbanBoard, newOrder: string[], movedColumnId: string, targetRow: number): boolean {
        const movedColumn = this.findColumn(board, movedColumnId);
        if (!movedColumn) { return false; }

        // Update row tag for the moved column
        setColumnRowTag(movedColumn, targetRow);

        applyColumnOrder(board, newOrder);
        return true;
    }

    public moveColumnWithRowUpdate(board: KanbanBoard, columnId: string, newPosition: number, newRow: number): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        // Update the row tag in the title
        setColumnRowTag(column, newRow);

        const currentIndex = board.columns.findIndex(col => col.id === columnId);
        if (currentIndex === -1) { return false; }

        const targetOrder = buildColumnOrderAfterMove(board.columns, currentIndex, newPosition);
        if (!targetOrder) { return false; }

        applyColumnOrder(board, targetOrder);

        return true;
    }

    // ============= SORTING OPERATIONS =============

    /**
     * Sort tasks in a column.
     * @param board The board containing the column
     * @param columnId The column to sort
     * @param sortType The sort type: 'title', 'numericTag', or 'unsorted'
     * @param originalOrder Optional original task order for 'unsorted' (from BoardStore.getOriginalTaskOrder).
     *                      If not provided, falls back to internal _originalTaskOrder (for test compatibility).
     */
    public sortColumn(
        board: KanbanBoard,
        columnId: string,
        sortType: 'unsorted' | 'title' | 'numericTag',
        originalOrder?: string[]
    ): boolean {
        const column = this.findColumn(board, columnId);
        if (!column) { return false; }

        // Helper to get first line of content as summary
        const getFirstLine = (content: string | undefined): string => {
            const lines = (content || '').replace(/\r\n/g, '\n').split('\n');
            return lines.find(line => line.trim().length > 0) ?? lines[0] ?? '';
        };

        if (sortType === 'title') {
            column.cards.sort((a, b) => {
                const titleA = getFirstLine(a.content);
                const titleB = getFirstLine(b.content);
                return titleA.localeCompare(titleB);
            });
        } else if (sortType === 'numericTag') {
            column.cards.sort((a, b) => {
                const numA = extractNumericTag(getFirstLine(a.content));
                const numB = extractNumericTag(getFirstLine(b.content));

                if (numA === null && numB === null) return 0;
                if (numA === null) return 1;
                if (numB === null) return -1;

                return numA - numB;
            });
        } else if (sortType === 'unsorted') {
            // Use provided original order, fall back to internal (for test compatibility)
            const order = originalOrder ?? this._originalTaskOrder.get(columnId);
            if (order) {
                const taskMap = new Map(column.cards.map(t => [t.id, t]));
                column.cards = [];

                order.forEach(cardId => {
                    const task = taskMap.get(cardId);
                    if (task) {
                        column.cards.push(task);
                        taskMap.delete(cardId);
                    }
                });

                taskMap.forEach(task => {
                    column.cards.push(task);
                });
            }
        }
        return true;
    }

    public cleanupRowTags(board: KanbanBoard): boolean {
        let modified = false;

        board.columns.forEach(column => {
            const originalTitle = column.title;
            const rowTags = column.title.match(/#row\d+\b/gi) || [];

            if (rowTags.length > 1) {
                let cleanTitle = column.title;
                rowTags.forEach(tag => {
                    cleanTitle = cleanTitle.replace(new RegExp(tag, 'gi'), '');
                });
                cleanTitle = cleanTitle.replace(/\s{2,}/g, ' ').trim();

                const lastTag = rowTags[rowTags.length - 1];
                column.title = cleanTitle + ' ' + lastTag;

                if (column.title !== originalTitle) {
                    modified = true;
                }
            }
        });

        return modified;
    }
}
