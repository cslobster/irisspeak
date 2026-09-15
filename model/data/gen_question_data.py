#!/usr/bin/env python3
"""Third pass: guarantee that every question the app can actually ask has training material behind it.

The app offers 8 settings (web-client/src/engine/settings.ts, including "Somewhere else" = unknown) and six
corpus-mined questions per setting (web-client/public/questions.json). Those 48 question slots are what a
partner taps in the real product, so each one should be represented in training rather than left to whatever
the free-form passes happened to produce.

For each (setting, question) this asks for answers to THAT question, plus close paraphrases of it, so the model
learns the question rather than memorising one string.

  python3 data/gen_question_data.py --per-question 24
"""
import argparse, json, os, random, re, subprocess, time
from concurrent.futures import ThreadPoolExecutor

MODEL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(MODEL_ROOT)
DATASET = os.path.join(REPO, "datasets", "aac-setting-turns")

TEMPLATE = """You are writing training data for a children's AAC (augmentative and alternative communication) picture board. A child answers by tapping 1-4 picture cards, so an answer is the short concrete words a child taps, never a sentence.

Setting: {setting_label}.
The partner asks: "{question}"

Write {n} different answers a child might give to this exact question in this setting, each with the question that prompted it.

Rules:
- For about half the turns use the question exactly as written above. For the rest use a close paraphrase a real partner would say instead.
- The answers must genuinely answer THIS question, and be specific to {setting_label}.
- Make the {n} answers genuinely different from each other: different things, activities, people, feelings, reasons. Do not give {n} variations of one idea.
- Avoid answers that are only filler: good, yes, no, thanks, okay, I want, nice.
- Everyday child vocabulary, single words where possible. 1-4 cards each.

Return {{"turns":[{{"q":"...","cards":["...","..."]}}]}} and nothing else. No markdown fence, no commentary."""


def call_claude(prompt, timeout, model=""):
    cmd = ["claude", "-p", prompt, "--allowed-tools", ""]
    if model: cmd += ["--model", model]
    for attempt in range(3):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
            m = re.search(r'\{.*\}', r.stdout.strip(), re.S)
            if not m: raise ValueError(f"no JSON: {r.stdout[:140]}")
            out = []
            for t in json.loads(m.group(0)).get("turns", []):
                q = str(t.get("q", "")).strip()
                cards = [re.sub(r'\s+', ' ', str(c)).strip().lower() for c in t.get("cards", []) if str(c).strip()]
                cards = [c for c in cards if 0 < len(c) <= 24]
                if q and 1 <= len(cards) <= 4: out.append({"question": q[:120], "cards": cards[:4]})
            return out
        except Exception as e:
            if attempt == 2: print(f"  giving up: {str(e)[:110]}", flush=True); return []
            time.sleep(3 * (attempt + 1))
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=DATASET)
    ap.add_argument("--questions", default=os.path.join(REPO, "web-client", "public", "questions.json"))
    ap.add_argument("--settings-ts", default=os.path.join(REPO, "web-client", "src", "engine", "settings.ts"))
    ap.add_argument("--per-question", type=int, default=24)
    ap.add_argument("--batch", type=int, default=12)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--model", default="")
    a = ap.parse_args()

    # the settings the product actually offers, with the label the family sees
    src = open(a.settings_ts).read()
    labels = {m.group(1): m.group(2) for m in re.finditer(r"value:\s*'([^']+)',\s*label:\s*'([^']+)'", src)}
    qb = json.load(open(a.questions))["settings"]
    data_dir = os.path.join(a.dataset, "data"); os.makedirs(data_dir, exist_ok=True)

    done = set()
    for s in qb:
        p = os.path.join(data_dir, f"{s}.jsonl")
        if os.path.exists(p):
            for line in open(p):
                try: done.add(json.loads(line).get("_batch"))
                except Exception: pass

    jobs = []
    for s, qs in qb.items():
        label = labels.get(s, s)
        for qi, item in enumerate(qs):
            for i in range((a.per_question + a.batch - 1) // a.batch):
                tag = f"q:{s}:{qi}:{i}"
                if tag in done: continue
                jobs.append((tag, s, TEMPLATE.format(setting_label=label, question=item["q"], n=a.batch)))
    random.Random(7).shuffle(jobs)
    n_slots = sum(len(v) for v in qb.values())
    print(f"{len(qb)} settings x questions = {n_slots} question slots; {len(jobs)} calls x {a.batch} turns", flush=True)

    handles = {s: open(os.path.join(data_dir, f"{s}.jsonl"), "a") for s in qb}
    n = 0
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for (tag, s), turns in ex.map(lambda j: ((j[0], j[1]), call_claude(j[2], a.timeout, a.model)), jobs):
            for t in turns:
                t["setting"] = s; t["_batch"] = tag
                handles[s].write(json.dumps(t, ensure_ascii=False) + "\n"); n += 1
            handles[s].flush()
            print(f"  {tag:<20} +{len(turns):<3} total {n}", flush=True)
    for h in handles.values(): h.close()
    print(f"generated {n} turns", flush=True)


if __name__ == "__main__":
    main()
