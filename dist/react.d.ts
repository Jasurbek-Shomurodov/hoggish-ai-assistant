import { ReactNode } from 'react';

/**
 * Newline-delimited JSON events streamed from the assistant endpoint to the
 * browser. Error codes are stable so each app can map them to translated copy.
 */
declare const ASSISTANT_ERROR_CODES: readonly ["UNAUTHORIZED", "INVALID_REQUEST", "FORBIDDEN", "NOT_CONFIGURED", "BUSY", "REFUSED", "TOO_LONG", "SERVER_ERROR"];
type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];
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

interface ModelQuota {
    model: string;
    limit: number;
    used: number;
    remaining: number;
}
interface QuotaSummary {
    requestsLeft: number;
    requestsLimit: number;
    /** Approximate questions left at `requestsPerQuestion` requests each. */
    questionsLeft: number;
    /** The strongest model that still has quota; null when everything is used up. */
    currentModel: ModelQuota | null;
    /** True once the top model is used up and lighter models are answering. */
    usingFallback: boolean;
    /** ISO timestamp of the next quota reset. */
    resetsAt: string;
    models: ModelQuota[];
}

/** Server error codes plus `NETWORK` when the request itself failed. */
type ChatErrorCode = AssistantErrorCode | 'NETWORK';
interface ChatFile {
    fileName: string;
    mimeType: string;
    /** Object URL; revoked on `newChat` and unmount. */
    url: string;
}
type ConfirmationStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
interface ChatConfirmation extends ConfirmationRequest {
    status: ConfirmationStatus;
}
interface ChatEntry {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    files: ChatFile[];
    /** True while this assistant message is streaming. */
    pending: boolean;
    /** Name of the tool running right now, for a status line. */
    activeTool?: string;
    error?: ChatErrorCode;
    /** The user pressed stop. */
    stopped?: boolean;
    /** Actions the model proposed that wait for Confirm/Cancel. */
    confirmations: ChatConfirmation[];
}
interface UseAssistantChatOptions {
    /** Chat endpoint (POST). */
    api: string;
    /** Usage endpoint (GET) for the quota badge; omit to skip quota fetching. */
    usageApi?: string;
    /** JSON-serialisable app context sent with every request (club id, locale…). */
    context?: unknown;
    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
    /** Defaults to `globalThis.fetch`. */
    fetch?: typeof fetch;
    credentials?: RequestCredentials;
    maxHistoryMessages?: number;
    /** Longest accepted question; longer input is cut. */
    maxMessageChars?: number;
    /** Every streamed event, for analytics or custom handling. */
    onEvent?: (event: AssistantEvent, messageId: string) => void;
}
interface UseAssistantChat {
    messages: ChatEntry[];
    /** True while a request is streaming. */
    busy: boolean;
    send: (text: string) => Promise<void>;
    stop: () => void;
    newChat: () => void;
    confirm: (confirmationId: string) => Promise<void>;
    cancel: (confirmationId: string) => void;
    quota: QuotaSummary | null;
    refreshQuota: () => Promise<void>;
}
/**
 * Headless chat state for an assistant endpoint created with
 * `createAssistantHandler`. History is kept here in the browser; the server
 * stores nothing. Works with React 18 and 19.
 */
declare function useAssistantChat(options: UseAssistantChatOptions): UseAssistantChat;
/** Element names used by `AssistantMarkdown`; override to add classes. */
interface MarkdownComponents {
    heading?: (props: {
        level: number;
        children: ReactNode;
    }) => ReactNode;
    paragraph?: (props: {
        children: ReactNode;
    }) => ReactNode;
    list?: (props: {
        ordered: boolean;
        children: ReactNode;
    }) => ReactNode;
    listItem?: (props: {
        children: ReactNode;
    }) => ReactNode;
    table?: (props: {
        header: ReactNode[];
        rows: ReactNode[][];
    }) => ReactNode;
    code?: (props: {
        language?: string;
        text: string;
    }) => ReactNode;
    bold?: (props: {
        children: ReactNode;
    }) => ReactNode;
    inlineCode?: (props: {
        children: ReactNode;
    }) => ReactNode;
}
/**
 * Renders the safe Markdown subset as plain React elements (no
 * dangerouslySetInnerHTML). Unstyled; headings render one level down
 * (`#` → h3) so answers sit under the page's own headings.
 */
declare function AssistantMarkdown({ text, components }: {
    text: string;
    components?: MarkdownComponents;
}): ReactNode;

export { AssistantMarkdown, useAssistantChat };
export type { AssistantErrorCode, AssistantEvent, ChatConfirmation, ChatEntry, ChatErrorCode, ChatFile, ConfirmationRequest, ConfirmationStatus, MarkdownComponents, QuotaSummary, UseAssistantChat, UseAssistantChatOptions };
