export { M as ModelQuota, c as ModelUsageRow, P as PACIFIC_TIME_ZONE, a as QuotaModel, d as QuotaOptions, Q as QuotaStore, b as QuotaSummary, e as REQUESTS_PER_QUESTION, R as RequestResult, f as createMemoryQuotaStore, g as exhaustedModels, n as nextQuotaReset, q as quotaDate, s as summarizeQuota, t as trackedModels } from './quota-DBUQslDa.js';

/**
 * Newline-delimited JSON events streamed from the assistant endpoint to the
 * browser. Error codes are stable so each app can map them to translated copy.
 */
declare const ASSISTANT_ERROR_CODES: readonly ["UNAUTHORIZED", "INVALID_REQUEST", "FORBIDDEN", "NOT_CONFIGURED", "BUSY", "REFUSED", "TOO_LONG", "SERVER_ERROR"];
type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];
/** HTTP status used when an error is returned before streaming starts. */
declare const ERROR_STATUS: Record<AssistantErrorCode, number>;
/** A tool call the model proposed that waits for the user to confirm it. */
interface ConfirmationRequest {
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
type AssistantEvent = {
    type: 'text';
    text: string;
} | {
    type: 'tool';
    name: string;
    id?: string;
} | {
    type: 'file';
    fileName: string;
    mimeType: string;
    data: string;
} | ({
    type: 'confirm';
} & ConfirmationRequest) | {
    type: 'error';
    code: AssistantErrorCode;
} | {
    type: 'done';
};
declare function isAssistantErrorCode(value: unknown): value is AssistantErrorCode;
/** Serialises one event as an NDJSON line. */
declare function encodeEvent(event: AssistantEvent): string;
/** Splits a growing NDJSON buffer into complete events and the unfinished tail. */
declare function parseEventChunk(buffer: string): {
    events: AssistantEvent[];
    rest: string;
};
/** Reads an NDJSON response body as a stream of events. */
declare function readEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<AssistantEvent>;

/**
 * Chat request validation. History is plain text kept by the browser (the
 * server stores nothing); tool calls only live inside one request.
 */
interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}
/** A tool call the user confirmed, echoed back from a `confirm` event. */
interface ConfirmedCall {
    id: string;
    name: string;
    input: unknown;
    token?: string;
}
interface ChatRequestBody {
    messages: ChatMessage[];
    /** App-defined request context (club id, locale, …), checked by `authorize`. */
    context?: unknown;
    confirmation?: ConfirmedCall;
}
interface RequestLimits {
    /** Longest accepted user message. Default 4 000 characters. */
    maxMessageChars: number;
    /** Assistant messages are cut to this length. Default 8 000 characters. */
    maxAssistantChars: number;
    /** Newest messages kept from the history. Default 30. */
    maxHistoryMessages: number;
}
declare const DEFAULT_LIMITS: RequestLimits;
/** Keeps the newest messages that fit, still starting with a user turn. */
declare function trimHistory<T extends ChatMessage>(messages: readonly T[], limit?: number): T[];
/** Returns the validated body, or null when it is malformed. */
declare function parseChatRequest(body: unknown, limits?: RequestLimits): ChatRequestBody | null;

export { ASSISTANT_ERROR_CODES, DEFAULT_LIMITS, ERROR_STATUS, encodeEvent, isAssistantErrorCode, parseChatRequest, parseEventChunk, readEventStream, trimHistory };
export type { AssistantErrorCode, AssistantEvent, ChatMessage, ChatRequestBody, ConfirmationRequest, ConfirmedCall, RequestLimits };
