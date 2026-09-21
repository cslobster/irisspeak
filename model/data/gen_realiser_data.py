#!/usr/bin/env python3
"""Child-voice sentences for the card sequences children actually tap.

The realiser's job is to say what the child meant, in a child's voice, using only the words the child tapped.
The shipped model was trained on adult corpus dialogue and learned to continue a conversation instead -- it
answers a question with a question, narrates in the third person, and sometimes inverts the meaning
("Story | More" -> "No story, just more"). See docs/PLAN-REALISER.md.

`datasets/aac-setting-turns` already holds the input side of the problem: {setting, question, cards} triples
across every setting and question in the app, generated for the card model. This script fills in the output
side by asking `claude -p` for THREE wordings per triple -- a plain one, one that leads with the first-person
frame, and a blunt short one -- so the "Another" button has genuinely different framings to offer.

  python3 data/gen_realiser_data.py --out data/realiser_gen/sentences.jsonl --n 0

Resumable: an existing --out is read first and those triples are skipped.
"""
import argparse, glob, json, os, random, re, subprocess, time
from concurrent.futures import ThreadPoolExecutor

MODEL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(MODEL_ROOT)
DATASET = os.path.join(REPO, "datasets", "aac-setting-turns")

TEMPLATE = """You write the spoken sentence for a children's AAC (augmentative and alternative communication) app.

A child who cannot speak taps picture cards one at a time to answer the person in front of them. The app then
says one sentence out loud, in the child's voice. Your job is to write that sentence.

The child is a kid or a young adult with AAC needs. The sentence must sound like THEM saying it -- not like a
teacher, a narrator, or a polite adult.

Rules, all of them hard:
1. Use ONLY the meaning of the tapped cards. Never introduce a new thing, place, person or action the child did
   not tap. You may add function words freely: I, my, me, you, a, the, is, was, want, to, please, and, it.
2. Answer the partner's question. Never reply with a question of your own (unless the tapped cards are clearly
   asking one, e.g. a "?" or "can I" card).
3. First person. If the child is the one doing or feeling the thing, say "I ..." or "my ...".
   "arm | hurt" -> "My arm hurts." Not "Arm hurts." Not "The arm is hurting."
4. Keep the polarity. If a "no" / "not" / "don't" card was tapped, the sentence must be negative. If no such
   card was tapped, the sentence must NOT be negative. Never flip what the child said.
5. Short. One sentence, about eight words or fewer. Two very short sentences are allowed when the cards really
   are two thoughts ("Math | Fun" -> "I learned math. It was fun.").
6. Plain child language. No idiom, no hedging, no adult politeness beyond "please" and "thank you" if tapped.
   Contractions are good ("I'm tired", "it's fun").

For each situation give THREE wordings of the SAME meaning, in this order:
  a) the natural one -- what you would actually want the app to say;
  b) one that leads with the first-person frame ("I want ...", "I like ...", "My ... is ...");
  c) a blunter, shorter one -- what a child in a hurry would say.
They must not be identical. If the cards genuinely only support one wording, vary the length, not the meaning.

Situations:
{items}

Return {{"answers":[{{"i":1,"s":["I want to play ball outside.","I want to play ball.","Ball outside."]}}]}}
with one entry per situation, in order. JSON only, no fence, no commentary."""


def call_claude(prompt, timeout, model=""):
    cmd = ["claude", "-p", prompt, "--allowed-tools", ""]
    if model: cmd += ["--model", model]
    for attempt in range(3):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
            m = re.search(r"\{.*\}", r.stdout.strip(), re.S)
            if not m: raise ValueError(f"no JSON: {r.stdout[:140]}")
            return json.loads(m.group(0)).get("answers", [])
        except Exception as e:
            if attempt == 2: print(f"  giving up: {str(e)[:110]}", flush=True); return []
            time.sleep(3 * (attempt + 1))
    return []


def load_triples(dataset):
    """Every {setting, question, cards} the card-model dataset knows about, de-duplicated."""
    seen, out = set(), []
    for p in sorted(glob.glob(os.path.join(dataset, "data", "*.jsonl"))):
        for line in open(p):
            line = line.strip()
            if not line: continue
            try: t = json.loads(line)
            except Exception: continue
            cards = [c for c in (t.get("cards") or []) if c]
            if not cards or len(cards) > 8: continue
            key = (t["setting"], t["question"], tuple(cards))
            if key in seen: continue
            seen.add(key)
            out.append({"setting": t["setting"], "question": t["question"], "cards": cards})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=DATASET)
    ap.add_argument("--out", default=os.path.join(MODEL_ROOT, "data", "realiser_gen", "sentences.jsonl"))
    ap.add_argument("--n", type=int, default=0, help="triples to do this run (0 = all remaining)")
    ap.add_argument("--per-call", type=int, default=8)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--timeout", type=int, default=420)
    ap.add_argument("--model", default="")
    a = ap.parse_args()

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    done = set()
    if os.path.exists(a.out):
        for line in open(a.out):
            try:
                d = json.loads(line)
                done.add((d["setting"], d["question"], tuple(d["cards"])))
            except Exception: pass

    triples = [t for t in load_triples(a.dataset) if (t["setting"], t["question"], tuple(t["cards"])) not in done]
    random.Random(23).shuffle(triples)
    if a.n: triples = triples[: a.n]
    print(f"{len(done)} already done; {len(triples)} to generate", flush=True)
    if not triples: return

    batches = [triples[i:i + a.per_call] for i in range(0, len(triples), a.per_call)]
    fh = open(a.out, "a"); t0 = time.time(); n_ok = 0

    def run(batch):
        items = "\n".join(
            f'{i+1}. Place: {t["setting"]}. The person asked: "{t["question"]}". Cards tapped: {" | ".join(t["cards"])}'
            for i, t in enumerate(batch))
        return batch, call_claude(TEMPLATE.format(items=items), a.timeout, a.model)

    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for k, (batch, answers) in enumerate(ex.map(run, batches)):
            by_i = {int(x.get("i", 0)): x for x in answers if isinstance(x, dict)}
            for i, t in enumerate(batch):
                got = by_i.get(i + 1)
                sents = [s.strip() for s in (got or {}).get("s", []) if isinstance(s, str) and s.strip()]
                if not sents: continue
                fh.write(json.dumps({**t, "sentences": sents[:3], "origin": "generated"}) + "\n")
                n_ok += 1
            fh.flush()
            if (k + 1) % 10 == 0:
                rate = n_ok / max(1e-9, time.time() - t0)
                print(f"  batch {k+1}/{len(batches)}  {n_ok} triples  {rate*60:.0f}/min", flush=True)
    fh.close()
    print(f"DONE {n_ok} triples in {(time.time()-t0)/60:.1f} min -> {a.out}", flush=True)


if __name__ == "__main__":
    main()
