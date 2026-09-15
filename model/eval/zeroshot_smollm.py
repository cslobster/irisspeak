#!/usr/bin/env python3
"""Zero-shot next-card baseline: stock SmolLM2-135M-Instruct, no training.

For each state the model sees a chat prompt with the partner turn and the reply so far (spoken forms of the
tapped cards). Every card is scored by the log-probability of its spoken form as the continuation, length
normalised; <aac_end> is scored by the probability of the assistant end-of-turn token. Cards are ranked by
that score. This is the "use the model end to end without training" baseline.

Usage: python3 eval/zeroshot_smollm.py --states data/states --max-eval 500 --chunk 384
"""
import argparse, csv, json, os, random, time, collections, sys
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from baselines import metrics, show

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = "HuggingFaceTB/SmolLM2-135M-Instruct"
SYSTEM = ("You help a person who cannot speak and talks by tapping picture cards. Given what their partner said "
          "and the cards tapped so far, say the next card as a short word or phrase.")

def build_prompt(tok, e, speak):
    sofar = ", ".join(speak[c] for c in e["prefix"]) if e["prefix"] else "(nothing yet)"
    partner = e["partner"] or "(nobody has spoken; the person starts)"
    user = f"Partner said: {partner}\nCards tapped so far: {sofar}\nNext card:"
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
    return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)

@torch.no_grad()
def score_state(model, tok, prompt, cand_tok, end_id, device, chunk):
    """Return a score per candidate. cand_tok: list of token-id lists (already with leading space)."""
    p_ids = tok(prompt, add_special_tokens=False)["input_ids"]
    P = len(p_ids); scores = torch.empty(len(cand_tok))
    for s in range(0, len(cand_tok), chunk):
        cs = cand_tok[s:s+chunk]; L = max(len(c) for c in cs)
        ids = torch.full((len(cs), P + L), tok.pad_token_id, dtype=torch.long)
        mask = torch.zeros((len(cs), P + L), dtype=torch.long)
        for i, c in enumerate(cs):
            ids[i, :P] = torch.tensor(p_ids); ids[i, P:P+len(c)] = torch.tensor(c); mask[i, :P+len(c)] = 1
        ids, mask = ids.to(device), mask.to(device)
        # only the last L+1 positions can predict candidate tokens: keep just those logits (memory-safe)
        logits = model(input_ids=ids, attention_mask=mask, logits_to_keep=L + 1).logits   # (B, L+1, V)
        lp = torch.log_softmax(logits.float(), -1)          # (B, L+1, V); kept position 0 == absolute P-1
        # vectorised gather: candidate token j sits at kept position j
        tgt = torch.full((len(cs), L), tok.pad_token_id, dtype=torch.long)
        tmask = torch.zeros((len(cs), L))
        for i, c in enumerate(cs):
            tgt[i, :len(c)] = torch.tensor(c); tmask[i, :len(c)] = 1
        tgt, tmask = tgt.to(device), tmask.to(device)
        tok_lp = lp[:, :L, :].gather(2, tgt.unsqueeze(2)).squeeze(2)   # (B, L)
        scores[s:s+len(cs)] = ((tok_lp * tmask).sum(1) / tmask.sum(1)).cpu()
        del logits, lp
    # end-of-turn: prob of the assistant end token right after the prompt (single token, not normalised)
    return scores

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--states", default=os.path.join(ROOT, "data", "states"))
    ap.add_argument("--max-eval", type=int, default=500)
    ap.add_argument("--chunk", type=int, default=128)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args(); random.seed(a.seed)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    rows = list(csv.DictReader(open(os.path.join(ROOT, "vocab", "vocab.csv"))))
    ids = [r["id"] for r in rows] + ["<name>", "<aac_end>"]; id2idx = {c: i for i, c in enumerate(ids)}
    speak = {r["id"]: r["speak"] for r in rows}; speak["<name>"] = "Sam"; speak["<aac_end>"] = "(end)"
    load = lambda s: [json.loads(l) for l in open(os.path.join(a.states, f"{s}.jsonl"))]
    train = load("train"); test = load("test"); random.shuffle(test); test = test[: a.max_eval]
    train_seen = {max(e["targets"], key=e["targets"].get) for e in train}

    tok = AutoTokenizer.from_pretrained(MODEL); tok.pad_token = tok.pad_token or tok.eos_token
    model = AutoModelForCausalLM.from_pretrained(MODEL, torch_dtype=torch.float16 if device == "mps" else torch.float32).to(device).eval()
    end_id = tok.convert_tokens_to_ids("<|im_end|>")
    # candidate token sequences: leading space, lowercase spoken form except "I"
    cand_tok = []
    for c in ids[:-1]:
        text = " " + speak[c]
        cand_tok.append(tok(text, add_special_tokens=False)["input_ids"][:8])
    cand_tok.append([end_id])          # <aac_end>
    print(f"device={device} test states={len(test)} candidates={len(cand_tok)}", flush=True)

    orders = []; t0 = time.time()
    for k, e in enumerate(test):
        sc = score_state(model, tok, build_prompt(tok, e, speak), cand_tok, end_id, device, a.chunk)
        orders.append(sc.argsort(descending=True).tolist())
        if (k + 1) % 25 == 0: print(f"  {k+1}/{len(test)} states, {(time.time()-t0)/(k+1):.2f}s/state", flush=True)
    r = metrics(orders, test, id2idx, train_seen); show("S-zero SmolLM2-135M zero-shot", r)
    # a few qualitative rows
    for e, o in list(zip(test, orders))[:6]:
        print(f"  partner={str(e['partner'])[:60]!r} prefix={[speak[c] for c in e['prefix']]} targets={[speak.get(t,t) for t in e['targets']]}")
        print(f"     top8={[speak[ids[i]] for i in o[:8]]}")
    json.dump(r, open(os.path.join(ROOT, "eval", "zeroshot_smollm_results.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
