import { BoardSyncHandler } from '../../core/events/BoardSyncHandler';

describe('BoardSyncHandler include cleanup sync', () => {
    const createHandler = (options?: {
        isReady?: boolean;
        syncIncludeFilesWithBoard?: (board: any) => void;
    }) => {
        const boardStore = {
            setBoard: jest.fn()
        };
        const mainFile = {
            setCachedBoardFromWebview: jest.fn(),
            setContent: jest.fn()
        };
        const fileRegistry = {
            isReady: jest.fn(() => options?.isReady ?? true),
            getMainFile: jest.fn(() => mainFile),
            getIncludeFiles: jest.fn(() => [])
        };
        const scopedEventBus = {
            on: jest.fn(() => () => undefined)
        };
        const panelContext = {
            scopedEventBus,
            debugMode: false
        };

        const handler = new BoardSyncHandler({
            boardStore: boardStore as any,
            fileRegistry: fileRegistry as any,
            getMediaTracker: () => null,
            panelContext: panelContext as any,
            getWebviewBridge: () => null,
            syncIncludeFilesWithBoard: options?.syncIncludeFilesWithBoard
        });

        return {
            handler,
            boardStore,
            fileRegistry,
            mainFile
        };
    };

    it('syncs include registry on board changes so removed includes can be cleaned up', async () => {
        const syncIncludeFilesWithBoard = jest.fn();
        const { handler, boardStore, mainFile } = createHandler({
            syncIncludeFilesWithBoard
        });

        const board = {
            valid: true,
            title: 'Board',
            yamlHeader: '---\nkanban-plugin: board\n---',
            kanbanFooter: null,
            columns: [
                {
                    id: 'col-1',
                    title: 'Column',
                    tasks: []
                }
            ]
        };

        await (handler as any)._handleBoardChanged({
            data: {
                board,
                trigger: 'edit'
            }
        });

        expect(boardStore.setBoard).toHaveBeenCalledTimes(1);
        expect(mainFile.setCachedBoardFromWebview).toHaveBeenCalledTimes(1);
        expect(syncIncludeFilesWithBoard).toHaveBeenCalledTimes(2);
        expect(syncIncludeFilesWithBoard).toHaveBeenCalledWith(expect.objectContaining({
            columns: expect.any(Array)
        }));
    });

    it('does not attempt include cleanup sync when registry is not ready', async () => {
        const syncIncludeFilesWithBoard = jest.fn();
        const { handler, boardStore, mainFile } = createHandler({
            isReady: false,
            syncIncludeFilesWithBoard
        });

        const board = {
            valid: true,
            title: 'Board',
            yamlHeader: '---\nkanban-plugin: board\n---',
            kanbanFooter: null,
            columns: []
        };

        await (handler as any)._handleBoardChanged({
            data: {
                board,
                trigger: 'edit'
            }
        });

        expect(boardStore.setBoard).not.toHaveBeenCalled();
        expect(mainFile.setCachedBoardFromWebview).not.toHaveBeenCalled();
        expect(syncIncludeFilesWithBoard).not.toHaveBeenCalled();
    });
});
