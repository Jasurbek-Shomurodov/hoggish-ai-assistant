# Changelog

## 0.4.0

Latency fixes for the free Gemini chain.

- Gemini models default to `thinking: 'low'` (`geminiProvider` option; `'minimal' | 'low' |
  'medium' | 'high' | false`). Thinking was on in full for every call, including the rounds that
  only pick a tool, which cost seconds of silence per round. Gemini 3 models get a `thinkingLevel`,
  Gemini 2.5 models the matching `thinkingBudget`; a `thinkingConfig` in `providerOptions.google`
  still wins. `geminiThinkingOptions` and `DEFAULT_GEMINI_THINKING` are exported.
- A model rejected for its daily quota now stays skipped on this server instance until the quota
  day resets (it was retried after 60 seconds, so every request on a warm instance paid for a
  failing call to each used-up model, and every request without a quota store did too).
  `Cooldowns.set` takes an optional end time and never shortens an existing cooldown.
- New `firstTokenTimeoutMs` handler option (default 30 000; 0 disables): a model call that
  produces nothing in that time is abandoned with a `ModelTimeoutError`, the model gets a
  60-second cooldown and the next model is tried. Once a model has started responding there is
  no limit. Previously a hung connection waited until the platform killed the request.
- The chat handler reads the quota store in parallel with the app's `system`, `context` and
  `tools` callbacks instead of after them, and the usage endpoint reads it once instead of twice.

## 0.3.1

- `useAssistantChat` keeps the previous `quota` and `model` while the usage endpoint reloads for a
  new `context` (for example a language switch), so a badge built from them no longer disappears
  and reappears. Only the newest usage request updates state; a failed request still clears them.

## 0.3.0

- Show which model is answering: the stream sends a `model` event when a model accepts a call
  (`{ model, provider?, contextWindow? }`) and a `usage` event with the provider's token counts
  when the call finishes. The usage endpoint now answers `{ provider, model, quota }`, where
  `model` is the model the next question would go to.
- Context-window status in the browser: `useAssistantChat` returns `model` (the model in use) and
  `context` (`contextWindow`, `usedTokens`, `tokensLeft`, `usedShare`, `messagesLeft`); each
  assistant message carries the `model` that produced it. `contextStatus` and `estimateTokens` are
  exported for custom clients.
- Models carry a `contextWindow`, defaulted from `contextWindowFor(modelId)` (Gemini 1 048 576;
  Claude 4.6+ and Claude 5 families 1 000 000; earlier Claude 200 000) and overridable per model.

## 0.2.0

- Add `providerChain`: join several providers, each with its own API key, into one fallback chain
  ranked by `priority`. When a model's daily quota is used up, or it is rate limited or down, the
  next model answers inline, even across providers. Unconfigured links are skipped; duplicate
  model ids are prefixed with the link name.
- `ASSISTANT_PROVIDER` accepts a comma-separated priority list (`gemini,anthropic`), which makes
  `providerFromEnv` build such a chain.
- A `ChainModel` can carry its own `maxOutputTokens`, `providerOptions` and `cacheSystemPrompt`;
  `modelSettings` resolves them with the provider's values as defaults.

## 0.1.1

- Fix a privacy leak: when a model call failed (for example a 503 that moved the turn to the next
  model in the chain), the AI SDK's default `streamText` error logger printed the whole
  `APICallError`, whose `requestBodyValues` contain the system prompt, user messages and tool
  results. The library now passes its own `onError`. Errors are still handled and reported through
  the handler's `onError`, which logs only stage, provider, tool, status and error name.
- Add a test that fails if prompt or tool-result text reaches `console` or `process.emitWarning`.

## 0.1.0

- First release: fallback chain, quota tracking, Web Request/Response handler with tool loop and
  NDJSON events, confirm-before-action tools, `useAssistantChat`, Markdown and Excel helpers.
