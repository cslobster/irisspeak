#!/usr/bin/env python3
"""Baselines on the same state files and metrics as train/train_smollm.py.

  S1 frequency : P(next | last prefix card) bigram with unigram back-off, counted on train states
  S2 bi-encoder: MiniLM cosine(partner, card spoken form) blended with the S1 log-prob (zero-shot, no training)

Usage: python3 eval/baselines.py --states data/states --max-eval 4000
"""
import argparse, csv, json, math, os, random, collections
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def metrics(rank_lists, exs, id2idx, train_seen):
    ks = (1, 8, 16, 100); hits = {k: 0 for k in ks}; mrr = 0; N = 0
    groups = collections.defaultdict(lambda: [0, 0])
    for order, e in zip(rank_lists, exs):
        pos = {c: i + 1 for i, c in enumerate(order)}
        tgt = [id2idx.get(c, id2idx["<name>"]) for c in e["targets"]]
        best = min(pos.get(t, 10**6) for t in tgt); N += 1; mrr += 1 / best
        for k in ks: hits[k] += best <= k
        ref = max(e["targets"], key=e["targets"].get)
        for g in ("partner" if e.get("partner") else "no_partner", "tail_unseen" if (ref not in train_seen and ref != "<aac_end>") else "seen", e["source"]):
            groups[g][0] += 1; groups[g][1] += best <= 16
    r = {f"recall@{k}": hits[k] / N for k in ks}; r["mrr"] = mrr / N; r["n"] = N
    r["groups_recall@16"] = {g: (v[1] / v[0], v[0]) for g, v in groups.items()}
    return r

def show(name, r):
    print(f"{name}: " + " ".join(f"{k}={v:.3f}" for k, v in r.items() if isinstance(v, float)))
    for g, (v, n) in sorted(r["groups_recall@16"].items()): print(f"   {name} recall@16 [{g}] = {v:.3f} (n={n})")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--states", default=os.path.join(ROOT, "data", "states"))
    ap.add_argument("--max-eval", type=int, default=4000)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args(); random.seed(a.seed)
    rows = list(csv.DictReader(open(os.path.join(ROOT, "vocab", "vocab.csv"))))
    ids = [r["id"] for r in rows] + ["<name>", "<aac_end>"]; id2idx = {c: i for i, c in enumerate(ids)}; n = len(ids)
    speak = [r["speak"] for r in rows] + ["someone's name", "end of message"]
    load = lambda s: [json.loads(l) for l in open(os.path.join(a.states, f"{s}.jsonl"))]
    train = load("train"); test = load("test"); random.shuffle(test); test = test[: a.max_eval]
    train_seen = {max(e["targets"], key=e["targets"].get) for e in train}

    # ---- S1: bigram on last prefix card with unigram back-off (add-0.1 smoothing)
    uni = np.full(n, 0.1); bi = collections.defaultdict(lambda: np.full(n, 0.1))
    for e in train:
        last = id2idx.get(e["prefix"][-1], id2idx["<name>"]) if e["prefix"] else -1
        for c, w in e["targets"].items():
            j = id2idx.get(c, id2idx["<name>"]); uni[j] += w; bi[last][j] += w
    def s1_scores(e):
        last = id2idx.get(e["prefix"][-1], id2idx["<name>"]) if e["prefix"] else -1
        p = 0.7 * bi[last] / bi[last].sum() + 0.3 * uni / uni.sum()
        return np.log(p)
    s1 = [list(np.argsort(-s1_scores(e))) for e in test]
    r1 = metrics(s1, test, id2idx, train_seen); show("S1 frequency", r1)

    # ---- S2: MiniLM zero-shot similarity blended with S1
    from sentence_transformers import SentenceTransformer
    st = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    card_vecs = st.encode(speak, normalize_embeddings=True, batch_size=256)
    partners = [e["partner"] or "" for e in test]
    pv = st.encode(partners, normalize_embeddings=True, batch_size=256)
    results = {}
    for lam in (2.0, 4.0, 8.0):
        s2 = []
        for i, e in enumerate(test):
            sim = card_vecs @ pv[i] if e["partner"] else np.zeros(n)
            s2.append(list(np.argsort(-(s1_scores(e) + lam * sim))))
        r2 = metrics(s2, test, id2idx, train_seen); results[lam] = r2
        show(f"S2 MiniLM+S1 (lambda={lam})", r2)
    json.dump({"S1": r1, "S2": {str(k): v for k, v in results.items()}}, open(os.path.join(ROOT, "eval", "baselines_results.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
