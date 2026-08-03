# iris_speak — Next.js backend for Iris Speak

Self-contained Next.js 14 backend that ports the FastAPI service:
- **Postgres (Neon)** for persistence
- **Gemini Flash Lite** via the OpenAI-compat endpoint
- **Cboard vocabulary** (738 words) — exact-match lookup, constrained directly in the LLM prompt
- **JWT** auth, mirroring the prior contract
- **OpenDyslexic** font + larger default text sizes on the web client for readability
- **Cboard folder browsing** in the child's card-search overlay, restored from the original Cboard hierarchy

## Run locally

```bash
npm install
npm run dev          # → http://localhost:3000
```

`.env.local` already contains the Gemini key, OpenAI embedding key, and Neon `DATABASE_URL`. Tables auto-create on first request.

## API

All routes live under `/api/v1/`:

| Method | Path | Purpose |
|---|---|---|
| `HEAD` | `/api/v1/ping` | health |
| `POST` | `/api/v1/dyad/account/login` | `{code}` → `{jwt, free_topics}` |
| `GET`  | `/api/v1/dyad/data/freetopics` | list dyad's favorites |
| `POST` | `/api/v1/dyad/session/new` | new conversation |
| `GET`  | `/api/v1/dyad/session/list` | session history |
| `POST` | `/api/v1/dyad/session/[id]/start` | static initial guides |
| `PUT`  | `/api/v1/dyad/session/[id]/end` | mark terminated |
| `DELETE` | `/api/v1/dyad/session/[id]/abort` | drop session |
| `GET`  | `/api/v1/dyad/session/[id]/message/all` | full transcript |
| `POST` | `/api/v1/dyad/session/[id]/message/parent/message/text` | parent → child cards |
| `POST` | `/api/v1/dyad/session/[id]/message/child/add_card` | tap a card → regen |
| `PUT`  | `/api/v1/dyad/session/[id]/message/child/refresh_cards` | force re-roll |
| `PUT`  | `/api/v1/dyad/session/[id]/message/child/pop_last_card` | undo |
| `POST` | `/api/v1/dyad/session/[id]/message/child/confirm_cards` | confirm → parent guides |

## Test login

`code = 12345` → seeded test dyad `Sammy / mother / English`.

## What's *not* ported (yet)

- Audio: parent voice → Whisper STT (Gemini compat doesn't expose audio anyway)
- Korean translation (DeepL)
- CLOVA Voice / Speech
- ~~Card-image PNG corpus retrieval~~ — done (exact Cboard vocab match → SVG image)
- `/parent/example` (parent example utterance) — easy to add when needed
- DialogueInspector background task — easy to add
