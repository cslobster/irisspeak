# AACessTalk Backend

Next.js 14 API backend for an AAC (Augmentative and Alternative Communication) platform. Helps minimally-verbal autistic children (ages 5–7) communicate with caregivers via AI-generated card suggestions and parent guidance messages.

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
| `corpus.ts` | Local semantic search (6,658 vocab items, MiniLM-L6-v2) |
| `db.ts` | Neon Postgres — lazy schema init, tagged-template SQL |
| `prompts.ts` | LLM prompt builders |
| `staticData.ts` | YAML loaders (core cards, emotion cards, initial guides) |
| `auth.ts` | JWT issuance and verification |
| `types.ts` | All TypeScript interfaces |

**15 API endpoints** under `/api/v1/dyad/` covering: auth, session lifecycle, parent messages, child card taps/confirms/undos, and parent example utterances.

**Data files (`/data/`):** CSV vocabulary corpus (2.3 MB), pre-computed MiniLM float32 embeddings (9.8 MB), YAML card/guide definitions.

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

## Known gotchas

- `.env.local` must be created manually — never committed
- Restart the backend after any `.env.local` change (env vars are cached at module load)
- `gemini-2.5-flash-lite` requires a specific API key tier — if you get 404 from Gemini, check the model name
- The Neon free tier pauses after inactivity — first DB query of a session may be slow (~1–2s)
- Both servers must be running simultaneously; CORS is configured for port 4200 only
