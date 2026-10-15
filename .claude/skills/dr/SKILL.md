---
name: dr
description: Design review for hoggish-assistant. Use before implementing a new feature, public API, provider, store or event type in this repo (/dr, "design review", "how should we add X", "review this plan"). Produces a written assessment of the proposed design with risks and a recommendation; does not write code.
---

# Design review (dr)

Assess a proposed change before it is built. The proposal is `$ARGUMENTS`, the current plan, or
the user's description. Output is a short written review, not code.

## Steps

1. Restate the proposal in two or three sentences so the user can correct a misreading.
2. Read the parts of the codebase the change touches. Start from `README.md` (the public contract),
   then the relevant `src/` files and their tests.
3. Answer each question under "Design questions". Where the proposal is silent, state the default
   you would choose.
4. Finish with: risks ranked by impact, the recommended approach, and what tests and docs the
   change needs. Keep it under about 400 words unless the user asks for more.

## Design questions

**Fit.** Does this belong in the library, or in the app that uses it? The library never touches
the app's database and never owns auth, prompts or API keys; each app supplies `authorize`, tools,
prompt and key. Anything tenant-specific belongs in the app.

**Entry point and runtime.** Which entry gets it: `hoggish-assistant` (any runtime),
`/server` (Node, Deno, edge), `/react` (browser), `/markdown`, `/excel` (Node only), `/supabase`?
Does it keep that entry's runtime promise? Core and server code use only Web APIs. A new entry
needs `package.json` `exports`, `tsup.config.ts` and a README row.

**Public API shape.** Is the new surface minimal and consistent with `createAssistantHandler`,
`defineTool`, `geminiProvider` / `anthropicProvider` / `customProvider` / `providerFromEnv` and
`useAssistantChat`? Prefer options on existing functions over new functions. Is it a breaking
change? If so, is it worth a major bump?

**Streaming contract.** Does it add or change NDJSON events in `src/events.ts`? New event types
must be ignorable by older clients. The React hook and `readEventStream` must handle them.

**Fallback and quota.** How does it behave when a model fails mid-turn, when the chain is
exhausted, and when the quota store is unavailable? Does it preserve "once text has streamed, no
retry on another model"?

**Confirmation and safety.** If it adds a way for the model to cause side effects, does it go
through `needsConfirmation` and HMAC-signed proposals? Could it let a tool run unconfirmed?

**Privacy.** Could prompt, message or tool-result text reach logs, errors, `onError`, or a third
party? Does it send data anywhere new?

**Pluggability.** If it adds storage or a provider, is it behind an interface like `QuotaStore`
or `AssistantProvider` with an in-memory implementation for tests?

**Testing.** Can it be tested with `MockLanguageModelV4` and the helpers in `test/helpers.ts`
without network access? What new test file or cases are needed?

**Docs and release.** Which README sections and which `CHANGELOG.md` entry does it need?
Does `dist/` need a rebuild and a new Git tag?
