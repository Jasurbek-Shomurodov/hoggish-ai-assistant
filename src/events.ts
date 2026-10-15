/**
 * Newline-delimited JSON events streamed from the assistant endpoint to the
 * browser. Error codes are stable so each app can map them to translated copy.
 */
export const ASSISTANT_ERROR_CODES = [
  'UNAUTHORIZED',
  'INVALID_REQUEST',
  'FORBIDDEN',
  'NOT_CONFIGURED',
  'BUSY',
  'REFUSED',
  'TOO_LONG',
  'SERVER_ERROR',
] as const;

export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];

/** HTTP status used when an error is returned before streaming starts. */
export const ERROR_STATUS: Record<AssistantErrorCode, number> = {
  UNAUTHORIZED: 401,
  INVALID_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_CONFIGURED: 503,
  BUSY: 429,
  REFUSED: 422,
  TOO_LONG: 422,
  SERVER_ERROR: 500,
};

/** A tool call the model proposed that waits for the user to confirm it. */
export interface ConfirmationRequest {
  /** The model's tool call id. */
  id: string;
  /** Tool name. */
  name: string;
  /** Validated tool input, sent back unchanged when the user confirms. */
  input: unknown;
  /** Optional human-readable description from the tool's `describe`. */
  summary?: string;
  /** HMAC over id, name and input when the handler has a `confirmationSecret`. */
  token?: string;
}

/** The model answering a model call, sent when it accepts the call. */
export interface ModelInfo {
  /** Model id (`gemini-3.8-flash`, `claude-opus-5-5`, `backup/gemini-3.8-flash`…). */
  model: string;
  provider?: string;
  /** Context window in tokens, when known. */
  contextWindow?: number;
}

/** Token usage of one finished model call. */
export interface UsageInfo {
  model: string;
  /** Prompt tokens of this call: system prompt, tools and the whole history. */
  inputTokens: number;
  outputTokens: number;
}

export type AssistantEvent =
  | { type: 'text'; text: string }
  | ({ type: 'model' } & ModelInfo)
  | ({ type: 'usage' } & UsageInfo)
  | { type: 'tool'; name: string; id?: string }
  | { type: 'file'; fileName: string; mimeType: string; data: string }
  | ({ type: 'confirm' } & ConfirmationRequest)
  | { type: 'error'; code: AssistantErrorCode }
  | { type: 'done' };

export function isAssistantErrorCode(value: unknown): value is AssistantErrorCode {
  return typeof value === 'string' && (ASSISTANT_ERROR_CODES as readonly string[]).includes(value);
}

const EVENT_TYPES = new Set(['text', 'model', 'usage', 'tool', 'file', 'confirm', 'error', 'done']);

function isEvent(value: unknown): value is AssistantEvent {
  return typeof value === 'object' && value !== null && EVENT_TYPES.has((value as { type?: unknown }).type as string);
}

/** Serialises one event as an NDJSON line. */
export function encodeEvent(event: AssistantEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** Splits a growing NDJSON buffer into complete events and the unfinished tail. */
export function parseEventChunk(buffer: string): { events: AssistantEvent[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const events: AssistantEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isEvent(parsed)) events.push(parsed);
    } catch {
      // A malformed line is skipped rather than ending the whole answer.
    }
  }
  return { events, rest };
}

/** Reads an NDJSON response body as a stream of events. */
export async function* readEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<AssistantEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const { events, rest } = parseEventChunk(done ? `${buffer}\n` : buffer);
      buffer = rest;
      yield* events;
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}
