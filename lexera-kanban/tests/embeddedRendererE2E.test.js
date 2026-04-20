import { describe, it, expect } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const workerPath = resolve(repoRoot, 'lexera-kanban', 'src-tauri', 'scripts', 'excalidraw-worker.cjs');

// ── Precheck: excalidraw worker dependencies ────────────────────────────

function excalidrawCanRun() {
  if (!existsSync(workerPath)) return { ok: false, reason: 'worker script missing' };
  const required = [
    'playwright',
    'react/umd/react.production.min.js',
    'react-dom/umd/react-dom.production.min.js',
    '@excalidraw/excalidraw/dist/excalidraw.production.min.js',
  ];
  for (const spec of required) {
    try {
      require.resolve(spec, { paths: [repoRoot] });
    } catch (e) {
      // Direct-path fallback mirrors worker behaviour.
      const direct = resolve(repoRoot, 'node_modules', spec);
      if (!existsSync(direct)) return { ok: false, reason: 'missing ' + spec };
    }
  }
  const macBrowsers = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  const linuxBrowsers = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  const winBrowsers = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const knownBrowsers = process.platform === 'darwin' ? macBrowsers
    : process.platform === 'win32' ? winBrowsers
    : linuxBrowsers;
  const hasKnownBrowser = knownBrowsers.some((p) => existsSync(p));
  let playwrightBrowser = false;
  try {
    const { chromium } = require('playwright');
    const p = chromium.executablePath();
    if (p && existsSync(p)) playwrightBrowser = true;
  } catch (e) { /* noop */ }
  if (!hasKnownBrowser && !playwrightBrowser) {
    return { ok: false, reason: 'no Chromium/Chrome executable found' };
  }
  return { ok: true };
}

function drawioCanRun() {
  try {
    execFileSync('drawio', ['--version'], { stdio: 'ignore', timeout: 5000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'drawio CLI not on PATH' };
  }
}

const excali = excalidrawCanRun();
const drawio = drawioCanRun();

// ── Minimal fixtures ─────────────────────────────────────────────────────

const MINIMAL_EXCALIDRAW = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'https://excalidraw.com',
  elements: [
    {
      id: 'r1',
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 120,
      height: 80,
      angle: 0,
      strokeColor: '#000000',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: 0,
      link: null,
      locked: false,
    },
  ],
  appState: { viewBackgroundColor: '#ffffff', gridSize: null },
  files: {},
});

const MINIMAL_DRAWIO = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="test">
  <diagram name="Page">
    <mxGraphModel dx="800" dy="600" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="Hello" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="120" height="60" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

// ── Excalidraw worker E2E ────────────────────────────────────────────────

describe.skipIf(!excali.ok)('excalidraw worker — end-to-end', () => {
  it('renders a minimal .excalidraw scene into a valid SVG (~30s budget)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lexera-excali-e2e-'));
    const input = join(dir, 'scene.excalidraw');
    const output = join(dir, 'scene.svg');
    writeFileSync(input, MINIMAL_EXCALIDRAW, 'utf8');

    try {
      await execFileAsync('node', [workerPath, input, output, repoRoot], { timeout: 60_000 });
      expect(existsSync(output)).toBe(true);
      const svg = readFileSync(output, 'utf8');
      expect(svg).toContain('<svg');
      expect(svg).toMatch(/<\/svg>\s*$/);
      expect(svg.length).toBeGreaterThan(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});

if (!excali.ok) {
  // Emit a single passing placeholder so the file is not silently empty.
  describe('excalidraw worker — skipped', () => {
    it.skip('skipped: ' + excali.reason, () => { /* skipped */ });
  });
}

// ── Drawio CLI E2E ───────────────────────────────────────────────────────

describe.skipIf(!drawio.ok)('drawio CLI — end-to-end', () => {
  it('renders a minimal .drawio XML into a valid SVG (~30s budget)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lexera-drawio-e2e-'));
    const input = join(dir, 'graph.drawio');
    const output = join(dir, 'graph.svg');
    writeFileSync(input, MINIMAL_DRAWIO, 'utf8');

    try {
      await execFileAsync(
        'drawio',
        ['--export', '--format', 'svg', '--output', output, input],
        { timeout: 60_000 }
      );
      expect(existsSync(output)).toBe(true);
      const svg = readFileSync(output, 'utf8');
      expect(svg).toContain('<svg');
      expect(svg.length).toBeGreaterThan(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});

if (!drawio.ok) {
  describe('drawio CLI — skipped', () => {
    it.skip('skipped: ' + drawio.reason, () => { /* skipped */ });
  });
}
