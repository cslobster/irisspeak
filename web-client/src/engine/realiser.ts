// The on-device sentence realiser: a small causal LM (SmolLM2-135M fine-tuned by train/train_realiser.py) that turns
// the tapped cards plus the partner's question into one sentence, decoded with a KV cache and a hard vocabulary
// constraint: only the card words (and their inflections), a list of function words, and punctuation may appear,
// so the model can add "I", "a", "want", "to" but never a new content word. Replaces the cloud /api/sentence call.
import { inflect, type WordForm } from './grammar';
declare const ort: any;

// Words the model may add freely: pronouns, articles, auxiliaries, prepositions, politeness. Negations and question
// words are NOT here — they change the meaning, so they are only allowed when a tapped card supplies them
// (a "not"/"no"/"don't" card unlocks the whole negation family).
export const FUNCTION_WORDS = ("i me my mine you your yours we us our he him his she her hers it its they them their this that these those there here " +
  "a an the some any to of in on at for with from by about up down out off over into and or but so because if yes " +
  "do does did can could will would should may might must is am are was were be been being have has had having " +
  "want wants wanted need needs needed like likes liked get got go going went let let's please thank thanks very really too also more again now today tomorrow yesterday " +
  "okay ok all just still only than then one it's i'm i've i'll i'd you're we're they're he's she's that's there's").split(' ');
export const NEGATIONS = "not no n't don't doesn't didn't can't couldn't won't wouldn't shouldn't isn't aren't wasn't weren't haven't hasn't never".split(' ');
const PUNCT = ['.', ',', '!', '?', "'", "'s", "'m", "'re", "'ll", "'ve", "'d", ' .', ' ,', ' !', ' ?', '. ', '! ', '? '];
const ALL_FORMS: WordForm[] = ['plural', 'past', 'ing', 'third', 'possessive'];

interface Manifest { chunks: string[]; total_bytes: number; layers: number; kv_heads: number; head_dim: number; version?: string }

export class Realiser {
  private session: any = null; private tok: any = null; private man: Manifest | null = null;
  private eos: number[] = []; private punctIds: Set<number> = new Set(); private tokenCache = new Map<string, number[]>();
  ready = false;

  /** Load in the background once the card model is up; `fetchBytes`/`fetchJson` are the engine's CDN helpers. */
  async load(tok: any, fetchJson: (n: string) => Promise<any>, fetchBytes: (n: string) => Promise<Uint8Array>) {
    try {
      this.tok = tok;
      this.man = await fetchJson('realiser_manifest.json');
      const parts = await Promise.all(this.man!.chunks.map(f => fetchBytes(f)));
      const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
      this.session = await ort.InferenceSession.create(buf, { executionProviders: (globalThis as any).__ortEP || ['wasm'] });   // __ortEP: node tests use 'cpu'
      this.eos = [...new Set([...this.ids('\n'), ...(tok.model?.eos_token_id != null ? [tok.model.eos_token_id] : []), 0, 2])];
      for (const p of PUNCT) for (const id of this.ids(p)) this.punctIds.add(id);
      this.ready = true;
    } catch (e) { console.error('realiser unavailable', e); this.ready = false; }
    console.info('realiser ready', this.ready, this.man && this.man.version);
  }

  private ids(text: string): number[] {
    let v = this.tokenCache.get(text);
    if (!v) { v = Array.from(this.tok.encode(text, { add_special_tokens: false }) as number[]); this.tokenCache.set(text, v); }
    return v;
  }
  /** Every token id any surface form of `word` can be spelt with (leading space, capitalised, lower, inflected). */
  private wordIds(word: string, out: Set<number>, withForms: boolean) {
    const forms = new Set<string>([word]);
    const w = word.trim(); if (!w) return;
    forms.add(w.toLowerCase()); forms.add(w[0].toUpperCase() + w.slice(1).toLowerCase());
    if (withForms) for (const f of ALL_FORMS) { const x = inflect(w, f); if (x) { forms.add(x); forms.add(x.toLowerCase()); forms.add(x[0].toUpperCase() + x.slice(1)); } }
    for (const f of forms) for (const v of [f, ' ' + f]) for (const id of this.ids(v)) out.add(id);
  }

  /** The sentence for the tapped cards, or null when the realiser is not loaded. With `sample`, tokens are drawn
   *  from the top of the allowed distribution (temperature 0.9, top 8) so "Another" yields a different wording; up to
   *  four draws are tried to find one not in `avoid`. */
  async realise(cards: string[], partner: string, opts: { avoid?: string[]; sample?: boolean; maxNew?: number } = {}): Promise<string | null> {
    if (!this.ready || !cards.length) return null;
    const avoid = new Set((opts.avoid || []).map(x => x.toLowerCase()));
    for (let attempt = 0; attempt < (opts.sample ? 4 : 1); attempt++) {
      const s = await this.decode(cards, partner, opts.maxNew ?? 20, !!opts.sample);
      if (s && !avoid.has(s.toLowerCase())) return s;
    }
    return null;
  }

  private async decode(cards: string[], partner: string, maxNew: number, sample: boolean): Promise<string | null> {
    const allowed = new Set<number>(this.punctIds); for (const id of this.eos) allowed.add(id);
    for (const c of cards) this.wordIds(c, allowed, true);
    for (const f of FUNCTION_WORDS) this.wordIds(f, allowed, false);
    if (cards.some(c => NEGATIONS.includes(c.toLowerCase().trim()) || /n't$/.test(c.toLowerCase()))) for (const f of NEGATIONS) this.wordIds(f, allowed, false);
    const prompt = `Partner: ${partner?.trim() ? partner.trim() : '(nobody has spoken)'}\nCards: ${cards.join(' | ')}\nSentence:`;
    const ids = this.ids(prompt);
    const man = this.man!; const L0 = ids.length;
    // First pass over the prompt with an empty cache, then one token at a time.
    let feeds: Record<string, any> = this.feed(ids, 0, L0, this.emptyPast());
    const out: number[] = []; let lastTok = -1, repeat = 0;
    for (let step = 0; step < maxNew; step++) {
      const res = await this.session.run(feeds);
      const logits: Float32Array = res.logits.data; const V = res.logits.dims[2]; const row = (res.logits.dims[1] - 1) * V;
      let best = -1, bestV = -Infinity;
      if (sample) {
        // top-8 of the allowed tokens at temperature 0.9
        const top: [number, number][] = [];
        for (const id of allowed) { const v = logits[row + id]; if (top.length < 8) { top.push([id, v]); top.sort((a, b) => b[1] - a[1]); } else if (v > top[7][1]) { top[7] = [id, v]; top.sort((a, b) => b[1] - a[1]); } }
        const m = top[0][1]; const w = top.map(([, v]) => Math.exp((v - m) / 0.9)); const z = w.reduce((a, b) => a + b, 0);
        let r = Math.random() * z; best = top[top.length - 1][0];
        for (let i = 0; i < top.length; i++) { r -= w[i]; if (r <= 0) { best = top[i][0]; break; } }
      } else {
        for (const id of allowed) { const v = logits[row + id]; if (v > bestV) { bestV = v; best = id; } }
      }
      if (best < 0 || this.eos.includes(best)) break;
      repeat = best === lastTok ? repeat + 1 : 0; lastTok = best; if (repeat >= 2) break;
      out.push(best);
      const past: Record<string, any> = {}; for (const k of Object.keys(res)) if (k.startsWith('present.')) past['past_key_values.' + k.slice(8)] = res[k];
      feeds = this.feed([best], L0 + out.length - 1, L0 + out.length, past);
    }
    if (!out.length) return null;
    const raw = String(this.tok.decode(out, { skip_special_tokens: true }));
    console.info('realiser', JSON.stringify({ cards, partner, allowed: allowed.size, tokens: out, raw }));
    let s = raw.replace(/<\|[^|]*\|>/g, '').split('\n')[0].trim().replace(/^["“”']+|["“”']+$/g, '').trim();
    if (!s) return null;
    s = s.replace(/\s+([,.!?])/g, '$1'); s = s[0].toUpperCase() + s.slice(1); if (!/[.!?]$/.test(s)) s += '.';
    return s;
  }

  private feed(tokens: number[], pos0: number, total: number, past: Record<string, any>) {
    const T = tokens.length;
    return {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(tokens.map(BigInt)), [1, T]),
      attention_mask: new ort.Tensor('int64', new BigInt64Array(total).fill(1n), [1, total]),
      position_ids: new ort.Tensor('int64', BigInt64Array.from(Array.from({ length: T }, (_, i) => BigInt(pos0 + i))), [1, T]),
      ...past,
    };
  }
  private emptyPast() {
    const past: Record<string, any> = {}; const m = this.man!;
    for (let l = 0; l < m.layers; l++) for (const kv of ['key', 'value']) past[`past_key_values.${l}.${kv}`] = new ort.Tensor('float32', new Float32Array(0), [1, m.kv_heads, 0, m.head_dim]);
    return past;
  }
}
export const realiser = new Realiser();
