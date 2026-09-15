#!/usr/bin/env python3
"""Does the card model actually use the setting?

board_eval.py and the question bank both predate setting-conditioning, and neither varies the setting, so
neither can see the failure this measures: the shipped model, asked "What do you want to do?" with the setting
on play, ranked coffee 10th and a ball 2396th.

Two numbers, both computed by asking the SAME question in every setting and comparing:

  sensitivity  how much the top-of-board changes when only the setting changes. 0 means the setting token is
               ignored entirely. Reported as mean Jaccard DISTANCE between the top-k card sets of two settings.
  precision    of the cards the model puts on the board for a setting, what share are ones the teacher data
               associates with that setting rather than another. This is the one that says whether the
               sensitivity is pointed the right way -- a model could be highly sensitive and still wrong.

  python3 eval/setting_eval.py --onnx export/out_v31/card_model_fp16.onnx
  python3 eval/setting_eval.py --ckpt train/out/distill_v1/card_model.pt   (torch, before export)
"""
import argparse, collections, glob, json, math, os, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(ROOT)
SETTINGS = ["home", "school", "restaurant", "doctor", "play", "transport", "selfcare"]
# questions deliberately chosen to be setting-neutral in their wording: any change in the board must come
# from the setting token, not from the words of the question.
PROBES = ["What do you want to do?", "What do you want?", "How's it going?", "What happened?",
          "Anything else?", "What do you need?", "Any favorites?", "What are you thinking about?"]


def load_teacher_associations(dataset):
    """Which cards the generated data associates with which setting, as a share of that card's total use.
    A card used only at play gets 1.0 for play; a card used everywhere gets ~1/7 everywhere."""
    per = collections.defaultdict(collections.Counter)
    for p in glob.glob(os.path.join(dataset, "data", "*.jsonl")):
        for line in open(p):
            line = line.strip()
            if not line: continue
            try: r = json.loads(line)
            except Exception: continue
            if r.get("setting") not in SETTINGS: continue
            for w in r.get("cards", []): per[w.strip().lower()][r["setting"]] += 1
    share = {}
    for w, c in per.items():
        t = sum(c.values())
        if t >= 3: share[w] = {s: n / t for s, n in c.items()}
    return share


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", default=os.environ.get("BOARD_ONNX") or os.path.join(ROOT, "export", "out_v31", "card_model_fp16.onnx"))
    ap.add_argument("--model-dir", default=os.environ.get("BOARD_MODEL_DIR") or os.path.join(ROOT, "site", "public", "model"))
    ap.add_argument("--dataset", default=os.path.join(REPO, "datasets", "aac-setting-turns"))
    ap.add_argument("--k", type=int, default=9, help="board size to compare (Topic panel)")
    ap.add_argument("--show", type=int, default=0, help="print the top-k board for this many probes")
    ap.add_argument("--ckpt", default="", help="score a torch checkpoint (train/out/<run>/card_model.pt) instead of ONNX, so a fresh run can be measured before export")
    ap.add_argument("--backbone", default="HuggingFaceTB/SmolLM2-135M-Instruct")
    a = ap.parse_args()

    from transformers import AutoTokenizer
    meta = json.load(open(os.path.join(a.model_dir, "cards.json")))
    cards = meta["cards"]; V = meta.get("V", 49152); start = meta["start_index"]; nOut = meta["n_outputs"]
    dead = set(meta.get("dead", []))
    tok = AutoTokenizer.from_pretrained(meta.get("backbone", a.backbone))

    if a.ckpt:
        # score the trained checkpoint directly: a fresh run can be judged before spending an export cycle on it
        import torch
        sys.path.insert(0, os.path.join(ROOT, "train"))
        from train_smollm import CardModel
        from transformers import AutoModelForCausalLM
        sd = torch.load(a.ckpt, map_location="cpu")
        if "model" in sd: sd = sd["model"]
        n_cards = sd["card_emb"].shape[0] - 1
        base = AutoModelForCausalLM.from_pretrained(a.backbone, torch_dtype=torch.float32)
        model = CardModel(base, n_cards, sd["card_emb"]); model.load_state_dict(sd, strict=False); model.eval()
        ckpt_mask = sd.get("out_mask")
        def logits_for(setting, question):
            ids = tok(f"Setting: {setting}.\nPartner: {question[:200]}\nReply cards:", add_special_tokens=True)["input_ids"]
            with torch.no_grad():
                lg, _ = model(torch.tensor([ids]), torch.ones(1, len(ids), dtype=torch.long),
                              torch.tensor([[n_cards]]), torch.ones(1, 1, dtype=torch.long))
            return lg[0, :nOut].float().numpy()
        masked = set(i for i, m in enumerate(ckpt_mask.tolist()) if not m) if ckpt_mask is not None else dead
    else:
        import onnxruntime as ort
        sess = ort.InferenceSession(a.onnx, providers=["CPUExecutionProvider"])
        innames = [i.name for i in sess.get_inputs()]
        masked = dead
        def logits_for(setting, question):
            ids = tok(f"Setting: {setting}.\nPartner: {question[:200]}\nReply cards:", add_special_tokens=True)["input_ids"] + [V + start]
            L = len(ids)
            feed = {"input_ids": np.array([ids], dtype=np.int64), "attention_mask": np.ones((1, L), dtype=np.int64)}
            if "position_ids" in innames: feed["position_ids"] = np.arange(L, dtype=np.int64)[None]
            return sess.run(None, feed)[0][0, -1, V:V + nOut].astype(np.float32)

    def board(setting, question):
        lg = logits_for(setting, question).copy()
        for j in masked: lg[j] = -1e4
        order = np.argsort(-lg)
        out = []
        for j in order:
            c = cards[j]
            if c.get("is_folder") or c["category"] == "core" or c["id"] in ("<aac_end>", "<name>"): continue
            out.append(c["speak"])
            if len(out) >= a.k: break
        return out

    boards = {(s, q): board(s, q) for s in SETTINGS for q in PROBES}

    # 1. sensitivity: how different are two settings' boards for the same question
    dists = []
    for q in PROBES:
        for i, s1 in enumerate(SETTINGS):
            for s2 in SETTINGS[i + 1:]:
                A, B = set(boards[(s1, q)]), set(boards[(s2, q)])
                dists.append(1 - len(A & B) / max(1, len(A | B)))
    sensitivity = float(np.mean(dists))

    # 2. precision: are the cards it chooses the ones the teacher data ties to that setting
    share = load_teacher_associations(a.dataset)
    scored = matched = 0; per_setting = collections.defaultdict(list)
    for (s, q), b in boards.items():
        for w in b:
            sh = share.get(w.lower())
            if not sh: continue
            scored += 1
            best = max(sh, key=sh.get)
            hit = 1.0 if best == s else 0.0
            matched += hit; per_setting[s].append(hit)

    print(f"model: {a.ckpt or a.onnx}")
    print(f"probes: {len(PROBES)} setting-neutral questions x {len(SETTINGS)} settings, top-{a.k} boards\n")
    print(f"setting sensitivity : {sensitivity:.3f}   (0 = the setting token changes nothing, 1 = boards disjoint)")
    if scored:
        print(f"setting precision   : {matched/scored:.3f}   ({scored} board cards had a teacher association)")
        for s in SETTINGS:
            v = per_setting[s]
            if v: print(f"    {s:<11} {np.mean(v):.2f}  over {len(v)} cards")
    else:
        print("setting precision   : no board card had a teacher association (dataset missing?)")
    for q in PROBES[:a.show]:
        print(f'\n  "{q}"')
        for s in SETTINGS: print(f"    {s:<11} {', '.join(boards[(s, q)])}")


if __name__ == "__main__":
    main()
