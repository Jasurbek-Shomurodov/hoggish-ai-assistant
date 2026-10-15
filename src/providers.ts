import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { PACIFIC_TIME_ZONE, type QuotaModel } from './quota';

/** Provider-specific call options, keyed by provider (`google`, `anthropic`, …). */
export type ProviderOptions = Record<string, Record<string, unknown>>;

/** Call settings that a model in a chain may override from its provider. */
export interface ModelSettings {
  maxOutputTokens?: number;
  providerOptions?: ProviderOptions;
  /** Mark the stable system prompt cacheable (Anthropic prompt caching). */
  cacheSystemPrompt?: boolean;
}

/** One model in a fallback chain. */
export interface ChainModel extends QuotaModel, ModelSettings {
  /** Stable id used for quota rows and cooldowns, normally the model id. */
  model: string;
  languageModel: LanguageModel;
  /** Name of the provider this model came from, set by `providerChain`. */
  provider?: string;
  /**
   * Context window in tokens. Defaults to `contextWindowFor(model)`; the
   * browser uses it to estimate how many more messages fit.
   */
  contextWindow?: number;
}

/**
 * Known context windows (tokens) by model id prefix. Longest prefix wins.
 * Gemini models take 1 048 576 tokens; the Claude 4.6+ and Claude 5 families
 * 1 000 000; earlier Claude models 200 000.
 */
export const CONTEXT_WINDOWS: ReadonlyArray<readonly [prefix: string, tokens: number]> = [
  ['gemini-', 1_048_576],
  ['claude-haiku-4-5', 200_000],
  ['claude-sonnet-4-5', 200_000],
  ['claude-opus-4-5', 200_000],
  ['claude-opus-4-1', 200_000],
  ['claude-3', 200_000],
  ['claude-', 1_000_000],
];

/** Context window for a model id, ignoring a `name/` prefix; undefined when unknown. */
export function contextWindowFor(model: string): number | undefined {
  const id = model.slice(model.lastIndexOf('/') + 1);
  let best: readonly [string, number] | undefined;
  for (const entry of CONTEXT_WINDOWS) {
    if (id.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best?.[1];
}

/**
 * A configured provider: an ordered model chain (strongest first) plus call
 * settings. Build one with `geminiProvider`, `anthropicProvider`,
 * `customProvider` or `providerFromEnv`; switching providers is a config change.
 */
export interface AssistantProvider extends ModelSettings {
  name: string;
  /** False when the server-side API key is missing. */
  configured: boolean;
  models: ChainModel[];
  /** Time zone whose midnight resets the daily limits. */
  quotaTimeZone: string;
  /** AI SDK retries per model. Chains default to 0 so fallback is immediate. */
  maxRetries: number;
}

/** Effective call settings for one model: its own, else its provider's. */
export function modelSettings(provider: AssistantProvider, model: ChainModel): ModelSettings {
  return {
    maxOutputTokens: model.maxOutputTokens ?? provider.maxOutputTokens,
    providerOptions: model.providerOptions ?? provider.providerOptions,
    cacheSystemPrompt: model.cacheSystemPrompt ?? provider.cacheSystemPrompt,
  };
}

export type ModelInput = string | (QuotaModel & { contextWindow?: number });

/**
 * Free-tier Gemini models, strongest first, with their requests-per-day
 * limits. Each model has its own quota, so the chain walks down as they run out.
 */
export const GEMINI_FREE_MODELS: readonly Required<QuotaModel>[] = [
  { model: 'gemini-3.8-flash', dailyLimit: 20 },
  { model: 'gemini-3.7-flash', dailyLimit: 20 },
  { model: 'gemini-3.6-flash', dailyLimit: 20 },
  { model: 'gemini-3.5-flash-lite', dailyLimit: 500 },
  { model: 'gemini-3.1-flash-lite', dailyLimit: 500 },
  { model: 'gemini-2.5-flash', dailyLimit: 20 },
  { model: 'gemini-2.5-flash-lite', dailyLimit: 20 },
];

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

function normalizeModels(models: readonly ModelInput[]): Array<QuotaModel & { contextWindow?: number }> {
  return models.map((entry) => (typeof entry === 'string' ? { model: entry } : { ...entry }));
}

function withContextWindow<T extends { model: string; contextWindow?: number }>(entry: T): T {
  const contextWindow = entry.contextWindow ?? contextWindowFor(entry.model);
  return contextWindow ? { ...entry, contextWindow } : entry;
}

/** How much a Gemini model may think before answering. `'minimal'` turns thinking off where the model allows it. */
export type GeminiThinking = 'minimal' | 'low' | 'medium' | 'high';

/** Default thinking effort for Gemini: enough for tool choice, without seconds of silence. */
export const DEFAULT_GEMINI_THINKING: GeminiThinking = 'low';

/** Thinking budgets (tokens) for Gemini 2.5 models, which take a budget rather than a level. */
const GEMINI_THINKING_BUDGETS: Record<GeminiThinking, number> = { minimal: 0, low: 1_024, medium: 8_192, high: 24_576 };

/**
 * Provider options that set a Gemini model's thinking effort. Gemini 3 models
 * take a level; Gemini 2.5 models take a token budget. Thinking is on by
 * default and runs before every call, including the ones that only pick a
 * tool, so a low setting removes several seconds from each round.
 */
export function geminiThinkingOptions(model: string, thinking: GeminiThinking): ProviderOptions {
  const id = model.slice(model.lastIndexOf('/') + 1);
  const thinkingConfig = id.startsWith('gemini-2.') ? { thinkingBudget: GEMINI_THINKING_BUDGETS[thinking] } : { thinkingLevel: thinking };
  return { google: { thinkingConfig } };
}

function withGeminiThinking(model: string, thinking: GeminiThinking | false, options: ProviderOptions | undefined): ProviderOptions | undefined {
  if (thinking === false) return options;
  const defaults = geminiThinkingOptions(model, thinking);
  // The caller's own thinkingConfig wins.
  return { ...options, google: { ...defaults.google, ...options?.google } };
}

export interface GeminiProviderOptions {
  apiKey: string | undefined;
  /**
   * Model chain, strongest first. Defaults to the free chain with daily limits.
   * For a paid tier pass plain model ids (no `dailyLimit`) to turn quota tracking off.
   */
  models?: readonly ModelInput[];
  baseURL?: string;
  quotaTimeZone?: string;
  maxRetries?: number;
  maxOutputTokens?: number;
  providerOptions?: ProviderOptions;
  /**
   * Thinking effort for every model in the chain. Default `'low'`; `false`
   * leaves Google's default (full thinking) in place. A `thinkingConfig` in
   * `providerOptions.google` overrides this.
   */
  thinking?: GeminiThinking | false;
}

export function geminiProvider(options: GeminiProviderOptions): AssistantProvider {
  const google = createGoogleGenerativeAI({ apiKey: options.apiKey ?? '', baseURL: options.baseURL });
  const models = normalizeModels(options.models ?? GEMINI_FREE_MODELS);
  const thinking = options.thinking ?? DEFAULT_GEMINI_THINKING;
  return {
    name: 'gemini',
    configured: Boolean(options.apiKey),
    models: models.map((entry) => withContextWindow({
      ...entry,
      languageModel: google(entry.model),
      providerOptions: withGeminiThinking(entry.model, thinking, options.providerOptions),
    })),
    quotaTimeZone: options.quotaTimeZone ?? PACIFIC_TIME_ZONE,
    maxRetries: options.maxRetries ?? (models.length > 1 ? 0 : 2),
    maxOutputTokens: options.maxOutputTokens,
    providerOptions: options.providerOptions,
  };
}

export interface AnthropicProviderOptions {
  apiKey: string | undefined;
  /** Defaults to `claude-opus-5-5`. */
  model?: string;
  /** Tried in order when the main model is overloaded or rate limited. */
  fallbackModels?: readonly string[];
  baseURL?: string;
  maxRetries?: number;
  /** Defaults to 16 000. */
  maxOutputTokens?: number;
  providerOptions?: ProviderOptions;
}

export function anthropicProvider(options: AnthropicProviderOptions): AssistantProvider {
  const anthropic = createAnthropic({ apiKey: options.apiKey ?? '', baseURL: options.baseURL });
  const ids = [options.model ?? DEFAULT_CLAUDE_MODEL, ...(options.fallbackModels ?? [])];
  return {
    name: 'anthropic',
    configured: Boolean(options.apiKey),
    models: ids.map((model) => withContextWindow({ model, languageModel: anthropic(model) })),
    quotaTimeZone: PACIFIC_TIME_ZONE,
    maxRetries: options.maxRetries ?? 2,
    maxOutputTokens: options.maxOutputTokens ?? 16_000,
    providerOptions: options.providerOptions,
    cacheSystemPrompt: true,
  };
}

export interface CustomProviderOptions {
  name: string;
  models: ChainModel[];
  configured?: boolean;
  quotaTimeZone?: string;
  maxRetries?: number;
  maxOutputTokens?: number;
  providerOptions?: ProviderOptions;
  cacheSystemPrompt?: boolean;
}

/** Any AI SDK language models (OpenAI, Bedrock, Vertex, a mock in tests, …). */
export function customProvider(options: CustomProviderOptions): AssistantProvider {
  return {
    name: options.name,
    configured: options.configured ?? options.models.length > 0,
    models: options.models.map(withContextWindow),
    quotaTimeZone: options.quotaTimeZone ?? PACIFIC_TIME_ZONE,
    maxRetries: options.maxRetries ?? (options.models.length > 1 ? 0 : 2),
    maxOutputTokens: options.maxOutputTokens,
    providerOptions: options.providerOptions,
    cacheSystemPrompt: options.cacheSystemPrompt,
  };
}

/**
 * One link of a `providerChain`: a provider built with its own API key, and
 * where it sits in the order. Lower `priority` is tried first (1 before 2);
 * links without a priority keep their array position after the numbered ones.
 */
export interface ChainLink {
  provider: AssistantProvider;
  priority?: number;
  /** Overrides the provider's name in model ids and error reports. */
  name?: string;
}

export interface ProviderChainOptions {
  /** Defaults to the linked provider names joined with `+`. */
  name?: string;
  /** Defaults to 0 (fallback is immediate) when the chain has more than one model. */
  maxRetries?: number;
  /** Defaults to the first configured link's time zone. */
  quotaTimeZone?: string;
}

/**
 * Joins providers into one fallback chain, so a project can inject several
 * API keys (a free Gemini key, a second Gemini project, a paid Claude key…)
 * and rank them. Each model call walks the whole chain in priority order:
 * when a model's daily quota is used up, or it is rate limited or down, the
 * next model answers inline, even if it belongs to another provider.
 *
 * Links whose key is missing (`configured: false`) are left out, so the same
 * code works in environments that only set some of the keys. Each model keeps
 * its own provider's settings (output limit, provider options, prompt
 * caching), and the model ids stay unique: when two links share a model id
 * the later ones are prefixed with the link's name (`backup/gemini-2.5-flash`).
 */
export function providerChain(links: ReadonlyArray<ChainLink | AssistantProvider>, options: ProviderChainOptions = {}): AssistantProvider {
  const normalized = links
    .map((link, index) => ('provider' in link ? { ...link, index } : { provider: link, index }))
    .filter((link) => link.provider.configured && link.provider.models.length > 0)
    .sort((a, b) => rank(a.priority) - rank(b.priority) || a.index - b.index);
  const seen = new Set<string>();
  const models: ChainModel[] = [];
  for (const link of normalized) {
    const name = link.name ?? link.provider.name;
    for (const model of link.provider.models) {
      const id = seen.has(model.model) ? `${name}/${model.model}` : model.model;
      seen.add(id);
      models.push({ ...modelSettings(link.provider, model), ...model, model: id, provider: name });
    }
  }
  return {
    name: options.name ?? (normalized.map((link) => link.name ?? link.provider.name).join('+') || 'chain'),
    configured: models.length > 0,
    models,
    quotaTimeZone: options.quotaTimeZone ?? normalized[0]?.provider.quotaTimeZone ?? PACIFIC_TIME_ZONE,
    maxRetries: options.maxRetries ?? (models.length > 1 ? 0 : normalized[0]?.provider.maxRetries ?? 2),
  };
}

function rank(priority: number | undefined): number {
  return typeof priority === 'number' && Number.isFinite(priority) ? priority : Number.POSITIVE_INFINITY;
}

export type EnvSource = Record<string, string | undefined>;

/**
 * Picks the provider from environment variables, so switching an app to a
 * paid tier is a deployment setting rather than a code change:
 *
 * - `ASSISTANT_PROVIDER`: `gemini` (default when `GEMINI_API_KEY` is set) or
 *   `anthropic`; or a comma-separated priority list such as
 *   `gemini,anthropic`, which builds a `providerChain` in that order
 * - `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`: server-only keys
 * - `ASSISTANT_MODEL`: optional single model id; for Gemini it replaces the
 *   free chain and turns quota tracking off (use it for a paid tier)
 *
 * Pass `process.env` in Node or `Deno.env.toObject()` in Deno.
 */
export function providerFromEnv(env: EnvSource, defaults: { provider?: 'gemini' | 'anthropic' } = {}): AssistantProvider {
  const requested = (env.ASSISTANT_PROVIDER ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name): name is 'gemini' | 'anthropic' => name === 'gemini' || name === 'anthropic');
  const model = env.ASSISTANT_MODEL?.trim() || undefined;
  const build = (name: 'gemini' | 'anthropic') => name === 'anthropic'
    ? anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model })
    : geminiProvider({ apiKey: env.GEMINI_API_KEY, models: model ? [model] : undefined });
  if (requested.length > 1) return providerChain(requested.map(build));
  return build(requested[0] ?? defaults.provider ?? (env.GEMINI_API_KEY ? 'gemini' : 'anthropic'));
}
