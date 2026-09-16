#!/usr/bin/env python3
"""Train a small reranker on the fine-tuned SmolLM2 card model's top-100 candidates, evaluate it, and run
the end-to-end pipeline (model -> reranker -> slate with fixed cells and position stability) on real
question-answer states.

Reranker features per candidate (listwise MLP, trained on dev states, tested on test / test_qa):
  model log-prob, log rank, frequency log-prob (bigram/unigram), MiniLM cosine(partner, card),
  category one-hot, intent one-hot, core, safety, composable, multiword, is_end, is_name, prefix length,
  partner present.
Graded labels: 3 = highest-weight acceptable next card, 2 = other acceptable, 0 = the rest.

Usage: python3 eval/reranker_e2e.py --ckpt train/out/smollm135_v1/card_model.pt --n-train 4000
"""
import argparse, csv, json, os, random, sys, time, collections, math
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "train")); sys.path.insert(0, os.path.join(ROOT, "eval"))
from train_smollm import CardModel, encode_batch, load_vocab, MODEL
from transformers import AutoTokenizer, AutoModelForCausalLM

K = 100
FIXED = ["yes", "no", "help", "i don't know"]
CONTRAST = {"refuse": ["no", "not now", "i don't want to"], "uncertain": ["maybe", "i don't know"]}

def build_model(ckpt, device):
    ids, speak = load_vocab(); n = len(ids)
    bj = os.path.join(os.path.dirname(ckpt), "backbone.json")
    model_name = json.load(open(bj))["model"] if os.path.exists(bj) else MODEL     # the trainer records its backbone
    tok = AutoTokenizer.from_pretrained(model_name); tok.padding_side = "right"
    if tok.pad_token_id is None: tok.pad_token = tok.eos_token
    base = AutoModelForCausalLM.from_pretrained(model_name, dtype=torch.float32)
    model = CardModel(base, n, torch.zeros(n + 1, base.get_input_embeddings().weight.size(1)))
    model.load_state_dict(torch.load(ckpt, map_location="cpu"), strict=False); model.to(device).eval()
    return model, tok, ids, speak

@torch.no_grad()
def topk_states(model, tok, exs, id2idx, start_idx, device, bs=64):
    """Return per state: (top100 idx list, top100 logprob list)."""
    out = []
    for i in range(0, len(exs), bs):
        b = exs[i:i+bs]
        logits, _ = model(*encode_batch(tok, b, id2idx, start_idx, device))
        lp = F.log_softmax(logits.float(), 1)
        v, ix = lp.topk(K, 1)
        for j in range(len(b)): out.append((ix[j].tolist(), v[j].tolist()))
    return out

class Feats:
    def __init__(self, rows, ids, train_states, id2idx, no_meta=False):
        # 29 category + 12 intent one-hots make the reranker partly a lookup table over card metadata.
        # no_meta drops them, leaving the four real signals plus state flags; the gates decide which ships.
        self.cats = [] if no_meta else sorted({r["category"] for r in rows})
        self.ints = [] if no_meta else sorted({r["intent"] for r in rows})
        self.meta = {}
        for r in rows:
            self.meta[r["id"]] = (r["category"], r["intent"], int(r["core"]), int(r["safety"]), int(r["composable"]), int(r["words"]) > 1)
        n = len(ids); self.n = n; self.id2idx = id2idx
        self.uni = np.full(n, 0.1); self.bi = collections.defaultdict(lambda: np.full(n, 0.1))
        for e in train_states:
            last = id2idx.get(e["prefix"][-1], id2idx["<name>"]) if e["prefix"] else -1
            for c, w in e["targets"].items(): j = id2idx.get(c, id2idx["<name>"]); self.uni[j] += w; self.bi[last][j] += w
        from sentence_transformers import SentenceTransformer
        self.st = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device="cpu")
        speak = [None] * n
        for r in rows: speak[id2idx[r["id"]]] = r["speak"]
        speak[id2idx["<name>"]] = "someone's name"; speak[id2idx["<aac_end>"]] = "that is all"
        for j, c in enumerate(ids):
            if speak[j] is None: speak[j] = c[len("<folder:"):-1] + " folder" if c.startswith("<folder:") else c
        self.card_vec = self.st.encode(speak, normalize_embeddings=True, batch_size=256)
        self.dim = 4 + len(self.cats) + len(self.ints) + 8 + 1      # v3: + is_folder
    def freq(self, prefix):
        last = self.id2idx.get(prefix[-1], self.id2idx["<name>"]) if prefix else -1
        return np.log(0.7 * self.bi[last] / self.bi[last].sum() + 0.3 * self.uni / self.uni.sum())
    def partner_vecs(self, exs):
        texts = [e["partner"] or "" for e in exs]
        return self.st.encode(texts, normalize_embeddings=True, batch_size=256)
    def featurize(self, e, top, pv, ids):
        idx, lps = top; fq = self.freq(e["prefix"]); X = np.zeros((K, self.dim), dtype=np.float32)
        for r, (j, lp) in enumerate(zip(idx, lps)):
            cid = ids[j]; m = self.meta.get(cid)
            f = [lp, math.log(r + 1), fq[j], float(self.card_vec[j] @ pv) if e["partner"] else 0.0]
            cat = [0.0] * len(self.cats); intent = [0.0] * len(self.ints)
            if m:
                cat[self.cats.index(m[0])] = 1; intent[self.ints.index(m[1])] = 1
                extra = [m[2], m[3], m[4], float(m[5])]
            else: extra = [0, 0, 0, 0]
            f += cat + intent + extra + [float(cid == "<aac_end>"), float(cid == "<name>"), min(len(e["prefix"]), 6) / 6, float(bool(e["partner"])), float(cid.startswith("<folder:"))]
            X[r] = f
        return X

def labels_for(e, top, id2idx):
    idx = top[0]; y = np.zeros(K, dtype=np.float32)
    best = max(e["targets"], key=e["targets"].get)
    for c in e["targets"]:
        j = id2idx.get(c, id2idx["<name>"])
        if j in idx: y[idx.index(j)] = 3.0 if c == best else 2.0
    return y

class Reranker(nn.Module):
    def __init__(self, d):
        super().__init__(); self.net = nn.Sequential(nn.Linear(d, 64), nn.ReLU(), nn.Linear(64, 32), nn.ReLU(), nn.Linear(32, 1))
    def forward(self, X): return self.net(X).squeeze(-1)

def metrics_from_orders(orders, exs, id2idx):
    """Card-only recall/ndcg (folder rows skipped in both the order and the targets) plus a folder metric:
    of the states that carry a folder target, how often a gold folder row is inside the reranked top 16."""
    ks = (1, 8, 16); hits = {k: 0 for k in ks}; ndcg = 0; N = 0; f_n = f_hit = 0
    fset = {i for c, i in id2idx.items() if c.startswith("<folder:")}
    for order, e in zip(orders, exs):
        gold_f = {id2idx[c] for c in e["targets"] if c.startswith("<folder:")}
        if gold_f: f_n += 1; f_hit += bool(gold_f & set(order[:16]))
        order = [j for j in order if j not in fset]
        tgt = {id2idx.get(c, id2idx["<name>"]): w for c, w in e["targets"].items() if not c.startswith("<folder:")}
        if not tgt: continue
        best = min((order.index(t) + 1 for t in tgt if t in order), default=10**6)
        for k in ks: hits[k] += best <= k
        gains = [tgt.get(j, 0) for j in order[:16]]; dcg = sum(g / math.log2(i + 2) for i, g in enumerate(gains))
        ideal = sorted(tgt.values(), reverse=True)[:16]; idcg = sum(g / math.log2(i + 2) for i, g in enumerate(ideal)) or 1
        ndcg += dcg / idcg; N += 1
    return {f"recall@{k}": hits[k] / N for k in ks} | {"ndcg@16": ndcg / N, "n": N} | ({"folder_in_top16": f_hit / f_n, "folder_n": f_n} if f_n else {})

def slate(order_ids, prefix_ids, lab2id, prev_grid=None):
    fixed = [lab2id[l] for l in FIXED]
    cands = [c for c in order_ids if c not in fixed and c not in prefix_ids and c != "<aac_end>"]
    extra = []
    for group in ("refuse", "uncertain"):
        if not any(lab2id.get(l) in cands[:10] + fixed for l in CONTRAST[group]): extra.append(lab2id[CONTRAST[group][0]])
    wanted = extra + cands[: 12 - len(extra)]
    if prev_grid is None: return fixed + wanted
    # position stability: cards still wanted keep their cell; newcomers fill vacated cells in rank order
    new = list(prev_grid); keep = set(wanted)
    for i in range(4, 16):
        if new[i] not in keep or new[i] in prefix_ids: new[i] = None
    fill = [c for c in wanted if c not in new]
    for i in range(4, 16):
        if new[i] is None and fill: new[i] = fill.pop(0)
    return new

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--ckpt", required=True); ap.add_argument("--n-train", type=int, default=4000)
    ap.add_argument("--n-test", type=int, default=1500); ap.add_argument("--demo", type=int, default=5); ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args(); random.seed(a.seed); torch.manual_seed(a.seed); np.random.seed(a.seed)
    device = os.environ.get("AAC_DEVICE") or ("mps" if torch.backends.mps.is_available() else "cpu")
    model, tok, ids, speak = build_model(a.ckpt, device); n = len(ids); id2idx = {c: i for i, c in enumerate(ids)}; start_idx = n
    rows = list(csv.DictReader(open(os.path.join(ROOT, "vocab", "vocab.csv")))); lab2id = {r["label"]: r["id"] for r in rows}
    load = lambda s: [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", f"{s}.jsonl"))]
    train_states = load("train"); dev = load("dev"); test = load("test"); qa = load("test_qa")
    random.shuffle(dev); random.shuffle(test)
    dev_e = dev[: a.n_train]; test_e = test[: a.n_test]; qa_e = qa[: a.n_test]
    feats = Feats(rows, ids, train_states, id2idx)

    t0 = time.time()
    tops = {name: topk_states(model, tok, exs, id2idx, start_idx, device) for name, exs in (("dev", dev_e), ("test", test_e), ("qa", qa_e))}
    print(f"top-100 computed for {len(dev_e)}+{len(test_e)}+{len(qa_e)} states in {time.time()-t0:.0f}s", flush=True)
    def dataset(exs, top):
        pv = feats.partner_vecs(exs)
        X = np.stack([feats.featurize(e, t, pv[i], ids) for i, (e, t) in enumerate(zip(exs, top))])
        Y = np.stack([labels_for(e, t, id2idx) for e, t in zip(exs, top)])
        return torch.tensor(X), torch.tensor(Y)
    Xd, Yd = dataset(dev_e, tops["dev"]); mu, sd = Xd[:, :, :4].mean((0, 1)), Xd[:, :, :4].std((0, 1)) + 1e-6
    def norm(X): X = X.clone(); X[:, :, :4] = (X[:, :, :4] - mu) / sd; return X
    Xd = norm(Xd)
    rr = Reranker(feats.dim); opt = torch.optim.Adam(rr.parameters(), lr=2e-3, weight_decay=1e-4)
    for ep in range(40):
        perm = torch.randperm(len(Xd)); tot = 0
        for i in range(0, len(Xd), 128):
            b = perm[i:i+128]; s = rr(Xd[b]); y = Yd[b]
            # listwise: soft target distribution over the 100 candidates (states with no positive get skipped)
            has = y.sum(1) > 0
            if has.sum() == 0: continue
            p = y[has] / y[has].sum(1, keepdim=True)
            loss = -(p * F.log_softmax(s[has], 1)).sum(1).mean()
            opt.zero_grad(); loss.backward(); opt.step(); tot += loss.item()
        if ep % 10 == 9: print(f"  reranker epoch {ep+1} loss {tot:.2f}", flush=True)

    results = {}
    for name, exs in (("test", test_e), ("qa", qa_e)):
        top = tops[name]; X, _ = dataset(exs, top); X = norm(X)
        with torch.no_grad(): s = rr(X).numpy()
        raw_orders = [t[0] for t in top]
        rr_orders = [[t[0][j] for j in np.argsort(-s[i])] for i, t in enumerate(top)]
        rm, rrm = metrics_from_orders(raw_orders, exs, id2idx), metrics_from_orders(rr_orders, exs, id2idx)
        results[name] = {"model": rm, "model+reranker": rrm}
        print(f"\n{name} (n={rm['n']}):")
        print(f"  fine-tuned model alone : R@1 {rm['recall@1']:.3f}  R@8 {rm['recall@8']:.3f}  R@16 {rm['recall@16']:.3f}  NDCG@16 {rm['ndcg@16']:.3f}")
        print(f"  model + reranker       : R@1 {rrm['recall@1']:.3f}  R@8 {rrm['recall@8']:.3f}  R@16 {rrm['recall@16']:.3f}  NDCG@16 {rrm['ndcg@16']:.3f}")
    json.dump(results, open(os.path.join(ROOT, "eval", "reranker_results.json"), "w"), indent=1)

    # ---- end-to-end demo on question-answer states: step 0 and step 1 with position stability
    byu = collections.defaultdict(list)
    for e in qa: byu[e["id"].rsplit("_s", 1)[0]].append(e)
    firsts = [e for e in qa if not e["prefix"]]; random.shuffle(firsts)
    print("\n" + "=" * 78 + "\nEND-TO-END (fine-tuned SmolLM2 -> reranker -> slate)")
    for k, e in enumerate(firsts[: a.demo], 1):
        states = sorted(byu[e["id"].rsplit("_s", 1)[0]], key=lambda s: len(s["prefix"]))
        truth_seq = states[-1]["prefix"]
        print("=" * 78); print(f"#{k} [{e['source']}] PARTNER: {e['partner']}\n   TRUE REPLY: {' '.join(speak[c] for c in truth_seq)}")
        prev = None
        for step in range(min(2, len(states))):
            st = states[step]; top = topk_states(model, tok, [st], id2idx, start_idx, device)[0]
            pv = feats.partner_vecs([st])[0]; X = norm(torch.tensor(feats.featurize(st, top, pv, ids))[None])
            with torch.no_grad(): s = rr(X)[0].numpy()
            model_order = [ids[j] for j in top[0]]; rr_order = [ids[top[0][j]] for j in np.argsort(-s)]
            grid = slate(rr_order, st["prefix"], lab2id, prev); prev = grid
            print(f"\n   STEP {step}: prefix = {[speak[c] for c in st['prefix']] or '(empty)'}")
            print(f"      model top-8    : {[speak[c] for c in model_order[:8]]}")
            print(f"      reranked top-8 : {[speak[c] for c in rr_order[:8]]}")
            g = [speak[c] if c else "-" for c in grid]
            print("      GRID  (row 1 fixed; rows 2-4 contrast + contextual, cells kept between steps):")
            for r in range(0, 16, 4): print("         " + " | ".join(f"{x:16s}" for x in g[r:r+4]))
            hit = [speak.get(t, t) for t in st["targets"] if t in grid]
            print(f"      truth next: {[speak.get(t,t) for t in st['targets']]} -> on grid: {hit or 'NO'}   (model rank of best: {min((model_order.index(t)+1 for t in st['targets'] if t in model_order), default='>100')}, reranked: {min((rr_order.index(t)+1 for t in st['targets'] if t in rr_order), default='>100')})")

if __name__ == "__main__":
    main()
