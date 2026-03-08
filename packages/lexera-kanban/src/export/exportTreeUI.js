/**
 * Export tree selector UI.
 * Renders a board -> rows -> stacks -> columns scope selector and keeps
 * selection state in sync with ExportTreeBuilder.
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
            this.container.innerHTML = '<div class="export-selector-empty">No board content available</div>';
            return;
        }

        var main = document.createElement('div');
        main.className = 'export-selector-main';
        main.appendChild(this.renderFullBoardOption(tree));

        if (tree.children && tree.children.length > 0) {
            for (var i = 0; i < tree.children.length; i++) {
                main.appendChild(this.renderRow(tree.children[i]));
            }
        }

        this.container.appendChild(main);
    }

    renderFullBoardOption(node) {
        var el = document.createElement('div');
        el.className = this.getNodeClassName('export-selector-full', node);
        el.textContent = node.label || 'Full Board';
        el.dataset.nodeId = 'root';
        if (!node.excluded) {
            el.addEventListener('click', () => this.toggleNode('root'));
        }
        return el;
    }

    renderRow(rowNode) {
        var rowDiv = document.createElement('div');
        rowDiv.className = this.getNodeClassName('export-selector-row', rowNode);
        rowDiv.dataset.nodeId = ExportTreeBuilder.generateNodeId(rowNode);

        var label = document.createElement('div');
        label.className = 'export-selector-row-label';
        label.textContent = rowNode.label;
        if (!rowNode.excluded) {
            label.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleNode(rowDiv.dataset.nodeId);
            });
        }
        rowDiv.appendChild(label);

        var cols = document.createElement('div');
        cols.className = 'export-selector-columns-container';

        if (rowNode.children) {
            for (var i = 0; i < rowNode.children.length; i++) {
                var child = rowNode.children[i];
                if (child.type === 'stack') cols.appendChild(this.renderStack(child));
                else if (child.type === 'column') cols.appendChild(this.renderColumn(child));
            }
        }

        rowDiv.appendChild(cols);
        return rowDiv;
    }

    renderStack(stackNode) {
        var el = document.createElement('div');
        el.className = this.getNodeClassName('export-selector-stack', stackNode);
        el.dataset.nodeId = ExportTreeBuilder.generateNodeId(stackNode);
        if (!stackNode.excluded) {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleNode(el.dataset.nodeId);
            });
        }

        var label = document.createElement('div');
        label.className = 'export-selector-stack-label';
        label.textContent = stackNode.label;
        el.appendChild(label);

        if (stackNode.children) {
            for (var i = 0; i < stackNode.children.length; i++) {
                el.appendChild(this.renderStackedColumn(stackNode.children[i]));
            }
        }
        return el;
    }

    renderColumn(node) {
        var el = document.createElement('div');
        el.className = this.getNodeClassName('export-selector-column', node);
        el.dataset.nodeId = ExportTreeBuilder.generateNodeId(node);
        el.textContent = node.label;
        if (!node.excluded) {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleNode(el.dataset.nodeId);
            });
        }
        return el;
    }

    renderStackedColumn(node) {
        var el = document.createElement('div');
        el.className = this.getNodeClassName('export-selector-stacked-column', node);
        el.dataset.nodeId = ExportTreeBuilder.generateNodeId(node);
        el.textContent = node.label;
        if (!node.excluded) {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleNode(el.dataset.nodeId);
            });
        }
        return el;
    }

    getNodeClassName(baseClass, node) {
        var className = baseClass;
        if (node && node.excluded) className += ' excluded';
        else if (node && node.selected) className += ' selected';
        else if (node && node.partial) className += ' partial';
        return className;
    }

    toggleNode(nodeId) {
        if (!this.tree) return;
        var node = ExportTreeBuilder.findNodeById(this.tree, nodeId);
        if (!node || node.excluded) return;
        this.tree = ExportTreeBuilder.toggleSelection(this.tree, nodeId, !node.selected);
        this.updateSelectionClasses(this.tree);
        this.emitSelectionChange();
    }

    updateSelectionClasses(node) {
        if (!this.container || !node) return;
        var nodeId = ExportTreeBuilder.generateNodeId(node);
        var el = this.container.querySelector('[data-node-id="' + nodeId + '"]');
        if (el) {
            el.classList.toggle('selected', !!node.selected && !node.excluded);
            el.classList.toggle('partial', !!node.partial && !node.excluded);
            el.classList.toggle('excluded', !!node.excluded);
        }
        if (node.children) {
            for (var i = 0; i < node.children.length; i++) {
                this.updateSelectionClasses(node.children[i]);
            }
        }
    }

    getSelectedItems() {
        if (!this.tree) return [];
        return ExportTreeBuilder.getSelectedItems(this.tree);
    }

    getSelection() {
        if (!this.tree) {
            return {
                hasSelection: false,
                isFullBoard: false,
                columnIndexes: [],
                columnIds: [],
                scopes: [],
                summary: { label: 'No selection', key: 'none' },
            };
        }
        return ExportTreeBuilder.getSelection(this.tree);
    }

    setSelectionChangeCallback(cb) {
        this.onSelectionChange = cb;
    }

    clearSelection() {
        if (!this.tree) return;
        this.tree = ExportTreeBuilder.clearSelection(this.tree);
        this.updateSelectionClasses(this.tree);
        this.emitSelectionChange();
    }

    selectAll() {
        if (!this.tree) return;
        this.tree = ExportTreeBuilder.setOnlySelection(this.tree, 'root');
        this.updateSelectionClasses(this.tree);
        this.emitSelectionChange();
    }

    setOnlySelection(nodeId) {
        if (!this.tree) return;
        this.tree = ExportTreeBuilder.setOnlySelection(this.tree, nodeId);
        this.updateSelectionClasses(this.tree);
        this.emitSelectionChange();
    }

    emitSelectionChange() {
        if (typeof this.onSelectionChange === 'function') {
            this.onSelectionChange(this.getSelection());
        }
    }
}

window.ExportTreeUI = ExportTreeUI;
