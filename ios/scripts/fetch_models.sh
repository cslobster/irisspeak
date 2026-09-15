#!/bin/sh
# Copies the large model binaries (not tracked in git) into the app bundle resources.
# IrisSpeakCard.mlpackage: Core ML export of the Qwen3-0.6B card model (export/export_coreml.py) — Xcode compiles it into the bundle.
# card_model_fp16.onnx: ONNX export of the same model (fallback only) (train/out/qwen3_06b_v31 on Modal, exported with
#   export/export_onnx_optimum.py + export/quantize_nbits.py into export/out_qwen31). Card i = token V+i, V = 151936.
# cards.json / reranker.json / freq.json / card_vecs.bin: export/stage_qwen31 (site/chunk_model.py + eval/export_reranker.py).
# tokenizer.json: the Qwen3 tokenizer (BPETokenizer reads the NFC normalizer + split regex from it).
# minilm_l6_v2.onnx: Xenova/all-MiniLM-L6-v2 fp32 ONNX (same file the web app fetches from the HF hub).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."; DST="$HERE/../irisspeak/irisspeak/Resources/Model"
SRC_ONNX="${1:-$ROOT/export/out_qwen31/ios/card_model_fp16.onnx}"   # iOS variant: last-token slice + external weights (see PLAN-RETRAIN.md §8); STAGE="${2:-$ROOT/site/public/model}"
rm -rf "$DST/IrisSpeakCard.mlpackage" "$DST/card_model_fp16.onnx" "$DST/card_model_fp16.onnx_data"
CARD_COREML="${CARD_COREML:-$ROOT/export/out_v31/coreml/IrisSpeakCard.mlpackage}"   # IrisSpeak-135M v31 fp16 (shipping; fp32 lossless variant in coreml_fp32); Qwen3-0.6B is export/out_qwen31/coreml
if [ -d "$CARD_COREML" ]; then cp -R "$CARD_COREML" "$DST/"   # Core ML (native) card model, preferred
else cp "$SRC_ONNX" "$DST/card_model_fp16.onnx"; cp "${SRC_ONNX}_data" "$DST/card_model_fp16.onnx_data"; fi   # ONNX Runtime fallback
for f in cards.json reranker.json freq.json card_vecs.bin; do cp "$STAGE/$f" "$DST/$f"; done   # STAGE = site/public/model for the 135M, export/stage_qwen31 for Qwen
# sentence realiser (export/export_realiser.py): fp16 ONNX with KV cache + the SmolLM2 tokenizer it was trained with
REALISER_COREML="${REALISER_COREML:-$ROOT/export/out_realiser/coreml/IrisSpeakRealiser_fp16.mlpackage}"   # export/export_coreml_realiser.py; ONNX is the fallback
rm -rf "$DST/IrisSpeakRealiser.mlpackage" "$DST/realiser_fp16.onnx"
if [ -d "$REALISER_COREML" ]; then cp -R "$REALISER_COREML" "$DST/IrisSpeakRealiser.mlpackage"; else cp "$ROOT/export/out_realiser/realiser_fp16.onnx" "$DST/realiser_fp16.onnx"; fi
cp "$ROOT/export/out_realiser/onnx/tokenizer.json" "$DST/realiser_tokenizer.json"
TOK=$(ls -d ~/.cache/huggingface/hub/models--Qwen--Qwen3-0.6B/snapshots/*/tokenizer.json 2>/dev/null | head -1)
if [ -n "$CARD_TOKENIZER" ]; then cp "$CARD_TOKENIZER" "$DST/tokenizer.json"; else cp "$ROOT/export/out_realiser/onnx/tokenizer.json" "$DST/tokenizer.json"; fi   # SmolLM2 for the 135M; set CARD_TOKENIZER to the Qwen tokenizer.json for Qwen
if [ ! -f "$DST/minilm_l6_v2.onnx" ]; then
  curl -L -o "$DST/minilm_l6_v2.onnx" "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx"
fi
ls -la "$DST"; echo "models in place"
