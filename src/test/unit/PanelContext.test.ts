import { PanelContext } from '../../panel/PanelContext';

describe('PanelContext document URI storage', () => {
    it('uses one backing URI for lastDocumentUri and trackedDocumentUri', () => {
        const context = new PanelContext('panel-test', true);

        context.setLastDocumentUri('file:///workspace/board-a.md');
        expect(context.lastDocumentUri).toBe('file:///workspace/board-a.md');
        expect(context.trackedDocumentUri).toBe('file:///workspace/board-a.md');
        expect(context.documentUri).toBe('file:///workspace/board-a.md');

        context.setTrackedDocumentUri('file:///workspace/board-b.md');
        expect(context.lastDocumentUri).toBe('file:///workspace/board-b.md');
        expect(context.trackedDocumentUri).toBe('file:///workspace/board-b.md');
        expect(context.documentUri).toBe('file:///workspace/board-b.md');
    });

    it('clears both URI accessors when one setter clears the value', () => {
        const context = new PanelContext('panel-test', false);
        context.setLastDocumentUri('file:///workspace/board-a.md');

        context.setTrackedDocumentUri(undefined);
        expect(context.lastDocumentUri).toBeUndefined();
        expect(context.trackedDocumentUri).toBeUndefined();
        expect(context.documentUri).toBeUndefined();
    });
});
