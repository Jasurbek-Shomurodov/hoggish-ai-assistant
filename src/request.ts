/**
 * Chat request validation. History is plain text kept by the browser (the
 * server stores nothing); tool calls only live inside one request.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A tool call the user confirmed, echoed back from a `confirm` event. */
export interface ConfirmedCall {
  id: string;
  name: string;
  input: unknown;
  token?: string;
}

export interface ChatRequestBody {
  messages: ChatMessage[];
  /** App-defined request context (club id, locale, …), checked by `authorize`. */
  context?: unknown;
  confirmation?: ConfirmedCall;
}

export interface RequestLimits {
  /** Longest accepted user message. Default 4 000 characters. */
  maxMessageChars: number;
  /** Assistant messages are cut to this length. Default 8 000 characters. */
  maxAssistantChars: number;
  /** Newest messages kept from the history. Default 30. */
  maxHistoryMessages: number;
}

export const DEFAULT_LIMITS: RequestLimits = {
  maxMessageChars: 4_000,
  maxAssistantChars: 8_000,
  maxHistoryMessages: 30,
};

/** Bodies beyond this many messages are rejected rather than trimmed. */
const HARD_MESSAGE_CAP = 500;
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** Keeps the newest messages that fit, still starting with a user turn. */
export function trimHistory<T extends ChatMessage>(messages: readonly T[], limit = DEFAULT_LIMITS.maxHistoryMessages): T[] {
  const recent = messages.slice(-Math.max(1, limit));
  const firstUser = recent.findIndex((message) => message.role === 'user');
  return firstUser <= 0 ? recent : recent.slice(firstUser);
}

function parseConfirmation(value: unknown): ConfirmedCall | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return null;
  const { id, name, input, token } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !id || id.length > 200) return null;
  if (typeof name !== 'string' || !TOOL_NAME.test(name)) return null;
  if (token !== undefined && typeof token !== 'string') return null;
  return { id, name, input, ...(token !== undefined ? { token } : {}) };
}

/** Returns the validated body, or null when it is malformed. */
export function parseChatRequest(body: unknown, limits: RequestLimits = DEFAULT_LIMITS): ChatRequestBody | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.messages) || raw.messages.length === 0 || raw.messages.length > HARD_MESSAGE_CAP) return null;

  const messages: ChatMessage[] = [];
  for (const item of raw.messages) {
    if (!item || typeof item !== 'object') return null;
    const { role, content } = item as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    const text = content.trim();
    if (role === 'user') {
      if (!text || text.length > limits.maxMessageChars) return null;
      messages.push({ role, content: text });
    } else if (text) {
      messages.push({ role, content: text.slice(0, limits.maxAssistantChars) });
    }
  }

  const confirmation = parseConfirmation(raw.confirmation);
  if (confirmation === null) return null;

  const history = trimHistory(messages, limits.maxHistoryMessages);
  if (history[0]?.role !== 'user') return null;
  // A new question ends with the user; a confirmation continues the assistant's turn.
  if (!confirmation && history[history.length - 1]?.role !== 'user') return null;

  return { messages: history, context: raw.context, ...(confirmation ? { confirmation } : {}) };
}
