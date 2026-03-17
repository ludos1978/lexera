#!/usr/bin/env node
/**
 * Handout Post-Processor for Marp
 *
 * Transforms a Marp-generated HTML presentation into handout format.
 * Can be run standalone or required as a module.
 *
 * Usage:
 *   node handout-postprocess.js input.html [output.html] [options]
 *   node handout-postprocess.js input.html --pdf output.pdf
 *
 * Options (via environment variables):
 *   MARP_HANDOUT_LAYOUT=portrait|landscape
 *   MARP_HANDOUT_SLIDES_PER_PAGE=1|2|3|4|6
 *   MARP_HANDOUT_WRITING_SPACE=true
 *   MARP_HANDOUT_OUTPUT_PDF=true
 */

const fs = require('fs');
const path = require('path');
const handout = require('./handout-shared');

let chromium = null;
try {
  chromium = require('playwright-core').chromium;
} catch (e) {
  // Playwright not available - PDF generation won't work
}

function extractSlidesAndNotes(html) {
  const slides = [];
  const notes = [];

  const svgRegex = /<svg[^>]*data-marpit-svg[^>]*>[\s\S]*?<\/svg>/gi;
  const svgMatches = html.match(svgRegex) || [];

  svgMatches.forEach(svg => {
    slides.push(svg);
  });

  const noteRegex = /<div[^>]*class="[^"]*bespoke-marp-note[^"]*"[^>]*data-index="(\d+)"[^>]*>([\s\S]*?)<\/div>/gi;
  const noteMap = new Map();
  let noteMatch;
  while ((noteMatch = noteRegex.exec(html)) !== null) {
    const index = parseInt(noteMatch[1], 10);
    const content = noteMatch[2].replace(/<[^>]+>/g, '').trim();
    noteMap.set(index, content);
  }

  const maxIndex = Math.max(...noteMap.keys(), -1);
  for (let i = 0; i <= maxIndex; i++) {
    notes.push(noteMap.get(i) || '');
  }

  if (notes.length === 0) {
    const asideNoteRegex = /<aside[^>]*class="[^"]*marp-note[^"]*"[^>]*>([\s\S]*?)<\/aside>/gi;
    while ((noteMatch = asideNoteRegex.exec(html)) !== null) {
      notes.push(noteMatch[1].trim());
    }
  }

  if (notes.length === 0) {
    const commentNoteRegex = /<!--\s*([\s\S]*?)\s*-->/g;
    let commentMatch;
    while ((commentMatch = commentNoteRegex.exec(html)) !== null) {
      const content = commentMatch[1].trim();
      if (content && !content.startsWith('$') && !content.includes('marp')) {
        notes.push(content);
      }
    }
  }

  while (notes.length < slides.length) {
    notes.push('');
  }

  return { slides, notes };
}

function extractCSS(html) {
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  const styles = [];
  let match;
  while ((match = styleRegex.exec(html)) !== null) {
    styles.push(match[1]);
  }
  return styles.join('\n');
}

function transformToHandout(inputHtml, options = {}) {
  const opts = { ...handout.defaultOptions, ...options };

  const { slides, notes } = extractSlidesAndNotes(inputHtml);
  const originalCss = extractCSS(inputHtml);

  console.log(`[Handout] Found ${slides.length} slides, ${notes.filter(n => n).length} notes`);

  if (slides.length === 0) {
    console.warn('[Handout] No slides found in HTML');
    return inputHtml;
  }

  const pages = handout.buildHandoutPages(slides, notes, opts);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentation Handout</title>
  <style>
${originalCss}
${handout.getHandoutStyles(opts)}
  </style>
</head>
<body>
  <div class="marp-handout-document">
${pages.join('\n')}
  </div>
</body>
</html>`;
}

async function generatePdf(htmlContent, outputPath, options) {
  if (!chromium) {
    throw new Error('Playwright is required for PDF generation. Install with: npm install playwright');
  }

  const isPortrait = options.layout === 'portrait';
  const pageSize = options.pageSize || 'A4';

  console.log(`[Handout] Generating PDF: ${outputPath}`);

  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };
  const browserPath = process.env.BROWSER_PATH;
  if (browserPath) {
    launchOptions.executablePath = browserPath;
  }
  const browser = await chromium.launch(launchOptions);

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle' });

    await new Promise(resolve => setTimeout(resolve, 500));

    await page.pdf({
      path: outputPath,
      format: pageSize,
      landscape: !isPortrait,
      printBackground: true,
      margin: {
        top: '10mm',
        bottom: '10mm',
        left: '10mm',
        right: '10mm'
      }
    });

    console.log(`[Handout] PDF written: ${outputPath}`);
  } finally {
    await browser.close();
  }
}

async function processFile(inputPath, outputPath, options) {
  console.log(`[Handout] Processing: ${inputPath}`);

  const inputHtml = fs.readFileSync(inputPath, 'utf-8');
  const outputHtml = transformToHandout(inputHtml, options);

  let outPath = outputPath || inputPath;
  const isPdfOutput = options.outputPdf || outPath.toLowerCase().endsWith('.pdf');

  if (isPdfOutput) {
    if (!outPath.toLowerCase().endsWith('.pdf')) {
      outPath = outPath.replace(/\.html?$/i, '.pdf');
    }
    await generatePdf(outputHtml, outPath, options);
  } else {
    fs.writeFileSync(outPath, outputHtml, 'utf-8');
    console.log(`[Handout] HTML written: ${outPath}`);
  }

  return outPath;
}

function processFileSync(inputPath, outputPath, options) {
  console.log(`[Handout] Processing: ${inputPath}`);

  const inputHtml = fs.readFileSync(inputPath, 'utf-8');
  const outputHtml = transformToHandout(inputHtml, options);

  const outPath = outputPath || inputPath;
  fs.writeFileSync(outPath, outputHtml, 'utf-8');

  console.log(`[Handout] Written: ${outPath}`);
  return outPath;
}

module.exports = {
  transformToHandout,
  processFile,
  processFileSync,
  generatePdf,
  getOptionsFromEnv: handout.getOptionsFromEnv,
  defaultOptions: handout.defaultOptions
};

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node handout-postprocess.js input.html [output.html|output.pdf]');
    console.log('       node handout-postprocess.js input.html --pdf [output.pdf]');
    console.log('');
    console.log('Environment variables:');
    console.log('  MARP_HANDOUT_LAYOUT=portrait|landscape');
    console.log('  MARP_HANDOUT_SLIDES_PER_PAGE=1|2|3|4|6');
    console.log('  MARP_HANDOUT_WRITING_SPACE=true');
    console.log('  MARP_HANDOUT_OUTPUT_PDF=true');
    console.log('  MARP_HANDOUT_PAGE_SIZE=A4|letter|legal');
    process.exit(1);
  }

  const inputPath = args[0];
  let outputPath = null;
  let forcePdf = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--pdf') {
      forcePdf = true;
    } else if (!outputPath) {
      outputPath = args[i];
    }
  }

  if (!outputPath) {
    outputPath = forcePdf
      ? inputPath.replace(/\.html?$/i, '-handout.pdf')
      : inputPath;
  }

  const options = handout.getOptionsFromEnv({ outputPdf: false });
  if (forcePdf) {
    options.outputPdf = true;
  }

  (async () => {
    try {
      await processFile(inputPath, outputPath, options);
    } catch (error) {
      console.error(`[Handout] Error: ${error.message}`);
      process.exit(1);
    }
  })();
}
