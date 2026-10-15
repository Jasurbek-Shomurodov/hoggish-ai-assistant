/**
 * Daily request quotas for free-tier models. Each model in a fallback chain
 * has its own per-day request limit; the assistant walks down the chain as
 * models run out. Everything here is pure and runs in any JS runtime.
 */
/** Gemini free-tier quotas reset at midnight Pacific time. */
declare const PACIFIC_TIME_ZONE = "America/Los_Angeles";
/** A typical question takes a data fetch or two plus the answer. */
declare const REQUESTS_PER_QUESTION = 3;
interface QuotaModel {
    model: string;
    /** Requests per quota day; models without a limit are not quota-tracked. */
    dailyLimit?: number;
}
interface ModelUsageRow {
    model: string;
    requests: number;
    /** Set once the provider rejected the model for its daily quota. */
    exhausted: boolean;
}
type RequestResult = 'ok' | 'daily_limit';
/**
 * Persists request counts per model per quota day. Implementations must be
 * best effort: a failing store should log and resolve, never block answers.
 */
interface QuotaStore {
    /** Rows for one quota day; null when usage cannot be read. */
    load(day: string): Promise<ModelUsageRow[] | null>;
    record(day: string, model: string, result: RequestResult): Promise<void>;
}
interface ModelQuota {
    model: string;
    limit: number;
    used: number;
    remaining: number;
}
interface QuotaSummary {
    requestsLeft: number;
    requestsLimit: number;
    /** Approximate questions left at `requestsPerQuestion` requests each. */
    questionsLeft: number;
    /** The strongest model that still has quota; null when everything is used up. */
    currentModel: ModelQuota | null;
    /** True once the top model is used up and lighter models are answering. */
    usingFallback: boolean;
    /** ISO timestamp of the next quota reset. */
    resetsAt: string;
    models: ModelQuota[];
}
interface QuotaOptions {
    timeZone?: string;
    requestsPerQuestion?: number;
}
/** The quota day (YYYY-MM-DD in `timeZone`) that `now` falls in. */
declare function quotaDate(now?: Date, timeZone?: string): string;
/** The next midnight in `timeZone`, when daily quotas reset. Handles DST changes. */
declare function nextQuotaReset(now?: Date, timeZone?: string): Date;
/** Only models with a daily limit are quota-tracked. */
declare function trackedModels(models: readonly QuotaModel[]): Array<Required<QuotaModel>>;
declare function summarizeQuota(chain: readonly QuotaModel[], rows: readonly ModelUsageRow[], now?: Date, options?: QuotaOptions): QuotaSummary;
/** Models whose daily quota is recorded as used up. */
declare function exhaustedModels(chain: readonly QuotaModel[], rows: readonly ModelUsageRow[]): string[];
/** In-process store for tests, local development and single-instance servers. */
declare function createMemoryQuotaStore(): QuotaStore & {
    rows: Map<string, ModelUsageRow[]>;
};

export { PACIFIC_TIME_ZONE as P, REQUESTS_PER_QUESTION as e, createMemoryQuotaStore as f, exhaustedModels as g, nextQuotaReset as n, quotaDate as q, summarizeQuota as s, trackedModels as t };
export type { ModelQuota as M, QuotaStore as Q, RequestResult as R, QuotaModel as a, QuotaSummary as b, ModelUsageRow as c, QuotaOptions as d };
