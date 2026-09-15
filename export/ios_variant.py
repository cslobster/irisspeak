"""Make the iOS build of a card-model ONNX: slice `logits` to the last position (the app only reads it, and the
full [1, seq, V+cards] fp32 tensor costs ~0.6 MB per token) and store the weights in one external data file so
ONNX Runtime memory-maps them (clean, evictable pages) instead of copying them into the heap.
Usage: python3 export/ios_variant.py --in export/out_qwen31/card_model_fp16.onnx --out export/out_qwen31/ios
Pair with `session.disable_prepacking=1` in the app (OnnxModel.swift), see PLAN-RETRAIN.md §8.
"""
import argparse, os, onnx
from onnx import helper, TensorProto

ap = argparse.ArgumentParser(); ap.add_argument("--in", dest="inp", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--name", default="card_model_fp16.onnx", help="file name inside --out (the app loads card_model_fp16.onnx whatever the dtype)")
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
m = onnx.load(a.inp, load_external_data=True); g = m.graph
out = next(o for o in g.output if o.name == "logits")
if not any(n.name == "last_token_slice" for n in g.node):
    for n in g.node:
        for i, o in enumerate(n.output):
            if o == "logits": n.output[i] = "logits_all"
    g.initializer.extend([helper.make_tensor("sl_start", TensorProto.INT64, [1], [-1]), helper.make_tensor("sl_end", TensorProto.INT64, [1], [2**62]), helper.make_tensor("sl_axes", TensorProto.INT64, [1], [1])])
    g.node.append(helper.make_node("Slice", ["logits_all", "sl_start", "sl_end", "sl_axes"], ["logits"], name="last_token_slice"))
    out.type.tensor_type.shape.dim[1].dim_param = ""; out.type.tensor_type.shape.dim[1].dim_value = 1
path = os.path.join(a.out, a.name)
onnx.save_model(m, path, save_as_external_data=True, all_tensors_to_one_file=True, location=a.name + "_data", size_threshold=1024, convert_attribute=False)
print(f"{path}: {os.path.getsize(path)/1e6:.1f} MB + {os.path.getsize(path + '_data')/1e6:.0f} MB weights")
