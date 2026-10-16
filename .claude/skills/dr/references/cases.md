# Design regression catalog (hoggish-assistant)

This is an API design catalog, not a visual one. Severity if failed
(`review-core` section 2): **S0** a privacy leak path, a side effect that can
bypass confirmation, a breaking change for the consumer apps without a major
bump, or a runtime promise broken; **S1** an inconsistent or non-minimal public
surface, a new event older clients cannot ignore, storage or a provider without
an interface; **S2** naming and docs. Each case turns a design question into a
check against the proposal and the code it touches. IDs are stable; append,
never renumber. `[dr YYYY-MM-DD]` marks a case added from a finding in that run.

## Run log (newest first; `retest` starts from the top row)

| Date | Commit | Scope | Findings (S0/S1/S2) | Checks run | Not run |
|---|---|---|---|---|---|

## FIT — does it belong in the library

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| FIT-001 | S1 | No app database access | Does the proposal read or write an app table? | The library never touches the app's database; the app supplies data through tools |
| FIT-002 | S1 | No owned auth, prompts or keys | Does it hard-code a prompt, key or auth rule? | Each app supplies `authorize`, tools, prompt and key |
| FIT-003 | S1 | Tenant-specific logic stays in the app | Does it mention a club, restaurant or user type? | Nothing tenant-specific in `src/` |

## ENTRY — entry point and runtime

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| ENTRY-001 | S0 | Correct entry chosen | Which of `hoggish-assistant`, `/server`, `/react`, `/markdown`, `/excel`, `/supabase` gets it? | Matches the runtime the code needs |
| ENTRY-002 | S0 | Runtime promise kept (guard: `test/portability.test.ts`) | Does the code need `node:` or `Buffer`? | Core and server stay Web-API only; Node-only goes to `/excel` |
| ENTRY-003 | S1 | New entry fully wired | Does the proposal list `package.json` `exports`, `tsup.config.ts` and a README row? | All three named |

## API — public surface

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| API-001 | S1 | Minimal surface | Could it be an option on `createAssistantHandler`, `defineTool`, a provider or `useAssistantChat`? | Option preferred over a new function |
| API-002 | S0 | Breaking change identified (guard: `test/apiSnapshot.test.ts`) | Does any export change signature or disappear? | Flagged with a major bump or redesigned to be additive |
| API-003 | S1 | Consistent naming | Compare with existing export names | Same verb-noun style and option shapes |
| API-004 | S2 | Worth a major bump | If breaking, is the gain stated? | Justification present |
| API-005 | S0 | Consumer call sites of a removed or renamed export | `grep -rnwE --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.cjs' --exclude-dir={node_modules,dist,.next,output,tmp} "<export1>\|<export2>" ~/Desktop/game-club-finance ~/Desktop/zar-kebab-pos` for each export the proposal removes or renames | No hit, or the proposal plans a major bump and names each call site [dr 2026-10-16] |
| API-006 | S1 | Consumer call sites of a changed signature or event shape | Same grep for each changed export, event type or error code | Each call site named with how it adapts [dr 2026-10-16] |
| API-007 | S2 | Consumer call sites listed | Review has a "Consumer call sites" section | One line per touched export: hits or "none" [dr 2026-10-16] |

## STREAM — streaming contract

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| STREAM-001 | S1 | New events ignorable by older clients | Does it add a type to `src/events.ts`? | New type only; unknown types skipped by `readEventStream` and the hook |
| STREAM-002 | S0 | No renamed or removed field | Diff the event types | Additive only without a major bump |
| STREAM-003 | S1 | Hook and `readEventStream` handle it | Does the proposal name both updates? | Both listed |

## FB — fallback and quota behaviour

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| FB-001 | S1 | Mid-turn model failure | What happens when a model fails mid-turn? | Behaviour stated; no retry after streamed text |
| FB-002 | S1 | Chain exhausted | What happens when every model is used up? | Chain still tried; terminal event named |
| FB-003 | S1 | Quota store unavailable | What happens when the store errors? | Turn proceeds; failure logged by stage |

## CONF — confirmation and safety

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| CONF-001 | S0 | Side effects go through `needsConfirmation` | Does it add a way for the model to cause side effects? | HMAC-signed proposal required |
| CONF-002 | S0 | No unconfirmed execution path | Trace every path to `execute` | All verified first |
| CONF-003 | S1 | Input validated | Does new tool input pass `validateToolInput`? | Yes |

## PRIV — privacy

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| PRIV-001 | S0 | No text to logs, errors or `onError` | Trace prompt, message and tool-result text | Only stage, provider, tool, status, error name leave |
| PRIV-002 | S0 | No new third party | Does it send data anywhere new? | None, or named and justified |
| PRIV-003 | S1 | Logging guard extended | Is `test/logging.test.ts` named for the new path? | Yes |

## PLUG — pluggability

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| PLUG-001 | S1 | Storage behind an interface | Does it add storage? | Behind `QuotaStore`-style interface with an in-memory implementation |
| PLUG-002 | S1 | Provider behind an interface | Does it add a provider? | Implements `AssistantProvider`; works with `customProvider` in tests |
| PLUG-003 | S2 | Defaults sensible | Is the in-memory default usable without config? | Yes |

## TEST — testability

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| TEST-001 | S1 | Testable with `MockLanguageModelV4` | Can the scenario be scripted as `Step`s in `test/helpers.ts`? | Yes, without network |
| TEST-002 | S1 | New test file or cases named | Does the proposal list them? | Named per scenario |
| TEST-003 | S2 | Both React versions | If it touches `/react`, are 18 and 19 covered? | Yes |

## DOCS — docs and release

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| DOCS-001 | S1 | README sections named | Which README sections change? | Listed |
| DOCS-002 | S1 | `CHANGELOG.md` entry named | Which version and entry? | Listed |
| DOCS-003 | S1 | `dist/` rebuild and tag | Does it need a rebuild and a new Git tag? | Stated |
| DOCS-004 | S2 | Consumer apps' update script | Does `scripts/update-hoggish-assistant.cjs` in the consumer repos need a change? | Stated |
