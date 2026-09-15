#!/usr/bin/env python3
"""Compare ways of using the stock SmolLM2-135M-Instruct (no training) as a next-card ranker.

Variants (all score every card's spoken form as a continuation):
  A  chat instruction prompt, mean log-prob per token            (the first attempt)
  B  plain dialogue continuation, mean log-prob per token         ("Partner: ...\nMe: <cards so far>")
  C  plain dialogue, context lift = mean lp(card|context) - mean lp(card|empty context)
  D  few-shot dialogue (3 telegraphic examples) + context lift
  E  few-shot dialogue + context lift, summed (not averaged) over tokens
Plus: best variant blended with the S1 frequency baseline (log-linear), which is how it would be used.

Usage: python3 eval/zeroshot_variants.py --n 40
"""
import argparse, csv, json, os, random, sys, time, collections
import numpy as np, torch
from transformers import AutoTokenizer, AutoModelForCausalLM
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from baselines import metrics

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = "HuggingFaceTB/SmolLM2-135M-Instruct"
FEWSHOT = ("Partner: Do you want juice or milk?\nMe: juice please\n\n"
           "Partner: How are you feeling today?\nMe: I'm tired\n\n"
           "Partner: Should we go to the park?\nMe: no, I want to stay home\n\n")

def prompt_chat(tok, e, speak):
    sofar = ", ".join(speak[c] for c in e["prefix"]) if e["prefix"] else "(nothing yet)"
    partner = e["partner"] or "(nobody has spoken; the person starts)"
    msgs = [{"role": "system", "content": "You help a person who cannot speak and talks by tapping picture cards. Given what their partner said and the cards tapped so far, say the next card as a short word or phrase."},
            {"role": "user", "content": f"Partner said: {partner}\nCards tapped so far: {sofar}\nNext card:"}]
    return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)

def prompt_plain(e, speak, fewshot=False):
    head = FEWSHOT if fewshot else ""
    partner = f"Partner: {e['partner']}\n" if e["partner"] else ""
    sofar = " ".join(speak[c].lower() if speak[c] != "I" else "I" for c in e["prefix"])
    return head + partner + "Me:" + (" " + sofar if sofar else "")

@torch.no_grad()
def score(model, tok, prompt, cand_tok, device, chunk=256, mean=True):
    p_ids = tok(prompt, add_special_tokens=False)["input_ids"]; P = len(p_ids)
    out = torch.empty(len(cand_tok))
    for s in range(0, len(cand_tok), chunk):
        cs = cand_tok[s:s+chunk]; L = max(len(c) for c in cs)
        ids = torch.full((len(cs), P + L), tok.pad_token_id, dtype=torch.long); mask = torch.zeros_like(ids)
        tgt = torch.full((len(cs), L), tok.pad_token_id, dtype=torch.long); tmask = torch.zeros((len(cs), L))
        for i, c in enumerate(cs):
            ids[i, :P] = torch.tensor(p_ids); ids[i, P:P+len(c)] = torch.tensor(c); mask[i, :P+len(c)] = 1
            tgt[i, :len(c)] = torch.tensor(c); tmask[i, :len(c)] = 1
        logits = model(input_ids=ids.to(device), attention_mask=mask.to(device), logits_to_keep=L + 1).logits
        lp = torch.log_softmax(logits.float(), -1)[:, :L, :]
        tl = lp.gather(2, tgt.to(device).unsqueeze(2)).squeeze(2) * tmask.to(device)
        out[s:s+len(cs)] = (tl.sum(1) / (tmask.to(device).sum(1) if mean else 1)).cpu()
        del logits, lp
    return out.numpy()

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=40); ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args(); random.seed(a.seed)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    rows = list(csv.DictReader(open(os.path.join(ROOT, "vocab", "vocab.csv"))))
    ids = [r["id"] for r in rows] + ["<name>", "<aac_end>"]; id2idx = {c: i for i, c in enumerate(ids)}; n = len(ids)
    speak = {r["id"]: r["speak"] for r in rows}; speak["<name>"] = "Sam"; speak["<aac_end>"] = "."
    load = lambda s: [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", f"{s}.jsonl"))]
    train = load("train"); test = load("test"); random.shuffle(test)
    # sample: mostly states with a partner turn, since that is what the LLM should exploit
    test = [e for e in test if e["partner"]][: int(a.n * 0.75)] + [e for e in test if not e["partner"]][: a.n - int(a.n * 0.75)]
    train_seen = {max(e["targets"], key=e["targets"].get) for e in train}

    # S1 frequency scores (same as baselines.py)
    uni = np.full(n, 0.1); bi = collections.defaultdict(lambda: np.full(n, 0.1))
    for e in train:
        last = id2idx.get(e["prefix"][-1], id2idx["<name>"]) if e["prefix"] else -1
        for c, w in e["targets"].items(): j = id2idx.get(c, id2idx["<name>"]); uni[j] += w; bi[last][j] += w
    def s1(e):
        last = id2idx.get(e["prefix"][-1], id2idx["<name>"]) if e["prefix"] else -1
        return np.log(0.7 * bi[last] / bi[last].sum() + 0.3 * uni / uni.sum())

    tok = AutoTokenizer.from_pretrained(MODEL); tok.pad_token = tok.pad_token or tok.eos_token
    model = AutoModelForCausalLM.from_pretrained(MODEL, dtype=torch.float16 if device == "mps" else torch.float32).to(device).eval()
    end_id = tok.convert_tokens_to_ids("<|im_end|>")
    cand_chat = [tok(" " + speak[c], add_special_tokens=False)["input_ids"][:8] for c in ids[:-1]] + [[end_id]]
    cand_plain = [tok(" " + (speak[c].lower() if speak[c] != "I" else "I"), add_special_tokens=False)["input_ids"][:8] for c in ids[:-1]] + [tok("\n", add_special_tokens=False)["input_ids"][:1]]
    print(f"device={device} states={len(test)} (with partner: {sum(1 for e in test if e['partner'])})", flush=True)

    # unconditional scores for context lift: empty context "Me:" (and few-shot + "Me:")
    t0 = time.time()
    base_plain_mean = score(model, tok, "Me:", cand_plain, device, mean=True)
    base_few_mean = score(model, tok, FEWSHOT + "Me:", cand_plain, device, mean=True)
    base_few_sum = score(model, tok, FEWSHOT + "Me:", cand_plain, device, mean=False)
    print(f"unconditional baselines done in {time.time()-t0:.1f}s", flush=True)

    variants = {"A chat+mean": [], "B plain+mean": [], "C plain+lift": [], "D fewshot+lift": [], "E fewshot+lift(sum)": []}
    raw = {k: [] for k in variants}
    t0 = time.time()
    for k, e in enumerate(test):
        sa = score(model, tok, prompt_chat(tok, e, speak), cand_chat, device)
        sb = score(model, tok, prompt_plain(e, speak), cand_plain, device)
        sd = score(model, tok, prompt_plain(e, speak, fewshot=True), cand_plain, device)
        se = score(model, tok, prompt_plain(e, speak, fewshot=True), cand_plain, device, mean=False)
        sc = {"A chat+mean": sa, "B plain+mean": sb, "C plain+lift": sb - base_plain_mean,
              "D fewshot+lift": sd - base_few_mean, "E fewshot+lift(sum)": se - base_few_sum}
        for name, s in sc.items(): raw[name].append(s); variants[name].append(list(np.argsort(-s)))
        if (k + 1) % 10 == 0: print(f"  {k+1}/{len(test)} states, {(time.time()-t0)/(k+1):.1f}s/state", flush=True)

    results = {}
    print("\n| variant | R@1 | R@8 | R@16 | R@100 | MRR |"); print("|---|---|---|---|---|---|")
    s1_orders = [list(np.argsort(-s1(e))) for e in test]
    r = metrics(s1_orders, test, id2idx, train_seen); results["S1 frequency"] = r
    print(f"| S1 frequency (reference) | {r['recall@1']:.3f} | {r['recall@8']:.3f} | {r['recall@16']:.3f} | {r['recall@100']:.3f} | {r['mrr']:.3f} |")
    for name, orders in variants.items():
        r = metrics(orders, test, id2idx, train_seen); results[name] = r
        print(f"| {name} | {r['recall@1']:.3f} | {r['recall@8']:.3f} | {r['recall@16']:.3f} | {r['recall@100']:.3f} | {r['mrr']:.3f} |")
    # blends of each lift variant with S1
    for name in ("C plain+lift", "D fewshot+lift", "E fewshot+lift(sum)"):
        for w in (0.5, 1.0, 2.0):
            orders = [list(np.argsort(-(s1(e) + w * (raw[name][i] - raw[name][i].mean()) / (raw[name][i].std() + 1e-6)))) for i, e in enumerate(test)]
            r = metrics(orders, test, id2idx, train_seen); results[f"S1 + {w}x {name}"] = r
            print(f"| S1 + {w}×z({name}) | {r['recall@1']:.3f} | {r['recall@8']:.3f} | {r['recall@16']:.3f} | {r['recall@100']:.3f} | {r['mrr']:.3f} |")
    # qualitative: best lift variant on 3 states
    best = max(("C plain+lift", "D fewshot+lift", "E fewshot+lift(sum)"), key=lambda k: results[k]["recall@16"])
    print(f"\nExamples from {best}:")
    for i, e in enumerate(test[:5]):
        o = variants[best][i]
        print(f"  partner={str(e['partner'])[:70]!r} prefix={[speak[c] for c in e['prefix']]} truth={[speak.get(t,t) for t in e['targets']]}")
        print(f"     top10={[speak[ids[j]] for j in o[:10]]}")
    json.dump(results, open(os.path.join(ROOT, "eval", "zeroshot_variants_results.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
