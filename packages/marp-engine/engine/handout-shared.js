const defaultOptions = {
  layout: 'portrait',
  slidesPerPage: 1,
  direction: 'horizontal',
  includeWritingSpace: false,
  writingSpaceLines: 6,
  slideNumbering: true,
  pageSize: 'A4',
  noteFormat: 'markdown'
};

function getOptionsFromEnv(extraDefaults) {
  const base = { ...defaultOptions, ...extraDefaults };
  return {
    ...base,
    layout: process.env.MARP_HANDOUT_LAYOUT || base.layout,
    slidesPerPage: parseInt(process.env.MARP_HANDOUT_SLIDES_PER_PAGE || '1', 10),
    direction: process.env.MARP_HANDOUT_DIRECTION || base.direction,
    includeWritingSpace: process.env.MARP_HANDOUT_WRITING_SPACE === 'true',
    slideNumbering: process.env.MARP_HANDOUT_SLIDE_NUMBERING !== 'false',
    pageSize: process.env.MARP_HANDOUT_PAGE_SIZE || base.pageSize,
    notesPosition: process.env.MARP_HANDOUT_NOTES_POSITION || base.notesPosition || 'below',
    outputPdf: process.env.MARP_HANDOUT_OUTPUT_PDF === 'true'
  };
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNotes(notes, compact) {
  let text;
  if (Array.isArray(notes)) {
    if (notes.length === 0) return '<p class="no-notes">No presenter notes</p>';
    text = notes.join('\n\n');
  } else {
    text = notes;
  }

  if (!text || text.trim() === '') {
    return '<p class="no-notes">No presenter notes</p>';
  }

  const html = text
    .split('\n\n')
    .map(paragraph => {
      if (paragraph.startsWith('- ')) {
        const items = paragraph.split('\n').map(line =>
          `<li>${escapeHtml(line.replace(/^- /, ''))}</li>`
        ).join('');
        return `<ul${compact ? ' class="compact"' : ''}>${items}</ul>`;
      }
      return `<p>${escapeHtml(paragraph)}</p>`;
    })
    .join('');

  if (Array.isArray(notes)) {
    return `<div class="notes-markdown ${compact ? 'compact' : ''}">${html}</div>`;
  }
  return html;
}

function createWritingSpace(options) {
  const lines = Array(options.writingSpaceLines || 6)
    .fill('')
    .map(() => '<div class="writing-line"></div>')
    .join('');

  return `
    <div class="marp-handout-writing-space">
      <h4>Additional Notes:</h4>
      <div class="writing-lines">${lines}</div>
    </div>
  `;
}

function createHandoutPage(slideHtml, notes, slideNumber, options) {
  const notesHtml = formatNotes(notes);
  const writingSpace = options.includeWritingSpace ? createWritingSpace(options) : '';
  const slideNumberEl = options.slideNumbering ? `<div class="slide-number">${slideNumber}</div>` : '';
  const layoutClass = options.layout === 'landscape' ? 'marp-handout-landscape' : '';

  return `
    <div class="marp-handout-page ${layoutClass}" data-slide="${slideNumber}">
      <div class="marp-handout-slide-container">
        <div class="marp-handout-slide-wrapper">
          ${slideHtml}
        </div>
        ${slideNumberEl}
      </div>
      <div class="marp-handout-notes-container">
        <h3>Notes</h3>
        ${notesHtml}
        ${writingSpace}
      </div>
    </div>
  `;
}

function createMultiSlidePage(slides, notes, startIdx, options) {
  const slideGrids = slides.map((slide, i) => {
    const slideNumber = startIdx + i + 1;
    const slideNotes = notes[i] || (Array.isArray(notes[0]) ? [] : '');

    return `
      <div class="marp-handout-multi-slide-item">
        <div class="marp-handout-slide-mini">
          ${slide}
          <div class="slide-number-mini">${slideNumber}</div>
        </div>
        <div class="marp-handout-notes-mini">
          ${formatNotes(slideNotes, true)}
        </div>
      </div>
    `;
  }).join('');

  const directionClass = options.slidesPerPage === 2 ? `marp-handout-${options.direction || 'horizontal'}` : '';
  return `
    <div class="marp-handout-page marp-handout-multi">
      <div class="marp-handout-grid marp-handout-grid-${options.slidesPerPage} ${directionClass}">
        ${slideGrids}
      </div>
    </div>
  `;
}

function buildHandoutPages(slides, notes, options) {
  if (options.slidesPerPage > 1) {
    const pages = [];
    const perPage = options.slidesPerPage;
    for (let i = 0; i < slides.length; i += perPage) {
      pages.push(createMultiSlidePage(
        slides.slice(i, i + perPage),
        notes.slice(i, i + perPage),
        i,
        options
      ));
    }
    return pages;
  }
  return slides.map((slide, idx) => createHandoutPage(slide, notes[idx], idx + 1, options));
}

function wrapInDocument(pages, css, options) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentation Handout</title>
  <style>
${css}
${getHandoutStyles(options)}
  </style>
</head>
<body>
  <div class="marp-handout-document">
${pages.join('\n')}
  </div>
</body>
</html>`;
}

function getHandoutStyles(options) {
  const isPortrait = options.layout === 'portrait';
  const pageSize = options.pageSize || 'A4';
  const pageHeight = isPortrait ? '277mm' : '190mm';

  return `
    @page {
      size: ${pageSize} ${isPortrait ? 'portrait' : 'landscape'};
      margin: 10mm;
    }

    html, body {
      margin: 0;
      padding: 0;
      background: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .marp-handout-document {
      width: 100%;
      max-width: ${isPortrait ? '210mm' : '297mm'};
      margin: 0 auto;
      padding: 0;
    }

    .marp-handout-page {
      page-break-after: always;
      break-after: page;
      display: flex;
      flex-direction: ${isPortrait ? 'column' : 'row'};
      gap: 5mm;
      padding: 5mm;
      box-sizing: border-box;
      min-height: ${pageHeight};
      background: white;
    }

    .marp-handout-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }

    .marp-handout-page.marp-handout-multi {
      display: block;
      height: ${pageHeight};
    }

    .marp-handout-slide-container {
      flex: 0 0 ${isPortrait ? '45%' : '55%'};
      border: 2px solid #333;
      overflow: hidden;
      position: relative;
      background: white;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .marp-handout-slide-wrapper {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .marp-handout-slide-wrapper > svg,
    .marp-handout-slide-wrapper > div.marpit > svg {
      width: 100% !important;
      height: auto !important;
      max-height: 100%;
    }

    .slide-number {
      position: absolute;
      bottom: 5px;
      right: 10px;
      background: #333;
      color: white;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: bold;
      z-index: 10;
    }

    .marp-handout-notes-container {
      flex: 1;
      padding: 5mm;
      background: #fafafa;
      border: 1px solid #ddd;
      overflow: visible;
      font-size: 11pt;
      line-height: 1.5;
    }

    .marp-handout-notes-container h3 {
      margin: 0 0 3mm 0;
      padding-bottom: 2mm;
      border-bottom: 2px solid #333;
      font-size: 12pt;
      font-weight: bold;
    }

    .marp-handout-notes-container p {
      margin: 2mm 0;
    }

    .no-notes {
      color: #999;
      font-style: italic;
    }

    .notes-markdown, .notes-plain {
      font-size: 10pt;
    }

    .marp-handout-writing-space {
      margin-top: 5mm;
      padding-top: 3mm;
      border-top: 1px dashed #ccc;
    }

    .marp-handout-writing-space h4 {
      margin: 0 0 3mm 0;
      font-size: 10pt;
      color: #666;
    }

    .writing-lines {
      display: flex;
      flex-direction: column;
      gap: 6mm;
    }

    .writing-line {
      border-bottom: 1px solid #ccc;
      height: 5mm;
    }

    .marp-handout-multi .marp-handout-grid {
      display: grid;
      gap: 5mm;
      height: 100%;
      width: 100%;
    }

    .marp-handout-grid-2 {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr 1fr;
    }
    .marp-handout-grid-3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
    .marp-handout-grid-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
    .marp-handout-grid-6 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; }

    .marp-handout-multi-slide-item {
      display: flex;
      flex-direction: column;
      border: 1px solid #ddd;
      overflow: hidden;
      height: 100%;
    }

    .marp-handout-grid-2.marp-handout-horizontal .marp-handout-multi-slide-item {
      flex-direction: row !important;
    }

    .marp-handout-grid-2.marp-handout-horizontal .marp-handout-slide-mini {
      flex: 0 0 50% !important;
      max-width: 50%;
    }

    .marp-handout-grid-2.marp-handout-horizontal .marp-handout-notes-mini {
      flex: 1 !important;
    }

    .marp-handout-grid-2.marp-handout-vertical .marp-handout-multi-slide-item {
      flex-direction: column !important;
      gap: 3mm;
    }

    .marp-handout-grid-2.marp-handout-vertical .marp-handout-slide-mini {
      flex: 0 0 auto !important;
      width: 100%;
      aspect-ratio: 16 / 9;
      border: 1px solid #333;
      box-sizing: border-box;
    }

    .marp-handout-grid-2.marp-handout-vertical .marp-handout-slide-mini svg {
      width: 100% !important;
      height: auto !important;
      max-height: 100%;
      display: block;
    }

    .marp-handout-grid-2.marp-handout-vertical .marp-handout-notes-mini {
      flex: 1 1 auto !important;
      overflow-y: auto;
      background: #f8f8f8;
      padding: 2mm;
    }

    .marp-handout-slide-mini {
      flex: 0 0 60%;
      position: relative;
      overflow: hidden;
      background: white;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .marp-handout-slide-mini svg {
      width: 100% !important;
      height: auto !important;
      max-height: 100%;
    }

    .slide-number-mini {
      position: absolute;
      bottom: 2px;
      right: 5px;
      font-size: 9px;
      background: #333;
      color: white;
      padding: 1px 4px;
      border-radius: 2px;
    }

    .marp-handout-notes-mini {
      flex: 1;
      padding: 3mm;
      background: #f8f8f8;
      font-size: 8pt;
      line-height: 1.3;
      overflow: hidden;
    }

    @media print {
      html, body {
        width: 100%;
        height: 100%;
      }

      .marp-handout-page {
        min-height: 0;
        height: ${pageHeight};
        box-sizing: border-box;
      }

      .marp-handout-page.marp-handout-multi {
        height: ${pageHeight};
        display: block;
      }

      .marp-handout-multi .marp-handout-grid {
        height: 100%;
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .marp-handout-multi-slide-item {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .marp-handout-grid-2.marp-handout-vertical {
        grid-template-columns: 1fr 1fr !important;
        grid-template-rows: 1fr !important;
      }

      * {
        -webkit-print-color-adjust: exact !important;
        color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  `;
}

module.exports = {
  defaultOptions,
  getOptionsFromEnv,
  escapeHtml,
  formatNotes,
  createWritingSpace,
  createHandoutPage,
  createMultiSlidePage,
  buildHandoutPages,
  wrapInDocument,
  getHandoutStyles
};
