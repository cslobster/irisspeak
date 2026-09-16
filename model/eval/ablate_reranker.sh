#!/bin/sh
# Which parts of the reranker stack earn their keep, measured on the audience gates.
#   sh eval/ablate_reranker.sh distill_v4      (after evaluate_run.sh has built site/model_<run>)
# Variants: model only | full reranker (54 features) | no-meta reranker (13: no category/intent one-hots)
# plus the full reranker with the pinned answer words (school subjects, doctor words) switched off.
set -e
RUN="${1:?run name}"; WORK="${WORK:-$HOME/work4/aac}"; REPO="${REPO:-$HOME/work3/ai_aactalk}"; M="$REPO/model"
CKPT="$WORK/train/out/$RUN/card_model.pt"; ONNX="$WORK/export/out_$RUN/card_model_fp16.onnx"
FULL="$WORK/site/model_$RUN"; MIN="$WORK/site/model_${RUN}_nometa"
QY="$M/data/states/test_qa_youth.jsonl"; QG="$M/data/states/test_gen.jsonl"
if [ ! -f "$MIN/reranker.json" ]; then
  mkdir -p "$MIN"; cp "$FULL/cards.json" "$MIN/"
  python3 "$M/eval/export_reranker.py" --ckpt "$CKPT" --n-train 6000 --out "$MIN" --no-meta 2>&1 | grep -E "self-check|exported"
fi
run() { # label, model dir, extra flags
  export BOARD_MODEL_DIR="$2" BOARD_ONNX="$ONNX"
  b=$(python3 "$M/eval/board_eval.py" --no-md $3 2>&1 | tail -1 | sed -E 's/.*pass ([0-9]+\/[0-9]+).*content-only ([0-9]+\/[0-9]+)/\1 (\2)/')
  y=$(python3 "$M/eval/board_eval.py" --no-md --qa 400 --qa-file "$QY" $3 2>&1 | tail -1 | sed -E 's/.*pass ([0-9]+\/[0-9]+).*/\1/')
  g=$(python3 "$M/eval/board_eval.py" --no-md --qa 400 --qa-file "$QG" $3 2>&1 | tail -1 | sed -E 's/.*pass ([0-9]+\/[0-9]+).*/\1/')
  printf "%-34s bank %-16s youth %-10s gen %-10s\n" "$1" "$b" "$y" "$g"
}
echo "run: $RUN"
run "model only (no reranker)"      "$FULL" "--no-rerank"
run "reranker, no-meta (13 feats)"  "$MIN"  ""
run "reranker, full (54 feats)"     "$FULL" ""
run "full, pinned routes OFF"       "$FULL" "--no-pins"
