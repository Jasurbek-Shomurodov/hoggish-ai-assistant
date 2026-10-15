// src/markdown.ts
var TABLE_DIVIDER = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;
var BULLET = /^\s*[-*•]\s+(.*)$/;
var NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
var HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
var FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
function parseMarkdown(source) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const code = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", text: code.join("\n"), ...fence[2] ? { language: fence[2] } : {} });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    if (line.includes("|") && TABLE_DIVIDER.test(lines[index + 1]?.trim() ?? "")) {
      flushParagraph();
      const header = tableCells(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const cells = tableCells(lines[index]);
        rows.push(header.map((_, column) => cells[column] ?? ""));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const items = [(bullet ?? numbered)[1]];
      while (index + 1 < lines.length) {
        const next = (ordered ? NUMBERED : BULLET).exec(lines[index + 1]);
        if (!next) break;
        items.push(next[1]);
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}
function parseInline(text) {
  const segments = [];
  const pattern = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    if (match[3] !== void 0) segments.push({ text: match[3], code: true });
    else segments.push({ text: match[1] ?? match[2], bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

export { parseInline, parseMarkdown };
//# sourceMappingURL=markdown.js.map
//# sourceMappingURL=markdown.js.map