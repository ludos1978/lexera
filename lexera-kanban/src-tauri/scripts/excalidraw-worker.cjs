const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const KNOWN_BROWSER_PATHS = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

function resolveFromRepo(specifier, repoRoot) {
  // React 18+ omits UMD subpaths from package.json `exports`, so
  // require.resolve('react/umd/...') throws even though the file is on disk.
  // Fall back to a direct lookup under <repoRoot>/node_modules/<specifier>.
  try {
    return require.resolve(specifier, { paths: [repoRoot] });
  } catch (err) {
    const directPath = path.join(repoRoot, 'node_modules', specifier);
    if (fs.existsSync(directPath)) return directPath;
    throw err;
  }
}

function getBrowserExecutable() {
  const envPath = String(process.env.BROWSER_EXECUTABLE_PATH || '').trim();
  if (envPath && fs.existsSync(envPath)) return envPath;

  const known = KNOWN_BROWSER_PATHS[process.platform] || [];
  for (const candidate of known) {
    if (fs.existsSync(candidate)) return candidate;
  }

  try {
    const candidate = chromium.executablePath();
    if (candidate && fs.existsSync(candidate)) return candidate;
  } catch (err) {
    // Fall through to the explicit error below.
  }

  throw new Error('No Chromium/Chrome executable found for Excalidraw rendering');
}

async function loadScene(inputPath) {
  const source = await fs.promises.readFile(inputPath, 'utf8');
  const parsed = JSON.parse(source);
  if (!parsed || !Array.isArray(parsed.elements)) {
    throw new Error('Invalid Excalidraw JSON file');
  }
  return {
    elements: parsed.elements || [],
    appState: parsed.appState || {},
    files: parsed.files || {},
  };
}

async function renderSvg(inputPath, outputPath, repoRoot) {
  const scene = await loadScene(inputPath);
  const reactPath = resolveFromRepo('react/umd/react.production.min.js', repoRoot);
  const reactDomPath = resolveFromRepo('react-dom/umd/react-dom.production.min.js', repoRoot);
  const excalidrawPath = resolveFromRepo('@excalidraw/excalidraw/dist/excalidraw.production.min.js', repoRoot);
  const excalidrawAssetPath = pathToFileURL(path.dirname(excalidrawPath) + path.sep).href;
  const executablePath = getBrowserExecutable();

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await page.addInitScript(function (assetPath) {
      window.EXCALIDRAW_ASSET_PATH = assetPath;
    }, excalidrawAssetPath);
    await page.setContent('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>', {
      waitUntil: 'domcontentloaded',
    });
    await page.addScriptTag({ path: reactPath });
    await page.addScriptTag({ path: reactDomPath });
    await page.addScriptTag({ path: excalidrawPath });

    const svg = await page.evaluate(async function (payload) {
      if (!window.ExcalidrawLib || typeof window.ExcalidrawLib.exportToSvg !== 'function') {
        throw new Error('Excalidraw exportToSvg API is not available');
      }
      const hasContent = Array.isArray(payload.elements) && payload.elements.length > 0;
      const exportAppState = Object.assign({}, payload.appState || {}, {
        exportWithDarkMode: false,
        exportBackground: false,
        exportPadding: hasContent ? 0 : 20,
      });
      const svgNode = await window.ExcalidrawLib.exportToSvg({
        elements: payload.elements || [],
        appState: exportAppState,
        files: payload.files || {},
      });
      return svgNode.outerHTML;
    }, scene);

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, svg, 'utf8');
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  const repoRoot = process.argv[4];

  if (!inputPath || !outputPath || !repoRoot) {
    throw new Error('Usage: node excalidraw-worker.cjs <input> <output> <repo-root>');
  }

  await renderSvg(inputPath, outputPath, repoRoot);
}

main().catch(function (err) {
  const message = err && err.message ? err.message : String(err);
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
});
