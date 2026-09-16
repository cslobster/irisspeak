#!/usr/bin/env python3
"""Judge boards blind: could a child answer this question, in this setting, with these cards?

The corpus gate rewards imitating the first card an adult AAC user tapped ("Feel" for "How are you?"), and the
generated gate rewards covering one sampled answer. Neither says whether a board is *good*. This shows each
model's board for the same (setting, question) to a judge that does not know which model made it, and asks for
a 0-2 answerability score plus how many of the nine cards are plausible replies.

  python3 eval/judge_boards.py --models shipped=site/public/model:export/out_v31 v5=site/model_distill_v5:export/out_distill_v5 --n 60
"""
import argparse, collections, json, os, random, re, subprocess, sys, time
import numpy as np, onnxruntime as ort
from concurrent.futures import ThreadPoolExecutor
from transformers import AutoTokenizer
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); WORK = os.path.expanduser("~/work4/aac")
CORE = ["Yes", "No", "I don't know", "Help", "More", "Stop", "Please"]

JUDGE = """You are auditing a picture-card board for a child or young adult who communicates with AAC. For each item you see where they are, what the partner just asked, and the nine cards the board offers (a fixed row of Yes / No / I don't know / Help / More / Stop / Please is always also present, so do not credit or penalise those).

Score each item:
- answerable: 0 = the child could not give a reasonable reply to that question with these cards; 1 = they could, but only a weak or partial one; 2 = a natural, specific reply is right there.
- plausible: how many of the nine cards are things a child might actually say in reply to THAT question THERE (0-9).
- filler: how many of the nine are generic function words or sentence starters (I, want, the, to, I want, I need) rather than content.

Items:
{items}

Return {{"verdicts":[{{"i":1,"answerable":2,"plausible":7,"filler":0}}]}} with one verdict per item, in order. JSON only, no fence."""


def make_board(mdir, onnx, alpha=0.0):
    meta = json.load(open(f"{mdir}/cards.json")); cards = meta["cards"]; V = meta.get("V", 49152); start = meta["start_index"]; nOut = meta["n_outputs"]; dead = set(meta.get("dead", []))
    prior = None
    if alpha > 0:
        u = np.array(json.load(open(f"{mdir}/freq.json"))["uni"], dtype=np.float64); prior = np.log((u + 1.0) / (u.sum() + len(u)))
    tok = AutoTokenizer.from_pretrained(meta.get("backbone", "HuggingFaceTB/SmolLM2-135M-Instruct")); sess = ort.InferenceSession(onnx, providers=["CPUExecutionProvider"]); names = [i.name for i in sess.get_inputs()]
    def board(setting, q, earlier=""):
        ids = tok(f"Setting: {setting}.\n{earlier}Partner: {q[:200]}\nReply cards:", add_special_tokens=True)["input_ids"] + [V + start]; L = len(ids)
        feed = {"input_ids": np.array([ids], dtype=np.int64), "attention_mask": np.ones((1, L), dtype=np.int64)}
        if "position_ids" in names: feed["position_ids"] = np.arange(L, dtype=np.int64)[None]
        lg = sess.run(None, feed)[0][0, -1, V:V + nOut].astype(np.float32)
        for j in dead: lg[j] = -1e4
        if prior is not None:
            p = np.exp(lg - lg.max()); p /= p.sum(); lg = np.log(p + 1e-12) - alpha * prior[:len(lg)]
        out = []
        for j in np.argsort(-lg):
            c = cards[j]
            if c.get("is_folder") or c["id"] in ("<aac_end>", "<name>") or c["speak"] in CORE: continue
            out.append(c["speak"])
            if len(out) >= 9: break
        return out
    return board


def questions(n, seed):
    rng = random.Random(seed); out = []
    for gate, path in (("youth", "test_qa_youth.jsonl"), ("gen", "test_gen.jsonl")):
        sts = [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", path))]
        sts = [e for e in sts if not e["prefix"] and e.get("partner")]
        rng.shuffle(sts)
        seen = set()
        for e in sts:
            k = (e.get("setting") or "unknown", e["partner"].strip().lower())
            if k in seen: continue
            seen.add(k); out.append({"gate": gate, "setting": k[0], "question": e["partner"]})
            if sum(1 for o in out if o["gate"] == gate) >= n: break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="+", required=True, help="name=model_dir:onnx_dir[:alpha] (relative to ~/work4/aac); alpha = prior debiasing")
    ap.add_argument("--n", type=int, default=60, help="questions per gate"); ap.add_argument("--seed", type=int, default=21)
    ap.add_argument("--per-call", type=int, default=6); ap.add_argument("--workers", type=int, default=6); ap.add_argument("--timeout", type=int, default=420)
    ap.add_argument("--out", default=os.path.join(ROOT, "eval", "judge_boards_results.json"))
    ap.add_argument("--history", default="none", choices=["none", "same", "off", "live"],
                    help="prepend an Earlier: block the way the app does: same = 2 turns from the same setting, off = 2 turns from another setting, live = the pair seen on the deployed account")
    a = ap.parse_args()
    boards = {}
    for spec in a.models:
        name, _, rest = spec.partition("="); parts = rest.split(":"); mdir, odir = parts[0], parts[1]; alpha = float(parts[2]) if len(parts) > 2 else 0.0
        boards[name] = make_board(os.path.join(WORK, mdir), os.path.join(WORK, odir, "card_model_fp16.onnx"), alpha)
    qs = questions(a.n, a.seed)
    # the Earlier: block, built the way web-client/src/engine/model.ts builds it ("partner | answer", last 2 turns)
    rng = random.Random(a.seed + 1); turns = collections.defaultdict(list)
    if a.history in ("same", "off"):
        import glob
        for fp in glob.glob(os.path.join(os.path.dirname(ROOT), "datasets", "aac-setting-turns", "data", "*.jsonl")):
            for line in open(fp):
                try: t = json.loads(line)
                except Exception: continue
                if t.get("question") and t.get("cards"): turns[t.get("setting", "unknown")].append(f'{t["question"]} | {" ".join(t["cards"])}')
    def earlier_for(q):
        if a.history == "none": return ""
        if a.history == "live": return "Earlier: What do you need? | I need to fix this, talk to you then. | How's it going today? | I think pretty good.\n"
        s = q["setting"]; src = s if a.history == "same" else rng.choice([x for x in turns if x != s] or [s])
        pool = turns.get(src) or turns.get(s) or []
        return ("Earlier: " + " | ".join(h[:120] for h in rng.sample(pool, min(2, len(pool)))) + "\n") if pool else ""
    for q in qs: q["earlier"] = earlier_for(q)
    # every (question, model) pair becomes one blind item; shuffle so a judge call mixes models
    items = [{"q": q, "model": m, "cards": boards[m](q["setting"], q["question"], q["earlier"])} for q in qs for m in boards]
    random.Random(a.seed).shuffle(items)
    batches = [items[i:i + a.per_call] for i in range(0, len(items), a.per_call)]
    def run(b):
        txt = "\n".join(f'{i+1}. setting={it["q"]["setting"]} | partner asked: "{it["q"]["question"]}" | board: {", ".join(it["cards"])}' for i, it in enumerate(b))
        cmd = ["claude", "-p", JUDGE.format(items=txt), "--allowed-tools", ""]
        for attempt in range(3):
            try:
                out = subprocess.run(cmd, capture_output=True, text=True, timeout=a.timeout, stdin=subprocess.DEVNULL).stdout
                return b, json.loads(re.search(r"\{.*\}", out, re.S).group(0))["verdicts"]
            except Exception:
                if attempt == 2: return b, []
                time.sleep(3)
    agg = collections.defaultdict(lambda: collections.defaultdict(list)); rows = []
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for b, verdicts in ex.map(run, batches):
            for v in verdicts:
                i = v.get("i")
                if not isinstance(i, int) or not (1 <= i <= len(b)): continue
                it = b[i - 1]; key = (it["model"], it["q"]["gate"])
                for f in ("answerable", "plausible", "filler"):
                    if isinstance(v.get(f), (int, float)): agg[key][f].append(float(v[f]))
                rows.append({**it["q"], "model": it["model"], "cards": it["cards"], **{f: v.get(f) for f in ("answerable", "plausible", "filler")}})
    json.dump(rows, open(a.out, "w"), indent=1)
    print(f"{len(qs)} questions x {len(boards)} models, history={a.history}, judged blind ({len(rows)} verdicts)\n")
    print(f"{'model':<10}{'gate':<7}{'n':>4}{'answerable 0-2':>16}{'plausible /9':>14}{'filler /9':>11}{'answerable=2':>14}")
    for m in boards:
        for g in ("youth", "gen"):
            d = agg[(m, g)]
            if not d["answerable"]: continue
            an = d["answerable"]
            print(f"{m:<10}{g:<7}{len(an):>4}{np.mean(an):>16.2f}{np.mean(d['plausible']):>14.1f}{np.mean(d['filler']):>11.1f}{sum(1 for x in an if x >= 2)/len(an):>14.0%}")
    print(f"\nwrote {a.out}")

if __name__ == "__main__":
    main()
