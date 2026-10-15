import { describe, expect, it, vi } from 'vitest';
import { createSupabaseQuotaStore } from '../src/supabase';

function fakeClient(result: { data?: unknown; error?: { message: string; code?: string } | null }) {
  const eq = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn(async () => ({ error: result.error ?? null }));
  return { client: { from, rpc }, from, select, eq, rpc };
}

describe('Supabase quota store', () => {
  it('loads rows for the quota day', async () => {
    const fake = fakeClient({ data: [{ model: 'a', requests: '3', exhausted: true }] });
    const store = createSupabaseQuotaStore(fake.client);
    expect(await store.load('2026-10-15')).toEqual([{ model: 'a', requests: 3, exhausted: true }]);
    expect(fake.from).toHaveBeenCalledWith('assistant_model_usage');
    expect(fake.select).toHaveBeenCalledWith('model,requests,exhausted');
    expect(fake.eq).toHaveBeenCalledWith('usage_date', '2026-10-15');
  });

  it('records through the RPC', async () => {
    const fake = fakeClient({});
    const store = createSupabaseQuotaStore(fake.client, { recordFunction: 'my_record' });
    await store.record('2026-10-15', 'a', 'daily_limit');
    expect(fake.rpc).toHaveBeenCalledWith('my_record', { p_usage_date: '2026-10-15', p_model: 'a', p_exhausted: true });
  });

  it('returns null and reports errors instead of throwing', async () => {
    const onError = vi.fn();
    const fake = fakeClient({ error: { message: 'relation does not exist', code: '42P01' } });
    const store = createSupabaseQuotaStore(fake.client, { onError });
    expect(await store.load('2026-10-15')).toBeNull();
    await store.record('2026-10-15', 'a', 'ok');
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
