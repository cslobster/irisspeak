"""Fine-tune a small causal LM as the sentence realiser: prompt = partner question + tapped cards, target = sentence.
Loss on the target tokens only. Saves an HF model dir (for optimum ONNX export with KV cache) plus results.json.
Usage (Modal): python3 train/train_realiser.py --model HuggingFaceTB/SmolLM2-135M-Instruct --out /vol/realiser_135m --epochs 4
"""
import os, sys, json, argparse, random, time, math, re
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def prompt(ex):
    """Place, then what the partner asked, then the cards the child tapped. The place and the question are what
    turn a pile of words into an answer ("Setting: doctor." + "Where does it hurt?" + "arm" -> "My arm hurts")."""
    p = f"Setting: {ex.get('setting') or 'unknown'}.\n"
    p += f"Partner: {ex['partner']}\n" if ex.get("partner") else "Partner: (nobody has spoken)\n"
    return p + "Cards: " + " | ".join(ex["cards"]) + "\nSentence:"

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--model", default="HuggingFaceTB/SmolLM2-135M-Instruct"); ap.add_argument("--out", required=True)
    ap.add_argument("--data", default=os.path.join(ROOT, "data", "realiser")); ap.add_argument("--epochs", type=int, default=4); ap.add_argument("--bs", type=int, default=32)
    ap.add_argument("--lr", type=float, default=8e-5); ap.add_argument("--max-len", type=int, default=96); ap.add_argument("--eval-n", type=int, default=400); a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True); dev = "cuda" if torch.cuda.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(a.model); tok.padding_side = "right"
    if tok.pad_token_id is None: tok.pad_token = tok.eos_token
    model = AutoModelForCausalLM.from_pretrained(a.model, dtype=torch.float32).to(dev)
    load = lambda s: [json.loads(l) for l in open(os.path.join(a.data, f"{s}.jsonl"))]
    train, devset, test = load("train"), load("dev"), load("test")
    print(f"train {len(train)} dev {len(devset)} test {len(test)} on {dev}", flush=True)

    def batch(exs):
        ids, labels = [], []
        for ex in exs:
            p = tok(prompt(ex))["input_ids"]; t = tok(" " + ex["sentence"])["input_ids"] + [tok.eos_token_id]
            seq = (p + t)[: a.max_len]; lab = ([-100] * len(p) + t)[: a.max_len]
            ids.append(seq); labels.append(lab)
        L = max(len(s) for s in ids)
        pad = lambda s, v: s + [v] * (L - len(s))
        return (torch.tensor([pad(s, tok.pad_token_id) for s in ids], device=dev), torch.tensor([pad(s, 0) for s in [[1] * len(s) for s in ids]], device=dev),
                torch.tensor([pad(s, -100) for s in labels], device=dev))

    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.01)
    steps_total = a.epochs * math.ceil(len(train) / a.bs); step = 0
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / 100) * max(0.05, 1 - s / steps_total))
    rng = random.Random(0); t0 = time.time()
    for ep in range(a.epochs):
        rng.shuffle(train); model.train()
        for i in range(0, len(train), a.bs):
            ids, mask, lab = batch(train[i:i + a.bs])
            with torch.autocast(device_type=dev, dtype=torch.bfloat16, enabled=dev == "cuda"):
                loss = model(input_ids=ids, attention_mask=mask, labels=lab).loss
            loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step(); sched.step(); opt.zero_grad(); step += 1
            if step % 50 == 0: print(f"step {step}/{steps_total} loss {loss.item():.3f} {(time.time()-t0)/step:.2f}s/step", flush=True)
        res = evaluate(model, tok, devset[: a.eval_n], dev, "dev"); print(f"epoch {ep+1}: {res}", flush=True)
    model.save_pretrained(os.path.join(a.out, "hf_realiser")); tok.save_pretrained(os.path.join(a.out, "hf_realiser"))
    results = {"dev": evaluate(model, tok, devset[: a.eval_n], dev, "dev"), "test": evaluate(model, tok, test[: a.eval_n], dev, "test", show=12), "model": a.model, "epochs": a.epochs, "train_n": len(train)}
    json.dump(results, open(os.path.join(a.out, "results.json"), "w"), indent=1); print("DONE", json.dumps(results), flush=True)

NEG = set("not no n't don't doesn't didn't can't couldn't won't wouldn't shouldn't isn't aren't wasn't weren't haven't hasn't never".split())

@torch.no_grad()
def evaluate(model, tok, exs, dev, name, show=0):
    """Greedy decode, scored on the failures that matter (docs/PLAN-REALISER.md §6), not just exact match --
    it was exact-match-against-one-wording that let a model ship which answers the child with a question:

      exact          match against the reference wording (kept for continuity; a weak signal)
      cards_covered  every tapped card's word is said
      answer         not a question back at the partner
      polarity       a "no"/"not" card gives a negative sentence, and nothing else does
      first_person   "I ..." / "my ..." -- the voice the app is supposed to speak in
    """
    model.eval(); em = cov = ans = pol = fp = 0; samples = []
    for i in range(0, len(exs), 32):
        b = exs[i:i + 32]; tok.padding_side = "left"
        enc = tok([prompt(e) for e in b], return_tensors="pt", padding=True).to(dev)
        out = model.generate(**enc, max_new_tokens=24, do_sample=False, pad_token_id=tok.pad_token_id, eos_token_id=[tok.eos_token_id, tok("\n")["input_ids"][0]])
        tok.padding_side = "right"
        for e, o in zip(b, out):
            s = tok.decode(o[enc["input_ids"].shape[1]:], skip_special_tokens=True).split("\n")[0].strip()
            em += int(s.lower() == e["sentence"].lower()); words = set(re.findall(r"[a-z']+", s.lower()))
            cov += int(all(any(w in words for w in re.findall(r"[a-z']+", c.lower())) for c in e["cards"]))
            lab = " ".join(c.lower() for c in e["cards"])
            asks = "?" in lab or re.search(r"\b(can i|may i|what|where|when|why|who|how)\b", lab)
            ans += int(not s.rstrip().endswith("?") or bool(asks))
            card_neg = any(c.lower().strip() in NEG or c.lower().strip().startswith("no ") or c.lower().endswith("n't") for c in e["cards"])
            pol += int(card_neg == bool(words & NEG))
            fp += int(bool(re.search(r"\b(i|i'm|i'll|i've|i'd|my|me|mine)\b", s.lower())))
            if len(samples) < show: samples.append({"partner": e["partner"], "cards": e["cards"], "gold": e["sentence"], "out": s})
    n = len(exs)
    r = {"n": n, "exact": round(em / n, 3), "cards_covered": round(cov / n, 3),
         "answer": round(ans / n, 3), "polarity": round(pol / n, 3), "first_person": round(fp / n, 3)}
    if samples: r["samples"] = samples
    return r

if __name__ == "__main__":
    main()
