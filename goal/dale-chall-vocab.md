# Goal: Dale-Chall Vocabulary Corpus

## What
Replace corpus_vocabulary.csv with ~3,000 words from the Dale-Chall familiar word list.

## Source
PDF: /Users/jeremysihan/aac/dale-chall-words-list.pdf

## Processing
- Extract all words from the PDF (already done — words are plain lowercase English)
- Filter: single words only (no hyphenated, no contractions, no punctuation variants)
- Use Gemini to classify each word into one of the 12 AAC vocabulary slots
- Leave description_brief blank

## Output format (must match existing corpus_vocabulary.csv)
category,name_en,description_brief

## 12 AAC Vocabulary Slots
core, action, feeling, repair, need, people, topic_school, topic_meals, topic_play, topic_clinic, topic_transitions, general

## Branch
feature/dale-chall-vocab — branched from feature/new-vocab

## After CSV is generated
Re-run MiniLM embeddings to produce new .bin and .meta.json, then drop all three files into /data/
