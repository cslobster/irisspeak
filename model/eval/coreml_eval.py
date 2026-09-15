"""Card recall of Core ML packages vs the torch checkpoint on held-out states (same encoding as the app).
Usage: python3 eval/coreml_eval.py --ckpt train/out/smollm135_v31/card_model.pt --pkg export/out_v31/coreml/IrisSpeakCard.mlpackage export/out_v31/coreml_fp32/IrisSpeakCard.mlpackage --n 400
"""
import os, sys, json, argparse, random, time
import numpy as np, torch
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(ROOT, "train"))
from train_smollm import CardModel, encode_batch, load_vocab, MODEL
from transformers import AutoTokenizer, AutoModelForCausalLM
import coremltools as ct
ap = argparse.ArgumentParser(); ap.add_argument("--ckpt", required=True); ap.add_argument("--pkg", nargs="+", required=True); ap.add_argument("--n", type=int, default=400); a = ap.parse_args()
ids, speak = load_vocab(); n = len(ids); id2idx = {c: i for i, c in enumerate(ids)}; start_idx = n
bj = os.path.join(os.path.dirname(a.ckpt), "backbone.json"); model_name = json.load(open(bj))["model"] if os.path.exists(bj) else MODEL
tok = AutoTokenizer.from_pretrained(model_name); tok.padding_side = "right"
if tok.pad_token_id is None: tok.pad_token = tok.eos_token
base = AutoModelForCausalLM.from_pretrained(model_name, dtype=torch.float32); V = base.get_input_embeddings().weight.size(0)
model = CardModel(base, n, torch.zeros(n + 1, base.get_input_embeddings().weight.size(1))); model.load_state_dict(torch.load(a.ckpt, map_location="cpu"), strict=False); model.eval()
dead = ~model.out_mask.clone(); model.out_mask.fill_(True)
test = [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", "test_qa.jsonl"))]; random.seed(3); random.shuffle(test); par = test[: a.n]
def targets(s): return [id2idx[c] for c in s["targets"] if c in id2idx]
def recall(rows, k=16):
    hit = 0
    for logits, s in zip(rows, par):
        lg = logits.copy(); lg[dead.numpy()] = -1e4; top = set(np.argsort(-lg)[:k]); t = targets(s)
        hit += int(bool(t) and any(x in top for x in t))
    return hit / len(par)
ref = []
with torch.no_grad():
    for i in range(0, len(par), 8):
        b = par[i:i+8]; t_ids, t_mask, c_idx, c_mask = encode_batch(tok, b, id2idx, start_idx, "cpu"); ref.extend(model(t_ids, t_mask, c_idx, c_mask)[0].numpy())
print(f"torch fp32: recall@16 {recall(ref):.3f}  recall@1 {recall(ref, 1):.3f}", flush=True)
for pkg in a.pkg:
    ml = ct.load(pkg) if hasattr(ct, "load") else ct.models.MLModel(pkg)
    L = ml.get_spec().description.input[0].type.multiArrayType.shape[1]; rows = []; ov = 0; t0 = time.time()
    with torch.no_grad():
        for s in par:
            t_ids, t_mask, c_idx, c_mask = encode_batch(tok, [s], id2idx, start_idx, "cpu")
            seq = torch.cat([t_ids[:, : int(t_mask.sum())], (c_idx + V)[:, : int(c_mask.sum())]], 1)[0].numpy()[-L:]
            ii = np.zeros((1, L), dtype=np.int32); mm = np.zeros((1, L), dtype=np.int32); ii[0, : len(seq)] = seq; mm[0, : len(seq)] = 1
            rows.append(np.asarray(ml.predict({"input_ids": ii, "attention_mask": mm})["card_logits"])[0, len(seq) - 1].astype(np.float32))
    for r, g in zip(rows, ref): ov += len(set(np.argsort(-r)[:16]) & set(np.argsort(-g)[:16])) / 16
    print(f"{pkg}: recall@16 {recall(rows):.3f}  recall@1 {recall(rows, 1):.3f}  top-16 overlap with torch {ov/len(par):.3f}  {(time.time()-t0)/len(par)*1000:.0f} ms/state", flush=True)
