import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { PACIFIC_TIME_ZONE, type QuotaModel } from './quota';

/** Provider-specific call options, keyed by provider (`google`, `anthropic`, …). */
export type ProviderOptions = Record<string, Record<string, unknown>>;

/** One model in a fallback chain. */
export interface ChainModel extends QuotaModel {
  /** Stable id used for quota rows and cooldowns, normally the model id. */
  model: string;
  languageModel: LanguageModel;
}

/**
 * A configured provider: an ordered model chain (strongest first) plus call
 * settings. Build one with `geminiProvider`, `anthropicProvider`,
 * `customProvider` or `providerFromEnv`; switching providers is a config change.
 */
export interface AssistantProvider {
  name: string;
  /** False when the server-side API key is missing. */
  configured: boolean;
  models: ChainModel[];
  /** Time zone whose midnight resets the daily limits. */
  quotaTimeZone: string;
  /** AI SDK retries per model. Chains default to 0 so fallback is immediate. */
  maxRetries: number;
  maxOutputTokens?: number;
  providerOptions?: ProviderOptions;
  /** Mark the stable system prompt cacheable (Anthropic prompt caching). */
  cacheSystemPrompt?: boolean;
}

export type ModelInput = string | QuotaModel;

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

function normalizeModels(models: readonly ModelInput[]): QuotaModel[] {
  return models.map((entry) => (typeof entry === 'string' ? { model: entry } : { ...entry }));
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
}

export function geminiProvider(options: GeminiProviderOptions): AssistantProvider {
  const google = createGoogleGenerativeAI({ apiKey: options.apiKey ?? '', baseURL: options.baseURL });
  const models = normalizeModels(options.models ?? GEMINI_FREE_MODELS);
  return {
    name: 'gemini',
    configured: Boolean(options.apiKey),
    models: models.map((entry) => ({ ...entry, languageModel: google(entry.model) })),
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
    models: ids.map((model) => ({ model, languageModel: anthropic(model) })),
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
    models: options.models,
    quotaTimeZone: options.quotaTimeZone ?? PACIFIC_TIME_ZONE,
    maxRetries: options.maxRetries ?? (options.models.length > 1 ? 0 : 2),
    maxOutputTokens: options.maxOutputTokens,
    providerOptions: options.providerOptions,
    cacheSystemPrompt: options.cacheSystemPrompt,
  };
}

export type EnvSource = Record<string, string | undefined>;

/**
 * Picks the provider from environment variables, so switching an app to a
 * paid tier is a deployment setting rather than a code change:
 *
 * - `ASSISTANT_PROVIDER`: `gemini` (default when `GEMINI_API_KEY` is set) or `anthropic`
 * - `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`: server-only keys
 * - `ASSISTANT_MODEL`: optional single model id; for Gemini it replaces the
 *   free chain and turns quota tracking off (use it for a paid tier)
 *
 * Pass `process.env` in Node or `Deno.env.toObject()` in Deno.
 */
export function providerFromEnv(env: EnvSource, defaults: { provider?: 'gemini' | 'anthropic' } = {}): AssistantProvider {
  const requested = env.ASSISTANT_PROVIDER?.trim().toLowerCase();
  const name = requested === 'anthropic' || requested === 'gemini'
    ? requested
    : defaults.provider ?? (env.GEMINI_API_KEY ? 'gemini' : 'anthropic');
  const model = env.ASSISTANT_MODEL?.trim() || undefined;
  if (name === 'anthropic') return anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model });
  return geminiProvider({ apiKey: env.GEMINI_API_KEY, models: model ? [model] : undefined });
}
