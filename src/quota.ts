/**
 * Daily request quotas for free-tier models. Each model in a fallback chain
 * has its own per-day request limit; the assistant walks down the chain as
 * models run out. Everything here is pure and runs in any JS runtime.
 */

/** Gemini free-tier quotas reset at midnight Pacific time. */
export const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

/** A typical question takes a data fetch or two plus the answer. */
export const REQUESTS_PER_QUESTION = 3;

export interface QuotaModel {
  model: string;
  /** Requests per quota day; models without a limit are not quota-tracked. */
  dailyLimit?: number;
}

export interface ModelUsageRow {
  model: string;
  requests: number;
  /** Set once the provider rejected the model for its daily quota. */
  exhausted: boolean;
}

export type RequestResult = 'ok' | 'daily_limit';

/**
 * Persists request counts per model per quota day. Implementations must be
 * best effort: a failing store should log and resolve, never block answers.
 */
export interface QuotaStore {
  /** Rows for one quota day; null when usage cannot be read. */
  load(day: string): Promise<ModelUsageRow[] | null>;
  record(day: string, model: string, result: RequestResult): Promise<void>;
}

export interface ModelQuota {
  model: string;
  limit: number;
  used: number;
  remaining: number;
}

export interface QuotaSummary {
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

export interface QuotaOptions {
  timeZone?: string;
  requestsPerQuestion?: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(date: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'), second: part('second') };
}

/** The quota day (YYYY-MM-DD in `timeZone`) that `now` falls in. */
export function quotaDate(now = new Date(), timeZone = PACIFIC_TIME_ZONE): string {
  const { year, month, day } = zonedParts(now, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The next midnight in `timeZone`, when daily quotas reset. Handles DST changes. */
export function nextQuotaReset(now = new Date(), timeZone = PACIFIC_TIME_ZONE): Date {
  const today = quotaDate(now, timeZone);
  const { hour, minute, second } = zonedParts(now, timeZone);
  const elapsed = ((hour * 60 + minute) * 60 + second) * 1000 + now.getMilliseconds();
  // Around DST changes a day is 23 or 25 hours, so the estimate can be off by
  // an hour; binary-search the first instant whose local date is tomorrow.
  const estimate = now.getTime() - elapsed + DAY_MS;
  let low = Math.max(now.getTime(), estimate - 3 * HOUR_MS);
  let high = estimate + 3 * HOUR_MS;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (quotaDate(new Date(middle), timeZone) === today) low = middle;
    else high = middle;
  }
  return new Date(high);
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Only models with a daily limit are quota-tracked. */
export function trackedModels(models: readonly QuotaModel[]): Array<Required<QuotaModel>> {
  return models.filter((entry): entry is Required<QuotaModel> => typeof entry.dailyLimit === 'number' && entry.dailyLimit > 0);
}

export function summarizeQuota(
  chain: readonly QuotaModel[],
  rows: readonly ModelUsageRow[],
  now = new Date(),
  options: QuotaOptions = {},
): QuotaSummary {
  const byModel = new Map(rows.map((row) => [row.model, row]));
  const models = trackedModels(chain).map(({ model, dailyLimit }) => {
    const row = byModel.get(model);
    const used = row?.exhausted ? dailyLimit : Math.min(dailyLimit, Math.max(0, Number(row?.requests ?? 0) || 0));
    return { model, limit: dailyLimit, used, remaining: dailyLimit - used };
  });
  const requestsLeft = models.reduce((total, model) => total + model.remaining, 0);
  const currentIndex = models.findIndex((model) => model.remaining > 0);
  const perQuestion = Math.max(1, options.requestsPerQuestion ?? REQUESTS_PER_QUESTION);
  return {
    requestsLeft,
    requestsLimit: models.reduce((total, model) => total + model.limit, 0),
    questionsLeft: Math.floor(requestsLeft / perQuestion),
    currentModel: currentIndex === -1 ? null : models[currentIndex]!,
    usingFallback: currentIndex !== 0,
    resetsAt: nextQuotaReset(now, options.timeZone ?? PACIFIC_TIME_ZONE).toISOString(),
    models,
  };
}

/** Models whose daily quota is recorded as used up. */
export function exhaustedModels(chain: readonly QuotaModel[], rows: readonly ModelUsageRow[]): string[] {
  return summarizeQuota(chain, rows).models.filter((model) => model.remaining <= 0).map((model) => model.model);
}

/** In-process store for tests, local development and single-instance servers. */
export function createMemoryQuotaStore(): QuotaStore & { rows: Map<string, ModelUsageRow[]> } {
  const rows = new Map<string, ModelUsageRow[]>();
  return {
    rows,
    async load(day) {
      return (rows.get(day) ?? []).map((row) => ({ ...row }));
    },
    async record(day, model, result) {
      const dayRows = rows.get(day) ?? [];
      let row = dayRows.find((entry) => entry.model === model);
      if (!row) {
        row = { model, requests: 0, exhausted: false };
        dayRows.push(row);
      }
      if (result === 'daily_limit') row.exhausted = true;
      else row.requests += 1;
      rows.set(day, dayRows);
    },
  };
}
