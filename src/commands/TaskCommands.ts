/**
 * Task Commands
 *
 * Handles all task-related message operations:
 * - editTask, addTask, deleteTask, duplicateTask
 * - moveTask, moveTaskToColumn, moveTaskToTop/Up/Down/Bottom
 * - insertTaskBefore/After
 * - updateTaskFromStrikethroughDeletion
 *
 * @module commands/TaskCommands
 */

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, IncomingMessage, MessageHandler } from './interfaces';
import {
    EditTaskMessage,
    AddTaskMessage,
    AddTaskAtPositionMessage,
    DeleteTaskMessage,
    DuplicateTaskMessage,
    InsertTaskBeforeMessage,
    InsertTaskAfterMessage,
    MoveTaskMessage,
    MoveTaskToColumnMessage,
    MoveTaskToTopMessage,
    MoveTaskUpMessage,
    MoveTaskDownMessage,
    MoveTaskToBottomMessage,
    UpdateTaskFromStrikethroughDeletionMessage
} from '../core/bridge/MessageTypes';
import { findColumn } from '../actions/helpers';
import { TaskActions } from '../actions';

/**
 * Task Commands Handler
 *
 * Processes all task-related messages from the webview.
 */
export class TaskCommands extends SwitchBasedCommand {
    readonly metadata: CommandMetadata = {
        id: 'task-commands',
        name: 'Task Commands',
        description: 'Handles task creation, editing, deletion, and movement',
        messageTypes: [
            'editTask',
            'addTask',
            'addTaskAtPosition',
            'deleteTask',
            'duplicateTask',
            'insertTaskBefore',
            'insertTaskAfter',
            'moveTask',
            'moveTaskToColumn',
            'moveTaskToTop',
            'moveTaskUp',
            'moveTaskDown',
            'moveTaskToBottom',
            'updateTaskFromStrikethroughDeletion'
        ],
        priority: 100
    };

    protected handlers: Record<string, MessageHandler> = {
        'editTask': (msg, ctx) => this.handleEditTask(msg as EditTaskMessage, ctx),
        'addTask': (msg, ctx) => this.handleAddTask(msg as AddTaskMessage, ctx),
        'addTaskAtPosition': (msg, ctx) => this.handleAddTaskAtPosition(msg as AddTaskAtPositionMessage, ctx),
        'deleteTask': (msg, ctx) => this.handleDeleteTask(msg as DeleteTaskMessage, ctx),
        'duplicateTask': (msg, ctx) => this.handleDuplicateTask(msg as DuplicateTaskMessage, ctx),
        'insertTaskBefore': (msg, ctx) => this.handleInsertTaskBefore(msg as InsertTaskBeforeMessage, ctx),
        'insertTaskAfter': (msg, ctx) => this.handleInsertTaskAfter(msg as InsertTaskAfterMessage, ctx),
        'moveTask': (msg, ctx) => this.handleMoveTask(msg as MoveTaskMessage, ctx),
        'moveTaskToColumn': (msg, ctx) => this.handleMoveTaskToColumn(msg as MoveTaskToColumnMessage, ctx),
        'moveTaskToTop': (msg, ctx) => this.handleMoveTaskToTop(msg as MoveTaskToTopMessage, ctx),
        'moveTaskUp': (msg, ctx) => this.handleMoveTaskUp(msg as MoveTaskUpMessage, ctx),
        'moveTaskDown': (msg, ctx) => this.handleMoveTaskDown(msg as MoveTaskDownMessage, ctx),
        'moveTaskToBottom': (msg, ctx) => this.handleMoveTaskToBottom(msg as MoveTaskToBottomMessage, ctx),
        'updateTaskFromStrikethroughDeletion': (msg, ctx) => this.handleUpdateTaskFromStrikethroughDeletion(msg as UpdateTaskFromStrikethroughDeletionMessage, ctx)
    };

    // ============= TASK HANDLERS =============
    // NOTE: Column include file content is synced automatically by BoardSyncHandler._propagateEditsToIncludeFiles()
    // which runs when emitBoardChanged is called (via performBoardAction). No manual sync needed here.

    /**
     * Handle editTask message - complex with include handling
     */
    private async handleEditTask(message: EditTaskMessage, context: CommandContext): Promise<CommandResult> {
        await this.executeAction(
            context,
            TaskActions.update(message.taskId, message.columnId, message.taskData),
            { sendUpdates: false }
        );

        return this.success();
    }

    /**
     * Handle addTask message
     */
    private async handleAddTask(message: AddTaskMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.add(message.columnId, message.taskData)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to add task');
    }

    /**
     * Handle addTaskAtPosition message
     */
    private async handleAddTaskAtPosition(message: AddTaskAtPositionMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.add(message.columnId, message.taskData, message.insertionIndex)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to add task');
    }

    /**
     * Handle deleteTask message
     */
    private async handleDeleteTask(message: DeleteTaskMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.remove(message.taskId, message.columnId),
            { sendUpdates: false }
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to delete task');
    }

    /**
     * Handle duplicateTask message
     */
    private async handleDuplicateTask(message: DuplicateTaskMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.duplicate(message.taskId, message.columnId)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to duplicate task');
    }

    /**
     * Handle insertTaskBefore message
     */
    private async handleInsertTaskBefore(message: InsertTaskBeforeMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.insertBefore(message.taskId, message.columnId)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to insert task');
    }

    /**
     * Handle insertTaskAfter message
     */
    private async handleInsertTaskAfter(message: InsertTaskAfterMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.insertAfter(message.taskId, message.columnId)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to insert task');
    }

    /**
     * Handle moveTask message
     */
    private async handleMoveTask(message: MoveTaskMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.move(message.taskId, message.fromColumnId, message.toColumnId, message.newIndex)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskToColumn message
     */
    private async handleMoveTaskToColumn(message: MoveTaskToColumnMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.moveToColumn(message.taskId, message.fromColumnId, message.toColumnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskToTop message
     */
    private async handleMoveTaskToTop(message: MoveTaskToTopMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.moveToTop(message.taskId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskUp message
     */
    private async handleMoveTaskUp(message: MoveTaskUpMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.moveUp(message.taskId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskDown message
     */
    private async handleMoveTaskDown(message: MoveTaskDownMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.moveDown(message.taskId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskToBottom message
     */
    private async handleMoveTaskToBottom(message: MoveTaskToBottomMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            TaskActions.moveToBottom(message.taskId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle updateTaskFromStrikethroughDeletion message
     */
    private async handleUpdateTaskFromStrikethroughDeletion(message: UpdateTaskFromStrikethroughDeletionMessage, context: CommandContext): Promise<CommandResult> {
        const { taskId, columnId, newContent } = message;

        const board = context.getCurrentBoard();
        if (!board) {
            console.error('[TaskCommands] No current board available for strikethrough deletion');
            return this.failure('No current board available');
        }

        const column = findColumn(board, columnId);
        const task = column?.tasks.find(t => t.id === taskId);
        if (!task) {
            return this.failure('Task not found');
        }

        await this.executeAction(
            context,
            TaskActions.update(taskId, columnId, { content: newContent }),
            { sendUpdates: false }
        );

        return this.success();
    }
}
