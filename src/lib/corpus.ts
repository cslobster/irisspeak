/**
 * Local corpus retriever — Cboard vocabulary with optional MiniLM embeddings.
 *
 * Loads on first call:
 *   data/corpus_vocabulary.csv   → rows: category, name_en, image_url
 *   data/minilm_name_embeddings.bin + .meta.json  (optional — skipped if absent)
 *
 * Per query:
 *   1. exact full-string lookup      — O(1)
 *   2. whole-word boundary regex     — O(n)
 *   3. cosine similarity (MiniLM)    — only when embeddings are loaded
 */
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';

export interface CorpusMatch {
  name: string;
  category: string;
  cosine: number;
  mode: 'exact' | 'word' | 'cos';
  image_url: string | null;
}

interface CsvRow {
  category: string;
  name_en: string;
  image_url?: string;
}

class _CorpusRetriever {
  private rows: CsvRow[] = [];
  private emb: Float32Array | null = null;
  private rowCount = 0;
  private dim = 0;
  private nameToIdx = new Map<string, number>();
  private nameLowerArr: string[] = [];
  private encoder: any = null;
  private hasEmbeddings = false;

  async load(dataDir: string = path.join(process.cwd(), 'data')) {
    if (this.rowCount > 0) return;

    const csvPath  = path.join(dataDir, 'corpus_vocabulary.csv');
    const binPath  = path.join(dataDir, 'minilm_name_embeddings.bin');
    const metaPath = path.join(dataDir, 'minilm_name_embeddings.meta.json');

    if (!fs.existsSync(csvPath)) {
      throw new Error(`corpus CSV missing — expected ${csvPath}`);
    }

    const csvText = fs.readFileSync(csvPath, 'utf-8');
    const parsed  = Papa.parse<CsvRow>(csvText, { header: true, skipEmptyLines: true });
    this.rows = parsed.data.filter((r) => r.name_en);
    this.rowCount = this.rows.length;

    // Embeddings are optional — fall back to string-only matching if absent.
    if (fs.existsSync(binPath) && fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        const embRows = Math.min(meta.rows, this.rowCount);
        this.dim = meta.dim;
        const buf  = fs.readFileSync(binPath);
        this.emb   = new Float32Array(buf.buffer, buf.byteOffset, embRows * this.dim);
        this.hasEmbeddings = true;
        console.log(`[corpus] embeddings loaded: ${embRows} × ${this.dim}-d`);
      } catch (e) {
        console.warn('[corpus] embeddings failed to load, falling back to string matching:', e);
      }
    } else {
      console.log('[corpus] no embeddings found — using string matching only');
    }

    for (let i = 0; i < this.rows.length; i++) {
      const lower = this.rows[i].name_en.toLowerCase();
      this.nameLowerArr.push(lower);
      this.nameToIdx.set(lower, i);
    }

    console.log(`[corpus] loaded ${this.rows.length} words`);
  }

  private async ensureEncoder() {
    if (this.encoder) return this.encoder;
    const { pipeline } = await import('@xenova/transformers');
    console.log('[corpus] loading MiniLM-L6-v2 encoder…');
    this.encoder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('[corpus] encoder ready');
    return this.encoder;
  }

  private async encode(text: string): Promise<Float32Array> {
    const enc = await this.ensureEncoder();
    const out  = await enc(text, { pooling: 'mean', normalize: true });
    return out.data as Float32Array;
  }

  private cosineAll(qv: Float32Array, limit: number): Float32Array {
    const sims = new Float32Array(limit);
    const dim  = this.dim;
    const emb  = this.emb!;
    for (let i = 0; i < limit; i++) {
      let s = 0;
      const off = i * dim;
      for (let d = 0; d < dim; d++) s += qv[d] * emb[off + d];
      sims[i] = s;
    }
    return sims;
  }

  async match(word: string, opts: { boost?: number } = {}): Promise<CorpusMatch> {
    const boost = opts.boost ?? 0.15;
    const s = (word || '').toLowerCase().trim();

    if (!s || this.rowCount === 0) {
      return { name: '', category: 'topic', cosine: 0, mode: 'cos', image_url: null };
    }

    // 1. Exact match
    const exactIdx = this.nameToIdx.get(s);
    if (exactIdx !== undefined) {
      const r = this.rows[exactIdx];
      return { name: r.name_en, category: r.category, cosine: 1.0, mode: 'exact', image_url: r.image_url ?? null };
    }

    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`);

    // 2. Word-boundary string scan (always available)
    let wordHitIdx = -1;
    for (let i = 0; i < this.rowCount; i++) {
      if (re.test(this.nameLowerArr[i])) { wordHitIdx = i; break; }
    }

    // 3. Cosine search with word-boundary boost (only when embeddings exist)
    if (this.hasEmbeddings && this.emb) {
      const embLimit = Math.floor(this.emb.length / this.dim);
      const sims = this.cosineAll(await this.encode(word), embLimit);

      let best = 0;
      let bestScore = -Infinity;
      let bestIsHit = false;
      for (let i = 0; i < embLimit; i++) {
        const hit   = re.test(this.nameLowerArr[i]);
        const score = sims[i] + (hit ? boost : 0);
        if (score > bestScore) { bestScore = score; best = i; bestIsHit = hit; }
      }
      const r = this.rows[best];
      return { name: r.name_en, category: r.category, cosine: sims[best], mode: bestIsHit ? 'word' : 'cos', image_url: r.image_url ?? null };
    }

    // Fallback: use the first word-boundary hit, or the exact-case scan
    const idx = wordHitIdx >= 0 ? wordHitIdx : 0;
    const r   = this.rows[idx];
    return { name: r.name_en, category: r.category, cosine: wordHitIdx >= 0 ? 0.8 : 0, mode: wordHitIdx >= 0 ? 'word' : 'cos', image_url: r.image_url ?? null };
  }

  async matchBatch(words: string[]): Promise<CorpusMatch[]> {
    return Promise.all(words.map((w) => this.match(w)));
  }
}

const _retriever = new _CorpusRetriever();
let _ready: Promise<void> | null = null;

export async function getCorpusRetriever(): Promise<_CorpusRetriever> {
  if (!_ready) _ready = _retriever.load();
  await _ready;
  return _retriever;
}
