import { Fragment, createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isAssistantErrorCode, readEventStream, type AssistantErrorCode, type AssistantEvent, type ConfirmationRequest, type ModelInfo, type UsageInfo } from './events';
import { parseInline, parseMarkdown, type MarkdownBlock } from './markdown';
import type { QuotaSummary } from './quota';
import { DEFAULT_LIMITS, estimateTokens, trimHistory, type ChatMessage } from './request';

/** Server error codes plus `NETWORK` when the request itself failed. */
export type ChatErrorCode = AssistantErrorCode | 'NETWORK';

export interface ChatFile {
  fileName: string;
  mimeType: string;
  /** Object URL; revoked on `newChat` and unmount. */
  url: string;
}

export type ConfirmationStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface ChatConfirmation extends ConfirmationRequest {
  status: ConfirmationStatus;
}

export interface ChatEntry {
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
  /** The model that produced this answer (the last one, if a fallback switched mid-answer). */
  model?: ModelInfo;
}

/** How full the current model's context window is, for a header or badge. */
export interface ContextStatus {
  model: string;
  /** Tokens the model accepts; null when unknown for this model. */
  contextWindow: number | null;
  /** Prompt tokens of the last model call: system prompt, tools and history. */
  usedTokens: number;
  /** Tokens still free in the window; null when the window is unknown. */
  tokensLeft: number | null;
  /** 0–1 share of the window in use; null when the window is unknown. */
  usedShare: number | null;
  /**
   * Estimate of how many more messages of this conversation's average size
   * fit before the window is full; null when the window is unknown. The hook
   * also trims history to `maxHistoryMessages`, so older messages drop out
   * long before a large window fills.
   */
  messagesLeft: number | null;
}

export interface UseAssistantChatOptions {
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

export interface UseAssistantChat {
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
  /**
   * The model in use: the one that produced the latest answer, else the one
   * the usage endpoint says would answer next. Null until either is known.
   */
  model: ModelInfo | null;
  /** Context-window usage of the latest answer; null before the first answer. */
  context: ContextStatus | null;
}

/** Builds the context status from a model's usage report and the history that was sent. */
export function contextStatus(usage: UsageInfo, model: ModelInfo | null, history: readonly ChatMessage[]): ContextStatus {
  const contextWindow = model?.model === usage.model && model.contextWindow ? model.contextWindow : null;
  const usedTokens = usage.inputTokens + usage.outputTokens;
  if (!contextWindow) return { model: usage.model, contextWindow: null, usedTokens, tokensLeft: null, usedShare: null, messagesLeft: null };
  const tokensLeft = Math.max(0, contextWindow - usedTokens);
  const historyTokens = history.reduce((total, message) => total + estimateTokens(message.content), 0);
  const perMessage = Math.max(50, history.length ? historyTokens / history.length : 0);
  return {
    model: usage.model,
    contextWindow,
    usedTokens,
    tokensLeft,
    usedShare: Math.min(1, usedTokens / contextWindow),
    messagesLeft: Math.floor(tokensLeft / perMessage),
  };
}

function base64ToBlob(data: string, mimeType: string): Blob {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Headless chat state for an assistant endpoint created with
 * `createAssistantHandler`. History is kept here in the browser; the server
 * stores nothing. Works with React 18 and 19.
 */
export function useAssistantChat(options: UseAssistantChatOptions): UseAssistantChat {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<QuotaSummary | null>(null);
  const [answeredBy, setAnsweredBy] = useState<ModelInfo | null>(null);
  const [nextModel, setNextModel] = useState<ModelInfo | null>(null);
  const [context, setContext] = useState<ContextStatus | null>(null);
  const answeredByRef = useRef<ModelInfo | null>(null);
  const sentHistoryRef = useRef<ChatMessage[]>([]);
  const messagesRef = useRef<ChatEntry[]>([]);
  const optionsRef = useRef(options);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const fileUrlsRef = useRef<string[]>([]);
  const mountedRef = useRef(true);
  const quotaRequestRef = useRef(0);
  optionsRef.current = options;
  const contextKey = JSON.stringify(options.context ?? null);

  const update = useCallback((updater: (current: ChatEntry[]) => ChatEntry[]) => {
    messagesRef.current = updater(messagesRef.current);
    if (mountedRef.current) setMessages(messagesRef.current);
  }, []);

  const updateEntry = useCallback((id: string, change: (entry: ChatEntry) => ChatEntry) => {
    update((current) => current.map((entry) => (entry.id === id ? change(entry) : entry)));
  }, [update]);

  const refreshQuota = useCallback(async () => {
    const { usageApi, context, credentials } = optionsRef.current;
    if (!usageApi) return;
    // Only the newest request may update state, so a slow earlier response
    // (for the previous context) cannot overwrite a newer one.
    const request = ++quotaRequestRef.current;
    const current = () => mountedRef.current && request === quotaRequestRef.current;
    const fetcher = optionsRef.current.fetch ?? globalThis.fetch;
    try {
      const url = new URL(usageApi, globalThis.location?.href ?? 'http://localhost');
      if (context !== undefined) url.searchParams.set('context', JSON.stringify(context));
      const headers = typeof optionsRef.current.headers === 'function' ? await optionsRef.current.headers() : optionsRef.current.headers;
      const response = await fetcher(url.toString(), { cache: 'no-store', credentials, headers });
      const payload = response.ok ? await response.json() as { quota?: QuotaSummary | null; model?: ModelInfo | null } : null;
      if (current()) {
        setQuota(payload?.quota ?? null);
        setNextModel(payload?.model ?? null);
      }
    } catch {
      if (current()) {
        setQuota(null);
        setNextModel(null);
      }
    }
  }, []);

  // Keeps the previous quota and model on screen while the new context loads
  // (a language switch would otherwise blank the badge); a failed load clears them.
  useEffect(() => {
    void refreshQuota();
  }, [contextKey, options.usageApi, refreshQuota]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      fileUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      fileUrlsRef.current = [];
    };
  }, []);

  const applyEvent = useCallback((id: string, event: AssistantEvent) => {
    optionsRef.current.onEvent?.(event, id);
    switch (event.type) {
      case 'text':
        updateEntry(id, (entry) => ({ ...entry, content: entry.content + event.text, activeTool: undefined }));
        break;
      case 'model': {
        const { type: _type, ...info } = event;
        answeredByRef.current = info;
        if (mountedRef.current) setAnsweredBy(info);
        updateEntry(id, (entry) => ({ ...entry, model: info }));
        break;
      }
      case 'usage': {
        const { type: _type, ...usage } = event;
        if (mountedRef.current) setContext(contextStatus(usage, answeredByRef.current, sentHistoryRef.current));
        break;
      }
      case 'tool':
        updateEntry(id, (entry) => ({ ...entry, activeTool: event.name }));
        break;
      case 'file': {
        const url = URL.createObjectURL(base64ToBlob(event.data, event.mimeType));
        fileUrlsRef.current.push(url);
        updateEntry(id, (entry) => ({ ...entry, files: [...entry.files, { fileName: event.fileName, mimeType: event.mimeType, url }] }));
        break;
      }
      case 'confirm': {
        const { type: _type, ...request } = event;
        updateEntry(id, (entry) => ({ ...entry, activeTool: undefined, confirmations: [...entry.confirmations, { ...request, status: 'pending' }] }));
        break;
      }
      case 'error':
        updateEntry(id, (entry) => ({ ...entry, error: event.code }));
        break;
      case 'done':
        break;
    }
  }, [updateEntry]);

  /** Streams one request into the assistant entry `id`; resolves true on success. */
  const stream = useCallback(async (id: string, body: Record<string, unknown>): Promise<boolean> => {
    const { api, credentials } = optionsRef.current;
    const fetcher = optionsRef.current.fetch ?? globalThis.fetch;
    const controller = new AbortController();
    abortRef.current = controller;
    busyRef.current = true;
    setBusy(true);
    let ok = false;
    try {
      const extra = typeof optionsRef.current.headers === 'function' ? await optionsRef.current.headers() : optionsRef.current.headers;
      const response = await fetcher(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extra },
        body: JSON.stringify({ ...body, context: optionsRef.current.context }),
        credentials,
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: unknown } | null;
        updateEntry(id, (entry) => ({ ...entry, error: isAssistantErrorCode(payload?.error) ? payload.error : 'SERVER_ERROR' }));
        return false;
      }
      let failed = false;
      for await (const event of readEventStream(response.body)) {
        if (event.type === 'error') failed = true;
        applyEvent(id, event);
      }
      ok = !failed;
    } catch {
      if (controller.signal.aborted) updateEntry(id, (entry) => ({ ...entry, stopped: true }));
      else updateEntry(id, (entry) => ({ ...entry, error: 'NETWORK' }));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
      updateEntry(id, (entry) => ({ ...entry, pending: false, activeTool: undefined }));
      void refreshQuota();
    }
    return ok;
  }, [applyEvent, refreshQuota, updateEntry]);

  const historyOf = useCallback((entries: ChatEntry[]): ChatMessage[] => {
    const maxChars = optionsRef.current.maxMessageChars ?? DEFAULT_LIMITS.maxMessageChars;
    return trimHistory(
      entries
        .filter((entry) => entry.content.trim())
        .map((entry) => ({
          role: entry.role,
          content: entry.content.slice(0, entry.role === 'user' ? maxChars : DEFAULT_LIMITS.maxAssistantChars),
        })),
      optionsRef.current.maxHistoryMessages ?? DEFAULT_LIMITS.maxHistoryMessages,
    );
  }, []);

  const send = useCallback(async (input: string) => {
    const maxChars = optionsRef.current.maxMessageChars ?? DEFAULT_LIMITS.maxMessageChars;
    const text = input.trim().slice(0, maxChars);
    if (!text || busyRef.current) return;
    // A new question supersedes any action still waiting for confirmation.
    update((current) => current.map((entry) => (entry.confirmations.some((item) => item.status === 'pending')
      ? { ...entry, confirmations: entry.confirmations.map((item) => (item.status === 'pending' ? { ...item, status: 'cancelled' } : item)) }
      : entry)));
    const history = historyOf([...messagesRef.current, { id: '', role: 'user', content: text, files: [], pending: false, confirmations: [] }]);
    sentHistoryRef.current = history;
    const assistantId = randomId();
    update((current) => [
      ...current,
      { id: randomId(), role: 'user', content: text, files: [], pending: false, confirmations: [] },
      { id: assistantId, role: 'assistant', content: '', files: [], pending: true, confirmations: [] },
    ]);
    await stream(assistantId, { messages: history });
  }, [historyOf, stream, update]);

  const setConfirmationStatus = useCallback((confirmationId: string, status: ConfirmationStatus) => {
    update((current) => current.map((entry) => (entry.confirmations.some((item) => item.id === confirmationId)
      ? { ...entry, confirmations: entry.confirmations.map((item) => (item.id === confirmationId ? { ...item, status } : item)) }
      : entry)));
  }, [update]);

  const confirm = useCallback(async (confirmationId: string) => {
    if (busyRef.current) return;
    const index = messagesRef.current.findIndex((entry) => entry.confirmations.some((item) => item.id === confirmationId && item.status === 'pending'));
    if (index === -1) return;
    const entry = messagesRef.current[index]!;
    const proposal = entry.confirmations.find((item) => item.id === confirmationId)!;
    setConfirmationStatus(confirmationId, 'running');
    updateEntry(entry.id, (current) => ({ ...current, pending: true, error: undefined, stopped: undefined }));
    sentHistoryRef.current = historyOf(messagesRef.current.slice(0, index + 1));
    const ok = await stream(entry.id, {
      messages: sentHistoryRef.current,
      confirmation: { id: proposal.id, name: proposal.name, input: proposal.input, token: proposal.token },
    });
    setConfirmationStatus(confirmationId, ok ? 'done' : 'failed');
  }, [historyOf, setConfirmationStatus, stream, updateEntry]);

  const cancel = useCallback((confirmationId: string) => {
    const pending = messagesRef.current.some((entry) => entry.confirmations.some((item) => item.id === confirmationId && item.status === 'pending'));
    if (pending) setConfirmationStatus(confirmationId, 'cancelled');
  }, [setConfirmationStatus]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    fileUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    fileUrlsRef.current = [];
    messagesRef.current = [];
    sentHistoryRef.current = [];
    setMessages([]);
    setBusy(false);
    setContext(null);
  }, []);

  const model = answeredBy ?? nextModel;
  return useMemo(
    () => ({ messages, busy, send, stop, newChat, confirm, cancel, quota, refreshQuota, model, context }),
    [messages, busy, send, stop, newChat, confirm, cancel, quota, refreshQuota, model, context],
  );
}

/** Element names used by `AssistantMarkdown`; override to add classes. */
export interface MarkdownComponents {
  heading?: (props: { level: number; children: ReactNode }) => ReactNode;
  paragraph?: (props: { children: ReactNode }) => ReactNode;
  list?: (props: { ordered: boolean; children: ReactNode }) => ReactNode;
  listItem?: (props: { children: ReactNode }) => ReactNode;
  table?: (props: { header: ReactNode[]; rows: ReactNode[][] }) => ReactNode;
  code?: (props: { language?: string; text: string }) => ReactNode;
  bold?: (props: { children: ReactNode }) => ReactNode;
  inlineCode?: (props: { children: ReactNode }) => ReactNode;
}

function inline(text: string, components: MarkdownComponents): ReactNode {
  return parseInline(text).map((segment, index) => {
    if (segment.code) return createElement(Fragment, { key: index }, components.inlineCode?.({ children: segment.text }) ?? createElement('code', null, segment.text));
    if (segment.bold) return createElement(Fragment, { key: index }, components.bold?.({ children: segment.text }) ?? createElement('strong', null, segment.text));
    // Line breaks inside a paragraph stay visible without HTML.
    const lines = segment.text.split('\n');
    return createElement(Fragment, { key: index }, ...lines.flatMap((line, lineIndex) => (lineIndex ? [createElement('br', { key: `br${lineIndex}` }), line] : [line])));
  });
}

function block(item: MarkdownBlock, index: number, components: MarkdownComponents): ReactNode {
  switch (item.type) {
    case 'heading': {
      const children = inline(item.text, components);
      return createElement(Fragment, { key: index }, components.heading?.({ level: item.level, children }) ?? createElement(`h${Math.min(6, item.level + 2)}`, null, children));
    }
    case 'paragraph': {
      const children = inline(item.text, components);
      return createElement(Fragment, { key: index }, components.paragraph?.({ children }) ?? createElement('p', null, children));
    }
    case 'list': {
      const children = item.items.map((text, itemIndex) => createElement(Fragment, { key: itemIndex }, components.listItem?.({ children: inline(text, components) }) ?? createElement('li', null, inline(text, components))));
      return createElement(Fragment, { key: index }, components.list?.({ ordered: item.ordered, children }) ?? createElement(item.ordered ? 'ol' : 'ul', null, children));
    }
    case 'table': {
      const header = item.header.map((cell) => inline(cell, components));
      const rows = item.rows.map((row) => row.map((cell) => inline(cell, components)));
      if (components.table) return createElement(Fragment, { key: index }, components.table({ header, rows }));
      return createElement('table', { key: index },
        createElement('thead', null, createElement('tr', null, header.map((cell, cellIndex) => createElement('th', { key: cellIndex }, cell)))),
        createElement('tbody', null, rows.map((row, rowIndex) => createElement('tr', { key: rowIndex }, row.map((cell, cellIndex) => createElement('td', { key: cellIndex }, cell))))));
    }
    case 'code':
      return createElement(Fragment, { key: index }, components.code?.({ language: item.language, text: item.text }) ?? createElement('pre', null, createElement('code', null, item.text)));
  }
}

/**
 * Renders the safe Markdown subset as plain React elements (no
 * dangerouslySetInnerHTML). Unstyled; headings render one level down
 * (`#` → h3) so answers sit under the page's own headings.
 */
export function AssistantMarkdown({ text, components = {} }: { text: string; components?: MarkdownComponents }): ReactNode {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return createElement(Fragment, null, blocks.map((item, index) => block(item, index, components)));
}

export type { AssistantErrorCode, AssistantEvent, ConfirmationRequest, ModelInfo, QuotaSummary, UsageInfo };
