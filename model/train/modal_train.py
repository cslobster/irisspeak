#!/usr/bin/env python3
"""Train the IrisSpeak card model on Modal (GPU) instead of the Mac.

Runs train/train_smollm.py unchanged inside a container, one GPU per backbone, all backbones in parallel.
Data (data/states, vocab/vocab.csv) and the trainer are shipped with the image; outputs land in the
`irisspeak-train` volume under /<run name>/ (card_model.pt, results.json, *_top16.jsonl, train.log).

  nohup modal run --detach train/modal_train.py --runs "smollm135_v3=HuggingFaceTB/SmolLM2-135M-Instruct,lfm25_350m_v3=LiquidAI/LFM2.5-350M,qwen3_06b_v3=Qwen/Qwen3-0.6B" > train/out/modal_bakeoff.log 2>&1 &
  modal volume ls irisspeak-train ; modal volume get irisspeak-train qwen3_06b_v3/results.json train/out/qwen3_06b_v3/
"""
import os, subprocess, sys, time
import modal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = modal.App("irisspeak-train")
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("torch==2.8.0", "transformers==4.57.1", "numpy", "sentencepiece", "protobuf", "accelerate", "safetensors")
    .add_local_file(os.path.join(ROOT, "train", "train_smollm.py"), "/root/aac/train/train_smollm.py")
    .add_local_file(os.path.join(ROOT, "vocab", "vocab.csv"), "/root/aac/vocab/vocab.csv")
    .add_local_dir(os.path.join(ROOT, "data", "states"), "/root/aac/data/states")
    .add_local_file(os.path.join(ROOT, "train", "train_realiser.py"), "/root/aac/train/train_realiser.py")
    .add_local_dir(os.path.join(ROOT, "data", "realiser"), "/root/aac/data/realiser")
)
# newest architectures (Qwen3.5 hybrid Gated DeltaNet) need transformers 5.x and the fla kernels
image_latest = (
    modal.Image.from_registry("nvidia/cuda:12.8.1-devel-ubuntu22.04", add_python="3.11")
    .apt_install("git", "build-essential")
    .pip_install("torch==2.8.0", "transformers>=5.17", "numpy", "sentencepiece", "protobuf", "accelerate", "safetensors", "flash-linear-attention", "triton", "ninja", "packaging", "einops")
    # causal_conv1d has no wheel for this torch: compile it for the A100 (sm80) so Qwen3.5's DeltaNet conv is not the slow reference path
    .run_commands("TORCH_CUDA_ARCH_LIST=8.0 MAX_JOBS=8 pip install --no-build-isolation causal-conv1d==1.5.3.post1 || TORCH_CUDA_ARCH_LIST=8.0 MAX_JOBS=8 pip install --no-build-isolation causal-conv1d")
    .add_local_file(os.path.join(ROOT, "train", "train_smollm.py"), "/root/aac/train/train_smollm.py")
    .add_local_file(os.path.join(ROOT, "vocab", "vocab.csv"), "/root/aac/vocab/vocab.csv")
    .add_local_dir(os.path.join(ROOT, "data", "states"), "/root/aac/data/states")
)
out_vol = modal.Volume.from_name("irisspeak-train", create_if_missing=True)
hf_vol = modal.Volume.from_name("huggingface-cache", create_if_missing=True)


@app.function(image=image, gpu="A100", timeout=6 * 3600, volumes={"/vol": out_vol, "/root/.cache/huggingface": hf_vol})
def train(name: str, model: str, extra: str = "--weighted --mask-dead --epochs 2 --max-eval 2000 --save-every 1000") -> dict:
    import torch
    torch.backends.cuda.matmul.allow_tf32 = True; torch.backends.cudnn.allow_tf32 = True
    out = f"/vol/{name}"; os.makedirs(out, exist_ok=True)
    cmd = [sys.executable, "-u", "/root/aac/train/train_smollm.py", "--model", model, "--out", out] + extra.split()
    print("[modal]", name, "->", " ".join(cmd), flush=True)
    t0 = time.time(); log = open(os.path.join(out, "train.log"), "w")
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    last_commit = time.time()
    for line in p.stdout:
        print(f"[{name}] {line}", end="", flush=True); log.write(line); log.flush()
        if time.time() - last_commit > 600: out_vol.commit(); last_commit = time.time()
    p.wait(); log.close(); out_vol.commit()
    res = {"name": name, "model": model, "rc": p.returncode, "minutes": round((time.time() - t0) / 60, 1)}
    rp = os.path.join(out, "results.json")
    if os.path.exists(rp):
        import json
        res["results"] = json.load(open(rp))
    return res


def _run(name, model, extra):
    import torch
    torch.backends.cuda.matmul.allow_tf32 = True; torch.backends.cudnn.allow_tf32 = True
    out = f"/vol/{name}"; os.makedirs(out, exist_ok=True)
    cmd = [sys.executable, "-u", "/root/aac/train/train_smollm.py", "--model", model, "--out", out] + extra.split()
    print("[modal]", name, "->", " ".join(cmd), flush=True)
    t0 = time.time(); log = open(os.path.join(out, "train.log"), "w")
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    last_commit = time.time()
    for line in p.stdout:
        print(f"[{name}] {line}", end="", flush=True); log.write(line); log.flush()
        if time.time() - last_commit > 600: out_vol.commit(); last_commit = time.time()
    p.wait(); log.close(); out_vol.commit()
    res = {"name": name, "model": model, "rc": p.returncode, "minutes": round((time.time() - t0) / 60, 1)}
    rp = os.path.join(out, "results.json")
    if os.path.exists(rp):
        import json
        res["results"] = json.load(open(rp))
    return res


@app.function(image=image_latest, gpu="A100", timeout=6 * 3600, volumes={"/vol": out_vol, "/root/.cache/huggingface": hf_vol})
def train_latest(name: str, model: str, extra: str = "--weighted --mask-dead --epochs 2 --max-eval 2000 --save-every 1000") -> dict:
    return _run(name, model, extra)


@app.function(image=image, gpu="A100", timeout=3 * 3600, volumes={"/vol": out_vol, "/root/.cache/huggingface": hf_vol})
def train_realiser(name: str, model: str = "HuggingFaceTB/SmolLM2-135M-Instruct", extra: str = "--epochs 4") -> dict:
    """The sentence realiser (train/train_realiser.py): cards + partner question -> sentence."""
    out = f"/vol/{name}"; os.makedirs(out, exist_ok=True)
    cmd = [sys.executable, "-u", "/root/aac/train/train_realiser.py", "--model", model, "--out", out] + extra.split()
    print("[modal]", name, "->", " ".join(cmd), flush=True); t0 = time.time(); log = open(os.path.join(out, "train.log"), "w")
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in p.stdout: print(f"[{name}] {line}", end="", flush=True); log.write(line); log.flush()
    p.wait(); log.close(); out_vol.commit()
    return {"name": name, "rc": p.returncode, "minutes": round((time.time() - t0) / 60, 1)}


@app.local_entrypoint()
def main(runs: str = "", runs_latest: str = "", extra: str = "--weighted --mask-dead --epochs 2 --max-eval 2000 --save-every 1000", realiser: str = "", realiser_extra: str = "--epochs 4"):
    if realiser:   # --realiser realiser_135m[=HF model] [--realiser-extra "--epochs 2"]
        name, _, model = realiser.partition("="); print(train_realiser.remote(name, model or "HuggingFaceTB/SmolLM2-135M-Instruct", realiser_extra)); return
    jobs = []
    for spec in [x for x in runs.split(",") if x.strip()]:
        name, model = spec.split("=", 1)
        jobs.append((name, train.spawn(name.strip(), model.strip(), extra)))
    for spec in [x for x in runs_latest.split(",") if x.strip()]:
        name, model = spec.split("=", 1)
        jobs.append((name, train_latest.spawn(name.strip(), model.strip(), extra)))
        print("spawned", name, model, flush=True)
    for name, j in jobs:
        r = j.get()
        print("DONE", name, {k: v for k, v in r.items() if k != "results"}, flush=True)
        if r.get("results"):
            for split, m in r["results"].items():
                print(f"  {split}: " + " ".join(f"{k}={v:.3f}" for k, v in m.items() if isinstance(v, float)), flush=True)
