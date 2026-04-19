import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadIIFE } from './load-iife.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

const mockInvoke = vi.fn();
const mockLexeraLog = vi.fn();

const mockWindow = {
  __TAURI__: { core: { invoke: mockInvoke } },
  LexeraApi: { baseUrl: 'http://localhost:9000', discover: vi.fn() },
  LexeraFileFormatRegistry: null,
};

let ExportService;

const markdownItPluginFiles = [
  'vendor/markdown-it/markdown-it.min.js',
  'vendor/markdown-it/markdown-it-image-figures-browser.js',
  'vendor/markdown-it/markdown-it-table-widths-browser.js',
];

function loadMarkdownItInto(target) {
  // Some UMD plugins assign `(this||self).markdownit*` at the sandbox root; others
  // assign via `globalThis.markdownit*`. Make sure both paths funnel into `target`.
  const sandbox = { window: target, globalThis: null, console };
  sandbox.globalThis = sandbox.window;
  vm.createContext(sandbox);
  for (const f of markdownItPluginFiles) {
    vm.runInContext(readFileSync(resolve(srcDir, f), 'utf8'), sandbox, { filename: f });
  }
  // Promote any markdown-it globals that landed on sandbox (not sandbox.window).
  for (const key of Object.keys(sandbox)) {
    if (key.toLowerCase().includes('markdown') && target[key] === undefined) {
      target[key] = sandbox[key];
    }
  }
  const rendererSource = readFileSync(resolve(srcDir, 'render/markdownRenderer.js'), 'utf8');
  vm.runInContext(rendererSource, sandbox, { filename: 'render/markdownRenderer.js' });
}

beforeAll(() => {
  const Registry = loadIIFE(
    [
      'plugins/pluginRegistry.js',
      'plugins/formats/fileFormatHelpers.js',
      'plugins/formats/drawio.js',
      'plugins/formats/excalidraw.js',
      'plugins/formats/xlsx.js',
      'plugins/formats/csv.js',
      'plugins/formats/tsv.js',
      'plugins/formats/pdf.js',
      'plugins/formats/pptx.js',
      'plugins/formats/document.js',
      'plugins/formats/epub.js',
      'plugins/formats/plaintext.js',
      'plugins/fileFormatRegistry.js',
    ],
    'LexeraFileFormatRegistry',
    { window: mockWindow, URL }
  );
  mockWindow.LexeraFileFormatRegistry = Registry;
  loadMarkdownItInto(mockWindow);
  ExportService = loadIIFE('export/exportService.js', 'ExportService', {
    window: mockWindow,
    fetch: vi.fn(),
    console: globalThis.console,
    lexeraLog: mockLexeraLog,
  });
});

beforeEach(() => {
  mockInvoke.mockReset();
  mockLexeraLog.mockReset();
  ExportService._marpEnginePathCache = undefined;
});

describe('ExportService.applyTableWidthTransform', () => {
  it('pre-renders tables with alignment markers to HTML with width styles', () => {
    const md = '| h1 | h2 |\n|:---|---:|\n| a  | b  |';
    const out = ExportService.applyTableWidthTransform(md);
    expect(out).toContain('table-layout: fixed');
    expect(out).toMatch(/width:\s*50(\.0+)?%/);
    expect(out).toContain('<th');
  });

  it('leaves tables without alignment markers as markdown', () => {
    const md = '| h1 | h2 |\n|---|---|\n| a  | b  |';
    const out = ExportService.applyTableWidthTransform(md);
    expect(out).toBe(md);
  });

  it('is a no-op for content without pipes', () => {
    const out = ExportService.applyTableWidthTransform('hello world');
    expect(out).toBe('hello world');
  });
});

describe('ExportService.applyImageFigureTransform', () => {
  it('wraps standalone image-with-title in <figure>/<figcaption>', () => {
    const md = '\n![pic](a.png "my caption")\n';
    const out = ExportService.applyImageFigureTransform(md);
    expect(out).toContain('<figure>');
    expect(out).toContain('<figcaption>my caption</figcaption>');
  });

  it('leaves images without title attrs alone', () => {
    const md = '![pic](a.png)';
    const out = ExportService.applyImageFigureTransform(md);
    expect(out).toBe(md);
  });
});

describe('ExportService.applyListSplitSafetyNet', () => {
  it('inserts <!-- --> breaker between list items separated by blank line', () => {
    const md = '- one\n\n- two\n';
    const out = ExportService.applyListSplitSafetyNet(md);
    expect(out).toContain('<!-- -->');
    const lines = out.split('\n');
    const breakerIdx = lines.indexOf('<!-- -->');
    expect(breakerIdx).toBeGreaterThan(-1);
    expect(lines[breakerIdx + 1]).toBe('- two');
  });

  it('leaves tight lists alone', () => {
    const md = '- one\n- two\n';
    const out = ExportService.applyListSplitSafetyNet(md);
    expect(out).not.toContain('<!-- -->');
  });

  it('does not double-insert if breaker already present', () => {
    const md = '- one\n\n<!-- -->\n- two\n';
    const out = ExportService.applyListSplitSafetyNet(md);
    const breakers = (out.match(/<!--\s*-->/g) || []).length;
    expect(breakers).toBe(1);
  });
});

describe('ExportService.preprocessDiagramsForExport — PlantUML', () => {
  it('replaces ```plantuml fence with image reference and calls render_plantuml_code', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'render_plantuml_code') {
        return Promise.resolve({ success: true, outputPath: args.opts.targetPath });
      }
      return Promise.resolve(null);
    });
    const md = 'intro\n\n```plantuml\nA -> B\n```\n\nafter';
    const result = await ExportService.preprocessDiagramsForExport(md, '/tmp/out', 'slides');
    expect(result.content).not.toContain('```plantuml');
    expect(result.content).toContain('![plantuml-1](slides-plantuml-1.svg)');
    expect(result.createdFiles).toContain('/tmp/out/slides-plantuml-1.svg');
    expect(mockInvoke).toHaveBeenCalledWith('render_plantuml_code', expect.objectContaining({
      opts: expect.objectContaining({ targetPath: '/tmp/out/slides-plantuml-1.svg' }),
    }));
    const payload = mockInvoke.mock.calls[0][1];
    expect(payload.opts.code).toContain('@startuml');
    expect(payload.opts.code).toContain('A -> B');
    expect(payload.opts.code).toContain('@enduml');
  });

  it('leaves content unchanged when render fails', async () => {
    mockInvoke.mockResolvedValue({ success: false, error: 'boom' });
    const md = '```plantuml\nbad\n```';
    const result = await ExportService.preprocessDiagramsForExport(md, '/tmp/out', 'slides');
    expect(result.content).toContain('```plantuml');
    expect(result.createdFiles).toHaveLength(0);
  });

  it('is a no-op when there are no plantuml fences', async () => {
    const md = 'plain text\n\nno fences';
    const result = await ExportService.preprocessDiagramsForExport(md, '/tmp/out', 'slides');
    expect(result.content).toBe(md);
    expect(result.createdFiles).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('ExportService.getMarpEnginePath', () => {
  it('calls Tauri get_marp_engine_path and caches the result', async () => {
    mockInvoke.mockResolvedValue('/abs/path/engine.js');
    const a = await ExportService.getMarpEnginePath();
    const b = await ExportService.getMarpEnginePath();
    expect(a).toBe('/abs/path/engine.js');
    expect(b).toBe('/abs/path/engine.js');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('get_marp_engine_path');
  });

  it('caches null results too (does not retry)', async () => {
    mockInvoke.mockResolvedValue(null);
    const a = await ExportService.getMarpEnginePath();
    const b = await ExportService.getMarpEnginePath();
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('caches null on invoke failure', async () => {
    mockInvoke.mockRejectedValue(new Error('nope'));
    const result = await ExportService.getMarpEnginePath();
    expect(result).toBeNull();
  });
});

describe('ExportService.applyLocalPresentationTransforms — integration', () => {
  it('chains table-widths, image-figures, and list-split when format=presentation', () => {
    const options = { format: 'presentation', mode: 'save' };
    const md = '| a | b |\n|:--|-:|\n| 1 | 2 |\n\n- x\n\n- y\n';
    const out = ExportService.applyLocalPresentationTransforms(md, options);
    expect(out).toContain('table-layout: fixed');
    expect(out).toContain('<!-- -->');
  });

  it('is a no-op in copy mode', () => {
    const options = { format: 'presentation', mode: 'copy' };
    const md = '| a | b |\n|:--|-:|\n| 1 | 2 |';
    const out = ExportService.applyLocalPresentationTransforms(md, options);
    expect(out).toBe(md);
  });

  it('is a no-op for non-presentation formats', () => {
    const options = { format: 'document', mode: 'save' };
    const md = '| a | b |\n|:--|-:|\n| 1 | 2 |';
    const out = ExportService.applyLocalPresentationTransforms(md, options);
    expect(out).toBe(md);
  });
});
