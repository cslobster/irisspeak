---
name: verify
description: Run the project's full verify loop (npm run verify at the repo root — backend unit tests, web-client typecheck/lint/test, playwright e2e) and drive it to green. Use when asked to verify, check, or make sure everything passes before finishing or pushing.
argument-hint: [fast]
---

# Verify the IrisSpeak monorepo

Run the checks, read the failures, fix them, re-run. **Never report the task as done while anything is red**,
and never "fix" a failure by deleting or skipping the test that surfaced it (only when the test itself is
verifiably wrong, and say so).

## 1. Run

From the repo root:

```bash
npm run verify --if-present
```

`verify` is the root script that runs everything (root `npm test`, then `web-client` `typecheck` + `lint` +
`test`, then `e2e`, which is playwright with `reuseExistingServer: true`; it boots `:3000` and `:4200` itself
if they are not already up, so you do not need to start dev servers first). If `$ARGUMENTS` is `fast`, or the
root has no `verify` script yet (`--if-present` exits 0 silently), run the fast subset by hand instead:

```bash
npm test                                             # root vitest (DB and Gemini are mocked)
npm run typecheck --prefix web-client --if-present   # tsc --noEmit;  fallback: (cd web-client && npx tsc --noEmit -p .)
npm run lint      --prefix web-client --if-present
npm run test      --prefix web-client --if-present   # vitest
```

## 2. Summarise

Before touching code, write a 1–3 line summary per failing check: which check, which file:line, the
one-sentence cause. If the e2e step fails, check whether the failure is environmental first (port `3000`/`4200`
held by a stale process, missing root `.env.local` → `DATABASE_URL`, Neon cold start on the first request)
before treating it as a code bug — CLAUDE.md "Running locally" lists what the backend needs.

## 3. Fix, then re-run

Fix the root cause in the source, re-run the failing check alone to confirm, then re-run the full
`npm run verify` once more so a fix in one package cannot break another. Only when the full run is clean say
"verify is green" and list what was run.

## Notes

- The Stop hook (`.claude/hooks/stop-verify.sh`) already runs the fast subset whenever the tree is dirty and
  keeps the turn going if it is red; the PreToolUse hook on `git push` runs the full `verify`. This skill is the
  same loop, run on purpose and read carefully.
- Root `vitest.config.ts` is scoped to `src/**/*.test.ts` (backend only); web-client's tests run through
  its own `npm test`. Playwright specs are `e2e/*.e2e.ts` so neither vitest collects them.
- Do not run `git push` from here; pushing is the user's call (see CLAUDE.md "Git").
