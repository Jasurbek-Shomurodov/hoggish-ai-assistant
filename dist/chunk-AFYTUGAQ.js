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
var ERROR_STATUS = {
  UNAUTHORIZED: 401,
  INVALID_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_CONFIGURED: 503,
  BUSY: 429,
  REFUSED: 422,
  TOO_LONG: 422,
  SERVER_ERROR: 500
};
function isAssistantErrorCode(value) {
  return typeof value === "string" && ASSISTANT_ERROR_CODES.includes(value);
}
var EVENT_TYPES = /* @__PURE__ */ new Set(["text", "tool", "file", "confirm", "error", "done"]);
function isEvent(value) {
  return typeof value === "object" && value !== null && EVENT_TYPES.has(value.type);
}
function encodeEvent(event) {
  return `${JSON.stringify(event)}
`;
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

// src/quota.ts
var PACIFIC_TIME_ZONE = "America/Los_Angeles";
var REQUESTS_PER_QUESTION = 3;
var formatters = /* @__PURE__ */ new Map();
function zonedParts(date, timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const part = (type) => Number(parts.find((item) => item.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}
function quotaDate(now = /* @__PURE__ */ new Date(), timeZone = PACIFIC_TIME_ZONE) {
  const { year, month, day } = zonedParts(now, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function nextQuotaReset(now = /* @__PURE__ */ new Date(), timeZone = PACIFIC_TIME_ZONE) {
  const today = quotaDate(now, timeZone);
  const { hour, minute, second } = zonedParts(now, timeZone);
  const elapsed = ((hour * 60 + minute) * 60 + second) * 1e3 + now.getMilliseconds();
  const estimate = now.getTime() - elapsed + DAY_MS;
  let low = Math.max(now.getTime(), estimate - 3 * HOUR_MS);
  let high = estimate + 3 * HOUR_MS;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (quotaDate(new Date(middle), timeZone) === today) low = middle;
    else high = middle;
  }
  return new Date(high);
}
var HOUR_MS = 60 * 60 * 1e3;
var DAY_MS = 24 * HOUR_MS;
function trackedModels(models) {
  return models.filter((entry) => typeof entry.dailyLimit === "number" && entry.dailyLimit > 0);
}
function summarizeQuota(chain, rows, now = /* @__PURE__ */ new Date(), options = {}) {
  const byModel = new Map(rows.map((row) => [row.model, row]));
  const models = trackedModels(chain).map(({ model, dailyLimit }) => {
    const row = byModel.get(model);
    const used = row?.exhausted ? dailyLimit : Math.min(dailyLimit, Math.max(0, Number(row?.requests ?? 0) || 0));
    return { model, limit: dailyLimit, used, remaining: dailyLimit - used };
  });
  const requestsLeft = models.reduce((total, model) => total + model.remaining, 0);
  const currentIndex = models.findIndex((model) => model.remaining > 0);
  const perQuestion = Math.max(1, options.requestsPerQuestion ?? REQUESTS_PER_QUESTION);
  return {
    requestsLeft,
    requestsLimit: models.reduce((total, model) => total + model.limit, 0),
    questionsLeft: Math.floor(requestsLeft / perQuestion),
    currentModel: currentIndex === -1 ? null : models[currentIndex],
    usingFallback: currentIndex !== 0,
    resetsAt: nextQuotaReset(now, options.timeZone ?? PACIFIC_TIME_ZONE).toISOString(),
    models
  };
}
function exhaustedModels(chain, rows) {
  return summarizeQuota(chain, rows).models.filter((model) => model.remaining <= 0).map((model) => model.model);
}
function createMemoryQuotaStore() {
  const rows = /* @__PURE__ */ new Map();
  return {
    rows,
    async load(day) {
      return (rows.get(day) ?? []).map((row) => ({ ...row }));
    },
    async record(day, model, result) {
      const dayRows = rows.get(day) ?? [];
      let row = dayRows.find((entry) => entry.model === model);
      if (!row) {
        row = { model, requests: 0, exhausted: false };
        dayRows.push(row);
      }
      if (result === "daily_limit") row.exhausted = true;
      else row.requests += 1;
      rows.set(day, dayRows);
    }
  };
}

// src/request.ts
var DEFAULT_LIMITS = {
  maxMessageChars: 4e3,
  maxAssistantChars: 8e3,
  maxHistoryMessages: 30
};
var HARD_MESSAGE_CAP = 500;
var TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
function trimHistory(messages, limit = DEFAULT_LIMITS.maxHistoryMessages) {
  const recent = messages.slice(-Math.max(1, limit));
  const firstUser = recent.findIndex((message) => message.role === "user");
  return firstUser <= 0 ? recent : recent.slice(firstUser);
}
function parseConfirmation(value) {
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "object") return null;
  const { id, name, input, token } = value;
  if (typeof id !== "string" || !id || id.length > 200) return null;
  if (typeof name !== "string" || !TOOL_NAME.test(name)) return null;
  if (token !== void 0 && typeof token !== "string") return null;
  return { id, name, input, ...token !== void 0 ? { token } : {} };
}
function parseChatRequest(body, limits = DEFAULT_LIMITS) {
  if (!body || typeof body !== "object") return null;
  const raw = body;
  if (!Array.isArray(raw.messages) || raw.messages.length === 0 || raw.messages.length > HARD_MESSAGE_CAP) return null;
  const messages = [];
  for (const item of raw.messages) {
    if (!item || typeof item !== "object") return null;
    const { role, content } = item;
    if (role !== "user" && role !== "assistant" || typeof content !== "string") return null;
    const text = content.trim();
    if (role === "user") {
      if (!text || text.length > limits.maxMessageChars) return null;
      messages.push({ role, content: text });
    } else if (text) {
      messages.push({ role, content: text.slice(0, limits.maxAssistantChars) });
    }
  }
  const confirmation = parseConfirmation(raw.confirmation);
  if (confirmation === null) return null;
  const history = trimHistory(messages, limits.maxHistoryMessages);
  if (history[0]?.role !== "user") return null;
  if (!confirmation && history[history.length - 1]?.role !== "user") return null;
  return { messages: history, context: raw.context, ...confirmation ? { confirmation } : {} };
}

export { ASSISTANT_ERROR_CODES, DEFAULT_LIMITS, ERROR_STATUS, PACIFIC_TIME_ZONE, REQUESTS_PER_QUESTION, createMemoryQuotaStore, encodeEvent, exhaustedModels, isAssistantErrorCode, nextQuotaReset, parseChatRequest, parseEventChunk, quotaDate, readEventStream, summarizeQuota, trackedModels, trimHistory };
//# sourceMappingURL=chunk-AFYTUGAQ.js.map
//# sourceMappingURL=chunk-AFYTUGAQ.js.map