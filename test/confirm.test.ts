import { describe, expect, it } from 'vitest';
import { CONFIRMATION_TTL_MS, signConfirmation, stableStringify, verifyConfirmation } from '../src/confirm';

describe('confirmation tokens', () => {
  const payload = { id: 'c1', name: 'add_expense', input: { category: 'rent', amount: 50 } };

  it('verifies the payload it signed, regardless of key order', async () => {
    const token = await signConfirmation('secret', payload, 1_000);
    expect(await verifyConfirmation('secret', token, { ...payload, input: { amount: 50, category: 'rent' } }, 2_000)).toBe(true);
  });

  it('rejects changed payloads, other secrets, expired and malformed tokens', async () => {
    const token = await signConfirmation('secret', payload, 1_000);
    expect(await verifyConfirmation('secret', token, { ...payload, input: { category: 'rent', amount: 51 } }, 2_000)).toBe(false);
    expect(await verifyConfirmation('secret', token, { ...payload, name: 'delete_all' }, 2_000)).toBe(false);
    expect(await verifyConfirmation('other', token, payload, 2_000)).toBe(false);
    expect(await verifyConfirmation('secret', token, payload, 1_000 + CONFIRMATION_TTL_MS + 1)).toBe(false);
    expect(await verifyConfirmation('secret', 'garbage', payload, 2_000)).toBe(false);
    expect(await verifyConfirmation('secret', undefined, payload, 2_000)).toBe(false);
  });

  it('stringifies stably', () => {
    expect(stableStringify({ b: [1, { d: 1, c: 2 }], a: null, skip: undefined })).toBe('{"a":null,"b":[1,{"c":2,"d":1}]}');
  });
});
