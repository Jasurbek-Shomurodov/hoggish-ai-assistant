// @vitest-environment jsdom
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAssistantHandler } from '../src/handler';
import { createMemoryQuotaStore } from '../src/quota';
import { AssistantMarkdown, useAssistantChat } from '../src/react';
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
