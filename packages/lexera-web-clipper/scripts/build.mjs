import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..');
const repoDir = path.resolve(packageDir, '..', '..');
const srcDir = path.join(packageDir, 'src');
const distDir = path.join(packageDir, 'dist');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function writeJson(targetPath, value) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

if (process.argv.includes('--clean')) {
  fs.rmSync(distDir, { recursive: true, force: true });
  process.exit(0);
}

const esbuildPath = path.join(repoDir, 'node_modules', 'esbuild', 'lib', 'main.js');
const esbuildModule = await import(pathToFileURL(esbuildPath).href);
const { build } = esbuildModule;

fs.rmSync(distDir, { recursive: true, force: true });

const baseManifest = JSON.parse(
  fs.readFileSync(path.join(srcDir, 'manifest.base.json'), 'utf8'),
);

const chromeDir = path.join(distDir, 'chrome');
const firefoxDir = path.join(distDir, 'firefox');

ensureDir(chromeDir);
ensureDir(firefoxDir);

const buildTargets = ['background', 'popup', 'content'];

for (const browserTarget of [chromeDir, firefoxDir]) {
  for (const entryName of buildTargets) {
    await build({
      bundle: true,
      entryPoints: [path.join(srcDir, `${entryName}.ts`)],
      format: 'iife',
      outfile: path.join(browserTarget, `${entryName}.js`),
      platform: 'browser',
      target: ['chrome120', 'firefox121', 'safari17'],
      logLevel: 'silent',
    });
  }

  copyFile(path.join(srcDir, 'popup.html'), path.join(browserTarget, 'popup.html'));
  copyFile(path.join(srcDir, 'popup.css'), path.join(browserTarget, 'popup.css'));
}

writeJson(path.join(chromeDir, 'manifest.json'), baseManifest);
writeJson(path.join(firefoxDir, 'manifest.json'), {
  ...baseManifest,
  browser_specific_settings: {
    gecko: {
      id: 'lexera-web-clipper@local',
      strict_min_version: '121.0',
    },
  },
});
