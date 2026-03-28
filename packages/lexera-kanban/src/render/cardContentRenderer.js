var LexeraCardContentRenderer = (function () {
  'use strict';
  var _deps = {};
  var _rt = typeof window !== 'undefined' && window.LexeraRuntime ? window.LexeraRuntime : null;

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      _rt = window.LexeraRuntime;
      _rt.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  function renderTitleInline(text, boardId, options) {
    var helpers = _deps.getInlineRendererHelpers ? _deps.getInlineRendererHelpers() : null;
    if (!helpers || typeof helpers.renderTitleInline !== 'function') {
      return _deps.escapeHtml ? _deps.escapeHtml(String(text || '')) : String(text || '');
    }
    return helpers.renderTitleInline(text, boardId, options);
  }

  function renderInline(text, boardId, renderState) {
    var helpers = _deps.getInlineRendererHelpers ? _deps.getInlineRendererHelpers() : null;
    if (!helpers || typeof helpers.renderInline !== 'function') {
      return _deps.escapeHtml ? _deps.escapeHtml(String(text || '')) : String(text || '');
    }
    return helpers.renderInline(text, boardId, renderState);
  }

  function isStandaloneHtmlTagLine(line) {
    return /^\s*(?:<[^>]+>)+\s*$/.test(String(line || ''));
  }

  function renderTable(lines, startIdx, boardId, renderState) {
    var headerLine = lines[startIdx].trim();
    var sepLine = lines[startIdx + 1].trim();

    function parseCells(line) {
      var parts = line.split('|');
      if (parts[0].trim() === '') parts.shift();
      if (parts.length > 0 && parts[parts.length - 1].trim() === '') parts.pop();
      return parts.map(function (c) { return c.trim(); });
    }

    var headers = parseCells(headerLine);
    var seps = parseCells(sepLine);
    var aligns = seps.map(function (s) {
      if (s.charAt(0) === ':' && s.charAt(s.length - 1) === ':') return 'center';
      if (s.charAt(s.length - 1) === ':') return 'right';
      return 'left';
    });

    var out = '<table class="md-table"><thead><tr>';
    for (var h = 0; h < headers.length; h++) {
      out += '<th style="text-align:' + aligns[h] + '">' + renderInline(headers[h], boardId, renderState) + '</th>';
    }
    out += '</tr></thead><tbody>';

    for (var r = startIdx + 2; r < lines.length; r++) {
      if (lines[r].trim().indexOf('|') !== 0) break;
      var cells = parseCells(lines[r]);
      out += '<tr>';
      for (var c = 0; c < headers.length; c++) {
        var val = c < cells.length ? cells[c] : '';
        var align = c < aligns.length ? aligns[c] : 'left';
        out += '<td style="text-align:' + align + '">' + renderInline(val, boardId, renderState) + '</td>';
      }
      out += '</tr>';
    }
    out += '</tbody></table>';
    return out;
  }

  function renderCardContent(content, boardId, renderState, options) {
    var escapeHtml = _deps.escapeHtml;
    var escapeAttr = _deps.escapeAttr;
    var buildTagStyledLineHtml = _deps.buildTagStyledLineHtml;
    var wrapRenderedLineBlockHtml = _deps.wrapRenderedLineBlockHtml;
    var DiagramRegistry = _deps.DiagramRegistry;
    var getActiveBoardId = _deps.getActiveBoardId;

    renderState = renderState || {};
    options = options || {};
    var previousNestedDepth = typeof renderState.nestedDepth === 'number' ? renderState.nestedDepth : 0;
    renderState.nestedDepth = options.nested ? previousNestedDepth + 1 : previousNestedDepth;
    try {
    var lines = content.split('\n');
    var html = '';
    var listTag = null;
    var skipLines = {};
    var footnoteDefs = renderState.footnoteDefs || (renderState.footnoteDefs = {});
    var footnoteOrder = renderState.footnoteOrder || (renderState.footnoteOrder = []);
    var abbrDefs = renderState.abbrDefs || (renderState.abbrDefs = {});

    for (var scanIdx = 0; scanIdx < lines.length; scanIdx++) {
      var footnoteMatch = lines[scanIdx].match(/^\[\^([^\]]+)\]:\s*(.*)$/);
      if (footnoteMatch) {
        var footnoteId = footnoteMatch[1];
        var textParts = [];
        if (footnoteMatch[2]) textParts.push(footnoteMatch[2]);
        skipLines[scanIdx] = true;
        var continuationIdx = scanIdx + 1;
        while (continuationIdx < lines.length) {
          var continuation = lines[continuationIdx];
          if (/^( {2,}|\t)/.test(continuation)) {
            textParts.push(continuation.replace(/^( {2,}|\t)/, ''));
            skipLines[continuationIdx] = true;
            continuationIdx++;
            continue;
          }
          if (continuation.trim() === '') {
            skipLines[continuationIdx] = true;
            continuationIdx++;
            break;
          }
          break;
        }
        footnoteDefs[footnoteId] = textParts.join(' ').trim();
        if (footnoteOrder.indexOf(footnoteId) === -1) footnoteOrder.push(footnoteId);
        scanIdx = continuationIdx - 1;
        continue;
      }
      var abbrMatch = lines[scanIdx].match(/^\*\[([^\]]+)\]:\s*(.+)$/);
      if (abbrMatch) {
        abbrDefs[abbrMatch[1]] = abbrMatch[2].trim();
        skipLines[scanIdx] = true;
      }
    }

    function closeList() {
      if (listTag) { html += '</' + listTag + '>'; listTag = null; }
    }
    function openList(tag) {
      if (listTag !== tag) { closeList(); html += '<' + tag + '>'; listTag = tag; }
    }

    for (var i = 0; i < lines.length; i++) {
      if (skipLines[i]) continue;
      var line = lines[i];
      var lineStyleSource = options.skipFirstLineTagStyle && i === 0 ? '' : line;

      var multiStartMatch = line.match(/^---:\s*(\d+)?\s*$/);
      if (multiStartMatch) {
        closeList();
        var multiColumns = [];
        var multiGrowths = [];
        var currentColumnLines = [];
        var currentGrowth = parseInt(multiStartMatch[1], 10) || 1;
        var nextIdx = i + 1;
        for (; nextIdx < lines.length; nextIdx++) {
          var multiLine = lines[nextIdx];
          var multiSplitMatch = multiLine.match(/^:--:\s*(\d+)?\s*$/);
          if (multiSplitMatch) {
            multiColumns.push(currentColumnLines.join('\n'));
            multiGrowths.push(currentGrowth);
            currentColumnLines = [];
            currentGrowth = parseInt(multiSplitMatch[1], 10) || 1;
            continue;
          }
          if (/^:---\s*$/.test(multiLine)) {
            multiColumns.push(currentColumnLines.join('\n'));
            multiGrowths.push(currentGrowth);
            break;
          }
          currentColumnLines.push(multiLine);
        }
        if (multiColumns.length > 0) {
          var multiHtml = '<div class="md-multicolumn">';
          for (var mc = 0; mc < multiColumns.length; mc++) {
            multiHtml += '<div class="md-multicolumn-column" style="flex-grow:' + multiGrowths[mc] + ';flex-basis:0">' +
              renderCardContent(multiColumns[mc], boardId, renderState, { nested: true }) +
              '</div>';
          }
          multiHtml += '</div>';
          html += wrapRenderedLineBlockHtml(multiHtml, lineStyleSource);
          i = nextIdx;
          continue;
        }
      }

      var containerMatch = line.match(/^:::\s*([a-z0-9-]+)\s*$/i);
      if (containerMatch) {
        closeList();
        var containerType = containerMatch[1].toLowerCase();
        var containerLines = [];
        i++;
        while (i < lines.length && !/^:::\s*$/.test(lines[i].trim())) {
          containerLines.push(lines[i]);
          i++;
        }
        html += buildTagStyledLineHtml('div',
          renderCardContent(containerLines.join('\n'), boardId, renderState, { nested: true }) +
          '', lineStyleSource, {
            className: 'md-container md-container-' + escapeAttr(containerType)
          });
        continue;
      }

      // Fenced code blocks: ```lang ... ```
      var fenceMatch = line.match(/^```(\w*)$/);
      if (fenceMatch) {
        closeList();
        var lang = fenceMatch[1];
        var codeLines = [];
        i++;
        while (i < lines.length && !(/^```$/.test(lines[i]))) {
          codeLines.push(lines[i]);
          i++;
        }
        var diagramPlugin = DiagramRegistry ? DiagramRegistry.findByLanguage(lang.toLowerCase()) : null;
        if (diagramPlugin) {
          var diagId = DiagramRegistry.nextId(diagramPlugin.id);
          var diagCode = codeLines.join('\n');
          html += buildTagStyledLineHtml('div',
            '<button class="embed-menu-btn diagram-menu-btn" title="Diagram actions" style="opacity:1">&#8942;</button>' +
            diagramPlugin.placeholder(diagId, diagCode),
            lineStyleSource,
            {
              className: 'diagram-overlay-container',
              attrs: 'data-diagram-type="' + escapeAttr(diagramPlugin.id) + '" data-diagram-code="' + escapeAttr(diagCode) + '"',
              styleText: 'position:relative;display:block'
            }
          );
          DiagramRegistry.enqueue(diagramPlugin.id, diagId, diagCode, boardId || (getActiveBoardId ? getActiveBoardId() : '') || '');
        } else {
          var langClass = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
          html += buildTagStyledLineHtml('pre', '<code' + langClass + '>' + escapeHtml(codeLines.join('\n')) + '</code>', lineStyleSource, {
            className: 'code-block'
          });
        }
        continue;
      }

      // Markdown tables: |col|col| with |---|---| separator
      if (line.trim().indexOf('|') === 0 && i + 1 < lines.length && /^\|[\s:]*-+/.test(lines[i + 1].trim())) {
        closeList();
        html += wrapRenderedLineBlockHtml(renderTable(lines, i, boardId, renderState), lineStyleSource);
        while (i < lines.length && lines[i].trim().indexOf('|') === 0) i++;
        i--;
        continue;
      }

      // Empty line: close list if open, add line break
      if (line.trim() === '') {
        closeList();
        html += '<br>';
        continue;
      }

      // Keep contiguous raw HTML tag lines together so block HTML wrappers
      // such as <div> ... <iframe> ... </div> survive as one DOM subtree.
      if (isStandaloneHtmlTagLine(line)) {
        closeList();
        var rawHtmlLines = [line];
        var rawHtmlIdx = i + 1;
        while (rawHtmlIdx < lines.length) {
          var candidateHtmlLine = lines[rawHtmlIdx];
          if (candidateHtmlLine.trim() === '' || !isStandaloneHtmlTagLine(candidateHtmlLine)) break;
          rawHtmlLines.push(candidateHtmlLine);
          rawHtmlIdx++;
        }
        html += buildTagStyledLineHtml('div', renderInline(rawHtmlLines.join('\n'), boardId, renderState), lineStyleSource, {
          className: 'md-raw-html-block'
        });
        i = rawHtmlIdx - 1;
        continue;
      }

      // HTML comments: render as styled span (visibility controlled by board setting)
      var commentMatch = line.match(/^<!--(.+?)-->$/);
      if (commentMatch) {
        closeList();
        html += buildTagStyledLineHtml('div', escapeHtml(commentMatch[1].trim()), lineStyleSource, {
          className: 'html-comment'
        });
        continue;
      }

      // Horizontal rule
      if (/^---+$/.test(line.trim())) {
        closeList();
        html += buildTagStyledLineHtml('hr', '', lineStyleSource, { selfClosing: true });
        continue;
      }

      // Blockquote
      var quoteMatch = line.match(/^>\s?(.*)/);
      if (quoteMatch) {
        closeList();
        html += buildTagStyledLineHtml('blockquote', renderInline(quoteMatch[1], boardId, renderState), lineStyleSource);
        continue;
      }

      // Speaker notes
      var speakerNoteMatch = line.match(/^;;\s?(.*)/);
      if (speakerNoteMatch) {
        closeList();
        html += buildTagStyledLineHtml('div', renderInline(speakerNoteMatch[1], boardId, renderState), lineStyleSource, {
          className: 'speaker-note'
        });
        continue;
      }

      // Headings
      var headingMatch = line.match(/^(#{1,3})\s+(.+)/);
      if (headingMatch) {
        closeList();
        var level = headingMatch[1].length;
        html += buildTagStyledLineHtml('h' + level, renderInline(headingMatch[2], boardId, renderState), lineStyleSource);
        continue;
      }

      // Checkbox list items (must be checked BEFORE unordered list)
      var checkMatch = line.match(/^-\s+\[([ xX])\]\s*(.*)/);
      if (checkMatch) {
        openList('ul');
        var checked = checkMatch[1] !== ' ';
        var checkedAttr = checked ? ' checked' : '';
        var strikePre = checked ? '<s>' : '';
        var strikePost = checked ? '</s>' : '';
        html += buildTagStyledLineHtml('li',
          '<input type="checkbox" class="card-checkbox" data-line="' + i + '"' + checkedAttr + '> ' + strikePre + renderInline(checkMatch[2], boardId, renderState) + strikePost,
          lineStyleSource,
          { className: 'checkbox-item' }
        );
        continue;
      }

      // Ordered list items
      var olMatch = line.match(/^\d+\.\s+(.+)/);
      if (olMatch) {
        openList('ol');
        html += buildTagStyledLineHtml('li', renderInline(olMatch[1], boardId, renderState), lineStyleSource);
        continue;
      }

      // Unordered list items
      var listMatch = line.match(/^[-*]\s+(.+)/);
      if (listMatch) {
        openList('ul');
        html += buildTagStyledLineHtml('li', renderInline(listMatch[1], boardId, renderState), lineStyleSource);
        continue;
      }

      // Regular line
      closeList();
      html += buildTagStyledLineHtml('div', renderInline(line, boardId, renderState), lineStyleSource);
    }

    closeList();
    if (!options.nested && footnoteOrder.length > 0) {
      html += '<div class="footnotes"><hr><ol>';
      for (var fn = 0; fn < footnoteOrder.length; fn++) {
        var footnoteId = footnoteOrder[fn];
        var footnoteText = footnoteDefs[footnoteId] || '';
        html += '<li id="footnote-' + escapeAttr(footnoteId) + '">' + renderInline(footnoteText, boardId, renderState) + '</li>';
      }
      html += '</ol></div>';
    }
    return html;
    } finally {
      renderState.nestedDepth = previousNestedDepth;
    }
  }

  return {
    init: init,
    renderCardContent: renderCardContent,
    renderTable: renderTable,
    renderInline: renderInline,
    renderTitleInline: renderTitleInline
  };
})();

window.LexeraCardContentRenderer = LexeraCardContentRenderer;
