import type { ModelUsageRow, QuotaStore, RequestResult } from './quota';

/**
 * The parts of a supabase-js client the store uses. Typed loosely so clients
 * generated with any `Database` type are accepted.
 */
export interface SupabaseClientLike {
  from: (...args: any[]) => any;
  rpc: (...args: any[]) => any;
}

export interface SupabaseQuotaStoreOptions {
  /** Default `assistant_model_usage`. */
  table?: string;
  /** Default `record_assistant_model_request`. */
  recordFunction?: string;
  onError?: (error: { message: string; code?: string }, operation: 'load' | 'record') => void;
}

interface PostgrestError {
  message: string;
  code?: string;
}

/** Undefined table or function: the migration was not applied yet. */
function isMissingObject(error: PostgrestError): boolean {
  return error.code === '42P01' || error.code === '42883' || error.code === 'PGRST202' || error.code === 'PGRST205';
}

/**
 * Quota store backed by the table and RPC in `sql/assistant_model_usage.sql`.
 * Pass a **service-role** client created on the server: the table is not
 * readable or writable by `anon` or `authenticated`. Counting is best effort;
 * a missing table only turns the quota display off.
 */
export function createSupabaseQuotaStore(client: SupabaseClientLike, options: SupabaseQuotaStoreOptions = {}): QuotaStore {
  const table = options.table ?? 'assistant_model_usage';
  const recordFunction = options.recordFunction ?? 'record_assistant_model_request';
  const report = options.onError ?? ((error, operation) => {
    if (!isMissingObject(error)) console.error('[hoggish-assistant] quota', operation, { code: error.code, message: error.message });
  });

  return {
    async load(day: string): Promise<ModelUsageRow[] | null> {
      const { data, error } = await client.from(table).select('model,requests,exhausted').eq('usage_date', day) as {
        data: ModelUsageRow[] | null;
        error: PostgrestError | null;
      };
      if (error) {
        report(error, 'load');
        return null;
      }
      return (data ?? []).map((row) => ({ model: row.model, requests: Number(row.requests) || 0, exhausted: Boolean(row.exhausted) }));
    },
    async record(day: string, model: string, result: RequestResult): Promise<void> {
      const { error } = await client.rpc(recordFunction, {
        p_usage_date: day,
        p_model: model,
        p_exhausted: result === 'daily_limit',
      }) as { error: PostgrestError | null };
      if (error) report(error, 'record');
    },
  };
}
