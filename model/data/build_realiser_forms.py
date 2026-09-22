#!/usr/bin/env python3
"""Which inflected forms of a card word the realiser is allowed to say.

The decoder lets a tapped word appear in any form `inflect()` can produce, applied blindly to every word. For
"busy" that yields "busies", "busying", "busied" -- none of them something the child tapped, and with the
word-level trie in place they are reachable as whole words ("I have my math and my busies.").

Part of speech cannot decide this: vocab.csv tags `hurt` as an adjective (it is the card "Hurt"), so a POS gate
would forbid "hurts" and the app would say "My arm hurt."

So take it from the data instead. A form is allowed if the realiser's own training sentences actually use it for
that word. The model was fit to those sentences, so those are the forms it should be able to produce; anything
else is something it was never taught and the child never tapped. A word the training data does not cover keeps
its base form only, which can never invent.

    {"hurt": ["hurts", "hurting"], "friend": ["friends"], "busy": []}

  python3 data/build_realiser_forms.py --out ../site/public/model/realiser_forms.json
"""
import argparse, json, os, re, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IRR_PAST = {"go": "went", "eat": "ate", "drink": "drank", "see": "saw", "come": "came", "run": "ran", "sit": "sat",
            "sleep": "slept", "get": "got", "give": "gave", "have": "had", "make": "made", "take": "took",
            "is": "was", "are": "were", "am": "was", "can": "could", "will": "would", "want": "wanted",
            "like": "liked", "do": "did", "say": "said", "feel": "felt", "buy": "bought", "think": "thought"}

def candidates(w):
    """Every form the decoder could offer for `w` -- the set this script filters down.

    The spelling rules have to be right, not generous: a blanket "+d" turns `go` into `god`, which then passes
    the attested-in-training test for entirely the wrong reason."""
    lw = w.lower()
    out = {lw + "'s"}
    out.add(lw + ("es" if re.search(r"(s|x|z|ch|sh)$", lw) else "s"))
    if lw.endswith("e"):
        # "+d" on a two- or three-letter word lands on another word ("be" -> "bed", "see" -> "seed") much more
        # often than on a real past tense, and the irregulars below already cover those verbs.
        if len(lw) >= 4 and lw not in IRR_PAST: out.add(lw + "d")
        out.add(lw[:-1] + "ing")
    elif re.search(r"[^aeiou]y$", lw):
        out |= {lw[:-1] + "ies", lw[:-1] + "ied", lw + "ing"}
    else:
        if lw not in IRR_PAST: out.add(lw + "ed")
        out.add(lw + "ing")
    if lw in IRR_PAST: out.add(IRR_PAST[lw])
    return {f for f in out if f != lw}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join(ROOT, "data", "realiser"))
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    seen = collections.Counter()          # every word the training sentences say
    base = set()                          # every word a card can spell
    for split in ("train", "dev", "test"):
        p = os.path.join(a.data, f"{split}.jsonl")
        if not os.path.exists(p): continue
        for line in open(p):
            e = json.loads(line)
            seen.update(re.findall(r"[a-z']+", e["sentence"].lower()))
            for c in e["cards"]: base.update(re.findall(r"[a-z']+", c.lower()))

    forms = {}
    for w in sorted(base):
        if len(w) < 2: continue
        ok = sorted(f for f in candidates(w) if seen[f])
        if ok: forms[w] = ok
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    json.dump(forms, open(a.out, "w"), separators=(",", ":"), sort_keys=True)
    print(f"{len(base)} card words, {len(forms)} with attested inflections -> {a.out} "
          f"({os.path.getsize(a.out)/1024:.0f} KB)")

    for w in ("hurt", "busy", "play", "sing", "friend", "happy", "fun", "go", "eat"):
        print(f"   {w:8} {forms.get(w, [])}")

if __name__ == "__main__":
    main()
