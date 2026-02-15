import { XbelMapper } from './XbelMapper';

describe('XbelMapper', () => {

  const sampleXbel = `<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <folder id="folder-1">
    <title>Dev Resources</title>
    <bookmark href="https://github.com" id="bm-1">
      <title>GitHub</title>
      <desc>Code hosting platform</desc>
    </bookmark>
    <bookmark href="https://stackoverflow.com" id="bm-2">
      <title>Stack Overflow</title>
    </bookmark>
  </folder>
  <folder id="folder-2">
    <title>News</title>
    <bookmark href="https://news.ycombinator.com" id="bm-3">
      <title>Hacker News</title>
    </bookmark>
  </folder>
</xbel>`;

  describe('parseXbel', () => {
    it('should parse XBEL with folders and bookmarks', () => {
      const result = XbelMapper.parseXbel(sampleXbel);

      expect(result.folders).toHaveLength(2);

      expect(result.folders[0].id).toBe('folder-1');
      expect(result.folders[0].title).toBe('Dev Resources');
      expect(result.folders[0].bookmarks).toHaveLength(2);
      expect(result.folders[0].bookmarks[0].id).toBe('bm-1');
      expect(result.folders[0].bookmarks[0].title).toBe('GitHub');
      expect(result.folders[0].bookmarks[0].href).toBe('https://github.com');
      expect(result.folders[0].bookmarks[0].description).toBe('Code hosting platform');

      expect(result.folders[0].bookmarks[1].id).toBe('bm-2');
      expect(result.folders[0].bookmarks[1].description).toBeUndefined();

      expect(result.folders[1].title).toBe('News');
      expect(result.folders[1].bookmarks).toHaveLength(1);
    });
  });

  describe('generateXbel', () => {
    it('should generate valid XBEL XML', () => {
      const root = XbelMapper.parseXbel(sampleXbel);
      const xml = XbelMapper.generateXbel(root);

      expect(xml).toContain('xbel');
      expect(xml).toContain('Dev Resources');
      expect(xml).toContain('https://github.com');
      expect(xml).toContain('bm-1');
    });
  });

  describe('round-trip XBEL -> columns -> XBEL', () => {
    it('should preserve all data through round-trip', () => {
      const original = XbelMapper.parseXbel(sampleXbel);
      const columns = XbelMapper.xbelToColumns(original);
      const roundTrip = XbelMapper.columnsToXbel(columns);

      expect(roundTrip.folders).toHaveLength(2);
      expect(roundTrip.folders[0].title).toBe('Dev Resources');
      expect(roundTrip.folders[0].bookmarks).toHaveLength(2);
      expect(roundTrip.folders[0].bookmarks[0].title).toBe('GitHub');
      expect(roundTrip.folders[0].bookmarks[0].href).toBe('https://github.com');
      expect(roundTrip.folders[0].bookmarks[0].id).toBe('bm-1');
      expect(roundTrip.folders[0].bookmarks[0].description).toBe('Code hosting platform');
      expect(roundTrip.folders[0].bookmarks[1].id).toBe('bm-2');
      expect(roundTrip.folders[1].title).toBe('News');
    });
  });

  describe('xbelToColumns', () => {
    it('should create columns from XBEL folders', () => {
      const root = XbelMapper.parseXbel(sampleXbel);
      const columns = XbelMapper.xbelToColumns(root);

      expect(columns).toHaveLength(2);
      expect(columns[0].title).toBe('Dev Resources');
      expect(columns[0].tasks).toHaveLength(2);
      expect(columns[0].tasks[0].content).toContain('[GitHub](https://github.com "bm-1")');
      expect(columns[0].tasks[0].content).toContain('Code hosting platform');
    });
  });

  describe('columnsToXbel', () => {
    it('should skip tasks without links', () => {
      const columns = [
        {
          id: 'col-1',
          title: 'Mixed',
          tasks: [
            { id: 't-1', content: '[Link](https://example.com "id-1")' },
            { id: 't-2', content: 'Plain text task without link' },
            { id: 't-3', content: '[Another](https://test.com "id-2")' },
          ]
        }
      ];

      const result = XbelMapper.columnsToXbel(columns);
      expect(result.folders).toHaveLength(1);
      expect(result.folders[0].bookmarks).toHaveLength(2);
      expect(result.folders[0].bookmarks[0].href).toBe('https://example.com');
      expect(result.folders[0].bookmarks[1].href).toBe('https://test.com');
    });
  });

  describe('extractXbelId', () => {
    it('should extract XBEL ID from link title', () => {
      expect(XbelMapper.extractXbelId('[Title](https://url "my-xbel-id")')).toBe('my-xbel-id');
    });

    it('should return null for links without title', () => {
      expect(XbelMapper.extractXbelId('[Title](https://url)')).toBeNull();
    });

    it('should return null for plain text', () => {
      expect(XbelMapper.extractXbelId('Just a plain task')).toBeNull();
    });

    it('should return null for empty content', () => {
      expect(XbelMapper.extractXbelId('')).toBeNull();
    });
  });

  describe('mergeXbelIntoColumns', () => {
    it('should update existing bookmarks by XBEL ID', () => {
      const existing = [
        {
          id: 'col-1',
          title: 'Dev Resources',
          tasks: [
            { id: 'task-1', content: '[Old Title](https://old-url.com "bm-1")' },
          ]
        }
      ];

      const incoming = XbelMapper.parseXbel(sampleXbel);
      const merged = XbelMapper.mergeXbelIntoColumns(incoming, existing);

      expect(merged).toHaveLength(2); // Dev Resources + News
      expect(merged[0].title).toBe('Dev Resources');
      expect(merged[0].tasks).toHaveLength(2); // bm-1 updated + bm-2 added
      expect(merged[0].tasks[0].content).toContain('GitHub');
      expect(merged[0].tasks[0].content).toContain('https://github.com');
      // ID should be preserved from existing
      expect(merged[0].tasks[0].id).toBe('task-1');
    });

    it('should preserve tasks without links', () => {
      const existing = [
        {
          id: 'col-1',
          title: 'Dev Resources',
          tasks: [
            { id: 'task-1', content: '[GitHub](https://github.com "bm-1")' },
            { id: 'task-2', content: 'My local note without a link' },
          ]
        }
      ];

      const incoming = {
        folders: [
          {
            id: 'folder-1',
            title: 'Dev Resources',
            bookmarks: [
              { id: 'bm-1', title: 'GitHub', href: 'https://github.com' },
            ]
          }
        ]
      };

      const merged = XbelMapper.mergeXbelIntoColumns(incoming, existing);
      expect(merged[0].tasks).toHaveLength(2);
      expect(merged[0].tasks[1].content).toBe('My local note without a link');
    });

    it('should preserve non-synced columns', () => {
      const existing = [
        { id: 'col-1', title: 'Dev Resources', tasks: [] },
        { id: 'col-2', title: 'My Private Column', tasks: [{ id: 't-1', content: 'Private' }] },
      ];

      const incoming = {
        folders: [
          { id: 'f-1', title: 'Dev Resources', bookmarks: [] }
        ]
      };

      const merged = XbelMapper.mergeXbelIntoColumns(incoming, existing);
      expect(merged).toHaveLength(2);
      expect(merged[1].title).toBe('My Private Column');
      expect(merged[1].tasks[0].content).toBe('Private');
    });
  });
});
