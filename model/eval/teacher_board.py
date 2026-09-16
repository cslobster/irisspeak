#!/usr/bin/env python3
"""Score the teacher itself as the board: ask the large model for its next-card distribution and treat its top
cards as what the child sees. This is the ceiling for distillation, and the answer to "is the teacher's own
output good enough?" Scoring mirrors board_eval: a question passes when one of its expected cards is on the
board, where the board is the teacher's top-K mapped content cards plus the fixed core row.

  python3 eval/teacher_board.py --gate gen                       # from data/distill/targets.jsonl, no calls
  python3 eval/teacher_board.py --gate youth --live              # asks the teacher (claude -p)
  python3 eval/teacher_board.py --gate bank  --live
"""
import argparse, collections, csv, json, os, random, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "data"))
from distill_cards import TEMPLATE, call_claude
CORE = ["yes", "no", "i don't know", "help", "more", "stop", "please"]

def surface():
    rows = list(csv.DictReader(open(os.path.join(ROOT, "vocab", "vocab.csv")))); surf = {}; speak = {}
    for r in rows:
        speak[r["id"]] = r["speak"]
        for k in [r["label"].lower(), r["speak"].lower()] + [x.lower() for x in r["aliases"].split("|") if x]: surf.setdefault(k, r["id"])
    return surf, speak
def to_card(w, surf):
    w = w.strip().lower()
    for c in (w, w.rstrip("s"), w + "s", w.replace("-", " ")):
        if c in surf: return surf[c]

def load_gate(gate, n, seed=11):
    if gate == "bank":
        bank = json.load(open(os.path.join(ROOT, "eval", "board_bank.json")))
        return [{"setting": s, "question": it["q"], "expect": it["expect"]} for s, qs in bank.items() if not s.startswith("_") for it in qs]
    path = {"youth": "test_qa_youth.jsonl", "gen": "test_gen.jsonl", "corpus": "test_qa.jsonl"}[gate]
    sts = [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", path))]
    sts = [e for e in sts if not e["prefix"] and e.get("partner") and any(not k.startswith("<") for k in e["targets"])]
    random.Random(seed).shuffle(sts)   # same seed as board_eval, so the same 400 questions
    return [{"setting": e.get("setting") or "unknown", "question": e["partner"], "expect_ids": [k for k in e["targets"] if not k.startswith("<")]} for e in sts[:n]]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--gate", choices=["gen", "youth", "bank", "corpus"], required=True)
    ap.add_argument("--live", action="store_true", help="ask the teacher now (else look answers up in data/distill/targets*.jsonl)")
    ap.add_argument("--n", type=int, default=400); ap.add_argument("--per-call", type=int, default=8); ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--k", default="9,18"); a = ap.parse_args()
    surf, speak = surface(); items = load_gate(a.gate, a.n)
    for it in items:
        if "expect" in it: it["expect_ids"] = [to_card(w, surf) for w in it["expect"]]; it["expect_ids"] = [c for c in it["expect_ids"] if c]
    if a.live:
        batches = [items[i:i + a.per_call] for i in range(0, len(items), a.per_call)]
        def run(b):
            txt = "\n".join(f'{i+1}. setting={s["setting"]} | partner asked: "{s["question"]}" | already tapped: (nothing yet)' for i, s in enumerate(b))
            return b, call_claude(TEMPLATE.format(items=txt), 420, "")
        with ThreadPoolExecutor(max_workers=a.workers) as ex:
            for b, answers in ex.map(run, batches):
                for ans in answers:
                    i = ans.get("i")
                    if isinstance(i, int) and 1 <= i <= len(b): b[i-1]["teacher"] = [[str(c), float(w)] for c, w in ans.get("cards", []) if isinstance(w, (int, float))]
    else:
        lookup = {}
        for f in ("targets.jsonl", "targets_abstract.jsonl"):
            p = os.path.join(ROOT, "data", "distill", f)
            if os.path.exists(p):
                for l in open(p):
                    d = json.loads(l)
                    if not d.get("prefix"): lookup.setdefault((d["setting"], d["question"].strip().lower()), d["teacher"])
        for it in items: it["teacher"] = lookup.get((it["setting"], it["question"].strip().lower()))
    core_ids = {to_card(w, surf) for w in CORE} - {None}
    Ks = [int(k) for k in a.k.split(",")]; tot = collections.Counter(); per = collections.defaultdict(collections.Counter); n_scored = 0; misses = []
    for it in items:
        t = it.get("teacher")
        if not t: tot["no_answer"] += 1; continue
        n_scored += 1
        ranked = []
        for lbl, w in sorted(t, key=lambda x: -x[1]):
            if lbl.strip().lower() in ("end", "<end>"): continue
            c = to_card(lbl, surf)
            if c and c not in ranked and c not in core_ids: ranked.append(c)
        exp = set(it["expect_ids"])
        for K in Ks:
            board = set(ranked[:K]) | core_ids
            hit = bool(exp & board); tot[f"pass@{K}"] += hit; per[it["setting"]][f"pass@{K}"] += hit
            if K == Ks[-1] and not hit and len(misses) < 12: misses.append((it["setting"], it["question"], [speak.get(c, c) for c in list(exp)[:3]], [speak.get(c, c) for c in ranked[:6]]))
        per[it["setting"]]["n"] += 1
    print(f"gate={a.gate} {'live teacher' if a.live else 'from teacher files'}: {n_scored} questions scored, {tot['no_answer']} without a teacher answer")
    for K in Ks: print(f"  teacher top-{K:<2} + core row : pass {tot[f'pass@{K}']}/{n_scored}")
    print("  by setting (pass@%d):" % Ks[-1], {s: f"{c[f'pass@{Ks[-1]}']}/{c['n']}" for s, c in sorted(per.items())})
    for s, q, e, b in misses[:8]: print(f"   miss [{s}] {q[:50]!r} expected {e} | teacher {b}")

if __name__ == "__main__":
    main()
