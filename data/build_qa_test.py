#!/usr/bin/env python3
"""Question-answer subset of the test states: partner turn is a question, the replier is the AAC user,
and the reply is short. Writes data/states/test_qa.jsonl (states) and prints a summary.

Rules
  * partner turn ends with '?' or starts with a question word / auxiliary
  * AAC Conversations: speaker must be the AAC user ("AAC User" / "User"), not a named partner
  * Turk: kept when the previous turn is a question (either speaker; the corpus has no AAC role)
  * reference reply <= --max-cards cards (default 5)
"""
import argparse, json, os, re, collections
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QSTART = re.compile(r"^(what|who|where|when|why|how|which|do|does|did|are|is|can|could|would|will|should|have|has|want|need|shall|may)\b", re.I)

def is_question(t):
    t = (t or "").strip()
    return t.endswith("?") or bool(QSTART.match(t))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--max-cards", type=int, default=5); a = ap.parse_args()
    speaker = {}
    for l in open(os.path.join(ROOT, "data", "processed", "aacconversations_en_test.jsonl")):
        r = json.loads(l); speaker[r["id"]] = r["speaker"]
    test = [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", "test.jsonl"))]
    by_utt = collections.defaultdict(list)
    for e in test: by_utt[e["id"].rsplit("_s", 1)[0]].append(e)
    kept, dropped = [], collections.Counter()
    for uid, states in by_utt.items():
        e0 = states[0]
        if not is_question(e0["partner"]): dropped["not_question"] += 1; continue
        if e0["source"] == "aacconv" and speaker.get(uid, "") not in ("AAC User", "User"): dropped["named_speaker"] += 1; continue
        if e0["source"] == "aactext": dropped["no_partner"] += 1; continue
        n_cards = max(len(s["prefix"]) for s in states)
        if n_cards > a.max_cards: dropped["too_long"] += 1; continue
        kept += sorted(states, key=lambda s: len(s["prefix"]))
    out = os.path.join(ROOT, "data", "states", "test_qa.jsonl")
    with open(out, "w") as f:
        for e in kept: f.write(json.dumps(e, ensure_ascii=False) + "\n")
    n_utt = len({e["id"].rsplit("_s", 1)[0] for e in kept})
    print(f"kept {n_utt} utterances / {len(kept)} states; by source:", dict(collections.Counter(e['source'] for e in kept if not e['prefix'])))
    print("dropped:", dict(dropped)); print("written", out)

if __name__ == "__main__":
    main()
