#!/usr/bin/env python3
"""Assemble site/public/paper/results.json and the benchmark chart inputs from the saved evaluation outputs.
Usage: python3 site/build_results.py --v1 eval/e2e_v1_on_new_states.txt --v2 eval/e2e_v2_final.txt
"""
import argparse, json, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def parse_e2e(path):
    r = {}
    if not path or not os.path.exists(path): return r
    cur = None
    for line in open(path):
        m = re.match(r"^(test|qa) \(n=(\d+)\):", line)
        if m: cur = m.group(1); continue
        m = re.search(r"(fine-tuned model alone|model \+ reranker)\s*: R@1 ([\d.]+)\s+R@8 ([\d.]+)\s+R@16 ([\d.]+)\s+NDCG@16 ([\d.]+)", line)
        if m and cur: r[(cur, "model" if "alone" in m.group(1) else "rerank")] = dict(r1=float(m.group(2)), r8=float(m.group(3)), r16=float(m.group(4)), ndcg=float(m.group(5)))
    return r

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--v1"); ap.add_argument("--v2"); ap.add_argument("--v2-status", default="training"); ap.add_argument("--v2-final", default=""); ap.add_argument("--parity", default="")
    a = ap.parse_args()
    b = json.load(open(os.path.join(ROOT, "eval", "baselines_results.json")))
    systems = [
        {"name": "S1 frequency (bigram + unigram counts)", "r1_general": b["S1"]["recall@1"], "r16_general": b["S1"]["recall@16"], "r1_qa": None, "r16_qa": None, "notes": "3,000 general states; earlier state build"},
        {"name": "S2 MiniLM similarity + S1", "r1_general": b["S2"]["8.0"]["recall@1"], "r16_general": b["S2"]["8.0"]["recall@16"], "r1_qa": None, "r16_qa": None, "notes": "zero-shot encoder, no training"},
    ]
    rows16 = [["S1 frequency", b["S1"]["recall@16"], None], ["S2 MiniLM + S1", b["S2"]["8.0"]["recall@16"], None],
              ["v1 Gemini-2.5-Flash prototype\n(grid hit, 6-utterance sample)", None, 0.33]]
    rows1 = [["S1 frequency", b["S1"]["recall@1"], None], ["S2 MiniLM + S1", b["S2"]["8.0"]["recall@1"], None]]
    systems.append({"name": "v1 Gemini-2.5-Flash prototype (cloud LLM per grid)", "r1_general": None, "r16_general": None, "r1_qa": None, "r16_qa": 0.33,
                    "notes": "acceptable card on the full grid at step 0, 6-utterance question-answer sample, its prompt run on gpt-5.6-luna"})
    head = {}
    for name, path, pick in (("IrisSpeak-135M", a.v2, True),):
        r = parse_e2e(path)
        if not r: continue
        for kind, lab in (("model", "model alone"), ("rerank", "model + reranker")):
            g, q = r.get(("test", kind), {}), r.get(("qa", kind), {})
            systems.append({"name": f"{name}, {lab}", "r1_general": g.get("r1"), "r16_general": g.get("r16"), "r1_qa": q.get("r1"), "r16_qa": q.get("r16"),
                            "notes": "1,500 general + 1,500 question-answer states", "pick": pick and kind == "rerank"})
            rows16.append([f"{name} {lab}", g.get("r16", 0), q.get("r16", 0)]); rows1.append([f"{name} {lab}", g.get("r1", 0), q.get("r1", 0)])
        if pick and ("qa", "rerank") in r: head["qa_r16_rerank"] = r[("qa", "rerank")]["r16"]
    out = {"systems": systems, "headline": head, "v2_status": a.v2_status, "v2_final": a.v2_final, "parity": a.parity}
    os.makedirs(os.path.join(ROOT, "site", "public", "paper"), exist_ok=True)
    json.dump(out, open(os.path.join(ROOT, "site", "public", "paper", "results.json"), "w"), indent=1)
    json.dump({"recall16": rows16, "recall1": rows1}, open(os.path.join(ROOT, "site", "bench.json"), "w"), indent=1)
    print("results.json and bench.json written;", len(systems), "systems")

if __name__ == "__main__":
    main()
