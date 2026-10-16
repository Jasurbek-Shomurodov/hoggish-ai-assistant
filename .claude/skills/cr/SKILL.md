---
name: cr
description: Code review for hoggish-assistant. Use when asked to review a diff, branch, PR or file in this repo (/cr, "review this", "code review"). Reports correctness, privacy and API-contract problems ranked S0/S1/S2 in the review-core format; edits only with "fix".
argument-hint: "[empty = full | diff | PR number | branch | A..B | path] [fix]"
---

# Code review (cr)

> **Shared contract.** Load the `review-core` skill first (`~/.claude/skills/review-core/SKILL.md`). Its ground rules, argument
> grammar, S0/S1/S2 severity scale, report skeleton, fix mode and fan-out
> apply here. This file adds only what is specific to the hoggish-assistant library.

Review the target for bugs, not style. Target: `$ARGUMENTS` (grammar in `review-core`
section 1). Empty or `full` means every file under `src/` and `test/`, checked against the whole
checklist below; `diff` means the current branch against `main` (`git diff main...HEAD`) plus
uncommitted changes; a PR number, branch, commit range or path as in `review-core`. With `fix`,
apply the confirmed fixes afterwards (`review-core` section 4) and finish with `npm run check`.

## Steps

1. Read the full diff. For each changed function, also read its callers and the tests that cover
   it (`test/*.test.ts`, helpers in `test/helpers.ts`).
2. Check every item in the checklist below against the diff.
3. Run `npm run typecheck` and `npm test`. Report failures verbatim.
4. Report in the `review-core` section 3 skeleton (`CR: <target>`, commit, checks, findings as
   `[S0|S1|S2]` with Scenario, Fix and Verified, then Suggestions, Checked not a finding, Not
   run). Skip anything you cannot tie to a scenario. Say plainly when nothing is wrong.

   Severity here: **S0** = prompt, message or tool text reaching logs or error payloads, a tool
   running without a verified confirmation, a `node:` or `Buffer` dependency reachable from the
   core or server entry, a breaking public API or NDJSON change without a major bump, or `dist/`
   out of date with `src/`. **S1** = a fallback, quota or request-limit rule from the checklist
   broken, or a public change missing from `CHANGELOG.md` and `README.md`. **S2** = everything
   else that costs maintenance.

## Checklist (specific to this library)

**Runtime portability.** `src/index.ts`, `src/server.ts` and everything they import must use only
Web APIs (`fetch`, Web Crypto, `TextEncoder`, `btoa`). No `Buffer`, `process`, `node:` imports or
Node globals there. Node-only code belongs in `src/excel.ts`. React code stays in `src/react.tsx`.

**Privacy.** Prompts, messages, tool inputs and tool results must never reach `console`,
`process.emitWarning`, error messages or the handler's `onError` payload (only stage, provider,
tool, status and error name are allowed). The AI SDK's `APICallError.requestBodyValues` holds the
whole prompt, so any new `streamText`/`generateText` call needs its own `onError`. See
`test/logging.test.ts`.

**Fallback chain (`src/fallback.ts`, `src/loop.ts`).** A per-day 429 marks the model used up in
the quota store; per-minute 429, 404 and 5xx only cool the model down (60 s, 1 h for 404). Once
text has streamed, errors must not retry on another model. On a model switch, the previous model's
reasoning parts are dropped and Gemini thought signatures are replaced.

**Quota (`src/quota.ts`, `src/supabase.ts`).** Quota days reset at midnight Pacific. Models without
`dailyLimit` are untracked. If every model is used up the chain is still tried.

**Tools and confirmation (`src/tools.ts`, `src/confirm.ts`, `src/handler.ts`).** A tool with
`needsConfirmation` must never execute without a verified confirmation; HMAC signatures must be
checked before the call runs. Input is validated with `validateToolInput` before `execute`. The
tool loop is bounded by `MAX_ROUNDS`. `ToolError` messages are shown to the model; other errors are
replaced by a generic message.

**Events and streaming (`src/events.ts`, `src/request.ts`).** NDJSON event shapes are a public
contract: a new field is fine, a renamed or removed one is a breaking change. Request limits in
`DEFAULT_LIMITS` must still be enforced.

**Public API.** Anything exported from `src/index.ts`, `src/server.ts`, `src/react.tsx`,
`src/markdown.ts`, `src/excel.ts` or `src/supabase.ts` is public. Flag breaking changes and check
that `CHANGELOG.md` and `README.md` describe them.

**Markdown (`src/markdown.ts`).** The parser must never emit raw HTML, whatever the input.

**React (`src/react.tsx`).** Must keep working on React 18 and 19; no new peer dependencies.

**Build.** `dist/` is committed and installed from Git tags. If `src/` changed, `dist/` must be
rebuilt in the same change (`npm run build`), and `package.json` `exports` must list any new entry.
