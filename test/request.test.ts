import { describe, expect, it } from 'vitest';
import { estimateTokens, parseChatRequest, trimHistory } from '../src/request';

describe('parseChatRequest', () => {
  it('accepts a question and keeps context', () => {
    expect(parseChatRequest({ messages: [{ role: 'user', content: ' hi ' }], context: { clubId: 'c' } })).toEqual({
      messages: [{ role: 'user', content: 'hi' }],
      context: { clubId: 'c' },
    });
  });

  it('rejects malformed bodies', () => {
    expect(parseChatRequest(null)).toBeNull();
    expect(parseChatRequest({ messages: [] })).toBeNull();
    expect(parseChatRequest({ messages: [{ role: 'system', content: 'x' }] })).toBeNull();
    expect(parseChatRequest({ messages: [{ role: 'user', content: '' }] })).toBeNull();
    expect(parseChatRequest({ messages: [{ role: 'user', content: 'x'.repeat(4001) }] })).toBeNull();
    expect(parseChatRequest({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] })).toBeNull();
    expect(parseChatRequest({ messages: [{ role: 'user', content: 'a' }], confirmation: { id: 'x', name: 'bad name!' } })).toBeNull();
  });

  it('allows a trailing assistant message with a confirmation', () => {
    const body = parseChatRequest({
      messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
      confirmation: { id: 'c1', name: 'add_expense', input: { amount: 1 }, token: 't' },
    });
    expect(body?.confirmation).toEqual({ id: 'c1', name: 'add_expense', input: { amount: 1 }, token: 't' });
  });

  it('trims long histories to start with a user turn', () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `m${index}` }));
    const body = parseChatRequest({ messages: [...messages, { role: 'user', content: 'last' }] });
    expect(body?.messages[0]?.role).toBe('user');
    expect(body?.messages.length).toBeLessThanOrEqual(30);
    expect(body?.messages.at(-1)?.content).toBe('last');
  });

  it('cuts long assistant messages instead of rejecting them', () => {
    const body = parseChatRequest({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'x'.repeat(9000) }, { role: 'user', content: 'b' }] });
    expect(body?.messages[1]?.content).toHaveLength(8000);
  });
});

describe('trimHistory', () => {
  it('drops a leading assistant message after trimming', () => {
    expect(trimHistory([
      { role: 'user', content: '1' },
      { role: 'assistant', content: '2' },
      { role: 'user', content: '3' },
    ], 2)).toEqual([{ role: 'user', content: '3' }]);
  });
});

describe('estimateTokens', () => {
  it('counts about four Latin characters or two and a half other characters per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(estimateTokens('я'.repeat(250))).toBe(100);
    expect(estimateTokens('abcd' + 'яя')).toBe(2);
  });
});
