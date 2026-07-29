"""
Expand corpus_vocabulary.csv with ARASAAC pictogram vocabulary.

Implements steps 1-6 of docs/prd-corpus-expansion.md:
  1. Fetch ARASAAC pictograms
  2. Extract single-word English keywords
  3. Dedupe against the existing corpus, append new rows
  4. LLM-reclassify ALL rows into AAC vocabulary slots, in batches
  5. Validate (row counts, slot distribution, duplicate check)
  6. Write the merged CSV (existing file is backed up first)

Step 7 (re-embedding) is NOT part of this script — run generate_embeddings.py
after this one finishes, exactly like before.

No new dependencies: uses `requests` (already installed) directly against the
OpenAI-compatible chat completions endpoint, and a tiny manual .env.local
reader, instead of adding the `openai` SDK or `python-dotenv`.

Usage:
    python3 scripts/expand_corpus_arasaac.py
"""
import csv
import json
import os
import re
import shutil
import sys
import time
from collections import Counter
from datetime import datetime

import requests

DATA_DIR = os.path.join(os.path.dirname(__file__), "../data")
CORPUS_CSV = os.path.join(DATA_DIR, "corpus_vocabulary.csv")
ENV_LOCAL = os.path.join(os.path.dirname(__file__), "../.env.local")

ARASAAC_URL = "https://api.arasaac.org/api/pictograms/all/en"

# Must match the 12-slot schema in CONTEXT.md / the PRD exactly.
SLOTS = [
    "core", "action", "feeling", "repair", "need", "people",
    "topic_school", "topic_meals", "topic_play", "topic_clinic",
    "topic_transitions", "general",
]

BATCH_SIZE = 50
FIELDNAMES = ["category", "name_en", "description_brief", "image_url"]


# ---------- .env.local loader (no python-dotenv dependency) ----------

def load_env_local() -> None:
    if not os.path.exists(ENV_LOCAL):
        return
    with open(ENV_LOCAL, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


# ---------- LLM client config (mirrors src/lib/gemini.ts exactly) ----------

def get_llm_config() -> tuple[str, str, str]:
    """Returns (api_key, base_url, model), preferring OpenRouter over direct
    Gemini if OPENROUTER_API_KEY is set — same precedence as gemini.ts."""
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    if openrouter_key:
        base_url = "https://openrouter.ai/api/v1"
        model = os.environ.get("LLM_MODEL") or "google/gemini-2.5-flash"
        return openrouter_key, base_url, model

    gemini_key = os.environ.get("GEMINI_API_KEY")
    if not gemini_key:
        sys.exit(
            "No OPENROUTER_API_KEY or GEMINI_API_KEY found in the environment "
            "(checked .env.local). Set one before running this script."
        )
    base_url = os.environ.get("OPENAI_BASE_URL") or "https://generativelanguage.googleapis.com/v1beta/openai/"
    model = os.environ.get("LLM_MODEL") or "gemini-2.5-flash-lite"
    return gemini_key, base_url, model


def chat_completion(api_key: str, base_url: str, model: str, prompt: str) -> str:
    url = base_url.rstrip("/") + "/chat/completions"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}]},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


_FENCE_RE = re.compile(r"```(?:[a-zA-Z0-9_+-]*)\s*\n?(.*?)\n?\s*```", re.DOTALL)


def strip_fence(text: str) -> str:
    m = _FENCE_RE.search(text)
    return (m.group(1) if m else text).strip()


# ---------- Step 1+2: Fetch ARASAAC, extract single-word keywords ----------

def fetch_arasaac_words() -> list[dict]:
    print("Fetching ARASAAC pictograms...")
    resp = requests.get(ARASAAC_URL, timeout=120)
    resp.raise_for_status()
    pictograms = resp.json()
    print(f"  {len(pictograms)} pictograms fetched")

    seen = set()
    words = []
    for pic in pictograms:
        for kw in pic.get("keywords", []):
            word = (kw.get("keyword") or "").strip()
            if not word or " " in word:
                continue  # single words only, per PRD
            key = word.lower()
            if key in seen:
                continue
            seen.add(key)
            words.append(word)

    print(f"  {len(words)} unique single-word keywords extracted")
    return words


# ---------- Step 3: Dedupe against existing corpus, append new rows ----------

def load_existing_corpus() -> list[dict]:
    if not os.path.exists(CORPUS_CSV):
        print(f"  No existing corpus found at {CORPUS_CSV} — starting from empty")
        return []
    with open(CORPUS_CSV, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    print(f"  {len(rows)} existing rows loaded from {CORPUS_CSV}")
    return rows


def merge_new_words(existing_rows: list[dict], arasaac_words: list[str]) -> list[dict]:
    existing_names = {row["name_en"].strip().lower() for row in existing_rows if row.get("name_en")}
    new_rows = []
    for word in arasaac_words:
        if word.strip().lower() in existing_names:
            continue
        new_rows.append({
            "category": "general",  # placeholder — overwritten for every row in Step 4
            "name_en": word,
            "description_brief": "",
            "image_url": "",  # ARASAAC image integration is out of scope for this pass
        })
    print(f"  {len(new_rows)} new ARASAAC-only rows after dedupe")
    return new_rows


# ---------- Step 4: LLM reclassification, ALL rows, batches of ~50 ----------

SLOT_DEFINITIONS = """- core: high-frequency communication words (want, need, go, stop, help, more, finished)
- action: verbs (eat, drink, play, read, swim, make)
- feeling: emotional/state words (happy, sad, tired, scared, frustrated)
- repair: conversation repair phrases (not that, again, different, wait, start over)
- need: self-advocacy/needs words (bathroom, break, quiet, food, drink)
- people: people words (mom, dad, friend, teacher, doctor)
- topic_school: school context words (teacher, homework, pencil, recess, math)
- topic_meals: meal context words (pizza, juice, snack, plate, hungry)
- topic_play: play context words (game, toy, turn, win, fun)
- topic_clinic: medical context words (doctor, hurt, pain, medicine, stomach)
- topic_transitions: transition/movement words (home, car, next, first, then, later)
- general: anything that doesn't clearly fit one specific slot"""


def classify_batch(api_key: str, base_url: str, model: str, words: list[str]) -> dict:
    prompt = (
        "Classify each of these AAC vocabulary words into exactly one slot.\n\n"
        f"Slots:\n{SLOT_DEFINITIONS}\n\n"
        "Words:\n" + "\n".join(words) + "\n\n"
        "Output ONLY a JSON object mapping each word to its slot name, nothing else. Example:\n"
        '{"eat": "action", "mom": "people"}'
    )
    try:
        text = strip_fence(chat_completion(api_key, base_url, model, prompt))
        result = json.loads(text)
    except (requests.RequestException, json.JSONDecodeError, KeyError) as e:
        print(f"  WARNING: batch starting {words[0]!r} failed ({e}) — defaulting to 'general'")
        return {w: "general" for w in words}

    return {w: (result.get(w) if result.get(w) in SLOTS else "general") for w in words}


def classify_all(rows: list[dict]) -> None:
    api_key, base_url, model = get_llm_config()
    words = [r["name_en"] for r in rows]
    total_batches = (len(words) - 1) // BATCH_SIZE + 1 if words else 0
    print(f"Classifying {len(words)} words in {total_batches} batches of {BATCH_SIZE} via {model}...")

    for i in range(0, len(words), BATCH_SIZE):
        batch = words[i:i + BATCH_SIZE]
        mapping = classify_batch(api_key, base_url, model, batch)
        for row in rows[i:i + BATCH_SIZE]:
            row["category"] = mapping.get(row["name_en"], "general")
        print(f"  batch {i // BATCH_SIZE + 1}/{total_batches} done")
        time.sleep(0.5)  # light rate-limit courtesy


# ---------- Step 5: Validation ----------

def validate(rows: list[dict]) -> None:
    print("\n=== Validation ===")
    print(f"Total rows: {len(rows)}")

    counts = Counter(r["category"] for r in rows)
    for slot in SLOTS:
        print(f"  {slot:20s} {counts.get(slot, 0)}")

    if rows:
        general_pct = counts.get("general", 0) / len(rows) * 100
        if general_pct > 70:
            print(f"  WARNING: {general_pct:.0f}% landed in 'general' — classification prompt may need tuning")

    seen_names = set()
    dupes = 0
    for r in rows:
        key = r["name_en"].strip().lower()
        if key in seen_names:
            dupes += 1
        seen_names.add(key)
    print(f"  Duplicate name_en values: {dupes}" if dupes else "  No duplicates found")


# ---------- Step 6: Write merged CSV (existing file backed up first) ----------

def write_corpus(all_rows: list[dict]) -> None:
    if os.path.exists(CORPUS_CSV):
        backup_path = CORPUS_CSV + f".bak-{datetime.now():%Y%m%d%H%M%S}"
        shutil.copy2(CORPUS_CSV, backup_path)
        print(f"Backed up existing corpus to {backup_path}")

    with open(CORPUS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        for row in all_rows:
            writer.writerow({k: row.get(k, "") for k in FIELDNAMES})
    print(f"Wrote {len(all_rows)} rows to {CORPUS_CSV}")


def main():
    load_env_local()

    print("Step 1-2: Fetch + extract ARASAAC keywords")
    arasaac_words = fetch_arasaac_words()

    print("\nStep 3: Load existing corpus + dedupe")
    existing_rows = load_existing_corpus()
    new_rows = merge_new_words(existing_rows, arasaac_words)

    all_rows = existing_rows + new_rows
    for row in all_rows:
        row.setdefault("description_brief", "")
        row.setdefault("image_url", "")

    print("\nStep 4: LLM reclassification (all rows, existing categories are overwritten)")
    classify_all(all_rows)

    validate(all_rows)
    print()
    write_corpus(all_rows)

    print(
        "\nNext step: run `python3 scripts/generate_embeddings.py` to re-embed the "
        "new corpus, then restart the backend (embeddings are cached at module load)."
    )


if __name__ == "__main__":
    main()
