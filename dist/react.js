'use client';

// src/react.tsx
import { Fragment, createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";

// src/events.ts
var ASSISTANT_ERROR_CODES = [
  "UNAUTHORIZED",
  "INVALID_REQUEST",
  "FORBIDDEN",
  "NOT_CONFIGURED",
  "BUSY",
  "REFUSED",
  "TOO_LONG",
  "SERVER_ERROR"
];
function isAssistantErrorCode(value) {
  return typeof value === "string" && ASSISTANT_ERROR_CODES.includes(value);
}
var EVENT_TYPES = /* @__PURE__ */ new Set(["text", "model", "usage", "tool", "file", "confirm", "error", "done"]);
function isEvent(value) {
  return typeof value === "object" && value !== null && EVENT_TYPES.has(value.type);
}
function parseEventChunk(buffer) {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (isEvent(parsed)) events.push(parsed);
    } catch {
    }
  }
  return { events, rest };
}
async function* readEventStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (; ; ) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const { events, rest } = parseEventChunk(done ? `${buffer}
` : buffer);
      buffer = rest;
      yield* events;
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

// src/markdown.ts
var TABLE_DIVIDER = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;
var BULLET = /^\s*[-*•]\s+(.*)$/;
var NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
var HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
var FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
function parseMarkdown(source) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const code = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", text: code.join("\n"), ...fence[2] ? { language: fence[2] } : {} });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    if (line.includes("|") && TABLE_DIVIDER.test(lines[index + 1]?.trim() ?? "")) {
      flushParagraph();
      const header = tableCells(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const cells = tableCells(lines[index]);
        rows.push(header.map((_, column) => cells[column] ?? ""));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const items = [(bullet ?? numbered)[1]];
      while (index + 1 < lines.length) {
        const next = (ordered ? NUMBERED : BULLET).exec(lines[index + 1]);
        if (!next) break;
        items.push(next[1]);
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}
function parseInline(text) {
  const segments = [];
  const pattern = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    if (match[3] !== void 0) segments.push({ text: match[3], code: true });
    else segments.push({ text: match[1] ?? match[2], bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

// src/request.ts
var DEFAULT_LIMITS = {
  maxMessageChars: 4e3,
  maxAssistantChars: 8e3,
  maxHistoryMessages: 30
};
function estimateTokens(text) {
  let latin = 0;
  for (const char of text) {
    if (char.charCodeAt(0) < 128) latin += 1;
  }
  const other = text.length - latin;
  return Math.ceil(latin / 4 + other / 2.5);
}
function trimHistory(messages, limit = DEFAULT_LIMITS.maxHistoryMessages) {
  const recent = messages.slice(-Math.max(1, limit));
  const firstUser = recent.findIndex((message) => message.role === "user");
  return firstUser <= 0 ? recent : recent.slice(firstUser);
}

// src/react.tsx
function contextStatus(usage, model, history) {
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
    messagesLeft: Math.floor(tokensLeft / perMessage)
  };
}
function base64ToBlob(data, mimeType) {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}
function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function useAssistantChat(options) {
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState(null);
  const [answeredBy, setAnsweredBy] = useState(null);
  const [nextModel, setNextModel] = useState(null);
  const [context, setContext] = useState(null);
  const answeredByRef = useRef(null);
  const sentHistoryRef = useRef([]);
  const messagesRef = useRef([]);
  const optionsRef = useRef(options);
  const abortRef = useRef(null);
  const busyRef = useRef(false);
  const fileUrlsRef = useRef([]);
  const mountedRef = useRef(true);
  const quotaRequestRef = useRef(0);
  optionsRef.current = options;
  const contextKey = JSON.stringify(options.context ?? null);
  const update = useCallback((updater) => {
    messagesRef.current = updater(messagesRef.current);
    if (mountedRef.current) setMessages(messagesRef.current);
  }, []);
  const updateEntry = useCallback((id, change) => {
    update((current) => current.map((entry) => entry.id === id ? change(entry) : entry));
  }, [update]);
  const refreshQuota = useCallback(async () => {
    const { usageApi, context: context2, credentials } = optionsRef.current;
    if (!usageApi) return;
    const request = ++quotaRequestRef.current;
    const current = () => mountedRef.current && request === quotaRequestRef.current;
    const fetcher = optionsRef.current.fetch ?? globalThis.fetch;
    try {
      const url = new URL(usageApi, globalThis.location?.href ?? "http://localhost");
      if (context2 !== void 0) url.searchParams.set("context", JSON.stringify(context2));
      const headers = typeof optionsRef.current.headers === "function" ? await optionsRef.current.headers() : optionsRef.current.headers;
      const response = await fetcher(url.toString(), { cache: "no-store", credentials, headers });
      const payload = response.ok ? await response.json() : null;
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
  const applyEvent = useCallback((id, event) => {
    optionsRef.current.onEvent?.(event, id);
    switch (event.type) {
      case "text":
        updateEntry(id, (entry) => ({ ...entry, content: entry.content + event.text, activeTool: void 0 }));
        break;
      case "model": {
        const { type: _type, ...info } = event;
        answeredByRef.current = info;
        if (mountedRef.current) setAnsweredBy(info);
        updateEntry(id, (entry) => ({ ...entry, model: info }));
        break;
      }
      case "usage": {
        const { type: _type, ...usage } = event;
        if (mountedRef.current) setContext(contextStatus(usage, answeredByRef.current, sentHistoryRef.current));
        break;
      }
      case "tool":
        updateEntry(id, (entry) => ({ ...entry, activeTool: event.name }));
        break;
      case "file": {
        const url = URL.createObjectURL(base64ToBlob(event.data, event.mimeType));
        fileUrlsRef.current.push(url);
        updateEntry(id, (entry) => ({ ...entry, files: [...entry.files, { fileName: event.fileName, mimeType: event.mimeType, url }] }));
        break;
      }
      case "confirm": {
        const { type: _type, ...request } = event;
        updateEntry(id, (entry) => ({ ...entry, activeTool: void 0, confirmations: [...entry.confirmations, { ...request, status: "pending" }] }));
        break;
      }
      case "error":
        updateEntry(id, (entry) => ({ ...entry, error: event.code }));
        break;
      case "done":
        break;
    }
  }, [updateEntry]);
  const stream = useCallback(async (id, body) => {
    const { api, credentials } = optionsRef.current;
    const fetcher = optionsRef.current.fetch ?? globalThis.fetch;
    const controller = new AbortController();
    abortRef.current = controller;
    busyRef.current = true;
    setBusy(true);
    let ok = false;
    try {
      const extra = typeof optionsRef.current.headers === "function" ? await optionsRef.current.headers() : optionsRef.current.headers;
      const response = await fetcher(api, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extra },
        body: JSON.stringify({ ...body, context: optionsRef.current.context }),
        credentials,
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        updateEntry(id, (entry) => ({ ...entry, error: isAssistantErrorCode(payload?.error) ? payload.error : "SERVER_ERROR" }));
        return false;
      }
      let failed = false;
      for await (const event of readEventStream(response.body)) {
        if (event.type === "error") failed = true;
        applyEvent(id, event);
      }
      ok = !failed;
    } catch {
      if (controller.signal.aborted) updateEntry(id, (entry) => ({ ...entry, stopped: true }));
      else updateEntry(id, (entry) => ({ ...entry, error: "NETWORK" }));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
      updateEntry(id, (entry) => ({ ...entry, pending: false, activeTool: void 0 }));
      void refreshQuota();
    }
    return ok;
  }, [applyEvent, refreshQuota, updateEntry]);
  const historyOf = useCallback((entries) => {
    const maxChars = optionsRef.current.maxMessageChars ?? DEFAULT_LIMITS.maxMessageChars;
    return trimHistory(
      entries.filter((entry) => entry.content.trim()).map((entry) => ({
        role: entry.role,
        content: entry.content.slice(0, entry.role === "user" ? maxChars : DEFAULT_LIMITS.maxAssistantChars)
      })),
      optionsRef.current.maxHistoryMessages ?? DEFAULT_LIMITS.maxHistoryMessages
    );
  }, []);
  const send = useCallback(async (input) => {
    const maxChars = optionsRef.current.maxMessageChars ?? DEFAULT_LIMITS.maxMessageChars;
    const text = input.trim().slice(0, maxChars);
    if (!text || busyRef.current) return;
    update((current) => current.map((entry) => entry.confirmations.some((item) => item.status === "pending") ? { ...entry, confirmations: entry.confirmations.map((item) => item.status === "pending" ? { ...item, status: "cancelled" } : item) } : entry));
    const history = historyOf([...messagesRef.current, { id: "", role: "user", content: text, files: [], pending: false, confirmations: [] }]);
    sentHistoryRef.current = history;
    const assistantId = randomId();
    update((current) => [
      ...current,
      { id: randomId(), role: "user", content: text, files: [], pending: false, confirmations: [] },
      { id: assistantId, role: "assistant", content: "", files: [], pending: true, confirmations: [] }
    ]);
    await stream(assistantId, { messages: history });
  }, [historyOf, stream, update]);
  const setConfirmationStatus = useCallback((confirmationId, status) => {
    update((current) => current.map((entry) => entry.confirmations.some((item) => item.id === confirmationId) ? { ...entry, confirmations: entry.confirmations.map((item) => item.id === confirmationId ? { ...item, status } : item) } : entry));
  }, [update]);
  const confirm = useCallback(async (confirmationId) => {
    if (busyRef.current) return;
    const index = messagesRef.current.findIndex((entry2) => entry2.confirmations.some((item) => item.id === confirmationId && item.status === "pending"));
    if (index === -1) return;
    const entry = messagesRef.current[index];
    const proposal = entry.confirmations.find((item) => item.id === confirmationId);
    setConfirmationStatus(confirmationId, "running");
    updateEntry(entry.id, (current) => ({ ...current, pending: true, error: void 0, stopped: void 0 }));
    sentHistoryRef.current = historyOf(messagesRef.current.slice(0, index + 1));
    const ok = await stream(entry.id, {
      messages: sentHistoryRef.current,
      confirmation: { id: proposal.id, name: proposal.name, input: proposal.input, token: proposal.token }
    });
    setConfirmationStatus(confirmationId, ok ? "done" : "failed");
  }, [historyOf, setConfirmationStatus, stream, updateEntry]);
  const cancel = useCallback((confirmationId) => {
    const pending = messagesRef.current.some((entry) => entry.confirmations.some((item) => item.id === confirmationId && item.status === "pending"));
    if (pending) setConfirmationStatus(confirmationId, "cancelled");
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
    [messages, busy, send, stop, newChat, confirm, cancel, quota, refreshQuota, model, context]
  );
}
function inline(text, components) {
  return parseInline(text).map((segment, index) => {
    if (segment.code) return createElement(Fragment, { key: index }, components.inlineCode?.({ children: segment.text }) ?? createElement("code", null, segment.text));
    if (segment.bold) return createElement(Fragment, { key: index }, components.bold?.({ children: segment.text }) ?? createElement("strong", null, segment.text));
    const lines = segment.text.split("\n");
    return createElement(Fragment, { key: index }, ...lines.flatMap((line, lineIndex) => lineIndex ? [createElement("br", { key: `br${lineIndex}` }), line] : [line]));
  });
}
function block(item, index, components) {
  switch (item.type) {
    case "heading": {
      const children = inline(item.text, components);
      return createElement(Fragment, { key: index }, components.heading?.({ level: item.level, children }) ?? createElement(`h${Math.min(6, item.level + 2)}`, null, children));
    }
    case "paragraph": {
      const children = inline(item.text, components);
      return createElement(Fragment, { key: index }, components.paragraph?.({ children }) ?? createElement("p", null, children));
    }
    case "list": {
      const children = item.items.map((text, itemIndex) => createElement(Fragment, { key: itemIndex }, components.listItem?.({ children: inline(text, components) }) ?? createElement("li", null, inline(text, components))));
      return createElement(Fragment, { key: index }, components.list?.({ ordered: item.ordered, children }) ?? createElement(item.ordered ? "ol" : "ul", null, children));
    }
    case "table": {
      const header = item.header.map((cell) => inline(cell, components));
      const rows = item.rows.map((row) => row.map((cell) => inline(cell, components)));
      if (components.table) return createElement(Fragment, { key: index }, components.table({ header, rows }));
      return createElement(
        "table",
        { key: index },
        createElement("thead", null, createElement("tr", null, header.map((cell, cellIndex) => createElement("th", { key: cellIndex }, cell)))),
        createElement("tbody", null, rows.map((row, rowIndex) => createElement("tr", { key: rowIndex }, row.map((cell, cellIndex) => createElement("td", { key: cellIndex }, cell)))))
      );
    }
    case "code":
      return createElement(Fragment, { key: index }, components.code?.({ language: item.language, text: item.text }) ?? createElement("pre", null, createElement("code", null, item.text)));
  }
}
function AssistantMarkdown({ text, components = {} }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return createElement(Fragment, null, blocks.map((item, index) => block(item, index, components)));
}
export {
  AssistantMarkdown,
  contextStatus,
  useAssistantChat
};
//# sourceMappingURL=react.js.map