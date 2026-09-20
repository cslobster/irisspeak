---
paths:
  - "src/**"
  - "admin/**"
---
# Backend API + admin — loaded when a task touches `src/**` or `admin/**` (moved out of CLAUDE.md 2026-09-20; keep it current the same way)

## Architecture — backend (`src/`)

Pure storage + auth. `src/lib/moderator.ts` has only the session lifecycle: `startSession` (static
parent guides inlined in `src/lib/staticData.ts`, no LLM), `endSession` (best-effort Gemini
session title via `gemini.ts` + `prompts.ts`; failure never blocks), `abortSession` (deletes row).
`google.ts` = server-side OAuth code flow (GCP project "irisspeak"); the callback finds/links/creates a
dyad and redirects back with a dyad JWT in the URL fragment. `auth.ts` = 30-day dyad JWT (`sub` =
dyad id) and 24-h admin JWT. `responses.ts` = tiny JSON helpers. `text.ts` = `capitalizeName`.

### Routes (all `src/app/api/v1/**/route.ts`, `force-dynamic`, nodejs runtime) — verified 2026-09-17
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/HEAD | `/ping` | — | health |
| POST | `/dyad/account/login` | — | `{username, password}` (alias-or-parent-email + login code) → `{jwt, free_topics, child_name, alias}`; pending accounts get `AccountPendingApproval` |
| POST | `/dyad/account/signup` | — | self-serve wizard → dyad in `pending` status, login code stored inactive until admin approves |
| POST | `/dyad/account/password` | dyad | `{login_code}` → sets/replaces this account's login code, so a Google-only account (random alias, no code) can also sign in with parent email + this code. Never touches the real Google password — a separate app credential, added 2026-09-19 |
| GET | `/dyad/account/google/start?redirect=` | — | → Google consent (allowed redirects: irisspeak.com/.org, *.vercel.app, *.pages.dev, localhost, `irisspeak:` scheme) |
| GET | `/dyad/account/google/callback` | — | Google returns here → `redirect#jwt=…&alias=…&child_name=…[&new=1]` or `#error=…` |
| GET/PATCH | `/dyad/profile` | dyad | age, notes, communication_style, setting, child_name, child_gender, alias, parent_email, has_password |
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
| POST/GET | `/dyad/report` | dyad | "Report a problem": `{description, screenshot? base64, session_id?, context?}` → `problem_report` row; GET returns the family's own reports (no screenshot) |
| POST | `/dyad/event` | dyad | UI tap analytics (`screen, element, event_type, metadata`) |
| POST | `/admin/auth/login` | — | `{password}` → admin JWT |
| GET/POST | `/admin/dyads`, PATCH/DELETE `/admin/dyads/[id]` | admin | list/create/edit/delete accounts (+ set login code) |
| POST | `/admin/dyads/[id]/approve` | admin | activate a pending signup (activates the code the parent chose, or `{login_code}` override) |
| GET | `/admin/dyads/[id]/transcripts`, `/admin/dyads/[id]/vocabulary`, `/admin/dyads/[id]/reports` | admin | per-user transcripts / custom words / problem reports (reports include the screenshot) |
| GET | `/admin/stats` | admin | per-dyad session/turn/message counts |
| GET | `/admin/analytics?view=summary|by_user|dau&days=N` | admin | tap-event analytics; DAU via `generate_series` (date column comes back as full ISO timestamp — slice 10 chars) |
| GET | `/admin/feedback[?format=jsonl]` | admin | all board feedback; JSONL form is training input for `model/data/build_states.py` |
| GET | `/admin/reports[?status=open|resolved]` | admin | all problem reports, newest first, screenshot omitted (fetch by id for that) |
| GET/PATCH | `/admin/reports/[id]` | admin | one report's full detail (screenshot included) / set `{status: 'open'|'resolved'}` |

### Database tables (`src/lib/db.ts`, Neon, auto-migrated)
`dyad` (account = parent–child pair: alias, child_name, child_gender, locale, age, notes,
communication_style, parent_email, status pending|active, setting, google_sub, google_email) ·
`dyad_login_code` (code, dyad_id, active) · `free_topic` · `dyad_custom_word` · `session` (topic_category,
status initial|started|conversation|terminated, num_turns, rating, title, client) · `dialogue_turn`
(role, inferred_sentence) · `dialogue_message` (content_type text|cards, content JSONB) ·
`child_card_recommendation` (the board shown, + legacy `pool`) · `parent_guide_recommendation` ·
`interim_card_selection` · `user_event` · `board_feedback` · `problem_report` (id, dyad_id,
session_id, description, screenshot_data base64, context JSONB, status open|resolved, added
2026-09-19 for the web-client's "Report a problem" button).

## Admin (`admin/`)
Four pages in `Dashboard.tsx`: **Users** (`ConversationsView` → `TranscriptPanel`, `UserModal`,
`DyadVocabularyPanel`, `DyadReportsPanel`), **Pending Signups** (`PendingSignupsTab`, approve
button), **Reports** (`ReportsView` — global list + detail modal, filter by open/resolved, mark
resolved; screenshot+context are per-account/per-report only, never in the list response), **Stats
& Analytics** (`AdvancedView` → `StatsTab`, `AnalyticsTab`, `DauChart`). Token in localStorage
`aac_admin_token`. Board feedback (the model's card-choice feedback, `board_feedback`) is still only
reachable via the API (`/admin/feedback`) — there is no admin UI for it, unlike problem reports.

