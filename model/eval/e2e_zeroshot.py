#!/usr/bin/env python3
"""End-to-end zero-shot demo: question -> SmolLM2 sampled replies -> mapper -> card votes -> blend with
frequency counts -> 16-cell slate with fixed safety cells. Shows two steps per example (empty prefix, then
after the user taps the true first card). No training anywhere.

Usage: python3 eval/e2e_zeroshot.py --n 5 --samples 5
"""
import argparse, csv, json, os, random, sys, collections
import numpy as np, torch
from transformers import AutoTokenizer, AutoModelForCausalLM
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "data"))
from map import load_vocab, normalise, match

MODEL = "HuggingFaceTB/SmolLM2-135M-Instruct"
FEW = {"default": ("Partner: Do you want juice or milk?\nMe: juice please\n\nPartner: How are you feeling today?\nMe: I'm tired\n\n"
                   "Partner: Should we go to the park?\nMe: no, I want to stay home\n\nPartner: What did you do at school?\nMe: I played with Sam\n\n")}
FIXED = ["yes", "no", "help", "i don't know"]          # fixed safety / core cells, never ranked
CONTRAST = {"affirm": ["yes", "ok"], "refuse": ["no", "not now", "i don't want to"], "uncertain": ["maybe", "i don't know"]}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=5); ap.add_argument("--samples", type=int, default=5)
    ap.add_argument("--w", type=float, default=2.0, help="weight of LLM votes vs frequency log-prob"); ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args(); random.seed(a.seed); torch.manual_seed(a.seed)
    rows, by_label, surface, maxlen = load_vocab(os.path.join(ROOT, "vocab", "vocab.csv"))
    known = frozenset(s for s in surface if " " not in s)
    ids = [r["id"] for r in rows] + ["<name>", "<aac_end>"]; id2idx = {c: i for i, c in enumerate(ids)}; n = len(ids)
    speak = {r["id"]: r["speak"] for r in rows}; speak["<name>"] = "Sam"; speak["<aac_end>"] = "(end)"
    lab2id = {r["label"]: r["id"] for r in rows}

    # frequency model from train states
    train = [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", "train.jsonl"))]
    uni = np.full(n, 0.1); bi = collections.defaultdict(lambda: np.full(n, 0.1))
    for e in train:
        last = id2idx.get(e["prefix"][-1], id2idx["<name>"]) if e["prefix"] else -1
        for c, w in e["targets"].items(): j = id2idx.get(c, id2idx["<name>"]); uni[j] += w; bi[last][j] += w
    def freq_logp(prefix):
        last = id2idx.get(prefix[-1], id2idx["<name>"]) if prefix else -1
        return np.log(0.7 * bi[last] / bi[last].sum() + 0.3 * uni / uni.sum())

    qa = [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", "test_qa.jsonl"))]
    byu = collections.defaultdict(list)
    for e in qa: byu[e["id"].rsplit("_s", 1)[0]].append(e)
    firsts = [e for e in qa if not e["prefix"]]; random.shuffle(firsts); ex = firsts[: a.n]

    tok = AutoTokenizer.from_pretrained(MODEL)
    model = AutoModelForCausalLM.from_pretrained(MODEL, dtype=torch.float16).to("mps").eval()
    lem_cache = {}

    def llm_samples(partner, prefix_ids):
        sofar = " ".join((speak[c].lower() if speak[c] != "I" else "I") for c in prefix_ids)
        p = FEW["default"] + f"Partner: {partner}\nMe:" + (" " + sofar if sofar else "")
        t = tok(p, return_tensors="pt").to("mps"); outs = []
        with torch.no_grad():
            g = model.generate(**t, max_new_tokens=12, do_sample=True, temperature=0.8, top_p=0.9, num_return_sequences=a.samples, pad_token_id=tok.eos_token_id)
        for o in g:
            outs.append(tok.decode(o[t["input_ids"].shape[1]:], skip_special_tokens=True).split("\n")[0].strip())
        return outs

    def map_next(text, prefix_len):
        """Map a sampled continuation to card ids; return the sequence of cards after the prefix."""
        toks = normalise(text, known); m = match(toks, surface, maxlen, lem_cache)
        seq = [r["id"] for r, _ in m if r and r != "<name>"] + (["<name>"] if any(r == "<name>" for r, _ in m) else [])
        return seq

    def slate(scores, prefix_ids, votes):
        order = [ids[i] for i in np.argsort(-scores) if ids[i] not in prefix_ids]
        fixed = [lab2id[l] for l in FIXED]
        contextual = [c for c in order if c not in fixed][:10]
        # contrasting intents: make sure a refusal and an uncertain option are present
        extra = []
        for group in ("refuse", "uncertain"):
            if not any(c in contextual + fixed for c in [lab2id[l] for l in CONTRAST[group] if l in lab2id]):
                extra.append(lab2id[CONTRAST[group][0]])
        return fixed + extra + contextual[: 12 - len(extra)]

    for k, e in enumerate(ex, 1):
        states = sorted(byu[e["id"].rsplit("_s", 1)[0]], key=lambda s: len(s["prefix"]))
        truth_seq = states[-1]["prefix"]; truth_first = max(e["targets"], key=e["targets"].get)
        print("=" * 78); print(f"#{k} [{e['source']}]  PARTNER: {e['partner']}")
        print(f"   TRUE REPLY: {' '.join(speak[c] for c in truth_seq)}")
        for step, prefix in enumerate(([], [truth_first])):
            samples = llm_samples(e["partner"], prefix)
            votes = collections.Counter(); mapped = []
            for s in samples:
                seq = map_next(s, len(prefix)); mapped.append((s, [speak.get(c, c) for c in seq]))
                if seq: votes[seq[0]] += 1
                else: votes["<aac_end>"] += 1
            sc = freq_logp(prefix).copy()
            for c, v in votes.items(): sc[id2idx[c]] += a.w * v / a.samples * 5     # vote share scaled
            grid = slate(sc, prefix, votes)
            tgt = states[step]["targets"] if step < len(states) else {}
            print(f"\n   STEP {step}: prefix = {[speak[c] for c in prefix] or '(empty)'}")
            for s, seq in mapped: print(f"      LLM sample: {s[:60]!r:62s} -> cards {seq}")
            print(f"      votes for next card: {[(speak.get(c,c), v) for c, v in votes.most_common(5)]}")
            g = [speak[c] for c in grid]
            print("      GRID (fixed | contrast | contextual):")
            for r in range(0, 16, 4): print("         " + " | ".join(f"{x:16s}" for x in g[r:r+4]))
            hit = [speak.get(t, t) for t in tgt if t in grid]
            print(f"      truth next: {[speak.get(t,t) for t in tgt]}  -> on grid: {hit or 'NO'}")

if __name__ == "__main__":
    main()
