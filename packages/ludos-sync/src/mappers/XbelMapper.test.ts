import { XbelMapper } from './XbelMapper';

describe('XbelMapper', () => {

  // Flat XBEL (no nesting) for basic tests
  const flatXbel = `<?xml version="1.0" encoding="UTF-8"?>
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

  // Nested XBEL for tree structure tests
  const nestedXbel = `<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <folder id="folder-bb">
    <title>Bookmarks Bar</title>
    <folder id="folder-shopping">
      <title>Shopping</title>
      <folder id="folder-deals">
        <title>Deals</title>
        <bookmark href="https://amazon.com" id="bm-1">
          <title>Amazon</title>
        </bookmark>
        <bookmark href="https://ebay.com" id="bm-2">
          <title>eBay</title>
        </bookmark>
      </folder>
      <folder id="folder-stores">
        <title>Stores</title>
        <bookmark href="https://walmart.com" id="bm-3">
          <title>Walmart</title>
        </bookmark>
      </folder>
    </folder>
    <folder id="folder-tech">
      <title>Tech</title>
      <bookmark href="https://github.com" id="bm-4">
        <title>GitHub</title>
      </bookmark>
      <folder id="folder-frontend">
        <title>Frontend</title>
        <bookmark href="https://react.dev" id="bm-5">
          <title>React</title>
        </bookmark>
      </folder>
    </folder>
  </folder>
</xbel>`;

  describe('parseXbel', () => {
    it('should parse flat XBEL with folders and bookmarks', () => {
      const result = XbelMapper.parseXbel(flatXbel);

      expect(result.folders).toHaveLength(2);

      expect(result.folders[0].id).toBe('folder-1');
      expect(result.folders[0].title).toBe('Dev Resources');
      expect(result.folders[0].bookmarks).toHaveLength(2);
      expect(result.folders[0].children).toHaveLength(0);
      expect(result.folders[0].bookmarks[0].id).toBe('bm-1');
      expect(result.folders[0].bookmarks[0].title).toBe('GitHub');
      expect(result.folders[0].bookmarks[0].href).toBe('https://github.com');
      expect(result.folders[0].bookmarks[0].description).toBe('Code hosting platform');

      expect(result.folders[0].bookmarks[1].id).toBe('bm-2');
      expect(result.folders[0].bookmarks[1].description).toBeUndefined();

      expect(result.folders[1].title).toBe('News');
      expect(result.folders[1].bookmarks).toHaveLength(1);
    });

    it('should preserve nested folder tree structure', () => {
      const result = XbelMapper.parseXbel(nestedXbel);

      expect(result.folders).toHaveLength(1);

      const bb = result.folders[0];
      expect(bb.id).toBe('folder-bb');
      expect(bb.title).toBe('Bookmarks Bar');
      expect(bb.bookmarks).toHaveLength(0);
      expect(bb.children).toHaveLength(2);

      // Shopping folder
      const shopping = bb.children[0];
      expect(shopping.title).toBe('Shopping');
      expect(shopping.bookmarks).toHaveLength(0);
      expect(shopping.children).toHaveLength(2);

      // Shopping/Deals
      const deals = shopping.children[0];
      expect(deals.title).toBe('Deals');
      expect(deals.bookmarks).toHaveLength(2);
      expect(deals.bookmarks[0].title).toBe('Amazon');
      expect(deals.bookmarks[1].title).toBe('eBay');

      // Shopping/Stores
      const stores = shopping.children[1];
      expect(stores.title).toBe('Stores');
      expect(stores.bookmarks).toHaveLength(1);
      expect(stores.bookmarks[0].title).toBe('Walmart');

      // Tech folder
      const tech = bb.children[1];
      expect(tech.title).toBe('Tech');
      expect(tech.bookmarks).toHaveLength(1);
      expect(tech.bookmarks[0].title).toBe('GitHub');
      expect(tech.children).toHaveLength(1);

      // Tech/Frontend
      const frontend = tech.children[0];
      expect(frontend.title).toBe('Frontend');
      expect(frontend.bookmarks).toHaveLength(1);
      expect(frontend.bookmarks[0].title).toBe('React');
    });

    it('should put root-level bookmarks into Unsorted folder', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <bookmark href="https://example.com" id="bm-root">
    <title>Example</title>
  </bookmark>
</xbel>`;
      const result = XbelMapper.parseXbel(xml);
      expect(result.folders).toHaveLength(1);
      expect(result.folders[0].title).toBe('Unsorted');
      expect(result.folders[0].bookmarks).toHaveLength(1);
      expect(result.folders[0].children).toHaveLength(0);
    });
  });

  describe('generateXbel', () => {
    it('should generate valid XBEL XML from flat structure', () => {
      const root = XbelMapper.parseXbel(flatXbel);
      const xml = XbelMapper.generateXbel(root);

      expect(xml).toContain('xbel');
      expect(xml).toContain('Dev Resources');
      expect(xml).toContain('https://github.com');
      expect(xml).toContain('bm-1');
    });

    it('should generate nested XBEL XML from tree structure', () => {
      const root = XbelMapper.parseXbel(nestedXbel);
      const xml = XbelMapper.generateXbel(root);

      // Re-parse to verify nesting is preserved
      const reparsed = XbelMapper.parseXbel(xml);
      expect(reparsed.folders).toHaveLength(1);

      const bb = reparsed.folders[0];
      expect(bb.title).toBe('Bookmarks Bar');
      expect(bb.children).toHaveLength(2);

      const shopping = bb.children[0];
      expect(shopping.title).toBe('Shopping');
      expect(shopping.children).toHaveLength(2);

      expect(shopping.children[0].title).toBe('Deals');
      expect(shopping.children[0].bookmarks).toHaveLength(2);

      expect(shopping.children[1].title).toBe('Stores');
      expect(shopping.children[1].bookmarks).toHaveLength(1);

      const tech = bb.children[1];
      expect(tech.title).toBe('Tech');
      expect(tech.bookmarks).toHaveLength(1);
      expect(tech.children).toHaveLength(1);
      expect(tech.children[0].title).toBe('Frontend');
    });
  });

  describe('round-trip XBEL -> columns -> XBEL', () => {
    it('should preserve flat data through round-trip', () => {
      const original = XbelMapper.parseXbel(flatXbel);
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

    it('should preserve nested structure through round-trip', () => {
      const original = XbelMapper.parseXbel(nestedXbel);
      const columns = XbelMapper.xbelToColumns(original);
      const roundTrip = XbelMapper.columnsToXbel(columns);

      // Verify top-level structure
      expect(roundTrip.folders).toHaveLength(1);
      const bb = roundTrip.folders[0];
      expect(bb.title).toBe('Bookmarks Bar');
      expect(bb.bookmarks).toHaveLength(0);
      expect(bb.children).toHaveLength(2);

      // Shopping subtree
      const shopping = bb.children[0];
      expect(shopping.title).toBe('Shopping');
      expect(shopping.children).toHaveLength(2);

      const deals = shopping.children[0];
      expect(deals.title).toBe('Deals');
      expect(deals.bookmarks).toHaveLength(2);
      expect(deals.bookmarks[0].id).toBe('bm-1');
      expect(deals.bookmarks[0].title).toBe('Amazon');
      expect(deals.bookmarks[1].id).toBe('bm-2');

      const stores = shopping.children[1];
      expect(stores.title).toBe('Stores');
      expect(stores.bookmarks).toHaveLength(1);
      expect(stores.bookmarks[0].id).toBe('bm-3');

      // Tech subtree
      const tech = bb.children[1];
      expect(tech.title).toBe('Tech');
      expect(tech.bookmarks).toHaveLength(1);
      expect(tech.bookmarks[0].id).toBe('bm-4');
      expect(tech.children).toHaveLength(1);

      const frontend = tech.children[0];
      expect(frontend.title).toBe('Frontend');
      expect(frontend.bookmarks).toHaveLength(1);
      expect(frontend.bookmarks[0].id).toBe('bm-5');
    });

    it('should preserve nesting through full XBEL -> columns -> XBEL -> XML round-trip', () => {
      const original = XbelMapper.parseXbel(nestedXbel);
      const columns = XbelMapper.xbelToColumns(original);
      const xbelRoot = XbelMapper.columnsToXbel(columns);
      const xml = XbelMapper.generateXbel(xbelRoot);
      const reparsed = XbelMapper.parseXbel(xml);

      const bb = reparsed.folders[0];
      expect(bb.title).toBe('Bookmarks Bar');
      expect(bb.children).toHaveLength(2);

      // Verify deep nesting survived
      const deals = bb.children[0].children[0];
      expect(deals.title).toBe('Deals');
      expect(deals.bookmarks).toHaveLength(2);
      expect(deals.bookmarks[0].href).toBe('https://amazon.com');
    });
  });

  describe('xbelToColumns', () => {
    it('should create columns from flat XBEL folders', () => {
      const root = XbelMapper.parseXbel(flatXbel);
      const columns = XbelMapper.xbelToColumns(root);

      expect(columns).toHaveLength(2);
      expect(columns[0].title).toBe('Dev Resources');
      // Flat folders: bookmarks directly in top-level -> tasks with links only (no sub-path)
      expect(columns[0].tasks).toHaveLength(1); // all bookmarks aggregated into one task
      expect(columns[0].tasks[0].content).toContain('[GitHub](https://github.com "bm-1")');
      expect(columns[0].tasks[0].content).toContain('Code hosting platform');
      expect(columns[0].tasks[0].content).toContain('[Stack Overflow](https://stackoverflow.com "bm-2")');
    });

    it('should map nested folders to tasks with sub-paths', () => {
      const root = XbelMapper.parseXbel(nestedXbel);
      const columns = XbelMapper.xbelToColumns(root);

      expect(columns).toHaveLength(1);
      expect(columns[0].title).toBe('Bookmarks Bar');

      const tasks = columns[0].tasks;
      // Shopping/Deals, Shopping/Stores, Tech (root bookmarks), Tech/Frontend
      expect(tasks).toHaveLength(4);

      // Task 0: Shopping/Deals with Amazon + eBay
      expect(tasks[0].content).toBe(
        'Shopping/Deals\n[Amazon](https://amazon.com "bm-1")\n[eBay](https://ebay.com "bm-2")'
      );

      // Task 1: Shopping/Stores with Walmart
      expect(tasks[1].content).toBe(
        'Shopping/Stores\n[Walmart](https://walmart.com "bm-3")'
      );

      // Task 2: Tech (bookmarks at Tech root, sub-path = "Tech")
      expect(tasks[2].content).toBe(
        'Tech\n[GitHub](https://github.com "bm-4")'
      );

      // Task 3: Tech/Frontend with React
      expect(tasks[3].content).toBe(
        'Tech/Frontend\n[React](https://react.dev "bm-5")'
      );
    });

    it('should handle top-level folder with direct bookmarks (no sub-path)', () => {
      const root = XbelMapper.parseXbel(flatXbel);
      const columns = XbelMapper.xbelToColumns(root);

      // Dev Resources has bookmarks directly -> task starts with link (no sub-path)
      const firstLine = columns[0].tasks[0].content.split('\n')[0];
      expect(firstLine).toMatch(/^\[/); // starts with link, not a sub-path
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

    it('should build nested folders from sub-path tasks', () => {
      const columns = [
        {
          id: 'col-1',
          title: 'Bookmarks Bar',
          tasks: [
            { id: 't-1', content: 'Shopping/Deals\n[Amazon](https://amazon.com "bm-1")\n[eBay](https://ebay.com "bm-2")' },
            { id: 't-2', content: 'Shopping/Stores\n[Walmart](https://walmart.com "bm-3")' },
            { id: 't-3', content: '[GitHub](https://github.com "bm-4")' },
          ]
        }
      ];

      const result = XbelMapper.columnsToXbel(columns);
      expect(result.folders).toHaveLength(1);

      const bb = result.folders[0];
      expect(bb.title).toBe('Bookmarks Bar');
      // GitHub is at root level (no sub-path)
      expect(bb.bookmarks).toHaveLength(1);
      expect(bb.bookmarks[0].title).toBe('GitHub');

      // Shopping folder with Deals and Stores sub-folders
      expect(bb.children).toHaveLength(1);
      const shopping = bb.children[0];
      expect(shopping.title).toBe('Shopping');
      expect(shopping.children).toHaveLength(2);

      const deals = shopping.children[0];
      expect(deals.title).toBe('Deals');
      expect(deals.bookmarks).toHaveLength(2);
      expect(deals.bookmarks[0].title).toBe('Amazon');
      expect(deals.bookmarks[1].title).toBe('eBay');

      const stores = shopping.children[1];
      expect(stores.title).toBe('Stores');
      expect(stores.bookmarks).toHaveLength(1);
    });

    it('should handle multi-link tasks with descriptions', () => {
      const columns = [
        {
          id: 'col-1',
          title: 'Resources',
          tasks: [
            { id: 't-1', content: '[GitHub](https://github.com "bm-1")\nCode hosting\n[GitLab](https://gitlab.com "bm-2")\nAlternative hosting' },
          ]
        }
      ];

      const result = XbelMapper.columnsToXbel(columns);
      const folder = result.folders[0];
      expect(folder.bookmarks).toHaveLength(2);
      expect(folder.bookmarks[0].title).toBe('GitHub');
      expect(folder.bookmarks[0].description).toBe('Code hosting');
      expect(folder.bookmarks[1].title).toBe('GitLab');
      expect(folder.bookmarks[1].description).toBe('Alternative hosting');
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

    it('should extract first ID from multi-line task with sub-path', () => {
      const content = 'Shopping/Deals\n[Amazon](https://amazon.com "bm-1")\n[eBay](https://ebay.com "bm-2")';
      expect(XbelMapper.extractXbelId(content)).toBe('bm-1');
    });
  });

  describe('extractXbelIds', () => {
    it('should extract all IDs from multi-link task', () => {
      const content = 'Shopping/Deals\n[Amazon](https://amazon.com "bm-1")\n[eBay](https://ebay.com "bm-2")';
      expect(XbelMapper.extractXbelIds(content)).toEqual(['bm-1', 'bm-2']);
    });

    it('should return empty array for plain text', () => {
      expect(XbelMapper.extractXbelIds('Just plain text')).toEqual([]);
    });

    it('should return empty array for empty content', () => {
      expect(XbelMapper.extractXbelIds('')).toEqual([]);
    });

    it('should skip links without IDs', () => {
      const content = '[Title](https://url)\n[Other](https://other "has-id")';
      expect(XbelMapper.extractXbelIds(content)).toEqual(['has-id']);
    });
  });

  describe('extractTaskSubPath', () => {
    it('should return sub-path from first line', () => {
      expect(XbelMapper.extractTaskSubPath('Shopping/Deals\n[Link](url "id")')).toBe('Shopping/Deals');
    });

    it('should return empty string when first line is a link', () => {
      expect(XbelMapper.extractTaskSubPath('[Link](url "id")')).toBe('');
    });

    it('should return empty string for empty content', () => {
      expect(XbelMapper.extractTaskSubPath('')).toBe('');
    });
  });

  describe('mergeXbelIntoColumns', () => {
    it('should update existing bookmarks by sub-path match', () => {
      const existing = [
        {
          id: 'col-1',
          title: 'Dev Resources',
          tasks: [
            { id: 'task-1', content: '[Old Title](https://old-url.com "bm-1")' },
          ]
        }
      ];

      const incoming = XbelMapper.parseXbel(flatXbel);
      const merged = XbelMapper.mergeXbelIntoColumns(incoming, existing);

      expect(merged).toHaveLength(2); // Dev Resources + News
      expect(merged[0].title).toBe('Dev Resources');
      // Both bookmarks from Dev Resources are aggregated into one task (same sub-path: empty)
      expect(merged[0].tasks).toHaveLength(1);
      expect(merged[0].tasks[0].content).toContain('GitHub');
      expect(merged[0].tasks[0].content).toContain('https://github.com');
      // ID preserved from existing (matched by empty sub-path)
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
            ],
            children: [],
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
          { id: 'f-1', title: 'Dev Resources', bookmarks: [], children: [] }
        ]
      };

      const merged = XbelMapper.mergeXbelIntoColumns(incoming, existing);
      expect(merged).toHaveLength(2);
      expect(merged[1].title).toBe('My Private Column');
      expect(merged[1].tasks[0].content).toBe('Private');
    });

    it('should merge nested XBEL by sub-path matching', () => {
      const existing = [
        {
          id: 'col-1',
          title: 'Bookmarks Bar',
          tasks: [
            { id: 'task-old-1', content: 'Shopping/Deals\n[Amazon](https://amazon.com "bm-1")' },
            { id: 'task-old-2', content: 'Tech\n[GitHub](https://github.com "bm-4")' },
            { id: 'task-local', content: 'My local note' },
          ]
        }
      ];

      const incoming = XbelMapper.parseXbel(nestedXbel);
      const merged = XbelMapper.mergeXbelIntoColumns(incoming, existing);

      expect(merged).toHaveLength(1);
      expect(merged[0].title).toBe('Bookmarks Bar');

      // 4 synced tasks + 1 local note
      expect(merged[0].tasks).toHaveLength(5);

      // Existing tasks should preserve their kanban IDs
      const dealsTask = merged[0].tasks.find(t => t.content.startsWith('Shopping/Deals'));
      expect(dealsTask).toBeDefined();
      expect(dealsTask!.id).toBe('task-old-1');
      // Content updated with both bookmarks
      expect(dealsTask!.content).toContain('[Amazon](https://amazon.com "bm-1")');
      expect(dealsTask!.content).toContain('[eBay](https://ebay.com "bm-2")');

      const techTask = merged[0].tasks.find(t => t.content.startsWith('Tech\n['));
      expect(techTask).toBeDefined();
      expect(techTask!.id).toBe('task-old-2');

      // Local note preserved
      const localTask = merged[0].tasks.find(t => t.content === 'My local note');
      expect(localTask).toBeDefined();
    });
  });

  describe('sync cycle stability', () => {
    it('should not grow columns through repeated sync cycles', () => {
      // Cycle 1: Floccus sends nested XBEL, merge into empty board
      const incoming1 = XbelMapper.parseXbel(nestedXbel);
      const merged1 = XbelMapper.mergeXbelIntoColumns(incoming1, []);
      const colCount = merged1.length;

      // Cycle 2: Board -> XBEL -> parse -> merge (simulates Floccus round-trip)
      const xbel1 = XbelMapper.columnsToXbel(merged1);
      const xml1 = XbelMapper.generateXbel(xbel1);
      const incoming2 = XbelMapper.parseXbel(xml1);
      const merged2 = XbelMapper.mergeXbelIntoColumns(incoming2, merged1);
      expect(merged2).toHaveLength(colCount);

      // Cycle 3: Another round-trip
      const xbel2 = XbelMapper.columnsToXbel(merged2);
      const xml2 = XbelMapper.generateXbel(xbel2);
      const incoming3 = XbelMapper.parseXbel(xml2);
      const merged3 = XbelMapper.mergeXbelIntoColumns(incoming3, merged2);
      expect(merged3).toHaveLength(colCount);
    });

    it('should not grow columns with mixed synced and non-synced columns', () => {
      // Board has a non-synced column + synced columns
      const incoming1 = XbelMapper.parseXbel(nestedXbel);
      const existingBoard = [
        { id: 'local-col', title: 'My Notes', tasks: [{ id: 'local-t', content: 'A plain note' }] },
      ];
      const merged1 = XbelMapper.mergeXbelIntoColumns(incoming1, existingBoard);
      const colCount = merged1.length;

      // Multiple round-trips
      for (let i = 0; i < 5; i++) {
        const xbel = XbelMapper.columnsToXbel(merged1);
        const xml = XbelMapper.generateXbel(xbel);
        const incoming = XbelMapper.parseXbel(xml);
        const merged = XbelMapper.mergeXbelIntoColumns(incoming, merged1);
        expect(merged).toHaveLength(colCount);
      }
    });

    it('should stabilize with evolving board state across cycles', () => {
      // Simulate actual fileWatcher flow: each cycle uses PREVIOUS merged result
      const incoming1 = XbelMapper.parseXbel(nestedXbel);
      let board = [
        { id: 'local-col', title: 'TODO', tasks: [{ id: 'lt', content: 'My todo' }] },
      ];

      // Cycle 1: first sync from Floccus
      board = XbelMapper.mergeXbelIntoColumns(incoming1, board);
      const count1 = board.length;

      // Subsequent cycles: board -> XBEL -> parse -> merge into PREVIOUS result
      for (let i = 0; i < 5; i++) {
        const xbel = XbelMapper.columnsToXbel(board);
        const xml = XbelMapper.generateXbel(xbel);
        const incoming = XbelMapper.parseXbel(xml);
        board = XbelMapper.mergeXbelIntoColumns(incoming, board);
        expect(board).toHaveLength(count1);
      }
    });
  });
});
