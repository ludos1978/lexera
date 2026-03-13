import { BoardFileWatcher, type BoardState } from './fileWatcher';

describe('BoardFileWatcher display names', () => {
  it('prefers explicit calendarName', () => {
    const watcher = new BoardFileWatcher();
    const name = watcher.getBoardDisplayName({
      filePath: '/tmp/example-board.md',
      calendarName: 'Configured Name',
      board: { title: 'Parsed Title' } as BoardState['board'],
      calendarSlug: 'example-board',
    } as BoardState);

    expect(name).toBe('Configured Name');
  });

  it('falls back to file basename before parsed board title', () => {
    const watcher = new BoardFileWatcher();
    const name = watcher.getBoardDisplayName({
      filePath: '/tmp/actual-board-name.md',
      board: { title: 'Row Title Accidentally Parsed As Board Title' } as BoardState['board'],
      calendarSlug: 'actual-board-name',
    } as BoardState);

    expect(name).toBe('actual-board-name');
  });
});
