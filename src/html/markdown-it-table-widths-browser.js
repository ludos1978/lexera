// Browser-compatible markdown-it plugin for proportional table column widths.
// When the separator row contains alignment markers (: on left/right/both),
// the number of dashes defines proportional column widths.
// Without alignment markers, table columns use automatic width (default behavior).
//
// Examples:
//   |:--|:--|    → 50/50 split, both left-aligned
//   |:-|:--|:---|  → 1:2:3 ratio (≈16.7%, 33.3%, 50%), all left-aligned
//   |--:|:-:|:--| → right, center, left alignment with 1:1:1 ratio
//   |--|--|--|    → no alignment markers = automatic width (unchanged)
(function() {
    function tableWidthsPlugin(md) {
        md.core.ruler.push('table_widths', function(state) {
            var tokens = state.tokens;
            var lines = state.src.split('\n');

            for (var i = 0; i < tokens.length; i++) {
                if (tokens[i].type !== 'table_open') { continue; }

                var map = tokens[i].map;
                if (!map) { continue; }

                // The separator row is always the second line of the table
                var separatorLine = lines[map[0] + 1];
                if (!separatorLine) { continue; }

                // Split by | and remove leading/trailing empty entries
                var cols = separatorLine.split('|');
                if (cols.length > 0 && cols[0].trim() === '') { cols.shift(); }
                if (cols.length > 0 && cols[cols.length - 1].trim() === '') { cols.pop(); }
                cols = cols.map(function(c) { return c.trim(); });
                if (cols.length === 0) { continue; }

                // Check if any column has alignment markers (:)
                var hasAlignment = cols.some(function(c) {
                    return c.charAt(0) === ':' || c.charAt(c.length - 1) === ':';
                });

                // No alignment markers = automatic width, skip
                if (!hasAlignment) { continue; }

                // Count only dash characters per column
                var dashCounts = cols.map(function(c) {
                    var count = 0;
                    for (var k = 0; k < c.length; k++) {
                        if (c.charAt(k) === '-') { count++; }
                    }
                    return count;
                });

                var totalDashes = 0;
                for (var d = 0; d < dashCounts.length; d++) { totalDashes += dashCounts[d]; }
                if (totalDashes === 0) { continue; }

                // Calculate proportional widths as percentages
                var widths = dashCounts.map(function(dc) {
                    return dc / totalDashes * 100;
                });

                // Parse alignment from colon positions
                var aligns = cols.map(function(c) {
                    var left = c.charAt(0) === ':';
                    var right = c.charAt(c.length - 1) === ':';
                    if (left && right) { return 'center'; }
                    if (right) { return 'right'; }
                    if (left) { return 'left'; }
                    return null;
                });

                // Set table-layout: fixed on the table element
                tokens[i].attrJoin('style', 'table-layout: fixed; width: 100%;');

                // Walk through table tokens and apply width + alignment to th/td
                var colIndex = 0;
                for (var j = i + 1; j < tokens.length; j++) {
                    if (tokens[j].type === 'table_close') { break; }
                    if (tokens[j].type === 'tr_open') { colIndex = 0; }

                    if (tokens[j].type === 'th_open' || tokens[j].type === 'td_open') {
                        if (colIndex < widths.length) {
                            var style = 'width: ' + widths[colIndex].toFixed(2) + '%;';
                            if (aligns[colIndex]) {
                                style += ' text-align: ' + aligns[colIndex] + ';';
                            }
                            // Override any existing style (markdown-it sets text-align by default)
                            tokens[j].attrSet('style', style);
                        }
                        colIndex++;
                    }
                }
            }
        });
    }

    // Export for browser use
    window.markdownitTableWidths = tableWidthsPlugin;
})();
