import { Fragment, createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isAssistantErrorCode, readEventStream, type AssistantErrorCode, type AssistantEvent, type ConfirmationRequest } from './events';
import { parseInline, parseMarkdown, type MarkdownBlock } from './markdown';
import type { QuotaSummary } from './quota';
import { DEFAULT_LIMITS, trimHistory, type ChatMessage } from './request';

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
  const messagesRef = useRef<ChatEntry[]>([]);
  const optionsRef = useRef(options);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const fileUrlsRef = useRef<string[]>([]);
  const mountedRef = useRef(true);
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
    const fetcher = optionsRef.current.fetch ?? globalThis.fetch;
    try {
      const url = new URL(usageApi, globalThis.location?.href ?? 'http://localhost');
      if (context !== undefined) url.searchParams.set('context', JSON.stringify(context));
      const headers = typeof optionsRef.current.headers === 'function' ? await optionsRef.current.headers() : optionsRef.current.headers;
      const response = await fetcher(url.toString(), { cache: 'no-store', credentials, headers });
      const payload = response.ok ? await response.json() as { quota?: QuotaSummary | null } : null;
      if (mountedRef.current) setQuota(payload?.quota ?? null);
    } catch {
      if (mountedRef.current) setQuota(null);
    }
  }, []);

  useEffect(() => {
    setQuota(null);
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
    const ok = await stream(entry.id, {
      messages: historyOf(messagesRef.current.slice(0, index + 1)),
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
    setMessages([]);
    setBusy(false);
  }, []);

  return useMemo(
    () => ({ messages, busy, send, stop, newChat, confirm, cancel, quota, refreshQuota }),
    [messages, busy, send, stop, newChat, confirm, cancel, quota, refreshQuota],
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

export type { AssistantErrorCode, AssistantEvent, ConfirmationRequest, QuotaSummary };
