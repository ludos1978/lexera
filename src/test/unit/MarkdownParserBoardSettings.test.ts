import { MarkdownKanbanParser } from '../../markdownParser';

describe('MarkdownKanbanParser.updateYamlWithBoardSettings', () => {
    it('preserves existing board settings when settings object does not provide them', () => {
        const yamlHeader = [
            '---',
            'kanban-plugin: board',
            'columnWidth: 550px',
            'layoutRows: 2',
            'maxRowHeight: 400',
            'fontSize: 1_25x',
            '---'
        ].join('\n');

        const updated = MarkdownKanbanParser.updateYamlWithBoardSettings(yamlHeader, {});
        expect(updated).toContain('columnWidth: 550px');
        expect(updated).toContain('layoutRows: 2');
        expect(updated).toContain('maxRowHeight: 400');
        expect(updated).toContain('fontSize: 1_25x');
    });

    it('updates explicitly provided settings while preserving others', () => {
        const yamlHeader = [
            '---',
            'kanban-plugin: board',
            'columnWidth: 350px',
            'layoutRows: 1',
            'maxRowHeight: 0',
            'fontSize: 1x',
            '---'
        ].join('\n');

        const updated = MarkdownKanbanParser.updateYamlWithBoardSettings(yamlHeader, {
            columnWidth: '650px',
            layoutRows: 3,
            maxRowHeight: 700
        });

        expect(updated).toContain('columnWidth: 650px');
        expect(updated).toContain('layoutRows: 3');
        expect(updated).toContain('maxRowHeight: 700');
        expect(updated).toContain('fontSize: 1x');
        expect(updated).not.toContain('columnWidth: 350px');
        expect(updated).not.toContain('layoutRows: 1');
        expect(updated).not.toContain('maxRowHeight: 0');
    });

    it('adds new board settings when they are missing in the existing header', () => {
        const yamlHeader = [
            '---',
            'kanban-plugin: board',
            'columnWidth: 350px',
            '---'
        ].join('\n');

        const updated = MarkdownKanbanParser.updateYamlWithBoardSettings(yamlHeader, {
            rowHeight: '500px',
            tagVisibility: 'customonly'
        });

        expect(updated).toContain('columnWidth: 350px');
        expect(updated).toContain('rowHeight: 500px');
        expect(updated).toContain('tagVisibility: customonly');
    });
});

describe('MarkdownKanbanParser board settings parsing', () => {
    it('parses board settings from YAML with layoutRows as number', () => {
        const markdown = [
            '---',
            'kanban-plugin: board',
            'columnWidth: 650px',
            'layoutRows: 3',
            'maxRowHeight: 500',
            'rowHeight: 500px',
            'fontSize: 1_25x',
            'layoutPreset: focused',
            '---',
            '## Todo',
            '- [ ] Task'
        ].join('\n');

        const parsed = MarkdownKanbanParser.parseMarkdown(markdown);

        expect(parsed.board.boardSettings).toMatchObject({
            columnWidth: '650px',
            layoutRows: 3,
            maxRowHeight: 500,
            rowHeight: '500px',
            fontSize: '1_25x',
            layoutPreset: 'focused'
        });
    });
});
