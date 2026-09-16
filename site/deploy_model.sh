#!/bin/sh
# Ship a trained card model to the web apps, reversibly.
#
#   sh site/deploy_model.sh distill_v6 v6          # stage + upload
#   sh site/deploy_model.sh --rollback v31         # put the previous manifest back
#
# How the swap works: the app fetches manifest.json with cache: no-store and reads the chunk paths from it, so a
# new version is picked up on the next app load with no code deploy. Chunks live under an immutable version
# prefix, so old versions stay on R2 and rollback is re-uploading the old manifest. The previous manifest is
# kept as manifest.<ver>.json beside the new one for exactly that.
#
# What this does NOT do: the iOS app bundles its own Core ML model (export/export_coreml.py) and ships through
# the App Store; that is a separate release.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"; WORK="${WORK:-$HOME/work4/aac}"
MODEL_DIR="$WORK/site/public/model"          # what upload_model.sh reads from
if [ "$1" = "--rollback" ]; then
  VER="${2:?version to roll back to, e.g. v31}"
  [ -f "$MODEL_DIR/manifest.$VER.json" ] || { echo "no saved manifest for $VER"; exit 1; }
  cp "$MODEL_DIR/manifest.$VER.json" "$MODEL_DIR/manifest.json"
  cp "$MODEL_DIR/cards.$VER.json" "$MODEL_DIR/cards.json" 2>/dev/null || true
  cd "$MODEL_DIR" && unset CLOUDFLARE_API_TOKEN
  for f in manifest.json cards.json; do npx --yes wrangler@latest r2 object put "irisspeak-model/$f" --file "$f" --content-type application/json --cache-control "public, max-age=300" --remote >/dev/null && echo "  restored $f -> $VER"; done
  exit 0
fi
RUN="${1:?run name, e.g. distill_v6}"; VER="${2:?version tag, e.g. v6}"
SRC="$WORK/site/model_$RUN"                   # built by eval/evaluate_run.sh (chunks + cards.json + manifest)
[ -f "$SRC/manifest.json" ] || { echo "$SRC has no manifest; run eval/evaluate_run.sh $RUN first"; exit 1; }
OLD=$(python3 -c "import json;print(json.load(open('$MODEL_DIR/manifest.json'))['chunks'][0].split('/')[0])")
echo "current version on disk: $OLD  ->  staging $VER from $SRC"
cp "$MODEL_DIR/manifest.json" "$MODEL_DIR/manifest.$OLD.json"; cp "$MODEL_DIR/cards.json" "$MODEL_DIR/cards.$OLD.json"
mkdir -p "$MODEL_DIR/$VER"
CHUNK_DIR=$(dirname "$(ls "$SRC"/*/card_model_fp16.part00 "$SRC"/card_model_fp16.part00 2>/dev/null | head -1)")
cp "$CHUNK_DIR"/card_model_fp16.part* "$MODEL_DIR/$VER/"
python3 - "$SRC/manifest.json" "$MODEL_DIR/manifest.json" "$VER" <<'PY'
import json, sys, os
m = json.load(open(sys.argv[1])); ver = sys.argv[3]
m["chunks"] = [f"{ver}/{os.path.basename(c)}" for c in m["chunks"]]
json.dump(m, open(sys.argv[2], "w"), indent=1)
PY
cp "$SRC/cards.json" "$MODEL_DIR/cards.json"
# reranker assets: copied only if the app still loads them (kept harmless otherwise)
for f in reranker.json freq.json card_vecs.bin; do [ -f "$SRC/$f" ] && cp "$SRC/$f" "$MODEL_DIR/$f"; done
echo "staged. chunks: $(ls "$MODEL_DIR/$VER" | wc -l | tr -d ' ')  manifest -> $VER  (rollback: sh site/deploy_model.sh --rollback $OLD)"
printf "upload to R2 now? [y/N] "; read ans; [ "$ans" = "y" ] || { echo "not uploaded"; exit 0; }
sh "$REPO/site/upload_model.sh" "$VER"
echo "live. verify: curl -s https://model.irisspeak.org/manifest.json | head -3"
