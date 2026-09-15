#!/usr/bin/env python3
"""Export the fine-tuned card model via Hugging Face Optimum by folding the card rows into the vocabulary.

The trained CardModel keeps a separate (n_cards+1, hidden) matrix used as input embedding for tapped cards and
as the output head. Mathematically that is identical to a standard causal LM whose vocabulary is extended by
n_cards+1 tokens (tied embeddings), where:
  * token id V + i           = card row i (i < n_cards: cards, <name>, <aac_end>; i == n_cards: <aac_start>)
  * card logits              = lm_head logits [V : V + n_cards]
So we build that extended LlamaForCausalLM, save it, export with optimum-cli (proven for Llama-style models),
quantise to int8, and verify parity with the PyTorch CardModel on test states.

Browser usage: tokens = tokenizer(text) + [V + start] + [V + idx for each tapped card]; run the ONNX model with
input_ids / attention_mask (+ empty past KV) and read logits[-1][V : V + n_cards].

Usage: python3 export/export_onnx_optimum.py --ckpt train/out/smollm135_v2/card_model.pt --out export/out
"""
import argparse, csv, json, os, sys, random, subprocess, time, shutil
import numpy as np, torch
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "train"))
from train_smollm import CardModel, encode_batch, load_vocab, MODEL
from transformers import AutoTokenizer, AutoModelForCausalLM

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--ckpt", required=True); ap.add_argument("--out", default=os.path.join(ROOT, "export", "out"))
    ap.add_argument("--parity", type=int, default=200); a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    ids, speak = load_vocab(); n = len(ids); id2idx = {c: i for i, c in enumerate(ids)}; start_idx = n
    bj = os.path.join(os.path.dirname(a.ckpt), "backbone.json")
    model_name = json.load(open(bj))["model"] if os.path.exists(bj) else MODEL     # v3.1+: the trainer records its backbone
    print("backbone:", model_name, flush=True)
    tok = AutoTokenizer.from_pretrained(model_name); tok.padding_side = "right"
    if tok.pad_token_id is None: tok.pad_token = tok.eos_token
    base = AutoModelForCausalLM.from_pretrained(model_name, dtype=torch.float32)
    model = CardModel(base, n, torch.zeros(n + 1, base.get_input_embeddings().weight.size(1)))
    model.load_state_dict(torch.load(a.ckpt, map_location="cpu"), strict=False); model.eval()
    dead = [i for i, m in enumerate(model.out_mask.tolist()) if not m]     # v3: rows masked out of the softmax
    model.out_mask.fill_(True)   # the mask is applied client-side (cards.json "dead"); parity below compares unmasked logits
    folders = [c for c in ids if c.startswith("<folder:")]
    print(f"dead rows: {len(dead)}  folder rows: {len(folders)}", flush=True)

    # ---- build the extended-vocabulary standard model
    V = base.get_input_embeddings().weight.size(0)
    ext = AutoModelForCausalLM.from_pretrained(model_name, dtype=torch.float32)
    ext.load_state_dict({k[len("base."):]: v for k, v in model.state_dict().items() if k.startswith("base.")})
    ext.resize_token_embeddings(V + n + 1, mean_resizing=False)
    with torch.no_grad():
        ext.get_input_embeddings().weight[V:] = model.card_emb.detach()
        if not ext.config.tie_word_embeddings:
            ext.get_output_embeddings().weight[V:] = model.card_emb.detach()
    ext.config.vocab_size = V + n + 1
    hf_dir = os.path.join(a.out, "hf_extended"); shutil.rmtree(hf_dir, ignore_errors=True)
    ext.save_pretrained(hf_dir); tok.save_pretrained(hf_dir)
    json.dump({"V": V, "n_cards": n, "start_token": V + n, "cards": ids, "speak": {c: speak[c] for c in ids}, "dead": dead, "folders": folders, "backbone": model_name},
              open(os.path.join(a.out, "extended_vocab.json"), "w"))
    print(f"extended model saved: vocab {V} + {n+1}", flush=True)

    # ---- torch parity of the extended model vs CardModel (before ONNX)
    test = [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", "test_qa.jsonl"))]
    random.seed(3); random.shuffle(test); par = test[: a.parity]
    def ext_inputs(exs):
        t_ids, t_mask, c_idx, c_mask = encode_batch(tok, exs, id2idx, start_idx, "cpu")
        # extended token ids: text ids then V + card_idx; single attention mask
        cid = c_idx + V
        return torch.cat([t_ids, cid], 1), torch.cat([t_mask, c_mask], 1)
    with torch.no_grad():
        ref = model(*encode_batch(tok, par[:16], id2idx, start_idx, "cpu"))[0]
        ii, mm = ext_inputs(par[:16]); last = mm.sum(1) - 1
        out = ext(input_ids=ii, attention_mask=mm).logits
        got = out[torch.arange(out.size(0)), last][:, V:V + n]
        print("torch parity max |diff| =", (ref - got).abs().max().item(), flush=True)

    # ---- optimum export
    onnx_dir = os.path.join(a.out, "onnx"); shutil.rmtree(onnx_dir, ignore_errors=True)
    cmd = ["optimum-cli", "export", "onnx", "--model", hf_dir, "--task", "text-generation", "--opset", "17", onnx_dir]
    print("running:", " ".join(cmd), flush=True); t0 = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout[-1500:], r.stderr[-1500:], flush=True)
    files = os.listdir(onnx_dir) if os.path.exists(onnx_dir) else []
    print(f"export done in {time.time()-t0:.0f}s:", files, flush=True)
    onnx_path = os.path.join(onnx_dir, "model.onnx")
    from onnxruntime.quantization import quantize_dynamic, QuantType
    q_path = os.path.join(a.out, "card_model_int8.onnx")
    quantize_dynamic(onnx_path, q_path, weight_type=QuantType.QInt8)
    print(f"int8: {os.path.getsize(q_path)/1e6:.0f} MB", flush=True)

    # ---- ONNX parity vs torch CardModel
    import onnxruntime as ort
    sess = ort.InferenceSession(q_path, providers=["CPUExecutionProvider"])
    in_names = [i.name for i in sess.get_inputs()]
    print("onnx inputs:", in_names, flush=True)
    ov = t1 = 0
    with torch.no_grad():
        for i in range(0, len(par), 8):
            b = par[i:i+8]; ref = model(*encode_batch(tok, b, id2idx, start_idx, "cpu"))[0].numpy()
            ii, mm = ext_inputs(b); feed = {"input_ids": ii.numpy(), "attention_mask": mm.numpy()}
            if "position_ids" in in_names: feed["position_ids"] = (mm.cumsum(1) - 1).clamp(min=0).numpy()
            for nm in in_names:
                if nm.startswith("past_key_values"):
                    shp = [d if isinstance(d, int) else (len(b) if "batch" in str(d) else 0) for d in sess.get_inputs()[in_names.index(nm)].shape]
                    feed[nm] = np.zeros(shp, dtype=np.float32)
            out = sess.run(["logits"], feed)[0]; last = (mm.sum(1) - 1).numpy()
            got = out[np.arange(len(b)), last][:, V:V + n]
            for j in range(len(b)):
                ov += len(set(np.argsort(-ref[j])[:100]) & set(np.argsort(-got[j])[:100])) / 100; t1 += int(np.argmax(ref[j]) == np.argmax(got[j]))
    print(f"parity int8 onnx vs torch: top-100 overlap {ov/len(par):.3f}, top-1 agreement {t1/len(par):.3f}", flush=True)
    t0 = time.time(); sess.run(["logits"], {k: (v[:1] if hasattr(v, 'shape') else v) for k, v in feed.items()}); print(f"int8 single-state CPU latency {1000*(time.time()-t0):.0f} ms")
    json.dump({"parity_top100": ov/len(par), "parity_top1": t1/len(par), "int8_mb": os.path.getsize(q_path)/1e6, "inputs": in_names},
              open(os.path.join(a.out, "export_report.json"), "w"))

if __name__ == "__main__":
    main()
