# IrisSpeak — current state

Read this right after `CLAUDE.md`, every session, before starting work. **`CLAUDE.md` is the
stable reference** (architecture, routes, conventions — rarely changes); **this file is the
volatile "what's actually going on right now"** — a new session, or a spawned agent with no other
context, should be able to read this one file and know what's in flight without scanning the repo
or `git log`. Update it in the same commit whenever something here goes stale — see "Keeping this
file current" at the bottom.

## Right now
Nothing in-flight. The last session (2026-09-19/20) shipped the "Report a problem" feature end to
end and chased down why the Vercel auto-deploy workaround wasn't fully working (see Deploy status
below) — that's diagnosed and handed off to cslobster; no Claude Code action pending on it.

## Deploy status (checked 2026-09-20)
All four `VERCEL_HOOK_*` repo secrets are set, and every push's `deploy-hooks.yml` Action run hits
all four hooks with `HTTP 201`. But a 201 only means Vercel *accepted* the trigger, not that the
build reached production — verified by downloading the actual live JS bundles:
- **Backend** (`aac-roan.vercel.app`) — deploying correctly, new routes from 2026-09-19 are live.
- **`web-client`** (`irisspeak.com`) — **not** deploying. Live bundle has zero trace of anything
  from 2026-09-19 (Report button, `html2canvas`, the Google-password feature).
- **`admin`** (`admin.irisspeak.com`) — **not** deploying. Live bundle has no Reports tab, no
  `ReportContextView`.

Needs cslobster (Vercel dashboard access) to check the `web-client`/`admin` projects' Deployments
tab for a build error or a deployment stuck unpromoted. **Don't re-verify this by trusting the
Action's green checkmark** — `curl` the deployed JS and grep for something recent, the way this was
confirmed. Once fixed, update this section (or delete it if deploys are fully healthy again).

## Recent history (newest first)
- 2026-09-19/20: added "Report a problem" (`ReportButton.tsx`) — in-app screenshot (`html2canvas`
  on `#root`, never the browser chrome) + free text + conversation context → `problem_report`, with
  an admin Reports page, a per-account Reports sub-tab, and a full-screen screenshot lightbox.
  Fixed a real `html2canvas` bug along the way: card labels clipped because it rasterized before
  the OpenDyslexic web font had finished loading — fixed by awaiting `document.fonts.ready` first.
  Separately, any account (including Google-only ones) can now set an app password via
  `/dyad/account/password` and sign in with parent email + that password — explicitly *not* the
  person's real Google password (no third party can verify that; this is a from-scratch app
  credential, same mechanism the signup wizard already used for login codes).
- 2026-09-18: added a permanent "?" card to the quick row (any tapped cards + "?" → sentence ends
  in "?"). `PERSONAL_ROW` dropped 5→4 to keep the row's fixed ten-chip budget.
- 2026-09-16/17: board redesign — quick row (yes/no/please + personal cards + More ideas/View all),
  Topic 15 / Action 3 / Feeling 3 panels, Feedback button, iPad short-landscape side column,
  settings-nav fixes.
- 2026-09-15: replaced the cloud-LLM (Gemini) per-turn card/sentence generation with the on-device
  model (SmolLM2-135M card model + realiser). Dead cloud-LLM code deleted 2026-09-17 (`23a73ec`) —
  it's in git history if ever needed, not resurrected by accident.
- The 2026-09-15 repo reorg moved `data/` → `model/data/`, which broke `startSession`'s YAML read
  in production; fixed by inlining the guides into `src/lib/staticData.ts` — there is no root
  `data/` any more.

## Keeping this file current
Update this file in the same commit whenever: deploy status changes, a feature ships, a blocker
gets resolved, or "what we're working on" changes. Stale entries here are worse than missing ones —
correct or remove anything found outdated rather than just appending to the bottom. Rule of thumb
for where a fact belongs: `CLAUDE.md` is "how the system is built and organized" (rarely changes);
this file is "what's happening with it lately" (changes most sessions). If unsure, it goes here —
`CLAUDE.md` should stay boring and stable.
