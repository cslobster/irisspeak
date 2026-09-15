#!/usr/bin/env python3
"""Turn mapped utterances (data/mapped/*.jsonl) into next-card training states.

One state per prefix position of each accepted utterance:
  {"id", "split", "source", "setting", "partner", "history", "prefix": [card ids], "targets": {card id: weight}}
where targets is the soft set of acceptable next cards (or "<aac_end>") given the prefix, pooled over the
utterance's acceptable sequence variants.

Splits: aactext and turk use their published splits; AAC Conversations train file -> train with 5 percent of
conversations held out as dev, test file -> test. A per-card cap limits how often any card is the reference
target in train (default 2 percent), which stops "i", "you", "the" dominating.

Usage: python3 data/build_states.py --out data/states
"""
import argparse, json, os, random, collections, re, csv, sys
QRE = re.compile(r"^(what|who|where|when|why|how|which|do|does|did|are|is|can|could|would|will|should|have|has|want|need|shall|may)\b", re.I)
def is_question(t): return bool(t) and (t.strip().endswith("?") or bool(QRE.match(t.strip())))
# Words that mark the AAC Conversations generator's "diversity" theme. v3: a row is dropped when EITHER side
# carries them (v2 only dropped the reply side unless the partner raised the topic).
TOPIC_BIAS = {"diversity","diverse","multicultural","cultural","culture","cultures","community","communities","unity","tradition","traditions",
              "festival","festivals","backgrounds","gratitude","respect","deserves","inclusive","inclusion","heritage","perspectives","perspective",
              "harmony","embrace","embracing","enriches","enrich","vibrant","languages"}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "data"))

# ---------------------------------------------------------------------------------------------------------------
# Folders (v3). Sixteen Cboard folders with enough training signal become output rows of the model
# ("<folder:numbers>" ...). Sub-folders roll up into the parent for the model; the app still browses them.
MODEL_FOLDERS = {                       # model folder -> Cboard folder paths whose words it covers
    "numbers": ["numbers"], "time": ["time"], "food": ["food", "food > fruit", "food > vegetables", "food > soup"],
    "drinks": ["drinks"], "snacks": ["snacks"], "people": ["people", "people > characters"], "family": ["people > family"],
    "places": ["places"], "school": ["school", "school > class room"], "technology": ["technology"], "body": ["body", "body > face", "body > medical"],
    "animals": ["animals", "animals > wild animals", "animals > marine animals", "animals > birds", "animals > insects"],
    "weather": ["weather"], "clothing": ["clothing", "clothing > clothing accessories"], "colours": ["describe > colours"], "plants": ["plants"],
}
FOLDER_W = 0.4          # share of the member cards' target mass that the folder row also receives (prefix 0 and 1 only)
# thin folders get a synthetic boost: trigger questions that should surface the folder
FOLDER_QUESTIONS = {
    "colours": ["What colour?", "What colour is it?", "Which colour do you like?", "What is your favourite colour?"],
    "snacks": ["What snack do you want?", "Do you want a snack?", "What do you want for a snack?"],
    "weather": ["How is the weather?", "What's the weather like today?", "Is it sunny or rainy?"],
    "body": ["Where does it hurt?", "What hurts?", "Show me where it hurts."],
    "animals": ["What animal do you like?", "Which animal?", "What is your favourite animal?", "What animal did you see?"],
    "clothing": ["What do you want to wear?", "Which one do you want to wear?"],
    "numbers": ["How old are you?", "How many?", "How many do you want?", "What number?"],
    "time": ["What time is it?", "When?", "When do you want to go?"],
}

FOLDERS_V2 = os.path.join(ROOT, "vocab", "folders_v2.json")
FOLDER_PATHS = {}       # folder id -> browse path written to data/states/folders.json
FOLDER_LABELS = {}

def load_folders(vocab_rows):
    """Member card ids per model folder. v3.1: the v2 taxonomy (vocab/folders_v2.json, every card in one folder)
    when it exists; otherwise the 16 Cboard-derived folders of v3."""
    if os.path.exists(FOLDERS_V2):
        fv = json.load(open(FOLDERS_V2))["folders"]; ids_ok = {r["id"] for r in vocab_rows}; members = {}
        for f in fv:
            mem = sorted(c for c in f["members"] if c in ids_ok)
            if len(mem) < 5: continue
            members[f["id"]] = mem; FOLDER_PATHS[f["id"]] = f.get("path") or f["id"]; FOLDER_LABELS[f["id"]] = f["label"]
        return members
    fd = json.load(open(os.path.join(ROOT, "web-client", "public", "folders.json")))
    words_by_path = {f["path"]: [w.lower() for w in f["words"]] for f in fd["folders"]}
    cat2path = fd["category_to_folder"]
    by_label = {r["label"].lower(): r["id"] for r in vocab_rows}
    members = {}
    for mf, paths in MODEL_FOLDERS.items():
        ids = set()
        for p in paths:
            ids |= {by_label[w] for w in words_by_path.get(p, []) if w in by_label}
            for r in vocab_rows:
                if cat2path.get(r["category"]) == p: ids.add(r["id"])
        members[mf] = sorted(ids); FOLDER_PATHS[mf] = paths[0]; FOLDER_LABELS[mf] = mf.capitalize()
    return members

def add_folder_targets(prefix, targets, card2folder):
    if len(prefix) > 1: return targets
    share = collections.Counter()
    for c, w in targets.items():
        for f in card2folder.get(c, ()): share[f] += w
    if not share: return targets
    t = dict(targets)
    for f, s in share.items(): t[f"<folder:{f}>"] = round(FOLDER_W * s, 4)
    tot = sum(t.values())
    return {c: round(v / tot, 4) for c, v in t.items()}

# ---------------------------------------------------------------------------------------------------------------
# Choice questions ("A or B?"). Real states: every option named in the partner's question becomes an acceptable
# first card. Synthetic states: generated "A or B?" questions over same-category cards, so the model learns that
# the options in the question are the answers instead of replying "yes".
CHOICE_STOP = {"do","you","want","to","the","a","an","some","is","it","one","which","what","or","and","with","for","first","should","we","i",
               "your","my","did","too","here","as","last","would","like","have","can","could","that","this","there","now","then",
               "at","in","on","of","from","by","about","into","onto","up","down","out","off","eating","go","going"}
CORE_ROW = {"yes", "no", "i don't know", "how about you?", "i want"}
CHOICE_TEMPLATES = ["{A} or {B}?", "Do you want {A} or {B}?", "{A}, or {B}?", "Would you like {A} or {B}?", "Which one, {A} or {B}?",
                    "Do you want the {A} or the {B}?", "{A} or {B}, which do you want?"]
CHOICE3_TEMPLATES = ["{A}, {B}, or {C}?", "Do you want {A}, {B}, or {C}?"]
CHOICE_CATS = ["food", "drink", "animals", "activities", "play", "colours", "clothes", "transport", "places", "feelings", "things", "body", "actions", "school", "nature", "music"]

def build_surface(vocab_rows):
    surf = {}
    for r in vocab_rows:
        for k in [r["label"].lower(), r["speak"].lower()] + [x.lower() for x in r["aliases"].split("|") if x]:
            surf.setdefault(k, r["id"])
    return surf

def parse_choices(question, surf, lem):
    q = re.sub(r"\s+", " ", re.sub(r"[^a-z' ,]+", " ", (question or "").lower())).strip()
    if not re.search(r"\bor\b", q): return []
    left, _, right = q.partition(" or ")
    def look(words):
        for n in range(min(3, len(words)), 0, -1):
            for cand in (" ".join(words[-n:]), " ".join(words[:n])):
                cid = surf.get(cand)
                if cid is None and n == 1:
                    for lm in lem(cand):
                        if lm in surf: cid = surf[lm]; break
                if cid and cand not in CORE_ROW: return cid
        return None
    found = []
    def add(x):
        if x and x not in found: found.append(x)
    for item in [x.strip() for x in left.split(",") if x.strip()]:
        add(look([w for w in item.split() if w not in CHOICE_STOP]))
    rw = [w for w in re.sub(r"[,?].*$", "", right).split() if w not in CHOICE_STOP]
    for n in range(min(3, len(rw)), 0, -1):
        cand = " ".join(rw[:n]); cid = surf.get(cand)
        if cid is None and n == 1:
            for lm in lem(cand):
                if lm in surf: cid = surf[lm]; break
        if cid and cand not in CORE_ROW: add(cid); break
    return found[:4]

def add_choice_targets(prefix, targets, options):
    """Give the named options half of the target mass between them (they may already be there)."""
    if prefix or len(options) < 2: return targets
    t = dict(targets); each = 0.5 / len(options)
    for o in options: t[o] = round(t.get(o, 0.0) + each, 4)
    tot = sum(t.values())
    return {c: round(v / tot, 4) for c, v in t.items()}

def synth_choice_states(vocab_rows, ref_count, n_questions, rng, i_want_id):
    by_cat = collections.defaultdict(list)
    for r in vocab_rows:
        if r["category"] in CHOICE_CATS and ref_count.get(r["id"], 0) >= 2 and int(r["words"]) <= 2 and r["core"] != "1":
            by_cat[r["category"]].append(r)
    cats = [c for c in CHOICE_CATS if len(by_cat[c]) >= 4]
    settings = ["home", "school", "restaurant", "play", "unknown", "home", "home"]
    out = []
    for i in range(n_questions):
        cat = rng.choice(cats); k = 3 if rng.random() < 0.25 else 2
        picks = rng.sample(by_cat[cat], k)
        names = [p["speak"].lower() for p in picks]
        tpl = rng.choice(CHOICE3_TEMPLATES if k == 3 else CHOICE_TEMPLATES)
        q = tpl.format(A=names[0], B=names[1], C=names[2] if k == 3 else "")
        q = q[0].upper() + q[1:]
        tg = {p["id"]: round(1.0 / k, 4) for p in picks}
        base = {"split": "train", "source": "synthetic", "setting": rng.choice(settings), "tier": "syn", "weight": 2.0, "partner": q, "history": []}
        out.append(dict(base, id=f"syn_choice_{i}_s0", prefix=[], targets=tg))
        if i_want_id and cat in ("food", "drink", "things", "clothes", "play", "animals"):
            out.append(dict(base, id=f"syn_choice_{i}_s1", prefix=[i_want_id], targets=tg))
    return out

def synth_folder_states(members, vocab_rows, ref_count, per_folder, rng):
    out = []; n = 0
    for f, qs in FOLDER_QUESTIONS.items():
        mem = sorted(members.get(f, []), key=lambda c: -ref_count.get(c, 0))[:10]
        if not mem: continue
        for i in range(per_folder):
            q = rng.choice(qs); sub = rng.sample(mem, min(4, len(mem)))
            tg = {c: round(0.6 / len(sub), 4) for c in sub}; tg[f"<folder:{f}>"] = 0.4
            out.append({"id": f"syn_folder_{f}_{i}", "split": "train", "source": "synthetic", "setting": rng.choice(["home", "school", "doctor", "play", "unknown"]),
                        "tier": "syn", "weight": 1.5, "partner": q, "history": [], "prefix": [], "targets": tg}); n += 1
    return out
SETTING_KW = {
    "school": ["school", "class", "teacher", "lesson", "playground", "homework", "library", "college", "university"],
    "doctor": ["doctor", "hospital", "clinic", "nurse", "appointment", "medical", "therapy", "dentist", "pharmacy"],
    "restaurant": ["restaurant", "cafe", "coffee", "shop", "store", "market", "mall", "bakery", "supermarket", "order"],
    "home": ["home", "kitchen", "bedroom", "living room", "family", "dinner", "breakfast", "morning", "bedtime", "house"],
    "play": ["park", "playground", "game", "sports", "beach", "outdoor", "zoo", "birthday", "party", "picnic"],
    "transport": ["bus", "train", "car", "airport", "taxi", "travel", "station", "flight"],
    "selfcare": ["bath", "shower", "bed", "toilet", "dressing", "sleep", "night"],
}
def setting_of(scene):
    s = (scene or "").lower()
    for k, kws in SETTING_KW.items():
        if any(w in s for w in kws): return k
    return "unknown"

def states_for(seqs, max_variants=3):
    """Pool acceptable sequences into per-prefix soft targets. Reference (first) sequence gets extra weight."""
    seqs = seqs[:max_variants]
    out = {}  # prefix tuple -> Counter of next
    for vi, s in enumerate(seqs):
        w = 2.0 if vi == 0 else 1.0
        for k in range(len(s) + 1):
            nxt = s[k] if k < len(s) else "<aac_end>"
            out.setdefault(tuple(s[:k]), collections.Counter())[nxt] += w
    res = []
    for prefix, cnt in out.items():
        tot = sum(cnt.values())
        res.append((list(prefix), {c: round(v / tot, 4) for c, v in cnt.items()}))
    return res

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mapped", default=os.path.join(ROOT, "data", "mapped"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "states"))
    ap.add_argument("--cap", type=float, default=0.02, help="max share of train reference targets per card")
    ap.add_argument("--max-cards", type=int, default=6, help="drop utterances whose reference reply is longer")
    ap.add_argument("--seed", type=int, default=13)
    ap.add_argument("--folders", action="store_true", help="v3: add <folder:*> soft targets and write folders.json")
    ap.add_argument("--choice", action="store_true", help="v3: options named in 'A or B?' questions become acceptable first cards")
    ap.add_argument("--synth-choice", type=int, default=0, help="v3: number of synthetic 'A or B?' questions to add to train")
    ap.add_argument("--synth-folder", type=int, default=0, help="v3: synthetic trigger questions per thin folder")
    a = ap.parse_args()
    random.seed(a.seed); os.makedirs(a.out, exist_ok=True)
    rng = random.Random(a.seed + 1)
    vocab_rows = list(csv.DictReader(open(os.path.join(ROOT, "vocab", "vocab.csv"))))
    members = load_folders(vocab_rows) if a.folders else {}
    card2folder = collections.defaultdict(list)
    for f, ids in members.items():
        for c in ids: card2folder[c].append(f)
    surf = build_surface(vocab_rows)
    if a.choice or a.synth_choice:
        from map import lemma_candidates as lem
    else:
        lem = lambda w: []
    i_want_id = surf.get("i want")

    speaker = {}
    for fn in ("aacconversations_en_train.jsonl", "aacconversations_en_test.jsonl"):
        for l in open(os.path.join(ROOT, "data", "processed", fn)):
            r = json.loads(l); speaker[r["id"]] = (r["speaker"], r.get("target_text", ""))
    utts = []  # (split, source, setting, partner, history, seqs, uid)
    artefact_dropped = collections.Counter()
    # AACText: no partner
    for l in open(os.path.join(a.mapped, "aactext_imagine.jsonl")):
        e = json.loads(l)
        utts.append((e["split"], "aactext", "unknown", None, [], e["acceptable_sequences"], e["id"]))
    # Turk: prev turn is the partner; skip when the filter emptied it
    for l in open(os.path.join(a.mapped, "turk_dialogues_turns.jsonl")):
        e = json.loads(l)
        partner = e.get("prev_utterance") or None
        utts.append((e["split"] or "train", "turk", "unknown", partner, [], e["acceptable_sequences"], e["id"]))
    # AAC Conversations: hold out 5% of train conversations as dev
    conv_ids = sorted({json.loads(l)["conversation_id"] for l in open(os.path.join(a.mapped, "aacconversations_en_train.jsonl"))})
    random.shuffle(conv_ids); dev_conv = set(conv_ids[: max(1, len(conv_ids) // 20)])
    for fname, default_split in (("aacconversations_en_train.jsonl", "train"), ("aacconversations_en_test.jsonl", "test")):
        for l in open(os.path.join(a.mapped, fname)):
            e = json.loads(l)
            split = "dev" if (default_split == "train" and e["conversation_id"] in dev_conv) else default_split
            ctx = e.get("context_utterances") or []
            hist = [c for c in ctx[:-1]][-2:] if isinstance(ctx, list) else []
            sp, tt = speaker.get(e["id"], ("", ""))
            words = set(re.findall(r"[a-z]+", (tt or "").lower())) | set(re.findall(r"[a-z]+", (e.get("partner_utterance") or "").lower()))
            if words & TOPIC_BIAS:
                artefact_dropped[split] += 1; continue   # generator's diversity-theme row on either side: not a child's conversation
            utts.append((split, "aacconv", setting_of(e.get("scene")), e.get("partner_utterance"), hist, e["acceptable_sequences"], e["id"]))

    # dedupe exact (partner, reference sequence)
    seen = set(); kept = []
    for u in utts:
        key = (u[3], tuple(u[5][0]))
        if key in seen: continue
        seen.add(key); kept.append(u)

    # per-card cap on train reference targets
    ref_count = collections.Counter(c for u in kept if u[0] == "train" for c in u[5][0])
    total = sum(ref_count.values()); cap_n = int(a.cap * total)
    keep_prob = {c: (cap_n / n if n > cap_n else 1.0) for c, n in ref_count.items()}

    writers = {s: open(os.path.join(a.out, f"{s}.jsonl"), "w") for s in ("train", "dev", "test")}
    stats = collections.Counter(); n_states = collections.Counter()
    def tier_of(source, partner, uid):
        if source == "aacconv":
            aac = speaker.get(uid, ("", ""))[0] in ("AAC User", "User")
            return "t1a" if (is_question(partner) and aac) else "t2a"
        if source == "turk": return "t1b" if is_question(partner) else "t2b"
        return "t3"
    TIER_W = {"t1a": 3.0, "t1b": 2.0, "t2a": 1.0, "t2b": 0.8, "t3": 0.6}
    TIER_W["syn"] = 2.0
    choice_hits = collections.Counter()
    for split, source, setting, partner, hist, seqs, uid in kept:
        if len(seqs[0]) > a.max_cards: stats["too_long"] += 1; continue
        tier = tier_of(source, partner, uid)
        if split == "train":
            # drop the utterance with probability driven by its most over-represented reference card
            p = min(keep_prob.get(c, 1.0) for c in seqs[0]) if seqs[0] else 1.0
            if random.random() > p: stats["capped"] += 1; continue
        options = parse_choices(partner, surf, lem) if (a.choice and partner) else []
        if len(options) >= 2: choice_hits[split] += 1
        for k, (prefix, targets) in enumerate(states_for(seqs)):
            end_only = set(targets) == {"<aac_end>"}
            if a.choice and split == "train": targets = add_choice_targets(prefix, targets, options)
            if a.folders: targets = add_folder_targets(prefix, targets, card2folder)
            rec = {"id": f"{uid}_s{k}", "split": split, "source": source, "setting": setting, "tier": tier,
                   "weight": round(TIER_W[tier] * (0.5 if end_only else 1.0), 3),
                   "partner": partner, "history": hist, "prefix": prefix, "targets": targets}
            writers[split].write(json.dumps(rec, ensure_ascii=False) + "\n"); n_states[split] += 1
        stats[f"utts_{split}"] += 1
    # synthetic states (train only): choice questions and thin-folder trigger questions
    synth = []
    if a.synth_choice: synth += synth_choice_states(vocab_rows, ref_count, a.synth_choice, rng, i_want_id)
    if a.folders and a.synth_folder: synth += synth_folder_states(members, vocab_rows, ref_count, a.synth_folder, rng)
    for rec in synth:
        if a.folders: rec["targets"] = add_folder_targets(rec["prefix"], rec["targets"], card2folder)
        writers["train"].write(json.dumps(rec, ensure_ascii=False) + "\n"); n_states["train"] += 1; n_states["synthetic"] += 1
    for w in writers.values(): w.close()
    if a.folders:
        json.dump({"folders": [{"id": f"<folder:{f}>", "path": FOLDER_PATHS.get(f, f), "label": FOLDER_LABELS.get(f, f.capitalize()), "members": ids} for f, ids in members.items()],
                   "folder_weight": FOLDER_W}, open(os.path.join(a.out, "folders.json"), "w"), indent=1)
    print("utterances:", dict(stats)); print("states:", dict(n_states))
    print("artefact rows dropped:", dict(artefact_dropped), "| choice questions with 2+ parsed options:", dict(choice_hits))
    if a.folders: print("folders:", {f: len(ids) for f, ids in members.items()})
    print("train reference-target cap: any card <=", cap_n, "of", total)

if __name__ == "__main__":
    main()
