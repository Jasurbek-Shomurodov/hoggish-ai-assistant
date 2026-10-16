# hoggish-assistant

Shared TypeScript library for an AI chat assistant (fallback chain, quota tracking, confirm-before-action
tool loop, NDJSON streaming). See `README.md` for the public API.

## Commands

- `npm run check`: typecheck, tests, dist drift guard, build and release check. Run it before every commit.
- `npm test`: vitest only.
- `npm run check:dist`: fails when the committed `dist/` differs from a fresh build (`scripts/check-dist.mjs`).
- `npm run release-check -- --release`: the release checklist as a script (`scripts/release-check.mjs`).

## Rules

- `dist/` is committed and installed from Git tags. Whenever `src/` changes, run `npm run build` and
  commit `dist/` in the same commit.
- Core and server entries (`src/index.ts`, `src/server.ts` and their imports) use only Web APIs. No
  Node built-ins there; Node-only code lives in `src/excel.ts`.
- Prompts, messages, tool inputs and tool results must never reach logs or error payloads
  (`test/logging.test.ts` guards this).
- Guards: `test/portability.test.ts` (Web APIs only from the portable entries), `test/apiSnapshot.test.ts`
  with `test/api-snapshot.json` (public exports, NDJSON event types, error codes; a removed or renamed
  name is a major bump; update on purpose with `UPDATE_API_SNAPSHOT=1 npm test`), `scripts/check-dist.mjs`
  and `scripts/release-check.mjs`. CI runs them all in `.github/workflows/checks.yml` on React 18 and 19.

## Releasing: Claude does it, every time

After finishing a change, Claude commits, tags and pushes without being asked. The user does not
run these steps themselves.

1. Bump `version` in `package.json` (patch for fixes, minor for features), add a `CHANGELOG.md`
   entry, and point the README install snippet at the new tag.
2. `npm run check` and `npm run release-check -- --release`, then commit everything including `dist/`.
3. Tag `vX.Y.Z` and push `main` and the tag.

Pushing: the repo is `Jasurbek-Shomurodov/hoggish-ai-assistant`; `origin` is the SSH alias
`github-dangerhoggish` (key `~/.ssh/dangerhoggish`, GitHub account Jasurbek-Shomurodov). Keep it
SSH; do not switch the remote to HTTPS or change global git config.

```bash
git push origin main vX.Y.Z
```

Skills in `.claude/skills/`: `/cr` code review, `/dr` design review, `/qa` checks and release checklist.
