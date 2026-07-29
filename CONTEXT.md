# AACessTalk — Domain Context

## Glossary

### Corpus
The local vocabulary database used to constrain child-card generation. A CSV file (`data/corpus_vocabulary.csv`) loaded at startup by `corpus.ts`.

**As of 2026-07-29 (`6dc8371`, "Un-bypass AAC card generation"), the corpus is no longer a post-hoc semantic-match target — it's given to the LLM directly.** `moderator.ts` passes the full `topic`/`action` category word lists straight into the prompt (`buildChildCardPrompt`); the model is asked to reason about the parent message's theme and pick 6 ranked candidates per category from that real list, and `corpus.ts` does an exact (case-insensitive) lookup to attach the real image/category and reject anything hallucinated outside the list. There is no fuzzy or embedding-based matching in this path anymore — `corpus.ts`'s cosine-similarity retriever and the `@xenova/transformers` dependency it used were deliberately removed in the same commit (see Corpus Enrichment below for why). The precomputed `data/minilm_name_embeddings.bin`/`.meta.json` files are still on disk but currently unused by any code path.

**Current state (verified 2026-07-29):** the file has been swapped out multiple times during development and is presently the 738-row Mulberry set (see Mulberry Symbol Set) — a smaller, real-AAC-pictogram set added by a collaborator specifically to test how cards look with real images, not a permanent vocabulary decision. An earlier ~2,000-word corpus (Dale-Chall word list) existed at one point but is gone and not coming back — it's noted here only as history. The corpus file can change without this doc being updated (the project has more than one contributor and there's no guaranteed process for keeping this in sync) — **treat this section as a starting hypothesis and verify the live file before relying on a specific row count or column set.** The standing target for growing this corpus is the ARASAAC pictogram expansion (see ARASAAC / Vocabulary Expansion), not a return to Dale-Chall.

### Corpus Entry
A single row in `corpus_vocabulary.csv` — **columns vary by whichever vocabulary set is currently loaded; verify against the live file rather than assuming.** As of the current Mulberry-set state: `category`, `name_en`, `image_url` (real pictogram path, e.g. `/symbols/mulberry/correct.svg` — unlike the historical Dale-Chall version, this set ships with real images already wired for direct use, no separate image-sourcing step needed). A `description_brief` column (optional visual description, reserved for future LLM context) existed in an earlier version of this file and may reappear once the ARASAAC expansion lands, since ARASAAC entries are expected to carry one.
- `name_en` — the display word shown on the card and spoken by TTS
- `category` — the AAC slot this word belongs to (see Vocabulary Slot)

### Mulberry Symbol Set (cboard deck)
A 741-word, real AAC pictogram set (SVG images) originally sourced from the open-source `cboard` project's Mulberry symbols, bundled via `web-client/public/cboard_cards.json` and also loaded directly as `data/corpus_vocabulary.csv` (738 rows — one entry appears to differ between the two copies; not yet reconciled). Added by a collaborator to see real pictograms on cards during testing. As of `6dc8371` (2026-07-29) this set **is** the vocabulary the main dynamic topic/action card-generation flow draws from directly (see Corpus) — it's also still used separately by the card-search "View all words" overlay. Emojis were tried earlier as a fallback image source and rejected as insufficiently relevant/precise for real communication.

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
Originally: the process of matching an LLM-generated word against the corpus *after generation* using MiniLM semantic search, to produce a `corpus_name`, `corpus_category`, and match quality score. **This post-hoc approach is gone, not just bypassed** — as of `6dc8371` (2026-07-29) it's been replaced by theme-locked prompting: the LLM is given the real category vocab *before* it generates (see Corpus), so there is no separate "enrichment" match step anymore, just an exact lookup to attach image/category metadata to a word the model already chose from the real list.

**Why the old approach was replaced:** A deliberate diagnostic (LLM-raw output vs. corpus-matched output) found post-hoc corpus-matching itself was degrading card relevance — matched cards often had little to do with the actual conversation, to the point where the family couldn't build real sentences from them. Handing the model the real vocabulary upfront and asking it to reason within it (with 6 ranked candidates per category as a backstop) resolved the bounded-vocabulary-vs-relevance tension without needing a match step at all.

**Relevant to `docs/prd-corpus-expansion.md` Tier 2:** that PRD's "constrain-before-generate" design assumes `corpus.ts` still has a reusable exact→word-boundary→cosine retriever to narrow a shortlist before the LLM call. That retriever (and its `@xenova/transformers` dependency) was deleted in this same commit — arguably because the *current* full-category-vocab-in-prompt approach already achieves a version of "constrain before generate" without narrowing, at the corpus's present size (~721 topic+action words). Tier 2's narrowing-via-retrieval will need new code (semantic or keyword-based) if/when it's built, not a reuse of removed code — most likely to matter once Tier 1 (ARASAAC expansion) makes the full category list too large to hand the LLM in full.

### Dyad
A parent–child pair. The unit of account in the system. Contains child name, gender, parent type (mother/father), and locale.

### Turn
A single side of a conversation — either a parent turn (text input) or a child turn (card selection). The core conversation loop alternates turns.

### Card
A tappable vocabulary item shown to the child. Has a `label` (LLM-generated word) and a `corpus_name` (matched word from corpus — what the child sees and hears). Card categories: `topic`, `action`, `emotion`, `core`.

### Folder Card (added 2026-07-29)
A `topic`-category card with `is_folder: true` and a `folder_path` (e.g. `"numbers"`, `"describe > colours"`) instead of a single word — appears **inside the Topic column, replacing one of the 4 topic-word slots per folder card** (not additive — the column always tops out at 4 tiles total, so most turns are still all real words and a folder just swaps in for one when it clearly applies). Shown with the folder's real Cboard icon (`data/folder_cards.yml`'s `icon` field, e.g. `count_,_to.svg` for Numbers — same asset `CardSearchOverlay.tsx`'s `FOLDER_ICONS` map uses for the browse view) as `corpus_image_url`, plus a noticeable dog-eared folded-corner tab overlay (`CardChip.tsx` — a CSS triangle + 📁, not just a small badge, since a plain icon wasn't noticeable enough in practice) so it still reads as "opens a picker," not a normal word. Tapping it opens `CardSearchOverlay` scoped directly into that Cboard folder (via its `initialPath` prop) instead of adding a card to the selection. Exists for questions the fixed topic/action vocab can't answer well (e.g. "How old are you?" → a Numbers folder), so the child can pick the exact value themselves.

`data/folder_cards.yml` also carries each folder's actual `words` list (mirrored from `web-client/public/cboard_folders.json`, e.g. numbers' `[zero, one, ..., nine]`) — when a folder card is shown, `generateChildCards()` excludes those exact words from the regular topic-word pool, so the child never sees e.g. both a loose "five" card and the Numbers folder card at once (the folder already covers it). This means backend and frontend now both encode a duplicate of each allow-listed folder's word list — if `cboard_folders.json` changes for one of these five folders, `folder_cards.yml`'s `words` needs a matching update or the exclusion logic drifts stale.

**Trigger is a hybrid, not pure LLM judgment** (`moderator.ts`): the LLM may emit a `folder: [path]` (or `[path1, path2]`) YAML line from a small curated allow-list in `data/folder_cards.yml` (`loadFolderCards()` in `staticData.ts`), cross-referenced against `web-client/public/cboard_folders.json`'s actual folder paths. **This alone proved unreliable even for the canonical "How old are you?" case** — empirically, prompting alone (even a strongly-worded "you MUST" instruction) still misses a meaningful fraction of the time, because the corpus's topic vocab already contains some literal number words, giving the model an easy excuse to skip the folder as "redundant." `FOLDER_KEYWORD_TRIGGERS` in `moderator.ts` is a deterministic regex backstop (matches like `/\bhow old\b/i` → `numbers`) that fires whenever the LLM doesn't, so the obvious cases are guaranteed rather than probabilistic. Both sources are deduped and capped at `MAX_FOLDER_CARDS` (2) — folders are meant to be rare, so the prompt explicitly tells the model most messages should get zero folder lines, and the keyword patterns are deliberately narrow (exact phrasings only) rather than broad topic matches.

**LLM output-format gotcha:** the model is asked to emit the `folder` line in the same bracket style as `topics`/`actions`. Empirically (live-tested against the real ~700-word corpus prompt, not just a small mock vocab), Gemini sometimes ignores "decide this silently" for the folder-decision step and free-writes reasoning prose, then drops the brackets (`folder: numbers` instead of `folder: [numbers]`). `extractYamlList()` (`gemini.ts`) now has a third bare-scalar fallback pattern specifically to survive this drift — if a future prompt tweak reintroduces a new optional key, expect the same failure mode and test against the real corpus size, not a short mock vocab, since prompt length seems to correlate with how often the model goes off-format.

### Child Profile / Personalization
A core, stated driving principle of the project (not yet implemented): every child's card recommendations and vocabulary should personalize over time to that specific child — e.g., surfacing words/topics they select often, or reflecting known personal interests (a favorite show, a favorite game), more frequently than generic context alone would predict. The `dyad` table currently only stores static identity (`child_name`, `child_gender`, `parent_type`, `locale`) — no learned-preference data model exists yet. However, the raw behavioral signal this would need is already being captured: `user_event` (every UI tap, per dyad) and `interim_card_selection` (every card actually chosen per turn) are persisted today, just not yet aggregated into any kind of preference profile or used to influence card generation.

### Session
A single conversation between a parent and child within a topic context. Lifecycle: `initial → started → conversation → terminated`.

### ARASAAC
The Aragonese Portal of Augmentative and Alternative Communication — an open pictogram library with ~30k entries and a public API (`api.arasaac.org`). Used as the primary source for vocabulary expansion. License: CC-BY-NC-SA (images are non-commercial; word names themselves are not copyrightable). Each pictogram has a numeric `_id` that maps to an image URL — stored for future image integration.
