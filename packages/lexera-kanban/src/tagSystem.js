(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // TAG VOCABULARY — single source of truth for all tag definitions
  // ═══════════════════════════════════════════════════════════════════════════

  // Layout tags: structural tags that control board layout.
  // Adding a new layout tag here automatically updates stripping, extraction,
  // classification, and title reconstruction across the entire application.
  var LAYOUT_TAGS = [
    { name: 'row',    pattern: 'row(\\d+)',          type: 'numeric',  negate: null },
    { name: 'span',   pattern: 'span(\\d+)',         type: 'numeric',  negate: 'nospan' },
    { name: 'stack',  pattern: 'stack',              type: 'boolean',  negate: 'nostack' },
    { name: 'header', pattern: 'header',             type: 'boolean',  negate: 'noheader' },
    { name: 'footer', pattern: 'footer',             type: 'boolean',  negate: 'nofooter' },
    { name: 'wip',    pattern: 'wip-(\\d+)',         type: 'numeric',  negate: 'nowip' },
    { name: 'sticky', pattern: 'sticky',             type: 'boolean',  negate: null },
    { name: 'width',  pattern: 'width\\{(\\d+)\\}',  type: 'braced',   negate: null },
    { name: 'height', pattern: 'height\\{(\\d+)\\}', type: 'braced',   negate: null },
  ];

  // Internal hidden tags for visibility state.
  var INTERNAL_HIDDEN_SUFFIXES = ['incoming', 'parked', 'archived', 'deleted'];

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPILED PATTERNS — built once from the vocabulary
  // ═══════════════════════════════════════════════════════════════════════════

  // Build combined strip regex: matches any layout tag token preceded by optional whitespace
  var stripParts = LAYOUT_TAGS.map(function (t) { return t.pattern; });
  var STRIP_LAYOUT_RE = new RegExp('\\s*#(?:' + stripParts.join('|') + ')(?!\\w)', 'gi');

  // Build classification regex: matches a tag name (without #) as a layout tag
  var classifyParts = LAYOUT_TAGS.map(function (t) { return t.pattern; });
  var IS_LAYOUT_RE = new RegExp('^(' + classifyParts.join('|') + ')$', 'i');

  // Build per-tag extraction regexes (cached)
  var EXTRACT_RE = {};
  for (var i = 0; i < LAYOUT_TAGS.length; i++) {
    EXTRACT_RE[LAYOUT_TAGS[i].name] = new RegExp('#' + LAYOUT_TAGS[i].pattern + '(?!\\w)', 'i');
  }

  // Build negation lookup: { 'nospan': true, 'nostack': true, ... }
  var NEGATION_SET = {};
  var NEGATION_SOURCE = {};
  for (var j = 0; j < LAYOUT_TAGS.length; j++) {
    if (LAYOUT_TAGS[j].negate) {
      NEGATION_SET[LAYOUT_TAGS[j].negate] = true;
      NEGATION_SOURCE[LAYOUT_TAGS[j].negate] = LAYOUT_TAGS[j].name;
    }
  }

  // Build negation strip regex for reconstructColumnTitle
  var negateParts = Object.keys(NEGATION_SET);
  var STRIP_NEGATION_RE = negateParts.length > 0
    ? new RegExp('#(?:' + negateParts.join('|') + ')\\b', 'gi')
    : null;

  // Internal hidden tag regex
  var INTERNAL_RE = new RegExp('\\s*#hidden-internal-(?:' + INTERNAL_HIDDEN_SUFFIXES.join('|') + ')\\b', 'g');
  var IS_ARCHIVED_RE = new RegExp('#hidden-internal-(?:' + INTERNAL_HIDDEN_SUFFIXES.join('|') + ')\\b|(^|\\s)#hidden(\\s|$)');

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function escapeRegex(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function stripHtmlComments(text) {
    return String(text || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .trim();
  }

  function extractHtmlComments(text) {
    var matches = String(text || '').match(/<!--[\s\S]*?-->/g);
    return matches ? matches.slice() : [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LAYOUT TAG OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  function stripLayoutTags(title) {
    return stripHtmlComments(String(title || ''))
      .replace(/\s*\[(#[^\]\s]+)\]\{[^\}]+\}/gi, '')
      .replace(STRIP_LAYOUT_RE, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripLegacyStructureTags(title) {
    return stripHtmlComments(String(title || ''))
      .replace(/\s*#row\d*\b/gi, '')
      .replace(/\s*#stack\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isLayoutTag(tagName) {
    var normalized = String(tagName || '').trim().replace(/^#/, '').toLowerCase();
    return IS_LAYOUT_RE.test(normalized);
  }

  function extractLayoutTags(title) {
    title = String(title || '');
    var result = {};
    for (var k = 0; k < LAYOUT_TAGS.length; k++) {
      var def = LAYOUT_TAGS[k];
      var m = title.match(EXTRACT_RE[def.name]);
      if (def.type === 'boolean') {
        result[def.name] = !!m;
      } else if (def.type === 'numeric') {
        if (m && m[1]) {
          var val = parseInt(m[1], 10);
          result[def.name] = isFinite(val) ? val : 0;
          result[def.name + 'Raw'] = m[0];
        } else {
          result[def.name] = 0;
          result[def.name + 'Raw'] = '';
        }
      } else if (def.type === 'braced') {
        if (m && m[1]) {
          var bval = parseInt(m[1], 10);
          result[def.name] = isFinite(bval) && bval > 0 ? bval : 0;
          result[def.name + 'Raw'] = m[0];
        } else {
          result[def.name] = 0;
          result[def.name + 'Raw'] = '';
        }
      }
    }
    return result;
  }

  function reconstructTitle(userInput, originalTitle) {
    var source = String(userInput || '');
    var original = extractLayoutTags(originalTitle);
    var next = extractLayoutTags(source);
    var preservedComments = extractHtmlComments(originalTitle);

    // Strip all known tag syntax from user input to get clean title text
    var cleanTitle = source
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/!!!include\([^)]+\)!!!/gi, '')
      .replace(STRIP_LAYOUT_RE, '');
    if (STRIP_NEGATION_RE) cleanTitle = cleanTitle.replace(STRIP_NEGATION_RE, '');
    cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();

    var parts = [];
    if (cleanTitle) parts.push(cleanTitle);

    var finalRow = next.rowRaw || original.rowRaw;
    if (finalRow && finalRow.toLowerCase() !== '#row1') parts.push(finalRow);

    // For each layout tag that has a negation form, apply the override logic
    for (var t = 0; t < LAYOUT_TAGS.length; t++) {
      var def = LAYOUT_TAGS[t];
      if (def.name === 'row') continue; // handled above
      if (!def.negate) {
        // Tags without negation (sticky, width, height): just use new if present, else original
        if (def.type === 'boolean') {
          if (next[def.name]) parts.push('#' + def.pattern);
        } else if (def.type === 'numeric') {
          var numRaw = next[def.name + 'Raw'] || original[def.name + 'Raw'];
          if (numRaw) parts.push(numRaw);
        } else if (def.type === 'braced') {
          var bracedRaw = next[def.name + 'Raw'] || original[def.name + 'Raw'];
          if (bracedRaw) parts.push(bracedRaw);
        }
        continue;
      }

      var negateRe = new RegExp('#' + def.negate + '\\b', 'i');
      var userNegated = negateRe.test(source);

      if (userNegated) continue; // user explicitly negated this tag

      if (def.type === 'boolean') {
        if (next[def.name] || original[def.name]) {
          parts.push('#' + def.name);
        }
      } else if (def.type === 'numeric') {
        // Use raw tag string if available, otherwise reconstruct from pattern
        var numRaw2 = next[def.name + 'Raw'] || original[def.name + 'Raw'];
        if (numRaw2) {
          parts.push(numRaw2);
        }
      }
    }

    if (preservedComments.length > 0) {
      parts = parts.concat(preservedComments);
    }

    return parts.join(' ').trim();
  }

  function getElementSizeTag(title, tagName) {
    var match = String(title || '').match(new RegExp('#' + tagName + '\\{(\\d+)\\}', 'i'));
    if (!match) return 0;
    var val = parseInt(match[1], 10);
    return isFinite(val) && val > 0 ? val : 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL HIDDEN TAG OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  function isArchivedOrDeleted(text) {
    return IS_ARCHIVED_RE.test(text || '');
  }

  function hasInternalHiddenTag(text, tag) {
    return !!(text && tag && text.indexOf(tag) !== -1);
  }

  function stripInternalHiddenTags(text) {
    return (text || '')
      .replace(INTERNAL_RE, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  function applyInternalHiddenTag(text, tag) {
    var cleaned = stripInternalHiddenTags(text);
    if (!tag) return cleaned;
    if (!cleaned || !cleaned.trim()) return tag;
    var lines = cleaned.split('\n');
    var firstLine = lines[0] ? lines[0].trim() : '';
    lines[0] = firstLine ? (firstLine + ' ' + tag) : tag;
    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER TAG TOKENIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  function isTagTokenBoundaryChar(ch) {
    return !ch || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '&' || ch === '|' || ch === '!';
  }

  function normalizeTagTokenForMatch(token) {
    return String(token || '').trim().toLowerCase();
  }

  function isTagExpressionBoundaryChar(ch) {
    return isTagTokenBoundaryChar(ch) || ch === '(' || ch === ')';
  }

  function collectHeaderTagTokens(text, options) {
    options = options || {};
    var includeHash = options.includeHash !== false;
    var includeAt = options.includeAt !== false;
    var includeTemporalBang = options.includeTemporalBang !== false;
    var lines = String(text || '').split('\n');
    var sourceLines = [];
    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i] || '');
      if (line.trim() === '') break;
      var headingMatch = line.match(/^(\s{0,3})#{1,6}(?:[ \t]+(.*))?[ \t]*$/);
      if (headingMatch) {
        var headingContent = String(headingMatch[2] || '').replace(/[ \t]+#{1,}[ \t]*$/, '');
        line = (headingMatch[1] || '') + headingContent;
      }
      sourceLines.push(line);
    }
    var source = sourceLines.join('\n');
    var tokens = [];
    var idx = 0;

    while (idx < source.length) {
      var ch = source.charAt(idx);
      var prev = idx === 0 ? '' : source.charAt(idx - 1);
      if (!isTagTokenBoundaryChar(prev)) {
        idx++;
        continue;
      }

      var isHashTag = includeHash && ch === '#';
      var isTemporalAt = includeAt && ch === '@';
      var isTemporalBang = includeTemporalBang && ch === '!' && idx + 1 < source.length;

      if (!isHashTag && !isTemporalAt && !isTemporalBang) {
        idx++;
        continue;
      }

      // A hash tag must be # followed by a non-# non-space character;
      // ##, ###, #### etc. are heading markers, not tags.
      if (isHashTag) {
        var nextCh = idx + 1 < source.length ? source.charAt(idx + 1) : '';
        if (nextCh === '#' || nextCh === ' ' || nextCh === '\t' || nextCh === '') {
          idx++;
          continue;
        }
      }

      if (isTemporalBang) {
        var next = source.charAt(idx + 1);
        if (next === '#' || next === '@' || next === '&' || next === '|' || isTagTokenBoundaryChar(next)) {
          idx++;
          continue;
        }
      }

      var start = idx;
      idx++;
      while (idx < source.length && !isTagTokenBoundaryChar(source.charAt(idx))) idx++;
      if (idx - start > 1) tokens.push(source.slice(start, idx));
    }

    return tokens;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAG EXPRESSION EVALUATOR
  // ═══════════════════════════════════════════════════════════════════════════

  function tokenizeTagExpression(expression) {
    var source = String(expression || '');
    var tokens = [];
    var i = 0;

    while (i < source.length) {
      var ch = source.charAt(i);
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }
      if (ch === '&' || ch === '|' || ch === '(' || ch === ')') {
        tokens.push({ type: 'op', value: ch });
        i++;
        continue;
      }
      if (ch === '!') {
        var j2 = i + 1;
        while (j2 < source.length) {
          var nxt = source.charAt(j2);
          if (nxt !== ' ' && nxt !== '\t' && nxt !== '\n' && nxt !== '\r') break;
          j2++;
        }
        var nextSig = source.charAt(j2);
        if (nextSig === '#' || nextSig === '@' || nextSig === '!') {
          tokens.push({ type: 'op', value: '!' });
          i++;
          continue;
        }
      }
      if (ch === '#' || ch === '@' || ch === '!') {
        // Skip heading markers: ## ### #### and lone # followed by space
        if (ch === '#') {
          var nc = i + 1 < source.length ? source.charAt(i + 1) : '';
          if (nc === '#' || nc === ' ' || nc === '\t' || nc === '') {
            i++;
            continue;
          }
        }
        var s = i;
        i++;
        while (i < source.length && !isTagExpressionBoundaryChar(source.charAt(i))) i++;
        if (i - s > 1) tokens.push({ type: 'tag', value: source.slice(s, i) });
        continue;
      }
      i++;
    }

    return tokens;
  }

  function evaluateTagExpression(expression, tagLookup) {
    var tokens = tokenizeTagExpression(expression);
    if (tokens.length === 0) return false;
    var index = 0;

    function peek() { return index < tokens.length ? tokens[index] : null; }
    function consumeOp(op) {
      if (index < tokens.length && tokens[index].type === 'op' && tokens[index].value === op) {
        index++;
        return true;
      }
      return false;
    }
    function beginsOperand(token) {
      return !!(token && ((token.type === 'tag') || (token.type === 'op' && (token.value === '!' || token.value === '('))));
    }
    function parsePrimary() {
      if (consumeOp('(')) { var nested = parseOr(); consumeOp(')'); return nested; }
      var token = peek();
      if (!token || token.type !== 'tag') return false;
      index++;
      return !!tagLookup[normalizeTagTokenForMatch(token.value)];
    }
    function parseNot() { if (consumeOp('!')) return !parseNot(); return parsePrimary(); }
    function parseAnd() {
      var value = parseNot();
      while (true) {
        if (consumeOp('&')) { var rhs = parseNot(); value = value && rhs; continue; }
        if (beginsOperand(peek())) { var adj = parseNot(); value = value && adj; continue; }
        break;
      }
      return value;
    }
    function parseOr() {
      var value = parseAnd();
      while (consumeOp('|')) { var rhs2 = parseAnd(); value = value || rhs2; }
      return value;
    }

    return !!parseOr();
  }

  function isTagExpression(tagName) {
    var expr = String(tagName || '').trim();
    if (!expr) return false;
    if (/[&|()]/.test(expr) || /!\s*[#@!(]/.test(expr)) return true;
    var tokens = tokenizeTagExpression(expr);
    var tagCount = 0;
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'tag') tagCount++;
      if (tagCount > 1) return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAG QUERY & EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════

  function extractAllTags(text) {
    var tokens = collectHeaderTagTokens(text, { includeHash: true, includeAt: false, includeTemporalBang: false });
    var seen = {};
    var tags = [];
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (token.charAt(0) !== '#') continue;
      var normalized = normalizeTagTokenForMatch(token);
      if (seen[normalized]) continue;
      seen[normalized] = true;
      tags.push(token);
    }
    return tags;
  }

  function hasTag(text, tagName) {
    var target = String(tagName || '').trim();
    if (!target) return false;
    var tokens = collectHeaderTagTokens(text, { includeHash: true, includeAt: true, includeTemporalBang: true });
    var lookup = {};
    for (var i = 0; i < tokens.length; i++) {
      lookup[normalizeTagTokenForMatch(tokens[i])] = true;
    }
    if (isTagExpression(target)) {
      return evaluateTagExpression(target, lookup);
    }
    return !!lookup[normalizeTagTokenForMatch(target)];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAG CLASSIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  function isNumericIndexTag(tagName) {
    return /^#\d+(?:\.\d+)*$/i.test(String(tagName || '').trim());
  }

  function isTagStyleEligible(tagName) {
    if (!tagName || tagName.charAt(0) !== '#') return false;
    if (isNumericIndexTag(tagName)) return false;
    if (isLayoutTag(tagName)) return false;
    return !/^#hidden-internal-/i.test(tagName);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAG MANIPULATION
  // ═══════════════════════════════════════════════════════════════════════════

  function normalizePromptTagToken(rawToken) {
    var token = String(rawToken || '').trim();
    if (!token) return '';
    if (token.charAt(0) !== '#') {
      if (token.charAt(0) === '@' || token.charAt(0) === '!') return '';
      token = '#' + token;
    }
    if (!/^#(?![# ])[^\s&|!]+$/.test(token)) return '';
    return token.toLowerCase();
  }

  function parsePromptTagList(rawInput) {
    var source = String(rawInput || '');
    if (!source) return [];
    var parts = source.split(/[\s,;]+/);
    var out = [];
    var seen = {};
    for (var i = 0; i < parts.length; i++) {
      var tag = normalizePromptTagToken(parts[i]);
      if (!tag || seen[tag]) continue;
      seen[tag] = true;
      out.push(tag);
    }
    return out;
  }

  function removeTagFromHeader(headerText, tagName) {
    var normalized = normalizePromptTagToken(tagName);
    if (!normalized) return headerText;
    var re = new RegExp('(^|[\\s&|!])' + escapeRegex(normalized) + '(?=([\\s&|!]|$))', 'g');
    var next = String(headerText || '').replace(re, '$1');
    next = next
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
    return next;
  }

  function addTagToHeader(headerText, tagName) {
    var normalized = normalizePromptTagToken(tagName);
    if (!normalized) return headerText;
    if (hasTag(headerText, normalized)) return headerText;
    var lines = String(headerText || '').split('\n');
    if (lines.length === 0) lines = [''];
    var firstLine = String(lines[0] || '').trim();
    if (!firstLine) lines[0] = normalized;
    else lines[0] = firstLine + ' ' + normalized;
    return lines.join('\n');
  }

  function replaceTagInHeader(headerText, oldTag, newTag) {
    var fromTag = normalizePromptTagToken(oldTag);
    var toTag = normalizePromptTagToken(newTag);
    if (!fromTag || !toTag || fromTag === toTag) return String(headerText || '');
    var re = new RegExp('(^|[\\s&|!])' + escapeRegex(fromTag) + '(?=([\\s&|!]|$))', 'g');
    return String(headerText || '').replace(re, function (_, prefix) {
      return prefix + toTag;
    });
  }

  function clearRemovableTags(headerText) {
    var tokens = collectHeaderTagTokens(headerText, {
      includeHash: true,
      includeAt: false,
      includeTemporalBang: false
    });
    var next = String(headerText || '');
    for (var i = 0; i < tokens.length; i++) {
      var token = String(tokens[i] || '');
      if (!token || token.charAt(0) !== '#') continue;
      if (/^#hidden-internal-/i.test(token)) continue;
      if (isLayoutTag(token)) continue;
      next = removeTagFromHeader(next, token);
    }
    return next;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  var TagSystem = {
    // Vocabulary access (for external inspection/extension)
    LAYOUT_TAGS: LAYOUT_TAGS,
    INTERNAL_HIDDEN_SUFFIXES: INTERNAL_HIDDEN_SUFFIXES,

    // Layout tag operations
    stripLayoutTags: stripLayoutTags,
    stripLegacyStructureTags: stripLegacyStructureTags,
    isLayoutTag: isLayoutTag,
    extractLayoutTags: extractLayoutTags,
    reconstructTitle: reconstructTitle,
    getElementSizeTag: getElementSizeTag,

    // Internal hidden tag operations
    isArchivedOrDeleted: isArchivedOrDeleted,
    hasInternalHiddenTag: hasInternalHiddenTag,
    stripInternalHiddenTags: stripInternalHiddenTags,
    applyInternalHiddenTag: applyInternalHiddenTag,

    // Header tag tokenization
    isTagTokenBoundaryChar: isTagTokenBoundaryChar,
    normalizeTagTokenForMatch: normalizeTagTokenForMatch,
    collectHeaderTagTokens: collectHeaderTagTokens,

    // Tag expressions
    isTagExpression: isTagExpression,
    evaluateTagExpression: evaluateTagExpression,
    tokenizeTagExpression: tokenizeTagExpression,

    // Tag query
    extractAllTags: extractAllTags,
    hasTag: hasTag,

    // Tag classification
    isNumericIndexTag: isNumericIndexTag,
    isTagStyleEligible: isTagStyleEligible,

    // Tag manipulation
    normalizePromptTagToken: normalizePromptTagToken,
    parsePromptTagList: parsePromptTagList,
    removeTagFromHeader: removeTagFromHeader,
    addTagToHeader: addTagToHeader,
    replaceTagInHeader: replaceTagInHeader,
    clearRemovableTags: clearRemovableTags,
  };

  var _global = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : {};
  _global.LexeraTagSystem = TagSystem;
})();
