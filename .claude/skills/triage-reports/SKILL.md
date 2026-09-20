---
name: triage-reports
description: Triage open "Report a problem" submissions — fetch them from the admin API (local backend by default, prod on request), view each screenshot + conversation context, reproduce in Chrome against localhost, and propose a fix as a diff for approval. Never marks reports resolved, never pushes.
disable-model-invocation: true
argument-hint: [prod] [report-id]
---

# Triage problem reports

These are the app-bug reports from the web-client's **Report a problem** button (`ReportButton.tsx`), stored in
`problem_report` — not the model's card-choice feedback (`board_feedback`, `/admin/feedback`). Read-only
triage: you look, reproduce, and propose; the user decides what ships and marks things resolved in the admin UI.

## 1. Target and admin token

Default target is the local backend, `http://localhost:3000` (start it with `npm run dev` at the repo root if
`curl -s localhost:3000/api/v1/ping` fails; it needs root `.env.local`). Use prod, `https://aac-roan.vercel.app`,
only if `$ARGUMENTS` contains `prod` or the user says so — the prod `ADMIN_PASSWORD` is not in the local
`.env.local`, so ask for it (or for a token) rather than guessing.

```bash
BASE=http://localhost:3000            # or https://aac-roan.vercel.app
PW=$(grep '^ADMIN_PASSWORD=' /Users/jeremysihan/aac/.env.local | cut -d= -f2- | tr -d "\"' ")   # never echo it
TOKEN=$(curl -s -X POST "$BASE/api/v1/admin/auth/login" -H 'content-type: application/json' \
        -d "$(jq -cn --arg p "$PW" '{password:$p}')" | jq -r .token)     # 24-h admin JWT; 401 {detail} on a bad password
```

Every admin call takes `Authorization: Bearer $TOKEN`. Routes are in `src/app/api/v1/admin/reports/route.ts`
and `.../reports/[id]/route.ts`; response helpers wrap errors as `{detail}` with 400/401/404.

## 2. List the open reports

```bash
curl -s "$BASE/api/v1/admin/reports?status=open" -H "Authorization: Bearer $TOKEN" \
  | jq -r '.[] | [.created_at[0:16], .id, .alias, .child_name, (.has_screenshot|tostring), (.description|.[0:80])] | @tsv'
```

Rows: `id, dyad_id, session_id, description, status, created_at, has_screenshot, alias, child_name,
parent_email` — the list never includes the screenshot (newest first, up to 2000). If a report id was passed in
`$ARGUMENTS`, skip straight to it.

## 3. For each report: detail, screenshot, context

```bash
ID=...; D=/private/tmp/report-$ID; mkdir -p "$D"
curl -s "$BASE/api/v1/admin/reports/$ID" -H "Authorization: Bearer $TOKEN" > "$D/report.json"
jq 'del(.screenshot_data)' "$D/report.json"                                   # description, context, client, session_id, alias…
jq -r '.screenshot_data // empty' "$D/report.json" | sed 's/^data:image\/[a-z]*;base64,//' | base64 -d > "$D/shot.jpg"
```

Then **Read `$D/shot.jpg`** (it is an html2canvas capture of `#root` — the app only, never the browser chrome,
JPEG q0.7). `context` is `LocalApi.reportContext` at the moment of the report:

```
{ session_id, setting: home|school|restaurant|doctor|play|transport|selfcare|unknown,
  role: 'parent'|'child', question: <the partner's current question>, prefix: [<labels of cards tapped so far>],
  dialogue: [{ role, content: <string for parent turns | [card labels] for child turns>, content_localized: <realised sentence> }],
  model_version }
```

`client` is `'web'` (iOS does not send reports). For more of that family's history: `GET
/api/v1/admin/dyads/<dyad_id>/transcripts` and `/reports` (per-account list, screenshots included).

Write a two-line triage note per report before reproducing: what the parent says happened, and what the
screenshot + context suggest (wrong board? layout clipped? a crash — check `window.__errs` in the repro?).

## 4. Reproduce against localhost in Chrome

Both dev servers up (`npm run dev` at the root and in `web-client/`), then, with the Claude in Chrome tools
(load them with one `ToolSearch "select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__find"`):

1. `https://localhost:4200/` → "Sign in with a username and password →" → `guest` / `12345` (or the seeded
   `abcde` / `12345`). Wait for the model progress on Welcome to finish.
2. Match the report: set the place via ☰ → place (`context.setting`), size the window like the screenshot
   (iPad landscape 1180×820 is the common case), start a conversation, type the same `question` in the parent
   turn, tap the same `prefix` cards, then do what the description says.
3. Capture: `computer` screenshot, `read_console_messages` for errors, and `javascript_tool`
   `JSON.stringify(window.__errs)` (index.html keeps the first runtime errors).

If it does not reproduce with the guest account, say so and what differed (custom words, history, text size,
phone vs tablet layout — phones use `CompactSession.tsx`, which has no Report button, so every report comes from
a tablet/desktop layout).

## 5. Propose the fix — as a diff, for approval

Find the cause in `web-client/src/` (or `src/` for an API error), make the smallest change, and show it as a
unified diff (`git diff`) with a one-paragraph explanation per report: symptom → cause → change → how you
verified it (re-run the repro, plus the typecheck hook / `npm run verify`). Then **stop and wait**. Only after the
user approves do you keep the change in the tree; if they decline, `git checkout -- <files>`.

## Never

- `PATCH /api/v1/admin/reports/<id>` (status open/resolved) — the user resolves reports in the admin UI.
- `git push`, or commit without being asked.
- Paste the admin password or token into the transcript, or send them anywhere but `$BASE`.
- Change `board_feedback` handling — different feature, different pipeline.
