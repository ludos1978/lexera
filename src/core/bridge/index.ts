/**
 * Bridge Exports
 *
 * Unified webview communication layer with typed messages.
 */

// Message type definitions
export {
    // Base types
    BaseMessage,
    RequestMessage,
    ResponseMessage,

    // Outgoing messages (Backend → Frontend)
    BoardUpdateMessage,
    FocusTarget,
    UpdateColumnContentMessage,
    UpdateCardContentMessage,
    UndoRedoStatusMessage,
    FileInfoMessage,
    OperationStartedMessage,
    OperationProgressMessage,
    OperationCompletedMessage,
    StopEditingRequestMessage,
    UnfoldColumnsRequestMessage,
    ExportResultMessage,
    MarpThemesMessage,
    MarpStatusMessage,
    ShowMessageMessage,
    TrackedFilesDebugInfoMessage,
    TrackedFileInfo,
    ContentVerificationResultMessage,
    FileVerificationResult,

    // Incoming messages (Frontend → Backend)
    UndoMessage,
    RedoMessage,
    RequestBoardUpdateMessage,
    BoardUpdateFromFrontendMessage,
    EditCardMessage,
    MoveCardMessage,
    AddCardMessage,
    DeleteCardMessage,
    AddColumnMessage,
    MoveColumnMessage,
    DeleteColumnMessage,
    EditColumnTitleMessage,
    EditModeStartMessage,
    EditModeEndMessage,
    EditingStoppedMessage,
    ColumnsUnfoldedMessage,
    LinkType,
    LinkIncludeContext,
    OpenLinkMessage,
    SaveBoardStateMessage,
    SaveUndoStateMessage,
    ExportMessage,
    RenderCompletedMessage,
    RenderSkippedMessage,

    // Type unions
    OutgoingMessage,
    IncomingMessage,
    OutgoingMessageType,
    IncomingMessageType,

    // Type guards
    isRequestMessage,
    isResponseMessage,
    isMessageType
} from './MessageTypes';

// WebviewBridge
export {
    WebviewBridge,
    WebviewBridgeOptions
} from './WebviewBridge';
