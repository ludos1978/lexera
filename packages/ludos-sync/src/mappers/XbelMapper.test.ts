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

      const shopping = bb.children[0];
      expect(shopping.title).toBe('Shopping');
      expect(shopping.bookmarks).toHaveLength(0);
      expect(shopping.children).toHaveLength(2);

      const deals = shopping.children[0];
      expect(deals.title).toBe('Deals');
      expect(deals.bookmarks).toHaveLength(2);
      expect(deals.bookmarks[0].title).toBe('Amazon');
      expect(deals.bookmarks[1].title).toBe('eBay');

      const stores = shopping.children[1];
      expect(stores.title).toBe('Stores');
      expect(stores.bookmarks).toHaveLength(1);
      expect(stores.bookmarks[0].title).toBe('Walmart');

      const tech = bb.children[1];
      expect(tech.title).toBe('Tech');
      expect(tech.bookmarks).toHaveLength(1);
      expect(tech.bookmarks[0].title).toBe('GitHub');
      expect(tech.children).toHaveLength(1);

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

  describe('xbelToColumns', () => {
    it('should create one column per flat folder, each bookmark is a task', () => {
      const root = XbelMapper.parseXbel(flatXbel);
      const columns = XbelMapper.xbelToColumns(root);

      expect(columns).toHaveLength(2);

      // Dev Resources: 2 bookmarks -> 2 tasks
      expect(columns[0].title).toBe('Dev Resources');
      expect(columns[0].tasks).toHaveLength(2);
      expect(columns[0].tasks[0].content).toBe('[GitHub](https://github.com "bm-1")\nCode hosting platform');
      expect(columns[0].tasks[1].content).toBe('[Stack Overflow](https://stackoverflow.com "bm-2")');

      // News: 1 bookmark -> 1 task, no #stack (different top-level folder)
      expect(columns[1].title).toBe('News');
      expect(columns[1].tasks).toHaveLength(1);
      expect(columns[1].tasks[0].content).toBe('[Hacker News](https://news.ycombinator.com "bm-3")');
    });

    it('should flatten nested folders with full path titles and #stack', () => {
      const root = XbelMapper.parseXbel(nestedXbel);
      const columns = XbelMapper.xbelToColumns(root);

      // 4 folders with bookmarks: Deals, Stores, Tech, Frontend
      expect(columns).toHaveLength(4);

      // First column: no #stack
      expect(columns[0].title).toBe('Bookmarks Bar / Shopping / Deals');
      expect(columns[0].tasks).toHaveLength(2);
      expect(columns[0].tasks[0].content).toBe('[Amazon](https://amazon.com "bm-1")');
      expect(columns[0].tasks[1].content).toBe('[eBay](https://ebay.com "bm-2")');

      // Same two topmost segments (Bookmarks Bar / Shopping): #stack
      expect(columns[1].title).toBe('Bookmarks Bar / Shopping / Stores #stack');
      expect(columns[1].tasks).toHaveLength(1);
      expect(columns[1].tasks[0].content).toBe('[Walmart](https://walmart.com "bm-3")');

      // Different second segment (Tech vs Shopping): new stack, no #stack
      expect(columns[2].title).toBe('Bookmarks Bar / Tech');
      expect(columns[2].tasks).toHaveLength(1);
      expect(columns[2].tasks[0].content).toBe('[GitHub](https://github.com "bm-4")');

      // Same two topmost segments (Bookmarks Bar / Tech): #stack
      expect(columns[3].title).toBe('Bookmarks Bar / Tech / Frontend #stack');
      expect(columns[3].tasks).toHaveLength(1);
      expect(columns[3].tasks[0].content).toBe('[React](https://react.dev "bm-5")');
    });

    it('should not add #stack across different top-level folders', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <folder id="f1"><title>A</title>
    <bookmark href="https://a.com" id="bm-a"><title>A Link</title></bookmark>
  </folder>
  <folder id="f2"><title>B</title>
    <bookmark href="https://b.com" id="bm-b"><title>B Link</title></bookmark>
  </folder>
</xbel>`;
      const columns = XbelMapper.xbelToColumns(XbelMapper.parseXbel(xml));
      expect(columns[0].title).toBe('A');
      expect(columns[1].title).toBe('B'); // no #stack
    });

    it('should handle folder with bookmarks at root and in children', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <folder id="f1"><title>Parent</title>
    <bookmark href="https://root.com" id="bm-root"><title>Root Bookmark</title></bookmark>
    <folder id="f2"><title>Child</title>
      <bookmark href="https://child.com" id="bm-child"><title>Child Bookmark</title></bookmark>
    </folder>
  </folder>
</xbel>`;
      const columns = XbelMapper.xbelToColumns(XbelMapper.parseXbel(xml));
      expect(columns).toHaveLength(2);

      expect(columns[0].title).toBe('Parent');
      expect(columns[0].tasks).toHaveLength(1);
      expect(columns[0].tasks[0].content).toBe('[Root Bookmark](https://root.com "bm-root")');

      expect(columns[1].title).toBe('Parent / Child');
      expect(columns[1].tasks).toHaveLength(1);
      expect(columns[1].tasks[0].content).toBe('[Child Bookmark](https://child.com "bm-child")');
    });
  });

  describe('columnsToXbel', () => {
    it('should build flat XBEL from flat columns', () => {
      const columns = [
        {
          id: 'col-1',
          title: 'Dev Resources',
          tasks: [
            { id: 't-1', content: '[GitHub](https://github.com "bm-1")' },
            { id: 't-2', content: '[Stack Overflow](https://stackoverflow.com "bm-2")' },
          ]
        },
        {
          id: 'col-2',
          title: 'News',
          tasks: [
            { id: 't-3', content: '[Hacker News](https://news.ycombinator.com "bm-3")' },
          ]
        }
      ];

      const result = XbelMapper.columnsToXbel(columns);
      expect(result.folders).toHaveLength(2);

      expect(result.folders[0].title).toBe('Dev Resources');
      expect(result.folders[0].bookmarks).toHaveLength(2);
      expect(result.folders[0].bookmarks[0].title).toBe('GitHub');
      expect(result.folders[0].bookmarks[0].href).toBe('https://github.com');
      expect(result.folders[0].bookmarks[0].id).toBe('bm-1');

      expect(result.folders[1].title).toBe('News');
      expect(result.folders[1].bookmarks).toHaveLength(1);
    });

    it('should build nested XBEL from columns with " / " paths', () => {
      const columns = [
        {
          id: 'col-1',
          title: 'Bookmarks Bar / Shopping / Deals',
          tasks: [
            { id: 't-1', content: '[Amazon](https://amazon.com "bm-1")' },
            { id: 't-2', content: '[eBay](https://ebay.com "bm-2")' },
          ]
        },
        {
          id: 'col-2',
          title: 'Bookmarks Bar / Shopping / Stores #stack',
          tasks: [
            { id: 't-3', content: '[Walmart](https://walmart.com "bm-3")' },
          ]
        },
        {
          id: 'col-3',
          title: 'Bookmarks Bar / Tech #stack',
          tasks: [
            { id: 't-4', content: '[GitHub](https://github.com "bm-4")' },
          ]
        },
      ];

      const result = XbelMapper.columnsToXbel(columns);
      expect(result.folders).toHaveLength(1);

      const bb = result.folders[0];
      expect(bb.title).toBe('Bookmarks Bar');
      expect(bb.bookmarks).toHaveLength(0);
      expect(bb.children).toHaveLength(2); // Shopping, Tech

      const shopping = bb.children[0];
      expect(shopping.title).toBe('Shopping');
      expect(shopping.children).toHaveLength(2); // Deals, Stores

      const deals = shopping.children[0];
      expect(deals.title).toBe('Deals');
      expect(deals.bookmarks).toHaveLength(2);
      expect(deals.bookmarks[0].title).toBe('Amazon');
      expect(deals.bookmarks[1].title).toBe('eBay');

      const stores = shopping.children[1];
      expect(stores.title).toBe('Stores');
      expect(stores.bookmarks).toHaveLength(1);
      expect(stores.bookmarks[0].title).toBe('Walmart');

      const tech = bb.children[1];
      expect(tech.title).toBe('Tech');
      expect(tech.bookmarks).toHaveLength(1);
      expect(tech.bookmarks[0].title).toBe('GitHub');
    });

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

    it('should preserve bookmark descriptions through columnsToXbel', () => {
      const columns = [
        {
          id: 'col-1',
          title: 'Resources',
          tasks: [
            { id: 't-1', content: '[GitHub](https://github.com "bm-1")\nCode hosting' },
          ]
        }
      ];

      const result = XbelMapper.columnsToXbel(columns);
      expect(result.folders[0].bookmarks[0].description).toBe('Code hosting');
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

      expect(roundTrip.folders).toHaveLength(1);
      const bb = roundTrip.folders[0];
      expect(bb.title).toBe('Bookmarks Bar');
      expect(bb.bookmarks).toHaveLength(0);
      expect(bb.children).toHaveLength(2);

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

      const deals = bb.children[0].children[0];
      expect(deals.title).toBe('Deals');
      expect(deals.bookmarks).toHaveLength(2);
      expect(deals.bookmarks[0].href).toBe('https://amazon.com');
    });
  });

  describe('extractFolderPath', () => {
    it('should strip #stack tag from title', () => {
      expect(XbelMapper.extractFolderPath('Bookmarks Bar / Shopping #stack')).toBe('Bookmarks Bar / Shopping');
    });

    it('should strip multiple #tags', () => {
      expect(XbelMapper.extractFolderPath('Title #stack #hidden')).toBe('Title');
    });

    it('should return title as-is when no tags', () => {
      expect(XbelMapper.extractFolderPath('Dev Resources')).toBe('Dev Resources');
    });

    it('should return empty string for empty input', () => {
      expect(XbelMapper.extractFolderPath('')).toBe('');
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

    it('should extract ID from first line of multi-line task', () => {
      const content = '[Amazon](https://amazon.com "bm-1")\nSome description';
      expect(XbelMapper.extractXbelId(content)).toBe('bm-1');
    });
  });

  describe('mergeXbelIntoColumns', () => {
    it('should update existing bookmarks by xbel-id match', () => {
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
      expect(merged[0].tasks).toHaveLength(2); // 2 bookmarks = 2 tasks
      // ID preserved for matched bookmark bm-1
      expect(merged[0].tasks[0].id).toBe('task-1');
      expect(merged[0].tasks[0].content).toContain('GitHub');
      expect(merged[0].tasks[0].content).toContain('https://github.com');
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
      expect(merged[0].tasks[0].id).toBe('task-1');
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

    it('should merge nested XBEL columns by folder path', () => {
      const existing = [
        {
          id: 'col-deals',
          title: 'Bookmarks Bar / Shopping / Deals',
          tasks: [
            { id: 'task-old-1', content: '[Amazon](https://amazon.com "bm-1")' },
          ]
        },
        {
          id: 'col-tech',
          title: 'Bookmarks Bar / Tech #stack',
          tasks: [
            { id: 'task-old-2', content: '[GitHub](https://github.com "bm-4")' },
          ]
        },
        {
          id: 'col-local',
          title: 'My Notes',
          tasks: [
            { id: 'task-local', content: 'My local note' },
          ]
        },
      ];

      const incoming = XbelMapper.parseXbel(nestedXbel);
      const merged = XbelMapper.mergeXbelIntoColumns(incoming, existing);

      // 4 synced columns + 1 local column
      expect(merged).toHaveLength(5);

      // Deals column preserved ID
      const dealsCol = merged.find(c => XbelMapper.extractFolderPath(c.title) === 'Bookmarks Bar / Shopping / Deals');
      expect(dealsCol).toBeDefined();
      expect(dealsCol!.id).toBe('col-deals');
      expect(dealsCol!.tasks).toHaveLength(2); // Amazon + eBay
      expect(dealsCol!.tasks[0].id).toBe('task-old-1'); // preserved ID for bm-1

      // Tech column preserved ID
      const techCol = merged.find(c => XbelMapper.extractFolderPath(c.title) === 'Bookmarks Bar / Tech');
      expect(techCol).toBeDefined();
      expect(techCol!.id).toBe('col-tech');
      expect(techCol!.tasks[0].id).toBe('task-old-2'); // preserved ID for bm-4

      // Local column preserved
      const localCol = merged.find(c => c.title === 'My Notes');
      expect(localCol).toBeDefined();
      expect(localCol!.tasks[0].content).toBe('My local note');
    });

    it('should add new columns for new XBEL folders', () => {
      const existing = [
        {
          id: 'col-1',
          title: 'Bookmarks Bar / Shopping / Deals',
          tasks: [
            { id: 'task-1', content: '[Amazon](https://amazon.com "bm-1")' },
          ]
        },
      ];

      const incoming = XbelMapper.parseXbel(nestedXbel);
      const merged = XbelMapper.mergeXbelIntoColumns(incoming, existing);

      // Should have 4 columns: Deals (existing), Stores (new), Tech (new), Frontend (new)
      expect(merged).toHaveLength(4);
    });
  });

  describe('sync cycle stability', () => {
    it('should not grow columns through repeated sync cycles', () => {
      const incoming1 = XbelMapper.parseXbel(nestedXbel);
      const merged1 = XbelMapper.mergeXbelIntoColumns(incoming1, []);
      const colCount = merged1.length;

      // Cycle 2: board -> XBEL -> parse -> merge
      const xbel1 = XbelMapper.columnsToXbel(merged1);
      const xml1 = XbelMapper.generateXbel(xbel1);
      const incoming2 = XbelMapper.parseXbel(xml1);
      const merged2 = XbelMapper.mergeXbelIntoColumns(incoming2, merged1);
      expect(merged2).toHaveLength(colCount);

      // Cycle 3
      const xbel2 = XbelMapper.columnsToXbel(merged2);
      const xml2 = XbelMapper.generateXbel(xbel2);
      const incoming3 = XbelMapper.parseXbel(xml2);
      const merged3 = XbelMapper.mergeXbelIntoColumns(incoming3, merged2);
      expect(merged3).toHaveLength(colCount);
    });

    it('should not grow columns with mixed synced and non-synced columns', () => {
      const incoming1 = XbelMapper.parseXbel(nestedXbel);
      const existingBoard = [
        { id: 'local-col', title: 'My Notes', tasks: [{ id: 'local-t', content: 'A plain note' }] },
      ];
      const merged1 = XbelMapper.mergeXbelIntoColumns(incoming1, existingBoard);
      const colCount = merged1.length;

      for (let i = 0; i < 5; i++) {
        const xbel = XbelMapper.columnsToXbel(merged1);
        const xml = XbelMapper.generateXbel(xbel);
        const incoming = XbelMapper.parseXbel(xml);
        const merged = XbelMapper.mergeXbelIntoColumns(incoming, merged1);
        expect(merged).toHaveLength(colCount);
      }
    });

    it('should stabilize with evolving board state across cycles', () => {
      const incoming1 = XbelMapper.parseXbel(nestedXbel);
      let board = [
        { id: 'local-col', title: 'TODO', tasks: [{ id: 'lt', content: 'My todo' }] },
      ];

      board = XbelMapper.mergeXbelIntoColumns(incoming1, board);
      const count1 = board.length;

      for (let i = 0; i < 5; i++) {
        const xbel = XbelMapper.columnsToXbel(board);
        const xml = XbelMapper.generateXbel(xbel);
        const incoming = XbelMapper.parseXbel(xml);
        board = XbelMapper.mergeXbelIntoColumns(incoming, board);
        expect(board).toHaveLength(count1);
      }
    });

    it('should preserve task IDs across sync cycles', () => {
      const incoming1 = XbelMapper.parseXbel(nestedXbel);
      let board = XbelMapper.mergeXbelIntoColumns(incoming1, []);

      // Capture task IDs from first sync
      const initialIds = board.flatMap(c => c.tasks.map(t => t.id));

      // Multiple sync cycles
      for (let i = 0; i < 3; i++) {
        const xbel = XbelMapper.columnsToXbel(board);
        const xml = XbelMapper.generateXbel(xbel);
        const incoming = XbelMapper.parseXbel(xml);
        board = XbelMapper.mergeXbelIntoColumns(incoming, board);
      }

      // Task IDs should be preserved
      const finalIds = board.flatMap(c => c.tasks.map(t => t.id));
      expect(finalIds).toEqual(initialIds);
    });

    it('should not duplicate tasks within columns through sync cycles', () => {
      const incoming1 = XbelMapper.parseXbel(nestedXbel);
      let board = XbelMapper.mergeXbelIntoColumns(incoming1, []);

      // Capture initial task counts per column
      const initialTaskCounts = board.map(c => c.tasks.length);

      for (let i = 0; i < 5; i++) {
        const xbel = XbelMapper.columnsToXbel(board);
        const xml = XbelMapper.generateXbel(xbel);
        const incoming = XbelMapper.parseXbel(xml);
        board = XbelMapper.mergeXbelIntoColumns(incoming, board);

        const taskCounts = board.map(c => c.tasks.length);
        expect(taskCounts).toEqual(initialTaskCounts);
      }
    });
  });
});
