"""Training pairs for the on-device sentence realiser: (partner question, tapped cards in order) -> the sentence.

Sources: the mapped utterances (data/mapped/*.jsonl): every acceptable card sequence of an utterance is one example,
plus "telegraphic" copies where function-word (core) cards are dropped, so the model learns to put them back —
what a child's real tap sequence looks like. Output: data/realiser/{train,dev,test}.jsonl with
  {"partner": str|null, "cards": [labels...], "sentence": str, "source": str}
"""
import os, json, csv, random, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rng = random.Random(11)
rows = list(csv.DictReader(open(os.path.join(ROOT, "vocab", "vocab.csv"))))
speak = {r["id"]: r["speak"] for r in rows}; core = {r["id"] for r in rows if r["core"] == "1"}

def clean(s):
    s = re.sub(r"\s+", " ", (s or "")).strip().strip('"“”')
    if not s: return None
    if len(s.split()) > 14: return None
    if not re.search(r"[.!?]$", s): s += "."
    return s[0].upper() + s[1:]

FUNC = set(("i me my mine you your yours we us our he him his she her hers it its they them their this that these those there here "
    "a an the some any to of in on at for with from by about up down out off over into and or but so because if yes "
    "do does did can could will would should may might must "
    "is am are was were be been being have has had having want wants wanted need needs needed "
    "like likes liked get got go going went let let's please thank thanks very really too also more again now today tomorrow yesterday "
    "okay ok all just still only than then one it's i'm i've i'll i'd you're we're they're he's she's that's there's "
    "s t re ve ll d m").split())
def covered(sentence, labels):
    """Every content word of the sentence must be spelt by some card (stem match), so the model never learns to invent one."""
    lab = " ".join(l.lower() for l in labels)
    for w in re.findall(r"[a-z']+", sentence.lower()):
        if w in FUNC or len(w) <= 2: continue
        stem = w[:4] if len(w) >= 5 else w.rstrip("s")
        if stem not in lab: return False
    return True

def examples(partner, seqs, sentence, source, split):
    out = []; seen = set()
    for seq in seqs[:4]:
        labels = [speak[c] for c in seq if c in speak]
        if not labels or len(labels) > 12: continue
        if not covered(sentence, labels): continue
        key = tuple(labels)
        if key in seen: continue
        seen.add(key)
        out.append({"partner": partner, "cards": labels, "sentence": sentence, "source": source, "split": split})
        # telegraphic copy: drop each function-word card with p=0.6, keep at least one card
        if len(seq) > 1:
            kept = [c for c in seq if c not in core or rng.random() > 0.6]
            if kept and kept != seq:
                out.append({"partner": partner, "cards": [speak[c] for c in kept if c in speak], "sentence": sentence, "source": source + "+tele", "split": split})
    return out

data = []
for l in open(os.path.join(ROOT, "data", "mapped", "aactext_imagine.jsonl")):
    e = json.loads(l); s = clean(e.get("text"))
    if s: data += examples(None, e["acceptable_sequences"], s, "aactext", e.get("split") or "train")
for l in open(os.path.join(ROOT, "data", "mapped", "turk_dialogues_turns.jsonl")):
    e = json.loads(l); s = clean(e.get("utterance"))
    if s: data += examples(e.get("prev_utterance"), e["acceptable_sequences"], s, "turk", e.get("split") or "train")
for fn, default in (("aacconversations_en_train.jsonl", "train"), ("aacconversations_en_test.jsonl", "test")):
    for l in open(os.path.join(ROOT, "data", "mapped", fn)):
        e = json.loads(l); s = clean(e.get("target_text") or e.get("utterance_intended") or e.get("utterance"))
        if s: data += examples(e.get("partner_utterance"), e["acceptable_sequences"], s, "aacconv", e.get("split") or default)
# dev: a slice of train utterances (by sentence) so the three splits never share a sentence
sents = sorted({d["sentence"] for d in data if d["split"] == "train"}); rng.shuffle(sents); dev = set(sents[: max(300, len(sents) // 25)])
for d in data:
    if d["split"] == "train" and d["sentence"] in dev: d["split"] = "dev"
os.makedirs(os.path.join(ROOT, "data", "realiser"), exist_ok=True)
w = {s: open(os.path.join(ROOT, "data", "realiser", f"{s}.jsonl"), "w") for s in ("train", "dev", "test")}
n = {}
for d in data:
    sp = d.pop("split"); sp = sp if sp in w else "train"; w[sp].write(json.dumps(d) + "\n"); n[sp] = n.get(sp, 0) + 1
print("examples per split:", n, "| sources:", {s: sum(1 for d in data if d["source"].startswith(s)) for s in ("aactext", "turk", "aacconv")})
print("example:", json.dumps(data[3]))
