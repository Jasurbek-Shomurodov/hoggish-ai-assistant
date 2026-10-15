# Changelog

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
