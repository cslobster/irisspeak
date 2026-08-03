/**
 * Local Cboard vocabulary lookup.
 *
 * The child-card prompt is given the full category-scoped word lists directly and told to
 * select only from them (see buildChildCardPrompt), so retrieval no longer needs fuzzy or
 * semantic matching — just an exact lookup to attach the corpus image/category for a word
 * the model already chose, and to reject anything it hallucinated outside the given list.
 *
 * Loads on first call:
 *   data/corpus_vocabulary.csv   → rows: category, name_en, image_url
 */
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';

export interface CorpusEntry {
  name: string;
  category: string;
  image_url: string | null;
  // Only ever set for a dyad-scoped Custom Vocabulary Word resolved via lookupDyadWord below —
  // the shared corpus never has this (see CONTEXT.md's Custom Vocabulary Word entry for why
  // emoji is a narrow last-resort fallback here, not a general corpus image source).
  emoji?: string | null;
}

// A row from the dyad_custom_word table (see db.ts) — kept separate from CsvRow since custom
// words carry fields (image_data/emoji/is_preference_pointer) the shared corpus never has.
export interface DyadCustomWord {
  word: string;
  category: string;
  is_preference_pointer: boolean;
  image_data?: string | null;
  emoji?: string | null;
}

interface CsvRow {
  category: string;
  name_en: string;
  image_url?: string;
}

class _CorpusRetriever {
  private rows: CsvRow[] = [];
  private nameToIdx = new Map<string, number>();
  private categoryIndex = new Map<string, number[]>();

  async load(dataDir: string = path.join(process.cwd(), 'data')) {
    if (this.rows.length > 0) return;

    const csvPath = path.join(dataDir, 'corpus_vocabulary.csv');
    if (!fs.existsSync(csvPath)) {
      throw new Error(`corpus CSV missing — expected ${csvPath}`);
    }

    const csvText = fs.readFileSync(csvPath, 'utf-8');
    const parsed = Papa.parse<CsvRow>(csvText, { header: true, skipEmptyLines: true });
    this.rows = parsed.data.filter((r) => r.name_en);

    this.rows.forEach((r, i) => {
      this.nameToIdx.set(r.name_en.toLowerCase().trim(), i);
      if (!this.categoryIndex.has(r.category)) this.categoryIndex.set(r.category, []);
      this.categoryIndex.get(r.category)!.push(i);
    });

    console.log(`[corpus] loaded ${this.rows.length} words`);
  }

  /** All vocab words for a given CSV category (e.g. 'topic', 'action'), file order. */
  wordsByCategory(category: string): string[] {
    return (this.categoryIndex.get(category) ?? []).map((i) => this.rows[i].name_en);
  }

  /** Exact (case-insensitive) lookup — the LLM is instructed to only return real vocab words. */
  lookup(word: string): CorpusEntry | null {
    const idx = this.nameToIdx.get((word || '').toLowerCase().trim());
    if (idx === undefined) return null;
    const r = this.rows[idx];
    return { name: r.name_en, category: r.category, image_url: r.image_url ?? null };
  }
}

const _retriever = new _CorpusRetriever();
let _ready: Promise<void> | null = null;

export async function getCorpusRetriever(): Promise<_CorpusRetriever> {
  if (!_ready) _ready = _retriever.load();
  await _ready;
  return _retriever;
}

/**
 * Appends a dyad's Custom Vocabulary Words to a base vocab list (topicVocab/actionVocab),
 * scoped to the given category. Deliberately a standalone function, not a method on
 * _CorpusRetriever — the shared retriever stays global/immutable, so there's no code path for
 * one dyad's words to leak into another's (isolation comes from the caller passing only that
 * dyad's rows in, not from any shared mutable state). Preference-pointer words are excluded
 * here since the word they point to already exists in the base vocab — duplicating it would
 * just show the LLM the same word twice; preference is instead signaled via prompt context
 * (see buildChildCardPrompt's profileFacts param), not a second vocab-list entry.
 */
export function mergeDyadWords(baseVocab: string[], customWords: DyadCustomWord[], category: string): string[] {
  const extra = customWords
    .filter((w) => w.category === category && !w.is_preference_pointer)
    .map((w) => w.word);
  return [...baseVocab, ...extra];
}

/** Dyad-scoped fallback for corpus.lookup() — checks the shared corpus first via the passed-in
 * retriever, then this dyad's custom words, so a Custom Vocabulary Word isn't silently dropped
 * as "hallucinated" the way any other unrecognized word is (see CONTEXT.md's Custom Vocabulary
 * Word entry). image_data becomes a data: URI directly usable in an <img src>; emoji is carried
 * separately since it isn't a valid image URL — CardChip branches on it.
 */
export function lookupDyadWord(
  retriever: _CorpusRetriever,
  word: string,
  customWords: DyadCustomWord[],
): CorpusEntry | null {
  const fromCorpus = retriever.lookup(word);
  if (fromCorpus) return fromCorpus;

  const needle = (word || '').toLowerCase().trim();
  const match = customWords.find((w) => w.word.toLowerCase().trim() === needle);
  if (!match) return null;

  return {
    name: match.word,
    category: match.category,
    image_url: match.image_data ? `data:image/png;base64,${match.image_data}` : null,
    emoji: match.emoji ?? null,
  };
}
