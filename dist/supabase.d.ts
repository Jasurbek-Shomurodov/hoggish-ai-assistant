import { QuotaStore } from './index.js';

/**
 * The parts of a supabase-js client the store uses. Typed loosely so clients
 * generated with any `Database` type are accepted.
 */
interface SupabaseClientLike {
    from: (...args: any[]) => any;
    rpc: (...args: any[]) => any;
}
interface SupabaseQuotaStoreOptions {
    /** Default `assistant_model_usage`. */
    table?: string;
    /** Default `record_assistant_model_request`. */
    recordFunction?: string;
    onError?: (error: {
        message: string;
        code?: string;
    }, operation: 'load' | 'record') => void;
}
/**
 * Quota store backed by the table and RPC in `sql/assistant_model_usage.sql`.
 * Pass a **service-role** client created on the server: the table is not
 * readable or writable by `anon` or `authenticated`. Counting is best effort;
 * a missing table only turns the quota display off.
 */
declare function createSupabaseQuotaStore(client: SupabaseClientLike, options?: SupabaseQuotaStoreOptions): QuotaStore;

export { createSupabaseQuotaStore };
export type { SupabaseClientLike, SupabaseQuotaStoreOptions };
