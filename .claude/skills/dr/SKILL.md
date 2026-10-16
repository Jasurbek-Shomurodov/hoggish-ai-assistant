---
name: dr
description: Design review for hoggish-assistant. Use before implementing a new feature, public API, provider, store or event type in this repo (/dr, "design review", "how should we add X", "review this plan"). Produces a written assessment of the proposed design with risks and a recommendation; does not write code. Arguments: proposal text, "diff", the current plan, or an area code (FIT, ENTRY, API, STREAM, FB, CONF, PRIV, PLUG, TEST, DOCS).
argument-hint: "[proposal text | diff | current plan | area code (FIT, ENTRY, API, STREAM, FB, CONF, PRIV, PLUG, TEST, DOCS)]"
---

# Design review (dr)

> **Shared contract.** Load the `review-core` skill first (`~/.claude/skills/review-core/SKILL.md`). Its ground rules, argument
> grammar, S0/S1/S2 severity scale, report skeleton, fix mode and fan-out
> apply here. This file adds only what is specific to the hoggish-assistant library (an API design review, not a visual one).

Assess a proposed change before it is built. The proposal is `$ARGUMENTS`, the current plan, or
the user's description; `diff` (from the `review-core` grammar) means the API changes on the
current branch against `main`, reviewed as if they were the proposal. Output is a short written
review, not code. `review-core` section 0 applies (read-only, no secrets, no network).

Sources of truth: `CLAUDE.md` (the rules), `README.md` (the public contract) and
`references/cases.md`, the design regression catalog, where each design question below is a
check with an expected answer. An area code as the target answers that area's cases only. Keep
the catalog alive per `review-core` section 6.

## Steps

1. Restate the proposal in two or three sentences so the user can correct a misreading.
2. Read the parts of the codebase the change touches. Start from `README.md` (the public contract),
   then the relevant `src/` files and their tests.
3. **Consumer impact.** For every export the proposal adds, changes, renames or removes (and every
   NDJSON event type or error code it touches), grep the two consumer apps read-only for call
   sites and list them in the review under a "Consumer call sites" heading (file:line per hit, or
   "none"). A proposal that breaks a listed call site without a major bump is S0.

   ```bash
   grep -rnwE --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.cjs' --exclude-dir={node_modules,dist,.next,output,tmp} "<export1>|<export2>" ~/Desktop/game-club-finance ~/Desktop/zar-kebab-pos
   ```

4. Answer each question under "Design questions". Where the proposal is silent, state the default
   you would choose.
5. Finish in the `review-core` section 3 shape: `DR: <proposal>`, a one-line verdict, risks as
   `[S0|S1|S2]` findings with Scenario, Fix and Verified, then the recommended approach, what
   tests and docs the change needs, "Checked, not a finding" and "Not run". Keep it under about
   400 words unless the user asks for more.

   Severity here: **S0** = a privacy leak path, a side effect that can bypass confirmation, a
   breaking change for the two consumer apps (game-club-finance and zar-kebab-pos pull this
   library through `scripts/update-hoggish-assistant.cjs`) without a major bump, or a runtime
   promise broken. **S1** = an inconsistent or non-minimal public surface, a new event older
   clients cannot ignore, storage or a provider without an interface. **S2** = naming and docs.

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
Does `dist/` need a rebuild and a new Git tag? Which guards will the change trip, and is that
intended: `test/apiSnapshot.test.ts` (snapshot update, major bump if a name goes away),
`test/portability.test.ts` (no Node APIs from the portable entries), `scripts/release-check.mjs`
(version, changelog, README tag, exports)?
