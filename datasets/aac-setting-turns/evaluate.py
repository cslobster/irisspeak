#!/usr/bin/env python3
"""Quality report for the AAC setting-turns dataset.

Two halves. The structural checks are mechanical and run over every row: schema validity, how much of each
answer lands on a real board card, duplication, answer length, generic-filler rate, vocabulary spread and
per-setting coverage. The judged checks sample rows and ask a model three things a script cannot decide --
does the answer actually answer the question, does it belong in that setting, and is it something a child
would plausibly say.

  python3 evaluate.py                 # structural only
  python3 evaluate.py --judge 240     # structural + judge a sample
"""
import argparse, collections, glob, json, os, random, re, subprocess, statistics, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
SETTINGS = ["home", "school", "restaurant", "doctor", "play", "transport", "selfcare", "unknown"]
FILLER = {"good", "yes", "no", "thanks", "thank you", "okay", "ok", "nice", "i want", "please",
          "fine", "great", "i don't know", "more", "help", "stop"}

JUDGE = """You are auditing training data for a children's AAC picture board, where a child replies by tapping 1-4 picture cards.

Judge each item on three things:
- answers: does the card sequence actually answer that question? (true/false)
- fits_setting: would that answer make sense in that setting? (true/false)
- childlike: is it plausible as a child's own short reply, not an adult's phrasing? (true/false)
Also give concrete: 0 if the answer is only generic filler (good/yes/thanks/okay), 1 if it names something specific.

Items:
{items}

Return {{"verdicts":[{{"i":0,"answers":true,"fits_setting":true,"childlike":true,"concrete":1}}]}} with one verdict per item, in order. JSON only, no fence."""


def load(dataset):
    rows = []
    for p in sorted(glob.glob(os.path.join(dataset, "data", "*.jsonl"))):
        for ln, line in enumerate(open(p), 1):
            line = line.strip()
            if not line: continue
            try: rows.append(json.loads(line))
            except Exception: rows.append({"_bad": f"{os.path.basename(p)}:{ln}"})
    return rows


def structural(rows, cards_json):
    meta = json.load(open(cards_json)); cards = meta["cards"]; dead = set(meta.get("dead", []))
    byl = {c["speak"].lower(): (i, c) for i, c in enumerate(cards)}
    def lookup(w):
        for k in (w, w.rstrip("s"), w + "s", w.replace("-", " ")):
            if k in byl: return byl[k]
        return None

    rep = {"rows": len(rows)}
    bad = [r for r in rows if r.get("_bad")]
    ok = [r for r in rows if not r.get("_bad")]
    rep["malformed_lines"] = len(bad)

    schema_bad = [r for r in ok if not (isinstance(r.get("question"), str) and r["question"].strip()
                  and isinstance(r.get("cards"), list) and 1 <= len(r["cards"]) <= 4
                  and all(isinstance(c, str) and c.strip() for c in r["cards"])
                  and r.get("setting") in SETTINGS)]
    rep["schema_violations"] = len(schema_bad)
    rep["schema_examples"] = [json.dumps(r)[:90] for r in schema_bad[:3]]

    good = [r for r in ok if r not in schema_bad]
    rep["valid_rows"] = len(good)
    rep["by_setting"] = dict(collections.Counter(r["setting"] for r in good))
    rep["by_pass"] = dict(collections.Counter((r.get("_batch") or "?").split(":")[0] for r in good))

    seen = collections.Counter((r["setting"], r["question"].lower(), tuple(r["cards"])) for r in good)
    rep["exact_duplicate_rows"] = sum(v - 1 for v in seen.values() if v > 1)
    qs = collections.Counter((r["setting"], r["question"].lower()) for r in good)
    rep["distinct_questions"] = len(qs)
    rep["questions_per_row"] = round(len(qs) / max(1, len(good)), 3)
    rep["most_repeated_question"] = [f"{q} x{n}" for (s, q), n in qs.most_common(3)]

    lens = [len(r["cards"]) for r in good]
    rep["answer_length"] = {"mean": round(statistics.mean(lens), 2),
                            "dist": {k: v for k, v in sorted(collections.Counter(lens).items())}}

    hits = misses = 0; revived = set(); unmapped = collections.Counter(); cathits = collections.Counter()
    filler_only = 0
    for r in good:
        if all(c in FILLER for c in r["cards"]): filler_only += 1
        for w in r["cards"]:
            e = lookup(w)
            if e:
                hits += 1; cathits[e[1]["category"]] += 1
                if e[0] in dead: revived.add(e[1]["speak"])
            else:
                misses += 1; unmapped[w] += 1
    rep["answer_words"] = hits + misses
    rep["maps_to_a_card"] = round(hits / max(1, hits + misses), 4)
    rep["filler_only_answers"] = round(filler_only / max(1, len(good)), 4)
    rep["dead_cards_revived"] = len(revived)
    rep["dead_cards_revived_examples"] = sorted(revived)[:20]
    rep["distinct_answer_words"] = len(set(w for r in good for w in r["cards"]))
    rep["top_unmapped"] = [f"{w} x{n}" for w, n in unmapped.most_common(20)]

    live = [c for i, c in enumerate(cards) if not c.get("is_folder") and c["category"] != "folder"]
    allcat = collections.Counter(c["category"] for c in live)
    rep["category_coverage"] = {k: {"cards": allcat[k], "hits": cathits.get(k, 0)} for k in sorted(allcat)}
    rep["categories_never_used"] = sorted(k for k in allcat if cathits.get(k, 0) == 0)
    return rep, good


def judge_sample(rows, n, workers, timeout, model=""):
    rng = random.Random(3)
    per = max(1, n // len(SETTINGS))
    sample = []
    for s in SETTINGS:
        pool = [r for r in rows if r["setting"] == s]
        sample += rng.sample(pool, min(per, len(pool)))
    batches = [sample[i:i + 12] for i in range(0, len(sample), 12)]

    def run(batch):
        items = "\n".join(f'{i}. setting={r["setting"]} | Q: "{r["question"]}" | child taps: {" + ".join(r["cards"])}'
                          for i, r in enumerate(batch))
        cmd = ["claude", "-p", JUDGE.format(items=items), "--allowed-tools", ""]
        if model: cmd += ["--model", model]
        for attempt in range(3):
            try:
                out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                                     stdin=subprocess.DEVNULL).stdout
                m = re.search(r'\{.*\}', out, re.S)
                return batch, json.loads(m.group(0))["verdicts"]
            except Exception:
                if attempt == 2: return batch, []
                time.sleep(3)
        return batch, []

    agg = collections.Counter(); n_j = 0; fails = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for batch, verdicts in ex.map(run, batches):
            for v in verdicts:
                i = v.get("i")
                if not isinstance(i, int) or i >= len(batch): continue
                n_j += 1
                for k in ("answers", "fits_setting", "childlike"): agg[k] += bool(v.get(k))
                agg["concrete"] += int(v.get("concrete", 0))
                if not v.get("answers") or not v.get("fits_setting"):
                    r = batch[i]
                    fails.append(f'[{r["setting"]}] "{r["question"]}" -> {" + ".join(r["cards"])}')
    if not n_j: return {"judged": 0}
    return {"judged": n_j,
            "answers_the_question": round(agg["answers"] / n_j, 3),
            "fits_the_setting": round(agg["fits_setting"] / n_j, 3),
            "childlike": round(agg["childlike"] / n_j, 3),
            "concrete": round(agg["concrete"] / n_j, 3),
            "rejected_examples": fails[:12]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=HERE)
    ap.add_argument("--cards", default="/Users/haobo/work4/aac/site/public/model/cards.json")
    ap.add_argument("--judge", type=int, default=0, help="judge this many sampled rows (0 = skip)")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--model", default="")
    ap.add_argument("--out", default=os.path.join(HERE, "stats.json"))
    a = ap.parse_args()

    rows = load(a.dataset)
    rep, good = structural(rows, a.cards)
    if a.judge: rep["judged_quality"] = judge_sample(good, a.judge, a.workers, a.timeout, a.model)
    rep["generated_at"] = time.strftime("%Y-%m-%d")
    json.dump(rep, open(a.out, "w"), indent=2)

    print(f"rows {rep['rows']}  valid {rep['valid_rows']}  malformed {rep['malformed_lines']}  schema violations {rep['schema_violations']}")
    print(f"maps to a card {rep['maps_to_a_card']:.1%}   filler-only answers {rep['filler_only_answers']:.1%}   exact dupes {rep['exact_duplicate_rows']}")
    print(f"distinct questions {rep['distinct_questions']}   distinct answer words {rep['distinct_answer_words']}   dead cards revived {rep['dead_cards_revived']}")
    print(f"by setting: {rep['by_setting']}")
    print(f"by pass: {rep['by_pass']}")
    if rep["categories_never_used"]: print(f"categories still never used: {rep['categories_never_used']}")
    if "judged_quality" in rep:
        j = rep["judged_quality"]
        print(f"\njudged {j.get('judged')} rows: answers {j.get('answers_the_question'):.0%}  "
              f"fits setting {j.get('fits_the_setting'):.0%}  childlike {j.get('childlike'):.0%}  concrete {j.get('concrete'):.0%}")
        for f in j.get("rejected_examples", [])[:6]: print("   rejected:", f)
    print(f"\nwrote {a.out}")


if __name__ == "__main__":
    main()
