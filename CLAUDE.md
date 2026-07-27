# AACessTalk Backend

Next.js 14 API backend for an AAC (Augmentative and Alternative Communication) platform. Helps minimally-verbal people with autism (any age) communicate with caregivers via AI-generated card suggestions and parent guidance messages.

## Repo structure

This repo has two parts:
- **`/` (root)** — Next.js backend, API only, runs on `localhost:3000`
- **`/web-client/`** — React + Vite frontend, runs on `localhost:4200`

Both must be running simultaneously for the full app to work.

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

DB tables auto-create on first request. Test login code is `12345` (seeds a dyad: Sammy/girl/mother/en).

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

React 18 + Vite + Redux + Tailwind CSS + TypeScript. Calls `localhost:3000/api/v1` by default. JWT stored in `localStorage`. Key screens: sign-in, home (topic picker), session (main conversation UI), session-end (transcript), stars (history).

## Testing

```bash
npm test          # run all tests
npm run test:watch  # watch mode
```

Tests live in `src/__tests__/`. Uses Vitest with mocked DB and Gemini dependencies.

## Branch context

- `main` — stable branch
- `feature/new-vocab` — active development branch for new vocabulary features

## Keeping domain docs current

This repo has more than one contributor and no enforced process for keeping `CONTEXT.md` in sync with reality (vocabulary files, pipeline decisions, etc. have changed multiple times without doc updates). If you're a Claude Code session working in this repo and a conversation surfaces a core project fact — a decision, a domain concept, a changed data source — that isn't already reflected in `CONTEXT.md`, add it. If something already in `CONTEXT.md` turns out to be stale or wrong, correct or remove it rather than leaving it to mislead the next session (human or AI) that reads it.

## Known gotchas

- `.env.local` must be created manually — never committed
- Restart the backend after any `.env.local` change (env vars are cached at module load)
- `gemini-2.5-flash-lite` requires a specific API key tier — if you get 404 from Gemini, check the model name
- The Neon free tier pauses after inactivity — first DB query of a session may be slow (~1–2s)
- Both servers must be running simultaneously; CORS is configured for port 4200 only
