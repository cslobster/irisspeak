// On-device engine: IrisSpeak-135M card model (ONNX, fp16) + trained reranker (3-layer MLP) +
// MiniLM question similarity. Ported from the vanilla demo; no network calls after the files are loaded.
import type * as OrtTypes from 'onnxruntime-web';
import { realiser } from './realiser';
// onnxruntime-web is loaded as a standalone script (public/ort/ort.min.js, see index.html) rather than
// bundled: its multi-threaded wasm worker cannot start from inside the Vite bundle.
declare const ort: typeof OrtTypes;
import { AutoTokenizer, pipeline, env } from '@huggingface/transformers';
import { getHistory, getProfile, getCustomWords } from './store';

export interface VocabCard {
  id: string; speak: string; category: string; intent: string;
  core: number; safety: number; composable: number; multiword: number; index: number;
  is_folder?: number; folder?: string; members?: string[];   // v3 folder rows (folder = Cboard folder path)
}
interface RerankerJson { K: number; dim: number; mu: number[]; sd: number[]; cats: string[]; ints: string[]; layers: { W: number[][]; b: number[] }[]; feature_order?: string[] }
interface FreqJson { uni: number[]; bi: Record<string, [number, number][]>; smoothing: number; lambda_bi: number }
type ImageMap = Record<string, { img?: string; emoji?: string }>;

const CDN_BASE = 'https://model.irisspeak.org/';
// Quick-fire row: seven answers that are always in the same cells (yes/no plus the words a child needs most
// often mid-conversation), as in TD Snap's Quick Fires. Fixed positions, never re-ranked.
export const CORE_LABELS = ['yes', 'no', "i don't know", 'help', 'more', 'stop', 'please'];
// Time-of-day prior (reranker bonus per vocabulary category). Meal times raise food and drink, after-school
// hours raise play, evenings raise home and body words. Small and additive, like the personal bonus.
export function timePrior(hour: number, weekday: boolean): Record<string, number> {
  const b: Record<string, number> = {};
  const add = (cats: string[], v: number) => { for (const c of cats) b[c] = Math.max(b[c] || 0, v); };
  if (hour >= 6 && hour < 9) add(['food', 'drink', 'clothes'], 0.4);
  if (hour >= 11 && hour < 14) add(['food', 'drink'], 0.4);
  if (hour >= 17 && hour < 20) add(['food', 'drink', 'home'], 0.4);
  if (hour >= 15 && hour < 18) add(['play', 'activities', 'things'], 0.3);
  if (hour >= 19 || hour < 6) add(['home', 'body', 'feelings'], 0.3);
  if (weekday && hour >= 8 && hour < 15) add(['school'], 0.3);
  return b;
}

class Engine {
  cards: VocabCard[] = []; byId: Record<string, VocabCard> = {}; byLabel: Record<string, VocabCard> = {}; images: ImageMap = {};
  private tok: any = null; private session: OrtTypes.InferenceSession | null = null; private startIdx = 0; private nOut = 0; private V = 49152;
  private dead: number[] = [];      // v3: rows masked out of the softmax at training time (reachable via search/folders only)
  folderRows: VocabCard[] = [];     // v3: the <folder:*> output rows
  private rr: RerankerJson | null = null; private freq: FreqJson | null = null; private cardVecs: Float32Array | null = null; private embed: any = null;
  private partnerVec: Float32Array | null = null; private partnerVecFor = '';
  private loading: Promise<void> | null = null;
  progress: { msg: string; frac: number } = { msg: 'Loading…', frac: 0 };
  onProgress: (p: { msg: string; frac: number }) => void = () => {};
  ready = false;

  private setLoad(msg: string, frac?: number) { this.progress = { msg, frac: frac ?? this.progress.frac }; this.onProgress(this.progress); }

  load(): Promise<void> {
    if (!this.loading) this.loading = this._load().catch(e => { this.loading = null; throw e; });
    return this.loading;
  }
  /** Model files come from the CDN bucket (model.irisspeak.org, cached at Cloudflare's edge); the site's
   *  own /model/ copy is the fallback. Downloaded bytes are kept in the browser's Cache Storage so a
   *  return visit does not download the 274 MB again. */
  private base = CDN_BASE;   // model bytes live on R2 (zero egress); irisspeak.com only serves the app shell
  private cache: Cache | null = null;
  private async pickBase() {
    // A small GET (not HEAD: R2 custom domains answer HEAD inconsistently) decides whether the CDN is reachable.
    try { const r = await fetch(CDN_BASE + 'manifest.json', { cache: 'no-store' }); if (!(r.ok && (await r.json()).chunks)) console.error('model CDN unreachable:', CDN_BASE); } catch (e) { console.error('model CDN unreachable:', e); }
    try {
      this.cache = await caches.open('irisspeak-model-v31');
      for (const k of await caches.keys()) if (k.startsWith('irisspeak-model-') && k !== 'irisspeak-model-v31') caches.delete(k).catch(() => {});
    } catch { this.cache = null; }
  }
  private async fetchBytes(name: string, onChunk?: (n: number) => void): Promise<Uint8Array> {
    const url = this.base + name;
    if (this.cache) { const hit = await this.cache.match(url); if (hit) { const b = new Uint8Array(await hit.arrayBuffer()); onChunk?.(b.length); return b; } }
    const r = await fetch(url); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    if (!r.body || !onChunk) { const b = new Uint8Array(await r.arrayBuffer()); onChunk?.(b.length); if (this.cache) this.cache.put(url, new Response(b, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {}); return b; }
    const reader = r.body.getReader(); const parts: Uint8Array[] = []; let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; onChunk(value.length); }
    const b = new Uint8Array(n); let o = 0; for (const p of parts) { b.set(p, o); o += p.length; }
    if (this.cache) this.cache.put(url, new Response(b, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {});
    return b;
  }
  /** Small metadata files keep their names across model versions, so they bypass the cache store and ask the CDN to revalidate. */
  private async fetchJson(name: string) {
    const r = await fetch(this.base + name, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return r.json();
  }
  private async _load() {
    this.setLoad('Loading vocabulary…', 0.02);
    await this.pickBase();
    const [meta, img] = await Promise.all([this.fetchJson('cards.json'), fetch('/card_images.json', { cache: 'no-cache' }).then(r => r.json())]);
    this.cards = meta.cards; this.startIdx = meta.start_index; this.nOut = meta.n_outputs; if (meta.V) this.V = meta.V; this.images = img;
    this.dead = meta.dead || [];
    this.cards.forEach((c, i) => { c.index = i; this.byId[c.id] = c; if (!c.is_folder) this.byLabel[c.speak.toLowerCase()] = c; });
    this.folderRows = this.cards.filter(c => c.is_folder);
    this.setLoad('Loading tokenizer…', 0.05);
    this.tok = await AutoTokenizer.from_pretrained('HuggingFaceTB/SmolLM2-135M-Instruct');
    const man = await this.fetchJson('manifest.json'); let got = 0;
    const report = (n: number) => { got += n; this.setLoad(`Downloading the model… ${(got / 1e6).toFixed(0)} / ${(man.total_bytes / 1e6).toFixed(0)} MB`, 0.05 + 0.9 * got / man.total_bytes); };
    // All chunks in parallel: much faster than one after another on a high-latency link.
    const parts: Uint8Array[] = await Promise.all((man.chunks as string[]).map(f => this.fetchBytes(f, report)));
    const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
    // onnxruntime is served from this origin: with cross-origin isolation on (see vercel.json) it spawns worker
    // threads, and a worker cannot load its wasm or its glue script from another origin. Only the model weights
    // come from R2. irisspeak.org has always run this way, which is why a prediction there takes ~250 ms.
    ort.env.wasm.wasmPaths = '/ort/'; ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
    this.setLoad('Starting the model…', 0.96);
    // No proxy worker: with cross-origin isolation the four wasm threads already keep a prediction near 250 ms,
    // and asking for the proxy as well made onnxruntime fail its backend init ('no available backend found'),
    // which a retry cannot recover from because the backend is only initialised once per page.
    this.session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
    this.setLoad('Ready', 1); this.ready = true;
    this.loadReranker(); // in the background; the model works without it
    // The realiser is only needed once the child asks for a sentence, so it loads when the browser is idle
    // rather than competing with the card model for CPU and bandwidth during the first turns.
    const idle = (window as any).requestIdleCallback || ((f: any) => setTimeout(f, 4000));
    idle(() => realiser.load(this.tok, n => this.fetchJson(n), n => this.fetchBytes(n)));
  }
  private async loadReranker() {
    try {
      const [r, f, cv] = await Promise.all([this.fetchJson('reranker.json'), this.fetchJson('freq.json'), this.fetchBytes('card_vecs.bin')]);
      const h = new Uint16Array(cv.buffer, cv.byteOffset, cv.byteLength / 2); const vecs = new Float32Array(h.length); for (let i = 0; i < h.length; i++) vecs[i] = f16(h[i]);
      env.allowLocalModels = false;
      // transformers.js ships its own onnxruntime build for MiniLM; serve that wasm from R2 too (zero egress),
      // using the exact file from the installed package so the JS glue and the wasm stay version-matched.
      try { (env.backends as any).onnx.wasm.wasmPaths = CDN_BASE + 'ort-hf/'; } catch {}
      this.embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' } as any);
      this.rr = r; this.freq = f; this.cardVecs = vecs;
    } catch (e) { console.error('reranker unavailable', e); this.rr = null; }
  }
  get rerankerReady() { return !!(this.rr && this.embed); }

  // ---- personal layer: words in the profile notes that are also cards get a bonus
  profileCards(): Set<string> {
    const out = new Set<string>(); const text = getProfile().notes || '';
    for (const w of getCustomWords()) { const c = this.byLabel[w.word.toLowerCase()]; if (c) out.add(c.id); }
    const words = text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
    const stop = new Set(['an', 'a', 'the', 'who', 'and', 'his', 'her', 'he', 'she', 'to', 'by', 'of', 'is', 'old', 'year', 'likes', 'like', 'goes', 'friends', 'friend', 'with', 'in', 'on', 'at']);
    for (let i = 0; i < words.length; i++) for (const cand of [words[i] + ' ' + (words[i + 1] || ''), words[i]]) {
      const w = cand.trim(); if (!w || stop.has(w)) continue; const c = this.byLabel[w] || this.byLabel[w.replace(/s$/, '')]; if (c && !c.core) out.add(c.id);
    }
    return out;
  }
  /** Card ids of a history turn; turns recorded by irisspeak.com carry foreign ids, so their words are mapped by label. */
  private historyIds(t: { cards: string[]; labels?: string[] }): string[] {
    return (t.cards || []).map((id, i) => this.byId[id] ? id : (t.labels?.[i] ? this.byLabel[t.labels[i].toLowerCase()]?.id : undefined)).filter((x): x is string => !!x);
  }
  private personalCounts(): Record<string, number> { const c: Record<string, number> = {}; for (const t of getHistory()) for (const id of this.historyIds(t)) c[id] = (c[id] || 0) + 1; return c; }
  /** The child's own card sequences: how often card `id` followed `prev` ('<start>' for the first card). */
  private personalBigrams(prev: string): Record<string, number> {
    const c: Record<string, number> = {};
    for (const t of getHistory()) { const seq = ['<start>', ...this.historyIds(t)]; for (let i = 1; i < seq.length; i++) if (seq[i - 1] === prev) c[seq[i]] = (c[seq[i]] || 0) + 1; }
    return c;
  }

  private promptText(question: string) {
    const hist = getHistory().map(t => (t.partner ? t.partner + ' | ' : '') + t.answer); let total = 0; const kept: string[] = [];
    // Two turns, not six. A long "Earlier:" block let past answers (water, thanks, good) outweigh the question
    // actually being asked, which is what buried the school subjects under everyday words.
    for (let i = hist.length - 1; i >= Math.max(0, hist.length - 2); i--) { const h = hist[i].slice(0, 120); if (total + h.length > 240) break; kept.unshift(h); total += h.length; }
    return `Setting: ${getProfile().setting || 'home'}.\n` + (kept.length ? `Earlier: ${kept.join(' | ')}\n` : '') + (question ? `Partner: ${question.slice(0, 200)}` : 'Partner: (nobody has spoken)') + `\nReply cards:`;
  }
  private freqLogp(prefixIdx: number[]) {
    const f = this.freq!; const uniSum = f.uni.reduce((a, b) => a + b, 0); const last = prefixIdx.length ? prefixIdx[prefixIdx.length - 1] : -1;
    const bi = f.bi[String(last)] || []; const biMap = new Map(bi); const biSum = bi.reduce((a, b) => a + b[1], 0) + f.smoothing * f.uni.length;
    return (j: number) => Math.log(f.lambda_bi * ((biMap.get(j) || f.smoothing) / biSum) + (1 - f.lambda_bi) * (f.uni[j] / uniSum));
  }
  private async rerank(order: number[], p: Float32Array, question: string, prefix: string[]): Promise<number[] | null> {
    if (!this.rr || !this.embed || !getProfile().use_reranker) return null;
    const rr = this.rr; let sim = (_j: number) => 0;
    if (question) {
      if (this.partnerVecFor !== question) { const out = await this.embed(question, { pooling: 'mean', normalize: true }); this.partnerVec = Float32Array.from(out.data); this.partnerVecFor = question; }
      const pv = this.partnerVec!, cv = this.cardVecs!; sim = j => { let d = 0; for (let k = 0; k < 384; k++) d += cv[j * 384 + k] * pv[k]; return d; };
    }
    const fl = this.freqLogp(prefix.map(c => this.byId[c].index)); const counts = this.personalCounts(); const profile = this.profileCards();
    const bigr = this.personalBigrams(prefix.length ? prefix[prefix.length - 1] : '<start>');
    const now = new Date(); const tp = timePrior(now.getHours(), now.getDay() >= 1 && now.getDay() <= 5);
    const top = order.slice(0, rr.K); const scores: [number, number][] = [];
    for (let r = 0; r < top.length; r++) {
      const j = top[r], c = this.cards[j]; const x = new Float32Array(rr.dim); let o = 0;
      const raw = [Math.log(p[j] + 1e-12), Math.log(r + 1), fl(j), sim(j)];
      for (let k = 0; k < 4; k++) x[o++] = (raw[k] - rr.mu[k]) / rr.sd[k];
      for (const cat of rr.cats) x[o++] = c.category === cat ? 1 : 0;
      for (const it of rr.ints) x[o++] = c.intent === it ? 1 : 0;
      x[o++] = c.core || 0; x[o++] = c.safety || 0; x[o++] = c.composable || 0; x[o++] = c.multiword || 0;
      x[o++] = c.id === '<aac_end>' ? 1 : 0; x[o++] = c.id === '<name>' ? 1 : 0; x[o++] = Math.min(prefix.length, 6) / 6; x[o++] = question ? 1 : 0;
      if (o < rr.dim) x[o++] = c.is_folder ? 1 : 0;   // v3 reranker (54 dims)
      let h: Float32Array = x;
      for (let li = 0; li < rr.layers.length; li++) { const L = rr.layers[li]; const y = new Float32Array(L.b.length); for (let i = 0; i < L.b.length; i++) { let acc = L.b[i]; const W = L.W[i]; for (let k = 0; k < W.length; k++) acc += W[k] * h[k]; y[i] = li < rr.layers.length - 1 ? Math.max(0, acc) : acc; } h = y; }
      const pc = counts[c.id] || 0, pb = bigr[c.id] || 0;
      // The personal layer is meant to reorder cards the model already finds plausible, not to resurrect ones it
      // doesn't: a child who said "water" a few times was getting Water on the board for "What did you learn?".
      // So the bonus fades with the model's own ranking and never applies to function words, which the fixed
      // quick row already covers.
      const w = Math.max(0, 1 - r / 60);
      const personal = c.core ? 0 : w * (0.3 * Math.log(1 + pc) + 0.25 * Math.log(1 + pb));
      scores.push([j, h[0] + personal + (profile.has(c.id) ? 0.8 : 0) + (tp[c.category] || 0)]);
    }
    scores.sort((a, b) => b[1] - a[1]); return scores.map(s => s[0]).concat(order.slice(rr.K));   // reranked top K, then the model's order
  }

  /** Ranked card indices (best first) and the model's probability vector for the current state. */
  async predict(question: string, prefix: string[]): Promise<{ ranked: number[]; p: Float32Array; endP: number }> {
    await this.load();
    const enc = await this.tok(this.promptText(question), { add_special_tokens: true }); const textIds: number[] = Array.from(enc.input_ids.data as ArrayLike<number | bigint>).map(Number);
    const ids = [...textIds, this.V + this.startIdx, ...prefix.map(c => this.V + this.byId[c].index).slice(-10)]; const L = ids.length;
    const feed: Record<string, OrtTypes.Tensor> = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, L]),
      attention_mask: new ort.Tensor('int64', BigInt64Array.from(ids.map(() => 1n)), [1, L]),
    };
    if (this.session!.inputNames.includes('position_ids')) feed.position_ids = new ort.Tensor('int64', BigInt64Array.from(ids.map((_, i) => BigInt(i))), [1, L]);
    const out = await this.session!.run(feed); const full = out.logits.data as Float32Array; const vocabExt = out.logits.dims[2];
    const logits = full.subarray((L - 1) * vocabExt + this.V, (L - 1) * vocabExt + this.V + this.nOut);
    for (const i of this.dead) logits[i] = -1e4;   // same mask the model was trained with
    let m = -Infinity; for (let i = 0; i < logits.length; i++) if (logits[i] > m) m = logits[i];
    let z = 0; const p = new Float32Array(logits.length);
    for (let i = 0; i < logits.length; i++) { p[i] = Math.exp(logits[i] - m); z += p[i]; } for (let i = 0; i < p.length; i++) p[i] /= z;
    const order = Array.from(p.keys()).sort((a, b) => p[b] - p[a]);
    const ranked = (await this.rerank(order, p, question, prefix)) || order;
    return { ranked, p, endP: p[this.byId['<aac_end>'].index] };
  }

  /** Turn tapped card ids into a spoken sentence with a fixed rule (no language model involved). */
  realise(ids: string[]): string {
    const PROPER = /^(I|I'.*|I .*|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Christmas|Easter|Halloween|Thanksgiving|Mum|Mom|Dad|Grandma|Grandpa|Nan|Nana|Pop|God|Jesus|YouTube|Minecraft|Roblox|Lego|iPad|TV|McDonald's|Disney|America|England|Australia|Canada|USA|UK|New .*|North .*|South .*|London|Paris|Europe|Africa|Asia|Arctic)$/;
    const words = ids.map(id => { const w = this.byId[id]?.speak ?? id; return PROPER.test(w) ? w : w.toLowerCase(); });
    let s = words.join(' ').replace(/\s+([,.!?])/g, '$1');
    if (['yes', 'no', 'maybe', 'ok', 'sure'].includes(words[0]?.toLowerCase()) && words.length > 1) s = words[0] + ', ' + words.slice(1).join(' ');
    s = s.charAt(0).toUpperCase() + s.slice(1); if (!/[.!?]$/.test(s)) s += '.'; return s;
  }
}
function f16(h: number) { const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff; if (e === 0) return s * m * Math.pow(2, -24); if (e === 31) return m ? NaN : s * Infinity; return s * (1 + m / 1024) * Math.pow(2, e - 15); }

export const engine = new Engine();
