#!/usr/bin/env python3
"""Second pass over the AAC setting-turns dataset: fill the parts of the board vocabulary and the question
space that the first pass missed.

The first pass ("write turns for this setting") produces natural but uneven data: it reached school, food and
feelings heavily and never once reached the phrases, play, questions, numbers or quantity categories. This pass
is coverage-driven instead of setting-driven. It takes the cards that are still unused, hands a sample of them
to the model as the vocabulary to work from, and asks for turns that use them the way a child would -- so the
generated answers land on real cards instead of near-misses, and thin categories get filled.

It also sweeps question TYPES (who / where / when / how many / either-or / yes-no / repair), which the mined
question bank barely covers, so the model sees each shape of question in every setting.

  python3 data/gen_coverage_data.py --mode vocab --rounds 40
  python3 data/gen_coverage_data.py --mode qtype --rounds 20
"""
import argparse, collections, glob, json, os, random, re, subprocess, time
from concurrent.futures import ThreadPoolExecutor

MODEL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(MODEL_ROOT)
DATASET = os.path.join(REPO, "datasets", "aac-setting-turns")
SETTINGS = ["home", "school", "restaurant", "doctor", "play", "transport", "selfcare"]

VOCAB_TEMPLATE = """You are writing training data for a children's AAC (augmentative and alternative communication) picture board. A child answers by tapping 1-4 picture cards, so an answer is the short concrete words a child taps, never a sentence.

These picture cards exist on the board but the child has never had a reason to use them:
{words}

Write {n} turns, at {setting}, that would naturally lead a child to tap some of these cards. Each turn is a question a parent, teacher, carer or clinician would really ask there, plus the answer the child taps as 1-4 cards.

Rules:
- Build the answers out of the listed cards above wherever you can. You may add one common everyday word if the answer needs it.
- Ask the question that makes those cards the natural answer. Do not force unrelated cards into one turn.
- Keep each answer to 1-4 cards, concrete, in a child's voice.
- Use as many different cards from the list as you can across the {n} turns.

Return {{"turns":[{{"q":"...","cards":["...","..."]}}]}} and nothing else. No markdown fence, no commentary."""

QTYPE_TEMPLATE = """You are writing training data for a children's AAC (augmentative and alternative communication) picture board. A child answers by tapping 1-4 picture cards, never a sentence.

Setting: {setting}.
Question type to practise: {qtype}

Write {n} turns of this question type for this setting. Each is a question a parent, teacher, carer or clinician would really ask there, plus the answer the child taps as 1-4 picture cards.

Rules:
- Every question must genuinely be a {qtype} question.
- Answers must be CONCRETE and specific to {setting}, and must actually answer that kind of question.
- Use everyday child vocabulary, single words where possible.
- Vary the wording across the {n} turns.

Return {{"turns":[{{"q":"...","cards":["...","..."]}}]}} and nothing else. No markdown fence, no commentary."""

QTYPES = {
    "who (a person)": "the answer names a person: mum, dad, teacher, friend, nurse, me, nobody",
    "where (a place)": "the answer names a place or position: here, outside, home, park, upstairs",
    "when (a time)": "the answer is a time: now, later, soon, after lunch, tomorrow, not yet",
    "how many (a number or amount)": "the answer is a number or amount: two, lots, a little, all of them, none",
    "either-or (a choice named in the question)": "the question offers two or three options and the answer picks one of them",
    "yes or no": "the answer is agreement or refusal, sometimes with one word of reason",
    "repair (the partner did not understand)": "the child restates, points at a different card, or asks the partner to wait",
    "what happened (an event in the past)": "the answer describes something that already happened",
}


def call_claude(prompt, timeout, model=""):
    cmd = ["claude", "-p", prompt, "--allowed-tools", ""]
    if model: cmd += ["--model", model]
    for attempt in range(3):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
            m = re.search(r'\{.*\}', r.stdout.strip(), re.S)
            if not m: raise ValueError(f"no JSON: {r.stdout[:140]}")
            turns = json.loads(m.group(0)).get("turns", [])
            out = []
            for t in turns:
                q = str(t.get("q", "")).strip()
                cards = [re.sub(r'\s+', ' ', str(c)).strip().lower() for c in t.get("cards", []) if str(c).strip()]
                cards = [c for c in cards if 0 < len(c) <= 24]
                if q and 1 <= len(cards) <= 4: out.append({"question": q[:120], "cards": cards[:4]})
            return out
        except Exception as e:
            if attempt == 2: print(f"  giving up: {str(e)[:110]}", flush=True); return []
            time.sleep(3 * (attempt + 1))
    return []


def unused_cards(dataset, cards_json):
    meta = json.load(open(cards_json)); cards = meta["cards"]
    byl = {c["speak"].lower(): c for c in cards}
    used = set()
    for p in glob.glob(os.path.join(dataset, "data", "*.jsonl")):
        for line in open(p):
            try: r = json.loads(line)
            except Exception: continue
            for w in r.get("cards", []):
                for k in (w, w.rstrip("s"), w + "s"):
                    if k in byl: used.add(byl[k]["speak"]); break
    skip = {"folder", "core", "questions"}
    pool = collections.defaultdict(list)
    for c in cards:
        if c.get("is_folder") or c["category"] in skip: continue
        if c["speak"] in used: continue
        pool[c["category"]].append(c["speak"])
    return pool, len(used)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["vocab", "qtype"], required=True)
    ap.add_argument("--dataset", default=DATASET)
    ap.add_argument("--cards", default="/Users/haobo/work4/aac/site/public/model/cards.json")
    ap.add_argument("--rounds", type=int, default=40, help="vocab: batches of cards; qtype: batches per setting")
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--sample", type=int, default=22, help="vocab: cards offered per call")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--model", default="")
    a = ap.parse_args()

    data_dir = os.path.join(a.dataset, "data"); os.makedirs(data_dir, exist_ok=True)
    rng = random.Random(11)
    jobs = []
    if a.mode == "vocab":
        pool, n_used = unused_cards(a.dataset, a.cards)
        total_unused = sum(len(v) for v in pool.values())
        print(f"{n_used} cards already used; {total_unused} unused across {len(pool)} categories", flush=True)
        for cat, words in sorted(pool.items(), key=lambda kv: -len(kv[1])):
            print(f"  {cat:<12} {len(words):>4} unused")
        flat = [(cat, w) for cat, ws in pool.items() for w in ws]
        rng.shuffle(flat)
        for i in range(a.rounds):
            chunk = flat[i * a.sample:(i + 1) * a.sample]
            if not chunk: break
            setting = rng.choice(SETTINGS)
            jobs.append((f"vocab:{i}", setting, VOCAB_TEMPLATE.format(
                words=", ".join(w for _, w in chunk), n=a.batch, setting=setting)))
    else:
        for s in SETTINGS:
            for qt, hint in QTYPES.items():
                for i in range(max(1, a.rounds // len(QTYPES))):
                    jobs.append((f"qtype:{s}:{qt.split()[0]}:{i}", s, QTYPE_TEMPLATE.format(
                        setting=s, qtype=f"{qt} -- {hint}", n=a.batch)))
    rng.shuffle(jobs)
    print(f"{len(jobs)} calls x {a.batch} turns", flush=True)

    handles = {s: open(os.path.join(data_dir, f"{s}.jsonl"), "a") for s in SETTINGS}
    n = 0
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for (tag, setting), turns in ex.map(lambda j: ((j[0], j[1]), call_claude(j[2], a.timeout, a.model)), jobs):
            for t in turns:
                t["setting"] = setting; t["_batch"] = tag
                handles[setting].write(json.dumps(t, ensure_ascii=False) + "\n"); n += 1
            handles[setting].flush()
            print(f"  {tag:<26} +{len(turns):<3} total {n}", flush=True)
    for h in handles.values(): h.close()
    print(f"generated {n} turns", flush=True)


if __name__ == "__main__":
    main()
