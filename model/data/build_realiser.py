"""Training pairs for the on-device sentence realiser: (setting, partner question, tapped cards) -> the sentence.

Two sources, and the balance between them is the whole point (docs/PLAN-REALISER.md):

* **generated** (`data/realiser_gen/sentences.jsonl`, from `gen_realiser_data.py`): child-voice sentences for the
  `{setting, question, cards}` triples of `datasets/aac-setting-turns` -- the tap sequences children actually make,
  across every setting and question in the app. Three wordings per triple, so "Another" has real alternatives.
  This is what teaches the voice.
* **corpus** (`data/mapped/*.jsonl`): every acceptable card sequence of a mapped utterance, plus "telegraphic"
  copies with function-word cards dropped. Adult register and mostly `setting: unknown`, so it is filtered hard
  (`--corpus-strict`, the default) and kept only for robustness on card combinations nobody generated.

Every target must also be *reachable*: the apps decode with a vocabulary mask of card words + function words +
punctuation, so a target containing any other content word is an impossible thing to ask the model to say.
`covered()` enforces exactly that, against the same function-word list the decoder uses.

Output: data/realiser/{train,dev,test}.jsonl with
  {"setting": str, "partner": str|null, "cards": [labels...], "sentence": str, "source": str}
"""
import os, sys, json, csv, random, re, argparse, collections
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rng = random.Random(11)

FUNC = set(("i me my mine you your yours we us our he him his she her hers it its they them their this that these those there here "
    "a an the some any to of in on at for with from by about up down out off over into and or but so because if yes "
    "do does did can could will would should may might must "
    "is am are was were be been being have has had having want wants wanted need needs needed "
    "like likes liked get got go going went let let's please thank thanks very really too also more again now today tomorrow yesterday "
    "okay ok all just still only than then one it's i'm i've i'll i'd you're we're they're he's she's that's there's "
    "s t re ve ll d m").split())
NEG = set("not no n't don't doesn't didn't can't couldn't won't wouldn't shouldn't isn't aren't wasn't weren't haven't hasn't never".split())

def clean(s, max_words=14):
    s = re.sub(r"\s+", " ", (s or "")).strip().strip('"“”')
    if not s: return None
    if len(s.split()) > max_words: return None
    if not re.search(r"[.!?]$", s): s += "."
    return s[0].upper() + s[1:]

def covered(sentence, labels):
    """Every content word of the sentence must be spelt by some card (stem match), so the target is reachable
    under the decoder's vocabulary mask and the model never learns to invent a content word."""
    lab = " ".join(l.lower() for l in labels)
    for w in re.findall(r"[a-z']+", sentence.lower()):
        if w in FUNC or w in NEG or len(w) <= 2: continue
        stem = w[:4] if len(w) >= 5 else w.rstrip("s")
        if stem not in lab: return False
    return True

def polarity_ok(sentence, labels):
    """A 'no'/'not'/'don't' card must give a negative sentence, and a negative sentence must have such a card.
    The shipped model inverts this ('Story | More' -> 'No story, just more'), which puts words in the child's
    mouth that contradict them -- the one error class that is worse than clumsy phrasing."""
    lab = {l.lower().strip() for l in labels}
    card_neg = any(l in NEG or l.startswith("don't") or l.startswith("no ") or re.search(r"n't$", l) for l in lab)
    sent_neg = any(w in NEG for w in re.findall(r"[a-z']+", sentence.lower()))
    return card_neg == sent_neg

def is_answer(sentence, labels):
    """The child is answering; a question back is the shipped model's signature failure. Allowed only when the
    child tapped something that asks one."""
    if not sentence.rstrip().endswith("?"): return True
    lab = " ".join(l.lower() for l in labels)
    return "?" in lab or re.search(r"\b(can i|may i|what|where|when|why|who|how)\b", lab) is not None

def first_person(sentence):
    return re.search(r"\b(i|i'm|i'll|i've|i'd|my|me|mine)\b", sentence.lower()) is not None

# ---------------------------------------------------------------- generated
def from_generated(path, keep_extra):
    """Three wordings per triple. The natural wording (a) is always kept so it stays the greedy-decode mode;
    (b) and (c) are subsampled so the alternatives exist for sampling without drowning it."""
    out = []
    if not os.path.exists(path):
        print(f"no generated data at {path}; run data/gen_realiser_data.py first"); return out
    for line in open(path):
        line = line.strip()
        if not line: continue
        try: d = json.loads(line)
        except Exception: continue
        cards = d.get("cards") or []
        if not cards: continue
        for k, s in enumerate(d.get("sentences") or []):
            if k and rng.random() > keep_extra: continue
            s = clean(s, max_words=12)
            if not s: continue
            if not covered(s, cards) or not polarity_ok(s, cards) or not is_answer(s, cards): continue
            out.append({"setting": d.get("setting") or "unknown", "partner": d.get("question"), "cards": cards,
                        "sentence": s, "source": "gen" if k == 0 else f"gen{k}"})
    return out

# ---------------------------------------------------------------- corpus
sys.path.insert(0, os.path.join(ROOT, "data"))
from build_states import setting_of   # noqa: E402

def examples(setting, partner, seqs, sentence, source, split, strict, speak, core):
    out = []; seen = set()
    for seq in seqs[:4]:
        labels = [speak[c] for c in seq if c in speak]
        if not labels or len(labels) > 12: continue
        if not covered(sentence, labels): continue
        if strict and not (polarity_ok(sentence, labels) and is_answer(sentence, labels)
                           and len(sentence.split()) <= 10 and sentence.count(".") + sentence.count("!") <= 1):
            continue
        key = tuple(labels)
        if key in seen: continue
        seen.add(key)
        out.append({"setting": setting, "partner": partner, "cards": labels, "sentence": sentence, "source": source, "split": split})
        # Telegraphic copy: drop function-word cards so the model learns to put them back. A negation card is
        # never droppable -- dropping it while keeping a negative sentence is exactly the polarity inversion this
        # data is meant to train out, and every such row in the previous build came from here.
        if len(seq) > 1:
            kept = [c for c in seq if c not in core or speak.get(c, "").lower().strip() in NEG or rng.random() > 0.6]
            tele = [speak[c] for c in kept if c in speak]
            if kept and kept != seq and tele and covered(sentence, tele) and polarity_ok(sentence, tele) and is_answer(sentence, tele):
                out.append({"setting": setting, "partner": partner, "cards": tele,
                            "sentence": sentence, "source": source + "+tele", "split": split})
    return out

def from_corpus(strict):
    rows = list(csv.DictReader(open(os.path.join(ROOT, "vocab", "vocab.csv"))))
    speak = {r["id"]: r["speak"] for r in rows}; core = {r["id"] for r in rows if r["core"] == "1"}
    data = []
    for l in open(os.path.join(ROOT, "data", "mapped", "aactext_imagine.jsonl")):
        e = json.loads(l); s = clean(e.get("text"))
        if s: data += examples("unknown", None, e["acceptable_sequences"], s, "aactext", e.get("split") or "train", strict, speak, core)
    for l in open(os.path.join(ROOT, "data", "mapped", "turk_dialogues_turns.jsonl")):
        e = json.loads(l); s = clean(e.get("utterance"))
        if s: data += examples("unknown", e.get("prev_utterance"), e["acceptable_sequences"], s, "turk", e.get("split") or "train", strict, speak, core)
    for fn, default in (("aacconversations_en_train.jsonl", "train"), ("aacconversations_en_test.jsonl", "test")):
        for l in open(os.path.join(ROOT, "data", "mapped", fn)):
            e = json.loads(l); s = clean(e.get("target_text") or e.get("utterance_intended") or e.get("utterance"))
            if s: data += examples(setting_of(e.get("scene")), e.get("partner_utterance"), e["acceptable_sequences"], s, "aacconv", e.get("split") or default, strict, speak, core)
    return data

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gen", default=os.path.join(ROOT, "data", "realiser_gen", "sentences.jsonl"))
    ap.add_argument("--keep-extra", type=float, default=0.5, help="probability of keeping wordings (b) and (c)")
    ap.add_argument("--corpus", default="strict", choices=["strict", "loose", "none"])
    ap.add_argument("--corpus-ratio", type=float, default=0.5,
                    help="corpus rows to keep, as a multiple of the generated rows. The corpus is 25x bigger and "
                         "carries the adult register that broke the shipped model, so it is capped and the most "
                         "child-like rows are the ones kept; it is there for card combinations nobody generated.")
    ap.add_argument("--holdout", type=float, default=0.05, help="fraction of generated triples held out for test")
    a = ap.parse_args()

    gen = from_generated(a.gen, a.keep_extra)
    # hold out whole triples (all their wordings), so a test prompt is never seen in training
    triples = sorted({(d["setting"], d["partner"], tuple(d["cards"])) for d in gen})
    rng.shuffle(triples)
    n_test = int(len(triples) * a.holdout); n_dev = int(len(triples) * a.holdout * 0.6)
    test_keys = set(triples[:n_test]); dev_keys = set(triples[n_test:n_test + n_dev])
    for d in gen:
        k = (d["setting"], d["partner"], tuple(d["cards"]))
        d["split"] = "test" if k in test_keys else "dev" if k in dev_keys else "train"

    data = list(gen)
    if a.corpus != "none":
        corp = from_corpus(a.corpus == "strict")
        if a.corpus_ratio and gen:
            keep = int(len(gen) * a.corpus_ratio)
            # child-likeness, not chance, decides which corpus rows survive: first person, short, one clause.
            # The quota is shared out per source, so capping does not silently drop a whole corpus.
            def voice(d):
                s_ = d["sentence"]; w = len(s_.split())
                return (first_person(s_), -abs(w - 6), -(s_.count(".") + s_.count("!") + s_.count("?")))
            by_src = collections.defaultdict(list)
            for d in corp: by_src[d["source"].split("+")[0]].append(d)
            picked = []
            for src, rows_ in by_src.items():
                quota = max(1, round(keep * len(rows_) / len(corp)))
                rows_.sort(key=voice, reverse=True)
                picked += rows_[:quota]
            corp = picked
        sents = sorted({d["sentence"] for d in corp if d["split"] == "train"}); rng.shuffle(sents)
        dev = set(sents[: max(50, len(sents) // 25)])
        for d in corp:
            if d["split"] == "train" and d["sentence"] in dev: d["split"] = "dev"
        data += corp

    os.makedirs(os.path.join(ROOT, "data", "realiser"), exist_ok=True)
    w = {s: open(os.path.join(ROOT, "data", "realiser", f"{s}.jsonl"), "w") for s in ("train", "dev", "test")}
    n = collections.Counter()
    for d in data:
        sp = d.pop("split"); sp = sp if sp in w else "train"
        w[sp].write(json.dumps(d) + "\n"); n[sp] += 1
    for f in w.values(): f.close()
    src = collections.Counter(d["source"].split("+")[0] for d in data)
    fp = sum(1 for d in data if d["source"].startswith("gen") and first_person(d["sentence"]))
    ng = sum(1 for d in data if d["source"].startswith("gen"))
    print("examples per split:", dict(n))
    print("sources:", dict(src))
    print(f"generated rows: {ng}, first-person {fp/max(1,ng):.0%}")
    if gen: print("example:", json.dumps(gen[0]))

if __name__ == "__main__":
    main()
