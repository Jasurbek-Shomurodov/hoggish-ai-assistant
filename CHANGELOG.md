# Changelog

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
