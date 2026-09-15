#!/usr/bin/env python3
"""Distil a large model's next-card distribution into the 135M card model.

The card model is not a chatbot: at every step it produces a distribution over ~3,300 cards and the board shows
the top nine. So the thing worth transferring from the teacher is the *distribution*, not one sampled answer.
train_smollm.py already optimises

    loss = -(T * log_softmax(logits)).sum(1).mean()

against a soft target T, which is KL to a teacher up to a constant. Supplying T from the teacher therefore turns
the existing trainer into a distillation trainer with no change to it.

For each state -- a setting, the partner's question, and the cards tapped so far -- the teacher is asked for the
cards a child is most likely to tap next, each with a weight, plus how likely the message is to be finished.
Weights are mapped onto real card ids and renormalised; unmapped words are dropped and the rest rescaled.

  python3 data/distill_cards.py --states 4000 --out data/distill/targets.jsonl
"""
import argparse, collections, glob, json, os, random, re, subprocess, time
from concurrent.futures import ThreadPoolExecutor

MODEL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(MODEL_ROOT)
DATASET = os.path.join(REPO, "datasets", "aac-setting-turns")

TEMPLATE = """You are the teacher for a children's AAC (augmentative and alternative communication) picture board. The child replies by tapping picture cards one at a time; the board shows the nine most likely cards, so what matters is the whole set of plausible next cards and how likely each one is, not a single answer.

For each situation below, list the 12 picture cards the child is most likely to tap NEXT, best first, each with a weight from 1 to 100 for how likely that card is.

Rules:
- One picture card per entry: a single everyday word where possible (ball, tummy, math, bus, tired). Short two-word cards are allowed when that is how a board would label it (ice cream, hot chocolate).
- The cards must fit the setting and genuinely continue the reply to that question.
- Include a spread: the obvious answers AND other things a different child might say. Do not list twelve wordings of one idea.
- Use "END" as an entry, with a weight, when stopping is a likely thing to do next. For a reply that is already complete, END should be near the top.
- Weights are relative within one situation; they do not need to sum to anything.

Situations:
{items}

Return {{"answers":[{{"i":1,"cards":[["ball",90],["park",60],["END",20]]}}]}} with one entry per situation, in order. JSON only, no fence, no commentary."""


def call_claude(prompt, timeout, model=""):
    cmd = ["claude", "-p", prompt, "--allowed-tools", ""]
    if model: cmd += ["--model", model]
    for attempt in range(3):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
            m = re.search(r'\{.*\}', r.stdout.strip(), re.S)
            if not m: raise ValueError(f"no JSON: {r.stdout[:140]}")
            return json.loads(m.group(0)).get("answers", [])
        except Exception as e:
            if attempt == 2: print(f"  giving up: {str(e)[:110]}", flush=True); return []
            time.sleep(3 * (attempt + 1))
    return []


def load_states(dataset, n, rng):
    """Prediction states to distil: every (setting, question) the data knows about, at a few prefix depths.
    The prefixes come from generated answers, so they are states the child could really be in."""
    turns = []
    for p in glob.glob(os.path.join(dataset, "data", "*.jsonl")):
        for line in open(p):
            line = line.strip()
            if not line: continue
            try: turns.append(json.loads(line))
            except Exception: pass
    by_q = collections.defaultdict(list)
    for t in turns: by_q[(t["setting"], t["question"])].append(t.get("cards") or [])
    # The first board is what the family sees before they have tapped anything, so every question earns an
    # empty-prefix state first. Deeper states matter too, but only once the breadth is covered: a run cut short
    # should still have every question represented.
    first, deeper = [], []
    for (s, q), answers in by_q.items():
        first.append({"setting": s, "question": q, "prefix": []})
        rng.shuffle(answers)
        for a in answers[:2]:
            if len(a) >= 1: deeper.append({"setting": s, "question": q, "prefix": a[:1]})
            if len(a) >= 3: deeper.append({"setting": s, "question": q, "prefix": a[:2]})
    rng.shuffle(first); rng.shuffle(deeper)
    states = first + deeper
    return states[:n] if n else states


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=DATASET)
    ap.add_argument("--out", default=os.path.join(MODEL_ROOT, "data", "distill", "targets.jsonl"))
    ap.add_argument("--states", type=int, default=4000, help="prediction states to distil (0 = all)")
    ap.add_argument("--per-call", type=int, default=6, help="states per teacher call")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--timeout", type=int, default=420)
    ap.add_argument("--model", default="")
    a = ap.parse_args()

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    rng = random.Random(19)
    states = load_states(a.dataset, a.states, rng)

    done = set()
    if os.path.exists(a.out):
        for line in open(a.out):
            try:
                d = json.loads(line)
                done.add((d["setting"], d["question"], tuple(d["prefix"])))
            except Exception: pass
        states = [s for s in states if (s["setting"], s["question"], tuple(s["prefix"])) not in done]
        print(f"resuming: {len(done)} states already distilled", flush=True)

    calls = [states[i:i + a.per_call] for i in range(0, len(states), a.per_call)]
    print(f"{len(states)} states in {len(calls)} teacher calls", flush=True)

    def run(batch):
        items = "\n".join(
            f'{i+1}. setting={s["setting"]} | partner asked: "{s["question"]}" | '
            f'already tapped: {" + ".join(s["prefix"]) if s["prefix"] else "(nothing yet)"}'
            for i, s in enumerate(batch))
        return batch, call_claude(TEMPLATE.format(items=items), a.timeout, a.model)

    fh = open(a.out, "a"); n = 0
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for batch, answers in ex.map(run, calls):
            for ans in answers:
                i = ans.get("i")
                if not isinstance(i, int) or not (1 <= i <= len(batch)): continue
                st = batch[i - 1]
                pairs = []
                for item in ans.get("cards", []):
                    if not (isinstance(item, list) and len(item) == 2): continue
                    w = item[1]
                    if not isinstance(w, (int, float)) or w <= 0: continue
                    lbl = re.sub(r"\s+", " ", str(item[0])).strip().lower()
                    if 0 < len(lbl) <= 24: pairs.append([lbl, float(w)])
                if len(pairs) < 3: continue
                fh.write(json.dumps({**st, "teacher": pairs}, ensure_ascii=False) + "\n"); n += 1
            fh.flush()
            print(f"  +{len(answers):<2} total {n}", flush=True)
    fh.close()
    print(f"distilled {n} states into {a.out}", flush=True)


if __name__ == "__main__":
    main()
