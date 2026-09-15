#!/usr/bin/env python3
"""Fine-tune SmolLM2-135M-Instruct as a next-card predictor over the AAC vocabulary, and evaluate.

Representation
  * Text part of the prompt (setting, partner, history) goes through the normal token embedding.
  * Card tokens are NOT added to the tokenizer. Each card (and <aac_start>, <aac_end>) has a row in a separate
    trainable matrix `card_emb` (n_cards+2, hidden), initialised from the mean of the model's embeddings of the
    card's spoken form. Card positions are fed as inputs_embeds. The same matrix is the output head
    (tied), so logits are computed over the 3,095 card rows only. This is the "sliced head" natively.
  * Loss: cross-entropy between the soft target distribution and softmax over card rows at the last position.

Two parameter groups: backbone (lr_backbone) and card_emb (lr_cards).

Usage
  python3 train/train_smollm.py --states data/states --out train/out/smollm135 --epochs 1 --max-train 60000
  python3 train/train_smollm.py --eval-only --out train/out/smollm135
"""
import argparse, csv, json, math, os, random, time, collections
import torch, torch.nn.functional as F
from transformers import AutoTokenizer, AutoModelForCausalLM

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = "HuggingFaceTB/SmolLM2-135M-Instruct"

FOLDERS_JSON = os.path.join(ROOT, "data", "states", "folders.json")

def load_folders():
    """v3 folder rows written by data/build_states.py --folders: [{id: '<folder:food>', label, members: [card ids]}]."""
    if not os.path.exists(FOLDERS_JSON): return []
    return json.load(open(FOLDERS_JSON))["folders"]

def load_vocab(folders=True):
    rows = list(csv.DictReader(open(os.path.join(ROOT, "vocab", "vocab.csv"))))
    folders = load_folders() if folders else []
    ids = [r["id"] for r in rows] + [f["id"] for f in folders] + ["<name>", "<aac_end>"]
    speak = {r["id"]: r["speak"] for r in rows}; speak["<name>"] = "someone's name"; speak["<aac_end>"] = "end of message"
    for f in folders: speak[f["id"]] = f["label"] + " folder"
    return ids, speak

def prompt_text(ex):
    parts = [f"Setting: {ex.get('setting') or 'unknown'}."]
    if ex.get("history"): parts.append("Earlier: " + " | ".join(h[:120] for h in ex["history"]))
    parts.append(f"Partner: {ex['partner'][:200]}" if ex.get("partner") else "Partner: (nobody has spoken)")
    parts.append("Reply cards:")
    return "\n".join(parts)

class CardModel(torch.nn.Module):
    def __init__(self, base, n_cards, init_rows):
        super().__init__()
        self.base = base
        self.card_emb = torch.nn.Parameter(init_rows.clone())        # (n_cards+1 [start], hidden); last row = <aac_start>
        self.n_cards = n_cards
        # v3: output mask. Rows with no training signal are removed from the softmax (they stay reachable in the app
        # through search and folders). All ones = no masking; saved with the checkpoint, exported as a list.
        self.register_buffer("out_mask", torch.ones(n_cards, dtype=torch.bool))
        # the text decoder: base.model for plain causal LMs; base.model.language_model for multimodal
        # wrappers such as Qwen3.5 (vision tower unused)
        dec = base.model
        if hasattr(dec, "language_model"): dec = dec.language_model
        self.decoder = dec
    def forward(self, text_ids, text_mask, card_idx, card_mask):
        # text_ids (B,T), card_idx (B,C) indices into card_emb (start token + prefix), card_mask (B,C)
        emb = self.base.get_input_embeddings()
        te = emb(text_ids)                                            # (B,T,H)
        ce = self.card_emb[card_idx]                                  # (B,C,H)
        x = torch.cat([te, ce], 1); m = torch.cat([text_mask, card_mask], 1)
        # right padding: gather the hidden state at the last real position
        out = self.decoder(inputs_embeds=x, attention_mask=m)
        h = out.last_hidden_state                                     # (B,T+C,H)
        last = m.sum(1) - 1
        hl = h[torch.arange(h.size(0), device=h.device), last]        # (B,H)
        logits = hl @ self.card_emb[: self.n_cards].T                 # over cards + folders + <name> + <aac_end>
        if not bool(self.out_mask.all()): logits = logits.masked_fill(~self.out_mask, -1e4)
        return logits, hl

def encode_batch(tok, exs, id2idx, start_idx, device, max_text=96, max_cards=10):
    texts = [prompt_text(e) for e in exs]
    t = tok(texts, padding=True, truncation=True, max_length=max_text, return_tensors="pt")
    cards = []
    for e in exs:
        seq = [start_idx] + [id2idx.get(c, id2idx["<name>"]) for c in e["prefix"]][-max_cards:]
        cards.append(seq)
    C = max(len(c) for c in cards)
    card_idx = torch.zeros(len(exs), C, dtype=torch.long); card_mask = torch.zeros(len(exs), C, dtype=torch.long)
    for i, c in enumerate(cards):
        card_idx[i, :len(c)] = torch.tensor(c); card_mask[i, :len(c)] = 1
    # move card block right after real text: easier to right-pad text then cards; masked positions ignored
    return (t["input_ids"].to(device), t["attention_mask"].to(device), card_idx.to(device), card_mask.to(device))

def soft_targets(exs, id2idx, n, device):
    T = torch.zeros(len(exs), n)
    for i, e in enumerate(exs):
        for c, w in e["targets"].items(): T[i, id2idx.get(c, id2idx["<name>"])] += w
    T = T / T.sum(1, keepdim=True).clamp(min=1e-9)
    return T.to(device)

@torch.no_grad()
def evaluate(model, tok, exs, id2idx, start_idx, device, bs=64, train_seen=None, dump=None):
    model.eval(); n = model.n_cards
    ks = (1, 8, 16, 100); hits = {k: 0 for k in ks}; mrr = 0.0; N = 0
    groups = collections.defaultdict(lambda: {"n": 0, "r16": 0})
    end_tp = end_fp = end_fn = 0
    # v3: folder rows are excluded from the card ranking (so recall@k stays comparable with v2) and scored separately
    fidx = [i for c, i in id2idx.items() if c.startswith("<folder:")]
    fset = set(fidx); f_n = f_tp = f_pred = f_gold = f_top16 = 0
    for i in range(0, len(exs), bs):
        b = exs[i:i+bs]
        logits, _ = model(*encode_batch(tok, b, id2idx, start_idx, device))
        if fidx:
            forder = logits[:, fidx].argsort(1, descending=True).cpu()
            full = logits.argsort(1, descending=True).cpu()
            logits[:, fidx] = -1e4
        order = logits.argsort(1, descending=True).cpu()
        for j, e in enumerate(b):
            if fidx:
                gold_f = {id2idx[c] for c in e["targets"] if c.startswith("<folder:")}
                if gold_f:
                    pred_f = {fidx[int(x)] for x in forder[j][:2]}
                    f_n += 1; f_tp += len(pred_f & gold_f); f_pred += len(pred_f); f_gold += len(gold_f)
                    f_top16 += bool(gold_f & {int(x) for x in full[j][:16]})
            tgt = {id2idx.get(c, id2idx["<name>"]) for c in e["targets"] if not c.startswith("<folder:")}
            if not tgt: continue
            ranks = [(order[j] == t).nonzero()[0].item() + 1 for t in tgt]
            best = min(ranks); N += 1; mrr += 1.0 / best
            for k in ks: hits[k] += best <= k
            top1 = order[j][0].item(); is_end = id2idx["<aac_end>"] in tgt
            if is_end and top1 == id2idx["<aac_end>"]: end_tp += 1
            elif is_end: end_fn += 1
            elif top1 == id2idx["<aac_end>"]: end_fp += 1
            g = []
            g.append("partner" if e.get("partner") else "no_partner")
            if train_seen is not None:
                ref = max(e["targets"], key=e["targets"].get)
                g.append("tail_unseen" if ref not in train_seen and ref != "<aac_end>" else "seen")
            g.append(e.get("source", "?"))
            for name in g:
                groups[name]["n"] += 1; groups[name]["r16"] += best <= 16
            if dump is not None:
                dump.write(json.dumps({"id": e["id"], "top16": [int(x) for x in order[j][:16]], "best_rank": best}) + "\n")
    res = {f"recall@{k}": hits[k] / N for k in ks}; res["mrr"] = mrr / N; res["n"] = N
    res["end_precision"] = end_tp / max(1, end_tp + end_fp); res["end_recall"] = end_tp / max(1, end_tp + end_fn)
    res["groups_recall@16"] = {g: (v["r16"] / v["n"], v["n"]) for g, v in groups.items()}
    if f_n:
        res["folder_n"] = f_n; res["folder_precision@2"] = f_tp / max(1, f_pred); res["folder_recall@2"] = f_tp / max(1, f_gold)
        res["folder_in_top16"] = f_top16 / f_n
    model.train(); return res

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--states", default=os.path.join(ROOT, "data", "states"))
    ap.add_argument("--out", default=os.path.join(ROOT, "train", "out", "smollm135"))
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument("--bs", type=int, default=32)
    ap.add_argument("--lr-backbone", type=float, default=3e-5)
    ap.add_argument("--lr-cards", type=float, default=1e-3)
    ap.add_argument("--max-train", type=int, default=0)
    ap.add_argument("--max-eval", type=int, default=4000)
    ap.add_argument("--eval-only", action="store_true")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--save-every", type=int, default=1000)
    ap.add_argument("--weighted", action="store_true", help="sample each epoch by the states' weight field")
    ap.add_argument("--model", default=MODEL, help="HF causal LM backbone (any model with .model and tied/untied input embeddings)")
    ap.add_argument("--no-folders", action="store_true", help="v2-style model without the <folder:*> output rows")
    ap.add_argument("--mask-dead", action="store_true", help="mask card rows that are never a training target out of the softmax")
    a = ap.parse_args()
    random.seed(a.seed); torch.manual_seed(a.seed)
    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    os.makedirs(a.out, exist_ok=True)

    ids, speak = load_vocab(folders=not a.no_folders); n_cards = len(ids); id2idx = {c: i for i, c in enumerate(ids)}; start_idx = n_cards
    model_name = a.model
    tok = AutoTokenizer.from_pretrained(model_name); tok.padding_side = "right"
    if tok.pad_token_id is None: tok.pad_token = tok.eos_token
    try:
        base = AutoModelForCausalLM.from_pretrained(model_name, dtype=torch.float32)
    except Exception as e:   # multimodal checkpoints (Qwen3.5): load the wrapper, the trainer uses its language model
        import transformers
        Auto = getattr(transformers, "AutoModelForMultimodalLM", None) or transformers.AutoModelForImageTextToText
        print(f"AutoModelForCausalLM failed ({type(e).__name__}); loading with {Auto.__name__}", flush=True)
        base = Auto.from_pretrained(model_name, dtype=torch.float32)
    # multimodal checkpoints: drop the vision tower, only the language model is trained, saved and exported
    for holder in (base, getattr(base, "model", None)):
        for attr in ("visual", "vision_tower", "vision_model", "multi_modal_projector"):
            if holder is not None and hasattr(holder, attr) and getattr(holder, attr) is not None:
                n_v = sum(p.numel() for p in getattr(holder, attr).parameters())
                setattr(holder, attr, None); print(f"vision tower {attr} removed ({n_v/1e6:.0f}M params)", flush=True)
    print(f"backbone {model_name}: {sum(p.numel() for p in base.parameters())/1e6:.0f}M params", flush=True)
    json.dump({"model": model_name}, open(os.path.join(a.out, "backbone.json"), "w"))
    emb = base.get_input_embeddings().weight.detach()
    # init card rows from the mean embedding of the spoken form; <aac_start> from "Reply:"
    init = torch.zeros(n_cards + 1, emb.size(1))
    for i, c in enumerate(ids):
        tid = tok(speak[c], add_special_tokens=False)["input_ids"]; init[i] = emb[tid].mean(0)
    init[start_idx] = emb[tok("Reply:", add_special_tokens=False)["input_ids"]].mean(0)
    folders = load_folders() if not a.no_folders else []
    for f in folders:   # folder rows start at the mean of their member cards' rows
        mem = [id2idx[c] for c in f["members"] if c in id2idx]
        if mem: init[id2idx[f["id"]]] = init[mem].mean(0)
    model = CardModel(base, n_cards, init).to(device)

    load = lambda s: [json.loads(l) for l in open(os.path.join(a.states, f"{s}.jsonl"))]
    train = load("train"); dev = load("dev"); test = load("test")
    qa = [json.loads(l) for l in open(os.path.join(a.states, "test_qa.jsonl"))] if os.path.exists(os.path.join(a.states, "test_qa.jsonl")) else []
    train_seen = {max(e["targets"], key=e["targets"].get) for e in train}
    if a.mask_dead:
        seen_any = {c for e in train for c in e["targets"]}
        keep = torch.tensor([c in seen_any or c.startswith("<") for c in ids], dtype=torch.bool)
        model.out_mask.copy_(keep.to(device)); print(f"mask-dead: {int((~keep).sum())} of {n_cards} rows masked", flush=True)
    random.shuffle(train)
    if a.max_train: train = train[: a.max_train]
    random.shuffle(dev); random.shuffle(test)
    dev_e = dev[: a.max_eval]; test_e = test[: a.max_eval]
    print(f"device={device} train={len(train)} dev={len(dev_e)} test={len(test_e)} cards={n_cards}", flush=True)

    ckpt = os.path.join(a.out, "card_model.pt")
    if a.eval_only:
        sd = torch.load(ckpt, map_location=device)
        if a.mask_dead and "out_mask" in sd: del sd["out_mask"]   # keep the mask computed from the current train set
        model.load_state_dict(sd, strict=False)
    else:
        opt = torch.optim.AdamW([{"params": model.base.parameters(), "lr": a.lr_backbone},
                                 {"params": [model.card_emb], "lr": a.lr_cards}], weight_decay=0.01)
        steps_total = int(math.ceil(len(train) / a.bs) * a.epochs); warm = min(200, steps_total // 10)
        sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / max(1, warm)) * max(0.05, 1 - s / max(1, steps_total)))
        model.train(); step = 0; t0 = time.time(); run_loss = 0.0
        # zero-shot eval before training (card rows only mean-initialised)
        r0 = evaluate(model, tok, dev_e[:1000], id2idx, start_idx, device)
        print("before training dev:", {k: round(v, 3) for k, v in r0.items() if isinstance(v, float)}, flush=True)
        while step < steps_total:
            if a.weighted:
                w = [e.get("weight", 1.0) for e in train]; epoch = random.choices(train, weights=w, k=len(train))
            else:
                random.shuffle(train); epoch = train
            for i in range(0, len(epoch), a.bs):
                if step >= steps_total: break
                b = epoch[i:i+a.bs]
                logits, _ = model(*encode_batch(tok, b, id2idx, start_idx, device))
                T = soft_targets(b, id2idx, n_cards, device)
                loss = -(T * F.log_softmax(logits, 1)).sum(1).mean()
                loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
                run_loss += loss.item(); step += 1
                if device == "mps" and step % 100 == 0: torch.mps.empty_cache()
                if step % 50 == 0:
                    el = time.time() - t0
                    print(f"step {step}/{steps_total} loss {run_loss/50:.3f} {el/step:.2f}s/step eta {(steps_total-step)*el/step/60:.1f}min", flush=True); run_loss = 0.0
                if step % 500 == 0:
                    r = evaluate(model, tok, dev_e[:1000], id2idx, start_idx, device)
                    print(f"  dev@{step}: r@1 {r['recall@1']:.3f} r@16 {r['recall@16']:.3f} r@100 {r['recall@100']:.3f} mrr {r['mrr']:.3f} end_p {r['end_precision']:.2f}", flush=True)
                if a.save_every and step % a.save_every == 0:
                    torch.save(model.state_dict(), ckpt); print(f"  checkpoint saved at step {step}", flush=True)
        torch.save(model.state_dict(), ckpt)
        print(f"saved {ckpt}; train time {(time.time()-t0)/60:.1f} min", flush=True)

    results = {}
    random.shuffle(qa)
    for name, exs in (("dev", dev_e), ("test", test_e), ("test_qa", qa[: a.max_eval])):
        if not exs: continue
        with open(os.path.join(a.out, f"{name}_top16.jsonl"), "w") as dump:
            r = evaluate(model, tok, exs, id2idx, start_idx, device, train_seen=train_seen, dump=dump)
        results[name] = r
        print(f"{name}: " + " ".join(f"{k}={v:.3f}" for k, v in r.items() if isinstance(v, float)), flush=True)
        for g, (v, n) in sorted(r["groups_recall@16"].items()): print(f"   {name} recall@16 [{g}] = {v:.3f} (n={n})", flush=True)
    json.dump(results, open(os.path.join(a.out, "results.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
