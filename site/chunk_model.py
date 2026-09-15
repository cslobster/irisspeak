#!/usr/bin/env python3
"""Split the int8 ONNX model into <25 MB chunks for Cloudflare Pages and write a manifest.
Usage: python3 site/chunk_model.py --onnx export/out/card_model_int8.onnx --cards export/out/cards.json --out site/public/model
"""
import argparse, hashlib, json, os, shutil
ap = argparse.ArgumentParser(); ap.add_argument("--onnx", required=True); ap.add_argument("--cards", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--chunk-mb", type=int, default=24); ap.add_argument("--version", default="", help="sub-directory for the chunks, e.g. v3 (new URLs bust the immutable CDN cache)")
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True); cdir = os.path.join(a.out, a.version) if a.version else a.out; os.makedirs(cdir, exist_ok=True)
for f in os.listdir(cdir):
    if f.startswith("card_model_fp16.part"): os.remove(os.path.join(cdir, f))
size = os.path.getsize(a.onnx); chunk = a.chunk_mb * 1024 * 1024; parts = []; h = hashlib.sha256()
with open(a.onnx, "rb") as f:
    i = 0
    while True:
        b = f.read(chunk)
        if not b: break
        name = f"card_model_fp16.part{i:02d}"; open(os.path.join(cdir, name), "wb").write(b); h.update(b); parts.append((a.version + "/" if a.version else "") + name); i += 1
json.dump({"chunks": parts, "total_bytes": size, "sha256": h.hexdigest(), "version": a.version, "format": "onnx fp16 weights (keep_io_types), extended vocabulary", "inputs": ["input_ids", "attention_mask", "position_ids"], "output": "logits"},
          open(os.path.join(a.out, "manifest.json"), "w"), indent=1)
# cards.json: output order of the card logits (vocab order + <name> + <aac_end>), plus V and start index
import csv
rows = list(csv.DictReader(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vocab", "vocab.csv"))))
meta = [{"id": r["id"], "speak": r["speak"], "category": r["category"], "intent": r["intent"]} for r in rows]
ext = json.load(open(a.cards)) if a.cards.endswith(".json") and "extended" in a.cards else {}
# v3: folder rows sit between the cards and the specials, in the order the trainer used (ext["cards"])
folders = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "states", "folders.json")))["folders"] if ext.get("folders") else []
fmeta = {f["id"]: f for f in folders}
# the app addresses folders by their browse path (web-client/public/folders.json); map the trainer's folder id onto it
try:
    app_f = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web-client", "public", "folders.json")))["folders"]
    id2path = {f.get("id"): f["path"] for f in app_f if f.get("id")}
    for fid, f in fmeta.items(): f["path"] = id2path.get(fid[len("<folder:"):-1], f["path"])
except Exception as e: print("app folders.json not applied:", e)
meta += [{"id": fid, "speak": fmeta[fid]["label"], "category": "folder", "intent": "content", "is_folder": 1, "folder": fmeta[fid]["path"], "members": fmeta[fid]["members"]} for fid in ext.get("folders", [])]
meta += [{"id": "<name>", "speak": "(name)", "category": "people", "intent": "content"}, {"id": "<aac_end>", "speak": "(end)", "category": "core", "intent": "content"}]
if ext.get("cards"): assert [m["id"] for m in meta] == ext["cards"], "cards.json order differs from the trained output order"
json.dump({"cards": meta, "start_index": len(meta), "n_outputs": len(meta), "V": ext.get("V", 49152), "dead": ext.get("dead", []), "folder_weight": 0.4},
          open(os.path.join(a.out, "cards.json"), "w"))
print(f"{len(parts)} chunks, {size/1e6:.0f} MB total, manifest written to {a.out}")
