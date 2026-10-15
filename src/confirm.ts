/**
 * Signed confirmation tokens. The server is stateless (history lives in the
 * browser), so a confirmed tool call comes back from the client. With a
 * `confirmationSecret`, the handler only runs calls whose id, name and input
 * match a proposal it signed recently. Uses Web Crypto, so it runs anywhere.
 */

export const CONFIRMATION_TTL_MS = 60 * 60 * 1000;

/** JSON with sorted object keys, so equal values always sign the same. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keys.set(secret, key);
  }
  return key;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

interface ConfirmationPayload {
  id: string;
  name: string;
  input: unknown;
}

function message(issuedAt: number, payload: ConfirmationPayload): Uint8Array {
  return new TextEncoder().encode(`${issuedAt}\n${payload.id}\n${payload.name}\n${stableStringify(payload.input)}`);
}

export async function signConfirmation(secret: string, payload: ConfirmationPayload, now = Date.now()): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), message(now, payload) as BufferSource);
  return `${now}.${toHex(signature)}`;
}

export async function verifyConfirmation(
  secret: string,
  token: unknown,
  payload: ConfirmationPayload,
  now = Date.now(),
): Promise<boolean> {
  if (typeof token !== 'string') return false;
  const [issued, hex, extra] = token.split('.');
  const issuedAt = Number(issued);
  const signature = fromHex(hex ?? '');
  if (extra !== undefined || !Number.isSafeInteger(issuedAt) || !signature) return false;
  if (issuedAt > now + 60_000 || now - issuedAt > CONFIRMATION_TTL_MS) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(secret), signature as BufferSource, message(issuedAt, payload) as BufferSource);
}
