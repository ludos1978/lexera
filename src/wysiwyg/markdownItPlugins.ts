import type MarkdownIt from 'markdown-it';

export type WikiLinksOptions = {
    className?: string;
};

export function wikiLinksPlugin(md: MarkdownIt, options: WikiLinksOptions = {}): void {
    const { className = 'wiki-link' } = options;

    function parseWikiLink(state: any, silent: boolean): boolean {
        let pos = state.pos;

        if (pos + 1 >= state.posMax) { return false; }
        if (state.src.charCodeAt(pos) !== 0x5B /* [ */) { return false; }
        if (state.src.charCodeAt(pos + 1) !== 0x5B /* [ */) { return false; }

        pos += 2;

        let found = false;
        let content = '';
        const contentStart = pos;

        while (pos < state.posMax) {
            if (state.src.charCodeAt(pos) === 0x5D /* ] */ &&
                pos + 1 < state.posMax &&
                state.src.charCodeAt(pos + 1) === 0x5D /* ] */) {
                found = true;
                content = state.src.slice(contentStart, pos);
                break;
            }
            pos += 1;
        }

        if (!found) { return false; }

        const parts = content.split('|');
        const document = parts[0].trim();
        const title = parts[1] ? parts[1].trim() : document;

        if (!document) { return false; }

        state.pos = pos + 2;

        if (silent) { return true; }

        const tokenOpen = state.push('wiki_link_open', 'a', 1);
        tokenOpen.attrSet('href', '#');
        if (className) { tokenOpen.attrSet('class', className); }
        tokenOpen.attrSet('data-document', document);
        tokenOpen.attrSet('title', `Wiki link: ${document}`);

        const tokenText = state.push('text', '', 0);
        tokenText.content = title;

        state.push('wiki_link_close', 'a', -1);

        return true;
    }

    md.inline.ruler.before('link', 'wiki_link', parseWikiLink);
}

export type TagPluginOptions = {
    prefix?: string;
};

/**
 * Tag plugin - handles # prefix for all hash tags including people
 * NEW SYSTEM: # prefix handles tags AND people (people are just tags)
 * Examples: #urgent, #todo, #john, #team-lead
 */
export function tagPlugin(md: MarkdownIt, options: TagPluginOptions = {}): void {
    const prefix = options.prefix ?? '#';
    const prefixCode = prefix.charCodeAt(0);

    function parseTag(state: any, silent: boolean): boolean {
        let pos = state.pos;

        if (state.src.charCodeAt(pos) !== prefixCode) { return false; }
        if (pos > 0 && state.src.charCodeAt(pos - 1) !== 0x20 /* space */ &&
            state.src.charCodeAt(pos - 1) !== 0x0A /* newline */ &&
            state.src.charCodeAt(pos - 1) !== 0x09 /* tab */ &&
            pos !== 0) {
            return false;
        }

        if (pos === 0 || state.src.charCodeAt(pos - 1) === 0x0A /* newline */) {
            const nextChar = state.src.charCodeAt(pos + 1);
            if (nextChar === 0x20 /* space */ || nextChar === prefixCode) {
                return false;
            }
        }

        pos += 1;
        if (pos >= state.posMax) { return false; }

        const tagStart = pos;
        let tagContent = '';

        const remaining = state.src.slice(pos);
        const positivityMatch = remaining.match(/^(\+\+|\+|\u00f8|\u00d8|--|-(?!-))/);
        if (positivityMatch) {
            tagContent = positivityMatch[1];
            pos += tagContent.length;
        } else if (state.src.substr(pos, 7) === 'gather_') {
            while (pos < state.posMax) {
                const char = state.src.charCodeAt(pos);
                if (char === 0x20 || char === 0x0A || char === 0x09) { break; }
                pos += 1;
            }
            tagContent = state.src.slice(tagStart, pos);
        } else {
            while (pos < state.posMax) {
                const char = state.src.charCodeAt(pos);
                if ((char >= 0x30 && char <= 0x39) ||
                    (char >= 0x41 && char <= 0x5A) ||
                    (char >= 0x61 && char <= 0x7A) ||
                    char === 0x5F ||
                    char === 0x2D ||
                    char === 0x2E) {
                    pos += 1;
                } else {
                    break;
                }
            }
            tagContent = state.src.slice(tagStart, pos);
        }

        if (tagContent.length === 0) { return false; }

        state.pos = pos;

        if (silent) { return true; }

        const token = state.push('tag', 'span', 0);
        token.content = tagContent;
        token.markup = prefix;

        return true;
    }

    md.inline.ruler.before('emphasis', 'tag', parseTag);
}

// NOTE: datePersonTagPlugin has been removed
// In the new tag system:
// - # prefix handles all tags including people (people are just tags)
// - @ prefix handles all temporal (dates, times, weeks, weekdays)
// The old @person syntax is now #person, handled by tagPlugin
// The old @date syntax is now handled by temporalTagPlugin with @ prefix

export type TemporalTagOptions = {
    prefix?: string;
};

/**
 * Temporal tag plugin - handles @ prefix for all date/time formats
 * NEW SYSTEM: @ prefix handles all temporal (dates, times, weeks, weekdays)
 * Examples: @2025-03-27, @10:30, @W12, @monday, @10am-2pm
 */
export function temporalTagPlugin(md: MarkdownIt, options: TemporalTagOptions = {}): void {
    const prefix = options.prefix ?? '@';
    const prefixCode = prefix.charCodeAt(0);

    function parseTemporalTag(state: any, silent: boolean): boolean {
        let pos = state.pos;

        if (state.src.charCodeAt(pos) !== prefixCode) { return false; }

        if (pos > 0) {
            const prevChar = state.src.charCodeAt(pos - 1);
            if (prevChar !== 0x20 /* space */ && prevChar !== 0x0A /* newline */ && prevChar !== 0x09 /* tab */) {
                return false;
            }
        }

        pos += 1;
        if (pos >= state.posMax) { return false; }

        const remaining = state.src.slice(pos);
        let tagContent = '';
        let tagType = '';

        // Time slot: @10am-2pm, @9:30-17:00
        const timeSlotMatch = remaining.match(/^(\d{1,2}(?::\d{2})?(?:am|pm)?)-(\d{1,2}(?::\d{2})?(?:am|pm)?)(?=\s|$)/i);
        if (timeSlotMatch) {
            tagContent = timeSlotMatch[0];
            tagType = 'timeSlot';
            pos += tagContent.length;
        } else {
            // Year-week: @2025W12, @2025-W12, @2025.W12
            const weekYearMatch = remaining.match(/^(\d{4})[-.]?[wW](\d{1,2})(?=\s|$)/);
            if (weekYearMatch) {
                tagContent = weekYearMatch[0];
                tagType = 'week';
                pos += tagContent.length;
            } else {
                // Week only: @W12
                const weekMatch = remaining.match(/^[wW](\d{1,2})(?=\s|$)/);
                if (weekMatch) {
                    tagContent = weekMatch[0];
                    tagType = 'week';
                    pos += tagContent.length;
                } else {
                    // Date with separators: @2025-03-27, @2025/03/27, @2025.03.27
                    const dateMatch = remaining.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?=\s|$)/);
                    if (dateMatch) {
                        tagContent = dateMatch[0];
                        tagType = 'date';
                        pos += tagContent.length;
                    } else {
                        // Date in DD-MM-YYYY format: @27-03-2025
                        const dateDMYMatch = remaining.match(/^(\d{2})-(\d{2})-(\d{4})(?=\s|$)/);
                        if (dateDMYMatch) {
                            tagContent = dateDMYMatch[0];
                            tagType = 'date';
                            pos += tagContent.length;
                        } else {
                            // Weekday: @monday, @mon, @tue, etc.
                            const weekdayMatch = remaining.match(/^(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)(?=\s|$)/i);
                            if (weekdayMatch) {
                                tagContent = weekdayMatch[0];
                                tagType = 'weekday';
                                pos += tagContent.length;
                            } else {
                                // Minute slot: @:15-:45
                                const minuteSlotMatch = remaining.match(/^:(\d{1,2})-:(\d{1,2})(?=\s|$)/i);
                                if (minuteSlotMatch) {
                                    tagContent = minuteSlotMatch[0];
                                    tagType = 'minuteSlot';
                                    pos += tagContent.length;
                                } else {
                                    // Time only: @10:30, @2pm, @14
                                    const timeMatch = remaining.match(/^(\d{1,2}(?::\d{2})?(?:am|pm)?)(?=\s|$)/i);
                                    if (timeMatch) {
                                        tagContent = timeMatch[0];
                                        tagType = 'time';
                                        pos += tagContent.length;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if (!tagContent) { return false; }

        state.pos = pos;

        if (silent) { return true; }

        const token = state.push('temporal_tag', 'span', 0);
        token.content = tagContent;
        token.markup = prefix;
        token.meta = { type: tagType };

        return true;
    }

    md.inline.ruler.before('emphasis', 'temporal_tag', parseTemporalTag);
}

export function speakerNotePlugin(md: MarkdownIt): void {
    function parseSpeakerNote(state: any, startLine: number, endLine: number, silent: boolean): boolean {
        let pos = state.bMarks[startLine] + state.tShift[startLine];
        let max = state.eMarks[startLine];

        if (pos + 1 >= max) { return false; }
        if (state.src.charCodeAt(pos) !== 0x3B /* ; */) { return false; }
        if (state.src.charCodeAt(pos + 1) !== 0x3B /* ; */) { return false; }

        if (silent) { return true; }

        const lines: string[] = [];
        let nextLine = startLine;

        while (nextLine < endLine) {
            const linePos = state.bMarks[nextLine] + state.tShift[nextLine];
            const lineMax = state.eMarks[nextLine];

            if (linePos + 1 < lineMax &&
                state.src.charCodeAt(linePos) === 0x3B /* ; */ &&
                state.src.charCodeAt(linePos + 1) === 0x3B /* ; */) {
                const content = state.src.slice(linePos + 2, lineMax).trim();
                lines.push(content);
                nextLine += 1;
            } else {
                break;
            }
        }

        const token = state.push('speaker_note', 'div', 0);
        token.content = lines.join('\n');
        token.markup = ';;';

        state.line = nextLine;
        return true;
    }

    md.block.ruler.before('paragraph', 'speaker_note', parseSpeakerNote);
}

export function htmlCommentPlugin(md: MarkdownIt): void {
    function parseHtmlComment(state: any, silent: boolean): boolean {
        let pos = state.pos;

        if (pos + 3 >= state.posMax) { return false; }
        if (state.src.charCodeAt(pos) !== 0x3C /* < */) { return false; }
        if (state.src.charCodeAt(pos + 1) !== 0x21 /* ! */) { return false; }
        if (state.src.charCodeAt(pos + 2) !== 0x2D /* - */) { return false; }
        if (state.src.charCodeAt(pos + 3) !== 0x2D /* - */) { return false; }

        pos += 4;

        let found = false;
        let content = '';
        const contentStart = pos;

        while (pos < state.posMax - 2) {
            if (state.src.charCodeAt(pos) === 0x2D /* - */ &&
                state.src.charCodeAt(pos + 1) === 0x2D /* - */ &&
                state.src.charCodeAt(pos + 2) === 0x3E /* > */) {
                found = true;
                content = state.src.slice(contentStart, pos);
                break;
            }
            pos += 1;
        }

        if (!found) { return false; }

        state.pos = pos + 3;

        if (silent) { return true; }

        const token = state.push('html_comment', 'span', 0);
        token.content = content.trim();
        token.markup = '<!--';

        return true;
    }

    function parseHtmlCommentBlock(state: any, startLine: number, _endLine: number, silent: boolean): boolean {
        const pos = state.bMarks[startLine] + state.tShift[startLine];
        const max = state.eMarks[startLine];
        const savedPos = state.pos;
        const savedPosMax = state.posMax;

        state.pos = pos;
        state.posMax = max;

        const matched = parseHtmlComment(state, silent);
        if (matched) {
            state.line = startLine + 1;
        }

        state.pos = savedPos;
        state.posMax = savedPosMax;

        return matched;
    }

    md.inline.ruler.before('html_inline', 'html_comment', parseHtmlComment);
    md.block.ruler.before('html_block', 'html_comment_block', parseHtmlCommentBlock);
}

/**
 * List split plugin - splits loose lists (with blank lines between items) into
 * separate tight lists. Each contiguous block of list items becomes its own list.
 */
export function listSplitPlugin(md: MarkdownIt): void {
    md.core.ruler.push('list_split', function(state: any) {
        const tokens = state.tokens;
        const newTokens: any[] = [];
        let i = 0;

        while (i < tokens.length) {
            const token = tokens[i];

            if (token.type !== 'bullet_list_open' && token.type !== 'ordered_list_open') {
                newTokens.push(token);
                i++;
                continue;
            }

            const listOpenType = token.type;
            const listCloseType = listOpenType.replace('_open', '_close');
            const listTag = token.tag;
            const listMarkup = token.markup;
            const listAttrs = token.attrs;

            let depth = 1;
            let listCloseIdx = -1;
            for (let j = i + 1; j < tokens.length; j++) {
                if (tokens[j].type === listOpenType) { depth++; }
                if (tokens[j].type === listCloseType) {
                    depth--;
                    if (depth === 0) { listCloseIdx = j; break; }
                }
            }

            if (listCloseIdx === -1) {
                newTokens.push(token);
                i++;
                continue;
            }

            const items: { openIdx: number; closeIdx: number; map: number[] | null }[] = [];
            depth = 0;
            let currentItemOpen = -1;
            for (let j = i + 1; j < listCloseIdx; j++) {
                if (tokens[j].type === 'list_item_open') {
                    if (depth === 0) { currentItemOpen = j; }
                    depth++;
                }
                if (tokens[j].type === 'list_item_close') {
                    depth--;
                    if (depth === 0 && currentItemOpen >= 0) {
                        items.push({ openIdx: currentItemOpen, closeIdx: j, map: tokens[currentItemOpen].map });
                        currentItemOpen = -1;
                    }
                }
            }

            if (items.length < 2) {
                for (let j = i; j <= listCloseIdx; j++) { newTokens.push(tokens[j]); }
                i = listCloseIdx + 1;
                continue;
            }

            // Check if the source line immediately before each item's start is blank.
            // markdown-it includes trailing blank lines in the preceding item's map range.
            const splitAfter = new Set<number>();
            const lines: string[] = state.src.split('\n');
            for (let k = 1; k < items.length; k++) {
                if (items[k].map) {
                    const lineBeforeItem = items[k].map![0] - 1;
                    if (lineBeforeItem >= 0 && lines[lineBeforeItem].trim() === '') {
                        splitAfter.add(k - 1);
                    }
                }
            }

            if (splitAfter.size === 0) {
                for (let j = i; j <= listCloseIdx; j++) { newTokens.push(tokens[j]); }
                i = listCloseIdx + 1;
                continue;
            }

            const groups: number[][] = [[]];
            for (let k = 0; k < items.length; k++) {
                groups[groups.length - 1].push(k);
                if (splitAfter.has(k)) { groups.push([]); }
            }

            for (const group of groups) {
                let isTight = true;
                for (const idx of group) {
                    const item = items[idx];
                    let pCount = 0;
                    for (let j = item.openIdx + 1; j < item.closeIdx; j++) {
                        if (tokens[j].type === 'paragraph_open') { pCount++; }
                    }
                    if (pCount > 1) { isTight = false; break; }
                }

                const openToken = new state.Token(listOpenType, listTag, 1);
                openToken.markup = listMarkup;
                if (listAttrs) { openToken.attrs = listAttrs.slice(); }
                openToken.block = true;
                newTokens.push(openToken);

                for (const idx of group) {
                    const item = items[idx];
                    for (let j = item.openIdx; j <= item.closeIdx; j++) {
                        const t = tokens[j];
                        if (isTight && (t.type === 'paragraph_open' || t.type === 'paragraph_close')) {
                            t.hidden = true;
                        }
                        newTokens.push(t);
                    }
                }

                const closeToken = new state.Token(listCloseType, listTag, -1);
                closeToken.markup = listMarkup;
                closeToken.block = true;
                newTokens.push(closeToken);
            }

            i = listCloseIdx + 1;
        }

        state.tokens = newTokens;
    });
}

/**
 * Table widths plugin - uses dash count in separator row for proportional column widths.
 * Only activates when alignment markers (:) are present.
 * Without alignment markers, table columns use automatic width (default behavior).
 */
export function tableWidthsPlugin(md: MarkdownIt): void {
    md.core.ruler.push('table_widths', function(state: any) {
        const tokens = state.tokens;
        const lines: string[] = state.src.split('\n');

        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type !== 'table_open') { continue; }

            const map = tokens[i].map;
            if (!map) { continue; }

            const separatorLine = lines[map[0] + 1];
            if (!separatorLine) { continue; }

            let cols = separatorLine.split('|');
            if (cols.length > 0 && cols[0].trim() === '') { cols.shift(); }
            if (cols.length > 0 && cols[cols.length - 1].trim() === '') { cols.pop(); }
            cols = cols.map(c => c.trim());
            if (cols.length === 0) { continue; }

            const hasAlignment = cols.some(c => c.startsWith(':') || c.endsWith(':'));
            if (!hasAlignment) { continue; }

            const dashCounts = cols.map(c => {
                let count = 0;
                for (let k = 0; k < c.length; k++) {
                    if (c[k] === '-') { count++; }
                }
                return count;
            });

            const totalDashes = dashCounts.reduce((a, b) => a + b, 0);
            if (totalDashes === 0) { continue; }

            const widths = dashCounts.map(d => d / totalDashes * 100);

            const aligns = cols.map(c => {
                const left = c.startsWith(':');
                const right = c.endsWith(':');
                if (left && right) { return 'center'; }
                if (right) { return 'right'; }
                if (left) { return 'left'; }
                return null;
            });

            tokens[i].attrJoin('style', 'table-layout: fixed; width: 100%;');

            let colIndex = 0;
            for (let j = i + 1; j < tokens.length; j++) {
                if (tokens[j].type === 'table_close') { break; }
                if (tokens[j].type === 'tr_open') { colIndex = 0; }

                if (tokens[j].type === 'th_open' || tokens[j].type === 'td_open') {
                    if (colIndex < widths.length) {
                        let style = `width: ${widths[colIndex].toFixed(2)}%;`;
                        if (aligns[colIndex]) {
                            style += ` text-align: ${aligns[colIndex]};`;
                        }
                        tokens[j].attrSet('style', style);
                    }
                    colIndex++;
                }
            }
        }
    });
}

export type IncludePluginOptions = {
    includeRe?: RegExp;
};

export function includePlugin(md: MarkdownIt, options: IncludePluginOptions = {}): void {
    const includeRe = options.includeRe ?? /!!!include\(([^)]+)\)!!!/;

    md.block.ruler.before('paragraph', 'include_block', function includeBlock(state: any, startLine: number, endLine: number, silent: boolean) {
        const pos = state.bMarks[startLine] + state.tShift[startLine];
        const max = state.eMarks[startLine];
        const lineText = state.src.slice(pos, max).trim();

        const match = lineText.match(includeRe);
        if (!match || match.index !== 0 || match[0] !== lineText) {
            return false;
        }

        if (silent) { return true; }

        const filePath = match[1].trim();
        const token = state.push('include_block', 'div', 0);
        token.content = '';
        token.filePath = filePath;
        token.map = [startLine, startLine + 1];

        state.line = startLine + 1;
        return true;
    });

    md.inline.ruler.before('text', 'include_inline', function includeInline(state: any, silent: boolean) {
        const start = state.pos;
        const srcSlice = state.src.slice(start);
        const match = srcSlice.match(includeRe);
        if (!match || match.index !== 0) {
            return false;
        }

        state.pos = start + match[0].length;

        if (silent) {
            return true;
        }

        const filePath = match[1].trim();
        const token = state.push('include_content', 'span', 0);
        token.content = '';
        token.attrSet('class', 'included-content-inline');
        token.attrSet('data-include-file', filePath);

        return true;
    });
}
