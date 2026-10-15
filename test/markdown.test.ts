import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../src/markdown';

describe('parseMarkdown', () => {
  it('parses headings, paragraphs, lists and tables', () => {
    const blocks = parseMarkdown([
      '## Summary',
      'Income was **12 000 000** UZS.',
      'Second line.',
      '',
      '- one',
      '* two',
      '1. first',
      '2) second',
      '',
      '| Month | Profit |',
      '|---|---:|',
      '| May | 1 000 |',
      '| June |',
    ].join('\n'));
    expect(blocks).toEqual([
      { type: 'heading', level: 2, text: 'Summary' },
      { type: 'paragraph', text: 'Income was **12 000 000** UZS.\nSecond line.' },
      { type: 'list', ordered: false, items: ['one', 'two'] },
      { type: 'list', ordered: true, items: ['first', 'second'] },
      { type: 'table', header: ['Month', 'Profit'], rows: [['May', '1 000'], ['June', '']] },
    ]);
  });

  it('parses fenced code, including an unclosed fence while streaming', () => {
    expect(parseMarkdown('```sql\nselect 1;\n```\nafter')).toEqual([
      { type: 'code', language: 'sql', text: 'select 1;' },
      { type: 'paragraph', text: 'after' },
    ]);
    expect(parseMarkdown('```\npartial')).toEqual([{ type: 'code', text: 'partial' }]);
  });

  it('keeps raw HTML as plain text', () => {
    expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([{ type: 'paragraph', text: '<img src=x onerror=alert(1)>' }]);
  });
});

describe('parseInline', () => {
  it('splits bold and code', () => {
    expect(parseInline('a **b** `c` __d__ e')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', code: true },
      { text: ' ' },
      { text: 'd', bold: true },
      { text: ' e' },
    ]);
  });

  it('leaves unmatched markers alone', () => {
    expect(parseInline('2 * 3 = **6')).toEqual([{ text: '2 * 3 = **6' }]);
  });
});
