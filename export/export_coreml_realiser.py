"""Export the sentence realiser to Core ML: a fixed right-padded window (default 64 tokens), inputs input_ids /
attention_mask (int32 [1, W]), output `logits` ([1, W, vocab]); the app re-runs the window for every generated token
(no KV cache: at 135M that is ~10-20 ms a step on the Neural Engine, and it keeps the model stateless).
Parity: the app's constrained greedy decode on held-out pairs, compared with the ONNX (fp32, KV-cache) decoder.
Usage: python3 export/export_coreml_realiser.py --hf train/out/realiser_135m_v2e2/hf_realiser --onnx export/out_realiser/onnx/model.onnx --out export/out_realiser/coreml --precision fp16 --n 120
"""
import os, sys, json, argparse, random, re, time
import numpy as np, torch
import coremltools as ct
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(ROOT, "eval"))
from transformers import AutoTokenizer, AutoModelForCausalLM

class Windowed(torch.nn.Module):
    def __init__(self, lm): super().__init__(); self.lm = lm
    def forward(self, input_ids, attention_mask):
        L = input_ids.shape[1]
        causal = torch.tril(torch.ones(L, L, dtype=torch.bool))
        allowed = causal[None, None] & (attention_mask[:, None, None, :] > 0)
        mask4 = torch.where(allowed, torch.zeros((), dtype=torch.float32), torch.full((), -1e4, dtype=torch.float32))
        return self.lm(input_ids=input_ids, attention_mask=mask4, use_cache=False).logits

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--hf", required=True); ap.add_argument("--onnx", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--window", type=int, default=64); ap.add_argument("--precision", default="fp16", choices=["fp16", "fp32"]); ap.add_argument("--n", type=int, default=120); ap.add_argument("--name", default="IrisSpeakRealiser"); a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True); W = a.window
    tok = AutoTokenizer.from_pretrained(a.hf); lm = AutoModelForCausalLM.from_pretrained(a.hf, dtype=torch.float32, attn_implementation="eager").eval()
    wrap = Windowed(lm).eval(); ex = tok("Partner: hi\nCards: a\nSentence:")["input_ids"]
    ids = torch.zeros(1, W, dtype=torch.int32); ids[0, :len(ex)] = torch.tensor(ex, dtype=torch.int32); mask = torch.zeros(1, W, dtype=torch.int32); mask[0, :len(ex)] = 1
    with torch.no_grad(): traced = torch.jit.trace(wrap, (ids, mask), check_trace=False)
    prec = ct.precision.FLOAT16 if a.precision == "fp16" else ct.precision.FLOAT32
    ml = ct.convert(traced, convert_to="mlprogram", compute_precision=prec, minimum_deployment_target=ct.target.iOS18,
                    inputs=[ct.TensorType(name="input_ids", shape=(1, W), dtype=np.int32), ct.TensorType(name="attention_mask", shape=(1, W), dtype=np.int32)],
                    outputs=[ct.TensorType(name="logits", dtype=np.float16 if a.precision == "fp16" else np.float32)], compute_units=ct.ComputeUnit.ALL)
    ml.user_defined_metadata["window"] = str(W); ml.user_defined_metadata["precision"] = a.precision
    path = os.path.join(a.out, f"{a.name}_{a.precision}.mlpackage"); ml.save(path)
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(path) for f in fs); print(f"saved {path} ({size/1e6:.0f} MB)", flush=True)

    # ---- parity: the app's constrained decode, Core ML window vs ONNX KV cache
    import onnxruntime as ort
    from realiser_eval import FUNC, PUNCT, forms
    s = ort.InferenceSession(a.onnx, providers=["CPUExecutionProvider"]); outs = [o.name for o in s.get_outputs()]
    enc = lambda t: tok(t, add_special_tokens=False)["input_ids"]
    eos = set(enc("\n") + [tok.eos_token_id, 0, 2]); punct = {i for p in PUNCT for i in enc(p)}
    NEG = "not no n't don't doesn't didn't can't couldn't won't wouldn't shouldn't isn't aren't wasn't weren't haven't hasn't never".split()
    def word_ids(w, out, with_forms):
        fs = {w, w.lower(), w[:1].upper() + w[1:].lower()}
        if with_forms: fs |= {f for x in forms(w) for f in (x, x[:1].upper() + x[1:])}
        for f in fs:
            for v in (f, " " + f): out.update(enc(v))
    func_ids = set(); [word_ids(f, func_ids, False) for f in FUNC]; neg_ids = set(); [word_ids(f, neg_ids, False) for f in NEG]
    def allowed_for(cards):
        al = set(punct) | eos | func_ids
        for c in cards: word_ids(c, al, True)
        if any(c.lower().strip() in NEG or c.lower().endswith("n't") for c in cards): al |= neg_ids
        return np.array(sorted(al))
    def finish(out):
        t = tok.decode(out, skip_special_tokens=True).split("\n")[0].strip().strip('"“”\'').strip()
        if not t: return ""
        t = re.sub(r"\s+([,.!?])", r"\1", t); t = t[0].upper() + t[1:]; return t if re.search(r"[.!?]$", t) else t + "."
    def prompt_ids(cards, partner): return enc(f"Partner: {partner.strip() if partner else '(nobody has spoken)'}\nCards: {' | '.join(cards)}\nSentence:")
    def decode_onnx(cards, partner):
        ids = prompt_ids(cards, partner); al = allowed_for(cards)
        past = {f"past_key_values.{l}.{kv}": np.zeros((1, 3, 0, 64), dtype=np.float32) for l in range(30) for kv in ("key", "value")}
        def feed(t, p0, total, past):
            f = dict(past); f["input_ids"] = np.array([t], dtype=np.int64); f["attention_mask"] = np.ones((1, total), dtype=np.int64); f["position_ids"] = np.array([[p0 + i for i in range(len(t))]], dtype=np.int64); return f
        f = feed(ids, 0, len(ids), past); out = []; last = -1; rep = 0
        for _ in range(20):
            r = dict(zip(outs, s.run(None, f))); best = int(al[np.argmax(r["logits"][0, -1][al])])
            if best in eos: break
            rep = rep + 1 if best == last else 0; last = best
            if rep >= 2: break
            out.append(best); past = {"past_key_values." + k[8:]: v for k, v in r.items() if k.startswith("present.")}; f = feed([best], len(ids) + len(out) - 1, len(ids) + len(out), past)
        return finish(out)
    def decode_coreml(cards, partner):
        ids = prompt_ids(cards, partner)[-(W - 20):]; al = allowed_for(cards); out = []; last = -1; rep = 0
        for _ in range(20):
            seq = ids + out
            if len(seq) >= W: break
            ii = np.zeros((1, W), dtype=np.int32); mm = np.zeros((1, W), dtype=np.int32); ii[0, :len(seq)] = seq; mm[0, :len(seq)] = 1
            lg = np.asarray(ml.predict({"input_ids": ii, "attention_mask": mm})["logits"])[0, len(seq) - 1].astype(np.float32)
            best = int(al[np.argmax(lg[al])])
            if best in eos: break
            rep = rep + 1 if best == last else 0; last = best
            if rep >= 2: break
            out.append(best)
        return finish(out)
    exs = [json.loads(l) for l in open(os.path.join(ROOT, "data", "realiser", "test.jsonl"))]; random.seed(5); random.shuffle(exs); exs = exs[: a.n]
    same = cov = clean = 0; lat = []; diffs = []
    for e in exs:
        ref = decode_onnx(e["cards"], e.get("partner")); t0 = time.time(); got = decode_coreml(e["cards"], e.get("partner")); lat.append(time.time() - t0)
        same += int(ref == got); words = re.findall(r"[a-z']+", got.lower()); wset = set(words)
        allowed_words = set(FUNC) | set(NEG) | {f for c in e["cards"] for w in re.findall(r"[a-z']+", c.lower()) for f in forms(w)}
        cov += int(all(any(f in wset for f in forms(w)) for c in e["cards"] for w in re.findall(r"[a-z']+", c.lower()))); clean += int(all(w in allowed_words or len(w) <= 2 for w in words))
        if ref != got and len(diffs) < 6: diffs.append(f"    {' | '.join(e['cards'])[:36]:36s} onnx: {ref}  |  coreml: {got}")
    n = len(exs); print(f"{a.precision} window {W}: same sentence as ONNX {same/n:.3f}, all cards used {cov/n:.3f}, no invented word {clean/n:.3f}, {np.median(lat)*1000:.0f} ms/sentence on the Mac", flush=True)
    print("\n".join(diffs))
if __name__ == "__main__": main()
