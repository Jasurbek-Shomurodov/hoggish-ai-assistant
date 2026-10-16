---
name: qa
description: QA pass for hoggish-assistant. Use before committing, tagging a release, or when asked to test or verify a change (/qa, "run the checks", "is this ready to ship", "add tests for"). Runs typecheck, tests and build, checks test coverage of the change and the release checklist, and reports what passed and what did not. Arguments: empty or "full", "diff", a path, a PR number, "A..B", or an area code (CHK, COV, REL, FB, QUOTA, HND, CONF, REQ, MD, XL, REACT).
argument-hint: "[empty = full | diff | path | PR number | A..B | area code (CHK, COV, REL, FB, QUOTA, HND, CONF, REQ, MD, XL, REACT)]"
---

# QA (qa)

> **Shared contract.** Load the `review-core` skill first (`~/.claude/skills/review-core/SKILL.md`). Its ground rules, argument
> grammar, S0/S1/S2 severity scale, report skeleton, fix mode and fan-out
> apply here. This file adds only what is specific to the hoggish-assistant library.

Verify a change end to end and report faithfully. Scope: `$ARGUMENTS` (grammar in `review-core`
section 1). Empty or `full` means every entry point and every scenario below; `diff` means the
current branch's changes against `main` plus the working tree; a path, PR number or commit range
narrows it. Adding missing tests is part of this skill and needs no `fix`; changing `src/` does.

Sources of truth: `CLAUDE.md` (the rules), `README.md` (the promised behaviour) and
`references/cases.md`, the QA regression catalog. An area code as the target runs that area's
cases; `retest` starts from the top row of the catalog run log. Keep the catalog alive per
`review-core` section 6.

## Steps

1. **Run the checks.** Run each separately so failures are attributed:

   ```bash
   npm run typecheck
   ```

   ```bash
   npm test
   ```

   ```bash
   npm run build
   ```

   Paste failing output verbatim. Never describe a failing step as passing or "mostly passing".

2. **Check test coverage of the change.** For each changed function in `src/`, name the test in
   `test/` that exercises it. Where none exists, add one using the patterns below, then rerun
   `npm test`. Do not add tests that only assert the implementation's current output; each test
   needs an input and an expected behaviour the README promises.

3. **Run the scenario list** below for the areas the change touches. Each scenario is a test
   case; if it is not already covered, write it.

4. **Release checklist** (when the user is committing, tagging or bumping the version):
   - `dist/` rebuilt and committed together with `src/` (`git status` shows no stale `dist/`).
   - `package.json` version bumped and `CHANGELOG.md` has an entry for it.
   - README install snippet points at the new tag.
   - New entry points are in `package.json` `exports` and `tsup.config.ts`.
   - No `node:` or `Buffer` usage in `src/index.ts`, `src/server.ts` or their imports.

5. **Report** in the `review-core` section 3 skeleton: `QA: <scope>`, commit, a Checks table of
   the three commands and their result (failures quoted), then findings as `[S0|S1|S2]` with
   Scenario, Fix and Verified, then the coverage gaps you found and what you added, then
   "Checked, not a finding" and "Not run".

   Severity here: **S0** = a failing check, a privacy-guard gap, or a release checklist item not
   met when tagging. **S1** = a changed function with no behavioural test, or a scenario below
   that is not covered. **S2** = test quality (implementation-detail assertions, duplication).

## Test patterns in this repo

- Framework: vitest (`vitest.config.ts`), React tests under jsdom in `test/react.test.tsx`.
- Fake models: `MockLanguageModelV4` from `ai/test`, wrapped by `test/helpers.ts`. A `Step`
  describes one model call (`text`, `calls`, `finish`, `errorAfterText`); an `Error` in its place
  fails the call before streaming. Use `APICallError` with a status code to simulate 429, 404,
  5xx.
- Providers: `customProvider({ name, models: [...] })` with mock models; no network ever.
- Event streams: `readEventStream` from `src/events.ts` to collect NDJSON events.
- Privacy guard: `test/logging.test.ts` fails if prompt or tool-result text reaches `console` or
  `process.emitWarning`. Extend it when adding new model calls or error paths.

## Scenarios to cover

**Fallback (`test/fallback.test.ts`).** Per-day 429 before text moves to the next model and marks
the first used up. Per-minute 429 only cools down. 404 cools down for an hour. 5xx moves on.
Error after text has streamed does not retry and ends with `BUSY` or `SERVER_ERROR`. All models
used up in the store: chain still tried. Model switch mid-turn drops reasoning parts.

**Quota (`test/quota.test.ts`, `test/supabase.test.ts`).** Day boundary at midnight Pacific.
Untracked models when no `dailyLimit`. Summary fields: requests left, questions left, current
model, fallback flag, reset time.

**Handler and loop (`test/handler.test.ts`).** Unauthorized returns the right status and code.
Invalid context gives `INVALID_REQUEST`. Tool loop stops at `MAX_ROUNDS`. Invalid tool input is
reported to the model, not executed. `attachFile` streams a file event.

**Confirmation (`test/confirm.test.ts`).** A `needsConfirmation` tool proposes instead of running.
A confirmed call with a valid signature runs once; a tampered or missing signature does not.
Cancel runs nothing.

**Request parsing (`test/request.test.ts`).** `DEFAULT_LIMITS` enforced on message count and
size; malformed bodies rejected.

**Markdown (`test/markdown.test.ts`).** Hostile input (script tags, javascript: links, unclosed
constructs) never yields raw HTML.

**Excel (`test/excel.test.ts`).** Money, date and percent columns; `safeSheetName` strips invalid
characters and length.

**React (`test/react.test.tsx`).** Hook streams text, surfaces confirmations, handles abort and
errors; renders on both React 18 and 19 APIs.
