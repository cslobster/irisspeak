#!/usr/bin/env python3
"""Block-wise weight-only quantisation (MatMulNBits) and fp16 conversion of the exported ONNX, with parity.
Usage: python3 export/quantize_nbits.py --ckpt <card_model.pt> --onnx export/out/onnx/model.onnx --out export/out
"""
import argparse, os, sys, json, time
import numpy as np, onnx
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "export"))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--ckpt", required=True); ap.add_argument("--onnx", required=True); ap.add_argument("--out", required=True); ap.add_argument("--parity", type=int, default=64)
    a = ap.parse_args()
    outs = []
    # 1. MatMulNBits 4-bit, block 32 (weight-only, block-wise scales)
    try:
        from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer, DefaultWeightOnlyQuantConfig
        for bits in (8, 4):
            try:
                m = onnx.load(a.onnx)
                cfg = DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, bits=bits) if bits != 4 else DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True)
                q = MatMulNBitsQuantizer(m, algo_config=cfg); q.process()
                path = os.path.join(a.out, f"card_model_nbits{bits}.onnx"); q.model.save_model_to_file(path, use_external_data_format=False); outs.append(path)
                print(f"nbits{bits}: {os.path.getsize(path)/1e6:.0f} MB", flush=True)
            except Exception as e: print(f"nbits{bits} failed: {type(e).__name__}: {str(e)[:150]}", flush=True)
    except Exception as e: print("MatMulNBits unavailable:", type(e).__name__, str(e)[:120], flush=True)
    # 2. fp16
    try:
        from onnxruntime.transformers.float16 import convert_float_to_float16
        m = onnx.load(a.onnx, load_external_data=True); m16 = convert_float_to_float16(m, keep_io_types=True, disable_shape_infer=True)   # shape inference on a >2 GB proto returns an empty model; external-data exports (>2 GB fp32, e.g. Qwen3-0.6B) must be loaded whole or the save is a stub
        path = os.path.join(a.out, "card_model_fp16.onnx"); onnx.save(m16, path); outs.append(path)
        print(f"fp16: {os.path.getsize(path)/1e6:.0f} MB", flush=True)
    except Exception as e: print("fp16 failed:", type(e).__name__, str(e)[:150], flush=True)
    # parity via quantize_check's harness
    import subprocess
    cmd = [sys.executable, os.path.join(ROOT, "export", "quantize_check.py"), "--ckpt", a.ckpt, "--onnx", a.onnx, "--out", a.out, "--parity", str(a.parity), "--parity-only", *outs]
    r = subprocess.run(cmd, capture_output=True, text=True); print("\n".join(l for l in r.stdout.splitlines() if "overlap" in l)); print(r.stderr[-500:] if r.returncode else "")

if __name__ == "__main__":
    main()
