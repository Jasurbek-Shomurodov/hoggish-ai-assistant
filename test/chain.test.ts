import { describe, expect, it } from 'vitest';
import { createAssistantHandler } from '../src/handler';
import { anthropicProvider, contextWindowFor, customProvider, geminiProvider, modelSettings, providerChain, providerFromEnv } from '../src/providers';
import { createMemoryQuotaStore, quotaDate } from '../src/quota';
import { apiError, chatRequest, collect, dailyQuotaError, mockModel, textOf } from './helpers';

const question = { messages: [{ role: 'user', content: 'Hi' }] };

function link(name: string, models: Array<{ id: string; responses: Parameters<typeof mockModel>[1]; dailyLimit?: number }>, extra: Partial<Parameters<typeof customProvider>[0]> = {}) {
  const mocks = models.map((entry) => mockModel(entry.id, entry.responses));
  const provider = customProvider({
    name,
    models: models.map((entry, index) => ({ model: entry.id, dailyLimit: entry.dailyLimit, languageModel: mocks[index]! })),
    ...extra,
  });
  return { provider, mocks };
}

function handlerFor(provider: ReturnType<typeof providerChain>, quotaStore = createMemoryQuotaStore()) {
  return createAssistantHandler({
    authorize: () => ({}),
    provider,
    system: 'test',
    quotaStore,
    onError: () => {},
  });
}

describe('providerChain', () => {
  it('orders links by priority, then by position', () => {
    const a = link('a', [{ id: 'a1', responses: [] }]);
    const b = link('b', [{ id: 'b1', responses: [] }, { id: 'b2', responses: [] }]);
    const c = link('c', [{ id: 'c1', responses: [] }]);
    const chain = providerChain([
      { provider: a.provider, priority: 2 },
      c.provider,
      { provider: b.provider, priority: 1 },
    ]);
    expect(chain.models.map((model) => model.model)).toEqual(['b1', 'b2', 'a1', 'c1']);
    expect(chain.models.map((model) => model.provider)).toEqual(['b', 'b', 'a', 'c']);
    expect(chain.name).toBe('b+a+c');
    expect(chain.maxRetries).toBe(0);
  });

  it('skips links without a key and is unconfigured when none has one', () => {
    const free = geminiProvider({ apiKey: undefined });
    const paid = anthropicProvider({ apiKey: 'k' });
    const chain = providerChain([{ provider: free, priority: 1 }, { provider: paid, priority: 2 }]);
    expect(chain.configured).toBe(true);
    expect(chain.models.map((model) => model.provider)).toEqual(['anthropic']);
    expect(providerChain([free, anthropicProvider({ apiKey: '' })]).configured).toBe(false);
  });

  it('keeps model ids unique across links and each model keeps its provider settings', () => {
    const first = link('main', [{ id: 'shared', responses: [] }], { maxOutputTokens: 100 });
    const second = link('backup', [{ id: 'shared', responses: [] }], { maxOutputTokens: 200, cacheSystemPrompt: true });
    const chain = providerChain([first.provider, second.provider]);
    expect(chain.models.map((model) => model.model)).toEqual(['shared', 'backup/shared']);
    expect(modelSettings(chain, chain.models[0]!)).toMatchObject({ maxOutputTokens: 100, cacheSystemPrompt: undefined });
    expect(modelSettings(chain, chain.models[1]!)).toMatchObject({ maxOutputTokens: 200, cacheSystemPrompt: true });
  });

  it('answers inline from the next priority when the first link is out of daily quota', async () => {
    const free = link('free', [{ id: 'free-1', responses: [dailyQuotaError()], dailyLimit: 20 }]);
    const paid = link('paid', [{ id: 'paid-1', responses: [{ text: 'from paid' }] }]);
    const store = createMemoryQuotaStore();
    const chain = providerChain([{ provider: free.provider, priority: 1 }, { provider: paid.provider, priority: 2 }]);
    const handler = handlerFor(chain, store);

    const events = await collect(await handler.chat(chatRequest(question)));
    expect(textOf(events)).toBe('from paid');
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(free.mocks[0]!.doStreamCalls).toHaveLength(1);
    expect(paid.mocks[0]!.doStreamCalls).toHaveLength(1);

    // The free model is recorded as used up; the paid one is untracked.
    const rows = await store.load(quotaDate(new Date(), chain.quotaTimeZone));
    expect(rows).toEqual([{ model: 'free-1', requests: 0, exhausted: true }]);

    // Next request goes straight to the paid link.
    await collect(await handler.chat(chatRequest(question)));
    expect(free.mocks[0]!.doStreamCalls).toHaveLength(1);
    expect(paid.mocks[0]!.doStreamCalls).toHaveLength(2);
  });

  it('falls through on outages too, and passes each model its own settings', async () => {
    const down = link('down', [{ id: 'd1', responses: [apiError(503)] }], { providerOptions: { google: { x: 1 } } });
    const up = link('up', [{ id: 'u1', responses: [{ text: 'ok' }] }], { maxOutputTokens: 123, cacheSystemPrompt: true });
    const chain = providerChain([down.provider, up.provider]);
    const events = await collect(await handlerFor(chain).chat(chatRequest(question)));
    expect(textOf(events)).toBe('ok');
    const call = up.mocks[0]!.doStreamCalls[0]!;
    expect(call.maxOutputTokens).toBe(123);
    expect(call.providerOptions).toBeUndefined();
    expect(call.prompt[0]).toMatchObject({ role: 'system', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } });
    expect(down.mocks[0]!.doStreamCalls[0]!.providerOptions).toEqual({ google: { x: 1 } });
  });

  it('reports quota for the tracked models only', async () => {
    const free = link('free', [{ id: 'f1', responses: [], dailyLimit: 10 }]);
    const paid = link('paid', [{ id: 'p1', responses: [] }]);
    const chain = providerChain([free.provider, paid.provider]);
    const quota = await handlerFor(chain).quota();
    expect(quota?.models.map((model) => model.model)).toEqual(['f1']);
    expect(quota?.requestsLimit).toBe(10);
  });
});

describe('providerFromEnv with a priority list', () => {
  it('builds a chain in the listed order', () => {
    const chain = providerFromEnv({ ASSISTANT_PROVIDER: 'anthropic, gemini', ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' });
    expect(chain.name).toBe('anthropic+gemini');
    expect(chain.models[0]!.provider).toBe('anthropic');
    expect(chain.models.filter((model) => model.provider === 'gemini')).toHaveLength(7);
  });

  it('leaves out providers whose key is missing', () => {
    const chain = providerFromEnv({ ASSISTANT_PROVIDER: 'gemini,anthropic', ANTHROPIC_API_KEY: 'a' });
    expect(chain.models.every((model) => model.provider === 'anthropic')).toBe(true);
  });

  it('still returns a single provider for one name', () => {
    expect(providerFromEnv({ ASSISTANT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'a' }).name).toBe('anthropic');
    expect(providerFromEnv({ GEMINI_API_KEY: 'g' }).name).toBe('gemini');
  });
});

describe('Gemini thinking', () => {
  it('defaults every model to low thinking, by level for Gemini 3 and by budget for Gemini 2.5', () => {
    const provider = geminiProvider({ apiKey: 'k' });
    const options = (id: string) => provider.models.find((model) => model.model === id)!.providerOptions;
    expect(options('gemini-3.8-flash')).toEqual({ google: { thinkingConfig: { thinkingLevel: 'low' } } });
    expect(options('gemini-2.5-flash')).toEqual({ google: { thinkingConfig: { thinkingBudget: 1_024 } } });
  });

  it('lets the caller pick a level, keep their own thinkingConfig, or leave thinking alone', () => {
    const minimal = geminiProvider({ apiKey: 'k', models: ['gemini-2.5-flash'], thinking: 'minimal', providerOptions: { google: { safetySettings: [] } } });
    expect(minimal.models[0]!.providerOptions).toEqual({ google: { safetySettings: [], thinkingConfig: { thinkingBudget: 0 } } });

    const own = geminiProvider({ apiKey: 'k', models: ['gemini-3.8-flash'], providerOptions: { google: { thinkingConfig: { thinkingLevel: 'high' } } } });
    expect(own.models[0]!.providerOptions).toEqual({ google: { thinkingConfig: { thinkingLevel: 'high' } } });

    const off = geminiProvider({ apiKey: 'k', models: ['gemini-3.8-flash'], thinking: false });
    expect(off.models[0]!.providerOptions).toBeUndefined();
  });

  it('reaches the model call through a providerChain', () => {
    const chain = providerChain([geminiProvider({ apiKey: 'k', models: ['gemini-3.8-flash'] })]);
    expect(modelSettings(chain, chain.models[0]!).providerOptions).toEqual({ google: { thinkingConfig: { thinkingLevel: 'low' } } });
  });
});

describe('context windows', () => {
  it('knows Gemini and Claude windows and leaves unknown models alone', () => {
    expect(contextWindowFor('gemini-3.8-flash')).toBe(1_048_576);
    expect(contextWindowFor('backup/gemini-2.5-flash-lite')).toBe(1_048_576);
    expect(contextWindowFor('claude-opus-5-5')).toBe(1_000_000);
    expect(contextWindowFor('claude-haiku-4-5')).toBe(200_000);
    expect(contextWindowFor('gpt-5')).toBeUndefined();
  });

  it('attaches the window to provider models and keeps overrides', () => {
    expect(geminiProvider({ apiKey: 'k' }).models[0]?.contextWindow).toBe(1_048_576);
    expect(geminiProvider({ apiKey: 'k', models: [{ model: 'gemini-3.8-flash', contextWindow: 10 }] }).models[0]?.contextWindow).toBe(10);
    expect(anthropicProvider({ apiKey: 'k' }).models[0]?.contextWindow).toBe(1_000_000);
    const custom = customProvider({ name: 'x', models: [{ model: 'claude-haiku-4-5', languageModel: mockModel('m', []) }, { model: 'other', languageModel: mockModel('o', []) }] });
    expect(custom.models.map((entry) => entry.contextWindow)).toEqual([200_000, undefined]);
    const chain = providerChain([geminiProvider({ apiKey: 'k' }), anthropicProvider({ apiKey: 'k' })]);
    expect(chain.models.at(-1)?.contextWindow).toBe(1_000_000);
  });
});
