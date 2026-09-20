# IrisSpeak — project orientation for Claude Code

**Read this file first, then read `STATE.md`, then start working. Do not re-scan the repo to "get
situated" — everything a session needs to orient is in these two files, verified against the code
on 2026-09-17.** This file is the stable architecture reference (rarely changes); `STATE.md` is the
volatile "what's going on right now" (deploy status, recent work, in-flight items — changes most
sessions). Only open files that the task actually touches. If you find something here is wrong or
missing, fix it in the same turn (see "Keeping this file current" at the bottom).

## What the product is

Context-aware AAC (augmentative & alternative communication). A minimally-verbal child answers a
partner's question (parent, teacher) by tapping picture cards; the app predicts which cards to show
and turns the tapped cards into a spoken sentence. **Both predictions run on the device** — a
fine-tuned SmolLM2-135M "card model" plus a second 135M "realiser", exported to ONNX and run in the
browser with onnxruntime-web (Core ML/ONNX Runtime on iOS). No cloud LLM is called during a
conversation. The backend only stores accounts, profiles, custom words, and mirrors of what happened.

Audience: children (and young adults) with AAC needs, mostly on iPads. Hard UX rules: **no
scrolling on any screen** (everything zoom-to-fits the viewport), colourful-and-clean visual style,
OpenDyslexic font, Fitzgerald-Key card colours (topic/things = orange `#FFE3C2`, action/verbs =
green `#D9F2D0`, feeling = blue `#D6E8FB`, core/function = pink `#FCD9E5`, tailwind `bg-card-*`).

## Repo map (monorepo `github.com/cslobster/irisspeak` — renamed from `cslobster/aac`; one branch `main`, everything deploys on push)

| Piece | Dir | Deployed as | Stack |
|---|---|---|---|
| **Web app (the product)** | `web-client/` | irisspeak.com — Vercel project `web-client` | Vite + React 18 + Tailwind + onnxruntime-web + transformers.js (tokenizer) |
| **API + database** | `src/` (repo root is the Next app) | aac-roan.vercel.app — Vercel project `aac` | Next.js 14 app router, Neon Postgres (`@neondatabase/serverless`), jose JWT |
| Admin dashboard | `admin/` | admin.irisspeak.com (password-gated) | Vite + React; `/api/*` rewritten to aac-roan |
| iOS/iPadOS app | `ios/` | Xcode `ios/irisspeak/irisspeak.xcodeproj` (iOS 17+) | SwiftUI port of the web client; same backend |
| Model pipeline | `model/` | not served; run on Modal or a Mac | Python: data → train → export → eval |
| Research site + model publishing | `site/` | irisspeak.org — Cloudflare Pages; `/paper/*` behind basic auth | static HTML + `chunk_model.py`/`upload_model.sh` to R2 |
| Setting-turns dataset | `datasets/aac-setting-turns/` | released with the paper | JSONL |
| Notes / plans / research | `docs/` | — | markdown (see index below) |
| `TODO/` | root | — | notes; `TODO1.md` is the readable copy of the turn-1 parent guides inlined in `src/lib/staticData.ts` |
| `Archive/`, `goal/`, `scripts/` | root | — | pre-2026-09 leftovers (old corpus scripts, screenshots); nothing live imports them |

Model weights (~520 MB total; card model v7 fp16 in chunks + realiser) are **not in the repo**: they
live in Cloudflare R2 behind `https://model.irisspeak.org/` (`manifest.json`, `cards.json`,
`realiser_manifest.json`, chunks, `reranker.json`, `freq.json`, `card_vecs.bin`, `ort-hf/`). The
browser caches them in Cache Storage (`irisspeak-model-v31`).

## Running locally

```bash
# Backend (repo root)            → http://localhost:3000
npm install && npm run dev
# Web app (separate terminal)    → https://localhost:4200 (HTTPS if web-client/.certs/ exists, else http)
cd web-client && npm install && npm run dev
# Admin (optional)               → http://localhost:4201, proxies /api to :3000
cd admin && npm install && npm run dev
# Verify everything (backend vitest → web-client typecheck/lint/vitest → Playwright e2e; ~20 s with servers up)
npm run verify      # see "Verification" below; `npm test` = backend unit tests only
```

**Web app talks to the local backend in dev, production in prod** (fixed 2026-09-19).
`web-client/src/api/remote.ts`'s `API_BASE` is `'/api/v1'` under `import.meta.env.DEV`, which
Vite's `/api` proxy (`vite.config.ts`) forwards to `localhost:3000`; production builds still call
`https://aac-roan.vercel.app/api/v1` directly. So `npm run dev` in `web-client` now exercises your
own local `.env.local` DB/secrets — username+password login works immediately (seeded `guest`/
`12345`), Google sign-in needs your own `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` locally (the
existing GCP OAuth client belongs to `coolcottontail@gmail.com`'s project, not this account). iOS
still hardcodes the prod URL (`ios/.../Engine/RemoteApi.swift`) — untouched by this.

Viewing on an iPad/iPhone on the same Wi-Fi: `ipconfig getifaddr en0` → `https://<ip>:4200`
(self-signed cert; accept the Safari warning). Vite binds all interfaces (`host: true`).

**Backend `.env.local`** (root only, never committed; restart `npm run dev` after edits):
```
DATABASE_URL=            # Neon Postgres — required, db.ts throws without it
AUTH_SECRET=             # JWT signing (falls back to 'dev-secret-change-me')
GEMINI_API_KEY=          # only for the session-title caption in endSession; app works without it
OPENAI_BASE_URL=         # optional; default Gemini OpenAI-compat endpoint
LLM_MODEL=               # optional; default gemini-2.5-flash-lite
OPENROUTER_API_KEY=      # optional alternate route for the same title call
GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= GOOGLE_REDIRECT_URI=   # Sign in with Google
ADMIN_PASSWORD=          # gates /api/v1/admin/*
TEST_LOGIN_CODE= TEST_DYAD_ALIAS= TEST_CHILD_NAME= ...        # optional seed overrides
```
DB tables auto-create/migrate on first request (`ensureSchema()` in `src/lib/db.ts`, cached on
`globalThis`). Seeded logins: alias `abcde` / code `12345` (child "Sammy") and `guest` / `12345`
(there is no "Continue as Guest" button — guest signs in through the username/password form). Neon free tier sleeps → first query of a session takes 1–2 s.
CORS on `/api/*` is `*` (next.config.js).

## Architecture — the on-device conversation loop (`web-client/`)

```
Partner asks a question (typed or Web Speech dictation)  → AskPanel / SessionScreen
  → LocalApi.sendParentText()          src/api/local.ts   (mirrors to backend: device/turn role=parent)
  → engine.predict(question, prefix)    src/engine/model.ts
       prompt = "Setting: <place>.\nEarlier: <last 2 turns>\nPartner: <q>\nReply cards:"
       SmolLM2 tokenizer (transformers.js) + ONNX card model → softmax over ~3,287 card rows
       (dead rows masked; ranking = log p − 0.5·prior; optional MLP reranker behind profile.reranker_ab, OFF by default)
  → LocalApi.recommendation()  builds the board:
       choice cards ("juice or milk?") pinned first → question-type ROUTES (who/where/when/how many/…)
       → one folder card (decideFolders: routes → model folder rows ≥8% → keyword triggers → category mass)
       → fill Topic/Action/Feeling panels from the ranking, de-duping stems, ≤2 glue words
       → fixed quick row: yes / no / please + "?" (marks the sentence a question) + 4 personal cards (engine.personalRow: history+profile+custom words)
Child taps cards → addChildCard() re-predicts with the new prefix (optimistic UI)
  long-press a card → word forms (grammar.ts inflect: plural/past/-ing/third/possessive) as a free card
  "View all" / folder card / "More ideas" → CardSearchOverlay (Cboard folder browser, public/cboard_folders.json)
"Say it" → LocalApi.inferSentence() → realiser.realise(cards, question)   src/engine/realiser.ts
       second ONNX LM, KV-cache decode, hard vocab constraint: card words (+inflections) + FUNCTION_WORDS + punctuation;
       negations only unlocked by a negation card. Fallback until loaded: engine.realise() rule (cards in order).
       "Another" = sampled re-decode avoiding earlier candidates.
Child approves → confirmCards(): spoken via TTS (audio/tts.ts, girl/boy voice), pushed to local history
       (last 50 turns, localStorage) and mirrored to backend (device/turn role=child, with the board shown).
"Done" → finishChildTurn() → back to the partner's turn.
Feedback button → board_feedback row (dislike w/ crossed-out cards, or the partner's own answer) = training data.
Report button → ReportButton.tsx (html2canvas of #root + free text + reportContext) → problem_report row;
       app-itself bugs, not card-choice feedback — admin's Reports page/sub-tab, not the model pipeline.
```

Board sizes: `PANEL_BIG` 15/3/3 (Topic 5×3, Action 3, Feeling 3) on iPad/desktop; phones use
`CompactSession.tsx` (12/3/3 grid, no scrolling). `screens/session/layout.ts` lays out on a fixed design
canvas (`CONTENT_W` 1068 px = ten 96 px chips + gaps; `DESIGN_H` 880) and scales the whole thing
down (`--fit-scale`) so nothing scrolls; "short landscape" iPads (≥1000 wide, ≤900 tall) put the
Refresh/Clear/Done/Feedback tiles in a right-hand column (`useShortLandscape`). Compact layout kicks
in under 900 wide or 600 tall.

Model loading: starts on `WelcomeScreen` (after sign-in) with a progress bar; card model first, then
reranker (only if A/B on), then the realiser on `requestIdleCallback`. onnxruntime-web is loaded as a
plain script (`public/ort/ort.min.js`, NOT bundled) with 4 wasm threads — this needs the COOP/COEP
headers in `web-client/vercel.json` (cross-origin isolation). No proxy worker (it broke backend init).

### Web-client file map
| Path | What |
|---|---|
| `src/main.tsx`, `src/App.tsx` | HashRouter. Routes: `/` sign-in, `/signup`, `/google` (OAuth return), `/setup` (first run: boy/girl, age, notes), `/home`, `/session/:id`, `/session-end/:id`, `/stars` (past conversations), `/vocabulary`, `/profile`, `/credits` |
| `src/engine/model.ts` | `engine`: loads vocab/tokenizer/model from R2, `predict()`, `personalRow()`, `realise()` rule, `timePrior()` |
| `src/engine/realiser.ts` | on-device sentence model with constrained decoding |
| `src/engine/grammar.ts` | rule-based English inflection for long-press word forms |
| `src/engine/store.ts` | localStorage wrapper (`irisspeak_app_*`): profile, history (50 turns), custom words, sessions |
| `src/engine/settings.ts` | the 8 places (home/school/restaurant/doctor/play/transport/selfcare/unknown) — in the prompt and the question bank |
| `src/api/local.ts` | `LocalApi` — the whole board logic (routes, folders, panels, pages, feedback context) |
| `src/api/remote.ts` | backend calls: sign-in (code or Google), profile/history/custom-word sync, fire-and-forget session/turn/feedback/event mirrors, offline feedback queue |
| `src/screens/SessionScreen.tsx` (~560 lines) | session shell: all state, effects, handlers, compact/board composition (split 2026-09-20; `CompactSession.tsx` is the phone variant) |
| `src/screens/session/layout.ts` | `CONTENT_W`/`DESIGN_H`/`ACTION_COL_W`/`SIDE_DESIGN_H`, `useFitScale` (`--fit-scale`), `useShortLandscape` |
| `src/screens/session/ChildTurn.tsx` | the board: deck + Speak, Topic/Action/Feeling panels, quick row, More ideas / View all, Refresh/Clear/Done/Feedback/Report tiles (row or side-column), local `ActionTile` |
| `src/screens/session/ParentTurn.tsx` | `ParentTurn` (AskPanel wrapper), `SettingPicker`, `Loader` |
| `src/screens/session/overlays.tsx` | `SentenceAcceptance` (Yes/No/Another), `FeedbackDialog`, `WordFormsPopover` |
| `src/**/*.test.ts` | vitest unit tests (`grammar.test.ts`, `local.test.ts` — drives the real `LocalApi` with `engine`/`store`/`realiser`/`remote` mocked; pattern documented at the top of that file) |
| `src/components/` | `CardChip` (tile, long-press), `CardSearchOverlay` (Cboard folder browser + search), `AskPanel` (place + top questions from `public/questions.json` + mic/text), `SessionMenu` (☰: transcript, sound, place, text size, history, profile, end), `SettingsButton`/`SettingsCloseButton` (fixed top-right, `settingsNav.ts` handles return-to), `Transcript`, `TurnBanner`, `VoicePicker`, `MuteButton`, `Spinner`, `Icons`, `ReportButton` (self-contained "Report a problem" — html2canvas of `#root`, not the model's Feedback dialog) |
| `src/audio/` | `tts.ts` (Web Speech synthesis, girl/boy voice, mute), `webspeech.ts` (dictation) |
| `src/uiScale.ts`, `src/labelSize.ts` | text-size setting (normal/large/xl via `--ui-scale`), label shrink for long words |
| `public/` | `card_images.json` (card id → mulberry/openmoji SVG or emoji), `folders.json` (curated folder cards: path, label, icon, words, triggers, category_to_folder, card_folder), `cboard_folders.json` + `cboard_cards.json` (Cboard hierarchy for the browser), `questions.json` (top questions per place), `symbols/mulberry/` (1,230 SVG) + `symbols/openmoji/` (22), `ort/` (onnxruntime wasm), `aac/index.html` (static 84-cell grid demo page) |

Card identity: ids are `card_0000`-style from `model/vocab/vocab.csv`; `cards.json` on the CDN has
`speak`, `category` (vocab categories like food/actions/feelings/core/phrases…), `intent`, flags, and
`<folder:*>` rows. `categoryOf()` in `local.ts` collapses vocab categories to the four UI categories.

## Verification & Claude Code config (added 2026-09-20)
`npm run verify` at the root = `npm test` (backend vitest, `src/**/*.test.ts` only) → `web-client` `typecheck`
(`tsc --noEmit`, strict off) + `lint` (eslint 10 flat config, 0 errors / warnings allowed by design) + `test`
(vitest 3 — must stay v3 while Vite is v5) → `npm run e2e` (Playwright, Chromium, `playwright.config.ts`,
`e2e/*.e2e.ts` — the suffix matters, vitest would grab `.spec.ts`). E2E attaches to running dev servers
(`reuseExistingServer`) or boots them; `baseURL` is https when `web-client/.certs/` exists; the 520 MB model
download is stubbed (`holdModel()` routes `/model-cdn/**`), so the populated board is not covered — only the
loading state. `e2e/no-scroll.e2e.ts` asserts the no-scroll rule on 11 screens × 1180×820 / 1180×720 /
390×844. **Known violations are locked in its `KNOWN_OVERFLOW` table as `test.fail`**: `/setup`, `/stars`
(one unbounded column of past sessions), `/signup` at all sizes; `/credits` at 1180×720 and phone. Fixing one
makes its test fail with "expected to fail, but passed" — delete the entry then. Never add to that table to
silence a new regression. The smoke test creates and aborts a real session on the `guest` account.
`.github/workflows/verify.yml` runs `verify` on push to `main` and `workflow_dispatch` only (no schedules);
needs repo secrets `DATABASE_URL` (use a Neon branch, not prod) + `AUTH_SECRET`, else skips e2e with a notice.

`.claude/settings.json` (committed) wires hooks (`.claude/hooks/*.sh`, need `jq`): PostToolUse on
Edit/Write typechecks the package of any edited `.ts(x)` (web-client or root) and feeds errors back;
Stop runs the fast subset (no e2e) when the tree is dirty and keeps the turn going if red (fingerprint-cached,
honours `stop_hook_active`); PreToolUse blocks `git push` until the full `verify` passes. Skills (user-invoked
unless noted): `/verify` (drive it to green; model may invoke), `/ipad-check` (Claude in Chrome no-scroll +
screenshot pass at the three sizes), `/model-eval` (`model/eval` suite vs committed results), `/triage-reports`
(open `problem_report` rows → reproduce → proposed diff; never resolves or pushes). **No unattended
automation, ever**: no cron/routines/`/loop`/scheduled workflows — the user starts every run.

## Sub-project detail lives in `.claude/rules/` (path-scoped, loads itself when you read a matching file)
- `backend-api.md` (`src/**`, `admin/**`) — backend architecture, the full `/api/v1` route table, DB tables, admin pages.
- `ios.md` (`ios/**`) — SwiftUI port layout and scripts.
- `model-pipeline.md` (`model/**`, `site/**`, `docs/**`) — data → train → export → eval recipe, shipped model version, `docs/` index.
Open one directly when planning a task in that area before any file is read. Backend in one line: pure
storage + auth (Next.js route handlers over Neon; 30-day dyad JWT), no LLM in the loop except a
best-effort Gemini session title in `endSession`. `CONTEXT.md` = domain glossary.

## Conventions & workflow
- **Local dev servers:** whenever a session is going to touch `web-client/` or backend code, start
  *both* dev servers proactively (don't wait to be asked): `npm run dev` at repo root (backend,
  :3000) and `cd web-client && npm run dev` (:4200). Since `API_BASE` routes to `localhost:3000` in
  dev (see "Running locally"), the web app needs the backend for everything now, not just the
  on-device model — running only one half means logins and sessions fail outright.
- **Workflow per task:** plan mode → agree the acceptance check → build → hooks/`npm run verify` green →
  `/code-review` → push. Independent tasks can run in parallel with `claude --worktree <name>` or the Agent
  tool's `isolation: worktree` (worktrees live in `.claude/worktrees/`, git-ignored; they have no
  `node_modules`/`.env.local` — copy `.env.local` from the main checkout if a task needs the backend). Give
  each parallel agent a disjoint file set; merge branches into `main` and run `verify` before pushing.
- **Git:** at session start `git fetch origin main`; if behind, `git pull --rebase origin main` before
  changes. After committing something the user asked for, **push to `origin main` in the same turn**
  (no PR step exists). Never force-push. One-line commit messages. End commits with the attribution
  line the harness provides.
- **Style:** match surrounding code — the web-client is dense, comment-rich TypeScript with long lines
  and explanatory comments about *why*; keep that voice. Tailwind for styling. No new dependencies
  without a reason.
- **No scrolling, ever**, on any screen; test layout changes at iPad (1180×820, 1180×720 with Safari
  tabs) and phone sizes. Text sizes are already ~10% up in `tailwind.config.js`.
- **Docs:** when a conversation surfaces a core fact — a decision, a renamed/moved piece, a changed
  data source — add it here (or `CONTEXT.md` for domain vocabulary) in the same turn; delete stale
  statements rather than leaving them.
- Deploy = push. Vercel builds `web-client`, root (`aac`) and `admin` separately; Cloudflare Pages
  builds `site/`. **Vercel is on cslobster's Hobby plan, which only auto-builds commits authored by
  cslobster** — anyone else's push shows "Deployment was blocked". Workaround in place:
  `.github/workflows/deploy-hooks.yml` POSTs each project's Vercel Deploy Hook on pushes to `main` by
  other actors (hook URLs are the repo secrets `VERCEL_HOOK_WEB_CLIENT/AAC/ADMIN/AAC_BACKEND`; a missing secret is
  skipped). A `HTTP 201` from a hook only means Vercel *accepted* the trigger, not that the build
  reached production — verify against the actual deployed bundle, not the Action's checkmark. This
  repo's history is sometimes regenerated from outside (new hashes, same content) — on a "forced
  update", diff content before assuming a commit was lost. **Current deploy health is in `STATE.md`,
  not here** — it changes independently of anything in this file.
- `.env.local` is manual and cached at module load — restart the backend after editing.
- Gemini 404 → check `LLM_MODEL`/key tier; the title call is best-effort anyway.
- Neon HTTP driver: each `sql` call is a round trip (~75–100 ms warm); batch with `Promise.all`.
- R2 custom domain answers `HEAD` inconsistently — use small `GET`s to probe (`model.ts` does).
- `model.irisspeak.org`'s R2 bucket CORS policy only allows the `irisspeak.com` origin, so a direct
  browser fetch from `localhost` is blocked ("Failed to fetch", stuck on "Loading vocabulary…" forever).
  Dev builds route through Vite's `/model-cdn` proxy instead (`vite.config.ts` + `CDN_BASE` in
  `model.ts`), which sidesteps CORS since the browser only ever talks to the dev server. Don't "fix" this
  by trying to loosen the bucket's CORS policy — that's shared prod infra outside the repo.
- Web Speech dictation works on iOS Safari / Chrome / Edge; the mic button is hidden where unsupported.
- `window.__errs` (index.html) keeps the first runtime errors for diagnosing a blank screen on a device.
- Card-image coverage: `card_images.json` has 3,239 ids; 1,234 Mulberry SVGs, 14 OpenMoji, ~1,991
  emoji-only fallbacks (as of 2026-09-17). The CDN `cards.json` has 3,287 rows (3,238 cards + 47
  folder rows + specials), 342 dead rows masked.

## Keeping this file current
This file plus `STATE.md` are the orientation documents. Every session: read both, trust them,
work. If you change architecture, routes, tables, or file layout, or discover a wrong statement,
**update this file in the same commit** — keep it factual and compact, a route table, not prose,
and stable (it shouldn't need touching most sessions). Anything that changes session-to-session —
deploy status, what shipped recently, what's in flight — goes in `STATE.md` instead, updated the
same way. `CONTEXT.md` holds domain vocabulary; `docs/` holds long-form plans and research; memory
(`~/.claude/projects/…/memory/`) holds user preferences only, never project state.
