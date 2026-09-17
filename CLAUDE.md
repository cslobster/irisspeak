# IrisSpeak

Context-aware AAC. A minimally-verbal child (any age) communicates via picture cards; the card
suggestions and the sentence they turn into are produced **on the device** (irisspeak-135m: a
small fine-tuned card model + sentence realiser, exported to ONNX, run in-browser via
onnxruntime-web/onnxruntime-node). This replaced the original design, which called a cloud LLM
(Gemini) for both steps. The original per-turn LLM card-generation/sentence-inference code
(`generateChildCards`, `inferSentenceFromCards`, the `corpus.ts` vocab lookup, `web-client/legacy/`,
and the 9 API routes that backed them) was deleted 2026-09-17 — confirmed dead (nothing in the
shipped app, admin, or iOS called any of it). Gemini is still used for two small, live,
best-effort features: the session-title caption (`endSession`) and the static initial parent
guides lookup (`startSession`, no LLM — just a YAML read). See Architecture below.

## Repo structure (monorepo, single repo, single branch)

| Piece | Lives in | Deployed as |
|---|---|---|
| Web app (the product) | `web-client/` | irisspeak.com — Vercel project `web-client` |
| API + database | `src/` (Next.js app router, this dir) | aac-roan.vercel.app — Vercel project `aac` |
| Admin dashboard | `admin/` | admin.irisspeak.com — password-gated, talks to `/api/v1/admin/*` |
| iOS/iPadOS app | `ios/` | Xcode project `ios/irisspeak/irisspeak.xcodeproj` |
| Model pipeline | `model/` | training/export/eval scripts, run on Modal or locally; not served from here |
| Research site | `site/` | irisspeak.org — Cloudflare Pages, paper behind basic auth |
| Working notes/plans | `docs/` | not deployed |

Everything deploys on push to `main` (no other active branches). For backend/web-client work: both
must run locally. `admin/`, `ios/`, `model/`, `site/` are only needed when touching that piece.

## Running locally

```bash
# Backend (from root) — accounts, DB, history, vocabulary, admin, session lifecycle
npm install
npm run dev        # → localhost:3000

# Web app (separate terminal) — the on-device product
cd web-client
npm install
npm run dev        # → localhost:4200

# Admin (optional, separate terminal)
cd admin
npm install
npm run dev        # → localhost:4201
```

**Required `.env.local`** (root only, never committed):
```
DATABASE_URL=            # Neon PostgreSQL connection string
AUTH_SECRET=              # random string for JWT signing
GEMINI_API_KEY=           # session-title captioning (endSession) — best-effort, app works without it
OPENAI_BASE_URL=          # optional, defaults to Google's Gemini OpenAI-compat endpoint
LLM_MODEL=                # optional, defaults to gemini-2.5-flash-lite
OPENROUTER_API_KEY=       # optional alternate LLM route for the same session-title call
GOOGLE_CLIENT_ID=         # Google sign-in (web-client + iOS)
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
ADMIN_PASSWORD=           # gates /api/v1/admin/*
```

DB tables auto-create on first request. Test login code is `12345`. CORS on `/api/*` is currently
open (`Access-Control-Allow-Origin: *`, set in `next.config.js`), not restricted to :4200.

## Architecture

**On-device path (the product, `web-client/` + `web-client/src/engine/`):**
```
Card model (ONNX) predicts next-card ranking on-device → child taps cards
Realiser (ONNX) turns the tapped cards into a sentence on-device → spoken via TTS
Backend (src/) only stores what happened: accounts, profile, custom words, session/turn
mirrors (POST .../device/turn), analytics — it does not generate cards or sentences for this path.
```
Model weights (~520MB) are served from Cloudflare R2 (`model.irisspeak.org`, zero egress),
cached in the browser's Cache Storage after first load. See `docs/PLAN-RETRAIN.md` for the
training/export/eval pipeline and `web-client/src/engine/model.ts` for the runtime loader.

**Backend (`src/lib/moderator.ts`) — session lifecycle only, no per-turn LLM calls:**
```
startSession → static initial parent guides (data/initial_parent_guides.yml, no LLM)
endSession   → best-effort AI session title (Gemini), failure never blocks ending the session
abortSession → deletes the session row
```
`gemini.ts` (`chat()`) and `prompts.ts` (`dialogueToXml`, `buildSessionTitlePrompt`) exist only to
support `endSession`'s title. `staticData.ts` exists only to support `startSession`'s guide lookup
— its `DATA_DIR` is root `data/` (not `model/data/`; that's the training pipeline's own working
directory, not a runtime dependency of the deployed backend). `data/` currently holds exactly the
one file the live backend needs, restored 2026-09-17 after a repo reorg had deleted it (see below).

**Deleted 2026-09-17 (confirmed dead — nothing in `web-client/`, `admin/`, or `ios/` called any of
it):** the original per-turn cloud-LLM child-card-generation/sentence-inference flow —
`web-client/legacy/`, `src/lib/corpus.ts`, the `generateChildCards`/`refreshChildCards`/
`addChildCard`/`confirmChildCardSelection`/`finishChildTurn`/`inferSentenceFromCards`/
`requestParentExample` functions in `moderator.ts`, their prompt builders in `prompts.ts`, and the
9 API routes that exposed them (`session/[id]/message/parent/message/text`,
`message/parent/example`, and all 7 `message/child/*` routes: `add_card`, `add_free_card`,
`confirm_cards`, `finish_turn`, `infer_sentence`, `pop_last_card`, `refresh_cards`). Their tests
went with them. If this flow is ever needed for reference, it's in git history before this
commit; `CONTEXT.md`'s glossary (Corpus, Folder Card, Personalization, etc.) still documents the
domain reasoning behind it.

**Why this was safe:** the repo reorg (`1ff8f9e`, "Reorganise the repository", 2026-09-15) moved
`data/` → `model/data/` without updating `corpus.ts`'s/`staticData.ts`'s hardcoded
`path.join(process.cwd(), 'data')`, so the whole legacy flow (plus `startSession`'s guide lookup)
had been throwing `ENOENT` in every environment, including production, since that commit. Nothing
depended on the legacy flow working, so deleting it was strictly cleanup; `startSession` needed an
actual fix (restoring `data/initial_parent_guides.yml`), not just deletion.

**Backend API:** all live routes are under `/api/v1/dyad/*` and `/api/v1/admin/*`. See
`docs/API-BACKEND.md` for the route table (written before the 2026-09 reorg and cleanup — verify
against `src/app/api/v1/**/route.ts` if precision matters; it hasn't been rewritten yet).

## Testing

```bash
npm test          # run all tests (root backend only)
npm run test:watch
```

Tests live in `src/__tests__/`. One file (`sessionLifecycle.test.ts`), covering `startSession`/
`endSession`/`abortSession` with mocked DB/Gemini — the 8 legacy test files were deleted alongside
the code they tested. This is much thinner coverage than before; the surface it doesn't cover
(card generation, sentence inference, etc.) no longer exists, but if session-lifecycle behavior
grows again, grow the tests with it.

## Git workflow

- **At the start of every new session**, before doing any work: `git fetch origin main`, then check whether local `main` is behind (`git log --oneline HEAD..origin/main`). If it is, pull/rebase it in before making changes, so work never starts from a stale base. If local `main` has unpushed commits of its own, prefer `git pull --rebase origin main` over a merge to keep history linear (this repo doesn't use `--no-verify`/force-push shortcuts — see the Git Safety Protocol in your system instructions).
- **After committing a change the user asked for**, push it to `origin main` in the same turn rather than leaving it local — don't wait for a separate explicit "push it" each time. This repo has no other active branches, so there's no PR review step being skipped by pushing straight to `main`.
- If a push is rejected (remote has commits you don't), fetch and compare — don't force-push. If the trees are actually identical (e.g. a revert netted back to the same content), a plain rebase resolves it with no real conflict; if they differ, read what changed before merging.

## Keeping domain docs current

This repo has more than one contributor and no enforced process for keeping `CONTEXT.md` (or this
file) in sync with reality — the whole product architecture changed (cloud LLM → on-device model,
repo reorganized into a monorepo with `model/`/`ios/`/`site/`) without either doc being updated
until this pass. If you're a Claude Code session working in this repo and a conversation surfaces
a core project fact — a decision, a domain concept, a changed data source, a renamed/moved piece —
that isn't already reflected in `CONTEXT.md` or here, add it. If something already documented
turns out to be stale or wrong, correct or remove it rather than leaving it to mislead the next
session (human or AI) that reads it.

## Known gotchas

- `.env.local` must be created manually — never committed
- Restart the backend after any `.env.local` change (env vars are cached at module load)
- `gemini-2.5-flash-lite` requires a specific API key tier — if you get 404 from Gemini, check the model name
- The Neon free tier pauses after inactivity — first DB query of a session may be slow (~1–2s)
- `data/` (root) holds exactly one file, `initial_parent_guides.yml` — don't add training-pipeline
  data back into it; that belongs in `model/data/`, which the deployed backend never reads
