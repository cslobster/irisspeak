# AACessTalk — Domain Context

## Glossary

### Corpus
The local vocabulary database used for semantic search. A CSV file (`data/corpus_vocabulary.csv`) loaded at startup by `corpus.ts`, with MiniLM-L6-v2 embeddings pre-computed in `data/minilm_name_embeddings.bin`.

The corpus is a **label canonicalizer**: the LLM generates a word, the corpus finds the closest match, and `corpus_name` is what the child actually sees on the card and hears via TTS.

**Current state (verified 2026-07-27):** the file has been swapped out multiple times during development and is presently the 738-row Mulberry set (see Mulberry Symbol Set) — a smaller, real-AAC-pictogram set added by a collaborator specifically to test how cards look with real images, not a permanent vocabulary decision. An earlier ~2,000-word corpus (Dale-Chall word list) existed at one point but is gone and not coming back — it's noted here only as history. The corpus file can change without this doc being updated (the project has more than one contributor and there's no guaranteed process for keeping this in sync) — **treat this section as a starting hypothesis and verify the live file before relying on a specific row count or column set.** The standing target for growing this corpus is the ARASAAC pictogram expansion (see ARASAAC / Vocabulary Expansion), not a return to Dale-Chall.

### Corpus Entry
A single row in `corpus_vocabulary.csv` — **columns vary by whichever vocabulary set is currently loaded; verify against the live file rather than assuming.** As of the current Mulberry-set state: `category`, `name_en`, `image_url` (real pictogram path, e.g. `/symbols/mulberry/correct.svg` — unlike the historical Dale-Chall version, this set ships with real images already wired for direct use, no separate image-sourcing step needed). A `description_brief` column (optional visual description, reserved for future LLM context) existed in an earlier version of this file and may reappear once the ARASAAC expansion lands, since ARASAAC entries are expected to carry one.
- `name_en` — the display word shown on the card and spoken by TTS
- `category` — the AAC slot this word belongs to (see Vocabulary Slot)

### Mulberry Symbol Set (cboard deck)
A 741-word, real AAC pictogram set (SVG images) originally sourced from the open-source `cboard` project's Mulberry symbols, bundled via `web-client/public/cboard_cards.json` and (currently) also loaded directly as `data/corpus_vocabulary.csv` (738 rows — one entry appears to differ between the two copies; not yet reconciled). Added by a collaborator to see real pictograms on cards during testing. Currently only consumed by the card-search "View all words" overlay in the live app — not yet wired into the main dynamic topic/action card-generation flow. Tried previously as a full image source for dynamic cards; hit the same bounded-vocabulary relevance problem as corpus-matching generally (see Corpus) — words outside this 741/738-word set have no image and forced bad substitutes. Emojis were also tried as a fallback image source and rejected as insufficiently relevant/precise for real communication.

### Vocabulary Slot
The semantic role a word plays in AAC communication. Used as the `category` value in the corpus.

| Slot | Purpose | Examples |
|---|---|---|
| `core` | High-frequency communication words | want, need, go, stop, help, more, finished |
| `action` | Verbs — the action/verb slot | eat, drink, play, read, swim, make |
| `feeling` | Emotional and state words | happy, sad, tired, scared, frustrated |
| `repair` | Conversation repair phrases | not that, again, different, wait, start over |
| `need` | Self-advocacy and needs words | bathroom, break, quiet, food, drink |
| `people` | People words — the who/subject slot | mom, dad, friend, teacher, doctor |
| `topic_school` | School context words | teacher, homework, pencil, recess, math |
| `topic_meals` | Meal context words | pizza, juice, snack, plate, hungry |
| `topic_play` | Play context words | game, toy, turn, win, fun |
| `topic_clinic` | Medical context words | doctor, hurt, pain, medicine, stomach |
| `topic_transitions` | Transition and movement words | home, car, next, first, then, later |
| `general` | Words that don't fit a specific slot | catch-all for obscure or infrequent vocabulary |

### Corpus Enrichment
The process of matching an LLM-generated word against the corpus using MiniLM semantic search to produce a `corpus_name`, `corpus_category`, and match quality score. Implemented in `moderator.ts` for child card generation, but **currently bypassed in the live flow** — topic/action cards are pushed directly from raw LLM output, unmatched against the corpus.

**Why disabled:** A deliberate diagnostic (LLM-raw output vs. corpus-matched output) found corpus-matching itself was degrading card relevance — matched cards often had little to do with the actual conversation, to the point where the family couldn't build real sentences from them. Raw LLM output alone was relevant enough to use.

**Open problem, unresolved:** The team still wants a *bounded, curated* vocabulary (not literally arbitrary LLM-generated words on every card — unconstrained generation risks inappropriate or inconsistent vocabulary reaching the child) — but the current corpus-matching implementation fails at relevance. Re-enabling corpus enrichment with better relevance (rather than abandoning the bounded-vocabulary goal) is an open design question, not yet decided.

### Dyad
A parent–child pair. The unit of account in the system. Contains child name, gender, parent type (mother/father), and locale.

### Turn
A single side of a conversation — either a parent turn (text input) or a child turn (card selection). The core conversation loop alternates turns.

### Card
A tappable vocabulary item shown to the child. Has a `label` (LLM-generated word) and a `corpus_name` (matched word from corpus — what the child sees and hears). Card categories: `topic`, `action`, `emotion`, `core`.

### Child Profile / Personalization
A core, stated driving principle of the project (not yet implemented): every child's card recommendations and vocabulary should personalize over time to that specific child — e.g., surfacing words/topics they select often, or reflecting known personal interests (a favorite show, a favorite game), more frequently than generic context alone would predict. The `dyad` table currently only stores static identity (`child_name`, `child_gender`, `parent_type`, `locale`) — no learned-preference data model exists yet. However, the raw behavioral signal this would need is already being captured: `user_event` (every UI tap, per dyad) and `interim_card_selection` (every card actually chosen per turn) are persisted today, just not yet aggregated into any kind of preference profile or used to influence card generation.

### Session
A single conversation between a parent and child within a topic context. Lifecycle: `initial → started → conversation → terminated`.

### ARASAAC
The Aragonese Portal of Augmentative and Alternative Communication — an open pictogram library with ~30k entries and a public API (`api.arasaac.org`). Used as the primary source for vocabulary expansion. License: CC-BY-NC-SA (images are non-commercial; word names themselves are not copyrightable). Each pictogram has a numeric `_id` that maps to an image URL — stored for future image integration.
