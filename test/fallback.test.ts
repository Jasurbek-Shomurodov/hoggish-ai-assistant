import { RetryError } from 'ai';
import { describe, expect, it } from 'vitest';
import { Cooldowns, fallbackReason, isDailyQuotaError, modelsToTry } from '../src/fallback';
import { apiError, dailyQuotaError, minuteQuotaError } from './helpers';

describe('fallbackReason', () => {
  it('classifies provider errors', () => {
    expect(fallbackReason(dailyQuotaError())).toBe('daily');
    expect(fallbackReason(minuteQuotaError())).toBe('rate');
    expect(fallbackReason(apiError(404))).toBe('missing');
    expect(fallbackReason(apiError(500))).toBe('unavailable');
    expect(fallbackReason(apiError(503))).toBe('unavailable');
    expect(fallbackReason(apiError(529))).toBe('unavailable');
    expect(fallbackReason(apiError(400))).toBeNull();
    expect(fallbackReason(apiError(401))).toBeNull();
    expect(fallbackReason(new Error('boom'))).toBeNull();
  });

  it('unwraps retry errors', () => {
    const wrapped = new RetryError({ message: 'retries', reason: 'maxRetriesExceeded', errors: [apiError(503), dailyQuotaError()] });
    expect(fallbackReason(wrapped)).toBe('daily');
  });

  it('detects per-day quota messages', () => {
    expect(isDailyQuotaError('GenerateRequestsPerDayPerProjectPerModel-FreeTier')).toBe(true);
    expect(isDailyQuotaError('Quota exceeded: requests per day')).toBe(true);
    expect(isDailyQuotaError('GenerateRequestsPerMinutePerProjectPerModel')).toBe(false);
    expect(isDailyQuotaError(undefined)).toBe(false);
  });
});

describe('modelsToTry', () => {
  const chain = [{ model: 'a' }, { model: 'b' }, { model: 'c' }];

  it('skips used-up and cooling models', () => {
    let now = 1_000;
    const cooldowns = new Cooldowns(() => now);
    cooldowns.set('b', 'rate');
    expect(modelsToTry(chain, new Set(['a']), cooldowns).map((entry) => entry.model)).toEqual(['c']);
    now += 60_001;
    expect(modelsToTry(chain, new Set(['a']), cooldowns).map((entry) => entry.model)).toEqual(['b', 'c']);
  });

  it('tries the chain anyway when every model looks used up', () => {
    const cooldowns = new Cooldowns();
    expect(modelsToTry(chain, new Set(['a', 'b', 'c']), cooldowns).map((entry) => entry.model)).toEqual(['a', 'b', 'c']);
    cooldowns.set('a', 'missing');
    expect(modelsToTry(chain, new Set(['a', 'b', 'c']), cooldowns).map((entry) => entry.model)).toEqual(['b', 'c']);
  });

  it('keeps missing models out for an hour', () => {
    let now = 0;
    const cooldowns = new Cooldowns(() => now);
    cooldowns.set('a', 'missing');
    now = 59 * 60_000;
    expect(cooldowns.isCooling('a')).toBe(true);
    now = 61 * 60_000;
    expect(cooldowns.isCooling('a')).toBe(false);
  });
});
