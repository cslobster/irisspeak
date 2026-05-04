# ai_aactalk — Next.js backend for AACessTalk

Self-contained Next.js 14 backend that ports the FastAPI service:
- **Postgres (Neon)** for persistence
- **Gemini Flash Lite** via the OpenAI-compat endpoint
- **MiniLM-L6 (`@xenova/transformers`)** local corpus retrieval against 6,658 cards
- **JWT** auth, mirroring the prior contract

## Run locally

```bash
cd /Users/haobo/work3/ai_aactalk
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
- Card-image PNG corpus retrieval (still missing the image zip)
- Admin console
- `/parent/example` (parent example utterance) — easy to add when needed
- DialogueInspector background task — easy to add
