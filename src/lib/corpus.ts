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
