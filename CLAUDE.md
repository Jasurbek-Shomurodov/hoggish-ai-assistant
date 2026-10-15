# hoggish-assistant

Shared TypeScript library for an AI chat assistant (fallback chain, quota tracking, confirm-before-action
tool loop, NDJSON streaming). See `README.md` for the public API.

## Commands

- `npm run check`: typecheck, tests and build. Run it before every commit.
- `npm test`: vitest only.

## Rules

- `dist/` is committed and installed from Git tags. Whenever `src/` changes, run `npm run build` and
  commit `dist/` in the same commit.
- Core and server entries (`src/index.ts`, `src/server.ts` and their imports) use only Web APIs. No
  Node built-ins there; Node-only code lives in `src/excel.ts`.
- Prompts, messages, tool inputs and tool results must never reach logs or error payloads
  (`test/logging.test.ts` guards this).

## Releasing: Claude does it, every time

After finishing a change, Claude commits, tags and pushes without being asked. The user does not
run these steps themselves.

1. Bump `version` in `package.json` (patch for fixes, minor for features), add a `CHANGELOG.md`
   entry, and point the README install snippet at the new tag.
2. `npm run check`, then commit everything including `dist/`.
3. Tag `vX.Y.Z` and push `main` and the tag.

Pushing: the repo is `Jasurbek-Shomurodov/hoggish-ai-assistant`; `origin` is the SSH alias
`github-dangerhoggish` (key `~/.ssh/dangerhoggish`, GitHub account Jasurbek-Shomurodov). Keep it
SSH; do not switch the remote to HTTPS or change global git config.

```bash
git push origin main vX.Y.Z
```

Skills in `.claude/skills/`: `/cr` code review, `/dr` design review, `/qa` checks and release checklist.
