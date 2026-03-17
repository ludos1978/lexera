// Browser-compatible markdown-it plugin for splitting loose lists into separate tight lists.
// When a blank line separates list items, markdown-it creates a single "loose" list
// where every item gets wrapped in <p>. This plugin instead splits the list at blank lines
// into multiple tight lists (no <p> wrapping within each sub-list).
//
// Example input:
//   - a
//   - b
//
//   - c
//
// Default markdown-it output (one loose list):
//   <ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>
//
// With this plugin (two tight lists):
//   <ul><li>a</li><li>b</li></ul>
//   <ul><li>c</li></ul>
(function() {
    function listSplitPlugin(md) {
        md.core.ruler.push('list_split', function(state) {
            var tokens = state.tokens;
            var newTokens = [];
            var i = 0;

            while (i < tokens.length) {
                var token = tokens[i];

                // Only process bullet and ordered lists
                if (token.type !== 'bullet_list_open' && token.type !== 'ordered_list_open') {
                    newTokens.push(token);
                    i++;
                    continue;
                }

                var listOpenType = token.type;
                var listCloseType = listOpenType.replace('_open', '_close');
                var listTag = token.tag;
                var listMarkup = token.markup;
                var listAttrs = token.attrs;

                // Find matching list close (handle nesting)
                var depth = 1;
                var listCloseIdx = -1;
                for (var j = i + 1; j < tokens.length; j++) {
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

                // Collect top-level list items with their token ranges
                var items = [];
                depth = 0;
                var currentItemOpen = -1;
                for (var j = i + 1; j < listCloseIdx; j++) {
                    if (tokens[j].type === 'list_item_open') {
                        if (depth === 0) { currentItemOpen = j; }
                        depth++;
                    }
                    if (tokens[j].type === 'list_item_close') {
                        depth--;
                        if (depth === 0 && currentItemOpen >= 0) {
                            items.push({
                                openIdx: currentItemOpen,
                                closeIdx: j,
                                map: tokens[currentItemOpen].map
                            });
                            currentItemOpen = -1;
                        }
                    }
                }

                if (items.length < 2) {
                    // Single item, no splitting possible
                    for (var j = i; j <= listCloseIdx; j++) { newTokens.push(tokens[j]); }
                    i = listCloseIdx + 1;
                    continue;
                }

                // Detect split points: check if the source line immediately before
                // each item's start is blank. markdown-it includes trailing blank lines
                // in the preceding item's map range, so we check the source directly.
                var splitAfter = {};
                var lines = state.src.split('\n');
                for (var k = 1; k < items.length; k++) {
                    if (items[k].map) {
                        var lineBeforeItem = items[k].map[0] - 1;
                        if (lineBeforeItem >= 0 && lines[lineBeforeItem].trim() === '') {
                            splitAfter[k - 1] = true;
                        }
                    }
                }

                var hasSplits = false;
                for (var key in splitAfter) { hasSplits = true; break; }

                if (!hasSplits) {
                    // No blank line gaps, keep the list as-is
                    for (var j = i; j <= listCloseIdx; j++) { newTokens.push(tokens[j]); }
                    i = listCloseIdx + 1;
                    continue;
                }

                // Group items into sub-lists
                var groups = [[]];
                for (var k = 0; k < items.length; k++) {
                    groups[groups.length - 1].push(k);
                    if (splitAfter[k]) { groups.push([]); }
                }

                // Generate tokens for each sub-list
                for (var g = 0; g < groups.length; g++) {
                    var group = groups[g];

                    // Check if any item in this group has multiple paragraphs
                    var isTight = true;
                    for (var gi = 0; gi < group.length; gi++) {
                        var item = items[group[gi]];
                        var pCount = 0;
                        for (var j = item.openIdx + 1; j < item.closeIdx; j++) {
                            if (tokens[j].type === 'paragraph_open') { pCount++; }
                        }
                        if (pCount > 1) { isTight = false; break; }
                    }

                    // Create list open token
                    var openToken = new state.Token(listOpenType, listTag, 1);
                    openToken.markup = listMarkup;
                    if (listAttrs) { openToken.attrs = listAttrs.slice(); }
                    openToken.block = true;
                    newTokens.push(openToken);

                    // Copy item tokens
                    for (var gi = 0; gi < group.length; gi++) {
                        var item = items[group[gi]];
                        for (var j = item.openIdx; j <= item.closeIdx; j++) {
                            var t = tokens[j];
                            // Make paragraphs tight (hidden) for single-paragraph items
                            if (isTight && (t.type === 'paragraph_open' || t.type === 'paragraph_close')) {
                                t.hidden = true;
                            }
                            newTokens.push(t);
                        }
                    }

                    // Create list close token
                    var closeToken = new state.Token(listCloseType, listTag, -1);
                    closeToken.markup = listMarkup;
                    closeToken.block = true;
                    newTokens.push(closeToken);
                }

                i = listCloseIdx + 1;
            }

            state.tokens = newTokens;
        });
    }

    // Export for browser use
    window.markdownitListSplit = listSplitPlugin;
})();
