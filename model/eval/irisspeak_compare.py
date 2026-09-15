#!/usr/bin/env python3
"""Compare Iris Speak's pure-LLM card generation with the fine-tuned SmolLM2 + reranker, on the same
question-answer test states and the same 3,094-card vocabulary.

Iris Speak method (ported from irisspeak/src/lib/prompts.ts buildChildCardPrompt + moderator.ts):
  one LLM call per parent message -> 12 ranked topic nouns + 12 ranked action verbs chosen from the full
  topic/action vocabulary given in the prompt; the grid shows the first 4 topics + first 4 actions, plus
  fixed core cards (yes, no, I don't know, how about you, I want) and 4 fixed feeling cards. After a tap,
  the call is repeated with "Child already picked: ...". Model: gemini-2.5-flash-lite (via OpenRouter).

Ours: SmolLM2-135M fine-tuned on card states -> top-100 -> listwise reranker -> 4 fixed + 12 ranked cells.

Metrics per step: hit = an acceptable next card is on the grid (Recall@grid); also hit within the
dynamic cells only, latency, tokens. Steps: 0 (empty prefix) and 1 (after the true first card).

Usage: python3 eval/irisspeak_compare.py --n 100 --ckpt train/out/smollm135_v1/card_model.pt
"""
import argparse, csv, json, os, random, re, sys, time, collections
import numpy as np, torch
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "eval")); sys.path.insert(0, os.path.join(ROOT, "train"))
from reranker_e2e import build_model, topk_states, Feats, labels_for, Reranker, slate, K
import torch.nn.functional as F

TOPIC_DESC = "The dyad gets to know what the child did on that day."   # Iris Speak 'recall' topic
IRIS_FIXED_CORE = ["yes", "no", "i don't know", "how about you", "i want"]
IRIS_FIXED_EMOTION = ["happy", "excited", "sad", "angry"]

def iris_prompt(topic_vocab, action_vocab, interim=None, profile=None):
    prof = f"What you know about this child: {profile}\n\n" if profile else ""
    p = (f"You suggest AAC card words for a child age 5–7 with ASD, talking with their parent. "
         f"Conversation: {TOPIC_DESC}\n\n{prof}"
         "Given the dialogue's last parent message:\n"
         "1. Identify the specific theme of that message — what kind of answer is it actually asking for "
         "(e.g. a food, an activity, a place, a person, a time)? Stay locked onto that theme; do not drift "
         "into unrelated topics unless the message is actually about them.\n"
         "2. Think of 2-3 short sentences the child might want to say that directly and specifically answer "
         "the message, staying strictly on that theme.\n"
         "3. From those sentences, pick 12 topic nouns and 12 action verbs, chosen ONLY from the fixed "
         "vocabularies below — do not invent new words or use words outside these lists. List each set of "
         "12 in order from most-fitting to least-fitting, since only the first few valid ones may get shown "
         "now and the rest are kept in reserve for a later refresh:\n"
         f"   Topic vocabulary: {', '.join(topic_vocab)}\n"
         f"   Action vocabulary: {', '.join(action_vocab)}\n\n"
         "Every topic/action word must relate directly to the theme from step 1, not just loosely "
         "associated filler. If a vocabulary doesn't contain enough strongly on-theme words, pick the "
         "closest available ones rather than switching to a different theme. Do NOT repeat the same word "
         "twice within a list.\n\n"
         "\n\nDo ALL steps silently — do NOT write out the theme, sentences, or any reasoning. "
         "Output ONLY this YAML, nothing else, no text before or after it, no explanation:\n"
         "topics: [w1, w2, ..., w12]\nactions: [w1, w2, ..., w12]")
    if interim: p += f"\nChild already picked: {', '.join(interim)}. Make next set fit."
    return p

def extract_list(text, key):
    m = re.search(rf"^[ \t]*{key}:[ \t]*\[(.*)\][ \t]*$", text, re.M)
    if m: return [s.strip().strip("\"'") for s in m.group(1).split(",") if s.strip()]
    m = re.search(rf"^[ \t]*{key}:[ \t]*(.+)$", text, re.M)
    if m and not m.group(1).strip().startswith("["): return [s.strip().strip("\"'") for s in m.group(1).split(",") if s.strip()]
    return []

def llm_call(key, model, system, user, cache_dir):
    import hashlib, urllib.request
    body = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}], "reasoning_effort": "none"}
    h = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:20]
    cp = os.path.join(cache_dir, h + ".json")
    if os.path.exists(cp): return json.load(open(cp))
    req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    t = time.time()
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r: out = json.load(r); break
        except Exception as e:
            if attempt == 2: raise
            time.sleep(2)
    rec = {"text": out["choices"][0]["message"]["content"], "latency": time.time() - t, "usage": out.get("usage", {})}
    json.dump(rec, open(cp, "w")); return rec

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=100); ap.add_argument("--ckpt", required=True)
    ap.add_argument("--model", default="gpt-5.6-luna"); ap.add_argument("--seed", type=int, default=11); a = ap.parse_args()
    random.seed(a.seed); torch.manual_seed(a.seed); np.random.seed(a.seed)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    key = open(os.path.expanduser("~/tips/openai.key")).read().strip()
    cache_dir = os.path.join(ROOT, "eval", "cache_iris"); os.makedirs(cache_dir, exist_ok=True)

    rows = list(csv.DictReader(open(os.path.join(ROOT, "vocab", "vocab.csv"))))
    lab2id = {r["label"]: r["id"] for r in rows}
    surface = {}
    for r in rows:
        surface[r["label"]] = r["id"]
        for al in r["aliases"].split("|"):
            if al: surface.setdefault(al, r["id"])
    # Iris Speak's split: topic nouns vs action verbs, single words, content categories only
    topic_vocab = sorted({r["label"] for r in rows if r["words"] == "1" and r["pos"] in ("noun", "adj", "other", "num")
                          and r["category"] not in ("core", "phrases", "questions")})
    action_vocab = sorted({r["label"] for r in rows if r["words"] == "1" and r["pos"] == "verb"})
    print(f"Iris vocab lists: {len(topic_vocab)} topics, {len(action_vocab)} actions (prompt ~{(len(topic_vocab)+len(action_vocab))*1.6:.0f} tokens)", flush=True)

    load = lambda s: [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", f"{s}.jsonl"))]
    qa = load("test_qa"); train_states = load("train"); dev = load("dev"); random.shuffle(dev)
    byu = collections.defaultdict(list)
    for e in qa: byu[e["id"].rsplit("_s", 1)[0]].append(e)
    firsts = [e for e in qa if not e["prefix"]]; random.shuffle(firsts); ex = firsts[: a.n]

    # ---- our side: model + reranker (retrained on 4000 dev states, ~1 min)
    model, tok, ids, speak = build_model(a.ckpt, device); n = len(ids); id2idx = {c: i for i, c in enumerate(ids)}; start_idx = n
    feats = Feats(rows, ids, train_states, id2idx)
    dev_e = dev[:4000]; top_dev = topk_states(model, tok, dev_e, id2idx, start_idx, device)
    pv = feats.partner_vecs(dev_e)
    Xd = torch.tensor(np.stack([feats.featurize(e, t, pv[i], ids) for i, (e, t) in enumerate(zip(dev_e, top_dev))]))
    Yd = torch.tensor(np.stack([labels_for(e, t, id2idx) for e, t in zip(dev_e, top_dev)]))
    mu, sd = Xd[:, :, :4].mean((0, 1)), Xd[:, :, :4].std((0, 1)) + 1e-6
    def norm(X): X = X.clone(); X[:, :, :4] = (X[:, :, :4] - mu) / sd; return X
    Xd = norm(Xd); rr = Reranker(feats.dim); opt = torch.optim.Adam(rr.parameters(), lr=2e-3, weight_decay=1e-4)
    for ep in range(40):
        perm = torch.randperm(len(Xd))
        for i in range(0, len(Xd), 128):
            b = perm[i:i+128]; s = rr(Xd[b]); y = Yd[b]; has = y.sum(1) > 0
            if has.sum() == 0: continue
            p = y[has] / y[has].sum(1, keepdim=True); loss = -(p * F.log_softmax(s[has], 1)).sum(1).mean()
            opt.zero_grad(); loss.backward(); opt.step()
    print("reranker trained", flush=True)

    def ours(st, prev_grid):
        t0 = time.time(); top = topk_states(model, tok, [st], id2idx, start_idx, device)[0]
        pvv = feats.partner_vecs([st])[0]; X = norm(torch.tensor(feats.featurize(st, top, pvv, ids))[None])
        with torch.no_grad(): s = rr(X)[0].numpy()
        order = [ids[top[0][j]] for j in np.argsort(-s)]
        grid = slate(order, st["prefix"], lab2id, prev_grid)
        return grid, time.time() - t0, order

    iris_fixed = [lab2id[l] for l in IRIS_FIXED_CORE + IRIS_FIXED_EMOTION if l in lab2id]
    def iris(st, interim_labels):
        rec = llm_call(key, a.model, iris_prompt(topic_vocab, action_vocab, interim_labels), f"<dialogue>\n\t<msg role=\"parent\">{st['partner']}</msg>\n</dialogue>", cache_dir)
        topics = [surface.get(w.lower()) for w in extract_list(rec["text"], "topics")]; actions = [surface.get(w.lower()) for w in extract_list(rec["text"], "actions")]
        topics = [c for c in topics if c][:12]; actions = [c for c in actions if c][:12]
        dyn = topics[:4] + actions[:4]
        return dyn, topics + actions, iris_fixed, rec

    res = {"iris": collections.defaultdict(float), "ours": collections.defaultdict(float)}; N = collections.Counter()
    lat = {"iris": [], "ours": []}; toks = []; examples = []
    for k, e in enumerate(ex):
        states = sorted(byu[e["id"].rsplit("_s", 1)[0]], key=lambda s: len(s["prefix"]))
        prev = None; interim = []; ex_rec = {"partner": e["partner"], "truth": [speak[c] for c in states[-1]["prefix"]], "steps": []}
        for step in range(min(2, len(states))):
            st = states[step]; tgt = set(st["targets"])
            dyn, pool, fixed, rec = iris(st, interim)
            iris_grid = dyn + [c for c in fixed if c not in dyn]
            g, dt, order = ours(st, prev); prev = g
            our_dyn = [c for c in g[4:] if c]
            hit_i, hit_i_dyn, hit_i_pool = bool(tgt & set(iris_grid)), bool(tgt & set(dyn)), bool(tgt & (set(pool) | set(fixed)))
            hit_o, hit_o_dyn, hit_o_top100 = bool(tgt & set(g)), bool(tgt & set(our_dyn)), bool(tgt & set(order))
            res["iris"][f"grid_s{step}"] += hit_i; res["iris"][f"dyn_s{step}"] += hit_i_dyn; res["iris"][f"pool24_s{step}"] += hit_i_pool
            res["ours"][f"grid_s{step}"] += hit_o; res["ours"][f"dyn_s{step}"] += hit_o_dyn; res["ours"][f"top100_s{step}"] += hit_o_top100
            N[step] += 1; lat["iris"].append(rec["latency"]); lat["ours"].append(dt); toks.append(rec["usage"].get("total_tokens", 0))
            ex_rec["steps"].append({"prefix": [speak[c] for c in st["prefix"]], "truth_next": [speak.get(t, t) for t in tgt],
                                    "iris_dyn": [speak[c] for c in dyn], "ours_dyn": [speak[c] for c in our_dyn][:8],
                                    "iris_hit": hit_i, "ours_hit": hit_o})
            interim = [speak[max(st["targets"], key=st["targets"].get)]] if step == 0 else interim
        examples.append(ex_rec)
        if (k + 1) % 20 == 0: print(f"  {k+1}/{len(ex)} utterances", flush=True)

    print(f"\n| metric | Iris Speak method on {a.model} (pure LLM) | ours (SmolLM2 fine-tuned + reranker) |")
    print("|---|---|---|")
    for step in (0, 1):
        n_ = N[step]
        print(f"| step {step}: acceptable card on the full grid | {res['iris'][f'grid_s{step}']/n_:.2f} (8 dynamic + 9 fixed) | {res['ours'][f'grid_s{step}']/n_:.2f} (12 dynamic + 4 fixed) |")
        print(f"| step {step}: on dynamic cells only | {res['iris'][f'dyn_s{step}']/n_:.2f} (8 cells) | {res['ours'][f'dyn_s{step}']/n_:.2f} (12 cells) |")
        print(f"| step {step}: anywhere in the candidate pool | {res['iris'][f'pool24_s{step}']/n_:.2f} (24 + fixed) | {res['ours'][f'top100_s{step}']/n_:.2f} (top 100) |")
    print(f"| latency per grid, median | {np.median(lat['iris']):.2f} s (network call) | {np.median(lat['ours'])*1000:.0f} ms (local, fp32, unoptimised) |")
    print(f"| tokens per call | {np.mean(toks):.0f} | 0 |")
    json.dump({"results": {k: dict(v) for k, v in res.items()}, "n": dict(N), "latency": {k: float(np.median(v)) for k, v in lat.items()},
               "tokens": float(np.mean(toks)), "examples": examples}, open(os.path.join(ROOT, "eval", "irisspeak_compare_results.json"), "w"), indent=1)
    print("\nExamples:")
    for r in examples[:8]:
        print(f"  Q: {r['partner'][:80]!r}  truth: {' '.join(r['truth'])}")
        for s in r["steps"]:
            print(f"     step prefix={s['prefix']} truth_next={s['truth_next']}\n        Iris: {s['iris_dyn']} -> {'HIT' if s['iris_hit'] else 'miss'}\n        Ours: {s['ours_dyn']} -> {'HIT' if s['ours_hit'] else 'miss'}")

if __name__ == "__main__":
    main()
