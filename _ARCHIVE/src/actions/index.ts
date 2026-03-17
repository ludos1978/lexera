/**
 * Actions Module - Centralized board action system
 *
 * Usage:
 *   import { ActionExecutor, CardActions, ColumnActions, BoardActions } from './actions';
 *
 *   // In a command handler:
 *   const action = CardActions.updateContent(cardId, columnId, newContent);
 *   const result = await executor.execute(action);
 */

// Core types
export { BoardAction, ActionTarget, ActionResult } from './types';

// Executor
export { ActionExecutor, ExecutorDependencies, ExecuteOptions } from './executor';

// Helpers
export {
    findColumn,
    findCardIndex,
    findColumnIndex,
    getColumnRow,
    extractNumericTag,
    findCardById,
    findColumnContainingCard,
    findCardInColumn
} from './helpers';

// Action factories (namespaced)
import * as CardActions from './card';
import * as ColumnActions from './column';
import * as BoardActions from './board';

export { CardActions, ColumnActions, BoardActions };
