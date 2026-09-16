#!/bin/sh
# Take a finished Modal training run from checkpoint to a full verdict.
#
# Pulls the checkpoint, exports fp16, rebuilds the card metadata, retrains the reranker against the NEW model
# (the old one was fitted to the old ranking, so reusing it measures the wrong thing), then runs every check:
# the question bank, the held-out corpus questions, and setting sensitivity/precision.
#
#   sh eval/evaluate_run.sh distill_v2
#
# Baselines to beat, from the shipped v31 model:
#   bank 80/80 (content-only 74/80) | held-out corpus 332/371 | sensitivity 0.519 | precision 0.185
set -e
RUN="${1:?usage: evaluate_run.sh <run-name>}"
WORK="${WORK:-$HOME/work4/aac}"
REPO="${REPO:-$HOME/work3/ai_aactalk}"
M="$REPO/model"
OUT="$WORK/export/out_$RUN"
MDIR="$WORK/site/model_$RUN"
CKPT="$WORK/train/out/$RUN/card_model.pt"

echo "== 1/6 fetch checkpoint =="
[ -f "$CKPT" ] || (cd "$WORK" && python3 -m modal volume get irisspeak-train "$RUN" train/out/)

echo "== 2/6 export onnx =="
[ -f "$OUT/onnx/model.onnx" ] || python3 "$M/export/export_onnx_optimum.py" --ckpt "$CKPT" --out "$OUT"
[ -f "$OUT/card_model_fp16.onnx" ] || python3 "$M/export/quantize_nbits.py" --ckpt "$CKPT" --onnx "$OUT/onnx/model.onnx" --out "$OUT"

echo "== 3/6 card metadata =="
mkdir -p "$MDIR"
python3 "$REPO/site/chunk_model.py" --onnx "$OUT/card_model_fp16.onnx" --cards "$OUT/extended_vocab.json" --out "$MDIR"

echo "== 4/6 reranker (retrained against this model) =="
python3 "$M/eval/export_reranker.py" --ckpt "$CKPT" --n-train 6000 --out "$MDIR"

export BOARD_MODEL_DIR="$MDIR" BOARD_ONNX="$OUT/card_model_fp16.onnx"

echo "== 5/6 board evaluation =="
# The reranker ablation on distill_v4 showed the reranker worth one question on the youth gate and none on gen,
# so the model-only board is the primary number; the reranked line stays so a regression would be visible.
echo "--- question bank, MODEL ONLY (baseline 80/80, content-only 74/80) ---"
python3 "$M/eval/board_eval.py" --no-md --no-rerank 2>&1 | tail -1
echo "--- question bank, with reranker ---"
python3 "$M/eval/board_eval.py" --no-md 2>&1 | tail -1
echo "--- held-out corpus questions, all (baseline 332/371; adult-heavy, kept for comparison) ---"
python3 "$M/eval/board_eval.py" --no-md --qa 400 2>&1 | tail -1
QY="$M/data/states/test_qa_youth.jsonl"; [ -f "$QY" ] && { echo "--- test_qa_youth, MODEL ONLY ---"; python3 "$M/eval/board_eval.py" --no-md --no-rerank --qa 400 --qa-file "$QY" 2>&1 | tail -1; echo "--- test_qa_youth, with reranker ---"; python3 "$M/eval/board_eval.py" --no-md --qa 400 --qa-file "$QY" 2>&1 | tail -1; }
QG="$M/data/states/test_gen.jsonl";     [ -f "$QG" ] && { echo "--- test_gen, MODEL ONLY ---"; python3 "$M/eval/board_eval.py" --no-md --no-rerank --qa 400 --qa-file "$QG" 2>&1 | tail -1; echo "--- test_gen, with reranker ---"; python3 "$M/eval/board_eval.py" --no-md --qa 400 --qa-file "$QG" 2>&1 | tail -1; }

echo "== 6/6 setting conditioning (baseline sensitivity 0.519, precision 0.185) =="
python3 "$M/eval/setting_eval.py" --model-dir "$MDIR" --onnx "$OUT/card_model_fp16.onnx" \
    --dataset "$REPO/datasets/aac-setting-turns" 2>&1 | sed -n '3,14p'
