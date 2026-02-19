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
            'editCard',
            'addCard',
            'addCardAtPosition',
            'deleteCard',
            'duplicateCard',
            'insertCardBefore',
            'insertCardAfter',
            'moveCard',
            'moveCardToColumn',
            'moveCardToTop',
            'moveCardUp',
            'moveCardDown',
            'moveCardToBottom',
            'updateCardFromStrikethroughDeletion'
        ],
        priority: 100
    };

    protected handlers: Record<string, MessageHandler> = {
        'editCard': (msg, ctx) => this.handleEditCard(msg as EditCardMessage, ctx),
        'addCard': (msg, ctx) => this.handleAddCard(msg as AddCardMessage, ctx),
        'addCardAtPosition': (msg, ctx) => this.handleAddCardAtPosition(msg as AddCardAtPositionMessage, ctx),
        'deleteCard': (msg, ctx) => this.handleDeleteCard(msg as DeleteCardMessage, ctx),
        'duplicateCard': (msg, ctx) => this.handleDuplicateCard(msg as DuplicateCardMessage, ctx),
        'insertCardBefore': (msg, ctx) => this.handleInsertCardBefore(msg as InsertCardBeforeMessage, ctx),
        'insertCardAfter': (msg, ctx) => this.handleInsertCardAfter(msg as InsertCardAfterMessage, ctx),
        'moveCard': (msg, ctx) => this.handleMoveCard(msg as MoveCardMessage, ctx),
        'moveCardToColumn': (msg, ctx) => this.handleMoveCardToColumn(msg as MoveCardToColumnMessage, ctx),
        'moveCardToTop': (msg, ctx) => this.handleMoveCardToTop(msg as MoveCardToTopMessage, ctx),
        'moveCardUp': (msg, ctx) => this.handleMoveCardUp(msg as MoveCardUpMessage, ctx),
        'moveCardDown': (msg, ctx) => this.handleMoveCardDown(msg as MoveCardDownMessage, ctx),
        'moveCardToBottom': (msg, ctx) => this.handleMoveCardToBottom(msg as MoveCardToBottomMessage, ctx),
        'updateCardFromStrikethroughDeletion': (msg, ctx) => this.handleUpdateCardFromStrikethroughDeletion(msg as UpdateCardFromStrikethroughDeletionMessage, ctx)
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
            CardActions.update(message.cardId, message.columnId, message.cardData),
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
            CardActions.add(message.columnId, message.cardData)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to add task');
    }

    /**
     * Handle addTaskAtPosition message
     */
    private async handleAddCardAtPosition(message: AddCardAtPositionMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.add(message.columnId, message.cardData, message.insertionIndex)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to add task');
    }

    /**
     * Handle deleteTask message
     */
    private async handleDeleteCard(message: DeleteCardMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.remove(message.cardId, message.columnId),
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
            CardActions.duplicate(message.cardId, message.columnId)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to duplicate task');
    }

    /**
     * Handle insertTaskBefore message
     */
    private async handleInsertCardBefore(message: InsertCardBeforeMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.insertBefore(message.cardId, message.columnId)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to insert task');
    }

    /**
     * Handle insertTaskAfter message
     */
    private async handleInsertCardAfter(message: InsertCardAfterMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.insertAfter(message.cardId, message.columnId)
        );
        return result.success ? this.success(result.result) : this.failure(result.error || 'Failed to insert task');
    }

    /**
     * Handle moveTask message
     */
    private async handleMoveCard(message: MoveCardMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.move(message.cardId, message.fromColumnId, message.toColumnId, message.newIndex)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskToColumn message
     */
    private async handleMoveCardToColumn(message: MoveCardToColumnMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.moveToColumn(message.cardId, message.fromColumnId, message.toColumnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskToTop message
     */
    private async handleMoveCardToTop(message: MoveCardToTopMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.moveToTop(message.cardId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskUp message
     */
    private async handleMoveCardUp(message: MoveCardUpMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.moveUp(message.cardId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskDown message
     */
    private async handleMoveCardDown(message: MoveCardDownMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.moveDown(message.cardId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle moveTaskToBottom message
     */
    private async handleMoveCardToBottom(message: MoveCardToBottomMessage, context: CommandContext): Promise<CommandResult> {
        const result = await this.executeAction(
            context,
            CardActions.moveToBottom(message.cardId, message.columnId)
        );
        return result.success ? this.success() : this.failure(result.error || 'Failed to move task');
    }

    /**
     * Handle updateTaskFromStrikethroughDeletion message
     */
    private async handleUpdateCardFromStrikethroughDeletion(message: UpdateCardFromStrikethroughDeletionMessage, context: CommandContext): Promise<CommandResult> {
        const { cardId, columnId, newContent } = message;

        const board = context.getCurrentBoard();
        if (!board) {
            logger.error('[CardCommands] No current board available for strikethrough deletion');
            return this.failure('No current board available');
        }

        const column = findColumn(board, columnId);
        const task = column?.cards.find(t => t.id === cardId);
        if (!task) {
            return this.failure('Task not found');
        }

        await this.executeAction(
            context,
            CardActions.update(cardId, columnId, { content: newContent }),
            { sendUpdates: false }
        );

        return this.success();
    }
}
