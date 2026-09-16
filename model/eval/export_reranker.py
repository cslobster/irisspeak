#!/usr/bin/env python3
"""Train the reranker (same recipe as reranker_e2e.py) and export everything the browser needs to run it:
  site/public/model/reranker.json  weights, feature normalisation, feature layout (categories, intents)
  site/public/model/freq.json      unigram counts and a sparse bigram table (top successors per last card)
  site/public/model/card_vecs.bin  MiniLM vectors of all cards, float16, row order = cards.json order
  site/public/model/cards.json     extended with category, intent, core, safety, composable, multiword

Usage: python3 eval/export_reranker.py --ckpt train/out/smollm135_v2/card_model.pt --n-train 6000
"""
import argparse, csv, json, os, sys, random, collections
import numpy as np, torch, torch.nn.functional as F
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "eval")); sys.path.insert(0, os.path.join(ROOT, "train"))
from reranker_e2e import build_model, topk_states, Feats, labels_for, Reranker, K

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--ckpt", required=True); ap.add_argument("--n-train", type=int, default=6000)
    ap.add_argument("--out", default=os.path.join(ROOT, "site", "public", "model")); ap.add_argument("--seed", type=int, default=7); ap.add_argument("--no-meta", action="store_true", help="drop the category/intent one-hots: 13 features instead of 54"); a = ap.parse_args()
    random.seed(a.seed); torch.manual_seed(a.seed); np.random.seed(a.seed)
    device = os.environ.get("AAC_DEVICE") or ("mps" if torch.backends.mps.is_available() else "cpu")
    model, tok, ids, speak = build_model(a.ckpt, device); n = len(ids); id2idx = {c: i for i, c in enumerate(ids)}; start_idx = n
    rows = list(csv.DictReader(open(os.path.join(ROOT, "vocab", "vocab.csv"))))
    load = lambda s: [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", f"{s}.jsonl"))]
    train_states = load("train"); dev = load("dev"); random.shuffle(dev); dev_e = dev[: a.n_train]
    feats = Feats(rows, ids, train_states, id2idx, no_meta=a.no_meta)
    top = topk_states(model, tok, dev_e, id2idx, start_idx, device); pv = feats.partner_vecs(dev_e)
    X = torch.tensor(np.stack([feats.featurize(e, t, pv[i], ids) for i, (e, t) in enumerate(zip(dev_e, top))]))
    Y = torch.tensor(np.stack([labels_for(e, t, id2idx) for e, t in zip(dev_e, top)]))
    mu, sd = X[:, :, :4].mean((0, 1)), X[:, :, :4].std((0, 1)) + 1e-6
    Xn = X.clone(); Xn[:, :, :4] = (Xn[:, :, :4] - mu) / sd
    rr = Reranker(feats.dim); opt = torch.optim.Adam(rr.parameters(), lr=2e-3, weight_decay=1e-4)
    for ep in range(40):
        perm = torch.randperm(len(Xn))
        for i in range(0, len(Xn), 128):
            b = perm[i:i+128]; s = rr(Xn[b]); y = Y[b]; has = y.sum(1) > 0
            if has.sum() == 0: continue
            p = y[has] / y[has].sum(1, keepdim=True); loss = -(p * F.log_softmax(s[has], 1)).sum(1).mean()
            opt.zero_grad(); loss.backward(); opt.step()
    # quick self-check on the last 500 dev states
    with torch.no_grad(): s = rr(Xn[-500:]).numpy()
    hit_m = hit_r = 0
    for i, (e, t) in enumerate(zip(dev_e[-500:], top[-500:])):
        tg = {id2idx.get(c, id2idx["<name>"]) for c in e["targets"]}
        hit_m += bool(tg & set(t[0][:16])); hit_r += bool(tg & set(t[0][j] for j in np.argsort(-s[i])[:16]))
    print(f"dev self-check R@16: model {hit_m/500:.3f} -> reranked {hit_r/500:.3f}", flush=True)

    os.makedirs(a.out, exist_ok=True)
    layers = [rr.net[0], rr.net[2], rr.net[4]]
    json.dump({"dim": feats.dim, "mu": mu.tolist(), "sd": sd.tolist(), "cats": feats.cats, "ints": feats.ints, "K": K,
               "layers": [{"W": l.weight.detach().numpy().tolist(), "b": l.bias.detach().numpy().tolist()} for l in layers],
               "feature_order": ["logprob", "log_rank", "freq_logp", "similarity", "cat_onehot[]", "intent_onehot[]", "core", "safety", "composable", "multiword", "is_end", "is_name", "prefix_len/6", "partner_present", "is_folder"]},
              open(os.path.join(a.out, "reranker.json"), "w"))
    # frequency table: unigram + sparse bigram (top 300 successors per last card), stored as raw counts
    uni = feats.uni.tolist(); bi = {}
    for last, arr in feats.bi.items():
        idx = np.argsort(-arr)[:300]; bi[str(last)] = [[int(j), round(float(arr[j]), 2)] for j in idx if arr[j] > 0.1]
    json.dump({"uni": [round(x, 2) for x in uni], "bi": bi, "smoothing": 0.1, "lambda_bi": 0.7}, open(os.path.join(a.out, "freq.json"), "w"))
    feats.card_vec.astype(np.float16).tofile(os.path.join(a.out, "card_vecs.bin"))
    # cards.json with metadata for the browser features
    cj = json.load(open(os.path.join(a.out, "cards.json"))); meta = {r["id"]: r for r in rows}
    # per-card log prior (training-target unigram frequency, add-one smoothed). The model-only app ranks by
    # log p(card | state) - 0.5 * prior, which stops safe-everywhere cards (Tired, Wait, Need) crowding every
    # panel; judged blind it lifted fully-answerable boards on corpus questions from 75% to 82%.
    _u = np.array(feats.uni, dtype=np.float64); cj["prior"] = [round(float(x), 4) for x in np.log((_u + 1.0) / (_u.sum() + len(_u)))]
    for c in cj["cards"]:
        m = meta.get(c["id"])
        if m: c.update({"category": m["category"], "intent": m["intent"], "core": int(m["core"]), "safety": int(m["safety"]), "composable": int(m["composable"]), "multiword": int(int(m["words"]) > 1)})
        else: c.update({"core": 0, "safety": 0, "composable": 0, "multiword": 0})
        if c["id"].startswith("<folder:"): c["is_folder"] = 1
    json.dump(cj, open(os.path.join(a.out, "cards.json"), "w"))
    print("exported:", [f"{f} {os.path.getsize(os.path.join(a.out, f))/1e6:.1f} MB" for f in ("reranker.json", "freq.json", "card_vecs.bin", "cards.json")], flush=True)

if __name__ == "__main__":
    main()
