"""Score the exported realiser the way the apps decode it: KV cache, greedy, vocabulary constrained to the card words
(+ inflections), function words and punctuation. Reports exact match, card coverage, and 'no invented content word'.
Usage: python3 eval/realiser_eval.py --onnx export/out_realiser/onnx/model.onnx --n 400 [--show 15]
"""
import os, sys, json, argparse, re, time, random
import numpy as np, onnxruntime as ort
from transformers import AutoTokenizer
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(ROOT, "data"))
FUNC = ("i me my mine you your yours we us our he him his she her hers it its they them their this that these those there here a an the some any to of in on at for with from by about up down out off over into and or but so because if not no yes do does did don't doesn't didn't can can't could couldn't will won't would wouldn't should shouldn't may might must is am are was were be been being isn't aren't wasn't weren't have has had haven't hasn't having want wants wanted need needs needed like likes liked get got go going went let let's please thank thanks very really too also more again now today tomorrow yesterday okay ok all just still only than then when what where who how why which one it's i'm i've i'll i'd you're we're they're he's she's that's there's").split()
PUNCT = [".", ",", "!", "?", "'", "'s", "'m", "'re", "'ll", "'ve", "'d", "n't", " .", " ,", " !", " ?", ". ", "! ", "? "]
IRR_PAST = {"go": "went", "eat": "ate", "drink": "drank", "see": "saw", "come": "came", "run": "ran", "sit": "sat", "sleep": "slept", "get": "got", "give": "gave", "have": "had", "make": "made", "take": "took", "is": "was", "are": "were", "am": "was", "can": "could", "will": "would", "want": "wanted", "like": "liked", "do": "did", "say": "said", "feel": "felt", "buy": "bought", "think": "thought"}
def forms(w):
    lw = w.lower(); out = {lw, lw + "s", lw + "es", lw + "ed", lw + "d", lw + "ing", lw + "'s"}
    if lw.endswith("e"): out.add(lw[:-1] + "ing")
    if lw.endswith("y"): out |= {lw[:-1] + "ies", lw[:-1] + "ied"}
    if lw in IRR_PAST: out.add(IRR_PAST[lw])
    return out
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--onnx", required=True); ap.add_argument("--tok", default=None); ap.add_argument("--n", type=int, default=400); ap.add_argument("--show", type=int, default=15); ap.add_argument("--split", default="test"); ap.add_argument("--probe", default=None, help="JSON list of {cards, partner, setting} to realise instead of scoring"); a = ap.parse_args()
    tok = AutoTokenizer.from_pretrained(a.tok or os.path.dirname(a.onnx)); s = ort.InferenceSession(a.onnx, providers=["CPUExecutionProvider"])
    names = [i.name for i in s.get_inputs()]; layers = sum(1 for n in names if n.endswith(".key")); kvs = [i.shape for i in s.get_inputs() if i.name == "past_key_values.0.key"][0]
    kv_heads, head_dim = kvs[1], kvs[3]; outs = [o.name for o in s.get_outputs()]
    enc = lambda t: tok(t, add_special_tokens=False)["input_ids"]
    eos = set(enc("\n") + [tok.eos_token_id, 0, 2]); punct = {i for p in PUNCT for i in enc(p)}
    def word_ids(w, out, with_forms):
        fs = {w, w.lower(), w[:1].upper() + w[1:].lower()}
        if with_forms: fs |= {f for x in forms(w) for f in (x, x[:1].upper() + x[1:])}
        for f in fs:
            for v in (f, " " + f): out.update(enc(v))
    func_ids = set(); [word_ids(f, func_ids, False) for f in FUNC]
    def realise(cards, partner, setting='unknown'):
        allowed = set(punct) | eos | func_ids
        for c in cards: word_ids(c, allowed, True)
        allowed = np.array(sorted(allowed))
        ids = enc(f"Setting: {setting or 'unknown'}.\nPartner: {partner.strip() if partner else '(nobody has spoken)'}\nCards: {' | '.join(cards)}\nSentence:")
        past = {f"past_key_values.{l}.{kv}": np.zeros((1, kv_heads, 0, head_dim), dtype=np.float32) for l in range(layers) for kv in ("key", "value")}
        def feed(toks, pos0, total, past):
            f = dict(past); f["input_ids"] = np.array([toks], dtype=np.int64); f["attention_mask"] = np.ones((1, total), dtype=np.int64); f["position_ids"] = np.array([[pos0 + i for i in range(len(toks))]], dtype=np.int64); return f
        f = feed(ids, 0, len(ids), past); out = []; last = -1; rep = 0
        for _ in range(20):
            r = dict(zip(outs, s.run(None, f))); lg = r["logits"][0, -1]
            best = int(allowed[np.argmax(lg[allowed])])
            if best in eos: break
            rep = rep + 1 if best == last else 0; last = best
            if rep >= 2: break
            out.append(best); past = {"past_key_values." + k[8:]: v for k, v in r.items() if k.startswith("present.")}
            f = feed([best], len(ids) + len(out) - 1, len(ids) + len(out), past)
        t = tok.decode(out, skip_special_tokens=True).split("\n")[0].strip().strip('"“”\'').strip()
        if not t: return ""
        t = re.sub(r"\s+([,.!?])", r"\1", t); t = t[0].upper() + t[1:]
        return t if re.search(r"[.!?]$", t) else t + "."
    if a.probe:   # hand-written cases: same cards, different setting/partner, to see the context actually used
        for e in json.load(open(a.probe)):
            print(f"  [{e.get('setting','unknown'):<8}] {e.get('partner') or '(nobody)':<34} {' | '.join(e['cards']):<34} -> {realise(e['cards'], e.get('partner'), e.get('setting'))}")
        return
    exs = [json.loads(l) for l in open(os.path.join(ROOT, "data", "realiser", f"{a.split}.jsonl"))]; random.seed(5); random.shuffle(exs); exs = exs[: a.n]
    em = cov = clean = 0; lat = []; samples = []
    for e in exs:
        t0 = time.time(); out = realise(e["cards"], e.get("partner"), e.get("setting")); lat.append(time.time() - t0)
        words = re.findall(r"[a-z']+", out.lower()); wset = set(words)
        allowed_words = set(FUNC) | {f for c in e["cards"] for w in re.findall(r"[a-z']+", c.lower()) for f in forms(w)}
        em += int(out.lower() == e["sentence"].lower())
        cov += int(all(any(f in wset for f in forms(w)) for c in e["cards"] for w in re.findall(r"[a-z']+", c.lower())))
        clean += int(all(w in allowed_words or len(w) <= 2 for w in words))
        if len(samples) < a.show: samples.append(f"  {str(e.get('partner') or '')[:40]:40s} | {' | '.join(e['cards'])[:40]:40s} -> {out}   [gold: {e['sentence']}]")
    n = len(exs); print(f"{a.split} n={n}: exact {em/n:.3f}  all cards used {cov/n:.3f}  no invented content word {clean/n:.3f}  {np.median(lat)*1000:.0f} ms/sentence (Mac CPU)")
    print("\n".join(samples))
if __name__ == "__main__": main()
