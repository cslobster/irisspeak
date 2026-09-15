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
import glob
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
    fd = json.load(open(os.path.join(ROOT, "..", "web-client", "public", "folders.json")))
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
    # These prompts ("apple or banana?") are not tied to a place. They used to be stamped with a random
    # setting, which is worse than no label: it taught the model that the setting token is noise, and at play
    # the model went on to rank coffee 10th and a ball 2396th. Unlabelled is the honest answer.
    out = []
    for i in range(n_questions):
        cat = rng.choice(cats); k = 3 if rng.random() < 0.25 else 2
        picks = rng.sample(by_cat[cat], k)
        names = [p["speak"].lower() for p in picks]
        tpl = rng.choice(CHOICE3_TEMPLATES if k == 3 else CHOICE_TEMPLATES)
        q = tpl.format(A=names[0], B=names[1], C=names[2] if k == 3 else "")
        q = q[0].upper() + q[1:]
        tg = {p["id"]: round(1.0 / k, 4) for p in picks}
        base = {"split": "train", "source": "synthetic", "setting": "unknown", "tier": "syn", "weight": 2.0, "partner": q, "history": []}
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
            out.append({"id": f"syn_folder_{f}_{i}", "split": "train", "source": "synthetic", "setting": "unknown",   # a folder trigger is not tied to a place; see synth_choice_states
                        "tier": "syn", "weight": 1.5, "partner": q, "history": [], "prefix": [], "targets": tg}); n += 1
    return out


def distilled_states(path, surf, lem, temperature=1.0, min_kept=3):
    """Training states whose targets are the teacher's distribution over next cards, not one sampled answer.

    data/distill/targets.jsonl holds, per (setting, question, prefix), the cards a large model thinks a child is
    most likely to tap next with a weight each. Mapping those onto card ids and renormalising gives exactly the
    soft target train_smollm.py already optimises against, so training on these rows is distillation.

    A state is kept only if at least `min_kept` of the teacher's cards map onto the board vocabulary, so a state
    the teacher answered mostly in words this board does not have never becomes a target."""
    if not os.path.exists(path):
        print(f"distill: {path} not found, skipping", flush=True); return []
    def to_card(w):
        w = w.strip().lower()
        for cand in (w, w.rstrip("s"), w + "s", w.replace("-", " ")):
            if cand in surf: return surf[cand]
        for lm in lem(w):
            if lm in surf: return surf[lm]
        return None
    out = []; kept = thin = 0; mapped = total = 0
    for i, line in enumerate(open(path)):
        line = line.strip()
        if not line: continue
        try: d = json.loads(line)
        except Exception: continue
        prefix = [c for c in (to_card(w) for w in d.get("prefix", [])) if c]
        if len(prefix) != len(d.get("prefix", [])): continue      # a prefix we cannot reproduce is not a real state
        tg = {}
        for lbl, w in d.get("teacher", []):
            total += 1
            cid = "<aac_end>" if lbl.strip().lower() in ("end", "<end>", "stop") else to_card(lbl)
            if not cid: continue
            mapped += 1
            tg[cid] = tg.get(cid, 0.0) + float(w) ** (1.0 / max(1e-6, temperature))
        tg.pop(None, None)
        for c in prefix: tg.pop(c, None)                          # a card already tapped is not the next card
        if len(tg) < min_kept: thin += 1; continue
        z = sum(tg.values())
        out.append({"id": f"distill_{i}", "split": "train", "source": "distill",
                    "setting": d.get("setting", "unknown"), "tier": "distill", "weight": 2.0,
                    "partner": d.get("question"), "history": [], "prefix": prefix,
                    "targets": {c: round(v / z, 5) for c, v in sorted(tg.items(), key=lambda kv: -kv[1])},
                    "origin": "distilled"})
        kept += 1
    print(f"distill: {kept} states kept, {thin} dropped as too thin; "
          f"{mapped}/{total} teacher cards mapped ({mapped/max(1,total):.0%})", flush=True)
    return out

def setting_turn_states(dataset_dir, surf, lem, rng, max_rows=0):
    """States from datasets/aac-setting-turns: generated parent/child turns labelled by where they happen.

    The real corpus is 88% home-or-unlabelled, so the model could not learn to use the setting at all. These
    rows exist to supply that signal; answer words that do not map onto a card are dropped, and a turn is kept
    only if at least half of it survived, so a half-understood answer does not become a training target."""
    files = sorted(glob.glob(os.path.join(dataset_dir, "data", "*.jsonl")))
    turns = []
    for fp in files:
        for line in open(fp):
            line = line.strip()
            if not line: continue
            try: turns.append(json.loads(line))
            except Exception: pass
    rng.shuffle(turns)
    if max_rows: turns = turns[:max_rows]
    def to_card(w):
        w = w.strip().lower()
        for cand in (w, w.rstrip("s"), w + "s", w.replace("-", " ")):
            if cand in surf: return surf[cand]
        for lm in lem(w):
            if lm in surf: return surf[lm]
        return None
    out = []; kept = dropped = 0
    for i, t in enumerate(turns):
        words = t.get("cards") or []
        seq = []
        for w in words:
            cid = to_card(w)
            if cid and cid not in seq: seq.append(cid)
        if not seq or len(seq) * 2 < len(words): dropped += 1; continue
        kept += 1
        # 0.7, not 1.5. At 1.5 these 39k rows took 45% of the loss mass -- as much as the whole 72k-row corpus --
        # and the held-out corpus check fell from 332/371 to 309/371. They are here to supply the setting signal
        # the corpus lacks, not to outvote it.
        base = {"split": "train", "source": "setting_turns", "setting": t.get("setting", "unknown"),
                "tier": "gen", "weight": 0.7, "partner": t.get("question"), "history": [], "origin": "generated"}
        for k, (prefix, targets) in enumerate(states_for([seq])):
            out.append(dict(base, id=f"genset_{i}_s{k}", prefix=prefix, targets=targets))
    print(f"setting turns: {kept} usable of {kept + dropped} -> {len(out)} states", flush=True)
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
    ap.add_argument("--setting-turns", default="", help="datasets/aac-setting-turns: generated setting-labelled turns")
    ap.add_argument("--setting-turns-max", type=int, default=0, help="cap the generated turns used (0 = all)")
    ap.add_argument("--distill", default="", help="data/distill/targets.jsonl: teacher next-card distributions")
    ap.add_argument("--distill-temperature", type=float, default=1.0, help=">1 softens the teacher, <1 sharpens it")
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
                   "partner": partner, "history": hist, "prefix": prefix, "targets": targets,
                   "origin": "corpus"}
            writers[split].write(json.dumps(rec, ensure_ascii=False) + "\n"); n_states[split] += 1
        stats[f"utts_{split}"] += 1
    # synthetic states (train only): choice questions and thin-folder trigger questions
    synth = []
    if a.synth_choice: synth += synth_choice_states(vocab_rows, ref_count, a.synth_choice, rng, i_want_id)
    if a.folders and a.synth_folder: synth += synth_folder_states(members, vocab_rows, ref_count, a.synth_folder, rng)
    for rec in synth: rec.setdefault("origin", "synthetic")
    if a.setting_turns:
        synth += setting_turn_states(a.setting_turns, surf, lem, rng, a.setting_turns_max)
    if a.distill:
        synth += distilled_states(a.distill, surf, lem, a.distill_temperature)
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
