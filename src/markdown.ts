/**
 * A deliberately small Markdown subset for assistant replies: headings,
 * paragraphs, bullet/numbered lists, tables, fenced code, **bold** and
 * `code`. Output is plain data to render as text nodes, never as HTML, so
 * model output cannot inject markup.
 */
export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'code'; language?: string; text: string };

export type InlineSegment = { text: string; bold?: boolean; code?: boolean };

const TABLE_DIVIDER = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      // An unclosed fence (still streaming) runs to the end of the text.
      while (index < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[index]!)) {
        code.push(lines[index]!);
        index += 1;
      }
      blocks.push({ type: 'code', text: code.join('\n'), ...(fence[2] ? { language: fence[2] } : {}) });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, text: heading[2]!.trim() });
      continue;
    }

    if (line.includes('|') && TABLE_DIVIDER.test(lines[index + 1]?.trim() ?? '')) {
      flushParagraph();
      const header = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) {
        const cells = tableCells(lines[index]!);
        // Pad or cut rows to the header width so renderers get a rectangle.
        rows.push(header.map((_, column) => cells[column] ?? ''));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const items = [(bullet ?? numbered)![1]!];
      while (index + 1 < lines.length) {
        const next = (ordered ? NUMBERED : BULLET).exec(lines[index + 1]!);
        if (!next) break;
        items.push(next[1]!);
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

/** Splits text into plain, **bold** and `code` segments. */
export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const pattern = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    if (match[3] !== undefined) segments.push({ text: match[3], code: true });
    else segments.push({ text: (match[1] ?? match[2])!, bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
