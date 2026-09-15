#!/usr/bin/env python3
"""Normalise the raw generation output into the released dataset: dedupe, drop filler-only answers, and
record where every row came from.

Generation runs in independent batches that cannot see each other, so the same obvious turn ("What do you want
to eat?" -> pizza) is produced many times. Repetition is not free in training: it reweights the model toward
whatever the generator finds most obvious. This keeps one copy of each (setting, question, answer) and caps how
often any one question may appear, then writes data/<setting>.jsonl back in place.

  python3 build.py [--max-per-question 12]
"""
import argparse, collections, glob, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
FILLER = {"good", "yes", "no", "thanks", "thank you", "okay", "ok", "nice", "i want", "please", "fine", "great"}
PASS_NAME = {"vocab": "vocabulary-coverage pass", "qtype": "question-type pass", "q": "per-question pass"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=HERE)
    ap.add_argument("--max-per-question", type=int, default=12,
                    help="cap on rows sharing one (setting, question), so common questions do not dominate")
    a = ap.parse_args()

    raw = []
    for p in sorted(glob.glob(os.path.join(a.dataset, "data", "*.jsonl"))):
        for line in open(p):
            line = line.strip()
            if not line: continue
            try: raw.append(json.loads(line))
            except Exception: pass

    seen = set(); per_q = collections.Counter()
    kept = []; dropped = collections.Counter()
    for r in raw:
        if not (isinstance(r.get("question"), str) and isinstance(r.get("cards"), list) and 1 <= len(r["cards"]) <= 4):
            dropped["malformed"] += 1; continue
        cards = [c.strip().lower() for c in r["cards"] if isinstance(c, str) and c.strip()]
        if not cards: dropped["malformed"] += 1; continue
        if all(c in FILLER for c in cards): dropped["filler_only"] += 1; continue
        q = " ".join(r["question"].split())
        key = (r["setting"], q.lower(), tuple(cards))
        if key in seen: dropped["duplicate"] += 1; continue
        qk = (r["setting"], q.lower())
        if per_q[qk] >= a.max_per_question: dropped["question_capped"] += 1; continue
        seen.add(key); per_q[qk] += 1
        batch = r.get("_batch") or ""
        head = batch.split(":")[0]
        kept.append({"setting": r["setting"], "question": q, "cards": cards,
                     "source_pass": PASS_NAME.get(head, "setting pass"), "_batch": batch})

    by = collections.defaultdict(list)
    for r in kept: by[r["setting"]].append(r)
    for s, rows in by.items():
        with open(os.path.join(a.dataset, "data", f"{s}.jsonl"), "w") as fh:
            for r in rows: fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"raw {len(raw)} -> kept {len(kept)}")
    for k, v in dropped.most_common(): print(f"  dropped {k}: {v}")
    print("per setting:", {s: len(v) for s, v in sorted(by.items())})
    print("per pass:", dict(collections.Counter(r["source_pass"] for r in kept)))


if __name__ == "__main__":
    main()
