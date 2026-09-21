#!/usr/bin/env python3
"""Score a realiser on what actually matters, and put two of them in front of a blind judge.

"Exact match against one reference wording" is the metric that let the shipped model ship while answering
questions with questions. This script measures the failure classes instead (docs/PLAN-REALISER.md §6):

  answer        the output is an answer, not a question back at the partner
  polarity      a "no"/"not" card gives a negative sentence and nothing else does -- never invert the child
  covered       every tapped card's word appears (the child's words are all said)
  no-invented   no content word the cards do not spell (the authenticity guarantee)
  first-person  "I ..." / "my ..." where the child is the subject
  words         median sentence length

  python3 eval/realiser_judge.py --onnx export/out_realiser/onnx/model.onnx --n 200
  python3 eval/realiser_judge.py --onnx NEW.onnx --baseline OLD.onnx --baseline-no-setting --judge --n 120
"""
import os, sys, json, argparse, re, random, subprocess, time, statistics
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "eval")); sys.path.insert(0, os.path.join(ROOT, "data"))
import realiser_eval as RE

NEG = set("not no n't don't doesn't didn't can't couldn't won't wouldn't shouldn't isn't aren't wasn't weren't haven't hasn't never".split())

def card_negative(cards):
    lab = [c.lower().strip() for c in cards]
    return any(l in NEG or l.startswith("don't") or l.startswith("no ") or re.search(r"n't$", l) for l in lab)

def metrics(rows):
    """rows: [{cards, partner, setting, out}]"""
    m = {k: 0 for k in ("answer", "polarity", "covered", "no_invented", "first_person")}
    lens = []
    for r in rows:
        out, cards = r["out"], r["cards"]
        words = re.findall(r"[a-z']+", out.lower()); wset = set(words); lens.append(len(words))
        asks = "?" in " ".join(cards).lower() or re.search(r"\b(can i|may i|what|where|when|why|who|how)\b", " ".join(cards).lower())
        m["answer"] += int(not out.rstrip().endswith("?") or bool(asks))
        m["polarity"] += int(card_negative(cards) == any(w in NEG for w in words))
        allowed = set(RE.FUNC) | NEG | {f for c in cards for w in re.findall(r"[a-z']+", c.lower()) for f in RE.forms(w)}
        m["covered"] += int(all(any(f in wset for f in RE.forms(w)) for c in cards for w in re.findall(r"[a-z']+", c.lower())))
        m["no_invented"] += int(all(w in allowed or len(w) <= 2 for w in words))
        m["first_person"] += int(bool(re.search(r"\b(i|i'm|i'll|i've|i'd|my|me|mine)\b", out.lower())))
    n = max(1, len(rows))
    out = {k: round(v / n, 3) for k, v in m.items()}
    out["words"] = round(statistics.median(lens), 1) if lens else 0
    out["n"] = len(rows)
    return out

JUDGE = """You are judging an AAC (augmentative and alternative communication) app for children who cannot speak.

The child answers the person in front of them by tapping picture cards. The app then says ONE sentence out loud,
in the child's voice. Two versions of the app produced the sentences below.

Judge which sentence is the better thing for the app to say, on these criteria in order:
1. Does it answer the person, in the child's voice? (A question back at the partner is a serious failure.)
2. Does it mean what the tapped cards mean? (Inverting the child -- saying "no" when they did not tap no, or
   dropping a "no" they did tap -- is the worst failure there is.)
3. Does it sound like a kid or young adult saying it, not an adult narrator? First person where the child is the
   subject ("My arm hurts", not "Arm hurts" or "The arm is hurting").
4. Is it short and plain?

Cases:
{items}

Return {{"verdicts":[{{"i":1,"winner":"A"|"B"|"tie","why":"under 12 words"}}]}} with one entry per case, in
order. JSON only, no fence, no commentary."""

def call_claude(prompt, timeout=420):
    for attempt in range(3):
        try:
            r = subprocess.run(["claude", "-p", prompt, "--allowed-tools", ""], capture_output=True, text=True,
                               timeout=timeout, stdin=subprocess.DEVNULL)
            m = re.search(r"\{.*\}", r.stdout.strip(), re.S)
            if not m: raise ValueError(r.stdout[:140])
            return json.loads(m.group(0)).get("verdicts", [])
        except Exception as e:
            if attempt == 2: print("  judge gave up:", str(e)[:110], flush=True); return []
            time.sleep(3 * (attempt + 1))
    return []

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", required=True); ap.add_argument("--tok", default=None)
    ap.add_argument("--baseline", default=""); ap.add_argument("--baseline-tok", default="")
    ap.add_argument("--no-setting", action="store_true"); ap.add_argument("--baseline-no-setting", action="store_true")
    ap.add_argument("--n", type=int, default=200); ap.add_argument("--split", default="test")
    ap.add_argument("--data", default=os.path.join(ROOT, "data", "realiser"))
    ap.add_argument("--probe", default=""); ap.add_argument("--judge", action="store_true")
    ap.add_argument("--show", type=int, default=15); ap.add_argument("--out", default="")
    a = ap.parse_args()

    if a.probe:
        cases = json.load(open(a.probe))
    else:
        cases = [json.loads(l) for l in open(os.path.join(a.data, f"{a.split}.jsonl"))]
        seen, uniq = set(), []
        for c in cases:   # one case per prompt, not per wording
            k = (c.get("setting"), c.get("partner"), tuple(c["cards"]))
            if k in seen: continue
            seen.add(k); uniq.append(c)
        random.Random(5).shuffle(uniq); cases = uniq[: a.n]

    def run(onnx, tok, with_setting, label):
        realise = RE.load(onnx, tok or None, with_setting)
        rows, lat = [], []
        for c in cases:
            t0 = time.time()
            out = realise(c["cards"], c.get("partner"), c.get("setting"))
            lat.append(time.time() - t0)
            rows.append({**c, "out": out})
        m = metrics(rows); m["ms"] = round(statistics.median(lat) * 1000)
        print(f"{label:10s} {json.dumps(m)}", flush=True)
        return rows

    new = run(a.onnx, a.tok, not a.no_setting, "new")
    base = run(a.baseline, a.baseline_tok or a.tok, not a.baseline_no_setting, "baseline") if a.baseline else None

    for c in new[: a.show]:
        line = f"  [{str(c.get('setting'))[:9]:<9}] {str(c.get('partner') or '')[:34]:<34} {' | '.join(c['cards'])[:30]:<30} -> {c['out']}"
        if base: line += f"\n  {'':<9}  {'':<34} {'':<30}    was: {base[new.index(c)]['out']}"
        print(line)

    if a.judge and base:
        # blind: A/B order flipped on odd cases so a positional preference cannot masquerade as a win
        pairs = []
        for i, (n_, b_) in enumerate(zip(new, base)):
            flip = i % 2 == 1
            pairs.append({"i": i + 1, "flip": flip, "case": n_,
                          "A": (b_ if flip else n_)["out"], "B": (n_ if flip else b_)["out"]})
        wins = {"new": 0, "base": 0, "tie": 0}; whys = []
        B = 10
        for s in range(0, len(pairs), B):
            chunk = pairs[s:s + B]
            items = "\n".join(
                f'{p["i"]}. Place: {p["case"].get("setting")}. The person asked: "{p["case"].get("partner") or "(nobody has spoken)"}". '
                f'Cards tapped: {" | ".join(p["case"]["cards"])}\n   A: {p["A"]}\n   B: {p["B"]}' for p in chunk)
            for v in call_claude(JUDGE.format(items=items)):
                p = next((x for x in chunk if x["i"] == int(v.get("i", 0))), None)
                if not p: continue
                w = str(v.get("winner", "")).strip().upper()
                if w == "TIE": wins["tie"] += 1
                elif w in ("A", "B"):
                    new_won = (w == "B") if p["flip"] else (w == "A")
                    wins["new" if new_won else "base"] += 1
                    if len(whys) < 12: whys.append(("new" if new_won else "base", v.get("why", ""), p["case"]["cards"]))
        tot = max(1, sum(wins.values()))
        print(f"\nblind judge over {tot}: new {wins['new']} ({wins['new']/tot:.0%})  baseline {wins['base']} ({wins['base']/tot:.0%})  tie {wins['tie']}")
        for who, why, cards in whys: print(f"  {who:5s} {' | '.join(cards)[:28]:<28} {why[:70]}")

    if a.out:
        json.dump({"new": new, "baseline": base}, open(a.out, "w"), indent=1)

if __name__ == "__main__":
    main()
