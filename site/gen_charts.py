#!/usr/bin/env python3
"""Render the training and benchmark charts for the research site as PNGs.

Inputs: a training log (stdout of train/train_smollm.py) and the saved result JSONs.
Outputs: site/img/*.png

Usage: python3 site/gen_charts.py --log <training log> [--log2 <second log for comparison>]
"""
import argparse, json, os, re, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "site", "public", "paper", "img"); os.makedirs(OUT, exist_ok=True)
# validated categorical palette (light surface #F6F7F5): teal, amber, plum, slate
C = {"teal": "#0E6B72", "amber": "#B7791F", "plum": "#7A3E9D", "slate": "#5C6875", "ink": "#1A212B", "grid": "#E1E5E1", "bg": "#FFFFFF"}
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.edgecolor": C["slate"], "axes.labelcolor": C["ink"],
                     "xtick.color": C["slate"], "ytick.color": C["slate"], "axes.spines.top": False, "axes.spines.right": False,
                     "figure.facecolor": C["bg"], "axes.facecolor": C["bg"]})

def parse_log(path):
    steps, loss, dev = [], [], []
    for line in open(path):
        m = re.search(r"step (\d+)/(\d+) loss ([\d.]+)", line)
        if m: steps.append(int(m.group(1))); loss.append(float(m.group(3)))
        m = re.search(r"dev@(\d+): r@1 ([\d.]+) r@16 ([\d.]+) r@100 ([\d.]+) mrr ([\d.]+)(?: end_p ([\d.]+))?", line)
        if m: dev.append({"step": int(m.group(1)), "r1": float(m.group(2)), "r16": float(m.group(3)), "r100": float(m.group(4)), "mrr": float(m.group(5)), "end_p": float(m.group(6)) if m.group(6) else None})
    return steps, loss, dev

def style(ax, ylabel, title):
    ax.grid(axis="y", color=C["grid"], linewidth=0.8); ax.set_axisbelow(True)
    ax.set_ylabel(ylabel); ax.set_xlabel("optimizer step"); ax.set_title(title, loc="left", fontsize=12, color=C["ink"], pad=12)

def chart_loss(runs):
    fig, ax = plt.subplots(figsize=(8, 3.6))
    for (name, (steps, loss, _)), col in zip(runs, [C["teal"], C["amber"]]):
        ax.plot(steps, loss, color=col, linewidth=2, label=name)
        ax.annotate(f"{loss[-1]:.2f}", (steps[-1], loss[-1]), textcoords="offset points", xytext=(6, 0), color=C["ink"], fontsize=10, va="center")
    style(ax, "training loss (soft-target cross-entropy)", "Training loss")
    if len(runs) > 1: ax.legend(frameon=False)
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "train_loss.png"), dpi=160); plt.close(fig)

def chart_dev(runs):
    fig, ax = plt.subplots(figsize=(8, 4.4))
    for (name, (_, _, dev)), ls in zip(runs, ["-", "--"]):
        x = [d["step"] for d in dev]
        for key, col, lab in (("r1", C["plum"], "Recall@1"), ("r16", C["teal"], "Recall@16"), ("r100", C["amber"], "Recall@100")):
            ax.plot(x, [d[key] for d in dev], color=col, linewidth=2, linestyle=ls, marker="o", markersize=5, label=f"{lab} ({name})" if len(runs) > 1 else lab)
            ax.annotate(f"{dev[-1][key]:.3f}", (x[-1], dev[-1][key]), textcoords="offset points", xytext=(6, 0), color=C["ink"], fontsize=9, va="center")
    style(ax, "recall on 1,000 dev states", "Dev recall during training")
    vals = [d[k] for (_, (_, _, dev)) in runs for d in dev for k in ("r1", "r16", "r100")]
    lo, hi = min(vals), max(vals); pad = 0.06 * (hi - lo)
    ax.set_ylim(max(0, lo - pad), min(1, hi + pad)); ax.legend(frameon=False, ncol=3, fontsize=9, loc="upper center", bbox_to_anchor=(0.5, -0.22))
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "dev_recall.png"), dpi=160); plt.close(fig)

def chart_end(runs):
    fig, ax = plt.subplots(figsize=(8, 3.2))
    for (name, (_, _, dev)), col in zip(runs, [C["teal"], C["amber"]]):
        d = [x for x in dev if x["end_p"] is not None]
        if not d: continue
        ax.plot([x["step"] for x in d], [x["end_p"] for x in d], color=col, linewidth=2, marker="o", markersize=5, label=name)
    style(ax, "precision of predicting end-of-message", "End-of-message precision during training")
    ev = [x["end_p"] for (_, (_, _, dev)) in runs for x in dev if x["end_p"] is not None]
    if ev: ax.set_ylim(max(0, min(ev) - 0.05), min(1, max(ev) + 0.05))
    if len(runs) > 1: ax.legend(frameon=False)
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "end_precision.png"), dpi=160); plt.close(fig)

def chart_benchmark(rows, fname, title, metric_label):
    """rows: list of (system, value_general, value_qa); None = not measured (no bar drawn)"""
    fig, ax = plt.subplots(figsize=(8, 0.6 * len(rows) + 2.0))
    names = [r[0] for r in rows]; y = list(range(len(rows)))[::-1]
    h = 0.36
    for v, r in zip(y, rows):
        if r[1] is not None:
            ax.barh(v + h / 2 + 0.03, r[1], height=h, color=C["teal"]); ax.text(r[1] + 0.01, v + h / 2 + 0.03, f"{r[1]:.2f}", va="center", fontsize=9, color=C["ink"])
        if r[2] is not None:
            ax.barh(v - h / 2 - 0.03, r[2], height=h, color=C["amber"]); ax.text(r[2] + 0.01, v - h / 2 - 0.03, f"{r[2]:.2f}", va="center", fontsize=9, color=C["ink"])
    from matplotlib.patches import Patch
    handles = [Patch(color=C["teal"], label="general test"), Patch(color=C["amber"], label="question-answer test")]
    ax.set_yticks(y); ax.set_yticklabels(names, fontsize=9.5); ax.set_xlim(0, 1); ax.set_xlabel(metric_label)
    ax.grid(axis="x", color=C["grid"], linewidth=0.8); ax.set_axisbelow(True)
    ax.set_title(title, loc="left", fontsize=12, color=C["ink"], pad=12)
    ax.legend(handles=handles, frameon=False, ncol=2, fontsize=9, loc="upper center", bbox_to_anchor=(0.5, -0.16))
    fig.tight_layout(); fig.savefig(os.path.join(OUT, fname), dpi=160); plt.close(fig)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--log", required=True); ap.add_argument("--log2"); ap.add_argument("--name", default="IrisSpeak-135M final"); ap.add_argument("--name2", default="IrisSpeak-135M trial run")
    ap.add_argument("--bench", help="json with benchmark rows"); a = ap.parse_args()
    runs = [(a.name, parse_log(a.log))]
    if a.log2 and os.path.exists(a.log2): runs.append((a.name2, parse_log(a.log2)))
    chart_loss(runs); chart_dev(runs); chart_end(runs)
    if a.bench:
        b = json.load(open(a.bench))
        chart_benchmark(b["recall16"], "bench_recall16.png", "Recall@16: is an acceptable next card in the top 16?", "Recall@16")
        if "recall1" in b: chart_benchmark(b["recall1"], "bench_recall1.png", "Recall@1: is the top prediction acceptable?", "Recall@1")
    print("charts written to", OUT, os.listdir(OUT))

if __name__ == "__main__":
    main()
