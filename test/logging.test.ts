import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAssistantHandler } from '../src/handler';
import type { AssistantProvider } from '../src/providers';
import { defineTool } from '../src/tools';
import { apiError, chainProvider, chatRequest, collect, textOf } from './helpers';

const SYSTEM = 'SECRET-SYSTEM-PROMPT';
const QUESTION = 'SECRET-USER-QUESTION about salaries';
const TOOL_RESULT = 'SECRET-TOOL-RESULT revenue 123456789';

/** A provider error as Gemini returns it, carrying the full request body. */
function leakyError(status: number) {
  return apiError(status, 'This model is currently experiencing high demand.', `{"error":"${TOOL_RESULT}"}`, {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: QUESTION }] }, { role: 'user', parts: [{ functionResponse: { response: TOOL_RESULT } }] }],
  });
}

function handlerFor(provider: AssistantProvider) {
  // No onError override: the default logger is what this test checks.
  return createAssistantHandler({
    authorize: () => ({ user: 'u1' }),
    provider,
    system: SYSTEM,
    tools: () => ({
      revenue: defineTool({ description: 'revenue', inputSchema: z.object({}), execute: () => ({ note: TOOL_RESULT }) }),
      broken: defineTool({ description: 'broken', inputSchema: z.object({}), execute: () => { throw new Error(TOOL_RESULT); } }),
    }),
  });
}

let output: string[];

beforeEach(() => {
  output = [];
  const capture = (...args: unknown[]) => {
    output.push(args.map((arg) => {
      if (arg instanceof Error) return `${arg.name} ${arg.message} ${arg.stack ?? ''} ${JSON.stringify(arg)}`;
      return typeof arg === 'string' ? arg : JSON.stringify(arg);
    }).join(' '));
  };
  for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const) vi.spyOn(console, method).mockImplementation(capture);
  vi.spyOn(process, 'emitWarning').mockImplementation(capture as never);
});

afterEach(() => vi.restoreAllMocks());

function expectNoContentLogged() {
  const logged = output.join('\n');
  for (const secret of [SYSTEM, QUESTION, TOOL_RESULT, 'requestBodyValues']) expect(logged).not.toContain(secret);
}

describe('logging', () => {
  it('a failing model in the chain logs nothing with prompt or tool-result text', async () => {
    const provider = chainProvider([
      { id: 'strong', responses: [leakyError(503)] },
      { id: 'light', responses: [{ calls: [{ id: 'c1', name: 'revenue', input: {} }] }, { text: 'Done.' }] },
    ]);
    const events = await collect(await handlerFor(provider).chat(chatRequest({ messages: [{ role: 'user', content: QUESTION }] })));
    expect(textOf(events)).toBe('Done.');
    expectNoContentLogged();
  });

  it('a turn where every model fails logs only content-free details', async () => {
    const provider = chainProvider([
      { id: 'strong', responses: [{ calls: [{ id: 'c1', name: 'revenue', input: {} }] }, leakyError(503)] },
      { id: 'light', responses: [leakyError(500)] },
    ]);
    const events = await collect(await handlerFor(provider).chat(chatRequest({ messages: [{ role: 'user', content: QUESTION }] })));
    expect(events).toContainEqual({ type: 'error', code: 'BUSY' });
    expect(output.length).toBeGreaterThan(0);
    expectNoContentLogged();
  });

  it('a non-fallback model error and a throwing tool log no content', async () => {
    const provider = chainProvider([
      { id: 'strong', responses: [{ calls: [{ id: 'c1', name: 'broken', input: {} }] }, leakyError(400)] },
    ]);
    const events = await collect(await handlerFor(provider).chat(chatRequest({ messages: [{ role: 'user', content: QUESTION }] })));
    expect(events).toContainEqual({ type: 'error', code: 'SERVER_ERROR' });
    expectNoContentLogged();
  });
});
