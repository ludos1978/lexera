import MarkdownIt from 'markdown-it';
import markdownItAbbr from 'markdown-it-abbr';
import markdownItContainer from 'markdown-it-container';
import markdownItIns from 'markdown-it-ins';
import markdownItMark from 'markdown-it-mark';
import markdownItSub from 'markdown-it-sub';
import markdownItSup from 'markdown-it-sup';
import markdownItStrikethroughAlt from 'markdown-it-strikethrough-alt';
import markdownItUnderline from 'markdown-it-underline';
import markdownItMulticolumn from 'markdown-it-multicolumn';
import markdownItFootnoteHere from 'markdown-it-footnote-here';
import markdownItImageFigures from 'markdown-it-image-figures';

import {
    wikiLinksPlugin,
    tagPlugin,
    temporalTagPlugin,
    speakerNotePlugin,
    htmlCommentPlugin,
    includePlugin
} from './markdownItPlugins';

/**
 * Options for WYSIWYG markdown-it configuration
 * NEW SYSTEM:
 * - tagPrefix (#): handles all tags including people (people are just tags)
 * - temporalPrefix (@): handles all temporal (dates, times, weeks, weekdays)
 */
export type WysiwygMarkdownItOptions = {
    temporalPrefix?: string;
    tagPrefix?: string;
};

export function createWysiwygMarkdownIt(options: WysiwygMarkdownItOptions = {}): MarkdownIt {
    const enableTypographer = (typeof window !== 'undefined' && (window as any).configManager)
        ? (window as any).configManager.getConfig('enableTypographer', false)
        : false;
    const md = new MarkdownIt({
        html: true,
        linkify: false,
        typographer: !!enableTypographer,
        breaks: true
    });

    md.use(wikiLinksPlugin, { className: 'wiki-link' })
        .use(tagPlugin, { prefix: options.tagPrefix ?? '#' })
        .use(temporalTagPlugin, { prefix: options.temporalPrefix ?? '@' })
        .use(speakerNotePlugin)
        .use(htmlCommentPlugin)
        .use(includePlugin)
        .use(markdownItMulticolumn)
        .use(markdownItMark)
        .use(markdownItSub)
        .use(markdownItSup)
        .use(markdownItIns)
        .use(markdownItStrikethroughAlt)
        .use(markdownItUnderline)
        .use(markdownItAbbr)
        .use(markdownItFootnoteHere)
        .use(markdownItImageFigures, { figcaption: 'title' });

    const containers = [
        'note',
        'comment',
        'highlight',
        'mark-red',
        'mark-green',
        'mark-blue',
        'mark-cyan',
        'mark-magenta',
        'mark-yellow',
        'center',
        'center100',
        'right',
        'caption'
    ];

    containers.forEach(name => {
        md.use(markdownItContainer, name);
    });

    return md;
}
