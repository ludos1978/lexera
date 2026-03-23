/**
 * Build hierarchical tree structure for export dialog.
 * Organizes board into: Rows → Stacks → Columns.
 *
 * Ported from src/html/utils/exportTreeBuilder.js
 */

const PARKED_TAG = '#hidden-internal-parked';
const DELETED_TAG = '#hidden-internal-deleted';
const EXCLUDE_TAG_PATTERN = /#exclude(?=\s|$)/i;

class ExportTreeBuilder {
    static isHiddenItem(title) {
        return title && (title.includes(PARKED_TAG) || title.includes(DELETED_TAG));
    }

    static isExcludedItem(title) {
        return title && EXCLUDE_TAG_PATTERN.test(title);
    }

    /**
     * Build export tree from board data (columns array from REST API).
     * @param {{ columns: Array<{index: number, title: string, id?: string}> }} board
     * @returns {object|null} Hierarchical tree
     */
    static buildExportTree(board) {
        if (!board || !board.columns) return null;

        const tree = {
            type: 'root',
            label: 'Full Kanban',
            selected: false,
            scope: 'full',
            children: [],
        };

        const rowMap = new Map();

        board.columns.forEach((column, idx) => {
            const columnIndex = column.index !== undefined ? column.index : idx;
            if (this.isHiddenItem(column.title)) return;

            const rowNumber = this.getColumnRow(column.title);
            if (!rowMap.has(rowNumber)) rowMap.set(rowNumber, []);
            rowMap.get(rowNumber).push({
                column,
                columnIndex,
                isStacked: this.isColumnStacked(column.title),
                excluded: this.isExcludedItem(column.title),
            });
        });

        const sortedRows = Array.from(rowMap.entries()).sort((a, b) => a[0] - b[0]);

        sortedRows.forEach(([rowNumber, columns]) => {
            const rowNode = {
                type: 'row',
                label: `Row ${rowNumber}`,
                selected: false,
                scope: 'row',
                rowNumber,
                children: [],
            };

            const stacks = this.groupIntoStacks(columns);

            stacks.forEach((stack, stackIndex) => {
                if (stack.length > 1) {
                    const stackLabel = stack
                        .map(item => this.getCleanColumnTitle(item.column.title) || 'Untitled')
                        .join(', ');

                    const stackNode = {
                        type: 'stack',
                        label: `Stack (${stackLabel})`,
                        selected: false,
                        scope: 'stack',
                        rowNumber,
                        stackIndex,
                        children: [],
                    };

                    stack.forEach(item => {
                        const title = this.getCleanColumnTitle(item.column.title) || 'Untitled';
                        const node = {
                            type: 'column',
                            label: `Column: ${title}`,
                            selected: false,
                            scope: 'column',
                            columnIndex: item.columnIndex,
                            columnId: item.column.id,
                            children: [],
                        };
                        if (item.excluded) node.excluded = true;
                        stackNode.children.push(node);
                    });

                    rowNode.children.push(stackNode);
                } else {
                    const item = stack[0];
                    const title = this.getCleanColumnTitle(item.column.title) || 'Untitled';
                    const node = {
                        type: 'column',
                        label: `Column: ${title}`,
                        selected: false,
                        scope: 'column',
                        columnIndex: item.columnIndex,
                        columnId: item.column.id,
                        children: [],
                    };
                    if (item.excluded) node.excluded = true;
                    rowNode.children.push(node);
                }
            });

            tree.children.push(rowNode);
        });

        return tree;
    }

    static getColumnRow(title) {
        if (!title) return 1;
        const matches = title.match(/#row(\d+)\b/gi);
        if (matches && matches.length > 0) {
            const num = parseInt(matches[matches.length - 1].replace(/#row/i, ''), 10);
            return isNaN(num) ? 1 : num;
        }
        return 1;
    }

    static isColumnStacked(title) {
        return /#stack\b/i.test(title);
    }

    static getCleanColumnTitle(title) {
        if (!title) return '';
        return title
            .replace(/#row\d+/gi, '')
            .replace(/#span\d+/gi, '')
            .replace(/#stack\b/gi, '')
            .replace(/#hidden-internal-parked\b/gi, '')
            .replace(/#hidden-internal-deleted\b/gi, '')
            .replace(/#exclude\b/gi, '')
            .trim();
    }

    static groupIntoStacks(columns) {
        const stacks = [];
        let i = 0;
        while (i < columns.length) {
            const currentStack = [columns[i]];
            i++;
            while (i < columns.length && columns[i].isStacked) {
                currentStack.push(columns[i]);
                i++;
            }
            stacks.push(currentStack);
        }
        return stacks;
    }

    static getSelectedItems(tree) {
        const columnIndexes = new Set();
        const traverse = (node) => {
            if (node.selected) {
                this.collectColumnIndexes(node, columnIndexes);
            } else if (node.children) {
                node.children.forEach(child => traverse(child));
            }
        };
        traverse(tree);
        return Array.from(columnIndexes);
    }

    static collectColumnIndexes(node, set) {
        if (node.type === 'column' && node.columnIndex !== undefined && !node.excluded) {
            set.add(node.columnIndex);
        }
        if (node.children) {
            node.children.forEach(child => this.collectColumnIndexes(child, set));
        }
    }

    static toggleSelection(tree, nodeId, selected) {
        const node = this.findNodeById(tree, nodeId);
        if (!node || node.excluded) return tree;
        node.selected = selected;
        if (node.children) this.selectAllChildren(node, selected);
        this.updateParentSelection(tree);
        return tree;
    }

    static selectAllChildren(node, selected) {
        if (!node.children) return;
        node.children.forEach(child => {
            if (!child.excluded) child.selected = selected;
            this.selectAllChildren(child, selected);
        });
    }

    static updateParentSelection(node) {
        if (!node.children || node.children.length === 0) return;
        node.children.forEach(child => this.updateParentSelection(child));
        const selectable = node.children.filter(c => !c.excluded);
        if (selectable.length > 0 && selectable.every(c => c.selected)) {
            node.selected = true;
        } else if (selectable.some(c => !c.selected)) {
            node.selected = false;
        }
    }

    static findNodeById(tree, id) {
        if (this.generateNodeId(tree) === id) return tree;
        if (!tree.children) return null;
        for (const child of tree.children) {
            const found = this.findNodeById(child, id);
            if (found) return found;
        }
        return null;
    }

    static generateNodeId(node) {
        if (node.type === 'root') return 'root';
        if (node.type === 'row') return `row-${node.rowNumber}`;
        if (node.type === 'stack') return `stack-${node.rowNumber}-${node.stackIndex}`;
        if (node.type === 'column') return `column-${node.columnIndex}`;
        return 'unknown';
    }

    static getSelectedColumnLabels(tree) {
        const labels = [];
        const traverse = (node) => {
            if (node.type === 'column' && node.selected) {
                const clean = node.label.replace(/^Column:\s*/, '').trim();
                if (clean) labels.push(clean);
            } else if (node.children) {
                node.children.forEach(child => traverse(child));
            }
        };
        traverse(tree);
        return labels;
    }
}

window.ExportTreeBuilder = ExportTreeBuilder;
