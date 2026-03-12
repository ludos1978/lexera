#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function repoRequire(specifier) {
  const repoRoot = path.resolve(__dirname, '../../');
  const resolved = require.resolve(specifier, {
    paths: [
      path.join(repoRoot, 'ludos-sync'),
      path.join(repoRoot, 'ludos-sync', 'dist'),
      path.join(repoRoot, 'shared'),
      repoRoot,
    ],
  });
  return require(resolved);
}

const { resolveTaskTemporals, isArchivedOrDeleted } = repoRequire('@ludos/shared');
const { IcalMapper } = require(path.resolve(__dirname, '../../ludos-sync/dist/mappers/IcalMapper.js'));

function isBoundaryChar(ch) {
  return !ch || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '(' || ch === '[' || ch === '{' || ch === '>';
}

function normalizeTemporalBangPrefix(text) {
  const source = String(text || '');
  if (!source || source.indexOf('!') === -1) return source;
  let out = '';
  for (let idx = 0; idx < source.length; idx += 1) {
    const ch = source.charAt(idx);
    if (ch !== '!') {
      out += ch;
      continue;
    }
    const prev = idx === 0 ? '' : source.charAt(idx - 1);
    const next = idx + 1 < source.length ? source.charAt(idx + 1) : '';
    const nextCode = next ? next.charCodeAt(0) : 0;
    const nextIsAlphaNum =
      (nextCode >= 48 && nextCode <= 57) ||
      (nextCode >= 65 && nextCode <= 90) ||
      (nextCode >= 97 && nextCode <= 122);
    if (isBoundaryChar(prev) && nextIsAlphaNum) {
      out += '@';
      continue;
    }
    out += ch;
  }
  return out;
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  const result = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  result.setHours(0, 0, 0, 0);
  return result;
}

function computeDisplayDate(event, resolved) {
  if (!event) return '';
  const start = resolved && resolved.effectiveDate instanceof Date ? formatDate(resolved.effectiveDate) : '';
  if (resolved && resolved.temporal && resolved.temporal.timeSlot) {
    return start ? `${start} ${resolved.temporal.timeSlot.replace(/^@/, '')}` : resolved.temporal.timeSlot.replace(/^@/, '');
  }
  if (resolved && typeof resolved.effectiveWeek === 'number' && typeof resolved.effectiveWeekday === 'undefined') {
    const end = event.dtend ? formatDate(parseDateOnly(event.dtend) ? new Date(parseDateOnly(event.dtend).getTime() - 86400000) : null) : '';
    return start && end ? `${start} - ${end}` : start;
  }
  return event.due ? formatDate(parseDateOnly(event.due)) : start;
}

function calendarTaskFromResolved(board, column, card, resolved, occurrence) {
  const summarySource = resolved && resolved.lineContent ? resolved.lineContent : String(card.content || '').split('\n')[0] || '';
  const summary = IcalMapper.cleanSummary(summarySource) || summarySource.trim() || '(empty task)';
  const event = IcalMapper.buildEvent(
    `dashboard-${board.boardId}-${card.id}-${occurrence}`,
    summary,
    resolved.effectiveDate,
    resolved.temporal,
    resolved.effectiveWeek,
    resolved.effectiveWeekday,
    !!card.checked,
    [column.title || ''],
    column.title || '',
    '19700101T000000Z'
  );
  if (!event) return null;

  const effectiveDate = resolved && resolved.effectiveDate instanceof Date ? new Date(resolved.effectiveDate) : null;
  if (effectiveDate) effectiveDate.setHours(0, 0, 0, 0);

  let dueDate = '';
  if (event.due) {
    const due = parseDateOnly(event.due);
    dueDate = formatDate(due);
  } else if (effectiveDate) {
    dueDate = formatDate(effectiveDate);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueBase = dueDate ? parseDateOnly(dueDate.replace(/-/g, '')) || parseDateOnly(String(event.due || '')) : effectiveDate;
  const isOverdue = !!overdueBase && overdueBase.getTime() < today.getTime() && !card.checked;

  return {
    boardId: board.boardId,
    boardTitle: board.boardTitle || '',
    filePath: board.filePath || '',
    columnTitle: column.title || '',
    columnIndex: column.columnIndex,
    rowIndex: column.rowIndex,
    stackIndex: column.stackIndex,
    colLocalIndex: column.colLocalIndex,
    cardId: card.id,
    cardContent: card.content || '',
    checked: !!card.checked,
    summary,
    lineContent: resolved.lineContent || '',
    temporalTag: resolved.temporal && resolved.temporal.tag ? resolved.temporal.tag : '',
    effectiveDate: effectiveDate ? formatDate(effectiveDate) : '',
    dueDate,
    dtstart: event.dtstart || '',
    dtend: event.dtend || '',
    timeSlot: resolved.temporal && resolved.temporal.timeSlot ? resolved.temporal.timeSlot : '',
    displayDate: computeDisplayDate(event, resolved),
    isOverdue,
  };
}

function extractBoardTasks(board) {
  const results = [];
  const columns = Array.isArray(board.columns) ? board.columns : [];
  for (const column of columns) {
    if (!column || isArchivedOrDeleted(String(column.title || ''))) continue;
    const normalizedColumnTitle = normalizeTemporalBangPrefix(column.title || '');
    const cards = Array.isArray(column.cards) ? column.cards : [];
    for (const card of cards) {
      if (!card || isArchivedOrDeleted(String(card.content || ''))) continue;
      const normalizedContent = normalizeTemporalBangPrefix(card.content || '');
      const resolved = resolveTaskTemporals(normalizedContent, normalizedColumnTitle || null);
      if (!Array.isArray(resolved) || resolved.length === 0) continue;
      for (let index = 0; index < resolved.length; index += 1) {
        const task = calendarTaskFromResolved(board, column, card, resolved[index], index);
        if (task) results.push(task);
      }
    }
  }
  return results;
}

async function main() {
  const raw = await readStdin();
  const payload = raw ? JSON.parse(raw) : {};
  const boards = Array.isArray(payload.boards) ? payload.boards : [];
  const results = [];

  for (const board of boards) {
    results.push(...extractBoardTasks(board));
  }

  process.stdout.write(JSON.stringify({ results }));
}

main().catch((error) => {
  const message = error && error.stack ? error.stack : String(error);
  process.stderr.write(message + '\n');
  process.exit(1);
});
