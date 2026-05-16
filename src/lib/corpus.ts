/**
 * Local corpus retriever — MiniLM-L6-v2 + search_smart.
 *
 * Loads on first call:
 *   data/corpus_vocabulary.csv            → ~2,002 rows: category, name_en, description_brief
 *   data/minilm_name_embeddings.bin      → (6658, 384) float32, L2-normalized
 *   data/minilm_name_embeddings.meta.json
 *
 * Per query:
 *   1. exact full-string lookup       — O(1)
 *   2. whole-word boundary regex      — pandas-style
 *   3. cosine + word-boundary boost   — MiniLM forward pass + dot-product
 */
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import type { CardCategory } from './types';

export interface CorpusMatch {
  name: string;
  category: string;
  cosine: number;
  mode: 'exact' | 'word' | 'cos';
}

interface CsvRow {
  category: string;
  name_en: string;
  description_brief?: string;
}

class _CorpusRetriever {
  private rows: CsvRow[] = [];
  private emb!: Float32Array;            // length = rows * dim
  private rowCount = 0;
  private dim = 0;
  private nameToIdx = new Map<string, number>();
  private nameLowerArr: string[] = [];   // lowercased names for substring scans
  private encoder: any = null;            // loaded lazily — heavy first call

  async load(dataDir: string = path.join(process.cwd(), 'data')) {
    if (this.rowCount > 0) return;

    const csvPath = path.join(dataDir, 'corpus_vocabulary.csv');
    const binPath = path.join(dataDir, 'minilm_name_embeddings.bin');
    const metaPath = path.join(dataDir, 'minilm_name_embeddings.meta.json');

    if (!fs.existsSync(csvPath) || !fs.existsSync(binPath) || !fs.existsSync(metaPath)) {
      throw new Error(`corpus assets missing — expected ${csvPath} + ${binPath}`);
    }

    const csvText = fs.readFileSync(csvPath, 'utf-8');
    const parsed = Papa.parse<CsvRow>(csvText, { header: true, skipEmptyLines: true });
    this.rows = parsed.data.filter((r) => r.name_en);

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    this.rowCount = meta.rows;
    this.dim = meta.dim;

    if (this.rows.length !== this.rowCount) {
      console.warn(`[corpus] CSV rows (${this.rows.length}) != embedding rows (${this.rowCount}) — trimming`);
      this.rows = this.rows.slice(0, this.rowCount);
    }

    const buf = fs.readFileSync(binPath);
    // Float32Array from Buffer (handles aligned byteOffset)
    this.emb = new Float32Array(buf.buffer, buf.byteOffset, this.rowCount * this.dim);

    for (let i = 0; i < this.rows.length; i++) {
      const lower = this.rows[i].name_en.toLowerCase();
      this.nameLowerArr.push(lower);
      this.nameToIdx.set(lower, i);
    }

    console.log(`[corpus] loaded ${this.rows.length} rows × ${this.dim}-d embeddings`);
  }

  private async ensureEncoder() {
    if (this.encoder) return this.encoder;
    const { pipeline } = await import('@xenova/transformers');
    console.log('[corpus] loading MiniLM-L6-v2 encoder…');
    this.encoder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('[corpus] encoder ready');
    return this.encoder;
  }

  /** Encode + L2-normalize a single string. Returns Float32Array(dim). */
  private async encode(text: string): Promise<Float32Array> {
    const enc = await this.ensureEncoder();
    const out = await enc(text, { pooling: 'mean', normalize: true });
    return out.data as Float32Array;
  }

  /** dotProduct(qv, emb[i*dim..(i+1)*dim]) for all rows; returns Float32Array(rowCount). */
  private cosineAll(qv: Float32Array): Float32Array {
    const sims = new Float32Array(this.rowCount);
    const dim = this.dim;
    const emb = this.emb;
    for (let i = 0; i < this.rowCount; i++) {
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
    if (!s) {
      return { name: this.rows[0].name_en, category: this.rows[0].category, cosine: 0, mode: 'cos' };
    }

    // 1. exact full-string match
    const exactIdx = this.nameToIdx.get(s);
    if (exactIdx !== undefined) {
      const r = this.rows[exactIdx];
      return { name: r.name_en, category: r.category, cosine: 1.0, mode: 'exact' };
    }

    // 2 + 3. cosine + word-boundary boost
    const qv = await this.encode(word);
    const sims = this.cosineAll(qv);

    // word-boundary mask
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`);

    let best = 0;
    let bestScore = -Infinity;
    let bestIsHit = false;
    for (let i = 0; i < this.rowCount; i++) {
      const hit = re.test(this.nameLowerArr[i]);
      const score = sims[i] + (hit ? boost : 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
        bestIsHit = hit;
      }
    }
    const r = this.rows[best];
    return {
      name: r.name_en,
      category: r.category,
      cosine: sims[best],
      mode: bestIsHit ? 'word' : 'cos',
    };
  }

  async matchBatch(words: string[]): Promise<CorpusMatch[]> {
    return Promise.all(words.map((w) => this.match(w)));
  }
}

// Single shared instance, loaded lazily.
const _retriever = new _CorpusRetriever();
let _ready: Promise<void> | null = null;

export async function getCorpusRetriever(): Promise<_CorpusRetriever> {
  if (!_ready) _ready = _retriever.load();
  await _ready;
  return _retriever;
}
