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

Pushing: the `origin` SSH alias (`github-dangerhoggish`) authenticates as a GitHub account without
access to this repo. Push with the `gh` CLI's active account (`exampleschool23`) over HTTPS instead,
without changing the remote or global git config:

```bash
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push https://github.com/exampleschool23/hoggish-assistant.git main vX.Y.Z
```

Skills in `.claude/skills/`: `/cr` code review, `/dr` design review, `/qa` checks and release checklist.
