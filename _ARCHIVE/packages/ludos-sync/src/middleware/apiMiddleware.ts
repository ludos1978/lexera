/**
 * REST API middleware for the Ludos Dashboard.
 *
 * Exposes kanban board data over HTTP so the Tauri dashboard app
 * can display boards, search cards, and create new cards.
 *
 * URL structure:
 *   GET  /boards                              → list all boards with column summaries
 *   GET  /boards/:boardId/columns             → full column data with cards
 *   POST /boards/:boardId/columns/:colIndex/cards → add a card to a column
 *   GET  /search?q=term                       → search cards across all boards
 */

import * as crypto from 'crypto';
import { Router, Request, Response } from 'express';
import express from 'express';
import { BoardFileWatcher } from '../fileWatcher';
import { isArchivedOrDeleted } from '@ludos/shared';
import { log } from '../logger';

/**
 * Deterministic board ID from file path.
 * SHA-256 hash, first 12 hex chars. Stable and URL-safe.
 */
function boardIdFromPath(filePath: string): string {
  return crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 12);
}

/**
 * Create the REST API Express Router.
 */
export function createApiRouter(boardWatcher: BoardFileWatcher): Router {
  const router = Router();

  // CORS headers for Tauri webview
  router.use((_req: Request, res: Response, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    next();
  });

  // JSON body parsing for POST endpoints
  router.use(express.json());

  // GET /boards — list all boards with column summaries
  router.get('/boards', (_req: Request, res: Response) => {
    const allStates = boardWatcher.getAllBoardStates();
    const boards = allStates.map(state => {
      const columns = state.board.columns
        .filter(col => !isArchivedOrDeleted(col.title))
        .map((col, index) => ({
          index,
          title: col.title,
          cardCount: col.cards.filter(c => !isArchivedOrDeleted(c.content)).length,
        }));

      return {
        id: boardIdFromPath(state.filePath),
        title: state.board.title,
        filePath: state.filePath,
        lastModified: state.lastModified.toISOString(),
        columns,
      };
    });

    res.json({ boards });
  });

  // GET /boards/:boardId/columns — full column data with cards
  router.get('/boards/:boardId/columns', (req: Request, res: Response) => {
    const boardId = req.params.boardId;
    const allStates = boardWatcher.getAllBoardStates();
    const state = allStates.find(s => boardIdFromPath(s.filePath) === boardId);

    if (!state) {
      res.status(404).json({ error: 'Board not found' });
      return;
    }

    const columns = state.board.columns
      .filter(col => !isArchivedOrDeleted(col.title))
      .map((col, index) => ({
        index,
        title: col.title,
        cards: col.cards
          .filter(c => !isArchivedOrDeleted(c.content))
          .map(c => ({
            id: c.id,
            content: c.content,
            checked: c.checked || false,
          })),
      }));

    res.json({
      boardId,
      title: state.board.title,
      columns,
    });
  });

  // POST /boards/:boardId/columns/:colIndex/cards — add a card
  router.post('/boards/:boardId/columns/:colIndex/cards', async (req: Request, res: Response) => {
    const boardId = req.params.boardId;
    const colIndex = parseInt(String(req.params.colIndex), 10);
    const { content } = req.body || {};

    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "content" in request body' });
      return;
    }

    if (isNaN(colIndex) || colIndex < 0) {
      res.status(400).json({ error: 'Invalid column index' });
      return;
    }

    const allStates = boardWatcher.getAllBoardStates();
    const state = allStates.find(s => boardIdFromPath(s.filePath) === boardId);

    if (!state) {
      res.status(404).json({ error: 'Board not found' });
      return;
    }

    try {
      await boardWatcher.addCardToColumn(state.filePath, colIndex, content);
      res.status(201).json({ success: true });
    } catch (err) {
      log.error(`[API] Failed to add card:`, err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /search?q=term — search cards across all boards
  router.get('/search', (req: Request, res: Response) => {
    const query = (req.query.q as string || '').trim().toLowerCase();

    if (!query) {
      res.json({ query: '', results: [] });
      return;
    }

    const allStates = boardWatcher.getAllBoardStates();
    const results: Array<{
      boardId: string;
      boardTitle: string;
      columnTitle: string;
      columnIndex: number;
      cardContent: string;
      checked: boolean;
    }> = [];

    for (const state of allStates) {
      const boardId = boardIdFromPath(state.filePath);
      const visibleColumns = state.board.columns.filter(col => !isArchivedOrDeleted(col.title));

      for (let colIdx = 0; colIdx < visibleColumns.length; colIdx++) {
        const col = visibleColumns[colIdx];
        for (const card of col.cards) {
          if (isArchivedOrDeleted(card.content)) continue;
          if (card.content.toLowerCase().includes(query)) {
            results.push({
              boardId,
              boardTitle: state.board.title,
              columnTitle: col.title,
              columnIndex: colIdx,
              cardContent: card.content,
              checked: card.checked || false,
            });
          }
        }
      }
    }

    res.json({ query, results });
  });

  return router;
}
