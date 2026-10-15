/**
 * A deliberately small Markdown subset for assistant replies: headings,
 * paragraphs, bullet/numbered lists, tables, fenced code, **bold** and
 * `code`. Output is plain data to render as text nodes, never as HTML, so
 * model output cannot inject markup.
 */
type MarkdownBlock = {
    type: 'heading';
    level: 1 | 2 | 3 | 4 | 5 | 6;
    text: string;
} | {
    type: 'paragraph';
    text: string;
} | {
    type: 'list';
    ordered: boolean;
    items: string[];
} | {
    type: 'table';
    header: string[];
    rows: string[][];
} | {
    type: 'code';
    language?: string;
    text: string;
};
type InlineSegment = {
    text: string;
    bold?: boolean;
    code?: boolean;
};
declare function parseMarkdown(source: string): MarkdownBlock[];
/** Splits text into plain, **bold** and `code` segments. */
declare function parseInline(text: string): InlineSegment[];

export { parseInline, parseMarkdown };
export type { InlineSegment, MarkdownBlock };
