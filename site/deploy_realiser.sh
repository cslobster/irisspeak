#!/bin/sh
# Ship a trained sentence realiser to the web app, reversibly -- the realiser twin of deploy_model.sh.
#
#   sh site/deploy_realiser.sh /path/to/hf_realiser r2      # export, stage, upload
#   sh site/deploy_realiser.sh --rollback r1                # put the previous manifest back
#
# The app fetches realiser_manifest.json with a 300 s cache and reads the chunk paths from it, so a new version
# is live on the next app load with no code deploy. Chunks live under an immutable version prefix (r1/, r2/ ...),
# so rollback is re-uploading the old manifest, which is kept beside the new one as realiser_manifest.<ver>.json.
#
# The prompt the app sends must match the one the model was trained on: run `python3 model/eval/prompt_parity.py`
# and ship the client change in the same step (docs/PLAN-REALISER.md §2).
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"; WORK="${WORK:-$HOME/work4/aac}"
MODEL_DIR="${MODEL_DIR:-$WORK/site/public/model}"

if [ "$1" = "--rollback" ]; then
  VER="${2:?version to roll back to, e.g. r1}"
  [ -f "$MODEL_DIR/realiser_manifest.$VER.json" ] || { echo "no saved manifest for $VER"; exit 1; }
  cp "$MODEL_DIR/realiser_manifest.$VER.json" "$MODEL_DIR/realiser_manifest.json"
  cd "$MODEL_DIR" && unset CLOUDFLARE_API_TOKEN
  npx --yes wrangler@latest r2 object put "irisspeak-model/realiser_manifest.json" --file realiser_manifest.json \
    --content-type application/json --cache-control "public, max-age=300" --remote >/dev/null
  echo "  restored realiser_manifest.json -> $VER"
  exit 0
fi

HF="${1:?path to the trained hf_realiser dir}"; VER="${2:?version tag, e.g. r2}"
[ -f "$HF/config.json" ] || { echo "$HF is not an hf_realiser dir"; exit 1; }
python3 "$REPO/model/eval/prompt_parity.py" || { echo "prompt builders disagree -- fix before shipping a model"; exit 1; }

if [ -f "$MODEL_DIR/realiser_manifest.json" ]; then
  OLD=$(python3 -c "import json;print(json.load(open('$MODEL_DIR/realiser_manifest.json'))['chunks'][0].split('/')[0])")
  cp "$MODEL_DIR/realiser_manifest.json" "$MODEL_DIR/realiser_manifest.$OLD.json"
  echo "current version: $OLD  ->  staging $VER"
fi
python3 "$REPO/model/export/export_realiser.py" --hf "$HF" --out "$REPO/model/export/out_realiser_$VER" --version "$VER" --site "$MODEL_DIR"
echo "staged. chunks: $(ls "$MODEL_DIR/$VER" 2>/dev/null | grep -c realiser || echo 0)  (rollback: sh site/deploy_realiser.sh --rollback ${OLD:-r1})"
printf "upload to R2 now? [y/N] "; read ans; [ "$ans" = "y" ] || { echo "not uploaded"; exit 0; }
MODEL_DIR="$MODEL_DIR" sh "$REPO/site/upload_model.sh" "$VER"
echo "live. verify: curl -s https://model.irisspeak.org/realiser_manifest.json | head -3"
