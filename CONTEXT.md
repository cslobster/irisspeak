# AACessTalk — Domain Context

## Glossary

### Corpus
The local vocabulary database used for semantic search. A CSV file (`data/corpus_vocabulary.csv`) containing single-word entries with a category and optional description. Loaded at startup by `corpus.ts` with MiniLM-L6-v2 embeddings pre-computed in `data/minilm_name_embeddings.bin`.

The corpus is a **label canonicalizer**: the LLM generates a word, the corpus finds the closest match, and `corpus_name` is what the child actually sees on the card and hears via TTS.

### Corpus Entry
A single row in `corpus_vocabulary.csv`: `category`, `name_en`, `description_brief`.
- `name_en` — the display word shown on the card and spoken by TTS
- `category` — the AAC slot this word belongs to (see Vocabulary Slot)
- `description_brief` — optional visual description of the pictogram; not used in search today, reserved for future LLM context

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
The process of matching an LLM-generated word against the corpus using MiniLM semantic search to produce a `corpus_name`, `corpus_category`, and match quality score. Happens in `moderator.ts` during child card generation.

### Dyad
A parent–child pair. The unit of account in the system. Contains child name, gender, parent type (mother/father), and locale.

### Turn
A single side of a conversation — either a parent turn (text input) or a child turn (card selection). The core conversation loop alternates turns.

### Card
A tappable vocabulary item shown to the child. Has a `label` (LLM-generated word) and a `corpus_name` (matched word from corpus — what the child sees and hears). Card categories: `topic`, `action`, `emotion`, `core`.

### Session
A single conversation between a parent and child within a topic context. Lifecycle: `initial → started → conversation → terminated`.

### ARASAAC
The Aragonese Portal of Augmentative and Alternative Communication — an open pictogram library with ~30k entries and a public API (`api.arasaac.org`). Used as the primary source for vocabulary expansion. License: CC-BY-NC-SA (images are non-commercial; word names themselves are not copyrightable). Each pictogram has a numeric `_id` that maps to an image URL — stored for future image integration.
