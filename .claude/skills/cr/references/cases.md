# Code regression catalog (hoggish-assistant)

Severity if failed (`review-core` section 2): **S0** prompt, message or tool
text reaching logs or error payloads, a tool running without a verified
confirmation, a `node:` or `Buffer` dependency reachable from the core or
server entry, a breaking public API or NDJSON change without a major bump, or
`dist/` out of date with `src/`; **S1** a fallback, quota or request-limit rule
broken, or a public change missing from `CHANGELOG.md` and `README.md`; **S2**
maintenance. Each case says how to check it. IDs are stable; append, never
renumber. `[cr YYYY-MM-DD]` marks a case added from a finding in that run;
`Fixed YYYY-MM-DD` plus the guarding test closes it.

## Run log (newest first; `retest` starts from the top row)

| Date | Commit | Scope | Findings (S0/S1/S2) | Checks run | Not run |
|---|---|---|---|---|---|

## RT — runtime portability

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| RT-001 | S0 | No Node built-ins in the core and server entries (guard: `test/portability.test.ts`) | `grep -rnE "from 'node:\|require\('node:\|\bBuffer\b\|process\." src/index.ts src/server.ts src/handler.ts src/loop.ts src/fallback.ts src/quota.ts src/tools.ts src/confirm.ts src/events.ts src/request.ts src/providers.ts src/supabase.ts` | No hit; only `fetch`, Web Crypto, `TextEncoder`, `btoa` |
| RT-002 | S0 | Node-only code stays in `src/excel.ts` | `grep -rn "excel" src/index.ts src/server.ts` | Neither entry imports `excel.ts` |
| RT-003 | S0 | React code stays in `src/react.tsx` | `grep -rn "from 'react'" src --include=*.ts` | No hit outside `react.tsx` |
| RT-004 | S1 | A new entry is wired everywhere | `grep -n "exports" -A30 package.json` and `tsup.config.ts` | Every entry in `package.json` `exports`, `tsup.config.ts` and the README table |
| RT-005 | S2 | No transitive Node dependency | `grep -n "dependencies" -A10 package.json` and each dependency's engines | Dependencies of the core entry are runtime-neutral |

## PRIV — privacy

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| PRIV-001 | S0 | No prompt, message or tool text reaches `console` | `grep -rnE "console\.(log\|warn\|error\|info)" src` | Each hit logs only stage, provider, tool name, status or error name |
| PRIV-002 | S0 | `onError` payload is limited | Read the `onError` call sites in `src/handler.ts` and `src/loop.ts` | Only stage, provider, tool, status and error name; never `requestBodyValues`, messages or results |
| PRIV-003 | S0 | Every `streamText`/`generateText` call has its own `onError` | `grep -rn "streamText(\|generateText(" src` | Each call passes `onError` that strips `APICallError.requestBodyValues` |
| PRIV-004 | S0 | `process.emitWarning` never carries text | `grep -rn "emitWarning" src` | No hit, or the warning carries no user content |
| PRIV-005 | S0 | Error messages shown to the model carry no other user's data | Read `ToolError` handling in `src/tools.ts` and `src/loop.ts` | `ToolError` message passes through; other errors replaced by a generic message |
| PRIV-006 | S1 | `test/logging.test.ts` covers every new error path | Diff new `catch` blocks against the test | Each new path has a case |

## FB — fallback chain

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| FB-001 | S1 | Per-day 429 marks the model used up | Read the classifier in `src/fallback.ts` | Daily-limit 429 calls the quota store's used-up marker |
| FB-002 | S1 | Per-minute 429, 404 and 5xx only cool down | Same classifier | 60 s cooldown; 404 cools for 1 h; no used-up mark |
| FB-003 | S0 | No retry on another model once text has streamed | Read `src/loop.ts` around `errorAfterText` | Error after streamed text ends with `BUSY` or `SERVER_ERROR`; no second model |
| FB-004 | S1 | Model switch drops reasoning parts | Read the message rewrite on switch | Previous model's reasoning parts removed; Gemini thought signatures replaced |
| FB-005 | S1 | Exhausted store still tries the chain | Read the chain iteration | All used up → every model still attempted once |
| FB-006 | S2 | Cooldown state is per model | Read the cooldown map | Keyed by model id; no global cooldown |

## QUOTA — quota tracking

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| QUOTA-001 | S1 | Day resets at midnight Pacific | Read the day key in `src/quota.ts` | `America/Los_Angeles` date, not UTC |
| QUOTA-002 | S1 | Models without `dailyLimit` are untracked | Read the tracking guard | No store write for such models |
| QUOTA-003 | S1 | Store unavailable does not block a turn | Read `src/supabase.ts` error handling | Failure logged by stage; the chain proceeds |
| QUOTA-004 | S1 | Summary fields complete | Read the summary builder | Requests left, questions left, current model, fallback flag, reset time |
| QUOTA-005 | S2 | `QuotaStore` interface has an in-memory implementation | `grep -n "QuotaStore" src/*.ts test/*.ts` | In-memory store used by tests |

## TOOL — tools and confirmation

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| TOOL-001 | S0 | `needsConfirmation` tools never run unconfirmed | Read the execute path in `src/tools.ts` and `src/confirm.ts` | Execution requires a verified HMAC proposal |
| TOOL-002 | S0 | HMAC verified before execution | Read `src/confirm.ts` | Timing-safe compare; tampered or missing signature rejected |
| TOOL-003 | S1 | Input validated before `execute` | `grep -n "validateToolInput" src` | Called before every `execute` |
| TOOL-004 | S1 | Tool loop bounded | `grep -n "MAX_ROUNDS" src` | Loop exits at `MAX_ROUNDS` with a terminal event |
| TOOL-005 | S1 | Cancel runs nothing | Read the cancel branch | No execute call |
| TOOL-006 | S2 | `defineTool` shape stable | Read its signature | Options on the existing function, not a new one |

## EVT — events and streaming

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| EVT-001 | S0 | No renamed or removed NDJSON field without a major bump | Diff `src/events.ts` types against the last tag | Only additions, or `package.json` major bumped |
| EVT-002 | S1 | New event types are ignorable | Read `readEventStream` and the React hook | Unknown types skipped without error |
| EVT-003 | S1 | `DEFAULT_LIMITS` enforced | `grep -n "DEFAULT_LIMITS" src/request.ts` | Message count and size checked; malformed bodies rejected |
| EVT-004 | S2 | Event tests updated | `test/events.test.ts` | Each event type has a case |

## API — public surface

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| API-001 | S0 | Breaking change has a major bump (guard: `test/apiSnapshot.test.ts`) | Diff exports of `src/index.ts`, `server.ts`, `react.tsx`, `markdown.ts`, `excel.ts`, `supabase.ts` | Removed or changed signatures → major version |
| API-002 | S1 | `CHANGELOG.md` and `README.md` describe public changes | `git diff -- CHANGELOG.md README.md` | Entry present for every public change |
| API-003 | S1 | Surface minimal and consistent | Compare new exports with `createAssistantHandler`, `defineTool`, providers, `useAssistantChat` | Options on existing functions preferred |
| API-004 | S2 | Consumer apps still build | Read `scripts/update-hoggish-assistant.cjs` in the two consumer repos | Install path unchanged |
| API-005 | S0 | Removed or renamed export still called by a consumer app | `grep -rnwE --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.cjs' --exclude-dir={node_modules,dist,.next,output,tmp} "<export1>\|<export2>" ~/Desktop/game-club-finance ~/Desktop/zar-kebab-pos` for each removed or renamed export | No hit, or the change ships with a major bump and the consumer call sites are listed in the report [cr 2026-10-16] |
| API-006 | S1 | Changed signature or event shape used by a consumer app | Same grep for each export whose parameters, return type or event fields changed; read each hit | Every call site still compiles against the new shape, listed under "Consumer call sites" [cr 2026-10-16] |
| API-007 | S2 | Consumer call sites listed for every changed export | Report has a "Consumer call sites" section | One line per export: file:line hits or "none" [cr 2026-10-16] |

## MD — markdown

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| MD-001 | S0 | Never emits raw HTML | `grep -n "innerHTML\|dangerouslySetInnerHTML\|<script" src/markdown.ts` | None; hostile input escaped |
| MD-002 | S1 | `javascript:` links neutralized | Read the link renderer | Scheme allow-list |
| MD-003 | S2 | Unclosed constructs terminate | `test/markdown.test.ts` | Case exists |

## REACT — react entry

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| REACT-001 | S1 | Works on React 18 and 19 | `grep -n "peerDependencies" -A5 package.json` and `test/react.test.tsx` | Both ranges; tests run both APIs |
| REACT-002 | S1 | No new peer dependency | `git diff -- package.json` | None added |
| REACT-003 | S1 | Hook handles abort and errors | Read `useAssistantChat` | Abort stops the stream; error surfaced in state |

## BUILD — dist and release

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| BUILD-001 | S0 | `dist/` matches `src/` | `npm run check:dist` | Exit 0; guard: `scripts/check-dist.mjs` |
| BUILD-002 | S1 | `npm run check` passes | `npm run check` | Typecheck, tests and build green |
| BUILD-003 | S1 | Version bumped with a changelog entry when tagging | `npm run release-check -- --release` | Exit 0; guard: `scripts/release-check.mjs` |
| BUILD-004 | S1 | CI green | `gh run list --limit 3` after pushing | Latest `checks` run on `main` succeeded; guard: `.github/workflows/checks.yml` [cr 2026-10-16] |
