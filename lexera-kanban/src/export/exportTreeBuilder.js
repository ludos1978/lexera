/**
 * Build the hierarchical selection tree for the export dialog from the
 * board's row -> stack -> column structure.
 */

const PARKED_TAG = '#hidden-internal-parked';
const DELETED_TAG = '#hidden-internal-deleted';
const ARCHIVED_TAG = '#hidden-internal-archived';
const PLAIN_HIDDEN_TAG_PATTERN = /(^|\s)#hidden(?=\s|$)/i;
const EXCLUDE_TAG_PATTERN = /#exclude(?=\s|$)/i;

class ExportTreeBuilder {
    static isHiddenItem(title) {
        var value = String(title || '');
        return !!value && (
            value.indexOf(PARKED_TAG) !== -1 ||
            value.indexOf(DELETED_TAG) !== -1 ||
            value.indexOf(ARCHIVED_TAG) !== -1 ||
            PLAIN_HIDDEN_TAG_PATTERN.test(value)
        );
    }

    static isExcludedItem(title) {
        return EXCLUDE_TAG_PATTERN.test(String(title || ''));
    }

    /**
     * Build export tree from board data.
     * @param {{ rows?: Array, columns?: Array }} board
     * @returns {object}
     */
    static buildExportTree(board) {
        var rows = this.normalizeBoardRows(board);
        var tree = {
            type: 'root',
            label: 'Full Board',
            explicitSelected: false,
            selected: false,
            partial: false,
            excluded: false,
            scope: 'board',
            children: [],
        };

        var flatVisibleColumnIndex = 0;

        for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            var row = rows[rowIndex];
            if (!row || this.isHiddenItem(row.title)) continue;

            var rowNode = {
                type: 'row',
                label: this.cleanHierarchyTitle(row.title, 'Row ' + (rowIndex + 1)),
                explicitSelected: false,
                selected: false,
                partial: false,
                excluded: false,
                scope: 'row',
                rowIndex: rowIndex,
                children: [],
            };

            var stacks = Array.isArray(row.stacks) ? row.stacks : [];
            for (var stackIndex = 0; stackIndex < stacks.length; stackIndex++) {
                var stack = stacks[stackIndex];
                if (!stack || this.isHiddenItem(stack.title)) continue;

                var stackNode = {
                    type: 'stack',
                    label: this.cleanHierarchyTitle(stack.title, 'Stack ' + (stackIndex + 1)),
                    explicitSelected: false,
                    selected: false,
                    partial: false,
                    excluded: false,
                    scope: 'stack',
                    rowIndex: rowIndex,
                    stackIndex: stackIndex,
                    children: [],
                };

                var columns = Array.isArray(stack.columns) ? stack.columns : [];
                for (var columnIndex = 0; columnIndex < columns.length; columnIndex++) {
                    var column = columns[columnIndex];
                    if (!column || this.isHiddenItem(column.title)) continue;

                    var columnNode = {
                        type: 'column',
                        label: this.cleanHierarchyTitle(column.title, 'Column ' + (columnIndex + 1)),
                        explicitSelected: false,
                        selected: false,
                        partial: false,
                        excluded: this.isExcludedItem(column.title),
                        scope: 'column',
                        rowIndex: rowIndex,
                        stackIndex: stackIndex,
                        columnIndex: columnIndex,
                        flatColumnIndex: flatVisibleColumnIndex,
                        columnId: column.id || null,
                        children: [],
                    };
                    flatVisibleColumnIndex += 1;
                    stackNode.children.push(columnNode);
                }

                if (stackNode.children.length > 0) rowNode.children.push(stackNode);
            }

            if (rowNode.children.length > 0) tree.children.push(rowNode);
        }

        this.finalizeNode(tree, true);
        this.refreshSelectionState(tree, false, true);
        return tree;
    }

    static normalizeBoardRows(board) {
        if (!board) return [];
        if (Array.isArray(board.rows) && board.rows.length > 0) return board.rows;
        return [];
    }

    static cleanHierarchyTitle(title, fallback) {
        var stripped = typeof LexeraTagSystem !== 'undefined'
            ? LexeraTagSystem.stripInternalHiddenTags(LexeraTagSystem.stripLayoutTags(String(title || '')))
            : this.stripHtmlComments(String(title || ''))
                .replace(/#row\d+\b/gi, '')
                .replace(/#span\d+\b/gi, '')
                .replace(/#stack\b/gi, '')
                .replace(/#hidden-internal-(?:parked|archived|deleted)\b/gi, '');
        var value = stripped
            .replace(PLAIN_HIDDEN_TAG_PATTERN, ' ')
            .replace(EXCLUDE_TAG_PATTERN, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();
        return value || String(fallback || '').trim() || 'Untitled';
    }

    static stripHtmlComments(value) {
        return String(value || '').replace(/<!--[\s\S]*?-->/g, '').trim();
    }

    static finalizeNode(node, isRoot) {
        if (!node || !node.children || node.children.length === 0) {
            node.partial = false;
            if (!isRoot) node.excluded = !!node.excluded;
            return node.excluded ? 0 : 1;
        }

        var selectableChildren = 0;
        for (var i = 0; i < node.children.length; i++) {
            selectableChildren += this.finalizeNode(node.children[i], false);
        }

        node.selected = false;
        node.partial = false;
        node.explicitSelected = !!node.explicitSelected;
        if (!isRoot) node.excluded = selectableChildren === 0;
        return node.excluded ? 0 : selectableChildren;
    }

    static getSelection(tree) {
        var columnIndexes = new Set();
        var columnIds = new Set();
        var scopes = [];

        var traverse = (node) => {
            if (!node || node.excluded) return;
            if (node.selected) {
                scopes.push(this.describeSelectionNode(node));
                this.collectColumnRefs(node, columnIndexes, columnIds);
                return;
            }
            if (!node.children) return;
            for (var i = 0; i < node.children.length; i++) {
                traverse(node.children[i]);
            }
        };

        traverse(tree);

        var selection = {
            hasSelection: scopes.length > 0,
            isFullBoard: !!(tree && tree.selected),
            columnIndexes: Array.from(columnIndexes).sort(function (a, b) { return a - b; }),
            columnIds: Array.from(columnIds),
            scopes: scopes,
        };
        selection.summary = this.summarizeSelection(selection);
        return selection;
    }

    static describeSelectionNode(node) {
        return {
            nodeId: this.generateNodeId(node),
            scope: node.type === 'root' ? 'board' : node.scope,
            label: node.label,
            rowIndex: typeof node.rowIndex === 'number' ? node.rowIndex : null,
            stackIndex: typeof node.stackIndex === 'number' ? node.stackIndex : null,
            columnIndex: typeof node.columnIndex === 'number' ? node.columnIndex : null,
            flatColumnIndex: typeof node.flatColumnIndex === 'number' ? node.flatColumnIndex : null,
            columnId: node.columnId || null,
        };
    }

    static collectColumnRefs(node, columnIndexes, columnIds) {
        if (!node || node.excluded) return;
        if (node.type === 'column') {
            if (typeof node.flatColumnIndex === 'number') columnIndexes.add(node.flatColumnIndex);
            if (node.columnId) columnIds.add(node.columnId);
            return;
        }
        if (!node.children) return;
        for (var i = 0; i < node.children.length; i++) {
            this.collectColumnRefs(node.children[i], columnIndexes, columnIds);
        }
    }

    static summarizeSelection(selection) {
        if (!selection || !selection.hasSelection) {
            return { label: 'No selection', key: 'none' };
        }
        if (selection.isFullBoard) {
            return { label: 'Full board', key: 'full' };
        }

        var scopes = selection.scopes || [];
        var labels = scopes
            .map(function (scope) { return String(scope.label || '').trim(); })
            .filter(function (label) { return label.length > 0; });

        if (scopes.length === 1) {
            return {
                label: labels[0] || 'Selection',
                key: this.sanitizeRangeToken(labels[0] || scopes[0].scope || 'selection'),
            };
        }

        if (labels.length > 0 && labels.length <= 3) {
            var compact = labels.join(', ');
            return {
                label: compact,
                key: this.sanitizeRangeToken(labels.join('-')) || (labels.length + '-scopes'),
            };
        }

        var counts = { board: 0, row: 0, stack: 0, column: 0 };
        for (var i = 0; i < scopes.length; i++) {
            var scopeType = scopes[i].scope;
            if (Object.prototype.hasOwnProperty.call(counts, scopeType)) counts[scopeType] += 1;
        }

        var parts = [];
        if (counts.board) parts.push(counts.board + ' board');
        if (counts.row) parts.push(counts.row + (counts.row === 1 ? ' row' : ' rows'));
        if (counts.stack) parts.push(counts.stack + (counts.stack === 1 ? ' stack' : ' stacks'));
        if (counts.column) parts.push(counts.column + (counts.column === 1 ? ' column' : ' columns'));

        return {
            label: parts.join(', ') || (scopes.length + ' scopes'),
            key: this.buildCountSummaryKey(counts, scopes.length),
        };
    }

    static buildCountSummaryKey(counts, fallbackCount) {
        var parts = [];
        if (counts.board) parts.push(counts.board + 'board');
        if (counts.row) parts.push(counts.row + 'rows');
        if (counts.stack) parts.push(counts.stack + 'stacks');
        if (counts.column) parts.push(counts.column + 'cols');
        if (parts.length === 0) return String(fallbackCount || 0) + '-scopes';
        return parts.join('-');
    }

    static sanitizeRangeToken(value) {
        return String(value || '')
            .replace(/[^a-zA-Z0-9_-]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 40)
            .toLowerCase();
    }

    static getSelectedItems(tree) {
        return this.getSelection(tree).columnIndexes;
    }

    static getSelectedColumnLabels(tree) {
        var labels = [];
        var selection = this.getSelection(tree);
        for (var i = 0; i < selection.scopes.length; i++) {
            if (selection.scopes[i].scope === 'column' && selection.scopes[i].label) {
                labels.push(selection.scopes[i].label);
            }
        }
        return labels;
    }

    static toggleSelection(tree, nodeId, selected) {
        var node = this.findNodeById(tree, nodeId);
        if (!node || node.excluded) return tree;
        node.explicitSelected = !!selected;
        if (node.children && node.children.length > 0) {
            this.clearExplicitSelection(node.children);
        }
        this.refreshSelectionState(tree, false, true);
        return tree;
    }

    static clearSelection(tree) {
        if (!tree) return tree;
        tree.explicitSelected = false;
        this.clearExplicitSelection(tree.children);
        this.refreshSelectionState(tree, false, true);
        return tree;
    }

    static setOnlySelection(tree, nodeId) {
        if (!tree) return tree;
        this.clearSelection(tree);
        if (!nodeId) return tree;
        return this.toggleSelection(tree, nodeId, true);
    }

    static clearExplicitSelection(nodes) {
        if (!Array.isArray(nodes)) return;
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].explicitSelected = false;
            if (nodes[i].children && nodes[i].children.length > 0) {
                this.clearExplicitSelection(nodes[i].children);
            }
        }
    }

    static refreshSelectionState(node, inheritedSelected, isRoot) {
        if (!node) return false;
        if (node.excluded) {
            node.selected = false;
            node.partial = false;
            return false;
        }

        var isSelected = !!inheritedSelected || !!node.explicitSelected;
        node.selected = isSelected;
        node.partial = false;

        if (!node.children || node.children.length === 0) {
            return isSelected;
        }

        var anyChildActive = false;
        for (var i = 0; i < node.children.length; i++) {
            if (this.refreshSelectionState(node.children[i], isSelected, false)) {
                anyChildActive = true;
            }
        }

        if (!isSelected) {
            node.partial = anyChildActive;
        } else if (!isRoot) {
            node.partial = false;
        }

        return isSelected || anyChildActive;
    }

    static findNodeById(tree, id) {
        if (!tree) return null;
        if (this.generateNodeId(tree) === id) return tree;
        if (!tree.children) return null;
        for (var i = 0; i < tree.children.length; i++) {
            var found = this.findNodeById(tree.children[i], id);
            if (found) return found;
        }
        return null;
    }

    static findNode(tree, predicate) {
        if (!tree || typeof predicate !== 'function') return null;
        if (predicate(tree)) return tree;
        if (!tree.children) return null;
        for (var i = 0; i < tree.children.length; i++) {
            var found = this.findNode(tree.children[i], predicate);
            if (found) return found;
        }
        return null;
    }

    static generateNodeId(node) {
        if (!node) return 'unknown';
        if (node.type === 'root') return 'root';
        if (node.type === 'row') return 'row-' + node.rowIndex;
        if (node.type === 'stack') return 'stack-' + node.rowIndex + '-' + node.stackIndex;
        if (node.type === 'column') return 'column-' + node.rowIndex + '-' + node.stackIndex + '-' + node.columnIndex;
        return 'unknown';
    }

    static resolveNodeIdForSelection(tree, selection) {
        if (!tree) return null;
        var scope = selection && selection.scope ? String(selection.scope).toLowerCase() : 'board';
        if (scope === 'board' || scope === 'full' || scope === 'root') return 'root';
        if (scope === 'row' && typeof selection.rowIndex === 'number') {
            var rowId = 'row-' + selection.rowIndex;
            return this.findNodeById(tree, rowId) ? rowId : null;
        }
        if (scope === 'stack' && typeof selection.rowIndex === 'number' && typeof selection.stackIndex === 'number') {
            var stackId = 'stack-' + selection.rowIndex + '-' + selection.stackIndex;
            return this.findNodeById(tree, stackId) ? stackId : null;
        }
        if (scope === 'column') {
            if (typeof selection.rowIndex === 'number' && typeof selection.stackIndex === 'number' && typeof selection.columnIndex === 'number') {
                var columnId = 'column-' + selection.rowIndex + '-' + selection.stackIndex + '-' + selection.columnIndex;
                if (this.findNodeById(tree, columnId)) return columnId;
            }
            if (selection.columnId) {
                var byColumnId = this.findNode(tree, function (node) {
                    return node.type === 'column' && node.columnId === selection.columnId;
                });
                if (byColumnId) return this.generateNodeId(byColumnId);
            }
            if (typeof selection.flatColumnIndex === 'number') {
                var byFlatIndex = this.findNode(tree, function (node) {
                    return node.type === 'column' && node.flatColumnIndex === selection.flatColumnIndex;
                });
                if (byFlatIndex) return this.generateNodeId(byFlatIndex);
            }
        }
        return null;
    }
}

window.ExportTreeBuilder = ExportTreeBuilder;
