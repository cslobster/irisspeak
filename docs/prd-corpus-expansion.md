# PRD: Vocabulary Corpus Expansion via ARASAAC

## Problem Statement

When a parent sends a message, the AI generates topic and action words for the child to tap as cards. Those words are matched against the local vocabulary corpus via semantic search, and **the corpus match is what the child actually sees and hears** — not the raw LLM word. When a word is missing from the corpus, the semantic search falls back to the closest approximate match, which is often a less specific word. This degrades conversation quality: the child cannot express precise thoughts because the right words aren't available.

The current corpus has ~2,002 single-word entries — too small for good coverage. Common words that come up naturally in conversation are missing, forcing the system into cosine fallback too often.

## Solution

Expand the corpus to ~30k entries by pulling all single-word English vocabulary from the ARASAAC public API. Reclassify every entry — both existing and new — from the old encyclopedic categories (animal, food, hobby...) into AAC vocabulary slots (core, action, feeling, topic_school, etc.) using a Gemini LLM pass. Re-generate MiniLM embeddings on the merged corpus and drop the new files into the project.

This is implemented entirely as a Google Colab data pipeline. No backend code changes are required beyond the corpus filename fix already merged.

## User Stories

1. As a child using the app, I want the card shown to me to use the precise word I need, so that I can communicate accurately with my parent.
2. As a child using the app, I want topic-specific words like "homework", "recess", or "pizza" to be available, so that I can have meaningful conversations about my day.
3. As a child using the app, I want action words like "swim", "draw", or "build" to match exactly, so that the card I tap says what I actually mean.
4. As a child using the app, I want feeling words to match precisely, so that I can express my emotional state clearly.
5. As a parent, I want the AI to find an exact or near-exact word match most of the time, so that I can trust the cards represent my child's actual intent.
6. As a parent, I want conversations to feel natural and specific, so that my child is motivated to keep using the app.
7. As a developer, I want the corpus categories to reflect AAC vocabulary slots, so that I can build category-filtered search in the future without a data migration.
8. As a developer, I want the pipeline to be repeatable, so that I can expand or update the corpus again without rebuilding the process from scratch.
9. As a developer, I want ARASAAC pictogram IDs stored alongside words in the future, so that images can be added without a schema migration.
10. As a developer, I want the merged corpus to contain no duplicate entries, so that the embedding index is clean and search results are not skewed.
11. As a developer, I want the slot distribution across the corpus to be visible after reclassification, so that I can verify the LLM classification prompt is working correctly.
12. As a developer, I want existing `description_brief` values to be preserved for the ~2k original entries, so that we retain the option to use them for LLM context later.

## Implementation Decisions

### Pipeline overview

The entire expansion runs as a Google Colab notebook in seven steps:

```
STEP 1 — Fetch ARASAAC
  GET api.arasaac.org/api/pictograms/all/en
  → ~30k pictograms in JSON

STEP 2 — Extract single-word keywords
  For each pictogram:
    - take all entries in keywords[]
    - keep only single-word values (no spaces)
    - lowercase + dedupe within ARASAAC
  → unique single words with arasaac_id and word_type (2=noun, 3=verb, 4=adjective)

STEP 3 — Dedupe against existing corpus
  Load corpus_vocabulary.csv (~2k entries)
  Drop any ARASAAC word already present in name_en (case-insensitive)
  → existing 2k rows + new ARASAAC-only rows = full merged set

STEP 4 — LLM reclassification (ALL rows)
  Send every row's name_en to Gemini in batches of ~50 words
  Classify into one of: core, action, feeling, repair, need, people,
    topic_school, topic_meals, topic_play, topic_clinic, topic_transitions, general
  → every row gets a new AAC slot category
  → ARASAAC rows: description_brief left blank
  → existing rows: description_brief preserved as-is

STEP 5 — Validation checks
  Print row count before and after merge (verify no duplicates)
  Print slot distribution (if >70% land in "general", tune the prompt)
  Spot-check 20 random rows from each slot

STEP 6 — Write merged CSV
  Columns: category, name_en, description_brief
  Save as corpus_vocabulary.csv

STEP 7 — Re-embed
  Run MiniLM-L6-v2 on every name_en
  Output: minilm_name_embeddings.bin + minilm_name_embeddings.meta.json
```

Steps 1–7 run in Colab. Output files are dropped manually into `/data/` and the backend is restarted.

### Module: ARASAAC Fetcher
- Single API call to `api.arasaac.org/api/pictograms/all/en`
- For each pictogram, iterate all `keywords[]` entries and extract the `keyword` string
- Filter: keep only entries where the keyword contains no spaces (single word)
- Dedupe within the ARASAAC result set by lowercased keyword
- No filtering on the `aac` boolean flag — maximize coverage

### Module: Corpus Merger
- Load existing CSV; build a set of lowercased `name_en` values
- For each ARASAAC word, skip if it already exists in the set
- Append new rows with blank `description_brief`
- Preserve existing rows exactly as-is (category will be overwritten in step 4)

### Module: LLM Slot Classifier
- Batch words ~50 per prompt to Gemini 2.5 Flash Lite via OpenRouter
- Prompt instructs the model to return a JSON mapping of word → slot
- Malformed responses: fall back to `general` for any word not present in the response
- All rows — existing and new — go through this pass; existing `category` values are replaced

### Vocabulary slot schema
The `category` column in `corpus_vocabulary.csv` must be one of:
`core | action | feeling | repair | need | people | topic_school | topic_meals | topic_play | topic_clinic | topic_transitions | general`

### Corpus CSV schema (unchanged)
`category, name_en, description_brief` — no new columns in this iteration.
ARASAAC pictogram IDs are not stored yet; image integration is a future workstream.

### License
ARASAAC is licensed CC-BY-NC-SA. This covers pictogram images. Individual English word names are not copyrightable. The corpus CSV contains only word names — no images are served in this iteration.

## Out of Scope

- Image integration — ARASAAC pictogram images and `arasaac_id` column are deferred to a future workstream
- Category-filtered search — biasing corpus search by slot is a future backend change; this PRD only fixes the data
- OpenAAC vocabularies — evaluated but not used; ARASAAC has a live programmatic API and broader single-word coverage
- Multilingual expansion — corpus is English only in this iteration
- Backend code changes beyond the corpus filename fix already merged

## Further Notes

- The corpus filename bug (`corpus_vocabulary_slim.csv` → `corpus_vocabulary.csv`) has already been fixed in `corpus.ts` and should be merged before this pipeline is run.
- The Colab notebook to update is `AI_Native_AAC_System.ipynb` in `MyDrive/AAC_Research/`. The new ARASAAC fetch, merge, and reclassification steps should be added before the existing embedding section.
- After dropping new files into `/data/`, restart the backend — corpus embeddings are cached at module load time.
