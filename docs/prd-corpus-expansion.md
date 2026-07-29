# PRD: Vocabulary Corpus Expansion + Generation Pipeline

## Problem Statement

When a parent sends a message, the AI generates topic and action words for the child to tap as cards. Those words are *supposed* to be matched against the local vocabulary corpus via semantic search, so that **the corpus match — not the raw LLM word — is what the child actually sees and hears.**

In practice, corpus-matching is currently **bypassed in the live app**: a deliberate diagnostic (comparing raw LLM output against corpus-matched output) found that matching *after* the model already committed to a specific word was itself degrading relevance — matched cards often had little to do with the actual conversation, to the point where the family couldn't build real sentences from them. Raw, unconstrained LLM output was more usable, but the team still doesn't want literally arbitrary LLM-generated words reaching the child (inconsistent, unvetted, unsafe for this audience).

Separately, the corpus itself has been swapped multiple times during development and its documented state has drifted from reality more than once. As of this PRD, the live corpus (`data/corpus_vocabulary.csv`) is the 738-row Mulberry/cboard symbol set (real AAC pictograms, added to preview real images on cards) — not the ~2,000-word Dale-Chall corpus earlier drafts of this PRD assumed. Whatever the corpus's size, a too-small vocabulary forces frequent fallback to a distant approximate match, which is the underlying failure mode either way.

## Solution

Two complementary pieces, designed to work together:

**Tier 1 — Expand the corpus.** Grow the vocabulary by merging in ARASAAC's public pictogram library (~30k single-word entries) on top of the current Mulberry-738 base, reclassifying every entry into AAC vocabulary slots via an LLM pass, and re-embedding with MiniLM. This directly shrinks how often the system needs to reach for a word outside the vetted set.

**Tier 2 — Flip matching from "correct after" to "constrain before" (design agreed, not yet implemented).** Instead of letting the LLM generate freely and then trying to fix a bad word after the fact, narrow the corpus to a small, topically-relevant, category-scoped shortlist *before* the LLM call (reusing the category-scoped exact/word-boundary/cosine retriever that already exists in `corpus.ts` — no new matching algorithm needed), then have the LLM pick/phrase the actual card words from that shortlist. Because narrowing happens locally via MiniLM embeddings (free, no LLM call), prompt size — and therefore cost — stays roughly constant regardless of how large Tier 1 grows the corpus; only the final shortlist (~30–50 words) ever reaches the paid LLM call.

Together these mean: bigger vocabulary (Tier 1) without paying for it in tokens (Tier 2's local narrowing), and no more "corrected" cards that drift off-meaning, because the model is never free to say a word outside the vetted shortlist to begin with.

**Explicitly out of scope for this iteration:** per-child personalization (see below) and any form of real-time, per-card AI image generation.

## User Stories

1. As a child using the app, I want the card shown to me to use the precise word I need, so that I can communicate accurately with my parent.
2. As a child using the app, I want topic-specific words like "homework", "recess", or "pizza" to be available, so that I can have meaningful conversations about my day.
3. As a child using the app, I want action words like "swim", "draw", or "build" to match exactly, so that the card I tap says what I actually mean.
4. As a child using the app, I want feeling words to match precisely, so that I can express my emotional state clearly.
5. As a parent, I want the AI to find an exact or near-exact word match most of the time, so that I can trust the cards represent my child's actual intent.
6. As a parent, I want conversations to feel natural and specific, so that my child is motivated to keep using the app.
7. As a developer, I want the corpus categories to reflect AAC vocabulary slots, so that category-filtered search works without a data migration.
8. As a developer, I want the pipeline to be repeatable and runnable without Colab, so that I (or a collaborator) can expand or update the corpus again without a manual notebook session.
9. As a developer, I want the merged corpus to contain no duplicate entries, so that the embedding index is clean and search results are not skewed.
10. As a developer, I want the slot distribution across the corpus to be visible after reclassification, so that I can verify the LLM classification prompt is working correctly.
11. As a developer, I want existing `image_url` and `description_brief` values preserved for rows that already have them, so that real images already in the corpus (Mulberry-sourced rows) aren't lost during expansion.
12. As a developer, I want per-turn LLM cost to stay flat as the corpus grows, so that Tier 1's expansion doesn't become a cost regression.
13. As a developer, I want a clear, identified integration point for future per-child personalization (weighting the Tier 2 shortlist by a child's preference history), so that the architecture doesn't need reworking when that's eventually built.

## Implementation Decisions

### Pipeline location — changed from Colab to a repo-native script

The original plan ran this entirely as a manual Google Colab notebook (`AI_Native_AAC_System.ipynb`). That notebook was found to only contain load/embed/generation-testing scaffolding — the actual fetch/merge/reclassify steps below were never implemented there, in Colab or anywhere else, despite being specified. As of this PRD, the pipeline is being built as a **repo-native Python script** instead, so it no longer depends on manual Colab execution and can be run (and re-run) directly.

**Built:** `scripts/expand_corpus_arasaac.py` — implements steps 1–6 below. No new dependencies (uses `requests`, already installed, directly against the chat-completions endpoint instead of adding the `openai` SDK; a minimal manual `.env.local` reader instead of `python-dotenv`). Reuses the existing, unmodified `scripts/generate_embeddings.py` for step 7. Dry-run verified: syntax, credential resolution (mirrors `gemini.ts`'s OpenRouter-first precedence), a real LLM round-trip, and existing-corpus loading all confirmed working. **The full run (real ARASAAC fetch + real paid classification of every word + overwrite of the live corpus) has not yet been executed** — reserved for an explicit go-ahead since it costs real API spend and rewrites the live corpus file.

```
STEP 1 — Fetch ARASAAC
  GET api.arasaac.org/api/pictograms/all/en

STEP 2 — Extract single-word keywords
  For each pictogram, iterate keywords[], keep only single-word values,
  lowercase + dedupe within ARASAAC

STEP 3 — Dedupe against existing corpus
  Load corpus_vocabulary.csv (currently 738 Mulberry-sourced rows)
  Drop any ARASAAC word already present in name_en (case-insensitive)

STEP 4 — LLM reclassification (ALL rows, existing + new)
  Batches of ~50 words per prompt
  Classify into: core, action, feeling, repair, need, people,
    topic_school, topic_meals, topic_play, topic_clinic, topic_transitions, general
  Malformed/missing responses fall back to 'general'

STEP 5 — Validation
  Row counts before/after, slot distribution (flag if >70% land in 'general'),
  duplicate check

STEP 6 — Write merged CSV
  Existing corpus_vocabulary.csv is backed up first (corpus_vocabulary.csv.bak-<timestamp>)
  Columns: category, name_en, description_brief, image_url

STEP 7 — Re-embed (unchanged, scripts/generate_embeddings.py)
  MiniLM-L6-v2 on every name_en → minilm_name_embeddings.bin + .meta.json
```

### Corpus CSV schema — changed

`category, name_en, description_brief, image_url` — **`image_url` is a new column**, needed because the current Mulberry-sourced rows already carry real pictogram paths (e.g. `/symbols/mulberry/correct.svg`) that must be preserved through expansion, not dropped. New ARASAAC-sourced rows get a blank `image_url` (actual ARASAAC image integration is still a future workstream) and blank `description_brief`. Existing rows' `description_brief`/`image_url` values are preserved as-is; only `category` is overwritten in step 4.

### Tier 2 — Constrain-before-generate (design only, not yet implemented)

- Reuses `corpus.ts`'s existing retriever (exact match → word-boundary match → MiniLM cosine similarity), called once per category (topic/action) **before** the generation call, instead of once per word **after** it. The retriever already supports category-scoped restriction (see its existing `category` parameter and its own code comment about small categories losing cosine ties to larger ones) — no new matching logic needs to be written.
- The LLM call then receives only the narrowed shortlist (~30–50 words with brief descriptions) and picks/phrases the actual card words from it, rather than generating open-endedly.
- This keeps prompt size — and cost — roughly constant regardless of corpus size, since only the shortlist, never the full corpus, reaches the LLM.
- Not yet built. Backend files affected: `moderator.ts`, `prompts.ts`. No frontend changes required for this piece.

### Personalization — identified hook point, explicitly deferred

A core, previously-undocumented project principle: card recommendations should eventually personalize per child (frequently-selected words/topics, known interests weighted higher). Not being built as part of this PRD. The integration point, for whenever it is built: a preference-weighted score blended with contextual relevance at the Tier 2 narrowing/ranking step — not a hard filter. Real implementations of this kind typically need score decay over time (so old behavior doesn't permanently dominate) and some deliberate randomness/exploration (so the system doesn't get stuck only ever surfacing past favorites). Raw data this would need (`user_event`, `interim_card_selection`) is already being persisted today, unused for this purpose.

### License
ARASAAC is licensed CC-BY-NC-SA. This covers pictogram images. Individual English word names are not copyrightable.

## Out of Scope

- Tier 2 implementation itself is designed here but not yet coded — tracked as follow-up work, not part of this PRD's "done" definition
- Personalization — see above; explicitly deferred
- Real-time, per-word AI-generated images for novel words outside even the expanded corpus — considered and deliberately not pursued yet, due to consistency (a word's symbol must not change once learned) and child-content-safety concerns; may be revisited later as a lazy-cached, once-per-word addition if the expanded corpus's miss rate turns out to still be meaningful
- Full ARASAAC image integration (`arasaac_id` column, real pictogram images for ARASAAC-sourced rows) — deferred to a future workstream
- Multilingual expansion — corpus is English only in this iteration
- UI changes — none required for Tier 1; Tier 2 requires no frontend changes either

## Further Notes

- **Security:** during this work, a live OpenRouter API key was found hardcoded in plaintext in the (now-retired) Colab notebook, which had been copied across multiple Google accounts. Confirmed to be a different key than the one properly stored in `.env.local`, so the running app was not compromised — but the exposed key should be revoked/rotated on OpenRouter's dashboard by whoever owns it, independent of anything in this PRD.
- **Docs hygiene:** this repo has more than one contributor and no enforced process for keeping corpus/pipeline documentation in sync with the actual data file, which has caused this PRD and `CONTEXT.md` to drift from reality more than once. `CLAUDE.md` now carries a standing instruction for any Claude Code session working in this repo to correct stale domain docs as soon as drift is found, rather than leaving it for the next session to rediscover.
- After running the full pipeline and `generate_embeddings.py`, restart the backend — corpus embeddings are cached at module load time.
