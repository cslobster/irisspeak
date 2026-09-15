#!/usr/bin/env python3
"""Export the fine-tuned card model to ONNX for the browser demo.

Graph inputs : text_ids (B,T) int64, text_mask (B,T) int64, card_idx (B,C) int64, card_mask (B,C) int64
Graph output : logits (B, 3096) float32  over cards + <name> + <aac_end>
Card embedding rows and the base model's token embedding are baked into the graph, so the browser only needs
the SmolLM2 tokenizer (from transformers.js) and this file.

Usage: python3 export/export_onnx.py --ckpt train/out/smollm135_v2/card_model.pt --out export/out
Produces card_model.onnx (fp32), card_model_int8.onnx (dynamic int8), cards.json (id, speak, category), and
a parity report against the PyTorch model on 200 test states.
"""
import argparse, csv, json, os, sys, random, time
import numpy as np, torch
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "train")); sys.path.insert(0, os.path.join(ROOT, "eval"))
from train_smollm import CardModel, encode_batch, load_vocab, MODEL
from transformers import AutoTokenizer, AutoModelForCausalLM

class Wrapper(torch.nn.Module):
    """Same computation as CardModel.forward but with exporter-friendly ops (gather instead of fancy indexing)."""
    def __init__(self, m): super().__init__(); self.m = m
    def forward(self, text_ids, text_mask, card_idx, card_mask):
        emb = self.m.base.get_input_embeddings()
        x = torch.cat([emb(text_ids), self.m.card_emb[card_idx]], 1)
        mask = torch.cat([text_mask, card_mask], 1)
        h = self.m.base.model(inputs_embeds=x, attention_mask=mask).last_hidden_state
        last = (mask.sum(1) - 1).clamp(min=0)
        hl = torch.gather(h, 1, last.view(-1, 1, 1).expand(-1, 1, h.size(2))).squeeze(1)
        return hl @ self.m.card_emb[: self.m.n_cards].T

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--ckpt", required=True); ap.add_argument("--out", default=os.path.join(ROOT, "export", "out"))
    ap.add_argument("--parity", type=int, default=200); a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    ids, speak = load_vocab(); n = len(ids); id2idx = {c: i for i, c in enumerate(ids)}; start_idx = n
    tok = AutoTokenizer.from_pretrained(MODEL); tok.padding_side = "right"
    base = AutoModelForCausalLM.from_pretrained(MODEL, dtype=torch.float32, attn_implementation="eager")
    model = CardModel(base, n, torch.zeros(n + 1, base.get_input_embeddings().weight.size(1)))
    model.load_state_dict(torch.load(a.ckpt, map_location="cpu")); model.eval()
    w = Wrapper(model).eval()

    test = [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", "test_qa.jsonl"))]
    random.seed(3); random.shuffle(test); ex = test[:8]
    t_ids, t_mask, c_idx, c_mask = encode_batch(tok, ex, id2idx, start_idx, "cpu")
    onnx_path = os.path.join(a.out, "card_model.onnx")
    t0 = time.time()
    names = dict(input_names=["text_ids", "text_mask", "card_idx", "card_mask"], output_names=["logits"],
                 dynamic_axes={"text_ids": {0: "b", 1: "t"}, "text_mask": {0: "b", 1: "t"},
                               "card_idx": {0: "b", 1: "c"}, "card_mask": {0: "b", 1: "c"}, "logits": {0: "b"}})
    try:
        torch.onnx.export(w, (t_ids, t_mask, c_idx, c_mask), onnx_path, opset_version=17, dynamo=False, **names)
        print("exported with the legacy exporter", flush=True)
    except Exception as e:
        print("legacy exporter failed:", type(e).__name__, str(e)[:120], "-> trying dynamo exporter", flush=True)
        prog = torch.onnx.export(w, (t_ids, t_mask, c_idx, c_mask), dynamo=True, opset_version=18, **names)
        prog.optimize(); prog.save(onnx_path)
    print(f"exported fp32 in {time.time()-t0:.0f}s: {os.path.getsize(onnx_path)/1e6:.0f} MB", flush=True)
    # dynamic int8 quantisation of MatMul weights
    from onnxruntime.quantization import quantize_dynamic, QuantType
    q_path = os.path.join(a.out, "card_model_int8.onnx")
    quantize_dynamic(onnx_path, q_path, weight_type=QuantType.QInt8)
    print(f"int8: {os.path.getsize(q_path)/1e6:.0f} MB", flush=True)
    # cards.json for the page
    rows = list(csv.DictReader(open(os.path.join(ROOT, "vocab", "vocab.csv"))))
    meta = [{"id": r["id"], "speak": r["speak"], "category": r["category"], "intent": r["intent"], "core": r["core"], "safety": r["safety"]} for r in rows]
    meta += [{"id": "<name>", "speak": "(name)", "category": "people", "intent": "content", "core": "0", "safety": "0"},
             {"id": "<aac_end>", "speak": "(end)", "category": "core", "intent": "content", "core": "0", "safety": "0"}]
    json.dump({"cards": meta, "start_index": start_idx, "n_outputs": n}, open(os.path.join(a.out, "cards.json"), "w"))
    # parity: top-100 overlap and top-1 agreement on test states, fp32 vs int8 vs torch
    import onnxruntime as ort
    par = test[: a.parity]; agree = {"fp32": [0, 0], "int8": [0, 0]}
    s32 = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"]); s8 = ort.InferenceSession(q_path, providers=["CPUExecutionProvider"])
    with torch.no_grad():
        for i in range(0, len(par), 16):
            b = par[i:i+16]; inp = encode_batch(tok, b, id2idx, start_idx, "cpu")
            ref = model(*inp)[0].numpy(); feed = {k: v.numpy() for k, v in zip(["text_ids", "text_mask", "card_idx", "card_mask"], inp)}
            for name, sess in (("fp32", s32), ("int8", s8)):
                out = sess.run(["logits"], feed)[0]
                for j in range(len(b)):
                    r100 = set(np.argsort(-ref[j])[:100]); o100 = set(np.argsort(-out[j])[:100])
                    agree[name][0] += len(r100 & o100) / 100; agree[name][1] += int(np.argmax(ref[j]) == np.argmax(out[j]))
    for name, (ov, t1) in agree.items(): print(f"parity {name}: top-100 overlap {ov/len(par):.3f}, top-1 agreement {t1/len(par):.3f}")
    t0 = time.time(); s8.run(["logits"], {k: v.numpy()[:1] for k, v in zip(["text_ids", "text_mask", "card_idx", "card_mask"], inp)}); print(f"int8 single-state CPU latency {1000*(time.time()-t0):.0f} ms")

if __name__ == "__main__":
    main()
