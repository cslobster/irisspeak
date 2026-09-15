#!/usr/bin/env python3
"""Resumable ingestion of the three AAC text sources into data/processed/*.jsonl.

  1. willwade/AACConversations (Hugging Face, gated, CC BY 4.0)  -> aacconversations_en_{train,test}.jsonl
  2. Turk AAC dialogues (aactext.org/turk, filtered preferred)     -> turk_dialogues_turns.jsonl, turk_dialogues.jsonl
  3. AACText "imagine" crowdsourced communications (CC BY 4.0)    -> aactext_imagine.jsonl

Every step records its outputs and row counts in data/processed/manifest.json and is skipped on the
next run unless --force is given. A gated dataset is never bypassed: the step prints instructions,
is recorded as "skipped_gated", and the other steps continue.

Usage:
  python3 data/ingest.py                      # run all steps
  python3 data/ingest.py --steps turk aactext # subset
  python3 data/ingest.py --force              # redo everything
  HF_TOKEN=... python3 data/ingest.py         # or --hf-key-file ~/tips/huggingface.key (default)
"""
import argparse, ast, csv, hashlib, io, json, os, re, sys, time, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "processed")
MANIFEST = os.path.join(OUT, "manifest.json")

EN_LOCALES = ["en-US", "en-GB", "en-CA", "en-AU", "en-NZ", "en-ZA"]
AACCONV_FIELDS = ["conversation_id", "turn_number", "language_code", "scene", "context_speakers",
                  "context_utterances", "speaker", "utterance", "utterance_intended", "next_turn_speaker",
                  "next_turn_utterance", "model", "provider", "batch_id", "batch_number"]

TURK_BASE = "https://www.aactext.org/turk/turk/"
TURK_FILES = ["readme.txt", "turk-dialogues.txt", "turk-dialogues-filtered.txt"]
IMAGINE_ZIP = "https://www.aactext.org/imagine/aac_comm.zip"
IMAGINE_FILES = ["readme.txt", "sent_train_aac.txt", "sent_dev_aac.txt", "sent_test_aac.txt"]  # CC BY 4.0 only
IMAGINE_EXCLUDED = ["lm_test_switch.txt", "lm_test_comm.txt"]  # separately licensed, never ingested

# ----------------------------------------------------------------------------- helpers
def log(*a): print(time.strftime("%H:%M:%S"), *a, flush=True)

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()[:16]

def load_manifest():
    if os.path.exists(MANIFEST): return json.load(open(MANIFEST))
    return {"steps": {}}

def save_manifest(m):
    os.makedirs(OUT, exist_ok=True)
    json.dump(m, open(MANIFEST, "w"), indent=2)

def done(m, step): return m["steps"].get(step, {}).get("status") == "ok"

def record(m, step, status, outputs=None, note=None, **extra):
    m["steps"][step] = {"status": status, "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                        "outputs": {os.path.relpath(p, ROOT): {"rows": n, "sha256": sha256(p)} for p, n in (outputs or {}).items()},
                        "note": note, **extra}
    save_manifest(m)

def download(url, dest, max_tries=3):
    if os.path.exists(dest) and os.path.getsize(dest) > 0: return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for i in range(max_tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "aac-ingest/1.0"}), timeout=120) as r:
                data = r.read()
            if b"<html" in data[:300].lower(): raise IOError(f"HTML page returned for {url}")
            open(dest, "wb").write(data); return dest
        except Exception as e:
            log(f"  download attempt {i+1} failed for {url}: {e}")
            time.sleep(3)
    raise IOError(f"could not download {url}")

def write_jsonl(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    n = 0
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n"); n += 1
    return n

def hf_token(key_file):
    tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if not tok and key_file and os.path.exists(os.path.expanduser(key_file)):
        tok = open(os.path.expanduser(key_file)).read().strip()
    return tok or None

# ----------------------------------------------------------------------------- 1. AACConversations
GATED_HELP = """
AACConversations is gated. Nothing was bypassed. To enable this step:
  1. Sign in at https://huggingface.co and open https://huggingface.co/datasets/willwade/AACConversations
  2. Click "Agree and access repository" and accept the dataset conditions (CC BY 4.0 plus the author's terms).
  3. Create a read token at https://huggingface.co/settings/tokens and export it:
       export HF_TOKEN=hf_xxx            (or: huggingface-cli login, or --hf-key-file <path>)
  4. Re-run: python3 data/ingest.py --steps aacconversations
"""

def step_aacconversations(m, key_file):
    tok = hf_token(key_file)
    if not tok:
        log("no HF token found (HF_TOKEN env or --hf-key-file)"); print(GATED_HELP)
        record(m, "aacconversations", "skipped_gated", note="no token"); return
    try:
        from datasets import load_dataset
        from huggingface_hub import HfApi
        who = HfApi(token=tok).whoami().get("name", "?")
        log(f"HF authenticated as {who}")
        ds = load_dataset("willwade/AACConversations", token=tok)
    except Exception as e:
        name = type(e).__name__; msg = str(e)
        if any(k in name for k in ("Gated", "Auth")) or any(k in msg for k in ("401", "403", "gated", "restricted", "Access to dataset")):
            log(f"gated / not authorised: {name}"); print(GATED_HELP)
            record(m, "aacconversations", "skipped_gated", note=f"{name}: {msg[:200]}"); return
        log(f"load_dataset failed ({name}): {msg[:300]}")
        record(m, "aacconversations", "failed", note=f"{name}: {msg[:300]}"); return

    outputs = {}; kept = 0; seen_locales = {}
    for split in ds.keys():
        rows = []
        cols = ds[split].column_names
        for r in ds[split]:
            lc = r.get("language_code") or r.get("language") or ""
            seen_locales[lc] = seen_locales.get(lc, 0) + 1
            if lc not in EN_LOCALES: continue
            o = {k: r.get(k) for k in AACCONV_FIELDS if k in cols}
            for k in ("context_speakers", "context_utterances"):      # stored as stringified python lists
                v = o.get(k)
                if isinstance(v, str):
                    try: o[k] = ast.literal_eval(v)
                    except Exception: o[k] = [v]
            cs, cu = o.get("context_speakers") or [], o.get("context_utterances") or []
            # partner utterance = last context turn not spoken by this speaker (None when the user initiates)
            o["partner_utterance"] = next((u for s, u in zip(reversed(cs), reversed(cu)) if s != o.get("speaker")), None)
            o["target_text"] = (r.get("utterance_intended") or r.get("utterance") or "").strip()
            o["target_source"] = "utterance_intended" if r.get("utterance_intended") else "utterance"
            o["source"] = "aacconversations"; o["split"] = split
            o["id"] = f"aacconv_{lc}_{o.get('conversation_id','?')}_{o.get('turn_number','?')}"
            rows.append(o)
        p = os.path.join(OUT, f"aacconversations_en_{split}.jsonl")
        outputs[p] = write_jsonl(p, rows); kept += len(rows)
        log(f"  {split}: kept {len(rows)} English rows of {len(ds[split])}; columns: {cols}")
    record(m, "aacconversations", "ok", outputs, note="English locales only; target_text prefers utterance_intended",
           locales_seen=seen_locales, license="CC BY 4.0 (subject to dataset access conditions)")

# ----------------------------------------------------------------------------- 2. Turk dialogues
def parse_turk(path, has_set_col):
    rows = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for i, line in enumerate(f):
            parts = line.rstrip("\n").split("\t")
            if i == 0 and parts[0] in ("set", "id"): continue     # header
            if has_set_col:
                if len(parts) < 3: continue
                split, did, turns = parts[0], parts[1], parts[2:]
            else:
                if len(parts) < 2: continue
                split, did, turns = None, parts[0], parts[1:]
            rows.append({"id": did, "split": split, "turns": [t.strip() for t in turns]})
    return rows

def step_turk(m):
    rawdir = os.path.join(RAW, "turk_dialogues")
    for f in TURK_FILES:
        download(TURK_BASE + f, os.path.join(rawdir, f))
    readme = open(os.path.join(rawdir, "readme.txt"), encoding="utf-8", errors="replace").read()
    lic = re.search(r"licensed under a ([^\n]+?License)", readme)
    license_text = lic.group(1) if lic else "see readme.txt"
    unfiltered = parse_turk(os.path.join(rawdir, "turk-dialogues.txt"), has_set_col=True)
    split_of = {d["id"]: d["split"] for d in unfiltered}
    unf_by_id = {d["id"]: d for d in unfiltered}
    # The filtered file has inconsistent delimiters (tabs replaced by runs of spaces, some turns joined by a
    # single space). Recover turn boundaries by aligning each filtered line with the unfiltered dialogue of
    # the same id: a turn is kept when its unfiltered text occurs verbatim in the filtered line.
    filtered = []; align_stats = {"aligned": 0, "no_unfiltered_match": 0, "turns_removed": 0}
    with open(os.path.join(rawdir, "turk-dialogues-filtered.txt"), encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line.strip() or line.startswith("id"): continue
            did = line.split()[0]; rest = " ".join(line.split()[1:])
            base = unf_by_id.get(did)
            if base is None: align_stats["no_unfiltered_match"] += 1; continue
            norm_rest = " ".join(rest.split())
            turns = []
            for t in base["turns"]:
                tt = " ".join(t.split())
                if tt and tt in norm_rest: turns.append(t)
                else: turns.append(""); align_stats["turns_removed"] += 1
            filtered.append({"id": did, "split": base["split"], "turns": turns})
            align_stats["aligned"] += 1
    log(f"  filtered alignment: {align_stats}")
    filtered_ids = {d["id"] for d in filtered}

    dialogues, turns = [], []
    for d in filtered:                       # filtered version is the training corpus
        did = "turk_" + d["id"]
        dialogues.append({"dialogue_id": did, "orig_id": d["id"], "split": split_of.get(d["id"]),
                          "n_turns": len(d["turns"]), "turns": d["turns"], "filtered": True, "source": "turk_dialogues"})
        for t_i, text in enumerate(d["turns"], start=1):
            if not text: continue
            turns.append({"id": f"{did}_t{t_i}", "dialogue_id": did, "split": split_of.get(d["id"]),
                          "turn_number": t_i, "speaker": "A" if t_i % 2 == 1 else "B",
                          "utterance": text,
                          "prev_utterance": d["turns"][t_i - 2] if t_i >= 2 else None,
                          "next_utterance": d["turns"][t_i] if t_i < len(d["turns"]) else None,
                          "filtered": True, "source": "turk_dialogues"})
    p1 = os.path.join(OUT, "turk_dialogues.jsonl"); p2 = os.path.join(OUT, "turk_dialogues_turns.jsonl")
    n1 = write_jsonl(p1, dialogues); n2 = write_jsonl(p2, turns)
    removed = [d["id"] for d in unfiltered if d["id"] not in filtered_ids]
    p3 = os.path.join(OUT, "turk_dialogues_unfiltered_only_ids.txt")
    open(p3, "w").write("\n".join(removed) + "\n")
    log(f"  unfiltered {len(unfiltered)} dialogues, filtered {len(filtered)}, removed by filter {len(removed)}; "
        f"turns written {n2}; splits: { {s: sum(1 for d in dialogues if d['split']==s) for s in ('train','dev','test',None)} }")
    record(m, "turk", "ok", {p1: n1, p2: n2, p3: len(removed)},
           note="filtered corpus used for training; unfiltered kept in data/raw/turk_dialogues; speaker A = turn1 author, alternating",
           license=license_text, license_warning=("readme says CC BY-ND 3.0, not CC BY 4.0: NoDerivs restricts redistribution of "
                                                  "modified copies; training use and internal derived files are fine, do not publish derived dialogue text"))

# ----------------------------------------------------------------------------- 3. AACText imagine
def step_aactext(m):
    rawdir = os.path.join(RAW, "aactext_imagine")
    missing = [f for f in IMAGINE_FILES if not os.path.exists(os.path.join(rawdir, f))]
    if missing:
        zpath = download(IMAGINE_ZIP, os.path.join(rawdir, "aac_comm.zip"))
        with zipfile.ZipFile(zpath) as z:
            for name in z.namelist():
                base = os.path.basename(name)
                if base in IMAGINE_FILES:
                    open(os.path.join(rawdir, base), "wb").write(z.read(name))
                elif base in IMAGINE_EXCLUDED:
                    log(f"  skipping separately licensed file {base}")
    rows = []
    for split, fname in (("train", "sent_train_aac.txt"), ("dev", "sent_dev_aac.txt"), ("test", "sent_test_aac.txt")):
        with open(os.path.join(rawdir, fname), encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f):
                text = line.rstrip("\n").strip()
                if not text: continue
                rows.append({"id": f"aactext_{split}_{i:05d}", "split": split, "text": text,
                             "partner_utterance": None,       # isolated messages: never invent a partner turn here
                             "source": "aactext_imagine"})
    p = os.path.join(OUT, "aactext_imagine.jsonl"); n = write_jsonl(p, rows)
    log(f"  wrote {n} messages; splits: { {s: sum(1 for r in rows if r['split']==s) for s in ('train','dev','test')} }")
    record(m, "aactext", "ok", {p: n}, note="official split preserved; lm_test_* files excluded", license="CC BY 4.0")

# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", nargs="*", default=["aacconversations", "turk", "aactext"])
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--hf-key-file", default="~/tips/huggingface.key")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    m = load_manifest()
    for step in a.steps:
        if done(m, step) and not a.force:
            log(f"[{step}] already done, skipping (use --force to redo)"); continue
        log(f"[{step}] running")
        try:
            {"aacconversations": lambda: step_aacconversations(m, a.hf_key_file),
             "turk": lambda: step_turk(m), "aactext": lambda: step_aactext(m)}[step]()
        except Exception as e:
            log(f"[{step}] FAILED: {type(e).__name__}: {e}")
            record(m, step, "failed", note=f"{type(e).__name__}: {str(e)[:300]}")
    print("\nSummary:")
    for step, info in m["steps"].items():
        outs = ", ".join(f"{k} ({v['rows']} rows)" for k, v in info.get("outputs", {}).items()) or "-"
        print(f"  {step:18s} {info['status']:14s} {outs}")
        if info.get("license_warning"): print(f"  {'':18s} WARNING: {info['license_warning']}")

if __name__ == "__main__":
    main()
