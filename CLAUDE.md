# Iris Speak Backend

Next.js 14 API backend for an AAC (Augmentative and Alternative Communication) platform. Helps minimally-verbal people with autism (any age) communicate with caregivers via AI-generated card suggestions and parent guidance messages.

## Repo structure

This repo has three parts:
- **`/` (root)** — Next.js backend, API only, runs on `localhost:3000`
- **`/web-client/`** — React + Vite child/parent-facing frontend, runs on `localhost:4200`
- **`/admin/`** — React + Vite admin dashboard, runs on `localhost:4201`. Password-gated (`/api/v1/admin/auth/login`), talks to the same backend's `/api/v1/admin/*` routes. Already has: dyad list/create/update/delete (`Dashboard.tsx`, `UserModal.tsx`), stats, analytics, session transcripts (`TranscriptPanel.tsx`, `ConversationsView.tsx`). ~1000 lines total as of 2026-07-31 — small enough to read in full before extending.

Backend + web-client must both run for the main app to work; `/admin` is optional unless you're doing admin-facing work.

## Running locally

```bash
# Backend (from root)
npm install
npm run dev        # → localhost:3000

# Frontend (separate terminal)
cd web-client
npm install
npm run dev        # → localhost:4200
```

**Required `.env.local`** (root only, never committed):
```
DATABASE_URL=       # Neon PostgreSQL connection string
GEMINI_API_KEY=     # Google AI Studio key (aistudio.google.com)
AUTH_SECRET=        # Random string for JWT signing
```

DB tables auto-create on first request. Test login code is `12345` (seeds a dyad: Sammy/girl/en).

## Architecture

**Core conversation flow:**
```
Parent sends text → LLM generates child response cards
Child taps cards  → LLM generates parent guidance messages
```

**Key backend files (`src/lib/`):**

| File | Role |
|------|------|
| `moderator.ts` | Orchestration — all turn logic (464 lines) |
| `gemini.ts` | LLM client (OpenAI SDK → Google Gemini endpoint) |
| `corpus.ts` | Local semantic search (vocab count varies — verify `data/corpus_vocabulary.csv` directly; see `CONTEXT.md`) |
| `db.ts` | Neon Postgres — lazy schema init, tagged-template SQL |
| `prompts.ts` | LLM prompt builders |
| `staticData.ts` | YAML loaders (core cards, emotion cards, initial guides) |
| `auth.ts` | JWT issuance and verification |
| `types.ts` | All TypeScript interfaces |

**15 API endpoints** under `/api/v1/dyad/` covering: auth, session lifecycle, parent messages, child card taps/confirms/undos, and parent example utterances.

**Data files (`/data/`):** CSV vocabulary corpus (`corpus_vocabulary.csv` — row count and columns change as the vocabulary source is swapped; verify the live file, don't assume a fixed size), pre-computed MiniLM float32 embeddings (`.bin` + `.meta.json`), YAML card/guide definitions. The corpus-expansion pipeline (ARASAAC fetch → dedupe → LLM reclassify → re-embed) is being ported from a Colab notebook into a repo-native script — see `CONTEXT.md` and update this note once that lands.

## LLM configuration

Uses the OpenAI SDK pointed at Google's OpenAI-compatible endpoint:
- `OPENAI_BASE_URL` defaults to `https://generativelanguage.googleapis.com/v1beta/openai/`
- `LLM_MODEL` defaults to `gemini-2.5-flash-lite`
- LLM endpoints have a 60s timeout

## Frontend (`web-client/`)

React 18 + Vite + Redux + Tailwind CSS + TypeScript. Calls `localhost:3000/api/v1` by default. JWT stored in `localStorage`. Key screens: sign-in, home (`WelcomeScreen` — a single "Start a conversation" button, hardcodes every session to `topic.category: 'plan'`, no topic picker shown), session (main conversation UI), session-end (transcript), stars (history). `HomeScreen.tsx`/`FreeTopicScreen.tsx`/`TopicButton.tsx` still exist in the repo but aren't wired into `App.tsx`'s router — dead code, not reachable from the live app. `recall`/`free` topic categories are still supported by the backend and `TopicCategory` type but have no current UI path to reach them.

## Testing

```bash
npm test          # run all tests
npm run test:watch  # watch mode
```

Tests live in `src/__tests__/`. Uses Vitest with mocked DB and Gemini dependencies.

## Branch context

- `main` — stable branch, and the only active branch as of 2026-08-01. `feature/new-vocab`
  (previously documented here as the vocabulary-work branch) was deleted — it had zero commits
  ahead of `main` and nothing unique in it; all vocabulary/personalization work now lands
  directly on `main`.

## Git workflow

- **At the start of every new session**, before doing any work: `git fetch origin main`, then check whether local `main` is behind (`git log --oneline HEAD..origin/main`). If it is, pull/rebase it in before making changes, so work never starts from a stale base. If local `main` has unpushed commits of its own, prefer `git pull --rebase origin main` over a merge to keep history linear (this repo doesn't use `--no-verify`/force-push shortcuts — see the Git Safety Protocol in your system instructions).
- **After committing a change the user asked for**, push it to `origin main` in the same turn rather than leaving it local — don't wait for a separate explicit "push it" each time. This repo has no other active branches (see Branch context below), so there's no PR review step being skipped by pushing straight to `main`.
- If a push is rejected (remote has commits you don't), fetch and compare — don't force-push. If the trees are actually identical (e.g. a revert netted back to the same content), a plain rebase resolves it with no real conflict; if they differ, read what changed before merging.

## Keeping domain docs current

This repo has more than one contributor and no enforced process for keeping `CONTEXT.md` in sync with reality (vocabulary files, pipeline decisions, etc. have changed multiple times without doc updates). If you're a Claude Code session working in this repo and a conversation surfaces a core project fact — a decision, a domain concept, a changed data source — that isn't already reflected in `CONTEXT.md`, add it. If something already in `CONTEXT.md` turns out to be stale or wrong, correct or remove it rather than leaving it to mislead the next session (human or AI) that reads it.

## Known gotchas

- `.env.local` must be created manually — never committed
- Restart the backend after any `.env.local` change (env vars are cached at module load)
- `gemini-2.5-flash-lite` requires a specific API key tier — if you get 404 from Gemini, check the model name
- The Neon free tier pauses after inactivity — first DB query of a session may be slow (~1–2s)
- Both servers must be running simultaneously; CORS is configured for port 4200 only
