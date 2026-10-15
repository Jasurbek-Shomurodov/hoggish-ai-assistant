import { describe, expect, it } from 'vitest';
import { GEMINI_FREE_MODELS } from '../src/providers';
import { createMemoryQuotaStore, exhaustedModels, nextQuotaReset, quotaDate, summarizeQuota } from '../src/quota';

describe('quota day', () => {
  it('uses the Pacific date', () => {
    // 06:30 UTC on 15 Oct is still 14 Oct in Los Angeles (UTC-7).
    expect(quotaDate(new Date('2026-10-15T06:30:00Z'))).toBe('2026-10-14');
    expect(quotaDate(new Date('2026-10-15T07:00:00Z'))).toBe('2026-10-15');
    expect(quotaDate(new Date('2026-10-15T06:30:00Z'), 'Asia/Tashkent')).toBe('2026-10-15');
  });

  it('resets at the next Pacific midnight', () => {
    expect(nextQuotaReset(new Date('2026-10-15T12:00:00Z')).toISOString()).toBe('2026-10-16T07:00:00.000Z');
    expect(nextQuotaReset(new Date('2026-10-16T06:59:59Z')).toISOString()).toBe('2026-10-16T07:00:00.000Z');
    expect(nextQuotaReset(new Date('2026-10-16T07:00:00Z')).toISOString()).toBe('2026-10-17T07:00:00.000Z');
  });

  it('handles daylight saving changes', () => {
    // DST ends 1 Nov 2026: midnight 2 Nov is UTC-8.
    expect(nextQuotaReset(new Date('2026-11-01T20:00:00Z')).toISOString()).toBe('2026-11-02T08:00:00.000Z');
    // DST starts 8 Mar 2026: midnight 9 Mar is UTC-7.
    expect(nextQuotaReset(new Date('2026-03-08T20:00:00Z')).toISOString()).toBe('2026-03-09T07:00:00.000Z');
  });
});

describe('summarizeQuota', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('sums the free chain and estimates questions', () => {
    const summary = summarizeQuota(GEMINI_FREE_MODELS, [], now);
    expect(summary.requestsLimit).toBe(1100);
    expect(summary.requestsLeft).toBe(1100);
    expect(summary.questionsLeft).toBe(366);
    expect(summary.currentModel?.model).toBe('gemini-3.8-flash');
    expect(summary.usingFallback).toBe(false);
    expect(summary.resetsAt).toBe('2026-10-16T07:00:00.000Z');
  });

  it('treats exhausted models as used up and reports fallback', () => {
    const summary = summarizeQuota(GEMINI_FREE_MODELS, [
      { model: 'gemini-3.8-flash', requests: 3, exhausted: true },
      { model: 'gemini-3.7-flash', requests: 25, exhausted: false },
      { model: 'gemini-3.6-flash', requests: 5, exhausted: false },
    ], now);
    expect(summary.currentModel).toEqual({ model: 'gemini-3.6-flash', limit: 20, used: 5, remaining: 15 });
    expect(summary.usingFallback).toBe(true);
    expect(summary.requestsLeft).toBe(1100 - 20 - 20 - 5);
  });

  it('handles everything used up and custom request costs', () => {
    const chain = [{ model: 'a', dailyLimit: 10 }, { model: 'b' }];
    const summary = summarizeQuota(chain, [{ model: 'a', requests: 10, exhausted: false }], now, { requestsPerQuestion: 2 });
    expect(summary.models).toHaveLength(1);
    expect(summary.currentModel).toBeNull();
    expect(summary.questionsLeft).toBe(0);
    expect(exhaustedModels(chain, [{ model: 'a', requests: 10, exhausted: false }])).toEqual(['a']);
  });

  it('ignores garbage counts', () => {
    const summary = summarizeQuota([{ model: 'a', dailyLimit: 10 }], [{ model: 'a', requests: Number.NaN, exhausted: false }], now);
    expect(summary.requestsLeft).toBe(10);
  });
});

describe('memory store', () => {
  it('counts requests and daily limits per day', async () => {
    const store = createMemoryQuotaStore();
    await store.record('2026-10-15', 'a', 'ok');
    await store.record('2026-10-15', 'a', 'ok');
    await store.record('2026-10-15', 'a', 'daily_limit');
    await store.record('2026-10-16', 'a', 'ok');
    expect(await store.load('2026-10-15')).toEqual([{ model: 'a', requests: 2, exhausted: true }]);
    expect(await store.load('2026-10-16')).toEqual([{ model: 'a', requests: 1, exhausted: false }]);
    expect(await store.load('2026-10-17')).toEqual([]);
  });
});
