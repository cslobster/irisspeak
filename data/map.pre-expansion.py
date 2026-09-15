#!/usr/bin/env python3
"""Map English utterances to card-id sequences using vocab/vocab.csv.

For each utterance:
  * normalise, expand contractions, tokenise
  * longest-phrase-first match over card labels and aliases (lemmatised fallback per token)
  * composable phrase cards also yield an expanded variant -> multiple acceptable sequences
  * coverage = matched content tokens / content tokens; examples below --min-coverage go to unmapped.jsonl
    together with the missing tokens (the vocabulary backlog)

Usage:
  python3 data/map.py --in data/processed/turk_dialogues_turns.jsonl --text-field utterance \
      --out data/mapped/turk_dialogues_turns.jsonl
"""
import argparse, csv, json, os, re, collections, itertools
from nltk.corpus import wordnet as wn

STOP = {"a","an","the","to","of","and","or","but","so","um","uh","oh","well","just","really","very",
        "please","thanks","that","this","it","is","am","are","was","were","be","been","do","does","did",
        "have","has","had","will","would","could","should","can","may","might","shall","i","you","he",
        "she","we","they","me","him","her","us","them","my","your","his","its","our","their","in","on",
        "at","for","with","from","by","as","up","down","out","off","over","not","no","yes","there","here",
        "what","who","where","when","why","how","which","if","then","than","too","also"}
CONTR = {"i'm":"i am","i've":"i have","i'll":"i will","i'd":"i would","don't":"do not","can't":"can not",
         "won't":"will not","didn't":"did not","doesn't":"does not","isn't":"is not","aren't":"are not",
         "it's":"it is","that's":"that is","what's":"what is","let's":"let us","you're":"you are",
         "we're":"we are","they're":"they are","he's":"he is","she's":"she is","there's":"there is",
         "where's":"where is","wasn't":"was not","weren't":"were not","haven't":"have not","hasn't":"has not",
         "wouldn't":"would not","couldn't":"could not","shouldn't":"should not","gonna":"going to",
         "wanna":"want to","gotta":"got to","gimme":"give me","cannot":"can not",
         # apostrophe-less spellings common in AAC-style text
         "im":"i am","cant":"can not","dont":"do not","wont":"will not","didnt":"did not","doesnt":"does not",
         "isnt":"is not","whats":"what is","hows":"how is","thats":"that is","ive":"i have","ill":"i will",
         "youre":"you are","theyre":"they are","alot":"a lot","goto":"go to","ur":"your","u":"you",
         "pls":"please","plz":"please","thx":"thanks","ok":"ok","okay":"ok","meds":"medicine","wanna":"want to"}

def load_vocab(path):
    rows = list(csv.DictReader(open(path)))
    by_label = {}
    for r in rows:
        by_label[r["label"]] = r
    surface = {}                              # surface form -> card row (label wins over alias)
    for r in rows:
        for a in r["aliases"].split("|"):
            if a and a not in surface: surface[a] = r
    for r in rows: surface[r["label"]] = r
    maxlen = max(len(s.split()) for s in surface)
    return rows, by_label, surface, maxlen

NUMWORDS = {0:"zero",1:"one",2:"two",3:"three",4:"four",5:"five",6:"six",7:"seven",8:"eight",9:"nine",10:"ten",
            11:"eleven",12:"twelve",13:"thirteen",14:"fourteen",15:"fifteen",16:"sixteen",17:"seventeen",
            18:"eighteen",19:"nineteen",20:"twenty",30:"thirty",40:"forty",50:"fifty",60:"sixty",70:"seventy",
            80:"eighty",90:"ninety",100:"hundred",1000:"thousand"}
def num_to_words(tok):
    if not tok.isdigit(): return None
    n = int(tok)
    if n in NUMWORDS: return NUMWORDS[n]
    if n < 100: return f"{NUMWORDS[n//10*10]} {NUMWORDS[n%10]}"
    return None

def find_names(text):
    """Capitalised tokens that are not sentence-initial and not 'I' -> treated as person names."""
    names = set()
    for m in re.finditer(r"(?<![.!?]\s)(?<!^)\b([A-Z][a-z]{2,})\b", text):
        names.add(m.group(1).lower())
    return names

def normalise(text, known=frozenset()):
    # capitalised words that are themselves cards (Monday, April, Mum) are not names
    names = {w for w in find_names(text) if w not in known}
    t = text.lower().replace("’", "'").replace("‘", "'")
    t = re.sub(r"(\d+):(\d\d)", r"\1 \2", t)           # 10:30 -> 10 30
    t = re.sub(r"[^a-z0-9' ]+", " ", t)
    toks = []
    for w in t.split():
        if w in names: toks.append("<name>"); continue
        nw = num_to_words(w)
        toks += nw.split() if nw else [w]
    return toks

def lemma_candidates(w):
    """Possible base forms, most likely first. WordNet's morphy returns 'legs' for 'legs' (it is a lemma
    there), so naive suffix stripping is included as a fallback."""
    c = []
    for p in ("v", "n", "a"):
        m = wn.morphy(w, p)
        if m and m != w: c.append(m)
    for suf, rep in (("ies", "y"), ("es", ""), ("s", ""), ("ing", ""), ("ing", "e"), ("ed", ""), ("ed", "e"), ("er", ""), ("est", "")):
        if w.endswith(suf) and len(w) - len(suf) >= 3: c.append(w[: -len(suf)] + rep)
    return list(dict.fromkeys(c))

def match(toks, surface, maxlen, lem_cache):
    """Greedy longest-phrase-first. Returns list of (card_row or None, span_tokens)."""
    out = []; i = 0
    while i < len(toks):
        hit = None
        for L in range(min(maxlen, len(toks) - i), 0, -1):
            span = " ".join(toks[i:i+L])
            if span in surface: hit = (surface[span], L); break
            if L == 1:
                for lm in lem_cache.setdefault(toks[i], lemma_candidates(toks[i])):
                    if lm in surface: hit = (surface[lm], 1); break
                if hit: break
        if hit:
            out.append((hit[0], toks[i:i+hit[1]])); i += hit[1]
        elif toks[i] in CONTR and CONTR[toks[i]] != toks[i]:
            # unmatched contraction: expand it and match the parts (e.g. "didn't" -> did, not)
            out += match(CONTR[toks[i]].split(), surface, maxlen, lem_cache); i += 1
        elif toks[i] == "<name>":
            out.append(("<name>", ["<name>"])); i += 1
        else:
            out.append((None, [toks[i]])); i += 1
    return out

def expand_variants(seq, by_label, id2row):
    """seq = list of card rows. Produce all variants expanding composable cards (cap at 8 variants)."""
    options = []
    for r in seq:
        opts = [[r["id"]]]
        if r["composable"] == "1" and r["components"]:
            opts.append(r["components"].split("|"))
        options.append(opts)
    variants = []
    for combo in itertools.product(*options):
        variants.append([c for part in combo for c in part])
        if len(variants) >= 8: break
    return variants

def compress(seq_rows):
    """Telegraphic variant: drop determiner/function cards when a content card remains."""
    content = [r for r in seq_rows if r["category"] not in ("core",) or r["intent"] != "content"]
    return content if content and len(content) < len(seq_rows) else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vocab", default=os.path.join(os.path.dirname(__file__), "..", "vocab", "vocab.csv"))
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--text-field", default="text")
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-coverage", type=float, default=0.85)
    ap.add_argument("--max-cards", type=int, default=8)
    a = ap.parse_args()
    rows, by_label, surface, maxlen = load_vocab(a.vocab)
    id2row = {r["id"]: r for r in rows}
    known_surface = frozenset(s for s in surface if " " not in s)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    unm_path = os.path.splitext(a.out)[0] + "_unmapped.jsonl"
    lem_cache = {}; missing = collections.Counter(); stats = collections.Counter(); covs = []
    with open(a.out, "w") as fo, open(unm_path, "w") as fu:
        for line in open(a.inp):
            ex = json.loads(line); text = ex.get(a.text_field) or ""
            toks = normalise(text, known_surface)
            if not toks: stats["empty"] += 1; continue
            m = match(toks, surface, maxlen, lem_cache)
            content_total = sum(1 for r, span in m for w in span if w not in STOP)
            content_hit = sum(len([w for w in span if w not in STOP]) for r, span in m if r)
            cov = content_hit / content_total if content_total else 1.0
            covs.append(cov)
            seq = [r for r, _ in m if r and r != "<name>"]
            n_names = sum(1 for r, _ in m if r == "<name>")
            # drop bare function cards at the ends of long sequences (keeps "i want pizza", drops trailing "the")
            for r, span in m:
                if r is None: missing[" ".join(span)] += 1
            ex_out = dict(ex)
            ex_out["mapped"] = {"coverage": round(cov, 3), "n_tokens": len(toks), "n_cards": len(seq),
                                "cards": [r["id"] for r in seq], "labels": [r["label"] for r in seq],
                                "n_names": n_names,
                                "unmatched": [" ".join(span) for r, span in m if r is None]}
            if cov < a.min_coverage or len(seq) == 0 or len(seq) > a.max_cards:
                stats["rejected"] += 1; fu.write(json.dumps(ex_out, ensure_ascii=False) + "\n"); continue
            variants = expand_variants(seq, by_label, id2row)
            comp = compress(seq)
            if comp and comp != seq: variants += expand_variants(comp, by_label, id2row)[:2]
            ex_out["acceptable_sequences"] = [v for i, v in enumerate(variants) if v not in variants[:i]]
            stats["accepted"] += 1
            fo.write(json.dumps(ex_out, ensure_ascii=False) + "\n")
    n = stats["accepted"] + stats["rejected"]
    print(f"{a.inp}: {n} utterances, accepted {stats['accepted']} ({stats['accepted']/max(n,1):.1%}), "
          f"rejected {stats['rejected']}, empty {stats['empty']}, mean coverage {sum(covs)/max(len(covs),1):.3f}")
    print("top missing tokens:", ", ".join(f"{w}({c})" for w, c in missing.most_common(40)))
    json.dump({"input": a.inp, "accepted": stats["accepted"], "rejected": stats["rejected"],
               "mean_coverage": sum(covs)/max(len(covs),1), "top_missing": missing.most_common(300)},
              open(os.path.splitext(a.out)[0] + "_stats.json", "w"), indent=1)

if __name__ == "__main__":
    main()
