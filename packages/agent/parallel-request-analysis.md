# Parallel Request Analysis — Lexera Kanban Frontend

## HIGH PRIORITY
- **Polling Service (pollingService.js:145-188)**: workspaces + boards + remoteBoards fetched sequentially. Can use Promise.all() — ~66% time savings (~1000ms per cycle)

## MODERATE
- **Board Load (app.js:2369-2401)**: columns + marp classes sequential. Marp classes may be independent — verify and parallelize if so (~200-300ms savings)

## ALREADY OPTIMIZED
- Dashboard file inventory: fires without await (fd72b2ba)
- File batch API: combines multiple queries into single call
- Dashboard data cache: restores on tab switch

## LOW / BY DESIGN
- Export pipeline: 3-phase (extract→transform→output) — dependencies require sequential
- Board draft restore: user dialog before rebase — can't parallelize user interaction
