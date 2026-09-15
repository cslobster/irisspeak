#!/usr/bin/env python3
"""Try quantisation settings for the exported ONNX and report parity against the PyTorch card model.
Usage: python3 export/quantize_check.py --ckpt <card_model.pt> --onnx export/out/onnx/model.onnx --out export/out
"""
import argparse, json, os, sys, random, time
import numpy as np, torch, onnx
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "train"))
from train_smollm import CardModel, encode_batch, load_vocab, MODEL
from transformers import AutoTokenizer, AutoModelForCausalLM
from onnxruntime.quantization import quantize_dynamic, QuantType
import onnxruntime as ort

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--ckpt", required=True); ap.add_argument("--onnx", required=True); ap.add_argument("--out", required=True); ap.add_argument("--parity", type=int, default=96)
    ap.add_argument("--parity-only", nargs="*", help="existing quantised files to score instead of re-quantising")
    a = ap.parse_args()
    ids, speak = load_vocab(); n = len(ids); id2idx = {c: i for i, c in enumerate(ids)}; start_idx = n
    bj = os.path.join(os.path.dirname(a.ckpt), "backbone.json")
    model_name = json.load(open(bj))["model"] if os.path.exists(bj) else MODEL
    tok = AutoTokenizer.from_pretrained(model_name); tok.padding_side = "right"
    if tok.pad_token_id is None: tok.pad_token = tok.eos_token
    base = AutoModelForCausalLM.from_pretrained(model_name, dtype=torch.float32); V = base.get_input_embeddings().weight.size(0)
    model = CardModel(base, n, torch.zeros(n + 1, base.get_input_embeddings().weight.size(1))); model.load_state_dict(torch.load(a.ckpt, map_location="cpu"), strict=False); model.eval()
    model.out_mask.fill_(True)   # the dead-row mask is applied in the app, not in the ONNX graph: compare unmasked logits
    test = [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", "test_qa.jsonl"))]; random.seed(3); random.shuffle(test); par = test[: a.parity]
    refs = []; feeds = []
    with torch.no_grad():
        for i in range(0, len(par), 8):
            b = par[i:i+8]; t_ids, t_mask, c_idx, c_mask = encode_batch(tok, b, id2idx, start_idx, "cpu")
            refs.append(model(t_ids, t_mask, c_idx, c_mask)[0].numpy())
            ii = torch.cat([t_ids, c_idx + V], 1); mm = torch.cat([t_mask, c_mask], 1)
            feeds.append(({"input_ids": ii.numpy(), "attention_mask": mm.numpy(), "position_ids": np.tile(np.arange(ii.shape[1], dtype=np.int64), (ii.shape[0], 1))}, (mm.sum(1) - 1).numpy()))
    def parity(path):
        sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"]); names = [i.name for i in sess.get_inputs()]
        ov = t1 = N = 0; t0 = time.time()
        for ref, (feed, last) in zip(refs, feeds):
            out = sess.run(["logits"], {k: v for k, v in feed.items() if k in names})[0]
            got = out[np.arange(len(last)), last][:, V:V + n]
            for j in range(len(last)):
                ov += len(set(np.argsort(-ref[j])[:100]) & set(np.argsort(-got[j])[:100])) / 100; t1 += int(np.argmax(ref[j]) == np.argmax(got[j])); N += 1
        return ov / N, t1 / N, (time.time() - t0) / N * 8
    print(f"fp32 onnx: overlap {parity(a.onnx)[0]:.3f} top1 {parity(a.onnx)[1]:.3f}  ({os.path.getsize(a.onnx)/1e6:.0f} MB)", flush=True)
    if a.parity_only:
        for path in a.parity_only:
            ov, t1, lat = parity(path); print(f"{os.path.basename(path)}: overlap {ov:.3f} top1 {t1:.3f} {lat*1000/8:.0f} ms/state", flush=True)
        return
    m = onnx.load(a.onnx)
    # find MatMul nodes that consume the (tied) embedding/lm_head weight: exclude them from quantisation
    big = {init.name for init in m.graph.initializer if len(init.dims) == 2 and max(init.dims) > 20000}
    excl = [nd.name for nd in m.graph.node if nd.op_type == "MatMul" and any(i in big for i in nd.input)]
    print("large-matrix MatMul nodes excluded:", excl, flush=True)
    variants = {
        "int8_perchannel_exclhead": dict(weight_type=QuantType.QInt8, per_channel=True, reduce_range=True, nodes_to_exclude=excl),
        "uint8_perchannel_exclhead": dict(weight_type=QuantType.QUInt8, per_channel=True, reduce_range=True, nodes_to_exclude=excl),
        "int8_perchannel_all": dict(weight_type=QuantType.QInt8, per_channel=True, reduce_range=True),
    }
    report = {}
    for name, kw in variants.items():
        path = os.path.join(a.out, f"card_model_{name}.onnx")
        quantize_dynamic(a.onnx, path, **kw)
        ov, t1, lat = parity(path); report[name] = {"overlap": ov, "top1": t1, "mb": os.path.getsize(path) / 1e6, "ms_per_state": lat * 1000}
        print(f"{name}: overlap {ov:.3f} top1 {t1:.3f} size {os.path.getsize(path)/1e6:.0f} MB  {lat*1000:.0f} ms/state", flush=True)
    json.dump(report, open(os.path.join(a.out, "quantize_report.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
