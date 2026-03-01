/**
 * Export Tree UI Component.
 * Renders kanban-style visual selector (rows horizontal, stacks vertical).
 *
 * Ported from src/html/utils/exportTreeUI.js
 */

class ExportTreeUI {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.tree = null;
        this.onSelectionChange = null;
    }

    render(tree) {
        this.tree = tree;
        if (!this.container) return;
        this.container.innerHTML = '';
        if (!tree) {
            this.container.innerHTML = '<div class="export-selector-empty">No columns available</div>';
            return;
        }

        const main = document.createElement('div');
        main.className = 'export-selector-main';

        main.appendChild(this.renderFullKanbanOption(tree));

        if (tree.children && tree.children.length > 0) {
            tree.children.forEach(rowNode => main.appendChild(this.renderRow(rowNode)));
        }

        this.container.appendChild(main);
    }

    renderFullKanbanOption(node) {
        const el = document.createElement('div');
        el.className = 'export-selector-full' + (node.selected ? ' selected' : '');
        el.textContent = 'Full Kanban';
        el.dataset.nodeId = 'root';
        el.addEventListener('click', () => this.toggleNode('root'));
        return el;
    }

    renderRow(rowNode) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'export-selector-row' + (rowNode.selected ? ' selected' : '');
        rowDiv.dataset.nodeId = ExportTreeBuilder.generateNodeId(rowNode);

        const label = document.createElement('div');
        label.className = 'export-selector-row-label';
        label.textContent = rowNode.label;
        label.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleNode(rowDiv.dataset.nodeId);
        });
        rowDiv.appendChild(label);

        const cols = document.createElement('div');
        cols.className = 'export-selector-columns-container';

        if (rowNode.children) {
            rowNode.children.forEach(child => {
                if (child.type === 'stack') cols.appendChild(this.renderStack(child));
                else if (child.type === 'column') cols.appendChild(this.renderColumn(child));
            });
        }

        rowDiv.appendChild(cols);
        return rowDiv;
    }

    renderStack(stackNode) {
        const el = document.createElement('div');
        el.className = 'export-selector-stack' + (stackNode.selected ? ' selected' : '');
        el.dataset.nodeId = ExportTreeBuilder.generateNodeId(stackNode);
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleNode(el.dataset.nodeId);
        });

        const label = document.createElement('div');
        label.className = 'export-selector-stack-label';
        label.textContent = 'Stack';
        el.appendChild(label);

        if (stackNode.children) {
            stackNode.children.forEach(col => el.appendChild(this.renderStackedColumn(col)));
        }
        return el;
    }

    renderColumn(node) {
        const el = document.createElement('div');
        el.className = 'export-selector-column';
        if (node.excluded) el.className += ' excluded';
        else if (node.selected) el.className += ' selected';
        el.dataset.nodeId = ExportTreeBuilder.generateNodeId(node);
        el.textContent = node.label.replace(/^Column:\s*/, '');
        if (!node.excluded) {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleNode(el.dataset.nodeId);
            });
        }
        return el;
    }

    renderStackedColumn(node) {
        const el = document.createElement('div');
        el.className = 'export-selector-stacked-column';
        if (node.excluded) el.className += ' excluded';
        else if (node.selected) el.className += ' selected';
        el.dataset.nodeId = ExportTreeBuilder.generateNodeId(node);
        el.textContent = node.label.replace(/^Column:\s*/, '');
        if (!node.excluded) {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleNode(el.dataset.nodeId);
            });
        }
        return el;
    }

    toggleNode(nodeId) {
        if (!this.tree) return;
        const node = ExportTreeBuilder.findNodeById(this.tree, nodeId);
        if (!node) return;
        this.tree = ExportTreeBuilder.toggleSelection(this.tree, nodeId, !node.selected);
        this.updateSelectionClasses(this.tree);
        if (this.onSelectionChange) {
            this.onSelectionChange(ExportTreeBuilder.getSelectedItems(this.tree));
        }
    }

    /**
     * Update CSS 'selected' classes on existing DOM elements to match tree state,
     * without rebuilding the DOM. Walks the tree and finds each node's element
     * by its data-node-id attribute.
     */
    updateSelectionClasses(node) {
        if (!this.container) return;
        const nodeId = ExportTreeBuilder.generateNodeId(node);
        const el = this.container.querySelector('[data-node-id="' + nodeId + '"]');
        if (el && !node.excluded) {
            if (node.selected) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        }
        if (node.children) {
            node.children.forEach(child => this.updateSelectionClasses(child));
        }
    }

    getSelectedItems() {
        if (!this.tree) return [];
        return ExportTreeBuilder.getSelectedItems(this.tree);
    }

    setSelectionChangeCallback(cb) { this.onSelectionChange = cb; }

    clearSelection() {
        if (!this.tree) return;
        this.tree = ExportTreeBuilder.toggleSelection(this.tree, 'root', false);
        this.updateSelectionClasses(this.tree);
    }

    selectAll() {
        if (!this.tree) return;
        this.tree = ExportTreeBuilder.toggleSelection(this.tree, 'root', true);
        this.updateSelectionClasses(this.tree);
    }
}

window.ExportTreeUI = ExportTreeUI;
