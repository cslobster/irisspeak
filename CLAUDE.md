# IrisSpeak — project orientation for Claude Code

**Read this file first, then start working. Do not re-scan the repo to "get situated" — everything
a session needs to orient is here, verified against the code on 2026-09-17.** Only open files that the
task actually touches. If you find something here is wrong or missing, fix this file in the same turn
(see "Keeping this file current" at the bottom).

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

## Repo map (monorepo, one branch `main`, everything deploys on push)

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
| `data/` | root | read by the backend at runtime | exactly one file: `initial_parent_guides.yml` |
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
# Tests (backend only)
npm test            # vitest, src/__tests__/sessionLifecycle.test.ts
```

**Gotcha — the web app does NOT talk to the local backend.** `web-client/src/api/remote.ts` hardcodes
`API_BASE = 'https://aac-roan.vercel.app/api/v1'` (production). The Vite `/api` proxy in
`vite.config.ts` is vestigial. To exercise local backend changes from the web app, point `API_BASE`
at `http://localhost:3000/api/v1` temporarily (don't commit it). iOS also hardcodes the prod URL
(`ios/.../Engine/RemoteApi.swift`).

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
("Continue as Guest" button). Neon free tier sleeps → first query of a session takes 1–2 s.
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
       → fixed quick row: yes / no / please + 5 personal cards (engine.personalRow: history+profile+custom words)
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
```

Board sizes: `PANEL_BIG` 15/3/3 (Topic 5×3, Action 3, Feeling 3) on iPad/desktop; phones use
`CompactSession.tsx` (12/3/3 grid, no scrolling). `SessionScreen.tsx` lays out on a fixed design
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
| `src/screens/SessionScreen.tsx` (966 lines) | the board + parent turn + sentence approval; `CompactSession.tsx` phone variant |
| `src/components/` | `CardChip` (tile, long-press), `CardSearchOverlay` (Cboard folder browser + search), `AskPanel` (place + top questions from `public/questions.json` + mic/text), `SessionMenu` (☰: transcript, sound, place, text size, history, profile, end), `SettingsButton`/`SettingsCloseButton` (fixed top-right, `settingsNav.ts` handles return-to), `Transcript`, `TurnBanner`, `VoicePicker`, `MuteButton`, `Spinner`, `Icons` |
| `src/audio/` | `tts.ts` (Web Speech synthesis, girl/boy voice, mute), `webspeech.ts` (dictation) |
| `src/uiScale.ts`, `src/labelSize.ts` | text-size setting (normal/large/xl via `--ui-scale`), label shrink for long words |
| `public/` | `card_images.json` (card id → mulberry/openmoji SVG or emoji), `folders.json` (curated folder cards: path, label, icon, words, triggers, category_to_folder, card_folder), `cboard_folders.json` + `cboard_cards.json` (Cboard hierarchy for the browser), `questions.json` (top questions per place), `symbols/mulberry/` (1,230 SVG) + `symbols/openmoji/` (22), `ort/` (onnxruntime wasm), `aac/index.html` (static 84-cell grid demo page) |

Card identity: ids are `card_0000`-style from `model/vocab/vocab.csv`; `cards.json` on the CDN has
`speak`, `category` (vocab categories like food/actions/feelings/core/phrases…), `intent`, flags, and
`<folder:*>` rows. `categoryOf()` in `local.ts` collapses vocab categories to the four UI categories.

## Architecture — backend (`src/`)

Pure storage + auth. `src/lib/moderator.ts` has only the session lifecycle: `startSession` (static
parent guides from `data/initial_parent_guides.yml`, no LLM), `endSession` (best-effort Gemini
session title via `gemini.ts` + `prompts.ts`; failure never blocks), `abortSession` (deletes row).
`google.ts` = server-side OAuth code flow (GCP project "irisspeak"); the callback finds/links/creates a
dyad and redirects back with a dyad JWT in the URL fragment. `auth.ts` = 30-day dyad JWT (`sub` =
dyad id) and 24-h admin JWT. `responses.ts` = tiny JSON helpers. `text.ts` = `capitalizeName`.

### Routes (all `src/app/api/v1/**/route.ts`, `force-dynamic`, nodejs runtime) — verified 2026-09-17
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/HEAD | `/ping` | — | health |
| POST | `/dyad/account/login` | — | `{username, password}` (alias + login code) → `{jwt, free_topics, child_name, alias}`; pending accounts get `AccountPendingApproval` |
| POST | `/dyad/account/signup` | — | self-serve wizard → dyad in `pending` status, login code stored inactive until admin approves |
| GET | `/dyad/account/google/start?redirect=` | — | → Google consent (allowed redirects: irisspeak.com/.org, *.vercel.app, *.pages.dev, localhost, `irisspeak:` scheme) |
| GET | `/dyad/account/google/callback` | — | Google returns here → `redirect#jwt=…&alias=…&child_name=…[&new=1]` or `#error=…` |
| GET/PATCH | `/dyad/profile` | dyad | age, notes, communication_style, setting, child_name, child_gender, alias |
| GET | `/dyad/history?limit=50` | dyad | the child's confirmed card turns across devices (`{partner, answer, cards, labels, t, session_id}`) — feeds the personal row |
| GET/POST | `/dyad/vocabulary`, DELETE `/dyad/vocabulary/[id]` | dyad | Custom Vocabulary Words (`word, category topic|action, is_preference_pointer, image_data base64, emoji`) |
| GET | `/dyad/data/freetopics` | dyad | legacy favourites list (seeded Bluey/Dinosaurs/Lego); UI no longer shows them |
| POST | `/dyad/session/new` | dyad | `{topic:{category}, timezone, client}` → session id (JSON string) |
| GET | `/dyad/session/list` | dyad | all sessions |
| POST | `/dyad/session/[id]/start` | dyad | marks started, returns static parent guides |
| POST | `/dyad/session/[id]/device/turn` | dyad | **the mirror the app writes**: `{role:'parent', text}` or `{role:'child', cards, sentence, shown}` → `{turn_id}` |
| GET | `/dyad/session/[id]/message/all` | dyad | transcript (`content_localized` = realised sentence for card turns) |
| GET | `/dyad/session/[id]/info` | dyad | session row |
| PUT | `/dyad/session/[id]/end` | dyad | terminate (+ AI title) |
| PUT | `/dyad/session/[id]/rating` | dyad | 1–5 stars |
| DELETE | `/dyad/session/[id]/abort` | dyad | delete |
| POST/GET | `/dyad/feedback` | dyad | board feedback (`choice: 'dislike'|'own_answer'`, `disliked[]`, `answer`, `candidates`, `prefix`, `model_version`) |
| POST | `/dyad/event` | dyad | UI tap analytics (`screen, element, event_type, metadata`) |
| POST | `/admin/auth/login` | — | `{password}` → admin JWT |
| GET/POST | `/admin/dyads`, PATCH/DELETE `/admin/dyads/[id]` | admin | list/create/edit/delete accounts (+ set login code) |
| POST | `/admin/dyads/[id]/approve` | admin | activate a pending signup (activates the code the parent chose, or `{login_code}` override) |
| GET | `/admin/dyads/[id]/transcripts`, `/admin/dyads/[id]/vocabulary` | admin | per-user transcripts / custom words |
| GET | `/admin/stats` | admin | per-dyad session/turn/message counts |
| GET | `/admin/analytics?view=summary|by_user|dau&days=N` | admin | tap-event analytics; DAU via `generate_series` (date column comes back as full ISO timestamp — slice 10 chars) |
| GET | `/admin/feedback[?format=jsonl]` | admin | all board feedback; JSONL form is training input for `model/data/build_states.py` |

### Database tables (`src/lib/db.ts`, Neon, auto-migrated)
`dyad` (account = parent–child pair: alias, child_name, child_gender, locale, age, notes,
communication_style, parent_email, status pending|active, setting, google_sub, google_email) ·
`dyad_login_code` (code, dyad_id, active) · `free_topic` · `dyad_custom_word` · `session` (topic_category,
status initial|started|conversation|terminated, num_turns, rating, title, client) · `dialogue_turn`
(role, inferred_sentence) · `dialogue_message` (content_type text|cards, content JSONB) ·
`child_card_recommendation` (the board shown, + legacy `pool`) · `parent_guide_recommendation` ·
`interim_card_selection` · `user_event` · `board_feedback`.

## Admin (`admin/`)
Three pages in `Dashboard.tsx`: **Users** (`ConversationsView` → `TranscriptPanel`, `UserModal`,
`DyadVocabularyPanel`), **Pending Signups** (`PendingSignupsTab`, approve button), **Stats &
Analytics** (`AdvancedView` → `StatsTab`, `AnalyticsTab`, `DauChart`). Token in
localStorage `aac_admin_token`. Board feedback is only reachable via the API (`/admin/feedback`),
there is no admin UI for it yet.

## iOS (`ios/`)
SwiftUI port with the same screens (`UI/Screens/*`), engine (`Engine/`: BPE + WordPiece tokenizers,
ONNX/Core ML card model, `Realiser.swift`, `LocalApi.swift`, `RemoteApi.swift` → same backend), TTS +
speech recognition, and an experimental gaze controller (`Gaze/`). Model files are fetched by
`scripts/fetch_models.sh` into `Resources/Model/` (git-ignored). `scripts/deploy_ipad.sh` builds and
installs on the paired iPad. `IRIS_SELFTEST=1` runs a scripted self-test with screenshots.

## Model pipeline (`model/`) — only read when working on the model
```
model/vocab/   vocab.csv (3,238 cards, append-only ids; build_vocab.py, folders v2), README.md explains the curation
model/data/    ingest/map corpora → build_states.py (soft targets, 16 folder rows, choice augmentation) → distill_cards.py
               (teacher-distribution distillation, see docs/DISTILLATION.md); raw/mapped/states dirs are git-ignored (licence)
model/train/   train_smollm.py (card model), train_realiser.py, modal_train.py (Modal GPU)
model/export/  export_onnx_optimum.py (+ --mask), export_realiser.py, quantize_check.py (parity), Core ML variants for iOS
model/eval/    board_eval.py, judge_boards.py (blind LLM judge "could a child answer with these cards?"), reranker_e2e.py,
               setting_eval.py, results JSON committed
site/          chunk_model.py → upload_model.sh (MODEL_DIR=…) → R2; build_results.py / gen_charts.py for the paper pages
```
Shipped card model = **v7** (history-aware distillation, 2026-09-15; judged better than v5 in every
condition). The reranker + MiniLM path is retained but off by default (ablation showed the distilled
model doesn't need it). Realiser is a separate SmolLM2-135M fine-tune. Full recipes and status logs:
`docs/PLAN-RETRAIN.md`, `docs/DISTILLATION.md`, `docs/BOARD-EVAL.md`.

## docs/ index (read only what the task needs)
`PLAN-RETRAIN.md` v3 retrain + folder-row design · `DISTILLATION.md` teacher distillation & v7 ·
`BOARD-EVAL.md` evaluation method/results · `QUESTION-BANK.md` how `questions.json` was mined ·
`PLAN-DATA-TRAINING.md`, `PLAN-EXPERIMENTS.md`, `PLAN.md` earlier plans · `PLAN-MERGE.md` how
irisspeak.org became irisspeak.com · `IRIS-SPEAK-V2-DESIGN.md` v2 design · `FOLDER-RESEARCH.md`,
`CARD-DISPLAY-RESEARCH.md`, `CONTEXT-PICKER-RESEARCH.md`, `COMPETITIVE-ANALYSIS.md` research ·
`prd-corpus-expansion.md`, `prd-personalization-core.md` PRDs from the cloud-LLM era (partly
superseded; custom words/profile/history personalisation are built) · `API-BACKEND.md` points here ·
`proposal.html`, `system.svg` diagrams. `CONTEXT.md` = domain glossary for the current on-device design.

## History you need to know (so you don't rediscover it)
- Originally "AACessTalk": a cloud-LLM (Gemini) product where the backend generated cards and
  sentences per turn. Replaced 2026-09-15 by the on-device model (`11148dd`, `1ff8f9e` repo reorg,
  `d67e184` brought model/ios/site into this repo). The dead cloud-LLM child-turn code (9 API routes,
  `corpus.ts`, `web-client/legacy/`, prompt builders, their tests) was deleted 2026-09-17 (`23a73ec`).
  It's in git history if ever needed; don't resurrect it by accident.
- The reorg moved `data/` → `model/data/` which broke `startSession`'s YAML read (`ENOENT` in prod);
  fixed by restoring root `data/initial_parent_guides.yml`. Don't add pipeline data back into root `data/`.
- 2026-09-16/17: board redesign — quick row (yes/no/please + 5 personal cards + More ideas + View all),
  Topic 15 / Action 3 / Feeling 3, Feedback button, iPad short-landscape side column, settings-nav fixes.

## Conventions & workflow
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
- Deploy = push. Vercel builds `web-client` and root separately; Cloudflare Pages builds `site/`.
  Model weights are published separately with `site/upload_model.sh` (never via git).

## Known gotchas
- `.env.local` is manual and cached at module load — restart the backend after editing.
- Gemini 404 → check `LLM_MODEL`/key tier; the title call is best-effort anyway.
- Neon HTTP driver: each `sql` call is a round trip (~75–100 ms warm); batch with `Promise.all`.
- R2 custom domain answers `HEAD` inconsistently — use small `GET`s to probe (`model.ts` does).
- Web Speech dictation works on iOS Safari / Chrome / Edge; the mic button is hidden where unsupported.
- `window.__errs` (index.html) keeps the first runtime errors for diagnosing a blank screen on a device.
- Card-image coverage: `card_images.json` has 3,239 ids; 1,234 Mulberry SVGs, 14 OpenMoji, ~1,991
  emoji-only fallbacks (as of 2026-09-17). The CDN `cards.json` has 3,287 rows (3,238 cards + 47
  folder rows + specials), 342 dead rows masked.

## Keeping this file current
This is the single orientation document. Every session: read it, trust it, work. If you change
architecture, routes, tables, file layout, deploy targets, or discover a wrong statement, **update
this file in the same commit**. Keep it factual and compact — a route table, not prose; no
history beyond what prevents a mistake. `CONTEXT.md` holds domain vocabulary; `docs/` holds long-form
plans and research; memory (`~/.claude/projects/…/memory/`) holds user preferences only.
