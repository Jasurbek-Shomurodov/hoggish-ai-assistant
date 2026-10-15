import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AssistantError, createAssistantHandler, type AssistantHandlerOptions } from '../src/handler';
import { createMemoryQuotaStore, quotaDate } from '../src/quota';
import { defineTool, ToolError, type AssistantTools } from '../src/tools';
import type { AssistantProvider } from '../src/providers';
import { apiError, chainProvider, chatRequest, collect, dailyQuotaError, minuteQuotaError, textOf } from './helpers';

const question = { messages: [{ role: 'user', content: 'How much did we earn?' }] };

function handlerFor(provider: AssistantProvider, extra: Partial<AssistantHandlerOptions<{ userId: string }>> = {}) {
  return createAssistantHandler<{ userId: string }>({
    authorize: () => ({ userId: 'u1' }),
    provider,
    system: 'You are a test assistant.',
    context: () => 'Today is 2026-10-15.',
    onError: () => {},
    ...extra,
  });
}

describe('chat handler basics', () => {
  it('streams text then done', async () => {
    const provider = chainProvider([{ id: 'm1', responses: [{ text: ['Hello', ', world'] }] }]);
    const events = await collect(await handlerFor(provider).chat(chatRequest(question)));
    expect(textOf(events)).toBe('Hello, world');
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(provider.mocks[0]!.doStreamCalls).toHaveLength(1);
  });

  it('sends system prompt and per-request context as instructions', async () => {
    const provider = chainProvider([{ id: 'm1', responses: [{ text: 'ok' }] }]);
    await collect(await handlerFor(provider).chat(chatRequest(question)));
    const prompt = provider.mocks[0]!.doStreamCalls[0]!.prompt;
    expect(prompt.filter((message) => message.role === 'system').map((message) => message.content)).toEqual([
      'You are a test assistant.',
      'Today is 2026-10-15.',
    ]);
  });

  it('rejects unauthorized, forbidden, invalid and unconfigured requests', async () => {
    const provider = chainProvider([{ id: 'm1', responses: [{ text: 'ok' }] }]);
    const anonymous = handlerFor(provider, { authorize: () => null });
    expect((await anonymous.chat(chatRequest(question))).status).toBe(401);

    const forbidden = handlerFor(provider, { authorize: () => { throw new AssistantError('FORBIDDEN'); } });
    const response = await forbidden.chat(chatRequest(question));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'FORBIDDEN' });

    const invalid = await handlerFor(provider).chat(chatRequest({ messages: [{ role: 'assistant', content: 'hi' }] }));
    expect(await invalid.json()).toEqual({ error: 'INVALID_REQUEST' });

    const notJson = await handlerFor(provider).chat(new Request('https://app.test', { method: 'POST', body: '{' }));
    expect(notJson.status).toBe(400);

    const unconfigured = handlerFor({ ...provider, configured: false });
    expect(await (await unconfigured.chat(chatRequest(question))).json()).toEqual({ error: 'NOT_CONFIGURED' });
  });

  it('passes the client context to authorize', async () => {
    const authorize = vi.fn(() => ({ userId: 'u1' }));
    const provider = chainProvider([{ id: 'm1', responses: [{ text: 'ok' }] }]);
    await collect(await handlerFor(provider, { authorize }).chat(chatRequest({ ...question, context: { clubId: 'c1' } })));
    expect(authorize).toHaveBeenCalledWith(expect.any(Request), { clubId: 'c1' });
  });

  it('reports an empty answer as REFUSED', async () => {
    const provider = chainProvider([{ id: 'm1', responses: [{ finish: 'content-filter' }] }]);
    const events = await collect(await handlerFor(provider).chat(chatRequest(question)));
    expect(events).toContainEqual({ type: 'error', code: 'REFUSED' });
  });
});

describe('tool loop', () => {
  const tools = (log: unknown[]): AssistantTools => ({
    get_total: defineTool({
      description: 'Total income for a month',
      inputSchema: z.object({ month: z.string() }),
      execute: async ({ month }, { attachFile }) => {
        log.push(month);
        if (month === 'bad') throw new ToolError('Unknown month');
        attachFile({ fileName: 'total.txt', mimeType: 'text/plain', data: new TextEncoder().encode('42') });
        return { total: 42 };
      },
    }),
  });

  it('runs tools, streams status and files, and feeds results back', async () => {
    const log: unknown[] = [];
    const provider = chainProvider([{
      id: 'm1',
      responses: [
        { text: 'Let me check.', calls: [{ id: 'c1', name: 'get_total', input: { month: '2026-09' } }] },
        { text: 'You earned 42.' },
      ],
    }]);
    const events = await collect(await handlerFor(provider, { tools: () => tools(log) }).chat(chatRequest(question)));
    expect(log).toEqual(['2026-09']);
    expect(events).toContainEqual({ type: 'tool', name: 'get_total', id: 'c1' });
    expect(events).toContainEqual({ type: 'file', fileName: 'total.txt', mimeType: 'text/plain', data: btoa('42') });
    expect(textOf(events)).toBe('Let me check.\n\nYou earned 42.');

    const second = provider.mocks[0]!.doStreamCalls[1]!.prompt;
    const toolMessage = second.find((message) => message.role === 'tool');
    expect(JSON.stringify(toolMessage)).toContain('"total":42');
  });

  it('returns ToolError messages to the model as error results', async () => {
    const provider = chainProvider([{
      id: 'm1',
      responses: [{ calls: [{ id: 'c1', name: 'get_total', input: { month: 'bad' } }] }, { text: 'Sorry.' }],
    }]);
    await collect(await handlerFor(provider, { tools: () => tools([]) }).chat(chatRequest(question)));
    const toolMessage = provider.mocks[0]!.doStreamCalls[1]!.prompt.find((message) => message.role === 'tool');
    expect(JSON.stringify(toolMessage)).toContain('Unknown month');
  });

  it('hides unexpected tool errors from the model and reports them', async () => {
    const onError = vi.fn();
    const provider = chainProvider([{
      id: 'm1',
      responses: [{ calls: [{ id: 'c1', name: 'boom', input: {} }] }, { text: 'Sorry.' }],
    }]);
    const boom: AssistantTools = {
      boom: defineTool({ description: 'fails', inputSchema: z.object({}), execute: () => { throw new Error('db password=secret'); } }),
    };
    await collect(await handlerFor(provider, { tools: () => boom, onError }).chat(chatRequest(question)));
    const toolMessage = JSON.stringify(provider.mocks[0]!.doStreamCalls[1]!.prompt.find((message) => message.role === 'tool'));
    expect(toolMessage).not.toContain('secret');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ stage: 'tool', tool: 'boom' }));
  });

  it('stops after the maximum number of rounds', async () => {
    const provider = chainProvider([{ id: 'm1', responses: [{ calls: [{ id: 'c1', name: 'get_total', input: { month: 'x' } }] }] }]);
    const events = await collect(await handlerFor(provider, { tools: () => tools([]), maxRounds: 3 }).chat(chatRequest(question)));
    expect(provider.mocks[0]!.doStreamCalls).toHaveLength(3);
    expect(events).toContainEqual({ type: 'error', code: 'TOO_LONG' });
  });

  it('does not run a tool call cut off by the token limit', async () => {
    const log: unknown[] = [];
    const provider = chainProvider([{ id: 'm1', responses: [{ calls: [{ id: 'c1', name: 'get_total', input: { month: 'x' } }], finish: 'length' }] }]);
    const events = await collect(await handlerFor(provider, { tools: () => tools(log) }).chat(chatRequest(question)));
    expect(log).toEqual([]);
    expect(events).toContainEqual({ type: 'error', code: 'TOO_LONG' });
  });
});

describe('fallback chain', () => {
  it('moves to the next model on a daily 429 and records quota', async () => {
    const store = createMemoryQuotaStore();
    const provider = chainProvider([
      { id: 'strong', dailyLimit: 20, responses: [dailyQuotaError()] },
      { id: 'light', dailyLimit: 500, responses: [{ text: 'From the light model.' }] },
    ]);
    const handler = handlerFor(provider, { quotaStore: store });
    const events = await collect(await handler.chat(chatRequest(question)));
    expect(textOf(events)).toBe('From the light model.');
    const rows = await store.load(quotaDate());
    expect(rows).toEqual(expect.arrayContaining([
      { model: 'strong', requests: 0, exhausted: true },
      { model: 'light', requests: 1, exhausted: false },
    ]));

    const summary = await handler.quota();
    expect(summary?.usingFallback).toBe(true);
    expect(summary?.currentModel?.model).toBe('light');
    expect(summary?.requestsLeft).toBe(499);
  });

  it('skips models recorded as used up on later requests', async () => {
    const store = createMemoryQuotaStore();
    await store.record(quotaDate(), 'strong', 'daily_limit');
    const provider = chainProvider([
      { id: 'strong', dailyLimit: 20, responses: [{ text: 'strong' }] },
      { id: 'light', dailyLimit: 500, responses: [{ text: 'light' }] },
    ]);
    const events = await collect(await handlerFor(provider, { quotaStore: store }).chat(chatRequest(question)));
    expect(textOf(events)).toBe('light');
    expect(provider.mocks[0]!.doStreamCalls).toHaveLength(0);
  });

  it('still tries the chain when every model looks used up', async () => {
    const store = createMemoryQuotaStore();
    await store.record(quotaDate(), 'strong', 'daily_limit');
    await store.record(quotaDate(), 'light', 'daily_limit');
    const provider = chainProvider([
      { id: 'strong', dailyLimit: 20, responses: [{ text: 'strong again' }] },
      { id: 'light', dailyLimit: 500, responses: [{ text: 'light' }] },
    ]);
    const events = await collect(await handlerFor(provider, { quotaStore: store }).chat(chatRequest(question)));
    expect(textOf(events)).toBe('strong again');
  });

  it('gives a per-minute 429 a cooldown without marking the model used up', async () => {
    const store = createMemoryQuotaStore();
    const provider = chainProvider([
      { id: 'strong', dailyLimit: 20, responses: [minuteQuotaError(), { text: 'strong' }] },
      { id: 'light', dailyLimit: 500, responses: [{ text: 'light' }] },
    ]);
    const handler = handlerFor(provider, { quotaStore: store });
    expect(textOf(await collect(await handler.chat(chatRequest(question))))).toBe('light');
    expect((await store.load(quotaDate()))?.find((row) => row.model === 'strong')).toBeUndefined();
    // The cooldown persists on this handler instance.
    expect(textOf(await collect(await handler.chat(chatRequest(question))))).toBe('light');
    expect(provider.mocks[0]!.doStreamCalls).toHaveLength(1);
  });

  it('falls back on 404, 500 and 503', async () => {
    const provider = chainProvider([
      { id: 'a', responses: [apiError(404)] },
      { id: 'b', responses: [apiError(500)] },
      { id: 'c', responses: [apiError(503)] },
      { id: 'd', responses: [{ text: 'd answered' }] },
    ]);
    expect(textOf(await collect(await handlerFor(provider).chat(chatRequest(question))))).toBe('d answered');
  });

  it('does not fall back on other errors', async () => {
    const provider = chainProvider([
      { id: 'a', responses: [apiError(400)] },
      { id: 'b', responses: [{ text: 'never' }] },
    ]);
    const events = await collect(await handlerFor(provider).chat(chatRequest(question)));
    expect(events).toContainEqual({ type: 'error', code: 'SERVER_ERROR' });
    expect(provider.mocks[1]!.doStreamCalls).toHaveLength(0);
  });

  it('does not retry on another model once text has streamed', async () => {
    const provider = chainProvider([
      { id: 'a', responses: [{ text: 'Partial', errorAfterText: apiError(503) }] },
      { id: 'b', responses: [{ text: 'never' }] },
    ]);
    const events = await collect(await handlerFor(provider).chat(chatRequest(question)));
    expect(textOf(events)).toBe('Partial');
    expect(events).toContainEqual({ type: 'error', code: 'BUSY' });
    expect(provider.mocks[1]!.doStreamCalls).toHaveLength(0);
  });

  it('answers BUSY when every model fails', async () => {
    const provider = chainProvider([
      { id: 'a', responses: [dailyQuotaError()] },
      { id: 'b', responses: [minuteQuotaError()] },
    ]);
    const events = await collect(await handlerFor(provider).chat(chatRequest(question)));
    expect(events).toContainEqual({ type: 'error', code: 'BUSY' });
  });

  it('switches models mid-answer and neutralises the other model\'s thought signatures', async () => {
    const tools: AssistantTools = {
      lookup: defineTool({ description: 'lookup', inputSchema: z.object({}), execute: () => ({ ok: true }) }),
    };
    const provider = chainProvider([
      { id: 'strong', responses: [{ calls: [{ id: 'c1', name: 'lookup', input: {}, signature: 'sig-strong' }] }, dailyQuotaError()] },
      { id: 'light', responses: [{ text: 'done' }] },
    ]);
    const events = await collect(await handlerFor(provider, { tools: () => tools }).chat(chatRequest(question)));
    expect(textOf(events)).toBe('done');
    const replay = JSON.stringify(provider.mocks[1]!.doStreamCalls[0]!.prompt);
    expect(replay).not.toContain('sig-strong');
    expect(replay).toContain('skip_thought_signature_validator');
  });

  it('keeps thought signatures when the same model continues', async () => {
    const tools: AssistantTools = {
      lookup: defineTool({ description: 'lookup', inputSchema: z.object({}), execute: () => ({ ok: true }) }),
    };
    const provider = chainProvider([
      { id: 'strong', responses: [{ calls: [{ id: 'c1', name: 'lookup', input: {}, signature: 'sig-strong' }] }, { text: 'done' }] },
    ]);
    await collect(await handlerFor(provider, { tools: () => tools }).chat(chatRequest(question)));
    const replay = JSON.stringify(provider.mocks[0]!.doStreamCalls[1]!.prompt);
    expect(replay).toContain('sig-strong');
  });
});

describe('confirm before action', () => {
  const secret = 'test-confirmation-secret';

  function writeTools(log: unknown[]): AssistantTools {
    return {
      add_expense: defineTool({
        description: 'Record an expense',
        inputSchema: z.object({ amount: z.number().positive(), category: z.string() }),
        needsConfirmation: true,
        describe: ({ amount, category }) => `Record ${amount} for ${category}`,
        execute: async (input) => {
          log.push(input);
          return { saved: true };
        },
      }),
    };
  }

  it('proposes the call instead of running it', async () => {
    const log: unknown[] = [];
    const provider = chainProvider([{
      id: 'm1',
      responses: [{ text: 'I can record that.', calls: [{ id: 'c1', name: 'add_expense', input: { amount: 50, category: 'rent' } }] }],
    }]);
    const events = await collect(await handlerFor(provider, { tools: () => writeTools(log), confirmationSecret: secret }).chat(chatRequest(question)));
    expect(log).toEqual([]);
    const proposal = events.find((event) => event.type === 'confirm');
    expect(proposal).toMatchObject({ id: 'c1', name: 'add_expense', input: { amount: 50, category: 'rent' }, summary: 'Record 50 for rent' });
    expect(proposal && 'token' in proposal && typeof proposal.token).toBe('string');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('runs a confirmed call and lets the model continue', async () => {
    const log: unknown[] = [];
    const provider = chainProvider([{
      id: 'm1',
      responses: [
        { text: 'I can record that.', calls: [{ id: 'c1', name: 'add_expense', input: { amount: 50, category: 'rent' } }] },
        { text: 'Recorded.' },
      ],
    }]);
    const handler = handlerFor(provider, { tools: () => writeTools(log), confirmationSecret: secret });
    const first = await collect(await handler.chat(chatRequest(question)));
    const proposal = first.find((event) => event.type === 'confirm')!;
    if (proposal.type !== 'confirm') throw new Error('expected a proposal');

    const events = await collect(await handler.chat(chatRequest({
      messages: [...question.messages, { role: 'assistant', content: 'I can record that.' }],
      confirmation: { id: proposal.id, name: proposal.name, input: proposal.input, token: proposal.token },
    })));
    expect(log).toEqual([{ amount: 50, category: 'rent' }]);
    expect(events).toContainEqual({ type: 'tool', name: 'add_expense', id: 'c1' });
    expect(textOf(events)).toBe('\n\nRecorded.');
    const replay = JSON.stringify(provider.mocks[0]!.doStreamCalls[1]!.prompt);
    expect(replay).toContain('"saved":true');
  });

  it('refuses a confirmation whose input was changed', async () => {
    const log: unknown[] = [];
    const provider = chainProvider([{
      id: 'm1',
      responses: [{ calls: [{ id: 'c1', name: 'add_expense', input: { amount: 50, category: 'rent' } }] }],
    }]);
    const handler = handlerFor(provider, { tools: () => writeTools(log), confirmationSecret: secret });
    const proposal = (await collect(await handler.chat(chatRequest(question)))).find((event) => event.type === 'confirm')!;
    if (proposal.type !== 'confirm') throw new Error('expected a proposal');
    const response = await handler.chat(chatRequest({
      ...question,
      confirmation: { id: proposal.id, name: proposal.name, input: { amount: 5_000_000, category: 'rent' }, token: proposal.token },
    }));
    expect(response.status).toBe(403);
    expect(log).toEqual([]);
  });

  it('refuses confirmations for tools that never need one, and invalid input', async () => {
    const provider = chainProvider([{ id: 'm1', responses: [{ text: 'ok' }] }]);
    const tools: AssistantTools = {
      ...writeTools([]),
      read_only: defineTool({ description: 'read', inputSchema: z.object({}), execute: () => 1 }),
    };
    const handler = handlerFor(provider, { tools: () => tools });
    const readOnly = await handler.chat(chatRequest({ ...question, confirmation: { id: 'x', name: 'read_only', input: {} } }));
    expect(readOnly.status).toBe(400);
    const invalid = await handler.chat(chatRequest({ ...question, confirmation: { id: 'x', name: 'add_expense', input: { amount: -1, category: 'rent' } } }));
    expect(invalid.status).toBe(400);
  });
});

describe('usage endpoint', () => {
  it('returns the quota summary for tracked chains', async () => {
    const store = createMemoryQuotaStore();
    await store.record(quotaDate(), 'strong', 'ok');
    const provider = chainProvider([
      { id: 'strong', dailyLimit: 20, responses: [{ text: 'x' }] },
      { id: 'light', dailyLimit: 500, responses: [{ text: 'x' }] },
    ]);
    const authorize = vi.fn(() => ({ userId: 'u1' }));
    const handler = handlerFor(provider, { quotaStore: store, authorize });
    const response = await handler.usage(new Request(`https://app.test/usage?context=${encodeURIComponent(JSON.stringify({ clubId: 'c1' }))}`));
    const body = await response.json() as { quota: { requestsLeft: number; questionsLeft: number; usingFallback: boolean } };
    expect(authorize).toHaveBeenCalledWith(expect.any(Request), { clubId: 'c1' });
    expect(body.quota).toMatchObject({ requestsLeft: 519, questionsLeft: 173, usingFallback: false });
  });

  it('returns null quota for untracked providers', async () => {
    const provider = chainProvider([{ id: 'paid', responses: [{ text: 'x' }] }]);
    const handler = handlerFor(provider, { quotaStore: createMemoryQuotaStore() });
    expect(await (await handler.usage(new Request('https://app.test/usage'))).json()).toEqual({ provider: 'mock', quota: null });
  });

  it('routes methods in handle()', async () => {
    const provider = chainProvider([{ id: 'm1', responses: [{ text: 'hi' }] }]);
    const handler = handlerFor(provider, { headers: { 'Access-Control-Allow-Origin': '*' } });
    const options = await handler.handle(new Request('https://app.test', { method: 'OPTIONS' }));
    expect(options.status).toBe(204);
    expect(options.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await handler.handle(new Request('https://app.test', { method: 'PUT' }))).status).toBe(405);
    expect(textOf(await collect(await handler.handle(chatRequest(question))))).toBe('hi');
  });
});
