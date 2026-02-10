/**
 * Process Commands
 *
 * Handles background process status and control:
 * - getProcessesStatus
 * - requestMediaIndexScan
 * - cancelMediaIndexScan
 * - checkIframeUrl
 * - checkFileExists
 *
 * @module commands/ProcessCommands
 */

import { SwitchBasedCommand, CommandContext, CommandMetadata, CommandResult, MessageHandler } from './interfaces';
import { WorkspaceMediaIndex, MediaIndexScanScope } from '../services/WorkspaceMediaIndex';
import { configService } from '../services/ConfigurationService';
import { CheckFileExistsMessage, CheckIframeUrlMessage } from '../core/bridge/MessageTypes';
import * as https from 'https';
import * as http from 'http';

/**
 * Process Commands Handler
 *
 * Processes background process control messages from the webview.
 * Uses SwitchBasedCommand for automatic dispatch and error handling.
 */
export class ProcessCommands extends SwitchBasedCommand {
    readonly metadata: CommandMetadata = {
        id: 'process-commands',
        name: 'Process Commands',
        description: 'Handles background process status and control',
        messageTypes: [
            'getProcessesStatus',
            'requestMediaIndexScan',
            'cancelMediaIndexScan',
            'checkIframeUrl',
            'checkFileExists'
        ],
        priority: 100
    };

    /**
     * Handler mapping for message dispatch
     */
    protected handlers: Record<string, MessageHandler> = {
        'getProcessesStatus': async (_msg, _ctx) => {
            await this.handleGetProcessesStatus();
            return this.success();
        },
        'requestMediaIndexScan': async (_msg, ctx) => {
            await this.handleRequestMediaIndexScan(ctx);
            return this.success();
        },
        'cancelMediaIndexScan': async (_msg, _ctx) => {
            await this.handleCancelMediaIndexScan();
            return this.success();
        },
        'checkIframeUrl': async (msg, _ctx) => {
            this.handleCheckIframeUrl((msg as CheckIframeUrlMessage).url);
            return this.success();
        },
        'checkFileExists': async (msg, ctx) => {
            await this.handleCheckFileExists(msg as CheckFileExistsMessage, ctx);
            return this.success();
        }
    };

    // ============= PROCESS STATUS HANDLERS =============

    /**
     * Handle get processes status request
     * Returns current status of all background processes
     */
    private async handleGetProcessesStatus(): Promise<void> {
        const mediaIndex = WorkspaceMediaIndex.getInstance();

        // Initialize if needed to load existing database from disk
        if (mediaIndex && !mediaIndex.isInitialized()) {
            await mediaIndex.initialize();
        }

        const status = mediaIndex ? mediaIndex.getStatus() : {
            isInitialized: false,
            isScanning: false,
            hasScanned: false,
            totalFiles: 0,
            byType: {}
        };

        this.postMessage({
            type: 'processesStatus',
            mediaIndex: status
        });
    }

    /**
     * Handle request to start media index scan
     * Starts scan with progress notification
     */
    private async handleRequestMediaIndexScan(context: CommandContext): Promise<void> {
        const mediaIndex = WorkspaceMediaIndex.getInstance();
        if (!mediaIndex) {
            console.warn('[ProcessCommands] MediaIndex not available');
            return;
        }

        // Notify frontend scan is starting
        this.postMessage({ type: 'mediaIndexScanStarted' });

        try {
            // Initialize if needed
            if (!mediaIndex.isInitialized()) {
                await mediaIndex.initialize();
            }

            const scope = configService.getConfig('mediaIndexScanScope', 'allWorkspaces') as MediaIndexScanScope;
            const registry = context.getFileRegistry ? context.getFileRegistry() : undefined;
            const scanOptions = WorkspaceMediaIndex.buildScanOptions(scope, registry);
            // Start scan with progress
            const filesIndexed = await mediaIndex.scanWithProgress(scanOptions);
            const stats = mediaIndex.getStats();

            this.postMessage({
                type: 'mediaIndexScanCompleted',
                filesIndexed,
                totalFiles: stats.totalFiles
            });
        } catch (error) {
            console.error('[ProcessCommands] Scan failed:', error);
            // Scan was cancelled or failed
            this.postMessage({ type: 'mediaIndexScanCancelled' });
        }
    }

    /**
     * Handle request to cancel media index scan
     */
    private async handleCancelMediaIndexScan(): Promise<void> {
        const mediaIndex = WorkspaceMediaIndex.getInstance();
        if (mediaIndex) {
            mediaIndex.cancelScan();
        }

        this.postMessage({ type: 'mediaIndexScanCancelled' });
    }

    /**
     * Handle iframe URL preflight check.
     * Performs a HEAD request to detect X-Frame-Options or CSP frame-ancestors
     * headers that would block iframe embedding.
     * Responds with iframeUrlCheckResult message.
     */
    private handleCheckIframeUrl(url: string): void {
        if (!url) return;

        const respond = (blocked: boolean) =>
            this.postMessage({ type: 'iframeUrlCheckResult', url, blocked });

        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            respond(false);
            return;
        }

        const transport = parsedUrl.protocol === 'https:' ? https : http;
        const req = transport.request(parsedUrl, { method: 'HEAD', timeout: 5000 }, (res) => {
            const headers = res.headers;

            // Check X-Frame-Options
            const xfo = headers['x-frame-options'];
            if (xfo) {
                const val = (typeof xfo === 'string' ? xfo : xfo[0]).toUpperCase();
                if (val === 'DENY' || val === 'SAMEORIGIN') {
                    respond(true);
                    return;
                }
            }

            // Check Content-Security-Policy frame-ancestors
            const csp = headers['content-security-policy'];
            if (csp) {
                const cspStr = typeof csp === 'string' ? csp : csp.join('; ');
                const faMatch = cspStr.match(/frame-ancestors\s+([^;]+)/i);
                if (faMatch) {
                    const ancestors = faMatch[1].trim().toLowerCase();
                    if (ancestors === "'none'" || ancestors === "'self'" || !ancestors.includes('*')) {
                        respond(true);
                        return;
                    }
                }
            }

            respond(false);
        });

        req.on('error', () => respond(false));
        req.on('timeout', () => { req.destroy(); respond(false); });
        req.end();
    }

    /**
     * Handle file existence preflight check for webview inline file embeds.
     * Resolves relative paths against include context / active document via FileManager.
     */
    private async handleCheckFileExists(message: CheckFileExistsMessage, context: CommandContext): Promise<void> {
        const requestId = message.requestId;
        const originalPath = (message.path || '').trim();
        const includeDir = (message.includeDir || '').trim();

        if (!requestId) {
            return;
        }

        const respond = (exists: boolean, resolvedPath?: string, error?: string) => {
            this.postMessage({
                type: 'fileExistsCheckResult',
                requestId,
                path: originalPath,
                exists,
                resolvedPath,
                error
            });
        };

        if (!originalPath) {
            respond(false, undefined, 'Missing file path');
            return;
        }

        const lower = originalPath.toLowerCase();
        if (
            lower.startsWith('http://') ||
            lower.startsWith('https://') ||
            lower.startsWith('data:') ||
            lower.startsWith('blob:') ||
            lower.startsWith('vscode-webview://')
        ) {
            respond(true, originalPath);
            return;
        }

        let normalizedPath = originalPath;
        try {
            normalizedPath = decodeURIComponent(normalizedPath);
        } catch {
            // Keep undecoded path fallback
        }
        normalizedPath = normalizedPath.split(/[?#]/)[0];

        if (!normalizedPath) {
            respond(false, undefined, `Invalid file path: ${originalPath}`);
            return;
        }

        try {
            const resolution = await context.fileManager.resolveFilePath(
                normalizedPath,
                includeDir ? { includeDir } : undefined
            );

            if (!resolution) {
                respond(false, undefined, `Unable to resolve path: ${normalizedPath}`);
                return;
            }

            if (!resolution.exists) {
                respond(false, resolution.resolvedPath, `File not found: ${resolution.resolvedPath}`);
                return;
            }

            respond(true, resolution.resolvedPath);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            respond(false, undefined, errorMessage);
        }
    }
}
