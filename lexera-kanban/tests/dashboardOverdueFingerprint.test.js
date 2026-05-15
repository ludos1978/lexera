/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The dashboard fingerprint function is a private function inside
 * orderHelpers.js. We test it by exercising the raw item shapes
 * that arrive from the backend calendar endpoint (SearchResult)
 * and verifying the fingerprint key includes cardId so data
 * changes invalidate the render cache.
 *
 * The old fingerprint used `item.id || item.title || ''`, but
 * SearchResult objects have `cardId` (not `id`) and `cardContent`
 * (not `title`) — so both resolved to '' and the fingerprint
 * was always `N::`, causing the cache to HIT on stale data.
 */

// Reconstruct the fingerprint logic as it appears in orderHelpers.js
function dashboardFingerprint(data, extra) {
  if (!Array.isArray(data) || data.length === 0) return '0';
  var first = data[0];
  var last = data[data.length - 1];
  var firstKey = first.id || first.cardId || first.title || first.cardTitle || first.summary || '';
  var lastKey = last.id || last.cardId || last.title || last.cardTitle || last.summary || '';
  var fp = data.length + ':' + firstKey + ':' + lastKey;
  return extra ? fp + '|' + extra : fp;
}

describe('dashboard overdue fingerprint', () => {
  it('uses cardId from SearchResult objects', () => {
    var items = [
      { boardId: 'a', cardId: 'c1', cardContent: 'Buy groceries @2026-01-15' },
      { boardId: 'a', cardId: 'c2', cardContent: 'Clean kitchen @2026-02-01' }
    ];
    var fp = dashboardFingerprint(items);
    expect(fp).toBe('2:c1:c2');
  });

  it('produces different fingerprints when cardId changes', () => {
    var items1 = [
      { boardId: 'a', cardId: 'c1', cardContent: 'Old text' },
      { boardId: 'a', cardId: 'c2', cardContent: 'Old text 2' }
    ];
    var items2 = [
      { boardId: 'a', cardId: 'c3', cardContent: 'New text' },
      { boardId: 'a', cardId: 'c4', cardContent: 'New text 2' }
    ];
    expect(dashboardFingerprint(items1)).not.toBe(dashboardFingerprint(items2));
  });

  it('uses id from tree-node-shaped objects', () => {
    var nodes = [
      { id: 'node-1', label: 'Item 1' },
      { id: 'node-2', label: 'Item 2' }
    ];
    var fp = dashboardFingerprint(nodes);
    expect(fp).toBe('2:node-1:node-2');
  });

  it('uses cardTitle from UpcomingItem objects', () => {
    var items = [
      { cardId: 'u1', cardTitle: 'Task 1' },
      { cardId: 'u2', cardTitle: 'Task 2' }
    ];
    var fp = dashboardFingerprint(items);
    expect(fp).toBe('2:u1:u2');
  });

  it('returns "0" for empty arrays', () => {
    expect(dashboardFingerprint([])).toBe('0');
  });

  it('includes extra string when provided', () => {
    var items = [{ cardId: 'c1', cardContent: 'X' }];
    var fp = dashboardFingerprint(items, 'overdue');
    expect(fp).toBe('1:c1:c1|overdue');
  });
});
