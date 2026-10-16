# QA regression catalog (hoggish-assistant)

Severity if failed (`review-core` section 2): **S0** a failing check, a
privacy-guard gap, or a release checklist item not met when tagging; **S1** a
changed function with no behavioural test, or a scenario below not covered;
**S2** test quality. "Expect" is the pass condition. IDs are stable; append at
the end of an area, never renumber. `[qa YYYY-MM-DD]` marks a case added from
a finding in that run.

Tests never touch the network: fake models come from `MockLanguageModelV4`
through `test/helpers.ts`.

## Run log (newest first; `retest` starts from the top row)

| Date | Commit | Scope | Findings (S0/S1/S2) | Checks run | Not run |
|---|---|---|---|---|---|

## CHK — checks

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| CHK-001 | S0 | Typecheck passes | `npm run typecheck` | Exit 0 |
| CHK-002 | S0 | Tests pass | `npm test` | All green; failures quoted verbatim |
| CHK-003 | S0 | Build passes | `npm run build` | Exit 0; `dist/` produced for every entry |
| CHK-004 | S1 | Checks attributed separately | Run the three commands one by one | Each result reported on its own line |

## COV — coverage of the change

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| COV-001 | S1 | Every changed `src/` function has a test | For each changed function, `grep -n "<name>" test/*.test.ts*` | A test exercises it with an input and a README-promised behaviour |
| COV-002 | S2 | No implementation-detail assertions | Read new tests | Assertions describe behaviour, not the current output shape |
| COV-003 | S1 | New error paths extend the privacy guard | Diff against `test/logging.test.ts` | Each new model call or catch block has a logging case |
| COV-004 | S2 | No duplicated test setup | Compare new tests with `test/helpers.ts` | Helpers reused |

## REL — release checklist

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| REL-001 | S0 | `dist/` rebuilt with `src/` | `npm run build && git status --short dist` | Clean |
| REL-002 | S0 | Version bumped and changelog entry present | `package.json` version vs `CHANGELOG.md` | Match |
| REL-003 | S0 | README install snippet points at the new tag | `grep -n "#v" README.md` | Tag equals the version |
| REL-004 | S0 | New entry points exported | `package.json` `exports` and `tsup.config.ts` | Every entry listed |
| REL-005 | S0 | No `node:` or `Buffer` in core and server | `grep -rnE "node:\|\bBuffer\b" src/index.ts src/server.ts` and their imports | None |

## FB — fallback scenarios

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| FB-001 | S1 | Per-day 429 before text moves on and marks used up | `test/fallback.test.ts` | Second model answers; first marked used up |
| FB-002 | S1 | Per-minute 429 only cools down | Same file | No used-up mark; retried after cooldown |
| FB-003 | S1 | 404 cools for an hour | Same file | Cooldown 1 h |
| FB-004 | S1 | 5xx moves on | Same file | Next model used |
| FB-005 | S1 | Error after text does not retry | Same file | Ends with `BUSY` or `SERVER_ERROR` |
| FB-006 | S1 | All used up: chain still tried | Same file | Every model attempted |
| FB-007 | S1 | Model switch drops reasoning parts | Same file | Previous reasoning absent in the next call's prompt |

## QUOTA — quota scenarios

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| QUOTA-001 | S1 | Day boundary at midnight Pacific | `test/quota.test.ts` | 23:59 and 00:01 Pacific land in different days |
| QUOTA-002 | S1 | Untracked models without `dailyLimit` | Same file | No store write |
| QUOTA-003 | S1 | Summary fields | Same file | Requests left, questions left, current model, fallback flag, reset time |
| QUOTA-004 | S1 | Supabase store round trip | `test/supabase.test.ts` | Read, mark used up, reset |

## HND — handler and loop

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| HND-001 | S1 | Unauthorized returns the right status and code | `test/handler.test.ts` | 401 with the documented code |
| HND-002 | S1 | Invalid context gives `INVALID_REQUEST` | Same file | Event emitted |
| HND-003 | S1 | Tool loop stops at `MAX_ROUNDS` | Same file | Terminal event after the limit |
| HND-004 | S1 | Invalid tool input reported, not executed | Same file | Validation error to the model; `execute` not called |
| HND-005 | S1 | `attachFile` streams a file event | Same file | File event with name and content |

## CONF — confirmation

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| CONF-001 | S0 | `needsConfirmation` proposes instead of running | `test/confirm.test.ts` | Proposal event; no execute |
| CONF-002 | S0 | Confirmed call with a valid signature runs once | Same file | One execute |
| CONF-003 | S0 | Tampered or missing signature does not run | Same file | Rejected |
| CONF-004 | S1 | Cancel runs nothing | Same file | No execute |

## REQ — request parsing

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| REQ-001 | S1 | `DEFAULT_LIMITS` on message count | `test/request.test.ts` | Over-limit rejected |
| REQ-002 | S1 | `DEFAULT_LIMITS` on message size | Same file | Over-size rejected |
| REQ-003 | S1 | Malformed bodies rejected | Same file | 400 with the documented code |

## MD — markdown

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| MD-001 | S0 | Script tags never yield HTML | `test/markdown.test.ts` | Escaped |
| MD-002 | S0 | `javascript:` links neutralized | Same file | No executable href |
| MD-003 | S1 | Unclosed constructs terminate | Same file | Output produced, no raw HTML |

## XL — excel

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| XL-001 | S1 | Money, date and percent columns formatted | `test/excel.test.ts` | Number formats applied |
| XL-002 | S1 | `safeSheetName` strips invalid characters and length | Same file | Valid name ≤ 31 characters |

## REACT — react hook

| ID | Sev | Case | Check | Expect |
|---|---|---|---|---|
| REACT-001 | S1 | Hook streams text | `test/react.test.tsx` | Text accumulates |
| REACT-002 | S1 | Surfaces confirmations | Same file | Proposal in state |
| REACT-003 | S1 | Handles abort and errors | Same file | Abort stops; error in state |
| REACT-004 | S1 | Renders on React 18 and 19 APIs | Same file | Both pass |
