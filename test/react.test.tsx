// @vitest-environment jsdom
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAssistantHandler } from '../src/handler';
import { createMemoryQuotaStore } from '../src/quota';
import { AssistantMarkdown, contextStatus, useAssistantChat } from '../src/react';
import { defineTool } from '../src/tools';
import { chainProvider, type Response as MockResponse } from './helpers';

function setup(responses: MockResponse[]) {
  const executed: unknown[] = [];
  const provider = chainProvider([{ id: 'm1', dailyLimit: 20, responses }]);
  const handler = createAssistantHandler<{ user: string }>({
    authorize: (_request, context) => ((context as { clubId?: string } | undefined)?.clubId ? { user: 'u1' } : null),
    provider,
    system: 'test',
    quotaStore: createMemoryQuotaStore(),
    confirmationSecret: 'secret',
    onError: () => {},
    tools: () => ({
      export_file: defineTool({
        description: 'export',
        inputSchema: z.object({}),
        execute: (_input, { attachFile }) => {
          attachFile({ fileName: 'a.txt', mimeType: 'text/plain', data: new TextEncoder().encode('hi') });
          return { ok: true };
        },
      }),
      add_expense: defineTool({
        description: 'add',
        inputSchema: z.object({ amount: z.number() }),
        needsConfirmation: true,
        describe: ({ amount }) => `Add ${amount}`,
        execute: (input) => {
          executed.push(input);
          return { saved: true };
        },
      }),
    }),
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const request = new Request(new URL(url, 'http://localhost'), init);
    return handler.handle(request);
  });
  return { fetchMock, executed, provider };
}

beforeEach(() => {
  let counter = 0;
  URL.createObjectURL = vi.fn(() => `blob:${(counter += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

describe('useAssistantChat', () => {
  it('streams an answer with tool status and files, and refreshes quota', async () => {
    const { fetchMock } = setup([
      { text: 'Checking.', calls: [{ id: 'c1', name: 'export_file', input: {} }] },
      { text: 'Here is your file.' },
    ]);
    const { result } = renderHook(() => useAssistantChat({
      api: '/api/assistant',
      usageApi: '/api/assistant/usage',
      context: { clubId: 'c1' },
      fetch: fetchMock as typeof fetch,
    }));
    await waitFor(() => expect(result.current.quota?.requestsLeft).toBe(20));

    await act(() => result.current.send('Export please'));
    const [user, assistant] = result.current.messages;
    expect(user).toMatchObject({ role: 'user', content: 'Export please' });
    expect(assistant).toMatchObject({ role: 'assistant', content: 'Checking.\n\nHere is your file.', pending: false });
    expect(assistant?.files).toEqual([{ fileName: 'a.txt', mimeType: 'text/plain', url: 'blob:1' }]);
    expect(result.current.busy).toBe(false);
    await waitFor(() => expect(result.current.quota?.requestsLeft).toBe(18));

    act(() => result.current.newChat());
    expect(result.current.messages).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });

  it('shows the model in use and how much of its context window is used', async () => {
    const { fetchMock, provider } = setup([{ text: 'Hello.' }]);
    provider.models[0]!.contextWindow = 1_000;
    const { result } = renderHook(() => useAssistantChat({
      api: '/api/assistant',
      usageApi: '/api/assistant/usage',
      context: { clubId: 'c1' },
      fetch: fetchMock as typeof fetch,
    }));
    // Before the first answer the usage endpoint says which model would answer.
    await waitFor(() => expect(result.current.model).toEqual({ model: 'm1', provider: 'mock', contextWindow: 1_000 }));
    expect(result.current.context).toBeNull();

    await act(() => result.current.send('Hi there, how are you?'));
    expect(result.current.messages[1]?.model).toEqual({ model: 'm1', provider: 'mock', contextWindow: 1_000 });
    expect(result.current.model?.model).toBe('m1');
    // The mock reports 10 input and 5 output tokens; one 22-character message is ~6 tokens, floored at 50.
    expect(result.current.context).toEqual({
      model: 'm1',
      contextWindow: 1_000,
      usedTokens: 15,
      tokensLeft: 985,
      usedShare: 0.015,
      messagesLeft: 19,
    });

    act(() => result.current.newChat());
    expect(result.current.context).toBeNull();
    expect(result.current.model?.model).toBe('m1');
  });

  it('keeps the model and quota on screen while a new context loads', async () => {
    const { fetchMock } = setup([]);
    const { result, rerender } = renderHook(({ locale }) => useAssistantChat({
      api: '/api/assistant',
      usageApi: '/api/assistant/usage',
      context: { clubId: 'c1', locale },
      fetch: fetchMock as typeof fetch,
    }), { initialProps: { locale: 'en' } });
    await waitFor(() => expect(result.current.model?.model).toBe('m1'));
    await waitFor(() => expect(result.current.quota).not.toBeNull());

    const seen: Array<string | undefined> = [];
    const quotas: boolean[] = [];
    rerender({ locale: 'ru' });
    seen.push(result.current.model?.model);
    quotas.push(result.current.quota !== null);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.model?.model).toBe('m1'));
    seen.push(result.current.model?.model);
    quotas.push(result.current.quota !== null);
    expect(seen).toEqual(['m1', 'm1']);
    expect(quotas).toEqual([true, true]);
  });

  it('shows server error codes', async () => {
    const { fetchMock } = setup([{ text: 'x' }]);
    const { result } = renderHook(() => useAssistantChat({ api: '/api/assistant', fetch: fetchMock as typeof fetch }));
    await act(() => result.current.send('Hi'));
    expect(result.current.messages[1]?.error).toBe('UNAUTHORIZED');
  });

  it('confirms a proposed action and continues the answer', async () => {
    const { fetchMock, executed } = setup([
      { text: 'Shall I add it?', calls: [{ id: 'c9', name: 'add_expense', input: { amount: 50 } }] },
      { text: 'Added.' },
    ]);
    const { result } = renderHook(() => useAssistantChat({ api: '/api/assistant', context: { clubId: 'c1' }, fetch: fetchMock as typeof fetch }));
    await act(() => result.current.send('Add 50 for rent'));
    const proposal = result.current.messages[1]!.confirmations[0]!;
    expect(proposal).toMatchObject({ id: 'c9', name: 'add_expense', summary: 'Add 50', status: 'pending' });
    expect(executed).toEqual([]);

    await act(() => result.current.confirm('c9'));
    expect(executed).toEqual([{ amount: 50 }]);
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({ content: 'Shall I add it?\n\nAdded.', pending: false });
    expect(result.current.messages[1]!.confirmations[0]!.status).toBe('done');
  });

  it('cancels pending confirmations, also when a new question is sent', async () => {
    const { fetchMock, executed } = setup([
      { calls: [{ id: 'c1', name: 'add_expense', input: { amount: 1 } }, { id: 'c2', name: 'add_expense', input: { amount: 2 } }] },
      { text: 'Okay.' },
    ]);
    const { result } = renderHook(() => useAssistantChat({ api: '/api/assistant', context: { clubId: 'c1' }, fetch: fetchMock as typeof fetch }));
    await act(() => result.current.send('Add two'));
    act(() => result.current.cancel('c1'));
    expect(result.current.messages[1]!.confirmations.map((item) => item.status)).toEqual(['cancelled', 'pending']);
    await act(() => result.current.send('Never mind'));
    expect(result.current.messages[1]!.confirmations.map((item) => item.status)).toEqual(['cancelled', 'cancelled']);
    await act(() => result.current.confirm('c2'));
    expect(executed).toEqual([]);
  });

  it('marks a stopped answer', async () => {
    let release: () => void = () => {};
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      release = () => reject(new Error('unused'));
    }));
    const { result } = renderHook(() => useAssistantChat({ api: '/api/assistant', fetch: fetchMock as unknown as typeof fetch }));
    let sending: Promise<void> = Promise.resolve();
    act(() => {
      sending = result.current.send('Long question');
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    await act(async () => {
      result.current.stop();
      await sending;
    });
    expect(result.current.messages[1]).toMatchObject({ stopped: true, pending: false });
    expect(result.current.busy).toBe(false);
    void release;
  });
});

describe('contextStatus', () => {
  const history = [{ role: 'user' as const, content: 'x'.repeat(400) }, { role: 'assistant' as const, content: 'y'.repeat(800) }];

  it('estimates messages left from the window and the average message size', () => {
    const status = contextStatus({ model: 'm', inputTokens: 5_000, outputTokens: 1_000 }, { model: 'm', contextWindow: 20_000 }, history);
    expect(status).toEqual({ model: 'm', contextWindow: 20_000, usedTokens: 6_000, tokensLeft: 14_000, usedShare: 0.3, messagesLeft: 93 });
  });

  it('reports nulls when the window is unknown or belongs to another model', () => {
    expect(contextStatus({ model: 'm', inputTokens: 5, outputTokens: 1 }, { model: 'other', contextWindow: 10 }, history)).toMatchObject({ contextWindow: null, messagesLeft: null, usedTokens: 6 });
    expect(contextStatus({ model: 'm', inputTokens: 5, outputTokens: 1 }, null, history).tokensLeft).toBeNull();
  });

  it('never goes negative when the window is already full', () => {
    expect(contextStatus({ model: 'm', inputTokens: 30, outputTokens: 0 }, { model: 'm', contextWindow: 20 }, history)).toMatchObject({ tokensLeft: 0, usedShare: 1, messagesLeft: 0 });
  });
});

describe('AssistantMarkdown', () => {
  it('renders the subset as elements without injecting HTML', () => {
    const { container } = render(<AssistantMarkdown text={'# Title\n**Bold** <b>raw</b>\n\n- a\n\n| x | y |\n|---|---|\n| 1 | 2 |'} />);
    expect(container.querySelector('h3')?.textContent).toBe('Title');
    expect(container.querySelector('strong')?.textContent).toBe('Bold');
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>raw</b>');
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });
});
