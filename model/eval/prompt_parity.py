#!/usr/bin/env python3
"""Assert the four places that build the realiser prompt agree on its shape.

train/train_realiser.py, eval/realiser_eval.py, web-client/src/engine/realiser.ts and
ios/.../Engine/Realiser.swift each construct the prompt separately, in three languages. They drifted once
already: the trainer emitted a `Setting:` line and both apps did not, so the shipped model spent its whole life
being decoded on a prompt it had never seen (docs/PLAN-REALISER.md §2) -- two in five outputs came back as a
question at the child, and nothing in the build caught it.

The check is deliberately shallow and hard to fool: in each file, the string literals that make up the prompt
must mention Setting:, Partner:, Cards: and Sentence:, in that order, and each label must be followed by an
interpolated value (except Sentence:, which ends the prompt).

  python3 eval/prompt_parity.py
"""
import os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(ROOT)
LABELS = ["Setting:", "Partner:", "Cards:", "Sentence:"]

SOURCES = {
    "train/train_realiser.py": (os.path.join(ROOT, "train", "train_realiser.py"), "def prompt(", "\ndef "),
    "eval/realiser_eval.py": (os.path.join(ROOT, "eval", "realiser_eval.py"), "def load(", "\ndef main("),
    "web-client/src/engine/realiser.ts": (os.path.join(REPO, "web-client", "src", "engine", "realiser.ts"), "private async decode(", "\n  private feed("),
    "ios/.../Realiser.swift": (os.path.join(REPO, "ios", "irisspeak", "irisspeak", "Engine", "Realiser.swift"), "private func decode(", "\n    private func feed("),
}

def section(path, start, end):
    """The prompt-building block only. The module docstrings quote an example prompt, which would otherwise
    satisfy the check on its own."""
    if not os.path.exists(path): return None
    s = open(path).read()
    if start not in s: return None
    s = s.split(start, 1)[1]
    return s.split(end, 1)[0] if end in s else s

def check(name, path, start, end):
    body = section(path, start, end)
    if body is None:
        return False, "prompt-building section not found"
    # only the lines that build the prompt, so an unrelated 'Cards:' elsewhere cannot satisfy the order
    body = re.sub(r'"""[\s\S]*?"""', "", body)          # drop docstrings
    body = re.sub(r'^\s*(#|//|\*)[^\n]*$', "", body, flags=re.M)   # and comments
    frag = "".join(re.findall(r'(?:Setting|Partner|Cards|Sentence):[^"`\']*', body))
    pos = [frag.find(l) for l in LABELS]
    if any(p < 0 for p in pos):
        return False, f"missing {[l for l, p in zip(LABELS, pos) if p < 0]}"
    if pos != sorted(pos):
        return False, "labels out of order"
    # each label must be followed by a value -- interpolated (${..}, \(..), {..}) or concatenated ("Cards: " + x).
    # Checked against the source, not the joined fragment, because Python builds one of these with a bare `+`.
    for label in LABELS[:3]:
        after = body[body.find(label) + len(label):][:24]
        if not re.search(r"\$\{|\\\(|\{[^}\s]|%s|\"\s*\+|\+\s*[A-Za-z_\"]", after):
            return False, f"{label} is not followed by a value ({after!r})"
    return True, ""

def main():
    bad = False
    for name, (path, start, end) in SOURCES.items():
        ok, why = check(name, path, start, end)
        if not ok: bad = True
        print(f"{'ok  ' if ok else 'FAIL'} {name}{'' if ok else ': ' + why}")
    if bad:
        print("\nThe realiser prompt must have the same shape in training, evaluation and both apps:")
        print("  Setting: <place>.\\nPartner: <question>\\nCards: a | b | c\\nSentence:")
        sys.exit(1)
    print("\nall four prompt builders agree")

if __name__ == "__main__":
    main()
