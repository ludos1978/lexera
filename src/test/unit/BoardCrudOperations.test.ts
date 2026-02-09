/**
 * Unit tests for BoardCrudOperations
 * Tests core CRUD operations for tasks and columns
 */

import { BoardCrudOperations, NewTaskInput } from '../../board/BoardCrudOperations';
import { KanbanBoard } from '../../markdownParser';
import { mergeLegacyTaskContent, splitTaskContent } from '../../utils/taskContent';

const getSummary = (content: string): string => splitTaskContent(content).summaryLine;
const getBody = (content: string): string => splitTaskContent(content).remainingContent;

// Helper to create a test board
function createTestBoard(): KanbanBoard {
    return {
        valid: true,
        title: 'Test Board',
        yamlHeader: null,
        kanbanFooter: null,
        columns: [
            {
                id: 'col-1',
                title: 'To Do',
                tasks: [
                    { id: 'task-1', content: mergeLegacyTaskContent('Task 1', 'Description 1') },
                    { id: 'task-2', content: mergeLegacyTaskContent('Task 2', 'Description 2') },
                    { id: 'task-3', content: mergeLegacyTaskContent('Task 3', '') }
                ]
            },
            {
                id: 'col-2',
                title: 'In Progress',
                tasks: [
                    { id: 'task-4', content: mergeLegacyTaskContent('Task 4', 'Working on it') }
                ]
            },
            {
                id: 'col-3',
                title: 'Done',
                tasks: []
            }
        ]
    };
}

describe('BoardCrudOperations', () => {
    let operations: BoardCrudOperations;

    beforeEach(() => {
        operations = new BoardCrudOperations();
    });

    // ============= TASK OPERATION TESTS =============

    describe('Task Operations', () => {
        describe('addTask', () => {
            it('should add task to column', () => {
                const board = createTestBoard();
                const taskData: NewTaskInput = { content: mergeLegacyTaskContent('New Task', 'New Description') };

                const result = operations.addTask(board, 'col-3', taskData);

                expect(result).toBe(true);
                expect(board.columns[2].tasks.length).toBe(1);
                expect(getSummary(board.columns[2].tasks[0].content)).toBe('New Task');
            });

            it('should return false for non-existent column', () => {
                const board = createTestBoard();
                const result = operations.addTask(board, 'non-existent', { content: 'Test' });

                expect(result).toBe(false);
            });

            it('should add task with empty title if not provided', () => {
                const board = createTestBoard();
                const result = operations.addTask(board, 'col-3', {});

                expect(result).toBe(true);
                expect(board.columns[2].tasks[0].content).toBe('');
            });
        });

        describe('addTaskAtPosition', () => {
            it('should add task at specific position', () => {
                const board = createTestBoard();
                const taskData: NewTaskInput = { content: 'Inserted Task' };

                const result = operations.addTaskAtPosition(board, 'col-1', taskData, 1);

                expect(result).toBe(true);
                expect(board.columns[0].tasks.length).toBe(4);
                expect(getSummary(board.columns[0].tasks[1].content)).toBe('Inserted Task');
                expect(getSummary(board.columns[0].tasks[2].content)).toBe('Task 2');
            });

            it('should add at end if position exceeds length', () => {
                const board = createTestBoard();
                const result = operations.addTaskAtPosition(board, 'col-1', { content: 'End Task' }, 100);

                expect(result).toBe(true);
                expect(getSummary(board.columns[0].tasks[3].content)).toBe('End Task');
            });
        });

        describe('deleteTask', () => {
            it('should delete task from column', () => {
                const board = createTestBoard();

                const result = operations.deleteTask(board, 'task-2', 'col-1');

                expect(result).toBe(true);
                expect(board.columns[0].tasks.length).toBe(2);
                expect(board.columns[0].tasks.find(t => t.id === 'task-2')).toBeUndefined();
            });

            it('should return false for non-existent task', () => {
                const board = createTestBoard();
                const result = operations.deleteTask(board, 'non-existent', 'col-1');

                expect(result).toBe(false);
            });
        });

        describe('editTask', () => {
            it('should edit task title', () => {
                const board = createTestBoard();

                const result = operations.editTask(
                    board,
                    'task-1',
                    'col-1',
                    { content: mergeLegacyTaskContent('Updated Title', 'Description 1') }
                );

                expect(result).toBe(true);
                expect(getSummary(board.columns[0].tasks[0].content)).toBe('Updated Title');
            });

            it('should edit task description', () => {
                const board = createTestBoard();

                const result = operations.editTask(
                    board,
                    'task-1',
                    'col-1',
                    { content: mergeLegacyTaskContent('Task 1', 'Updated Description') }
                );

                expect(result).toBe(true);
                expect(getBody(board.columns[0].tasks[0].content)).toBe('Updated Description');
            });

            it('should return false for non-existent task', () => {
                const board = createTestBoard();
                const result = operations.editTask(board, 'non-existent', 'col-1', { content: 'Test' });

                expect(result).toBe(false);
            });
        });

        describe('moveTask', () => {
            it('should move task between columns', () => {
                const board = createTestBoard();

                const result = operations.moveTask(board, 'task-1', 'col-1', 'col-2', 0);

                expect(result).toBe(true);
                expect(board.columns[0].tasks.length).toBe(2);
                expect(board.columns[1].tasks.length).toBe(2);
                expect(board.columns[1].tasks[0].id).toBe('task-1');
            });

            it('should move task within same column', () => {
                const board = createTestBoard();

                const result = operations.moveTask(board, 'task-1', 'col-1', 'col-1', 2);

                expect(result).toBe(true);
                expect(board.columns[0].tasks[0].id).toBe('task-2');
                expect(board.columns[0].tasks[2].id).toBe('task-1');
            });

            it('should return false for non-existent source column', () => {
                const board = createTestBoard();
                const result = operations.moveTask(board, 'task-1', 'non-existent', 'col-2', 0);

                expect(result).toBe(false);
            });
        });

        describe('duplicateTask', () => {
            it('should duplicate task after original', () => {
                const board = createTestBoard();

                const result = operations.duplicateTask(board, 'task-1', 'col-1');

                expect(result).toBe(true);
                expect(board.columns[0].tasks.length).toBe(4);
                expect(getSummary(board.columns[0].tasks[1].content)).toBe('Task 1');
                expect(board.columns[0].tasks[1].id).not.toBe('task-1');
            });
        });

        describe('moveTaskUp/Down/ToTop/ToBottom', () => {
            it('moveTaskUp should swap with previous task', () => {
                const board = createTestBoard();

                const result = operations.moveTaskUp(board, 'task-2', 'col-1');

                expect(result).toBe(true);
                expect(board.columns[0].tasks[0].id).toBe('task-2');
                expect(board.columns[0].tasks[1].id).toBe('task-1');
            });

            it('moveTaskUp should return false for first task', () => {
                const board = createTestBoard();
                const result = operations.moveTaskUp(board, 'task-1', 'col-1');

                expect(result).toBe(false);
            });

            it('moveTaskDown should swap with next task', () => {
                const board = createTestBoard();

                const result = operations.moveTaskDown(board, 'task-1', 'col-1');

                expect(result).toBe(true);
                expect(board.columns[0].tasks[0].id).toBe('task-2');
                expect(board.columns[0].tasks[1].id).toBe('task-1');
            });

            it('moveTaskToTop should move task to first position', () => {
                const board = createTestBoard();

                const result = operations.moveTaskToTop(board, 'task-3', 'col-1');

                expect(result).toBe(true);
                expect(board.columns[0].tasks[0].id).toBe('task-3');
            });

            it('moveTaskToBottom should move task to last position', () => {
                const board = createTestBoard();

                const result = operations.moveTaskToBottom(board, 'task-1', 'col-1');

                expect(result).toBe(true);
                expect(board.columns[0].tasks[2].id).toBe('task-1');
            });
        });
    });

    // ============= COLUMN OPERATION TESTS =============

    describe('Column Operations', () => {
        describe('addColumn', () => {
            it('should add column to board', () => {
                const board = createTestBoard();

                const result = operations.addColumn(board, 'New Column');

                expect(result).toBe(true);
                expect(board.columns.length).toBe(4);
            });
        });

        describe('deleteColumn', () => {
            it('should delete column from board', () => {
                const board = createTestBoard();

                const result = operations.deleteColumn(board, 'col-2');

                expect(result).toBe(true);
                expect(board.columns.length).toBe(2);
                expect(board.columns.find(c => c.id === 'col-2')).toBeUndefined();
            });

            it('should return false for non-existent column', () => {
                const board = createTestBoard();
                const result = operations.deleteColumn(board, 'non-existent');

                expect(result).toBe(false);
            });
        });

        describe('editColumnTitle', () => {
            it('should update column title', () => {
                const board = createTestBoard();

                const result = operations.editColumnTitle(board, 'col-1', 'Updated Title');

                expect(result).toBe(true);
                expect(board.columns[0].title).toBe('Updated Title');
            });
        });

        describe('moveColumn', () => {
            it('should move column to new position', () => {
                const board = createTestBoard();

                const result = operations.moveColumn(board, 0, 2);

                expect(result).toBe(true);
                expect(board.columns[0].id).toBe('col-2');
                expect(board.columns[2].id).toBe('col-1');
            });

            it('should return false when moving to same position', () => {
                const board = createTestBoard();
                const result = operations.moveColumn(board, 1, 1);

                expect(result).toBe(false);
            });
        });

        describe('insertColumnBefore/After', () => {
            it('insertColumnBefore should insert before target', () => {
                const board = createTestBoard();

                const result = operations.insertColumnBefore(board, 'col-2', 'Inserted Before');

                expect(result).toBe(true);
                expect(board.columns.length).toBe(4);
                expect(board.columns[1].title).toBe('Inserted Before');
                expect(board.columns[2].id).toBe('col-2');
            });

            it('insertColumnAfter should insert after target', () => {
                const board = createTestBoard();

                const result = operations.insertColumnAfter(board, 'col-1', 'Inserted After');

                expect(result).toBe(true);
                expect(board.columns.length).toBe(4);
                expect(board.columns[1].title).toBe('Inserted After');
                expect(board.columns[0].id).toBe('col-1');
            });
        });
    });

    // ============= HELPER METHOD TESTS =============

    describe('Helper Methods', () => {
        describe('sortColumn', () => {
            it('should sort by title alphabetically', () => {
                const board: KanbanBoard = {
                    valid: true,
                    title: 'Test',
                    yamlHeader: null,
                    kanbanFooter: null,
                    columns: [{
                        id: 'col-1',
                        title: 'Sort Test',
                        tasks: [
                            { id: 't1', content: 'Zebra' },
                            { id: 't2', content: 'Apple' },
                            { id: 't3', content: 'Mango' }
                        ]
                    }]
                };

                const result = operations.sortColumn(board, 'col-1', 'title');

                expect(result).toBe(true);
                expect(getSummary(board.columns[0].tasks[0].content)).toBe('Apple');
                expect(getSummary(board.columns[0].tasks[1].content)).toBe('Mango');
                expect(getSummary(board.columns[0].tasks[2].content)).toBe('Zebra');
            });

            it('should sort by numeric tag', () => {
                const board: KanbanBoard = {
                    valid: true,
                    title: 'Test',
                    yamlHeader: null,
                    kanbanFooter: null,
                    columns: [{
                        id: 'col-1',
                        title: 'Sort Test',
                        tasks: [
                            { id: 't1', content: 'Task #30' },
                            { id: 't2', content: 'Task #5' },
                            { id: 't3', content: 'Task #100' }
                        ]
                    }]
                };

                const result = operations.sortColumn(board, 'col-1', 'numericTag');

                expect(result).toBe(true);
                expect(getSummary(board.columns[0].tasks[0].content)).toBe('Task #5');
                expect(getSummary(board.columns[0].tasks[1].content)).toBe('Task #30');
                expect(getSummary(board.columns[0].tasks[2].content)).toBe('Task #100');
            });
        });
    });
});
