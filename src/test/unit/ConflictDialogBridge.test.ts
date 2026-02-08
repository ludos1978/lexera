import { ConflictDialogBridge } from '../../services/ConflictDialogBridge';

describe('ConflictDialogBridge snapshot token guard', () => {
    it('resolves normally when the resolution snapshot token matches', async () => {
        const bridge = new ConflictDialogBridge('panel-test');
        let outboundMessage: any;

        const pending = bridge.showConflict(
            (message: any) => {
                outboundMessage = message;
                return true;
            },
            {
                conflictType: 'external_changes',
                files: [],
                openMode: 'external_change',
                snapshotToken: 'snapshot-1'
            }
        );

        bridge.handleResolution(
            outboundMessage.conflictId,
            {
                cancelled: false,
                perFileResolutions: [{ path: '/tmp/file.md', action: 'overwrite' }]
            },
            'snapshot-1'
        );

        await expect(pending).resolves.toEqual({
            cancelled: false,
            perFileResolutions: [{ path: '/tmp/file.md', action: 'overwrite' }],
            snapshotToken: 'snapshot-1'
        });
    });

    it('fails closed when the resolution snapshot token does not match', async () => {
        const bridge = new ConflictDialogBridge('panel-test');
        let outboundMessage: any;

        const pending = bridge.showConflict(
            (message: any) => {
                outboundMessage = message;
                return true;
            },
            {
                conflictType: 'external_changes',
                files: [],
                openMode: 'external_change',
                snapshotToken: 'snapshot-1'
            }
        );

        bridge.handleResolution(
            outboundMessage.conflictId,
            {
                cancelled: false,
                perFileResolutions: [{ path: '/tmp/file.md', action: 'overwrite' }]
            },
            'snapshot-2'
        );

        await expect(pending).resolves.toEqual({
            cancelled: true,
            perFileResolutions: [],
            snapshotToken: 'snapshot-2'
        });
    });
});
