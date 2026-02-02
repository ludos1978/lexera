/**
 * ConflictResolver — Per-panel conflict identity and panelId accessor.
 *
 * PANEL ISOLATION:
 * Each panel gets its own ConflictResolver instance via PanelContext.
 * Used by UnifiedChangeHandler to group files by panel.
 *
 * NOTE: All dialog methods have been moved to dedicated services:
 * - External changes → UnifiedChangeHandler + ConflictDialogBridge (webview dialog)
 * - Pre-save conflicts → KanbanFileService + ConflictDialogBridge (webview dialog)
 * - Panel close → UnsavedChangesService (VS Code native dialog)
 */
export class ConflictResolver {
    private readonly _panelId: string;

    constructor(panelId: string) {
        this._panelId = panelId;
    }

    get panelId(): string {
        return this._panelId;
    }
}
