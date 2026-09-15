"""Export the trained sentence realiser (train/train_realiser.py's hf_realiser dir) for both apps:
  * ONNX with KV cache via optimum (text-generation-with-past), fp16 weights with fp32 I/O (keep_io_types)
  * web: 24 MB chunks + realiser_manifest.json (chunks, total_bytes, layers/kv_heads/head_dim for the empty cache)
  * iOS: the single fp16 file, copied by irisspeakapp/scripts/fetch_models.sh
Usage: python3 export/export_realiser.py --hf train/out/realiser_135m/hf_realiser --out export/out_realiser --version r1 --site site/public/model
"""
import os, sys, json, argparse, subprocess, hashlib
import onnx, numpy as np
ap = argparse.ArgumentParser(); ap.add_argument("--hf", required=True); ap.add_argument("--out", required=True); ap.add_argument("--version", default="r1")
ap.add_argument("--site", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site", "public", "model")); ap.add_argument("--chunk-mb", type=int, default=24)
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
onnx_dir = os.path.join(a.out, "onnx")
if not os.path.exists(os.path.join(onnx_dir, "model.onnx")):
    subprocess.check_call(["optimum-cli", "export", "onnx", "-m", a.hf, "--task", "text-generation-with-past", "--opset", "17", onnx_dir])
m = onnx.load(os.path.join(onnx_dir, "model.onnx"), load_external_data=True)
from onnxruntime.transformers.float16 import convert_float_to_float16
m16 = convert_float_to_float16(m, keep_io_types=True, disable_shape_infer=True)
fp16 = os.path.join(a.out, "realiser_fp16.onnx"); onnx.save(m16, fp16); print(f"fp16: {os.path.getsize(fp16)/1e6:.0f} MB", flush=True)
cfg = json.load(open(os.path.join(a.hf, "config.json")))
layers, kv_heads, head_dim = cfg["num_hidden_layers"], cfg["num_key_value_heads"], cfg["hidden_size"] // cfg["num_attention_heads"]
# web chunks
cdir = os.path.join(a.site, a.version); os.makedirs(cdir, exist_ok=True)
data = open(fp16, "rb").read(); h = hashlib.sha256(); parts = []; sz = a.chunk_mb * 1024 * 1024
for i in range(0, len(data), sz):
    b = data[i:i + sz]; name = f"realiser_fp16.part{len(parts):02d}"; open(os.path.join(cdir, name), "wb").write(b); h.update(b); parts.append(f"{a.version}/{name}")
json.dump({"chunks": parts, "total_bytes": len(data), "sha256": h.hexdigest(), "version": a.version, "layers": layers, "kv_heads": kv_heads, "head_dim": head_dim,
           "format": "onnx fp16 weights (keep_io_types), text-generation-with-past", "backbone": cfg.get("_name_or_path", "")},
          open(os.path.join(a.site, "realiser_manifest.json"), "w"), indent=1)
print(f"{len(parts)} chunks in {cdir}, realiser_manifest.json written (layers {layers}, kv_heads {kv_heads}, head_dim {head_dim})")
