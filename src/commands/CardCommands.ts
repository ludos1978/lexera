/**
 * Task Commands
 *
 * Handles all task-related message operations:
 * - editTask, addTask, deleteTask, duplicateTask
 * - moveTask, moveTaskToColumn, moveTaskToTop/Up/Down/Bottom
 * - insertTaskBefore/After
 * - updateTaskFromStrikethroughDeletion
 *
 * @module commands/CardCommands
 */

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, IncomingMessage, MessageHandler } from './interfaces';
import {
    EditCardMessage,
    AddCardMessage,
    AddCardAtPositionMessage,
    DeleteCardMessage,
    DuplicateCardMessage,
    InsertCardBeforeMessage,
    InsertCardAfterMessage,
    MoveCardMessage,
    MoveCardToColumnMessage,
    MoveCardToTopMessage,
    MoveCardUpMessage,
    MoveCardDownMessage,
    MoveCardToBottomMessage,
    UpdateCardFromStrikethroughDeletionMessage
} from '../core/bridge/MessageTypes';
import { findColumn } from '../actions/helpers';
import { CardActions } from '../actions';
import { logger } from '../utils/logger';

/**
 * Task Commands Handler
 *
 * Processes all task-related messages from the webview.
 */
export class CardCommands extends SwitchBasedCommand {
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
        'editTask': (msg, ctx) => this.handleEditCard(msg as EditCardMessage, ctx),
        'addTask': (msg, ctx) => this.handleAddCard(msg as AddCardMessage, ctx),
        'addTaskAtPosition': (msg, ctx) => this.handleAddCardAtPosition(msg as AddCardAtPositionMessage, ctx),
        'deleteTask': (msg, ctx) => this.handleDeleteCard(msg as DeleteCardMessage, ctx),
        'duplicateTask': (msg, ctx) => this.handleDuplicateCard(msg as DuplicateCardMessage, ctx),
        'insertTaskBefore': (msg, ctx) => this.handleInsertCardBefore(msg as InsertCardBeforeMessage, ctx),
        'insertTaskAfter': (msg, ctx) => this.handleInsertCardAfter(msg as InsertCardAfterMessage, ctx),
        'moveTask': (msg, ctx) => this.handleMoveCard(msg as MoveCardMessage, ctx),
        'moveTaskToColumn': (msg, ctx) => this.handleMoveCardToColumn(msg as MoveCardToColumnMessage, ctx),
        'moveTaskToTop': (msg, ctx) => this.handleMoveCardToTop(msg as MoveCardToTopMessage, ctx),
        'moveTaskUp': (msg, ctx) => this.handleMoveCardUp(msg as MoveCardUpMessage, ctx),
        'moveTaskDown': (msg, ctx) => this.handleMoveCardDown(msg as MoveCardDownMessage, ctx),
        'moveTaskToBottom': (msg, ctx) => this.handleMoveCardToBottom(msg as MoveCardToBottomMessage, ctx),
        'updateTaskFromStrikethroughDeletion': (msg, ctx) => this.handleUpdateCardFromStrikethroughDeletion(msg as UpdateCardFromStrikethroughDeletionMessage, ctx)
    };

    // ============= TASK HANDLERS =============
    // NOTE: Column include file content is synced automatically by BoardSyncHandler._propagateEditsToIncludeFiles()
    // which runs when emitBoardChanged is called (via performBoardAction). No manual sync needed here.

    /**
     * Handle editTask message - complex with include handling
     */
    private async handleEditCard(message: EditCardMessage, context: CommandContext): Promise<CommandResult> {
        await this.executeAction(
            context,
            CardActions.update(message.taskId, message.columnId, message.taskData),
            { sendUpdates: false }
        );

        return this.success();
    }

    /**
     * Handle addTask message
     */
    private async handleAddCard(message: AddCardMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.add(message.columnId, message.taskData)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to add task');
    }

    /**
     * Handle addTaskAtPosition message
     */
    private async handleAddCardAtPosition(message: AddCardAtPositionMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.add(message.columnId, message.taskData, message.insertionIndex)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to add task');
    }

    /**
     * Handle deleteTask message
     */
    private async handleDeleteCard(message: DeleteCardMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.remove(message.taskId, message.columnId),
            { sendUpdates: false }
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to delete task');
    }

    /**
     * Handle duplicateTask message
     */
    private async handleDuplicateCard(message: DuplicateCardMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.duplicate(message.taskId, message.columnId)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to duplicate task');
    }

    /**
     * Handle insertTaskBefore message
     */
    private async handleInsertCardBefore(message: InsertCardBeforeMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.insertBefore(message.taskId, message.columnId)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to insert task');
    }

    /**
     * Handle insertTaskAfter message
     */
    private async handleInsertCardAfter(message: InsertCardAfterMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.insertAfter(message.taskId, message.columnId)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to insert task');
    }

    /**
     * Handle moveTask message
     */
    private async handleMoveCard(message: MoveCardMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.move(message.taskId, message.fromColumnId, message.toColumnId, message.newIndex)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskToColumn message
     */
    private async handleMoveCardToColumn(message: MoveCardToColumnMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.moveToColumn(message.taskId, message.fromColumnId, message.toColumnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskToTop message
     */
    private async handleMoveCardToTop(message: MoveCardToTopMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.moveToTop(message.taskId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskUp message
     */
    private async handleMoveCardUp(message: MoveCardUpMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.moveUp(message.taskId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskDown message
     */
    private async handleMoveCardDown(message: MoveCardDownMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.moveDown(message.taskId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskToBottom message
     */
    private async handleMoveCardToBottom(message: MoveCardToBottomMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.moveToBottom(message.taskId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle updateTaskFromStrikethroughDeletion message
     */
    private async handleUpdateCardFromStrikethroughDeletion(message: UpdateCardFromStrikethroughDeletionMessage, context: CommandContext): Promise<CommandResult> {
        const { taskId, columnId, newContent } = message;

        const board = context.getCurrentBoard();
        if (!board) {
            logger.error('[CardCommands] No current board available for strikethrough deletion');
            return this.failure('No current board available');
        }

        const column = findColumn(board, columnId);
        const task = column?.tasks.find(t => t.id === taskId);
        if (!task) {
            return this.failure('Task not found');
        }

        await this.executeAction(
            context,
            CardActions.update(taskId, columnId, { content: newContent }),
            { sendUpdates: false }
        );

        return this.success();
    }
}
