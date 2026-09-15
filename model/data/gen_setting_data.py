#!/usr/bin/env python3
"""Generate setting-conditioned parent/child turns so the card model can learn to use the setting.

Why this exists: the real corpus is 88% home-or-unknown (play 1.2%, school 1.1%, doctor 0.9%), and the two
synthetic generators in build_states.py assigned the setting with rng.choice(), uncorrelated with content. The
model therefore learned that "Setting: X." carries no information -- asked "What do you want to do?" at play it
ranked coffee 10th and a ball 2396th. No reranker can repair that: it only sees the model's top 100.

The association "a ball belongs to play" is in neither the corpus nor the MiniLM card vectors. Measured: PMI
over the setting-labelled rows gives football->transport and book->doctor (school has 95 target observations,
play 93, and ball/swing/lego/homework have zero); question-anchored and folder-anchored embedding both fail on
play, doctor and school subjects. So the knowledge is asked of a model that has it.

Output is a standalone dataset (datasets/aac-setting-turns/) that can be released on its own. Nothing here runs
in the app: it only becomes training data, and build_states.py maps the answer words onto real cards.

  python3 data/gen_setting_data.py --per-setting 400
"""
import argparse, json, os, random, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

MODEL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(MODEL_ROOT)
DATASET = os.path.join(REPO, "datasets", "aac-setting-turns")
PROMPT_VERSION = "v1"

TEMPLATE = """You are writing training data for a children's AAC (augmentative and alternative communication) picture board. A child answers by tapping 1-4 picture cards, so an answer is the short concrete words a child taps, never a full sentence.

The child is at: {setting}.
Real questions partners ask here: {seeds}

Write {n} different turns for this setting. Each turn is a question a parent, teacher, carer or clinician would really ask HERE, plus one answer the child taps as 1-4 separate picture-card words.

Rules:
- Vary the questions. Reuse the real ones above sometimes; invent other natural ones for this setting.
- Answers must be CONCRETE and specific to {setting}: the actual things, activities, people and feelings that come up there.
- Avoid generic filler as the whole answer: good, yes, no, thanks, I want, okay, nice.
- Use everyday child vocabulary, single words where possible (ball, swing, math, tummy, bus).
- Cover the breadth of the setting across the {n} turns, not the same two topics.

Return {{"turns":[{{"q":"...","cards":["...","..."]}}]}} and nothing else. No markdown fence, no commentary."""


def call_claude(setting, seeds, n, model, timeout):
    prompt = TEMPLATE.format(setting=setting, seeds="; ".join(seeds), n=n)
    cmd = ["claude", "-p", prompt, "--allowed-tools", ""]
    if model: cmd += ["--model", model]
    for attempt in range(3):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
            txt = r.stdout.strip()
            m = re.search(r'\{.*\}', txt, re.S)
            if not m: raise ValueError(f"no JSON in output: {txt[:160]}")
            turns = json.loads(m.group(0)).get("turns", [])
            out = []
            for t in turns:
                q = str(t.get("q", "")).strip()
                cards = [re.sub(r'\s+', ' ', str(c)).strip().lower() for c in t.get("cards", []) if str(c).strip()]
                cards = [c for c in cards if 0 < len(c) <= 24]
                if q and 1 <= len(cards) <= 4: out.append({"setting": setting, "question": q[:120], "cards": cards[:4]})
            return out
        except Exception as e:
            if attempt == 2:
                print(f"  [{setting}] giving up: {str(e)[:120]}", flush=True); return []
            time.sleep(3 * (attempt + 1))
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=DATASET)
    ap.add_argument("--questions", default=os.path.join(REPO, "web-client", "public", "questions.json"))
    ap.add_argument("--per-setting", type=int, default=400)
    ap.add_argument("--batch", type=int, default=20, help="turns per claude -p call")
    ap.add_argument("--model", default="", help="model for claude -p (blank = the CLI default)")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--timeout", type=int, default=300)
    a = ap.parse_args()

    data_dir = os.path.join(a.dataset, "data"); os.makedirs(data_dir, exist_ok=True)
    qb = json.load(open(a.questions))["settings"]
    settings = [s for s in qb if s != "unknown"]

    done, existing = set(), {s: [] for s in settings}
    for s in settings:
        p = os.path.join(data_dir, f"{s}.jsonl")
        if os.path.exists(p):
            for line in open(p):
                try:
                    d = json.loads(line); existing[s].append(d); done.add(d.get("_batch"))
                except Exception: pass
    if done: print(f"resuming: {sum(len(v) for v in existing.values())} turns already generated", flush=True)

    jobs = []
    for s in settings:
        seeds = [x["q"] for x in qb[s]]
        have = len(existing[s])
        for i in range((max(0, a.per_setting - have) + a.batch - 1) // a.batch):
            b = f"{s}:{PROMPT_VERSION}:{have//a.batch + i}"
            if b not in done: jobs.append((b, s, seeds))
    random.shuffle(jobs)
    print(f"{len(jobs)} calls x {a.batch} turns over {len(settings)} settings via claude -p", flush=True)

    handles = {s: open(os.path.join(data_dir, f"{s}.jsonl"), "a") for s in settings}
    n = 0
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for b, turns in ex.map(lambda j: (j[0], call_claude(j[1], j[2], a.batch, a.model, a.timeout)), jobs):
            s = b.split(":")[0]
            for t in turns:
                t["_batch"] = b; handles[s].write(json.dumps(t, ensure_ascii=False) + "\n"); n += 1
            handles[s].flush()
            print(f"  {b:<22} +{len(turns):<3} total {n}", flush=True)
    for h in handles.values(): h.close()
    print(f"generated {n} new turns into {data_dir}", flush=True)


if __name__ == "__main__":
    main()
